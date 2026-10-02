// @probe
// Behaviour fingerprint of the pure engine: for every corpus record and a set of
// deterministic synthetic proofs, a hash of each stage's full output —
// proofToTree's node list, applyElisions (no cuts / collapse-all / a ◌ on every
// 4th tactic), the cut algebra, the narration lines, and computeLayout (every
// node's x, y and measured box, every link, the extent) in all four layouts.
// A performance change must leave every hash alone.
//
//   npm run probe -- fingerprint                 compare with fingerprint.baseline.json
//   npm run probe -- fingerprint --update        rewrite the baseline (after an INTENDED change)
//   npm run probe -- fingerprint --out FILE      write this run's hashes to FILE (no compare)
//   npm run probe -- fingerprint --against FILE  compare with FILE instead of the baseline
//   npm run probe -- fingerprint --quick         corpus only (skips the synthetic sizes)
//   npm run probe -- fingerprint --synth chain:1500,mixed:1000   extra synthetic sizes (with --out, to compare two builds)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as lib from "./lib.mjs";
import { records, byIdOf, kidsOf, MODES, layoutOf, hopEvery, flag, opt } from "./corpus.mjs";
import { synth } from "./synth.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(here, "fingerprint.baseline.json");

// Nodes reference each other through `parents`; serialise those as ids.
const replacer = (k, v) => {
  if (k === "parents" && Array.isArray(v)) return v.map((p) => p.id);
  if (typeof v === "number" && !Number.isFinite(v)) return String(v);
  if (v instanceof Set) return [...v].sort();
  if (v instanceof Map) return [...v.entries()];
  return v;
};
const hash = (x) => crypto.createHash("sha1").update(JSON.stringify(x, replacer) ?? "undefined").digest("hex").slice(0, 16);

const placedOf = (r) => ({
  nodes: r.nodes.map((p) => ({ x: p.x, y: p.y, data: p.data })),
  links: r.links.map((l) => ({ s: l.source.data.id, t: l.target.data.id, col: l.col, lane: l.lane })),
  extent: r.extent,
});

function fingerprintOf(proof, out, tag) {
  const put = (stage, fn) => {
    try { out[`${tag}|${stage}`] = hash(fn()); }
    catch (e) { out[`${tag}|${stage}`] = `ERR:${e.constructor.name}`; }
  };
  let base;
  put("tree", () => (base = lib.proofToTree(proof, { slots: proof.deleteSlots })));
  if (!base) return;
  const byId = byIdOf(base), kids = kidsOf(base);
  const cuts = lib.outlineCuts(byId, kids);
  const hops = hopEvery(lib, base);
  let outl, part, narrOutl, narrFull;
  put("cuts", () => ({ cuts, hops }));
  put("elide-none", () => lib.applyElisions(base, []));
  put("elide-outline", () => (outl = lib.applyElisions(base, cuts)));
  put("elide-hops", () => (part = lib.applyElisions(base, hops)));
  // The cut algebra itself, on the shared inputs.
  put("cut-algebra", () => ({
    disjoint: lib.disjointCuts(hops, byId),
    pruned: lib.pruneCuts(base, hops),
    coalesced: lib.coalesceCuts(base, hops),
    resolvedHops: hops.map((c) => lib.resolveCut(c, byId)),
    resolvedOutline: cuts.map((c) => lib.resolveCut(c, byId)),
  }));
  if (outl) put("narrate-outline", () => (narrOutl = lib.applyNarration(outl, base)));
  put("narrate-full", () => (narrFull = lib.applyNarration(base, base)));
  put("narrate-lines", () => lib.narrationFor(base, base));
  const variants = { uncut: base, outline: outl, hops: part, narrated: narrOutl, "narrated-full": narrFull };
  for (const mode of MODES)
    for (const [vn, nodes] of Object.entries(variants)) {
      if (!nodes) continue;
      put(`layout-${mode}+${vn}`, () => placedOf(layoutOf(nodes, mode)));
    }
}

const out = {};
const t0 = Date.now();
for (const rec of records()) fingerprintOf(rec.data.proof, out, `corpus:${rec.file.replace("proofs/", "")}#${rec.data.index}`);
if (!flag("--quick")) {
  for (const shape of ["mixed", "chain", "split"]) for (const n of [100, 300]) fingerprintOf(synth(shape, n), out, `synth:${shape}${n}`);
  fingerprintOf(synth("chain", 600), out, "synth:chain600");
}
// --synth chain:1500,mixed:1000 adds sizes ad hoc (not in the baseline).
for (const spec of opt("--synth", "").split(",").filter(Boolean)) { const [shape, n] = spec.split(":"); fingerprintOf(synth(shape, Number(n)), out, `synth:${shape}${n}`); }
const secs = (Date.now() - t0) / 1000;

const outFile = opt("--out", null);
if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1) + "\n");
  console.log(`fingerprint: ${Object.keys(out).length} hashes -> ${outFile} (${secs.toFixed(1)}s)`);
} else if (flag("--update")) {
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 1) + "\n");
  console.log(`fingerprint: baseline rewritten, ${Object.keys(out).length} hashes (${secs.toFixed(1)}s)`);
} else {
  const file = opt("--against", BASELINE);
  if (!fs.existsSync(file)) { console.error(`fingerprint: no baseline at ${file} — run with --update`); process.exit(1); }
  const want = JSON.parse(fs.readFileSync(file, "utf8"));
  const bad = [];
  for (const key of new Set([...Object.keys(want), ...Object.keys(out)])) {
    if (flag("--quick") && key.startsWith("synth:")) continue;
    if (want[key] !== out[key]) bad.push(`  ${key}: ${want[key] ?? "(absent)"} -> ${out[key] ?? "(absent)"}`);
  }
  if (bad.length) {
    console.error(`fingerprint: ${bad.length} of ${Object.keys(out).length} stage outputs changed:\n${bad.slice(0, 60).join("\n")}${bad.length > 60 ? `\n  … ${bad.length - 60} more` : ""}`);
    console.error("A performance change must not move any of these.  If the change is INTENDED, run `npm run probe -- fingerprint --update`.");
    process.exit(1);
  }
  console.log(`fingerprint: ${Object.keys(out).length} stage outputs identical to ${path.basename(file)} (${secs.toFixed(1)}s)`);
}
