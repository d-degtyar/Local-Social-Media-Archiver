# Privacy Policy

_Last updated: 2026-11-19_

Local Social Media Archiver (the Chrome extension and the Eagle Companion plugin) does not collect, store, sell, or transmit personal data to the developer or to any third party.

## What the extension accesses

When you click **Save to Eagle** or **Save to Downloads**, the extension reads the post in the tab you are viewing: its media URLs, caption, author name, and page URL. This happens only after your click and only in that tab.

## Where that data goes

- **Save to Eagle** sends the media URLs and post details to the Eagle app on your own computer through its local API (`http://localhost:41595`). Nothing leaves your computer except the media downloads themselves.
- **Save to Downloads** saves the media files and a `.txt` note (author, post link, caption) to the Local Social Archive folder in your Downloads.
- On Threads, when you reached a post by clicking inside the site, the extension may open that post in a background tab for a second or two to read its data, then closes it. This is an ordinary visit to the same Threads page with your browser session; nothing is sent anywhere else.
- On X, videos are fetched through X's public embed service (`cdn.syndication.twimg.com`), the same service that shows X posts embedded on other websites. Only the post's id is sent. Chrome asks for this access the first time you save from X, and photos still save if you decline.
- On Vimeo, the extension asks Vimeo for the files the video's owner allows to download, the same way the page's Download button does: from the video page, with your signed-in session, through `api.vimeo.com`. If that gives nothing, it reads the player settings from `player.vimeo.com` (Chrome asks for this access the first time you save from Vimeo). Without the owner's permission to download, only the cover is saved.
- Media files are downloaded directly from the website that serves them (for example Instagram's or LinkedIn's media servers), using your existing browser session, as when you view them.

## What is not done

- No analytics, tracking, advertising, or telemetry.
- No account, no developer server, no cloud processing.
- Cookies and browsing history are not read or sent anywhere.
- Between uses the extension keeps, in your browser's local storage only: its settings (whether explanations and Stack posts are on), and the addresses of posts you saved with the time and destination, so a keyboard-shortcut or right-click save can warn before saving the same post twice. This list never leaves your computer, holds at most 5,000 entries, and is deleted when you remove the extension.

## "I feel lucky"

This optional mode asks Chrome for permission to access the one site open in your tab. You can revoke it at any time in `chrome://extensions`.

## Contact

Questions: open an issue at https://github.com/d-degtyar/Local-Social-Media-Archiver/issues
