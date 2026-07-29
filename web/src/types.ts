import type {
  CalcChain,
  CalcHole,
  CalcRelOption,
  ProofStepPosition,
} from "./paperproof";
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

/** What a delete gesture on this node removes (see TreeNode.deleteSpec).

Positions only, so it is source-agnostic and both wires compute it — the actual
edit needs `TacticSlot`s, which the widget resolves by containment
(`deleteEdit.ts`). Two readings, one per node type:

- `tactic` — the tactic and any block it OWNS (a `have`'s side proof, a
  split's branches), NOT its linear continuation.
- `goal` — everything below the goal. Mid-block that returns the goal to the
  frontier, where the existing (+) chips take over.

`anchors` are the source positions the extent must reach: the node's own
position plus, for each owned goal, the LAST step in its subtree. Each is
resolved to a slot and the union of those slots is the extent — which is why a
truncated `induction … with` range (it stops on the first `|`) and a bullet
that belongs to no step both come out right. */
export interface DeleteSpec {
  kind: "tactic" | "goal";
  anchors: ProofStepPosition[];
  /** Whole lines occupied only by this node's own comment strip, immediately
  above the extent — they annotate what is being removed and are drawn on it.
  Empty on a root-goal clear, where the comment is the theorem's docstring. */
  comments: ProofStepPosition[];
}

/** How to insert a new tactic for a pending goal (see TreeNode.addSpec).
`after` is the step whose (tight) end the insertion follows — the LAST step in
source among the producing tactic's already-written branches, so a new bullet
lands below its finished siblings rather than between the split and them. */
export interface AddSpec {
  // seq: plain next line; bullet: `· `; case: `| name => ` (with-block);
  // hole/calc-link/calc-append/calc-first: the `calc` forms, which do NOT
  // insert a line at `after` — they act on `hole` or `chain` instead (below).
  kind:
    | "seq"
    | "bullet"
    | "case"
    | "hole"
    | "calc-link"
    | "calc-append"
    | "calc-first";
  /** `calc` only. `hole` REPLACES the `?_` with `by <tactic>`, filling the
  link exactly where it sits; `calc-link` INSERTS a whole new link on the
  hole's line, pushing it down.
   *
   * Both exist because a calc chain's work-in-progress state is a HOLE, not a
   * missing tactic: the chain must end at the goal's RHS, so it can't be left
   * short, and the line-insertion path below would drop a tactic INSIDE the
   * block and break it. Inserting a link above a hole is the one always-valid
   * way to grow a chain — the new link takes the previous RHS as its `_`, and
   * the hole's goal simply restates from the new RHS. */
  hole?: CalcHole;
  /** `calc-append` only: the chain to grow, and the relation the new last link
   * chains (read off the residue goal, which is what the chain still owes).
   *
   * The third calc form, and the only one that acts on a goal OUTSIDE the
   * chain. A chain whose links stop short of the goal leaves that remainder as
   * a pending `calc.step` goal; appending `_ <rel> _ := ?_` closes it against
   * the chain, since the new link's `_` LHS takes the previous RHS and its `_`
   * RHS unifies with the goal's. Nothing has to be typed — the same reason the
   * skeleton's endpoints are `_` — so this chip commits in one click. What it
   * buys is re-entry: the residue becomes an ordinary hole, which every other
   * calc gesture already understands.
   *
   * `calc-first` shares the field and writes the chain's FIRST two links under
   * a `calc` keyword that has none yet — the state you are in the instant you
   * type `calc`, where there is nothing to append AFTER. It always needs an
   * intermediate expression (both links' free ends are `_`, so nothing would
   * pin the middle), which is why it is not just an append with a flag. */
  chain?: CalcChain;
  rel?: string;
  /** The relation the SECOND link carries, set only when it differs from
   * `rel` — i.e. when the author picked a first relation that is not the
   * goal's own. Two links are then written instead of one, and the midpoint
   * between them becomes the thing the overlay asks for. When absent the
   * gesture is exactly what it was before relations could be picked. */
  rel2?: string;
  /** Every relation this gesture could use, from the server's `Trans`
   * enumeration. One option means no choice to make, and the chip goes
   * straight through to its single behaviour rather than opening a picker. */
  rels?: CalcRelOption[];
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

/** One constituent tactic of a COMBINED node (see TreeNode.elidedCut.parts).
The combined `label` is exactly `parts.map(p => p.label).join("\n")`, so each
part owns a known run of `WrappedLine.seg` indices — which is what lets the
render colour, hover and cursor-match every drawn line against its OWN source
tactic instead of losing all of it to the merge. `elision` is that tactic's
brief-mode keep-map, carried so combine composes with brief. */
export interface CombinedPart {
  label: string;
  position?: ProofStepPosition;
  elision?: { original: string; keep: KeepSeg[] };
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
  // A SECOND insertion offered by the same goal: grow the `calc` chain by
  // inserting a new link above this one (kind `calc-link`). Only on an
  // unproved link that isn't the chain's first, so the tree can build a chain
  // a step at a time while the trailing `?_` keeps it elaborating.
  addLink?: AddSpec;
  // What the delete gesture on this node would remove (see DeleteSpec). On a
  // tactic, itself plus any block it owns; on a goal, its whole proof. Absent
  // where deleting is not well defined (a root goal with no proof yet, a
  // synthesized calc node).
  deleteSpec?: DeleteSpec;
  // The relations a NEW `calc` chain on this goal could be built out of, when
  // the goal is the shape one can prove that way and isn't already a link.
  // This is the way IN to calc mode: without it a chain can only be GROWN once
  // one exists, and writing the first by hand is exactly the step the tree
  // couldn't help with. The first entry is the goal's own relation; the rest
  // start elsewhere and chain back to it through a `Trans` instance (`=` then
  // `≤`, the common shape). See proofToTree's calcRelations.
  calcRels?: CalcRelOption[];
  // Brief mode, `calc` link goals only: the left-hand side this label shows as
  // `_` (the source's own notation), because it is the previous link's RHS and
  // is already drawn in the box above. Holds the text `_` stands in for, so
  // the widget's tagged renderer can rebuild the interactive print to match the
  // shortened label — without it the text-equality guard fails and the whole
  // goal falls back to plain SVG text, losing its subterm tooltips.
  goalElision?: { hidden: string };
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
  // Tactic nodes only: my children are the LINKS OF A CHAIN (a `calc` block),
  // so none of them resumes the trunk — the compact layout indents them all
  // equally and they read as one column.
  //
  // A chain is a LIST, not a split. Its links are the steps of one computation
  // and nothing continues after them (the chain IS the proof of the goal), so
  // the usual "last child in source order resumes the trunk lane" rule drew a
  // 3-link chain as two indented links plus one flush-left, which reads as a
  // branch rejoining rather than a column. A real case split keeps that rule:
  // there the last branch genuinely is where the proof ends up, and indenting
  // every branch would walk the trunk right at every split.
  chain?: boolean;
  // A node the tree INVENTED rather than harvested: the `calc` of a block that
  // failed to parse, so no step stands for it and nothing below it elaborated.
  // It has a real source `position` (so the cursor accent and hover work) and a
  // `tacticEdits` entry of its own, keyed on the chain's start, so it edits and
  // colours like any other tactic — its label IS the block's verbatim source,
  // which makes the token alignment an identity. It must never be swallowed by
  // the ⇉ combine, which would hide its repair chip inside a merged box.
  synthetic?: boolean;
  /** Set when the SUPPLEMENTAL parser synthesized this tactic's step rather
  than harvesting it: `failed` (an error landed inside it), `skipped` (after a
  failure in its block — Lean never ran it), `term` (from a term-mode proof's
  structure). Drawn dashed; `failed` takes danger ink. Everything else about
  the node is ordinary — real range, real editing seam. */
  recovered?: "failed" | "skipped" | "term";
  // Present on a SYNTHETIC marker node standing in for a collapsed set of nodes
  // (see elide.ts). Two flavours: an on-demand ELIDE cut (a path via ⇥ or a
  // vertical band via ⇳) draws as a dashed `⋯` chip clicking removes; a
  // `combined` cut (the ⇉ toggle's automatic linear-run collapse) draws as a
  // normal tactic box whose `label` is the run's tactics stacked. `tactics`
  // holds those labels in order (the `<title>`, and the combined label itself).
  elidedCut?: {
    tactics: string[];
    combined?: boolean;
    // The constituent tactics in order, on EVERY marker. A combined node's
    // render needs them to treat each drawn line as the tactic it came from;
    // every marker needs them as its source RANGES, since the marker is what
    // now stands for the run and a position inside the cut must resolve to it
    // (see `tacticTargets`).
    parts?: CombinedPart[];
  };
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
  // Index of the EXPLICIT-NEWLINE segment this line was wrapped out of. Only
  // meaningful where the label is a join of independent texts — a combined
  // node's stacked tactics (see TreeNode.elidedCut.parts) — which is how the
  // render maps each drawn line back to the source tactic it came from.
  seg: number;
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
  // Room reserved BELOW the box for the frontier-chip lane (see layout.ts's
  // CHIP_TOP_GAP). Deliberately NOT part of the band — the box must stay at the
  // band's bottom, since every edge endpoint and label offset is measured from
  // there — so it extends only the node's occupied extent, pushing what comes
  // after it down. 0 unless the engine was built with `chips`.
  chipH: number;
}
