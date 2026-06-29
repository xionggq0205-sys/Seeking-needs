// 本地静态预览服务器（仅用于前端开发预览）。
// API 端点（/api/*）在本地不可用 —— 那些是 Vercel serverless 函数。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3456;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml" };

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  // 本地不支持 API；返回明确提示而不是 404，方便前端调试
  if (urlPath.startsWith("/api/")) {
    res.writeHead(501, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "本地预览不支持 API，请在 Vercel 上测试 /api/*" }));
    return;
  }

  const filePath = path.join(__dirname, urlPath);
  if (!filePath.startsWith(__dirname)) { res.writeHead(403); res.end("forbidden"); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`[serve] http://localhost:${PORT}`));
