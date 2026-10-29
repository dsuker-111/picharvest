"use strict";

/**
 * 图仓官网 AI 对话框
 * -----------------
 * 通过本机代理 server/cloud_api.py 调用阿里云百炼（DashScope）模型。
 * API Key 只存在于代理进程的环境变量中，浏览器与页面源码都不含密钥。
 *
 * 支持在 <script> 之前设置 window.PIC_HARVEST_AI_API 覆盖代理地址，
 * 默认 http://127.0.0.1:8000。
 */
(() => {
  const API_BASE = (window.PIC_HARVEST_AI_API || "http://127.0.0.1:8000").replace(/\/+$/, "");
  const CHAT_ENDPOINT = API_BASE + "/chat";
  const HEALTH_ENDPOINT = API_BASE + "/health";

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

  let online = null; // null=未知, true=可用, false=不可用
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
      "你好，我是图仓官网的 AI 助手（阿里云百炼）。\n" +
        "可以问我：图仓怎么装、支持哪些平台、ZIP 打包失败怎么办。"
    );
  }

  async function checkHealth() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(HEALTH_ENDPOINT, { signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      online = true;
      const model = data && data.model ? String(data.model) : "阿里云百炼";
      const keyOk = !data || data.key_configured !== false;
      if (!keyOk) {
        setStatus("代理已连接，但未配置 DASHSCOPE_API_KEY", "off");
        return false;
      }
      setStatus("阿里云百炼 · " + model, "ok");
      return true;
    } catch (_) {
      online = false;
      setStatus("未连接 AI 代理（127.0.0.1:8000）", "off");
      return false;
    }
  }

  async function ask(text) {
    addMessage("user", text);
    setBusy(true);
    const pending = addMessage("ai", "正在思考…");
    pending.classList.add("ai-msg-pending");
    const bubble = pending.querySelector(".ai-bubble");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    let answer = "";
    let failed = false;

    try {
      const res = await fetch(CHAT_ENDPOINT, {
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
      answer =
        online === true
          ? "调用失败：" + (error && error.message ? error.message : String(error))
          : "未连接到 AI 代理。\n请在本机运行 server/cloud_api.py（端口 8000）并配置 DASHSCOPE_API_KEY 后重试。";
      online = false;
      setStatus("AI 代理未连接", "off");
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
      if (failed) checkHealth();
    }
  }

  function openChat() {
    root.classList.add("is-open");
    root.setAttribute("aria-hidden", "false");
    toggle.setAttribute("aria-expanded", "true");
    welcome();
    if (online !== true) checkHealth();
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

  setTimeout(checkHealth, 1000);
})();
