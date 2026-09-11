const statusNode = document.querySelector('#status');
const installButton = document.querySelector('#install-extension');
const testButton = document.querySelector('#test-connection');

installButton.addEventListener('click', async () => {
  const url = globalThis.LSMA_CHROME_EXTENSION_URL;
  if (!url) {
    setStatus('Add the public GitHub or Chrome Web Store URL in js/config.js before publishing.', 'warning');
    return;
  }
  await eagle.shell.openExternal(url);
});

testButton.addEventListener('click', testConnection);

async function testConnection() {
  setStatus('Checking local connection…', 'pending');
  try {
    const response = await fetch('http://localhost:41595/api/v2/app/info');
    const payload = await response.json();
    if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'Eagle API returned an error.');
    const version = payload.data?.version ? ` (Eagle ${payload.data.version})` : '';
    setStatus(`✓ Eagle is running${version}\n✓ Local connection available\n✓ Ready to save`, 'success');
  } catch (error) {
    setStatus(`Could not reach Eagle locally. Keep Eagle open, then try again.\n${error.message}`, 'error');
  }
}

function setStatus(message, state) {
  statusNode.textContent = message;
  statusNode.dataset.state = state;
}

eagle.onPluginCreate(() => testConnection());
