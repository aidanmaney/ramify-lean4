import { useState } from "react";
import { createPortal } from "react-dom";
import { cleanMarkdown } from "./proofToTree";
import { POPUP_CHROME } from "./theme";

const cleanDoc = (doc: string): string =>
  cleanMarkdown(doc, { breakableCode: true }).trim();

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
