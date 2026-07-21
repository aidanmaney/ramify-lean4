import type { ReactNode } from "react";
import { InteractiveCode, type CodeWithInfos } from "@leanprover/infoview";
import { ensureTaggedStyle } from "./taggedRender";
import { flattenTaggedText, lineOffsets } from "./taggedText";

// Syntax colouring for tactic node labels (widget only), from the Lean
// server's OWN semantic tokens — the same `collectSyntaxBasedSemanticTokens` +
// `collectInfoBasedSemanticTokens` pair that answers the editor's
// `textDocument/semanticTokens` request (see ProofTreeWidget.lean). So a token
// means here exactly what it means in the editor; we are not re-lexing Lean in
// JavaScript.
//
// Two things make this safe to bolt onto an already-measured layout:
//
// - **Colour only, never geometry.** Tokens change `fill`/`color`, never the
//   text, so the boxes the canvas measurer sized stay correct by construction.
// - **The line-offset match is the guard.** A tactic node's label is
//   Paperproof's `tacticString`, which is *prettified* (first line only, `rw`
//   re-synthesised) and comment-scrubbed, so it often is NOT the verbatim
//   source the tokens index into. `lineOffsets` returns null unless the wrapped
//   label lines are a PREFIX of `text` — which is precisely the case where the
//   token offsets are meaningful. Any mismatch falls back to plain text.
//   (Prefix rather than exact because Paperproof prettifies a structured tactic
//   to its first line, so `induction n with` is a prefix of a source range that
//   runs on for the whole `with` block.)

/** An LSP position, as the wire carries it. */
interface LspPos {
  line: number;
  character: number;
}

/** One semantic token inside a tactic's tight range (ProofTreeComments.lean
`TacticToken`): absolute document positions plus the token type's name. */
export interface TacticToken {
  start: LspPos;
  stop: LspPos;
  type: string;
}

/** A token's hover popup (ProofTreeWidget.lean `TacticTokenInfo`): the token's
span plus tagged text carrying the info node the editor's own hover would use.
Rendering it with `InteractiveCode` gives the native type popup. */
export interface TacticTokenInfo {
  start: LspPos;
  stop: LspPos;
  code: CodeWithInfos;
}

// VS Code's DEFAULT LIGHT theme token colours, hardcoded rather than taken from
// the `--vscode-symbolIcon-*` theme variables on purpose: node fills in this
// widget are fixed light pastels (NODE_STYLES), so theme-following token
// colours would go light-on-light and vanish in a dark theme. Unmapped token
// types inherit the label's own colour.
const TOKEN_COLOR: Record<string, string> = {
  keyword: "#af00db",
  function: "#795e26",
  variable: "#001080",
  property: "#0451a5",
  number: "#098658",
  string: "#a31515",
  comment: "#008000",
  type: "#267f99",
  namespace: "#267f99",
  leanSorryLike: "#c53030",
};

/**
 * Offsets into `text` of every token, given that `text` starts at document
 * position `origin`. Returns null for any token that doesn't land inside the
 * text (a stale range after an edit), so the caller can bail wholesale.
 */
interface TokenSpan {
  start: number;
  end: number;
  type: string;
  info?: CodeWithInfos;
}

function tokenSpans(
  text: string,
  origin: LspPos,
  tokens: TacticToken[],
  infoAt: Map<string, CodeWithInfos>,
): TokenSpan[] | null {
  // Start offset of each line of `text`; line i of `text` is document line
  // origin.line + i, and only line 0 is shifted by origin.character.
  const lineStart = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\n") lineStart.push(i + 1);
  const offsetOf = (p: LspPos): number | null => {
    const row = p.line - origin.line;
    if (row < 0 || row >= lineStart.length) return null;
    const col = row === 0 ? p.character - origin.character : p.character;
    if (col < 0) return null;
    const off = lineStart[row] + col;
    return off <= text.length ? off : null;
  };
  const out: TokenSpan[] = [];
  for (const t of tokens) {
    const start = offsetOf(t.start);
    const end = offsetOf(t.stop);
    if (start === null || end === null || end <= start) return null;
    out.push({
      start,
      end,
      type: t.type,
      info: infoAt.get(`${t.start.line}:${t.start.character}`),
    });
  }
  return out;
}

/**
 * One ReactNode per wrapped label line, coloured by token — or null to keep the
 * plain SVG text (the label isn't the verbatim source, or the tokens are
 * stale). Lines are non-wrapping by construction: they are the very strings the
 * layout measured, cut at the layout's own break offsets.
 */
export function renderTacticTokens(
  text: string,
  origin: LspPos,
  tokens: TacticToken[],
  lines: string[],
  // Indexed by `line:character` of the token START, over the WHOLE proof.
  // Built once by the caller: tactic ranges nest, so there is no correct way to
  // pre-split this per tactic (see widget.tsx), and rebuilding it per node per
  // render would be pure waste.
  infoAt: Map<string, CodeWithInfos> = new Map(),
): ReactNode[] | null {
  if (tokens.length === 0) return null;
  ensureTaggedStyle(); // the .ptw-tagged font normalisation, shared with goals
  // Prefix match, not exact: `tacticString` is the first line of a structured
  // tactic, so the label is a prefix of the verbatim source. Tokens past the
  // matched prefix intersect no line and are ignored.
  const offsets = lineOffsets(text, lines, true);
  if (!offsets) return null;
  const spans = tokenSpans(text, origin, tokens, infoAt);
  if (!spans) return null;

  return offsets.map(([lo, hi], i) => {
    const parts: ReactNode[] = [];
    let cur = lo; // next uncoloured offset within this line
    for (const s of spans) {
      const a = Math.max(s.start, lo);
      const b = Math.min(s.end, hi);
      if (a >= b || a < cur) continue; // outside this line, or already covered
      if (a > cur) parts.push(text.slice(cur, a));
      const slice = text.slice(a, b);
      // The interactive form is used only when its own text is EXACTLY the
      // slice being drawn — the same equality guard the goal labels use. It
      // fails for a token straddling a wrap (this line holds only part of it),
      // and then that piece renders as plain coloured text: tooltip lost,
      // geometry intact.
      const code = s.info;
      const interactive =
        code !== undefined && flattenTaggedText(code) === slice;
      const body = interactive ? (
        <span className="ptw-tagged">
          <InteractiveCode fmt={code} />
        </span>
      ) : (
        slice
      );
      const color = TOKEN_COLOR[s.type];
      parts.push(
        color || interactive ? (
          <span key={`${a}`} style={color ? { color } : undefined}>
            {body}
          </span>
        ) : (
          body
        ),
      );
      cur = b;
    }
    if (cur < hi) parts.push(text.slice(cur, hi));
    return <span key={i}>{parts}</span>;
  });
}
