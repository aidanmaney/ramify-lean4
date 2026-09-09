import type { SourceComment, TacticSlot } from "./paperproof";
import type { TreeNode } from "./types";

export interface DocPatch {
  start: { line: number; character: number };
  stop: { line: number; character: number };
  text: string;
}

type Pos = { line: number; character: number };

const cmp = (a: Pos, b: Pos) =>
  a.line !== b.line ? a.line - b.line : a.character - b.character;

export function headTactics(
  nodes: TreeNode[],
  selected: Set<string>,
  slots: TacticSlot[],
): TreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const producerOf = (n: TreeNode): string | null => {
    const goal = n.parents[0] && byId.get(n.parents[0].id);
    return goal?.parents[0]?.id ?? null;
  };
  const heads = nodes.filter((n) => {
    if (n.type !== "tactic" || !selected.has(n.id)) return false;
    if (n.synthetic || n.recovered || n.elidedCut || !n.position) return false;
    const prod = producerOf(n);
    return !(prod && selected.has(prod));
  });
  const out: TreeNode[] = [];
  for (const h of heads) {
    const slot = slotAt(slots, h.position!.start);

    const first =
      (slot &&
        nodes.find(
          (n) =>
            n.type === "tactic" &&
            !n.synthetic &&
            !n.recovered &&
            n.position != null &&
            cmp(slot.start, n.position.start) <= 0 &&
            cmp(n.position.start, slot.stop) < 0,
        )) ||
      h;
    if (!out.includes(first)) out.push(first);
  }
  return out;
}

export function slotAt(
  slots: TacticSlot[],
  pos: Pos,
): TacticSlot | null {
  let best: TacticSlot | null = null;
  for (const s of slots)
    if (cmp(s.start, pos) <= 0 && cmp(pos, s.stop) < 0)
      if (!best || cmp(s.start, best.start) > 0) best = s;
  return best;
}

export function flagLine(
  node: TreeNode,
  slots: TacticSlot[],
  directive: string,
): DocPatch | null {
  if (!node.position) return null;
  const slot = slotAt(slots, node.position.start);
  if (!slot || !slot.lineStart || slot.prevSameLine) return null;

  const at = { line: slot.start.line, character: 0 };
  return {
    start: at,
    stop: at,
    text: `${" ".repeat(slot.start.character)}-- ${directive}\n`,
  };
}

export function usedHypNames(goal: TreeNode): string[] {
  return (goal.hyps ?? [])
    .filter((h) => h.used && !h.cont)
    .flatMap((h) => h.text.split(" : ")[0].trim().split(/\s+/))
    .filter((n) => n && n !== "⊢" && !n.includes("✝"));
}

export function removeCommentPatch(
  c: { start: Pos; stop: Pos },
  slots: TacticSlot[],
): DocPatch {
  let endpointOnLines = false;
  for (const s of slots)
    for (let l = c.start.line; l <= c.stop.line; l++)
      if (s.start.line === l || s.stop.line === l) endpointOnLines = true;
  let next: TacticSlot | null = null;
  for (const s of slots)
    if (cmp(c.stop, s.start) <= 0 && (!next || cmp(s.start, next.start) < 0))
      next = s;
  const atSlotColumn = !!next && next.start.character === c.start.character;
  return endpointOnLines || !atSlotColumn
    ? { start: c.start, stop: c.stop, text: "" }
    : {
        start: { line: c.start.line, character: 0 },
        stop: { line: c.stop.line + 1, character: 0 },
        text: "",
      };
}

export function removeFlagPatches(
  node: TreeNode,
  comments: SourceComment[],
  slots: TacticSlot[],
): DocPatch[] {
  const out: DocPatch[] = [];
  const seen = new Set<number>();
  for (const range of node.flagRanges ?? []) {
    const c = comments.find(
      (x) =>
        x.start.line === range.start.line &&
        x.start.character === range.start.character,
    );
    if (!c) continue;
    if (seen.has(c.start.line)) continue;
    seen.add(c.start.line);
    out.push(removeCommentPatch(c, slots));
  }
  return out.sort((a, b) => cmp(b.start, a.start));
}
