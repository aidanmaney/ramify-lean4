import type { GoalInfo, Proof, ProofStep, ProofStepPosition } from "./paperproof";
import { stepGoalsAfter } from "./paperproof";
import type { TreeNode } from "./types";

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

// Hypotheses a child goal gained relative to the goal its tactic consumed. We
// show only the *delta* on the edge (matching Paperproof's "introduced here"
// semantics) rather than the full, ever-growing context. Identity is by fvarId.
function newHyps(parent: GoalInfo, child: GoalInfo): string | undefined {
  const seen = new Set(parent.hyps.map((h) => h.id));
  const added = child.hyps
    .filter((h) => !seen.has(h.id))
    .map((h) =>
      h.value != null
        ? `${h.username} : ${h.type} := ${h.value}`
        : `${h.username} : ${h.type}`,
    );
  return added.length > 0 ? added.join("\n") : undefined;
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

export function proofToTree(proof: Proof): TreeNode[] {
  const goals = goalIndex(proof);

  // Each goal is consumed by at most one tactic → index steps by goalBefore.
  const stepByGoal = new Map<string, ProofStep>();
  for (const step of proof.steps) stepByGoal.set(step.goalBefore.id, step);

  const roots = rootIds(proof);

  const nodes: TreeNode[] = [];
  const emittedGoals = new Set<string>();

  // DFS from a goal, given the parent edge that reaches it and the source span
  // of the tactic that produced it — the same step that introduced any hyps on
  // that edge (see `newHyps`). Root goals get neither: they're the theorem's
  // original goal(s), not produced by any tactic.
  function visitGoal(
    goalId: string,
    parents: TreeNode["parents"],
    producedAt?: ProofStepPosition,
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
      position: producedAt,
    });

    const step = stepByGoal.get(goalId);
    if (!step) return; // leaf: this goal was closed by its tactic

    const tId = tacticId(goalId);
    nodes.push({
      id: tId,
      label: step.tacticString,
      type: "tactic",
      parents: [{ id: goalId }],
      // Carry the tactic's source span so the widget can link this node back to
      // the `.lean` source (see types.ts `TreeNode.position`).
      position: step.position,
    });

    for (const child of stepGoalsAfter(step)) {
      visitGoal(
        child.id,
        [{ id: tId, hyps: newHyps(step.goalBefore, child) }],
        step.position,
      );
    }
  }

  for (const rootId of roots) visitGoal(rootId, []);
  return nodes;
}
