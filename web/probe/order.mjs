// Cutting must not MOVE the goal it hangs off: for every proof × every cut a
// reader can mint (each goal's `−` fold, each step's ◌ — hops inside branches
// included) × layout, the sibling order of the drawn nodes is unchanged.
//   npm run probe -- order
import * as lib from "./lib.mjs";
import { records, tree, byIdOf, readerCuts } from "./corpus.mjs";
const { applyElisions, createLayoutEngine } = lib;
const MODES = { stacked:[true,false,false], spine:[true,false,true], tracks:[true,false,"track"], wide:[false,false,false] };
let moved=0, checked=0, hops=0;
const orderOf = (placed) => { const m=new Map(); for(const pn of placed) m.set(pn.data.id,{x:pn.x,y:pn.y}); return m; };
for (const rec of records()) { const b=tree(rec); if(b.length<3) continue; const byId=byIdOf(b);
  const before = Object.fromEntries(Object.entries(MODES).map(([m,[compact,sbs,aside]]) => [m, orderOf(createLayoutEngine(b).computeLayout(null,null,compact,sbs,null,aside).nodes)]));
  for (const c of readerCuts(lib, b)) { if (c.kind!=="fold" && c.kind!=="hop") continue; const g=byId.get(c.id); if (c.kind==="hop") hops++;
    const after=applyElisions(b,[c]); const survivors=new Set(after.map(n=>n.id));
    for (const [mode,[compact,sbs,aside]] of Object.entries(MODES)) {
      const o1=before[mode];
      const o2=orderOf(createLayoutEngine(after).computeLayout(null,null,compact,sbs,null,aside).nodes);
      const sibs=b.filter(n=>n.parents.some(p=>g.parents.some(q=>q.id===p.id))&&survivors.has(n.id)).map(n=>n.id);
      const key=(o)=> sibs.slice().sort((a,z)=> compact ? o.get(a).y-o.get(z).y : o.get(a).x-o.get(z).x).join(",");
      checked++; if(key(o1)!==key(o2)){ moved++; if(moved<=8) console.log("moved", rec.file, mode, c.kind, g.caseLabel??g.id); }
    } } }
console.log(`checked ${checked} (hop cuts ${hops}), sibling order changed ${moved}`);
process.exitCode = moved ? 1 : 0;
