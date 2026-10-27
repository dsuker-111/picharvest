import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const core = require("../extension/src/extractor.js");

function scan(html, url, options = {}) {
  const dom = new JSDOM(html, { url });
  return core.scanDocument(dom.window.document, dom.window.location, options);
}

test("upgrades Amazon image variants to the original asset", () => {
  assert.equal(
    core.upgradeUrl("https://m.media-amazon.com/images/I/71Example._AC_SL300_.jpg").url,
    "https://m.media-amazon.com/images/I/71Example.jpg"
  );
  assert.equal(
    core.upgradeUrl("https://m.media-amazon.com/images/I/71Example._SX300_SY300_QL70_FMwebp_.jpg").url,
    "https://m.media-amazon.com/images/I/71Example.jpg"
  );
});

test("upgrades marketplace CDN resize suffixes", () => {
  assert.equal(
    core.upgradeUrl("https://cbu01.alicdn.com/img/ibank/O1CN123.jpg_640x640.jpg").url,
    "https://cbu01.alicdn.com/img/ibank/O1CN123.jpg"
  );
  assert.equal(
    core.upgradeUrl("https://i.ebayimg.com/images/g/abc/s-l64.jpg").url,
    "https://i.ebayimg.com/images/g/abc/s-l1600.jpg"
  );
  assert.equal(
    core.upgradeUrl("https://i.etsystatic.com/123/r/il/abc/456/il_340x270.789_xyz.jpg").url,
    "https://i.etsystatic.com/123/r/il/abc/456/il_fullxfull.789_xyz.jpg"
  );
  assert.equal(
    core.upgradeUrl("https://cdn.shopify.com/s/files/1/0001/products/chair_800x800.jpg?v=123").url,
    "https://cdn.shopify.com/s/files/1/0001/products/chair.jpg?v=123"
  );
  assert.equal(
    core.upgradeUrl("https://img14.360buyimg.com/n1/s450x450_jfs/t1/abc.jpg").url,
    "https://img14.360buyimg.com/n0/jfs/t1/abc.jpg"
  );
});

test("deduplicates thumbnail variants and prefers official product metadata", () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Cloud Runner 运动鞋">
    <meta property="og:image" content="https://m.media-amazon.com/images/I/hero._AC_SL1500_.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Cloud Runner","image":["https://m.media-amazon.com/images/I/detail._AC_SL1200_.jpg"]}</script>
  </head><body>
    <header><img src="https://example.com/logo.png" width="120" height="40" alt="shop logo"></header>
    <img id="landingImage" src="https://m.media-amazon.com/images/I/hero._AC_SL300_.jpg" data-old-hires="https://m.media-amazon.com/images/I/hero._AC_SL1500_.jpg" width="300" height="300" alt="Cloud Runner">
    <div id="altImages">
      <img src="https://m.media-amazon.com/images/I/detail._AC_SL300_.jpg" width="300" height="300" alt="侧视图">
      <img src="https://m.media-amazon.com/images/I/detail._AC_SL1200_.jpg" width="1200" height="1200" alt="侧视图大图">
      <img src="https://example.com/tiny.png" width="24" height="24" alt="rating star">
    </div>
  </body></html>`;
  const result = scan(html, "https://www.amazon.com/dp/B012345", { minDimension: 160 });
  assert.equal(result.ok, true);
  assert.equal(result.site.id, "amazon");
  assert.equal(result.page.title, "Cloud Runner 运动鞋");
  assert.ok(result.images.length >= 2);
  assert.equal(result.images[0].url, "https://m.media-amazon.com/images/I/hero.jpg");
  assert.equal(result.images[0].featured, true);
  assert.ok(result.images.some((image) => image.url.includes("detail.jpg")));
  assert.ok(result.stats.duplicates >= 1);
  assert.ok(result.stats.upgraded >= 2);
});

test("captures lazy-loaded images and srcset candidates", () => {
  const html = `<!doctype html><html><head><title>Linen Chair | North Shop</title></head><body>
    <h1>Linen Lounge Chair</h1>
    <img data-src="https://shop.example/cdn/chair_400x400.jpg" width="400" height="400" alt="chair">
    <picture><source srcset="https://shop.example/cdn/chair_1600.jpg 1600w, https://shop.example/cdn/chair_800.jpg 800w"></picture>
  </body></html>`;
  const result = scan(html, "https://shop.example/products/linen-chair", { minDimension: 160 });
  assert.equal(result.page.title, "Linen Lounge Chair");
  assert.ok(result.images.some((image) => image.url.endsWith("chair_400x400.jpg")));
  assert.ok(result.images.some((image) => image.url.endsWith("chair_1600.jpg")));
  assert.ok(result.images.some((image) => image.url.endsWith("chair_800.jpg")));
});

test("minimum dimension filter keeps large images and drops icons", () => {
  const html = `<!doctype html><html><body>
    <img src="https://cdn.example/big.jpg" width="1600" height="1600" alt="big">
    <img src="https://cdn.example/mid.jpg" width="500" height="500" alt="mid">
    <img src="https://cdn.example/icon.jpg" width="32" height="32" alt="icon">
  </body></html>`;
  const result = scan(html, "https://shop.example/p/1", { minDimension: 400 });
  assert.deepEqual(result.images.map((image) => image.url).sort(), [
    "https://cdn.example/big.jpg",
    "https://cdn.example/mid.jpg"
  ]);
});

test("ignores non-image and tracking requests", () => {
  const html = `<!doctype html><html><body>
    <img src="https://www.google-analytics.com/collect?x=1" width="300" height="300">
    <img src="https://cdn.example/product.svg" width="300" height="300">
    <img src="data:image/png;base64,AAAA" width="300" height="300">
    <img src="https://cdn.example/real.webp" width="900" height="900" alt="real">
  </body></html>`;
  const result = scan(html, "https://shop.example/p/1");
  assert.deepEqual(result.images.map((image) => image.url), ["https://cdn.example/real.webp"]);
});

test("detects software from metadata on custom domains", () => {
  const html = `<!doctype html><html><head><meta name="generator" content="Shopify"></head><body></body></html>`;
  const result = scan(html, "https://independent-store.example/products/thing");
  assert.equal(result.site.id, "shopify");
  assert.equal(result.site.name, "Shopify 商店");
});
