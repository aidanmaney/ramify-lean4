// Where the selection's pill (fold / skip / hide + flag) stands: the pure
// half (the component that keeps it inside the frame is selectionPill.tsx).
// PAINT ONLY — the pill reserves nothing and nothing here is measured by the
// layout.
//
// It used to hang over the selection's top edge, which is exactly where the
// box ABOVE the selection lives: it clipped that box's last line, or
// straddled the link between them. The rule now is that it never covers a
// node: beside the selection's top-right first, else under its bottom, else
// (only where both are taken) the old place above — and, among candidates
// that all cover something, the one covering least.

export interface PillRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Clear air between the selection and its pill. */
export const PILL_GAP = 10;
/** Slack added to every node box before it is tested: a pill whose shadow
 just grazes a box still reads as covering it. */
const PILL_CLEAR = 2;

const overlapArea = (a: PillRect, b: PillRect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** The pill's candidate top-left corners, best first: those covering no node
 in rule order (right of the selection's top-right, below its bottom, above
 its top), then the rest by how little they cover. `sel` is the selection's
 bounding box, `boxes` every drawn node's box. */
export function pillCandidates(
  sel: PillRect,
  size: { w: number; h: number },
  boxes: PillRect[],
): { x: number; y: number }[] {
  const raw = [
    { x: sel.x + sel.w + PILL_GAP, y: sel.y },
    { x: sel.x, y: sel.y + sel.h + PILL_GAP },
    { x: sel.x, y: sel.y - size.h - PILL_GAP },
  ];
  const scored = raw.map((c, order) => {
    const r = { x: c.x, y: c.y, w: size.w, h: size.h };
    let area = 0;
    for (const b of boxes)
      area += overlapArea(r, {
        x: b.x - PILL_CLEAR,
        y: b.y - PILL_CLEAR,
        w: b.w + 2 * PILL_CLEAR,
        h: b.h + 2 * PILL_CLEAR,
      });
    return { c, order, area };
  });
  scored.sort(
    (a, b) =>
      Number(a.area > 0) - Number(b.area > 0) ||
      (a.area > 0 && b.area > 0 ? a.area - b.area : 0) ||
      a.order - b.order,
  );
  return scored.map((s) => s.c);
}

