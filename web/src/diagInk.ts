// The three diagnostic severities' ink and glyph (error, warning, lint), shared by the tree's ribbons and
// the status bar's diagnostics item.
import { DANGER_FILL, WARN_FILL } from "./theme";

/** D4 — the THREE severities' ink, glyph and word, in one table: an error, a
 warning, and a LINT. A lint is not a problem with the proof — the proof
 checks — so it wears the comment ink and a note's mark rather than a colour
 that says something is wrong. `word` is for a node's `<title>`: the ribbon's
 colour and pattern say the severity to the eye, this says it to everyone
 else. */
export type Severity = 1 | 2 | 3;
export const DIAG: Record<Severity, { ink: string; glyph: string; word: string }> = {
  1: { ink: DANGER_FILL, glyph: "⨯", word: "Error" },
  2: { ink: WARN_FILL, glyph: "⚠", word: "Warning" },
  3: { ink: "var(--ptw-comment)", glyph: "◇", word: "Lint" },
};

export const diagInkOf = (sev: Severity): string => DIAG[sev].ink;
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
