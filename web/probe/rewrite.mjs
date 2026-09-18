// D1/D2/D3/D5 — what the restructuring moves offer over the CLI corpus.
//
// `npm run probe -- rewrite            ` the tables plus the assertions
// `npm run probe -- rewrite --declines ` every DECLINE with its reason
//
// The rewrite module is pure text over verbatim source, so the whole offer
// decision runs offline: this probe reads the real `.lean` file behind each
// record (the widget reads `tacticEdits`; here a `deleteSlots` extent sliced
// out of the file is the same bytes), computes both proposals for every node,
// and prints what would be offered with the step count before and after.
//
// NO ELABORATION happens here. Whether a rewrite CHECKS is
// `ProofTree.checkRewrite`'s answer and the LSP probe's business; what this
// probe pins is which rewrites are offered at all, and that the one move a
// human actually made on `infinitude_of_primes` — inlining `hM` — is among
// them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { records, tree, tally } from "./corpus.mjs";
import {
  inlineRewrite,
  extractRewrite,
  slotSource,
  linearRuns,
  runForFold,
  collapseRewrite,
  expandRewrite,
  runExtent,
  hasSlot,
  applyTraces,
  traceIndex,
  applyElisions,
  goalCut,
  stepElidable,
  AUTOMATION_CANDIDATES,
  contradictionShapes,
  renamesFor,
  renameRewrite,
  suggestName,
  lintFix,
  lintName,
  lintNodeAt,
  LINT_FIXES,
  NAME_RULES,
} from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const SHOW_DECLINES = process.argv.includes("--declines");

const fileCache = new Map();
const linesOf = (file) => {
  let v = fileCache.get(file);
  if (!v) {
    v = fs.readFileSync(path.join(repo, file), "utf8").split("\n");
    fileCache.set(file, v);
  }
  return v;
};

/** The offline half of `SourceLookup`: a tactic's tight extent (`deleteSlots`)
 sliced out of the file it came from. */
function lookupFor(rec) {
  const lines = linesOf(rec.file);
  const slots = rec.data.proof.deleteSlots ?? [];
  const byStart = new Map();
  for (const s of slots) byStart.set(`${s.start.line}:${s.start.character}`, s);
  return (p) => {
    const s = byStart.get(`${p.line}:${p.character}`);
    return s ? slotSource(s, (l) => lines[l] ?? "") : null;
  };
}

const t = tally();
const offers = [];
const declines = [];
// D2 — the OFFERS, offline. Which runs exist and which steps carry a trace is
// a source fact and is decided here; whether a candidate actually CLOSES the
// run is `ProofTree.tryClose`'s answer and the LSP probe's business, so the
// counts below are the offer side alone.
const runs = [];
const expands = [];

for (const rec of records()) {
  const nodes = tree(rec);
  const ctx = {
    nodes,
    src: lookupFor(rec),
    slots: rec.data.proof.deleteSlots ?? [],
  };
  const where = `${rec.file}#${rec.data.index}`;
  for (const n of nodes) {
    if (n.type !== "tactic") continue;
    for (const [kind, f] of [
      ["inline", inlineRewrite],
      ["extract", extractRewrite],
    ]) {
      const p = f(n, ctx);
      const line = (n.position?.start.line ?? -1) + 1;
      if (p.ok) offers.push({ where, file: rec.file, kind, line, r: p.rewrite, node: n });
      else if (kind === "inline" ? !!n.uses : /goal|`this`|not on one/.test(p.why))
        declines.push({ where, kind, line, why: p.why, node: n });
    }
  }
}

for (const rec of records()) {
  const base = tree(rec);
  const slots = rec.data.proof.deleteSlots ?? [];
  const where = `${rec.file}#${rec.data.index}`;
  const ctx = { nodes: base, src: lookupFor(rec), slots };

  // D2a — every maximal linear run, and the offer gated on `closes`.
  for (const r of linearRuns(base, hasSlot(slots))) {
    const ext = runExtent(r, slots);
    const p = collapseRewrite(r, ctx, AUTOMATION_CANDIDATES[0]);
    runs.push({
      where,
      steps: r.steps.length,
      closes: r.closes,
      first: (r.steps[0].position?.start.line ?? -1) + 1,
      last: (r.steps.at(-1).position?.start.line ?? -1) + 1,
      head: r.steps[0].label.split("\n")[0].trim().slice(0, 24),
      tail: r.steps.at(-1).label.split("\n")[0].trim().slice(0, 24),
      offered: p.ok,
      why: p.ok ? "" : p.why,
      ext,
      run: r,
      slots,
    });
  }

  // D2a.3 — a FOLDED goal whose subtree is a linear chain: the same test over
  // the steps the reader's `+N` hides, which is where they have already said
  // they do not want to read it.
  const byId = new Map(base.map((n) => [n.id, n]));
  const kids = new Map();
  for (const n of base)
    for (const par of n.parents) (kids.get(par.id) ?? kids.set(par.id, []).get(par.id)).push(n);
  const se = stepElidable(base);
  let folded = 0;
  for (const g of base.filter((n) => n.type === "goal")) {
    const c = goalCut(byId, g.id, kids); void se;
    if (!c || c.kind !== "fold") continue;
    const drawn = applyElisions(base, [c]);
    const d = drawn.find((n) => n.id === g.id);
    if (!d?.folded) continue;
    const r = runForFold(d, base);
    if (!r) continue;
    const p = collapseRewrite(r, ctx, AUTOMATION_CANDIDATES[0]);
    if (!p.ok) continue;
    folded++;
    runs.push({
      where,
      steps: r.steps.length,
      closes: true,
      fold: g.id,
      first: (r.steps[0].position?.start.line ?? -1) + 1,
      last: (r.steps.at(-1).position?.start.line ?? -1) + 1,
      head: r.steps[0].label.split("\n")[0].trim().slice(0, 24),
      tail: r.steps.at(-1).label.split("\n")[0].trim().slice(0, 24),
      offered: true,
      why: "",
      ext: runExtent(r, slots),
      run: r,
      slots,
    });
  }
  void folded;

  // D2b — the expand offer, over the corpus's own traces (`gen.sh --traces`).
  const traced = applyTraces(base, new Set(), traceIndex(rec.data.proof.automationTraces));
  for (const n of traced) {
    if (n.type !== "tactic" || !n.trace) continue;
    const p = expandRewrite(n, ctx);
    if (p.ok)
      expands.push({
        where,
        line: (n.position?.start.line ?? -1) + 1,
        tactic: n.trace.tactic,
        text: p.rewrite.edits[0].newText,
        r: p.rewrite,
      });
    else if (n.trace.kind === "lemmas")
      declines.push({ where, kind: "expand", line: (n.position?.start.line ?? -1) + 1, why: p.why });
  }
}

const fmt = (e) =>
  e.newText.replace(/\n/g, "\\n").slice(0, 58) +
  (e.newText.length > 58 ? "…" : "");

console.log(`OFFERED  ${offers.length} rewrite(s) over the corpus\n`);
for (const o of offers) {
  console.log(
    `  ${o.kind.padEnd(7)} ${o.where}:${o.line}  ${o.r.title}`,
  );
  for (const e of o.r.edits)
    console.log(
      `      ${e.range.start.line + 1}:${e.range.start.character}–${e.range.end.line + 1}:${e.range.end.character}  "${fmt(e)}"`,
    );
}

const byKind = (k) => offers.filter((o) => o.kind === k).length;
console.log(
  `\n  inline ${byKind("inline")} · extract ${byKind("extract")}` +
    `  (declined, of the ones with use counts: ${declines.length})`,
);

if (SHOW_DECLINES) {
  console.log("\nDECLINED");
  for (const d of declines)
    console.log(`  ${d.kind.padEnd(7)} ${d.where}:${d.line}  ${d.why}`);
}

// ── The assertions ──────────────────────────────────────────────────────────
//
// `proofs/euclid.lean` is `infinitude_of_primes` AS FIRST WRITTEN (the file is
// unchanged since commit b846a29); `lean/ProofTreeScratch.lean` holds the same
// theorem after a Lean user cut it from 30 lines to 12 by five moves. The
// second of those moves was inlining `hM` into the `obtain` below it, and
// this is the assertion that the tool offers it.
const hM = offers.find(
  (o) => o.where.includes("euclid") && o.kind === "inline" && o.r.name === "hM",
);
t.ok(!!hM, "euclid: the `have hM` inline is offered (the human's own move)");
if (hM) {
  t.eq(hM.r.edits.length, 2, "hM: one delete and one substitution");
  t.eq(hM.r.edits[0].newText, "", "hM: the `have` lines go");
  // Line 33 (1-based), not 34: the delete extent takes the `have`'s own
  // comment line with it, exactly as the delete gesture does. A comment
  // attached to a tactic belongs to that tactic, and the inline removes both.
  t.eq(
    hM.r.edits[0].range.start.line + 1,
    33,
    "hM: the delete starts at the comment above the `have`",
  );
  t.eq(
    hM.r.edits[1].newText,
    "(by\n    have hpos := Nat.factorial_pos N\n    omega)",
    "hM: `hM` becomes its own justification, re-indented under the `obtain`",
  );
  t.eq(hM.r.targetId, hM.node.uses.users[0], "hM: the target is its one user");
}

// `hle1`, `h2` and `hpos` are also used exactly once — by `omega`, which reads
// them from the CONTEXT and names neither. Nothing is offered, and that is the
// rule the design record calls "used AND written".
for (const name of ["hle1", "h2", "hpos"])
  t.ok(
    !offers.some((o) => o.where.includes("euclid") && o.r.name === name),
    `euclid: no inline for \`${name}\` — its one user is \`omega\`, which names nothing`,
  );

// The 13-line `exists_prime_dvd` is single-use too, and is left where it is.
t.ok(
  !offers.some((o) => o.r.name === "exists_prime_dvd"),
  "euclid: `exists_prime_dvd` is too long to inline",
);

// Extraction's one shape: a parenthesised `(by …)` in a term, with the goal
// the elaborator harvested for it.
const ex = offers.filter((o) => o.kind === "extract");
t.ok(ex.length > 0, "at least one `(by …)` is offered for extraction");
for (const o of ex) {
  t.ok(
    o.r.edits[0].newText.startsWith(" ".repeat(o.node.position.start.character) + "have this : "),
    `${o.where}:${o.line}: the hoisted line is a \`have this\` at the host's indent`,
  );
  t.eq(o.r.edits[1].newText, "this", `${o.where}:${o.line}: the block becomes \`this\``);
  // The rename follow-up (2026-09-17) opens Rename Symbol at `renameAt` in the
  // WRITTEN text: apply the edits (last first — their ranges index the
  // original) and read what stands there.
  const doc = linesOf(o.file).join("\n");
  const offset = (p) =>
    doc.split("\n").slice(0, p.line).reduce((a, l) => a + l.length + 1, 0) + p.character;
  let written = doc;
  for (const e of [...o.r.edits].reverse())
    written =
      written.slice(0, offset(e.range.start)) + e.newText + written.slice(offset(e.range.end));
  const at = o.r.renameAt;
  const wl = at ? written.split("\n")[at.line] ?? "" : "";
  t.eq(
    at ? wl.slice(at.character, at.character + "this :".length) : null,
    "this :",
    `${o.where}:${o.line}: \`renameAt\` points at the written \`this\` binder`,
  );
}

// Every offered edit set is pairwise disjoint and in source order — they are
// applied together in one `applyEdit`, whose ranges all index the ORIGINAL
// document.
for (const o of offers) {
  let prev = null;
  for (const e of o.r.edits) {
    if (prev)
      t.ok(
        prev.line < e.range.start.line ||
          (prev.line === e.range.start.line &&
            prev.character <= e.range.start.character),
        `${o.where}:${o.line}: edits are disjoint and ordered`,
      );
    prev = e.range.end;
  }
}

/* ── D2 ────────────────────────────────────────────────────────────────── */

const collapsible = runs.filter((r) => r.offered);
console.log(
  `\nRUNS     ${runs.length} linear run(s); ${collapsible.length} collapsible ` +
    `(${runs.length - collapsible.length} do not close their goal)\n`,
);
for (const r of collapsible)
  console.log(
    `  ${String(r.steps).padStart(2)} steps  ${r.where}:${r.first}–${r.last}` +
      `${r.fold ? " (folded)" : ""}  ${r.head} … ${r.tail}` +
      `  → ${r.ext.start.line + 1}:${r.ext.start.character}–${r.ext.stop.line + 1}:${r.ext.stop.character}`,
  );

console.log(`\nEXPANDS  ${expands.length} traced step(s) with something to write\n`);
for (const e of expands)
  console.log(
    `  ${e.where}:${e.line}  ${e.tactic} → ${e.text.slice(0, 76)}${e.text.length > 76 ? "…" : ""}`,
  );

console.log(
  `\n  candidates tried per run (in order): ${AUTOMATION_CANDIDATES.join(" · ")}`,
);

// ── The D2 assertions ───────────────────────────────────────────────────────
//
// The roadmap's "automation collapse" row: the human turned
// `have hp1; have hle1; have h2; omega` into one `grind [...]`. The run those
// four steps belong to must be IDENTIFIED, it must end at the `omega`, and it
// must close — everything after that is the elaborator's answer.
const euclidRuns = runs.filter((r) => r.where.includes("euclid") && !r.fold);
const omegaRun = euclidRuns.find((r) => r.tail.startsWith("omega"));
t.ok(!!omegaRun, "euclid: the run ending in `omega` is identified");
if (omegaRun) {
  t.ok(omegaRun.closes, "euclid: that run closes its goal, so a collapse is offered");
  t.ok(omegaRun.offered, "euclid: the collapse is offered on it");
  t.eq(omegaRun.last, 49, "euclid: the run's last step is the `omega` on line 49");
  // The human's own four steps are all in it: `have hp1` (45), `have hle1`
  // (47), `have h2` (48) and the `omega` (49).
  for (const line of [45, 47, 48, 49])
    t.ok(
      omegaRun.run.steps.some((s) => s.position.start.line + 1 === line),
      `euclid: line ${line} is in the run ending at \`omega\``,
    );
}

// …and the reader's own way to that exact move: folding the goal above
// `have hp1` hides those four steps and nothing else, so the collapse is
// offered over 45–49 — the extent the human actually replaced. The maximal
// run is longer (it starts at the `by_contra` on line 40); the FOLD is how a
// reader picks the tail of one.
const humanFold = runs.find(
  (r) => r.where.includes("euclid") && r.fold && r.first === 45 && r.last === 49,
);
t.ok(
  !!humanFold,
  "euclid: folding above `have hp1` offers the human's own 4-step collapse",
);
if (humanFold) t.eq(humanFold.steps, 4, "euclid: that fold hides exactly four steps");

// A run that does not close is never offered: the tactics below it would be
// left with no goal.
for (const r of runs)
  if (!r.closes)
    t.ok(!r.offered, `${r.where}:${r.first}: an open run is not collapsible`);

// Every collapse is ONE splice, over the run's own extent, whose text is
// nothing but the candidate — the first step's column is inherited from the
// extent's start, so there is no indent arithmetic to get wrong.
for (const r of collapsible) {
  t.ok(!!r.ext, `${r.where}:${r.first}: the run has a source extent`);
  const p = collapseRewrite(r.run, { nodes: [], slots: r.slots, src: () => null }, "omega");
  t.ok(p.ok, `${r.where}:${r.first}: the collapse is computable`);
  if (!p.ok) continue;
  t.eq(p.rewrite.edits.length, 1, `${r.where}:${r.first}: one splice`);
  t.eq(p.rewrite.edits[0].newText, "omega", `${r.where}:${r.first}: the text is the candidate alone`);
  t.eq(
    p.rewrite.edits[0].range.start.character,
    r.run.steps[0].position.start.character,
    `${r.where}:${r.first}: the splice starts at the run's own column`,
  );
}

// D2b: the suggestion is written VERBATIM — the text is core's own first line,
// never a list rebuilt from the parsed names.
t.ok(expands.length > 0, "at least one traced step offers its suggestion");
for (const e of expands) {
  t.eq(e.r.edits.length, 1, `${e.where}:${e.line}: expand is one edit`);
  t.ok(!e.text.includes("\n"), `${e.where}:${e.line}: one script, one line`);
  t.ok(
    e.text.startsWith(e.tactic),
    `${e.where}:${e.line}: the suggestion is a \`${e.tactic}\``,
  );
}

/* ── D3 — THE CONTRADICTION SHAPES ──────────────────────────────────────────
   The analysis, not a gesture. `directRewrite` offers exactly one move — a
   `by_contra` on a NEGATED goal, which Batteries documents as being `intro`
   already — and this corpus contains no instance of it, so nothing is wired
   to the hover bar. What the corpus DOES contain is printed here with the
   condition that declined each one. */

const shapes = [];
for (const rec of records()) {
  const nodes = tree(rec);
  const ctx = {
    nodes,
    src: lookupFor(rec),
    slots: rec.data.proof.deleteSlots ?? [],
  };
  for (const c of contradictionShapes(nodes, ctx))
    shapes.push({
      where: `${rec.file}#${rec.data.index}`,
      line: (nodes.find((n) => n.id === c.nodeId)?.position?.start.line ?? -1) + 1,
      ...c,
    });
}

console.log(`\nCONTRADICTION  ${shapes.length} shape(s); ${shapes.filter((c) => c.offer.ok).length} redirection(s) offered\n`);
for (const c of shapes)
  console.log(
    `  ${c.head.padEnd(10)} ${c.where}:${c.line}  ⊢ ${c.goal.slice(0, 34).padEnd(34)}` +
      ` ${c.negated ? "negated" : "positive"}` +
      `${c.binder ? ` binder=\`${c.binder}\` uses=${c.uses}` : ""}` +
      `${c.closing ? ` closes with \`${c.closing}\`` : ""}` +
      `  → ${c.offer.ok ? c.offer.rewrite.title : c.offer.why}`,
  );

// The two the brief names, and the reason each is declined. `euclid`'s
// `by_contra hle` sits on `⊢ N < p`, a POSITIVE goal whose body really does
// derive `False` (through `push_neg at hle`); `odd_sums`'s `exfalso` sits on
// `⊢ Even m` with three steps between it and the closing `exact`.
const euclidContra = shapes.find(
  (c) => c.where.includes("euclid") && c.head === "by_contra",
);
t.ok(!!euclidContra, "euclid: the `by_contra` is seen by the analysis");
if (euclidContra) {
  t.ok(!euclidContra.negated, "euclid: its goal `N < p` is positive");
  t.ok(!euclidContra.offer.ok, "euclid: no redirection is offered on it");
  t.ok(
    /not a negation/.test(euclidContra.offer.why),
    "euclid: the decline names the goal's polarity",
  );
}
const exf = shapes.find((c) => c.head === "exfalso");
t.ok(!!exf, "odd_sums: the `exfalso` is seen by the analysis");
if (exf) t.ok(!exf.offer.ok, "odd_sums: `exfalso` offers no redirection");
t.eq(
  shapes.filter((c) => c.offer.ok).length,
  0,
  "no one-edit redirection exists in this corpus",
);

/* ── D5 — THE RENAMES ───────────────────────────────────────────────────────
   One suggestion per HYPOTHESIS, not per drawn line: the same `h` appears in
   every goal below its binder and in every wrapped half of a long line, and
   the offer is the same one. Keyed on the introducing step and the name. */

const renames = new Map();
const renameDeclines = [];
const seenDecline = new Set();
for (const rec of records()) {
  const nodes = tree(rec);
  const ctx = {
    nodes,
    src: lookupFor(rec),
    slots: rec.data.proof.deleteSlots ?? [],
  };
  const where = `${rec.file}#${rec.data.index}`;
  for (const g of nodes) {
    if (g.type !== "goal" || !g.hyps?.length) continue;
    const m = renamesFor(g, ctx);
    for (const [j, r] of m) {
      const l = g.hyps[j];
      const intro = nodes.find((n) => n.id === r.rewrite.targetId);
      const key = `${where}:${(intro?.position?.start.line ?? -1) + 1}:${l.hypName}`;
      if (!renames.has(key))
        renames.set(key, {
          where,
          line: (intro?.position?.start.line ?? -1) + 1,
          from: l.hypName,
          to: r.to,
          rule: r.rule.id,
          type: l.hypType,
          r: r.rewrite,
        });
    }
    // The declines worth reading: a line whose name IS generic and whose type
    // the table DOES recognise, but which some later rule refused — the shadow
    // test, a binder the elaborator counted no uses for, a step with no
    // verbatim source.
    for (const l of g.hyps) {
      if (!l.hypName || !l.hypType || l.cont) continue;
      const sug = suggestName(l.hypType);
      if (!sug || sug.name === l.hypName) continue;
      const p = renameRewrite(g, l, ctx);
      if (p.ok) continue;
      const key = `${where}:${l.hypName}:${p.why}`;
      if (!seenDecline.has(key)) {
        seenDecline.add(key);
        renameDeclines.push({ where, name: l.hypName, type: l.hypType, to: sug.name, why: p.why });
      }
    }
  }
}

const renameList = [...renames.values()].sort(
  (a, b) => a.where.localeCompare(b.where) || a.line - b.line,
);
console.log(`\nRENAMES  ${renameList.length} hypothes(es) offered a Mathlib name\n`);
for (const r of renameList) {
  console.log(
    `  ${r.where}:${r.line}  \`${r.from}\` → \`${r.to}\`` +
      `  (${r.rule}: ${r.type})  ${r.r.edits.length} edit(s)`,
  );
  for (const e of r.r.edits)
    console.log(
      `      ${e.range.start.line + 1}:${e.range.start.character}–${e.range.end.line + 1}:${e.range.end.character}  "${e.newText}"`,
    );
}
console.log(
  `\n  rules, in order: ${NAME_RULES.map((r) => `${r.id}→h…(${r.alt})`).join(" · ")}`,
);

/* ── D4 — the lints the corpus carries ───────────────────────────────────
   `gen.sh` runs `ppharness --lint`, so Mathlib's own linters have already
   answered about every record here. The corpus's answer is ZERO, and that is
   the finding rather than a gap: `proofs/` is written the way Mathlib asks.
   The gate that exercises the fixes is the LIVE one —
   `npm run probe -- lsp ../lean/ProofTreeLints.lean <line> 2 --lint`, one
   theorem per linter. */
const lintRows = [];
const lintRecs = [...records()];
for (const r of lintRecs) {
  const nodes = tree(r);
  for (const l of r.data.proof.lints ?? []) {
    const id = lintNodeAt(nodes, l);
    const n = nodes.find((x) => x.id === id);
    const p = lintFix(l, n ?? null, { nodes, slots: r.data.proof.deleteSlots ?? [], src: () => null });
    lintRows.push({ where: `${r.file}#${r.data.index}`, l, fix: p });
  }
}
console.log(`\nLINTS  ${lintRows.length} lint(s) over ${lintRecs.length} record(s)`);
for (const row of lintRows)
  console.log(
    `  ${row.where}:${row.l.start.line + 1}  ${lintName(row.l)}  ` +
      `${row.fix.ok ? row.fix.rewrite.title : `no fix (${row.fix.why})`}`,
  );
if (lintRows.length === 0)
  console.log("  — `proofs/` is clean; the fixes are gated on the LIVE probe");
for (const row of lintRows)
  if (row.fix.ok)
    t.ok(row.fix.rewrite.edits.length >= 1, `${row.where}: a lint fix has an edit`);
// Every linter D4 turns on either has a one-edit answer in `LINT_FIXES` or is
// shown alone; nothing may claim a fix it cannot compute.
for (const k of Object.keys(LINT_FIXES))
  t.ok(k.startsWith("linter."), `${k}: a fix is keyed on the option's own name`);
if (SHOW_DECLINES) {
  console.log("\nRENAMES DECLINED");
  for (const d of renameDeclines)
    console.log(`  ${d.where}  \`${d.name}\` : ${d.type}  (would be \`${d.to}\`)  ${d.why}`);
}

// Every rename is whole-identifier and disjoint, and the first edit is the
// BINDER — the introducing step's own occurrence.
for (const r of renameList) {
  t.ok(r.r.edits.length >= 1, `${r.where}: the rename has at least the binder`);
  for (const e of r.r.edits)
    t.eq(e.newText, r.to, `${r.where}: every edit writes the new name`);
  let prev = null;
  for (const e of r.r.edits) {
    if (prev)
      t.ok(
        prev.line < e.range.start.line ||
          (prev.line === e.range.start.line &&
            prev.character <= e.range.start.character),
        `${r.where}: the rename's edits are disjoint and ordered`,
      );
    prev = e.range.end;
    t.eq(
      e.range.end.character - e.range.start.character,
      r.from.length,
      `${r.where}: each edit spans exactly the old name`,
    );
  }
}

// `proofs/rename.lean` is the specimen — the only file in the corpus whose
// hypotheses carry the anonymous names a reader actually meets. Everywhere
// else the authors named them well, and NOTHING is offered: that is the
// finding, not a gap.
t.eq(
  renameList.filter((r) => !r.where.includes("rename.lean")).length,
  0,
  "no rename is offered outside the fixture — the corpus's authors named well",
);
t.eq(renameList.length, 4, "the fixture offers four renames");
const rn = (from, line) =>
  renameList.find((r) => r.from === from && r.line === line);
// `intro h h2` binds TWO hypotheses at ONE position, which is why `usesEach`
// exists: `uses` alone would carry only the last of them.
const hpn = rn("h", 26);
const hn = rn("h2", 26);
t.eq(hpn?.to, "hpn", "`h : p ∣ n` is `hpn`");
t.eq(hn?.to, "hn", "`h2 : 0 < n` is `hn`, from the same `intro`");
if (hpn) {
  t.eq(hpn.r.edits.length, 2, "hpn: the binder and its one named use");
  t.eq(hpn.r.edits[0].range.start.character, 8, "hpn: the binder is at column 8");
  // Whole identifiers only: `h` at 27:25 and NOT the `h` inside `h2` at 27:22.
  t.eq(hpn.r.edits[1].range.start.line + 1, 27, "hpn: the use is on line 27");
  t.eq(hpn.r.edits[1].range.start.character, 25, "hpn: …at the `h`, not inside `h2`");
}
if (hn) t.eq(hn.r.edits[1].range.start.character, 22, "hn: the `h2` occurrence");
// `h : b < a` is read by TWO steps and named by one — `omega` takes it from
// the context. The edit count is the NAMED occurrences, not the use count.
const hba = rn("h", 34);
t.eq(hba?.to, "hba", "`h : b < a` is `hba`");
if (hba) t.eq(hba.r.edits.length, 2, "hba: `omega` names nothing, so it needs no edit");

// The table itself, on the shapes the Mathlib measurement decided.
t.eq(suggestName("0 < n")?.name, "hn", "`0 < n` is `hn`, not `hpos`");
t.eq(suggestName("a < b")?.name, "hab", "`a < b` is `hab`");
t.eq(suggestName("a ≤ b")?.name, "hab", "`a ≤ b` is `hab`");
t.eq(suggestName("x ≠ 0")?.name, "hx", "`x ≠ 0` takes the variable's letter alone");
t.eq(suggestName("p ∣ q")?.name, "hpq", "`p ∣ q` is `hpq`");
t.eq(suggestName("Even n")?.name, "hn", "`Even n` is `hn`");
t.eq(suggestName("Odd n")?.name, "hn", "`Odd n` is `hn` too — the shape, not the word");
t.eq(suggestName("p.Prime")?.name, "hp", "`p.Prime` is `hp`");
t.eq(suggestName("Nat.Prime p")?.name, "hp", "`Nat.Prime p` is `hp`");
t.eq(suggestName("x ∈ s")?.name, "hx", "`x ∈ s` names the ELEMENT (measured 596 to 43)");
// Polarity does not reach the name: Mathlib names `¬ P x` the way it names
// `P x` (measured `ha` 71 · `hb` 52 · `hx` 24, and no `hn…` form).
t.eq(suggestName("¬Even n")?.name, "hn", "a negation is named as its positive is");
t.eq(suggestName("¬(a ∣ b)")?.name, "hab", "…through the parentheses too");
// A type with no simple subject has no name, and no rule fires on a fragment.
t.eq(suggestName("Nat.factorial N + 1 ≤ p"), null, "a compound subject has no letter");
t.eq(suggestName("P n"), null, "an unknown predicate is not in the table");

t.done();
