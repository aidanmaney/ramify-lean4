// The node hover bar's measures: button size, padding, gap and overlap, the two glyph sizes levelled by
// ink, and the inset that keeps it in the frame. Read by the bar itself and by the tree's hit/paint code.


export const BAR_BTN = 20;

export const BAR_PAD = 3;

export const BAR_GAP = 2;

export const BAR_OVERLAP = 5;

/** The path gesture's `⊹` is the one glyph in the hover bar that needs its own
size: at the shared 13 it inks 7x8 against `⧉`'s 10x9 and the drawn icons'
8-9 — the thinnest and narrowest mark in the row — and at 15 it inks 9x9,
inside 1px of every neighbour's ink height. Equal INK, not equal font size (`RailButton`'s
own rule). */
export const PATH_GLYPH_PX = 15;

/** `»` (reveal in source) is on EVERY default bar and was the smallest mark
in it: 6.0 × 5.9 px of ink at the shared 13px (canvas, 8× supersampled, the
bar's `monospace`) against `◎` 7.9, `⧉` 8.9 and the drawn icons' ~8.5. At 17 it
inks ~7.8 tall — the `⊹` rule (equal INK, not equal font size), applied to the
one default glyph it had not reached (2026-09-22 taste pass). */
export const SOURCE_GLYPH_PX = 17;

/** How far inside the visible frame a bar is kept when it would hang past an
 edge. */
export const BAR_FRAME_INSET = 4;
