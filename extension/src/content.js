/*
 * PicHarvest / 图仓 — content runtime
 * Injected on demand with chrome.scripting. Adds one message listener and
 * performs all extraction locally in the page.
 */
(function () {
  "use strict";
  if (window.__PIC_HARVEST_READY__) return;
  window.__PIC_HARVEST_READY__ = true;

  var core = window.PicHarvestCore;
  if (!core) return;

  async function shopifyExtras() {
    var extras = [];
    var isProduct = /\/products\//i.test(location.pathname);
    if (!isProduct) return extras;
    var isShopify = !!(window.Shopify && (window.Shopify.shop || window.Shopify.theme));
    if (!isShopify && !/(^|\.)myshopify\.com$/i.test(location.hostname) && !/cdn\.shopify\.com/i.test(document.documentElement.innerHTML.slice(0, 120000))) return extras;

    // Official product endpoint: stable, high-resolution images without scraping carousels.
    try {
      var endpoint = location.origin + location.pathname.replace(/\/+$/, "") + ".js";
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 1800);
      var response = await fetch(endpoint, {
        credentials: "same-origin",
        signal: controller.signal,
        headers: { "Accept": "application/json" }
      });
      clearTimeout(timer);
      if (response.ok) {
        var data = await response.json();
        if (data && Array.isArray(data.images)) {
          data.images.forEach(function (src, index) {
            if (typeof src !== "string") return;
            var url = src.indexOf("//") === 0 ? "https:" + src : src;
            extras.push({ url: url, featured: index === 0, alt: data.title || "" });
          });
        }
      }
    } catch (_) { /* The DOM scan remains a complete fallback. */ }

    // Theme globals are available even when the .js endpoint is proxied.
    try {
      var product = window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product;
      if (product && Array.isArray(product.images)) {
        product.images.forEach(function (src) { if (typeof src === "string") extras.push({ url: src, featured: false }); });
      }
    } catch (_) {}
    return extras;
  }

  async function scanPage() {
    var extras = [];
    try { extras = await shopifyExtras(); } catch (_) {}
    return core.scanDocument(document, location, { extraImages: extras, minDimension: 140 });
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.type) return;
    if (message.type === "PIC_HARVEST_PING") {
      sendResponse({ ok: true, version: core.VERSION });
      return;
    }
    if (message.type === "PIC_HARVEST_SCAN") {
      scanPage().then(function (result) {
        sendResponse(result);
      }).catch(function (error) {
        sendResponse({ ok: false, error: String(error && error.message || error) });
      });
      return true;
    }
  });
})();
