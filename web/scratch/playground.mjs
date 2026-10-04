// Baked-playground SKETCH (spike, not wired into the product; see docs/playground-spike.md).
//
//   node scratch/playground.mjs <bake.json> [tactic lines…]
//   node scratch/playground.mjs /tmp/out/zero_add.json "intro x" "induction x" "simp" "rename_i k ih" "omega"
//
// What it shows:
//   1. ONE async seam, `answer(goal, tactic)`, behind which engines are tried in
//      order — the baked table first, a future in-browser Lean later — all
//      returning the SAME shape: {goals: [goalKey…]} | {error} | NOT_BAKED.
//   2. Typed text → baked step: whitespace normalisation, canonical-name
//      aliasing (`intro x` is the baked `intro n` with x shown for n),
//      `intro a b c` split into single intros, a completion list, and the
//      "not in this demo" fallback.
//   3. A script → Paperproof-shaped `ProofStep` records, fed to the REAL
//      `proofToTree` (through the probes' bundle) to show the tree builds.

import fs from "node:fs";
import { ensureLib } from "../probe/bundle.mjs";

export const NOT_BAKED = "not baked";

// ---------------------------------------------------------------------------
// The bake: goals keyed by id, and the goal KEY (the infoview's own print,
// hyps + ⊢ target) is what joins answers from different engines into one graph.

export function loadBake(json) {
  const goals = json.goals.map((g) => ({ ...g, key: goalKey(g) }));
  const byKey = new Map(goals.map((g) => [g.key, g]));
  const steps = new Map(); // `${goalId}\u0000${tactic}` → outcome
  for (const [gid, tac, out] of json.steps)
    steps.set(`${gid}\u0000${tac}`,
      Array.isArray(out) ? { goals: out.map((i) => goals[i].key) } : { error: json.errors[out.e] });
  return { theorem: json.theorem, goals, byKey, steps };
}

const goalKey = (g) => [...g.hyps.map(([n, t]) => `${n} : ${t}`), `⊢ ${g.target}`].join("\n");

/** The baked engine: an exact table lookup. */
export function bakedEngine(bake) {
  return async (key, tactic) => {
    const g = bake.byKey.get(key);
    if (!g) return NOT_BAKED;
    return bake.steps.get(`${g.id}\u0000${tactic}`) ?? NOT_BAKED;
  };
}

/** The seam. Engines are tried in order; the first answer that is not
    NOT_BAKED wins. A live engine (WASM Lean, later) slots in after the baked
    one and must answer in the same shape, its new goals keyed the same way, so
    they join the baked graph (and can be cached — IndexedDB — under the key). */
export function makeAnswer(engines) {
  return async (key, tactic) => {
    for (const e of engines) {
      const a = await e(key, tactic);
      if (a !== NOT_BAKED) return a;
    }
    return NOT_BAKED;
  };
}

// ---------------------------------------------------------------------------
// Typed text → the baked spelling.

export const normalise = (s) => s.trim().replace(/\s+/g, " ").replace(/\[\s*/g, "[").replace(/\s*\]/g, "]");

const wordRe = (w) => new RegExp(`(?<![\\w.'✝])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w'✝])`, "g");
const renameWords = (s, map) => {
  for (const [from, to] of map) s = s.replace(wordRe(from), `\u0001${to}\u0002`);
  return s.replace(/\u0001|\u0002/g, "");
};

/** Every baked tactic available on this goal, for the completion list, with
    canonical names shown under the visitor's aliases. */
export function completions(bake, key, aliases) {
  const g = bake.byKey.get(key);
  if (!g) return [];
  const show = [...aliases].map(([user, canon]) => [canon, user]);
  const out = [];
  for (const [k, o] of bake.steps) {
    const [gid, tac] = k.split("\u0000");
    if (Number(gid) === g.id) out.push({ tactic: renameWords(tac, show), ok: !o.error });
  }
  return out;
}

/** Resolve one typed line on one goal. Returns the outcome plus the alias map
    the CHILD goals inherit (visitor name → canonical name). */
export async function resolve(answer, bake, key, typed, aliases) {
  let t = renameWords(normalise(typed), aliases);
  const intro = /^intro (\S+)$/.exec(t);
  if (intro) {
    // canonical naming: the bake has ONE `intro <c>` per goal; find it
    const canon = [...bake.steps.keys()]
      .map((k) => k.split("\u0000"))
      .find(([gid, tac]) => bake.byKey.get(key)?.id === Number(gid) && tac.startsWith("intro "));
    if (canon) {
      const c = canon[1].slice(6);
      const next = new Map(aliases);
      if (intro[1] !== c) next.set(intro[1], c);
      return { outcome: await answer(key, canon[1]), aliases: next };
    }
  }
  return { outcome: await answer(key, t), aliases };
}

// ---------------------------------------------------------------------------
// A script (one tactic per line, each on the FIRST open goal — Lean's main
// goal) → Paperproof `ProofStep`s. Goal ids are minted per OCCURRENCE: the
// same baked state can appear twice in one tree.

export async function runScript(bake, answer, lines) {
  let n = 0;
  const hypIds = new Map();
  const goalInfo = (key, aliases) => {
    const g = bake.byKey.get(key);
    const show = [...aliases].map(([user, canon]) => [canon, user]);
    const hyps = g.hyps.map(([name, type]) => {
      const shown = renameWords(name, show);
      const hk = `${shown}:${type}`;
      if (!hypIds.has(hk)) hypIds.set(hk, `h${hypIds.size}`);
      return { username: shown, type: renameWords(type, show), value: null, id: hypIds.get(hk), isProof: "proof" };
    });
    return { username: "[anonymous]", type: renameWords(g.target, show), hyps, id: `g${n++}` };
  };
  const root = bake.goals[0];
  let open = [{ key: root.key, aliases: new Map(), info: goalInfo(root.key, new Map()) }];
  const steps = [], notes = [];
  for (const [i, raw] of lines.entries()) {
    const parts = /^intro\s+\S+(\s+\S+)+$/.test(normalise(raw))
      ? normalise(raw).split(" ").slice(1).map((x) => `intro ${x}`) // `intro a b` = intro a; intro b
      : [raw];
    for (const typed of parts) {
      const cur = open.shift();
      if (!cur) { notes.push(`line ${i + 1}: no goals`); break; }
      const { outcome, aliases } = await resolve(answer, bake, cur.key, typed, cur.aliases);
      if (outcome === NOT_BAKED || outcome.error) {
        notes.push(`line ${i + 1}: ${outcome === NOT_BAKED ? "not in this demo" : outcome.error.split("\n")[0]}`);
        open.unshift(cur); // the goal stays open; a real page draws the failed step as recovery does
        break;
      }
      const after = outcome.goals.map((k) => ({ key: k, aliases, info: goalInfo(k, aliases) }));
      steps.push({
        tacticString: parts.length > 1 ? typed : raw.trim(),
        goalBefore: cur.info,
        goalsAfter: after.map((a) => a.info),
        spawnedGoals: [],
        tacticDependsOn: [],
        position: { start: { line: i + 1, character: 2 }, stop: { line: i + 1, character: 2 + raw.trim().length } },
        theorems: [],
      });
      open = [...after, ...open];
    }
  }
  const allGoals = [steps[0]?.goalBefore ?? goalInfo(root.key, new Map())];
  return { proof: { steps, allGoals }, open, notes };
}

// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, ...lines] = process.argv.slice(2);
  const bake = loadBake(JSON.parse(fs.readFileSync(file, "utf8")));
  const answer = makeAnswer([bakedEngine(bake) /*, wasmEngine (later) */]);
  const { proof, open, notes } = await runScript(bake, answer, lines);
  const lib = await import(await ensureLib());
  const nodes = lib.proofToTree(proof);
  console.log(`${bake.theorem}: ${proof.steps.length} steps → ${nodes.length} tree nodes, ${open.length} goals open`);
  for (const nd of nodes) console.log(`  ${nd.type === "goal" ? "◇" : "▸"} ${nd.label}`);
  for (const s of notes) console.log(`  ! ${s}`);
  if (open[0]) {
    const c = completions(bake, open[0].key, open[0].aliases).filter((x) => x.ok).map((x) => x.tactic);
    console.log(`  completions on the first open goal: ${c.join(" · ") || "(none)"}`);
  }
}
