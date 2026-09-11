const status = document.querySelector('#status');
const lucky = document.querySelector('#i-feel-lucky');

for (const button of document.querySelectorAll('button')) button.addEventListener('click', async () => {
  const destination = button.id === 'save-eagle' ? 'eagle' : 'downloads';
  setDisabled(true);
  status.value = 'Collecting media from tab...';
  try {
    if (lucky.checked) await requestCurrentSitePermission();
    const result = await chrome.runtime.sendMessage({ type: 'ARCHIVE_ACTIVE_TAB', destination, universal: lucky.checked });
    status.value = result.ok
      ? destination === 'eagle'
        ? `Added to Eagle: ${result.mediaCount} media.`
        : `Downloaded: ${result.mediaCount} media + metadata.`
      : result.error;
  } catch (error) {
    status.value = `Error: ${error.message}`;
  } finally {
    setDisabled(false);
  }
});

function setDisabled(disabled) { document.querySelectorAll('button').forEach(button => { button.disabled = disabled; }); }

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
