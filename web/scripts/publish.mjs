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
//   <out>/index.html          a card per published file (thumbs.mjs draws the pictures)
//   <out>/cards.json          what each card shows: file, featured proof, the hero
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
//   --list FILE       publish the sources FILE names, one per line, in that
//                     order (paths relative to FILE; `#` comments) — the
//                     site's own list is demos/site.txt; a line may name
//                     the proof its card opens (`Cantor.lean cantor`), and
//                     `@hero <name>` the file the index opens with
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
    /** Index-page group headings, keyed by the index of the first file. */
    groups: new Map(),
    /** The proof a file's card opens and pictures, by source path. */
    featured: new Map(),
    /** The file (by published name) whose viewer the index opens with. */
    hero: null,
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
    else if (a === "--list") {
      // One source per line, relative to the list; `#` starts a comment.
      const list = path.resolve(val());
      for (const line of fs.readFileSync(list, "utf8").split("\n")) {
        // `## Heading` starts a group on the index page.
        const g = /^##\s+(.+)$/.exec(line.trim());
        if (g) {
          o.groups.set(o.files.length, g[1].trim());
          continue;
        }
        // `@hero <name>` picks the index's opening picture.
        const h = /^@hero\s+(\S+)/.exec(line.trim());
        if (h) {
          o.hero = h[1];
          continue;
        }
        // `<file.lean> [proof]`: the proof names the file's card.
        const [f, proof] = line.replace(/#.*/, "").trim().split(/\s+/);
        if (!f) continue;
        const abs = path.resolve(path.dirname(list), f);
        o.files.push(abs);
        if (proof) o.featured.set(abs, proof);
      }
    }
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

/** A file's own introduction: the `# Title` and first paragraph of its
 leading `/-! … -/` module doc, if it has one. */
export function fileDoc(source) {
  // Leading whitespace, imports and ordinary `/- … -/` comments (a copyright
  // header) may come first; the module doc is the first `/-! … -/`.
  const m = /^(?:\s|import[^\n]*\n|\/-(?!!)[\s\S]*?-\/)*\/-!([\s\S]*?)-\//.exec(source);
  if (!m) return null;
  const body = m[1].trim();
  const t = /^#\s+(.+)$/m.exec(body);
  if (!t) return null;
  const rest = body.slice(t.index + t[0].length).trim();
  const blurb = rest.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  return { title: t[1].trim(), blurb };
}

/** The little Markdown a blurb uses: `code`, **bold** and [links](https://…),
 escaped first. */
const inlineMd = (s) =>
  esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

/** The slug of the proof a file's card opens: the one the list named, else
 the file's longest (its main theorem, as a rule). */
function featuredProof(payload, named, display) {
  const slug = (p) => p.name ?? `@${p.index}`;
  if (named) {
    if (payload.proofs.some((p) => slug(p) === named)) return named;
    console.warn(`${display}: no proof named ${named} — the card opens the longest`);
  }
  const steps = (p) => p.proof.steps?.length ?? 0;
  return slug(payload.proofs.reduce((a, b) => (steps(b) > steps(a) ? b : a)));
}

const viewHref = (file, proof) =>
  `view.html#file=${encodeURIComponent(file)}&amp;proof=${encodeURIComponent(proof)}`;

function indexPage(entries, hero) {
  const pic = (base, alt) =>
    `<img class="lt" src="thumbs/${base}-light.webp" alt="${esc(alt)}" loading="lazy" onerror="this.parentNode.classList.add('none')"><img class="dk" src="thumbs/${base}-dark.webp" alt="" loading="lazy">`;
  const card = (e) => {
    const doc = fileDoc(e.payload.source);
    const title = doc ? doc.title : e.payload.file;
    const n = e.payload.proofs.length;
    const tip = doc?.blurb ? doc.blurb.replace(/[`*]|\]\([^)]*\)|\[/g, "") : e.payload.file;
    const dl = e.exportBytes
      ? `<a class="dl" href="export/${encodeURIComponent(e.name)}.html" download title="One-file copy (${kb(e.exportBytes)})" aria-label="Download ${esc(title)} as one file">${DOWNLOAD_SVG}</a>`
      : "";
    return `<div class="card">
<a class="go" href="${viewHref(e.name, e.featured)}" title="${esc(tip)}"><span class="thumb">${pic(e.name, `The proof tree of ${e.featured}`)}</span>
<span class="cap"><span class="t">${inlineMd(title)}</span>${n > 1 ? `<span class="n">${n} proofs</span>` : ""}</span></a>${dl}
</div>`;
  };
  const groups = [];
  for (const e of entries) {
    if (e.group || groups.length === 0) groups.push({ head: e.group ?? null, items: [] });
    groups.at(-1).items.push(e);
  }
  const body = groups
    .map(
      (g) =>
        `${g.head ? `<h2>${inlineMd(g.head)}</h2>\n` : ""}<div class="grid">\n${g.items.map(card).join("\n")}\n</div>`,
    )
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
:root { --dim: #57606a; --line: #d0d7de; --link: #1f5fae; --card: #f6f8fa; --lift: 0 6px 20px rgba(0,0,0,.12); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --dim: #aab1bb; --line: #3b404a; --link: #86b4f5; --card: #22252b; --lift: 0 6px 20px rgba(0,0,0,.5); }
  :root:not([data-theme="light"]) .lt { display: none; }
  :root:not([data-theme="light"]) .dk { display: block; }
}
:root[data-theme="dark"] { --dim: #aab1bb; --line: #3b404a; --link: #86b4f5; --card: #22252b; --lift: 0 6px 20px rgba(0,0,0,.5); }
:root[data-theme="dark"] .lt { display: none; }
:root[data-theme="dark"] .dk { display: block; }
body { margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
a { color: var(--link); text-decoration: none; }
.top { display: flex; align-items: center; gap: 16px; max-width: 1120px; margin: 0 auto; padding: 14px 16px; }
.brand { color: inherit; font-weight: 600; font-size: 17px; display: flex; align-items: center; gap: 8px; margin-right: auto; }
.brand img { width: 20px; height: 20px; }
.cta { border: 1px solid var(--line); border-radius: 6px; padding: 4px 12px; }
.cta:hover { background: var(--card); }
#theme { background: none; border: 1px solid var(--line); border-radius: 6px; color: inherit; width: 30px; height: 30px; cursor: pointer; display: grid; place-items: center; }
main { max-width: 1120px; margin: 0 auto; padding: 0 16px 64px; }
h1 { font-size: clamp(24px, 4vw, 34px); font-weight: 600; letter-spacing: -.01em; margin: 20px 0 18px; }
.hero { display: block; position: relative; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; box-shadow: var(--lift); }
.hero img { display: block; width: 100%; height: auto; }
.hero .dk, .thumb .dk { display: none; }
.hero .open { position: absolute; right: 14px; bottom: 14px; background: var(--link); color: var(--page-bg); border-radius: 6px; padding: 6px 14px; font-weight: 600; opacity: .92; }
.hero:hover .open { opacity: 1; }
h2 { font-size: 13px; font-weight: 600; text-transform: none; color: var(--dim); margin: 44px 0 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
.card { position: relative; }
.go { display: block; color: inherit; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--page-bg); transition: box-shadow .2s, transform .2s; }
.go:hover, .go:focus-visible { box-shadow: var(--lift); transform: translateY(-2px); }
.thumb { display: block; height: 220px; background: var(--card); border-bottom: 1px solid var(--line); }
.thumb img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 0; transition: object-position 4s ease-in-out; }
.go:hover .thumb img, .go:focus-visible .thumb img { object-position: 50% 100%; transition-duration: 6s; }
.thumb.none img, .hero.none img { display: none !important; }
.hero.none { min-height: 160px; background: var(--card); }
.cap { display: flex; align-items: baseline; gap: 8px; padding: 9px 12px 10px; }
.t { font-weight: 500; flex: 1; min-width: 0; }
.t code { font-size: 13px; }
.n { color: var(--dim); font-size: 12px; font-variant-numeric: tabular-nums; }
.dl { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 6px; background: var(--page-bg); border: 1px solid var(--line); color: var(--dim); opacity: 0; transition: opacity .15s; }
.card:hover .dl, .dl:focus-visible { opacity: 1; }
.dl:hover { color: var(--link); }
footer { max-width: 1120px; margin: 0 auto; padding: 0 16px 40px; color: var(--dim); font-size: 13px; }
footer a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .thumb img, .go { transition: none !important; } .go:hover .thumb img { object-position: 50% 0; } }
@media (hover: none) { .dl { opacity: 1; } }
</style>
</head>
<body>
<header class="top">
<a class="brand" href="./"><img src="favicon.svg" alt="">Ramify</a>
<a class="cta" href="${RELEASE_URL}" title="The same tree, live in the infoview: edit it, see diagnostics as you type, restructure with Lean checking each change">Get it for VS Code</a>
<button id="theme" type="button" aria-label="Switch theme" title="Switch theme"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 1.5a5.5 5.5 0 0 1 0 11z" fill="currentColor"/></svg></button>
</header>
<main>
<h1>Lean proofs, drawn as trees.</h1>
<a class="hero" href="${viewHref(hero.name, hero.featured)}">${pic("hero", `${hero.featured}, read beside its source`)}<span class="open">Open it →</span></a>
${body}
</main>
<footer><a href="${INSTALL_URL}">Install guide</a> · <a href="${REPO_URL}">Source</a></footer>
<script>
document.getElementById("theme").onclick = function () {
  var r = document.documentElement, dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  r.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("ramify-viewer-theme", r.dataset.theme); } catch (e) {}
};
</script>
</body>
</html>
`;
}

const REPO_URL = "https://github.com/aidanmaney/ramify-lean4";
const RELEASE_URL = `${REPO_URL}/releases/latest`;
const INSTALL_URL = `${REPO_URL}/blob/main/INSTALL.md`;
const DOWNLOAD_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 2v7M4 6.5 7 9.5l3-3M2.5 12h9"/></svg>`;

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
  // A heading whose first file publishes nothing still shows, on the next one.
  let pendingGroup = null;
  for (const [fi, file] of o.files.entries()) {
    if (o.groups.has(fi)) pendingGroup = o.groups.get(fi);
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
    if (pendingGroup) entry.group = pendingGroup;
    pendingGroup = null;
    entry.featured = featuredProof(payload, o.featured.get(file), display);
    entries.push(entry);
  }
  const hero = entries.find((e) => e.name === o.hero) ?? entries[0];
  if (o.hero && hero.name !== o.hero) console.warn(`@hero ${o.hero}: no such file — using ${hero.name}`);
  fs.writeFileSync(path.join(o.out, "index.html"), indexPage(entries, hero));
  fs.writeFileSync(
    path.join(o.out, "cards.json"),
    JSON.stringify({
      hero: { file: hero.name, proof: hero.featured },
      cards: entries.map((e) => ({ file: e.name, proof: e.featured })),
    }),
  );

  console.log(`\nwrote ${path.relative(process.cwd(), o.out) || "."}/`);
  console.log(`  ${jsName}  ${kb(Buffer.byteLength(js))}`);
  for (const e of entries)
    console.log(
      `  data/${e.name}.json  ${kb(e.jsonBytes)}  (${e.payload.proofs.length} proofs, ${e.payload.hovers.length} hovers)` +
        (e.exportBytes ? `   export ${kb(e.exportBytes)}` : ""),
    );
  return entries;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await publish(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error(`publish: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
