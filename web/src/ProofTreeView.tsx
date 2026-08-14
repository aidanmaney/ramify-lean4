import {
  Fragment,
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
  LINK_MARK_OFF,
  TRUNK_INSET,
  CHIP_LANE_H,
  CHIP_TOP_GAP,
  COMMENT_FONT_PX,
  COMMENT_LINE_H,
  COMMENT_INDENT,
  CASE_FONT_PX,
  CASE_LINE_H,
  bandTopH,
  inkExtent,
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
  tacticId,
  rootIds,
  tacticNodeAt,
  tacticTargets,
  posLE,
  cmpPos,
} from "./proofToTree";
import { TURNSTILE, type HypMode } from "./proofToTree";
import {
  type ElideCut,
  applyElisions,
  combineMemberIds,
  combineRuns,
  cutId,
  pathIds,
  pruneCuts,
  leafFoldTargets,
  remapCut,
  resolveCut,
  selectionRun,
  sourceView,
  stepElidable,
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
  HYP_MARK,
  VERB_DOC,
  nodeHints,
  type Caps,
  type SelVerbDocKey,
} from "./gestures";
import { HelpPanel } from "./helpPanel";
import {
  ACCENT_TEXT,
  CASE_FILL,
  COMMENT_FILL,
  PROSE_FILL,
  EDIT_BG,
  EDIT_TEXT,
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
// Per-glyph size overrides for the rail. The target is equal INK height, NOT
// equal font size: measured across the rail, the glyphs land in a 7–10px ink
// band at the shared 14px (☰ 6.9, ◫ 8.3, ❮❯ 10.2, ¶ 11.6), and a glyph that
// misses that band reads wrong however "correct" its px is. So the number
// depends on how much of the em the glyph actually inks, and can go EITHER way
// from the 14px default:
//   - half-height math glyphs (⊦ ⋔ ink ~0.5em) need 17.5 to reach ~10px;
//   - a full-height glyph (ASCII `|` inks the whole em) needs 10 to reach the
//     same ~10px — at 17.5 it drew 17.5px of ink, near twice its neighbours.
const RAIL_GLYPH_BIG = 17.5;
const RAIL_GLYPH_FULL = 10;
// The quote that marks narration. Sized to look equal rather than measure
// equal (see the button's own comment) and nudged down, because a quotation
// mark is drawn at cap height while the button centres the em box: at 22 the
// ink is 5.6px tall sitting 7.4px above centre, and +7 lands it 0.4px above,
// which is where ⊟ (0.75) and ⑃ (0.1) already sit.
const RAIL_GLYPH_PROSE = 22;
const RAIL_GLYPH_PROSE_DY = 7;

// The default is right for ☰, whose three bars fill the em box; ⊦ ⋔ are thin
// and sparse and || is full-height, so all three carry an explicit `px`.
// Tracks is ASCII `||`, not the math ∥ (U+2225), which is drawn tight — its
// bars sat ~1px apart at any size, and a math glyph's spacing is at the mercy
// of whatever the webview resolves `monospace` to. The pipes' separation is a
// monospace CELL, so it does not scale with the size either: at 10px the bars
// still sit ~4.8px apart, five times ∥'s gap.
const LAYOUT_MODES: Record<
  LayoutMode,
  { glyph: string; title: string; next: LayoutMode; px?: number }
> = {
  stacked: {
    glyph: "☰",
    title:
      "Layout: compact outline — every node on its own line off a left trunk (click for the goal spine: goals tight on the left, tactics in their own track to the right)",
    next: "spine",
  },
  spine: {
    glyph: "⊦",
    px: RAIL_GLYPH_BIG,
    title:
      "Layout: goal spine — two tracks, goals stacked tight on the left and each tactic beside its step in a right-hand track (click for aligned tracks: goals wrapped to a modest width, every tactic at one x)",
    next: "tracks",
  },
  tracks: {
    glyph: "||",
    px: RAIL_GLYPH_FULL,
    title:
      "Layout: aligned tracks — the spine with goals wrapped to a modest width, so every tactic starts at the SAME x and the two tracks read as columns (click for the wide layered tree)",
    next: "wide",
  },
  wide: {
    glyph: "⋔",
    px: RAIL_GLYPH_BIG,
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
// Breathing room between the selection pill's chips and the edge of the
// opaque card behind them.
const CARD_PAD = 4;
// The gap that carries the selection pill's safety seam: a hairline and a ✎
// between the verbs that change the VIEW and the verbs that change your FILE.
const SEP_W = 26;
const CHIP_W_ADD = 20;
const CHIP_W_SORRY = 36;
// The fill-in-place chip names the hole rather than reading `+`. "Add a tactic
// for this goal" and "fill the hole in this term" are different gestures, and
// the lane is the only place that difference shows without hovering. Its width
// is MEASURED like the picker's chips — `?_` does not fit the `+` chip's 20px —
// and only the FIRST chip's width varies, so the row's own origin is unchanged
// and the chips after it shift right by whatever this returns.
const HOLE_GLYPH = "?_";
const addChipGlyph = (spec: AddSpec | undefined) =>
  spec?.kind === "hole" ? HOLE_GLYPH : "+";
const addChipWidth = (spec: AddSpec | undefined) =>
  spec?.kind === "hole" ? chipWidth(HOLE_GLYPH, CHIP_FONT_PX) : CHIP_W_ADD;
/** The chip lane's running x offsets: `[add, sorry, calc/step]`. The row is
 * centred on the incoming lane at the ADD chip's fixed width (so a wider first
 * chip never moves the row's origin) and each chip starts past the previous
 * one's width plus `CHIP_GAP`. One place for the cumulative sums — four chips
 * render from separate JSX sites, and the offsets are only checked by eye. */
const chipLaneXs = (spec: AddSpec | undefined): [number, number, number] => {
  const x0 = -CHIP_W_ADD / 2;
  const x1 = x0 + addChipWidth(spec) + CHIP_GAP;
  return [x0, x1, x1 + CHIP_W_SORRY + CHIP_GAP];
};
const CHIP_W_STEP = 30;
// What a chain gesture's overlay asks for: the new link's RIGHT-HAND SIDE,
// and nothing else — the relation is already picked and the justification is
// written as a `sorry` for the second half of the gesture to type over (see
// calcEdit's STUB). `_` is the answer that CLOSES a chain against its goal, so
// it is prefilled wherever closing is what the gesture means; an empty commit
// backs out everywhere.
const CLOSE_RHS = "_";
const CHIP_FONT_PX = 10;
// The selection pill's verb chips (`elide`, `¬note`, `.no-hyps`…): WORDS, so
// a step up from the lane's single glyphs, a step down from the picker's
// relation symbols.
const PILL_FONT_PX = 11;
// Relation chips in the picker row (see PickerRow): a touch larger than the
// word chips, since a single glyph carries the whole meaning.
const PICK_FONT_PX = 12;
const CHIP_PAD_X = 6;
/** A measured chip's width: the glyph plus padding, floored at the `+` chip's
 * fixed width so a narrow glyph still reads as a chip. THE chip-width formula —
 * the hole chip, the delete-confirm chip and the picker row all size from
 * here, so the padding/floor rule has exactly one home. */
const chipWidth = (glyph: string, fontPx: number) =>
  Math.max(CHIP_W_ADD, measureText(glyph, fontPx) + 2 * CHIP_PAD_X);

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
// Trailing debounce on the global-name completion fetch: long enough that
// mid-word typing coalesces, short enough that the tier arrives while the
// list is still being read.
const GLOBAL_DEBOUNCE_MS = 160;
// The environment tier's query cache: fetched query → names. MODULE scope —
// one overlay is ever open, and the overlay-scoped clear in the component is
// the whole invalidation story. Only `.set`/`.clear` ever touch it (the React
// compiler accepts interior mutation where it rejects reassignment). Not a
// ref, and the fetch pipeline that fills it runs through STATE, not refs:
// `react-hooks/refs` treats a ref read inside a JSX-called function as
// render-phase and the taint spreads through every caller — the recorded
// abbreviation lesson, re-hit on `refreshCompletion`'s call sites. The two
// effects in the component that reference this rationale point here.
const globalNameCache = new Map<string, string[]>();

/** The cached answer usable for `ident`, if any: the LONGEST fetched query
 * that prefixes it — but a truncated answer (the server cap was hit) only
 * serves its exact query, since narrowing it locally could have lost names
 * the longer prefix would match. */
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
  // The node's real ink span (inkExtent, the bandTopH sibling), not a
  // symmetric half-height: a FLOATED strip hangs entirely above the band, so
  // the comfort test has to reach further up than down. This was approximated
  // for a while on the grounds that the `pad` slack absorbs the shift — true
  // for a one-line strip, false from three lines up (a 4-line strip is a 41px
  // error), and the omitted `caseH` was never absorbed at all. For a
  // non-floating node the span is symmetric about `cy`, so this is a no-op
  // everywhere except the aside modes.
  const ink = inkExtent(node.data);
  const inkTop = cy - ink.up * zoom;
  const inkBot = cy + ink.down * zoom;
  const pad = 32;
  const maxX = el.scrollWidth - el.clientWidth;
  const maxY = el.scrollHeight - el.clientHeight;
  let left = el.scrollLeft;
  let top = el.scrollTop;
  if (
    inkTop < el.scrollTop + pad ||
    inkBot > el.scrollTop + el.clientHeight - pad
  )
    top = clampScroll((inkTop + inkBot) / 2 - el.clientHeight / 2, maxY);
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
"move the view", and whichever spoke last wins — EXCEPT a repeat of the SAME
destination, which is left to finish (`tgt`): the follow effect re-fires per
cursor keystroke (its guard is the cursor key, deliberately — ids renumber per
re-parse), so with the accented node outside the comfort band every keystroke
restarted the ease toward one unchanging target, a scroll that never settled —
part of the reported typing jiggle. */
type FollowAnim = {
  raf: number | null;
  timer: number | null;
  tgt: { left: number; top: number } | null;
};

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
  // Already easing to exactly this spot → let it finish (see FollowAnim).
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

/**
 * Which node a counterfactual stub names, among `ns`, or null.
 *
 * WHICH node is the stub is the SERVER's answer (`cfStubPos` — the splice knows
 * the byte it wrote `sorry` at), matched the way `pendingFill` claims its own
 * stub: exact position plus the label actually being `sorry`. The line rule it
 * replaces is ambiguous in principle — a container and the injected stub can
 * both start on the cursor's line — though the attempt to REACH that state
 * failed: `cfWanted`'s completeness witness declines cf whenever a step starts
 * on the line. A failed exact match falls back to the line rule rather than
 * answering nothing: the overlay is the whole "here is where your tactic lands"
 * affordance, and dropping it is the worse failure.
 *
 * ONE coding, because two surfaces ask: the overlay (over the DRAWN nodes) and
 * the seek that reveals the stub when it is hidden (over the BASE nodes, which
 * is the only list an elided node is still in). They must name the same node or
 * the seek would open a cut the overlay then declines to paint in.
 */
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
   * Widget-only: global names matching a typed prefix, over the
   * `completionNames` RPC — the environment tier of the completion list, the
   * one pool the payload cannot carry (240k eligible names). The view owns the
   * discipline that makes an RPC tier acceptable where full `idCompletion` was
   * rejected: prefix-gated (`MIN_GLOBAL_PREFIX`), debounced, cached per query,
   * and applied only while its query still prefixes what is being typed.
   */
  fetchGlobalNames?: (query: string) => Promise<string[]>;
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
   * Widget-only settings on the same channel as `outline`. `linkTint` pulls
   * each edge's ink toward its target's hue; it defaults off and is purely
   * paint.
   *
   * `linkMarks` gates the mark LAYER itself, and unlike `linkTint` it defaults
   * ON: the marks are the accessible baseline — the one channel that survives
   * without colour — so dropping them is a deliberate opt-out for readers who
   * find the ink distracting and read the target's kind off the tint or the
   * box shape. Defaulting on also means an older companion, which sends no
   * such key at all, keeps drawing exactly what it drew before.
   */
  linkTint?: boolean;
  linkMarks?: boolean;
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
   * Widget-only: the COUNTERFACTUAL stub. When set, the proof on screen was
   * elaborated with `line`'s content replaced by `sorry` (the document is
   * mid-edit and does not elaborate), and `draft` is what the author has
   * typed on that line so far. The tactic node anchored on that line draws
   * the draft over its box, dashed and accent-inked.
   *
   * `pos` is the stub step's exact `position.start` when the server ships it
   * (`cfStubPos`): the injected `sorry` and its CONTAINER can both start on
   * `line`, so naming the node by line alone picks the wrong box on the
   * `:= by` splice tier. Optional — an older server sends only the line, and
   * the harness fakes the marker without one.
   *
   * `col` is where `draft` begins in the REAL line (`cfDraftCol`), and it is
   * what makes the stub EDITABLE. A double-click opens the ordinary in-place
   * editor prefilled with `draft`, committing over `[{line, col}, end of
   * line]` in real coordinates — the author's own line, never the spliced
   * one, so the editing-seam withdrawal that drops `tacticEdits` here is not
   * reopened (nothing in this path carries counterfactual TEXT). Absent ⇒ the
   * overlay is inert, which is the old behaviour and what an older server
   * still gets.
   */
  /** The declaration's signature, drawn as a fixed header above the canvas so
  the reader always knows which theorem the tree belongs to — and so a proof
  that is only partly written still reads as one document rather than as a
  fragment. CHROME, deliberately, not a tree node: as a node it would set the
  tree's width (a statement is routinely wider than the whole proof) and would
  have to be threaded through rootIds, folding, eliding and anchoring, all to
  restate what the root goal already says. As chrome it wraps, costs no layout,
  and cannot move the tree. */
  declHeader?: string;
  /** Colour + popups for it, as a hook (the `renderTaggedTactic` shape, and
  source-agnostic for the same reason). Absent ⇒ plain text. */
  renderDeclHeader?: (
    lines: string[],
    /** A truncated stand-in for the statement; aligned, so it keeps colour. */
    label?: string,
  ) => ReactNode[] | null;
  /** Click: put the buffer's caret on the statement. Reveal is the ONLY
  gesture here, and deliberately so — it was briefly editable in place and the
  author reverted it after using it. An in-place statement editor immediately
  wants completion, abbreviation expansion and live colouring to be worth
  having, and the one thing the tree genuinely cannot do is START a proof: a
  new theorem has no tree to draw. So the header hands you to the editor, where
  the full IDE is, rather than growing a second-rate copy of it. */
  onRevealHeader?: () => void;
  cfStub?: {
    line: number;
    pos?: { line: number; character: number };
    draft: string;
    col?: number;
    /** Colours and hover popups for `draft`, as a HOOK — the same shape as
    `renderTaggedTactic`, and here for the same reason: the view stays
    source-agnostic and only the widget knows how to resolve a token.
    It cannot reuse `renderTaggedTactic` itself, because that one indexes the
    payload the stub is drawn in — the SPLICED elaboration, whose bytes on this
    line read `sorry`. The widget feeds this one from `cfDraftTokens`, taken
    from the real document, so the stub reads as source rather than as the one
    box in the tree painted in flat foreground. Absent (older server, no
    tokens, or the harness's faked marker) ⇒ plain text, the old behaviour. */
    render?: (
      draft: string,
      line: number,
      col: number,
    ) => ReactNode[] | null;
  } | null;
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
  fetchGlobalNames,
  tokenColors,
  outline = false,
  linkMarks = true,
  linkTint = false,
  onPopoutEdit,
  highlightPos,
  declHeader,
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
  onDeleteTactic,
  onPreviewRange,
  onUndo,
  abbrev = DEFAULT_ABBREV,
  diagnostics,
}: ProofTreeViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Accordion: expanding a node collapses its sibling branches, so only one
  // branch is open per level (the "view one branch at a time" mode). OFF by
  // default — it is a reading discipline, not a property of the proof, and as
  // a default it silently shuts branches the reader had deliberately opened.
  const [accordion, setAccordion] = useState(false);
  // Context verbosity, cycled by the rail (see HYP_MODES): `used` (default)
  // shows what the proof BELOW the goal depends on, `new` what the tactic
  // above bound, `delta` what the goal gained (plus anything its own tactic
  // uses), `full` the whole context.
  const [hypMode, setHypMode] = useState<HypMode>("used");
  // Whether those lines are reordered data-then-props (see `hypGroup` in
  // proofToTree). A SECOND axis on the same rail button — ⌥-click — rather
  // than a fifth step in the cycle or a button of its own: it is the same
  // question ("how is the context shown"), it composes with all four breadths,
  // and a five-stop cycle you have to walk past three modes to reach is worse
  // than a modifier. Grouped is home; ungrouped restores Lean's binder order,
  // which is the order the hypotheses DEPEND on each other in.
  const [hypGroup, setHypGroup] = useState(true);
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
  // Which rail flyout group is expanded (see RailFlyout) — ONE value, not a
  // boolean per group, so opening one closes the others by construction. The
  // reflow slider is the same kind of surface (a transient row left of the
  // rail), so the two setters close each other below; both live in `layers`.
  const [railFlyout, setRailFlyout] = useState<RailFlyoutId | null>(null);
  const openFlyout = (v: RailFlyoutId | null) => {
    setRailFlyout(v);
    if (v) setReflowOpen(false);
  };
  const openReflow = (v: boolean) => {
    setReflowOpen(v);
    if (v) setRailFlyout(null);
  };
  // Whether the gesture reference (HelpPanel) is open. Almost every gesture on
  // this tree is a click, a modifier or a drag, and the one place they were
  // written down — the node's native <title> — is COVERED by the tagged label's
  // foreignObject in the infoview, which is the only place the widget actually
  // ships. So the panel is not a nicety; without it the vocabulary is
  // undiscoverable in the product and discoverable only in the dev harness.
  //
  // Pure paint: NOT in `viewKey`, no anchorRoot, not an engine dep, never
  // remapped — it draws over the tree and moves nothing. And NOT cleared on a
  // proof change: it is a reader's reference, the class of thing the ⌥-⊞
  // source-view reset deliberately preserves (like zoom and the rail toggles).
  const [helpOpen, setHelpOpen] = useState(false);
  // What this HOST offers, from the hooks it handed us. The panel filters on
  // it, so the standalone app shows a shorter and still-true list instead of a
  // second hand-maintained one going stale next to the real one.
  const caps: Caps = {
    reveal: !!onReveal,
    edit: !!getTacticEdit && !!onEditTactic,
    add: !!onAddTactic,
    popout: !!onPopoutEdit,
    del: !!onDeleteTactic && !!deleteSlots,
    flags: !!onEditTactic && !!deleteSlots,
    undo: !!onUndo,
  };
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
  // Base ids the AUTO combine pass must leave alone — the un-combine verb's
  // memory. A ⇉-made run is recomputed every render rather than stored, so
  // dissolving ONE of them needs a standing exclusion, not a cut removal.
  // Remapped across re-parses like every other id set; cleared when ⇉ turns
  // off (re-enabling the mode recombines everything, the same bargain ⊞
  // makes with cuts) and on a proof change.
  const [combineOff, setCombineOff] = useState<Set<string>>(new Set());
  // Overview: everything outside the cursor's local region lays out as a
  // one-line mini chip, so the tree reads as its shape; hover a chip to peek
  // at its full content (paint-only — see the peek overlay). Engine-tier
  // geometry, like brief/combine.
  //
  // PARKED, not removed: the rail slot it used to hold (▦) now carries the
  // comment toggle, which the author wanted more, and the rail is deliberately
  // not growing a button per feature. Everything below it — the keep-set
  // memos, the engine's mini sizing, the hover peek — is intact and correct;
  // re-exposing it is one RailButton, so there is no setter here on purpose
  // (a `false` that nothing writes is what makes the dead-state honest).
  const [overview] = useState(false);
  // Comment strips, globally. Engine-tier for the same reason brief is: the
  // strip is part of a node's BAND, so hiding it has to give the room back.
  // Three states: "shown" (strips above nodes, home), "hidden" (no strips),
  // "instead" (narration — a commented tactic's prose replaces its label
  // inside the box; see LayoutNode.proseLabel). Click walks shown↔hidden;
  // ⌥-click walks instead↔shown — two axes on one button, the ⊞ precedent.
  const [commentMode, setCommentMode] = useState<
    "shown" | "hidden" | "instead"
  >("shown");
  // Ids whose strip is hidden individually (the selection pill's verb), on
  // top of the global switch. The `combineOff` lifecycle exactly: remapped
  // across re-parses, cleared on a proof change — and NOT cleared when the
  // global toggle flips, so turning comments back on doesn't silently undo
  // the ones you asked to hide.
  const [commentsOff, setCommentsOff] = useState<Set<string>>(new Set());
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
  // Marquee selection: a drag on the BACKGROUND rubber-bands a rectangle
  // (content coordinates, so it scrolls with the tree and zoom applies free);
  // releasing it selects every node whose BOX intersects, and a floating pill
  // of verbs appears at the selection's top edge. Background drag was
  // unclaimed (background *click* dismisses the accent, wheel scrolls), so
  // the gesture needs no modifier — which matters here, ⇧ having a record of
  // silently breaking in webviews. A sub-4px drag stays a click.
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  // The selected node ids (placed-node ids: markers included — the verbs
  // dissolve them back to base ids where needed). Null = no selection; the
  // accent outline marks members; cleared by Esc, a background click, a verb,
  // or a proof change; remapped like every other id set on a shape change.
  const [selection, setSelection] = useState<Set<string> | null>(null);
  // A drag that just completed fires a click on the container as it ends —
  // which is the "background click clears the selection" gesture, so without
  // this flag every marquee dissolved itself on mouseup.
  const marqueeDidDrag = useRef(false);
  // The prose prompt for the two free-text flag verbs: `.none <prose>`
  // (replace the head's subtree with a sentence) and a plain annotation.
  // Blur is a NO-OP like the staged calc fill (stray infoview blurs consumed
  // those stages before the author ever saw them); Enter commits, Esc or a
  // background click cancels.
  const [flagPrompt, setFlagPrompt] = useState<{
    headId: string;
    kind: "none" | "note";
  } | null>(null);
  // Focus mode: a goal id whose subtree becomes the whole tree (that goal is
  // the new layout root); null shows the full proof. Folding still works
  // within the focused subtree.
  const [focusId, setFocusId] = useState<string | null>(null);
  // The goal node currently showing its hover action bar (reveal-in-source /
  // focus-subtree buttons). The bar renders inside the node's own <g>, so
  // pointer travel from box to bar never leaves the hover region (no flicker).
  const [hoverId, setHoverId] = useState<string | null>(null);
  // What a ◌ would take, faded while the pointer is on the button (or ⌥ is
  // held over the tactic). Hover state like `hoverId`, and reset like it —
  // nothing but ids, so a stale set can only fail to match. `anchor` is the
  // node the gesture acts on; it deliberately does NOT fade, because the
  // action bar rides inside the node's own <g> and a faded ◌ under the
  // pointer reads as a disabled button (the armed delete's rule, same reason).
  // `from` names which surface put the preview up — the ⌥ gestures or the
  // bar's ◌ button — because their CLEARS must not cross: the bar rides
  // inside the node's <g>, so every pointer jiggle over the button fires the
  // g's onMouseMove with altKey false, and an untagged clear there killed the
  // button's own preview the instant it appeared (the reported "flashes but
  // nothing real").
  const [elidePreview, setElidePreview] = useState<{
    anchor: string;
    ids: Set<string>;
    // Whether the gesture takes the ANCHOR itself and nothing else (a closing
    // tactic, where ⌥ folds the goal above). Only the ⌥ surface acts on it —
    // see the node's opacity.
    self: boolean;
    from: "alt" | "bar";
  } | null>(null);
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
    // The step position the syntax-colouring mirror should align tokens
    // against, when it is not the edited NODE's own. Set by a COMBINED node's
    // per-part edit: the node's position is undefined (a marker spans several
    // tactics), but the PART being edited has one, and its tokens are exactly
    // the draft's.
    tokPos?: ProofStepPosition;
    // Present when what is being edited is the node's COMMENT, not its
    // tactic: `pos` is the comment block's source range and `original` its
    // verbatim text, delimiters included (`-- …`), reconstructed from
    // `proof.comments` — the client never holds document text, and the strip's
    // display string is lossy (markdown cleaned, soft-wraps joined), so it
    // cannot be written back. The overlay hangs over the STRIP (the box stays
    // visible), the colour mirror stays off (prose, not tactic tokens), and an
    // EMPTY commit deletes the comment's whole line(s) — clearing a comment is
    // how you remove one (`removeCommentPatch`, the slot-line veto included).
    comment?: boolean;
    // Comment edits only: the column the block's CONTINUATION lines sit at in
    // source. Stripped for display and re-applied on commit, so the editor
    // shows the block the way the file does (see commentEditFor).
    commentIndent?: number;
    // Present when what is being edited is the COUNTERFACTUAL STUB — i.e. the
    // line the author is mid-typing, offered in the tree because the box that
    // shows their draft ought to behave like every other box that shows source.
    // `pos` is a REAL-document range (`cfDraftCol` → the clamped-huge
    // end-of-line character the insertion path already relies on) and
    // `original` the real line's own text, so nothing here is a counterfactual
    // coordinate and nothing written can be a counterfactual byte — which is
    // what keeps the editing-seam withdrawal intact rather than reopened. The
    // number is the line's indent, re-applied to continuation lines on commit
    // like `commentIndent`. Empty commit CANCELS, the tactic rule.
    cfIndent?: number;
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
  // The selection pill's own armed half, for `unflag` — the one verb there
  // that DELETES text the author wrote (whole comment lines, prose included),
  // which is exactly what `arming` exists for on ⊘. It reuses the PATTERN, not
  // the state: `arming` is keyed on a node and its extent/dimming/preview all
  // are, and a selection has no node.
  //
  // Like `arming` it holds PATCHES computed against the current document, so
  // it must be cleared everywhere ranges go stale — the layer table, the
  // background click, and the shape-change branch beside `setArming(null)`.
  // That last one is the dangerous one: a re-elaboration between arming and
  // confirming would otherwise write against coordinates that have moved.
  const [pendingVerb, setPendingVerb] = useState<SelVerb | null>(null);
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
  // THE dismissal layering — everything that Esc can take back, in ONE place.
  // Three consumers read it and there is no fourth: Esc (just below), the
  // background click (the scroll container's onClick), and the hint pills,
  // whose ✕ is the layer's own `off` so a pill and Esc cannot disagree about
  // what leaving a mode means.
  //
  // It replaced three hand-written lists that had already drifted apart, and
  // the drift was not cosmetic: the three PICKING modes (⇝ sequence, ⇥ path,
  // ⇳ band) appeared in NONE of them, so the three modes that take over every
  // click on the tree were the three with no announced way out.
  //
  // `bg` says whether a click on the tree background dismisses the layer too.
  // The picking modes say NO deliberately: between the first pick and the
  // second the pointer crosses a tree full of background, and one miss would
  // destroy the gesture. Their ways out are all deliberate ones — Esc, the
  // rail button that turned the mode on, and the hint pill's ✕.
  type Layer = { id: string; up: boolean; off: () => void; bg: boolean };
  const layers: Layer[] = [
    // First: the cheapest thing to rebuild (one click on its head), so a stray
    // Esc takes it before anything that cost a gesture.
    {
      id: "railFlyout",
      up: railFlyout !== null,
      off: () => setRailFlyout(null),
      bg: true,
    },
    { id: "help", up: helpOpen, off: () => setHelpOpen(false), bg: true },
    // The prose prompt sits ABOVE the selection that spawned it: backing out
    // of `.none…` should hand you back the selection, not dissolve it.
    {
      id: "flagPrompt",
      up: !!flagPrompt,
      off: () => setFlagPrompt(null),
      bg: true,
    },
    { id: "arming", up: !!arming, off: () => setArming(null), bg: true },
    {
      id: "pendingVerb",
      up: !!pendingVerb,
      off: () => setPendingVerb(null),
      bg: true,
    },
    { id: "picking", up: !!picking, off: () => setPicking(null), bg: true },
    // The ¶ slider is a floater over the tree, so clicking the tree is "done
    // with it" — the rail sits outside the scroll container, so its own clicks
    // (the ¶ button included) never land on the background.
    {
      id: "reflow",
      up: reflowOpen,
      off: () => setReflowOpen(false),
      bg: true,
    },
    // A staged calc fill closes on Esc or a background click and writes
    // NOTHING: the `_`s stand and the file stays valid. Its blur is
    // deliberately a no-op, which is exactly why it needs this layer.
    {
      id: "calcStage",
      up: !!editing?.calcStage,
      off: () => setEditing((cur) => (cur?.calcStage ? null : cur)),
      bg: true,
    },
    {
      id: "seq",
      up: seq.mode !== "off",
      off: () => setSeq({ mode: "off" }),
      bg: false,
    },
    {
      id: "elidePick",
      up: !!elidePick,
      off: () => setElidePick(null),
      bg: false,
    },
    {
      id: "bandPick",
      up: !!bandPick,
      off: () => setBandPick(null),
      bg: false,
    },
    // Second to last because a selection is EXPENSIVE to rebuild — it costs a
    // drag — so anything cheaper should be what a stray Esc takes.
    {
      id: "selection",
      up: !!selection,
      off: () => setSelection(null),
      bg: true,
    },
    // Last for the same reason, more so: focus costs a gesture to rebuild, and
    // unfocusing as a SIDE EFFECT of cancelling something else throws away the
    // scope the user is working inside.
    {
      id: "focus",
      up: focusId !== null,
      off: () => setFocusId(null),
      bg: false,
    },
  ];
  /** The way out of one layer, by name — what a hint pill's ✕ runs, so the
  pill offers exactly what Esc would do and cannot drift from it. */
  const layerOff = (id: string) => {
    const l = layers.find((x) => x.id === id);
    return l ? l.off : () => {};
  };
  // Esc dismisses the FIRST layer that is up — one keypress, ONE visible
  // effect. It used to clear five at once, so closing the ¶ slider also threw
  // away a marquee selection built by a drag; the argument the focus layer was
  // always given now applies to every layer. Realistic depth is two: the
  // picking modes are mutually exclusive with each other and with the fill.
  //
  // Registered ONCE, reading the table through a ref the render writes (the
  // ⌥-keydown listener's pattern). The old effect listed its own state in the
  // deps and so re-subscribed on every `editing` change — once per keystroke
  // in the in-place editor. Nothing here reads a ref during render, and every
  // `off` is a setState, so react-hooks/refs stays satisfied.
  //
  // A FOCUSED stage or prompt never reaches this listener: its own textarea
  // handles Esc and stops propagation. This is the backstop for the unfocused
  // case, which exists because those overlays' blur is deliberately a no-op.
  const layersRef = useRef(layers);
  useEffect(() => {
    layersRef.current = layers;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      layersRef.current.find((l) => l.up)?.off();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // `?` (and F1) opens the gesture reference. Layout-independent — the KEY is
  // tested, not a shift+slash position — and skipped inside a textarea, where
  // `?` is a character and where the completion list and the abbreviation
  // session already own most of the keyboard. Registered once; nothing here
  // reads state, so it needs no ref.
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
    // No session for a COMMENT edit: prose keeps its backslashes (`\n` in a
    // sentence about newlines must not become a glyph).
    setAbbrevSess(
      editing && abbrev.enabled && !editing.comment
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
    // (Not for a COMMENT edit, which never opens an abbreviation session —
    // prose keeps its backslashes.)
    const flushed =
      !cur0.comment && abbrevSess?.id === editKey(cur0)
        ? abbrevSess.session.flush()
        : undefined;
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
    if (cur.comment) {
      // A comment edit replaces the block's range verbatim; an EMPTY commit
      // deletes the comment's whole line(s) — clearing it is how you remove
      // it — through the same shape (and the same slot-line veto: a comment
      // sharing a line with code loses only its own range) as `unflag`.
      if (cur.value.trim() === "") {
        // Prop first, wire field as the fallback — the standing `deleteSlots`
        // rule (the widget deliberately keeps the field off its rebuilt
        // Proof; the standalone app has only the field).
        const p = removeCommentPatch(
          cur.pos,
          deleteSlots ?? proof.deleteSlots ?? [],
        );
        onEditTactic?.({ start: p.start, stop: p.stop }, p.text);
      } else if (cur.value !== cur.original) {
        // Put the common indent back on every line after the first — the
        // mirror of the strip commentEditFor did, so an untouched block
        // round-trips byte-for-byte and a line the author ADDS lands at the
        // block's own column rather than in column 0 (where a `--` would sit
        // outside the tactic and re-attribute to a different node).
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
      // The counterfactual stub. Same shape as a comment block's commit — a
      // verbatim range replace with the indent put back on continuation lines
      // — but the tactic's EMPTY rule: blanking the box backs out, it does not
      // erase the line the author is in the middle of writing.
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
      // An add commits on any non-empty text: an empty one is how every form
      // here backs out, and for the calc forms it must never write a link
      // with no right-hand side.
      if (cur.value.trim() !== "") {
        const at = onAddTactic?.(cur.add, cur.value);
        // Part two: the gesture wrote a `sorry`, so queue the editor to open
        // on it as soon as the redraw brings it in (see pendingFill).
        if (at?.fill) setPendingFill(at.fill);
      }
    } else if (cur.value.trim() === "") {
      // Emptying the box is how you BACK OUT of a replace, not how you delete
      // the tactic — the rule the `add` and `fill` branches already followed,
      // and the replace branch did not. Writing "" over the range bypassed
      // deleteEdit.ts's whole extent model (whole-line vs exact-range, the
      // `prevSameLine` refusal, block-becomes-`sorry`, the comment above) for
      // a gesture that never asked to delete anything: ⌘A, Delete, click away.
      // Deliberately NOT rerouted to onDeleteTactic either — that would make a
      // slip into an unarmed destructive write, when the ARMED one is a glyph
      // away in the same hover bar.
    } else if (cur.fill ? cur.value.trim() !== "" : cur.value !== cur.original) {
      // A FILL types over the `sorry` in a `by sorry` THIS GESTURE wrote (see
      // calcEdit's STUB), so the `by` is already in the document, one
      // character left of the box and invisible inside it — an author who
      // types `by ring` out of habit got `:= by by ring`. Dedup only on the
      // fill: a plain replace edits a tactic that was already in the source
      // and prepends nothing, so what is typed there is written verbatim.
      onEditTactic?.(cur.pos, cur.fill ? dedupLeadingBy(cur.value) : cur.value);
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
  // Accenting a clicked node is LOCAL VIEW STATE and must not wait on the
  // editor. Derived purely from `highlightPos`, the accent could only appear
  // once the cursor physically arrived — click → the 300ms double-click
  // window → the popout RPC → the companion's fs.watch relay → VS Code sets
  // the selection → a fresh `pos` back to the widget. That whole chain for a
  // highlight reads as broken, and it was invisible only because the accent
  // used not to appear at all in this case (the re-arm below).
  //
  // So the click names the node itself and the cursor round-trip CONFIRMS it:
  // `clickAccent` wins over the derived value until the real cursor lands
  // (any `hlKey` change clears it, see the re-arm), at which point the
  // position is authoritative again. TACTICS only — goals never take the
  // cursor accent, and seeding one here would be the one way to break that.
  const [clickAccent, setClickAccent] = useState<string | null>(null);
  // Re-arming also has to happen on the reveal itself: the dismissal clears
  // on an `hlKey` CHANGE, and a reveal onto the position the cursor already
  // holds changes nothing — so after any background dismiss, clicking the
  // very node the cursor sat in left the tree with no accent at all, and the
  // feature read as "highlights only land when you change lines".
  const accentNow = (id?: string) => {
    setHlDismissed(false);
    if (id) setClickAccent(id);
  };
  const revealAt = (pos: ProofStepPosition, id?: string) => {
    accentNow(id);
    onReveal?.(pos);
  };
  // Only the REVEAL waits out the double-click window (it steals focus into
  // the editor, which is what would cut an in-place edit's opening gesture
  // short). The accent is ours and lands on the first click.
  const deferReveal = (pos: ProofStepPosition, id?: string) => {
    accentNow(id);
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
    // `slots` is passed explicitly rather than left to `proof.deleteSlots`:
    // the widget keeps slots OFF its rebuilt `Proof` (one source of truth, as
    // a sibling on `stable`), so the field is present on the CLI wire and
    // absent on the widget's — and comment attribution needs them on both.
    () => proofToTree(proof, { hypMode, hypGroup, brief, slots: deleteSlots }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proof, hypMode, hypGroup, brief, codeFont, deleteSlots],
  );
  // Every tactic the step cut (hover-bar ◌) is offered on. Computed in one
  // pass per base tree: the test walks a subtree, so asking it per drawn node
  // per render would be cubic.
  const elidableIds = useMemo(() => stepElidable(baseNodes), [baseNodes]);
  // Its complement on CLOSING tactics: the same ◌, folding the consumed goal
  // instead of cutting (see leafFoldTargets — one box for one ghost buys
  // nothing, but "put the finished step away" is still the gesture wanted).
  const leafFoldIds = useMemo(() => leafFoldTargets(baseNodes), [baseNodes]);
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
      const manual = new Set<string>(combineOff);
      for (const c of elideCuts)
        for (const id of resolveCut(c, byId)) manual.add(id);
      cuts = [...elideCuts, ...combineRuns(baseNodes, manual)];
    }
    return applyElisions(baseNodes, cuts);
  }, [baseNodes, elideCuts, combine, combineOff]);
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
        comments:
          commentMode === "hidden"
            ? false
            : commentMode === "instead"
              ? "instead"
              : true,
        commentsHidden: commentsOff,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      treeNodes,
      codeFont,
      reflow,
      forcedReflow,
      overview,
      overviewKeep,
      commentMode,
      commentsOff,
    ],
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
  // The tree the current view state was keyed against. Held as STATE, not a
  // ref, because the branches below run during render (the derived-state
  // pattern) and a ref must not be read there.
  const [prevBase, setPrevBase] = useState(baseNodes);
  if (proofKey !== prevProof) {
    setPrevProof(proofKey);
    setPrevShape(shapeKey);
    setPrevBase(baseNodes);
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
    setMarquee(null);
    setSelection(null);
    setFlagPrompt(null);
    setClickAccent(null);
    setCombineOff(new Set());
    setCommentsOff(new Set());
    // A different proof's splits are different nodes entirely. (A same-proof
    // EDIT remaps the keys instead — see the shape branch; no pruning either
    // way: `pick` is read modulo the live child count, and keys naming a
    // vanished split are simply never looked up.)
    setPick({});
  } else if (shapeKey !== prevShape) {
    setPrevShape(shapeKey);
    setPrevBase(baseNodes);
    // Same proof, edited. Every id held in view state was minted by the PREVIOUS
    // elaboration, and re-elaboration renumbers metavariables — so before asking
    // what is still live, translate ids from the old tree to the new one by
    // TREE POSITION (`remapIds`). Without this the feature below is a demolition
    // crew: editing a theorem EARLIER in the file renumbers every mvarId in this
    // one, not one stored id resolves, and the fold set, the focus, the sequence
    // and every elide cut are silently emptied although nothing here moved.
    //
    // `shapeKey` stays keyed on mvarIds deliberately. It is a change DETECTOR,
    // not an identity: it needs to fire whenever the payload's ids move, which
    // is exactly when this remap has work to do. The identity is `remapIds`.
    const remap = remapIds(prevBase, baseNodes);
    const to = (id: string) => remap.get(id) ?? id;
    // Then drop what genuinely vanished: a collapsed id with nothing behind it
    // would linger forever, and a focus root or sequence endpoint that went
    // would scope the view to nothing.
    const live = new Set<string>();
    for (const st of proof.steps) {
      live.add(st.goalBefore.id);
      live.add(tacticId(st.goalBefore.id));
      for (const g of stepGoalsAfter(st)) live.add(g.id);
    }
    // One remap-prune for every id SET in view state (the fold set, the
    // un-combine exclusions, the hidden strips): translate, drop dead ids,
    // and preserve Set identity when nothing changed so downstream memos
    // don't rebuild for a no-op.
    const remapSet = (prev: Set<string>): Set<string> => {
      const next = new Set([...prev].map(to).filter((id) => live.has(id)));
      return next.size === prev.size && [...prev].every((id) => next.has(id))
        ? prev
        : next;
    };
    setCollapsed(remapSet);
    if (focusId) {
      const moved = to(focusId);
      if (!live.has(moved)) setFocusId(null);
      else if (moved !== focusId) setFocusId(moved);
    }
    if (seq.mode === "pick" && seq.from) {
      const moved = to(seq.from);
      if (!live.has(moved)) setSeq({ mode: "off" });
      else if (moved !== seq.from) setSeq({ ...seq, from: moved });
    } else if (seq.mode === "view") {
      const from = to(seq.from);
      const dest = to(seq.to);
      if (!live.has(from) || !live.has(dest)) setSeq({ mode: "off" });
      else if (from !== seq.from || dest !== seq.to)
        setSeq({ ...seq, from, to: dest });
    }
    // Cuts key on ORIGINAL node ids, so they need the same translation before
    // the prune can tell "this node is gone" from "this node was renumbered".
    setElideCuts((cs) =>
      pruneCuts(
        baseNodes,
        cs.map((c) => remapCut(c, to)),
      ),
    );
    // The gallery's picks key on the SPLITTING node's id (see `splits`), so
    // without the translation any edit snapped every hand-paged branch back
    // to child 0. No liveness filter needed: `pick` is read modulo the live
    // child count, and a key naming a vanished split is never looked up.
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
    // A half-made path/band pick holds a first endpoint by id too. Translate
    // it like the sequence endpoint above; if it genuinely vanished, drop the
    // endpoint but stay in picking mode — the mode is what the user opted
    // into, the endpoint is just the click to redo.
    if (elidePick?.from) {
      const moved = to(elidePick.from);
      if (!live.has(moved)) setElidePick({ from: null });
      else if (moved !== elidePick.from) setElidePick({ from: moved });
    }
    if (bandPick?.from) {
      const moved = to(bandPick.from);
      if (!live.has(moved)) setBandPick({ from: null });
      else if (moved !== bandPick.from) setBandPick({ from: moved });
    }
    // The click's accent stand-in is an mvarId like the rest, so it gets the
    // same translation — a re-parse renumbers ids, and an untranslated one
    // would silently accent nothing (or, worse, whatever inherited the id).
    if (clickAccent) {
      const moved = to(clickAccent);
      setClickAccent(live.has(moved) ? moved : null);
    }
    // The marquee selection is an id set like `collapsed`; same translation,
    // and an emptied selection dissolves rather than lingering as a pill over
    // nothing. (Marker ids in the selection have no base counterpart and are
    // dropped — the marker itself was re-derived by the same edit.)
    setSelection((prev) => {
      if (!prev) return prev;
      const next = new Set([...prev].map(to).filter((id) => live.has(id)));
      return next.size > 0 ? next : null;
    });
    // The un-combine exclusions and the individually hidden strips are base
    // ids like `collapsed`: same translation, same liveness prune. Without it,
    // editing an EARLIER theorem renumbers every mvarId here and the strips
    // you hid would all come back although nothing in this proof moved (the
    // remapIds lesson, measured at 0/10 surviving by id).
    setCombineOff(remapSet);
    setCommentsOff(remapSet);
    // The prose prompt anchors on a head tactic by id; follow it or drop it.
    if (flagPrompt) {
      const moved = to(flagPrompt.headId);
      if (!live.has(moved)) setFlagPrompt(null);
      else if (moved !== flagPrompt.headId)
        setFlagPrompt({ ...flagPrompt, headId: moved });
    }
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
    // moved under them — exactly what must not be committed blind. The
    // selection pill's armed `unflag` holds patches for the same reason and
    // must go with it.
    setArming(null);
    setPendingVerb(null);
  }
  // TRUE in the very render where the two branches above are re-keying view
  // state, and it has to be read by anything that asks "is this node DRAWN?"
  // during render. The memos below were built from the state as it stood BEFORE
  // those writes, so in this pass `elideCuts` still holds the PREVIOUS
  // elaboration's ids: they resolve to nothing against the new base tree, every
  // ghost's members come back as ordinary nodes, and `nodes` describes a tree
  // that will never be committed. Cost of ignoring it, measured on the cf seek
  // below: the stub looked drawn in this pass, so the seek latched itself as
  // satisfied and the render that actually re-elided it never ran the reveal.
  const rekeying = proofKey !== prevProof || shapeKey !== prevShape;

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
  // which restores them on a click. What each flag asks for is `sourceView`'s
  // business (elide.ts), shared with the ⌥-⊞ reset so the two cannot drift.
  //
  // The empty writes are SKIPPED here and not in the reset: this runs in the
  // same render as the proof-change branch above, which has already emptied
  // both, so writing them again would only cost a render.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (seededFor !== proofKey) {
    setSeededFor(proofKey);
    const { folds, cuts } = sourceView(baseNodes);
    if (folds.length > 0) setCollapsed(new Set(folds));
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
  const { delExtents, delSpecs } = useMemo(() => {
    const delExtents = new Map<string, DeleteExtent | null>();
    // A COMBINED node carries no deleteSpec of its own (it is a marker), so
    // its spec is synthesized here — the union of its member tactics' — and
    // kept for the arming click, which needs the same spec the extent showed.
    const delSpecs = new Map<string, DeleteSpec>();
    if (!deleteSlots || !onDeleteTactic) return { delExtents, delSpecs };
    // Lazily built: combined nodes exist only with ⇉ on, and the common
    // no-combine relayout shouldn't pay an O(n) map for them.
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
        // `combineMemberIds` decodes the marker id, which SORTS ids as
        // strings — put the anchors back in source order, since deleteExtent
        // measures from anchors[0] (its prevSameLine decline reads that slot).
        anchors.sort((a, b) => cmpPos(a.start, b.start));
        const spec: DeleteSpec = { kind: "tactic", anchors, comments };
        delSpecs.set(n.data.id, spec);
        delExtents.set(n.data.id, deleteExtent(spec, deleteSlots));
      } else if (n.data.deleteSpec && !n.data.synthetic)
        delExtents.set(n.data.id, deleteExtent(n.data.deleteSpec, deleteSlots));
    }
    return { delExtents, delSpecs };
  }, [nodes, baseNodes, deleteSlots, onDeleteTactic]);
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
    // The real cursor has arrived, so the click's stand-in has done its job
    // and the position is authoritative again — including when the two
    // disagree, which is the point of handing it back.
    setClickAccent(null);
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

  // The comment block a node's strip can EDIT: its range in the document and
  // its verbatim text, delimiters included. The client never holds document
  // text and the strip's display string is LOSSY (`--` stripped, markdown
  // cleaned, soft-wraps joined), so the editor's original is reconstructed
  // from `proof.comments` — joined back through `commentRanges` by start, the
  // `removeFlagPatches`/`commentOwner` join. Several comments edit as ONE
  // block only when they sit on strictly consecutive lines (the reconstruction
  // `text + "\n" + indent` is exact there and only there — a blank line
  // between comments would be invented text); otherwise the FIRST comment
  // alone is offered, honest if less complete.
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
    // The block's COMMON indent, stripped for display and re-applied on
    // commit. The edit range starts AT the first comment's `--`, so that
    // line's own indent is outside the range and never drawn; giving the
    // continuations their ABSOLUTE column (as this did) therefore rendered
    // two source-aligned `--` lines as a flush line followed by an indented
    // one — an indent the author never wrote, and read as theirs. Only the
    // joins between separate comments are ours to normalize: a single
    // `/- … -/` block's interior newlines are INSIDE the range and stay
    // verbatim. Relative indent between continuations is preserved (the min,
    // not the first), so a deliberately stepped block still reads as stepped.
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
    // The clicked node stands in until the cursor actually gets there (see
    // clickAccent). It is a drawn TACTIC by construction — set only from the
    // reveal paths, and cleared by the proof/shape resets like every other id.
    if (clickAccent) return clickAccent;
    if (hlKey === "" || !highlightPos) return null;
    const ci = commentSpans.findIndex((c) =>
      positionContains(c, highlightPos),
    );
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

  // Anchor a relayout on a node that REPLACES another: capture the current
  // node's position but key the anchor to the id the successor will carry —
  // an elide marker's cutId when a cut is committed, or the topmost member a
  // removed cut restores. Without this, elide/un-elide fell to the
  // viewport-centre fallback, which can never pair tactic↔marker (the marker
  // has no position, so their keys differ) and so scrolled arbitrarily —
  // measured at +1226px on restoring a first-tactic cut, the restored node a
  // full viewport off screen. Keyed by idKey: the successor is not in the
  // current layout, so it has no posKey to read, and elide/un-elide is a pure
  // client transform over the same baseNodes, so ids are stable across it (a
  // concurrent re-parse just falls through to the fallback, same as before).
  const anchorAs = (currentId: string, nextId: string) => {
    const cur = nodes.find((n) => n.data.id === currentId);
    if (cur)
      anchorRef.current = { id: nextId, key: `I${nextId}`, x: cur.x, y: cur.y };
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

  // One overlay, one cache: a different node (or the overlay closing) starts
  // clean, which is also the invalidation story — the environment cannot
  // change under a draft without the overlay closing first. (Module scope,
  // not a ref — see `globalNameCache`'s comment for the taint rationale.)
  const editedNodeId = editing?.id ?? null;
  useEffect(() => {
    globalNameCache.clear();
  }, [editedNodeId]);
  // The fetch pipeline runs through STATE, not refs (see `globalNameCache`'s
  // comment): `globalWant` is the query the handlers ask for; its effect owns
  // the debounce timer (cleanup IS the debounce) and the fetch; a resolution
  // lands in `globalArrival`, whose effect replays the refresh.
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
        .catch(() => {
          // A dropped session or cancelled request: the local tiers are
          // already on screen, so there is nothing to repair.
        });
    }, GLOBAL_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [globalWant, fetchGlobalNames]);

  /** Recompute the list from the textarea's current value and caret. */
  const refreshCompletion = (nodeId: string, value: string, caret: number) => {
    const ident = identPrefixAt(value, caret);
    let globals: string[] | undefined;
    if (fetchGlobalNames && ident.length >= MIN_GLOBAL_PREFIX) {
      const hit = cachedGlobals(ident);
      if (hit) globals = hit;
      // The scan is ~100-200ms on a Mathlib environment — real but affordable
      // once per settled prefix (the want-effect's debounce), not per
      // keystroke. On a hit, no fetch: the cached answer narrows locally.
      setGlobalWant(hit ? null : ident);
    } else {
      setGlobalWant(null);
    }
    const pools = { ...candidatesFor(nodeId), globals };
    const items = completionsAt(value, caret, pools);
    setCompletion(items.length > 0 ? { items, index: 0 } : null);
  };

  // The replay: a resolved fetch re-runs the refresh against the textarea's
  // LIVE value and caret — the DOM walk is the established route to the
  // overlay's textarea (see the abbreviation emit) — with the stale guard: a
  // response whose query no longer prefixes what is typed changes nothing.
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
    // refreshCompletion is a fresh closure every render; keying on it would
    // re-run this per render. The arrival object is the one real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalArrival]);

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

  // ⌥-⊞ — back to the view the SOURCE asks for: `.fold` folded again, `.none`
  // ghosted again, everything a reading session accumulated dropped. Plain ⊞
  // is the opposite end (nothing hidden at all), so the two together make the
  // flags reachable in BOTH directions without touching the file. That is what
  // the seed's "a starting view, not a lock" promise was missing: undoing a
  // directive by hand has always been one click, and there was no way back —
  // ⊞ itself throws the `.none` ghosts away, so the reader who opened one to
  // check it could not put the author's reading back.
  //
  // Writes UNCONDITIONALLY, unlike the seed's `length > 0` guards. On an
  // unflagged proof "as the source asks" IS nothing folded and nothing cut,
  // and that empty write is the entire gesture there; skipping it would leave
  // the reader's own folds standing and make ⌥-⊞ silently do nothing.
  const resetToSource = () => {
    anchorRoot();
    const { folds, cuts } = sourceView(baseNodes);
    setCollapsed(new Set(folds));
    setElideCuts(cuts);
    // The rest of what "this proof, as opened" means, mirroring the
    // proof-change reset above minus the things that aren't this proof's
    // state. The SCOPING modes go (focus and sequence hide the rest of the
    // proof, which no source flag asked for), the per-node exceptions to a
    // rail setting go, the gallery's branch picks go, and every transient
    // holding ids or ranges is dismissed — an armed delete or a half-made
    // pick pointing into a tree that just moved is exactly what must not
    // survive.
    setFocusId(null);
    setSeq({ mode: "off" });
    setCombineOff(new Set());
    setCommentsOff(new Set());
    setPick({});
    setSelection(null);
    setElidePick(null);
    setBandPick(null);
    setMarquee(null);
    setPicking(null);
    setArming(null);
    setFlagPrompt(null);
    // The clicked accent can name a node that is inside a ghost again; drop it
    // and let the cursor's own position be authoritative (see clickAccent).
    setClickAccent(null);
    // Deliberately NOT reset: zoom, and every rail toggle (layout, ⋯ brief,
    // ¶ reflow, `--` comments, ⇉ combine, ⇅ accordion, ❮❯ gallery). Those are
    // how this reader likes to read, not the state of this proof — and a
    // gesture on the fold button has no business changing them. An open edit
    // box and a pending calc fill stay too: they hold text the author typed,
    // which a VIEW reset must not discard.
    //
    // Zoom's asymmetry with the proof-change reset (which DOES restore 1) is
    // deliberate, not an oversight, and the wording above is what made it look
    // like one: the rule is not "zoom is a reader preference" flat out. A zoom
    // reached through ⛶ is fitted to ONE proof's width, so carrying it to a
    // different theorem carries a number computed for something else — while
    // within a proof, which is all this reset covers, the width has not
    // changed and the number still means what the reader meant by it.
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
    // The marker takes `from`'s slot (the path's ancestor is its topmost
    // member), so hold it at `from`'s y — see anchorAs.
    anchorAs(cut.from, cutId(cut));
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
    const cut: ElideCut = { kind: "band", ids: [...ids] };
    // Hold the marker at the band's topmost visible element — the min-y pick.
    // Band mode exists only in compact stacked, where y-order ≡ preorder, so
    // that pick's slot is where the marker is emitted (see anchorAs).
    anchorAs(pa.y <= pb.y ? a : b, cutId(cut));
    setElideCuts((cs) => [...cs.filter((c) => !absorbed.has(cutId(c))), cut]);
    return true;
  };

  // Commit one step cut with its anchor: hold the incoming ghost at the
  // tactic's y (the marker takes the tactic's own DFS slot, so the pair is
  // exact — and the pointer stays on the ghost, where the restore click is).
  // Shared by the hover bar's ◌ and the ⌥-click fast path.
  const elideStep = (id: string) => {
    setElidePreview(null);
    anchorAs(id, cutId({ kind: "step", id }));
    setElideCuts((cs) => [...cs, { kind: "step", id }]);
  };

  /** What a ◌ on `id` would take away, for the hover preview.
   *
   * Resolved against `treeNodes` (post-elision) rather than `baseNodes`, even
   * though the COMMIT works on base ids: a cut nested inside this one is a
   * ghost NODE here and a set of base members there, so basing the preview on
   * the drawn tree is what lets an existing ghost fade along with everything
   * around it. The two agree about the region either way — `disjointCuts`
   * drops the inner cut when the bigger one lands.
   *
   * Two gestures take exactly the box you are pointing at and nothing else —
   * a LEAF's ◌ folds its goal (see leafFoldTargets), a COMBINED run's swaps
   * one marker for another — so both are the anchor alone. Since the anchor
   * never dims, the preview shows nothing fading, which is the truth: the
   * absence IS the answer, not a missing feature. (A combined run's own
   * members are base ids that no drawn node carries, so asking for them here
   * would compute a set that can never match.) */
  const elideExtentIds = (
    id: string,
    combined: boolean,
    leaf: boolean,
  ): Set<string> => {
    if (leaf || combined) return new Set([id]);
    const byId = new Map(treeNodes.map((n) => [n.id, n]));
    return new Set(resolveCut({ kind: "step", id }, byId));
  };

  /** The ◌/⌥-elide GATE for a drawn node — null where the gesture is not
   * offered. ONE coding, read directly by the render loop (whose button,
   * click routing and titles also need `combined`/`leafFold`, hence the
   * shape) and, through `elidePreviewFor` below, by every fade surface — so
   * no surface can disagree with another about where the gesture exists. */
  const elideGateOf = (
    d: (typeof treeNodes)[number],
  ): { combined: boolean; leafFold: string | undefined } | null => {
    if (seq.mode !== "off" || elidePick || bandPick) return null;
    if (d.type !== "tactic" || d.synthetic) return null;
    const combined = !!d.elidedCut?.combined;
    if (d.elidedCut && !combined) return null; // an elide marker
    const leafFold = combined ? undefined : leafFoldIds.get(d.id);
    if (!(combined || elidableIds.has(d.id) || leafFold !== undefined))
      return null;
    return { combined, leafFold };
  };

  /** The elide-preview for `id`, or null where the gesture is not offered —
   * the one door to the fade for EVERY surface that shows it: the
   * Alt-keydown listener below, and the ⌥-mousemove branch and the bar's ◌
   * hover in the render loop. (The loop's own `elidable` reads `elideGateOf`
   * directly — it runs per node per render, and this helper pays a find per
   * event.) */
  const elidePreviewFor = (
    id: string,
  ): { anchor: string; ids: Set<string>; self: boolean } | null => {
    const d = treeNodes.find((n) => n.id === id);
    const g = d ? elideGateOf(d) : null;
    if (!g) return null;
    return {
      anchor: id,
      ids: elideExtentIds(id, g.combined, g.leafFold !== undefined),
      // A CLOSING tactic's ⌥-click folds the goal above instead of eliding,
      // and the box that disappears is this one. Nothing else fades, so
      // without this the gesture that behaves differently on 78 of the
      // corpus's 204 tactics previewed as doing nothing at all — and there is
      // no glyph on a bare modifier to explain the substitution.
      //
      // Only the ⌥ path may act on it (see the render's opacity): the bar's ◌
      // lives INSIDE the node's own <g>, so fading the anchor there would fade
      // the button under the pointer, which reads as disabled. That is the
      // whole reason for the anchor-never-fades rule, and it does not apply
      // where there is no button under the pointer.
      self: g.leafFold !== undefined,
    };
  };

  // ⌥ pressed or released while the pointer RESTS on a tactic. The pointer
  // paths ride mouse events, which a modifier change over a motionless
  // pointer never sends — the recorded "move a pixel" blind spot, reported as
  // a real bug once the preview existed. Key events are the only signal for
  // it, with the known limit that a webview receives keys only while it has
  // FOCUS (clicking the tree grants it; while the caret sits in the editor
  // the pointer paths remain the working pair). The DOWN handler reads latest
  // state through a ref written by a per-render effect (the candidateRef
  // pattern), so the document listeners register once instead of churning per
  // render — the clear needs no ref, being a pure functional update that
  // closes over nothing. The keydown guards `repeat`: Alt autorepeats, and
  // each unguarded fire would build a fresh Set and re-render a settled
  // preview.
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
    // A webview losing focus mid-press never sees the keyup (the rail's
    // glyph-swap rule): clear rather than strand a fade.
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    window.addEventListener("blur", clearAlt);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
      window.removeEventListener("blur", clearAlt);
    };
  }, []);

  // The combined-run analogue: a COMBINED node stands for several base
  // tactics, so its ◌ commits a BAND cut over exactly the member ids its own
  // id encodes (boundary goals stay; the run collapses to one ◌ marker).
  // Exactly what `elideSelection` does for a swept combined node — dissolve
  // to members, absorb a same-id manual cut, anchor at the marker — so it IS
  // that, with a one-node selection.
  const elideCombined = (id: string) => {
    elideSelection(new Set([id]));
  };

  // ----- The marquee selection's verbs -------------------------------------

  /** Apply a gesture's document patches through the ordinary edit hook,
   * BOTTOM-UP: each patch's coordinates were computed against the original
   * document, and an insertion shifts only the lines below itself, so
   * applying from the lowest up keeps every remaining range valid. */
  const applyPatches = (patches: DocPatch[]) => {
    const ordered = [...patches].sort((a, b) =>
      a.start.line !== b.start.line
        ? b.start.line - a.start.line
        : b.start.character - a.start.character,
    );
    for (const p of ordered)
      onEditTactic!({ start: p.start, stop: p.stop }, p.text);
  };

  /** Topmost of `ids` in base DFS preorder — the member whose slot the
   * marker occupies (applyElisions' slotOf), i.e. the node to pair with the
   * marker for scroll-identity anchoring. Null on an empty list; ids must be
   * base ids. THE one coding of this pick — the elide commit, the marker's
   * removal and the un-combine verb all anchor through it. */
  const topMemberOf = (ids: readonly string[]): string | null => {
    if (ids.length === 0) return null;
    const index = new Map(baseNodes.map((n, i) => [n.id, i]));
    return ids.reduce((a, b) =>
      (index.get(a) ?? Infinity) <= (index.get(b) ?? Infinity) ? a : b,
    );
  };

  /** Elide the selection to one marker — the ⇳ band cut with the marquee as
   * its picker, which is what frees it from the y-interval definition and
   * lets it work in every layout. Markers caught in the selection are
   * absorbed exactly as commitBand absorbs them; a swept-up COMBINED node
   * dissolves to the member ids its own id encodes. */
  const elideSelection = (sel: Set<string>): boolean => {
    const byId = new Map(baseNodes.map((n) => [n.id, n]));
    const ids = new Set<string>();
    const absorbed = new Set<string>();
    for (const pn of nodes) {
      if (!sel.has(pn.data.id)) continue;
      const members = combineMemberIds(pn.data.id);
      if (pn.data.elidedCut && !pn.data.elidedCut.combined) {
        absorbed.add(pn.data.id);
        const cut = elideCuts.find((c) => cutId(c) === pn.data.id);
        if (cut) for (const pid of resolveCut(cut, byId)) ids.add(pid);
      } else if (members) {
        // A ⇉-made combined node: the auto run dissolves into the cut. (A
        // MANUAL combine cut shares the id format, so absorb its cut too.)
        absorbed.add(pn.data.id);
        for (const pid of members) if (byId.has(pid)) ids.add(pid);
      } else if (byId.has(pn.data.id)) {
        ids.add(pn.data.id);
      }
    }
    if (ids.size === 0) return false;
    const cut: ElideCut = { kind: "band", ids: [...ids] };
    // Hold the marker at its slot: topmost member in base preorder, anchored
    // from that node's own placed position when it is drawn, else from the
    // topmost selected node (its current representative).
    const top = topMemberOf([...ids])!;
    const topPlaced =
      nodes.find((p) => p.data.id === top) ??
      nodes
        .filter((p) => sel.has(p.data.id))
        .reduce((a, b) => (a.y <= b.y ? a : b));
    anchorAs(topPlaced.data.id, cutId(cut));
    setElideCuts((cs) => [...cs.filter((c) => !absorbed.has(cutId(c))), cut]);
    return true;
  };

  /** The goals a `.fold` on this tactic folds — mirroring what the WRITTEN
   * flag will seed on the next load, which depends on where the comment
   * attributes (measured in the offline probe): above the proof's FIRST
   * tactic it lands on the ROOT narrative slot, whose targets are the tactic
   * node itself; anywhere else it lands on the tactic, whose targets are its
   * spawned goals when any, else produced. The local mirror must match, or
   * the fold visibly changes shape on the next reload. */
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

  /** Commit the prose prompt: write the flag comment above the head, and for
   * `.none` also apply the step cut NOW with the prose as the ghost's note —
   * the seed block only fires on a proof change, so the written flag alone
   * would not act until the next load. An empty annotation is a cancel; an
   * empty `.none` writes the bare directive (legal — the ghost keeps its
   * tactic preview). */
  const commitFlagPrompt = (value: string) => {
    const p = flagPrompt;
    setFlagPrompt(null);
    if (!p) return;
    const head = baseNodes.find((n) => n.id === p.headId);
    const prose = value.replace(/\s*\n\s*/g, " ").trim();
    if (!head || (p.kind === "note" && prose === "")) return;
    // A CLOSING tactic can only be cut by a NOTED `.none` (elide.ts's
    // `allowLeaf`: without prose the ghost would just restate the label it
    // replaced). So a bare `.none` there is a directive both this apply and
    // the next load's seed resolve to nothing — treat the empty commit as a
    // cancel rather than leaving dead text in the author's proof. Everywhere
    // else an empty `.none` stays legal, and the ghost keeps its preview.
    if (p.kind === "none" && prose === "" && !elidableIds.has(head.id)) return;
    const directive = p.kind === "none" ? `.none${prose ? ` ${prose}` : ""}` : prose;
    const patch = flagLine(head, deleteSlots ?? [], directive);
    if (!patch) return;
    applyPatches([patch]);
    if (p.kind === "none") {
      anchorAs(head.id, cutId({ kind: "step", id: head.id }));
      setElideCuts((cs) => [
        ...cs,
        { kind: "step", id: head.id, note: prose || undefined },
      ]);
    }
  };

  // A node click means different things per mode: fold/unfold in the tree, pick
  // a sequence endpoint, pick an elide endpoint, or (on a run marker) un-elide.
  // Picking the second endpoint orders the pair by ancestry (whichever is the
  // ancestor becomes the chain's top); two unrelated nodes can't form a path,
  // so we just restart the selection from the latest.
  const onNodeClick = (id: string, canFold: boolean) => {
    // An elision marker: click removes its cut (matched by the marker's id =
    // the cut's id). Works in any mode, so an elision is always one click from
    // being undone.
    // (A COMBINED node is not one of these — it's automatic, driven by the
    // toggle rather than a stored cut; its click is a tactic's, handled in
    // the seq.mode === "off" branch below.)
    const clicked = nodes.find((n) => n.data.id === id)?.data;
    if (clicked?.elidedCut && !clicked.elidedCut.combined) {
      // Hold the restored subtree's head at the marker's y: the marker sat in
      // its topmost member's DFS slot (applyElisions' slotOf), so anchor that
      // member — for a step cut, the tactic itself. Paired with the commit's
      // anchorAs, collapse→expand is scroll-identity: the two shifts are
      // exact negatives.
      const cut = elideCuts.find((c) => cutId(c) === id);
      if (cut) {
        const byId = new Map(baseNodes.map((n) => [n.id, n]));
        const top = topMemberOf(resolveCut(cut, byId));
        if (top) anchorAs(id, top);
      }
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
      // `canFold` is the nodes loop's fold gate — false on a COMBINED node,
      // whose gestures are a tactic's and which must never fold.
      if (canFold) toggle(id);
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
    // Where the view ACTUALLY sits, reconciled against the recorded scroll.
    // The live value is ground truth — `lastScrollRef` goes stale whenever a
    // programmatic scroll lands between commits and its scroll event is late
    // or never delivered (animateScroll's eased writes; hidden webviews fire
    // no scroll events at all). Measured in the payload replay: cursor-follow
    // at 3523, ref still 975, and every counterfactual swap "restored" 975 —
    // the reported flash to the top of the proof while typing. The ref's ONE
    // legitimate job is the case it was introduced for: a SHORTER new layout
    // has already clamped `el.scrollTop` by the time this effect reads it,
    // and that case is detectable — the live value sits pinned at the new
    // maximum, below the recorded value. Only then does the record win.
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
    // Screen-space y of a node's OLD content y, against the reconciled
    // scroll. ONE coding for this effect: CLAUDE.md records the bare formula
    // hand-rolled wrong once already (the combine anchor's screenful bias),
    // and it was up to four copies here before this helper.
    const screenYOf = (y: number) => (MARGIN.top + PAD_Y + y) * zoom - sy;

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

    // The CURSOR'S chain, when its head was ON SCREEN in the layout being
    // replaced, beats the viewport-centre guess below: it is where the user
    // is WORKING — the buffer's caret, the node the accent marks — and a swap
    // landing mid-edit must leave the view focused there, not on whatever
    // happened to sit nearest the centre. ONE walk covers both cases: the
    // head SURVIVING is simply the loop's first hit (anchored at its old
    // spot), and a head this edit DELETED falls through to the nearest
    // surviving ANCESTOR — the tactic it hung under (see the note above). The
    // on-screen gate is load-bearing in both directions: a cursor parked in a
    // proof you are not currently looking at must not yank the view back to
    // itself. `refocus` rides along so a swap that would leave the anchor
    // outside the comfort band (a clamp, growth above it, a vanished subtree)
    // pulls it back in.
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
      // Nearest to the old viewport's vertical centre AMONG nodes that
      // survived — one with no previous position has no movement to measure.
      // The comparison must be in SCROLL space, so the content offset the SVG
      // is drawn at (MARGIN.top + PAD_Y — and PAD_Y is a whole viewport) has to
      // be added to the node's content y. Omitting it biased the pick by ~a
      // screenful, so the "centre" node was one well above the viewport; the
      // shift below was still correct (a difference cancels the constant), so
      // it merely held the WRONG node steady.
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
        // inkExtent, the same rule inViewScroll uses — this mirrors that test
        // deliberately, so it must not be a second hand-rolled coding of it.
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
  // The signature header's box is MEASURED rather than derived from its line
  // count: it wraps, so the count is not the number of drawn lines at any
  // given width. Same shape as `useFrameOffset` — a ResizeObserver plus an
  // explicit mount read, because RO delivery rides rendering steps and a
  // hidden webview runs none. The WIDTH comes off the same callback and the
  // focus pill's label length is cut from it (below), so one observer answers
  // both questions and they cannot disagree.
  const hdrRef = useRef<HTMLDivElement | null>(null);
  const [hdrH, setHdrH] = useState(0);
  const [hdrW, setHdrW] = useState(0);
  // The header shows ONE line at rest and the whole statement on hover — and
  // the expansion is an OVERLAY, not a taller bar: `hdrH` is what every
  // floater and the scroll box offset by, so letting it grow would push the
  // proof down the moment the pointer crossed the top of the panel, which is
  // the view-stability complaint in miniature. The measurement is therefore
  // frozen while expanded — the observer is simply not subscribed, so the
  // collapsed values stand and the effect re-measures on the way back down.
  const [hdrOpen, setHdrOpen] = useState(false);
  useLayoutEffect(() => {
    const el = hdrRef.current;
    if (!el) {
      setHdrH(0);
      return;
    }
    if (hdrOpen) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      // 1px hysteresis, the frame-offset rule: sub-pixel reflow must not
      // re-render the whole view.
      setHdrH((prev) => (Math.abs(prev - r.height) > 1 ? r.height : prev));
      setHdrW((prev) => (Math.abs(prev - r.width) > 1 ? r.width : prev));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [declHeader, hdrOpen]);
  // The focus root, for the breadcrumb pill's label. Read from `allNodes()`
  // rather than the drawn `nodes` because folding the root itself must not
  // make the way OUT of focus disappear — the whole point of the pill.
  // What the focus pill SAYS. A case tag first — `succ`, `refine_1`, `left`
  // is what the tree already badges the branch with, it is short, it is stable
  // across re-elaboration, and it is what actually tells sibling goals apart.
  // A goal's own text does not: siblings share a prefix and diverge late,
  // which is exactly why a head-truncated formula read as "⊢ ∑ i ∈ Finset.ra…"
  // for every branch of the same proof. Unnamed goals therefore fall back to
  // the goal text truncated from the TAIL, keeping the turnstile and the end.
  const focusNode = useMemo(
    () =>
      focusId ? (engine.allNodes().find((n) => n.id === focusId) ?? null) : null,
    [engine, focusId],
  );
  // What the statement collapses to while focused: keyword + name, cut at a
  // known point rather than by a clip (a clip cuts at whatever width is left,
  // which on a long binder list ate the name — the only part that identifies
  // the theorem). ONE definition, because the pill's label length is measured
  // from it and a second copy would let the two disagree about the width.
  const declHead = useMemo(
    () =>
      (declHeader ?? "").trimStart().split(/\s+/).slice(0, 2).join(" ") + " …",
    [declHeader],
  );
  const focusLabel = useMemo(() => {
    if (!focusNode) return "focused";
    if (focusNode.caseLabel) return focusNode.caseLabel;
    const raw = focusNode.label ?? "focused";
    // Tail truncation: keep the turnstile, then the END. Sibling goals share a
    // prefix, so cutting the head throws away the only distinguishing part —
    // the whole reason the head-cut version read the same for every branch.
    const body = raw.startsWith(TURNSTILE) ? raw.slice(TURNSTILE.length) : raw;
    // The cut is taken from the MEASURED bar, not a constant — a fixed 34 left
    // most of a wide panel empty and overflowed a narrow one. What is left for
    // the label is the bar minus the collapsed statement (measured in the same
    // font, so this is exact rather than a guess) and the fixed chrome: the
    // rail gutter, the bar's padding, the `›`, and the pill's own `◎ ✕` and
    // padding. Erring SHORT is the safe direction and costs nothing — the
    // slack goes to the statement, which then draws in full instead of being
    // squeezed. Erring long is what must not happen: the CSS ellipsis takes
    // over and it cuts the TAIL, the half this truncation exists to keep.
    const cell = measureText("M", NODE_FONT_PX) || 7.2;
    const PILL_CHROME = 120;
    const room = hdrW - measureText(declHead, NODE_FONT_PX) - PILL_CHROME;
    const MAX = Math.max(16, Math.floor(room / cell));
    return body.length <= MAX
      ? raw
      : `${TURNSTILE}…${body.slice(body.length - (MAX - 1))}`;
    // No `codeFont` dep: a font change resizes the bar, so the observer's
    // `hdrW` moves with it and re-cuts this.
  }, [focusNode, hdrW, declHead]);

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
  // The counterfactual no longer takes a row (its banner is gone — see the
  // render), so the slot is dropped rather than left reserved: a `false` here
  // would still be right, but an entry nothing draws invites the next reader
  // to "fix" the missing floater.
  // Focus is no longer a row: it rides the signature header as the trail's
  // second segment. The rows left are the caller's slot and the hints.
  const floaterRows = [!!headerExtra, hintUp];
  const floaterTop = (row: number) =>
    8 + hdrH + FLOATER_H * floaterRows.slice(0, row).filter(Boolean).length;

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
      (MARGIN.top + PAD_Y + root.y - inkExtent(root.data).up) * zoom -
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

  // A REVEAL owes a view move: the node was named, the unfold, the un-elide and
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
  //
  // TWO callers now: the diagnostic pager, and the counterfactual stub seek
  // below. Both are "the tree must take me to THIS node", so they share one
  // request slot — whichever spoke last owns the view, the same bargain
  // `followAnim` already makes between the follow and the pager.
  const [seek, setSeek] = useState<{ id: string } | null>(null);
  const sought = useRef<{ id: string } | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !seek || sought.current === seek) return;
    const node = nodes.find((n) => n.data.id === seek.id);
    if (!node) return;
    sought.current = seek;
    const { left, top } = inViewScroll(el, node, zoom, PAD_X, PAD_Y, compact);
    if (left !== el.scrollLeft || top !== el.scrollTop)
      animateScroll(followAnim.current, el, left, top);
  }, [seek, nodes, zoom, PAD_X, PAD_Y, compact]);

  // Go to a node: undo whatever hides it, page the gallery to it, then scroll it
  // into view once the relayout lands. Unfolding walks the FIRST parent chain,
  // which is enough — `computeLayout` hides a node only when ALL its parents are
  // collapsed or hidden.
  //
  // An ELIDE CUT is the other way to be hidden, and it has to be undone HERE
  // rather than by unfolding: a cut lifts its members out of the tree BEFORE the
  // engine sees them (`applyElisions` over `baseNodes`), so a cut node is not in
  // `engine.allNodes()` at all and no amount of unfolding reaches it. Only the
  // ONE cut containing the target is dropped, anchored like a click on its ghost
  // (`anchorAs`) so the restored subtree's head lands where the ghost sat.
  //
  // `unhide` is the half that is safe to run REPEATEDLY and from RENDER (the cf
  // seek below does both): every write it makes is conditional on there being
  // something to undo, so once the node is reachable it is a pure no-op — which
  // is what stops a render-phase caller from looping. `setSeek` is deliberately
  // NOT in it: that one mints a fresh object every call (asking for the same
  // node twice must move the view twice, for the pager's `‹ ›`), so it belongs
  // to the event-driven entry point alone.
  const unhide = (id: string) => {
    const baseById = new Map(baseNodes.map((n) => [n.id, n]));
    const covering = elideCuts.find((c) =>
      resolveCut(c, baseById).includes(id),
    );
    if (covering) {
      const gid = cutId(covering);
      setElideCuts((cs) => cs.filter((c) => cutId(c) !== gid));
    }
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
  };
  const revealNode = (id: string | null) => {
    if (!id) return; // a diagnostic that belongs to the proof but to no node
    // The ghost's own anchor rule, so an un-elide from here lands where a click
    // on the ghost would: the restored subtree's head at the marker's y.
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

  // THE COUNTERFACTUAL STUB IS SOUGHT, not merely followed. The stub marks where
  // the caret is RIGHT NOW — the tree is drawing a `sorry` in place of the words
  // being typed — so a stub the reader cannot see makes the `✎ writing line N`
  // floater a claim about nothing. Measured on the user's own file
  // (ProofTreeScratch.lean, retyping `ring` on line 92 under the `.none` on line
  // 84): the stub sits INSIDE the seeded ghost, so the overlay found no node and
  // drew nothing at all, while the cursor accent landed on the ghost 955px below
  // the fold — the reported "I'm editing somewhere totally offscreen".
  //
  // Why the cursor follow cannot cover this. It is guarded on the CURSOR key by
  // design (ids renumber per re-parse), and the counterfactual arrives SECONDS
  // after the keystroke that caused it (7.3s on the first splice of a Mathlib
  // file, measured over LSP) — by then the cursor has been still, so the guard
  // is closed and the payload that first contains a stub is never sought. And
  // even when it does fire, the follow deliberately declines a hidden node
  // ("don't fight the user"), which is right for a cursor parked in a folded
  // region and wrong for the one node the reader is writing into.
  //
  // Fires ONCE per stub, keyed on the stub's SOURCE position — not on the draft,
  // which changes per keystroke, and not on the node id, which renumbers per
  // re-elaboration. So entering a counterfactual moves the view at most once and
  // then holds still however long the word takes; leaving one re-arms it.
  //
  // ADJUSTED DURING RENDER, the `galleryFollowed` pattern, not in an effect: the
  // reveal is a state change derived from a prop and the house lint refuses
  // setState in an effect body. It converges because `unhide` writes nothing
  // once there is nothing left to undo — so the pass after the relayout falls
  // through to the seek, and a stub no narrowing will ever draw (sequence mode,
  // a focus scope) simply re-runs a no-op per relayout.
  const cfSeekKey = cfStub
    ? `${cfStub.line}:${cfStub.pos?.line ?? "?"}:${cfStub.pos?.character ?? "?"}`
    : null;
  const [cfSeeked, setCfSeeked] = useState<string | null>(null);
  if (cfSeekKey === null || !cfStub) {
    if (cfSeeked !== null) setCfSeeked(null); // left the cf — re-arm
  } else if (cfSeeked !== cfSeekKey && !rekeying) {
    // Resolved over the BASE nodes: an elided stub is in no other list.
    const id = cfStubNodeId(baseNodes, cfStub);
    if (!id) setCfSeeked(cfSeekKey); // nothing to seek; don't retry per render
    else if (nodes.some((n) => n.data.id === id)) {
      setCfSeeked(cfSeekKey);
      setSeek({ id });
    } else unhide(id);
  }
  /** Step the pager by `d` (wrapping) and go to what it lands on. */
  const stepDiag = (d: number) => {
    if (diagList.length === 0) return;
    const n = (diagIdx + d + diagList.length) % diagList.length;
    setDiagSel(diagList[n].diag.key);
    revealNode(diagList[n].nodeId);
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

  // One dispatcher for the selection pill's verbs, taking DATA rather than
  // closures: react-hooks/refs treats a closure handed to an ordinary call
  // (verbs.push) during render as a render-phase ref read once it reaches
  // anchorAs/anchorOn, while the same closure in a JSX attribute is fine — so
  // the verbs carry precomputed payloads (patches are plain data) and the
  // chip's own onPick calls this by tag.
  //
  // The label and tooltip are NOT here: they live in `VERB_DOC` (gestures.ts),
  // keyed by `doc`, so the help panel and the chip say the same thing and a
  // verb added without documenting it fails the typecheck. `doc` also carries
  // whether the verb WRITES, which is what the pill draws its two classes
  // apart on.
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
  /** One chip of the selection pill, as DATA (see `row`). */
  type PillAct =
    | { do: "run"; verb: SelVerb }
    | { do: "arm"; verb: SelVerb }
    | { do: "confirm" }
    | { do: "cancel" };
  type PillChip = {
    label: string;
    title: string;
    color: string;
    /** Writes to the document ⇒ sits after the ✎ seam. */
    writes: boolean;
    act: PillAct;
  };
  /** The pill's dispatcher — declared at component level like `commitDelete`
  and for the same reason: it reaches `anchorAs`, and a function BUILT during
  render that touches a ref is a render-phase read as far as the lint rule is
  concerned. Called from a JSX attribute, it is fine. */
  const runPillChip = (a: PillAct) => {
    switch (a.do) {
      case "run":
        runSelectionVerb(a.verb);
        break;
      case "arm":
        setPendingVerb(a.verb);
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
        // Two kinds under one verb: a MANUAL combine cut is removed; a
        // ⇉-made run (no stored cut) is excluded from the auto pass via
        // combineOff. Anchor the first marker's topmost member where the
        // marker sat — the un-elide click's scroll-identity pairing.
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
        // Pure view state — the source keeps its prose; this only stops
        // DRAWING it. (Removing the comment is `unflag`'s business, and a
        // very different gesture.) Anchored because the band shrinks or
        // grows under the pointer by the strip's height.
        anchorOn(v.ids[0]);
        setCommentsOff((prev) => {
          const next = new Set(prev);
          if (v.hide) for (const id of v.ids) next.add(id);
          else for (const id of v.ids) next.delete(id);
          return next;
        });
        break;
      case "flagFold":
        // Write the flags AND fold now: the seed block only fires on a proof
        // change, so the written flag alone would not act until next load.
        applyPatches(v.patches);
        anchorOn(v.anchor);
        setCollapsed((prev) => new Set([...prev, ...v.targets]));
        break;
      case "prompt":
        setFlagPrompt({ headId: v.headId, kind: v.prompt });
        break;
      case "patches":
        applyPatches(v.patches);
        break;
      case "unflag":
        applyPatches(v.patches);
        // Mirror the removal in view state now, as the writers mirror their
        // seed — the re-parse only confirms it.
        if (v.elided.length > 0) {
          const gone = new Set(v.elided);
          setElideCuts((cs) =>
            cs.filter((c) => !(c.kind === "step" && gone.has(c.id))),
          );
        }
        if (v.folded.length > 0)
          setCollapsed((prev) => {
            const next = new Set(prev);
            for (const id of v.folded) next.delete(id);
            return next;
          });
        break;
    }
    setSelection(null);
  };

  // The selection pill: one row of verb chips above the selection's bounding
  // box, offering only what THIS set supports. Verbs normalize the set
  // themselves (heads for the flag writers, the run for combine); every
  // commit clears the selection. Straight-line body code building plain
  // data — see runSelectionVerb for why no closures.
  let selectionPillEl: ReactNode = null;
  if (selection && !marquee && !flagPrompt) {
    const selPlaced = nodes.filter((p) => selection.has(p.data.id));
    const byId = new Map(baseNodes.map((n) => [n.id, n]));
    const selBase = new Set([...selection].filter((id) => byId.has(id)));
    const canFlag = !!onEditTactic && !!deleteSlots;
    const slots = deleteSlots ?? [];
    const heads = canFlag ? headTactics(baseNodes, selBase, slots) : [];
    const writable = heads.filter((h) => flagLine(h, slots, ".fold"));
    // What the sweep actually caught, for the verbs that are about one step
    // rather than about a subtree (see `.none…`).
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
    const verbs: SelVerb[] = [];
    if (selPlaced.some((p) => byId.has(p.data.id) || p.data.elidedCut))
      verbs.push({ kind: "elide", doc: "elide" });
    if (runIds)
      verbs.push({ kind: "combine", doc: "combine", ids: runIds });
    // Swept-up COMBINED nodes offer the reverse: dissolve back into their
    // tactics (a manual cut is removed; a ⇉-made run is excluded from the
    // auto pass until ⇉ is toggled off and on).
    const combinedSel = selPlaced
      .filter((p) => p.data.elidedCut?.combined)
      .map((p) => ({
        id: p.data.id,
        members: (combineMemberIds(p.data.id) ?? []).filter((m) =>
          byId.has(m),
        ),
      }))
      .filter((m) => m.members.length > 0);
    if (combinedSel.length > 0)
      verbs.push({
        kind: "uncombine",
        doc: "uncombine",
        markers: combinedSel,
      });
    // Strips of the selected nodes, hidden or shown. Read off `treeNodes`,
    // NOT the placed ones: the engine zeroes a hidden node's commentLines, so
    // asking the drawn node whether it has a comment would make the verb
    // vanish the moment it worked and leave no way back. One verb, flipped by
    // whether the whole selection is already hidden (the already-flagged
    // heads precedent) — never both directions at once.
    //
    // `¬note` / `¬¬note` rather than "hide note" / "show note": the pill
    // already speaks in flag syntax (`.no-hyps`, `.h#used`), `¬` is the glyph
    // this audience reads negation in, and the double negation is what keeps
    // the restore direction from colliding with `note…`, the writer sitting a
    // few chips along — "note" would have named two different gestures.
    const commented = treeNodes
      .filter((n) => selection.has(n.id) && !!n.comment)
      .map((n) => n.id);
    if (commented.length > 0) {
      const allHidden = commented.every((id) => commentsOff.has(id));
      verbs.push({
        kind: "comments",
        doc: allHidden ? "noteShow" : "noteHide",
        ids: commented,
        hide: !allHidden,
      });
    }
    if (foldHeads.length > 0)
      verbs.push({
        kind: "flagFold",
        doc: "flagFold",
        patches: foldHeads.map((h) => flagLine(h, slots, ".fold")!),
        anchor: foldHeads[0].id,
        targets: foldHeads.flatMap(foldTargetsOf),
      });
    // `.none…` asks for ONE TACTIC, not one head. Every other flag writer
    // normalizes a ragged sweep to head tactics, which is right for them —
    // `.fold`/`.no-hyps` describe a subtree, so a band of thirty nodes with
    // one head is a sensible thing to flag. `.none` is not like that: it
    // replaces a step and everything it opened with a SENTENCE about that
    // step, and offering it over a sweep meant the ghost you got stood for
    // far more than the tactic you thought you had picked. So the offer reads
    // the selection itself. (One node of a multi-rule `rw` still counts as
    // one tactic; `soleHead` stays the write target, since the comment goes
    // above the SLOT — see headTactics.)
    if (soleHead && selTactics.length === 1 && !soleHead.flags?.elide)
      verbs.push({
        kind: "prompt",
        doc: "flagNone",
        headId: soleHead.id,
        prompt: "none",
      });
    if (soleHead)
      verbs.push({
        kind: "prompt",
        doc: "note",
        headId: soleHead.id,
        prompt: "note",
      });
    if (ctxGoals.length > 0)
      verbs.push({
        kind: "patches",
        doc: "noHyps",
        patches: ctxGoals.map((x) => flagLine(x.c, slots, ".no-hyps")!),
      });
    if (pinGoals.length > 0)
      verbs.push({
        kind: "patches",
        doc: "hUsed",
        patches: pinGoals.map(
          (x) =>
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
      verbs.push({
        kind: "unflag",
        doc: "unflag",
        // Cross-node dedupe by start line: one comment attributes to one node,
        // but a whole-line patch emitted twice would apply its second copy
        // against already-shifted coordinates.
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
    if (selPlaced.length > 0 && verbs.length > 0) {
      const minX = Math.min(...selPlaced.map((p) => p.x - p.data.w / 2));
      const minY = Math.min(
        ...selPlaced.map((p) => p.y + (bandTopH(p.data) - p.data.h) / 2),
      );
      let cx = minX;
      // Chip widths up front: the backing card has to span the whole row, and
      // the row's width is only known once every chip is measured. Through
      // `chipWidth` like every other measured chip — a private padding/floor
      // pair here was a second answer to the one question that helper exists
      // to own.
      //
      // Labels and tooltips come from VERB_DOC, so the panel and the chip
      // cannot describe a verb differently, and `writes` splits the row into
      // its two SAFETY classes. They were indistinguishable before: `elide`
      // (pure view state) sat two chips from `.fold` (writes a line into your
      // file) and five from `unflag` (deletes the author's prose), all in the
      // same ink on the same card.
      //
      // ONE row shape, filled two ways: the verbs, or — once `unflag` has been
      // armed — the confirm pair, in the SAME card. The armed delete's idiom
      // exactly (count in the label, `×` to back out), which is the point:
      // there should be one way to say "this is about to change your file".
      // DATA, never closures: `runPillChip` reaches anchorOn/anchorAs, and
      // react-hooks/refs treats a function built during render that
      // transitively touches a ref as a render-phase read. Same rule the verbs
      // themselves follow — the closure lives in JSX attribute position only.
      const row: PillChip[] = pendingVerb
        ? [
            {
              label: `remove ${pendingVerb.kind === "unflag" ? pendingVerb.patches.length : 0} comment line(s)`,
              title: `Confirm — ${CMD}Z in the editor undoes it`,
              color: DANGER_FILL,
              writes: true,
              act: { do: "confirm" },
            },
            {
              label: "×",
              title: "Leave the comments alone",
              color: SEQ_STROKE,
              writes: false,
              act: { do: "cancel" },
            },
          ]
        : verbs.map((v) => {
            const d = VERB_DOC[v.doc];
            return {
              label: d.label,
              title: d.title,
              // The one verb that deletes text the AUTHOR wrote is the one
              // that looks different before you click it, not only after.
              color: v.kind === "unflag" ? DANGER_FILL : SEQ_STROKE,
              writes: d.writes,
              // …and the one that ARMS rather than running, for exactly the
              // reason ⊘ does. The rest ADD a comment line, which shows up in
              // the buffer at once and is one ⌘Z away — as their tooltips now
              // say, in the armed delete's own words.
              act:
                v.kind === "unflag"
                  ? ({ do: "arm", verb: v } as const)
                  : ({ do: "run", verb: v } as const),
            };
          });
      // Verbs are pushed view-first already; this only finds the seam.
      const firstWriter = row.findIndex((c) => c.writes);
      const chipWs = row.map((c) => chipWidth(c.label, PILL_FONT_PX));
      const sepW = firstWriter > 0 ? SEP_W : 0;
      const rowW =
        chipWs.reduce((a, b) => a + b, 0) + CHIP_GAP * (row.length - 1) + sepW;
      // Where the writing half begins: the same running sum the chip loop
      // walks, done once up front because the TINT has to be painted UNDER
      // the chips and the loop that positions them runs after it. The +7 puts
      // its edge exactly on the seam's hairline, so the rule reads as the
      // boundary of the band rather than a second mark floating inside it.
      const seamX =
        firstWriter > 0
          ? minX +
            chipWs.slice(0, firstWriter).reduce((a, b) => a + b, 0) +
            CHIP_GAP * firstWriter +
            7
          : 0;
      selectionPillEl = (
        <g
          // data-node: a mousedown on the pill must not start a new marquee
          // under the very chips it is aiming at.
          data-node=""
          transform={`translate(0,${minY - CHIP_H - 10})`}
        >
          {/* An OPAQUE card under the row. The chips are transparent by
              design — under a pending goal they sit on empty canvas, where
              a fill would read as a solid button — but the selection pill
              hangs wherever the selection's top edge lands, which is
              routinely over a comment strip or a box, and dashed outlines
              full of tree ink behind them are simply unreadable. One card
              rather than N opaque chips: the gaps between chips show the
              same ink, so filling only the chips fixes half of it. */}
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
          {/* The WRITING ZONE, tinted. Reinforcement only — the solid outlines
              carry it — but it groups the five verbs that change your file
              into one region, which no per-chip mark can do. CLIPPED to the
              card's own rounded rect, the diagnostic ribbon's trick: the band
              runs to the card's right edge, and clipping is what makes it
              inherit that corner radius exactly instead of showing square
              corners against a rounded card. A fixed clip id is safe here
              where a node's is not — there is only ever one pill. */}
          {firstWriter > 0 && (
            <>
              <clipPath id="ptw-pill-card">
                <rect
                  x={minX - CARD_PAD}
                  y={-CARD_PAD}
                  width={rowW + 2 * CARD_PAD}
                  height={CHIP_H + 2 * CARD_PAD}
                  rx={4}
                />
              </clipPath>
              <rect
                clipPath="url(#ptw-pill-card)"
                x={seamX}
                y={-CARD_PAD}
                width={minX + rowW + CARD_PAD - seamX}
                height={CHIP_H + 2 * CARD_PAD}
                fill="var(--ptw-pill-writes)"
                pointerEvents="none"
              />
            </>
          )}
          {row.map((c, vi) => {
            // The seam: a hairline and a ✎ before the first chip that writes,
            // so "changes the view" and "changes your file" are two visible
            // groups rather than one undifferentiated row.
            const sep =
              vi === firstWriter && firstWriter > 0 ? (
                <g pointerEvents="none">
                  <line
                    x1={cx + 7}
                    y1={2}
                    x2={cx + 7}
                    y2={CHIP_H - 2}
                    stroke="var(--vscode-editorWidget-border, rgba(128,128,128,0.35))"
                    strokeWidth={1}
                  />
                  <text
                    x={cx + 17}
                    y={CHIP_H / 2}
                    dy="0.32em"
                    textAnchor="middle"
                    fontSize={PILL_FONT_PX}
                    fill={SEQ_STROKE}
                    style={{ userSelect: "none" }}
                  >
                    ✎
                  </text>
                </g>
              ) : null;
            if (sep) cx += SEP_W;
            const w = chipWs[vi];
            const at = cx;
            cx += w + CHIP_GAP;
            return (
              <Fragment key={c.label}>
                {sep}
                <FrontierChip
                  glyph={c.label}
                  title={c.title}
                  x={at}
                  width={w}
                  color={c.color}
                  fontSize={PILL_FONT_PX}
                  // Measured with `measureText`, which measures in the EDITOR's
                  // code font — so these chips must PAINT in it, exactly as the
                  // relation picker does. Painting the default "monospace" over
                  // a code-font measurement is how a label drifts off-centre in
                  // its own outline (and overflows the backing card, whose
                  // width is summed from the same measurements).
                  fontFamily={getCodeFontFamily()}
                  solid={c.writes}
                  onPick={() => runPillChip(c.act)}
                />
              </Fragment>
            );
          })}
        </g>
      );
    }
  }

  // The COUNTERFACTUAL stub overlay: the drawn tree holds a `sorry` where the
  // author is typing (see the cfStub prop), and this paints their live draft
  // over that node — dashed, accent-inked, widened to the draft like the
  // in-place editor's overlay (fixed height; a growing box reads as the tree
  // shifting). Rendered AFTER the nodes loop so it sits on top, and it TAKES
  // the pointer, so the node under it offers none of ITS gestures: those all
  // route through `tacticEdits`, which the cf payload withdrew on this line
  // precisely because its text is spliced. Body code, not a JSX IIFE (the
  // house ref-taint rule).
  //
  // What the overlay does offer is a DOUBLE-CLICK of its own, when the server
  // shipped `cfStub.col`: a box in this tree that shows source text should be
  // editable like every other one, and the withdrawal was never an argument
  // against editing THE AUTHOR'S LINE — only against editing a range whose
  // text came from the counterfactual. `col` + `cfLine` is that line in real
  // coordinates and `draft` is its real content, so the edit commits over
  // `[{line, col}, end of line]` with the author's own text (the huge end
  // character is clamped by the editor, the insertion path's own trick) and no
  // spliced byte is ever readable, let alone writable, from here.
  //
  // WHICH node is the stub is the SERVER's answer (`cfStubPos` — the splice
  // knows the byte it wrote `sorry` at), matched the way `pendingFill` claims
  // its own stub: exact position plus the label actually being `sorry`. The
  // line rule it replaces is ambiguous in principle — a container and the
  // injected stub can both start on the cursor's line — though the attempt to
  // REACH that state failed: `cfWanted`'s completeness witness declines cf
  // whenever a step starts on the line, and a one-line `have … := by` records
  // its container step there in the real payload whether its body is deleted
  // or left unparseable (measured, both shapes). So this is the guess removed
  // rather than a bug observed, and it is the tier-proof form: the next splice
  // tier gets the right node without re-arguing which one it is.
  //
  // A failed exact match falls back to the line rule rather than painting
  // nothing: the overlay is the whole "here is where your tactic lands"
  // affordance, and silently dropping it would be a worse failure than the
  // ambiguity it guards against.
  //
  // The node's OWN box hides under it (`cfStubId`, read by the nodes loop's
  // `hideForEdit`), for the reason a narration-mode comment edit hides its box:
  // the overlay stands IN for the box, and leaving both drawn showed two
  // borders. Here they do not even coincide — the overlay widens to the draft
  // while the box stays `sorry`-sized — so the node's solid stroke filled the
  // dash gaps along the shared top and bottom edges and its right edge stood as
  // a bar inside the overlay: one border reading as "partly dashed, partly
  // full", reported on a whole-theorem-line draft where the width gap is
  // largest.
  const cfStubId = cfStub
    ? cfStubNodeId(
        nodes.map((n) => n.data),
        cfStub,
      )
    : null;
  const cfEditable =
    !!cfStub && cfStub.col !== undefined && !!onEditTactic && seq.mode === "off";
  /** Open the in-place editor on the counterfactual line. See `editing.cfIndent`
  for why every coordinate here is the REAL document's. */
  const editCfStub = (id: string) => {
    if (!cfStub || cfStub.col === undefined) return;
    setEditing({
      id,
      pos: {
        start: { line: cfStub.line, character: cfStub.col },
        // To END OF LINE, and that is what makes a range derived from a
        // SNAPSHOT honest about a line still being typed in: however many more
        // characters have landed since this payload was built, the replacement
        // still takes the whole line. The editor clamps a character past the
        // line's end when the edit applies (`addTactic` leans on exactly this
        // and the widget never holds document text) — same `1e5`, deliberately
        // the same number rather than a second magic one.
        stop: { line: cfStub.line, character: 1e5 },
      },
      original: cfStub.draft,
      value: cfStub.draft,
      cfIndent: cfStub.col,
    });
  };
  let cfStubEl: ReactNode = null;
  if (cfStub) {
    const pn = cfStubId
      ? nodes.find((n) => n.data.id === cfStubId)
      : undefined;
    // While its own editor is open the overlay steps aside: the edit overlay
    // stands in for the box (the one-border rule this whole node already
    // learned), and two dashed rectangles over one box is the defect twice.
    if (pn && editing?.id !== pn.data.id) {
      const empty = cfStub.draft.trim() === "";
      const label = empty ? "…" : cfStub.draft;
      // Declined while the draft is blank — the `…` placeholder is ours, not
      // source, so there is nothing for the real line's tokens to align onto.
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
            // The tokenised draft, in the plain text's exact geometry: one
            // LINE_H box, centred on the box like the `<text>` it replaces
            // (`dominantBaseline="central"` there, so the block's top is half
            // a line above the middle). `white-space: pre` because the label
            // is measured, never re-wrapped — the node-label rule.
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

  // The flag prose prompt (`.none…` / `note…`): one line of free text below
  // the head's box. Blur is a NO-OP (the staged-fill lesson: the infoview's
  // reflows throw stray blurs); Enter commits, Esc cancels here, the document
  // layer catches an unfocused Esc, and a background click closes it unspent.
  // Body code, not a JSX IIFE, for the same ref-taint reason as the pill
  // (commitFlagPrompt reaches anchorAs).
  let flagPromptEl: ReactNode = null;
  if (flagPrompt) {
    const pn = nodes.find((n) => n.data.id === flagPrompt.headId);
    if (pn) {
      const boxBottom =
        pn.y + (bandTopH(pn.data) - pn.data.h) / 2 + pn.data.h;
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
                  : elidableIds.has(flagPrompt.headId)
                    ? "why this part is not worth reading (Enter writes .none)"
                    : // A closing step has nothing below it to put away, so
                      // the sentence IS the elision — an empty commit cancels.
                      "why this closing step is not worth reading"
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
      {/* THE SIGNATURE HEADER. Above every floater (they offset by its
          measured height) and above the canvas, so it never scrolls away from
          the proof it names. Prose-wrapped, not measured like a node label:
          nothing aligns to it, so it may wrap freely and a long statement
          costs height instead of width. */}
      {declHeader ? (
        <div
          ref={hdrRef}
          onClick={onRevealHeader}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            // BELOW the rail (z 10), which floats over everything by design —
            // and padded clear of it so the text never runs under a button.
            // The alternative, ending the bar before the rail, leaves a notch
            // of tree showing above the header on the right.
            zIndex: 9,
            boxSizing: "border-box",
            fontFamily: getCodeFontFamily(),
            fontSize: NODE_FONT_PX,
            lineHeight: `${LINE_H}px`,
            letterSpacing: 0,
            whiteSpace: "pre-wrap",
            // PINNED, not inherited: a div is not insulated by the UA
            // stylesheet the way a textarea is, and the standalone app root
            // sets `text-align: center` — the same trap the edit mirror hit,
            // which put its glyphs 68.5px off the caret. Measured here as a
            // centred statement.
            textAlign: "left",
            color: NODE_TEXT,
            background: "var(--ptw-bg)",
            borderBottom: "1px solid var(--vscode-editorWidget-border, #cbd5e0)",
            cursor: onRevealHeader ? "pointer" : "default",
            // At rest the bar is ONE line and anything past it is clipped; the
            // hover state is where the whole statement lives, capped so a
            // monstrous one still leaves tree showing and scrolls inside its
            // own box.
            //
            // Expanded it also rises ABOVE the floater stack (z 10) — the
            // floaters offset by the FROZEN collapsed height, so they sit
            // inside the expanded bar's own area and drew straight through the
            // statement. It stops short of the rail instead of passing under
            // it, since z 11 would otherwise paint over the buttons; at one
            // line there is nothing to collide with, so the resting bar keeps
            // its full-width background and its padded gutter.
            //
            // The padding is written as the SHORTHAND in both branches, never
            // shorthand-plus-longhand: React clears a longhand it no longer
            // sees by writing `""` over that one property, which does not
            // restore the shorthand's value — the resting bar lost its 46px
            // rail gutter entirely and ran its text under the buttons.
            ...(hdrOpen
              ? {
                  padding: "6px 10px",
                  maxHeight: "60%",
                  overflowY: "auto",
                  zIndex: 11,
                  right: 38,
                }
              : { padding: "6px 46px 6px 10px", overflow: "hidden" }),
          }}
        >
          {/* THE TRAIL. Two segments, one verb each — the statement reveals,
              the focus segment exits — which is why focus APPENDS here rather
              than replacing the statement: the two answer different questions
              (which theorem / which subtree) and both stay true at once, so a
              swap would hide the theorem's identity exactly when you are
              deepest inside it, and would make the same pixels mean two
              different clicks with nothing visible to say which. The focus
              segment is inked in the goal colour so the trail reads as
              "statement › the goal you scoped to" in both directions. */}
          <div
            style={{
              display: "flex",
              // Bottom-aligned so an EXPANDED multi-line statement keeps the
              // pill on its last line rather than floating it beside the first.
              alignItems: "flex-end",
              // A flex row is what guarantees the pill's own ✕ survives: the
              // statement is the shrinkable item and the pill is not, so a long
              // theorem eats its own tail instead of pushing the exit control
              // out through the header's clip. It used to be inline with a
              // `maxWidth: 40%` pill, and an `overflow-y` on the bar computes
              // `overflow-x` to `auto` — so the ✕ was scrolled out of sight
              // rather than dropped (reported as missing).
              minWidth: 0,
            }}
          >
            <span
              // THE HOVER TARGET IS THE STATEMENT, not the bar. Opening on the
              // whole bar meant crossing the header at all — on the way to the
              // pill, most of all — dropped a full statement over the tree,
              // and it left the two segments entangled: the pill sat marooned
              // at the end of the expanded text.
              onMouseEnter={() => setHdrOpen(true)}
              onMouseLeave={() => setHdrOpen(false)}
              style={{
                // Shrinks TEN times as readily as the pill: while focused this
                // is already down to `theorem <name> …`, and the rest of the
                // bar is the pill's to use.
                flex: "0 10 auto",
                minWidth: 0,
                ...(hdrOpen
                  ? {}
                  : {
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "pre",
                    }),
              }}
            >
              {(() => {
                const src = declHeader.split("\n");
                const tagged = renderDeclHeader?.(src);
                const lines = tagged ?? src;
                // AT REST: one line. A statement is routinely six lines of
                // binders and conjuncts, and a header that tall is no longer
                // chrome — it is a second pane the proof has to live under.
                // The first source line carries the keyword and the NAME, the
                // part that identifies the theorem; the rest is one hover away.
                // Two truncations, deliberately: `…` for the lines not drawn
                // (a fact about the source) and the CSS ellipsis for a first
                // line too wide for the panel (a fact about the window).
                //
                // FOCUSED it shrinks again, to `declHead` — and it is still
                // COLOURED: the truncated head goes through the renderer as a
                // stand-in LABEL, and the alignment returns the prefix where
                // it agrees with the source (see `renderDeclHeader`), so the
                // keyword keeps its ink and its popup and only the `…` past
                // the cut is plain.
                if (!hdrOpen) {
                  if (focusId) {
                    return (
                      renderDeclHeader?.([declHead], declHead)?.[0] ?? declHead
                    );
                  }
                  return (
                    <>
                      {lines[0]}
                      {src.length > 1 ? (
                        <span style={{ opacity: 0.6 }}> …</span>
                      ) : null}
                    </>
                  );
                }
                // ONE BLOCK PER SOURCE LINE. `renderTacticTokens` returns a
                // node per line and they were rendered inline into a
                // `pre-wrap` box, so the statement's own line breaks
                // disappeared and its source INDENTATION reappeared as gaps in
                // the middle of running text (reported as "whitespace is all
                // weird"). Same shape the node labels use for the same reason.
                //
                // Continuation lines keep their indent — it is how the author
                // laid the statement out, and it is what makes a long `∧`
                // chain readable — while `pre-wrap` still lets a line too wide
                // for the panel wrap instead of scrolling.
                return lines.map((ln, i) => (
                  <span key={i} style={{ display: "block" }}>
                    {ln}
                  </span>
                ));
              })()}
            </span>
            {/* The two segments never share the bar in the OPEN state:
                reading the whole statement is a different act from navigating
                out of a subtree, and while the statement is expanded the pill
                has nowhere honest to sit — it ended up marooned at the end of
                the last line, which is what made the pair read as one confused
                control. It comes back the moment the pointer leaves. */}
            {focusId && !hdrOpen && (
              <>
                <span style={{ opacity: 0.5, padding: "0 6px", flexShrink: 0 }}>
                  ›
                </span>
                <button
                  type="button"
                  title="Back to the whole proof (Esc, or ◎ / ⌥-click on the focused goal)"
                  onClick={(e) => {
                    // The statement's own click is REVEAL; this segment's is
                    // EXIT. Stopping here is what keeps one verb per segment.
                    e.stopPropagation();
                    exitFocus();
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    // The pill yields last, and when it does the LABEL is what
                    // gives — `◎` and `✕` are `flexShrink: 0` inside it, so a
                    // panel too narrow for everything clips the text and never
                    // the way out.
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
                  <span style={{ flexShrink: 0 }}>◎</span>
                  <span
                    style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      minWidth: 0,
                    }}
                  >
                    {focusLabel}
                  </span>
                  <span style={{ opacity: 0.8, flexShrink: 0 }}>✕</span>
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
      {/* No top bar: the top edge stays empty so the eye falls straight from
          the infoview's expected-type block onto the tree's root. Everything
          lives on the floating icon rail at the right; the only top-left
          floaters are the caller's slot (the standalone app's proof picker —
          the widget passes none) and the transient sequence-mode hint. */}
      {headerExtra && (
        <div
          style={{
            position: "absolute",
            // Row 0 of the floater stack — through `floaterTop`, not a
            // hardcoded 8, or the signature header (which the stack offsets
            // for) draws straight over it. Measured: picker at 8 under a 29px
            // header before this.
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
      {/* The focus breadcrumb is NOT here any more — it is the second
          segment of the signature header (a trail), where the space was
          already reserved and where "where am I" belongs. See the header. */}
      {/* The mode hints, all four through one HintPill — they were four
          near-identical divs, which is how three of them ended up being the
          only modes on the tree with no way out you could see. The ✕ runs the
          layer's own `off`, so the pill and Esc cannot drift apart. */}
      {seq.mode !== "off" && (
        <HintPill
          top={floaterTop(1)}
          text={
            seq.mode === "view"
              ? "linear path · click a node to start over"
              : seq.from !== null
                ? "click the end node"
                : "click the start node"
          }
          title="Leave the linear path (Esc, or ⇝ on the rail)"
          onExit={layerOff("seq")}
        />
      )}
      {elidePick && (
        <HintPill
          top={floaterTop(1)}
          text={
            elidePick.from !== null
              ? "elide · click the end node"
              : "elide · click the start node"
          }
          title="Cancel this elision (Esc, or ⇥ on the rail)"
          onExit={layerOff("elidePick")}
        />
      )}
      {bandPick && (
        <HintPill
          top={floaterTop(1)}
          text={
            bandPick.from !== null
              ? "cut · click the bottom node"
              : "cut · click the top node"
          }
          title="Cancel this cut (Esc, or ⇳ on the rail)"
          onExit={layerOff("bandPick")}
        />
      )}
      {/* The staged `calc` fill says which end it is asking for. The link is
          already in the file, so this also has to say what Enter does — taking
          the `_` is a real answer here, not a way of skipping the question.
          It gets a ✕ more than the others do: its blur is deliberately a
          no-op, so before this its only exits were Esc and a background
          click, neither of which the overlay says anything about. */}
      {editing?.calcStage && (
        <HintPill
          top={floaterTop(1)}
          text={
            editing.calcStage.stage === "lhs"
              ? "calc · left-hand side · Enter keeps _"
              : editing.calcStage.closes
                ? "calc · right-hand side · Enter keeps _"
                : "calc · right-hand side · this link steps, so name where it goes"
          }
          title="Leave the link as it stands, both ends `_` (Esc)"
          onExit={layerOff("calcStage")}
        />
      )}
      {/* No counterfactual BANNER. There was one — `✎ writing line N — tree
          holds a sorry there` — and it is gone by user directive: the dashed
          accent-inked stub already says "this line is being written", and the
          machinery behind it (that we re-elaborated the declaration with the
          line spliced to `sorry`) is an implementation fact the reader has no
          use for. The stub keeps its own `<title>` for anyone who asks. */}
      <ControlRail
        // Clear of the signature header — through `floaterTop(0)`, which IS
        // the coding of "below the header" (row 0 adds no floater rows), so
        // the measured height has one reader and the rail cannot drift from
        // the top-left stack. At a hardcoded 8 the header's hairline ran
        // straight through the first button.
        top={floaterTop(0)}
        onExpandAll={() => {
          anchorRoot();
          setCollapsed(new Set());
          // Elisions go too. "Expand all" means nothing is hidden, and a
          // ghost hides strictly more than a fold does — the fold leaves its
          // node standing and only shuts what hangs below, while a cut lifts
          // the tactic and its subtree out of the tree entirely. Leaving the
          // dashed chips behind made ⊞ a half-measure you then had to hunt
          // down and click one by one, which is exactly what it exists to
          // save. It costs the same as it always has for folds: the cuts are
          // gone, not remembered — ⊞ has always been the button that throws
          // your view away.
          //
          // Only MANUAL cuts (◌ step, ⇥ path, ⇳ band) live in this state;
          // ⇉ combine's runs are recomputed in the engine memo from the
          // toggle, so a merged run stays merged — it is a display mode, not
          // something hidden.
          setElideCuts([]);
        }}
        onResetView={resetToSource}
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
        sbsEnabled={compact}
        gallery={gallery}
        onGalleryChange={setGallery}
        onSideBySideChange={(v) => {
          anchorRoot();
          setSideBySide(v);
        }}
        reflow={reflow}
        forcedReflow={forcedReflow}
        reflowOpen={reflowOpen}
        onReflowOpenChange={openReflow}
        flyout={railFlyout}
        onFlyoutChange={openFlyout}
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
        commentMode={commentMode}
        onCommentModeChange={(v) => {
          // No anchorRoot(): the structure you are reading is unchanged (the
          // strips leave, or trade places with labels in the same boxes), and
          // pinning the root would scroll away from it. The `[nodes]` anchor
          // holds the node nearest the viewport centre — the ⋯ brief / ⇉
          // combine treatment.
          setCommentMode(v);
        }}
        combine={combine}
        onCombineChange={(v) => {
          // Deliberately NO anchorRoot() here: the run you are looking at is
          // usually far from the root, and pinning the root scrolls the view
          // back to the top. Leaving the anchor unset lets the `[nodes]` effect
          // pin the surviving node nearest the viewport centre instead, which
          // keeps the new view as close as possible to the old one.
          setCombine(v);
          // Leaving the mode forgets the un-combine exclusions: re-enabling
          // ⇉ recombines everything, the same fresh-start ⊞ gives cuts.
          if (!v) setCombineOff(new Set());
        }}
        hypMode={hypMode}
        onHypModeChange={(v) => {
          // Every layer's hyp label resizes, so hold the root fixed on screen
          // (same treatment as expand/collapse-all).
          anchorRoot();
          setHypMode(v);
        }}
        hypGroup={hypGroup}
        onHypGroupChange={(v) => {
          // Regrouping reorders lines within each box without changing how
          // many there are, so most boxes keep their size — but the divider's
          // HYP_SEP_H appears and disappears with it, so heights do move.
          // Anchor exactly as the breadth cycle does.
          anchorRoot();
          setHypGroup(v);
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
        helpOpen={helpOpen}
        onHelpOpenChange={setHelpOpen}
        caps={caps}
        fontFamily={codeFont}
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
          top={floaterTop(2)}
          onStep={stepDiag}
          // "Take me to it" means BOTH surfaces: the tree (unfold, page,
          // scroll — revealNode) and the SOURCE (the editor's cursor onto
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
            revealNode(diagCur.nodeId);
            revealAt(diagCur.diag.range);
          }}
        />
      )}
      {/* No headroom veil. There WAS one — a short gradient the content
          scrolled under, so the floaters sat on calm ground — and it is gone
          by user directive, with the better reason: what it really bought was
          a hint about where nodes leave the frame, and the signature header's
          own bottom border now says that outright. It also washed out the
          header's text once the two shared the top edge. */}
      <div
        ref={scrollRef}
        className="no-scrollbar"
        style={{
          width: "100%",
          // The signature header is chrome ABOVE the canvas, not over it: the
          // scroll box starts below it, so the root node is never hidden
          // behind the bar and scrolling never runs the tree under it.
          height: hdrH ? `calc(100% - ${hdrH}px)` : "100%",
          marginTop: hdrH,
          overflow: "auto",
          // The tree is a DIAGRAM driven by click / double-click / drag, and a
          // stray text selection fights all three: a ⇧-click gets eaten as a
          // selection extension (which is exactly how the lens gesture broke
          // when it lived on ⇧-double-click), and drag-scrolling smears a
          // highlight across nodes. The in-place editor's textarea opts back
          // in below — everything else here is display, not text to copy.
          userSelect: "none",
        }}
        // A drag starting on the BACKGROUND rubber-bands a marquee selection.
        // Node <g>s are excluded by hit test rather than by stopPropagation
        // (mousedown must still reach textareas and native focus paths);
        // a sub-4px drag never engages, so plain clicks are untouched. The
        // document-level move/up pair lives in the closure — the drag is a
        // single gesture, not state the component tracks between renders.
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          const target = e.target as Element;
          if (target.closest("g[data-node], [data-ptw-edit]")) return;
          const svg = scrollRef.current?.querySelector("svg");
          if (!svg) return;
          const toContent = (cx: number, cy: number) => {
            // The svg's rect moves with scroll, so measuring it per event
            // keeps the marquee honest while the wheel scrolls mid-drag.
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
            marqueeDidDrag.current = true; // swallow the click this fires
            setMarquee(null);
            const cur = toContent(ev.clientX, ev.clientY);
            const lo = { x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y) };
            const hi = { x: Math.max(start.x, cur.x), y: Math.max(start.y, cur.y) };
            // Select by BOX intersection (the desktop-icon reading): the box,
            // not the whole band — sweeping a comment strip alone should not
            // grab its node.
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
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
        // A background click dismisses the editor-cursor accent (node and
        // label clicks stopPropagation, so they never land here): clicking
        // the widget focuses the infoview without moving the editor cursor,
        // and the lingering accent is just clutter at that point.
        onClick={() => {
          // The click a completed marquee drag fires as it releases is not a
          // background click — without this, mouseup selected and the click
          // instantly dissolved it.
          if (marqueeDidDrag.current) {
            marqueeDidDrag.current = false;
            return;
          }
          setHlDismissed(true);
          setClickAccent(null);
          // Everything else the background dismisses is the layer table's to
          // say (see `layers`) — unlike Esc, which takes the topmost layer
          // only, a background click means "done with all of this" and takes
          // every layer that opted in. The three picking modes deliberately do
          // not: a miss between two picks must not destroy the gesture. Other
          // editing states are untouched — their own blur has already
          // committed by the time this click lands.
          for (const l of layers) if (l.bg && l.up) l.off();
        }}
      >
        <svg
          width={svgW * zoom}
          height={svgH * zoom}
          viewBox={`0 0 ${svgW} ${svgH}`}
        >
          {/* Connectors are bare lines — no arrowheads: flow reads
              consistently down/right, so triangles were noise (and their
              tips poked into boxes and comment strips). What they DO carry is
              a target-type mark near each end (LinkMark): gap-with-dot = this
              line terminates at a GOAL, gap-with-dash = at a TACTIC. */}
          {/* Coords originate at top-left */}
          <g transform={`translate(${MARGIN.left + PAD_X},${MARGIN.top + PAD_Y})`}>
            {links.map((link, i) => {
              // A node's band is bandTopH (badge + non-floating strip) + h
              // (box), box at the bottom: edges leave a box's bottom edge and
              // land above the target's whole band — reading order goal →
              // badge → comment → box. MIRRORED in layout.ts linkSpans.
              const startY =
                link.source.y +
                (link.source.data.h + bandTopH(link.source.data)) / 2;
              const bandTop =
                link.target.y -
                (link.target.data.h + bandTopH(link.target.data)) / 2;
              // The badge and comment strip are narrative, not dataflow:
              // landing points sit below them.
              const contentTop = bandTop + bandTopH(link.target.data);
              const endY = bandTop - ARROW_GAP; // line ends just above the band

              const sLeft = link.source.x - link.source.data.w / 2;
              const tLeft = link.target.x - link.target.data.w / 2;
              // Target-type marks (see LinkMark), one near each end, each on a
              // straight run of the path. Fit rules: a mark needs its run to
              // hold LINK_MARK_OFF plus half its ≈9px footprint (MARK_FIT);
              // when start and end share ONE run, both need MARK_FIT2 or the
              // START mark wins alone — the departure is the cue that solves
              // the follow-the-wrong-line problem; the arrival only confirms.
              const MARK_FIT = LINK_MARK_OFF + 5;
              const MARK_FIT2 = 2 * LINK_MARK_OFF + 9;
              // The shortest run worth marking at all: the ≈9px mark footprint
              // plus a sliver of stroke either side. The stacked trunk's
              // goal→tactic gap is 11px — the MOST common link — so this must
              // stay under it or the default layout loses its tactic marks
              // (measured: 12/29 links bare at a 13px floor).
              const MARK_MIN = 10;
              type Mark = { x: number; y: number; horiz?: boolean };
              let startMark: Mark | null = null;
              let endMark: Mark | null = null;
              // Offset of a mark along a single run of length `run`, from the
              // run's own start: LINK_MARK_OFF from the chosen end when the
              // run holds it, else CENTERED — a link that short is seen whole,
              // so one mid-run mark says everything the end pair would.
              const markAt = (run: number, fromStart: boolean) =>
                run >= MARK_FIT
                  ? fromStart
                    ? LINK_MARK_OFF
                    : run - LINK_MARK_OFF
                  : run >= MARK_MIN
                    ? run / 2
                    : null;
              // Marks on a SHARED straight run from y0 to y1 at lane x: both
              // ends when it fits, else the one centered/start mark.
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
              // Marks on a branch's HORIZONTAL leg from x0 to x1 at y — the
              // leg unique to this link. An elbow's VERTICAL run is the trunk
              // (or a drop shared by every sibling branch), so it stays CLEAN
              // and both marks ride the horizontal: one right after the split
              // (the departure cue), one before the box (the arrival) — per
              // the user's two-track sketch: solid trunk, `- - —— - -` off it.
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
                // The drop below the source is SHARED by every column's link,
                // so it stays clean; the departure mark sits on the cross leg
                // right after its corner, the arrival on the child's own
                // descent just above the box.
                const o1 = markAt(childLane - col, true);
                if (o1 !== null)
                  startMark = { x: col + o1, y: hy, horiz: true };
                const o2 = markAt(contentTop - ARROW_GAP - hy, false);
                if (o2 !== null) endMark = { x: childLane, y: hy + o2 };
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
                  link.source.y + bandTopH(link.source.data) / 2;
                if (Math.abs(tLeft - (lane - TRUNK_INSET)) < 0.5) {
                  d = `M${lane},${srcBoxMid} L${lane},${contentTop - ARROW_GAP}`;
                  // This run IS the trunk (stamped so it reads as one
                  // continuous line) — no departure mark to break it; the one
                  // dot sits just above the goal it lands on.
                  const o = markAt(contentTop - ARROW_GAP - srcBoxMid, false);
                  if (o !== null) endMark = { x: lane, y: srcBoxMid + o };
                } else {
                  const landY = contentTop + link.target.data.h / 2;
                  d = `M${lane},${srcBoxMid} L${lane},${landY} L${tLeft - ARROW_GAP},${landY}`;
                  if (tLeft - ARROW_GAP > lane)
                    branchMarks(lane, tLeft - ARROW_GAP, landY);
                  else {
                    // Leftward (trunk-resuming) elbow: the horizontal runs
                    // back under the target box, so the mark rides the
                    // vertical drop instead.
                    const o = markAt(landY - srcBoxMid, true);
                    if (o !== null) startMark = { x: lane, y: srcBoxMid + o };
                  }
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
                  sharedMarks(col, startY, contentTop - ARROW_GAP);
                } else {
                  const landY = contentTop + link.target.data.h / 2;
                  d = `M${col},${startY} L${col},${landY} L${tLeft - ARROW_GAP},${landY}`;
                  // The vertical drop is shared by every sibling branch off
                  // this source (their elbows overlay it), so the marks live
                  // on the horizontal leg unique to this link — except on a
                  // LEFTWARD (trunk-resuming) elbow, whose horizontal runs
                  // back under the target box: there the vertical is this
                  // link's alone and takes the mark.
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
                d = `M${startX},${startY}
                    C${startX},${(startY + endY) / 2}
                     ${endX},${endY - k}
                     ${endX},${endY}`;
                // NO marks in wide mode (user directive): the curves splay,
                // so a straight cut-and-dot reads as debris on a line that is
                // not straight — and the layered tree makes the target's kind
                // obvious from shape alone (goals and tactics alternate by
                // depth band).
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
                </g>
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
              // tall, empty for tactics) then the label lines. A FLOATED
              // strip (aside modes — `commentFloats`, stamped by the engine's
              // place() so this can never disagree with the band it computed)
              // leaves the band: topH drops it, and the strip is drawn above
              // the band instead, rising beside the goal.
              const floatComment = !!node.data.commentFloats;
              const topH = bandTopH(node.data);
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
              // Marquee-selected nodes take the same accent: membership in
              // the pending selection is "which nodes am I about to act on",
              // the same question the endpoint/cursor accents answer.
              const accent = isEndpoint || isCursor || !!selection?.has(id);
              // A COMBINED node is a real (if synthetic) tactic node — the run's
              // tactics stacked — so it draws and behaves like one: normal box,
              // never folded, no dashed chip. Only an ELIDE marker gets the `◌`
              // chip treatment and the click-to-restore. It has no position of
              // its own (a marker spans several tactics), so the position its
              // GESTURES act through is the FIRST part's — reveal and the lens
              // both want "where the run starts".
              const isCombined = !!node.data.elidedCut?.combined;
              const isMarker = !!node.data.elidedCut && !isCombined;
              // A COMBINED node never folds — its gestures are a tactic's
              // (reveal, part edit, hover bar), and a fold would hide the run
              // behind a second mechanism nothing else clears. THE one coding
              // of that rule: the click handler, `clickable` and the −/+
              // glyph all read this bit.
              const canFold = foldable && !isCombined;
              const parts = node.data.elidedCut?.parts;
              const actPos =
                position ?? (isCombined ? parts?.[0]?.position : undefined);
              // A positioned node can reveal its source (widget only, outside
              // sequence mode). For a tactic node the whole box reveals; goal
              // nodes are the primary fold targets, so their box stays a fold
              // toggle and reveal rides the fast path (⌘/Ctrl-click — the
              // editor's own go-to-source gesture) or the hover action bar.
              const canReveal = seq.mode === "off" && !!onReveal && !!actPos;
              const revealable = canReveal && type === "tactic";
              const goalRevealable = canReveal && type === "goal";
              // A SYNTHETIC node (the `calc` of a block that failed to parse) is
              // editable too, and deliberately: it is the one node standing for
              // text that is unfinished, and its repair chip offers only the one
              // canned fix. The server ships it a `tacticEdits` entry keyed on
              // the chain's own start, so the lookup below resolves; the handler
              // still bails if it doesn't (the CLI ships no edits at all).
              // One gating policy for "may an in-place editor open here";
              // the two flavours below differ only in what carries the range.
              const editBase =
                seq.mode === "off" &&
                !elidePick &&
                !bandPick &&
                type === "tactic" &&
                !!getTacticEdit &&
                !!onEditTactic;
              const editable = editBase && !!position;
              // A COMBINED node edits PER PART: double-click resolves the
              // line under the pointer to its constituent tactic (each drawn
              // line carries its index; parts own segment ranges) and opens
              // the ordinary in-place editor on that tactic's own range.
              const partEditable =
                editBase && isCombined && (parts?.length ?? 0) > 0;
              // The node's COMMENT can be edited in place: double-click on
              // the strip (or, in narration mode, on the prose-labelled box).
              // Gated on `onEditTactic` alone — the range comes from
              // `proof.comments`, not `tacticEdits`, so `getTacticEdit` has
              // no say — and declined on markers/synthetic/recovered nodes,
              // which stand for no single as-written span (the flag writers'
              // decline set).
              const commentEditable =
                seq.mode === "off" &&
                !elidePick &&
                !bandPick &&
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
              // The tactic can be opened in the lens (its hover-bar ⧉).
              // Gated on its OWN hook only: the lens just needs a range to
              // select, so it must not ride `editable` — a tactic missing from
              // `tacticEdits` (which keys on the step's exact start) would
              // otherwise lose the action silently.
              const popoutable =
                seq.mode === "off" &&
                type === "tactic" &&
                !!actPos &&
                !!onPopoutEdit;
              const isEditing = editing?.id === id;
              // A replace-edit's overlay stands in for the box, so the box
              // hides; an ADD's hangs below it and the goal must stay readable
              // while you answer it. A staged `calc` fill is the same case:
              // what it is asking about is the link it just wrote, so the goal
              // that link is proving belongs on screen beside the question.
              // A comment edit's overlay stands in for the STRIP, so the box
              // stays visible under it (the code being narrated belongs on
              // screen while the narration is rewritten) — EXCEPT in
              // narration mode, where the prose IS the box: there the overlay
              // covers it exactly as a tactic edit does, and leaving it drawn
              // put two boxes a few px apart with both borders showing.
              // The counterfactual stub's overlay is the same case: it stands IN
              // for this box (see cfStubId), so the box, its label and its
              // ribbon go with it. One border, not two.
              const hideForEdit =
                id === cfStubId ||
                (isEditing &&
                  !editing?.add &&
                  !editing?.calcStage &&
                  (!editing?.comment || !!node.data.proseLabel));
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
              // Deleting. Offered wherever the extent is well defined: an
              // ordinary node's spec rides the wire; a COMBINED run's is
              // synthesized in `delExtents` (the union of its members', so ⊘
              // takes the whole run as one region). Never on an elide marker,
              // and never on the synthetic `calc` of a block that never
              // parsed, whose text is what the repair chip exists to fix. A
              // goal with no proof yet has no deleteSpec at all, so pending
              // leaves fall out for free. Looked up, not recomputed (see
              // `delExtents`). A declined extent — a sibling shares the start
              // line — must not even show the button: arming it would offer
              // nothing.
              const delExtent =
                seq.mode === "off" && !elidePick && !bandPick && !isMarker
                  ? (delExtents.get(id) ?? null)
                  : null;
              const deletable = !!delExtent;
              // Elide this tactic INTO the trunk (its hover-bar ◌): the tactic
              // and any block it opened are lifted out, leaving a small dashed
              // ghost — the trunk closing up over it where something follows,
              // the subtree simply gone where nothing does. The complement of
              // folding, which hides what is BELOW a goal and leaves the node
              // standing: this is for a subtree you have finished reading.
              //
              // Offered wherever the cut would do anything (see `stepIds` —
              // only a childless tactic is declined), plus every COMBINED run
              // (≥2 tactics by construction, cut as a band over its member
              // ids — see elideCombined); never on an elide marker or the
              // synthetic `calc` of a block that never parsed, whose whole
              // purpose is the repair chip it carries.
              //
              // A CLOSING tactic is the one place the button does something
              // else: `leafFold` names the goal to fold instead of a cut to
              // commit (see leafFoldTargets). Same glyph, same two gestures,
              // different restore — so it rides `elidable` and only the
              // ACTION branches, which is what keeps the bar uniform.
              const elideGate = elideGateOf(node.data);
              const leafFold = elideGate?.leafFold;
              const elidable = elideGate !== null;
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
                // `canFold`, not `foldable`: a bare click on a combined node
                // (no reveal hook — the standalone app) does nothing and must
                // not advertise a pointer. Its ⌥-elide still needs the click
                // handler attached, though — hence `elidable`.
                canFold ||
                elidable ||
                revealable ||
                goalRevealable;
              // Native hover tooltip: ONLY what you can do here. It used to
              // repeat the node's own text, which the box is already showing —
              // noise that buried the one thing a tooltip is good for. The
              // marker legend stays: `▸` is the sole bit of the box that isn't
              // self-explanatory.
              //
              // The list itself lives in `gestures.ts` and is shared with the
              // `?` panel, so a node's own hint and the reference cannot
              // describe the same gesture differently — and the panel gets
              // every gesture whose gate is a real predicate for free.
              const hints = nodeHints({
                revealable,
                goalRevealable,
                editable,
                partEditable,
                proseLabel: !!node.data.proseLabel,
                elidable,
                leafFold: leafFold !== undefined,
                focusable,
                isFocusRoot,
                anyUsedHyp: !!hyps?.some((l) => l.used),
              });
              // Diagnostics lead the tooltip and keep their full text: the
              // message IS the content here, where the action hints are a
              // reminder. Separated from them by a blank line rather than
              // bulleted, so a multi-line Lean message reads as itself.
              const diagTip = (nodeDiags ?? [])
                .map((d) => `${d.severity === 1 ? "⨯" : "⚠"} ${d.message}`)
                .join("\n\n");
              // Narration mode: the box shows PROSE, so the tooltip leads
              // with the code it stands for — the tactic is one hover away,
              // the mode's contract.
              const nodeTooltip = [
                node.data.proseLabel ? node.data.label : "",
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
              // A prose label (narration mode) is not source text; declining
              // the tagged path OUTRIGHT is the decision, not letting the
              // text-equality guard fail its way to the same answer.
              const taggedLines = node.data.proseLabel
                ? null
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
                  onNodeClick(id, canFold);
                  return;
                }
                // Tactic fast path — ⌥-click elides it into the trunk (the
                // hover bar's ◌ without the hover-and-aim; the goals' ⌥-focus
                // precedent). Checked BEFORE reveal, which otherwise consumes
                // every tactic click in the widget, modified or not.
                if (elidable && e.altKey) {
                  if (isCombined) elideCombined(id);
                  else if (leafFold !== undefined) toggle(leafFold);
                  else elideStep(id);
                  return;
                }
                // In the widget, clicking a positioned tactic reveals its source
                // rather than folding; fold via goal nodes / the sequence tools.
                // On editable tactics the reveal defers past the double-click
                // window (see deferReveal), so the in-place editor's opening
                // gesture isn't cut short by a focus jump to the editor.
                if (revealable) {
                  // The id seeds the instant accent — this branch is
                  // tactics only, which is exactly where the accent may land.
                  if (editable || partEditable) deferReveal(actPos!, id);
                  else revealAt(actPos!, id);
                  return;
                }
                // Goal fast paths — the whole box is the target, no fiddly
                // icons: ⌘/Ctrl-click reveals in source (the editor's own
                // go-to-definition gesture), ⌥-click focuses the subtree.
                if (goalRevealable && (e.metaKey || e.ctrlKey)) {
                  revealAt(position!);
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
                // A MODIFIED click that reached here asked for something this
                // node cannot do, and falling through to the unmodified action
                // is the worst possible answer: `goalRevealable` needs a
                // position, root goals carry none, so ⌘-click on the very
                // first node anyone clicks folded the entire proof. (Same for
                // ⌥ on a pending leaf, which is neither foldable nor
                // focusable, and for ⌘ on any goal in the standalone app,
                // which has no reveal at all.) A modifier that misses should
                // do NOTHING — what the node does offer is in its hints and in
                // the `?` panel.
                if (e.metaKey || e.ctrlKey || e.altKey) return;
                onNodeClick(id, canFold);
              };

              return (
                <g
                  key={id}
                  // The marquee's background test: a mousedown inside any
                  // node <g> is a node gesture (click, double-click-to-edit,
                  // chip pick), never the start of a drag-select. The VALUE is
                  // the node id — unread by the hit-test, but it lets the
                  // preview harness address a node without React internals.
                  data-node={id}
                  transform={`translate(${node.x},${node.y})`}
                  // Everything an armed delete would take fades, so the tree
                  // shows the same answer the editor's highlight does. Paint
                  // only — nothing moves, and the fade is on the group so the
                  // node's action bar dims with it.
                  //
                  // A hovered ◌ fades its extent the same way, at the same
                  // value, for the same reason — the difference being that
                  // nothing is written, so it needs no arming step. Both
                  // spare the node being acted ON: it is the one under the
                  // pointer, and fading it would fade the button too.
                  //
                  // ONE exception, and it is the reason that rule has a
                  // reason: on a CLOSING tactic ⌥-click folds the goal above,
                  // so the box that goes is this one and nothing else fades —
                  // the gesture previewed as doing nothing. The ⌥ path has no
                  // button under the pointer to protect, so there the anchor
                  // fades itself; the bar's ◌ still spares it.
                  opacity={
                    (arming && armedIds.has(id) && id !== arming.id) ||
                    (elidePreview &&
                      (elidePreview.anchor !== id
                        ? elidePreview.ids.has(id)
                        : elidePreview.self && elidePreview.from === "alt"))
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
                          // Narration mode: the visible text IS the comment,
                          // so double-click edits the comment — the tactic's
                          // own editor is still reachable by leaving the mode.
                          if (node.data.proseLabel) {
                            openCommentEdit();
                            return;
                          }
                          // What carries the range: the node's own position,
                          // or — on a COMBINED node — the double-clicked
                          // PART's. The tagged line divs carry their index;
                          // map line → explicit-newline segment → part via
                          // the same partSegSpans renderCombinedLines draws
                          // by. A miss (box padding, plain-SVG fallback)
                          // edits the first part.
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
                            // The mirror aligns tokens by the PART's own
                            // range on a combined node (whose own position
                            // is undefined).
                            ...(partEditable ? { tokPos: editPos } : {}),
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
                    hasBar || hoverHighlights || isMini || elidable
                      ? () => {
                          if (hasBar || isMini)
                            setHoverId((cur) => (cur === id ? null : cur));
                          if (hoverHighlights) onHoverTactic!(null);
                          if (elidable)
                            setElidePreview((p) =>
                              p?.anchor === id ? null : p,
                            );
                        }
                      : undefined
                  }
                  // ⌥-hover previews the same extent the ⌥-CLICK would take —
                  // the modifier is the gesture, so showing its reach before
                  // the click costs one repaint and saves an undo. On
                  // mousemove rather than mouseenter because the modifier can
                  // go down and up while the pointer sits still; both branches
                  // compare before writing, so a settled pointer re-renders
                  // nothing. (A held ⌥ with a motionless pointer sends no
                  // event at all — the rail's glyph swap has the same blind
                  // spot, and the same answer: move a pixel.)
                  onMouseMove={
                    elidable
                      ? (e) => {
                          if (e.altKey) {
                            if (elidePreview?.anchor !== id) {
                              const p = elidePreviewFor(id);
                              if (p) setElidePreview({ ...p, from: "alt" });
                            }
                          } else if (
                            // Only the ⌥ path's own preview: the bar's ◌ sets
                            // one too, and this handler fires for every
                            // pointer jiggle OVER that button (the bar lives
                            // inside this <g>) with altKey false — an
                            // untagged clear here was the "flashes but
                            // nothing real" bug.
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
                      // The strip is a double-click EDIT surface (widget
                      // only): its own handler, stopPropagation — the group's
                      // handler would open the TACTIC editor. Hidden while
                      // its own overlay is up (the box stays, unlike a tactic
                      // edit — the code being narrated belongs on screen).
                      style={{ letterSpacing: 0 }}
                      visibility={
                        isEditing && editing?.comment ? "hidden" : undefined
                      }
                      // …and the CLICK is stopped too, which the dblclick
                      // guard alone did not cover: a double-click delivers two
                      // `click`s BEFORE the `dblclick`, and on a GOAL a click
                      // is the fold. So double-clicking a goal's strip to edit
                      // it folded and unfolded the whole subtree underneath —
                      // most visibly on the root's "plan" comment, which is a
                      // goal strip sitting above the entire tree. Tactics were
                      // immune only because their click (reveal) is deferred
                      // past the double-click window and cancelled by it.
                      // The strip is its own surface: on it, a single click
                      // does nothing and a double-click edits.
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
                          // Floated (aside tactics): bottom-anchored ABOVE
                          // the band, so the lines rise beside the consumed
                          // goal and commentBlockH's trailing COMMENT_GAP
                          // lands between last line and box. Otherwise: at
                          // the band top, below the badge.
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
                        : (recoveredStroke ??
                          diagInk ??
                          // Narration mode: the box holds PROSE, so it is
                          // outlined in comment ink rather than tactic green
                          // — the border should say what kind of thing is
                          // inside, and its editor borders the same way.
                          (node.data.proseLabel ? PROSE_FILL : style.stroke))
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
                          // A NOTE is the source speaking, whichever gesture
                          // made the cut (see applyElisions) — so it leads,
                          // ahead of the ghost/band split, and the two agree
                          // with the label the box is showing.
                          node.data.elidedCut!.note
                            ? "elided into the trunk by a .none flag in the source"
                            : node.data.elidedCut!.ghost
                              ? "elided into the trunk"
                              : `${node.data.elidedCut!.tactics.length} ${
                                  node.data.elidedCut!.tactics.length === 1
                                    ? "tactic"
                                    : "tactics"
                                } elided`
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

                  {canFold &&
                    !seqActive &&
                    !revealable &&
                    !hideForEdit &&
                    !isMarker && (
                    // `+`/`−`, not the rail's ⊞/⊟. Those were tried, on the
                    // argument that `+` means three things within 30px (this,
                    // the insert-a-tactic chip below the box, the rail's
                    // zoom) — but a fold indicator is a hairline mark inside
                    // the box's padding, and the boxed glyphs read as buttons
                    // there, which is the one thing this is not: the whole box
                    // is the target. The ambiguity it was meant to fix is not
                    // one anybody reported.
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
                            // The line's index, read back by a COMBINED
                            // node's double-click to resolve which PART sits
                            // under the pointer.
                            data-ptw-lineidx={j}
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
                      // Narration prose is drawn as the strip would draw it —
                      // italic, comment ink — inside the tactic chrome, so it
                      // reads as what the step SAYS, not what it types. The
                      // measurer matched (proseLabelSize measures italic).
                      fontStyle={
                        node.data.proseLabel ? "italic" : undefined
                      }
                      // A run marker's `◌ N tactics` reads as an absence, so it
                      // takes the muted comment ink, not full node text.
                      fill={
                        node.data.proseLabel
                          ? PROSE_FILL
                          : isMarker
                            ? "var(--ptw-comment)"
                            : NODE_TEXT
                      }
                      // Match the width measurer in layout.ts, which doesn't include
                      // the page's inherited letter-spacing.
                      style={{ letterSpacing: 0 }}
                      // A restored multi-line label's tail lines carry LEADING
                      // SPACES (source-relative indent) that the measurer
                      // counted; SVG's default whitespace handling would
                      // collapse them and the line would render flush-left in
                      // a box sized for the indent.
                      xmlSpace="preserve"
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
                              glyph={addChipGlyph(node.data.addSpec)}
                              title={
                                node.data.addSpec.kind === "hole"
                                  ? "fill this hole in place — what you type replaces the `?_` where it sits"
                                  : "add a tactic for this goal"
                              }
                              // Centred on the incoming lane; the row runs right
                              // from there (see chipLaneXs).
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
                            x={chipLaneXs(node.data.addSpec)[2]}
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
                                    : `close this chain with a \`${node.data.addLink.rel}\` link — type its right-hand side, or keep the \`_\` to end it here`
                                  : "add a calc step above this link — the new link appears above this box, and this one closes the remainder; type its right-hand side"
                            }
                            // Alone on the lane when the block is broken: the
                            // other two chips are suppressed there, since they
                            // would insert above a block that stays unparsed.
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
                        //
                        // The gesture reference is NOT here. It was, briefly,
                        // on the argument that the bar is where the pointer
                        // already is when you wonder what the buttons do — but
                        // this bar appears on hover over every node in the
                        // tree, so a button that opens a panel is a glyph of
                        // pure overhead on every box, forever, to answer a
                        // question asked once. It lives on the rail (and on
                        // `?`), which is where a reference belongs.
                        ...(elidable
                          ? [
                              {
                                // THE GLYPH IS THE RESIDUE, which is what makes
                                // one button with two actions honest: `◌` is
                                // the dashed ghost the cut leaves in the
                                // trunk, and at a LEAF there is no ghost — the
                                // goal above simply shuts — so the face is the
                                // fold indicator's own `−`, the very mark that
                                // will be standing on that goal afterwards.
                                // (An earlier pass overlaid the `−` INSIDE the
                                // ring, which said both things at once and so
                                // said neither.)
                                //
                                // `◌` is NOT `⋯`, the rail's BRIEF mode: the
                                // two are different elisions — one cuts nodes
                                // out of the tree, the other shortens a label —
                                // and sharing a glyph made them genuinely hard
                                // to tell apart.
                                glyph:
                                  !isCombined && leafFold !== undefined
                                    ? "−"
                                    : "◌",
                                title: isCombined
                                  ? "Elide into the trunk (⌥-click) — the whole run collapses to a ◌ marker (click it to restore)"
                                  : leafFold !== undefined
                                    ? // No ghost here: this tactic closes its
                                      // goal, so the cut would be one box for
                                      // one ghost. Folding the goal hides the
                                      // same one box and leaves the goal's own
                                      // + as the way back — which is why the
                                      // face is `−` and the title names a
                                      // different restore.
                                      "Put this step away (⌥-click) — folds the goal above; click its + to bring it back"
                                    : "Elide into the trunk (⌥-click) — this tactic and anything it opened, leaving a ghost to click back open",
                                onClick: () =>
                                  isCombined
                                    ? elideCombined(id)
                                    : leafFold !== undefined
                                      ? toggle(leafFold)
                                      : elideStep(id),
                                onHover: (on: boolean) => {
                                  if (on) {
                                    const p = elidePreviewFor(id);
                                    if (p)
                                      setElidePreview({ ...p, from: "bar" });
                                  } else {
                                    // Leaving the button clears only the
                                    // bar's own preview — an ⌥-hover fade
                                    // must survive the pointer crossing ◌.
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
                                    getTacticEdit?.(actPos!)?.pos ?? actPos!,
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
                                    : isCombined
                                      ? "Delete this run of tactics"
                                      : "Delete this tactic",
                                onClick: () =>
                                  setArming({
                                    id,
                                    // A combined node's spec is synthesized
                                    // beside its extent (see delExtents).
                                    spec:
                                      node.data.deleteSpec ??
                                      delSpecs.get(id)!,
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
                chips, no portal, no focus to manage.

                Unreserved is the RIGHT answer here and must stay that way:
                arming is transient, and a row that reserved space would shift
                the tree at the instant the reader is aiming at a destructive
                confirm. It costs nothing — the row wants CHIP_TOP_GAP + CHIP_H
                = 23px and a tactic is followed by TRUNK_GAP_BRANCH = 24, so it
                lands in the gap the layout already leaves (measured: 0 of 186
                armed rows overlap any node box in ☰, and none in ⊦). The one
                exception found and NOT fixed is || tracks, where a single row
                of 24 clipped 4px off the box below it in the shared track:
                that track's floor reserves nothing for a lane it cannot know
                about, and buying those 4px means reserving space, which is the
                thing this row must not do. */}
            {arming &&
              (() => {
                const an = nodes.find((n) => n.data.id === arming.id);
                const ext = armExtent;
                if (!an || !ext) return null;
                const { w, h } = an.data;
                // Same bandTopH the node's own <g> uses: counting a FLOATED
                // strip here hung the confirm chip commentBlockH/2 below the
                // box on every annotated aside tactic.
                const boxTop = (bandTopH(an.data) - h) / 2;
                // No glyph on the confirm chip: the `⊘` said "you may delete
                // here", and once armed that is settled — what is left to read
                // is the COUNT, and repeating the symbol beside it only
                // competes with the number for the eye.
                const label = ext.empties
                  ? `replace ${ext.lines} with sorry`
                  : `delete ${ext.lines} line${ext.lines === 1 ? "" : "s"}`;
                const wide = chipWidth(label, CHIP_FONT_PX);
                const x0 = -CHIP_W_ADD / 2;
                const rowW = wide + CHIP_GAP + CHIP_W_ADD;
                // Shifted clear of the DESCENDING LANE, exactly as the chip
                // lane is (see the lane transform) and as the gallery pager
                // is: `an.x - w/2 + TRUNK_INSET` IS the x a connector drops
                // at, and the confirm chip is centred on it at the `+` chip's
                // width — so the trunk ran 10px inside the chip's left edge
                // and straight through the label, which is unreadable on a
                // dashed unfilled chip. Measured over the whole corpus in ☰:
                // 116 of 186 armable tactics crossed, EVERY one of them at
                // that single offset of 10 and nowhere else (the `×` chip,
                // further right, was never crossed). The offset is measured
                // from the CARD's edge rather than the chip's — the card is
                // what would cover the lane — so the air beside the trunk is
                // the lane's own 6px either way.
                //
                // Gated on having a visible child for the lane's own reason:
                // with nothing dropping there the row belongs centred on the
                // trunk it hangs under.
                const shift = drawnParentIds.has(arming.id)
                  ? CHIP_W_ADD / 2 + 6 + CARD_PAD
                  : 0;
                return (
                  <g
                    transform={`translate(${
                      an.x - w / 2 + TRUNK_INSET + shift
                    }, ${an.y + boxTop + h + CHIP_TOP_GAP})`}
                  >
                    {/* An OPAQUE card under the row, the selection pill's, for
                        the half of the problem no shift can reach: the ⋔ wide
                        layout draws SPLAYED BÉZIERS, which cross the row at
                        every offset across its whole width rather than at one
                        lane — measured on the same corpus, 9 of 24 confirm
                        chips and 8 of 24 `×` chips crossed, one of them at 99
                        sampled points spanning 566→704 of a 566→730 chip. A
                        shift is defined against a lane that mode does not
                        have. The card is also what makes the row legible over
                        a comment strip or a case badge, which it hangs across
                        wherever the tactic sits. One card, not two opaque
                        chips: the gap between them shows the same ink.
                        Neutral chrome with the danger ink left to the chips —
                        the card says "floating above", the chips say what the
                        click does. */}
                    <rect
                      x={x0 - CARD_PAD}
                      y={-CARD_PAD}
                      width={rowW + 2 * CARD_PAD}
                      height={CHIP_H + 2 * CARD_PAD}
                      rx={4}
                      fill="var(--ptw-surface)"
                      stroke="var(--vscode-editorWidget-border, rgba(128,128,128,0.35))"
                      strokeWidth={1}
                      style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.35))" }}
                    />
                    <FrontierChip
                      glyph={label}
                      title={`Confirm — ${CMD}Z in the editor undoes it`}
                      x={x0}
                      width={wide}
                      color={DANGER_FILL}
                      fontSize={CHIP_FONT_PX}
                      // Solid for the same reason the pill's writing verbs
                      // are: this is the click that changes the file. Its `×`
                      // stays dashed — backing out writes nothing — so the
                      // pair reads the way the pill's two halves do.
                      solid
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
                      x={x0 + wide + CHIP_GAP}
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
            {/* The marquee rectangle, while dragging: paint only, in content
                coordinates so it rides scroll and zoom for free. */}
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
            {/* The selection pill and the flag prose prompt — computed as
                straight-line body code above (react-hooks/refs: their verbs
                reach anchorAs, which writes a ref, so a render-called IIFE
                here would be tainted). */}
            {selectionPillEl}
            {flagPromptEl}
            {cfStubEl}
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
                const topH = bandTopH(pn.data);
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
                      // Restored multi-line labels indent their tail lines with
                      // leading spaces the measurer counted (see the node label
                      // render, same reason).
                      xmlSpace="preserve"
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
                        borderColor:
                          list[0].severity === 1 ? DANGER_FILL : WARN_FILL,
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
                // bandTopH, never an inline caseH + commentBlockH: in the
                // aside modes (⊦ spine, || tracks) an annotated tactic's strip
                // FLOATS out of the band, so the hand-rolled sum put the
                // overlay commentBlockH/2 below the box it is meant to cover —
                // the editor visibly stepping down off its own node.
                const topH = bandTopH(en.data);
                const boxTop = (topH - h) / 2;
                // An ADD's textarea hangs below the goal box (where its chip
                // sat), leaving the goal readable while you answer it — as does
                // a staged `calc` fill, which is asking about the link it just
                // wrote under that goal. A replace-edit covers the hidden box.
                // In NARRATION mode the prose is the box, so its editor is a
                // box replace like any other — same y, same hidden box.
                const proseEdit = !!editing.comment && !!en.data.proseLabel;
                // A COMMENT edit's overlay otherwise hangs over the STRIP —
                // the band above the box — where the text it replaces was
                // drawn; the box stays visible below it (hideForEdit exempts
                // it). A floated strip (aside tactics) sits ABOVE the band, so
                // the overlay follows the same branch the strip's own y takes.
                // Lifted by NODE_PAD_Y so the textarea's vertical padding
                // STRADDLES the strip's ink instead of hanging entirely below
                // it: unlifted, the overlay's bottom ate all of COMMENT_GAP
                // and sat flush on the box.
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
                // Measure in the font this overlay actually PAINTS in — a
                // comment editor is italic at COMMENT_FONT_PX, everything else
                // upright at NODE_FONT_PX (the proseLabelSize rule: measurement
                // must match paint). Safe before only because 12px upright is
                // wider than 11px italic, i.e. the overlay came out too wide
                // rather than clipping; it would have bitten the moment the
                // two sizes converged.
                const fw = Math.max(
                  w,
                  320,
                  ...valueLines.map(
                    (l) =>
                      (editing.comment
                        ? measureText(l, COMMENT_FONT_PX, true)
                        : measureText(l, NODE_FONT_PX)) +
                      2 * NODE_PAD +
                      12,
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
                // A comment edit sizes to its raw source lines at the strip's
                // own leading — never fewer than one line's worth, and in
                // narration never less than the box it is covering (the raw
                // source can wrap to fewer lines than the drawn prose).
                const fh = editing.comment
                  ? Math.max(
                      Math.max(1, openLines) * COMMENT_LINE_H + 2 * NODE_PAD_Y,
                      proseEdit ? h : 0,
                    )
                  : openLines * LINE_H + 2 * NODE_PAD_Y;
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
                // `tokPos` overrides the node's own position: a COMBINED
                // node's per-part edit aligns tokens against the PART being
                // edited (the node itself has no position — it is a marker).
                const mirrorPos = editing.tokPos ?? en.data.position;
                // …and skipped for COMMENT edits: prose, not tactic tokens.
                // …and for the COUNTERFACTUAL line, where the node's position
                // is a SPLICED coordinate: its tokens describe the injected
                // `sorry`, not the draft, and the cf payload has withdrawn the
                // entry anyway. Stated rather than left to fall out of the
                // withdrawal, so a future tier that kept the entry cannot
                // quietly start colouring a draft from spliced bytes.
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
                        // What an EMPTY box means, said exactly when the box is
                        // empty — the one moment the answer matters and the one
                        // moment a placeholder shows. It is not the same answer
                        // on both surfaces: clearing a tactic backs out (⊘ is
                        // the delete, and it arms), while clearing a comment
                        // removes it, which is deliberate and is the only way
                        // to remove one.
                        placeholder={
                          editing.comment
                            ? "empty = delete this comment"
                            : editing.add || editing.calcStage
                              ? ""
                              : "empty = cancel"
                        }
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
                          // A comment edit is prose: no completion (the
                          // candidates are tactics and terms), and the abbrev
                          // session was never opened for it (syncAbbrev
                          // no-ops without one).
                          if (!editing.comment)
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
                          // A comment edit takes the STRIP's own metrics —
                          // italic at the comment leading — so the overlay
                          // reads as the strip made editable, not as a tactic
                          // box that wandered up a band.
                          fontSize: editing.comment
                            ? COMMENT_FONT_PX
                            : NODE_FONT_PX,
                          fontStyle: editing.comment ? "italic" : undefined,
                          lineHeight: `${
                            editing.comment ? COMMENT_LINE_H : LINE_H
                          }px`,
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
                          // …but never while the box is EMPTY: there are no
                          // glyphs for the mirror to paint, and a transparent
                          // `color` would leave the placeholder's visibility up
                          // to whatever the UA stylesheet does with it.
                          color:
                            editHighlight && editing.value !== ""
                              ? "transparent"
                              : EDIT_TEXT,
                          caretColor: EDIT_TEXT,
                          // A comment edit borders in the COMMENT ink, not
                          // the tactic green: the box says what kind of thing
                          // is being typed, and prose in a tactic-coloured
                          // box read as code. Both flavours take it — the
                          // strip's overlay and narration mode's, where the
                          // box it covers is prose too.
                          border: `2px solid ${
                            editing.comment
                              ? PROSE_FILL
                              : NODE_STYLES.tactic.stroke
                          }`,
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

/** Each combined part with its explicit-newline segment range: part i covers
seg `[seg0, seg0 + span)`. THE one coding of the parts↔segments mapping — the
double-click's part resolution and `renderCombinedLines` both read it, so the
editor can never open a different tactic than the one whose drawn line was
clicked. */
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

/** One mode hint in the top-left floater stack — ⇝ sequence, ⇥ path-elide, ⇳
band-elide, and the staged `calc` fill, which share a row because they are
mutually exclusive.
 *
 * A BUTTON, for the reason the focus breadcrumb next to it is one: these are
 * modes you need OUT of, not settings you reach for, and the pill naming the
 * mode is already where the eye is. The three picking modes took over every
 * click on the tree while their pills were inert `<div>`s and Esc did not
 * reach them, so the only way out was the rail button that turned the mode on
 * — twenty glyphs away, and only if you remembered which one it was.
 *
 * `onExit` is the layer's own `off` (see `layers`), never a second copy of the
 * leaving logic, and `title` names Esc too so the pill teaches the key. */
function HintPill({
  top,
  text,
  title,
  onExit,
}: {
  top: number;
  text: string;
  title: string;
  onExit: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onExit}
      style={{
        position: "absolute",
        top,
        left: 8,
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: 6,
        maxWidth: "min(60%, 460px)",
        fontFamily: "monospace",
        fontSize: 12,
        color: ACCENT_TEXT,
        background: SEQ_STROKE,
        border: "none",
        padding: "3px 10px",
        borderRadius: 999,
        cursor: "pointer",
      }}
    >
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </span>
      <span style={{ opacity: 0.8 }}>✕</span>
    </button>
  );
}

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

/** The target-type mark near each end of a connector: gap-with-DOT for a
goal-bound link, gap-with-DASH for a tactic-bound one — round ↔ goals' rounder
corners, straight ↔ tactics' squarer ones. The cue lives at the DEPARTURE end
as well as the arrival because the problem it solves is starting to follow the
wrong line off the trunk. Both marks are PAINTED over the stroke (bg-coloured
cut segments), never a path edit — so layout.ts's linkSpans mirror is
untouched. The dash is not a drawn glyph: TWO cuts leave a short piece of the
original stroke floating between them, so it stays exactly on the line at any
zoom. */
function LinkMark({
  x,
  y,
  horiz = false,
  goal,
  stroke,
}: {
  x: number;
  y: number;
  /** The run this mark rides: vertical by default, horizontal on the final
      leg of a │└ elbow (the marks orient along the line, not the page). */
  horiz?: boolean;
  goal: boolean;
  stroke: string;
}) {
  // A cut: a short background-coloured segment along the run, centered at
  // offset `c` from the mark point, wide enough to swallow the 1.5px stroke.
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
        // Two cuts either side of the mark point: the stroke left between
        // them (≈4px) IS the dash.
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
  glyphDy,
  glyphWeight,
  title,
  onClick,
  pressed,
  pressedColor,
  disabled,
}: {
  glyph: string;
  // Per-glyph override of the rail's shared font size, for the sparse glyphs
  // that read small at it (see RAIL_GLYPH_BIG). The BOX never changes — the
  // rail's grid of 26px squares is what makes it read as one control.
  glyphPx?: number;
  /** Push the glyph DOWN by this many px. A button centres the em BOX, which
  is right for a glyph drawn around the middle and wrong for one drawn at cap
  height: ❞ lands 7px above centre and reads as stuck to the top edge
  (measured — every other rail glyph sits within 1px of centre). Paint only;
  the 26px box is untouched, so the rail's grid still governs. */
  glyphDy?: number;
  /** Draw the glyph with heavier strokes. The rail sizes glyphs to equal INK
  HEIGHT, which says nothing about how much ink is inside that height: ⌖ fills
  17% of its own bbox against ⊟'s 63%, and shrinking it to 12 to meet the band
  thinned its strokes further, so it read as skinny beside its neighbours.
  Weight is the right lever because the wrong one is size — going back up to
  14 would break the band it was brought into. Measured: bold takes ⌖ from 17
  to 24.8 units of ink at an unchanged 10px height. */
  glyphWeight?: string;
  title: string;
  // The event is passed through so a button can carry a second gesture on a
  // modifier (⌥ on the context-breadth button); callers that don't care stay
  // `() => …`, which is assignable.
  onClick: (e: React.MouseEvent) => void;
  pressed?: boolean;
  pressedColor?: string;
  disabled?: boolean;
}) {
  const color = pressedColor ?? RAIL_PRESSED;
  const base =
    glyphPx || glyphWeight
      ? {
          ...RAIL_BTN,
          ...(glyphPx ? { fontSize: glyphPx } : {}),
          ...(glyphWeight ? { fontWeight: glyphWeight } : {}),
        }
      : RAIL_BTN;
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={
        disabled
          ? { ...base, opacity: 0.35, cursor: "default" }
          : pressed
            ? {
                ...base,
                background: color,
                borderColor: color,
                color: ACCENT_TEXT,
              }
            : base
      }
    >
      {glyphDy ? (
        <span style={{ transform: `translateY(${glyphDy}px)` }}>{glyph}</span>
      ) : (
        glyph
      )}
    </button>
  );
}

/** The three rail flyout groups. One value across them (see the state's own
comment), so a second group opening closes the first by construction. */
type RailFlyoutId = "structure" | "reading" | "picking";

/** One member of a flyout: an ordinary RailButton's props, plus `away` — is
this control away from its home state? The head derives its face and pressed
state from the members' `away` flags, so it can only report what the buttons
themselves would show. */
interface FlyMember {
  glyph: string;
  glyphPx?: number;
  /** Push the glyph DOWN by this many px. A button centres the em BOX, which
  is right for a glyph drawn around the middle and wrong for one drawn at cap
  height: ❞ lands 7px above centre and reads as stuck to the top edge
  (measured — every other rail glyph sits within 1px of centre). Paint only;
  the 26px box is untouched, so the rail's grid still governs. */
  glyphDy?: number;
  /** Draw the glyph with heavier strokes. The rail sizes glyphs to equal INK
  HEIGHT, which says nothing about how much ink is inside that height: ⌖ fills
  17% of its own bbox against ⊟'s 63%, and shrinking it to 12 to meet the band
  thinned its strokes further, so it read as skinny beside its neighbours.
  Weight is the right lever because the wrong one is size — going back up to
  14 would break the band it was brought into. Measured: bold takes ⌖ from 17
  to 24.8 units of ink at an unchanged 10px height. */
  glyphWeight?: string;
  title: string;
  pressedColor?: string;
  disabled?: boolean;
  away: boolean;
  onClick: () => void;
}

/** A rail slot that owns a HEAD button and, when open, a horizontal row of
the group's real buttons, hanging LEFT of the rail (the ReflowControl idiom —
the rail is pinned to the right edge, so left is the only side with room).

The row sits on an opaque backing card: it hangs over the tree, and rail
buttons are near-transparent chrome that is unreadable over node ink (the
selection pill's card lesson).

THE HEAD'S FACE IS DERIVED, one rule for all three groups: when exactly ONE
member is away from home, the head wears that member's glyph (and its pressed
colour — an armed picking mode shows in the hint pill's ink); otherwise the
fixed group glyph. Pressed iff ANY member is away. The picking group gets the
useful special case for free (its modes are mutually exclusive, so an armed
mode always shows on the head), while the structure group — independent
toggles, several can be on at once — falls back to the group glyph rather
than electing one of them to lie about the rest.

Clicking a member acts AND collapses the row — one gesture, one visible
effect; the row is always one click away, and for a picking mode the hint
pill takes over as the mode indicator the moment it arms. A DISABLED member
swallows the click (the button's own `disabled`), so the row stays open and
nothing pretends to have happened.

Dismissal is the `layers` table's (Esc, background click) — the open state
lives in the view, not here, exactly like `reflowOpen`. While ⌥ is held the
head does NOT swap its face: it carries no second gesture. */
function RailFlyout({
  id,
  glyph,
  glyphPx,
  glyphWeight,
  label,
  members,
  open,
  onOpenChange,
}: {
  id: RailFlyoutId;
  /** The group's resting face, worn while no single member is away. */
  glyph: string;
  glyphPx?: number;
  /** Weight for the GROUP glyph only — see RailButton. Deliberately not
  applied when a MEMBER's glyph is on the face: that is a different glyph with
  its own measured weight, and thickening it would make the head disagree with
  the very button it stands in for. */
  glyphWeight?: string;
  /** Short group name for the head's title. */
  label: string;
  members: FlyMember[];
  open: boolean;
  onOpenChange: (v: RailFlyoutId | null) => void;
}) {
  const away = members.filter((m) => m.away);
  const face = away.length === 1 ? away[0] : null;
  return (
    <div style={{ position: "relative", display: "flex" }}>
      <RailButton
        glyph={face ? face.glyph : glyph}
        glyphPx={face ? face.glyphPx : glyphPx}
        glyphWeight={face ? undefined : glyphWeight}
        title={`${label}: ${members.map((m) => m.glyph).join(" · ")} — click to choose`}
        pressed={away.length > 0}
        pressedColor={face?.pressedColor}
        onClick={() => onOpenChange(open ? null : id)}
      />
      {open && (
        <div
          style={{
            position: "absolute",
            right: "100%",
            marginRight: 4,
            top: 0,
            display: "flex",
            gap: 4,
            // NO padding and NO border of its own, so the row is exactly one
            // rail button tall and its members line up with the rail's own
            // buttons to the pixel. The members were always 26px — it was this
            // card's 3px padding and 1px border that made the row 34 against a
            // 26px neighbour, which reads as "the popout buttons are bigger".
            // The background still earns its place: it fills the 4px gaps,
            // which would otherwise show tree ink between the buttons (the
            // selection-pill lesson). A shadow separates it from the canvas in
            // place of the border, which flush against the members' own edges
            // would have drawn a doubled 2px line down each end.
            background: "var(--vscode-editorWidget-background, #fff)",
            borderRadius: 3,
            boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
          }}
        >
          {members.map((m) => (
            <RailButton
              key={m.glyph}
              glyph={m.glyph}
              glyphPx={m.glyphPx}
              title={m.title}
              pressed={m.away}
              pressedColor={m.pressedColor}
              disabled={m.disabled}
              onClick={() => {
                m.onClick();
                onOpenChange(null);
              }}
            />
          ))}
        </div>
      )}
    </div>
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
            ? `Reflow at ${forced} columns, required by the || aligned-tracks layout (a shared tactic column needs bounded goal boxes) — click for the width slider to change it`
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

/** Whether ⌥ is held right now. Three rail buttons carry a SECOND gesture on
the modifier, and until this hook the only trace of that was a parenthetical in
a tooltip nobody reads twice; while ⌥ is down each of those three swaps its
glyph for what ⌥ would do, so the modifier announces itself on the control it
applies to. Every other button is left alone — a glyph that does not change is
telling the truth there, since ⌥-clicking it does the ordinary thing.

TWO sources, because neither alone covers the widget. Key events reach a
webview only when it has FOCUS, and in the infoview the caret normally lives in
the editor — holding ⌥ while pointing at the tree would deliver nothing at all.
So the rail's own mouse events feed it too: `altKey` rides every mouse event
whatever holds focus, and the affordance only has to be right while the pointer
is on the rail. (Neither is a substitute for the other: a held ⌥ with a still
mouse sends no mouse events either.)

A window blur CLEARS it: a webview that loses focus mid-press never sees the
keyup, and a glyph stuck in the ⌥ reading is worse than one that never moved.

Lives inside `ControlRail`, not the view, so a modifier press repaints three
buttons instead of the tree. */
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
  return {
    alt,
    syncAlt: (e: React.MouseEvent) => setAlt(e.altKey),
  };
}

/** The floating icon rail: every view control, no top bar, words in tooltips.
 *
 * THE RULE about pressed and disabled, stated once because two buttons broke
 * it: a control may draw PRESSED only where it changes the drawing. Where
 * another mode makes it inert it is `disabled` with a title saying WHY (⇳'s
 * pattern), and it never draws pressed while inert — a lit button that does
 * nothing is the one thing a control panel must not do. Where the setting is
 * still meaningful but currently OVERRIDDEN, the control reports the effective
 * state rather than the setting (¶'s `forcedReflow` pattern).
 *
 * Disabling never clears the underlying state: a rail toggle is how this
 * reader reads, so leaving and returning to a layout must restore it. */
function ControlRail({
  top,
  onExpandAll,
  onResetView,
  onCollapseAll,
  accordion,
  onAccordionChange,
  onUndo,
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
  reflowOpen,
  onReflowOpenChange,
  flyout,
  onFlyoutChange,
  brief,
  onBriefChange,
  commentMode,
  onCommentModeChange,
  combine,
  onCombineChange,
  hypMode,
  onHypModeChange,
  hypGroup,
  onHypGroupChange,
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
  helpOpen,
  onHelpOpenChange,
  caps,
  fontFamily,
}: {
  /** Where the rail starts, measured clear of the signature header by the
  caller (see the call site) rather than assumed. */
  top: number;
  onExpandAll: () => void;
  /** ⌥-⊞: the source's own reading, restored (see resetToSource). */
  onResetView: () => void;
  onCollapseAll: () => void;
  accordion: boolean;
  onAccordionChange: (v: boolean) => void;
  onUndo?: (redo: boolean) => void;
  layout: LayoutMode;
  onLayoutChange: (v: LayoutMode) => void;
  sideBySide: boolean;
  /** Whether side-by-side does anything in the CURRENT layout — `computeLayout`
  hands it only to `trunkLayout`, which ⋔ wide never reaches. */
  sbsEnabled: boolean;
  onSideBySideChange: (v: boolean) => void;
  gallery: boolean;
  onGalleryChange: (v: boolean) => void;
  reflow: ReflowMode;
  forcedReflow?: number;
  onReflowChange: (v: ReflowMode) => void;
  reflowOpen: boolean;
  onReflowOpenChange: (v: boolean) => void;
  /** Which flyout group is expanded — one value for all three (see the state's
  own comment: opening one closes the others by construction). */
  flyout: RailFlyoutId | null;
  onFlyoutChange: (v: RailFlyoutId | null) => void;
  brief: boolean;
  onBriefChange: (v: boolean) => void;
  commentMode: "shown" | "hidden" | "instead";
  onCommentModeChange: (v: "shown" | "hidden" | "instead") => void;
  combine: boolean;
  onCombineChange: (v: boolean) => void;
  hypMode: HypMode;
  onHypModeChange: (v: HypMode) => void;
  hypGroup: boolean;
  onHypGroupChange: (v: boolean) => void;
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
  helpOpen: boolean;
  onHelpOpenChange: (v: boolean) => void;
  /** What the host offers, so the panel promises only what exists here. */
  caps: Caps;
  /** The editor's code font, for the panel's input column. */
  fontFamily: string;
}) {
  const { alt, syncAlt } = useAltHeld();
  return (
    <div
      // The rail's own read of the modifier, for when the keyboard's goes to
      // the editor instead of the webview (see useAltHeld).
      onMouseMove={syncAlt}
      style={{
        position: "absolute",
        top,
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
      {/* Two directions on one button: ⊞ opens everything, ⌥-⊞ puts the
          source's own reading back (see resetToSource). Not a second rail
          slot — they are the same axis, and the rail is not growing a button
          per feature.

          ⌥ shows ↺ — restore, the one thing the modifier does here. It inks
          7.0px at the shared 14px against ⊞'s 7.3 (measured), so unlike the
          other two swaps it needs no size override. */}
      <RailButton
        glyph={alt ? "↺" : "⊞"}
        title="Expand all — unfold every branch and restore every elided run (⌥-click: back to the view the source asks for, .fold folded and .none ghosted)"
        onClick={(e) => (e.altKey ? onResetView() : onExpandAll())}
      />
      <RailButton glyph="⊟" title="Collapse all" onClick={onCollapseAll} />
      <div style={{ height: 6 }} />
      {/* Three layouts on one button (see LAYOUT_MODES): the glyph shows the
          CURRENT mode, pressed means "not the stacked home". */}
      <RailButton
        glyph={LAYOUT_MODES[layout].glyph}
        glyphPx={LAYOUT_MODES[layout].px}
        title={LAYOUT_MODES[layout].title}
        pressed={layout !== "stacked"}
        onClick={() => onLayoutChange(LAYOUT_MODES[layout].next)}
      />
      <ReflowControl
        reflow={reflow}
        forced={forcedReflow}
        onChange={onReflowChange}
        open={reflowOpen}
        onOpenChange={onReflowOpenChange}
      />
      {/* Comment strips on/off. `--` is Lean's own comment marker, so the
          glyph names what it hides; pressed = hidden, the away-from-home
          convention. Full-em ink like `||`, hence RAIL_GLYPH_FULL — at the
          shared 14px two hyphens draw a thin dash the eye slides off.

          § — the section mark — stands for PROSE, which is what narration puts
          in the box. It replaced ▤, a box filled with lines, which was the
          right idea and the wrong family: ▤ ▥ ◫ ▣ are all boxes-with-fill, and
          ◫ (side-by-side) is one flyout away. Leaving the box family is the
          whole point, so the sign is the text rather than the container. Inks
          10px at 11.5 (measured), the band the rest of the rail sits in.

          The RESTING glyph tracks the mode (the LAYOUT_MODES/HYP_MODES
          precedent): `--` while comments are shown or hidden, § while they are
          narrating. Without that, "hidden" and "narrating" were the same glyph
          in the same pressed state — indistinguishable on a control whose mode
          silently changes what double-click edits. ⌥ then shows the OTHER end
          of its axis, which is what a modifier hint is for; the earlier worry
          that no glyph could name a destination dissolves once the two
          destinations have distinct resting glyphs. */}
      <RailButton
        glyph={(commentMode === "instead") !== alt ? "❞" : "--"}
        glyphPx={
          (commentMode === "instead") !== alt
            ? RAIL_GLYPH_PROSE
            : RAIL_GLYPH_FULL
        }
        glyphDy={
          (commentMode === "instead") !== alt ? RAIL_GLYPH_PROSE_DY : undefined
        }
        title={
          commentMode === "instead"
            ? "Narration: each comment stands in for the tactic it decorates, the tactic itself available on hover (or double-click) — ⌥-click for the ordinary comment strips"
            : "Comments: draw the source's comment strips above the nodes they annotate (drag-select a node to hide just its own; ⌥-click: narration — the prose moves inside the box)"
        }
        pressed={commentMode !== "shown"}
        onClick={(e) =>
          onCommentModeChange(
            e.altKey
              ? commentMode === "instead"
                ? "shown"
                : "instead"
              : commentMode === "shown"
                ? "hidden"
                : "shown",
          )
        }
      />
      {/* Outline-only is NOT here: it is a standing preference about how boxes
          look rather than a gesture, so it lives in the companion's settings
          (`proofTree.outlineOnly`) and arrives as a prop. */}
      {/* ⌥ shows ⇌ — the two orderings exchanged. Not a glyph for either
          ORDER: the modifier flips between them, so a sign for one of the two
          would have to be the button's own resting glyph in the other state,
          i.e. show nothing changing exactly when you need to know the modifier
          is live. Same reason ▤ above names narration rather than the
          direction of the walk. The titles carry the direction; the glyph
          says which axis ⌥ moves you along. ⇌ inks 6.8px at 14 (in band), and
          is harpoons rather than ⇄'s full arrows so it cannot be read as the
          ⇉ two buttons above. */}
      <RailButton
        glyph={alt ? "⇌" : HYP_MODES[hypMode].glyph}
        title={`${HYP_MODES[hypMode].title}. ⌥-click: ${
          hypGroup
            ? "draw each context in Lean's original binder order instead of data-then-propositions"
            : "regroup each context data-then-propositions (currently binder order)"
        }`}
        // Pressed whenever the context is NOT the default breadth, so the rail
        // shows at a glance that something is being filtered or expanded. Home
        // is `used`; a rail button offers the DEPARTURE from home rather than
        // asking you to hold it pressed to stay there (the ⋔ layout button's
        // reasoning — keep the two in step if either default moves). Ungrouped
        // is a departure from home on the SECOND axis, so it presses the same
        // button; the two are told apart by the glyph (which tracks breadth
        // only) plus the boxes themselves, where losing the divider and the
        // data-first order is the visible answer.
        pressed={hypMode !== "used" || !hypGroup}
        onClick={(e) =>
          e.altKey
            ? onHypGroupChange(!hypGroup)
            : onHypModeChange(HYP_MODES[hypMode].next)
        }
      />
      {/* THE FLYOUT GROUPS — the rail's answer to having outgrown the frame.
          At 20 buttons the column was 646px against a ~580px default frame, so
          its tail (⛶, and `?` entirely) was CLIPPED by the root's
          overflow:hidden — invisible and unclickable, with no scroll that
          could reach it (the rail is a sibling of the scroll container). Six
          buttons fold into three heads; every control stays one click away.

          Members keep their exact former behaviour, titles and gates — only
          how they are REACHED changed. The picking modes were explicitly made
          a fan-out rather than a cycle: arming a mode you did not want takes
          over every click on the tree, which is the one thing a mis-cycle
          must not do. */}
      <RailFlyout
        id="structure"
        // A FORK pointing the way a CS tree grows — root above, branches
        // descending. U+2443 INVERTED fork, not U+2442: measured, ⑂ carries
        // its arms at the TOP (arm ink 157 above, 0 below) and ⑃ at the bottom
        // (0 above, 159 below), so ⑂ was a tree growing upward. It replaces
        // ⫴, three vertical bars, which sat four buttons from `||`
        // aligned-tracks and read as the same sign. Inks 9.4px at
        // RAIL_GLYPH_BIG, so it mints no new number; resolves in every
        // code-font stack tested, none falling back to ⬚.
        glyph="⑃"
        glyphPx={RAIL_GLYPH_BIG}
        label="Branch views"
        open={flyout === "structure"}
        onOpenChange={onFlyoutChange}
        members={[
          // Both ◫ and gallery are INERT under another mode, so both say so
          // rather than lighting up and doing nothing (the pressed/disabled
          // rule above). Neither clears its own state on disable: a rail
          // toggle is how this reader reads, so coming back to ☰ must restore
          // what was set. `away` mirrors each pressed expression, so the HEAD
          // also reports the effective state, never the overridden one.
          {
            glyph: "◫",
            title: sbsEnabled
              ? "Side-by-side branches: goals spawned by one tactic lay out as columns (compact mode; pairs well with ¶ reflow)"
              : "Side-by-side branches — compact layouts only; ⋔ wide lays branches out itself",
            away: sbsEnabled && sideBySide,
            disabled: !sbsEnabled,
            onClick: () => onSideBySideChange(!sideBySide),
          },
          {
            glyph: "❮❯",
            title: seqActive
              ? "Gallery — not while ⇝ has linearized a path; that already shows one branch"
              : "Gallery: show one of a branching tactic's subtrees at a time, cycled by the ‹ n/m › pager under it",
            away: gallery && !seqActive,
            disabled: seqActive,
            onClick: () => onGalleryChange(!gallery),
          },
          {
            glyph: "⇉",
            title:
              "Combine: merge each straight run of tactics into one node (stacked), dropping intermediate goals between them",
            away: combine,
            onClick: () => onCombineChange(!combine),
          },
        ]}
      />
      <RailFlyout
        id="reading"
        glyph="⋮"
        label="Reading aids"
        open={flyout === "reading"}
        onOpenChange={onFlyoutChange}
        members={[
          {
            glyph: "⇅",
            title:
              "Accordion: expanding a node collapses its sibling branches",
            away: accordion,
            onClick: () => onAccordionChange(!accordion),
          },
          {
            glyph: "⋯",
            title:
              "Brief: collapse boilerplate inside tactics to … (a binding's := derivation, a long [ … ] list), keeping the head and the bindings — hover a … to reveal it",
            away: brief,
            onClick: () => onBriefChange(!brief),
          },
        ]}
      />
      <RailFlyout
        id="picking"
        glyph="⌖"
        // The equal-INK rule: ⌖ inks 13px at the shared 14 (¶'s figure, but ¶
        // is a grandfathered outlier) — 12 brings it to 10, the band ⫴ (9) and
        // ⋮ (10) already sit in. Measured, like every override here.
        glyphPx={12}
        glyphWeight="bold"
        label="Pick on the tree"
        open={flyout === "picking"}
        onOpenChange={onFlyoutChange}
        members={[
          {
            glyph: "⇝",
            title: "Linearize one path: pick a start node, then an end node",
            away: seqActive,
            pressedColor: SEQ_STROKE,
            onClick: onToggleSequence,
          },
          {
            glyph: "⇥",
            title:
              "Elide a run of nodes: pick a start node, then an end node — the path between collapses to a marker (click it to restore)",
            away: elidePicking,
            pressedColor: SEQ_STROKE,
            onClick: onToggleElide,
          },
          {
            glyph: "⇳",
            title: bandEnabled
              ? "Cut a vertical band: pick a top node, then a bottom node — everything between them (any branch) collapses to a marker (click it to restore)"
              : "Cut a vertical band (compact stacked layout only)",
            away: bandPicking,
            pressedColor: SEQ_STROKE,
            disabled: !bandEnabled,
            onClick: onToggleBand,
          },
        ]}
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
      {/* The gesture reference, in its own divided group like ↶↷ at the top
          and for the same reason: it is not a view control. It does not breach
          "the rail is not growing a button per feature" — `?` is not a feature,
          it is the index of them. The rail is the ONLY visible entry point:
          the `?` key is the other, and a key you have to already know about is
          exactly why the panel needs a button somewhere. A per-node one was
          tried and removed — the hover bar appears over every box in the tree,
          so it charged every node forever for a question asked once. */}
      <div style={{ height: 6 }} />
      <div style={{ position: "relative", display: "flex" }}>
        <RailButton
          glyph="?"
          title="What you can do here: every gesture on the tree, in one panel (?)"
          pressed={helpOpen}
          onClick={() => onHelpOpenChange(!helpOpen)}
        />
        {helpOpen && (
          <HelpPanel
            caps={caps}
            fontFamily={fontFamily}
            onClose={() => onHelpOpenChange(false)}
          />
        )}
      </div>
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
  // Relation glyphs (≤ ∣ ⊆ ↔) are measured to size their chips, and
  // `measureText` measures in the EDITOR's code font — so those chips must
  // paint in it too, or the width and the glyph disagree. Everything else
  // stays UI chrome.
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
  /** Draw the outline UNBROKEN instead of dashed. Dashed is the resting state
  and means what it means everywhere else in this tree — a thing that is not
  in the proof yet (a ghost, a marker, a recovered node, a chip offering to
  write a tactic that does not exist). So an unbroken outline is available to
  say the opposite, and the selection pill spends it on the verbs that CHANGE
  YOUR FILE: solid past the seam, dashed before it. A shape, deliberately, not
  a colour — it is the channel that survives without hue, the same reason the
  connectors' target marks are the baseline and their tint is reinforcement. */
  solid?: boolean;
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
  /** Pointer entered/left this button. The one caller is ◌, which uses it to
  fade what the cut would take — an action whose EXTENT isn't obvious from the
  button deserves to show it before you commit, the armed delete's preview
  without the arming step (nothing is written here, so nothing needs confirming). */
  onHover?: (on: boolean) => void;
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
            onMouseEnter={a.onHover ? () => a.onHover!(true) : undefined}
            onMouseLeave={a.onHover ? () => a.onHover!(false) : undefined}
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
