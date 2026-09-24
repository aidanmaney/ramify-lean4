/* BACKTICKS (2026-09-22). The UI strings name code the way the source does —
"What did `simp` use?", "Write a `.mark` into the source" — and until now the
ticks were drawn literally. ONE rule, here: where the surface can hold more
than one face (the `⋯` menu, the `?` panel) a `…` span is DRAWN as code
(`CodeText`, codeSpans.tsx: the editor's own face, a hair smaller so its
x-height sits with the UI face's, no chip); where it cannot (the in-page tip, a
native `<title>`, an `aria-label`, a proposal pill that is code font already)
the ticks are STRIPPED (`plainTicks`). A span is a pair on one line with
something between; a lone tick — a Lean name literal in quoted code — stays. */
const TICK_SPAN = /`([^`\n]+)`/g;

/** The text with every `…` span's ticks removed. */
export const plainTicks = (s: string): string => s.replace(TICK_SPAN, "$1");

/** Split into alternating prose / code runs (odd indices are code). */
export function tickRuns(s: string): string[] {
  const out: string[] = [];
  let last = 0;
  for (const m of s.matchAll(TICK_SPAN)) {
    out.push(s.slice(last, m.index), m[1]);
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(s.slice(last));
  return out;
}
