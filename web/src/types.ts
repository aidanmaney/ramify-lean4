import type {
  CalcChain,
  Hole,
  CalcRelOption,
  ProofStepPosition,
} from "./paperproof";
import type { KeepSeg, Mark } from "./briefLabel";

// One line of a goal's local context, e.g. `h : p ∧ q`, with whether the tactic
// that consumes the goal actually uses it (Paperproof's tacticDependsOn).
export interface HypLine {
  // Reflow mode wraps long context lines, so a line can be a continuation of
  // the one above (no `▸` marker of its own) and carry its own indent.
  cont?: boolean;
  indent?: number;
  text: string;
  used: boolean;
  // First line of the PROPOSITIONS group when the block also shows data above
  // it: contextFor orders a context data-then-props (Paperproof's `isProof`
  // classification — "data"/"universe" vs "proof"), and this line opens the
  // second group. Drawn with a hairline divider and HYP_SEP_H of extra
  // leading, which sizeOf reserves — set on at most one line per block, and
  // never when either group is empty.
  sep?: boolean;
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

/** A span of characters inside a piece of text an edit is about to insert,
used to point at the parts of it the author still has to fill in. */
export interface TextSlot {
  at: number;
  len: number;
}

/** What an insertion reports back, so the view can carry on where the edit
left off.
 *
 * `fill` is the `sorry` the edit wrote, which the in-place editor opens on —
 * the second half of every generated-link gesture. `stages` is present only
 * when the edit wrote a link with BOTH ends left open (`calc _ <rel> _ := by
 * sorry`): they are the two `_`s, and the view walks the author through them
 * left-side-then-right-side before handing over to `fill`. Each is already an
 * absolute document range, since only the widget knows the indent and bullet
 * prefix the text actually landed behind. */
export interface AddResult {
  fill: ProofStepPosition | null;
  stages?: { lhs: ProofStepPosition; rhs: ProofStepPosition };
}

/** How to insert a new tactic for a pending goal (see TreeNode.addSpec).
`after` is the step whose (tight) end the insertion follows — the LAST step in
source among the producing tactic's already-written branches, so a new bullet
lands below its finished siblings rather than between the split and them. */
export interface AddSpec {
  // seq: plain next line; bullet: `· `; case: `| name => ` (with-block);
  // hole/calc-link/calc-append/calc-first do NOT insert a line at `after` —
  // they act on `hole` or `chain` instead (below). Of those, only `hole` is
  // general; the other three are `calc` forms.
  kind:
    | "seq"
    | "bullet"
    | "case"
    | "hole"
    | "calc-link"
    | "calc-append"
    | "calc-first";
  /** `hole` REPLACES the hole token with `by <tactic>`, filling it exactly
  where it sits; `calc-link` INSERTS a whole new link on the hole's line,
  pushing it down.
   *
   * Both act on a hole the AUTHOR wrote: the tree's own gestures never write
   * one (see calcEdit's STUB — a hole is an unsolved goal, i.e. an error that
   * breaks the file while the proof is unfinished, where a stub is a warning
   * and a complete term). A hand-written hole is still a perfectly good
   * work-in-progress state, and filling it in place is the honest edit
   * wherever it appears: the term around it is written and what is missing is
   * in the middle of it.
   *
   * `calc-link` is the narrower one, offered only when `hole.inCalc`. Growing
   * a chain upward is always valid — the new link takes the previous RHS as
   * its `_` and the hole's goal restates from the new RHS — but that argument
   * is about chains, and nothing analogous holds above a `refine` hole. */
  hole?: Hole;
  /** `calc-append` only: the chain to grow, and the relation the new last link
   * chains (read off the residue goal, which is what the chain still owes).
   *
   * The third calc form, and the only one that acts on a goal OUTSIDE the
   * chain. A chain whose links stop short of the goal leaves that remainder as
   * a pending `calc.step` goal; appending `_ <rel> <rhs> := by sorry` closes
   * it against the chain, since the new link's `_` LHS takes the previous RHS.
   * `<rhs>` is prefilled `_`, which unifies with the goal's own RHS — so Enter
   * alone is still the whole gesture, and anything else lands the chain
   * somewhere the author chose. What it buys is re-entry: the stub is an
   * ordinary editable tactic node, which is where the second half of the
   * gesture types.
   *
   * `calc-first` shares the field and writes the chain's FIRST link under a
   * `calc` keyword that has none yet — the state you are in the instant you
   * type `calc`. ONE link, both ends `_`, like every other gesture here (the
   * standing rule: no gesture ever inserts more than one line); the staged
   * LHS/RHS fill then replaces the underscores in place. */
  chain?: CalcChain;
  rel?: string;
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
  elision?: { original: string; keep: KeepSeg[]; marks: Mark[] };
}

/** One row of a `calc` LEDGER (see TreeNode.ledger).
 *
 * The head row is the chain's starting expression and states no link, so it
 * carries no `goalId`. Every other row is one settled link, drawn the way the
 * SOURCE writes it — `<relation> <RHS>`, the LHS left to the row above — and
 * sliced out of that link goal's own printed type so the drawn text is a
 * verbatim SUFFIX of it. `hiddenLhs` is the prefix that was dropped (the LHS
 * plus the whitespace before the relation), which is exactly the shape the one
 * sanctioned tagged rewrite takes (taggedRender's `goalElision` branch), so a
 * row can be rendered interactively without a second pathway. */
export interface LedgerRow {
  /** The link goal this row states. Absent on the head row alone. */
  goalId?: string;
  /** The drawn text. */
  text: string;
  /** The part of `goalId`'s type this row does NOT draw. Absent on the head. */
  hiddenLhs?: string;
  /** The link's justification span (its consuming step's range) — carried so a
  row can be pointed at source without re-deriving the join. */
  position?: ProofStepPosition;
}

/** Which row of a ledger is the HEAD — the chain's starting expression, the
 * one row that states no link. The test is the absence of a link goal, not the
 * row's index — the honest coding even now that the head is unconditional (a
 * ledgered chain's node label is forced to the bare `calc`, so the head row is
 * the LHS's only copy however the source line-broke it). One coding, read by
 * the measurer (ledgerSize) and by anything that renders a row.
 */
export const isLedgerHead = (r: LedgerRow) => r.goalId === undefined;

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
  // The SOURCE RANGES of the directive comments themselves — what the
  // selection pill's remove-flags verb deletes. Separate from commentRanges
  // (that map means "the strip showing this", which a flags-only comment
  // deliberately never claims) and broader than `flags` (hyp-narrowing
  // directives are consumed in contextFor and never reach `flags`, but their
  // comment is still real text the reverse gesture must find).
  flagRanges?: ProofStepPosition[];
  // GOAL nodes only: a `.no-hyps`/`.h#name` directive already narrows my
  // context (the flag comment itself sits above my CONSUMING tactic, which is
  // the node carrying its flagRanges). The pill reads this to flip the
  // context-writing verbs to removal instead of writing a duplicate.
  hypFlagged?: boolean;
  // Brief mode (tactic nodes only): when boilerplate inside the label was
  // collapsed to `…`, `label` is the COLLAPSED string (what layout measures)
  // and this carries the original label + the KEEP map back to it, so the
  // token renderer can shift the source-aligned token spans onto the collapsed
  // label and reveal each `…`'s hidden text. Absent when nothing collapsed.
  elision?: { original: string; keep: KeepSeg[]; marks: Mark[] };
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
  /** GOAL nodes only, and the one goal node that stands for SEVERAL goals: the
   * SETTLED links of a `calc` chain, drawn as the source's own column instead
   * of one box per link.
   *
   * A settled link is one some real justification consumes (a `by` block's
   * tactics, or a Part D term node). Its goal box was 59% context block by ink,
   * 43% of it byte-identical repeats — the goal directly above the `calc` node
   * already shows the whole context — and its statement restated the row above
   * it in full. So the rows carry the statements, no hyps are drawn, and each
   * link's justification hangs off this node as an ordinary child in source
   * order. Unsettled links (holes, stub-consumed links, the residue) keep their
   * own goal boxes as siblings after it: every editing gesture lives there.
   *
   * The ledger DOES carry the chain's context block (`hyps`, drawn above the
   * rows the way a goal box draws them above its `⊢`), and that is what pays
   * for itself: every goal inside the chain's justification subtrees then draws
   * only what it ADDS to it, so a link's residue goal — which adds nothing —
   * draws with no context block at all. See `contextFor`'s `inherited`. */
  ledger?: LedgerRow[];
  /** Ledger nodes only: whose context `hyps` is. The tagged renderer keys the
   * interactive context lines by GOAL id, and a ledger's own id is a source
   * position (it stands for several goals, so it can be no single mvarId) —
   * without this the chain's context would silently drop to plain SVG in the
   * widget while every other box kept its type tooltips. */
  hypGoalId?: string;
  /** The id of an ANCESTOR node that draws this node's context block too —
   * set on a `calc` LEDGER, whose block is the chain goal's own, computed once
   * and handed to both (see the ledger emission in proofToTree).
   *
   * It says "drop my block whenever that node is still drawn above me", and
   * the two halves are split on purpose. proofToTree decides the SEMANTICS,
   * because only it knows the breadth: under ∀ (`full`) the reader has asked
   * every box for everything and the flag is not written at all, which is the
   * same exemption `contextFor`'s `inherited` makes and for the same reason.
   * The LAYOUT decides whether the condition holds, because only it has the
   * drawn tree: the ledger sits two links under the chain goal in every layout
   * mode (⋔ wide moves it, it does not detach it), so the block really is
   * adjacent — but an elide cut can take the goal away and leave the ledger
   * standing, and then the block is the only copy there is.
   *
   * Structural, never geometric: "is that node in the drawn tree" is a fact
   * about the graph, and no pixel feeds back into the tree to answer it. */
  hypsInheritedFrom?: string;
  /** GOAL nodes only: I am the `x = x` state an `rw` leaves behind.
   *
   * `rw` is a macro — `rewrite …; with_reducible rfl` — so every `rw [X]` inside
   * a chain is followed by a goal restating the rewritten side against itself
   * and a synthetic `rw [rfl]` node closing it. The `rw [rfl]` says nothing the
   * box above it did not — its own source slice is the closing `]` of the `rw`
   * that produced it, the two sharing one `TacticSlot` — so the proof opens
   * with THIS GOAL folded (`sourceView` seeds it, exactly as a `.fold` flag
   * would): the state the link steps to keeps its box, and the no-op closing it
   * is the only thing hidden. Clicking the box, or its `+`, or ⊞, opens it like
   * any other fold; ⌥-⊞ folds it again.
   *
   * The fold was briefly seeded one level UP, on the justification, so that the
   * residue box went too — rejected by the author: a chain's intermediate
   * states are what a reader checks the links against, and hiding one leaves a
   * step whose destination is nowhere on screen.
   *
   * Structural, never a count: the goal's type must be a reflexivity on its
   * relation spine and its consuming step must be the macro's own `rw [rfl]`. */
  rflResidue?: boolean;
  // GOAL nodes only: I am a proof OBLIGATION this tactic generated, not the
  // mathematics continuing — a conditional rewrite's side condition
  // (`rw [Nat.sub_add_cancel]` leaving `b ≤ a`). The compact layout keeps the
  // MAIN goal on the trunk and branches obligations off it.
  //
  // This cannot be read off the wire generically: measured through ppharness,
  // both children of such a `rw` arrive in `goalsAfter` with `[anonymous]`
  // case tags, so nothing distinguishes them but their ORDER (Lean puts the
  // main goal first) and the tactic that produced them. So it is set from the
  // tactic FAMILY, the same label-driven mechanism `chain` uses for `calc`
  // (see MAIN_FIRST_RE in proofToTree.ts) — which is what makes it work on
  // both wires with no server change.
  side?: boolean;
  // GOAL nodes only: I arrived in my producer's `spawnedGoals` rather than its
  // `goalsAfter` — a block that tactic OPENED (a `have … := by`'s side proof)
  // rather than the main line continuing. The distinction is erased at emission
  // (`stepGoalsAfter` concatenates the two), so it is stamped here for the one
  // consumer that needs it: the step elision (`elide.ts`), whose whole question
  // is "which single child continues the trunk once this tactic is cut out".
  spawned?: boolean;
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
    // A STEP cut (elide.ts's `step`): one tactic and the blocks it opened,
    // lifted out so its goal-before flows straight into its continuation. The
    // marker is drawn as a small dashed SHADOW of the tactic rather than the
    // `⋯ N tactics` chip — the tactic is still nominally there, just stood
    // down to a whisper you can click back open.
    ghost?: boolean;
    // A `.none` source flag's own prose (see NodeFlags.note), shown as the
    // marker's label in place of the tactic preview or the `⋯ N tactics`
    // count. Set for ANY cut the flagged tactic is the subject of, not only
    // the seeded one: the flag is a durable fact about that step, so it must
    // read the same whichever gesture put the step away (see applyElisions).
    note?: string;
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
  /** `.none`: the flagged tactic and everything it opened are ELIDED INTO THE
  TRUNK, exactly as the hover bar's ◌ does — one dashed ghost between the goal
  above and the goal below, clickable to restore. It is a starting view, like
  `.fold`, not a lock: what separates the two is how much they put away (a
  fold hides one subtree and leaves its box; this takes the tactic with it and
  closes the trunk up) rather than whether you can get it back.

  It used to drop the targets from the layout outright with no way back, and a
  separate inert marker chip stood where the tactic had been. Two chips for
  one idea, one of them dead: the ghost is the same picture with a working
  restore, so the directive now seeds a `step` ElideCut and nothing else. */
  elide?: boolean;
  /** The child goals the flag acts on: a tactic's SPAWNED goals when it has
  any, else the goals it produced. (`.none` no longer reads this — it acts on
  the tactic itself — but `.fold` does, and the field is what keeps a `.none`
  on a childless tactic a no-op, as it always was.)
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
  // Spine mode (the ⊦ layout): an aside tactic's outgoing links ride the
  // TRUNK lane at this absolute x — the lane of the goal the tactic consumed
  // — because the tactic's own box stands in the right-hand track and a lane
  // derived from ITS left edge would cross the goal boxes stacked to its
  // left. Set by trunkLayout; read by the renderer and linkSpans (the pair
  // that must agree).
  lane?: number;
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
  // Aside modes: this tactic's strip FLOATS — drawn ABOVE the band (rising
  // beside the consumed goal) instead of inside it, so commentBlockH does not
  // count toward the band anywhere. STAMPED by trunkLayout's place() (false on
  // the side-by-side column path, where the node stays at trunk x and a
  // floated strip would rise into its goal's box), and read — never
  // re-derived — by nodeSpan, linkSpans and the renderer, so the two sides
  // cannot disagree. Absent outside the trunk layout (wide mode: banded).
  commentFloats?: boolean;
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
  // Overview mode: this node laid out as a one-line mini chip (label
  // truncated, hyps/comment/chip lane dropped). The render gates the chip
  // lane, action bar and hover peek on this same bit — set only by the
  // engine's sizing, so geometry and render cannot disagree.
  mini?: boolean;
  // A BIG comment strip (COMMENT_CLAMP_MIN+ wrapped lines) is clamped to its
  // first COMMENT_CLAMP_SHOWN lines with an affordance line after them; this
  // record is present exactly when the strip is big (clamped OR expanded —
  // an expanded strip keeps it so the way back stays drawn). `hidden` is the
  // wrapped-line count not shown (0 while expanded); `label` is the EXACT
  // affordance string the width measurement used, so the render paints what
  // was measured (the measurer/renderer pairing rule). Set only by the
  // engine's sizing — the `mini` discipline: one writer, render reads the bit.
  commentMore?: { hidden: number; expanded: boolean; label: string };
  // Narration mode (⌥ on the -- rail button): this tactic's `lines` are its
  // COMMENT prose standing in for the label — measured italic, drawn italic in
  // comment ink, tagged/token rendering skipped outright (prose is not source,
  // and letting the text-equality guard fail its way to the same answer would
  // make "no colour" an accident instead of a decision). The tactic text
  // itself moves to the box's <title>. Set only by the engine's sizing, the
  // `mini` discipline.
  proseLabel?: boolean;
}
