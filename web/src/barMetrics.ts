// The status bar's and the rail's shared measures: lane and bar insets, item heights, glyph boxes and
// the chrome button styles. Constants live here (not beside the components) so the
// components' files export components alone, which fast refresh needs.
import { type CSSProperties, type ReactNode } from "react";
import {
  FLOATER_CHROME,
  chromeSurface,
  MENU_BG,
  MENU_BORDER,
  MENU_FG,
  CHROME_INK,
  CHROME_RADIUS,
  CHROME_TEXT,
  Z,
} from "./theme";

/** A rail button: VS Code's action-bar item, a 22px square around a 16px
 codicon, borderless — its `RailGroup` wears the surface — with the toolbar's
 hover wash (`data-ptw-baritem`) and pressed wash (theme.ts). */
export const RAIL_BTN: CSSProperties = {
  width: 22,
  height: 22,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  margin: 0,
  lineHeight: 1,
  cursor: "pointer",
  border: "none",
  background: "var(--ptw-bar-item-bg, transparent)",
  borderRadius: CHROME_RADIUS,
  color: CHROME_INK,
};

/** The padding inside a rail group, and the gap between the two groups. */
export const RAIL_GROUP_PAD = 1;
export const RAIL_GROUP_GAP = 6;

// The chrome every menu popover wears, wherever it is hung from: the bar's
// menus open upward from the bar, the rail's opens left of the rail, and the
// two must not drift.
export const MENU_PANEL: CSSProperties = {
  boxSizing: "border-box",
  zIndex: Z.popup,
  ...FLOATER_CHROME,
  // The editor's MENU surface (2026-10-04): the `⋯` menu and every bar panel
  // are menus, so they wear VS Code's menu tokens over the opaque page.
  background: chromeSurface(MENU_BG),
  border: `1px solid ${MENU_BORDER}`,
  color: MENU_FG,
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

/** A message strip's icon button: one codicon, its own 16px square, with
 the toolbar's hover wash (`data-ptw-baritem`). */
export const PILL_BTN: CSSProperties = {
  ...BARE_BTN,
  width: 16,
  height: 16,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: CHROME_RADIUS,
  background: "var(--ptw-bar-item-bg, transparent)",
};

/* THE STATUS BAND (2026-10-04) — one full-width band docked on the frame's
bottom edge, VS Code's status bar, with a HOLE PUNCHED at its right end for the
infoview's own "Restart File" button.

That button is the host's: `<vscode-button class="restart-file-button">`,
`position: fixed; bottom: 10px; right: 10px` (vscode-lean4's `index.css`),
13px system-ui at `line-height: 22px`, `padding: 1px 13px`, a 1px border —
MEASURED in code-server 2026-10-04 (Linux, dpr 2): 26.0 tall, 100.6 wide
(95 in the macOS UI font), right 10, bottom 10, radius 2. Being `fixed`, it
hangs over the bottom right of the WEBVIEW VIEWPORT, which is where the frame
ends (widget.tsx sizes it to the viewport's bottom).

While a view is mounted the band MOVES that button down into itself
(`HOST_BUTTON_CSS`, `bottom/right: BAND_PAD`): docked where it stood, the band
would have to be 10 + 26 + 2 = 38 tall to surround it, and the owner asked for
"as close as we can get to the height of the Restart File button while still
surrounding it". The band then MEASURES the button (`fit`), never assumes it:
its slot is the button's left edge to the frame's right plus `BAND_SLOT_GAP`,
and the button row is as tall as the frame's bottom to the button's top plus
`BAND_PAD` — 2 + 26 + 2 = 30, plus the 1px top border. Where no button exists
(the static viewer, the harness without `?host-button`) the band runs edge to
edge, `BAR_H` tall, with no slot. */

/** The clearance the band keeps round the host button (and the button's own
 inset once the band has moved it). */
export const BAND_PAD = 2;

/** The gap between the band's last item and the host button's slot. */
export const BAND_SLOT_GAP = 6;

/** The band's top border: its one edge, VS Code's `statusBar.border`. */
export const BAND_BORDER = 1;

/** The rule that sets the host's button into the band: injected while a view
 is mounted (statusBar.tsx), removed with the last one, and REWRITTEN by `fit`
 so the button stands `BAND_PAD` inside the frame's corner (the infoview pads
 its content, so the viewport's corner is not the frame's). The button keeps
 its own size, ink and behaviour — only its inset changes. */
export const HOST_BUTTON_CSS = `.restart-file-button{bottom:${BAND_PAD}px !important;right:${BAND_PAD}px !important}`;

/** The zoom rail's corner: `RAIL_INSET` from the frame's right edge, and
 `RAIL_GAP` above the band (or above an open message strip). */
export const RAIL_INSET = 4;

export const RAIL_GAP = 8;

/** The gap between the band's top and the message strip's bottom. */
export const DIAG_STRIP_GAP = 4;

// One row of the band without the host button: VS Code's status bar, 22.
// The SECOND row (a pane too thin for the all-glyph row beside the slot) is
// this tall too. See BAR_ITEM_H for why every height here is fixed.
export const BAR_H = 22;

// The gap between items, and the band's own side padding.
export const STATUS_GAP = 4;

export const STATUS_PAD_X = 6;

/** The least room kept between the band's two groups, so the left group's
 last item and the right group's first never touch. `fit` counts it. */
export const BAR_GROUP_GAP = 2 * STATUS_GAP;

/* ONE HEIGHT. Every band row is a fixed height and every item a fixed
`BAR_ITEM_H`, never a minimum and never a line box — because the row's content
changes FONT: Context's compact glyphs are drawn in the tree's code font at
their own `glyphPx` (up to 19 for `▸`), so an item sized by its line box grew and shrank
as the row compacted and as `used` was swapped for `narrate`. A status bar that
changes height when you change a setting is the report this rule answers.

So height comes only from these numbers: an 18px item centred in a `BAR_H`
row (the button row: the host button's measured height plus `BAND_PAD` each
side). Vertical padding on the item is therefore ZERO — the
height and `alignItems: center` do that work — and every glyph sits inside a
fixed-size box (`GlyphBox`) so no font size can reach the layout at all.
`borderRadius` is `CHROME_RADIUS`: items are FLAT, like VS Code's own status-bar
items (2026-10-02; they were `BAR_ITEM_H / 2` pills, and the focus ring followed
the pill — a fat squircle on a flat strip). */
export const BAR_ITEM_H = 18;

// The item's side padding: VS Code's status-bar item's `0 5px` (2026-10-04;
// it came down 10 → 8 → 6 to buy row width before that).
const BAR_ITEM_PAD_X = 5;

export const BAR_ITEM: CSSProperties = {
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
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

// Every glyph in the bar — a codicon (16px, the size they are drawn for), or
// Context's compact mark in the code font — is painted inside a box of FIXED
// size, so its font, its size and its own ink can never reach the item's box.
// That is what makes both promises hold at once: ONE HEIGHT (the box is
// `BAR_ITEM_H` tall whatever is in it) and a STABLE WIDTH (swapping `▸` for
// `λ` moves nothing).
export const GLYPH_BOX_W = 16;

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

/* TWO ROW LOOKS, ONE PER KIND OF ROW (2026-09-22). A `pick` row is one of a
set — Layout's four, Context's four, Comments' four — and wears the `●/○`
radio; a `toggle` row turns ONE thing on or off independently of its
neighbours (the reading options, the two mark lists, the modifiers below a
divider) and wears the infoview's check-menu mark (codicon `check` when on,
nothing when off, 2026-10-04); an `action` row does something once and wears
neither. The look is what tells "pick one" from "turn on" before the reader
has clicked anything. */
export type BarRowKind = "pick" | "toggle" | "action";

/* THE MARKS ARE CODICONS (2026-10-04). They were drawn SVG at one shared
chrome stroke (and, before that, Unicode in the code font at a per-mark
`glyphPx` levelled by ink height); every mark in the chrome is now VS Code's
own codicon at 16px, levelled by design, so the levelling code went with the
drawn copies. See codiconView.tsx. */

/** The goal corner's hit height (the hit width is `CORNER_W`, the top
 line's reserve): the fold chevron's target is the rect, not the ink. */
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
  /** Something in this item's panel is ON (non-default): the value, or the
   glyph, wears the band's emphasis ink (`--ptw-statusbar-on`) and the tip
   names what is on. It replaced the dot (2026-10-04). Paint only. */
  on?: boolean;
  onAlt?: () => void;
  /** Controls drawn immediately AFTER this item's button, inside the same
   inline group — the tour's `‹ ›`. They ride both of `valueMenu`'s forms, so
   the ghost measures them with the item and the compaction stays honest. */
  after?: ReactNode;
}

/** The status READOUT's facts (statusBar.tsx / `StatusReadout`): the
declaration's name (already clipped to `STATUS_NAME_MAX`; empty where the
signature header is drawn, which already says it, or where the view has none), the proof's tactic count on the BASE tree, how many goals are
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
