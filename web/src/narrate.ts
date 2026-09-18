/** C2/C3 — TEMPLATED STEP NARRATION and RECURSIVE SUMMARIZATION.
 *
 * One template per tactic KIND, chosen from the B5 `branch.form` (the syntax
 * kind the server decoded) first and the head word second — never from an
 * argument index, and never by a regex over the whole label where the
 * elaborator's own data answers. The inputs are what the tree already holds
 * per node: the branch sidecar (form / discriminant / arms / binders /
 * patterns), the B3 lemma references with their docstrings and `ConstantInfo`
 * kinds, the B4 automation trace, the B2 hypothesis origins (a step's new
 * hypotheses are the child goal's `HypLine`s whose `origin` is this step), the
 * recovery kind, and the calc ledger.
 *
 * This module is PURE and offline-probeable: `npm run probe -- narrate`
 * measures coverage over the CLI corpus and prints the residue.
 *
 * It deliberately does NOT duplicate `briefLabel.ts`'s job. Brief mode gives
 * each canonical move a SYMBOL beside its own source text; narration replaces
 * the source text with an English sentence. Two different readings, one tree.
 */
import type { TreeNode, HypLine } from "./types";
import { tacticHead, tacticKeyword, childIndex } from "./elide";
import { posKey } from "./proofToTree";

/** The glyph a GENERATED strip wears, written INTO the text so `commentSize`
 measures exactly what is painted (the `SEED_MARK` idiom). `∴` — "therefore",
 the mark a reader already knows for a line that FOLLOWS from what is above
 rather than one a person wrote. Strips are italic comment ink either way, so
 the glyph, not the styling, is what tells the two voices apart. */
export const NARRATE_MARK = "∴ ";

/** One narrated line's cap. Two strip lines at the default width is roughly
 this, and the strip's own 2-line clamp catches anything the wrap disagrees
 about. */
const LINE_CAP = 90;

/** A summary's cap: the 1–3 lines the recursion is bounded to. */
const SUMMARY_CAP = 260;

/** How much of a goal or a type is quoted inside a clause. */
const CLAUSE_CAP = 46;

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

function clip(s: string, cap: number): string {
  const t = flat(s);
  if (t.length <= cap) return t;
  const sp = t.lastIndexOf(" ", cap - 1);
  return `${(sp > cap / 2 ? t.slice(0, sp) : t.slice(0, cap - 1)).trimEnd()}…`;
}

/** A goal's statement, without the `⊢ ` the tree's labels carry. */
const goalText = (n: TreeNode | undefined): string =>
  n ? flat(n.label.replace(/^⊢\s*/, "")) : "";

export interface NarrateCtx {
  byId: Map<string, TreeNode>;
  kids: Map<string, TreeNode[]>;
  /** Per-node memos. `summarize` asks for every node's line and every node's
   subtree count, and a summary folds its children's lines in, so a chain of n
   steps asked for the same line n times and walked the same subtree n times.
   The tree is immutable for the life of a context, so one map each turns the
   fold into one bottom-up pass. Keyed by node id (and, for a line, by whether
   the closing statement is wanted). */
  lines: Map<string, string>;
  below: Map<string, number>;
}

export function narrateCtx(nodes: TreeNode[]): NarrateCtx {
  return {
    byId: new Map(nodes.map((n) => [n.id, n])),
    kids: childIndex(nodes),
    lines: new Map(),
    below: new Map(),
  };
}

const childrenOf = (n: TreeNode, ctx: NarrateCtx) => ctx.kids.get(n.id) ?? [];
const parentOf = (n: TreeNode, ctx: NarrateCtx) =>
  ctx.byId.get(n.parents[0]?.id ?? "");

/** The goals this step opened, split the way the summary reads them: the
 obligations it SPAWNED (a `have`'s `by` block, a side condition) against the
 continuation(s) the reader goes on with. */
function opened(n: TreeNode, ctx: NarrateCtx) {
  const goals = childrenOf(n, ctx).filter((c) => c.type === "goal");
  return {
    proof: goals.filter((g) => g.spawned || g.side),
    main: goals.filter((g) => !g.spawned && !g.side),
  };
}

/** B2 — the hypotheses THIS step put into the context, read off the goal it
 produced rather than off its own text. */
function newHyps(n: TreeNode, ctx: NarrateCtx): HypLine[] {
  for (const g of childrenOf(n, ctx)) {
    if (g.type !== "goal") continue;
    const mine = (g.hyps ?? []).filter((h) => h.origin === n.id && !h.cont);
    if (mine.length > 0) return mine;
  }
  return [];
}

/** A context line as a name and a statement. D5 carries both structurally
 (`hypName`/`hypType`, the elaborator's own), so they are read where they are
 there and the printed line is parsed only where they are not. */
const splitHyp = (h: HypLine): { name: string; type: string } => {
  if (h.hypName !== undefined)
    return { name: flat(h.hypName), type: flat(h.hypType ?? "") };
  const i = h.text.indexOf(" : ");
  return i < 0
    ? { name: flat(h.text), type: "" }
    : { name: flat(h.text.slice(0, i)), type: flat(h.text.slice(i + 3)) };
};

/** Is this hypothesis a PROPOSITION being assumed, or a piece of data being
 named? There is no `isProp` on the wire, so the type's own shape answers:
 anything carrying a relation, a connective or a binder reads as a statement;
 a bare type expression (`ℕ`, `Finset α`, `Type u`) reads as data. */
const PROP_CHARS = /[=≤≥<>∈∉∣∧∨↔¬→∀∃≠⊆≡]/;
const isProp = (type: string) => PROP_CHARS.test(type);

/** The names a `rw`/`simp only` rewrote with. B3's `lemmas` where the step
 named constants; otherwise the rule list itself, which is `rw`'s own syntax
 (`rw [rules]`) and not an argument index. */
function rewriteRules(n: TreeNode): string[] {
  const named = (n.lemmas ?? [])
    .filter((l) => l.kind !== "def" || /_/.test(l.name))
    .map((l) => l.name);
  const open = n.label.indexOf("[");
  const close = n.label.lastIndexOf("]");
  if (open >= 0 && close > open) {
    const inner = n.label.slice(open + 1, close);
    const parts: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of inner) {
      if ("([{⟨".includes(ch)) depth++;
      if (")]}⟩".includes(ch)) depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    parts.push(cur);
    const rules = parts.map((p) => flat(p)).filter((p) => p !== "");
    if (rules.length > 0) return rules;
  }
  return named;
}

/** Where a tactic says `at h` / `at h ⊢`, the place it acted on. */
function atClause(n: TreeNode): string {
  const m = /\bat\s+([^\n]+)$/.exec(flat(n.label));
  return m ? ` in ${clip(m[1], 24)}` : "";
}

/** The LEMMA a closing step is: B3's references, preferring what the
 environment calls a theorem over the definitions and constructors that any
 term mentions in passing. */
function principalLemma(n: TreeNode) {
  const ls = n.lemmas ?? [];
  return (
    ls.find((l) => l.kind === "theorem" || l.kind === "axiom") ??
    ls.find((l) => l.kind !== "ctor" && l.kind !== "rec") ??
    ls[0]
  );
}

/** A docstring's first sentence, for the clause after "This is exactly `X`". */
function docClause(doc: string | undefined): string {
  if (!doc) return "";
  const one = flat(doc);
  const m = /[.!?](?=\s|$)/.exec(one);
  const s = m ? one.slice(0, m.index) : one;
  return s ? ` — ${clip(s, 52)}` : "";
}

const list = (xs: string[], cap = 3): string => {
  const kept = xs.slice(0, cap);
  const more = xs.length - kept.length;
  return kept.join(", ") + (more > 0 ? `, …` : "");
};

/** The case name a goal reads under: B5's arm (tag plus what it binds) where
 there is one, else the label family's own badge. */
export function caseName(g: TreeNode): string {
  if (g.arm) {
    const tag = g.arm.tag || g.arm.pattern || "";
    if (tag) return g.arm.binders.length ? `${tag} (${g.arm.binders.join(", ")})` : tag;
  }
  return g.caseLabel ?? "";
}

/** The families a template is written for. `branch.form` answers first — it is
 the syntax kind the server decoded — and the head word second. */
const FORM_FAMILY: Record<string, string> = {
  rewrite: "rw",
  obtain: "obtain",
  rcases: "cases",
  match: "cases",
  split: "cases",
  interval_cases: "cases",
  fin_cases: "cases",
  induction: "induction",
  by_cases: "by_cases",
  rintro: "intro",
  constructor: "constructor",
  refine: "refine",
};

const HEAD_FAMILY: Record<string, string> = {
  intro: "intro",
  intros: "intro",
  rintro: "intro",
  have: "have",
  suffices: "suffices",
  obtain: "obtain",
  let: "let",
  set: "let",
  induction: "induction",
  cases: "cases",
  rcases: "cases",
  match: "cases",
  split: "cases",
  by_cases: "by_cases",
  constructor: "constructor",
  refine: "refine",
  exact: "exact",
  apply: "apply",
  exact_mod_cast: "exact",
  rw: "rw",
  rewrite: "rw",
  simp_rw: "rw",
  unfold: "unfold",
  delta: "unfold",
  show: "show",
  change: "show",
  rfl: "rfl",
  trivial: "rfl",
  simp: "auto",
  simp_all: "auto",
  grind: "auto",
  omega: "auto",
  linarith: "auto",
  nlinarith: "auto",
  positivity: "auto",
  decide: "auto",
  norm_num: "auto",
  push_cast: "auto",
  ring: "auto",
  ring_nf: "auto",
  field_simp: "auto",
  aesop: "auto",
  tauto: "auto",
  exfalso: "exfalso",
  by_contra: "by_contra",
  push_neg: "push_neg",
  use: "use",
  exists: "use",
  refine_lift: "refine",
  specialize: "specialize",
  subst: "subst",
  ext: "ext",
  funext: "ext",
  left: "side",
  right: "side",
  contradiction: "contradiction",
  assumption: "assumption",
  calc: "calc",
  sorry: "sorry",
  gcongr: "auto",
  bound: "auto",
  norm_cast: "auto",
  convert: "apply",
};

/** The head word a template dispatches on: a leading bullet is chrome, not a
 tactic, so it is stepped over rather than dispatched on. */
export function narrateHead(label: string): string {
  const first = flat(label.split("\n")[0]).replace(/^[·•]\s*/, "");
  return tacticKeyword(first);
}

/** The family, or `""` where nothing in the table claims this step — the
 RESIDUE the probe counts and reports. */
export function narrateFamily(n: TreeNode): string {
  // The ledger says WHICH ledger; `chain` alone would read a structured term
  // as a chain of (in)equalities, which is the one thing it is not.
  if (n.ledgerKind === "ctor") return "ctor";
  if (n.ledger || n.chain) return "calc";
  if (n.recovered === "term" || n.recovered === "subterm") return "term";
  if (n.recovered === "failed") return "failed";
  if (n.recovered === "skipped") return "sorry";
  const form = n.branch?.form;
  if (form && FORM_FAMILY[form]) return FORM_FAMILY[form];
  return HEAD_FAMILY[narrateHead(n.label)] ?? "";
}

/** Did a template claim this step, or is it the residue's `Then …`? */
export const isNarrated = (n: TreeNode): boolean => narrateFamily(n) !== "";

/* ------------------------------------------------------------------ */
/* The templates                                                       */
/* ------------------------------------------------------------------ */

function bindersLine(n: TreeNode, ctx: NarrateCtx): string {
  const hs = newHyps(n, ctx);
  if (hs.length === 0) {
    const pats = (n.branch?.arms ?? [])
      .map((a) => a.pattern)
      .filter((p): p is string => !!p);
    if (pats.length > 0) return `Introduce ${list(pats)}`;
    const rest = flat(n.label).replace(/^\S+\s*/, "");
    return rest ? `Introduce ${clip(rest, 40)}` : "Introduce the binders";
  }
  const props = hs.map(splitHyp).filter((h) => isProp(h.type));
  const data = hs.map(splitHyp).filter((h) => !isProp(h.type));
  const bits: string[] = [];
  if (data.length > 0)
    bits.push(
      `Let ${list(data.map((d) => (d.type ? `${d.name} : ${d.type}` : d.name)))} be given`,
    );
  if (props.length > 0)
    bits.push(
      `Assume ${list(props.map((p) => `${p.name} : ${clip(p.type, CLAUSE_CAP)}`), 2)}`,
    );
  return bits.join("; ");
}

function haveLine(n: TreeNode, ctx: NarrateCtx, word: string): string {
  const hs = newHyps(n, ctx);
  if (hs.length > 0) {
    const { name, type } = splitHyp(hs[0]);
    return type
      ? `${word}, note that ${name} : ${clip(type, LINE_CAP - word.length - 14)}`
      : `${word}, note ${name}`;
  }
  // No origin in hand (an anonymous `have`, or a wire with no `hypOrigins`):
  // the `have` SYNTAX still says where the statement is — between the name and
  // the `:=` — which is a kind-driven read, not an argument index.
  const text = flat(n.label).replace(/^\S+\s*/, "");
  const body = text.split(" := ")[0];
  const colon = body.indexOf(" : ");
  const stmt = colon >= 0 ? body.slice(colon + 3) : body;
  return `${word}, note that ${clip(stmt, LINE_CAP - word.length - 14)}`;
}

function casePatterns(n: TreeNode, ctx: NarrateCtx): string[] {
  const arms = n.branch?.arms ?? [];
  if (arms.length > 0)
    return arms.map((a) => {
      const tag = a.tag || a.pattern || "";
      return a.binders.length ? `${tag} (${a.binders.join(", ")})` : tag;
    });
  // `arms` empty means the server recognised the FORM and not its arms: the
  // goals it produced carry their own arm, which is where `obtain`'s pattern
  // lives.
  return childrenOf(n, ctx)
    .filter((g) => g.type === "goal")
    .map((g) => caseName(g))
    .filter((s) => s !== "");
}

function template(n: TreeNode, ctx: NarrateCtx): string {
  const fam = narrateFamily(n);
  const on = n.branch?.on ? clip(n.branch.on, 34) : "";
  const head = narrateHead(n.label);

  switch (fam) {
    case "intro":
      return bindersLine(n, ctx);

    case "have":
      return haveLine(n, ctx, "First");
    case "suffices":
      return `It suffices to show ${clip(flat(n.label).replace(/^\S+\s*/, ""), 60)}`;
    case "let":
      return haveLine(n, ctx, "Write");

    case "obtain": {
      const pats = casePatterns(n, ctx);
      const src = on || clip(flat(n.label).split(":=")[1] ?? "", 30);
      if (pats.length > 1)
        return `Split ${src || "it"} into ${list(pats)}`;
      return pats[0]
        ? `Write ${src || "it"} as ${pats[0]}`
        : `Take ${src || "it"} apart`;
    }

    case "cases": {
      const pats = casePatterns(n, ctx);
      const src = on || "it";
      return pats.length > 0
        ? `Case on ${src}: ${list(pats, 4)}`
        : `Case on ${src}`;
    }

    case "induction": {
      const pats = casePatterns(n, ctx);
      return pats.length > 0
        ? `By induction on ${on || "it"}: ${list(pats, 4)}`
        : `By induction on ${on || "it"}`;
    }

    case "by_cases":
      return `Either ${on || "it"} holds or it does not`;

    case "constructor":
      return `Prove both parts`;

    case "refine": {
      const holes = (n.label.match(/\?_/g) ?? []).length;
      const arms = n.branch?.arms.length ?? holes;
      return arms > 0
        ? `It suffices to give ${arms} part${arms === 1 ? "" : "s"}`
        : `Give the goal's shape, leaving the parts open`;
    }

    case "exact":
    case "apply": {
      const l = principalLemma(n);
      const verb = fam === "exact" ? "This is exactly" : "Apply";
      if (l) return clip(`${verb} ${l.name}${docClause(l.doc)}`, LINE_CAP);
      const arg = flat(n.label).replace(/^\S+\s*/, "");
      return clip(
        fam === "exact" ? `This is exactly ${arg}` : `Apply ${arg}`,
        LINE_CAP,
      );
    }

    case "rw": {
      const rules = rewriteRules(n);
      const only = /^simp\b/.test(head);
      const verb = only ? "Simplify with" : "Rewriting with";
      return rules.length > 0
        ? clip(`${verb} ${list(rules)}${atClause(n)}`, LINE_CAP)
        : `Rewrite the goal${atClause(n)}`;
    }

    case "auto": {
      const t = n.trace;
      if (t?.kind === "lemmas" && t.lemmas?.length)
        return clip(
          `${head} used ${list(t.lemmas.map((l) => l.name), 4)}`,
          LINE_CAP,
        );
      const rules = /\[/.test(n.label) ? rewriteRules(n) : [];
      return rules.length > 0
        ? clip(`This is routine (${head} with ${list(rules)})${atClause(n)}`, LINE_CAP)
        : `This is routine (${head})${atClause(n)}`;
    }

    case "unfold":
      return clip(
        `Unfolding ${list(rewriteRules(n).length ? rewriteRules(n) : [flat(n.label).replace(/^\S+\s*/, "")])}${atClause(n)}`,
        LINE_CAP,
      );

    case "show":
      return clip(
        `Restate the goal as ${flat(n.label).replace(/^\S+\s*/, "")}`,
        LINE_CAP,
      );

    case "rfl":
      return `Both sides are the same`;

    case "exfalso":
      return `Derive a contradiction instead`;
    case "by_contra": {
      const hs = newHyps(n, ctx);
      const h = hs[0] ? splitHyp(hs[0]) : null;
      return h
        ? clip(`Suppose not: ${h.name} : ${h.type}`, LINE_CAP)
        : `Suppose the goal fails`;
    }
    case "push_neg":
      return `Push the negation inwards${atClause(n)}`;

    case "use":
      return clip(
        `Take ${flat(n.label).replace(/^\S+\s*/, "") || "the witness"}`,
        LINE_CAP,
      );

    case "specialize":
      return clip(
        `Specialise ${flat(n.label).replace(/^\S+\s*/, "")}`,
        LINE_CAP,
      );
    case "subst":
      return clip(
        `Substitute ${flat(n.label).replace(/^\S+\s*/, "")} throughout`,
        LINE_CAP,
      );
    case "ext":
      return `Compare them pointwise`;
    case "side":
      return head === "left" ? `Take the left alternative` : `Take the right alternative`;
    case "contradiction":
      return `The assumptions already contradict each other`;
    case "assumption":
      return `This is one of the assumptions`;

    case "calc":
    case "ctor": {
      // ONE body for the two LEDGER kinds, as the renderer has one: neither
      // the `calc` STEP nor the constructor's carries the rows — the ledger
      // hangs off the goal the step opened, which is where `proofToTree` puts
      // it — so both read it from there, by structure and not by index. All
      // that differs is the words.
      const [lead, sep, bare] =
        fam === "calc"
          ? ["Chain: ", " ", "A chain of (in)equalities"]
          : ["Prove each part: ", "; ", "Prove each part"];
      const ledger =
        n.ledger ?? childrenOf(n, ctx).find((c) => c.ledger)?.ledger ?? [];
      const rows = ledger.map((r) => flat(r.text)).filter((t) => t);
      return rows.length > 0 ? clip(lead + rows.join(sep), LINE_CAP) : bare;
    }

    case "term": {
      const text = flat(n.label);
      if (/^fun\b|^λ/.test(text)) return `Given the argument, ${clip(text, 52)}`;
      const l = principalLemma(n);
      if (l) return clip(`The term ${l.name}${docClause(l.doc)}`, LINE_CAP);
      return clip(`Give ${text}`, LINE_CAP);
    }

    case "failed":
      return `This step does not go through`;
    case "sorry":
      return `Left unproved (sorry)`;

    default: {
      // THE RESIDUE — counted and reported by `probe narrate`, never hidden.
      return clip(`Then ${tacticHead(n.label)}`, LINE_CAP);
    }
  }
}

/** One step's line. A tactic node only: goals read their own statement, so
 narrating them would say the label twice.
 *
 * `withGoal` names the statement a CLOSING step discharges. It is OFF for a
 * strip — the goal box sits directly above the tactic and would say it twice —
 * and ON inside a summary, where the goals have been folded away and the
 * statement is the only thing left that says what was closed. */
export function narrateStep(
  n: TreeNode,
  ctx: NarrateCtx,
  withGoal = false,
): string {
  if (n.type !== "tactic") return "";
  const memo = `${withGoal ? "G" : "L"}${n.id}`;
  const hit = ctx.lines.get(memo);
  if (hit !== undefined) return hit;
  const out = narrateStepLine(n, ctx, withGoal);
  ctx.lines.set(memo, out);
  return out;
}

function narrateStepLine(
  n: TreeNode,
  ctx: NarrateCtx,
  withGoal: boolean,
): string {
  const line = template(n, ctx);
  if (!withGoal) return line;
  const kidsGoals = childrenOf(n, ctx).filter((c) => c.type === "goal");
  if (kidsGoals.length === 0 && line.length + 12 < LINE_CAP) {
    const g = parentOf(n, ctx);
    const stmt = goalText(g);
    if (stmt && !line.includes(stmt.slice(0, 12)))
      return clip(`${line}, giving ${stmt}`, LINE_CAP);
  }
  return line;
}

/* ------------------------------------------------------------------ */
/* C3 — recursive summarization                                        */
/* ------------------------------------------------------------------ */

/** How many levels of children a summary expands before it counts instead.
 One: a summary is 1–3 lines, and a reader looking at a folded goal wants the
 shape of what is under it, not its transcript. */
const SUMMARY_DEPTH = 1;

function tacticsBelow(id: string, ctx: NarrateCtx): number {
  const hit = ctx.below.get(id);
  if (hit !== undefined) return hit;
  let n = 0;
  const seen = new Set<string>();
  const walk = (at: string) => {
    if (seen.has(at)) return;
    seen.add(at);
    for (const k of ctx.kids.get(at) ?? []) {
      if (k.type === "tactic") n++;
      walk(k.id);
    }
  };
  walk(id);
  ctx.below.set(id, n);
  return n;
}

const moreSteps = (k: number) => (k > 0 ? ` (${k} more step${k === 1 ? "" : "s"})` : "");

function summaryOfGoal(g: TreeNode, ctx: NarrateCtx, budget: number): string {
  const tac = childrenOf(g, ctx).filter((c) => c.type === "tactic");
  if (tac.length === 0) return "";
  const parts = tac.map((t) => summaryOfTactic(t, ctx, budget)).filter((s) => s);
  return parts.join("; then ");
}

function summaryOfTactic(t: TreeNode, ctx: NarrateCtx, budget: number): string {
  const head = narrateStep(t, ctx, true);
  if (budget <= 0) return head + moreSteps(tacticsBelow(t.id, ctx));

  const { proof, main } = opened(t, ctx);
  let out = head;
  if (proof.length > 0) {
    const inner = summaryOfGoal(proof[0], ctx, budget - 1);
    if (inner) out += ` (proved by: ${inner})`;
  }
  if (main.length === 1) {
    const rest = summaryOfGoal(main[0], ctx, budget - 1);
    if (rest) out += `; then ${rest}`;
  } else if (main.length > 1) {
    const arms = main
      .map((g) => {
        const inner = summaryOfGoal(g, ctx, budget - 1);
        const nm = caseName(g);
        return inner ? (nm ? `Case ${nm}: ${inner}` : inner) : nm ? `Case ${nm}` : "";
      })
      .filter((s) => s);
    if (arms.length > 0) out += ` — ${arms.join("; ")}`;
  }
  return out;
}

/** Every node's summary: its own template line folded together with its
 children's, by the tree's own `have` / case / linear structure. Deterministic
 and bounded — one level of children expanded, deeper ones as counts. */
export function summarize(nodes: TreeNode[], ctx = narrateCtx(nodes)): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of nodes)
    out.set(
      n.id,
      clip(
        n.type === "tactic"
          ? summaryOfTactic(n, ctx, SUMMARY_DEPTH)
          : summaryOfGoal(n, ctx, SUMMARY_DEPTH),
        SUMMARY_CAP,
      ),
    );
  return out;
}

/* ------------------------------------------------------------------ */
/* The strip                                                           */
/* ------------------------------------------------------------------ */

/** A HOP took one step and what it opened beside the continuation, so its
 summary is COMPOSED from the parts it names rather than read off the goal —
 the goal's own subtree is still on screen below it. */
function hopSummary(
  f: NonNullable<TreeNode["folded"]>,
  byPos: Map<string, TreeNode>,
  ctx: NarrateCtx,
): string {
  const hidden = f.parts
    .map((p) => (p.position ? byPos.get(posKey(p.position.start)) : undefined))
    .filter((n): n is TreeNode => !!n);
  const lines = hidden.slice(0, 2).map((n) => narrateStep(n, ctx, true));
  if (lines.length === 0)
    return `${f.tactics.length} step${f.tactics.length === 1 ? "" : "s"} hidden`;
  return lines.join("; then ") + moreSteps(Math.max(0, hidden.length - 2));
}

/** What each DRAWN node's strip says in `Comments: narrate`, keyed by id and
 already carrying `NARRATE_MARK`. Nodes the author commented are absent — the
 author's words win, and the strip draws them as it always has.
 *
 * `base` is the tree BEFORE the cuts: a folded goal's strip is the SUMMARY of
 * what it hides, which is the recursion paying off, and what it hides is no
 * longer in `drawn`. */
export interface Narration {
  /** Node id → the strip, `NARRATE_MARK` and all. */
  text: Map<string, string>;
  /** The context the lines were written from — over the base tree with the
   drawn tree's trace stamps carried back onto it. The polish request reads
   the same one, so the narration is computed ONCE per drawn tree and the two
   readers share both the lines and the walk that produced them. */
  ctx: NarrateCtx;
}

export function narrationFor(
  base: TreeNode[],
  drawn: TreeNode[],
): Map<string, string> {
  return narrationOf(base, drawn).text;
}

export function narrationOf(base: TreeNode[], drawn: TreeNode[]): Narration {
  // B4's traces are stamped by `applyTraces`, which runs on the DRAWN tree
  // (after the cuts), so a BASE node never carries one — and every template
  // below reads the node it is handed. Carry the stamps across before the
  // context is built, or an automation step narrates "This is routine (simp)"
  // with its lemma list already in hand, and so does every summary that folds
  // it in. (Measured 2026-09-09: this is why `probe narrate --print` never
  // printed a `simp used …` line.)
  const stamps = new Map<string, NonNullable<TreeNode["trace"]>>();
  for (const d of drawn) if (d.trace) stamps.set(d.id, d.trace);
  const traced =
    stamps.size === 0
      ? base
      : base.map((n) => {
          const t = n.trace ? undefined : stamps.get(n.id);
          return t ? { ...n, trace: t } : n;
        });
  const ctx = narrateCtx(traced);
  const sums = summarize(traced, ctx);
  const byPos = new Map<string, TreeNode>();
  for (const n of traced)
    if (n.type === "tactic" && n.position) byPos.set(posKey(n.position.start), n);

  const out = new Map<string, string>();
  for (const d of drawn) {
    if (d.comment || d.traceLeaf || d.elidedCut) continue;
    if (d.type === "tactic") {
      const src = ctx.byId.get(d.id) ?? d;
      const line = narrateStep(src, ctx);
      if (line) out.set(d.id, NARRATE_MARK + line);
      continue;
    }
    const f = d.folded;
    if (!f) continue;
    // A FOLD took everything below the goal, so the goal's own summary is
    // exactly what went. A HOP took one step and what it opened beside the
    // continuation, so the summary is composed from the parts it names.
    const text =
      f.kind === "fold" ? (sums.get(d.id) ?? "") : hopSummary(f, byPos, ctx);
    if (text) out.set(d.id, NARRATE_MARK + clip(text, SUMMARY_CAP));
  }
  return { text: out, ctx };
}

/** The drawn tree with the generated strips attached — narration is TEXT like
 any other comment, so it goes through `commentSize` and the 2-line clamp with
 no geometry of its own. Nodes that already carry the author's comment are
 returned untouched. */
export function applyNarration(
  drawn: TreeNode[],
  base: TreeNode[],
  polished?: ReadonlyMap<string, string>,
): TreeNode[] {
  return applyNarrationLines(drawn, narrationFor(base, drawn), polished);
}

/** The same write, over lines already in hand. A polish answer landing changes
 nothing about the templates, so the view keeps the narration in a memo of its
 own and comes here — the walk is not paid again for a sentence the companion
 rewrote. */
export function applyNarrationLines(
  drawn: TreeNode[],
  text: ReadonlyMap<string, string>,
  polished?: ReadonlyMap<string, string>,
): TreeNode[] {
  return drawn.map((n) => {
    const t = text.get(n.id);
    if (t === undefined) return n;
    const p = polished?.get(n.id);
    return { ...n, comment: p ? POLISH_MARK + clip(p, SUMMARY_CAP) : t };
  });
}

/* ------------------------------------------------------------------ */
/* C4 — the polish seam                                                */
/* ------------------------------------------------------------------ */

/** The glyph a POLISHED strip wears, in the `NARRATE_MARK` idiom: written
 INTO the string so `commentSize` measures what is painted, and different from
 the template's mark because the sentence is no longer one the reader can
 re-derive from the node by reading this module. The author's own comments are
 never sent and never marked. */
export const POLISH_MARK = "≈ ";

/** One line of the polish request. The templated sentence is the THING BEING
 REWRITTEN; the two states and the tactic's own text are CONTEXT, so the model
 has what the informalization papers report it needs and nothing it could
 mistake for a licence to state a new fact. */
export interface PolishLine {
  nodeId: string;
  template: string;
  goalBefore: string;
  goalAfter?: string;
  tactic: string;
}

/** The lines a proof would send. Exactly the strips `narrationFor` generated —
 the author's own comments are absent from that map, so they are absent here —
 with `NARRATE_MARK` stripped back off, since the mark is ours and not part of
 the sentence. */
export function polishLines(
  base: TreeNode[],
  drawn: TreeNode[],
): PolishLine[] {
  return polishLinesOf(drawn, narrationOf(base, drawn));
}

/** The same request, built from a narration already computed. */
export function polishLinesOf(
  drawn: TreeNode[],
  { text, ctx }: Narration,
): PolishLine[] {
  const out: PolishLine[] = [];
  for (const d of drawn) {
    const t = text.get(d.id);
    if (t === undefined) continue;
    const src = ctx.byId.get(d.id) ?? d;
    const after = childrenOf(src, ctx).filter((c) => c.type === "goal");
    out.push({
      nodeId: d.id,
      template: t.startsWith(NARRATE_MARK) ? t.slice(NARRATE_MARK.length) : t,
      goalBefore:
        src.type === "goal" ? goalText(src) : goalText(parentOf(src, ctx)),
      ...(after.length === 1 ? { goalAfter: goalText(after[0]) } : {}),
      tactic: clip(src.label, 120),
    });
  }
  return out;
}

/** One SENTENCE's cache key: the node it belongs to and the exact template it
 rewrote. A cut changes which nodes are drawn and nothing else, so keying the
 answers per sentence is what stops a fold from re-asking for lines already in
 hand. */
export const polishCacheKey = (l: PolishLine): string =>
  `${l.nodeId} ${l.template}`;

/** What a polish result is keyed by on THIS side: the templated text itself,
 in order. A re-parse that changes nothing about the sentences re-uses the
 answer; a proof whose text changed asks again. (The companion caches on
 `(proofKey, hash)` for the same reason and computes its own hash — this one
 never crosses the wire.) */
export function polishKey(lines: PolishLine[]): string {
  let h = 0x811c9dc5;
  for (const l of lines) {
    const s = `${l.nodeId} ${l.template} `;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return `${lines.length}:${(h >>> 0).toString(36)}`;
}
