// TypeScript mirror of the JSON emitted by the `ppharness` Lean CLI, which wraps
// Paperproof's `BetterParser_Tree`. These types describe the wire format only —
// the renderer never consumes them directly; `proofToTree` adapts them into the
// layout's `TreeNode[]` (see proofToTree.ts). Keeping this boundary explicit is
// what lets the data source change later (e.g. a Lean user-widget feeding the
// same `Proof` object over RPC) without touching the renderer.

/** A single entry in a goal's local context, e.g. `h : p ∧ q`. */
export interface Hypothesis {
  username: string; // display name, e.g. "h" (may be inaccessible / shadowed)
  type: string; // pretty-printed type, e.g. "p ∧ q"
  value: string | null; // the term, for `let`-bound hyps; null otherwise
  id: string; // fvarId — stable identity within the proof
  isProof: string; // "proof" | "universe" | … (Paperproof's classification)
}

/** One goal (proof obligation). The node of the proof tree. */
export interface GoalInfo {
  username: string; // tag/case name, e.g. "left", or "[anonymous]"
  type: string; // pretty-printed goal, e.g. "q ∧ p"
  hyps: Hypothesis[]; // the goal's full local context
  id: string; // mvarId — the stable node key
}

/** LSP source range a tactic occupies; kept for future source-linking. */
export interface ProofStepPosition {
  start: { line: number; character: number };
  stop: { line: number; character: number };
}

/** One tactic application. The edge(s) of the proof tree. */
export interface ProofStep {
  tacticString: string; // the tactic text, e.g. "constructor" — the edge label
  goalBefore: GoalInfo; // goal this tactic consumed (the parent)
  goalsAfter: GoalInfo[]; // goals it produced (the children)
  spawnedGoals: GoalInfo[]; // side goals orphaned into the same scope (also children)
  tacticDependsOn: string[]; // fvarIds the tactic actually used
  position: ProofStepPosition;
  theorems: unknown[]; // theorem signatures used; unused by the renderer for now
}

/** A complete parsed proof: the node set plus the tactic edges. */
export interface Proof {
  steps: ProofStep[];
  allGoals: GoalInfo[];
}

/** One NDJSON line as emitted by the CLI: `{file, data:{index, proof}}`. */
export interface ProofRecord {
  file: string;
  data: { index: number; proof: Proof };
}

/** The children a step produces: explicit goals plus spawned side goals. */
export function stepGoalsAfter(step: ProofStep): GoalInfo[] {
  return [...step.goalsAfter, ...step.spawnedGoals];
}

/** Parse an NDJSON document (one proof record per non-empty line). */
export function parseNdjson(text: string): ProofRecord[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ProofRecord);
}
