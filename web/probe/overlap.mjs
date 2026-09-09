// Ink-overlap sweep for the PAINT THAT RESERVES NOTHING: the ghost markers
// (combined and marquee/`.none` boxes), the caption beside a hop's axis break,
// and a tour stop's numbered tab hung off a box's left edge.  Every seeded / outline / per-goal
// cut, combine on and off, in the five placements.  npm run probe -- overlap
import { sourceView, outlineCuts, goalCut, applyElisions, stepElidable, combineRuns, resolveCut, createLayoutEngine, bandTopH, COMMENT_INDENT, isGhostNode, hopCaption, hopCaptionWidth, HOP_CAPTION_GAP, BADGE_H, TRUNK_INSET, tourTabWidth, authorStops } from "./lib.mjs";
import { records, tree, byIdOf, kidsOf } from "./corpus.mjs";

const MODES = { stacked: [true, false, false], spine: [true, false, true], tracks: [true, false, "track"], sbs: [true, true, false], wide: [false, false, false] };
const rects = (pn, wide) => {
  const d = pn.data; const top = bandTopH(d); const half = (top + d.h) / 2; const bandTop = pn.y - half; const boxTop = pn.y + half - d.h; const boxBot = pn.y + half; const out = [];
  out.push({ k: "box", x0: pn.x - d.w / 2, x1: pn.x + d.w / 2, y0: boxTop, y1: boxBot });
  if (d.commentBlockH > 0) { const sx = wide ? pn.x - d.commentW / 2 : pn.x - d.w / 2 + (d.parents.length ? COMMENT_INDENT : 0); const sy0 = d.commentFloats ? boxTop - d.commentBlockH : bandTop + d.caseH; out.push({ k: "strip", x0: sx, x1: sx + d.commentW, y0: sy0, y1: sy0 + d.commentBlockH }); }
  if (d.caseH > 0) out.push({ k: "badge", x0: pn.x - d.w / 2, x1: pn.x - d.w / 2 + d.caseW, y0: bandTop, y1: bandTop + d.caseH });
  return out;
};
const hit = (a, b) => a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
let total = 0, checked = 0;
for (const [i, rec] of records().entries()) {
  const base = tree(rec); if (base.length < 2) continue;
  const byId = byIdOf(base), kids = kidsOf(base), se = stepElidable(base);
  const goalSets = base.filter((n) => n.type === "goal").flatMap((g) => [true, false].map((tr) => goalCut(byId, g.id, { trunk: tr, stepElidable: se }, kids)).filter(Boolean).map((c) => [c]));
  for (const cuts of [sourceView(base), outlineCuts(byId, kids), ...goalSets]) for (const combine of [false, true]) {
    const manual = new Set(cuts.flatMap((c) => resolveCut(c, byId)));
    const nodes = applyElisions(base, combine ? [...cuts, ...combineRuns(base, manual)] : cuts);
    if (!nodes.some((n) => isGhostNode(n) || n.folded?.kind === "hop")) continue;
    for (const [mode, [compact, sbs, aside]] of Object.entries(MODES)) {
      const { nodes: placed } = createLayoutEngine(nodes, { chips: true }).computeLayout(null, null, compact, sbs, null, aside);
      const rs = placed.flatMap((pn) => rects(pn, !compact).map((r) => ({ ...r, id: pn.data.id, brk: isGhostNode(pn.data) })));
      // The hop caption, placed exactly as the renderer places it: the trunk
      // lane (the node's own x in wide) offset by HOP_CAPTION_GAP, at the
      // midpoint of the run below the hopped goal.
      for (const src of placed) {
        if (src.data.folded?.kind !== "hop") continue;
        const cap = hopCaption(src.data.folded); if (!cap) continue;
        const dst = placed.find((p) => p.data.parents.some((q) => q.id === src.data.id)); if (!dst) continue;
        const y = ((src.y + (bandTopH(src.data) + src.data.h) / 2) + (dst.y - (bandTopH(dst.data) + dst.data.h) / 2)) / 2;
        const lane = compact ? src.x - src.data.w / 2 + TRUNK_INSET : src.x;
        rs.push({ k: "caption", id: `${src.data.id}#cap`, brk: true, x0: lane + HOP_CAPTION_GAP, x1: lane + HOP_CAPTION_GAP + hopCaptionWidth(cap.text, cap.italic), y0: y - BADGE_H / 2, y1: y + BADGE_H / 2 });
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
      checked++;
      for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) {
        if (rs[a].id === rs[b].id || !(rs[a].brk || rs[b].brk)) continue;
        if (hit(rs[a], rs[b])) { total++; if (total <= 20) console.log(`overlap #${i} ${mode} combine=${combine} ${rs[a].k}:${rs[a].id} × ${rs[b].k}:${rs[b].id}`); }
      }
    }
  }
}
console.log(`layouts checked ${checked}, ghost/caption/tab overlaps ${total}`);
process.exitCode = total ? 1 : 0;
