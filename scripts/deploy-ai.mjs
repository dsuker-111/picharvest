/**
 * 一键把 server-vercel/ 部署到 Vercel，并配置 DASHSCOPE_API_KEY。
 *
 * 用法（PowerShell）：
 *   $env:VERCEL_TOKEN="你的 Vercel Token"
 *   $env:DASHSCOPE_API_KEY="sk-你的百炼 Key"
 *   node scripts/deploy-ai.mjs
 *
 * 成功后输出 https://xxx.vercel.app，并提示如何写回 index.html。
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = (process.env.VERCEL_TOKEN || "").trim();
const KEY = (process.env.DASHSCOPE_API_KEY || "").trim();
const PROJECT = process.env.VERCEL_PROJECT || "picharvest-ai";
const MODEL = process.env.MODEL_NAME || "deepseek-v4.1-flash";

if (!TOKEN) {
  console.error("缺少 VERCEL_TOKEN。到 https://vercel.com/account/tokens 创建一个。");
  process.exit(1);
}
if (!KEY) {
  console.error("缺少 DASHSCOPE_API_KEY。到 https://bailian.console.aliyun.com/ 创建一个。");
  process.exit(1);
}

const cwd = new URL("../server-vercel", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function sh(cmd, opts = {}) {
  console.log("$ " + cmd);
  return execSync(cmd, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
    shell: "cmd.exe",
    ...opts
  });
}

function trySh(cmd) {
  try {
    return sh(cmd);
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "");
  }
}

// 1) 关联（或创建）项目
console.log("\n[1/4] 关联 Vercel 项目");
const linkOut = trySh(
  `npx.cmd --yes vercel@latest link --yes --project "${PROJECT}" --token "${TOKEN}"`
);
console.log(linkOut.trim().split("\n").slice(-6).join("\n"));

// 2) 清理同名环境变量（幂等）
console.log("\n[2/4] 重置环境变量");
trySh(`npx.cmd --yes vercel@latest env rm DASHSCOPE_API_KEY production --yes --token "${TOKEN}"`);

// 3) 写入环境变量
console.log("\n[3/4] 写入 DASHSCOPE_API_KEY");
const tmp = mkdtempSync(join(tmpdir(), "ph-ai-"));
const keyFile = join(tmp, "key.txt");
writeFileSync(keyFile, KEY + "\n", "utf8");
const envOut = trySh(
  `type "${keyFile}" | npx.cmd --yes vercel@latest env add DASHSCOPE_API_KEY production --token "${TOKEN}"`
);
console.log(envOut.trim().split("\n").slice(-4).join("\n"));
trySh(`npx.cmd --yes vercel@latest env add MODEL_NAME production --token "${TOKEN}"`) ;
// MODEL_NAME 可选，失败不影响

// 4) 部署
console.log("\n[4/4] 部署到生产环境");
const depOut = trySh(
  `npx.cmd --yes vercel@latest --prod --yes --token "${TOKEN}"`
);
console.log(depOut.trim().split("\n").slice(-12).join("\n"));

const urls = [...depOut.matchAll(/https:\/\/[a-z0-9-]+\.vercel\.app/gi)].map((m) => m[0]);
const prod = urls.find((u) => !u.includes("-git-")) || urls[0];

if (prod) {
  console.log("\n=== 部署成功 ===");
  console.log("代理地址: " + prod);
  console.log("\n验证:");
  console.log(`  curl ${prod}/api/health`);
  console.log("\n让官网使用它（加到 site/index.html 的 ai-chat.js 之前）:");
  console.log(`  <script>window.PIC_HARVEST_AI_API = "${prod}";</script>`);
} else {
  console.log("\n未解析到部署 URL，请检查上面的输出。");
  process.exit(1);
}