// @probe
// Ink-overlap sweep for the PAINT THAT RESERVES NOTHING: the ghost markers
// (combined and marquee/`.none` boxes), the hop chip and the caption beside it,
// and a tour stop's numbered tab hung off a box's left edge.  Every seeded / outline / per-goal
// cut, combine on and off, in the five placements.  npm run probe -- overlap
import * as lib from "./lib.mjs";
import { applyNarration, sourceView, outlineCuts, applyElisions, combineRuns, resolveCut, bandTopH, commentStripTop, commentIndentOf, COMMENT_GAP, isGhostNode, hopCaption, hopCaptionWidth, HOP_CAPTION_GAP, HOP_CHIP_W, HOP_CHIP_H, BADGE_H, TRUNK_INSET, tourTabWidth, authorStops } from "./lib.mjs";
import { records, tree, byIdOf, kidsOf, readerCuts, MODES, layoutOf } from "./corpus.mjs";

// The four layouts, plus stacked with the reader's side-by-side toggle on.
const PLACEMENTS = [...MODES.map((m) => [m, m, false]), ["sbs", "stacked", true]];
const rects = (pn, wide) => {
  const d = pn.data; const top = bandTopH(d); const half = (top + d.h) / 2; const bandTop = pn.y - half; const boxTop = pn.y + half - d.h; const boxBot = pn.y + half; const out = [];
  out.push({ k: "box", x0: pn.x - d.w / 2, x1: pn.x + d.w / 2, y0: boxTop, y1: boxBot });
  // The strip as the renderer places it (`commentStripTop`/`commentIndentOf`):
  // above the box, floated, or BELOW a folded goal. A strip below is PAINT the
  // probe must check (it is new ground under the box), so it counts as `brk`.
  if (d.commentBlockH > 0) { const sx = wide ? pn.x - d.commentW / 2 : pn.x - d.w / 2 + commentIndentOf(d); const sy0 = pn.y + commentStripTop(d); const lines = d.commentBelow ? d.commentBlockH - COMMENT_GAP : d.commentBlockH; out.push({ k: d.commentBelow ? "below" : "strip", brk: !!d.commentBelow, x0: sx, x1: sx + d.commentW, y0: sy0, y1: sy0 + lines }); }
  if (d.caseH > 0) out.push({ k: "badge", x0: pn.x - d.w / 2, x1: pn.x - d.w / 2 + d.caseW, y0: bandTop, y1: bandTop + d.caseH });
  return out;
};
const hit = (a, b) => a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
let total = 0, checked = 0, belowSeen = 0;
for (const [i, rec] of records().entries()) {
  const base = tree(rec); if (base.length < 2) continue;
  const byId = byIdOf(base), kids = kidsOf(base);
  // Every cut a reader can mint, one at a time: each goal's `−` (a fold) and
  // each step's ◌ (a hop — inside branches too — or a leaf's fold). Only the
  // ones that draw a ghost or a break survive the filter below.
  const goalSets = readerCuts(lib, base).map((c) => [c]);
  for (const cuts of [sourceView(base), outlineCuts(byId, kids), ...goalSets]) for (const combine of [false, true]) {
    const manual = new Set(cuts.flatMap((c) => resolveCut(c, byId)));
    const drawn = applyElisions(base, combine ? [...cuts, ...combineRuns(base, manual)] : cuts);
    const marks = drawn.some((n) => isGhostNode(n) || n.folded?.kind === "hop");
    // A FOLD draws its narrated summary BELOW the goal (2026-09-22), so a
    // fold-only tree is swept too — in narrate mode, where that strip exists.
    const folds = drawn.some((n) => n.folded?.kind === "fold");
    if (!marks && !folds) continue;
    // …in BOTH comment modes that draw strips: `Comments: narrate` gives a
    // strip to every step the author left unremarked, which is the widest the
    // strips ever get, so the ghost/caption/tab clearances are checked against
    // it as well as against the author's own sparse comments.
    for (const narrate of [false, true]) {
    if (!narrate && !marks) continue;
    const nodes = narrate ? applyNarration(drawn, base) : drawn;
    for (const [name, mode, sbs] of PLACEMENTS) {
      const compact = mode !== "wide";
      const { nodes: placed } = layoutOf(nodes, mode, { sbs });
      const rs = placed.flatMap((pn) => rects(pn, !compact).map((r) => ({ ...r, id: pn.data.id, brk: r.brk || isGhostNode(pn.data) })));
      // The hop CHIP and its caption, placed exactly as the renderer places
      // them: the `⋯` chip centred on the trunk lane (the node's own x in
      // wide) at the midpoint of the run below the hopped goal, the caption
      // HOP_CAPTION_GAP right of the lane — one rect from the chip's left
      // edge to the caption's end.
      for (const src of placed) {
        if (src.data.folded?.kind !== "hop") continue;
        const cap = hopCaption(src.data.folded);
        const dst = placed.find((p) => p.data.parents.some((q) => q.id === src.data.id)); if (!dst) continue;
        const y = ((src.y + (bandTopH(src.data) + src.data.h) / 2) + (dst.y - (bandTopH(dst.data) + dst.data.h) / 2)) / 2;
        const lane = compact ? src.x - src.data.w / 2 + TRUNK_INSET : src.x;
        const half = Math.max(BADGE_H, HOP_CHIP_H) / 2;
        rs.push({ k: "caption", id: `${src.data.id}#cap`, brk: true, x0: lane - HOP_CHIP_W / 2, x1: cap ? lane + HOP_CAPTION_GAP + hopCaptionWidth(cap.text, cap.italic) : lane + HOP_CHIP_W / 2, y0: y - half, y1: y + half });
      }
      // A TOUR STOP's tab, placed exactly as the renderer places it: a
      // BADGE_H pill outside the box's LEFT edge, centred on the box. Every
      // author stop the fixture carries, plus — so the sweep is not empty on
      // a proof with no `.mark` — the first drawn goal and tactic as stand-in
      // reader stops, which is where a ⚑ lands.
      const stops = new Set(authorStops(nodes).map((s) => s.id));
      const firstGoal = placed.find((p) => p.data.type === "goal");
      const firstTac = placed.find((p) => p.data.type === "tactic");
      if (firstGoal) stops.add(firstGoal.data.id);
      if (firstTac) stops.add(firstTac.data.id);
      let tabN = 0;
      for (const pn of placed) {
        if (!stops.has(pn.data.id)) continue;
        const n = ++tabN;
        const tw = tourTabWidth(n);
        const d = pn.data; const half = (bandTopH(d) + d.h) / 2;
        const top = pn.y + half - d.h;
        rs.push({ k: "tab", id: pn.data.id, brk: true, x0: pn.x - d.w / 2 - tw / 2, x1: pn.x - d.w / 2 + tw / 2, y0: top - BADGE_H / 2, y1: top + BADGE_H / 2 });
      }
      checked++; belowSeen += placed.filter((p) => p.data.commentBelow && p.data.commentBlockH > 0).length;
      for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) {
        if (rs[a].id === rs[b].id || !(rs[a].brk || rs[b].brk)) continue;
        if (hit(rs[a], rs[b])) { total++; if (total <= 20) console.log(`overlap #${i} ${name} combine=${combine} narrate=${narrate} ${rs[a].k}:${rs[a].id} × ${rs[b].k}:${rs[b].id}`); }
      }
    }
    }
  }
}
console.log(`layouts checked ${checked} (strips below a fold ${belowSeen}), ghost/caption/tab/below-strip overlaps ${total}`);
process.exitCode = total ? 1 : 0;
