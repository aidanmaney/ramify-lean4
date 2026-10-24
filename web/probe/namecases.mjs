// @probe
// NAME THE CASES — the Quick Fix's arms and text, offline. The arms are read
// off the elaborator's step (nameCasesMove.ts `splitArms`): tag from B5's arm
// else the goal's own tag, every name the case shows, and the ones whose
// fvarId the goal before did not have. Run:
//   npm run probe -- namecases
import { splitArms, nameCasesRewrite, splitStepAt, caseTagOf, nameCasesText, isUnnamedSplit } from "./lib.mjs";
import { tally } from "./corpus.mjs";

const t = tally();
const hyp = (id, username, type = "Prop") => ({ id, username, type, value: null, isProof: "" });
const goal = (id, username, hyps, type = "q ∨ p") => ({ id, username, type, hyps });
const pos = (line, character) => ({ line, character });

// OrSwap: `intro p q h` then `cases h`.
const pq = [hyp("p", "p"), hyp("q", "q")];
const orStep = {
  tacticString: "cases h",
  goalBefore: goal("g0", "", [...pq, hyp("h", "h", "p ∨ q")]),
  goalsAfter: [
    goal("g1", "inl", [...pq, hyp("h1", "h✝", "p")]),
    goal("g2", "inr", [...pq, hyp("h2", "h✝", "q")]),
  ],
  spawnedGoals: [],
  tacticDependsOn: [],
  position: { start: pos(3, 2), stop: pos(3, 9) },
  theorems: [],
};
const arms = splitArms(orStep);
t.eq(JSON.stringify(arms.map((a) => [a.tag, a.introduced])), JSON.stringify([["inl", ["h✝"]], ["inr", ["h✝"]]]), "OrSwap arms");
const src = { start: pos(3, 2), stop: pos(3, 9), text: "cases h", indent: 2 };
const rw = nameCasesRewrite("t1", src, orStep);
// a case that already has a step of its own: the skeleton's `sorry` would leave
// that step with no goals, so nothing is offered (both wires pass the steps)
{
  const later = { ...orStep, tacticString: "right", goalBefore: orStep.goalsAfter[0], goalsAfter: [], position: { start: pos(4, 4), stop: pos(4, 9) } };
  t.eq(nameCasesRewrite("t1", src, orStep, undefined, [orStep, later]), null, "not offered once a case has a step");
  t.ok(!!nameCasesRewrite("t1", src, orStep, undefined, [orStep]), "offered while no case has a step");
}
t.eq(rw?.edits[0].newText, "cases h with\n  | inl h => sorry\n  | inr h => sorry", "OrSwap text");
t.eq(rw?.edits.length, 1, "one edit");
t.eq(JSON.stringify(rw?.edits[0].range), JSON.stringify({ start: pos(3, 2), end: pos(3, 9) }), "edit is the tight range");
t.eq(rw?.title, "name the cases", "title");
t.ok(splitStepAt([orStep], pos(3, 2)) === orStep, "step found by start");
t.ok(splitStepAt([orStep], pos(3, 3)) === undefined, "no step elsewhere");

// B5's arm wins over the goal's own tag; a dotted tag keeps its last part.
t.eq(caseTagOf(goal("g9", "succ.inl", [])), "inl", "dotted tag");
t.eq(caseTagOf(goal("g9", "inl", []), { arms: [{ tag: "left", binders: [], goalId: "g9" }] }), "left", "arm tag first");

// `induction n` with `n✝`, `a✝` → `| succ n ih => sorry`.
const nat = (id, u) => hyp(id, u, "ℕ");
const indStep = {
  tacticString: "induction n",
  goalBefore: goal("i0", "", [nat("n", "n")], "P n"),
  goalsAfter: [
    goal("i1", "zero", [], "P 0"),
    goal("i2", "succ", [nat("n1", "n✝"), hyp("ih", "a✝", "P n✝")], "P (n✝ + 1)"),
  ],
  spawnedGoals: [],
  tacticDependsOn: [],
  position: { start: pos(5, 4), stop: pos(5, 15) },
  theorems: [],
};
const ind = nameCasesRewrite("t2", { start: pos(5, 4), stop: pos(5, 15), text: "induction n", indent: 4 }, indStep);
t.eq(ind?.edits[0].newText, "induction n with\n    | zero => sorry\n    | succ n ih => sorry", "induction text");

// Nothing to name: no inaccessible hypothesis, or a split already written with `with`.
const named = { ...orStep, goalsAfter: orStep.goalsAfter.map((g) => ({ ...g, hyps: [...pq, hyp(g.id + "x", "hp")] })) };
t.ok(nameCasesRewrite("t3", src, named) === null, "nothing inaccessible → no fix");
t.ok(!isUnnamedSplit("cases h with"), "with-form is not an unnamed split");
t.ok(nameCasesText("cases h", 0, [{ tag: "", names: [], introduced: ["h✝"] }]) === null, "a missing tag → no fix");
// An inaccessible name the goal before already had is not re-bound.
const old = { ...orStep, goalBefore: { ...orStep.goalBefore, hyps: [...orStep.goalBefore.hyps, hyp("x", "x✝")] },
  goalsAfter: orStep.goalsAfter.map((g) => ({ ...g, hyps: [hyp("x", "x✝"), ...g.hyps] })) };
t.eq(nameCasesRewrite("t4", src, old)?.edits[0].newText, "cases h with\n  | inl h => sorry\n  | inr h => sorry", "old x✝ stays out");

t.done();
