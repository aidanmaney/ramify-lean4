import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useLayoutEffect,
  type CSSProperties,
} from "react";
import {
  createLayoutEngine,
  hypSize,
  HYP_LINE_H,
  HYP_PAD,
  LINE_H,
  NODE_PAD,
  HYP_GAP,
  ARROW_GAP,
} from "./layout";
import { parseNdjson, type ProofRecord } from "./paperproof";
import { proofToTree, proofTitle } from "./proofToTree";

// Where the committed sample proofs live (served from /public). Swapping this
// for a fetch against a live parser endpoint — or data pushed in from a Lean
// user-widget — is the only change needed to change the data source.
const SAMPLE_URL = `${import.meta.env.BASE_URL}sample.ndjson`;

// Snapshot taken on fold/unfold so we can re-anchor the scroll position to the
// toggled node after the relayout (see `toggle`).
interface Anchor {
  id: string;
  x: number;
  y: number;
  sx: number;
  sy: number;
}

const MARGIN = { top: 80, right: 90, bottom: 40, left: 90 };
const NODE_STYLES = {
  goal: { fill: "#eef6ff", stroke: "#2b6cb0" },
  tactic: { fill: "#f0fff4", stroke: "#2f855a" },
  default: { fill: "#fff", stroke: "#999" },
};

const FONT_SIZE = 12;

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 2;
const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

// Hypothesis (local context) labels drawn above each subgoal.
const HYP_FONT = 11;

// A small context box centered at (x, y), listing its hypotheses. Box geometry
// comes from the shared hypSize so it matches the room the layout reserved.
function HypLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const lines = text.split("\n");
  const { w, h } = hypSize(text);

  return (
    <g transform={`translate(${x},${y})`}>
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={4}
        fill="#fffbe6"
        stroke="#d6b656"
        strokeWidth={1}
      />
      <text
        textAnchor="start"
        fontSize={HYP_FONT}
        fontFamily="monospace"
        fill="#7a6000"
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

export default function App() {
  const [records, setRecords] = useState<ProofRecord[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Accordion: expanding a node collapses its sibling branches, so only one
  // branch is open per level (the "view one branch at a time" mode).
  const [accordion, setAccordion] = useState(true);
  // Zoom factor applied to the whole SVG (1 = 100%). Lets you fit a wide/tall
  // tree into the slice and zoom back into a region.
  const [zoom, setZoom] = useState(1);

  // The engine we've already centered on; lets the init effect re-center once
  // per loaded proof without writing a ref during render.
  const centeredFor = useRef<unknown>(null);
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

  // Load every proof in the sample once. The picker selects which to render.
  useEffect(() => {
    fetch(SAMPLE_URL)
      .then((r) => r.text())
      .then((text) => {
        const recs = parseNdjson(text);
        if (recs.length === 0) throw new Error("no proofs in sample");
        setRecords(recs);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const proof = records?.[selected]?.data.proof ?? null;

  // One layout engine per selected proof; rebuilding it is how the data swaps.
  const engine = useMemo(
    () => (proof ? createLayoutEngine(proofToTree(proof)) : null),
    [proof],
  );

  // When a new proof loads, reset to "everything collapsed" and re-center. This
  // is derived-from-engine state, so we adjust it during render on change rather
  // than in an effect (avoids a cascading re-render).
  const [prevEngine, setPrevEngine] = useState(engine);
  if (engine !== prevEngine) {
    setPrevEngine(engine);
    setCollapsed(engine ? engine.foldableIds() : new Set());
    setZoom(1);
  }

  const { nodes, links, extent } = useMemo(
    () =>
      engine
        ? engine.computeLayout(collapsed)
        : { nodes: [], links: [], extent: { width: 0, height: 0 } },
    [engine, collapsed],
  );

  const toggle = (id: string) => {
    const cur = nodes.find((n) => n.data.id === id);
    const el = scrollRef.current;
    if (cur && el) {
      anchorRef.current = {
        id,
        x: cur.x,
        y: cur.y,
        sx: el.scrollLeft, // TRUE pre-relayout scroll — captured now, before the
        sy: el.scrollTop, // browser can clamp it when the SVG resizes on fold
      };
    }

    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Expanding this node. In accordion mode, also collapse its sibling
        // branches so only one path stays open at this level.
        next.delete(id);
        if (accordion && engine)
          for (const s of engine.siblingIds(id)) next.add(s);
      } else {
        next.add(id);
      }
      return next;
    });
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
      el.scrollLeft = Math.max(
        0,
        Math.min(maxX, anchor.sx + (now.x - anchor.x) * zoom),
      );
      el.scrollTop = Math.max(
        0,
        Math.min(maxY, anchor.sy + (now.y - anchor.y) * zoom),
      );
    }

    anchorRef.current = null; // consume it so unrelated re-renders don't re-shift
  }, [nodes]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (
      !el ||
      centeredFor.current === engine ||
      viewport.w === 0 ||
      nodes.length === 0
    )
      return;

    // Sugiyama centers the root horizontally over the WHOLE tree, so root.x is
    // generally far from 0. Center on the root: put its content position in the
    // middle of the viewport horizontally, and at the top (just below MARGIN.top).
    const root = nodes.find((n) => n.data.parents.length === 0) ?? nodes[0];
    // PAD_X === viewport.w and PAD_Y === viewport.h; use viewport directly so the
    // effect's only dependency is `viewport` (and `nodes`), not the derived pads.
    // screenX(node) = MARGIN.left + PAD_X + node.x - scrollLeft; solve for the
    // scrollLeft that lands root at viewport.w / 2.
    el.scrollLeft = MARGIN.left + viewport.w + root.x - viewport.w / 2;
    // Land the root's top edge just under MARGIN.top (the MARGIN.top terms cancel).
    el.scrollTop = viewport.h + root.y - root.data.h / 2;
    centeredFor.current = engine;
  }, [viewport, nodes, engine]);

  // After a zoom change re-renders the (resized) SVG, restore scroll so the
  // intended point stays put: an explicit target (fit) wins, else the anchor
  // point under the cursor / viewport centre is held fixed.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    const maxX = el.scrollWidth - el.clientWidth;
    const maxY = el.scrollHeight - el.clientHeight;
    if (pendingScrollRef.current) {
      el.scrollLeft = clamp(pendingScrollRef.current.left, maxX);
      el.scrollTop = clamp(pendingScrollRef.current.top, maxY);
    } else if (zoomAnchorRef.current) {
      const a = zoomAnchorRef.current;
      el.scrollLeft = clamp(a.X * zoom - a.px, maxX);
      el.scrollTop = clamp(a.Y * zoom - a.py, maxY);
    }
    pendingScrollRef.current = null;
    zoomAnchorRef.current = null;
  }, [zoom]);

  // Re-zoom keeping the screen point (px,py) within the scroll box fixed. SVG
  // coord X under that point is (scrollLeft + px) / zoom; after the change we
  // want X * zoom' - scrollLeft' = px, so the layout effect solves scrollLeft'.
  const zoomAt = (next: number, px: number, py: number) => {
    const el = scrollRef.current;
    const n = clampZoom(next);
    if (!el || n === zoom) return;
    zoomAnchorRef.current = {
      X: (el.scrollLeft + px) / zoom,
      Y: (el.scrollTop + py) / zoom,
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
  // we can preventDefault the browser's page-zoom; re-bound on zoom change so the
  // handler reads the current factor.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(
        zoom * Math.exp(-e.deltaY * 0.0015),
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const svgW = extent.width + MARGIN.left + MARGIN.right + 2 * PAD_X;
  const svgH = extent.height + MARGIN.top + MARGIN.bottom + 2 * PAD_Y;

  return (
    <>
      {records && records.length > 0 && (
        <ProofPicker
          records={records}
          selected={selected}
          onSelect={setSelected}
          onExpandAll={() => setCollapsed(new Set())}
          onCollapseAll={() =>
            setCollapsed(engine ? engine.foldableIds() : new Set())
          }
          accordion={accordion}
          onAccordionChange={setAccordion}
        />
      )}
      {records && records.length > 0 && (
        <ZoomControls
          zoom={zoom}
          onZoomIn={() => zoomBy(1.25)}
          onZoomOut={() => zoomBy(1 / 1.25)}
          onReset={() => zoomBy(1 / zoom)}
          onFit={fitWidth}
        />
      )}
      {(error || (records && nodes.length === 0)) && (
        <div
          style={{
            position: "fixed",
            top: 48,
            left: 12,
            zIndex: 10,
            fontFamily: "monospace",
            fontSize: 13,
            color: error ? "#c53030" : "#666",
          }}
        >
          {error ? `Failed to load proofs: ${error}` : "Loading…"}
        </div>
      )}
      <div
        ref={scrollRef}
        className="no-scrollbar"
        style={{
          width: "100%",
          height: "100vh",
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
        <g
          transform={`translate(${MARGIN.left + PAD_X},${MARGIN.top + PAD_Y})`}
        >
          {links.map((link, i) => {
            const startX = link.source.x;
            const endX = link.target.x;
            const startY = link.source.y + link.source.data.h / 2; // bottom of THIS parent
            const childTop = link.target.y - link.target.data.h / 2; // top of THIS child
            const endY = childTop - ARROW_GAP; // arrowhead lands just above the node

            const k = (endY - startY) * 0.7;
            const hyps = link.data; // hypotheses introduced on this edge, if any

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
                  />
                )}
              </g>
            );
          })}
          {nodes.map((node) => {
            const { w, h, lines, type, id, foldable } = node.data;
            const style = NODE_STYLES[type] ?? NODE_STYLES.default;
            const isCollapsed = collapsed.has(id);

            return (
              <g
                key={id}
                transform={`translate(${node.x},${node.y})`}
                onClick={foldable ? () => toggle(id) : undefined}
                style={{ cursor: foldable ? "pointer" : "default" }}
              >
                <rect
                  x={-w / 2}
                  y={-h / 2}
                  width={w}
                  height={h}
                  rx={6}
                  stroke={style.stroke}
                  strokeWidth={1.5}
                  fill={style.fill}
                />

                {foldable && (
                  <text
                    x={w / 2 - 8}
                    y={-h / 2 + 12}
                    textAnchor="middle"
                    fontSize={FONT_SIZE}
                    fontFamily="monospace"
                    fill={style.stroke}
                  >
                    {isCollapsed ? "+" : "−"}
                  </text>
                )}

                <text
                  textAnchor="start"
                  fontSize={FONT_SIZE}
                  fontFamily="monospace"
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
    </>
  );
}

// A fixed top bar listing every parsed proof; selecting one swaps the rendered
// tree. Labels are the proof's root goal type (plus its source position), which
// is enough to tell theorems apart without the parser emitting names.
function ProofPicker({
  records,
  selected,
  onSelect,
  onExpandAll,
  onCollapseAll,
  accordion,
  onAccordionChange,
}: {
  records: ProofRecord[];
  selected: number;
  onSelect: (i: number) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  accordion: boolean;
  onAccordionChange: (v: boolean) => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
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
      }}
    >
      <label htmlFor="proof-picker" style={{ color: "#4a5568" }}>
        proof
      </label>
      <select
        id="proof-picker"
        value={selected}
        onChange={(e) => onSelect(Number(e.target.value))}
        style={{ fontFamily: "monospace", fontSize: 13, maxWidth: "70vw" }}
      >
        {records.map((rec, i) => (
          <option key={i} value={i}>
            #{rec.data.index} ⊢ {proofTitle(rec.data.proof)}
          </option>
        ))}
      </select>
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
      <span style={{ color: "#a0aec0" }}>
        {records[selected]?.file} · {records.length} proof
        {records.length === 1 ? "" : "s"}
      </span>
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
        position: "fixed",
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
