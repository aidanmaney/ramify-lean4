/** THE MOVES, IN THE READER'S WORDS (2026-09-22).
 *
 * Every restructuring and automation gesture used to be named after the
 * FEATURE that implements it — "inline", "hoist", "collapse to one automation
 * tactic", "the `?` form's `Try this`" — which a reader who has never met the
 * design record cannot parse. Each one is named here after what it does to
 * THIS step, with the concrete tactic or hypothesis where one is known: `⁇` on
 * a `simp` reads "Show what `simp` used", not "show the trace". Every row is
 * an imperative about this step.
 *
 * One module, so the hover bar's tooltip, the `⋯` menu's row, the proposal
 * pill and the toasts say one thing. Pure: no React, no layout. */

/** THE HOVER BAR'S BUTTONS, BY ID (2026-09-22). Every move the bar can carry;
 the `⋯` menu carries every one of them that is available on the node (plus
 the menu-only rows) except `fix`, the lightbulb, which is not a row but opens
 the menu at its Quick Fix and Refactor sections; and the bar carries the ones the reader's list names, in
 the list's order, each only where the move is available — `⋯` is always last
 and is not in the list. Two lists, one per node kind: `ramify.hoverBar.tactic`
 and `ramify.hoverBar.goal` (package.json's enums are this array, per kind by
 moveSlots.ts `appliesToKind`; scripts/check-sync.mjs asserts it), with `?hoverbar-tactic=`/`?hoverbar-goal=` in the harness. The `⋯`
 menu orders its rows by `MENU_SLOTS`, not by this list. */
export const MOVE_IDS = [
  "source",
  "focus",
  "skip",
  "path",
  "fix",
  "delete",
  "trace",
  "collapse",
  "expand",
  "inline",
  "extract",
  "lint",
  "lens",
  "goal",
] as const;

export type MoveId = (typeof MOVE_IDS)[number];

/** THE `⋯` MENU'S GROUPS (2026-10-04, batch 2), VS Code's context-menu
 structure: rows in groups with a separator between them — NAVIGATE (where to
 look, and what automation used), FOLD (what is drawn), EDIT (the source text),
 and the two CODE-ACTION sections the lightbulb opens (batch 4): QUICK FIX
 (the linter's fix, writing out what `simp` used, a Mathlib-style rename) and
 REFACTOR (inline, extract, replace a run with automation, ask the model) —
 VS Code's code-action order, quick fixes first. A row's SLOT is its move id,
 or for a menu-only row the word below; `MENU_SLOTS` is the order, groups in
 turn. `fix` (the lightbulb) is a bar slot with no row of its own: it OPENS
 these two sections. */
export const MENU_SLOTS = [
  // navigate
  "source",
  "focus",
  "path",
  "lens",
  "trace",
  // fold
  "skip",
  "fold",
  "goal",
  "rows",
  // edit
  "edit",
  "comment",
  "delete",
  "mark",
  "chip",
  // quick fix
  "lint",
  "expand",
  "rename",
  // refactor
  "inline",
  "extract",
  "collapse",
  "propose",
] as const;

export type MenuSlot = (typeof MENU_SLOTS)[number];

export type MenuGroup = "navigate" | "fold" | "edit" | "quickfix" | "refactor";

const GROUP_FIRST: [MenuSlot, MenuGroup][] = [
  ["source", "navigate"],
  ["skip", "fold"],
  ["edit", "edit"],
  ["lint", "quickfix"],
  ["inline", "refactor"],
];

/** Each slot's group, read off `MENU_SLOTS`' runs. */
export const MENU_GROUP = Object.fromEntries(
  MENU_SLOTS.map((slot, i) => {
    let g: MenuGroup = "navigate";
    for (const [first, group] of GROUP_FIRST)
      if (MENU_SLOTS.indexOf(first) <= i) g = group;
    return [slot, g];
  }),
) as Record<MenuSlot, MenuGroup>;

/** The CODE-ACTION sections wear a heading, as VS Code's lightbulb menu does,
 in VS Code's own words (its action-widget headers are title case: "Quick
 Fix", "Refactor"). The other groups are told apart by the separator alone. */
export const MENU_SECTION_TITLE: Partial<Record<MenuGroup, string>> = {
  quickfix: "Quick Fix",
  refactor: "Refactor",
};

/** The groups the lightbulb (`fix`) and ⌘. open the menu at. */
export const isCodeActionGroup = (g: MenuGroup): boolean =>
  g === "quickfix" || g === "refactor";

export type BarKind = "tactic" | "goal";

/** The character each move is known by in PROSE (`describePreset`,
 INSTALL.md, toasts). The bar and the `⋯` menu draw the move's codicon
 (moveSlots.ts `MOVE_LOOK`); only the paint changed, never these. */
export const MOVE_MARK: Record<MoveId, string> = {
  source: "»",
  focus: "◎",
  skip: "◌",
  path: "⊹",
  fix: "fix",
  delete: "delete",
  trace: "⁇",
  collapse: "⇓",
  expand: "⇑",
  inline: "⤵",
  extract: "⤴",
  lint: "✎",
  lens: "⧉",
  goal: "+",
};

/** The bar a reader meets with no setting and no preset opinion (user
 direction, 2026-09-22: "source focus skip path delete more … by default as
 icons"). The automation and restructuring moves live in `⋯` until pinned;
 since 2026-10-04 (batch 4) their one door on the bar is the LIGHTBULB
 (`fix`), which opens the menu at its Quick Fix and Refactor sections. It sits
 after the reading moves and before the trash: the reading moves come first,
 the two moves that change the source sit together, and the destructive one
 stays last, where VS Code puts it. */
export const DEFAULT_BAR: readonly MoveId[] = [
  "source",
  "focus",
  "skip",
  "path",
  "fix",
  "delete",
];

/** A list from the companion or the query string: known ids only, each once,
 in the order given; anything that is not an array is `null` (= not set, so
 the preset's default stands). An explicit EMPTY list is a real choice — a bar
 with nothing but `⋯`. */
export function parseBarList(v: unknown): MoveId[] | null {
  const raw =
    typeof v === "string"
      ? v.split(",").map((x) => x.trim()).filter((x) => x.length > 0)
      : v;
  if (!Array.isArray(raw)) return null;
  const out: MoveId[] = [];
  for (const x of raw)
    if (
      typeof x === "string" &&
      (MOVE_IDS as readonly string[]).includes(x) &&
      !out.includes(x as MoveId)
    )
      out.push(x as MoveId);
  return out;
}

/** Pin or unpin one move: unpinning keeps the others' order, pinning appends
 (the newest pin lands just before `⋯`, beside the menu it came from). */
export function togglePinned(list: readonly MoveId[], id: MoveId): MoveId[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** The pin's words, which are also its tooltip. */
export const pinLabel = (on: boolean, kind: BarKind) =>
  on
    ? `Take off the bar for ${kind === "goal" ? "goals" : "tactics"}`
    : `Show on the bar for ${kind === "goal" ? "goals" : "tactics"}`;

/** First letter up, for a line that starts a pill or a toast. */
const capitalise = (s: string) =>
  s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);

const tick = (s: string) => `\`${s}\``;

/** B4's `⁇`. `head` is the step's own head word (`simp`, `grind`, …). */
export function traceMoveLabel(
  head: string,
  state: "closed" | "open" | "busy",
): string {
  const h = tick(head || "this step");
  return state === "busy"
    ? `Asking Lean what ${h} used…`
    : state === "open"
      ? `Hide what ${h} used`
      : `Show what ${h} used`;
}

/** D2a's `⇓`, before the server has named the tactic that closes the run. */
export const collapseMoveLabel = (n: number) =>
  `Replace ${n === 1 ? "this step" : `these ${n} steps`} with automation`;

/** D2a's rewrite, once a candidate has closed the run. */
export const collapseTitle = (n: number, tactic: string) =>
  `replace ${n === 1 ? "this step" : `these ${n} steps`} with ${tick(tactic)}`;

/** D2b's `⇑`. */
export const expandMoveLabel = (head: string) =>
  `Write out what ${tick(head || "this step")} used`;

export const expandTitle = (head: string) => `write out what ${tick(head)} used`;

/** D1's `⤵`. */
export const inlineMoveLabel = (name: string) =>
  `Move ${tick(name)} into its one use`;

export const inlineTitle = (name: string, into: string) =>
  `move ${tick(name)} into ${tick(into)}`;

/** D1's `⤴`. */
export const EXTRACT_MOVE_LABEL = "Pull this `by` block out as a `have`";

export const EXTRACT_TITLE = "pull the `by` block out as `have this`";

/** D4's `✎`. `fix` is `LINT_FIXES`' sentence for the linter. */
export const lintMoveLabel = (fix: string) => `Apply the linter's fix: ${fix}`;

/** THE LIGHTBULB (batch 4): what the bar's `fix` slot does to this step —
 opens its fixes. `lint`: one of them is the linter's, so the bulb wears
 `lightbulb-autofix`, as VS Code's does for a preferred quick fix. */
export const fixMoveLabel = (lint: boolean) =>
  lint
    ? "Show fixes for this step — the linter has one"
    : "Show fixes and refactorings for this step";

/** D6's row in the Refactor section: the model picks one of THIS step's
 rewrites (or none) and says why; the pick still goes through Lean. */
export const PROPOSE_MOVE_LABEL = "Ask the model for a rewrite";

/** D5, on a context line (⌥-click) and in the goal's `⋯` menu (Quick Fix). */
export const renameMoveLabel = (from: string, to: string) =>
  `Rename ${tick(from)} to ${tick(to)} (Mathlib style)`;

export const renameTitle = (from: string, to: string) =>
  `rename ${tick(from)} to ${tick(to)} (Mathlib style)`;

/** What every proposal's tooltip adds: nothing is written until Lean agrees,
 and then only on the reader's click. */
export const CHECKED_FIRST = "Lean checks it first; nothing is written until you click the pill";

/** The proposal pill's line. `said` is the move (the rewrite's title, or the
 collapse's question while the server is out); lint titles are the linter's
 sentence and gain the move's name here. */
export function pillMove(kind: string, said: string): string {
  return capitalise(kind === "lint" ? lintMoveLabel(said) : said);
}

/** WHY A BAR SLOT IS GREY (2026-09-28). The hover bar keeps every move in the
 node kind's list in its slot, so the bar does not change width or shuffle
 buttons from box to box; a move that cannot be used on THIS node is drawn
 disabled with a tip that says why. `⋯` still omits it. The reasons are the
 few the gates already know; anything else is `generic`. */
export type Unavailable =
  | "generic"
  | "marker" // a skipped/ghost box stands for steps rather than being one
  | "noPosition"
  | "leaf"
  | "split"
  | "ledger"
  | "arming"
  | "pending"
  | "noExtent"
  | "notAutomation";

const SLOT_NAME: Record<MoveId, string> = {
  source: "Show in source",
  focus: "Focus",
  skip: "Skip this step",
  path: "Show only the path to here",
  fix: "Fixes and refactorings",
  delete: "Delete this step",
  trace: "Show what the step used",
  collapse: "Replace with automation",
  expand: "Write out what it used",
  inline: "Move into its one use",
  extract: "Pull out as a `have`",
  lint: "Apply the linter's fix",
  lens: "Open to the side",
  goal: "Show the goal this step proves",
};

/** The moves that open a proposal: each is greyed while another proposal on the
 node is waiting for an answer. */
export const RESTRUCTURE: readonly MoveId[] = ["collapse", "expand", "inline", "extract", "lint"];
const PENDING_WHY = { pending: "answer the open proposal first" };

const SLOT_WHY: Partial<Record<MoveId, Partial<Record<Unavailable, string>>>> = {
  source: {
    marker: "a skipped box has no source position of its own",
    noPosition: "this box has no source position",
  },
  focus: { leaf: "this goal has nothing below it" },
  skip: {
    marker: "this box is already skipped",
    split: "not offered on a step that splits the goal",
    ledger: "not offered on a calc or constructor row",
  },
  path: { marker: "not offered on a skipped box" },
  delete: {
    marker: "restore the skipped box first",
    arming: "confirm or cancel the pending delete first",
    noExtent: "this box has no source extent of its own",
  },
  trace: { notAutomation: "offered on simp, grind, aesop and the like" },
  fix: {
    generic: "nothing to fix or refactor on this step",
    pending: PENDING_WHY.pending,
  },
  ...Object.fromEntries(RESTRUCTURE.map((id) => [id, PENDING_WHY])),
};

/** Where a bar slot stands (`availability` in the view): live, absent for the
 whole KIND (`appliesToKind`) or SESSION (no companion, no edit hooks) — no
 slot is drawn in either case — or kept and greyed for a reason. */
export type Availability =
  | "yes"
  | "never-kind"
  | "never-session"
  | { no: Unavailable };

/** A disabled slot's tip, in the house voice: `Name — reason`, sentence case,
 no trailing period. */
export function unavailableTip(id: MoveId, why: Unavailable): string {
  return `${SLOT_NAME[id]} — ${SLOT_WHY[id]?.[why] ?? "not available for this step"}`;
}
