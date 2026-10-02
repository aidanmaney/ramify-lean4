// The frontier chips' shared measures: lane height and gap, the base chip width and font, and the width
// of a chip for a given glyph. Read by the chips themselves and by the tree's own chip lane.
import { CHIP_LANE_H, measureText } from "./layout";

export const CHIP_H = CHIP_LANE_H;

export const CHIP_GAP = 6;

export const CHIP_W_ADD = 20;

export const CHIP_FONT_PX = 10;

const CHIP_PAD_X = 6;

export const chipWidth = (glyph: string, fontPx: number) =>
  Math.max(CHIP_W_ADD, measureText(glyph, fontPx) + 2 * CHIP_PAD_X);
