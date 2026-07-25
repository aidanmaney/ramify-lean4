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
export function calcSkeleton(rel: string, mid: string, next = rel): string {
  return `calc _ ${rel} ${mid} := ?_\n_ ${next} _ := ?_`;
}

export function calcEdit(spec: AddSpec, text: string): DocEdit | null {
  // Append a last link to a chain that stopped short (see AddSpec.chain). The
  // anchor is the END of the final link's line, so a trailing comment stays
  // glued to the link it annotates; the huge character value is clamped by the
  // editor, which is how every insertion here reaches an unknown line length.
  // A `calc` keyword with no link at all: write the first two, under it. Two
  // because the middle is what the author supplies and the outer ends are `_`
  // for Lean to unify — the same reason `calcSkeleton` opens with two.
  if (spec.kind === "calc-first" && spec.chain) {
    const at = { line: spec.chain.lastLink.line, character: 1e5 };
    const pad = " ".repeat(spec.chain.indent);
    return {
      range: { start: at, end: at },
      newText: `\n${pad}_ ${spec.rel} ${text} := ?_\n${pad}_ ${spec.rel2 ?? spec.rel} _ := ?_`,
    };
  }
  if (spec.kind === "calc-append" && spec.chain) {
    // A bare first step (`calc a ≤ b`, the `:=` not typed yet) is the chain's
    // starting EXPRESSION, so a link appended after it reads as `(a ≤ b) ≤ _`
    // and fails to synthesize `Trans`. Complete it first — and completing
    // ALONE is not enough either: the missing SUBSEQUENT step is what stops
    // the block parsing, so both halves go in one edit. All three ways
    // measured by elaborating them. This edit anchors at the link's own end
    // rather than end-of-line, the one case where a trailing comment ends up
    // on the new link instead of the old one.
    const bare = spec.chain.firstBare;
    const at = bare
      ? { ...spec.chain.lastLink }
      : { line: spec.chain.lastLink.line, character: 1e5 };
    const head = bare ? " := ?_" : "";
    const pad = " ".repeat(spec.chain.indent);
    // A relation OTHER than the one the chain still owes cannot close it on
    // its own, so it appends TWO links: one to the intermediate expression
    // (`text`, the only thing that can't be inferred) and one from there to
    // the goal's own RHS, whose `_` endpoints Lean unifies as always.
    const newText =
      head +
      (spec.rel2 && spec.rel2 !== spec.rel
        ? `\n${pad}_ ${spec.rel} ${text} := ?_\n${pad}_ ${spec.rel2} _ := ?_`
        : `\n${pad}_ ${spec.rel} _ := ?_`);
    return { range: { start: at, end: at }, newText };
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
