// Fixture invariants for the cut mechanism (fold and hop = goal-keyed cuts,
// drawn as a `+N` on the goal itself and minting NO node; step and band mint
// one ghost, and a step now only where no hop can be read).  Re-run after touching elide.ts,
// proofToTree.ts or layout.ts:   npm run probe -- counts
// Every number here was measured, not derived; a change is a finding to
// record in CLAUDE.md, not a baseline to bump silently.
import { sourceView, outlineCuts, goalCut, resolveCut, cutId, applyElisions, stepElidable, continuationOf, remapCut, pruneCuts, linearStep, coalesceCuts, stepCut, hopForStep, hopForBand, hopCaption, isSeededCut, SEED_MARK, foldSeedCuts, noneSeedCut, authorStops, tourList, firstSentence, remapIds } from "./lib.mjs";
import { records, tree, byIdOf, kidsOf, find, goalWithHyp, structural, tally } from "./corpus.mjs";

const t = tally();
const recs = records();
const drawn = (base, cuts) => applyElisions(base, cuts);
const N = (i, cuts) => drawn(tree(recs[i]), cuts).length;

const odd = find("odd_sums"), fac = find("factorization"), demo = find("flags.lean", 0), nested = find("flags.lean", 2);
t.eq(N(odd, sourceView(tree(recs[odd]))), 70, "odd_sums seeded");
t.eq(N(demo, sourceView(tree(recs[demo]))), 13, "flag_demo seeded");
t.eq(N(nested, sourceView(tree(recs[nested]))), 3, "flag_nested seeded");
{
  const b = tree(recs[odd]); const byId = byIdOf(b); const kids = kidsOf(b); const se = stepElidable(b); const seeds = sourceView(b);
  const root = b.find((n) => n.parents.length === 0);
  const g1 = goalWithHyp(b, "key", "gap");
  const succ = b.find((n) => n.type === "goal" && n.caseLabel === "succ");
  const opts = { trunk: true, stepElidable: se };
  const cr = goalCut(byId, root.id, opts, kids); t.eq(cr?.kind, "hop", "root cut kind (trunk)"); t.eq(N(odd, [...seeds, cr]), 55, "root hop (keeps the goal the next step solves)");
  t.ok(g1, "goal after `have key` found by hyp");
  if (g1) { const c = goalCut(byId, g1.id, opts, kids); t.eq(c?.kind, "hop", "goal-after-key kind"); const d = drawn(b, [...seeds, c]); t.eq(d.length, 68, "goal-after-key hop"); t.ok(d.some((n) => n.label.startsWith("have parity")), "the trunk below the skipped step still drawn"); t.ok(d.some((n) => n.label.startsWith("exact ⟨key n")), "closing exact still drawn"); }
  const cs = goalCut(byId, succ.id, opts, kids); t.eq(cs?.kind, "fold", "succ cut kind"); t.eq(N(odd, [...seeds, cs]), 63, "succ fold");
  const cw = goalCut(byId, root.id, { trunk: false, stepElidable: se }, kids); t.eq(cw?.kind, "fold", "wide root kind"); t.eq(N(odd, [cw]), 1, "wide root fold");
  const d = drawn(b, outlineCuts(byId, kids)); t.eq(d.length, 14, "collapse-all odd_sums"); t.eq(d.filter((n) => n.folded).length, 4, "collapse-all folded goals");
  { const f = tree(recs[fac]); t.eq(drawn(f, outlineCuts(byIdOf(f), kidsOf(f))).length, 7, "collapse-all factorization"); }
}
// every goal × goalCut, both trunk readings: resolves, one marker, structure sound, continuation kept
for (const [i, rec] of recs.entries()) {
  const b = tree(rec); if (!b.length) continue;
  const byId = byIdOf(b), kids = kidsOf(b), se = stepElidable(b);
  structural(b, `#${i} base`, (m) => t.ok(false, m));
  for (const trunk of [true, false]) for (const g of b.filter((n) => n.type === "goal")) {
    const c = goalCut(byId, g.id, { trunk, stepElidable: se }, kids); if (!c) continue;
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
  // every tactic × ◌: the cut resolves, keeps the continuation, stays sound.
  for (const trunk of [true, false]) for (const tac of b.filter((n) => n.type === "tactic" && se.has(n.id))) {
    const c = stepCut(byId, tac.id, { trunk, stepElidable: se }, kids); if (!c) continue;
    const members = resolveCut(c, byId); t.ok(members.length > 0, `#${i} ◌ on ${tac.id} resolves empty`);
    const d = drawn(b, [c]); structural(d, `#${i} ◌ ${cutId(c)}`, (m) => t.ok(false, m));
    if (c.kind === "hop") {
      t.ok(d.some((n) => n.id === c.id), `#${i} ◌ on ${tac.id} lost the goal it hangs off`);
      const cont = continuationOf(byId, tac.id, kids);
      if (cont) t.ok(d.some((n) => n.id === cont.id), `#${i} ◌ on ${tac.id} lost its continuation`);
      t.ok(members.includes(tac.id), `#${i} ◌ on ${tac.id} did not hide it`);
    }
    // a LEAF under a goal: ◌ is exactly the fold of that goal (skip and
    // collapse reach one state), and the goal survives wearing the count.
    if ((kids.get(tac.id) ?? []).length === 0 && byId.get(tac.parents[0]?.id)?.type === "goal") {
      const g = tac.parents[0].id;
      t.eq(c.kind, "fold", `#${i} ◌ on leaf ${tac.id} kind`); t.eq(c.id, g, `#${i} ◌ on leaf ${tac.id} folds its goal`);
      const gc = goalCut(byId, g, { trunk, stepElidable: se }, kids);
      t.eq(cutId(c), cutId(gc), `#${i} ◌ on leaf ${tac.id} ≠ goal's own −`);
      t.ok(d.some((n) => n.id === g && n.folded), `#${i} ◌ on leaf ${tac.id} lost its goal`);
    }
  }
  for (const n of b) if (n.type === "tactic" && (kids.get(n.id) ?? []).length === 0 && byId.get(n.parents[0]?.id)?.type === "goal")
    t.ok(se.has(n.id), `#${i} leaf ${n.id} under a goal is not ◌-able`);
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

// ◌ on a step IS the goal above hopping over it: one position, one look.
{
  const b = tree(recs[odd]); const byId = byIdOf(b); const kids = kidsOf(b); const se = stepElidable(b); const seeds = sourceView(b);
  const opts = { trunk: true, stepElidable: se };
  const root = b.find((n) => n.parents.length === 0); const key = kids.get(root.id)[0];
  t.ok(key.label.startsWith("have key"), "`have key` is the root's step");
  const sc = stepCut(byId, key.id, opts, kids); const gc = goalCut(byId, root.id, opts, kids);
  t.eq(sc?.kind, "hop", "◌ on a step with side work hops"); t.eq(cutId(sc), cutId(gc), "◌ and the goal's − mint the same cut");
  t.eq(applyElisions(b, [...seeds, sc]).map((n) => n.id).join(), applyElisions(b, [...seeds, gc]).map((n) => n.id).join(), "…and so draw the same tree");
  // A step with no continuation has no hop to give: the goal above folds.
  const ind = b.find((n) => n.type === "tactic" && n.label.startsWith("induction"));
  t.ok(!continuationOf(byId, ind.id, kids), "`induction m with` has no continuation");
  t.eq(stepCut(byId, ind.id, opts, kids)?.kind, "fold", "a step with no continuation folds its goal");
  t.eq(hopForStep(byId, ind.id, kids), null, "…and mints no hop");
}

// ◌ on `have parity`: the hop from the goal above it, keeping the trunk.
{
  const b = tree(recs[odd]); const byId = byIdOf(b); const kids = kidsOf(b); const se = stepElidable(b); const seeds = sourceView(b);
  const parity = b.find((n) => n.type === "tactic" && n.label.startsWith("have parity"));
  const c = stepCut(byId, parity.id, { trunk: true, stepElidable: se }, kids);
  t.eq(c?.kind, "hop", "◌ on `have parity` hops"); t.eq(c.id, parity.parents[0].id, "…from the goal above it");
  const d = applyElisions(b, [...seeds, c]);
  t.eq(d.length, 44, "parity hop drawn");
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
  // A `.none` on a step with NO continuation keeps its ghost — the author's
  // sentence needs a box; there is no break to write it beside.
  const cl = tree(recs[find("flags.lean", 1)]); const closing = sourceView(cl);
  t.eq(closing.length, 1, "flag_closing seeds one cut"); t.eq(closing[0].kind, "step", "…a ghost, not a hop");
  t.eq(applyElisions(cl, closing).filter((n) => n.elidedCut).length, 1, "…and it is drawn");
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
  const mine = stepCut(byId, parity.id, { trunk: true, stepElidable: se }, kids);
  t.ok(!isSeededCut(mine), "a reader's ◌ mints no seed");
  const gm = applyElisions(b, [mine]).find((n) => n.id === mine.id);
  t.eq(gm.folded.seeded, undefined, "…and stamps none on the goal");
  t.ok(!hopCaption(gm.folded).text.startsWith(SEED_MARK), "…and its caption bears no mark");
  // A seeded GHOST (a `.none` on a closing step) carries the mark IN ITS
  // LABEL, which is what `ghostSize` measures.
  const cl = tree(recs[find("flags.lean", 1)]); const ghost = applyElisions(cl, sourceView(cl)).find((n) => n.elidedCut);
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
  const succ = b.find((n) => n.type === "goal" && n.caseLabel === "succ");
  const [f] = foldSeedCuts(byId, [succ.id]);
  t.eq(isSeededCut(f), true, "the pill's .fold is seeded the moment it is written");
  t.eq(f.seededBy, "fold", "…in the .fold voice");
  t.eq(cutId(f), cutId(goalCut(byId, succ.id, { trunk: true, stepElidable: se }, kids)), "…at the position the reader's − reaches");
  t.eq(applyElisions(b, [f]).find((n) => n.id === succ.id).folded.seededBy, "fold", "…and it stamps the goal at once");
  const parity = b.find((n) => n.type === "tactic" && n.label.startsWith("have parity"));
  const nc = noneSeedCut(byId, parity.id, "not worth reading");
  t.eq(isSeededCut(nc), true, "the pill's .none is seeded too");
  t.eq(nc.seededBy, "none", "…in the .none voice");
  t.eq(cutId(nc), cutId(stepCut(byId, parity.id, { trunk: true, stepElidable: se }, kids)), "…at the position ◌ reaches");
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

t.done();
