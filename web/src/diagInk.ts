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

// The ribbon is the diag strip's own 3px edge (2026-09-28: at 4/8 it was the
// loudest thing on screen); the severity PATTERN carries the rest. A lint is a
// THIN solid line, half the error ribbon (dots read as list bullets beside
// the hypothesis lines).
const RIBBON_W = 3;
const RIBBON_W_SEL = 4;
const RIBBON_W_LINT = 1.5;
/** Clear air between a mark tab's bottom edge and the ribbon that starts below it. */
export const RIBBON_TAB_GAP = 2;

/** The ribbon's width: a lint's thin line whatever is picked, else 3px, 4 for
 the node the message strip is showing. */
export const ribbonWidth = (sev: Severity, selected: boolean): number =>
  sev === 3 ? RIBBON_W_LINT : selected ? RIBBON_W_SEL : RIBBON_W;

/** The ribbon's stroke geometry, given its width `rw` and the straight run
 `[top, top + h]` of the box's inner left edge (`r` = the corner radius).
 Severity without colour: an error is a THICK solid line over the whole run
 (the box clip rounds its ends); a warning is DASHES (6:3 at the 4px scale),
 centred and inset by the corner radius so the pattern starts and ends with a
 whole dash on the straight edge; a lint is a THIN solid line (`RIBBON_W_LINT`
 wide, chosen by the caller) over the straight run only, inset by `r` so it
 does not read as sitting on the border. No dots: they read as list bullets
 beside the hypothesis lines. */
export const ribbonStrokeOf = (
  sev: Severity,
  rw: number,
  top: number,
  h: number,
  r: number,
): { y1: number; y2: number; dash?: string } => {
  if (sev === 1) return { y1: top, y2: top + h };
  const run = Math.max(0, h - 2 * r);
  if (sev === 3) return { y1: top + r, y2: top + r + run };
  const mid = top + h / 2;
  const dash = (6 * rw) / 4;
  const gap = (3 * rw) / 4;
  const n = Math.max(1, Math.floor((run + gap) / (dash + gap)));
  const span = n * dash + (n - 1) * gap;
  const y0 = mid - span / 2;
  return { y1: y0, y2: y0 + span, dash: `${dash} ${gap}` };
};
