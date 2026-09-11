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
  if (!post?.media?.length) return { ok: false, error: 'No media found. Open the post itself and wait for photos or videos to load.' };

  const uniqueMedia = [...new Map(post.media.map(item => [item.url, item])).values()];
  if (destination === 'eagle') return saveToEagle(post, uniqueMedia);

  const folder = `Local Social Archive/${safeName(post.platform)}/${safeName(post.author || 'unknown')}-${stamp()}`;
  const metadata = JSON.stringify({ ...post, archivedAt: new Date().toISOString() }, null, 2);
  await downloadData(`${folder}/post.json`, metadata);

  const results = await Promise.allSettled(uniqueMedia.map((item, index) => {
    const extension = extensionFrom(item.url, item.kind);
    return chrome.downloads.download({
      url: item.url,
      filename: `${folder}/${String(index + 1).padStart(2, '0')}-${item.kind}.${extension}`,
      conflictAction: 'uniquify',
      saveAs: false
    });
  }));
  const count = results.filter(result => result.status === 'fulfilled').length;
  return { ok: true, mediaCount: count };
}

async function saveToEagle(post, media) {
  const appInfo = await eagleRequest('/api/v2/app/info', { method: 'GET' });
  if (appInfo.status !== 'success') throw new Error('Eagle did not respond. Open Eagle with an active library.');
  const tags = ['social-media', post.platform, ...(post.author ? [safeName(post.author)] : [])];
  const annotation = [post.text, `\n\nOriginal post: ${post.url}`].join('').slice(0, 15000);
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
    return ['www.instagram.com', 'www.threads.net', 'www.linkedin.com'].includes(host) || host.endsWith('reddit.com');
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
