#!/usr/bin/env node
// Lists that live in two languages or two files, and the test that keeps them
// equal. Each is a copy on purpose (the extension has no build step; the Lean
// server cannot import TypeScript), so this is the seam.
//
//   MOVE_IDS            web/src/moves.ts  ==  ext/ramify/extension.js  ==  the
//                       union of ext/ramify/package.json's two hover-bar enums;
//                       each enum is exactly what moveSlots.ts `appliesToKind`
//                       says that kind can draw, and extension.js's
//                       TACTIC_ONLY_MOVES is moveSlots.ts's TACTIC_ONLY
//   AUTOMATION_CANDIDATES  web/src/rewrite.ts  ==  `closingCandidates` in lean/Ramify.lean
//   traceable / opaque / suggestion heads
//                       web/src/trace.ts  ==  lean/ProofTreeRecover.lean
//   SETTING_WRITES      ext/ramify/settingWrites.js  ==  package.json's
//                       ramify.view.* / reading.* / diagnostics.autoOpen /
//                       appearance (keys, enums, scope, width range)
//
//     node scripts/check-sync.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(resolve(root, f), "utf8");

/** The string literals of the array assigned to `name` (TypeScript `= [`,
 JavaScript `= [`, Lean `:= #[`). */
function list(file, name) {
  const src = read(file);
  const m = new RegExp(`(?:const|def)\\s+${name}\\b[^=]*:?=\\s*#?\\[([^\\]]*)\\]`).exec(src);
  if (!m) throw new Error(`${file}: no array named ${name}`);
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
}

const failures = [];
const same = (what, a, b, an, bn) => {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) failures.push(`${what}\n    ${an}: ${a.join(" ")}\n    ${bn}: ${b.join(" ")}`);
};
const sameSet = (what, a, b, an, bn) => same(what, [...a].sort(), [...b].sort(), an, bn);

// ── hover-bar move ids ────────────────────────────────────────────────────
const moves = list("web/src/moves.ts", "MOVE_IDS");
const extMoves = list("ext/ramify/extension.js", "MOVE_IDS");
same("MOVE_IDS (moves.ts vs extension.js), same order", moves, extMoves, "moves.ts", "extension.js");

const pkg = JSON.parse(read("ext/ramify/package.json"));
const props = pkg.contributes.configuration.properties;
const enumOf = (kind) => props[`ramify.hoverBar.${kind}`].items.enum;
const tacticOnly = list("web/src/moveSlots.ts", "TACTIC_ONLY");
sameSet("TACTIC_ONLY (moveSlots.ts vs extension.js TACTIC_ONLY_MOVES)", tacticOnly, list("ext/ramify/extension.js", "TACTIC_ONLY_MOVES"), "moveSlots.ts", "extension.js");
// appliesToKind: a goal takes everything not tactic-only; a tactic everything but `focus`.
same("ramify.hoverBar.tactic enum (moves.ts order, minus focus)", moves.filter((x) => x !== "focus"), enumOf("tactic"), "expected", "package.json");
same("ramify.hoverBar.goal enum (moves.ts order, minus tactic-only)", moves.filter((x) => !tacticOnly.includes(x)), enumOf("goal"), "expected", "package.json");
sameSet("union of the two enums vs MOVE_IDS", [...new Set([...enumOf("tactic"), ...enumOf("goal")])], moves, "package.json", "moves.ts");
for (const kind of ["tactic", "goal"]) {
  const p = props[`ramify.hoverBar.${kind}`];
  const bad = p.default.filter((x) => !p.items.enum.includes(x));
  if (bad.length) failures.push(`ramify.hoverBar.${kind} default names ids outside its enum: ${bad.join(" ")}`);
  if (p.items.enumDescriptions.length !== p.items.enum.length)
    failures.push(`ramify.hoverBar.${kind}: enumDescriptions has ${p.items.enumDescriptions.length} entries for ${p.items.enum.length} ids`);
}

// ── automation candidates ────────────────────────────────────────────────
same("AUTOMATION_CANDIDATES (rewrite.ts) vs closingCandidates (Ramify.lean), same order", list("web/src/rewrite.ts", "AUTOMATION_CANDIDATES"), list("lean/Ramify.lean", "closingCandidates"), "rewrite.ts", "Ramify.lean");

// ── trace heads ──────────────────────────────────────────────────────────
for (const [ts, lean] of [["TRACEABLE_HEADS", "traceableHeads"], ["OPAQUE_HEADS", "opaqueHeads"], ["SUGGESTION_HEADS", "suggestionHeads"]])
  same(`${ts} (trace.ts) vs ${lean} (ProofTreeRecover.lean), same order`, list("web/src/trace.ts", ts), list("lean/ProofTreeRecover.lean", lean), "trace.ts", "ProofTreeRecover.lean");

// ── settings behind the band (batch 5) ───────────────────────────────────
// ext/ramify/settingWrites.js (the companion's allow-list and domains) vs
// package.json: every allow-listed key is contributed, every enum agrees, and
// every `prefs` key names an allow-listed setting. (web/src/viewSettings.ts vs
// settingWrites.js is `probe settings`, which can load TypeScript.)
{
  const require = createRequire(import.meta.url);
  const sw = require(resolve(root, "ext/ramify/settingWrites.js"));
  for (const [key, dom] of Object.entries(sw.SETTING_WRITES)) {
    const p = props[`ramify.${key}`];
    if (!p) {
      failures.push(`settingWrites.js allows ramify.${key}, which package.json does not contribute`);
      continue;
    }
    if (p.scope !== "resource") failures.push(`ramify.${key}: scope is not "resource"`);
    if (Array.isArray(dom)) same(`ramify.${key} enum (settingWrites.js vs package.json)`, dom, p.enum ?? [], "settingWrites.js", "package.json");
    else if (dom === "boolean" && ![].concat(p.type).includes("boolean"))
      failures.push(`ramify.${key}: settingWrites.js says boolean, package.json says ${p.type}`);
    else if (dom === "width") {
      const int = (p.anyOf ?? []).find((x) => x.type === "integer");
      if (!int || int.minimum !== sw.WIDTH_MIN || int.maximum !== sw.WIDTH_MAX)
        failures.push(`ramify.${key}: the integer range is not ${sw.WIDTH_MIN}..${sw.WIDTH_MAX}`);
    }
  }
  for (const [name, key] of Object.entries(sw.PREF_KEYS))
    if (!(key in sw.SETTING_WRITES)) failures.push(`settingWrites.js PREF_KEYS.${name} → ${key}, not on the allow-list`);
}

if (failures.length) {
  console.error(`${failures.length} list(s) out of step:\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  process.exit(1);
}
console.log("ok: move ids, automation candidates and trace heads agree across files");
