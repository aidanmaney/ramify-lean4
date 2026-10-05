// Drive the LiveEngine wasm (live.js) in node, the same way worker-live.js does in a browser:
// unpack the Init tar into MEMFS, ramify_init once, then answer each request line, timed.
// node live-node.mjs <dir-with-live.js> <init.tar> <requests.jsonl>
import fs from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { untarInto } from "./untar.mjs";
const [dir, tar, reqs] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const t0 = performance.now();
const lines = fs.readFileSync(reqs, "utf8").split("\n").filter(Boolean);
await new Promise((ok) => {
  globalThis.Module = {
    preRun: [() => {
      const n = untarInto(globalThis.Module.FS, new Uint8Array(fs.readFileSync(tar)), "/lib/lean");
      console.log(`[node] MEMFS: ${n.files} files, ${(n.bytes / 1e6).toFixed(1)} MB, ${(performance.now() - t0).toFixed(0)} ms since start`);
    }],
    postRun: [ok],
    printErr: (s) => console.log("[lean]", s),
  };
  // not require(): the Emscripten script's top-level `var Module` would shadow ours in a CJS scope
  const file = `${dir}/live.js`;
  Object.assign(globalThis, { require, __filename: file, __dirname: dir });
  vm.runInThisContext(fs.readFileSync(file, "utf8"), { filename: file });
});
const M = globalThis.Module;
const tMain = performance.now();
console.log(`[node] runtime + Lean init: ${(tMain - t0).toFixed(0)} ms`);
console.log("[init]", M.ccall("ramify_init", "string", ["string"], ["/lib/lean"]), `${(performance.now() - tMain).toFixed(0)} ms`);
for (const l of lines) {
  const t = performance.now();
  const r = M.ccall("ramify_answer", "string", ["string"], [l]);
  console.log(`[answer ${(performance.now() - t).toFixed(0)} ms]`, r);
}
console.log("[node] wasm heap MB:", (M.HEAP8.length / 1e6).toFixed(0), " rss MB:", (process.memoryUsage().rss / 1e6).toFixed(0));
process.exit(0);
