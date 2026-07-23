// On-demand elision of a set of nodes, collapsing them to a single marker the
// tree flows through. Two kinds of cut share one mechanism:
//
// - **path** (the rail's ⇥, reverse of linearize): a picked ancestor→descendant
//   path — the goal-structural cut.
// - **band** (the rail's ⇳): every node whose VERTICAL position falls between
//   two picked nodes in the compact outline — a purely spatial cut, computed
//   from post-layout `.y` at pick time and frozen as an explicit id set. It can
//   span several branches, so its marker may have several parents/children.
//
// It is a pure TreeNode[] → TreeNode[] transform run BEFORE the layout engine
// (like proofToTree's `brief`), so it reuses every bit of layout, folding and
// rendering: the collapsed nodes simply aren't in the tree the engine sees, and
// a single marker node stands in their place. Every edge that pointed INTO the
// cut set is re-parented onto the marker, so nothing below is orphaned.

import type { ParentEdge, TreeNode } from "./types";

export type ElideCut =
  | { kind: "path"; from: string; to: string } // ancestor→descendant path
  | { kind: "band"; ids: string[] }; // explicit id set (a vertical band)

/** Stable marker id for a cut — also the key removal matches on. `»`/`·` can't
occur in an mvarId. */
export function cutId(cut: ElideCut): string {
  return cut.kind === "path"
    ? `elide:${cut.from}»${cut.to}`
    : `elide-band:${[...cut.ids].sort().join("·")}`;
}

/** The node path from ancestor `from` down to descendant `to` (inclusive), or
null if `from` is not an ancestor of `to`. Proof trees are trees, so we walk
single parents up from `to`. Mirrors the engine's own `pathBetween`. */
export function pathIds(
  byId: Map<string, TreeNode>,
  from: string,
  to: string,
): string[] | null {
  const path: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = to;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    if (cur === from) return path.reverse();
    cur = byId.get(cur)?.parents[0]?.id;
  }
  return null;
}

/** The base-node ids a cut collapses, or [] when it no longer resolves (a path
whose endpoints/lineage vanished, or a band with no live members). */
export function resolveCut(
  cut: ElideCut,
  byId: Map<string, TreeNode>,
): string[] {
  if (cut.kind === "path") return pathIds(byId, cut.from, cut.to) ?? [];
  return cut.ids.filter((id) => byId.has(id));
}

/** Drop cuts that no longer resolve to anything (after an edit). Returns the
same array reference when nothing changed. */
export function pruneCuts(nodes: TreeNode[], cuts: ElideCut[]): ElideCut[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const live = cuts.filter((c) => resolveCut(c, byId).length > 0);
  return live.length === cuts.length ? cuts : live;
}

/** Collapse each cut's node-set into one synthetic marker node. Non-overlapping
cuts compose; a marker can even be another cut's parent (chained elisions),
resolved through the `markerOf` remap. */
export function applyElisions(nodes: TreeNode[], cuts: ElideCut[]): TreeNode[] {
  if (cuts.length === 0) return nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const index = new Map(nodes.map((n, i) => [n.id, i]));

  // Every node inside SOME cut → that cut's marker id. `slotOf` is the index of
  // each marker's TOPMOST member, so the marker is emitted in that node's slot
  // (preserving DFS-preorder position, so compact ordering is unchanged).
  const markerOf = new Map<string, string>();
  const info = new Map<string, { ids: string[]; tactics: string[] }>();
  const slotOf = new Map<string, number>();
  for (const cut of cuts) {
    const ids = resolveCut(cut, byId);
    if (ids.length === 0) continue;
    const mid = cutId(cut);
    if (info.has(mid)) continue; // dedupe identical cuts
    let top = Infinity;
    for (const id of ids) {
      markerOf.set(id, mid);
      top = Math.min(top, index.get(id) ?? Infinity);
    }
    const tactics = ids
      .map((id) => byId.get(id)!)
      .filter((n) => n.type === "tactic")
      .map((n) => n.label);
    info.set(mid, { ids, tactics });
    slotOf.set(mid, top);
  }
  if (info.size === 0) return nodes;

  // Remap a parent edge onto the marker that swallowed it, dropping duplicates
  // and any edge that would point a node at itself (a parent inside the same
  // cut, or a marker whose own parent remapped back into its set).
  const remap = (edges: ParentEdge[], selfId: string): ParentEdge[] => {
    const out: ParentEdge[] = [];
    const seen = new Set<string>();
    for (const e of edges) {
      const id = markerOf.get(e.id) ?? e.id;
      if (id === selfId || seen.has(id)) continue;
      seen.add(id);
      out.push({ id });
    }
    return out;
  };

  const out: TreeNode[] = [];
  for (const n of nodes) {
    const mid = markerOf.get(n.id);
    if (mid) {
      // A node inside a cut: emit the marker once, in the set's topmost slot.
      if (index.get(n.id) === slotOf.get(mid)) {
        const { ids, tactics } = info.get(mid)!;
        // The marker's parents are every edge ENTERING the set from outside —
        // the union over all members (a path yields `from`'s parents; a band
        // may yield several, i.e. a multi-parent marker, which the trunk layout
        // tolerates).
        const parents = remap(
          ids.flatMap((id) => byId.get(id)!.parents),
          mid,
        );
        out.push({
          id: mid,
          type: "tactic",
          // Sized/measured like any label; the view restyles it as a chip.
          label: `⋯ ${tactics.length} ${tactics.length === 1 ? "tactic" : "tactics"}`,
          parents,
          elidedCut: { tactics },
        });
      }
      continue; // the cut's own nodes are gone
    }
    out.push({ ...n, parents: remap(n.parents, n.id) });
  }
  return out;
}
