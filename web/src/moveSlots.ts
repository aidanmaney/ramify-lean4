// The slot a disabled hover-bar move keeps (2026-09-28): the same glyph and
// size the live move uses, so a slot does not change look when it wakes.
// A `.ts` file, not nodeBar.tsx — the icons are built with `createElement`,
// and a component file must export only components (fast refresh).
import { createElement } from "react";
import { MOVE_MARK, type BarKind, type MoveId } from "./moves";
import { InlineIcon, SkipIcon, TrashIcon, type NodeMove } from "./nodeBar";
import { MENU_ICON } from "./menuIcons";
import { PATH_GLYPH_PX, SOURCE_GLYPH_PX } from "./hoverBarMetrics";

/** How each move LOOKS — one table, spread by `movesFor` (the live move) and
 `disabledSlot` (its greyed slot), so a slot does not change look when it
 wakes and the glyph is written once. `menuIcon` is the stroked mark the `⋯`
 menu draws for a row whose bar glyph is plain text. */
export const MOVE_LOOK: Record<
  MoveId,
  Pick<NodeMove, "glyph" | "icon" | "glyphPx" | "menuIcon">
> = {
  source: { glyph: MOVE_MARK.source, glyphPx: SOURCE_GLYPH_PX },
  focus: { glyph: MOVE_MARK.focus },
  skip: { glyph: "skip", icon: createElement(SkipIcon) },
  path: { glyph: MOVE_MARK.path, glyphPx: PATH_GLYPH_PX },
  delete: { glyph: "delete", icon: createElement(TrashIcon) },
  trace: { glyph: MOVE_MARK.trace },
  collapse: { glyph: MOVE_MARK.collapse },
  expand: { glyph: MOVE_MARK.expand },
  inline: { glyph: MOVE_MARK.inline, icon: createElement(InlineIcon) },
  extract: { glyph: MOVE_MARK.extract, icon: createElement(InlineIcon, { up: true }) },
  lint: { glyph: MOVE_MARK.lint },
  lens: { glyph: MOVE_MARK.lens },
  goal: { glyph: MOVE_MARK.goal, menuIcon: MENU_ICON.plus },
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
