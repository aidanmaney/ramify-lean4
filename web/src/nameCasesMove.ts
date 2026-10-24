// NAME THE CASES, AS A QUICK FIX — the view's half of nameCases.ts. Pure: no
// React, no layout, so `probe namecases` runs exactly what the widget runs.
//
// The arms are read off the ELABORATOR'S step (its `goalBefore` and
// `goalsAfter`), not off the drawn context lines: the tree's default breadth
// (`used`) shows only the hypotheses a step reads, and an `h✝` nothing has
// read yet — which is exactly the hypothesis a reader cannot name — would not
// be drawn. "Introduced" is BY ID (an fvarId absent from the goal before),
// the B2 provenance rule, so an inaccessible name the context already had is
// not re-bound.
import type { BranchInfo, GoalInfo, ProofStep } from "./paperproof";
import { isUnnamedSplit, nameCasesText, type SplitArm } from "./nameCases";
import type { Rewrite, TacticSource } from "./rewrite";

/** The case tag the badge shows: B5's arm where it reached the goal, else the
 goal's own tag (hygiene suffix dropped) cut to its last component — a split
 appends the constructor's name to the parent's tag (`succ.inl`). */
export function caseTagOf(goal: GoalInfo, branch?: BranchInfo): string {
  const arm = branch?.arms.find((a) => a.goalId === goal.id);
  if (arm?.tag) return arm.tag;
  const raw = (goal.username ?? "").split("._@.")[0].trim();
  if (raw === "" || raw === "[anonymous]" || raw === "_") return "";
  return raw.split(".").pop() ?? "";
}

/** One `SplitArm` per goal the step left, in the step's own order. */
export function splitArms(step: ProofStep, branch?: BranchInfo): SplitArm[] {
  const before = new Set(step.goalBefore.hyps.map((h) => h.id));
  return step.goalsAfter.map((g) => ({
    tag: caseTagOf(g, branch),
    names: g.hyps.map((h) => h.username),
    introduced: g.hyps.filter((h) => !before.has(h.id)).map((h) => h.username),
  }));
}

/** The step the tactic node stands for: the harvested `cases`/`induction`
 step that starts where the node does. */
export function splitStepAt(
  steps: readonly ProofStep[],
  start: { line: number; character: number },
): ProofStep | undefined {
  return steps.find(
    (s) =>
      s.position.start.line === start.line &&
      s.position.start.character === start.character &&
      s.goalsAfter.length > 0 &&
      isUnnamedSplit(s.tacticString),
  );
}

export const NAME_CASES_TITLE = "name the cases";

/** The Quick Fix's rewrite: ONE replace over the tactic's tight range, or null
 where the text is not an unnamed split or there is nothing to name. */
export function nameCasesRewrite(
  nodeId: string,
  src: TacticSource,
  step: ProofStep,
  branch?: BranchInfo,
  /** The proof's steps: given, the fix is offered only while NO case has a
   step of its own yet — the skeleton's `sorry`s would close the cases and
   leave the steps written under the split with no goals. */
  steps?: readonly ProofStep[],
): Rewrite | null {
  if (!isUnnamedSplit(src.text)) return null;
  if (steps) {
    const cases = new Set(step.goalsAfter.map((g) => g.id));
    if (steps.some((s) => cases.has(s.goalBefore.id))) return null;
  }
  const text = nameCasesText(src.text, src.indent, splitArms(step, branch));
  if (text === null) return null;
  return {
    kind: "namecases",
    nodeId,
    name: "",
    targetId: nodeId,
    edits: [{ range: { start: src.start, end: src.stop }, newText: text }],
    title: NAME_CASES_TITLE,
  };
}
