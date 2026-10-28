(() => {
  if (globalThis.__localSocialMediaCollectorInstalled) return;
  globalThis.__localSocialMediaCollectorInstalled = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'COLLECT_POST') return;
    collectPost().then(sendResponse)
      .catch(error => sendResponse({ error: error.message, media: [] }));
    return true;
  });

  async function collectPost() {
    const platform = platformName(location.hostname);
    if (platform === 'pinterest') return collectPinterestPin();
    if (platform === 'x') return collectXPost();
    const root = findPostRoot(platform);
    // Deliberately collect only elements rendered inside the post. A previous
    // performance-resource fallback also picked up feed previews and avatars.
    // Instagram carousels allow up to 20 items. This hard cap is also a safety
    // net if a platform changes its markup and the root becomes a feed.
    const instagramPost = platform === 'instagram' ? instagramPostData() || await fetchInstagramMedia() : null;
    const instagramMedia = instagramPost ? mediaFromInstagramNode(instagramPost) : [];
    const domMedia = collectMedia(root);
    const linkedInEmbed = platform === 'linkedin' ? await collectLinkedInEmbed() : null;
    const redditPost = platform === 'reddit' ? await collectRedditPost() : null;
    // Threads streams video to its player as blob: data, so the page's own
    // post JSON (the Instagram media format) is the only source of the MP4.
    const threadsPost = platform === 'threads' ? threadsPostData() : null;
    const threadsMedia = threadsPost ? mediaFromInstagramNode(threadsPost) : [];
    // Do not add a network fallback when the structured Instagram data already
    // supplied a video: it is commonly a byte-range copy of the same Reel.
    const reelFallback = platform === 'instagram' && isInstagramReel() && !instagramMedia.some(item => item.kind === 'video')
      ? observedInstagramVideo()
      : [];
    const linkedInVideo = platform === 'linkedin' && !(linkedInEmbed?.media || domMedia).some(item => item.kind === 'video')
      ? observedLinkedInVideo()
      : [];
    // Parsed post data is first because it contains every carousel item, not
    // merely the two slides currently rendered by Instagram.
    // Instagram is a single-page app and can retain recommendation cards from
    // an earlier Reel after navigation. Never use those DOM cards as a fallback:
    // only JSON matched to the shortcode in the current URL is trustworthy.
    const primaryMedia = platform === 'instagram'
      ? instagramMedia
      : linkedInEmbed?.media?.length
        ? linkedInEmbed.media
        : redditPost?.media?.length
          ? redditPost.media
          : threadsMedia.length
            ? threadsMedia
            : domMedia;
    let merged = dedupe([...primaryMedia, ...reelFallback, ...linkedInVideo]);
    // LinkedIn renders a poster frame as an <img> next to every video. It is
    // useful in the page UI but not a separate post asset for the archive.
    if (platform === 'linkedin' && merged.some(item => item.kind === 'video')) {
      merged = merged.filter(item => item.kind === 'video');
    }
    merged = merged.slice(0, MAX_MEDIA);
    return {
      platform,
      url: location.href,
      title: redditPost?.title || document.querySelector('meta[property="og:title"]')?.content || document.title,
      author: platform === 'instagram' || threadsPost
        ? instagramAuthor(instagramPost || threadsPost)
        : linkedInEmbed?.author || redditPost?.author || authorFrom(root, platform),
      text: platform === 'instagram' || threadsPost
        ? instagramCaption(instagramPost || threadsPost)
        : (linkedInEmbed?.text || redditPost?.text || root?.innerText || document.body.innerText).trim().slice(0, 12000),
      media: merged,
      // blob: and MediaSource streams cannot be downloaded by URL. Report them
      // so the popup can explain why a visible video was not saved.
      streamedVideo: !merged.some(item => item.kind === 'video') && hasStreamedVideo(root)
    };
  }

  const MAX_MEDIA = 20;

  function platformName(host) {
    // Exact hosts for X: a substring test for "x.com" would match netflix.com.
    if (['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(host)) return 'x';
    if (/(^|\.)pinterest\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host)) return 'pinterest';
    if (host.includes('instagram')) return 'instagram';
    if (host.includes('threads')) return 'threads';
    if (host.includes('reddit')) return 'reddit';
    if (host.includes('linkedin')) return 'linkedin';
    return 'web';
  }
  function findPostRoot(platform) {
    if (platform === 'instagram') return document.querySelector('[role="dialog"] article, article');
    if (platform === 'threads') return document.querySelector('article') || document.querySelector('[data-pressable-container]');
    if (platform === 'reddit') return document.querySelector('shreddit-post') || document.querySelector('.Post') || document.querySelector('article') || document.querySelector('main');
    if (platform === 'web') return document.querySelector('article, [role="main"], main') || document.body;
    return document.querySelector('article:has(video), [data-urn*="activity"]:has(video), .feed-shared-update-v2:has(video)')
      || document.querySelector('[data-urn*="activity"], [data-id*="urn:li:activity"], .feed-shared-update-v2')
      || document.querySelector('main');
  }
  function collectMedia(root) {
    const scope = root || document;
    const images = [...scope.querySelectorAll('img')]
      .filter(image => isPostImage(image, root))
      .map(image => ({ url: imageUrl(image), kind: 'image' }));
    const videos = [...scope.querySelectorAll('video')]
      .map(video => ({ url: video.currentSrc || video.src || video.querySelector('source')?.src, kind: 'video' }))
      .filter(item => /^https?:/i.test(item.url || ''));
    const shadowVideos = [...scope.querySelectorAll('shreddit-player')]
      .map(player => {
        const video = player.shadowRoot?.querySelector('video');
        const url = video?.currentSrc || video?.src || video?.querySelector('source')?.src || player.getAttribute('src');
        return { url, kind: 'video' };
      })
      .filter(item => /^https?:/i.test(item.url || ''));
    return [...images, ...videos, ...shadowVideos];
  }

  async function collectLinkedInEmbed() {
    if (location.pathname.startsWith('/embed/feed/update/')) return null;
    const match = location.pathname.match(/(?:ugcPost|activity)-(\d+)/);
    if (!match) return null;
    const urnKind = location.pathname.includes('ugcPost-') ? 'ugcPost' : 'activity';
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.linkedin.com/embed/feed/update/urn:li:${urnKind}:${match[1]}?compact=1`;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px;';
    document.documentElement.append(iframe);
    try {
      await Promise.race([
        new Promise(resolve => iframe.addEventListener('load', resolve, { once: true })),
        wait(5000)
      ]);
      // Let LinkedIn hydrate lazy images/video after its document load event.
      await wait(1000);
      const frameDocument = iframe.contentDocument;
      if (!frameDocument) return null;
      const frameRoot = frameDocument.querySelector('article, main, body');
      const media = collectMedia(frameRoot);
      const video = [...frameDocument.querySelectorAll('video')]
        .map(item => item.currentSrc || item.src || item.querySelector('source')?.src || '')
        .find(url => /^https?:/i.test(url));
      if (video) media.push({ url: video, kind: 'video' });
      return {
        media: dedupe(media),
        author: authorFrom(frameRoot, 'linkedin'),
        text: (frameRoot?.innerText || '').trim().slice(0, 12000)
      };
    } catch { return null; }
    finally { iframe.remove(); }
  }
  function wait(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }

  function instagramPostData() {
    const shortcode = instagramShortcode();
    if (!shortcode) return null;
    return postFromPageJson(shortcode);
  }
  function postFromPageJson(shortcode) {
    const scripts = [...document.querySelectorAll('script[type="application/json"], script:not([src])')];
    for (const script of scripts) {
      const text = script.textContent || '';
      // Threads keeps whole feeds in one script, so allow large ones.
      if (!text.includes(shortcode) || text.length > 20_000_000) continue;
      try {
        const post = findInstagramPost(JSON.parse(text), shortcode);
        if (post) return post;
      } catch { /* Not every inline script contains JSON. */ }
    }
    return null;
  }
  // Posts opened from the feed or a profile are loaded by XHR, so their data is
  // not in the page's inline JSON; Stories never are. Ask the same web API the
  // Instagram site uses, with the user's session, for the media in the URL.
  async function fetchInstagramMedia() {
    const mediaId = instagramStoryId() || instagramMediaId(instagramShortcode());
    if (!mediaId) return null;
    try {
      const response = await fetch(`/api/v1/media/${mediaId}/info/`, {
        credentials: 'include',
        headers: { 'X-IG-App-ID': instagramAppId(), 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload?.items?.[0] || null;
    } catch { return null; }
  }
  function instagramStoryId() {
    // /stories/<username>/<media id>/. Highlights use a highlight id instead.
    const match = location.pathname.match(/^\/stories\/([^/]+)\/(\d+)/);
    return match && match[1] !== 'highlights' ? match[2] : '';
  }
  function instagramMediaId(shortcode) {
    // A shortcode is the media id in URL-safe base64. Private posts append
    // extra characters after the first 11.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    if (!shortcode) return '';
    let id = 0n;
    for (const character of shortcode.slice(0, 11)) {
      const value = alphabet.indexOf(character);
      if (value < 0) return '';
      id = id * 64n + BigInt(value);
    }
    return id.toString();
  }
  function instagramAppId() {
    const match = document.documentElement.innerHTML.match(/"(?:X-IG-App-ID|APP_ID)":"(\d{6,})"/);
    return match?.[1] || '936619743392459';
  }
  function threadsPostData() {
    // /@username/post/<code>; the code identifies the post like an Instagram shortcode.
    const code = (location.pathname.match(/\/post\/([A-Za-z0-9_-]+)/) || [])[1];
    return code ? postFromPageJson(code) : null;
  }
  function instagramShortcode() {
    const parts = location.pathname.split('/').filter(Boolean);
    const marker = parts.findIndex(part => ['p', 'reel', 'reels', 'tv'].includes(part));
    return marker >= 0 ? parts[marker + 1] || '' : '';
  }
  function isInstagramReel() {
    return location.pathname.split('/').filter(Boolean).some(part => ['reel', 'reels'].includes(part));
  }
  function findInstagramPost(value, shortcode, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 40) return null;
    if (Array.isArray(value)) {
      for (const item of value) { const found = findInstagramPost(item, shortcode, depth + 1); if (found) return found; }
      return null;
    }
    if (String(value.code || value.shortcode || '') === shortcode && (value.carousel_media || value.image_versions2 || value.video_versions)) return value;
    for (const child of Object.values(value)) { const found = findInstagramPost(child, shortcode, depth + 1); if (found) return found; }
    return null;
  }
  function mediaFromInstagramNode(post) {
    const nodes = Array.isArray(post.carousel_media) && post.carousel_media.length ? post.carousel_media : [post];
    return nodes.flatMap(node => {
      const image = bestInstagramVariant(node.image_versions2?.candidates);
      const video = bestInstagramVariant(node.video_versions);
      // Video posts often expose both a poster and a video. Keep only video.
      if (video) return [{ url: video.url, kind: 'video' }];
      return image ? [{ url: image.url, kind: 'image' }] : [];
    });
  }
  function instagramCaption(post) {
    if (!post) return '';
    const edgeCaption = post.edge_media_to_caption?.edges?.[0]?.node?.text;
    return String(post.caption?.text || post.caption_text || edgeCaption || '').trim().slice(0, 12000);
  }
  function instagramAuthor(post) {
    return String(post?.user?.username || post?.owner?.username || '').trim().slice(0, 80);
  }
  function bestInstagramVariant(variants) {
    if (!Array.isArray(variants)) return null;
    return variants.filter(item => item && /^https?:/i.test(item.url || ''))
      .sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)))[0] || null;
  }
  function observedInstagramVideo() {
    const directVideo = [...document.querySelectorAll('video')]
      .map(video => video.currentSrc || video.src || '')
      .find(url => /^https?:/i.test(url));
    if (directVideo) return [{ url: directVideo, kind: 'video' }];
    const candidates = performance.getEntriesByType('resource')
      .filter(entry => /(?:cdninstagram|fbcdn|scontent)/i.test(entry.name))
      .filter(entry => /(?:\.mp4(?:\?|$)|mime_type=video|video)/i.test(entry.name))
      .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0));
    return candidates[0] ? [{ url: candidates[0].name, kind: 'video' }] : [];
  }
  function observedLinkedInVideo() {
    const directVideo = [...document.querySelectorAll('video')]
      .map(video => video.currentSrc || video.src || '')
      .find(url => /^https?:/i.test(url));
    if (directVideo) return [{ url: directVideo, kind: 'video' }];
    const candidates = performance.getEntriesByType('resource')
      .filter(entry => /(?:media|dms|video)\.licdn\.com/i.test(entry.name))
      .filter(entry => /(?:\.mp4(?:\?|$)|mime(?:Type|_type)=video|video)/i.test(entry.name))
      // Keep only complete, sizeable media requests—not tiny manifest segments.
      .filter(entry => (entry.transferSize || entry.encodedBodySize || 0) > 200_000)
      .sort((a, b) => (b.transferSize || b.encodedBodySize || 0) - (a.transferSize || a.encodedBodySize || 0));
    return candidates[0] ? [{ url: candidates[0].name, kind: 'video' }] : [];
  }
  // Reddit exposes every post as JSON at the same path. It lists all gallery
  // items (the DOM renders only nearby slides) and a progressive MP4 for video,
  // where the player itself only holds an undownloadable blob: stream.
  async function collectRedditPost() {
    if (!/\/comments\/[a-z0-9]+/i.test(location.pathname)) return null;
    try {
      const response = await fetch(`${location.origin}${location.pathname.replace(/\/+$/, '')}.json?raw_json=1`, { credentials: 'include' });
      if (!response.ok) return null;
      const listing = await response.json();
      const data = listing?.[0]?.data?.children?.[0]?.data;
      if (!data) return null;
      const source = data.crosspost_parent_list?.[0] || data;
      return {
        media: dedupe(redditMedia(source)),
        title: String(data.title || '').trim(),
        author: String(data.author || '').trim().slice(0, 80),
        text: [data.title, data.selftext].filter(Boolean).join('\n\n')
      };
    } catch { return null; }
  }
  function redditMedia(data) {
    const video = data.secure_media?.reddit_video || data.media?.reddit_video || data.preview?.reddit_video_preview;
    if (video?.fallback_url) return [{ url: video.fallback_url, kind: 'video' }];
    if (data.is_gallery && data.media_metadata) {
      const order = data.gallery_data?.items?.map(item => item.media_id) || Object.keys(data.media_metadata);
      return order.flatMap(id => {
        const item = data.media_metadata[id];
        if (!item || item.status !== 'valid') return [];
        if (item.e === 'AnimatedImage') return item.s?.mp4 ? [{ url: item.s.mp4, kind: 'video' }] : item.s?.gif ? [{ url: item.s.gif, kind: 'image' }] : [];
        return item.s?.u ? [{ url: item.s.u, kind: 'image' }] : [];
      });
    }
    const direct = data.url_overridden_by_dest || data.url || '';
    if (/^https:\/\/i\.redd\.it\//i.test(direct) || /\.(?:jpe?g|png|webp|gif)(?:\?|$)/i.test(direct)) return [{ url: direct, kind: 'image' }];
    const preview = data.preview?.images?.[0]?.source?.url;
    return preview ? [{ url: preview, kind: 'image' }] : [];
  }
  function hasStreamedVideo(root) {
    const scope = root || document;
    const players = [...scope.querySelectorAll('video'), ...[...scope.querySelectorAll('shreddit-player')].map(player => player.shadowRoot?.querySelector('video')).filter(Boolean)];
    return players.some(video => /^blob:/i.test(video.currentSrc || video.src || ''));
  }
  // Pinterest ---------------------------------------------------------------
  // Only the pin whose id is in the URL is saved. The close-up page also shows
  // related pins and promoted pins (ads) around it; matching by id keeps them
  // out, which DOM scraping of "the biggest image" could not guarantee.
  async function collectPinterestPin() {
    const pinId = pinterestPinId();
    const pin = pinId ? await fetchPinterestPin(pinId) || embeddedPinterestPin(pinId) : null;
    let media = pin ? pinterestMedia(pin) : [];
    if (!media.length) media = pinterestDomMedia();
    media = dedupe(media).slice(0, MAX_MEDIA);
    const link = String(pin?.link || pin?.tracked_link || '').trim();
    const title = String(pin?.title || pin?.grid_title || pin?.seo_title || '').trim();
    const spam = looksLikeSpam(link, title);
    const description = String(pin?.description || pin?.closeup_unified_description || '').trim();
    return {
      platform: 'pinterest',
      url: pinId ? `https://${location.hostname}/pin/${pinId}/` : location.href,
      title: title || document.title,
      headline: title,
      author: String(pin?.native_creator?.username || pin?.pinner?.username || pin?.origin_pinner?.username || '').slice(0, 80),
      text: [title, description].filter(Boolean).join('\n\n').slice(0, 12000),
      // The pin's outbound link: kept as the original source unless it points
      // at gambling or similar spam, which is common on reposted video pins.
      sourceUrl: link && !spam ? link : '',
      spamSource: spam,
      media,
      streamedVideo: !media.some(item => item.kind === 'video') && hasStreamedVideo(document)
    };
  }
  function pinterestPinId() {
    // /pin/123456/ and /pin/some-slug--123456/
    const match = location.pathname.match(/\/pin\/(?:[^/]*--)?([A-Za-z0-9_]+)/);
    return match ? match[1] : '';
  }
  async function fetchPinterestPin(pinId) {
    // The same resource endpoint the Pinterest web app calls, with the
    // user's session; it returns the full pin, including original sizes.
    const sourceUrl = `/pin/${pinId}/`;
    const data = JSON.stringify({ options: { id: pinId, field_set_key: 'detailed' }, context: {} });
    try {
      const response = await fetch(`/resource/PinResource/get/?source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(data)}`, {
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Pinterest-AppState': 'active',
          'X-Pinterest-Source-Url': sourceUrl,
          'X-Pinterest-PWS-Handler': 'www/pin/[id].js'
        }
      });
      if (!response.ok) return null;
      const payload = await response.json();
      const pin = payload?.resource_response?.data;
      return pin && String(pin.id) === pinId ? pin : null;
    } catch { return null; }
  }
  function embeddedPinterestPin(pinId) {
    const scripts = [...document.querySelectorAll('script#__PWS_DATA__, script#__PWS_INITIAL_PROPS__, script[type="application/json"]')];
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text.includes(pinId) || text.length > 5_000_000) continue;
      try {
        const found = findNode(JSON.parse(text), node => String(node.id || node.entityId || '') === pinId
          && Boolean(node.images || node.imageSpec_orig || node.videos || node.story_pin_data || node.carousel_data));
        if (found) return found;
      } catch { /* not JSON */ }
    }
    return null;
  }
  function pinterestMedia(pin) {
    const pages = pin.story_pin_data?.pages;
    if (Array.isArray(pages) && pages.length) {
      // Idea pins: one or more pages, each with image or video blocks.
      return pages.flatMap(page => (page.blocks || []).flatMap(block => {
        const video = bestPinterestVideo(block.video?.video_list || block.video?.videoList);
        if (video) return [{ url: video, kind: 'video' }];
        const image = bestPinterestImage(block.image?.images || block.image);
        return image ? [{ url: image, kind: 'image' }] : [];
      }));
    }
    const slots = pin.carousel_data?.carousel_slots;
    if (Array.isArray(slots) && slots.length) {
      return slots.flatMap(slot => {
        const image = bestPinterestImage(slot.images);
        return image ? [{ url: image, kind: 'image' }] : [];
      });
    }
    const video = bestPinterestVideo(pin.videos?.video_list || pin.videos?.videoList);
    if (video) return [{ url: video, kind: 'video' }];
    const image = bestPinterestImage(pin.images) || pin.imageSpec_orig?.url;
    return image ? [{ url: image, kind: 'image' }] : [];
  }
  function bestPinterestImage(images) {
    if (!images || typeof images !== 'object') return '';
    const original = images.orig || images.originals;
    if (original?.url) return original.url;
    return Object.values(images).filter(item => item?.url)
      .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0]?.url || '';
  }
  function bestPinterestVideo(list) {
    if (!list || typeof list !== 'object') return '';
    const variants = Object.values(list).filter(item => /^https?:/i.test(item?.url || ''));
    const mp4 = variants.filter(item => !/\.m3u8(?:\?|$)/i.test(item.url))
      .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    if (mp4) return mp4.url;
    // Only an HLS playlist: Pinterest serves the same video as a 720p MP4.
    const hls = variants[0]?.url;
    return hls ? pinterestMp4FromHls(hls) : '';
  }
  function pinterestMp4FromHls(url) {
    return /\/hls\//.test(url) ? url.replace(/\/hls\//, '/720p/').replace(/\.m3u8(\?.*)?$/, '.mp4') : '';
  }
  function pinterestDomMedia() {
    // Last resort when no pin data was found: the close-up media only.
    const scope = document.querySelector('[data-test-id="closeup-body"], [data-test-id="pin-closeup"], [data-test-id="closeup-image"], [data-test-id="pin-closeup-image"]');
    if (!scope) return [];
    const video = [...scope.querySelectorAll('video')].map(item => item.currentSrc || item.src || '')
      .map(url => /\.m3u8/i.test(url) ? pinterestMp4FromHls(url) : url)
      .find(url => /^https?:/i.test(url));
    if (video) return [{ url: video, kind: 'video' }];
    const image = [...scope.querySelectorAll('img')].map(largestSrc)
      .find(url => /pinimg\.com/i.test(url));
    return image ? [{ url: image.replace(/\/\d+x(?:\d+)?\//, '/originals/'), kind: 'image' }] : [];
  }
  function largestSrc(image) {
    const candidates = (image.getAttribute('srcset') || '').split(',')
      .map(entry => entry.trim().split(/\s+/))
      .filter(([url]) => url)
      .map(([url, size]) => ({ url, size: parseFloat(size) || 0 }))
      .sort((a, b) => b.size - a.size);
    return candidates[0]?.url || image.currentSrc || image.src || '';
  }
  function looksLikeSpam(link, title) {
    let host = '';
    try { host = link ? new URL(link).hostname.toLowerCase() : ''; } catch { /* not a URL */ }
    const parts = host.split(/[.-]/);
    const spamHost = parts.some(part => /^(casino\w*|\w*casino|slots?|poker|jackpot|betting|bet\d*|\d+bet|1xbet|1win|vavada|pinup|porn\w*|xxx|onlyfans|viagra|loans?|payday)$/.test(part));
    const spamTitle = /\b(casino|free spins|jackpot|slot machine|bonus code|betting|onlyfans|xxx)\b/i.test(title || '');
    return spamHost || spamTitle;
  }

  // X / Twitter -------------------------------------------------------------
  // Photos come from the open post in the page, at original size. Videos are
  // streamed to the page as blob: data; the background script fetches a
  // downloadable MP4 for the same post id from X's public embed service.
  function collectXPost() {
    const statusId = (location.pathname.match(/\/status(?:es)?\/(\d+)/) || [])[1] || '';
    const author = (location.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status/) || [])[1] || '';
    const root = statusId
      ? [...document.querySelectorAll('article')].find(article => article.querySelector(`a[href*="/status/${statusId}"] time`))
      : null;
    const photos = root ? [...root.querySelectorAll('img[src*="pbs.twimg.com/media/"]')]
      // Skip media of a quoted post, rendered inside the main post as a link card.
      .filter(image => !image.closest('div[role="link"]'))
      .map(image => ({ url: xOriginalImage(image.currentSrc || image.src), kind: 'image' })) : [];
    const media = dedupe(photos).slice(0, MAX_MEDIA);
    return {
      platform: 'x',
      url: statusId && author ? `https://x.com/${author}/status/${statusId}` : location.href,
      title: document.title,
      author,
      statusId,
      text: (root?.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 12000),
      media,
      streamedVideo: Boolean(root?.querySelector('video'))
    };
  }
  function xOriginalImage(url) {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('name', 'orig');
      return parsed.href;
    } catch { return url; }
  }

  function findNode(value, predicate, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 24) return null;
    if (Array.isArray(value)) {
      for (const item of value) { const found = findNode(item, predicate, depth + 1); if (found) return found; }
      return null;
    }
    if (predicate(value)) return value;
    for (const child of Object.values(value)) { const found = findNode(child, predicate, depth + 1); if (found) return found; }
    return null;
  }

  function authorFrom(root, platform) {
    const links = [...(root || document).querySelectorAll('a[href]')];
    const candidate = links.find(link => platform === 'linkedin'
      ? /\/in\//.test(link.getAttribute('href') || '')
      : platform === 'reddit'
        ? /\/user\//.test(link.getAttribute('href') || '')
        : /^\/?[A-Za-z0-9._]+\/?$/.test(link.getAttribute('href') || ''));
    return candidate?.textContent?.trim().slice(0, 80) || '';
  }
  function isPostImage(image, root) {
    const url = imageUrl(image);
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    if (!url || width < 180 || height < 180) return false;
    if (/(?:profile|avatar|emoji|icon|sprite|1x1|16x16|32x32)/i.test(url)) return false;
    // Profile links and the heading of a post contain authors' avatars.
    if (image.closest('header, [role="heading"], a[href*="/in/"]') && !image.closest('video')) return false;
    return !root || root.contains(image);
  }
  function imageUrl(image) {
    return image.currentSrc || image.dataset.delayedUrl || image.dataset.src || image.src || '';
  }
  function dedupe(items) {
    return [...new Map(items.filter(item => /^https?:/i.test(item.url)).map(item => [item.url, item])).values()];
  }
})();
