// The WRITE direction of the Alectryon/LeanInk comment flags — pure document
// patches for the selection pill's flag verbs, mirroring the read pipeline
// (proofToTree's parseFlags/attributeComments) it must round-trip through.
//
// Pure and wire-driven, the calcEdit/deleteEdit precedent: everything here is
// computed from data BOTH wires carry (TacticSlot, SourceComment, TreeNode),
// so an offline probe can patch a corpus source, re-run the real reader and
// assert the flag lands on the intended node — no widget in the loop. The
// view applies patches through the ordinary edit hook (a replace whose range
// may be empty, i.e. an insertion).
//
// The one rule that keeps every insertion attributable: a flag comment goes on
// its OWN LINE directly above the tactic it governs, indented to the tactic's
// own column. attributeComments then lands it by rule 1-inner (inside a
// structured container, the next step at/after the comment) or rule 3
// (leading comment → next step), both of which resolve to the very tactic
// below — the shape the flags fixture exercises. A trailing-comment write
// (`simp -- .fold`) is deliberately not offered: containment would attribute
// it to whichever step's inflated range swallows it, which for the LAST
// tactic of a block is the container, not the tactic.

import type { SourceComment, TacticSlot } from "./paperproof";
import type { TreeNode } from "./types";

/** One document patch: replace `[start, stop)` with `text`. `start === stop`
is an insertion. Patches for one gesture are returned sorted BOTTOM-UP
(descending position), so applying them one applyEdit at a time keeps every
later patch's coordinates valid — an insertion shifts only the lines below
it. */
export interface DocPatch {
  start: { line: number; character: number };
  stop: { line: number; character: number };
  text: string;
}

type Pos = { line: number; character: number };

const cmp = (a: Pos, b: Pos) =>
  a.line !== b.line ? a.line - b.line : a.character - b.character;

/** The selection's HEAD tactics — selected tactics whose producing tactic is
not itself selected. The unit the subtree-shaped flags act on: a ragged
marquee normalizes to its heads, one flag each, accepting subtree granularity
(a flag governs a tactic's whole output; refusing ragged selections would be
the worse trade). Returned in DFS preorder. Markers, combined nodes and
synthetic/recovered tactics are excluded — they stand for no single as-written
tactic (the ⬚/⊘ declines).

A head is then normalized to the FIRST node of its SLOT. One as-written
tactic can be several nodes — Paperproof splits `rw [a, b, c]` into one step
per rule — and they share a slot, so there is exactly one line above which a
flag can go and it governs the whole tactic. Selecting only the `b` node
therefore flags the `rw`; the returned head must be that same node, or the
caller's local view effect would fold a different subtree than the written
flag folds on the next load. */
export function headTactics(
  nodes: TreeNode[],
  selected: Set<string>,
  slots: TacticSlot[],
): TreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const producerOf = (n: TreeNode): string | null => {
    // tactic's parent is the goal it consumes; that goal's parent is the
    // producing tactic.
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
    // DFS preorder, so the first node found inside a slot is that tactic's
    // first step — the one a comment written above the slot attaches to.
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

/** The innermost as-written slot containing a position — the tactic line the
flag comment goes above. Innermost, because a bullet is itself a slot whose
range contains every slot inside it, and the flag belongs above the tactic,
not above the `·`. */
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

/** The patch writing one flag comment above a tactic node, or null when the
write is DECLINED: no slot resolves the node; the tactic does not START its
own line (`!lineStart` — a bullet's or case's first tactic, `:= by tac`,
`intro n; simp`'s tail: a comment above the LINE then precedes the midline
structure and mis-attributes — measured on `| zero => simp`, where the
comment landed on the enclosing `induction`, whose truncated range swallowed
it); or a sibling block ends on the tactic's own line (`prevSameLine`, the
deleteEdit decline). Refuse rather than guess, both times.

`directive` is the comment's whole payload after `--` (e.g. `.fold`,
`.none up to commutativity`, `.no-hyps`, `.h#hn .h#hp`, or plain prose for an
annotation). */
export function flagLine(
  node: TreeNode,
  slots: TacticSlot[],
  directive: string,
): DocPatch | null {
  if (!node.position) return null;
  const slot = slotAt(slots, node.position.start);
  if (!slot || !slot.lineStart || slot.prevSameLine) return null;
  // A step whose start is not its slot's — a split `rw`, which records the
  // RULE inside the brackets — used to be declined here as well, because
  // attributeComments then read the comment as trailing the tactic ABOVE.
  // That was a reader bug, and it is fixed at the reader (attributeComments
  // now bounds its inner search by the SLOT start), so these heads are
  // writable: the flag lands on the `rw`. A multi-rule `rw` shares one slot,
  // so the comment attaches to the first of its nodes, which is the one the
  // marquee's head normalization picks.
  const at = { line: slot.start.line, character: 0 };
  return {
    start: at,
    stop: at,
    text: `${" ".repeat(slot.start.character)}-- ${directive}\n`,
  };
}

/** Hypothesis names a `.h#name` pin can honestly write for a goal: the head
names of its `used`-flagged context lines. Continuation fragments carry no
name; a bundle (`a b : ℝ`) names several; anything with `✝` is dropped — an
inaccessible name cannot round-trip into source (the completion filter's
rule). */
export function usedHypNames(goal: TreeNode): string[] {
  return (goal.hyps ?? [])
    .filter((h) => h.used && !h.cont)
    .flatMap((h) => h.text.split(" : ")[0].trim().split(/\s+/))
    .filter((n) => n && n !== "⊢" && !n.includes("✝"));
}

/** The whole-line deletion patch for a comment, or the comment's own range
when the line cannot be proven comment-only. Two tests, both lexical facts the
wire can answer, and only their CONJUNCTION is safe:

- **No slot STARTS or STOPS on any of the comment's lines.** A slot start is a
  `·` bullet or code opening on the line (`· -- .fold`); a slot stop is code
  ending there (`simp -- .fold`, a trailing comment — slot stops are TIGHT).
  Mere CONTAINMENT does not veto: a bullet's or `induction … with`'s slot
  spans every interior line, comment-only ones included, and testing spans
  vetoed nearly every own-line flag in the corpus (measured: 9 of 11).
- **The comment sits at the COLUMN of the next slot below it** — exactly the
  shape `flagLine` writes (own line, the governed tactic's indent), so removal
  accepts what the writer produces. This is what protects a `| zero => -- x`
  case-marker line: no slot starts or stops there (the marker is interior to
  the `induction` slot), but the trailing comment's column is nowhere near the
  case body's, so it keeps only its own range and the marker survives.

Covers multi-line block comments (`stop.line > start.line`). Shared by the
`unflag` verb and the comment editor's empty commit. */
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

/** Removal patches for every directive comment a node carries.

The comment's WHOLE LINE goes, prose included — `unflag` means "this comment
is done", not "keep the sentence but forget it was a directive" (the old
behaviour, which left `-- why` residue behind and was reversed by user
directive). The only narrowing is `removeCommentPatch`'s slot-line veto: a
comment sharing a line with code loses only its own range.

Patches come back bottom-up and deduped by start line — two selected nodes
whose flag comments share a line must not both emit a whole-line patch
(`applyPatches` applies each against the original document; the duplicate's
coordinates would be stale). */
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
