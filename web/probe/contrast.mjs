// @probe
// WCAG contrast of every TEXT ink the view paints, resolved from theme.ts's
// own PALETTE_CSS recipes (var() fallbacks, `color-mix(in srgb …)`, hex)
// over VS Code's Light Modern (bg #ffffff, fg #3b3b3b) and Dark Modern
// (bg #1f1f1f, fg #cccccc) — the editor's bg/fg ONLY, so every other host
// variable is absent and its fallback recipe is what is measured (the
// harness, the static viewer, the playground, a host that sets less).
//
// Each USE SITE is a token, the opacity the paint puts on top of it (one
// dimming at most — the rule since 2026-10-25), and the ground it sits on.
// Fails (exit 1) below 4.5:1 for text, so it can gate.
//   npm run probe -- contrast [--all]     (--all: print passing rows too)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../src/theme.ts"), "utf8");
const all = process.argv.includes("--all");

// ---- the opacities, read off theme.ts so the table cannot drift ----
const num = (name) => Number(new RegExp(`export const ${name} = ([0-9.]+)`).exec(src)[1]);
const DIM = num("DIM_OPACITY");

// ---- the palette ----
const css = /const PALETTE_CSS = `([\s\S]*?)`;/.exec(src)[1].replace(/\/\*[\s\S]*?\*\//g, "");
function block(sel) {
  const out = new Map();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (m[1].trim() !== sel) continue;
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i < 0) continue;
      const k = d.slice(0, i).trim();
      if (k.startsWith("--")) out.set(k, d.slice(i + 1).trim()); // last wins
    }
  }
  return out;
}
const BASE = block("[data-ptw-theme]");
const DARK = block('[data-ptw-theme="dark"]');
const CLASSIC = block('[data-ptw-theme][data-ptw-appearance="classic"]');

const hex = (s) => {
  const h = s.slice(1);
  const w = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  return { r: parseInt(w.slice(0, 2), 16), g: parseInt(w.slice(2, 4), 16), b: parseInt(w.slice(4, 6), 16), a: w.length === 8 ? parseInt(w.slice(6, 8), 16) / 255 : 1 };
};

// Split a function's argument list at top-level commas.
function args(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function evalColor(v, vars, host) {
  v = v.trim();
  if (v.startsWith("#")) return hex(v);
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  let m;
  if ((m = /^rgba?\((.*)\)$/.exec(v))) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  }
  if ((m = /^var\((.*)\)$/.exec(v))) {
    const [name, ...fb] = args(m[1]);
    const n = name.replace(/\\\\/g, "\\");
    if (n.startsWith("--vscode-")) {
      if (host[n]) return evalColor(host[n], vars, host);
      return evalColor(fb.join(","), vars, host);
    }
    if (vars.has(n)) return evalColor(vars.get(n), vars, host);
    return evalColor(fb.join(","), vars, host);
  }
  if ((m = /^color-mix\(in srgb,(.*)\)$/.exec(v))) {
    const [a, b] = args(m[1]);
    const part = (s) => {
      const pm = /^(.*?)\s+([0-9.]+)%$/.exec(s);
      return pm ? [pm[1], Number(pm[2]) / 100] : [s, null];
    };
    let [ca, pa] = part(a), [cb, pb] = part(b);
    if (pa === null && pb === null) pa = pb = 0.5;
    else if (pa === null) pa = 1 - pb;
    else if (pb === null) pb = 1 - pa;
    const A = evalColor(ca, vars, host), B = evalColor(cb, vars, host);
    // CSS color-mix: premultiplied alpha, then unpremultiply.
    const al = A.a * pa + B.a * pb;
    if (al === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const ch = (k) => (A[k] * A.a * pa + B[k] * B.a * pb) / al;
    const scale = pa + pb < 1 ? pa + pb : 1;
    return { r: ch("r"), g: ch("g"), b: ch("b"), a: al * scale };
  }
  throw new Error(`cannot evaluate ${v}`);
}

const over = (top, ground, op = 1) => {
  const a = top.a * op;
  return { r: top.r * a + ground.r * (1 - a), g: top.g * a + ground.g * (1 - a), b: top.b * a + ground.b * (1 - a), a: 1 };
};
const lum = ({ r, g, b }) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (x, y) => {
  const [l1, l2] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
};

const THEMES = {
  "Light Modern": { blocks: [BASE], host: { "--vscode-editor-background": "#ffffff", "--vscode-editor-foreground": "#3b3b3b" } },
  "Dark Modern": { blocks: [BASE, DARK], host: { "--vscode-editor-background": "#1f1f1f", "--vscode-editor-foreground": "#cccccc" } },
};

// Grounds: an SVG/HTML surface, resolved to an opaque colour over the page.
const GROUNDS = {
  bg: ["--ptw-bg"],
  surface: ["--ptw-surface"],
  "goal fill": ["--ptw-node-goal-fill"],
  "folded goal": ["--ptw-node-goal-fill", "--ptw-fold-bg"],
  "tactic fill": ["--ptw-node-tactic-fill"],
  chrome: ["--ptw-chrome-bg"],
  statusbar: ["--ptw-statusbar-bg"],
  menu: ["--ptw-menu-bg"],
  hover: ["--ptw-hover-bg"],
};

// [label, token, opacity on top, grounds]. One row per USE SITE that paints
// text (or a text-sized glyph a reader must read).
const SITES = [
  ["node label", "--ptw-node-text", 1, ["goal fill", "tactic fill", "surface"]],
  ["goal target ⊢", "--ptw-turnstile", 1, ["goal fill", "folded goal"]],
  ["hyp, used", "--ptw-hyp-used", 1, ["goal fill", "folded goal"]],
  ["hyp, unused", "--ptw-hyp-unused", 1, ["goal fill", "folded goal"]],
  ["hyp name", "--ptw-hypname", 1, ["goal fill"]],
  ["hyp name x✝", "--ptw-inaccessible", 1, ["goal fill", "folded goal"]],
  ["hyp mark • / ▸", "--ptw-hyp-mark", 1, ["goal fill"]],
  ["hyp +N more / ← origin", "--ptw-hyp-unused", 1, ["goal fill", "folded goal"]],
  ["case badge", "--ptw-case-ink", 1, ["bg"]],
  ["case prefix", "--ptw-muted", 1, ["bg"]],
  ["author comment strip", "--ptw-comment-text", 1, ["bg"]],
  ["generated strip", "--ptw-ghost-text", 1, ["bg"]],
  ["annotation (captions)", "--ptw-comment", 1, ["bg"]],
  ["ghost / trace label", "--ptw-comment", 1, ["surface", "tactic fill"]],
  ["seeded +N", "--ptw-comment", 1, ["goal fill"]],
  ["fold +N", "--ptw-fold-ph", 1, ["folded goal", "goal fill"]],
  ["hop chip ⋯", "--ptw-fold-ph", 1, ["bg"]],
  ["narrated prose", "--ptw-prose", 1, ["surface", "tactic fill"]],
  ["sorry", "--ptw-tok-sorry", 1, ["tactic fill"]],
  ["keyword token", "--ptw-tok-keyword", 1, ["tactic fill"]],
  ["comment token", "--ptw-tok-comment", 1, ["tactic fill", "bg"]],
  ["accent text", "--ptw-accent", 1, ["bg"]],
  ["chrome ink", "--ptw-chrome-ink", 1, ["chrome"]],
  ["chrome ink, dim", "--ptw-chrome-ink", DIM, ["chrome"]],
  ["status bar ink", "--ptw-statusbar-fg", 1, ["statusbar"]],
  ["status bar ink, dim (readout, off)", "--ptw-statusbar-fg", DIM, ["statusbar"]],
  ["muted (chrome)", "--ptw-muted", 1, ["chrome", "bg"]],
  ["menu ink, dim (shortcut)", "--ptw-menu-fg", DIM, ["menu"]],
  ["hover ink", "--ptw-hover-fg", 1, ["hover"]],
];

let fails = 0;
const rows = [];
for (const [tname, th] of Object.entries(THEMES)) {
  for (const classic of [false, true]) {
    const vars = new Map();
    for (const b of th.blocks) for (const [k, v] of b) vars.set(k, v);
    if (classic) for (const [k, v] of CLASSIC) vars.set(k, v);
    const col = (t) => evalColor(`var(${t})`, vars, th.host);
    const page = col("--ptw-bg");
    const ground = (g) => GROUNDS[g].reduce((acc, t) => over(col(t), acc), page);
    for (const [label, tok, op, gs] of SITES) {
      for (const g of gs) {
        const gr = ground(g);
        const r = ratio(over(col(tok), gr, op), gr);
        const bad = r < 4.5;
        if (bad) fails++;
        if (bad || all) rows.push(`${bad ? "FAIL" : "ok  "}  ${tname.padEnd(12)} ${classic ? "classic" : "vscode "}  ${label.padEnd(36)} ${tok.padEnd(22)} ×${String(op).padEnd(4)} on ${g.padEnd(12)} ${r.toFixed(2)}`);
      }
    }
  }
}
for (const r of rows) console.log(r);
console.log(`${fails === 0 ? "contrast: every text ink ≥ 4.5:1" : `contrast: ${fails} below 4.5:1`} (${SITES.length} sites × 2 themes × 2 appearances)`);
process.exit(fails ? 1 : 0);
