// The status bar's diagnostics count item and the message strip above the strip: severity glyphs and
// ink, the per-severity counts, and the strip with its pager.
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
  MARKER_BG,
  CHROME_TEXT,
  CHROME_TEXT_SM,
} from "./theme";
import { BARE_BTN, DIAG_STRIP_GAP, PILL_BTN } from "./barMetrics";
import { BarButton } from "./barChrome";
import { Codicon } from "./codiconView";
import { DIAG_ICON, type Severity } from "./diagInk";

/** A severity's codicon in its ink (`DIAG_ICON`): the problems count, the
 message strip and a node's popover. The text glyphs stay for native
 `<title>`s, which cannot hold an SVG. */
export function DiagIcon({ sev, size = 16 }: { sev: Severity; size?: number }) {
  const i = DIAG_ICON[sev];
  return <Codicon name={i.name} size={size} color={i.ink} opacity={i.opacity} />;
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

/** THE COUNT, never the message (2026-09-24), in the status bar's own
 Problems idiom (2026-10-04): `[error] 2  [warning] 1  [info] 3` — each
 severity's codicon in its ink, a 3px gap, the count in tabular figures, two
 spaces' room between severities. A count's width follows its digits; a
 severity appearing or going is a real change and moves what is beside it.
 The ghost measures this same element, so measurer and renderer cannot
 drift. */
function DiagCounts({
  counts,
  compact,
}: {
  counts: readonly [number, number, number];
  /** The row's last resort before clipping: the WORST severity's icon and
   the total — chosen by `fit` only where even the all-glyph row cannot hold
   every severity's count. */
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
        gap: 8,
        fontSize: CHROME_TEXT_SM,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {sevs.map((s) => (
        <span
          key={s}
          style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
        >
          <DiagIcon sev={s} />
          {compact ? total : counts[s - 1]}
        </span>
      ))}
    </span>
  );
}

/** The bar's diagnostics ITEM: the counts, and a click that opens (or shuts)
 the message strip. NOT lit while the strip is up (2026-10-04): VS Code's
 Problems item never changes look, and the strip standing above it says the
 state; the accent's dark block read as an alarm of its own. */
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
        // The marker-navigation widget's surface with its header tint over
        // it, both over the opaque page (`chromeSurface`'s reason: a host
        // colour may carry alpha).
        background: `linear-gradient(${DIAG_WASH[sev]}, ${DIAG_WASH[sev]}), ${chromeSurface(MARKER_BG)}`,
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
      <span style={{ display: "inline-flex", flex: "none" }}>
        <DiagIcon sev={sev} />
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
        {/* The marker-navigation widget's own order: where you are, then
            Next (`arrow-down`) and Previous (`arrow-up`), then close. */}
        {count > 1 && (
          <>
            <span
              style={{
                color: MUTED_FILL,
                fontSize: CHROME_TEXT_SM,
                marginRight: 2,
              }}
            >
              {index + 1}/{count}
            </span>
            <button
              type="button"
              data-ptw-baritem=""
              style={PILL_BTN}
              {...tip.props("Next problem")}
              onClick={() => onStep(1)}
            >
              <Codicon name="arrow-down" />
            </button>
            <button
              type="button"
              data-ptw-baritem=""
              style={PILL_BTN}
              {...tip.props("Previous problem")}
              onClick={() => onStep(-1)}
            >
              <Codicon name="arrow-up" />
            </button>
          </>
        )}
        <button
          type="button"
          data-ptw-baritem=""
          style={PILL_BTN}
          {...tip.props("Close the messages (Esc)")}
          onClick={onClose}
        >
          <Codicon name="close" />
        </button>
      </span>
    </div>
  );
}
