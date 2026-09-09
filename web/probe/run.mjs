#!/usr/bin/env node
// The offline probe runner.  `npm run probe -- <name> [args…]` (from web/)
//
// Bundles probe/lib.ts — a barrel over the pure src modules (proofToTree,
// elide, layout, layoutKey, …) — into node_modules/.probe/lib.mjs with the
// repo's own esbuild, re-bundling only when a src file is newer than the
// bundle, then runs probe/<name>.mjs.  layout.ts measures text with a
// per-character fallback when there is no canvas, so the whole layout engine
// runs under node; the numbers differ from the browser's by font metrics only.
//
// A probe is a plain ES module that imports "./lib.mjs" (resolved to the
// bundle through an import map the runner writes) and "./corpus.mjs" (the
// NDJSON loader + tree helpers).  See corpus.mjs for the vocabulary and
// counts.mjs for the fixture invariants worth re-running after any change to
// elide.ts / proofToTree.ts / layout.ts.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "..");
// The bundle lives BESIDE the probes (git-ignored): node resolves a symlinked
// module by its real path, so probes importing "./lib.mjs" must find it in
// their own directory.
const lib = path.join(here, "lib.mjs");

function newest(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}

const stale =
  !fs.existsSync(lib) ||
  fs.statSync(lib).mtimeMs < Math.max(newest(path.join(web, "src")), fs.statSync(path.join(here, "lib.ts")).mtimeMs);
if (stale) {
  await build({
    entryPoints: [path.join(here, "lib.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: lib,
    logLevel: "warning",
  });
}

const [name, ...args] = process.argv.slice(2);
if (!name) {
  console.log("probes:", fs.readdirSync(here).filter((f) => f.endsWith(".mjs") && !["run.mjs", "corpus.mjs", "lib.mjs"].includes(f)).map((f) => f.slice(0, -4)).join(" "));
  process.exit(0);
}
process.argv = [process.argv[0], name, ...args];
await import(pathToFileURL(path.join(here, `${name}.mjs`)).href);
