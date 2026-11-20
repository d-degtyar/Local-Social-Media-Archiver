const status = document.querySelector('#status');
const lucky = document.querySelector('#i-feel-lucky');
const stack = document.querySelector('#stack-posts');

// Popup preferences live in this browser's localStorage.
const prefs = {
  get: key => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } }
};

// The shortcut and right-click menu run without the popup, so the background
// reads Stack posts from extension storage; keep it in step.
const syncStack = () => chrome.storage?.local.set({ stackPosts: stack.checked }).catch(() => {});
stack.checked = prefs.get('stackPosts') === '1';
syncStack();
stack.addEventListener('change', () => {
  prefs.set('stackPosts', stack.checked ? '1' : '0');
  syncStack();
  // The first time stacks are turned on, show the guide: they need a smart
  // folder in Eagle that only the user can create.
  const seen = prefs.get('stackGuideSeen') === '1';
  prefs.set('stackGuideSeen', '1');
  if (stack.checked && !seen) chrome.tabs.create({ url: chrome.runtime.getURL('stacks.html') });
});

// Help mode: the ? button shows a caption under each control, the supported
// sites and the fine print. Off by default: the popup opens compact.
const helpButton = document.querySelector('#toggle-help');
function setHelp(on) {
  document.body.classList.toggle('help-on', on);
  helpButton.setAttribute('aria-pressed', String(on));
  helpButton.title = on ? 'Hide explanations' : 'Show explanations';
}
setHelp(prefs.get('helpMode') === 'on');
helpButton.addEventListener('click', () => {
  const on = !document.body.classList.contains('help-on');
  setHelp(on);
  prefs.set('helpMode', on ? 'on' : 'off');
});

// What's new: the background marks the toolbar icon NEW after an update;
// the popup shows this version's highlights until dismissed.
const WHATS_NEW = {
  '0.2.6': [
    'Save without opening the popup: Alt+Shift+S to Eagle, Alt+Shift+D to Downloads.',
    'Or right-click a post: Save post to Eagle / to Downloads.',
    'A short notice in the page corner shows what was saved, and warns before saving the same post twice.',
    'Sharper saves: full-size Threads and Instagram photos, HD YouTube covers on slow connections.'
  ],
  '0.2.5': [
    'A cleaner popup: press ? for explanations and the list of sites.',
    'Photo-only posts from X save again.',
    'Vimeo: cover and link, plus the video when its owner allows.',
    'Stack posts in Eagle: one tile per post (see How stacks work).'
  ]
};
(async () => {
  let badge = '';
  try { badge = await chrome.action.getBadgeText({}); } catch { /* older Chrome */ }
  if (badge !== 'NEW') return;
  const version = chrome.runtime.getManifest().version;
  document.querySelector('#news-title').textContent = `What's new in ${version}`;
  document.querySelector('#news-list').innerHTML = '';
  for (const line of WHATS_NEW[version] || ['Improvements and fixes.']) {
    const item = document.createElement('li');
    item.textContent = line;
    document.querySelector('#news-list').append(item);
  }
  document.querySelector('#whats-new').hidden = false;
})();
document.querySelector('#dismiss-news').addEventListener('click', () => {
  document.querySelector('#whats-new').hidden = true;
  chrome.action.setBadgeText({ text: '' });
});

// Test mode (see popup.html): an unpacked install opened as popup.html?test.
// The page is then a tab itself, so it saves from the tab used just before.
const testMode = (async () => {
  if (!new URLSearchParams(location.search).has('test')) return false;
  try { return (await chrome.management.getSelf()).installType === 'development'; } catch { return false; }
})();
async function targetTab() {
  if (!await testMode) return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const self = (await chrome.tabs.getCurrent())?.id;
  return (await chrome.tabs.query({ currentWindow: true }))
    .filter(tab => tab.id !== self && !/^(chrome|chrome-extension|about):/.test(tab.url || ''))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
}
testMode.then(async on => {
  if (!on) return;
  document.querySelector('#test-mode').hidden = false;
  const describe = async () => {
    const tab = await targetTab();
    document.querySelector('#test-target').textContent = tab ? `tab ${tab.id}${tab.url ? ` (${tab.url.slice(0, 80)})` : ''}` : 'no other tab in this window';
  };
  await describe();
  window.addEventListener('focus', describe);
  for (const [id, command, source] of [['#test-key-eagle', 'save-to-eagle', 'shortcut'], ['#test-key-downloads', 'save-to-downloads', 'shortcut'], ['#test-menu-eagle', 'save-to-eagle', 'menu']]) {
    document.querySelector(id).addEventListener('click', async () => {
      const tab = await targetTab();
      if (!tab) { status.value = 'No tab to save from.'; return; }
      status.value = 'Running the shortcut save; its notice appears in that tab.';
      const result = await chrome.runtime.sendMessage({ type: 'TEST_QUICK_SAVE', command, source, tabId: tab.id });
      status.value = result?.message || result?.error || 'Done.';
    });
  }
});

for (const button of document.querySelectorAll('button.save')) button.addEventListener('click', async () => {
  const destination = button.id === 'save-eagle' ? 'eagle' : 'downloads';
  setDisabled(true);
  status.value = 'Collecting media from tab...';
  try {
    if (lucky.checked) await requestCurrentSitePermission();
    else await requestVideoPermission();
    const tabId = await testMode ? (await targetTab())?.id : undefined;
    const result = await chrome.runtime.sendMessage({ type: 'ARCHIVE_ACTIVE_TAB', destination, universal: lucky.checked, stack: stack.checked, tabId });
    status.value = result.ok
      ? destination === 'eagle'
        ? `Added to Eagle: ${result.mediaCount} media.${result.note ? `\n${result.note}` : ''}`
        : downloadSummary(result)
      : result.error;
  } catch (error) {
    status.value = `Error: ${error.message}`;
  } finally {
    setDisabled(false);
  }
});

function downloadSummary({ mediaCount, pending, failed, renamed, note }) {
  const lines = [pending ? `Saving ${mediaCount + pending} media to Downloads.` : `Downloaded: ${mediaCount} media + note to Downloads/Local Social Archive.`];
  if (pending) lines.push(`${pending} still downloading in Chrome — no need to wait.`);
  if (failed) lines.push(`${failed} failed. Links may have expired: reload the page and retry.`);
  if (note) lines.push(note);
  if (renamed) lines.push('Another extension renamed these files, so they are in the Downloads root under default names. Turn off download-manager extensions, or remove and reinstall this one so Chrome lets it name its files.');
  return lines.join('\n');
}

function setDisabled(disabled) { document.querySelectorAll('button.save').forEach(button => { button.disabled = disabled; }); }

// Videos on X and Vimeo need another host (X's embed service, the Vimeo player); ask once, on the first save there.
// Declining still saves the post's photos.
async function requestVideoPermission() {
  const tab = await targetTab();
  let host = '';
  try { host = new URL(tab?.url || '').hostname; } catch { return; }
  // Vimeo videos need the player's config, on another host; ask the same way.
  const origins = ['x.com', 'twitter.com', 'mobile.x.com', 'mobile.twitter.com'].includes(host) ? ['https://cdn.syndication.twimg.com/*']
    : ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host) ? ['https://player.vimeo.com/*'] : null;
  if (!origins) return;
  if (!await chrome.permissions.contains({ origins })) await chrome.permissions.request({ origins });
}

async function requestCurrentSitePermission() {
  const tab = await targetTab();
  if (!tab?.url) throw new Error('Could not find active tab.');
  let origin;
  try { origin = new URL(tab.url).origin; }
  catch { throw new Error('This page cannot be accessed by Chrome extensions.'); }
  if (!/^https?:\/\//.test(origin)) throw new Error('This page cannot be accessed by Chrome extensions.');
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) throw new Error('Permission for this site was not granted.');
}

// Show the keys actually set (the user may have changed or removed them).
chrome.commands?.getAll?.().then(commands => {
  for (const { name, shortcut } of commands) {
    const key = document.querySelector(name === 'save-to-eagle' ? '#key-eagle' : name === 'save-to-downloads' ? '#key-downloads' : null);
    if (key) key.textContent = shortcut || 'no key set';
  }
}).catch(() => {});
document.querySelector('#change-keys').addEventListener('click', event => {
  event.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
