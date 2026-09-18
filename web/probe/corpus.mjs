// Shared vocabulary for probes: the CLI corpus and tree helpers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { proofToTree } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SAMPLE = path.resolve(here, "..", "public", "sample.ndjson");

/** Every record of sample.ndjson: `{file, data:{index, proof}}`. */
export const records = () =>
  fs.readFileSync(SAMPLE, "utf8").trim().split("\n").map((l) => JSON.parse(l));

/** The base tree of record `i`, built the way the view builds it (slots on). */
export const tree = (rec, opts = {}) =>
  proofToTree(rec.data.proof, { slots: rec.data.proof.deleteSlots, ...opts });

export const byIdOf = (nodes) => new Map(nodes.map((n) => [n.id, n]));
export const kidsOf = (nodes) => {
  const m = new Map();
  for (const n of nodes) for (const p of n.parents) (m.get(p.id) ?? m.set(p.id, []).get(p.id)).push(n);
  return m;
};

/** Record index by a substring of `file` plus the proof's `index` field, so a
 probe can say `find("odd_sums")` instead of hard-coding 19. */
export const find = (fileSub, index) =>
  records().findIndex((r) => r.file.includes(fileSub) && (index === undefined || r.data.index === index));

/** A goal by the username of one of its hyps (and optionally NOT another). */
export const goalWithHyp = (nodes, has, hasNot) =>
  nodes.find(
    (n) =>
      n.type === "goal" &&
      n.hyps?.some((h) => (h.name ?? h.text ?? "").startsWith(has)) &&
      !(hasNot && n.hyps?.some((h) => (h.name ?? h.text ?? "").startsWith(hasNot))),
  );

/** ASCII tree in DFS order — the quickest way to SEE what a transform did. */
export function draw(nodes, mark = () => "") {
  const kids = kidsOf(nodes);
  const seen = new Set();
  const out = [];
  const rec = (n, d) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    const lab = (n.type === "goal" ? "⊢ " : "") + n.label.replace(/\s+/g, " ").slice(0, 64);
    out.push(
      "  ".repeat(d) + mark(n) + (n.spawned ? "(sp) " : "") + (n.side ? "(side) " : "") +
        (n.caseLabel ? `[${n.caseLabel}] ` : "") + (n.elidedCut ? "⫽ " : "") +
        // A hop or a fold mints no node: the GOAL is the reduced one, so say
        // so here or the ASCII tree looks like the steps simply vanished.
        (n.folded ? `⟨${n.folded.kind} +${n.folded.tactics.length}⟩ ` : "") + lab,
    );
    for (const k of kids.get(n.id) ?? []) rec(k, d + 1);
  };
  for (const r of nodes.filter((n) => n.parents.length === 0)) rec(r, 0);
  return out.join("\n");
}

/** Structural soundness: parents exist, no 2-cycles, DFS preorder holds. */
export function structural(nodes, tag, fail) {
  const ids = new Set(nodes.map((n) => n.id));
  const kids = kidsOf(nodes);
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  for (const n of nodes)
    for (const p of n.parents) {
      if (!ids.has(p.id)) fail(`${tag}: dangling parent ${p.id} of ${n.id}`);
      if ((kids.get(n.id) ?? []).some((k) => k.id === p.id)) fail(`${tag}: 2-cycle ${n.id} <-> ${p.id}`);
      if (idx.get(p.id) > idx.get(n.id)) fail(`${tag}: parent ${p.id} after child ${n.id}`);
    }
}

/** Every cut a READER can mint on a base tree, one per list: each goal's
 `−` (a fold) and each step's ◌ (a hop, a leaf's fold, a ghost) — the sweep
 the layout probes run, so hops inside branches are in it. */
export function readerCuts(lib, nodes) {
  const byId = byIdOf(nodes), kids = kidsOf(nodes), out = [];
  for (const n of nodes) {
    const c = n.type === "goal" ? lib.goalCut(byId, n.id, kids) : n.type === "tactic" ? lib.stepCut(byId, n.id, kids) : null;
    if (c && !out.some((x) => lib.cutId(x) === lib.cutId(c))) out.push(c);
  }
  return out;
}

/** A tiny assertion harness: `const t = tally(); t.ok(cond, msg); t.done()`. */
export function tally() {
  let fails = 0;
  return {
    ok(cond, msg) { if (!cond) { fails++; console.log("FAIL", msg); } },
    eq(a, b, msg) { this.ok(a === b, `${msg}: got ${a}, expected ${b}`); },
    done() { console.log(fails === 0 ? "ALL OK" : `${fails} failure(s)`); process.exitCode = fails ? 1 : 0; },
  };
}
