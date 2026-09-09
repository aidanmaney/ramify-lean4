export interface CompletionItem {
  label: string;

  from: number;
  to: number;
  kind: "hyp" | "term" | "tactic" | "global";

  exact: boolean;
}

export interface CompletionPools {
  hyps: string[];
  terms: string[];
  tactics: string[];

  globals?: string[];
}

export const MIN_GLOBAL_PREFIX = 3;
export const GLOBAL_MAX = 50;

const MAX_ITEMS = 12;

const NOT_IDENT = /[\s()[\]{}⟨⟩,;:=<>≤≥≠∣⊆∈↔→∧∨+\-*/^]/;

function identSpan(value: string, caret: number): [number, number] {
  let i = caret;
  while (i > 0 && !NOT_IDENT.test(value[i - 1])) i--;
  let j = caret;
  while (j < value.length && !NOT_IDENT.test(value[j])) j++;
  return [i, j];
}

const BOUNDARIES = [
  "\n",
  ":=",
  "=",
  "≤",
  "<",
  "≥",
  ">",
  "≠",
  "∣",
  "⊆",
  "⊂",
  "∈",
  "↔",
];

function termSpan(
  value: string,
  caret: number,
): { from: number; to: number; hadBoundary: boolean } {
  const head = value.slice(0, caret);
  let from = 0;
  let hadBoundary = false;
  for (const b of BOUNDARIES) {
    const i = head.lastIndexOf(b);
    if (i >= 0 && i + b.length > from) {
      from = i + b.length;
      hadBoundary = true;
    }
  }

  while (from < caret && /\s/.test(value[from])) from++;

  let to = value.length;
  for (const b of [":=", "\n"]) {
    const i = value.indexOf(b, caret);
    if (i >= 0) to = Math.min(to, i);
  }
  while (to > caret && /\s/.test(value[to - 1])) to--;
  return { from, to, hadBoundary };
}

export function identPrefixAt(value: string, caret: number): string {
  const [iFrom] = identSpan(value, caret);
  return value.slice(iFrom, caret);
}

const matches = (cand: string, prefix: string) =>
  prefix === "" || cand.toLowerCase().startsWith(prefix.toLowerCase());

const roundTrips = (s: string) => !s.includes("✝");

export function completionsAt(
  value: string,
  caret: number,
  pools: CompletionPools,
): CompletionItem[] {
  const [iFrom, iTo] = identSpan(value, caret);
  const { from: tFrom, to: tTo, hadBoundary } = termSpan(value, caret);
  const ident = value.slice(iFrom, caret);
  const term = value.slice(tFrom, caret);
  const out: CompletionItem[] = [];
  const seen = new Set<string>();
  const push = (label: string, from: number, to: number, kind: CompletionItem["kind"]) => {
    if (!label || seen.has(label)) return;
    seen.add(label);
    out.push({ label, from, to, kind, exact: label === value.slice(from, caret) });
  };

  if (ident !== "")
    for (const h of pools.hyps)
      if (roundTrips(h) && matches(h, ident)) push(h, iFrom, iTo, "hyp");

  if (term !== "" || hadBoundary)
    for (const t of pools.terms) {
      if (!roundTrips(t) || !t.includes(" ")) continue;
      if (matches(t, term)) push(t, tFrom, tTo, "term");
    }

  if (ident !== "")
    for (const t of pools.tactics
      .filter((t) => matches(t, ident))
      .sort((a, b) => a.length - b.length || (a < b ? -1 : 1)))
      push(t, iFrom, iTo, "tactic");

  if (ident !== "" && pools.globals)
    for (const g of pools.globals)
      if (matches(g, ident)) push(g, iFrom, iTo, "global");

  return [...out.filter((i) => i.exact), ...out.filter((i) => !i.exact)].slice(
    0,
    MAX_ITEMS,
  );
}
