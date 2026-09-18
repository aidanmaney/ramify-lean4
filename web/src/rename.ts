// D5 — RENAME A HYPOTHESIS TO MATHLIB'S CONVENTION.
//
// The fifth entry of Workstream D's catalogue, and the smallest of them: no
// step is added or removed, no structure changes, and the proof after the move
// is the proof before it with one word spelled the way the library spells it.
// It is still a PROPOSAL in the D1 idiom — the client computes the edits, the
// elaborator is asked whether they hold (`ProofTree.checkRewrite`), and only
// then is the reader offered the write.
//
// ── Where the table comes from ──────────────────────────────────────────────
//
// Mathlib has no naming rule for HYPOTHESES in its style guide (the naming
// conventions page governs THEOREM names). So the table below was MEASURED
// over Mathlib itself, at the toolchain this repo pins
// (`lean/.lake/packages/mathlib`), by counting binder names against binder
// types over `Mathlib/`. The counts are in the design record (2026-09-09);
// the finding is one rule, not nine:
//
//   the name is `h` followed by the SUBJECT LETTERS of the type.
//
//   0 < x    ha 245 · hr 204 · hn 172 · hb 160 · hx 154   … hpos  23
//   a ≤ b    hab 255 · hmn 106 · hbc 59 · hij 54          … hle   66
//   a < b    hab 124 · hxy 102 · hmn 35                   … hlt   16
//   x ≠ 0    hn 569 · ha 468 · hx 394                     … hne    1
//   a ∣ b    hab 18 · hba 15 · hpq 13 · hmn 10            … hdvd  11
//   Even n   hn 39 · ha 13                                … heven  3
//   p.Prime  hp 147 · hq 3                                … hpri   2
//   x ∈ s    hx 596 · ha 241 · hy 170                     … hs    43  (the
//                                                            ELEMENT, not
//                                                            the set)
//   ¬ P x    ha 71 · hb 52 · hs 33 · hx 24
//
// (`h` itself outranks every name for the binary relations, and is exactly the
// name this move renames FROM, so it is not a candidate.)
//
// Two of those rows settled a question the brief had guessed at the other way.
// `x ∈ s` names the ELEMENT and not the set. And a NEGATION is named exactly
// as its positive is — there is no `hn…` prefix in Mathlib's practice (`¬ P x`
// is `ha`/`hx`, the subject's own letter), so `¬` is STRIPPED before the table
// is consulted and the polarity does not reach the name. Each rule still
// records the predicate-form alternate (`hpos`, `hle`, `hdvd`, …) because it
// is a real minority idiom, but the pill offers the PRIMARY alone: a gesture
// that asked which of two names you wanted would be a dialogue, not a click.
//
// ── What is never renamed ───────────────────────────────────────────────────
//
//  * A name the author CHOSE. Only the generic ones are candidates (`h`, `h1`,
//    `H`, `hyp`, `this`, `x_1`); anything else is a word the author picked and
//    is not ours to replace (CLAUDE.md's standing rule).
//  * A name that would SHADOW one already bound where the rename applies —
//    checked over the introducing step's own subtree, which is the scope the
//    edit reaches.
//  * A hypothesis whose binder the elaborator did not count uses for: one of
//    the declaration's own statement binders, a `rintro`/`rcases` pattern, or
//    a hypothesis re-minted by `rw … at h` (B2's first-writer rule points it
//    at the `rw`, which binds no name of its own).
//  * Anything whose steps are not available VERBATIM. Every edit is cut at a
//    computed offset in the step's own source, so a pretty-print would delete
//    the wrong bytes — the same rule D1 states and for the same reason.
import type { TreeNode, HypLine } from "./types";
import type { Pos, Proposal, RewriteCtx, RewriteEdit } from "./rewrite";
import {
  topLevelAssign,
  advance,
  occurrences,
  verbatim,
  ctxIndex,
  ctxNode,
} from "./rewrite";

const no = (why: string): Proposal => ({ ok: false, why });

/* ── Generic names ────────────────────────────────────────────────────────── */

/** The names nobody chose. `h`/`H`/`hyp`/`this` are the anonymous idioms; `h1`
 `h2` `h₁` are the same name numbered; `x_1` is what Lean itself mints when it
 has to make a binder unique. Everything else is a word the author wrote, and
 the standing rule is that we do not replace it. */
export function isGenericName(name: string): boolean {
  return (
    /^[hH][0-9₀-₉]*$/.test(name) ||
    name === "hyp" ||
    name === "this" ||
    /^[a-zA-Z]_[0-9]+$/.test(name)
  );
}

/* ── The table ────────────────────────────────────────────────────────────── */

/** A subject is a plain VARIABLE — one letter, optionally numbered or primed.
 `Nat.factorial N + 1` has no subject letter, and a rule that matched it would
 have no name to build, so the shape is declined instead. */
const SUBJ = "([A-Za-z][0-9₀-₉']?)";
const NUM = "(?:[0-9]+)";

export interface NameRule {
  /** Probe- and record-facing name for the shape. */
  id: string;
  /** The shape in the reader's words, for the `<title>` and the record. */
  what: string;
  /** Over the NORMALISED type: whitespace collapsed, `¬` stripped, outer
   parentheses removed. Anchored, so a rule never fires on a fragment. */
  test: RegExp;
  /** Which captured groups are the subjects, in the order their letters go
   into the name. */
  subjects: number[];
  /** The PREDICATE-form name Mathlib also uses for this shape. Recorded, and
   deliberately not offered. */
  alt: string;
}

/** One table, in order: the first rule that matches decides. `pos` sits before
 `lt` and `ne0` before `ne` because a numeral on one side takes the OTHER
 side's letter alone — `0 < x` is `hx`, never `h0x`. */
export const NAME_RULES: NameRule[] = [
  {
    id: "pos",
    what: "positivity",
    test: new RegExp(`^(?:${NUM} < ${SUBJ}|${SUBJ} > ${NUM})$`),
    subjects: [1, 2],
    alt: "hpos",
  },
  {
    id: "lt",
    what: "a strict order",
    test: new RegExp(`^${SUBJ} < ${SUBJ}$`),
    subjects: [1, 2],
    alt: "hlt",
  },
  {
    id: "le",
    what: "an order",
    test: new RegExp(`^${SUBJ} ≤ ${SUBJ}$`),
    subjects: [1, 2],
    alt: "hle",
  },
  {
    id: "ne-num",
    what: "a disequality with a numeral",
    test: new RegExp(`^(?:${SUBJ} ≠ ${NUM}|${NUM} ≠ ${SUBJ})$`),
    subjects: [1, 2],
    alt: "hne",
  },
  {
    id: "ne",
    what: "a disequality",
    test: new RegExp(`^${SUBJ} ≠ ${SUBJ}$`),
    subjects: [1, 2],
    alt: "hne",
  },
  {
    id: "dvd",
    what: "divisibility",
    test: new RegExp(`^${SUBJ} ∣ ${SUBJ}$`),
    subjects: [1, 2],
    alt: "hdvd",
  },
  {
    id: "mem",
    what: "membership",
    // The ELEMENT names it, not the collection — measured 596 to 43.
    test: new RegExp(`^${SUBJ} ∈ ${SUBJ}$`),
    subjects: [1],
    alt: "hmem",
  },
  {
    id: "even",
    what: "parity",
    test: new RegExp(`^Even ${SUBJ}$`),
    subjects: [1],
    alt: "heven",
  },
  {
    id: "odd",
    what: "parity",
    test: new RegExp(`^Odd ${SUBJ}$`),
    subjects: [1],
    alt: "hodd",
  },
  {
    id: "prime",
    what: "primality",
    test: new RegExp(`^(?:${SUBJ}\\.Prime|(?:Nat\\.)?Prime ${SUBJ})$`),
    subjects: [1, 2],
    alt: "hp",
  },
];

/** Whitespace collapsed, every leading `¬` stripped, outer parentheses
 removed. The polarity is deliberately dropped: Mathlib names `¬ P x` the way
 it names `P x` (measured), so it must not reach the name. */
export function normaliseType(type: string): string {
  let t = type.replace(/\s+/g, " ").trim();
  for (;;) {
    if (t.startsWith("¬")) {
      t = t.slice(1).trim();
      continue;
    }
    if (t.startsWith("(") && t.endsWith(")")) {
      // Only where the outer pair really is a pair.
      let depth = 0;
      let outer = true;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === "(") depth++;
        else if (t[i] === ")") {
          depth--;
          if (depth === 0 && i < t.length - 1) outer = false;
        }
      }
      if (outer) {
        t = t.slice(1, -1).trim();
        continue;
      }
    }
    return t;
  }
}

export interface Suggestion {
  /** The name the pill offers. */
  name: string;
  /** Which rule decided it, for the `<title>` and the probe. */
  rule: NameRule;
  /** The predicate form, recorded and not offered. */
  alt: string;
}

/** The convention's name for a hypothesis of this type, or null where no rule
 in the table recognises the shape. */
export function suggestName(type: string): Suggestion | null {
  const t = normaliseType(type);
  for (const r of NAME_RULES) {
    const m = r.test.exec(t);
    if (!m) continue;
    const parts = r.subjects
      .map((i) => m[i])
      .filter((s): s is string => !!s)
      .map((s) => s.replace(/'/g, ""));
    if (parts.length === 0) continue;
    return { name: "h" + parts.join(""), rule: r, alt: r.alt };
  }
  return null;
}

/* ── The move ─────────────────────────────────────────────────────────────── */

/** The part of an introducing step that BINDS. For a `have`/`obtain` that is
 everything before the top-level `:=`; for `intro`/`by_contra` there is no
 `:=` and the whole text binds. Rename never touches the justification: an `h`
 to the right of `:=` is a term from an enclosing scope, not this binder. */
function binderPart(text: string): string {
  const cut = topLevelAssign(text);
  return cut < 0 ? text : text.slice(0, cut);
}

/** Every goal drawn at or below a step — the scope the rename's edits reach,
 and so the scope a shadow would be a shadow in. */
function scopeNames(
  node: TreeNode,
  kids: Map<string, TreeNode[]>,
): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const stack = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    for (const h of n.hyps ?? []) if (h.hypName) out.add(h.hypName);
    for (const k of kids.get(n.id) ?? []) stack.push(k);
  }
  return out;
}

/** D5 — RENAME ONE HYPOTHESIS. `line` is the context line the gesture was made
 on (its `hypName`/`hypType` are the elaborator's own, not a parse of the
 printed line); `goal` is the node it is drawn in. */
export function renameRewrite(
  goal: TreeNode,
  line: HypLine,
  ctx: RewriteCtx,
): Proposal {
  const name = line.hypName;
  const type = line.hypType;
  if (!name || !type) return no("this line is not a hypothesis");
  if (!isGenericName(name))
    return no(`\`${name}\` is a name the author chose`);

  const sug = suggestName(type);
  if (!sug) return no("no Mathlib convention covers that type");
  if (sug.name === name) return no("it is already named by the convention");

  if (!line.origin)
    return no("this hypothesis comes from the statement, not from a step");
  const intro = ctxNode(ctx, line.origin);
  if (!intro?.position) return no("the step that introduced it is not drawn");
  const entry = (intro.usesEach ?? []).find((u) => u.name === name);
  if (!entry)
    return no(`the elaborator counted no uses for \`${name}\``);
  if (entry.users.length !== entry.count)
    return no("a step that uses it is not drawn");

  if (scopeNames(intro, ctxIndex(ctx).kids).has(sug.name))
    return no(`\`${sug.name}\` is already bound here`);

  // The binder itself.
  const src = ctx.src(intro.position.start);
  if (!src) return no("no source for the step that introduced it");
  if (!verbatim(src))
    return no("the introducing step's source is not available verbatim");
  const bind = binderPart(src.text);
  const at = occurrences(bind, name);
  if (at.length === 0) return no(`the step does not name \`${name}\` directly`);
  if (at.length > 1)
    return no(`\`${name}\` is written ${at.length} times in its binder`);
  if (occurrences(src.text, sug.name).length > 0)
    return no(`\`${sug.name}\` already appears in that step`);

  const edits: RewriteEdit[] = [
    {
      range: {
        start: advance(src.start, src.text, at[0]),
        end: advance(src.start, src.text, at[0] + name.length),
      },
      newText: sug.name,
    },
  ];

  // Every step the elaborator says READS it. A step that reads it without
  // naming it (`omega` off the context) needs no edit and is not an obstacle;
  // a step whose text we cannot see is, because we would be renaming a binder
  // whose readers we cannot follow.
  for (const uid of entry.users) {
    const u = ctxNode(ctx, uid);
    if (!u?.position) return no("a step that uses it is not drawn");
    const us = ctx.src(u.position.start);
    if (!us) return no("no source for a step that uses it");
    if (!verbatim(us))
      return no("a using step's source is not available verbatim");
    if (occurrences(us.text, sug.name).length > 0)
      return no(`\`${sug.name}\` already appears in a step that uses it`);
    for (const i of occurrences(us.text, name))
      edits.push({
        range: {
          start: advance(us.start, us.text, i),
          end: advance(us.start, us.text, i + name.length),
        },
        newText: sug.name,
      });
  }

  edits.sort(
    (a, b) =>
      a.range.start.line - b.range.start.line ||
      a.range.start.character - b.range.start.character,
  );
  // Two steps can share a line (`intro h; exact h`), so disjointness is
  // checked rather than assumed: overlapping ranges in one `applyEdit` are an
  // editor error, not a rewrite.
  let prev: Pos | null = null;
  for (const e of edits) {
    if (
      prev &&
      (e.range.start.line < prev.line ||
        (e.range.start.line === prev.line &&
          e.range.start.character < prev.character))
    )
      return no("the occurrences overlap");
    prev = e.range.end;
  }

  return {
    ok: true,
    rewrite: {
      kind: "rename",
      nodeId: goal.id,
      name,
      targetId: intro.id,
      edits,
      title: `rename \`${name}\` → \`${sug.name}\``,
    },
  };
}

/** Every rename this goal's context lines offer, keyed by the line's index in
 the node's own (possibly reflowed) `hyps`. One pass, so the view can ask once
 per drawn tree; a continuation piece carries the same hypothesis and so the
 same offer, and both indices answer. */
export function renamesFor(
  goal: TreeNode,
  ctx: RewriteCtx,
): Map<number, { rewrite: import("./rewrite").Rewrite; to: string; rule: NameRule }> {
  const out = new Map<
    number,
    { rewrite: import("./rewrite").Rewrite; to: string; rule: NameRule }
  >();
  const lines = goal.hyps ?? [];
  const done = new Map<string, ReturnType<typeof renameRewrite>>();
  for (let j = 0; j < lines.length; j++) {
    const l = lines[j];
    if (!l.hypName || !l.hypType) continue;
    const key = `${l.hypName} ${l.hypType}`;
    let p = done.get(key);
    if (!p) {
      p = renameRewrite(goal, l, ctx);
      done.set(key, p);
    }
    if (!p.ok) continue;
    const sug = suggestName(l.hypType)!;
    out.set(j, { rewrite: p.rewrite, to: sug.name, rule: sug.rule });
  }
  return out;
}
