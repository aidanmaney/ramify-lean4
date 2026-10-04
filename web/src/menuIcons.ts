// Icons for the `⋯` menu's rows that have no bar button to borrow one from
// (edit, comment, marks, rename, fold): codicon NAMES, so every row of the
// menu has an icon and a `NodeMove` carries its own (`codicon`) instead of the
// menu guessing one from the glyph's text.
import { type CodiconName } from "./codicon";

export const MENU_ICON = {
  plus: "add",
  minus: "remove",
  edit: "edit",
  comment: "comment",
  mark: "bookmark",
  unmark: "close",
  writeMark: "bookmark",
} as const satisfies Record<string, CodiconName>;
