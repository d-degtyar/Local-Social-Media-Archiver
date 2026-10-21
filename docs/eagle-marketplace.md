# Eagle Plugin Center listing

Copy for the submission form. Keep it in sync with the companion UI (`eagle-companion/`) and the featured image.

Review history: 0.2.2 was rejected because the listing did not say that saving needs Chrome and a separately installed extension, and the cover promised "any post". 0.2.3 addresses both.

**Name:** Local Social Media Archiver (27 characters; limit is 30 characters / 6 words)

**Keywords (max 6):** social media, instagram, linkedin, reddit, reference, browser

**Description:**
Set up the Local Social Media Archiver Chrome extension and check Eagle's local connection. Media saving requires Chrome and a separately installed extension.

**Introduction:**

This is the Eagle companion plugin for Local Social Media Archiver. It provides a Chrome Web Store link for the extension, a GitHub project link, and a local Eagle connection test. Media saving is handled by a separate, free Chrome extension, which is not included in this plugin package.

Get started:

1. Have Chrome installed. Open this plugin and click "Add to Chrome — free" to visit the Chrome Web Store. Install the extension and pin it to your toolbar.
2. Keep Eagle running and click "Test Eagle connection". This test only checks whether Eagle's local API is reachable.
3. In Chrome, open a post on a supported site, click the extension icon, and choose "Save to Eagle". Keep Eagle running while saving to Eagle.

What the Chrome extension saves:
- Instagram: posts, carousels (up to 20 items), Reels, and Stories
- LinkedIn: images, carousels, and videos
- Threads: post images and videos
- Reddit: images, galleries, and videos (Reddit serves video and audio separately, so saved Reddit videos have no sound)

Each item imported into Eagle keeps the original post link, the platform and author as tags, and the caption as a note. The extension also offers "Save to Downloads", which saves the files and a post.txt note to your Downloads folder.

"I feel lucky" is an experimental option for other websites. It asks permission for one site at a time and may not find media on every page.

Privacy: no account and no developer server. The extension sends items only to Eagle's local API on your computer (localhost:41595); media files are downloaded from the sites that host them.

Project and help: https://github.com/d-degtyar/Local-Social-Media-Archiver
Chrome extension: https://chromewebstore.google.com/detail/local-social-media-archiv/hbjcghkjdbmphmbgkjkhncmihcbhenjj

**Support contact:** https://github.com/d-degtyar/Local-Social-Media-Archiver/issues

**Support the project:** https://www.patreon.com/c/d_degtyar

**Featured image:** `docs/store/eagle-featured-1800x1200.png` (minimum is 1560 × 1040)

**Change Log (0.2.3):**
- Clearer setup: the plugin now states that saving media requires Chrome and the separately installed Local Social Media Archiver extension.
- The connection test reports only whether Eagle's local API is reachable.
- Updated store description and cover to list the supported sites.

**Screenshots:**
1. The companion window (`docs/store/eagle-companion.png`, `docs/store/eagle-companion-dark.png`).
2. The Chrome popup (`docs/store/screenshot-1280x800.png`).
3. Imported items in Eagle, showing tags, the note, and the source link (capture from Eagle).
