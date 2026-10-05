// The slot a disabled hover-bar move keeps (2026-09-28): the same codicon the
// live move uses, so a slot does not change look when it wakes. A `.ts` file,
// not nodeBar.tsx — a component file must export only components (fast
// refresh).
import { MOVE_MARK, type BarKind, type MoveId } from "./moves";
import { type NodeMove } from "./nodeBar";
import { ICON } from "./icons";

/** How each move LOOKS — one table, spread by `movesFor` (the live move) and
 `disabledSlot` (its greyed slot), so a slot does not change look when it
 wakes and the icon is written once. `glyph` is the button's key and the
 move's mark in prose (`MOVE_MARK`); `codicon` is what is drawn, on the bar
 and heading the move's `⋯` row (2026-10-04: VS Code's own icons, replacing
 the per-glyph font sizes and the drawn skip/trash/inline marks). */
export const MOVE_LOOK: Record<MoveId, Pick<NodeMove, "glyph" | "codicon">> = {
  source: { glyph: MOVE_MARK.source, codicon: ICON["move.source"] },
  focus: { glyph: MOVE_MARK.focus, codicon: ICON["move.focus"] },
  skip: { glyph: "skip", codicon: ICON["move.skip"] },
  path: { glyph: MOVE_MARK.path, codicon: ICON["move.path"] },
  // The lightbulb: `lightbulb-autofix` where the linter has a fix (the view
  // swaps the codicon and the ink, `--ptw-lightbulb(-autofix)`).
  fix: { glyph: MOVE_MARK.fix, codicon: ICON["move.fix"] },
  delete: { glyph: "delete", codicon: ICON["move.delete"] },
  trace: { glyph: MOVE_MARK.trace, codicon: ICON["move.trace"] },
  collapse: { glyph: MOVE_MARK.collapse, codicon: ICON["move.collapse"] },
  expand: { glyph: MOVE_MARK.expand, codicon: ICON["move.expand"] },
  inline: { glyph: MOVE_MARK.inline, codicon: ICON["move.inline"] },
  extract: { glyph: MOVE_MARK.extract, codicon: ICON["move.extract"] },
  lint: { glyph: MOVE_MARK.lint, codicon: ICON["move.lint"] },
  lens: { glyph: MOVE_MARK.lens, codicon: ICON["move.lens"] },
  goal: { glyph: MOVE_MARK.goal, codicon: ICON["move.goal"] },
};

/** The move's slot, greyed, its tip saying why it cannot be used here. */
export function disabledSlot(id: MoveId, tip: string): NodeMove[] {
  return [
    {
      id,
      ...MOVE_LOOK[id],
      label: tip,
      title: tip,
      disabled: true,
      onClick: () => {},
    },
  ];
}

/** Can this move EVER apply to a node of this kind? Read off the gates in
 `movesFor`: skip, trace, expand, inline, extract, lens and the ledger `+` are
 tactic-only (`elideGateOf`, `isAutomationNode`, `popoutable`, `linkPlus`
 all require `type === "tactic"`), focus is goal-only (`focusable`), and the
 rest apply to both. A slot is kept only where this holds — a move that never
 applies to the kind is not drawn, so no bar carries a permanently grey
 button. */
const TACTIC_ONLY: readonly MoveId[] = [
  "skip",
  "trace",
  "expand",
  "inline",
  "extract",
  "lens",
  "goal",
];
export const appliesToKind = (id: MoveId, kind: BarKind): boolean =>
  kind === "goal" ? !TACTIC_ONLY.includes(id) : id !== "focus";
