// @probe
// The RENDER MATRIX's coverage, greppable: every cell the `/?matrix` page draws
// (node kind × state) and every cell it skips with the reason.  Also builds each
// kind's scene and checks that the node the state goes on EXISTS in the tree the
// view will draw (a ghost under its `.none`, a ledger under its host step, a
// folded goal's id, …), so a scene that drifts away from the parser fails here
// rather than as a silently empty cell.  Informational: exits 0 unless
// `--strict`, which exits 1 on a missing target.
//   npm run probe -- matrix              # the table, then the lists
//   npm run probe -- matrix --cells      # one line per cell: kind/state  drawn | skipped: reason
//   npm run probe -- matrix --skipped    # only the skipped lines
//   npm run probe -- matrix --strict
import * as lib from "./lib.mjs";
import { records, flag } from "./corpus.mjs";


const { KINDS, STATES, SKIPS, cells, SCENES, subProof, proofToTree, sourceView, applyElisions } = lib;
const recs = records();
const rec = (file, index) => recs.find((r) => r.file === file && r.data.index === index);

// ---- the scenes -----------------------------------------------------------------
let missing = 0;
const bad = (msg) => { missing++; console.log(`MISSING  ${msg}`); };

function sceneOf(kind, above = {}) {
  if (typeof kind.scene === "string") return SCENES[kind.scene].build(above);
  const r = rec(kind.scene.file, kind.scene.index);
  if (!r) return null;
  return { proof: subProof(r.data.proof, kind.scene.at), ids: {}, starts: [kind.scene.at], endLine: 0 };
}

for (const k of KINDS) {
  const b = sceneOf(k, k.setup === "ghost" || k.setup === "fold" || k.setup === "hop" ? (k.seedAbove ?? {}) : {});
  if (!b) { bad(`${k.id}: scene ${JSON.stringify(k.scene)} not in the corpus`); continue; }
  const nodes = proofToTree(b.proof, { slots: b.proof.deleteSlots });
  const ids = new Set(nodes.map((n) => n.id));
  let drawn = nodes;
  if (k.setup === "ghost") drawn = applyElisions(nodes, sourceView(nodes));
  const has = (t) => ("id" in t ? drawn.some((n) => n.id === t.id) : drawn.some((n) => n.id.startsWith(t.prefix)));
  if (k.setup === "trace") {
    const t = b.proof.automationTraces?.[0];
    if (!t || !b.proof.steps.some((s) => s.position.start.line === t.stepStart.line && s.position.start.character === t.stepStart.character))
      bad(`${k.id}: no automation trace on a step`);
  } else if (k.setup === "stub") {
    const s = b.proof.steps[1];
    if (!s || s.tacticString !== "sorry") bad(`${k.id}: no sorry step for the stub to hang off`);
  } else if (!has(k.target)) bad(`${k.id}: target ${JSON.stringify(k.target)} is not drawn (ids: ${[...ids].slice(0, 6).join(", ")}…)`);
  if (k.setup === "fold" || k.setup === "hop") {
    const cuts = sourceView(nodes);
    if (cuts.length === 0) bad(`${k.id}: seedAbove ${JSON.stringify(k.seedAbove)} seeds no cut`);
  }
  for (const [kind, st] of [[k, "commentStep"], [k, "diagStep"]]) {
    const i = kind[st];
    if (i !== null && !b.proof.steps[i]) bad(`${k.id}: ${st} ${i} is not a step (${b.proof.steps.length} steps)`);
  }
}

// ---- the cells --------------------------------------------------------------------
const all = cells();
const drawn = all.filter((c) => !c.skip);
const skipped = all.filter((c) => c.skip);

if (flag("--cells") || flag("--skipped")) {
  for (const c of flag("--skipped") ? skipped : all)
    console.log(`${c.kind}/${c.state}`.padEnd(20), c.skip ? `skipped: ${c.skip}` : "drawn");
} else {
  const w = Math.max(...STATES.map((s) => s.id.length)) + 1;
  console.log("".padEnd(8), STATES.map((s) => s.id.slice(0, 6).padEnd(7)).join(""));
  for (const k of KINDS)
    console.log(k.id.padEnd(8), STATES.map((s) => (SKIPS[`${k.id}/${s.id}`] ? "·" : "■").padEnd(7)).join(""));
  void w;
  console.log("\n■ drawn   · skipped (reasons: --skipped)");
}
console.log(`\n${KINDS.length} kinds × ${STATES.length} states = ${all.length} cells: ${drawn.length} drawn, ${skipped.length} skipped; ${missing} missing targets`);
process.exit(flag("--strict") && missing > 0 ? 1 : 0);
