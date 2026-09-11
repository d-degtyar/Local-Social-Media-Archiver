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
    const root = findPostRoot(platform);
    // Deliberately collect only elements rendered inside the post. A previous
    // performance-resource fallback also picked up feed previews and avatars.
    // A post carousel is normally at most 10 items. This hard cap is also a
    // safety net if a platform changes its markup and the root becomes a feed.
    const instagramPost = platform === 'instagram' ? instagramPostData() : null;
    const instagramMedia = instagramPost ? mediaFromInstagramNode(instagramPost) : [];
    const domMedia = collectMedia(root);
    const linkedInEmbed = platform === 'linkedin' ? await collectLinkedInEmbed() : null;
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
        : domMedia;
    let merged = dedupe([...primaryMedia, ...reelFallback, ...linkedInVideo]);
    // LinkedIn renders a poster frame as an <img> next to every video. It is
    // useful in the page UI but not a separate post asset for the archive.
    if (platform === 'linkedin' && merged.some(item => item.kind === 'video')) {
      merged = merged.filter(item => item.kind === 'video');
    }
    merged = merged.slice(0, 10);
    return {
      platform,
      url: location.href,
      title: document.querySelector('meta[property="og:title"]')?.content || document.title,
      author: platform === 'instagram' ? instagramAuthor(instagramPost) : linkedInEmbed?.author || authorFrom(root, platform),
      text: platform === 'instagram'
        ? instagramCaption(instagramPost)
        : (linkedInEmbed?.text || root?.innerText || document.body.innerText).trim().slice(0, 12000),
      media: merged
    };
  }

  function platformName(host) {
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
    if (!shortcode) return [];
    const scripts = [...document.querySelectorAll('script[type="application/json"], script:not([src])')];
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text.includes(shortcode) || text.length > 5_000_000) continue;
      try {
        const post = findInstagramPost(JSON.parse(text), shortcode);
        if (post) return post;
      } catch { /* Not every inline script contains JSON. */ }
    }
    return [];
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
    if (!value || typeof value !== 'object' || depth > 18) return null;
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
