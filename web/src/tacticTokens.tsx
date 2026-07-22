import type { ReactNode } from "react";
import { InteractiveCode, type CodeWithInfos } from "@leanprover/infoview";
import { ensureTaggedStyle } from "./taggedRender";
import { flattenTaggedText, lineOffsets } from "./taggedText";
import { TOKEN_COLOR } from "./theme";

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
// - **The LABEL is the coordinate space.** The wrapped lines were measured from
//   the node's label, so offsets are resolved against the label
//   (`lineOffsets` exact — the same contract goal labels use) and the token
//   space is aligned INTO it by `alignInLabel`. Any failure to align falls back
//   to plain text for the whole node.
//
// The alignment exists because Paperproof's `tacticString` is a *display*
// string, not the source: it is prettified, comment-scrubbed, and for some
// tactics re-synthesised outright, so the label and the verbatim source of the
// step's range can disagree in either direction (see alignInLabel).

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
START (its extent already rides `TacticToken` on the edit entry — the join is
by start alone) plus tagged text carrying the info node the editor's own hover
would use. Rendering it with `InteractiveCode` gives the native type popup. */
export interface TacticTokenInfo {
  start: LspPos;
  code: CodeWithInfos;
}

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

/** A region where the source and the label are known to agree character for
character: `len` chars from `srcAt` in the source are `len` chars from
`labelAt` in the label. Tokens are shifted through whichever segment holds
them and clipped to it — outside one the two texts diverge, and a token there
would colour a character it doesn't own. */
export interface AlignSegment {
  labelAt: number;
  srcAt: number;
  len: number;
}

/** Longest common prefix length of two strings. */
function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/**
 * How the step's verbatim source `text` maps onto the node's `label`, as
 * agreeing segments — or null when the two can't be reconciled at all (then
 * the node renders plain).
 *
 * Paperproof's `tacticString` is a DISPLAY string, so it disagrees with the
 * source in ways that are all present in `proofs/`:
 *
 * - **Label is a prefix of the source** — a structured tactic is prettified to
 *   its first line, so `induction n with` fronts a range running to the end of
 *   the `with` block. Tokens past the label are clipped.
 * - **Source is a prefix of the label** — consecutive binders are merged for
 *   display (`intro p hpm`) while the step's range covers just `intro p`. The
 *   un-covered tail stays uncoloured.
 * - **Label is the source with one rule kept** — `rw` is re-synthesised per
 *   rewrite rule, so a step of `rw [List.prod_append, hl₁prod, ← hk]` is
 *   labelled `rw [hl₁prod]`. Neither string contains the other, and this is
 *   the case that needs TWO segments: the shared `rw [` head, then the rule
 *   itself wherever it sits in the real bracket list. A single-window
 *   alignment could only ever cover one of the two, and covering the rule
 *   alone is what left `rw` with no colour and no docstring popup.
 */
export function alignInLabel(
  text: string,
  label: string,
): AlignSegment[] | null {
  if (label.startsWith(text)) return [{ labelAt: 0, srcAt: 0, len: text.length }];
  // Structured tactic: the label is the source's first line, so only the label
  // is covered and the rest of the range is clipped away.
  if (text.startsWith(label))
    return [{ labelAt: 0, srcAt: 0, len: label.length }];
  // `indexOf` takes the FIRST occurrence. With a repeated rule (`rw [h, h]`)
  // that can pick the wrong one, but both slices are the same text and the
  // same token type, so the only visible difference is which one carries the
  // tooltip — and geometry is untouched either way.
  const at = label.indexOf(text);
  if (at >= 0) return [{ labelAt: at, srcAt: 0, len: text.length }];
  // Shared head, then the label's tail located in the source. The tail is
  // stripped of the closers the display string adds back (`rw [hl₁prod]` vs
  // `hl₁prod,` in the source) before matching, and only the matched part is
  // claimed.
  const head = commonPrefix(text, label);
  if (head > 0) {
    const tail = label.slice(head).replace(/[\s,;)\]}⟩]+$/, "");
    // The FIRST rule of a list needs no second segment: the shared head
    // already runs through it (`rw [List.prod_append` is common to both), and
    // what's left of the label is the closer the display string added back.
    const srcAt = tail ? text.indexOf(tail, head) : -1;
    return srcAt >= 0
      ? [
          { labelAt: 0, srcAt: 0, len: head },
          { labelAt: head, srcAt, len: tail.length },
        ]
      : [{ labelAt: 0, srcAt: 0, len: head }];
  }
  // Last resort, kept for a source that trails a separator the label can't
  // contain and shares no head with it.
  const trimmed = text.replace(/[\s,;]+$/, "");
  if (trimmed && trimmed !== text) {
    const trimmedAt = label.indexOf(trimmed);
    if (trimmedAt >= 0)
      return [{ labelAt: trimmedAt, srcAt: 0, len: trimmed.length }];
  }
  return null;
}

/** The slice of a `TacticEdit` entry the renderer needs. */
export interface TacticTokenSource {
  start: LspPos;
  text: string;
  tokens?: TacticToken[];
}

/**
 * A tactic-label renderer with a per-node result cache — the factory
 * counterpart of `makeTaggedRenderers`. The view calls the renderer for EVERY
 * visible tactic on EVERY render (each hover enter/leave, zoom tick and
 * editing keystroke), and un-cached each call re-ran
 * `alignInLabel`/`tokenSpans` and rebuilt the ReactNode tree. The cache lives
 * in this closure, so it drops exactly when the caller rebuilds the renderer
 * (its inputs — the edit entries and token popups — refreshed); the key
 * carries the label and the wrapped lines too, because a font change
 * re-measures lines without touching those inputs. Returning the identical
 * array also lets React bail on reconciling unchanged labels.
 */
export function makeTacticRenderer(
  editAt: (p: { start: LspPos }) => TacticTokenSource | undefined,
  infoAt: Map<string, CodeWithInfos>,
): (
  p: { start: LspPos },
  label: string,
  lines: string[],
) => ReactNode[] | null {
  const cache = new Map<string, ReactNode[] | null>();
  return (p, label, lines) => {
    const e = editAt(p);
    if (!e?.tokens) return null;
    // NUL-joined: a space separator would collide `"a b"+["c"]` with
    // `"a"+["b c"]`, and a rewrap that only moves a line break must miss.
    const key = [
      `${p.start.line}:${p.start.character}`,
      label,
      ...lines,
    ].join("\u0000");
    let out = cache.get(key);
    if (out === undefined) {
      out = renderTacticTokens(e.text, e.start, e.tokens, label, lines, infoAt);
      cache.set(key, out);
    }
    return out;
  };
}

/**
 * One ReactNode per wrapped label line, coloured by token — or null to keep the
 * plain SVG text (the source can't be aligned into the label, or the tokens are
 * stale). Lines are non-wrapping by construction: they are the very strings the
 * layout measured, cut at the layout's own break offsets.
 */
export function renderTacticTokens(
  text: string,
  origin: LspPos,
  tokens: TacticToken[],
  label: string,
  lines: string[],
  // Indexed by `line:character` of the token START, over the WHOLE proof.
  // Built once by the caller: tactic ranges nest, so there is no correct way to
  // pre-split this per tactic (see widget.tsx), and rebuilding it per node per
  // render would be pure waste.
  infoAt: Map<string, CodeWithInfos> = new Map(),
): ReactNode[] | null {
  if (tokens.length === 0) return null;
  ensureTaggedStyle(); // the .ptw-tagged font normalisation, shared with goals
  // Exact: `lines` is `wrapText(label)`, so the label reconstructs them by
  // construction (the same contract goal labels rely on).
  const offsets = lineOffsets(label, lines);
  if (!offsets) return null;
  // Tokens carry absolute document positions, so they resolve against `text`
  // (the source they index into); shifting by the alignment moves them into
  // label space, where the lines live. Spans landing outside the label are
  // clipped away per line below.
  const align = alignInLabel(text, label);
  if (!align) return null;
  const raw = tokenSpans(text, origin, tokens, infoAt);
  if (!raw) return null;
  // Each token belongs to at most one agreeing segment: the one holding its
  // start. Its end is clipped to that segment, since past it the two texts
  // part company.
  const spans = raw.flatMap((s) => {
    const seg = align.find(
      (g) => s.start >= g.srcAt && s.start < g.srcAt + g.len,
    );
    if (!seg) return [];
    const shift = seg.labelAt - seg.srcAt;
    return [
      {
        ...s,
        start: s.start + shift,
        end: Math.min(s.end, seg.srcAt + seg.len) + shift,
      },
    ];
  });
  // Segments are emitted head-first, but tokens within them are not
  // necessarily in label order (a rule further down the bracket list maps to
  // an earlier label offset than a token after it in the source).
  spans.sort((a, b) => a.start - b.start);

  return offsets.map(([lo, hi], i) => {
    const parts: ReactNode[] = [];
    let cur = lo; // next uncoloured offset within this line
    for (const s of spans) {
      const a = Math.max(s.start, lo);
      const b = Math.min(s.end, hi);
      if (a >= b || a < cur) continue; // outside this line, or already covered
      if (a > cur) parts.push(label.slice(cur, a));
      const slice = label.slice(a, b);
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
    if (cur < hi) parts.push(label.slice(cur, hi));
    return <span key={i}>{parts}</span>;
  });
}
