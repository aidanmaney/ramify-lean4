/** THE MOVES, IN THE READER'S WORDS (2026-09-22).
 *
 * Every restructuring and automation gesture used to be named after the
 * FEATURE that implements it — "inline", "hoist", "collapse to one automation
 * tactic", "the `?` form's `Try this`" — which a reader who has never met the
 * design record cannot parse. Each one is named here after what it does to
 * THIS step, with the concrete tactic or hypothesis where one is known: `⁇` on
 * a `simp` reads "What did `simp` use?", not "show the trace".
 *
 * One module, so the hover bar's tooltip, the `⋯` menu's row, the proposal
 * pill and the toasts say one thing. Pure: no React, no layout. */

/** THE HOVER BAR'S BUTTONS, BY ID (2026-09-22). Every move the bar can carry;
 the `⋯` menu carries every one of them that is available on the node (plus
 the menu-only rows), and the bar carries the ones the reader's list names, in
 the list's order, each only where the move is available — `⋯` is always last
 and is not in the list. Two lists, one per node kind: `ramify.hoverBar.tactic`
 and `ramify.hoverBar.goal` (package.json's enum is this array — keep them in
 step), with `?hoverbar-tactic=`/`?hoverbar-goal=` in the harness. The order
 here is the `⋯` menu's. */
export const MOVE_IDS = [
  "source",
  "focus",
  "skip",
  "path",
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

export type BarKind = "tactic" | "goal";

/** The bar a reader meets with no setting and no preset opinion (user
 direction, 2026-09-22: "source focus skip path delete more … by default as
 icons"). The automation and restructuring moves live in `⋯` until pinned. */
export const DEFAULT_BAR: readonly MoveId[] = [
  "source",
  "focus",
  "skip",
  "path",
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
export const capitalise = (s: string) =>
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
      : `What did ${h} use?`;
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

/** D5, on a context line (⌥-click) and in the goal's `⋯` menu. */
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
