import { injectStyleOnce } from "./taggedRender";

// Colour palette, resolved from the EDITOR's theme rather than hardcoded.
//
// Everything drawable is a CSS custom property on `[data-ptw-root]`, so the
// render sites carry `var(--ptw-…)` strings and the browser recomputes them
// when VS Code rewrites its variables — no re-render, no observer on the paint
// path. (The chrome already did this with `--vscode-editorWidget-*`; this
// extends it to the node fills, the text, and the syntax colours.)
//
// **The light/dark split is ONE decision, deliberately.** Node fills used to be
// fixed light pastels, which forced the token palette to be fixed light too —
// theme-following token colours would have gone light-on-light and vanished.
// Fixing only one half swaps that for the mirror bug (a dark node under a
// light-palette token), so both halves hang off the same `data-ptw-theme`
// stamp: either both switch or neither does, and they can never disagree.
//
// That stamp comes from the background's LUMINANCE (below), not from VS Code's
// `vscode-dark` body class. The luminance is the honest question — "will light
// ink read on this?" — and it answers correctly for a custom theme, a
// high-contrast theme, and any host that isn't a VS Code webview at all.
//
// **Two tiers of theme-following.** Hues (which blue means "goal") stay ours:
// they carry meaning and must stay distinguishable. But the node FILLS are
// mixed from `--vscode-editor-background`, so boxes sit in the editor's own
// base colour — a Solarized or Dracula background tints them without any
// per-theme table here. The plain colour is declared first and the `color-mix`
// second, so a browser without `color-mix` support keeps the flat pastel.

/** Is a colour dark enough that light ink reads on it? Null when unparseable. */
function luminanceOf(color: string): number | null {
  const s = color.trim();
  let r: number, g: number, b: number;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1];
    const w = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
    r = parseInt(w.slice(0, 2), 16);
    g = parseInt(w.slice(2, 4), 16);
    b = parseInt(w.slice(4, 6), 16);
  } else {
    const rgb = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (!rgb) return null;
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
    [r, g, b] = parts;
    // A fully transparent background tells us nothing about what shows through.
    if (parts.length >= 4 && parts[3] === 0) return null;
  }
  // Rec. 601 luma, which is plenty to separate "dark theme" from "light theme".
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export type ThemeKind = "light" | "dark";

/**
 * The theme kind, from whatever background the tree is actually drawn on:
 * VS Code's `--vscode-editor-background` when in the webview, else the
 * document's own computed background (the standalone app).
 */
export function resolveThemeKind(): ThemeKind {
  if (typeof document === "undefined") return "light";
  const rootStyle = getComputedStyle(document.documentElement);
  const candidates = [
    rootStyle.getPropertyValue("--vscode-editor-background"),
    document.body ? getComputedStyle(document.body).backgroundColor : "",
    rootStyle.backgroundColor,
  ];
  for (const c of candidates) {
    const lum = c ? luminanceOf(c) : null;
    if (lum !== null) return lum < 0.5 ? "dark" : "light";
  }
  return "light";
}

// Node fills are a TINT of the editor's own background: `color-mix` pulls the
// box toward our hue while leaving it recognisably the editor's surface.
const tint = (pct: number, hue: string, bg: string) =>
  `color-mix(in srgb, var(--vscode-editor-background, ${bg}) ${pct}%, ${hue})`;

// Scoped on `data-ptw-theme`, which ProofTreeView stamps on its OWN root — not
// on widget.tsx's `data-ptw-root` (the section-order marker), which the
// standalone app has no wrapper for and whose `:has(> …)` selectors a second
// copy would disturb.
const PALETTE_CSS = `
[data-ptw-theme] {
  --ptw-node-goal-fill: #dbeafe;
  --ptw-node-goal-fill: ${tint(86, "#1d6fd8", "#ffffff")};
  --ptw-node-goal-stroke: #1d6fd8;
  --ptw-node-tactic-fill: #d3f8df;
  --ptw-node-tactic-fill: ${tint(88, "#15803d", "#ffffff")};
  --ptw-node-tactic-stroke: #15803d;
  --ptw-node-default-fill: var(--vscode-editor-background, #ffffff);
  --ptw-node-default-stroke: #999999;
  --ptw-node-text: var(--vscode-editor-foreground, #1a202c);
  --ptw-accent: #dd6b20;
  --ptw-accent-text: #ffffff;
  --ptw-hyp-used: #1a365d;
  --ptw-hyp-unused: #7089a8;
  --ptw-hyp-mark: #c05621;
  --ptw-comment: #8b949e;
  --ptw-link: #555555;
  --ptw-muted: #666666;
  --ptw-edit-bg: var(--vscode-input-background, #ffffff);
  --ptw-edit-text: var(--vscode-input-foreground, #111111);
  --ptw-rail-pressed: #4a5568;
  /* Syntax colours: VS Code's default LIGHT theme (Light+). */
  --ptw-tok-keyword: #af00db;
  --ptw-tok-function: #795e26;
  --ptw-tok-variable: #001080;
  --ptw-tok-property: #0451a5;
  --ptw-tok-number: #098658;
  --ptw-tok-string: #a31515;
  --ptw-tok-comment: #008000;
  --ptw-tok-type: #267f99;
  --ptw-tok-sorry: #c53030;
}
[data-ptw-theme="dark"] {
  --ptw-node-goal-fill: #22304a;
  --ptw-node-goal-fill: ${tint(82, "#3b82f6", "#1f1f1f")};
  --ptw-node-goal-stroke: #5a9cf8;
  --ptw-node-tactic-fill: #1e3328;
  --ptw-node-tactic-fill: ${tint(84, "#22c55e", "#1f1f1f")};
  --ptw-node-tactic-stroke: #4ade80;
  --ptw-node-default-fill: var(--vscode-editor-background, #1f1f1f);
  --ptw-node-default-stroke: #6b7280;
  --ptw-node-text: var(--vscode-editor-foreground, #e6e6e6);
  --ptw-accent: #f0883e;
  --ptw-accent-text: #1f1f1f;
  --ptw-hyp-used: #cfe2f8;
  --ptw-hyp-unused: #8098b5;
  --ptw-hyp-mark: #f0a868;
  --ptw-comment: #7d8590;
  --ptw-link: #8b949e;
  --ptw-muted: #9ca3af;
  --ptw-edit-bg: var(--vscode-input-background, #313131);
  --ptw-edit-text: var(--vscode-input-foreground, #e6e6e6);
  --ptw-rail-pressed: #9ca3af;
  /* Syntax colours: VS Code's default DARK theme (Dark+). */
  --ptw-tok-keyword: #c586c0;
  --ptw-tok-function: #dcdcaa;
  --ptw-tok-variable: #9cdcfe;
  --ptw-tok-property: #9cdcfe;
  --ptw-tok-number: #b5cea8;
  --ptw-tok-string: #ce9178;
  --ptw-tok-comment: #6a9955;
  --ptw-tok-type: #4ec9b0;
  --ptw-tok-sorry: #f48771;
}
`;

export function ensurePaletteStyle() {
  injectStyleOnce("ptw-palette", PALETTE_CSS);
}

// Render-site handles. Every one is a `var()` reference, so a theme change is
// repainted by the browser rather than re-rendered by React.
export const NODE_STYLES = {
  goal: {
    fill: "var(--ptw-node-goal-fill)",
    stroke: "var(--ptw-node-goal-stroke)",
  },
  tactic: {
    fill: "var(--ptw-node-tactic-fill)",
    stroke: "var(--ptw-node-tactic-stroke)",
  },
  default: {
    fill: "var(--ptw-node-default-fill)",
    stroke: "var(--ptw-node-default-stroke)",
  },
};

export const NODE_TEXT = "var(--ptw-node-text)";
/** Accent outline for sequence endpoints and the cursor's tactic node. */
export const SEQ_STROKE = "var(--ptw-accent)";
export const ACCENT_TEXT = "var(--ptw-accent-text)";
export const HYP_USED_FILL = "var(--ptw-hyp-used)";
export const HYP_UNUSED_FILL = "var(--ptw-hyp-unused)";
export const HYP_MARK_FILL = "var(--ptw-hyp-mark)";
export const COMMENT_FILL = "var(--ptw-comment)";
export const LINK_STROKE = "var(--ptw-link)";
export const MUTED_FILL = "var(--ptw-muted)";
export const EDIT_BG = "var(--ptw-edit-bg)";
export const EDIT_TEXT = "var(--ptw-edit-text)";
export const RAIL_PRESSED = "var(--ptw-rail-pressed)";

/**
 * Semantic-token type → colour. Keyed by the LSP token-type names the server
 * sends (`SemanticTokenType.names`); an unmapped type inherits the label's own
 * colour, which is the right default for punctuation and the long tail.
 */
export const TOKEN_COLOR: Record<string, string> = {
  keyword: "var(--ptw-tok-keyword)",
  function: "var(--ptw-tok-function)",
  variable: "var(--ptw-tok-variable)",
  property: "var(--ptw-tok-property)",
  number: "var(--ptw-tok-number)",
  string: "var(--ptw-tok-string)",
  comment: "var(--ptw-tok-comment)",
  type: "var(--ptw-tok-type)",
  namespace: "var(--ptw-tok-type)",
  leanSorryLike: "var(--ptw-tok-sorry)",
};
