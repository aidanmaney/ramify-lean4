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
  // One tactic + the blocks it opened. `note` is the prose a `.none` source
  // flag wrote after its directive (see NodeFlags): a `.none` seeds exactly
  // this cut, so the author's own words stand in the ghost where a truncated
  // preview of the tactic otherwise would.
  | { kind: "step"; id: string; note?: string }
  | { kind: "combine"; ids: string[] }; // a linear tactic run, shown stacked

/** Stable marker id for a cut — also the key removal matches on. `»`/`·` can't
occur in an mvarId. */
export function cutId(cut: ElideCut): string {
  if (cut.kind === "path") return `elide:${cut.from}»${cut.to}`;
  if (cut.kind === "step") return `elide-step:${cut.id}`;
  return `${cut.kind === "combine" ? "combine" : "elide-band"}:${[...cut.ids].sort().join("·")}`;
}

/** parent id → its children, built once per sweep. The offer test runs over
every tactic in the tree, so the naive "filter all nodes per lookup" is an
O(n³) render. */
function childIndex(byId: Map<string, TreeNode>): Map<string, TreeNode[]> {
  const kids = new Map<string, TreeNode[]>();
  for (const n of byId.values())
    for (const p of n.parents)
      (kids.get(p.id) ?? kids.set(p.id, []).get(p.id)!).push(n);
  return kids;
}

/** The one child that CONTINUES the main line below a tactic, or null when
there isn't one. A cut with a continuation CLOSES THE TRUNK UP — the goal above
flows straight into that child; a cut without one takes the tactic's whole
subtree away and leaves the ghost as a leaf (see `stepIds`).

The other children are the blocks this tactic OPENED and is answerable for,
and they go with it. Which those are is read off the two semantic bits
proofToTree stamps where the wire still distinguishes them (both of which are
otherwise erased by `stepGoalsAfter`'s concatenation):

- `spawned` — a `have … := by`'s side proof. Its continuation is the rest of
  the main line, so any spawned child means the non-spawned ones continue.
- `side` — a conditional rewrite's generated obligation (see TreeNode.side).
  Same shape from the other direction: the obligation is the block, the main
  goal continues.
- Neither, with several children — a REAL case split (`by_cases`, `refine`).
  Its branches are peers with no main thread among them, so nothing continues.

Null is the common answer for a TERMINAL tactic, and it is not a refusal: an
`induction … with` arrives with every branch spawned and an empty `goalsAfter`
(measured — odd_sums' `induction m with` is `kids=2 spawned=2`), i.e. its
branches ARE the rest of that proof. There is no next goal because the proof
ends there, which is exactly when you most want the subtree put away.

Mirrors the ownership rule the delete gesture uses (spawned-first, else a
multi-way split), extended with `side` — which delete predates. */
export function continuationOf(
  byId: Map<string, TreeNode>,
  tacticId: string,
  idx: Map<string, TreeNode[]> = childIndex(byId),
): TreeNode | null {
  const kids = idx.get(tacticId) ?? [];
  if (kids.length === 0) return null; // a closing tactic: nothing follows it
  const rest = kids.some((k) => k.spawned)
    ? kids.filter((k) => !k.spawned)
    : kids.some((k) => k.side)
      ? kids.filter((k) => !k.side)
      : kids.length > 1
        ? [] // peers — no main line
        : kids;
  return rest.length === 1 ? rest[0] : null;
}

/** The nodes a STEP cut collapses: the tactic plus every descendant reachable
WITHOUT passing through its continuation — which, when there is no
continuation, is its whole subtree.

Empty means DECLINED, and the only thing declined is a tactic with no children
at all: the cut would then be the tactic's own box and nothing else, replacing
one small box with one small ghost. Everywhere else there is something to gain
— either the trunk closes up over the tactic, or a subtree you have finished
reading goes away — so the gesture is offered. `pruneCuts` reads the same
emptiness, so a cut whose tactic vanished (or lost its children) in an edit
drops through the identical path. */
function stepIds(
  byId: Map<string, TreeNode>,
  tacticId: string,
  idx: Map<string, TreeNode[]> = childIndex(byId),
): string[] {
  const tactic = byId.get(tacticId);
  if (!tactic || tactic.type !== "tactic") return [];
  const kids = idx.get(tacticId) ?? [];
  if (kids.length === 0) return [];
  // Everything at or below the continuation is off limits. A proof tree is a
  // tree, so the walk below could not reach it anyway — but a node CAN have
  // several parents in principle, and the one thing this cut must never do is
  // swallow the goal it is meant to be flowing into.
  const cont = continuationOf(byId, tacticId, idx);
  const keep = new Set<string>();
  for (const q = cont ? [cont.id] : []; q.length > 0; ) {
    const id = q.pop()!;
    if (keep.has(id)) continue;
    keep.add(id);
    for (const c of idx.get(id) ?? []) q.push(c.id);
  }
  const ids = new Set<string>([tacticId]);
  for (const q = kids.map((c) => c.id); q.length > 0; ) {
    const id = q.pop()!;
    if (ids.has(id) || keep.has(id)) continue;
    ids.add(id);
    for (const c of idx.get(id) ?? []) q.push(c.id);
  }
  return [...ids];
}

/** Every tactic a STEP cut is offered on, evaluated in ONE pass so the view
can memoize it per base tree — the offer test walks a subtree, and running it
per drawn node per render would be cubic. */
export function stepElidable(nodes: TreeNode[]): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const idx = childIndex(byId);
  const out = new Set<string>();
  for (const n of nodes)
    if (n.type === "tactic" && stepIds(byId, n.id, idx).length > 0) out.add(n.id);
  return out;
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
  if (cut.kind === "step") return stepIds(byId, cut.id);
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
  // A SYNTHETIC `calc` node (a block that never parsed) is never combined: it
  // maps to no editable tactic, and merging it would hide its repair chip
  // inside a box that carries no chips at all. A RECOVERED node (a failed or
  // never-ran tactic the supplemental parser synthesized) is never combined
  // either — a failed→skipped run IS linear, and merging it would fold the
  // one box whose dashed/danger styling says what happened into an ordinary
  // green one.
  const blocked = (id: string) =>
    (exclude?.has(id) ?? false) ||
    !!byId.get(id)?.synthetic ||
    !!byId.get(id)?.recovered;

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

/** How much of the elided tactic a ghost marker still shows. Long enough to
recognise the tactic you cut, short enough that the shadow reads as a whisper
between two goals rather than as another box. The FULL text of everything cut
rides the marker's `<title>`, so nothing is lost — just stood down. */
const GHOST_PREVIEW = 30;

/** …and how much of a `.none` flag's NOTE it shows. Longer, because a note is
a sentence rather than a recognition cue: 30 characters clip an ordinary one
mid-word, and the note is the whole reason that ghost says anything at all. */
const GHOST_NOTE_PREVIEW = 60;

/** A step marker's label: a truncated preview of the tactic itself, not a
count. A ghost stands for ONE named tactic (plus whatever blocks it opened, as
a `+N` tail), and its whole job is to say which one — `⋯ 4 tactics` would be
the same shadow whatever you cut.

The label is the node's own, so with the rail's brief mode ON it is already
the collapsed one and the two compose for free — reshaping it a second time
here would be a second copy of a rule that belongs to brief.

A `.none` flag's own prose REPLACES that preview, and drops the `+N` with it:
the directive said why this part is not worth reading, so the author's
sentence stands for the whole cut and a count of how many tactics it happened
to contain is the very thing they were waving away. The full text still rides
the marker's `<title>` either way. */
function ghostLabel(tactics: string[], note?: string): string {
  const cap = note ? GHOST_NOTE_PREVIEW : GHOST_PREVIEW;
  const head = (note ?? tactics[0] ?? "").split("\n")[0].trim();
  const text =
    head.length > cap ? head.slice(0, cap - 1).trimEnd() + "…" : head;
  const more = note ? 0 : tactics.length - 1;
  return `⋯ ${text}${more > 0 ? `  +${more}` : ""}`;
}

/** Translate a cut's member ids through a re-parse (see `remapIds`).
 *
 * Cuts key on ORIGINAL node ids, which are mvarIds and therefore renumber on
 * every re-elaboration — so without this a cut made before an edit anywhere in
 * the file resolves to nothing and `pruneCuts` throws it away. Ids with no
 * counterpart are left alone, so the prune still drops what genuinely went. */
export function remapCut(cut: ElideCut, to: (id: string) => string): ElideCut {
  switch (cut.kind) {
    case "path":
      return { ...cut, from: to(cut.from), to: to(cut.to) };
    case "step":
      return { ...cut, id: to(cut.id) };
    default:
      return { ...cut, ids: cut.ids.map(to) };
  }
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
      ghost: boolean;
      note?: string;
      chain: boolean;
    }
  >();
  const slotOf = new Map<string, number>();
  for (const cut of cuts) {
    const ids = resolveCut(cut, byId);
    if (ids.length === 0) continue;
    const mid = cutId(cut);
    if (info.has(mid)) continue; // dedupe identical cuts
    const members = ids.map((id) => byId.get(id)!).filter((n) => n.type === "tactic");
    const parts = members.map((n) => ({
      label: n.label,
      position: n.position,
      elision: n.elision,
    }));
    const tactics = parts.map((p) => p.label);
    let top = Infinity;
    for (const id of ids) {
      markerOf.set(id, mid);
      top = Math.min(top, index.get(id) ?? Infinity);
    }
    info.set(mid, {
      ids,
      tactics,
      parts,
      combine: cut.kind === "combine",
      ghost: cut.kind === "step",
      note: cut.kind === "step" ? cut.note : undefined,
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
        const { ids, tactics, parts, combine, ghost, note, chain } =
          info.get(mid)!;
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
            : ghost
              ? ghostLabel(tactics, note)
              : `⋯ ${tactics.length} ${tactics.length === 1 ? "tactic" : "tactics"}`,
          parents,
          chain,
          // `parts` rides EVERY marker, not just a combined one. The renderer
          // only reads them for a combined node (they carry the per-tactic
          // token alignment), but `parts` is also the marker's source RANGES,
          // and a ⇥/⇳ cut still stands for the tactics it swallowed: without
          // them the cursor accent — and anything else resolving a position to
          // a node — simply loses every position inside the cut.
          elidedCut: combine
            ? { tactics, combined: true, parts }
            : ghost
              ? { tactics, parts, ghost: true, note }
              : { tactics, parts },
        });
      }
      continue; // the cut's own nodes are gone
    }
    out.push({ ...n, parents: remap(n.parents, n.id) });
  }
  return out;
}
