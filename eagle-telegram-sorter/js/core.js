// Reads a Telegram Desktop export (result.json) and turns it into posts that
// can be sent to Eagle or Karakeep. No UI and no I/O here, so it runs both in
// the Eagle plugin and in Node for tests.
(function (root) {
  // Not useful as references or reading material.
  const SKIPPED_MEDIA = new Set(['sticker', 'voice_message', 'audio_file']);
  const VIDEO_MEDIA = new Set(['video_file', 'animation', 'video_message']);

  // A single-channel export is the chat itself; a full-account export lists
  // chats under chats.list.
  function readChats(json) {
    if (Array.isArray(json?.messages)) return [json];
    return (json?.chats?.list || []).filter(chat => Array.isArray(chat.messages));
  }

  function entitiesOf(message) {
    if (Array.isArray(message.text_entities)) return message.text_entities;
    if (typeof message.text === 'string') return [{ type: 'plain', text: message.text }];
    return (message.text || []).map(part => typeof part === 'string' ? { type: 'plain', text: part } : part);
  }

  function plainText(entities) {
    return entities.map(entity => entity.text || '').join('').trim();
  }

  function linksOf(entities) {
    const links = entities.flatMap(entity => {
      if (entity.type === 'link') return [/^https?:\/\//i.test(entity.text) ? entity.text : `https://${entity.text}`];
      if (entity.type === 'text_link' && entity.href) return [entity.href];
      return [];
    });
    return [...new Set(links.filter(link => /^https?:\/\//i.test(link)))];
  }

  function hashtagsOf(entities) {
    return [...new Set(entities.filter(entity => entity.type === 'hashtag')
      .map(entity => entity.text.replace(/^#/, '')).filter(Boolean))];
  }

  // Telegram writes "(File not included. Change data exporting settings to
  // download.)" in place of a path when a file was left out of the export.
  const isMissing = value => typeof value === 'string' && value.startsWith('(');

  function mediaOf(message) {
    const media = [];
    let missing = 0;
    if (message.photo) {
      if (isMissing(message.photo)) missing++;
      else media.push({ path: message.photo, kind: 'image' });
    }
    if (message.file && !SKIPPED_MEDIA.has(message.media_type)) {
      if (isMissing(message.file)) missing++;
      else {
        const mime = message.mime_type || '';
        const kind = VIDEO_MEDIA.has(message.media_type) || mime.startsWith('video/') ? 'video'
          : mime.startsWith('image/') ? 'image' : 'file';
        media.push({ path: message.file, kind, name: message.file_name || '' });
      }
    }
    return { media, missing };
  }

  // An album arrives as several messages sent in the same second; the caption
  // sits on one of them. Merge them back into one post.
  function isSameAlbum(post, message) {
    const last = post.messages[post.messages.length - 1];
    return Math.abs(Number(message.date_unixtime) - Number(last.date_unixtime)) <= 1
      && message.from_id === last.from_id
      && (Boolean(message.photo || message.file)) && post.media.length > 0
      && (!plainText(entitiesOf(message)) || !post.text);
  }

  function buildPosts(chat) {
    const posts = [];
    for (const message of chat.messages || []) {
      if (message.type !== 'message') continue;
      const entities = entitiesOf(message);
      const { media, missing } = mediaOf(message);
      const text = plainText(entities);
      const previous = posts[posts.length - 1];
      if (previous && isSameAlbum(previous, message)) {
        previous.messages.push(message);
        previous.ids.push(message.id);
        previous.media.push(...media);
        previous.missing += missing;
        if (text) previous.text = text;
        previous.links = [...new Set([...previous.links, ...linksOf(entities)])];
        previous.hashtags = [...new Set([...previous.hashtags, ...hashtagsOf(entities)])];
        continue;
      }
      if (!text && !media.length && !missing) continue;
      posts.push({
        key: String(message.id),
        ids: [message.id],
        messages: [message],
        date: message.date,
        unix: Number(message.date_unixtime) || Date.parse(message.date) / 1000,
        author: message.from || chat.name || '',
        forwardedFrom: message.forwarded_from || '',
        text,
        links: linksOf(entities),
        hashtags: hashtagsOf(entities),
        media,
        missing
      });
    }
    return posts;
  }

  // Private channels have no public address; t.me/c/<id>/<post> opens the
  // post in Telegram for members.
  function postLink(chat, post) {
    const id = String(chat.id || '').replace(/^-100/, '');
    return id ? `https://t.me/c/${id}/${post.ids[0]}` : '';
  }

  function formatDate(post) {
    return new Date(post.unix * 1000).toISOString().slice(0, 10);
  }

  function defaultTags(chat, post) {
    return [...new Set(['telegram', chat.name, ...post.hashtags].filter(Boolean))];
  }

  // The post as the user edited it: title, text, tags and which links to keep.
  // Anything not edited keeps the value from the export.
  function edited(chat, post, edits = {}) {
    const text = typeof edits.text === 'string' ? edits.text.trim() : post.text;
    const removed = new Set(edits.removedLinks || []);
    return {
      ...post,
      text,
      title: typeof edits.title === 'string' && edits.title.trim() ? edits.title.trim().slice(0, 200) : firstLine(text),
      titleEdited: typeof edits.title === 'string' && Boolean(edits.title.trim()),
      tags: Array.isArray(edits.tags) ? [...new Set(edits.tags.map(tag => String(tag).trim()).filter(Boolean))] : defaultTags(chat, post),
      links: post.links.filter(link => !removed.has(link))
    };
  }
  const tagsFor = (chat, post) => post.tags || defaultTags(chat, post);

  function noteFor(chat, post) {
    return [
      post.text,
      post.forwardedFrom && `Forwarded from: ${post.forwardedFrom}`,
      `Telegram: ${postLink(chat, post) || chat.name} (${formatDate(post)})`
    ].filter(Boolean).join('\n\n');
  }

  // Hashtags become tags, so leave them out of titles.
  function firstLine(text) {
    const line = text.split('\n').map(part => part.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, ' ').replace(/\s+/g, ' ').trim()).find(Boolean) || '';
    return line.slice(0, 120);
  }

  // One Eagle item per media file. join() builds the absolute path.
  function eagleItems(chat, post, join) {
    const title = post.title || firstLine(post.text) || `${chat.name} ${formatDate(post)}`;
    const annotation = [noteFor(chat, post), ...post.links].join('\n').slice(0, 15000);
    return post.media.map((item, index) => ({
      path: join(item.path),
      name: post.media.length > 1 ? `${title} ${String(index + 1).padStart(2, '0')}` : title,
      website: post.links[0] || postLink(chat, post),
      tags: tagsFor(chat, post),
      annotation
    }));
  }

  // One Karakeep link bookmark per link; a post without links becomes a note.
  function karakeepBookmarks(chat, post) {
    const createdAt = new Date(post.unix * 1000).toISOString();
    const note = noteFor(chat, post);
    if (post.links.length) {
      return post.links.map(url => ({ body: { type: 'link', url, note, ...(post.titleEdited ? { title: post.title } : {}), createdAt }, tags: tagsFor(chat, post) }));
    }
    if (!post.text) return [];
    return [{ body: { type: 'text', text: note, title: post.title || firstLine(post.text), createdAt }, tags: tagsFor(chat, post) }];
  }

  const api = { readChats, buildPosts, postLink, eagleItems, karakeepBookmarks, firstLine, formatDate, defaultTags, edited };
  // Always publish to the page: Eagle plugin pages also define a Node-style
  // `module`, so an either/or check would hide the API from app.js.
  root.TelegramSorterCore = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
