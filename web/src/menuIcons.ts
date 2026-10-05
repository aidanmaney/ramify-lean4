// Icons for the `⋯` menu's rows that have no bar button to borrow one from
// (edit, comment, marks, rename, fold): codicon NAMES, so every row of the
// menu has an icon and a `NodeMove` carries its own (`codicon`) instead of the
// menu guessing one from the glyph's text.
import { type CodiconName } from "./codicon";
import { ICON } from "./icons";

export const MENU_ICON = {
  // Insert text into the source (the frontier chips' rows).
  plus: ICON["menu.insert"],
  // A ledger's "show / hide every step's goal" (VS Code's Unfold / Fold).
  showRows: ICON["menu.showRows"],
  hideRows: ICON["menu.hideRows"],
  // A goal's fold rows wear the corner control's own chevrons.
  fold: ICON["menu.hide"],
  unfold: ICON["menu.restore"],
  edit: ICON["menu.edit"],
  comment: ICON["menu.comment"],
  mark: ICON["menu.mark"],
  unmark: ICON["menu.unmark"],
  writeMark: ICON["menu.writeMark"],
} as const satisfies Record<string, CodiconName>;
