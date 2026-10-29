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
  const LOCAL_BASE = "http://127.0.0.1:8000";
  const SAME_ORIGIN_BASE = ""; // 同域，路径 /api/chat

  const CHAT_OPEN_KEY = "picharvest-ai-chat-open";
  const HISTORY_KEY = "picharvest-ai-history";
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

  let baseUrl = null; // 探测结果
  let hint = ""; // 状态附注
  let busy = false;
  let history = loadHistory();

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
    candidates.push(LOCAL_BASE);

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

          if (!keyOk) {
            setStatus("代理已连接，但服务端未配置 DASHSCOPE_API_KEY", "off");
            hint = "服务端缺少 DASHSCOPE_API_KEY";
            return false;
          }
          const scope = base === LOCAL_BASE ? "本机代理" : "云端代理";
          setStatus(scope + " · " + model, "ok");
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
        "请稍后重试；如果是本机部署，请确认已运行 server/cloud_api.py（端口 8000）。";
      pending.classList.remove("ai-msg-pending");
      setBusy(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    let answer = "";
    let failed = false;

    try {
      const res = await fetch(chatUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, history, max_tokens: 700, temperature: 0.6 }),
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
      const isLocal = baseUrl === LOCAL_BASE;
      answer = isLocal
        ? "未连接到本机 AI 代理。\n请运行 server/cloud_api.py（端口 8000）并配置 DASHSCOPE_API_KEY 后重试。"
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
