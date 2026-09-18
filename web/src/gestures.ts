export const CMD =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform)
    ? "⌘"
    : "Ctrl";

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

  proseLabel: boolean;

  elidable: boolean;

  focusable: boolean;

  isFocusRoot: boolean;

  pathable: boolean;

  isPathRoot: boolean;

  anyUsedHyp: boolean;

  /** At least one context line here knows which step introduced it (B2). */
  hypOrigins: boolean;

  usesHyps: boolean;

  /** This step names at least one constant (B3 `lemmaRefs`); the title lists
   them under `uses:`. */
  usesLemmas: boolean;

  /** B5 — this step branches, and the sidecar decoded its arms; the title
   names the form, what it split on and what each arm binds. */
  branches: boolean;

  /** B4 — this step is an automation call (`simp`, `grind`, `omega`, …), so
   the bar can offer "what did it use?": the declaration is re-elaborated with
   the tactic's `?` form and core's own `Try this` read back. `traceOpen` is
   whether that subtree is currently showing. */
  automation: boolean;

  traceOpen: boolean;

  ledgerRows: boolean;

  linkGoal: boolean;

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

  /** D1 — this step is a `have` whose one use can be inlined into the step
   that names it, / this step carries a parenthesised `(by …)` that can be
   hoisted out as a `have this`. Both are PROPOSALS: the gesture asks the
   elaborator first and only writes what checks. */
  inlinable: boolean;

  extractable: boolean;

  /** D2 — this node heads a LINEAR RUN that closes its goal (or is a folded
   goal whose `+N` hides one), so the run can be offered to automation; /
   this automation step has (or can fetch) a lemma list core will write out
   for it. Both are PROPOSALS, like D1's pair. */
  collapsible: boolean;

  expandable: boolean;

  /** D4 — a lint on this node has a ONE-EDIT answer (or, for
   `linter.flexible`, one the click can reach by reading B4's trace first).
   A PROPOSAL like the rest of D: the elaborator is asked before anything is
   written. */
  lintFixable: boolean;

  /** D5 — at least one context line in this goal is a generically-named
   hypothesis whose type has a shape Mathlib has a name for. The offer is the
   LINE's ⌥-click, not a bar button: a context line already has a hit target
   and a title, and the move is about one word in it. */
  renamable: boolean;
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

  input: string;

  says: string;

  when?: (g: NodeGates) => boolean;

  needs?: keyof Caps;

  note?: string;
};

export const gestureText = (g: Gesture) => `${g.input} ${g.says}`;

export const GESTURES: Gesture[] = [
  {
    target: "goal",
    input: "click",
    says: "to hide everything below this goal (it keeps a +N saying how much)",
    when: (g) => g.goalCut === "fold",
    note: "to read on past one step instead, ⌥-click the step below: it is skipped, and the break on the line names what went",
  },
  {
    target: "goal",
    input: "click",
    says: "to bring back what this goal's +N stands for",
    when: (g) => g.goalCut === "open",
  },
  {
    target: "goal",
    input: `${CMD}-click`,
    says: "to reveal this goal in source",
    needs: "reveal",

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
    input: "⊹",
    says: "shows only this path: the way here from the root, and what is under it",
    when: (g) => g.pathable,
    note: "the header names the path; its ✕ (or Esc) shows the whole proof again",
  },
  {
    target: "goal",
    input: "⊹ (or Esc)",
    says: "shows the whole proof again",
    when: (g) => g.isPathRoot,
  },
  {
    target: "goal",
    input: "hover",

    says: "for » reveal, ◎ focus and ⊹ path",
  },
  {
    target: "goal",
    input: "the corner nub",
    says: "drops a mark here (turning the temporary list on if it was off) — the dashed tab appears when the pointer is at the box's top-left corner, and `>` and `<` then read the proof mark by mark",
    when: (g) => !g.tourTab && !g.tourStop,
  },
  {
    target: "goal",
    input: "its numbered tab",
    says: "goes to that mark — source and temporary marks are read as one list",
    when: (g) => g.tourTab === "author",
  },
  {
    target: "goal",
    input: "its numbered tab",
    says: "goes to that mark; ⌥-click on it takes the temporary mark back off",
    when: (g) => g.tourTab === "mine",
  },
  {
    target: "goal",
    input: HYP_MARK,
    says: "= used by the tactic below",
    when: (g) => g.anyUsedHyp,
  },
  {
    target: "goal",
    input: "hover a context line",
    says: "names the step that introduced it, lights that step and points at it",
    when: (g) => g.hypOrigins,
  },
  {
    target: "goal",
    input: "⌥-click a context line",
    says: "offers to rename a generically-named hypothesis to Mathlib's own name for its type (`h` → `hab`) — the title says which, the elaborator is asked, and a pill offers to write it",
    needs: "restructure",
    when: (g) => g.renamable,
    note: "every step the elaborator says reads the hypothesis is rewritten with it, whole identifiers only; a name the author chose is never touched, and neither is one that would shadow a name already bound",
  },

  {
    target: "tactic",
    input: "hover",
    says: "lists the lemmas and definitions the step names, under `uses:`",
    when: (g) => g.usesLemmas,
  },
  {
    target: "tactic",
    input: "hover",
    says: "names the cases the step splits into and what each one binds — the case badge on a goal says the same for that case alone",
    when: (g) => g.branches,
  },
  {
    target: "tactic",
    input: "⁇ on the bar",
    says: "shows what the automation used — the lemmas `simp?`/`grind?`/`aesop?` report, as a dashed list under the step (again to hide it)",
    when: (g) => g.automation && !g.traceOpen,
  },
  {
    target: "tactic",
    input: "hover",
    says: "names the cases the step splits into and what each one binds — the case badge on a goal says the same for that case alone",
    when: (g) => g.branches,
  },
  {
    target: "tactic",
    input: "⁇ on the bar",
    says: "hides the lemma list again",
    when: (g) => g.automation && g.traceOpen,
  },
  {
    target: "tactic",
    input: "⤵ on the bar",
    says: "offers to inline this `have`: the elaborator is asked whether the rewrite still checks, and only then does a pill offer to write it",
    needs: "restructure",
    when: (g) => g.inlinable,
    note: "the hypothesis is used exactly once and the step that uses it names it; the `have`'s own comment goes with it, and the editor's undo takes it all back",
  },
  {
    target: "tactic",
    input: "⤴ on the bar",
    says: "offers to hoist the `(by …)` in this step out as `have this : … := by …` on the line above, leaving `this` behind",
    needs: "restructure",
    when: (g) => g.extractable,
    note: "the name is `this` — Lean's own anonymous idiom, and yours to rename; the `have` states the goal the elaborator gave the block",
  },
  {
    target: "tactic",
    input: "⇓ on the bar",
    says: "offers to replace this run of steps — or, on a folded goal, everything its `+N` hides — with one automation tactic — `omega`, `simp`, `linarith`, `norm_num`, `grind`, `decide`, `ring`, `simp_all`, `aesop` are tried in that order and the first that closes the goal is proposed",
    needs: "restructure",
    when: (g) => g.collapsible,
    note: "the run is consecutive steps that each leave one goal and end by closing it; folding a goal first (`+N`) picks a shorter run — its own — and offers the collapse there",
  },
  {
    target: "tactic",
    input: "⇑ on the bar",
    says: "offers to write what this automation used into the source (`simp` → `simp only [\u2026]`), in core's own words — the lemma list is read back first if it is not already in",
    needs: "restructure",
    when: (g) => g.expandable,
    note: "the replacement is the suggestion verbatim, never a list rebuilt from the names shown under `⁇`",
  },
  {
    target: "tactic",
    input: "✎ on the bar",
    says: "offers the one edit a style linter's message asks for — Mathlib's own rules, read off the message's own tag and answered at its own range",
    needs: "restructure",
    when: (g) => g.lintFixable,
    note: "the lints are the `lints` reading option, which is off until you ask for it (it costs one re-elaboration); a rule whose answer is not one token — `style.cases`, `style.longLine` — is shown and left to you",
  },
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
    target: "tactic",
    input: "double-click",
    says: "to edit comment-tactic prose",
    needs: "edit",
    when: (g) => g.editable && g.proseLabel,
    note: "Comments: show on the status bar shows the tactics again",
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
    says: "to skip this step: the goal above hops over it, and the goal it leaves stays",
    when: (g) => g.elidable,
    note: "its goal wears +N and the break on the line names what was skipped (on a step that closes its goal, the goal just folds); click either to bring the step(s) back — a step that splits the proof has no skip",
  },
  {
    target: "tactic",
    input: "hover",
    says: "for ⧉ lens, skip, ⊹ path and the trash can",
    needs: "popout",
  },
  {
    target: "tactic",
    input: "the corner nub",
    says: "drops a mark here (turning the temporary list on if it was off) — the dashed tab appears when the pointer is at the box's top-left corner, and `>` and `<` then read the proof mark by mark",
    when: (g) => !g.tourTab && !g.tourStop,
  },
  {
    target: "tactic",
    input: "its numbered tab",
    says: "goes to that mark — source and temporary marks are read as one list",
    when: (g) => g.tourTab === "author",
  },
  {
    target: "tactic",
    input: "its numbered tab",
    says: "goes to that mark; ⌥-click on it takes the temporary mark back off",
    when: (g) => g.tourTab === "mine",
  },
  {
    target: "tactic",
    input: "⌥-click the corner nub",
    says: "writes `-- .mark` above this tactic, so the mark is the AUTHOR's and every reader gets it",
    needs: "flags",
    when: (g) => g.tourMarkable,
    note: "`.mark 3` in the source gives a mark an explicit rank; the comment's first sentence captions it",
  },
  {
    target: "tactic",
    input: "hover",

    says: `marks the hypotheses it uses, in the goal above (${HYP_MARK})`,
    when: (g) => g.usesHyps,
  },
  {
    target: "tactic",
    input: "trash can + confirm",
    says: "to delete; first click opens prompt",
    needs: "del",
    note: "hovering it fades what goes; the extent lights up in the editor and the chip says how many lines",
  },
  {
    target: "goal",
    input: "click a calc row",
    says: "to show that step's Lean goal below it (⌥: every step's)",
    when: (g) => g.ledgerRows,
    note: "the ledger keeps the row; click again to put the goal away",
  },
  {
    target: "tactic",
    input: "+",
    says: "shows the goal this calc step proves, above it",
    when: (g) => g.linkGoal,
  },

  {
    target: "ghost",
    input: "click",
    says:
      "to return what the marquee (or a `.none` in the source) put away — a cut the SOURCE asked for wears a leading `§` and leans, so the author's hand reads apart from your own",
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

  {
    target: "strip",
    input: "double-click",
    says: "to edit the comment (single click is a no-op)",
    needs: "edit",
    note: "leaving the textbox empty removes the comment",
  },
  {
    target: "strip",
    input: "Comments: narrate",
    says: "writes a strip for every step the author left unremarked — one templated sentence per tactic KIND, marked `∴` so the generated voice is never mistaken for the author's",
    note: "a folded goal's strip then summarises what it hides, so a `+N` says how much AND what; generated lines are not editable — the source has no comment to edit",
  },

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

  {
    target: "keys",
    input: "Esc",
    says: "backs out of one state at a time — the most recent first",
    note: "E.g. escaping twice to stop deleting tactics then exit a focused subtree",
  },
  {
    target: "keys",
    // PUNCTUATION, not letters: the no-single-letter-keys rule exists because
    // a bare letter collides with vim's own bindings in the editor beside us.
    // `<` and `>` are Shift-comma and Shift-period, which nothing else claims.
    input: "< / >",
    says: "step back and forward through the marks — from a standing start, `>` takes the first mark and `<` the last (the status bar's Marks item says how far in, and its two slots which lists are on — source, then temporary; click it to toggle either, ⌥-click cycles both → source → temp → none, where it reads `off`)",
    note: "Esc lets go of the current mark, keeping the list; a mark hidden inside a fold or a hop is PEEKED open, not unfolded — your own folds survive the reading",
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

export const GESTURE_SECTIONS: { target: GestureTarget; title: string }[] = [
  { target: "goal", title: "Goal boxes" },
  { target: "tactic", title: "Tactic boxes" },
  { target: "ghost", title: "Ghosts — the dashed boxes a marquee or a `.none` leaves (`§` and italics when the source asked for it)" },
  { target: "chips", title: "Unfinished goal chips" },
  { target: "strip", title: "Comment strips" },
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
    title: `Write a \`-- .fold\` flag above each head tactic — folded in the SOURCE, so it starts folded every time (${UNDO})`,
  },
  flagNone: {
    label: ".none…",
    title: `Replace this step and whatever it opened with a sentence — writes \`-- .none <your prose>\` in the source; your words caption the break it leaves, marked \`§\` and italic once the source is read back (${UNDO})`,
  },
  noHyps: {
    label: ".no-hyps",
    title: `Write \`-- .no-hyps\` for each selected goal: hide its context block (the goal alone is the point) (${UNDO})`,
  },
  hUsed: {
    label: ".h#used",
    title: `Pin each selected goal's context to its ${HYP_MARK}-used hypotheses — writes one \`.h#name\` per used line (${UNDO})`,
  },
  unflag: {
    label: "unflag",
    title: `Remove the selected nodes' flag comments — the WHOLE line goes, prose included upon confirming the prompt (${UNDO})`,
  },
};

// The `flag ▾` chip is not a verb — it opens and shuts the row of Alectryon
// writers above — so it carries its own label and title rather than a
// VERB_DOC entry nothing dispatches.
export const FLAG_GROUP = {
  label: "flag ▾",
  title: "Alectryon flags: write .fold / .none / .no-hyps / .h# into the source — what they hide is drawn in the author's voice (`§`, italics, comment ink)",
};
