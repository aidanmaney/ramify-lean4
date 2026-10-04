// The context block of a goal box: one hypothesis per line, with its used/lit washes,
// abbreviation underlines and origin hit strips. Measured by layout's `sizeOf`; change one, change both.
import { type ReactNode } from "react";
import {
  HYP_FONT_PX,
  HYP_LINE_H,
  hypGutterW,
  hypLineOffset,
  HYP_SEP_H,
  getCodeFontFamily,
  measureText,
} from "./layout";
import type { HypLine } from "./types";
import type { HypMarkStyle } from "./theme";
import { HYP_MARK } from "./gestures";
import { isInaccessibleName } from "./proofToTree";
import {
  HYP_LIT_FILL,
  HYP_NAME_FILL,
  INACCESSIBLE_FILL,
  HYP_MARK_FILL,
  HYP_UNUSED_FILL,
  HYP_USED_FILL,
  FAINT_OPACITY,
  CHROME_RADIUS,
} from "./theme";

const UNDERLINE_DROP = 2.5;

const HYP_LIT_PAD = 2;

/** A plain line's text with its NAMES inked as the infoview inks them (one
 pane over): `--ptw-hypname`, or italic and faint for an inaccessible `x✝`.
 Colour and style only — the same characters in the same code font, whose
 italic keeps the advance — so the measured width is untouched. A wrapped
 continuation has no names; a dimmed (unused) line keeps its one dim ink and
 only takes the inaccessible style. */
function hypLineText(line: HypLine, dimmed: boolean): ReactNode {
  const cut = line.cont ? -1 : line.text.indexOf(" : ");
  if (cut <= 0) return line.text;
  const names = line.text.slice(0, cut).split(" ");
  return (
    <>
      {names.map((n, i) => {
        const gone = isInaccessibleName(n);
        return (
          <tspan
            key={i}
            fill={dimmed ? undefined : gone ? INACCESSIBLE_FILL : HYP_NAME_FILL}
            fontStyle={gone ? "italic" : undefined}
            opacity={gone ? 0.7 : undefined}
          >
            {i > 0 ? ` ${n}` : n}
          </tspan>
        );
      })}
      {line.text.slice(cut)}
    </>
  );
}

export function HypBlock({
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
          opacity={FAINT_OPACITY}
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
                rx={CHROME_RADIUS}
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
              {hypLineText(line, anyUsed && !line.used)}
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
