// The plain-docstring token popup — its own file because the token module
// exports render FUNCTIONS, and react-refresh requires a file defining a
// component to export components only.

import { useState } from "react";
import { createPortal } from "react-dom";
import { cleanMarkdown } from "./proofToTree";
import { POPUP_CHROME } from "./theme";

/** Readable form of a docstring for the popup: the comment pipeline's
`cleanMarkdown` with `breakableCode` — code ticks removed with their content's
spaces left ALONE (the NBSP joining exists for the label wrapper; a popup
wraps freely and NBSP would fight it). Deliberately not a markdown renderer —
the reference text reads fine as prose, and a renderer is a dependency this
popup does not earn. */
const cleanDoc = (doc: string): string =>
  cleanMarkdown(doc, { breakableCode: true }).trim();

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
              ...POPUP_CHROME,
              position: "fixed",
              left: tip.x,
              top: tip.y,
              zIndex: 100,
              maxWidth: 440,
              maxHeight: 280,
              overflow: "hidden",
              border: "1px solid var(--vscode-editorWidget-border, #c4c8cf)",
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
