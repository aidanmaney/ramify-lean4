// The wasm live engine as a line-oriented process, like the native
// `lake exe playgroundlive`: first line out is ramify_init's answer, then one
// JSON request per stdin line → one answer per stdout line. Lets
// web/scripts/live-check.mjs replay every baked step through the WASM Lean:
//
//   node web/scripts/live-check.mjs BAKES --engine "node scripts/wasm/live-stdio.mjs build-wasm/out/web build-wasm/out/init.tar"
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import vm from "node:vm";
import { untarInto } from "./untar.mjs";

const [dir, tar] = process.argv.slice(2).map((p) => path.resolve(p));
const require = createRequire(import.meta.url);
const log = (...a) => process.stderr.write(a.join(" ") + "\n");
await new Promise((ok) => {
  globalThis.Module = {
    preRun: [() => untarInto(globalThis.Module.FS, new Uint8Array(fs.readFileSync(tar)), "/lib/lean")],
    postRun: [ok],
    print: (s) => log("[lean]", s),
    printErr: (s) => log("[lean]", s),
  };
  // not require(): the Emscripten script's top-level `var Module` would shadow ours in a CJS scope
  const file = `${dir}/live.js`;
  Object.assign(globalThis, { require, __filename: file, __dirname: dir });
  vm.runInThisContext(fs.readFileSync(file, "utf8"), { filename: file });
});
const M = globalThis.Module;
process.stdout.write(M.ccall("ramify_init", "string", ["string"], ["/lib/lean"]) + "\n");
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  process.stdout.write(M.ccall("ramify_answer", "string", ["string"], [line]) + "\n");
}
log(`[wasm] heap ${(M.HEAP8.length / 1e6).toFixed(0)} MB, rss ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`);
process.exit(0);
