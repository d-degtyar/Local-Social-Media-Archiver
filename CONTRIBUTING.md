# Contributing

Thanks for helping improve Local Social Media Archiver.

1. Fork the repository and create a focused branch.
2. Test changes with **Load unpacked** in Chrome.
3. For site-specific parsers, test a direct post URL and describe the URL shape in your pull request. Do not include private URLs, cookies, access tokens, or downloaded media.
4. Keep the project local-first: no browser data should be sent to external services.
5. Browser automation (Playwright, Claude in Chrome) cannot press extension shortcuts, click the toolbar icon, or open the right-click menu. With an unpacked install, open `chrome-extension://<extension id>/popup.html?test` in a tab: the popup then saves from the tab used just before it, and a Test mode box runs the shortcut and menu path (toast, badge, repeat warning). Store installs ignore `?test`.
6. Run the syntax checks before opening a pull request:

```powershell
node --check chrome-extension/background.js
node --check chrome-extension/collector.js
node --check chrome-extension/popup.js
node --check eagle-companion/js/plugin.js
```
