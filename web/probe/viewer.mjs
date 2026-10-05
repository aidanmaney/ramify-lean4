// @probe
// The STATIC VIEWER's offline gate: the payload `scripts/publish.mjs` builds
// from `ppharness --widget-data` output, and the pure modules the viewer page
// reads it with.  Run:   npm run probe -- viewer
//
// The fixtures in probe/viewer/ are REAL CLI output (`--widget-data`, core-only
// sources so no Mathlib is needed). Regenerate them after a change to the
// harvest or to these sources:
//
//   node scripts/publish.mjs --out /tmp/site --cache probe/viewer \
//     ../proofs/mvars.lean ../proofs/openblock.lean ../lean/ProofTreeDiagnostics.lean
//
// (the cache is reused while it is newer than the source: delete the three
// .ndjson files first to force a fresh elaboration).
//
// What it checks, per file: the payload is format version 1 and every proof
// carries the four groups the widget used to own; every baked tag's `h`
// indexes the file's interned `hovers`, and interning shrank the table; every
// tagged goal reads exactly as its printed goal (else the view silently draws
// it untagged); every tactic edit's `text` is the source's own bytes at the
// range it claims and every step has one; every diagnostic lies in the file.
// Then: a wrong or missing version is REFUSED with a reason; deep links round
// trip; the source lexer paints what it should; and the `?` panel names no
// move a reading-only session (reveal and nothing else) cannot make.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPayload } from "../scripts/publish.mjs";
import {
  checkPayload, PayloadError, PAYLOAD_VERSION, proofSlug, parseLink, formatLink,
  lexPaint, GESTURES, gestureShown, gestureText, flattenTaggedText,
  HYP_MODES, LAYOUT_MODES, COMMENT_MODES, stepGoalsAfter,
} from "./lib.mjs";
import { tally } from "./corpus.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const t = tally();

const FIXTURES = {
  mvars: "proofs/mvars.lean",
  openblock: "proofs/openblock.lean",
  ProofTreeDiagnostics: "lean/ProofTreeDiagnostics.lean",
};

/** Every `{h}` in a baked tagged text. */
const tagsOf = (tt, out = []) => {
  if (!tt) return out;
  if (tt.append) tt.append.forEach((x) => tagsOf(x, out));
  else if (tt.tag) { out.push(tt.tag[0]); tagsOf(tt.tag[1], out); }
  return out;
};

/** The text at an LSP range of `src` (UTF-16 columns, as JS strings are). */
const sliceAt = (lines, a, b) => {
  if (a.line === b.line) return lines[a.line].slice(a.character, b.character);
  const mid = lines.slice(a.line + 1, b.line);
  return [lines[a.line].slice(a.character), ...mid, lines[b.line].slice(0, b.character)].join("\n");
};

let proofs = 0, goals = 0, goalsTagged = 0, edits = 0, diags = 0;
for (const [name, rel] of Object.entries(FIXTURES)) {
  const ndjson = fs.readFileSync(path.join(here, "viewer", `${name}.ndjson`), "utf8");
  const source = fs.readFileSync(path.join(repo, rel), "utf8");
  const perRecord = ndjson.split("\n").filter(Boolean)
    .reduce((n, l) => n + (JSON.parse(l).data.proof.hovers?.length ?? 0), 0);
  const p = checkPayload(JSON.parse(JSON.stringify(buildPayload(ndjson, rel, source))));
  const lines = source.split("\n");
  t.eq(p.version, PAYLOAD_VERSION, `${name}: version`);
  t.ok(p.proofs.length > 0, `${name}: has proofs`);
  t.ok(p.hovers.length > 0 && p.hovers.length <= perRecord, `${name}: hovers interned (${p.hovers.length} ≤ ${perRecord})`);
  const slugs = new Set(p.proofs.map(proofSlug));
  t.eq(slugs.size, p.proofs.length, `${name}: proof slugs are unique`);
  for (const { proof, name: decl } of p.proofs) {
    proofs++;
    const who = `${name}:${decl ?? "example"}`;
    for (const k of ["diagnostics", "tacticEdits", "taggedGoals", "tokenInfos", "declHeader"])
      t.ok(k in proof, `${who}: carries ${k}`);
    t.ok(!("hovers" in proof), `${who}: per-record hovers folded into the file's`);
    // Every baked tag points into the table.
    const tags = [
      ...(proof.taggedGoals ?? []).flatMap((g) => [
        ...tagsOf(g.goal.type),
        ...g.goal.hyps.flatMap((h) => [...tagsOf(h.type), ...tagsOf(h.val)]),
      ]),
      ...(proof.tokenInfos ?? []).flatMap((i) => tagsOf(i.code)),
    ];
    t.ok(tags.every((g) => Number.isInteger(g.h) && g.h >= 0 && g.h < p.hovers.length), `${who}: every tag indexes hovers`);
    // A tagged goal must read as the printed one, or the renderer drops it.
    const printed = new Map();
    for (const g of proof.allGoals) printed.set(g.id, g.type);
    for (const s of proof.steps) {
      printed.set(s.goalBefore.id, s.goalBefore.type);
      for (const g of stepGoalsAfter(s)) printed.set(g.id, g.type);
    }
    for (const g of proof.taggedGoals ?? []) {
      if (!printed.has(g.goalId)) continue;
      goals++;
      if (flattenTaggedText(g.goal.type) === printed.get(g.goalId)) goalsTagged++;
    }
    // Tight edits: the text is the file's own at the claimed range.
    const starts = new Set((proof.tacticEdits ?? []).map((e) => `${e.stepStart.line}:${e.stepStart.character}`));
    for (const e of proof.tacticEdits ?? []) {
      edits++;
      t.eq(sliceAt(lines, e.start, e.stop), e.text, `${who}: edit at ${e.start.line}:${e.start.character} is the source's own text`);
    }
    for (const s of proof.steps)
      if (s.position && !proof.recovered?.some((r) => r.start.line === s.position.start.line && r.start.character === s.position.start.character))
        t.ok(starts.has(`${s.position.start.line}:${s.position.start.character}`), `${who}: step ${s.tacticString} has an edit`);
    for (const d of proof.diagnostics ?? []) {
      diags++;
      t.ok(d.range.start.line < lines.length && [1, 2, 3].includes(d.severity), `${who}: diagnostic in the file`);
    }
    if (proof.declHeader)
      t.eq(sliceAt(lines, proof.declHeaderStart, { line: proof.declHeaderStart.line + proof.declHeader.split("\n").length - 1, character: (proof.declHeader.split("\n").length > 1 ? 0 : proof.declHeaderStart.character) + proof.declHeader.split("\n").at(-1).length }), proof.declHeader, `${who}: header is the source's text`);
  }
}
t.ok(goals > 0 && goalsTagged === goals, `tagged goals read as printed: ${goalsTagged}/${goals}`);
t.ok(diags > 0, "the fixtures carry diagnostics");

// A payload this page cannot read is refused, with a reason.
const refused = (raw) => { try { checkPayload(raw); return null; } catch (e) { return e instanceof PayloadError ? e.message : `wrong error: ${e}`; } };
t.ok(/version 2.*reads version 1/.test(refused({ version: 2, file: "x", source: "", hovers: [], proofs: [] }) ?? ""), "version 2 refused by number");
t.ok(/no format version/.test(refused({ file: "x", source: "", hovers: [], proofs: [] }) ?? ""), "unversioned refused");
t.ok(/missing/.test(refused({ version: 1, file: "x" }) ?? ""), "shapeless refused");

// Deep links round trip, every view word by its bar name.
for (const layout of Object.keys(LAYOUT_MODES))
  for (const context of Object.keys(HYP_MODES))
    for (const comments of Object.keys(COMMENT_MODES)) {
      const l = { file: "euclid", proof: "Nat.foo'", layout, context, comments };
      t.eq(JSON.stringify(parseLink(formatLink(l))), JSON.stringify(l), `link ${layout}/${context}/${comments}`);
    }
t.eq(JSON.stringify(parseLink("#file=a&layout=nonsense")), JSON.stringify({ file: "a" }), "unknown view word dropped");
{
  const l = { file: "euclid", layout: "spine", appearance: "classic" };
  t.eq(JSON.stringify(parseLink(formatLink(l))), JSON.stringify(l), "link appearance=classic");
  t.eq(JSON.stringify(parseLink("#file=a&appearance=vscode")), JSON.stringify({ file: "a" }), "the default appearance is never named");
}

// The lexer.
{
  const src = 'theorem t : "a" = "a" := by -- c\n  /- x /- y -/ z -/ exact rfl 12';
  const p = lexPaint(src);
  const at = (s, k = 0) => p[src.indexOf(s) + k];
  t.eq(at("theorem"), "keyword", "lex keyword");
  t.eq(at('"a"'), "string", "lex string");
  t.eq(at("-- c"), "comment", "lex line comment");
  t.eq(at("z -/"), "comment", "lex NESTED block comment continues after the inner close");
  t.eq(at("exact"), null, "lex leaves tactics to the server's tokens");
  t.eq(at("12"), "number", "lex number");
}

// The `?` panel in a reading-only session names no Lean-only move.
{
  const caps = { reveal: true, edit: false, add: false, popout: false, del: false, flags: false, restructure: false, undo: false, polish: false, restart: false, play: false };
  const shown = GESTURES.filter((g) => gestureShown(g, caps)).map(gestureText);
  const LEAN_ONLY = /\b(edit|flag|chip|undo|redo|model|reword|stub|add a tactic|lens|restart)\b/i;
  for (const s of shown) t.ok(!LEAN_ONLY.test(s), `? panel, reading only: "${s}"`);
  t.ok(shown.some((s) => s.startsWith("drag")) && shown.some((s) => s.startsWith("⇧F10")), "? panel keeps drag and ⇧F10, in their reading wording");
  const all = { ...Object.fromEntries(Object.keys(caps).map((k) => [k, true])) };
  t.eq(GESTURES.filter((g) => gestureShown(g, all)).filter((g) => g.input === "drag").length, 1, "with every cap, one drag row");
}

console.log(`${proofs} proofs · ${goalsTagged}/${goals} tagged goals read as printed · ${edits} edits · ${diags} diagnostics`);
t.done();
