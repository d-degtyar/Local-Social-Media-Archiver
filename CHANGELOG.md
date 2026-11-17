# Changelog

## 0.2.5 — Unreleased

- Compact popup: two save buttons and two toggles. The ? button turns on explanations (a caption under each control, the supported sites, privacy note and support links); it is on for new users and remembered once turned off.
- What's new: after an update the toolbar icon shows NEW and the popup lists the version's highlights until dismissed.
- Vimeo: videos save as reference cards like YouTube (largest cover, title, author, description, link). The MP4 is added when the owner allows downloads (the page's Download button or the player config) and Vimeo serves a progressive file; otherwise the popup says why only the card was saved.
- X: photo-only posts save again. The open post is found by its timestamp link, by X's focus marker, or by its photo links, so replies in threads and posts without a timestamp link work; photos painted only as a background image (behind content warnings) are found too. The embed service is read for photos as well, and when nothing is found the popup says why.
- Stack posts in Eagle: an option in the popup. Posts with several files go into their own folder under "Social Stacks" and the first file is tagged "Main Cover"; single files get the tag without a folder. A smart folder filtered by that tag shows one tile per post.
- Stacks guide: a page with a diagram and three steps (turn on, create the "Stacks" smart folder with a copy-the-tag button, browse), plus tips on search and extra feeds. It opens the first time stacks are turned on and from "How stacks work" in the popup.

## Telegram Sorter

- Moved to its own repository, with its history: [d-degtyar/eagle-telegram-sorter](https://github.com/d-degtyar/eagle-telegram-sorter).

## 0.2.4 — Unreleased

- YouTube videos and Shorts save as references: the cover image at the highest available size (maxres, then SD, then HQ), with the title, channel, description, and link. The video itself is not downloaded, in line with YouTube's terms and Chrome Web Store policy.
- YouTube description is the uploader's text, not the rendered page: after navigating inside YouTube the extension loads the video's own page for its data, so the note no longer fills with view-counter digits and "…more" buttons.
- Eagle items and Downloads files from YouTube and Pinterest are named after the video or pin title (no more maxresdefault.jpg). Folder names keep non-Latin author names.
- Downloads keep their folder and names when another extension (a download manager, for example) also listens to Chrome's download naming: the extension restates its own names. Chrome gives the last-installed extension the final say; when that is the other extension, the popup now says so and how to fix it.
- If Chrome rejects a title as a file name, the file is saved under a Latin-only name instead of failing.
- Save to Downloads uses one flat folder, Downloads/Local Social Archive, instead of a subfolder per post. A post's files share a base name: the video or pin title, or platform, author, and local time ("Instagram studio 2026-11-02 14-20 01.jpg"), and the note is "<same name>.txt" instead of post.txt.

## 0.2.3 — Unreleased

- Save to Downloads reports back within about 3 seconds instead of waiting for every file to finish; large videos keep downloading in Chrome. Expired links are still reported as failed.
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
