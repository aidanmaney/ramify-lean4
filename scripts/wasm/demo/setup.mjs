#!/usr/bin/env node
// Build the live-Lean demo directory: node scripts/wasm/demo/setup.mjs ARTIFACTS_DIR OUT_DIR
// ARTIFACTS_DIR holds live.js, live.worker.js, live.wasm[.br|.gz] and init.tar[.br|.gz]
// (from the wasm build, docs/wasm-spike.md); compressed copies are decompressed here.
// Then: node scripts/wasm/serve.mjs OUT_DIR 8137  →  http://localhost:8137/
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const [src, out] = process.argv.slice(2).map((p) => path.resolve(p));
if (!src || !out) { console.error("usage: setup.mjs ARTIFACTS_DIR OUT_DIR"); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const take = (name) => {
  for (const [ext, un] of [["", (b) => b], [".br", zlib.brotliDecompressSync], [".gz", zlib.gunzipSync]]) {
    const f = path.join(src, name + ext);
    if (fs.existsSync(f)) { fs.writeFileSync(path.join(out, name), un(fs.readFileSync(f))); return; }
  }
  throw new Error(`missing ${name} in ${src}`);
};
for (const n of ["live.js", "live.worker.js", "live.wasm", "init.tar"]) take(n);
fs.copyFileSync(path.join(here, "../worker-live.js"), path.join(out, "worker-live.js"));
// untar.mjs is an ES module for node; the worker importScripts a classic copy.
const untar = fs.readFileSync(path.join(here, "../untar.mjs"), "utf8").replace(/^export\s+/gm, "");
fs.writeFileSync(path.join(out, "untar.js"), untar + "\nself.untarInto = untarInto;\n");
const list = fs.readFileSync(path.join(repo, "demos/playground.txt"), "utf8").split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
const theorems = list.map((f) => {
  const file = fs.readFileSync(path.join(repo, "demos", f.split(/\s+/)[0]), "utf8");
  const theorem = (file.match(/^theorem\s+(\S+)/m) || [])[1];
  const title = (file.match(/^#\s+(.+)$/m) || [])[1] || theorem;
  return { name: title, file, theorem };
}).filter((t) => t.theorem);
const page = fs.readFileSync(path.join(here, "index.html"), "utf8").replace("__THEOREMS__", () => JSON.stringify(theorems).replace(/</g, "\\u003c"));
fs.writeFileSync(path.join(out, "index.html"), page);
console.log(`wrote ${out} (${theorems.length} theorems). Serve: node scripts/wasm/serve.mjs ${path.relative(process.cwd(), out)} 8137`);
