/*
 * PicHarvest / 图仓 — page extractor
 * Runs in an isolated content-script world (and in Node tests via jsdom).
 * No network calls, no DOM mutation, no page globals.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PicHarvestCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VERSION = "1.0.0";
  var MAX_IMAGES = 150;

  var SITES = [
    { id: "amazon", name: "Amazon", re: /(^|\.)amazon\.(com|ca|com\.mx|com\.br|co\.uk|de|fr|it|es|nl|se|pl|tr|ae|sa|eg|in|co\.jp|com\.au|sg)$/i },
    { id: "taobao", name: "淘宝 / 天猫", re: /(^|\.)(taobao|tmall)\.(com|hk)$/i },
    { id: "1688", name: "1688", re: /(^|\.)1688\.com$/i },
    { id: "aliexpress", name: "AliExpress", re: /(^|\.)aliexpress\.(com|us|ru|es|fr|de|it|nl|pl|pt|br|mx|ar|cl|co|pe|ma|eg|sa|ae|il|tr|th|vn|id|my|ph|sg|jp|kr|au|nz|in|pk|bd|lk|kz|ua)$/i },
    { id: "alibaba", name: "Alibaba", re: /(^|\.)alibaba\.com$/i },
    { id: "shopee", name: "Shopee", re: /(^|\.)shopee\.(com|com\.br|co\.th|sg|my|id|ph|vn|tw|mx|co\.id)$/i },
    { id: "ebay", name: "eBay", re: /(^|\.)ebay\.(com|ca|co\.uk|de|fr|it|es|com\.au|at|be|ch|ie|nl|pl|com\.sg|com\.my|com\.ph|co\.kr|co\.jp|co\.nz|com\.hk|com\.tw|com\.mx|com\.br|com\.ar|cl|co|pe|ie|in)$/i },
    { id: "walmart", name: "Walmart", re: /(^|\.)walmart\.(com|ca|com\.mx)$/i },
    { id: "etsy", name: "Etsy", re: /(^|\.)etsy\.com$/i },
    { id: "temu", name: "Temu", re: /(^|\.)temu\.com$/i },
    { id: "shein", name: "SHEIN", re: /(^|\.)shein\.(com|co\.uk|com\.au|de|fr|it|es|nl|se|pl|pt|br|mx|ca|com\.sg|com\.my|com\.ph|co\.th|co\.id|com\.vn|co\.jp|co\.kr|com\.tr|com\.sa|com\.ae|co\.za|com\.mx)$/i },
    { id: "jd", name: "京东", re: /(^|\.)(jd|360buy)\.(com|hk)$/i },
    { id: "pinduoduo", name: "拼多多", re: /(^|\.)(pinduoduo|yangkeduo)\.com$/i },
    { id: "xiaohongshu", name: "小红书", re: /(^|\.)(xiaohongshu|xhslink)\.com$/i },
    { id: "douyin", name: "抖音商城", re: /(^|\.)(douyin|jinritemai)\.com$/i },
    { id: "tiktok", name: "TikTok Shop", re: /(^|\.)tiktok\.com$/i },
    { id: "wish", name: "Wish", re: /(^|\.)wish\.com$/i },
    { id: "shopify", name: "Shopify 商店", re: /(^|\.)myshopify\.com$/i },
    { id: "woocommerce", name: "WooCommerce 商店", re: /$^/ },
    { id: "bigcommerce", name: "BigCommerce 商店", re: /$^/ },
    { id: "magento", name: "Magento 商店", re: /$^/ }
  ];

  var TRACKING_HOST_RE = /(^|\.)(google-analytics|googletagmanager|doubleclick|facebook|hotjar|segment|sentry|bat\.bing|clarity\.ms|mixpanel|amplitude|fullstory|newrelic|bugsnag|statcounter)\./i;
  var BAD_PATH_RE = /(\/|_|-)(spacer|pixel|tracking|transparent|blank|placeholder|loading|sprite|favicon|avatar|emoji|country-flag|rating-star|social-icon)(\/|_|-|\.|$)/i;
  var CHROME_TAGS = { HEADER: 1, FOOTER: 1, NAV: 1, ASIDE: 1 };

  function safeUrl(raw, base) {
    if (!raw || typeof raw !== "string") return null;
    var value = raw.trim().replace(/^['"]|['"]$/g, "");
    if (!value || /^(data|blob|javascript|chrome-extension|moz-extension):/i.test(value)) return null;
    if (value.indexOf("//") === 0) value = "https:" + value;
    try {
      var url = new URL(value, base || "https://example.com/");
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      url.hash = "";
      return url;
    } catch (_) {
      return null;
    }
  }

  function stripAliProcessing(pathname) {
    var out = pathname;
    for (var i = 0; i < 4; i++) {
      var next = out
        // image.jpg_640x640.jpg and image.png_.webp both keep the real extension.
        .replace(/\.(jpe?g|png|webp|avif)_[^/]*?\.(?:jpe?g|png|webp|avif)$/i, ".$1")
        // Bare resize suffixes on paths that have no original extension yet.
        .replace(/_(?:\d+x\d+|\d+x\d*|x\d+|q\d+|s\d+|summ?|watermark|webp|m\d+|bg)[^/]*?\.(jpe?g|png|webp|avif)$/i, ".$1");
      if (next === out) break;
      out = next;
    }
    return out;
  }

  function upgradeUrl(raw, base) {
    var url = safeUrl(raw, base);
    if (!url) return null;
    var host = url.hostname.toLowerCase();
    var before = url.href;

    if (/(^|\.)media-amazon\.com$|(^|\.)images-amazon\.com$|(^|\.)images-na\.ssl-images-amazon\.com$|(^|\.)ssl-images-amazon\.com$/i.test(host)) {
      url.pathname = url.pathname.replace(/\._[A-Za-z0-9_,\-]+_\./g, ".").replace(/\._\./g, ".");
      url.protocol = "https:";
    } else if (/(^|\.)(alicdn|alibaba)\.com$|(^|\.)aliexpress-media\.com$/i.test(host)) {
      url.pathname = stripAliProcessing(url.pathname);
      url.protocol = "https:";
      ["width", "height", "w", "h", "quality", "q", "fit", "webp"].forEach(function (key) {
        url.searchParams["delete"](key);
      });
    } else if (/(^|\.)ebayimg\.com$/i.test(host)) {
      url.pathname = url.pathname.replace(/\/s-l\d+(?=\.(?:jpe?g|png|webp|avif)$)/i, "/s-l1600");
      url.protocol = "https:";
    } else if (/(^|\.)etsystatic\.com$/i.test(host)) {
      url.pathname = url.pathname
        .replace(/\/il_\d+x\d+(?=\.)/i, "/il_fullxfull")
        .replace(/\/il_\d+xN+(?=\.)/i, "/il_fullxfull");
      url.protocol = "https:";
    } else if (/(^|\.)shopify\.com$|(^|\.)shopifycdn\.com$/i.test(host) || /cdn\.shopify\.com$/i.test(host)) {
      url.pathname = url.pathname
        .replace(/_(?:pico|icon|thumb|small|compact|medium|large|grande|original)(?=\.(?:jpe?g|png|webp|avif|gif)$)/i, "")
        .replace(/_(?:\d+x\d*|\d*x\d+)(?:@\d+x)?(?=\.(?:jpe?g|png|webp|avif|gif)$)/i, "");
      url.protocol = "https:";
    } else if (/(^|\.)walmartimages\.com$/i.test(host)) {
      url.search = "";
      url.protocol = "https:";
    } else if (/(^|\.)kwcdn\.com$/i.test(host)) {
      url.search = "";
      url.pathname = url.pathname.replace(/~tplv-[^/]+$/i, "");
      url.protocol = "https:";
    } else if (/(^|\.)ltwebstatic\.com$/i.test(host)) {
      url.pathname = url.pathname.replace(/_(?:thumbnail|wsp|thumb)_\d+x\d+(?=\.)/i, "").replace(/_\d+x\d+(?=\.)/i, "");
      url.search = "";
      url.protocol = "https:";
    } else if (/(^|\.)360buyimg\.com$/i.test(host)) {
      url.pathname = url.pathname
        .replace(/^\/n\d+\/s\d+x\d+_/i, "/n0/")
        .replace(/^\/n\d+\//i, "/n0/")
        .replace(/\/s\d+x\d+_/i, "/");
      url.search = "";
      url.protocol = "https:";
    } else if (/(^|\.)pddpic\.com$/i.test(host) || /(^|\.)xhscdn\.com$/i.test(host)) {
      url.search = "";
      url.protocol = "https:";
    } else if (/(^|\.)douyinpic\.com$/i.test(host)) {
      url.pathname = url.pathname.replace(/~tplv-[^/]+$/i, "");
      url.search = "";
      url.protocol = "https:";
    } else if (/(^|\.)susercontent\.com$/i.test(host)) {
      url.pathname = url.pathname.replace(/@resize_[^/]+$/i, "");
      url.search = "";
      url.protocol = "https:";
    }

    if (url.protocol === "http:" && /(amazon|alicdn|ebayimg|etsystatic|shopify|walmartimages|kwcdn|ltwebstatic|360buyimg|pddpic|xhscdn|douyinpic|susercontent)\./i.test(host)) {
      url.protocol = "https:";
    }
    url.hash = "";
    return { url: url.href, upgraded: url.href !== before };
  }

  function imageKey(url) {
    try {
      var u = new URL(url);
      var host = u.hostname.replace(/^www\./i, "").toLowerCase();
      return host + u.pathname.replace(/\/{2,}/g, "/");
    } catch (_) {
      return url;
    }
  }

  function isImageUrl(url) {
    try {
      var u = new URL(url);
      if (TRACKING_HOST_RE.test(u.hostname)) return false;
      if (BAD_PATH_RE.test(u.pathname)) return false;
      if (/\.(svg|ico|gif|css|js|json|woff2?|ttf|otf|mp4|webm)(?:$|\?)/i.test(u.pathname)) return false;
      if (/(^|\.)(google|gstatic|facebook|instagram|pinterest|tiktokcdn|byteoversea|cloudflare|jsdelivr|unpkg)\./i.test(u.hostname) && /(pixel|beacon|analytics|avatar|logo|icon)/i.test(u.pathname)) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function parseSrcset(value) {
    if (!value || typeof value !== "string") return [];
    var out = [];
    var parts = value.split(",");
    for (var i = 0; i < parts.length; i++) {
      var bit = parts[i].trim();
      if (!bit || /^data:/i.test(bit)) continue;
      var url = bit.split(/\s+/)[0];
      if (url) out.push(url);
    }
    return out;
  }

  function parseDynamicImage(value) {
    if (!value) return [];
    try {
      var parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(function (x) { return typeof x === "string"; });
      if (parsed && typeof parsed === "object") return Object.keys(parsed);
    } catch (_) { /* Amazon occasionally leaves this malformed. */ }
    return [];
  }

  function extractJsonLd(doc) {
    var featured = [];
    var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      var text = scripts[i].textContent || "";
      if (text.length > 900000) continue;
      var data;
      try { data = JSON.parse(text); } catch (_) { continue; }
      walkJson(data, featured, 0);
    }
    return featured;
  }

  function walkJson(value, featured, depth) {
    if (!value || depth > 7) return;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length && i < 80; i++) walkJson(value[i], featured, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    var type = value["@type"];
    var isProduct = type === "Product" || (Array.isArray(type) && type.indexOf("Product") !== -1);
    if (isProduct) {
      addJsonImages(value.image, featured);
      addJsonImages(value.thumbnailUrl, featured);
    }
    if (value["@graph"]) walkJson(value["@graph"], featured, depth + 1);
  }

  function addJsonImages(value, featured) {
    if (!value) return;
    if (typeof value === "string") { featured.push(value); return; }
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) addJsonImages(value[i], featured);
      return;
    }
    if (typeof value === "object") {
      if (typeof value.url === "string") featured.push(value.url);
      if (typeof value.contentUrl === "string") featured.push(value.contentUrl);
    }
  }

  function metaContent(doc, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = doc.querySelector(selectors[i]);
      if (el) {
        var value = el.getAttribute("content") || el.getAttribute("href") || "";
        if (value.trim()) return value.trim();
      }
    }
    return "";
  }

  function detectSite(hostname, doc) {
    var host = String(hostname || "").toLowerCase();
    for (var i = 0; i < SITES.length; i++) {
      if (SITES[i].re.test(host)) return { id: SITES[i].id, name: SITES[i].name };
    }
    if (doc) {
      var generator = "";
      try { generator = (doc.querySelector('meta[name="generator"]') || {}).content || ""; } catch (_) {}
      var html = "";
      try { html = ((doc.documentElement && doc.documentElement.innerHTML) || "").slice(0, 500000); } catch (_) {}
      if (/shopify/i.test(generator) || /cdn\.shopify\.com|Shopify\.theme/i.test(html)) return { id: "shopify", name: "Shopify 商店" };
      if (/woocommerce/i.test(generator) || /wp-content\/plugins\/woocommerce/i.test(html)) return { id: "woocommerce", name: "WooCommerce 商店" };
      if (/bigcommerce/i.test(generator) || /cdn11\.bigcommerce\.com/i.test(html)) return { id: "bigcommerce", name: "BigCommerce 商店" };
      if (/magento/i.test(generator) || /Magento_/i.test(html)) return { id: "magento", name: "Magento 商店" };
    }
    return { id: "generic", name: "电商页面" };
  }

  function pageTitle(doc) {
    var candidates = [];
    candidates.push(metaContent(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']));
    var h1 = doc.querySelector("h1");
    if (h1) candidates.push((h1.textContent || "").trim());
    candidates.push((doc.title || "").trim());
    for (var i = 0; i < candidates.length; i++) {
      var text = String(candidates[i] || "").replace(/\s+/g, " ").trim();
      if (text.length >= 3) return text.slice(0, 180);
    }
    return "未命名商品";
  }

  function addCandidate(list, raw, opts) {
    opts = opts || {};
    var upgraded = upgradeUrl(raw, opts.base);
    if (!upgraded || !isImageUrl(upgraded.url)) return false;
    list.push({
      url: upgraded.url,
      upgraded: upgraded.upgraded,
      width: Number(opts.width) || 0,
      height: Number(opts.height) || 0,
      alt: String(opts.alt || "").replace(/\s+/g, " ").trim().slice(0, 180),
      featured: !!opts.featured,
      primary: !!opts.primary,
      source: opts.source || "page",
      order: Number(opts.order) || 999,
      inChrome: !!opts.inChrome,
      background: !!opts.background
    });
    return true;
  }

  function collect(doc, featuredUrls) {
    var out = [];
    var order = 0;
    var seenAttr = new Set();

    function add(raw, opts) {
      opts = opts || {};
      opts.base = opts.base || (doc.baseURI || undefined);
      opts.order = opts.order == null ? order++ : opts.order;
      addCandidate(out, raw, opts);
    }

    // Official product metadata gets first-class treatment.
    var metaSelectors = [
      'meta[property="og:image:secure_url"]', 'meta[property="og:image"]',
      'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]',
      'link[rel="image_src"]', 'meta[itemprop="image"]'
    ];
    for (var m = 0; m < metaSelectors.length; m++) {
      var el = doc.querySelector(metaSelectors[m]);
      if (!el) continue;
      add(el.getAttribute("content") || el.getAttribute("href"), { featured: true, primary: true, source: "meta", order: -100 + m });
    }

    for (var f = 0; f < featuredUrls.length; f++) {
      add(featuredUrls[f], { featured: true, source: "structured-data", order: -80 + f });
    }

    // Site-specific hero selectors.
    var heroSelectors = [
      "#landingImage", "#imgTagWrapperId img", "#imageBlock img", "#J_ImgBooth",
      "#J_UlThumb img", ".product-gallery img", ".product__media img",
      ".product-single__photo img", ".product-single__media img", ".product-image img",
      '[data-testid="hero-image"]', '[data-product-featured-image]', ".pdp-image img",
      ".swiper-slide img", ".magnifier-image", ".detail-gallery img", ".gallery img",
      ".carousel img", ".thumbnails img", ".product-photo img"
    ];
    for (var s = 0; s < heroSelectors.length; s++) {
      var nodes;
      try { nodes = doc.querySelectorAll(heroSelectors[s]); } catch (_) { continue; }
      for (var n = 0; n < nodes.length && n < 24; n++) {
        var node = nodes[n];
        add(node.currentSrc || node.getAttribute("src") || node.getAttribute("data-src"), {
          width: readDim(node, "width", "naturalWidth"),
          height: readDim(node, "height", "naturalHeight"),
          alt: node.getAttribute("alt"),
          featured: s < 4,
          primary: s < 4,
          source: "gallery",
          order: order++,
          inChrome: isInChrome(node)
        });
        var zoom = node.getAttribute("data-zoom-image") || node.getAttribute("data-large-image") || node.getAttribute("data-old-hires") || node.getAttribute("data-high-res-src");
        if (zoom) add(zoom, { featured: true, primary: true, source: "gallery-hires", order: order++ });
      }
    }

    // Every image on the page, including common lazy-load attributes.
    var imgs = doc.querySelectorAll("img");
    for (var i = 0; i < imgs.length && i < 900; i++) {
      var img = imgs[i];
      var attrs = [
        "currentSrc", "src", "data-src", "data-lazy-src", "data-original",
        "data-zoom-image", "data-large-image", "data-image", "data-old-hires",
        "data-high-res-src", "data-src-large", "data-full", "data-zoom"
      ];
      var alt = img.getAttribute("alt") || img.getAttribute("title") || "";
      var width = readDim(img, "width", "naturalWidth");
      var height = readDim(img, "height", "naturalHeight");
      var inChrome = isInChrome(img);
      for (var a = 0; a < attrs.length; a++) {
        var value = img.getAttribute(attrs[a]);
        if (!value) continue;
        var cacheKey = value + "|" + width + "x" + height;
        if (seenAttr.has(cacheKey)) continue;
        seenAttr.add(cacheKey);
        add(value, { width: width, height: height, alt: alt, source: "img", order: order++, inChrome: inChrome });
      }
      if (img.currentSrc) add(img.currentSrc, { width: width, height: height, alt: alt, source: "img-current", order: order++, inChrome: inChrome });
      var dynamic = img.getAttribute("data-a-dynamic-image");
      if (dynamic) {
        var variants = parseDynamicImage(dynamic);
        for (var d = 0; d < variants.length; d++) {
          add(variants[d], { alt: alt, featured: d === 0, source: "amazon-dynamic", order: order++ });
        }
      }
    }

    var sources = doc.querySelectorAll("picture source[srcset], img[srcset]");
    for (var p = 0; p < sources.length && p < 300; p++) {
      var srcset = sources[p].getAttribute("srcset") || "";
      var urls = parseSrcset(srcset);
      for (var u = 0; u < urls.length; u++) {
        add(urls[u], { alt: sources[p].getAttribute("alt") || "", source: "srcset", order: order++ });
      }
    }

    // Zoom links and around-the-image anchors.
    var links = doc.querySelectorAll('a[href$=".jpg"], a[href$=".jpeg"], a[href$=".png"], a[href$=".webp"], a[data-lightbox], a[data-fancybox]');
    for (var l = 0; l < links.length && l < 80; l++) {
      var href = links[l].getAttribute("href") || links[l].getAttribute("data-src") || "";
      if (href) add(href, { source: "zoom-link", order: order++ });
    }

    // CSS backgrounds are used by several Chinese and marketplace galleries.
    var bgNodes = doc.querySelectorAll('[style*="background-image"]');
    for (var b = 0; b < bgNodes.length && b < 220; b++) {
      var style = bgNodes[b].getAttribute("style") || "";
      var match = style.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
      if (!match || !match[2]) continue;
      var bgW = 0, bgH = 0;
      try { bgW = bgNodes[b].offsetWidth || 0; bgH = bgNodes[b].offsetHeight || 0; } catch (_) {}
      add(match[2], { width: bgW, height: bgH, source: "background", order: order++, inChrome: isInChrome(bgNodes[b]), background: true });
    }

    var posters = doc.querySelectorAll("video[poster]");
    for (var v = 0; v < posters.length && v < 20; v++) {
      add(posters[v].getAttribute("poster"), { source: "video-poster", order: order++ });
    }
    return out;
  }

  function readDim(el, attr, natural) {
    var value = 0;
    try { value = Number(el[natural]) || 0; } catch (_) {}
    if (!value) {
      try { value = parseFloat(el.getAttribute(attr)) || 0; } catch (_) {}
    }
    return value;
  }

  function isInChrome(el) {
    try {
      var node = el;
      while (node && node.nodeType === 1) {
        if (CHROME_TAGS[node.tagName]) return true;
        node = node.parentElement;
      }
    } catch (_) {}
    return false;
  }

  function scoreCandidate(item) {
    var score = 0;
    if (item.primary) score += 3000000;
    if (item.featured) score += 1000000;
    if (item.source === "gallery" || item.source === "gallery-hires") score += 500000;
    if (item.source === "structured-data" || item.source === "meta") score += 400000;
    if (item.source === "amazon-dynamic") score += 200000;
    if (item.inChrome) score -= 350000;
    if (item.width && item.height) score += Math.min(180000, Math.sqrt(item.width * item.height) * 90);
    if (item.alt) score += Math.min(5000, item.alt.length * 15);
    if (BAD_PATH_RE.test(item.url)) score -= 120000;
    return score - (item.order || 0) * 0.01;
  }

  function normalizeCandidate(item, minDimension) {
    var width = item.width || 0;
    var height = item.height || 0;
    if (!item.featured && width && height) {
      var shortSide = Math.min(width, height);
      var longSide = Math.max(width, height);
      if (shortSide < minDimension) return false;
      if (longSide / shortSide > 6.5) return false;
    }
    if (!item.featured && item.inChrome && !(width && height && width * height > 400000)) return false;
    return true;
  }

  function scanDocument(doc, locationLike, options) {
    options = options || {};
    var started = Date.now();
    var loc = locationLike || (doc && doc.location) || { href: "https://example.com/", hostname: "example.com" };
    var hostname = loc.hostname || (safeUrl(loc.href) || {}).hostname || "";
    var site = detectSite(hostname, doc);
    var minDimension = Number(options.minDimension) || 160;

    var featured = extractJsonLd(doc);
    if (Array.isArray(options.extraImages)) {
      for (var e = 0; e < options.extraImages.length; e++) {
        var extra = options.extraImages[e];
        featured.push(typeof extra === "string" ? extra : extra && extra.url);
      }
    }

    var candidates = collect(doc, featured.filter(Boolean));
    if (options.extraImages) {
      for (var x = 0; x < options.extraImages.length; x++) {
        var item = options.extraImages[x];
        if (typeof item === "string") {
          addCandidate(candidates, item, { base: loc.href, featured: true, primary: true, source: "site-api" });
        } else if (item && item.url) {
          addCandidate(candidates, item.url, {
            base: loc.href, featured: true, primary: !!item.featured, source: "site-api",
            width: item.width, height: item.height, alt: item.alt
          });
        }
      }
    }

    var byKey = {};
    var upgradedCount = 0;
    var smallCount = 0;
    var duplicateCount = 0;

    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      if (!normalizeCandidate(candidate, minDimension)) { smallCount++; continue; }
      if (candidate.upgraded) upgradedCount++;
      var key = imageKey(candidate.url);
      var existing = byKey[key];
      if (!existing) {
        byKey[key] = candidate;
        continue;
      }
      duplicateCount++;
      // Keep the largest observed dimensions and the strongest provenance.
      existing.width = Math.max(existing.width || 0, candidate.width || 0);
      existing.height = Math.max(existing.height || 0, candidate.height || 0);
      existing.featured = existing.featured || candidate.featured;
      existing.primary = existing.primary || candidate.primary;
      existing.source = strongerSource(existing.source, candidate.source);
      existing.inChrome = existing.inChrome && candidate.inChrome;
      existing.alt = existing.alt || candidate.alt;
      existing.order = Math.min(existing.order, candidate.order);
    }

    var result = Object.keys(byKey).map(function (key) { return byKey[key]; });
    result.forEach(function (item) { item.score = scoreCandidate(item); });
    result.sort(function (a, b) { return b.score - a.score; });
    if (result.length > MAX_IMAGES) result = result.slice(0, MAX_IMAGES);

    for (var r = 0; r < result.length; r++) {
      result[r].id = r;
      result[r].featured = !!(result[r].featured && r < 6);
    }

    return {
      ok: true,
      version: VERSION,
      site: site,
      page: {
        url: loc.href,
        host: hostname.replace(/^www\./i, ""),
        title: pageTitle(doc),
        favicon: faviconUrl(doc, loc)
      },
      images: result,
      stats: {
        found: candidates.length,
        unique: result.length,
        duplicates: duplicateCount,
        upgraded: upgradedCount,
        small: smallCount,
        ms: Date.now() - started
      }
    };
  }

  function strongerSource(a, b) {
    var rank = { "meta": 5, "structured-data": 5, "gallery-hires": 5, "gallery": 4, "amazon-dynamic": 3, "site-api": 4, "srcset": 2, "img": 1, "img-current": 2, "background": 1, "zoom-link": 2, "video-poster": 1, "page": 1 };
    return (rank[b] || 0) > (rank[a] || 0) ? b : a;
  }

  function faviconUrl(doc, loc) {
    try {
      var icon = doc.querySelector('link[rel~="icon"]');
      if (icon && icon.getAttribute("href")) {
        var url = safeUrl(icon.getAttribute("href"), loc.href);
        if (url) return url.href;
      }
      var origin = new URL(loc.href).origin;
      return origin + "/favicon.ico";
    } catch (_) {
      return "";
    }
  }

  return {
    VERSION: VERSION,
    MAX_IMAGES: MAX_IMAGES,
    SITES: SITES,
    safeUrl: safeUrl,
    upgradeUrl: upgradeUrl,
    imageKey: imageKey,
    isImageUrl: isImageUrl,
    parseSrcset: parseSrcset,
    detectSite: detectSite,
    pageTitle: pageTitle,
    scanDocument: scanDocument
  };
});
