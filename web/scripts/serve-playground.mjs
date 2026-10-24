// Serve the playground locally WITH live Lean (docs/viewer.md "The playground").
//
//   node scripts/serve-playground.mjs [--port 8642] [--site ../site] [--live DIR] [--native]
//
// Serves the published site (`publish.mjs --playground`) with the cross-origin-
// isolation headers wasm threads need (COOP/COEP), and the live tier under
// /live/: `worker.js` (scripts/wasm/playground-worker.js) plus the wasm build's
// `live.js`, `live.wasm`, `live.worker.js` and `init.tar` from --live
// (default ../build-wasm/out/web). With --native, /live/worker.js is a stand-in
// that forwards each request to the NATIVE engine (`lake exe playgroundlive`)
// — the same answers (scripts/live-check.mjs), for exercising the page
// before or without the wasm build.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt("--port", "8642"));
const site = path.resolve(opt("--site", path.join(repo, "site")));
const liveDir = path.resolve(opt("--live", path.join(repo, "build-wasm/out/web")));
const native = args.includes("--native");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml",
  ".png": "image/png", ".webp": "image/webp", ".css": "text/css", ".tar": "application/x-tar",
};
const ISOLATE = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-cache",
};

// --native: one engine process, requests answered in order
let ask = null;
if (native) {
  const proc = spawn("lake", ["env", ".lake/build/bin/playgroundlive"], {
    cwd: path.join(repo, "lean"), stdio: ["pipe", "pipe", "inherit"],
  });
  const queue = [];
  createInterface({ input: proc.stdout }).on("line", (l) => queue.shift()?.(l));
  const first = new Promise((ok) => queue.push(ok));
  ask = async (line) => { await first; return new Promise((ok) => { queue.push(ok); proc.stdin.write(line + "\n"); }); };
  first.then((l) => console.log("native engine:", l));
}
const NATIVE_WORKER = `
self.onmessage = async ({ data }) => {
  if (data.init) { postMessage({ ready: { ms: 0 } }); return; }
  const r = await fetch("native", { method: "POST", body: data.answer });
  postMessage({ id: data.id, result: await r.json() });
};`;

// A page is never served from the browser's cache without asking (a stale
// playground.html pointed at a bundle hash that no longer exists — Chrome
// had kept the page under `no-cache` alone, which allows a stored copy);
// a content-hashed bundle (`playground-QTDAL4KG.js`) is immutable. Everything
// else (live/*, data, the worker) revalidates.
const HASHED = /-[0-9A-Za-z]{8,10}\.(js|css)$/;
const cacheFor = (file) =>
  file.endsWith(".html")
    ? "no-store, must-revalidate"
    : HASHED.test(path.basename(file))
      ? "public, max-age=31536000, immutable"
      : "no-cache";

function send(res, status, body, type) {
  res.writeHead(status, { ...ISOLATE, "Content-Type": type, "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function sendFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "not found", "text/plain");
    // Last-Modified: the live tier's worker keys its Cache Storage on it
    res.writeHead(200, {
      ...ISOLATE,
      "Cache-Control": cacheFor(file),
      "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "Content-Length": st.size,
      "Last-Modified": st.mtime.toUTCString(),
    });
    if (res.req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let p = decodeURIComponent(url.pathname);
  if (p === "/live/native" && req.method === "POST" && ask) {
    let body = "";
    for await (const c of req) body += c;
    return send(res, 200, await ask(body.replace(/\n/g, " ")), "application/json");
  }
  if (p === "/live/worker.js")
    return native
      ? send(res, 200, NATIVE_WORKER, TYPES[".js"])
      : sendFile(res, path.join(repo, "scripts/wasm/playground-worker.js"));
  if (p.startsWith("/live/")) return sendFile(res, path.join(liveDir, path.basename(p)));
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(site, path.normalize(p));
  if (!file.startsWith(site)) return send(res, 403, "no", "text/plain");
  sendFile(res, file);
}).listen(port, "127.0.0.1", () =>
  console.log(`playground: http://localhost:${port}/playground.html  (live: ${native ? "NATIVE stand-in" : liveDir})`));
