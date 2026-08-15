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

/** A marker standing in the collapsed text for something removed: `…` for
hidden CONTENT, a typed glyph for a tactic's elided command word (Rule F).
`hidden` is what it replaced, for the hover reveal. Silent removals — pure
ceremony, like a namespace prefix — record no mark at all, because there is
nothing a reader would want revealed and nothing drawn to hover. */
export interface Mark {
  outAt: number;
  /** Length of the marker in the collapsed text (always 1 today). */
  len: number;
  hidden: string;
}

export interface CollapsedLabel {
  /** The collapsed display string (contains a marker at each shown elision). */
  text: string;
  /** Kept runs, in order; gaps between them are the elisions. */
  keep: KeepSeg[];
  /** The untouched original label, for aligning tokens before remapping. */
  original: string;
  /** Where each VISIBLE marker landed, recorded by the assembler. Derived
  here rather than re-found downstream: with three marker glyphs and silent
  gaps that emit none, "scan the output for `…` and pair with the KEEP gaps in
  order" is no longer a sound reconstruction. */
  marks: Mark[];
}

const ELLIPSIS = "…";
/** Rule F's typed markers — the move, in one character, where the command word
was. Chosen against the tree's existing vocabulary, not for looks: `▸` was
ruled out because it is already the used-hypothesis gutter mark AND the
context-breadth rail glyph, and `←` because it occurs INSIDE rw labels
(`rw [← hk]`), where it would collide with the content it sits next to. Both
resolve on all eight code-font stacks (measured, 0 tofu). */
const MARK_REWRITE = "↪";
const MARK_CLOSE = "∎";
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

/** A range of the original label to hide, with the marker that stands in for
it: `…` (hidden content), a Rule F glyph (the move), or `""` (silent). */
type Elision = [number, number, string];

/** The depth-0 `[` at `open` → the index of its `]`, or -1. Read off `scan`'s
groups rather than re-scanned, so bracket depth has ONE implementation. */
function matchingClose(s: Scan, open: number): number {
  return s.lists.find((g) => g.open === open)?.close ?? -1;
}

/** The half-open spans of a bracket list's top-level items, from `scan`'s
comma positions — no parser needed, and the same source of truth Rule C uses
to decide a list is long enough to trim. */
function listItems(s: Scan, open: number, close: number): [number, number][] {
  const g = s.lists.find((x) => x.open === open);
  if (!g) return [];
  const bounds = [open, ...g.commas, close];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < bounds.length; i++) out.push([bounds[i] + 1, bounds[i + 1]]);
  return out;
}

/** A qualified name's NAMESPACE, if this span begins with one: the `Nat.` of
`Nat.add_zero`. Silent — it is ceremony, and in a proof about ℕ the prefix is
what the surrounding context already says.
//
Two guards keep it off TERMS, where stripping would edit mathematics rather
than ceremony (measured: a blanket strip turns `Or.inl` into a meaningless
`inl` and rewrites `∑ i ∈ Finset.range (k+1)` into `∑ i ∈ range (k+1)`). It
fires only at the HEAD of a rewrite rule or of an `exact`/`apply` argument —
never inside a structured term, whose head is `⟨` or `(` and matches nothing —
and only on CAPITALISED components, so `h.symm`, `hp.pos` and `h.1` are
untouched: those dots are projections, not namespaces. */
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

/** The half-open ranges of the original label to hide, from the rules. */
function elisionRanges(label: string, short: boolean): Elision[] {
  const s = scan(label);
  const ranges: Elision[] = [];
  // MIN_ELIDE is a WIDTH rule — it asks whether hiding text pays for the `…`
  // that replaces it. It therefore applies only to `…`: a typed marker is the
  // point rather than a saving, and a silent removal costs nothing at all.
  const push = (a: number, b: number, mark = ELLIPSIS) => {
    if (mark !== ELLIPSIS || b - a >= MIN_ELIDE) ranges.push([a, b, mark]);
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
  if (mE && label.slice(mE[0].length).trim() !== "")
    ranges.push([0, mE[0].length, ELLIPSIS]);

  // Rule F — a REWRITE's ceremony, replaced by one typed glyph. `rw [X]` is
  // the case Rule E2 gets backwards: E2's premise is that the keyword
  // classifies the move and the argument is noise, which holds for a simp set
  // and fails here, where the bracket list IS the move and the lemma name is
  // drawn NOWHERE ELSE in the tree. Left to E2 the label read `rw …` — the
  // content gone, the noise kept.
  //
  // Like E1 this bypasses BOTH width gates, and for E1's reason: the defect
  // is UNIFORMITY, not width. Under the gates `rw [Nat.add_zero]` (17 chars)
  // was left whole while `rw [Finset.sum_range_succ]` (26) collapsed — the
  // same shape treated oppositely because one lemma has a longer name.
  //
  // The glyph is what keeps this from being a loss: dropping the head outright
  // makes `rw [h]` and `exact h` both read `h`, two moves in one box (measured:
  // 19 of 52 changed corpus labels fell to ≤2 chars). One character buys the
  // distinction back. `simp only [ … ]` is deliberately NOT here — a simp set
  // is not a rewrite, and `↪` would say it was; it keeps E2 and Rule C.
  const mF = /^(rw|rewrite|erw|nth_rewrite)\b/.exec(label);
  const open = mF ? label.indexOf("[", mF[0].length) : -1;
  const close = open >= 0 ? matchingClose(s, open) : -1;
  let ruleF = false;
  if (
    mF &&
    open >= 0 &&
    close > open + 1 &&
    // Only whitespace or an occurrence numeral may sit between the head and
    // its `[`; anything else means this `[` is not the rule list (a bracket
    // inside a trailing comment, say), and the rule declines rather than
    // guessing.
    /^\s*\d*\s*$/.test(label.slice(mF[0].length, open)) &&
    // Gated on a rule REMAINING, E1's rule: the corpus contains
    // `rw []  -- goal: c = c  (closed by rfl)]`, and without this the head and
    // both brackets collapse to a marker standing for nothing.
    label.slice(open + 1, close).trim() !== ""
  ) {
    ruleF = true;
    // The keyword and the brackets go SEPARATELY, so anything between them
    // survives: `nth_rewrite 2 [h]` keeps its occurrence numeral, which says
    // which `h` is being rewritten and is content by any reading.
    // Through the whitespace, not just the word: the space between `rw` and
    // `[` is ceremony too, and left as a kept run it doubles the marker's own
    // separator (`↪  add_zero`). An occurrence numeral is past that space and
    // survives.
    let headEnd = mF[0].length;
    while (headEnd < open && label[headEnd] === " ") headEnd++;
    ranges.push([0, headEnd, MARK_REWRITE]);
    ranges.push([open, open + 1, ""]); // the `[`, silently
    ranges.push([close, close + 1, ""]); // the `]`, silently
    for (const [from, to] of listItems(s, open, close))
      pushNamespace(ranges, label, from, to);
  }
  // `exact` CLOSES its goal, which is what `∎` already means on the lens's
  // inline annotations — the reuse is meaning-compatible, not a collision.
  // `apply` is left with its keyword: it does not close anything, so neither
  // marker fits, and `apply f` is short and clear as it stands. Both still
  // get their head lemma unqualified below.
  const mX = /^(exact)\s+/.exec(label);
  if (mX && label.slice(mX[0].length).trim() !== "") {
    ranges.push([0, mX[0].length, MARK_CLOSE]);
    ruleF = true;
  }
  const mH = /^(exact|apply)\s+/.exec(label);
  if (mH) pushNamespace(ranges, label, mH[0].length, label.length);

  // Everything below is a WIDTH saving, so it keeps the short-label gate.
  if (short) return ranges;

  // Read once, here, because Rule A below must stand down on a calc label —
  // see Rule D, whose whole reason for existing is that A's polarity is
  // INVERTED there (A keeps `:= by` and elides a term RHS; on a chain the `by`
  // is the redundant half and the term is the only copy). While D covered the
  // line to its end A was harmlessly subsumed; now that D stops at the `:=`,
  // an ungated A would elide precisely the justification D just protected.
  const mD = /^\s*calc\s+/.exec(label);

  // Rule A — the flagship: the RHS of a top-level `:=` (a binding's derivation)
  // is boilerplate, while the LHS bindings and any `: type` before the `:=` are
  // the point. `:= by` opens a subtree the tree already folds, so leave it.
  if (s.assign >= 0 && !mD) {
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
  //
  // It also stands down where RULE F already spoke for the label: F elides the
  // very head E2 would keep, so both firing would leave overlapping ranges
  // whose merge erases the argument F exists to preserve.
  const mE2 = VERB_KW.exec(label);
  if (mE2 && ranges.length === beforeC && !ruleF)
    push(mE2[0].length, label.length);

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
  //
  // NARROWED, now that the Lean side restores a term-justified first link into
  // the label (collectTacticTails): what the TREE draws is the RELATION — the
  // goal box below — and a `:= by tac` justification, which is that tac's own
  // node. A TERM justification is drawn NOWHERE, so it is the one part of the
  // line brief must keep, and D stops at the `:=`. Before the restoration this
  // could not arise: written `calc` on its own line the term never reached the
  // label at all, it was simply lost.
  if (mD) {
    let j = s.assign >= 0 ? s.assign + 2 : -1;
    while (j > 0 && j < label.length && label[j] === " ") j++;
    const termJust = j > 0 && !/^by(\s|$)/.test(label.slice(j));
    push(mD[0].length, termJust ? s.assign : label.length);
  }

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
  //
  // Ranges may merge only when their MARKERS agree. Rule F's silent `]` sits
  // immediately after Rule C's `…` inside the same bracket list, and merging
  // those would swallow the one marker saying content is hidden — the `…` is
  // a claim about the label, and a silent removal makes no claim to merge with.
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

  // Ranges must be MONOTONIC and non-overlapping before the walk, and merging
  // by marker is not enough to guarantee it: Rule C's `…` covers a list's tail,
  // and Rule F's silent namespace strips sit INSIDE it. Overlap made the walk's
  // cursor go backwards and resurrect text that was supposed to be hidden
  // (measured: `rw [Nat.add_zero, Nat.add_succ, Nat.zero_add]` printed
  // `↪ add_zero, … zero_add`). A range already covered is dropped; one that
  // straddles is clipped to what is left.
  const ordered: Elision[] = [];
  let reach = -1;
  for (const [a, b, mark] of merged) {
    if (b <= reach) continue;
    ordered.push([Math.max(a, reach), b, mark]);
    reach = b;
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
  const marks: Mark[] = [];
  let cursor = 0;
  let afterElision = false;
  const last = () => text[text.length - 1];
  // A run's whitespace is trimmed so the spacing around a MARKER can be
  // normalised — but a SILENT removal has no marker, and the text either side
  // of it must close up exactly as the source wrote it. So each end of a run
  // keeps its space when a silent gap abuts it: without the leading half,
  // `rw [hb] at h` reads `↪ hbat h`; without the trailing half,
  // `apply Nat.le_trans` reads `applyle_trans` (both measured).
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
        // The marker's own trailing space is still owed: `rw [Nat.add_zero]`
        // elides `rw [` (marked ↪) and then `Nat.` (silent) back to back, and
        // skipping the whole spacing path here printed `↪add_zero`.
        if (afterElision && text !== "" && !CLOSERS.includes(label[s]))
          text += " ";
        afterElision = false;
        keep.push({ outAt: text.length, srcAt: s, len: e - s });
        text += label.slice(s, e);
      }
      return;
    }
    // `\n` trims like a space: a multi-line label (restored tails) elides
    // ACROSS newlines, and a kept run must not open or close on one — brief's
    // point is collapsing the label back toward one line.
    while (s < e && (label[s] === " " || label[s] === "\n")) s++;
    while (e > s && (label[e - 1] === " " || label[e - 1] === "\n")) e--;
    if (e <= s) return;
    // A space after a preceding `…`, unless this run opens with a closer.
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
    // A SILENT removal emits nothing at all — no glyph and no spacing. It is
    // ceremony being deleted (a namespace prefix, a rewrite's closing `]`),
    // so the text either side must close up as though it were never written.
    if (mark === "") {
      cursor = b;
      silentGap = true;
      continue;
    }
    // A space before the marker, unless the kept text ends with an opener.
    if (text !== "" && last() !== " " && !OPENERS.includes(last())) text += " ";
    marks.push({ outAt: text.length, len: mark.length, hidden: label.slice(a, b) });
    text += mark;
    afterElision = true;
    cursor = b;
  }
  emitKeep(cursor, label.length, silentGap);

  // A degenerate result (everything elided, or no net shortening) is not worth
  // it — fall back to the original.
  if (keep.length === 0 || text.length >= label.length) return null;
  return { text, keep, original: label, marks };
}

/** Map an offset range in the ORIGINAL label into collapsed-text space,
CLIPPED to the kept run it overlaps — null only when it overlaps no kept run at
all. Used by the token renderer to shift a source-aligned token span onto the
collapsed label.
//
CLIPPING, not containment, and the difference is load-bearing: a SILENT gap
cuts INSIDE a token. Lean lexes `Nat.add_zero` as ONE identifier spanning the
whole name, and Rule F removes `Nat.` from the middle of it — under a
containment test that span matches no kept run, so the surviving `add_zero`
would render uncoloured and un-hoverable, with nothing anywhere reporting it.
That is the same discipline `renderTacticTokens` already applies to
`alignInLabel`'s segments. A span lying WHOLLY inside a gap still returns null,
so a `…` keeps swallowing its tokens. */
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

/** The visible markers, for the renderer's hover reveal. Just the recorded
list now: it used to be RE-DERIVED by pairing the KEEP gaps with a scan of the
collapsed text for `…`, which only worked while every gap emitted exactly one
identical glyph. With three glyphs and silent gaps that emit none, that pairing
would hand a marker the wrong hidden text — so the assembler, which is the only
place that knows, records it instead. */
export function elisionsOf(c: CollapsedLabel): Mark[] {
  return c.marks;
}
