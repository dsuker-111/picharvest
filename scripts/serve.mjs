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

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
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
