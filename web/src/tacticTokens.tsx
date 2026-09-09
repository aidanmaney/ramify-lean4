import type { ReactNode } from "react";
import { InteractiveCode, type CodeWithInfos } from "@leanprover/infoview";
import { DocTokenSpan } from "./docTip";
import { ensureTaggedStyle } from "./taggedRender";
import { flattenTaggedText, lineOffsets } from "./taggedText";
import { TOKEN_COLOR } from "./theme";
import { type KeepSeg, type Mark, mapRange } from "./briefLabel";

interface RenderSpan {
  start: number;
  end: number;
  type?: string;
  info?: CodeWithInfos;
  doc?: string;
  ellipsis?: string;
}

export interface Elision {
  original: string;
  keep: KeepSeg[];

  marks: Mark[];
}

interface LspPos {
  line: number;
  character: number;
}

export interface TacticToken {
  start: LspPos;
  stop: LspPos;
  type: string;
}

export interface TacticTokenInfo {
  start: LspPos;
  code?: CodeWithInfos;
  doc?: string;
}

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

      info: hover?.code ?? undefined,
      doc: hover?.doc ?? undefined,
    });
  }
  return out;
}

export interface LabelToken {
  labelAt: number;
  text: string;
  type: string;
  doc: string;
}

export interface AlignSegment {
  labelAt: number;
  srcAt: number;
  len: number;
}

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

export function alignInLabel(
  text: string,
  label: string,
): AlignSegment[] | null {
  if (label.startsWith(text)) return [{ labelAt: 0, srcAt: 0, len: text.length }];

  if (text.startsWith(label))
    return [{ labelAt: 0, srcAt: 0, len: label.length }];

  const at = label.indexOf(text);
  if (at >= 0) return [{ labelAt: at, srcAt: 0, len: text.length }];

  const head = commonPrefix(text, label);
  if (head > 0) {
    const tail = label.slice(head).replace(/[\s,;)\]}⟩]+$/, "");

    const srcAt = tail ? text.indexOf(tail, head) : -1;
    return srcAt >= 0
      ? [
          { labelAt: 0, srcAt: 0, len: head },
          { labelAt: head, srcAt, len: tail.length },
        ]
      : [{ labelAt: 0, srcAt: 0, len: head }];
  }

  const trimmed = text.replace(/[\s,;]+$/, "");
  if (trimmed && trimmed !== text) {
    const trimmedAt = label.indexOf(trimmed);
    if (trimmedAt >= 0)
      return [{ labelAt: trimmedAt, srcAt: 0, len: trimmed.length }];
  }
  return null;
}

const BRACKET_PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "⟨": "⟩",
  "⟦": "⟧",
  "⦃": "⦄",
};
const CLOSERS = new Set(Object.values(BRACKET_PAIRS));

function bracketDepths(text: string): (number | null)[] {
  const out: (number | null)[] = new Array(text.length).fill(null);
  const stack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (BRACKET_PAIRS[c]) {
      out[i] = stack.length;
      stack.push(BRACKET_PAIRS[c]);
    } else if (CLOSERS.has(c)) {
      if (stack.length > 0 && stack[stack.length - 1] === c) {
        stack.pop();
        out[i] = stack.length;
      }
    }
  }
  return out;
}

export interface TacticTokenSource {
  start: LspPos;
  text: string;
  tokens?: TacticToken[];
  labelTokens?: LabelToken[];
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
  const cache = new Map<string, ReactNode[] | null>();
  return (p, label, lines, elision) => {
    const e = editAt(p);
    if (!e?.tokens) return null;

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

export function renderTacticTokens(
  text: string,
  origin: LspPos,
  tokens: TacticToken[],
  label: string,
  lines: string[],

  infoAt: Map<string, TacticTokenInfo> = new Map(),

  elision?: Elision,
  colorBrackets = false,

  labelTokens: LabelToken[] = [],
): ReactNode[] | null {
  if (tokens.length === 0 && labelTokens.length === 0) return null;
  ensureTaggedStyle();

  const offsets = lineOffsets(label, lines);
  if (!offsets) return null;

  const alignLabel = elision ? elision.original : label;
  const align = alignInLabel(text, alignLabel);
  if (!align) return null;
  const raw = tokenSpans(text, origin, tokens, infoAt);
  if (!raw) return null;

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

  if (elision)
    for (const e of elision.marks)
      spans.push({ start: e.outAt, end: e.outAt + e.len, ellipsis: e.hidden });

  spans.sort((a, b) => a.start - b.start);

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
    let cur = lo;
    for (const s of spans) {
      const a = Math.max(s.start, lo);
      const b = Math.min(s.end, hi);
      if (a >= b || a < cur) continue;
      if (a > cur) parts.push(...plain(cur, a));
      const slice = label.slice(a, b);

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

      if (s.doc !== undefined) {
        const color = s.type ? TOKEN_COLOR[s.type] : undefined;
        parts.push(
          <DocTokenSpan key={`${a}`} text={slice} color={color} doc={s.doc} />,
        );
        cur = b;
        continue;
      }

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
