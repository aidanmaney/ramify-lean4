// The squiggle's hover: a node's diagnostics beneath its box, as the
// editor's hover shows them. Split out of ProofTreeView.tsx.
import { NODE_PAD, bandTopH, getCodeFontFamily } from "./layout";
import { splitLinterName } from "./diagnostics";
import { CodeText } from "./codeSpans";
import { lintName } from "./lints";
import {
  HOVER_BG,
  HOVER_BORDER,
  HOVER_FG,
  chromeSurface,
  CHROME_FONT,
  DIM_OPACITY,
  CHROME_TEXT_SM,
  CHROME_TEXT,
} from "./theme";
import { DiagIcon } from "./diagBar";
import { POPUP_CHROME } from "./theme";
import type { AttachedDiagnostics } from "./diagnostics";
import type { PlacedNode } from "./types";

export function DiagPopover({
  hoverDiag,
  diag,
  placed,
}: {
  hoverDiag: string;
  diag: AttachedDiagnostics | null;
  placed: ReadonlyMap<string, PlacedNode>;
}) {
  const dn = placed.get(hoverDiag);
  const list = diag?.byNode.get(hoverDiag);
  if (!dn || !list || list.length === 0) return null;
  const { w, h } = dn.data;
  const boxTop = (bandTopH(dn.data) - h) / 2;
  return (
    <foreignObject
      x={dn.x - w / 2 + NODE_PAD}
      y={dn.y + boxTop + h + 4}
      width={1}
      height={1}
      style={{ overflow: "visible", pointerEvents: "none" }}
    >
      <div
        style={{
          // The editor's own diagnostic hover: the hover
          // widget's surface, border and ink.
          ...POPUP_CHROME,
          background: chromeSurface(HOVER_BG),
          width: "max-content",
          maxWidth: 460,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: HOVER_BORDER,
        }}
      >
        {list.map((d, i) => {
          // A LINT reads as VS Code's hover does (2026-10-05):
          // the linter's sentence in the UI face with its
          // `code` spans in the code font (ticks.ts, the one
          // rule), and the linter's name moved OUT of the
          // sentence into a dim source line under it. Errors
          // and warnings are Lean's own text (goals and all),
          // kept as they are, in the code font.
          const lint = d.linter ? splitLinterName(d.message) : null;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 6,
                alignItems: "flex-start",
              }}
            >
              <DiagIcon sev={d.severity} size={15} />
              {lint ? (
                <span
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    fontFamily: CHROME_FONT,
                    fontSize: CHROME_TEXT,
                    lineHeight: "16px",
                    whiteSpace: "pre-wrap",
                    color: HOVER_FG,
                  }}
                >
                  <span>
                    <CodeText text={lint.text} />
                  </span>
                  <span
                    data-ptw-diag-source=""
                    style={{ opacity: DIM_OPACITY, fontSize: CHROME_TEXT_SM }}
                  >
                    {`Lean 4 · ${lint.name ?? lintName(d.linter!)}`}
                  </span>
                </span>
              ) : (
                <span
                  style={{
                    fontFamily: getCodeFontFamily(),
                    fontSize: CHROME_TEXT_SM,
                    lineHeight: "15px",
                    whiteSpace: "pre-wrap",
                    color: HOVER_FG,
                  }}
                >
                  {d.message}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </foreignObject>
  );
}
