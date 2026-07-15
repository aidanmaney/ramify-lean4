import type { GoalInfo, Hypothesis, Proof, ProofStep } from "./paperproof";
import { stepGoalsAfter } from "./paperproof";
import type { EdgeHypLine, EdgeHyps, TreeNode } from "./types";

// Adapter: Paperproof `Proof` → the renderer's `TreeNode[]`.
//
// Paperproof gives us goals (nodes) and tactic steps (which goal a tactic
// consumed and which it produced). We turn each step into the Gentzen-style
// shape the layout expects:
//
//     goalBefore ──(tactic node)──▶ goalsAfter ++ spawnedGoals
//
// - A *goal* node is labeled by its pretty-printed type.
// - A *tactic* node sits on the edge, labeled by its tactic string. Its single
//   parent is the goal it consumed; its children are the goals it produced.
// - The tree root is the original theorem goal: the one goal that some tactic
//   consumed but no tactic ever produced (no in-edge).
//
// Nodes are emitted in a DFS pre-order from the root(s) so the layout's stable
// left-to-right ordering (which keys off creation order) reads top-down,
// left-to-right like the source proof.

// One tactic node per step; key it by the consumed goal (a goal is consumed by
// at most one tactic in a tree proof), so the id is stable across re-parses.
const tacticId = (goalId: string): string => `tactic:${goalId}`;

/** The edge-label line for one hypothesis, e.g. `h : p ∧ q` (`:= v` for lets).
Exported so the widget's tagged renderer can match label lines back to a goal's
hyps and swap in interactive types (see taggedRender.tsx). */
export function hypLine(h: Hypothesis): string {
  return h.value != null
    ? `${h.username} : ${h.type} := ${h.value}`
    : `${h.username} : ${h.type}`;
}

// The context label shown above a tactic: the hypotheses of the goal it
// consumes, each flagged with whether the tactic actually uses it
// (`tacticDependsOn`, fvarIds — same ids as `Hypothesis.id`).
//
// In full mode that's the whole context. In delta mode it's the hypotheses the
// goal GAINED over the goal its own producing tactic consumed (Paperproof's
// "introduced here" semantics; for a root goal, its binders — gained from the
// theorem statement), PLUS any older hypotheses this tactic uses: usage is the
// point of the label, so a used hyp is shown even when it isn't new. Context
// order is preserved.
function contextFor(
  step: ProofStep,
  producedBy: ProofStep | undefined,
  fullHyps: boolean,
): EdgeHypLine[] {
  const goal = step.goalBefore;
  const used = new Set(step.tacticDependsOn);
  let shown = goal.hyps;
  if (!fullHyps) {
    const inherited = new Set(producedBy?.goalBefore.hyps.map((h) => h.id));
    shown = goal.hyps.filter((h) => !inherited.has(h.id) || used.has(h.id));
  }
  return shown.map((h) => ({ text: hypLine(h), used: used.has(h.id) }));
}

// All goals referenced by a proof, indexed by mvarId. `allGoals` is
// authoritative, but we also fold in goals embedded in steps so a tree can
// never reference an id we don't have.
function goalIndex(proof: Proof): Map<string, GoalInfo> {
  const goals = new Map<string, GoalInfo>();
  for (const g of proof.allGoals) goals.set(g.id, g);
  for (const step of proof.steps) {
    for (const g of [step.goalBefore, ...stepGoalsAfter(step)]) {
      if (!goals.has(g.id)) goals.set(g.id, g);
    }
  }
  return goals;
}

// Root goal ids: consumed by some tactic but never produced by one — the
// original theorem goal(s). Order follows first appearance in `steps`.
function rootIds(proof: Proof): string[] {
  const produced = new Set<string>();
  for (const step of proof.steps) {
    for (const g of stepGoalsAfter(step)) produced.add(g.id);
  }
  return proof.steps
    .map((s) => s.goalBefore.id)
    .filter((id, i, arr) => arr.indexOf(id) === i && !produced.has(id));
}

// A short human label for a proof — its root goal's type — for the picker.
export function proofTitle(proof: Proof): string {
  const goals = goalIndex(proof);
  const root = rootIds(proof)[0];
  return (root && goals.get(root)?.type) || "(proof)";
}

export interface ProofToTreeOptions {
  /**
   * Label each tactic with its goal's FULL local context instead of the delta
   * the goal gained (plus used) — contexts read additively down the tree.
   */
  fullHyps?: boolean;
}

export function proofToTree(
  proof: Proof,
  { fullHyps = false }: ProofToTreeOptions = {},
): TreeNode[] {
  const goals = goalIndex(proof);

  // Each goal is consumed by at most one tactic → index steps by goalBefore.
  const stepByGoal = new Map<string, ProofStep>();
  for (const step of proof.steps) stepByGoal.set(step.goalBefore.id, step);

  const roots = rootIds(proof);

  const nodes: TreeNode[] = [];
  const emittedGoals = new Set<string>();

  // DFS from a goal, given the parent edge that reaches it and the step that
  // produced it. Root goals get neither: they're the theorem's original
  // goal(s), not produced by any tactic.
  function visitGoal(
    goalId: string,
    parents: TreeNode["parents"],
    producedBy?: ProofStep,
  ): void {
    if (emittedGoals.has(goalId)) return; // a proof tree is acyclic, but be safe
    emittedGoals.add(goalId);

    const goal = goals.get(goalId);
    nodes.push({
      id: goalId,
      label: goal?.type ?? goalId,
      type: "goal",
      parents,
      // The producing tactic's source span, for the widget's node↔source link
      // (see types.ts `TreeNode.position`).
      position: producedBy?.position,
    });

    const step = stepByGoal.get(goalId);
    if (!step) return; // leaf: this goal was closed by its tactic

    // The context the tactic runs in sits on the goal→tactic edge, drawn ABOVE
    // the tactic node — reading order goal, context, tactic — with the hyps
    // this tactic uses marked. Introduced by the step that produced this goal,
    // hence that step's span for the label's source link.
    const context = contextFor(step, producedBy, fullHyps);
    const hyps: EdgeHyps | undefined =
      context.length > 0
        ? { lines: context, goalId, pos: producedBy?.position }
        : undefined;

    const tId = tacticId(goalId);
    nodes.push({
      id: tId,
      label: step.tacticString,
      type: "tactic",
      parents: [{ id: goalId, hyps }],
      // Carry the tactic's source span so the widget can link this node back to
      // the `.lean` source (see types.ts `TreeNode.position`).
      position: step.position,
    });

    for (const child of stepGoalsAfter(step)) {
      visitGoal(child.id, [{ id: tId }], step);
    }
  }

  for (const rootId of roots) visitGoal(rootId, []);
  return nodes;
}
