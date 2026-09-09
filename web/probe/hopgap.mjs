// The run below a HOPPED goal must hold the axis break with line on both
// sides (measured gap vs TRUNK_GAP_HOP), and the CAPTION beside that break —
// paint on a link, so nothing in the layout reserves room for it — must not
// land on a node box in any of the four layouts.  npm run probe -- hopgap
import { applyElisions, createLayoutEngine, bandTopH, TRUNK_GAP_HOP, hopCaption, hopCaptionWidth, HOP_CAPTION_GAP, BADGE_H, TRUNK_INSET, sourceView, goalCut, stepElidable, SEED_MARK } from "./lib.mjs";
import { records, tree, byIdOf, kidsOf, find, tally } from "./corpus.mjs";
const t = tally();
const b = tree(records()[find("odd_sums")]);
const keyRoot = b.find((n) => n.type === "goal" && n.spawned && n.label.includes("∀ (m : ℕ), ∑ i ∈ Finset.range m"));
const nodes = applyElisions(b, [{ kind: "hop", id: keyRoot.id, steps: 1 }]);
const { nodes: placed } = createLayoutEngine(nodes).computeLayout(null, null, true, false, null, false);
const g = placed.find((p) => p.data.id === keyRoot.id); const kid = placed.find((p) => p.data.parents.some((q) => q.id === keyRoot.id));
const gBottom = g.y + (bandTopH(g.data) + g.data.h) / 2; const kTop = kid.y - (bandTopH(kid.data) + kid.data.h) / 2;
t.eq(+(kTop - gBottom).toFixed(1), TRUNK_GAP_HOP, "run below a hopped goal"); t.eq(TRUNK_GAP_HOP, 34, "TRUNK_GAP_HOP");

// The caption's ink: a rect [x, x + measured] × [y ± BADGE_H/2] at the
// MIDPOINT of the run below the hopped goal, on the trunk lane, offset right.
// The renderer's placement and this one are the same two constants.
const MODES = { stacked: [true, false, false], spine: [true, false, true], tracks: [true, false, "track"], wide: [false, false, false] };
const rectOf = (p) => { const half = (bandTopH(p.data) + p.data.h) / 2; return { x0: p.x - p.data.w / 2, x1: p.x + p.data.w / 2, y0: p.y + half - p.data.h, y1: p.y + half }; };
const hit = (a, c) => a.x0 < c.x1 - 0.5 && c.x0 < a.x1 - 0.5 && a.y0 < c.y1 - 0.5 && c.y0 < a.y1 - 0.5;
let swept = 0, seededSwept = 0;
for (const [i, rec] of records().entries()) {
  const base = tree(rec); if (base.length < 3) continue;
  const byId = byIdOf(base), kids = kidsOf(base), se = stepElidable(base);
  const cuts = [...sourceView(base).filter((c) => c.kind === "hop"),
    ...base.filter((n) => n.type === "goal").map((g) => goalCut(byId, g.id, { trunk: true, stepElidable: se }, kids)).filter((c) => c && c.kind === "hop")];
  for (const cut of cuts) {
    const ns = applyElisions(base, [cut]);
    const hopped = ns.find((n) => n.id === cut.id); if (!hopped?.folded) continue;
    const cap = hopCaption(hopped.folded); if (!cap) { t.ok(false, `#${i} ${cut.id}: no caption on a hop`); continue; }
    // A SEEDED caption is a LONGER string (`§ ` ahead of it) in ITALIC — the
    // exact string the renderer paints, so the sweep below is the honest one
    // for the author's voice too.
    if (hopped.folded.seeded) {
      seededSwept++;
      t.ok(cap.text.startsWith(SEED_MARK) && cap.italic, `#${i} ${cut.id}: seeded caption unmarked`);
    }
    const w = hopCaptionWidth(cap.text, cap.italic);
    for (const [mode, [compact, sbs, aside]] of Object.entries(MODES)) {
      const { nodes: ps } = createLayoutEngine(ns, { chips: true }).computeLayout(null, null, compact, sbs, null, aside);
      const src = ps.find((p) => p.data.id === cut.id);
      const dst = ps.find((p) => p.data.parents.some((q) => q.id === cut.id));
      if (!src || !dst) continue;
      const sBottom = src.y + (bandTopH(src.data) + src.data.h) / 2;
      const dTop = dst.y - (bandTopH(dst.data) + dst.data.h) / 2;
      // The renderer's own placement: the trunk lane in the compact layouts,
      // the node's own x in wide; the break at the midpoint of the run.
      const lane = compact ? src.x - src.data.w / 2 + TRUNK_INSET : src.x;
      const y = (sBottom + dTop) / 2;
      const cr = { x0: lane + HOP_CAPTION_GAP, x1: lane + HOP_CAPTION_GAP + w, y0: y - BADGE_H / 2, y1: y + BADGE_H / 2 };
      swept++;
      for (const p of ps) if (hit(rectOf(p), cr))
        t.ok(false, `#${i} ${mode} caption "${cap.text.slice(0, 20)}" over ${p.data.type} ${p.data.label.slice(0, 24)}`);
    }
  }
}
console.log(`caption placements swept ${swept} (seeded captions ${seededSwept})`);
t.ok(seededSwept > 0, "no seeded caption in the sweep");
t.done();
