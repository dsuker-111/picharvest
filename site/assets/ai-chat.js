"use strict";

/**
 * 图仓官网 AI 对话框
 * -----------------
 * 后端优先顺序：
 *   1. window.PIC_HARVEST_AI_API（手动指定，最高优先级）
 *   2. 同域 /api （Vercel Serverless 代理，公网可用）
 *   3. http://127.0.0.1:8000 （本机 cloud_api.py 代理）
 *
 * API Key 只保存在服务端环境变量中，浏览器与页面源码都不含密钥。
 */
(() => {
  const LOCAL_BASES = ["http://127.0.0.1:8123", "http://127.0.0.1:8000"];
  const SAME_ORIGIN_BASE = ""; // 同域，路径 /api/chat

  function isLocalBase(base) {
    return LOCAL_BASES.includes(base);
  }

  const CHAT_OPEN_KEY = "picharvest-ai-chat-open";
  const HISTORY_KEY = "picharvest-ai-history";
  const PROVIDER_KEY = "picharvest-ai-provider";
  const MAX_HISTORY = 12;

  const root = document.getElementById("aiChat");
  if (!root) return;

  const toggle = document.getElementById("aiChatToggle");
  const closeBtn = document.getElementById("aiChatClose");
  const messages = document.getElementById("aiChatMessages");
  const form = document.getElementById("aiChatForm");
  const input = document.getElementById("aiChatInput");
  const sendBtn = form.querySelector(".ai-chat-send");
  const statusEl = document.getElementById("aiChatStatus");
  const switchBtns = root.querySelectorAll(".ai-switch-btn");
  const switchWrap = root.querySelector(".ai-chat-switch");

  let baseUrl = null; // 探测结果
  let hint = ""; // 状态附注
  let busy = false;
  let history = loadHistory();
  let provider = loadProvider(); // "cloud" | "local"
  let availability = { cloud: false, local: false };

  function loadProvider() {
    try {
      const v = localStorage.getItem(PROVIDER_KEY);
      return v === "local" ? "local" : "cloud";
    } catch (_) {
      return "cloud";
    }
  }

  function saveProvider(v) {
    try {
      localStorage.setItem(PROVIDER_KEY, v);
    } catch (_) {}
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(-MAX_HISTORY) : [];
    } catch (_) {
      return [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
    } catch (_) {}
  }

  function addMessage(role, text) {
    const row = document.createElement("div");
    row.className = "ai-msg ai-msg-" + role;
    const bubble = document.createElement("div");
    bubble.className = "ai-bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
    return row;
  }

  function setStatus(text, tone) {
    statusEl.textContent = text;
    statusEl.dataset.tone = tone || "idle";
  }

  /** 同步「云端 / 本地」切换按钮的选中态与可用性。 */
  function syncProviderUI() {
    if (!switchBtns.length) return;
    switchBtns.forEach((btn) => {
      const p = btn.dataset.provider;
      const active = p === provider;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");

      if (p === "local") {
        const ok = availability.local;
        btn.disabled = !ok;
        btn.title = ok
          ? "使用本机部署的 Qwen2.5 + LoRA 模型"
          : "本地模型未启动：请运行 python server/local_model.py";
      } else {
        btn.disabled = false;
        btn.title = "使用阿里云百炼（deepseek-v4.1-flash）";
      }
    });
    if (switchWrap) switchWrap.dataset.provider = provider;
  }

  function setBusy(state) {
    busy = state;
    sendBtn.disabled = state || !input.value.trim();
    input.readOnly = state;
    root.classList.toggle("is-busy", state);
  }

  function welcome() {
    if (messages.children.length) return;
    addMessage(
      "ai",
      "你好，我是图仓的 AI 助手。\n" +
        "可以问我：图仓怎么安装、支持哪些平台、ZIP 打包失败怎么办、图片会不会上传。"
    );
  }

  /** 依次尝试候选后端，返回第一个 /health 可用的 base。 */
  async function probe() {
    const explicit = (window.PIC_HARVEST_AI_API || "").replace(/\/+$/, "");
    const candidates = [];
    if (explicit) candidates.push(explicit);
    candidates.push(SAME_ORIGIN_BASE); // 同域 /api
    LOCAL_BASES.forEach((b) => candidates.push(b));

    for (const base of candidates) {
      const url = (base || "") + "/api/health";
      const alt = base === SAME_ORIGIN_BASE ? "" : base + "/health";
      const targets = base === SAME_ORIGIN_BASE ? [url] : [alt, url];

      for (const target of targets) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4000);
          const res = await fetch(target, { signal: controller.signal, cache: "no-store" });
          clearTimeout(timer);
          if (!res.ok) continue;
          const data = await res.json();
          baseUrl = base;
          const model = (data && data.model) || "阿里云百炼";
          const keyOk = !data || data.key_configured !== false;

          // 记录双后端可用性，用于启用 / 禁用「本地」按钮
          const p = (data && data.providers) || {};
          availability = {
            cloud: p.cloud !== false && keyOk,
            local: p.local === true
          };
          syncProviderUI();

          if (!keyOk) {
            setStatus("代理已连接，但服务端未配置 DASHSCOPE_API_KEY", "off");
            hint = "服务端缺少 DASHSCOPE_API_KEY";
            return false;
          }

          // 用户选了本地但本地没起来 -> 自动回退云端并说明
          if (provider === "local" && !availability.local) {
            provider = "cloud";
            saveProvider("cloud");
            syncProviderUI();
            setStatus("本地模型未启动，已切回云端 · " + model, "off");
            hint = "本地模型未启动";
            return true;
          }

          const scope = isLocalBase(base) ? "本机代理" : "云端代理";
          if (provider === "local") {
            setStatus("本地模型 · " + (data.local_model || "LoRA"), "ok");
          } else {
            setStatus(scope + " · " + model, "ok");
          }
          hint = "";
          return true;
        } catch (_) {
          /* 试下一个 */
        }
      }
    }

    baseUrl = null;
    hint = "";
    setStatus("AI 服务未连接", "off");
    return false;
  }

  function chatUrl() {
    if (baseUrl === null) return null;
    return baseUrl === SAME_ORIGIN_BASE ? "/api/chat" : baseUrl + "/chat";
  }

  async function ask(text) {
    addMessage("user", text);
    setBusy(true);
    const pending = addMessage("ai", "正在思考…");
    pending.classList.add("ai-msg-pending");
    const bubble = pending.querySelector(".ai-bubble");

    if (baseUrl === null && !(await probe())) {
      bubble.textContent =
        "AI 服务暂时不可用。\n" +
        "请稍后重试；如果是本机部署，请确认已运行 server/cloud_api.py（端口 8123）。";
      pending.classList.remove("ai-msg-pending");
      setBusy(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    let answer = "";
    let failed = false;

    try {
      const res = await fetch(chatUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          history,
          provider, // "cloud" | "local"
          // 本地 0.5B 模型不需要长输出，短一点更快
          max_tokens: provider === "local" ? 320 : 700,
          temperature: provider === "local" ? 0.3 : 0.6
        }),
        signal: controller.signal
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (data && data.error) {
        failed = true;
        answer = "服务端返回错误：" + data.error;
      } else {
        answer = (data && (data.answer || data.content)) || "";
        if (!answer) answer = "（模型没有返回内容）";
      }
    } catch (error) {
      failed = true;
      const isLocal = isLocalBase(baseUrl);
      answer = isLocal
        ? "未连接到本机 AI 代理。\n请运行 server/cloud_api.py（端口 8123）并配置 DASHSCOPE_API_KEY 后重试。"
        : "调用 AI 服务失败：" + (error && error.message ? error.message : String(error));
      setStatus("调用失败", "off");
    } finally {
      clearTimeout(timer);
      bubble.textContent = answer;
      pending.classList.remove("ai-msg-pending");
      setBusy(false);
      messages.scrollTop = messages.scrollHeight;

      if (!failed && answer) {
        history.push({ role: "user", content: text });
        history.push({ role: "ai", content: answer });
        history = history.slice(-MAX_HISTORY);
        saveHistory();
      }
      if (failed) probe();
    }
  }

  function openChat() {
    root.classList.add("is-open");
    root.setAttribute("aria-hidden", "false");
    toggle.setAttribute("aria-expanded", "true");
    welcome();
    if (baseUrl === null) probe();
    input.focus();
  }

  function closeChat() {
    root.classList.remove("is-open");
    root.setAttribute("aria-hidden", "true");
    toggle.setAttribute("aria-expanded", "false");
  }

  function setOpen(next) {
    if (next) openChat();
    else closeChat();
    try {
      localStorage.setItem(CHAT_OPEN_KEY, next ? "1" : "0");
    } catch (_) {}
  }

  // 恢复上次打开状态（仅本机预览，避免公网自动弹窗）
  try {
    const host = window.location.hostname;
    if ((host === "127.0.0.1" || host === "localhost") && localStorage.getItem(CHAT_OPEN_KEY) === "1") {
      openChat();
    }
  } catch (_) {}

  toggle.addEventListener("click", () => setOpen(!root.classList.contains("is-open")));
  closeBtn.addEventListener("click", () => setOpen(false));
  root.querySelector(".ai-chat-backdrop").addEventListener("click", () => setOpen(false));

  // 云端 / 本地 切换
  switchBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled || busy) return;
      const next = btn.dataset.provider;
      if (next === provider) return;
      provider = next;
      saveProvider(provider);
      syncProviderUI();
      // 切换后重新探测，让状态栏显示对应模型
      probe();
      addMessage(
        "ai",
        provider === "local"
          ? "已切换到【本地模型】（本机 Qwen2.5 + LoRA）。回答由你电脑上的模型生成。"
          : "已切换到【云端模型】（阿里云百炼 deepseek-v4.1-flash）。"
      );
    });
  });

  syncProviderUI();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    autoResize();
    sendBtn.disabled = true;
    ask(text);
  });

  input.addEventListener("input", () => {
    autoResize();
    sendBtn.disabled = busy || !input.value.trim();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
    if (event.key === "Escape") setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && root.classList.contains("is-open")) setOpen(false);
  });

  function autoResize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
  }

  setTimeout(probe, 900);
})();
