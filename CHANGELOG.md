# Changelog

## 0.2.7 — Unreleased

- Save without opening the popup: keyboard shortcuts Alt+Shift+S (to Eagle) and Alt+Shift+D (to Downloads), changeable in chrome://extensions/shortcuts, and "Save post to Eagle / to Downloads" in the right-click menu on pages, images, videos and links.
- Shortcut and menu saves use the popup's Stack posts setting and work on any site through the same access a popup click gives (activeTab), so unsupported sites are tried without a permission prompt.
- The result appears as a short notice in the corner of the page and on the toolbar badge (✓ or !, with the message as the icon's tooltip).
- The popup's help (?) shows the current keys and a link to change them.
- Repeat warning for shortcut and menu saves: a post already saved to the same place (Eagle or Downloads) shows "Already saved … today at 14:20" instead; the same key or menu item again within 15 seconds saves it anyway. Popup buttons never ask, so deliberate retries stay one click. The extension remembers saved post addresses locally (up to 5,000) for this.
- The repeat warning follows the post, not the page address: Threads posts are keyed by their /@user/post/code link, and a Threads save that got only a video's cover is not recorded as saved, so saving again is not met by the warning.
- Right-click a post in a feed to save that post without opening it (Threads feeds and profiles, Pinterest home, boards and search): the menu passes the image, video or link that was clicked, and the collector saves the post it belongs to. Without it, saving from a feed says to right-click the post or open it.
- Pinterest: carousel pins whose slides are videos save the videos (the 720p MP4 of each slide), not their cover images.
- Open tabs keep working after an update: the collector replaces the listener of an earlier injection instead of skipping itself when it finds one, so a copy left over from the previous version no longer blocks saving until the page is reloaded.
- When the collector itself fails on a page, the popup and the page notice say so ("Could not read this page: …") instead of "No media found".
- Repeat warning: on sites other than the supported ones, the address keeps its query (minus tracking parameters), so viewtopic.php?t=1 and ?t=2 are different posts. Saves finishing together in two tabs no longer overwrite each other's record.
- Threads: the background tab opens in the same window as the post.
- Test mode for development: an unpacked install opened as popup.html?test saves from the tab used just before it and can run the shortcut and menu path, so browser automation can test saves end to end. Store installs ignore it.
- New permissions: contextMenus (the right-click items) and storage (keeps the Stack posts setting and the list of saved post addresses, locally). Neither adds an install warning.

## 0.2.6 — Published on the Chrome Web Store (bug fixes only)

- Threads photos save at the largest size the page offers: when the page describes a post more than once (a 640px preview and the full post) or its images list bigger sizes in srcset, every photo takes its largest version, matched by media id or by the CDN file name. Instagram posts benefit the same way.
- YouTube covers no longer drop to 640×480 on slow connections: the video's own data names its HD cover when there is one, and otherwise all sizes are checked at once with a 20-second limit instead of 4 seconds each.
- Instagram: after moving around the site without a reload, the page data can hold a post only as a 640–720 px preview; when its photos are smaller than their originals, the full-size post is read from Instagram's API instead.
- Threads: saves the open post, not an earlier one or a feed item, with its videos. After moving inside Threads (from the feed, a profile, search) the document holds no data for the open post, and Threads sends a post's full data (every slide, the video files) only to a real page load: a script's request for the same address gets the cover alone. The extension then opens the post in a muted background tab next to the current one for a second or two, reads the data once that page has finished loading, and closes it. The page-wide image fallback is gone: only the block linking to the post's code counts as the post (Threads keeps earlier pages and the feed in the document), and the video fallback takes only video loaded after the post's cover appeared, the most recent first. Videos are checked per carousel slide. When a video still cannot be found, the cover is saved with a note listing what each source answered.

## 0.2.5 — Published on the Chrome Web Store

- Popup opens compact for new users; ? shows the explanations.
- LinkedIn: videos save as video, not as their poster frame. /feed/update/urn:li:activity:… links now use the post's embed page, and the MP4 comes from the player's data-sources or the page's progressiveStreams data, so the video need not have been played.
- Threads: when a page describes a post more than once (a preview with only the cover, and the full post), the richest one is used, so videos are no longer saved as their cover; a video post without a listed file falls back to the player's own source.
- Vimeo: the player config is read from the video page itself, with Vimeo's cookies and referrer, as the player does (Vimeo refused it from the background with 403); the signed config URL in the page is used when present. A 403 that remains means the files are private or embed-only.
- Threads: share links (threads.com/share/…) find the post through the page's canonical address, so their videos save as video.
- Vimeo: the video comes from the same list as the page's Download button: the video's `download` field in Vimeo's API, read with the short-lived token Vimeo gives the signed-in viewer (the files the owner allows; the largest rendition, the original upload only when it is the only one). Older pages' download config and an open Download dialog are fallbacks; when all fail, the popup lists which step refused.
- Threads: when the page data has only a video post's cover, the file is taken from the post's player or from what the page already downloaded; if the video was never played, the popup suggests playing it for a second and saving again.
- Vimeo: when the video is saved, it replaces the cover instead of sitting next to it; the cover is saved only when the video cannot be.
- YouTube and Vimeo covers are named "<title> (cover)" in Eagle, so Eagle no longer offers to replace an already saved video with its cover.
- Stacks: the very first stacked post no longer lands outside Social Stacks when Eagle's folder-create answer carries no id.
- Stacks guide matches Eagle's wording: New Smart Folder, rule Tags · Any · Main Cover, and the Folders section of the right-hand panel.
- Compact popup: two save buttons and two toggles. The ? button turns on explanations (a caption under each control, the supported sites, privacy note and support links); it is on for new users and remembered once turned off.
- What's new: after an update the toolbar icon shows NEW and the popup lists the version's highlights until dismissed.
- Vimeo: videos save as reference cards like YouTube (largest cover, title, author, description, link). The MP4 is added when the owner allows downloads (the page's Download button or the player config) and Vimeo serves a progressive file; otherwise the popup says why only the card was saved.
- X: photo-only posts save again. The open post is found by its timestamp link, by X's focus marker, or by its photo links, so replies in threads and posts without a timestamp link work; photos painted only as a background image (behind content warnings) are found too. The embed service is read for photos as well, and when nothing is found the popup says why.
- Stack posts in Eagle: an option in the popup. Posts with several files go into their own folder under "Social Stacks" and the first file is tagged "Main Cover"; single files get the tag without a folder. A smart folder filtered by that tag shows one tile per post.
- Stacks guide: a page with a diagram and three steps (turn on, create the "Stacks" smart folder with a copy-the-tag button, browse), plus tips on search and extra feeds. It opens the first time stacks are turned on and from "How stacks work" in the popup.

## Telegram Sorter

- Moved to its own repository, with its history: [d-degtyar/eagle-telegram-sorter](https://github.com/d-degtyar/eagle-telegram-sorter).

## 0.2.4 — Shipped in 0.2.5

- YouTube videos and Shorts save as references: the cover image at the highest available size (maxres, then SD, then HQ), with the title, channel, description, and link. The video itself is not downloaded, in line with YouTube's terms and Chrome Web Store policy.
- YouTube description is the uploader's text, not the rendered page: after navigating inside YouTube the extension loads the video's own page for its data, so the note no longer fills with view-counter digits and "…more" buttons.
- Eagle items and Downloads files from YouTube and Pinterest are named after the video or pin title (no more maxresdefault.jpg). Folder names keep non-Latin author names.
- Downloads keep their folder and names when another extension (a download manager, for example) also listens to Chrome's download naming: the extension restates its own names. Chrome gives the last-installed extension the final say; when that is the other extension, the popup now says so and how to fix it.
- If Chrome rejects a title as a file name, the file is saved under a Latin-only name instead of failing.
- Save to Downloads uses one flat folder, Downloads/Local Social Archive, instead of a subfolder per post. A post's files share a base name: the video or pin title, or platform, author, and local time ("Instagram studio 2026-11-02 14-20 01.jpg"), and the note is "<same name>.txt" instead of post.txt.

## 0.2.3 — Shipped in 0.2.5

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
