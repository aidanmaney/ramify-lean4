// The run below a HOPPED goal must hold the axis break with line on both
// sides, and the CAPTION beside that break — paint on a link, so nothing in the
// layout reserves room for it — must not land on a node box, in all four
// layouts.  Since 2026-09-17 ◌ hops inside BRANCHES as well as on the trunk, so
// the sweep is every hop a reader can mint (each step's ◌) plus the source's
// seeded ones.  And the look must name the verb: a hop always has a link to
// break (one kept child), a fold never does (no child left).
//   npm run probe -- hopgap
import * as lib from "./lib.mjs";
import { records, tree, find, tally, readerCuts } from "./corpus.mjs";
const { applyElisions, createLayoutEngine, bandTopH, TRUNK_GAP_HOP, hopCaption, hopCaptionWidth, HOP_CAPTION_GAP, BADGE_H, TRUNK_INSET, sourceView, SEED_MARK } = lib;
const t = tally();
t.eq(TRUNK_GAP_HOP, 34, "TRUNK_GAP_HOP");
// Wide (Sugiyama) reserves its own 42px between layers, more than the break
// needs; measured 2026-09-17: min 43 over every hop in the corpus.
const WIDE_MIN_GAP = 42;

const MODES = { stacked: [true, false, false], spine: [true, false, true], tracks: [true, false, "track"], wide: [false, false, false] };
const rectOf = (p) => { const half = (bandTopH(p.data) + p.data.h) / 2; return { x0: p.x - p.data.w / 2, x1: p.x + p.data.w / 2, y0: p.y + half - p.data.h, y1: p.y + half }; };
const hit = (a, c) => a.x0 < c.x1 - 0.5 && c.x0 < a.x1 - 0.5 && a.y0 < c.y1 - 0.5 && c.y0 < a.y1 - 0.5;
let swept = 0, seededSwept = 0, branchHops = 0, hops = 0, folds = 0;
const minGap = {};
for (const [i, rec] of records().entries()) {
  const base = tree(rec); if (base.length < 3) continue;
  const byId = new Map(base.map((n) => [n.id, n]));
  const mine = readerCuts(lib, base);
  for (const f of mine.filter((c) => c.kind === "fold")) {
    folds++;
    const ns = applyElisions(base, [f]);
    t.ok(!ns.some((n) => n.parents.some((p) => p.id === f.id)), `#${i} fold on ${f.id} left a link to break`);
    t.eq(ns.find((n) => n.id === f.id)?.folded?.kind, "fold", `#${i} fold on ${f.id} stamps a fold`);
  }
  const seen = new Set();
  for (const cut of [...sourceView(base), ...mine].filter((c) => c.kind === "hop")) {
    const k = lib.cutId(cut) + (cut.seeded ? "§" : ""); if (seen.has(k)) continue; seen.add(k);
    hops++;
    const g0 = byId.get(cut.id);
    // Inside a branch = some goal on the way up from here is a branch root
    // (not its producer's continuation): a case, a spawned by-block, a side goal.
    let inBranch = false;
    for (let n = g0; n && n.parents.length > 0; n = byId.get(n.parents[0].id))
      if (n.type === "goal" && n.parents.every((p) => lib.continuationOf(byId, p.id)?.id !== n.id)) { inBranch = true; break; }
    if (inBranch) branchHops++;
    const ns = applyElisions(base, [cut]);
    const hopped = ns.find((n) => n.id === cut.id); if (!hopped?.folded) { t.ok(false, `#${i} ${cut.id}: hop stamped nothing`); continue; }
    t.eq(hopped.folded.kind, "hop", `#${i} ${cut.id}: stamped kind`);
    t.eq(ns.filter((n) => n.parents.some((p) => p.id === cut.id)).length, 1, `#${i} ${cut.id}: a hop keeps exactly one child to break above`);
    const cap = hopCaption(hopped.folded); if (!cap) { t.ok(false, `#${i} ${cut.id}: no caption on a hop`); continue; }
    if (hopped.folded.seeded) {
      seededSwept++;
      t.ok(cap.text.startsWith(SEED_MARK) && cap.italic, `#${i} ${cut.id}: seeded caption unmarked`);
    }
    const w = hopCaptionWidth(cap.text, cap.italic);
    for (const [mode, [compact, sbs, aside]] of Object.entries(MODES)) {
      const { nodes: ps } = createLayoutEngine(ns, { chips: true }).computeLayout(null, null, compact, sbs, null, aside);
      const src = ps.find((p) => p.data.id === cut.id);
      const dst = ps.find((p) => p.data.parents.some((q) => q.id === cut.id));
      if (!src || !dst) { t.ok(false, `#${i} ${mode} ${cut.id}: hop not placed`); continue; }
      const sBottom = src.y + (bandTopH(src.data) + src.data.h) / 2;
      const dTop = dst.y - (bandTopH(dst.data) + dst.data.h) / 2;
      const gap = +(dTop - sBottom).toFixed(1);
      minGap[mode] = Math.min(minGap[mode] ?? Infinity, gap);
      if (compact) t.eq(gap, TRUNK_GAP_HOP, `#${i} ${mode} run below hopped ${cut.id}`);
      else t.ok(gap >= WIDE_MIN_GAP, `#${i} wide run below hopped ${cut.id}: ${gap}`);
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
console.log(`hops ${hops} (inside branches ${branchHops}), folds ${folds}; caption placements swept ${swept} (seeded captions ${seededSwept})`);
console.log(`min gap below a hopped goal: ${Object.entries(minGap).map(([m, g]) => `${m} ${g}`).join(", ")}`);
t.ok(seededSwept > 0, "no seeded caption in the sweep");
t.ok(branchHops > 0, "no hop inside a branch in the sweep");
void find;
t.done();
