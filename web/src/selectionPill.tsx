// The selection pill's wrapper: places it (candidates from pillPlace.ts) and
// keeps it inside the frame. PAINT ONLY.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { BAR_FRAME_INSET } from "./hoverBarMetrics";

/** The pill's wrapper. Tries each candidate in turn and keeps the first that
 lies wholly inside the visible scroll frame (the `TipLayer` / hover-bar
 idiom: measured after mount, written straight onto the element as a
 transform — no state, no relayout, nothing a re-render resets); where none
 fits, the first is slid in as far as it must go. */
export function PillPlace({
  candidates,
  size,
  children,
}: {
  candidates: { x: number; y: number }[];
  size: { w: number; h: number };
  children: ReactNode;
}) {
  const gRef = useRef<SVGGElement | null>(null);
  useLayoutEffect(() => {
    const g = gRef.current;
    if (!g || candidates.length === 0) return;
    const frame = g.closest("[data-ptw-scroll]");
    const put = (c: { x: number; y: number }, dx = 0, dy = 0) =>
      g.setAttribute("transform", `translate(${c.x + dx},${c.y + dy})`);
    put(candidates[0]);
    if (!frame) return;
    const f = frame.getBoundingClientRect();
    const left = f.left + BAR_FRAME_INSET;
    const right = f.right - BAR_FRAME_INSET;
    const top = f.top + BAR_FRAME_INSET;
    const bottom = f.bottom - BAR_FRAME_INSET;
    for (const c of candidates) {
      put(c);
      const r = g.getBoundingClientRect();
      if (r.width === 0) return;
      if (r.left >= left && r.right <= right && r.top >= top && r.bottom <= bottom)
        return;
    }
    put(candidates[0]);
    const r = g.getBoundingClientRect();
    if (r.width === 0) return;
    const scale = r.width / size.w;
    let dx = 0;
    let dy = 0;
    if (r.right > right) dx = right - r.right;
    if (r.left + dx < left) dx = left - r.left;
    if (r.bottom > bottom) dy = bottom - r.bottom;
    if (r.top + dy < top) dy = top - r.top;
    put(candidates[0], dx / scale, dy / scale);
  });
  return (
    <g data-node="" ref={gRef}>
      {children}
    </g>
  );
}
