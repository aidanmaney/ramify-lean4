export const CMD =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform)
    ? "⌘"
    : "Ctrl";

/** A key chord's modifier as VS Code prints it: `⌘K ⌘0` on a Mac,
 `Ctrl+K Ctrl+0` elsewhere. */
export const KEY_MOD = CMD === "⌘" ? "⌘" : "Ctrl+";
/** The editor's own fold-all / unfold-all chords and its Quick Fix key, taken
 by the tree's frame (ProofTreeView `onTreeKey`). */
export const CHORD_FOLD_ALL = `${KEY_MOD}K ${KEY_MOD}0`;
export const CHORD_UNFOLD_ALL = `${KEY_MOD}K ${KEY_MOD}J`;
export const KEY_MENU = `${KEY_MOD}.`;

export const HYP_MARK = "▸";

export type NodeGates = {
  revealable: boolean;

  /** What this goal's corner does — elide.ts's `goalCut`: `"fold"` hides the
   subtree below it (always, in every layout — `−` hides, ◌ skips), `"open"`
   is a `+N` bringing a folded or skipped stretch back, and `null` is no glyph
   at all. */
  goalCut: "fold" | "open" | null;

  goalRevealable: boolean;

  editable: boolean;

  partEditable: boolean;

  elidable: boolean;

  focusable: boolean;

  isFocusRoot: boolean;

  anyUsedHyp: boolean;

  ledgerRows: boolean;

  /** This node already carries one of the READER's marks (⌥-click on its
   numbered tab takes it back off); `tourMarkable` is whether a `.mark` can be
   WRITTEN above it, which needs a tactic that starts its own line. */
  tourStop: boolean;

  tourMarkable: boolean;

  /** This node already WEARS a numbered tab, and whose mark it is. A tab is a
   place in the reading, so clicking one JUMPS to it whoever dropped it; only
   your own can be taken back off, and that is the ⌥-click. `null` is a node
   with no tab, which is where the corner nub is offered instead. */
  tourTab: "author" | "mine" | null;

  /** D5 — at least one context line in this goal is a generically-named
   hypothesis whose type has a shape Mathlib has a name for. The offer is the
   LINE's ⌥-click, not a bar button: a context line already has a hit target
   and a title, and the move is about one word in it. */
  renamable: boolean;

  /** Batch 4 — the LIGHTBULB is lit: some Quick Fix or Refactor row (a
   linter's fix, writing out what automation used, a rename, inline, extract,
   replace with automation) is on offer here. */
  fixable: boolean;
};

export type Caps = {
  reveal: boolean;
  edit: boolean;
  add: boolean;
  popout: boolean;
  del: boolean;
  flags: boolean;
  /** D1 — the two restructuring moves can be verified and written from here
   (the widget: an `applyEdit`, a source lookup and the delete slots). */
  restructure: boolean;
  undo: boolean;
  /** C4 — a model can reword the generated narration (a companion with a
   key behind `onPolish`); without it no `≈` line can appear. */
  polish: boolean;
  /** Restart File is in the band (the widget: `ec.api.restartFile`). */
  restart: boolean;
  /** The playground: a tactic typed under an open goal is answered from the
   baked table (`onTryTactic`); nothing is written. */
  play: boolean;
};

export type GestureTarget =
  | "goal"
  | "tactic"
  | "marks"
  | "ghost"
  | "strip"
  | "background"
  | "keys";

/** One row of the `?` panel, and — where `when` gates it — one hint line in a
node's `<title>`. `says` is written to follow the input as a title line
(`click to fold everything below`); the panel drops the leading `to `. Terse by
direction (2026-09-24, "half of that is intuitable"): what a control's own
tooltip or label already says is not repeated here. */
export type Gesture = {
  target: GestureTarget;

  input: string;

  says: string;

  when?: (g: NodeGates) => boolean;

  needs?: keyof Caps;

  /** The row's wording where `unless` is ABSENT: a pair of rows, one per side
   of a capability, says what the reader can do here without naming a move
   that is not on offer (the static viewer has no edits). */
  unless?: keyof Caps;
};

/** The rows this session's capabilities admit. */
export const gestureShown = (g: Gesture, caps: Caps) =>
  (!g.needs || caps[g.needs]) && (!g.unless || !caps[g.unless]);

export const gestureText = (g: Gesture) => `${g.input} ${g.says}`;

export const GESTURES: Gesture[] = [
  {
    target: "goal",
    input: "right-click, or ⋯",
    says: "to list every move on a box",
  },
  {
    target: "goal",
    input: "click the chevron (top-right)",
    says: "to fold or unfold what is below",
    when: (g) => g.goalCut === "fold" || g.goalCut === "open",
  },
  {
    target: "goal",
    input: `${CMD}-click`,
    says: "to show in source",
    needs: "reveal",
    when: (g) => !g.revealable && g.goalRevealable,
  },
  {
    target: "goal",
    input: "⌥-click",
    says: "to focus this subtree",
    when: (g) => g.focusable,
  },
  {
    target: "goal",
    input: "⌥-click (Esc)",
    says: "to stop focusing",
    when: (g) => g.isFocusRoot,
  },
  {
    target: "goal",
    input: HYP_MARK,
    says: "= used by the tactic below",
    when: (g) => g.anyUsedHyp,
  },
  {
    target: "goal",
    input: "⌥-click a context line",
    says: "to rename a generic `h` or `this` the Mathlib way (also under the lightbulb)",
    needs: "restructure",
    when: (g) => g.renamable,
  },
  {
    target: "goal",
    input: "click a calc row",
    says: "to show its goal (⌥: every row's)",
    when: (g) => g.ledgerRows,
  },
  {
    target: "goal",
    input: `the lightbulb (${KEY_MENU})`,
    says: "to see the fixes and refactorings here — Lean checks each before the pill writes it",
    needs: "restructure",
    when: (g) => g.fixable,
  },
  {
    target: "tactic",
    input: `the lightbulb (${KEY_MENU})`,
    says: "to see the fixes and refactorings here — Lean checks each before the pill writes it",
    needs: "restructure",
    when: (g) => g.fixable,
  },
  {
    target: "tactic",
    input: "click",
    says: "to show in source",
    needs: "reveal",
    when: (g) => g.revealable,
  },
  {
    target: "tactic",
    input: "double-click",
    says: "to edit (Enter commits, ⇧Enter adds a line, `\\alpha` → α)",
    needs: "edit",
    when: (g) => g.editable,
  },
  {
    target: "tactic",
    input: "double-click a line",
    says: "to edit that tactic",
    needs: "edit",
    when: (g) => g.partEditable,
  },
  {
    target: "tactic",
    input: "⌥-click",
    says: "to skip this step (the ⋯ on the line names it)",
    when: (g) => g.elidable,
  },
  {
    target: "marks",
    input: "click the top-left corner",
    says: "to drop a mark",
    when: (g) => !g.tourTab && !g.tourStop,
  },
  {
    target: "marks",
    input: "⌥-click the top-left corner",
    says: "to write `.mark` into the source (`.mark 3` ranks it)",
    needs: "flags",
    when: (g) => g.tourMarkable,
  },
  {
    target: "marks",
    input: "numbered tab",
    says: "to go to that mark (⌥-click removes yours)",
    when: (g) => !!g.tourTab,
  },
  { target: "ghost", input: "click", says: "to bring it back" },
  {
    target: "ghost",
    input: "italics",
    says: "= hidden because the source asked (`.none`, `.fold`)",
  },

  {
    target: "strip",
    input: "double-click",
    says: "to edit (empty removes it)",
    needs: "edit",
  },
  {
    target: "strip",
    input: "∴",
    says: "= written by Ramify (Comments: narrate), not the author",
  },
  {
    target: "strip",
    input: "≈",
    says: "= a model reworded the generated line",
    needs: "polish",
  },
  {
    target: "background",
    input: "drag",
    says: "to select a region, then fold, skip or write a flag from the pill",
    needs: "flags",
  },
  {
    target: "background",
    input: "drag",
    says: "to select a region, then fold or skip it from the pill",
    unless: "flags",
  },
  { target: "background", input: `${CMD}-scroll`, says: "to zoom" },
  {
    target: "background",
    input: "Restart File, the bar's last item",
    says: "to restart the file and rebuild its outdated imports — it spins while Lean works and says so when the imports are out of date (Tab reaches it)",
    needs: "restart",
  },
  {
    target: "background",
    input: "chips on an open goal",
    says: "to add a tactic there (`+`), stub it with `sorry` or start a `calc`",
    needs: "add",
  },
  {
    target: "background",
    input: "`+` on an open goal",
    says: "to try a tactic there — Lean's answer was computed in advance",
    needs: "play",
  },

  { target: "keys", input: "? / F1", says: "to open or close this panel" },
  { target: "keys", input: "Esc", says: "to close one thing at a time" },
  { target: "keys", input: "Tab", says: "to reach the boxes" },
  {
    target: "keys",
    input: "↑ / ↓",
    says: "to move through the boxes (Home, End: the first, the last)",
  },
  {
    target: "keys",
    input: "→ / ←",
    says: "to open or fold a goal, else step in or out",
  },
  { target: "keys", input: "Space", says: "to fold or unfold a goal" },
  { target: "keys", input: CHORD_FOLD_ALL, says: "to collapse to the outline" },
  { target: "keys", input: CHORD_UNFOLD_ALL, says: "to expand all" },
  {
    target: "keys",
    input: "F8 / ⇧F8",
    says: "to go to the next / previous problem",
  },
  {
    target: "keys",
    input: "Enter",
    says: "to show in source",
    needs: "reveal",
  },
  { target: "keys", input: "F2", says: "to edit a tactic", needs: "edit" },
  {
    target: "keys",
    input: "⇧↑ / ⇧↓",
    says: "to select a run of boxes (Tab reaches the pill's buttons, Enter runs one, Esc clears)",
  },
  {
    target: "keys",
    input: "⇧F10",
    says: "to open the moves menu (on an open goal it has the chips' moves, on a calc its every-row toggle)",
    needs: "add",
  },
  {
    target: "keys",
    input: "⇧F10",
    says: "to open the moves menu (on a calc, its every-row toggle)",
    unless: "add",
  },
  {
    target: "keys",
    input: KEY_MENU,
    says: "to open the moves menu at its Quick Fix and Refactor sections",
    needs: "restructure",
  },
  {
    target: "keys",
    input: KEY_MENU,
    says: "to open the moves menu",
    unless: "restructure",
  },
  {
    target: "keys",
    input: "< / >",
    says: "to go to the previous / next mark (a fold opens only while you read it)",
  },
  {
    target: "keys",
    input: `${KEY_MOD}Z / ${KEY_MOD}⇧Z`,
    says: "to undo / redo",
    needs: "undo",
  },
];

export const GESTURE_SECTIONS: { target: GestureTarget; title: string }[] = [
  { target: "goal", title: "Goals" },
  { target: "tactic", title: "Tactics" },
  { target: "marks", title: "Marks" },
  { target: "ghost", title: "Dashed boxes" },
  { target: "strip", title: "Comments" },
  { target: "background", title: "Background" },
  { target: "keys", title: "Keys" },
];

export function nodeHints(g: NodeGates): string[] {
  // `nodeHints` gates on `when` ALONE — it does not know which target it is
  // reading for, and never has: the gates themselves are what separate a
  // goal's rows from a tactic's (`revealable` against `goalRevealable`, and
  // so on). The mark rows are the same sentence under the same target-blind
  // gate on BOTH targets, so they came out twice in a node's `<title>`
  // (measured on a goal: the nub row and the tab row, each doubled). A node's hints
  // are a set of sentences, so keep the first of each; the `?` panel reads
  // GESTURES per section and still shows the row under both headings.
  const seen = new Set<string>();
  return GESTURES.filter((x) => x.when?.(g))
    .map(gestureText)
    .filter((t) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
}

export type SelVerbDocKey =
  | "elide"
  | "combine"
  | "uncombine"
  | "comments"
  | "addNote"
  | "flagFold"
  | "flagNone"
  | "noHyps"
  | "hUsed"
  | "unflag";

export type SelVerbDoc = {
  label: string;

  // The chip's own `<title>`. `titleAlt` is the SAME verb read the other way
  // round — only `comments`, whose one chip both hides and restores, has one;
  // the label is constant and the title is what says which way the click goes.
  title: string;
  titleAlt?: string;
};

const UNDO = `${CMD}Z in the editor undoes it`;

export const VERB_DOC: Record<SelVerbDocKey, SelVerbDoc> = {
  elide: {
    label: "skip",
    title: "Put the selection away — a goal's whole subtree folds, a straight run is skipped, anything else is one dashed box (click to restore)",
  },
  combine: {
    label: "merge",
    title: "Merge this straight run of tactics into one stacked box",
  },
  uncombine: {
    label: "unmerge",
    title: "Unmerge the selected merged run(s) back into their tactics",
  },
  comments: {
    label: "comments",
    title:
      "Stop drawing the comment strip on the selected node(s) — the source keeps its prose",
    titleAlt: "Draw the comment strip on the selected node(s) again",
  },
  addNote: {
    label: "+",
    title: `Add a comment above this tactic — it becomes the node's comment strip (${UNDO})`,
  },
  flagFold: {
    label: ".fold",
    title: `Write a \`-- .fold\` flag above each head tactic — folded in the source, so it starts folded every time (${UNDO})`,
  },
  flagNone: {
    label: ".none…",
    title: `Replace this step and whatever it opened with a sentence — writes \`-- .none <your prose>\` in the source; your words caption the break it leaves, in italics once the source is read back (${UNDO})`,
  },
  noHyps: {
    label: ".no-hyps",
    title: `Write \`-- .no-hyps\` for each selected goal: hide its context block (the goal alone is the point) (${UNDO})`,
  },
  hUsed: {
    label: ".h#used",
    title: `Pin each selected goal's context to the hypotheses the proof below uses — writes one \`.h#name\` per used line (${UNDO})`,
  },
  unflag: {
    label: "unflag",
    title: `Remove the selected nodes' flag comments — the whole line goes, prose included upon confirming the prompt (${UNDO})`,
  },
};

// The `flag ▾` chip is not a verb — it opens and shuts the row of Alectryon
// writers above — so it carries its own label and title rather than a
// VERB_DOC entry nothing dispatches.
export const FLAG_GROUP = {
  label: "flag ▾",
  title: "Source flags: write .fold / .none / .no-hyps / .h# into the source — what they hide is drawn in the author's voice (italics)",
};
