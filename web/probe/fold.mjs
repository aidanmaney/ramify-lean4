// Draw a proof as an ASCII tree, optionally with cuts applied, to SEE a
// transform:   npm run probe -- fold odd_sums [seed|outline|root|g<k>|succ|skip:<tactic> …]
// Cut words: `seed` = the source's own view, `outline` = collapse-all,
// `root` = the goal's `−` on the root, `g<k>` = the k-th goal in preorder, a
// case label, or a raw id — every one of those is a FOLD (`−` hides, in every
// layout). `skip:<key>` is ◌ on a step: `t<k>` the k-th tactic in preorder, a
// label prefix, or a raw id — a HOP where the step has one continuation, the
// goal's fold on a leaf, "not offered" on a split.
import { sourceView, outlineCuts, goalCut, stepCut, applyElisions } from "./lib.mjs";
import { records, tree, byIdOf, kidsOf, find, draw } from "./corpus.mjs";
const [which = "odd_sums", ...words] = process.argv.slice(2);
const i = /^\d+$/.test(which) ? Number(which) : find(which);
const rec = records()[i]; const base = tree(rec); const byId = byIdOf(base), kids = kidsOf(base);
const goals = base.filter((n) => n.type === "goal");
const tactics = base.filter((n) => n.type === "tactic");
const cuts = [];
for (const w of words) {
  const [pre, key] = w.includes(":") ? [w.slice(0, w.indexOf(":")), w.slice(w.indexOf(":") + 1)] : ["", w];
  if (pre === "skip") {
    const t = /^t\d+$/.test(key) ? tactics[Number(key.slice(1))] : byId.get(key) ?? tactics.find((n) => n.label.startsWith(key));
    if (!t) { console.log(`no tactic for ${key}`); continue; }
    const c = stepCut(byId, t.id, kids); if (c) cuts.push(c); else console.log(`${key}: ◌ not offered (a split, a closing step with side work, or a ledger row)`);
  } else if (key === "seed") cuts.push(...sourceView(base));
  else if (key === "outline") cuts.push(...outlineCuts(byId, kids));
  else {
    const g = key === "root" ? base.find((n) => n.parents.length === 0) : /^g\d+$/.test(key) ? goals[Number(key.slice(1))] : goals.find((n) => n.caseLabel === key || n.caseLabel?.startsWith(key + " ")) ?? byId.get(key);
    if (!g) { console.log(`no goal for ${key}`); continue; }
    const c = goalCut(byId, g.id, kids); if (c) cuts.push(c); else console.log(`${key}: nothing to cut`);
  }
}
const nodes = applyElisions(base, cuts);
console.log(`#${i} ${rec.file}  drawn ${nodes.length}/${base.length}  cuts [${cuts.map((c) => c.kind).join(", ")}]`);
console.log(draw(nodes));
