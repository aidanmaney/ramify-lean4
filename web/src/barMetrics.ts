// The status bar's, the rail's and the hover icons' shared measures: lane and bar insets, item heights,
// glyph boxes, stroke weights and the chrome button styles. Constants live here (not beside the components) so the
// components' files export components alone, which fast refresh needs.
import { type CSSProperties, type ReactNode } from "react";
import {
  FLOATER_CHROME,
  CHROME_SURFACE,
  CHROME_BORDER,
  CHROME_INK,
  CHROME_RADIUS,
  CHROME_TEXT,
  Z,
} from "./theme";

export const RAIL_BTN: CSSProperties = {
  width: 26,
  height: 26,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  fontFamily: "monospace",
  fontSize: 14,
  lineHeight: 1,
  cursor: "pointer",
  background: CHROME_SURFACE,

  borderWidth: 1,
  borderStyle: "solid",
  borderColor: CHROME_BORDER,
  borderRadius: CHROME_RADIUS,
  color: CHROME_INK,
};

// The chrome every menu popover wears, wherever it is hung from: the bar's
// menus open upward from the bar, the rail's opens left of the rail, and the
// two must not drift.
export const MENU_PANEL: CSSProperties = {
  boxSizing: "border-box",
  zIndex: Z.popup,
  ...FLOATER_CHROME,
  padding: 4,
  fontSize: CHROME_TEXT,
  lineHeight: 1.4,
  textAlign: "left",
  cursor: "default",
};

/** A button with the browser's chrome taken off: it wears whatever its
 container's ink is. Spread, then add what this button is. */
export const BARE_BTN: CSSProperties = {
  margin: 0,
  padding: 0,
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};

export const PILL_BTN: CSSProperties = {
  ...BARE_BTN,
  width: 14,
  height: 16,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "monospace",
  fontSize: 12,
  lineHeight: 1,
};

/* THE BOTTOM LANE — the strip the infoview's own floating "Restart File"
button owns, and the reason our chrome is placed the way it is.

That button is `position: fixed; bottom: 10px; right: 10px` (vscode-lean4's
`index.css`) over a webview-ui-toolkit button whose own shadow-root CSS is
`line-height: 22px; padding: 1px 13px; border-width: 1px` — 26px tall, and
~95px wide, measured in the running editor (the arithmetic off the shipped
bundle in `dist/lean4-infoview/` says 26 of padding and border either side of
"Restart File", which `measureText` puts at 68.3px in the macOS UI font at 13px
and 66.5 in Segoe; the measurement is what the reserve follows). Being
`fixed`, it hangs over the bottom right of the WEBVIEW VIEWPORT whatever the
page scrolls to.

The frame used to step back out of that whole lane (a 44px bottom clearance),
which cost the tree 44px of height at every panel size. Now the frame takes
ALL the room there is (widget.tsx) and the chrome dodges the button by
PLACEMENT instead: the status card sits IN the lane at the button's own inset
and height, so card and button read as one row of chrome, and the zoom rail
moves UP to sit above the button. One coding, three readers — the card's
`bottom`/`height`/`max-width`, the rail's `bottom`, and `fit`'s idea of how
much width the words have. */
export const LANE_INSET = 10;

export const LANE_BTN_H = 26;

// The button's own width, re-measured in the running VS Code rather than
// computed from the toolkit's padding: ~95px, so 96 is the reserve. The gap
// beside it comes down with it — the card is chrome in the same lane, and 4px
// is what separates two items of chrome, not 8.
const LANE_BTN_W = 96;

export const LANE_GAP = 4;

// The zoom rail's own corner, in the same one coding. It sits tighter to the
// right edge than the card does to the left (`RAIL_INSET`, 4 against the
// card's 8) and higher above the host button than the card's own lane gap
// would put it (`RAIL_LANE_GAP`, 12 against `LANE_GAP`'s 4) — the rail is a
// column of round buttons hanging over the tree rather than a card lying in
// the button's lane, so it wants the canvas edge and it wants daylight
// between itself and the button below.
export const RAIL_INSET = 4;

export const RAIL_LANE_GAP = 12;

/** Where the strip sits where the lane beside the host button cannot hold even
 the all-glyph row (a very thin pane): one lane above the button, spanning the
 frame between `LANE_INSET`s, and the rail climbs over it. The only fallback. */
export const BAR_LIFT = LANE_INSET + LANE_BTN_H + LANE_GAP;

/** The gap between the status card's top and the message strip's bottom —
 the lane gap, the one separation between two pieces of chrome. */
export const DIAG_STRIP_GAP = LANE_GAP;

// The strip is EXACTLY the button's height — see BAR_ITEM_H for why that is a
// fixed `height` and not a minimum.
export const BAR_H = LANE_BTN_H;

// The gap between items, and the card's own padding. Both feed the ACCENT
// PILL's margins: an accented item's highlight is inset from the card's top
// and bottom edges by `STATUS_PAD_Y + 1` (the border) and from its neighbours
// by the whole `STATUS_GAP`, so the pill floats inside the card rather than
// filling it edge to edge.
export const STATUS_GAP = 4;

export const STATUS_PAD_Y = 2;

export const STATUS_PAD_X = 6;

// THE STRIP SPANS THE LANE (2026-10-02): from `LANE_INSET` on the left — the
// host button's own inset from the frame's edge — to the room kept clear on
// the right for the button (its ~96px at `right: 10`, plus a 4px gap). Both
// ends are fixed by the frame alone, so the strip's width is a fact about the
// pane and never about its content: nothing in it moves when a setting
// lengthens a value, and the slack sits BETWEEN the two groups (settings
// left, the reading position, diagnostics and `?` right) like every status
// bar's. It is the same number `fit` measures the words against.
export const BAR_RIGHT_RESERVE = LANE_INSET + LANE_BTN_W + LANE_GAP;

/** The least room kept between the strip's two groups, so the left group's
 last item and the right group's first never touch. `fit` counts it. */
export const BAR_GROUP_GAP = 2 * STATUS_GAP;

/* ONE HEIGHT. The card is a fixed `height: BAR_H` and every item a fixed
`BAR_ITEM_H`, never a minimum and never a line box — because the row's content
changes FONT: the compact glyphs are drawn in the tree's code font at their own
`glyphPx` (up to 19 for `▸`), so an item sized by its line box grew and shrank
as the row compacted and as `used` was swapped for `narrate`. A status bar that
changes height when you change a setting is the report this rule answers.

So height comes only from these two numbers: 20 + 2 * STATUS_PAD_Y + 2 (the
card's border) = 26. Vertical padding on the item is therefore ZERO — the
height and `alignItems: center` do that work — and every glyph sits inside a
fixed-size box (`GlyphBox`) so no font size can reach the layout at all.
`borderRadius` is `CHROME_RADIUS`: items are FLAT, like VS Code's own status-bar
items (2026-10-02; they were `BAR_ITEM_H / 2` pills, and the focus ring followed
the pill — a fat squircle on a flat strip). */
export const BAR_ITEM_H = 20;

// The item's side padding, and so the accent pill's own side margin. It has
// come down twice, both times to buy row width — 10 → 8 when the glyph
// prefixes went in, 8 → 6 when the card moved into the host button's lane and
// gave up 68px of room on the right. Six is where VS Code's own status-bar
// items sit; below it the pill stops reading as a pill.
const BAR_ITEM_PAD_X = 6;

export const BAR_ITEM: CSSProperties = {
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  // Only so the EXTRAS SLOTS can be absolutely positioned inside the item's
  // own box (see `ExtraSlots`). It changes nothing about the item's layout.
  position: "relative",
  height: BAR_ITEM_H,
  padding: `0 ${BAR_ITEM_PAD_X}px`,
  border: "none",
  borderRadius: CHROME_RADIUS,
  // A hover wash, paint only: the variable is set by `[data-ptw-baritem]:hover`
  // in theme.ts and an accented item's inline background wins over it.
  background: "var(--ptw-bar-item-bg, transparent)",
  color: "inherit",
  font: "inherit",
  whiteSpace: "nowrap",
  flexShrink: 0,
  cursor: "pointer",
};

// Every glyph in the bar — a compact mode mark in the code font, one of the
// drawn SVG icons, `↺`, `?` — is painted inside a box of FIXED size, so its
// font, its size and its own ink can never reach the item's box. That is what
// makes both promises hold at once: ONE HEIGHT (the box is `BAR_ITEM_H` tall
// whatever is in it) and a STABLE WIDTH (swapping `▸` for `λ` moves nothing).
export const GLYPH_BOX_W = 14;

export const TEXT_GLYPH_BOX_W = 10;

export const BAR_ROW: CSSProperties = {
  boxSizing: "border-box",
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  width: "100%",
  padding: "3px 6px",
  border: "none",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  borderRadius: CHROME_RADIUS,
};

/* THE EXTRAS SLOTS. Three of the bar's menus hold TOGGLES beside their main
setting — Layout's side-by-side and gallery, Context's `Split data & props`,
and the reading eye's brief/merge/to-cursor — and none of them shows in the
item's own label, which names the choice and not the extras. A row of small
SQUARES under the item says which are up without naming them (the popover rows
do that) and without costing a character of the row.

They are SLOTS, not a count: each extra owns a fixed position in the group and
an unset one is drawn FAINT (`SLOT_OFF`; it was empty until 2026-09-24, when a lone
lit square read as off-centre), so the eye with brief and to-cursor up reads
`■ ▫ ■` and the reader can tell WHICH is off rather than only how many. Every
slot therefore reserves its `SLOT_PX` whether it is set or not, which is also
what keeps the group's centre still as extras toggle.

It is ABSOLUTELY POSITIONED inside the item's fixed 20px box, so it can reach
neither the row's height (ONE HEIGHT) nor the item's width (STABLE WIDTH) —
which is also what lets a mark appear and disappear without moving anything to
its right. `left: 0; right: 0` centres the group under the whole item, i.e.
under the label in the text form and under the glyph box in the compact one.
`bottom: -1` drops it into the card's own bottom padding — still inside the
border, and clear of the label's descenders. */
export const SLOT_PX = 3;

/** An unset slot: the ink at a quarter, so the whole group's extent — and
therefore its centre — shows. */
export const SLOT_OFF = `color-mix(in srgb, ${CHROME_INK} 25%, transparent)`;

export const SLOT_GAP_PX = 2;

/* TWO ROW LOOKS, ONE PER KIND OF ROW (2026-09-22). A `pick` row is one of a
set — Layout's four, Context's four, Comments' four — and wears the `●/○`
radio; a `toggle` row turns ONE thing on or off independently of its
neighbours (the reading options, the two mark lists, the modifiers below a
divider) and wears a drawn CHECK SQUARE (`BarCheck`); an `action` row does
something once and wears neither. The look is what tells "pick one" from
"turn on" before the reader has clicked anything. */
export type BarRowKind = "pick" | "toggle" | "action";

/* THE FOUR LAYOUT MARKS, in the eye's idiom and no longer in Unicode's.

They were `☰ ⊦ || ⑃` in the tree's code font at a per-mark `glyphPx` chosen to
level their ink HEIGHTS (14/14/8/15), and the heights were level — but height
was never the complaint. Re-measured on an 8× supersampled raster in the
harness's own code font, the STROKE each mark draws with (median run across
its own strokes, in CSS px):

    ☰  1.25    ⊦  0.88    ||  0.75    ⑃  0.63
    eye 1.2 (its own `strokeWidth`)    comment/width glyphs 1.25    ⚑ 2.9 solid

so three of the four drew at HALF to two-thirds the weight of every other mark
in the row — the reported "too thin/small". A font glyph has no weight knob:
its stems come with the face, they thin as `glyphPx` comes down (`||` is at 8
precisely so two full-em bars do not tower), and they move with whatever
editor font the user has set. So the four are drawn instead, in the idiom the
eye and the comment/width glyphs already established: inline SVG, `currentColor`,
ONE shared `BAR_GLYPH_SW`, cropped to their own ink, inside the same fixed
`GlyphBox` — so nothing the ghost measures moves, and no user font reaches
them. Ink, measured: 10.0 × 8.8, 7.7 × 8.8, 7.0 × 8.8, 9.0 × 8.8 — level in
height as the `glyphPx` pass left them, and now level in weight as well.

The OUTLINE mark keeps its SHAPE exactly: three full-width bars, `☰` as it
stood. Only its weight moves, up to the shared stroke with the rest.

2026-09-22 (taste pass): the eye (1.2) and the comment/width marks (1.25)
now draw at this stroke too, as does the signature header's chevron — every
drawn mark in the chrome shares ONE weight, so no item looks lighter than its
neighbour. (The hover bar's in-tree icons keep their own `HOVER_ICON_SW`: they
scale with the tree.) */
export const BAR_GLYPH_SW = 1.4;

/** The goal corner's drawn `−`: its length and stroke, and the corner's hit
 height (the hit width is `CORNER_W`, the top line's reserve). The mark is
 in-tree ink, a quiet sign at about the weight of the `+N` it becomes — the
 chrome's `BAR_GLYPH_SW` at 8px read as the loudest thing on the box
 (2026-09-24); the hit rect, not the ink, is the target. */
export const CORNER_MINUS_W = 6;

export const CORNER_MINUS_SW = 1.15;

export const CORNER_HIT_H = 18;

/** One of the bar's VALUE items (Layout, Context, Comments and — only where
the proof has marks — Marks), as data: the three forms it can be drawn in and
every value it could show. The FULL form is `Name: value` — `prefix` is the
NAME, always a word, never an icon; the VALUE form drops the name (`outline`),
which the item's tip still opens with (`Layout: outline — …`, the title's own
first words); the GLYPH form is the icon alone. `value` is the half that
changes, and `values` is every string it could be, which is what reserves its
width in both word forms. */
export type BarForm = "full" | "value" | "glyph";

export interface BarValueItem {
  id: string;
  prefix: ReactNode;
  glyph: ReactNode;
  value: string;
  values: string[];
  /** Where the item has no `Name: value` shape (the reading eye, which is a
   menu and not a setting): what stands in the FULL and the VALUE forms. The
   glyph form is `glyph` as ever, and `values` is empty (nothing reserved). */
  words?: { full: ReactNode; value: ReactNode };
  title: string;
  /** The VALUE reads as OFF — dimmed, the way the width readout dims at
   `full`. Paint only: the reserve is unchanged, so nothing moves when a
   value turns off. */
  dim?: boolean;
  // The extras behind this item's menu, one per fixed slot (see `ExtraSlots`).
  slots?: boolean[];
  onAlt?: () => void;
  /** Controls drawn immediately AFTER this item's button, inside the same
   inline group — the tour's `‹ ›`. They ride both of `valueMenu`'s forms, so
   the ghost measures them with the item and the compaction stays honest. */
  after?: ReactNode;
}

/** The status READOUT's facts (statusBar.tsx / `StatusReadout`): the
declaration's name (already clipped to `STATUS_NAME_MAX`, empty where the
view has none), the proof's tactic count on the BASE tree, how many goals are
still open (no step yet — what the frontier chips attach to), and how many
tactics the drawn tree's cuts hide (the sum of every `+N`). The two handlers
are the readout's only gestures; a zero count draws no part and no button. */
export interface StatusInfo {
  name: string;
  steps: number;
  open: number;
  hidden: number;
  onOpen: () => void;
  onHidden: () => void;
}

/** The words of the status readout, each part where it is non-zero: `5 steps`,
 `1 open`, `4 hidden` (the name, where there is one, leads). One coding for the
 drawn readout, its tip and its ghost. */
export function statusParts(i: Pick<StatusInfo, "steps" | "open" | "hidden">) {
  return {
    steps: `${i.steps} ${i.steps === 1 ? "step" : "steps"}`,
    open: i.open > 0 ? `${i.open} open` : null,
    hidden: i.hidden > 0 ? `${i.hidden} hidden` : null,
  };
}

/** The tip's text: `Status: <the readout> — click open to …, hidden to …`,
 naming only the gestures that are there. */
export function statusTip(i: StatusInfo): string {
  const p = statusParts(i);
  const text = [i.name || null, p.steps, p.open, p.hidden]
    .filter((x): x is string => x !== null)
    .join(" · ");
  const acts = [
    p.open ? "open to go to the next open goal" : null,
    p.hidden ? "hidden to expand all" : null,
  ].filter((x): x is string => x !== null);
  return `Status: ${text}${acts.length > 0 ? ` — click ${acts.join(", ")}` : ""}`;
}

/** The longest declaration name the readout shows, in characters
 (`clipText`'s cap, `…` included) — and so what its ghost reserves. */
export const STATUS_NAME_MAX = 24;

/** The stroke every DRAWN hover-bar icon shares (skip, trash, inline/extract):
the bar scales with the tree, so it keeps its own weight rather than the
chrome's `BAR_GLYPH_SW`. */
export const HOVER_ICON_SW = 0.9;

// The header chevron's ink (`HeaderChevron`); the lane it sits in is ProofTreeView's `HDR_BTN_*`.
export const HDR_CHEVRON_W = 8;
export const HDR_CHEVRON_H = 5;
