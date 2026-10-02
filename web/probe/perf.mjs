// @probe
// Client-side performance of the pure engine, offline.  INFORMATIONAL: always
// exits 0 and is deliberately NOT in `npm test` (timings are machine noise).
//
//   npm run probe -- perf                   corpus table + synthetic scaling
//   npm run probe -- perf --corpus          corpus only
//   npm run probe -- perf --scale           synthetic only
//   npm run probe -- perf --sizes 100,300,1000,3000   tactic-node targets
//   npm run probe -- perf --shape mixed|chain|split|all   (default all)
//   npm run probe -- perf --runs 5          median over N runs (default 5)
//   npm run probe -- perf --big             adds a 10000-node size
//   npm run probe -- perf --limit [--limit-max N]   recursion ceiling per stage on one linear chain (search cap N, default 6000)
//
// Profiling one stage:  node --cpu-prof --cpu-prof-dir=DIR probe/run.mjs perf --scale --only layout-wide
// (`--only <stage>` runs just that stage so the profile is not diluted.)
//
// Stages (layout-* rows include createLayoutEngine): tree (proofToTree),
// elide-none / elide-outline / elide-hops (applyElisions: no cuts, collapse-all,
// a ◌ on every 4th tactic), narrate (applyNarration over the
// outline-collapsed tree) and narrate-full (over the full tree), engine
// (createLayoutEngine), then computeLayout in the four modes on the uncut tree,
// on the collapse-all tree (`+collapsed`) and on the ◌-every-4th tree (`+hops`).
// The synthetic Proof is built from the paperproof.ts wire shape; every step
// has a distinct position.start (line-per-step, source order = DFS order).
import * as lib from "./lib.mjs";
import { applyNarration, applyElisions, outlineCuts, createLayoutEngine } from "./lib.mjs";
import { records, byIdOf, kidsOf, MODES, layoutOf, hopEvery, flag, opt } from "./corpus.mjs";
import { synth } from "./synth.mjs";

const RUNS = Number(opt("--runs", 5));
const ONLY = opt("--only", null);
const SHAPES = opt("--shape", "all") === "all" ? ["mixed", "chain", "split"] : [opt("--shape")];
const SIZES = opt("--sizes", flag("--big") ? "100,300,1000,3000,10000" : "100,300,1000,3000").split(",").map(Number);

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const time = (fn, runs = RUNS) => {
  const w = performance.now();
  let out = fn(); // warm-up + the value the next stage needs
  const warm = performance.now() - w;
  if (warm > 400) return { ms: warm, out }; // too slow to repeat: one (cold) sample
  const ts = [];
  for (let i = 0; i < runs; i++) { const t = performance.now(); out = fn(); ts.push(performance.now() - t); }
  return { ms: median(ts), out };
};

// One record's measurable stages.  `stage(name, fn)` runs and records; a stage
// may return the value later stages consume.
function measure(proof, runs, sink) {
  // Under --only every other stage is skipped (bar the inputs it needs), so
  // the CPU profile is (nearly) all the stage asked for.
  const on = (n) => !ONLY || ONLY === n || (ONLY === "layout" && n.startsWith("layout-"));
  const rec = (n, fn, needed = false) => {
    if (!on(n)) return needed ? fn() : undefined;
    const r = time(fn, runs);
    sink[n] = r.ms;
    return r.out;
  };
  const base = rec("tree", () => lib.proofToTree(proof, { slots: proof.deleteSlots }), true);
  const byId = byIdOf(base), kids = kidsOf(base);
  const cuts = outlineCuts(byId, kids);
  rec("elide-none", () => applyElisions(base, []));
  // outl / part are inputs of later stages only: computed lazily so that
  // `--only tree` etc. profile nothing else.
  let outl;
  const getOutl = () => (outl ??= applyElisions(base, cuts));
  if (on("elide-outline")) outl = rec("elide-outline", () => applyElisions(base, cuts));
  // A reading state that keeps most of the tree: ◌ on every 4th tactic
  // (hops / leaf folds / ghosts), the shape a reader mid-proof has.
  const hops = hopEvery(lib, base);
  let part;
  const getPart = () => (part ??= applyElisions(base, hops));
  if (on("elide-hops")) part = rec("elide-hops", () => applyElisions(base, hops));
  rec("narrate", () => applyNarration(getOutl(), base));
  rec("narrate-full", () => applyNarration(base, base));
  rec("engine", () => createLayoutEngine(base, { chips: true }));
  for (const mode of MODES) {
    rec(`layout-${mode}`, () => layoutOf(base, mode));
    rec(`layout-${mode}+collapsed`, () => layoutOf(getOutl(), mode));
    rec(`layout-${mode}+hops`, () => layoutOf(getPart(), mode));
  }
  return { nodes: base.length, tactics: base.filter((n) => n.type === "tactic").length, drawnOutline: ONLY ? 0 : getOutl().length };
}

const fmt = (x) => (x === undefined ? "" : x < 10 ? x.toFixed(2) : x < 100 ? x.toFixed(1) : x.toFixed(0));

// ---------------------------------------------------------------- corpus
function corpus() {
  const rows = [];
  const cols = new Set();
  for (const rec of records()) {
    const proof = rec.data.proof;
    const sink = {};
    let info;
    try { info = measure(proof, Math.max(RUNS, 9), sink); } catch (e) { console.log(`skip ${rec.file}#${rec.data.index}: ${e.message}`); continue; }
    Object.keys(sink).forEach((k) => cols.add(k));
    rows.push({ name: `${rec.file.replace("proofs/", "")}#${rec.data.index}`, ...info, t: sink });
  }
  const stages = [...cols];
  const total = Object.fromEntries(stages.map((s) => [s, rows.reduce((a, r) => a + (r.t[s] ?? 0), 0)]));
  console.log(`\n== corpus: ${rows.length} records, ${rows.reduce((a, r) => a + r.tactics, 0)} tactic nodes, median of ${Math.max(RUNS, 9)} runs (ms)`);
  console.log(`${"stage".padEnd(22)}${"total".padStart(9)}${"mean".padStart(9)}${"max".padStart(9)}   slowest 10 (ms)`);
  for (const s of stages) {
    const top = [...rows].sort((a, b) => (b.t[s] ?? 0) - (a.t[s] ?? 0)).slice(0, 10);
    console.log(`${s.padEnd(22)}${fmt(total[s]).padStart(9)}${fmt(total[s] / rows.length).padStart(9)}${fmt(top[0].t[s]).padStart(9)}   ${top.map((r) => `${r.name.replace(".lean", "")}(${r.tactics}t):${fmt(r.t[s])}`).join("  ")}`);
  }
  // A whole-proof "open + first layout" in each mode, the interactive cost.
  for (const m of MODES) {
    const s = (r) => (r.t.tree ?? 0) + (r.t[`layout-${m}`] ?? 0);
    const worst = rows.reduce((a, r) => (s(r) > s(a) ? r : a));
    console.log(`open ${m.padEnd(8)} (tree + layout) worst: ${fmt(s(worst))} ms  ${worst.name} (${worst.tactics} tactic nodes)`);
  }
}

// ---------------------------------------------------------------- synthetic
function scaling() {
  for (const shape of SHAPES) {
    const rows = [];
    // A chain's cost grows fastest, so it keeps a shorter ladder unless --sizes
    // is given.  (The walks are iterative, so depth is no longer a reason: a
    // chain overflows the stack at no size tried here — `--limit` searches for
    // a ceiling and reports "> N" where there is none.)
    for (const target of shape === "chain" && !flag("--sizes") ? [100, 200, 300, 500] : SIZES) {
      const proof = synth(shape, target);
      const sink = {};
      const runs = target >= 3000 ? Math.min(RUNS, 3) : RUNS;
      let info;
      try { info = measure(proof, runs, sink); } catch (e) { console.log(`${shape} ${target}: ${e.constructor.name}: ${e.message} (stage after ${Object.keys(sink).pop()})`); break; }
      rows.push({ target, ...info, t: sink });
    }
    if (rows.length < 2) continue;
    const stages = Object.keys(rows[0].t);
    console.log(`\n== synthetic ${shape}: median of ${RUNS} runs (ms); n = tactic nodes actually built`);
    console.log(`${"stage".padEnd(22)}${rows.map((r) => String(r.tactics).padStart(9)).join("")}   exp(all)  exp(last pair)`);
    console.log(`${"(drawn after collapse)".padEnd(22)}${rows.map((r) => String(r.drawnOutline).padStart(9)).join("")}   of ${rows.map((r) => r.nodes).join("/")} nodes`);
    for (const s of stages) {
      const xs = rows.map((r) => Math.log(r.tactics)), ys = rows.map((r) => Math.log(Math.max(r.t[s], 0.005)));
      const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
      const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
      const k = rows.length - 1;
      const last = (ys[k] - ys[k - 1]) / (xs[k] - xs[k - 1]);
      const at1000 = rows.find((r) => r.tactics >= 900);
      const flagged = slope > 1.3 || (at1000 && at1000.t[s] > 50) ? "  <-- " + (slope > 1.3 ? "superlinear " : "") + (at1000 && at1000.t[s] > 50 ? ">50ms@~1000" : "") : "";
      console.log(`${s.padEnd(22)}${rows.map((r) => fmt(r.t[s]).padStart(9)).join("")}   ${slope.toFixed(2).padStart(6)}   ${last.toFixed(2).padStart(6)}${flagged}`);
    }
  }
}

// Recursion-depth ceiling: the longest single chain (`--limit`) each stage
// survives before "Maximum call stack size exceeded" (node's default stack;
// the webview's is of the same order).
function limits() {
  console.log("\n== recursion ceiling on a single linear chain (tactic nodes; node default stack)");
  const tryN = (n, run) => { try { run(lib.proofToTree(synth("chain", n), { slots: [] })); return true; } catch (e) { if (e instanceof RangeError) return false; throw e; } };
  const stages = {
    tree: () => {},
    "elide-outline": (b) => applyElisions(b, outlineCuts(byIdOf(b), kidsOf(b))),
    "elide-hops": (b) => applyElisions(b, hopEvery(lib, b)),
    "narrate-full": (b) => applyNarration(b, b),
    "narrate-hops": (b) => applyNarration(applyElisions(b, hopEvery(lib, b)), b),
    ...Object.fromEntries(MODES.map((m) => [`layout-${m}`, (b) => layoutOf(b, m)])),
    "layout-wide+hops": (b) => layoutOf(applyElisions(b, hopEvery(lib, b)), "wide"),
    "layout-stacked+narr": (b) => layoutOf(applyNarration(b, b), "stacked"),
  };
  for (const [name, run] of Object.entries(stages)) {
    let lo = 50, hi = Number(opt("--limit-max", 6000));
    if (!tryN(lo, run)) { console.log(`${name.padEnd(16)} < ${lo}`); continue; }
    if (tryN(hi, run)) { console.log(`${name.padEnd(16)} > ${hi}`); continue; }
    while (hi - lo > lo * 0.05) { const mid = Math.round((lo + hi) / 2); if (tryN(mid, run)) lo = mid; else hi = mid; }
    console.log(`${name.padEnd(16)} ~${lo} steps (${lo * 2} nodes)`);
  }
}

if (flag("--limit")) limits();
else {
  if (!flag("--scale")) corpus();
  if (!flag("--corpus")) scaling();
}
