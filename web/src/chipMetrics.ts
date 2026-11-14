// The chips' shared measures: a pill chip's height and gap, the base chip width and font, the width
// of a chip for a given glyph, and the FRONTIER lane's own (an open goal's next-step slot and the
// chips beside it). Read by the chips themselves and by the tree's own chip lane.
import { CHIP_LANE_H, measureText } from "./layout";

/** A chip inside a pill (armed delete, proposal, selection, picker). */
export const CHIP_H = 15;

/** A chip in the FRONTIER lane under an open goal: the lane's whole height,
 so the next-step slot stands as tall as the lane layout reserves for it. */
export const FRONTIER_H = CHIP_LANE_H;
export const FRONTIER_FONT_PX = 11;
/** The next-step slot: an EMPTY tactic box with a caret in it, so its width
 is a short tactic's, not a label's (it carries no words). */
export const SLOT_PAD_X = 9;
export const slotWidth = () => 96;

export const CHIP_GAP = 6;

export const CHIP_W_ADD = 20;

export const CHIP_FONT_PX = 10;

const CHIP_PAD_X = 6;

export const chipWidth = (glyph: string, fontPx: number) =>
  Math.max(CHIP_W_ADD, measureText(glyph, fontPx) + 2 * CHIP_PAD_X);
