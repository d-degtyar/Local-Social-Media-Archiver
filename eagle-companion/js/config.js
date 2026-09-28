// Public install sources for the Chrome extension.
// While the extension is distributed through GitHub Releases, the companion shows
// a guided "Load unpacked" setup. Set LSMA_CHROME_WEB_STORE_URL once a Chrome Web
// Store listing exists: the companion then switches to a single install button.
globalThis.LSMA_CONFIG = {
  repositoryUrl: "https://github.com/d-degtyar/Local-Social-Media-Archiver",
  extensionZipUrl: "https://github.com/d-degtyar/Local-Social-Media-Archiver/releases/latest/download/local-social-media-archiver-chrome.zip",
  chromeWebStoreUrl: ""
};
