// A diagnostic's mark on a node: VS Code's own squiggle under the text it is
// about (error, warning) and its hint dots (a lint), the editor's idiom for
// the same three severities — the tiles are copied from the workbench's
// `.squiggly-*` decorations so the two read as one mark.
import { useId } from "react";
import {
  SQUIGGLE_H,
  SQUIGGLE_TILE_W as TILE_W,
  diagInkOf,
  ribbonRunOf,
  ribbonWidth,
  squiggleHitW,
  type Severity,
} from "./diagInk";
import { useClassic } from "./appearance";

const patternId = (sev: Severity) => `ptw-squiggle-${sev}`;

/** One pattern per wavy severity, in user space (the phase is immaterial).
 Render once per `<svg>`; identical ids across views are harmless. */
export function SquigglePatterns() {
  return (
    <defs>
      {([1, 2] as const).map((sev) => (
        <pattern
          key={sev}
          id={patternId(sev)}
          patternUnits="userSpaceOnUse"
          width={TILE_W}
          height={SQUIGGLE_H}
        >
          <g fill={diagInkOf(sev)}>
            <polygon points="5.5,0 2.5,3 1.1,3 4.1,0" />
            <polygon points="4,0 6,2 6,0.6 5.4,0" />
            <polygon points="0,2 1,3 2.4,3 0,0.6" />
          </g>
        </pattern>
      ))}
    </defs>
  );
}

/** The mark under a span `[x, x + width]` whose bottom edge is `y`. */
export function Squiggle({
  sev,
  x,
  y,
  width,
}: {
  sev: Severity;
  x: number;
  y: number;
  width: number;
}) {
  if (sev === 3)
    return (
      <g fill={diagInkOf(3)} style={{ pointerEvents: "none" }}>
        {[1, 5, 9].map((cx) => (
          <circle key={cx} cx={x + cx} cy={y + 1} r={1} />
        ))}
      </g>
    );
  return (
    <rect
      x={x}
      y={y}
      width={Math.max(TILE_W, width)}
      height={SQUIGGLE_H}
      fill={`url(#${patternId(sev)})`}
      style={{ pointerEvents: "none" }}
    />
  );
}

/** A diagnostic box's wash under the CLASSIC ribbon: the severity's ink over
 the box fill (`DIAG_BOX_WASH_OPACITY` before cffa2be). */
const CLASSIC_WASH_OPACITY = 0.07;

/** THE DIAGNOSTIC MARK SEAM (appearance.ts): one node's mark for its worst
 severity, and the hover target that shows its messages. VS Code: the
 squiggle under the box's last line (`squiggle` geometry). CLASSIC: the left
 RIBBON inside the box's inner edge, a faint wash of the ink over the fill
 (not for a lint), and a hit strip down the left padding (`box` geometry;
 the border tint is the box's own stroke, `classicDiagStroke`). Either way it
 reserves and measures nothing. */
export function DiagMark({
  sev,
  selected,
  squiggle,
  box,
  onEnter,
  onLeave,
}: {
  sev: Severity;
  /** The node the message strip is showing (the classic ribbon thickens). */
  selected: boolean;
  squiggle: { x: number; y: number; width: number };
  box: {
    x: number;
    top: number;
    w: number;
    h: number;
    rx: number;
    /** The border's stroke width (the ribbon sits inside it). */
    sw: number;
    /** How far down the left edge a mark tab reaches (0 without one). */
    tabInset: number;
    /** The left padding: the classic hover strip's width. */
    padW: number;
  };
  onEnter: () => void;
  onLeave: () => void;
}) {
  const classic = useClassic();
  const clipId = useId();
  if (classic) {
    const { x, top, w, h, rx, sw, tabInset, padW } = box;
    const inner = {
      x: x + sw / 2,
      y: top + sw / 2,
      width: w - sw,
      height: h - sw,
      rx: Math.max(0, rx - sw / 2),
    };
    const rw = ribbonWidth(sev, selected);
    const run = ribbonRunOf(sev, inner.y + tabInset, inner.height - tabInset, inner.rx);
    const lx = inner.x + rw / 2;
    return (
      <>
        <clipPath id={clipId}>
          <rect {...inner} />
        </clipPath>
        {sev !== 3 && (
          <rect
            {...inner}
            fill={diagInkOf(sev)}
            fillOpacity={CLASSIC_WASH_OPACITY}
            style={{ pointerEvents: "none" }}
          />
        )}
        <line
          x1={lx}
          x2={lx}
          y1={run.y1}
          y2={run.y2}
          stroke={diagInkOf(sev)}
          strokeWidth={rw}
          clipPath={`url(#${clipId})`}
          style={{ pointerEvents: "none" }}
        />
        <rect
          x={x}
          y={top}
          width={padW}
          height={h}
          fill="transparent"
          style={{ cursor: "help" }}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
        />
      </>
    );
  }
  return (
    <>
      <Squiggle sev={sev} x={squiggle.x} y={squiggle.y} width={squiggle.width} />
      <rect
        x={squiggle.x}
        y={squiggle.y - 4}
        width={squiggleHitW(sev, squiggle.width)}
        height={SQUIGGLE_H + 6}
        fill="transparent"
        style={{ cursor: "help" }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      />
    </>
  );
}
