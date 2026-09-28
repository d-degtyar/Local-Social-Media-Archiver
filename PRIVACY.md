# Privacy Policy

_Last updated: 2026-09-28_

Local Social Media Archiver (the Chrome extension and the Eagle Companion plugin) does not collect, store, sell, or transmit personal data to the developer or to any third party.

## What the extension accesses

When you click **Save to Eagle** or **Save to Downloads**, the extension reads the post in the tab you are viewing: its media URLs, caption, author name, and page URL. This happens only after your click and only in that tab.

## Where that data goes

- **Save to Eagle** sends the media URLs and post details to the Eagle app on your own computer through its local API (`http://localhost:41595`). Nothing leaves your computer except the media downloads themselves.
- **Save to Downloads** saves the media files and a `post.json` file to your Downloads folder.
- Media files are downloaded directly from the website that serves them (for example Instagram's or LinkedIn's media servers), using your existing browser session, as when you view them.

## What is not done

- No analytics, tracking, advertising, or telemetry.
- No account, no developer server, no cloud processing.
- Cookies and browsing history are not read or sent anywhere.
- Nothing is kept by the extension between uses.

## "I feel lucky"

This optional mode asks Chrome for permission to access the one site open in your tab. You can revoke it at any time in `chrome://extensions`.

## Contact

Questions: open an issue at https://github.com/d-degtyar/Local-Social-Media-Archiver/issues
