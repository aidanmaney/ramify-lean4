import { injectStyleOnce } from "./taggedRender";

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

    if (parts.length >= 4 && parts[3] === 0) return null;
  }

  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export type ThemeKind = "light" | "dark";

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
  /* Warning amber: its own hue (40°), a clear step from the accent orange
     (26°), so a warning ribbon and a temporary mark cannot be mistaken.
     4.9:1 on white; the dark block lifts it. A host colour wins (below). */
  --ptw-hue-warn: #9a6700;
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
  --ptw-node-goal-stroke: #6692f1;
  --ptw-node-goal-stroke: color-mix(in srgb, var(--ptw-hue-goal) 70%, var(--ptw-bg));
  --ptw-node-tactic-stroke: #57a473;
  --ptw-node-tactic-stroke: color-mix(in srgb, var(--ptw-hue-tactic) 72%, var(--ptw-bg));
  --ptw-node-default-stroke: #939393;
  --ptw-node-default-stroke: color-mix(in srgb, var(--ptw-fg) 55%, var(--ptw-bg));
  --ptw-node-text: var(--ptw-fg);

  /* The cursor/endpoint accent is the one place that should still pop. */
  --ptw-accent: var(--ptw-hue-accent);
  --ptw-accent-text: var(--ptw-bg);

  /* The armed-delete confirm chip. Taken from the editor's OWN error colour
     rather than derived from a hue of ours: this is the one control that
     destroys text, and it should read the way the editor's own destructive
     signals do. Falls back to the syntax palette's sorry red, which is the
     nearest thing here (both mean "something is wrong at this spot"), so the
     standalone app and any host without the variable still get a red. */
  --ptw-danger: var(--vscode-errorForeground, var(--ptw-tok-sorry));

  /* Warning-severity diagnostics ("declaration uses 'sorry'", deprecations).
     The editor's own warning colour, for the same reason --ptw-danger takes its
     error one: a diagnostic drawn in the tree should read the way the squiggle
     for it reads in the buffer. editorWarning.foreground is the registry entry
     behind that squiggle; the fallback is its own amber (--ptw-hue-warn), distinct from the accent.
     (No backticks in here — this block is a template literal.) */
  --ptw-warn: var(--vscode-editorWarning-foreground, var(--ptw-hue-warn));

  /* Context lines are the densest text in the tree, so they are plain
     foreground with the unused ones dimmed — no hue at all. The dim is 74%
     (2026-09-28: the smallest mix that reaches 4.5:1 on a goal box in Light
     and Dark Modern), not lower: it is real content, and on an
     already-low-contrast theme (Solarized Light, whose own foreground is a
     soft grey-blue) dimming compounds with the theme's own softness and
     pushes it past legible. */
  --ptw-hyp-used: var(--ptw-fg);
  --ptw-hyp-unused: #6e6e6e;
  --ptw-hyp-unused: color-mix(in srgb, var(--ptw-fg) 74%, var(--ptw-surface));
  --ptw-hyp-mark: #b4763a;
  --ptw-hyp-mark: color-mix(in srgb, var(--ptw-hue-accent) 72%, var(--ptw-fg));

  /* HOVER ANSWER background — the lines the tactic under the pointer depends
     on, washed while you hold on its box. Its own token because it has to be
     told apart AT A GLANCE from the tactic DIFF right beside it (and often on
     the same line): the diff says "this changed", this says "this is used",
     and they are different claims about the same text.

     Same 22% weight as --ptw-diff-ins/del, a DIFFERENT hue. Weight, because
     both sit under code that has to stay readable and a heavier wash of one
     would read as the more important fact; hue, because that is the channel
     left once extent is spoken for (the diff paints subterms, this paints the
     whole line). The hue is the ACCENT — the gutter marker's own — since this
     is that marker's claim made visible on demand, and it is nowhere near the
     diff's green and red. Mixed against --ptw-surface, not --ptw-bg: it lands
     inside a node box (the --ptw-prose lesson). */
  --ptw-hyp-lit: #f0dcc9;
  --ptw-hyp-lit: color-mix(in srgb, var(--ptw-hue-accent) 22%, var(--ptw-surface));

  /* TACTIC DIFF backgrounds — what the producing tactic changed inside a goal
     box. Only a FALLBACK: wherever --vscode-diffEditor-*TextBackground exists
     (any VS Code host) taggedRender's rules take the editor's own colour, so
     a highlight in the tree is the very colour the infoview paints. These are
     for a host without those variables. Mixed against --ptw-surface, not
     --ptw-bg, because they land inside a node box (the --ptw-prose lesson),
     and kept WEAK — 22% — since the highlight sits under code that must stay
     readable, unlike the ribbons, which sit beside it. */
  --ptw-diff-ins: #dcf0e2;
  --ptw-diff-ins: color-mix(in srgb, var(--ptw-hue-tactic) 22%, var(--ptw-surface));
  --ptw-diff-del: #f6dede;
  --ptw-diff-del: color-mix(in srgb, var(--ptw-danger) 22%, var(--ptw-surface));

  --ptw-comment: #767676;
  --ptw-case: #6b7f99;
  --ptw-comment: color-mix(in srgb, var(--ptw-fg) 70%, var(--ptw-bg));
  /* Narration mode's prose, drawn INSIDE a node box rather than on the page.
     Same words, different ground: --ptw-comment is mixed against --ptw-bg,
     which is right for a strip riding on the background, but a box sits on
     --ptw-surface (lifted 10% toward the foreground), so the identical ink
     lands with visibly less contrast there — reported as exactly that. Mixed
     against the SURFACE for the same reason --ptw-hyp-unused is, and at 75%
     rather than 70%: a strip is an aside beside the content, while in
     narration the prose IS the box's content and only the italic and the
     hueless grey need to say it is not code. */
  --ptw-prose: #b6bdc6;
  --ptw-prose: color-mix(in srgb, var(--ptw-fg) 75%, var(--ptw-surface));
  --ptw-link: #939393;
  --ptw-link: color-mix(in srgb, var(--ptw-fg) 55%, var(--ptw-bg));
  /* Opt-in link tint (ramify.linkTint): the neutral link ink pulled toward
     the TARGET node's hue, so an edge hints at what it runs into. Written as
     recipes over the hue inputs, so the dark block's overrides flow through. */
  --ptw-link-goal: #7f95cd;
  --ptw-link-goal: color-mix(in srgb, var(--ptw-hue-goal) 45%, var(--ptw-link));
  --ptw-link-tactic: #6d9a78;
  --ptw-link-tactic: color-mix(in srgb, var(--ptw-hue-tactic) 45%, var(--ptw-link));
  --ptw-muted: #767676;
  --ptw-muted: color-mix(in srgb, var(--ptw-fg) 70%, var(--ptw-bg));
  --ptw-rail-pressed: #4a5568;
  --ptw-rail-pressed: color-mix(in srgb, var(--ptw-fg) 68%, var(--ptw-bg));
  /* THE CHROME'S INK (2026-09-22 taste pass). Every floater — status bar,
     rail, menus, tips, toasts, the hover bar — used to read VS Code's
     editor-widget variables straight, each with a LIGHT literal fallback
     (#cbd5e0, #2d3748, rgba(255,255,255,0.97)…), so wherever those variables
     are absent (the harness; a host that does not set them) a dark theme got
     white cards with dark ink: the recorded light-on-light trap, inverted.
     The host's variable still wins; the fallback is now DERIVED from bg/fg,
     so it lands on either side of the luminance split. */
  --ptw-chrome-bg: var(--vscode-editorWidget-background, var(--ptw-surface));
  --ptw-chrome-border: var(--vscode-editorWidget-border, color-mix(in srgb, var(--ptw-fg) 22%, var(--ptw-bg)));
  --ptw-chrome-ink: var(--vscode-icon-foreground, color-mix(in srgb, var(--ptw-fg) 85%, var(--ptw-bg)));
  --ptw-chrome-btn: var(--vscode-toolbar-hoverBackground, color-mix(in srgb, var(--ptw-fg) 5%, var(--ptw-chrome-bg)));
  --ptw-chrome-lit: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--ptw-hue-goal) 16%, transparent));
  --ptw-focus: var(--vscode-focusBorder, var(--ptw-hue-goal));
  /* THE MESSAGE STRIP's tint (2026-09-24): a wash of the severity's own ink
     over the chrome's background (so it stays opaque over the tree and lands
     on either side of the luminance split with the chrome ink still readable
     on it), and the same ink, whole, for its left edge. Error and warning take
     the editor's own colours (--ptw-danger / --ptw-warn); a lint is comment
     ink, as its ribbon is — the proof is correct and a style rule speaks. */
  --ptw-diag-error-edge: var(--ptw-danger);
  --ptw-diag-warn-edge: var(--ptw-warn);
  --ptw-diag-lint-edge: var(--ptw-comment);
  --ptw-diag-error-wash: color-mix(in srgb, var(--ptw-danger) 13%, var(--ptw-chrome-bg));
  --ptw-diag-warn-wash: color-mix(in srgb, var(--ptw-warn) 13%, var(--ptw-chrome-bg));
  --ptw-diag-lint-wash: color-mix(in srgb, var(--ptw-comment) 11%, var(--ptw-chrome-bg));
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
  --ptw-hue-warn: #d9b53f;
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
  --ptw-node-goal-stroke: #5f7bb6;
  --ptw-node-goal-stroke: color-mix(in srgb, var(--ptw-hue-goal) 70%, var(--ptw-bg));
  --ptw-node-tactic-stroke: #73a17d;
  --ptw-node-tactic-stroke: color-mix(in srgb, var(--ptw-hue-tactic) 72%, var(--ptw-bg));
  --ptw-node-default-stroke: #696969;
  --ptw-node-default-stroke: color-mix(in srgb, var(--ptw-fg) 43%, var(--ptw-bg));
  --ptw-hyp-unused: #a4a4a4;
  --ptw-hyp-unused: color-mix(in srgb, var(--ptw-fg) 74%, var(--ptw-surface));
  --ptw-hyp-mark: #d9a271;
  --ptw-hyp-mark: color-mix(in srgb, var(--ptw-hue-accent) 72%, var(--ptw-fg));
  --ptw-hyp-lit: #4a3f37;
  --ptw-hyp-lit: color-mix(in srgb, var(--ptw-hue-accent) 22%, var(--ptw-surface));
  --ptw-comment: #989898;
  --ptw-case: #8fa3bf;
  --ptw-comment: color-mix(in srgb, var(--ptw-fg) 70%, var(--ptw-bg));
  --ptw-prose: #aeb6c0;
  --ptw-prose: color-mix(in srgb, var(--ptw-fg) 75%, var(--ptw-surface));
  --ptw-link: #696969;
  --ptw-link: color-mix(in srgb, var(--ptw-fg) 43%, var(--ptw-bg));
  --ptw-muted: #989898;
  --ptw-muted: color-mix(in srgb, var(--ptw-fg) 70%, var(--ptw-bg));
  --ptw-rail-pressed: #9ca3af;
  --ptw-rail-pressed: color-mix(in srgb, var(--ptw-fg) 68%, var(--ptw-bg));
  /* The comment green, lifted for AA (4.5:1) on a dark surface: at the shared
     72% the dark palette's raw green (#6a9955) mixed to 3.9:1. */
  --ptw-tok-comment: color-mix(in srgb, var(--ptw-raw-comment) 53%, var(--ptw-fg));
}

/* Keyboard focus, one ring for every chrome button (the browser's own default
   is invisible on the bar's filled pills). --ptw-focus is the editor's
   focusBorder. Only :focus-visible, so a mouse click draws nothing. */
[data-ptw-theme] button:focus-visible {
  outline: 2px solid var(--ptw-focus);
  outline-offset: 1px;
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

export const SEQ_STROKE = "var(--ptw-accent)";
/** The neutral ring: the editor overlay border and the like (not the accent). */
export const FOCUS_INK = "var(--ptw-focus)";
export const ACCENT_TEXT = "var(--ptw-accent-text)";
export const HYP_USED_FILL = "var(--ptw-hyp-used)";
export const HYP_UNUSED_FILL = "var(--ptw-hyp-unused)";
export const HYP_MARK_FILL = "var(--ptw-hyp-mark)";
export const HYP_LIT_FILL = "var(--ptw-hyp-lit)";

export type HypMarkStyle = "highlight" | "underline";
export const COMMENT_FILL = "var(--ptw-comment)";

export const PROSE_FILL = "var(--ptw-prose)";

export const CASE_FILL = "var(--ptw-case)";

export const SORRY_FILL = "var(--ptw-tok-sorry)";

export const DANGER_FILL = "var(--ptw-danger)";

export const WARN_FILL = "var(--ptw-warn)";
export const LINK_STROKE = "var(--ptw-link)";

export const LINK_STROKE_GOAL = "var(--ptw-link-goal)";
export const LINK_STROKE_TACTIC = "var(--ptw-link-tactic)";
export const MUTED_FILL = "var(--ptw-muted)";
export const EDIT_BG = "var(--ptw-edit-bg)";
export const EDIT_TEXT = "var(--ptw-edit-text)";
export const RAIL_PRESSED = "var(--ptw-rail-pressed)";

/** THE CHROME (2026-09-22 taste pass). One set of tokens for every floater,
 so a new one cannot pick its own literal fallback; see `--ptw-chrome-*`. */
export const CHROME_BG = "var(--ptw-chrome-bg)";
/** `--ptw-chrome-bg` laid over the editor background, for a CSS `background`.
A theme's `editorWidget.background` may carry ALPHA (2026-09-24: the tree read
through the status card and the message strip), and CSS cannot flatten a colour
onto another in one value — so every chrome surface paints two layers, the
token over the opaque `--ptw-bg`. SVG fills cannot layer; they draw an
underlay rect instead (`CHROME_UNDERLAY`). */
export const chromeSurface = (c: string = CHROME_BG) =>
  `linear-gradient(${c}, ${c}), var(--ptw-bg)`;
export const CHROME_SURFACE = chromeSurface();
/** The opaque fill an SVG chrome rect sits on (see `chromeSurface`). */
export const CHROME_UNDERLAY = "var(--ptw-bg)";
export const CHROME_BORDER = "var(--ptw-chrome-border)";
export const CHROME_INK = "var(--ptw-chrome-ink)";
/** A glyph button's resting fill (the hover bar's squares). */
export const CHROME_BTN = "var(--ptw-chrome-btn)";
/** The keyed row of a menu. */
export const CHROME_LIT = "var(--ptw-chrome-lit)";
/** The message strip's tint per severity (1 error, 2 warning, 3 lint): the
 left edge in the severity's ink and a wash of it over the chrome. */
export const DIAG_EDGE = {
  1: "var(--ptw-diag-error-edge)",
  2: "var(--ptw-diag-warn-edge)",
  3: "var(--ptw-diag-lint-edge)",
} as const;
export const DIAG_WASH = {
  1: "var(--ptw-diag-error-wash)",
  2: "var(--ptw-diag-warn-wash)",
  3: "var(--ptw-diag-lint-wash)",
} as const;
/** The UI face every piece of chrome speaks in — the host's own. Lean text
 (goals, tactics) stays in the code font; the width readouts' `44 col` are
 chrome and speak this face with tabular figures. */
export const CHROME_FONT = "var(--vscode-font-family, system-ui, sans-serif)";
/** One corner radius for HTML chrome and for the in-tree chrome that is not
 a node box (bar, tabs, badges). Node boxes have their own (`nodeRx`). */
export const CHROME_RADIUS = 3;
/** The two opacities chrome dims with: a control that cannot be used now,
 and a value or hint that reads as secondary/off. */
export const DISABLED_OPACITY = 0.35;
export const DIM_OPACITY = 0.76;
/** Tree-paint opacities (not chrome), named so each has its one reason. */
/** A ghost / unused mark that must recede behind the real content. */
export const FAINT_OPACITY = 0.45;
/** A dashed stub or preview stroke: present, but clearly not yet real. */
export const STUB_OPACITY = 0.6;
/** A hover-preview dim: the node stays legible while the verb is shown. */
export const PREVIEW_OPACITY = 0.9;
/** The faint wash over a marquee / band rectangle (fill only). */
export const WASH_OPACITY = 0.08;
/** A diagnostic box's wash: the severity ink over the box fill. */
export const DIAG_BOX_WASH_OPACITY = 0.07;
/** Two floating chrome type sizes (px): a secondary line and the body. */
export const CHROME_TEXT_SM = 11;
export const CHROME_TEXT = 12;
/** Tree-ink stroke weights: a chip/outline border and the emphasised one. */
export const TREE_INK_SW = 1.2;
export const TREE_INK_SW_BOLD = 1.5;
/** A pill's corner radius when the height is not known (a full round). */
export const PILL_RADIUS = 999;
/** The drop-shadow behind a floating chip (the status strip is flat). */
export const CHIP_SHADOW = "drop-shadow(0 1px 3px rgba(0,0,0,0.35))";
/** The stacking table, by TIER. Effective order preserved from the scattered
 literals: header band < `chrome` (the status card, the zoom rail and the
 banner, strip included) < signature < `popup` (bar panels, the toast, the
 header button) < node menu < tip < the page-level doc tip (body portal). */
export const Z = {
  header: 9,
  chrome: 10,
  signature: 11,
  popup: 12,
  nodeMenu: 25,
  tip: 30,
} as const;

export const POPUP_CHROME = {
  padding: "6px 9px",
  borderRadius: CHROME_RADIUS,
  background: CHROME_SURFACE,
  boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
} as const;

/** POPUP_CHROME plus the border, ink and face every floater shares. */
export const FLOATER_CHROME = {
  ...POPUP_CHROME,
  border: `1px solid ${CHROME_BORDER}`,
  color: CHROME_INK,
  fontFamily: CHROME_FONT,
} as const;

/** Props for chrome that renders OUTSIDE the view's `[data-ptw-theme]` scope
 (the relay banner, the error boundary's fallback, the empty state): they get
 the same tokens, so they need no raw host variables of their own. */
export function chromeScopeProps(): { "data-ptw-theme": ThemeKind } {
  ensurePaletteStyle();
  return { "data-ptw-theme": resolveThemeKind() };
}

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

export const TOKEN_VARS = new Set(
  Object.entries(TOKEN_COLOR)
    .filter(([type, v]) => v === `var(--ptw-tok-${type})`)
    .map(([type]) => type),
);

export function observeThemeChange(onChange: () => void): () => void {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style"],
  });
  if (document.body)
    obs.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-vscode-theme-kind"],
    });
  return () => obs.disconnect();
}
