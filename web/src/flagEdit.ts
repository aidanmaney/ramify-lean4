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
import { FLAG_RE } from "./proofToTree";
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
tactic (the ◌/⊘ declines).

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

/** Split a raw comment (delimiters included) into its delimiter prefix, the
directive words parseFlags would consume, and the rest. Mirrors parseFlags'
scan — first line only, stop at the first non-flag word — via the same
exported FLAG_RE. */
function splitDirectives(
  raw: string,
): { prefix: string; flagsEnd: number } | null {
  // Delimiter + following whitespace. `/--` is a docstring — never a flag
  // carrier worth editing.
  const m = /^(--\s*|\/-[-!]?\s*)/.exec(raw);
  if (!m) return null;
  const prefix = m[1];
  const head = raw.slice(prefix.length).split("\n")[0];
  let consumed = 0;
  let sawFlag = false;
  const re = /\S+\s*/g;
  for (let w = re.exec(head); w; w = re.exec(head)) {
    if (!FLAG_RE.test(w[0].trim())) break;
    sawFlag = true;
    consumed = re.lastIndex;
  }
  return sawFlag ? { prefix, flagsEnd: prefix.length + consumed } : null;
}

/** Removal patches for every directive comment a node carries.

Two shapes per comment, decided by what parseFlags leaves behind:
- flags-only → the whole comment goes. When its LINE holds nothing else (no
  slot's range touches that line — a lexical test the wire can answer), the
  patch takes the entire line including its newline; otherwise just the
  comment's own range (a trailing `-- .fold` after code leaves the code).
- flags + prose → only the directive words go; the prose stays and becomes an
  ordinary comment strip.

Patches come back bottom-up, ready to apply sequentially. */
export function removeFlagPatches(
  node: TreeNode,
  comments: SourceComment[],
  slots: TacticSlot[],
): DocPatch[] {
  const out: DocPatch[] = [];
  for (const range of node.flagRanges ?? []) {
    const c = comments.find(
      (x) =>
        x.start.line === range.start.line &&
        x.start.character === range.start.character,
    );
    if (!c) continue;
    const split = splitDirectives(c.text);
    if (!split) continue;
    // Anything after the directive words on the first line, or any later
    // line, is prose to keep.
    const rest = c.text.slice(split.flagsEnd);
    if (rest.trim() !== "" && !/^-\/\s*$/.test(rest.trim())) {
      // Strip just the flag words: keep the delimiter, drop through to the
      // prose. (Block comments keep their closing `-/` because it lives in
      // `rest`.)
      out.push({
        start: {
          line: c.start.line,
          character: c.start.character + split.prefix.length,
        },
        stop: {
          line: c.start.line,
          character: c.start.character + split.flagsEnd,
        },
        text: "",
      });
    } else {
      // Flags-only: the comment goes. Whole line iff no tactic shares it.
      const lines = new Set<number>();
      for (const s of slots)
        for (let l = s.start.line; l <= s.stop.line; l++) lines.add(l);
      const alone =
        c.start.line === c.stop.line && !lines.has(c.start.line);
      out.push(
        alone
          ? {
              start: { line: c.start.line, character: 0 },
              stop: { line: c.start.line + 1, character: 0 },
              text: "",
            }
          : { start: c.start, stop: c.stop, text: "" },
      );
    }
  }
  return out.sort((a, b) => cmp(b.start, a.start));
}
