import { chromium } from "playwright";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = path.join(root, ".tmp-profile");
const extension = path.join(root, "extension");
const assets = path.join(root, "site", "assets");
await rm(profile, { recursive: true, force: true });

const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  viewport: { width: 400, height: 600 },
  deviceScaleFactor: 2,
  locale: "zh-CN",
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--host-resolver-rules=MAP northandloom.example 127.0.0.1"
  ]
});

try {
  const page = await context.newPage();
  await page.goto("http://northandloom.example:4173/products/linen-lounge-chair", { waitUntil: "networkidle" });
  await page.bringToFront();

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: "http://northandloom.example:4173/*" });
    return tabs[0] && tabs[0].id;
  });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`, { waitUntil: "domcontentloaded" });
  await popup.waitForSelector("#imageGrid:not([hidden])", { timeout: 30000 });
  await popup.waitForTimeout(1200);

  await popup.screenshot({ path: path.join(assets, "usage-scan.png") });
  console.log("captured usage-scan");

  // Show a realistic selection: keep the hero and five detail images selected.
  await popup.locator(".card").nth(6).click();
  await popup.locator(".card").nth(8).click();
  await popup.waitForTimeout(400);
  console.log("selected count after toggle:", await popup.locator("#selectedCount").textContent());
  await popup.screenshot({ path: path.join(assets, "usage-select.png") });
  console.log("captured usage-select");

  await popup.locator("#zipBtn").click();
  await popup.waitForSelector("#overlay.is-success", { timeout: 90000 });
  await popup.waitForTimeout(700);
  await popup.screenshot({ path: path.join(assets, "usage-zip.png") });
  console.log("captured usage-zip:", await popup.locator("#progressText").textContent());

  await popup.locator("#closeOverlayBtn").click();
  await popup.locator("#singleBtn").click();
  await popup.waitForFunction(() => document.querySelector("#progressTitle")?.textContent === "逐张下载已开始", { timeout: 60000 });
  await popup.waitForTimeout(700);
  await popup.screenshot({ path: path.join(assets, "usage-individual.png") });
  console.log("captured usage-individual");

  // A clean product-page shot for the usage gallery.
  const shot = await context.newPage();
  await shot.setViewportSize({ width: 1440, height: 1000 });
  await shot.goto("http://northandloom.example:4173/products/linen-lounge-chair", { waitUntil: "networkidle" });
  await shot.waitForTimeout(700);
  await shot.screenshot({ path: path.join(assets, "usage-product.png") });
  console.log("captured usage-product");
} finally {
  await context.close();
}
