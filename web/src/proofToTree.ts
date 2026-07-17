import type {
  GoalInfo,
  Hypothesis,
  Proof,
  ProofStep,
  SourceComment,
} from "./paperproof";
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

// ---- Source comments → node attribution -------------------------------------

type LspPos = { line: number; character: number };
const cmpPos = (a: LspPos, b: LspPos): number =>
  a.line - b.line || a.character - b.character;

// Display form of a raw comment: delimiters stripped, block-comment lines
// trimmed (they carry the source indentation), blank edge lines dropped.
function stripComment(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("--")) t = t.slice(2);
  else if (t.startsWith("/-")) {
    t = t.replace(/^\/-[-!]?/, "");
    t = t.replace(/-\/$/, "");
  }
  const lines = t.split("\n").map((l) => l.trim());
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

// Attribute each comment to a tree node id (tactic node, or a root goal),
// joining multiple comments per node in source order.
//
// The one wrinkle: Paperproof's step ranges include TRAILING TRIVIA — a
// tactic's range runs past its trailing comment up to the next token. That
// makes containment the reliable trailing test (`simp -- trivial case` puts
// the comment inside `simp`'s range) where a naive same-line check misfires.
// The rules, in order:
//
// 1. CONTAINED in some step's range → that step (innermost, i.e. latest
//    start, when nested)… UNLESS another step starts between the comment and
//    the container's end — then the comment PRECEDES code inside the same
//    construct (`have := by` + comment + inner tactic) and reads as that
//    inner step's LEADING comment instead.
// 2. Entirely BEFORE the first tactic (between `by` and step 1 — including
//    the theorem's docstring, which the command range covers) → the ROOT
//    goal: that's the "here's the plan" narrative slot.
// 3. LEADING — the next tactic starting at/after it (the common
//    `-- explain, then do` shape; bullet lines land here too, since the
//    consumed goal's tactic starts past the `·`).
// 4. Dangling after everything (rare) → the last tactic before it.
function attributeComments(
  comments: SourceComment[],
  steps: ProofStep[],
  rootId: string | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  if (comments.length === 0 || steps.length === 0) return out;
  const byStart = [...steps].sort((a, b) =>
    cmpPos(a.position.start, b.position.start),
  );
  const first = byStart[0];
  const add = (nodeId: string, text: string) =>
    out.set(nodeId, out.has(nodeId) ? `${out.get(nodeId)}\n${text}` : text);
  const sorted = [...comments].sort((a, b) => cmpPos(a.start, b.start));
  for (const c of sorted) {
    const text = stripComment(c.text);
    if (text === "") continue;
    const container = byStart
      .filter(
        (s) =>
          cmpPos(s.position.start, c.start) < 0 &&
          cmpPos(c.start, s.position.stop) < 0,
      )
      .pop(); // byStart order → last = innermost
    if (container) {
      const inner = byStart.find(
        (s) =>
          cmpPos(s.position.start, c.stop) >= 0 &&
          cmpPos(s.position.start, container.position.stop) < 0,
      );
      add(tacticId((inner ?? container).goalBefore.id), text);
      continue;
    }
    if (rootId && cmpPos(c.stop, first.position.start) <= 0) {
      add(rootId, text);
      continue;
    }
    const next = byStart.find((s) => cmpPos(s.position.start, c.stop) >= 0);
    if (next) {
      add(tacticId(next.goalBefore.id), text);
      continue;
    }
    const prev = [...byStart]
      .reverse()
      .find((s) => cmpPos(s.position.start, c.start) <= 0);
    if (prev) add(tacticId(prev.goalBefore.id), text);
  }
  return out;
}

// Tactic labels are raw source text of the step's range — which, because the
// range includes trailing trivia, can carry the very comments we now draw as
// strips. Scrub them from the label (they're identified by exact text) and
// tidy the leftover line-end whitespace.
function cleanLabel(label: string, comments: SourceComment[]): string {
  let t = label;
  for (const c of comments)
    if (t.includes(c.text)) t = t.split(c.text).join("");
  const lines = t.split("\n").map((l) => l.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1].trim() === "")
    lines.pop();
  return lines.join("\n");
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

  // Source comments, attributed to node ids (see attributeComments). Root
  // narrative (before the first tactic / the docstring) keys on the root goal.
  const commentByNode = attributeComments(
    proof.comments ?? [],
    proof.steps,
    roots[0],
  );

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
      comment: commentByNode.get(goalId),
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
      label: cleanLabel(step.tacticString, proof.comments ?? []),
      type: "tactic",
      parents: [{ id: goalId, hyps }],
      // Carry the tactic's source span so the widget can link this node back to
      // the `.lean` source (see types.ts `TreeNode.position`).
      position: step.position,
      comment: commentByNode.get(tId),
    });

    for (const child of stepGoalsAfter(step)) {
      visitGoal(child.id, [{ id: tId }], step);
    }
  }

  for (const rootId of roots) visitGoal(rootId, []);
  return nodes;
}
