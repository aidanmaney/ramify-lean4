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

/** One raw source comment within the theorem's command range, as lexed by
ProofTreeComments.lean (both data paths emit these — comments are parser
trivia, absent from the InfoTree, so the Lean side re-lexes the source).
`text` includes the delimiters (`--`, `/- -/`); positions are LSP, the same
space as `ProofStepPosition`. Attribution to nodes happens in proofToTree. */
export interface SourceComment {
  text: string;
  start: { line: number; character: number };
  stop: { line: number; character: number };
}

/** An unproved link of a `calc` chain — a `?_` sitting where its justification
goes (see ProofTreeComments.lean's `CalcHole`). Both data paths emit these: it
is plain data, unlike the widget's ref-carrying tagged goals.

`goalId` is the hole's metavariable, which IS the pending `GoalInfo.id`, so the
join to the tree needs no assumption about link order. */
export interface CalcHole {
  goalId: string;
  /** The `?_` token itself: replacing exactly this fills the link in place. */
  start: { line: number; character: number };
  stop: { line: number; character: number };
  /** Start of the enclosing calc step — the line a new link is inserted on,
  and the column to indent it to. */
  linkStart: { line: number; character: number };
  /** The chain's FIRST link, which nothing can be inserted above (its LHS is
  the chain's head, not a `_` that would absorb a new predecessor's RHS). */
  first: boolean;
}

/** A `calc` block, and where it CONTINUES (see ProofTreeComments.lean's
`CalcChain`).

The dual of `CalcHole`: a chain whose links stop short of the goal's RHS still
elaborates, leaving the remainder as a `calc.step` goal that reaches the wire as
an ordinary pending goal. Appending a link is how one continues such a chain by
hand, and neither fact it needs is derivable client-side — a step's range covers
the whole tactic (trailing trivia included), and the links' column is the
author's own layout. Keyed by `ProofStep.position.start` of the calc step. */
export interface CalcChain {
  tacticStart: { line: number; character: number };
  /** End of the final link — a new one goes after this line. */
  lastLink: { line: number; character: number };
  /** Column the chain's links are written at. */
  indent: number;
}

/** A complete parsed proof: the node set plus the tactic edges. */
export interface Proof {
  steps: ProofStep[];
  allGoals: GoalInfo[];
  comments?: SourceComment[];
  calcHoles?: CalcHole[];
  calcChains?: CalcChain[];
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
