(() => {
  if (globalThis.__localSocialMediaCollectorInstalled) return;
  globalThis.__localSocialMediaCollectorInstalled = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // In a background tab the extension opened on a Threads post: its data.
    // Threads streams the page: early parts carry a preview of the post, the
    // full data comes later, so report whether the page has finished loading.
    if (message.type === 'THREADS_POST_DATA') {
      sendResponse({ post: postFromPageJson(String(message.code || '')), complete: document.readyState === 'complete' });
      return;
    }
    if (message.type !== 'COLLECT_POST') return;
    collectPost().then(sendResponse)
      .catch(error => sendResponse({ error: error.message, media: [] }));
    return true;
  });

  async function collectPost() {
    const platform = platformName(location.hostname);
    if (platform === 'pinterest') return collectPinterestPin();
    if (platform === 'x') return collectXPost();
    if (platform === 'youtube') return collectYouTubeVideo();
    if (platform === 'vimeo') return collectVimeoVideo();
    // Threads keeps earlier pages and the feed in the document after moving
    // inside the site, so "the first post on the page" can be another post.
    // Only the block that links to this post's code counts as the post.
    const threadsCode = platform === 'threads' ? threadsPostCode() : '';
    const root = platform === 'threads' ? threadsRoot(threadsCode) : findPostRoot(platform);
    // Deliberately collect only elements rendered inside the post. A previous
    // performance-resource fallback also picked up feed previews and avatars.
    // Instagram carousels allow up to 20 items. This hard cap is also a safety
    // net if a platform changes its markup and the root becomes a feed.
    const instagramPost = platform === 'instagram' ? await instagramPostFullSize() : null;
    const instagramMedia = instagramPost ? mediaFromInstagramNode(instagramPost) : [];
    // Without the open post's block, Threads gets no page-wide fallback: it
    // would collect the feed or an earlier post.
    const domMedia = platform === 'threads' && !root ? [] : collectMedia(root);
    const linkedInEmbed = platform === 'linkedin' ? await collectLinkedInEmbed() : null;
    const redditPost = platform === 'reddit' ? await collectRedditPost() : null;
    // Threads streams video to its player as blob: data, so the page's own
    // post JSON (the Instagram media format) is the only source of the MP4.
    const threadsData = platform === 'threads' ? await threadsPostData(threadsCode) : null;
    const threadsPost = threadsData?.post || null;
    let threadsMedia = threadsPost ? mediaFromInstagramNode(threadsPost) : [];
    let threadsNote = '';
    let incomplete = false;
    // The data may still describe a video by its cover only (a single video
    // post or one slide of a carousel). Take the file from the post's player
    // or from what the page downloaded while the post was open.
    if (threadsPost) {
      const missing = missingVideos(threadsPost);
      const playerOnly = !missing.length && !threadsMedia.some(item => item.kind === 'video') && root?.querySelector('video');
      if (missing.length || playerOnly) {
        const video = threadsVideoFromPage(root, threadsPost);
        threadsData.steps.push(`player/cache: ${video ? 'found' : 'nothing'}`);
        const slot = missing.length ? postNodes(threadsPost).indexOf(missing[0]) : -1;
        if (video && threadsMedia.length <= 1) threadsMedia = [video];
        else if (video && slot >= 0) threadsMedia[slot] = video;
        else if (video) threadsMedia.push(video);
        if (!video && missing.length) {
          incomplete = true;
          threadsNote = `Threads did not hand over the video, so only its cover was saved (${threadsData.steps.join('; ')}). Play the video for a second, then save again.`;
        }
      }
    }
    // Do not add a network fallback when the structured Instagram data already
    // supplied a video: it is commonly a byte-range copy of the same Reel.
    const reelFallback = platform === 'instagram' && isInstagramReel() && !instagramMedia.some(item => item.kind === 'video')
      ? observedInstagramVideo()
      : [];
    const linkedInVideo = platform === 'linkedin' && !(linkedInEmbed?.media || domMedia).some(item => item.kind === 'video')
      ? (root ? linkedInVideoData(root) : []).concat(observedLinkedInVideo()).slice(0, 1)
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
      url: threadsCode && threadsPost ? `${location.origin}/@${instagramAuthor(threadsPost) || location.pathname.split('/')[1]?.replace(/^@/, '')}/post/${threadsCode}` : location.href,
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
      streamedVideo: !merged.some(item => item.kind === 'video') && hasStreamedVideo(root),
      note: threadsNote,
      // A cover saved in place of a video: not recorded as saved, so saving
      // again never meets the repeat warning.
      incomplete
    };
  }

  const MAX_MEDIA = 20;

  function platformName(host) {
    // Exact hosts for X: a substring test for "x.com" would match netflix.com.
    if (['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(host)) return 'x';
    if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(host)) return 'youtube';
    if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) return 'vimeo';
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
    // Both /posts/name_activity-123-xyz and /feed/update/urn:li:activity:123/.
    const match = location.pathname.match(/(?:ugcPost|activity)[-:](\d+)/);
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
      // The player only gets a file URL once played; the MP4 list is in its
      // data-sources attribute and in the page's progressiveStreams data.
      if (!media.some(item => item.kind === 'video')) media.push(...linkedInVideoData(frameDocument));
      return {
        media: dedupe(media),
        author: authorFrom(frameRoot, 'linkedin'),
        text: (frameRoot?.innerText || '').trim().slice(0, 12000)
      };
    } catch { return null; }
    finally { iframe.remove(); }
  }
  function linkedInVideoData(scope) {
    const fromPlayer = [...scope.querySelectorAll('video[data-sources]')].flatMap(player => {
      try { return JSON.parse(player.getAttribute('data-sources')); } catch { return []; }
    }).filter(source => /^https:/.test(source?.src || '') && !/\.m3u8/i.test(source.src) && (!source.type || /mp4/.test(source.type)))
      .sort((a, b) => (Number(b['data-bitrate'] || b.bitrate) || 0) - (Number(a['data-bitrate'] || a.bitrate) || 0));
    if (fromPlayer[0]) return [{ url: fromPlayer[0].src, kind: 'video' }];
    // progressiveStreams: [{ width, bitRate, streamingLocations: [{ url }] }]
    const text = [...scope.querySelectorAll('code, script:not([src])')].map(node => node.textContent || '').find(content => content.includes('progressiveStreams')) || '';
    const start = text.indexOf('[', text.indexOf('"progressiveStreams"'));
    let streams = [];
    try { streams = start > 0 ? JSON.parse(balanced(text, start, '[', ']')) : []; } catch { /* not JSON */ }
    const best = streams.filter(stream => /^https:/.test(stream?.streamingLocations?.[0]?.url || ''))
      .sort((a, b) => (b.width || 0) * 10_000_000 + (b.bitRate || 0) - ((a.width || 0) * 10_000_000 + (a.bitRate || 0)))[0];
    return best ? [{ url: best.streamingLocations[0].url, kind: 'video' }] : [];
  }
  function wait(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }

  // After moving around Instagram without a reload, the page data can hold the
  // post only as a feed or grid preview (640 or 720 px wide). When its photos
  // are smaller than their originals, ask Instagram's API for the full post.
  async function instagramPostFullSize() {
    const inline = instagramPostData();
    if (inline && !looksDownscaled(inline)) return inline;
    const fromApi = await fetchInstagramMedia();
    if (!inline) return fromApi;
    return fromApi && smallestPhotoWidth(fromApi) > smallestPhotoWidth(inline) ? fromApi : inline;
  }
  function photoNodes(post) {
    const nodes = Array.isArray(post.carousel_media) && post.carousel_media.length ? post.carousel_media : [post];
    return nodes.filter(node => !node.video_versions?.length && node.image_versions2?.candidates?.length);
  }
  // The width of the post's least sharp photo, each at its best size.
  function smallestPhotoWidth(post) {
    return Math.min(...photoNodes(post).map(node => bestInstagramVariant(node.image_versions2.candidates)?.width || 0), Infinity);
  }
  function looksDownscaled(post) {
    return photoNodes(post).some(node => {
      const best = bestInstagramVariant(node.image_versions2.candidates)?.width || 0;
      const original = node.original_width || post.original_width || 0;
      return original ? best < original && best < 1080 : best > 0 && best < 1080;
    });
  }
  function instagramPostData() {
    const shortcode = instagramShortcode();
    if (!shortcode) return null;
    return postFromPageJson(shortcode);
  }
  function postFromPageJson(shortcode, doc = document) {
    const scripts = [...doc.querySelectorAll('script[type="application/json"], script:not([src])')];
    // A page can describe the same post more than once: a preview with only
    // the cover, and the full post with its video or every carousel slide.
    // Collect every match and keep the richest.
    const found = [];
    for (const script of scripts) {
      const text = script.textContent || '';
      // Threads keeps whole feeds in one script, so allow large ones.
      if (!text.includes(shortcode) || text.length > 20_000_000) continue;
      try { collectInstagramPosts(JSON.parse(text), shortcode, found); } catch { /* Not every inline script contains JSON. */ }
    }
    const post = found.sort((a, b) => postRichness(b) - postRichness(a))[0] || null;
    if (post) upgradeImageCandidates(post, found, scripts);
    return post;
  }
  // The richest description is not always the sharpest: Threads can describe
  // the same photo once with full-size candidates and once as a 640px preview.
  // Give each photo of the chosen post every candidate the page has for it:
  // from the other descriptions (matched by media id) and from the <img>
  // srcsets in the page (matched by the CDN file name, which every size of
  // one photo shares). bestInstagramVariant then takes the largest.
  function upgradeImageCandidates(post, found, scripts) {
    const nodesOf = item => Array.isArray(item.carousel_media) && item.carousel_media.length ? item.carousel_media : [item];
    const idOf = node => String(node.pk || node.id || '').split('_')[0];
    const nodes = nodesOf(post).filter(node => node.image_versions2?.candidates);
    if (!nodes.length) return;
    const ids = new Set(nodes.map(idOf).filter(Boolean));
    const extra = new Map();
    const add = (key, candidates) => { if (key && Array.isArray(candidates)) extra.set(key, [...(extra.get(key) || []), ...candidates]); };
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 40) return;
      if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
      if (value.image_versions2?.candidates && ids.has(idOf(value))) add(idOf(value), value.image_versions2.candidates);
      for (const child of Object.values(value)) visit(child, depth + 1);
    };
    for (const other of found) if (other !== post) visit(other);
    for (const script of scripts) {
      const text = script.textContent || '';
      if (text.length > 20_000_000 || ![...ids].some(id => text.includes(id))) continue;
      try { visit(JSON.parse(text)); } catch { /* not JSON */ }
    }
    const fileOf = url => { try { return new URL(url, location.href).pathname.split('/').pop(); } catch { return ''; } };
    const domSizes = new Map();
    for (const image of document.querySelectorAll('img[srcset], img[src*="cdninstagram"], img[src*="fbcdn"]')) {
      const entries = (image.getAttribute('srcset') || '').split(',').map(entry => entry.trim().split(/\s+/))
        .filter(([url]) => url).map(([url, size]) => ({ url: new URL(url, location.href).href, width: parseFloat(size) || 0, height: 0 }));
      if (image.currentSrc || image.src) entries.push({ url: image.currentSrc || image.src, width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
      for (const entry of entries) { const file = fileOf(entry.url); if (file) domSizes.set(file, [...(domSizes.get(file) || []), entry]); }
    }
    for (const node of nodes) {
      const own = node.image_versions2.candidates;
      const files = new Set(own.map(candidate => fileOf(candidate.url)).filter(Boolean));
      const fromDom = [...files].flatMap(file => domSizes.get(file) || [])
        // srcset gives a width only; estimate the height from the photo's shape.
        .map(entry => entry.height || !own[0]?.width ? entry : { ...entry, height: Math.round(entry.width * (own[0].height || 0) / own[0].width) });
      node.image_versions2 = { ...node.image_versions2, candidates: [...own, ...(extra.get(idOf(node)) || []), ...fromDom] };
    }
  }
  function postRichness(post) {
    const nodes = Array.isArray(post.carousel_media) && post.carousel_media.length ? post.carousel_media : [post];
    return nodes.length * 2 + nodes.filter(node => Array.isArray(node.video_versions) && node.video_versions.length).length * 10;
  }
  function collectInstagramPosts(value, shortcode, found, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 40) return;
    if (Array.isArray(value)) { for (const item of value) collectInstagramPosts(item, shortcode, found, depth + 1); return; }
    if (String(value.code || value.shortcode || '') === shortcode && (value.carousel_media || value.image_versions2 || value.video_versions)) found.push(value);
    for (const child of Object.values(value)) collectInstagramPosts(child, shortcode, found, depth + 1);
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
  // The page's inline data describes the post only when the page was loaded
  // on it. After moving inside Threads, it holds the post at best as a feed
  // preview. Then load this post's own page and read its data from there.
  // The page's inline data describes the post only when the page was loaded
  // on it. After moving inside Threads (from the feed, a profile, search), the
  // post arrived by a request whose answer is not in the document. Threads
  // sends the full post data only to a real page load (a script's request for
  // the same address gets the cover alone), so the background opens the post
  // in a background tab for a moment and reads it there.
  async function threadsPostData(code) {
    const steps = [];
    if (!code) return { post: null, steps: ['no post code in the address'] };
    let post = postFromPageJson(code);
    steps.push(`page data: ${describeThreadsPost(post)}`);
    if (post && !looksDownscaled(post) && !missingVideos(post).length) return { post, steps };
    const user = (location.pathname.match(/^\/(@[^/]+)\//) || [])[1] || (post ? `@${instagramAuthor(post)}` : '');
    try {
      const answer = await chrome.runtime.sendMessage({ type: 'THREADS_LOAD_POST', url: `${location.origin}${user ? `/${user}/post/${code}` : `/t/${code}`}` });
      const found = answer?.post || null;
      steps.push(`post page: ${answer?.error || describeThreadsPost(found)}`);
      if (found && (!post || postNodes(found).length >= postNodes(post).length && missingVideos(found).length <= missingVideos(post).length)) post = found;
    } catch (error) { steps.push(`post page: ${error.message}`); }
    return { post, steps };
  }
  function postNodes(post) {
    return Array.isArray(post?.carousel_media) && post.carousel_media.length ? post.carousel_media : post ? [post] : [];
  }
  // A video known only by its cover: the data says video but lists no file.
  function missingVideos(post) {
    return postNodes(post).filter(node => (Number(node.media_type) === 2 || Number(node.video_duration) > 0 || node.video_dash_manifest)
      && !node.video_versions?.some(item => /^https?:/i.test(item?.url || '')));
  }
  function describeThreadsPost(post) {
    if (!post) return 'no post data';
    const nodes = postNodes(post);
    const videos = nodes.filter(node => node.video_versions?.length || Number(node.media_type) === 2 || Number(node.video_duration) > 0);
    return `${nodes.length} item(s), ${videos.length - missingVideos(post).length}/${videos.length} videos with a file`;
  }
  // The block of the open post: the one with a visible link to its code (its
  // timestamp). Replies carry their own codes, the feed and earlier pages too.
  function threadsRoot(code) {
    if (!code) return null;
    for (const link of document.querySelectorAll(`a[href*="/post/${code}"]`)) {
      if (!link.getClientRects().length) continue;
      const box = link.closest('[data-pressable-container]') || link.closest('article');
      if (box) return box;
    }
    return null;
  }
  // /@username/post/<code>; the code identifies the post like an Instagram
  // shortcode. Share links (/share/<id>) carry no code: read it from the
  // page's canonical address instead.
  function threadsPostCode() {
    const fromPath = (path) => (String(path || '').match(/\/post\/([A-Za-z0-9_-]+)/) || [])[1] || '';
    return fromPath(location.pathname)
      || fromPath(document.querySelector('link[rel="canonical"]')?.href)
      || fromPath(document.querySelector('meta[property="og:url"]')?.content)
      || fromPath(document.querySelector('meta[property="al:android:url"], meta[property="al:ios:url"]')?.content);
  }
  function instagramShortcode() {
    const parts = location.pathname.split('/').filter(Boolean);
    const marker = parts.findIndex(part => ['p', 'reel', 'reels', 'tv'].includes(part));
    return marker >= 0 ? parts[marker + 1] || '' : '';
  }
  function isInstagramReel() {
    return location.pathname.split('/').filter(Boolean).some(part => ['reel', 'reels'].includes(part));
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
  function threadsVideoFromPage(root, post) {
    if (!root) return null;
    const fromPlayer = [...root.querySelectorAll('video')]
      .flatMap(video => [video.currentSrc, video.src, ...[...video.querySelectorAll('source')].map(source => source.src)])
      .find(url => /^https:/i.test(url || ''));
    if (fromPlayer) return { url: fromPlayer, kind: 'video' };
    // A streamed player fetches the MP4 in byte ranges; without the range
    // parameters the same address serves the whole file. The tab has also
    // loaded videos from the feed and earlier posts: consider only video
    // loaded after this post's cover first appeared, and take the most recent
    // one, i.e. the video that played while the post was open.
    const coverFiles = (post?.image_versions2?.candidates || [])
      .map(item => { try { return new URL(item.url).pathname.split('/').pop(); } catch { return ''; } }).filter(Boolean);
    const resources = performance.getEntriesByType('resource');
    const coverLoaded = Math.min(...resources.filter(item => coverFiles.some(file => item.name.includes(file))).map(item => item.startTime));
    if (!Number.isFinite(coverLoaded)) return null;
    const entry = resources
      .filter(item => item.startTime >= coverLoaded)
      .filter(item => /(?:cdninstagram|fbcdn)\./i.test(item.name) && /\.mp4(?:\?|$)/i.test(item.name))
      .sort((a, b) => b.startTime - a.startTime)[0];
    if (!entry) return null;
    const url = new URL(entry.name);
    url.searchParams.delete('bytestart');
    url.searchParams.delete('byteend');
    return { url: url.href, kind: 'video' };
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

  // YouTube -----------------------------------------------------------------
  // A reference card only: the video's cover image, title, channel, and link.
  // The video itself is never downloaded (YouTube's terms and Chrome Web
  // Store policy do not allow it).
  async function collectYouTubeVideo() {
    const videoId = youTubeVideoId();
    const isShort = location.pathname.startsWith('/shorts/');
    const details = videoId ? await youTubeDetails(videoId) : null;
    const cover = videoId ? await youTubeCover(videoId, details?.thumbnails) : '';
    const title = details?.title || '';
    const description = details?.description || '';
    return {
      platform: 'youtube',
      url: videoId ? (isShort ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`) : location.href,
      title: title || document.title,
      headline: title,
      author: (details?.channel || '').slice(0, 80),
      text: [title, description].filter(Boolean).join('\n\n').slice(0, 12000),
      media: cover ? [{ url: cover, kind: 'image' }] : [],
      streamedVideo: false
    };
  }
  function youTubeVideoId() {
    const fromQuery = new URLSearchParams(location.search).get('v');
    const fromPath = (location.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/) || [])[1];
    const id = fromQuery || fromPath || '';
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
  }
  async function youTubeDetails(videoId) {
    // ytInitialPlayerResponse describes the first video loaded in the tab;
    // YouTube swaps videos without reloading, so use it only if the id matches.
    const inPage = [...document.querySelectorAll('script:not([src])')]
      .map(script => script.textContent || '')
      .find(text => text.includes('ytInitialPlayerResponse') && text.includes(videoId));
    const fromPage = inPage && playerDetails(inPage, videoId);
    if (fromPage) return fromPage;
    // Opened by navigating inside YouTube: load this video's own page for its
    // data. The rendered description is not used: it carries interface text
    // ("…more", view counters drawn as columns of digits).
    try {
      const response = await fetch(`/watch?v=${videoId}`, { credentials: 'include' });
      const fetched = response.ok && playerDetails(await response.text(), videoId);
      if (fetched) return fetched;
    } catch { /* fall back to the title and channel on screen */ }
    const watch = document.querySelector('ytd-watch-metadata');
    const activeShort = document.querySelector('ytd-reel-video-renderer[is-active]');
    const title = watch?.querySelector('h1')?.innerText
      || activeShort?.querySelector('h2, .title')?.innerText
      || document.title.replace(/\s*-\s*YouTube$/, '');
    const channel = watch?.querySelector('#channel-name a, ytd-channel-name a')?.innerText
      || activeShort?.querySelector('a[href^="/@"]')?.innerText?.replace(/^@/, '')
      || '';
    return { title: title.trim(), channel: channel.trim(), description: '' };
  }
  function playerDetails(text, videoId) {
    const marker = text.indexOf('ytInitialPlayerResponse');
    const start = marker >= 0 ? text.indexOf('{', marker) : -1;
    try {
      const details = start >= 0 ? JSON.parse(balancedJson(text, start))?.videoDetails : null;
      if (details?.videoId !== videoId) return null;
      return { title: details.title || '', channel: details.author || '', description: (details.shortDescription || '').trim(),
        thumbnails: details.thumbnail?.thumbnails || [] };
    } catch { return null; }
  }
  function balancedJson(text, start) { return balanced(text, start, '{', '}'); }
  function balanced(text, start, open, close) {
    let depth = 0, inString = false, escaped = false;
    for (let index = start; index < text.length; index++) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
      } else if (character === '"') inString = true;
      else if (character === open) depth++;
      else if (character === close && --depth === 0) return text.slice(start, index + 1);
    }
    return '';
  }
  async function youTubeCover(videoId, thumbnails = []) {
    const base = `https://i.ytimg.com/vi/${videoId}`;
    // The video's own data lists its covers; when it names an HD one, that
    // settles it without a network check.
    const widest = Math.max(0, ...thumbnails.map(item => item?.width || 0));
    if (widest >= 1280 || thumbnails.some(item => /maxresdefault/.test(item?.url || ''))) return `${base}/maxresdefault.jpg`;
    // Otherwise check each size, largest first. maxresdefault exists only for
    // HD uploads (a missing size answers with a 120px placeholder). Load all
    // three at once and wait long enough for slow connections: a 4-second
    // limit sent 640×480 covers to users on slow networks.
    const sizes = ['maxresdefault', 'sddefault', 'hqdefault'];
    const loads = sizes.map(size => imageLoads(`${base}/${size}.jpg`, 20_000));
    for (const [index, size] of sizes.entries()) if (await loads[index]) return `${base}/${size}.jpg`;
    return '';
  }
  function imageLoads(url, limit = 4000) {
    return new Promise(resolve => {
      const image = new Image();
      const timer = setTimeout(() => resolve(false), limit);
      image.onload = () => { clearTimeout(timer); resolve(image.naturalWidth > 120); };
      image.onerror = () => { clearTimeout(timer); resolve(false); };
      image.src = url;
    });
  }

  // Vimeo -------------------------------------------------------------------
  // A reference card like YouTube: cover, title, author, description, link.
  // The background script adds the MP4 only when the owner allows downloads.
  async function collectVimeoVideo() {
    const match = location.pathname.match(/(?:^|\/)(\d{6,})(?:\/([0-9a-f]{6,}))?(?:\/|$)/);
    const videoId = match?.[1] || '';
    const hash = match?.[2] || new URLSearchParams(location.search).get('h') || '';
    const pageUrl = videoId ? `https://vimeo.com/${videoId}${hash ? `/${hash}` : ''}` : location.href;
    let info = null;
    if (videoId) {
      try {
        const response = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(pageUrl)}&width=1920`);
        if (response.ok) info = await response.json();
      } catch { /* fall back to the page */ }
    }
    const title = (info?.title || document.querySelector('meta[property="og:title"]')?.content || document.title.replace(/\s+on Vimeo$/, '')).trim();
    const cover = await vimeoCover(info?.thumbnail_url || document.querySelector('meta[property="og:image"]')?.content || '');
    return {
      platform: 'vimeo',
      url: pageUrl,
      title,
      headline: title,
      author: String(info?.author_name || '').slice(0, 80),
      text: [title, (info?.description || '').trim()].filter(Boolean).join('\n\n').slice(0, 12000),
      media: cover ? [{ url: cover, kind: 'image' }] : [],
      streamedVideo: false,
      vimeo: videoId ? { id: videoId, hash, downloadButton: vimeoDownloadButton(), configUrl: vimeoConfigUrl(), ...(await vimeoDownloads(videoId, hash).then(result => ({ downloads: result.files, downloadSteps: result.steps }))), ...(await vimeoPlayerConfig(videoId, hash)) } : null
    };
  }
  async function vimeoCover(url) {
    if (!/^https?:/i.test(url)) return '';
    // Thumbnail URLs end in a size (_640, _295x166); ask for 1920 first.
    const large = url.replace(/_\d+(?:x\d+)?(\.\w+)?(\?.*)?$/, '_1920$1');
    if (large !== url && await imageLoads(large)) return large;
    return url;
  }
  // The files the owner allows to download: what the page's Download button
  // lists. Vimeo's site gets them from its API (the video's "download"
  // field) with a short-lived token for the signed-in viewer; do the same.
  // Older pages answered ?action=load_download_config; an open Download
  // dialog lists the links too.
  async function vimeoDownloads(videoId, hash) {
    const files = [];
    const steps = [];
    try {
      const viewer = await fetch('/_next/viewer', { credentials: 'include', headers: { Accept: 'application/json' } });
      const jwt = viewer.ok ? (await viewer.json())?.jwt : '';
      steps.push(`viewer ${viewer.status}${jwt ? '' : ' (no token)'}`);
      if (jwt) {
        const api = await fetch(`https://api.vimeo.com/videos/${videoId}${hash ? `:${hash}` : ''}?fields=download`, {
          headers: { Authorization: `jwt ${jwt}`, Accept: 'application/vnd.vimeo.*+json;version=3.4.10' }
        });
        steps.push(`api ${api.status}`);
        if (api.ok) {
          for (const file of (await api.json())?.download || []) {
            if (/^https:/.test(file?.link || '') && file.quality !== 'hls') {
              files.push({ url: file.link, width: Number(file.width) || 0, source: file.quality === 'source' });
            }
          }
        }
      }
    } catch (error) { steps.push(`api failed: ${error.message}`); }
    if (!files.length) {
      try {
        const response = await fetch(`/${videoId}${hash ? `/${hash}` : ''}?action=load_download_config`, {
          credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }
        });
        steps.push(`download config ${response.status}`);
        if (response.ok && /json/.test(response.headers.get('content-type') || '')) {
          for (const file of (await response.json())?.files || []) {
            const url = file.download_url || file.link || file.url;
            if (/^https:/.test(url || '') && !/\.m3u8/i.test(url)) files.push({ url, width: Number(file.width) || parseInt(file.public_name || file.quality || '', 10) || 0 });
          }
        }
      } catch { /* try the dialog */ }
    }
    for (const link of document.querySelectorAll('a[href*="progressive_redirect/download"]')) {
      files.push({ url: link.href, width: parseInt((link.textContent.match(/(\d{3,4})p/) || [])[1], 10) || parseInt((decodeURIComponent(link.href).match(/\((\d{3,4})p\)/) || [])[1], 10) || 0 });
    }
    const unique = [...new Map(files.map(file => [file.url, file])).values()];
    return { files: unique, steps: steps.join(', ') };
  }
  // Vimeo answers the player config only to requests from its own pages (its
  // cookies and referrer), so read it here, in the page, as the player does.
  async function vimeoPlayerConfig(videoId, hash) {
    const url = vimeoConfigUrl() || `https://player.vimeo.com/video/${videoId}/config${hash ? `?h=${hash}` : ''}`;
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) return { configStatus: response.status };
      const config = await response.json();
      return {
        configStatus: 200,
        allowDownload: config.video?.allow_download === true,
        progressive: (config.request?.files?.progressive || [])
          .filter(file => /^https:/.test(file?.url || ''))
          .map(file => ({ url: file.url, width: file.width || 0 })),
        owner: config.video?.owner?.name || ''
      };
    } catch { return { configStatus: 0 }; }
  }
  // The player-config URL in the page is signed; without the signature many
  // videos answer 403.
  function vimeoConfigUrl() {
    const match = document.documentElement.innerHTML.match(/"config_url"\s*:\s*"(https:[^"]+)"/);
    if (!match) return '';
    const url = match[1].replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
    return /^https:\/\/player\.vimeo\.com\//.test(url) ? url : '';
  }
  function vimeoDownloadButton() {
    // Shown only when the owner allows downloads.
    return [...document.querySelectorAll('button, a')].some(element =>
      /^download$/i.test((element.getAttribute('aria-label') || element.textContent || '').trim()));
  }

  // X / Twitter -------------------------------------------------------------
  // Photos come from the open post in the page, at original size. Videos are
  // streamed to the page as blob: data; the background script fetches a
  // downloadable MP4 for the same post id from X's public embed service.
  function collectXPost() {
    const statusId = (location.pathname.match(/\/status(?:es)?\/(\d+)/) || [])[1] || '';
    const author = (location.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status/) || [])[1] || '';
    const articles = [...document.querySelectorAll('article')];
    // The open post: the one whose timestamp links to this id; on a post page X
    // also marks it with tabindex="-1". Replies and thread parents link elsewhere.
    const root = statusId
      ? articles.find(article => article.querySelector(`a[href*="/status/${statusId}"] time`))
        || articles.find(article => article.getAttribute('tabindex') === '-1')
        || articles.find(article => article.querySelector(`a[href*="/status/${statusId}/photo/"]`))
      : null;
    const urls = root ? [
      ...[...root.querySelectorAll('img[src*="pbs.twimg.com/media/"]')].map(image => ({ node: image, url: image.currentSrc || image.src })),
      // Photos are also painted as a background image; covered or blurred ones
      // (content warnings) may only exist there.
      ...[...root.querySelectorAll('[style*="pbs.twimg.com/media/"]')].map(node => ({ node, url: (node.getAttribute('style').match(/url\(["']?([^"')]+pbs\.twimg\.com\/media\/[^"')]+)/) || [])[1] || '' }))
    ] : [];
    const photos = urls
      .filter(({ url }) => /pbs\.twimg\.com\/media\//.test(url))
      // Skip media of a quoted post, rendered inside the main post as a link card.
      .filter(({ node }) => { const card = node.closest('div[role="link"]'); return !card || !root.contains(card) || card === root; })
      .map(({ url }) => ({ url: xOriginalImage(url.replace(/&amp;/g, '&')), kind: 'image' }));
    const media = [...new Map(photos.map(item => [xMediaKey(item.url), item])).values()].slice(0, MAX_MEDIA);
    return {
      platform: 'x',
      url: statusId && author ? `https://x.com/${author}/status/${statusId}` : location.href,
      title: document.title,
      author,
      statusId,
      text: (root?.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 12000),
      media,
      streamedVideo: Boolean(root?.querySelector('video')),
      // Why nothing was found, shown in the popup if the embed service fails too.
      diagnosis: !statusId ? 'not a post page' : !root ? 'post not found on the page' : !media.length ? 'no photos in the page' : ''
    };
  }
  function xMediaKey(url) {
    return (url.match(/pbs\.twimg\.com\/media\/([^?.]+)/) || [])[1] || url;
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
