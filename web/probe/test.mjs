#!/usr/bin/env node
// `npm test`: the gate in one command.  Typecheck and lint (concurrently), then
// every OFFLINE probe (no Lean server, no elaboration) in order, stopping at
// the first failure with its output.  `fingerprint` hashes every pure stage
// against probe/fingerprint.baseline.json (`--update` after an INTENDED
// change).  Not included on purpose: `fold` (needs arguments), `eval`
// (elaborates Lean files), `lsp` (needs a live server), `perf` (timings).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROBES = ["counts", "narrate", "overlap", "order", "hopgap", "rewrite", "fingerprint"];

const npmStep = (name) => ({ name, cmd: "npm", args: ["run", "-s", name] });
const probeStep = (p) => ({ name: `probe ${p}`, cmd: process.execPath, args: [path.join("probe", "run.mjs"), p] });

/** Start a step now; resolves when it exits, with its output and wall time. */
function start(s) {
  const t = Date.now();
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(s.cmd, s.args, { cwd: web });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => resolve({ s, status: 1, out: String(e), secs: 0 }));
    child.on("close", (status, signal) => resolve({ s, status: status ?? signal, out: out.trimEnd(), secs: (Date.now() - t) / 1000 }));
  });
}

/** Print a finished step's line, or its failure and exit. */
function report({ s, status, out, secs }) {
  if (status !== 0) {
    console.log(`FAIL  ${s.name.padEnd(16)} ${secs.toFixed(1)}s (exit ${status})`);
    if (out) console.log(`\n${out}\n`);
    process.exit(1);
  }
  const last = out.split("\n").filter(Boolean).at(-1) ?? "";
  console.log(`ok    ${s.name.padEnd(16)} ${secs.toFixed(1)}s${last ? `  ${last.slice(0, 80)}` : ""}`);
}

const t0 = Date.now();
// Typecheck and lint are independent: run them together, report in order.  The
// probes then run one at a time (the first builds the lib bundle the rest
// reuse), so a failure stops the run at the first one, as before.
const parallel = [npmStep("typecheck"), npmStep("lint")].map(start);
for (const r of parallel) report(await r);
for (const s of PROBES.map(probeStep)) report(await start(s));
console.log(`all ${parallel.length + PROBES.length} steps passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
