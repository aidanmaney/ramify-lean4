#!/usr/bin/env node
// The offline probe runner.  `npm run probe -- <name> [args…]` (from web/)
//
// Bundles probe/lib.ts — a barrel over the pure src modules (proofToTree,
// elide, layout, layoutKey, …) — into probe/lib.mjs with the repo's own esbuild
// (bundle.mjs), re-bundling only when a src file is newer than the bundle, then
// runs probe/<name>.mjs.  layout.ts measures text with a per-character
// fallback when there is no canvas, so the whole layout engine runs under
// node; the numbers differ from the browser's by font metrics only.
//
// A probe is a plain ES module, marked by `// @probe` on its first line, that
// imports "./lib.mjs" (the bundle, beside it) and "./corpus.mjs" (the NDJSON
// loader, tree helpers, MODES / layoutOf / hopEvery and the flag/opt argv
// helpers).  See corpus.mjs for the vocabulary and
// counts.mjs for the fixture invariants worth re-running after any change to
// elide.ts / proofToTree.ts / layout.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureLib } from "./bundle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

await ensureLib();

// A probe is a probe/*.mjs whose first line is `// @probe`; run.mjs, test.mjs,
// bundle.mjs, corpus.mjs, synth.mjs and the lib.mjs bundle are not.
const probes = () =>
  fs.readdirSync(here).filter((f) => f.endsWith(".mjs") && fs.readFileSync(path.join(here, f), "utf8").startsWith("// @probe\n"));

const [name, ...args] = process.argv.slice(2);
if (!name) {
  console.log("probes:", probes().map((f) => f.slice(0, -4)).join(" "));
  process.exit(0);
}
process.argv = [process.argv[0], name, ...args];
await import(pathToFileURL(path.join(here, `${name}.mjs`)).href);
