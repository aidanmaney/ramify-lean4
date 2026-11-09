// @probe
// H6 — WRITE WHAT `exact?` FOUND, offline: `parseTryThis` over the measured
// message shapes, and `searchFixes` placing a suggestion on its step with the
// verbatim text over the tactic's tight range. Run:
//   npm run probe -- searchfix
import { parseTryThis, searchFixes, searchSuggestions } from "./lib.mjs";
import { tally } from "./corpus.mjs";

const t = tally();
const pos = (line, character) => ({ line, character });

// The shapes the audit measured on the live server (v4.32.2).
t.eq(parseTryThis("Try this:\n  [apply] exact audit_calc_term a b h"), "exact audit_calc_term a b h", "exact? with its [apply] tag");
t.eq(parseTryThis("Try this:\n  rw [Nat.add_comm]\n  -- no goals"), "rw [Nat.add_comm]", "rw? stops at the comment");
t.eq(parseTryThis("Try this: exact foo"), "exact foo", "one-line form");
t.eq(parseTryThis("Try these:\n  • exact a\n  • exact b"), "exact a", "first of a list");
t.eq(parseTryThis("Try this:\n  [apply] exact Nat.le_trans\n    (h a) (h b)"), "exact Nat.le_trans (h a) (h b)", "a wrapped term is rejoined");
t.eq(parseTryThis("`exact?` could not close the goal."), null, "a failed search offers nothing");
t.eq(parseTryThis("Try this:\n"), null, "an empty suggestion offers nothing");

// Placement: an `exact?` step at 26:2–26:8, its info message at the same start.
const node = (id, line, a, b, label) => ({ id, type: "tactic", label, position: { start: pos(line, a), stop: pos(line, b) }, parents: [], children: [] });
const nodes = [node("t1", 25, 2, 9, "intro h"), node("t2", 26, 2, 8, "exact?")];
const srcs = new Map([
  ["25:2", { start: pos(25, 2), stop: pos(25, 9), text: "intro h", indent: 2 }],
  ["26:2", { start: pos(26, 2), stop: pos(26, 8), text: "exact?", indent: 2 }],
]);
const ctx = { nodes, slots: [], src: (p) => srcs.get(`${p.line}:${p.character}`) ?? null };
const raw = [
  { range: { start: pos(26, 2), stop: pos(26, 8) }, severity: 3, message: "Try this:\n  [apply] exact foo h" },
  { range: { start: pos(25, 2), stop: pos(25, 9) }, severity: 2, message: "unused variable `h`" },
  { range: { start: pos(90, 2), stop: pos(90, 8) }, severity: 3, message: "Try this:\n  [apply] exact elsewhere" },
];
const sug = searchSuggestions(raw, { start: pos(24, 0), stop: pos(27, 0) });
t.eq(sug.length, 1, "only the suggestion inside the proof");
const fixes = searchFixes(sug, ctx);
const r = fixes.get("t2");
t.ok(!!r && !fixes.has("t1"), "the fix lands on the exact? step only");
t.eq(r?.edits[0].newText, "exact foo h", "verbatim suggestion");
t.eq(JSON.stringify(r?.edits[0].range), JSON.stringify({ start: pos(26, 2), end: pos(26, 8) }), "over the tactic's tight range");
t.eq(r?.kind, "expand", "rides the expand move");
// A suggestion on a step that is not a search tactic is not offered.
const plain = searchFixes([{ start: pos(25, 2), stop: pos(25, 9), text: "intro h'" }], ctx);
t.eq(plain.size, 0, "not on a non-search step");

t.done();
