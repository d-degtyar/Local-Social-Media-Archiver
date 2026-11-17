const status = document.querySelector('#status');
const lucky = document.querySelector('#i-feel-lucky');
const stack = document.querySelector('#stack-posts');
// A per-browser preference; the extension has no storage permission.
try { stack.checked = localStorage.getItem('stackPosts') === '1'; } catch { /* private mode */ }
stack.addEventListener('change', () => { try { localStorage.setItem('stackPosts', stack.checked ? '1' : '0'); } catch { /* ignore */ } });

for (const button of document.querySelectorAll('button')) button.addEventListener('click', async () => {
  const destination = button.id === 'save-eagle' ? 'eagle' : 'downloads';
  setDisabled(true);
  status.value = 'Collecting media from tab...';
  try {
    if (lucky.checked) await requestCurrentSitePermission();
    else await requestVideoPermission();
    const result = await chrome.runtime.sendMessage({ type: 'ARCHIVE_ACTIVE_TAB', destination, universal: lucky.checked, stack: stack.checked });
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

function setDisabled(disabled) { document.querySelectorAll('button').forEach(button => { button.disabled = disabled; }); }

// Videos on X and Vimeo need another host (X's embed service, the Vimeo player); ask once, on the first save there.
// Declining still saves the post's photos.
async function requestVideoPermission() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = '';
  try { host = new URL(tab?.url || '').hostname; } catch { return; }
  // Vimeo videos need the player's config, on another host; ask the same way.
  const origins = ['x.com', 'twitter.com', 'mobile.x.com', 'mobile.twitter.com'].includes(host) ? ['https://cdn.syndication.twimg.com/*']
    : ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host) ? ['https://player.vimeo.com/*'] : null;
  if (!origins) return;
  if (!await chrome.permissions.contains({ origins })) await chrome.permissions.request({ origins });
}

async function requestCurrentSitePermission() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) throw new Error('Could not find active tab.');
  let origin;
  try { origin = new URL(tab.url).origin; }
  catch { throw new Error('This page cannot be accessed by Chrome extensions.'); }
  if (!/^https?:\/\//.test(origin)) throw new Error('This page cannot be accessed by Chrome extensions.');
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) throw new Error('Permission for this site was not granted.');
}
