// Static server with the cross-origin-isolation headers pthreads need (SharedArrayBuffer).
// node serve.mjs <dir> [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const dir = path.resolve(process.argv[2] || ".");
const port = Number(process.argv[3] || 8137);
const types = { ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html", ".tar": "application/x-tar" };
http.createServer((req, res) => {
  const p = path.join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, {
    "Content-Type": types[path.extname(p)] || "application/octet-stream",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`serving ${dir} on ${port}`));
