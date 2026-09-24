import { Fragment, type CSSProperties } from "react";

import {
  GESTURES,
  GESTURE_SECTIONS,
  type Caps,
  type Gesture,
} from "./gestures";
import { CHROME_BORDER, CHROME_INK, POPUP_CHROME } from "./theme";
import { useTip } from "./tipController";
import { CodeText } from "./codeSpans";

const INK = CHROME_INK;

export function HelpPanel({
  caps,
  fontFamily,
  onClose,
  anchor,
}: {
  caps: Caps;

  fontFamily: string;
  onClose: () => void;
  /** Where the panel hangs from its positioned ancestor. It lives on the
  status bar's `?` item, which sits at the BOTTOM of the frame, so the default
  is "above, right-aligned" — a panel hung downward from there would be
  entirely below the fold. Passed in rather than hardcoded so the anchor is
  stated where the button is. */
  anchor?: CSSProperties;
}) {
  const shown = GESTURES.filter((g) => !g.needs || caps[g.needs]);
  const tip = useTip();
  return (
    <div
      data-ptw-panel=""
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        ...(anchor ?? { left: 0, bottom: "100%", marginBottom: 4 }),
        width: 500,
        maxWidth: "min(500px, 86vw)",
        maxHeight: "min(70vh, 520px)",
        overflowY: "auto",
        boxSizing: "border-box",
        ...POPUP_CHROME,
        padding: "10px 12px",
        border: `1px solid ${CHROME_BORDER}`,
        color: INK,
        fontSize: 12,
        lineHeight: 1.5,
        textAlign: "left",
        // The panel now hangs off the status bar, whose card sets
        // `white-space: nowrap` for its own one-line items — inherited here it
        // ran every hint line straight off the panel's right edge.
        whiteSpace: "normal",
        cursor: "default",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",

          justifyContent: "flex-end",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <button
          type="button"
          {...tip.props("Close (Esc, or ?)")}
          onClick={onClose}
          style={{
            border: "none",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
            fontSize: 12,
            padding: 0,
            opacity: 0.8,
          }}
        >
          ✕
        </button>
      </div>
      {/* ONE grid for every section, so the input column is as wide as the
          longest input anywhere (max-content) and no input is cut with `…`. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "max-content minmax(0, 1fr)",
          columnGap: 8,
          rowGap: 2,
        }}
      >
        {GESTURE_SECTIONS.map((s) => {
          const rows = shown.filter((g) => g.target === s.target);
          if (rows.length === 0) return null;
          return (
            <Fragment key={s.target}>
              <div
                style={{
                  gridColumn: "1 / -1",
                  fontSize: 11,
                  letterSpacing: 0.3,
                  textTransform: "uppercase",
                  opacity: 0.65,
                  marginTop: 8,
                }}
              >
                <CodeText text={s.title} />
              </div>
              {rows.map((g, i) => (
                <Row key={i} g={g} fontFamily={fontFamily} />
              ))}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function Row({ g, fontFamily }: { g: Gesture; fontFamily: string }) {
  return (
    <>
      <span
        style={{
          fontFamily,
          textAlign: "right",
          opacity: 0.95,
          whiteSpace: "nowrap",
        }}
      >
        {g.input}
      </span>
      <span style={{ minWidth: 0 }}>
        <CodeText text={g.says.replace(/^to /, "")} />
      </span>
    </>
  );
}
