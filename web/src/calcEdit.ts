// The document edit behind a `calc` chip. Pure (an AddSpec + the typed text in,
// an LSP range + replacement out) and in its own module rather than inline in
// widget.tsx, so an offline probe can run the REAL edit math and then elaborate
// the result — the only way to know an insertion actually attached to the link
// it was offered for.

import type { AddSpec } from "./types";

export interface DocEdit {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
}

/** The edit a `hole` / `calc-link` spec commits, or null for the other kinds
(which insert a line at an anchor instead — see widget.tsx `addTactic`).

Both act on the hole's own range, which is what makes them exact:

- **hole** replaces the `?_` with `by <text>`, filling the link where it sits.
  `by`, not a bare term, so the redraw shows a real tactic node standing where
  the chip was (a term-mode `sorry` would close the goal with no node at all).
- **calc-link** inserts a whole new link on the hole's line, pushing it down.
  The hole's link keeps `_` as its LHS, so it picks up the new link's RHS and
  the chain still ends where the goal needs it to. */
export function calcEdit(spec: AddSpec, text: string): DocEdit | null {
  const h = spec.hole;
  if (!h) return null;
  // Continuation lines of a multi-line entry sit one level inside the link —
  // the only indent derivable here (the widget never holds the document text).
  const inner = " ".repeat(h.linkStart.character + 2);
  const body = text
    .split("\n")
    .map((l, i) => (i === 0 ? l : inner + l))
    .join("\n");
  if (spec.kind === "hole")
    return { range: { start: h.start, end: h.stop }, newText: `by ${body}` };
  const at = { line: h.linkStart.line, character: 0 };
  return {
    range: { start: at, end: at },
    newText: " ".repeat(h.linkStart.character) + body + "\n",
  };
}
