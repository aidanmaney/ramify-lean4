// The plain-docstring token popup — its own file because the token module
// exports render FUNCTIONS, and react-refresh requires a file defining a
// component to export components only.

import { useState } from "react";
import { createPortal } from "react-dom";

/** Readable form of a docstring for the popup: bold/underscore emphasis and
heading markers stripped, code ticks removed with their content kept (spaces
left ALONE — unlike the comment pipeline's `cleanMarkdown`, whose non-breaking
spaces exist for the label wrapper; a popup wraps freely and NBSP would fight
it). Deliberately not a markdown renderer — the reference text reads fine as
prose, and a renderer is a dependency this popup does not earn. */
function cleanDoc(doc: string): string {
  return doc
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** A token whose hover is a PLAIN docstring (`TacticTokenInfo.doc`) — the
parser-docstring half of the buffer's hover, which no `InteractiveCode` tag can
carry (there is no info node behind it).

The popup follows the diagnostic ribbon's precedent (`hoverDiag`): a custom
element, because a native `<title>` can neither appear immediately nor style
content; `pointer-events: none` throughout; the editorWidget background paired
with `--vscode-icon-foreground` ink — the PILL's exact pair, never a `--ptw-*`
fallback (the recorded light-on-light trap). Portalled to `document.body`: the
span lives inside a `<foreignObject>` whose clip would swallow an absolutely
positioned child, and `getBoundingClientRect` is already in viewport space, so
`position: fixed` needs no zoom or scroll arithmetic. */
export function DocTokenSpan({
  text,
  color,
  doc,
}: {
  text: string;
  color?: string;
  doc: string;
}) {
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      style={{ color, cursor: "help" }}
      onMouseEnter={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setTip({ x: r.left, y: r.bottom + 5 });
      }}
      onMouseLeave={() => setTip(null)}
    >
      {text}
      {tip &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: tip.x,
              top: tip.y,
              zIndex: 100,
              maxWidth: 440,
              maxHeight: 280,
              overflow: "hidden",
              padding: "6px 9px",
              borderRadius: 3,
              background:
                "var(--vscode-editorWidget-background, rgba(255,255,255,0.97))",
              border: "1px solid var(--vscode-editorWidget-border, #c4c8cf)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
              pointerEvents: "none",
              fontFamily: "var(--vscode-font-family, sans-serif)",
              fontSize: 11,
              lineHeight: "15px",
              whiteSpace: "pre-wrap",
              color: "var(--vscode-icon-foreground, #2d3748)",
            }}
          >
            {cleanDoc(doc)}
          </div>,
          document.body,
        )}
    </span>
  );
}
