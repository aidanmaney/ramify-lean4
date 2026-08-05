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
  /** Offsets INTO `newText` of the two `_` endpoints this edit left open, when
  it wrote a link with both ends free. The caller turns them into absolute
  ranges (`offsetToPosition`) and walks the author through them — left side,
  then right side — before handing over to the `sorry`. Absent when the edit
  fixed both ends itself. */
  stages?: {
    lhs: { at: number; len: number };
    rhs: { at: number; len: number };
  };
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
  return offsetToPosition(start, newText, idx, STUB_TACTIC.length);
}

/** Absolute range of `[at, at+len)` characters of `newText`, given where that
text was inserted. The arithmetic `fillRange` has always done, factored out so
the staged `_` endpoints use the very same rule: a target on a LATER line than
the anchor needs only the line count and its own column, and one sharing the
anchor's line offsets from the anchor's column. */
export function offsetToPosition(
  start: { line: number; character: number },
  newText: string,
  at: number,
  len: number,
): ProofStepPosition {
  const before = newText.slice(0, at);
  const breaks = before.split("\n").length - 1;
  const nl = before.lastIndexOf("\n");
  const pos = {
    line: start.line + breaks,
    character: breaks === 0 ? start.character + at : at - nl - 1,
  };
  return { start: pos, stop: { line: pos.line, character: pos.character + len } };
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
/** The ONE link that opens a chain on a goal that is a relation:
 *
 *     calc _ <rel> _ := by sorry
 *
 * One line, like every gesture here — no gesture ever inserts more than one.
 * Both ends are `_`: Lean solves them by unifying the chain against the goal,
 * so the text contains no pretty-printed term and nothing in it can fail to
 * round-trip back into source. The staged fill then replaces each underscore
 * in place (LHS, then RHS), and Enter on either keeps the `_`.
 *
 * This used to write a TWO-link skeleton with the author's expression as the
 * midpoint, on the belief that a one-link `calc` never parses. Read out of the
 * v4.27 grammar (Init/NotationExtra.lean, Lean/Parser/Basic.lean), the real
 * rule is narrower: `calcSteps` anchors its subsequent-step `withPosition`
 * ONCE, at the first token after the last written link, so with one link
 * `colGe` compares that token's column against itself and always passes — the
 * parser then tries to read the follower as a term, and `manyAux` fails hard
 * if that consumes anything. So a one-link block parses cleanly exactly when
 * the follower cannot begin a term (end of block, `|`, a command keyword, a
 * closer) and breaks before a sibling `·` or an ordinary tactic (tactic heads
 * lex as identifiers). That transient break is the same state hand-writing a
 * chain top-down passes through, and the tree already draws it — the broken
 * block gets a synthesized node and a repair chip that appends the next link.
 * Do not "fix" it by writing a second link: putting a relation in the source
 * the author did not choose is the worse failure. */
export function calcOpenText(rel: string): string {
  return CALC_KW + calcLinkText(rel);
}

/** The `_` that stands for an endpoint the staged fill replaces. */
export const PLACEHOLDER = "_";
const CALC_KW = "calc ";

/** One link with both ends open: `_ <rel> _ := by sorry`. Shared by the OPEN
gesture (which prefixes `calc `) and by the bare-keyword repair (which puts it
on its own line under the `calc`), so the two cannot drift in shape — and so
one slot calculation serves both. */
export function calcLinkText(rel: string): string {
  return `${PLACEHOLDER} ${rel} ${PLACEHOLDER} := ${STUB}`;
}

/** Where the fillable pieces of `calcLinkText(rel)` sit, as character offsets
from the start of the link (add `CALC_KW.length` for the open form — that is
what `lead` is for). Computed STRUCTURALLY from the same pieces that build the
text rather than by searching it for `_`: a relation symbol may itself contain
an underscore, and a search would then land on the wrong one. */
export function calcLinkSlots(
  rel: string,
  lead = 0,
): {
  lhs: { at: number; len: number };
  rhs: { at: number; len: number };
  stub: { at: number; len: number };
} {
  const lhs = lead;
  const rhs = lhs + PLACEHOLDER.length + 1 + rel.length + 1;
  const stub =
    rhs + PLACEHOLDER.length + " := ".length + (STUB.length - STUB_TACTIC.length);
  return {
    lhs: { at: lhs, len: PLACEHOLDER.length },
    rhs: { at: rhs, len: PLACEHOLDER.length },
    stub: { at: stub, len: STUB_TACTIC.length },
  };
}

/** The open form's slots — the link's, shifted past the `calc ` keyword. */
export function calcOpenSlots(rel: string) {
  return calcLinkSlots(rel, CALC_KW.length);
}

export function calcEdit(spec: AddSpec, text: string): DocEdit | null {
  // Append a last link to a chain that stopped short (see AddSpec.chain). The
  // anchor is the END of the final link's line, so a trailing comment stays
  // glued to the link it annotates; the huge character value is clamped by the
  // editor, which is how every insertion here reaches an unknown line length.
  // A `calc` keyword with no link at all: write its first link under it. ONE
  // link, both ends `_`, like every other gesture — the staged fill then
  // replaces the underscores in place. It used to write two, to hand the
  // parser back a `colGe` anchor; the block may therefore stay unparsed until
  // a second gesture grows it, which is exactly the state it was already in
  // and which the repair chip keeps offering to move on from.
  if (spec.kind === "calc-first" && spec.chain) {
    const at = { line: spec.chain.lastLink.line, character: 1e5 };
    const pad = " ".repeat(spec.chain.indent);
    const rel = spec.rel ?? "=";
    const lead = 1 + pad.length; // the leading newline, then the indent
    const slots = calcLinkSlots(rel, lead);
    return {
      range: { start: at, end: at },
      newText: `\n${pad}${calcLinkText(rel)}`,
      fillNth: 1,
      stages: { lhs: slots.lhs, rhs: slots.rhs },
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
    // ONE link, in the relation that was picked and no other. It used to
    // append a second, closing link whenever the pick was not the relation the
    // chain still owes — `= then ≤` wrote `_ = b := by sorry` AND
    // `_ ≤ _ := by sorry` — on the reasoning that a chain left short is
    // broken. Measured, that reasoning is wrong: a chain that stopped short is
    // ALREADY `unsolved goals` (that residue is the very goal this chip hangs
    // off), so appending one link moves it from `⊢ b ≤ d` to `⊢ c ≤ d` and
    // introduces no error that was not already there. What the closing link
    // actually did was finish the chain on the author's behalf, in a relation
    // they did not choose and could not see coming.
    //
    // The two picks now mean two clearly different things, which is what makes
    // the relation worth picking at all: the relation the chain OWES closes it
    // (one link, both ends `_`, so Enter alone is still the whole gesture),
    // and any other relation adds a step and leaves the chain open for the
    // next one. `text` is the new link's right-hand side either way.
    const rhs = text.trim() === "" ? "_" : text.trim();
    const newText = head + `\n${pad}_ ${spec.rel} ${rhs} := ${STUB}`;
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
  const inner = " ".repeat(h.ownerStart.character + 2);
  const body = text
    .split("\n")
    .map((l, i) => (i === 0 ? l : inner + l))
    .join("\n");
  if (spec.kind === "hole")
    return { range: { start: h.start, end: h.stop }, newText: `by ${body}` };
  const at = { line: h.ownerStart.line, character: 0 };
  return {
    range: { start: at, end: at },
    newText: `${" ".repeat(h.ownerStart.character)}_ ${spec.rel ?? "="} ${
      body.trim() === "" ? "_" : body.trim()
    } := ${STUB}\n`,
    fillNth: 1,
  };
}
