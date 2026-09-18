// Fixture invariants for the cut mechanism (fold and hop = goal-keyed cuts,
// drawn as a `+N` on the goal itself and minting NO node; step and band mint
// one ghost, and a step now only where no hop can be read).  Re-run after touching elide.ts,
// proofToTree.ts or layout.ts:   npm run probe -- counts
// Every number here was measured, not derived; a change is a finding to
// record in CLAUDE.md, not a baseline to bump silently.
import { applyTraces, isAutomationNode, traceIndex, traceKey, tacticHeadWord, sourceView, outlineCuts, goalCut, resolveCut, cutId, applyElisions, stepElidable, continuationOf, remapCut, pruneCuts, linearStep, coalesceCuts, stepCut, hopForStep, hopForBand, foldForBand, cutForBand, hopCaption, isSeededCut, SEED_MARK, foldSeedCuts, noneSeedCut, authorStops, tourList, firstSentence, remapIds } from "./lib.mjs";
import { records, tree, byIdOf, kidsOf, find, goalWithHyp, structural, tally } from "./corpus.mjs";

const t = tally();
const recs = records();
const drawn = (base, cuts) => applyElisions(base, cuts);
const N = (i, cuts) => drawn(tree(recs[i]), cuts).length;

const odd = find("odd_sums"), fac = find("factorization"), demo = find("flags.lean", 0), nested = find("flags.lean", 2);
t.eq(N(odd, sourceView(tree(recs[odd]))), 75, "odd_sums seeded");
t.eq(N(demo, sourceView(tree(recs[demo]))), 13, "flag_demo seeded");
t.eq(N(nested, sourceView(tree(recs[nested]))), 3, "flag_nested seeded");
{
  const b = tree(recs[odd]); const byId = byIdOf(b); const kids = kidsOf(b); const se = stepElidable(b); const seeds = sourceView(b);
  const root = b.find((n) => n.parents.length === 0);
  const g1 = goalWithHyp(b, "key", "gap");
  // B5: the badge now reads `succ k ih` — the arm's binders beside the tag.
  const succ = b.find((n) => n.type === "goal" && n.caseLabel?.startsWith("succ"));
  // THE VERB DECIDES THE IDIOM (2026-09-17). `−` on a goal HIDES: always a
  // fold, trunk goals included. ◌ on the step below SKIPS: the hop, with the
  // counts the goal's `−` gave before the change (60 / 73 / 49 — unchanged).
  const key = kids.get(root.id)[0];
  const cr = goalCut(byId, root.id, kids); t.eq(cr?.kind, "fold", "root − folds"); t.eq(N(odd, [...seeds, cr]), 1, "root fold hides the whole proof");
  const sr = stepCut(byId, key.id, kids); t.eq(sr?.kind, "hop", "◌ on `have key` hops"); t.eq(sr.id, root.id, "…from the root"); t.eq(N(odd, [...seeds, sr]), 60, "root hop (keeps the goal the next step solves)");
  t.ok(g1, "goal after `have key` found by hyp");
  if (g1) {
    const c = goalCut(byId, g1.id, kids); t.eq(c?.kind, "fold", "goal-after-key − folds"); t.eq(drawn(b, [...seeds, c]).length, 17, "goal-after-key fold (everything below it hidden)");
    const gap = kids.get(g1.id)[0]; const h = stepCut(byId, gap.id, kids); t.eq(h?.kind, "hop", "◌ on `have gap` hops");
    const d = drawn(b, [...seeds, h]); t.eq(d.length, 73, "goal-after-key hop"); t.ok(d.some((n) => n.label.startsWith("have parity")), "the trunk below the skipped step still drawn"); t.ok(d.some((n) => n.label.startsWith("exact ⟨key n")), "closing exact still drawn");
  }
  const cs = goalCut(byId, succ.id, kids); t.eq(cs?.kind, "fold", "succ cut kind"); t.eq(N(odd, [...seeds, cs]), 68, "succ fold");
  const d = drawn(b, outlineCuts(byId, kids)); t.eq(d.length, 19, "collapse-all odd_sums"); t.eq(d.filter((n) => n.folded).length, 4, "collapse-all folded goals");
  { const f = tree(recs[fac]); t.eq(drawn(f, outlineCuts(byIdOf(f), kidsOf(f))).length, 7, "collapse-all factorization"); }
}
// every goal × goalCut: a fold that resolves, mints no node, stays sound
for (const [i, rec] of recs.entries()) {
  const b = tree(rec); if (!b.length) continue;
  const byId = byIdOf(b), kids = kidsOf(b), se = stepElidable(b);
  structural(b, `#${i} base`, (m) => t.ok(false, m));
  for (const g of b.filter((n) => n.type === "goal")) {
    const c = goalCut(byId, g.id, kids);
    t.eq(!!c, (kids.get(g.id) ?? []).length > 0, `#${i} − offered iff ${g.id} has children`); if (!c) continue;
    t.eq(c.kind, "fold", `#${i} − on ${g.id} is a fold`);
    const members = resolveCut(c, byId); t.ok(members.length > 0, `#${i} ${c.kind} on ${g.id} resolves empty`);
    const d = drawn(b, [c]);
    // A FOLD mints no node — the goal it hangs off is the reduced node,
    // stamped with what went; a SKIP or a BAND mints exactly one ghost.
    const fold = c.kind === "fold" || c.kind === "hop";
    t.eq(d.filter((n) => n.id === cutId(c)).length, fold ? 0 : 1, `#${i} ${cutId(c)} marker count`);
    t.eq(d.length, b.length - members.length + (fold ? 0 : 1), `#${i} ${cutId(c)} drawn count`);
    if (fold) {
      const g2 = d.find((n) => n.id === c.id);
      t.ok(!!g2?.folded, `#${i} ${cutId(c)} goal not stamped`);
      t.eq(g2?.folded?.tactics.length, members.filter((m) => byId.get(m).type === "tactic").length, `#${i} ${cutId(c)} folded tactic count`);
    }
    structural(d, `#${i} ${cutId(c)}`, (m) => t.ok(false, m));
  }
  // every tactic × ◌: offered exactly where there is ONE continuation or a
  // leaf (its goal's sole consumer); the cut resolves, keeps the continuation,
  // stays sound — and a hop always has a kept goal to draw the break above.
  for (const tac of b.filter((n) => n.type === "tactic")) {
    const tk = kids.get(tac.id) ?? []; const up = byId.get(tac.parents[0]?.id);
    const sole = up?.type === "goal" && (kids.get(up.id) ?? []).length === 1;
    const want = up?.type === "goal" ? sole && (tk.length === 0 || !!continuationOf(byId, tac.id, kids)) : !!continuationOf(byId, tac.id, kids);
    t.eq(se.has(tac.id), want, `#${i} ◌ offered on ${tac.id} (${tac.label.slice(0, 20)})`);
    const c = stepCut(byId, tac.id, kids); t.eq(!!c, se.has(tac.id), `#${i} stepCut vs stepElidable on ${tac.id}`); if (!c) continue;
    const members = resolveCut(c, byId); t.ok(members.length > 0, `#${i} ◌ on ${tac.id} resolves empty`);
    const d = drawn(b, [c]); structural(d, `#${i} ◌ ${cutId(c)}`, (m) => t.ok(false, m));
    if (c.kind === "hop") {
      t.ok(d.some((n) => n.id === c.id), `#${i} ◌ on ${tac.id} lost the goal it hangs off`);
      t.ok(d.some((n) => n.parents.some((p) => p.id === c.id)), `#${i} hop on ${c.id} keeps nothing to break above`);
      const cont = continuationOf(byId, tac.id, kids);
      if (cont) t.ok(d.some((n) => n.id === cont.id), `#${i} ◌ on ${tac.id} lost its continuation`);
      t.ok(members.includes(tac.id), `#${i} ◌ on ${tac.id} did not hide it`);
    }
    // a LEAF under a goal: ◌ is exactly the fold of that goal (skip and
    // collapse reach one state), and the goal survives wearing the count.
    if ((kids.get(tac.id) ?? []).length === 0 && byId.get(tac.parents[0]?.id)?.type === "goal") {
      const g = tac.parents[0].id;
      t.eq(c.kind, "fold", `#${i} ◌ on leaf ${tac.id} kind`); t.eq(c.id, g, `#${i} ◌ on leaf ${tac.id} folds its goal`);
      const gc = goalCut(byId, g, kids);
      t.eq(cutId(c), cutId(gc), `#${i} ◌ on leaf ${tac.id} ≠ goal's own −`);
      t.ok(d.some((n) => n.id === g && n.folded), `#${i} ◌ on leaf ${tac.id} lost its goal`);
    }
  }
  const oc = outlineCuts(byId, kids);
  const roots = b.filter((n) => n.type === "goal" && n.parents.length > 0 && (kids.get(n.id) ?? []).length > 0 && n.parents.every((p) => continuationOf(byId, p.id, kids)?.id !== n.id));
  t.eq(oc.length, roots.length, `#${i} outline count vs branch roots`);
  structural(drawn(b, oc), `#${i} outline`, (m) => t.ok(false, m));
  t.eq(sourceView(b).map(cutId).sort().join("|"), sourceView(b).map(cutId).sort().join("|"), `#${i} sourceView deterministic`);
  for (const c of oc) t.eq(pruneCuts(b, [remapCut(c, (id) => id)]).length, 1, `#${i} prune keeps a live fold`);
}
// Linear skip = hop tally; a finished side-tree coalesces into its root's fold.
{
  const b = tree(recs[odd]); const byId = byIdOf(b); const kids = kidsOf(b);
  const keyRoot = b.find((n) => n.type === "goal" && n.spawned && n.label.includes("∀ (m : ℕ), ∑ i ∈ Finset.range m"));
  const intro = kids.get(keyRoot.id)[0]; t.ok(linearStep(byId, intro.id, kids), "intro m is a linear step");
  const hop1 = coalesceCuts(b, [{ kind: "hop", id: keyRoot.id, steps: 1 }]);
  const d1 = applyElisions(b, hop1); const r1 = d1.find((n) => n.id === keyRoot.id);
  t.eq(r1?.folded?.kind, "hop", "hop stamps the goal"); t.eq(r1?.folded?.tactics.length, 1, "hop tally +1");
  const g1 = kidsOf(d1).get(keyRoot.id)?.[0]; t.eq(g1?.type, "goal", "the goal the next step solves is kept"); const induction = kidsOf(d1).get(g1.id)[0]; t.ok(induction.label.startsWith("induction"), "next spine tactic under it");
  const both = coalesceCuts(b, [...hop1, { kind: "step", id: induction.id }]);
  t.eq(both.length, 1, "hop + terminal skip coalesce to one cut"); t.eq(both[0].kind, "fold", "…a fold on the branch root");
  const d2 = applyElisions(b, both); t.eq(d2.find((n) => n.id === keyRoot.id)?.folded?.tactics.length, 7, "root tally = every tactic in the branch (7)");
  t.eq(d2.length, b.length - 13, "whole side proof hidden, no ghost");
}

// ◌ SKIPS, − HIDES: on the root the two verbs now draw different trees.
{
  const b = tree(recs[odd]); const byId = byIdOf(b); const kids = kidsOf(b); const se = stepElidable(b); const seeds = sourceView(b);
  const root = b.find((n) => n.parents.length === 0); const key = kids.get(root.id)[0];
  t.ok(key.label.startsWith("have key"), "`have key` is the root's step");
  const sc = stepCut(byId, key.id, kids); const gc = goalCut(byId, root.id, kids);
  t.eq(sc?.kind, "hop", "◌ on a step with side work hops"); t.eq(gc?.kind, "fold", "the goal's − folds");
  t.ok(cutId(sc) !== cutId(gc), "◌ and − no longer mint the same cut");
  // A SPLIT is not offered ◌ at all: no continuation, and not a leaf.
  const ind = b.find((n) => n.type === "tactic" && n.label.startsWith("induction"));
  t.ok(!continuationOf(byId, ind.id, kids), "`induction m with` has no continuation");
  t.eq(stepCut(byId, ind.id, kids), null, "◌ on `induction m with` mints nothing");
  t.ok(!se.has(ind.id), "…and is not offered");
  t.eq(hopForStep(byId, ind.id, kids), null, "…and mints no hop");
  const ctor = b.find((n) => n.type === "tactic" && n.label === "constructor");
  t.ok(ctor && (kids.get(ctor.id) ?? []).length === 2, "`constructor` splits in two");
  t.ok(!se.has(ctor.id), "◌ is not offered on `constructor`");
  const rc = b.find((n) => n.type === "tactic" && n.label.startsWith("rcases Nat.even_or_odd"));
  t.ok(!se.has(rc.id), "…nor on `rcases … with he | ho`");
  // A LEDGER row (one of four justifications off the ctor ledger) is no
  // goal's sole consumer: not offered — the row click and its − are the gesture.
  const ex = b.find((n) => n.type === "tactic" && n.label.startsWith("exact ⟨key n"));
  const led = kids.get(ex.id)[0]; const rows = kids.get(led.id);
  t.eq(rows.length, 4, "the ctor ledger has four rows");
  t.ok(rows.every((r) => !se.has(r.id)), "◌ is not offered on a ledger row");
  t.ok(se.has(ex.id), "…while the ledger's host `exact` still skips (its ledger is its continuation)");
  // ◌ INSIDE A BRANCH: `rw [Finset.sum_range_succ]` in the succ case hops,
  // keeping the goal `rw [ih]` solves; the break has a link to sit on.
  const rw = b.find((n) => n.type === "tactic" && n.label === "rw [Finset.sum_range_succ]");
  const h = stepCut(byId, rw.id, kids); t.eq(h?.kind, "hop", "◌ inside the succ branch hops");
  const d = applyElisions(b, [h]); const hk = kidsOf(d).get(h.id) ?? [];
  t.eq(hk.length, 1, "…the hopped goal keeps one child"); t.eq(hk[0]?.type, "goal", "…the goal the next step solves");
  t.ok(kidsOf(d).get(hk[0].id)?.[0]?.label === "rw [ih]", "…and `rw [ih]` still under it");
  t.eq(d.length, b.length - 1, "branch hop drawn count (the step alone goes)");
  t.eq(hopCaption(d.find((n) => n.id === h.id).folded).text, "rw", "…captioned `rw`");
  // A leaf still folds its goal (reading a branch to its end by skips).
  const ring = kidsOf(b).get(kidsOf(b).get(kidsOf(b).get(rw.id)[0].id)[0].id);
  const omegaLeaf = b.find((n) => n.type === "tactic" && n.label === "ring" && (kids.get(n.id) ?? []).length === 0);
  t.eq(stepCut(byId, omegaLeaf.id, kids)?.kind, "fold", "◌ on a leaf folds the goal above"); void ring;
}

// COALESCE with hops INSIDE a branch (2026-09-17): reading the succ case to
// its end by ◌ — three hops chained on the case root, then the leaf `ring`
// folding the kept goal — leaves nothing drawn under the case, which becomes
// the case root's fold, exactly as the trunk-root rule always did.
{
  const b = tree(recs[odd]); const byId = byIdOf(b); const kids = kidsOf(b);
  const succ = b.find((n) => n.type === "goal" && n.caseLabel?.startsWith("succ"));
  const h3 = { kind: "hop", id: succ.id, steps: 3 };
  const d = applyElisions(b, [h3]); const kept = kidsOf(d).get(succ.id)[0];
  t.eq(kidsOf(d).get(kept.id)?.[0]?.label, "ring", "three chained ◌ in the succ case leave `ring` under the kept goal");
  const leaf = stepCut(byIdOf(d), kidsOf(d).get(kept.id)[0].id, kidsOf(d));
  t.eq(cutId(leaf), `elide-fold:${kept.id}`, "◌ on `ring` folds the kept goal");
  const co = coalesceCuts(b, [h3, leaf]);
  t.eq(co.length, 1, "…and the pieces coalesce"); t.eq(cutId(co[0]), `elide-fold:${succ.id}`, "…into the case root's fold");
  t.eq(applyElisions(b, co).find((n) => n.id === succ.id)?.folded?.tactics.length, 4, "…tallying the case's four tactics");
  // A hop in a branch with steps still drawn below does NOT coalesce.
  t.eq(coalesceCuts(b, [{ kind: "hop", id: succ.id }]).length, 1, "a lone branch hop stands"); void byId; void kids;
}

// ◌ on `have parity`: the hop from the goal above it, keeping the trunk.
{
  const b = tree(recs[odd]); const byId = byIdOf(b); const kids = kidsOf(b); const se = stepElidable(b); const seeds = sourceView(b);
  const parity = b.find((n) => n.type === "tactic" && n.label.startsWith("have parity"));
  const c = stepCut(byId, parity.id, kids);
  t.eq(c?.kind, "hop", "◌ on `have parity` hops"); void se; t.eq(c.id, parity.parents[0].id, "…from the goal above it");
  const d = applyElisions(b, [...seeds, c]);
  t.eq(d.length, 49, "parity hop drawn");
  t.ok(d.some((n) => n.label.startsWith("have residue")), "the trunk below the hopped step is still drawn");
  t.eq(d.find((n) => n.id === c.id)?.folded?.tactics.length, 17, "the hopped step's whole branch is the goal's tally");
  t.eq(hopCaption(d.find((n) => n.id === c.id).folded).text, "have · intro · …", "the break's caption names the moves");
}

// A marquee swept down one trunk run is the same hop, not a band.
{
  const b = tree(recs[odd]); const byId = byIdOf(b); const kids = kidsOf(b);
  const root = b.find((n) => n.parents.length === 0);
  const run = { kind: "hop", id: root.id, steps: 2 };
  const ids = resolveCut(run, byId); t.ok(ids.length > 2, "a two-step run off the root");
  const back = hopForBand(byId, ids, kids);
  t.eq(cutId(back ?? { kind: "fold", id: "none" }), cutId(run), "the band over that run reads back as the hop");
  t.eq(back?.steps, 2, "…with the same tally");
  // A band that reaches beside the trunk keeps its own marker.
  t.eq(hopForBand(byId, [...ids].slice(1), kids), null, "a band that misses the first step is no hop");
  t.eq(cutForBand(byId, ids, kids).kind, "hop", "cutForBand keeps a straight run a hop");
  t.eq(cutForBand(byId, [...ids].slice(1), kids).kind, "band", "…and anything else a band");
  // A band EXACTLY one goal's subtree is that goal's FOLD.
  const succ = b.find((n) => n.type === "goal" && n.caseLabel?.startsWith("succ"));
  const sub = resolveCut({ kind: "fold", id: succ.id }, byId);
  t.eq(cutId(cutForBand(byId, sub, kids)), cutId({ kind: "fold", id: succ.id }), "a band over the succ case's subtree folds it");
  t.eq(cutId(foldForBand(byId, sub, kids) ?? { kind: "band", ids: [] }), `elide-fold:${succ.id}`, "…foldForBand says so");
  t.eq(foldForBand(byId, sub.slice(0, -1), kids), null, "a band one node short of the subtree is no fold");
}

// The break's caption: a `.none` seed's prose in italics, keywords otherwise.
{
  const b = tree(recs[odd]); const byId = byIdOf(b);
  const seeded = sourceView(b).filter((c) => c.kind === "hop" && c.note);
  t.eq(seeded.length, 1, "odd_sums seeds one `.none` hop");
  const g = applyElisions(b, seeded).find((n) => n.id === seeded[0].id);
  const cap = hopCaption(g.folded);
  t.ok(cap.italic, "a note captions in italics");
  t.eq(cap.text, "§ the algebra: m = 2j + 1 squares to 2 * (2j² + 2j) + 1", "the note is the caption, in the author's voice");
  t.eq(g.folded.tactics.length, 4, "the `.none` hop's tally");
  // A `.none` on a LEAF is ◌'s answer there: the fold of the goal above,
  // the author's sentence riding the goal (its title), no ghost (2026-09-17).
  const cl = tree(recs[find("flags.lean", 1)]); const closing = sourceView(cl);
  t.eq(closing.length, 1, "flag_closing seeds one cut"); t.eq(closing[0].kind, "fold", "…the fold of the goal above the leaf");
  const clg = applyElisions(cl, closing).find((n) => n.id === closing[0].id);
  t.eq(clg?.folded?.tactics.length, 1, "…hiding the leaf"); t.ok(!!clg?.folded?.note, "…carrying the author's sentence");
  t.eq(applyElisions(cl, closing).filter((n) => n.elidedCut).length, 0, "…and no ghost");
  // A `.none` on a SPLIT keeps its ghost — no continuation to keep, not a leaf.
  const dm = tree(recs[demo]); const dcuts = sourceView(dm).filter((c) => c.seededBy === "none");
  t.eq(dcuts.length, 1, "flag_demo seeds one `.none`"); t.eq(dcuts[0].kind, "step", "…on its `rcases` split: a ghost");
  // A `.none` on a step WITH a continuation seeds a seeded hop.
  { const ob = b.find((n) => n.type === "tactic" && n.label.startsWith("obtain ⟨j, hj⟩")); const bi = byIdOf(b);
    const nc = noneSeedCut(bi, ob.id, "why"); t.eq(nc.kind, "hop", "`.none` on a step with a continuation seeds a hop"); t.ok(isSeededCut(nc) && nc.note === "why", "…seeded, with the note"); }
}


// SEEDED: a cut the SOURCE asked for is marked, and stays marked through
// every carrier — the mark is what draws it in the author's voice (`§` and
// italics) rather than the reader's.
{
  for (const [i, rec] of recs.entries()) {
    const b = tree(rec); if (!b.length) continue;
    for (const c of sourceView(b)) {
      t.ok(isSeededCut(c), `#${i} sourceView cut ${cutId(c)} not seeded`);
      t.ok(["none", "fold", "residue"].includes(c.seededBy), `#${i} ${cutId(c)} has no origin`);
      // The mark is NOT part of identity: a reader's − on a seeded goal mints
      // the same id, so `addCut` keeps the seed instead of replacing it.
      t.eq(cutId(c), cutId({ ...c, seeded: undefined, seededBy: undefined }), `#${i} cutId reads the seed flag`);
      // …and survives a remap and a prune.
      t.ok(isSeededCut(remapCut(c, (id) => id)), `#${i} remapCut drops the seed`);
      t.ok(pruneCuts(b, [c]).every(isSeededCut), `#${i} pruneCuts drops the seed`);
    }
  }
  const b = tree(recs[odd]); const byId = byIdOf(b); const kids = kidsOf(b); const se = stepElidable(b);
  const seed = sourceView(b).find((c) => c.kind === "hop" && c.note);
  const g = applyElisions(b, [seed]).find((n) => n.id === seed.id);
  t.eq(g.folded.seeded, true, "the `.none` seed stamps its goal seeded");
  t.eq(g.folded.seededBy, "none", "…with its origin");
  t.ok(hopCaption(g.folded).text.startsWith(SEED_MARK), "…and captions with the mark");
  t.ok(hopCaption(g.folded).italic, "…in italics");
  // A READER's hop off the same tree is unmarked and draws plainly.
  const parity = b.find((n) => n.type === "tactic" && n.label.startsWith("have parity"));
  const mine = stepCut(byId, parity.id, kids); void se;
  t.ok(!isSeededCut(mine), "a reader's ◌ mints no seed");
  const gm = applyElisions(b, [mine]).find((n) => n.id === mine.id);
  t.eq(gm.folded.seeded, undefined, "…and stamps none on the goal");
  t.ok(!hopCaption(gm.folded).text.startsWith(SEED_MARK), "…and its caption bears no mark");
  // A seeded GHOST (a `.none` on a closing step) carries the mark IN ITS
  // LABEL, which is what `ghostSize` measures.
  const dmo = tree(recs[demo]); const ghost = applyElisions(dmo, sourceView(dmo)).find((n) => n.elidedCut && !n.elidedCut.combined);
  t.eq(ghost.elidedCut.seeded, true, "a seeded ghost is stamped");
  t.ok(ghost.label.startsWith(SEED_MARK), "…and wears the mark in its label");
}

// COALESCE keeps the voice: all-seeded pieces make a seeded fold, a mixed set
// makes the reader's.
{
  const b = tree(recs[odd]);
  const keyRoot = b.find((n) => n.type === "goal" && n.spawned && n.label.includes("∀ (m : ℕ), ∑ i ∈ Finset.range m"));
  const hop = { kind: "hop", id: keyRoot.id, steps: 1 };
  const ind = kidsOf(applyElisions(b, [hop])).get(kidsOf(applyElisions(b, [hop])).get(keyRoot.id)[0].id)[0];
  const term = { kind: "step", id: ind.id };
  const all = coalesceCuts(b, [{ ...hop, seeded: true, seededBy: "fold" }, { ...term, seeded: true, seededBy: "fold" }]);
  t.eq(all.length, 1, "all-seeded pieces coalesce to one fold");
  t.eq(isSeededCut(all[0]), true, "…and the fold keeps the author's voice");
  t.eq(all[0].seededBy, "fold", "…and its origin");
  const mixed = coalesceCuts(b, [{ ...hop, seeded: true, seededBy: "fold" }, term]);
  t.eq(mixed.length, 1, "a mixed set coalesces too");
  t.eq(isSeededCut(mixed[0]), false, "…but the fold is the reader's");
}

// SEEDED AT THE GESTURE. The marquee pill WRITES a `.fold` / `.none` into the
// source and mints the matching cut in the same breath; that cut must already
// speak in the author's voice, not wait for the next reseed. The pill and
// `sourceView` go through the same two doors, so this tests both.
{
  const b = tree(recs[odd]); const byId = byIdOf(b); const kids = kidsOf(b); const se = stepElidable(b);
  // B5: the badge now reads `succ k ih` — the arm's binders beside the tag.
  const succ = b.find((n) => n.type === "goal" && n.caseLabel?.startsWith("succ"));
  const [f] = foldSeedCuts(byId, [succ.id]);
  t.eq(isSeededCut(f), true, "the pill's .fold is seeded the moment it is written");
  t.eq(f.seededBy, "fold", "…in the .fold voice");
  t.eq(cutId(f), cutId(goalCut(byId, succ.id, kids)), "…at the position the reader's − reaches"); void se;
  t.eq(applyElisions(b, [f]).find((n) => n.id === succ.id).folded.seededBy, "fold", "…and it stamps the goal at once");
  const parity = b.find((n) => n.type === "tactic" && n.label.startsWith("have parity"));
  const nc = noneSeedCut(byId, parity.id, "not worth reading");
  t.eq(isSeededCut(nc), true, "the pill's .none is seeded too");
  t.eq(nc.seededBy, "none", "…in the .none voice");
  t.eq(cutId(nc), cutId(stepCut(byId, parity.id, kids)), "…at the position ◌ reaches");
  const drawnNode = applyElisions(b, [nc]).find((n) => n.id === (nc.kind === "hop" ? nc.id : cutId(nc)));
  const cap = drawnNode.folded ? hopCaption(drawnNode.folded).text : drawnNode.label;
  t.ok(cap.startsWith(SEED_MARK), "…and reads in the author's voice at once");
}

// THE TOUR (tour.ts). odd_sums carries three `.mark`s: two bare and one with
// an explicit rank on a LATER step, which is what puts it first.
{
  const b = tree(recs[odd]);
  const stops = authorStops(b);
  t.eq(stops.length, 3, "odd_sums author stops");
  t.eq(stops[0].rank, 1, "the explicit `.mark 1` sorts ahead of every bare one");
  t.eq(stops.map((s) => s.rank).join(), "1,,", "…and the bare ones carry no rank");
  t.eq(
    stops.map((s) => s.caption).join(" | "),
    "The four corollaries, in the order the statement lists them. | Step 1: the identity itself. | Step 3: parity survives squaring in both directions.",
    "captions are the comments' first sentences, in tour order",
  );
  t.ok(stops.every((s) => s.who === "author"), "…in the author's voice");
  // Each stop sits on the TACTIC node the comment was attributed to.
  const byId = byIdOf(b);
  t.ok(stops.every((s) => byId.get(s.id)?.type === "tactic"), "every stop is a step's tactic node");
  t.ok(byId.get(stops[0].id).label.startsWith("exact ⟨key n"), "the ranked stop is the closing `exact`");
  // Ordering: bare stops follow source position.
  const [, a1, a2] = stops.map((s) => byId.get(s.id).position.start.line);
  t.ok(a1 < a2, "bare stops run down the source");
  // The reader's list orders by source position, whatever order it was built in.
  const ids = [stops[2].id, stops[1].id];
  const mine = tourList(b, new Set(ids), { source: false, temp: true });
  t.eq(mine.length, 2, "two reader stops");
  t.eq(mine[0].id, stops[1].id, "…ordered by source position, not by insertion");
  t.ok(mine.every((s) => s.who === "mine"), "…and in the reader's voice");
  // A reader stop survives a re-parse the way every id-holding view set does.
  const b2 = tree(recs[odd]);
  const to = remapIds(b, b2);
  const moved = to.get(stops[1].id);
  t.ok(!!moved, "remapIds carries a reader stop across a re-parse");
  t.eq(tourList(b2, new Set([moved]), { source: false, temp: true }).length, 1, "…and it still names a node");
  // THE TWO TOGGLES (`tourList`). Four combinations over one proof: 3 source
  // stops ∪ 2 of the reader's with 1 shared, deduped in the author's favour,
  // with the explicit ranks still leading.
  {
    const mineOnly = b.find((n) => n.type === "tactic" && !stops.some((s) => s.id === n.id));
    // A node that is BOTH — the ranked author stop, also dropped by the reader.
    const set = new Set([mineOnly.id, stops[0].id]);
    const list = (source, temp) => tourList(b, set, { source, temp });
    const all = list(true, true);
    t.eq(all.length, 4, "both on = 3 source stops ∪ 2 of mine, the shared one counted once");
    t.eq(list(true, false).length, 3, "source only = the file's three");
    t.eq(list(false, true).length, 2, "temp only = the reader's two");
    t.eq(list(false, false).length, 0, "neither on reads nothing");
    t.eq(all.filter((s) => s.id === stops[0].id).length, 1, "…the node carrying both appears once");
    t.eq(all.find((s) => s.id === stops[0].id).who, "author", "…in the author's voice");
    t.eq(all[0].id, stops[0].id, "the explicit `.mark 1` still leads the union");
    t.eq(list(true, false)[0].id, stops[0].id, "…and leads source-only too");
    const rest = all.slice(1).map((s) => byId.get(s.id).position.start.line);
    t.ok(rest.every((l, i) => i === 0 || rest[i - 1] <= l), "…and everything after it runs down the source");
    t.eq(tourList(b, new Set(), { source: true, temp: true }).map((s) => s.id).join(), stops.map((s) => s.id).join(), "with no reader stops, both-on is the source's list exactly");
    t.eq(tourList(tree(recs[odd]).filter((n) => !n.flags?.mark), new Set(), { source: true, temp: true }).length, 0, "…and an unmarked proof with no stops of yours is empty");
  }

  // The caption rule itself.
  t.eq(firstSentence("One. Two."), "One.", "first sentence stops at the first period");
  t.eq(firstSentence("Mid.sentence dots do not end it. Next."), "Mid.sentence dots do not end it.", "…but only one followed by whitespace");
  t.eq(firstSentence("x".repeat(200)).length, 80, "a long sentence is capped at 80");
  t.ok(firstSentence("x".repeat(200)).endsWith("…"), "…with an ellipsis");
}

// PART E — term-level structure INSIDE a tactic (`recoverTermInStep`).  Every
// proof-relevant component of an `⟨…⟩` supplied by exact/refine/refine'/apply
// gets its expected type as a goal, and the host tactic draws them INLINE as a
// LEDGER — the calc idiom, one mechanism, same node and same row gestures
// (user direction 2026-09-09: "should inline like calc blocks since they're
// related").  Numbers MEASURED 2026-09-09.
{
  const b = tree(recs[odd]); const kids = kidsOf(b);
  const ex = b.find((n) => n.type === "tactic" && n.label.startsWith("exact ⟨key n"));
  t.eq(ex.ledgerKind, "ctor", "the closing `exact` hosts a ctor ledger");
  t.eq(ex.label, "exact ⟨key n, parity n, gap n, residue⟩",
    "…keeping its own text: only `calc` stands for its chain");
  const hosted = kids.get(ex.id) ?? [];
  t.eq(hosted.length, 1, "…and ONE child, the ledger — nothing fans out beside it");
  const led = hosted[0];
  t.eq(led.ledgerKind, "ctor", "the ledger node knows which ledger it is");
  t.ok(!led.chain, "…and is no chain: a constructor threads no relation");
  t.eq(led.ledger.length, 4, "one row per component");
  t.ok(led.ledger.every((r) => r.goalId && r.hiddenLhs === undefined),
    "…every row a goal of its own, with no relation column and no head row");
  t.eq(led.ledger.map((r) => r.text.slice(0, 10)).join(" | "),
    "∑ i ∈ Fins | Even n ↔ E | ∑ i ∈ Fins | n % 2 = 0 ",
    "…whose text is the component's expected type, in source order");
  const leaves = kids.get(led.id) ?? [];
  t.eq(leaves.map((c) => c.label).join(" | "), "key n | parity n | gap n | residue",
    "each component's proof hangs off its row, in source order");
  t.ok(leaves.every((c) => c.recovered === "subterm"),
    "…stamped `subterm`, so nothing downstream takes it for a tactic");
  t.eq(b.filter((n) => n.type === "goal" && n.spawned && n.parents[0]?.id === ex.id).length, 0,
    "…and no component is left standing as a side branch");
  // A DATA component (`2 * k * k : \u2115`) and a HOLE (`?_`) mint nothing: the
  // witness is not an argument and the hole is already the tactic's own goal.
  const rf = b.find((n) => n.type === "tactic" && n.label.startsWith("refine \u27e82 * k * k"));
  t.ok(!!rf, "`refine \u27e82 * k * k, ?_\u27e9` found");
  t.ok((kids.get(rf.id) ?? []).every((g) => (kids.get(g.id) ?? []).every((c) => c.recovered !== "subterm")),
    "a witness and a hole graft nothing");
  // A component containing a HARVESTED step belongs to the harvest \u2014 Part B's
  // leaf already spawns that block's root goal, and a second box would draw
  // the same subtree twice.
  const cm = tree(recs[find("commented.lean")]); const ck = kidsOf(cm);
  const byExact = cm.find((n) => n.type === "tactic" && n.label.startsWith("exact \u27e8k, Or.inr (by omega)\u27e9"));
  t.ok(!!byExact, "the nested-`by` exact found");
  const under = ck.get(byExact.id) ?? [];
  t.eq(under.length, 1, "\u2026one goal under it, the `by` block's own");
  t.eq((ck.get(under[0].id) ?? []).filter((c) => c.recovered === "subterm").length, 0,
    "\u2026and no second copy of it as a subterm");
  const plain = cm.find((n) => n.type === "tactic" && n.label.startsWith("exact \u27e80, Or.inl rfl\u27e9"));
  t.eq((ck.get(plain.id) ?? []).length, 1, "\u2026while a plain component beside it does get its box");
  t.eq((ck.get((ck.get(plain.id) ?? [])[0].id) ?? [])[0]?.label, "Or.inl rfl", "\u2026with the component's text");
}

// PART B2 — HYPOTHESIS PROVENANCE (`hypOrigins` on the wire, `originById` in
// proofToTree).  Which earlier step bound each context line, resolved to the
// TACTIC NODE the view draws.  Every number MEASURED 2026-09-09 on the CLI
// corpus; assertions name the tactic's TEXT and LINE, never an id.
{
  const hu = find("hyp_used", 1);
  const b = tree(recs[hu]); const byId = byIdOf(b);
  const root = b.find((n) => n.parents.length === 0);
  t.eq((root.hyps ?? []).filter((l) => l.origin).length, 0, "a statement binder has no origin");
  const g = goalWithHyp(b, "hk");
  t.ok(!!g, "the goal `rintro` opened found by its hyp");
  const line = (n, pre) => (n.hyps ?? []).find((l) => l.text.startsWith(pre));
  const hk = line(g, "hk"), kk = line(g, "k "), mm = line(g, "m ");
  t.eq(hk?.originLine, 26, "`hk` was introduced on line 26");
  t.eq(kk?.originLine, 26, "…and `k` with it, by the same step");
  t.eq(hk?.origin, kk?.origin, "…one tactic node for both");
  t.ok(byId.get(hk.origin)?.type === "tactic", "…and it is a tactic node");
  t.ok(byId.get(hk.origin)?.label.startsWith("rintro \u27e8k, hk\u27e9"), "…the `rintro` itself");
  t.eq(hk?.originText, "rintro \u27e8k\u2026", "…whose head word is what the title says");
  t.eq(mm?.origin, undefined, "…while the binder `m` beside them still has none");
  // `all_marked`: every line of it is a statement binder, so the sidecar is
  // EMPTY and (by resultToJson's non-empty rule) absent from the record.
  t.eq((recs[find("hyp_used", 2)].data.proof.hypOrigins ?? []).length, 0, "a proof that introduces nothing ships no origins");

  // odd_sums: a `have`, a `by_cases`, an `obtain`, and the first-writer rule
  // seen from the other side — `rw \u2026 at hn` re-mints `hn`, so the rewriting
  // step is the origin of the hypothesis it produced.
  const o = tree(recs[odd]); const oById = byIdOf(o);
  const key = line(goalWithHyp(o, "key"), "key");
  t.eq(key?.originLine, 17, "`key` comes from the `have` on line 17");
  t.ok(oById.get(key.origin)?.label.startsWith("have key"), "…resolved to that `have`'s node");
  const even = o.find((n) => n.type === "goal" && (n.hyps ?? []).some((l) => l.text === "hn : Even n"));
  t.eq(line(even, "hn")?.originLine, 67, "`hn : Even n` comes from the `by_cases` on line 67");
  const odd2 = o.find((n) => n.type === "goal" && (n.hyps ?? []).some((l) => l.text === "hn : Odd n"));
  t.eq(line(odd2, "hn")?.originLine, 75, "`hn : Odd n` comes from the `rw \u2026 at hn` that re-minted it, not the `by_cases`");
  t.ok(line(odd2, "hn").originText.startsWith("rw [Nat.not_even_iff_odd]"), "…and the title names that rewrite");
  const obt = o.find((n) => n.type === "goal" && (n.hyps ?? []).some((l) => l.text === "hk : n = 2 * k + 1"));
  t.eq(line(obt, "hk")?.originLine, 76, "the `obtain` below it introduces `hk`");

  // Corpus-wide: an origin always names a tactic node of the SAME tree (an id
  // that resolves to nothing would draw a wash on no box), and every line
  // carrying one carries all three fields.
  let withOrigin = 0;
  for (const [i, rec] of recs.entries()) {
    const nodes = tree(rec); const m = byIdOf(nodes);
    for (const n of nodes) for (const l of n.hyps ?? []) {
      if (!l.origin) { t.eq(l.originText, undefined, `#${i} originText without an origin`); continue; }
      withOrigin++;
      t.eq(m.get(l.origin)?.type, "tactic", `#${i} origin ${l.origin} is not a drawn tactic`);
      t.ok(typeof l.originText === "string" && l.originText.length > 0, `#${i} origin with no head word`);
      t.ok(l.originLine >= 1, `#${i} origin with no line`);
    }
  }
  // 2026-09-09: every corpus-wide total below moved by exactly the arrival of
  // `proofs/rename.lean` (D5's specimen, 3 short proofs / 7 tactic nodes).
  // 390→395 origins, 244→251 steps, 61→64 / 70→73 lemma refs, 36→37 traces,
  // 212→219 undecided shapes. Nothing else in the corpus changed.
  t.eq(withOrigin, 409, "context lines carrying provenance, corpus-wide");
}

// PART B3 — LEMMA REFERENCES (`lemmaRefs` on both wires, `lemmasAt` in
// proofToTree).  The constants a step's tactic text NAMES, with the
// environment's docstring.  Every number MEASURED 2026-09-09 on the CLI
// corpus; assertions name the tactic's TEXT, never a position.
{
  const b = tree(recs[odd]);
  const lem = (pre) => b.find((n) => n.type === "tactic" && n.label.startsWith(pre));
  const names = (pre) => (lem(pre)?.lemmas ?? []).map((l) => l.name);

  // INNERMOST attribution.  `have key … := by induction m with … rw
  // [Finset.sum_range_succ]` contains the `rw`, and the `rw` is a harvested
  // step of its own, so the lemma is the INNER step's alone.
  t.eq(names("rw [Finset.sum_range_succ]").join(" "), "Finset.sum_range_succ", "the inner `rw` owns its lemma");
  t.eq(names("rw [add_comm]").join(" "), "add_comm", "…and the `rw` beside it owns its own");
  t.ok(!names("have key").includes("Finset.sum_range_succ"), "…the enclosing `have key` does NOT repeat it");
  // What the `have key` step does own is what its OWN text names — plus the
  // two constructor names of the `induction … with | zero | succ` beneath it,
  // whose case labels sit outside the `induction` step's own range and so
  // fall to the innermost step that does contain them.  Measured, not chosen.
  t.eq(names("have key").join(" "), "Finset.range Nat.zero Nat.succ", "`have key` owns its statement's constants");
  t.eq((lem("induction m with")?.lemmas ?? []).length, 0, "the `induction` step's own range names nothing");

  // DEDUPE by name, SOURCE ORDER of first occurrence.  `Even` is written
  // twice in `have parity`'s statement and appears once.
  t.eq(names("have parity").join(" "), "Even", "a name written twice is listed once");
  t.eq(names("exact (Nat.not_even_iff_odd").join(" "), "Nat.not_even_iff_odd", "a projection `.mpr` still names its constant");

  // A LOCAL `have` IS AN FVAR, NOT A CONSTANT.  The closing
  // `exact ⟨key n, parity n, gap n, residue⟩` names four of them and NOTHING
  // else, and neither do its B1 subterm leaves.
  t.eq((lem("exact ⟨key n")?.lemmas ?? []).length, 0, "the closing `exact` names no constant — `key` &c are fvars");
  for (const leaf of ["key n", "parity n", "gap n", "residue"])
    t.eq((b.find((n) => n.type === "tactic" && n.label === leaf)?.lemmas ?? []).length, 0, `the subterm leaf ${leaf} names no constant`);

  // KIND and DOC come from the environment.
  const kindOf = (pre, nm) => (lem(pre)?.lemmas ?? []).find((l) => l.name === nm);
  t.eq(kindOf("have parity", "Even")?.kind, "def", "`Even` is a def");
  t.ok(!!kindOf("have parity", "Even")?.doc, "…and carries its docstring");
  t.eq(kindOf("rw [Finset.sum_range_succ]", "Finset.sum_range_succ")?.kind, "theorem", "`Finset.sum_range_succ` is a theorem");

  // Corpus-wide: every `stepStart` resolves to a DRAWN TACTIC NODE (a
  // reference hung on nothing would be a premise no reader can reach), no
  // node repeats a name, and the coverage numbers C will quote.
  let steps = 0, withLemmas = 0, refs = 0, withDoc = 0;
  for (const [i, rec] of recs.entries()) {
    const nodes = tree(rec);
    const at = new Set(nodes.filter((n) => n.type === "tactic" && n.position)
      .map((n) => `${n.position.start.line}:${n.position.start.character}`));
    for (const r of rec.data.proof.lemmaRefs ?? []) {
      refs++; if (r.doc) withDoc++;
      t.ok(at.has(`${r.stepStart.line}:${r.stepStart.character}`), `#${i} lemmaRef ${r.name} hangs on no tactic node`);
      t.ok(typeof r.name === "string" && r.name.length > 0, `#${i} nameless lemmaRef`);
    }
    for (const n of nodes) {
      if (n.type === "tactic") steps++;
      if (!n.lemmas?.length) continue;
      withLemmas++;
      t.eq(n.type, "tactic", `#${i} a goal node carries lemmas`);
      t.eq(new Set(n.lemmas.map((l) => l.name)).size, n.lemmas.length, `#${i} duplicate name on ${n.id}`);
    }
  }
  t.eq(steps, 251, "tactic nodes, corpus-wide");
  t.eq(withLemmas, 64, "…of which name at least one constant");
  t.eq(refs, 73, "lemma references, corpus-wide");
  t.eq(withDoc, 29, "…of which carry a docstring");
}

// PART B4 — AUTOMATION TRACES (`automationTraces` on the offline wire via
// `gen.sh`, the `ProofTree.getAutomationTrace` RPC in the widget; `applyTraces`
// on the DRAWN tree).  Every number MEASURED 2026-09-09 over the CLI corpus.
{
  // THE SUBTREE ADDS NOTHING UNTIL IT IS OPENED.  This is the whole reason
  // `applyTraces` runs after `applyElisions` and is invisible to elide.ts: an
  // empty open-set must leave the drawn tree byte-for-byte what it was, or
  // every cut number above would be measuring a different tree.
  const b = tree(recs[odd]);
  const idx = traceIndex(recs[odd].data.proof.automationTraces);
  t.eq(applyTraces(b, new Set(), idx).length, b.length, "a closed trace adds no node");

  // The stamp goes on regardless (the step's `<title>` gains its `via simp?:`
  // line as soon as the answer is in), and odd_sums' one `simp` is the specimen.
  const stamped = applyTraces(b, new Set(), idx);
  const simp = stamped.find((n) => n.type === "tactic" && n.label === "simp");
  t.ok(!!simp?.trace, "the `simp` step carries its trace once the answer is in");
  t.eq(simp?.trace?.kind, "lemmas", "…of kind `lemmas`");
  t.eq(simp?.trace?.lemmas?.length, 6, "…naming six lemmas");
  t.eq(simp?.trace?.lemmas?.[0]?.name, "Finset.range_zero", "…the first being Finset.range_zero");
  t.ok(simp?.trace?.suggestion?.startsWith("simp only ["), "…and keeping core's own text");

  // OPEN: one dashed leaf per lemma, parented on the step, positionless (so
  // nothing offers to edit, reveal, delete or flag them) and id'd from the
  // step's own position, which is what carries them across a re-parse.
  const open = applyTraces(b, new Set([simp.id]), idx);
  const leaves = open.filter((n) => n.traceLeaf);
  t.eq(open.length, b.length + 6, "opening the trace adds one node per lemma");
  t.eq(leaves.length, 6, "…all of them trace leaves");
  t.ok(leaves.every((n) => n.parents[0]?.id === simp.id), "…parented on the step");
  t.ok(leaves.every((n) => !n.position), "…and positionless");
  t.eq(leaves[0].id, `trace:${traceKey(simp.position.start)}:0`, "leaf ids are position-derived");

  // AN OPAQUE step still answers: one leaf saying so, rather than the silence
  // that reads as a broken affordance.
  const omega = stamped.find((n) => n.type === "tactic" && n.label === "omega");
  t.eq(omega?.trace?.kind, "opaque", "`omega` traces as opaque");
  const oo = applyTraces(b, new Set([omega.id]), idx).filter((n) => n.traceLeaf);
  t.eq(oo.length, 1, "…and opens to exactly one line");
  t.eq(oo[0].label, "omega keeps no lemma list", "…which says so");

  // WHO GETS THE AFFORDANCE: a source fact (head word + a position), so the
  // button is there before any round trip.
  t.eq(tacticHeadWord("simp only [foo] at h"), "simp", "head word of a simp with arguments");
  t.eq(tacticHeadWord("exact? says exact foo"), "exact?", "…and `exact?` is one word");
  t.ok(isAutomationNode(simp), "`simp` is an automation node");
  t.ok(!isAutomationNode(b.find((n) => n.type === "tactic" && n.label.startsWith("have key"))), "`have` is not");

  // Corpus-wide: every trace hangs on a drawn tactic node that the client
  // would OFFER the affordance for, and the coverage numbers.
  let traces = 0, lemmas = 0, kinds = {}, offered = 0;
  for (const [i, rec] of recs.entries()) {
    const nodes = tree(rec);
    const at = new Map(nodes.filter((n) => n.type === "tactic" && n.position)
      .map((n) => [`${n.position.start.line}:${n.position.start.character}`, n]));
    for (const tr of rec.data.proof.automationTraces ?? []) {
      traces++; lemmas += (tr.lemmas ?? []).length;
      kinds[tr.kind] = (kinds[tr.kind] ?? 0) + 1;
      const n = at.get(`${tr.stepStart.line}:${tr.stepStart.character}`);
      t.ok(!!n, `#${i} trace for ${tr.tactic} hangs on no tactic node`);
      if (n && isAutomationNode(n)) offered++;
    }
  }
  t.eq(traces, 37, "automation traces, corpus-wide");
  t.eq(offered, 37, "…every one of them on a node the client offers the affordance for");
  t.eq(kinds.opaque, 27, "…opaque (no `?` form: omega, ring, linarith, norm_num)");
  t.eq(kinds.lemmas, 10, "…with a lemma list (9 `simp` + multiline.lean's `grind`)");
  t.eq(kinds.failed, undefined, "…and none reporting nothing");
  t.eq(lemmas, 22, "lemmas named across the corpus");
}

// PART B5 — CASE/BRANCH SEMANTICS (`branches` on both wires, from the tactic's
// SYNTAX KIND).  What this block pins: the sidecar's own shape on the fixtures
// the brief named, that every arm resolves to a goal the client DRAWS, that
// the arm's tag is the tag Lean gave that goal, and that no drawn tactic node
// still has its shape decided by a label regex.
{
  const b = tree(recs[odd]);
  const brOf = (i, line) =>
    (recs[i].data.proof.branches ?? []).find((x) => x.stepStart.line === line);
  const arm = (br, tag) => br?.arms.find((a) => a.tag === tag);

  // `induction m with | zero => … | succ k ih => …` — tags from the alternatives
  // the author wrote (which is also what makes `using` eliminators right), the
  // binders the arm names beside them.
  const ind = brOf(odd, 18);
  t.eq(ind?.form, "induction", "odd_sums induction form");
  t.eq(ind?.on, "m", "…on m");
  t.eq(ind?.withAlts, true, "…with a `with` block");
  t.eq(ind?.arms.map((a) => a.tag).join(" "), "zero succ", "…arms zero succ");
  t.eq(arm(ind, "zero")?.binders.join(" "), "", "…zero binds nothing");
  t.eq(arm(ind, "succ")?.binders.join(" "), "k ih", "…succ binds k ih");
  t.ok(
    b.some((n) => n.caseLabel === "succ k ih"),
    "…and the case badge reads `succ k ih`, not `succ`",
  );

  // `obtain ⟨k, hk⟩ := hn` — one arm, the pattern verbatim, the binders in it.
  const ob = brOf(odd, 69);
  t.eq(ob?.form, "obtain", "odd_sums obtain form");
  t.eq(ob?.on, "hn", "…on hn");
  t.eq(ob?.arms.length, 1, "…one arm");
  t.eq(ob?.arms[0].binders.join(" "), "k hk", "…binding k hk");
  t.eq(ob?.arms[0].pattern, "⟨k, hk⟩", "…with the pattern verbatim");

  // `by_cases hn : Even n` — pos/neg, the two names its own macro writes, both
  // binding the hypothesis the author named.
  const bc = brOf(odd, 66);
  t.eq(bc?.form, "by_cases", "odd_sums by_cases form");
  t.eq(bc?.on, "Even n", "…on Even n");
  t.eq(bc?.arms.map((a) => a.tag).join(" "), "pos neg", "…arms pos neg");
  t.eq(bc?.arms.map((a) => a.binders.join("")).join(" "), "hn hn", "…both binding hn");

  // `rcases Nat.even_or_odd m with he | ho` — two arms, tags ADOPTED from the
  // goals Lean named positionally.
  const rc = brOf(odd, 51);
  t.eq(rc?.form, "rcases", "odd_sums rcases form");
  t.eq(rc?.on, "Nat.even_or_odd m", "…on Nat.even_or_odd m");
  t.eq(rc?.arms.map((a) => a.tag).join(" "), "inl inr", "…arms inl inr");
  t.eq(rc?.arms.map((a) => a.pattern).join(" "), "he ho", "…patterns he ho");

  // `constructor` on an ↔ splits into the TARGET STRUCTURE's fields.
  const co = brOf(odd, 43);
  t.eq(co?.form, "constructor", "odd_sums constructor form");
  t.eq(co?.arms.map((a) => a.tag).join(" "), "mp mpr", "…arms mp mpr (Iff's fields)");
}
{
  // Corpus-wide: every arm names a goal the client draws, and the arm's tag is
  // that goal's own tag.  `branches` reserves nothing and mints no node, so
  // every count above still means what it meant.
  let arms = 0, forms = new Map();
  for (const [i, rec] of recs.entries()) {
    const nodes = tree(rec);
    const ids = new Map(nodes.map((n) => [n.id, n]));
    for (const br of rec.data.proof.branches ?? []) {
      forms.set(br.form, (forms.get(br.form) ?? 0) + 1);
      for (const a of br.arms) {
        arms++;
        t.ok(!!a.goalId, `#${i} ${br.form} arm ${a.tag} unresolved`);
        if (!a.goalId) continue;
        const g = ids.get(a.goalId);
        t.ok(!!g && g.type === "goal", `#${i} ${br.form} arm ${a.tag} names no drawn goal`);
        if (g) t.eq(g.arm?.tag, a.tag, `#${i} ${br.form} arm ${a.tag} on the wrong goal`);
      }
    }
  }
  t.eq(arms, 72, "arms across the corpus, every one resolved");
  t.eq(forms.get("induction"), 8, "induction steps");
  t.eq(forms.get("rewrite"), 40, "rewrite steps (what MAIN_FIRST_RE used to answer)");
  t.eq(forms.get("obtain"), 12, "obtain steps");
  t.eq(forms.get("rcases"), 5, "rcases steps");
  t.eq(forms.get("constructor"), 5, "constructor steps");
  t.eq(forms.get("refine"), 11, "refine steps");
  t.eq(forms.get("by_cases"), 3, "by_cases steps");
  t.eq(forms.get("rintro"), 4, "rintro steps");
  t.eq(forms.get("match"), 1, "match steps (form only — arms undecoded)");

  // The point of B5: nothing's SHAPE is decided by a label regex any more.
  const shape = {};
  for (const rec of recs)
    for (const n of tree(rec))
      if (n.type === "tactic" && n.shapeSource)
        shape[n.shapeSource] = (shape[n.shapeSource] ?? 0) + 1;
  t.eq(shape.regex, undefined, "no drawn tactic node still shaped by a regex");
  t.eq(shape.branch, 32, "multi-goal tactic nodes shaped by the sidecar");
  t.eq(shape.none, 219, "…and single-goal ones with nothing to decide");

  // Child ORDER is the harvest's on every corpus record: the arms' source
  // order and Lean's own goal order agree everywhere here, so B5 moved nothing.
  let moved = 0;
  for (const rec of recs) {
    const withB = tree(rec).map((n) => n.id).join("|");
    const bare = JSON.parse(JSON.stringify(rec));
    delete bare.data.proof.branches;
    if (withB !== tree(bare).map((n) => n.id).join("|")) moved++;
  }
  t.eq(moved, 0, "records whose drawn node order changed when B5 landed");
}

t.done();
