// The document edit behind a `calc` chip. Pure (an AddSpec + the typed text in,
// an LSP range + replacement out) and in its own module rather than inline in
// widget.tsx, so an offline probe can run the REAL edit math and then elaborate
// the result — the only way to know an insertion actually attached to the link
// it was offered for.

import type { ProofStepPosition } from "./paperproof";
import type { AddSpec } from "./types";

export interface DocEdit {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
  /** Which `sorry` in `newText` the two-part flow fills next (1-based). See
  STUB: every generated link is justified by one, and the second half of the
  gesture types over the one belonging to the link whose right-hand side the
  author just supplied. Absent when the edit generates none. */
  fillNth?: number;
}

/** How every GENERATED calc link is justified.
 *
 * `by sorry`, never a `?_` hole, and the difference is not cosmetic. A hole
 * leaves an unsolved goal — an ERROR — for as long as the chain is
 * unfinished, so a half-written chain broke the file it was written in. A
 * `sorry` is a warning and a complete proof term: the block elaborates, the
 * proof below it keeps working, and what the author left unfinished is
 * exactly as unfinished as they meant it to be.
 *
 * `by sorry` rather than a bare term `sorry` because a term closes the goal
 * with NO node in the tree, while the tactic reaches it as an ordinary
 * editable `sorry` node (measured — `steps: ['sorry']` with a live
 * `tacticEdits` entry). That node IS the second half of the gesture: the
 * widget opens the in-place editor on it the moment it is drawn, and every
 * later revisit is an ordinary double-click. */
export const STUB = "by sorry";
/** The part of STUB an edit replaces — what `fillNth` counts and locates. */
const STUB_TACTIC = "sorry";

/** Absolute range of the `fillNth`-th `sorry` in an edit's replacement text,
so the caller can open the in-place editor on it. Exact in every shape used
here: a target on a LATER line than the anchor needs only the line count and
its own column, and the one target that shares the anchor's line (completing a
bare first step) sits at a real recorded column rather than the end-of-line
sentinel. */
export function fillRange(
  start: { line: number; character: number },
  newText: string,
  nth = 1,
): ProofStepPosition | null {
  let idx = -1;
  for (let i = 0; i < nth; i++) {
    idx = newText.indexOf(STUB_TACTIC, idx + 1);
    if (idx < 0) return null;
  }
  const before = newText.slice(0, idx);
  const breaks = before.split("\n").length - 1;
  const nl = before.lastIndexOf("\n");
  const at = {
    line: start.line + breaks,
    character: breaks === 0 ? start.character + idx : idx - nl - 1,
  };
  return {
    start: at,
    stop: { line: at.line, character: at.character + STUB_TACTIC.length },
  };
}

/** The edit a `hole` / `calc-link` spec commits, or null for the other kinds
(which insert a line at an anchor instead — see widget.tsx `addTactic`).

Both act on the hole's own range, which is what makes them exact:

- **hole** replaces the `?_` with `by <text>`, filling the link where it sits.
  `by`, not a bare term, so the redraw shows a real tactic node standing where
  the chip was (a term-mode `sorry` would close the goal with no node at all).
  This is the one calc form that still deals in holes, and deliberately: it
  does not WRITE one, it fills a `?_` the author wrote by hand.
- **calc-link** inserts a whole new link above this one, pushing it down. The
  text is the new link's RIGHT-HAND SIDE only — the rest of the link, `STUB`
  included, is assembled here. The link below keeps `_` as its LHS, so it
  picks up the new RHS and the chain still ends where the goal needs it to. */
/** The two-link skeleton that OPENS a chain on a goal that is a relation:
 *
 *     calc _ = <mid> := by sorry
 *     _ = _ := by sorry    (the caller's insertion path indents this)
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
  return `calc _ ${rel} ${mid} := ${STUB}\n_ ${next} _ := ${STUB}`;
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
      newText: `\n${pad}_ ${spec.rel} ${text} := ${STUB}\n${pad}_ ${spec.rel2 ?? spec.rel} _ := ${STUB}`,
      // The author supplied the FIRST link's right-hand side, so that is the
      // link they are thinking about and the one to fill next.
      fillNth: 1,
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
    const head = bare ? ` := ${STUB}` : "";
    const pad = " ".repeat(spec.chain.indent);
    // A relation OTHER than the one the chain still owes cannot close it on
    // its own, so it appends TWO links: one to the intermediate expression
    // (`text`, the only thing that can't be inferred) and one from there to
    // the goal's own RHS, whose `_` endpoints Lean unifies as always.
    // `text` is the new link's right-hand side; `_` (the prefilled answer)
    // closes the chain against the goal, which is what this gesture meant
    // before it asked at all.
    const rhs = text.trim() === "" ? "_" : text.trim();
    const newText =
      head +
      (spec.rel2 && spec.rel2 !== spec.rel
        ? `\n${pad}_ ${spec.rel} ${rhs} := ${STUB}\n${pad}_ ${spec.rel2} _ := ${STUB}`
        : `\n${pad}_ ${spec.rel} ${rhs} := ${STUB}`);
    return {
      range: { start: at, end: at },
      newText,
      // Past the head, when completing a bare first step wrote one first: the
      // link the author just gave a right-hand side is the one to fill.
      fillNth: bare ? 2 : 1,
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
    newText: `${" ".repeat(h.linkStart.character)}_ ${spec.rel ?? "="} ${
      body.trim() === "" ? "_" : body.trim()
    } := ${STUB}\n`,
    fillNth: 1,
  };
}
