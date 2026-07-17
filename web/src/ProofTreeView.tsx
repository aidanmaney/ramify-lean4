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
  hypSize,
  HYP_FONT_PX,
  HYP_GAP,
  HYP_LINE_H,
  HYP_MARK_W,
  HYP_PAD,
  LINE_H,
  NODE_FONT_PX,
  NODE_PAD,
  NODE_PAD_Y,
  ARROW_GAP,
  TRUNK_INSET,
  CONT_INDENT,
  COMMENT_FONT_PX,
  COMMENT_LINE_H,
  COMMENT_INDENT,
  getCodeFontFamily,
  refreshCodeFontFamily,
} from "./layout";
import type { Proof, ProofStepPosition } from "./paperproof";
import type { EdgeHyps } from "./types";
import { proofToTree } from "./proofToTree";

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
// Goals cool blue, tactics warm green — both several steps more saturated than
// the old near-white pastels so the two node kinds read apart at a glance (the
// yellow hyp labels and the orange accent stay distinct from both).
const NODE_STYLES = {
  goal: { fill: "#dbeafe", stroke: "#1d6fd8" },
  tactic: { fill: "#d3f8df", stroke: "#15803d" },
  default: { fill: "#fff", stroke: "#999" },
};
// Accent outline for the chosen sequence endpoints, and for the tactic node the
// editor cursor is currently inside (the source→tree half of the link).
const SEQ_STROKE = "#dd6b20";

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 2;
const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
// Clamp a scroll offset into [0, max]; used everywhere an effect restores scroll.
const clampScroll = (v: number, max: number) => Math.max(0, Math.min(max, v));

// (line, character) ordering: is `a` at or before `b` in the source?
function beforeOrEq(
  a: { line: number; character: number },
  b: { line: number; character: number },
): boolean {
  return a.line < b.line || (a.line === b.line && a.character <= b.character);
}

// Does a tactic's source span contain the given cursor position (inclusive)?
function positionContains(
  range: ProofStepPosition,
  p: { line: number; character: number },
): boolean {
  return beforeOrEq(range.start, p) && beforeOrEq(p, range.stop);
}

// Colors of the context label's lines: hyps the tactic below actually uses
// keep the full-strength ink (plus a marker in the gutter); the rest recede.
const HYP_USED_FILL = "#7a6000";
const HYP_UNUSED_FILL = "#a89557";
const HYP_MARK_FILL = "#c05621";
const HYP_MARK = "▸";

// A small context box centered at (x, y), listing the hypotheses in scope for
// the tactic drawn below it — the ones the tactic uses are marked with a
// gutter `▸` and full-strength ink. Box geometry comes from the shared hypSize
// so it matches the room the layout folded into the tactic's band.
// `onClick` wires the widget's tree→source link for the tactic that
// introduced these hypotheses (see the links loop below); the label takes no
// cursor accent — its span is the producing tactic's, so an accent here would
// only duplicate that node's (see cursorNodeId).
// `taggedLines` (widget only) swaps individual lines for interactive content
// with hover type tooltips; null entries keep the plain text for that line.
function HypLabel({
  x,
  y,
  hyps,
  onClick,
  taggedLines,
}: {
  x: number;
  y: number;
  hyps: EdgeHyps;
  onClick?: () => void;
  taggedLines?: (ReactNode | null)[] | null;
}) {
  const lines = hyps.lines;
  const { w, h } = hypSize(hyps);
  const anyUsed = lines.some((l) => l.used);
  // Marker gutter (reserved by hypSize only when something is marked), and the
  // left edge text starts at.
  const gutterX = -w / 2 + HYP_PAD;
  const textX = gutterX + (anyUsed ? HYP_MARK_W : 0);
  // Dim only as contrast: when nothing is marked, everything keeps full ink.
  const lineFill = (used: boolean) =>
    anyUsed && !used ? HYP_UNUSED_FILL : HYP_USED_FILL;
  // Native hover tooltip: the full hyp text (markers inlined), plus a legend
  // and a reveal hint when this label is clickable. With tagged content it
  // moves onto the box rect only (padding/border), so it doesn't stack on the
  // interactive type tooltips the HTML lines pop on hover.
  const titleText =
    lines.map((l) => (l.used ? `${HYP_MARK} ${l.text}` : l.text)).join("\n") +
    (anyUsed ? `\n\n${HYP_MARK} = used by this tactic` : "");
  const tooltip = onClick
    ? `${titleText}\n· click to reveal in source`
    : titleText;

  return (
    <g
      transform={`translate(${x},${y})`}
      onClick={
        onClick
          ? (e) => {
              // Interaction, not a background click (see the scroll div).
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      {!taggedLines && <title>{tooltip}</title>}
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={4}
        fill="#fffbe6"
        stroke="#d6b656"
        strokeWidth={1}
      >
        {taggedLines && <title>{tooltip}</title>}
      </rect>
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
            line.used ? (
              <tspan
                key={j}
                x={gutterX}
                y={(j - (lines.length - 1) / 2) * HYP_LINE_H}
                dy="0.32em"
              >
                {HYP_MARK}
              </tspan>
            ) : null,
          )}
        </text>
      )}
      {taggedLines ? (
        // HTML overlay in the exact geometry the tspans below would use: the
        // padded content area, one fixed-height line box per label line. The
        // text is identical to the measured plain lines (taggedRender.tsx
        // guarantees it), so nothing wraps — hence white-space: pre.
        <foreignObject
          x={textX}
          y={-h / 2 + HYP_PAD}
          width={w - HYP_PAD - (textX + w / 2)}
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
                style={{ height: HYP_LINE_H, color: lineFill(line.used) }}
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
              x={textX}
              y={(j - (lines.length - 1) / 2) * HYP_LINE_H}
              dy="0.32em"
              fill={lineFill(line.used)}
            >
              {line.text}
            </tspan>
          ))}
        </text>
      )}
    </g>
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
   * Widget-only, same idea for a tactic's context label: `goalId` is the goal
   * whose local context the lines come from (the tactic's goalBefore — see
   * types.ts EdgeHyps). Null entries in the returned array keep that line
   * plain; null overall keeps the whole label plain.
   */
  renderTaggedHyps?: (
    goalId: string,
    lines: string[],
  ) => (ReactNode | null)[] | null;
}

export default function ProofTreeView({
  proof,
  onReveal,
  getTacticEdit,
  onEditTactic,
  highlightPos,
  headerExtra,
  height = "100vh",
  renderTaggedGoal,
  renderTaggedHyps,
}: ProofTreeViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Accordion: expanding a node collapses its sibling branches, so only one
  // branch is open per level (the "view one branch at a time" mode).
  const [accordion, setAccordion] = useState(true);
  // Edge hyp labels: the delta a goal gained (default), or its full context
  // ("all hyps"), so contexts read additively down the tree.
  const [fullHyps, setFullHyps] = useState(false);
  // Layout mode: the compact trunk outline (default — every node gets its own
  // vertical slot, branches indent off a left trunk, read by scrolling), or
  // the wide Sugiyama tree (same-depth nodes share a band).
  const [compact, setCompact] = useState(true);
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
    if (cur.value !== cur.original) onEditTactic?.(cur.pos, cur.value);
    setEditing(null);
  };

  // The proof + view we've already centered on; lets the init effect re-center
  // once per loaded proof (and once per sequence switch) without writing a ref
  // during render. Keyed on the PROOF, not the engine: the engine also rebuilds
  // on a hyp-label mode toggle, which re-anchors on the root instead of
  // re-centering. One ref: the pair is only ever written and compared together.
  const centeredOn = useRef<{ shapeKey: string; viewKey: string } | null>(
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
  const [codeFont, setCodeFont] = useState(getCodeFontFamily);
  useEffect(() => {
    const obs = new MutationObserver(() => setCodeFont(refreshCodeFontFamily()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
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
    () => createLayoutEngine(proofToTree(proof, { fullHyps })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proof, fullHyps, codeFont],
  );

  // When a new proof loads, reset to "everything collapsed" and re-center.
  // Keyed on the proof's SHAPE (its node ids), NOT the proof object or the
  // engine: a hyp-label mode toggle rebuilds the engine, and editing a
  // comment or a tactic's text yields a new proof object — but node ids are
  // unchanged in all three, so fold/zoom/sequence state stays valid and
  // should survive (matters in the widget, where the proof re-arrives on
  // every re-elaboration while the user types). This is derived state, so we
  // adjust it during render on change rather than in an effect (avoids a
  // cascading re-render).
  const shapeKey = useMemo(
    () => proof.steps.map((s) => s.goalBefore.id).join("\n"),
    [proof],
  );
  const [prevShape, setPrevShape] = useState(shapeKey);
  if (shapeKey !== prevShape) {
    setPrevShape(shapeKey);
    setCollapsed(engine.foldableIds());
    setZoom(1);
    setSeq({ mode: "off" });
    setFocusId(null);
    // A shape change means the source changed under the edit box (usually
    // OUR own committed edit coming back); stale ranges must not be applied.
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
    () => engine.computeLayout(collapsed, only, focusSet, compact),
    [engine, collapsed, only, focusSet, compact],
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
  const cursorNodeId = useMemo(() => {
    if (hlKey === "" || hlDismissed || !highlightPos) return null;
    const span = (p: ProofStepPosition) =>
      (p.stop.line - p.start.line) * 1e4 +
      (p.stop.character - p.start.character);
    let best: { id: string; s: number } | null = null;
    for (const n of nodes) {
      const d = n.data;
      if (d.type !== "tactic" || !d.position) continue;
      if (!positionContains(d.position, highlightPos)) continue;
      const s = span(d.position);
      if (!best || s < best.s) best = { id: d.id, s };
    }
    return best?.id ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, hlKey, hlDismissed]);

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
      (centeredOn.current?.shapeKey === shapeKey &&
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
        ? PAD_X * zoom
        : (MARGIN.left + PAD_X + root.x) * zoom - viewport.w / 2,
      maxX,
    );
    el.scrollTop = clampScroll(
      (MARGIN.top +
        PAD_Y +
        root.y -
        (root.data.h + root.data.hypBlockH + root.data.commentBlockH) / 2) *
        zoom -
        MARGIN.top,
      maxY,
    );
    centeredOn.current = { shapeKey, viewKey };
  }, [viewport, nodes, shapeKey, viewKey, zoom, PAD_X, PAD_Y, compact]);

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
  // node's extent includes its context label: the band (hypBlockH + h)
  // vertically, and the label box when it's wider than the node box.
  const fitWidth = () => {
    const el = scrollRef.current;
    // clientWidth is 0 while the view is hidden/unmeasured — fitting then
    // would just clamp zoom to the minimum.
    if (!el || el.clientWidth === 0 || nodes.length === 0) return;
    // A node's horizontal extent includes its context label and comment
    // strip. Wide mode centers them on n.x; compact left-aligns them at the
    // box's left edge — except parented nodes' comment strips, which hang
    // indented off the incoming lane (COMMENT_INDENT) — so the widest
    // extends right from there.
    const effW = (n: (typeof nodes)[number]) =>
      Math.max(
        n.data.w,
        hypSize(n.data.incHyp).w,
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
        (n) => n.y - (n.data.h + n.data.hypBlockH + n.data.commentBlockH) / 2,
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
    <div style={{ position: "relative", width: "100%", height, overflow: "hidden" }}>
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
            color: "#fff",
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
        fullHyps={fullHyps}
        onFullHypsChange={(v) => {
          // Every layer's hyp label resizes, so hold the root fixed on screen
          // (same treatment as expand/collapse-all).
          anchorRoot();
          setFullHyps(v);
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
            color: "#666",
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
          height: 44,
          zIndex: 9,
          pointerEvents: "none",
          background:
            "linear-gradient(to bottom, var(--vscode-editor-background, var(--bg, #fff)) 40%, transparent)",
        }}
      />
      <div
        ref={scrollRef}
        className="no-scrollbar"
        style={{
          width: "100%",
          height: "100%",
          overflow: "auto",
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
              // A node's band is commentBlockH (comment strip) + hypBlockH
              // (context label) + h (box), box at the bottom: edges leave a
              // box's bottom edge and land above the target's whole band —
              // reading order goal → comment → context → tactic.
              const startY =
                link.source.y +
                (link.source.data.h +
                  link.source.data.hypBlockH +
                  link.source.data.commentBlockH) /
                  2;
              const bandTop =
                link.target.y -
                (link.target.data.h +
                  link.target.data.hypBlockH +
                  link.target.data.commentBlockH) /
                  2;
              // The comment strip is narrative, not dataflow: labels and
              // landing points sit below it.
              const contentTop = bandTop + link.target.data.commentBlockH;
              const endY = bandTop - ARROW_GAP; // line ends just above the band

              const hyps = link.data; // the tactic's input context, if labeled
              const hypPos = hyps?.pos;

              const sLeft = link.source.x - link.source.data.w / 2;
              const tLeft = link.target.x - link.target.data.w / 2;
              let d: string;
              let labelX: number;
              if (compact) {
                // Orthogonal connector dropped from a column just inside the
                // parent box's left edge: straight down into a same-indent
                // (trunk) child, or │└▶ into an indented branch — landing at
                // the vertical middle of the first thing in the child's band
                // (its context label if any, else its box).
                const col = sLeft + TRUNK_INSET;
                if (Math.abs(tLeft - sLeft) < 0.5) {
                  // Straight trunk lane: run CONTINUOUSLY past the comment
                  // strip (which hangs indented to the lane's right — see the
                  // strip render) down to the node's content proper.
                  d = `M${col},${startY} L${col},${contentTop - ARROW_GAP}`;
                } else {
                  const landY =
                    contentTop +
                    (hyps ? hypSize(hyps).h / 2 : link.target.data.h / 2);
                  d = `M${col},${startY} L${col},${landY} L${tLeft - ARROW_GAP},${landY}`;
                }
                labelX = hyps ? tLeft + hypSize(hyps).w / 2 : link.target.x;
              } else {
                const startX = link.source.x;
                const endX = link.target.x;
                const k = (endY - startY) * 0.7;
                d = `M${startX},${startY}
                    C${startX},${(startY + endY) / 2}
                     ${endX},${endY - k}
                     ${endX},${endY}`;
                labelX = endX;
              }

              return (
                <g key={i}>
                  <path fill="none" stroke="#555" strokeWidth={1.5} d={d} />
                  {hyps && (
                    <HypLabel
                      x={labelX}
                      // At the top of the target's content (below any comment
                      // strip); the box sits below it.
                      y={contentTop + hypSize(hyps).h / 2}
                      hyps={hyps}
                      onClick={
                        onReveal && hypPos ? () => onReveal(hypPos) : undefined
                      }
                      taggedLines={
                        renderTaggedHyps?.(
                          hyps.goalId,
                          hyps.lines.map((l) => l.text),
                        ) ?? null
                      }
                    />
                  )}
                </g>
              );
            })}
            {nodes.map((node) => {
              const { w, h, lines, label, type, id, foldable, position } = node.data;
              // The node's band is commentBlockH + hypBlockH + h with the box
              // pinned at the bottom (the comment strip tops the band, the
              // context label — drawn by the links loop — sits between them).
              // All box geometry hangs off boxTop / boxCy.
              const topH = node.data.hypBlockH + node.data.commentBlockH;
              const boxTop = (topH - h) / 2;
              const boxCy = topH / 2;
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
              const isEditing = editing?.id === id;
              // A goal with descendants can become the root of a focused view
              // (⌥-click, or the hover bar's ◎); pointless for the current
              // focus root.
              const focusable =
                type === "goal" && foldable && !seqActive && id !== focusId;
              // Goal secondary actions live in a hover bar with button-sized
              // targets (see NodeActionBar) instead of tiny corner glyphs.
              const hasBar = goalRevealable || focusable;
              const clickable =
                seqActive || foldable || revealable || goalRevealable;
              // Native hover tooltip: the full (un-wrapped) label — useful even
              // though the box already shows it, since long types get pixel-
              // wrapped across lines — plus hints on the fast-path gestures the
              // hover bar's button titles also teach.
              const hints = [
                revealable
                  ? "· click to reveal in source"
                  : goalRevealable
                    ? `· ${CMD}-click to reveal in source`
                    : null,
                editable ? "· double-click to edit" : null,
                focusable ? "· ⌥-click to focus this subtree" : null,
              ].filter(Boolean);
              const nodeTooltip =
                hints.length > 0 ? `${label}\n\n${hints.join("\n")}` : label;
              // Widget-only interactive label (hover type tooltips) for goal
              // nodes; null keeps the plain SVG text (always, for tactics).
              const taggedLines =
                type === "goal" && renderTaggedGoal
                  ? renderTaggedGoal(
                      id,
                      lines.map((l) => l.text),
                    )
                  : null;

              const handleClick = (e: ReactMouseEvent<SVGGElement>) => {
                // A node click is an interaction, not a background click — it
                // must not dismiss the cursor accent (see the scroll div).
                e.stopPropagation();
                // In the widget, clicking a positioned tactic reveals its source
                // rather than folding; fold via goal nodes / the sequence tools.
                if (revealable) {
                  onReveal!(position!);
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
                          const q = getTacticEdit!(position!);
                          if (q)
                            setEditing({
                              id,
                              pos: q.pos,
                              original: q.text,
                              value: q.text,
                            });
                        }
                      : undefined
                  }
                  onMouseEnter={hasBar ? () => setHoverId(id) : undefined}
                  onMouseLeave={
                    hasBar
                      ? () => setHoverId((cur) => (cur === id ? null : cur))
                      : undefined
                  }
                  style={{
                    cursor: clickable && !isEditing ? "pointer" : "default",
                  }}
                >
                  {/* With a tagged label, the native tooltip retreats to the box
                      rect (padding/border) so it doesn't stack on the hover
                      type-tooltips the interactive text pops itself. */}
                  {!taggedLines && <title>{nodeTooltip}</title>}
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
                      fill="#8b949e"
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
                            (line.cont ? CONT_INDENT : 0)
                          }
                          y={
                            boxTop -
                            topH +
                            (j + 0.5) * COMMENT_LINE_H
                          }
                          dy="0.32em"
                        >
                          {line.text}
                        </tspan>
                      ))}
                    </text>
                  )}

                  {/* Context label → box connector: the label (drawn by the
                      links loop) ends HYP_GAP above the box; a short arrow
                      bridges that gap so the "context feeds into the tactic"
                      flow stays visible. Wide mode centers label over box;
                      compact left-aligns them, so the arrow sits in the
                      connector column both overlap. */}
                  {node.data.hypBlockH > 0 &&
                    (() => {
                      const cx = compact ? -w / 2 + TRUNK_INSET : 0;
                      return (
                        <path
                          fill="none"
                          stroke="#555"
                          strokeWidth={1.5}
                          d={`M${cx},${boxTop - HYP_GAP + 1} L${cx},${boxTop - ARROW_GAP}`}
                        />
                      );
                    })()}
                  <rect
                    x={-w / 2}
                    y={boxTop}
                    width={w}
                    height={h}
                    // Shape doubles the color cue: tactics get pill-ish corners,
                    // goals stay squared. Capped so multi-line tactic boxes
                    // don't curve into their first/last text lines.
                    rx={type === "tactic" ? Math.min(h / 2, 14) : 6}
                    stroke={accent ? SEQ_STROKE : style.stroke}
                    strokeWidth={accent ? 2 : 1.5}
                    fill={style.fill}
                  >
                    {taggedLines && <title>{nodeTooltip}</title>}
                  </rect>

                  {foldable && !seqActive && !revealable && (
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
                      y={boxCy - (lines.length * LINE_H) / 2}
                      width={w - 2 * NODE_PAD}
                      height={lines.length * LINE_H}
                      style={{ overflow: "visible" }}
                    >
                      <div
                        style={{
                          fontFamily: getCodeFontFamily(),
                          fontSize: NODE_FONT_PX,
                          lineHeight: `${LINE_H}px`,
                          letterSpacing: 0,
                          whiteSpace: "pre",
                          color: "#000",
                        }}
                      >
                        {taggedLines.map((line, j) => (
                          <div
                            key={j}
                            style={{
                              height: LINE_H,
                              // Hanging indent for width-wrapped continuation
                              // lines — same offset the layout budgeted.
                              paddingLeft: lines[j].cont ? CONT_INDENT : 0,
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
                      // Match the width measurer in layout.ts, which doesn't include
                      // the page's inherited letter-spacing.
                      style={{ letterSpacing: 0 }}
                    >
                      {lines.map((line, j) => (
                        <tspan
                          key={j}
                          // Continuation lines hang-indent by the same offset
                          // the layout budgeted for them.
                          x={-w / 2 + NODE_PAD + (line.cont ? CONT_INDENT : 0)}
                          y={boxCy + (j - (lines.length - 1) / 2) * LINE_H}
                          dy="0.32em"
                        >
                          {line.text}
                        </tspan>
                      ))}
                    </text>
                  )}

                  {/* In-place tactic editor: a textarea in the box's exact
                      spot (grown to a comfortable minimum), pre-filled with
                      the tactic's verbatim source (getTacticEdit). Esc
                      cancels; Enter commits single-line tactics (Shift+Enter
                      for a newline); ⌘/Ctrl-Enter always commits; so does
                      clicking away. */}
                  {isEditing && editing && (
                    <foreignObject
                      x={-w / 2}
                      y={boxTop}
                      width={Math.max(w, 320)}
                      height={Math.max(
                        h,
                        editing.value.split("\n").length * LINE_H +
                          2 * NODE_PAD_Y +
                          6,
                      )}
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
                        onKeyDown={(e) => {
                          e.stopPropagation();
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
                          background: "#fff",
                          color: "#111",
                          border: `2px solid ${NODE_STYLES.tactic.stroke}`,
                          borderRadius: 10,
                          outline: "none",
                          resize: "none",
                          whiteSpace: "pre",
                          overflow: "auto",
                        }}
                      />
                    </foreignObject>
                  )}

                  {/* Hover action bar (last, so it paints over the label): the
                      goal's secondary actions with real button targets. */}
                  {hasBar && hoverId === id && (
                    <NodeActionBar
                      right={w / 2 - 4}
                      top={boxTop}
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
                      ]}
                    />
                  )}
                </g>
              );
            })}
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
  background: "rgba(255,255,255,0.92)",
  border: "1px solid #cbd5e0",
  borderRadius: 5,
  color: "#2d3748",
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
  const color = pressedColor ?? "#4a5568";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={
        pressed
          ? { ...RAIL_BTN, background: color, borderColor: color, color: "#fff" }
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
  fullHyps,
  onFullHypsChange,
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
  fullHyps: boolean;
  onFullHypsChange: (v: boolean) => void;
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
        glyph="∀"
        title="Show each goal's full context (off: only the hypotheses its tactic introduced or uses)"
        pressed={fullHyps}
        onClick={() => onFullHypsChange(!fullHyps)}
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
  right,
  top,
  actions,
}: {
  right: number; // bar's right edge (box right, slightly inset)
  top: number; // box top edge
  actions: NodeAction[];
}) {
  const w = actions.length * BAR_BTN + (actions.length - 1) * BAR_GAP + 2 * BAR_PAD;
  const h = BAR_BTN + 2 * BAR_PAD;
  const x0 = right - w;
  const y0 = top - h + BAR_OVERLAP;
  return (
    <g>
      <rect
        x={x0}
        y={y0}
        width={w}
        height={h}
        rx={6}
        fill="#fff"
        stroke="#cbd5e0"
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
              rx={4}
              fill="#f7fafc"
              stroke="#e2e8f0"
            />
            <text
              x={bx + BAR_BTN / 2}
              y={y0 + BAR_PAD + BAR_BTN / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={13}
              fontFamily="monospace"
              fill="#2d3748"
            >
              {a.glyph}
            </text>
          </g>
        );
      })}
    </g>
  );
}
