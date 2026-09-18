import type { CSSProperties } from "react";

import {
  GESTURES,
  GESTURE_SECTIONS,
  type Caps,
  type Gesture,
} from "./gestures";
import { POPUP_CHROME } from "./theme";
import { useTip } from "./tipController";

const INK = "var(--vscode-icon-foreground, #2d3748)";

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

      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        ...(anchor ?? { left: 0, bottom: "100%", marginBottom: 4 }),
        width: 420,
        maxWidth: "min(420px, 78vw)",
        maxHeight: "min(70vh, 520px)",
        overflowY: "auto",
        boxSizing: "border-box",
        ...POPUP_CHROME,
        padding: "10px 12px",
        border: "1px solid var(--vscode-editorWidget-border, #cbd5e0)",
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
      {GESTURE_SECTIONS.map((s) => {
        const rows = shown.filter((g) => g.target === s.target);
        if (rows.length === 0) return null;
        return (
          <div key={s.target} style={{ marginTop: 8 }}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: 0.3,
                textTransform: "uppercase",
                opacity: 0.65,
                marginBottom: 2,
              }}
            >
              {s.title}
            </div>
            {rows.map((g, i) => (
              <Row key={i} g={g} fontFamily={fontFamily} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Row({ g, fontFamily }: { g: Gesture; fontFamily: string }) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
      <span
        style={{
          flex: "0 0 126px",
          fontFamily,
          textAlign: "right",
          opacity: 0.95,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {g.input}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {g.says}
        {g.note && (
          <span
            style={{ display: "block", opacity: 0.7, fontSize: 11 }}
          >
            {g.note}
          </span>
        )}
      </span>
    </div>
  );
}
