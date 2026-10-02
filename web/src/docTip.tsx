import { useState } from "react";
import { createPortal } from "react-dom";
import { cleanMarkdown } from "./proofToTree";
import { CHROME_TEXT_SM, FLOATER_CHROME, Z, chromeScopeProps } from "./theme";

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
            {...chromeScopeProps()}
            style={{
              ...FLOATER_CHROME,
              position: "fixed",
              left: tip.x,
              top: tip.y,
              zIndex: Z.tip,
              maxWidth: 440,
              maxHeight: 280,
              overflow: "hidden",
              pointerEvents: "none",
              fontSize: CHROME_TEXT_SM,
              lineHeight: "15px",
              whiteSpace: "pre-wrap",
            }}
          >
            {cleanDoc(doc)}
          </div>,
          document.body,
        )}
    </span>
  );
}
