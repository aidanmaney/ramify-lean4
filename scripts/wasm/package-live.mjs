// The playground's live tier as a folder a STATIC host can serve (docs/viewer.md
// "Live Lean"): GitHub Pages sends no COOP/COEP and will not reliably compress a
// .wasm or a .tar, so the two big files ship pre-gzipped and the worker
// decompresses them (scripts/wasm/playground-worker.js reads manifest.json).
//
//   node scripts/wasm/package-live.mjs [--from build-wasm/out/web] [--out build-wasm/out/deploy]
//
// Writes worker.js, live.js, live.worker.js, live.wasm.gz, init.tar.gz,
// .nojekyll and manifest.json {version, download, files: {name: {bytes, gzBytes, hash}}}
// — `bytes` the file's own (uncompressed) size, `gzBytes` what goes over the
// wire. `version` is a content hash: the worker's Cache Storage keys on it, so
// a new build evicts the old one and an unchanged one is read from disk.
// Fails if any file is over 50 MiB (GitHub warns above 50, refuses above 100).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const from = path.resolve(opt("--from", path.join(repo, "build-wasm/out/web")));
const out = path.resolve(opt("--out", path.join(repo, "build-wasm/out/deploy")));
const LIMIT = 50 * 1024 * 1024;

const sha = (file) =>
  new Promise((ok, bad) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (c) => h.update(c)).on("end", () => ok(h.digest("hex"))).on("error", bad);
  });

fs.mkdirSync(out, { recursive: true });
const plain = [
  ["worker.js", path.join(here, "playground-worker.js")],
  ["live.js", path.join(from, "live.js")],
  ["live.worker.js", path.join(from, "live.worker.js")],
];
const zipped = [
  ["live.wasm.gz", path.join(from, "live.wasm")],
  ["init.tar.gz", path.join(from, "init.tar")],
];
for (const [, src] of [...plain, ...zipped])
  if (!fs.existsSync(src)) throw new Error(`missing ${src} — build it first (scripts/wasm/build-mac.sh)`);

const files = {};
const hashes = [];
for (const [name, src] of plain) {
  fs.copyFileSync(src, path.join(out, name));
  const bytes = fs.statSync(src).size;
  const hash = await sha(src);
  files[name] = { bytes, gzBytes: bytes, hash: hash.slice(0, 16) };
  hashes.push(`${name}:${hash}`);
}
for (const [name, src] of zipped) {
  const dst = path.join(out, name);
  // gzip -9 of 87 MB takes a while: an output newer than its source is kept
  const fresh = fs.existsSync(dst) && fs.statSync(dst).mtimeMs > fs.statSync(src).mtimeMs;
  if (!fresh) {
    const t0 = Date.now();
    process.stdout.write(`gzip -9 ${path.basename(src)}… `);
    await pipeline(fs.createReadStream(src), zlib.createGzip({ level: 9 }), fs.createWriteStream(`${dst}.tmp`));
    fs.renameSync(`${dst}.tmp`, dst);
    console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  const hash = await sha(src);
  // the big files are cached by their OWN hash: a change to the scripts alone re-downloads nothing big
  files[name] = { bytes: fs.statSync(src).size, gzBytes: fs.statSync(dst).size, hash: hash.slice(0, 16) };
  hashes.push(`${name}:${hash}`);
}
fs.writeFileSync(path.join(out, ".nojekyll"), "");
const version = crypto.createHash("sha256").update(hashes.join("\n")).digest("hex").slice(0, 16);
// what one start fetches: everything but worker.js's own few KB is counted
const download = Object.values(files).reduce((n, f) => n + f.gzBytes, 0);
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ version, download, files }, null, 2) + "\n");

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
let over = [];
for (const f of fs.readdirSync(out)) {
  const st = fs.statSync(path.join(out, f));
  if (!st.isFile()) continue;
  const big = st.size > LIMIT;
  if (big) over.push(f);
  console.log(`  ${f.padEnd(16)} ${mb(st.size).padStart(9)}${files[f] && files[f].bytes !== st.size ? `  (from ${mb(files[f].bytes)})` : ""}${big ? "  OVER 50 MiB" : ""}`);
}
console.log(`version ${version}; one start downloads ${mb(download)} → ${out}`);
if (over.length > 0) {
  console.error(`package-live: ${over.join(", ")} over 50 MiB — GitHub Pages warns above 50 MB and refuses files above 100 MB`);
  process.exit(1);
}
