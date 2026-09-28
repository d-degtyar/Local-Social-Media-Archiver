# Chrome Web Store submission

Copy-paste answers for the Developer Dashboard. Images are in [`docs/store/`](store/).

## Package

Upload `local-social-media-archiver-chrome.zip` from the latest GitHub release, or build it locally:

```sh
cd chrome-extension && zip -r ../local-social-media-archiver-chrome.zip .
```

The zip must contain `manifest.json` at its root, not inside a folder.

## Store listing

**Name:** Local Social Media Archiver (from `manifest.json`)

**Summary (max 132 characters, from `manifest.json`):**
Save media from Instagram, Threads, LinkedIn, and Reddit posts to Eagle or your Downloads folder.

**Description:**

> Save visual references in one click. Open a post, click the extension, and send its images, full carousels, and videos to your Eagle library or your Downloads folder.
>
> Every saved item keeps its context:
> • the original post link
> • the author as a tag
> • the caption as a note
>
> Supported:
> • Instagram posts, carousels (up to 20 items), and Reels
> • LinkedIn images, carousels, and videos
> • Threads posts
> • Reddit images, full galleries, and videos
> • "I feel lucky": try any other site, with permission requested only for that site
>
> Private by design. No account, no server, no analytics. The extension works with your existing browser session and talks to Eagle only through its local API on your computer.
>
> Built for designers, motion designers, and anyone who collects references. Free and open source:
> https://github.com/d-degtyar/Local-Social-Media-Archiver
>
> Eagle integration requires the Eagle app (eagle.cool) to be open. Without Eagle, use Save to Downloads.

**Category:** Tools. Workflow & Planning also fits.
**Language:** English

**Graphic assets:**
| Field | File |
|---|---|
| Store icon (128×128) | `chrome-extension/assets/icons/icon-128.png` |
| Screenshot (1280×800) | `docs/store/screenshot-1280x800.png` |
| Small promo tile (440×280) | `docs/store/promo-tile-440x280.png` |

Up to 5 screenshots are allowed. Real captures of saving an Instagram carousel and of the result in Eagle work best as screenshots 2 and 3.

**Homepage URL:** https://github.com/d-degtyar/Local-Social-Media-Archiver
**Support URL:** https://github.com/d-degtyar/Local-Social-Media-Archiver/issues

## Privacy practices tab

**Single purpose:**
Save the media from the post in the current tab (images, carousels, videos, and caption) to the user's local Eagle library or Downloads folder.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `activeTab` | Reads the post in the tab where the user clicked the extension, only after that click. |
| `scripting` | Injects the media collector script into that tab to find the post's images, videos, and caption. |
| `downloads` | Saves the media files and a `post.json` metadata file to the user's Downloads folder when they choose Save to Downloads. |
| Host permissions (instagram.com, threads.com/net, linkedin.com, reddit.com) | Reads post pages on the supported sites so the collector can find every carousel item and the post's video source. |
| Host permissions (cdninstagram.com, fbcdn.net, licdn.com, redd.it) | Downloads the media files from the sites' own media servers with the user's existing session. |
| Host permission (localhost:41595) | Sends the saved items to the Eagle desktop app's local API on the user's own computer. Nothing is sent over the internet. |
| Optional host permissions (`http://*/*`, `https://*/*`) | Requested at runtime for a single site only, when the user turns on "I feel lucky" to save media from a site that is not supported by default. |

**Remote code:** No, I am not using remote code. All scripts are included in the package.

**Data usage:** Tick nothing in the list of collected data. The extension does not send user data to the developer or third parties; post content goes only to the local Eagle app or the Downloads folder. Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/d-degtyar/Local-Social-Media-Archiver/blob/main/PRIVACY.md
(It only works after this branch is merged into `main`.)

## After approval

1. Put the store URL into `chromeWebStoreUrl` in `eagle-companion/js/config.js`. The companion then shows a single install button in place of the Load unpacked steps.
2. Add the store link to the Quick start section in `README.md`.
