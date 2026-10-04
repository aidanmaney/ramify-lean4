// A diagnostic's mark on a node: VS Code's own squiggle under the text it is
// about (error, warning) and its hint dots (a lint), the editor's idiom for
// the same three severities — the tiles are copied from the workbench's
// `.squiggly-*` decorations so the two read as one mark.
import { SQUIGGLE_H, SQUIGGLE_TILE_W as TILE_W, diagInkOf, type Severity } from "./diagInk";

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
