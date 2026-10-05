// ONE CODICON = ONE MEANING (2026-10-05). Every icon the UI draws is named
// here, by the SLOT it serves (a band item, a panel row, a move, a menu row,
// the rail, the header, a chip), and every component reads it from this table
// rather than spelling a codicon name. A name may serve two slots only where
// they MEAN the same thing — listed in `SAME_MEANING` with the reason — so a
// reader who learns an icon in one place can read it everywhere. `probe icons`
// (in `npm test`) enforces both halves: no name in two slots outside an
// allowed group, and no codicon name spelled as a string literal anywhere
// else in web/src (the generated codicon.ts, codiconView.tsx's classic tables
// and this file excepted).
//
// The owner's report that started it: `list-tree` meant both the outline
// layout and ⇑ "write out what `grind` used", `filter` meant the path move,
// `sparkle` both narration and the model, `split-horizontal` both
// side-by-side and "open to the side", and `add` four different things.
import { type CodiconName } from "./codicon";

export const ICON = {
  // THE BAND: one CONSTANT icon per item (VS Code's `$(icon) value`).
  "band.layout": "list-tree",
  "band.context": "filter",
  "band.comments": "comment",
  "band.reading": "eye",
  "band.marks": "bookmark",
  "band.help": "question",
  "band.restart": "debug-restart",
  // Work in progress: the restart while Lean elaborates, `⁇` while it asks.
  busy: "loading",

  // The Layout panel's rows.
  "layout.outline": "list-tree",
  "layout.spine": "layout-sidebar-left",
  "layout.tracks": "layout",
  "layout.wide": "type-hierarchy-super",
  "layout.sideBySide": "layout-centered",
  "layout.gallery": "window",
  "layout.width": "word-wrap",

  // The Comments panel's rows.
  "comments.show": "comment",
  "comments.hide": "eye-closed",
  "comments.inPlace": "comment-discussion",
  "comments.narrate": "quote",

  // THE MOVES (hover bar and `⋯` rows; moveSlots.ts `MOVE_LOOK`).
  "move.source": "go-to-file",
  "move.focus": "target",
  "move.skip": "debug-step-over",
  "move.path": "git-commit",
  "move.fix": "lightbulb",
  "move.fixAuto": "lightbulb-autofix",
  "move.delete": "trash",
  "move.trace": "references",
  "move.collapse": "wand",
  "move.expand": "list-unordered",
  "move.inline": "fold-down",
  "move.extract": "fold-up",
  "move.lint": "lightbulb-autofix",
  "move.lens": "split-horizontal",
  "move.goal": "unfold",
  "move.more": "ellipsis",
  "move.propose": "sparkle",

  // The `⋯` menu's own rows (menuIcons.ts `MENU_ICON`).
  "menu.insert": "add",
  "menu.showRows": "unfold",
  "menu.hideRows": "fold",
  "menu.restore": "chevron-right",
  "menu.hide": "chevron-down",
  "menu.edit": "edit",
  "menu.comment": "comment",
  "menu.mark": "bookmark",
  "menu.unmark": "close",
  "menu.writeMark": "bookmark",
  "menu.pin": "pin",
  "menu.pinned": "pinned",
  // Check menus (every bar panel and the `⋯` menu's pins).
  "row.on": "check",
  "row.off": "blank",

  // Problems: the count item, the message strip, a node's popover.
  "diag.error": "error",
  "diag.warning": "warning",
  "diag.info": "info",
  "diag.next": "arrow-down",
  "diag.prev": "arrow-up",
  "diag.close": "close",

  // The zoom rail.
  "rail.zoomIn": "zoom-in",
  "rail.zoomOut": "zoom-out",
  "rail.fit": "screen-full",
  "rail.collapseAll": "collapse-all",
  "rail.expandAll": "expand-all",

  // Disclosure and paging.
  "header.open": "chevron-down",
  "header.close": "chevron-up",
  "reading.disclose": "chevron-down",
  "marks.prev": "chevron-left",
  "marks.next": "chevron-right",
  "gallery.prev": "chevron-left",
  "gallery.next": "chevron-right",
  "goal.open": "chevron-down",
  "goal.folded": "chevron-right",
  "scope.separator": "chevron-right",

  // The tree's own marks.
  "hop.chip": "ellipsis",
  "tab.remove": "close",

  // The scope chip in the signature header: the move that scoped, and out.
  "scope.focus": "target",
  "scope.path": "git-commit",
  "scope.close": "close",

  // Every other dismiss / cancel: the help panel, a pill's cancel chip.
  "chip.cancel": "close",
  "help.close": "close",
} as const satisfies Record<string, CodiconName>;

export type IconSlot = keyof typeof ICON;

/** The slots that DELIBERATELY share an icon, because they mean one thing.
 `probe icons` fails on any other shared name, and on an entry here whose
 slots no longer share. */
export const SAME_MEANING: { slots: IconSlot[]; why: string }[] = [
  {
    slots: ["band.layout", "layout.outline"],
    why: "the Layout item wears its default layout's icon, as a VS Code status item wears its default's",
  },
  {
    slots: ["band.comments", "comments.show", "menu.comment"],
    why: "a comment: the Comments item, its default mode, and the row that edits one",
  },
  {
    slots: ["band.marks", "menu.mark", "menu.writeMark"],
    why: "a mark: the Marks item and the two rows that drop one",
  },
  {
    slots: ["move.focus", "scope.focus"],
    why: "the scope chip names the move that scoped the view",
  },
  {
    slots: ["move.path", "scope.path"],
    why: "the scope chip names the move that scoped the view",
  },
  {
    slots: ["move.fixAuto", "move.lint"],
    why: "the linter's quick fix: the lightbulb turns into it where one is on the step",
  },
  {
    slots: ["move.goal", "menu.showRows"],
    why: "show a ledger row's goal — one row, or every row (VS Code's Unfold)",
  },
  {
    slots: ["move.more", "hop.chip"],
    why: "more than is drawn: VS Code uses `…` for More Actions and for a folded range's placeholder alike",
  },
  {
    slots: [
      "menu.unmark",
      "diag.close",
      "tab.remove",
      "scope.close",
      "chip.cancel",
      "help.close",
    ],
    why: "close, cancel, take off — VS Code's one dismiss mark",
  },
  {
    slots: ["menu.hide", "goal.open", "header.open", "reading.disclose"],
    why: "a disclosure chevron pointing down: open, and closes on click",
  },
  {
    slots: ["menu.restore", "goal.folded", "scope.separator", "marks.next", "gallery.next"],
    why: "a chevron pointing right: closed / onward — VS Code's folded-region and breadcrumb separator mark",
  },
  {
    slots: ["marks.prev", "gallery.prev"],
    why: "a pager's back chevron",
  },
];
