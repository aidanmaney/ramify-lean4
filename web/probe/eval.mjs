// D6 — THE READABILITY EVAL.
//
//   npm run probe -- eval             the table, the pair and the five moves
//   npm run probe -- eval --verbose   every proof's row, not just the totals
//
// An FLTEval-shaped measurement of the thing this project claims: that a proof
// a person rewrote for a reader scores lower on the structural counts than the
// one they started from, and that the restructuring PRIMITIVES already offer
// the moves that person made.
//
// The corpus is three things:
//
//   1. `proofs/*.lean` through `web/public/sample.ndjson` — the CLI corpus.
//   2. `lean/ProofTreeTour.lean` — the guided demo, i.e. proofs written to be
//      read.
//   3. `lean/ProofTreeScratch.lean` — which holds `infinitude_of_primes` as a
//      Lean user rewrote it, against `proofs/euclid.lean`'s original (the file
//      is unchanged since commit b846a29, which is why the "original" needs no
//      git plumbing: it is still in the corpus).
//
// Neither (2) nor (3) is a Lake target and neither reaches `sample.ndjson`, so
// this probe ELABORATES them itself into `probe/eval-extra.ndjson` (git-
// ignored, ~20s, cached against the sources' mtimes). `gen.sh` is untouched:
// adding these files to `proofs/` would change the tracked corpus, and the
// pair is a fixture for this measurement and not for the harness.
//
// NOTHING here is elaborated a second time to check a rewrite. "Offered" is
// what the pure primitives propose; whether a proposal CHECKS is
// `ProofTree.checkRewrite`'s answer and the LSP probe's business. That split
// is the same one `probe rewrite` draws, and it is what keeps this offline.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { records, tree, kidsOf, tally } from "./corpus.mjs";
import {
  inlineRewrite,
  extractRewrite,
  slotSource,
  linearRuns,
  runForFold,
  collapseRewrite,
  expandRewrite,
  hasSlot,
  applyTraces,
  traceIndex,
  applyElisions,
  goalCut,
  stepElidable,
  renamesFor,
  lintFixesFor,
  lintsByNode,
  headWord,
  proofTitle,
  AUTOMATION_CANDIDATES,
} from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const VERBOSE = process.argv.includes("--verbose");

/* ── The extra corpus ─────────────────────────────────────────────────────
   One ppharness run per file, exactly as `gen.sh` does it (one process per
   file; a single run over several is killed part-way with the imports still
   resident), with the same absolute→relative path rewrite so the printed
   `where` is a path a reader of this repository can use. */

const EXTRA_FILES = ["lean/ProofTreeTour.lean", "lean/ProofTreeScratch.lean"];
const EXTRA_OUT = path.join(here, "eval-extra.ndjson");

function extraRecords() {
  const srcs = EXTRA_FILES.map((f) => path.join(repo, f));
  const newest = Math.max(...srcs.map((s) => fs.statSync(s).mtimeMs));
  const have = fs.existsSync(EXTRA_OUT) && fs.statSync(EXTRA_OUT).mtimeMs > newest;
  if (!have) {
    process.stderr.write(
      `eval: elaborating ${EXTRA_FILES.length} fixture file(s) (~20s, cached in probe/eval-extra.ndjson)…\n`,
    );
    let out = "";
    for (const s of srcs)
      out += execFileSync(
        "lake",
        ["env", "lake", "exe", "ppharness", s, "--traces", "--lint"],
        { cwd: path.join(repo, "lean"), encoding: "utf8", maxBuffer: 1 << 28 },
      );
    fs.writeFileSync(EXTRA_OUT, out.split(`${repo}/`).join(""));
  }
  return fs
    .readFileSync(EXTRA_OUT, "utf8")
    .trim()
    .split("\n")
    .filter((l) => l)
    .map((l) => JSON.parse(l));
}

/* ── The source lookup, as `probe rewrite` does it ────────────────────────── */

const fileCache = new Map();
const linesOf = (file) => {
  let v = fileCache.get(file);
  if (!v) {
    v = fs.readFileSync(path.join(repo, file), "utf8").split("\n");
    fileCache.set(file, v);
  }
  return v;
};

function lookupFor(rec) {
  const lines = linesOf(rec.file);
  const byStart = new Map();
  for (const s of rec.data.proof.deleteSlots ?? [])
    byStart.set(`${s.start.line}:${s.start.character}`, s);
  return (p) => {
    const s = byStart.get(`${p.line}:${p.character}`);
    return s ? slotSource(s, (l) => lines[l] ?? "") : null;
  };
}

/* ── The metrics ──────────────────────────────────────────────────────────
   STEPS is the raw parser count — the number the rewrite pill claims to
   change, and the one thing here that does not depend on a reader's cuts.
   DEPTH is the tree's own: how far a reader has to descend to reach the
   deepest node. HAVE/GOAL is Isar's own readability axis (stated intermediate
   facts per branch point) — high is not automatically bad, but a proof with
   more `have`s than goals is stating more than it is splitting. */

function metrics(rec) {
  const proof = rec.data.proof;
  const nodes = tree(rec);
  const slots = proof.deleteSlots ?? [];
  const ctx = { nodes, src: lookupFor(rec), slots };

  const kids = kidsOf(nodes);
  const depthOf = new Map();
  let maxDepth = 0;
  for (const n of nodes.filter((x) => x.parents.length === 0)) {
    const walk = (id, d) => {
      if ((depthOf.get(id) ?? -1) >= d) return;
      depthOf.set(id, d);
      maxDepth = Math.max(maxDepth, d);
      for (const k of kids.get(id) ?? []) walk(k.id, d + 1);
    };
    walk(n.id, 0);
  }

  const tactics = nodes.filter((n) => n.type === "tactic");
  const goals = nodes.filter((n) => n.type === "goal");
  const haves = tactics.filter((n) => headWord(n.label) === "have");
  const unusedHaves = tactics.filter((n) => n.uses && n.uses.count === 0);

  const runs = linearRuns(nodes, hasSlot(slots));
  const closing = runs.filter((r) => r.closes);

  // The offers, by kind. Collapse counts the runs the primitive will actually
  // propose on (`closes`, and computable) plus the folded-goal entry point;
  // expand needs a trace, so it reads the corpus's own (`gen.sh --traces`).
  const offers = { inline: [], extract: [], collapse: [], expand: [], rename: [], lint: [] };
  for (const n of tactics) {
    const i = inlineRewrite(n, ctx);
    if (i.ok) offers.inline.push({ node: n, r: i.rewrite });
    const e = extractRewrite(n, ctx);
    if (e.ok) offers.extract.push({ node: n, r: e.rewrite });
  }
  for (const r of closing) {
    const p = collapseRewrite(r, ctx, AUTOMATION_CANDIDATES[0]);
    if (p.ok) offers.collapse.push({ run: r, r: p.rewrite });
  }
  // The reader's other entry point: a folded goal whose `+N` hides a chain.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const se = stepElidable(nodes);
  for (const g of goals) {
    const c = goalCut(byId, g.id, kids); void se;
    if (!c || c.kind !== "fold") continue;
    const d = applyElisions(nodes, [c]).find((n) => n.id === g.id);
    if (!d?.folded) continue;
    const r = runForFold(d, nodes);
    if (!r) continue;
    const p = collapseRewrite(r, ctx, AUTOMATION_CANDIDATES[0]);
    if (p.ok) offers.collapse.push({ run: r, r: p.rewrite, fold: g.id });
  }
  const traced = applyTraces(nodes, new Set(), traceIndex(proof.automationTraces));
  for (const n of traced) {
    if (n.type !== "tactic" || !n.trace) continue;
    const p = expandRewrite(n, ctx);
    if (p.ok) offers.expand.push({ node: n, r: p.rewrite });
  }
  const seenRename = new Set();
  for (const g of goals) {
    if (!g.hyps?.length) continue;
    for (const [, r] of renamesFor(g, ctx)) {
      const key = `${r.rewrite.targetId}:${r.rewrite.name}`;
      if (seenRename.has(key)) continue;
      seenRename.add(key);
      offers.rename.push({ node: g, r: r.rewrite });
    }
  }
  const lintList = proof.lints ?? [];
  const byNode = lintList.length ? lintsByNode(nodes, lintList) : new Map();
  for (const [id, ls] of byNode) {
    const n = byId.get(id);
    if (!n) continue;
    const hit = lintFixesFor(n, ls, ctx).find((f) => f.proposal.ok);
    if (hit?.proposal.ok) offers.lint.push({ node: n, r: hit.proposal.rewrite });
  }

  return {
    where: `${rec.file}#${rec.data.index}`,
    title: proofTitle(proof),
    steps: proof.steps.length,
    depth: maxDepth,
    goals: goals.length,
    haves: haves.length,
    havePerGoal: goals.length ? haves.length / goals.length : 0,
    unusedHaves: unusedHaves.length,
    lints: lintList.length,
    runs: closing.length,
    longestRun: runs.reduce((m, r) => Math.max(m, r.steps.length), 0),
    offers,
    offered:
      offers.inline.length +
      offers.extract.length +
      offers.collapse.length +
      offers.expand.length +
      offers.rename.length +
      offers.lint.length,
    nodes,
    ctx,
    rec,
  };
}

/* ── Run it ───────────────────────────────────────────────────────────────── */

const t = tally();
const all = [...records(), ...extraRecords()].map(metrics);

const COLS = [
  ["proof", 40, (m) => m.where],
  ["steps", 5, (m) => m.steps],
  ["depth", 5, (m) => m.depth],
  ["goals", 5, (m) => m.goals],
  ["have", 4, (m) => m.haves],
  ["h/goal", 6, (m) => m.havePerGoal.toFixed(2)],
  ["unused", 6, (m) => m.unusedHaves],
  ["lint", 4, (m) => m.lints],
  ["runs", 4, (m) => m.runs],
  ["long", 4, (m) => m.longestRun],
  ["in", 3, (m) => m.offers.inline.length],
  ["ex", 3, (m) => m.offers.extract.length],
  ["co", 3, (m) => m.offers.collapse.length],
  ["xp", 3, (m) => m.offers.expand.length],
  ["rn", 3, (m) => m.offers.rename.length],
  ["li", 3, (m) => m.offers.lint.length],
];

const row = (cells) =>
  cells
    .map((c, i) => String(c)[i === 0 ? "padEnd" : "padStart"](COLS[i][1]))
    .join(" ");

console.log(`EVAL  ${all.length} proof(s)\n`);
console.log(row(COLS.map((c) => c[0])));
console.log(COLS.map((c) => "─".repeat(c[1])).join(" "));
for (const m of all)
  if (VERBOSE || m.offered > 0 || m.steps > 6)
    console.log(row(COLS.map((c) => c[2](m))));

const sum = (f) => all.reduce((a, m) => a + f(m), 0);
console.log(COLS.map((c) => "─".repeat(c[1])).join(" "));
console.log(
  row([
    `TOTAL (${all.length})`,
    sum((m) => m.steps),
    Math.max(...all.map((m) => m.depth)),
    sum((m) => m.goals),
    sum((m) => m.haves),
    (sum((m) => m.haves) / sum((m) => m.goals)).toFixed(2),
    sum((m) => m.unusedHaves),
    sum((m) => m.lints),
    sum((m) => m.runs),
    Math.max(...all.map((m) => m.longestRun)),
    sum((m) => m.offers.inline.length),
    sum((m) => m.offers.extract.length),
    sum((m) => m.offers.collapse.length),
    sum((m) => m.offers.expand.length),
    sum((m) => m.offers.rename.length),
    sum((m) => m.offers.lint.length),
  ]),
);

/* ── The pair ────────────────────────────────────────────────────────────── */

const EUCLID_GOAL = /∃ p, Nat.Prime p ∧ N < p/;
const original = all.find((m) => m.where.includes("euclid"));
const human = all.find(
  (m) => m.where.includes("ProofTreeScratch") && EUCLID_GOAL.test(m.title),
);

console.log("\nTHE PAIR — `infinitude_of_primes`, as first written and as rewritten\n");
t.ok(!!original, "the original (proofs/euclid.lean) is in the corpus");
t.ok(!!human, "the rewritten version (lean/ProofTreeScratch.lean) elaborated");

if (original && human) {
  const cmp = [
    ["steps", original.steps, human.steps],
    ["max depth", original.depth, human.depth],
    ["`have`s", original.haves, human.haves],
    ["`have` per goal", original.havePerGoal.toFixed(2), human.havePerGoal.toFixed(2)],
    ["unused `have`s", original.unusedHaves, human.unusedHaves],
    ["lints", original.lints, human.lints],
    ["linear runs", original.runs, human.runs],
    ["longest run", original.longestRun, human.longestRun],
    ["rewrites offered", original.offered, human.offered],
  ];
  for (const [k, a, b] of cmp)
    console.log(
      `  ${k.padEnd(18)} original ${String(a).padStart(6)}   human ${String(b).padStart(6)}`,
    );

  t.ok(human.steps < original.steps, "the human version has fewer steps");
  t.ok(human.depth < original.depth, "the human version is shallower");
  t.ok(
    human.havePerGoal < original.havePerGoal,
    "the human version states fewer intermediate facts per goal",
  );
}

/* ── The five moves ──────────────────────────────────────────────────────────
   The roadmap's own table: what the Lean user did to turn 30 lines into 12.
   Each row is answered from the OFFERS computed above on the ORIGINAL — never
   from a hand-written verdict — and a move nothing offers says so and says
   why. The fraction printed at the end is the roadmap's "5/5 moves offered"
   claim, reported at whatever it actually is. */

console.log("\nTHE FIVE MOVES — what the primitives offer on the original\n");

const moves = [];
if (original) {
  const inl = (name) => original.offers.inline.find((o) => o.r.name === name);
  const stepAt = (line) =>
    original.nodes.find(
      (n) => n.type === "tactic" && n.position?.start.line === line - 1,
    );
  const runCovering = (line) =>
    original.offers.collapse.find((o) =>
      o.run.steps.some((s) => s.position?.start.line === line - 1),
    );

  // 1. Library replacement: the 13-line `have exists_prime_dvd` becomes one
  //    named Mathlib lemma. No primitive in D1–D5 searches a library.
  const lib = original.offers.inline.find((o) => o.r.name === "exists_prime_dvd");
  moves.push({
    move: "Library replacement (`exists_prime_dvd` → `Nat.exists_prime_and_dvd`)",
    offered: !!lib,
    why: lib
      ? lib.r.title
      : "no primitive searches a library — `exact?`/premise selection is the un-built half of D2",
  });

  // 2. Inline the single-use `have hM`.
  const hM = inl("hM");
  moves.push({
    move: "Inline single-use `have` (`hM` into the `obtain`)",
    offered: !!hM,
    why: hM ? hM.r.title : "no inline offered for `hM`",
  });

  // 3. Automation collapse: `have hp1; have hle1; have h2; omega`.
  const collapse = original.offers.collapse.find((o) => o.run.steps.length >= 4);
  moves.push({
    move: "Automation collapse (the chain of `have`s ending in `omega` → one tactic)",
    offered: !!collapse,
    why: collapse
      ? `${collapse.r.title}${collapse.fold ? " (from the folded goal)" : ""}`
      : "no closing run of four or more steps is offered",
  });

  // 4. Absorb a normalisation step: `push_neg at hle`, which the human moved
  //    to the use site as `(by order)`. The only primitive that could take it
  //    is a collapse whose run contains it.
  const pn = original.nodes.find(
    (n) => n.type === "tactic" && /^push_neg\b/.test(n.label.trim()),
  );
  const pnLine = (pn?.position?.start.line ?? -2) + 1;
  const pnRun = pn ? runCovering(pnLine) : null;
  moves.push({
    move: "Absorb a normalisation step (`push_neg at hle` into its use site)",
    offered: !!pnRun,
    why: pnRun
      ? `it is inside the run ${pnRun.r.title} offers to collapse`
      : pn
        ? "no offered move moves a normalisation step to its use site: the step is not in a closing run, and D1's inline is about a `have`'s justification, not a tactic's effect on the context"
        : "the step is not in this proof",
  });

  // 5. Term ↔ tactic swap: `have hpfac : … := Nat.dvd_factorial hp.pos hle`
  //    disappears into the step that reads it — which is exactly D1's inline.
  const hpfac = inl("hpfac");
  moves.push({
    move: "Term ↔ tactic swap (`have hpfac := lemma a b` into its one reader)",
    offered: !!hpfac,
    why: hpfac ? hpfac.r.title : "no inline offered for `hpfac`",
  });
  void stepAt;
}

for (const m of moves)
  console.log(`  ${m.offered ? "OFFERED    " : "not offered"} ${m.move}\n      ${m.why}`);

const got = moves.filter((m) => m.offered).length;
console.log(`\n  ${got}/${moves.length} of the human's moves are offered by the primitives.`);
t.ok(moves.length === 5, "all five moves of the roadmap's table were asked");
// The fraction is a MEASUREMENT, not a target: it is asserted at the value
// measured today so that a change to the primitives — in either direction —
// is a finding rather than a silent drift.
t.ok(got === 4, `the measured fraction is 4/5 (got ${got}/5)`);

t.done();
