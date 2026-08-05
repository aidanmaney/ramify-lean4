// How a node is matched to ITSELF across a relayout — the identity the scroll
// anchor rests on (`ProofTreeView`'s `[nodes]` effect), and it must be a SOURCE
// fact. Its own module, and pure, so an offline probe can run the REAL matcher
// over two harvested proofs rather than a re-implementation of it.
//
// A node's `id` is an mvarId, i.e. an ELABORATION-ORDER artifact: re-elaboration
// renumbers every metavariable downstream of an edit, so an id-keyed anchor map
// misses precisely the nodes the edit affected — the ones it exists to hold
// still. Measured on `proofs/odd_sums.lean` by harvesting, commenting out one
// tactic line and re-harvesting: commenting `intro m` near the top matched only
// **8 of 69** nodes by id, against 69 of 69 keyed on source position. With no
// candidate below the edit the anchor pinned an unmoved node above the viewport
// and computed a zero shift, so the content in view slid out from under the
// reader — measured in the preview at 1224–2006px of drift (up to ~3 viewport
// heights), and 0 once keyed on position. That is the scroll-on-comment-toggle
// bug: a `--` toggle moves columns on ONE line and no line numbers at all, so
// position survives it exactly. For an insertion, position is never worse than
// the id — both miss below the edit and both hit above it.
//
// Nodes can legitimately SHARE a position (a tactic's `goalsAfter` all carry
// their producer's range), so a running ordinal disambiguates; `nodes` is DFS
// preorder, so it is stable across relayouts. A node with no position at all
// falls back to the id — root goals only, whose span is the theorem statement
// rather than any tactic's, and one node per proof in the corpus.

// ---------------------------------------------------------------------------
// There are TWO identity questions here, and one key cannot answer both.
//
//   "is this the same PLACE on screen?"  — the scroll anchor, `cursorChainRef`.
//       Answered by `layoutKeys` below: source position, because that is what
//       the reader's eye is resting on.
//   "is this the same NODE I folded?"    — `collapsed`, `focusId`, the sequence
//       endpoints, the gallery's picks, an elide cut's members.
//       Answered by `pathKeys`: the node's place in the TREE.
//
// Position is wrong for the second: inserting a line anywhere above moves every
// position below it, so a position-keyed fold set would be thrown away by an
// edit higher in the file. The mvarId was wrong for it in the other direction —
// re-elaboration renumbers, so an edit in a DIFFERENT THEOREM silently emptied
// the fold set, the focus, the sequence and every elide cut, because not one
// stored id resolved any more. A path is invariant to both and changes exactly
// when the tree's shape changes, which is exactly when that state should be
// reconsidered.
// ---------------------------------------------------------------------------

import type { PlacedNode } from "./types";

/** What `pathKeys` needs of a node: its id and its parents, in DFS preorder. */
export interface PathNode {
  id: string;
  parents: { id: string }[];
}

/** Each node's position in the TREE, as the chain of child indices from its
root (`"0.2.1"`).
 *
 * `nodes` must be DFS preorder, which `proofToTree` guarantees, so a parent is
 * always assigned before its children and sibling order is source order.
 * Multi-parent nodes (an elide marker can have several) take their FIRST
 * parent; markers are re-derived per layout anyway, so nothing durable hangs
 * off that choice.
 *
 * Deliberately carries NO discriminator from the node's own text. Adding one
 * would make retyping a tactic look like a different tree and drop the folds
 * below it — the opposite of what this is for. */
export function pathKeys(nodes: readonly PathNode[]): Map<string, string> {
  const parentOf = new Map<string, string | null>();
  const ordinal = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const n of nodes) {
    const p = n.parents[0]?.id ?? null;
    parentOf.set(n.id, p);
    const bucket = p ?? "";
    const i = seen.get(bucket) ?? 0;
    ordinal.set(n.id, i);
    seen.set(bucket, i + 1);
  }
  const memo = new Map<string, string>();
  const keyOf = (id: string): string => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    const p = parentOf.get(id) ?? null;
    const own = String(ordinal.get(id) ?? 0);
    const key = p !== null && parentOf.has(p) ? `${keyOf(p)}.${own}` : own;
    memo.set(id, key);
    return key;
  };
  const out = new Map<string, string>();
  for (const n of nodes) out.set(n.id, keyOf(n.id));
  return out;
}

/** Old node id → new node id across a re-parse, matched by tree position.
 *
 * This is what lets view state survive re-elaboration. An id that has no
 * counterpart is simply absent, and the caller's existing liveness filter
 * drops it. */
export function remapIds(
  before: readonly PathNode[],
  after: readonly PathNode[],
): Map<string, string> {
  const oldKeys = pathKeys(before);
  const newById = pathKeys(after);
  const byKey = new Map<string, string>();
  for (const [id, key] of newById) if (!byKey.has(key)) byKey.set(key, id);
  const out = new Map<string, string>();
  for (const [id, key] of oldKeys) {
    const to = byKey.get(key);
    if (to !== undefined) out.set(id, to);
  }
  return out;
}

export interface LayoutKey {
  /** Source-derived, and the one to prefer. Null for a node with no position. */
  posKey: string | null;
  /** Elaboration-derived fallback. */
  idKey: string;
}

export function layoutKeys(nodes: PlacedNode[]): Map<string, LayoutKey> {
  const seen = new Map<string, number>();
  const out = new Map<string, LayoutKey>();
  for (const n of nodes) {
    const p = n.data.position?.start;
    let posKey: string | null = null;
    if (p) {
      const base = `P${p.line}:${p.character}`;
      const ord = seen.get(base) ?? 0;
      seen.set(base, ord + 1);
      posKey = `${base}#${ord}`;
    }
    out.set(n.data.id, { posKey, idKey: `I${n.data.id}` });
  }
  return out;
}
