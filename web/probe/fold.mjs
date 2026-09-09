// Draw a proof as an ASCII tree, optionally with cuts applied, to SEE a
// transform:   npm run probe -- fold odd_sums [seed|outline|root|g<k>|succ …]
// Cut words: `seed` = the source's own view, `outline` = collapse-all,
// `root` = the goal's `−` on the root (trunk reading), `wide:root` the wide
// reading, `g<k>` = the k-th goal in preorder, a case label, or a raw id.
import { sourceView, outlineCuts, goalCut, applyElisions, stepElidable } from "./lib.mjs";
import { records, tree, byIdOf, kidsOf, find, draw } from "./corpus.mjs";
const [which = "odd_sums", ...words] = process.argv.slice(2);
const i = /^\d+$/.test(which) ? Number(which) : find(which);
const rec = records()[i]; const base = tree(rec); const byId = byIdOf(base), kids = kidsOf(base), se = stepElidable(base);
const goals = base.filter((n) => n.type === "goal");
const cuts = [];
for (const w of words) {
  const [pre, key] = w.includes(":") ? w.split(":") : ["trunk", w];
  const opts = { trunk: pre !== "wide", stepElidable: se };
  if (key === "seed") cuts.push(...sourceView(base));
  else if (key === "outline") cuts.push(...outlineCuts(byId, kids));
  else {
    const g = key === "root" ? base.find((n) => n.parents.length === 0) : /^g\d+$/.test(key) ? goals[Number(key.slice(1))] : goals.find((n) => n.caseLabel === key) ?? byId.get(key);
    if (!g) { console.log(`no goal for ${key}`); continue; }
    const c = goalCut(byId, g.id, opts, kids); if (c) cuts.push(c); else console.log(`${key}: nothing to cut`);
  }
}
const nodes = applyElisions(base, cuts);
console.log(`#${i} ${rec.file}  drawn ${nodes.length}/${base.length}  cuts [${cuts.map((c) => c.kind).join(", ")}]`);
console.log(draw(nodes));
