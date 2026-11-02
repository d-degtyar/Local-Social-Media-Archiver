# Telegram Sorter (Eagle plugin)

Walk through an exported Telegram channel post by post and decide where each one goes: media to Eagle, links and notes to Karakeep, or the Trash. Nothing is sent until you press a button.

Made for your own channels used as a scrapbook. It reads a Telegram Desktop export, so it never signs in to Telegram and never changes the channel.

## Export a channel

1. In **Telegram Desktop**, open the channel → ⋮ → **Export chat history**.
2. Tick **Photos**, **Videos** and **Files** (add **Video messages** or **GIFs** if you want them); set **Format** to **Machine-readable JSON**.
3. Export. You get a folder with `result.json` and the media folders.

## Sort

1. In Eagle, open **Telegram Sorter** and click **Open export…**. Pick the exported folder.
2. For each post:

| Key | Action |
|---|---|
| `E` | **Eagle**: every photo, video and file of the post, into a folder named `Telegram · <channel>`. The post text is the note, hashtags become tags, and the item links to the post (or the first link in it). |
| `K` | **Karakeep**: each link in the post becomes a bookmark with the post text as its note; a post without links becomes a text note. Same tags. |
| `Del` | **Trash**: hides the post here. Restore it from the Trash tab. |
| `Space` / `→` | Next unsorted post |
| `←` | Previous post (including ones already sorted) |

One post can go to both Eagle and Karakeep. Keys work in any keyboard layout.

**Edit before sending.** The title, text, tags and links on the card are editable: remove text you do not want, drop tags (including the default `telegram` and channel tags) or add your own, and switch off links that should not go to Karakeep. Edits save as you type and are what gets sent; **Reset edits** brings back the exported post. Press `Esc` to leave a field so the single-key shortcuts work again.

3. Progress is saved in `telegram-sorter-state.json` inside the export folder after every action, so you can stop and continue later. A post is never sent to the same app twice.

**Trash does not delete anything in Telegram.** The Trash tab can copy the `t.me/c/…` links of trashed posts, so you can open each one and delete it in Telegram yourself.

## Karakeep

Open **⚙ Settings**, enter your Karakeep address (for example `http://192.168.1.10:3000`) and an API key from Karakeep → Settings → API Keys, then **Test Karakeep**. Tick "Allow a self-signed HTTPS certificate" if your NAS uses one.

The theme follows Eagle (light or dark) unless you pick one in Settings.

Settings are stored only on this computer, in `.eagle-telegram-sorter.json` in your user folder (the API key in plain text).

## Install for development

In Eagle: Plugins → Developer options → Import local project, and select this folder.
