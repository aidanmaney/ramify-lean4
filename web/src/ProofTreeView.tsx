import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useLayoutEffect,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  createLayoutEngine,
  hypSize,
  HYP_FONT_PX,
  HYP_LINE_H,
  HYP_PAD,
  LINE_H,
  NODE_FONT_PX,
  NODE_PAD,
  HYP_GAP,
  ARROW_GAP,
} from "./layout";
import type { Proof, ProofStepPosition } from "./paperproof";
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
const NODE_STYLES = {
  goal: { fill: "#eef6ff", stroke: "#2b6cb0" },
  tactic: { fill: "#f0fff4", stroke: "#2f855a" },
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

// A small context box centered at (x, y), listing its hypotheses. Box geometry
// comes from the shared hypSize so it matches the room the layout reserved.
// `onClick`/`accent` wire the widget's tree→source and source→tree link for the
// tactic that introduced these hypotheses (see the links loop below).
function HypLabel({
  x,
  y,
  text,
  onClick,
  accent,
}: {
  x: number;
  y: number;
  text: string;
  onClick?: () => void;
  accent?: boolean;
}) {
  const lines = text.split("\n");
  const { w, h } = hypSize(text);

  return (
    <g
      transform={`translate(${x},${y})`}
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      {/* Native hover tooltip: the full (un-wrapped) hyp text, plus a reveal
          hint when this label is clickable. */}
      <title>{onClick ? `${text}\n\n· click to reveal in source` : text}</title>
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={4}
        fill="#fffbe6"
        stroke={accent ? SEQ_STROKE : "#d6b656"}
        strokeWidth={accent ? 2.5 : 1}
      />
      <text
        textAnchor="start"
        fontSize={HYP_FONT_PX}
        fontFamily="monospace"
        fill="#7a6000"
        // Drop the page's inherited letter-spacing: it isn't counted by the
        // width measurer in layout.ts, so leaving it on overflows the box.
        style={{ letterSpacing: 0 }}
      >
        {lines.map((line, j) => (
          <tspan
            key={j}
            x={-w / 2 + HYP_PAD}
            y={(j - (lines.length - 1) / 2) * HYP_LINE_H}
            dy="0.32em"
          >
            {line}
          </tspan>
        ))}
      </text>
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
}

export default function ProofTreeView({
  proof,
  onReveal,
  highlightPos,
  headerExtra,
  height = "100vh",
}: ProofTreeViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Accordion: expanding a node collapses its sibling branches, so only one
  // branch is open per level (the "view one branch at a time" mode).
  const [accordion, setAccordion] = useState(true);
  // Zoom factor applied to the whole SVG (1 = 100%). Lets you fit a wide/tall
  // tree into the slice and zoom back into a region.
  const [zoom, setZoom] = useState(1);
  // Sequence ("linearize") mode. `off` is the normal branching tree. `pick` is
  // selecting two endpoints (first click sets `from`); `view` renders only the
  // path between them — a single chain of goals/tactics with no branching.
  const [seq, setSeq] = useState<Seq>({ mode: "off" });

  // The engine + view we've already centered on; lets the init effect re-center
  // once per loaded proof (and once per sequence switch) without writing a ref
  // during render. One ref: the pair is only ever written and compared together.
  const centeredOn = useRef<{ engine: unknown; viewKey: string } | null>(null);
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

  // One layout engine per proof; rebuilding it is how the data swaps. Keep the
  // proof reference stable across cursor moves (widget) so the fold/zoom reset
  // below only fires on an actual proof change, not on every re-highlight.
  const engine = useMemo(
    () => createLayoutEngine(proofToTree(proof)),
    [proof],
  );

  // When a new proof loads, reset to "everything collapsed" and re-center. This
  // is derived-from-engine state, so we adjust it during render on change rather
  // than in an effect (avoids a cascading re-render).
  const [prevEngine, setPrevEngine] = useState(engine);
  if (engine !== prevEngine) {
    setPrevEngine(engine);
    setCollapsed(engine.foldableIds());
    setZoom(1);
    setSeq({ mode: "off" });
  }

  // In `view` mode, restrict the layout to the chosen path's nodes (or null if
  // the two endpoints aren't on one ancestor→descendant line — leaves the tree
  // intact). Drives `computeLayout(only)`.
  const only = useMemo(() => {
    if (seq.mode !== "view") return null;
    const path = engine.pathBetween(seq.from, seq.to);
    return path ? new Set(path) : null;
  }, [engine, seq]);

  const { nodes, links, extent } = useMemo(
    () => engine.computeLayout(collapsed, only),
    [engine, collapsed, only],
  );

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

  // The current view: the full tree, or one linearized path. Re-centering keys
  // off this so switching into/out of a sequence re-centers on the new top node.
  const viewKey = seq.mode === "view" ? `seq:${seq.from}>${seq.to}` : "tree";

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (
      !el ||
      (centeredOn.current?.engine === engine &&
        centeredOn.current?.viewKey === viewKey) ||
      viewport.w === 0 ||
      nodes.length === 0
    )
      return;

    // Sugiyama centers the root horizontally over the WHOLE (sub)tree, so root.x
    // is generally far from 0. Center the top node: its content position in the
    // middle of the viewport horizontally, top edge just under MARGIN.top. The
    // SVG is scaled by `zoom`, so content units convert to scroll px via *zoom.
    const root = nodes.find((n) => n.data.parents.length === 0) ?? nodes[0];
    const maxX = el.scrollWidth - el.clientWidth;
    const maxY = el.scrollHeight - el.clientHeight;
    el.scrollLeft = clampScroll(
      (MARGIN.left + PAD_X + root.x) * zoom - viewport.w / 2,
      maxX,
    );
    el.scrollTop = clampScroll(
      (MARGIN.top + PAD_Y + root.y - root.data.h / 2) * zoom - MARGIN.top,
      maxY,
    );
    centeredOn.current = { engine, viewKey };
  }, [viewport, nodes, engine, viewKey, zoom, PAD_X, PAD_Y]);

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
  // scroll box width, then centre it horizontally and scroll to its top.
  const fitWidth = () => {
    const el = scrollRef.current;
    if (!el || nodes.length === 0) return;
    const minLeft = Math.min(...nodes.map((n) => n.x - n.data.w / 2));
    const maxRight = Math.max(...nodes.map((n) => n.x + n.data.w / 2));
    const topY = Math.min(...nodes.map((n) => n.y - n.data.h / 2));
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
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      px = e.clientX - rect.left;
      py = e.clientY - rect.top;
      // Re-base on the live zoom each frame so button/reset zooms aren't fought.
      if (raf === null) target = zoomRef.current;
      target = clampZoom(target * Math.exp(-e.deltaY * 0.0015));
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
      <Toolbar
        headerExtra={headerExtra}
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
        seq={seq}
        onToggleSequence={() =>
          setSeq((s) =>
            s.mode === "off" ? { mode: "pick", from: null } : { mode: "off" },
          )
        }
      />
      <ZoomControls
        zoom={zoom}
        onZoomIn={() => zoomBy(1.25)}
        onZoomOut={() => zoomBy(1 / 1.25)}
        onReset={() => zoomBy(1 / zoom)}
        onFit={fitWidth}
      />
      {nodes.length === 0 && (
        <div
          style={{
            position: "absolute",
            top: 48,
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
      <div
        ref={scrollRef}
        className="no-scrollbar"
        style={{
          width: "100%",
          height: "100%",
          overflow: "auto",
        }}
      >
        <svg
          width={svgW * zoom}
          height={svgH * zoom}
          viewBox={`0 0 ${svgW} ${svgH}`}
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="0"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#555" />
            </marker>
          </defs>

          {/* Coords originate at top-left */}
          <g transform={`translate(${MARGIN.left + PAD_X},${MARGIN.top + PAD_Y})`}>
            {links.map((link, i) => {
              const startX = link.source.x;
              const endX = link.target.x;
              const startY = link.source.y + link.source.data.h / 2; // bottom of THIS parent
              const childTop = link.target.y - link.target.data.h / 2; // top of THIS child
              const endY = childTop - ARROW_GAP; // arrowhead lands just above the node

              const k = (endY - startY) * 0.7;
              const hyps = link.data; // hypotheses introduced on this edge, if any
              // The introducing tactic is the same step that produced the child
              // goal, so its position already lives on the target node (see
              // proofToTree.ts `visitGoal`) — no separate threading needed.
              const hypPos = link.target.data.position;
              const hypAccent =
                !!highlightPos && !!hypPos && positionContains(hypPos, highlightPos);

              return (
                <g key={i}>
                  <path
                    fill="none"
                    stroke="#555"
                    strokeWidth={1.5}
                    markerEnd="url(#arrow)"
                    d={`M${startX},${startY}
                    C${startX},${(startY + endY) / 2}
                     ${endX},${endY - k}
                     ${endX},${endY}`}
                  />
                  {hyps && (
                    <HypLabel
                      x={endX}
                      // Box bottom sits HYP_GAP above the node top (not just above
                      // the arrowhead), so the context label clears the goal box.
                      y={childTop - HYP_GAP - hypSize(hyps).h / 2}
                      text={hyps}
                      onClick={
                        onReveal && hypPos ? () => onReveal(hypPos) : undefined
                      }
                      accent={hypAccent}
                    />
                  )}
                </g>
              );
            })}
            {nodes.map((node) => {
              const { w, h, lines, label, type, id, foldable, position } = node.data;
              const style = NODE_STYLES[type] ?? NODE_STYLES.default;
              const isCollapsed = collapsed.has(id);
              const seqActive = seq.mode !== "off";
              // A chosen endpoint (the pending `from` while picking, or either end
              // in `view`) gets a thick accent outline.
              const isEndpoint =
                (seq.mode === "pick" && seq.from === id) ||
                (seq.mode === "view" && (seq.from === id || seq.to === id));
              // The tactic node the editor cursor is currently inside gets the
              // same accent (source→tree half of the link).
              const isCursor =
                !!highlightPos &&
                !!position &&
                positionContains(position, highlightPos);
              const accent = isEndpoint || isCursor;
              // A positioned node can reveal its source (widget only, outside
              // sequence mode). For a tactic node the whole box reveals; goal
              // nodes are the primary fold targets, so their reveal is a small
              // corner icon instead (below) — the box stays a fold toggle.
              const canReveal = seq.mode === "off" && !!onReveal && !!position;
              const revealable = canReveal && type === "tactic";
              const iconRevealable = canReveal && type === "goal";
              const clickable = seqActive || foldable || revealable;
              // Native hover tooltip: the full (un-wrapped) label — useful even
              // though the box already shows it, since long types get pixel-
              // wrapped across lines — plus a hint on how to reveal the source,
              // since a hyp-label-style click isn't otherwise discoverable.
              const revealHint = revealable
                ? "· click to reveal in source"
                : iconRevealable
                  ? "· click » to reveal in source"
                  : null;
              const nodeTooltip = revealHint ? `${label}\n\n${revealHint}` : label;

              const handleClick = () => {
                // In the widget, clicking a positioned tactic reveals its source
                // rather than folding; fold via goal nodes / the sequence tools.
                if (revealable) {
                  onReveal!(position!);
                  return;
                }
                onNodeClick(id, foldable);
              };

              return (
                <g
                  key={id}
                  transform={`translate(${node.x},${node.y})`}
                  onClick={clickable ? handleClick : undefined}
                  style={{ cursor: clickable ? "pointer" : "default" }}
                >
                  <title>{nodeTooltip}</title>
                  <rect
                    x={-w / 2}
                    y={-h / 2}
                    width={w}
                    height={h}
                    rx={6}
                    stroke={accent ? SEQ_STROKE : style.stroke}
                    strokeWidth={accent ? 3 : 1.5}
                    fill={style.fill}
                  />

                  {foldable && !seqActive && !revealable && (
                    <text
                      x={w / 2 - 8}
                      y={-h / 2 + 12}
                      textAnchor="middle"
                      fontSize={NODE_FONT_PX}
                      fontFamily="monospace"
                      fill={style.stroke}
                    >
                      {isCollapsed ? "+" : "−"}
                    </text>
                  )}

                  {iconRevealable && (
                    <text
                      x={-w / 2 + 10}
                      y={-h / 2 + 12}
                      textAnchor="middle"
                      fontSize={NODE_FONT_PX}
                      fontFamily="monospace"
                      fill={style.stroke}
                      onClick={(e) => {
                        // Reveal, not fold: stop the click from reaching the
                        // box's own onClick (toggle).
                        e.stopPropagation();
                        onReveal!(position!);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <title>Reveal in source</title>»
                    </text>
                  )}

                  <text
                    textAnchor="start"
                    fontSize={NODE_FONT_PX}
                    fontFamily="monospace"
                    // Match the width measurer in layout.ts, which doesn't include
                    // the page's inherited letter-spacing.
                    style={{ letterSpacing: 0 }}
                  >
                    {lines.map((line, j) => (
                      <tspan
                        key={j}
                        x={-w / 2 + NODE_PAD}
                        y={(j - (lines.length - 1) / 2) * LINE_H}
                        dy="0.32em"
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

// The pinned top bar: the tree controls (expand/collapse/accordion/sequence),
// with an optional caller-supplied slot at the left (the standalone app's proof
// picker). The widget passes no slot.
function Toolbar({
  headerExtra,
  onExpandAll,
  onCollapseAll,
  accordion,
  onAccordionChange,
  seq,
  onToggleSequence,
}: {
  headerExtra?: ReactNode;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  accordion: boolean;
  onAccordionChange: (v: boolean) => void;
  seq: Seq;
  onToggleSequence: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        background: "rgba(255,255,255,0.92)",
        borderBottom: "1px solid #e2e8f0",
        fontFamily: "monospace",
        fontSize: 13,
        boxSizing: "border-box",
      }}
    >
      {headerExtra}
      <button type="button" onClick={onExpandAll} style={barButton}>
        expand all
      </button>
      <button type="button" onClick={onCollapseAll} style={barButton}>
        collapse all
      </button>
      <label
        style={{ display: "flex", alignItems: "center", gap: 4, color: "#4a5568" }}
        title="Expanding a node collapses its sibling branches"
      >
        <input
          type="checkbox"
          checked={accordion}
          onChange={(e) => onAccordionChange(e.target.checked)}
        />
        accordion
      </label>
      <button
        type="button"
        onClick={onToggleSequence}
        title="Linearize one path: pick a start node, then an end node"
        style={
          seq.mode === "off"
            ? barButton
            : { ...barButton, background: SEQ_STROKE, color: "#fff", borderColor: SEQ_STROKE }
        }
      >
        {seq.mode === "off" ? "sequence" : "exit sequence"}
      </button>
      {seq.mode !== "off" && (
        <span style={{ color: SEQ_STROKE, whiteSpace: "nowrap", flexShrink: 0 }}>
          {seq.mode === "view"
            ? "linear path · click a node to start over"
            : seq.from !== null
              ? "click the end node"
              : "click the start node"}
        </span>
      )}
    </div>
  );
}

const barButton: CSSProperties = {
  fontFamily: "monospace",
  fontSize: 12,
  padding: "2px 8px",
  cursor: "pointer",
  background: "#fff",
  border: "1px solid #cbd5e0",
  borderRadius: 4,
  color: "#2d3748",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

// A small fixed cluster for zoom: out / level / in / fit / 100%. Zooming is also
// available via ⌘/Ctrl-scroll toward the cursor.
function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFit: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: 4,
        background: "rgba(255,255,255,0.92)",
        border: "1px solid #e2e8f0",
        borderRadius: 6,
        fontFamily: "monospace",
        fontSize: 12,
      }}
      title="⌘/Ctrl-scroll to zoom toward the cursor"
    >
      <button type="button" onClick={onZoomOut} style={barButton}>
        −
      </button>
      <button
        type="button"
        onClick={onReset}
        style={{ ...barButton, minWidth: 48, border: "none" }}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" onClick={onZoomIn} style={barButton}>
        +
      </button>
      <button type="button" onClick={onFit} style={barButton}>
        fit
      </button>
    </div>
  );
}
