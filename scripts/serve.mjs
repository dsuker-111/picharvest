import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 4173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".zip": "application/zip",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".xml": "application/xml"
};

const AI_PROXY = process.env.AI_PROXY || "http://127.0.0.1:8000";

/**
 * 本地预览时把 /api/* 转发到本机 AI 代理，
 * 以便在没有 Vercel 的情况下验证「同域 /api」这条路径。
 */
async function proxyApi(req, res, pathname) {
  const target = AI_PROXY.replace(/\/+$/, "") + pathname.replace(/^\/api/, "");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { "Content-Type": req.headers["content-type"] || "application/json" },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    res.end(text);
  } catch (error) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "本地 AI 代理不可用：" + (error && error.message) }));
  }
}

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname.startsWith("/api/")) {
      await proxyApi(req, res, pathname);
      return;
    }
    let file;
    if (pathname === "/preview" || pathname === "/products/linen-lounge-chair" || pathname === "/shop") {
      file = path.join(root, "tests", "fixtures", "product.html");
    } else if (pathname === "/") {
      file = path.join(root, "site", "index.html");
    } else if (pathname.startsWith("/assets/") || pathname.startsWith("/downloads/")) {
      file = path.join(root, "site", pathname);
    } else {
      file = path.join(root, "site", pathname);
    }
    const resolved = path.resolve(file);
    if (!resolved.startsWith(root + path.sep)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error("not a file");
    res.writeHead(200, {
      "Content-Type": types[path.extname(resolved).toLowerCase()] || "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-cache"
    });
    createReadStream(resolved).pipe(res);
  } catch (_) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`PicHarvest preview: http://127.0.0.1:${port}`);
  console.log(`Product fixture:    http://127.0.0.1:${port}/preview`);
});
