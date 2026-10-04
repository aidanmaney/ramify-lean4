// The three diagnostic severities' ink, glyph and icon (error, warning, lint), shared by the tree's
// squiggles and the status bar's diagnostics item.
import { DANGER_FILL, DIM_OPACITY, INFO_FILL, WARN_FILL } from "./theme";
import { type CodiconName } from "./codicon";

/** D4 — the THREE severities' ink, glyph and word, in one table: an error, a
 warning, and a LINT. A lint is not a problem with the proof — the proof
 checks — so its squiggle wears the comment ink rather than a colour that says
 something is wrong, and its glyph is info's (`ⓘ`, the text form of the
 codicon the chrome draws; `◇` was a private mark). `word` is for a node's `<title>`: the ribbon's
 colour and pattern say the severity to the eye, this says it to everyone
 else. */
export type Severity = 1 | 2 | 3;
export const DIAG: Record<Severity, { ink: string; glyph: string; word: string }> = {
  1: { ink: DANGER_FILL, glyph: "⨯", word: "Error" },
  2: { ink: WARN_FILL, glyph: "⚠", word: "Warning" },
  3: { ink: "var(--ptw-comment)", glyph: "ⓘ", word: "Lint" },
};

export const diagInkOf = (sev: Severity): string => DIAG[sev].ink;

/** The severity's ICON in the chrome (the problems count, the message strip,
 a node's popover): the codicons the infoview and the Problems view draw, in
 the editor's severity inks — a lint is the `info` row at `DIM_OPACITY`, as
 the Problems view draws a hint. (The tree's squiggles keep `ink`.) */
export const DIAG_ICON: Record<
  Severity,
  { name: CodiconName; ink: string; opacity?: number }
> = {
  1: { name: "error", ink: DANGER_FILL },
  2: { name: "warning", ink: WARN_FILL },
  3: { name: "info", ink: INFO_FILL, opacity: DIM_OPACITY },
};
export const diagGlyphOf = (sev: Severity): string => DIAG[sev].glyph;
export const diagWordOf = (sev: Severity): string => DIAG[sev].word;

/** A diagnostic's squiggle (squiggle.tsx): VS Code's 6×3 tile, in the box's
 bottom padding; a lint's hint dots span `HINT_W`. */
export const SQUIGGLE_H = 3;
export const SQUIGGLE_TILE_W = 6;
const HINT_W = 11;

/** The width the mark takes under a span `width` wide (its hover target). */
export const squiggleHitW = (sev: Severity, width: number): number =>
  sev === 3 ? HINT_W : Math.max(SQUIGGLE_TILE_W, width);

// THE CLASSIC RIBBON (appearance.ts; restored from cffa2be^): a vertical
// stroke down the box's inner left edge, the diag strip's own 3px edge, 4 for
// the node the message strip is showing, a lint's thin 1.5. A warning is
// SOLID (2026-10-04): its old dashes on a one-line box read as "lumps" (the
// report that retired the ribbon), so the pattern no longer carries severity —
// the ink does, and an error alone runs the whole edge.
const RIBBON_W = 3;
const RIBBON_W_SEL = 4;
const RIBBON_W_LINT = 1.5;
/** Clear air between a mark tab's bottom edge and the ribbon that starts below it. */
export const RIBBON_TAB_GAP = 2;

export const ribbonWidth = (sev: Severity, selected: boolean): number =>
  sev === 3 ? RIBBON_W_LINT : selected ? RIBBON_W_SEL : RIBBON_W;

/** The ribbon's run on the straight part `[top, top + h]` of the box's inner
 left edge (`r` = the corner radius): an error over the whole run (the box
 clip rounds its ends); a warning and a lint over the straight run only,
 inset by `r`, so neither reads as sitting on the border. */
export const ribbonRunOf = (
  sev: Severity,
  top: number,
  h: number,
  r: number,
): { y1: number; y2: number } =>
  sev === 1
    ? { y1: top, y2: top + h }
    : { y1: top + r, y2: top + r + Math.max(0, h - 2 * r) };
