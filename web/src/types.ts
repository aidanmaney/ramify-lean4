import type { ProofStepPosition } from "./paperproof";

// An edge to a parent node, optionally carrying the local hypotheses
// (Lean context, e.g. "A B : Prop\nh : A ∧ B") introduced along that connection.
export interface ParentEdge {
  id: string;
  hyps?: string;
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
}

// A visible node enriched with fold state and computed box geometry; this is the
// datum the layout (and the render) actually operate on.
export interface LayoutNode extends TreeNode {
  foldable: boolean;
  lines: string[];
  w: number;
  h: number;
  // Hypotheses on this node's (single) incoming edge, if any. Carried on the
  // node so the layout can reserve room for the label drawn above it.
  incHyp?: string;
}
