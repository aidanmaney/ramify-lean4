// The node hover bar's measures: button size, its icon, padding, gap and overlap, and the inset that keeps
// it in the frame. Read by the bar itself (nodeBar.tsx — measurer and renderer) and by the tree's hit/paint
// code.

/** One button: VS Code's action-bar item, 22px square around a 16px codicon
 (2026-10-04; it was 20 around a 13px glyph, each levelled by ink). */
export const BAR_BTN = 22;

/** The codicon in a button: the size codicons are drawn for. */
export const BAR_ICON = 16;

export const BAR_PAD = 3;

export const BAR_GAP = 2;

export const BAR_OVERLAP = 5;

/** How far inside the visible frame a bar is kept when it would hang past an
 edge. */
export const BAR_FRAME_INSET = 4;
