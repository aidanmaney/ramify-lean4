// H6 (audit 2026-11) — WRITE WHAT `exact?` FOUND.
//
// `exact?`, `apply?` and `rw?` are a beginner's first automation step, and
// what they found arrives as an INFO diagnostic on the tactic: `Try this:`
// followed by the tactic to write. The infoview's own widget offers it where
// the cursor stands; the tree is where the reader is looking when it is
// elsewhere. D2b's `⇑` cannot offer it, because it writes only a suggestion
// whose head word matches the tactic's own (`simp` → `simp only […]`), and
// `exact?` → `exact foo` does not match.
//
// So this is D2b's move with a different source for the text: core's own
// suggestion, VERBATIM (minus the `[apply]`-style tag core prints before it),
// over the tactic's own tight range — never a term this module assembles. It
// goes through the same proposal pill and the same `checkRewrite` as every
// other rewrite, so nothing is written until the elaborator agrees.
//
// Pure: `widget.tsx` reads the raw diagnostics (info severity is dropped by
// `filterDiagnostics`, so the view never sees these) and hands the view the
// suggestions; the view decides which node each belongs to.
import type { RawDiagnostic } from "./diagnostics";
import { posLE } from "./proofToTree";
import { headWord, verbatim, type Pos, type Proposal, type Rewrite, type RewriteCtx } from "./rewrite";
import { expandTitle } from "./moves";
import type { TreeNode } from "./types";

/** The tactics whose answer is a `Try this`. `simp?` and friends are B4's
 traces and D2b's `⇑`, whose head words already match. */
export const SEARCH_HEADS: ReadonlySet<string> = new Set(["exact?", "apply?", "rw?"]);

/** One `Try this` the server reported, where it reported it. */
export interface SearchSuggestion {
  start: Pos;
  stop: Pos;
  /** The tactic to write, one line. */
  text: string;
}

const HEADER = /^Try th(?:is|ese):[ \t]*/;
/** Core's provenance tag before an `exact?` answer (`[apply] exact foo`). */
const TAG = /^\[[A-Za-z_]+\][ \t]*/;
const BULLET = /^[•·*-][ \t]+/;

/**
 * The FIRST suggestion of a `Try this:` message, or null.
 *
 * Measured shapes: `Try this:\n  [apply] exact foo a b h` (`exact?`, `apply?`)
 * and `Try this:\n  rw [Nat.add_comm]\n  -- no goals` (`rw?`); `Try these:`
 * lists one per bullet. Everything after the header up to the first comment,
 * blank line, unindented line or next bullet is the suggestion; a term core
 * wrapped over more lines is rejoined with one space (the elaborator, through
 * `checkRewrite`, still has the last word on whether it reads back).
 */
export function parseTryThis(message: string): string | null {
  const m = HEADER.exec(message);
  if (!m) return null;
  const rest = message.slice(m[0].length);
  const lines = rest.split("\n");
  const parts: string[] = [];
  const first = lines[0].trim();
  // The one-line form `Try this: exact foo` — nothing else follows it.
  if (first !== "") return clean(first);
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (line === "" || line.startsWith("--")) break;
    if (!/^[ \t]/.test(raw)) break;
    if (parts.length > 0 && BULLET.test(line)) break;
    parts.push(line);
  }
  if (parts.length === 0) return null;
  return clean(parts.join(" "));
}

function clean(s: string): string | null {
  const t = s.replace(BULLET, "").replace(TAG, "").trim();
  return t === "" ? null : t;
}

/** Every `Try this` among the raw diagnostics that touches `span` (the
 proof's own extent), in their own order. */
export function searchSuggestions(
  raw: readonly RawDiagnostic[],
  span: { start: Pos; stop: Pos } | null,
): SearchSuggestion[] {
  const out: SearchSuggestion[] = [];
  for (const d of raw) {
    if (d.isSilent) continue;
    const text = parseTryThis(d.message ?? "");
    if (!text) continue;
    if (span && !(posLE(span.start, d.range.start) && posLE(d.range.start, span.stop)))
      continue;
    out.push({ start: d.range.start, stop: d.range.stop, text });
  }
  return out;
}

/** The head of a tactic's source, `?` kept: `exact?`, `rw?`. */
export const searchHead = (text: string): string => headWord(text, true);

/** The pill's line: "write what `exact?` found". */
export const searchTitle = (head: string): string =>
  expandTitle(head).replace(/ used$/, " found");

/**
 * The rewrite that writes `s` over `node`'s own tight range, where `node` is
 * an `exact?`/`apply?`/`rw?` step and the suggestion starts inside it.
 */
export function searchRewrite(
  node: TreeNode,
  s: SearchSuggestion,
  ctx: RewriteCtx,
): Proposal {
  const no = (why: string): Proposal => ({ ok: false, why });
  if (node.type !== "tactic" || !node.position) return no("no source for this step");
  const me = ctx.src(node.position.start);
  if (!me) return no("no source for this step");
  if (!verbatim(me)) return no("the tactic's source is not available verbatim");
  const head = searchHead(me.text);
  if (!SEARCH_HEADS.has(head)) return no(`\`${head}\` is not a search tactic`);
  if (!(posLE(me.start, s.start) && posLE(s.start, me.stop)))
    return no("the suggestion is not on this step");
  if (me.text.trim() === s.text) return no("the source already says it");
  return {
    ok: true,
    rewrite: {
      kind: "expand",
      nodeId: node.id,
      name: head,
      targetId: node.id,
      edits: [{ range: { start: me.start, end: me.stop }, newText: s.text }],
      title: searchTitle(head),
    },
  };
}

/** Every node a suggestion answers, with its rewrite: the innermost search
 step whose own range holds the suggestion's start. */
export function searchFixes(
  suggestions: readonly SearchSuggestion[],
  ctx: RewriteCtx,
): Map<string, Rewrite> {
  const out = new Map<string, Rewrite>();
  if (suggestions.length === 0) return out;
  for (const s of suggestions) {
    let best: TreeNode | null = null;
    for (const n of ctx.nodes) {
      if (n.type !== "tactic" || !n.position || n.traceLeaf) continue;
      if (!(posLE(n.position.start, s.start) && posLE(s.start, n.position.stop))) continue;
      if (!best || posLE(best.position!.start, n.position.start)) best = n;
    }
    if (!best || out.has(best.id)) continue;
    const p = searchRewrite(best, s, ctx);
    if (p.ok) out.set(best.id, p.rewrite);
  }
  return out;
}
