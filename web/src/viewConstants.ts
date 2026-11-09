// ProofTreeView's module-level constants and small helpers, split out of
// ProofTreeView.tsx (unchanged) so the pieces split out of the view can share
// them. Each one's comment says what it measures and why.
import { LINE_H } from "./layout";
import { GLOBAL_MAX } from "./completion";
import type { AddSpec } from "./types";
import { COMMENT_FILL } from "./theme";
import { CHIP_FONT_PX, CHIP_GAP, CHIP_W_ADD, chipWidth } from "./chipMetrics";
import { clipText } from "./clipText";
import { HOLE_GLYPH } from "./chipMoves";

export interface Anchor {
  id: string;
  key: string;
  x: number;
  y: number;
}

export const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

// A mode change confirms itself top-centre for this long, then vanishes.
// `window.setTimeout`, never rAF: a hidden webview fires no animation frames.
export const TOAST_MS = 1500;
/** How long the first half of a key chord (`${CMD}K`) waits for its second. */
export const CHORD_MS = 1000;
/** A toast that carries a button (Undo) stays long enough to reach it. */
export const TOAST_ACTION_MS = 6000;

export const errMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

export const TRACE_ASK_FAILED =
  "Could not ask Lean what this step used — the request failed; try again once the file finishes loading";

/** The first line of `s`, clipped to `n` characters with `…` where it was cut
 (never a bare slice, which stops mid-word and says nothing about it). */
export const clipLine = (s: string, n: number): string =>
  clipText((s.split("\n")[0] ?? "").trim(), n);

export const CARD_PAD = 4;

export const CHIP_W_SORRY = 36;

export const addChipWidth = (spec: AddSpec | undefined) =>
  spec?.kind === "hole" ? chipWidth(HOLE_GLYPH, CHIP_FONT_PX) : CHIP_W_ADD;

export const chipLaneXs = (
  spec: AddSpec | undefined,
): [number, number, number] => {
  const x0 = -CHIP_W_ADD / 2;
  const x1 = x0 + addChipWidth(spec) + CHIP_GAP;
  return [x0, x1, x1 + CHIP_W_SORRY + CHIP_GAP];
};
export const CHIP_W_STEP = 30;

export const CLOSE_RHS = "_";

/** The empty editor's placeholder (what Enter will do): italic comment ink. */
// While the frame scrolls, the tree takes no pointer events: boxes slide
// under a resting pointer during a pan, and each one entered ran the node's
// hover (a re-render for its bar) — Firefox also sends a synthetic mousemove
// per scroll step, whose handler reads two rects (a forced layout of the tree).
// Hit testing returns ~150ms after the last scroll, with one hover update.
export const SCROLLING_CSS = `[data-ptw-scrolling] > svg{pointer-events:none}`;
export const SCROLL_SETTLE_MS = 150;

export const HINT_CSS = `textarea[data-ptw-hint]::placeholder{color:${COMMENT_FILL};font-style:italic;opacity:1}`;

export const PILL_FONT_PX = 11;

export const FOLLOW_TOP_FRAC = 1 / 3;

export const GLOBAL_DEBOUNCE_MS = 160;

export const globalNameCache = new Map<string, string[]>();

export function cachedGlobals(ident: string): string[] | null {
  let best: { q: string; names: string[] } | null = null;
  for (const [q, names] of globalNameCache)
    if (
      ident.startsWith(q) &&
      (names.length < GLOBAL_MAX || q === ident) &&
      (best === null || q.length > best.q.length)
    )
      best = { q, names };
  return best?.names ?? null;
}

// How far the tour nub's invisible hit region reaches beyond the tab's own
// rect, on every side. Wide enough that a pointer travelling towards the
// corner from OUTSIDE the box crosses it (the tab straddles the corner, so
// half the region already lies outside), and small enough that inside the box
// it stops at the tab's own height — the first hyp line's text is not covered.
export const NUB_SLACK = 8;

export const FLOATER_H = 36;

// The signature header's height AT REST, as the header itself codes it: one
// `pre` line of `LINE_H`, 6px of padding above and below, and the 1px bottom
// border. Measured 29 in the harness, which is what this comes to. It is the
// floor under the measured `hdrH`, so nothing that reads the header's height —
// the rail's `floaterTop(0)` above all — can be told the header is 0 tall
// while one is drawn.
export const HDR_REST_H = LINE_H + 13;

// The header's `▾` (open the full signature): a fixed box at the band's right
// edge, and the right padding both header states keep clear for it. Drawn
// only where the resting line HIDES something (2026-09-22): where the whole
// signature fits, there is nothing to open and the lane goes back to the
// ordinary `HDR_PAD_X`. The box is the status bar's item height (20) — the
// hit target — and the mark inside it the codicon `chevron-down`/`-up`
// (2026-10-04; it was a drawn 8×5 chevron). The lane reserves the BOX, so the
// ink can change without touching the measure.
export const HDR_BTN_W = 20;
export const HDR_BTN_RIGHT = 6;
export const HDR_BTN_LANE = HDR_BTN_W + HDR_BTN_RIGHT + 8;
export const HDR_PAD_X = 10;
// The resting text's right-edge fade where it is wider than the band.
export const HDR_FADE =
  "linear-gradient(to right, #000 calc(100% - 24px), transparent)";

/** Screen px the zoom rail stands in at the frame's bottom right (its two
 groups and its gap above the band): the least padding below the last node,
 zoomed far out, so it can always be scrolled clear of the rail. */
export const RAIL_CLEAR = 140;

/** How far LEFT of both boxes the provenance connector's vertical run sits,
 so the elbow clears the node it leaves and the node it arrives at. */
export const ORIGIN_CHANNEL = 12;

/** The in-place editor's completion list: its largest box (the editor's
 foreignObject grows to hold it — Gecko clips what spills out). */
export const COMPLETION_MAX_W = 520;
export const COMPLETION_MAX_H = 168;
