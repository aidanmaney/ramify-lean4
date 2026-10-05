import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useLayoutEffect,
  useId,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { plainTicks } from "./ticks";
import {
  createLayoutEngine,
  hypLineOffset,
  LINE_H,
  NODE_FONT_PX,
  NODE_PAD,
  NODE_PAD_Y,
  ARROW_GAP,
  LINK_MARK_OFF,
  TRUNK_INSET,
  CHIP_TOP_GAP,
  COMMENT_FONT_PX,
  COMMENT_LINE_H,
  COMMENT_GAP,
  COMMENT_INDENT,
  COMMENT_MORE_PAD,
  COMMENT_RULE_INDENT,
  CASE_FONT_PX,
  CASE_LINE_H,
  bandTopH,
  inkExtent,
  commentStripTop,
  commentIndentOf,
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
  CORNER_W,
  FOLD_ICON,
  FOLD_PH_DROP,
  FOLD_PH_X,
  topLineMid,
  CASE_PREFIX,
  BADGE_H,
  badgeWidth,
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
  TRACEABLE_HEADS,
  isAutomationNode,
  tacticHeadWord,
  traceIndex,
  traceKey,
  traceTip,
} from "./trace";
import {
  DEFAULT_EXPERIENCE,
  PRESETS,
  readingName,
  type Experience,
  type ReadingId,
  type ReadingState,
} from "./experience";
import {
  CHECKED_FIRST,
  MOVE_IDS,
  togglePinned,
  type BarKind,
  type MoveId,
  type Unavailable,
  type Availability,
  unavailableTip,
  EXTRACT_MOVE_LABEL,
  PROPOSE_MOVE_LABEL,
  collapseMoveLabel,
  fixMoveLabel,
  expandMoveLabel,
  inlineMoveLabel,
  lintMoveLabel,
  pillMove,
  renameMoveLabel,
  traceMoveLabel,
} from "./moves";
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
import { layoutKeys, pathKeys, remapIds } from "./layoutKey";
import type {
  AddResult,
  AddSpec,
  CombinedPart,
  DeleteSpec,
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
  KEY_MENU,
  FLAG_GROUP,
  VERB_DOC,
  nodeHints,
  type Caps,
  type SelVerbDocKey,
} from "./gestures";
import { TipLayer } from "./tip";
import { TIP_DWELL_MS, TipContext, TipController } from "./tipController";
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
  HYP_LIT_STRONG_FILL,
  HOVER_BG,
  HOVER_BORDER,
  HOVER_FG,
  chromeSurface,
  GHOST_TEXT_FILL,
  TURNSTILE_FILL,
  LINK_STROKE,
  LINK_STROKE_GOAL,
  LINK_STROKE_TACTIC,
  MUTED_FILL,
  NODE_STYLES,
  NODE_TEXT,
  SEQ_STROKE,
  SORRY_FILL,
  DANGER_FILL,
  POPUP_CHROME,
  STICKY_BG,
  STICKY_BORDER,
  STICKY_SHADOW,
  CHROME_BG,
  CHROME_UNDERLAY,
  CHROME_BORDER,
  CHROME_INK,
  CHROME_FONT,
  CHROME_RADIUS,
  DIM_OPACITY,
  TOKEN_VARS,
  ensurePaletteStyle,
  observeThemeChange,
  resolveThemeKind,
  Z,
  CHIP_SHADOW,
  FAINT_OPACITY,
  PREVIEW_OPACITY,
  STUB_OPACITY,
  WASH_OPACITY,
  TREE_INK_SW_BOLD,
  CHROME_TEXT_SM,
  FOCUS_INK,
  LIGHTBULB_INK,
  LIGHTBULB_AUTOFIX_INK,
} from "./theme";
import { HypBlock } from "./hypBlock";
import {
  COMPACT_LEFT,
  EDIT_STROKE,
  type FollowAnim,
  MARGIN,
  animateScroll,
  cancelFollow,
  cfStubNodeId,
  clampScroll,
  clampZoom,
  editOverlayLayer,
  inViewScroll,
  nodeBoxFill,
  nodeRx,
} from "./scrollHelpers";
import {
  COMMENT_MODES,
  type CommentMode,
  HYP_MODES,
  LAYOUT_MODES,
  layoutArgs,
  type LayoutMode,
} from "./viewModes";
import {
  BAR_H,
  CORNER_HIT_H,
  STATUS_NAME_MAX,
} from "./barMetrics";
import { Codicon } from "./codiconView";
import { DiagIcon } from "./diagBar";
import { PillPlace } from "./selectionPill";
import { pillCandidates } from "./pillPlace";
import { DiagMark, SquigglePatterns } from "./squiggle";
import { ringPath } from "./ringPath";
import { RIBBON_TAB_GAP, diagGlyphOf, diagInkOf, diagWordOf } from "./diagInk";
import {
  AppearanceContext,
  DEFAULT_APPEARANCE,
  type Appearance,
} from "./appearance";
import { HopChip, LinkMark, TopCentre, TourTab, ZoomRail } from "./topChrome";
import { type BandPlace, StatusBar } from "./statusBar";
import {
  CHIP_FONT_PX,
  CHIP_GAP,
  CHIP_H,
  CHIP_W_ADD,
  chipWidth,
} from "./chipMetrics";
import { FrontierChip, GalleryPager, PickerRow } from "./pickChips";
import { BAR_GAP, BAR_OVERLAP } from "./hoverBarMetrics";
import { appliesToKind, disabledSlot, MOVE_LOOK } from "./moveSlots";
import { MENU_ICON } from "./menuIcons";
import { clipText } from "./clipText";
import { injectStyleOnce } from "./taggedCore";
import { useOverride } from "./useOverride";
import { settingValue, type SettingId, type ViewSettings } from "./viewSettings";
import { addChipGlyph, chipCopy, chipRows, HOLE_GLYPH } from "./chipMoves";
import { NodeActionBar, NodeMenu, type NodeMove } from "./nodeBar";

interface Anchor {
  id: string;
  key: string;
  x: number;
  y: number;
}

const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

// A mode change confirms itself top-centre for this long, then vanishes.
// `window.setTimeout`, never rAF: a hidden webview fires no animation frames.
const TOAST_MS = 1500;
/** How long the first half of a key chord (`${CMD}K`) waits for its second. */
const CHORD_MS = 1000;
/** A toast that carries a button (Undo) stays long enough to reach it. */
const TOAST_ACTION_MS = 6000;

const errMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

const TRACE_ASK_FAILED =
  "Could not ask Lean what this step used — the request failed; try again once the file finishes loading";

/** The first line of `s`, clipped to `n` characters with `…` where it was cut
 (never a bare slice, which stops mid-word and says nothing about it). */
const clipLine = (s: string, n: number): string =>
  clipText((s.split("\n")[0] ?? "").trim(), n);

const CARD_PAD = 4;

const CHIP_W_SORRY = 36;

const addChipWidth = (spec: AddSpec | undefined) =>
  spec?.kind === "hole" ? chipWidth(HOLE_GLYPH, CHIP_FONT_PX) : CHIP_W_ADD;

const chipLaneXs = (spec: AddSpec | undefined): [number, number, number] => {
  const x0 = -CHIP_W_ADD / 2;
  const x1 = x0 + addChipWidth(spec) + CHIP_GAP;
  return [x0, x1, x1 + CHIP_W_SORRY + CHIP_GAP];
};
const CHIP_W_STEP = 30;

const CLOSE_RHS = "_";

/** The empty editor's placeholder (what Enter will do): italic comment ink. */
// While the frame scrolls, the tree takes no pointer events: boxes slide
// under a resting pointer during a pan, and each one entered ran the node's
// hover (a re-render for its bar) — Firefox also sends a synthetic mousemove
// per scroll step, whose handler reads two rects (a forced layout of the tree).
// Hit testing returns ~150ms after the last scroll, with one hover update.
const SCROLLING_CSS = `[data-ptw-scrolling] > svg{pointer-events:none}`;
const SCROLL_SETTLE_MS = 150;

const HINT_CSS = `textarea[data-ptw-hint]::placeholder{color:${COMMENT_FILL};font-style:italic;opacity:1}`;

const PILL_FONT_PX = 11;

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

// How far the tour nub's invisible hit region reaches beyond the tab's own
// rect, on every side. Wide enough that a pointer travelling towards the
// corner from OUTSIDE the box crosses it (the tab straddles the corner, so
// half the region already lies outside), and small enough that inside the box
// it stops at the tab's own height — the first hyp line's text is not covered.
const NUB_SLACK = 8;

const FLOATER_H = 36;

// The signature header's height AT REST, as the header itself codes it: one
// `pre` line of `LINE_H`, 6px of padding above and below, and the 1px bottom
// border. Measured 29 in the harness, which is what this comes to. It is the
// floor under the measured `hdrH`, so nothing that reads the header's height —
// the rail's `floaterTop(0)` above all — can be told the header is 0 tall
// while one is drawn.
const HDR_REST_H = LINE_H + 13;

// The header's `▾` (open the full signature): a fixed box at the band's right
// edge, and the right padding both header states keep clear for it. Drawn
// only where the resting line HIDES something (2026-09-22): where the whole
// signature fits, there is nothing to open and the lane goes back to the
// ordinary `HDR_PAD_X`. The box is the status bar's item height (20) — the
// hit target — and the mark inside it the codicon `chevron-down`/`-up`
// (2026-10-04; it was a drawn 8×5 chevron). The lane reserves the BOX, so the
// ink can change without touching the measure.
/** CLASSIC (appearance.ts; 5a504e7^): the goal corner's drawn `−` — its
 length and stroke, about the weight of the `+N` it becomes. */
const CLASSIC_MINUS_W = 6;
const CLASSIC_MINUS_SW = 1.15;

const HDR_BTN_W = 20;
const HDR_BTN_RIGHT = 6;
const HDR_BTN_LANE = HDR_BTN_W + HDR_BTN_RIGHT + 8;
const HDR_PAD_X = 10;
// The resting text's right-edge fade where it is wider than the band.
const HDR_FADE = "linear-gradient(to right, #000 calc(100% - 24px), transparent)";

/** Screen px the zoom rail stands in at the frame's bottom right (its two
 groups and its gap above the band): the least padding below the last node,
 zoomed far out, so it can always be scrolled clear of the rail. */
const RAIL_CLEAR = 140;

/** How far LEFT of both boxes the provenance connector's vertical run sits,
 so the elbow clears the node it leaves and the node it arrives at. */
const ORIGIN_CHANNEL = 12;

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
   positions the server found in it by syntax KIND (paperproof.ts): the
   signature's start (the name ends there), the type spec's `:` (binders end
   there) and the body's `:=`/`|`/`where` (the whole signature ends there).
   The resting header is the LONGEST of those cuts that fits on one line.
   Absent → the header falls back to its first source line. */
  declHeaderStart?: { line: number; character: number };
  declHeaderNameStop?: { line: number; character: number };
  declHeaderSigStop?: { line: number; character: number };
  declHeaderBodyStop?: { line: number; character: number };

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

  /** The text signature the held traces are OUT OF DATE against (an edit
      landed since they were read), else null. While a trace is open — the
      reader's `⁇` or the beginner preset's auto-open — the view re-asks
      through `onTrace`, once per signature; with none open nothing is
      asked, so an edit pause costs no re-elaboration. */
  automationTracesStaleVer?: string | null;

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
      `polishReady` false, the `polish` row is NOT DRAWN (2026-09-22: a
      reader with no key should not meet a feature that needs one). */
  onPolish?: (lines: PolishLine[]) => Promise<{ nodeId: string; text: string }[]>;
  /** Is there a companion with an API key behind `onPolish`? */
  polishReady?: boolean;
  /** The `ramify.narration.polish` setting — the SESSION's default, which the
      row then overrides for this session alone. */
  polishDefault?: boolean;

  /** `ramify.experience` (experience.ts): fills the DEFAULTS of the hover
      bar's buttons, the cursor's automation trace, the `⇓` offer, and the
      lints/comments/context/brief rows. Each row the reader changes is a
      session OVERRIDE and wins. Absent: intermediate. */
  experience?: Experience;

  /** `ramify.appearance` (appearance.ts): the VS Code look (default) or the
      classic skin. PAINT ONLY — the layout never reads it. The Layout
      panel's `classic look` row is a session override on top. */
  appearance?: Appearance;

  /** `ramify.hoverBar.tactic` / `.goal` — the hover bar's buttons per node
      kind, in order, where the reader SET them (the companion sends a list
      only when `inspect()` finds one; the harness takes `?hoverbar-tactic=`).
      Absent, the preset's list stands. A pin in the `⋯` menu wins over both
      for the session and calls `onHoverBarChange` so the setting follows. */
  hoverBar?: { tactic?: readonly MoveId[] | null; goal?: readonly MoveId[] | null };
  onHoverBarChange?: (kind: BarKind, ids: MoveId[]) => void;

  /** The SETTINGS BEHIND THE BAND (viewSettings.ts, batch 5): `ramify.view.*`,
      `ramify.reading.*`, `ramify.diagnostics.autoOpen`, each present only
      where the reader SET it. Each row's default is the setting, else the
      preset's, else the view's own; the row the reader changes is a session
      override on top (`useOverride`). */
  settings?: ViewSettings;
  /** Persist a band / panel change: the widget asks the companion to write
      `ramify.<key>` (`popoutEdit` action `setting`). Absent (no companion,
      the static viewer) a change is session-only, as before. */
  onSettingChange?: (id: SettingId, value: string | number | boolean) => void;

  /** D6 — ASK AN AGENT to choose among the rewrites the primitives already
      offer. The view hands over the offered rewrites (never free text) and is
      handed back one node id, one kind and a one-line reason; the choice then
      goes through `onCheckRewrite` like every other proposal. */
  onPropose?: (req: {
    text: string;
    primitives: { nodeId: string; kind: Rewrite["kind"]; title: string }[];
  }) => Promise<{ nodeId?: string; kind?: string; reason?: string; note?: string }>;
  /** Is `ramify.restructure.propose` on, with a companion and a key behind it?
      False, the `suggest a rewrite` row is not drawn. */
  proposeReady?: boolean;

  onPreviewRange?: (range: ProofStepPosition | null) => void;

  /** The undo relay. What only the Ramify extension can do — this, the lens
      (`onPopoutEdit`), the hover highlight and the range previews — is passed
      only where the extension is there: absent, the lens is gone from the bar
      and the `⋯` menu, and ⌘Z says why instead of nothing. */
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

  /** The reading state to START in, where a caller has one to restore (the
      static viewer's deep links): the layout, the context mode and the
      comment mode. Each is the DEFAULT of the same session state the status
      bar changes (`useOverride`), ahead of the setting and the preset, so the
      reader's own choice wins over it and a caller that follows the reader
      (the viewer's hash, via `onViewState`) only moves it to what is shown.
      Absent, the defaults (the setting, else outline / the preset's). */
  initialView?: {
    layout?: LayoutMode;
    context?: HypMode;
    comments?: CommentMode;
  };

  /** Told the three `initialView` values whenever one changes, so a caller
      can keep a shareable link in step (the viewer writes its URL hash). */
  onViewState?: (s: {
    layout: LayoutMode;
    context: HypMode;
    comments: CommentMode;
  }) => void;
}

/** No setting set: every row reads the preset / the view's own default. */
const NO_SETTINGS: ViewSettings = {};
/** How long the Width slider must rest before its value is written. */
const PERSIST_SETTLE_MS = 500;

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
  declHeaderBodyStop,
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
  automationTracesStaleVer = null,
  ledger = true,
  onDeleteTactic,
  onCheckRewrite,
  onTryClose,
  onApplyRewrite,
  onPolish,
  polishReady = false,
  polishDefault = false,
  onPropose,
  proposeReady = false,
  onPreviewRange,
  onUndo,
  abbrev = DEFAULT_ABBREV,
  diagnostics,
  lints,
  onLints,
  experience = DEFAULT_EXPERIENCE,
  appearance: appearanceDefault = DEFAULT_APPEARANCE,
  hoverBar,
  onHoverBarChange,
  settings: viewSettings = NO_SETTINGS,
  onSettingChange,
  initialView,
  onViewState,
}: ProofTreeViewProps) {
  const preset = PRESETS[experience];

  // THE APPEARANCE (appearance.ts): the setting, with the Layout panel's
  // `classic look` row as a session override. One value, handed to every
  // seam through `AppearanceContext` and to the token layer through
  // `data-ptw-appearance`; nothing that measures reads it.
  const [appearance, setAppearance] = useOverride<Appearance>(appearanceDefault);
  const classic = appearance === "classic";

  // THE HOVER BAR'S BUTTONS, per node kind: the session's pins (`⋯` menu),
  // else the reader's setting, else the preset — the override idiom again,
  // so a setting arriving late from the theme file needs no effect.
  const [pinOverride, setPinOverride] = useState<
    Partial<Record<BarKind, MoveId[]>>
  >({});
  const barIds: Record<BarKind, readonly MoveId[]> = {
    tactic: pinOverride.tactic ?? hoverBar?.tactic ?? preset.hoverBar.tactic,
    goal: pinOverride.goal ?? hoverBar?.goal ?? preset.hoverBar.goal,
  };

  // B2's hypothesis → origin CONNECTOR (hovering a context line draws a
  // dashed line to the step that introduced it, and washes that step). OFF
  // by default at every experience level (2026-09-22): it drew on every pass
  // of the pointer over a context. A reading option; the line's `<title>`
  // says where the hypothesis came from either way.
  // A preset row (beginner ON) with the session override on top.
  const [hypOriginsOn, setHypOriginsOn] = useOverride(
    viewSettings.hypOrigins ?? preset.hypOrigins,
  );
  const [upToCursor, setUpToCursor] = useOverride(
    viewSettings.upToCursor ?? false,
  );

  // The rows `ramify.experience` fills are OVERRIDES of the preset
  // (`useOverride`): a preset that arrives late — the companion's theme file
  // is read after mount — needs no effect, and a row the reader has set keeps
  // the reader's value.
  const [hypMode, setHypMode] = useOverride<HypMode>(
    initialView?.context ?? viewSettings.context ?? preset.context,
  );

  // Lean's own binder order is the DEFAULT; `Split data & props` is the
  // opt-in extra (and `proofToTree`'s option default matches, so module and
  // bar cannot drift).
  const [hypGroup, setHypGroup] = useOverride(viewSettings.hypGroup ?? false);

  const [layout, setLayout] = useOverride<LayoutMode>(
    initialView?.layout ?? viewSettings.layout ?? "stacked",
  );
  const { compact, aside } = layoutArgs(layout);

  const [reflow, setReflow] = useOverride<ReflowMode>(
    viewSettings.width ?? "off",
  );

  const [barOpen, setBarOpen] = useState<string | null>(null);
  // The Width slider's pending setting write (`persistLater`).
  const persistTimer = useRef<number | undefined>(undefined);

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
    polish: !!onPolish && polishReady,
  };

  const forcedReflow =
    layout === "tracks" && reflow === "off" ? REFLOW_CHARS : undefined;

  const [brief, setBrief] = useOverride(viewSettings.brief ?? preset.brief);

  const [briefHover, setBriefHover] = useState(false);
  const briefPreviewOn = briefHover && !brief;

  const [combine, setCombine] = useOverride(viewSettings.merge ?? false);

  // D4 — the LINTS reading option. OFF by default and off until the reader
  // asks: the answer costs the server one re-elaboration of the declaration,
  // exactly as B4's traces do, so nothing fires it on arrival. The lints
  // themselves live with the caller (a sibling prop) and fall back to the
  // NDJSON's own field; this is only whether they are being read.
  const [lintsOn, setLintsOn] = useOverride(viewSettings.lints ?? preset.lints);

  // C4 — the POLISH reading option. The setting (`ramify.narration.polish`,
  // off by default) is the DEFAULT and the row overrides it for this session,
  // so the state is an OVERRIDE and not a copy: a copy would have to be
  // synced from an effect when the companion's answer arrives late, and the
  // setting would then quietly lose to a value nobody chose.
  const [polishWanted, setPolishWanted] = useOverride(polishDefault);
  const polishOn = polishWanted && polishReady;
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

  const [commentMode, setCommentMode] = useOverride<CommentMode>(
    initialView?.comments ?? viewSettings.comments ?? preset.comments,
  );
  // The caller's link follows the reading state (no state here: a callback
  // out to an external system, the page's URL).
  useEffect(() => {
    onViewState?.({ layout, context: hypMode, comments: commentMode });
  }, [onViewState, layout, hypMode, commentMode]);

  // Paint-only confirmation of a mode change, so a keystroke says what it did.
  // Replaced (never queued) when a new message arrives: the timer is reset, so
  // holding `l` down reads as one message changing rather than a stack.
  const [toast, setToast] = useState<{
    text: string;
    key: number;
    anchored?: boolean;
    action?: { label: string; run: () => void };
  } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  // `anchored`: the toast is a FIXED-WIDTH, left-aligned box rather than a
  // centred one, so a leading counter (`2/5 · caption`) keeps ONE x across a
  // run of them and the eye, parked on the counter, reads what follows it.
  // Centred, the counter drifted with each caption's length (user report,
  // reading marks in sequence).
  //
  // `action` is an optional BUTTON in the toast (`Undo`, for the bulk reader-
  // state discards): a real `<button>`, so the keyboard reaches it, and the
  // toast waits `TOAST_ACTION_MS` instead of `TOAST_MS`. The closure it runs
  // is the ONE-LEVEL stash — it captured the state the gesture replaced, and
  // the next toast replaces it.
  const showToast = (
    text: string,
    anchored = false,
    action?: { label: string; run: () => void },
  ) => {
    setToast((t) => ({ text, key: (t?.key ?? 0) + 1, anchored, action }));
    if (toastTimer.current !== undefined)
      window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      toastTimer.current = undefined;
      setToast(null);
    }, action ? TOAST_ACTION_MS : TOAST_MS);
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

  const [sideBySide, setSideBySide] = useOverride(
    viewSettings.sideBySide ?? false,
  );

  const [gallery, setGallery] = useOverride(viewSettings.gallery ?? false);
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
  // The current stop is held by NODE ID and its place in the list is DERIVED
  // (`tourAt`, below): dropping or removing a mark, or a `.mark` edit in the
  // source, re-sorts the list, and a stored index would jump to another stop
  // while the bar still said the old number. An id that is in no stop (its
  // mark went, a re-parse dropped it) reads as NOT STARTED.
  const [tourCur, setTourCur] = useState<string | null>(null);
  const [tourPeek, setTourPeek] = useState<Set<string>>(new Set());

  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);

  const [selection, setSelection] = useState<Set<string> | null>(null);
  // Where a keyboard selection (Shift+↑/↓) started. Read only while it is
  // still IN the selection (a marquee or a re-parse leaves it stale, and the
  // active node starts a fresh one), so nothing has to reset it.
  const [selAnchor, setSelAnchor] = useState<string | null>(null);

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

  // THE PREVIEW DWELL (2026-09-24). A hover preview that dims or washes nodes
  // — the trash can's delete extent, the goal corner `−`'s fold, ◌'s skip,
  // the `brief` row's wash — waits the tips' own `TIP_DWELL_MS` and is
  // dropped if the pointer leaves first: shown at once, a pointer crossing
  // the hover bar on its way somewhere else flashed half the tree. ONE timer,
  // since the pointer is over one control at a time; armed in pointerenter,
  // cancelled in pointerleave, on a click and on unmount. Handlers only —
  // render never reads the ref. The ⌥-held preview stays immediate: holding
  // a modifier is a deliberate ask, not a pointer passing through.
  const dwellRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelDwell = () => {
    if (dwellRef.current !== null) clearTimeout(dwellRef.current);
    dwellRef.current = null;
  };
  const afterDwell = (show: () => void) => {
    cancelDwell();
    dwellRef.current = setTimeout(() => {
      dwellRef.current = null;
      show();
    }, TIP_DWELL_MS);
  };
  const dropCornerPreview = () => {
    cancelDwell();
    setElidePreview((pv) => (pv?.from === "bar" ? null : pv));
  };
  useEffect(() => {
    const r = dwellRef;
    return () => {
      if (r.current !== null) clearTimeout(r.current);
    };
  }, []);

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

  // The frame's own element, in STATE (a callback ref), so the `⋯` menu can
  // be portalled into it from inside the node loop without a ref read.
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);

  // THE `⋯` MENU: which node it is open on, the proof it was opened in (a
  // proof change closes it by construction as well as by the reset below),
  // and the `⋯` button's rect in FRAME coordinates, taken at the click.
  const [nodeMenu, setNodeMenu] = useState<{
    id: string;
    proof: string;
    x: number;
    top: number;
    bottom: number;
    /** Opened by a right-click: hung AT the pointer (top = bottom). */
    pointer?: boolean;
    /** Opened by the lightbulb or ${CMD}. (batch 4): at the Quick Fix /
     Refactor sections. */
    fixes?: boolean;
  } | null>(null);

  // KEYBOARD NAVIGATION OF NODES (2026-09-28). The scroll frame is ONE tab
  // stop (`role="tree"`, `aria-activedescendant`); `activeId` is the node the
  // arrows are on. It is keyboard-only chrome — set by keys and by a press on
  // a node (so the keys resume from where the mouse left off), never by
  // hover — and it may go stale (a fold hid it, a proof left): `activeNow`
  // below is the DERIVED answer and falls back to the cursor's node, then the
  // first. `treeFocus` is `:focus-visible` by hand: the ring is drawn only
  // for `kb`, so a click in the frame paints none.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [treeFocus, setTreeFocus] = useState<"none" | "kb" | "mouse">("none");
  const treeUid = useId().replace(/[^A-Za-z0-9]/g, "");
  // Set by a key that hands focus to an overlay (the `⋯` menu, F2's editor):
  // whichever closes it gives focus back to the frame.
  const restoreFocus = useRef(false);
  // The editor's two-key CHORDS (${CMD}K ${CMD}0 / ${CMD}K ${CMD}J): when the
  // first half was pressed, 0 when none is pending. Read and written by the
  // frame's key handler alone, never in render; a chord older than
  // `CHORD_MS`, or any other key in between, lets it go.
  const chordAt = useRef(0);

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
    // The `⋯` menu is the most recently opened floater whenever it is up.
    {
      id: "nodeMenu",
      up: nodeMenu !== null,
      off: () => setNodeMenu(null),
      bg: true,
    },
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

    // The MESSAGE STRIP over the status card: chrome the reader reads rather
    // than a prompt they answer, so it goes AFTER the prompts above — an
    // armed delete or a pending proposal is the more urgent thing for Esc to
    // take — and before the selection and the scopes. It is not `bg`: an error that
    // opened itself must not be closed by a stray click on the canvas. Its
    // state is derived far below this table, so `up` is read at Esc time
    // (`upNow`), and `off` is two plain setters.
    {
      id: "diagStrip",
      up: false,
      upNow: () => diagStripOpen,
      off: () => closeDiagStrip(),
      bg: false,
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
      up: tourCur !== null,
      // Esc must not be spent on a reading nobody can see: the stop's mark
      // may be gone (a derived not-started), and `up` is stale-safe only here.
      upNow: () => currentStopId !== null,
      off: () => {
        setTourCur(null);
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

  // Without the extension there is no undo to relay: say so on the key
  // instead of leaving it dead (the editor's own ⌘Z still works when the
  // editor has focus). Nothing is prevented — the press goes on.
  useEffect(() => {
    if (onUndo) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      toastRef.current("Undo needs the Ramify extension");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onUndo]);

  useEffect(() => {
    if (!onUndo) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      e.preventDefault();
      // No toast: the editor's own change is the feedback, and this side
      // cannot know whether anything was undoable.
      onUndo(e.shiftKey);
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
        // The companion relays ⌘Z, so the toast can offer it as a button.
        showToast(
          "Comment deleted",
          false,
          onUndo ? { label: "Undo", run: () => onUndo(false) } : undefined,
        );
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
  /** A chip's choice made (or needing none): the chain-opening kinds start a
   `calc` chain, the others ask for the new link's right-hand side. One path
   for the chip's own click and the relation picker's. */
  const finishPick = (
    id: string,
    kind: "open" | "link" | "append" | "first",
    spec: AddSpec,
    rel: string,
    same: boolean,
  ) => {
    if (kind === "open" || kind === "first") {
      startChain(id, spec, rel, same);
      return;
    }
    setEditing({
      id,
      pos: spec.after,
      original: "",
      value: CLOSE_RHS,
      add: spec,
    });
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

  // The BASE tree by id, built once per tree and NEVER mutated (elide.ts caches
  // its child index and preorder on this very map, so every reader that shares
  // it shares the caches too).
  const baseById = useMemo(
    () => new Map(baseNodes.map((n) => [n.id, n])),
    [baseNodes],
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
  const tourAt = tourCur === null
    ? null
    : (() => {
        const i = tourStops.findIndex((s) => s.id === tourCur);
        return i < 0 ? null : i;
      })();
  const currentStopId = tourAt === null ? null : tourCur;

  const peekable = useMemo(() => {
    const seeded = new Set(sourceView(baseNodes).map(cutId));
    const out: { id: string; ranges: ProofStepPosition[] }[] = [];
    for (const cut of elideCuts) {
      const id = cutId(cut);
      if (!seeded.has(id)) continue;
      // TACTIC members only. A `fold` takes a whole subtree, and a spawned
      // root in it carries its PRODUCER's position — a range outside the cut
      // entirely, which would peek the branch open from a line it does not
      // stand for.
      const ranges = resolveCut(cut, baseById)
        .map((m) => baseById.get(m))
        .filter((n) => n?.type === "tactic")
        .map((n) => n?.position)
        .filter((p): p is ProofStepPosition => !!p);
      if (ranges.length > 0) out.push({ id, ranges });
    }
    return out;
  }, [baseNodes, baseById, elideCuts]);

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

  // `ramify.experience` beginner: THE CURSOR'S AUTOMATION STEP SHOWS WHAT IT
  // USED without being asked. Only a step with a `?` form (`simp`, `grind`,
  // …) — an `omega` has nothing to show — and only the one under the cursor,
  // read off the BASE tree (the drawn tree is downstream of the traces). The
  // open state is DERIVED, not written: the step is open while the cursor is
  // on it and its trace is in hand, unless the reader shut it with `⁇`
  // (`traceShut`). Opening is a relayout like any other, and the cursor chain
  // is what the relayout anchors on, so the view holds still.
  const autoTrace = useMemo(() => {
    if (!preset.autoTrace || !highlightPos) return null;
    const at = tacticNodeAt(tacticTargets(baseNodes), highlightPos);
    const n = at ? baseNodes.find((x) => x.id === at) : undefined;
    if (!n?.position || !isAutomationNode(n)) return null;
    if (!TRACEABLE_HEADS.includes(tacticHeadWord(n.label))) return null;
    return { id: n.id, key: traceKey(n.position.start), pos: n.position };
  }, [preset.autoTrace, highlightPos, baseNodes]);
  const [traceShut, setTraceShut] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const autoOpenId =
    autoTrace && traces.has(autoTrace.key) && !traceShut.has(autoTrace.id)
      ? autoTrace.id
      : null;
  const traceOpenNow = useMemo(
    () =>
      autoOpenId && !traceOpen.has(autoOpenId)
        ? new Set([...traceOpen, autoOpenId])
        : traceOpen,
    [traceOpen, autoOpenId],
  );

  const treeNodes = useMemo(() => {
    let cuts = elideCuts;
    if (combine) {
      const manual = new Set<string>(combineOff);
      for (const c of elideCuts)
        for (const id of resolveCut(c, baseById)) manual.add(id);
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
    return applyTraces(applyElisions(baseNodes, cuts), traceOpenNow, traces);
  }, [
    baseNodes,
    baseById,
    elideCuts,
    combine,
    combineOff,
    peekKey,
    tourPeek,
    traceOpenNow,
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
  // …and the fetch for the preset's auto-open, once per step per proof: the
  // answer lands in the caller's `traces` and the derivation above opens it.
  // An effect because it is a request, not state — nothing is set here.
  const autoAsked = useRef(new Set<string>());
  useEffect(() => {
    if (!autoTrace || !onTrace || traces.has(autoTrace.key)) return;
    const k = `${proofKey}@${autoTrace.key}`;
    if (autoAsked.current.has(k)) return;
    autoAsked.current.add(k);
    onTrace(autoTrace.pos).catch(() => {});
  }, [autoTrace, onTrace, traces, proofKey]);

  // …and the RE-ASK after an edit, only while some trace is open (the same
  // request-not-state effect). One ask answers for the whole declaration, so
  // the first open step's position will do; a failed ask is not retried for
  // the same text.
  const staleAsked = useRef(new Set<string>());
  useEffect(() => {
    if (!automationTracesStaleVer || !onTrace || traceOpenNow.size === 0)
      return;
    const k = `${proofKey}@${automationTracesStaleVer}`;
    if (staleAsked.current.has(k)) return;
    const open = baseNodes.find(
      (n) => n.position && traceOpenNow.has(n.id),
    );
    if (!open?.position) return;
    staleAsked.current.add(k);
    onTrace(open.position).catch(() => {});
  }, [automationTracesStaleVer, onTrace, traceOpenNow, baseNodes, proofKey]);

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
    setNodeMenu(null);
    setActiveId(null);
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
    if (activeId) {
      const moved = to(activeId);
      setActiveId(live.has(moved) ? moved : null);
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
    if (tourCur) {
      const moved = to(tourCur);
      setTourCur(live.has(moved) ? moved : null);
    }

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
    setTourCur(null);
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

  // The drawn tree as the keys walk it: DFS PREORDER over the placed links
  // (siblings in the layout's own order, i.e. their order in `nodes`), each
  // node's parent, and its depth (`aria-level`). Read off the DRAWN tree, so a
  // fold or a hop changes what the arrows reach exactly as it changes what
  // the eye does.
  const nav = useMemo(() => {
    const rank = new Map(nodes.map((n, i) => [n.data.id, i]));
    const kids = new Map<string, string[]>();
    const hasIn = new Set<string>();
    for (const l of links) {
      const s = l.source.data.id;
      const t = l.target.data.id;
      (kids.get(s) ?? kids.set(s, []).get(s)!).push(t);
      hasIn.add(t);
    }
    for (const ks of kids.values())
      ks.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    const order: string[] = [];
    const parent = new Map<string, string>();
    const depth = new Map<string, number>();
    const walk = (root: string) => {
      const stack: [string, number][] = [[root, 0]];
      while (stack.length > 0) {
        const [id, d] = stack.pop()!;
        if (depth.has(id)) continue;
        depth.set(id, d);
        order.push(id);
        const ks = kids.get(id) ?? [];
        for (let i = ks.length - 1; i >= 0; i--) {
          if (!depth.has(ks[i]) && !parent.has(ks[i])) parent.set(ks[i], id);
          stack.push([ks[i], d + 1]);
        }
      }
    };
    for (const n of nodes) if (!hasIn.has(n.data.id)) walk(n.data.id);
    for (const n of nodes) if (!depth.has(n.data.id)) walk(n.data.id);
    const index = new Map(order.map((id, i) => [id, i]));
    return { order, index, parent, depth, kids };
  }, [nodes, links]);

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
    const t = setTimeout(() => setHypLit(hoverId), TIP_DWELL_MS);

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
    if (!hypOriginsOn || !hypOrigin || hypOrigin !== hoverHyp) return null;
    const sep = hypOrigin.indexOf("\u0000");
    const gn = placed.get(hypOrigin.slice(0, sep));
    const j = Number(hypOrigin.slice(sep + 1));
    const lines = gn?.data.hyps;
    const line = lines?.[j];
    if (!gn || !lines || !line?.origin) return null;
    const tn = placed.get(line.origin);
    return tn ? { gn, lines, j, tn } : null;
  }, [hypOriginsOn, hypOrigin, hoverHyp, placed]);

  useEffect(() => {
    if (!hoverHyp) return;
    const t = setTimeout(() => setHypOrigin(hoverHyp), TIP_DWELL_MS);
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

    for (const n of nodes) {
      if (n.data.elidedCut?.combined) {
        const anchors: ProofStepPosition[] = [];
        const comments: ProofStepPosition[] = [];
        for (const m of combineMemberIds(n.data.id) ?? []) {
          const b = baseById.get(m);
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
  }, [nodes, baseById, deleteSlots, onDeleteTactic]);

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
      // The labels as WRITTEN, not as brief draws them: rewrite.ts reads a
      // step's head word off its label (`have`, the user's `exact`), and
      // brief's E1 turns `have hp1 : …` into `… hp1 : …` — so brief mode
      // silently withdrew `⤵` everywhere (found 2026-09-22, when the expert
      // preset made brief a default).
      nodes: treeNodes.map((n) =>
        n.elision ? { ...n, label: n.elision.original } : n,
      ),
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
        keep((cur) => ({
          ...cur,
          phase: "bad",
          message: errMessage(e),
        })),
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

  // `only`: the lightbulb's "Ask the model for a rewrite" row (batch 4) — the
  // model still reads the whole outline, but may pick only among THIS node's
  // rewrites (the row is drawn only where there is one). Without it, the
  // reading panel's proof-wide ask.
  const askAgent = (only?: string) => {
    if (!onPropose || proposeBusy) return;
    const offered = only
      ? agentPrimitives.filter((p) => p.nodeId === only)
      : agentPrimitives;
    if (offered.length === 0) {
      showToast("Nothing to propose — no rewrite is offered on this proof");
      return;
    }
    setProposeBusy(true);
    void onPropose({
      text: agentText(),
      primitives: offered.map(({ nodeId, kind, title }) => ({
        nodeId,
        kind,
        title,
      })),
    }).then(
      (res) => {
        setProposeBusy(false);
        const hit = offered.find(
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
        // An error from the extension's model channel is nearly always the
        // key; anything else says what it said, first line, clipped.
        const raw = errMessage(e);
        showToast(
          /key|401|403|auth|unauthori[sz]ed/i.test(raw)
            ? "Could not get a suggestion — check the key with Ramify: Set model API key"
            : `Could not get a suggestion — ${clipLine(raw, 60)}`,
          true,
        );
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
      showToast(
        `Could not replace these steps — ${stub.why || "they cannot be rewritten as one tactic here"}`,
      );
      return;
    }
    setProposal({
      id,
      kind: "collapse",
      rewrite: stub.rewrite,
      phase: "checking",
      title: collapseMoveLabel(n),
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
          keep((cur) => ({
            ...cur,
            phase: "bad",
            message: won.why || "the rewrite cannot be built",
          }));
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
        keep((cur) => ({
          ...cur,
          phase: "bad",
          message: errMessage(e),
        })),
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
        if (!ok)
          return showToast(
            `Lean could not say what \`${tacticHeadWord(n.label)}\` used`,
          );
        const t = traceRef.current.get(traceKey(n.position!.start));
        go(t ? { ...n, trace: t } : n);
      },
      () =>
        showToast(
          TRACE_ASK_FAILED,
        ),
    );
  };

  const proposeExpand = (id: string) => {
    const ctx = rewriteCtx;
    const n = treeNodes.find((t) => t.id === id);
    if (!ctx || !n?.position) return;
    withTrace(n, (node) => {
      const p = expandRewrite(node, ctx);
      if (!p.ok) {
        showToast(`Nothing to write out — ${p.why}`);
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
    const miss = () => showToast(`No linter fix to apply — ${why()}`);
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

  const basePaths = useMemo(() => pathKeys(baseNodes), [baseNodes]);
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
    return attachDiagnostics(
      tacticTargets(all),
      raw,
      { open, chipped },
      undefined,
      (id) => basePaths.get(id),
    );
  }, [engine, diagnostics, lintList, lintsFor, basePaths]);

  const [diagSel, setDiagSel] = useState<string | null>(null);
  const diagList = diag?.ordered ?? [];
  // Where no problem has been picked (or the picked one has gone), the strip
  // shows the FIRST ERROR where there is one — it is what opened the strip —
  // else the first problem in source order.
  const diagFirstError = diagList.findIndex((o) => o.diag.severity === 1);
  const diagPicked = diagList.findIndex((o) => o.ident === diagSel);
  const diagIdx =
    diagPicked >= 0 ? diagPicked : Math.max(0, diagFirstError);
  const diagCur = diagList[diagIdx] ?? null;
  const diagCounts: [number, number, number] = [0, 0, 0];
  for (const o of diagList) diagCounts[o.diag.severity - 1]++;

  /* THE MESSAGE STRIP (2026-09-24) — the secondary bar over the status card.
  Its open state is DERIVED, never written by an effect: open iff the reader
  opened it, OR the proof has an ERROR the reader has not dismissed. The
  dismissal is keyed on a SOURCE fact — the error set's own keys (severity,
  position, message) joined — held in state and written only by the close
  gestures, so a NEW error re-opens the strip and a dismissed one stays shut.
  Errors alone are serious: a warning (`declaration uses 'sorry'` is the
  common one, and it is the author's own choice) and a lint (the proof is
  correct) open it only through the count item. */
  // The reader's own opening is held as the PROOF it was made on (a proof
  // change closes everything, design rule 10 — by derivation, not a reset).
  // `ramify.diagnostics.autoOpen` (batch 5), the reading option `errors open
  // the message strip`: off, an error opens the strip only through the count
  // item, as a warning always has.
  const [autoOpen, setAutoOpen] = useOverride(viewSettings.autoOpen ?? true);
  const [diagStripPinnedOn, setDiagStripPinned] = useState<string | null>(
    null,
  );
  const diagStripPinned = diagStripPinnedOn === proofKey;
  // DISMISSAL IS PER ERROR, keyed on source-stable facts: the proof, the
  // error's node as a TREE PATH (child indices from the root — an absolute
  // line:col moved with every edit above it, and the strip re-opened on an
  // error the reader had already put away), and the message text. The strip
  // opens only for an error NOT in the dismissed set, so a set that is a
  // subset of what was dismissed stays shut and a genuinely new error (a new
  // message, or one on another step) re-opens it.
  const [diagDismissed, setDiagDismissed] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const diagErrorKeys = diagList
    .filter((o) => o.diag.severity === 1)
    .map((o) => `${proofKey}|${o.ident}`);
  // Nothing left to show: a pin with nothing under it is let go, so the next
  // lint does not arrive with the strip already open (a render-time adjust,
  // the house idiom for state that follows a prop).
  if (diagList.length === 0 && diagStripPinned) setDiagStripPinned(null);
  const diagStripOpen =
    diagList.length > 0 &&
    (diagStripPinned ||
      (autoOpen && diagErrorKeys.some((k) => !diagDismissed.has(k))));
  const closeDiagStrip = () => {
    setDiagStripPinned(null);
    if (diagErrorKeys.length > 0)
      setDiagDismissed((prev) => new Set([...prev, ...diagErrorKeys]));
  };
  const toggleDiagStrip = () =>
    diagStripOpen ? closeDiagStrip() : setDiagStripPinned(proofKey);

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
    if (traceOpenNow.has(id)) {
      setTraceOpen((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      // Open by the preset (the cursor's step): shutting it is remembered,
      // or it would open again on the next render.
      if (id === autoOpenId) setTraceShut((prev) => new Set(prev).add(id));
      return;
    }
    if (traceShut.has(id))
      setTraceShut((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
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
        else
          showToast(
            `Lean could not say what \`${tacticHeadWord(n.label)}\` used`,
          );
      },
      () => {
        done();
        showToast(
          TRACE_ASK_FAILED,
        );
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
  const polishShown = !!onPolish && polishReady;
  const readingState: ReadingState = {
    brief,
    merge: combine,
    lints: lintsOn,
    hypOrigins: hypOriginsOn,
    upToCursor: upToCursor && upToEnabled,
    polish: polishOn && polishShown,
    autoOpen,
  };

  // PERSIST a band / panel change (batch 5): the session override is set by
  // the applier as before; this asks the companion to write the setting
  // behind it (viewSettings.ts), so the choice survives a reload and syncs.
  // Absent `onSettingChange` (no companion, the viewer) it is session-only.
  // The Width slider fires on every tick, so its write waits for the slider
  // to rest (a timer in a handler; nothing reads it in render).
  const persist = (id: SettingId, v: unknown) =>
    onSettingChange?.(id, settingValue(id, v));
  const persistLater = (id: SettingId, v: unknown) => {
    if (!onSettingChange) return;
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(
      () => persist(id, v),
      PERSIST_SETTLE_MS,
    );
  };
  const applyLayout = (v: LayoutMode) => {
    setLayout(v);
    persist("layout", v);
    showToast(`Layout: ${LAYOUT_MODES[v].name}`);
  };
  const applyHypMode = (v: HypMode) => {
    anchorRoot();
    setHypMode(v);
    persist("context", v);
    showToast(`Context: ${HYP_MODES[v].name}`);
  };
  const applyCommentMode = (v: CommentMode) => {
    setCommentMode(v);
    persist("comments", v);
    showToast(`Comments: ${COMMENT_MODES[v].name}`);
  };
  // ONE applier for every reading option (the table is experience.ts's
  // `READING_OPTIONS`): the setter, then the toast in the bar's own
  // `Name: value` form. Turning `lints` ON is what ASKS the server
  // (`ProofTree.lintDecl` re-elaborates the declaration, so nothing fires it
  // unasked); the lints themselves belong to the caller. `polish` is a SESSION
  // override of `ramify.narration.polish`: turning it off here does not turn
  // the setting off. `merge` off forgets the runs the reader un-merged.
  const applyReading = (id: ReadingId, v: boolean) => {
    switch (id) {
      case "brief":
        setBrief(v);
        break;
      case "merge":
        setCombine(v);
        if (!v) setCombineOff(new Set());
        break;
      case "lints":
        setLintsOn(v);
        onLints?.(v);
        break;
      case "hypOrigins":
        setHypOriginsOn(v);
        break;
      case "polish":
        setPolishWanted(v);
        break;
      case "upToCursor":
        setUpToCursor(v);
        break;
      case "autoOpen":
        setAutoOpen(v);
        break;
    }
    // Every reading option is a setting but `polish`, which is key-gated and
    // already a session override of `ramify.narration.polish`.
    if (id !== "polish") persist(id, v);
    showToast(`${readingName(id)}: ${v ? "on" : "off"}`);
  };
  // Both live in the Layout popover: they are layouts, not view toggles, and a
  // list (unlike a cycle) can hold a choice and its modifiers together.
  const applySideBySide = (v: boolean) => {
    anchorRoot();
    setSideBySide(v);
    persist("sideBySide", v);
    showToast(`Side-by-side: ${v ? "on" : "off"}`);
  };
  const applyGallery = (v: boolean) => {
    setGallery(v);
    persist("gallery", v);
    showToast(`Gallery: ${v ? "on" : "off"}`);
  };
  const applyReflow = (v: ReflowMode) => {
    if ((v === "off") !== (reflow === "off")) anchorRoot();
    setReflow(v);
    persistLater("width", v);
    showToast(v === "off" ? "Width: full" : `Width: ${v} col`);
  };

  // NO bare-letter shortcuts. `l g b c k u` were core vim keys, and the document
  // keydown fires whenever the WEBVIEW has focus (clicking a node grants it,
  // with `activeElement` still `body`) — so a vim user's `u` switched to-cursor
  // on and the proof read as stuck collapsed. Only ⌘Z/⌘⇧Z, Esc and `?` are keys.

  // THE ONE-LEVEL UNDO for bulk discards of READER state (reset, collapse all,
  // expand all, clear temporary marks). Each gesture captures what it is about
  // to replace in a closure and hands it to the toast's `Undo` button; the
  // next toast replaces it, so there is exactly one level and no state of its
  // own. It restores through the same anchoring the gesture used.
  const undoable = (text: string, restore: () => void) =>
    showToast(text, false, {
      label: "Undo",
      run: () => {
        anchorRoot();
        restore();
        showToast("Restored");
      },
    });

  const resetToSource = () => {
    const snap = {
      cuts: elideCuts,
      focus: focusId,
      path: pathId,
      up: upToCursor,
      combineOff,
      commentsOff,
      commentsExpanded,
      chainOpen,
      pick,
      mine: myStopIds,
      cur: tourCur,
      peek: tourPeek,
    };
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
    // "The view the source asks for": the source's own `.mark`s stay (they
    // are the source's), the READER's temporary marks and the reading go.
    setMyStopIds(new Set());
    setTourCur(null);
    setTourPeek(new Set());
    setSelection(null);
    setFlagOpen(false);
    setMarquee(null);
    setPicking(null);
    setArming(null);
    setFlagPrompt(null);

    setClickAccent(null);
    undoable("Reset tree", () => {
      setElideCuts(snap.cuts);
      setFocusId(snap.focus);
      setPathId(snap.path);
      setUpToCursor(snap.up);
      setCombineOff(snap.combineOff);
      setCommentsOff(snap.commentsOff);
      setCommentsExpanded(snap.commentsExpanded);
      setChainOpen(snap.chainOpen);
      setPick(snap.pick);
      setMyStopIds(snap.mine);
      setTourCur(snap.cur);
      setTourPeek(snap.peek);
    });
  };

  // Both rail bulk gestures REPLACE the cut list, and both drop `up to
  // cursor`: it is a second way of hiding nodes with no gesture of its own,
  // so a view that was just asked to be the whole proof (expand all) or the
  // whole outline (collapse all) must not stay half-hidden by it. One rule,
  // both directions.
  const expandAll = () => {
    const snap = { cuts: elideCuts, up: upToCursor };
    anchorRoot();
    setElideCuts([]);
    setUpToCursor(false);
    undoable("Expanded all", () => {
      setElideCuts(snap.cuts);
      setUpToCursor(snap.up);
    });
  };
  const collapseAll = () => {
    const snap = { cuts: elideCuts, up: upToCursor };
    anchorRoot();
    // The OUTLINE, not every cuttable node: fold each branch where it
    // leaves the trunk, so the spine stays drawn with each branch root
    // wearing a `+N` (see elide.ts's `outlineCuts`).
    // Over the BASE tree, not the drawn one: a branch root hidden inside
    // a standing `.none` ghost is not drawn, so the engine's outline
    // missed it (measured from the seeded view: 17 nodes / 3 folds
    // against 14 / 4). The outline is a statement about the PROOF, and
    // it REPLACES the cut list, so it must see every branch root.
    setElideCuts(outlineCuts(baseById));
    setUpToCursor(false);
    undoable("Collapsed to the outline", () => {
      setElideCuts(snap.cuts);
      setUpToCursor(snap.up);
    });
  };

  // The panel's `Clear temporary marks (n)`: the reader's own set goes, the
  // source's `.mark`s stay. A current stop that only the temporary list held
  // is derived out of the reading; its peeked cuts go with it.
  const clearMyStops = () => {
    if (myStopIds.size === 0) return;
    const snap = { mine: myStopIds, cur: tourCur, peek: tourPeek };
    const n = myStopIds.size;
    setMyStopIds(new Set());
    if (tourCur !== null && !authorTour.some((st) => st.id === tourCur)) {
      setTourCur(null);
      setTourPeek(new Set());
    }
    undoable(`Cleared ${n} temporary mark${n === 1 ? "" : "s"}`, () => {
      setMyStopIds(snap.mine);
      setTourCur(snap.cur);
      setTourPeek(snap.peek);
    });
  };

  const cutMembers = (
    picked: ReadonlySet<string>,
  ): { ids: Set<string>; absorbed: Set<string> } => {
    const ids = new Set<string>();
    const absorbed = new Set<string>();
    const claim = (id: string) => {
      const d = treeIdx.byId.get(id);
      const members = combineMemberIds(id);
      if (d?.elidedCut && !d.elidedCut.combined) {
        absorbed.add(id);
        const cut = elideCuts.find((c) => cutId(c) === id);
        if (cut) for (const pid of resolveCut(cut, baseById)) ids.add(pid);
      } else if (members) {
        absorbed.add(id);
        for (const pid of members) if (baseById.has(pid)) ids.add(pid);
      } else if (baseById.has(id)) {
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
    cancelDwell();
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
      const cut = noneSeedCut(baseById, head.id, prose || undefined);
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
        const top = topMemberOf(resolveCut(cut, baseById));
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
  // THE STATUS BAND's report (`StatusBar.onPlace`): its height, which the
  // tree's frame gives up (nothing paints under the band), and an open
  // message strip's height plus gap, which the zoom rail climbs over. Starts
  // at one plain row; `fit` answers in a layout effect, before paint.
  const [band, setBand] = useState<BandPlace>({ band: BAR_H + 1, strip: 0 });
  const setBandIfChanged = (v: BandPlace) =>
    setBand((prev) =>
      prev.band === v.band && prev.strip === v.strip ? prev : v,
    );

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

  // The status band is DOCKED (2026-10-04): the scroll frame ends above it
  // (`band.band`), so the tree never flows under it — the floating strip it
  // replaced was the owner's "the tree flows under it". `PAD_Y` is still a
  // full viewport of padding below the content, so anything can be scrolled
  // clear of the rail.

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
  }, [declHeader, declHeaderSigStop, declHeaderBodyStop, focusId, pathId, hdrOpen]);

  // A press outside the `⋯` menu, a scroll or a wheel anywhere closes it: it
  // is hung off a button on a tree that is about to move under it.
  const menuUp = nodeMenu !== null;
  useEffect(() => {
    if (!menuUp) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.("[data-ptw-menu]")) return;
      setNodeMenu(null);
    };
    // A scroll or wheel INSIDE the menu is the menu's own (opened at its
    // fixes it is a scroller); anything else closes it.
    const off = (e: Event) => {
      const t = e.target as Element | null;
      if (t?.closest?.("[data-ptw-menu]")) return;
      setNodeMenu(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("scroll", off, true);
    document.addEventListener("wheel", off, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("scroll", off, true);
      document.removeEventListener("wheel", off, true);
    };
  }, [menuUp]);

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

  // The status bar's panels, the `?` panel and the open signature close on a
  // WHEEL anywhere but inside themselves (the `?` panel and the signature
  // scroll their own content) — design rule 10. NOT on `scroll`: a toggle row
  // leaves its panel open, and the anchored relayout it causes scrolls the
  // frame programmatically, which would close the panel under the click. A
  // wheel (a trackpad's scroll included) is always the reader's own hand.
  const floaterUp = barOpen !== null || helpOpen || hdrOpen;
  useEffect(() => {
    if (!floaterUp) return;
    const off = (e: WheelEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.("[data-ptw-panel], [data-ptw-hdr]")) return;
      setBarOpen(null);
      setHelpOpen(false);
      setHdrOpen(false);
    };
    document.addEventListener("wheel", off, { capture: true, passive: true });
    return () => document.removeEventListener("wheel", off, true);
  }, [floaterUp]);

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
  // The WHOLE signature, `: type` included and the body's `:=`/`where` left
  // off — cut at `declHeaderBodyStop`, by kind, like the two above. GREEDY
  // (2026-09-22, "the whole one can fit here so it should"): at rest the
  // header draws the longest cut that fits its one line, measured with the
  // text engine the tree itself uses (same code font, same px) against the
  // band's measured width. Only the width decides, so the header's HEIGHT is
  // the same in every state and crossing the threshold moves nothing below.
  const hdrFull = useMemo(
    () =>
      declHeader && declHeaderStart
        ? headerPrefix(declHeader, declHeaderStart, declHeaderBodyStop)
        : null,
    [declHeader, declHeaderStart, declHeaderBodyStop],
  );
  // Without the chevron the right padding is the left's, so that is the room
  // the whole signature is asked to fit (1px slack for canvas-vs-DOM rounding).
  const hdrFullFits =
    hdrFull !== null &&
    !scopeId &&
    hdrW > 0 &&
    measureText(hdrFull.text, NODE_FONT_PX) <= hdrW - 2 * HDR_PAD_X - 1;
  // The `▾` is drawn only where something is hidden — or to close the open
  // signature.
  const hdrChevron = hdrOpen || !hdrFullFits;
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
            text: `up to cursor · ${upToHide.size} hidden below the cursor`,
            title: "Show the whole proof again (Esc)",
            ink: SEQ_STROKE,
            onExit: () => applyReading("upToCursor", false),
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

  // Focus goes back to the frame when an overlay a KEY opened (the `⋯` menu,
  // F2's editor) closes — else it falls to the page and the arrows are lost.
  // `focus()` is not a state write; the frame's own `onFocus` answers it.
  const overlayUp = nodeMenu !== null || editing !== null;
  const overlayWas = useRef(false);
  useEffect(() => {
    const was = overlayWas.current;
    overlayWas.current = overlayUp;
    if (!was || overlayUp || !restoreFocus.current) return;
    restoreFocus.current = false;
    const el = scrollRef.current;
    const a = el?.ownerDocument.activeElement;
    if (el && (!a || a === el.ownerDocument.body))
      el.focus({ preventScroll: true });
  }, [overlayUp]);

  const unhide = (id: string) => {
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

  // THE STATUS READOUT's facts (statusBar.tsx). All three counts are read off
  // trees this component already holds, each memoised on its own tree:
  //   steps   — tactic nodes of the BASE tree (a synthetic broken-chain
  //             `calc` is the repair stub, not a step the author wrote);
  //   open    — goals nothing has acted on yet: the frontier the chips attach
  //             to (`addSpec`), in the base tree's preorder, so a cut never
  //             changes what is open; a ledger node is a table, not a goal;
  //   hidden  — the sum of every `+N` on the DRAWN tree: a fold's or a hop's
  //             `folded.tactics` and a ghost's `elidedCut.tactics`. A ⇉
  //             combined run is drawn in full, so it hides nothing.
  const stepCount = useMemo(
    () => baseNodes.filter((n) => n.type === "tactic" && !n.synthetic).length,
    [baseNodes],
  );
  const baseRank = useMemo(
    () => new Map(baseNodes.map((n, i) => [n.id, i])),
    [baseNodes],
  );
  const openGoalIds = useMemo(
    () =>
      baseNodes
        .filter((n) => n.type === "goal" && !!n.addSpec && !n.ledger)
        .map((n) => n.id),
    [baseNodes],
  );
  const hiddenCount = useMemo(
    () =>
      treeNodes.reduce(
        (sum, n) =>
          sum +
          (n.folded?.tactics.length ?? 0) +
          (n.elidedCut && !n.elidedCut.combined ? n.elidedCut.tactics.length : 0),
        0,
      ),
    [treeNodes],
  );
  // The declaration's name as the author wrote it (the header's last word of
  // `keyword name`), else the server's proof id unless that is a position.
  // The readout names the declaration ONLY where no signature header is
  // drawn (2026-10-04, owner): the header already reads `theorem cantor …`,
  // and `cantor · 12 steps` beneath it said the name twice. Where there is no
  // header (the harness's NDJSON carries none) the name stays.
  const statusName = useMemo(() => {
    if (declHeader) return "";
    const words = declHead.trim().split(/\s+/);
    const raw =
      words.length > 1
        ? words[words.length - 1]
        : proof.proofId && !proof.proofId.startsWith("@")
          ? proof.proofId
          : "";
    return clipText(raw, STATUS_NAME_MAX);
  }, [declHeader, declHead, proof.proofId]);

  // `N open`: the first open goal BELOW THE CURSOR in the base tree's order
  // (the cursor being the node the view is accenting), wrapping to the first.
  // The jump is `revealNode`'s where a cut hides the goal and the marks' where
  // it is drawn — anchored, accented and sought, never a scroll of its own.
  const goToOpenGoal = () => {
    if (openGoalIds.length === 0) return;
    const at = cursorNodeId ? (baseRank.get(cursorNodeId) ?? -1) : -1;
    const k = Math.max(
      0,
      openGoalIds.findIndex((g) => (baseRank.get(g) ?? 0) > at),
    );
    const id = openGoalIds[k];
    if (placed.has(id)) {
      anchorOn(id);
      accentNow(id);
      pageTo(id);
      setSeek({ id });
    } else {
      accentNow(id);
      revealNode(id);
    }
    showToast(`Open goal ${k + 1}/${openGoalIds.length}`, true);
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
    setTourCur(stop.id);
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
    setTourCur(null);
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
      setTourCur(null);
      setTourPeek(new Set());
      showToast("Mark dropped — temporary list on");
      return;
    }
    showToast(dropping ? "Mark dropped" : "Mark removed");
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
    setDiagSel(diagList[n].ident);
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
        (compact && n.data.commentW > 0 ? commentIndentOf(n.data) : 0) +
          n.data.commentW,
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

    // THE AXIS LOCK: a gesture that STARTS vertical stays vertical until the
    // wheel has been idle LOCK_IDLE ms (trackpad momentum keeps it alive). It
    // used to be done by cancelling every wheel event and setting `scrollTop`
    // by hand, which put the whole pan on the main thread — the browser had
    // to wait for this handler on every event, so a busy page stalled the pan
    // and momentum (reported 2026-10-03 as the widget panning slowly). Now
    // the browser scrolls natively, off the main thread, and the lock is
    // enforced on the OTHER axis instead: horizontal overflow is hidden for
    // the gesture where that moves no layout (overlay scrollbars, the macOS
    // default), else any drift is snapped back from the passive scroll
    // listener below. Pinch / ⌘-wheel zoom is the only path that cancels.
    const LOCK_IDLE = 180;
    let lastWheelT = 0;
    let lockLeft: number | null = null;
    let lockHidden = false;
    let unlockTimer: number | null = null;
    const unlock = () => {
      unlockTimer = null;
      lockLeft = null;
      if (lockHidden) el.style.overflowX = "";
      lockHidden = false;
    };
    const lock = () => {
      lockLeft = el.scrollLeft;
      // A horizontal scrollbar that takes room would vanish and resize the
      // frame; there, the scroll listener alone holds the axis.
      if (el.offsetHeight - el.clientHeight === 0) {
        el.style.overflowX = "hidden";
        lockHidden = true;
      }
    };
    // Hidden overflow stops drift from the second event on; the gesture's
    // FIRST event is already scrolling when the lock is taken, so its own
    // sideways part is snapped back here too (one correction, at the start).
    injectStyleOnce("ptw-scrolling", SCROLLING_CSS);
    let settleTimer: number | null = null;
    const settle = () => {
      settleTimer = null;
      delete el.dataset.ptwScrolling;
    };
    const onScroll = () => {
      if (lockLeft !== null && el.scrollLeft !== lockLeft)
        el.scrollLeft = lockLeft;
      if (settleTimer === null) el.dataset.ptwScrolling = "";
      else window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, SCROLL_SETTLE_MS);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        const now = performance.now();
        if (now - lastWheelT > LOCK_IDLE) {
          unlock();
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) lock();
        }
        lastWheelT = now;
        if (lockLeft !== null) {
          if (unlockTimer !== null) window.clearTimeout(unlockTimer);
          unlockTimer = window.setTimeout(unlock, LOCK_IDLE);
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
      el.removeEventListener("scroll", onScroll);
      if (unlockTimer !== null) window.clearTimeout(unlockTimer);
      unlock();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settle();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  const svgW = extent.width + MARGIN.left + MARGIN.right + 2 * PAD_X;
  // The padding BELOW the content is a full viewport, so the last node scrolls
  // clear of the rail and an open message strip at any usual zoom (the band
  // is outside the frame, so it needs none). Zoomed far out that viewport
  // shrinks (it is scaled by `zoom`), so it is floored at the rail's and the
  // strip's screen height. Only the area below the content grows — never a
  // shift of anything drawn, and never a change of `scrollTop`.
  const padBottom = Math.max(PAD_Y, Math.ceil((RAIL_CLEAR + band.strip) / zoom));
  const svgH = extent.height + MARGIN.top + MARGIN.bottom + PAD_Y + padBottom;

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
        // Stamped SEEDED here, not on the next reseed: the flag is in the
        // source the moment the patch lands, so the corner must already read
        // in the author's voice.
        for (const c of foldSeedCuts(baseById, v.targets)) addCut(c);
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
          const goneGoals = new Set(
            [...gone].flatMap((id) => {
              const g = baseById.get(id)?.parents[0]?.id;
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
      if (cols !== base) {
        persist("width", cols);
        showToast(`Width: ${cols} col`);
      }
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
            seamDrag ? SEQ_STROKE : CHROME_BORDER
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
              rx={CHROME_RADIUS}
              fill={CHROME_UNDERLAY}
            />
            <rect
              x={0}
              y={-9}
              width={54}
              height={18}
              rx={CHROME_RADIUS}
              fill={CHROME_BG}
              stroke={CHROME_BORDER}
            />
            <text
              x={27}
              y={0}
              dy="0.32em"
              textAnchor="middle"
              fontFamily={CHROME_FONT}
              fontSize={11}
              fill={CHROME_INK}
              style={{ fontVariantNumeric: "tabular-nums" }}
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
    const selBase = new Set([...selection].filter((id) => baseById.has(id)));
    const canFlag = !!onEditTactic && !!deleteSlots;
    const slots = deleteSlots ?? [];
    const heads = canFlag ? headTactics(baseNodes, selBase, slots) : [];
    const writable = heads.filter((h) => flagLine(h, slots, ".fold"));

    const selTactics = [...selBase].filter(
      (id) => baseById.get(id)!.type === "tactic",
    );
    const runIds = selectionRun(baseNodes, selBase);
    const consumerOf = (g: TreeNode) =>
      baseNodes.find(
        (n) => n.type === "tactic" && n.parents.some((p) => p.id === g.id),
      );
    const ctxGoals = canFlag
      ? [...selBase]
          .map((id) => baseById.get(id)!)
          .filter((n) => n.type === "goal" && !n.hypFlagged)
          .map((g) => ({ g, c: consumerOf(g) }))
          .filter(
            (x): x is { g: TreeNode; c: TreeNode } =>
              !!x.c && !!flagLine(x.c, slots, ".no-hyps"),
          )
      : [];
    const pinGoals = ctxGoals.filter((x) => usedHypNames(x.g).length > 0);
    const flagged = [...selBase]
      .map((id) => baseById.get(id)!)
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
    if (selPlaced.some((p) => baseById.has(p.data.id) || p.data.elidedCut))
      verbs.push({ kind: "elide", doc: "elide" });
    if (runIds) verbs.push({ kind: "combine", doc: "combine", ids: runIds });

    const combinedSel = selPlaced
      .filter((p) => p.data.elidedCut?.combined)
      .map((p) => ({
        id: p.data.id,
        members: (combineMemberIds(p.data.id) ?? []).filter((m) => baseById.has(m)),
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
      const boxOf = (p: (typeof nodes)[number]) => ({
        x: p.x - p.data.w / 2,
        y: p.y + (bandTopH(p.data) - p.data.h) / 2,
        w: p.data.w,
        h: p.data.h,
      });
      const selBox = {
        x: minX,
        y: minY,
        w: Math.max(...selPlaced.map((p) => p.x + p.data.w / 2)) - minX,
        h:
          Math.max(
            ...selPlaced.map((p) => {
              const b = boxOf(p);
              return b.y + b.h;
            }),
          ) - minY,
      };
      let cx = 0;

      // The pill's word is what `cutForBand` WILL do with this selection —
      // the same call `elideSelection` makes — not one word for three
      // outcomes: a goal's whole subtree FOLDS, a straight run SKIPS (the
      // hop), anything else is HIDDEN behind one dashed box.
      const bandKind = (() => {
        const { ids } = cutMembers(new Set(selPlaced.map((p) => p.data.id)));
        return ids.size === 0
          ? null
          : cutForBand(treeIdx.byId, ids, treeIdx.kids).kind;
      })();
      const elideWord =
        bandKind === "fold" ? "fold" : bandKind === "hop" ? "skip" : "hide";
      const elideTitle =
        bandKind === "fold"
          ? "Fold: the selection is one goal's whole subtree, so it folds under that goal (click to restore)"
          : bandKind === "hop"
            ? "Skip: the selection is a straight run of steps, so the goal above hops over it (click to restore)"
            : "Hide: the selection is put away as one dashed box (click to restore)";

      const verbChip = (v: SelVerb): PillChip => {
        const d = VERB_DOC[v.doc];
        return {
          label: v.kind === "elide" ? elideWord : d.label,
          title:
            v.kind === "elide"
              ? elideTitle
              : v.kind === "comments" && !v.hide && d.titleAlt
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
      // Never over a node (selectionPill.tsx): beside the selection's
      // top-right, else under its bottom, kept inside the frame.
      const pillSize = { w: rowW + 2 * CARD_PAD, h: CHIP_H + 2 * CARD_PAD };
      const pillAt = pillCandidates(selBox, pillSize, nodes.map(boxOf)).map(
        (c) => ({ x: c.x + CARD_PAD, y: c.y + CARD_PAD }),
      );
      selectionPillEl = (
        <PillPlace candidates={pillAt} size={pillSize}>
          <rect
            x={-CARD_PAD}
            y={-CARD_PAD}
            width={rowW + 2 * CARD_PAD}
            height={CHIP_H + 2 * CARD_PAD}
            rx={CHROME_RADIUS}
            fill="var(--ptw-surface)"
            stroke={CHROME_BORDER}
            strokeWidth={1}
            style={{ filter: CHIP_SHADOW }}
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
                keyboard={{
                  activate: () => {
                    runPillChip(c.act);
                    // The chip that ran usually leaves with the pill: the
                    // keys come back to the tree (`flag ▾` stays put).
                    if (c.act.do !== "flags")
                      scrollRef.current?.focus({ preventScroll: true });
                  },
                }}
              />
            );
          })}
        </PillPlace>
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
            rx={nodeRx("tactic")}
            fill="var(--ptw-surface)"
            stroke={SEQ_STROKE}
            strokeWidth={TREE_INK_SW_BOLD}
            strokeDasharray="4 3"
          >
            <title>
              {`Being written in the buffer (line ${cfStub.line + 1}) — the tree holds a sorry here until it elaborates` +
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
                border: `1.5px solid ${FOCUS_INK}`,
                borderRadius: CHROME_RADIUS,
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

  // The node the `⋯` menu is open on (null in another proof).
  const menuFor =
    nodeMenu && nodeMenu.proof === proofKey ? nodeMenu.id : null;
  // `fixes`: the LIGHTBULB's door (and ${CMD}.'s) — the same menu, keyed on
  // its first code action and hung so the Quick Fix / Refactor heading sits
  // under the button (nodeBar.tsx `NodeMenu`).
  const openNodeMenu = (id: string, el?: Element, fixes?: boolean) => {
    const root = el?.closest("[data-ptw-theme]");
    if (!el || !root) return;
    const r = el.getBoundingClientRect();
    const f = root.getBoundingClientRect();
    tipCtl.dismiss();
    setNodeMenu({
      id,
      proof: proofKey,
      x: r.left - f.left,
      top: r.top - f.top,
      bottom: r.bottom - f.top,
      ...(fixes ? { fixes } : {}),
    });
  };
  // RIGHT-CLICK on a box (2026-10-04, batch 2): VS Code's context menu, i.e.
  // the same `⋯` menu, hung at the pointer. The browser's own menu is
  // suppressed on a node only — the canvas keeps it.
  const openNodeMenuAt = (id: string, e: ReactMouseEvent<Element>) => {
    const root = e.currentTarget.closest("[data-ptw-theme]");
    if (!root) return;
    e.preventDefault();
    e.stopPropagation();
    const f = root.getBoundingClientRect();
    tipCtl.dismiss();
    setNodeMenu({
      id,
      proof: proofKey,
      x: e.clientX - f.left,
      top: e.clientY - f.top,
      bottom: e.clientY - f.top,
      pointer: true,
    });
  };

  // F8 / ⇧F8 — VS Code's next / previous problem: the message strip's own
  // pager (`stepDiag`, the strip's ‹ › click path). Where the strip is shut
  // the first press opens it on the problem it would show.
  const goToProblem = (d: number) => {
    if (diagList.length === 0) {
      showToast("No problems in this proof");
      return;
    }
    if (!diagStripOpen) {
      setDiagStripPinned(proofKey);
      revealNode(diagList[diagIdx].nodeId);
    } else stepDiag(d);
  };

  // ONE DOM id per drawn node, injective in the node id (every character
  // outside `[A-Za-z0-9-]` is spelled `_<hex>`), prefixed per view instance.
  const domIdOf = (id: string) =>
    `ptw${treeUid}-n-${id.replace(
      /[^A-Za-z0-9-]/g,
      (c) => `_${c.charCodeAt(0).toString(16)}`,
    )}`;
  // The node the arrows are on, derived (see `activeId`).
  const activeNow =
    activeId && nav.index.has(activeId)
      ? activeId
      : cursorNodeId && nav.index.has(cursorNodeId)
        ? cursorNodeId
        : (nav.order[0] ?? null);
  const treeLabel = hdrName?.text
    ? `Proof tree for ${hdrName.text}`
    : "Proof tree";

  // THE KEYS. Frame-scoped (never a document listener) and only for keys that
  // land on the frame ITSELF: an editor's textarea, the `⋯` menu (which React
  // bubbles through its portal) and the chrome all have another target. Moving
  // is paint plus, where the node would be off-screen, ONE eased scroll to it
  // (a movement the reader asked for). Folding and opening are `onNodeClick` —
  // the mouse gesture's own function, so the relayout is anchored the same.
  // Enter and F2 hand the node's own `click` / `dblclick` handler a real DOM
  // event rather than a second copy of what it does.
  const onTreeKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    // A modifier alone neither starts nor breaks a chord (the reader may let
    // go of Ctrl between its halves).
    if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return;
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    const pending = chordAt.current > 0 && e.timeStamp - chordAt.current < CHORD_MS;
    chordAt.current = 0;
    if (mod && pending && (e.key === "0" || e.code === "Digit0")) {
      e.preventDefault();
      collapseAll();
      return;
    }
    if (mod && pending && (e.key.toLowerCase() === "j" || e.code === "KeyJ")) {
      e.preventDefault();
      expandAll();
      return;
    }
    if (mod && !e.shiftKey && (e.key.toLowerCase() === "k" || e.code === "KeyK")) {
      e.preventDefault();
      chordAt.current = e.timeStamp || 1;
      return;
    }
    // ${CMD}. — the editor's Quick Fix key — opens the move menu, as ⇧F10 does.
    const menuKey = mod && (e.key === "." || e.code === "Period");
    if (!menuKey && (e.ctrlKey || e.metaKey || e.altKey)) return;
    if (
      editing !== null ||
      nodeMenu !== null ||
      barOpen !== null ||
      hdrOpen ||
      helpOpen ||
      flagOpen ||
      !!flagPrompt ||
      !!arming ||
      !!proposal ||
      !!pendingVerb ||
      !!picking
    )
      return;
    const cur = activeNow;
    if (cur === null) return;
    const at = nav.index.get(cur) ?? 0;
    const d = placed.get(cur)?.data;
    const doc = e.currentTarget.ownerDocument;
    const gEl = doc.getElementById(domIdOf(cur));
    // `scroll` is false where the key is a FOLD or an OPEN: that relayout is
    // anchored by `onNodeClick`, and a second scroll here would fight it.
    const go = (id: string | undefined | null, scroll = true) => {
      e.preventDefault();
      setTreeFocus("kb");
      if (!id) return;
      setActiveId(id);
      if (!scroll) return;
      const el = scrollRef.current;
      const pn = placed.get(id);
      if (!el || !pn || PAD_X === 0 || PAD_Y === 0) return;
      const { left, top } = inViewScroll(el, pn, zoom, PAD_X, PAD_Y, compact);
      if (left !== el.scrollLeft || top !== el.scrollTop)
        animateScroll(followAnim.current, el, left, top);
    };
    const opens = !!d && (!!d.folded || isGhostNode(d));
    const folds = !!d && !d.folded && d.type === "goal" && goalCuts.has(cur);
    // Shift+↑/↓ EXTENDS A SELECTION from where it started (the active node)
    // through the drawn preorder — the same set a marquee sweep produces, so
    // the selection pill (fold / skip / hide, flags) appears as it does for
    // one. Tab reaches the pill's chips; Esc clears (the `selection` layer).
    if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const to =
        nav.order[
          e.key === "ArrowDown"
            ? Math.min(at + 1, nav.order.length - 1)
            : Math.max(at - 1, 0)
        ];
      const from =
        selection && selAnchor && selection.has(selAnchor) && nav.index.has(selAnchor)
          ? selAnchor
          : cur;
      const i = nav.index.get(from) ?? at;
      const j = nav.index.get(to) ?? at;
      setSelAnchor(from);
      setFlagOpen(false);
      setSelection(
        i === j
          ? null
          : new Set(nav.order.slice(Math.min(i, j), Math.max(i, j) + 1)),
      );
      return go(to);
    }
    switch (e.key) {
      case "ArrowDown":
        return go(nav.order[Math.min(at + 1, nav.order.length - 1)]);
      case "ArrowUp":
        return go(nav.order[Math.max(at - 1, 0)]);
      case "Home":
        return go(nav.order[0]);
      case "End":
        return go(nav.order[nav.order.length - 1]);
      case "ArrowRight":
        if (opens) {
          // A ghost's own id leaves with the cut: the parent is what stays.
          const keep = isGhostNode(d!) ? nav.parent.get(cur) : cur;
          go(keep, false);
          onNodeClick(cur);
          return;
        }
        return go(nav.kids.get(cur)?.[0]);
      case "ArrowLeft":
        if (folds) {
          go(cur, false);
          onNodeClick(cur);
          return;
        }
        return go(nav.parent.get(cur));
      case "Enter": {
        if (!gEl?.hasAttribute("data-ptw-act")) return;
        e.preventDefault();
        setTreeFocus("kb");
        // A goal's plain click folds it (the arrows do that), so Enter on a
        // goal is its ⌘-click, reveal in source, where there is one.
        const reveal =
          d?.type === "goal" && !!onReveal && !!d.position && !d.folded;
        gEl.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            metaKey: reveal,
          }),
        );
        return;
      }
      case "F2":
        if (e.shiftKey || !gEl?.hasAttribute("data-ptw-editable")) return;
        e.preventDefault();
        setTreeFocus("kb");
        restoreFocus.current = true;
        gEl.dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
        );
        return;
      case "F8":
        e.preventDefault();
        setTreeFocus("kb");
        goToProblem(e.shiftKey ? -1 : 1);
        return;
      // Space folds or unfolds the active goal (or opens a ghost): the same
      // `onNodeClick` → and ← use, so the relayout is anchored.
      case " ":
        e.preventDefault();
        if (opens) {
          go(isGhostNode(d!) ? nav.parent.get(cur) : cur, false);
          onNodeClick(cur);
        } else if (folds) {
          go(cur, false);
          onNodeClick(cur);
        }
        return;
      case ".":
      case "ContextMenu":
      case "F10": {
        if (e.key === "F10" && !e.shiftKey) return;
        if (e.key === "." && !menuKey) return;
        const box = gEl?.querySelector("[data-ptw-box]");
        if (!box) return;
        e.preventDefault();
        setTreeFocus("kb");
        restoreFocus.current = true;
        // ${CMD}. is VS Code's Quick Fix key: the menu opens at its fixes
        // (a box with none opens it from the top, as ⇧F10 does).
        openNodeMenu(cur, box, e.key === ".");
        return;
      }
    }
  };

  // A PIN in the `⋯` menu: on the bar for this node KIND, now, and — where
  // there is a companion — in `ramify.hoverBar.<kind>` too, so it persists.
  // Pinning appends (the new button lands just before `⋯`, beside the menu it
  // came from); unpinning keeps the others' order.
  const pinMove = (kind: BarKind, k: MoveId) => {
    const on = !barIds[kind].includes(k);
    const next = togglePinned(barIds[kind], k);
    // An override equal to what the setting/preset already gives is stored as
    // NO override, so a later preset or setting change takes effect again.
    const dflt = hoverBar?.[kind] ?? preset.hoverBar[kind];
    const same =
      next.length === dflt.length && next.every((m, i) => m === dflt[i]);
    setPinOverride((p) => {
      const rest = { ...p };
      if (same) delete rest[kind];
      else rest[kind] = next;
      return rest;
    });
    onHoverBarChange?.(kind, next);
    showToast(
      `${on ? "On" : "Off"} the bar for ${kind === "goal" ? "goals" : "tactics"}`,
    );
  };

  return (
    <TipContext.Provider value={tipCtl}>
    <AppearanceContext.Provider value={appearance}>
    <div
      ref={setFrameEl}
      data-ptw-theme={themeKind}
      data-ptw-appearance={appearance}
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

            zIndex: Z.header,
            boxSizing: "border-box",
            fontFamily: getCodeFontFamily(),
            fontSize: NODE_FONT_PX,
            lineHeight: `${LINE_H}px`,
            letterSpacing: 0,
            whiteSpace: "pre-wrap",

            textAlign: "left",
            color: NODE_TEXT,
            // The editor's STICKY SCROLL (2026-10-04, batch 2): its
            // background, its bottom border and the shadow it casts on the
            // text scrolling under it.
            background: STICKY_BG,
            borderBottom: `1px solid ${STICKY_BORDER}`,
            boxShadow: `0 3px 2px -2px ${STICKY_SHADOW}`,
            cursor: onRevealHeader ? "pointer" : "default",

            // The right padding is the `▾` button's lane (`HDR_BTN_W` at
            // `HDR_BTN_RIGHT`), in both states — the button is a sibling, so
            // the open overlay's scroll never carries it away.
            // Where the whole signature fits there is no button, and the
            // lane is the ordinary padding.
            ...(hdrOpen
              ? {
                  padding: `6px ${HDR_BTN_LANE}px 6px ${HDR_PAD_X}px`,
                  maxHeight: "60%",
                  overflowY: "auto",
                  zIndex: Z.signature,
                }
              : {
                  padding: `6px ${hdrChevron ? HDR_BTN_LANE : HDR_PAD_X}px 6px ${HDR_PAD_X}px`,
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
                  if (hdrFullFits && hdrFull) return oneLine(hdrFull);
                  if (hdrRest) return oneLine(hdrRest);
                  const lines = renderDeclHeader?.(src) ?? src;
                  return (
                    <>
                      {lines[0]}
                      {src.length > 1 ? (
                        <span style={{ opacity: DIM_OPACITY }}> …</span>
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
                <span style={{ opacity: DIM_OPACITY, padding: "0 6px", flexShrink: 0 }}>
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
                    borderRadius: CHROME_RADIUS,
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
                  <span style={{ opacity: DIM_OPACITY, flexShrink: 0 }}>✕</span>
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {declHeader && hdrChevron ? (
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
            zIndex: Z.popup,
            width: HDR_BTN_W,
            height: HDR_REST_H - 1,
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: NODE_TEXT,
            opacity: hdrOpen ? 0.95 : 0.75,
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          <Codicon name={hdrOpen ? "chevron-up" : "chevron-down"} />
        </button>
      ) : null}

      {headerExtra && (
        <div
          style={{
            position: "absolute",

            top: floaterTop(0),
            left: 8,
            zIndex: Z.chrome,
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
        bottom={band.band + band.strip}
        onZoomIn={() => zoomBy(1.25)}
        onZoomOut={() => zoomBy(1 / 1.25)}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        onFit={fitWidth}
      />

      <StatusBar
        onPlace={setBandIfChanged}
        upToEnabled={upToEnabled}
        reading={readingState}
        onReadingChange={applyReading}
        layout={layout}
        onLayoutChange={applyLayout}
        sideBySide={sideBySide}
        sbsEnabled={compact}
        gallery={gallery}
        onGalleryChange={applyGallery}
        classic={classic}
        onClassicChange={(v) => {
          setAppearance(v ? "classic" : "vscode");
          persist("appearance", v ? "classic" : "vscode");
          showToast(`Classic look: ${v ? "on" : "off"}`);
        }}
        onReset={resetToSource}
        onSideBySideChange={applySideBySide}
        reflow={reflow}
        forcedReflow={forcedReflow}
        barOpen={barOpen}
        onBarOpenChange={setBarOpen}
        onReflowChange={applyReflow}
        onBriefHover={(h: boolean) => {
          if (h) afterDwell(() => setBriefHover(true));
          else {
            cancelDwell();
            setBriefHover(false);
          }
        }}
        // Key-gated rows are HIDDEN, not disabled, where the gate is shut
        // (2026-09-22): no companion, no key, or the setting off.
        polishShown={polishShown}
        polishWhy={
          commentMode === "narrate"
            ? "Rewrite each generated line into fluent English through the extension; the author's own comments are never sent (≈)"
            : "Polish rewrites the generated lines, so it shows in Comments: narrate"
        }
        proposeShown={!!onPropose && proposeReady}
        proposeBusy={proposeBusy}
        onPropose={() => askAgent()}
        commentMode={commentMode}
        onCommentModeChange={applyCommentMode}
        hypMode={hypMode}
        onHypModeChange={applyHypMode}
        hypGroup={hypGroup}
        onHypGroupChange={(v) => {
          anchorRoot();
          setHypGroup(v);
          persist("hypGroup", v);
          showToast(`Split data & props: ${v ? "on" : "off"}`);
        }}
        tourLists={tourLists}
        tourAt={tourAt}
        tourCount={tourStops.length}
        authorCount={authorTour.length}
        myCount={myTour.length}
        onTourListToggle={toggleTourList}
        onTourCycle={cycleTour}
        onTourClearMine={clearMyStops}
        onTourStep={stepTour}
        helpOpen={helpOpen}
        onHelpOpenChange={setHelpOpen}
        caps={caps}
        fontFamily={codeFont}
        status={
          baseNodes.length === 0
            ? null
            : {
                name: statusName,
                steps: stepCount,
                open: openGoalIds.length,
                hidden: hiddenCount,
                onOpen: goToOpenGoal,
                onHidden: expandAll,
              }
        }
        diag={
          diagCur
            ? {
                index: diagIdx,
                count: diagList.length,
                diag: diagCur.diag,
                counts: diagCounts,
                open: diagStripOpen,
                clickable: !!diagCur.nodeId || !!onReveal,
                onStep: stepDiag,
                onToggle: toggleDiagStrip,
                onClose: closeDiagStrip,
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
            zIndex: Z.chrome,
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
        data-ptw-scroll=""
        className="no-scrollbar"
        // ONE tab stop for the whole tree (keyboard navigation of nodes): the
        // arrows move `aria-activedescendant` between the drawn nodes, which
        // carry `role="treeitem"`. The frame draws no outline of its own —
        // the active node's ring (below) is the focus indicator.
        role="tree"
        tabIndex={0}
        aria-label={treeLabel}
        aria-activedescendant={
          activeNow !== null ? domIdOf(activeNow) : undefined
        }
        onKeyDown={onTreeKey}
        onFocus={(e) => {
          if (e.target !== e.currentTarget) return;
          let kb = true;
          try {
            kb = e.currentTarget.matches(":focus-visible");
          } catch {
            /* an engine without :focus-visible: treat focus as keyboard's */
          }
          setTreeFocus(kb ? "kb" : "mouse");
        }}
        onBlur={(e) => {
          if (e.target === e.currentTarget) setTreeFocus("none");
        }}
        onPointerDown={(e) => {
          // A press is the mouse's: no ring. On a node it also moves the
          // keys' place there, so the arrows resume from what was clicked.
          setTreeFocus((f) => (f === "none" ? f : "mouse"));
          const nid = (e.target as Element)
            .closest?.("g[data-node]")
            ?.getAttribute("data-node");
          if (nid) setActiveId(nid);
        }}
        style={{
          width: "100%",

          // The frame ENDS ABOVE THE STATUS BAND (2026-10-04): it gives up
          // the band's height, so no node paints under it; a change of that
          // height is a viewport change, anchored like any (the `padRef`
          // effect keeps every node where it stood relative to the top).
          height: `calc(100% - ${hdrH + band.band}px)`,
          marginTop: hdrH,
          overflow: "auto",
          // A pan that reaches the tree's edge stops there rather than
          // scrolling the infoview page under it — what the wheel handler's
          // cancel used to do implicitly, before scrolling went native.
          overscrollBehavior: "contain",
          outline: "none",

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
          <SquigglePatterns />
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
                  <path fill="none" stroke={stroke} strokeWidth={TREE_INK_SW_BOLD} d={d} />
                  {linkMarks && startMark && (
                    <LinkMark {...startMark} goal={goalBound} stroke={stroke} />
                  )}
                  {linkMarks && endMark && (
                    <LinkMark {...endMark} goal={goalBound} stroke={stroke} />
                  )}
                  {link.source.data.folded?.kind === "hop" && (
                    <HopChip
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

            {nodes.map((node) => {
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

              const topH = bandTopH(node.data);
              // The comment strip's top-left, relative to the node's centre:
              // above the box, floated above its band, or BELOW a folded
              // goal (`commentBelow`) — layout.ts owns all three.
              const stripTop = commentStripTop(node.data);
              const stripX = compact
                ? -w / 2 + commentIndentOf(node.data)
                : -node.data.commentW / 2;
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

              // The goal's own chevron/`+N`. `folded` is what a fold cut hanging
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
              if (isEditing) injectStyleOnce("ptw-hint", HINT_CSS);

              const hideForEdit =
                id === cfStubId ||
                (isEditing &&
                  !editing?.add &&
                  !editing?.calcStage &&
                  (!editing?.comment || !!node.data.proseLabel));

              const boxRx = nodeRx(type);
              const ringGrow = isGhostNode(node.data) ? 5 : 3;
              const nodeDiags = diag?.byNode.get(id);
              const diagSev = diag?.worst.get(id) ?? null;
              const recovered = node.data.recovered;
              // CLASSIC (appearance.ts; cffa2be^): an error or a warning tints
              // the BORDER in its ink (an error at 2px); a lint never does —
              // the proof is correct. The ribbon is `DiagMark`'s.
              const classicDiagStroke =
                classic && (diagSev === 1 || diagSev === 2)
                  ? diagInkOf(diagSev)
                  : null;
              const boxSw =
                accent || recovered === "failed" || (classic && diagSev === 1)
                  ? 2
                  : 1.5;
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
              // The stop's tab — painted by `TourTab`, which sizes it with
              // `tourTabWidth` (layout.ts) and inks it by whose it is.
              const tab = tourTabs.get(id);
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
              const traceIsOpen = traceOpenNow.has(id);
              // The step's own head word — what the reader's question names
              // ("What did `simp` use?"), read off the source like the gate.
              const stepHead =
                node.data.trace?.tactic ?? tacticHeadWord(node.data.label);
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
              // `ramify.experience` beginner hides `⇓` (not a reader's first
              // move), from the bar and the `⋯` menu alike.
              const collapsible =
                !!run && !!onApplyRewrite && preset.offerCollapse;
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
              // D5 — a context line here has a Mathlib-style name to offer.
              const renamable = (renames.get(id)?.size ?? 0) > 0;
              // THE LIGHTBULB (batch 4): lit where any Quick Fix or Refactor
              // row is on offer — the same booleans those rows are built
              // from, so the bulb and the section cannot disagree. D6's "ask
              // the model" row needs one of these on the node, so it never
              // lights the bulb alone.
              const fixable =
                !proposing &&
                (!!lintable ||
                  expandable ||
                  renamable ||
                  inlinable ||
                  extractable ||
                  collapsible);

              const hasBar =
                !isEditing &&
                !traceLeaf &&
                (automation ||
                  revealable ||
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
                  fixable ||
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
                elidable,
                focusable,
                isFocusRoot,
                anyUsedHyp: !!hyps?.some((l) => l.used),
                ledgerRows: !!node.data.ledger?.some(
                  (r) => r.goalId !== undefined,
                ),
                tourStop: myStopIds.has(id),
                tourMarkable: markWritable,
                tourTab: tab?.who ?? null,
                renamable,
                fixable,
              });

              const diagTip = (nodeDiags ?? [])
                .map((d) => `${diagGlyphOf(d.severity)} ${diagWordOf(d.severity)} — ${d.message}`)
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

              // Ticks are stripped from the UI's own sentences (a native
              // `<title>` cannot draw a code span — ticks.ts) and left
              // on anything quoted from the source: the label, the tactic
              // lists, the arm patterns.
              const nodeTooltip = [
                node.data.proseLabel ? node.data.label : "",
                leafTip,
                subtermTip,
                branchTip,
                armTip,
                usesTip,
                plainTicks(viaTip),
                foldedTip,
                plainTicks(diagTip),
                hints.map((h) => `· ${plainTicks(h)}`).join("\n"),
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
                toggleRows(j, e.altKey);
              };
              // A row's click, and (`every`) its ⌥-click: every row's goal at
              // once. The `⋯` menu's "Show every step's goal" runs the second.
              const toggleRows = (j: number, every: boolean) => {
                const key = rowKeys?.[j];
                if (!key || !node.data.ledger) return;

                anchorOn(id);

                const all = rowKeys.filter((x): x is string => x !== null);
                let opening: string[];
                let closing: string[];
                if (every) {
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
              // Double-click's edit, as a function the `⋯` menu's "Edit"
              // row calls too. `li` is the wrapped line the press landed on
              // (a merged run edits the part that line belongs to).
              const startEdit = (li: number) => {
                cancelPendingReveal();

                if (node.data.proseLabel) {
                  openCommentEdit();
                  return;
                }

                let editPos = position;
                if (partEditable) {
                  const seg = lines[li]?.seg ?? 0;
                  const part =
                    partSegSpans(parts!).find((s) => seg < s.seg0 + s.span)
                      ?.part ?? parts![0];
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
              };

              // The moves no bar button carries — a click, a double-click, a
              // corner, a context line — named for the `⋯` menu. Each row
              // calls the handler its gesture calls. Built only for the node
              // the menu is open on.
              // THE FRONTIER CHIPS' HANDLERS (`+`/`?_`, `sorry`, `calc`, `step`),
              // one closure each: the chip on the pending goal and its row in
              // the goal's `⋯` menu (so the keyboard reaches them) both run
              // these, never a second copy. `chipsOffered` is the chips' own
              // gate; a chip that is not drawn has no row.
              const chipsOffered =
                (type === "goal" ||
                  !!node.data.synthetic ||
                  (type === "tactic" && !!node.data.addLink)) &&
                !!(node.data.addSpec || node.data.addLink) &&
                !!onAddTactic &&
                !isEditing;
              const chips = chipCopy(node.data);
              const chipAdd = () => {
                const spec = node.data.addSpec!;
                setEditing({
                  id,
                  pos: spec.after,
                  original: "",
                  value: "",
                  add: spec,
                });
              };
              const chipSorry = () => {
                anchorOn(id);
                onAddTactic!(node.data.addSpec!, "sorry");
              };
              const chipCalc = () => {
                const options = node.data.calcRels!;
                const spec = node.data.addSpec!;
                if (options.length > 1) {
                  setPicking({ id, kind: "open", spec, options });
                  return;
                }
                startChain(id, spec, options[0].rel, options[0].same);
              };
              const chipStep = () => {
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
                finishPick(
                  id,
                  kind,
                  spec,
                  spec.rel ?? "=",
                  spec.rels?.[0]?.same ?? true,
                );
              };
              // ⌥-click on a ledger row, as a row of the ledger's menu.
              const firstRow = rowKeys
                ? rowKeys.findIndex((k) => k !== null)
                : -1;
              const anyRowClosed =
                !!rowKeys &&
                rowKeys.some((k) => k !== null && !chainOpen.has(k));
              const everyRowSaid = anyRowClosed
                ? "Show every step's goal"
                : "Hide every step's goal";
              const ledgerRows: NodeMove[] =
                menuFor === id && firstRow >= 0
                  ? [
                      {
                        glyph: anyRowClosed ? "+" : "−",
                        codicon: anyRowClosed ? MENU_ICON.plus : MENU_ICON.minus,
                        label: everyRowSaid,
                        title: everyRowSaid,
                        shortcut: "⌥-click a row",
                        slot: "rows",
                        onClick: () => toggleRows(firstRow, true),
                      },
                    ]
                  : [];
              const chipHandlers = {
                add: chipAdd,
                sorry: chipSorry,
                calc: chipCalc,
                step: chipStep,
              };
              const chipMoves: NodeMove[] =
                menuFor === id && chipsOffered
                  ? chipRows(node.data).map(({ kind, ...row }) => ({
                      ...row,
                      slot: "chip" as const,
                      onClick: chipHandlers[kind],
                    }))
                  : [];
              const menuHere = menuFor === id;
              const nFold = folded?.tactics.length ?? 0;
              const renameLabels = menuHere && !proposing
                ? [...(renames.get(id)?.values() ?? [])]
                    .map((rn) => ({
                      rn,
                      label: renameMoveLabel(rn.rewrite.name, rn.to),
                    }))
                    .filter(
                      (x, i, all) =>
                        all.findIndex((y) => y.label === x.label) === i,
                    )
                : [];
              const menuOnlyMoves: NodeMove[] = !menuHere
                ? []
                : [
                ...(isMarker
                  ? [
                      {
                        glyph: "+",
                        codicon: MENU_ICON.plus,
                        label: "Bring back what this box stands for",
                        title: "Bring back what this box stands for",
                        shortcut: "click",
                        keys: "Space",
                        slot: "fold" as const,
                        onClick: () => onNodeClick(id),
                      },
                    ]
                  : []),
                ...(type === "goal" && cuttable
                  ? [
                      folded
                        ? {
                            glyph: `+${nFold}`,
                            codicon: MENU_ICON.unfold,
                            label: `Bring back the ${nFold} hidden step${nFold === 1 ? "" : "s"}`,
                            title: "Bring back the hidden steps",
                            shortcut: `click +${nFold}`,
                            keys: "Space",
                            slot: "fold" as const,
                            onClick: () => onNodeClick(id),
                          }
                        : {
                            glyph: "−",
                            codicon: MENU_ICON.fold,
                            label: "Hide everything below this goal",
                            title: "Hide everything below this goal",
                            shortcut: "click the chevron",
                            keys: "Space",
                            slot: "fold" as const,
                            onClick: () => onNodeClick(id),
                          },
                    ]
                  : []),
                ...((editable || partEditable) && !node.data.proseLabel
                  ? [
                      {
                        glyph: "edit",
                        codicon: MENU_ICON.edit,
                        label: "Edit this tactic",
                        title: "Edit this tactic",
                        shortcut: "double-click",
                        keys: "F2",
                        slot: "edit" as const,
                        onClick: () => startEdit(0),
                      },
                    ]
                  : []),
                ...(commentEditable &&
                (node.data.commentRanges?.length ?? 0) > 0
                  ? [
                      {
                        glyph: "comment",
                        codicon: MENU_ICON.comment,
                        label: "Edit the comment",
                        title: "Edit the comment",
                        shortcut: "double-click the strip",
                        slot: "comment" as const,
                        onClick: () => openCommentEdit(),
                      },
                    ]
                  : []),
                ...(tabMine
                  ? [
                      {
                        glyph: "unmark",
                        codicon: MENU_ICON.unmark,
                        label: "Take your mark off",
                        title: "Take your mark off",
                        shortcut: "⌥-click its tab",
                        slot: "mark" as const,
                        onClick: () => toggleMyStop(id),
                      },
                    ]
                  : nubHere
                    ? [
                        {
                          glyph: "mark",
                          codicon: MENU_ICON.mark,
                          label: "Drop a mark here",
                          title: "Drop a mark here",
                          shortcut: "click the corner",
                          slot: "mark" as const,
                          onClick: () => toggleMyStop(id),
                        },
                        ...(markWritable
                          ? [
                              {
                                glyph: "writeMark",
                                codicon: MENU_ICON.writeMark,
                                label: "Write a `.mark` into the source",
                                title: "Write a `.mark` into the source",
                                shortcut: "⌥-click the corner",
                                slot: "mark" as const,
                                onClick: () => writeMark(id),
                              },
                            ]
                          : []),
                      ]
                    : []),
                // D6 — the model picks one of THIS node's rewrites (Refactor
                // section). Drawn only where the propose gate is open
                // (companion + key + setting) and the node has a rewrite an
                // answer could name.
                ...(!proposing &&
                !!onPropose &&
                proposeReady &&
                agentPrimitives.some((p) => p.nodeId === id)
                  ? [
                      {
                        glyph: "propose",
                        codicon: "sparkle" as const,
                        label: proposeBusy
                          ? "Asking the model…"
                          : PROPOSE_MOVE_LABEL,
                        title: `${PROPOSE_MOVE_LABEL} — it picks one of this step's rewrites and says why; ${CHECKED_FIRST}`,
                        slot: "propose" as const,
                        onClick: () => askAgent(id),
                      },
                    ]
                  : []),
                ...renameLabels.map(({ rn, label }) => ({
                  glyph: `rename:${label}`,
                  codicon: MENU_ICON.edit,
                  label,
                  title: label,
                  shortcut: "⌥-click the line",
                  slot: "rename" as const,
                  onClick: () => proposeRewrite(id, rn.rewrite),
                })),
                ...ledgerRows,
                ...chipMoves,
              ];

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

              const showBarHere = hasBar && (hoverId === id || isArming);
              // EVERY bar-able move on this node, by id — `null` where the
              // move is not available here. The bar reads it in the READER'S
              // order (`barIds`: the pinned list, else `ramify.hoverBar.*`,
              // else the preset), the `⋯` menu in `MOVE_IDS` order; both
              // through `flatMap` over ids and never by filtering an array of
              // moves (the compiler lint reads a property read over an array
              // of ref-touching closures as a ref read during render). Built
              // only where it can be seen: the hovered node's bar, or the
              // node the menu is open on. NO ⚑ (user direction, 2026-09-08):
              // marks are the corner nub's.
              const barKind: BarKind = type === "goal" ? "goal" : "tactic";
              const movesFor = (k: MoveId): NodeMove[] => {
                if (!(showBarHere || menuHere)) return [];
                switch (k) {
                  case "goal":
                    return barLinkPlus
                      ? [
                          {
                            id: k,
                            ...MOVE_LOOK.goal,
                            label: "Show the goal this step proves",
                            shortcut: "click its row",
                            title:
                              "Show the goal this step proves, above it (also: click its ledger row)",
                            onClick: () => {
                              const lp = linkPlus.get(id)!;
                              anchorOn(id);
                              setChainOpen((prev) => new Set(prev).add(lp.key));
                            },
                          },
                        ]
                      : [];
                  // B4 — WHAT DID `simp` USE? The `⁇` is the tactic's own `?`
                  // form said twice: the affordance and the mechanism are the
                  // same character, and it is a question, which is what the
                  // reader is asking.
                  case "trace": {
                    if (!automation) return [];
                    const said = traceMoveLabel(
                      stepHead,
                      traceIsBusy ? "busy" : traceIsOpen ? "open" : "closed",
                    );
                    return [
                      {
                        id: k,
                        ...MOVE_LOOK.trace,
                        glyph: traceIsBusy ? "…" : MOVE_LOOK.trace.glyph,
                        // While the RPC is out the button reads `loading`.
                        codicon: traceIsBusy ? "loading" : MOVE_LOOK.trace.codicon,
                        label: said,
                        title: said,
                        onClick: () => toggleTrace(id),
                      },
                    ];
                  }
                  case "skip":
                    return elidable
                      ? [
                          {
                            id: k,
                            ...MOVE_LOOK.skip,
                            label: isCombined
                              ? "Skip this run"
                              : hasChildren
                                ? "Skip this step"
                                : "Skip this closing step",
                            shortcut: "⌥-click",
                            title: isCombined
                              ? "Skip this run (⌥-click) — the whole run collapses to one dashed box (click it to restore)"
                              : hasChildren
                                ? "Skip this step (⌥-click) — the goal above hops over it and wears +N; the ⋯ on the line names what went (click either to restore)"
                                : "Skip this closing step (⌥-click) — the goal above folds and wears +N (click it to restore)",
                            onClick: () =>
                              isCombined ? elideCombined(id) : elideStep(id),
                            onHover: (on: boolean) => {
                              if (on) {
                                const p = elidePreviewFor(id);
                                if (p)
                                  afterDwell(() =>
                                    setElidePreview({ ...p, from: "bar" }),
                                  );
                              } else {
                                cancelDwell();
                                setElidePreview((p) =>
                                  p?.anchor === id && p.from === "bar"
                                    ? null
                                    : p,
                                );
                              }
                            },
                          },
                        ]
                      : [];
                  // `»` on BOTH kinds (2026-09-22). A tactic's plain click
                  // already reveals, so the button is the bar saying so; a
                  // goal's is `⌘-click`.
                  case "source":
                    return goalRevealable || revealable
                      ? [
                          {
                            id: k,
                            ...MOVE_LOOK.source,
                            label: "Show in source",
                            shortcut: goalRevealable ? `${CMD}-click` : "click",
                            keys: "Enter",
                            title: `Show in source — or ${goalRevealable ? `${CMD}-click` : "click"} the box`,
                            onClick: () =>
                              goalRevealable
                                ? revealAt(position!)
                                : revealAt(actPos!, id),
                          },
                        ]
                      : [];
                  case "focus":
                    return focusable || isFocusRoot
                      ? [
                          {
                            id: k,
                            ...MOVE_LOOK.focus,
                            ...(focusable
                              ? {
                                  label: "Focus on this goal's subtree",
                                  shortcut: "⌥-click",
                                  title: "Focus this subtree (⌥-click)",
                                  onClick: () => focusOn(id),
                                }
                              : {
                                  label: "Back to the whole proof",
                                  shortcut: "⌥-click",
                                  keys: "Esc",
                                  title: "Back to the whole proof (⌥-click, or Esc)",
                                  onClick: exitFocus,
                                }),
                          },
                        ]
                      : [];
                  case "path":
                    return pathable || isPathRoot
                      ? [
                          {
                            id: k,
                            ...MOVE_LOOK.path,
                            ...(pathable
                              ? {
                                  label: "Show only the path to here",
                                  title:
                                    "Only this path: hide everything not on the way from the root to here, and everything not under it",
                                  onClick: () => pathOn(id),
                                }
                              : {
                                  label: "Show the whole proof again",
                                  keys: "Esc",
                                  title: "Show the whole proof again (Esc)",
                                  onClick: exitPath,
                                }),
                          },
                        ]
                      : [];
                  // `⧉` — the LENS: the tactic opened in a slim editor below
                  // the infoview (the companion's).
                  case "lens":
                    return popoutable
                      ? [
                          {
                            id: k,
                            ...MOVE_LOOK.lens,
                            label: "Open to the side",
                            title: "Open to the side — the tactic in a slim editor below the infoview (the lens)",
                            onClick: () =>
                              onPopoutEdit!(
                                getTacticEdit?.(actPos!)?.pos ?? actPos!,
                              ),
                          },
                        ]
                      : [];
                  // D1 — RESTRUCTURING. `⤵` puts a `have` down into its one
                  // use, `⤴` lifts a `(by …)` out into a `have`: the arrows
                  // point the way the text moves. Neither writes anything on
                  // its own — the click opens a PROPOSAL, and the elaborator
                  // decides whether it can be taken.
                  case "inline":
                    return inlinable && !proposing
                      ? [
                          {
                            id: k,
                            ...MOVE_LOOK.inline,
                            label: inlineMoveLabel(rw!.inline!.name),
                            title: `${inlineMoveLabel(rw!.inline!.name)} — ${CHECKED_FIRST}`,
                            onClick: () => proposeRewrite(id, rw!.inline!),
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
                      : [];
                  case "extract":
                    return extractable && !proposing
                      ? [
                          {
                            id: k,
                            ...MOVE_LOOK.extract,
                            label: EXTRACT_MOVE_LABEL,
                            title: `${EXTRACT_MOVE_LABEL} — ${CHECKED_FIRST}`,
                            onClick: () => proposeRewrite(id, rw!.extract!),
                          },
                        ]
                      : [];
                  // D2 — `⇓` takes a RUN down to one tactic, `⇑` brings what
                  // that tactic used back up into the source. Both open the
                  // same proposal pill.
                  case "collapse":
                    return collapsible && !proposing
                      ? [
                          {
                            id: k,
                            ...MOVE_LOOK.collapse,
                            label: collapseMoveLabel(run!.steps.length),
                            title: `${collapseMoveLabel(run!.steps.length)} — Lean tries ${AUTOMATION_CANDIDATES.slice(0, 4).join(", ")}… and offers the first that works`,
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
                      : [];
                  case "expand":
                    return expandable && !proposing
                      ? [
                          {
                            id: k,
                            ...MOVE_LOOK.expand,
                            label: expandMoveLabel(stepHead),
                            title: `${expandMoveLabel(stepHead)} — ${CHECKED_FIRST}`,
                            onClick: () => proposeExpand(id),
                          },
                        ]
                      : [];
                  // D4 — FIX THE LINT, offered only where a lint on this node
                  // HAS a one-edit answer; the click opens the proposal pill.
                  case "lint":
                    return lintable && !proposing
                      ? [
                          {
                            id: k,
                            ...MOVE_LOOK.lint,
                            label: lintMoveLabel(lintable.title),
                            title: `${lintMoveLabel(lintable.title)} — ${CHECKED_FIRST}`,
                            onClick: () => proposeLintFix(id),
                          },
                        ]
                      : [];
                  // THE LIGHTBULB (batch 4): not a move of its own but the
                  // door to the menu's Quick Fix and Refactor sections —
                  // VS Code's `lightbulb`, `lightbulb-autofix` in its own ink
                  // where one of the fixes is the linter's.
                  case "fix": {
                    if (!fixable) return [];
                    const said = fixMoveLabel(!!lintable);
                    return [
                      {
                        id: k,
                        ...MOVE_LOOK.fix,
                        ...(lintable
                          ? {
                              codicon: "lightbulb-autofix" as const,
                              ink: LIGHTBULB_AUTOFIX_INK,
                            }
                          : { ink: LIGHTBULB_INK }),
                        label: said,
                        title: `${said} (${KEY_MENU})`,
                        onClick: (el?: Element) => openNodeMenu(id, el, true),
                      },
                    ];
                  }
                  case "delete": {
                    if (!deletable || isArming) return [];
                    const said =
                      type === "goal"
                        ? "Delete this goal's proof"
                        : isCombined
                          ? "Delete this run of tactics"
                          : "Delete this tactic";
                    return [
                      {
                        id: k,
                        ...MOVE_LOOK.delete,
                        label: said,
                        title: said,
                        danger: true,
                        active: arming?.id === id,
                        onClick: () => {
                          cancelDwell();
                          setDeletePreview(null);
                          setArming({
                            id,
                            spec: node.data.deleteSpec ?? delSpecs.get(id)!,
                          });
                        },
                        // Hovering the can fades exactly what it takes — the
                        // ◌ preview's rule, over the delete extent instead of
                        // the cut's members.
                        onHover: (on: boolean) => {
                          if (on) {
                            const ids = extentIds(delExtent!, id);
                            afterDwell(() =>
                              setDeletePreview({ anchor: id, ids }),
                            );
                          } else {
                            cancelDwell();
                            setDeletePreview((pv) =>
                              pv?.anchor === id ? null : pv,
                            );
                          }
                        },
                      },
                    ];
                  }
                }
              };
              // THE BAR KEEPS EVERY SLOT (2026-09-28). A move the reader's list
              // names but this node cannot take is drawn DISABLED, tip and
              // all, so the bar is the same width on every box of a kind and
              // no button shifts under the pointer; `⋯` still omits it. What
              // is impossible for the WHOLE session — no companion, no edit
              // hooks — or can never apply to the node's KIND does not exist
              // and is not drawn. ONE gate answers all of it, as plain
              // booleans (the compiler lint reads any property read, `.length`
              // included, over `movesFor`'s array of ref-touching closures as
              // a ref read during render, so "is there a live move" cannot be
              // asked of that array). Keep in step with `movesFor`'s `case`s.
              const pendingProposal = proposing && !isArming;
              const avail = (
                k: MoveId,
                yes: boolean,
                session: boolean,
                why: Unavailable,
              ): Availability =>
                yes
                  ? "yes"
                  : session
                    ? "never-session"
                    : !appliesToKind(k, barKind)
                      ? "never-kind"
                      : { no: why };
              const availability = (k: MoveId): Availability => {
                const restructureWhy = pendingProposal ? "pending" : "generic";
                switch (k) {
                  case "goal":
                    return avail(k, barLinkPlus, false, "generic");
                  case "trace":
                    return avail(
                      k,
                      automation,
                      !onTrace && traces.size === 0,
                      "notAutomation",
                    );
                  case "skip":
                    return avail(
                      k,
                      elidable,
                      false,
                      isMarker
                        ? "marker"
                        : node.data.ledgerKind
                          ? "ledger"
                          : node.data.branch &&
                              node.data.branch.form !== "rewrite"
                            ? "split"
                            : "generic",
                    );
                  case "source":
                    return avail(
                      k,
                      goalRevealable || revealable,
                      !onReveal,
                      isMarker ? "marker" : "noPosition",
                    );
                  case "focus":
                    return avail(k, focusable || isFocusRoot, false, "leaf");
                  case "path":
                    return avail(
                      k,
                      pathable || isPathRoot,
                      false,
                      isMarker ? "marker" : "generic",
                    );
                  case "lens":
                    return avail(k, popoutable, !onPopoutEdit, "generic");
                  case "inline":
                    return avail(
                      k,
                      inlinable && !proposing,
                      !caps.restructure,
                      restructureWhy,
                    );
                  case "extract":
                    return avail(
                      k,
                      extractable && !proposing,
                      !caps.restructure,
                      restructureWhy,
                    );
                  case "collapse":
                    return avail(
                      k,
                      collapsible && !proposing,
                      !caps.restructure || !preset.offerCollapse,
                      restructureWhy,
                    );
                  case "expand":
                    return avail(
                      k,
                      expandable && !proposing,
                      !caps.restructure,
                      restructureWhy,
                    );
                  case "lint":
                    return avail(
                      k,
                      !!lintable && !proposing,
                      !caps.restructure,
                      restructureWhy,
                    );
                  case "fix":
                    return avail(k, fixable, !caps.restructure, restructureWhy);
                  case "delete":
                    return avail(
                      k,
                      deletable && !isArming,
                      !(onDeleteTactic && deleteSlots),
                      isArming
                        ? "arming"
                        : isMarker
                          ? "marker"
                          : "noExtent",
                    );
                }
              };
              const barSlot = (k: MoveId): NodeMove[] => {
                const a = availability(k);
                return a === "yes"
                  ? movesFor(k)
                  : typeof a === "object"
                    ? disabledSlot(k, unavailableTip(k, a.no))
                    : [];
              };
              const barMoves: NodeMove[] = showBarHere
                ? barIds[barKind].flatMap(barSlot)
                : [];
              const moves: NodeMove[] = menuHere
                ? [
                    // `fix` is the menu's door, not a row in it.
                    ...MOVE_IDS.flatMap((k) => (k === "fix" ? [] : movesFor(k))),
                    ...menuOnlyMoves,
                  ]
                : [];

              const said = node.data.label.replace(/\s+/g, " ").trim();
              const ariaLabel = node.data.traceLeaf
                ? `Lemma: ${said}`
                : isMarker
                  ? `Skipped: ${said}${ghostMore > 0 ? `, ${ghostMore} hidden` : ""}`
                  : type === "goal"
                    ? `Goal: ${said}${folded ? `, ${folded.tactics.length} hidden` : ""}`
                    : `Tactic: ${said}${recovered === "failed" ? ", failed" : ""}`;

              return (
                <g
                  key={id}

                  data-node={id}
                  // Keyboard navigation: a tree item in the frame's tree.
                  // `data-ptw-act` / `data-ptw-editable` say the node has a
                  // click / double-click handler for Enter / F2 to reach.
                  id={domIdOf(id)}
                  role="treeitem"
                  aria-label={ariaLabel}
                  aria-level={(nav.depth.get(id) ?? 0) + 1}
                  aria-expanded={
                    folded || isMarker ? false : myCut ? true : undefined
                  }
                  aria-selected={id === activeNow}
                  data-ptw-act={clickable && !isEditing ? "" : undefined}
                  data-ptw-editable={
                    (editable ||
                      partEditable ||
                      (node.data.proseLabel && commentEditable)) &&
                    !isEditing
                      ? ""
                      : undefined
                  }
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
                  // Right-click: the move menu at the pointer (VS Code's
                  // context menu; ⇧F10 and ${CMD}. from the keys).
                  onContextMenu={
                    !isEditing && !traceLeaf
                      ? (e) => openNodeMenuAt(id, e)
                      : undefined
                  }
                  onDoubleClick={
                    (editable ||
                      partEditable ||
                      (node.data.proseLabel && commentEditable)) &&
                    !isEditing
                      ? (e) => {
                          e.stopPropagation();
                          const el = (e.target as Element).closest?.(
                            "[data-ptw-lineidx]",
                          ) as HTMLElement | null;
                          startEdit(el ? Number(el.dataset.ptwLineidx) : 0);
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
                          if (elidable || deletable) cancelDwell();
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
                      <tspan opacity={DIM_OPACITY}>{CASE_PREFIX}</tspan>
                      {node.data.caseLabel}
                    </text>
                  )}

                  {node.data.commentLines.length > 0 && (
                    <text
                      textAnchor="start"
                      fontSize={COMMENT_FONT_PX}
                      fontFamily={getCodeFontFamily()}
                      fontStyle="italic"
                      fill={
                        node.data.commentGenerated ? GHOST_TEXT_FILL : COMMENT_FILL
                      }

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
                            stripX + line.indent
                          }

                          y={
                            stripTop +
                            (j + 0.5) * COMMENT_LINE_H
                          }
                          dy="0.32em"
                        >
                          {line.text}
                        </tspan>
                      ))}
                    </text>
                  )}

                  {/* WIDE: the strip floats centred above its step with only the
                      gap between them, so a hairline in comment ink runs across
                      that gap, from the strip's foot to the box's top edge —
                      the strip reads as this step's, and the link above reads
                      through to the box. Paint only: it lies wholly inside the
                      node's own reserved comment block. */}
                  {!compact &&
                    node.data.commentLines.length > 0 &&
                    !node.data.commentBelow &&
                    !hideForEdit && (
                      <line
                        data-ptw-strip-tie=""
                        x1={0}
                        x2={0}
                        y1={boxTop - COMMENT_GAP + 1}
                        y2={boxTop}
                        stroke={COMMENT_FILL}
                        strokeWidth={1}
                        opacity={DIM_OPACITY}
                        pointerEvents="none"
                      />
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
                            stripX + 1
                          }
                          y={
                            stripTop +
                            3
                          }
                          width={1.5}
                          rx={0.75}

                          height={
                            node.data.commentLines.length * COMMENT_LINE_H - 6
                          }
                          fill={COMMENT_FILL}
                          opacity={FAINT_OPACITY}
                        />
                        {(() => {
                          const mx =
                            stripX + COMMENT_RULE_INDENT;
                          const my =
                            stripTop +
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
                                  ? "Collapse this comment back to its first lines"
                                  : "Show the rest of this comment"}
                              </title>

                              <rect
                                x={mx - COMMENT_MORE_PAD}
                                y={my - COMMENT_LINE_H / 2}
                                width={mw + COMMENT_MORE_PAD * 2}
                                height={COMMENT_LINE_H}
                                rx={CHROME_RADIUS}
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
                          classicDiagStroke ??
                          (node.data.proseLabel ? PROSE_FILL : style.stroke))
                    }
                    strokeWidth={boxSw}

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

                  {/* A FOLDED goal's box wears the editor's folded-range wash
                      (`--ptw-fold-bg`) over its own fill, under its text. */}
                  {folded?.kind === "fold" && !hideForEdit && !classic && (
                    <rect
                      x={-w / 2}
                      y={boxTop}
                      width={w}
                      height={h}
                      rx={boxRx}
                      fill="var(--ptw-fold-bg)"
                      pointerEvents="none"
                    />
                  )}

                  {/* The KEYBOARD RING: the box grown by 3 (5 on a GHOST,
                      whose dashed border a ring 1px off read as one mixed
                      dotted line), in the focus ink, drawn only while the
                      frame has keyboard focus and this is the node the
                      arrows are on. Where the node wears a mark tab the ring
                      is an OPEN path that leaves the tab the corner
                      (`ringPath`). Paint only — it reserves nothing and
                      takes no pointer. */}
                  {treeFocus === "kb" && id === activeNow && !hideForEdit && (
                    <path
                      d={ringPath(
                        -w / 2 - ringGrow,
                        boxTop - ringGrow,
                        w / 2 + ringGrow,
                        boxTop + h + ringGrow,
                        boxRx + ringGrow,
                        tab
                          ? {
                              right: -w / 2 + tourTabWidth(tab.n) / 2,
                              grow: ringGrow,
                            }
                          : undefined,
                      )}
                      fill="none"
                      stroke={FOCUS_INK}
                      strokeWidth={2}
                      style={{ pointerEvents: "none" }}
                    />
                  )}

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
                      fill={HYP_LIT_STRONG_FILL}
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
                        fill={NODE_TEXT}
                        opacity={accent || hoverId === id ? 1 : DIM_OPACITY}
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

                  {diagSev !== null && !hideForEdit &&
                    (() => {
                      // VS Code's own mark: a squiggle (error, warning) or the
                      // hint's dots (a lint) under the text the message is
                      // about — the box's LAST line (a tactic's label, a
                      // goal's target), in its bottom padding, so it reserves
                      // and measures nothing. Hovering it shows the messages,
                      // as the editor's hover does.
                      const last = lines[lines.length - 1];
                      const indent = last?.indent ?? 0;
                      const sx = -w / 2 + NODE_PAD + indent;
                      const sw = Math.min(
                        w - 2 * NODE_PAD - indent,
                        measureText(last?.text ?? "", NODE_FONT_PX),
                      );
                      const sy = boxTop + h - NODE_PAD_Y - 1;
                      // The appearance seam (`DiagMark`): the squiggle, or
                      // the classic ribbon down the inner left edge (below a
                      // mark tab, which stands on the top-left corner).
                      return (
                        <DiagMark
                          sev={diagSev}
                          selected={!!diagCur && diagCur.nodeId === id}
                          squiggle={{ x: sx, y: sy, width: sw }}
                          box={{
                            x: -w / 2,
                            top: boxTop,
                            w,
                            h,
                            rx: boxRx,
                            sw: boxSw,
                            tabInset: tab ? BADGE_H / 2 + RIBBON_TAB_GAP : 0,
                            padW: NODE_PAD,
                          }}
                          onEnter={() => setHoverDiag(id)}
                          onLeave={() =>
                            setHoverDiag((cur) => (cur === id ? null : cur))
                          }
                        />
                      );
                    })()}

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
                          ? `⌥-click: ${renameMoveLabel(rn.rewrite.name, rn.to)} — Mathlib's name for ${rn.rule.what}`
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

                  {/* The goal's corner control, top-right (user direction),
                      VS Code's fold control (2026-10-04). OPEN: a
                      `chevron-down` in the gutter's folding ink, faded in
                      while the box is hovered (theme.ts, the editor's
                      `showFoldingControls: mouseover` with its 0.5s fade —
                      no dwell: it is the control itself, not a preview of
                      what it would take) or keyboard-active. FOLDED: a
                      `chevron-right`, always, then `+N` in the fold
                      placeholder's ink and the box washed in the folded
                      range's — the editor's folded line. Both sit on the
                      top line's middle (`topLineMid`). A HOP's goal is not
                      folded (its continuation is still drawn; the `⋯` chip on
                      the line says what went), so it wears `+N` alone, in the
                      same place, and no chevron. Seeded: italic `+N`.
                      `sizeOf` reserves `CORNER_W` on the top line for all of
                      it; `FOLD_ICON`/`FOLD_PH_X`/`topLineMid` place it. */}
                  {cuttable &&
                    !hideForEdit && (
                    <>
                      {classic &&
                        (folded ? (
                          // CLASSIC (appearance.ts; 5a504e7^): `+N` at the
                          // corner's right end in the node's ink (seeded:
                          // italic comment ink), on a fold and a hop alike…
                          <text
                            x={w / 2 - 6}
                            y={boxTop + 12}
                            textAnchor="end"
                            fontSize={BADGE_FONT_PX + 1}
                            fontFamily={getCodeFontFamily()}
                            fontStyle={folded.seeded ? "italic" : undefined}
                            fill={folded.seeded ? "var(--ptw-comment)" : NODE_TEXT}
                            opacity={folded.seeded ? undefined : DIM_OPACITY}
                            pointerEvents="none"
                            style={{ letterSpacing: 0 }}
                          >
                            {`+${folded.tactics.length}`}
                          </text>
                        ) : (
                          // …and open, the drawn `−`, always shown, in the
                          // node's stroke ink. Inside `CORNER_W`'s reserve.
                          <path
                            d={`M${w / 2 - 8 - CLASSIC_MINUS_W / 2} ${boxTop + 8}h${CLASSIC_MINUS_W}`}
                            stroke={style.stroke}
                            strokeWidth={CLASSIC_MINUS_SW}
                            strokeLinecap="round"
                            pointerEvents="none"
                          />
                        ))}
                      {!classic && folded?.kind !== "hop" && (
                        <g
                          data-ptw-foldctl={folded ? "folded" : "open"}
                          style={
                            treeFocus === "kb" && id === activeNow
                              ? { opacity: 1 }
                              : undefined
                          }
                          pointerEvents="none"
                        >
                          <Codicon
                            name={folded ? "chevron-right" : "chevron-down"}
                            size={FOLD_ICON}
                            x={w / 2 - CORNER_W}
                            y={
                              boxTop +
                              topLineMid(!!hyps && hyps.length > 0) -
                              FOLD_ICON / 2
                            }
                            color="var(--ptw-fold-ctl)"
                          />
                        </g>
                      )}
                      {!classic && folded && (
                        <text
                          x={w / 2 - CORNER_W + FOLD_PH_X}
                          y={
                            boxTop +
                            topLineMid(!!hyps && hyps.length > 0) +
                            FOLD_PH_DROP
                          }
                          fontSize={BADGE_FONT_PX + 1}
                          fontFamily={getCodeFontFamily()}
                          fontStyle={folded.seeded ? "italic" : undefined}
                          fill="var(--ptw-fold-ph)"
                          pointerEvents="none"
                          style={{ letterSpacing: 0 }}
                        >
                          {`+${folded.tactics.length}`}
                        </text>
                      )}
                      {/* THE HIT AREA: an invisible rect over the corner the
                          top line leaves free (`CORNER_W` wide, the reserve
                          `sizeOf` makes, so it lies over no text) and
                          `CORNER_HIT_H` tall. The glyph alone was the target
                          before — a 7 × 1 dash. Paint only, like the nub's
                          region: the click is the node's own (a goal's click
                          folds or opens), the rect adds the pointer cursor and
                          carries the open face's fade preview (after the
                          dwell, as before). */}
                      <rect
                        data-ptw-corner=""
                        x={w / 2 - CORNER_W}
                        y={boxTop}
                        width={CORNER_W}
                        height={CORNER_HIT_H}
                        fill="transparent"
                        pointerEvents="all"
                        style={{ cursor: "pointer" }}
                        // Hovering the open chevron fades exactly what the click would
                        // take — the skip button's preview, by the same rule
                        // and sparing the anchor (this node) for the same
                        // reason: the control under the pointer must not read
                        // disabled. `+N` has no preview: nothing it stands
                        // for is drawn.
                        onPointerEnter={
                          !folded && myCut
                            ? () => {
                                const ids = cutExtentIds(myCut);
                                afterDwell(() =>
                                  setElidePreview({
                                    anchor: id,
                                    ids,
                                    from: "bar",
                                  }),
                                );
                              }
                            : undefined
                        }
                        //
                        // Leaving and pressing are wired on BOTH faces: the
                        // press folds the goal, and a `+N` face with no
                        // leave handler would strand a preview (or a pending
                        // dwell) that the open face started.
                        onPointerLeave={dropCornerPreview}
                        onPointerDown={dropCornerPreview}
                      />
                    </>
                  )}

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
                                    borderRadius: CHROME_RADIUS,
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
                                  opacity: PREVIEW_OPACITY,
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
                          {/* The goal's `⊢` in the infoview's turnstile ink
                              (colour only: the characters are unchanged). */}
                          {j === 0 &&
                          type === "goal" &&
                          !isMarker &&
                          line.text.startsWith(TURNSTILE) ? (
                            <>
                              <tspan fill={TURNSTILE_FILL}>{TURNSTILE.trim()}</tspan>
                              {line.text.slice(TURNSTILE.trim().length)}
                            </>
                          ) : (
                            line.text
                          )}
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
                            opacity={PREVIEW_OPACITY}
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
                            rx={CHROME_RADIUS}
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
                              const spec: AddSpec = {
                                ...picking.spec,
                                rel: o.rel,
                              };
                              setPicking(null);
                              finishPick(id, picking.kind, spec, o.rel, o.same);
                            }}
                          />
                        ) : (
                          <>
                            {node.data.addSpec && (
                              <>
                                <FrontierChip
                                  glyph={addChipGlyph(node.data.addSpec)}
                                  title={chips.add!.title}

                                  x={chipLaneXs(node.data.addSpec)[0]}
                                  width={addChipWidth(node.data.addSpec)}
                                  color={NODE_STYLES.tactic.stroke}
                                  onPick={chipAdd}
                                />
                                <FrontierChip
                                  glyph="sorry"
                                  title={chips.sorry!.title}
                                  x={chipLaneXs(node.data.addSpec)[1]}
                                  width={CHIP_W_SORRY}
                                  fontSize={9}
                                  color={SORRY_FILL}

                                  onPick={chipSorry}
                                />
                              </>
                            )}

                            {node.data.calcRels && (
                              <FrontierChip
                                glyph="calc"

                                title={chips.calc!.title}
                                x={chipLaneXs(node.data.addSpec)[2]}
                                width={CHIP_W_STEP}
                                fontSize={9}
                                color={NODE_STYLES.tactic.stroke}
                                onPick={chipCalc}
                              />
                            )}

                            {node.data.addLink && (
                              <FrontierChip
                                glyph="step"
                                title={chips.step!.title}
                                x={
                                  chipLaneXs(node.data.addSpec)[
                                    node.data.addSpec ? 2 : 0
                                  ]
                                }
                                width={CHIP_W_STEP}
                                fontSize={9}
                                color={NODE_STYLES.tactic.stroke}
                                onPick={chipStep}
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
                  {tab && !hideForEdit && !isEditing && (
                    <TourTab
                      cx={-w / 2}
                      cy={boxTop}
                      n={tab.n}
                      total={tabStops.length}
                      mine={tabMine}
                      on={tabOn}
                      font={tabFont}
                      onJump={() => goToTab(id)}
                      onRemove={() => toggleMyStop(id)}
                    />
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
                          ? plainTicks("Drop a mark here — ⌥-click writes `.mark` into the source")
                          : plainTicks("Drop a mark here — `<` and `>` read the marks")}
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
                      rx={CHROME_RADIUS}
                      fill="none"
                      stroke={SEQ_STROKE}
                      strokeDasharray="2 2"
                      opacity={STUB_OPACITY}
                    />
                  )}

                  {/* THE `⋯` MENU, portalled into the frame (HTML, above the
                      tree) but owned by this node, so its rows are this
                      node's own closures. It stops every mouse event at its
                      edge: in React's tree it sits inside this `<g>` and the
                      scroll frame, whose click and marquee handlers must not
                      see a press on a row. */}
                  {menuHere &&
                    frameEl &&
                    createPortal(
                      <NodeMenu
                        at={nodeMenu!}
                        moves={moves}
                        kind={barKind}
                        pinned={barIds[barKind]}
                        onPin={(k) => pinMove(barKind, k)}
                        onClose={() => setNodeMenu(null)}
                      />,
                      frameEl,
                    )}
                  {showBarHere && (
                    <NodeActionBar
                      placement={type === "tactic" ? "right" : "top-right"}
                      x={w / 2 - BAR_OVERLAP}
                      y={type === "tactic" ? boxTop + h / 2 : boxTop}
                      boxTop={boxTop}
                      clearLeft={
                        tab
                          ? -w / 2 + tourTabWidth(tab.n) / 2 + BAR_GAP
                          : undefined
                      }
                      actions={[
                        ...barMoves,
                        {
                          glyph: "⋯",
                          codicon: "ellipsis",
                          title: "More: every move on this node, what its icon means, and which ones sit on the bar",
                          onClick: (el?: Element) => openNodeMenu(id, el),
                        },
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
                      opacity={PREVIEW_OPACITY}
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
                      rx={CHROME_RADIUS}
                      fill="var(--ptw-surface)"
                      stroke={CHROME_BORDER}
                      strokeWidth={1}
                      style={{
                        filter: CHIP_SHADOW,
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
                const said = pillMove(
                  proposal.kind,
                  proposal.title ?? proposal.rewrite.title,
                );
                // An EXPAND is not about length — it writes out what the
                // automation used and the proof is the same proof — so it
                // does not carry the step-count clause the other three do.
                // …and neither is a LINT FIX: `write \`·\` for the focusing
                // dot → same length` was true and beside the point. Only the
                // moves that claim to shorten the proof carry the clause.
                // …and neither is a COLLAPSE (2026-09-22): "Replace these 4
                // steps with `omega`" already says how many go.
                const lenClause =
                  proposal.kind === "expand" ||
                  proposal.kind === "rename" ||
                  proposal.kind === "lint" ||
                  proposal.kind === "collapse"
                    ? ""
                    : ` → ${shorter}`;
                // The pill is code font throughout, so a code span cannot be
                // told apart by face: its ticks are stripped (ticks.ts),
                // and `chipWidth` measures exactly the string painted.
                const label = plainTicks(
                  proposal.phase === "checking"
                    ? `${said} — checking with Lean…`
                    : proposal.phase === "ok"
                      ? `${pillMove(proposal.kind, proposal.rewrite.title)}${lenClause} · ✓ elaborates`
                      : `✗ ${clipLine(proposal.message ?? "it does not check", 72)}`,
                );
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
                      rx={CHROME_RADIUS}
                      fill="var(--ptw-surface)"
                      stroke={CHROME_BORDER}
                      strokeWidth={1}
                      style={{
                        filter: CHIP_SHADOW,
                      }}
                    />
                    <FrontierChip
                      glyph={label}
                      title={
                        (proposal.why ? `Proposed: ${proposal.why}\n` : "") +
                        (live
                          ? `Write it — ${CMD}Z in the editor undoes it`
                          : proposal.phase === "checking"
                            ? "Lean is re-checking the proof with this change in place"
                            : "Lean rejected this change; nothing was written")
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
                fillOpacity={WASH_OPACITY}
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
                        // The editor's own diagnostic hover: the hover
                        // widget's surface, border and ink.
                        ...POPUP_CHROME,
                        background: chromeSurface(HOVER_BG),
                        width: "max-content",
                        maxWidth: 460,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        borderWidth: 1,
                        borderStyle: "solid",
                        // Classic: the worst severity's ink, as it was.
                        borderColor: classic
                          ? diagInkOf(list[0].severity)
                          : HOVER_BORDER,
                      }}
                    >
                      {list.map((d, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            gap: 6,
                            alignItems: "flex-start",
                          }}
                        >
                          <DiagIcon sev={d.severity} size={15} />
                          <span
                            style={{
                              fontFamily: getCodeFontFamily(),
                              fontSize: CHROME_TEXT_SM,
                              lineHeight: "15px",
                              whiteSpace: "pre-wrap",
                              color: HOVER_FG,
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
                const editTab = tourTabs.get(editing.id);

                const topH = bandTopH(en.data);
                const boxTop = (topH - h) / 2;

                const proseEdit = !!editing.comment && !!en.data.proseLabel;

                const overlayY = proseEdit
                  ? boxTop
                  : editing.comment
                    ? commentStripTop(en.data) - NODE_PAD_Y
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
                const editRx = nodeRx(en.data.type);
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
                // WHAT AN EMPTY COMMIT DOES, said where the reader is looking
                // (2026-09-28): Enter on an empty comment deletes the line,
                // on an empty tactic it cancels — two behaviours behind one
                // gesture. The textarea's own placeholder carries it where it
                // fits the editor's width; a narrow tactic box (`rw [ih]`)
                // cannot hold the sentence and the editor's size is not ours
                // to change, so the hint hangs BELOW it instead. Both are
                // paint: nothing here is measured.
                const emptyHint =
                  editing.value !== "" || editing.add || editing.calcStage
                    ? null
                    : editing.comment
                      ? editing.original === ""
                        ? "Enter with nothing adds no comment · Esc cancels"
                        : "Enter deletes this comment · Esc keeps it"
                      : "Enter with nothing cancels — the trash deletes a step";
                const hintFits =
                  emptyHint !== null &&
                  measureText(emptyHint, editFontPx, !!editing.comment) <=
                    fw - 2 * NODE_PAD;
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

                          data-ptw-hint=""
                          placeholder={hintFits ? (emptyHint ?? "") : ""}

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
                              editing.comment ? PROSE_FILL : FOCUS_INK
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
                        {emptyHint !== null && !hintFits && (
                          <div
                            aria-hidden
                            style={{
                              position: "absolute",
                              left: 0,
                              top: "100%",
                              marginTop: 4,
                              zIndex: 2,
                              pointerEvents: "none",
                              whiteSpace: "nowrap",
                              padding: "1px 6px",
                              borderRadius: CHROME_RADIUS,
                              background: "var(--ptw-bg)",
                              color: "var(--ptw-comment)",
                              fontStyle: "italic",
                              fontFamily: getCodeFontFamily(),
                              fontSize: COMMENT_FONT_PX,
                            }}
                          >
                            {emptyHint}
                          </div>
                        )}
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
                              borderRadius: CHROME_RADIUS,
                              fontFamily: getCodeFontFamily(),
                              fontSize: NODE_FONT_PX,
                              lineHeight: `${LINE_H}px`,
                              letterSpacing: 0,
                              boxShadow: POPUP_CHROME.boxShadow,
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
                                    opacity: DIM_OPACITY,
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
                    {/* The node's MARK stays on screen while it is edited:
                        the same tab, ABOVE the editor and fully inert, so
                        the edit neither hides the mark (which read as it
                        being deleted) nor lets it take a click meant for
                        the caret. */}
                    {editTab && (
                      <TourTab
                        inert
                        cx={-w / 2}
                        cy={boxTop}
                        n={editTab.n}
                        total={tabStops.length}
                        mine={editTab.who === "mine"}
                        on={editing.id === currentStopId}
                        font={codeFont}
                      />
                    )}
                  </g>
                );
              })()}
          </g>
        </svg>
      </div>
      {/* THE IN-PAGE TOOLTIP, above every floater (tip.tsx). */}
      <TipLayer />
    </div>
    </AppearanceContext.Provider>
    </TipContext.Provider>
  );
}

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

