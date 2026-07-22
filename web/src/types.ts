import type { ProofStepPosition } from "./paperproof";

// One line of a goal's local context, e.g. `h : p ∧ q`, with whether the tactic
// that consumes the goal actually uses it (Paperproof's tacticDependsOn).
export interface HypLine {
  // Reflow mode wraps long context lines, so a line can be a continuation of
  // the one above (no `▸` marker of its own) and carry its own indent.
  cont?: boolean;
  indent?: number;
  text: string;
  used: boolean;
}

// An edge to a parent node.
export interface ParentEdge {
  id: string;
}

// Raw node in the proof tree. `id` is a stable key (an mvarId for goals, a
// derived key for tactics) used for layout ordering and fold state; `label` is
// the human-readable text drawn in the box (the goal type, or the tactic
// string). These were once the same field — real Lean data has opaque ids like
// `_uniq.12`, so a node must carry its display text separately.
export type NodeType = "goal" | "tactic";
export interface TreeNode {
  id: string;
  label: string;
  type: NodeType;
  parents: ParentEdge[];
  // Source span this node maps back to. For a tactic node, its own range; for
  // a goal node, the range of the tactic that PRODUCED it (root goals have
  // none — they aren't produced by any tactic, just the theorem statement).
  // Used by the infoview widget for the node↔source link (reveal on click,
  // and highlighting the node under the editor cursor).
  position?: ProofStepPosition;
  // Goal nodes only: the goal's local context, drawn INSIDE the box above the
  // `⊢ `-prefixed type — the same stacking the infoview uses. Which hyps appear
  // (the delta the goal gained, or its full context) and their `used` flags are
  // decided in proofToTree.
  hyps?: HypLine[];
  // Source comment(s) attributed to this node (see proofToTree's
  // attributeComments): leading/trailing comments for a tactic; the
  // before-first-tactic narrative (incl. the docstring) for a root goal.
  // Drawn as a strip at the top of the node's layout band.
  comment?: string;
  // Goal nodes only: the name of the case this goal IS, when its producing
  // tactic split into named branches (`induction … with | zero | succ`,
  // `by_cases` → `pos`/`neg`). Hygienic suffixes are stripped in proofToTree,
  // and anonymous goals carry nothing.
  caseLabel?: string;
  // The SOURCE RANGES of those comments. Carried so the widget can resolve a
  // cursor sitting in a comment to the very node whose strip is showing it,
  // instead of re-deriving the attribution rule (and drifting from it).
  commentRanges?: ProofStepPosition[];
}

// A node placed at concrete coordinates by either layout mode (the wide
// Sugiyama bands or the compact trunk) — `x` is the BOX's horizontal center,
// `y` the vertical center of the node's whole band (comment strip + box, see
// LayoutNode.commentBlockH). Both layouts return this same shape so the renderer
// is layout-agnostic.
export interface PlacedNode {
  x: number;
  y: number;
  data: LayoutNode;
}

// An edge between two placed nodes.
export interface PlacedLink {
  source: PlacedNode;
  target: PlacedNode;
}

// One wrapped line of a node label. `cont` marks a line produced by width-
// wrapping (as opposed to an explicit newline in the label): the render
// indents it by CONT_INDENT so it visibly reads as a continuation of the
// previous line, and the layout budgets its width accordingly.
export interface WrappedLine {
  text: string;
  cont: boolean;
  // Left offset (px) for THIS line, already subtracted from the wrap budget
  // that measured it. A plain continuation gets CONT_INDENT; in reflow mode it
  // is computed from bracket depth at the break, so a wrapped argument list
  // hangs under its opener. Explicit-newline lines get 0.
  indent: number;
}

// A visible node enriched with fold state and computed box geometry; this is the
// datum the layout (and the render) actually operate on.
export interface LayoutNode extends TreeNode {
  foldable: boolean;
  lines: WrappedLine[];
  w: number;
  h: number;
  // Height the context block occupies INSIDE the box (its lines + HYP_GAP),
  // 0 without hyps. The box's text stack is that block then the label lines,
  // so the render places both off this one number.
  hypH: number;
  // Source-comment strip (TreeNode.comment wrapped for display), drawn at the
  // very top of the band: its wrapped lines, the height it adds to the band
  // (lines + gap; 0 without a comment), and its measured width (so layout can
  // reserve horizontal room for a strip wider than the box).
  commentLines: WrappedLine[];
  commentBlockH: number;
  commentW: number;
  // Case-name badge (TreeNode.caseLabel), drawn ABOVE the comment strip —
  // the case marker (`| succ m ih =>`, `·`) precedes any comment inside it in
  // the source, so the band reads in source order top-down. Height it adds to
  // the band and its measured width; both 0 when the goal has no case name.
  caseH: number;
  caseW: number;
}
