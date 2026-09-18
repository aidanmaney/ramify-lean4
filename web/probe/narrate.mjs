// C2/C3 — TEMPLATE COVERAGE over the CLI corpus, and the residue, honestly.
//   npm run probe -- narrate            coverage + residue table
//   npm run probe -- narrate --print    …and odd_sums narrated as an outline
//
// A tactic node is COVERED when `narrateFamily` claims it — i.e. a template
// wrote its line rather than the `Then <head>` residue. The floor below is
// MEASURED: a drop is a finding (a new fixture with an unhandled kind, or a
// family that stopped dispatching), not something to lower.
import {
  narrateCtx,
  narrateFamily,
  narrateStep,
  summarize,
  narrationFor,
  applyNarration,
  isNarrated,
  applyElisions,
  outlineCuts,
  goalCut,
  stepCut,
  stepElidable,
  NARRATE_MARK,
  applyTraces,
  traceIndex,
} from "./lib.mjs";
import { records, tree, byIdOf, kidsOf, tally } from "./corpus.mjs";

// The measured floors. Coverage is the share of tactic nodes a template
// claims; `RESIDUE_MAX` is how many may fall through to `Then …`.
const COVERAGE_MIN = 1;
const RESIDUE_MAX = 0;
// Every narrated line must fit the strip's own reading: two clamped lines.
const LINE_MAX = 96;

const t = tally();
// B4's traces reach narration only through the DRAWN tree (`applyTraces` runs
// after the cuts), so the trace template is exercised exactly where the widget
// exercises it: `narrationFor(base, drawn)` with a traced drawn tree. The
// corpus carries 36 traces (`gen.sh --traces`); 10 of them have a lemma list.
let traceLines = 0;
let tactics = 0;
let covered = 0;
const residue = new Map();
const families = new Map();
let longest = 0;
let longestText = "";

for (const rec of records()) {
  const base = tree(rec);
  const ctx = narrateCtx(base);
  for (const n of base) {
    if (n.type !== "tactic") continue;
    tactics++;
    const fam = narrateFamily(n);
    families.set(fam || "(residue)", (families.get(fam || "(residue)") ?? 0) + 1);
    if (isNarrated(n)) covered++;
    else {
      const head = n.label.split("\n")[0].trim().split(/\s/)[0];
      residue.set(head, (residue.get(head) ?? 0) + 1);
    }
    // Both forms: the bare strip line, and the one a summary composes with
    // the statement a closing step discharges.
    for (const line of [narrateStep(n, ctx), narrateStep(n, ctx, true)]) {
      t.ok(line !== "", `empty narration: ${rec.file} ${n.label.slice(0, 30)}`);
      if (line.length > longest) {
        longest = line.length;
        longestText = line;
      }
    }
  }

  // Summaries are TOTAL and BOUNDED: one for every node, none of them runaway.
  const sums = summarize(base, ctx);
  for (const n of base)
    t.ok(
      (sums.get(n.id) ?? "").length <= 262,
      `summary over cap: ${rec.file} ${n.id}`,
    );

  // Determinism: same input, same output, twice.
  const again = summarize(base);
  for (const n of base)
    t.ok(again.get(n.id) === sums.get(n.id), `summary not deterministic: ${n.id}`);

  // The strip map over the DRAWN tree, with cuts standing: a folded goal must
  // get a summary of what it hides, and the author's comment must always win.
  const byId = byIdOf(base);
  const kids = kidsOf(base);
  const se = stepElidable(base);
  for (const cuts of [[], outlineCuts(byId, kids)]) {
    const drawn = applyElisions(base, cuts);
    const map = narrationFor(base, drawn);
    for (const d of drawn) {
      if (d.comment) t.ok(!map.has(d.id), `narration overwrote an author comment: ${d.id}`);
      if (d.folded)
        t.ok(map.has(d.id) || !!d.comment, `folded goal with no summary: ${d.id}`);
      const s = map.get(d.id);
      if (s !== undefined) t.ok(s.startsWith(NARRATE_MARK), `strip lost its ∴ mark: ${d.id}`);
    }
    const narrated = applyNarration(drawn, base);
    t.eq(narrated.length, drawn.length, "applyNarration changed the node count");
    for (let i = 0; i < drawn.length; i++)
      t.eq(narrated[i].id, drawn[i].id, "applyNarration reordered the tree");
  }

  // The TRACE template, on the tree the widget draws: the stamp lands on the
  // drawn node, so `narrationFor` has to carry it back onto the base node it
  // narrates from. Before that fix every one of these said "This is routine".
  const traced = applyTraces(
    base,
    new Set(),
    traceIndex(rec.data.proof.automationTraces),
  );
  for (const line of narrationFor(base, traced).values())
    if (/\b(simp|simp_all|grind|aesop) used /.test(line)) traceLines++;

  // …and a per-goal fold (`−`) plus the hop ◌ on its step mints, which is
  // where a HOP's composed summary is exercised.
  for (const g of base.filter((n) => n.type === "goal").slice(0, 6)) {
    const step = (kids.get(g.id) ?? [])[0];
    for (const c of [goalCut(byId, g.id, kids), step && se.has(step.id) ? stepCut(byId, step.id, kids) : null]) {
      if (!c) continue;
      const drawn = applyElisions(base, [c]);
      const map = narrationFor(base, drawn);
      for (const d of drawn)
        if (d.folded && !d.comment)
          t.ok(map.has(d.id), `${c.kind}ped goal with no summary: ${g.id}`);
    }
  }
}

const coverage = covered / tactics;
console.log(`tactic nodes ${tactics}, templated ${covered} (${(coverage * 100).toFixed(1)}%), residue ${tactics - covered}`);
console.log(
  "families:",
  [...families.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" "),
);
console.log(
  "residue heads:",
  residue.size === 0
    ? "(none)"
    : [...residue.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" "),
);
console.log(`longest line ${longest}: ${longestText}`);

t.ok(coverage >= COVERAGE_MIN, `coverage ${(coverage * 100).toFixed(1)}% below the measured floor ${(COVERAGE_MIN * 100).toFixed(0)}%`);
t.ok(tactics - covered <= RESIDUE_MAX, `residue ${tactics - covered} above the measured ceiling ${RESIDUE_MAX}`);
t.ok(longest <= LINE_MAX, `a narrated line ran to ${longest} chars`);

// B4 ∘ C2: at least one automation step in the corpus narrates what it USED
// rather than that it was routine. 10 of the 36 traces carry a lemma list.
console.log(`trace-narrated steps: ${traceLines}`);
t.ok(traceLines > 0, "no step narrated `simp used …` — the trace template never fired");

if (process.argv.includes("--print")) {
  const i = records().findIndex((r) => r.file.includes("odd_sums"));
  const rec = records()[i];
  // Traced, as the widget's drawn tree is: an automation step should say what
  // it USED wherever the corpus has a lemma list for it.
  const base = applyTraces(
    tree(rec),
    new Set(),
    traceIndex(rec.data.proof.automationTraces),
  );
  const ctx = narrateCtx(base);
  const kids = kidsOf(base);
  const seen = new Set();
  console.log(`\n${rec.file} — narrated\n`);
  const rec2 = (n, d) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    const text =
      n.type === "tactic"
        ? narrateStep(n, ctx)
        : `⊢ ${n.label.replace(/^⊢\s*/, "").replace(/\s+/g, " ").slice(0, 60)}`;
    console.log("  ".repeat(d) + (n.type === "tactic" ? "· " : "") + text);
    for (const k of kids.get(n.id) ?? []) rec2(k, d + 1);
  };
  for (const r of base.filter((n) => n.parents.length === 0)) rec2(r, 0);

  console.log("\nsummaries (root and each branch root):\n");
  const sums = summarize(base, ctx);
  for (const n of base.filter((x) => x.type === "goal").slice(0, 6))
    console.log(`  ${n.id}: ${sums.get(n.id)}`);
}

t.done();
