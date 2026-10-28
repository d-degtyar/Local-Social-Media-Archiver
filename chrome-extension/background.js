chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'ARCHIVE_ACTIVE_TAB') return;
  archiveActiveTab(message.destination, message.universal === true).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function archiveActiveTab(destination = 'downloads', universal = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('Could not find active tab.');
  if (!universal && !isSupported(tab.url)) return { ok: false, error: 'Open an Instagram, Threads, LinkedIn, Reddit, Pinterest, or X post — or enable I feel lucky.' };

  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['collector.js'] });
  const post = await chrome.tabs.sendMessage(tab.id, { type: 'COLLECT_POST' });
  if (post?.platform === 'x' && post.statusId) await addXEmbedMedia(post);
  if (!post?.media?.length) {
    return {
      ok: false,
      error: post?.platform === 'x' && post.streamedVideo
        ? 'X videos need access to X\'s embed service. Click Save again and choose Allow when Chrome asks.'
        : post?.streamedVideo
        ? 'This video is streamed in chunks and cannot be saved by URL. Play it for a few seconds and retry; some videos cannot be saved.'
        : 'No media found. Open the post itself and wait for photos or videos to load.'
    };
  }

  const uniqueMedia = [...new Map(post.media.map(item => [item.url, item])).values()];
  if (destination === 'eagle') return saveToEagle(post, uniqueMedia);

  const folder = `Local Social Archive/${safeName(post.platform)}/${safeName(post.author || 'unknown')}-${stamp()}`;
  const filenames = uniqueMedia.map((item, index) => `${String(index + 1).padStart(2, '0')}-${item.kind}.${extensionFrom(item.url, item.kind)}`);
  await downloadText(`${folder}/post.txt`, postSummary(post, filenames));

  const states = await Promise.all(uniqueMedia.map(async (item, index) => {
    try {
      const id = await chrome.downloads.download({
        url: item.url,
        filename: `${folder}/${filenames[index]}`,
        conflictAction: 'uniquify',
        saveAs: false
      });
      // download() resolves once a download starts, not when it succeeds.
      // Expired CDN links fail afterwards with a 403, so wait for the outcome.
      return await waitForDownload(id);
    } catch { return 'interrupted'; }
  }));
  const count = state => states.filter(value => value === state).length;
  const mediaCount = count('complete');
  const failed = count('interrupted');
  if (failed === uniqueMedia.length) return { ok: false, error: 'Downloads failed. Media links may have expired: reload the page and retry.' };
  return { ok: true, mediaCount, pending: count('in_progress'), failed };
}

// Expired links fail within a second or two, so a short wait catches them
// without holding the popup while large videos finish in Chrome's Downloads.
function waitForDownload(id, timeout = 3_000) {
  return new Promise(resolve => {
    let done = false;
    const finish = state => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(listener);
      resolve(state);
    };
    const listener = delta => {
      if (delta.id === id && delta.state && delta.state.current !== 'in_progress') finish(delta.state.current);
    };
    // Still running after the wait: report as in progress; Chrome finishes it.
    const timer = setTimeout(() => finish('in_progress'), timeout);
    chrome.downloads.onChanged.addListener(listener);
    chrome.downloads.search({ id }).then(([item]) => {
      if (item && item.state !== 'in_progress') finish(item.state);
    }).catch(() => {});
  });
}

async function saveToEagle(post, media) {
  const appInfo = await eagleRequest('/api/v2/app/info', { method: 'GET' });
  if (appInfo.status !== 'success') throw new Error('Eagle did not respond. Open Eagle with an active library.');
  const tags = ['social-media', post.platform, ...(post.author ? [safeName(post.author)] : [])];
  const annotation = [post.text, post.sourceUrl && `Source: ${post.sourceUrl}`, `Original post: ${post.url}`].filter(Boolean).join('\n\n').slice(0, 15000);
  // Eagle's Web API V2 handles app/library state, while importing a remote
  // asset remains on the compatible local V1 endpoint.
  const results = await Promise.allSettled(media.map((item, index) => eagleRequest('/api/item/addFromURL', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: item.url,
      name: `${post.platform}-${safeName(post.author || 'post')}-${String(index + 1).padStart(2, '0')}`,
      website: post.url,
      tags,
      annotation
    })
  })));
  const failed = results.filter(result => result.status === 'rejected').length;
  if (failed === media.length) throw new Error('Eagle failed to import media. Try Downloads or update Eagle to 4.0 Build 21+.');
  return { ok: true, mediaCount: media.length - failed };
}

// X streams video to the page as blob: data. Its public embed service, which
// powers embedded posts on other websites, lists the same media with
// downloadable MP4 variants and original-size photos. Optional permission:
// the popup asks for it the first time the user saves from X.
const X_EMBED_ORIGIN = 'https://cdn.syndication.twimg.com/*';
async function addXEmbedMedia(post) {
  try {
    if (!await chrome.permissions.contains({ origins: [X_EMBED_ORIGIN] })) return;
    const token = ((Number(post.statusId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    const response = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${post.statusId}&token=${token}&lang=en`);
    if (!response.ok) return;
    const data = await response.json();
    const media = (data.mediaDetails || []).flatMap(item => {
      if (item.type === 'photo' && item.media_url_https) return [{ url: `${item.media_url_https}?name=orig`, kind: 'image' }];
      const best = (item.video_info?.variants || [])
        .filter(variant => variant.content_type === 'video/mp4' && variant.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      return best ? [{ url: best.url, kind: 'video' }] : [];
    });
    if (media.length) post.media = media.slice(0, 20);
    if (!post.text && data.text) post.text = String(data.text).slice(0, 12000);
    if (!post.author && data.user?.screen_name) post.author = data.user.screen_name;
  } catch { /* keep the photos found in the page */ }
}

async function eagleRequest(path, options) {
  let response;
  try { response = await fetch(`http://localhost:41595${path}`, options); }
  catch { throw new Error('Eagle is unreachable. Open Eagle and its library, then retry.'); }
  if (!response.ok) throw new Error(`Eagle returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload.status && payload.status !== 'success') throw new Error(payload.message || 'Eagle rejected the request.');
  return payload;
}

function isSupported(url) {
  try {
    const host = new URL(url).hostname;
    return ['www.instagram.com', 'www.threads.com', 'www.threads.net', 'www.linkedin.com', 'x.com', 'twitter.com', 'mobile.x.com', 'mobile.twitter.com'].includes(host)
      || host.endsWith('reddit.com')
      || /(^|\.)pinterest\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host);
  } catch { return false; }
}
function safeName(value) { return String(value).replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'post'; }
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function extensionFrom(url, kind) {
  try {
    const parsed = new URL(url);
    // X photo URLs carry the type as ?format=png instead of a file extension.
    const match = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i) || [null, parsed.searchParams.get('format') || ''];
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov'].includes(match[1].toLowerCase())) return match[1].toLowerCase();
  } catch { /* use a predictable fallback */ }
  return kind === 'video' ? 'mp4' : 'jpg';
}
// A plain-text note beside the media: who posted it, where, and the caption.
// Media URLs are left out because the sites expire them within days.
function postSummary(post, filenames) {
  const kind = postKind(post.url);
  const heading = [post.author, `${PLATFORM_NAMES[post.platform] || 'Web'}${kind ? ` ${kind}` : ''}`].filter(Boolean).join(' — ');
  const saved = new Date().toLocaleString('sv-SE').slice(0, 16);
  return [
    heading,
    post.url,
    post.sourceUrl ? `Source: ${post.sourceUrl}` : '',
    post.spamSource ? 'Source link omitted: it looked like spam.' : '',
    post.text ? `\n${post.text.trim()}\n` : '',
    `Saved: ${saved}`,
    `Files: ${filenames.join(', ')}`
  ].filter(Boolean).join('\n') + '\n';
}
const PLATFORM_NAMES = { instagram: 'Instagram', threads: 'Threads', linkedin: 'LinkedIn', reddit: 'Reddit', pinterest: 'Pinterest', x: 'X', web: 'Web' };
function postKind(url) {
  try {
    const path = new URL(url).pathname;
    if (/^\/stories\//.test(path)) return 'Story';
    if (/\/(?:reel|reels)\//.test(path)) return 'Reel';
    if (/^\/pin\//.test(path)) return 'pin';
    if (/\/(?:p|post|posts|comments|feed\/update|status)\//.test(path)) return 'post';
  } catch { /* fall through */ }
  return '';
}
async function downloadText(filename, text) {
  // The BOM keeps Cyrillic and emoji captions readable in older Windows Notepad.
  const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent('\uFEFF' + text)}`;
  await chrome.downloads.download({ url: dataUrl, filename, conflictAction: 'uniquify', saveAs: false });
}
