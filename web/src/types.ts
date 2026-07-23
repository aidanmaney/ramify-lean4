import type { ProofStepPosition } from "./paperproof";
import type { KeepSeg } from "./briefLabel";

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

/** How to insert a new tactic for a pending goal (see TreeNode.addSpec).
`after` is the step whose (tight) end the insertion follows — the LAST step in
source among the producing tactic's already-written branches, so a new bullet
lands below its finished siblings rather than between the split and them. */
export interface AddSpec {
  // seq: plain next line; bullet: `· `; case: `| name => ` (with-block).
  kind: "seq" | "bullet" | "case";
  // Fallback indent, from the producing step's start COLUMN. Only a guess:
  // Paperproof splits `rw [a, b]` into one step per rule, so such a step
  // starts mid-line and its column is not the line's indent. The widget
  // prefers the producer's `TacticEdit.lineIndent`, which is exact — hence
  // `producer`, which is what it looks that up by.
  indent: number;
  producer: ProofStepPosition;
  after: ProofStepPosition;
  caseName?: string;
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
  // Pending leaf goals only (no consuming tactic — the live-editing
  // frontier): where and how a NEW tactic for this goal would be inserted
  // into the source. Computed by proofToTree from the producing step's shape;
  // the widget's (+) chip turns it into a document edit.
  addSpec?: AddSpec;
  // Goal nodes only: the name of the case this goal IS, when its producing
  // tactic split into named branches (`induction … with | zero | succ`,
  // `by_cases` → `pos`/`neg`). Hygienic suffixes are stripped in proofToTree,
  // and anonymous goals carry nothing.
  caseLabel?: string;
  // The SOURCE RANGES of those comments. Carried so the widget can resolve a
  // cursor sitting in a comment to the very node whose strip is showing it,
  // instead of re-deriving the attribution rule (and drifting from it).
  commentRanges?: ProofStepPosition[];
  // Display directives written in the source as Alectryon-style comment flags
  // (`-- .fold`), attributed to this node like any other comment. See
  // proofToTree's parseFlags.
  flags?: NodeFlags;
  // Brief mode (tactic nodes only): when boilerplate inside the label was
  // collapsed to `…`, `label` is the COLLAPSED string (what layout measures)
  // and this carries the original label + the KEEP map back to it, so the
  // token renderer can shift the source-aligned token spans onto the collapsed
  // label and reveal each `…`'s hidden text. Absent when nothing collapsed.
  elision?: { original: string; keep: KeepSeg[] };
  // Present on a SYNTHETIC marker node standing in for an on-demand elided cut
  // of nodes — either a path (the rail's ⇥) or a vertical band (⇳); see
  // elide.ts. The view draws it as a dashed chip and clicking it removes the
  // cut (matched by the marker's own `id` = the cut's id). `tactics` are the
  // elided tactic labels, in order, for the hover tooltip (and the raw material
  // for a combined rendering).
  elidedCut?: { tactics: string[] };
}

/** What a node's Alectryon-style comment flags ask the renderer to do.
 *
 * A flag governs its node's OUTPUT — the direct translation of Alectryon's
 * model, where a flag on a sentence governs what that sentence produced.
 *
 * Hypothesis flags (`.no-hyps`, `.h#name`) are applied in proofToTree, where
 * the context is built, so they leave no trace here. */
export interface NodeFlags {
  /** `.fold`: the targets start collapsed — their boxes are drawn, their
  proofs are not, and a fold glyph opens them. Alectryon's "output shown but
  folded", and the reason the flag targets the goals rather than the tactic:
  collapsing the tactic would take the goals with it, leaving nothing to say
  what was folded away. */
  fold?: boolean;
  /** `.none`: the targets are dropped from the layout outright, with no fold
  glyph to bring them back. */
  elide?: boolean;
  /** The child goals the flag acts on: a tactic's SPAWNED goals when it has
  any, else the goals it produced.
   *
   * The spawned-first rule is what keeps a flag on a `have … := by` from
   * swallowing the rest of the proof. Such a step has two children — the side
   * proof it opened and the continuation of the main line — and "hide this
   * have's proof" plainly means the former. A real case split has no spawned
   * goals, so there the targets are simply all the branches. */
  targets?: string[];
  /** Whatever prose followed the flags in the same comment. Shown in place of
  what `.none` removed, so an elision can say what it swallowed. */
  note?: string;
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

// An edge between two placed nodes. `col` marks a compact-mode SIDE-BY-SIDE
// column link (see trunkLayout): the target sits in its own column to the
// right, so the connector must route over the columns' tops — the normal
// stacked `│└` elbow would cut through earlier siblings' boxes.
export interface PlacedLink {
  source: PlacedNode;
  target: PlacedNode;
  col?: boolean;
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
