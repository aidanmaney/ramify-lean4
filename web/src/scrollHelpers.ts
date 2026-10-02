// Scroll, zoom and edit-overlay helpers the tree view shares: the clamps, the eased
// follow animation, in-view scroll targets and the node-box constants the in-place editor reads.
import { type CSSProperties } from "react";
import {
  LINE_H,
  NODE_FONT_PX,
  NODE_PAD,
  NODE_PAD_Y,
  inkExtent,
  getCodeFontFamily,
  isGhostNode,
} from "./layout";
import type { LayoutNode, PlacedNode, TreeNode } from "./types";
import { NODE_STYLES } from "./theme";

export const MARGIN = { top: 80, right: 90, bottom: 40, left: 90 };

export const COMPACT_LEFT = 16;

const ZOOM_MIN = 0.05;

const ZOOM_MAX = 2;

export const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

export const clampScroll = (v: number, max: number) => Math.max(0, Math.min(max, v));

const FOLLOW_MS = 130;

// The accented box's stroke width. An SVG stroke is CENTRED on the rect edge,
// and the node being edited IS accented (the first click of the double-click
// seeds clickAccent), so the drawn outline's outer edge sits at rect ±
// EDIT_STROKE/2. The overlay's 2px border COINCIDES with that outline, which
// is why the foreignObject is expanded by half a stroke on every side.
export const EDIT_STROKE = 2;

/** A node box's corner radius: a tactic is the tighter card, a goal the
 rounder one. Read by the box and by the in-place editor laid over it (which
 grows it by `EDIT_STROKE / 2`) — one number, so the two cannot drift. */
export const nodeRx = (type: string | undefined) => (type === "tactic" ? 4 : 6);

// The node box's own fill, resolved from the very data the <rect> draws from —
// ONE coding, so an overlay standing in for a box cannot paint a different
// colour than the box it replaced.
export function nodeBoxFill(d: LayoutNode): string {
  return isGhostNode(d) ||
    d.recovered === "failed" ||
    d.recovered === "skipped" ||
    d.traceLeaf
    ? "transparent"
    : (NODE_STYLES[d.type] ?? NODE_STYLES.default).fill;
}

export const editOverlayLayer = (zIndex: number): CSSProperties => ({
  position: "absolute",
  inset: 0,
  zIndex,
  overflow: "hidden",
  pointerEvents: "none",
  boxSizing: "border-box",
  // PADDING ALONE carries the text inset, measured from the RECT edge: the
  // layer's own edge sits EDIT_STROKE/2 outside the rect, so the padding is
  // NODE_PAD + EDIT_STROKE/2 across and NODE_PAD_Y + EDIT_STROKE/2 down, and
  // the first glyph lands where the label's first glyph was. The outline is
  // NOT a CSS border: Chrome snaps border widths to whole DEVICE pixels, and
  // the infoview runs at fractional ratios (retina 2 × editor zoom 1.2 = 2.4,
  // measured: a 2px border computed to 1.667px), so a border-plus-padding
  // inset drifted the text a third of a pixel up and left on double-click.
  // The textarea paints its outline as an inset box-shadow, which is paint
  // only. Every layer here (mirror, abbreviation underline) and the textarea
  // itself must carry the SAME padding, or the caret drifts off the paint.
  padding: `${NODE_PAD_Y + EDIT_STROKE / 2}px ${NODE_PAD + EDIT_STROKE / 2}px`,
  border: 0,
  fontFamily: getCodeFontFamily(),
  fontSize: NODE_FONT_PX,
  lineHeight: `${LINE_H}px`,
  letterSpacing: 0,
  whiteSpace: "pre",
  textAlign: "left",
  textRendering: "auto",
  unicodeBidi: "normal",
});

export function inViewScroll(
  el: HTMLElement,
  node: PlacedNode,
  zoom: number,
  padX: number,
  padY: number,
  compact: boolean,
  park?: number,
): { left: number; top: number } {
  const cx = (MARGIN.left + padX + node.x) * zoom;
  const cy = (MARGIN.top + padY + node.y) * zoom;
  const halfW = (node.data.w / 2) * zoom;

  const ink = inkExtent(node.data);
  const inkTop = cy - ink.up * zoom;
  const inkBot = cy + ink.down * zoom;
  const pad = 32;
  const maxX = el.scrollWidth - el.clientWidth;
  const maxY = el.scrollHeight - el.clientHeight;
  let left = el.scrollLeft;
  let top = el.scrollTop;
  const inkMid = (inkTop + inkBot) / 2;
  if (park !== undefined)
    top = clampScroll(inkMid - el.clientHeight * park, maxY);
  else if (
    inkTop < el.scrollTop + pad ||
    inkBot > el.scrollTop + el.clientHeight - pad
  )
    top = clampScroll(inkMid - el.clientHeight / 2, maxY);
  if (compact) {
    const leftEdge = cx - halfW;
    if (
      leftEdge < el.scrollLeft + pad ||
      leftEdge > el.scrollLeft + el.clientWidth - pad
    )
      left = clampScroll(leftEdge - COMPACT_LEFT * zoom, maxX);
  } else if (
    cx - halfW < el.scrollLeft + pad ||
    cx + halfW > el.scrollLeft + el.clientWidth - pad
  ) {
    left = clampScroll(cx - el.clientWidth / 2, maxX);
  }
  return { left, top };
}

export type FollowAnim = {
  raf: number | null;
  timer: number | null;
  tgt: { left: number; top: number } | null;
};

/** Drop an in-flight `animateScroll` without landing it. */
export function cancelFollow(anim: FollowAnim) {
  if (anim.raf !== null) cancelAnimationFrame(anim.raf);
  if (anim.timer !== null) window.clearTimeout(anim.timer);
  anim.raf = null;
  anim.timer = null;
  anim.tgt = null;
}

/** The reader asked their system for no motion: eased scrolls jump instead. */
function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function animateScroll(
  anim: FollowAnim,
  el: HTMLElement,
  left: number,
  top: number,
) {
  if (
    (anim.raf !== null || anim.timer !== null) &&
    anim.tgt !== null &&
    anim.tgt.left === left &&
    anim.tgt.top === top
  )
    return;
  cancelFollow(anim);
  anim.tgt = { left, top };
  const x0 = el.scrollLeft;
  const y0 = el.scrollTop;
  const dx = left - x0;
  const dy = top - y0;
  const land = () => {
    anim.raf = null;
    anim.timer = null;
    anim.tgt = null;
    el.scrollLeft = left;
    el.scrollTop = top;
  };
  if (
    Math.abs(dy) > el.clientHeight ||
    Math.abs(dx) > el.clientWidth ||
    prefersReducedMotion()
  ) {
    land();
    return;
  }
  const t0 = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - t0) / FOLLOW_MS);

    const e = 1 - (1 - t) ** 3;
    el.scrollLeft = x0 + dx * e;
    el.scrollTop = y0 + dy * e;
    anim.raf = t < 1 ? requestAnimationFrame(step) : null;
  };
  anim.raf = requestAnimationFrame(step);
  anim.timer = window.setTimeout(() => {
    if (anim.raf !== null) cancelAnimationFrame(anim.raf);
    land();
  }, FOLLOW_MS + 60);
}

export function cfStubNodeId(
  ns: readonly TreeNode[],
  stub: { line: number; pos?: { line: number; character: number } },
): string | null {
  const at = stub.pos;
  const exact =
    at &&
    ns.find(
      (n) =>
        n.type === "tactic" &&
        n.label === "sorry" &&
        n.position &&
        n.position.start.line === at.line &&
        n.position.start.character === at.character,
    );
  const pn =
    exact ??
    ns.find(
      (n) =>
        n.type === "tactic" &&
        n.position &&
        n.position.start.line === stub.line,
    );
  return pn?.id ?? null;
}
