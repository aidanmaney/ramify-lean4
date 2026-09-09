import type { CombinedPart, ParentEdge, TreeNode } from "./types";

/** The ONE hiding mechanism, in TWO standard idioms. The fourth kind
 (`combine`) is a display mode and keeps its full box.

 - `hop` and `fold` are GOAL-keyed and leave NO node at all: the goal itself
   is the reduced node, wearing `+N` in the corner its `−` came from (the
   outliner idiom). A `fold` takes the subtree strictly BELOW the goal; a
   `hop` takes its consuming step and what that step opened, and keeps the
   continuation goal, re-parented — the link out of the goal then carries the
   axis break, captioned with what went (`hopCaption`).
 - `step` is a SKIP of one tactic and everything it opened beside its
   continuation, drawn as a GHOST — the tactic reduced in place to a dashed
   box carrying its head and a `+N` badge for the rest. It is no longer what
   ◌ mints: skipping a step and folding the goal above it reached the SAME
   position with two different looks, so ◌ on any step is now the hop (see
   `hopForStep`). What is left for `step` is the case a hop cannot carry: a
   `.none` seed on a step with no continuation, whose author's sentence needs
   a box to stand in, and a `.fold` target that is a tactic of the same shape.
 - `band` is the marquee's explicit id set. On a straight trunk run it is
   rewritten as a hop (`hopForBand`); anywhere else it keeps the ghost.

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
  | ({ kind: "fold"; id: string } & Seeded)
  // A HOP: the trunk goal's own fold — its consuming step, everything that
  // step opened beside its continuation, AND the continuation goal itself,
  // so the goal wears `+N` and the NEXT spine tactic follows it directly.
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

/** The cut a `.none` above the step `id` asks for, already stamped: a hop off
 the goal above with the note captioning its break, or — where no hop can be
 read — the ghost that carries the author's sentence in a box of its own. */
export const noneSeedCut = (
  byId: Map<string, TreeNode>,
  id: string,
  note?: string,
  idx?: Map<string, TreeNode[]>,
): ElideCut =>
  seedCut(hopForStep(byId, id, idx ?? childIndex(byId), note) ?? { kind: "step", id, note }, "none");

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

/** A step's skip, AS THE GOAL ABOVE IT HOPPING OVER IT — the one answer ◌
 gives now, wherever it is asked. Skipping a step and folding the goal above
 it used to reach the same position by two different routes and draw it two
 different ways (a dashed ghost of the tactic, or the goal wearing `+N` with
 an axis break below it); the ghost went, and this is the door both routes go
 through. `null` where a hop cannot be read: the step has no continuation to
 keep (a closing tactic, or a split), or it is not the goal's first child —
 there the caller folds instead, except for a `.none`, whose sentence needs a
 box of its own and so keeps its ghost. */
export function hopForStep(
  byId: Map<string, TreeNode>,
  tacticId: string,
  idx: Map<string, TreeNode[]> = childIndex(byId),
  note?: string,
): ElideCut | null {
  const t = byId.get(tacticId);
  if (!t || t.type !== "tactic") return null;
  const g = t.parents[0]?.id;
  if (!g || byId.get(g)?.type !== "goal") return null;
  // `resolveCut` walks the goal's FIRST child, so a hop can only stand for a
  // step that is that child.
  if ((idx.get(g) ?? [])[0]?.id !== tacticId) return null;
  if (!continuationOf(byId, tacticId, idx)) return null;
  return note ? { kind: "hop", id: g, note } : { kind: "hop", id: g };
}

/** What ◌ on a step mints, in ONE place so the click, the hover preview and
 the probes cannot answer differently: the hop above it, or — where no hop can
 be read (a closing tactic, a split with no continuation) — whatever the goal
 above would do on its own, asked of `goalCut` rather than re-derived. `null`
 only if there is nothing to take. The caller adds the one thing that needs
 the DRAWN tree: a step hanging off the goal a standing hop kept extends that
 hop's `steps` instead of opening a second break below the first. */
export function stepCut(
  byId: Map<string, TreeNode>,
  tacticId: string,
  opts: { trunk: boolean; stepElidable: ReadonlySet<string> },
  idx: Map<string, TreeNode[]> = childIndex(byId),
): ElideCut | null {
  const hop = hopForStep(byId, tacticId, idx);
  if (hop) return hop;
  const g = byId.get(tacticId)?.parents[0]?.id;
  const above = g ? byId.get(g) : undefined;
  if (above?.type === "goal")
    return goalCut(byId, above.id, opts, idx) ?? { kind: "step", id: tacticId };
  // A CALC-CHAIN step hangs off the ledger tactic rather than off a goal, so
  // there is no goal above to hop from: the reduced-in-place ghost is what is
  // left, and it is the one place ◌ still mints one on its own.
  return { kind: "step", id: tacticId };
}

/** A marquee band read as a hop: its members must be EXACTLY one straight
 trunk run — the consuming steps of a chain of continuation goals, starting at
 the parent goal of the first member. The test is the honest one (resolve the
 candidate hop and compare the two member sets), so a band that reaches beside
 the trunk, or skips a step in the middle, keeps its ghost. */
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
        : (hopForStep(byId, id, idx, note) ?? { kind: "step", id, note }),
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

function childIndex(byId: Map<string, TreeNode>): Map<string, TreeNode[]> {
  const kids = new Map<string, TreeNode[]>();
  for (const n of byId.values())
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
 cut another one would refuse. `null` means the goal carries no `−` at all.

 It dispatches on LAYOUT and on TRUNK-NESS, and both halves were forced.

 `trunk: false` is ⑃ wide, which has no trunk lane and no continuation to
 keep: every goal with children simply FOLDS, which is what folding a subtree
 has always meant there.

 On a compact layout a goal's fold used to hide everything below it, which ON
 THE TRUNK is the REST OF THE PROOF: the reader asks to put one step away and
 the proof ends there. So a TRUNK goal — one that CONTINUES its producer's
 lane, roots included — instead HOPS over its consumer: the step and whatever
 it opened beside the trunk go, the continuation goal stays, and the link out
 of this goal carries the axis break, captioned with the head words of what
 went. That caption is what retires the old objection to a step fold (two goal
 boxes with nothing between them saying what happened) — the ghost box that
 used to do it went, because ◌ on the step below mints THIS cut too and one
 position must not have two looks.

 A BRANCH root is the other thing a goal can be — a split's child, a nested
 by-block's spawned root, a generated side condition — and there the subtree
 IS the branch, so it folds. Without that test the rule fires on exactly what
 a `.fold` flag names: measured, `flag_demo`'s seeded fold hid NOTHING (the
 side proof's `rw` splits, and so "continues") and an `induction` case could
 no longer be put away at all.

 "On the trunk" is "its producer's CONTINUATION", asked of `continuationOf` —
 the rule the skip itself reads — and NOT "its producer's sole child", which
 is what shipped first: the two differ on exactly the goal after a
 `have … := by`, whose spawned side proof is a SIBLING of the continuation,
 so the sole-child test failed there and the most common trunk goal there is
 fell through to hiding the rest of the proof (reported, on the goal after
 `have key`).

 The last answer is the honest one: a trunk goal whose sole child is not a
 PLAIN tactic — a ghost, a merged run, a goal, or several consumers — gets no
 `−` at all. There is nothing to skip from up here that the reader cannot say
 better below (a ghost already carries its own restore click), and a control
 that does nothing is worse than no control. */
export function goalCut(
  byId: Map<string, TreeNode>,
  id: string,
  opts: { trunk: boolean; stepElidable: ReadonlySet<string> },
  idx: Map<string, TreeNode[]> = childIndex(byId),
): ElideCut | null {
  const n = byId.get(id);
  if (!n || n.type !== "goal") return null;
  const kids = idx.get(id) ?? [];
  if (kids.length === 0) return null;
  if (!opts.trunk) return { kind: "fold", id };
  if (n.spawned || n.side) return { kind: "fold", id };
  if (!n.parents.every((p) => continuationOf(byId, p.id, idx)?.id === id))
    return { kind: "fold", id };
  // EVERY goal with children can be put away (user direction: the corner
  // control on all goal nodes, the root included). Where the consumer is a
  // plain tactic that opened something, the trunk goal SKIPS it; anywhere
  // else — a closing tactic (`omega`, `exact …`), a ghost already standing
  // below, several consumers — there is no continuation to keep, so the goal
  // FOLDS what little is under it and wears its `+N`.
  if (kids.length !== 1) return { kind: "fold", id };
  const t = kids[0];
  if (t.type !== "tactic") return { kind: "fold", id };
  // A GHOST below (a skipped step) or a MERGED run: the goal's `−` absorbs it
  // — a hop through the step(s) it stands for, so the trunk below stays.
  // (Treating it as "fold everything" killed the rest of the proof from the
  // goal above a `.none` ghost — reported.)
  if (t.elidedCut)
    return t.elidedCut.combined
      ? { kind: "hop", id, steps: t.elidedCut.parts?.length ?? 1 }
      : { kind: "hop", id };
  return opts.stepElidable.has(t.id) && continuationOf(byId, t.id, idx)
    ? { kind: "hop", id }
    : { kind: "fold", id };
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

/** Every tactic ◌ can act on: a step with something under it (hop or, failing
 that, the fold of its goal), and a LEAF closing a goal — ◌ there is the fold
 of the goal above, so a branch can be shortened from its end by skips alone
 (user direction; a leaf hanging off a calc ledger has no goal to fold). */
export function stepElidable(nodes: TreeNode[]): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const idx = childIndex(byId);
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.type !== "tactic") continue;
    if (stepIds(byId, n.id, idx).length > 0) out.add(n.id);
    else if (
      (idx.get(n.id) ?? []).length === 0 &&
      byId.get(n.parents[0]?.id ?? "")?.type === "goal"
    )
      out.add(n.id);
  }
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
    !!byId.get(id)?.chain;

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
        : ((cut.kind === "step" ? cut.note : undefined) ??
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
