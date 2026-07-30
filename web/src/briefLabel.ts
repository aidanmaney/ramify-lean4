// "Brief mode": collapse mechanical boilerplate WITHIN a tactic label to `…`,
// keeping the tactic head and the bindings it introduced. The within-tactic
// analogue of the Alectryon-style `.fold`/`.none` subtree elision — one level
// finer, since it touches the tactic's own label text.
//
// This is a pure string transform (no proof data), so it is trivially testable
// and shared by both data paths. The output is a COLLAPSED string plus a
// KEEP map back to the original label: token colouring and hover popups are
// aligned against the original label (see tacticTokens.tsx) and then shifted
// through this map into collapsed space, so the surviving tokens keep their
// colour while the elided ones drop. Each `…` is a single U+2026 char in the
// collapsed text; the renderer reveals what it replaced via the KEEP gaps.
//
// Geometry stays honest because the collapsed string is what layout.ts measures
// (the label transform runs BEFORE sizeOf) — see proofToTree's `brief` option.

/** One run of the original label carried through verbatim: `len` chars starting
at `srcAt` in the original label sit at `outAt` in the collapsed text. The gaps
between consecutive KeepSegs are the elisions (each a single `…`). */
export interface KeepSeg {
  outAt: number;
  srcAt: number;
  len: number;
}

export interface CollapsedLabel {
  /** The collapsed display string (contains `…` at each elision). */
  text: string;
  /** Kept runs, in order; gaps between them are the `…`s. */
  keep: KeepSeg[];
  /** The untouched original label, for aligning tokens before remapping. */
  original: string;
}

const ELLIPSIS = "…";
const OPENERS = "([{⟨";
const CLOSERS = ")]}⟩";

// Below this many characters a label is left whole — collapsing a short tactic
// saves no width and only hides text. A proxy for the pixel width gate the
// layout applies; the point is only to skip the trivial cases.
const MIN_LABEL = 26;
// An elision must remove at least this many chars to be worth a `…` (which is
// itself one char plus the readability cost of hiding text).
const MIN_ELIDE = 8;

/** Scan `s` recording, at bracket depth 0: the index of a top-level `:=`, the
index of a top-level ` with ` keyword, and every top-level `[ … ]` group with
its inner (depth-1) comma positions. One pass, so the three rules below share it. */
interface Scan {
  assign: number; // index of top-level ":=" (-1 if none)
  withKw: number; // index of the "with" of a top-level " with " (-1 if none)
  lists: { open: number; close: number; commas: number[] }[]; // top-level `[]`
}

function scan(s: string): Scan {
  let depth = 0;
  let assign = -1;
  let withKw = -1;
  const lists: Scan["lists"] = [];
  // Stack of open `[` groups currently being scanned (only depth-0 ones matter).
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

/** The keyword rules are ASYMMETRIC, and the asymmetry is the whole point —
measured against the corpus, applying one rule to every tactic was half right
and half backwards.
//
BINDERS (`have`, `by_contra`, `by_cases`, `obtain`, …) NAME or STATE something
the rest of the proof uses, and there the statement is the content while the
command word is ceremony: `have hp1 : p ∣ 1 := (Nat.dvd_add_right hpfac).mp
hpdvd` reads `… hp1 : p ∣ 1 := …`, which is the register a paper uses ("we
have hp1 : p ∣ 1"). Rule E1 drops their keyword.

Every OTHER tactic keeps its keyword, because there the keyword is the one
part a reader skims by — it CLASSIFIES the move (rewrite / closer / case
split) — while the arguments are the noise. `rw [ih]` → `… [ih]` was the
counterexample that settled it: two characters saved, and you can no longer
tell a rewrite from a simp set from a linarith hint list. Their long
ARGUMENTS are elided instead, verb-forward, by Rule E2 below.

EXCLUDED from E1 even though they bind: `rcases`/`cases` (Rule B already
collapses their scrutinee, so dropping the head as well leaves a bare
`… with h | h` — measured, exactly what it produced) and `induction` (the
variable inducted on is the content). `calc` is Rule D's. */
const BINDER_KW =
  /^(have|let|obtain|set|suffices|show|use|exists|refine|intro|intros|rintro|by_cases|by_contra|specialize)\b/;
/** Rule E2's heads: tactics whose ARGUMENTS are the boilerplate. Not the
complement of BINDER_KW by construction — an unknown or custom tactic matches
neither, and is left entirely alone, which is the conservative default for a
label we cannot classify. `simp only` and friends match as a UNIT, or the
`only` is left dangling with nothing in front of it. */
const VERB_KW =
  /^(exact\??|apply|rw|rewrite|erw|nth_rewrite|simp\w*|simpa|dsimp|norm_num|norm_cast|push_cast|push_neg|field_simp|ring_nf|linarith|nlinarith|polyrith|positivity|gcongr|omega|decide|aesop|tauto|itauto|trivial|assumption|contradiction|constructor|left|right|rfl|ring|abel|group|module|linear_combination|revert|subst|substs|convert|congr|ext|change|unfold|delta|conv|bound|hint|first|repeat|try|all_goals|any_goals|focus)(\s+only)?\b/;

/** The half-open ranges of the original label to hide, from the rules. */
function elisionRanges(label: string, short: boolean): [number, number][] {
  const s = scan(label);
  const ranges: [number, number][] = [];
  const push = (a: number, b: number) => {
    if (b - a >= MIN_ELIDE) ranges.push([a, b]);
  };

  // Rule E1 — a BINDER's command word, replaced by the `…` itself, so the
  // statement leads: `have hp1 : p ∣ 1 := …` reads `… hp1 : p ∣ 1 := …`.
  //
  // It bypasses BOTH width gates, unlike every other rule, and that is the
  // point rather than an oversight: `by_contra hle` is 13 characters and a
  // keyword is 4-6, so MIN_LABEL and MIN_ELIDE would between them skip almost
  // every case this rule exists for. The rule is about NOISE, not width.
  //
  // Gated on something REMAINING: a bare `constructor` is nothing but its
  // command word, and collapsing it to `…` would erase the step instead of
  // shortening it — losing even that anything is there.
  const mE = BINDER_KW.exec(label);
  if (mE && label.slice(mE[0].length).trim() !== "") ranges.push([0, mE[0].length]);
  // Everything below is a WIDTH saving, so it keeps the short-label gate.
  if (short) return ranges;

  // Rule A — the flagship: the RHS of a top-level `:=` (a binding's derivation)
  // is boilerplate, while the LHS bindings and any `: type` before the `:=` are
  // the point. `:= by` opens a subtree the tree already folds, so leave it.
  if (s.assign >= 0) {
    let rhs = s.assign + 2;
    while (rhs < label.length && label[rhs] === " ") rhs++;
    const rest = label.slice(rhs);
    if (rest.trim() !== "" && !/^by(\s|$)/.test(rest)) push(rhs, label.length);
  }

  // Rule B — `rcases`/`cases <scrutinee> with <pattern>`: the scrutinee is the
  // derivation, the `with` pattern names the cases (content). Collapse between
  // the head keyword and `with`. (`obtain … := …` is Rule A; `induction` is
  // left alone — the variable inducted on is short and important.)
  const mB = /^(\s*)(rcases|cases)\s+/.exec(label);
  if (mB && s.withKw > mB[0].length) push(mB[0].length, s.withKw);

  // Rule C — an over-long `[ … ]` argument list (`rw`, `simp only`): keep the
  // opener and the FIRST rule, collapse the rest. Only `[]`, never `⟨⟩` (that
  // would hide the binding constructor Rule A is careful to keep). Needs >2
  // top-level items (≥2 commas) to be worth it.
  const beforeC = ranges.length;
  for (const g of s.lists) {
    if (g.commas.length < 2) continue;
    // Second item begins after the first comma (skip one space).
    let from = g.commas[0] + 1;
    if (label[from] === " ") from++;
    push(from, g.close); // up to, not including, the `]`
  }

  // Rule E2 — a NON-binder's ARGUMENTS, leaving the verb in front:
  // `exact ⟨k + 1, Or.inl (by omega)⟩` reads `exact …`. The mirror image of
  // E1, and the asymmetry is the design (see BINDER_KW): here the command
  // word is the skim anchor and the argument is the noise, so the `…` goes
  // where E1 keeps text and the text stays where E1 puts the `…`.
  //
  // Unlike E1 this is a WIDTH rule and keeps both gates — it sits past the
  // `short` return and goes through `push` — so `rw [ih]`, `exact hp` and
  // `push_neg at hle` stay whole, which is right: they already fit, and the
  // argument is short enough to read.
  //
  // It DEFERS to Rule C: where a long `[ … ]` list fired, `rw [a, …]` keeps
  // the first rewrite rule, which is strictly more than `rw …` and was a
  // deliberate earlier decision. C's range is a subset of E2's, so without
  // this the merge would swallow it.
  const mE2 = VERB_KW.exec(label);
  if (mE2 && ranges.length === beforeC) push(mE2[0].length, label.length);

  // Rule D — a `calc` chain's first line. Everything after the keyword is
  // ALREADY DRAWN, by the tree rather than by this label: the chain's starting
  // expression is the LHS of the goal box directly above, the first link's
  // relation is the goal box below, and a `:= by tac` justification is that
  // tac's own tactic node. So the chain reads as `calc …` over a column of
  // link goals, which is what a chain is.
  //
  // It also normalises a presentation ACCIDENT. `tacticString` is the tactic's
  // first LINE, so how much of the chain lands in the label depends purely on
  // where the author broke the source: the same construct measured 16, 50 and
  // 128 chars across the corpus. The width gate then keeps a genuinely short
  // head (`calc (a + b) ^ 2`) whole.
  //
  // This deliberately INVERTS Rule A here, which is why it must exist at all:
  // A keeps `:= by` (a folded subtree) and elides a term RHS, but for a calc
  // the `by` is the redundant half and a term justification is the one part
  // drawn nowhere else. A's range is a subset of D's and merges into it.
  const mD = /^\s*calc\s+/.exec(label);
  if (mD) push(mD[0].length, label.length);

  return ranges;
}

/** Collapse `label`, or null when nothing collapses (caller keeps the original
and sets no elision — the render path is then byte-identical to today). */
export function collapseLabel(label: string): CollapsedLabel | null {
  // The width-driven rules (A-D) are skipped on a short label, but Rule E is
  // not — see its comment. So the gate is passed DOWN rather than applied here.
  const raw = elisionRanges(label, label.length < MIN_LABEL);
  if (raw.length === 0) return null;

  // Merge overlapping/adjacent ranges (Rule A's to-end range can swallow a
  // Rule C list sitting inside the RHS). Two ranges separated only by
  // WHITESPACE count as adjacent: they would otherwise emit `… …`, which says
  // nothing twice and reads as a rendering fault. (Rule E's command word and
  // Rule B's scrutinee are exactly one space apart — the case that forced
  // this, before rcases/cases were excluded from E for the better reason.)
  raw.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of raw) {
    const last = merged[merged.length - 1];
    if (last && label.slice(last[1], Math.max(last[1], a)).trim() === "")
      last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }

  // Assemble the collapsed text and KEEP map by walking the label: kept runs
  // verbatim, each elided run a single `…`. Spacing around a `…` is normalised
  // to read like source — one space where the original had a word boundary,
  // none against a bracket — so `:= <rhs>` becomes `:= …`, `[a, b, c]` becomes
  // `[a, …]`, `rcases s with p` becomes `rcases … with p`. The synthetic spaces
  // belong to no KEEP segment (outAt is read off the built text length), so the
  // token remap stays exact.
  let text = "";
  const keep: KeepSeg[] = [];
  let cursor = 0;
  let afterElision = false;
  const last = () => text[text.length - 1];
  const emitKeep = (from: number, to: number) => {
    let s = from;
    let e = to;
    while (s < e && label[s] === " ") s++;
    while (e > s && label[e - 1] === " ") e--;
    if (e <= s) return;
    // A space after a preceding `…`, unless this run opens with a closer.
    if (afterElision && text !== "" && !CLOSERS.includes(label[s])) text += " ";
    afterElision = false;
    keep.push({ outAt: text.length, srcAt: s, len: e - s });
    text += label.slice(s, e);
  };
  for (const [a, b] of merged) {
    emitKeep(cursor, a);
    // A space before the `…`, unless the kept text ends with an opener.
    if (text !== "" && last() !== " " && !OPENERS.includes(last())) text += " ";
    text += ELLIPSIS;
    afterElision = true;
    cursor = b;
  }
  emitKeep(cursor, label.length);

  // A degenerate result (everything elided, or no net shortening) is not worth
  // it — fall back to the original.
  if (keep.length === 0 || text.length >= label.length) return null;
  return { text, keep, original: label };
}

/** Map an offset range in the ORIGINAL label into collapsed-text space, or null
if it lands (even partly) inside an elided gap. Used by the token renderer to
shift a source-aligned token span onto the collapsed label. */
export function mapRange(
  keep: KeepSeg[],
  srcAt: number,
  srcEnd: number,
): { start: number; end: number } | null {
  for (const k of keep) {
    if (srcAt >= k.srcAt && srcEnd <= k.srcAt + k.len) {
      const shift = k.outAt - k.srcAt;
      return { start: srcAt + shift, end: srcEnd + shift };
    }
  }
  return null;
}

/** The elisions as { outAt (offset of the `…` in the collapsed text), hidden
(the original substring it replaced) } — for the `…`'s hover reveal. The hidden
texts come from the gaps between KEEP segments, in order; their positions are
found by scanning the collapsed text for `…`, which is robust to the synthetic
spaces the assembler inserts around each marker. */
export function elisionsOf(c: CollapsedLabel): { outAt: number; hidden: string }[] {
  const hidden: string[] = [];
  let prevSrcEnd = 0;
  for (const k of c.keep) {
    if (k.srcAt > prevSrcEnd) hidden.push(c.original.slice(prevSrcEnd, k.srcAt));
    prevSrcEnd = k.srcAt + k.len;
  }
  if (prevSrcEnd < c.original.length)
    hidden.push(c.original.slice(prevSrcEnd));
  const out: { outAt: number; hidden: string }[] = [];
  let hi = 0;
  for (let i = 0; i < c.text.length && hi < hidden.length; i++)
    if (c.text[i] === ELLIPSIS) out.push({ outAt: i, hidden: hidden[hi++] });
  return out;
}
