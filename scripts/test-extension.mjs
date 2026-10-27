import { chromium } from "playwright";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = path.join(root, ".tmp-profile");
const extension = path.join(root, "extension");
const screenshot = path.join(root, "site", "assets", "popup-screenshot.png");

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
  console.log(`Extension loaded: ${extensionId}`);

  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: "http://northandloom.example:4173/*" });
    return tabs[0] && tabs[0].id;
  });
  if (!tabId) throw new Error("Could not find fixture tab");
  console.log(`Fixture tab: ${tabId}`);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`, { waitUntil: "domcontentloaded" });
  await popup.waitForSelector("#imageGrid:not([hidden])", { timeout: 30000 });
  await popup.waitForTimeout(1200);

  const count = await popup.locator("#countNum").textContent();
  const title = await popup.locator("#pageTitle").textContent();
  const site = await popup.locator("#sitePill").textContent();
  const cards = await popup.locator(".card").count();
  const thumbs = await popup.locator(".card .thumb").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src")));
  console.log(JSON.stringify({ title, site, count, cards, thumbs }, null, 2));

  await popup.screenshot({ path: screenshot });
  console.log(`Screenshot: ${screenshot}`);

  await popup.locator("#zipBtn").click();
  await popup.waitForSelector("#overlay.is-success", { timeout: 90000 });
  const resultText = await popup.locator("#progressText").textContent();
  console.log(`ZIP UI: ${resultText}`);

  await popup.waitForTimeout(1500);
  const downloads = await worker.evaluate(async () => {
    const items = await chrome.downloads.search({ limit: 20, orderBy: ["-startTime"] });
    return items.map((item) => ({
      filename: item.filename,
      state: item.state,
      bytesReceived: item.bytesReceived,
      totalBytes: item.totalBytes,
      error: item.error || ""
    }));
  });
  console.log(JSON.stringify(downloads, null, 2));
  // Playwright renames browser-initiated downloads to a temp UUID; inspect the payload itself.
  const zip = downloads.slice().sort((a, b) => b.bytesReceived - a.bytesReceived)[0];
  if (!zip) throw new Error("No download was created");
  if (zip.state !== "complete") throw new Error(`Download state: ${zip.state} ${zip.error}`);
  const info = await stat(zip.filename);
  const data = await readFile(zip.filename);
  if (data[0] !== 0x50 || data[1] !== 0x4b) throw new Error("Downloaded file is not a ZIP archive");
  const entries = Object.values((await JSZip.loadAsync(data)).files).filter((entry) => !entry.dir);
  console.log(`ZIP verified: ${info.size} bytes, ${entries.length} files`);
  console.log(entries.map((entry) => entry.name).join("\n"));
  if (!entries.length) throw new Error("ZIP has no image entries");

  // Individual downloads use the browser downloader, which also covers CDNs that block fetch().
  await popup.locator("#closeOverlayBtn").click();
  await popup.locator("#singleBtn").click();
  await popup.waitForFunction(() => document.querySelector("#progressTitle")?.textContent === "逐张下载已开始", { timeout: 60000 });
  await popup.waitForTimeout(2200);
  const afterIndividual = await worker.evaluate(async () => {
    const items = await chrome.downloads.search({ limit: 40, orderBy: ["-startTime"] });
    return items.filter((item) => item.state === "complete").length;
  });
  console.log(`Individual downloads completed: ${afterIndividual}`);
  if (afterIndividual < 10) throw new Error("Individual download tasks were not created");

  const errorTabId = await worker.evaluate(() => new Promise((resolve) => {
    chrome.tabs.create({ url: "chrome://newtab/" }, (tab) => resolve(tab.id));
  }));
  const errorPopup = await context.newPage();
  await errorPopup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${errorTabId}`, { waitUntil: "domcontentloaded" });
  await errorPopup.waitForSelector("#errorState:not([hidden])", { timeout: 10000 });
  console.log(`Restricted page guard: ${await errorPopup.locator("#errorTitle").textContent()}`);
} finally {
  await context.close();
}
