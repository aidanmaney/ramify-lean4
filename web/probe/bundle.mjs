// The esbuild step shared by the probe runner and scripts/gen-experience.mjs:
// bundle a TypeScript entry point into one ES module for node, using the web
// package's own esbuild (resolved from web/, so callers anywhere in the repo
// get the same one).
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const web = path.resolve(here, "..");
// The probe bundle lives BESIDE the probes (git-ignored): node resolves a
// symlinked module by its real path, so probes importing "./lib.mjs" must find
// it in their own directory.
export const LIB_BUNDLE = path.join(here, "lib.mjs");
const LIB_ENTRY = path.join(here, "lib.ts");

/** Bundle `entry` (a .ts file) into `outfile`, an ES module for node. */
export async function bundle(entry, outfile) {
  const { build } = await import(pathToFileURL(createRequire(path.join(web, "package.json")).resolve("esbuild")).href);
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile, logLevel: "warning" });
}

function newest(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}

/** Bundle probe/lib.ts (a barrel over the pure src modules) to probe/lib.mjs,
 re-bundling only when a src file or the barrel is newer than the bundle.
 Returns the bundle's path. */
export async function ensureLib() {
  const stale =
    !fs.existsSync(LIB_BUNDLE) ||
    fs.statSync(LIB_BUNDLE).mtimeMs < Math.max(newest(path.join(web, "src")), fs.statSync(LIB_ENTRY).mtimeMs);
  if (stale) await bundle(LIB_ENTRY, LIB_BUNDLE);
  return LIB_BUNDLE;
}
