// The context block of a goal box: one hypothesis per line, with its used/lit washes,
// abbreviation underlines and origin hit strips. Measured by layout's `sizeOf`; change one, change both.
import { type ReactNode } from "react";
import {
  HYP_FONT_PX,
  HYP_LINE_H,
  hypGutterW,
  hypLineOffset,
  HYP_ARROW_GAP,
  HYP_FROM_PX,
  hypArrowText,
  getUiFontFamily,
  HYP_SEP_H,
  getCodeFontFamily,
  measureText,
} from "./layout";
import type { HypLine } from "./types";
import type { HypMarkStyle } from "./theme";
import { HYP_MARK } from "./gestures";
import { isInaccessibleName } from "./proofToTree";
import { daggerHtml, daggerSvg } from "./dagger";
import {
  HYP_LIT_FILL,
  HYP_NAME_FILL,
  INACCESSIBLE_FILL,
  HYP_MARK_FILL,
  HYP_UNUSED_FILL,
  HYP_USED_FILL,
  CHROME_BORDER,
  CHROME_RADIUS,
} from "./theme";

const UNDERLINE_DROP = 2.5;

const HYP_LIT_PAD = 2;

/** A plain line's text with its NAMES inked as the infoview inks them (one
 pane over): `--ptw-hypname`, or italic in `--ptw-inaccessible` (a dim TOKEN, no opacity) for an inaccessible `x✝`.
 Colour and style only — the same characters in the same code font, whose
 italic keeps the advance — so the measured width is untouched. A wrapped
 continuation has no names; a dimmed (unused) line keeps its one dim ink and
 only takes the inaccessible style. */
/** Where a line's NAMES end (the ` : ` before its type), or -1 on a wrapped
 continuation or a line without one. Shared by the names' ink below and the
 used-hyp wash, so the wash covers exactly the inked names. */
const hypNameEnd = (line: HypLine): number =>
  line.cont ? -1 : line.text.indexOf(" : ");

function hypLineText(line: HypLine, dimmed: boolean): ReactNode {
  const cut = hypNameEnd(line);
  if (cut <= 0) return daggerSvg(line.text, HYP_FONT_PX);
  const names = line.text.slice(0, cut).split(" ");
  return (
    <>
      {names.map((n, i) => {
        const gone = isInaccessibleName(n);
        return (
          <tspan
            key={i}
            className={gone ? "ptw-inaccessible" : undefined}
            fill={dimmed ? undefined : gone ? INACCESSIBLE_FILL : HYP_NAME_FILL}
            fontStyle={gone ? "italic" : undefined}
          >
            {daggerSvg(i > 0 ? ` ${n}` : n, HYP_FONT_PX)}
          </tspan>
        );
      })}
      {daggerSvg(line.text.slice(cut), HYP_FONT_PX)}
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
  // The lead column (`lead`, outside `used`): bullets on the lines the
  // consumer reads, the others in the unused ink. In `used` every line shown
  // is read, so nothing is marked and nothing dims.
  const anyUsed = hypGutterW(lines) > 0;

  const textX = x + hypGutterW(lines);

  const sepIndex = lines.findIndex((l) => l.sep);
  const sepOff = (j: number) =>
    sepIndex >= 0 && j >= sepIndex ? HYP_SEP_H : 0;

  const hypLineMid = (j: number) => y + hypLineOffset(lines, j);
  const hypBaseline = (j: number) =>
    hypLineMid(j) + 0.32 * HYP_FONT_PX + UNDERLINE_DROP;

  const lineFill = (line: HypLine) =>
    line.more || (anyUsed && !line.used) ? HYP_UNUSED_FILL : HYP_USED_FILL;

  // The far-origin arrow, after the line's text (`HYP_ARROW_GAP`; layout's
  // `hypLineInkW` measured exactly this), in the dim ink — one dimming.
  const arrowSvg = (line: HypLine) =>
    line.arrow ? (
      <tspan
        dx={HYP_ARROW_GAP}
        fill={HYP_UNUSED_FILL}
        fontStyle="normal"
        fontFamily={getUiFontFamily()}
        fontSize={HYP_FROM_PX}
      >
        {hypArrowText(line.arrow)}
      </tspan>
    ) : null;

  return (
    <>
      {sepIndex >= 0 && (
        <line
          x1={x}
          x2={x + width}
          y1={y + sepIndex * HYP_LINE_H + HYP_SEP_H / 2}
          y2={y + sepIndex * HYP_LINE_H + HYP_SEP_H / 2}
          stroke={CHROME_BORDER}
          strokeWidth={1}
        />
      )}

      {lit && lines.some((l) => l.used) && (
        <g style={{ pointerEvents: "none" }}>
          {lines.map((line, j) => {
            if (!line.used) return null;
            // The NAMES alone (2026-10-23): a whole-line block beside the
            // producer diff's wash on the target read as two heavy washes
            // fighting. A continuation has no names and gets none; a line
            // with no ` : ` keeps the whole text. The tagged path paints
            // its text over this same rect, in the same code font.
            const cut = hypNameEnd(line);
            if (line.cont) return null;
            const lx = textX + (line.indent ?? 0);
            const lw = measureText(
              cut > 0 ? line.text.slice(0, cut) : line.text,
              HYP_FONT_PX,
            );

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
            line.used && line.lead && !line.cont ? (
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
                title={line.more ? undefined : lineTitle?.(j)}
                onMouseEnter={onLine && !line.more ? () => onLine(j) : undefined}
                onMouseLeave={onLine && !line.more ? () => onLine(null) : undefined}
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
                  color: lineFill(line),
                  paddingLeft: line.indent ?? 0,

                  marginTop: line.sep ? HYP_SEP_H : 0,
                }}
              >
                {line.more ? line.text : (taggedLines[j] ?? daggerHtml(line.text))}
                {line.arrow ? (
                  <span
                    style={{
                      marginLeft: HYP_ARROW_GAP,
                      color: HYP_UNUSED_FILL,
                      fontFamily: getUiFontFamily(),
                      fontSize: HYP_FROM_PX,
                    }}
                  >
                    {hypArrowText(line.arrow)}
                  </span>
                ) : null}
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
              fill={lineFill(line)}
            >
              {line.more ? line.text : hypLineText(line, anyUsed && !line.used)}
              {arrowSvg(line)}
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
          {lines.map((line, j) => line.more ? null : (
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
