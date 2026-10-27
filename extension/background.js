/* global chrome */
"use strict";

const OFFSCREEN_URL = "offscreen.html";
const MAX_ZIP_IMAGES = 80;
const MAX_INDIVIDUAL_IMAGES = 60;
let creatingOffscreen = null;

function extensionDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function safeFilename(value, fallback = "product") {
  let name = String(value || "")
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 90)
    .trim();
  if (!name) name = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) name = `_${name}`;
  return name;
}

function imageExtension(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const match = path.match(/\.(jpe?g|png|webp|avif|gif)$/);
    if (match) return match[1].replace("jpeg", "jpg");
  } catch (_) { /* use jpg */ }
  return "jpg";
}

function validImages(images, limit) {
  if (!Array.isArray(images)) return [];
  const seen = new Set();
  const result = [];
  for (const image of images) {
    const url = typeof image === "string" ? image : image && image.url;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    result.push({
      url,
      alt: String((image && image.alt) || "").slice(0, 160)
    });
    if (result.length >= limit) break;
  }
  return result;
}

async function broadcast(message) {
  try {
    await chrome.runtime.sendMessage(Object.assign({ target: "popup" }, message));
  } catch (_) {
    // The popup is allowed to close while a download is running.
  }
}

async function hasOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
    });
    return contexts.length > 0;
  }
  return false;
}

async function pingOffscreen() {
  for (let i = 0; i < 20; i++) {
    try {
      const result = await chrome.runtime.sendMessage({ target: "offscreen", type: "PING" });
      if (result && result.ok) return true;
    } catch (_) { /* not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function ensureOffscreen() {
  if (await hasOffscreenDocument()) return true;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["BLOBS"],
      justification: "在本地抓取图片并生成 ZIP 压缩包"
    }).finally(() => { creatingOffscreen = null; });
  }
  try {
    await creatingOffscreen;
  } catch (error) {
    if (!/single offscreen|already/i.test(String(error && error.message))) throw error;
  }
  return pingOffscreen();
}

async function downloadZip(payload) {
  const images = validImages(payload.images, MAX_ZIP_IMAGES);
  if (!images.length) return { ok: false, error: "请先选择要下载的图片" };
  await ensureOffscreen();
  await broadcast({ type: "PIC_HARVEST_PROGRESS", phase: "prepare", done: 0, total: images.length });

  const result = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "BUILD_ZIP",
    images,
    title: payload.title || "商品图片"
  });

  if (!result || !result.ok || !result.blobUrl) {
    return { ok: false, error: (result && result.error) || "ZIP 生成失败，请改用逐张下载" };
  }

  const downloadId = await chrome.downloads.download({
    url: result.blobUrl,
    filename: result.filename,
    saveAs: false,
    conflictAction: "uniquify"
  });
  await broadcast({
    type: "PIC_HARVEST_DONE",
    mode: "zip",
    downloadId,
    count: result.count,
    bytes: result.bytes,
    failures: result.failures || [],
    filename: result.filename
  });
  return { ok: true, downloadId, count: result.count, failures: result.failures || [] };
}

async function downloadIndividual(payload) {
  const images = validImages(payload.images, MAX_INDIVIDUAL_IMAGES);
  if (!images.length) return { ok: false, error: "请先选择要下载的图片" };
  const folder = `PicHarvest/${safeFilename(payload.title || "商品图片")}_${extensionDate()}`;
  const usedNames = new Set();
  const failures = [];
  let started = 0;

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const base = safeFilename(image.alt || `image-${String(i + 1).padStart(3, "0")}`, `image-${i + 1}`);
    let ext = imageExtension(image.url);
    let name = `${folder}/${String(i + 1).padStart(3, "0")}_${base}.${ext}`;
    let n = 2;
    while (usedNames.has(name)) {
      name = `${folder}/${String(i + 1).padStart(3, "0")}_${base}-${n}.${ext}`;
      n++;
    }
    usedNames.add(name);
    try {
      await chrome.downloads.download({
        url: image.url,
        filename: name,
        saveAs: false,
        conflictAction: "uniquify"
      });
      started++;
    } catch (error) {
      failures.push({ url: image.url, reason: String(error && error.message || error) });
    }
    await broadcast({
      type: "PIC_HARVEST_PROGRESS",
      phase: "download",
      done: i + 1,
      total: images.length
    });
  }

  await broadcast({
    type: "PIC_HARVEST_DONE",
    mode: "individual",
    count: started,
    failures
  });
  return { ok: started > 0, count: started, failures };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type || message.target === "offscreen") return;
  if (message.type === "DOWNLOAD_ZIP") {
    downloadZip(message).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: String(error && error.message || error) });
    });
    return true;
  }
  if (message.type === "DOWNLOAD_INDIVIDUAL") {
    downloadIndividual(message).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: String(error && error.message || error) });
    });
    return true;
  }
  if (message.type === "SHOW_DOWNLOAD") {
    if (Number.isInteger(message.downloadId)) chrome.downloads.show(message.downloadId);
    else chrome.downloads.showDefaultFolder();
    sendResponse({ ok: true });
    return;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ installDate: "" }).then((data) => {
    if (!data.installDate) chrome.storage.local.set({ installDate: new Date().toISOString() });
  }).catch(() => {});
});
