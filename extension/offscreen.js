/* global chrome, JSZip */
"use strict";

const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 280 * 1024 * 1024;
const FETCH_CONCURRENCY = 4;
let building = false;

function safeName(value, fallback) {
  let name = String(value || "")
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 64)
    .trim();
  if (!name) name = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) name = `_${name}`;
  return name;
}

function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function extensionFor(blob, url) {
  const type = (blob.type || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("avif")) return "avif";
  if (type.includes("gif")) return "gif";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  try {
    const match = new URL(url).pathname.match(/\.(jpe?g|png|webp|avif|gif)$/i);
    if (match) return match[1].toLowerCase().replace("jpeg", "jpg");
  } catch (_) {}
  return "jpg";
}

async function looksLikeImage(blob) {
  if (blob.size < 1024) return false;
  const type = (blob.type || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (head[0] === 0xff && head[1] === 0xd8) return true; // JPEG
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return true; // PNG
  if (String.fromCharCode(...head.slice(0, 4)) === "RIFF" && String.fromCharCode(...head.slice(8, 12)) === "WEBP") return true;
  if (String.fromCharCode(...head.slice(0, 3)) === "GIF") return true;
  if (String.fromCharCode(...head.slice(4, 12)) === "ftypavif") return true;
  return false;
}

let lastProgress = 0;
async function progress(message) {
  const now = Date.now();
  if (message.phase === "fetch" && now - lastProgress < 120) return;
  lastProgress = now;
  try {
    await chrome.runtime.sendMessage(Object.assign({ target: "popup", type: "PIC_HARVEST_PROGRESS" }, message));
  } catch (_) {}
}

async function fetchOne(image) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(image.url, {
      credentials: "omit",
      cache: "force-cache",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length")) || 0;
    if (declared > MAX_IMAGE_BYTES) throw new Error("图片超过 40 MB");
    const blob = await response.blob();
    if (blob.size > MAX_IMAGE_BYTES) throw new Error("图片超过 40 MB");
    if (!(await looksLikeImage(blob))) throw new Error("返回内容不是图片");
    return blob;
  } finally {
    clearTimeout(timer);
  }
}

async function buildZip(payload) {
  if (building) return { ok: false, error: "已有打包任务正在进行，请稍候" };
  building = true;
  const started = Date.now();
  try {
    const images = Array.isArray(payload.images) ? payload.images.slice(0, 80) : [];
    if (!images.length) return { ok: false, error: "没有可下载的图片" };
    const title = safeName(payload.title || "商品图片", "商品图片");
    const zip = new JSZip();
    const folderName = safeName(title, "images");
    const folder = zip.folder(folderName);
    const used = new Set();
    const failures = [];
    let success = 0;
    let bytes = 0;
    let cursor = 0;
    let finished = 0;

    await progress({ phase: "fetch", done: 0, total: images.length });

    async function worker() {
      while (cursor < images.length) {
        const index = cursor++;
        const image = images[index];
        try {
          if (bytes > MAX_TOTAL_BYTES) throw new Error("压缩包已超过 280 MB 上限");
          const blob = await fetchOne(image);
          if (bytes + blob.size > MAX_TOTAL_BYTES) throw new Error("达到 280 MB 压缩包上限");
          bytes += blob.size;
          success++;
          const ext = extensionFor(blob, image.url);
          const base = safeName(image.alt || `image-${String(index + 1).padStart(3, "0")}`, `image-${index + 1}`);
          let name = `${String(index + 1).padStart(3, "0")}_${base}.${ext}`;
          let suffix = 2;
          while (used.has(name.toLowerCase())) {
            name = `${String(index + 1).padStart(3, "0")}_${base}-${suffix}.${ext}`;
            suffix++;
          }
          used.add(name.toLowerCase());
          folder.file(name, blob);
        } catch (error) {
          failures.push({
            url: image.url,
            reason: String(error && error.name === "AbortError" ? "请求超时" : (error && error.message) || error)
          });
        }
        finished++;
        await progress({ phase: "fetch", done: finished, total: images.length, success });
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(FETCH_CONCURRENCY, images.length); i++) workers.push(worker());
    await Promise.all(workers);

    if (!success) {
      return { ok: false, error: "所有图片都无法访问，请尝试逐张下载", failures };
    }

    const zipBlob = await zip.generateAsync(
      { type: "blob", compression: "STORE", platform: "DOS", streamFiles: true },
      (meta) => {
        progress({ phase: "zip", percent: Math.round(meta.percent), success });
      }
    );
    const blobUrl = URL.createObjectURL(zipBlob);
    const filename = `PicHarvest_${safeName(title, "商品图片")}_${dateStamp()}.zip`;
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10 * 60 * 1000);
    return {
      ok: true,
      blobUrl,
      filename,
      count: success,
      bytes: zipBlob.size,
      failures,
      ms: Date.now() - started
    };
  } finally {
    building = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== "offscreen") return;
  if (message.type === "PING") {
    sendResponse({ ok: true, ready: true });
    return;
  }
  if (message.type === "BUILD_ZIP") {
    buildZip(message).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: String(error && error.message || error) });
    });
    return true;
  }
  return false;
});
