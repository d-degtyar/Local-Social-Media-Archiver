// When another extension listens to onDeterminingFilename (download
// managers, some "save to" add-ons), Chrome can drop the filename given to
// downloads.download, and files land in Downloads as "download (3).jpg".
// Listening here as well lets this extension restate the name and folder for
// its own downloads. Every other download gets an empty suggestion: no change.
const plannedNames = new Map();
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const filename = plannedNames.get(item.url) || plannedNames.get(item.finalUrl);
  if (!filename) { suggest(); return; }
  plannedNames.delete(item.url);
  plannedNames.delete(item.finalUrl);
  suggest({ filename, conflictAction: 'uniquify' });
});
const ARCHIVE_FOLDER = 'Local Social Archive';
async function startDownload(options) {
  try { return await downloadNamed(options, options.filename); }
  catch (error) {
    // A file system that cannot store a character in the title (rare, but
    // Chrome reports it as "Invalid filename"): keep the file, Latin-only name.
    if (!/invalid filename/i.test(error?.message || '')) throw error;
    return downloadNamed(options, asciiPath(options.filename));
  }
}
function downloadNamed(options, filename) {
  plannedNames.set(options.url, filename);
  // Forget the name if the download never reaches filename selection.
  setTimeout(() => plannedNames.delete(options.url), 60_000);
  return chrome.downloads.download({ ...options, filename });
}
function asciiPath(path) {
  const latin = (text, fallback) => text.replace(/[^\x20-\x7e]+/g, '').replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ').replace(/^[\s.-]+|[\s.-]+$/g, '') || fallback;
  return path.split('/').map((part, index, parts) => {
    if (index < parts.length - 1) return latin(part, 'unknown');
    const dot = part.lastIndexOf('.');
    return dot > 0 ? `${latin(part.slice(0, dot), 'media')}${part.slice(dot)}` : latin(part, 'media');
  }).join('/');
}

// After an update, mark the toolbar icon so the change is visible; the popup
// shows what is new and clears the mark when dismissed.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== 'update') return;
  chrome.action.setBadgeText({ text: 'NEW' });
  chrome.action.setBadgeBackgroundColor({ color: '#e0161f' });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'ARCHIVE_ACTIVE_TAB') return;
  archiveActiveTab(message.destination, message.universal === true, message.stack === true).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function archiveActiveTab(destination = 'downloads', universal = false, stack = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('Could not find active tab.');
  if (!universal && !isSupported(tab.url)) return { ok: false, error: 'Open a post on a supported site — or enable I feel lucky.' };

  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['collector.js'] });
  const post = await chrome.tabs.sendMessage(tab.id, { type: 'COLLECT_POST' });
  if (post?.platform === 'x' && post.statusId) await addXEmbedMedia(post);
  if (post?.platform === 'vimeo' && post.vimeo) await addVimeoVideo(post);
  if (!post?.media?.length) {
    return {
      ok: false,
      error: post?.platform === 'x' && !post.streamedVideo
        ? `No photos found in this X post (${[post.diagnosis, post.embedStatus].filter(Boolean).join('; ') || 'unknown reason'}). If the post shows a content warning, click Show and retry.`
        : post?.platform === 'vimeo'
        ? 'Open a Vimeo video page to save its cover as a reference.'
        : post?.platform === 'youtube'
        ? 'Open a YouTube video or Short to save its cover as a reference.'
        : post?.platform === 'x' && post.streamedVideo
        ? 'X videos need access to X\'s embed service. Click Save again and choose Allow when Chrome asks.'
        : post?.streamedVideo
        ? 'This video is streamed in chunks and cannot be saved by URL. Play it for a few seconds and retry; some videos cannot be saved.'
        : 'No media found. Open the post itself and wait for photos or videos to load.'
    };
  }

  const uniqueMedia = [...new Map(post.media.map(item => [item.url, item])).values()];
  if (destination === 'eagle') return { ...(await saveToEagle(post, uniqueMedia, stack)), note: post.note || '' };

  // One flat folder, no subfolder per post. Every file of a post shares a base
  // name, so they sort together and never overwrite another post's files:
  //   "Motion reel 2026.jpg" + "Motion reel 2026.txt"            (titled posts)
  //   "Instagram studio 2026-11-02 14-20 01.jpg" … + ".txt"     (all others)
  const base = (post.headline && safeTitle(post.headline))
    || safeTitle(`${PLATFORM_NAMES[post.platform] || 'Web'} ${post.author || ''} ${localStamp()}`);
  const filenames = uniqueMedia.map((item, index) => {
    const number = uniqueMedia.length > 1 ? ` ${String(index + 1).padStart(2, '0')}` : '';
    return `${base}${number}.${extensionFrom(item.url, item.kind)}`;
  });
  const folder = ARCHIVE_FOLDER;
  const ids = [await downloadText(`${folder}/${base}.txt`, postSummary(post, filenames))];

  const states = await Promise.all(uniqueMedia.map(async (item, index) => {
    try {
      const id = await startDownload({
        url: item.url,
        filename: `${folder}/${filenames[index]}`,
        conflictAction: 'uniquify',
        saveAs: false
      });
      ids.push(id);
      // download() resolves once a download starts, not when it succeeds.
      // Expired CDN links fail afterwards with a 403, so wait for the outcome.
      return await waitForDownload(id);
    } catch { return 'interrupted'; }
  }));
  const count = state => states.filter(value => value === state).length;
  const mediaCount = count('complete');
  const failed = count('interrupted');
  if (failed === uniqueMedia.length) return { ok: false, error: 'Downloads failed. Media links may have expired: reload the page and retry.' };
  return { ok: true, mediaCount, pending: count('in_progress'), failed, renamed: await renamedByAnotherExtension(ids), note: post.note || '' };
}

// Chrome lets the most recently installed extension that listens to
// onDeterminingFilename decide download names. If that is another extension,
// our files land in the Downloads root as "download.txt" or "maxresdefault.jpg";
// detect it so the popup can say why and what fixes it.
async function renamedByAnotherExtension(ids) {
  try {
    const items = (await Promise.all(ids.filter(Boolean).map(id => chrome.downloads.search({ id })))).flat();
    return items.some(item => item.filename && !item.filename.includes(ARCHIVE_FOLDER));
  } catch { return false; }
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

// Eagle has no stacks. Stack mode builds them from folders and a tag: a post
// with several files gets its own folder under "Social Stacks", and its first
// file the "Main Cover" tag. A smart folder filtered by that tag then shows one
// tile per post; the cover's folder holds the whole post.
const STACKS_FOLDER = 'Social Stacks';
const COVER_TAG = 'Main Cover';
async function stackFolderId(post) {
  const list = await eagleRequest('/api/folder/list', { method: 'GET' });
  const parent = (list.data || []).find(folder => folder.name === STACKS_FOLDER)
    || (await eagleRequest('/api/folder/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderName: STACKS_FOLDER }) })).data;
  const name = (post.headline && safeTitle(post.headline))
    || safeTitle(`${PLATFORM_NAMES[post.platform] || 'Web'} ${post.author || ''} ${localStamp()}`);
  const child = await eagleRequest('/api/folder/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderName: name.slice(0, 120), parent: parent.id })
  });
  return child.data?.id;
}

async function saveToEagle(post, media, stack = false) {
  const appInfo = await eagleRequest('/api/v2/app/info', { method: 'GET' });
  if (appInfo.status !== 'success') throw new Error('Eagle did not respond. Open Eagle with an active library.');
  const tags = ['social-media', post.platform, ...(post.author ? [safeName(post.author)] : [])];
  const folderId = stack && media.length > 1 ? await stackFolderId(post) : '';
  const annotation = [post.text, post.sourceUrl && `Source: ${post.sourceUrl}`, `Original post: ${post.url}`].filter(Boolean).join('\n\n').slice(0, 15000);
  // Eagle's Web API V2 handles app/library state, while importing a remote
  // asset remains on the compatible local V1 endpoint.
  const results = await Promise.allSettled(media.map((item, index) => eagleRequest('/api/item/addFromURL', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: item.url,
      // A real title (YouTube video, Pinterest pin) is easier to find in Eagle.
      name: post.headline
        ? `${post.headline.slice(0, 120)}${media.length > 1 ? ` ${index + 1}` : ''}`
        : `${post.platform}-${safeName(post.author || 'post')}-${String(index + 1).padStart(2, '0')}`,
      website: post.url,
      tags: stack && index === 0 ? [...tags, COVER_TAG] : tags,
      annotation,
      ...(folderId ? { folderId } : {})
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
    if (!await chrome.permissions.contains({ origins: [X_EMBED_ORIGIN] })) { post.embedStatus = 'no access to the embed service'; return; }
    const token = ((Number(post.statusId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    const response = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${post.statusId}&token=${token}&lang=en`);
    if (!response.ok) { post.embedStatus = `embed service answered HTTP ${response.status}`; return; }
    const data = await response.json();
    // Age-restricted or withheld posts come back as a tombstone without media.
    if (data.__typename === 'TweetTombstone' || data.tombstone) { post.embedStatus = 'embed service hides this post (age-restricted or withheld)'; return; }
    const media = (data.mediaDetails || []).flatMap(item => {
      if (item.type === 'photo' && item.media_url_https) return [{ url: `${item.media_url_https}?name=orig`, kind: 'image' }];
      const best = (item.video_info?.variants || [])
        .filter(variant => variant.content_type === 'video/mp4' && variant.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      return best ? [{ url: best.url, kind: 'video' }] : [];
    });
    // Older answers list photos separately.
    if (!media.length) for (const photo of data.photos || []) if (photo.url) media.push({ url: `${photo.url.split('?')[0]}?name=orig`, kind: 'image' });
    if (media.length) post.media = media.slice(0, 20);
    else post.embedStatus = 'embed service lists no media';
    if (!post.text && data.text) post.text = String(data.text).slice(0, 12000);
    if (!post.author && data.user?.screen_name) post.author = data.user.screen_name;
  } catch (error) { post.embedStatus = `embed service failed: ${error.message}`; }
}

// Vimeo: the player's config lists progressive MP4 files when there are
// any. The video is saved only when the owner allows downloads (the page's
// Download button, or the config saying so); otherwise the card stays a
// reference. Optional permission, asked by the popup on the first Vimeo save.
const VIMEO_PLAYER_ORIGIN = 'https://player.vimeo.com/*';
async function addVimeoVideo(post) {
  const { id, hash, downloadButton } = post.vimeo;
  try {
    if (!await chrome.permissions.contains({ origins: [VIMEO_PLAYER_ORIGIN] })) { post.note = 'Video not saved: no access to the Vimeo player.'; return; }
    const response = await fetch(`https://player.vimeo.com/video/${id}/config${hash ? `?h=${hash}` : ''}`);
    if (!response.ok) { post.note = `Video not saved: Vimeo answered HTTP ${response.status}.`; return; }
    const config = await response.json();
    const allowed = downloadButton || config.video?.allow_download === true;
    if (!allowed) { post.note = 'Video not saved: the owner has not enabled downloads. Saved as a reference.'; return; }
    const best = (config.request?.files?.progressive || [])
      .filter(file => /^https:/.test(file.url || ''))
      .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    if (!best) { post.note = 'Video not saved: Vimeo only streams this video. Saved as a reference.'; return; }
    post.media = [...post.media, { url: best.url, kind: 'video' }];
    if (!post.author && config.video?.owner?.name) post.author = config.video.owner.name;
  } catch (error) { post.note = `Video not saved: ${error.message}`; }
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
    return ['www.instagram.com', 'www.threads.com', 'www.threads.net', 'www.linkedin.com', 'x.com', 'twitter.com', 'mobile.x.com', 'mobile.twitter.com', 'www.youtube.com', 'youtube.com', 'm.youtube.com', 'vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)
      || host.endsWith('reddit.com')
      || /(^|\.)pinterest\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host);
  } catch { return false; }
}
// Keeps letters in any script, digits, spaces, and punctuation that every
// file system accepts; drops characters Windows or macOS reject in names.
function safeTitle(value) {
  const name = String(value)
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .replace(/^[.\s]+|[.\s]+$/g, '');
  // CON, PRN, NUL, COM1… are reserved device names on Windows.
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name) ? `_${name}` : name;
}
function safeName(value) { return String(value).replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'post'; }
// Local date and time to the minute, e.g. 2026-11-02 14-20 (no colons in file names).
function localStamp() { return new Date().toLocaleString('sv-SE').slice(0, 16).replace(':', '-'); }
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
const PLATFORM_NAMES = { instagram: 'Instagram', threads: 'Threads', linkedin: 'LinkedIn', reddit: 'Reddit', pinterest: 'Pinterest', x: 'X', youtube: 'YouTube', vimeo: 'Vimeo', web: 'Web' };
function postKind(url) {
  try {
    const path = new URL(url).pathname;
    if (/^\/stories\//.test(path)) return 'Story';
    if (/\/(?:reel|reels)\//.test(path)) return 'Reel';
    if (/^\/pin\//.test(path)) return 'pin';
    if (/^\/shorts\//.test(path)) return 'Short';
    if (/(?:^|\/)\d{6,}(?:\/|$)/.test(path) && /vimeo\.com$/.test(new URL(url).hostname)) return 'video';
    if (/^\/(?:watch|live)\b/.test(path)) return 'video';
    if (/\/(?:p|post|posts|comments|feed\/update|status)\//.test(path)) return 'post';
  } catch { /* fall through */ }
  return '';
}
async function downloadText(filename, text) {
  // The BOM keeps Cyrillic and emoji captions readable in older Windows Notepad.
  const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent('\uFEFF' + text)}`;
  return startDownload({ url: dataUrl, filename, conflictAction: 'uniquify', saveAs: false });
}
