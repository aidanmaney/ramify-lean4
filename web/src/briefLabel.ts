export interface KeepSeg {
  outAt: number;
  srcAt: number;
  len: number;
}

export interface Mark {
  outAt: number;

  len: number;
  hidden: string;
}

export interface CollapsedLabel {
  text: string;

  keep: KeepSeg[];

  original: string;

  marks: Mark[];
}

const ELLIPSIS = "…";

const MARK_REWRITE = "↪";
const MARK_CLOSE = "∎";

const HEAD_MARKS: { re: RegExp; mark: string; bare: boolean }[] = [
  { re: /^(intro|intros|rintro)\b/, mark: "λ", bare: true },
  { re: /^(exfalso|contradiction|absurd)\b/, mark: "⊥", bare: true },
  { re: /^(show|change)\b/, mark: "⊢", bare: false },
  { re: /^assumption\b/, mark: MARK_CLOSE, bare: true },
  { re: /^(unfold|delta)\b/, mark: "δ", bare: false },
  { re: /^(use|exists)\b/, mark: "∃", bare: false },
  { re: /^constructor\b/, mark: "⟨⟩", bare: true },
];
const OPENERS = "([{⟨";
const CLOSERS = ")]}⟩";

const MIN_LABEL = 26;

const MIN_ELIDE = 8;

interface Scan {
  assign: number;
  withKw: number;
  lists: { open: number; close: number; commas: number[] }[];
}

function scan(s: string): Scan {
  let depth = 0;
  let assign = -1;
  let withKw = -1;
  const lists: Scan["lists"] = [];

  let listStart = -1;
  let listCommas: number[] = [];
  const isWordChar = (c: string | undefined) => !!c && /[\w.]/.test(c);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (OPENERS.includes(c)) {
      if (c === "[" && depth === 0) {
        listStart = i;
        listCommas = [];
      }
      depth++;
    } else if (CLOSERS.includes(c)) {
      depth--;
      if (c === "]" && depth === 0 && listStart >= 0) {
        lists.push({ open: listStart, close: i, commas: listCommas });
        listStart = -1;
      }
    } else if (depth === 0 && assign < 0 && c === ":" && s[i + 1] === "=") {
      assign = i;
    } else if (
      depth === 0 &&
      withKw < 0 &&
      s.startsWith("with", i) &&
      !isWordChar(s[i - 1]) &&
      !isWordChar(s[i + 4])
    ) {
      withKw = i;
    } else if (c === "," && depth === 1 && listStart >= 0) {
      listCommas.push(i);
    }
  }
  return { assign, withKw, lists };
}

const BINDER_KW =
  /^(have|let|obtain|set|suffices|refine|by_cases|by_contra|specialize)\b/;

const VERB_KW =
  /^(exact\??|apply|rw|rewrite|erw|nth_rewrite|simp\w*|simpa|dsimp|norm_num|norm_cast|push_cast|push_neg|field_simp|ring_nf|linarith|nlinarith|polyrith|positivity|gcongr|omega|decide|aesop|tauto|itauto|trivial|assumption|contradiction|constructor|left|right|rfl|ring|abel|group|module|linear_combination|revert|subst|substs|convert|congr|ext|change|unfold|delta|conv|bound|hint|first|repeat|try|all_goals|any_goals|focus)(\s+only)?\b/;

type Elision = [number, number, string];

function matchingClose(s: Scan, open: number): number {
  return s.lists.find((g) => g.open === open)?.close ?? -1;
}

function listItems(s: Scan, open: number, close: number): [number, number][] {
  const g = s.lists.find((x) => x.open === open);
  if (!g) return [];
  const bounds = [open, ...g.commas, close];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < bounds.length; i++) out.push([bounds[i] + 1, bounds[i + 1]]);
  return out;
}

function pushNamespace(
  out: Elision[],
  label: string,
  from: number,
  to: number,
): void {
  let i = from;
  while (i < to && (label[i] === " " || label[i] === "←")) i++;
  const m = /^(?:\p{Lu}[\p{L}\p{N}_']*\.)+/u.exec(label.slice(i, to));
  if (m) out.push([i, i + m[0].length, ""]);
}

function elisionRanges(label: string, short: boolean): Elision[] {
  const s = scan(label);
  const ranges: Elision[] = [];

  const push = (a: number, b: number, mark = ELLIPSIS) => {
    if (mark !== ELLIPSIS || b - a >= MIN_ELIDE) ranges.push([a, b, mark]);
  };

  const mE = BINDER_KW.exec(label);
  if (mE && label.slice(mE[0].length).trim() !== "")
    ranges.push([0, mE[0].length, ELLIPSIS]);

  const mF = /^(rw|rewrite|erw|nth_rewrite)\b/.exec(label);
  const open = mF ? label.indexOf("[", mF[0].length) : -1;
  const close = open >= 0 ? matchingClose(s, open) : -1;
  let ruleF = false;
  if (
    mF &&
    open >= 0 &&
    close > open + 1 &&

    /^\s*\d*\s*$/.test(label.slice(mF[0].length, open)) &&

    label.slice(open + 1, close).trim() !== ""
  ) {
    ruleF = true;

    let headEnd = mF[0].length;
    while (headEnd < open && label[headEnd] === " ") headEnd++;
    ranges.push([0, headEnd, MARK_REWRITE]);
    ranges.push([open, open + 1, ""]);
    ranges.push([close, close + 1, ""]);
    for (const [from, to] of listItems(s, open, close))
      pushNamespace(ranges, label, from, to);
  }

  const mX = /^(exact)\s+/.exec(label);
  if (mX && label.slice(mX[0].length).trim() !== "") {
    ranges.push([0, mX[0].length, MARK_CLOSE]);
    ruleF = true;
  }
  const mH = /^(exact|apply)\s+/.exec(label);
  if (mH) pushNamespace(ranges, label, mH[0].length, label.length);

  if (!ruleF)
    for (const hm of HEAD_MARKS) {
      const m = hm.re.exec(label);
      if (!m) continue;

      if (label.slice(m[0].length).trim() === "" && !hm.bare) break;
      ranges.push([0, m[0].length, hm.mark]);
      ruleF = true;
      break;
    }

  if (short) return ranges;

  if (s.assign >= 0) {
    let rhs = s.assign + 2;
    while (rhs < label.length && label[rhs] === " ") rhs++;
    const rest = label.slice(rhs);
    if (rest.trim() !== "" && !/^by(\s|$)/.test(rest)) push(rhs, label.length);
  }

  const mB = /^(\s*)(rcases|cases)\s+/.exec(label);
  if (mB && s.withKw > mB[0].length) push(mB[0].length, s.withKw);

  const beforeC = ranges.length;
  for (const g of s.lists) {
    if (g.commas.length < 2) continue;

    let from = g.commas[0] + 1;
    if (label[from] === " ") from++;
    push(from, g.close);
  }

  const mE2 = VERB_KW.exec(label);
  if (mE2 && ranges.length === beforeC && !ruleF)
    push(mE2[0].length, label.length);

  const mD = /^\s*calc\s+/.exec(label);
  if (mD) push(mD[0].length, label.length);

  return ranges;
}

export function collapseLabel(label: string): CollapsedLabel | null {
  const raw = elisionRanges(label, label.length < MIN_LABEL);
  if (raw.length === 0) return null;

  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Elision[] = [];
  for (const [a, b, mark] of raw) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last[2] === mark &&
      label.slice(last[1], Math.max(last[1], a)).trim() === ""
    )
      last[1] = Math.max(last[1], b);
    else merged.push([a, b, mark]);
  }

  const ordered: Elision[] = [];
  let reach = -1;
  for (const [a, b, mark] of merged) {
    if (b <= reach) continue;
    ordered.push([Math.max(a, reach), b, mark]);
    reach = b;
  }

  let text = "";
  const keep: KeepSeg[] = [];
  const marks: Mark[] = [];
  let cursor = 0;
  let afterElision = false;
  const last = () => text[text.length - 1];

  const emitKeep = (
    from: number,
    to: number,
    silentBefore = false,
    silentAfter = false,
  ) => {
    let s = from;
    let e = to;
    if (silentBefore || silentAfter) {
      if (e > s) {
        if (afterElision && text !== "" && !CLOSERS.includes(label[s]))
          text += " ";
        afterElision = false;
        keep.push({ outAt: text.length, srcAt: s, len: e - s });
        text += label.slice(s, e);
      }
      return;
    }

    while (s < e && (label[s] === " " || label[s] === "\n")) s++;
    while (e > s && (label[e - 1] === " " || label[e - 1] === "\n")) e--;
    if (e <= s) return;

    if (afterElision && text !== "" && !CLOSERS.includes(label[s])) text += " ";
    afterElision = false;
    keep.push({ outAt: text.length, srcAt: s, len: e - s });
    text += label.slice(s, e);
  };
  let silentGap = false;
  for (let i = 0; i < ordered.length; i++) {
    const [a, b, mark] = ordered[i];
    emitKeep(cursor, a, silentGap, mark === "");
    silentGap = false;

    if (mark === "") {
      cursor = b;
      silentGap = true;
      continue;
    }

    if (text !== "" && last() !== " " && !OPENERS.includes(last())) text += " ";
    marks.push({ outAt: text.length, len: mark.length, hidden: label.slice(a, b) });
    text += mark;
    afterElision = true;
    cursor = b;
  }
  emitKeep(cursor, label.length, silentGap);

  if (
    (keep.length === 0 && (marks.length === 0 || text === ELLIPSIS)) ||
    text.length >= label.length
  )
    return null;
  return { text, keep, original: label, marks };
}

export function mapRange(
  keep: KeepSeg[],
  srcAt: number,
  srcEnd: number,
): { start: number; end: number } | null {
  for (const k of keep) {
    const kEnd = k.srcAt + k.len;
    if (srcEnd <= k.srcAt || srcAt >= kEnd) continue;
    const shift = k.outAt - k.srcAt;
    return {
      start: Math.max(srcAt, k.srcAt) + shift,
      end: Math.min(srcEnd, kEnd) + shift,
    };
  }
  return null;
}

export function elisionsOf(c: CollapsedLabel): Mark[] {
  return c.marks;
}
