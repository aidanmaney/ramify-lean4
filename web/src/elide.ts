import type { CombinedPart, ParentEdge, TreeNode } from "./types";

/** The ONE hiding mechanism, in TWO standard idioms. The fourth kind
 (`combine`) is a display mode and keeps its full box.

 THE VERB DECIDES THE IDIOM, NOT THE GOAL'S POSITION (user direction,
 2026-09-17: "while reading to the end I go for skip; while taking a
 high-level look I go for hide"). `−` on a goal HIDES — always a `fold`, in
 every layout, trunk goals included. ◌ on a step SKIPS — always a `hop`,
 wherever the step has exactly one continuation, inside branches as on the
 trunk. So the look names the verb: `+N` with a break on the line was
 skipped, `+N` without one was hidden.

 - `hop` and `fold` are GOAL-keyed and leave NO node at all: the goal itself
   is the reduced node, wearing `+N` in its corner (the outliner idiom). A
   `fold` takes the subtree strictly BELOW the goal; a `hop` takes its
   consuming step and what that step opened, and keeps the continuation goal,
   re-parented — the link out of the goal then carries the axis break,
   captioned with what went (`hopCaption`).
 - `step` is a SKIP of one tactic and everything it opened beside its
   continuation, drawn as a GHOST — the tactic reduced in place to a dashed
   box carrying its head and a `+N` badge for the rest. ◌ no longer mints it
   under a goal; what is left for it is a `.none` seed on a SPLIT (no
   continuation to keep, not a leaf), a step hanging off a tactic rather than
   a goal, and a `.fold`/residue target that is a tactic of that shape.
 - `band` is the marquee's explicit id set. Exactly one goal's strict subtree
   becomes that goal's fold, a straight run becomes a hop (`cutForBand`);
   anything else keeps the ghost.

 Every kind goes on the one list, so seeds, reset, the stash, `remapCut`,
 `pruneCuts`, `disjointCuts`, peek and anchoring all have a single door. */
/** Where a SEEDED cut came from — the flag that asked for it. It is the
 hover title's subject ("From `.none` in the source"), and it is set only by
 `sourceView`, the one minting site for seeds. */
export type SeedOrigin = "none" | "fold" | "residue";

/** What every cut the SOURCE asked for carries, and no cut the reader made
 does. It is what lets the author's hand be read off the drawing: the caption,
 the ghost label and the goal corner all say `§` and lean into italics when it
 is set. Deliberately NOT part of `cutId` — a reader's `−` on a seeded goal
 mints the very same id, and `addCut` dedupes by id, so the standing seeded
 cut simply survives the reader's gesture rather than being replaced by a
 plain one that draws differently. */
export interface Seeded {
  seeded?: true;
  seededBy?: SeedOrigin;
}

export type ElideCut =
  | ({ kind: "band"; ids: string[] } & Seeded)
  // `note` is a `.none` seed's prose on a LEAF step, whose skip is the fold
  // of the goal above it; it rides the goal's `<title>`.
  | ({ kind: "fold"; id: string; note?: string } & Seeded)
  // A HOP: the SKIP of a goal's consuming step(s) — the step and everything
  // it opened beside its continuation go, the continuation goal stays,
  // re-parented, so the goal wears `+N` and its line carries the break.
  // `note` is a `.none` seed's prose, which captions the break.
  | ({ kind: "hop"; id: string; steps?: number; note?: string } & Seeded)
  | ({ kind: "step"; id: string; note?: string } & Seeded)
  | { kind: "combine"; ids: string[] };

/** The one reading of "the source asked for this", so no site has to know
 that `combine` (a display mode, never seeded) has no such field. */
export const isSeededCut = (c: ElideCut): boolean =>
  c.kind !== "combine" && !!c.seeded;
export const seedKindOf = (c: ElideCut): SeedOrigin | undefined =>
  c.kind === "combine" ? undefined : c.seededBy;

/** The mark a seeded cut wears wherever it is drawn — caption, ghost label —
 ahead of the text, in the same italic. The section sign is the printer's
 "this is the author speaking" and is not a glyph any tactic starts with. */
export const SEED_MARK = "\u00a7 ";

/** The hover title's first paragraph for a seeded cut: which flag wrote it,
 and how much it took. Callers append the list of hidden tactics. */
export function seedTitle(by: SeedOrigin | undefined, n: number): string {
  const what =
    by === "fold"
      ? "From .fold in the source"
      : by === "residue"
        ? "Folded by the source (an rw's x = x residue)"
        : "From .none in the source";
  return `${what} — click to open\n\n${n} ${n === 1 ? "step" : "steps"}`;
}

/** The one stamp. A cut the SOURCE asked for wears its origin wherever it was
 minted — the once-per-proof seed, `reset`, and the gestures that WRITE a flag
 and mint the matching cut in the same breath, which must speak in the
 author's voice immediately rather than waiting for the next reseed. `combine`
 is a display mode and is never seeded, so it passes through untouched. */
export const seedCut = (c: ElideCut, by: SeedOrigin | undefined): ElideCut =>
  c.kind === "combine" ? c : { ...c, seeded: true, seededBy: by };

/** The cuts a `.fold` naming `targets` asks for, already stamped. The `.fold`
 gesture (the marquee pill) and `sourceView` both come here, so the flag the
 gesture writes and the flag the next load reads mint the same thing. */
export const foldSeedCuts = (
  byId: Map<string, TreeNode>,
  targets: Iterable<string>,
): ElideCut[] => cutsForTargets(byId, targets).map((c) => seedCut(c, "fold"));

/** The cut a `.none` above the step `id` asks for, already stamped — the
 author's "skip this step when reading", so the same answer ◌ gives: a hop
 off the goal above with the note captioning its break where a continuation
 exists, the fold of the goal above where the step is a LEAF (the note rides
 the goal's title), and — only where neither applies, a split — the ghost
 that carries the author's sentence in a box of its own. */
export const noneSeedCut = (
  byId: Map<string, TreeNode>,
  id: string,
  note?: string,
  idx?: Map<string, TreeNode[]>,
): ElideCut =>
  seedCut(withNote(tacticCut(byId, id, idx ?? childIndex(byId)), note), "none");

/** ◌'s ladder, with the ghost as the floor. `stepCut` returns `null` where no
 idiom reads (a split with no tactic above it), and there the author's `.none`
 still has to say something — the ghost carries their sentence in a box of its
 own. ONE ladder, so the seed and the gesture cannot answer differently. */
const tacticCut = (
  byId: Map<string, TreeNode>,
  id: string,
  idx: Map<string, TreeNode[]>,
): ElideCut => stepCut(byId, id, idx) ?? { kind: "step", id };

/** The author's note, onto whichever cut the ladder chose. */
const withNote = (c: ElideCut, note?: string): ElideCut =>
  note === undefined || c.kind === "combine" || c.kind === "band"
    ? c
    : { ...c, note };

/** What the SOURCE asks for, as cuts. `.fold` and an `rw`'s `x = x` residue
 name TARGETS rather than a kind, so both go through `cutsForTargets`; `.none`
 is a skip of the step it sits above. Read by the once-per-proof seed and by
 `reset`, so the two cannot answer "what does the source say" differently. */
export function sourceView(nodes: TreeNode[]): ElideCut[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const idx = childIndex(byId);
  const cuts: ElideCut[] = [];
  for (const n of nodes) {
    if (n.rflResidue)
      for (const c of cutsForTargets(byId, [n.id])) cuts.push(seedCut(c, "residue"));
    if (n.flags?.fold) cuts.push(...foldSeedCuts(byId, n.flags.targets ?? []));
    if (!n.flags?.elide) continue;
    const note = n.flags.note;
    for (const t of n.type === "tactic" ? [n.id] : (n.flags.targets ?? []))
      cuts.push(noneSeedCut(byId, t, note, idx));
  }
  return cuts;
}

/** The goal a step hangs off, when the step is that goal's ONLY consumer.
 A goal with several consumers is a LEDGER node (one justification per row):
 no one row is "the step below" it, so neither a hop nor the leaf's fold can
 honestly stand for one row — the per-row gesture is the row itself. */
function soleConsumedGoal(
  byId: Map<string, TreeNode>,
  tacticId: string,
  idx: Map<string, TreeNode[]>,
): TreeNode | null {
  const t = byId.get(tacticId);
  if (!t || t.type !== "tactic") return null;
  const g = t.parents[0] ? byId.get(t.parents[0].id) : undefined;
  if (!g || g.type !== "goal") return null;
  const kids = idx.get(g.id) ?? [];
  return kids.length === 1 && kids[0].id === tacticId ? g : null;
}

/** ◌ on a LEAF is the fold of the goal above it — reading to the end of a
 branch by skips (user direction, 2026-09-08). `null` for a non-leaf, or a
 leaf that is not its goal's sole consumer (a ledger row). */
function leafFoldFor(
  byId: Map<string, TreeNode>,
  tacticId: string,
  idx: Map<string, TreeNode[]>,
): { kind: "fold"; id: string } | null {
  if ((idx.get(tacticId) ?? []).length > 0) return null;
  const g = soleConsumedGoal(byId, tacticId, idx);
  return g ? { kind: "fold", id: g.id } : null;
}

/** A step's skip, AS THE GOAL ABOVE IT HOPPING OVER IT — the one answer ◌
 gives wherever the step has exactly ONE continuation, on the trunk or inside
 a branch, in every layout. `null` where a hop cannot be read: no single
 continuation (a leaf, a closing step with side obligations, a split), or the
 step is not its goal's sole consumer (a ledger row). */
export function hopForStep(
  byId: Map<string, TreeNode>,
  tacticId: string,
  idx: Map<string, TreeNode[]> = childIndex(byId),
  note?: string,
): ElideCut | null {
  const g = soleConsumedGoal(byId, tacticId, idx);
  if (!g) return null;
  if (!continuationOf(byId, tacticId, idx)) return null;
  return note ? { kind: "hop", id: g.id, note } : { kind: "hop", id: g.id };
}

/** What ◌ on a step mints, in ONE place so the click, the hover preview, the
 gate (`stepElidable`) and the probes cannot answer differently. The rule is
 "skip is offered only where there is exactly one continuation, or the step
 is a leaf":

 - one continuation under a goal → the HOP above it (`hopForStep`);
 - a LEAF, its goal's sole consumer → the FOLD of that goal;
 - one continuation under a TACTIC (a broken chain's synthetic `calc`) → the
   ghost, since there is no goal above to hop from;
 - anything else → `null`, and ◌ is not offered: a SPLIT (`constructor`,
   `cases`, `induction`…), a closing step whose goal left side obligations,
   and a LEDGER row (calc or ctor — the ledger node has one consumer per row,
   so no row is its continuation; the row click and its `−` are the gesture).

 The caller adds the one thing that needs the DRAWN tree: a step hanging off
 the goal a standing hop kept extends that hop's `steps` instead of opening a
 second break directly below the first. */
export function stepCut(
  byId: Map<string, TreeNode>,
  tacticId: string,
  idx: Map<string, TreeNode[]> = childIndex(byId),
): ElideCut | null {
  const hop = hopForStep(byId, tacticId, idx);
  if (hop) return hop;
  const leaf = leafFoldFor(byId, tacticId, idx);
  if (leaf) return leaf;
  const t = byId.get(tacticId);
  const above = t?.parents[0] ? byId.get(t.parents[0].id) : undefined;
  if (above?.type === "tactic" && continuationOf(byId, tacticId, idx))
    return { kind: "step", id: tacticId };
  return null;
}

/** A marquee band read as a hop: its members must be EXACTLY one straight
 run — the consuming steps of a chain of continuation goals, starting at the
 parent goal of the first member. The test is the honest one (resolve the
 candidate hop and compare the two member sets), so a band that reaches beside
 the run, or skips a step in the middle, is no hop. */
export function hopForBand(
  byId: Map<string, TreeNode>,
  ids: Iterable<string>,
  idx: Map<string, TreeNode[]> = childIndex(byId),
): ElideCut | null {
  const want = new Set(ids);
  const members = [...byId.keys()].filter((id) => want.has(id));
  const tactics = members.filter((id) => byId.get(id)!.type === "tactic");
  if (tactics.length === 0) return null;
  const head = hopForStep(byId, tactics[0], idx);
  if (!head || head.kind !== "hop") return null;
  let g = head.id;
  let steps = 0;
  while (steps < tactics.length) {
    const t = (idx.get(g) ?? [])[0];
    if (!t || t.type !== "tactic" || !want.has(t.id)) break;
    steps++;
    const cont = continuationOf(byId, t.id, idx);
    if (!cont) break;
    g = cont.id;
  }
  if (steps === 0) return null;
  const cut: ElideCut = { kind: "hop", id: head.id, steps };
  const got = new Set(resolveCut(cut, byId));
  return got.size === members.length && members.every((m) => got.has(m))
    ? cut
    : null;
}

/** A marquee band read as a FOLD: its members are EXACTLY one goal's strict
 subtree. The candidate goal is the parent of the band's first member in
 preorder (the topmost node swept), so the test is one comparison. */
export function foldForBand(
  byId: Map<string, TreeNode>,
  ids: Iterable<string>,
  idx: Map<string, TreeNode[]> = childIndex(byId),
): ElideCut | null {
  const want = new Set(ids);
  const members = [...byId.keys()].filter((id) => want.has(id));
  if (members.length === 0) return null;
  const g = byId.get(members[0])?.parents[0]?.id;
  if (!g || byId.get(g)?.type !== "goal") return null;
  const below = subtreeBelow(byId, g, idx);
  return below.length === members.length && below.every((m) => want.has(m))
    ? { kind: "fold", id: g }
    : null;
}

/** What a marquee band mints — the band follows the verb too. A band that is
 exactly one goal's subtree is that goal's FOLD; a straight run is a HOP;
 anything else keeps its ghost. The fold is asked FIRST: a run that ends by
 closing its goal is both, and a hop with no continuation left to keep would
 draw no break, so the look would lie about the verb. */
export function cutForBand(
  byId: Map<string, TreeNode>,
  ids: Iterable<string>,
  idx: Map<string, TreeNode[]> = childIndex(byId),
): ElideCut {
  const list = [...ids];
  return (
    foldForBand(byId, list, idx) ??
    hopForBand(byId, list, idx) ?? { kind: "band", ids: list }
  );
}

/** A cut per target, chosen by the target's own TYPE: a goal folds, a tactic
 skips. The tactic case is not a curiosity — `foldTargetsOf` returns the
 flagged TACTIC itself when its consumed goal is the root, and a fold of a
 tactic was never a thing this tree could draw. ONE coding, read by the seed
 (through `sourceView`), by `reset` and by the marquee's `.fold` verb. */
export function cutsForTargets(
  byId: Map<string, TreeNode>,
  targets: Iterable<string>,
  note?: string,
): ElideCut[] {
  const idx = childIndex(byId);
  const out: ElideCut[] = [];
  for (const id of targets) {
    const n = byId.get(id);
    if (!n) continue;
    out.push(
      n.type === "goal"
        ? { kind: "fold", id }
        : withNote(tacticCut(byId, id, idx), note),
    );
  }
  return out;
}

/** A cut's identity, which is its KIND and its members and NOTHING else —
 the `seeded` flag is deliberately out, so a reader's `−` on a goal the source
 already folded mints the same id and `addCut` keeps the standing seeded cut
 rather than replacing it with one that would draw in the reader's voice. */
export function cutId(cut: ElideCut): string {
  if (cut.kind === "step") return `elide-step:${cut.id}`;
  if (cut.kind === "fold") return `elide-fold:${cut.id}`;
  if (cut.kind === "hop") return `elide-hop:${cut.id}`;
  return `${cut.kind === "combine" ? "combine" : "elide-band"}:${[...cut.ids].sort().join("·")}`;
}

export function combineMemberIds(markerId: string): string[] | null {
  return markerId.startsWith("combine:")
    ? markerId.slice("combine:".length).split("·")
    : null;
}

/** The ONE parent→children index. Every module that walks the tree downwards
 wants it and each used to build its own; taking either a node list or the
 `byId` map keeps the one builder usable from all of them, and the children of
 a parent stay in the order the nodes were given (DFS preorder, which the
 `+N` counts and the ledger rows both read). */
export function childIndex(
  nodes: Iterable<TreeNode> | Map<string, TreeNode>,
): Map<string, TreeNode[]> {
  const kids = new Map<string, TreeNode[]>();
  for (const n of nodes instanceof Map ? nodes.values() : nodes)
    for (const p of n.parents)
      (kids.get(p.id) ?? kids.set(p.id, []).get(p.id)!).push(n);
  return kids;
}

export function continuationOf(
  byId: Map<string, TreeNode>,
  tacticId: string,
  idx: Map<string, TreeNode[]> = childIndex(byId),
): TreeNode | null {
  const kids = idx.get(tacticId) ?? [];
  if (kids.length === 0) return null;
  const rest = kids.some((k) => k.spawned)
    ? kids.filter((k) => !k.spawned)
    : kids.some((k) => k.side)
      ? kids.filter((k) => !k.side)
      : kids.length > 1
        ? []
        : kids;
  return rest.length === 1 ? rest[0] : null;
}

/** The subtree strictly BELOW a node, in `byId` INSERTION order — which for
 every caller is the tree's own DFS preorder, so `parts[0]` is the goal's
 consumer and the `+N` in the corner counts outward from the step the reader
 was looking at. */
function subtreeBelow(
  byId: Map<string, TreeNode>,
  id: string,
  idx: Map<string, TreeNode[]>,
): string[] {
  if (!byId.has(id)) return [];
  const want = new Set<string>();
  for (const q = (idx.get(id) ?? []).map((n) => n.id); q.length > 0; ) {
    const cur = q.pop()!;
    if (cur === id || want.has(cur)) continue;
    want.add(cur);
    for (const c of idx.get(cur) ?? []) q.push(c.id);
  }
  const out: string[] = [];
  for (const key of byId.keys()) if (want.has(key)) out.push(key);
  return out;
}

/** The ONE gate a goal's `−` reads — the glyph, the click, the hint row and
 the hover preview all ask this and nothing else, so no surface can offer a
 cut another one would refuse. `null` means the goal carries no `−` at all:
 a childless goal has nothing to hide.

 `−` HIDES, and so it always FOLDS — in every layout, trunk goals and roots
 included (user direction, 2026-09-17: the verb decides the idiom, not the
 goal's position). On a trunk goal that hides the rest of the proof below it,
 which is what "taking a high-level look" asks for; READING ON past one step
 is ◌'s job, and ◌ on the step below mints the hop (`stepCut`).

 History, in the record: until 2026-09-17 a trunk goal's `−` HOPPED its
 consumer in the compact layouts (so `−` and ◌ drew the same thing), with a
 `trunk` option for ⑃ wide and a tangle of cases for ghosts, merged runs and
 closing consumers. All of that went with the rule. */
export function goalCut(
  byId: Map<string, TreeNode>,
  id: string,
  idx: Map<string, TreeNode[]> = childIndex(byId),
): ElideCut | null {
  const n = byId.get(id);
  if (!n || n.type !== "goal") return null;
  return (idx.get(id) ?? []).length > 0 ? { kind: "fold", id } : null;
}

/** The OUTLINE: every goal that starts a BRANCH — a nested by-block's
 spawned root, a generated side condition, one case of a split — folded, and
 so what `collapse all` writes. Folding these and only these leaves the trunk
 drawn and each branch root wearing a `+N` where its `−` was, each of those
 reopening one branch: an outline rather than a wreck. Cutting every gate-passing node
 instead (what `collapse all` used to write) left two boxes, since every trunk
 goal's cut and every tactic's stacked on top of each other. A branch root
 with no children (a leaf case, a `sorry`) is skipped — the fold would hide
 nothing. */
export function outlineCuts(
  byId: Map<string, TreeNode>,
  idx: Map<string, TreeNode[]> = childIndex(byId),
): ElideCut[] {
  const out: ElideCut[] = [];
  for (const n of byId.values()) {
    if (n.type !== "goal" || n.parents.length === 0) continue;
    if ((idx.get(n.id) ?? []).length === 0) continue;
    if (n.parents.every((p) => continuationOf(byId, p.id, idx)?.id !== n.id))
      out.push({ kind: "fold", id: n.id });
  }
  return out;
}

function stepIds(
  byId: Map<string, TreeNode>,
  tacticId: string,
  idx: Map<string, TreeNode[]> = childIndex(byId),
  allowLeaf = false,
): string[] {
  const tactic = byId.get(tacticId);
  if (!tactic || tactic.type !== "tactic") return [];
  const kids = idx.get(tacticId) ?? [];
  if (kids.length === 0) return allowLeaf ? [tacticId] : [];

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
  // `byId` INSERTION order — the tree's DFS preorder — so the step itself is
  // first and its side work follows in SOURCE order: `parts[0]` is the step
  // the reader clicked, and the break's caption names the rest in the order
  // they are written. (The walk above is a stack, which reverses siblings.)
  const out: string[] = [];
  for (const key of byId.keys()) if (ids.has(key)) out.push(key);
  return out;
}

/** Every tactic ◌ is OFFERED on — exactly the steps `stepCut` answers for,
 asked of it rather than re-derived: one continuation (the hop), a leaf that
 is its goal's sole consumer (the fold above), a continuation under a tactic
 (the ghost). A split, a closing step with side obligations and a ledger row
 are absent, so no button, ⌥-click or hint promises a skip there. */
export function stepElidable(nodes: TreeNode[]): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const idx = childIndex(byId);
  const out = new Set<string>();
  for (const n of nodes)
    if (n.type === "tactic" && stepCut(byId, n.id, idx)) out.add(n.id);
  return out;
}

export function resolveCut(
  cut: ElideCut,
  byId: Map<string, TreeNode>,
): string[] {
  if (cut.kind === "step")
    return stepIds(byId, cut.id, childIndex(byId), !!cut.note);
  if (cut.kind === "fold")
    return subtreeBelow(byId, cut.id, childIndex(byId));
  if (cut.kind === "hop") {
    // `steps` linear hops down the spine from the goal: each takes the
    // consuming step, what it opened beside its continuation, and the
    // continuation goal, then continues from that goal. A second ◌ on the
    // next tactic extends the same cut (the tally in the goal's `+N`).
    // The LAST continuation goal survives — the next spine tactic keeps the
    // goal it is solving (a tactic without its goal has no context; user
    // direction) — and only the goals BETWEEN chained hops go.
    const idx = childIndex(byId);
    const out: string[] = [];
    let g = cut.id;
    for (let k = 0; k < (cut.steps ?? 1); k++) {
      const t = (idx.get(g) ?? [])[0];
      if (!t || t.type !== "tactic") break;
      out.push(...stepIds(byId, t.id, idx));
      const cont = continuationOf(byId, t.id, idx);
      if (!cont) break;
      if (k > 0) out.push(g);
      g = cont.id;
    }
    return out;
  }
  return cut.ids.filter((id) => byId.has(id));
}

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

  const blocked = (id: string) =>
    (exclude?.has(id) ?? false) ||
    !!byId.get(id)?.synthetic ||
    !!byId.get(id)?.recovered ||
    !!byId.get(id)?.chain ||
    // A LEDGER host: its sole child is the ledger, not a goal the reader can
    // go on from, so a merged run walking through it would swallow the rows.
    // `chain` covered the calc host on its own; `ledgerKind` covers both.
    !!byId.get(id)?.ledgerKind;

  const runs: ElideCut[] = [];
  const seen = new Set<string>();

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
      const g = soleChild(cur);
      if (!g || byId.get(g)!.type !== "goal" || !soleParent(g)) break;
      const next = soleChild(g);
      if (!next || !soleParent(next) || byId.get(next)!.type !== "tactic")
        break;
      if (blocked(g) || blocked(next)) break;
      ids.push(g);
      cur = next;
    }
    if (tacticCount >= 2) runs.push({ kind: "combine", ids });
  }
  return runs;
}

export function selectionRun(
  nodes: TreeNode[],
  selected: Set<string>,
): string[] | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const idx = childIndex(byId);
  const tactics = nodes.filter(
    (n) => selected.has(n.id) && n.type === "tactic",
  );
  if (tactics.length < 2) return null;
  if (tactics.some((t) => t.synthetic || t.recovered || t.elidedCut))
    return null;
  const want = new Set(tactics.map((t) => t.id));

  const ids: string[] = [];
  let cur: string | null = tactics[0].id;
  const seen = new Set<string>();
  while (cur && want.has(cur)) {
    ids.push(cur);
    seen.add(cur);
    if (seen.size === want.size) return ids;
    const kids: TreeNode[] = idx.get(cur) ?? [];
    if (kids.length !== 1 || kids[0].type !== "goal") return null;
    const g: TreeNode = kids[0];
    if (g.parents.length !== 1) return null;
    const next: TreeNode[] = idx.get(g.id) ?? [];
    if (
      next.length !== 1 ||
      next[0].type !== "tactic" ||
      next[0].parents.length !== 1
    )
      return null;
    ids.push(g.id);
    cur = next[0].id;
  }
  return null;
}

const GHOST_NOTE_PREVIEW = 60;

/** The separators a tactic's HEAD stops at, tried IN THIS ORDER — the first
 one that OCCURS wins, not the one that occurs earliest. Order is what tells
 `obtain ⟨k, hk⟩ := hn` (` := ` before `, `, so the anonymous constructor
 survives) from `exact ⟨key n, parity n, …⟩` (no ` := `, so `, ` cuts inside
 the brackets and the head is the first component). A bracket-depth rule was
 the other reading and gets the second case wrong. */
const HEAD_SEPS = [" : ", " := ", " at ", ", ", " with", " using "];

const HEAD_CAP = 26;

/** What a SKIP's ghost is labelled with: the tactic reduced to the part that
 names the move. The rest of the label is what the box below it would have
 said, and the ghost is standing in for a box that is not drawn.

 Pinned examples (the head, then the cap):

   `have key : ∀ m : ℕ, …`            → `have key…`
   `rw [Finset.sum_range_succ]`        → `rw [Finset.sum_range_succ]`
   `obtain ⟨k, hk⟩ := hn`              → `obtain ⟨k, hk⟩…`
   `induction m with`                  → `induction m…`
   `exact ⟨key n, parity n, …⟩`        → `exact ⟨key n…`

 The `…` says something was cut, so a head that is already the whole first
 line and short enough carries none. */
export function tacticHead(label: string): string {
  let text = label.split("\n")[0].trim();
  let cut = false;
  for (const s of HEAD_SEPS) {
    const i = text.indexOf(s);
    if (i > 0) {
      text = text.slice(0, i);
      cut = true;
      break;
    }
  }
  if (text.length > HEAD_CAP) {
    const sp = text.lastIndexOf(" ", HEAD_CAP);
    text = sp > 0 ? text.slice(0, sp) : text.slice(0, HEAD_CAP);
    cut = true;
  }
  text = text.trimEnd();
  return cut ? `${text}…` : text;
}

/** The first WORD of a tactic — what the axis break under a hopped goal is
 captioned with, since the reader wants to know which moves went, not their
 arguments. Leading identifier/keyword characters; a bullet (`·`) or any other
 punctuation head is its own first character. */
export function tacticKeyword(label: string): string {
  const text = label.split("\n")[0].trim();
  const m = /^[A-Za-z_'.₀-₉]+/.exec(text);
  return m ? m[0] : text.slice(0, 1);
}

/** How many keywords the break's caption names before it says `…`. Three
 elements, the `…` counting as one: `have`, `have · rcases · rw`,
 `intro · simp · …`. */
const HOP_CAPTION_MAX = 3;

/** The caption beside a hop's axis break: the author's sentence when the cut
 carries a `.none` note (italic, as the ghost said it), otherwise the head
 word of each hidden tactic in source order. It is the chart convention — an
 axis break is labelled with what the break skipped — and it is what lets the
 ghost go: the goal's `+N` says HOW MUCH went, the caption says WHAT. */
export function hopCaption(folded: {
  tactics: string[];
  note?: string;
  seeded?: true;
}): { text: string; italic: boolean } | null {
  const body = folded.note
    ? notePreview(folded.note)
    : (() => {
        const words = folded.tactics.map(tacticKeyword).filter((w) => w !== "");
        if (words.length === 0) return null;
        return words.length > HOP_CAPTION_MAX
          ? [...words.slice(0, HOP_CAPTION_MAX - 1), "…"].join(" · ")
          : words.join(" · ");
      })();
  if (body === null) return null;
  // SEEDED: the author's hand, not the reader's. `§` and italics say so —
  // the ONE string, so `hopCaptionWidth` measures exactly what is painted.
  if (folded.seeded) return { text: SEED_MARK + body, italic: true };
  return { text: body, italic: !!folded.note };
}

/** A `.none` flag's prose, which REPLACES the head: the author's sentence is
 what the ghost says, so it gets a longer cap than a head does. */
function notePreview(note: string): string {
  const head = note.split("\n")[0].trim();
  return head.length > GHOST_NOTE_PREVIEW
    ? head.slice(0, GHOST_NOTE_PREVIEW - 1).trimEnd() + "…"
    : head;
}

export function remapCut(cut: ElideCut, to: (id: string) => string): ElideCut {
  switch (cut.kind) {
    case "step":
    case "fold":
    case "hop":
      return { ...cut, id: to(cut.id) };
    default:
      return { ...cut, ids: cut.ids.map(to) };
  }
}

export function disjointCuts(
  cuts: ElideCut[],
  byId: Map<string, TreeNode>,
): ElideCut[] {
  if (cuts.length < 2) return cuts;
  const sets = cuts.map((c) => resolveCut(c, byId));
  const order = cuts
    .map((_, i) => i)
    .sort((a, b) => sets[b].length - sets[a].length || b - a);
  const claimed = new Set<string>();
  const kept = new Set<number>();
  for (const i of order) {
    if (sets[i].some((id) => claimed.has(id))) continue;
    for (const id of sets[i]) claimed.add(id);
    kept.add(i);
  }
  if (kept.size === cuts.length) return cuts;
  return cuts.filter((_, i) => kept.has(i));
}

export function pruneCuts(nodes: TreeNode[], cuts: ElideCut[]): ElideCut[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const live = cuts.filter((c) => resolveCut(c, byId).length > 0);
  return live.length === cuts.length ? cuts : live;
}

/** A LINEAR step: opened nothing beside its continuation — putting it away
 alone would swap one box for one ghost of the same size (reported: useless).
 Its skip is a HOP absorbed into the goal above instead. */
export function linearStep(
  byId: Map<string, TreeNode>,
  tacticId: string,
  idx: Map<string, TreeNode[]> = childIndex(byId),
): boolean {
  const ids = stepIds(byId, tacticId, idx);
  return ids.length === 1 && !!continuationOf(byId, tacticId, idx);
}

/** COALESCE: once everything under a branch-root goal is hidden — every node
 in its drawn subtree is a ghost — the pieces become the root's own fold, so
 finishing a side-tree from the bottom never sends the reader back up to
 close it. The trunk root is the only goal excluded: folding it is hiding
 the whole proof, and a spine of ghosts is still the spine. */
export function coalesceCuts(nodes: TreeNode[], cuts: ElideCut[]): ElideCut[] {
  const drawn = applyElisions(nodes, cuts);
  const byId = new Map(drawn.map((n) => [n.id, n]));
  const idx = childIndex(byId);
  // Only BRANCH ROOTS coalesce — decided on the BASE tree, since a hop
  // re-parents the goal it keeps onto the hopped goal and that kept goal is a
  // continuation, not a branch (it coalesced too, and the fold hung off both).
  const base = new Map(nodes.map((n) => [n.id, n]));
  const baseIdx = childIndex(base);
  const branchRoot = (id: string) => {
    const b = base.get(id);
    return (
      !!b &&
      b.parents.length > 0 &&
      b.parents.every((p) => continuationOf(base, p.id, baseIdx)?.id !== id)
    );
  };
  const roots = new Set<string>();
  for (const n of drawn) {
    // A goal already carrying a hop tally still coalesces (the tally becomes
    // the fold); one already folded whole has nothing left under it.
    if (n.type !== "goal" || !branchRoot(n.id) || n.folded?.kind === "fold") continue;
    const kids = idx.get(n.id) ?? [];
    if (kids.length === 0) continue;
    // "All put away" = no REAL tactic is drawn anywhere below: ghosts and
    // the goals a hop keeps for context are what a finished branch shows.
    let all = true;
    const q = [...kids];
    while (q.length && all) {
      const k = q.pop()!;
      if (k.type === "tactic" && (!k.elidedCut || k.elidedCut.combined)) all = false;
      else q.push(...(idx.get(k.id) ?? []));
    }
    if (all) roots.add(n.id);
  }
  if (roots.size === 0) return cuts;
  // The coalesced fold speaks in the AUTHOR'S voice only if every piece it
  // absorbs did: a branch the source folded stays the source's, one the
  // reader finished off by hand (or half of each) becomes the reader's.
  const folds = [...roots].map((id): ElideCut => {
    const mem = new Set(resolveCut({ kind: "fold", id }, base));
    const absorbed = cuts.filter((c) => {
      if (c.kind === "fold" && c.id === id) return true;
      const m = resolveCut(c, base);
      return m.length > 0 && m.every((x) => mem.has(x));
    });
    if (absorbed.length === 0 || !absorbed.every(isSeededCut))
      return { kind: "fold", id };
    const by = absorbed.map(seedKindOf).find((k) => k !== undefined);
    return { kind: "fold", id, seeded: true, seededBy: by };
  });
  const covered = new Set(folds.flatMap((f) => resolveCut(f, base)));
  const kept = cuts.filter((c) => {
    if (c.kind === "fold" && roots.has(c.id)) return false;
    const m = resolveCut(c, base);
    return !(m.length > 0 && m.every((id) => covered.has(id)));
  });
  return [...kept, ...folds];
}

export function applyElisions(nodes: TreeNode[], cuts: ElideCut[]): TreeNode[] {
  if (cuts.length === 0) return nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  cuts = disjointCuts(cuts, byId);

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
      seeded?: true;
      seededBy?: SeedOrigin;
    }
  >();
  // A FOLD mints nothing. Its members simply go, and the GOAL it hangs off is
  // stamped with what went — the goal is the reduced node, wearing `+N` in
  // the corner where its `−` was. Nothing is added to `markerOf` for it, and
  // nothing needs to be: every member is a DESCENDANT of the goal, so no
  // surviving node can have a parent edge pointing into the set (the only
  // edges into it leave the goal itself, which stays).
  const foldedOn = new Map<
    string,
    {
      tactics: string[];
      parts: CombinedPart[];
      note?: string;
      kind: "fold" | "hop";
      seeded?: true;
      seededBy?: SeedOrigin;
    }
  >();
  const gone = new Set<string>();
  const slotOf = new Map<string, number>();
  const seen = new Set<string>();
  for (const cut of cuts) {
    const ids = resolveCut(cut, byId);
    if (ids.length === 0) continue;
    const mid = cutId(cut);
    if (seen.has(mid)) continue;
    seen.add(mid);
    const members = ids.map((id) => byId.get(id)!).filter((n) => n.type === "tactic");
    const parts = members.map((n) => ({
      label: n.label,
      position: n.position,
      elision: n.elision,
    }));
    const tactics = parts.map((p) => p.label);

    const about =
      cut.kind === "step"
        ? byId.get(cut.id)
        : members.length === 1
          ? members[0]
          : undefined;
    const note =
      cut.kind === "hop"
        ? // A hop takes its note from the CUT alone: over a run of several
          // steps, the first member's own `.none` would caption the lot.
          cut.note
        : ((cut.kind === "step" || cut.kind === "fold" ? cut.note : undefined) ??
          (about?.flags?.elide ? about.flags.note : undefined));
    const seeded = isSeededCut(cut) ? (true as const) : undefined;
    const seededBy = seeded ? seedKindOf(cut) : undefined;
    if (cut.kind === "fold" || cut.kind === "hop") {
      for (const id of ids) gone.add(id);
      // A hop's survivors below the continuation goal (the next spine
      // tactic) re-parent onto the folded goal — `markerOf` is the remap
      // table, and here the "marker" is the goal itself.
      if (cut.kind === "hop") for (const id of ids) markerOf.set(id, cut.id);
      foldedOn.set(cut.id, {
        tactics,
        parts,
        note,
        kind: cut.kind,
        seeded,
        seededBy,
      });
      continue;
    }
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
      note,
      seeded,
      seededBy,

      chain: members[members.length - 1]?.chain ?? false,
    });
    slotOf.set(mid, top);
  }
  if (info.size === 0 && foldedOn.size === 0) return nodes;

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
    if (gone.has(n.id)) continue;
    const mid = markerOf.get(n.id);
    if (mid) {
      if (index.get(n.id) === slotOf.get(mid)) {
        const { ids, tactics, parts, combine, ghost, note, chain, seeded, seededBy } =
          info.get(mid)!;

        const parents = remap(
          ids.flatMap((id) => byId.get(id)!.parents),
          mid,
        );
        out.push({
          id: mid,
          type: "tactic",

          // The ghost's label: the tactic REDUCED, not a count. A step names
          // the move it stands for and a `.none` names it in the author's own
          // words; the `+N` badge (drawn from `tactics.length - 1`) carries
          // whatever else the cut swallowed. A marquee BAND reads the same
          // way — its first member is still the step the reader swept from.
          // A SEEDED ghost wears the `§` mark ahead of its text, and wears it
          // IN THE LABEL rather than in the paint: `ghostSize` measures the
          // label, so measurer and renderer cannot disagree about its width.
          label: combine
            ? tactics.join("\n")
            : (seeded ? SEED_MARK : "") +
              (note ? notePreview(note) : tacticHead(tactics[0] ?? "")),
          parents,
          chain,

          elidedCut: combine
            ? { tactics, combined: true, parts }
            : { tactics, parts, ghost: ghost || undefined, note, seeded, seededBy },
        });
      }
      continue;
    }
    const folded = foldedOn.get(n.id);
    out.push(
      folded
        ? { ...n, folded, parents: remap(n.parents, n.id) }
        : { ...n, parents: remap(n.parents, n.id) },
    );
  }
  return out;
}
