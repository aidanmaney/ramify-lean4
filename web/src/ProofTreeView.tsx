import {
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
  HYP_MARK_W,
  HYP_SEP_H,
  LINE_H,
  NODE_FONT_PX,
  NODE_PAD,
  NODE_PAD_Y,
  ARROW_GAP,
  TRUNK_INSET,
  CHIP_LANE_H,
  CHIP_TOP_GAP,
  COMMENT_FONT_PX,
  COMMENT_LINE_H,
  COMMENT_INDENT,
  CASE_FONT_PX,
  CASE_LINE_H,
  getCodeFontFamily,
  refreshCodeFontFamily,
  measureText,
  measureNode,
  REFLOW_CHARS,
  REFLOW_MIN_CHARS,
  REFLOW_MAX_CHARS,
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
  CalcRelOption,
  Proof,
  ProofStepPosition,
  TacticSlot,
} from "./paperproof";
import { stepGoalsAfter } from "./paperproof";
import { PLACEHOLDER, calcOpenSlots, calcOpenText } from "./calcEdit";
import {
  completionsAt,
  type CompletionItem,
  type CompletionPools,
} from "./completion";
import { layoutKeys } from "./layoutKey";
import type {
  AddResult,
  AddSpec,
  CombinedPart,
  DeleteSpec,
  HypLine,
  PlacedNode,
  TextSlot,
  TreeNode,
  WrappedLine,
} from "./types";
import { deleteExtent, type DeleteExtent } from "./deleteEdit";
import { attachDiagnostics, type TreeDiagnostic } from "./diagnostics";
import {
  positionContains,
  proofToTree,
  rootIds,
  tacticNodeAt,
  tacticTargets,
  posLE,
} from "./proofToTree";
import type { HypMode } from "./proofToTree";
import {
  type ElideCut,
  applyElisions,
  combineRuns,
  cutId,
  pathIds,
  pruneCuts,
  resolveCut,
  stepElidable,
} from "./elide";
import {
  ACCENT_TEXT,
  CASE_FILL,
  COMMENT_FILL,
  EDIT_BG,
  EDIT_TEXT,
  HYP_MARK_FILL,
  HYP_UNUSED_FILL,
  HYP_USED_FILL,
  LINK_STROKE,
  MUTED_FILL,
  NODE_STYLES,
  NODE_TEXT,
  RAIL_PRESSED,
  SEQ_STROKE,
  SORRY_FILL,
  DANGER_FILL,
  WARN_FILL,
  TOKEN_VARS,
  ensurePaletteStyle,
  observeThemeChange,
  resolveThemeKind,
} from "./theme";

// The interactive proof tree: layout, folding, zoom/scroll, and the SVG render.
// It is deliberately source-agnostic — it takes a single `Proof` and knows
// nothing about where it came from. The standalone app (App.tsx) feeds it a
// proof parsed from NDJSON; the Lean infoview widget (widget.tsx) feeds it a
// proof fetched over RPC and additionally wires the node↔source link via
// `onReveal` (tree→source) and `highlightPos` (source→tree).

// Snapshot taken on fold/unfold so we can re-anchor the scroll position to the
// toggled node after the relayout (see `toggle`). `key` is what actually
// matches it across the relayout — see `layoutKeys`.
interface Anchor {
  id: string;
  key: string;
  x: number;
  y: number;
}

// Sequence ("linearize a path") mode. `pick` selects two endpoints; `view`
// shows the linear path between the chosen ancestor (`from`) and descendant
// (`to`). See the layout engine's `pathBetween` / `computeLayout(only)`.
type Seq =
  | { mode: "off" }
  | { mode: "pick"; from: string | null }
  | { mode: "view"; from: string; to: string };

const MARGIN = { top: 80, right: 90, bottom: 40, left: 90 };
// The gap (content px) left of the trunk in compact mode — both the default
// scroll position and where a tracked node is nudged to. Much tighter than
// MARGIN.left so the left-aligned trunk sits near the edge, not floating in
// from a full margin.
const COMPACT_LEFT = 16;
// Goals cool blue, tactics warm green — both several steps more saturated than
// the old near-white pastels so the two node kinds read apart at a glance (the
// yellow hyp labels and the orange accent stay distinct from both).
// Every drawable colour resolves from the editor's theme; see theme.ts.

// The hyp-mode cycle, ordered by increasing breadth so repeated clicks widen
// the context and then wrap back. The glyph shows the CURRENT mode rather than
// a fixed icon: with three states there is no on/off to read from a pressed
// style alone.
const HYP_MODES: Record<
  HypMode,
  { glyph: string; title: string; next: HypMode }
> = {
  used: {
    glyph: "▸",
    title:
      "Context: only hypotheses the rest of the proof below actually uses (click for only the ones the tactic above introduced)",
    next: "new",
  },
  new: {
    glyph: "↓",
    title:
      "Context: only hypotheses the preceding tactic introduced as a binding (click for those plus what the next tactic uses)",
    next: "delta",
  },
  delta: {
    glyph: "Δ",
    title:
      "Context: hypotheses this goal introduced, plus any its tactic uses (click for the full context)",
    next: "full",
  },
  full: {
    glyph: "∀",
    title: "Context: every hypothesis in scope (click for only the used ones)",
    next: "used",
  },
};

// The layout cycle, on the rail button that used to be the compact↔wide
// toggle. Three states, so it follows HYP_MODES' shape: the glyph shows the
// CURRENT mode (three states can't be read off a pressed style), pressed
// means "not home". `stacked` is home — the reading mode — so the cycle
// offers the departures in order of distance from it: the spine is compact
// with the tactics stood aside, wide is a different layout entirely.
type LayoutMode = "stacked" | "spine" | "tracks" | "wide";
const LAYOUT_MODES: Record<
  LayoutMode,
  { glyph: string; title: string; next: LayoutMode }
> = {
  stacked: {
    glyph: "☰",
    title:
      "Layout: compact outline — every node on its own line off a left trunk (click for the goal spine: goals tight on the left, tactics in their own track to the right)",
    next: "spine",
  },
  spine: {
    glyph: "⊦",
    title:
      "Layout: goal spine — two tracks, goals stacked tight on the left and each tactic beside its step in a right-hand track (click for aligned tracks: goals wrapped to a modest width, every tactic at one x)",
    next: "tracks",
  },
  tracks: {
    glyph: "∥",
    title:
      "Layout: aligned tracks — the spine with goals wrapped to a modest width, so every tactic starts at the SAME x and the two tracks read as columns (click for the wide layered tree)",
    next: "wide",
  },
  wide: {
    glyph: "⋔",
    title:
      "Layout: wide layered tree — Sugiyama, same-depth nodes across one horizontal band (click for the compact outline)",
    next: "stacked",
  },
};

// Reflow is a THREE-state cycle on one rail button, the same shape as
// HYP_MODES above and for the same reason: two independent booleans would let
// you ask for both budgets at once, and a second button would spend rail space
// on a mode you reach for occasionally. `wide` is exactly twice `narrow`'s
// column (layout.ts REFLOW_WIDE_W) — the setting for bringing the widest boxes
// under control without paying narrow reflow's full height cost. The glyph
// carries the current state, since three of them can't be read off a pressed
// style.
// The ¶ slider's top notch, one step past the widest real budget, is OFF —
// reflow's own rules stood down, which is what a reader sliding rightward is
// asking for by the time they reach the ordinary wrap width. Encoding it as a
// position rather than a separate button keeps the whole control one gesture:
// open, drag, done.
const REFLOW_OFF_STOP = REFLOW_MAX_CHARS + 1;
const reflowToStop = (m: ReflowMode) => (m === "off" ? REFLOW_OFF_STOP : m);
const stopToReflow = (v: number): ReflowMode =>
  v >= REFLOW_OFF_STOP ? "off" : v;

// Frontier-chip row geometry (see FrontierChip). Widths are fixed rather than
// measured: both labels are constant, and the row must not resize per node.
// Layout reserves exactly CHIP_LANE_H + CHIP_TOP_GAP under a chip-bearing node
// (see layout.ts), so the drawn height must BE that constant — the two agreeing
// is what keeps the lane from drawing on whatever comes next.
const CHIP_H = CHIP_LANE_H;
const CHIP_GAP = 6;
const CHIP_W_ADD = 20;
const CHIP_W_SORRY = 36;
const CHIP_W_STEP = 30;
// What a chain gesture's overlay asks for: the new link's RIGHT-HAND SIDE,
// and nothing else — the relation is already picked and the justification is
// written as a `sorry` for the second half of the gesture to type over (see
// calcEdit's STUB). `_` is the answer that CLOSES a chain against its goal, so
// it is prefilled wherever closing is what the gesture means; an empty commit
// backs out everywhere.
const CLOSE_RHS = "_";
const CHIP_FONT_PX = 10;
// Relation chips in the picker row (see PickerRow): a touch larger than the
// word chips, since a single glyph carries the whole meaning.
const PICK_FONT_PX = 12;
const CHIP_PAD_X = 6;

// Gallery pager geometry (see GalleryPager). It hangs in the gap a branching
// tactic leaves above its children — TRUNK_GAP_BRANCH (24px) in compact mode,
// which is what bounds the height here; a tactic with one VISIBLE child still
// gets that gap (the tight TRUNK_GAP_STEP is a goal→tactic rule), so hiding
// the siblings can't squeeze the pager out.
const PAGER_H = 15;
const PAGER_ARROW_W = 15;
const PAGER_LABEL_W = 30;
const PAGER_W = 2 * PAGER_ARROW_W + PAGER_LABEL_W;

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 2;
const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
// Clamp a scroll offset into [0, max]; used everywhere an effect restores scroll.
const clampScroll = (v: number, max: number) => Math.max(0, Math.min(max, v));

// How long the tree takes to follow the editor cursor onto a new node.
//
// This replaced `behavior: "smooth"`, and the reason is that the UA picks that
// duration: it is tuned for page navigation and does not scale with how far it
// is going, so a hop to the very next tactic cost the same as a jump across the
// proof. Walking the cursor down a proof then left the tree visibly trailing,
// because each cursor move restarted an animation the one before it had not
// finished. Short enough to keep up with held-down cursor keys, long enough to
// still read as movement rather than as a cut.
const FOLLOW_MS = 130;

/** Base style for a text layer painted in register with the in-place editor's
textarea — the syntax-colouring mirror behind it and the pending-abbreviation
underline above it.
 *
 * They must agree with the textarea's own metrics to the pixel, and the trap is
 * INHERITED CSS: a textarea is insulated from ancestor text styles by the UA
 * stylesheet and a plain div is not. Measured — the app root's `text-align:
 * center` put the mirror's glyphs 68.5px right of the caret, and an inherited
 * `text-rendering: optimizeLegibility` would have changed glyph ADVANCES
 * silently and only for some strings. So `textAlign`/`textRendering`/
 * `unicodeBidi` are PINNED here rather than left to inherit.
 *
 * Shared because two copies of a pinning this fragile is exactly how one of them
 * drifts: a new ancestor rule shows up as text sliding away from the caret, not
 * as an error. */
const editOverlayLayer = (zIndex: number): CSSProperties => ({
  position: "absolute",
  inset: 0,
  zIndex,
  overflow: "hidden",
  pointerEvents: "none",
  boxSizing: "border-box",
  padding: `${NODE_PAD_Y - 1}px ${NODE_PAD - 2}px`,
  border: "2px solid transparent",
  fontFamily: getCodeFontFamily(),
  fontSize: NODE_FONT_PX,
  lineHeight: `${LINE_H}px`,
  letterSpacing: 0,
  whiteSpace: "pre",
  textAlign: "left",
  textRendering: "auto",
  unicodeBidi: "normal",
});
// Past a SCREENFUL the animation is not legible anyway — you cannot track a
// jump that big by eye — so easing it only spends time. Go straight there. The
// threshold is the viewport itself, not a fraction of it, so it needs no
// constant: it is measured off the element at the moment of the move.

const HYP_MARK = "▸";

/**
 * Where the scroll box must sit for `node` to be comfortably in view.
 *
 * ONE function because it is one question, asked by both things that move the
 * view to a node: the editor-cursor follow and the diagnostic pager. It returns
 * the CURRENT offsets unchanged when the node already sits inside the
 * comfortable band, so "nothing to do" is a comparison rather than a second
 * rule each caller has to get right.
 *
 * Vertical is the reading axis in both layout modes: centre the node when it
 * strays outside the band. Horizontally the modes differ, and the difference is
 * in their coordinates rather than in taste (see the `[nodes]` anchor's note).
 * Compact tests the node's LEFT EDGE — a box whose start you can already see is
 * left alone however far its tail runs, which is what stops the view ratcheting
 * rightward once per cursor move — and brings it to COMPACT_LEFT from either
 * side; wide centres the box.
 */
function inViewScroll(
  el: HTMLElement,
  node: PlacedNode,
  zoom: number,
  padX: number,
  padY: number,
  compact: boolean,
): { left: number; top: number } {
  const cx = (MARGIN.left + padX + node.x) * zoom;
  const cy = (MARGIN.top + padY + node.y) * zoom;
  const halfW = (node.data.w / 2) * zoom;
  const halfH = ((node.data.h + node.data.commentBlockH) / 2) * zoom;
  const pad = 32;
  const maxX = el.scrollWidth - el.clientWidth;
  const maxY = el.scrollHeight - el.clientHeight;
  let left = el.scrollLeft;
  let top = el.scrollTop;
  if (
    cy - halfH < el.scrollTop + pad ||
    cy + halfH > el.scrollTop + el.clientHeight - pad
  )
    top = clampScroll(cy - el.clientHeight / 2, maxY);
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

/** The in-flight view move. Held so a second one CANCELS the first rather than
fighting it — a burst of cursor moves must land exactly where the last one alone
would. Shared between the cursor follow and the diagnostic pager: they are both
"move the view", and whichever spoke last wins. */
type FollowAnim = { raf: number | null; timer: number | null };

/** Ease the scroll box to (left, top) on OUR schedule (FOLLOW_MS), cancelling
whatever move was in flight.
 *
 * A jump longer than a viewport skips the animation: you cannot track one that
 * big by eye, so easing it only spends time. The rAF loop is backed by a
 * `setTimeout` that snaps to the target, and that is not padding — a HIDDEN
 * webview fires no animation frames at all, so without it the move would simply
 * never happen there. */
function animateScroll(
  anim: FollowAnim,
  el: HTMLElement,
  left: number,
  top: number,
) {
  if (anim.raf !== null) cancelAnimationFrame(anim.raf);
  if (anim.timer !== null) window.clearTimeout(anim.timer);
  const x0 = el.scrollLeft;
  const y0 = el.scrollTop;
  const dx = left - x0;
  const dy = top - y0;
  const land = () => {
    anim.raf = null;
    anim.timer = null;
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
    // Ease out: leaves immediately, settles gently, so the eye is carried
    // rather than yanked.
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

// The diagnostic RIBBON: a bar down the inside of a node's left edge, in the
// worst severity's ink. Drawn INSIDE the box's own footprint on purpose — the
// box already reserves NODE_PAD (12) of left padding, so the ribbon sits in
// space no glyph occupies and the layout is untouched. Reserving a lane for it
// would have made every proof lay out differently depending on whether it
// currently elaborates, which is exactly what a diagnostic overlay must not do.
// Row pitch for the stacked top-left floaters (caller's slot, picking hint,
// diagnostic pill). They are all one line of 12px text in the same pill chrome,
// so one constant places the stack instead of a hand-tuned offset per row.
const FLOATER_H = 36;
const RIBBON_W = 4;
// The one the pager is on gets a wider cap. A second colour or a halo would
// compete with the cursor accent; width is the one channel nothing else here
// uses.
const RIBBON_W_SEL = 8;

// The context block drawn INSIDE a goal box, above its `⊢ ` line: one line per
// hypothesis in scope, the ones the consuming tactic uses marked with a gutter
// `▸` and full-strength ink. `x` is the box's content-left edge and `y` the
// block's top; the geometry matches exactly what layout.ts reserved (hypH), so
// the block can never spill past the label below it.
//
// `taggedLines` (widget only) swaps individual lines for interactive content
// with hover type tooltips; null entries keep the plain text for that line.
function HypBlock({
  lines,
  x,
  y,
  width,
  taggedLines,
}: {
  lines: HypLine[];
  x: number;
  y: number;
  width: number;
  taggedLines?: (ReactNode | null)[] | null;
}) {
  // Markers only when they SEPARATE something: all-used (the `used` context
  // mode) or none-used means the gutter says nothing. Mirrors sizeOf's
  // reservation, which must agree or the text and its box disagree.
  const anyUsed = lines.some((l) => l.used) && !lines.every((l) => l.used);
  // Marker gutter (reserved by sizeOf only when something is marked), and the
  // left edge text starts at.
  const textX = x + (anyUsed ? HYP_MARK_W : 0);
  // Data/props divider: contextFor stamps `sep` on the first PROPOSITIONS
  // line of a mixed block (at most one per block); everything from it down
  // shifts by HYP_SEP_H — the leading sizeOf reserved — and a hairline is
  // drawn centred in the gap. Both text paths and the gutter must apply the
  // same shift, or markers drift off their lines.
  const sepIndex = lines.findIndex((l) => l.sep);
  const sepOff = (j: number) =>
    sepIndex >= 0 && j >= sepIndex ? HYP_SEP_H : 0;
  // Dim only as contrast: when nothing is marked, everything keeps full ink.
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
      {/* Gutter markers for used hyps are plain SVG in both render paths, so
          the tagged overlay only replaces the line text. */}
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
        // HTML overlay in the exact geometry the tspans below would use: one
        // fixed-height line box per context line. The text is identical to the
        // measured plain lines (taggedRender.tsx guarantees it), so nothing
        // wraps — hence white-space: pre.
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
              <div
                key={j}
                style={{
                  height: HYP_LINE_H,
                  color: lineFill(line.used),
                  paddingLeft: line.indent ?? 0,
                  // The divider's leading (the hairline itself is SVG, shared
                  // with the plain path). Margin, not padding: padding would
                  // push the text down INSIDE its line box.
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
          // Drop the page's inherited letter-spacing: it isn't counted by the
          // width measurer in layout.ts, so leaving it on overflows the box.
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
    </>
  );
}

export interface ProofTreeViewProps {
  /** The proof to render. A new proof resets fold/zoom and re-centers. */
  proof: Proof;
  /**
   * Reveal a tactic's source span in the editor (infoview widget). When set,
   * clicking a positioned tactic node reveals its source instead of folding —
   * the tree→source half of the bidirectional link.
   */
  onReveal?: (pos: ProofStepPosition) => void;
  /**
   * Widget-only, the in-place editing seam: resolve a tactic step's TIGHT
   * source range and verbatim text (the step's own `position`/label are
   * trivia-inflated/prettified and unsafe to edit with — see TacticEdit in
   * ProofTreeComments.lean). Double-clicking a tactic node opens an editing
   * overlay pre-filled with `text`; both hooks must be set for that.
   */
  getTacticEdit?: (
    pos: ProofStepPosition,
  ) => { pos: ProofStepPosition; text: string } | null;
  /**
   * Commit an in-place edit: replace `pos` (the tight range from
   * getTacticEdit) with `newText` in the source document.
   */
  onEditTactic?: (pos: ProofStepPosition, newText: string) => void;
  /**
   * Widget-only: a goal's subterms, as printed. Feeds the in-place editor's
   * completion list — a `calc` link restates part of its goal at every step, so
   * what you are about to type is usually already on screen. Costs nothing on
   * the wire: it is a walk over the tagged print the hover tooltips already use.
   */
  getGoalTerms?: (goalId: string) => string[];
  /**
   * Widget-only: the EDITOR theme's syntax colours, keyed by LSP semantic token
   * type (`{keyword: "#C586C0", …}`). Overrides the built-in Light+/Dark+
   * palette so the tree's tactic colouring matches the buffer. A webview cannot
   * read these itself — token colours are not in the `--vscode-*` registry and
   * the extension API has no member for them — so they arrive the long way
   * round, resolved by the companion from the active theme's JSON.
   */
  tokenColors?: Record<string, string>;
  /**
   * Widget-only: outline-only nodes — drop the box fills and let the borders
   * carry goal-vs-tactic. Purely paint (the palette swaps three CSS variables
   * off the root attribute below), so nothing relayouts.
   *
   * A SETTING rather than a rail button, and deliberately so: it is a standing
   * preference about how boxes look, not a gesture you reach for while reading
   * a proof, and the rail is for the latter. It arrives on the same channel as
   * `tokenColors` — the companion reads `proofTree.outlineOnly` and the server
   * hands it back — because a webview cannot read VS Code settings either.
   */
  outline?: boolean;
  /**
   * Widget-only, the rich-editing escape hatch behind a tactic's hover-bar
   * `⧉` button: opens the proof in the LENS — a slim editor group under the
   * infoview — with the tactic's range selected (real buffer, so vim/LSP/
   * keybindings all apply; the in-tree textarea stays the quick path). A
   * button, NOT a modifier gesture: it lived on ⇧-double-click, where the
   * webview's ⇧-click text-selection ate the second click. Independent of
   * getTacticEdit, which only sharpens the selection to the tight range when
   * available. widget.tsx relays this through the companion extension
   * (ext/proof-tree-companion).
   */
  onPopoutEdit?: (pos: ProofStepPosition) => void;
  /**
   * The editor's current cursor position. The tactic node whose source range
   * contains it gets an accent outline — the source→tree half of the link.
   */
  highlightPos?: { line: number; character: number } | null;
  /**
   * Extra controls placed at the left of the toolbar. The standalone app injects
   * its proof picker here; the widget leaves it empty.
   */
  headerExtra?: ReactNode;
  /**
   * CSS height of the view's container. Defaults to the full viewport for the
   * standalone page; the infoview widget passes a bounded height so the tree
   * (with its pinned toolbars) stays inside the panel instead of escaping it.
   */
  height?: string | number;
  /**
   * Widget-only: take over a goal node's label with interactive content (the
   * infoview's hover type tooltips). Called with the goal's id and its wrapped
   * label lines; returns one ReactNode per line (rendered in the same line
   * geometry as the plain text), or null to keep the plain SVG text. The view
   * stays infoview-agnostic — widget.tsx implements this with InteractiveCode
   * (see taggedRender.tsx); the standalone app leaves it unset.
   */
  renderTaggedGoal?: (
    goalId: string,
    lines: string[],
    hiddenLhs?: string,
  ) => ReactNode[] | null;
  /**
   * Widget-only, same idea for the context lines stacked above a goal's type
   * in its own box: `goalId` is that goal (the lines are its local context —
   * see types.ts HypLine). Null entries in the returned array keep that line
   * plain; null overall keeps the whole block plain.
   */
  renderTaggedHyps?: (
    goalId: string,
    lines: string[],
  ) => (ReactNode | null)[] | null;
  /**
   * Widget-only: syntax-colour a tactic node's label. Called with the tactic's
   * source span, its flat label and that label's wrapped lines; returns one
   * ReactNode per line (rendered in the identical line geometry), or null to
   * keep the plain SVG text. Colour only — the text must be unchanged, or the
   * measured box lies. The flat label is passed because the label, not the
   * step's source, is the space the lines were wrapped in — the two differ for
   * `rw`/`intro` (see tacticTokens.tsx `alignInLabel`). widget.tsx implements
   * this from the server's semantic tokens.
   */
  renderTaggedTactic?: (
    pos: ProofStepPosition,
    label: string,
    lines: string[],
    elision?: TreeNode["elision"],
  ) => ReactNode[] | null;
  /**
   * Widget-only: insert a NEW tactic for a pending goal (the (+) chip).
   * `spec` says where and in what form (bullet/case/plain line); `text` is
   * what the user typed. widget.tsx turns it into a document insertion via
   * the editor's own edit pipeline.
   *
   * `slots` names spans of `text` the author has still to fill in — the two
   * `_` ends of a freshly opened `calc` link. Only the widget knows the indent
   * and bullet prefix the text lands behind, so it is what turns them into the
   * absolute ranges it reports back (see AddResult).
   */
  onAddTactic?: (
    spec: AddSpec,
    text: string,
    slots?: { lhs: TextSlot; rhs: TextSlot },
  ) => AddResult | null | void;
  /**
   * Widget-only: the tactic-sequence slots the delete gesture resolves its
   * extent against (`TacticSlot`, keyed by containment — see deleteEdit.ts).
   * Its presence is what gates the `⊘` button, since without slots there is
   * no honest extent to offer.
   */
  deleteSlots?: TacticSlot[];
  /**
   * Widget-only: commit a deletion. `spec` says what the node stands for; the
   * widget resolves it to a document edit and applies it through the editor's
   * own pipeline, so it lands on the undo stack like every other write here.
   */
  onDeleteTactic?: (spec: DeleteSpec) => void;
  /**
   * Widget-only: paint (or clear, with `null`) the region an ARMED delete
   * would remove. Distinct from `onHoverTactic`, which the companion clamps to
   * a single line — an extent is routinely many, and showing it is the whole
   * point of arming.
   */
  onPreviewRange?: (range: ProofStepPosition | null) => void;
  /**
   * Widget-only: undo / redo in the editor holding the proof. The tree makes
   * edits while focus is in the WEBVIEW, where ⌘Z reaches nothing, so without
   * this the only way to undo one is to click into the editor first.
   */
  onUndo?: (redo: boolean) => void;
  /**
   * Widget-only: the pointer entered (`pos`) or left (`null`) a tactic node.
   * The widget paints a decoration over that range in the editor, so hovering
   * the tree lights up the corresponding source — the hover-weight sibling of
   * the click-weight reveal. Debouncing belongs to the implementation, not
   * here: the view reports raw enter/leave.
   */
  onHoverTactic?: (pos: ProofStepPosition | null) => void;
  /**
   * The user's `lean4.input.*` settings, for unicode abbreviations in the
   * in-place editor (`\dvd` → `∣`). Absent means vscode-lean4's own defaults,
   * which is the right degrade: the abbreviation table is bundled, so the
   * feature works with no companion installed — only a customised leader or a
   * custom translation needs the setting to come back over that channel.
   */
  abbrev?: AbbrevConfig;
  /**
   * Widget-only: this proof's Lean diagnostics, already filtered to it (see
   * diagnostics.ts `filterDiagnostics`). The view ATTACHES them to nodes,
   * because that is the half that knows which nodes exist and what is drawn;
   * the widget filters, because the LSP wire shape and the proof's span are
   * its business.
   *
   * Purely additive to the render — no engine input, nothing in `viewKey`, and
   * no reserved geometry: an error draws a ribbon INSIDE its node's box and a
   * status pill over the corner, so a proof lays out identically with and
   * without them.
   */
  diagnostics?: TreeDiagnostic[];
}

export default function ProofTreeView({
  proof,
  onReveal,
  getTacticEdit,
  onEditTactic,
  getGoalTerms,
  tokenColors,
  outline = false,
  onPopoutEdit,
  highlightPos,
  headerExtra,
  height = "100vh",
  renderTaggedGoal,
  renderTaggedHyps,
  renderTaggedTactic,
  onAddTactic,
  onHoverTactic,
  deleteSlots,
  onDeleteTactic,
  onPreviewRange,
  onUndo,
  abbrev = DEFAULT_ABBREV,
  diagnostics,
}: ProofTreeViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Accordion: expanding a node collapses its sibling branches, so only one
  // branch is open per level (the "view one branch at a time" mode).
  const [accordion, setAccordion] = useState(true);
  // Context verbosity, cycled by the rail (see HYP_MODES): `used` (default)
  // shows what the proof BELOW the goal depends on, `new` what the tactic
  // above bound, `delta` what the goal gained (plus anything its own tactic
  // uses), `full` the whole context.
  const [hypMode, setHypMode] = useState<HypMode>("used");
  // Layout mode, a three-way cycle on one rail button (see LAYOUT_MODES):
  // the compact trunk outline (default — every node gets its own vertical
  // slot, branches indent off a left trunk, read by scrolling), the SPINE
  // (compact, but goals keep the trunk and each tactic hangs off the lane to
  // the right — tighter, more per screen), or the wide Sugiyama tree
  // (same-depth nodes share a band). `compact`/`aside` are the derived booleans
  // the rest of the view (and the layout engine) actually reads, so the ~30
  // existing `compact` sites needed no change when spine arrived.
  const [layout, setLayout] = useState<LayoutMode>("stacked");
  const compact = layout !== "wide";
  // What the layout engine's `aside` parameter gets: false, plain spine, or
  // the aligned-track variant (see trunkLayout).
  const aside =
    layout === "tracks" ? ("track" as const) : layout === "spine";
  // Reflow: wrap labels at a much narrower column with bracket-depth indents,
  // trading height for width so sibling branches fit across the viewport.
  // Unlike the `outline` PROP this is GEOMETRY — it rebuilds the engine (below)
  // rather than just repainting.
  const [reflow, setReflow] = useState<ReflowMode>("off");
  // Whether the ¶ button is expanded into its width slider (see ReflowControl).
  const [reflowOpen, setReflowOpen] = useState(false);
  // Aligned-tracks mode NEEDS boxes capped at a modest width — a single
  // page-wide goal would push the whole shared tactic column out to its edge —
  // so it forces reflow's default budget when the user hasn't set one; an
  // explicit ¶ setting still wins. Reflow rather than a goal-only cap because
  // context lines are usually what bound a goal's width, and reflow is the one
  // mode that wraps them.
  //
  // Derived ONCE and read by both the engine and the rail: the ¶ button shows
  // pressed (and its slider reads the forced column) whenever this is set, or
  // the control would say "off" while the tree is visibly wrapped.
  const forcedReflow =
    layout === "tracks" && reflow === "off" ? REFLOW_CHARS : undefined;
  // Brief: collapse mechanical boilerplate inside each tactic label to `…`
  // (see briefLabel.ts). Like reflow this is GEOMETRY — the label text changes,
  // so it rebuilds the engine and re-measures every box.
  const [brief, setBrief] = useState(false);
  // Combine: automatically merge each maximal LINEAR tactic run into one node
  // showing the tactics stacked, dropping the pass-through goals between them
  // (syntactic, not semantic — see elide.ts combineRuns). Engine-tier geometry.
  const [combine, setCombine] = useState(false);
  // Overview: everything outside the cursor's local region lays out as a
  // one-line mini chip, so the tree reads as its shape; hover a chip to peek
  // at its full content (paint-only — see the peek overlay). Engine-tier
  // geometry, like brief/combine.
  const [overview, setOverview] = useState(false);
  // Side-by-side branches (compact mode): a branching tactic's subtrees lay
  // out as columns sharing one vertical span instead of stacking down the
  // page. A computeLayout parameter, not an engine rebuild: geometry per
  // node is unchanged, only placement moves.
  const [sideBySide, setSideBySide] = useState(false);
  // Gallery: show only ONE of a branching tactic's subtrees at a time, cycled
  // by a ‹ n/m › pager under the tactic. The opposite trade to side-by-side —
  // that one spends width to show every branch at once, this one spends none
  // and shows a branch at a time — so a wide case split reads at the same
  // width as a linear proof. `pick` maps a splitting node's id to which child
  // is showing; it is indexed modulo the child count, so a stale entry left by
  // an edit can't point at nothing.
  const [gallery, setGallery] = useState(false);
  const [pick, setPick] = useState<Record<string, number>>({});
  // Zoom factor applied to the whole SVG (1 = 100%). Lets you fit a wide/tall
  // tree into the slice and zoom back into a region.
  const [zoom, setZoom] = useState(1);
  // Sequence ("linearize") mode. `off` is the normal branching tree. `pick` is
  // selecting two endpoints (first click sets `from`); `view` renders only the
  // path between them — a single chain of goals/tactics with no branching.
  const [seq, setSeq] = useState<Seq>({ mode: "off" });
  // On-demand elision: the applied cuts (see elide.ts), each a path (the ⇥
  // reverse-of-linearize) or a vertical band (the ⇳ geometric cut) collapsed to
  // a marker. Cuts persist across cursor moves; a marker click removes its cut.
  // Two picking modes, mutually exclusive with each other and with sequence
  // mode — each is off, or holds the first endpoint chosen (null awaits it).
  const [elideCuts, setElideCuts] = useState<ElideCut[]>([]);
  const [elidePick, setElidePick] = useState<{ from: string | null } | null>(
    null,
  );
  const [bandPick, setBandPick] = useState<{ from: string | null } | null>(
    null,
  );
  // Focus mode: a goal id whose subtree becomes the whole tree (that goal is
  // the new layout root); null shows the full proof. Folding still works
  // within the focused subtree.
  const [focusId, setFocusId] = useState<string | null>(null);
  // The goal node currently showing its hover action bar (reveal-in-source /
  // focus-subtree buttons). The bar renders inside the node's own <g>, so
  // pointer travel from box to bar never leaves the hover region (no flicker).
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Clicking the widget BACKGROUND dismisses the editor-cursor accent: in the
  // infoview, any click focuses the panel while the editor cursor (and hence
  // highlightPos) stays put — this lets the user declutter without touching
  // the editor. Cleared whenever the cursor actually moves (below).
  const [hlDismissed, setHlDismissed] = useState(false);
  // In-place tactic editing (widget only — needs getTacticEdit/onEditTactic):
  // double-clicking a tactic node swaps its box for a textarea pre-filled
  // with the tactic's verbatim source. `original` is what the source says
  // now; committing (Enter on a single-line tactic, ⌘/Ctrl-Enter always,
  // or blur) applies the replacement only when the text actually changed.
  const [editing, setEditing] = useState<{
    id: string;
    pos: ProofStepPosition;
    original: string;
    value: string;
    // Present when this is an ADD (the (+) chip on a pending goal): commit
    // INSERTS via onAddTactic instead of replacing, empty commits just close,
    // and the goal's own box stays visible under the overlay.
    add?: AddSpec;
    // Present when what is being typed is one END of a `calc` link rather than
    // a tactic. The link is already IN the file — written the instant the
    // relation was picked, as `calc _ <rel> _ := by sorry` — and these stages
    // replace its two `_`s in place, left side then right side, before the
    // gesture hands over to the `sorry`.
    //
    // Inserting first and filling afterwards is what makes every intermediate
    // state a valid file: Escape at any stage simply leaves the `_` standing,
    // and `_` is a legitimate answer (Lean unifies it against the goal), so
    // plain Enter through both stages is the whole gesture.
    calcStage?: {
      stage: "lhs" | "rhs";
      lhs: ProofStepPosition;
      rhs: ProofStepPosition;
      // The `sorry` to open on once both ends are settled.
      stub: ProofStepPosition | null;
      // Where the link's own line starts, so the overlay can find its node
      // again after a re-elaboration renumbers every id around the edit (the
      // standing rule: re-match on SOURCE positions, never on an mvarId).
      anchor: { line: number; character: number };
      // Whether the picked relation is the one the goal is in, i.e. whether
      // this link can be the chain's last. It decides whether `_` is a real
      // answer for the RIGHT-hand side: on a closing link Lean unifies it with
      // the goal's own right side, but on a stepping link (`≤` picked on a `<`
      // goal) nothing pins it and the placeholder cannot be synthesized —
      // measured, `calc _ ≤ _` under `⊢ a < d` reports "don't know how to
      // synthesize placeholder". So the prefill stays `_` either way (typing
      // replaces it, and an unfinished link is a state the tree already draws)
      // but the hint says outright when Enter is not going to be enough.
      closes: boolean;
    };
    // The SECOND half of a calc gesture: typing over the `sorry` the first
    // half wrote (see calcEdit's STUB). It is an ordinary in-place tactic
    // edit — the node is real and the range is its own — with one rule of its
    // own: an EMPTY commit writes nothing, so backing out at this point
    // leaves the `sorry` standing rather than blanking the justification and
    // breaking the link.
    fill?: boolean;
  } | null>(null);
  // A `sorry` a calc gesture just wrote, waiting for the re-elaboration to
  // draw it. When the node appears the in-place editor opens on it, empty:
  // that is the second half of the two-part flow, and it costs no new overlay
  // machinery because the stub is a real editable tactic node.
  //
  // Matched by SOURCE POSITION, never by id — an insertion renumbers exactly
  // the mvarIds around it, which is the rule this file keeps relearning. The
  // consuming check additionally requires the node to BE a `sorry`, so a
  // request left unclaimed (an edit that failed to elaborate) can't later
  // open an editor on some unrelated tactic.
  const [pendingFill, setPendingFill] = useState<ProofStepPosition | null>(
    null,
  );
  // A chain gesture that offers a CHOICE of relation expands the chip lane
  // into a row of them (see PickerRow) instead of acting immediately. It holds
  // ranges, so it is dismissed on every path `editing` is — including a shape
  // change, where the edit that just landed invalidated them.
  const [picking, setPicking] = useState<{
    id: string;
    // `link` types the rest of a prefilled link; the other two type a
    // midpoint (or, for a `same` append, nothing at all).
    kind: "open" | "link" | "append" | "first";
    spec: AddSpec;
    options: CalcRelOption[];
  } | null>(null);
  // The ARMED half of the delete gesture. Deletion is the one destructive
  // thing the tree can do, so the first click never deletes: it computes the
  // extent, lights it up in the editor and shows what it will take, and only a
  // second click commits. That also means an accidental click on `⊘` costs
  // nothing, which is what lets the button live in the hover bar at all.
  //
  // Like `picking` it holds RANGES, so it must be dismissed everywhere that is
  // — and additionally on `docRev` (the widget clears it by remounting the
  // prop), since a document change is exactly what invalidates them.
  const [arming, setArming] = useState<{
    id: string;
    spec: DeleteSpec;
  } | null>(null);
  // Which node's diagnostic popup is up (hovering its ribbon strip). A custom
  // popup rather than the strip's native <title>, for the two things a native
  // tooltip cannot do: appear NOW (the ~1s hover delay is the OS's, not ours —
  // and reading the error is the whole reason the pointer is on a 12px strip)
  // and style its content (the severity glyph at a legible size, the message
  // in the code font). Rendered after the nodes loop like the editor overlay,
  // so it paints over everything; keyed by node id and looked up per render,
  // so a node that unmounts under the pointer renders nothing rather than a
  // stale popup.
  const [hoverDiag, setHoverDiag] = useState<string | null>(null);
  // Esc closes the picker, disarms a delete, folds the ¶ slider away, closes
  // an UNFOCUSED staged calc fill, and — when none of those is up — leaves a
  // focused subtree. None of them owns a focused element worth listening on
  // (two are SVG chips, and the slider's own focus is the range input), so
  // unlike the overlay's own Esc this has to listen on the document. A
  // FOCUSED stage never reaches here: the textarea's keydown handles its own
  // Esc and stops propagation — this layer exists because the stage's blur is
  // deliberately a no-op, so a stray focus loss can leave the overlay open
  // with nothing focused, and Esc must still work there.
  //
  // LAYERED on purpose: Esc dismisses the transient thing first and only
  // unfocuses once there is nothing transient left. Unfocusing in the same
  // keypress that closes a picker would throw away the scope the user is
  // working inside as a side effect of cancelling something else — and focus,
  // unlike the others, costs a gesture to rebuild.
  useEffect(() => {
    const transient = picking || arming || reflowOpen;
    const stage = !!editing?.calcStage;
    if (!transient && !stage && focusId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (transient) {
        setPicking(null);
        setArming(null);
        setReflowOpen(false);
      } else if (stage) {
        setEditing((cur) => (cur?.calcStage ? null : cur));
      } else {
        setFocusId(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picking, arming, reflowOpen, focusId, editing]);
  // Undo/redo from the tree. The widget's own edits leave focus in the
  // webview, where ⌘Z reaches nothing at all, so the tree has to offer it.
  // Skipped while a textarea has focus: the in-place editor's own undo is the
  // browser's, and it should stay that way.
  useEffect(() => {
    if (!onUndo) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      e.preventDefault();
      onUndo(e.shiftKey);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onUndo]);
  // Arming paints the extent in the editor; anything that disarms clears it.
  // Keyed on the id so re-arming a different node repaints.
  //
  // Derived ONCE: the buffer preview, the dimmed-node set and the confirm row's
  // line count are three readings of the same extent, and computing it three
  // times over invited them to disagree.
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
  // Completion in the in-place editor. Everything it offers is already on
  // screen or already in the payload, so there is no RPC, no debounce and no
  // cancellation: the whole thing is a filter over three small local lists.
  const [completion, setCompletion] = useState<{
    items: CompletionItem[];
    index: number;
  } | null>(null);
  // Cleared whenever the editor opens on a different node or closes — one place
  // rather than a line in each of commitEdit / Escape / the two reset branches,
  // which is how `editing` and `picking` have drifted apart before. Derived
  // state adjusted during render, like `prevShape` and `prevHlKey` above, since
  // setting it from an effect would cost a second render every keystroke.
  // Unicode abbreviations in the in-place editor: `\dvd` → `∣`, the same input
  // mode the source buffer has, driven by the same upstream package
  // (`web/src/abbreviation.ts`). Without this the tree could only ever edit
  // ASCII tactics, which in Lean is most of a sentence short.
  //
  // The session owns a shadow copy of the draft, so every path that writes
  // `editing.value` — onChange, completion acceptance, the clipboard fallback —
  // has to tell it (`syncAbbrev`), or a later `flush()` would resurrect a stale
  // draft.
  //
  // Held in STATE, not a ref, which is the counter-intuitive part: a mutable
  // per-session helper is exactly what a ref is for, and it is the one thing
  // that does not work here. `react-hooks/refs` treats a ref READ inside a
  // function called from the overlay's JSX as render-phase, and the taint
  // spreads to every other ref-touching call reachable from there —
  // `commitEdit` and `acceptCompletion` included, which is how this was found.
  // As state it is simply a render value, and the session object being mutable
  // costs nothing: nothing ever compares it.
  const [abbrevSess, setAbbrevSess] = useState<{
    id: string;
    session: AbbrevSession;
  } | null>(null);
  // The underline has to be rendered, so the pending spans are state too.
  // Written only when they actually change, so a keystroke with nothing pending
  // costs no extra render.
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
    // Captured so the emit can read its own pending spans. The reference is
    // resolved only when an emit fires, which is always after construction.
    const self: AbbrevSession = new AbbrevSession(abbrev, initial, (v, c) => {
      setEditing((e) => e && { ...e, value: v });
      putSpans(self.pending());
      // Same restore-after-the-render dance as the clipboard fallback and
      // completion acceptance, and for the same reason: the textarea is
      // controlled, and a hidden webview never fires animation frames. The
      // element is found by DOM walk rather than held in a ref — attaching one
      // with `ref={…}` is a render-phase USE of that ref, tripping the very
      // analysis described above (it is why `onScroll` walks to the mirror
      // too).
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
  /** Which EDITOR a piece of per-editor state belongs to — the abbreviation
  session and the completion list.
   *
   * The node id alone is not it, and that was a real bug: the two halves of a
   * staged `calc` fill open on the SAME node, so the session survived the
   * transition with its shadow copy of the left-hand side still in it, and
   * committing the right-hand side flushed that stale draft over the top —
   * typing `a` for the left side then Entering through the right wrote `a`
   * into both. The stage is therefore part of the key. */
  const editKey = (e: typeof editing) =>
    e === null ? null : `${e.id} ${e.calcStage?.stage ?? ""}`;
  const editingId = editKey(editing);
  const [prevEditingId, setPrevEditingId] = useState(editingId);
  if (editingId !== prevEditingId) {
    setPrevEditingId(editingId);
    setCompletion(null);
    // Both halves of the abbreviation state belong to ONE editor, so they are
    // reset here rather than in a line of their own in each of commitEdit /
    // Escape / the two reset branches — the same reasoning as `completion`.
    setAbbrevSpans([]);
    setAbbrevSess(
      editing && abbrev.enabled
        ? { id: editingId!, session: newAbbrevSession(editing.value) }
        : null,
    );
  }

  // Commit goes through the editor's own edit pipeline (undoable there); a
  // no-op edit just closes the box. The ref mirrors `editing` and is nulled
  // SYNCHRONOUSLY on commit: committing via Enter unmounts the textarea,
  // whose blur then calls commitEdit again from the same render's (stale)
  // closure — without the ref that would apply the edit twice.
  const editingRef = useRef(editing);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  // Declared at component level, like commitEdit and for the same reason: the
  // confirm row is rendered from an IIFE in the JSX, and react-hooks/refs
  // treats a function called from there as render-phase — which would taint
  // the ref `anchorOn` writes. Called from the handler, this is fine.
  const commitDelete = (id: string, spec: DeleteSpec) => {
    anchorOn(id);
    onDeleteTactic!(spec);
    setArming(null);
  };
  const commitEdit = () => {
    const cur0 = editingRef.current;
    editingRef.current = null;
    if (!cur0) return;
    // An abbreviation still being typed must not reach the source: `\alpha`
    // then Enter writes `α`, the same as it would in the buffer. `flush` is
    // synchronous precisely so it can be used from here, where there is nothing
    // to await into.
    const flushed =
      abbrevSess?.id === editKey(cur0) ? abbrevSess.session.flush() : undefined;
    const cur =
      flushed !== undefined && flushed !== cur0.value
        ? { ...cur0, value: flushed }
        : cur0;
    // Pin the node being edited across the relayout the commit will cause,
    // rather than letting the viewport-centre rule guess. A tactic can only
    // affect the proof BELOW it, and the compact layout walks a single y-cursor
    // in DFS order — so with this node held fixed, everything above it is
    // literally unmoved and only the part the edit could have changed shifts.
    anchorOn(cur.id);
    if (cur.calcStage) {
      commitStage(cur.id, cur.calcStage, cur.value);
      return;
    }
    if (cur.add) {
      // An add commits on any non-empty text: an empty one is how every form
      // here backs out, and for the calc forms it must never write a link
      // with no right-hand side.
      if (cur.value.trim() !== "") {
        const at = onAddTactic?.(cur.add, cur.value);
        // Part two: the gesture wrote a `sorry`, so queue the editor to open
        // on it as soon as the redraw brings it in (see pendingFill).
        if (at?.fill) setPendingFill(at.fill);
      }
    } else if (cur.fill ? cur.value.trim() !== "" : cur.value !== cur.original) {
      onEditTactic?.(cur.pos, cur.value);
    }
    setEditing(null);
  };
  /** Write a `calc` link with both ends open, then walk the author through
  filling them in.
   *
   * The line goes in FIRST and the prompts follow, which is what keeps every
   * intermediate state a valid file — Escape at any point simply leaves an `_`,
   * and `_` is a legitimate answer. It also means the tree is never holding
   * text the document does not have.
   *
   * Two shapes reach here and `calcEdit` tells them apart by kind: OPENING a
   * chain inserts a whole `calc _ <rel> _ := by sorry` line through the
   * ordinary insertion path (so indent, `· ` bullets and `| case => ` markers
   * are handled already), while REPAIRING a bare `calc` keyword adds the link
   * under it. Either way one line, never two. */
  /** Select the `_` a freshly opened stage is prefilled with, so Enter takes
  it and typing REPLACES it rather than appending to it (`_a`).
   *
   * On a `setTimeout`, not from `onFocus` and not from a rAF. React's
   * `autoFocus` calls `.focus()` during commit, before the delegated listener
   * is live — measured in the preview, an `onFocus` handler here never ran and
   * the caret sat at offset 0 with nothing selected. `setTimeout` is the same
   * answer the clipboard fallback and completion acceptance already use, and
   * for the harder reason: a hidden webview fires no animation frames at all.
   * The textarea is found by DOM walk for the `react-hooks/refs` reason — a
   * ref read from a function called out of JSX counts as render-phase and
   * taints every other ref-touching call in the same handler. */
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
    anchorOn(id); // hold this goal put across the redraw the insertion causes
    const repair = spec.kind === "calc-first";
    const at = onAddTactic?.(
      { ...spec, rel },
      // The repair form is assembled by calcEdit from the spec, so it takes no
      // text; the open form is a line insertion, so its text is built here and
      // its fillable slots come along to be turned into absolute ranges.
      repair ? "" : calcOpenText(rel),
      repair ? undefined : calcOpenSlots(rel),
    );
    if (!at?.stages) {
      // No stages reported means the host is not the widget (the standalone
      // app draws no chips) or the edit wrote no open ends. Nothing to walk.
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
  /** One stage of the staged `calc` fill: replace this end of the link with
  what was typed, then move to the next end — or, once both are settled, hand
  over to the `sorry`.
   *
   * `_` is a real answer, not an empty one, so a value of `_` (which is what
   * plain Enter through the prefill gives) writes NOTHING and simply advances.
   * That is what makes the fast path free: opening a chain whose ends Lean can
   * unify costs one pick and two Enters, and issues exactly one document edit
   * — the insertion itself.
   *
   * A stage that DOES write shifts everything to its right on the same line,
   * so the later ranges are moved by the length difference before they are
   * used. They are all on one line by construction (the link is one line), and
   * the edit is applied through the editor, which processes it before the next
   * one is issued — so the shifted ranges are correct against the document the
   * next stage will act on. */
  const commitStage = (
    id: string,
    st: NonNullable<typeof editing>["calcStage"] & object,
    raw: string,
  ) => {
    // The endpoint of a chain link is an expression, and the overlay is a
    // textarea: fold any newline into a space rather than writing a term
    // across lines, where the indentation would have to be guessed.
    const text = raw.replace(/\n+/g, " ").trim();
    const value = text === "" ? PLACEHOLDER : text;
    const here = st.stage === "lhs" ? st.lhs : st.rhs;
    const grew = value.length - (here.stop.character - here.start.character);
    const shift = (p: ProofStepPosition): ProofStepPosition =>
      p.start.line === here.start.line && p.start.character >= here.stop.character
        ? {
            start: { ...p.start, character: p.start.character + grew },
            stop: { ...p.stop, character: p.stop.character + grew },
          }
        : p;
    // `grew` is 0 when the `_` was kept, so the shift is an identity there and
    // needs no special case.
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
    // Both ends settled. Hand over to the stub the insertion wrote — the
    // ordinary in-place tactic editor, opened by `pendingFill` the moment the
    // redraw brings the `sorry` node in.
    if (next.stub) setPendingFill(next.stub);
    setEditing(null);
  };
  // Select-all and clipboard in the in-place editor. The VS Code webview is an
  // awkward host for these: the workbench owns most keybindings, and whether
  // ⌘/Ctrl-C/X/V reach a focused textarea as native clipboard ACTIONS (rather
  // than being swallowed on the way) isn't something the widget can observe up
  // front. So the clipboard three are deliberately NOT intercepted — replacing
  // the browser's own handling would break paste outright wherever the async
  // Clipboard API is unavailable or unpermitted, i.e. it could only make a
  // working case worse. Instead we WATCH for the native event (`onCopy`/`onCut`
  // /`onPaste` set this flag) and fill in from `navigator.clipboard` on the
  // next tick only when none arrived, so the native path always wins when it
  // works. Select-all needs none of that care — it touches no clipboard and no
  // permission, so it's done outright.
  const nativeClip = useRef(false);
  const clipboardFallback = async (
    key: "c" | "x" | "v",
    ta: HTMLTextAreaElement,
    // The whole editing record, not just `{id, value}`: the abbreviation
    // session is keyed by `editKey`, which reads the calc stage too.
    cur: NonNullable<typeof editing>,
  ) => {
    const from = ta.selectionStart;
    const to = ta.selectionEnd;
    const v = ta.value;
    // The textarea is controlled, so a cut/paste has to go through state —
    // writing `ta.value` directly would be overwritten on the next render.
    // The caret is then restored after that render (setTimeout, not rAF: a
    // hidden webview never fires animation frames).
    const put = (value: string, caret: number) => {
      setEditing((cur) => cur && { ...cur, value });
      // The abbreviation session tracks the draft, so a write that bypasses
      // onChange has to be reported or its shadow copy goes stale — and a
      // pasted `\alpha` should be tracked exactly as a typed one is.
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
      if (from === to) return; // nothing selected: copy/cut are no-ops
      await navigator.clipboard.writeText(v.slice(from, to));
      if (key === "x") put(v.slice(0, from) + v.slice(to), from);
    } catch (e) {
      console.warn("[proof-tree] clipboard fallback failed:", e);
    }
  };

  // A tactic single-click reveals in source — but a double-click's FIRST
  // click is a plain click, and revealing immediately steals focus to the
  // editor mid-gesture (the second click never reaches the widget, so
  // double-click editing/popout can't fire). On EDITABLE tactics the reveal
  // is therefore deferred past the double-click window and canceled by the
  // dblclick handler; non-editable tactics keep the instant reveal.
  const revealTimer = useRef<number | null>(null);
  const cancelPendingReveal = () => {
    if (revealTimer.current !== null) {
      window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
  };
  const deferReveal = (pos: ProofStepPosition) => {
    cancelPendingReveal(); // a double-click's second click re-schedules
    revealTimer.current = window.setTimeout(() => {
      revealTimer.current = null;
      onReveal?.(pos);
    }, 300);
  };
  useEffect(() => cancelPendingReveal, []);

  // The proof + view we've already centered on; lets the init effect re-center
  // once per loaded proof (and once per sequence switch) without writing a ref
  // during render. Keyed on the PROOF, not the engine: the engine also rebuilds
  // on a hyp-label mode toggle, which re-anchors on the root instead of
  // re-centering. One ref: the pair is only ever written and compared together.
  // Keyed on the proof's IDENTITY, not its shape: re-centering on every
  // structural edit is what yanked the view back to the root mid-edit.
  const centeredOn = useRef<{ proofKey: string; viewKey: string } | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<Anchor | null>(null);
  // The scroll that is currently SHOWING the last drawn layout. Every re-anchor
  // measures from this rather than from `el.scrollLeft/Top` at apply time,
  // because a relayout that SHRANK the SVG has already made those the browser's
  // clamped values — the pre-relayout position is gone by then. It is sampled
  // during RENDER (below), where the DOM still holds the previous layout.
  // Deliberately not from a `scroll` listener: those are dispatched with the
  // rendering steps, and a hidden webview doesn't run them at all.
  const lastScrollRef = useRef({ x: 0, y: 0 });
  // Where every node sat in the layout we last drew. A relayout we did not
  // initiate (an edit landing, the buffer re-elaborating, a context-breadth
  // toggle) has no explicit anchor, and this is what lets one be inferred.
  const lastLayoutRef = useRef<Map<string, { x: number; y: number }> | null>(
    null,
  );
  // The editor cursor's node in the layout we last drew, then its ancestors, as
  // `layoutKeys` keys. Read by the anchor effect when an edit DELETES the node
  // the cursor was on — commenting a tactic out — so the view can fall back to
  // the tactic above instead of guessing. Recorded by its own effect below,
  // declared AFTER the anchor effect so that on a relayout the anchor still sees
  // the chain as of the previous layout; a cursor move alone updates it in place
  // (`nodes` is unchanged then, so the anchor effect does not run).
  const cursorChainRef = useRef<string[]>([]);
  // A zoom-change wants to keep some content point fixed on screen; this carries
  // that intent to the post-render layout effect (mirrors anchorRef for folds).
  const zoomAnchorRef = useRef<{
    X: number;
    Y: number;
    px: number;
    py: number;
  } | null>(null);
  // An explicit target scroll (used by "fit"): overrides zoomAnchorRef when set.
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);
  // The zoom currently committed to the DOM. The wheel handler reads this (not
  // the `zoom` state, which is stale within a batch of rapid events) so the
  // cursor anchor is always computed against what's actually on screen.
  const zoomRef = useRef(zoom);

  // The code font FAMILY follows the editor live: VS Code doesn't reload the
  // webview on a font-setting change, it rewrites the CSS variables on the
  // root element's style attribute in place — so watch that attribute (the
  // same trick the infoview's own components use) and re-resolve. A change
  // clears layout.ts's width cache and, via this state, rebuilds the engine
  // so all geometry is re-measured in the new family. Inert outside the
  // webview: nothing rewrites the root style attribute there.
  // The palette follows the theme by the same route, and for the same reason:
  // switching the colour theme rewrites those variables in place. Colours are
  // `var(--ptw-…)` at the render sites, so the browser repaints them without
  // React — this state exists only to re-derive the light/dark STAMP the
  // palette keys on (see theme.ts). Geometry is untouched, unlike the font.
  const [codeFont, setCodeFont] = useState(getCodeFontFamily);
  const [themeKind, setThemeKind] = useState(resolveThemeKind);
  ensurePaletteStyle();
  // `{keyword: "#C586C0", …}` → `{"--ptw-tok-keyword": "#C586C0", …}`. Only the
  // types theme.ts actually declares a variable for; anything else the resolver
  // finds is ignored rather than inventing a variable nothing reads.
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

  // One layout engine per (proof, hyp-label mode, code font); rebuilding it is
  // how the data swaps. Keep the proof reference stable across cursor moves
  // (widget) so the fold/zoom reset below only fires on an actual proof
  // change, not on every re-highlight.
  // The full tree (pre any on-demand elision) — the space new elide-runs are
  // picked and validated in, so a run always keys on original node ids.
  const baseNodes = useMemo(
    () => proofToTree(proof, { hypMode, brief }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proof, hypMode, brief, codeFont],
  );
  // Every tactic the step cut (hover-bar ⋯) is offered on. Computed in one
  // pass per base tree: the test walks a subtree, so asking it per drawn node
  // per render would be cubic.
  const elidableIds = useMemo(() => stepElidable(baseNodes), [baseNodes]);
  // The post-elision tree the engine is built from, as its own memo: the
  // overview keep set (below) has to resolve the CURSOR against exactly these
  // nodes, and doing that off `engine.allNodes()` would make the engine
  // depend on itself — the engine's sizing needs the keep set, and the keep
  // set needs the node list. Splitting the list out breaks the cycle with
  // pure functions on both sides.
  const treeNodes = useMemo(() => {
    // Combine (auto linear-run collapse) is applied alongside the manual
    // elide cuts, computed over the nodes the manual cuts DON'T claim so the
    // two stay disjoint.
    let cuts = elideCuts;
    if (combine) {
      const byId = new Map(baseNodes.map((n) => [n.id, n]));
      const manual = new Set<string>();
      for (const c of elideCuts)
        for (const id of resolveCut(c, byId)) manual.add(id);
      cuts = [...elideCuts, ...combineRuns(baseNodes, manual)];
    }
    return applyElisions(baseNodes, cuts);
  }, [baseNodes, elideCuts, combine]);
  // Overview: which node the cursor is on, resolved over `treeNodes` with the
  // same pure pair the accent uses (so the two resolutions cannot disagree),
  // reduced to a STRING before the set is built — the id changes only when
  // the cursor crosses into a different tactic, so walking a cursor within
  // one tactic rebuilds nothing.
  const overviewCursorId = useMemo(
    () =>
      overview && highlightPos
        ? tacticNodeAt(tacticTargets(treeNodes), highlightPos)
        : null,
    [overview, treeNodes, highlightPos],
  );
  // The local region kept at full size: the cursor's node, its goals, and one
  // more step each way — ancestors ×2 (the goal this tactic consumes, and the
  // tactic that produced it) and descendants ×2 (the goals it leaves, and the
  // tactics answering them). DIRECTED on purpose: an undirected radius would
  // pull in sibling branches through the shared parent goal, which is exactly
  // the material an overview exists to shrink. Standalone app / cursor
  // outside the proof → empty set → everything is a chip, hover to peek.
  const overviewKeep = useMemo(() => {
    const keep = new Set<string>();
    if (!overview || !overviewCursorId) return keep;
    const children = new Map<string, string[]>();
    for (const n of treeNodes)
      for (const p of n.parents)
        (children.get(p.id) ?? children.set(p.id, []).get(p.id)!).push(n.id);
    const byId = new Map(treeNodes.map((n) => [n.id, n]));
    keep.add(overviewCursorId);
    let up = [overviewCursorId];
    for (let d = 0; d < 2; d++) {
      up = up.flatMap((id) => (byId.get(id)?.parents ?? []).map((p) => p.id));
      up.forEach((id) => keep.add(id));
    }
    let down = [overviewCursorId];
    for (let d = 0; d < 2; d++) {
      down = down.flatMap((id) => children.get(id) ?? []);
      down.forEach((id) => keep.add(id));
    }
    return keep;
  }, [overview, overviewCursorId, treeNodes]);
  const engine = useMemo(
    // `codeFont` isn't read here, but the engine measures every label in it
    // via layout.ts module state — the dep is what forces a re-measure when
    // the editor font changes (hence the lint suppression: the dependency is
    // real, just invisible to the linter).
    () =>
      createLayoutEngine(treeNodes, {
        // See forcedReflow: aligned tracks wraps even when ¶ is off.
        reflow: forcedReflow ?? reflow,
        // Only the widget draws chips, so only the widget reserves room for
        // them (see LayoutEngineOptions.chips).
        chips: !!onAddTactic,
        overview: overview ? { keep: overviewKeep } : undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [treeNodes, codeFont, reflow, forcedReflow, overview, overviewKeep],
  );

  // Two different events, and conflating them is what made editing painful.
  //
  // `proofKey` is the proof's IDENTITY, and it must NOT be derived from
  // metavariable ids. It used to be the root goal's mvarId, on the measured
  // basis that adding or deleting a tactic keeps it — but an mvarId is an
  // ELABORATION-ORDER artifact, and that only holds while the edit doesn't
  // change how many metavariables are allocated before the root. Adding a
  // `calc` link does (it introduces a `?_`), so the proof being edited
  // "became a different proof", reset everything and scrolled the author back
  // to the top of the very proof they were working in. Measured on the scratch
  // file: one appended link changed the edited theorem's root id, and
  // renumbered 34 of 34 ids in the theorem BELOW it. The widget therefore
  // ships `proofId` — the DECLARATION NAME — which does not move when a body
  // does; `rootIds` remains the fallback for the CLI wire, where nothing is
  // ever edited and the picker swaps whole records anyway.
  //
  // `shapeKey` is the node set. It changes on any structural edit, and used to
  // drive the reset — so adding a tactic or deleting one threw away fold,
  // zoom and focus and scrolled back to the root, which is exactly where you
  // are NOT working. Now a same-proof shape change only PRUNES state that no
  // longer refers to anything; scroll and zoom stay put.
  //
  // Both are derived state, adjusted during render rather than in an effect
  // (avoids a cascading re-render).
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
  if (proofKey !== prevProof) {
    setPrevProof(proofKey);
    setPrevShape(shapeKey);
    setCollapsed(new Set());
    setZoom(1);
    setSeq({ mode: "off" });
    setFocusId(null);
    setEditing(null);
    setPicking(null);
    setArming(null);
    setElideCuts([]);
    // A different proof entirely: whatever stub was waiting to be typed over
    // belongs to the old one.
    setPendingFill(null);
    setElidePick(null);
    setBandPick(null);
    // A different proof's splits are different nodes entirely. (A same-proof
    // EDIT needs no pruning: `pick` is read modulo the live child count, and
    // keys naming a vanished split are simply never looked up.)
    setPick({});
  } else if (shapeKey !== prevShape) {
    setPrevShape(shapeKey);
    // Same proof, edited. Keep everything that still refers to a live node and
    // drop only what doesn't: a collapsed id that vanished would linger
    // forever, and a focus root or sequence endpoint that vanished would scope
    // the view to nothing.
    const live = new Set<string>();
    for (const st of proof.steps) {
      live.add(st.goalBefore.id);
      live.add(`tactic:${st.goalBefore.id}`);
      for (const g of stepGoalsAfter(st)) live.add(g.id);
    }
    setCollapsed((prev) => {
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
    if (focusId && !live.has(focusId)) setFocusId(null);
    if (
      (seq.mode === "pick" && seq.from && !live.has(seq.from)) ||
      (seq.mode === "view" && (!live.has(seq.from) || !live.has(seq.to)))
    )
      setSeq({ mode: "off" });
    // Drop any elide-run whose endpoints vanished (or no longer form a path)
    // under the edit — keyed on the base tree, same identity check as above.
    setElideCuts((cs) => pruneCuts(baseNodes, cs));
    // The source moved under the edit box (usually OUR own committed edit
    // coming back), so its ranges are stale either way. The relation picker
    // holds ranges too, and the edit that just landed is exactly what
    // invalidates them.
    //
    // A staged `calc` fill is the ONE exception, for the same reason
    // `pendingFill` is: the redraw it is riding out is the one its OWN
    // insertion caused, and closing the overlay would abandon the author
    // mid-gesture with a half-filled link. Its ranges are still good — they
    // describe the line that insertion just wrote, which this re-elaboration
    // reports rather than moves. Only the node id it hangs off can have gone
    // (mvarIds renumber around any edit), and that is re-resolved below.
    setEditing((cur) => (cur?.calcStage ? cur : null));
    setPicking(null);
    // An armed delete holds ranges too, and a shape change means the document
    // moved under them — exactly what must not be committed blind.
    setArming(null);
  }

  // Display flags written in the source (see NodeFlags) seed the view ONCE per
  // proof — a starting view, not a lock: both directives can be undone by hand
  // from there exactly as the equivalent gesture can. Keyed on the proof's
  // identity like the reset above, and adjusted during render for the same
  // reason; a first mount seeds too (the reset only fires on a CHANGE), and it
  // runs after the reset in the same render, so on a new proof the seed is
  // what survives.
  //
  // `.fold` seeds the collapsed set. `.none` seeds a `step` ElideCut — the
  // hover bar's ◌, written into the proof instead of clicked: the tactic and
  // the blocks it opened leave the tree and the trunk closes up over a ghost,
  // which restores them on a click. Seeded from `baseNodes` rather than the
  // engine's, since applying that very cut is what removes the flagged node
  // from the engine's tree.
  //
  // A `.none` on a ROOT GOAL (the pre-proof narrative slot) targets the tactic
  // that opens the proof, so its target ids are already tactic ids and the
  // same cut applies to them; a `.none` on a tactic acts on that tactic
  // itself.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (seededFor !== proofKey) {
    setSeededFor(proofKey);
    const seed = baseNodes.flatMap((n) =>
      n.flags?.fold ? (n.flags.targets ?? []) : [],
    );
    if (seed.length > 0) setCollapsed(new Set(seed));
    const cuts: ElideCut[] = [];
    for (const n of baseNodes) {
      if (!n.flags?.elide) continue;
      const note = n.flags.note;
      if (n.type === "tactic") cuts.push({ kind: "step", id: n.id, note });
      else
        for (const t of n.flags.targets ?? [])
          cuts.push({ kind: "step", id: t, note });
    }
    if (cuts.length > 0) setElideCuts(cuts);
  }

  // In `view` mode, restrict the layout to the chosen path's nodes (or null if
  // the two endpoints aren't on one ancestor→descendant line — leaves the tree
  // intact). Drives `computeLayout(only)`.
  const only = useMemo(() => {
    if (seq.mode !== "view") return null;
    const path = engine.pathBetween(seq.from, seq.to);
    return path ? new Set(path) : null;
  }, [engine, seq]);

  // The focused subtree's id set (null = the whole proof). Scopes the layout
  // world; folding keeps working inside it (see computeLayout).
  const focusSet = useMemo(
    () => (focusId ? engine.subtreeIds(focusId) : null),
    [engine, focusId],
  );

  // Every node that branches, with its children in SOURCE order — the set the
  // gallery pages through. Empty unless gallery mode is on, so nothing here
  // costs anything in the normal view.
  const splits = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!gallery) return m;
    for (const id of engine.foldableIds()) {
      const cs = engine.childrenOf(id);
      if (cs.length > 1) m.set(id, cs);
    }
    return m;
  }, [engine, gallery]);

  // Which child of each split is showing, resolved modulo the child count.
  const shownChild = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, cs] of splits)
      m.set(id, (((pick[id] ?? 0) % cs.length) + cs.length) % cs.length);
    return m;
  }, [splits, pick]);

  // The branches NOT showing. Handed to computeLayout as `hide`, which seeds
  // the same fixpoint sweep the fold rule uses — so hiding a branch's root
  // takes its whole subtree with it, and no separate reachability pass is
  // needed here.
  //
  // The SOURCE's own elisions (`.none`) used to join this set. They don't any
  // more: a `.none` seeds a `step` ElideCut instead (see the seed block
  // above), which is a different and better mechanism for the same idea —
  // the nodes leave the tree entirely rather than being masked out of it, and
  // what stands in their place is the ghost, which restores on a click.
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

  const { nodes, links, extent } = useMemo(
    () =>
      engine.computeLayout(
        collapsed,
        only,
        focusSet,
        compact,
        sideBySide,
        hide,
        aside,
      ),
    [engine, collapsed, only, focusSet, compact, sideBySide, hide, aside],
  );
  // Nodes with a VISIBLE child, i.e. an outgoing connector. The chip lane
  // centres its chips on the incoming trunk lane, which is also where a
  // child's connector drops — fine on a pending LEAF (most chip bearers),
  // but a `step` chip on a stub-consumed link (and the repair chip on a
  // half-parsed calc) sits on a goal that HAS children, and a chip drawn on
  // the goal→child edge reads as "insert between these two" when the
  // insertion actually lands ABOVE the box. Those lanes shift right of the
  // connector instead (see the lane transform).
  const drawnParentIds = useMemo(
    () => new Set(links.map((l) => l.source.data.id)),
    [links],
  );

  // A staged `calc` fill outlives the redraw its own insertion caused (see the
  // shape-change branch), but the node it hangs off may not: an insertion
  // renumbers the mvarIds around it, so the overlay's `id` can name a node that
  // no longer exists — and the overlay is positioned by looking that id up, so
  // it would silently vanish mid-gesture.
  //
  // Re-resolved by SOURCE POSITION, the standing rule. The link's own line is
  // the anchor: the calc that owns it either starts on that line (a chain the
  // gesture opened) or contains it (a link written under an existing `calc`
  // keyword, including the synthesized node of a block that does not parse).
  // Nothing matching means the insertion is gone — an undo, most likely — so
  // the gesture is over.
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

  // Part two of a calc gesture, claimed the moment the stub it wrote is drawn
  // (see pendingFill): open the in-place editor on that `sorry`, empty, so the
  // author types the tactic straight into the link they just created. Escape —
  // or an empty commit — leaves the `sorry` exactly as it stands, which is the
  // whole reason the first half writes one instead of a hole.
  //
  // Adjusted during render (the prevShape/prevHlKey pattern) rather than in an
  // effect, so the editor opens in the same paint as the node. Guarded on the
  // node actually BEING a `sorry` tactic, so a request the elaboration never
  // honoured expires harmlessly instead of opening an editor on a neighbour.
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

  // The nodes an ARMED delete would take. Derived from the EXTENT rather than
  // from the tree's own subtree walk, deliberately: the extent is what the
  // edit will actually remove, so dimming anything else would show the user a
  // preview that does not match the buffer highlight sitting beside it. A node
  // qualifies by its own source position, which is the producing tactic's for
  // a goal — exactly the tactic whose text is going.
  // Every node's extent, resolved once per layout instead of once per node per
  // RENDER: `deleteExtent` scans the whole slot array, and the render loop only
  // wanted the boolean "is this deletable" to gate a hover button — so an
  // unrelated re-render (a hover, a zoom, a scroll) was paying O(nodes × slots)
  // for an answer that had not changed.
  const delExtents = useMemo(() => {
    const out = new Map<string, DeleteExtent | null>();
    if (!deleteSlots || !onDeleteTactic) return out;
    for (const n of nodes)
      if (n.data.deleteSpec && !n.data.synthetic)
        out.set(n.data.id, deleteExtent(n.data.deleteSpec, deleteSlots));
    return out;
  }, [nodes, deleteSlots, onDeleteTactic]);
  const armedIds = useMemo(() => {
    const out = new Set<string>();
    const e = armExtent;
    if (!arming || !e) return out;
    // `posLE`, not a hand-rolled comparison: proofToTree.ts is the one coding
    // of "compare two LSP positions" in the web half, and a second one drifting
    // from it is this codebase's most-repeated mistake.
    const within = (p: { line: number; character: number }) =>
      posLE(e.start, p) && posLE(p, e.stop);
    for (const n of nodes)
      if (n.data.id === arming.id || (n.data.position && within(n.data.position.start)))
        out.add(n.data.id);
    return out;
  }, [arming, armExtent, nodes]);

  // A cursor move re-arms the dismissed accent (derived state, adjusted
  // during render like prevShape above).
  const hlKey = highlightPos
    ? `${highlightPos.line}:${highlightPos.character}`
    : "";
  const [prevHlKey, setPrevHlKey] = useState(hlKey);
  if (hlKey !== prevHlKey) {
    setPrevHlKey(hlKey);
    setHlDismissed(false);
  }

  // source→tree: the ONE node the editor cursor accents. Every recorded range
  // overlaps by construction — a goal carries its PRODUCER's range, a
  // structured tactic (induction/have) contains everything nested inside it,
  // and Paperproof ranges include trailing trivia — so the naive "accent
  // whatever contains the cursor" lights up half a branch at once. Instead:
  // the innermost (smallest-span) TACTIC containing the cursor, and nothing
  // else — goals and hyp labels never take the cursor accent, theirs being
  // the producing tactic's span, i.e. always redundant with it.
  //
  // A cursor inside a COMMENT needs its own answer. Comments are parser
  // trivia, so they sit inside the enclosing structured tactic's range (and
  // inside the previous tactic's, whose range includes trailing trivia) but
  // own no range of their own — the innermost rule resolves a comment line to
  // the `have`/`by_cases` at the top of the branch, so scrolling through a
  // comment yanked the accent up the tree and back down again. Instead a
  // comment resolves to the tactic it ANNOTATES, by the same rule proofToTree
  // uses to attach comment strips to nodes, so the accent lands where the
  // comment is already drawn.
  const commentSpans = useMemo(
    () =>
      (proof.comments ?? []).map((c) => ({
        start: c.start,
        // A `--` comment owns the rest of its line: the lexed range stops at
        // the last character, so without this the cursor resting past the text
        // (or at end-of-line, where it naturally lands) would fall through.
        stop: c.text.startsWith("--")
          ? { line: c.stop.line, character: Number.MAX_SAFE_INTEGER }
          : c.stop,
      })),
    [proof],
  );
  // Every VISIBLE tactic with a span, in the shape `tacticNodeAt` wants.
  // The VISIBLE nodes' ranges — what the accent may light up. Built by the
  // shared `tacticTargets` (see proofToTree.ts), which is also what the gallery
  // follow and the diagnostics mapping read.
  const cursorTargets = useMemo(
    () => tacticTargets(nodes.map((n) => n.data)),
    [nodes],
  );
  // Per comment range, the node whose strip is SHOWING it. Taken straight from
  // the attribution proofToTree already computed (TreeNode.commentRanges)
  // rather than re-derived here, so the accent can never drift from where the
  // comment is drawn. Goal owners (the root's "here's the plan" narrative) are
  // kept but resolve to null below, since goals never take the accent.
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
  const cursorNodeId = useMemo(() => {
    if (hlKey === "" || hlDismissed || !highlightPos) return null;
    const ci = commentSpans.findIndex((c) =>
      positionContains(c, highlightPos),
    );
    if (ci >= 0) return commentOwner[ci];
    return tacticNodeAt(cursorTargets, highlightPos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorTargets, hlKey, hlDismissed, commentSpans, commentOwner]);

  // Lean's diagnostics, mapped onto the nodes that will draw them.
  //
  // Resolved against EVERY node rather than the visible ones — the same
  // scoping `galleryTarget` needs, and for the same reason: a folded-away or
  // un-paged error is precisely the one the pager exists to take you to, and
  // scoping to what is drawn would make the count change as you fold.
  //
  // `open` is every goal no tactic consumes, which in the tree is exactly a
  // goal that is nobody's parent — the fallback a failing tactic's error lands
  // on, since such a tactic records no `TacticInfo` and so has no node of its
  // own (the recovery parser now draws many of them, but not the term-position
  // failures `errToSorry` swallows). Root goals are dropped: their position is
  // the theorem statement, not a tactic's, so they are not an honest answer to
  // "which open goal is this about".
  const diag = useMemo(() => {
    if (!diagnostics || diagnostics.length === 0) return null;
    const all = engine.allNodes();
    const consumed = new Set<string>();
    for (const n of all) for (const p of n.parents) consumed.add(p.id);
    const open: { id: string; position: ProofStepPosition }[] = [];
    const chipped = new Set<string>();
    for (const n of all) {
      if (n.type !== "goal" || consumed.has(n.id)) continue;
      if (n.position) open.push({ id: n.id, position: n.position });
      if (n.addSpec) chipped.add(n.id);
    }
    return attachDiagnostics(
      tacticTargets(all),
      diagnostics,
      { open, chipped },
    );
  }, [engine, diagnostics]);

  // Which diagnostic the pager is on, held by KEY rather than by index: the
  // list is rebuilt on every re-elaboration, and a key is built from the
  // position and message (diagnostics.ts), so the one you were reading survives
  // an edit elsewhere. An absent key resolves to the first, which is also the
  // initial state — so no clamping and no reset effect.
  const [diagSel, setDiagSel] = useState<string | null>(null);
  const diagList = diag?.ordered ?? [];
  const diagIdx = Math.max(
    0,
    diagList.findIndex((o) => o.diag.key === diagSel),
  );
  const diagCur = diagList[diagIdx] ?? null;

  // Every node's source key for THIS layout. One rebuild per layout rather than
  // one per reader: `layoutKeys` is an O(n) map build (it carries a per-position
  // ordinal, since nodes can legitimately share a position), and `anchorOn` used
  // to rebuild the whole thing to read a single entry.
  const nodeKeys = useMemo(() => layoutKeys(nodes), [nodes]);
  // Capture a re-anchor on node `id` (or the root) before a relayout, so the
  // post-render `[nodes]` effect can hold that node fixed on screen.
  const anchorOn = (id: string) => {
    const cur = nodes.find((n) => n.data.id === id);
    // Carry the SOURCE key, not just the id (see `layoutKeys`): a commit that
    // pins "the node I was editing" is exactly the case where re-elaboration
    // renumbers that node, and an id-keyed anchor would silently fall through
    // to the viewport-centre rule.
    if (cur)
      anchorRef.current = {
        id,
        key: nodeKeys.get(id)!.posKey ?? `I${id}`,
        x: cur.x,
        y: cur.y,
      };
  };

  /** Candidates for the tactic node being edited, in offer order. */
  const candidatesFor = (nodeId: string): CompletionPools => {
    const node = nodes.find((n) => n.data.id === nodeId);
    // A tactic's context is the goal it consumes — its parent in the tree.
    // An overlay hanging off a GOAL is asking about that goal itself, though:
    // the (+) chip, and the staged fill of a `calc` link, both open on the
    // pending goal, and taking its parent there reached the tactic ABOVE it,
    // which has no context of its own — so those overlays were offering
    // nothing but tactic names. The link case is the one this matters most
    // for: a chain restates part of its goal at every step, which is exactly
    // what the subterm tier is for.
    const goalId =
      node?.data.type === "goal" ? node.data.id : node?.data.parents[0]?.id;
    const goal = goalId
      ? nodes.find((n) => n.data.id === goalId)?.data
      : undefined;
    return {
      // Tier 1. `used` first: `tacticDependsOn` already marks what the
      // consuming tactic mentions, so that ordering is free and is exactly
      // "what this step is about".
      // A HypLine is the whole rendered `name : type`, so the name is the head.
      // Continuation lines (reflow wraps long context lines) carry no name of
      // their own and are skipped. A bundle can name several at once
      // (`a b : ℝ`), so split the head on spaces.
      hyps: [...(goal?.hyps ?? [])]
        .filter((h) => !h.cont)
        .sort((a, b) => Number(b.used) - Number(a.used))
        .flatMap((h) => h.text.split(" : ")[0].trim().split(/\s+/))
        .filter((n) => n && n !== "⊢"),
      // Tier 1.5.
      terms: goalId && getGoalTerms ? getGoalTerms(goalId) : [],
      tactics: proof.tacticNames ?? [],
    };
  };

  /** Recompute the list from the textarea's current value and caret. */
  const refreshCompletion = (nodeId: string, value: string, caret: number) => {
    const pools = candidatesFor(nodeId);
    const items = completionsAt(value, caret, pools);
    setCompletion(items.length > 0 ? { items, index: 0 } : null);
  };

  /** Splice the chosen item in, replacing the span it was matched against.
   * Reads `editing` rather than `editingRef`: this only ever runs from the
   * editor's own handlers, where the state is current, and the ref exists
   * solely to stop a blur re-committing from a stale closure — which has no
   * bearing here. */
  const acceptCompletion = (
    cur: NonNullable<typeof editing>,
    item: CompletionItem,
    ta: HTMLTextAreaElement | null,
  ) => {
    const value =
      cur.value.slice(0, item.from) + item.label + cur.value.slice(item.to);
    const caret = item.from + item.label.length;
    setEditing((e) => e && { ...e, value });
    syncAbbrev(editKey(cur)!, value, caret); // bypasses onChange — see `put` above
    setCompletion(null);
    // The textarea is controlled, so the caret has to be restored after the
    // render that applies `value` — setTimeout, not rAF: a hidden webview never
    // fires animation frames. Same reason clipboardFallback does it this way.
    window.setTimeout(() => {
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(caret, caret);
    }, 0);
  };

  // Anchor on the root: expand-all / collapse-all relayout the whole tree, and
  // Sugiyama re-centers the root over it, so without an anchor the root jumps.
  const anchorRoot = () => {
    const root = nodes.find((n) => n.data.parents.length === 0) ?? nodes[0];
    if (root) anchorOn(root.data.id);
  };

  const toggle = (id: string) => {
    anchorOn(id);

    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Expanding this node. In accordion mode, also collapse its sibling
        // branches so only one path stays open at this level.
        next.delete(id);
        if (accordion) for (const s of engine.siblingIds(id)) next.add(s);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Path-elide picking (⇥): like sequence picking but the chosen path is HIDDEN
  // (collapsed to a marker) instead of shown. Validated over the base tree, so
  // a cut always keys on original ids; overlapping an existing cut is rejected
  // (the second pick just becomes the new `from`).
  const commitElide = (a: string, b: string): boolean => {
    const byId = new Map(baseNodes.map((n) => [n.id, n]));
    const fwd = pathIds(byId, a, b);
    const path = fwd ?? pathIds(byId, b, a);
    if (!path) return false;
    const used = new Set<string>();
    for (const c of elideCuts)
      for (const pid of resolveCut(c, byId)) used.add(pid);
    if (path.some((pid) => used.has(pid))) return false;
    const cut: ElideCut = fwd
      ? { kind: "path", from: a, to: b }
      : { kind: "path", from: b, to: a };
    setElideCuts((cs) => [...cs, cut]);
    return true;
  };

  // Band-elide picking (⇳): the GEOMETRIC cut — collapse every node whose
  // vertical position lies between the two picks in the current compact layout,
  // regardless of goal lineage (so it can span branches → a multi-parent
  // marker). The band is read from post-layout `.y` (stable between the two
  // clicks, since the first pick triggers no relayout) and frozen as base ids.
  // A marker caught in the band is ABSORBED: its underlying nodes join the new
  // band and its own cut is dropped, so the result stays one cut per region.
  const commitBand = (a: string, b: string): boolean => {
    const pa = nodes.find((n) => n.data.id === a);
    const pb = nodes.find((n) => n.data.id === b);
    if (!pa || !pb) return false;
    const lo = Math.min(pa.y, pb.y);
    const hi = Math.max(pa.y, pb.y);
    const byId = new Map(baseNodes.map((n) => [n.id, n]));
    const ids = new Set<string>();
    const absorbed = new Set<string>(); // cutIds of markers inside the band
    for (const pn of nodes) {
      if (pn.y < lo || pn.y > hi) continue;
      if (pn.data.elidedCut) {
        // pn.data.id === the marker's cutId; pull its base nodes back in.
        absorbed.add(pn.data.id);
        const cut = elideCuts.find((c) => cutId(c) === pn.data.id);
        if (cut) for (const pid of resolveCut(cut, byId)) ids.add(pid);
      } else if (byId.has(pn.data.id)) {
        ids.add(pn.data.id);
      }
    }
    if (ids.size === 0) return false;
    setElideCuts((cs) => [
      ...cs.filter((c) => !absorbed.has(cutId(c))),
      { kind: "band", ids: [...ids] },
    ]);
    return true;
  };

  // A node click means different things per mode: fold/unfold in the tree, pick
  // a sequence endpoint, pick an elide endpoint, or (on a run marker) un-elide.
  // Picking the second endpoint orders the pair by ancestry (whichever is the
  // ancestor becomes the chain's top); two unrelated nodes can't form a path,
  // so we just restart the selection from the latest.
  const onNodeClick = (id: string, foldable: boolean) => {
    // An elision marker: click removes its cut (matched by the marker's id =
    // the cut's id). Works in any mode, so an elision is always one click from
    // being undone.
    // (A COMBINED node is not one of these — it's automatic, driven by the
    // toggle rather than a stored cut, so it just folds like any other node.)
    const clicked = nodes.find((n) => n.data.id === id)?.data;
    if (clicked?.elidedCut && !clicked.elidedCut.combined) {
      setElideCuts((cs) => cs.filter((c) => cutId(c) !== id));
      return;
    }
    if (elidePick) {
      const first = elidePick.from;
      if (first === null || first === id) setElidePick({ from: id });
      else if (commitElide(first, id)) setElidePick({ from: null });
      else setElidePick({ from: id }); // no path / overlap — restart here
      return;
    }
    if (bandPick) {
      const first = bandPick.from;
      if (first === null || first === id) setBandPick({ from: id });
      else if (commitBand(first, id)) setBandPick({ from: null });
      else setBandPick({ from: id });
      return;
    }
    if (seq.mode === "off") {
      if (foldable) toggle(id);
      return;
    }
    // In `pick` (after one endpoint) and in `view`, a click (re)sets `from`.
    if (seq.mode !== "pick" || seq.from === null || seq.from === id) {
      setSeq({ mode: "pick", from: id });
      return;
    }
    if (engine.pathBetween(seq.from, id))
      setSeq({ mode: "view", from: seq.from, to: id });
    else if (engine.pathBetween(id, seq.from))
      setSeq({ mode: "view", from: id, to: seq.from });
    else setSeq({ mode: "pick", from: id }); // not one path — restart here
  };

  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  // Pad the SVG by a full viewport on each side so any node can be scrolled to
  // the edge.
  const PAD_X = viewport.w;
  const PAD_Y = viewport.h;

  // Track the scroll container's size. PAD_X/PAD_Y use it to pad the SVG by a
  // full viewport on each side, so any node can be scrolled to the edge. Without
  // this, viewport stays {0,0} and the initial-scroll effect never runs.
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

  // Keep the "scroll showing the current layout" record up to date. Two
  // sources, because neither alone covers it: a `scroll` listener catches the
  // user (and the wheel handler), but scroll events are dispatched with the
  // rendering steps, so a hidden webview never delivers them — hence also the
  // post-commit sample below, which catches every programmatic scroll.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      lastScrollRef.current = { x: el.scrollLeft, y: el.scrollTop };
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Hold the view steady across a relayout. Every relayout gets an anchor now,
  // not just the gestures that set one: a proof arriving over RPC (our own
  // committed edit, or anyone typing in the buffer) rebuilds the engine and
  // moves boxes, while scroll stays at the same NUMBER — so the tree slid
  // under the viewport with nothing holding it. Where no gesture named an
  // anchor, the node nearest the viewport's vertical centre stands in: it is
  // what you were looking at, so pinning it is what "nothing moved" means.
  //
  // Except when the node you were ON is the one the edit DELETED, which is
  // exactly what commenting a tactic out does. Then there is nothing to hold
  // still, and the viewport-centre rule has to guess from whatever else
  // survived — badly, because "survived" is by source position and a position
  // can outlive its place in the tree. Measured on the scratch file, commenting
  // out `_ ≤ _ := by linarith` (the last well-formed link of a chain, so the
  // block stops parsing and takes two sibling branches with it): 28 nodes → 10,
  // every survivor shifting left by 419 as the tree's whole offset changed —
  // every survivor but one. The `ring` on the line above kept its position key
  // and moved x 208 → 1236, y 955 → 377, because with the calc unparsed it
  // hangs somewhere else entirely. Anchor on THAT and the view lurches ~1000px
  // right, which is the reported rightward drift. So a vanished cursor node
  // falls back to its nearest surviving ANCESTOR (here the `calc` head one line
  // up — literally the tactic above the one commented out) and, since the
  // subtree under it just disappeared, that ancestor is also scrolled into view
  // rather than merely held put.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = lastLayoutRef.current;
    const { x: sx, y: sy } = lastScrollRef.current;

    // Match nodes to the previous layout by SOURCE POSITION, falling back to the
    // id — see `layoutKeys` for why the id alone loses exactly the nodes an edit
    // touched, which is the whole job here.
    const keys = nodeKeys;
    const findByKey = (key: string) =>
      nodes.find((n) => {
        const k = keys.get(n.data.id)!;
        return k.posKey === key || k.idKey === key;
      });

    let anchor = anchorRef.current;
    anchorRef.current = null; // consume it; unrelated re-renders must not re-shift
    // A named anchor is only usable if the node is still THERE. Silently doing
    // nothing when it isn't is the worst option: the layout moved and the scroll
    // didn't, so the tree slides under the viewport. Fall through to the
    // viewport centre instead, which needs no node in particular to survive.
    if (anchor && !findByKey(anchor.key)) anchor = null;

    // The cursor's node was DELETED by this edit (see the note above). Walk its
    // recorded ancestor chain for the first link that survived and anchor there
    // instead — the tactic the deleted one hung under. Gated on that node having
    // been ON SCREEN in the layout we are replacing: if you were reading
    // somewhere else while an edit landed elsewhere, the thing you are looking
    // at is what should stay put, and the viewport-centre rule below says so.
    let refocus = false;
    const chain = cursorChainRef.current;
    if (!anchor && prev && chain.length > 0 && !findByKey(chain[0])) {
      const was0 = prev.get(chain[0]);
      const screenY0 = was0
        ? (MARGIN.top + PAD_Y + was0.y) * zoom - sy
        : Number.NaN;
      if (screenY0 >= 0 && screenY0 <= el.clientHeight) {
        for (const key of chain.slice(1)) {
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
      // Nearest to the old viewport's vertical centre AMONG nodes that
      // survived — one with no previous position has no movement to measure.
      // The comparison must be in SCROLL space, so the content offset the SVG
      // is drawn at (MARGIN.top + PAD_Y — and PAD_Y is a whole viewport) has to
      // be added to the node's content y. Omitting it biased the pick by ~a
      // screenful, so the "centre" node was one well above the viewport; the
      // shift below was still correct (a difference cancels the constant), so
      // it merely held the WRONG node steady.
      let best = Infinity;
      const mid = sy + el.clientHeight / 2;
      for (const n of nodes) {
        const k = keys.get(n.data.id)!;
        const key = k.posKey && prev.has(k.posKey) ? k.posKey : k.idKey;
        const was = prev.get(key);
        if (!was) continue;
        const d = Math.abs((MARGIN.top + PAD_Y + was.y) * zoom - mid);
        if (d < best) {
          best = d;
          anchor = { id: n.data.id, key, x: was.x, y: was.y };
        }
      }
    }

    const now = anchor && findByKey(anchor.key);
    if (anchor && now) {
      // Target = old scroll + how far the node moved in content space, clamped
      // to the NEW scrollable range ourselves.
      const maxX = el.scrollWidth - el.clientWidth;
      const maxY = el.scrollHeight - el.clientHeight;
      // Horizontal is followed only in WIDE mode, and the asymmetry is in the
      // two layouts' coordinates rather than in taste. Wide is a centred
      // Sugiyama tree: every x carries a global offset that moves whenever the
      // tree's overall width does, so following the anchor's dx is what CANCELS
      // that and keeps the view still. Compact pins the root's left edge at
      // x = 0 and indents from there, so an x is absolute and only moves when
      // that node's own INDENT changes — following it then scrolls sideways for
      // a reason the reader has no way to see, and pulls the left-aligned trunk
      // (the thing you read down) off screen. Measured on the scratch file,
      // commenting out `_ ≤ _ := by linarith`: in compact the surviving
      // `calc (a + b) ^ 2` re-indents from x 126 to 255, so following it drifted
      // the view 129px right — and repeatedly, once per toggle. Same rule the
      // cursor-tracking effect below already follows for the same reason.
      el.scrollLeft = clampScroll(
        compact ? sx : sx + (now.x - anchor.x) * zoom,
        maxX,
      );
      el.scrollTop = clampScroll(sy + (now.y - anchor.y) * zoom, maxY);
      // Holding it steady is not enough when what vanished was the subtree the
      // reader was actually looking at: the anchor can sit anywhere, including
      // off screen (the layout usually SHRANK, so the scroll above may also have
      // been clamped). Bring it back into view — vertically only, and only when
      // it is outside the comfortable band, matching the cursor-tracking rule
      // below. Horizontal is deliberately untouched in compact mode, where
      // re-centring would pull the left-aligned trunk off screen.
      if (refocus) {
        const cy = (MARGIN.top + PAD_Y + now.y) * zoom;
        const halfH = ((now.data.h + now.data.commentBlockH) / 2) * zoom;
        const pad = 32;
        if (
          cy - halfH < el.scrollTop + pad ||
          cy + halfH > el.scrollTop + el.clientHeight - pad
        )
          el.scrollTop = clampScroll(cy - el.clientHeight / 2, maxY);
      }
    }

    // Stored under BOTH keys, so the next relayout can prefer the source
    // position and still fall back to the id for a node that has none.
    const next = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      const k = keys.get(n.data.id)!;
      const at = { x: n.x, y: n.y };
      if (k.posKey) next.set(k.posKey, at);
      next.set(k.idKey, at);
    }
    lastLayoutRef.current = next;
    // Intentionally re-runs only on relayout (`nodes`), reading the current `zoom`;
    // zoom changes are handled by their own effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  // Record the cursor's node and its ancestors for the effect above. Declared
  // AFTER it on purpose (layout effects run in declaration order), so a relayout
  // reads the chain belonging to the layout being replaced and only then
  // overwrites it. A goal is followed up through `parents[0]`: an elide marker
  // can have several, and the first is the one the trunk drew it under.
  useLayoutEffect(() => {
    if (!cursorNodeId) {
      cursorChainRef.current = [];
      return;
    }
    const keys = nodeKeys;
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
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
      cur = byId.get(cur)?.data.parents[0]?.id;
    }
    cursorChainRef.current = chain;
  }, [cursorNodeId, nodes, nodeKeys]);

  // The current view: the full tree, a focused subtree, or one linearized
  // path — in either layout mode. Re-centering keys off this, so entering/
  // leaving a focus or sequence (or switching layout mode, which repositions
  // everything) re-centers on that view's top node.
  const viewKey =
    layout +
    ":" +
    // Only WHETHER reflow is on, never its column: crossing in or out of the
    // mode re-centres (the whole tree's proportions change), but a slider step
    // must leave the scroll alone — see onReflowChange.
    (reflow !== "off" ? "reflow:" : "") +
    // Only WHETHER overview is on, never its keep set: toggling the mode
    // changes the tree's proportions wholesale and re-centres, but a cursor
    // move (which swaps the keep set and rebuilds the engine) must hold the
    // view — the `[nodes]` anchor and the cursor-follow do that.
    (overview ? "ov:" : "") +
    // `brief` is out of viewKey for the same reason as `combine` below: it only
    // shortens label text, so every node keeps its id and its place in the
    // trunk — re-centring on the root would scroll you away from whatever you
    // were reading for a change that didn't move the tree's structure at all.
    // `combine` deliberately does NOT participate in viewKey (same reasoning as
    // gallery paging below): merging runs must keep the current scroll, not
    // re-centre on the root. The relayout is held by the `[nodes]` anchor,
    // which — with no explicit anchor set — pins the surviving node nearest the
    // viewport centre, so you keep looking at roughly the same material.
    (compact && sideBySide ? "cols:" : "") +
    // Gallery paging deliberately does NOT participate in viewKey: swapping the
    // shown branch must keep the current scroll/pan, not re-center. The
    // relayout it triggers is held steady by the `[nodes]` anchor above (the
    // trunk above the split is unmoved in compact layout, so scroll stays put).
    (seq.mode === "view"
      ? `seq:${seq.from}>${seq.to}`
      : focusId
        ? `focus:${focusId}`
        : "tree");

  // Focus a goal's subtree. Un-collapse the new root so the subtree actually
  // unfolds (it may have been collapsed when its icon was clicked).
  const focusOn = (id: string) => {
    setFocusId(id);
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };
  const exitFocus = () => setFocusId(null);
  // The focus root, for the breadcrumb pill's label. Read from `allNodes()`
  // rather than the drawn `nodes` because folding the root itself must not
  // make the way OUT of focus disappear — the whole point of the pill.
  const focusNode = useMemo(
    () =>
      focusId ? (engine.allNodes().find((n) => n.id === focusId) ?? null) : null,
    [engine, focusId],
  );

  // The top-left floaters stack in a fixed order, each row FLOATER_H apart:
  // the caller's slot (standalone only), the focus breadcrumb, whichever hint
  // is up (those four ARE mutually exclusive — three picking modes and the
  // staged calc fill), then the diagnostic pill. Derived ONCE: the rows used
  // to carry four copies of the same `headerExtra ? …` expression plus a
  // fifth in the pill's props, so a new row could not be added without
  // editing all five, and focus (unlike the hints) coexists with every one of
  // them — you can pick, elide or fill a calc while focused.
  const hintUp =
    seq.mode !== "off" || !!elidePick || !!bandPick || !!editing?.calcStage;
  const floaterRows = [!!headerExtra, focusId !== null, hintUp];
  const floaterTop = (row: number) =>
    8 + FLOATER_H * floaterRows.slice(0, row).filter(Boolean).length;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (
      !el ||
      (centeredOn.current?.proofKey === proofKey &&
        centeredOn.current?.viewKey === viewKey) ||
      viewport.w === 0 ||
      nodes.length === 0
    )
      return;

    // Sugiyama centers the root horizontally over the WHOLE (sub)tree, so root.x
    // is generally far from 0 — center the top node in the viewport. The compact
    // trunk is left-aligned at content x=0 instead, so pin the content's left
    // edge just inside the viewport. Vertically both put the root's band top
    // just under MARGIN.top. The SVG is scaled by `zoom`, so content units
    // convert to scroll px via *zoom.
    const root = nodes.find((n) => n.data.parents.length === 0) ?? nodes[0];
    const maxX = el.scrollWidth - el.clientWidth;
    const maxY = el.scrollHeight - el.clientHeight;
    el.scrollLeft = clampScroll(
      compact
        ? (MARGIN.left + PAD_X - COMPACT_LEFT) * zoom
        : (MARGIN.left + PAD_X + root.x) * zoom - viewport.w / 2,
      maxX,
    );
    el.scrollTop = clampScroll(
      (MARGIN.top +
        PAD_Y +
        root.y -
        (root.data.h + root.data.commentBlockH) / 2) *
        zoom -
        MARGIN.top,
      maxY,
    );
    centeredOn.current = { proofKey, viewKey };
  }, [viewport, nodes, proofKey, viewKey, zoom, PAD_X, PAD_Y, compact]);

  // Gallery follows the CURSOR: if the editor lands in a branch the gallery
  // isn't showing, page to it. Without this the tree↔source loop breaks in
  // exactly the mode that hides the most — you'd move the cursor into a case
  // and the tree would sit on a different one, with the accent nowhere. The
  // path from the root to the cursor's node names, at each split it crosses,
  // which child is on the way there.
  // Adjusted during render (the same pattern as prevShape/prevHlKey above)
  // rather than in an effect, so it costs no cascading render; the guard makes
  // it fire only when the cursor lands on a DIFFERENT node, which is what
  // keeps it from fighting a branch you paged to by hand.
  // Resolved against EVERY tactic in the proof, not `cursorNodeId`, which
  // comes from `cursorTargets` — built from the VISIBLE nodes. That scoping is
  // right for the accent (it lights a drawn box) but fatal here: the branch we
  // need to page to is by definition the one not drawn, so cursorNodeId is
  // null exactly when this has work to do. Once the follow pages to it the
  // node becomes visible and the accent resolves normally.
  const galleryTarget = useMemo(() => {
    if (!gallery || hlKey === "" || hlDismissed || !highlightPos) return null;
    // EVERY node, not just the visible ones: the branch to page to is by
    // definition the one not drawn, so `cursorTargets` is null exactly when
    // this has work to do.
    return tacticNodeAt(tacticTargets(engine.allNodes()), highlightPos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, gallery, hlKey, hlDismissed]);
  // Page every gallery split on the root→`id` path to the child that leads
  // there, so a node hidden behind a pager becomes visible. Shared by the
  // cursor follow above and the diagnostic pager below — both are "show me
  // that node", and a second copy of this walk would be a second place for the
  // source-order indexing to drift.
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

  // source→tree tracking: the accented node follows the editor cursor
  // (highlightPos → cursorNodeId); keep it IN VIEW so moving through the
  // proof in an editor (the lens especially) walks the tree along with you.
  // Only fires when the cursor lands on a DIFFERENT node (scroll/zoom/fold
  // alone never yank the view), and only scrolls when the node is outside a
  // comfortable band of the viewport — then centers it smoothly.
  //
  // Keyed on the CURSOR (hlKey), not on the resolved node id, because node ids
  // are mvarIds: a re-elaboration mints new ones for everything downstream of
  // an edit, so an id-keyed guard read "the cursor moved to a new node" every
  // time the file was re-parsed and smooth-scrolled the view away — while the
  // cursor had not moved at all. That was the unpredictable scroll during
  // editing; the tree only follows a real cursor move now.
  const trackedCursorNode = useRef<string | null>(null);
  // The in-flight view move (see FollowAnim). One ref, shared with the
  // diagnostic pager: they are both "move the view", so whichever spoke last
  // must cancel the other rather than race it.
  const followAnim = useRef<FollowAnim>({ raf: null, timer: null });
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
    if (trackedCursorNode.current === hlKey) return;
    const node = nodes.find((n) => n.data.id === cursorNodeId);
    if (!node) return; // hidden by folding/focus — don't fight the user
    // Marked tracked only once actually FOUND: a node hidden at cursor-move
    // time still gets tracked when unfolding later reveals it.
    trackedCursorNode.current = hlKey;
    const { left, top } = inViewScroll(el, node, zoom, PAD_X, PAD_Y, compact);
    if (left === el.scrollLeft && top === el.scrollTop) return;
    animateScroll(followAnim.current, el, left, top);
  }, [cursorNodeId, hlKey, hlDismissed, nodes, zoom, PAD_X, PAD_Y, compact]);

  // The diagnostic pager owes a view move: the node was named, the unfold and
  // the gallery paging were requested synchronously, and the SCROLL has to wait
  // for the relayout those cause — so the request is held and the effect below
  // spends it on the first layout that actually contains the node.
  //
  // Guarded by a ref written in the effect, the `trackedCursorNode` pattern
  // (rather than clearing the state, which cascades a render), and consumed on
  // the seek OBJECT's identity, so asking for the same node twice moves the
  // view twice. A node the layout never contains — one inside a sequence or a
  // focus scope, both narrowings the user asked for and neither worth tearing
  // down for this — simply leaves the request unspent; if a later unfold does
  // reveal it, the move happens then, which is the same behaviour the cursor
  // follow has for a node hidden at cursor-move time.
  const [diagSeek, setDiagSeek] = useState<{ id: string } | null>(null);
  const soughtDiag = useRef<{ id: string } | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !diagSeek || soughtDiag.current === diagSeek) return;
    const node = nodes.find((n) => n.data.id === diagSeek.id);
    if (!node) return;
    soughtDiag.current = diagSeek;
    const { left, top } = inViewScroll(el, node, zoom, PAD_X, PAD_Y, compact);
    if (left !== el.scrollLeft || top !== el.scrollTop)
      animateScroll(followAnim.current, el, left, top);
  }, [diagSeek, nodes, zoom, PAD_X, PAD_Y, compact]);

  // Go to a diagnostic's node: unfold whatever hides it, page the gallery to
  // it, then scroll it into view once the relayout lands. Unfolding walks the
  // FIRST parent chain, which is enough — `computeLayout` hides a node only
  // when ALL its parents are collapsed or hidden.
  const gotoDiagNode = (id: string | null) => {
    if (!id) return; // a diagnostic that belongs to the proof but to no node
    const byId = new Map(engine.allNodes().map((n) => [n.id, n]));
    setCollapsed((prev) => {
      let next: Set<string> | null = null;
      const seen = new Set<string>();
      let cur: string | undefined = byId.get(id)?.parents[0]?.id;
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        if (prev.has(cur)) (next ??= new Set(prev)).delete(cur);
        cur = byId.get(cur)?.parents[0]?.id;
      }
      return next ?? prev;
    });
    pageTo(id);
    setDiagSeek({ id });
  };
  /** Step the pager by `d` (wrapping) and go to what it lands on. */
  const stepDiag = (d: number) => {
    if (diagList.length === 0) return;
    const n = (diagIdx + d + diagList.length) % diagList.length;
    setDiagSel(diagList[n].diag.key);
    gotoDiagNode(diagList[n].nodeId);
  };

  // After a zoom change re-renders the (resized) SVG, restore scroll so the
  // intended point stays put: an explicit target (fit) wins, else the anchor
  // point under the cursor / viewport centre is held fixed.
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
    zoomRef.current = zoom; // the DOM now reflects this zoom
  }, [zoom]);

  // Post-commit half of the scroll record (see lastScrollRef): declared after
  // every effect that writes scroll, and with no dep list, so it samples where
  // the view actually settled on each commit — the half that works when a
  // hidden webview is delivering no scroll events.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) lastScrollRef.current = { x: el.scrollLeft, y: el.scrollTop };
  });

  // Re-zoom keeping the screen point (px,py) within the scroll box fixed. SVG
  // coord X under that point is (scrollLeft + px) / zoom; after the change we
  // want X * zoom' - scrollLeft' = px, so the layout effect solves scrollLeft'.
  const zoomAt = (next: number, px: number, py: number) => {
    const el = scrollRef.current;
    const n = clampZoom(next);
    const z0 = zoomRef.current; // the zoom on screen right now
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

  // Fit the tree's actual content (ignoring the viewport-sized padding) to the
  // scroll box width, then centre it horizontally and scroll to its top. A
  // node's extent includes its comment strip: the band (commentBlockH + h)
  // vertically, and the strip when it's wider than the node box.
  const fitWidth = () => {
    const el = scrollRef.current;
    // clientWidth is 0 while the view is hidden/unmeasured — fitting then
    // would just clamp zoom to the minimum.
    if (!el || el.clientWidth === 0 || nodes.length === 0) return;
    // A node's horizontal extent includes its comment strip. Wide mode
    // centers it on n.x; compact left-aligns it at the box's left edge —
    // except parented nodes' strips, which hang indented off the incoming lane
    // (COMMENT_INDENT) — so the widest extends right from there.
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
    const topY = Math.min(
      ...nodes.map(
        (n) => n.y - (n.data.h + n.data.commentBlockH) / 2,
      ),
    );
    const contentW = maxRight - minLeft + 2 * MARGIN.left;
    const z = clampZoom(el.clientWidth / contentW);
    const cx = (minLeft + maxRight) / 2;
    pendingScrollRef.current = {
      left: (MARGIN.left + PAD_X + cx) * z - el.clientWidth / 2,
      top: (MARGIN.top + PAD_Y + topY) * z - 24,
    };
    setZoom(z);
  };

  // Ctrl/⌘-wheel to zoom toward the cursor. Attached natively (non-passive) so
  // we can preventDefault the browser's page-zoom. Bound ONCE: the handler reads
  // the live zoom from a ref, so it never needs re-binding.
  //
  // SVG-in-browser note: we render at native size (viewBox === content extent)
  // and scale by setting the <svg> element's width/height; the browser then
  // re-rasterizes the vector content crisply at every zoom step (no blur, unlike
  // a CSS transform that composites a cached bitmap). That redraw is the cost, so
  // smoothness here is about not redrawing more than necessary: wheel events can
  // fire many times per frame, so we (1) accumulate them into a single target
  // zoom and (2) coalesce to one state update per animation frame via rAF —
  // collapsing a burst into one re-render + one re-rasterize instead of dozens.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let target = zoomRef.current; // compounding target across a wheel burst
    let px = 0;
    let py = 0;
    let raf: number | null = null;
    // Scroll-axis lock: a wheel gesture that STARTS vertical stays vertical —
    // dropping its horizontal component keeps a long read anchored to the
    // branch under the eye instead of drifting sideways. Gestures that start
    // horizontal are left entirely to native scrolling (diagonal allowed).
    // A gesture is a burst of wheel events with < LOCK_IDLE ms between them
    // (trackpad momentum keeps a gesture, and its lock, alive).
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
          // deltaMode 1 = lines (plain mouse wheels on some platforms).
          el.scrollTop += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        }
        return;
      }
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      px = e.clientX - rect.left;
      py = e.clientY - rect.top;
      // Re-base on the live zoom each frame so button/reset zooms aren't fought.
      if (raf === null) target = zoomRef.current;
      // Sensitivity tuned to feel like the browser's own page zoom
      // (ctrl-wheel/pinch): ~exp(-Δ/125). The old 0.0015 felt sluggish —
      // a full pinch barely moved the scale.
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

  return (
    // A positioned box the pinned toolbars/overlays anchor to (via `absolute`),
    // so the whole view is bounded by `height` — full viewport on the page, a
    // panel-sized box in the infoview.
    <div
      // Scope for the colour palette (theme.ts): every `var(--ptw-…)` below
      // inherits from here, so the whole tree re-colours by changing this one
      // attribute.
      data-ptw-theme={themeKind}
      data-ptw-fill={outline ? "none" : undefined}
      style={{
        position: "relative",
        width: "100%",
        height,
        overflow: "hidden",
        // The EDITOR's own token colours, when something upstream could read
        // them (widget + companion). Set INLINE and on `--ptw-tok-*` — the
        // derived variables, not the `--ptw-raw-*` inputs — so they replace the
        // built-in palette's `color-mix` outright rather than being softened by
        // it: that softening exists because a vendor palette is calibrated for
        // its OWN background, which is precisely not true of colours read from
        // the theme in use. Inline also beats theme.ts's stylesheet without a
        // specificity contest.
        ...tokenColorVars,
      }}
    >
      {/* No top bar: the top edge stays empty so the eye falls straight from
          the infoview's expected-type block onto the tree's root. Everything
          lives on the floating icon rail at the right; the only top-left
          floaters are the caller's slot (the standalone app's proof picker —
          the widget passes none) and the transient sequence-mode hint. */}
      {headerExtra && (
        <div
          style={{
            position: "absolute",
            top: 8,
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
      {/* Focus breadcrumb: what you are scoped to, and the way out. It lives
          here rather than on the rail because leaving a focus is not a view
          SETTING you reach for — it is a mode you need out of, and a glyph on
          the far right of a wide tree is both invisible and a long way from
          where the eye rests. Being the label of the goal you focused, it
          doubles as a "you are here"; Esc and ◎/⌥-click on the root do the
          same thing (three ways out, since focus is easy to enter by accident
          — ⌥-click is one modifier away from ⌘-click's reveal). */}
      {focusId && (
        <button
          type="button"
          title="Back to the whole proof (Esc, or ◎ / ⌥-click on the focused goal)"
          onClick={exitFocus}
          style={{
            position: "absolute",
            top: floaterTop(1),
            left: 8,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
            maxWidth: "min(60%, 420px)",
            fontFamily: "monospace",
            fontSize: 12,
            color: ACCENT_TEXT,
            background: NODE_STYLES.goal.stroke,
            border: "none",
            padding: "3px 10px",
            borderRadius: 999,
            cursor: "pointer",
          }}
        >
          <span>◎</span>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {focusNode?.label ?? "focused"}
          </span>
          <span style={{ opacity: 0.8 }}>✕</span>
        </button>
      )}
      {seq.mode !== "off" && (
        <div
          style={{
            position: "absolute",
            top: floaterTop(2),
            left: 8,
            zIndex: 10,
            fontFamily: "monospace",
            fontSize: 12,
            color: ACCENT_TEXT,
            background: SEQ_STROKE,
            padding: "3px 10px",
            borderRadius: 999,
          }}
        >
          {seq.mode === "view"
            ? "linear path · click a node to start over"
            : seq.from !== null
              ? "click the end node"
              : "click the start node"}
        </div>
      )}
      {elidePick && (
        <div
          style={{
            position: "absolute",
            top: floaterTop(2),
            left: 8,
            zIndex: 10,
            fontFamily: "monospace",
            fontSize: 12,
            color: ACCENT_TEXT,
            background: SEQ_STROKE,
            padding: "3px 10px",
            borderRadius: 999,
          }}
        >
          {elidePick.from !== null
            ? "elide · click the end node"
            : "elide · click the start node"}
        </div>
      )}
      {bandPick && (
        <div
          style={{
            position: "absolute",
            top: floaterTop(2),
            left: 8,
            zIndex: 10,
            fontFamily: "monospace",
            fontSize: 12,
            color: ACCENT_TEXT,
            background: SEQ_STROKE,
            padding: "3px 10px",
            borderRadius: 999,
          }}
        >
          {bandPick.from !== null
            ? "cut · click the bottom node"
            : "cut · click the top node"}
        </div>
      )}
      {/* The staged `calc` fill says which end it is asking for. The link is
          already in the file, so this also has to say what Enter does — taking
          the `_` is a real answer here, not a way of skipping the question. */}
      {editing?.calcStage && (
        <div
          style={{
            position: "absolute",
            top: floaterTop(2),
            left: 8,
            zIndex: 10,
            fontFamily: "monospace",
            fontSize: 12,
            color: ACCENT_TEXT,
            background: SEQ_STROKE,
            padding: "3px 10px",
            borderRadius: 999,
          }}
        >
          {editing.calcStage.stage === "lhs"
            ? "calc · left-hand side · Enter keeps _"
            : editing.calcStage.closes
              ? "calc · right-hand side · Enter keeps _"
              : "calc · right-hand side · this link steps, so name where it goes"}
        </div>
      )}
      <ControlRail
        onExpandAll={() => {
          anchorRoot();
          setCollapsed(new Set());
        }}
        onCollapseAll={() => {
          anchorRoot();
          setCollapsed(engine.foldableIds());
        }}
        accordion={accordion}
        onAccordionChange={setAccordion}
        onUndo={onUndo}
        layout={layout}
        onLayoutChange={setLayout}
        sideBySide={sideBySide}
        gallery={gallery}
        onGalleryChange={setGallery}
        onSideBySideChange={(v) => {
          anchorRoot();
          setSideBySide(v);
        }}
        reflow={reflow}
        forcedReflow={forcedReflow}
        reflowOpen={reflowOpen}
        onReflowOpenChange={setReflowOpen}
        onReflowChange={(v) => {
          // Pin the root only when ENTERING or LEAVING the mode, which
          // repositions everything. A slider step must not: dragging the width
          // is a continuous adjustment you watch, and re-centring on the root
          // at every column would drag the viewport away from the very boxes
          // you are sizing. Leaving the anchor unset there lets the `[nodes]`
          // effect pin the node nearest the viewport centre instead — the
          // treatment brief and ⇉ combine already get.
          if ((v === "off") !== (reflow === "off")) anchorRoot();
          setReflow(v);
        }}
        brief={brief}
        onBriefChange={(v) => {
          // Deliberately NO anchorRoot() (unlike reflow, which re-wraps every
          // box): brief only shortens some labels, so the structure is
          // unchanged and pinning the root would scroll away from whatever you
          // were reading. The `[nodes]` anchor holds the node nearest the
          // viewport centre instead — same treatment as ⇉ combine.
          setBrief(v);
        }}
        overview={overview}
        onOverviewChange={(v) => {
          // Toggling re-centres via viewKey ("ov:"), so no anchorRoot() —
          // the proportions change wholesale, like crossing in/out of reflow.
          setOverview(v);
        }}
        combine={combine}
        onCombineChange={(v) => {
          // Deliberately NO anchorRoot() here: the run you are looking at is
          // usually far from the root, and pinning the root scrolls the view
          // back to the top. Leaving the anchor unset lets the `[nodes]` effect
          // pin the surviving node nearest the viewport centre instead, which
          // keeps the new view as close as possible to the old one.
          setCombine(v);
        }}
        hypMode={hypMode}
        onHypModeChange={(v) => {
          // Every layer's hyp label resizes, so hold the root fixed on screen
          // (same treatment as expand/collapse-all).
          anchorRoot();
          setHypMode(v);
        }}
        seqActive={seq.mode !== "off"}
        onToggleSequence={() => {
          // The three picking modes are mutually exclusive.
          setElidePick(null);
          setBandPick(null);
          setSeq((s) =>
            s.mode === "off" ? { mode: "pick", from: null } : { mode: "off" },
          );
        }}
        elidePicking={elidePick !== null}
        onToggleElide={() => {
          setSeq({ mode: "off" });
          setBandPick(null);
          setElidePick((p) => (p ? null : { from: null }));
        }}
        // The geometric band cut is only well-defined in the compact stacked
        // outline, where `y` is a total vertical order (see commitBand).
        bandEnabled={compact && !sideBySide}
        bandPicking={bandPick !== null}
        onToggleBand={() => {
          setSeq({ mode: "off" });
          setElidePick(null);
          setBandPick((p) => (p ? null : { from: null }));
        }}
        onZoomIn={() => zoomBy(1.25)}
        onZoomOut={() => zoomBy(1 / 1.25)}
        onFit={fitWidth}
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
      {diagCur && (
        <DiagnosticPill
          index={diagIdx}
          count={diagList.length}
          diag={diagCur.diag}
          // Clickable when there is anywhere to go: a drawn node to seek in
          // the tree, or (widget) the source position to reveal — the latter
          // is what makes the click work even for a node-less diagnostic.
          clickable={!!diagCur.nodeId || !!onReveal}
          // Last row of the top-left stack (see floaterTop). Each row is
          // FLOATER_H apart — they are all one line of 12px text in the same
          // pill chrome, so one constant covers them rather than a per-row
          // measurement.
          top={floaterTop(3)}
          onStep={stepDiag}
          // "Take me to it" means BOTH surfaces: the tree (unfold, page,
          // scroll — gotoDiagNode) and the SOURCE (the editor's cursor onto
          // the error, through the same lens-aware reveal a node click uses;
          // a diagnostic's range is already the shape onReveal takes, and the
          // widget's tacticEdits lookup simply misses and falls through to
          // the raw range). The reveal also makes the click WORK for a
          // diagnostic that resolves to no node — `declaration uses 'sorry'`,
          // an unfinished branch — which used to be the one case where the
          // pill had the message but nowhere to take you. The cursor move it
          // causes flows back as highlightPos, so the accent lands wherever
          // the error's line resolves — agreeing with the ribboned node by
          // construction, both being derived from the same range.start.
          onGo={() => {
            gotoDiagNode(diagCur.nodeId);
            onReveal?.(diagCur.diag.range);
          }}
        />
      )}
      {/* Headroom veil: a short strip the content scrolls UNDER, fading it
          out before it reaches the top edge — so the floating overlays (the
          sequence hint, the standalone picker) sit on calm ground instead of
          on top of node text. Theme-correct by construction: it fades from
          the page's own background (the editor's in the webview, the app's
          standalone). Non-interactive; sits under the controls (zIndex). */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 26,
          zIndex: 9,
          pointerEvents: "none",
          background:
            "linear-gradient(to bottom, var(--vscode-editor-background, var(--bg, #fff)) 25%, transparent)",
        }}
      />
      <div
        ref={scrollRef}
        className="no-scrollbar"
        style={{
          width: "100%",
          height: "100%",
          overflow: "auto",
          // The tree is a DIAGRAM driven by click / double-click / drag, and a
          // stray text selection fights all three: a ⇧-click gets eaten as a
          // selection extension (which is exactly how the lens gesture broke
          // when it lived on ⇧-double-click), and drag-scrolling smears a
          // highlight across nodes. The in-place editor's textarea opts back
          // in below — everything else here is display, not text to copy.
          userSelect: "none",
        }}
        // A background click dismisses the editor-cursor accent (node and
        // label clicks stopPropagation, so they never land here): clicking
        // the widget focuses the infoview without moving the editor cursor,
        // and the lingering accent is just clutter at that point.
        onClick={() => {
          setHlDismissed(true);
          setPicking(null);
          setArming(null);
          // The ¶ slider is a floater over the tree, so clicking the tree is
          // "done with it" — the rail sits outside this container, so its own
          // clicks (the ¶ button included) never land here.
          setReflowOpen(false);
          // A staged calc fill closes on a background click — its blur is
          // deliberately a no-op (see the textarea's onBlur), so this is one
          // of its two ways out (Escape is the other). Closing writes
          // nothing: the `_`s stand and the file is valid. Other editing
          // states are untouched — their own blur has already committed by
          // the time this click lands.
          setEditing((cur) => (cur?.calcStage ? null : cur));
        }}
      >
        <svg
          width={svgW * zoom}
          height={svgH * zoom}
          viewBox={`0 0 ${svgW} ${svgH}`}
        >
          {/* Connectors are bare lines — no arrowheads: flow reads
              consistently down/right, so triangles were noise (and their
              tips poked into boxes and comment strips). */}
          {/* Coords originate at top-left */}
          <g transform={`translate(${MARGIN.left + PAD_X},${MARGIN.top + PAD_Y})`}>
            {links.map((link, i) => {
              // A node's band is caseH (badge) + commentBlockH (strip) + h
              // (box), box at the bottom: edges leave a box's bottom edge and
              // land above the target's whole band — reading order goal →
              // badge → comment → box. The band heights must include caseH or
              // lanes stop short on badged nodes.
              const startY =
                link.source.y +
                (link.source.data.h +
                  link.source.data.commentBlockH +
                  link.source.data.caseH) /
                  2;
              const bandTop =
                link.target.y -
                (link.target.data.h +
                  link.target.data.commentBlockH +
                  link.target.data.caseH) /
                  2;
              // The badge and comment strip are narrative, not dataflow:
              // landing points sit below them.
              const contentTop =
                bandTop +
                link.target.data.caseH +
                link.target.data.commentBlockH;
              const endY = bandTop - ARROW_GAP; // line ends just above the band

              const sLeft = link.source.x - link.source.data.w / 2;
              const tLeft = link.target.x - link.target.data.w / 2;
              let d: string;
              if (compact && link.col) {
                // Side-by-side column: the target sits in its own column to
                // the right, sharing its band top with every sibling column —
                // so route OVER the tops (down the parent's lane, across in
                // the gap band, down the child's own lane into its box). The
                // stacked │└ elbow would cut through earlier columns' boxes.
                const col = sLeft + TRUNK_INSET;
                const childLane = tLeft + TRUNK_INSET;
                const hy = bandTop - ARROW_GAP * 2;
                d = `M${col},${startY} L${col},${hy} L${childLane},${hy} L${childLane},${contentTop - ARROW_GAP}`;
              } else if (compact && link.lane !== undefined) {
                // Spine mode: an aside tactic's outgoing link rides the TRUNK
                // lane the layout stamped on it, from the tactic's box middle
                // — exactly where the incoming elbow's horizontal stub crosses
                // that lane, so the trunk reads as one continuous line with a
                // `——tac` stub off it. Straight down into a trunk child; │└
                // into an indented one. A lane derived from the tactic's own
                // left edge (the ordinary rule below) would cross the goal
                // boxes stacked left of the track. MIRRORED in layout.ts
                // linkSpans.
                const lane = link.lane;
                const srcBoxMid =
                  link.source.y +
                  (link.source.data.caseH + link.source.data.commentBlockH) /
                    2;
                if (Math.abs(tLeft - (lane - TRUNK_INSET)) < 0.5) {
                  d = `M${lane},${srcBoxMid} L${lane},${contentTop - ARROW_GAP}`;
                } else {
                  const landY = contentTop + link.target.data.h / 2;
                  d = `M${lane},${srcBoxMid} L${lane},${landY} L${tLeft - ARROW_GAP},${landY}`;
                }
              } else if (compact) {
                // Orthogonal connector dropped from a column just inside the
                // parent box's left edge: straight down into a same-indent
                // (trunk) child, or │└ into an indented branch — landing at
                // the vertical middle of the child's box.
                const col = sLeft + TRUNK_INSET;
                if (Math.abs(tLeft - sLeft) < 0.5) {
                  // Straight trunk lane: run CONTINUOUSLY past the comment
                  // strip (which hangs indented to the lane's right — see the
                  // strip render) down to the node's box.
                  d = `M${col},${startY} L${col},${contentTop - ARROW_GAP}`;
                } else {
                  const landY = contentTop + link.target.data.h / 2;
                  d = `M${col},${startY} L${col},${landY} L${tLeft - ARROW_GAP},${landY}`;
                }
              } else {
                const startX = link.source.x;
                const endX = link.target.x;
                const k = (endY - startY) * 0.7;
                d = `M${startX},${startY}
                    C${startX},${(startY + endY) / 2}
                     ${endX},${endY - k}
                     ${endX},${endY}`;
              }

              return (
                <path
                  key={i}
                  fill="none"
                  stroke={LINK_STROKE}
                  strokeWidth={1.5}
                  d={d}
                />
              );
            })}
            {/* `ni` keys the diagnostic ribbon's clipPath id. The node's own
                id would be the obvious choice and is the wrong one: mvarIds,
                elide markers (`»`, `·`) and `calc:<line>:<col>` all carry
                characters that have no business in a `url(#…)` fragment. The
                index is stable within a render, which is all a clip reference
                needs. */}
            {nodes.map((node, ni) => {
              const { w, h, hypH, hyps, lines, type, id, foldable, position } =
                node.data;
              // The node's band is caseH + commentBlockH + h with the box
              // pinned at the bottom — case badge, then comment strip, then
              // the box, mirroring source order. All box geometry hangs off
              // boxTop; inside it the text stack is the context block (hypH
              // tall, empty for tactics) then the label lines.
              const topH = node.data.caseH + node.data.commentBlockH;
              const boxTop = (topH - h) / 2;
              const contentTop = boxTop + NODE_PAD_Y;
              const labelTop = contentTop + hypH;
              const style = NODE_STYLES[type] ?? NODE_STYLES.default;
              const isCollapsed = collapsed.has(id);
              const seqActive = seq.mode !== "off";
              // A chosen endpoint (the pending `from` while picking, or either end
              // in `view`) gets a thick accent outline.
              const isEndpoint =
                (seq.mode === "pick" && seq.from === id) ||
                (seq.mode === "view" && (seq.from === id || seq.to === id)) ||
                elidePick?.from === id ||
                bandPick?.from === id;
              // The tactic node the editor cursor selects gets the same
              // accent (source→tree half of the link; see cursorNodeId for
              // why it's exactly one node).
              const isCursor = id === cursorNodeId;
              const accent = isEndpoint || isCursor;
              // A positioned node can reveal its source (widget only, outside
              // sequence mode). For a tactic node the whole box reveals; goal
              // nodes are the primary fold targets, so their box stays a fold
              // toggle and reveal rides the fast path (⌘/Ctrl-click — the
              // editor's own go-to-source gesture) or the hover action bar.
              const canReveal = seq.mode === "off" && !!onReveal && !!position;
              const revealable = canReveal && type === "tactic";
              const goalRevealable = canReveal && type === "goal";
              // Double-click on a tactic edits it in place (widget only).
              // A COMBINED node is a real (if synthetic) tactic node — the run's
              // tactics stacked — so it draws and behaves like one: normal box,
              // foldable, no dashed chip. Only an ELIDE marker gets the `⋯`
              // chip treatment and the click-to-restore.
              const isCombined = !!node.data.elidedCut?.combined;
              const isMarker = !!node.data.elidedCut && !isCombined;
              // A SYNTHETIC node (the `calc` of a block that failed to parse) is
              // editable too, and deliberately: it is the one node standing for
              // text that is unfinished, and its repair chip offers only the one
              // canned fix. The server ships it a `tacticEdits` entry keyed on
              // the chain's own start, so the lookup below resolves; the handler
              // still bails if it doesn't (the CLI ships no edits at all).
              const editable =
                seq.mode === "off" &&
                !elidePick &&
                !bandPick &&
                type === "tactic" &&
                !!position &&
                !!getTacticEdit &&
                !!onEditTactic;
              // The tactic can be opened in the lens (its hover-bar ⧉).
              // Gated on its OWN hook only: the lens just needs a range to
              // select, so it must not ride `editable` — a tactic missing from
              // `tacticEdits` (which keys on the step's exact start) would
              // otherwise lose the action silently.
              const popoutable =
                seq.mode === "off" &&
                type === "tactic" &&
                !!position &&
                !!onPopoutEdit;
              const isEditing = editing?.id === id;
              // A replace-edit's overlay stands in for the box, so the box
              // hides; an ADD's hangs below it and the goal must stay readable
              // while you answer it. A staged `calc` fill is the same case:
              // what it is asking about is the link it just wrote, so the goal
              // that link is proving belongs on screen beside the question.
              const hideForEdit =
                isEditing && !editing?.add && !editing?.calcStage;
              // A step the supplemental parser synthesized: `failed` carries
              // an error, `skipped` never ran, `term` came from a term-mode
              // proof's structure. Failed/skipped draw DASHED — the tactic is
              // text, not an accomplished step — and failed takes danger ink.
              // What Lean says is wrong here (widget only). `worst` is the
              // severity the ink takes; the list is what the tooltip reads.
              // Corner radius of the box, shared with the diagnostic ribbon
              // below — the ribbon is CLIPPED to this exact shape, so the two
              // must be one number rather than two that agree today.
              const boxRx = type === "tactic" ? 4 : 6;
              const nodeDiags = diag?.byNode.get(id);
              const diagSev = diag?.worst.get(id) ?? null;
              const diagInk =
                diagSev === 1 ? DANGER_FILL : diagSev === 2 ? WARN_FILL : null;
              const diagSelected = !!diagCur && diagCur.nodeId === id;
              const recovered = node.data.recovered;
              const recoveredStroke =
                recovered === "failed"
                  ? DANGER_FILL
                  : recovered === "skipped"
                    ? "var(--ptw-comment)"
                    : null;
              // A goal with descendants can become the root of a focused view
              // (⌥-click, or the hover bar's ◎); pointless for the current
              // focus root — which instead carries the way BACK on the same
              // two gestures, so the node you focused is also the node that
              // un-focuses and ◎ reads as a toggle rather than two glyphs.
              const focusable =
                type === "goal" && foldable && !seqActive && id !== focusId;
              const isFocusRoot = id === focusId && !seqActive;
              // Deleting. Offered wherever the extent is well defined and the
              // node stands for exactly one region of source: never on a
              // COMBINED or elided marker (which map to several tactics — the
              // same reason editing is off there), and never on the synthetic
              // `calc` of a block that never parsed, whose text is what the
              // repair chip exists to fix. A goal with no proof yet has no
              // deleteSpec at all, so pending leaves fall out for free.
              // Looked up, not recomputed (see `delExtents`). A declined
              // extent — a sibling shares the start line — must not even show
              // the button: arming it would offer nothing.
              const delExtent =
                seq.mode === "off" &&
                !elidePick &&
                !bandPick &&
                !isMarker &&
                !isCombined
                  ? (delExtents.get(id) ?? null)
                  : null;
              const deletable = !!delExtent;
              // Elide this tactic INTO the trunk (its hover-bar ⋯): the tactic
              // and any block it opened are lifted out, leaving a small dashed
              // ghost — the trunk closing up over it where something follows,
              // the subtree simply gone where nothing does. The complement of
              // folding, which hides what is BELOW a goal and leaves the node
              // standing: this is for a subtree you have finished reading.
              //
              // Offered wherever the cut would do anything (see `stepIds` —
              // only a childless tactic is declined), and never on a marker, a
              // combined run or the synthetic `calc` of a block that never
              // parsed — the same three the delete gesture declines, and for
              // the same reason: they stand for no single tactic, and the
              // synthetic one's whole purpose is the repair chip it carries.
              const elidable =
                seq.mode === "off" &&
                !elidePick &&
                !bandPick &&
                type === "tactic" &&
                !isMarker &&
                !isCombined &&
                !node.data.synthetic &&
                elidableIds.has(id);
              const isArming = arming?.id === id;
              // Secondary actions live in a hover bar with button-sized
              // targets (see NodeActionBar) instead of tiny corner glyphs or
              // modifier gestures: goals get reveal/focus, tactics the lens.
              // The bar STAYS while armed even without a hover, since the
              // confirm row replaces it and must survive the pointer leaving.
              // A mini chip gets NO bar — its hover is the peek, and a pill of
              // full-size buttons straddling a one-line chip would cover its
              // neighbours; click-gestures (fold, reveal, ⌥-focus) still work.
              const isMini = !!node.data.mini;
              const hasBar =
                !isEditing &&
                !isMini &&
                (goalRevealable ||
                  focusable ||
                  popoutable ||
                  elidable ||
                  deletable);
              // Hovering a positioned tactic lights its range up in the editor.
              const hoverHighlights =
                type === "tactic" && !!position && !!onHoverTactic;
              const clickable =
                seqActive ||
                !!elidePick ||
                !!bandPick ||
                isMarker ||
                foldable ||
                revealable ||
                goalRevealable;
              // Native hover tooltip: ONLY what you can do here. It used to
              // repeat the node's own text, which the box is already showing —
              // noise that buried the one thing a tooltip is good for. The
              // marker legend stays: `▸` is the sole bit of the box that isn't
              // self-explanatory.
              const hints = [
                revealable
                  ? "click to reveal in source"
                  : goalRevealable
                    ? `${CMD}-click to reveal in source`
                    : null,
                editable ? "double-click to edit" : null,
                focusable ? "⌥-click to focus this subtree" : null,
                isFocusRoot ? "⌥-click (or Esc) to leave this focus" : null,
                hyps?.some((l) => l.used)
                  ? `${HYP_MARK} = used by the tactic below`
                  : null,
              ].filter(Boolean);
              // Diagnostics lead the tooltip and keep their full text: the
              // message IS the content here, where the action hints are a
              // reminder. Separated from them by a blank line rather than
              // bulleted, so a multi-line Lean message reads as itself.
              const diagTip = (nodeDiags ?? [])
                .map((d) => `${d.severity === 1 ? "⨯" : "⚠"} ${d.message}`)
                .join("\n\n");
              const nodeTooltip = [
                diagTip,
                hints.map((h) => `· ${h}`).join("\n"),
              ]
                .filter(Boolean)
                .join("\n\n");
              // Widget-only interactive context lines, same idea (null keeps
              // the plain text for that line).
              const taggedHyps =
                hyps && hyps.length > 0 && renderTaggedHyps
                  ? renderTaggedHyps(
                      id,
                      hyps.map((l) => l.text),
                    )
                  : null;
              // Widget-only rich label: hover type tooltips on a goal, syntax
              // colouring on a tactic. Both return one node per wrapped line in
              // the same geometry, so the render branch below is shared; null
              // keeps the plain SVG text.
              const taggedLines =
                type === "goal"
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
                    : // A COMBINED node has no single source range, so it is
                      // rendered PER PART: each constituent tactic colours and
                      // hovers its own drawn lines, against its own
                      // `TacticEdit.text`. `WrappedLine.seg` is the explicit-
                      // newline segment a line came from; a part's label can
                      // itself be multi-line, so parts own segment RANGES, not
                      // single indices.
                      renderCombinedLines(
                        node.data.elidedCut?.parts,
                        lines,
                        renderTaggedTactic,
                      );

              const handleClick = (e: ReactMouseEvent<SVGGElement>) => {
                // A node click is an interaction, not a background click — it
                // must not dismiss the cursor accent (see the scroll div).
                e.stopPropagation();
                // While picking an elide endpoint (or on an elision marker), a
                // click is a pick / un-elide — never a reveal or focus.
                if (elidePick || bandPick || isMarker) {
                  onNodeClick(id, foldable);
                  return;
                }
                // In the widget, clicking a positioned tactic reveals its source
                // rather than folding; fold via goal nodes / the sequence tools.
                // On editable tactics the reveal defers past the double-click
                // window (see deferReveal), so the in-place editor's opening
                // gesture isn't cut short by a focus jump to the editor.
                if (revealable) {
                  if (editable) deferReveal(position!);
                  else onReveal!(position!);
                  return;
                }
                // Goal fast paths — the whole box is the target, no fiddly
                // icons: ⌘/Ctrl-click reveals in source (the editor's own
                // go-to-definition gesture), ⌥-click focuses the subtree.
                if (goalRevealable && (e.metaKey || e.ctrlKey)) {
                  onReveal!(position!);
                  return;
                }
                if (focusable && e.altKey) {
                  focusOn(id);
                  return;
                }
                // ⌥-click on the focus ROOT is the same gesture back out.
                if (isFocusRoot && e.altKey) {
                  exitFocus();
                  return;
                }
                onNodeClick(id, foldable);
              };

              return (
                <g
                  key={id}
                  transform={`translate(${node.x},${node.y})`}
                  // Everything an armed delete would take fades, so the tree
                  // shows the same answer the editor's highlight does. Paint
                  // only — nothing moves, and the fade is on the group so the
                  // node's action bar dims with it.
                  opacity={
                    arming && armedIds.has(id) && id !== arming.id
                      ? 0.35
                      : undefined
                  }
                  onClick={clickable && !isEditing ? handleClick : undefined}
                  onDoubleClick={
                    editable && !isEditing
                      ? (e) => {
                          e.stopPropagation();
                          cancelPendingReveal();
                          const q = getTacticEdit!(position!);
                          if (!q) return;
                          setEditing({
                            id,
                            pos: q.pos,
                            original: q.text,
                            value: q.text,
                          });
                        }
                      : undefined
                  }
                  // Hover drives three things: the action bar, (tactics only)
                  // the editor-side range highlight, and (overview) the mini
                  // chip's full-size peek — the same hoverId serves the bar
                  // and the peek, since a node never has both.
                  onMouseEnter={
                    hasBar || hoverHighlights || isMini
                      ? () => {
                          if (hasBar || isMini) setHoverId(id);
                          if (hoverHighlights) onHoverTactic!(position!);
                        }
                      : undefined
                  }
                  onMouseLeave={
                    hasBar || hoverHighlights || isMini
                      ? () => {
                          if (hasBar || isMini)
                            setHoverId((cur) => (cur === id ? null : cur));
                          if (hoverHighlights) onHoverTactic!(null);
                        }
                      : undefined
                  }
                  style={{
                    cursor: clickable && !isEditing ? "pointer" : "default",
                  }}
                >
                  {/* With a tagged label, the native tooltip retreats to the box
                      rect (padding/border) so it doesn't stack on the hover
                      type-tooltips the interactive text pops itself. */}
                  {!taggedLines && nodeTooltip !== "" && (
                    <title>{nodeTooltip}</title>
                  )}
                  {/* Case badge: the name of the branch this goal IS
                      (`succ`, `pos`, …), sitting at the very top of the band
                      above any comment strip — the source order of a case
                      marker and the comment inside it. Aligned with the
                      comment strip, so an annotated branch reads as one
                      left-aligned column. */}
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
                  {/* Source-comment strip: the node's attributed comment(s),
                      drawn as italic narrative at the very top of the band —
                      above the context label, mirroring source order. Muted
                      and box-less on purpose: authorial voice, not machine
                      output. Left-aligned with the box in compact mode,
                      centered block in wide mode (same convention as the
                      context label). */}
                  {node.data.commentLines.length > 0 && (
                    <text
                      textAnchor="start"
                      fontSize={COMMENT_FONT_PX}
                      fontFamily={getCodeFontFamily()}
                      fontStyle="italic"
                      fill={COMMENT_FILL}
                      // Match the width measurer (no inherited letter-spacing).
                      style={{ letterSpacing: 0 }}
                    >
                      {node.data.commentLines.map((line, j) => (
                        <tspan
                          key={j}
                          // Compact: flush with the box, or hanging off the
                          // incoming lane (indented past the connector
                          // column) when one runs through this band — the
                          // lane passes the strip on its left, unbroken.
                          x={
                            (compact
                              ? -w / 2 +
                                (node.data.parents.length > 0
                                  ? COMMENT_INDENT
                                  : 0)
                              : -node.data.commentW / 2) +
                            line.indent
                          }
                          y={
                            boxTop -
                            topH +
                            node.data.caseH +
                            (j + 0.5) * COMMENT_LINE_H
                          }
                          dy="0.32em"
                        >
                          {line.text}
                        </tspan>
                      ))}
                    </text>
                  )}

                  <rect
                    x={-w / 2}
                    y={boxTop}
                    width={w}
                    height={h}
                    // Tight corners on tactics — they're EDITABLE, and a pill
                    // reads as a label; goals keep slightly softer corners.
                    rx={boxRx}
                    // Stroke priority: the cursor accent, then what the node
                    // IS (a recovered failed/skipped tactic), then what Lean
                    // says about it. The first two are already danger-inked
                    // where they overlap, so the order costs nothing and
                    // keeps "which node am I on" the loudest signal.
                    stroke={
                      accent
                        ? SEQ_STROKE
                        : (recoveredStroke ?? diagInk ?? style.stroke)
                    }
                    strokeWidth={
                      accent || recovered === "failed" || diagSev === 1
                        ? 2
                        : 1.5
                    }
                    // A run marker is a dashed, unfilled chip (an absence, like
                    // the .none elision), not a live green box — and so is a
                    // recovered failed/skipped tactic: the text exists, the
                    // step it claims to be does not.
                    fill={
                      isMarker || recoveredStroke ? "transparent" : style.fill
                    }
                    strokeDasharray={
                      isMarker || recoveredStroke ? "3 3" : undefined
                    }
                    // While the in-place editor overlays this node, its box
                    // (and label, below) hide — the overlay is bigger than
                    // the box, and an accented node would clash through it.
                    visibility={hideForEdit ? "hidden" : undefined}
                  >
                    {isMarker ? (
                      // The marker's own PREVIEW: everything it swallowed,
                      // in full. A ghost's box shows one truncated line, so
                      // this is where the tactic (and any block it opened)
                      // is actually readable without restoring it.
                      <title>
                        {`${
                          node.data.elidedCut!.ghost
                            ? node.data.elidedCut!.note
                              ? "elided into the trunk by a .none flag in the source"
                              : "elided into the trunk"
                            : `${node.data.elidedCut!.tactics.length} tactics elided`
                        } — click to restore\n\n${node.data.elidedCut!.tactics.join("\n")}`}
                      </title>
                    ) : (
                      taggedLines &&
                      nodeTooltip !== "" && <title>{nodeTooltip}</title>
                    )}
                  </rect>

                  {/* Diagnostic ribbon: the box's left edge THICKENED in the
                      worst severity's ink — a cap flush with the border, not a
                      bar floating inside it. It is a full-height rect CLIPPED
                      to the box's own rounded rect, which is what makes the two
                      merge: the cap inherits the corner radius exactly (a path
                      of its own could not, since the radius exceeds the cap's
                      width) and its right edge is the only one that shows, so
                      it reads as one shape with the stroke it sits under.
                      Selected is wider, never a different colour or opacity —
                      hue is already carrying severity, and a dimmed cap stopped
                      looking like part of the border.

                      INSIDE the box on purpose: the left padding (NODE_PAD) is
                      already reserved and no glyph sits there, so a proof lays
                      out identically whether or not it currently elaborates —
                      the one thing an error overlay must not change.

                      The MESSAGE is read by hovering the ribbon: the invisible
                      strip below widens the cap's hit area to the whole left
                      padding and carries the diagnostics as its own <title>.
                      That target has to exist because the node-level tooltip
                      is NOT reachable on a widget node: a tagged label's
                      <title> retreats to the box rect (so it can't stack on
                      the interactive text's own type popups), and the
                      foreignObject label then covers nearly all of the rect —
                      measured in the preview, the message was in the DOM and
                      effectively nowhere on screen. Clicks still bubble to the
                      node's <g>, so folding/revealing through the strip works
                      unchanged. */}
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
                        // The custom popup (see `hoverDiag`), NOT a native
                        // <title>: instant, and styled. Deliberately no dwell —
                        // a 12px strip is not crossed by accident.
                        onMouseEnter={() => setHoverDiag(id)}
                        onMouseLeave={() =>
                          setHoverDiag((cur) => (cur === id ? null : cur))
                        }
                      />
                    </>
                  )}

                  {/* The goal's local context, stacked inside the box above
                      its `⊢ ` line (see HypBlock). Hidden with the rest of the
                      box's content while the in-place editor overlays it. */}
                  {hyps && hyps.length > 0 && !hideForEdit && (
                    <HypBlock
                      lines={hyps}
                      x={-w / 2 + NODE_PAD}
                      y={contentTop}
                      width={w - 2 * NODE_PAD}
                      taggedLines={taggedHyps}
                    />
                  )}

                  {foldable && !seqActive && !revealable && !hideForEdit && !isMarker && (
                    <text
                      x={w / 2 - 8}
                      y={boxTop + 12}
                      textAnchor="middle"
                      fontSize={NODE_FONT_PX}
                      fontFamily={getCodeFontFamily()}
                      fill={style.stroke}
                    >
                      {isCollapsed ? "+" : "−"}
                    </text>
                  )}

                  {taggedLines ? (
                    // HTML overlay in the exact line geometry of the tspans
                    // below: block top at the centered stack's top, one
                    // LINE_H-high box per wrapped line. Line texts equal the
                    // measured plain lines (taggedRender.tsx guarantees it),
                    // so nothing wraps — hence white-space: pre.
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
                            style={{
                              height: LINE_H,
                              // Hanging indent for width-wrapped continuation
                              // lines — same offset the layout budgeted.
                              paddingLeft: lines[j].indent,
                            }}
                          >
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
                      // A run marker's `⋯ N tactics` reads as an absence, so it
                      // takes the muted comment ink, not full node text.
                      fill={isMarker ? "var(--ptw-comment)" : NODE_TEXT}
                      // Match the width measurer in layout.ts, which doesn't include
                      // the page's inherited letter-spacing.
                      style={{ letterSpacing: 0 }}
                      visibility={hideForEdit ? "hidden" : undefined}
                    >
                      {lines.map((line, j) => (
                        <tspan
                          key={j}
                          // Continuation lines hang-indent by the same offset
                          // the layout budgeted for them.
                          x={-w / 2 + NODE_PAD + line.indent}
                          y={labelTop + (j + 0.5) * LINE_H}
                          dy="0.32em"
                        >
                          {line.text}
                        </tspan>
                      ))}
                    </text>
                  )}

                  {/* Frontier chips: a pending goal (no consuming tactic —
                      the live frontier while writing a proof) offers to fill
                      it. `+` opens the editor to type a tactic; `sorry` stubs
                      it in one click, so a branch can be parked and the rest
                      of the proof kept elaborating. Both ghost-styled (dashed,
                      unfilled): the tactic that isn't there yet. They sit just
                      below the box on the compact lane, and are BUTTONS rather
                      than one chip plus a modifier — the lens gesture taught
                      that modifiers on tree nodes silently stop working.

                      A TACTIC node reaches this lane too, in exactly one case:
                      the `calc` of a block that failed to parse (synthetic or
                      not), whose repair chip belongs on the calc itself rather
                      than on the goal above it. */}
                  {(type === "goal" ||
                    node.data.synthetic ||
                    (type === "tactic" && node.data.addLink)) &&
                    (node.data.addSpec || node.data.addLink) &&
                    onAddTactic &&
                    seq.mode === "off" &&
                    // A mini chip reserved no lane (chipH 0), so drawing the
                    // chips would paint them over the next node's band.
                    !isMini &&
                    !isEditing && (
                      <g
                        // Centred on the incoming lane — except when this node
                        // has a visible child, whose connector drops at that
                        // very x: a chip sitting ON the goal→child edge reads
                        // as "insert between these two", and the one gesture
                        // offered there (`step` on a stub-consumed link, the
                        // repair chip on a half-parsed calc) inserts ABOVE the
                        // box instead. Shifted clear of the lane, the edge
                        // runs unbroken and the chip hangs beside it.
                        transform={`translate(${
                          -w / 2 +
                          TRUNK_INSET +
                          (drawnParentIds.has(id) ? CHIP_W_ADD / 2 + 6 : 0)
                        }, ${boxTop + h + CHIP_TOP_GAP})`}
                      >
                        {/* Choosing which relation the new link chains REPLACES
                            the lane, expanding rightward from the chip that was
                            clicked and collapsing back onto it. */}
                        {picking?.id === id ? (
                          <PickerRow
                            options={picking.options}
                            onCancel={() => setPicking(null)}
                            onPick={(o) => {
                              const kind = picking.kind;
                              const spec: AddSpec = { ...picking.spec, rel: o.rel };
                              setPicking(null);
                              // Opening a chain, and repairing a bare `calc`,
                              // both write a link with BOTH ends open and then
                              // walk the author through them. The other two
                              // forms write a link whose LHS is the previous
                              // link's RHS — always `_`, exactly as the source
                              // writes it — so only the right-hand side is
                              // asked for, prefilled `_` since closing the
                              // chain there is the common answer.
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
                              glyph="+"
                              title={
                                node.data.addSpec.kind === "hole"
                                  ? "fill this calc step in place"
                                  : "add a tactic for this goal"
                              }
                              // Centred on the incoming lane; the row runs right
                              // from there, each chip starting past the previous
                              // one's width plus CHIP_GAP.
                              x={-CHIP_W_ADD / 2}
                              width={CHIP_W_ADD}
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
                              x={-CHIP_W_ADD / 2 + CHIP_W_ADD + CHIP_GAP}
                              width={CHIP_W_SORRY}
                              fontSize={9}
                              color={SORRY_FILL}
                              // Straight to the document: a stub has nothing to
                              // type, and the tree redraws off the re-elaboration
                              // with a real `sorry` node in place of this chip.
                              onPick={() => {
                                anchorOn(id); // hold this goal put across the redraw
                                onAddTactic(node.data.addSpec!, "sorry");
                              }}
                            />
                          </>
                        )}
                        {/* Open a chain on a goal that is a relation — the way
                            IN to calc mode, which the tree otherwise had no
                            way to offer (a chain can only be GROWN once one
                            exists). Mutually exclusive with `step` below, so
                            a goal never carries more than three chips. */}
                        {node.data.calcRels && (
                          <FrontierChip
                            glyph="calc"
                            // Says exactly what it writes, which is ONE line.
                            title={
                              node.data.calcRels.length > 1
                                ? `start a calc chain — pick its relation (${node.data.calcRels
                                    .map((o) => o.rel)
                                    .join(" ")}); writes one line, \`calc _ … _ := by sorry\`, then asks for each side`
                                : `start a calc chain — writes \`calc _ ${node.data.calcRels[0].rel} _ := by sorry\`, then asks for each side (Enter keeps \`_\`)`
                            }
                            x={
                              -CHIP_W_ADD / 2 +
                              CHIP_W_ADD +
                              CHIP_GAP +
                              CHIP_W_SORRY +
                              CHIP_GAP
                            }
                            width={CHIP_W_STEP}
                            fontSize={9}
                            color={NODE_STYLES.tactic.stroke}
                            onPick={() => {
                              const options = node.data.calcRels!;
                              const spec = node.data.addSpec!;
                              // One option is no choice: go straight through,
                              // which is exactly the behaviour that predates
                              // the picker (and the CLI/fallback path).
                              if (options.length > 1) {
                                setPicking({ id, kind: "open", spec, options });
                                return;
                              }
                              startChain(id, spec, options[0].rel, options[0].same);
                            }}
                          />
                        )}
                        {/* Grow a `calc` chain, in whichever sense this node
                            allows: insert a link ABOVE an unproved one; APPEND
                            one to the residue a chain that stopped short left
                            behind; or, on a block that never parsed, add the
                            link that hands the parser back its anchor. */}
                        {node.data.addLink && (
                          <FrontierChip
                            glyph="step"
                            title={
                              node.data.addLink.chain?.broken
                                ? node.data.addLink.kind === "calc-first"
                                  ? `write this \`calc\` block's first link, then fill in each side. Until it has one it does not parse, which is why the rest of this proof is missing`
                                  : `finish the \`calc\` block: add its next ${node.data.addLink.rel} link. Until then it does not parse, which is why the rest of this proof is missing`
                                : node.data.addLink.kind === "calc-append"
                                  ? (node.data.addLink.rels?.length ?? 0) > 1
                                    ? `add the next link to this chain — pick its relation (${node.data.addLink.rels!
                                        .map((o) => o.rel)
                                        .join(" ")}); \`${node.data.addLink.rel}\` closes the chain, anything else adds a step and leaves it open`
                                    : `close this chain with a \`${node.data.addLink.rel}\` link — type its right-hand side, or take the \`_\` to end it here`
                                  : "add a calc step above this link — the new link appears above this box, and this one closes the remainder; type its right-hand side"
                            }
                            // Alone on the lane when the block is broken: the
                            // other two chips are suppressed there, since they
                            // would insert above a block that stays unparsed.
                            x={
                              node.data.addSpec
                                ? -CHIP_W_ADD / 2 +
                                  CHIP_W_ADD +
                                  CHIP_GAP +
                                  CHIP_W_SORRY +
                                  CHIP_GAP
                                : -CHIP_W_ADD / 2
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
                              // Repairing a bare `calc` writes a link with both
                              // ends open and walks the author through them;
                              // the other two write a link whose LHS is the
                              // previous RHS (`_`, as the source writes it), so
                              // only the right-hand side is asked for —
                              // prefilled `_`, which closes the chain, so Enter
                              // alone is still the whole gesture.
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


                  {/* Gallery pager: this node branches, but only one branch is
                      showing. Sits in the gap above the children, just RIGHT
                      of the descending lane so it annotates the connector
                      rather than covering it. */}
                  {splits.has(id) && !isEditing && seq.mode === "off" && (
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

                  {/* Hover action bar (last, so it paints over the label):
                      secondary actions with real button targets. Goals get
                      theirs straddling the top-right corner; a tactic's rides
                      the box's right edge instead — a tactic box is one line
                      tall and the compact gap above it (TRUNK_GAP_STEP) is
                      shorter than the bar, so the corner placement would
                      collide with the goal box above. */}
                  {hasBar && (hoverId === id || isArming) && (
                    <NodeActionBar
                      placement={type === "tactic" ? "right" : "top-right"}
                      // Both placements OVERLAP the box by BAR_OVERLAP. That
                      // is not cosmetic: the bar lives in the node's own <g>
                      // and hover is tracked on that <g>, so any gap between
                      // box and bar is dead space that fires mouseleave and
                      // unmounts the bar mid-travel — the pointer can never
                      // land on it. Overlapping keeps the hit area continuous.
                      // A tactic's overlap falls inside NODE_PAD, so it covers
                      // padding rather than glyphs.
                      x={w / 2 - BAR_OVERLAP}
                      y={type === "tactic" ? boxTop + h / 2 : boxTop}
                      actions={[
                        // FIRST in the bar: the reading gesture, and the one
                        // reached most often while working down a proof. The
                        // bar is entered from the box, so the first slot is
                        // both the nearest and the safest — the mirror of
                        // ⊘ being last.
                        ...(elidable
                          ? [
                              {
                                // NOT `⋯`, which is the rail's BRIEF mode: the
                                // two are different elisions (one cuts nodes
                                // out of the tree, the other shortens a label)
                                // and sharing a glyph made them genuinely hard
                                // to tell apart. `◌` is the dashed ghost this
                                // one leaves behind.
                                glyph: "◌",
                                title:
                                  "Elide into the trunk — this tactic and anything it opened, leaving a ghost to click back open",
                                onClick: () =>
                                  setElideCuts((cs) => [
                                    ...cs,
                                    { kind: "step" as const, id },
                                  ]),
                              },
                            ]
                          : []),
                        ...(goalRevealable
                          ? [
                              {
                                glyph: "»",
                                title: `Reveal in source (${CMD}-click)`,
                                onClick: () => onReveal!(position!),
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
                        ...(popoutable
                          ? [
                              {
                                glyph: "⧉",
                                // The tight range when we have one; the node's
                                // own trivia-inflated span otherwise, which
                                // selects a little extra but always opens.
                                title: "Open in lens",
                                onClick: () =>
                                  onPopoutEdit!(
                                    getTacticEdit?.(position!)?.pos ?? position!,
                                  ),
                              },
                            ]
                          : []),
                        // Last in the bar, and the only DESTRUCTIVE action, so
                        // it is the furthest from where the pointer arrives.
                        // One click only arms it (see `arming`).
                        ...(deletable && !isArming
                          ? [
                              {
                                glyph: "⊘",
                                danger: true,
                                title:
                                  type === "goal"
                                    ? "Delete this goal's proof"
                                    : "Delete this tactic",
                                onClick: () =>
                                  setArming({
                                    id,
                                    spec: node.data.deleteSpec!,
                                  }),
                              },
                            ]
                          : []),
                      ]}
                    />
                  )}

                  {/* The ARMED confirm row, in the chip lane's own place under
                      the box — the picker-row idiom, and the same reason: it
                      stays inside the SVG with no portal and no focus to
                      manage. The count is what the user is actually deciding
                      about, so the chip says it. */}
                </g>
              );
            })}

            {/* In-place tactic editor: a textarea over the edited node's box,
                pre-filled with the tactic's verbatim source (getTacticEdit).
                Esc cancels; Enter commits single-line tactics (Shift+Enter
                for a newline); ⌘/Ctrl-Enter always commits; so does clicking
                away. Rendered AFTER the nodes loop on purpose: SVG paints in
                document order, so inside the node's own <g> every later
                sibling would paint over the overlay wherever it outgrows the
                box. It widens to its content live (from the measured longest
                line) but its HEIGHT is fixed, and neither pushes the layout
                around — it's a transient overlay, not a node. */}
            {/* The ARMED confirm row. Rendered AFTER the nodes loop for the
                same reason the editor overlay is: it hangs BELOW the box, in
                the chip lane's place, and nothing reserves that space for it
                (`chipH` is only budgeted where an add/link chip lives). Inside
                the node's own <g> every later sibling would paint over it —
                out here it paints over everything, which for a transient
                confirmation is right. The picker-row idiom otherwise: SVG
                chips, no portal, no focus to manage. */}
            {arming &&
              (() => {
                const an = nodes.find((n) => n.data.id === arming.id);
                const ext = armExtent;
                if (!an || !ext) return null;
                const { w, h } = an.data;
                const boxTop = (an.data.caseH + an.data.commentBlockH - h) / 2;
                // No glyph on the confirm chip: the `⊘` said "you may delete
                // here", and once armed that is settled — what is left to read
                // is the COUNT, and repeating the symbol beside it only
                // competes with the number for the eye.
                const label = ext.empties
                  ? `replace ${ext.lines} with sorry`
                  : `delete ${ext.lines} line${ext.lines === 1 ? "" : "s"}`;
                const wide = measureText(label, CHIP_FONT_PX) + 2 * CHIP_PAD_X;
                return (
                  <g
                    transform={`translate(${an.x - w / 2 + TRUNK_INSET}, ${
                      an.y + boxTop + h + CHIP_TOP_GAP
                    })`}
                  >
                    <FrontierChip
                      glyph={label}
                      title={`Confirm — ${CMD}Z in the editor undoes it`}
                      x={-CHIP_W_ADD / 2}
                      width={wide}
                      color={DANGER_FILL}
                      fontSize={CHIP_FONT_PX}
                      fontFamily={getCodeFontFamily()}
                      // Pinning the node being removed: the compact layout
                      // walks one y-cursor in DFS order, so everything above
                      // the edit is literally unmoved, and once the node
                      // itself is gone the anchor falls through to the
                      // nearest surviving ancestor.
                      onPick={() => commitDelete(arming.id, arming.spec)}
                    />
                    <FrontierChip
                      glyph="×"
                      title="Cancel"
                      x={-CHIP_W_ADD / 2 + wide + CHIP_GAP}
                      width={CHIP_W_ADD}
                      color="var(--ptw-comment)"
                      fontFamily={getCodeFontFamily()}
                      onPick={() => setArming(null)}
                    />
                  </g>
                );
              })()}

            {/* The diagnostic popup (see `hoverDiag`): what the ribbon strip
                shows INSTANTLY on hover, instead of a native <title> with the
                OS's own delay and take-it-or-leave-it styling. After the nodes
                loop like the editor overlay, and for the same reason — it
                hangs off the box with nothing reserving room for it, so inside
                the node's own <g> every later sibling would paint over it.
                pointer-events: none throughout, so it can never trap the hover
                that keeps it up or eat a click meant for what is under it. */}
            {/* Overview peek: hovering a mini chip draws the node at FULL size
                on top of everything — paint only, so pointing at chips never
                relayouts (the no-relayout-on-hover rule; the geometry version
                of this hover would make the tree squirm under the pointer).
                After the nodes loop so it paints over neighbours, and
                pointer-events: none so it can never trap the hover that keeps
                it up. Content is measured fresh from the PRE-ENGINE node
                (`treeNodes`) — the engine replaced the node's label/hyps with
                the chip's, so the full text has to come from upstream. Plain
                text, no tagged/token rendering: a peek is for reading, and an
                interactive surface that cannot take the pointer would be a
                lie. */}
            {overview &&
              hoverId &&
              (() => {
                const pn = nodes.find((n) => n.data.id === hoverId);
                if (!pn || !pn.data.mini) return null;
                const base = treeNodes.find((n) => n.id === hoverId);
                if (!base) return null;
                const full = measureNode(base.label, base.hyps);
                const fullHyps = full.hyps ?? [];
                const style = NODE_STYLES[base.type] ?? NODE_STYLES.default;
                // Anchor the peek's top-left on the chip's top-left, so the
                // expansion grows right/down from what was pointed at.
                const left = -pn.data.w / 2;
                const topH = pn.data.caseH + pn.data.commentBlockH;
                const boxTop = (topH - pn.data.h) / 2;
                const gutter =
                  fullHyps.some((l) => l.used) &&
                  !fullHyps.every((l) => l.used)
                    ? HYP_MARK_W
                    : 0;
                const contentTop = boxTop + NODE_PAD_Y;
                const sepOff = (j: number) =>
                  fullHyps.slice(0, j + 1).some((h) => h.sep) ? HYP_SEP_H : 0;
                return (
                  <g
                    transform={`translate(${pn.x},${pn.y})`}
                    pointerEvents="none"
                  >
                    <rect
                      x={left}
                      y={boxTop}
                      width={full.w}
                      height={full.h}
                      rx={base.type === "tactic" ? 4 : 6}
                      fill={style.fill}
                      stroke={style.stroke}
                      strokeWidth={1.5}
                      // A soft shadow is what reads as "floating over", and
                      // the overlap with neighbouring chips needs it.
                      filter="drop-shadow(0 2px 6px rgba(0,0,0,0.35))"
                    />
                    {fullHyps.length > 0 && (
                      <text
                        textAnchor="start"
                        fontSize={HYP_FONT_PX}
                        fontFamily={getCodeFontFamily()}
                        fill={NODE_TEXT}
                        style={{ letterSpacing: 0 }}
                      >
                        {fullHyps.map((l, j) => (
                          <tspan
                            key={j}
                            x={left + NODE_PAD + gutter + (l.indent ?? 0)}
                            y={
                              contentTop +
                              (j + 0.5) * HYP_LINE_H +
                              sepOff(j)
                            }
                            dy="0.32em"
                            opacity={l.used ? 1 : 0.62}
                          >
                            {l.text}
                          </tspan>
                        ))}
                      </text>
                    )}
                    <text
                      textAnchor="start"
                      fontSize={NODE_FONT_PX}
                      fontFamily={getCodeFontFamily()}
                      fill={NODE_TEXT}
                      style={{ letterSpacing: 0 }}
                    >
                      {full.lines.map((line, j) => (
                        <tspan
                          key={j}
                          x={left + NODE_PAD + line.indent}
                          y={
                            contentTop + full.hypH + (j + 0.5) * LINE_H
                          }
                          dy="0.32em"
                        >
                          {line.text}
                        </tspan>
                      ))}
                    </text>
                  </g>
                );
              })()}
            {hoverDiag &&
              (() => {
                const dn = nodes.find((n) => n.data.id === hoverDiag);
                const list = diag?.byNode.get(hoverDiag);
                if (!dn || !list || list.length === 0) return null;
                const { w, h } = dn.data;
                const boxTop = (dn.data.caseH + dn.data.commentBlockH - h) / 2;
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
                        width: "max-content",
                        maxWidth: 460,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        padding: "6px 9px",
                        borderRadius: 3,
                        background:
                          "var(--vscode-editorWidget-background, rgba(255,255,255,0.97))",
                        borderWidth: 1,
                        borderStyle: "solid",
                        borderColor:
                          list[0].severity === 1 ? DANGER_FILL : WARN_FILL,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                      }}
                    >
                      {list.map((d) => (
                        <div
                          key={d.key}
                          style={{ display: "flex", gap: 7, alignItems: "baseline" }}
                        >
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontSize: 15,
                              lineHeight: "15px",
                              color: d.severity === 1 ? DANGER_FILL : WARN_FILL,
                            }}
                          >
                            {d.severity === 1 ? "⨯" : "⚠"}
                          </span>
                          <span
                            style={{
                              fontFamily: getCodeFontFamily(),
                              fontSize: 11,
                              lineHeight: "15px",
                              whiteSpace: "pre-wrap",
                              // The PILL's exact pair (background above, ink
                              // here), never a --ptw-* fallback: those follow
                              // the page theme while the background's fallback
                              // is light, which is the recorded light-on-light
                              // trap from the completion list.
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
                const en = nodes.find((n) => n.data.id === editing.id);
                if (!en) return null;
                const { w, h } = en.data;
                const topH = en.data.caseH + en.data.commentBlockH;
                const boxTop = (topH - h) / 2;
                // An ADD's textarea hangs below the goal box (where its chip
                // sat), leaving the goal readable while you answer it — as does
                // a staged `calc` fill, which is asking about the link it just
                // wrote under that goal. A replace-edit covers the hidden box.
                const overlayY =
                  editing.add || editing.calcStage ? boxTop + h + 4 : boxTop;
                const valueLines = editing.value.split("\n");
                const fw = Math.max(
                  w,
                  320,
                  ...valueLines.map(
                    (l) => measureText(l, NODE_FONT_PX) + 2 * NODE_PAD + 12,
                  ),
                );
                // Height is fixed at OPEN time, from the text the editor
                // started with — never from `value`. Growing a line at a time
                // as you type reflows nothing around it (the overlay is
                // transient; the layout stays put) but reads as the tree
                // shifting under you. Measured the same way a tactic box is,
                // so a single-line edit covers its box exactly; an add is one
                // line, since the goal box it hangs under can be many and an
                // empty textarea that tall is all void. Type past the bottom
                // and the textarea scrolls (overflowY below).
                const openLines =
                  editing.add || editing.calcStage
                    ? 1
                    : editing.original.split("\n").length;
                const fh = openLines * LINE_H + 2 * NODE_PAD_Y;
                // Syntax colouring WHILE editing: a mirror element behind a
                // see-through textarea, which is the only way to paint rich
                // text under a real caret. The colours are the SAVED source's
                // tokens realigned onto the draft — `renderTaggedTactic` already
                // tolerates its label and the source disagreeing (that is what
                // `alignInLabel` is for, since `tacticString` is a display
                // string), so a draft is just another such string and needs no
                // new alignment machinery. Typing at the end and deleting from
                // the end both align exactly; a mid-string edit keeps colour up
                // to the edit point and loses it after.
                //
                // Skipped for ADD and STAGE overlays: an add hangs off a GOAL
                // node, whose `position` is its PRODUCER's range, so the tokens
                // would be a different tactic's entirely; a stage is typing one
                // END of a link rather than a tactic, so the tokens would be
                // the whole link's.
                const editHighlight =
                  !editing.add && !editing.calcStage && en.data.position
                    ? (renderTaggedTactic?.(
                        en.data.position,
                        editing.value,
                        valueLines,
                      ) ?? null)
                    : null;
                return (
                  <g transform={`translate(${en.x},${en.y})`}>
                    <foreignObject
                      x={-w / 2}
                      y={overlayY}
                      width={fw}
                      height={fh}
                      style={{ overflow: "visible" }}
                    >
                      {/* Positioning context for the completion list, which
                          hangs BELOW the box and so must escape it — the
                          foreignObject already allows that (overflow: visible)
                          and the overlay paints after every node. */}
                      <div
                        data-ptw-edit=""
                        // Clicks inside the editor are not background clicks:
                        // the scroll container's handler now closes a staged
                        // fill (its blur deliberately doesn't), and without
                        // this a click INTO the stage's own textarea would
                        // bubble there and self-close it.
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: "relative",
                          width: "100%",
                          height: "100%",
                        }}
                      >
                      {/* The mirror: the same text, same metrics, coloured —
                          painted BEHIND a textarea whose glyphs are transparent
                          but whose caret and selection are the real thing. It
                          is inert (pointer-events: none, aria-hidden): the
                          textarea above owns every gesture, and the token
                          hover popups must not fight the caret. Its border is
                          transparent so the content boxes coincide with the
                          textarea's real 2px one. */}
                      {editHighlight && (
                        <div
                          data-ptw-mirror=""
                          aria-hidden
                          style={{
                            ...editOverlayLayer(0),
                            // Behind the textarea, so it carries the fill and
                            // the glyphs; the textarea above goes transparent.
                            borderRadius: 4,
                            background: EDIT_BG,
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
                        // Keyed by STAGE, not by node: moving from the left
                        // side to the right side must remount, or `autoFocus`
                        // never fires again (React keeps the same element for
                        // the same position in the tree) and the caret stays
                        // wherever the previous stage left it. Deliberately NOT
                        // keyed on `editing.id`, which the mid-gesture
                        // re-anchor rewrites — remounting there would throw
                        // away what had been typed.
                        key={editing.calcStage?.stage ?? "edit"}
                        autoFocus
                        value={editing.value}
                        spellCheck={false}
                        // Keep the mirror's scroll locked to ours: the box is
                        // fixed-height, so a long draft scrolls. Found by DOM
                        // walk rather than a ref — `react-hooks/refs` forbids
                        // reading a component-level ref inside a function called
                        // from JSX, and it taints every other ref-touching call
                        // in the same handler (`commitEdit` included).
                        onScroll={(e) => {
                          const m = e.currentTarget.parentElement?.querySelector(
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
                          refreshCompletion(editing.id, value, selectionStart);
                          syncAbbrev(editKey(editing)!, value, selectionStart);
                        }}
                        // A caret move with no edit changes what is being
                        // completed too (clicking into the middle of a word).
                        onSelect={(e) => {
                          const ta = e.currentTarget;
                          if (completion)
                            refreshCompletion(
                              editing.id,
                              ta.value,
                              ta.selectionStart,
                            );
                          // A caret that LEAVES a pending abbreviation replaces
                          // it — the buffer's own rule. `sync` is idempotent, so
                          // it does not matter that this also fires after every
                          // keystroke's onChange.
                          syncAbbrev(editKey(editing)!, ta.value, ta.selectionStart);
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          // A click MOVES the caret, which may take it out of a
                          // pending abbreviation. `onSelect` is React's own
                          // synthesised event and is not reliably delivered
                          // (the headless harness never fired it at all), so
                          // the two plain DOM events that definitely follow a
                          // caret move drive this as well — `sync` is
                          // idempotent, so the overlap costs nothing.
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
                            // No preventDefault: let the native clipboard run,
                            // and only stand in for it if it didn't (see
                            // clipboardFallback).
                            nativeClip.current = false;
                            window.setTimeout(() => {
                              if (!nativeClip.current)
                                void clipboardFallback(k, ta, editing);
                            }, 0);
                            return;
                          }
                          // Tab expands a pending abbreviation, and takes
                          // priority over the completion list's own Tab: that
                          // is what Tab means in the buffer, and the two can
                          // hardly collide (nothing this completes contains a
                          // leader). Falls through when nothing is pending.
                          if (e.key === "Tab" && !mod) {
                            if (abbrevSess?.session.expand()) {
                              e.preventDefault();
                              putSpans([]);
                              return;
                            }
                          }
                          // The completion list owns these keys while it is
                          // open, and only then — `⌘/Ctrl-Enter` is checked
                          // FIRST so "always commits" stays true even with a
                          // selection showing, and Escape falls through to
                          // cancelling the edit only on a SECOND press.
                          if (completion && !mod) {
                            const n = completion.items.length;
                            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
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
                              // Accepting an item you have already typed in full
                              // changes nothing, so Enter there means COMMIT —
                              // otherwise finishing a tactic name exactly would
                              // cost two Enters, one to "accept" a no-op and one
                              // to commit. Tab still just closes the list.
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
                        // Blur commits a replace/add — click away means "done".
                        // A STAGED calc fill is the exception, and it is the
                        // fix for a reported bug: the real infoview reflows
                        // (and moves focus) the moment the insertion's own
                        // re-elaboration lands, and blur-as-commit then walked
                        // BOTH stages to `_` before the author ever saw them —
                        // "there is no option to enter the LHS". A stage is a
                        // walk, not a click-away editor: blur leaves it open
                        // and untouched; Escape and a background click are the
                        // deliberate ways out. (The preview harness fires no
                        // native focus transitions — the recorded gap — which
                        // is exactly why this survived verification.)
                        onBlur={() => {
                          if (editingRef.current?.calcStage) return;
                          commitEdit();
                        }}
                        style={{
                          width: "100%",
                          height: "100%",
                          boxSizing: "border-box",
                          fontFamily: getCodeFontFamily(),
                          fontSize: NODE_FONT_PX,
                          lineHeight: `${LINE_H}px`,
                          letterSpacing: 0,
                          padding: `${NODE_PAD_Y - 1}px ${NODE_PAD - 2}px`,
                          // With a mirror behind, the glyphs come from IT and
                          // this element contributes only the caret, the
                          // selection and the border. Without one, every style
                          // is exactly as before — so a failure to align tokens
                          // degrades to today's plain editor rather than to an
                          // invisible one.
                          position: "relative",
                          zIndex: 1,
                          background: editHighlight ? "transparent" : EDIT_BG,
                          color: editHighlight ? "transparent" : EDIT_TEXT,
                          caretColor: EDIT_TEXT,
                          border: `2px solid ${NODE_STYLES.tactic.stroke}`,
                          borderRadius: 4, // match the tactic box corners
                          outline: "none",
                          resize: "none",
                          whiteSpace: "pre",
                          overflowX: "hidden",
                          // Fixed height, so text typed past the bottom must
                          // stay reachable. `auto` keeps the (overlay)
                          // scrollbar out of sight until there is overflow.
                          overflowY: "auto",
                          // Opt back in: the scroll container sets
                          // userSelect: none for the diagram, which would
                          // otherwise make the textarea unselectable.
                          userSelect: "text",
                        }}
                      />
                      {abbrevSpans.length > 0 && (
                        // The pending-abbreviation underline: the same text at
                        // the same metrics, painted in TRANSPARENT ink so only
                        // the underline shows. It sits ABOVE the textarea
                        // rather than below, because without a mirror the
                        // textarea's own background is opaque and would hide
                        // it; it draws nothing but thin rules, so the glyphs
                        // and the caret read straight through.
                        <div
                          aria-hidden
                          style={{
                            ...editOverlayLayer(2),
                            // Ink invisible: this layer contributes underlines
                            // and nothing else.
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
                          // mousedown, NOT click, and preventDefault: the
                          // textarea's onBlur COMMITS the edit, so letting the
                          // press move focus would commit and unmount the
                          // editor out from under the item being clicked.
                          onMouseDown={(e) => e.preventDefault()}
                          style={{
                            position: "absolute",
                            top: fh + 2,
                            left: 0,
                            minWidth: Math.min(fw, 240),
                            maxWidth: 520,
                            maxHeight: 168,
                            overflowY: "auto",
                            zIndex: 2,
                            // The editor overlay's OWN palette, not the
                            // `--vscode-editorWidget-*` chrome the rail uses:
                            // those carry light fallbacks for the standalone
                            // app, and pairing them with theme-following text
                            // gave light-on-light on the selected row in a dark
                            // theme — the same "fix one half and get the mirror
                            // bug" trap that ties the node fills to the token
                            // palette.
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
                                  // No ref: walk to the overlay wrapper and
                                  // take its textarea. The mousedown above
                                  // already kept focus there.
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
                                // Accent + accent-text are a designed pair, so
                                // the selected row contrasts in either theme.
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
    </div>
  );
}

// All controls live on ONE floating rail of icon buttons pinned to the view's
// top-right; the top edge stays empty so the eye falls from the infoview's
// expected-type block straight onto the tree (see the render). Icons over
// text — the tooltips carry the words — and toggles render "pressed" while
// on. Zoom lives here too (no % readout; ⌘/Ctrl-scroll is the precise path).
// Styled on the EDITOR's own widget palette (the vars every VS Code theme
// defines for hover/find widgets) so the rail reads native in either theme;
// the fallbacks keep the standalone app on the old light look.
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
  // Longhands, not the `border` shorthand: the pressed variant overrides
  // borderColor alone, and React warns (correctly) that mixing shorthand with
  // longhand for the same value across re-renders can leave stale styling.
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--vscode-editorWidget-border, #cbd5e0)",
  borderRadius: 3,
  color: "var(--vscode-icon-foreground, #2d3748)",
};

/**
 * Rich label lines for a COMBINED node (the ⇉ toggle's merged tactic run).
 *
 * A combined node's label is its constituent tactics joined by newlines, so it
 * has no single source range and the normal one-tactic path can't colour it.
 * Instead each part renders its OWN drawn lines against its OWN tactic, and the
 * results concatenate — so a merged run keeps per-token colour and hover popups
 * exactly as the separate nodes had them.
 *
 * The mapping is by `WrappedLine.seg` (the explicit-newline segment a line was
 * wrapped out of). A part's label may itself contain newlines, so parts own
 * segment RANGES: part i covers `[segStart, segStart + lineCount)`.
 *
 * All-or-nothing: if any part fails to align (or lacks a position), the whole
 * node falls back to plain text, so a combined box is never half-coloured.
 */
function renderCombinedLines(
  parts: CombinedPart[] | undefined,
  lines: WrappedLine[],
  render: ProofTreeViewProps["renderTaggedTactic"],
): ReactNode[] | null {
  if (!parts || parts.length === 0 || !render) return null;
  const out: ReactNode[] = [];
  let seg = 0;
  for (const part of parts) {
    const span = part.label.split("\n").length;
    const mine = lines.filter((l) => l.seg >= seg && l.seg < seg + span);
    seg += span;
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

/** Small square button for the diagnostic pill's pager. Not `RailButton`: that
one is 26px and carries the rail's own chrome, which inside a pill reads as a
second widget rather than as part of this one. */
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

/**
 * The proof's diagnostics, as one status line with a pager.
 *
 * TOP-left, stacked under the caller's slot and any picking hint (`top` is
 * computed at the call site). It started bottom-left, where a status bar
 * belongs, and that was wrong HERE for a reason specific to the host: the
 * widget's frame is `height: 100vh` while its root sits a little way down the
 * infoview's own document, so the frame ends that far BELOW the fold and
 * anything anchored to its bottom edge is never on screen. Top is the only
 * edge of this frame guaranteed visible.
 *
 * It shows ONE diagnostic at a time rather than a list, since the tree itself
 * is the list: every one of them is already ribboned on its own node, and what
 * this adds is a way to walk them and a place to read the full message.
 *
 * `‹`/`›` step and navigate together — stepping to a diagnostic you then have
 * to go and find would be half a feature. Clicking the message goes to the
 * current one on BOTH surfaces: the tree (unfold, page, scroll) and, in the
 * widget, the SOURCE — the editor's cursor lands on the error through the same
 * reveal a node click uses. The reveal half is also what gives a diagnostic
 * with no drawn node (Lean reports plenty at the enclosing block) a working
 * click; only in the standalone app, which has no editor, does such a one
 * truly have nowhere to go — said with the cursor, not by disappearing.
 */
function DiagnosticPill({
  index,
  count,
  diag,
  clickable,
  top,
  onStep,
  onGo,
}: {
  index: number;
  count: number;
  diag: TreeDiagnostic;
  clickable: boolean;
  top: number;
  onStep: (d: number) => void;
  onGo: () => void;
}) {
  const err = diag.severity === 1;
  const ink = err ? DANGER_FILL : WARN_FILL;
  return (
    <div
      // A click here must not reach the background handler, which dismisses
      // the cursor accent and every armed/picking row.
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: 8,
        top,
        zIndex: 10,
        // Clear of the rail at top-right, which is 26px of button plus its 8px
        // inset.
        maxWidth: "calc(100% - 60px)",
        display: "flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "monospace",
        fontSize: 11,
        padding: "3px 7px",
        borderRadius: 3,
        background:
          "var(--vscode-editorWidget-background, rgba(255,255,255,0.92))",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: ink,
        color: "var(--vscode-icon-foreground, #2d3748)",
      }}
    >
      <span style={{ color: ink }}>{err ? "⨯" : "⚠"}</span>
      {count > 1 && (
        <>
          <button
            type="button"
            style={PILL_BTN}
            title="Previous problem"
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
            title="Next problem"
            onClick={() => onStep(1)}
          >
            ›
          </button>
        </>
      )}
      <span
        onClick={onGo}
        title={diag.message}
        style={{
          // The first line is the headline of a Lean message; the rest is the
          // goal state, which is what the tooltip (and the node's own box) is
          // for. Truncation is CSS, so the width is the viewport's rather than
          // a guessed character count.
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

function RailButton({
  glyph,
  title,
  onClick,
  pressed,
  pressedColor,
  disabled,
}: {
  glyph: string;
  title: string;
  onClick: () => void;
  pressed?: boolean;
  pressedColor?: string;
  disabled?: boolean;
}) {
  const color = pressedColor ?? RAIL_PRESSED;
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={
        disabled
          ? { ...RAIL_BTN, opacity: 0.35, cursor: "default" }
          : pressed
            ? {
                ...RAIL_BTN,
                background: color,
                borderColor: color,
                color: ACCENT_TEXT,
              }
            : RAIL_BTN
      }
    >
      {glyph}
    </button>
  );
}

/** The ¶ control: a rail button that EXPANDS into a width slider, because the
right wrap column is a judgement about this proof in this viewport and not
something a two-stop cycle can guess. The unit is COLUMNS (characters), which
is the unit the wrap budget is actually defined in (`REFLOW_*_CHARS` — the
slider hands over the very number `budgetFor` multiplies by the character
width), so the readout is the setting rather than a label for it.

The panel opens to the LEFT: the rail is pinned to the viewport's right edge,
so anything hanging off the other side would be off screen. It is dismissed
like every other transient surface here (its own button, a background click,
Escape), and the top notch of the slider is OFF, so one gesture covers the
whole range including leaving the mode. */
function ReflowControl({
  reflow,
  forced,
  onChange,
  open,
  onOpenChange,
}: {
  reflow: ReflowMode;
  // The budget the LAYOUT is imposing while `reflow` is off (aligned tracks —
  // see forcedReflow). The control reports the effective state, not the
  // setting: with the tree visibly wrapped, an unpressed ¶ reading "off" is
  // simply wrong.
  forced?: number;
  onChange: (v: ReflowMode) => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const effective = forced ?? reflow;
  // The thumb sits on the forced column too, and the OFF notch is dropped
  // while forcing — a notch that silently does nothing is the same lie from
  // the other end. Sliding away from it sets an explicit budget as usual.
  const cols = forced ?? reflowToStop(reflow);
  const maxStop = forced ? REFLOW_MAX_CHARS : REFLOW_OFF_STOP;
  return (
    <div style={{ position: "relative", display: "flex" }}>
      <RailButton
        glyph="¶"
        title={
          forced
            ? `Reflow at ${forced} columns, required by the ∥ aligned-tracks layout (a shared tactic column needs bounded goal boxes) — click for the width slider to change it`
            : reflow === "off"
              ? "Reflow: wrap labels at a narrower column so branches fit side by side — click for the width slider"
              : `Reflow at ${reflow} columns: labels (and context lines) wrapped there, breaking at commas, connectives, := and tactic keywords — click for the width slider`
        }
        pressed={effective !== "off"}
        // Opening also ENGAGES the mode, so one click still gets you reflow
        // exactly as the old cycling button did — the slider is then already
        // open to tune it. Closing never changes the setting.
        onClick={() => {
          if (!open && reflow === "off" && !forced) onChange(REFLOW_CHARS);
          onOpenChange(!open);
        }}
      />
      {open && (
        <div
          style={{
            position: "absolute",
            right: "100%",
            marginRight: 4,
            top: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 10px",
            height: RAIL_BTN.height,
            boxSizing: "border-box",
            background: "var(--vscode-editorWidget-background, #fff)",
            border: "1px solid var(--vscode-editorWidget-border, #cbd5e0)",
            borderRadius: 3,
            color: "var(--vscode-icon-foreground, #2d3748)",
            fontSize: 11,
            whiteSpace: "nowrap",
          }}
        >
          <input
            type="range"
            min={REFLOW_MIN_CHARS}
            max={maxStop}
            step={1}
            value={cols}
            // Every step re-measures every box, which is the same work the old
            // toggle did once — see the timing note in CLAUDE.md for why a
            // drag can afford it per step.
            onChange={(e) => onChange(stopToReflow(Number(e.target.value)))}
            style={{
              width: 116,
              // Follows the theme like everything else drawn here; the range
              // input's own chrome is otherwise the UA's blue.
              accentColor: "var(--ptw-accent)",
            }}
          />
          <span
            style={{
              // The readout is the one number the control is about, so it gets
              // fixed width — otherwise the slider shifts under the pointer as
              // the digits change.
              width: 46,
              textAlign: "right",
              fontFamily: "monospace",
              // Dimmed means "not a setting of yours" — off, or a column the
              // layout is imposing.
              opacity: effective === "off" || forced ? 0.6 : 1,
            }}
          >
            {effective === "off" ? "off" : `${effective} col`}
          </span>
        </div>
      )}
    </div>
  );
}

function ControlRail({
  onExpandAll,
  onCollapseAll,
  accordion,
  onAccordionChange,
  onUndo,
  layout,
  onLayoutChange,
  sideBySide,
  onSideBySideChange,
  gallery,
  onGalleryChange,
  reflow,
  forcedReflow,
  onReflowChange,
  reflowOpen,
  onReflowOpenChange,
  brief,
  onBriefChange,
  overview,
  onOverviewChange,
  combine,
  onCombineChange,
  hypMode,
  onHypModeChange,
  seqActive,
  onToggleSequence,
  elidePicking,
  onToggleElide,
  bandEnabled,
  bandPicking,
  onToggleBand,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  onExpandAll: () => void;
  onCollapseAll: () => void;
  accordion: boolean;
  onAccordionChange: (v: boolean) => void;
  onUndo?: (redo: boolean) => void;
  layout: LayoutMode;
  onLayoutChange: (v: LayoutMode) => void;
  sideBySide: boolean;
  onSideBySideChange: (v: boolean) => void;
  gallery: boolean;
  onGalleryChange: (v: boolean) => void;
  reflow: ReflowMode;
  forcedReflow?: number;
  onReflowChange: (v: ReflowMode) => void;
  reflowOpen: boolean;
  onReflowOpenChange: (v: boolean) => void;
  brief: boolean;
  onBriefChange: (v: boolean) => void;
  overview: boolean;
  onOverviewChange: (v: boolean) => void;
  combine: boolean;
  onCombineChange: (v: boolean) => void;
  hypMode: HypMode;
  onHypModeChange: (v: HypMode) => void;
  seqActive: boolean;
  onToggleSequence: () => void;
  elidePicking: boolean;
  onToggleElide: () => void;
  bandEnabled: boolean;
  bandPicking: boolean;
  onToggleBand: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {/* Document actions, divided off from the view controls below: these
          change the FILE, everything else changes only how it is drawn. They
          exist because the tree's own edits leave focus in the webview, where
          the editor's ⌘Z never arrives. */}
      {onUndo && (
        <>
          <RailButton
            glyph="↶"
            title={`Undo in the editor (${CMD}Z) — focus moves to the editor, so further undos are native`}
            onClick={() => onUndo(false)}
          />
          <RailButton
            glyph="↷"
            title={`Redo in the editor (${CMD}⇧Z)`}
            onClick={() => onUndo(true)}
          />
          <div style={{ height: 6 }} />
        </>
      )}
      <RailButton glyph="⊞" title="Expand all" onClick={onExpandAll} />
      <RailButton glyph="⊟" title="Collapse all" onClick={onCollapseAll} />
      <div style={{ height: 6 }} />
      <RailButton
        glyph="⇅"
        title="Accordion: expanding a node collapses its sibling branches"
        pressed={accordion}
        onClick={() => onAccordionChange(!accordion)}
      />
      {/* Three layouts on one button (see LAYOUT_MODES): the glyph shows the
          CURRENT mode, pressed means "not the stacked home". */}
      <RailButton
        glyph={LAYOUT_MODES[layout].glyph}
        title={LAYOUT_MODES[layout].title}
        pressed={layout !== "stacked"}
        onClick={() => onLayoutChange(LAYOUT_MODES[layout].next)}
      />
      <RailButton
        glyph="◫"
        title="Side-by-side branches: goals spawned by one tactic lay out as columns (compact mode; pairs well with ¶ reflow)"
        pressed={sideBySide}
        onClick={() => onSideBySideChange(!sideBySide)}
      />
      <RailButton
        glyph="❮❯"
        title="Gallery: show one of a branching tactic's subtrees at a time, cycled by the ‹ n/m › pager under it"
        pressed={gallery}
        onClick={() => onGalleryChange(!gallery)}
      />
      <ReflowControl
        reflow={reflow}
        forced={forcedReflow}
        onChange={onReflowChange}
        open={reflowOpen}
        onOpenChange={onReflowOpenChange}
      />
      <RailButton
        glyph="⋯"
        title="Brief: collapse boilerplate inside tactics to … (a binding's := derivation, a long [ … ] list), keeping the head and the bindings — hover a … to reveal it"
        pressed={brief}
        onClick={() => onBriefChange(!brief)}
      />
      <RailButton
        glyph="▦"
        title="Overview: shrink every node to a one-line chip except where the cursor is — hover a chip to peek at its full content"
        pressed={overview}
        onClick={() => onOverviewChange(!overview)}
      />
      <RailButton
        glyph="⇉"
        title="Combine: merge each straight run of tactics into one node (stacked), dropping the pass-through goals between them"
        pressed={combine}
        onClick={() => onCombineChange(!combine)}
      />
      {/* Outline-only is NOT here: it is a standing preference about how boxes
          look rather than a gesture, so it lives in the companion's settings
          (`proofTree.outlineOnly`) and arrives as a prop. */}
      <RailButton
        glyph={HYP_MODES[hypMode].glyph}
        title={HYP_MODES[hypMode].title}
        // Pressed whenever the context is NOT the default breadth, so the rail
        // shows at a glance that something is being filtered or expanded. Home
        // is `used`; a rail button offers the DEPARTURE from home rather than
        // asking you to hold it pressed to stay there (the ⋔ layout button's
        // reasoning — keep the two in step if either default moves).
        pressed={hypMode !== "used"}
        onClick={() => onHypModeChange(HYP_MODES[hypMode].next)}
      />
      <div style={{ height: 6 }} />
      <RailButton
        glyph="⇝"
        title="Linearize one path: pick a start node, then an end node"
        pressed={seqActive}
        pressedColor={SEQ_STROKE}
        onClick={onToggleSequence}
      />
      <RailButton
        glyph="⇥"
        title="Elide a run of nodes: pick a start node, then an end node — the path between collapses to a marker (click it to restore)"
        pressed={elidePicking}
        pressedColor={SEQ_STROKE}
        onClick={onToggleElide}
      />
      <RailButton
        glyph="⇳"
        title={
          bandEnabled
            ? "Cut a vertical band: pick a top node, then a bottom node — everything between them (any branch) collapses to a marker (click it to restore)"
            : "Cut a vertical band (compact stacked layout only)"
        }
        pressed={bandPicking}
        pressedColor={SEQ_STROKE}
        disabled={!bandEnabled}
        onClick={onToggleBand}
      />
      {/* No exit-focus button here: leaving a focus is not a view setting, and
          a glyph at the far right of a wide tree is a long way from where the
          eye rests. It lives on the top-left breadcrumb pill instead, with Esc
          and ◎/⌥-click on the focused goal as the other two ways out. */}
      <div style={{ height: 6 }} />
      <RailButton
        glyph="+"
        title={`Zoom in (${CMD}-scroll zooms at the cursor)`}
        onClick={onZoomIn}
      />
      <RailButton glyph="−" title="Zoom out" onClick={onZoomOut} />
      <RailButton glyph="⛶" title="Fit width" onClick={onFit} />
    </div>
  );
}


/** One frontier chip under a pending goal (see the call site). Ghost-styled —
dashed outline, no fill — so it reads as a slot rather than an existing node.
`x` is its LEFT EDGE, so the call site can lay the row out by running a cursor
across widths; a centre-based x is what let the two chips overlap by 2px. */
// The relation picker: the chip lane, expanded into one chip per relation a
// chain here could be built out of (from the server's `Trans` enumeration),
// plus a cancel. A row of the same ghost chips rather than an HTML menu —
// the vocabulary is already here, it stays inside the SVG, and it needs no
// portal or focus management.
//
// Widths are MEASURED, not assumed: `≤` and `↔` are not `=`, and a fixed
// width would clip or straggle. `measureText` measures in the editor's code
// font, so the chips must PAINT in it too — hence the explicit `fontFamily`,
// which the rest of the chip vocabulary (UI chrome) does not take.
/** The relation row a `calc` / `step` chip expands into.
 *
 * A chip's GLYPH is what will be written, not a name for it — and since every
 * gesture here writes exactly ONE link, the glyph is exactly one relation.
 * (It briefly showed a PAIR, `≤ <`, back when opening a chain emitted a second
 * closing link the author had not chosen; the fix was to stop writing it, not
 * to keep labelling it.) */
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
    const width = Math.max(
      CHIP_W_ADD,
      measureText(glyph, PICK_FONT_PX) + 2 * CHIP_PAD_X,
    );
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
  // Relation glyphs (≤ ∣ ⊆ ↔) are measured to size their chips, and
  // `measureText` measures in the EDITOR's code font — so those chips must
  // paint in it too, or the width and the glyph disagree. Everything else
  // stays UI chrome.
  fontFamily = "monospace",
  onPick,
}: {
  glyph: string;
  title: string;
  x: number;
  width: number;
  color: string;
  fontSize?: number;
  fontFamily?: string;
  onPick: () => void;
}) {
  return (
    <g
      transform={`translate(${x},0)`}
      style={{ cursor: "pointer" }}
      // stopPropagation on both: a bare click would fall through to the goal
      // box and fold it, and a double-click would reach the node handler.
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <title>{title}</title>
      <rect
        x={0}
        y={0}
        width={width}
        height={CHIP_H}
        rx={4}
        fill="transparent"
        stroke={color}
        strokeWidth={1.2}
        strokeDasharray="3 2"
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

// The gallery's ‹ n/m › pager, drawn under a branching tactic in the gap
// above its children. Always visible rather than hover-revealed: it is the
// ONLY way to reach the hidden branches, and an affordance you have to
// discover by hovering is no affordance at all. Chrome-styled (the editor's
// widget palette) like the rail, not proof-styled like a FrontierChip —
// it navigates the view, it isn't part of the proof.
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
      // Both stopped: a bare click would fall through to the tactic box (which
      // reveals in source), a double-click to the in-place editor.
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

// Platform label for the reveal fast-path modifier (⌘ on mac, Ctrl elsewhere),
// used in tooltips and button titles.
const CMD =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform)
    ? "⌘"
    : "Ctrl";

// Hover action bar on a goal box: real button-sized targets for the node's
// secondary actions (reveal in source, focus subtree), shown only while the
// pointer is over the node so a dense tree stays clean. It straddles the box's
// top-right corner — mostly outside so it doesn't cover the label, overlapping
// the border a few px so the hover region is contiguous with the box (leaving
// the box for the bar can't un-hover the node). UI chrome, so monospace like
// the toolbar, not the code font.
const BAR_BTN = 20; // button square
const BAR_PAD = 3; // bar padding around the buttons
const BAR_GAP = 2; // between buttons
const BAR_OVERLAP = 5; // how far the bar dips onto the box's top edge
interface NodeAction {
  glyph: string;
  title: string;
  onClick: () => void;
  /** Destructive: the glyph takes the editor's error colour so the one action
  that removes text does not look like the three that only navigate. */
  danger?: boolean;
}
function NodeActionBar({
  placement = "top-right",
  x,
  y,
  actions,
}: {
  // "top-right": the bar straddles the box's top-right corner — (x, y) is the
  // bar's right edge and the box top; it dips BAR_OVERLAP down onto the box.
  // "right": the bar hangs off the box's right edge, centred on it — (x, y) is
  // the bar's LEFT edge (already inset by BAR_OVERLAP, so it starts ON the
  // box) and the box's vertical centre. Used for tactic boxes, which are one
  // line tall with too little room above for the corner placement.
  placement?: "top-right" | "right";
  x: number;
  y: number;
  actions: NodeAction[];
}) {
  const w = actions.length * BAR_BTN + (actions.length - 1) * BAR_GAP + 2 * BAR_PAD;
  const h = BAR_BTN + 2 * BAR_PAD;
  const x0 = placement === "right" ? x : x - w;
  const y0 = placement === "right" ? y - h / 2 : y - h + BAR_OVERLAP;
  return (
    <g>
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
        const bx = x0 + BAR_PAD + i * (BAR_BTN + BAR_GAP);
        return (
          <g
            key={a.glyph}
            onClick={(e) => {
              // Action, not fold: stop the click from reaching the box's own
              // onClick (toggle).
              e.stopPropagation();
              a.onClick();
            }}
            style={{ cursor: "pointer" }}
          >
            <title>{a.title}</title>
            <rect
              x={bx}
              y={y0 + BAR_PAD}
              width={BAR_BTN}
              height={BAR_BTN}
              rx={2}
              fill="var(--vscode-toolbar-hoverBackground, #f7fafc)"
              stroke="var(--vscode-editorWidget-border, #e2e8f0)"
            />
            <text
              x={bx + BAR_BTN / 2}
              y={y0 + BAR_PAD + BAR_BTN / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={13}
              fontFamily="monospace"
              fill={
                a.danger ? DANGER_FILL : "var(--vscode-icon-foreground, #2d3748)"
              }
            >
              {a.glyph}
            </text>
          </g>
        );
      })}
    </g>
  );
}
