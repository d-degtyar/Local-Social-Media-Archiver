chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'ARCHIVE_ACTIVE_TAB') return;
  archiveActiveTab(message.destination, message.universal === true).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function archiveActiveTab(destination = 'downloads', universal = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('Could not find active tab.');
  if (!universal && !isSupported(tab.url)) return { ok: false, error: 'Open an Instagram, Threads, LinkedIn, or Reddit post — or enable I feel lucky.' };

  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['collector.js'] });
  const post = await chrome.tabs.sendMessage(tab.id, { type: 'COLLECT_POST' });
  if (!post?.media?.length) {
    return {
      ok: false,
      error: post?.streamedVideo
        ? 'This video is streamed in chunks and cannot be saved by URL. Play it for a few seconds and retry; some videos cannot be saved.'
        : 'No media found. Open the post itself and wait for photos or videos to load.'
    };
  }

  const uniqueMedia = [...new Map(post.media.map(item => [item.url, item])).values()];
  if (destination === 'eagle') return saveToEagle(post, uniqueMedia);

  const folder = `Local Social Archive/${safeName(post.platform)}/${safeName(post.author || 'unknown')}-${stamp()}`;
  const metadata = JSON.stringify({ ...post, archivedAt: new Date().toISOString() }, null, 2);
  await downloadData(`${folder}/post.json`, metadata);

  const states = await Promise.all(uniqueMedia.map(async (item, index) => {
    const extension = extensionFrom(item.url, item.kind);
    try {
      const id = await chrome.downloads.download({
        url: item.url,
        filename: `${folder}/${String(index + 1).padStart(2, '0')}-${item.kind}.${extension}`,
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

function waitForDownload(id, timeout = 60_000) {
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
    // Large videos may still be running; report them as in progress.
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
  const annotation = [post.text, `Original post: ${post.url}`].filter(Boolean).join('\n\n').slice(0, 15000);
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
    return ['www.instagram.com', 'www.threads.com', 'www.threads.net', 'www.linkedin.com'].includes(host) || host.endsWith('reddit.com');
  } catch { return false; }
}
function safeName(value) { return String(value).replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'post'; }
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function extensionFrom(url, kind) {
  try {
    const match = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (match && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov'].includes(match[1].toLowerCase())) return match[1].toLowerCase();
  } catch { /* use a predictable fallback */ }
  return kind === 'video' ? 'mp4' : 'jpg';
}
async function downloadData(filename, text) {
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
  await chrome.downloads.download({ url: dataUrl, filename, conflictAction: 'uniquify', saveAs: false });
}
