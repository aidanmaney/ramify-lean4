// THE APPEARANCE SWITCH (2026-10-04): `ramify.appearance`, `"vscode"` (the
// default — codicons, host tokens, squiggles, fold chevrons, the hop chip) or
// `"classic"` (the skin before those batches — drawn glyphs, the diagnostic
// ribbon, the corner `−`/`+N`, the slanted axis break, `§`). PAINT ONLY: the
// layout engine never reads it, so the tree is the same tree in both (`probe
// fingerprint` is the gate). One value, read through ONE context by a handful
// of seams — `Codicon` (codiconView.tsx, which draws the classic glyph for the
// same semantic name), the hover bar and the `⋯` menu's icons (nodeBar.tsx),
// the diagnostic mark (`DiagMark`, squiggle.tsx), the goal corner and the hop
// mark (ProofTreeView.tsx / topChrome.tsx), the bar's rows and lit items
// (barChrome.tsx), and the token layer (theme.ts, `data-ptw-appearance`).
import { createContext, useContext } from "react";

export type Appearance = "vscode" | "classic";

export const DEFAULT_APPEARANCE: Appearance = "vscode";

/** The setting's value, the harness's `?appearance=` or a viewer link's word:
 `classic` is classic, anything else the default. */
export const parseAppearance = (v: unknown): Appearance =>
  v === "classic" ? "classic" : DEFAULT_APPEARANCE;

export const AppearanceContext = createContext<Appearance>(DEFAULT_APPEARANCE);

/** True under the classic skin. */
export const useClassic = (): boolean =>
  useContext(AppearanceContext) === "classic";
