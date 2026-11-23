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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'THREADS_LOAD_POST') {
    loadThreadsPost(message.url, sender.tab).then(sendResponse).catch(error => sendResponse({ post: null, error: error.message }));
    return true;
  }
  // Test mode (popup.html?test, unpacked installs only): the popup page is a
  // tab, so it names the tab to save from and can run the shortcut path.
  if (message.type === 'TEST_QUICK_SAVE') {
    (async () => {
      if (!await isDevelopmentInstall()) return { error: 'Test mode needs an unpacked install.' };
      const tab = await chrome.tabs.get(message.tabId);
      return { message: await quickSave(message.command, tab, message.source === 'menu' ? 'menu' : 'shortcut', message.hint || null) };
    })().then(sendResponse).catch(error => sendResponse({ error: error.message }));
    return true;
  }
  if (message.type !== 'ARCHIVE_ACTIVE_TAB') return;
  (async () => {
    const tab = Number.isInteger(message.tabId) && await isDevelopmentInstall() ? await chrome.tabs.get(message.tabId) : null;
    return archiveActiveTab(message.destination, message.universal === true, message.stack === true, tab);
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
async function isDevelopmentInstall() {
  try { return (await chrome.management.getSelf()).installType === 'development'; } catch { return false; }
}

// Save without opening the popup: a keyboard shortcut (Alt+Shift+S / D by
// default, changeable in chrome://extensions/shortcuts) or the right-click
// menu. Both grant activeTab for the tab, the same access a popup click gives,
// so any site can be tried without a permission prompt. The popup mirrors its
// Stack posts option into storage for this; the result shows as a short toast
// on the page and on the toolbar badge.
const MENU_ITEMS = { 'save-to-eagle': 'Save post to Eagle', 'save-to-downloads': 'Save post to Downloads' };
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const [id, title] of Object.entries(MENU_ITEMS)) {
      chrome.contextMenus.create({ id, title, contexts: ['page', 'image', 'video', 'link'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
    }
  });
});
chrome.commands.onCommand.addListener((command, tab) => { if (MENU_ITEMS[command]) quickSave(command, tab).catch(() => {}); });
// The menu also says what was right-clicked, so a post in a feed can be saved
// without opening it.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (MENU_ITEMS[info.menuItemId]) quickSave(info.menuItemId, tab, 'menu', { srcUrl: info.srcUrl || '', linkUrl: info.linkUrl || '' }).catch(() => {});
});

const busyTabs = new Set();
// A shortcut or menu save of a post already saved to the same place asks for
// a second press instead (within 15 s, same tab and page) — easy to press
// twice by accident, and a popup click never asks, for deliberate retries.
let pendingRepeat = null;
async function quickSave(command, givenTab, source = 'shortcut', hint = null) {
  const first = givenTab?.id >= 0 ? givenTab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!first?.id) return 'No tab to save from.';
  if (busyTabs.has(first.id)) return 'Already saving in that tab.';
  // Read the tab again: its URL is visible once the shortcut or menu granted activeTab.
  const tab = await chrome.tabs.get(first.id).catch(() => first);
  busyTabs.add(tab.id);
  const destination = command === 'save-to-eagle' ? 'eagle' : 'downloads';
  const where = destination === 'eagle' ? 'Eagle' : 'Downloads';
  await showBadge(tab.id, '…', '#6b7280', `Saving to ${where}…`);
  await showToast(tab.id, `Saving to ${where}…`, 'busy');
  let result;
  try {
    const { stackPosts = false } = await chrome.storage.local.get('stackPosts').catch(() => ({}));
    const repeat = pendingRepeat && pendingRepeat.tabId === tab.id && pendingRepeat.url === tab.url
      && pendingRepeat.destination === destination && Date.now() < pendingRepeat.until;
    pendingRepeat = null;
    result = await archiveActiveTab(destination, !isSupported(tab.url || ''), stackPosts === true, tab, !repeat, hint);
    if (result.duplicate) {
      pendingRepeat = { tabId: tab.id, url: tab.url, destination, until: Date.now() + 15_000 };
      const again = source === 'menu' ? 'Choose it again' : `Press ${await shortcutOf(command) || 'the shortcut'} again`;
      result.error = `Already saved to ${where} ${whenText(result.savedAt)}.\n${again} within 15 seconds to save anyway.`;
    }
  } catch (error) {
    result = { ok: false, error: /cannot access|cannot be scripted|chrome:\/\//i.test(error.message) ? 'This page cannot be read by extensions.' : error.message };
  } finally {
    busyTabs.delete(tab.id);
  }
  const message = quickSummary(destination, result);
  const state = result.ok ? 'ok' : result.duplicate ? 'repeat' : 'error';
  await showToast(tab.id, message, state);
  await showBadge(tab.id, { ok: '✓', repeat: '2×', error: '!' }[state], { ok: '#16a34a', repeat: '#d97706', error: '#e0161f' }[state], message);
  setTimeout(() => showBadge(tab.id, null, null, null), result.ok ? 4_000 : 10_000);
  return message;
}

async function shortcutOf(command) {
  try { return (await chrome.commands.getAll()).find(item => item.name === command)?.shortcut || ''; } catch { return ''; }
}
function whenText(time) {
  const date = new Date(time), now = new Date();
  const clock = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `today at ${clock}`;
  if (date.toDateString() === new Date(now - 864e5).toDateString()) return `yesterday at ${clock}`;
  return `on ${date.toLocaleDateString([], { day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' })}`;
}

// Saved posts, by address and destination, kept locally to spot repeats.
// Only the post's address and the time are stored; the oldest are dropped.
const SAVED_KEY = 'savedPosts';
const SAVED_LIMIT = 5000;
function postKey(url) {
  try {
    const address = new URL(url);
    // Lower-case the host only: post codes (Instagram, Threads) are case-sensitive.
    let host = address.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
    host = { 'threads.net': 'threads.com', 'twitter.com': 'x.com' }[host] || host;
    const path = address.pathname.replace(/\/(media|photo\/\d+|video\/\d+)\/?$/, '').replace(/\/+$/, '')
      .replace(/^\/(reel|reels|tv)\//, '/p/');
    const video = host.endsWith('youtube.com') && address.searchParams.get('v');
    if (video) return `${host}${path}?v=${video}`;
    // The supported sites name a post by its path; elsewhere the query can be
    // what tells two pages apart (?id=1, ?id=2). Keep it there, minus tracking.
    if (isSupported(url)) return `${host}${path}`;
    const query = [...address.searchParams].filter(([name]) => !/^(utm_\w+|fbclid|gclid|igsh|xmt|si|ref|ref_src|share_id)$/i.test(name))
      .sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${name}=${value}`).join('&');
    return `${host}${path}${query ? `?${query}` : ''}`;
  } catch { return ''; }
}
async function savedAt(key, destination) {
  if (!key) return 0;
  try { return (await chrome.storage.local.get(SAVED_KEY))[SAVED_KEY]?.[key]?.[destination] || 0; } catch { return 0; }
}
// Saves in two tabs can finish together; queue the read-modify-write so one
// does not overwrite the other's entry.
let savedQueue = Promise.resolve();
function rememberSaved(key, destination) {
  savedQueue = savedQueue.then(() => writeSaved(key, destination));
  return savedQueue;
}
async function writeSaved(key, destination) {
  if (!key) return;
  try {
    const saved = (await chrome.storage.local.get(SAVED_KEY))[SAVED_KEY] || {};
    saved[key] = { ...saved[key], [destination]: Date.now() };
    const keys = Object.keys(saved);
    if (keys.length > SAVED_LIMIT) {
      keys.sort((a, b) => Math.max(...Object.values(saved[a])) - Math.max(...Object.values(saved[b])))
        .slice(0, keys.length - SAVED_LIMIT).forEach(old => delete saved[old]);
    }
    await chrome.storage.local.set({ [SAVED_KEY]: saved });
  } catch { /* storage unavailable: no repeat check */ }
}

function quickSummary(destination, result) {
  if (!result?.ok) return result?.error || 'Nothing was saved.';
  const lines = [destination === 'eagle'
    ? `Saved to Eagle: ${result.mediaCount} media.`
    : `Saved to Downloads: ${result.mediaCount + (result.pending || 0)} media + note.`];
  if (result.failed) lines.push(`${result.failed} failed. Links may have expired: reload the page and retry.`);
  if (result.renamed) lines.push('Another extension renamed the files; open the popup for details.');
  if (result.note) lines.push(result.note);
  return lines.join('\n');
}

// A tab-specific badge; null text falls back to the global one (e.g. NEW).
async function showBadge(tabId, text, color, title) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (color) await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setTitle({ tabId, title: title || chrome.runtime.getManifest().action.default_title });
  } catch { /* tab closed */ }
}

// A small notice in the page's corner, in a closed shadow root so the site's
// styles neither change it nor see it. Pages extensions cannot script
// (chrome://, the Web Store) keep the badge only.
async function showToast(tabId, text, state) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, args: [text, state], func: (text, state) => {
      const ID = 'local-social-archiver-toast';
      let host = document.getElementById(ID);
      if (!host) {
        host = document.createElement('div');
        host.id = ID;
        host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
        const root = host.attachShadow({ mode: 'closed' });
        root.innerHTML = `<style>
          .t{display:flex;gap:10px;align-items:flex-start;max-width:340px;padding:12px 14px;border-radius:12px;
             background:#1c1c1f;color:#f4f4f5;font:500 13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;
             box-shadow:0 8px 28px rgba(0,0,0,.35);white-space:pre-line;transition:opacity .25s,transform .25s}
          .t.hide{opacity:0;transform:translateY(8px)}
          .i{flex:none;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;color:#fff}
          .busy .i{background:#6b7280}.ok .i{background:#16a34a}.error .i{background:#e0161f}.repeat .i{background:#d97706}
        </style><div class="t"><span class="i"></span><span class="m"></span></div>`;
        host._root = root;
        (document.body || document.documentElement).append(host);
      }
      const box = host._root?.querySelector('.t');
      if (!box) return;
      box.className = `t ${state}`;
      box.querySelector('.i').textContent = { ok: '✓', error: '!', repeat: '2' }[state] || '…';
      box.querySelector('.m').textContent = text;
      clearTimeout(host._timer);
      if (state !== 'busy') host._timer = setTimeout(() => {
        box.classList.add('hide');
        setTimeout(() => host.remove(), 300);
      }, state === 'ok' ? 3_500 : state === 'repeat' ? 15_000 : 8_000);
    } });
  } catch { /* page cannot be scripted */ }
}

// Threads sends a post's full data (every slide, the video files) only to a
// real page load. After moving inside Threads the open tab lacks it, so open
// the post in a muted background tab next to it, read the data there with the
// collector, and close the tab again. Only Threads post addresses qualify.
async function loadThreadsPost(url, opener) {
  const address = new URL(url);
  const code = (address.pathname.match(/\/(?:post|t)\/([A-Za-z0-9_-]+)/) || [])[1];
  if (!/^(www\.)?threads\.(com|net)$/.test(address.hostname) || address.protocol !== 'https:' || !code) return { post: null, error: 'not a Threads post' };
  const tab = await chrome.tabs.create({ url: `${address.origin}${address.pathname}`, active: false,
    ...(opener?.id >= 0 ? { openerTabId: opener.id, windowId: opener.windowId, index: opener.index + 1 } : {}) });
  try {
    chrome.tabs.update(tab.id, { muted: true }).catch(() => {});
    // Read once the page has finished loading; until then only a preview of
    // the post may be there. On a timeout, keep the best data seen.
    const deadline = Date.now() + 20_000;
    let latest = null;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 700));
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['collector.js'] });
        const answer = await chrome.tabs.sendMessage(tab.id, { type: 'THREADS_POST_DATA', code });
        if (answer?.post) latest = answer.post;
        if (answer?.complete && latest) return { post: latest };
      } catch { /* still loading */ }
    }
    return latest ? { post: latest } : { post: null, error: 'no post data after 20 s' };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function archiveActiveTab(destination = 'downloads', universal = false, stack = false, givenTab = null, checkDuplicate = false, hint = null) {
  const tab = givenTab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id || !tab.url) throw new Error('Could not find active tab.');
  if (!universal && !isSupported(tab.url)) return { ok: false, error: 'Open a post on a supported site — or enable I feel lucky.' };

  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['collector.js'] });
  const post = await chrome.tabs.sendMessage(tab.id, { type: 'COLLECT_POST', hint });
  if (post?.platform === 'x' && post.statusId) await addXEmbedMedia(post);
  if (post?.platform === 'vimeo' && post.vimeo) await addVimeoVideo(post);
  // The collector itself failed (a site change it did not expect): say so
  // instead of the generic "no media found".
  if (post?.error && !post.media?.length) return { ok: false, error: `Could not read this page: ${post.error}` };
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
        : post?.platform === 'threads' && !post.streamedVideo
        ? (/\/post\//.test(post.url || '') ? 'Could not find this Threads post on the page. Reload the page (F5) and save again.'
          : 'In the feed, right-click the post\'s photo or video and choose Save post, or open the post first.')
        : post?.platform === 'pinterest' && !/\/pin\//.test(post.url || '')
        ? 'In the feed, right-click the pin\'s image and choose Save post, or open the pin first.'
        : post?.streamedVideo
        ? 'This video is streamed in chunks and cannot be saved by URL. Play it for a few seconds and retry; some videos cannot be saved.'
        : 'No media found. Open the post itself and wait for photos or videos to load.'
    };
  }

  const uniqueMedia = [...new Map(post.media.map(item => [item.url, item])).values()];
  const key = postKey(post.url);
  if (checkDuplicate) {
    const at = await savedAt(key, destination);
    if (at) return { ok: false, duplicate: true, savedAt: at };
  }
  if (destination === 'eagle') {
    const result = { ...(await saveToEagle(post, uniqueMedia, stack)), note: post.note || '' };
    if (result.ok && !post.incomplete) await rememberSaved(key, destination);
    return result;
  }

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
  if (!post.incomplete) await rememberSaved(key, destination);
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
  const findParent = async () => ((await eagleRequest('/api/folder/list', { method: 'GET' })).data || []).find(folder => folder.name === STACKS_FOLDER);
  let parent = await findParent();
  if (!parent) {
    const created = (await eagleRequest('/api/folder/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderName: STACKS_FOLDER }) })).data;
    // On the very first stack, read the id back if the answer lacks it;
    // otherwise that post's folder would land outside Social Stacks.
    parent = created?.id ? created : await findParent();
  }
  if (!parent?.id) throw new Error('Eagle did not create the Social Stacks folder. Try again.');
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
      // YouTube and Vimeo covers are named "(cover)": Eagle treats an item with
      // the same name and link as a duplicate of the video itself.
      name: post.headline
        ? `${post.headline.slice(0, 120)}${['youtube', 'vimeo'].includes(post.platform) ? (item.kind === 'image' ? ' (cover)' : '') : media.length > 1 ? ` ${index + 1}` : ''}`
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
  const { id, hash, downloadButton, configUrl, downloads, downloadSteps } = post.vimeo;
  // Files from the Download button are, by definition, ones the owner allows.
  // Prefer the largest rendition; the original upload ("source") only when
  // it is all there is, as it can be very large.
  const offered = (downloads || []).slice()
    .sort((a, b) => (a.source ? 1 : 0) - (b.source ? 1 : 0) || (b.width || 0) - (a.width || 0))[0];
  // With the video saved, its cover would only duplicate it in Eagle (which
  // shows the video's own frame); the cover stays only when there is no video.
  if (offered) { post.media = [{ url: offered.url, kind: 'video' }]; return; }
  // The page read the player config already (see vimeoPlayerConfig); only if
  // it could not, try from here.
  let { configStatus, allowDownload, progressive, owner } = post.vimeo;
  try {
    if (configStatus !== 200 && await chrome.permissions.contains({ origins: [VIMEO_PLAYER_ORIGIN] })) {
      const response = await fetch(configUrl || `https://player.vimeo.com/video/${id}/config${hash ? `?h=${hash}` : ''}`);
      configStatus = response.status;
      if (response.ok) {
        const config = await response.json();
        allowDownload = config.video?.allow_download === true;
        progressive = (config.request?.files?.progressive || []).filter(file => /^https:/.test(file?.url || ''));
        owner = config.video?.owner?.name || '';
      }
    }
    if (configStatus !== 200) {
      post.note = downloadButton
        ? `Video not saved: Vimeo did not hand over the download links (${downloadSteps || 'no answer'}). Open the Download dialog on the page and save again. Saved as a reference.`
        : 'Video not saved: no Download button on this video, so its owner has not allowed downloads. Saved as a reference.';
      return;
    }
    if (!downloadButton && !allowDownload) { post.note = 'Video not saved: the owner has not enabled downloads. Saved as a reference.'; return; }
    const best = (progressive || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    if (!best) { post.note = 'Video not saved: Vimeo only streams this video. Saved as a reference.'; return; }
    post.media = [{ url: best.url, kind: 'video' }];
    if (!post.author && owner) post.author = owner;
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
