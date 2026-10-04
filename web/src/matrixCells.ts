// The RENDER MATRIX's grid — which node KIND is crossed with which STATE, and
// why a combination is left out.  Pure data (no React, no DOM), so `probe
// matrix` can list exactly the cells the page draws and a reviewer can grep
// `skipped:` for the reason a cell is empty.  The page (matrix.tsx) is the only
// reader that turns a cell into a mounted view.

export interface StateDef {
  id: string;
  label: string;
  /** What puts the view into the state — a prop the harness already has, a
   source comment the parser already reads, or a gesture the matrix drives
   through DOM events after mount.  Never a product-code flag. */
  how: string;
}

export const STATES: StateDef[] = [
  { id: "plain", label: "plain", how: "nothing" },
  { id: "error", label: "error ribbon", how: "diagnostics prop, severity 1, on the target's step" },
  { id: "warn", label: "warning ribbon", how: "diagnostics prop, severity 2" },
  { id: "lint", label: "lint ribbon", how: "diagnostics prop, severity 3 (style.longLine shape)" },
  { id: "selected", label: "selected", how: "marquee drag over the node (document mouse events)" },
  { id: "armed", label: "armed for delete", how: "hover bar, then a click on the trash can" },
  { id: "kbfocus", label: "keyboard focus ring", how: "focus the tree, Home, then ArrowDown to the node" },
  { id: "marksrc", label: "source mark tab", how: "a `-- .mark` comment above the step" },
  { id: "marktmp", label: "temporary mark tab", how: "click on the corner nub" },
  { id: "nub", label: "nub hover", how: "mouseover on the corner region" },
  { id: "seeded", label: "seeded cut", how: "a `.fold` / `.none` comment above the step" },
  { id: "bar", label: "hover bar", how: "mousemove inside the box" },
  { id: "comment", label: "comment strip", how: "a prose comment above the step" },
  { id: "narrate", label: "narration ∴", how: "Comments: narrate (⌥-click the bar item three times)" },
  { id: "polish", label: "polish ≈", how: "narrate + polishReady/polishDefault + the polish stub" },
  { id: "rowopen", label: "row opened", how: "click on a ledger row" },
  {
    id: "stack",
    label: "everything at once",
    how: "error + mark (source where a comment can attach, else temporary) + prose comment + seeded cut + keyboard ring + hover bar, on one node",
  },
];

/** How a kind comes to be on screen.  `plain` is the kind's own look; where the
 kind IS a cut (a fold, a hop, a ghost) the plain cell is the READER's cut and
 the `seeded` cell is the author's. */
export type Setup = "none" | "fold" | "hop" | "ghost" | "trace" | "stub" | "ledger";

export interface KindDef {
  id: string;
  label: string;
  /** A `SCENES` key (matrixScenes.ts), or a corpus record cut down to the part
   under one tactic. */
  scene: string | { file: string; index: number; at: { line: number; character: number } };
  setup: Setup;
  /** The node the state goes on: an exact id, or the prefix of one (ghosts,
   trace leaves and ledgers mint theirs). */
  target: { id: string } | { prefix: string };
  /** The step (index in source order) whose comment lines the comment / mark /
   seeded states write above; null where no comment can attach. */
  commentStep: number | null;
  /** The step the diagnostics land on. */
  diagStep: number | null;
  /** The `above` that makes the kind's SEEDED form, where it has one. */
  seedAbove: Record<number, string[]> | null;
  height: number;
  note: string;
}

export const KINDS: KindDef[] = [
  {
    id: "root",
    label: "root goal",
    scene: "basic",
    setup: "none",
    target: { id: "g0" },
    commentStep: null,
    diagStep: null,
    seedAbove: null,
    height: 340,
    note: "the first goal; three hypotheses",
  },
  {
    id: "goal",
    label: "goal, 4 hyps",
    scene: "basic",
    setup: "none",
    target: { id: "g1" },
    commentStep: null,
    diagStep: null,
    seedAbove: null,
    height: 340,
    note: "an inner goal with four hypotheses, the used ones marked",
  },
  {
    id: "tactic",
    label: "tactic",
    scene: "basic",
    setup: "none",
    target: { id: "tactic:g0" },
    commentStep: 0,
    diagStep: 0,
    seedAbove: null,
    height: 340,
    note: "`intro hle` between the two goals",
  },
  {
    id: "fold",
    label: "folded goal +N",
    scene: "chain",
    setup: "fold",
    target: { id: "g1" },
    commentStep: 0,
    diagStep: 1,
    seedAbove: { 0: [".fold"] },
    height: 230,
    note: "plain: the reader's fold chevron; seeded: a `.fold` above the step before it",
  },
  {
    id: "hop",
    label: "hopped goal + ⋯ chip",
    scene: "chain",
    setup: "hop",
    target: { id: "g1" },
    commentStep: 1,
    diagStep: 1,
    seedAbove: { 1: [".none rewrite zero"] },
    height: 330,
    note: "plain: ⌥-click on the step; seeded: `.none <note>` above it — the ⋯ chip on the line and the caption beside it",
  },
  {
    id: "ghost",
    label: "ghost",
    scene: "split",
    setup: "ghost",
    target: { prefix: "elide-" },
    commentStep: null,
    diagStep: 0,
    seedAbove: { 0: [".none the split, nothing to see"] },
    height: 200,
    note: "a `.none` on a split: the dashed tactic-shaped box (a reader's band needs a marquee-plus-pill, so only the seeded form is drawn)",
  },
  {
    id: "calc",
    label: "calc ledger",
    scene: { file: "proofs/calc.lean", index: 1, at: { line: 46, character: 4 } },
    setup: "ledger",
    target: { prefix: "ledger:" },
    commentStep: null,
    diagStep: 0,
    seedAbove: null,
    height: 410,
    note: "the corpus's calc under `refine_3`, cut down to the calc step",
  },
  {
    id: "ctor",
    label: "ctor ledger",
    scene: { file: "proofs/multiline.lean", index: 2, at: { line: 35, character: 2 } },
    setup: "ledger",
    target: { prefix: "ledger:" },
    commentStep: null,
    diagStep: 0,
    seedAbove: null,
    height: 380,
    note: "`exact ⟨h, h.symm⟩` as a two-row ledger",
  },
  {
    id: "row",
    label: "ledger row",
    scene: { file: "proofs/calc.lean", index: 1, at: { line: 46, character: 4 } },
    setup: "ledger",
    target: { prefix: "ledger:" },
    commentStep: null,
    diagStep: null,
    seedAbove: null,
    height: 410,
    note: "one row of the calc ledger: its `+` / `−` and the wash under the pointer",
  },
  {
    id: "trace",
    label: "trace leaf",
    scene: "traced",
    setup: "trace",
    target: { prefix: "trace:" },
    commentStep: null,
    diagStep: 0,
    seedAbove: null,
    height: 210,
    note: "the dashed leaf B4 mints for a lemma `simp` used, opened with `⁇`",
  },
  {
    id: "stub",
    label: "cf stub",
    scene: "stub",
    setup: "stub",
    target: { prefix: "cf-stub" },
    commentStep: null,
    diagStep: null,
    seedAbove: null,
    height: 230,
    note: "the dashed stub for the line being typed (`cfStub` prop)",
  },
];

/** Why a (kind, state) cell is not drawn.  Keyed `kind/state`. */
export const SKIPS: Record<string, string> = {};

const skip = (kinds: string[], states: string[], why: string) => {
  for (const k of kinds) for (const s of states) SKIPS[`${k}/${s}`] ??= why;
};

// Diagnostics attach to the tactic whose range they cover (or an open goal, for
// `unsolved goals`); a closed goal, a ledger row or a stub is nobody's range.
skip(["root", "goal", "stub"], ["error", "warn", "lint"], "diagnostics attach to tactics (and to open goals only for `unsolved goals`); this node is a closed goal or a stub");
skip(["stub"], ["selected", "armed", "kbfocus", "marksrc", "marktmp", "nub", "seeded", "bar", "comment", "narrate", "polish", "rowopen"], "the cf stub is painted beside the tree, not a node: no box, no corner, no bar, no key stop");
// A `.mark` or a prose comment is a comment above a TACTIC.
skip(["root", "goal", "fold", "hop"], ["marksrc", "comment"], "a `.mark` / prose comment attaches to a TACTIC (the step below); goals carry none");
skip(["trace"], ["error", "warn", "lint"], "the ribbon belongs to the host `simp` step, not to the leaf (shown by the tactic row)");
skip(["ghost", "calc", "ctor", "trace"], ["marksrc", "comment"], "no source line of its own to put a comment on (ghost = a cut, ledger = a host tactic's rows, trace leaf = generated)");
skip(["ghost"], ["marktmp", "nub", "bar"], "a marker stands for something rather than being it: no corner nub, no hover bar (a click restores it)");
skip(["ghost", "trace", "stub"], ["armed"], "no trash on a ghost (a cut) or a generated trace leaf: nothing to arm");
skip(["calc", "ctor", "row"], ["armed"], "the ledger's trash is disabled (a ledger is its host tactic's rows: delete the host)");
// Only a ledger has rows to open.
skip(["root", "goal", "tactic", "fold", "hop", "ghost", "trace"], ["rowopen"], "only a ledger has rows to open");
// `.fold` / `.none` are what seed cuts.
skip(["ghost"], ["seeded"], "the ghost IS the seeded form (the plain cell): a reader's band needs the marquee pill");
skip(["root", "goal", "tactic", "calc", "ctor", "trace"], ["seeded"], "nothing to seed here: `.fold` / `.none` make folds, hops and ghosts");
// Narration (∴) is generated for tactics and for the summary a cut stands on;
// a closed goal, a ghost, a trace leaf and a row draw none.
skip(["root", "goal", "ghost", "trace"], ["narrate", "polish"], "no ∴ strip: goals get none unless folded, a ghost and a trace leaf are generated themselves");
skip(["stub"], ["stack"], "the cf stub is not a node");
skip(["row"], STATES.map((s) => s.id).filter((s) => !["plain", "rowopen", "bar"].includes(s)), "row-level cell: only the row's own states are drawn (the ledger node's states are the calc and ctor rows)");

export interface Cell {
  kind: string;
  state: string;
  skip: string | null;
}

/** Every cell of the grid, row-major, with the reason it is skipped (or null). */
export function cells(): Cell[] {
  return KINDS.flatMap((k) =>
    STATES.map((s) => ({ kind: k.id, state: s.id, skip: SKIPS[`${k.id}/${s.id}`] ?? null })),
  );
}
