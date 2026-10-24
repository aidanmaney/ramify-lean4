// Compile Lean's `Init` with the WASM `lean` itself, so the oleans are 32-bit
// (an olean is a memory image: its pointer size is the writer's). No 32-bit
// native Lean is needed: the C came from a native 64-bit Lean (it is
// pointer-size independent), and this writes the oleans.
//
//   node gen-oleans.mjs LEAN_JS SRC_DIR OUT_DIR [-j N] [ROOT ...]
//
// ROOTs default to `Init`. Each module runs once its imports are written, as
// `node LEAN_JS -R SRC_DIR -o … -i … SRC.lean -Dcompiler.postponeCompile=false`
// (postponeCompile off: `lean` writes the `.ir` beside the olean itself, which
// the importer needs), LEAN_PATH = OUT_DIR.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const jIdx = argv.indexOf("-j");
const jobs = jIdx >= 0 ? Number(argv.splice(jIdx, 2)[1]) : Math.max(1, os.cpus().length - 1);
const [leanJs, srcDir, outDir, ...roots] = argv.map((a, i) => (i < 3 ? path.resolve(a) : a));
if (roots.length === 0) roots.push("Init");

const srcOf = (m) => path.join(srcDir, ...m.split(".")) + ".lean";
const outOf = (m, ext) => path.join(outDir, ...m.split(".")) + ext;

/** The header's imports, by kind of line (`import`, `public import`, `import all`,
 `meta import`…), up to the first non-header command. */
function importsOf(m) {
  const src = fs.readFileSync(srcOf(m), "utf8").replace(/\/-[\s\S]*?-\//g, "").replace(/--.*$/gm, "");
  const out = [];
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (t === "" || t === "prelude" || t === "module") continue;
    const mm = t.match(/^(?:public\s+)?(?:meta\s+)?import\s+(?:all\s+)?(.+)$/);
    if (!mm) break;
    for (const n of mm[1].trim().split(/\s+/)) out.push(n);
  }
  return out;
}

// the closure of the roots
const deps = new Map();
const todo = [...roots];
while (todo.length) {
  const m = todo.pop();
  if (deps.has(m)) continue;
  const ds = importsOf(m);
  deps.set(m, ds);
  todo.push(...ds);
}
console.log(`${deps.size} modules, ${jobs} at a time`);

const done = new Set([...deps.keys()].filter((m) => fs.existsSync(outOf(m, ".olean")) && fs.existsSync(outOf(m, ".ir"))));
const running = new Set();
const failed = [];
const t0 = Date.now();
let finished = done.size;

function run(m) {
  return new Promise((ok) => {
    fs.mkdirSync(path.dirname(outOf(m, ".olean")), { recursive: true });
    const args = [leanJs, "-R", srcDir, "-o", outOf(m, ".olean"), "-i", outOf(m, ".ilean"),
      srcOf(m), "-Dcompiler.postponeCompile=false"];
    const p = spawn(process.execPath, ["--stack-size=65500", ...args], {
      env: { ...process.env, LEAN_PATH: outDir }, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    p.stdout.on("data", (d) => (log += d));
    p.stderr.on("data", (d) => (log += d));
    const t = Date.now();
    p.on("close", (code) => {
      finished++;
      const s = ((Date.now() - t) / 1000).toFixed(1);
      if (code === 0) { done.add(m); console.log(`[${finished}/${deps.size}] ${m} ${s}s`); }
      else { failed.push(m); console.log(`FAIL ${m} (${code}) ${s}s\n${log.slice(-2000)}`); }
      ok();
    });
  });
}

await new Promise((finish) => {
  const pump = () => {
    if (failed.length) { if (running.size === 0) finish(); return; }
    for (const [m, ds] of deps) {
      if (running.size >= jobs) break;
      if (done.has(m) || running.has(m) || !ds.every((d) => done.has(d))) continue;
      running.add(m);
      run(m).then(() => { running.delete(m); pump(); });
    }
    if (running.size === 0) finish();
  };
  pump();
});
console.log(`${done.size}/${deps.size} written in ${((Date.now() - t0) / 1000).toFixed(0)}s${failed.length ? `; FAILED: ${failed.join(" ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
