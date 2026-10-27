import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const zip = new JSZip();
const includeRoot = ["README.md", "LICENSE", "MEETING_NOTES.md", "package.json", "package-lock.json", ".gitignore"];
const includeDirs = ["extension", "site", "tests", "scripts"];
const skip = new Set(["node_modules", ".tmp", ".tmp-profile", ".git", "downloads", "qqcopy"]);

async function addFile(full, relative) {
  const data = await readFile(full);
  zip.file(relative.split(path.sep).join("/"), data);
  return data.byteLength;
}

async function walk(dir, relative) {
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) bytes += await walk(full, rel);
    else bytes += await addFile(full, rel);
  }
  return bytes;
}

let rawBytes = 0;
for (const file of includeRoot) rawBytes += await addFile(path.join(root, file), file);
for (const dir of includeDirs) rawBytes += await walk(path.join(root, dir), dir);

const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "DOS" });
const name = "picharvest-source-v1.0.0.zip";
const out = path.join(root, "site", "downloads", name);
await writeFile(out, archive);
const digest = createHash("sha256").update(archive).digest("hex");
await writeFile(path.join(root, "site", "downloads", "SOURCE-SHA256.txt"), `${digest}  ${name}\n`, "utf8");
console.log(`source ${name}: ${(rawBytes / 1024).toFixed(1)} KiB raw, ${(archive.byteLength / 1024).toFixed(1)} KiB zipped`);
console.log(`SHA256 ${digest}`);
