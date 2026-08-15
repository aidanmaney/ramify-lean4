// Completion candidates for the in-place tactic editor. Pure (a draft string, a
// caret, three candidate lists in — a ranked list out), and in its own module so
// a probe can exercise the matching directly, the same reason calcEdit.ts and
// briefLabel.ts are separate.
//
// Everything here is LOCAL: the hypotheses of the goal being edited, that goal's
// printed subterms, and the imported tactic names. All three are already in the
// payload, so there is no RPC, no debounce and no cancellation — which is the
// whole reason this tier exists. (Full `idCompletion` over RPC was measured at
// ~525ms warm and up to 240,284 items; it is deliberately not what this does.)

export interface CompletionItem {
  label: string;
  /** Replace `[from, to)` of the draft with `label`. */
  from: number;
  to: number;
  kind: "hyp" | "term" | "tactic" | "global";
  /** The label is exactly what is already typed. Kept and ranked FIRST rather
   * than filtered out: `ring` is a tactic in its own right, and dropping it
   * because it matched exactly left `ring1` selected, so Enter inserted THAT.
   * The view also reads this to let Enter mean "commit" there (see its keydown
   * handler) instead of costing a second keystroke to accept a no-op. */
  exact: boolean;
}

export interface CompletionPools {
  hyps: string[];
  terms: string[];
  tactics: string[];
  /** The ENVIRONMENT tier — global names from the `completionNames` RPC,
   * fetched by the view (debounced, prefix-gated, cached per query) and passed
   * in already SORTED shortest-first by the server. The one pool that is not
   * "already in the payload"; absent in the standalone app, and absent while a
   * fetch is in flight — the local tiers never wait on it. */
  globals?: string[];
}

/** The server's gates, mirrored so client and server agree on when a query is
 * even worth the round trip and on when a cached answer is COMPLETE (fewer
 * than the cap means nothing was truncated, so the client may keep narrowing
 * it locally instead of refetching). Keep in sync with `minCompletionQuery` /
 * `maxCompletionNames` in Ramify.lean. */
export const MIN_GLOBAL_PREFIX = 3;
export const GLOBAL_MAX = 50;

/** At most this many items — the list is a hint, not a browser. */
const MAX_ITEMS = 12;

// Lean identifiers are far wider than /\w/: they carry `.`, `_`, `'`, `!`, `?`
// and unicode letters (`α`, `ℕ`, `hab₂`). Anything that is not whitespace and
// not a bracket/separator is treated as part of the token being typed.
const NOT_IDENT = /[\s()[\]{}⟨⟩,;:=<>≤≥≠∣⊆∈↔→∧∨+\-*/^]/;

/** The identifier token AROUND `caret` — it extends forward as well as back, so
 * completing from the middle of a word replaces the whole word instead of
 * leaving its tail behind (`exact h|ab` + `hab` would otherwise give `habab`). */
function identSpan(value: string, caret: number): [number, number] {
  let i = caret;
  while (i > 0 && !NOT_IDENT.test(value[i - 1])) i--;
  let j = caret;
  while (j < value.length && !NOT_IDENT.test(value[j])) j++;
  return [i, j];
}

// A term boundary is where a new expression plainly starts: the line, the `:=`
// that opens a justification, or a relation symbol. In a calc link
// `_ = ‹here›` the boundary is the relation — which is exactly what makes a
// goal's subterms matchable against what is being typed there.
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

/** The span from the last structural boundary to the next one — the whole term
 * the caret sits in, so completing mid-term replaces it rather than doubling
 * its tail. `hadBoundary` distinguishes "the caret follows a relation, so an
 * EMPTY prefix still means a term is expected here" from "the draft is simply
 * empty", where offering every subterm of the goal would be noise. */
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
  // Leading whitespace belongs to the boundary, not to what is being typed.
  while (from < caret && /\s/.test(value[from])) from++;
  // Forward to the next boundary (`:=` opens the justification, a newline ends
  // the link), then back over trailing whitespace.
  let to = value.length;
  for (const b of [":=", "\n"]) {
    const i = value.indexOf(b, caret);
    if (i >= 0) to = Math.min(to, i);
  }
  while (to > caret && /\s/.test(value[to - 1])) to--;
  return { from, to, hadBoundary };
}

/** The identifier prefix being typed at `caret` — what the view keys the
 * global-name fetch on. The same span the name tiers match against. */
export function identPrefixAt(value: string, caret: number): string {
  const [iFrom] = identSpan(value, caret);
  return value.slice(iFrom, caret);
}

/** Case-insensitive prefix match, which is what a completion list wants. */
const matches = (cand: string, prefix: string) =>
  prefix === "" || cand.toLowerCase().startsWith(prefix.toLowerCase());

/** `✝` is how inaccessible names print, and an accepted candidate gets TYPED
 * INTO THE BUFFER — so anything carrying one cannot round-trip back into
 * source and must not be offered. One name for the rule so every tier applies
 * it (it was once inline per tier, and the hyps tier missed it — a bare
 * `induction n`'s `n✝` was offered and, accepted, broke the draft). */
const roundTrips = (s: string) => !s.includes("✝");

/**
 * The ranked list for a caret in a draft.
 *
 * Two matchers, because the tiers key on different things: names are matched on
 * the identifier token under the caret, whole terms on the text back to the last
 * structural boundary. Terms are offered even when that text is EMPTY — having
 * just typed `_ = `, the goal's right-hand side is the likeliest next thing, and
 * that is the moment this feature exists for. Names are not, or every empty
 * caret would dump ~500 tactic names on screen.
 */
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

  // Tier 1: hypotheses of the goal this tactic consumes.
  if (ident !== "")
    for (const h of pools.hyps)
      if (roundTrips(h) && matches(h, ident)) push(h, iFrom, iTo, "hyp");

  // Tier 1.5: the goal's own subterms. A term that IS just the identifier being
  // typed adds nothing over the tier-1 entry, so single tokens are dropped
  // (and non-round-tripping terms with them — see `roundTrips`).
  if (term !== "" || hadBoundary)
    for (const t of pools.terms) {
      if (!roundTrips(t) || !t.includes(" ")) continue;
      if (matches(t, term)) push(t, tFrom, tTo, "term");
    }

  // Tactic names last: the widest pool and the least specific. Sorted shortest
  // first, because `allTacticDocs` order is arbitrary and, for a PREFIX match,
  // the shortest candidate is by definition the exact one — so `ring` sorts
  // ahead of `ring1` and `ring_nf` for free.
  // Filter THEN sort, not the other way round: the pool is ~500 names and this
  // runs on every keystroke, while the matches are a handful.
  if (ident !== "")
    for (const t of pools.tactics
      .filter((t) => matches(t, ident))
      .sort((a, b) => a.length - b.length || (a < b ? -1 : 1)))
      push(t, iFrom, iTo, "tactic");

  // The environment tier last: the least local pool, already server-sorted
  // shortest-first (and shortest IS the exact match under a prefix rule), so
  // no re-sort here. The dedupe map above lets the local tiers claim a label
  // first — a hypothesis shadowing a global name is the hypothesis.
  if (ident !== "" && pools.globals)
    for (const g of pools.globals)
      if (matches(g, ident)) push(g, iFrom, iTo, "global");

  // An exact match leads, whichever pool it came from: it is the completion the
  // author has already finished typing, so it must be what Enter takes. Dropping
  // it (which this used to do, on the grounds that it changes no text) left the
  // NEXT-longest candidate selected, so finishing `ring` and pressing Enter
  // inserted `ring1`.
  return [...out.filter((i) => i.exact), ...out.filter((i) => !i.exact)].slice(
    0,
    MAX_ITEMS,
  );
}
