# Changelog

## 0.2.3 — Unreleased

- Threads: videos save again. Threads now streams video to its player as blob: data, so the MP4 is read from the post data embedded in the page, as on Instagram. Carousels with videos save every item, and the caption and author come from the same data.

## 0.2.2 — 2026-10-25

- Store summary no longer lists platform names (0.2.1 was rejected by the Chrome Web Store for keyword spam). 0.2.1 was never published; its changes ship in this version.

- Pinterest: saves the open pin at original size (images, videos, carousels, idea pins). The pin is matched by its id, so related and promoted pins on the page are never saved. The pin's source link goes into the Eagle note and post.txt, unless it looks like gambling or similar spam.
- X (Twitter): photos at original size and videos. Videos come from X's public embed service; Chrome asks for that access on the first save from X.
- Popup footer: ♥ Patreon and I2Need links.
- Save to Downloads writes a readable `post.txt` (author, post link, caption, saved date, file list) instead of `post.json`.
- Outside the extension: support links (Patreon, Telegram) in Eagle Companion, README, and the GitHub Sponsor button.

## Eagle Companion 0.2.3

- States that saving media requires Chrome and the separately installed extension; the connection test reports only that Eagle's local API is reachable (Plugin Center review feedback).

## Eagle Companion 0.2.1 / 0.2.2

- One-click install from the Chrome Web Store; the Load unpacked steps are no longer shown.

## 0.2.0 — 2026-10-05

- Instagram Stories.
- Instagram posts opened from the feed or a profile now save without reopening them in a new tab.
- Threads support on `threads.com`.
- Instagram carousels up to 20 items (previously capped at 10).
- Reddit: full galleries and videos from the post's JSON instead of the rendered page.
- Downloads now report completed, still-running, and failed files instead of counting started downloads.
- Clear message when a video is only available as an undownloadable stream.
- CI syntax check for extension and plugin scripts.
- New red bookmark icon (pixel-tuned 16 px, new 32 px size for high-DPI toolbars) and matching red accent in the popup.
- Fixed unreadable "I feel lucky" label in the popup's dark mode.
- Removed the unused `storage` permission.
- Privacy policy and Chrome Web Store listing assets.
- Eagle Companion: guided GitHub install (direct .zip download, copyable `chrome://extensions`, 4 steps), red brand accent, dark-mode polish, and a switch to a single Chrome Web Store button once one exists.

## 0.1.0 — 2026-09-12

- Initial public release.
- Instagram posts, Reels, and full carousels.
- LinkedIn images, carousels, embedded posts, and videos.
- Reddit media support.
- Eagle local Web API integration and Downloads fallback.
- "I feel lucky" opt-in collector for unsupported sites.
- Eagle Companion onboarding plugin.
