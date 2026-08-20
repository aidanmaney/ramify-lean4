/**
 * The tree's gesture vocabulary, in ONE table.
 *
 * Almost everything this view can do is a click, a modifier, a double-click or
 * a drag, and until now the only place any of it was written down was the
 * node's native `<title>`. That tooltip is unreachable in the product: a
 * tagged label covers the box with a `foreignObject`, so the `<title>` retreats
 * to the `<rect>` and survives only on the `NODE_PAD` border — which means the
 * dev harness (plain SVG labels) taught the gestures and the shipping widget
 * did not. Worse, the marquee drag that gates ten source-writing verbs was
 * announced nowhere at all.
 *
 * So the table serves two readers: `nodeHints` builds a node's own `<title>`
 * from it, and `HelpPanel` renders the whole thing. Neither owns a private
 * copy, which is the point — a per-node hint and the reference cannot describe
 * the same gesture differently.
 *
 * DRIFT, honestly: rows with a `when` are derived from the very gates that
 * route the clicks, so they cannot claim a gesture the node does not offer.
 * Rows with only a `needs` have their PRESENCE derived from the host's
 * capabilities but their WORDING is prose (the background drag, the comment
 * strip, the chips, the keys) — there is no gate to read for those, and
 * pretending otherwise in a comment would be worse than saying so here.
 *
 * Pure data and pure functions: no React, no infoview imports, so it can be
 * probed offline like `deleteEdit.ts` and `flagEdit.ts`.
 */

/** ⌘ on a Mac, Ctrl everywhere else — the modifier the editor itself uses for
go-to-definition, so the tree borrows the platform's own word for it. */
export const CMD =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform)
    ? "⌘"
    : "Ctrl";

/** The gutter mark on a context line the consuming tactic uses. Lives here
because it is also a legend entry — the one part of a box that is not
self-explanatory. */
export const HYP_MARK = "▸";

/**
 * What one drawn node offers, read off the SAME predicates `handleClick` and
 * the hover bar branch on. Every field is a gate that already existed; this
 * type only gives them a name so the hint table can be pure.
 */
export type NodeGates = {
  /** A tactic whose bare click reveals its source (widget only). */
  revealable: boolean;
  /** A goal that reveals on ⌘-click — needs a position, so NOT the root. */
  goalRevealable: boolean;
  /** Double-click opens the in-place editor. */
  editable: boolean;
  /** A combined run: double-click edits the PART under the pointer. */
  partEditable: boolean;
  /** The box is showing prose (narration mode), so double-click edits the
  COMMENT rather than the tactic — the one gesture that changes meaning under
  a rail toggle. */
  proseLabel: boolean;
  /** ⌥-click elides. */
  elidable: boolean;
  /** …except on a closing tactic, where it folds the goal above instead. */
  leafFold: boolean;
  /** A goal that can become the root of a focused view. */
  focusable: boolean;
  /** The goal currently focused: the same two gestures lead back out. */
  isFocusRoot: boolean;
  /** At least one context line is flagged used, so the ▸ legend is worth it. */
  anyUsedHyp: boolean;
  /** TACTICS: the goal box above is drawn and flags at least one line as used
  BY THIS TACTIC, so hovering it has something to mark. Same flag as
  `anyUsedHyp` read from the other end of the edge — hence a separate gate
  rather than a reuse: a tactic carries no context of its own. */
  usesHyps: boolean;
};

/**
 * What the HOST offers, from the hooks the view was handed. The standalone app
 * passes no editing hooks, so filtering the catalogue on this is what lets one
 * table serve both without a second, shorter, hand-maintained list going stale
 * beside it.
 */
export type Caps = {
  reveal: boolean;
  edit: boolean;
  add: boolean;
  popout: boolean;
  del: boolean;
  flags: boolean;
  undo: boolean;
};

export type GestureTarget =
  | "goal"
  | "tactic"
  | "ghost"
  | "chips"
  | "strip"
  | "background"
  | "keys";

export type Gesture = {
  target: GestureTarget;
  /** The input, as the user performs it: `click`, `⌥-click`, `drag`, `Esc`. */
  input: string;
  /** What it does, phrased to follow the input: "to reveal in source". */
  says: string;
  /** Present ⇒ this row is also a NODE hint, shown exactly when it holds. */
  when?: (g: NodeGates) => boolean;
  /** The host capability the row needs; absent ⇒ always available. */
  needs?: keyof Caps;
  /** One clause of caveat, drawn dimmer. */
  note?: string;
};

/** One row's full text — the form the node `<title>` has always used. */
export const gestureText = (g: Gesture) => `${g.input} ${g.says}`;

export const GESTURES: Gesture[] = [
  // ── Goal boxes ────────────────────────────────────────────────────────────
  {
    target: "goal",
    input: "click",
    says: "to fold or unfold the proof below it",
  },
  {
    target: "goal",
    input: `${CMD}-click`,
    says: "to reveal this goal in source",
    needs: "reveal",
    // Mutually exclusive with the tactic row in practice (one is goals, the
    // other tactics), but stated as an exclusion so the hint can never show
    // both if that ever stops being true.
    when: (g) => !g.revealable && g.goalRevealable,
  },
  {
    target: "goal",
    input: "⌥-click",
    says: "to focus this goal's subtree",
    when: (g) => g.focusable,
  },
  {
    target: "goal",
    input: "⌥-click (or Esc)",
    says: "to stop focusing this goal's subtree",
    when: (g) => g.isFocusRoot,
  },
  {
    target: "goal",
    input: "hover",
    // Each glyph next to the verb it performs — `◎ and focus` read as though
    // the ◎ belonged to the conjunction.
    says: "for » reveal and ◎ focus",
  },
  {
    target: "goal",
    input: HYP_MARK,
    says: "= used by the tactic below",
    when: (g) => g.anyUsedHyp,
  },
  // ── Tactic boxes ──────────────────────────────────────────────────────────
  {
    target: "tactic",
    input: "click",
    says: "to reveal in source",
    needs: "reveal",
    when: (g) => g.revealable,
  },
  {
    target: "tactic",
    input: "double-click",
    says: "to edit the tactic in place",
    needs: "edit",
    when: (g) => g.editable && !g.proseLabel,
    note: "⇧Enter inserts a newline, Esc cancels, Enter commits; Unicode expands automatically e.g. \\alpha -> α",
  },
  {
    // Narration mode swaps what this gesture edits, and the hint has to swap
    // with it — the box is showing prose, so "double-click to edit" pointed at
    // the wrong thing entirely.
    target: "tactic",
    input: "double-click",
    says: "to edit comment-tactic prose",
    needs: "edit",
    when: (g) => g.editable && g.proseLabel,
    note: "⌥-click `--` on the rail to show tactics normally",
  },
  {
    target: "tactic",
    input: "double-click a line",
    says: "to edit that tactic of the run",
    needs: "edit",
    when: (g) => g.partEditable,
  },
  {
    target: "tactic",
    input: "⌥-click",
    says: "to elide step(s) into the trunk",
    when: (g) => g.elidable && !g.leafFold,
    note: "a ghost stays behind; click to bring step(s) back",
  },
  {
    target: "tactic",
    input: "⌥-click",
    says: "to put this step away",
    when: (g) => g.elidable && g.leafFold,
    // The substitution `leafFoldTargets` makes, said out loud. It is invisible
    // otherwise — there is no glyph on a bare modifier to explain it.
    note: "a closing step has nothing below to elide, so this folds the goal above; that goal's + brings it back",
  },
  {
    target: "tactic",
    input: "hover",
    says: "for ⧉ lens, ◌ elide, ⊘ delete",
    needs: "popout",
  },
  {
    // The ▸ legend's other end. `anyUsedHyp` says what the mark MEANS on the
    // goal box that carries it; this says where to ask the question — and it
    // is the only way to get an answer at all where the gutter is suppressed
    // because the tactic uses everything shown.
    target: "tactic",
    input: "hover",
    // "marks", not "highlights" or "underlines": HOW it is drawn is
    // `ramify.hypMarkStyle` (a wash by default, a dashed rule for readers who
    // need the shape), and this one line is the text BOTH the `?` panel and
    // the node's own tooltip read. Naming one of the two would be wrong on
    // screen for whoever set the other.
    says: `marks the hypotheses it uses, in the goal above (${HYP_MARK})`,
    when: (g) => g.usesHyps,
  },
  {
    target: "tactic",
    input: "⊘ + confirm",
    says: "to delete; first click opens prompt",
    needs: "del",
    note: "the extent lights up in the editor and the chip says how many lines",
  },
  // ── Ghosts and chips ──────────────────────────────────────────────────────
  {
    target: "ghost",
    input: "click",
    says: "to return what elide ◌ took",
  },
  {
    target: "ghost",
    input: "hover",
    says: "for the full text of what is hidden",
  },
  {
    target: "chips",
    input: "+",
    says: "opens a textbox to enter the missing tactic",
    needs: "add",
  },
  {
    target: "chips",
    input: "sorry",
    says: "stubs the goal in one click; writes immediately",
    needs: "add",
  },
  {
    target: "chips",
    input: "calc / step",
    says: "opens or grows a chain, one link at a time",
    needs: "add",
    note: "asks for the ends separately; Escape leaves an underscore `_`, which is a valid answer",
  },
  {
    target: "chips",
    input: "?_",
    says: "fills a hole you wrote yourself",
    needs: "add",
  },
  // ── The comment strip ─────────────────────────────────────────────────────
  {
    target: "strip",
    input: "double-click",
    says: "to edit the comment (single click is a no-op)",
    needs: "edit",
    note: "leaving the textbox empty removes the comment",
  },
  // ── The background ────────────────────────────────────────────────────────
  {
    target: "background",
    input: "drag",
    says: "to select nodes in a rectangle, then pick an action",
  },
  {
    target: "background",
    input: "click",
    says: "to unhighlight a node and close open prompts",
  },
  // ── Keys ──────────────────────────────────────────────────────────────────
  {
    target: "keys",
    input: "Esc",
    says: "backs out of one state at a time — the most recent first",
    note: "E.g. escaping twice to stop deleting tactics then exit a focused subtree",
  },
  {
    target: "keys",
    input: `${CMD}Z / ${CMD}⇧Z`,
    says: "undo and redo in the editor (focus moves there)",
    needs: "undo",
  },
  {
    target: "keys",
    input: `${CMD}-scroll`,
    says: "zooms at the pointer",
  },
  {
    target: "keys",
    input: "?",
    says: "opens and closes this panel",
  },
];

/** Section headings for the panel, in the order they are drawn. */
export const GESTURE_SECTIONS: { target: GestureTarget; title: string }[] = [
  { target: "goal", title: "Goal boxes" },
  { target: "tactic", title: "Tactic boxes" },
  { target: "ghost", title: "Ghosts (◌)" },
  { target: "chips", title: "Unfinished goal chips" },
  { target: "strip", title: "Comment strips" },
  { target: "background", title: "Background" },
  { target: "keys", title: "Keys" },
];

/**
 * A node's own hints — exactly the rows whose gate holds. This IS the node
 * `<title>`'s content, so the tooltip and the panel are the same table read
 * two ways, and a gate that stops holding removes the claim from both.
 */
export function nodeHints(g: NodeGates): string[] {
  return GESTURES.filter((x) => x.when?.(g)).map(gestureText);
}

// ── The marquee selection's verbs ───────────────────────────────────────────

/**
 * Every verb the selection pill can offer. A `Record` over the union rather
 * than a list, so a verb added without documenting it is a TYPE ERROR — the
 * strongest anti-drift guard available here, and one `npm run typecheck`
 * already runs.
 *
 * The keys are VERBS, not the payload shapes they happen to share: `.no-hyps`
 * and `.h#used` both travel as bare patches, and describing them as one thing
 * is exactly how a chip ends up with someone else's tooltip.
 */
export type SelVerbDocKey =
  | "elide"
  | "combine"
  | "uncombine"
  | "noteHide"
  | "noteShow"
  | "flagFold"
  | "flagNone"
  | "note"
  | "noHyps"
  | "hUsed"
  | "unflag";

export type SelVerbDoc = {
  label: string;
  title: string;
  /**
   * Whether picking this verb WRITES to the document. The pill draws the two
   * classes apart on it — before this they were the same chip in the same ink
   * on the same card, so `elide` (pure view state) sat two along from `unflag`
   * (deletes the author's prose, whole lines of it).
   */
  writes: boolean;
};

/** The clause every writing verb ends with, written ONCE. It is the same
sentence the armed-delete confirm chip carries, which is the point: the two
destructive surfaces should promise the same thing in the same words. */
const UNDO = `${CMD}Z in the editor undoes it`;

export const VERB_DOC: Record<SelVerbDocKey, SelVerbDoc> = {
  elide: {
    label: "elide",
    title: "Collapse the selection to a ◌ marker (click to restore)",
    writes: false,
  },
  combine: {
    label: "combine",
    title: "Merge this straight run of tactics into one stacked box",
    writes: false,
  },
  uncombine: {
    label: "uncombine",
    title: "Unmerge the selected combined run(s) back into their tactics",
    writes: false,
  },
  noteHide: {
    label: "¬note",
    title:
      "Stop drawing the comment strip on the selected node(s) — the source keeps its prose",
    writes: false,
  },
  noteShow: {
    label: "¬¬note",
    title: "Draw the comment strip on the selected node(s) again",
    writes: false,
  },
  flagFold: {
    label: ".fold",
    title: `Write a \`-- .fold\` flag above each head tactic — folded in the SOURCE, so it starts folded every time (${UNDO})`,
    writes: true,
  },
  flagNone: {
    label: ".none…",
    title: `Replace this step and whatever it opened with a sentence — writes \`-- .none <your prose>\` in the source; the ghost shows your words (${UNDO})`,
    writes: true,
  },
  note: {
    label: "note…",
    title: `Write a plain comment above this tactic — it becomes the node's comment strip (${UNDO})`,
    writes: true,
  },
  noHyps: {
    label: ".no-hyps",
    title: `Write \`-- .no-hyps\` for each selected goal: hide its context block (the goal alone is the point) (${UNDO})`,
    writes: true,
  },
  hUsed: {
    label: ".h#used",
    title: `Pin each selected goal's context to its ${HYP_MARK}-used hypotheses — writes one \`.h#name\` per used line (${UNDO})`,
    writes: true,
  },
  unflag: {
    label: "unflag",
    title: `Remove the selected nodes' flag comments — the WHOLE line goes, prose included upon confirming the prompt (${UNDO})`,
    writes: true,
  },
};
