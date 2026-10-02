#!/usr/bin/env node
// PUBLISH — Lean proofs → a static Ramify site, and single-file exports.
//
//   node scripts/publish.mjs [options] <file.lean>...
//
// Lean runs ONCE, here, on the author's machine: `ppharness --widget-data`
// elaborates each file and emits every proof with the data only the widget
// used to carry (diagnostics, tactic tokens, the declaration header, and the
// tagged goals and token hovers BAKED to plain popups). This script turns
// each file's records into one versioned payload and writes a site that any
// static host (GitHub Pages) serves as is:
//
//   <out>/index.html          every published file and its theorems
//   <out>/view.html           the viewer: view.html#file=<name>&proof=<decl>
//   <out>/viewer-<hash>.js    the viewer bundle, shared and cache-safe
//   <out>/data/<name>.json    one payload per source file (format version 1)
//   <out>/export/<name>.html  the same file as ONE self-contained page
//
// Options
//   --out DIR         where the site goes (default: ../site, the repo's site/)
//   --single FILE     also write the FIRST file's single-file export to FILE
//   --no-exports      skip <out>/export/
//   --no-traces       skip B4's automation traces (one extra elaboration/file)
//   --no-lint         skip D4's Mathlib linters
//   --cache DIR       keep each file's ppharness output in DIR/<name>.ndjson and
//                     reuse it while it is newer than the source (iteration)
//   --ndjson F=SRC    use an existing ppharness --widget-data output F for the
//                     source SRC instead of running Lean (tests, CI)
//
// Lean must be built: `cd lean && lake build ppharness` (this script runs it,
// too). A file that `import Mathlib`s needs Mathlib's oleans (`lake exe cache
// get`), exactly as gen.sh does.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "..");
const repo = path.resolve(web, "..");
const leanDir = path.join(repo, "lean");

export const PAYLOAD_VERSION = 1;

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const o = {
    out: path.join(repo, "site"),
    single: null,
    exports: true,
    traces: true,
    lint: true,
    cache: null,
    ndjson: new Map(),
    files: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--out") o.out = path.resolve(val());
    else if (a === "--single") o.single = path.resolve(val());
    else if (a === "--no-exports") o.exports = false;
    else if (a === "--no-traces") o.traces = false;
    else if (a === "--no-lint") o.lint = false;
    else if (a === "--cache") o.cache = path.resolve(val());
    else if (a === "--ndjson") {
      const [f, src] = val().split("=");
      if (!src) throw new Error("--ndjson takes OUTPUT=SOURCE");
      o.ndjson.set(path.resolve(src), path.resolve(f));
      o.files.push(path.resolve(src));
    } else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else o.files.push(path.resolve(a));
  }
  if (o.files.length === 0)
    throw new Error("usage: publish.mjs [options] <file.lean>...");
  return o;
}

// ------------------------------------------------------------------- Lean

let built = false;
function runHarness(file, o) {
  if (!built) {
    console.log("building ppharness…");
    execFileSync("lake", ["build", "ppharness"], { cwd: leanDir, stdio: "inherit" });
    built = true;
  }
  const args = [file, "--widget-data"];
  if (o.traces) args.push("--traces");
  if (o.lint) args.push("--lint");
  console.log(`elaborating ${path.relative(repo, file)}…`);
  return execFileSync(
    "lake",
    ["env", path.join(leanDir, ".lake/build/bin/ppharness"), ...args],
    { cwd: leanDir, maxBuffer: 1 << 30, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
}

function harnessOutput(file, name, o) {
  const given = o.ndjson.get(file);
  if (given) return fs.readFileSync(given, "utf8");
  if (o.cache) {
    const c = path.join(o.cache, `${name}.ndjson`);
    if (fs.existsSync(c) && fs.statSync(c).mtimeMs > fs.statSync(file).mtimeMs)
      return fs.readFileSync(c, "utf8");
    const out = runHarness(file, o);
    fs.mkdirSync(o.cache, { recursive: true });
    fs.writeFileSync(c, out);
    return out;
  }
  return runHarness(file, o);
}

// ---------------------------------------------------------------- payload

/** Every `{h}` tag in a baked tagged text, visited. */
function eachTag(tt, f) {
  if (!tt || typeof tt !== "object") return;
  if (Array.isArray(tt.append)) for (const t of tt.append) eachTag(t, f);
  else if (Array.isArray(tt.tag)) {
    f(tt.tag[0]);
    eachTag(tt.tag[1], f);
  }
}

/** One file's records → its payload. Each record carries its own `hovers`
 table; they are interned into ONE per file (a docstring three proofs hover
 is stored once) and every tag's `h` is renumbered into it. */
export function buildPayload(ndjson, displayPath, source) {
  const table = [];
  const index = new Map();
  const intern = (p) => {
    const key = JSON.stringify(p);
    let k = index.get(key);
    if (k === undefined) {
      k = table.length;
      table.push(p);
      index.set(key, k);
    }
    return k;
  };
  const proofs = [];
  for (const line of ndjson.split("\n")) {
    if (!line.trim()) continue;
    const { data } = JSON.parse(line);
    const proof = data.proof;
    const local = proof.hovers ?? [];
    delete proof.hovers;
    const remap = (tag) => {
      if (tag && typeof tag.h === "number") tag.h = intern(local[tag.h] ?? {});
    };
    for (const g of proof.taggedGoals ?? []) {
      eachTag(g.goal.type, remap);
      for (const h of g.goal.hyps ?? []) {
        eachTag(h.type, remap);
        eachTag(h.val, remap);
      }
    }
    for (const t of proof.tokenInfos ?? []) eachTag(t.code, remap);
    proofs.push({ name: data.name ?? null, index: data.index, proof });
  }
  return { version: PAYLOAD_VERSION, file: displayPath, source, hovers: table, proofs };
}

// ------------------------------------------------------------------ pages

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** JSON or JS that sits inside a <script> element: `</script` and `<!--`
 must not appear in it. In JSON every `<` can be `<`; in the bundle the
 sequence is only ever inside a string or regex, where `<\/` reads the same. */
const jsonInScript = (j) => JSON.stringify(j).replace(/</g, "\\u003c");
const jsInScript = (js) => js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

// Paint before the bundle runs: the remembered pick (or the system's) decides
// the background, so a dark reader does not see a white flash. The bundle's
// own theme module takes over from there (same storage key).
const THEME_BOOT = `<script>try{var t=localStorage.getItem("ramify-viewer-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}</script>`;
const BOOT_CSS = `
:root { color-scheme: light dark; --page-bg: #ffffff; --page-fg: #1f2328; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --page-bg: #1b1d22; --page-fg: #d5d8dd; }
}
:root[data-theme="dark"] { --page-bg: #1b1d22; --page-fg: #d5d8dd; }
html, body { background: var(--page-bg); color: var(--page-fg); }`;

function viewerPage({ title, script, payload }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="A Lean proof drawn as a tree with Ramify.">
${payload ? "" : '<link rel="icon" type="image/svg+xml" href="favicon.svg">\n'}${THEME_BOOT}
<style>${BOOT_CSS}</style>
</head>
<body>
<div id="root"></div>
${payload ? `<script type="application/json" id="ramify-payload">${jsonInScript(payload)}</script>\n` : ""}${script}
</body>
</html>
`;
}

function indexPage(entries) {
  const files = entries
    .map((e) => {
      const rows = e.payload.proofs
        .map((p) => {
          const slug = p.name ?? `@${p.index}`;
          const head = (p.proof.declHeader ?? "").split("\n")[0];
          const errs = (p.proof.diagnostics ?? []).filter((d) => d.severity === 1).length;
          return `<li><a href="view.html#file=${encodeURIComponent(e.name)}&amp;proof=${encodeURIComponent(slug)}"><code>${esc(head || slug)}</code></a>${errs ? ` <span class="err">${errs} error${errs > 1 ? "s" : ""}</span>` : ""}</li>`;
        })
        .join("\n");
      const exp = e.exportBytes
        ? ` · <a href="export/${encodeURIComponent(e.name)}.html" download>one-file copy</a> <span class="dim">(${kb(e.exportBytes)})</span>`
        : "";
      return `<section>
<h2><code>${esc(e.payload.file)}</code></h2>
<p class="dim">${e.payload.proofs.length} proof${e.payload.proofs.length === 1 ? "" : "s"}${exp}</p>
<ul>
${rows}
</ul>
</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ramify — proofs as trees</title>
<meta name="description" content="Lean 4 proofs drawn as interactive trees with Ramify.">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
${THEME_BOOT}
<style>${BOOT_CSS}
:root { --dim: #57606a; --line: #d0d7de; --link: #1f5fae; --err: #cf222e; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --dim: #aab1bb; --line: #3b404a; --link: #86b4f5; --err: #f47067; }
}
:root[data-theme="dark"] { --dim: #aab1bb; --line: #3b404a; --link: #86b4f5; --err: #f47067; }
body { margin: 0; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 28px 0 2px; }
code { font-family: "JuliaMono", "DejaVu Sans Mono", Menlo, Consolas, monospace; font-size: 13px; }
a { color: var(--link); }
ul { padding-left: 0; list-style: none; margin: 6px 0; }
li { padding: 3px 0; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.dim { color: var(--dim); }
.err { color: var(--err); font-size: 12px; }
.intro { margin: 0 0 8px; }
</style>
</head>
<body>
<main>
<h1>Ramify</h1>
<p class="intro">Lean 4 proofs drawn as trees: goals and the tactics between them, with hovers, comments and diagnostics. Pick a proof to read it beside its source.</p>
<p class="dim">These pages are for reading. The <a href="https://github.com/aidanmaney/ramify-lean4/releases/latest">VS Code extension</a> draws the same tree live in the infoview, where you can edit in the tree, see diagnostics as you type, and restructure a proof with Lean checking each change (<a href="https://github.com/aidanmaney/ramify-lean4/blob/main/INSTALL.md">install guide</a>).</p>
${files}
</main>
</body>
</html>
`;
}

const kb = (n) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;

// ------------------------------------------------------------------ bundle

async function bundleViewer() {
  const req = createRequire(path.join(web, "package.json"));
  const { build } = await import(pathToFileURL(req.resolve("esbuild")).href);
  const res = await build({
    entryPoints: [path.join(web, "src/viewerMain.tsx")],
    bundle: true,
    format: "esm",
    jsx: "automatic",
    minify: true,
    write: false,
    target: "es2022",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });
  return res.outputFiles[0].text;
}

// -------------------------------------------------------------------- main

export async function publish(o) {
  const js = await bundleViewer();
  const hash = crypto.createHash("sha256").update(js).digest("hex").slice(0, 10);
  const jsName = `viewer-${hash}.js`;

  fs.mkdirSync(path.join(o.out, "data"), { recursive: true });
  // A previous bundle is stale the moment this one is written.
  for (const f of fs.readdirSync(o.out))
    if (/^viewer-[0-9a-f]+\.js$/.test(f) && f !== jsName) fs.rmSync(path.join(o.out, f));
  fs.writeFileSync(path.join(o.out, jsName), js);
  fs.copyFileSync(path.join(web, "public/favicon.svg"), path.join(o.out, "favicon.svg"));
  fs.writeFileSync(
    path.join(o.out, "view.html"),
    viewerPage({ title: "Ramify", script: `<script type="module" src="${jsName}"></script>` }),
  );
  // GitHub Pages runs Jekyll unless told not to; nothing here wants it.
  fs.writeFileSync(path.join(o.out, ".nojekyll"), "");

  const names = new Set();
  const entries = [];
  for (const file of o.files) {
    let name = path.basename(file, ".lean");
    if (names.has(name)) name = `${path.basename(path.dirname(file))}-${name}`;
    names.add(name);
    const rel = path.relative(repo, file);
    const display = rel.startsWith("..") ? path.basename(file) : rel.split(path.sep).join("/");
    const source = fs.readFileSync(file, "utf8");
    const payload = buildPayload(harnessOutput(file, name, o), display, source);
    if (payload.proofs.length === 0) {
      console.warn(`${display}: no proofs harvested — skipped`);
      continue;
    }
    const json = JSON.stringify(payload);
    fs.writeFileSync(path.join(o.out, "data", `${name}.json`), json);
    const entry = { name, payload, jsonBytes: Buffer.byteLength(json), exportBytes: 0 };
    const single = viewerPage({
      title: `${payload.file} — Ramify`,
      script: `<script type="module">${jsInScript(js)}</script>`,
      payload,
    });
    if (o.exports) {
      fs.mkdirSync(path.join(o.out, "export"), { recursive: true });
      fs.writeFileSync(path.join(o.out, "export", `${name}.html`), single);
      entry.exportBytes = Buffer.byteLength(single);
    }
    if (o.single && entries.length === 0) {
      fs.mkdirSync(path.dirname(o.single), { recursive: true });
      fs.writeFileSync(o.single, single);
      entry.exportBytes = Buffer.byteLength(single);
    }
    entries.push(entry);
  }
  fs.writeFileSync(path.join(o.out, "index.html"), indexPage(entries));

  console.log(`\nwrote ${path.relative(process.cwd(), o.out) || "."}/`);
  console.log(`  ${jsName}  ${kb(Buffer.byteLength(js))}`);
  for (const e of entries)
    console.log(
      `  data/${e.name}.json  ${kb(e.jsonBytes)}  (${e.payload.proofs.length} proofs, ${e.payload.hovers.length} hovers)` +
        (e.exportBytes ? `   export ${kb(e.exportBytes)}` : ""),
    );
  return entries;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await publish(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error(`publish: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
