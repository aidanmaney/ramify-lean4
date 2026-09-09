import type { ProofStepPosition, TacticSlot } from "./paperproof";
import type { DeleteSpec } from "./types";
import type { DocEdit } from "./calcEdit";

import { posLE as le } from "./proofToTree";

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

export interface DeleteExtent {
  start: ProofStepPosition["start"];
  stop: ProofStepPosition["start"];

  empties: boolean;

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

  if (first.prevSameLine) return null;

  let lo = first;
  let hi = first;
  for (const a of spec.anchors.slice(1)) {
    const s = slotInBlock(slots, first.blockStart, a.start);
    if (!s) continue;
    if (le(s.start, lo.start)) lo = s;
    if (le(hi.stop, s.stop)) hi = s;
  }

  const empties = lo.index === 0 && hi.index === hi.count - 1;
  const wholeLine = lo.lineStart && hi.tailIsTrivia;

  let start = lo.start;
  if (wholeLine && !empties) {
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
