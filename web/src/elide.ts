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

import type { CombinedPart, ParentEdge, TreeNode } from "./types";

export type ElideCut =
  | { kind: "path"; from: string; to: string } // ancestor→descendant path
  | { kind: "band"; ids: string[] } // explicit id set (a vertical band)
  | { kind: "combine"; ids: string[] }; // a linear tactic run, shown stacked

/** Stable marker id for a cut — also the key removal matches on. `»`/`·` can't
occur in an mvarId. */
export function cutId(cut: ElideCut): string {
  return cut.kind === "path"
    ? `elide:${cut.from}»${cut.to}`
    : `${cut.kind === "combine" ? "combine" : "elide-band"}:${[...cut.ids].sort().join("·")}`;
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

/** Maximal linear tactic runs, each returned as a `combine` cut. A run is a
chain tactic → goal → tactic → … where every intermediate goal is a pass-through
(single parent, single child) and every step is single-parent/single-child, so
it has no branching to lose. The cut's id set is the tactics PLUS the pass-through
goals between them — the boundary goals (the one the first tactic consumes, the
one the last produces) stay visible, and the run collapses to one node showing
the tactics stacked. Only runs of ≥2 tactics are worth combining. `exclude` skips
nodes already claimed by a manual elide cut, keeping the two disjoint. */
export function combineRuns(
  nodes: TreeNode[],
  exclude?: Set<string>,
): ElideCut[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  for (const n of nodes)
    for (const p of n.parents)
      (children.get(p.id) ?? children.set(p.id, []).get(p.id)!).push(n.id);
  const soleChild = (id: string): string | null => {
    const c = children.get(id) ?? [];
    return c.length === 1 ? c[0] : null;
  };
  const soleParent = (id: string) => (byId.get(id)?.parents.length ?? 0) === 1;
  const blocked = (id: string) => exclude?.has(id) ?? false;

  const runs: ElideCut[] = [];
  const seen = new Set<string>();
  // Nodes are in DFS preorder, so a run's TOP tactic is met before any of its
  // continuations — which are marked `seen` and skipped as starts.
  for (const start of nodes) {
    if (start.type !== "tactic" || seen.has(start.id) || blocked(start.id))
      continue;
    const ids: string[] = [];
    let tacticCount = 0;
    let cur: string | null = start.id;
    while (cur && byId.get(cur)!.type === "tactic" && !blocked(cur)) {
      ids.push(cur);
      tacticCount++;
      seen.add(cur);
      const g = soleChild(cur); // the goal this tactic produced
      if (!g || byId.get(g)!.type !== "goal" || !soleParent(g)) break;
      const next = soleChild(g); // the tactic that consumes it
      if (!next || !soleParent(next) || byId.get(next)!.type !== "tactic")
        break;
      if (blocked(g) || blocked(next)) break;
      ids.push(g); // the pass-through goal joins the run
      cur = next;
    }
    if (tacticCount >= 2) runs.push({ kind: "combine", ids });
  }
  return runs;
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
  const info = new Map<
    string,
    {
      ids: string[];
      tactics: string[];
      parts: CombinedPart[];
      combine: boolean;
      chain: boolean;
    }
  >();
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
    const members = ids.map((id) => byId.get(id)!).filter((n) => n.type === "tactic");
    const parts = members.map((n) => ({
      label: n.label,
      position: n.position,
      elision: n.elision,
    }));
    const tactics = parts.map((p) => p.label);
    info.set(mid, {
      ids,
      tactics,
      parts,
      combine: cut.kind === "combine",
      // The marker inherits its members' outgoing edges, so it must inherit
      // the chain flag too or a `calc` swallowed by ⇉ loses its column. The
      // LAST tactic is the one that has them: a combine run is linear, so
      // every earlier member's children are inside the cut. (A band cut can
      // in principle have several members with escaping edges; taking the
      // last is a judgement call there, not an exact rule.)
      chain: members[members.length - 1]?.chain ?? false,
    });
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
        const { ids, tactics, parts, combine, chain } = info.get(mid)!;
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
          // A `combine` marker IS the run's tactics, stacked (the view draws it
          // as a normal tactic box); an elide marker is the `⋯ N tactics` chip.
          label: combine
            ? tactics.join("\n")
            : `⋯ ${tactics.length} ${tactics.length === 1 ? "tactic" : "tactics"}`,
          parents,
          chain,
          elidedCut: combine
            ? { tactics, combined: true, parts }
            : { tactics },
        });
      }
      continue; // the cut's own nodes are gone
    }
    out.push({ ...n, parents: remap(n.parents, n.id) });
  }
  return out;
}
