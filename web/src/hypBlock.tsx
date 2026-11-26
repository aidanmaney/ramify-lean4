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
import { daggerHtml } from "./dagger";
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

/** A plain line's text as HTML, its NAMES inked as the infoview inks them. */
function hypLineHtml(line: HypLine, dimmed: boolean): ReactNode {
  const cut = hypNameEnd(line);
  if (cut <= 0) return daggerHtml(line.text);
  const names = line.text.slice(0, cut).split(" ");
  return (
    <>
      {names.map((n, i) => {
        const gone = isInaccessibleName(n);
        return (
          <span
            key={i}
            className={gone ? "ptw-inaccessible" : undefined}
            style={{
              color: dimmed ? undefined : gone ? INACCESSIBLE_FILL : HYP_NAME_FILL,
              fontStyle: gone ? "italic" : undefined,
            }}
          >
            {daggerHtml(i > 0 ? ` ${n}` : n)}
          </span>
        );
      })}
      {daggerHtml(line.text.slice(cut))}
    </>
  );
}

/** The block is drawn in TWO PARTS (the HTML-node rewrite, stage 2): `ink`
 is the SVG under the text — the separator, the used-hyp washes and the
 lead bullets — and `text` is the lines themselves as HTML, placed in the
 node's HTML layer at the same coordinates. Both take the same props. */
export function HypBlock({
  part = "ink",
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
  part?: "ink" | "text";
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

  if (part === "text")
    return (
      <div
        data-ptw-hyps=""
        style={{
          position: "absolute",
          left: textX,
          top: y,
          width: Math.max(0, x + width - textX),
          textAlign: "left",
          fontFamily: getCodeFontFamily(),
          fontSize: HYP_FONT_PX,
          lineHeight: `${HYP_LINE_H}px`,
          letterSpacing: 0,
          whiteSpace: "pre",
        }}
      >
        {lines.map((line, j) => (
          // The provenance hover rides the LINE'S OWN `<div>`: it covers the
          // line's whole row, so the gaps between glyphs are hit too, and
          // nothing is laid over the tagged path's `InteractiveCode`.
          <div
            key={j}
            data-ptw-hyp={line.more ? undefined : j}
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
            {line.more
              ? line.text
              : taggedLines
                ? (taggedLines[j] ?? daggerHtml(line.text))
                : hypLineHtml(line, anyUsed && !line.used)}
            {line.arrow ? (
              <span
                style={{
                  marginLeft: HYP_ARROW_GAP,
                  color: HYP_UNUSED_FILL,
                  fontStyle: "normal",
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
    );

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
    </>
  );
}
