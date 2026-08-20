import {
  GESTURES,
  GESTURE_SECTIONS,
  type Caps,
  type Gesture,
} from "./gestures";
import { POPUP_CHROME } from "./theme";

/** The PILL's exact ink, paired with POPUP_CHROME's background — never a
`--ptw-*` fallback, which follows the PAGE theme while that background's
fallback is light. Measured here before it shipped: `--vscode-editorWidget-
foreground` is undefined in the standalone app, so the `--ptw-fg` fallback gave
`rgb(230,230,230)` on `rgba(255,255,255,0.97)`. That is the recorded
light-on-light trap, third occurrence. */
const INK = "var(--vscode-icon-foreground, #2d3748)";

/**
 * The gesture reference — everything the tree can do, in one scrollable panel.
 *
 * It exists because the vocabulary had nowhere else to live. A node's `<title>`
 * is covered by its own tagged label in the infoview, so five of the six
 * modifier gestures were announced only in the dev harness; the marquee drag
 * that gates ten source-writing verbs was announced nowhere at all. The rail's
 * tooltips teach the rail and nothing else.
 *
 * Every row comes from `GESTURES` — the same table `nodeHints` reads for the
 * per-node tooltip — filtered by what the HOST offers, so the standalone app
 * shows a shorter and still-true list rather than promising an editor it has
 * no hooks for.
 *
 * Two things it deliberately does not do. It does not enumerate the rail:
 * twenty buttons that each already have a working tooltip would be the biggest
 * drift surface in the panel, so it says how the rail works and stops. And it
 * does not animate — a hidden webview fires no animation frames, so anything
 * that faded in could fail to arrive at all.
 */
export function HelpPanel({
  caps,
  fontFamily,
  onClose,
}: {
  caps: Caps;
  /** The editor's own code font, for the input column — these are keys and
  glyphs, and they read as such only in the font the buffer uses. */
  fontFamily: string;
  onClose: () => void;
}) {
  const shown = GESTURES.filter((g) => !g.needs || caps[g.needs]);
  return (
    <div
      // Stops a click inside the panel reaching the scroll container's
      // background handler, which would close the panel out from under the
      // pointer as you scrolled it. (`[data-ptw-edit]` does the same for the
      // in-place editor.)
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        right: "100%",
        marginRight: 4,
        // Anchored to the button's BOTTOM, so the panel grows UP the rail. The
        // `?` is the last button on it, so hanging it from the top put 342px of
        // a 504px panel below a 720px viewport (measured). Growing up, its top
        // lands near the rail's own top, which is where the room is.
        bottom: 0,
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
        cursor: "default",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          // No title: the section headings say what each group is and the rail
          // button that opens this says what the panel is, so a heading here
          // only repeated them. With the ✕ alone in the row, `flex-end` is
          // what keeps it in its corner — `space-between` puts a lone child at
          // the START, which would have parked it on the left.
          justifyContent: "flex-end",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <button
          type="button"
          title="Close (Esc, or ?)"
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

/** One gesture: the input in a fixed gutter so the column of them reads as a
key list, then what it does, then any caveat on its own dimmer line. */
function Row({ g, fontFamily }: { g: Gesture; fontFamily: string }) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
      <span
        style={{
          // Wide enough for the longest input, `⌥-click (or Esc)` — at 104 it
          // ellipsized to `⌥-click (or E…`, which is the one row where the
          // second way out was the whole point.
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
