import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  useLayoutEffect,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  createLayoutEngine,
  HYP_FONT_PX,
  HYP_LINE_H,
  hypGutterW,
  hypLineOffset,
  HYP_SEP_H,
  LINE_H,
  NODE_FONT_PX,
  NODE_PAD,
  NODE_PAD_Y,
  ARROW_GAP,
  LINK_MARK_OFF,
  TRUNK_INSET,
  CHIP_LANE_H,
  CHIP_TOP_GAP,
  COMMENT_FONT_PX,
  COMMENT_LINE_H,
  COMMENT_INDENT,
  COMMENT_MORE_PAD,
  COMMENT_RULE_INDENT,
  CASE_FONT_PX,
  CASE_LINE_H,
  bandTopH,
  inkExtent,
  getCodeFontFamily,
  refreshCodeFontFamily,
  measureText,
  REFLOW_CHARS,
  REFLOW_MIN_CHARS,
  REFLOW_MAX_CHARS,
  CHAR_W,
  TRUNK_GAP_BRANCH,
  isGhostNode,
  BADGE_FONT_PX,
  BADGE_H,
  badgeWidth,
  HOP_CAPTION_GAP,
  tourTabWidth,
} from "./layout";
import type { ReflowMode } from "./layout";
import {
  AbbrevSession,
  DEFAULT_ABBREV,
  underlineRuns,
  type AbbrevConfig,
  type AbbrevSpan,
} from "./abbreviation";
import type {
  AutomationTrace,
  CalcRelOption,
  Proof,
  ProofStepPosition,
  TacticSlot,
} from "./paperproof";
import {
  applyTraces,
  isAutomationNode,
  traceIndex,
  traceKey,
  traceTip,
} from "./trace";
import { stepGoalsAfter } from "./paperproof";
import {
  PLACEHOLDER,
  calcOpenSlots,
  calcOpenText,
  dedupLeadingBy,
} from "./calcEdit";
import {
  GLOBAL_MAX,
  MIN_GLOBAL_PREFIX,
  completionsAt,
  identPrefixAt,
  type CompletionItem,
  type CompletionPools,
} from "./completion";
import { layoutKeys, remapIds } from "./layoutKey";
import type {
  AddResult,
  AddSpec,
  CombinedPart,
  DeleteSpec,
  HypLine,
  LayoutNode,
  PlacedNode,
  TextSlot,
  TreeNode,
  WrappedLine,
} from "./types";
import { deleteExtent, type DeleteExtent } from "./deleteEdit";
import {
  inlineRewrite,
  extractRewrite,
  collapseRewrite,
  expandRewrite,
  linearRuns,
  runForFold,
  hasSlot,
  ctxNode,
  AUTOMATION_CANDIDATES,
  type LinearRun,
  type Rewrite,
  type RewriteCtx,
  type RewriteEdit,
  type Pos as RewritePos,
} from "./rewrite";
import { renamesFor, type NameRule } from "./rename";
import {
  attachDiagnostics,
  lintDiagnostics,
  type TreeDiagnostic,
} from "./diagnostics";
import {
  LINT_FIXES,
  firstLintFix,
  lintFixesFor,
  lintsByNode,
  type Lint,
} from "./lints";
import {
  positionContains,
  proofToTree,
  tacticId,
  rootIds,
  tacticNodeAt,
  tacticTargets,
  posLE,
  cmpPos,
} from "./proofToTree";
import { TURNSTILE, type HypMode } from "./proofToTree";
import type { HypMarkStyle } from "./theme";
import {
  type ElideCut,
  type SeedOrigin,
  applyElisions,
  combineMemberIds,
  combineRuns,
  cutId,
  foldSeedCuts,
  goalCut,
  pruneCuts,
  remapCut,
  resolveCut,
  selectionRun,
  sourceView,
  stepElidable,
  outlineCuts,
  noneSeedCut,
  seedCut,
  cutForBand,
  stepCut,
  hopCaption,
  seedTitle,
  isSeededCut,
  seedKindOf,
  coalesceCuts,
} from "./elide";
import {
  type DocPatch,
  flagLine,
  headTactics,
  removeCommentPatch,
  removeFlagPatches,
  usedHypNames,
} from "./flagEdit";
import {
  CMD,
  FLAG_GROUP,
  HYP_MARK,
  VERB_DOC,
  nodeHints,
  type Caps,
  type SelVerbDocKey,
} from "./gestures";
import { HelpPanel } from "./helpPanel";
import { TipLayer } from "./tip";
import { TipContext, TipController, useTip } from "./tipController";
import {
  tourList,
  authorStops,
  myStops,
  stoppable,
  type TourLists,
  type TourStop,
} from "./tour";
import {
  applyNarrationLines,
  narrationOf,
  polishCacheKey,
  polishKey,
  polishLinesOf,
  type PolishLine,
} from "./narrate";
import { collapseLabel, headerPrefix, type KeepSeg } from "./briefLabel";
import { lineOffsets } from "./taggedText";
import {
  ACCENT_TEXT,
  CASE_FILL,
  COMMENT_FILL,
  PROSE_FILL,
  EDIT_BG,
  EDIT_TEXT,
  HYP_LIT_FILL,
  HYP_MARK_FILL,
  HYP_UNUSED_FILL,
  HYP_USED_FILL,
  LINK_STROKE,
  LINK_STROKE_GOAL,
  LINK_STROKE_TACTIC,
  MUTED_FILL,
  NODE_STYLES,
  NODE_TEXT,
  RAIL_PRESSED,
  SEQ_STROKE,
  SORRY_FILL,
  DANGER_FILL,
  WARN_FILL,
  POPUP_CHROME,
  TOKEN_VARS,
  ensurePaletteStyle,
  observeThemeChange,
  resolveThemeKind,
} from "./theme";

interface Anchor {
  id: string;
  key: string;
  x: number;
  y: number;
}

const MARGIN = { top: 80, right: 90, bottom: 40, left: 90 };

const COMPACT_LEFT = 16;

const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

// The bar says every setting in WORDS: `Context: used ▾`, and `used ·
// intro · diff · all` in the popover. Words are the bar's own vocabulary: a
// reader who has to be told what Γ means is being charged for the abbreviation
// twice.
//
// `glyph` is the COMPACT fallback, and only that. The bar is ONE ROW, always,
// so at a frame too narrow for the words every menu drops to its glyph rather
// than wrapping or losing items off the end (see StatusBar's `fit`). It is
// drawn in the TREE's code font, never the bar's system UI font — measured on
// the raster, at 13px `▸` inks 5px tall against `λ`'s 10, `Δ`'s 9 and `∀`'s 9,
// and in the system font they are worse; the code font is where they were
// designed to sit. Compact is why that second font stack is affordable now:
// there are no words beside them to be out of key with.
//
// `glyphPx` is the rail's own rule — the target is equal INK HEIGHT, not equal
// font size — and these marks need it badly, because they are drawn from
// different corners of Unicode. Re-measured on the raster in the code font,
// `▸` is a small solid triangle inking 6×5 at 13 against `λ`'s 8×10, `Δ`'s
// 8×9 and `∀`'s 8×9, so it alone takes 19 (8×8) and the four then share a
// width of 8 as well as a height.
//
// The four LAYOUT marks were levelled the same way (`☰ ⊦ || ⑃` at 14/14/8/15)
// and have since left Unicode altogether: equal ink height did nothing about
// equal ink WEIGHT, and three of the four drew at half the stroke of every
// other mark in the row. They are drawn SVG now — see `LayoutGlyph`, which
// carries the measurements.
//
// `next` is the ⌥-CLICK cycle: plain click opens the list, ⌥-click advances to
// the next value through the same toasting wrapper. One coding, read by the
// label, the popover row and the toast alike.
const HYP_MODES: Record<
  HypMode,
  {
    name: string;
    glyph: string;
    glyphPx?: number;
    next: HypMode;
    title: string;
  }
> = {
  used: {
    name: "used",
    glyph: "▸",
    glyphPx: 19,
    next: "new",
    title: "Context: only hypotheses the rest of the proof below actually uses",
  },
  new: {
    // `intro`, not `binders`: the item RESERVES the width of its widest
    // value, so the longest word in this set is charged to the row at every
    // setting — and `binders` was the widest label in the whole bar. `intro`
    // is Lean's own word for the move that makes these hypotheses, and it is
    // one character off the other three.
    name: "intro",
    glyph: "λ",
    next: "delta",
    title:
      "Context: only hypotheses the preceding tactic introduced as a binding",
  },
  delta: {
    name: "diff",
    glyph: "Δ",
    next: "full",
    title: "Context: hypotheses this goal introduced, plus any its tactic uses",
  },
  full: {
    name: "all",
    glyph: "∀",
    next: "used",
    title: "Context: every hypothesis in scope",
  },
};

type LayoutMode = "stacked" | "spine" | "tracks" | "wide";

const LAYOUT_MODES: Record<
  LayoutMode,
  {
    name: string;
    next: LayoutMode;
    title: string;
  }
> = {
  stacked: {
    name: "outline",
    next: "spine",
    title:
      "Layout: compact outline — every node on its own line off a left trunk",
  },
  spine: {
    name: "spine",
    next: "tracks",
    title:
      "Layout: goal spine — two tracks, goals stacked tight on the left and each tactic beside its step in a right-hand track",
  },
  tracks: {
    name: "tracks",
    next: "wide",
    title:
      "Layout: aligned tracks — the spine with goals wrapped to a modest width, so every tactic starts at the SAME x and the two tracks read as columns",
  },
  wide: {
    name: "wide",
    next: "stacked",
    title:
      "Layout: wide layered tree — Sugiyama, same-depth nodes across one horizontal band",
  },
};

type CommentMode = "shown" | "hidden" | "instead" | "narrate";

// One coding of the comment switch's three stops: the word the bar prints and
// the ⌥-cycle's order. StatusBar's own row list keeps its per-row titles, but
// the NAME lives here so bar label and toast cannot drift.
const COMMENT_MODES: Record<CommentMode, { name: string; next: CommentMode }> =
  {
    shown: { name: "show", next: "hidden" },
    hidden: { name: "hide", next: "instead" },
    // `instead` used to print the word "narrate"; C2/C3 took that word for the
    // GENERATED prose, which is what a reader means by it, and gave this mode
    // back the name it has always had in the code — the author's comment
    // standing in INSTEAD of the tactic's own text.
    instead: { name: "instead", next: "narrate" },
    narrate: { name: "narrate", next: "shown" },
  };

// A mode change confirms itself top-centre for this long, then vanishes.
// `window.setTimeout`, never rAF: a hidden webview fires no animation frames.
const TOAST_MS = 1500;
/** Width of an ANCHORED toast (a mark jump's `n/N · caption`): fixed, so the
 counter keeps its x across a run of marks; capped by the column's 80%. */
const TOAST_ANCHORED_W = 420;

const REFLOW_OFF_STOP = REFLOW_MAX_CHARS + 1;
const reflowToStop = (m: ReflowMode) => (m === "off" ? REFLOW_OFF_STOP : m);
const stopToReflow = (v: number): ReflowMode =>
  v >= REFLOW_OFF_STOP ? "off" : v;

const CHIP_H = CHIP_LANE_H;
const CHIP_GAP = 6;

const CARD_PAD = 4;

const CHIP_W_ADD = 20;
const CHIP_W_SORRY = 36;

const HOLE_GLYPH = "?_";
const addChipGlyph = (spec: AddSpec | undefined) =>
  spec?.kind === "hole" ? HOLE_GLYPH : "+";
const addChipWidth = (spec: AddSpec | undefined) =>
  spec?.kind === "hole" ? chipWidth(HOLE_GLYPH, CHIP_FONT_PX) : CHIP_W_ADD;

const chipLaneXs = (spec: AddSpec | undefined): [number, number, number] => {
  const x0 = -CHIP_W_ADD / 2;
  const x1 = x0 + addChipWidth(spec) + CHIP_GAP;
  return [x0, x1, x1 + CHIP_W_SORRY + CHIP_GAP];
};
const CHIP_W_STEP = 30;

const CLOSE_RHS = "_";
const CHIP_FONT_PX = 10;

const PILL_FONT_PX = 11;

const PICK_FONT_PX = 12;
const CHIP_PAD_X = 6;

const chipWidth = (glyph: string, fontPx: number) =>
  Math.max(CHIP_W_ADD, measureText(glyph, fontPx) + 2 * CHIP_PAD_X);

const PAGER_H = 15;
const PAGER_ARROW_W = 15;
const PAGER_LABEL_W = 30;
const PAGER_W = 2 * PAGER_ARROW_W + PAGER_LABEL_W;

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 2;
const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

const clampScroll = (v: number, max: number) => Math.max(0, Math.min(max, v));

const FOLLOW_MS = 130;

const FOLLOW_TOP_FRAC = 1 / 3;

const GLOBAL_DEBOUNCE_MS = 160;

const globalNameCache = new Map<string, string[]>();

function cachedGlobals(ident: string): string[] | null {
  let best: { q: string; names: string[] } | null = null;
  for (const [q, names] of globalNameCache)
    if (
      ident.startsWith(q) &&
      (names.length < GLOBAL_MAX || q === ident) &&
      (best === null || q.length > best.q.length)
    )
      best = { q, names };
  return best?.names ?? null;
}

// The accented box's stroke width. An SVG stroke is CENTRED on the rect edge,
// and the node being edited IS accented (the first click of the double-click
// seeds clickAccent), so the drawn outline's outer edge sits at rect ±
// EDIT_STROKE/2. The overlay's 2px border COINCIDES with that outline, which
// is why the foreignObject is expanded by half a stroke on every side.
const EDIT_STROKE = 2;

// How far the tour nub's invisible hit region reaches beyond the tab's own
// rect, on every side. Wide enough that a pointer travelling towards the
// corner from OUTSIDE the box crosses it (the tab straddles the corner, so
// half the region already lies outside), and small enough that inside the box
// it stops at the tab's own height — the first hyp line's text is not covered.
const NUB_SLACK = 8;

// The node box's own fill, resolved from the very data the <rect> draws from —
// ONE coding, so an overlay standing in for a box cannot paint a different
// colour than the box it replaced.
function nodeBoxFill(d: LayoutNode): string {
  return isGhostNode(d) ||
    d.recovered === "failed" ||
    d.recovered === "skipped" ||
    d.traceLeaf
    ? "transparent"
    : (NODE_STYLES[d.type] ?? NODE_STYLES.default).fill;
}

const editOverlayLayer = (zIndex: number): CSSProperties => ({
  position: "absolute",
  inset: 0,
  zIndex,
  overflow: "hidden",
  pointerEvents: "none",
  boxSizing: "border-box",
  // PADDING ALONE carries the text inset, measured from the RECT edge: the
  // layer's own edge sits EDIT_STROKE/2 outside the rect, so the padding is
  // NODE_PAD + EDIT_STROKE/2 across and NODE_PAD_Y + EDIT_STROKE/2 down, and
  // the first glyph lands where the label's first glyph was. The outline is
  // NOT a CSS border: Chrome snaps border widths to whole DEVICE pixels, and
  // the infoview runs at fractional ratios (retina 2 × editor zoom 1.2 = 2.4,
  // measured: a 2px border computed to 1.667px), so a border-plus-padding
  // inset drifted the text a third of a pixel up and left on double-click.
  // The textarea paints its outline as an inset box-shadow, which is paint
  // only. Every layer here (mirror, abbreviation underline) and the textarea
  // itself must carry the SAME padding, or the caret drifts off the paint.
  padding: `${NODE_PAD_Y + EDIT_STROKE / 2}px ${NODE_PAD + EDIT_STROKE / 2}px`,
  border: 0,
  fontFamily: getCodeFontFamily(),
  fontSize: NODE_FONT_PX,
  lineHeight: `${LINE_H}px`,
  letterSpacing: 0,
  whiteSpace: "pre",
  textAlign: "left",
  textRendering: "auto",
  unicodeBidi: "normal",
});

function inViewScroll(
  el: HTMLElement,
  node: PlacedNode,
  zoom: number,
  padX: number,
  padY: number,
  compact: boolean,
  park?: number,
): { left: number; top: number } {
  const cx = (MARGIN.left + padX + node.x) * zoom;
  const cy = (MARGIN.top + padY + node.y) * zoom;
  const halfW = (node.data.w / 2) * zoom;

  const ink = inkExtent(node.data);
  const inkTop = cy - ink.up * zoom;
  const inkBot = cy + ink.down * zoom;
  const pad = 32;
  const maxX = el.scrollWidth - el.clientWidth;
  const maxY = el.scrollHeight - el.clientHeight;
  let left = el.scrollLeft;
  let top = el.scrollTop;
  const inkMid = (inkTop + inkBot) / 2;
  if (park !== undefined)
    top = clampScroll(inkMid - el.clientHeight * park, maxY);
  else if (
    inkTop < el.scrollTop + pad ||
    inkBot > el.scrollTop + el.clientHeight - pad
  )
    top = clampScroll(inkMid - el.clientHeight / 2, maxY);
  if (compact) {
    const leftEdge = cx - halfW;
    if (
      leftEdge < el.scrollLeft + pad ||
      leftEdge > el.scrollLeft + el.clientWidth - pad
    )
      left = clampScroll(leftEdge - COMPACT_LEFT * zoom, maxX);
  } else if (
    cx - halfW < el.scrollLeft + pad ||
    cx + halfW > el.scrollLeft + el.clientWidth - pad
  ) {
    left = clampScroll(cx - el.clientWidth / 2, maxX);
  }
  return { left, top };
}

type FollowAnim = {
  raf: number | null;
  timer: number | null;
  tgt: { left: number; top: number } | null;
};

/** Drop an in-flight `animateScroll` without landing it. */
function cancelFollow(anim: FollowAnim) {
  if (anim.raf !== null) cancelAnimationFrame(anim.raf);
  if (anim.timer !== null) window.clearTimeout(anim.timer);
  anim.raf = null;
  anim.timer = null;
  anim.tgt = null;
}

function animateScroll(
  anim: FollowAnim,
  el: HTMLElement,
  left: number,
  top: number,
) {
  if (
    (anim.raf !== null || anim.timer !== null) &&
    anim.tgt !== null &&
    anim.tgt.left === left &&
    anim.tgt.top === top
  )
    return;
  if (anim.raf !== null) cancelAnimationFrame(anim.raf);
  if (anim.timer !== null) window.clearTimeout(anim.timer);
  anim.tgt = { left, top };
  const x0 = el.scrollLeft;
  const y0 = el.scrollTop;
  const dx = left - x0;
  const dy = top - y0;
  const land = () => {
    anim.raf = null;
    anim.timer = null;
    anim.tgt = null;
    el.scrollLeft = left;
    el.scrollTop = top;
  };
  if (Math.abs(dy) > el.clientHeight || Math.abs(dx) > el.clientWidth) {
    land();
    return;
  }
  const t0 = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - t0) / FOLLOW_MS);

    const e = 1 - (1 - t) ** 3;
    el.scrollLeft = x0 + dx * e;
    el.scrollTop = y0 + dy * e;
    anim.raf = t < 1 ? requestAnimationFrame(step) : null;
  };
  anim.raf = requestAnimationFrame(step);
  anim.timer = window.setTimeout(() => {
    if (anim.raf !== null) cancelAnimationFrame(anim.raf);
    land();
  }, FOLLOW_MS + 60);
}

function cfStubNodeId(
  ns: readonly TreeNode[],
  stub: { line: number; pos?: { line: number; character: number } },
): string | null {
  const at = stub.pos;
  const exact =
    at &&
    ns.find(
      (n) =>
        n.type === "tactic" &&
        n.label === "sorry" &&
        n.position &&
        n.position.start.line === at.line &&
        n.position.start.character === at.character,
    );
  const pn =
    exact ??
    ns.find(
      (n) =>
        n.type === "tactic" &&
        n.position &&
        n.position.start.line === stub.line,
    );
  return pn?.id ?? null;
}

const FLOATER_H = 36;

// The signature header's height AT REST, as the header itself codes it: one
// `pre` line of `LINE_H`, 6px of padding above and below, and the 1px bottom
// border. Measured 29 in the harness, which is what this comes to. It is the
// floor under the measured `hdrH`, so nothing that reads the header's height —
// the rail's `floaterTop(0)` above all — can be told the header is 0 tall
// while one is drawn.
const HDR_REST_H = LINE_H + 13;

// The header's `▾` (open the full signature): a fixed box at the band's right
// edge, and the right padding both header states keep clear for it.
const HDR_BTN_W = 22;
const HDR_BTN_RIGHT = 6;
const HDR_BTN_LANE = HDR_BTN_W + HDR_BTN_RIGHT + 8;
// The resting text's right-edge fade where it is wider than the band.
const HDR_FADE = "linear-gradient(to right, #000 calc(100% - 24px), transparent)";

const RIBBON_W = 4;

const UNDERLINE_DROP = 2.5;

const HYP_LIT_PAD = 2;

const HYP_LIT_DWELL_MS = 350;

/** How far LEFT of both boxes the provenance connector's vertical run sits,
 so the elbow clears the node it leaves and the node it arrives at. */
const ORIGIN_CHANNEL = 12;

const RIBBON_W_SEL = 8;

function HypBlock({
  lines,
  x,
  y,
  width,
  taggedLines,
  lit,
  markStyle,
  onLine,
  lineTitle,
  onLineClick,
}: {
  lines: HypLine[];
  x: number;
  y: number;
  width: number;
  taggedLines?: (ReactNode | null)[] | null;
  lit?: boolean;

  markStyle?: HypMarkStyle;

  /** Pointer entered/left hyp line `j` (null on leave). Paint only — B2's
      provenance hover; nothing downstream of it relayouts. */
  onLine?: (j: number | null) => void;

  /** That line's `<title>` — where the hypothesis came from. */
  lineTitle?: (j: number) => string | undefined;

  /** D5 — a click on hyp line `j`, with whether ⌥ was held. The rename move
      is the ⌥-click; a plain click is left alone so a context line still
      behaves like part of the goal box it is drawn in. */
  onLineClick?: (j: number, alt: boolean) => void;
}) {
  const anyUsed = hypGutterW(lines) > 0;

  const textX = x + hypGutterW(lines);

  const sepIndex = lines.findIndex((l) => l.sep);
  const sepOff = (j: number) =>
    sepIndex >= 0 && j >= sepIndex ? HYP_SEP_H : 0;

  const hypLineMid = (j: number) => y + hypLineOffset(lines, j);
  const hypBaseline = (j: number) =>
    hypLineMid(j) + 0.32 * HYP_FONT_PX + UNDERLINE_DROP;

  const lineFill = (used: boolean) =>
    anyUsed && !used ? HYP_UNUSED_FILL : HYP_USED_FILL;

  return (
    <>
      {sepIndex >= 0 && (
        <line
          x1={x}
          x2={x + width}
          y1={y + sepIndex * HYP_LINE_H + HYP_SEP_H / 2}
          y2={y + sepIndex * HYP_LINE_H + HYP_SEP_H / 2}
          stroke={HYP_UNUSED_FILL}
          strokeWidth={1}
          opacity={0.45}
        />
      )}

      {lit && lines.some((l) => l.used) && (
        <g style={{ pointerEvents: "none" }}>
          {lines.map((line, j) => {
            if (!line.used) return null;
            const lx = textX + (line.indent ?? 0);
            const lw = measureText(line.text, HYP_FONT_PX);

            return markStyle === "underline" ? (
              <line
                key={j}
                x1={lx}
                x2={lx + lw}
                y1={hypBaseline(j)}
                y2={hypBaseline(j)}
                stroke={HYP_MARK_FILL}
                strokeWidth={1}
                strokeDasharray="2 2"
              />
            ) : (
              <rect
                key={j}
                x={lx - HYP_LIT_PAD}
                y={hypLineMid(j) - (HYP_LINE_H - 1) / 2}
                width={lw + 2 * HYP_LIT_PAD}
                height={HYP_LINE_H - 1}
                rx={3}
                fill={HYP_LIT_FILL}
              />
            );
          })}
        </g>
      )}

      {anyUsed && (
        <text
          textAnchor="start"
          fontSize={HYP_FONT_PX}
          fontFamily={getCodeFontFamily()}
          fill={HYP_MARK_FILL}
          style={{ letterSpacing: 0 }}
        >
          {lines.map((line, j) =>
            line.used && !line.cont ? (
              <tspan
                key={j}
                x={x}
                y={y + sepOff(j) + (j + 0.5) * HYP_LINE_H}
                dy="0.32em"
              >
                {HYP_MARK}
              </tspan>
            ) : null,
          )}
        </text>
      )}
      {taggedLines ? (
        <foreignObject
          x={textX}
          y={y}
          width={Math.max(0, x + width - textX)}
          height={lines.length * HYP_LINE_H + (sepIndex >= 0 ? HYP_SEP_H : 0)}
          style={{ overflow: "visible" }}
        >
          <div
            style={{
              fontFamily: getCodeFontFamily(),
              fontSize: HYP_FONT_PX,
              lineHeight: `${HYP_LINE_H}px`,
              letterSpacing: 0,
              whiteSpace: "pre",
            }}
          >
            {lines.map((line, j) => (
              // The provenance hover rides the LINE'S OWN `<div>` here rather
              // than an SVG rect over it: a rect on top would swallow the
              // `InteractiveCode` popups the tagged hyp types carry, and the
              // div's own enter/leave fire just the same when the pointer is
              // inside one of them.
              <div
                key={j}
                title={lineTitle?.(j)}
                onMouseEnter={onLine ? () => onLine(j) : undefined}
                onMouseLeave={onLine ? () => onLine(null) : undefined}
                onClick={
                  onLineClick
                    ? (e) => {
                        if (!e.altKey) return;
                        e.stopPropagation();
                        onLineClick(j, true);
                      }
                    : undefined
                }
                style={{
                  height: HYP_LINE_H,
                  color: lineFill(line.used),
                  paddingLeft: line.indent ?? 0,

                  marginTop: line.sep ? HYP_SEP_H : 0,
                }}
              >
                {taggedLines[j] ?? line.text}
              </div>
            ))}
          </div>
        </foreignObject>
      ) : (
        <text
          textAnchor="start"
          fontSize={HYP_FONT_PX}
          fontFamily={getCodeFontFamily()}

          style={{ letterSpacing: 0 }}
        >
          {lines.map((line, j) => (
            <tspan
              key={j}
              x={textX + (line.indent ?? 0)}
              y={y + sepOff(j) + (j + 0.5) * HYP_LINE_H}
              dy="0.32em"
              fill={lineFill(line.used)}
            >
              {line.text}
            </tspan>
          ))}
        </text>
      )}

      {/* PER-LINE HIT STRIPS — only on the plain `<text>` path, where the
          glyphs alone are hit-testable and the gaps between them are not (a
          rect BEHIND the text would flicker as the pointer crossed a letter).
          On the tagged path the line's own `<div>` carries the hover instead,
          so nothing is laid over `InteractiveCode`. Geometry is the block's
          own: `hypLineOffset` and `HYP_LINE_H`, the numbers the measurer
          sized the block with. */}
      {onLine && !taggedLines && (
        <g>
          {lines.map((_line, j) => (
            <rect
              key={j}
              x={x}
              y={hypLineMid(j) - HYP_LINE_H / 2}
              width={width}
              height={HYP_LINE_H}
              fill="transparent"
              data-ptw-hyp={j}
              style={{ pointerEvents: "all" }}
              onMouseEnter={() => onLine(j)}
              onMouseLeave={() => onLine(null)}
              onClick={
                onLineClick
                  ? (e) => {
                      if (!e.altKey) return;
                      e.stopPropagation();
                      onLineClick(j, true);
                    }
                  : undefined
              }
            >
              {lineTitle?.(j) ? <title>{lineTitle(j)}</title> : null}
            </rect>
          ))}
        </g>
      )}
    </>
  );
}

export interface ProofTreeViewProps {
  proof: Proof;

  onReveal?: (pos: ProofStepPosition) => void;

  getTacticEdit?: (
    pos: ProofStepPosition,
  ) => {
    pos: ProofStepPosition;
    text: string;
    /** D1 — the column the tactic's own line starts it at, which is where a
     hoisted `have` goes and what an inlined block is re-indented under. */
    indent?: number;
  } | null;

  onEditTactic?: (pos: ProofStepPosition, newText: string) => void;

  getGoalTerms?: (goalId: string) => string[];

  fetchGlobalNames?: (query: string) => Promise<string[]>;

  tokenColors?: Record<string, string>;

  outline?: boolean;

  hypMarkStyle?: HypMarkStyle;

  linkTint?: boolean;
  linkMarks?: boolean;

  onPopoutEdit?: (pos: ProofStepPosition) => void;

  highlightPos?: { line: number; character: number } | null;

  declHeader?: string;
  /** Where `declHeader` starts in the source, and the two positions the
   server found in it by syntax KIND (paperproof.ts): the signature's start
   (the name ends there) and the type spec's `:` (the resting header ends
   there). Absent → the header falls back to its first source line. */
  declHeaderStart?: { line: number; character: number };
  declHeaderNameStop?: { line: number; character: number };
  declHeaderSigStop?: { line: number; character: number };

  renderDeclHeader?: (
    lines: string[],

    label?: string,
    /** A label that is not the source verbatim (the collapsed one-line rest
     text) maps back to source offsets through this. */
    elision?: { original: string; keep: KeepSeg[]; marks: [] },
  ) => ReactNode[] | null;

  onRevealHeader?: () => void;
  cfStub?: {
    line: number;
    pos?: { line: number; character: number };
    draft: string;
    col?: number;

    render?: (draft: string, line: number, col: number) => ReactNode[] | null;
  } | null;

  headerExtra?: ReactNode;

  height?: string | number;

  renderTaggedGoal?: (
    goalId: string,
    lines: string[],
    hiddenLhs?: string,

    prefix?: string,
  ) => ReactNode[] | null;

  renderTaggedHyps?: (
    goalId: string,
    lines: string[],
  ) => (ReactNode | null)[] | null;

  renderTaggedTactic?: (
    pos: ProofStepPosition,
    label: string,
    lines: string[],
    elision?: TreeNode["elision"],
  ) => ReactNode[] | null;

  onAddTactic?: (
    spec: AddSpec,
    text: string,
    slots?: { lhs: TextSlot; rhs: TextSlot },
  ) => AddResult | null | void;

  deleteSlots?: TacticSlot[];

  /** B4 — the automation traces already in hand. In the WIDGET this is the
      RPC's answers, held by the caller and passed as a sibling (the payload
      does not carry them: a proof with ten `simp`s must not re-elaborate on
      every cursor move); offline it falls back to `proof.automationTraces`,
      which `ppharness --traces` puts on the wire. */
  automationTraces?: AutomationTrace[];

  /** Ask for one step's trace. Resolving with `false` means the server said
      nothing useful and the reader should be told; absent, the affordance is
      offered only where a trace is already in hand (the harness). */
  onTrace?: (pos: ProofStepPosition) => Promise<boolean>;

  ledger?: boolean;

  onDeleteTactic?: (spec: DeleteSpec) => void;

  /** D1 — ask the ELABORATOR whether a candidate rewrite still checks
      (`ProofTree.checkRewrite`). Nothing is written: the edits are applied to
      a copy of the file's text and the declaration re-elaborated through the
      cf seam. Absent (the harness) the proposal is shown with a stubbed ✓ so
      the gesture can still be seen. */
  onCheckRewrite?: (edits: RewriteEdit[]) => Promise<{
    verdict: string;
    ok: boolean;
    message?: string;
    steps: number;
    before: number;
  }>;

  /** D2a — ask the elaborator whether ONE automation tactic closes a linear
      run (`ProofTree.tryClose`). The run is named by its first and last
      step's start; the server splices the run's own extent and tries each
      candidate in order. Absent (the harness) the offer is stubbed with the
      first candidate so the gesture and the pill can still be seen. */
  onTryClose?: (
    from: { line: number; character: number },
    to: { line: number; character: number },
  ) => Promise<{
    tactic?: string;
    verdict: string;
    message?: string;
    tried?: string[];
    before?: number;
    steps?: number;
  }>;

  /** D1 — write an ACCEPTED rewrite, through the one `applyEdit` every other
      write goes through. Every intermediate state is a valid file and the
      editor's own undo takes it back. `renameAt` is an extract's `this`
      binder in the WRITTEN text: the widget follows the write with the
      companion's Rename Symbol there (best-effort — the write never waits on
      it, and without a companion nothing more happens). */
  onApplyRewrite?: (edits: RewriteEdit[], renameAt?: RewritePos) => void;

  /** C4 — LLM POLISH of the templated narration, through the companion. The
      widget cannot reach the network; the companion can, so the view hands it
      the templated lines and is handed sentences back. Absent, or with
      `polishReady` false, the `polish` row is drawn disabled with
      `polishWhy` as its title — a reader who has met the setting should find
      out where it went. */
  onPolish?: (lines: PolishLine[]) => Promise<{ nodeId: string; text: string }[]>;
  /** Is there a companion with an API key behind `onPolish`? */
  polishReady?: boolean;
  /** Why not, in the reader's words, when it is not. */
  polishWhy?: string;
  /** The `ramify.narration.polish` setting — the SESSION's default, which the
      row then overrides for this session alone. */
  polishDefault?: boolean;

  /** D6 — ASK AN AGENT to choose among the rewrites the primitives already
      offer. The view hands over the offered rewrites (never free text) and is
      handed back one node id, one kind and a one-line reason; the choice then
      goes through `onCheckRewrite` like every other proposal. */
  onPropose?: (req: {
    text: string;
    primitives: { nodeId: string; kind: Rewrite["kind"]; title: string }[];
  }) => Promise<{ nodeId?: string; kind?: string; reason?: string; note?: string }>;
  /** Is `ramify.restructure.propose` on, with a companion and a key behind it? */
  proposeReady?: boolean;
  proposeWhy?: string;

  onPreviewRange?: (range: ProofStepPosition | null) => void;

  onUndo?: (redo: boolean) => void;

  onHoverTactic?: (pos: ProofStepPosition | null) => void;

  abbrev?: AbbrevConfig;

  diagnostics?: TreeDiagnostic[];

  /** D4 — Mathlib's own style linters for THIS declaration. In the widget
      they arrive from `ProofTree.lintDecl` (a re-elaboration, so it is fired
      only when the reader asks) and are passed as a SIBLING; offline they fall
      back to `proof.lints`, which `ppharness --lint` puts on the wire. The
      `deleteSlots` rule, said again: read the argument, fall back to the
      field. */
  lints?: Lint[];

  /** Tell the caller the `lints` reading option went on or off. Turning it ON
      is what asks the server; nothing here fires it unasked. Absent (the
      harness) the option simply draws whatever `lints` already holds. */
  onLints?: (on: boolean) => void;
}

export default function ProofTreeView({
  proof,
  onReveal,
  getTacticEdit,
  onEditTactic,
  getGoalTerms,
  fetchGlobalNames,
  tokenColors,
  outline = false,
  hypMarkStyle = "highlight",
  linkMarks = false,
  linkTint = false,
  onPopoutEdit,
  highlightPos,
  declHeader,
  declHeaderStart,
  declHeaderNameStop,
  declHeaderSigStop,
  renderDeclHeader,
  onRevealHeader,
  cfStub,
  headerExtra,
  height = "100vh",
  renderTaggedGoal,
  renderTaggedHyps,
  renderTaggedTactic,
  onAddTactic,
  onHoverTactic,
  deleteSlots,
  automationTraces,
  onTrace,
  ledger = true,
  onDeleteTactic,
  onCheckRewrite,
  onTryClose,
  onApplyRewrite,
  onPolish,
  polishReady = false,
  polishWhy,
  polishDefault = false,
  onPropose,
  proposeReady = false,
  proposeWhy,
  onPreviewRange,
  onUndo,
  abbrev = DEFAULT_ABBREV,
  diagnostics,
  lints,
  onLints,
}: ProofTreeViewProps) {
  const [upToCursor, setUpToCursor] = useState(false);

  const [hypMode, setHypMode] = useState<HypMode>("used");

  // Lean's own binder order is the DEFAULT; `Split data & props` is the
  // opt-in extra (and `proofToTree`'s option default matches, so module and
  // bar cannot drift).
  const [hypGroup, setHypGroup] = useState(false);

  const [layout, setLayout] = useState<LayoutMode>("stacked");
  const compact = layout !== "wide";

  const aside = layout === "tracks" ? ("track" as const) : layout === "spine";

  const [reflow, setReflow] = useState<ReflowMode>("off");

  const [barOpen, setBarOpen] = useState<string | null>(null);

  const [helpOpen, setHelpOpen] = useState(false);

  // The in-page tooltip's controller (tipController.ts). Held OUTSIDE React
  // state on purpose: a tip showing re-renders `TipLayer` and nothing else.
  const [tipCtl] = useState(() => new TipController());

  const caps: Caps = {
    reveal: !!onReveal,
    edit: !!getTacticEdit && !!onEditTactic,
    add: !!onAddTactic,
    popout: !!onPopoutEdit,
    del: !!onDeleteTactic && !!deleteSlots,
    flags: !!onEditTactic && !!deleteSlots,
    restructure: !!onApplyRewrite && !!getTacticEdit && !!deleteSlots,
    undo: !!onUndo,
  };

  const forcedReflow =
    layout === "tracks" && reflow === "off" ? REFLOW_CHARS : undefined;

  const [brief, setBrief] = useState(false);

  const [briefHover, setBriefHover] = useState(false);
  const briefPreviewOn = briefHover && !brief;

  const [combine, setCombine] = useState(false);

  // D4 — the LINTS reading option. OFF by default and off until the reader
  // asks: the answer costs the server one re-elaboration of the declaration,
  // exactly as B4's traces do, so nothing fires it on arrival. The lints
  // themselves live with the caller (a sibling prop) and fall back to the
  // NDJSON's own field; this is only whether they are being read.
  const [lintsOn, setLintsOn] = useState(false);

  // C4 — the POLISH reading option. The setting (`ramify.narration.polish`,
  // off by default) is the DEFAULT and the row overrides it for this session,
  // so the state is an OVERRIDE and not a copy: a copy would have to be
  // synced from an effect when the companion's answer arrives late, and the
  // setting would then quietly lose to a value nobody chose.
  const [polishOverride, setPolishOverride] = useState<boolean | null>(null);
  const polishOn = (polishOverride ?? polishDefault) && polishReady;
  // The polished sentences, keyed by the SENTENCE they rewrote (node id plus
  // its templated text) and not by the tree: a cut changes which nodes are
  // drawn, and asking again for lines that were already answered would spend
  // a round trip on every fold. An answered line that came back empty is
  // stored as `""`, so it is not asked twice either.
  const [polished, setPolished] = useState<Map<string, string>>(new Map());
  // D6 — whether an agent proposal is in flight, so the row can say so and
  // two clicks cannot start two.
  const [proposeBusy, setProposeBusy] = useState(false);

  const [combineOff, setCombineOff] = useState<Set<string>>(new Set());

  const [commentMode, setCommentMode] = useState<CommentMode>("shown");

  // Paint-only confirmation of a mode change, so a keystroke says what it did.
  // Replaced (never queued) when a new message arrives: the timer is reset, so
  // holding `l` down reads as one message changing rather than a stack.
  const [toast, setToast] = useState<{
    text: string;
    key: number;
    anchored?: boolean;
  } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  // `anchored`: the toast is a FIXED-WIDTH, left-aligned box rather than a
  // centred one, so a leading counter (`2/5 · caption`) keeps ONE x across a
  // run of them and the eye, parked on the counter, reads what follows it.
  // Centred, the counter drifted with each caption's length (user report,
  // reading marks in sequence).
  const showToast = (text: string, anchored = false) => {
    setToast((t) => ({ text, key: (t?.key ?? 0) + 1, anchored }));
    if (toastTimer.current !== undefined)
      window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      toastTimer.current = undefined;
      setToast(null);
    }, TOAST_MS);
  };
  useEffect(
    () => () => {
      if (toastTimer.current !== undefined)
        window.clearTimeout(toastTimer.current);
    },
    [],
  );
  // Per-render-written ref (the `layersRef` pattern), so a listener that
  // registers ONCE can still reach the latest `showToast`.
  const toastRef = useRef(showToast);
  useEffect(() => {
    toastRef.current = showToast;
  });

  // global toggle flips, so turning comments back on doesn't silently undo

  const [commentsOff, setCommentsOff] = useState<Set<string>>(new Set());

  const [commentsExpanded, setCommentsExpanded] = useState<Set<string>>(
    new Set(),
  );

  const [chainOpen, setChainOpen] = useState<Set<string>>(new Set());

  const [sideBySide, setSideBySide] = useState(false);

  const [gallery, setGallery] = useState(false);
  const [pick, setPick] = useState<Record<string, number>>({});

  const [zoom, setZoom] = useState(1);

  const [elideCuts, setElideCuts] = useState<ElideCut[]>([]);

  // THE TOUR (tour.ts). `tourLists` says which of the two SETS are in the
  // reading — the author's `.mark` flags, the reader's own stops, or (the
  // default) both as one ordered list — `tourAt` the place in it, and
  // `myStopIds` the reader's set, keyed on node ids and so carried across a
  // re-parse by `remapIds` and stashed under the proof key like every other
  // id-holding view set. `tourPeek` is a set of CUT ids held open for the
  // stop being looked at: a tour is a reading, so it must not destroy the
  // reader's folds — the same non-destructive move the cursor makes over a
  // seeded cut (`peekKey`), asked of any cut instead of the seeded ones.
  const [myStopIds, setMyStopIds] = useState<Set<string>>(new Set());
  // WHICH SETS are in the reading: two independent toggles, both on by
  // default (user direction, 2026-09-08 — an explicit `all` was a third thing
  // to pick when the only question is which sets are in). The two SLOTS under
  // the bar item are these two booleans, read as the on/off switches they
  // look like.
  const [tourLists, setTourLists] = useState<TourLists>({
    source: true,
    temp: true,
  });
  // `tourAt` is the place in the list, or null for NOT STARTED — the reading
  // that replaced the old "off" mode (user direction: no off, just read the
  // marks that are there). Toggling a set restarts from that standing start.
  const [tourAt, setTourAt] = useState<number | null>(null);
  const [tourPeek, setTourPeek] = useState<Set<string>>(new Set());

  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);

  const [selection, setSelection] = useState<Set<string> | null>(null);

  const marqueeDidDrag = useRef(false);

  // The tracks layout's reflow seam: a drag in progress (the columns it is
  // reporting and the pointer's y, so the readout follows it). Paint plus a
  // second input to the existing `reflow` setting — no layout state of its own.
  const [seamDrag, setSeamDrag] = useState<{
    cols: number;
    y: number;
  } | null>(null);
  const seamStop = useRef<(() => void) | null>(null);
  useEffect(() => () => seamStop.current?.(), []);

  const [flagPrompt, setFlagPrompt] = useState<{
    headId: string;
    kind: "none" | "note";
  } | null>(null);

  const [focusId, setFocusId] = useState<string | null>(null);

  // The path scope: show only the root→node chain and what hangs under it.
  // A SCOPING mode exactly like focus — same lifecycle, same breadcrumb, same
  // Esc layer — and mutually exclusive with it, since two scopes at once say
  // nothing a reader can act on.
  const [pathId, setPathId] = useState<string | null>(null);

  const [hoverId, setHoverId] = useState<string | null>(null);

  // The quick-add NUB's own hover, kept apart from `hoverId`: the nub is drawn
  // only while the pointer is in the CORNER REGION below, not on every hover
  // of the node (user direction, 2026-09-08 — "if you're just hovering the
  // node you don't want to be distracted each time"). Paint only: nothing in
  // the layout reads it.
  const [nubHoverId, setNubHoverId] = useState<string | null>(null);

  const [hypLit, setHypLit] = useState<string | null>(null);

  // B2 — HYPOTHESIS PROVENANCE, paint only. `hoverHyp` is the line under the
  // pointer, `hypOrigin` the one that has been DWELT on long enough to draw
  // the wash and the connector (the same dwell the used-hyp wash uses, so the
  // two hovers feel like one gesture). Both are `nodeId\u0000lineIndex`
  // strings rather than objects, so the effect below can depend on a
  // primitive; neither reaches the engine, the cut list or any anchor.
  const [hoverHyp, setHoverHyp] = useState<string | null>(null);
  const [hypOrigin, setHypOrigin] = useState<string | null>(null);

  const [moreHover, setMoreHover] = useState<string | null>(null);

  const [elidePreview, setElidePreview] = useState<{
    anchor: string;
    ids: Set<string>;
    from: "alt" | "bar";
  } | null>(null);

  // The DELETE preview: hovering ⌦ fades exactly what the extent takes — the
  // set `arming` dims, computed by the one helper both read (`extentIds`), so
  // the preview and the armed dimming cannot disagree.
  const [deletePreview, setDeletePreview] = useState<{
    anchor: string;
    ids: Set<string>;
  } | null>(null);

  const [hlDismissed, setHlDismissed] = useState(false);

  const [editing, setEditing] = useState<{
    id: string;
    pos: ProofStepPosition;
    original: string;
    value: string;

    add?: AddSpec;

    calcStage?: {
      stage: "lhs" | "rhs";
      lhs: ProofStepPosition;
      rhs: ProofStepPosition;

      stub: ProofStepPosition | null;

      anchor: { line: number; character: number };

      closes: boolean;
    };

    fill?: boolean;

    tokPos?: ProofStepPosition;

    comment?: boolean;

    commentIndent?: number;

    cfIndent?: number;
  } | null>(null);

  const [pendingFill, setPendingFill] = useState<ProofStepPosition | null>(
    null,
  );

  const [picking, setPicking] = useState<{
    id: string;

    kind: "open" | "link" | "append" | "first";
    spec: AddSpec;
    options: CalcRelOption[];
  } | null>(null);

  const [arming, setArming] = useState<{
    id: string;
    spec: DeleteSpec;
  } | null>(null);

  // The PROPOSAL being shown. One at a time, on the node it was asked from:
  // `checking` while the elaborator is out, then `ok` (with how many steps the
  // proof loses) or `bad` (with the first error's first line). The pill is the
  // armed delete's pill — a rewrite is the same kind of promise, and it should
  // look like one.
  const [proposal, setProposal] = useState<{
    id: string;
    kind: Rewrite["kind"];
    rewrite: Rewrite;
    phase: "checking" | "ok" | "bad";
    message?: string;
    delta?: number;
    /** D2a — a collapse has no title until the server names the candidate
     that closed the run, so the pill's line is set when the answer lands. */
    title?: string;
    /** D6 — where an AGENT chose this move, the one line it gave for why.
     It rides the `<title>`, not the pill's own label: the label says what
     will be written and whether the elaborator agreed, which is the promise,
     and the reason is the thing you hover to read. */
    why?: string;
  } | null>(null);

  const [pendingVerb, setPendingVerb] = useState<SelVerb | null>(null);

  // The `flag ▾` chip's disclosure: whether the pill is also showing the row
  // of Alectryon writers. Reset with the selection it hangs off (a new sweep
  // starts shut), and its own Esc/background layer below.
  const [flagOpen, setFlagOpen] = useState(false);

  const [hoverDiag, setHoverDiag] = useState<string | null>(null);

  // The full signature, OPENED BY CLICK on the header's `▾` (never by hover):
  // closed by the same button, Esc, a pointerdown anywhere outside it, and a
  // proof change (the `proofKey` block below).
  const [hdrOpen, setHdrOpen] = useState(false);

  // `upNow`, where present, is read at Esc time instead of `up`: the TIP's
  // visibility lives outside the view's state (so showing one never renders
  // the tree), and a value captured at render would be stale.
  type Layer = {
    id: string;
    up: boolean;
    upNow?: () => boolean;
    off: () => void;
    bg: boolean;
  };
  const layers: Layer[] = [
    // FIRST: a standing tooltip is the topmost thing on screen, and Esc takes
    // it before the popover it may be describing.
    { id: "tip", up: false, upNow: tipCtl.shown, off: tipCtl.dismiss, bg: false },
    // The open signature overlays the tree from the top (z 11), above every
    // popover below it, so it goes next. Its outside-click close is its own
    // document listener, not `bg` — a click on a node is outside it too.
    {
      id: "signature",
      up: hdrOpen,
      off: () => setHdrOpen(false),
      bg: false,
    },
    {
      id: "barPopover",
      up: barOpen !== null,
      off: () => setBarOpen(null),
      bg: true,
    },
    { id: "help", up: helpOpen, off: () => setHelpOpen(false), bg: true },

    {
      id: "flagPrompt",
      up: !!flagPrompt,
      off: () => setFlagPrompt(null),
      bg: true,
    },
    { id: "arming", up: !!arming, off: () => setArming(null), bg: true },
    {
      id: "proposal",
      up: !!proposal,
      off: () => setProposal(null),
      bg: true,
    },
    {
      id: "pendingVerb",
      up: !!pendingVerb,
      off: () => setPendingVerb(null),
      bg: true,
    },
    { id: "picking", up: !!picking, off: () => setPicking(null), bg: true },

    {
      id: "calcStage",
      up: !!editing?.calcStage,
      off: () => setEditing((cur) => (cur?.calcStage ? null : cur)),
      bg: true,
    },
    {
      id: "flagOpen",
      up: flagOpen,
      off: () => setFlagOpen(false),
      bg: true,
    },

    {
      id: "selection",
      up: !!selection,
      off: () => setSelection(null),
      bg: true,
    },

    // The TOUR is a reading, not a scope: it hides nothing, so it backs out
    // ahead of focus and path (whose scopes are the bigger state to lose) and
    // behind every prompt. Plain setters, like every row here — `layerOff` is
    // called during RENDER, so nothing in this table may toast.
    {
      id: "tour",
      up: tourAt !== null,
      off: () => {
        setTourAt(null);
        setTourPeek(new Set());
      },
      bg: false,
    },

    {
      id: "focus",
      up: focusId !== null,
      off: () => setFocusId(null),
      bg: false,
    },

    {
      id: "path",
      up: pathId !== null,
      off: () => setPathId(null),
      bg: false,
    },

    // LAST: to-cursor hides nodes with no gesture of its own to back out of,
    // so Esc reaches it only once nothing else is up. Two deliberate details.
    // `up` is the MODE, not `upToHide.size > 0` (the breadcrumb's test) — that
    // memo is declared far below this table — so Esc also leaves a mode that
    // happens to hide nothing. And `off` is the BARE setter, not the toasting
    // `applyUpToCursor`: every entry here is a plain setter because `layerOff`
    // is called during RENDER, and `showToast` reads a ref (the react-hooks/refs
    // taint). The bar's `✕` toasts; Esc just leaves.
    {
      id: "upTo",
      up: upToCursor,
      off: () => setUpToCursor(false),
      bg: false,
    },
  ];

  const layerOff = (id: string) => {
    const l = layers.find((x) => x.id === id);
    return l ? l.off : () => {};
  };

  const layersRef = useRef(layers);
  useEffect(() => {
    layersRef.current = layers;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      layersRef.current.find((l) => (l.upNow ? l.upNow() : l.up))?.off();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" && e.key !== "F1") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      e.preventDefault();
      setHelpOpen((v) => !v);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!onUndo) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      e.preventDefault();
      onUndo(e.shiftKey);
      // Undo/redo left the bar (they are keys, not settings), so the KEY is
      // what says it happened — the same confirmation every other gesture
      // gets, read through a ref so this listener still registers once.
      toastRef.current(e.shiftKey ? "Redo" : "Undo");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onUndo]);

  const armExtent = useMemo(
    () =>
      arming && deleteSlots ? deleteExtent(arming.spec, deleteSlots) : null,
    [arming, deleteSlots],
  );
  useEffect(() => {
    if (!onPreviewRange) return;
    onPreviewRange(
      armExtent ? { start: armExtent.start, stop: armExtent.stop } : null,
    );
    return () => onPreviewRange(null);
  }, [armExtent, onPreviewRange]);

  const [completion, setCompletion] = useState<{
    items: CompletionItem[];
    index: number;
  } | null>(null);

  const [abbrevSess, setAbbrevSess] = useState<{
    id: string;
    session: AbbrevSession;
  } | null>(null);

  const [abbrevSpans, setAbbrevSpans] = useState<AbbrevSpan[]>([]);
  const putSpans = (next: AbbrevSpan[]) =>
    setAbbrevSpans((prev) =>
      prev.length === next.length &&
      prev.every(
        (p, i) => p.offset === next[i].offset && p.length === next[i].length,
      )
        ? prev
        : next,
    );
  const newAbbrevSession = (initial: string) => {
    const self: AbbrevSession = new AbbrevSession(abbrev, initial, (v, c) => {
      setEditing((e) => e && { ...e, value: v });
      putSpans(self.pending());

      window.setTimeout(() => {
        const ta = document.querySelector("[data-ptw-edit] textarea");
        if (ta instanceof HTMLTextAreaElement) ta.setSelectionRange(c, c);
      }, 0);
    });
    return self;
  };
  const syncAbbrev = (id: string, value: string, caret: number) => {
    if (!abbrevSess || abbrevSess.id !== id) return;
    abbrevSess.session.sync(value, caret);
    putSpans(abbrevSess.session.pending());
  };

  const editKey = (e: typeof editing) =>
    e === null ? null : `${e.id}#${e.calcStage?.stage ?? ""}`;
  const editingId = editKey(editing);
  const [prevEditingId, setPrevEditingId] = useState(editingId);
  if (editingId !== prevEditingId) {
    setPrevEditingId(editingId);
    setCompletion(null);

    setAbbrevSpans([]);

    setAbbrevSess(
      editing && abbrev.enabled && !editing.comment
        ? { id: editingId!, session: newAbbrevSession(editing.value) }
        : null,
    );
  }

  const editingRef = useRef(editing);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const commitDelete = (id: string, spec: DeleteSpec) => {
    anchorOn(id);
    onDeleteTactic!(spec);
    setArming(null);
  };
  const commitEdit = () => {
    const cur0 = editingRef.current;
    editingRef.current = null;
    if (!cur0) return;

    const flushed =
      !cur0.comment && abbrevSess?.id === editKey(cur0)
        ? abbrevSess.session.flush()
        : undefined;
    const cur =
      flushed !== undefined && flushed !== cur0.value
        ? { ...cur0, value: flushed }
        : cur0;

    anchorOn(cur.id);
    if (cur.calcStage) {
      commitStage(cur.id, cur.calcStage, cur.value);
      return;
    }
    if (cur.comment) {
      if (cur.value.trim() === "") {
        const p = removeCommentPatch(
          cur.pos,
          deleteSlots ?? proof.deleteSlots ?? [],
        );
        onEditTactic?.({ start: p.start, stop: p.stop }, p.text);
      } else if (cur.value !== cur.original) {
        const ind = " ".repeat(cur.commentIndent ?? 0);
        const text = cur.value
          .split("\n")
          .map((l, i) => (i === 0 || l === "" ? l : ind + l))
          .join("\n");
        onEditTactic?.(cur.pos, text);
      }
      setEditing(null);
      return;
    }
    if (cur.cfIndent !== undefined) {
      if (cur.value.trim() !== "" && cur.value !== cur.original) {
        const ind = " ".repeat(cur.cfIndent);
        onEditTactic?.(
          cur.pos,
          cur.value
            .split("\n")
            .map((l, i) => (i === 0 || l === "" ? l : ind + l))
            .join("\n"),
        );
      }
      setEditing(null);
      return;
    }
    if (cur.add) {
      if (cur.value.trim() !== "") {
        const at = onAddTactic?.(cur.add, cur.value);

        if (at?.fill) setPendingFill(at.fill);
      }
    } else if (
      cur.value.trim() !== "" &&
      (cur.fill || cur.value !== cur.original)
    ) {
      onEditTactic?.(cur.pos, cur.fill ? dedupLeadingBy(cur.value) : cur.value);
    }
    setEditing(null);
  };

  const selectPlaceholder = () => {
    window.setTimeout(() => {
      const ta = document.querySelector("[data-ptw-edit] textarea");
      if (ta instanceof HTMLTextAreaElement && ta.value === PLACEHOLDER)
        ta.select();
    }, 0);
  };
  const startChain = (
    id: string,
    spec: AddSpec,
    rel: string,
    closes: boolean,
  ) => {
    anchorOn(id);
    const repair = spec.kind === "calc-first";
    const at = onAddTactic?.(
      { ...spec, rel },

      repair ? "" : calcOpenText(rel),
      repair ? undefined : calcOpenSlots(rel),
    );
    if (!at?.stages) {
      if (at?.fill) setPendingFill(at.fill);
      return;
    }
    setEditing({
      id,
      pos: at.stages.lhs,
      original: PLACEHOLDER,
      value: PLACEHOLDER,
      calcStage: {
        stage: "lhs",
        lhs: at.stages.lhs,
        rhs: at.stages.rhs,
        stub: at.fill,
        anchor: at.stages.lhs.start,
        closes,
      },
    });
    selectPlaceholder();
  };

  const commitStage = (
    id: string,
    st: NonNullable<typeof editing>["calcStage"] & object,
    raw: string,
  ) => {
    const text = raw.replace(/\n+/g, " ").trim();
    const value = text === "" ? PLACEHOLDER : text;
    const here = st.stage === "lhs" ? st.lhs : st.rhs;
    const grew = value.length - (here.stop.character - here.start.character);
    const shift = (p: ProofStepPosition): ProofStepPosition =>
      p.start.line === here.start.line &&
      p.start.character >= here.stop.character
        ? {
            start: { ...p.start, character: p.start.character + grew },
            stop: { ...p.stop, character: p.stop.character + grew },
          }
        : p;

    if (value !== PLACEHOLDER) onEditTactic?.(here, value);
    const next = { ...st, rhs: shift(st.rhs), stub: st.stub && shift(st.stub) };
    if (st.stage === "lhs") {
      setEditing({
        id,
        pos: next.rhs,
        original: PLACEHOLDER,
        value: PLACEHOLDER,
        calcStage: { ...next, stage: "rhs" },
      });
      selectPlaceholder();
      return;
    }

    if (next.stub) setPendingFill(next.stub);
    setEditing(null);
  };

  const nativeClip = useRef(false);
  const clipboardFallback = async (
    key: "c" | "x" | "v",
    ta: HTMLTextAreaElement,

    cur: NonNullable<typeof editing>,
  ) => {
    const from = ta.selectionStart;
    const to = ta.selectionEnd;
    const v = ta.value;

    const put = (value: string, caret: number) => {
      setEditing((cur) => cur && { ...cur, value });

      syncAbbrev(editKey(cur)!, value, caret);
      window.setTimeout(() => ta.setSelectionRange(caret, caret), 0);
    };
    try {
      if (key === "v") {
        const text = await navigator.clipboard.readText();
        if (!text) return;
        put(v.slice(0, from) + text + v.slice(to), from + text.length);
        return;
      }
      if (from === to) return;
      await navigator.clipboard.writeText(v.slice(from, to));
      if (key === "x") put(v.slice(0, from) + v.slice(to), from);
    } catch (e) {
      console.warn("[proof-tree] clipboard fallback failed:", e);
    }
  };

  const revealTimer = useRef<number | null>(null);
  const cancelPendingReveal = () => {
    if (revealTimer.current !== null) {
      window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
  };

  const [clickAccent, setClickAccent] = useState<string | null>(null);

  const accentNow = (id?: string) => {
    setHlDismissed(false);
    if (id) setClickAccent(id);
  };
  const revealAt = (pos: ProofStepPosition, id?: string) => {
    accentNow(id);
    onReveal?.(pos);
  };

  const deferReveal = (pos: ProofStepPosition, id?: string) => {
    accentNow(id);
    cancelPendingReveal();
    revealTimer.current = window.setTimeout(() => {
      revealTimer.current = null;
      onReveal?.(pos);
    }, 300);
  };
  useEffect(() => cancelPendingReveal, []);

  const padRef = useRef<{ w: number; h: number } | null>(null);
  const centeredOn = useRef<{ proofKey: string; viewKey: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<Anchor | null>(null);

  const lastScrollRef = useRef({ x: 0, y: 0 });

  const lastLayoutRef = useRef<Map<string, { x: number; y: number }> | null>(
    null,
  );

  const cursorChainRef = useRef<string[]>([]);

  const zoomAnchorRef = useRef<{
    X: number;
    Y: number;
    px: number;
    py: number;
  } | null>(null);

  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);

  const zoomRef = useRef(zoom);

  const [codeFont, setCodeFont] = useState(getCodeFontFamily);
  const [themeKind, setThemeKind] = useState(resolveThemeKind);
  ensurePaletteStyle();

  const tokenColorVars = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [type, color] of Object.entries(tokenColors ?? {}))
      if (TOKEN_VARS.has(type)) out[`--ptw-tok-${type}`] = color;
    return out;
  }, [tokenColors]);
  useEffect(() => {
    const sync = () => {
      setCodeFont(refreshCodeFontFamily());
      setThemeKind(resolveThemeKind());
    };
    return observeThemeChange(sync);
  }, []);

  const baseNodes = useMemo(
    () =>
      proofToTree(proof, {
        hypMode,
        hypGroup,
        brief,
        ledger,
        openLinks: chainOpen,
        slots: deleteSlots,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proof, hypMode, hypGroup, brief, ledger, chainOpen, codeFont, deleteSlots],
  );

  const elidableIds = useMemo(() => stepElidable(baseNodes), [baseNodes]);
  // Where a BARE `.none` (no sentence) is worth writing: anywhere ◌ is
  // offered, and on a SPLIT too — its `.none` is the ghost of the whole split,
  // which hides something. Refused where the ghost would only restate one box.
  const noneBareIds = useMemo(() => {
    const out = new Set(elidableIds);
    const parents = new Set(baseNodes.flatMap((n) => n.parents.map((p) => p.id)));
    for (const n of baseNodes)
      if (n.type === "tactic" && parents.has(n.id)) out.add(n.id);
    return out;
  }, [baseNodes, elidableIds]);
  const noneBareOk = (id: string) => noneBareIds.has(id);

  // Both tours, off the BASE tree: a stop must exist even while a cut hides
  // it, since reaching a hidden stop is exactly what the jump is for.
  const authorTour = useMemo(() => authorStops(baseNodes), [baseNodes]);
  const myTour = useMemo(
    () => myStops(baseNodes, myStopIds),
    [baseNodes, myStopIds],
  );
  // …and THE READING: the union of whichever sets are on, in the one order.
  const tourStops = useMemo(
    () => tourList(baseNodes, myStopIds, tourLists),
    [baseNodes, myStopIds, tourLists],
  );
  // WHAT WEARS A TAB: the list being read, ALWAYS — so turning a set off
  // takes its tabs with it, and a marked proof (arriving with both sets on)
  // shows every tab the moment it is opened, which is the whole point of
  // marking it. Each tab keeps its own ink (`tab.who`), so a mixed list
  // still says whose each stop is.
  const tabStops = tourStops;
  const tourTabs = new Map<string, { n: number; who: "author" | "mine" }>(
    tabStops.map((st, i) => [st.id, { n: i + 1, who: st.who }]),
  );
  const currentStopId =
    tourAt === null ? null : (tourStops[tourAt]?.id ?? null);

  const peekable = useMemo(() => {
    const byId = new Map(baseNodes.map((n) => [n.id, n]));
    const seeded = new Set(sourceView(baseNodes).map(cutId));
    const out: { id: string; ranges: ProofStepPosition[] }[] = [];
    for (const cut of elideCuts) {
      const id = cutId(cut);
      if (!seeded.has(id)) continue;
      // TACTIC members only. A `fold` takes a whole subtree, and a spawned
      // root in it carries its PRODUCER's position — a range outside the cut
      // entirely, which would peek the branch open from a line it does not
      // stand for.
      const ranges = resolveCut(cut, byId)
        .map((m) => byId.get(m))
        .filter((n) => n?.type === "tactic")
        .map((n) => n?.position)
        .filter((p): p is ProofStepPosition => !!p);
      if (ranges.length > 0) out.push({ id, ranges });
    }
    return out;
  }, [baseNodes, elideCuts]);

  const peekKey = useMemo(
    () =>
      highlightPos
        ? peekable
            .filter((c) =>
              c.ranges.some(
                (r) =>
                  positionContains(r, highlightPos) ||
                  r.start.line === highlightPos.line,
              ),
            )
            .map((c) => c.id)
            .join("|")
        : "",
    [peekable, highlightPos],
  );

  // B4 — the traces in hand (the RPC's, or the corpus's), and which steps have
  // their subtree open. `traceBusy` is the pending state the affordance shows
  // while the server re-elaborates.
  const traces = useMemo(
    () => traceIndex(automationTraces ?? proof.automationTraces),
    [automationTraces, proof.automationTraces],
  );
  // D2b asks for a trace and then reads it back in the SAME gesture, so the
  // freshly-arrived index has to be reachable from a click's closure. The
  // `toastRef` pattern: written in an effect, read only from handlers.
  const traceRef = useRef(traces);
  useEffect(() => {
    traceRef.current = traces;
  }, [traces]);
  const [traceOpen, setTraceOpen] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [traceBusy, setTraceBusy] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const treeNodes = useMemo(() => {
    let cuts = elideCuts;
    if (combine) {
      const byId = new Map(baseNodes.map((n) => [n.id, n]));
      const manual = new Set<string>(combineOff);
      for (const c of elideCuts)
        for (const id of resolveCut(c, byId)) manual.add(id);
      cuts = [...elideCuts, ...combineRuns(baseNodes, manual)];
    }

    if (peekKey !== "") {
      const open = new Set(peekKey.split("|"));
      cuts = cuts.filter((c) => !open.has(cutId(c)));
    }
    // …and the tour's own peek, on exactly the same terms: the cuts hiding
    // the stop being read are held open while it is the stop, and come back
    // by themselves when the reading moves on or leaves.
    if (tourPeek.size > 0) cuts = cuts.filter((c) => !tourPeek.has(cutId(c)));
    // …and B4's trace leaves LAST, onto the drawn tree: elide.ts must not see
    // them (a closing `simp` with its trace open would stop being a leaf and
    // the goal above would hop where it used to fold), and a step a cut has
    // hidden takes its trace with it for nothing.
    return applyTraces(applyElisions(baseNodes, cuts), traceOpen, traces);
  }, [
    baseNodes,
    elideCuts,
    combine,
    combineOff,
    peekKey,
    tourPeek,
    traceOpen,
    traces,
  ]);

  // C2/C3 — the DRAWN tree with generated strips, and ONLY for the engine:
  // every other reader (the cut rules, the selection verbs, comment editing)
  // must keep seeing the real tree, so a generated line is never something a
  // gesture offers to edit, hide or delete. Narration is text like any other
  // comment, so it goes through `commentSize` and the 2-line clamp unchanged.
  //
  // C4 — and where POLISH is on and an answer has come back, the polished
  // sentence stands in its place, wearing `≈` instead of `∴`. The map is
  // keyed by the templated text itself (`polishKey`), so a re-parse that
  // changed nothing about the sentences keeps the answer and one that did
  // asks again; a stale key simply draws the template, which is always right.
  const narration = useMemo(
    () =>
      commentMode === "narrate" ? narrationOf(baseNodes, treeNodes) : null,
    [commentMode, baseNodes, treeNodes],
  );
  const polishReq = useMemo(
    () =>
      narration && polishOn && onPolish
        ? polishLinesOf(treeNodes, narration)
        : null,
    [narration, polishOn, onPolish, treeNodes],
  );
  const polishNow = polishReq === null ? "" : polishKey(polishReq);
  const polishedMap = useMemo(() => {
    if (!polishReq) return undefined;
    const out = new Map<string, string>();
    for (const l of polishReq) {
      const t = polished.get(polishCacheKey(l));
      if (t) out.set(l.nodeId, t);
    }
    return out;
  }, [polishReq, polished]);
  // The ASK. `onPolish` is the companion round trip (RPC out, a poll on a
  // `setTimeout` ladder, 20s and then give up), so nothing here knows about
  // timers: the promise either lands or it does not.
  //
  // Only the lines NOBODY HAS ASKED FOR go out. `askedRef` is what makes that
  // true across a cut — folding a goal changes which nodes are drawn, and
  // without it every fold would spend a round trip re-asking for sentences
  // already in hand. A line that failed or came back empty stays marked, so
  // nothing retries on its own; the strip draws the template, which was never
  // wrong. The requester is a fresh closure on every render, so the effect
  // reads it through a ref rather than listing it as a dependency — the ask
  // fires on the lines changing, never on the identity of the asker.
  const askedRef = useRef<Set<string>>(new Set());
  const polishReqRef = useRef<{
    ask: typeof onPolish;
    lines: PolishLine[] | null;
  }>({ ask: onPolish, lines: polishReq });
  useEffect(() => {
    polishReqRef.current = { ask: onPolish, lines: polishReq };
  });
  useEffect(() => {
    if (!polishNow) return;
    const { ask, lines } = polishReqRef.current;
    if (!ask || !lines) return;
    const asked = askedRef.current;
    const want = lines.filter((l) => !asked.has(polishCacheKey(l)));
    if (want.length === 0) return;
    for (const l of want) asked.add(polishCacheKey(l));
    let live = true;
    void ask(want).then(
      (out) => {
        if (!live) return;
        const got = new Map(out.map((o) => [o.nodeId, o.text]));
        setPolished((prev) => {
          const next = new Map(prev);
          for (const l of want) next.set(polishCacheKey(l), got.get(l.nodeId) ?? "");
          return next;
        });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [polishNow]);
  // A polish answer landing changes the WORDS and nothing about the tree, so
  // it re-runs this `.map` alone — the narration walk above it is memoised on
  // the drawn tree and is not paid again.
  const narratedNodes = useMemo(
    () =>
      narration
        ? applyNarrationLines(treeNodes, narration.text, polishedMap)
        : treeNodes,
    [narration, treeNodes, polishedMap],
  );

  // The DRAWN tree indexed for elide.ts's cut rules — by id, and by parent.
  // Drawn, not base: `stepCut` has to see what a standing cut left below a
  // goal (a hop's kept goal, a ghost), and `cutExtentIds` fades what is on
  // screen.
  const treeIdx = useMemo(() => {
    // B4's trace leaves are deliberately ABSENT from this index: it is what
    // elide.ts's cut rules read, and an open trace must not change what a `−`
    // or a `◌` does.
    const drawn = treeNodes.filter((n) => !n.traceLeaf);
    const byId = new Map(drawn.map((n) => [n.id, n]));
    const kids = new Map<string, TreeNode[]>();
    for (const n of drawn)
      for (const p of n.parents)
        (kids.get(p.id) ?? kids.set(p.id, []).get(p.id)!).push(n);
    return { byId, kids };
  }, [treeNodes]);

  // What a goal's `−` does, per goal — the ONE gate the glyph, the click, the
  // hint row and the hover fade all read (see elide.ts's `goalCut`). `−`
  // hides, so it is a fold in every layout; the layout no longer enters.
  const goalCuts = useMemo(() => {
    const out = new Map<string, ElideCut>();
    for (const n of treeNodes) {
      if (n.type !== "goal") continue;
      const c = goalCut(treeIdx.byId, n.id, treeIdx.kids);
      if (c) out.set(n.id, c);
    }
    return out;
  }, [treeNodes, treeIdx]);

  const linkPlus = useMemo(() => {
    const out = new Map<string, { key: string; ledgerId: string }>();
    for (const n of treeNodes) {
      if (!n.ledger) continue;
      let k = 0;
      for (const r of n.ledger) {
        if (r.goalId === undefined) continue;
        const key = `${n.id}#${k++}`;
        if (!chainOpen.has(key))
          out.set(tacticId(r.goalId), { key, ledgerId: n.id });
      }
    }
    return out;
  }, [treeNodes, chainOpen]);

  const engine = useMemo(
    () =>
      createLayoutEngine(narratedNodes, {
        reflow: forcedReflow ?? reflow,

        chips: !!onAddTactic,
        comments:
          commentMode === "hidden"
            ? false
            : commentMode === "instead"
              ? "instead"
              : true,
        commentsHidden: commentsOff,
        commentsExpanded,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      narratedNodes,
      codeFont,
      reflow,
      forcedReflow,
      commentMode,
      commentsOff,
      commentsExpanded,
    ],
  );

  const proofKey = useMemo(
    () => proof.proofId ?? rootIds(proof).join("\n"),
    [proof],
  );
  const shapeKey = useMemo(
    () => proof.steps.map((s) => s.goalBefore.id).join("\n"),
    [proof],
  );
  const [prevProof, setPrevProof] = useState(proofKey);
  const [prevShape, setPrevShape] = useState(shapeKey);

  const [prevBase, setPrevBase] = useState(baseNodes);

  const [viewStash, setViewStash] = useState<
    Map<
      string,
      {
        base: TreeNode[];
        focusId: string | null;
        pathId: string | null;
        elideCuts: ElideCut[];
        pick: Record<string, number>;
        combineOff: Set<string>;
        commentsOff: Set<string>;
        commentsExpanded: Set<string>;
        chainOpen: Set<string>;
        myStopIds: Set<string>;
        zoom: number;
      }
    >
  >(new Map());
  if (proofKey !== prevProof) {
    setPrevProof(proofKey);
    setHdrOpen(false);
    setPrevShape(shapeKey);
    setPrevBase(baseNodes);

    setViewStash((m) => {
      const next = new Map(m);
      next.set(prevProof, {
        base: prevBase,
        focusId,
        pathId,
        elideCuts,
        pick,
        combineOff,
        commentsOff,
        commentsExpanded,
        chainOpen,
        myStopIds,
        zoom,
      });
      return next;
    });
    const stash = viewStash.get(proofKey);
    if (stash) {
      const remap = remapIds(stash.base, baseNodes);
      const to = (id: string) => remap.get(id) ?? id;
      const live = new Set<string>();
      for (const st of proof.steps) {
        live.add(st.goalBefore.id);
        live.add(tacticId(st.goalBefore.id));
        for (const g of stepGoalsAfter(st)) live.add(g.id);
      }
      const restoreSet = (s: Set<string>) =>
        new Set([...s].map(to).filter((id) => live.has(id)));
      setZoom(stash.zoom);
      const movedFocus = stash.focusId ? to(stash.focusId) : null;
      setFocusId(movedFocus && live.has(movedFocus) ? movedFocus : null);
      const movedPath = stash.pathId ? to(stash.pathId) : null;
      setPathId(movedPath && live.has(movedPath) ? movedPath : null);
      setElideCuts(
        pruneCuts(
          baseNodes,
          stash.elideCuts.map((c) => remapCut(c, to)),
        ),
      );

      const nextPick: Record<string, number> = {};
      for (const [id, v] of Object.entries(stash.pick)) nextPick[to(id)] = v;
      setPick(nextPick);
      setCombineOff(restoreSet(stash.combineOff));
      setCommentsOff(restoreSet(stash.commentsOff));
      setCommentsExpanded(restoreSet(stash.commentsExpanded));
      // The reader's tour stops come back with the rest of the reading state
      // — a proof left and returned to keeps where its reader had been.
      setMyStopIds(restoreSet(stash.myStopIds ?? new Set()));

      const ledgers = new Set(
        baseNodes.filter((n) => n.ledger).map((n) => n.id),
      );
      const nextChain = new Set<string>();
      for (const key of stash.chainOpen) {
        const at = key.lastIndexOf("#");
        const moved = to(key.slice(0, at));
        if (ledgers.has(moved)) nextChain.add(moved + key.slice(at));
      }
      setChainOpen(nextChain);
    } else {
      setZoom(1);
      setFocusId(null);
      setPathId(null);
      setElideCuts([]);
      setCombineOff(new Set());
      setCommentsOff(new Set());
      setCommentsExpanded(new Set());
      setChainOpen(new Set());
      setMyStopIds(new Set());

      setPick({});
    }

    setEditing(null);
    setPicking(null);
    setArming(null);

    setPendingFill(null);
    setMarquee(null);
    setSelection(null);
    setFlagOpen(false);
    setFlagPrompt(null);
    setClickAccent(null);
  } else if (shapeKey !== prevShape) {
    setPrevShape(shapeKey);
    setPrevBase(baseNodes);

    const remap = remapIds(prevBase, baseNodes);
    const to = (id: string) => remap.get(id) ?? id;

    const live = new Set<string>();
    for (const st of proof.steps) {
      live.add(st.goalBefore.id);
      live.add(tacticId(st.goalBefore.id));
      for (const g of stepGoalsAfter(st)) live.add(g.id);
    }

    const remapSet = (prev: Set<string>): Set<string> => {
      const next = new Set([...prev].map(to).filter((id) => live.has(id)));
      return next.size === prev.size && [...prev].every((id) => next.has(id))
        ? prev
        : next;
    };
    if (focusId) {
      const moved = to(focusId);
      if (!live.has(moved)) setFocusId(null);
      else if (moved !== focusId) setFocusId(moved);
    }
    if (pathId) {
      const moved = to(pathId);
      if (!live.has(moved)) setPathId(null);
      else if (moved !== pathId) setPathId(moved);
    }

    setElideCuts((cs) =>
      pruneCuts(
        baseNodes,
        cs.map((c) => remapCut(c, to)),
      ),
    );

    setPick((prev) => {
      const entries = Object.entries(prev);
      if (entries.length === 0) return prev;
      let changed = false;
      const next: Record<string, number> = {};
      for (const [id, v] of entries) {
        const moved = to(id);
        if (moved !== id) changed = true;
        next[moved] = v;
      }
      return changed ? next : prev;
    });

    if (clickAccent) {
      const moved = to(clickAccent);
      setClickAccent(live.has(moved) ? moved : null);
    }

    setSelection((prev) => {
      if (!prev) return prev;
      const next = new Set([...prev].map(to).filter((id) => live.has(id)));
      return next.size > 0 ? next : null;
    });

    setCombineOff(remapSet);
    setCommentsOff(remapSet);
    setCommentsExpanded(remapSet);
    setMyStopIds(remapSet);

    setChainOpen((prev) => {
      if (prev.size === 0) return prev;
      const ledgers = new Set(
        baseNodes.filter((n) => n.ledger).map((n) => n.id),
      );
      const next = new Set<string>();
      for (const key of prev) {
        const at = key.lastIndexOf("#");
        const moved = to(key.slice(0, at));
        if (ledgers.has(moved)) next.add(moved + key.slice(at));
      }
      return next.size === prev.size && [...prev].every((k) => next.has(k))
        ? prev
        : next;
    });

    if (flagPrompt) {
      const moved = to(flagPrompt.headId);
      if (!live.has(moved)) setFlagPrompt(null);
      else if (moved !== flagPrompt.headId)
        setFlagPrompt({ ...flagPrompt, headId: moved });
    }

    setEditing((cur) => (cur?.calcStage ? cur : null));
    setPicking(null);

    setArming(null);
    setPendingVerb(null);
  }

  const rekeying = proofKey !== prevProof || shapeKey !== prevShape;

  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (seededFor !== proofKey) {
    setSeededFor(proofKey);

    if (!viewStash.has(proofKey)) {
      const cuts = sourceView(baseNodes);
      if (cuts.length > 0) setElideCuts(cuts);
    }
  }

  // WHICH LIST a proof arrives on, decided ONCE per proof (here, and on a
  // stash restore, which comes through the same key change): `all`, both sets
  // as one reading, which needs to know nothing about what the proof carries
  // and never leaves a stop out of the reader's way (user direction). The two
  // single-set readings are a ⌥-click away. Thereafter the reader's choice
  // stands — nothing below re-decides it. The reading itself starts NOT
  // STARTED (`tourAt` null); `>` takes the first stop.
  const [tourFor, setTourFor] = useState<string | null>(null);
  if (tourFor !== proofKey) {
    setTourFor(proofKey);
    setTourLists({ source: true, temp: true });
    setTourAt(null);
    setTourPeek(new Set());
  }

  // The PATH scope, fed to `computeLayout` as its `only` set: the root→node
  // chain (every ancestor, not just the first-parent one — a marker can carry
  // several) plus the whole subtree under the node. Folds still apply inside
  // it; everything else is simply not drawn.
  // The root→node chain: EVERY ancestor, not just the first-parent one — a
  // band marker inherits several parents, and dropping one would cut the path
  // it is standing on.
  const ancestorsOf = (id: string): Set<string> => {
    const byId = new Map(engine.allNodes().map((n) => [n.id, n]));
    const out = new Set<string>();
    if (!byId.has(id)) return out;
    for (const q = [id]; q.length > 0;) {
      const n = byId.get(q.pop()!);
      if (!n) continue;
      for (const p of n.parents)
        if (!out.has(p.id)) {
          out.add(p.id);
          q.push(p.id);
        }
    }
    return out;
  };

  const only = useMemo(() => {
    if (!pathId) return null;
    if (!engine.allNodes().some((n) => n.id === pathId)) return null;
    const ids = engine.subtreeIds(pathId);
    for (const a of ancestorsOf(pathId)) ids.add(a);
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, pathId]);

  const focusSet = useMemo(
    () => (focusId ? engine.subtreeIds(focusId) : null),
    [engine, focusId],
  );

  const splits = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!gallery) return m;
    for (const id of engine.splitIds()) {
      const cs = engine.childrenOf(id);
      if (cs.length > 1) m.set(id, cs);
    }
    return m;
  }, [engine, gallery]);

  const shownChild = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, cs] of splits)
      m.set(id, (((pick[id] ?? 0) % cs.length) + cs.length) % cs.length);
    return m;
  }, [splits, pick]);

  const hide = useMemo(() => {
    if (splits.size === 0) return null;
    const h = new Set<string>();
    for (const [id, cs] of splits) {
      const keep = shownChild.get(id)!;
      cs.forEach((c, j) => {
        if (j !== keep) h.add(c);
      });
    }
    return h;
  }, [splits, shownChild]);

  const upToLine = upToCursor && highlightPos ? highlightPos.line : null;

  const upToStarts = useMemo(() => {
    const startLine = (n: TreeNode): number | null => {
      if (n.position) return n.position.start.line;
      const parts = n.elidedCut?.parts;
      if (!parts) return null;
      let min: number | null = null;
      for (const p of parts)
        if (p.position && (min === null || p.position.start.line < min))
          min = p.position.start.line;
      return min;
    };
    return treeNodes.map(startLine);
  }, [treeNodes]);

  const upToThreshold = useMemo(() => {
    if (upToLine === null) return null;
    let min: number | null = null;
    for (const l of upToStarts)
      if (l !== null && l > upToLine && (min === null || l < min)) min = l;
    return min;
  }, [upToLine, upToStarts]);
  const upToHide = useMemo(() => {
    if (upToThreshold === null) return null;
    const h = new Set<string>();
    treeNodes.forEach((n, i) => {
      const l = upToStarts[i];
      if (l !== null && l >= upToThreshold) h.add(n.id);
    });
    return h;
  }, [upToThreshold, upToStarts, treeNodes]);

  const hideAll = useMemo(() => {
    if (!upToHide) return hide;
    if (!hide) return upToHide;
    return new Set([...hide, ...upToHide]);
  }, [hide, upToHide]);

  const { nodes, links, extent } = useMemo(
    () =>
      engine.computeLayout(only, focusSet, compact, sideBySide, hideAll, aside),
    [engine, only, focusSet, compact, sideBySide, hideAll, aside],
  );

  // The goals that currently wear a `+N`: read off the STAMP `applyElisions`
  // left on the drawn goal, so a fold PEEKED open (its cut filtered out of
  // `treeNodes`, so no stamp) shows `−` again with no second piece of state
  // to keep in step. The cut's key is re-derived rather than stored — a fold
  // is keyed by its goal, so the goal's own id is all there is to it.
  const foldCutOn = useMemo(() => {
    const out = new Map<string, string>();
    for (const pn of nodes)
      if (pn.data.folded)
        out.set(
          pn.data.id,
          cutId({ kind: pn.data.folded.kind, id: pn.data.id }),
        );
    return out;
  }, [nodes]);

  // Every PLACED node by id. One map, built where the layout lands, so the
  // per-hover lookups below it (and the anchoring further down) are gets
  // rather than linear scans of the whole drawing.
  const placed = useMemo(
    () => new Map(nodes.map((n) => [n.data.id, n])),
    [nodes],
  );

  const hypLitGoalId = useMemo(() => {
    const lit = hypLit === hoverId ? hypLit : null;
    if (!lit) return null;
    const n = placed.get(lit)?.data;
    return n?.type === "tactic" ? (n.parents[0]?.id ?? null) : null;
  }, [hypLit, hoverId, placed]);

  const hypLitTactics = useMemo(() => {
    const linesOf = new Map(nodes.map((n) => [n.data.id, n.data.hyps]));
    const out = new Set<string>();
    for (const n of nodes)
      if (
        n.data.type === "tactic" &&
        // A BREAK stands for steps that are not drawn, so it uses nothing —
        // washing the goal above it would be a claim about a box that is not
        // there. `hoverId` still tracks it; only this set declines.
        !n.data.elidedCut &&
        linesOf.get(n.data.parents[0]?.id ?? "")?.some((l) => l.used)
      )
        out.add(n.data.id);
    return out;
  }, [nodes]);

  useEffect(() => {
    if (!hoverId || !hypLitTactics.has(hoverId)) return;
    const t = setTimeout(() => setHypLit(hoverId), HYP_LIT_DWELL_MS);

    return () => {
      clearTimeout(t);
      setHypLit(null);
    };
  }, [hoverId, hypLitTactics]);

  // B2 — the dwelt hyp line resolved against the DRAWN tree: the goal node it
  // sits in, its wrapped lines, and the introducing tactic node. A line whose
  // origin is folded away (or is one of the declaration's own binders) resolves
  // to nothing: the `<title>` still says where the hypothesis came from, and
  // no ink is spent claiming a box that is not there.
  const hypOriginHit = useMemo(() => {
    if (!hypOrigin || hypOrigin !== hoverHyp) return null;
    const sep = hypOrigin.indexOf("\u0000");
    const gn = placed.get(hypOrigin.slice(0, sep));
    const j = Number(hypOrigin.slice(sep + 1));
    const lines = gn?.data.hyps;
    const line = lines?.[j];
    if (!gn || !lines || !line?.origin) return null;
    const tn = placed.get(line.origin);
    return tn ? { gn, lines, j, tn } : null;
  }, [hypOrigin, hoverHyp, placed]);

  useEffect(() => {
    if (!hoverHyp) return;
    const t = setTimeout(() => setHypOrigin(hoverHyp), HYP_LIT_DWELL_MS);
    return () => {
      clearTimeout(t);
      setHypOrigin(null);
    };
  }, [hoverHyp]);

  const drawnParentIds = useMemo(
    () => new Set(links.map((l) => l.source.data.id)),
    [links],
  );

  if (editing?.calcStage && !nodes.some((n) => n.data.id === editing.id)) {
    const line = editing.calcStage.anchor.line;
    const owner =
      nodes.find(
        (n) =>
          (n.data.type === "tactic" || n.data.synthetic) &&
          n.data.position?.start.line === line,
      ) ??
      nodes.find(
        (n) =>
          (n.data.type === "tactic" || n.data.synthetic) &&
          n.data.position &&
          n.data.position.start.line <= line &&
          n.data.position.stop.line >= line,
      );
    setEditing(owner ? { ...editing, id: owner.data.id } : null);
  }

  if (pendingFill && !editing && getTacticEdit && onEditTactic) {
    const target = nodes.find(
      (n) =>
        n.data.type === "tactic" &&
        n.data.label === "sorry" &&
        n.data.position &&
        n.data.position.start.line === pendingFill.start.line &&
        n.data.position.start.character === pendingFill.start.character,
    );
    if (target) {
      const q = getTacticEdit(target.data.position!);
      setPendingFill(null);
      if (q)
        setEditing({
          id: target.data.id,
          pos: q.pos,
          original: q.text,
          value: "",
          fill: true,
        });
    }
  }

  const { delExtents, delSpecs } = useMemo(() => {
    const delExtents = new Map<string, DeleteExtent | null>();

    const delSpecs = new Map<string, DeleteSpec>();
    if (!deleteSlots || !onDeleteTactic) return { delExtents, delSpecs };

    let byId: Map<string, TreeNode> | null = null;
    for (const n of nodes) {
      if (n.data.elidedCut?.combined) {
        byId ??= new Map(baseNodes.map((b) => [b.id, b]));
        const anchors: ProofStepPosition[] = [];
        const comments: ProofStepPosition[] = [];
        for (const m of combineMemberIds(n.data.id) ?? []) {
          const b = byId.get(m);
          if (b?.type === "tactic" && b.deleteSpec) {
            anchors.push(...b.deleteSpec.anchors);
            comments.push(...b.deleteSpec.comments);
          }
        }
        if (anchors.length === 0) continue;

        anchors.sort((a, b) => cmpPos(a.start, b.start));
        const spec: DeleteSpec = { kind: "tactic", anchors, comments };
        delSpecs.set(n.data.id, spec);
        delExtents.set(n.data.id, deleteExtent(spec, deleteSlots));
      } else if (n.data.deleteSpec && !n.data.synthetic)
        delExtents.set(n.data.id, deleteExtent(n.data.deleteSpec, deleteSlots));
    }
    return { delExtents, delSpecs };
  }, [nodes, baseNodes, deleteSlots, onDeleteTactic]);

  // D1 — THE TWO RESTRUCTURING PROPOSALS, computed once per drawn TREE — and
  // the tree, deliberately, rather than the LAYOUT's node list: focus, the
  // gallery, compact and up-to-cursor all change which nodes are placed and
  // none of them changes a word of the author's source, so keying the pass on
  // the layout re-ran every proposal for a move that could not alter one.
  // `rewrite.ts` is pure text over the tactic's own verbatim source, so both
  // moves are decided here without a round trip and the bar can offer them
  // before anything is asked of the server; the ELABORATOR's answer comes
  // later, when the reader clicks, and is what turns a proposal into an edit.
  // Nothing here reserves space or changes the drawing.
  const rewriteCtx = useMemo((): RewriteCtx | null => {
    if (!deleteSlots || !onApplyRewrite || !getTacticEdit) return null;
    return {
      nodes: treeNodes,
      slots: deleteSlots,
      src: (p) => {
        const e = getTacticEdit({ start: p, stop: p });
        return e
          ? {
              start: e.pos.start,
              stop: e.pos.stop,
              text: e.text,
              indent: e.indent ?? e.pos.start.character,
            }
          : null;
      },
    };
  }, [treeNodes, deleteSlots, onApplyRewrite, getTacticEdit]);

  const rewrites = useMemo(() => {
    const out = new Map<string, { inline?: Rewrite; extract?: Rewrite }>();
    const ctx = rewriteCtx;
    if (!ctx) return out;
    const data = ctx.nodes;
    for (const d of data) {
      if (d.type !== "tactic" || !d.position || d.traceLeaf) continue;
      const inline = d.uses ? inlineRewrite(d, ctx) : null;
      const extract = extractRewrite(d, ctx);
      if (inline?.ok || extract.ok)
        out.set(d.id, {
          inline: inline?.ok ? inline.rewrite : undefined,
          extract: extract.ok ? extract.rewrite : undefined,
        });
    }
    return out;
  }, [rewriteCtx]);

  // D4 — the lints in hand for this proof, as the reader asked for them. The
  // SIBLING wins over the field (the `deleteSlots` rule) and the option gates
  // both: with the option off there are no lint diagnostics at all, so the
  // ribbon, the pager and the fix gesture all fall away together.
  const lintList = useMemo(
    () => (lintsOn ? (lints ?? proof.lints ?? []) : []),
    [lintsOn, lints, proof.lints],
  );

  /** D4 — every lint the reader is being shown, by the node it landed on.
   The fix gesture reads it; `diag.byNode` holds the DIAGNOSTIC form, and the
   fix needs the lint itself (its linter name and its own range). */
  const lintsFor = useMemo(
    () =>
      lintList.length > 0
        ? lintsByNode(treeNodes, lintList)
        : new Map<string, Lint[]>(),
    [treeNodes, lintList],
  );

  // D4 — THE LINT FIXES. `lints.ts` answers each lint with at most one edit,
  // computed from the LINTER'S OWN RANGE and the slot table — no search, no
  // round trip — so the bar can offer the gesture before anything is asked of
  // the server, exactly as D1's pair are offered. The elaborator's verdict
  // comes later, on the click, through the same proposal pill.
  // ONE answer per node, asked once: the bar's affordance, the agent's
  // primitive list and the click all read this map rather than each running
  // the fix pass again. `ready: false` is the `linter.flexible` promise.
  const lintFixes = useMemo(() => {
    const out = new Map<
      string,
      { title: string; ready: boolean; rewrite?: Rewrite }
    >();
    const ctx = rewriteCtx;
    if (!ctx || lintsFor.size === 0) return out;
    for (const [id, ls] of lintsFor) {
      const n = ctxNode(ctx, id);
      if (!n) continue;
      const hit = firstLintFix(n, ls, ctx);
      if (hit) {
        out.set(id, { title: hit.rewrite.title, ready: true, rewrite: hit.rewrite });
        continue;
      }
      // `linter.flexible`'s answer IS D2b's expand, so it needs B4's trace and
      // says "the trace has not been read yet" until one is in hand. The
      // click is what reads it (D2b's own idiom), so the button is offered on
      // the promise rather than withheld until a trace nobody asked for.
      if (ls.some((l) => l.linter === "linter.flexible"))
        out.set(id, { title: LINT_FIXES["linter.flexible"], ready: false });
    }
    return out;
  }, [rewriteCtx, lintsFor]);

  // D5 — THE RENAMES, one pass over the drawn goals' context lines. A rename
  // is offered on the LINE and not on a node, so the map is keyed by the goal
  // and then by the line's index in that goal's own (possibly reflowed)
  // `hyps`: a hypothesis that spilled over two lines offers the same rename
  // from either half, exactly as B2's provenance reads from either half.
  // Nothing here reserves space or changes the drawing — the offer lives in
  // the line's `<title>` and in the ⌥-click.
  const renames = useMemo(() => {
    const out = new Map<
      string,
      Map<number, { rewrite: Rewrite; to: string; rule: NameRule }>
    >();
    const ctx = rewriteCtx;
    if (!ctx) return out;
    for (const d of ctx.nodes) {
      if (d.type !== "goal" || !d.hyps?.length) continue;
      const m = renamesFor(d, ctx);
      if (m.size > 0) out.set(d.id, m);
    }
    return out;
  }, [rewriteCtx]);

  // D2 — THE RUNS, AND THE TWO MOVES THAT ACT ON THEM.
  //
  // Runs are a SOURCE fact (consecutive trunk steps in the author's own text),
  // so they are computed on the BASE tree and not the drawn one: a reader's
  // cut hides steps, it does not join or split them, and the offer must read
  // the same with any cuts standing. Two entry points, keyed by the id the
  // gesture is offered on: the run's FIRST STEP, and any FOLDED goal whose
  // `+N` hides a linear chain — the second is where the reader has already
  // said they do not want to read it, and the extent is theirs.
  // A collapse reads the SLOTS and nothing else — no tactic text, so no
  // `getTacticEdit`: the splice is one range and one word.
  const collapseCtx = useMemo(
    (): RewriteCtx | null =>
      deleteSlots ? { nodes: [], slots: deleteSlots, src: () => null } : null,
    [deleteSlots],
  );

  const collapses = useMemo(() => {
    const out = new Map<string, LinearRun>();
    if (!deleteSlots || !onApplyRewrite) return out;
    for (const r of linearRuns(baseNodes, hasSlot(deleteSlots)))
      if (r.closes) out.set(r.steps[0].id, r);
    for (const d of treeNodes) {
      if (d.type !== "goal" || !d.folded) continue;
      const r = runForFold(d, baseNodes);
      if (r) out.set(d.id, r);
    }
    return out;
  }, [baseNodes, treeNodes, deleteSlots, onApplyRewrite]);

  // THE STALENESS GUARD, once. An answer is written onto the pill only while
  // the pill it was asked for is still the one standing: the reader may have
  // moved on, and a verdict landing on somebody else's proposal would be a
  // claim about edits it never checked.
  const keepProposal =
    (id: string, kind: Rewrite["kind"]) =>
    (f: (cur: NonNullable<typeof proposal>) => NonNullable<typeof proposal>) =>
      setProposal((cur) => (cur?.id === id && cur.kind === kind ? f(cur) : cur));

  const proposeRewrite = (id: string, r: Rewrite, why?: string) => {
    setProposal({ id, kind: r.kind, rewrite: r, phase: "checking", why });
    const keep = keepProposal(id, r.kind);
    if (!onCheckRewrite) {
      keep((cur) => ({
        ...cur,
        phase: "ok",
        delta: r.kind === "inline" ? 1 : r.kind === "extract" ? -1 : 0,
      }));
      return;
    }
    void onCheckRewrite(r.edits).then(
      (res) =>
        keep((cur) => ({
          ...cur,
          phase: res.ok ? "ok" : "bad",
          message: res.message,
          delta: res.before - res.steps,
        })),
      (e: unknown) =>
        keep((cur) => ({ ...cur, phase: "bad", message: String(e) })),
    );
  };
  // D6 — THE PRIMITIVES AN AGENT MAY CHOOSE AMONG. Every one of them is a
  // rewrite this client already computed and could already write: the request
  // carries their titles and their EDIT LISTS, and the answer is allowed to
  // name one of them and say why. There is no free-form edit anywhere in the
  // channel, which is what makes the proposal checkable — it goes through the
  // same `checkRewrite` gate and the same pill as a rewrite the reader asked
  // for by hand.
  //
  // The two moves with no offline edit list — D2's collapse and expand, whose
  // replacement TEXT is the server's answer and not the client's — are
  // deliberately absent: a primitive an agent may pick has to be one this
  // side can hand over whole.
  const agentPrimitives = useMemo(() => {
    const out: { nodeId: string; kind: Rewrite["kind"]; title: string; rewrite: Rewrite }[] =
      [];
    // Nothing asks for these unless the propose channel is there, and the
    // list is the whole D1/D4/D5 catalogue flattened — so it is not built at
    // all where it cannot be sent.
    if (!onPropose) return out;
    for (const [id, r] of rewrites) {
      if (r.inline) out.push({ nodeId: id, kind: "inline", title: r.inline.title, rewrite: r.inline });
      if (r.extract)
        out.push({ nodeId: id, kind: "extract", title: r.extract.title, rewrite: r.extract });
    }
    for (const [id, f] of lintFixes)
      if (f.rewrite)
        out.push({
          nodeId: id,
          kind: "lint",
          title: f.rewrite.title,
          rewrite: f.rewrite,
        });
    for (const [id, m] of renames)
      for (const rn of m.values())
        out.push({ nodeId: id, kind: "rename", title: rn.rewrite.title, rewrite: rn.rewrite });
    return out;
  }, [onPropose, rewrites, lintFixes, renames]);

  // The proof as the agent is shown it: the tree's own outline, one line per
  // node in DFS order. Not the file's bytes — this side does not hold them —
  // and not prose either; it is what the reader is looking at.
  const agentText = () =>
    treeNodes
      .filter((n) => !n.traceLeaf)
      .map((n) => `${n.type === "goal" ? "⊢ " : ""}${n.label.replace(/\s+/g, " ")}`)
      .join("\n")
      .slice(0, 8000);

  const askAgent = () => {
    if (!onPropose || proposeBusy) return;
    if (agentPrimitives.length === 0) {
      showToast("Nothing to propose — no rewrite is offered on this proof");
      return;
    }
    setProposeBusy(true);
    void onPropose({
      text: agentText(),
      primitives: agentPrimitives.map(({ nodeId, kind, title }) => ({
        nodeId,
        kind,
        title,
      })),
    }).then(
      (res) => {
        setProposeBusy(false);
        const hit = agentPrimitives.find(
          (p) =>
            p.nodeId === res.nodeId && (!res.kind || p.kind === res.kind),
        );
        if (!hit) {
          showToast(res.note ?? "No rewrite proposed", true);
          return;
        }
        proposeRewrite(hit.nodeId, hit.rewrite, res.reason);
        showToast(`Proposed: ${res.reason ?? hit.title}`, true);
      },
      (e: unknown) => {
        setProposeBusy(false);
        showToast(`Proposal failed: ${String(e).slice(0, 60)}`, true);
      },
    );
  };

  // D2a — COLLAPSE. The client knows the extent; only the elaborator knows
  // which tactic closes it, so the proposal is opened BEFORE the candidate is
  // known and the pill's line is written when the answer lands. Offline there
  // is no `tryClose`, so the first candidate stands in — the gesture and the
  // pill can be seen and measured, and the verdict stays the server's alone
  // (the D1 rule, said again).
  const proposeCollapse = (id: string, run: LinearRun) => {
    const n = run.steps.length;
    const ctx = collapseCtx;
    if (!ctx) return;
    const open = (tactic: string) => collapseRewrite(run, ctx, tactic);
    const stub = open(AUTOMATION_CANDIDATES[0]);
    if (!stub.ok) {
      showToast(`No collapse — ${stub.why}`);
      return;
    }
    setProposal({
      id,
      kind: "collapse",
      rewrite: stub.rewrite,
      phase: "checking",
      title: `collapse ${n} step${n === 1 ? "" : "s"} to one tactic`,
    });
    const from = run.steps[0].position!.start;
    const to = run.steps[n - 1].position!.start;
    const keep = keepProposal(id, "collapse");
    if (!onTryClose) {
      keep((cur) => ({ ...cur, phase: "ok", delta: n - 1, title: undefined }));
      return;
    }
    void onTryClose(from, to).then(
      (res) => {
        if (!res.tactic) {
          keep((cur) => ({
            ...cur,
            phase: "bad",
            message:
              res.message ??
              `nothing closes it (tried ${res.tried?.length ?? AUTOMATION_CANDIDATES.length})`,
          }));
          return;
        }
        const won = open(res.tactic);
        if (!won.ok) {
          keep((cur) => ({ ...cur, phase: "bad", message: won.why }));
          return;
        }
        keep((cur) => ({
          ...cur,
          phase: "ok",
          rewrite: won.rewrite,
          title: undefined,
          delta:
            res.before !== undefined && res.steps !== undefined
              ? res.before - res.steps
              : n - 1,
        }));
      },
      (e: unknown) =>
        keep((cur) => ({ ...cur, phase: "bad", message: String(e) })),
    );
  };

  // D2b — EXPAND. The trace has to be in hand first: where it is not, the
  // B4 RPC is asked and the proposal opens on its answer, so the reader's one
  // click still means "write what it used".
  // B4's trace, fetched if it is not in hand, and the node re-stamped with it.
  // `go` is called ONCE either way, so a gesture that needs a trace is still
  // one click; `miss` is what to say when there is no trace to be had. The
  // trace lands in `traces` and is stamped on the next drawn tree, but the
  // click cannot wait for a render, so it reads the index directly.
  const withTrace = (
    n: TreeNode,
    go: (node: TreeNode) => void,
    miss?: () => void,
  ) => {
    if (n.trace) return go(n);
    if (!onTrace || !n.position) return miss?.();
    onTrace(n.position).then(
      (ok) => {
        if (!ok) return showToast("No trace — the server could not read one");
        const t = traceRef.current.get(traceKey(n.position!.start));
        go(t ? { ...n, trace: t } : n);
      },
      () => showToast("No trace — the request failed"),
    );
  };

  const proposeExpand = (id: string) => {
    const ctx = rewriteCtx;
    const n = treeNodes.find((t) => t.id === id);
    if (!ctx || !n?.position) return;
    withTrace(n, (node) => {
      const p = expandRewrite(node, ctx);
      if (!p.ok) {
        showToast(`Nothing to write — ${p.why}`);
        return;
      }
      proposeRewrite(id, p.rewrite);
    });
  };

  // D4 — FIX A LINT. The first of the node's lints that has a one-edit answer
  // is proposed; where the only answer is `linter.flexible`'s, B4's trace is
  // fetched FIRST and the proposal opens on its answer — the same one-click
  // shape D2b's `⇑` has, for the same reason (`lintFix` declines with "the
  // trace has not been read yet" until then).
  const proposeLintFix = (id: string) => {
    const ctx = rewriteCtx;
    const ls = lintsFor.get(id);
    const n = treeNodes.find((t) => t.id === id);
    if (!ctx || !ls || !n) return;
    const ready = lintFixes.get(id)?.rewrite;
    if (ready) return proposeRewrite(id, ready);
    const why = () =>
      lintFixesFor(n, ls, ctx)
        .map((f) => (f.proposal.ok ? "" : f.proposal.why))
        .find(Boolean) ?? "there is no one-edit answer";
    const miss = () => showToast(`No fix — ${why()}`);
    withTrace(
      n,
      (node) => {
        const hit = firstLintFix(node, ls, ctx);
        if (hit) proposeRewrite(id, hit.rewrite);
        else miss();
      },
      miss,
    );
  };

  // WHICH nodes a delete extent covers — the armed dimming and the ⌦ hover
  // preview are the same question asked twice, so they ask it in one place.
  // Keyed by POSITION (an extent is a source range; ids say nothing about it),
  // with the anchor always in the set.
  const extentIds = (
    e: {
      start: { line: number; character: number };
      stop: { line: number; character: number };
    },
    anchorId: string,
  ): Set<string> => {
    const within = (p: { line: number; character: number }) =>
      posLE(e.start, p) && posLE(p, e.stop);
    const out = new Set<string>();
    for (const n of nodes)
      if (
        n.data.id === anchorId ||
        (n.data.position && within(n.data.position.start))
      )
        out.add(n.data.id);
    return out;
  };

  const armedIds =
    arming && armExtent ? extentIds(armExtent, arming.id) : EMPTY_IDS;

  const hlKey = highlightPos
    ? `${highlightPos.line}:${highlightPos.character}`
    : "";
  const [prevHlKey, setPrevHlKey] = useState(hlKey);
  if (hlKey !== prevHlKey) {
    setPrevHlKey(hlKey);
    setHlDismissed(false);

    setClickAccent(null);
  }

  const commentSpans = useMemo(
    () =>
      (proof.comments ?? []).map((c) => ({
        start: c.start,

        stop: c.text.startsWith("--")
          ? { line: c.stop.line, character: Number.MAX_SAFE_INTEGER }
          : c.stop,
      })),
    [proof],
  );

  const cursorTargets = useMemo(
    () => tacticTargets(nodes.map((n) => n.data)),
    [nodes],
  );

  const commentOwner = useMemo(() => {
    const byStart = new Map<string, { id: string; isTactic: boolean }>();
    for (const n of nodes)
      for (const r of n.data.commentRanges ?? [])
        byStart.set(`${r.start.line}:${r.start.character}`, {
          id: n.data.id,
          isTactic: n.data.type === "tactic",
        });
    return commentSpans.map((c) => {
      const o = byStart.get(`${c.start.line}:${c.start.character}`);
      return o && o.isTactic ? o.id : null;
    });
  }, [nodes, commentSpans]);

  const commentEditFor = (d: {
    commentRanges?: ProofStepPosition[];
  }): {
    pos: ProofStepPosition;
    original: string;
    indent: number;
  } | null => {
    const ranges = d.commentRanges ?? [];
    if (ranges.length === 0) return null;
    const cs = ranges.flatMap((r) => {
      const c = (proof.comments ?? []).find(
        (x) =>
          x.start.line === r.start.line &&
          x.start.character === r.start.character,
      );
      return c ? [c] : [];
    });
    if (cs.length === 0) return null;
    let block = [cs[0]];
    for (let i = 1; i < cs.length; i++) {
      if (cs[i].start.line !== block[block.length - 1].stop.line + 1) {
        block = [cs[0]];
        break;
      }
      block.push(cs[i]);
    }

    const indent =
      block.length > 1
        ? Math.min(...block.slice(1).map((c) => c.start.character))
        : block[0].start.character;
    let original = block[0].text;
    for (let i = 1; i < block.length; i++)
      original +=
        "\n" +
        " ".repeat(Math.max(0, block[i].start.character - indent)) +
        block[i].text;
    return {
      pos: { start: block[0].start, stop: block[block.length - 1].stop },
      original,
      indent,
    };
  };

  const cursorNodeId = useMemo(() => {
    if (hlDismissed) return null;

    if (clickAccent) return clickAccent;
    if (hlKey === "" || !highlightPos) return null;
    const ci = commentSpans.findIndex((c) => positionContains(c, highlightPos));
    if (ci >= 0) return commentOwner[ci];
    return tacticNodeAt(cursorTargets, highlightPos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cursorTargets,
    hlKey,
    hlDismissed,
    clickAccent,
    commentSpans,
    commentOwner,
  ]);

  const diag = useMemo(() => {
    const all = engine.allNodes();
    // Lints are attributed by `lintNodeAt` — the drawn tree's own question,
    // with the fallback a `skip` (harvested as NO step) needs — and then
    // converted to `TreeDiagnostic`s at severity 3 and merged into the kept
    // list BEFORE `attachDiagnostics`. One pipeline: the ribbon, the `worst`
    // map, the node `<title>` and the bar's pager get them for nothing.
    const lintDiags =
      lintList.length > 0 ? lintDiagnostics(lintList, lintsFor) : [];
    const raw = [...(diagnostics ?? []), ...lintDiags];
    if (raw.length === 0) return null;
    const consumed = new Set<string>();
    for (const n of all) for (const p of n.parents) consumed.add(p.id);
    const open: { id: string; position: ProofStepPosition }[] = [];
    const chipped = new Set<string>();
    for (const n of all) {
      if (n.type !== "goal" || consumed.has(n.id)) continue;
      if (n.position) open.push({ id: n.id, position: n.position });
      if (n.addSpec) chipped.add(n.id);
    }
    return attachDiagnostics(tacticTargets(all), raw, {
      open,
      chipped,
    });
  }, [engine, diagnostics, lintList, lintsFor]);

  const [diagSel, setDiagSel] = useState<string | null>(null);
  const diagList = diag?.ordered ?? [];
  const diagIdx = Math.max(
    0,
    diagList.findIndex((o) => o.diag.key === diagSel),
  );
  const diagCur = diagList[diagIdx] ?? null;

  const nodeKeys = useMemo(() => layoutKeys(nodes), [nodes]);

  const anchorOn = (id: string) => {
    const cur = placed.get(id);

    if (cur)
      anchorRef.current = {
        id,
        key: nodeKeys.get(id)!.posKey ?? `I${id}`,
        x: cur.x,
        y: cur.y,
      };
  };

  // B4 — OPEN or CLOSE one step's trace. The subtree IS a relayout, so it is
  // anchored on the step the reader clicked, like every other one; nothing
  // moves under the pointer.
  //
  // Where the answer is not in hand yet the RPC is asked for it first and the
  // affordance shows a pending state (the button's glyph goes to `…`); the
  // subtree opens when it lands. Offline (`ppharness --traces`) there is no
  // RPC and the answer is already in the index, so the toggle is immediate.
  const toggleTrace = (id: string) => {
    const n = treeNodes.find((t) => t.id === id);
    if (!n?.position) return;
    anchorOn(id);
    if (traceOpen.has(id)) {
      setTraceOpen((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    const open = () =>
      setTraceOpen((prev) => new Set(prev).add(id));
    if (traces.has(traceKey(n.position.start))) return open();
    if (!onTrace) return;
    if (traceBusy.has(id)) return;
    setTraceBusy((prev) => new Set(prev).add(id));
    const done = () =>
      setTraceBusy((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    onTrace(n.position).then(
      (ok) => {
        done();
        if (ok) open();
        else showToast("No trace — the server could not read one");
      },
      () => {
        done();
        showToast("No trace — the request failed");
      },
    );
  };

  const anchorAs = (currentId: string, nextId: string) => {
    const cur = placed.get(currentId);
    if (cur)
      anchorRef.current = { id: nextId, key: `I${nextId}`, x: cur.x, y: cur.y };
  };

  const candidatesFor = (nodeId: string): CompletionPools => {
    const node = placed.get(nodeId);

    const goalId =
      node?.data.type === "goal" ? node.data.id : node?.data.parents[0]?.id;
    const goal = goalId ? placed.get(goalId)?.data : undefined;
    return {
      hyps: [...(goal?.hyps ?? [])]
        .filter((h) => !h.cont)
        .sort((a, b) => Number(b.used) - Number(a.used))
        .flatMap((h) => h.text.split(" : ")[0].trim().split(/\s+/))
        .filter((n) => n && n !== "⊢"),

      terms: goalId && getGoalTerms ? getGoalTerms(goalId) : [],
      tactics: proof.tacticNames ?? [],
    };
  };

  const editedNodeId = editing?.id ?? null;
  useEffect(() => {
    globalNameCache.clear();
  }, [editedNodeId]);

  const [globalWant, setGlobalWant] = useState<string | null>(null);
  const [globalArrival, setGlobalArrival] = useState<{
    query: string;
    names: string[];
  } | null>(null);
  useEffect(() => {
    if (!globalWant || !fetchGlobalNames) return;
    const t = window.setTimeout(() => {
      fetchGlobalNames(globalWant)
        .then((names) => {
          globalNameCache.set(globalWant, names);
          setGlobalArrival({ query: globalWant, names });
        })
        .catch(() => {});
    }, GLOBAL_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [globalWant, fetchGlobalNames]);

  const refreshCompletion = (nodeId: string, value: string, caret: number) => {
    const ident = identPrefixAt(value, caret);
    let globals: string[] | undefined;
    if (fetchGlobalNames && ident.length >= MIN_GLOBAL_PREFIX) {
      const hit = cachedGlobals(ident);
      if (hit) globals = hit;

      setGlobalWant(hit ? null : ident);
    } else {
      setGlobalWant(null);
    }
    const pools = { ...candidatesFor(nodeId), globals };
    const items = completionsAt(value, caret, pools);
    setCompletion(items.length > 0 ? { items, index: 0 } : null);
  };

  useEffect(() => {
    if (!globalArrival) return;
    const cur = editingRef.current;
    if (!cur) return;
    const ta = document.querySelector<HTMLTextAreaElement>(
      "[data-ptw-edit] textarea",
    );
    if (!ta) return;
    const caret = ta.selectionStart;
    if (!identPrefixAt(ta.value, caret).startsWith(globalArrival.query)) return;
    refreshCompletion(cur.id, ta.value, caret);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalArrival]);

  const acceptCompletion = (
    cur: NonNullable<typeof editing>,
    item: CompletionItem,
    ta: HTMLTextAreaElement | null,
  ) => {
    const value =
      cur.value.slice(0, item.from) + item.label + cur.value.slice(item.to);
    const caret = item.from + item.label.length;
    setEditing((e) => e && { ...e, value });
    syncAbbrev(editKey(cur)!, value, caret);
    setCompletion(null);

    window.setTimeout(() => {
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(caret, caret);
    }, 0);
  };

  const anchorRoot = () => {
    const root = nodes.find((n) => n.data.parents.length === 0) ?? nodes[0];
    if (root) anchorOn(root.data.id);
  };

  // The view settings the status bar and the keys BOTH drive. One wrapper per
  // setting, so a bar click and a keystroke do the same thing and confirm it
  // the same way; the anchoring each already did is unchanged.
  const upToEnabled = !!highlightPos;

  const applyLayout = (v: LayoutMode) => {
    setLayout(v);
    showToast(`Layout · ${LAYOUT_MODES[v].name}`);
  };
  const applyHypMode = (v: HypMode) => {
    anchorRoot();
    setHypMode(v);
    showToast(`Context · ${HYP_MODES[v].name}`);
  };
  const applyCommentMode = (v: CommentMode) => {
    setCommentMode(v);
    showToast(`Comments · ${COMMENT_MODES[v].name}`);
  };
  const applyBrief = (v: boolean) => {
    setBrief(v);
    showToast(`Brief ${v ? "on" : "off"}`);
  };
  const applyCombine = (v: boolean) => {
    setCombine(v);
    if (!v) setCombineOff(new Set());
    showToast(`Merge ${v ? "on" : "off"}`);
  };
  // D4 — turning it ON is what ASKS the server (`ProofTree.lintDecl` is a
  // re-elaboration of the declaration, so nothing fires it unasked); turning
  // it off simply stops reading. The lints themselves belong to the caller.
  const applyLints = (v: boolean) => {
    setLintsOn(v);
    onLints?.(v);
    showToast(`Lints ${v ? "on" : "off"}`);
  };
  // C4 — the row is a SESSION override of the setting, and it says so in the
  // toast: turning it off here does not turn the setting off. Switching it on
  // outside `narrate` would have nothing to rewrite, so the row says that in
  // its title rather than silently doing nothing.
  const applyPolish = (v: boolean) => {
    setPolishOverride(v);
    showToast(`Polish ${v ? "on" : "off"}`);
  };
  const applyUpToCursor = (v: boolean) => {
    setUpToCursor(v);
    showToast(`To cursor ${v ? "on" : "off"}`);
  };
  // Both live in the Layout popover: they are layouts, not view toggles, and a
  // list (unlike a cycle) can hold a choice and its modifiers together.
  const applySideBySide = (v: boolean) => {
    anchorRoot();
    setSideBySide(v);
    showToast(`Side-by-side ${v ? "on" : "off"}`);
  };
  const applyGallery = (v: boolean) => {
    setGallery(v);
    showToast(`Gallery ${v ? "on" : "off"}`);
  };
  const applyReflow = (v: ReflowMode) => {
    if ((v === "off") !== (reflow === "off")) anchorRoot();
    setReflow(v);
    showToast(v === "off" ? "Width · off" : `Width · ${v} col`);
  };

  // NO bare-letter shortcuts. `l g b c k u` were core vim keys, and the document
  // keydown fires whenever the WEBVIEW has focus (clicking a node grants it,
  // with `activeElement` still `body`) — so a vim user's `u` switched to-cursor
  // on and the proof read as stuck collapsed. Only ⌘Z/⌘⇧Z, Esc and `?` are keys.

  const resetToSource = () => {
    anchorRoot();
    setElideCuts(sourceView(baseNodes));

    setFocusId(null);
    setPathId(null);
    setUpToCursor(false);
    setCombineOff(new Set());
    setCommentsOff(new Set());
    setCommentsExpanded(new Set());
    setChainOpen(new Set());
    setPick({});
    setSelection(null);
    setFlagOpen(false);
    setMarquee(null);
    setPicking(null);
    setArming(null);
    setFlagPrompt(null);

    setClickAccent(null);
    showToast("Reset tree");
  };

  const cutMembers = (
    picked: ReadonlySet<string>,
  ): { ids: Set<string>; absorbed: Set<string> } => {
    const byId = new Map(baseNodes.map((n) => [n.id, n]));
    const treeById = new Map(treeNodes.map((n) => [n.id, n]));
    const ids = new Set<string>();
    const absorbed = new Set<string>();
    const claim = (id: string) => {
      const d = treeById.get(id);
      const members = combineMemberIds(id);
      if (d?.elidedCut && !d.elidedCut.combined) {
        absorbed.add(id);
        const cut = elideCuts.find((c) => cutId(c) === id);
        if (cut) for (const pid of resolveCut(cut, byId)) ids.add(pid);
      } else if (members) {
        absorbed.add(id);
        for (const pid of members) if (byId.has(pid)) ids.add(pid);
      } else if (byId.has(id)) {
        ids.add(id);
      }
    };
    for (const id of picked) claim(id);
    return { ids, absorbed };
  };

  // ONE door onto the cut list. It DEDUPES by `cutId`, which is not defensive
  // book-keeping: a goal's `−` and ⌥-click on the LEAF below it mint the very
  // same `elide-fold:` cut, and a marquee band over a goal's subtree mints it
  // a third way; a second copy would resolve to the same members twice.
  const addCut = (cut: ElideCut, drop?: ReadonlySet<string>) => {
    const key = cutId(cut);
    setElideCuts((cs) => {
      const kept = drop ? cs.filter((c) => !drop.has(cutId(c))) : cs;
      return kept.some((c) => cutId(c) === key)
        ? kept
        : coalesceCuts(baseNodes, [...kept, cut]);
    });
  };
  const dropCut = (id: string) => {
    setElideCuts((cs) => {
      const next = cs.filter((c) => cutId(c) !== id);
      return next.length === cs.length ? cs : next;
    });
  };
  const cutExtentIds = (cut: ElideCut): Set<string> =>
    new Set(resolveCut(cut, treeIdx.byId));

  // ◌ SKIPS: the goal above hops over the step wherever it has one
  // continuation — trunk or branch, any layout — and a LEAF folds the goal
  // above (reading to the end of a branch). A split, a closing step with side
  // obligations and a ledger row get `null`, and ◌ is not offered there
  // (`stepElidable` asks the same function).
  const stepCutFor = (id: string): { cut: ElideCut; anchor: string } | null => {
    const cut = stepCut(treeIdx.byId, id, treeIdx.kids);
    if (!cut) return null;
    if (cut.kind !== "hop") return { cut, anchor: "id" in cut ? cut.id : id };
    // The one thing only the DRAWN tree can say: this step hangs off the goal
    // a standing hop KEPT, so that hop grows by one — the goal's `+N` is the
    // tally — rather than a second break opening directly below the first.
    const up = treeIdx.byId.get(cut.id)?.parents[0]?.id;
    const host = up ? treeIdx.byId.get(up) : undefined;
    const prev =
      host?.folded?.kind === "hop"
        ? elideCuts.find((c) => c.kind === "hop" && c.id === host.id)
        : undefined;
    return prev && prev.kind === "hop"
      ? {
          cut: { ...prev, steps: (prev.steps ?? 1) + 1 },
          anchor: prev.id,
        }
      : { cut, anchor: cut.id };
  };

  const elideStep = (id: string) => {
    setElidePreview(null);
    const c = stepCutFor(id);
    if (!c) return;
    anchorOn(c.anchor);
    setElideCuts((cs) => {
      // The reader's ◌ can land on a cut the SOURCE already made (its id says
      // nothing about who made it). Replacing it would silently take the
      // author's voice off the break, so the standing seeded cut's mark rides
      // along onto whatever this gesture writes.
      const prev = cs.find((x) => cutId(x) === cutId(c.cut));
      const cut =
        prev && isSeededCut(prev) && c.cut.kind !== "combine"
          ? seedCut(c.cut, seedKindOf(prev))
          : c.cut;
      return coalesceCuts(baseNodes, [
        ...cs.filter((x) => cutId(x) !== cutId(c.cut)),
        cut,
      ]);
    });
  };

  const elideExtentIds = (id: string, combined: boolean): Set<string> => {
    if (combined) return new Set([id]);
    const c = stepCutFor(id);
    return new Set(c ? resolveCut(c.cut, treeIdx.byId) : []);
  };

  // ◌ is offered exactly where `stepCut` answers (`elidableIds`): one
  // continuation, or a LEAF — whose skip is the fold of the goal above, so a
  // branch can be read to its end by skips alone. A split is not offered.
  const elideGateOf = (
    d: (typeof treeNodes)[number],
  ): { combined: boolean } | null => {
    if (d.type !== "tactic" || d.synthetic) return null;
    const combined = !!d.elidedCut?.combined;
    if (d.elidedCut && !combined) return null;
    if (!(combined || elidableIds.has(d.id))) return null;
    return { combined };
  };

  const elidePreviewFor = (
    id: string,
  ): { anchor: string; ids: Set<string> } | null => {
    const d = treeNodes.find((n) => n.id === id);
    const g = d ? elideGateOf(d) : null;
    if (!g) return null;
    return { anchor: id, ids: elideExtentIds(id, g.combined) };
  };

  const altDownRef = useRef<() => void>(() => {});
  useEffect(() => {
    altDownRef.current = () => {
      if (!hoverId) return;
      const p = elidePreviewFor(hoverId);
      if (p) setElidePreview({ ...p, from: "alt" });
    };
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt" && !e.repeat) altDownRef.current();
    };
    const clearAlt = () =>
      setElidePreview((p) => (p?.from === "alt" ? null : p));
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt") clearAlt();
    };

    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    window.addEventListener("blur", clearAlt);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
      window.removeEventListener("blur", clearAlt);
    };
  }, []);

  const elideCombined = (id: string) => {
    elideSelection(new Set([id]));
  };

  const applyPatches = (patches: DocPatch[]) => {
    const ordered = [...patches].sort((a, b) =>
      a.start.line !== b.start.line
        ? b.start.line - a.start.line
        : b.start.character - a.start.character,
    );
    for (const p of ordered)
      onEditTactic!({ start: p.start, stop: p.stop }, p.text);
  };

  const topMemberOf = (ids: readonly string[]): string | null => {
    if (ids.length === 0) return null;
    const index = new Map(baseNodes.map((n, i) => [n.id, i]));
    return ids.reduce((a, b) =>
      (index.get(a) ?? Infinity) <= (index.get(b) ?? Infinity) ? a : b,
    );
  };

  const elideSelection = (sel: Set<string>): boolean => {
    const picked = new Set(
      nodes.map((pn) => pn.data.id).filter((id) => sel.has(id)),
    );
    const { ids, absorbed } = cutMembers(picked);
    if (ids.size === 0) return false;
    // The band follows the verb: exactly one goal's subtree is that goal's
    // FOLD, a straight run is the HOP ◌ would give step by step; anything
    // else keeps the marquee's own marker.
    const cut: ElideCut = cutForBand(treeIdx.byId, ids, treeIdx.kids);

    const top = topMemberOf([...ids])!;
    const topPlaced =
      nodes.find((p) => p.data.id === top) ??
      nodes
        .filter((p) => sel.has(p.data.id))
        .reduce((a, b) => (a.y <= b.y ? a : b));
    // A hop or a fold mints no marker — the goal it hangs off stays, and is
    // the anchor.
    if (cut.kind === "hop" || cut.kind === "fold") anchorOn(cut.id);
    else anchorAs(topPlaced.data.id, cutId(cut));
    addCut(cut, absorbed);
    return true;
  };

  const foldTargetsOf = (t: TreeNode): string[] => {
    const parentGoal = t.parents[0]
      ? baseNodes.find((n) => n.id === t.parents[0].id)
      : undefined;
    if (parentGoal && parentGoal.parents.length === 0) return [t.id];
    const kids = baseNodes.filter(
      (n) => n.type === "goal" && n.parents.some((p) => p.id === t.id),
    );
    const sp = kids.filter((k) => k.spawned);
    return (sp.length > 0 ? sp : kids).map((k) => k.id);
  };

  const commitFlagPrompt = (value: string) => {
    const p = flagPrompt;
    setFlagPrompt(null);
    if (!p) return;
    const head = baseNodes.find((n) => n.id === p.headId);
    const prose = value.replace(/\s*\n\s*/g, " ").trim();
    if (!head || (p.kind === "note" && prose === "")) return;

    if (p.kind === "none" && prose === "" && !noneBareOk(head.id)) return;
    const directive =
      p.kind === "none" ? `.none${prose ? ` ${prose}` : ""}` : prose;
    const patch = flagLine(head, deleteSlots ?? [], directive);
    if (!patch) return;
    applyPatches([patch]);
    if (p.kind === "none") {
      // The same cut the seed will build from the written flag: a hop off the
      // goal above, its note captioning the break; the fold of the goal above
      // on a leaf; or, on a split, the ghost that carries the sentence.
      const byId = new Map(baseNodes.map((n) => [n.id, n]));
      const cut = noneSeedCut(byId, head.id, prose || undefined);
      if (cut.kind === "hop" || cut.kind === "fold") anchorOn(cut.id);
      else anchorAs(head.id, cutId(cut));
      setElideCuts((cs) => [...cs, cut]);
    }
  };

  // The AUTHOR's stop, written from the tree: `-- .mark` above the tactic,
  // through the same one-line writer the `.fold` / `.no-hyps` chips use. No
  // prompt: a caption is the comment's own first sentence, and the author's
  // words are theirs to type — this leaves the flag and lets the existing
  // comment (or a later one) caption it, rather than completing their prose
  // with something they did not choose.
  const writeMark = (id: string) => {
    const head = baseNodes.find((n) => n.id === id);
    if (!head) return;
    const patch = flagLine(head, deleteSlots ?? [], ".mark");
    if (!patch) return;
    anchorOn(id);
    applyPatches([patch]);
    showToast("Wrote `-- .mark` — a source mark");
  };

  // A click on a node is one of three things, in this order: a BREAK restores
  // what it stands for; a goal wearing a `+` drops the fold hanging off it;
  // and a goal offering a `−` takes `goalCut`'s answer, whichever kind it is.
  const onNodeClick = (id: string) => {
    const clicked = placed.get(id)?.data;
    if (clicked?.elidedCut && !clicked.elidedCut.combined) {
      const cut = elideCuts.find((c) => cutId(c) === id);
      if (cut) {
        const byId = new Map(baseNodes.map((n) => [n.id, n]));
        const top = topMemberOf(resolveCut(cut, byId));
        if (top) anchorAs(id, top);
      }
      dropCut(id);
      return;
    }
    const open = foldCutOn.get(id);
    if (open) {
      anchorOn(id);
      dropCut(open);
      return;
    }
    const cut = goalCuts.get(id);
    if (cut) {
      anchorOn(id);
      addCut(cut);
    }
  };

  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  // The status card reports when it FILLS the frame (a thin pane): it then
  // sits one lane above the host button, and the zoom rail climbs over it.
  const [barLifted, setBarLifted] = useState(false);
  const setBarLiftedIfChanged = (v: boolean) =>
    setBarLifted((prev) => (prev === v ? prev : v));

  const PAD_X = viewport.w;
  const PAD_Y = viewport.h;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () =>
      setViewport((prev) =>
        prev.w === el.clientWidth && prev.h === el.clientHeight
          ? prev
          : { w: el.clientWidth, h: el.clientHeight },
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      lastScrollRef.current = { x: el.scrollLeft, y: el.scrollTop };
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = lastLayoutRef.current;

    const liveX = el.scrollLeft;
    const liveY = el.scrollTop;
    const clampedY =
      liveY >= el.scrollHeight - el.clientHeight - 1 &&
      lastScrollRef.current.y > liveY;
    const clampedX =
      liveX >= el.scrollWidth - el.clientWidth - 1 &&
      lastScrollRef.current.x > liveX;
    const sx = clampedX ? lastScrollRef.current.x : liveX;
    const sy = clampedY ? lastScrollRef.current.y : liveY;

    const screenYOf = (y: number) => (MARGIN.top + PAD_Y + y) * zoom - sy;

    const keys = nodeKeys;
    const findByKey = (key: string) =>
      nodes.find((n) => {
        const k = keys.get(n.data.id)!;
        return k.posKey === key || k.idKey === key;
      });

    let anchor = anchorRef.current;
    anchorRef.current = null;

    if (anchor && !findByKey(anchor.key)) anchor = null;

    let refocus = false;
    const chain = cursorChainRef.current;
    if (!anchor && prev && chain.length > 0) {
      const was0 = prev.get(chain[0]);
      const y0 = was0 ? screenYOf(was0.y) : Number.NaN;
      if (y0 >= 0 && y0 <= el.clientHeight) {
        for (const key of chain) {
          const was = prev.get(key);
          const still = was && findByKey(key);
          if (was && still) {
            anchor = { id: still.data.id, key, x: was.x, y: was.y };
            refocus = true;
            break;
          }
        }
      }
    }

    if (!anchor && prev) {
      let best = Infinity;
      for (const n of nodes) {
        const k = keys.get(n.data.id)!;
        const key = k.posKey && prev.has(k.posKey) ? k.posKey : k.idKey;
        const was = prev.get(key);
        if (!was) continue;
        const d = Math.abs(screenYOf(was.y) - el.clientHeight / 2);
        if (d < best) {
          best = d;
          anchor = { id: n.data.id, key, x: was.x, y: was.y };
        }
      }
    }

    const now = anchor && findByKey(anchor.key);
    if (anchor && now) {
      const maxX = el.scrollWidth - el.clientWidth;
      const maxY = el.scrollHeight - el.clientHeight;

      el.scrollLeft = clampScroll(
        compact ? sx : sx + (now.x - anchor.x) * zoom,
        maxX,
      );
      el.scrollTop = clampScroll(sy + (now.y - anchor.y) * zoom, maxY);

      if (refocus) {
        const cy = (MARGIN.top + PAD_Y + now.y) * zoom;

        const ink = inkExtent(now.data);
        const inkTop = cy - ink.up * zoom;
        const inkBot = cy + ink.down * zoom;
        const pad = 32;
        if (
          inkTop < el.scrollTop + pad ||
          inkBot > el.scrollTop + el.clientHeight - pad
        )
          el.scrollTop = clampScroll(
            (inkTop + inkBot) / 2 - el.clientHeight / 2,
            maxY,
          );
      }
    }

    const next = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      const k = keys.get(n.data.id)!;
      const at = { x: n.x, y: n.y };
      if (k.posKey) next.set(k.posKey, at);
      next.set(k.idKey, at);
    }
    lastLayoutRef.current = next;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  useLayoutEffect(() => {
    if (!cursorNodeId) {
      cursorChainRef.current = [];
      return;
    }
    const keys = nodeKeys;
    const keyOf = (id: string) => {
      const k = keys.get(id);
      return k ? (k.posKey ?? k.idKey) : null;
    };
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = cursorNodeId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const k = keyOf(cur);
      if (k) chain.push(k);
      cur = placed.get(cur)?.data.parents[0]?.id;
    }
    cursorChainRef.current = chain;
  }, [cursorNodeId, placed, nodeKeys]);

  const viewKey =
    layout +
    ":" +
    (reflow !== "off" ? "reflow:" : "") +
    (compact && sideBySide ? "cols:" : "") +
    (focusId ? `focus:${focusId}` : pathId ? `path:${pathId}` : "tree");

  // Nothing to unfold on entry any more: both are only ever called on a node
  // the tree is DRAWING, and a node inside a cut is not drawn at all.
  // Focusing a COLLAPSED goal (a fold or a hop wearing `+N`) also opens it:
  // focus is "show me this subtree", and a subtree that stays hidden is not
  // shown. The cut goes the way the corner's click drops it, so the anchor
  // and the coalescing rules are the same ones.
  const focusOn = (id: string) => {
    setPathId(null);
    const open = foldCutOn.get(id);
    if (open) dropCut(open);
    setFocusId(id);
  };
  const exitFocus = () => setFocusId(null);

  // Focus and path are MUTUALLY EXCLUSIVE: each is an answer to "what am I
  // reading", and two at once is a scope nobody asked for.
  const pathOn = (id: string) => {
    setFocusId(null);
    setPathId(id);
  };
  const exitPath = () => setPathId(null);

  // The bar FLOATS and costs the tree NOTHING: the scroll container runs to
  // the bottom of the frame and the tree flows under the card, which is an
  // overlay like every other floater. Reserving `BAR_H + 16` for it was the
  // one thing that made the bar's height a layout fact — and it is what made
  // wrapping expensive, since a second row was then paid for out of the tree.
  // Scrolling the last node clear of the card costs nothing either: `PAD_Y`
  // is a full viewport of padding below the content, so anything can be
  // scrolled up past the card.

  const hdrRef = useRef<HTMLDivElement | null>(null);
  const [hdrRaw, setHdrRaw] = useState(0);
  const [hdrW, setHdrW] = useState(0);
  // Whether the resting one-line text is wider than its box: the FADE at its
  // right edge is drawn only then (a fade on text that fits would eat its
  // last characters). Measured with the height, by the same observer.
  const hdrTextRef = useRef<HTMLSpanElement | null>(null);
  const [hdrClip, setHdrClip] = useState(false);

  useLayoutEffect(() => {
    const el = hdrRef.current;
    if (!el) {
      setHdrRaw(0);
      return;
    }
    if (hdrOpen) return;
    const txt = hdrTextRef.current;
    const read = () => {
      // A hidden webview (the infoview panel behind another view, a collapsed
      // <details>) lays the document out at zero — `useFrameOffset` guards the
      // same way, for the same reason: a 0 here is the ABSENCE of an answer,
      // not a height, and writing it puts the rail on top of the header.
      if (el.getClientRects().length === 0) return;
      if (el.checkVisibility && !el.checkVisibility()) return;
      const r = el.getBoundingClientRect();

      setHdrRaw((prev) => (Math.abs(prev - r.height) > 1 ? r.height : prev));
      setHdrW((prev) => (Math.abs(prev - r.width) > 1 ? r.width : prev));
      setHdrClip(txt ? txt.scrollWidth > txt.clientWidth + 1 : false);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    if (txt) ro.observe(txt);
    return () => ro.disconnect();
  }, [declHeader, declHeaderSigStop, focusId, pathId, hdrOpen]);

  // Outside click closes the open signature. A document listener rather than
  // the `layers` table's `bg` flag: that one answers the tree's BACKGROUND,
  // and a click on a node or the bar is just as much outside the overlay.
  // `data-ptw-hdr` marks the overlay and its button.
  useEffect(() => {
    if (!hdrOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.("[data-ptw-hdr]")) return;
      setHdrOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [hdrOpen]);

  // The measurement is a REFINEMENT of a height the resting header already
  // has by construction (one `pre` line, `overflow: hidden`, 6px of padding
  // each way, 1px border), so it floors rather than defines it: before the
  // first good measurement — and in every window where there is no layout to
  // measure — `hdrH` is still the real header height rather than 0, and
  // `floaterTop(0)` therefore never puts the rail over the header.
  const hdrH = declHeader ? Math.max(hdrRaw, HDR_REST_H) : 0;

  // ONE breadcrumb segment for the two scoping modes (they are mutually
  // exclusive), so the header trail has one shape and one exit.
  const scopeId = focusId ?? pathId;
  const scopeKind: "focus" | "path" | null = focusId
    ? "focus"
    : pathId
      ? "path"
      : null;
  const scopeNode = useMemo(
    () =>
      scopeId
        ? (engine.allNodes().find((n) => n.id === scopeId) ?? null)
        : null,
    [engine, scopeId],
  );

  // The header's two resting texts, cut where the SERVER says by syntax kind
  // (`declHeaderSigStop` = the type spec's `:`, `declHeaderNameStop` = the
  // signature's start) and collapsed to one line. The statement itself is not
  // repeated: it is the root goal's `⊢` line directly below.
  const hdrRest = useMemo(
    () =>
      declHeader && declHeaderStart
        ? headerPrefix(declHeader, declHeaderStart, declHeaderSigStop)
        : null,
    [declHeader, declHeaderStart, declHeaderSigStop],
  );
  const hdrName = useMemo(
    () =>
      declHeader && declHeaderStart
        ? headerPrefix(
            declHeader,
            declHeaderStart,
            declHeaderNameStop ?? declHeaderSigStop,
          )
        : null,
    [declHeader, declHeaderStart, declHeaderNameStop, declHeaderSigStop],
  );
  // keyword + name, for the scope trail. Without the server's split, the
  // first two words (an older server) — never a `…`.
  const declHead = useMemo(
    () =>
      hdrName?.text ??
      (declHeader ?? "").trimStart().split(/\s+/).slice(0, 2).join(" "),
    [hdrName, declHeader],
  );
  const scopeLabel = useMemo(() => {
    if (!scopeNode) return "scoped";
    if (scopeNode.caseLabel) return scopeNode.caseLabel;
    const raw = scopeNode.label ?? "scoped";

    const body = raw.startsWith(TURNSTILE) ? raw.slice(TURNSTILE.length) : raw;

    const cell = measureText("M", NODE_FONT_PX) || 7.2;
    const PILL_CHROME = 120;
    const room = hdrW - measureText(declHead, NODE_FONT_PX) - PILL_CHROME;
    const MAX = Math.max(16, Math.floor(room / cell));
    return body.length <= MAX
      ? raw
      : `${TURNSTILE}…${body.slice(body.length - (MAX - 1))}`;
  }, [scopeNode, hdrW, declHead]);

  const modal: {
    text: string;
    title: string;
    ink: string;
    onExit: () => void;
  } | null = editing?.calcStage
    ? {
        text:
          editing.calcStage.stage === "lhs"
            ? "calc · left-hand side · Enter keeps _"
            : editing.calcStage.closes
              ? "calc · right-hand side · Enter keeps _"
              : "calc · right-hand side · this link steps, so name where it goes",
        title: "Leave the link as it stands, both ends `_` (Esc)",
        ink: SEQ_STROKE,
        onExit: layerOff("calcStage"),
      }
    : arming
      ? {
          text: "deleting… · click the chip again to confirm",
          title: "Cancel this delete (Esc)",
          ink: DANGER_FILL,
          onExit: layerOff("arming"),
        }
      : upToCursor && upToHide && upToHide.size > 0
        ? {
            text: `to cursor · ${upToHide.size} hidden below the cursor`,
            title: "Show the whole proof again (Esc)",
            ink: SEQ_STROKE,
            onExit: () => applyUpToCursor(false),
          }
        : null;

  const floaterRows = [!!headerExtra];
  const floaterTop = (row: number) =>
    8 + hdrH + FLOATER_H * floaterRows.slice(0, row).filter(Boolean).length;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (
      !el ||
      (centeredOn.current?.proofKey === proofKey &&
        centeredOn.current?.viewKey === viewKey) ||
      viewport.w === 0 ||
      viewport.h === 0 ||
      nodes.length === 0
    )
      return;

    const root = nodes.find((n) => n.data.parents.length === 0) ?? nodes[0];
    const maxX = el.scrollWidth - el.clientWidth;
    const maxY = el.scrollHeight - el.clientHeight;
    // A cursor-follow started on the layout BEFORE the viewport arrived (the
    // frame measures a tick after the widget mounts; Restart File shows it)
    // keeps writing absolute positions computed with no padding, from a
    // (0,0) origin, for FOLLOW_MS after this centring — and drags the
    // centred tree out of the frame. Measured: the tree sat one viewport
    // of padding away in a blank frame until ⛶. The arrival cancels it; the
    // follow effect re-runs on the padded layout and animates from HERE.
    cancelFollow(followAnim.current);
    el.scrollLeft = clampScroll(
      compact
        ? (MARGIN.left + PAD_X - COMPACT_LEFT) * zoom
        : (MARGIN.left + PAD_X + root.x) * zoom - viewport.w / 2,
      maxX,
    );
    el.scrollTop = clampScroll(
      (MARGIN.top + PAD_Y + root.y - inkExtent(root.data).up) * zoom -
        MARGIN.top,
      maxY,
    );
    centeredOn.current = { proofKey, viewKey };

    padRef.current = { w: viewport.w, h: viewport.h };
  }, [viewport, nodes, proofKey, viewKey, zoom, PAD_X, PAD_Y, compact]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || viewport.w === 0) return;
    const prev = padRef.current;
    padRef.current = { w: viewport.w, h: viewport.h };

    if (!prev || centeredOn.current === null) return;
    const dx = (viewport.w - prev.w) * zoom;
    const dy = (viewport.h - prev.h) * zoom;
    if (dx === 0 && dy === 0) return;
    el.scrollLeft = clampScroll(
      el.scrollLeft + dx,
      el.scrollWidth - el.clientWidth,
    );
    el.scrollTop = clampScroll(
      el.scrollTop + dy,
      el.scrollHeight - el.clientHeight,
    );
  }, [viewport, zoom]);

  const galleryTarget = useMemo(() => {
    if (!gallery || hlKey === "" || hlDismissed || !highlightPos) return null;

    return tacticNodeAt(tacticTargets(engine.allNodes()), highlightPos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, gallery, hlKey, hlDismissed]);

  const pageTo = (id: string) => {
    if (!gallery) return;
    for (const root of rootIds(proof)) {
      const path = engine.pathBetween(root, id);
      if (!path) continue;
      const want: Record<string, number> = {};
      for (let i = 0; i + 1 < path.length; i++) {
        const cs = splits.get(path[i]);
        if (!cs) continue;
        const j = cs.indexOf(path[i + 1]);
        if (j >= 0 && shownChild.get(path[i]) !== j) want[path[i]] = j;
      }
      if (Object.keys(want).length > 0)
        setPick((prev) => ({ ...prev, ...want }));
      break;
    }
  };
  const [galleryFollowed, setGalleryFollowed] = useState<string | null>(null);
  if (gallery && galleryTarget && galleryTarget !== galleryFollowed) {
    setGalleryFollowed(galleryTarget);
    pageTo(galleryTarget);
  }

  const trackedCursorNode = useRef<string | null>(null);

  const followAnim = useRef<FollowAnim>({ raf: null, timer: null, tgt: null });
  useEffect(() => {
    const a = followAnim.current;
    return () => {
      if (a.raf !== null) cancelAnimationFrame(a.raf);
      if (a.timer !== null) window.clearTimeout(a.timer);
    };
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !cursorNodeId || hlDismissed) return;
    // No viewport yet = no padding yet: a target read off this layout is
    // wrong once the frame measures (see the centring). Wait; the effect
    // re-runs through `PAD_X`/`PAD_Y` when the viewport arrives.
    if (PAD_X === 0 || PAD_Y === 0) return;
    if (trackedCursorNode.current === hlKey) return;
    const node = placed.get(cursorNodeId);
    if (!node) return;

    trackedCursorNode.current = hlKey;
    const { left, top } = inViewScroll(
      el,
      node,
      zoom,
      PAD_X,
      PAD_Y,
      compact,
      upToCursor ? FOLLOW_TOP_FRAC : undefined,
    );
    if (left === el.scrollLeft && top === el.scrollTop) return;
    animateScroll(followAnim.current, el, left, top);
  }, [
    cursorNodeId,
    hlKey,
    hlDismissed,
    placed,
    zoom,
    PAD_X,
    PAD_Y,
    compact,
    upToCursor,
  ]);

  const [seek, setSeek] = useState<{ id: string } | null>(null);
  const sought = useRef<{ id: string } | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !seek || sought.current === seek) return;
    if (PAD_X === 0 || PAD_Y === 0) return;
    const node = placed.get(seek.id);
    if (!node) return;
    sought.current = seek;
    const { left, top } = inViewScroll(el, node, zoom, PAD_X, PAD_Y, compact);
    if (left !== el.scrollLeft || top !== el.scrollTop)
      animateScroll(followAnim.current, el, left, top);
  }, [seek, placed, zoom, PAD_X, PAD_Y, compact]);

  const unhide = (id: string) => {
    const baseById = new Map(baseNodes.map((n) => [n.id, n]));
    // EVERY containing cut, not the first: cuts nest, and `disjointCuts` only
    // drops an inner cut while the outer one is applied — so dropping the
    // outer alone RE-ARMS the inner over the very node being revealed. This
    // is also what unfolds the ancestor chain now that a fold is a cut.
    const covering = new Set(
      elideCuts.filter((c) => resolveCut(c, baseById).includes(id)).map(cutId),
    );
    if (covering.size > 0)
      setElideCuts((cs) => cs.filter((c) => !covering.has(cutId(c))));
    pageTo(id);
  };
  const revealNode = (id: string | null) => {
    if (!id) return;

    const baseById = new Map(baseNodes.map((n) => [n.id, n]));
    const covering = elideCuts.find((c) =>
      resolveCut(c, baseById).includes(id),
    );
    if (covering) {
      const top = topMemberOf(resolveCut(covering, baseById));
      if (top) anchorAs(cutId(covering), top);
    }
    unhide(id);
    setSeek({ id });
  };

  // THE JUMP. A stop is a place to LOOK, so this is `revealNode` with the one
  // difference the tour asks for: a cut hiding the stop is PEEKED open (held
  // in `tourPeek`, folded out of the cut list for as long as this is the stop)
  // rather than dropped. Every containing cut, not the first — cuts nest, and
  // opening only the outer one re-arms the inner over the very node being
  // read (`unhide`'s own rule).
  const goToStopIn = (list: TourStop[], i: number) => {
    if (list.length === 0) return;
    const n = ((i % list.length) + list.length) % list.length;
    const stop = list[n];
    setTourAt(n);
    const baseById = new Map(baseNodes.map((x) => [x.id, x]));
    const covering = elideCuts
      .filter((c) => resolveCut(c, baseById).includes(stop.id))
      .map(cutId);
    setTourPeek(new Set(covering));
    anchorOn(stop.id);
    accentNow(stop.id);
    pageTo(stop.id);
    setSeek({ id: stop.id });
    showToast(`${n + 1}/${list.length} · ${stop.caption}`, true);
  };

  // CLICKING A TAB is the jump, whoever dropped the stop: a tab is a place in
  // the reading, and the number on it is the place, so pointing at it should
  // take you there (the author's included — reading the author's marks is
  // what they are for; ⌥ on your OWN tab is what takes a stop back off).
  // Only stops in the reading wear a tab, so there is nowhere else to look.
  const goToTab = (id: string) => {
    const here = tourStops.findIndex((s) => s.id === id);
    if (here >= 0) goToStopIn(tourStops, here);
  };

  // ONE message: the sets that are on are the reading, and if their union is
  // empty the only thing to say is how to put something in it.
  const EMPTY_TOUR =
    "No marks in the lists that are on — the corner nub drops one";

  const tourListsName = (v: TourLists) =>
    v.source && v.temp
      ? "source + temporary"
      : v.source
        ? "source"
        : v.temp
          ? "temporary"
          : "off";

  // Applying a new pair of toggles: the reading RESTARTS from a standing
  // start (the reader asked for a different set of marks, not to be taken to
  // one of them) and the peeked cuts go with it.
  const applyTourLists = (v: TourLists) => {
    setTourLists(v);
    setTourAt(null);
    setTourPeek(new Set());
    showToast(`Marks: ${tourListsName(v)}`);
  };

  // TOGGLING ONE SET, from the bar panel's two rows: plain checkboxes, and
  // both may be off (user direction — an empty reading greys the chevrons
  // and shows no tabs, which is what "both off" means).
  const toggleTourList = (which: "source" | "temp") =>
    applyTourLists({ ...tourLists, [which]: !tourLists[which] });

  // ⌥-click on the bar item walks the four states: both → source → temp →
  // none → both.
  const cycleTour = () =>
    applyTourLists(
      tourLists.source && tourLists.temp
        ? { source: true, temp: false }
        : tourLists.source
          ? { source: false, temp: true }
          : tourLists.temp
            ? { source: false, temp: false }
            : { source: true, temp: true },
    );

  // `<` / `>`. From NOT STARTED, `>` takes the first stop and `<` the last —
  // the two ends of the reading, reached from outside it. With nothing in the
  // current list there is nowhere to step, so it says so.
  const stepTour = (d: number) => {
    if (tourStops.length === 0) {
      showToast(EMPTY_TOUR);
      return;
    }
    if (tourAt === null)
      goToStopIn(tourStops, d > 0 ? 0 : tourStops.length - 1);
    else goToStopIn(tourStops, tourAt + d);
  };

  const toggleMyStop = (id: string) => {
    const dropping = !myStopIds.has(id);
    setMyStopIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorOn(id);
    // Dropping a mark while the temporary list is OFF turns it on (user
    // direction): the gesture says "I want to see this stop", and a mark
    // that did not show up would read as a failure. The reading restarts
    // from a standing start, as any list change does; the view stays put.
    if (dropping && !tourLists.temp) {
      setTourLists({ ...tourLists, temp: true });
      setTourAt(null);
      setTourPeek(new Set());
      showToast("Mark dropped (⚑) — temporary list on");
      return;
    }
    showToast(dropping ? "Mark dropped (⚑)" : "Mark removed");
  };

  // `<` and `>` — PUNCTUATION, so the no-single-letter-keys rule (a bare
  // letter collides with vim's bindings in the editor beside us) is not in
  // play. Registered once, reaching the current tour through a ref written
  // every render, the way the undo listener reaches `showToast`.
  const tourStepRef = useRef<(d: number) => void>(() => {});
  useEffect(() => {
    tourStepRef.current = (d: number) => stepTour(d);
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "<" && e.key !== ">") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      e.preventDefault();
      tourStepRef.current(e.key === ">" ? 1 : -1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const cfSeekKey = cfStub
    ? `${cfStub.line}:${cfStub.pos?.line ?? "?"}:${cfStub.pos?.character ?? "?"}`
    : null;
  const [cfSeeked, setCfSeeked] = useState<string | null>(null);
  if (cfSeekKey === null || !cfStub) {
    if (cfSeeked !== null) setCfSeeked(null);
  } else if (cfSeeked !== cfSeekKey && !rekeying) {
    const id = cfStubNodeId(baseNodes, cfStub);
    if (!id) setCfSeeked(cfSeekKey);
    else if (nodes.some((n) => n.data.id === id)) {
      setCfSeeked(cfSeekKey);
      setSeek({ id });
    } else unhide(id);
  }

  const stepDiag = (d: number) => {
    if (diagList.length === 0) return;
    const n = (diagIdx + d + diagList.length) % diagList.length;
    setDiagSel(diagList[n].diag.key);
    revealNode(diagList[n].nodeId);
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxX = el.scrollWidth - el.clientWidth;
    const maxY = el.scrollHeight - el.clientHeight;
    if (pendingScrollRef.current) {
      el.scrollLeft = clampScroll(pendingScrollRef.current.left, maxX);
      el.scrollTop = clampScroll(pendingScrollRef.current.top, maxY);
    } else if (zoomAnchorRef.current) {
      const a = zoomAnchorRef.current;
      el.scrollLeft = clampScroll(a.X * zoom - a.px, maxX);
      el.scrollTop = clampScroll(a.Y * zoom - a.py, maxY);
    }
    pendingScrollRef.current = null;
    zoomAnchorRef.current = null;
    zoomRef.current = zoom;
  }, [zoom]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) lastScrollRef.current = { x: el.scrollLeft, y: el.scrollTop };
  });

  const zoomAt = (next: number, px: number, py: number) => {
    const el = scrollRef.current;
    const n = clampZoom(next);
    const z0 = zoomRef.current;
    if (!el || n === z0) return;
    zoomAnchorRef.current = {
      X: (el.scrollLeft + px) / z0,
      Y: (el.scrollTop + py) / z0,
      px,
      py,
    };
    setZoom(n);
  };
  const zoomBy = (factor: number) => {
    const el = scrollRef.current;
    if (!el) return;
    zoomAt(zoom * factor, el.clientWidth / 2, el.clientHeight / 2);
  };

  const fitWidth = () => {
    const el = scrollRef.current;

    if (!el || el.clientWidth === 0 || nodes.length === 0) return;

    const effW = (n: (typeof nodes)[number]) =>
      Math.max(
        n.data.w,
        (compact && n.data.parents.length > 0 && n.data.commentW > 0
          ? COMMENT_INDENT
          : 0) + n.data.commentW,
      );
    const leftOf = (n: (typeof nodes)[number]) =>
      compact ? n.x - n.data.w / 2 : n.x - effW(n) / 2;
    const minLeft = Math.min(...nodes.map(leftOf));
    const maxRight = Math.max(...nodes.map((n) => leftOf(n) + effW(n)));
    const topY = Math.min(...nodes.map((n) => n.y - inkExtent(n.data).up));
    const contentW = maxRight - minLeft + 2 * MARGIN.left;
    const z = clampZoom(el.clientWidth / contentW);
    const cx = (minLeft + maxRight) / 2;
    pendingScrollRef.current = {
      left: (MARGIN.left + PAD_X + cx) * z - el.clientWidth / 2,
      top: (MARGIN.top + PAD_Y + topY) * z - 24,
    };
    setZoom(z);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let target = zoomRef.current;
    let px = 0;
    let py = 0;
    let raf: number | null = null;

    const LOCK_IDLE = 180;
    let lockVertical = false;
    let lastWheelT = 0;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        const now = performance.now();
        if (now - lastWheelT > LOCK_IDLE)
          lockVertical = Math.abs(e.deltaY) > Math.abs(e.deltaX);
        lastWheelT = now;
        if (lockVertical) {
          e.preventDefault();

          el.scrollTop += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        }
        return;
      }
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      px = e.clientX - rect.left;
      py = e.clientY - rect.top;

      if (raf === null) target = zoomRef.current;

      target = clampZoom(target * Math.exp(-e.deltaY * 0.008));
      if (raf === null)
        raf = requestAnimationFrame(() => {
          raf = null;
          zoomAt(target, px, py);
        });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  const svgW = extent.width + MARGIN.left + MARGIN.right + 2 * PAD_X;
  const svgH = extent.height + MARGIN.top + MARGIN.bottom + 2 * PAD_Y;

  type SelVerb = { doc: SelVerbDocKey } & (
    | { kind: "elide" }
    | { kind: "combine"; ids: string[] }
    | { kind: "uncombine"; markers: { id: string; members: string[] }[] }
    | { kind: "comments"; ids: string[]; hide: boolean }
    | {
        kind: "flagFold";
        patches: DocPatch[];
        anchor: string;
        targets: string[];
      }
    | { kind: "prompt"; headId: string; prompt: "none" | "note" }
    | { kind: "patches"; patches: DocPatch[] }
    | {
        kind: "unflag";
        patches: DocPatch[];
        elided: string[];
        folded: string[];
      }
  );

  type PillAct =
    | { do: "run"; verb: SelVerb }
    | { do: "arm"; verb: SelVerb }
    | { do: "flags" }
    | { do: "confirm" }
    | { do: "cancel" };
  type PillChip = {
    label: string;
    title: string;
    color: string;

    act: PillAct;
  };

  const runPillChip = (a: PillAct) => {
    switch (a.do) {
      case "run":
        runSelectionVerb(a.verb);
        break;
      case "arm":
        setPendingVerb(a.verb);
        break;
      case "flags":
        setFlagOpen((o) => !o);
        break;
      case "confirm":
        if (pendingVerb) {
          const v = pendingVerb;
          setPendingVerb(null);
          runSelectionVerb(v);
        }
        break;
      case "cancel":
        setPendingVerb(null);
        break;
    }
  };
  const runSelectionVerb = (v: SelVerb) => {
    switch (v.kind) {
      case "elide":
        if (selection) elideSelection(selection);
        break;
      case "combine": {
        const cut: ElideCut = { kind: "combine", ids: v.ids };
        anchorAs(v.ids[0], cutId(cut));
        setElideCuts((cs) => [...cs, cut]);
        break;
      }
      case "uncombine": {
        const manualIds = new Set(elideCuts.map((c) => cutId(c)));
        const first = v.markers[0];
        if (first) {
          const top = topMemberOf(first.members);
          if (top) anchorAs(first.id, top);
        }
        const manualGone = v.markers
          .filter((m) => manualIds.has(m.id))
          .map((m) => m.id);
        const auto = v.markers.filter((m) => !manualIds.has(m.id));
        if (manualGone.length > 0)
          setElideCuts((cs) =>
            cs.filter((c) => !manualGone.includes(cutId(c))),
          );
        if (auto.length > 0)
          setCombineOff(
            (prev) => new Set([...prev, ...auto.flatMap((m) => m.members)]),
          );
        break;
      }
      case "comments":
        anchorOn(v.ids[0]);
        setCommentsOff((prev) => {
          const next = new Set(prev);
          if (v.hide) for (const id of v.ids) next.add(id);
          else for (const id of v.ids) next.delete(id);
          return next;
        });
        break;
      case "flagFold": {
        applyPatches(v.patches);
        anchorOn(v.anchor);
        // The written flag is the durable copy; this is the same view the
        // seed would build on the next load, through the same door, so the
        // two cannot disagree about which KIND of cut a target takes.
        const byId = new Map(baseNodes.map((n) => [n.id, n]));
        // Stamped SEEDED here, not on the next reseed: the flag is in the
        // source the moment the patch lands, so the corner must already read
        // in the author's voice.
        for (const c of foldSeedCuts(byId, v.targets)) addCut(c);
        break;
      }
      case "prompt":
        setFlagPrompt({ headId: v.headId, kind: v.prompt });
        break;
      case "patches":
        applyPatches(v.patches);
        break;
      case "unflag":
        applyPatches(v.patches);

        if (v.elided.length > 0) {
          const gone = new Set(v.elided);
          // A `.none` seeds a HOP off the goal above the step (or, where no
          // hop can be read, a step ghost): unflagging has to drop whichever
          // one the seed built, so the goal's id is asked for too.
          const byId = new Map(baseNodes.map((n) => [n.id, n]));
          const goneGoals = new Set(
            [...gone].flatMap((id) => {
              const g = byId.get(id)?.parents[0]?.id;
              return g ? [g] : [];
            }),
          );
          setElideCuts((cs) =>
            cs.filter(
              (c) =>
                !(
                  (c.kind === "step" && gone.has(c.id)) ||
                  (c.kind === "hop" && goneGoals.has(c.id))
                ),
            ),
          );
        }
        if (v.folded.length > 0) {
          const gone = new Set(v.folded);
          setElideCuts((cs) => {
            const next = cs.filter(
              (c) =>
                !(
                  (c.kind === "fold" ||
                    c.kind === "hop" ||
                    c.kind === "step") &&
                  gone.has(c.id)
                ),
            );
            return next.length === cs.length ? cs : next;
          });
        }
        break;
    }
    setSelection(null);
    setFlagOpen(false);
  };

  // THE REFLOW SEAM (tracks only). `extent.trackX` is the shared column the
  // aligned pass slid every aside tactic to, published by the layout rather
  // than re-derived here; the hairline sits in the middle of the gap the goals
  // stop at (`TRUNK_GAP_BRANCH / 2` left of it, ASIDE_TRACK_GAP being the same
  // 24). Goals are what the budget wraps and they sit LEFT of the seam, so
  // dragging RIGHT hands them more columns.
  const seamX =
    layout === "tracks" && extent.trackX !== undefined
      ? extent.trackX - TRUNK_GAP_BRANCH / 2
      : null;

  const startSeamDrag = (e: ReactMouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const svg = scrollRef.current?.querySelector("svg");
    const eff = forcedReflow ?? reflow;
    const base = typeof eff === "number" ? eff : REFLOW_CHARS;
    const x0 = e.clientX;
    const z = zoom;
    let cols = base;
    const yAt = (cy: number) => {
      if (!svg) return 0;
      const r = svg.getBoundingClientRect();
      return (cy - r.top) / z - MARGIN.top - PAD_Y;
    };
    setSeamDrag({ cols: base, y: yAt(e.clientY) });
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(
        REFLOW_MIN_CHARS,
        Math.min(
          REFLOW_MAX_CHARS,
          base + Math.round((ev.clientX - x0) / z / CHAR_W),
        ),
      );
      setSeamDrag({ cols: next, y: yAt(ev.clientY) });
      if (next === cols) return;
      cols = next;
      // The non-toasting sibling of `applyReflow`: one engine rebuild per
      // column (~2-3ms), one toast at the end. No off/on transition here, so
      // no re-centring either.
      setReflow(next);
    };
    const stop = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", stop);
      seamStop.current = null;
      setSeamDrag(null);
      if (cols !== base) showToast(`Width · ${cols} col`);
    };
    seamStop.current = stop;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", stop);
  };

  const seamEl: ReactNode =
    seamX === null ? null : (
      <g>
        <line
          x1={seamX}
          y1={0}
          x2={seamX}
          y2={extent.height}
          stroke={
            seamDrag ? SEQ_STROKE : "var(--vscode-editorWidget-border, #cbd5e0)"
          }
          strokeWidth={1}
          pointerEvents="none"
        />
        <rect
          x={seamX - 4}
          y={0}
          width={8}
          height={extent.height}
          fill="transparent"
          style={{ cursor: "col-resize" }}
          onMouseDown={startSeamDrag}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <title>
            Drag to set the reflow width — how many columns the goal boxes wrap
            at
          </title>
        </rect>
        {seamDrag && (
          <g
            transform={`translate(${seamX + 6},${seamDrag.y})`}
            pointerEvents="none"
          >
            <rect
              x={0}
              y={-9}
              width={54}
              height={18}
              rx={3}
              fill="var(--vscode-editorWidget-background, rgba(255,255,255,0.97))"
              stroke="var(--vscode-editorWidget-border, #cbd5e0)"
            />
            <text
              x={27}
              y={0}
              dy="0.32em"
              textAnchor="middle"
              fontFamily="monospace"
              fontSize={11}
              fill="var(--vscode-icon-foreground, #2d3748)"
            >
              {`${seamDrag.cols} col`}
            </text>
          </g>
        )}
      </g>
    );

  let selectionPillEl: ReactNode = null;
  if (selection && !marquee && !flagPrompt) {
    const selPlaced = nodes.filter((p) => selection.has(p.data.id));
    const byId = new Map(baseNodes.map((n) => [n.id, n]));
    const selBase = new Set([...selection].filter((id) => byId.has(id)));
    const canFlag = !!onEditTactic && !!deleteSlots;
    const slots = deleteSlots ?? [];
    const heads = canFlag ? headTactics(baseNodes, selBase, slots) : [];
    const writable = heads.filter((h) => flagLine(h, slots, ".fold"));

    const selTactics = [...selBase].filter(
      (id) => byId.get(id)!.type === "tactic",
    );
    const runIds = selectionRun(baseNodes, selBase);
    const consumerOf = (g: TreeNode) =>
      baseNodes.find(
        (n) => n.type === "tactic" && n.parents.some((p) => p.id === g.id),
      );
    const ctxGoals = canFlag
      ? [...selBase]
          .map((id) => byId.get(id)!)
          .filter((n) => n.type === "goal" && !n.hypFlagged)
          .map((g) => ({ g, c: consumerOf(g) }))
          .filter(
            (x): x is { g: TreeNode; c: TreeNode } =>
              !!x.c && !!flagLine(x.c, slots, ".no-hyps"),
          )
      : [];
    const pinGoals = ctxGoals.filter((x) => usedHypNames(x.g).length > 0);
    const flagged = [...selBase]
      .map((id) => byId.get(id)!)
      .filter((n) => (n.flagRanges?.length ?? 0) > 0);
    const foldHeads = writable.filter(
      (h) => !h.flags?.fold && foldTargetsOf(h).length > 0,
    );
    const soleHead =
      heads.length === 1 && writable.length === 1 ? writable[0] : null;
    // The pill's two rows. `verbs` is what the card always shows; `flagVerbs`
    // are the Alectryon writers behind the `flag ▾` chip.
    const verbs: SelVerb[] = [];
    const flagVerbs: SelVerb[] = [];
    if (selPlaced.some((p) => byId.has(p.data.id) || p.data.elidedCut))
      verbs.push({ kind: "elide", doc: "elide" });
    if (runIds) verbs.push({ kind: "combine", doc: "combine", ids: runIds });

    const combinedSel = selPlaced
      .filter((p) => p.data.elidedCut?.combined)
      .map((p) => ({
        id: p.data.id,
        members: (combineMemberIds(p.data.id) ?? []).filter((m) => byId.has(m)),
      }))
      .filter((m) => m.members.length > 0);
    if (combinedSel.length > 0)
      verbs.push({
        kind: "uncombine",
        doc: "uncombine",
        markers: combinedSel,
      });

    const commented = treeNodes
      .filter((n) => selection.has(n.id) && !!n.comment)
      .map((n) => n.id);
    if (commented.length > 0) {
      const allHidden = commented.every((id) => commentsOff.has(id));

      // ONE chip both ways: a constant label, the title saying which way the
      // click goes (VERB_DOC's `titleAlt`).
      verbs.push({
        kind: "comments",
        doc: "comments",
        ids: commented,
        hide: !allHidden,
      });
    }

    if (soleHead)
      verbs.push({
        kind: "prompt",
        doc: "addNote",
        headId: soleHead.id,
        prompt: "note",
      });
    if (foldHeads.length > 0)
      flagVerbs.push({
        kind: "flagFold",
        doc: "flagFold",
        patches: foldHeads.map((h) => flagLine(h, slots, ".fold")!),
        anchor: foldHeads[0].id,
        targets: foldHeads.flatMap(foldTargetsOf),
      });

    if (soleHead && selTactics.length === 1 && !soleHead.flags?.elide)
      flagVerbs.push({
        kind: "prompt",
        doc: "flagNone",
        headId: soleHead.id,
        prompt: "none",
      });
    if (ctxGoals.length > 0)
      flagVerbs.push({
        kind: "patches",
        doc: "noHyps",
        patches: ctxGoals.map((x) => flagLine(x.c, slots, ".no-hyps")!),
      });
    if (pinGoals.length > 0)
      flagVerbs.push({
        kind: "patches",
        doc: "hUsed",
        patches: pinGoals.map((x) =>
          flagLine(
            x.c,
            slots,
            usedHypNames(x.g)
              .map((n) => `.h#${n}`)
              .join(" "),
          )!,
        ),
      });
    if (canFlag && flagged.length > 0)
      flagVerbs.push({
        kind: "unflag",
        doc: "unflag",

        patches: (() => {
          const seen = new Set<number>();
          return flagged
            .flatMap((n) => removeFlagPatches(n, proof.comments ?? [], slots))
            .filter((p) =>
              seen.has(p.start.line) ? false : (seen.add(p.start.line), true),
            );
        })(),
        elided: flagged
          .filter((n) => n.flags?.elide)
          .flatMap((n) =>
            n.type === "tactic" ? [n.id] : (n.flags?.targets ?? []),
          ),
        folded: flagged
          .filter((n) => n.flags?.fold)
          .flatMap((n) => n.flags?.targets ?? []),
      });
    if (selPlaced.length > 0 && verbs.length + flagVerbs.length > 0) {
      const minX = Math.min(...selPlaced.map((p) => p.x - p.data.w / 2));
      const minY = Math.min(
        ...selPlaced.map((p) => p.y + (bandTopH(p.data) - p.data.h) / 2),
      );
      let cx = minX;

      const verbChip = (v: SelVerb): PillChip => {
        const d = VERB_DOC[v.doc];
        return {
          label: d.label,
          title:
            v.kind === "comments" && !v.hide && d.titleAlt
              ? d.titleAlt
              : d.title,

          color: v.kind === "unflag" ? DANGER_FILL : SEQ_STROKE,

          act:
            v.kind === "unflag"
              ? ({ do: "arm", verb: v } as const)
              : ({ do: "run", verb: v } as const),
        };
      };

      // The writers hang off ONE `flag ▾` chip, which stays in the row while
      // its group is open so the same click shuts it again.
      const flagChip: PillChip[] =
        flagVerbs.length > 0
          ? [
              {
                label: FLAG_GROUP.label,
                title: FLAG_GROUP.title,
                color: SEQ_STROKE,
                act: { do: "flags" },
              },
            ]
          : [];
      const row: PillChip[] = pendingVerb
        ? [
            {
              label: `remove ${pendingVerb.kind === "unflag" ? pendingVerb.patches.length : 0} comment line(s)`,
              title: `Confirm — ${CMD}Z in the editor undoes it`,
              color: DANGER_FILL,
              act: { do: "confirm" },
            },
            {
              label: "×",
              title: "Leave the comments alone",
              color: SEQ_STROKE,
              act: { do: "cancel" },
            },
          ]
        : [
            ...verbs.map(verbChip),
            ...flagChip,
            ...(flagOpen ? flagVerbs.map(verbChip) : []),
          ];

      const chipWs = row.map((c) => chipWidth(c.label, PILL_FONT_PX));
      const rowW =
        chipWs.reduce((a, b) => a + b, 0) + CHIP_GAP * (row.length - 1);
      selectionPillEl = (
        <g data-node="" transform={`translate(0,${minY - CHIP_H - 10})`}>
          <rect
            x={minX - CARD_PAD}
            y={-CARD_PAD}
            width={rowW + 2 * CARD_PAD}
            height={CHIP_H + 2 * CARD_PAD}
            rx={4}
            fill="var(--ptw-surface)"
            stroke="var(--vscode-editorWidget-border, rgba(128,128,128,0.35))"
            strokeWidth={1}
            style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.35))" }}
          />
          {row.map((c, vi) => {
            const w = chipWs[vi];
            const at = cx;
            cx += w + CHIP_GAP;
            return (
              <FrontierChip
                key={c.label}
                glyph={c.label}
                title={c.title}
                x={at}
                width={w}
                color={c.color}
                fontSize={PILL_FONT_PX}

                fontFamily={getCodeFontFamily()}

                solid
                onPick={() => runPillChip(c.act)}
              />
            );
          })}
        </g>
      );
    }
  }

  const cfStubId = cfStub
    ? cfStubNodeId(
        nodes.map((n) => n.data),
        cfStub,
      )
    : null;
  const cfEditable = !!cfStub && cfStub.col !== undefined && !!onEditTactic;

  const editCfStub = (id: string) => {
    if (!cfStub || cfStub.col === undefined) return;
    setEditing({
      id,
      pos: {
        start: { line: cfStub.line, character: cfStub.col },

        stop: { line: cfStub.line, character: 1e5 },
      },
      original: cfStub.draft,
      value: cfStub.draft,
      cfIndent: cfStub.col,
    });
  };
  let cfStubEl: ReactNode = null;
  if (cfStub) {
    const pn = cfStubId ? placed.get(cfStubId) : undefined;

    if (pn && editing?.id !== pn.data.id) {
      const empty = cfStub.draft.trim() === "";
      const label = empty ? "…" : cfStub.draft;

      const cfTagged =
        !empty && cfStub.col !== undefined
          ? (cfStub.render?.(label, cfStub.line, cfStub.col) ?? null)
          : null;
      const boxTop = pn.y + (bandTopH(pn.data) - pn.data.h) / 2;
      const w = Math.max(
        pn.data.w,
        measureText(label, NODE_FONT_PX) + 2 * NODE_PAD,
      );
      const nodeId = pn.data.id;
      cfStubEl = (
        <g
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (cfEditable) editCfStub(nodeId);
          }}
          style={cfEditable ? { cursor: "text" } : undefined}
        >
          <rect
            x={pn.x - pn.data.w / 2}
            y={boxTop}
            width={w}
            height={pn.data.h}
            rx={4}
            fill="var(--ptw-surface)"
            stroke={SEQ_STROKE}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          >
            <title>
              {`being written in the buffer (line ${cfStub.line + 1}) — the tree holds a sorry here until it elaborates` +
                (cfEditable ? "\n· double-click to edit that line here" : "")}
            </title>
          </rect>
          {cfTagged ? (
            <foreignObject
              x={pn.x - pn.data.w / 2 + NODE_PAD}
              y={boxTop + pn.data.h / 2 - LINE_H / 2}
              width={w - 2 * NODE_PAD}
              height={LINE_H}
              style={{ overflow: "visible" }}
            >
              <div
                style={{
                  fontFamily: getCodeFontFamily(),
                  fontSize: NODE_FONT_PX,
                  lineHeight: `${LINE_H}px`,
                  letterSpacing: 0,
                  whiteSpace: "pre",
                  color: NODE_TEXT,
                }}
              >
                {cfTagged}
              </div>
            </foreignObject>
          ) : (
            <text
              x={pn.x - pn.data.w / 2 + NODE_PAD}
              y={boxTop + pn.data.h / 2}
              dominantBaseline="central"
              fontSize={NODE_FONT_PX}
              fontFamily={getCodeFontFamily()}
              fill="var(--ptw-fg)"
              xmlSpace="preserve"
              style={{ letterSpacing: 0 }}
              opacity={empty ? 0.5 : 1}
            >
              {label}
            </text>
          )}
        </g>
      );
    }
  }

  let flagPromptEl: ReactNode = null;
  if (flagPrompt) {
    const pn = placed.get(flagPrompt.headId);
    if (pn) {
      const boxBottom = pn.y + (bandTopH(pn.data) - pn.data.h) / 2 + pn.data.h;
      flagPromptEl = (
        <foreignObject
          x={pn.x - pn.data.w / 2}
          y={boxBottom + 6}
          width={340}
          height={34}
        >
          <div
            data-ptw-edit=""
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", height: "100%" }}
          >
            <textarea
              autoFocus
              rows={1}
              placeholder={
                flagPrompt.kind !== "none"
                  ? "a comment for this tactic"
                  : noneBareOk(flagPrompt.headId)
                    ? "why this part is not worth reading (Enter writes .none)"
                    : "why this closing step is not worth reading"
              }
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setFlagPrompt(null);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitFlagPrompt((e.target as HTMLTextAreaElement).value);
                }
              }}
              style={{
                width: "100%",
                height: 30,
                resize: "none",
                boxSizing: "border-box",
                padding: "5px 8px",
                fontFamily: "monospace",
                fontSize: 12,
                lineHeight: "18px",
                background: EDIT_BG,
                color: EDIT_TEXT,
                border: `1.5px solid ${SEQ_STROKE}`,
                borderRadius: 4,
                outline: "none",
                userSelect: "text",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            />
          </div>
        </foreignObject>
      );
    }
  }

  return (
    <TipContext.Provider value={tipCtl}>
    <div
      data-ptw-theme={themeKind}
      data-ptw-fill={outline ? "none" : undefined}

      data-ptw-hypmark={hypMarkStyle === "underline" ? "underline" : undefined}
      style={{
        position: "relative",
        width: "100%",
        height,
        // The same value as a FLOOR as well as a height. `height` alone is a
        // hypothetical: an ancestor laying this out as a flex item can shrink
        // it (our own `ptw-section-order` rule makes one), and `overflow:
        // hidden` sets this box's automatic minimum size to 0, so there is
        // nothing to stop it. `min-height` is not shrinkable, so the frame the
        // caller asked for is the frame it gets.
        minHeight: height,
        overflow: "hidden",

        ...tokenColorVars,
      }}
    >
      {declHeader ? (
        <div
          ref={hdrRef}
          data-ptw-hdr=""
          onClick={onRevealHeader}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,

            zIndex: 9,
            boxSizing: "border-box",
            fontFamily: getCodeFontFamily(),
            fontSize: NODE_FONT_PX,
            lineHeight: `${LINE_H}px`,
            letterSpacing: 0,
            whiteSpace: "pre-wrap",

            textAlign: "left",
            color: NODE_TEXT,
            background: "var(--ptw-bg)",
            borderBottom:
              "1px solid var(--vscode-editorWidget-border, #cbd5e0)",
            cursor: onRevealHeader ? "pointer" : "default",

            // The right padding is the `▾` button's lane (`HDR_BTN_W` at
            // `HDR_BTN_RIGHT`), in both states — the button is a sibling, so
            // the open overlay's scroll never carries it away.
            ...(hdrOpen
              ? {
                  padding: `6px ${HDR_BTN_LANE}px 6px 10px`,
                  maxHeight: "60%",
                  overflowY: "auto",
                  zIndex: 11,
                }
              : {
                  padding: `6px ${HDR_BTN_LANE}px 6px 10px`,
                  overflow: "hidden",
                }),
          }}
        >
          <div
            style={{
              display: "flex",

              alignItems: "flex-end",

              minWidth: 0,
            }}
          >
            <span
              ref={hdrTextRef}
              style={{
                flex: "0 10 auto",
                minWidth: 0,
                ...(hdrOpen
                  ? {}
                  : {
                      overflow: "hidden",
                      whiteSpace: "pre",
                      // Too wide for the band: a short FADE at the right edge,
                      // never a `…` glyph.
                      ...(hdrClip
                        ? {
                            maskImage: HDR_FADE,
                            WebkitMaskImage: HDR_FADE,
                          }
                        : null),
                    }),
              }}
            >
              {(() => {
                const src = declHeader.split("\n");
                // One line, coloured: the collapsed text maps back to source
                // offsets through its `keep` segments.
                const oneLine = (cut: { text: string; keep: KeepSeg[] }) =>
                  renderDeclHeader?.([cut.text], cut.text, {
                    original: declHeader,
                    keep: cut.keep,
                    marks: [],
                  })?.[0] ?? cut.text;

                if (!hdrOpen) {
                  if (scopeId) {
                    return hdrName
                      ? oneLine(hdrName)
                      : (renderDeclHeader?.([declHead], declHead)?.[0] ??
                          declHead);
                  }
                  if (hdrRest) return oneLine(hdrRest);
                  const lines = renderDeclHeader?.(src) ?? src;
                  return (
                    <>
                      {lines[0]}
                      {src.length > 1 ? (
                        <span style={{ opacity: 0.6 }}> …</span>
                      ) : null}
                    </>
                  );
                }

                const lines = renderDeclHeader?.(src) ?? src;
                return lines.map((ln, i) => (
                  <span key={i} style={{ display: "block" }}>
                    {ln}
                  </span>
                ));
              })()}
            </span>

            {scopeKind && !hdrOpen && (
              <>
                <span style={{ opacity: 0.5, padding: "0 6px", flexShrink: 0 }}>
                  ›
                </span>
                <button
                  type="button"
                  title={
                    scopeKind === "focus"
                      ? "Back to the whole proof (Esc, or ◎ / ⌥-click on the focused goal)"
                      : "Back to the whole proof (Esc, or ⊹ on this node)"
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    if (scopeKind === "focus") exitFocus();
                    else exitPath();
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,

                    flexShrink: 1,
                    minWidth: 0,
                    fontFamily: "inherit",
                    fontSize: "inherit",
                    color: ACCENT_TEXT,
                    background: NODE_STYLES.goal.stroke,
                    border: "none",
                    padding: "1px 8px",
                    borderRadius: 999,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ flexShrink: 0 }}>
                    {scopeKind === "focus" ? "◎" : "⊹ path ·"}
                  </span>
                  <span
                    style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      minWidth: 0,
                    }}
                  >
                    {scopeLabel}
                  </span>
                  <span style={{ opacity: 0.8, flexShrink: 0 }}>✕</span>
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {declHeader ? (
        // A SIBLING of the header, not a child: the open overlay scrolls, and
        // the button must stay put; and its click must not reach the header's
        // reveal-in-source.
        <button
          type="button"
          data-ptw-hdr=""
          aria-label={
            hdrOpen ? "Hide the full signature" : "Show the full signature"
          }
          aria-expanded={hdrOpen}
          onPointerEnter={(e) => tipCtl.enter(e.currentTarget)}
          onPointerLeave={(e) => tipCtl.leave(e.currentTarget)}
          onClick={(e) => {
            e.stopPropagation();
            setHdrOpen((o) => !o);
          }}
          style={{
            position: "absolute",
            top: 0,
            right: HDR_BTN_RIGHT,
            zIndex: 12,
            width: HDR_BTN_W,
            height: HDR_REST_H - 1,
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "inherit",
            fontSize: 11,
            lineHeight: 1,
            color: NODE_TEXT,
            opacity: hdrOpen ? 0.9 : 0.6,
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          {hdrOpen ? "▴" : "▾"}
        </button>
      ) : null}

      {headerExtra && (
        <div
          style={{
            position: "absolute",

            top: floaterTop(0),
            left: 8,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "monospace",
            fontSize: 12,
          }}
        >
          {headerExtra}
        </div>
      )}

      {/* THE TOP-CENTRE STACK — the modal banner, and the toast under it.
          ONE positioned column so the two cannot overlap and neither needs to
          measure the other. */}
      <TopCentre
        top={floaterTop(0)}
        modal={modal}
        toast={toast}
      />

      <ZoomRail
        lifted={barLifted}
        onZoomIn={() => zoomBy(1.25)}
        onZoomOut={() => zoomBy(1 / 1.25)}
        onExpandAll={() => {
          anchorRoot();
          setElideCuts([]);
          setUpToCursor(false);
        }}
        onCollapseAll={() => {
          anchorRoot();
          // The OUTLINE, not every cuttable node: fold each branch where it
          // leaves the trunk, so the spine stays drawn with each branch root
          // wearing a `+N` (see elide.ts's `outlineCuts`).
          // Over the BASE tree, not the drawn one: a branch root hidden inside
          // a standing `.none` ghost is not drawn, so the engine's outline
          // missed it (measured from the seeded view: 17 nodes / 3 folds
          // against 14 / 4). The outline is a statement about the PROOF, and
          // it REPLACES the cut list, so it must see every branch root.
          setElideCuts(outlineCuts(new Map(baseNodes.map((n) => [n.id, n]))));
        }}
        onFit={fitWidth}
      />

      <StatusBar
        onPlace={setBarLiftedIfChanged}
        onResetView={resetToSource}
        upToCursor={upToCursor}
        onUpToCursorChange={applyUpToCursor}
        upToEnabled={upToEnabled}
        layout={layout}
        onLayoutChange={applyLayout}
        sideBySide={sideBySide}
        sbsEnabled={compact}
        gallery={gallery}
        onGalleryChange={applyGallery}
        onSideBySideChange={applySideBySide}
        reflow={reflow}
        forcedReflow={forcedReflow}
        barOpen={barOpen}
        onBarOpenChange={setBarOpen}
        onReflowChange={applyReflow}
        brief={brief}
        onBriefHover={setBriefHover}
        onBriefChange={applyBrief}
        lintsOn={lintsOn}
        onLintsChange={applyLints}
        polishOn={polishOn}
        polishEnabled={!!onPolish && polishReady}
        polishWhy={
          !onPolish
            ? "Polish needs the Ramify companion — the widget cannot reach a network"
            : !polishReady
              ? (polishWhy ??
                "Polish is off in the companion, or no API key is set (Ramify: Set narration API key)")
              : commentMode === "narrate"
                ? "Rewrite each generated line into fluent English through the companion; the author's own comments are never sent (≈)"
                : "Polish rewrites the generated lines, so it shows in Comments: narrate"
        }
        onPolishChange={applyPolish}
        proposeEnabled={!!onPropose && proposeReady && !proposeBusy}
        proposeBusy={proposeBusy}
        proposeWhy={
          !onPropose || !proposeReady
            ? (proposeWhy ??
              "Turn on `ramify.restructure.propose` in the companion, and set an API key")
            : "Ask for one of the rewrites already offered on this proof, with a reason — the elaborator still has the last word"
        }
        onPropose={askAgent}
        commentMode={commentMode}
        onCommentModeChange={applyCommentMode}
        combine={combine}
        onCombineChange={applyCombine}
        hypMode={hypMode}
        onHypModeChange={applyHypMode}
        hypGroup={hypGroup}
        onHypGroupChange={(v) => {
          anchorRoot();
          setHypGroup(v);
        }}
        tourLists={tourLists}
        tourAt={tourAt}
        tourCount={tourStops.length}
        authorCount={authorTour.length}
        myCount={myTour.length}
        onTourListToggle={toggleTourList}
        onTourCycle={cycleTour}
        onTourStep={stepTour}
        helpOpen={helpOpen}
        onHelpOpenChange={setHelpOpen}
        caps={caps}
        fontFamily={codeFont}
        diag={
          diagCur
            ? {
                index: diagIdx,
                count: diagList.length,
                diag: diagCur.diag,
                clickable: !!diagCur.nodeId || !!onReveal,
                onStep: stepDiag,
                onGo: () => {
                  revealNode(diagCur.nodeId);
                  revealAt(diagCur.diag.range);
                },
              }
            : null
        }
      />
      {nodes.length === 0 && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            zIndex: 10,
            fontFamily: "monospace",
            fontSize: 13,
            color: MUTED_FILL,
          }}
        >
          Nothing to display for this proof.
        </div>
      )}
      <div
        ref={scrollRef}
        className="no-scrollbar"
        style={{
          width: "100%",

          height: `calc(100% - ${hdrH}px)`,
          marginTop: hdrH,
          overflow: "auto",

          userSelect: "none",
        }}

        onMouseDown={(e) => {
          if (e.button !== 0) return;
          const target = e.target as Element;
          if (target.closest("g[data-node], [data-ptw-edit]")) return;
          const svg = scrollRef.current?.querySelector("svg");
          if (!svg) return;
          const toContent = (cx: number, cy: number) => {
            const r = svg.getBoundingClientRect();
            return {
              x: (cx - r.left) / zoom - MARGIN.left - PAD_X,
              y: (cy - r.top) / zoom - MARGIN.top - PAD_Y,
            };
          };
          const start = toContent(e.clientX, e.clientY);
          const sx = e.clientX;
          const sy = e.clientY;
          let engaged = false;
          const onMove = (ev: MouseEvent) => {
            if (!engaged && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4)
              return;
            engaged = true;
            const cur = toContent(ev.clientX, ev.clientY);
            setMarquee({ x0: start.x, y0: start.y, x1: cur.x, y1: cur.y });
          };
          const onUp = (ev: MouseEvent) => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            if (!engaged) return;
            marqueeDidDrag.current = true;
            setMarquee(null);
            const cur = toContent(ev.clientX, ev.clientY);
            const lo = {
              x: Math.min(start.x, cur.x),
              y: Math.min(start.y, cur.y),
            };
            const hi = {
              x: Math.max(start.x, cur.x),
              y: Math.max(start.y, cur.y),
            };

            const picked = new Set<string>();
            for (const pn of nodes) {
              const d = pn.data;
              const boxTop = pn.y + (bandTopH(d) - d.h) / 2;
              if (
                pn.x - d.w / 2 <= hi.x &&
                pn.x + d.w / 2 >= lo.x &&
                boxTop <= hi.y &&
                boxTop + d.h >= lo.y
              )
                picked.add(d.id);
            }
            setSelection(picked.size > 0 ? picked : null);
            setFlagOpen(false);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}

        onClick={() => {
          if (marqueeDidDrag.current) {
            marqueeDidDrag.current = false;
            return;
          }
          setHlDismissed(true);
          setClickAccent(null);

          for (const l of layers) if (l.bg && l.up) l.off();
        }}
      >
        <svg
          width={svgW * zoom}
          height={svgH * zoom}
          viewBox={`0 0 ${svgW} ${svgH}`}
        >
          <g
            transform={`translate(${MARGIN.left + PAD_X},${MARGIN.top + PAD_Y})`}
          >
            {links.map((link, i) => {
              const startY =
                link.source.y +
                (link.source.data.h + bandTopH(link.source.data)) / 2;
              const bandTop =
                link.target.y -
                (link.target.data.h + bandTopH(link.target.data)) / 2;

              const contentTop = bandTop + bandTopH(link.target.data);
              const endY = bandTop - ARROW_GAP;

              const sLeft = link.source.x - link.source.data.w / 2;
              const tLeft = link.target.x - link.target.data.w / 2;

              const MARK_FIT = LINK_MARK_OFF + 5;
              const MARK_FIT2 = 2 * LINK_MARK_OFF + 9;

              const MARK_MIN = 10;
              type Mark = { x: number; y: number; horiz?: boolean };
              let startMark: Mark | null = null;
              let endMark: Mark | null = null;

              const markAt = (run: number, fromStart: boolean) =>
                run >= MARK_FIT
                  ? fromStart
                    ? LINK_MARK_OFF
                    : run - LINK_MARK_OFF
                  : run >= MARK_MIN
                    ? run / 2
                    : null;

              const sharedMarks = (x: number, y0: number, y1: number) => {
                const run = y1 - y0;
                if (run >= MARK_FIT2) {
                  startMark = { x, y: y0 + LINK_MARK_OFF };
                  endMark = { x, y: y1 - LINK_MARK_OFF };
                } else {
                  const o = markAt(run, true);
                  if (o !== null) startMark = { x, y: y0 + o };
                }
              };

              const branchMarks = (x0: number, x1: number, y: number) => {
                const run = x1 - x0;
                if (run >= MARK_FIT2) {
                  startMark = { x: x0 + LINK_MARK_OFF, y, horiz: true };
                  endMark = { x: x1 - LINK_MARK_OFF, y, horiz: true };
                } else {
                  const o = markAt(run, true);
                  if (o !== null) startMark = { x: x0 + o, y, horiz: true };
                }
              };
              let d: string;
              // Where the link LEAVES its source and where that first
              // vertical run ends, for the hop break drawn at its midpoint.
              let hopX = link.source.x;
              let hopY = startY;
              let hopEnd = endY;
              if (compact && link.col) {
                const col = sLeft + TRUNK_INSET;
                const childLane = tLeft + TRUNK_INSET;
                const hy = bandTop - ARROW_GAP * 2;
                hopX = col;
                hopEnd = hy;
                d = `M${col},${startY} L${col},${hy} L${childLane},${hy} L${childLane},${contentTop - ARROW_GAP}`;

                const o1 = markAt(childLane - col, true);
                if (o1 !== null)
                  startMark = { x: col + o1, y: hy, horiz: true };
                const o2 = markAt(contentTop - ARROW_GAP - hy, false);
                if (o2 !== null) endMark = { x: childLane, y: hy + o2 };
              } else if (compact && link.lane !== undefined) {
                const lane = link.lane;
                const srcBoxMid =
                  link.source.y + bandTopH(link.source.data) / 2;
                hopX = lane;
                hopY = srcBoxMid;
                hopEnd = contentTop - ARROW_GAP;
                if (Math.abs(tLeft - (lane - TRUNK_INSET)) < 0.5) {
                  d = `M${lane},${srcBoxMid} L${lane},${contentTop - ARROW_GAP}`;

                  const o = markAt(contentTop - ARROW_GAP - srcBoxMid, false);
                  if (o !== null) endMark = { x: lane, y: srcBoxMid + o };
                } else {
                  const landY = contentTop + link.target.data.h / 2;
                  d = `M${lane},${srcBoxMid} L${lane},${landY} L${tLeft - ARROW_GAP},${landY}`;
                  if (tLeft - ARROW_GAP > lane)
                    branchMarks(lane, tLeft - ARROW_GAP, landY);
                  else {
                    const o = markAt(landY - srcBoxMid, true);
                    if (o !== null) startMark = { x: lane, y: srcBoxMid + o };
                  }
                }
              } else if (compact) {
                const col = sLeft + TRUNK_INSET;
                hopX = col;
                hopEnd = contentTop - ARROW_GAP;
                if (Math.abs(tLeft - sLeft) < 0.5) {
                  d = `M${col},${startY} L${col},${contentTop - ARROW_GAP}`;
                  sharedMarks(col, startY, contentTop - ARROW_GAP);
                } else {
                  const landY = contentTop + link.target.data.h / 2;
                  d = `M${col},${startY} L${col},${landY} L${tLeft - ARROW_GAP},${landY}`;

                  if (tLeft - ARROW_GAP > col)
                    branchMarks(col, tLeft - ARROW_GAP, landY);
                  else {
                    const o = markAt(landY - startY, true);
                    if (o !== null) startMark = { x: col, y: startY + o };
                  }
                }
              } else {
                const startX = link.source.x;
                const endX = link.target.x;
                const k = (endY - startY) * 0.7;
                // ⑃ wide, a HOP whose kept goal sits off to one side: the
                // break is drawn for a VERTICAL line at the midpoint below the
                // goal, so the link drops straight through it (and past the
                // caption beside it) before it curves away — otherwise the
                // strokes stood beside a curve that had already left.
                const breakRun =
                  link.source.data.folded?.kind === "hop" &&
                  Math.abs(endX - startX) > 0.5;
                const y1 = (startY + endY) / 2 + BADGE_H / 2 + 2;
                d = breakRun
                  ? `M${startX},${startY} L${startX},${y1}
                    C${startX},${(y1 + endY) / 2}
                     ${endX},${(y1 + endY) / 2}
                     ${endX},${endY}`
                  : `M${startX},${startY}
                    C${startX},${(startY + endY) / 2}
                     ${endX},${endY - k}
                     ${endX},${endY}`;
              }

              const goalBound = link.target.data.type === "goal";
              const stroke = linkTint
                ? goalBound
                  ? LINK_STROKE_GOAL
                  : LINK_STROKE_TACTIC
                : LINK_STROKE;
              return (
                <g key={i}>
                  <path fill="none" stroke={stroke} strokeWidth={1.5} d={d} />
                  {linkMarks && startMark && (
                    <LinkMark {...startMark} goal={goalBound} stroke={stroke} />
                  )}
                  {linkMarks && endMark && (
                    <LinkMark {...endMark} goal={goalBound} stroke={stroke} />
                  )}
                  {link.source.data.folded?.kind === "hop" && (
                    <HopBreak
                      x={hopX}
                      y={(hopY + hopEnd) / 2}
                      stroke={stroke}
                      folded={link.source.data.folded}
                      onRestore={() => onNodeClick(link.source.data.id)}
                    />
                  )}
                </g>
              );
            })}

            {nodes.map((node, ni) => {
              const {
                w,
                h,
                hypH,
                hyps,
                lines,
                type,
                id,
                hasChildren,
                position,
              } = node.data;

              const floatComment = !!node.data.commentFloats;
              const topH = bandTopH(node.data);
              const boxTop = (topH - h) / 2;
              const contentTop = boxTop + NODE_PAD_Y;
              const labelTop = contentTop + hypH;
              const style = NODE_STYLES[type] ?? NODE_STYLES.default;

              const isCursor = id === cursorNodeId;

              const accent = isCursor || !!selection?.has(id);

              const isCombined = !!node.data.elidedCut?.combined;
              // A GHOST: `isGhostNode`'s own question, asked of the drawn
              // node. Measurer and paint read the one predicate.
              const isMarker = isGhostNode(node.data);
              // The badge counts EVERY tactic inside the ghost, the head
              // included — the same reading as the goal corner's `+N`, and
              // every ghost wears one (a single skipped step read `+0` as
              // "no plus to unfold with", reported).
              const ghostMore = isMarker
                ? node.data.elidedCut!.tactics.length
                : 0;

              // The goal's own `−`/`+N`. `folded` is what a fold cut hanging
              // off this goal took (the `+N` counts it and restores it);
              // otherwise `goalCuts` says whether there is anything honest to
              // take from here.
              const folded = node.data.folded ?? null;
              const myCut = goalCuts.get(id) ?? null;
              const cuttable = !!myCut || !!folded;
              const parts = node.data.elidedCut?.parts;
              const actPos =
                position ?? (isCombined ? parts?.[0]?.position : undefined);

              const canReveal = !!onReveal && !!actPos;
              const revealable = canReveal && type === "tactic";
              const goalRevealable = canReveal && type === "goal";

              const editBase =
                type === "tactic" && !!getTacticEdit && !!onEditTactic;
              const editable = editBase && !!position;

              const partEditable =
                editBase && isCombined && (parts?.length ?? 0) > 0;

              const commentEditable =
                !!onEditTactic &&
                !isMarker &&
                !node.data.synthetic &&
                !node.data.recovered;
              const openCommentEdit = () => {
                const q = commentEditFor(node.data);
                if (!q) return;
                cancelPendingReveal();
                setEditing({
                  id,
                  pos: q.pos,
                  original: q.original,
                  value: q.original,
                  comment: true,
                  commentIndent: q.indent,
                });
              };

              const popoutable =
                type === "tactic" && !!actPos && !!onPopoutEdit;
              const isEditing = editing?.id === id;

              const hideForEdit =
                id === cfStubId ||
                (isEditing &&
                  !editing?.add &&
                  !editing?.calcStage &&
                  (!editing?.comment || !!node.data.proseLabel));

              const boxRx = type === "tactic" ? 4 : 6;
              const nodeDiags = diag?.byNode.get(id);
              const diagSev = diag?.worst.get(id) ?? null;
              const diagInk = diagSev === null ? null : diagInkOf(diagSev);
              // A LINT does not restyle the box: the proof is correct, and a
              // node whose border changed colour would say otherwise. Only an
              // error or a warning reaches the stroke; the RIBBON is where a
              // lint speaks.
              const diagStroke =
                diagSev === 1 || diagSev === 2 ? diagInk : null;
              const diagSelected = !!diagCur && diagCur.nodeId === id;
              const recovered = node.data.recovered;
              const recoveredStroke =
                recovered === "failed"
                  ? DANGER_FILL
                  : recovered === "skipped" || node.data.traceLeaf
                    ? "var(--ptw-comment)"
                    : null;

              // A collapsed goal has no DRAWN children but a subtree worth
              // focusing (focus opens it — see `focusOn`).
              const focusable =
                type === "goal" &&
                (hasChildren || !!node.data.folded) &&
                id !== focusId;
              const isFocusRoot = id === focusId;

              // ⊹ is offered on every DRAWN node that is not the path root
              // and not a marker: unlike focus it needs no children (a leaf
              // still has a root→here chain worth reading alone).
              const pathable = !isMarker && id !== pathId;
              const isPathRoot = id === pathId;

              const delExtent = !isMarker ? (delExtents.get(id) ?? null) : null;
              const deletable = !!delExtent;

              const elideGate = elideGateOf(node.data);
              const elidable = elideGate !== null;
              const isArming = arming?.id === id;

              const barLinkPlus = type === "tactic" && linkPlus.has(id);
              // A MARK can land here. Offered on every real node (a marker
              // stands for something rather than being it, so it carries
              // none); the corner nub is the one gesture, and its ⌥ writes
              // the AUTHOR's `.mark` instead, which needs a tactic whose slot
              // starts its own line.
              const stoppableHere = !isMarker && stoppable(node.data);
              // The stop's tab, sized and inked here so the paint below is
              // plain JSX (see `tourTabWidth`, layout.ts).
              const tab = tourTabs.get(id);
              const tabW = tab ? tourTabWidth(tab.n) : 0;
              const tabInk =
                tab?.who === "author" ? "var(--ptw-comment)" : SEQ_STROKE;
              const tabOn = !!tab && id === currentStopId;
              const tabFont = codeFont;
              // EVERY tab is clickable, and the click is the JUMP (`goToTab`)
              // — the number on it is a place in the reading, so pointing at
              // it should take you there, the author's tabs included. Taking
              // one of your OWN stops back off moved to ⌥-click on it, which
              // leaves the hover nub's plain click free to mean "drop".
              const tabMine = tab?.who === "mine";
              // THE QUICK-ADD NUB: the same tab, hollow, on hover of the
              // node's top-left CORNER — not of the node. A permanent corner
              // nub was turned down as clutter, and drawing it on every hover
              // of the box was the same complaint one step quieter (user
              // direction, 2026-09-08): a reader hovering a node to read it
              // met the nub each time. So it hangs off a dedicated invisible
              // REGION — the tab's own rect grown by `NUB_SLACK` on every
              // side, reaching OUTSIDE the box so a pointer arriving from the
              // outside lands on it without entering the node first, and
              // INSIDE it only as far as the tab's own height, clear of the
              // first line's text. Region and nub occupy (near enough) the
              // tab's rect, which `probe overlap` already models, and paint
              // inside the node's `<g>`: no relayout, and the region is
              // invisible, so the probe models neither.
              const nubHere = !tab && stoppableHere;
              const nubShown = nubHere && nubHoverId === id;
              const nubW = tourTabWidth(tabStops.length + 1);
              const markWritable =
                stoppableHere &&
                caps.flags &&
                type === "tactic" &&
                !!flagLine(node.data, deleteSlots ?? [], ".mark");
              // B4 — an automation step the reader can ask about, and whether
              // its trace is open / being fetched. `isAutomationNode` reads
              // SOURCE facts only (the head word and a position), so the
              // affordance is there before any round trip.
              const traceLeaf = node.data.traceLeaf;
              const automation =
                !traceLeaf &&
                isAutomationNode(node.data) &&
                (!!onTrace || traces.has(traceKey(node.data.position!.start)));
              const traceIsOpen = traceOpen.has(id);
              const traceIsBusy = traceBusy.has(id);

              // D1 — the two restructuring moves, decided offline from the
              // tactic's own source (`rewrites`, one pass over the drawn
              // tree). The bar offers them; the elaborator answers when the
              // reader clicks.
              const rw = rewrites.get(id);
              const inlinable = !!rw?.inline;
              const extractable = !!rw?.extract;
              const proposing = proposal?.id === id;

              // D2 — the run this node heads (or, on a folded goal, the run
              // its `+N` hides), and whether its automation has something to
              // write. `collapsible` is a SOURCE fact; `expandable` needs a
              // trace, which the click will fetch if it is not in yet.
              const run = collapses.get(id);
              const collapsible = !!run && !!onApplyRewrite;
              // D4 — a lint on this node with an answer (or, for
              // `linter.flexible`, one the click can reach).
              const lintable = lintFixes.get(id);
              const expandable =
                !traceLeaf &&
                !!onApplyRewrite &&
                automation &&
                (node.data.trace
                  ? node.data.trace.kind === "lemmas"
                  : !!onTrace);

              const hasBar =
                !isEditing &&
                !traceLeaf &&
                (automation ||
                  goalRevealable ||
                  focusable ||
                  isFocusRoot ||
                  pathable ||
                  isPathRoot ||
                  popoutable ||
                  elidable ||
                  deletable ||
                  inlinable ||
                  extractable ||
                  collapsible ||
                  expandable ||
                  barLinkPlus);

              const hoverHighlights =
                type === "tactic" && !!position && !!onHoverTactic;

              const hypLights = type === "tactic" && !!node.data.parents.length;
              const clickable =
                isMarker ||
                cuttable ||
                elidable ||
                revealable ||
                goalRevealable;

              // B3 — what this step NAMES. The premises are the other half of
              // "what did this step use?", the used-hypothesis marks being the
              // first; four is what a title can carry without becoming a list.
              const lemmas = node.data.lemmas ?? [];


              const hints = nodeHints({
                revealable,
                goalCut: folded ? "open" : myCut ? "fold" : null,
                goalRevealable,
                editable,
                partEditable,
                proseLabel: !!node.data.proseLabel,
                elidable,
                focusable,
                isFocusRoot,
                pathable,
                isPathRoot,
                anyUsedHyp: !!hyps?.some((l) => l.used),
                hypOrigins: !!hyps?.some((l) => l.origin),
                usesHyps: hypLitTactics.has(id),
                usesLemmas: lemmas.length > 0,
                branches: (node.data.branch?.arms.length ?? 0) > 0,
                automation,
                traceOpen: traceIsOpen,
                ledgerRows: !!node.data.ledger?.some(
                  (r) => r.goalId !== undefined,
                ),
                linkGoal: barLinkPlus,
                tourStop: myStopIds.has(id),
                tourMarkable: markWritable,
                tourTab: tab?.who ?? null,
                inlinable,
                extractable,
                collapsible,
                expandable,
                renamable: (renames.get(id)?.size ?? 0) > 0,
                lintFixable: !!lintable,
              });

              const diagTip = (nodeDiags ?? [])
                .map((d) => `${diagGlyphOf(d.severity)} ${d.message}`)
                .join("\n\n");

              // A FOLDED goal has no marker to hover, so the count and the
              // list of what went ride the goal's own `<title>`, ahead of its
              // gestures — the ghost's tooltip, said on the node that is
              // standing in for the steps.
              // A FOLD's `.none` note (a leaf the author skipped) has no break
              // to caption, so the sentence heads the title instead.
              const foldedTip = folded
                ? (folded.kind === "fold" && folded.note
                    ? `${folded.note}\n\n`
                    : "") +
                  (folded.seeded
                    ? `${seedTitle(folded.seededBy, folded.tactics.length)}\n\n${folded.tactics.join("\n")}`
                    : `${folded.tactics.length} ${
                        folded.tactics.length === 1 ? "step" : "steps"
                      } ${folded.kind === "hop" ? "skipped" : "folded"} — click + to restore\n\n${folded.tactics.join("\n")}`)
                : "";

              // A SUBTERM step is not a tactic the author wrote on its own
              // line — it is one component of the term the tactic above
              // supplied, given its own goal by the elaborator. Say so, since
              // the box looks like any other step.
              const subtermTip =
                node.data.recovered === "subterm"
                  ? "A term the tactic above supplied — its goal is the component's expected type"
                  : "";

              // B4 — what the automation actually used, once the answer is
              // in: the same `uses:` idiom, in the trace's voice.
              const viaTip = traceTip(node.data.trace);
              const leafTip = traceLeaf?.title ?? "";

              const usesTip = lemmas.length
                ? `uses: ${lemmas
                    .slice(0, 4)
                    .map((l) => l.name)
                    .join(" · ")}${lemmas.length > 4 ? " …" : ""}`
                : "";

              // B5 — the branch this step opened, in the words the ELABORATOR
              // uses for it: the form, what it split on, and each arm's tag
              // with the names it binds.
              const branch = node.data.branch;
              const branchTip =
                branch && branch.arms.length > 0
                  ? `${branch.form}${branch.on ? ` on ${branch.on}` : ""}: ${branch.arms
                      .map(
                        (a) =>
                          `${a.tag || "·"}${
                            a.pattern
                              ? ` ${a.pattern}`
                              : a.binders.length
                                ? ` ${a.binders.join(" ")}`
                                : ""
                          }`,
                      )
                      .join(" | ")}`
                  : "";

              const armTip = node.data.arm?.pattern
                ? `arm: ${node.data.arm.pattern}`
                : "";

              const nodeTooltip = [
                node.data.proseLabel ? node.data.label : "",
                leafTip,
                subtermTip,
                branchTip,
                armTip,
                usesTip,
                viaTip,
                foldedTip,
                diagTip,
                hints.map((h) => `· ${h}`).join("\n"),
              ]
                .filter(Boolean)
                .join("\n\n");

              const taggedHyps =
                hyps && hyps.length > 0 && renderTaggedHyps
                  ? renderTaggedHyps(
                      node.data.hypGoalId ?? id,
                      hyps.map((l) => l.text),
                    )
                  : null;

              // A GHOST's label is a REDUCTION, not the source — there is no
              // token span to align it against — so it always takes the plain
              // `<text>` path. The gate is also load-bearing:
              // `renderCombinedLines([])` is TRUTHY, so without it the
              // fallback would be swallowed and an empty foreignObject hung
              // over the head.
              const taggedLines = isMarker
                ? null
                : node.data.proseLabel
                  ? null
                  : node.data.ledger
                    ? renderTaggedGoal &&
                      lines.length === node.data.ledger.length
                      ? node.data.ledger.map((r, i) =>
                          r.goalId
                            ? (renderTaggedGoal(
                                r.goalId,
                                [lines[i].text],
                                r.hiddenLhs,
                                "",
                              )?.[0] ?? r.text)
                            : r.text,
                        )
                      : null
                    : type === "goal"
                      ? (renderTaggedGoal?.(
                          id,
                          lines.map((l) => l.text),
                          node.data.goalElision?.hidden,
                        ) ?? null)
                      : position
                        ? (renderTaggedTactic?.(
                            position,
                            node.data.label,
                            lines.map((l) => l.text),
                            node.data.elision,
                          ) ?? null)
                        : renderCombinedLines(
                            node.data.elidedCut?.parts,
                            lines,
                            renderTaggedTactic,
                          );

              const rowKeys = node.data.ledger
                ? (() => {
                    let k = 0;
                    return node.data.ledger.map((r) =>
                      r.goalId !== undefined ? `${id}#${k++}` : null,
                    );
                  })()
                : null;
              const rowTitle = (j: number) =>
                chainOpen.has(rowKeys![j]!)
                  ? "hide this step's goal (⌥: every step's)"
                  : "show this step's goal below (⌥: every step's)";
              const toggleRow = (e: ReactMouseEvent<Element>, j: number) => {
                e.stopPropagation();
                const key = rowKeys?.[j];
                if (!key || !node.data.ledger) return;

                anchorOn(id);

                const all = rowKeys.filter((x): x is string => x !== null);
                let opening: string[];
                let closing: string[];
                if (e.altKey) {
                  const anyClosed = all.some((x) => !chainOpen.has(x));
                  opening = anyClosed
                    ? all.filter((x) => !chainOpen.has(x))
                    : [];
                  closing = anyClosed ? [] : all;
                } else if (chainOpen.has(key)) {
                  opening = [];
                  closing = [key];
                } else {
                  opening = [key];
                  closing = [];
                }
                setChainOpen((prev) => {
                  const next = new Set(prev);
                  for (const k of opening) next.add(k);
                  for (const k of closing) next.delete(k);
                  return next;
                });
                if (closing.length > 0) {
                  const gone = new Set(
                    closing
                      .map((k) => rowKeys.indexOf(k))
                      .map((i) => node.data.ledger![i].goalId)
                      .filter((g): g is string => g !== undefined),
                  );
                  // Closing a row drops the fold hanging off that goal, or
                  // re-opening it brings the goal back shut from the previous
                  // visit.
                  setElideCuts((prev) => {
                    const next = prev.filter(
                      (c) =>
                        !(
                          (c.kind === "fold" || c.kind === "hop") &&
                          gone.has(c.id)
                        ),
                    );
                    return next.length === prev.length ? prev : next;
                  });
                }
              };
              const handleClick = (e: ReactMouseEvent<SVGGElement>) => {
                e.stopPropagation();

                if (isMarker) {
                  onNodeClick(id);
                  return;
                }

                if (elidable && e.altKey) {
                  if (isCombined) elideCombined(id);
                  else elideStep(id);
                  return;
                }

                if (revealable) {
                  if (editable || partEditable) deferReveal(actPos!, id);
                  else revealAt(actPos!, id);
                  return;
                }

                if (goalRevealable && (e.metaKey || e.ctrlKey)) {
                  revealAt(position!);
                  return;
                }
                if (focusable && e.altKey) {
                  focusOn(id);
                  return;
                }

                if (isFocusRoot && e.altKey) {
                  exitFocus();
                  return;
                }

                if (e.metaKey || e.ctrlKey || e.altKey) return;
                onNodeClick(id);
              };

              return (
                <g
                  key={id}

                  data-node={id}
                  transform={`translate(${node.x},${node.y})`}

                  opacity={
                    (arming && armedIds.has(id) && id !== arming.id) ||
                    (elidePreview &&
                      elidePreview.anchor !== id &&
                      elidePreview.ids.has(id)) ||
                    (deletePreview &&
                      deletePreview.anchor !== id &&
                      deletePreview.ids.has(id))
                      ? 0.35
                      : undefined
                  }
                  onClick={clickable && !isEditing ? handleClick : undefined}
                  onDoubleClick={
                    (editable ||
                      partEditable ||
                      (node.data.proseLabel && commentEditable)) &&
                    !isEditing
                      ? (e) => {
                          e.stopPropagation();
                          cancelPendingReveal();

                          if (node.data.proseLabel) {
                            openCommentEdit();
                            return;
                          }

                          let editPos = position;
                          if (partEditable) {
                            const el = (e.target as Element).closest?.(
                              "[data-ptw-lineidx]",
                            ) as HTMLElement | null;
                            const li = el ? Number(el.dataset.ptwLineidx) : 0;
                            const seg = lines[li]?.seg ?? 0;
                            const part =
                              partSegSpans(parts!).find(
                                (s) => seg < s.seg0 + s.span,
                              )?.part ?? parts![0];
                            if (!part.position) return;
                            editPos = part.position;
                          }
                          if (!editPos) return;
                          const q = getTacticEdit!(editPos);
                          if (!q) return;
                          setEditing({
                            id,
                            pos: q.pos,
                            original: q.text,
                            value: q.text,

                            ...(partEditable ? { tokPos: editPos } : {}),
                          });
                        }
                      : undefined
                  }

                  onMouseEnter={
                    hoverHighlights
                      ? () => onHoverTactic!(position!)
                      : undefined
                  }
                  onMouseLeave={
                    hasBar || hoverHighlights || hypLights || elidable
                      ? () => {
                          if (hasBar || hypLights)
                            setHoverId((cur) => (cur === id ? null : cur));
                          if (hoverHighlights) onHoverTactic!(null);
                          if (elidable)
                            setElidePreview((p) =>
                              p?.anchor === id ? null : p,
                            );
                          if (deletable)
                            setDeletePreview((pv) =>
                              pv?.anchor === id ? null : pv,
                            );
                        }
                      : undefined
                  }

                  onMouseMove={
                    elidable || hasBar || hypLights
                      ? (e) => {
                          if (hasBar || hypLights) {
                            const g = e.currentTarget as SVGGElement;
                            const hit = (sel: string) => {
                              const r = g
                                .querySelector(sel)
                                ?.getBoundingClientRect();
                              return (
                                !!r &&
                                e.clientX >= r.left &&
                                e.clientX <= r.right &&
                                e.clientY >= r.top &&
                                e.clientY <= r.bottom
                              );
                            };
                            // The quick-add nub's corner region is NOT in this
                            // list: it carries its own hover (`nubHoverId`),
                            // so the node's bar keeps answering to the box
                            // and the bar alone, as it did before the nub
                            // existed.
                            const on =
                              hit("[data-ptw-box]") || hit("[data-ptw-bar]");
                            setHoverId((cur) =>
                              on ? id : cur === id ? null : cur,
                            );
                          }
                          if (e.altKey) {
                            if (elidePreview?.anchor !== id) {
                              const p = elidePreviewFor(id);
                              if (p) setElidePreview({ ...p, from: "alt" });
                            }
                          } else if (
                            elidable &&
                            elidePreview?.anchor === id &&
                            elidePreview.from === "alt"
                          )
                            setElidePreview(null);
                        }
                      : undefined
                  }
                  style={{
                    cursor: clickable && !isEditing ? "pointer" : "default",
                  }}
                >
                  {!taggedLines && nodeTooltip !== "" && (
                    <title>{nodeTooltip}</title>
                  )}

                  {node.data.caseLabel && (
                    <text
                      textAnchor="start"
                      fontSize={CASE_FONT_PX}
                      fontFamily={getCodeFontFamily()}
                      fill={CASE_FILL}
                      style={{ letterSpacing: 0 }}
                      x={
                        compact
                          ? -w / 2 +
                            (node.data.parents.length > 0 ? COMMENT_INDENT : 0)
                          : -node.data.caseW / 2
                      }
                      y={boxTop - topH + CASE_LINE_H / 2}
                      dy="0.32em"
                    >
                      {node.data.caseLabel}
                    </text>
                  )}

                  {node.data.commentLines.length > 0 && (
                    <text
                      textAnchor="start"
                      fontSize={COMMENT_FONT_PX}
                      fontFamily={getCodeFontFamily()}
                      fontStyle="italic"
                      fill={COMMENT_FILL}

                      style={{ letterSpacing: 0 }}
                      visibility={
                        isEditing && editing?.comment ? "hidden" : undefined
                      }

                      onClick={
                        commentEditable && !isEditing
                          ? (e) => e.stopPropagation()
                          : undefined
                      }
                      onDoubleClick={
                        commentEditable && !isEditing
                          ? (e) => {
                              e.stopPropagation();
                              openCommentEdit();
                            }
                          : undefined
                      }
                    >
                      {node.data.commentLines.map((line, j) => (
                        <tspan
                          key={j}

                          x={
                            (compact
                              ? -w / 2 +
                                (node.data.parents.length > 0
                                  ? COMMENT_INDENT
                                  : 0)
                              : -node.data.commentW / 2) + line.indent
                          }

                          y={
                            boxTop -
                            topH +
                            (floatComment
                              ? -node.data.commentBlockH
                              : node.data.caseH) +
                            (j + 0.5) * COMMENT_LINE_H
                          }
                          dy="0.32em"
                        >
                          {line.text}
                        </tspan>
                      ))}
                    </text>
                  )}

                  {node.data.commentMore &&
                    node.data.commentLines.length > 0 && (
                      <g
                        visibility={
                          isEditing && editing?.comment ? "hidden" : undefined
                        }
                      >
                        <rect
                          x={
                            (compact
                              ? -w / 2 +
                                (node.data.parents.length > 0
                                  ? COMMENT_INDENT
                                  : 0)
                              : -node.data.commentW / 2) + 1
                          }
                          y={
                            boxTop -
                            topH +
                            (floatComment
                              ? -node.data.commentBlockH
                              : node.data.caseH) +
                            3
                          }
                          width={1.5}
                          rx={0.75}

                          height={
                            node.data.commentLines.length * COMMENT_LINE_H - 6
                          }
                          fill={COMMENT_FILL}
                          opacity={0.45}
                        />
                        {(() => {
                          const mx =
                            (compact
                              ? -w / 2 +
                                (node.data.parents.length > 0
                                  ? COMMENT_INDENT
                                  : 0)
                              : -node.data.commentW / 2) + COMMENT_RULE_INDENT;
                          const my =
                            boxTop -
                            topH +
                            (floatComment
                              ? -node.data.commentBlockH
                              : node.data.caseH) +
                            (node.data.commentLines.length + 0.5) *
                              COMMENT_LINE_H;
                          const mw = measureText(
                            node.data.commentMore.label,
                            COMMENT_FONT_PX,
                            false,
                          );
                          const hot = moreHover === id;
                          const toggle = (e: React.MouseEvent) => {
                            e.stopPropagation();
                            anchorOn(id);
                            setCommentsExpanded((prev) => {
                              const next = new Set(prev);
                              if (next.has(id)) next.delete(id);
                              else next.add(id);
                              return next;
                            });
                          };
                          return (
                            <g
                              style={{ cursor: "pointer" }}
                              onMouseEnter={() => setMoreHover(id)}
                              onMouseLeave={() =>
                                setMoreHover((h) => (h === id ? null : h))
                              }
                              onClick={toggle}
                              onDoubleClick={(e) => e.stopPropagation()}
                            >
                              <title>
                                {node.data.commentMore.expanded
                                  ? "collapse this comment back to its first lines"
                                  : "show the rest of this comment"}
                              </title>

                              <rect
                                x={mx - COMMENT_MORE_PAD}
                                y={my - COMMENT_LINE_H / 2}
                                width={mw + COMMENT_MORE_PAD * 2}
                                height={COMMENT_LINE_H}
                                rx={3}
                                fill={COMMENT_FILL}
                                opacity={hot ? 0.14 : 0}
                              />
                              <text
                                textAnchor="start"
                                fontSize={COMMENT_FONT_PX}
                                fontFamily={getCodeFontFamily()}
                                fill={COMMENT_FILL}

                                style={{
                                  letterSpacing: 0,
                                  textDecorationLine: "underline",
                                  textDecorationThickness: 1,
                                  textUnderlineOffset: 2,
                                  opacity: hot ? 1 : 0.85,
                                }}
                                x={mx}
                                y={my}
                                dy="0.32em"
                              >
                                {node.data.commentMore.label}
                              </text>
                            </g>
                          );
                        })()}
                      </g>
                    )}

                  <rect
                    data-ptw-box=""
                    x={-w / 2}
                    y={boxTop}
                    width={w}
                    height={h}

                    rx={boxRx}

                    stroke={
                      accent
                        ? SEQ_STROKE
                        : (recoveredStroke ??
                          diagStroke ??
                          (node.data.proseLabel ? PROSE_FILL : style.stroke))
                    }
                    strokeWidth={
                      accent || recovered === "failed" || diagSev === 1
                        ? 2
                        : 1.5
                    }

                    // A GHOST is the tactic reduced in place, so it keeps the
                    // tactic's own stroke and corner radius and says it is a
                    // reduction with the DASH and a see-through fill —
                    // `transparent` is hit-testable where `none` is not, so
                    // the click and the `<title>` still land on it.
                    fill={nodeBoxFill(node.data)}
                    strokeDasharray={
                      recoveredStroke || isMarker ? "3 3" : undefined
                    }

                    visibility={hideForEdit ? "hidden" : undefined}
                  >
                    {isMarker ? (
                      <title>
                        {node.data.elidedCut!.seeded
                          ? `${seedTitle(
                              node.data.elidedCut!.seededBy,
                              node.data.elidedCut!.tactics.length,
                            )}\n\n${node.data.elidedCut!.tactics.join("\n")}`
                          : `${
                              node.data.elidedCut!.ghost
                                ? "skipped into the trunk"
                                : `${node.data.elidedCut!.tactics.length} ${
                                    node.data.elidedCut!.tactics.length === 1
                                      ? "tactic"
                                      : "tactics"
                                  } skipped`
                            } — click to restore\n\n${node.data.elidedCut!.tactics.join("\n")}`}
                      </title>
                    ) : (
                      taggedLines &&
                      nodeTooltip !== "" && <title>{nodeTooltip}</title>
                    )}
                  </rect>

                  {/* B2 — the introducing step, WASHED while a hypothesis it
                      bound is dwelt on. The same ink and the same reading as
                      the used-hyp wash in the other direction (`hypLitTactics`
                      lights the lines a tactic uses; this lights the tactic a
                      line came from), so no new colour enters the view. Paint
                      only: nothing here is measured. */}
                  {hypOriginHit?.tn.data.id === id && !hideForEdit && (
                    <rect
                      x={-w / 2}
                      y={boxTop}
                      width={w}
                      height={h}
                      rx={boxRx}
                      fill={HYP_LIT_FILL}
                      style={{ pointerEvents: "none" }}
                    />
                  )}

                  {isMarker && ghostMore > 0 && !hideForEdit && (
                    <g pointerEvents="none">
                      {/* THE `+N` BADGE — a pill at the box's RIGHT edge,
                          saying how many further tactics the ghost swallowed
                          beyond the one it names. Its x is the width rule in
                          `ghostSize` read backwards: the label ends
                          `BADGE_GAP` to its left, so measurer and paint are
                          the same arithmetic. Centred on the head line, which
                          for a one-line ghost is the box's own middle. */}
                      <rect
                        x={w / 2 - NODE_PAD - badgeWidth(ghostMore)}
                        y={labelTop + LINE_H / 2 - BADGE_H / 2}
                        width={badgeWidth(ghostMore)}
                        height={BADGE_H}
                        rx={BADGE_H / 2}
                        fill="var(--ptw-comment)"
                        opacity={accent || hoverId === id ? 1 : 0.75}
                      />
                      <text
                        x={w / 2 - NODE_PAD - badgeWidth(ghostMore) / 2}
                        y={labelTop + LINE_H / 2}
                        dy="0.32em"
                        textAnchor="middle"
                        fontSize={BADGE_FONT_PX}
                        fontFamily={getCodeFontFamily()}
                        fill="var(--ptw-surface)"
                        style={{ letterSpacing: 0 }}
                      >
                        {`+${ghostMore}`}
                      </text>
                    </g>
                  )}

                  {diagInk && !hideForEdit && (
                    <>
                      <clipPath id={`ptw-box-${ni}`}>
                        <rect
                          x={-w / 2}
                          y={boxTop}
                          width={w}
                          height={h}
                          rx={boxRx}
                        />
                      </clipPath>
                      <rect
                        x={-w / 2}
                        y={boxTop}
                        width={diagSelected ? RIBBON_W_SEL : RIBBON_W}
                        height={h}
                        fill={diagInk}
                        clipPath={`url(#ptw-box-${ni})`}
                        style={{ pointerEvents: "none" }}
                      />
                      <rect
                        x={-w / 2}
                        y={boxTop}
                        width={NODE_PAD}
                        height={h}
                        fill="transparent"
                        style={{ cursor: "help" }}

                        onMouseEnter={() => setHoverDiag(id)}
                        onMouseLeave={() =>
                          setHoverDiag((cur) => (cur === id ? null : cur))
                        }
                      />
                    </>
                  )}

                  {hyps && hyps.length > 0 && !hideForEdit && (
                    <HypBlock
                      lines={hyps}
                      x={-w / 2 + NODE_PAD}
                      y={contentTop}
                      width={w - 2 * NODE_PAD}
                      taggedLines={taggedHyps}
                      lit={hypLitGoalId === id}
                      markStyle={hypMarkStyle}
                      onLine={(j) =>
                        setHoverHyp(j === null ? null : `${id}\u0000${j}`)
                      }
                      lineTitle={(j) => {
                        const l = hyps[j];
                        const from = l?.originText
                          ? `introduced by \`${l.originText}\` (line ${l.originLine})`
                          : undefined;
                        // D5 — the offer lives here rather than in a glyph of
                        // its own: a context line already has a hit target and
                        // a title (B2), and a ✎ on every renamable line would
                        // put chrome on the one part of the box that is a list
                        // of the author's own words.
                        const rn = renames.get(id)?.get(j);
                        const ren = rn
                          ? `⌥-click renames \`${rn.rewrite.name}\` → \`${rn.to}\` (Mathlib's name for ${rn.rule.what})`
                          : undefined;
                        return [from, ren].filter(Boolean).join(" — ") || undefined;
                      }}
                      onLineClick={
                        renames.has(id)
                          ? (j, alt) => {
                              const rn = alt ? renames.get(id)?.get(j) : undefined;
                              if (rn) proposeRewrite(id, rn.rewrite);
                            }
                          : undefined
                      }
                    />
                  )}

                  {/* The goal's corner control, top-right (user direction).
                      `sizeOf` reserves `CORNER_W` on the top line. Folded, it is
                      `+N` over the tactics the fold took; unfolded the `−`, and
                      only that face has a preview — hovering `+N` would fade
                      nothing, since nothing it stands for is drawn. */}
                  {cuttable &&
                    !hideForEdit &&
                    (folded ? (
                      // SEEDED: the corner leans and takes COMMENT ink, the
                      // same ink the caption beside the break is written in,
                      // so "the author put this away" reads at a glance from
                      // either end of the cut. The glyph itself is unchanged
                      // — no `§` here, so `CORNER_W`'s reserve still holds.
                      <text
                        x={w / 2 - 6}
                        y={boxTop + 12}
                        textAnchor="end"
                        fontSize={BADGE_FONT_PX + 1}
                        fontFamily={getCodeFontFamily()}
                        fontStyle={folded.seeded ? "italic" : undefined}
                        fill={
                          folded.seeded ? "var(--ptw-comment)" : style.stroke
                        }
                        style={{ cursor: "pointer", letterSpacing: 0 }}
                      >
                        {`+${folded.tactics.length}`}
                      </text>
                    ) : (
                      <text
                        x={w / 2 - 8}
                        y={boxTop + 12}
                        textAnchor="middle"
                        fontSize={NODE_FONT_PX}
                        fontFamily={getCodeFontFamily()}
                        fill={style.stroke}
                        style={{ cursor: "pointer" }}
                        // Hovering the glyph fades exactly what the click
                        // would take — the skip button's preview, by the same
                        // rule and sparing the anchor (this node) for the same
                        // reason: the control under the pointer must not read
                        // disabled.
                        onMouseEnter={
                          myCut
                            ? () =>
                                setElidePreview({
                                  anchor: id,
                                  ids: cutExtentIds(myCut),
                                  from: "bar",
                                })
                            : undefined
                        }
                        onMouseLeave={
                          myCut
                            ? () =>
                                setElidePreview((pv) =>
                                  pv?.anchor === id && pv.from === "bar"
                                    ? null
                                    : pv,
                                )
                            : undefined
                        }
                      >
                        −
                      </text>
                    ))}

                  {taggedLines ? (
                    <foreignObject
                      x={-w / 2 + NODE_PAD}
                      y={labelTop}
                      width={w - 2 * NODE_PAD}
                      height={lines.length * LINE_H}
                      style={{ overflow: "visible" }}
                      visibility={hideForEdit ? "hidden" : undefined}
                    >
                      <div
                        style={{
                          fontFamily: getCodeFontFamily(),
                          fontSize: NODE_FONT_PX,
                          lineHeight: `${LINE_H}px`,
                          letterSpacing: 0,
                          whiteSpace: "pre",
                          color: NODE_TEXT,
                        }}
                      >
                        {taggedLines.map((line, j) => (
                          <div
                            key={j}

                            data-ptw-lineidx={j}

                            onClick={
                              rowKeys?.[j] ? (e) => toggleRow(e, j) : undefined
                            }
                            onDoubleClick={
                              rowKeys?.[j]
                                ? (e) => e.stopPropagation()
                                : undefined
                            }
                            onMouseEnter={
                              rowKeys?.[j]
                                ? () => setMoreHover(rowKeys[j])
                                : undefined
                            }
                            onMouseLeave={
                              rowKeys?.[j]
                                ? () =>
                                    setMoreHover((h) =>
                                      h === rowKeys[j] ? null : h,
                                    )
                                : undefined
                            }
                            title={rowKeys?.[j] ? rowTitle(j) : undefined}
                            style={{
                              height: LINE_H,

                              paddingLeft: lines[j].indent,
                              ...(rowKeys?.[j]
                                ? {
                                    position: "relative" as const,
                                    cursor: "pointer",

                                    backgroundColor:
                                      moreHover === rowKeys[j]
                                        ? `color-mix(in srgb, ${style.stroke} 16%, transparent)`
                                        : chainOpen.has(rowKeys[j])
                                          ? `color-mix(in srgb, ${style.stroke} 9%, transparent)`
                                          : undefined,
                                    borderRadius: 3,
                                  }
                                : null),
                            }}
                          >
                            {rowKeys?.[j] ? (
                              <span
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  top: 0,
                                  color: style.stroke,
                                  opacity: 0.9,
                                }}
                              >
                                {chainOpen.has(rowKeys[j]) ? "−" : "+"}
                              </span>
                            ) : null}
                            {line}
                          </div>
                        ))}
                      </div>
                    </foreignObject>
                  ) : (
                    <text
                      textAnchor="start"
                      fontSize={NODE_FONT_PX}
                      fontFamily={getCodeFontFamily()}

                      fontStyle={
                        node.data.proseLabel ||
                        // A ghost leans for the author's sentence (`.none`)
                        // and for any SEEDED cut — `ghostSize` measures it
                        // italic under exactly the same test.
                        (isMarker &&
                          (!!node.data.elidedCut?.note ||
                            !!node.data.elidedCut?.seeded))
                          ? "italic"
                          : undefined
                      }

                      fill={
                        node.data.proseLabel
                          ? PROSE_FILL
                          : // A B4 TRACE LEAF is not the author's text — it is
                            // the elaborator's report — so it reads in comment
                            // ink inside its dashed box, the same voice a
                            // ghost speaks in.
                            isMarker || node.data.traceLeaf
                            ? accent
                              ? SEQ_STROKE
                              : "var(--ptw-comment)"
                            : NODE_TEXT
                      }

                      opacity={
                        isMarker && !(accent || hoverId === id)
                          ? 0.75
                          : undefined
                      }

                      style={{ letterSpacing: 0 }}

                      xmlSpace="preserve"
                      visibility={hideForEdit ? "hidden" : undefined}
                    >
                      {lines.map((line, j) => (
                        <tspan
                          key={j}

                          x={-w / 2 + NODE_PAD + line.indent}
                          y={labelTop + (j + 0.5) * LINE_H}
                          dy="0.32em"
                        >
                          {line.text}
                        </tspan>
                      ))}
                    </text>
                  )}

                  {briefPreviewOn &&
                    type === "tactic" &&
                    !hideForEdit &&
                    !node.data.proseLabel &&
                    !node.data.ledger &&
                    !node.data.elidedCut &&
                    !node.data.synthetic &&
                    (() => {
                      const label = node.data.label;
                      const c = collapseLabel(label, node.data.branch?.form);
                      if (!c) return null;
                      const offs = lineOffsets(
                        label,
                        lines.map((l) => l.text),
                      );
                      if (!offs) return null;

                      const gaps: [number, number][] = [];
                      let pos = 0;
                      for (const k of c.keep) {
                        if (k.srcAt > pos) gaps.push([pos, k.srcAt]);
                        pos = Math.max(pos, k.srcAt + k.len);
                      }
                      if (pos < label.length) gaps.push([pos, label.length]);
                      const rects: ReactNode[] = [];
                      gaps.forEach(([ga, gb], gi) => {
                        offs.forEach(([lo, hi], j) => {
                          let a = Math.max(ga, lo);
                          let b = Math.min(gb, hi);
                          while (a < b && " \n".includes(label[a])) a++;
                          while (b > a && " \n".includes(label[b - 1])) b--;
                          if (a >= b) return;
                          rects.push(
                            <rect
                              key={`${gi}:${j}`}
                              x={
                                -w / 2 +
                                NODE_PAD +
                                lines[j].indent +
                                measureText(label.slice(lo, a), NODE_FONT_PX)
                              }

                              y={
                                labelTop +
                                (j + 0.5) * LINE_H +
                                0.32 * NODE_FONT_PX +
                                2
                              }
                              width={measureText(
                                label.slice(a, b),
                                NODE_FONT_PX,
                              )}
                              height={1.2}
                              fill="var(--ptw-comment)"
                            />,
                          );
                        });
                      });
                      return <g style={{ pointerEvents: "none" }}>{rects}</g>;
                    })()}

                  {rowKeys && !taggedLines && !hideForEdit && (
                    <g>
                      {rowKeys.map((key, j) =>
                        key === null ? null : (
                          <text
                            key={`g${j}`}
                            textAnchor="start"
                            fontSize={NODE_FONT_PX}
                            fontFamily={getCodeFontFamily()}
                            fill={style.stroke}
                            opacity={0.9}
                            style={{ letterSpacing: 0 }}
                            x={-w / 2 + NODE_PAD}
                            y={labelTop + (j + 0.5) * LINE_H}
                            dy="0.32em"
                          >
                            {chainOpen.has(key) ? "−" : "+"}
                          </text>
                        ),
                      )}
                      {rowKeys.map((key, j) =>
                        key === null ? null : (
                          <rect
                            key={j}
                            x={-w / 2 + NODE_PAD}
                            y={labelTop + j * LINE_H}
                            width={w - 2 * NODE_PAD}
                            height={LINE_H}
                            rx={3}
                            fill={style.stroke}
                            opacity={
                              moreHover === key
                                ? 0.16
                                : chainOpen.has(key)
                                  ? 0.09
                                  : 0
                            }
                            style={{ cursor: "pointer" }}
                            onMouseEnter={() => setMoreHover(key)}
                            onMouseLeave={() =>
                              setMoreHover((h) => (h === key ? null : h))
                            }
                            onClick={(e) => toggleRow(e, j)}
                            onDoubleClick={(e) => e.stopPropagation()}
                          >
                            <title>{rowTitle(j)}</title>
                          </rect>
                        ),
                      )}
                    </g>
                  )}

                  {(type === "goal" ||
                    node.data.synthetic ||
                    (type === "tactic" && node.data.addLink)) &&
                    (node.data.addSpec || node.data.addLink) &&
                    onAddTactic &&
                    !isEditing && (
                      <g
                        transform={`translate(${
                          -w / 2 +
                          TRUNK_INSET +
                          (drawnParentIds.has(id) ? CHIP_W_ADD / 2 + 6 : 0)
                        }, ${boxTop + h + CHIP_TOP_GAP})`}
                      >
                        {picking?.id === id ? (
                          <PickerRow
                            options={picking.options}
                            onCancel={() => setPicking(null)}
                            onPick={(o) => {
                              const kind = picking.kind;
                              const spec: AddSpec = {
                                ...picking.spec,
                                rel: o.rel,
                              };
                              setPicking(null);

                              if (kind === "open" || kind === "first") {
                                startChain(id, spec, o.rel, o.same);
                                return;
                              }
                              setEditing({
                                id,
                                pos: spec.after,
                                original: "",
                                value: CLOSE_RHS,
                                add: spec,
                              });
                            }}
                          />
                        ) : (
                          <>
                            {node.data.addSpec && (
                              <>
                                <FrontierChip
                                  glyph={addChipGlyph(node.data.addSpec)}
                                  title={
                                    node.data.addSpec.kind === "hole"
                                      ? "fill this hole in place — what you type replaces the `?_` where it sits"
                                      : "add a tactic for this goal"
                                  }

                                  x={chipLaneXs(node.data.addSpec)[0]}
                                  width={addChipWidth(node.data.addSpec)}
                                  color={NODE_STYLES.tactic.stroke}
                                  onPick={() => {
                                    const spec = node.data.addSpec!;
                                    setEditing({
                                      id,
                                      pos: spec.after,
                                      original: "",
                                      value: "",
                                      add: spec,
                                    });
                                  }}
                                />
                                <FrontierChip
                                  glyph="sorry"
                                  title="stub this goal with `sorry`"
                                  x={chipLaneXs(node.data.addSpec)[1]}
                                  width={CHIP_W_SORRY}
                                  fontSize={9}
                                  color={SORRY_FILL}

                                  onPick={() => {
                                    anchorOn(id);
                                    onAddTactic(node.data.addSpec!, "sorry");
                                  }}
                                />
                              </>
                            )}

                            {node.data.calcRels && (
                              <FrontierChip
                                glyph="calc"

                                title={
                                  node.data.calcRels.length > 1
                                    ? `start a calc chain — pick its relation (${node.data.calcRels
                                        .map((o) => o.rel)
                                        .join(
                                          " ",
                                        )}); writes one line, \`calc _ … _ := by sorry\`, then asks for each side`
                                    : `start a calc chain — writes \`calc _ ${node.data.calcRels[0].rel} _ := by sorry\`, then asks for each side (Enter keeps \`_\`)`
                                }
                                x={chipLaneXs(node.data.addSpec)[2]}
                                width={CHIP_W_STEP}
                                fontSize={9}
                                color={NODE_STYLES.tactic.stroke}
                                onPick={() => {
                                  const options = node.data.calcRels!;
                                  const spec = node.data.addSpec!;

                                  if (options.length > 1) {
                                    setPicking({
                                      id,
                                      kind: "open",
                                      spec,
                                      options,
                                    });
                                    return;
                                  }
                                  startChain(
                                    id,
                                    spec,
                                    options[0].rel,
                                    options[0].same,
                                  );
                                }}
                              />
                            )}

                            {node.data.addLink && (
                              <FrontierChip
                                glyph="step"
                                title={
                                  node.data.addLink.chain?.broken
                                    ? node.data.addLink.kind === "calc-first"
                                      ? `write this \`calc\` block's first link, then fill in each side. Until it has one it does not parse, which is why the rest of this proof is missing`
                                      : `finish the \`calc\` block: add its next ${node.data.addLink.rel} link. Until then it does not parse, which is why the rest of this proof is missing`
                                    : node.data.addLink.kind === "calc-append"
                                      ? (node.data.addLink.rels?.length ?? 0) >
                                        1
                                        ? `add the next link to this chain — pick its relation (${node.data.addLink
                                            .rels!.map((o) => o.rel)
                                            .join(
                                              " ",
                                            )}); \`${node.data.addLink.rel}\` closes the chain, anything else adds a step and leaves it open`
                                        : `close this chain with a \`${node.data.addLink.rel}\` link — type its right-hand side, or keep the \`_\` to end it here`
                                      : "add a calc step above this link — the new link appears above this box, and this one closes the remainder; type its right-hand side"
                                }

                                x={
                                  chipLaneXs(node.data.addSpec)[
                                    node.data.addSpec ? 2 : 0
                                  ]
                                }
                                width={CHIP_W_STEP}
                                fontSize={9}
                                color={NODE_STYLES.tactic.stroke}
                                onPick={() => {
                                  const spec = node.data.addLink!;
                                  const options = spec.rels;
                                  const kind =
                                    spec.kind === "calc-append"
                                      ? "append"
                                      : spec.kind === "calc-first"
                                        ? "first"
                                        : "link";
                                  if (options && options.length > 1) {
                                    setPicking({ id, kind, spec, options });
                                    return;
                                  }

                                  if (kind === "first") {
                                    startChain(
                                      id,
                                      spec,
                                      spec.rel ?? "=",
                                      spec.rels?.[0]?.same ?? true,
                                    );
                                    return;
                                  }
                                  setEditing({
                                    id,
                                    pos: spec.after,
                                    original: "",
                                    value: CLOSE_RHS,
                                    add: spec,
                                  });
                                }}
                              />
                            )}
                          </>
                        )}
                      </g>
                    )}

                  {splits.has(id) && !isEditing && (
                    <g transform={`translate(0,${boxTop + h + 5})`}>
                      <GalleryPager
                        index={shownChild.get(id)!}
                        count={splits.get(id)!.length}
                        label={
                          nodes.find(
                            (n) =>
                              n.data.id ===
                              splits.get(id)![shownChild.get(id)!],
                          )?.data.caseLabel ?? ""
                        }
                        x={-w / 2 + TRUNK_INSET + 8}
                        onStep={(d) =>
                          setPick((prev) => ({
                            ...prev,
                            [id]: (prev[id] ?? 0) + d,
                          }))
                        }
                      />
                    </g>
                  )}

                  {/* THE TOUR TAB: the stop's place in the reading, in a
                      small rounded pill STRADDLING the box's top-left corner
                      — half of it outside the box on each axis. Hung clear of
                      the LEFT edge first, at the box's mid-height, it reached
                      into the neighbouring column in side-by-side: 33
                      collisions over `probe overlap`'s 730 layouts, 0 at the
                      corner. PAINT — it reserves nothing, exactly like the
                      hop caption — so the probe models this rect against
                      every node box and the width lives in layout.ts
                      (`tourTabWidth`), one coding for measurer and renderer.
                      Comment ink for the author's stops, the selection accent
                      for your own; the stop being read is FILLED. */}
                  {tab && !hideForEdit && (
                    <g
                      style={{ cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (tabMine && e.altKey) toggleMyStop(id);
                        else goToTab(id);
                      }}
                    >
                      <title>
                        {tabMine
                          ? `Mark ${tab.n} of ${tabStops.length} (temporary) — click to go, ⌥-click to remove`
                          : `Mark ${tab.n} of ${tabStops.length} (source) — click to go`}
                      </title>
                      <rect
                        x={-w / 2 - tabW / 2}
                        y={boxTop - BADGE_H / 2}
                        width={tabW}
                        height={BADGE_H}
                        rx={3}
                        fill={tabOn ? tabInk : "var(--ptw-surface)"}
                        stroke={tabInk}
                      />
                      <text
                        x={-w / 2}
                        y={boxTop}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={BADGE_FONT_PX}
                        fontFamily={tabFont}
                        fill={tabOn ? "var(--ptw-surface)" : tabInk}
                      >
                        {tab.n}
                      </text>
                    </g>
                  )}

                  {/* …and the nub, where that tab would stand — drawn only
                      while the pointer is in the CORNER REGION, which is the
                      invisible rect below and carries both the hover and the
                      click. `fill="transparent"` (not `none`, which is not
                      hit-testable in SVG) plus `pointerEvents="all"`, so the
                      pointer can reach it across the part of it that lies
                      outside the box, where there is nothing else to hit. */}
                  {nubHere && !hideForEdit && (
                    <rect
                      data-ptw-nub
                      style={{ cursor: "pointer" }}
                      pointerEvents="all"
                      x={-w / 2 - nubW / 2 - NUB_SLACK}
                      y={boxTop - BADGE_H / 2 - NUB_SLACK}
                      width={nubW + 2 * NUB_SLACK}
                      height={BADGE_H + 2 * NUB_SLACK}
                      fill="transparent"
                      onMouseEnter={() => setNubHoverId(id)}
                      onMouseMove={() => setNubHoverId(id)}
                      onMouseLeave={() =>
                        setNubHoverId((cur) => (cur === id ? null : cur))
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        setNubHoverId(null);
                        // The CORNER carries both marks now that the hover
                        // bar's ⚑ is gone (user direction, 2026-09-08): plain
                        // click drops the reader's temporary mark, ⌥-click
                        // writes `-- .mark` into the source through the same
                        // `flagLine` the flag chips use, where the node can
                        // take one.
                        if (e.altKey && markWritable) writeMark(id);
                        else toggleMyStop(id);
                      }}
                    >
                      <title>
                        {markWritable
                          ? "Drop a mark here — ⌥-click writes `.mark` into the source"
                          : "Drop a mark here — `<` and `>` read the marks"}
                      </title>
                    </rect>
                  )}
                  {nubShown && !hideForEdit && (
                    <rect
                      pointerEvents="none"
                      x={-w / 2 - nubW / 2}
                      y={boxTop - BADGE_H / 2}
                      width={nubW}
                      height={BADGE_H}
                      rx={3}
                      fill="none"
                      stroke={SEQ_STROKE}
                      strokeDasharray="2 2"
                      opacity={0.6}
                    />
                  )}

                  {hasBar && (hoverId === id || isArming) && (
                    <NodeActionBar
                      placement={type === "tactic" ? "right" : "top-right"}

                      x={w / 2 - BAR_OVERLAP}
                      y={type === "tactic" ? boxTop + h / 2 : boxTop}
                      actions={[
                        // NO ⚑ (user direction, 2026-09-08): the corner nub
                        // already offers both gestures — plain click for a
                        // temporary mark, ⌥-click for the source's `.mark` —
                        // and the hover bar was the second way to reach one
                        // position.
                        ...(barLinkPlus
                          ? [
                              {
                                glyph: "+",
                                title:
                                  "Show the goal this step proves, above it (also: click its ledger row)",
                                onClick: () => {
                                  const lp = linkPlus.get(id)!;
                                  anchorOn(id);
                                  setChainOpen((prev) =>
                                    new Set(prev).add(lp.key),
                                  );
                                },
                              },
                            ]
                          : []),

                        // B4 — WHAT DID `simp` USE? The `⁇` is the tactic's
                        // own `?` form said twice: the affordance and the
                        // mechanism are the same character, and it is a
                        // question, which is what the reader is asking.
                        ...(automation
                          ? [
                              {
                                glyph: traceIsBusy ? "…" : "⁇",
                                title: traceIsBusy
                                  ? "Asking the server what this step used…"
                                  : traceIsOpen
                                    ? `Hide what \`${node.data.trace?.tactic ?? "this"}\` used`
                                    : "Show what this step used — the declaration is re-elaborated with the tactic's `?` form and its `Try this` read back",
                                onClick: () => toggleTrace(id),
                              },
                            ]
                          : []),

                        ...(elidable
                          ? [
                              {
                                glyph: "skip",
                                icon: <SkipIcon />,
                                title: isCombined
                                  ? "Skip this run (⌥-click) — the whole run collapses to one dashed box (click it to restore)"
                                  : hasChildren
                                    ? "Skip this step (⌥-click) — the goal above hops over it and wears +N; the break on the line names what went (click either to restore)"
                                    : "Skip this closing step (⌥-click) — the goal above folds and wears +N (click it to restore)",
                                onClick: () =>
                                  isCombined
                                    ? elideCombined(id)
                                    : elideStep(id),
                                onHover: (on: boolean) => {
                                  if (on) {
                                    const p = elidePreviewFor(id);
                                    if (p)
                                      setElidePreview({ ...p, from: "bar" });
                                  } else {
                                    setElidePreview((p) =>
                                      p?.anchor === id && p.from === "bar"
                                        ? null
                                        : p,
                                    );
                                  }
                                },
                              },
                            ]
                          : []),
                        ...(goalRevealable
                          ? [
                              {
                                glyph: "»",
                                title: `Reveal in source (${CMD}-click)`,
                                onClick: () => revealAt(position!),
                              },
                            ]
                          : []),
                        ...(focusable
                          ? [
                              {
                                glyph: "◎",
                                title: "Focus this subtree (⌥-click)",
                                onClick: () => focusOn(id),
                              },
                            ]
                          : []),
                        ...(isFocusRoot
                          ? [
                              {
                                glyph: "◎",
                                title:
                                  "Back to the whole proof (⌥-click, or Esc)",
                                onClick: exitFocus,
                              },
                            ]
                          : []),
                        ...(pathable
                          ? [
                              {
                                glyph: "⊹",
                                glyphPx: PATH_GLYPH_PX,
                                title:
                                  "Only this path: hide everything not on the way from the root to here, and everything not under it",
                                onClick: () => pathOn(id),
                              },
                            ]
                          : []),
                        ...(isPathRoot
                          ? [
                              {
                                glyph: "⊹",
                                glyphPx: PATH_GLYPH_PX,
                                title: "Show the whole proof again (or Esc)",
                                onClick: exitPath,
                              },
                            ]
                          : []),
                        ...(popoutable
                          ? [
                              {
                                glyph: "⧉",

                                title: "Open in lens",
                                onClick: () =>
                                  onPopoutEdit!(
                                    getTacticEdit?.(actPos!)?.pos ?? actPos!,
                                  ),
                              },
                            ]
                          : []),

                        // D1 — RESTRUCTURING. `⤵` puts a `have` down into
                        // its one use, `⤴` lifts a `(by …)` out into a
                        // `have`: the arrows point the way the text moves,
                        // and they are the same glyph mirrored because the
                        // two moves are inverse. Neither writes anything on
                        // its own — the click opens a PROPOSAL, and the
                        // elaborator decides whether it can be taken.
                        ...(inlinable && !proposing
                          ? [
                              {
                                glyph: "⤵",
                                title: `Inline \`${rw!.inline!.name}\` into the one step that uses it — the elaborator is asked first`,
                                onClick: () =>
                                  proposeRewrite(id, rw!.inline!),
                                onHover: (on: boolean) =>
                                  onPreviewRange?.(
                                    on
                                      ? {
                                          start: rw!.inline!.edits[0].range.start,
                                          stop: rw!.inline!.edits[0].range.end,
                                        }
                                      : null,
                                  ),
                              },
                            ]
                          : []),
                        ...(extractable && !proposing
                          ? [
                              {
                                glyph: "⤴",
                                title:
                                  "Hoist the `(by …)` out as `have this : … := by …` on the line above — the elaborator is asked first",
                                onClick: () =>
                                  proposeRewrite(id, rw!.extract!),
                              },
                            ]
                          : []),

                        // D2 — the two automation moves, drawn as the double
                        // arrows the single ones already established: `⇓`
                        // takes a RUN down to one tactic, `⇑` brings what
                        // that tactic used back up into the source. Neither
                        // writes; both open the same proposal pill.
                        ...(collapsible && !proposing
                          ? [
                              {
                                glyph: "⇓",
                                title: `Collapse ${run!.steps.length} steps to one automation tactic — ${AUTOMATION_CANDIDATES.join(", ")} are tried in that order and the first that closes the goal is offered`,
                                onClick: () => proposeCollapse(id, run!),
                                onHover: (on: boolean) => {
                                  const ext = collapseRewrite(
                                    run!,
                                    collapseCtx!,
                                    "omega",
                                  );
                                  onPreviewRange?.(
                                    on && ext.ok
                                      ? {
                                          start: ext.rewrite.edits[0].range.start,
                                          stop: ext.rewrite.edits[0].range.end,
                                        }
                                      : null,
                                  );
                                },
                              },
                            ]
                          : []),
                        ...(expandable && !proposing
                          ? [
                              {
                                glyph: "⇑",
                                title: node.data.trace
                                  ? `Write what \`${node.data.trace.tactic}\` used into the source, in core's own words`
                                  : "Write what this automation used into the source — its lemmas are read back first, in core's own words",
                                onClick: () => proposeExpand(id),
                              },
                            ]
                          : []),

                        // D4 — FIX THE LINT. `✎` is the pencil the reader
                        // already reads as "write this for me", and it is
                        // offered only where a lint on this node HAS a
                        // one-edit answer. Like every other D move it writes
                        // nothing: the click opens the same proposal pill,
                        // and the elaborator decides.
                        ...(lintable && !proposing
                          ? [
                              {
                                glyph: "✎",
                                title: `${lintable.title.charAt(0).toUpperCase()}${lintable.title.slice(1)} — the elaborator is asked first`,
                                onClick: () => proposeLintFix(id),
                              },
                            ]
                          : []),

                        ...(deletable && !isArming
                          ? [
                              {
                                glyph: "delete",
                                icon: <TrashIcon />,
                                danger: true,
                                title:
                                  type === "goal"
                                    ? "Delete this goal's proof"
                                    : isCombined
                                      ? "Delete this run of tactics"
                                      : "Delete this tactic",
                                onClick: () => {
                                  setDeletePreview(null);
                                  setArming({
                                    id,

                                    spec:
                                      node.data.deleteSpec ?? delSpecs.get(id)!,
                                  });
                                },
                                // Hovering the can fades exactly what it takes
                                // — the ◌ preview's rule, over the delete
                                // extent instead of the cut's members.
                                onHover: (on: boolean) => {
                                  if (on)
                                    setDeletePreview({
                                      anchor: id,
                                      ids: extentIds(delExtent!, id),
                                    });
                                  else
                                    setDeletePreview((pv) =>
                                      pv?.anchor === id ? null : pv,
                                    );
                                },
                              },
                            ]
                          : []),
                      ]}
                    />
                  )}
                </g>
              );
            })}

            {/* B2 — THE PROVENANCE CONNECTOR. Drawn ABOVE every node so it
                reads as one continuous line from the hypothesis to the step
                that bound it, dashed and in comment ink so it is plainly an
                annotation rather than an edge of the proof. It leaves the hyp
                line at its LEFT edge, runs out to a channel clear of both
                boxes, and comes back in at the introducing box's left edge —
                one elbow each end, never through a node. `pointerEvents` none
                and no measurement: the layout does not know it exists. */}
            {hypOriginHit &&
              (() => {
                const { gn, lines, j, tn } = hypOriginHit;
                const gTop = (bandTopH(gn.data) - gn.data.h) / 2;
                const x0 = gn.x - gn.data.w / 2 + NODE_PAD;
                const y0 =
                  gn.y + gTop + NODE_PAD_Y + hypLineOffset(lines, j);
                const bLeft = tn.x - tn.data.w / 2;
                const bTop = tn.y + (bandTopH(tn.data) - tn.data.h) / 2;
                const y1 = bTop + tn.data.h / 2;
                const ex = Math.min(x0, bLeft) - ORIGIN_CHANNEL;
                return (
                  <g style={{ pointerEvents: "none" }}>
                    <path
                      fill="none"
                      stroke="var(--ptw-comment)"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      opacity={0.9}
                      d={`M${x0},${y0} H${ex} V${y1} H${bLeft}`}
                    />
                    <circle
                      cx={x0}
                      cy={y0}
                      r={1.8}
                      fill="var(--ptw-comment)"
                    />
                  </g>
                );
              })()}

            {arming &&
              (() => {
                const an = placed.get(arming.id);
                const ext = armExtent;
                if (!an || !ext) return null;
                const { w, h } = an.data;

                const boxTop = (bandTopH(an.data) - h) / 2;

                const label = ext.empties
                  ? `replace ${ext.lines} with sorry`
                  : `delete ${ext.lines} line${ext.lines === 1 ? "" : "s"}`;
                const wide = chipWidth(label, CHIP_FONT_PX);
                const x0 = -CHIP_W_ADD / 2;
                const rowW = wide + CHIP_GAP + CHIP_W_ADD;

                const shift = drawnParentIds.has(arming.id)
                  ? CHIP_W_ADD / 2 + 6 + CARD_PAD
                  : 0;
                return (
                  <g
                    transform={`translate(${
                      an.x - w / 2 + TRUNK_INSET + shift
                    }, ${an.y + boxTop + h + CHIP_TOP_GAP})`}
                  >
                    <rect
                      x={x0 - CARD_PAD}
                      y={-CARD_PAD}
                      width={rowW + 2 * CARD_PAD}
                      height={CHIP_H + 2 * CARD_PAD}
                      rx={4}
                      fill="var(--ptw-surface)"
                      stroke="var(--vscode-editorWidget-border, rgba(128,128,128,0.35))"
                      strokeWidth={1}
                      style={{
                        filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.35))",
                      }}
                    />
                    <FrontierChip
                      glyph={label}
                      title={`Confirm — ${CMD}Z in the editor undoes it`}
                      x={x0}
                      width={wide}
                      color={DANGER_FILL}
                      fontSize={CHIP_FONT_PX}

                      solid
                      fontFamily={getCodeFontFamily()}

                      onPick={() => commitDelete(arming.id, arming.spec)}
                    />
                    <FrontierChip
                      glyph="×"
                      title="Cancel"
                      x={x0 + wide + CHIP_GAP}
                      width={CHIP_W_ADD}
                      color="var(--ptw-comment)"
                      fontFamily={getCodeFontFamily()}
                      onPick={() => setArming(null)}
                    />
                  </g>
                );
              })()}

            {/* D1 — THE PROPOSAL PILL. The armed delete's pill, in the same
                place and the same idiom, because a rewrite is the same kind
                of promise: it says what will happen, it says whether the
                elaborator agreed, and nothing is written until the reader
                clicks it. `checking…` while the RPC is out; then the move,
                how much shorter the proof gets and `✓ elaborates`, or `✗`
                with the first error's first line. */}
            {proposal &&
              (() => {
                const an = placed.get(proposal.id);
                if (!an) return null;
                const { w, h } = an.data;
                const boxTop = (bandTopH(an.data) - h) / 2;
                const d = proposal.delta ?? 0;
                const shorter =
                  d > 0
                    ? `${d} step${d === 1 ? "" : "s"} fewer`
                    : d < 0
                      ? `${-d} step${d === -1 ? "" : "s"} more`
                      : "same length";
                // A COLLAPSE has no title until the server names the tactic
                // that closed the run, so while it is out the pill says what
                // is being asked (`proposal.title`) and the answer replaces
                // it with the move itself.
                const said = proposal.title ?? proposal.rewrite.title;
                // An EXPAND is not about length — it writes out what the
                // automation used and the proof is the same proof — so it
                // does not carry the step-count clause the other three do.
                // …and neither is a LINT FIX: `write \`·\` for the focusing
                // dot → same length` was true and beside the point. Only the
                // moves that claim to shorten the proof carry the clause.
                const lenClause =
                  proposal.kind === "expand" ||
                  proposal.kind === "rename" ||
                  proposal.kind === "lint"
                    ? ""
                    : ` → ${shorter}`;
                const label =
                  proposal.phase === "checking"
                    ? `${said} — asking the elaborator…`
                    : proposal.phase === "ok"
                      ? `${proposal.rewrite.title}${lenClause} · ✓ elaborates`
                      : `✗ ${(proposal.message ?? "it does not check").slice(0, 72)}`;
                const live = proposal.phase === "ok";
                const wide = chipWidth(label, CHIP_FONT_PX);
                const x0 = -CHIP_W_ADD / 2;
                const rowW = wide + CHIP_GAP + CHIP_W_ADD;
                const shift = drawnParentIds.has(proposal.id)
                  ? CHIP_W_ADD / 2 + 6 + CARD_PAD
                  : 0;
                return (
                  <g
                    transform={`translate(${
                      an.x - w / 2 + TRUNK_INSET + shift
                    }, ${an.y + boxTop + h + CHIP_TOP_GAP})`}
                  >
                    <rect
                      x={x0 - CARD_PAD}
                      y={-CARD_PAD}
                      width={rowW + 2 * CARD_PAD}
                      height={CHIP_H + 2 * CARD_PAD}
                      rx={4}
                      fill="var(--ptw-surface)"
                      stroke="var(--vscode-editorWidget-border, rgba(128,128,128,0.35))"
                      strokeWidth={1}
                      style={{
                        filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.35))",
                      }}
                    />
                    <FrontierChip
                      glyph={label}
                      title={
                        (proposal.why ? `Proposed: ${proposal.why}\n` : "") +
                        (live
                          ? `Write it — ${CMD}Z in the editor undoes it`
                          : proposal.phase === "checking"
                            ? "The declaration is being re-elaborated with this rewrite spliced in"
                            : "The elaborator rejected this rewrite; nothing was written")
                      }
                      x={x0}
                      width={wide}
                      color={live ? SEQ_STROKE : "var(--ptw-comment)"}
                      fontSize={CHIP_FONT_PX}
                      solid={live}
                      fontFamily={getCodeFontFamily()}
                      onPick={() => {
                        if (!live) return;
                        onApplyRewrite?.(
                          proposal.rewrite.edits,
                          proposal.rewrite.kind === "extract"
                            ? proposal.rewrite.renameAt
                            : undefined,
                        );
                        setProposal(null);
                      }}
                    />
                    <FrontierChip
                      glyph="×"
                      title="Cancel"
                      x={x0 + wide + CHIP_GAP}
                      width={CHIP_W_ADD}
                      color="var(--ptw-comment)"
                      fontFamily={getCodeFontFamily()}
                      onPick={() => setProposal(null)}
                    />
                  </g>
                );
              })()}

            {seamEl}

            {marquee && (
              <rect
                x={Math.min(marquee.x0, marquee.x1)}
                y={Math.min(marquee.y0, marquee.y1)}
                width={Math.abs(marquee.x1 - marquee.x0)}
                height={Math.abs(marquee.y1 - marquee.y0)}
                fill={SEQ_STROKE}
                fillOpacity={0.08}
                stroke={SEQ_STROKE}
                strokeWidth={1}
                strokeDasharray="4 3"
                pointerEvents="none"
              />
            )}

            {selectionPillEl}
            {flagPromptEl}
            {cfStubEl}

            {hoverDiag &&
              (() => {
                const dn = placed.get(hoverDiag);
                const list = diag?.byNode.get(hoverDiag);
                if (!dn || !list || list.length === 0) return null;
                const { w, h } = dn.data;
                const boxTop = (bandTopH(dn.data) - h) / 2;
                return (
                  <foreignObject
                    x={dn.x - w / 2 + NODE_PAD}
                    y={dn.y + boxTop + h + 4}
                    width={1}
                    height={1}
                    style={{ overflow: "visible", pointerEvents: "none" }}
                  >
                    <div
                      style={{
                        ...POPUP_CHROME,
                        width: "max-content",
                        maxWidth: 460,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        borderWidth: 1,
                        borderStyle: "solid",
                        borderColor: diagInkOf(list[0].severity),
                      }}
                    >
                      {list.map((d) => (
                        <div
                          key={d.key}
                          style={{
                            display: "flex",
                            gap: 7,
                            alignItems: "baseline",
                          }}
                        >
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontSize: 15,
                              lineHeight: "15px",
                              color: diagInkOf(d.severity),
                            }}
                          >
                            {diagGlyphOf(d.severity)}
                          </span>
                          <span
                            style={{
                              fontFamily: getCodeFontFamily(),
                              fontSize: 11,
                              lineHeight: "15px",
                              whiteSpace: "pre-wrap",

                              color: "var(--vscode-icon-foreground, #2d3748)",
                            }}
                          >
                            {d.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </foreignObject>
                );
              })()}

            {editing &&
              (() => {
                const en = placed.get(editing.id);
                if (!en) return null;
                const { w, h } = en.data;

                const topH = bandTopH(en.data);
                const boxTop = (topH - h) / 2;

                const proseEdit = !!editing.comment && !!en.data.proseLabel;

                const overlayY = proseEdit
                  ? boxTop
                  : editing.comment
                    ? boxTop -
                      topH +
                      (en.data.commentFloats
                        ? -en.data.commentBlockH
                        : en.data.caseH) -
                      NODE_PAD_Y
                    : editing.add || editing.calcStage
                      ? boxTop + h + 4
                      : boxTop;
                const valueLines = editing.value.split("\n");

                // A REPLACE STANDS IN FOR THE BOX, so at edit start — where
                // the draft IS the label — its rect must BE the box's rect,
                // and that is an arithmetic identity, not a tolerance: the
                // textarea's border + padding is exactly the box's own text
                // inset (2 + 10 = NODE_PAD across, 2 + 3 = NODE_PAD_Y down),
                // so `measureText(draft) + 2 * NODE_PAD` is `sizeOf`'s own
                // width rule and comes out equal. What broke it was a floor
                // and a slack the box knows nothing about: a 320px minimum and
                // a spare 12px, which on a narrow tactic (`rw [ih]`, measured
                // at 74.6px) opened a 320px editor — the reported "smaller but
                // wider". Both belong to the overlays that stand in for NO
                // box: the (+) add, the calc stage, and a comment STRIP, whose
                // text is not the node's.
                //
                // In NARRATION mode the prose IS the box — drawn at the node's
                // own metrics (NODE_FONT_PX italic, LINE_H) by proseLabelSize
                // — so a comment edit there stands in for the box exactly as a
                // tactic replace does: no floor, no slack, the box's metrics.
                // Applying the strip's (COMMENT_FONT_PX 11, COMMENT_LINE_H 18)
                // there was the reported "smaller text in a wider box".
                const standsInForBox =
                  !editing.add &&
                  !editing.calcStage &&
                  (!editing.comment || proseEdit);
                const editFontPx =
                  editing.comment && !proseEdit
                    ? COMMENT_FONT_PX
                    : NODE_FONT_PX;
                const editLineH =
                  editing.comment && !proseEdit ? COMMENT_LINE_H : LINE_H;
                const fw = Math.max(
                  w,
                  standsInForBox ? 0 : 320,
                  ...valueLines.map(
                    (l) =>
                      measureText(l, editFontPx, !!editing.comment) +
                      2 * NODE_PAD +
                      (standsInForBox ? 0 : 12),
                  ),
                );

                const openLines =
                  editing.add || editing.calcStage
                    ? 1
                    : editing.comment && !proseEdit
                      ? editing.original.split("\n").length
                      : valueLines.length;

                // Height follows the DRAFT's line count and never falls below
                // the box's own: at edit start the draft is the original, so
                // the two agree, and a wrapped label whose source is one line
                // keeps the box's height rather than drawing a half-height
                // editor inside the box it replaced. Shift+Enter grows it.
                const fh =
                  editing.add || editing.calcStage
                    ? openLines * LINE_H + 2 * NODE_PAD_Y
                    : editing.comment && !proseEdit
                      ? Math.max(1, openLines) * COMMENT_LINE_H + 2 * NODE_PAD_Y
                      : Math.max(h, openLines * LINE_H + 2 * NODE_PAD_Y);

                // The overlay's border COINCIDES WITH THE BOX'S STROKE — the
                // foreignObject is the rect grown by EDIT_STROKE/2 on every
                // side, so the editor's 2px border lands exactly on the drawn
                // outline of the accented box (a stroke is centred on the edge,
                // so its outer edge is at rect ± 1). Placed on the rect itself
                // the border sat entirely INSIDE it and the outline stepped
                // inward by 1px per side — at the reader's 2-2.5× tree zoom,
                // ~10 device px, reported as the box getting smaller. The state
                // is still said by the border's COLOUR (accent for a tactic,
                // prose ink for a comment) rather than by a rectangle sitting
                // inside another one. Width is the exception: it grows with the
                // draft. The radius follows the outer curve of that stroke.
                const editRx = en.data.type === "tactic" ? 4 : 6;
                const editOuterRx = editRx + EDIT_STROKE / 2;

                // An overlay standing in for the box wears the BOX'S fill: in
                // VS Code the editor's input background is visibly darker than
                // a tactic box, so EDIT_BG made the box change colour as it
                // "shrank". Overlays standing in for NO box (the (+) add, the
                // calc stage, a comment STRIP) keep the input background.
                const editBg = standsInForBox ? nodeBoxFill(en.data) : EDIT_BG;

                const mirrorPos = editing.tokPos ?? en.data.position;

                const editHighlight =
                  !editing.add &&
                  !editing.calcStage &&
                  !editing.comment &&
                  editing.cfIndent === undefined &&
                  mirrorPos
                    ? (renderTaggedTactic?.(
                        mirrorPos,
                        editing.value,
                        valueLines,
                      ) ?? null)
                    : null;
                return (
                  <g transform={`translate(${en.x},${en.y})`}>
                    <foreignObject
                      x={-w / 2 - EDIT_STROKE / 2}
                      y={overlayY - EDIT_STROKE / 2}
                      width={fw + EDIT_STROKE}
                      height={fh + EDIT_STROKE}
                      style={{ overflow: "visible" }}
                    >
                      <div
                        data-ptw-edit=""

                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: "relative",
                          width: "100%",
                          height: "100%",
                        }}
                      >
                        {editHighlight && (
                          <div
                            data-ptw-mirror=""
                            aria-hidden
                            style={{
                              ...editOverlayLayer(0),

                              borderRadius: editOuterRx,
                              background: editBg,
                              color: EDIT_TEXT,
                            }}
                          >
                            {valueLines.map((line, j) => (
                              <div key={j} style={{ height: LINE_H }}>
                                {editHighlight[j] ?? line}
                              </div>
                            ))}
                          </div>
                        )}
                        <textarea
                          key={editing.calcStage?.stage ?? "edit"}
                          autoFocus
                          value={editing.value}
                          spellCheck={false}

                          placeholder={
                            editing.comment
                              ? "empty = delete this comment"
                              : editing.add || editing.calcStage
                                ? ""
                                : "empty = cancel"
                          }

                          onScroll={(e) => {
                            const m =
                              e.currentTarget.parentElement?.querySelector(
                                "[data-ptw-mirror]",
                              );
                            if (m instanceof HTMLElement) {
                              m.scrollTop = e.currentTarget.scrollTop;
                              m.scrollLeft = e.currentTarget.scrollLeft;
                            }
                          }}
                          onChange={(e) => {
                            const { value, selectionStart } = e.target;
                            setEditing((cur) => cur && { ...cur, value });

                            if (!editing.comment)
                              refreshCompletion(
                                editing.id,
                                value,
                                selectionStart,
                              );
                            syncAbbrev(
                              editKey(editing)!,
                              value,
                              selectionStart,
                            );
                          }}

                          onSelect={(e) => {
                            const ta = e.currentTarget;
                            if (completion)
                              refreshCompletion(
                                editing.id,
                                ta.value,
                                ta.selectionStart,
                              );

                            syncAbbrev(
                              editKey(editing)!,
                              ta.value,
                              ta.selectionStart,
                            );
                          }}
                          onClick={(e) => {
                            e.stopPropagation();

                            syncAbbrev(
                              editKey(editing)!,
                              e.currentTarget.value,
                              e.currentTarget.selectionStart,
                            );
                          }}
                          onKeyUp={(e) =>
                            syncAbbrev(
                              editKey(editing)!,
                              e.currentTarget.value,
                              e.currentTarget.selectionStart,
                            )
                          }
                          onDoubleClick={(e) => e.stopPropagation()}
                          onCopy={() => (nativeClip.current = true)}
                          onCut={() => (nativeClip.current = true)}
                          onPaste={() => (nativeClip.current = true)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            const mod = e.metaKey || e.ctrlKey;
                            const k = e.key.toLowerCase();
                            const ta = e.currentTarget;
                            if (mod && k === "a") {
                              e.preventDefault();
                              ta.setSelectionRange(0, ta.value.length);
                              return;
                            }
                            if (mod && (k === "c" || k === "x" || k === "v")) {
                              nativeClip.current = false;
                              window.setTimeout(() => {
                                if (!nativeClip.current)
                                  void clipboardFallback(k, ta, editing);
                              }, 0);
                              return;
                            }

                            if (e.key === "Tab" && !mod) {
                              if (abbrevSess?.session.expand()) {
                                e.preventDefault();
                                putSpans([]);
                                return;
                              }
                            }

                            if (completion && !mod) {
                              const n = completion.items.length;
                              if (
                                e.key === "ArrowDown" ||
                                e.key === "ArrowUp"
                              ) {
                                e.preventDefault();
                                const d = e.key === "ArrowDown" ? 1 : n - 1;
                                setCompletion({
                                  ...completion,
                                  index: (completion.index + d) % n,
                                });
                                return;
                              }
                              if (e.key === "Enter" || e.key === "Tab") {
                                const sel = completion.items[completion.index];

                                if (e.key === "Enter" && sel.exact) {
                                  setCompletion(null);
                                } else {
                                  e.preventDefault();
                                  acceptCompletion(editing, sel, ta);
                                  return;
                                }
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                setCompletion(null);
                                return;
                              }
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setEditing(null);
                            } else if (
                              e.key === "Enter" &&
                              (e.metaKey ||
                                e.ctrlKey ||
                                (!e.shiftKey &&
                                  !editing.original.includes("\n")))
                            ) {
                              e.preventDefault();
                              commitEdit();
                            }
                          }}

                          onBlur={() => {
                            if (editingRef.current?.calcStage) return;
                            commitEdit();
                          }}
                          style={{
                            width: "100%",
                            height: "100%",
                            boxSizing: "border-box",
                            fontFamily: getCodeFontFamily(),

                            fontSize: editFontPx,
                            fontStyle: editing.comment ? "italic" : undefined,
                            lineHeight: `${editLineH}px`,
                            letterSpacing: 0,
                            padding: `${NODE_PAD_Y + EDIT_STROKE / 2}px ${NODE_PAD + EDIT_STROKE / 2}px`,

                            position: "relative",
                            zIndex: 1,
                            background: editHighlight ? "transparent" : editBg,

                            color:
                              editHighlight && editing.value !== ""
                                ? "transparent"
                                : EDIT_TEXT,
                            caretColor: EDIT_TEXT,

                            // EDIT_STROKE is the ACCENTED box's own stroke, and
                            // the foreignObject is grown by half of it on every
                            // side, so this border lands exactly on the outline
                            // the box was drawing.
                            border: 0,
                            boxShadow: `inset 0 0 0 ${EDIT_STROKE}px ${
                              editing.comment ? PROSE_FILL : SEQ_STROKE
                            }`,
                            borderRadius: editOuterRx,
                            outline: "none",
                            resize: "none",
                            whiteSpace: "pre",
                            overflowX: "hidden",

                            overflowY: "auto",

                            userSelect: "text",
                          }}
                        />
                        {abbrevSpans.length > 0 && (
                          <div
                            aria-hidden
                            style={{
                              ...editOverlayLayer(2),

                              color: "transparent",
                            }}
                          >
                            {underlineRuns(editing.value, abbrevSpans).map(
                              (runs, j) => (
                                <div key={j} style={{ height: LINE_H }}>
                                  {runs.map((r, k) =>
                                    r.mark ? (
                                      <span
                                        key={k}
                                        style={{
                                          textDecoration: "underline",
                                          textDecorationColor: EDIT_TEXT,
                                        }}
                                      >
                                        {r.text}
                                      </span>
                                    ) : (
                                      <span key={k}>{r.text}</span>
                                    ),
                                  )}
                                </div>
                              ),
                            )}
                          </div>
                        )}
                        {completion && (
                          <div
                            onMouseDown={(e) => e.preventDefault()}
                            style={{
                              position: "absolute",
                              // The foreignObject starts EDIT_STROKE/2 outside
                              // the rect, so these two keep the list exactly
                              // where it was: flush with the box's left edge,
                              // 2px under its outline.
                              top: fh + EDIT_STROKE + 2,
                              left: EDIT_STROKE / 2,
                              minWidth: Math.min(fw, 240),
                              maxWidth: 520,
                              maxHeight: 168,
                              overflowY: "auto",
                              zIndex: 2,

                              background: EDIT_BG,
                              color: EDIT_TEXT,
                              border: `1px solid ${NODE_STYLES.tactic.stroke}`,
                              borderRadius: 3,
                              fontFamily: getCodeFontFamily(),
                              fontSize: NODE_FONT_PX,
                              lineHeight: `${LINE_H}px`,
                              letterSpacing: 0,
                              boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
                            }}
                          >
                            {completion.items.map((it, i) => (
                              <div
                                key={`${it.kind}:${it.label}`}
                                onClick={(e) =>
                                  acceptCompletion(
                                    editing,
                                    it,

                                    e.currentTarget
                                      .closest("[data-ptw-edit]")
                                      ?.querySelector("textarea") ?? null,
                                  )
                                }
                                onMouseEnter={() =>
                                  setCompletion((c) => c && { ...c, index: i })
                                }
                                style={{
                                  display: "flex",
                                  gap: 8,
                                  alignItems: "baseline",
                                  padding: "1px 6px",
                                  cursor: "pointer",
                                  whiteSpace: "pre",

                                  background:
                                    i === completion.index
                                      ? "var(--ptw-accent)"
                                      : "transparent",
                                  color:
                                    i === completion.index
                                      ? "var(--ptw-accent-text)"
                                      : EDIT_TEXT,
                                }}
                              >
                                <span
                                  style={{
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {it.label}
                                </span>
                                <span
                                  style={{
                                    marginLeft: "auto",
                                    opacity: 0.55,
                                    fontSize: COMMENT_FONT_PX,
                                  }}
                                >
                                  {it.kind}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </foreignObject>
                  </g>
                );
              })()}
          </g>
        </svg>
      </div>
      {/* THE IN-PAGE TOOLTIP, above every floater (tip.tsx). */}
      <TipLayer />
    </div>
    </TipContext.Provider>
  );
}

const RAIL_BTN: CSSProperties = {
  width: 26,
  height: 26,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  fontFamily: "monospace",
  fontSize: 14,
  lineHeight: 1,
  cursor: "pointer",
  background: "var(--vscode-editorWidget-background, rgba(255,255,255,0.92))",

  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--vscode-editorWidget-border, #cbd5e0)",
  borderRadius: 3,
  color: "var(--vscode-icon-foreground, #2d3748)",
};

// The chrome every menu popover wears, wherever it is hung from: the bar's
// menus open upward from the bar, the rail's opens left of the rail, and the
// two must not drift.
const MENU_PANEL: CSSProperties = {
  boxSizing: "border-box",
  zIndex: 12,
  ...POPUP_CHROME,
  padding: 4,
  border: "1px solid var(--vscode-editorWidget-border, #cbd5e0)",
  color: "var(--vscode-icon-foreground, #2d3748)",
  fontFamily: "system-ui, sans-serif",
  fontSize: 12,
  lineHeight: 1.4,
  textAlign: "left",
  cursor: "default",
};

function partSegSpans(
  parts: CombinedPart[],
): { part: CombinedPart; seg0: number; span: number }[] {
  const out: { part: CombinedPart; seg0: number; span: number }[] = [];
  let seg = 0;
  for (const part of parts) {
    const span = part.label.split("\n").length;
    out.push({ part, seg0: seg, span });
    seg += span;
  }
  return out;
}

function renderCombinedLines(
  parts: CombinedPart[] | undefined,
  lines: WrappedLine[],
  render: ProofTreeViewProps["renderTaggedTactic"],
): ReactNode[] | null {
  if (!parts || parts.length === 0 || !render) return null;
  const out: ReactNode[] = [];
  for (const { part, seg0, span } of partSegSpans(parts)) {
    const mine = lines.filter((l) => l.seg >= seg0 && l.seg < seg0 + span);
    if (mine.length === 0) continue;
    if (!part.position) return null;
    const rendered = render(
      part.position,
      part.label,
      mine.map((l) => l.text),
      part.elision,
    );
    if (!rendered || rendered.length !== mine.length) return null;
    out.push(...rendered);
  }
  return out.length === lines.length ? out : null;
}

const PILL_BTN: CSSProperties = {
  width: 14,
  height: 16,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontFamily: "monospace",
  fontSize: 12,
  lineHeight: 1,
  color: "inherit",
};

/** D4 — the THREE severities' ink and glyph, in one place: an error, a
 warning, and a LINT. A lint is not a problem with the proof — the proof
 checks — so it wears the comment ink and a note's mark rather than a colour
 that says something is wrong. */
const diagInkOf = (sev: 1 | 2 | 3): string =>
  sev === 1 ? DANGER_FILL : sev === 2 ? WARN_FILL : "var(--ptw-comment)";

const diagGlyphOf = (sev: 1 | 2 | 3): string =>
  sev === 1 ? "⨯" : sev === 2 ? "⚠" : "◇";

interface DiagBarProps {
  index: number;
  count: number;
  diag: TreeDiagnostic;
  clickable: boolean;
  onStep: (d: number) => void;
  onGo: () => void;
}

function DiagnosticItem({
  index,
  count,
  diag,
  clickable,
  onStep,
  onGo,
}: DiagBarProps) {
  const ink = diagInkOf(diag.severity);
  const tip = useTip();
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        padding: "0 6px",
        color: "var(--vscode-icon-foreground, #2d3748)",
      }}
    >
      <span style={{ color: ink }}>{diagGlyphOf(diag.severity)}</span>
      {count > 1 && (
        <>
          <button
            type="button"
            style={PILL_BTN}
            {...tip.props("Previous problem")}
            onClick={() => onStep(-1)}
          >
            ‹
          </button>
          <span style={{ color: MUTED_FILL }}>
            {index + 1}/{count}
          </span>
          <button
            type="button"
            style={PILL_BTN}
            {...tip.props("Next problem")}
            onClick={() => onStep(1)}
          >
            ›
          </button>
        </>
      )}
      <span
        onClick={onGo}
        {...tip.props(
          clickable
            ? `${diag.message}\n\nClick to show it on its node and in the source`
            : diag.message,
        )}
        style={{
          minWidth: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          cursor: clickable ? "pointer" : "default",
        }}
      >
        {diag.message.split("\n")[0]}
      </span>
    </div>
  );
}

/** The AXIS BREAK on a link leaving a HOPPED goal: the graph convention for
 a shortened axis — two parallel slanted strokes across the line with the
 line cut between them — saying "steps were skipped between these two"
 without standing in the tree as a node. Paint only, like `LinkMark`: a
 background-coloured cut plus two strokes; `linkSpans` needs no mirror. It is
 not gated on `linkMarks` — it is the one mark that carries state.

 Beside it, to the right, the CAPTION: the head word of each hidden tactic
 (or the `.none` note in italics), the axis-break label idiom. It is what the
 dashed ghost of a skipped step used to say, now said on the line, and it is
 clickable exactly like the goal's `+N` — the same restore, so the reader can
 undo the hop from either end of it. */
function HopBreak({
  x,
  y,
  stroke,
  folded,
  onRestore,
}: {
  x: number;
  y: number;
  stroke: string;
  folded: {
    tactics: string[];
    note?: string;
    seeded?: true;
    seededBy?: SeedOrigin;
  };
  onRestore: () => void;
}) {
  const caption = hopCaption(folded);
  // A SEEDED break says WHOSE hand it is before it says how much went — the
  // caption already wears `§` and italics, and this is where that mark is
  // spelled out.
  const tip = folded.seeded
    ? `${seedTitle(folded.seededBy, folded.tactics.length)}\n\n${folded.tactics.join("\n")}`
    : `${folded.tactics.length} ${
        folded.tactics.length === 1 ? "step" : "steps"
      } skipped — click to restore\n\n${folded.tactics.join("\n")}`;
  return (
    <g
      style={{ cursor: "pointer" }}
      onClick={(e) => {
        e.stopPropagation();
        onRestore();
      }}
    >
      <title>{tip}</title>
      {/* JOINED: the link ends at the centre of the upper slant and resumes
          at the centre of the lower one, so the line runs INTO the break and
          out of it — one stroke of chrome, not a line with two ticks laid
          over it. The mask between the two slant centres is what the eye
          reads as the gap (6px, against 3.5 when the ticks floated). */}
      <line
        x1={x}
        y1={y - 3}
        x2={x}
        y2={y + 3}
        stroke="var(--ptw-bg)"
        strokeWidth={4}
      />
      <line
        x1={x - 4.5}
        y1={y - 1}
        x2={x + 4.5}
        y2={y - 5}
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <line
        x1={x - 4.5}
        y1={y + 5}
        x2={x + 4.5}
        y2={y + 1}
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {caption && (
        <text
          x={x + HOP_CAPTION_GAP}
          y={y + BADGE_FONT_PX / 2 - 1}
          fontSize={BADGE_FONT_PX}
          fontFamily={getCodeFontFamily()}
          fontStyle={caption.italic ? "italic" : undefined}
          fill="var(--ptw-comment)"
        >
          {caption.text}
        </text>
      )}
    </g>
  );
}

function LinkMark({
  x,
  y,
  horiz = false,
  goal,
  stroke,
}: {
  x: number;
  y: number;

  horiz?: boolean;
  goal: boolean;
  stroke: string;
}) {
  const cut = (key: string, c: number, len: number) =>
    horiz ? (
      <line
        key={key}
        x1={x + c - len / 2}
        y1={y}
        x2={x + c + len / 2}
        y2={y}
        stroke="var(--ptw-bg)"
        strokeWidth={4}
      />
    ) : (
      <line
        key={key}
        x1={x}
        y1={y + c - len / 2}
        x2={x}
        y2={y + c + len / 2}
        stroke="var(--ptw-bg)"
        strokeWidth={4}
      />
    );
  return (
    <g pointerEvents="none">
      {goal ? (
        <>
          {cut("c", 0, 7)}
          <circle cx={x} cy={y} r={2} fill={stroke} />
        </>
      ) : (
        <>
          {cut("a", -3.25, 2.5)}
          {cut("b", 3.25, 2.5)}
        </>
      )}
    </g>
  );
}

function RailButton({
  glyph,
  glyphPx,
  title,
  onClick,
  pressed,
  pressedInk,
  disabled,
}: {
  glyph: string;
  glyphPx?: number;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  pressed?: boolean;
  pressedInk?: string;
  disabled?: boolean;
}) {
  const ink = pressedInk ?? RAIL_PRESSED;
  const tip = useTip();
  return (
    <button
      type="button"
      {...tip.props(title)}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...(disabled
          ? { ...RAIL_BTN, opacity: 0.35, cursor: "default" }
          : pressed
            ? {
                ...RAIL_BTN,
                background: ink,
                borderColor: ink,
                color: ACCENT_TEXT,
              }
            : RAIL_BTN),
        ...(glyphPx === undefined ? null : { fontSize: glyphPx }),
      }}
    >
      {glyph}
    </button>
  );
}

/** Whether ⌥ is held right now. The rail's `+`/`−` carry a SECOND gesture on
the modifier (unfold-all / fold-all), and until this hook the only trace of
that was a parenthetical in a tooltip nobody reads twice; while ⌥ is down the
two swap their glyphs for `⊞`/`⊟`, the marks those gestures have always used,
so the modifier announces itself on the control it applies to.

TWO sources, because neither alone covers the widget. Key events reach a
webview only when it has FOCUS, and in the infoview the caret normally lives in
the editor — holding ⌥ while pointing at the tree would deliver nothing at all.
So the rail's own mouse events feed it too: `altKey` rides every mouse event
whatever holds focus, and the affordance only has to be right while the pointer
is on the rail. (Neither is a substitute for the other: a held ⌥ with a still
mouse sends no mouse events either.)

A window blur CLEARS it: a webview that loses focus mid-press never sees the
keyup, and a glyph stuck in the ⌥ reading is worse than one that never moved.

Lives inside `ZoomRail`, not the view, so a modifier press repaints two buttons
instead of the tree. */
function useAltHeld() {
  const [alt, setAlt] = useState(false);
  useEffect(() => {
    // `e.altKey`, not `e.key === "Alt"`: it is set on EVERY key event, so a
    // chord that begins with the modifier still reports it held, and Alt's own
    // keyup reports false — which is exactly the release.
    const onKey = (e: KeyboardEvent) => setAlt(e.altKey);
    const clear = () => setAlt(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", clear);
    };
  }, []);
  return { alt, syncAlt: (e: React.MouseEvent) => setAlt(e.altKey) };
}

/** THE TOP-CENTRE STACK: the MODAL BANNER, and the TOAST beneath it.

The banner says "you are in a mode" — a picking mode, the staged calc fill, an
armed delete, to-cursor — for as long as the mode is up. It used to be an item
spliced into the STATUS BAR's left group, which made entering a mode RESHUFFLE
the row: every item to its right moved, so arming a delete shifted the very
controls you might be reaching for next. Here the bar never changes shape while
a mode is up, and the banner reads where the transient toast already speaks.

It wears the toast's own chrome and position (`POPUP_CHROME` + the
editor-widget border), inked `SEQ_STROKE` — DANGER for an armed delete — and
carries the `✕` whose exit IS the mode's own `layers` entry, so banner and Esc
cannot disagree.

The two are ONE flex column rather than two absolutely-positioned floaters, so
the toast stacks under a standing banner with no constant to measure either
against. The column takes no pointer events; only the banner's button does. */
function TopCentre({
  top,
  modal,
  toast,
}: {
  top: number;
  modal: {
    text: string;
    title: string;
    ink: string;
    onExit: () => void;
  } | null;
  toast: { text: string; key: number; anchored?: boolean } | null;
}) {
  if (!modal && !toast) return null;
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 12,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        maxWidth: "80%",
        // The anchored toast wants the column's full width to be a FIXED one.
        width: toast?.anchored ? TOAST_ANCHORED_W : undefined,
      }}
    >
      {modal && (
        <button
          type="button"
          title={modal.title}
          onClick={modal.onExit}
          style={{
            pointerEvents: "auto",
            boxSizing: "border-box",
            maxWidth: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            whiteSpace: "nowrap",
            ...POPUP_CHROME,
            padding: "4px 10px",
            border: "1px solid var(--vscode-editorWidget-border, #cbd5e0)",
            borderRadius: 4,
            color: modal.ink,
            fontFamily: "system-ui, sans-serif",
            fontSize: 12,
            lineHeight: 1.4,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {modal.text}
          </span>
          <span style={{ opacity: 0.8, flexShrink: 0 }}>✕</span>
        </button>
      )}
      {toast && (
        <div
          key={toast.key}
          style={{
            boxSizing: "border-box",
            maxWidth: "100%",
            // ANCHORED (a mark jump's `n/N · caption`): the box is the
            // column's fixed width and its text is left-aligned, so the
            // counter sits at one x from mark to mark and the caption reads
            // to its right; a centred box moved the counter with every
            // caption's length. Other toasts stay centred, sized to fit.
            width: toast.anchored ? "100%" : undefined,
            textAlign: toast.anchored ? "left" : undefined,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            ...POPUP_CHROME,
            padding: "4px 10px",
            border: "1px solid var(--vscode-editorWidget-border, #cbd5e0)",
            color: "var(--vscode-icon-foreground, #2d3748)",
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function ZoomRail({
  lifted,
  onZoomIn,
  onZoomOut,
  onExpandAll,
  onCollapseAll,
  onFit,
}: {
  lifted: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onFit: () => void;
}) {
  const { alt, syncAlt } = useAltHeld();
  return (
    <div
      // The rail's own read of the modifier, for when the keyboard's goes to
      // the editor instead of the webview (see useAltHeld).
      onMouseMove={syncAlt}
      // THE BOTTOM-RIGHT CORNER, beside the canvas these verbs act on. It
      // needs no `hdrH`: the header hangs at the TOP, so the one measurement
      // the rail used to depend on (and once latched at 0, putting the rail on
      // top of the header) cannot reach it. Its bottom sits one lane UP — the
      // host's "Restart File" button owns the corner itself, and with the
      // frame now taking all the room there is (widget.tsx) the rail has to
      // clear that button by placement rather than by the frame stopping
      // short of it.
      style={{
        position: "absolute",
        right: RAIL_INSET,
        bottom:
          LANE_INSET +
          LANE_BTN_H +
          RAIL_LANE_GAP +
          (lifted ? BAR_H + LANE_GAP : 0),
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 4,
      }}
    >
      {/* The two zoom buttons carry the two fold-ALL gestures on ⌥, the way
          the tree's own nodes carry a second gesture there: + opens, − shuts,
          and the modifier says "everything" rather than "here". While ⌥ is
          held each wears the mark of what ⌥ would do — ⊞ and ⊟, the glyphs
          expand-all and collapse-all have always used — so the modifier is
          visible on the button it applies to rather than only in a tooltip. */}
      <RailButton
        glyph={alt ? "⊞" : "+"}
        title={`Zoom in (${CMD}-scroll zooms at the cursor) — ⌥-click unfolds every branch and restores every skipped run`}
        onClick={(e) => (e.altKey ? onExpandAll() : onZoomIn())}
      />
      <RailButton
        glyph={alt ? "⊟" : "−"}
        title="Zoom out — ⌥-click folds every branch"
        onClick={(e) => (e.altKey ? onCollapseAll() : onZoomOut())}
      />
      <RailButton glyph="⛶" title="Fit width" onClick={onFit} />
    </div>
  );
}

/* THE BOTTOM LANE — the strip the infoview's own floating "Restart File"
button owns, and the reason our chrome is placed the way it is.

That button is `position: fixed; bottom: 10px; right: 10px` (vscode-lean4's
`index.css`) over a webview-ui-toolkit button whose own shadow-root CSS is
`line-height: 22px; padding: 1px 13px; border-width: 1px` — 26px tall, and
~95px wide, measured in the running editor (the arithmetic off the shipped
bundle in `dist/lean4-infoview/` says 26 of padding and border either side of
"Restart File", which `measureText` puts at 68.3px in the macOS UI font at 13px
and 66.5 in Segoe; the measurement is what the reserve follows). Being
`fixed`, it hangs over the bottom right of the WEBVIEW VIEWPORT whatever the
page scrolls to.

The frame used to step back out of that whole lane (a 44px bottom clearance),
which cost the tree 44px of height at every panel size. Now the frame takes
ALL the room there is (widget.tsx) and the chrome dodges the button by
PLACEMENT instead: the status card sits IN the lane at the button's own inset
and height, so card and button read as one row of chrome, and the zoom rail
moves UP to sit above the button. One coding, three readers — the card's
`bottom`/`height`/`max-width`, the rail's `bottom`, and `fit`'s idea of how
much width the words have. */
const LANE_INSET = 10;
const LANE_BTN_H = 26;
// The button's own width, re-measured in the running VS Code rather than
// computed from the toolkit's padding: ~95px, so 96 is the reserve. The gap
// beside it comes down with it — the card is chrome in the same lane, and 4px
// is what separates two items of chrome, not 8.
const LANE_BTN_W = 96;
const LANE_GAP = 4;

// The zoom rail's own corner, in the same one coding. It sits tighter to the
// right edge than the card does to the left (`RAIL_INSET`, 4 against the
// card's 8) and higher above the host button than the card's own lane gap
// would put it (`RAIL_LANE_GAP`, 12 against `LANE_GAP`'s 4) — the rail is a
// column of round buttons hanging over the tree rather than a card lying in
// the button's lane, so it wants the canvas edge and it wants daylight
// between itself and the button below.
const RAIL_INSET = 4;
const RAIL_LANE_GAP = 12;
/** Where a FILLING status card sits: one lane above the host button. */
const BAR_LIFT = LANE_INSET + LANE_BTN_H + LANE_GAP;

// The card is EXACTLY the button's height — see BAR_ITEM_H for why that is a
// fixed `height` and not a minimum.
const BAR_H = LANE_BTN_H;

// The gap between items, and the card's own padding. Both feed the ACCENT
// PILL's margins: an accented item's highlight is inset from the card's top
// and bottom edges by `STATUS_PAD_Y + 1` (the border) and from its neighbours
// by the whole `STATUS_GAP`, so the pill floats inside the card rather than
// filling it edge to edge.
const STATUS_GAP = 4;
const STATUS_PAD_Y = 2;
const STATUS_PAD_X = 6;

// The room kept clear on the right for the host's button (its ~96px at
// `right: 10`, plus a 4px gap) — which is where the card is ANCHORED, so the
// distance from the row's last item to that button never changes. The card
// grows LEFTWARD instead, and `STATUS_INSET` is now the clearance it must
// leave at the far end: `BAR_MAX_W` is what stops it reaching the frame's own
// left edge, and the same two numbers are the width `fit` measures the words
// against.
const STATUS_INSET = 8;
const BAR_RIGHT_RESERVE = LANE_INSET + LANE_BTN_W + LANE_GAP;
const BAR_MAX_W = `calc(100% - ${STATUS_INSET + BAR_RIGHT_RESERVE}px)`;

/* THE OTHER TWO PLACEMENTS. The right anchor above is the placement for a
frame with room for BOTH the card and the host's "Restart File" button in one
lane; it is not the only one, and taking it as the only one was the reported
"two glyphs at the far left of a thin panel". See `fit` for the decision.

`BAR_FILL_MAX_W` is the THIN case: a frame narrower than the button's lane
plus the glyph row cannot keep the two side by side at all, so the card stops
dodging, takes the frame's whole width between its own insets, and the button
floats where it floats (it is the host's, it draws over us, and a row of
glyphs under it still reads — an EMPTY 110px of canvas beside a clipped row
does not).

`BAR_CENTER_MAX_W` is the WIDE case: two button reserves, so a card centred
in the frame can never reach the lane the button sits in whatever the
diagnostics block does to its width. */
const BAR_FILL_MAX_W = `calc(100% - ${2 * STATUS_INSET}px)`;
/** Clearance a CENTRED card keeps beyond the button's reserve on each side.
 Measured in the live infoview at a 540px frame: with no slack the centred
 card's right edge landed under the host button and hid `?` (the frame the
 widget measures runs a little wider than the visible pane), so a card is
 centred only when it can afford a whole reserve AND this much more. */
const BAR_CENTER_SLACK = 48;
const BAR_CENTER_MAX_W = `calc(100% - ${2 * (BAR_RIGHT_RESERVE + BAR_CENTER_SLACK)}px)`;

/* ONE HEIGHT. The card is a fixed `height: BAR_H` and every item a fixed
`BAR_ITEM_H`, never a minimum and never a line box — because the row's content
changes FONT: the compact glyphs are drawn in the tree's code font at their own
`glyphPx` (up to 19 for `▸`), so an item sized by its line box grew and shrank
as the row compacted and as `used` was swapped for `narrate`. A status bar that
changes height when you change a setting is the report this rule answers.

So height comes only from these two numbers: 20 + 2 * STATUS_PAD_Y + 2 (the
card's border) = 26. Vertical padding on the item is therefore ZERO — the
height and `alignItems: center` do that work — and every glyph sits inside a
fixed-size box (`GlyphBox`) so no font size can reach the layout at all.
`borderRadius` is half the item's height, so the accent draws as a PILL. */
const BAR_ITEM_H = 20;

// The item's side padding, and so the accent pill's own side margin. It has
// come down twice, both times to buy row width — 10 → 8 when the glyph
// prefixes went in, 8 → 6 when the card moved into the host button's lane and
// gave up 68px of room on the right. Six is where VS Code's own status-bar
// items sit; below it the pill stops reading as a pill.
const BAR_ITEM_PAD_X = 6;

const BAR_ITEM: CSSProperties = {
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  // Only so the EXTRAS SLOTS can be absolutely positioned inside the item's
  // own box (see `ExtraSlots`). It changes nothing about the item's layout.
  position: "relative",
  height: BAR_ITEM_H,
  padding: `0 ${BAR_ITEM_PAD_X}px`,
  border: "none",
  borderRadius: BAR_ITEM_H / 2,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  whiteSpace: "nowrap",
  flexShrink: 0,
  cursor: "pointer",
};

// Every glyph in the bar — a compact mode mark in the code font, one of the
// drawn SVG icons, `↺`, `?` — is painted inside a box of FIXED size, so its
// font, its size and its own ink can never reach the item's box. That is what
// makes both promises hold at once: ONE HEIGHT (the box is `BAR_ITEM_H` tall
// whatever is in it) and a STABLE WIDTH (swapping `▸` for `λ` moves nothing).
const GLYPH_BOX_W = 14;
const TEXT_GLYPH_BOX_W = 10;

/** The tour's `‹ ›`, in px. MEASURED, in the code font the bar's glyphs are
 drawn in: a guillemet inks at ~0.45 of its font size, so at the bar's own
 inherited 12px it stood 5.4px tall against the ⚑'s 7.65, the `☰`'s 6.91 and
 the `▸`'s 7.37 — the reported "too small" — and 14 only reaches 6.3, a
 difference no screenshot shows. At 18 it inks 8.07: level with the ⚑, a hair
 over the rest, which is the side of the complaint to err on. It is the
 largest number in the bar and draws one of its smallest marks — that is the
 glyph, not a mistake. */
const CHEVRON_PX = 18;

function GlyphBox({ children, w }: { children: ReactNode; w?: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: BAR_ITEM_H,
        width: w ?? GLYPH_BOX_W,
        flex: `0 0 ${w ?? GLYPH_BOX_W}px`,
        lineHeight: 1,
        overflow: "visible",
      }}
    >
      {children}
    </span>
  );
}

const BAR_ROW: CSSProperties = {
  boxSizing: "border-box",
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  width: "100%",
  padding: "3px 6px",
  border: "none",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  borderRadius: 3,
};

/* THE EXTRAS SLOTS. Three of the bar's menus hold TOGGLES beside their main
setting — Layout's side-by-side and gallery, Context's `Split data & props`,
and the reading eye's brief/merge/to-cursor — and none of them shows in the
item's own label, which names the choice and not the extras. A row of small
SQUARES under the item says which are up without naming them (the popover rows
do that) and without costing a character of the row.

They are SLOTS, not a count: each extra owns a fixed position in the group and
an unset one is simply EMPTY, so the eye with brief and to-cursor up reads
`■ · ■` and the reader can tell WHICH is off rather than only how many. Every
slot therefore reserves its `SLOT_PX` whether it is set or not, which is also
what keeps the group's centre still as extras toggle.

It is ABSOLUTELY POSITIONED inside the item's fixed 20px box, so it can reach
neither the row's height (ONE HEIGHT) nor the item's width (STABLE WIDTH) —
which is also what lets a mark appear and disappear without moving anything to
its right. `left: 0; right: 0` centres the group under the whole item, i.e.
under the label in the text form and under the glyph box in the compact one.
`bottom: -1` drops it into the card's own bottom padding — still inside the
border, and clear of the label's descenders. */
const SLOT_PX = 3;
const SLOT_GAP_PX = 2;

/* THE DEVICE-PIXEL RATIO, live. It is not a constant even on one screen: the
editor's own zoom multiplies it (measured in the infoview at 2.4 = retina 2 ×
zoom 1.2), and a zoom change fires `resize`. */
function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() =>
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  );
  useEffect(() => {
    const read = () => setDpr(window.devicePixelRatio || 1);
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return dpr;
}

/* A 3×3 CSS square is only a square on screen when it lands on WHOLE DEVICE
PIXELS, and in the infoview it routinely does neither: at dpr 2.4 a 3px side
is 7.2 device px, and the group is centred under an item of fractional width,
so its left edge falls mid-pixel too. The renderer then antialiases one axis
and not the other and the mark reads as a RECTANGLE — reported as exactly
that.

So both halves are snapped. The SIZE (and the gap, or marks 2 and 3 drift off
the grid however well mark 1 is placed) is rounded to whole device pixels and
expressed back in CSS px; the POSITION is corrected by a `transform` carrying
the sub-device-pixel remainder of the FIRST mark's own rect — the first mark,
not the group, because `justifyContent: center` is what makes the offset
fractional in the first place. The rect already carries the nudge in force, so
it is taken back out before the remainder is read, which is what makes the
correction converge in one pass instead of chasing itself.

A transform on an absolutely-positioned span reaches no layout, so both
standing promises hold untouched: ONE HEIGHT and STABLE WIDTH. */
function ExtraSlots({ slots }: { slots: boolean[] }) {
  const dpr = useDevicePixelRatio();
  const ref = useRef<HTMLSpanElement | null>(null);
  // The nudge in force, held twice: as STATE (what the render draws) and in a
  // ref (what the next measurement takes back out). The pair is what lets the
  // effect run after EVERY render — which is when the row's own layout can
  // have moved the group — without listing itself in its deps; it is `fit`'s
  // shape exactly, and it converges in one pass because taking the applied
  // nudge back out leaves the same raw position it was computed from.
  const applied = useRef({ dx: 0, dy: 0 });
  const [nudge, setNudge] = useState({ dx: 0, dy: 0 });

  /* THE SECOND HALF OF THE RATIO, and it has to be MEASURED. A webview's own
  zoom moves `devicePixelRatio` (that is the infoview's case: retina 2 × zoom
  1.2 = 2.4), but an ancestor CSS `zoom` does NOT — measured, the ratio still
  reads 2 under `zoom: 1.2` — so the scale in force is read off a box whose
  CSS size we KNOW and never touch: the item this group is absolutely
  positioned inside, `BAR_ITEM_H` tall by construction. Reading it off one of
  our own marks would feed the snapped size back into the scale that computed
  it, and the layout's 1/64px quantization then makes the pair oscillate. */
  const [scale, setScale] = useState(1);
  const ratio = dpr * scale;

  const size = Math.max(1, Math.round(SLOT_PX * ratio)) / ratio;
  const gap = Math.max(1, Math.round(SLOT_GAP_PX * ratio)) / ratio;

  const snap = useCallback(() => {
    const el = ref.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return;
    const r = first.getBoundingClientRect();
    // A measurement with no box is the ABSENCE of an answer, not a position
    // (`useFrameOffset`'s rule) — a hidden webview lays the row out at zero.
    if (r.width === 0 && r.height === 0) return;
    const host = el.parentElement?.getBoundingClientRect();
    const s = host && host.height > 0 ? host.height / BAR_ITEM_H : 1;
    if (Math.abs(s - scale) > 1e-3) {
      setScale(s);
      return;
    }
    // Everything below is in DEVICE pixels of the rect's own (already scaled)
    // coordinate space; the nudge itself is written in the element's CSS px,
    // which the ancestor scale multiplies — hence the `s` on the way in and
    // the `ratio` on the way out.
    const cur = applied.current;
    const rawL = (r.left - cur.dx * s) * dpr;
    const rawT = (r.top - cur.dy * s) * dpr;
    const dx = (Math.round(rawL) - rawL) / ratio;
    const dy = (Math.round(rawT) - rawT) / ratio;
    if (Math.abs(dx - cur.dx) > 1e-4 || Math.abs(dy - cur.dy) > 1e-4) {
      applied.current = { dx, dy };
      setNudge({ dx, dy });
    }
  }, [dpr, ratio, scale]);
  useLayoutEffect(snap);

  if (slots.length === 0) return null;
  return (
    <span
      ref={ref}
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: -1,
        display: "flex",
        justifyContent: "center",
        gap,
        pointerEvents: "none",
        lineHeight: 0,
        transform: `translate(${nudge.dx}px, ${nudge.dy}px)`,
      }}
    >
      {slots.map((on, i) => (
        <span
          key={i}
          style={{
            width: size,
            height: size,
            flex: `0 0 ${size}px`,
            background: on
              ? "var(--vscode-icon-foreground, var(--ptw-fg))"
              : "transparent",
          }}
        />
      ))}
    </span>
  );
}

function BarButton({
  label,
  title,
  accent,
  muted,
  disabled,
  slots,
  onClick,
  onHover,
}: {
  label: ReactNode;
  title: string;
  accent?: boolean;
  muted?: boolean;
  disabled?: boolean;
  // One entry per extra behind this menu, in a FIXED order; see `ExtraSlots`.
  slots?: boolean[];
  onClick: (e: React.MouseEvent) => void;
  onHover?: (h: boolean) => void;
}) {
  const { ctl } = useTip();
  return (
    <button
      type="button"
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      // POINTER events for the tip, not mouse: React drops `onMouseEnter` on
      // a DISABLED button, and the disabled rows are the ones whose tip says
      // why (measured in the harness on `goals as TeX`).
      onPointerEnter={(e) => ctl.enter(e.currentTarget)}
      onPointerLeave={(e) => ctl.leave(e.currentTarget)}
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
      style={{
        ...BAR_ITEM,
        opacity: disabled ? 0.35 : muted ? 0.6 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(accent ? { background: RAIL_PRESSED, color: ACCENT_TEXT } : null),
      }}
    >
      {label}
      <ExtraSlots slots={slots ?? []} />
    </button>
  );
}

function BarRow({
  label,
  title,
  on,
  disabled,
  onClick,
  onHover,
}: {
  label: ReactNode;
  title: string;
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
  onHover?: (h: boolean) => void;
}) {
  const { ctl } = useTip();
  return (
    <button
      type="button"
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      // POINTER events for the tip, not mouse: React drops `onMouseEnter` on
      // a DISABLED button, and the disabled rows are the ones whose tip says
      // why (measured in the harness on `goals as TeX`).
      onPointerEnter={(e) => ctl.enter(e.currentTarget)}
      onPointerLeave={(e) => ctl.leave(e.currentTarget)}
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
      style={{ ...BAR_ROW, opacity: disabled ? 0.4 : 1 }}
    >
      <span
        style={{
          flex: "0 0 12px",
          fontSize: 10,
          color: on ? RAIL_PRESSED : "inherit",
          opacity: on ? 1 : 0.45,
        }}
      >
        {on ? "●" : "○"}
      </span>
      <span>{label}</span>
    </button>
  );
}

// The bar is ONE ROW, always — a popover parented to its own item would be
// clipped by that row's `overflow: hidden`. So a menu item is only ever the
// BUTTON: it reports its x through `onToggle` (`offsetLeft`, i.e. relative to
// the bar, which is the nearest positioned ancestor) and the panel is rendered
// by `StatusBar` as a SIBLING of the row, hung upward from that x.
function BarMenu({
  label,
  title,
  accent,
  slots,
  onToggle,
  onAlt,
}: {
  label: ReactNode;
  title: string;
  accent?: boolean;
  slots?: boolean[];
  onToggle: (x: number) => void;
  // ⌥-click advances the setting to its next value instead of opening the
  // list — the same wrapper the list's own rows call, so it toasts and
  // anchors identically. Where a menu has no cycle (the width slider, the
  // reading toggles) the modifier simply opens the list.
  onAlt?: () => void;
}) {
  return (
    <BarButton
      // NO DISCLOSURE MARK. A drawn chevron sat here (and a `▾` before it),
      // and it was spending width on a row whose whole budget is the frame:
      // the items read as controls, their titles say what a click does, and
      // the mark was doing neither of those jobs.
      label={label}
      title={title}
      accent={accent}
      slots={slots}
      onClick={(e) => {
        if (onAlt && e.altKey) {
          onAlt();
          return;
        }
        onToggle((e.currentTarget as HTMLElement).offsetLeft);
      }}
    />
  );
}

// The panel half of a bar menu, positioned from the item's measured x.
function BarPanel({
  left,
  width,
  children,
}: {
  left: number;
  width?: number;
  children: ReactNode;
}) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        ...MENU_PANEL,
        position: "absolute",
        bottom: "100%",
        left,
        marginBottom: 4,
        minWidth: width ?? 150,
      }}
    >
      {children}
    </div>
  );
}

/* A hairline between GROUPS in the bar's own row. It was taken out once, on
the argument that the row had become one short list of settings and a rule
between them claimed a grouping nobody was asked to hold — and put back,
because the row is not one list: four menus that hold a SETTING, then an
action (`↺`), then the index (`?`), with the diagnostics item drifting in
between. The rule says where one kind of thing ends.

It is 14px of the item's 20, centred, so it cannot reach the card's height;
`fit` measures it with everything else (it rides inside the always-glyph
group, whose ghost carries its own gaps). */
function BarDivider() {
  return (
    <span
      aria-hidden
      style={{
        flex: "0 0 1px",
        width: 1,
        height: 14,
        alignSelf: "center",
        background: "var(--vscode-editorWidget-border, #cbd5e0)",
      }}
    />
  );
}

// A hairline between groups of rows INSIDE a menu panel — the same rule as
// `BarDivider`, drawn across a panel instead of down a row.
function MenuDivider() {
  return (
    <div
      aria-hidden
      style={{
        height: 1,
        margin: "4px 6px",
        background: "var(--vscode-editorWidget-border, #cbd5e0)",
        opacity: 0.7,
      }}
    />
  );
}

// The reading menu's head. An SVG, not an emoji or a font glyph: the bar has
// exactly one pictorial mark and it must ink the same in every theme and on
// every font stack. Cropped to the eye's own ink (the path spans y 4.1–11.9 of
// a 16-unit box) so it is no taller than a line of the bar's text and every
// item — and so every accent pill — is the same height.
function EyeGlyph() {
  return (
    <svg
      width={14}
      height={10}
      viewBox="1 3 14 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      style={{ display: "block" }}
    >
      <path d="M1.4 8C3 5.4 5.3 4.1 8 4.1S13 5.4 14.6 8C13 10.6 10.7 11.9 8 11.9S3 10.6 1.4 8Z" />
      <circle cx={8} cy={8} r={1.9} />
    </svg>
  );
}

// The comment switch's head, and the width switch's, in the eye's own idiom:
// an inline SVG in `currentColor`, cropped to its own ink and dropped into the
// same fixed `GlyphBox`, so every item — and so every accent pill — is the
// same height whichever of them is showing. They replace `❝` and `↔`, two
// typographic marks that read as punctuation the bar had accidentally left in
// rather than as the controls they are.
//
// They are the GLYPH form only: with the words back on every value item, the
// text form is `Name: value` throughout and these two are what stands in its
// place when the row runs out of room.
//
// The bubble is codicon `comment` — a rounded rectangle with a small tail off
// the bottom-LEFT corner. It inks ~11 × 10.
function CommentGlyph() {
  return (
    <svg
      data-ptw-glyph="comment"
      width={12}
      height={11}
      viewBox="0 0 12 11"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      aria-hidden
      focusable="false"
      style={{ display: "block" }}
    >
      <rect x={1} y={1} width={10} height={7} rx={2} />
      <path d="M3.5 8v2.2l2.4-2.2" />
    </svg>
  );
}

// Width, as codicon `word-wrap` draws it: text lines the second of which ends
// in a return arrow hooking down and back to the left — the mark for "this is
// where the line breaks", which is exactly what the setting sets. It replaces
// `arrow-both` (two outward arrowheads between two bars), which says "this
// much room" and reads at a glance as a resize handle. Ink ~11 × 9.
function WidthGlyph() {
  return (
    <svg
      data-ptw-glyph="word-wrap"
      width={13}
      height={10}
      viewBox="0 0 13 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      aria-hidden
      focusable="false"
      style={{ display: "block" }}
    >
      <path d="M1.5 1.5h10M1.5 5h8a1.6 1.6 0 0 1 0 3.2H7.5" />
      <path d="M9 6.8L7.3 8.2 9 9.6" />
      <path d="M1.5 8.5h3" />
    </svg>
  );
}

/* THE FOUR LAYOUT MARKS, in the eye's idiom and no longer in Unicode's.

They were `☰ ⊦ || ⑃` in the tree's code font at a per-mark `glyphPx` chosen to
level their ink HEIGHTS (14/14/8/15), and the heights were level — but height
was never the complaint. Re-measured on an 8× supersampled raster in the
harness's own code font, the STROKE each mark draws with (median run across
its own strokes, in CSS px):

    ☰  1.25    ⊦  0.88    ||  0.75    ⑃  0.63
    eye 1.2 (its own `strokeWidth`)    comment/width glyphs 1.25    ⚑ 2.9 solid

so three of the four drew at HALF to two-thirds the weight of every other mark
in the row — the reported "too thin/small". A font glyph has no weight knob:
its stems come with the face, they thin as `glyphPx` comes down (`||` is at 8
precisely so two full-em bars do not tower), and they move with whatever
editor font the user has set. So the four are drawn instead, in the idiom the
eye and the comment/width glyphs already established: inline SVG, `currentColor`,
ONE shared `LAYOUT_GLYPH_SW`, cropped to their own ink, inside the same fixed
`GlyphBox` — so nothing the ghost measures moves, and no user font reaches
them. Ink, measured: 10.0 × 8.8, 7.7 × 8.8, 7.0 × 8.8, 9.0 × 8.8 — level in
height as the `glyphPx` pass left them, and now level in weight as well.

The OUTLINE mark keeps its SHAPE exactly: three full-width bars, `☰` as it
stood. Only its weight moves, up to the shared stroke with the rest. */
const LAYOUT_GLYPH_SW = 1.4;

function LayoutGlyph({ mode }: { mode: LayoutMode }) {
  return (
    <svg
      data-ptw-glyph={`layout-${mode}`}
      width={12}
      height={10}
      viewBox="0 0 12 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={LAYOUT_GLYPH_SW}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      style={{ display: "block" }}
    >
      {mode === "stacked" ? (
        // The outline as an F: the trunk, with a step off it at the top and
        // a shorter one below — an outliner's nesting, not a menu's ☰ (user
        // direction; the shape matches the spine and wide marks' family).
        <path d="M2.6 1.3v7.4M2.6 1.3h7.2M2.6 5h5" />
      ) : mode === "spine" ? (
        // `⊦`: the goal spine, with one tactic branching off it.
        <path d="M2.2 1.3v7.4M2.2 5h6.3" />
      ) : mode === "tracks" ? (
        // `||`: the two aligned columns, as two bars of equal length.
        <path d="M3.2 1.3v7.4M8.8 1.3v7.4" />
      ) : (
        // `⑃`: one stem forking into two, the layered tree seen head-on.
        <path d="M6 1.3v2.9M6 4.2 2.2 8.7M6 4.2 9.8 8.7" />
      )}
    </svg>
  );
}

/** One of the bar's four VALUE items, as data — the two forms it can be drawn
in and every value it could show. The text form is `Name: value` for all four
— `prefix` is the NAME, always a word, never an icon; the icons are the glyph
form's business. `value` is the half that changes, and `values` is every string
it could be, which is what reserves its width. */
const BAR_VALUE_COUNT = 5;

interface BarValueItem {
  id: string;
  prefix: ReactNode;
  glyph: ReactNode;
  value: string;
  values: string[];
  title: string;
  accent?: boolean;
  /** The VALUE reads as OFF — dimmed, the way the width readout dims at
   `full`. Paint only: the reserve is unchanged, so nothing moves when a
   value turns off. */
  dim?: boolean;
  // The extras behind this item's menu, one per fixed slot (see `ExtraSlots`).
  slots?: boolean[];
  onAlt?: () => void;
  /** Controls drawn immediately AFTER this item's button, inside the same
   inline group — the tour's `‹ ›`. They ride both of `valueMenu`'s forms, so
   the ghost measures them with the item and the compaction stays honest. */
  after?: ReactNode;
}

function StatusBar({
  onPlace,
  onResetView,
  upToCursor,
  onUpToCursorChange,
  upToEnabled,
  layout,
  onLayoutChange,
  sideBySide,
  sbsEnabled,
  onSideBySideChange,
  gallery,
  onGalleryChange,
  reflow,
  forcedReflow,
  onReflowChange,
  barOpen,
  onBarOpenChange,
  brief,
  onBriefChange,
  onBriefHover,
  lintsOn,
  onLintsChange,
  polishOn,
  polishEnabled,
  polishWhy,
  onPolishChange,
  proposeEnabled,
  proposeBusy,
  proposeWhy,
  onPropose,
  commentMode,
  onCommentModeChange,
  combine,
  onCombineChange,
  hypMode,
  onHypModeChange,
  hypGroup,
  onHypGroupChange,
  tourLists,
  tourAt,
  tourCount,
  authorCount,
  myCount,
  onTourListToggle,
  onTourCycle,
  onTourStep,
  diag,
  helpOpen,
  onHelpOpenChange,
  caps,
  fontFamily,
}: {
  onPlace: (fill: boolean) => void;
  onResetView: () => void;
  upToCursor: boolean;
  onUpToCursorChange: (v: boolean) => void;
  upToEnabled: boolean;
  layout: LayoutMode;
  onLayoutChange: (v: LayoutMode) => void;
  sideBySide: boolean;
  sbsEnabled: boolean;
  onSideBySideChange: (v: boolean) => void;
  gallery: boolean;
  onGalleryChange: (v: boolean) => void;
  reflow: ReflowMode;
  forcedReflow?: number;
  onReflowChange: (v: ReflowMode) => void;
  barOpen: string | null;
  onBarOpenChange: (v: string | null) => void;
  brief: boolean;
  onBriefChange: (v: boolean) => void;
  onBriefHover: (h: boolean) => void;
  lintsOn: boolean;
  onLintsChange: (v: boolean) => void;
  polishOn: boolean;
  polishEnabled: boolean;
  polishWhy: string;
  onPolishChange: (v: boolean) => void;
  proposeEnabled: boolean;
  proposeBusy: boolean;
  proposeWhy: string;
  onPropose: () => void;
  commentMode: CommentMode;
  onCommentModeChange: (v: CommentMode) => void;
  combine: boolean;
  onCombineChange: (v: boolean) => void;
  hypMode: HypMode;
  onHypModeChange: (v: HypMode) => void;
  hypGroup: boolean;
  onHypGroupChange: (v: boolean) => void;
  tourLists: TourLists;
  tourAt: number | null;
  tourCount: number;
  authorCount: number;
  myCount: number;
  onTourListToggle: (which: "source" | "temp") => void;
  onTourCycle: () => void;
  onTourStep: (d: number) => void;
  diag: DiagBarProps | null;
  helpOpen: boolean;
  onHelpOpenChange: (v: boolean) => void;
  caps: Caps;
  fontFamily: string;
}) {
  // Where the open panel hangs from: the x its own item reported. Held here
  // rather than in `barOpen` because it is geometry, not view state — and the
  // rail's `"pick"` id shares that state without ever needing an x.
  const [menuX, setMenuX] = useState(0);
  const toggle = (id: string, x: number) => {
    setMenuX(x);
    onBarOpenChange(barOpen === id ? null : id);
  };
  const close = () => onBarOpenChange(null);
  const tip = useTip();

  const effReflow = forcedReflow ?? reflow;
  const reflowCols = forcedReflow ?? reflowToStop(reflow);
  const reflowMax = forcedReflow ? REFLOW_MAX_CHARS : REFLOW_OFF_STOP;
  // The VALUE is the number of columns and nothing else: the tracks layout's
  // override used to append `(tracks)`, which is 60px of the one row the bar
  // has, spent saying WHY the setting reads as it does. That belongs in the
  // title, which is where a reader asks the question.
  const widthValue = effReflow === "off" ? "full" : `${effReflow} col`;

  const commentName = COMMENT_MODES[commentMode].name;
  // `2/5` while reading; `–/5` (an EN DASH) before it has been started, and
  // `–/0` where the reading is empty — the count is a fact about the proof
  // either way, so it is always shown. NO LIST NAME: the two slots under the
  // item say which sets are in, so the value is just the place.
  // …and `off` where BOTH lists are off: there is no reading at all then, so
  // a count would be a fact about nothing. It is drawn as an OFF value — the
  // dimming `Width: full` wears — rather than accented away.
  const marksOff = !tourLists.source && !tourLists.temp;
  const tourValue = marksOff
    ? "off"
    : tourAt === null
      ? `–/${tourCount}`
      : `${Math.min(tourAt + 1, tourCount)}/${tourCount}`;
  const readingSlots = [brief, combine, upToCursor && upToEnabled, lintsOn];

  // A compact label is drawn in the TREE's code font, not the bar's system UI
  // font: these glyphs were designed to sit in that stack and several are
  // missing or ill-proportioned in the other. The `GlyphBox` is what stops
  // `glyphPx` — up to 19 — from reaching the item's own box.
  const glyph = (g: string, px = 13, w?: number) => (
    <GlyphBox w={w}>
      <span style={{ fontFamily, fontSize: px, lineHeight: 1 }}>{g}</span>
    </GlyphBox>
  );

  // THE FOUR VALUE ITEMS, in row order. Each can be drawn as words or as its
  // glyph, and the row decides per item (see `fit`).
  const valueItems: BarValueItem[] = [
    {
      id: "layout",
      prefix: "Layout:",
      glyph: (
        <GlyphBox>
          <LayoutGlyph mode={layout} />
        </GlyphBox>
      ),
      value: LAYOUT_MODES[layout].name,
      values: Object.values(LAYOUT_MODES).map((m) => m.name),
      title: `${LAYOUT_MODES[layout].title}. ⌥-click: next layout`,
      // No accent: the four layouts are a CHOICE AMONG EQUALS, and the item
      // already says which one is up. Only an item naming an enabled FEATURE
      // lights (Width alone now, the eye having gone over to slots).
      // The list's two TOGGLES take the two slots — side-by-side only where
      // it is effective, since in the wide layout it draws nothing.
      slots: [sbsEnabled && sideBySide, gallery],
      onAlt: () => onLayoutChange(LAYOUT_MODES[layout].next),
    },
    {
      id: "context",
      prefix: "Context:",
      glyph: glyph(HYP_MODES[hypMode].glyph, HYP_MODES[hypMode].glyphPx),
      value: HYP_MODES[hypMode].name,
      values: Object.values(HYP_MODES).map((m) => m.name),
      title: `${HYP_MODES[hypMode].title}. ⌥-click: next breadth`,
      // `Split data & props` is the OPT-IN extra — Lean's own binder order is
      // the default — so the one slot is lit when the split is SET.
      slots: [hypGroup],
      onAlt: () => onHypModeChange(HYP_MODES[hypMode].next),
    },
    {
      id: "comments",
      prefix: "Comments:",
      glyph: (
        <GlyphBox>
          <CommentGlyph />
        </GlyphBox>
      ),
      value: commentName,
      values: Object.values(COMMENT_MODES).map((m) => m.name),
      title: `Comments: ${commentName} — how a tactic's prose is drawn: as strips above the box, hidden, standing in for the tactic's own text, or GENERATED from the step itself (\u2234) where the author wrote none. ⌥-click: next`,
      onAlt: () => onCommentModeChange(COMMENT_MODES[commentMode].next),
    },
    {
      id: "reflow",
      prefix: "Width:",
      glyph: (
        <GlyphBox>
          <WidthGlyph />
        </GlyphBox>
      ),
      value: widthValue,
      // The widest the value can ever be: `full`, or three digits of columns.
      values: ["full", `${REFLOW_MAX_CHARS} col`],
      title: forcedReflow
        ? `Width: ${widthValue} — wrap at ${forcedReflow} columns, required by the tracks layout; click for the width slider`
        : `Width: ${widthValue} — wrap labels and context lines at a narrower width; click for the slider`,
      // Width DOES accent: unlike the choices above it names a feature that
      // is either on or off, and off ("full") is the tree's own wrapping.
      accent: effReflow !== "off",
    },
    // THE MARKS, last in the row and so the first to compact to its glyph —
    // it is the newest and the most transient of the five, and the two
    // chevrons beside it keep working in either form.
    {
      id: "tour",
      prefix: "Marks:",
      glyph: glyph("⚑", 12),
      value: tourValue,
      // Every value it could show: the widest is what the row reserves, so
      // stepping from 2/5 to 3/5 moves nothing to its right.
      values: ["–/99", "99/99", "off"],
      // The OFF value dims, exactly as `Width: full` does, instead of
      // reading as a place in a reading that is not happening.
      dim: marksOff,
      title: marksOff
        ? "Marks: off — both lists are off; click for the lists, ⌥-click cycles"
        : tourAt === null
          ? `Marks: an ordered reading of the proof, not started — ${authorCount} source mark${
              authorCount === 1 ? "" : "s"
            } (\`.mark\` in the source), ${myCount} temporary (the corner nub drops one, kept for this session); the two marks below say which of those lists is ON. \`<\` and \`>\` start it. Click for the two lists; ⌥-click cycles them (both → source → temp → none)`
          : `Marks: ${Math.min(tourAt + 1, tourCount)} of ${tourCount} — the two marks below say which lists are on (source, then temporary). \`<\` and \`>\` step, Esc lets go of the current mark. Click for the two lists; ⌥-click cycles them (both → source → temp → none)`,
      // NO ACCENT (user direction): the marks are a READING, not a mode that is
      // on, and the value already says how far into it you are. The two
      // SLOTS are the two TOGGLES — lit when the set is IN the reading, not
      // when it merely has stops: they look like switches, so they are.
      slots: [tourLists.source, tourLists.temp],
      after: (
        <>
          <BarButton
            // The chevrons are drawn by the same `glyph` helper the ⚑ uses,
            // and the SIZE is measured (see `CHEVRON_PX`). The BOX stays
            // `TEXT_GLYPH_BOX_W`, so nothing the row measured moves.
            label={glyph("‹", CHEVRON_PX, TEXT_GLYPH_BOX_W)}
            title={
              tourCount === 0
                ? "Previous mark (`<`) — no marks in the lists that are on"
                : "Previous mark (`<`)"
            }
            disabled={tourCount === 0}
            onClick={() => onTourStep(-1)}
          />
          <BarButton
            label={glyph("›", CHEVRON_PX, TEXT_GLYPH_BOX_W)}
            title={
              tourCount === 0
                ? "Next mark (`>`) — no marks in the lists that are on"
                : "Next mark (`>`)"
            }
            disabled={tourCount === 0}
            onClick={() => onTourStep(1)}
          />
        </>
      ),
      onAlt: onTourCycle,
    },
  ];

  /* THE ROW NEVER WRAPS, NEVER LOSES AN ITEM AND NEVER JUMPS FROM WORDS TO
  GLYPHS ALL AT ONCE. The first two were tried and reported: clipping
  (`overflow: hidden` alone) silently dropped everything past `Comments` at a
  432px frame, and wrapping bought that back by growing a second row over the
  tree, which is the one thing a bar living INSIDE the tree's own canvas must
  not do. The third — one boolean, so every word in the row vanished on the
  same pixel — was the reported "abrupt transition".

  So compaction is PER ITEM and runs RIGHT TO LEFT: `kText` is the number of
  leading value items drawn as words, the rest as glyphs, so as room runs out
  Width goes first, then Comments, then Context, then Layout. The three
  glyph-only items (the reading eye, `↺`, `?`) never change.

  It is MEASURED, never guessed from a breakpoint, off a hidden GHOST of both
  forms of every item:

    chromeW[i]  the text form with an EMPTY value — padding, prefix, gap,
                i.e. everything the value is not
    resv[i]     the widest that item's value could ever be, over EVERY value
                it can take (`Layout: outline` vs `tracks`, `intro`,
                `narrate`, `100 col`)
    glyphW[i]   the glyph form
    fixedW      the three glyph-only items as one group, gaps included

  `resv` is also what the real row RESERVES for each value, so a value item
  never changes width when its value changes: `used` → `intro` moves nothing
  to its right, and `▸` → `λ` cannot move anything either (the glyph box is a
  fixed width). textW[i] is then exactly chromeW[i] + resv[i].

  It CANNOT OSCILLATE: every measured width is independent of `kText` (the
  chrome ghost carries no value, the glyph boxes are fixed, `resv` is over the
  whole value set), and the room comes from the FRAME, not from the card's own
  content — so neither input moves when the output flips. No hysteresis. */
  const [kText, setKText] = useState(BAR_VALUE_COUNT);
  // Where the card sits: "right" beside the host button (the recorded
  // default), "center" in the frame, "fill" from the frame's left inset. All
  // three are decided in `fit` from the FRAME and the GHOST alone — never
  // from the card's own drawn box — so a placement can no more oscillate than
  // `kText` can.
  const [place, setPlace] = useState<"right" | "center" | "fill">("right");
  // Reached through a ref so `fit` (a stable callback) need not re-create
  // on every render of the parent; written in an effect, never in render.
  const onPlaceRef = useRef(onPlace);
  useEffect(() => {
    onPlaceRef.current = onPlace;
  });
  const [resv, setResv] = useState<number[]>(() =>
    Array.from({ length: BAR_VALUE_COUNT }, () => 0),
  );
  const cardRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const fit = useCallback(() => {
    const card = cardRef.current;
    const ghost = ghostRef.current;
    if (!card || !ghost) return;
    // A measurement with no boxes is declined for the reason `useFrameOffset`
    // declines one: a 0 there is the ABSENCE of an answer, not a width.
    if (card.getClientRects().length === 0) return;
    // The card is `fit-content`, so its OWN width is the answer to a different
    // question — it is what the row already draws. What the words have to fit
    // inside is the LANE: the frame, less the card's inset and the host
    // button's reserve (`BAR_MAX_W`), less the card's own padding and border.
    // `offsetParent` is the containing block the card's `100%` resolves
    // against, so this is that calc read back.
    const host = card.offsetParent as HTMLElement | null;
    const frame = host?.clientWidth ?? 0;
    const chrome = 2 * STATUS_PAD_X + 2;
    // TWO answers to "how much width has the row got", and which one holds is
    // itself measured (below, once the glyph row's width is known):
    //   lane  — dodging the host button, the recorded placement
    //   full  — the frame between the card's own two insets
    const lane = frame - (STATUS_INSET + BAR_RIGHT_RESERVE) - chrome;
    const full = frame - 2 * STATUS_INSET - chrome;
    if (full <= 0) return;

    const pick = (k: string) =>
      Array.from(ghost.querySelectorAll<HTMLElement>(`[data-g="${k}"]`));
    const wide = (els: HTMLElement[]) =>
      els.reduce((m, el) => Math.max(m, el.getBoundingClientRect().width), 0);
    const n = BAR_VALUE_COUNT;
    const idx = Array.from({ length: n }, (_, i) => i);
    const chromeW = idx.map((i) => wide(pick(`c${i}`)));
    const glyphW = idx.map((i) => wide(pick(`g${i}`)));
    const nextResv = idx.map((i) => Math.ceil(wide(pick(`v${i}`))));
    const fixedW = wide(pick("f"));
    if (fixedW <= 0) return;

    setResv((prev) =>
      prev.length === n && prev.every((v, i) => v === nextResv[i])
        ? prev
        : nextResv,
    );

    // Between the value items and the fixed group there is one gap per value
    // item; the group's own two are already inside `fixedW`, and an item's
    // `after` controls carry theirs inside its own measured width.
    const base = fixedW + n * STATUS_GAP;
    const need = (k: number) =>
      idx.reduce(
        (sum, i) => sum + (i < k ? chromeW[i] + nextResv[i] : glyphW[i]),
        base,
      );
    /* THE BAR FILLS THE FRAME, and dodging the host button is a placement it
    can only afford to make. `need(0)` is the row's FLOOR — every value item
    at its glyph, the three fixed items, the gaps — and where the lane beside
    the button cannot hold even that, dodging is not a placement at all: it
    is the row clipped down to whatever fits in the leftover strip, with the
    button's 110px of canvas left empty beside it. That is exactly what a
    thin panel reported (a ~280px frame leaves `lane` 148 against a floor of
    ~190: two glyphs, far left, empty to the right). So the dodge is
    CONDITIONAL on the floor fitting, and the fallback is the full frame. */
    const dodge = lane >= need(0);
    const avail = dodge ? lane : full;

    let k = 0;
    while (k < n && need(k + 1) <= avail) k++;
    setKText(k);

    /* AND WHERE THERE IS SLACK IT IS CENTRED. The recorded reason for the
    right anchor is that the gap from the row's last item (`?`) to the host's
    button must not move when a setting lengthens a value — the two are ONE
    ROW OF CHROME and the eye reads the gap between them. That reason is
    about the card being BESIDE the button, and it still holds there: as soon
    as centring would carry the card into (or within a button's reserve of)
    that lane, we go back to the anchor. Where the frame is wide enough that
    the card floats free of the lane, nothing is measured against its edges
    and the row belongs in the middle of the frame it labels rather than
    pushed into one corner. `cardW` is the row's own content plus the card's
    chrome — from the ghost, never from the card's drawn box, so the
    placement can never feed back into the width that chose it, and the
    `max-width` of each placement enforces its own precondition. */
    const cardW = need(k) + chrome;
    const next = !dodge
      ? "fill"
      : cardW <= frame - 2 * (BAR_RIGHT_RESERVE + BAR_CENTER_SLACK)
        ? "center"
        : "right";
    setPlace(next);
    onPlaceRef.current(next === "fill");
  }, []);

  // After EVERY render, because a setting's own label changes width…
  useLayoutEffect(fit);

  // …and when the frame resizes without a render of ours.
  useEffect(() => {
    const card = cardRef.current;
    const host = card?.offsetParent as HTMLElement | null;
    if (!card) return;
    // The card's own box no longer moves with the frame (it hugs its content),
    // so the frame is what has to be watched — with the card kept as a
    // fallback for a mount where it has no offsetParent yet.
    const ro = new ResizeObserver(fit);
    ro.observe(host ?? card);
    return () => ro.disconnect();
  }, [fit]);

  // One value item. `text` picks the form; `value` overrides what it shows
  // (the ghost's chrome copy passes the empty string, so what it measures is
  // everything BUT the value, the value span still there to carry its gap).
  const valueMenu = (i: number, text: boolean, value?: string) => {
    const it = valueItems[i];
    const shown = value ?? it.value;
    const menu = (
      <BarMenu
        key={it.id}
        label={
          text ? (
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              {it.prefix}
              <span
                style={{
                  display: "inline-block",
                  textAlign: "left",
                  width: value === "" ? 0 : resv[i] || undefined,
                  opacity: it.dim ? 0.6 : 1,
                }}
              >
                {shown}
              </span>
            </span>
          ) : (
            it.glyph
          )
        }
        title={it.title}
        accent={it.accent}
        slots={it.slots}
        onToggle={(x) => toggle(it.id, x)}
        onAlt={it.onAlt}
      />
    );
    if (!it.after) return menu;
    return (
      <span
        key={it.id}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: STATUS_GAP,
        }}
      >
        {menu}
        {it.after}
      </span>
    );
  };

  // The three items that are ALWAYS glyphs, as one group: the row's gaps run
  // through it, so measuring it whole counts them.
  const fixedItems = (
    <>
      {/* The row's group boundaries: the four value menus say how the tree
          is DRAWN, the eye how much of each node you are asked to READ, `↺`
          is an action rather than a setting at all, and `?` is the index. */}
      <BarDivider />
      <BarMenu
        label={
          <GlyphBox>
            <EyeGlyph />
          </GlyphBox>
        }
        title="Reading options — brief, merge, lints, polish, a suggested rewrite, to cursor; the four marks below say which of brief, merge, to cursor and lints are on"
        // NO ACCENT: its three toggles take three SLOTS instead, which say
        // WHICH are up where the pill only ever said "at least one".
        slots={readingSlots}
        onToggle={(x) => toggle("reading", x)}
      />
      <BarDivider />

      {/* `↺` (U+21BA) for reset — measured at 12px in the system UI font it
          inks 9x11 against a tofu box's 12x15. The title keeps the word. */}
      <BarButton
        label={<GlyphBox w={TEXT_GLYPH_BOX_W}>↺</GlyphBox>}
        title="Reset tree — the view the source asks for (folds and skips from its flags, no scoping)"
        onClick={onResetView}
      />
      {/* …and the third boundary: `?` is the INDEX of the row, not a member
          of it. It is declared apart (the diagnostics block drifts in between
          the two in the real row) but the rule belongs to this group, whose
          ghost is what `fit` measures. */}
      <BarDivider />
    </>
  );

  // The reference is not a feature, it is the index of them — so it rides the
  // bar's own end rather than a rail slot of its own. It is declared apart
  // from the rest only because the diagnostics block sits between them in the
  // row; the GHOST must still carry it, or the row measures short of what it
  // draws and clips the last button off (measured at a 504px frame).
  const helpBtn = (
    <BarButton
      label={<GlyphBox w={TEXT_GLYPH_BOX_W}>?</GlyphBox>}
      title="What you can do here: every gesture on the tree, in one panel (?)"
      accent={helpOpen}
      onClick={() => onHelpOpenChange(!helpOpen)}
    />
  );

  return (
    // A FLOATING CARD, not a native-looking status bar: this lives inside the
    // infoview document, where a full-width strip would claim to be VS Code's
    // own. It is AS WIDE AS ITS CONTENT — a card stretched across the lane
    // reads as a strip claiming room it is not using, and the horizontal
    // slack sat between the settings and the diagnostics item. `max-width`
    // stops it short of the card's own 8px inset on the left, and it is that
    // lane, not the card's own width, that `fit` measures the words against.
    <div
      ref={cardRef}
      style={{
        position: "absolute",
        /* THREE PLACEMENTS, ONE DECISION (`fit`), and the middle one is the
        recorded default:

        "right" — ANCHORED ON ITS RIGHT EDGE at the host button's own
        reserve, so the gap between the row's last item (`?`) and the
        "Restart File" button is a CONSTANT whatever the row is carrying.
        Left-anchored the card grew rightward, so every setting that
        lengthened a value moved the end of the row closer to the button;
        the growth goes LEFTWARD instead, into empty canvas where nothing is
        measured against it. That reason is about being BESIDE the button,
        and it governs whenever the card is anywhere near that lane.

        "center" — where the frame is wide enough that a centred card clears
        the button's lane by a whole reserve, the card is not beside the
        button at all, nothing is measured against either of its edges, and
        the row belongs in the middle of the frame it labels. Its growth is
        then symmetric, half a value's length to each side.

        "fill" — where the frame is too thin to hold the glyph row beside
        the button, the dodge stops: the card takes the frame between its
        own insets and the host button floats where it floats. An empty
        button-sized strip beside a clipped two-glyph row was the report
        this answers. */
        ...(place === "right"
          ? { right: BAR_RIGHT_RESERVE, left: "auto" }
          : place === "fill"
            ? { left: STATUS_INSET, right: "auto" }
            : { left: "50%", right: "auto", transform: "translateX(-50%)" }),
        // IN THE HOST BUTTON'S OWN LANE — its inset and its height, so the
        // card and the "Restart File" button read as one row of chrome and
        // the frame above them can take all the room there is. A fixed
        // `height`, never a minimum: see BAR_ITEM_H. The FILLING card is the
        // exception: it spans the frame, so in the button's lane the button
        // (the host's, drawn over us) hid the row's last items — measured in
        // a 424px pane: `?` and ↺ under it. It goes one lane UP instead, a
        // second row of chrome, and the rail climbs over it (`lifted`).
        bottom: place === "fill" ? BAR_LIFT : LANE_INSET,
        width: "fit-content",
        // Each placement's own ceiling, and each one enforces the precondition
        // `fit` chose it under: the centred card cannot reach the button's
        // lane however wide the diagnostics block runs, and the filling card
        // cannot pass the frame's far inset.
        maxWidth:
          place === "right"
            ? BAR_MAX_W
            : place === "fill"
              ? BAR_FILL_MAX_W
              : BAR_CENTER_MAX_W,
        height: BAR_H,
        zIndex: 10,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        lineHeight: 1,
        whiteSpace: "nowrap",
        ...POPUP_CHROME,
        padding: `${STATUS_PAD_Y}px ${STATUS_PAD_X}px`,
        borderRadius: 4,
        border: "1px solid var(--vscode-editorWidget-border, #cbd5e0)",
        // A LIFT, not just an outline. The card floats over the tree's own
        // canvas, so the hairline alone left it reading as ink drawn on the
        // page; this is the popovers' shadow one step deeper, which is what
        // separates the card from whatever the tree happens to draw beneath
        // it. The popovers keep POPUP_CHROME's own 0.25.
        boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
        color: "var(--vscode-icon-foreground, #2d3748)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "nowrap",
          alignItems: "center",
          gap: STATUS_GAP,
          flex: "1 1 auto",
          minWidth: 0,
          height: BAR_ITEM_H,
          // The last resort under the all-glyph row, which is itself the last
          // resort under the words: a frame too narrow even for the glyphs
          // clips rather than spilling out of the card. A clip-path, NOT
          // `overflow: hidden`: the EXTRAS SLOTS hang 1px below the 20px item
          // (`bottom: -1`, into the card's padding), and overflow clips both
          // axes — measured in the real infoview, the marks drew 1.9px tall
          // against 2.9 wide, the reported "not squares", while every rect
          // measurement said 2.9 × 2.9. The inset clips the sides only.
          clipPath: "inset(-4px 0 -4px 0)",
        }}
      >
        {Array.from({ length: BAR_VALUE_COUNT }, (_, i) =>
          valueMenu(i, i < kText),
        )}
        {fixedItems}

        {diag && (
          <div
            style={{
              flex: "0 1 auto",
              minWidth: 0,
              maxWidth: 320,
              marginLeft: "auto",
              paddingLeft: 6,
            }}
          >
            <DiagnosticItem {...diag} />
          </div>
        )}

        {helpBtn}
      </div>

      {/* The measurement, not a second bar: laid out at its natural width,
          painted nowhere, and out of the tab order. */}
      <div
        ref={ghostRef}
        aria-hidden
        inert
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "max-content",
          display: "flex",
          flexWrap: "nowrap",
          alignItems: "center",
          gap: STATUS_GAP,
          visibility: "hidden",
          pointerEvents: "none",
        }}
      >
        {/* Every item's CHROME — the text form with the value emptied out,
            so what this measures is padding, prefix and gap. */}
        {Array.from({ length: BAR_VALUE_COUNT }, (_, i) => (
          <span key={`c${i}`} data-g={`c${i}`}>
            {valueMenu(i, true, "")}
          </span>
        ))}
        {/* …and its glyph form. */}
        {Array.from({ length: BAR_VALUE_COUNT }, (_, i) => (
          <span key={`g${i}`} data-g={`g${i}`}>
            {valueMenu(i, false)}
          </span>
        ))}
        {/* Every value each item could show, bare: the widest is what the
            real row RESERVES, so changing a setting moves nothing. */}
        {valueItems.flatMap((it, i) =>
          it.values.map((v) => (
            <span key={`v${i}-${v}`} data-g={`v${i}`}>
              {v}
            </span>
          )),
        )}
        {/* The always-glyph tail, as one group so its own gaps are counted. */}
        <span
          data-g="f"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: STATUS_GAP,
          }}
        >
          {fixedItems}
          {helpBtn}
        </span>
      </div>

      {helpOpen && (
        <HelpPanel
          caps={caps}
          fontFamily={fontFamily}
          onClose={() => onHelpOpenChange(false)}
          // Hung from the card's LEFT edge, not its right — and STILL, now
          // that the card is right-anchored. `right: 0` would give the panel
          // a fixed x, but the card's right edge is `BAR_RIGHT_RESERVE` in
          // from the frame's, so a 420px panel hung from there runs off the
          // frame's LEFT on a narrow panel (measured at a 480px viewport:
          // left −86; at a 460px frame it is still −30). Hung from the card's
          // left edge it lands on screen at every width the row compacts
          // through, which is the only thing this anchor has to promise.
          anchor={{ left: 0, bottom: "100%", marginBottom: 4 }}
        />
      )}

      {barOpen === "layout" && (
        <BarPanel left={menuX}>
          {(Object.keys(LAYOUT_MODES) as LayoutMode[]).map((m) => (
            <BarRow
              key={m}
              label={LAYOUT_MODES[m].name}
              title={LAYOUT_MODES[m].title}
              on={layout === m}
              onClick={() => {
                onLayoutChange(m);
                close();
              }}
            />
          ))}
          <MenuDivider />
          {/* Below the divider the rows are TOGGLES, not a choice, so they
              leave the popover open — you may want both. */}
          <BarRow
            label="side-by-side"
            title={
              sbsEnabled
                ? "Draw a split's subtrees as columns"
                : "Side-by-side needs a compact layout; the wide tree lays branches out itself"
            }
            on={sbsEnabled && sideBySide}
            disabled={!sbsEnabled}
            onClick={() => onSideBySideChange(!sideBySide)}
          />
          <BarRow
            label="gallery"
            title="Show one subtree at a time, with a pager"
            on={gallery}
            onClick={() => onGalleryChange(!gallery)}
          />
        </BarPanel>
      )}

      {barOpen === "context" && (
        <BarPanel left={menuX} width={190}>
          {(Object.keys(HYP_MODES) as HypMode[]).map((m) => (
            <BarRow
              key={m}
              label={HYP_MODES[m].name}
              title={HYP_MODES[m].title}
              on={hypMode === m}
              onClick={() => {
                onHypModeChange(m);
                close();
              }}
            />
          ))}
          <MenuDivider />
          <BarRow
            label="Split data & props"
            title="Draw each goal's context as data first, then propositions, with a divider (default: Lean's own binder order)"
            on={hypGroup}
            onClick={() => onHypGroupChange(!hypGroup)}
          />
        </BarPanel>
      )}

      {barOpen === "comments" && (
        <BarPanel left={menuX}>
          {(
            [
              ["shown", "show", "Comments drawn as strips above the box"],
              [
                "hidden",
                "hide",
                "No comment strips; the room goes back to the tree",
              ],
              [
                "instead",
                "instead",
                "A commented tactic's prose stands in for its label, inside the box",
              ],
              [
                "narrate",
                "narrate",
                "Strips as above, and where the author wrote none a line generated from the step itself (∴); a folded goal's strip summarises what it hides",
              ],
            ] as const
          ).map(([v, label, title]) => (
            <BarRow
              key={v}
              label={label}
              title={title}
              on={commentMode === v}
              onClick={() => {
                onCommentModeChange(v);
                close();
              }}
            />
          ))}
        </BarPanel>
      )}

      {barOpen === "tour" && (
        <BarPanel left={menuX} width={210}>
          {/* TWO TOGGLES, not a choice among three: each says whether that
              set is IN the reading, and the reading is their union. Toggles,
              so the rows leave the panel open; with both off the bar item
              reads `off` and the chevrons grey. */}
          <BarRow
            label={`source (${authorCount})`}
            title="The marks the file carries as `.mark` — bare, or `.mark 3` for an explicit rank"
            on={tourLists.source}
            onClick={() => onTourListToggle("source")}
          />
          <BarRow
            label={`temporary (${myCount})`}
            title="The marks dropped from a box's top-left nub, in source order; kept for this session only — ⌥-click on the nub writes one into the source"
            on={tourLists.temp}
            onClick={() => onTourListToggle("temp")}
          />
        </BarPanel>
      )}

      {barOpen === "reading" && (
        <BarPanel left={menuX} width={196}>
          {/* Toggles, so every row leaves the panel open. `brief`'s hover is
              what drives the in-place underline preview of what it would
              elide, so the row carries it. */}
          <BarRow
            label="brief"
            title="Hide boilerplate inside each tactic's own text"
            on={brief}
            onClick={() => onBriefChange(!brief)}
            onHover={onBriefHover}
          />
          <BarRow
            label="merge"
            title="One node per straight run of tactics"
            on={combine}
            onClick={() => onCombineChange(!combine)}
          />
          {/* D4. OFF by default and never fired unasked: the answer costs the
              server one re-elaboration of the declaration, which is why it is
              a reading option and not a payload field. */}
          <BarRow
            label="lints"
            title="Show Mathlib's own style linters on the steps they object to — the declaration is re-elaborated once to ask"
            on={lintsOn}
            onClick={() => onLintsChange(!lintsOn)}
          />
          {/* C4. Mirrors `ramify.narration.polish` for THIS session: the
              setting is the default, the row is the override, and neither
              writes the other. Disabled where there is no companion or no
              key, with the title saying which — the reader who has met the
              setting should find out where it went, the `goals as TeX` rule
              said again. */}
          <BarRow
            label="polish"
            title={polishWhy}
            on={polishOn}
            disabled={!polishEnabled}
            onClick={() => onPolishChange(!polishOn)}
          />
          {/* D6. An ACTION, not a setting: it asks once, on the proof in
              front of you, and the answer is a proposal pill on a node —
              the same pill, the same `checkRewrite` gate, the same undo. */}
          <BarRow
            label={proposeBusy ? "suggesting…" : "suggest a rewrite"}
            title={proposeWhy}
            disabled={!proposeEnabled}
            onClick={onPropose}
          />
          <BarRow
            label="to cursor"
            title={
              upToEnabled
                ? "Draw only down to the editor cursor"
                : "To cursor needs the editor cursor"
            }
            on={upToCursor && upToEnabled}
            disabled={!upToEnabled}
            onClick={() => onUpToCursorChange(!upToCursor)}
          />
          {/* C1, THE SEAM AND NOTHING ELSE. The `latex` sidecar exists on both
              wires and is always empty: kmill/LeanTeX does not build against
              Lean v4.32.2 (three incompatibilities, all recorded). The row is
              drawn rather than hidden because a reader who has met the idea —
              the roadmap's "goal boxes' reading form" — should find out where
              it went and why, and because the row is the thing the printer
              will switch on the day it builds. It carries no state, so there
              is nothing to toggle and nothing for `remapIds` or the view stash
              to know about. */}
          <BarRow
            label="goals as TeX"
            title="Needs LeanTeX, which is not built for this toolchain (Lean v4.32.2)"
            disabled
            onClick={() => {}}
          />
        </BarPanel>
      )}

      {barOpen === "reflow" && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            bottom: "100%",
            left: menuX,
            marginBottom: 4,
            zIndex: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxSizing: "border-box",
            ...POPUP_CHROME,
            padding: "5px 9px",
            border: "1px solid var(--vscode-editorWidget-border, #cbd5e0)",
            color: "var(--vscode-icon-foreground, #2d3748)",
            fontSize: 11,
            whiteSpace: "nowrap",
            cursor: "default",
          }}
        >
          <input
            type="range"
            min={REFLOW_MIN_CHARS}
            max={reflowMax}
            step={1}
            value={reflowCols}
            {...tip.props(
              forcedReflow
                ? `Wrap at ${forcedReflow} columns, required by the tracks layout`
                : "Wrap labels and context lines at this many columns (right end = full width)",
            )}
            onChange={(e) =>
              onReflowChange(stopToReflow(Number(e.target.value)))
            }
            style={{ width: 130, accentColor: "var(--ptw-accent)" }}
          />
          <span
            style={{
              width: 46,
              textAlign: "right",
              fontFamily: "monospace",
              opacity: effReflow === "off" || forcedReflow ? 0.6 : 1,
            }}
          >
            {effReflow === "off" ? "full" : `${effReflow} col`}
          </span>
        </div>
      )}
    </div>
  );
}

function PickerRow({
  options,
  onPick,
  onCancel,
}: {
  options: CalcRelOption[];
  onPick: (o: CalcRelOption) => void;
  onCancel: () => void;
}) {
  const fam = getCodeFontFamily();
  let cursor = -CHIP_W_ADD / 2;
  const chips: React.ReactNode[] = [];
  const push = (
    key: string,
    glyph: string,
    title: string,
    color: string,
    onClick: () => void,
  ) => {
    const width = chipWidth(glyph, PICK_FONT_PX);
    chips.push(
      <FrontierChip
        key={key}
        glyph={glyph}
        title={title}
        x={cursor}
        width={width}
        fontSize={PICK_FONT_PX}
        fontFamily={fam}
        color={color}
        onPick={onClick}
      />,
    );
    cursor += width + CHIP_GAP;
  };
  push("cancel", "×", "cancel", "var(--ptw-comment)", onCancel);
  for (const o of options) {
    push(
      o.rel,
      o.rel,
      o.same
        ? `one \`${o.rel}\` link — the relation this goal is in, so the chain can end on it`
        : `one \`${o.rel}\` link — a step on the way; the chain stays open and \`step\` continues it`,
      NODE_STYLES.tactic.stroke,
      () => onPick(o),
    );
  }
  return <>{chips}</>;
}

function FrontierChip({
  glyph,
  title,
  x,
  width,
  color,
  fontSize = 12,

  fontFamily = "monospace",
  solid,
  onPick,
}: {
  glyph: string;
  title: string;
  x: number;
  width: number;
  color: string;
  fontSize?: number;
  fontFamily?: string;

  solid?: boolean;
  onPick: () => void;
}) {
  const tip = useTip();
  return (
    <g
      transform={`translate(${x},0)`}
      style={{ cursor: "pointer" }}
      {...tip.props(title)}

      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <rect
        x={0}
        y={0}
        width={width}
        height={CHIP_H}
        rx={4}
        fill="transparent"
        stroke={color}
        strokeWidth={1.2}
        strokeDasharray={solid ? undefined : "3 2"}
      />
      <text
        x={width / 2}
        y={CHIP_H / 2}
        textAnchor="middle"
        dy="0.32em"
        fontSize={fontSize}
        fontFamily={fontFamily}
        fill={color}
        style={{ userSelect: "none", letterSpacing: 0 }}
      >
        {glyph}
      </text>
    </g>
  );
}

function GalleryPager({
  index,
  count,
  label,
  x,
  onStep,
}: {
  index: number;
  count: number;
  label: string;
  x: number;
  onStep: (delta: number) => void;
}) {
  const arrow = (dx: number, glyph: string, at: number) => (
    <g
      transform={`translate(${at},0)`}
      style={{ cursor: "pointer" }}

      onClick={(e) => {
        e.stopPropagation();
        onStep(dx);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <rect
        x={0}
        y={0}
        width={PAGER_ARROW_W}
        height={PAGER_H}
        fill="transparent"
      />
      <text
        x={PAGER_ARROW_W / 2}
        y={PAGER_H / 2}
        textAnchor="middle"
        dy="0.32em"
        fontSize={11}
        fontFamily="monospace"
        fill="var(--vscode-icon-foreground, #6b7280)"
        style={{ userSelect: "none" }}
      >
        {glyph}
      </text>
    </g>
  );
  return (
    <g transform={`translate(${x},0)`}>
      <title>{`branch ${index + 1} of ${count}${label ? `: ${label}` : ""} — ‹ › to cycle`}</title>
      <rect
        x={0}
        y={0}
        width={PAGER_W}
        height={PAGER_H}
        rx={3}
        fill="var(--vscode-editorWidget-background, #f3f4f6)"
        stroke="var(--vscode-editorWidget-border, #d1d5db)"
        strokeWidth={1}
      />
      {arrow(-1, "‹", 0)}
      <text
        x={PAGER_ARROW_W + PAGER_LABEL_W / 2}
        y={PAGER_H / 2}
        textAnchor="middle"
        dy="0.32em"
        fontSize={10}
        fontFamily="monospace"
        fill="var(--vscode-icon-foreground, #6b7280)"
        style={{ userSelect: "none" }}
      >
        {`${index + 1}/${count}`}
      </text>
      {arrow(1, "›", PAGER_ARROW_W + PAGER_LABEL_W)}
    </g>
  );
}

const BAR_BTN = 20;
const BAR_PAD = 3;
const BAR_GAP = 2;
const BAR_OVERLAP = 5;
/** The path gesture's `⊹` is the one glyph in the hover bar that needs its own
size: at the shared 13 it inks 7x8 against `⧉`'s 10x9 and the drawn icons'
8-9 — the thinnest and narrowest mark in the row — and at 15 it inks 9x9,
inside 1px of every neighbour's ink height. Equal INK, not equal font size (`RailButton`'s
own rule). */
const PATH_GLYPH_PX = 15;
/** A hover bar is GLYPH BUTTONS with tooltips and nothing else (in-page tips,
not `<title>`s: tipController.ts says why). A dwell row
of words under them was tried and removed: the bar appears on hover over every
box in the tree, so a row that grows the card under the pointer moves the very
buttons it is naming, and it says on every node what the tooltip says on the
one you are aiming at. The vocabulary lives in `?` (the gesture panel), which
reads the same `nodeHints` list. */
/** A trash can in the shape VS Code's own codicon `trash` draws it — a flat
lid line with a small centred handle, a PLAIN rectangular body (no taper), two
short ribs — drawn rather than typed: no code font carries a can, and the ⊘
that used to stand here says "forbidden", not "delete". Stroked in
`currentColor` so the bar's `danger` ink reaches it unchanged.

Its size is set by the NEIGHBOURS, not by a nominal icon box: measured on the
raster at the bar's own 13px, `⧉` inks 9px tall and the skip box 9 (its 9-unit
rect plus the stroke), so the paths span 7.5 units and the stroke brings the
drawn ink to **8.4** — inside 1px of both.
The taper and the 10.5px ink an earlier version drew made one button visibly
bigger than every glyph beside it.

The STROKE is 0.9, not the 1.25 it was: a can is five strokes inside 7.5 units,
so the same weight that reads as one line on a hairline glyph reads as a solid
block here,
and beside the hairline glyphs it looked like a different, heavier vocabulary.
If it ever reads muddy at 12px the answer is a SIMPLER shape (lid line, open
rectangle, one rib) — never a thicker stroke, which is the change that put it
out of key with its neighbours in the first place. */
/* The skip button is the AXIS BREAK in miniature, drawn as the real one is:
the line runs into the centre of the upper slant and out of the centre of the
lower one, with the two slants 3.6 px apart — the gap the eye reads (a 1.2 px
one read as a crossed line; user report). Stroke 0.9 like the can, so the
drawn buttons read as one vocabulary. */
function SkipIcon() {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={0.9}
      strokeLinecap="round"
    >
      <path d="M0 -4.8 V-1.8 M0 1.8 V4.8" />
      <path d="M-2.6 -0.6 L2.6 -3 M-2.6 3 L2.6 0.6" />
    </g>
  );
}

function TrashIcon() {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={0.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* lid, with its small centred handle */}
      <path d="M-4.3 -2.8 H4.3" />
      <path d="M-1.5 -2.8 V-3.9 H1.5 V-2.8" />
      {/* body — a plain rectangle */}
      <path d="M-3.2 -2.8 V3.6 H3.2 V-2.8" />
      {/* the two ribs */}
      <path d="M-1.15 -0.8 V2" />
      <path d="M1.15 -0.8 V2" />
    </g>
  );
}

interface NodeAction {
  /** Also the button's React key, so it must be unique within one bar. */
  glyph: string;
  /** Drawn INSTEAD of `glyph` when present (the glyph still keys the button). */
  icon?: ReactNode;
  /** Font size for THIS glyph, where the shared 13 does not ink like the rest
   of the bar — the `RailButton.glyphPx` rule, and for the same reason: the
   target is equal INK height, not equal font size. `⊹` is the one user
   (measured on the raster: 7x8 of ink at 13, 9x9 at 15, against `⧉`'s 10x9
   and the drawn skip box's 9). */
  glyphPx?: number;
  title: string;
  onClick: () => void;
  /** ⌥-click, where the button has a second reading (⚑: drop MY stop, or
   write the author's `.mark` into the source). Absent, ⌥ is a plain click. */
  onAlt?: () => void;
  onHover?: (on: boolean) => void;
  danger?: boolean;
}
function NodeActionBar({
  placement = "top-right",
  x,
  y,
  actions,
}: {
  placement?: "top-right" | "right";
  x: number;
  y: number;
  actions: NodeAction[];
}) {
  const cell = BAR_BTN;
  const w =
    actions.length * cell + (actions.length - 1) * BAR_GAP + 2 * BAR_PAD;
  const h = BAR_BTN + 2 * BAR_PAD;
  const { ctl } = useTip();
  const x0 = placement === "right" ? x : x - w;
  const y0 =
    placement === "right"
      ? y - (BAR_BTN + 2 * BAR_PAD) / 2
      : y - h + BAR_OVERLAP;
  return (
    <g data-ptw-bar="">
      <rect
        x={x0}
        y={y0}
        width={w}
        height={h}
        rx={3}
        fill="var(--vscode-editorWidget-background, #fff)"
        stroke="var(--vscode-editorWidget-border, #cbd5e0)"
      />
      {actions.map((a, i) => {
        const cx = x0 + BAR_PAD + i * (cell + BAR_GAP) + cell / 2;
        const bx = cx - BAR_BTN / 2;
        const ink = a.danger
          ? DANGER_FILL
          : "var(--vscode-icon-foreground, #2d3748)";
        return (
          <g
            key={a.glyph}
            onClick={(e) => {
              e.stopPropagation();
              if (a.onAlt && e.altKey) a.onAlt();
              else a.onClick();
            }}
            aria-label={a.title}
            onPointerEnter={(e) => ctl.enter(e.currentTarget)}
            onPointerLeave={(e) => ctl.leave(e.currentTarget)}
            onMouseEnter={a.onHover ? () => a.onHover!(true) : undefined}
            onMouseLeave={a.onHover ? () => a.onHover!(false) : undefined}
            style={{ cursor: "pointer" }}
          >
            <rect
              x={bx}
              y={y0 + BAR_PAD}
              width={BAR_BTN}
              height={BAR_BTN}
              rx={2}
              fill="var(--vscode-toolbar-hoverBackground, #f7fafc)"
              stroke="var(--vscode-editorWidget-border, #e2e8f0)"
            />
            {a.icon ? (
              <g
                transform={`translate(${cx},${y0 + BAR_PAD + BAR_BTN / 2})`}
                color={ink}
              >
                {a.icon}
              </g>
            ) : (
              <text
                x={cx}
                y={y0 + BAR_PAD + BAR_BTN / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={a.glyphPx ?? 13}
                fontFamily="monospace"
                fill={ink}
              >
                {a.glyph}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
