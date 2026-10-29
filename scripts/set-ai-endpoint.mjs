/**
 * 写入 / 更新官网的 AI 代理地址。
 *
 * 用法：
 *   node scripts/set-ai-endpoint.mjs https://xxx.trycloudflare.com
 *   node scripts/set-ai-endpoint.mjs                 # 清空，回到自动探测
 */
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../site/index.html", import.meta.url);
const url = (process.argv[2] || "").trim().replace(/\/+$/, "");

let html = readFileSync(file, "utf8");
const start = "<!-- AI 代理地址：由 scripts/set-ai-endpoint.mjs 写入 -->";
const re = /  <!-- AI 代理地址：由 scripts\/set-ai-endpoint\.mjs 写入 -->\r?\n  <script>window\.PIC_HARVEST_AI_API = "[^"]*";<\/script>\r?\n/;

if (!re.test(html)) {
  console.error("未找到占位注释，请检查 site/index.html 是否包含 PIC_HARVEST_AI_API 脚本行。");
  process.exit(1);
}

if (!url) {
  html = html.replace(re, "");
  console.log("已清空 AI 代理地址，前端将自动探测同域 /api 或 127.0.0.1:8000");
} else {
  html = html.replace(
    re,
    `${start}\n  <script>window.PIC_HARVEST_AI_API = "${url}";</script>\n`
  );
  console.log("已写入 AI 代理地址：" + url);
}

writeFileSync(file, html, "utf8");