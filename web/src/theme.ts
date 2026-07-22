import { injectStyleOnce } from "./taggedRender";

// Colour palette, resolved from the EDITOR's theme rather than hardcoded.
//
// Everything drawable is a CSS custom property on `[data-ptw-theme]`, so the
// render sites carry `var(--ptw-…)` strings and the browser recomputes them
// when VS Code rewrites its variables — no re-render, no observer on the paint
// path. (The chrome already did this with `--vscode-editorWidget-*`; this
// extends it to the node fills, the text, and the syntax colours.)
//
// **Everything is anchored to the theme's own background and foreground.** That
// is what makes this work for a theme nobody here has seen: `--ptw-bg` and
// `--ptw-fg` are the editor's, and every other colour is a `color-mix` of a hue
// INTO one of them. Hue is used sparingly and only where it carries meaning —
// which box is a goal, which is a tactic, which token is a keyword. A first
// attempt mixed saturated hues at full strength and used VS Code's Dark+ token
// palette verbatim; against a soft theme (Catppuccin, Solarized, Nord) that
// reads as neon, because those palettes are calibrated for their OWN
// background and foreground, not for someone else's. Mixing toward the live
// `--ptw-fg` desaturates every hue by exactly as much as the theme is soft.
//
// The structure is deliberate: the RECIPES below are written once, in the base
// block, and the dark block overrides only their INPUTS (`--ptw-surface`, the
// hues, the bg/fg fallbacks). Custom properties substitute lazily at use time,
// so a recipe defined once picks up whichever inputs are in scope.
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
// Nodes stay a shade LIGHTER than the page (`--ptw-surface`: in a dark theme
// the background lifted toward the foreground, the elevation step themes like
// Catppuccin build in as surface0) so a box still reads as a raised card. Each
// derived value declares a flat fallback first and the `color-mix` second, so
// a browser without `color-mix` keeps a sane flat colour.

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

// Scoped on `data-ptw-theme`, which ProofTreeView stamps on its OWN root — not
// on widget.tsx's `data-ptw-root` (the section-order marker), which the
// standalone app has no wrapper for and whose `:has(> …)` selectors a second
// copy would disturb.
const PALETTE_CSS = `
[data-ptw-theme] {
  /* ---- Inputs. The dark block overrides only these. ---- */
  --ptw-bg: var(--vscode-editor-background, #ffffff);
  --ptw-fg: var(--vscode-editor-foreground, #1f2328);
  /* The surface a node box sits on. Light themes already have the page at the
     top of the elevation scale, so a card stays at the background. */
  --ptw-surface: var(--ptw-bg);
  --ptw-hue-goal: #2563eb;
  --ptw-hue-tactic: #15803d;
  --ptw-hue-accent: #b45309;
  /* Raw syntax hues (VS Code Light+). Muted into --ptw-fg by the recipes. */
  --ptw-raw-keyword: #af00db;
  --ptw-raw-function: #795e26;
  --ptw-raw-variable: #001080;
  --ptw-raw-property: #0451a5;
  --ptw-raw-number: #098658;
  --ptw-raw-string: #a31515;
  --ptw-raw-comment: #008000;
  --ptw-raw-type: #267f99;
  --ptw-raw-sorry: #c53030;

  /* ---- Recipes. Written once; inherited by the dark block. ---- */
  /* A box is its surface with a whisper of hue — enough to tell goal from
     tactic at a glance, not enough to read as a coloured panel. */
  --ptw-node-goal-fill: #eef2fd;
  --ptw-node-goal-fill: color-mix(in srgb, var(--ptw-surface) 92%, var(--ptw-hue-goal));
  --ptw-node-tactic-fill: #eef7f0;
  --ptw-node-tactic-fill: color-mix(in srgb, var(--ptw-surface) 90%, var(--ptw-hue-tactic));
  --ptw-node-default-fill: var(--ptw-surface);
  /* Borders carry most of the identifying colour, softened toward the page. */
  --ptw-node-goal-stroke: #6691f1;
  --ptw-node-goal-stroke: color-mix(in srgb, var(--ptw-hue-goal) 68%, var(--ptw-bg));
  --ptw-node-tactic-stroke: #5da572;
  --ptw-node-tactic-stroke: color-mix(in srgb, var(--ptw-hue-tactic) 68%, var(--ptw-bg));
  --ptw-node-default-stroke: #9aa0a6;
  --ptw-node-default-stroke: color-mix(in srgb, var(--ptw-fg) 38%, var(--ptw-bg));
  --ptw-node-text: var(--ptw-fg);

  /* The cursor/endpoint accent is the one place that should still pop. */
  --ptw-accent: var(--ptw-hue-accent);
  --ptw-accent-text: var(--ptw-bg);

  /* Context lines are the densest text in the tree, so they are plain
     foreground with the unused ones dimmed — no hue at all. The dim is 62%,
     not lower: it is real content, and on an already-low-contrast theme
     (Solarized Light, whose own foreground is a soft grey-blue) dimming
     compounds with the theme's own softness and pushes it past legible. */
  --ptw-hyp-used: var(--ptw-fg);
  --ptw-hyp-unused: #7a8288;
  --ptw-hyp-unused: color-mix(in srgb, var(--ptw-fg) 62%, var(--ptw-surface));
  --ptw-hyp-mark: #b4763a;
  --ptw-hyp-mark: color-mix(in srgb, var(--ptw-hue-accent) 72%, var(--ptw-fg));

  --ptw-comment: #8b949e;
  --ptw-comment: color-mix(in srgb, var(--ptw-fg) 55%, var(--ptw-bg));
  --ptw-link: #9aa0a6;
  --ptw-link: color-mix(in srgb, var(--ptw-fg) 42%, var(--ptw-bg));
  --ptw-muted: #6e7681;
  --ptw-muted: color-mix(in srgb, var(--ptw-fg) 62%, var(--ptw-bg));
  --ptw-rail-pressed: #4a5568;
  --ptw-rail-pressed: color-mix(in srgb, var(--ptw-fg) 68%, var(--ptw-bg));
  --ptw-edit-bg: var(--vscode-input-background, var(--ptw-surface));
  --ptw-edit-text: var(--vscode-input-foreground, var(--ptw-fg));

  /* Syntax colours: the raw hue pulled toward the theme's own text colour, so
     a soft theme gets soft tokens and a vivid one keeps its bite. This is what
     stops the palette reading as neon on Catppuccin/Solarized/Nord. */
  --ptw-tok-keyword: color-mix(in srgb, var(--ptw-raw-keyword) 72%, var(--ptw-fg));
  --ptw-tok-function: color-mix(in srgb, var(--ptw-raw-function) 72%, var(--ptw-fg));
  --ptw-tok-variable: color-mix(in srgb, var(--ptw-raw-variable) 72%, var(--ptw-fg));
  --ptw-tok-property: color-mix(in srgb, var(--ptw-raw-property) 72%, var(--ptw-fg));
  --ptw-tok-number: color-mix(in srgb, var(--ptw-raw-number) 72%, var(--ptw-fg));
  --ptw-tok-string: color-mix(in srgb, var(--ptw-raw-string) 72%, var(--ptw-fg));
  --ptw-tok-comment: color-mix(in srgb, var(--ptw-raw-comment) 72%, var(--ptw-fg));
  --ptw-tok-type: color-mix(in srgb, var(--ptw-raw-type) 72%, var(--ptw-fg));
  --ptw-tok-sorry: color-mix(in srgb, var(--ptw-raw-sorry) 72%, var(--ptw-fg));
}
[data-ptw-theme="dark"] {
  --ptw-bg: var(--vscode-editor-background, #1f1f1f);
  --ptw-fg: var(--vscode-editor-foreground, #e6e6e6);
  /* One elevation step up from the page — the surface0 idea, derived rather
     than tabulated, so it lands correctly on any dark theme. */
  --ptw-surface: #2c2c33;
  --ptw-surface: color-mix(in srgb, var(--ptw-bg) 90%, var(--ptw-fg));
  /* Pastel hues: on a dark page a saturated hue is what reads as neon. */
  --ptw-hue-goal: #7aa2f7;
  --ptw-hue-tactic: #94d3a2;
  --ptw-hue-accent: #e0a06a;
  /* Raw syntax hues (VS Code Dark+), muted into --ptw-fg by the recipes. */
  --ptw-raw-keyword: #c586c0;
  --ptw-raw-function: #dcdcaa;
  --ptw-raw-variable: #9cdcfe;
  --ptw-raw-property: #9cdcfe;
  --ptw-raw-number: #b5cea8;
  --ptw-raw-string: #ce9178;
  --ptw-raw-comment: #6a9955;
  --ptw-raw-type: #4ec9b0;
  --ptw-raw-sorry: #f48771;
  /* Flat fallbacks for the no-color-mix case, dark variants. */
  --ptw-node-goal-fill: #313749;
  --ptw-node-goal-fill: color-mix(in srgb, var(--ptw-surface) 92%, var(--ptw-hue-goal));
  --ptw-node-tactic-fill: #2f3a34;
  --ptw-node-tactic-fill: color-mix(in srgb, var(--ptw-surface) 90%, var(--ptw-hue-tactic));
  --ptw-node-goal-stroke: #5e7abb;
  --ptw-node-goal-stroke: color-mix(in srgb, var(--ptw-hue-goal) 68%, var(--ptw-bg));
  --ptw-node-tactic-stroke: #6d9c7a;
  --ptw-node-tactic-stroke: color-mix(in srgb, var(--ptw-hue-tactic) 68%, var(--ptw-bg));
  --ptw-node-default-stroke: #6b7280;
  --ptw-node-default-stroke: color-mix(in srgb, var(--ptw-fg) 38%, var(--ptw-bg));
  --ptw-hyp-unused: #8b9198;
  --ptw-hyp-unused: color-mix(in srgb, var(--ptw-fg) 62%, var(--ptw-surface));
  --ptw-hyp-mark: #d9a271;
  --ptw-hyp-mark: color-mix(in srgb, var(--ptw-hue-accent) 72%, var(--ptw-fg));
  --ptw-comment: #7d8590;
  --ptw-comment: color-mix(in srgb, var(--ptw-fg) 55%, var(--ptw-bg));
  --ptw-link: #6e7681;
  --ptw-link: color-mix(in srgb, var(--ptw-fg) 42%, var(--ptw-bg));
  --ptw-muted: #9ca3af;
  --ptw-muted: color-mix(in srgb, var(--ptw-fg) 62%, var(--ptw-bg));
  --ptw-rail-pressed: #9ca3af;
  --ptw-rail-pressed: color-mix(in srgb, var(--ptw-fg) 68%, var(--ptw-bg));
}

/* Outline mode (the rail's □): drop the fills, keep the borders. Last in the
   sheet on purpose — it has the same specificity as the theme blocks above,
   so source order is what lets it win. Transparent rather than the page
   colour, so the box is genuinely unfilled; the layout's bands are
   overlap-free by construction, so nothing hides behind a node to bleed
   through. */
[data-ptw-fill="none"] {
  --ptw-node-goal-fill: transparent;
  --ptw-node-tactic-fill: transparent;
  --ptw-node-default-fill: transparent;
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
