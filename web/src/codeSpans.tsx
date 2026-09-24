import type { ReactNode } from "react";
import { getCodeFontFamily } from "./layout";
import { tickRuns } from "./ticks";

/** `text` with its `…` spans drawn in the code font (the rule: ticks.ts). */
export function CodeText({ text }: { text: string }): ReactNode {
  const runs = tickRuns(text);
  if (runs.length === 1) return text;
  const fam = getCodeFontFamily();
  return runs.map((r, i) =>
    i % 2 === 0 ? (
      r
    ) : (
      <code
        key={i}
        style={{ fontFamily: fam, fontSize: "0.94em", textTransform: "none" }}
      >
        {r}
      </code>
    ),
  );
}
