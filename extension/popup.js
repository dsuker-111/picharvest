/* global chrome */
"use strict";

const $ = (id) => document.getElementById(id);
const RING_LENGTH = 169.65;
const MAX_ZIP = 80;
const MAX_INDIVIDUAL = 60;

const state = {
  tab: null,
  result: null,
  images: [],
  visible: [],
  selected: new Set(),
  minSize: 400,
  busy: false,
  scanning: false,
  downloadId: null,
  toastTimer: 0,
  completed: false,
  watermark: { enabled: false, text: "@PicHarvest 图仓", opacity: 0.45 }
};

const els = {
  pageTitle: $("pageTitle"),
  pageHost: $("pageHost"),
  sitePill: $("sitePill"),
  favicon: $("favicon"),
  faviconWrap: $("faviconWrap"),
  countNum: $("countNum"),
  dupeNote: $("dupeNote"),
  minSize: $("minSize"),
  selectAllBtn: $("selectAllBtn"),
  grid: $("imageGrid"),
  loading: $("loadingState"),
  empty: $("emptyState"),
  emptyTitle: $("emptyTitle"),
  emptyText: $("emptyText"),
  error: $("errorState"),
  errorTitle: $("errorTitle"),
  errorText: $("errorText"),
  selectedCount: $("selectedCount"),
  zipBtn: $("zipBtn"),
  zipLabel: $("zipLabel"),
  singleBtn: $("singleBtn"),
  rescanBtn: $("rescanBtn"),
  overlay: $("overlay"),
  ring: $("ringValue"),
  progressPercent: $("progressPercent"),
  progressVisual: $("progressVisual"),
  progressTitle: $("progressTitle"),
  progressText: $("progressText"),
  progressActions: $("progressActions"),
  showDownloadBtn: $("showDownloadBtn"),
  closeOverlayBtn: $("closeOverlayBtn"),
  toast: $("toast"),
  wmbar: $("wmbar"),
  watermarkChk: $("watermarkChk"),
  watermarkText: $("watermarkText"),
  watermarkOpacity: $("watermarkOpacity"),
  watermarkPreview: $("watermarkPreview")
};

function setStateView(view, title, text) {
  els.loading.hidden = view !== "loading";
  els.grid.hidden = view !== "grid";
  els.empty.hidden = view !== "empty";
  els.error.hidden = view !== "error";
  if (view === "empty" && title) {
    els.emptyTitle.textContent = title;
    els.emptyText.textContent = text || "";
  }
  if (view === "error" && title) {
    els.errorTitle.textContent = title;
    els.errorText.textContent = text || "";
  }
}

function setPageContext(result) {
  const page = result.page || {};
  const title = page.title || (state.tab && state.tab.title) || "当前商品页";
  els.pageTitle.textContent = title;
  els.pageTitle.title = title;
  els.pageHost.textContent = page.host || hostOf(state.tab && state.tab.url);
  const site = result.site || { id: "generic", name: "电商页面" };
  els.sitePill.textContent = site.name;
  els.sitePill.classList.toggle("is-known", site.id !== "generic");
  els.sitePill.title = site.name;

  const favicon = page.favicon || "";
  els.faviconWrap.classList.remove("is-broken");
  if (favicon) {
    els.favicon.src = favicon;
  } else {
    els.favicon.removeAttribute("src");
    els.faviconWrap.classList.add("is-broken");
  }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return "当前页面"; }
}

function isRestricted(url) {
  if (!url) return true;
  return /^(chrome|edge|about|devtools|chrome-extension|moz-extension|view-source):/i.test(url) ||
    /^https:\/\/(chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons)/i.test(url);
}

function friendlyError(error) {
  const message = String((error && error.message) || error || "");
  if (/cannot access|missing host permission|extensions gallery cannot be scripted|The extensions gallery/i.test(message)) {
    return "这个页面受浏览器保护，扩展无法读取。请打开商品详情页后重试。";
  }
  if (/receiving end does not exist|could not establish connection/i.test(message)) {
    return "页面还没有准备好。请刷新商品页，再重新扫描。";
  }
  if (/frame.*removed|No tab with id|tab was closed/i.test(message)) {
    return "页面已经关闭或跳转，请重新打开商品页。";
  }
  return message.length > 110 ? "扫描时遇到问题，请刷新页面后重试。" : (message || "扫描时遇到问题，请重试。");
}

function runtimeMessage(message, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("操作超时，请重试")), timeout);
    Promise.resolve(chrome.runtime.sendMessage(message)).then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function tabMessage(tabId, message, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("读取页面超时，请重试")), timeout);
    Promise.resolve(chrome.tabs.sendMessage(tabId, message)).then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function injectScanner() {
  await chrome.scripting.executeScript({
    target: { tabId: state.tab.id },
    files: ["content.js"]
  });
}

async function scan() {
  if (state.scanning || !state.tab) return;
  state.scanning = true;
  state.completed = false;
  state.result = null;
  state.images = [];
  state.visible = [];
  state.selected.clear();
  setActionState();
  els.rescanBtn.disabled = true;
  els.rescanBtn.classList.add("is-spinning");
  setStateView("loading");
  els.countNum.textContent = "0";
  els.dupeNote.textContent = "";
  els.pageTitle.textContent = "正在读取当前页面…";
  els.pageHost.textContent = hostOf(state.tab.url);
  els.sitePill.textContent = "扫描中";
  els.sitePill.classList.remove("is-known");

  try {
    await injectScanner();
    let result;
    try {
      result = await tabMessage(state.tab.id, { type: "PIC_HARVEST_SCAN" });
    } catch (firstError) {
      // A second injection repairs the rare case where the first run was discarded by a navigation.
      await new Promise((resolve) => setTimeout(resolve, 160));
      await injectScanner();
      result = await tabMessage(state.tab.id, { type: "PIC_HARVEST_SCAN" });
    }
    if (!result || !result.ok) throw new Error((result && result.error) || "页面没有返回图片");
    state.result = result;
    state.images = Array.isArray(result.images) ? result.images : [];
    state.minSize = Number(els.minSize.value) || 0;
    setPageContext(result);
    applyFilter(true);
  } catch (error) {
    setStateView("error", "暂时无法读取这个页面", friendlyError(error));
    els.countNum.textContent = "0";
    els.dupeNote.textContent = "";
    setActionState();
  } finally {
    state.scanning = false;
    els.rescanBtn.disabled = false;
    els.rescanBtn.classList.remove("is-spinning");
  }
}

function applyFilter(resetSelection) {
  const min = Number(state.minSize) || 0;
  state.visible = state.images.filter((image) => {
    if (!min) return true;
    if (image.width && image.height) return Math.min(image.width, image.height) >= min;
    return true;
  });
  if (resetSelection) state.selected = new Set(state.visible.map((image) => image.url));
  else {
    const visible = new Set(state.visible.map((image) => image.url));
    state.selected.forEach((url) => { if (!visible.has(url)) state.selected.delete(url); });
  }
  els.countNum.textContent = String(state.visible.length);
  const duplicates = (state.result && state.result.stats && state.result.stats.duplicates) || 0;
  const upgraded = (state.result && state.result.stats && state.result.stats.upgraded) || 0;
  const notes = [];
  if (duplicates) notes.push(`去重 ${duplicates}`);
  if (upgraded) notes.push(`升清 ${upgraded}`);
  els.dupeNote.textContent = notes.length ? `· ${notes.join(" · ")}` : "";
  els.dupeNote.title = notes.length ? "已自动合并缩略图变体，并把支持的 CDN 地址换成原图。" : "";

  if (!state.images.length) {
    setStateView("empty", "没有找到可下载的图片", "向下滚动商品页，让懒加载的图片出现；也可以打开具体的商品详情页后重试。");
  } else if (!state.visible.length) {
    setStateView("empty", "当前筛选下没有图片", "把「最低」尺寸调小，或者选择「不限」，就能看到全部结果。");
  } else {
    renderGrid();
    setStateView("grid");
  }
  setActionState();
}

function renderGrid() {
  const fragment = document.createDocumentFragment();
  const limit = Math.min(state.visible.length, 120);
  for (let i = 0; i < limit; i++) {
    const image = state.visible[i];
    const card = document.createElement("label");
    card.className = "card";
    card.dataset.url = image.url;
    card.style.animationDelay = `${Math.min(i, 12) * 18}ms`;
    if (state.selected.has(image.url)) card.classList.add("is-selected");

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.selected.has(image.url);
    input.dataset.url = image.url;
    input.setAttribute("aria-label", `${image.alt || "商品图片"}${image.width ? `，${image.width} × ${image.height}` : ""}`);

    const thumb = document.createElement("img");
    thumb.className = "thumb";
    thumb.alt = image.alt || "商品图片";
    thumb.loading = "lazy";
    thumb.decoding = "async";
    thumb.src = image.url;
    thumb.addEventListener("error", () => card.classList.add("is-broken"));

    const broken = document.createElement("span");
    broken.className = "broken-art";
    broken.innerHTML = '<svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true"><rect x="3" y="5" width="22" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m6 19 6-5 4 3 3-3 4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

    const check = document.createElement("span");
    check.className = "check";
    check.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="m2.2 6.2 2.5 2.5 5.2-5.3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    card.appendChild(input);
    card.appendChild(thumb);
    card.appendChild(broken);
    card.appendChild(check);

    if (i === 0 && image.featured) {
      const flag = document.createElement("span");
      flag.className = "main-flag";
      flag.textContent = "主图";
      card.appendChild(flag);
    }
    if (image.width && image.height) {
      const dim = document.createElement("span");
      dim.className = "dim-flag";
      dim.textContent = `${image.width} × ${image.height}`;
      card.appendChild(dim);
    }
    fragment.appendChild(card);
  }
  els.grid.replaceChildren(fragment);
  updateSelectAllLabel();
}

function updateSelectAllLabel() {
  const allSelected = state.visible.length > 0 && state.visible.every((image) => state.selected.has(image.url));
  els.selectAllBtn.textContent = allSelected ? "取消全选" : "全选";
}

function setActionState() {
  const count = state.selected.size;
  els.selectedCount.textContent = String(count);
  const disabled = !count || state.busy || state.visible.length === 0;
  els.zipBtn.disabled = disabled;
  els.singleBtn.disabled = disabled;
  els.zipLabel.textContent = count > 1 ? `打包下载 · ${Math.min(count, MAX_ZIP)}` : "打包下载";
  // 有图片时显示水印条
  els.wmbar.hidden = state.visible.length === 0;
  syncWmState();
  updateSelectAllLabel();
}

function selectedImages() {
  return state.visible.filter((image) => state.selected.has(image.url));
}

/* ---- 水印 ---- */
const WM_STORAGE_KEY = "picharvestWatermark";

function wmInputs() {
  return {
    enabled: els.watermarkChk.checked,
    text: (els.watermarkText.value || "").trim(),
    opacity: (Number(els.watermarkOpacity.value) || 45) / 100
  };
}

function getWatermark() {
  const w = wmInputs();
  if (!w.enabled) return { enabled: false };
  return { enabled: true, text: w.text || "@PicHarvest 图仓", opacity: w.opacity };
}

async function loadWatermark() {
  try {
    const data = await chrome.storage.local.get(WM_STORAGE_KEY);
    const saved = data[WM_STORAGE_KEY];
    if (saved && typeof saved === "object") {
      els.watermarkChk.checked = !!saved.enabled;
      if (saved.text) els.watermarkText.value = saved.text;
      els.watermarkOpacity.value = String(Math.round((Number(saved.opacity) || 0.45) * 100));
    }
  } catch (_) { /* ok */ }
  syncWmState();
}

function syncWmState() {
  const enabled = els.watermarkChk.checked;
  els.watermarkText.disabled = !enabled;
  els.watermarkOpacity.disabled = !enabled;
  els.watermarkPreview.disabled = !enabled || !els.watermarkText.value.trim();
}

function persistWatermark() {
  const value = {
    enabled: els.watermarkChk.checked,
    text: els.watermarkText.value.trim(),
    opacity: (Number(els.watermarkOpacity.value) || 45) / 100
  };
  try {
    chrome.storage.local.set({ [WM_STORAGE_KEY]: value });
  } catch (_) { /* ok */ }
}

async function previewWatermark() {
  if (state.busy) return;
  const first = selectedImages()[0];
  if (!first) { toast("请先勾选图片再预览水印"); return; }
  state.busy = true;
  setActionState();
  showProgress("正在生成水印预览", "对第一张图应用水印…", 8);
  try {
    const bkgRes = await runtimeMessage({
      type: "WATERMARK_PREVIEW",
      image: { url: first.url, alt: first.alt },
      watermark: getWatermark()
    }, 60000);
    if (!bkgRes || !bkgRes.ok) throw new Error((bkgRes && bkgRes.error) || "预览失败");
    await chrome.downloads.download({
      url: bkgRes.blobUrl,
      filename: "PicHarvest_水印预览.png",
      saveAs: false,
      conflictAction: "uniquify"
    });
    showSuccess("水印预览已下载", "请在浏览器下载记录里查看这张带水印的图。", null);
  } catch (error) {
    showOverlayError("预览失败", friendlyError(error));
  } finally {
    state.busy = false;
    setActionState();
  }
}

function toast(message, isError) {
  clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle("is-error", !!isError);
  els.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 3200);
}

function setRing(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  els.ring.style.strokeDashoffset = String(RING_LENGTH - (RING_LENGTH * value / 100));
  els.progressPercent.textContent = `${Math.round(value)}%`;
}

function showProgress(title, text, percent) {
  state.completed = false;
  els.overlay.hidden = false;
  els.overlay.classList.remove("is-success", "is-error-card");
  els.progressActions.hidden = true;
  els.progressTitle.textContent = title;
  els.progressText.textContent = text;
  setRing(percent || 0);
}

function showSuccess(title, text, downloadId) {
  state.completed = true;
  state.busy = false;
  state.downloadId = downloadId || null;
  els.overlay.hidden = false;
  els.overlay.classList.remove("is-error-card");
  els.overlay.classList.add("is-success");
  els.ring.style.strokeDashoffset = "0";
  els.progressPercent.textContent = "✓";
  els.progressTitle.textContent = title;
  els.progressText.textContent = text;
  els.progressActions.hidden = false;
  els.showDownloadBtn.textContent = downloadId ? "查看下载" : "打开下载目录";
  els.showDownloadBtn.hidden = false;
  setActionState();
}

function showOverlayError(title, text) {
  state.busy = false;
  els.overlay.hidden = false;
  els.overlay.classList.remove("is-success");
  els.overlay.classList.add("is-error-card");
  els.ring.style.strokeDashoffset = String(RING_LENGTH);
  els.progressPercent.textContent = "!";
  els.progressTitle.textContent = title;
  els.progressText.textContent = text;
  els.progressActions.hidden = false;
  els.showDownloadBtn.hidden = true;
  setActionState();
}

function hideOverlay() {
  els.overlay.hidden = true;
  els.overlay.classList.remove("is-success", "is-error-card");
  els.progressActions.hidden = true;
  state.busy = false;
  setActionState();
}

async function startZip() {
  if (state.busy) return;
  let images = selectedImages();
  if (!images.length) return;
  if (images.length > MAX_ZIP) {
    images = images.slice(0, MAX_ZIP);
    toast(`单次最多打包 ${MAX_ZIP} 张，已选取前 ${MAX_ZIP} 张`);
  }
  state.busy = true;
  setActionState();
  showProgress("正在收图", `准备打包 ${images.length} 张图片…`, 0);
  try {
    const response = await runtimeMessage({
      type: "DOWNLOAD_ZIP",
      images: images.map(({ url, alt }) => ({ url, alt })),
      title: (state.result && state.result.page && state.result.page.title) || "商品图片",
      watermark: getWatermark()
    }, 180000);
    if (!response || !response.ok) throw new Error((response && response.error) || "ZIP 生成失败");
    const skipped = response.failures && response.failures.length ? `，跳过 ${response.failures.length} 张无法访问的图片` : "";
    showSuccess(
      "ZIP 已开始下载",
      `${response.count} 张图片已经打包${skipped}。文件保存在浏览器下载目录，打包全程在本机完成。`,
      response.downloadId
    );
  } catch (error) {
    showOverlayError("打包没有完成", friendlyError(error));
  }
}

async function startIndividual() {
  if (state.busy) return;
  let images = selectedImages();
  if (!images.length) return;
  if (images.length > MAX_INDIVIDUAL) {
    images = images.slice(0, MAX_INDIVIDUAL);
    toast(`单次最多创建 ${MAX_INDIVIDUAL} 个下载，已选取前 ${MAX_INDIVIDUAL} 张`);
  }
  state.busy = true;
  setActionState();
  showProgress("正在创建下载", `逐张保存 ${images.length} 张图片…`, 5);
  try {
    const response = await runtimeMessage({
      type: "DOWNLOAD_INDIVIDUAL",
      images: images.map(({ url, alt }) => ({ url, alt })),
      title: (state.result && state.result.page && state.result.page.title) || "商品图片",
      watermark: getWatermark()
    }, 90000);
    if (!response || !response.ok) throw new Error((response && response.error) || "创建下载失败");
    const skipped = response.failures && response.failures.length ? `，${response.failures.length} 张未能创建` : "";
    showSuccess("逐张下载已开始", `${response.count} 个下载任务已创建${skipped}。文件会保存到下载目录的 PicHarvest 文件夹。`, null);
  } catch (error) {
    showOverlayError("创建下载没有完成", friendlyError(error));
  }
}

function bindEvents() {
  els.grid.addEventListener("change", (event) => {
    const input = event.target.closest('input[type="checkbox"]');
    if (!input) return;
    const url = input.dataset.url;
    if (!url) return;
    if (input.checked) state.selected.add(url);
    else state.selected.delete(url);
    const card = input.closest(".card");
    if (card) card.classList.toggle("is-selected", input.checked);
    setActionState();
  });

  els.selectAllBtn.addEventListener("click", () => {
    const allSelected = state.visible.length > 0 && state.visible.every((image) => state.selected.has(image.url));
    if (allSelected) state.selected.clear();
    else state.visible.forEach((image) => state.selected.add(image.url));
    els.grid.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      const checked = state.selected.has(input.dataset.url);
      input.checked = checked;
      const card = input.closest(".card");
      if (card) card.classList.toggle("is-selected", checked);
    });
    updateSelectAllLabel();
    setActionState();
  });

  els.minSize.addEventListener("change", () => {
    state.minSize = Number(els.minSize.value) || 0;
    applyFilter(true);
  });

  els.watermarkChk.addEventListener("change", () => { syncWmState(); persistWatermark(); });
  els.watermarkText.addEventListener("input", () => { syncWmState(); persistWatermark(); });
  els.watermarkOpacity.addEventListener("input", () => persistWatermark());
  els.watermarkPreview.addEventListener("click", previewWatermark);

  els.rescanBtn.addEventListener("click", scan);
  els.zipBtn.addEventListener("click", startZip);
  els.singleBtn.addEventListener("click", startIndividual);
  $("emptyRetry").addEventListener("click", scan);
  $("errorRetry").addEventListener("click", scan);
  els.closeOverlayBtn.addEventListener("click", hideOverlay);
  els.showDownloadBtn.addEventListener("click", async () => {
    try {
      await runtimeMessage({ type: "SHOW_DOWNLOAD", downloadId: state.downloadId });
    } catch (_) {
      toast("暂时无法打开下载列表，请在浏览器下载记录中查看", true);
    }
  });

  els.favicon.addEventListener("error", () => els.faviconWrap.classList.add("is-broken"));
  els.favicon.addEventListener("load", () => {
    if (els.favicon.getAttribute("src")) els.faviconWrap.classList.remove("is-broken");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.overlay.hidden) hideOverlay();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.target !== "popup") return;
    if (message.type === "PIC_HARVEST_PROGRESS" && state.busy) {
      if (message.phase === "fetch") {
        const done = Number(message.done) || 0;
        const total = Number(message.total) || 1;
        setRing((done / total) * 90);
        const success = Number(message.success) || 0;
        els.progressTitle.textContent = "正在抓取原图";
        els.progressText.textContent = `已检查 ${done} / ${total} 张，${success} 张可下载`;
      } else if (message.phase === "zip") {
        setRing(90 + (Number(message.percent) || 0) * 0.1);
        els.progressTitle.textContent = "正在压缩";
        els.progressText.textContent = `把 ${message.success || ""} 张图片装进 ZIP…`;
      } else if (message.phase === "watermark") {
        const done = Number(message.done) || 0;
        const total = Number(message.total) || 1;
        setRing((done / total) * 90);
        els.progressTitle.textContent = "正在添加水印";
        els.progressText.textContent = `处理中 ${done} / ${total} 张…`;
      } else if (message.phase === "download") {
        const done = Number(message.done) || 0;
        const total = Number(message.total) || 1;
        setRing((done / total) * 100);
        els.progressTitle.textContent = "正在创建下载";
        els.progressText.textContent = `已创建 ${done} / ${total} 个下载任务`;
      } else if (message.phase === "prepare") {
        setRing(2);
      }
    }
    if (message.type === "PIC_HARVEST_DONE" && state.busy) {
      const skipped = message.failures && message.failures.length ? `，跳过 ${message.failures.length} 张` : "";
      if (message.mode === "zip") {
        showSuccess("ZIP 已开始下载", `${message.count || 0} 张图片已经打包${skipped}。文件保存在浏览器下载目录。`, message.downloadId);
      } else {
        showSuccess("逐张下载已开始", `${message.count || 0} 个下载任务已创建${skipped}。文件会保存到 PicHarvest 文件夹。`, null);
      }
    }
  });
}

async function init() {
  bindEvents();
  await loadWatermark();
  const params = new URLSearchParams(location.search);
  const forcedTabId = Number(params.get("tabId")) || 0;
  try {
    let tab;
    if (forcedTabId) tab = await chrome.tabs.get(forcedTabId);
    else {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs && tabs[0];
    }
    if (!tab) throw new Error("找不到当前标签页");
    state.tab = tab;
    els.pageTitle.textContent = tab.title || "当前商品页";
    els.pageHost.textContent = hostOf(tab.url);
    if (isRestricted(tab.url)) {
      const isStore = /chromewebstore|microsoftedge\.microsoft/i.test(tab.url || "");
      setStateView(
        "error",
        isStore ? "扩展商店页面无法扫描" : "这个页面无法读取",
        isStore ? "请打开商品详情页，再点击 PicHarvest 图标。" : "浏览器内部页面、设置页和新标签页不包含商品图片。请打开商品详情页后重试。"
      );
      els.sitePill.textContent = "受保护页面";
      return;
    }
    await scan();
  } catch (error) {
    setStateView("error", "暂时无法启动扫描", friendlyError(error));
    els.sitePill.textContent = "未连接";
  }
}

init();
