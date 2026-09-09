// Folding a goal must not MOVE it: for every goal × goal-keyed cut × layout,
// the sibling order of the drawn nodes is unchanged.  npm run probe -- order
// Does folding (or hopping) a goal move it? For every proof and every goal,
// compare the sibling order of drawn nodes before and after the cut its `−`
// mints — a fold or a hop, both leaving the goal in place — in all four modes.
import { goalCut, applyElisions, stepElidable, createLayoutEngine } from "./lib.mjs";
import { records, tree, byIdOf, kidsOf } from "./corpus.mjs";
const MODES = { stacked:[true,false,false], spine:[true,false,true], tracks:[true,false,"track"], wide:[false,false,false] };
let moved=0, checked=0;
const orderOf = (placed) => { const m=new Map(); for(const pn of placed) m.set(pn.data.id,{x:pn.x,y:pn.y}); return m; };
for (const rec of records()) { const b=tree(rec); if(b.length<3) continue; const byId=byIdOf(b), kids=kidsOf(b), se=stepElidable(b);
  for (const g of b.filter(n=>n.type==="goal")) for (const trunk of [true,false]) { const c=goalCut(byId,g.id,{trunk,stepElidable:se},kids); if(!c) continue;
    const after=applyElisions(b,[c]); const survivors=new Set(after.map(n=>n.id));
    for (const [mode,[compact,sbs,aside]] of Object.entries(MODES)) {
      const o1=orderOf(createLayoutEngine(b).computeLayout(null,null,compact,sbs,null,aside).nodes);
      const o2=orderOf(createLayoutEngine(after).computeLayout(null,null,compact,sbs,null,aside).nodes);
      // siblings of the folded goal (same parent), by y in compact / x in wide
      const sibs=b.filter(n=>n.parents.some(p=>g.parents.some(q=>q.id===p.id))&&survivors.has(n.id)).map(n=>n.id);
      const key=(o)=> sibs.slice().sort((a,z)=> compact ? o.get(a).y-o.get(z).y : o.get(a).x-o.get(z).x).join(",");
      checked++; if(key(o1)!==key(o2)){ moved++; if(moved<=8) console.log("moved", rec.file, mode, g.caseLabel??g.id); }
    } } }
console.log(`checked ${checked}, sibling order changed ${moved}`);
