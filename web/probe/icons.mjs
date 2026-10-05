// @probe
// ONE CODICON = ONE MEANING (2026-10-05). The owner found `list-tree` serving
// both the outline layout and ⇑ "write out what `grind` used", `filter` the
// path move, and the scope chip still printing `⊹ path ·` and a text `✕` in
// the VS Code look. This probe keeps both from coming back.  Run:
//   npm run probe -- icons
//
// (a) web/src/icons.ts `ICON` names every slot's codicon; a name in two slots
//     must be one of `SAME_MEANING`'s groups (and every group must still
//     share one name) — else two meanings wear one icon.
// (b) No codicon name is spelled as a literal in a `name=` / `codicon:` /
//     `icon:` position anywhere else in web/src: every icon goes through
//     `ICON`, or (a) cannot see it. (codicon.ts is generated, codiconView.tsx
//     holds the classic tables keyed by name, icons.ts is the table.)
// (c) Every generated codicon is used by some slot (no dead path data).
// (d) No render file paints a CLASSIC GLYPH as text. Every line of a .tsx
//     file outside a comment that carries one of the old marks must be in
//     `ALLOWED` with the reason it is not a painted chrome mark (prose that
//     names a move by `MOVE_MARK`, a classic-only branch, a string that only
//     SIZES a chip whose paint is a codicon, the harness).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ICON, SAME_MEANING, CODICONS } from "./lib.mjs";
import { tally } from "./corpus.mjs";

const t = tally();
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

// (a)
const bySlotName = new Map();
for (const [slot, name] of Object.entries(ICON)) {
  if (!bySlotName.has(name)) bySlotName.set(name, []);
  bySlotName.get(name).push(slot);
}
const key = (slots) => [...slots].sort().join(",");
const groups = new Map(SAME_MEANING.map((g) => [key(g.slots), g]));
let shared = 0;
for (const [name, slots] of bySlotName) {
  if (slots.length < 2) continue;
  shared++;
  t.ok(groups.has(key(slots)), `\`${name}\` serves ${slots.join(", ")} — give each meaning its own icon, or list the group in SAME_MEANING with the reason`);
}
for (const g of SAME_MEANING) {
  const names = new Set(g.slots.map((s) => ICON[s]));
  t.ok(names.size === 1, `SAME_MEANING group ${g.slots.join(", ")} no longer shares one icon (${[...names].join(", ")})`);
  t.ok(g.slots.every((s) => s in ICON), `SAME_MEANING names a slot ICON does not have: ${g.slots.join(", ")}`);
}

// (b)
const EXEMPT = new Set(["codicon.ts", "codiconView.tsx", "icons.ts"]);
const files = readdirSync(src).filter((f) => /\.(ts|tsx)$/.test(f) && !EXEMPT.has(f));
const names = new Set(Object.keys(CODICONS));
/** `src` with comments blanked out (line structure kept). */
const uncomment = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (m, a) => a + " ".repeat(m.length - a.length));
const POS = [
  /\bname=["{]+"?([a-z][a-z-]*)"/g,
  /\bcodicon:\s*["']([a-z][a-z-]*)["']/g,
  /\bicon:\s*["']([a-z][a-z-]*)["']/g,
  /<Codicon\b[^>]*?\bname=\{[^}]*?["']([a-z][a-z-]*)["']/g,
];
let literals = 0;
for (const f of files) {
  const text = uncomment(readFileSync(path.join(src, f), "utf8"));
  for (const re of POS)
    for (const m of text.matchAll(re)) {
      if (!names.has(m[1])) continue;
      literals++;
      const line = text.slice(0, m.index).split("\n").length;
      t.ok(false, `${f}:${line} spells codicon "${m[1]}" — read it from icons.ts ICON`);
    }
}

// (c)
const used = new Set(Object.values(ICON));
for (const n of names) t.ok(used.has(n), `codicon "${n}" is generated but no ICON slot uses it — drop it from scripts/gen-codicons.mjs`);

// (d)
const CLASSIC = /[»◎◌⊹⁇⇓⇑⤵⤴✎⧉⚑⊞⊟⛶×‹›●○◇✕⚠]/u;
/** file → [substring of the line, why it may carry the glyph]. */
const ALLOWED = {
  "ProofTreeView.tsx": [
    ['"Back to the whole proof (Esc, or ◎', "a title naming the move by its MOVE_MARK (prose)"],
    ['"Back to the whole proof (Esc, or ⊹', "a title naming the move by its MOVE_MARK (prose)"],
    ['label: "×"', "sizes the pill's cancel chip; its paint is ICON chip.cancel"],
    ['glyph="×"', "sizes a pill's cancel chip; its paint is ICON chip.cancel"],
    ["a 7 × 1 dash", "a dimension in a comment-like JSX expression"],
  ],
  "pickChips.tsx": [
    ['push("cancel", "×"', "sizes the cancel chip; its paint is ICON chip.cancel"],
    ["— ‹ › to cycle", "a <title> naming the pager's keys (prose)"],
  ],
  "barChrome.tsx": [['{on ? "●" : "○"}', "the classic look's radio, inside its classic branch"]],
  "matrix.tsx": [
    ["{z}×", "the render matrix's zoom caption (harness)"],
    ["«stub tactic»", "harness"],
    ["Marks × node kinds", "the render matrix's heading (harness)"],
  ],
  "App.tsx": [["«stub tactic»", "harness"]],
};
let glyphLines = 0;
for (const f of readdirSync(src).filter((x) => x.endsWith(".tsx") && !EXEMPT.has(x))) {
  const lines = uncomment(readFileSync(path.join(src, f), "utf8")).split("\n");
  lines.forEach((ln, i) => {
    if (!CLASSIC.test(ln)) return;
    glyphLines++;
    const ok = (ALLOWED[f] ?? []).some(([s]) => ln.includes(s));
    t.ok(ok, `${f}:${i + 1} paints a classic glyph as text: ${ln.trim().slice(0, 90)} — draw it through Codicon (classic keeps it via codiconView's classic set), or allow it in probe/icons.mjs with the reason`);
  });
}

console.log(`${Object.keys(ICON).length} slots · ${names.size} codicons · ${shared} shared names · ${literals} stray literals · ${glyphLines} allow-listed glyph lines`);
t.done();
