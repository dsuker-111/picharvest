import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, ".tmp");
await mkdir(shots, { recursive: true });

const browser = await chromium.launch({ headless: true });
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await page.evaluate(() => document.querySelectorAll(".will-reveal").forEach((item) => item.classList.add("is-visible")));
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(shots, "hero-1440.png") });

const metrics = await page.evaluate(() => ({
  title: document.title,
  width: document.documentElement.scrollWidth,
  inner: window.innerWidth,
  height: document.documentElement.scrollHeight,
  images: [...document.images].map((img) => ({ src: img.getAttribute("src"), ok: img.complete && img.naturalWidth > 0, w: img.naturalWidth }))
}));
console.log(JSON.stringify(metrics, null, 2));

// Reveal everything before full-page capture.
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 500) {
    window.scrollTo(0, y);
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(shots, "home-full.png"), fullPage: true });

for (const [selector, name] of [["#features", "features"], ["#how", "how"], ["#install", "install"], ["#privacy", "privacy"], ["#platforms", "platforms"], ["#faq", "faq"], [".final-cta", "final"]]) {
  const locator = page.locator(selector);
  if (await locator.count()) {
    await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(350);
    await locator.screenshot({ path: path.join(shots, `${name}.png`) });
  }
}

const overflow = [];
for (const width of [1180, 1024, 900, 768, 430, 390]) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.querySelectorAll(".will-reveal").forEach((item) => item.classList.add("is-visible")));
  await page.waitForTimeout(350);
  const result = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));
  if (result.scrollWidth > result.innerWidth + 1) overflow.push({ width, ...result });
  if (width === 390) {
    await page.screenshot({ path: path.join(shots, "mobile-390.png"), fullPage: true });
    for (const [selector, name] of [["#features", "m-features"], ["#how", "m-how"], ["#install", "m-install"], ["#privacy", "m-privacy"], ["#platforms", "m-platforms"], [".final-cta", "m-final"]]) {
      const locator = page.locator(selector);
      if (await locator.count()) {
        await locator.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        await locator.screenshot({ path: path.join(shots, `${name}.png`) });
      }
    }
  }
}
console.log("Overflow:", JSON.stringify(overflow));
console.log("Errors:", JSON.stringify(errors));

const privacy = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await privacy.goto("http://127.0.0.1:4173/privacy.html", { waitUntil: "networkidle" });
await privacy.screenshot({ path: path.join(shots, "privacy-page.png"), fullPage: true });
console.log(JSON.stringify({ privacyTitle: await privacy.title() }));

await browser.close();
