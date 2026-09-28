const config = globalThis.LSMA_CONFIG || {};
const statusNode = document.querySelector('#status');

if (config.chromeWebStoreUrl) {
  document.querySelector('#store-install').hidden = false;
  document.querySelector('#manual-install').hidden = true;
}

document.querySelector('#open-store').addEventListener('click', () => openExternal(config.chromeWebStoreUrl));
document.querySelector('#download-zip').addEventListener('click', () => openExternal(config.extensionZipUrl));
document.querySelector('#open-repository').addEventListener('click', () => openExternal(config.repositoryUrl));
document.querySelector('#test-connection').addEventListener('click', testConnection);
document.querySelector('#copy-extensions-url').addEventListener('click', async event => {
  // Chrome refuses to open chrome:// pages from other apps, so copy it instead.
  await copyText('chrome://extensions');
  const button = event.currentTarget;
  button.textContent = 'Copied ✓';
  setTimeout(() => { button.textContent = 'Copy address'; }, 1800);
});

async function openExternal(url) {
  if (!url) {
    setStatus('This link is not configured. Set it in js/config.js before publishing.', 'warning');
    return;
  }
  await eagle.shell.openExternal(url);
}

async function copyText(text) {
  if (globalThis.eagle?.clipboard?.writeText) return eagle.clipboard.writeText(text);
  return navigator.clipboard.writeText(text);
}

async function testConnection() {
  setStatus('Checking local connection…', 'pending');
  try {
    const response = await fetch('http://localhost:41595/api/v2/app/info');
    const payload = await response.json();
    if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'Eagle API returned an error.');
    const version = payload.data?.version ? ` (Eagle ${payload.data.version})` : '';
    setStatus(`✓ Eagle is ready to receive posts${version}`, 'success');
  } catch (error) {
    setStatus(`Could not reach Eagle locally. Keep Eagle open, then try again.\n${error.message}`, 'error');
  }
}

function setStatus(message, state) {
  statusNode.textContent = message;
  statusNode.dataset.state = state;
}

eagle.onPluginCreate(() => testConnection());
