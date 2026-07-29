// The document edit behind the tree's delete gesture. Pure (a DeleteSpec plus
// the shipped slots in, an LSP range + replacement out) and in its own module
// rather than inline in widget.tsx, for the same reason as calcEdit.ts: an
// offline probe can run the REAL edit math and then elaborate the result, which
// is the only way to know a deletion took exactly the tactic it was offered for
// and not a neighbour.

import type { ProofStepPosition, TacticSlot } from "./paperproof";
import type { DeleteSpec } from "./types";
import type { DocEdit } from "./calcEdit";
// The one coding of "compare two LSP positions" in the web half; the cursor
// accent's own containment rules are built from it too.
import { posLE as le } from "./proofToTree";

/** The slot CONTAINING `p`, innermost (latest-starting) first.
 *
 * Closed at both ends, unlike the cursor accent's half-open rule, and it makes
 * no difference here: `p` is always a STEP's start, and the latest-starting
 * candidate wins — so even where a slot's `stop` coincides with the next
 * slot's `start`, the tie resolves to the later one either way. */
export function slotAt(
  slots: readonly TacticSlot[],
  p: ProofStepPosition["start"],
): TacticSlot | null {
  let best: TacticSlot | null = null;
  for (const s of slots)
    if (le(s.start, p) && le(p, s.stop))
      if (!best || le(best.start, s.start)) best = s;
  return best;
}

/** The slot of `block` that contains `p` — how a deep anchor is lifted to the
 * sibling level the extent is being measured at. A `by_cases` owns branches
 * that live in bullets, so the last step of a branch sits two blocks down; the
 * thing to remove is the BULLET, and this is what finds it. */
function slotInBlock(
  slots: readonly TacticSlot[],
  blockStart: TacticSlot["blockStart"],
  p: ProofStepPosition["start"],
): TacticSlot | null {
  for (const s of slots)
    if (
      s.blockStart.line === blockStart.line &&
      s.blockStart.character === blockStart.character &&
      le(s.start, p) &&
      le(p, s.stop)
    )
      return s;
  return null;
}

/** What the gesture will remove, or null when it declines.
 *
 * Resolved separately from `deleteEdit` because the ARMED state shows it: the
 * confirm chip counts the lines and the editor lights the region, so the user
 * sees the answer before committing to it. */
export interface DeleteExtent {
  start: ProofStepPosition["start"];
  stop: ProofStepPosition["start"];
  /** Removing this leaves its block with no tactic at all, so a `sorry` has to
   * stand in it or the file stops parsing. */
  empties: boolean;
  /** Whole-line removal is safe: nothing but whitespace before the start and
   * only trivia after the end. */
  wholeLine: boolean;
  lines: number;
}

export function deleteExtent(
  spec: DeleteSpec,
  slots: readonly TacticSlot[],
): DeleteExtent | null {
  if (slots.length === 0 || spec.anchors.length === 0) return null;
  const first = slotAt(slots, spec.anchors[0].start);
  if (!first) return null;
  // `intro n; simp` — a sibling shares the line, so whole lines are wrong and
  // an exact range leaves a stray `;`. Decline rather than guess: this is the
  // one destructive gesture here.
  if (first.prevSameLine) return null;

  // Every other anchor is lifted to a sibling of `first`, so the extent is
  // measured in ONE block. An anchor outside that block entirely (a spawned
  // goal restating something handled elsewhere — measured in factorization)
  // is dropped rather than allowed to inflate the extent.
  let lo = first;
  let hi = first;
  for (const a of spec.anchors.slice(1)) {
    const s = slotInBlock(slots, first.blockStart, a.start);
    if (!s) continue;
    if (le(s.start, lo.start)) lo = s;
    if (le(hi.stop, s.stop)) hi = s;
  }

  // A deletion that takes every child of the block leaves `by`/`·`/`| case =>`
  // with nothing under it, which does not parse.
  const empties = lo.index === 0 && hi.index === hi.count - 1;
  const wholeLine = lo.lineStart && hi.tailIsTrivia;

  // A comment on its own line above the extent belongs to the node being
  // removed (attributeComments gave it to that step, and the tree draws it in
  // that node's band), so it goes too — but only while the lines are
  // contiguous with the extent, walking upward.
  let start = lo.start;
  if (wholeLine && !empties) {
    // Two floors, and the second one is not obvious. Never reach the PREVIOUS
    // sibling's last line: a comment there is that tactic's trailing comment
    // and the line carries the tactic too. And for a block's FIRST child,
    // never reach above the block itself — measured on `proofs/calc.lean`,
    // `· -- Chain 1: …` puts the bullet marker and the comment on one line, and
    // that comment attributes to the `have` below it, so extending would have
    // deleted the `·` and left its branch bodiless.
    const prev = slots.find(
      (s) =>
        s.blockStart.line === lo.blockStart.line &&
        s.blockStart.character === lo.blockStart.character &&
        s.index === lo.index - 1,
    );
    const floor = prev ? prev.stop.line + 1 : lo.blockStart.line;
    const own = [...spec.comments].sort((a, b) => b.start.line - a.start.line);
    for (const c of own) {
      if (c.stop.line !== start.line - 1) break;
      if (c.start.line < floor) break;
      start = { line: c.start.line, character: 0 };
    }
  }

  const stop = hi.tailIsTrivia ? hi.tailStop : hi.stop;
  return {
    start,
    stop,
    empties,
    wholeLine,
    lines: stop.line - start.line + 1,
  };
}

/** The document edit for an extent.
 *
 * Three shapes, and which one applies is read off the slot rather than
 * guessed:
 *
 * - **empties** → replace with the literal `sorry`. No indent computation is
 *   needed: the extent starts at the block's FIRST tactic, so its column
 *   already is the block's indent, whether that is a fresh line
 *   (`| zero =>\n  sorry`) or the same one (`:= by sorry`). The `·` / `| case
 *   =>` marker is never inside the extent — a bullet is the PARENT slot and a
 *   case arm is interior to the `induction` — so it survives, which it must:
 *   dropping `| zero =>` is an "alternative not covered" error. The end runs
 *   to `tailStop`, so the stub does not inherit the dead tactic's trailing
 *   comment.
 * - **wholeLine** → take the lines outright, `[{start.line, 0}, {stop.line +
 *   1, 0})`. No blank line left behind, no orphaned indent.
 * - otherwise → the exact range. This is `· intro h` and `{ rfl }`, where
 *   whole lines would eat the bullet or the brace.
 */
export function deleteEdit(
  spec: DeleteSpec,
  slots: readonly TacticSlot[],
): DocEdit | null {
  const e = deleteExtent(spec, slots);
  if (!e) return null;
  if (e.empties)
    return { range: { start: e.start, end: e.stop }, newText: "sorry" };
  if (e.wholeLine)
    return {
      range: {
        start: { line: e.start.line, character: 0 },
        end: { line: e.stop.line + 1, character: 0 },
      },
      newText: "",
    };
  return { range: { start: e.start, end: e.stop }, newText: "" };
}
