# Contributing

Thanks for helping improve Local Social Media Archiver.

1. Fork the repository and create a focused branch.
2. Test changes with **Load unpacked** in Chrome.
3. For site-specific parsers, test a direct post URL and describe the URL shape in your pull request. Do not include private URLs, cookies, access tokens, or downloaded media.
4. Keep the project local-first: no browser data should be sent to external services.
5. Run the syntax checks before opening a pull request:

```powershell
node --check chrome-extension/background.js
node --check chrome-extension/collector.js
node --check chrome-extension/popup.js
node --check eagle-companion/js/plugin.js
```
