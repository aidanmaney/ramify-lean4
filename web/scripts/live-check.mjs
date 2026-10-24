// Replay baked steps through the LIVE engine and assert identical answers.
//
//   node scripts/live-check.mjs BAKE_DIR [--engine CMD] [--limit N]
//
// BAKE_DIR holds `<Name>.json` bakes (publish.mjs --cache, or playgroundbake
// output); each theorem's source is ../demos/playground/<Name>.lean. The
// engine is the native `lake exe playgroundlive` by default (one JSON request
// per stdin line). For every baked step from a state reachable from the root,
// the live answer must give the same goal KEYS (and their kinds), the same
// uses, or an error where the bake has one. docs/wasm-spike.md.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = args[0];
const limit = Number(opt("--limit", "1000000"));
// `lake env` so the engine finds THIS toolchain's Init, not elan's default
const engine = opt("--engine", null);

const flat = (c) => ("text" in c ? c.text : "append" in c ? c.append.map(flat).join("") : flat(c.tag[1]));
const goalKey = (g) => [
  ...(g.userName ? [`case ${g.userName}`] : []),
  ...g.hyps.map((h) => `${h.names.join(" ")} : ${flat(h.type)}`),
  `${g.goalPrefix ?? "⊢ "}${flat(g.type)}`,
].join("\n");

const proc = engine
  ? spawn(engine, [], { stdio: ["pipe", "pipe", "inherit"], shell: true })
  : spawn("lake", ["env", ".lake/build/bin/playgroundlive"], { cwd: join(root, "lean"), stdio: ["pipe", "pipe", "inherit"] });
const lines = createInterface({ input: proc.stdout });
const queue = [];
lines.on("line", (l) => queue.shift()?.(JSON.parse(l)));
const ask = (req) => new Promise((ok) => { queue.push(ok); proc.stdin.write(JSON.stringify(req) + "\n"); });
const init = await new Promise((ok) => queue.push(ok));
console.log("init", JSON.stringify(init));
if (!init.ok) process.exit(2);

let n = 0, bad = 0;
/** Mismatches by their first line (`--kinds` prints the tally). */
const kinds = new Map();
const ms = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const bake = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const file = readFileSync(join(root, "demos/playground", f.replace(/\.json$/, ".lean")), "utf8");
  const keys = bake.goals.map((s) => goalKey(s.goal));
  const steps = new Map();
  for (const r of bake.steps) { if (!steps.has(r[0])) steps.set(r[0], []); steps.get(r[0]).push(r); }
  // a path to every state reachable from the root (BFS: the shortest)
  const path = new Map([[0, []]]);
  const q = [0];
  while (q.length) {
    const s = q.shift();
    for (const [, tac, out] of steps.get(s) ?? [])
      if (Array.isArray(out)) out.forEach((c, i) => { if (!path.has(c)) { path.set(c, [...path.get(s), [tac, i]]); q.push(c); } });
  }
  let done = 0;
  for (const [s, p] of path) for (const r of steps.get(s) ?? []) {
    if (done++ >= limit) break;
    const [, tac, out] = r;
    const a = await ask({ file, theorem: bake.theorem, path: p, tactic: tac });
    ms.push(a.ms);
    n++;
    let why = null;
    if (Array.isArray(out)) {
      if (a.error) why = `live error: ${a.error}`;
      else {
        const want = out.map((c) => keys[c]);
        // the page keys a goal by `goalKey` over its structure (playgroundAnswer.ts),
        // which wraps differently from Lean's own `ppGoal`; that key is the one
        // that joins the graphs, so it is the one compared
        const got = a.goals.map((g) => goalKey(g.goal));
        if (JSON.stringify(want) !== JSON.stringify(got)) why = `keys ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`;
        else if (a.goals.some((g, i) => JSON.stringify(g.kinds) !== JSON.stringify(bake.goals[out[i]].kinds))) why = "kinds differ";
        else if (JSON.stringify(a.uses) !== JSON.stringify(r[3] ?? [])) why = `uses ${JSON.stringify(a.uses)} ≠ ${JSON.stringify(r[3] ?? [])}`;
      }
    } else if (!a.error) why = "live succeeded where the bake has an error";
    // metavariable numbers depend on how much elaboration preceded the step
    else if (a.error.replace(/\?m\.\d+/g, "?m") !== bake.errors[out.e].replace(/\?m\.\d+/g, "?m")) why = `error text differs:\n    live: ${a.error}\n    bake: ${bake.errors[out.e]}`;
    if (why) kinds.set(why.split("\n")[0].slice(0, 60), (kinds.get(why.split("\n")[0].slice(0, 60)) ?? 0) + 1);
    if (why) { bad++; if (bad <= 15) console.log(`✗ ${f} state ${s} \`${tac}\`: ${why.slice(0, 600)}`); }
  }
}
proc.stdin.end();
if (args.includes("--kinds"))
  for (const [k, c] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(String(c).padStart(6), k);
ms.sort((a, b) => a - b);
console.log(`${n - bad}/${n} identical · median ${ms[ms.length >> 1]} ms · p90 ${ms[Math.floor(ms.length * 0.9)]} ms · max ${ms.at(-1)} ms`);
process.exit(bad ? 1 : 0);
