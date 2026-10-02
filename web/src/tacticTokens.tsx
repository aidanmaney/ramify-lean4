// Tactic labels bound to the infoview's `InteractiveCode`: the widget's live
// token hovers. The logic is `tacticCore.tsx`'s, shared with the static
// viewer; this file and `taggedRender.tsx` are the only ones that import the
// infoview.
import { createElement, type ReactNode } from "react";
import {
  InteractiveCode,
  type CodeWithInfos,
  type SubexprInfo,
} from "@leanprover/infoview";
import type { KeepSeg, Mark } from "./briefLabel";
import {
  makeTacticRendererWith,
  renderTacticTokensWith,
  type Elision,
  type LabelToken,
  type TacticToken,
  type TacticTokenInfoOf,
  type TacticTokenSource,
} from "./tacticCore";
import type { TaggedText } from "./taggedText";

export type TacticTokenInfo = TacticTokenInfoOf<SubexprInfo>;

// `createElement`, not JSX: a module-level arrow returning JSX reads to the
// fast-refresh lint as a component, and this module exports functions.
const interactive = (fmt: TaggedText<SubexprInfo>) =>
  createElement(InteractiveCode, { fmt: fmt as CodeWithInfos });

interface LspPos {
  line: number;
  character: number;
}

export function makeTacticRenderer(
  editAt: (p: { start: LspPos }) => TacticTokenSource | undefined,
  infoAt: Map<string, TacticTokenInfo>,
  colorBrackets = false,
): (
  p: { start: LspPos },
  label: string,
  lines: string[],
  elision?: Elision,
) => ReactNode[] | null {
  return makeTacticRendererWith(interactive, editAt, infoAt, colorBrackets);
}

export function renderTacticTokens(
  text: string,
  origin: LspPos,
  tokens: TacticToken[],
  label: string,
  lines: string[],
  infoAt: Map<string, TacticTokenInfo> = new Map(),
  elision?: { original: string; keep: KeepSeg[]; marks: Mark[] },
  colorBrackets = false,
  labelTokens: LabelToken[] = [],
): ReactNode[] | null {
  return renderTacticTokensWith(
    interactive,
    text,
    origin,
    tokens,
    label,
    lines,
    infoAt,
    elision,
    colorBrackets,
    labelTokens,
  );
}
