import type { ReactNode } from "react";
import { InteractiveCode, type CodeWithInfos } from "@leanprover/infoview";
import { DocTokenSpan } from "./docTip";
import { ensureTaggedStyle } from "./taggedRender";
import { flattenTaggedText, lineOffsets } from "./taggedText";
import { TOKEN_COLOR } from "./theme";
import { type KeepSeg, elisionsOf, mapRange } from "./briefLabel";

/** A span to draw on a wrapped line: a coloured token (`type`, optional hover
`info`), or a `…` elision marker (`ellipsis` = the source it hid). Offsets are
in collapsed-label space. */
interface RenderSpan {
  start: number;
  end: number;
  type?: string;
  info?: CodeWithInfos;
  doc?: string;
  ellipsis?: string;
}

/** Brief-mode elision carried on a tactic node (see types.ts `TreeNode.elision`
and briefLabel.ts): the original label plus the KEEP map onto the collapsed one.
Tokens are aligned against `original`, then shifted onto the collapsed label. */
export interface Elision {
  original: string;
  keep: KeepSeg[];
}

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
by start alone) plus EXACTLY ONE of two payloads, decided server-side the way
`handleHover` decides it. `code` is tagged text carrying the info node the
editor's hover would use — `InteractiveCode` renders the native type popup.
`doc` is a PARSER DOCSTRING, plain markdown: what the buffer shows on `by`,
where the docstring lives on a syntax KIND rather than on any info node, so
there is no ref to tag. */
export interface TacticTokenInfo {
  start: LspPos;
  code?: CodeWithInfos;
  doc?: string;
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
  doc?: string;
}

function tokenSpans(
  text: string,
  origin: LspPos,
  tokens: TacticToken[],
  infoAt: Map<string, TacticTokenInfo>,
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
    const hover = infoAt.get(`${t.start.line}:${t.start.character}`);
    out.push({
      start,
      end,
      type: t.type,
      // ?? undefined: a Lean-side Option can arrive as JSON null, and the
      // render branch keys on undefined.
      info: hover?.code ?? undefined,
      doc: hover?.doc ?? undefined,
    });
  }
  return out;
}

/** A span of the LABEL that the source does not contain (ProofTreeComments.lean
`LabelToken`). Its offset is already in label space — the coordinate space
everything here resolves into — so it needs no alignment; what it needs instead
is the equality guard below, since a label fix-up applied after the server
measured would otherwise shift it onto someone else's characters.

There is exactly one producer today: the `rfl` of a `rw [rfl]` node, the closing
`rfl` `rw`'s macro appends, whose step is harvested at the bare `]` and whose
word therefore indexes into no source at all (see the Lean-side
`rwClosingRflLabel` for the measurements). */
export interface LabelToken {
  labelAt: number;
  text: string;
  type: string;
  doc: string;
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

// Bracket-pair colourisation: the editor paints brackets by NESTING DEPTH,
// cycling six workbench colours, and it does so on top of tokens as a separate
// mechanism (`editor.bracketPairColorization.enabled`, on by default). For Lean
// it is the ONLY thing colouring a bracket — measured, the characters left with
// no semantic token at all in `calc (a + b) ^ 2` are exactly `( + ) ^ 2`, and
// the lean4 TextMate grammar has no bracket rule either. So without this the
// tree's brackets are plain foreground while the buffer's are coloured, which
// is the last visible difference between the two.
//
// The six colours are workbench REGISTRY entries, so unlike token colours they
// ARE exposed to a webview as `--vscode-*` and need no companion round trip;
// only the on/off setting does.
const BRACKET_PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "⟨": "⟩",
  "⟦": "⟧",
  "⦃": "⦄",
};
const CLOSERS = new Set(Object.values(BRACKET_PAIRS));

/** Nesting depth per character, or null where the character is not a bracket.
Computed over the WHOLE label so depth carries across a wrapped line, and with a
STACK rather than a counter so a closer that matches nothing is left uncoloured
instead of dragging the rest of the line down a level. */
function bracketDepths(text: string): (number | null)[] {
  const out: (number | null)[] = new Array(text.length).fill(null);
  const stack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (BRACKET_PAIRS[c]) {
      out[i] = stack.length;
      stack.push(BRACKET_PAIRS[c]);
    } else if (CLOSERS.has(c)) {
      // Only a matching closer pops; `⟩` against an open `(` is a mismatch and
      // the editor renders it as unexpected, not as depth-0.
      if (stack.length > 0 && stack[stack.length - 1] === c) {
        stack.pop();
        out[i] = stack.length;
      }
    }
  }
  return out;
}

/** The slice of a `TacticEdit` entry the renderer needs. */
export interface TacticTokenSource {
  start: LspPos;
  text: string;
  tokens?: TacticToken[];
  labelTokens?: LabelToken[];
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
  infoAt: Map<string, TacticTokenInfo>,
  // Mirrors `editor.bracketPairColorization.enabled`; the widget learns it from
  // the companion, since it is a SETTING rather than a colour and so is not in
  // the `--vscode-*` set.
  colorBrackets = false,
): (
  p: { start: LspPos },
  label: string,
  lines: string[],
  elision?: Elision,
) => ReactNode[] | null {
  const cache = new Map<string, ReactNode[] | null>();
  return (p, label, lines, elision) => {
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
      out = renderTacticTokens(
        e.text,
        e.start,
        e.tokens,
        label,
        lines,
        infoAt,
        elision,
        colorBrackets,
        e.labelTokens,
      );
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
  infoAt: Map<string, TacticTokenInfo> = new Map(),
  // Present in brief mode: `label`/`lines` are the COLLAPSED text, and this
  // carries the ORIGINAL label + the KEEP map. Tokens are aligned against the
  // original (their positions index into it), then shifted onto the collapsed
  // label through the KEEP map — a span landing in an elided gap drops.
  elision?: Elision,
  colorBrackets = false,
  // Spans stated in LABEL space rather than source space — see `LabelToken`.
  // They need no alignment (they are already in the coordinate space
  // everything else is being mapped INTO) but they do need the equality guard,
  // which is applied below.
  labelTokens: LabelToken[] = [],
): ReactNode[] | null {
  if (tokens.length === 0 && labelTokens.length === 0) return null;
  ensureTaggedStyle(); // the .ptw-tagged font normalisation, shared with goals
  // Exact: `lines` is `wrapText(label)`, so the (collapsed) label reconstructs
  // them by construction (the same contract goal labels rely on).
  const offsets = lineOffsets(label, lines);
  if (!offsets) return null;
  // Align tokens against the label their positions actually index into: the
  // ORIGINAL label in brief mode, else the label itself.
  const alignLabel = elision ? elision.original : label;
  const align = alignInLabel(text, alignLabel);
  if (!align) return null;
  const raw = tokenSpans(text, origin, tokens, infoAt);
  if (!raw) return null;
  // Each token belongs to at most one agreeing segment: the one holding its
  // start. Its end is clipped to that segment, since past it the two texts
  // part company. In brief mode a second shift, through the KEEP map, moves the
  // span from original-label space to collapsed-label space (dropping any that
  // land in a `…`).
  const spans: RenderSpan[] = raw.flatMap((s): RenderSpan[] => {
    const seg = align.find(
      (g) => s.start >= g.srcAt && s.start < g.srcAt + g.len,
    );
    if (!seg) return [];
    const shift = seg.labelAt - seg.srcAt;
    let start = s.start + shift;
    let end = Math.min(s.end, seg.srcAt + seg.len) + shift;
    if (elision) {
      const m = mapRange(elision.keep, start, end);
      if (!m) return [];
      start = m.start;
      end = m.end;
    }
    return [{ start, end, type: s.type, info: s.info, doc: s.doc }];
  });
  // Label-space spans join here, past the alignment that has nothing to say
  // about them. The guard is text equality against the label the offsets were
  // measured in — the same discipline the tagged goal labels use, and the only
  // thing standing between a label fix-up the server did not see and a span
  // that colours the wrong characters. In brief mode they take the same shift
  // through the KEEP map as everything else, so a collapsed `rw …` simply
  // drops the span with the word it hid.
  for (const lt of labelTokens) {
    if (alignLabel.slice(lt.labelAt, lt.labelAt + lt.text.length) !== lt.text)
      continue;
    let start = lt.labelAt;
    let end = lt.labelAt + lt.text.length;
    if (elision) {
      const m = mapRange(elision.keep, start, end);
      if (!m) continue;
      start = m.start;
      end = m.end;
    }
    spans.push({ start, end, type: lt.type, doc: lt.doc });
  }
  // Each `…` in the collapsed label is a titled pseudo-span, so the emit loop
  // draws it muted with the elided source as a hover tooltip.
  if (elision)
    for (const e of elisionsOf({
      text: label,
      keep: elision.keep,
      original: elision.original,
    }))
      spans.push({ start: e.outAt, end: e.outAt + 1, ellipsis: e.hidden });
  // Segments are emitted head-first, but tokens within them are not
  // necessarily in label order (a rule further down the bracket list maps to
  // an earlier label offset than a token after it in the source).
  spans.sort((a, b) => a.start - b.start);

  // Only the runs NO token claimed can hold a bracket, so this is applied to
  // exactly those — it can never override a token's own colour.
  const depths = colorBrackets ? bracketDepths(label) : null;
  const plain = (from: number, to: number): ReactNode[] => {
    if (!depths) return [label.slice(from, to)];
    const out: ReactNode[] = [];
    let run = from;
    for (let k = from; k < to; k++) {
      if (depths[k] === null) continue;
      if (k > run) out.push(label.slice(run, k));
      out.push(
        <span
          key={`b${k}`}
          style={{
            color: `var(--vscode-editorBracketHighlight-foreground${(depths[k]! % 6) + 1})`,
          }}
        >
          {label[k]}
        </span>,
      );
      run = k + 1;
    }
    if (run < to) out.push(label.slice(run, to));
    return out;
  };

  return offsets.map(([lo, hi], i) => {
    const parts: ReactNode[] = [];
    let cur = lo; // next uncoloured offset within this line
    for (const s of spans) {
      const a = Math.max(s.start, lo);
      const b = Math.min(s.end, hi);
      if (a >= b || a < cur) continue; // outside this line, or already covered
      if (a > cur) parts.push(...plain(cur, a));
      const slice = label.slice(a, b);
      // A `…`: muted, with the text it replaced as a native hover tooltip.
      if (s.ellipsis !== undefined) {
        parts.push(
          <span
            key={`${a}`}
            title={s.ellipsis}
            style={{ color: "var(--ptw-comment)", cursor: "help" }}
          >
            {slice}
          </span>,
        );
        cur = b;
        continue;
      }
      // A parser-docstring token renders as a PLAIN coloured span with the
      // custom popup — never `InteractiveCode`, whose tag popup is exactly
      // the empty or wrong one the doc replaced. Clipped-by-wrap pieces keep
      // the popup (unlike the equality-guarded interactive form below, a
      // plain string cannot disagree with what was measured).
      if (s.doc !== undefined) {
        const color = s.type ? TOKEN_COLOR[s.type] : undefined;
        parts.push(
          <DocTokenSpan key={`${a}`} text={slice} color={color} doc={s.doc} />,
        );
        cur = b;
        continue;
      }
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
      const color = s.type ? TOKEN_COLOR[s.type] : undefined;
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
    if (cur < hi) parts.push(...plain(cur, hi));
    return <span key={i}>{parts}</span>;
  });
}
