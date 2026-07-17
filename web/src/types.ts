import type { ProofStepPosition } from "./paperproof";

// One line of a hypothesis-context label, e.g. `h : p ∧ q`, with whether the
// tactic the label sits above actually uses it (Paperproof's tacticDependsOn).
export interface EdgeHypLine {
  text: string;
  used: boolean;
}

// A hypothesis-context label carried on a goal→tactic edge: the context the
// tactic runs in, drawn ABOVE the tactic node (reading order: goal, context,
// tactic). The label's height is folded into the tactic node's layout band
// (LayoutNode.hypBlockH), so it can never overlap the layer above.
export interface EdgeHyps {
  lines: EdgeHypLine[];
  // The goal whose local context these lines come from (the tactic's
  // goalBefore) — the key for the widget's tagged hover tooltips.
  goalId: string;
  // Source span of the step that INTRODUCED these hypotheses (the one that
  // produced `goalId`); root-goal binders come from the theorem statement and
  // have none.
  pos?: ProofStepPosition;
}

// An edge to a parent node, optionally carrying the hypothesis context shown
// along that connection (only goal→tactic edges do).
export interface ParentEdge {
  id: string;
  hyps?: EdgeHyps;
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
  // Source comment(s) attributed to this node (see proofToTree's
  // attributeComments): leading/trailing comments for a tactic; the
  // before-first-tactic narrative (incl. the docstring) for a root goal.
  // Drawn as a strip at the top of the node's layout band.
  comment?: string;
}

// A node placed at concrete coordinates by either layout mode (the wide
// Sugiyama bands or the compact trunk) — `x` is the BOX's horizontal center,
// `y` the vertical center of the node's whole band (label block + box, see
// LayoutNode.hypBlockH). Both layouts return this same shape so the renderer
// is layout-agnostic.
export interface PlacedNode {
  x: number;
  y: number;
  data: LayoutNode;
}

// An edge between two placed nodes, carrying the context label riding it, if
// any (only goal→tactic edges are labeled).
export interface PlacedLink {
  source: PlacedNode;
  target: PlacedNode;
  data?: EdgeHyps;
}

// One wrapped line of a node label. `cont` marks a line produced by width-
// wrapping (as opposed to an explicit newline in the label): the render
// indents it by CONT_INDENT so it visibly reads as a continuation of the
// previous line, and the layout budgets its width accordingly.
export interface WrappedLine {
  text: string;
  cont: boolean;
}

// A visible node enriched with fold state and computed box geometry; this is the
// datum the layout (and the render) actually operate on.
export interface LayoutNode extends TreeNode {
  foldable: boolean;
  lines: WrappedLine[];
  w: number;
  h: number;
  // Hypotheses on this node's (single) incoming edge, if any. Carried on the
  // node so the layout can reserve room for the label drawn above it.
  incHyp?: EdgeHyps;
  // Height of the hyp label block (label + HYP_GAP) folded into this node's
  // layout band, 0 without a label. The node's band is commentBlockH +
  // hypBlockH + h tall with the box pinned at the bottom, the hyp label above
  // it and the comment strip on top, so neither can eclipse the layer above.
  hypBlockH: number;
  // Source-comment strip (TreeNode.comment wrapped for display), drawn at the
  // very top of the band: its wrapped lines, the height it adds to the band
  // (lines + gap; 0 without a comment), and its measured width (so layout can
  // reserve horizontal room like it does for wide hyp labels).
  commentLines: WrappedLine[];
  commentBlockH: number;
  commentW: number;
}
