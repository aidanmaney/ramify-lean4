// @probe
// THE BAKED PLAYGROUND's offline gate: `answer()` (the seam), `play()` (typed
// text → a baked step) and `buildProof()` (attempts → Paperproof records),
// driven over a REAL bake in probe/playground/ and fed to the UNCHANGED
// `proofToTree`.  Run:   npm run probe -- playground
//
// The fixture is `lake exe playgroundbake` output; regenerate it after a
// change to the baker or to demos/playground/AndSwap.lean:
//
//   cd lean && lake build playgroundbake && \
//     .lake/build/bin/playgroundbake ../web/probe/playground/AndSwap.json ../demos/playground/AndSwap.lean
//
// It checks: the format version is enforced; a whole proof typed in the
// visitor's OWN names (`intro a b hab`, `obtain ⟨x, y⟩ := hab`) resolves
// through aliasing and draws a CLOSED tree whose goals and tagged prints show
// those names and read alike (the view's text-equality guard); a mistake
// draws Lean's error as a failed step with a diagnostic and leaves the goal
// open beneath it, and the next attempt replaces it; an untabled tactic is
// NOT BAKED with completions in the visitor's names; whitespace and `\`
// abbreviations normalise; and undo (dropping the last attempt) restores the
// previous tree exactly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkBake, loadTable, bakedEngine, makeAnswer, play, buildProof, NOT_BAKED,
  normalise, goalKey, proofToTree, flattenTaggedText, filterDiagnostics, proofSpan,
  replayText, applyDocEdit, freshDoc, deleteEdit, rankedCompletions, completions,
  swallowed, swallowedMessage,
} from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (ok, what) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL ${what}`);
  }
};

const raw = JSON.parse(fs.readFileSync(path.join(here, "playground/AndSwap.json"), "utf8"));

// --- the format
let refused = 0;
for (const bad of [{ ...raw, playgroundVersion: 2 }, { ...raw, playgroundVersion: undefined }, { ...raw, goals: [] }, null])
  try {
    checkBake(bad);
  } catch {
    refused++;
  }
check(refused === 4, `a wrong version / empty bake is refused (${refused}/4)`);

const t = loadTable(checkBake(raw));
const answer = makeAnswer([bakedEngine(t)]);

// --- the seam itself: keys in, keys out
const root = t.keys[0];
const a0 = await answer(root, "intro p q h");
check(a0 !== NOT_BAKED && Array.isArray(a0.goals) && a0.goals.length === 1 && t.byKey.has(a0.goals[0]), "answer(rootKey, 'intro p q h') → one goal key in the table");
check((await answer(root, "linarith")) === NOT_BAKED, "answer() on an untabled tactic is NOT_BAKED");
check((await answer("no such goal", "simp")) === NOT_BAKED, "answer() on an unknown goal key is NOT_BAKED");
check(goalKey(t.bake.goals[0].goal) === root, "goalKey is the table's key");

// --- normalisation
check(normalise("  intro   a  b ") === "intro a b", "whitespace collapses");
check(normalise("exact \\<h.2, h.1\\>") === "exact ⟨h.2, h.1⟩", `abbreviations expand (${normalise("exact \\<h.2, h.1\\>")})`);

// --- a session: attempts on goal OCCURRENCES, as the page keeps them
const attempts = [];
let built = buildProof(t, attempts, "and_swap'");
const goalOf = (b, i = 0) => b.open[i];
const run = async (typed, i = 0) => {
  const g = goalOf(built, i);
  const r = await play(t, answer, g.state, g.aliases, typed);
  if (r.kind !== NOT_BAKED) {
    attempts.push({ occ: g.occ, play: r });
    built = buildProof(t, attempts, "and_swap'");
  }
  return r;
};

check(built.open.length === 1 && built.proof.openBlock, "at the start the root goal is open (an open block)");
let nodes = proofToTree(built.proof);
check(nodes.some((n) => n.type === "goal" && n.addSpec), "the root goal carries the `+` chip's addSpec");

const nb = await run("linarith");
check(nb.kind === NOT_BAKED && nb.completions.includes("intro p q h"), `untabled → not baked, with completions (${nb.kind}: ${nb.completions?.slice(0, 4).join(" · ")})`);

const r1 = await run("intro a b hab");
check(r1.kind === "ok" && r1.tactic === "intro p q h", `aliasing: 'intro a b hab' is the baked 'intro p q h' (${r1.tactic})`);
const g1 = goalOf(built);
check(g1.target === "b ∧ a", `the goal shows the visitor's names (${g1.target})`);
const hypsShown = built.proof.steps[0].goalsAfter[0].hyps.map((h) => `${h.username} : ${h.type}`);
check(hypsShown.join(", ") === "a : Prop, b : Prop, hab : a ∧ b", `hypotheses renamed (${hypsShown.join(", ")})`);

const nb2 = await run("exact ⟨hab.2, hab.1⟩ ⟨⟩");
check(nb2.kind === NOT_BAKED && nb2.completions.some((c) => c.includes("hab")), `completions read in the visitor's names (${nb2.completions?.join(" · ")})`);

const r2 = await run("obtain ⟨x, y⟩ := hab");
check(r2.kind === "ok" && r2.tactic === "obtain ⟨h1, h2⟩ := h", `introduced names may be respelled (${r2.kind} ${r2.tactic})`);
const r3 = await run("constructor");
check(r3.kind === "ok" && built.open.length === 2, `constructor leaves two goals (${built.open.length})`);

// a mistake: Lean's own error, a failed step, the goal still open below it
const before = JSON.stringify(buildProof(t, attempts, "and_swap'").proof);
const bad = await run("exact x");
check(bad.kind === "error" && /mismatch|type/i.test(bad.error), `a mistake is Lean's error (${bad.kind}: ${bad.error?.split("\n")[0]})`);
check(!/\bh1\b/.test(bad.error ?? "") , "the error reads in the visitor's names (no canonical h1)");
const diags = filterDiagnostics(built.diagnostics, proofSpan(built.proof)).kept;
check(diags.length === 1 && diags[0].severity === 1, `the error is one diagnostic (${diags.length})`);
check(built.proof.recovered?.some((r) => r.kind === "failed"), "the failed attempt is a recovered `failed` step");
check(built.open.length === 2 && built.open[0].failed, "its goal is still open (a retry copy) and marked failed");
nodes = proofToTree(built.proof);
const failedNode = nodes.find((n) => n.recovered === "failed");
check(failedNode && failedNode.label === "exact x", `the tree draws the failed tactic (${failedNode?.label})`);

// undo restores the previous tree exactly
attempts.pop();
built = buildProof(t, attempts, "and_swap'");
check(JSON.stringify(built.proof) === before, "undo (drop the last attempt) restores the tree");

// the retry replaces the failure; then the other goal
await run("exact x");
const ok1 = await run("exact y");
check(ok1.kind === "ok" && !built.proof.recovered?.length && built.diagnostics.length === 0, "the next attempt on the goal replaces the failure");
const ok2 = await run("exact x");
check(ok2.kind === "ok", `second goal closes (${ok2.kind})`);
check(built.closed && built.open.length === 0, `the proof is closed (${built.open.length} open)`);

nodes = proofToTree(built.proof);
check(!nodes.some((n) => n.addSpec), "no goal is left with a `+` chip");
const tactics = nodes.filter((n) => n.type === "tactic").map((n) => n.label);
check(tactics.join(" | ") === "intro a b hab | obtain ⟨x, y⟩ := hab | constructor | exact y | exact x", `the tree reads the visitor's proof (${tactics.join(" | ")})`);
// the view's text-equality guard: every tagged print reads as its plain goal
const tagged = new Map(built.proof.taggedGoals.map((e) => [e.goalId, e.goal]));
let guard = 0, goals = 0;
for (const s of built.proof.steps)
  for (const g of [s.goalBefore, ...s.goalsAfter]) {
    goals++;
    const tg = tagged.get(g.id);
    if (!tg || flattenTaggedText(tg.type) !== g.type) continue;
    const ids = new Set(tg.hyps.flatMap((b) => b.fvarIds));
    if (g.hyps.every((h) => ids.has(h.id))) guard++;
  }
check(guard === goals, `every tagged print reads as its plain goal, hyp ids matched (${guard}/${goals})`);
check(built.hovers.length > t.bake.hovers.length, `renamed popups were minted for the aliases (${built.hovers.length - t.bake.hovers.length})`);
check(built.source.includes("  · exact y") && built.source.startsWith("theorem and_swap'"), "the proof's source text is kept, `·` per extra goal");
// B2: the hypotheses introduced by steps get origins
check((built.proof.hypOrigins ?? []).some((o) => o.username === "hab"), "hypOrigins name the step that introduced `hab`");
// a used hypothesis is the step's tacticDependsOn
const obtainStep = built.proof.steps.find((s) => s.tacticString.startsWith("obtain"));
check(obtainStep && obtainStep.tacticDependsOn.length === 1, "the obtain step depends on `hab`");

// aliasing refuses a name that would show two hypotheses alike
const clash = await play(t, answer, t.byKey.get(root), [], "intro p p h");
check(clash.kind === NOT_BAKED, `a respelling that shows two hypotheses alike is refused (${clash.kind})`);

// THE EDITOR'S TEXT (playgroundText.ts): the page's source of truth. A proof
// written as Lean text replays to the same tree; the tree's gestures are
// edits to that text (an open goal's anchor, the delete gesture's slots).
const header = `theorem ${t.bake.theorem} : ${t.bake.statement} := by`;
const textTree = async (doc) => {
  const r = await replayText(t, answer, doc, new Map());
  return { r, b: buildProof(t, r.attempts, "pg:text") };
};
{
  const doc = [header, "  intro a b hab", "  obtain ⟨x, y⟩ := hab", "  constructor", "  case right => exact x", "  exact y"].join("\n");
  const { r, b } = await textTree(doc);
  check(b.closed, `a proof written as text, \`case\` line included, closes (${b.open.length} open)`);
  check(r.attempts.every((a) => a.at), "every step carries its range in the text");
  // the anchors: write the next tactic of an open goal
  let d = freshDoc(header);
  let x = await textTree(d);
  d = applyDocEdit(d, x.r.anchors.get("g0")("intro a b hab"));
  x = await textTree(d);
  d = applyDocEdit(d, x.r.anchors.get(x.b.open[0].nodeId)("obtain ⟨x, y⟩ := hab"));
  x = await textTree(d);
  d = applyDocEdit(d, x.r.anchors.get(x.b.open[0].nodeId)("constructor"));
  x = await textTree(d);
  const [left, right] = x.b.open;
  d = applyDocEdit(d, x.r.anchors.get(right.nodeId)("exact x"));
  check(d.split("\n").at(-1) === "  case right => exact x", `the second goal is written by its case tag (${JSON.stringify(d.split("\n").at(-1))})`);
  x = await textTree(d);
  d = applyDocEdit(d, x.r.anchors.get(x.b.open[0].nodeId)("exact y"));
  x = await textTree(d);
  check(x.b.closed && left.caseName === "left", `writing through the anchors closes the proof:\n${d}`);
  // a MULTI-LINE tactic from the tree (⇧Enter) keeps its shape where it
  // lands: later lines move in with the first, and under a `case`/`·` head
  // the block is laid out as Lean lays one out
  {
    let m = freshDoc(header);
    let mx = await textTree(m);
    m = applyDocEdit(m, mx.r.anchors.get("g0")("intro a b hab"));
    mx = await textTree(m);
    m = applyDocEdit(m, mx.r.anchors.get(mx.b.open[0].nodeId)("obtain ⟨x, y⟩ := hab"));
    mx = await textTree(m);
    const before = m;
    m = applyDocEdit(m, mx.r.anchors.get(mx.b.open[0].nodeId)("constructor\n· exact y\n· exact x"));
    check(m.endsWith("\n  constructor\n  · exact y\n  · exact x"), `a multi-line tactic is indented with its first line:\n${m}`);
    mx = await textTree(m);
    check(mx.b.closed, `…and closes the proof (${mx.b.open.length} open)`);
    mx = await textTree(before + "\n  constructor");
    const rightGoal = mx.b.open[1];
    const c = applyDocEdit(before + "\n  constructor", mx.r.anchors.get(rightGoal.nodeId)("skip\nexact x"));
    check(c.endsWith("\n  case right =>\n    skip\n    exact x"), `under \`case right =>\` the block starts on its own line, two in:\n${c}`);
  }
  // a failure stops its block; the line below is noted, not run
  const bad = [header, "  intro a b hab", "  exact hab", "  constructor"].join("\n");
  const y = await textTree(bad);
  check(y.r.attempts.some((a) => a.play.kind === "error") && y.r.editorDiagnostics.some((e) => e.severity === 4), "a failing line stops its block and the next is marked not run");
  // a split WITH alternatives: each `| tag names =>` names its case (replayed
  // as the split then `rename_i`, which the bake now explores under a split)
  const alts = [header, "  intro a b hab", "  cases hab with", "  | intro x y =>", "    constructor", "    · exact y", "    · exact x"].join("\n");
  const z = await textTree(alts);
  const splitStep = z.b.proof.steps.find((st) => st.tacticString === "cases hab with");
  check(!!splitStep && splitStep.goalsAfter[0]?.hyps.some((h) => h.username === "x"), `\`cases … with | intro x y\` names its case (${splitStep?.goalsAfter[0]?.hyps.map((h) => h.username)})`);
  check(z.b.closed, `the named split's alternative closes the proof (${z.b.open.length} open; ${z.r.editorDiagnostics.map((e) => e.message).join("; ")})`);
  // LEAN'S BLOCK RULES, one fixture each
  const L = (...ls) => [header, ...ls].join("\n");
  // bullets: each `·` takes the next goal
  {
    const q = await textTree(L("  intro a b hab", "  obtain ⟨x, y⟩ := hab", "  constructor", "  · exact y", "  · exact x"));
    check(q.b.closed, "bullets take the goals in order and close them");
  }
  // a failing bullet recovers: its sibling still runs
  {
    const q = await textTree(L("  intro a b hab", "  obtain ⟨x, y⟩ := hab", "  constructor", "  · exact x", "  · exact x"));
    const kinds = q.r.attempts.map((a) => a.play.kind);
    check(kinds.filter((k) => k === "error").length === 1 && kinds.at(-1) === "ok", `a failing bullet does not stop its sibling (${kinds.join(",")})`);
  }
  // `sorry` leaves its goal open, and the next line works on the goal after it
  {
    const q = await textTree(L("  intro a b hab", "  obtain ⟨x, y⟩ := hab", "  constructor", "  sorry", "  exact x"));
    check(q.b.open.length === 1 && q.b.open[0].caseName === "left", `\`sorry\` keeps \`left\` open and \`exact x\` closes \`right\` (${q.b.open.map((o) => o.caseName)})`);
    check(q.r.anchors.has(q.b.open[0].nodeId), "a `sorry` goal's next tactic replaces the `sorry`");
  }
  // more lines than goals: "No goals", and nothing after it runs
  {
    const q = await textTree(L("  intro a b hab", "  obtain ⟨x, y⟩ := hab", "  constructor", "  · exact y", "  · exact x", "  rfl"));
    check(q.r.editorDiagnostics.some((d) => d.message === "No goals to be proved."), `a line after the proof closed says there are no goals (${q.r.attempts.map((a) => a.play.kind + ":" + a.play.label)} / ${q.r.editorDiagnostics.map((d) => d.message)})`);
  }
  // an unknown case tag is Lean's error, on that line
  {
    const q = await textTree(L("  intro a b hab", "  obtain ⟨x, y⟩ := hab", "  constructor", "  case middle => exact x"));
    check(q.r.editorDiagnostics.some((d) => /Case tag 'middle' not found/.test(d.message)), "an unknown case tag is an error");
  }
  // a line indented deeper continues the tactic above (one step, not two)
  {
    const q = await textTree(L("  intro a b hab", "  exact", "    ⟨hab.2,", "     hab.1⟩"));
    check(q.r.attempts.length === 2 && q.r.attempts[1].at.stop.line === 4, `a deeper line continues its tactic (${q.r.attempts.length} steps)`);
  }
  // a split with an alternative missing: that case stays open, and its next
  // tactic is written as a new alternative
  {
    const q = await textTree(L("  intro a b hab", "  cases hab with", "  | intro x y => sorry"));
    const g = q.b.open[0];
    const doc2 = applyDocEdit(L("  intro a b hab", "  cases hab with", "  | intro x y => sorry"), q.r.anchors.get(g.nodeId)("constructor"));
    check(/\| intro x y =>\n    constructor$/.test(doc2), `a \`sorry\` alternative's first tactic goes on its own line (${JSON.stringify(doc2.split("\n").slice(-2))})`);
  }
  // comments are ignored, a trailing one included
  {
    const q = await textTree(L("  -- swap them", "  intro a b hab -- names", "  /- a block", "     comment -/", "  exact ⟨hab.2, hab.1⟩"));
    check(q.b.closed, "comments, trailing and block, are ignored");
  }
  // the text's comments reach the tree: one above a step, one trailing it,
  // and a `.mark` flag (proofToTree's attribution and flag parsing)
  {
    const q = await textTree(L("  -- take it apart", "  intro a b hab", "  obtain ⟨x, y⟩ := hab -- .mark", "  constructor", "  · exact y", "  · exact x"));
    const nodes2 = proofToTree({ ...q.b.proof, comments: q.r.comments });
    const intro = nodes2.find((n) => n.type === "tactic" && n.label.startsWith("intro"));
    const obtain = nodes2.find((n) => n.type === "tactic" && n.label.startsWith("obtain"));
    check(intro?.comment === "take it apart", `a comment above a step is that step's strip (${JSON.stringify(intro?.comment)})`);
    check(obtain?.flags?.mark !== undefined, `a trailing \`-- .mark\` marks its own step (${JSON.stringify(obtain?.flags)})`);
  }
  // SWALLOWED LINES: lines the auto-indent nested under the first tactic are
  // read as part of it; the page says so, in the editor's line numbers
  {
    const q = await textTree(L("  intro a b hab", "    obtain ⟨x, y⟩ := hab", "    constructor"));
    const note = q.r.indent.get("g0");
    check(note === "Lines 3–4 are indented under line 2, so Lean reads them as part of it — line them up with line 2", `swallowed lines are named (${JSON.stringify(note)})`);
    check(q.r.editorDiagnostics.some((d) => d.message === note), "the editor's note says the same");
    const one = swallowed([{ line: 1, col: 2, text: "intro a" }, { line: 2, col: 4, text: "exact h" }]);
    check(!!one && /^Line 3 is indented under line 2/.test(swallowedMessage(one)), "one swallowed line reads in the singular");
    // Lean's ordinary continuations are not flagged
    check(swallowed([{ line: 1, col: 2, text: "exact" }, { line: 2, col: 4, text: "⟨hab.2," }]) === null, "a term continued below its tactic is not swallowing");
    check(swallowed([{ line: 1, col: 2, text: "induction n with" }, { line: 2, col: 2, text: "| zero => rfl" }]) === null, "`with` alternatives are not swallowing");
    check(swallowed([{ line: 1, col: 2, text: "refine ⟨?_," }, { line: 2, col: 4, text: "exact h⟩" }]) === null, "a line ending open is continued, not swallowing");
    const ok = await textTree(L("  intro a b hab", "  exact", "    ⟨hab.2,", "     hab.1⟩"));
    check(ok.r.indent.size === 0, "a tactic that runs is never flagged");
  }
  // RANKED HINTS: every succeeding tactic lands in exactly one group, in the
  // bake's order; a closing one heads the list, a frontier-only one is "other"
  {
    for (let st = 0; st < t.bake.goals.length; st++) {
      const all = completions(t, st, []);
      const r = rankedCompletions(t, st, []);
      const flat = [...r.closes, ...r.progress, ...r.other];
      if (flat.length !== all.length || !all.every((c) => flat.includes(c))) {
        check(false, `ranked hints partition state ${st}'s completions`);
        break;
      }
      for (const g of [r.closes, r.progress, r.other])
        if (g.join("\n") !== all.filter((c) => g.includes(c)).join("\n")) check(false, `state ${st}: a group keeps the bake's order`);
      for (const c of r.closes) {
        const o = t.steps.get(st).get(c);
        check(o && o.goals.length === 0, `state ${st}: \`${c}\` closes`);
      }
      for (const c of r.other) {
        const o = t.steps.get(st).get(c);
        check(o.goals.every((g) => g === st || t.bake.goals[g].frontier), `state ${st}: \`${c}\` is other only where its goals are unexplored`);
      }
    }
    const exact = t.byKey.get(t.keys.find((k, i) => completions(t, i, []).some((c) => c.startsWith("exact"))) ?? "");
    if (exact !== undefined) check(rankedCompletions(t, exact, []).closes.some((c) => c.startsWith("exact")), "an `exact` that closes is ranked first");
  }
  // the delete gesture's slots: the last step's line goes, its goal reopens
  const last = x.r.attempts.at(-1);
  const e = deleteEdit({ kind: "tactic", anchors: [last.at], comments: [] }, x.r.slots);
  check(!!e && e.range.start.line === last.at.start.line, "the delete gesture finds the step's slot");
}

console.log(`playground: ${t.bake.goals.length} states, ${t.bake.steps.length} baked steps; a ${built.proof.steps.length}-step proof typed in the visitor's names closes; ${failures} failures`);
if (failures) process.exit(1);
