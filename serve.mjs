import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5188);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, "");
  const abs = path.resolve(root, relative);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    const idx = path.join(abs, "index.html");
    return fs.existsSync(idx) && fs.statSync(idx).isFile() ? idx : null;
  }
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  return null;
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url || "/");
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const type = MIME_TYPES[ext] || "application/octet-stream";
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    "content-type": type,
    "content-length": body.length,
    "cache-control": "no-cache",
  });
  res.end(body);
});

server.on("error", (err) => {
  console.error(`serve.mjs failed on 127.0.0.1:${port}:`, err.message);
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`logos-bust listening on http://127.0.0.1:${port}/`);
});
