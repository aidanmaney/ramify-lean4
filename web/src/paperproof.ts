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

/** A hole the AUTHOR wrote — `?_` or a named `?foo` (see ProofTreeComments'
`Hole`). Both data paths emit these: it is plain data, unlike the widget's
ref-carrying tagged goals.

`goalId` is the hole's metavariable, which IS the pending `GoalInfo.id`, so the
join to the tree needs no assumption about reporting order. */
export interface Hole {
  goalId: string;
  /** The hole token itself: replacing exactly this fills it in place. */
  start: { line: number; character: number };
  stop: { line: number; character: number };
  /** Start of what encloses the hole — the calc step when `inCalc`, else the
  enclosing tactic as written. The line a new calc link is inserted on, and the
  column to indent to. */
  ownerStart: { line: number; character: number };
  /** `inCalc` only: the chain's FIRST link, which nothing can be inserted above
  (its LHS is the chain's head, not a `_` that would absorb a new predecessor's
  RHS). */
  first: boolean;
  /** Inside a `calc` link — the only place growing a link ABOVE the hole means
  anything (the hole's goal restates from the new RHS). */
  inCalc: boolean;
  /** Inside a tactic BLOCK, so the goal could equally be proved by a sibling
  tactic written after the enclosing one — and where one can be, it is the
  better edit (`refine ⟨?_, ?_⟩` + `· exact h`, not `refine ⟨by exact h, ?_⟩`).
  So this, not "is a hole", decides whether the tree offers to fill in place:
  the cases that qualify are a `calc` link and a term-mode proof, neither of
  which has anywhere to append. */
  inBlock: boolean;
  /** A repeat of a named hole written earlier (`?foo` twice is ONE goal at two
  spans). Keyed by goal, a client would otherwise keep whichever came last. */
  dup?: boolean;
}

/** One synthesized step's marker — mirrors ProofTreeRecover's RecoveredStep
field-for-field (the wire is a cross-language contract). */
export interface RecoveredStep {
  start: { line: number; character: number };
  kind: "failed" | "skipped" | "term";
}

/** One tactic AS THE AUTHOR WROTE IT — a direct child of some tactic sequence
(see ProofTreeComments.lean's `TacticSlot`).

This is what a DELETION acts on, because a step's range is measurably not it:
`intro p hpm` is ONE step covering `intro p ` alone (the label is a merged
display string) and `rcases … <;> exact h` is a step covering just the
`rcases`, so deleting either range strands text. Conversely `induction … with`
has a step range TRUNCATED at its first case marker while its syntax covers
every branch — which is why the slot, not the step, is the unit.

The client joins these by CONTAINMENT rather than by a step key, which is why
every block's children ship rather than one entry per step: given a slot deep
inside a branch, finding its ancestor in another block is a containment search
and needs no parent pointers on the wire. Plain data, so both wires carry it. */
export interface TacticSlot {
  start: { line: number; character: number };
  stop: { line: number; character: number };
  /** The enclosing sequence's start — the block KEY. Two slots are siblings
  iff these agree. */
  blockStart: { line: number; character: number };
  /** Position among the block's children, and how many there are: together,
  the test for whether a deletion leaves the block with no tactic at all. */
  index: number;
  count: number;
  /** Nothing but whitespace precedes `start` on its line, so the slot can go
  by whole LINES. False for `· intro h` and `:= by omega`. */
  lineStart: boolean;
  /** Everything after `stop` on the last line is whitespace and/or comments. */
  tailIsTrivia: boolean;
  /** End of that line when `tailIsTrivia`, else `stop`. */
  tailStop: { line: number; character: number };
  /** A SIBLING of this block starts on this slot's line (`intro n; simp`) —
  the one shape the gesture declines, rather than guess. Distinct from
  `lineStart`, which is also false inside a bullet, where deleting is perfectly
  well defined. */
  prevSameLine: boolean;
}

/** A `calc` block, and where it CONTINUES (see ProofTreeComments.lean's
`CalcChain`).

The dual of `Hole`: a chain whose links stop short of the goal's RHS still
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
  /** The block has no well-formed subsequent step, so it does not PARSE — the
  state you are in while typing a chain. Nothing below it elaborates, so the
  chain reaches us from syntax alone, with no step of its own on the wire. */
  broken: boolean;
  /** How many WELL-FORMED links the block has. Zero (`calc` and nothing yet)
  means there is nothing to append a link AFTER — the chain is reported so the
  tree can draw it, but it carries no repair spec. */
  links: number;
  /** End of the reportable span. NOT the block's syntax range, which when
  broken runs on into the tactic the parser swallowed. */
  stop: { line: number; character: number };
  /** The block's verbatim source over `[tacticStart, stop)` — the label of the
  synthetic node drawn for a chain that never elaborated. */
  text: string;
  /** The FIRST link carries no `:= proof`. A bare first step is the chain's
  starting EXPRESSION, so appending a link to it reads as `(a ≤ b) ≤ _` and
  fails to synthesize a `Trans` instance — the repair must COMPLETE it too. */
  firstBare: boolean;
}

/** One relation a chain on a goal could START with, and the relation the
SECOND link must then carry for the two to compose back to the goal's own
(`Trans rel next T`) — see ProofTreeComments.lean's `CalcRelOption`.

`same` marks the degenerate pair `rel = next = T`: the only one needing no
intermediate expression, so the only one whose chip commits in a single click. */
export interface CalcRelOption {
  rel: string;
  next: string;
  same: boolean;
}

/** The relations offered for one goal, enumerated from the real `Trans`
instances server-side.

An entry with EMPTY `options` is a positive answer — "we looked; this goal is
not chainable" — which is why one is emitted for every goal examined. That is
distinct from the field being absent altogether (an older CLI dump, or a wire
that doesn't ship it), where the client falls back to its own string-level
`spineRelation` heuristic. */
export interface CalcRelations {
  goalId: string;
  /** The goal's own relation symbol, `""` when it has none. */
  rel: string;
  options: CalcRelOption[];
}

/** A complete parsed proof: the node set plus the tactic edges. */
export interface Proof {
  steps: ProofStep[];
  allGoals: GoalInfo[];
  comments?: SourceComment[];
  holes?: Hole[];
  calcChains?: CalcChain[];
  calcRelations?: CalcRelations[];
  /** Every tactic-sequence child, for the delete gesture (see `TacticSlot`).
  Plain data, so both wires ship it — the standalone app draws no delete
  affordance, but this is what lets a probe run the real extent maths. */
  deleteSlots?: TacticSlot[];
  /** Steps the SUPPLEMENTAL parser synthesized rather than harvested, keyed
  by `position.start` (`ProofStep` is upstream's type and cannot grow a
  field). `failed` — an error landed inside the tactic; `skipped` — it sits
  after a failure in its block, so Lean never ran it; `term` — synthesized
  from a term-mode proof's structure. The tree styles these dashed, `failed`
  in danger ink. */
  recovered?: RecoveredStep[];
  /** The whole DECLARATION's span — the command, not the tactics. What tells
  this proof's diagnostics from a neighbouring theorem's; a span derived from
  the steps will not do, since `declaration uses 'sorry'` is reported on the
  declaration NAME, above every tactic in the proof. */
  declRange?: ProofStepPosition;
  /** Stable identity of the proof — the declaration's name (see
  ProofTreeWidget.lean's `declName?`). The view keys "is this a different
  proof?" on this rather than on a root mvarId, which re-elaboration renumbers.
  Absent on the CLI wire, where `rootIds` stands in. */
  proofId?: string;
  /** Every imported tactic's name, for the in-place editor's completion list
  (see ProofTreeWidget.lean's `tacticNames`). Environment-only, so it rides the
  once-per-edit cache. Widget-only: the CLI ships no editor. */
  tacticNames?: string[];
  /** COUNTERFACTUAL marker (widget only): this proof was elaborated with the
  named line's content replaced by `sorry`, because the real document is
  mid-edit and does not elaborate there. Stable across keystrokes (the spliced
  text does not change while typing stays on the line), so it belongs in the
  stable signature; the live DRAFT deliberately does not ride `Proof` at all —
  see `cfDraft` on the payload in widget.tsx. */
  cfLine?: number;
  /** Where the injected `sorry` LANDED — the stub step's own `position.start`
  in this payload (see `cfStubPos` in ProofTreeWidget.lean). The overlay names
  that node by position instead of guessing "first tactic on `cfLine`", which
  picks the CONTAINER on the `:= by` splice tier. Absent from an older server;
  the view falls back to the line rule. Moves exactly when `cfLine` does, so it
  rides the stable signature with it. */
  cfStubPos?: { line: number; character: number };
}

/** Rebuild the STABLE `Proof` from a wire payload, field for field — the ONE
coding of the projection, shared by widget.tsx's `incoming` and the dev replay
harness (App.tsx `CfReplay`). It must be one coding because a field left out
of this list is silently absent rather than a type error, and a second copy
meant a new field could reach the editor but never the replay rig that
measures it.

What's IN is exactly what rides the stable signature — a change to any of
these is a real tree change (each field's rationale is on `Proof` above). Two
fields are OUT on purpose: `deleteSlots` (the widget carries it as a SIBLING
on `stable`; a copy here would give the delete gesture two sources of truth)
and `tacticNames` (environment-only ~500 strings that cannot change while the
file is open; stringifying them into every signature comparison is pure cost,
so widget.tsx attaches them after the signature is taken). */
export function stableProofOf(p: Proof): Proof {
  return {
    steps: p.steps,
    allGoals: p.allGoals,
    comments: p.comments,
    holes: p.holes,
    calcChains: p.calcChains,
    recovered: p.recovered,
    calcRelations: p.calcRelations,
    proofId: p.proofId,
    declRange: p.declRange,
    cfLine: p.cfLine,
    cfStubPos: p.cfStubPos,
  };
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
