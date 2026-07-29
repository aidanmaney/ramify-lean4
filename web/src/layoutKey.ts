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

import type { PlacedNode } from "./types";

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
