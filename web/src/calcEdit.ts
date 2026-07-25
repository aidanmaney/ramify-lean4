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
/** The two-link skeleton that OPENS a chain on a goal that is a relation:
 *
 *     calc _ = <mid> := ?_
 *     _ = _ := ?_          (the caller's insertion path indents this)
 *
 * Both endpoints are `_`, which is the whole point: Lean solves them by
 * unifying the chain against the goal, so the skeleton needs no
 * pretty-printed terms — nothing here can fail to round-trip back into source.
 * Measured: `_` works as the first link's LHS and as the last link's RHS, for
 * `=` and `≤` alike, and the resulting goals print concretely (`a + 0 = a`,
 * `a = c`) rather than showing metavariables.
 *
 * The midpoint is the one thing that CANNOT be inferred — only the author
 * knows where the chain should go through — so it is what the overlay asks
 * for. Two links rather than one because a lone link is a `calcFirstStep`,
 * which nothing can be inserted above: the second link is what the `step`
 * chip then grows against, so the chain builds forward from the LHS. */
export function calcSkeleton(rel: string, mid: string): string {
  return `calc _ ${rel} ${mid} := ?_\n_ ${rel} _ := ?_`;
}

export function calcEdit(spec: AddSpec, text: string): DocEdit | null {
  // Append a last link to a chain that stopped short (see AddSpec.chain). The
  // anchor is the END of the final link's line, so a trailing comment stays
  // glued to the link it annotates; the huge character value is clamped by the
  // editor, which is how every insertion here reaches an unknown line length.
  if (spec.kind === "calc-append" && spec.chain) {
    const at = { line: spec.chain.lastLink.line, character: 1e5 };
    return {
      range: { start: at, end: at },
      newText: `\n${" ".repeat(spec.chain.indent)}_ ${spec.rel} _ := ?_`,
    };
  }
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
