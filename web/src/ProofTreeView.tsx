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
  LINE_H,
  NODE_FONT_PX,
  NODE_PAD,
  NODE_PAD_Y,
  ARROW_GAP,
  TRUNK_INSET,
  COMMENT_FONT_PX,
  COMMENT_LINE_H,
  COMMENT_INDENT,
  CASE_FONT_PX,
  CASE_LINE_H,
  getCodeFontFamily,
  refreshCodeFontFamily,
  measureText,
} from "./layout";
import type { Proof, ProofStepPosition } from "./paperproof";
import { stepGoalsAfter } from "./paperproof";
import type { AddSpec, HypLine } from "./types";
import {
  positionContains,
  proofToTree,
  rootIds,
  tacticNodeAt,
} from "./proofToTree";
import type { HypMode } from "./proofToTree";
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
  ensurePaletteStyle,
  resolveThemeKind,
} from "./theme";

// The interactive proof tree: layout, folding, zoom/scroll, and the SVG render.
// It is deliberately source-agnostic — it takes a single `Proof` and knows
// nothing about where it came from. The standalone app (App.tsx) feeds it a
// proof parsed from NDJSON; the Lean infoview widget (widget.tsx) feeds it a
// proof fetched over RPC and additionally wires the node↔source link via
// `onReveal` (tree→source) and `highlightPos` (source→tree).

// Snapshot taken on fold/unfold so we can re-anchor the scroll position to the
// toggled node after the relayout (see `toggle`).
interface Anchor {
  id: string;
  x: number;
  y: number;
  sx: number;
  sy: number;
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
      "Context: only hypotheses the tactic below actually mentions (click for the ones it introduced too)",
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

// Frontier-chip row geometry (see FrontierChip). Widths are fixed rather than
// measured: both labels are constant, and the row must not resize per node.
const CHIP_H = 15;
const CHIP_GAP = 6;
const CHIP_W_ADD = 20;
const CHIP_W_SORRY = 36;

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 2;
const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
// Clamp a scroll offset into [0, max]; used everywhere an effect restores scroll.
const clampScroll = (v: number, max: number) => Math.max(0, Math.min(max, v));

const HYP_MARK = "▸";

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
  // Dim only as contrast: when nothing is marked, everything keeps full ink.
  const lineFill = (used: boolean) =>
    anyUsed && !used ? HYP_UNUSED_FILL : HYP_USED_FILL;

  return (
    <>
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
              <tspan key={j} x={x} y={y + (j + 0.5) * HYP_LINE_H} dy="0.32em">
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
          height={lines.length * HYP_LINE_H}
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
              y={y + (j + 0.5) * HYP_LINE_H}
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
  renderTaggedGoal?: (goalId: string, lines: string[]) => ReactNode[] | null;
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
  ) => ReactNode[] | null;
  /**
   * Widget-only: insert a NEW tactic for a pending goal (the (+) chip).
   * `spec` says where and in what form (bullet/case/plain line); `text` is
   * what the user typed. widget.tsx turns it into a document insertion via
   * the editor's own edit pipeline.
   */
  onAddTactic?: (spec: AddSpec, text: string) => void;
  /**
   * Widget-only: the pointer entered (`pos`) or left (`null`) a tactic node.
   * The widget paints a decoration over that range in the editor, so hovering
   * the tree lights up the corresponding source — the hover-weight sibling of
   * the click-weight reveal. Debouncing belongs to the implementation, not
   * here: the view reports raw enter/leave.
   */
  onHoverTactic?: (pos: ProofStepPosition | null) => void;
}

export default function ProofTreeView({
  proof,
  onReveal,
  getTacticEdit,
  onEditTactic,
  onPopoutEdit,
  highlightPos,
  headerExtra,
  height = "100vh",
  renderTaggedGoal,
  renderTaggedHyps,
  renderTaggedTactic,
  onAddTactic,
  onHoverTactic,
}: ProofTreeViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Accordion: expanding a node collapses its sibling branches, so only one
  // branch is open per level (the "view one branch at a time" mode).
  const [accordion, setAccordion] = useState(true);
  // Edge hyp labels: the delta a goal gained (default), or its full context
  // ("all hyps"), so contexts read additively down the tree.
  // Context verbosity, cycled by the rail (see HYP_MODES): `used` shows only
  // what the consuming tactic mentions, `delta` what the goal gained (plus
  // anything used), `full` the whole context.
  const [hypMode, setHypMode] = useState<HypMode>("delta");
  // Layout mode: the compact trunk outline (default — every node gets its own
  // vertical slot, branches indent off a left trunk, read by scrolling), or
  // the wide Sugiyama tree (same-depth nodes share a band).
  const [compact, setCompact] = useState(true);
  // Outline mode: drop the node fills and let the borders carry the type.
  // Purely a paint change — the palette swaps three CSS variables off the root
  // attribute below (theme.ts), so no geometry is touched and nothing relayouts.
  const [outline, setOutline] = useState(false);
  // Reflow: wrap labels at a much narrower column with bracket-depth indents,
  // trading height for width so sibling branches fit across the viewport.
  // Unlike `outline` this is GEOMETRY — it rebuilds the engine (below) rather
  // than just repainting.
  const [reflow, setReflow] = useState(false);
  // Side-by-side branches (compact mode): a branching tactic's subtrees lay
  // out as columns sharing one vertical span instead of stacking down the
  // page. A computeLayout parameter, not an engine rebuild: geometry per
  // node is unchanged, only placement moves.
  const [sideBySide, setSideBySide] = useState(false);
  // Zoom factor applied to the whole SVG (1 = 100%). Lets you fit a wide/tall
  // tree into the slice and zoom back into a region.
  const [zoom, setZoom] = useState(1);
  // Sequence ("linearize") mode. `off` is the normal branching tree. `pick` is
  // selecting two endpoints (first click sets `from`); `view` renders only the
  // path between them — a single chain of goals/tactics with no branching.
  const [seq, setSeq] = useState<Seq>({ mode: "off" });
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
  } | null>(null);
  // Commit goes through the editor's own edit pipeline (undoable there); a
  // no-op edit just closes the box. The ref mirrors `editing` and is nulled
  // SYNCHRONOUSLY on commit: committing via Enter unmounts the textarea,
  // whose blur then calls commitEdit again from the same render's (stale)
  // closure — without the ref that would apply the edit twice.
  const editingRef = useRef(editing);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  const commitEdit = () => {
    const cur = editingRef.current;
    editingRef.current = null;
    if (!cur) return;
    if (cur.add) {
      if (cur.value.trim() !== "") onAddTactic?.(cur.add, cur.value);
    } else if (cur.value !== cur.original) {
      onEditTactic?.(cur.pos, cur.value);
    }
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
  useEffect(() => {
    const sync = () => {
      setCodeFont(refreshCodeFontFamily());
      setThemeKind(resolveThemeKind());
    };
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    // VS Code stamps the theme KIND on the body as a class/attribute; a switch
    // between two themes of the same kind only moves the variables above, but
    // a light↔dark switch can land here first.
    if (document.body)
      obs.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "data-vscode-theme-kind"],
      });
    return () => obs.disconnect();
  }, []);

  // One layout engine per (proof, hyp-label mode, code font); rebuilding it is
  // how the data swaps. Keep the proof reference stable across cursor moves
  // (widget) so the fold/zoom reset below only fires on an actual proof
  // change, not on every re-highlight.
  const engine = useMemo(
    // `codeFont` isn't read here, but the engine measures every label in it
    // via layout.ts module state — the dep is what forces a re-measure when
    // the editor font changes (hence the lint suppression: the dependency is
    // real, just invisible to the linter).
    () => createLayoutEngine(proofToTree(proof, { hypMode }), { reflow }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proof, hypMode, codeFont, reflow],
  );

  // Two different events, and conflating them is what made editing painful.
  //
  // `proofKey` is the proof's IDENTITY: its root goal's mvarId. Measured
  // across re-elaborations, that survives edits to the proof BODY (adding a
  // tactic keeps every existing id and appends one; deleting keeps the root
  // and 8 of 12 downstream; both keep the root) and differs for a different
  // theorem. A change here is a genuinely new proof, so reset everything and
  // re-center.
  //
  // `shapeKey` is the node set. It changes on any structural edit, and used to
  // drive the reset — so adding a tactic or deleting one threw away fold,
  // zoom and focus and scrolled back to the root, which is exactly where you
  // are NOT working. Now a same-proof shape change only PRUNES state that no
  // longer refers to anything; scroll and zoom stay put.
  //
  // Both are derived state, adjusted during render rather than in an effect
  // (avoids a cascading re-render).
  const proofKey = useMemo(() => rootIds(proof).join("\n"), [proof]);
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
    // The source moved under the edit box (usually OUR own committed edit
    // coming back), so its ranges are stale either way.
    setEditing(null);
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

  const { nodes, links, extent } = useMemo(
    () =>
      engine.computeLayout(collapsed, only, focusSet, compact, sideBySide),
    [engine, collapsed, only, focusSet, compact, sideBySide],
  );

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
  const cursorTargets = useMemo(
    () =>
      nodes
        .map((n) => n.data)
        .filter((d) => d.type === "tactic" && d.position)
        .map((d) => ({ id: d.id, position: d.position! })),
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

  // Capture a re-anchor on node `id` (or the root) before a relayout, so the
  // post-render `[nodes]` effect can hold that node fixed on screen. `sx/sy` are
  // the TRUE pre-relayout scroll, captured before the browser can clamp them
  // when the SVG resizes.
  const anchorOn = (id: string) => {
    const cur = nodes.find((n) => n.data.id === id);
    const el = scrollRef.current;
    if (cur && el)
      anchorRef.current = { id, x: cur.x, y: cur.y, sx: el.scrollLeft, sy: el.scrollTop };
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

  // A node click means different things per mode: fold/unfold in the tree, or
  // pick a sequence endpoint. Picking the second endpoint orders the pair by
  // ancestry (whichever is the ancestor becomes the chain's top); two unrelated
  // nodes can't form a path, so we just restart the selection from the latest.
  const onNodeClick = (id: string, foldable: boolean) => {
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

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const el = scrollRef.current;
    if (!anchor || !el) return;

    const now = nodes.find((n) => n.data.id === anchor.id);
    if (now) {
      // Target = old scroll + how far the node moved in content space. We use the
      // captured anchor.sx (not el.scrollLeft, which may already be clamped) so the
      // base is correct. Then clamp to the NEW scrollable range ourselves.
      const maxX = el.scrollWidth - el.clientWidth;
      const maxY = el.scrollHeight - el.clientHeight;
      el.scrollLeft = clampScroll(anchor.sx + (now.x - anchor.x) * zoom, maxX);
      el.scrollTop = clampScroll(anchor.sy + (now.y - anchor.y) * zoom, maxY);
    }

    anchorRef.current = null; // consume it so unrelated re-renders don't re-shift
    // Intentionally re-runs only on relayout (`nodes`), reading the current `zoom`;
    // zoom changes are handled by their own effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  // The current view: the full tree, a focused subtree, or one linearized
  // path — in either layout mode. Re-centering keys off this, so entering/
  // leaving a focus or sequence (or switching layout mode, which repositions
  // everything) re-centers on that view's top node.
  const viewKey =
    (compact ? "compact:" : "wide:") +
    (reflow ? "reflow:" : "") +
    (compact && sideBySide ? "cols:" : "") +
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

  // source→tree tracking: the accented node follows the editor cursor
  // (highlightPos → cursorNodeId); keep it IN VIEW so moving through the
  // proof in an editor (the lens especially) walks the tree along with you.
  // Only fires when the cursor lands on a DIFFERENT node (scroll/zoom/fold
  // alone never yank the view), and only scrolls when the node is outside a
  // comfortable band of the viewport — then centers it smoothly.
  const trackedCursorNode = useRef<string | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !cursorNodeId || hlDismissed) return;
    if (trackedCursorNode.current === cursorNodeId) return;
    const node = nodes.find((n) => n.data.id === cursorNodeId);
    if (!node) return; // hidden by folding/focus — don't fight the user
    // Marked tracked only once actually FOUND: a node hidden at cursor-move
    // time still gets tracked when unfolding later reveals it.
    trackedCursorNode.current = cursorNodeId;
    const cx = (MARGIN.left + PAD_X + node.x) * zoom;
    const cy = (MARGIN.top + PAD_Y + node.y) * zoom;
    const halfW = (node.data.w / 2) * zoom;
    const bandH = node.data.h + node.data.commentBlockH;
    const halfH = (bandH / 2) * zoom;
    const pad = 32;
    const maxX = el.scrollWidth - el.clientWidth;
    const maxY = el.scrollHeight - el.clientHeight;
    let left = el.scrollLeft;
    let top = el.scrollTop;
    // Vertical is the reading axis (both modes): center the node when it
    // strays outside the comfortable band.
    if (cy - halfH < el.scrollTop + pad || cy + halfH > el.scrollTop + el.clientHeight - pad)
      top = clampScroll(cy - el.clientHeight / 2, maxY);
    if (compact) {
      // Left-aligned trunk: never center horizontally (that pulls the trunk
      // off screen). Only when a node spills past the RIGHT edge, nudge just
      // enough to bring its left edge to the trunk inset — eyeballed, no
      // exact centering.
      if (cx + halfW > el.scrollLeft + el.clientWidth - pad)
        left = clampScroll(cx - halfW - COMPACT_LEFT * zoom, maxX);
    } else if (
      cx - halfW < el.scrollLeft + pad ||
      cx + halfW > el.scrollLeft + el.clientWidth - pad
    ) {
      left = clampScroll(cx - el.clientWidth / 2, maxX);
    }
    if (left === el.scrollLeft && top === el.scrollTop) return;
    el.scrollTo({ left, top, behavior: "smooth" });
  }, [cursorNodeId, hlDismissed, nodes, zoom, PAD_X, PAD_Y, compact]);

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
      style={{ position: "relative", width: "100%", height, overflow: "hidden" }}
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
      {seq.mode !== "off" && (
        <div
          style={{
            position: "absolute",
            top: headerExtra ? 44 : 8,
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
        compact={compact}
        onCompactChange={setCompact}
        outline={outline}
        onOutlineChange={setOutline}
        sideBySide={sideBySide}
        onSideBySideChange={(v) => {
          anchorRoot();
          setSideBySide(v);
        }}
        reflow={reflow}
        onReflowChange={(v) => {
          // Every box is re-measured, so hold the root steady like the other
          // geometry toggles do.
          anchorRoot();
          setReflow(v);
        }}
        hypMode={hypMode}
        onHypModeChange={(v) => {
          // Every layer's hyp label resizes, so hold the root fixed on screen
          // (same treatment as expand/collapse-all).
          anchorRoot();
          setHypMode(v);
        }}
        focused={focusId !== null}
        onExitFocus={() => setFocusId(null)}
        seqActive={seq.mode !== "off"}
        onToggleSequence={() =>
          setSeq((s) =>
            s.mode === "off" ? { mode: "pick", from: null } : { mode: "off" },
          )
        }
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
        onClick={() => setHlDismissed(true)}
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
            {nodes.map((node) => {
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
                (seq.mode === "view" && (seq.from === id || seq.to === id));
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
              const editable =
                seq.mode === "off" &&
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
              // hides; an ADD's overlay hangs below it and the goal must stay
              // readable while you answer it.
              const hideForEdit = isEditing && !editing?.add;
              // A goal with descendants can become the root of a focused view
              // (⌥-click, or the hover bar's ◎); pointless for the current
              // focus root.
              const focusable =
                type === "goal" && foldable && !seqActive && id !== focusId;
              // Secondary actions live in a hover bar with button-sized
              // targets (see NodeActionBar) instead of tiny corner glyphs or
              // modifier gestures: goals get reveal/focus, tactics the lens.
              const hasBar =
                !isEditing && (goalRevealable || focusable || popoutable);
              // Hovering a positioned tactic lights its range up in the editor.
              const hoverHighlights =
                type === "tactic" && !!position && !!onHoverTactic;
              const clickable =
                seqActive || foldable || revealable || goalRevealable;
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
                hyps?.some((l) => l.used)
                  ? `${HYP_MARK} = used by the tactic below`
                  : null,
              ].filter(Boolean);
              const nodeTooltip = hints.map((h) => `· ${h}`).join("\n");
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
                    ) ?? null)
                  : position
                    ? (renderTaggedTactic?.(
                        position,
                        node.data.label,
                        lines.map((l) => l.text),
                      ) ?? null)
                    : null;

              const handleClick = (e: ReactMouseEvent<SVGGElement>) => {
                // A node click is an interaction, not a background click — it
                // must not dismiss the cursor accent (see the scroll div).
                e.stopPropagation();
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
                onNodeClick(id, foldable);
              };

              return (
                <g
                  key={id}
                  transform={`translate(${node.x},${node.y})`}
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
                  // Hover drives two things: the action bar, and (tactics
                  // only) the editor-side range highlight.
                  onMouseEnter={
                    hasBar || hoverHighlights
                      ? () => {
                          if (hasBar) setHoverId(id);
                          if (hoverHighlights) onHoverTactic!(position!);
                        }
                      : undefined
                  }
                  onMouseLeave={
                    hasBar || hoverHighlights
                      ? () => {
                          if (hasBar) setHoverId((cur) => (cur === id ? null : cur));
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
                  {!taggedLines && hints.length > 0 && (
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
                    rx={type === "tactic" ? 4 : 6}
                    stroke={accent ? SEQ_STROKE : style.stroke}
                    strokeWidth={accent ? 2 : 1.5}
                    fill={style.fill}
                    // While the in-place editor overlays this node, its box
                    // (and label, below) hide — the overlay is bigger than
                    // the box, and an accented node would clash through it.
                    visibility={hideForEdit ? "hidden" : undefined}
                  >
                    {taggedLines && hints.length > 0 && (
                      <title>{nodeTooltip}</title>
                    )}
                  </rect>

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

                  {foldable && !seqActive && !revealable && !hideForEdit && (
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
                      fill={NODE_TEXT}
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
                      that modifiers on tree nodes silently stop working. */}
                  {type === "goal" &&
                    node.data.addSpec &&
                    onAddTactic &&
                    seq.mode === "off" &&
                    !isEditing && (
                      <g
                        transform={`translate(${-w / 2 + TRUNK_INSET}, ${
                          boxTop + h + 4
                        })`}
                      >
                        <FrontierChip
                          glyph="+"
                          title="add a tactic for this goal"
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
                          onPick={() => onAddTactic(node.data.addSpec!, "sorry")}
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
                  {hasBar && hoverId === id && (
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
                      ]}
                    />
                  )}
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
            {editing &&
              (() => {
                const en = nodes.find((n) => n.data.id === editing.id);
                if (!en) return null;
                const { w, h } = en.data;
                const topH = en.data.caseH + en.data.commentBlockH;
                const boxTop = (topH - h) / 2;
                // An ADD's textarea hangs below the goal box (where its chip
                // sat), leaving the goal readable while you answer it; a
                // replace-edit covers the hidden box as before.
                const overlayY = editing.add ? boxTop + h + 4 : boxTop;
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
                const openLines = editing.add
                  ? 1
                  : editing.original.split("\n").length;
                const fh = openLines * LINE_H + 2 * NODE_PAD_Y;
                return (
                  <g transform={`translate(${en.x},${en.y})`}>
                    <foreignObject
                      x={-w / 2}
                      y={overlayY}
                      width={fw}
                      height={fh}
                      style={{ overflow: "visible" }}
                    >
                      <textarea
                        autoFocus
                        value={editing.value}
                        spellCheck={false}
                        onChange={(e) =>
                          setEditing(
                            (cur) => cur && { ...cur, value: e.target.value },
                          )
                        }
                        onClick={(e) => e.stopPropagation()}
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
                                void clipboardFallback(k, ta);
                            }, 0);
                            return;
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
                        onBlur={commitEdit}
                        style={{
                          width: "100%",
                          height: "100%",
                          boxSizing: "border-box",
                          fontFamily: getCodeFontFamily(),
                          fontSize: NODE_FONT_PX,
                          lineHeight: `${LINE_H}px`,
                          letterSpacing: 0,
                          padding: `${NODE_PAD_Y - 1}px ${NODE_PAD - 2}px`,
                          background: EDIT_BG,
                          color: EDIT_TEXT,
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

function RailButton({
  glyph,
  title,
  onClick,
  pressed,
  pressedColor,
}: {
  glyph: string;
  title: string;
  onClick: () => void;
  pressed?: boolean;
  pressedColor?: string;
}) {
  const color = pressedColor ?? RAIL_PRESSED;
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={
        pressed
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

function ControlRail({
  onExpandAll,
  onCollapseAll,
  accordion,
  onAccordionChange,
  compact,
  onCompactChange,
  outline,
  onOutlineChange,
  sideBySide,
  onSideBySideChange,
  reflow,
  onReflowChange,
  hypMode,
  onHypModeChange,
  focused,
  onExitFocus,
  seqActive,
  onToggleSequence,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  onExpandAll: () => void;
  onCollapseAll: () => void;
  accordion: boolean;
  onAccordionChange: (v: boolean) => void;
  compact: boolean;
  onCompactChange: (v: boolean) => void;
  outline: boolean;
  onOutlineChange: (v: boolean) => void;
  sideBySide: boolean;
  onSideBySideChange: (v: boolean) => void;
  reflow: boolean;
  onReflowChange: (v: boolean) => void;
  hypMode: HypMode;
  onHypModeChange: (v: HypMode) => void;
  focused: boolean;
  onExitFocus: () => void;
  seqActive: boolean;
  onToggleSequence: () => void;
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
      <RailButton glyph="⊞" title="Expand all" onClick={onExpandAll} />
      <RailButton glyph="⊟" title="Collapse all" onClick={onCollapseAll} />
      <div style={{ height: 6 }} />
      <RailButton
        glyph="⇅"
        title="Accordion: expanding a node collapses its sibling branches"
        pressed={accordion}
        onClick={() => onAccordionChange(!accordion)}
      />
      <RailButton
        glyph="≡"
        title="Compact outline layout — every node on its own line, branches indent off a left trunk (off: the wide layered tree)"
        pressed={compact}
        onClick={() => onCompactChange(!compact)}
      />
      <RailButton
        glyph="◫"
        title="Side-by-side branches: goals spawned by one tactic lay out as columns (compact mode; pairs well with ¶ reflow)"
        pressed={sideBySide}
        onClick={() => onSideBySideChange(!sideBySide)}
      />
      <RailButton
        glyph="¶"
        title="Reflow: wrap labels at a narrow column (breaking at commas, connectives, := and tactic keywords) so branches fit side by side"
        pressed={reflow}
        onClick={() => onReflowChange(!reflow)}
      />
      <RailButton
        glyph="□"
        title="Outline only — drop the node fills, keep the borders"
        pressed={outline}
        onClick={() => onOutlineChange(!outline)}
      />
      <RailButton
        glyph={HYP_MODES[hypMode].glyph}
        title={HYP_MODES[hypMode].title}
        // Pressed whenever the context is NOT the default breadth, so the rail
        // shows at a glance that something is being filtered or expanded.
        pressed={hypMode !== "delta"}
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
      {focused && (
        <RailButton
          glyph="◎"
          title="Back to the whole proof (◎ on a goal node focuses its subtree)"
          pressed
          pressedColor={NODE_STYLES.goal.stroke}
          onClick={onExitFocus}
        />
      )}
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
function FrontierChip({
  glyph,
  title,
  x,
  width,
  color,
  fontSize = 12,
  onPick,
}: {
  glyph: string;
  title: string;
  x: number;
  width: number;
  color: string;
  fontSize?: number;
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
        fontFamily="monospace"
        fill={color}
        style={{ userSelect: "none" }}
      >
        {glyph}
      </text>
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
              fill="var(--vscode-icon-foreground, #2d3748)"
            >
              {a.glyph}
            </text>
          </g>
        );
      })}
    </g>
  );
}
