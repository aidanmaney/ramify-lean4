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
