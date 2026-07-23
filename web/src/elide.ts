// On-demand elision of a SERIES of nodes — the reverse of linearize. Linearize
// (`only` in layout.ts) keeps a picked ancestor→descendant path and hides the
// rest; this hides that path and keeps the rest, collapsing the run into one
// synthetic marker node the tree flows through.
//
// It is a pure TreeNode[] → TreeNode[] transform run BEFORE the layout engine
// (like proofToTree's `brief`), so it reuses every bit of layout, folding and
// rendering: the collapsed run simply isn't in the tree the engine sees, and a
// single marker node stands where it was. Whatever hung below the run (or off
// its interior) is re-parented onto the marker, so nothing is orphaned.

import type { ParentEdge, TreeNode } from "./types";

export interface ElideRun {
  from: string; // the ancestor endpoint (top of the run)
  to: string; // the descendant endpoint (bottom of the run)
}

/** Stable id for a run's marker node. `»` can't occur in an mvarId key. */
export function elideId(run: ElideRun): string {
  return `elide:${run.from}»${run.to}`;
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

/** Drop runs whose endpoints no longer name live nodes (after an edit), and
runs that no longer form a path — so a stale elision can never point at nothing.
Returns the same array reference when nothing changed. */
export function pruneRuns(nodes: TreeNode[], runs: ElideRun[]): ElideRun[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const live = runs.filter(
    (r) => byId.has(r.from) && byId.has(r.to) && pathIds(byId, r.from, r.to),
  );
  return live.length === runs.length ? runs : live;
}

/** Collapse each run's node-path into one synthetic marker node. Non-overlapping
runs compose; a marker can even be another run's parent (chained elisions),
resolved through the `markerOf` remap. */
export function applyElisions(nodes: TreeNode[], runs: ElideRun[]): TreeNode[] {
  if (runs.length === 0) return nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Every node that falls inside SOME run → that run's marker id. `fromOf` says
  // which marker is emitted in which node's slot (the run's `from`).
  const markerOf = new Map<string, string>();
  const info = new Map<string, { run: ElideRun; tactics: string[] }>();
  const fromOf = new Map<string, string>(); // markerId → its run's `from`
  for (const run of runs) {
    const ids = pathIds(byId, run.from, run.to);
    if (!ids) continue;
    const mid = elideId(run);
    if (info.has(mid)) continue; // dedupe identical runs
    for (const id of ids) markerOf.set(id, mid);
    const tactics = ids
      .map((id) => byId.get(id)!)
      .filter((n) => n.type === "tactic")
      .map((n) => n.label);
    info.set(mid, { run, tactics });
    fromOf.set(mid, run.from);
  }
  if (info.size === 0) return nodes;

  // Remap a parent edge onto the marker that swallowed it, dropping duplicates
  // and any edge that would point a node at itself (a marker whose own parent
  // remapped back into its run).
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
      // A node inside a run: emit the marker once, in the run's `from` slot
      // (preserving DFS-preorder position so compact ordering is unchanged).
      if (n.id === fromOf.get(mid)) {
        const { run, tactics } = info.get(mid)!;
        out.push({
          id: mid,
          type: "tactic",
          // Sized/measured like any label; the view restyles it as a chip.
          label: `⋯ ${tactics.length} ${tactics.length === 1 ? "tactic" : "tactics"}`,
          parents: remap(byId.get(run.from)!.parents, mid),
          elidedRun: { from: run.from, to: run.to, tactics },
        });
      }
      continue; // the run's own nodes are gone
    }
    out.push({ ...n, parents: remap(n.parents, n.id) });
  }
  return out;
}
