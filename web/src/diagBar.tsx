// The status bar's diagnostics count item and the message strip above the strip: severity glyphs and
// ink, the per-severity counts, and the strip with its pager.
import { Fragment } from "react";
import { type TreeDiagnostic } from "./diagnostics";
import { useTip } from "./tipController";
import {
  MUTED_FILL,
  POPUP_CHROME,
  chromeSurface,
  CHROME_BORDER,
  CHROME_INK,
  CHROME_FONT,
  CHROME_RADIUS,
  DIAG_EDGE,
  DIAG_WASH,
  DIM_OPACITY,
  CHROME_TEXT,
  CHROME_TEXT_SM,
} from "./theme";
import { BARE_BTN, DIAG_STRIP_GAP, PILL_BTN } from "./barMetrics";
import { BarButton, BarSvg, ChevronGlyph } from "./barChrome";
import { diagInkOf } from "./diagInk";

/** The same three marks, DRAWN, for the HTML chrome (the bar's diagnostics
 item and a node's diagnostics popover). As text they came from three
 different fallback faces and inked at three sizes: in the bar's 11px UI face
 `⨯` was 3.7 × 3.8 px against `⚠` 9.0 × 8.2 and `◇` 10.5 (canvas, 8×) — the
 error, the one that matters most, was the smallest mark in the row. Drawn in
 `currentColor` at the chrome's `BAR_GLYPH_SW`, all three ink ~8 px. The text
 glyphs stay for native `<title>`s, which cannot hold an SVG. */
export function DiagGlyph({ sev }: { sev: 1 | 2 | 3 }) {
  return (
    <BarSvg
      w={10}
      h={10}
      style={{ display: "inline-block", verticalAlign: "-1px", flex: "none" }}
    >
      {sev === 1 ? (
        <path d="M1.8 1.8L8.2 8.2M8.2 1.8L1.8 8.2" />
      ) : sev === 2 ? (
        <>
          <path d="M5 1L9.2 8.8H0.8Z" />
          <path d="M5 4v2" />
        </>
      ) : (
        <path d="M5 0.9L9.1 5L5 9.1L0.9 5Z" />
      )}
    </BarSvg>
  );
}

export interface DiagBarProps {
  index: number;
  count: number;
  diag: TreeDiagnostic;
  /** Errors, warnings, lints — what the count item draws. */
  counts: readonly [number, number, number];
  /** Whether the message strip is up (derived by the view, see its state). */
  open: boolean;
  clickable: boolean;
  onStep: (d: number) => void;
  onGo: () => void;
  onToggle: () => void;
  onClose: () => void;
}

const DIAG_NOUN = [
  ["error", "errors"],
  ["warning", "warnings"],
  ["lint", "lints"],
] as const;

/** `2 errors, 1 lint` — the count item's words, for its tip. */
function diagCountWords(counts: readonly [number, number, number]): string {
  return counts
    .map((n, i) => (n > 0 ? `${n} ${DIAG_NOUN[i][n === 1 ? 0 : 1]}` : ""))
    .filter(Boolean)
    .join(", ");
}

/** THE COUNT, never the message (2026-09-24). The bar's diagnostics item used
 to draw the first message's first line, truncated to whatever room the row
 left — `◇ This lin…` for Mathlib's `style.longLine` — with the words only in
 the tip: a sentence cut to a stub reads as nothing. Now the item says HOW
 MANY of each severity (`✕ 2 · ◇ 1`, the drawn `DiagGlyph`s in each
 severity's ink) and the words live in the message strip above the strip.
 Each count reserves TWO tabular digits (`minWidth: 2ch`), so 1 → 12 moves
 nothing; a severity appearing or going is a real change and does. The ghost
 measures this same element, so measurer and renderer cannot drift. */
function DiagCounts({
  counts,
  compact,
}: {
  counts: readonly [number, number, number];
  /** The row's last resort before clipping: the WORST severity's glyph and
   the total, `✕ 3` — chosen by `fit` only where even the all-glyph row
   cannot hold every severity's count. */
  compact?: boolean;
}) {
  const present = ([1, 2, 3] as const).filter((s) => counts[s - 1] > 0);
  const sevs = compact ? present.slice(0, 1) : present;
  const total = counts[0] + counts[1] + counts[2];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: CHROME_TEXT_SM,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {sevs.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && <span style={{ opacity: DIM_OPACITY }}>·</span>}
          <span style={{ color: diagInkOf(s), display: "inline-flex" }}>
            <DiagGlyph sev={s} />
          </span>
          <span
            style={{ display: "inline-block", minWidth: "2ch", textAlign: "left" }}
          >
            {compact ? total : counts[s - 1]}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/** The bar's diagnostics ITEM: the counts, and a click that opens (or shuts)
 the message strip. Lit while the strip is up, as every bar item is while its
 own panel is (design rule 13) — the strip is this item's panel. */
export function DiagCountItem({
  counts,
  open,
  onToggle,
  compact,
}: DiagBarProps & { compact?: boolean }) {
  const words = diagCountWords(counts);
  return (
    <BarButton
      label={<DiagCounts counts={counts} compact={compact} />}
      title={
        open
          ? `Problems: ${words} — click to close the messages (Esc)`
          : `Problems: ${words} — click for the messages`
      }
      accent={open}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    />
  );
}

const MESSAGE_CLAMP = {
  overflowWrap: "anywhere",
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 3,
  overflow: "hidden",
} as const;

/** THE MESSAGE STRIP (2026-09-24) — a secondary bar floating directly ABOVE
 the status strip, the strip's own width (it is the strip's child, at its
 outer edges, so the strip's placement places it too, and the Marks item's
 arrival changes nothing about it).
 Tinted by the severity of the message it shows — a wash of that ink over the
 chrome and a left edge in it (`DIAG_WASH`/`DIAG_EDGE`) — which is what says
 "transient notice" rather than "setting". It WRAPS, up to three lines, and
 the tip carries the whole message where even that is not enough; nothing is
 cut to a stub in the row. Paint only: it reserves nothing in the tree and
 moves nothing (the rail's climb is `fit`'s report, not a layout). Clicking
 the message does what the old pager's click did — the problem on its node
 and in the source; `‹ n/N ›` pages every problem; `×` closes it (a
 dismissal of the current error set, see the view's derivation). */
export function DiagStrip({
  index,
  count,
  diag,
  clickable,
  onStep,
  onGo,
  onClose,
  stripRef,
}: DiagBarProps & {
  stripRef: React.Ref<HTMLDivElement>;
}) {
  const tip = useTip();
  const sev = diag.severity;
  return (
    <div
      ref={stripRef}
      data-ptw-diagstrip=""
      role="status"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        // The status strip's OUTER edges (its 1px border sits outside the
        // padding box these resolve against), so the two read as one column.
        left: -1,
        right: -1,
        bottom: "100%",
        marginBottom: DIAG_STRIP_GAP,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        padding: "4px 4px 4px 8px",
        background: chromeSurface(DIAG_WASH[sev]),
        border: `1px solid ${CHROME_BORDER}`,
        borderLeft: `3px solid ${DIAG_EDGE[sev]}`,
        borderRadius: CHROME_RADIUS,
        boxShadow: POPUP_CHROME.boxShadow,
        color: CHROME_INK,
        fontFamily: CHROME_FONT,
        fontSize: CHROME_TEXT,
        lineHeight: "16px",
        whiteSpace: "normal",
        textAlign: "left",
      }}
    >
      <span
        style={{
          color: diagInkOf(sev),
          display: "inline-flex",
          alignItems: "center",
          height: 16,
          flex: "none",
        }}
      >
        <DiagGlyph sev={sev} />
      </span>
      {/* The message is a BUTTON where a click does something (node + source),
          so the keyboard can reach it; the clamp lives on the span inside,
          because a button will not lay out as `-webkit-box`. Where nothing
          can be shown it stays plain text. */}
      {clickable ? (
        <button
          type="button"
          onClick={onGo}
          {...tip.props(
            `Show in source: ${diag.message}\n\nClick to show it on its node and in the source`,
          )}
          style={{
            ...BARE_BTN,
            flex: "1 1 auto",
            minWidth: 0,
            display: "block",
            font: "inherit",
            lineHeight: "inherit",
            textAlign: "inherit",
          }}
        >
          <span style={MESSAGE_CLAMP}>{diag.message.split("\n")[0]}</span>
        </button>
      ) : (
        <span
          {...tip.props(diag.message)}
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            cursor: "default",
            ...MESSAGE_CLAMP,
          }}
        >
          {diag.message.split("\n")[0]}
        </span>
      )}
      <span
        style={{
          flex: "none",
          display: "inline-flex",
          alignItems: "center",
          height: 16,
          gap: 2,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count > 1 && (
          <>
            <button
              type="button"
              style={PILL_BTN}
              {...tip.props("Previous problem")}
              onClick={() => onStep(-1)}
            >
              <ChevronGlyph dir="prev" />
            </button>
            <span style={{ color: MUTED_FILL, fontSize: CHROME_TEXT_SM }}>
              {index + 1}/{count}
            </span>
            <button
              type="button"
              style={PILL_BTN}
              {...tip.props("Next problem")}
              onClick={() => onStep(1)}
            >
              <ChevronGlyph dir="next" />
            </button>
          </>
        )}
        <button
          type="button"
          style={{ ...PILL_BTN, width: 16 }}
          {...tip.props("Close the messages (Esc)")}
          onClick={onClose}
        >
          <BarSvg w={8} h={8}>
            <path d="M1 1L7 7M7 1L1 7" />
          </BarSvg>
        </button>
      </span>
    </div>
  );
}
