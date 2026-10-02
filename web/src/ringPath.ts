// The keyboard ring's outline, and how it steps around a mark tab. PAINT ONLY.
//
// The ring is the box grown by `grow`. A mark tab straddles the box's top-left
// corner (`TourTab`: centred on the corner, `BADGE_H` tall, `tourTabWidth`
// wide), so the ring's corner ran under the tab and the tab's fill cut it. A
// node with a tab therefore draws the ring as an OPEN path: it starts on the
// left edge just below the tab, runs round the box and ends on the top edge
// just right of the tab, leaving the corner to the tab alone.
import { BADGE_H } from "./layout";

/** Clear air between the tab and either end of the open ring. */
export const RING_TAB_GAP = 2;

/** A rounded rect (`x0,y0`–`x1,y1`, corner radius `r`) as a path; with
 `tabRight` (the tab's right edge, same coordinates) the top-left corner is
 left open around the tab, whose centre sits at `(x0 + grow, y0 + grow)`. */
export function ringPath(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  tab?: { right: number; grow: number },
): string {
  if (!tab) {
    return `M${x0 + r},${y0}H${x1 - r}A${r},${r} 0 0 1 ${x1},${y0 + r}V${y1 - r}A${r},${r} 0 0 1 ${x1 - r},${y1}H${x0 + r}A${r},${r} 0 0 1 ${x0},${y1 - r}V${y0 + r}A${r},${r} 0 0 1 ${x0 + r},${y0}Z`;
  }
  const boxTop = y0 + tab.grow;
  const startY = Math.min(boxTop + BADGE_H / 2 + RING_TAB_GAP, y1 - r);
  const endX = Math.min(tab.right + RING_TAB_GAP, x1 - r);
  return `M${x0},${startY}V${y1 - r}A${r},${r} 0 0 0 ${x0 + r},${y1}H${x1 - r}A${r},${r} 0 0 0 ${x1},${y1 - r}V${y0 + r}A${r},${r} 0 0 0 ${x1 - r},${y0}H${endX}`;
}
