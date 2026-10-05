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

console.log(`playground: ${t.bake.goals.length} states, ${t.bake.steps.length} baked steps; a ${built.proof.steps.length}-step proof typed in the visitor's names closes; ${failures} failures`);
if (failures) process.exit(1);
