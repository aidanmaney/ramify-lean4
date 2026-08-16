import type {
  CalcChain,
  Hole,
  CalcRelOption,
  CalcRelations,
  GoalInfo,
  Hypothesis,
  OpenBlock,
  Proof,
  ProofStep,
  ProofStepPosition,
  SourceComment,
  TacticSlot,
} from "./paperproof";
import { stepGoalsAfter } from "./paperproof";
import type {
  AddSpec,
  DeleteSpec,
  HypLine,
  LedgerRow,
  NodeFlags,
  TreeNode,
} from "./types";
import { isLedgerHead } from "./types";
import { collapseLabel } from "./briefLabel";

// The "inside a chain, nothing drawn above you" reading of `chainCtx` (see
// visitGoal). One frozen instance so the recursion allocates nothing per link.
const EMPTY_CTX: ReadonlySet<string> = new Set<string>();

// Adapter: Paperproof `Proof` → the renderer's `TreeNode[]`.
//
// Paperproof gives us goals (nodes) and tactic steps (which goal a tactic
// consumed and which it produced). We turn each step into the Gentzen-style
// shape the layout expects:
//
//     goalBefore ──(tactic node)──▶ goalsAfter ++ spawnedGoals
//
// - A *goal* node is labeled by its pretty-printed type, and carries its local
//   context (`hyps`), which the renderer stacks above that type in the same box.
// - A *tactic* node sits on the edge, labeled by its tactic string. Its single
//   parent is the goal it consumed; its children are the goals it produced.
// - The tree root is the original theorem goal: the one goal that some tactic
//   consumed but no tactic ever produced (no in-edge).
//
// Nodes are emitted in a DFS pre-order from the root(s) so the layout's stable
// left-to-right ordering (which keys off creation order) reads top-down,
// left-to-right like the source proof.

// One tactic node per step; key it by the consumed goal (a goal is consumed by
// at most one tactic in a tree proof), so the id is stable across re-parses.
const TACTIC_PREFIX = "tactic:";

// Relations `calc` can chain (it needs a `Trans` instance, and these are the
// ones that realistically carry one), the other tokens that would sit on a
// goal's spine — their presence means the relation ISN'T the spine — and the
// binders whose body is not the goal. See calcRelation.
const CALC_RELS = new Set([
  "=", "≤", "<", "≥", ">", "≠", "∣", "⊆", "⊂", "↔", "≡", "≈", "∼", "⊑",
]);
const SPINE_TOKENS = new Set([...CALC_RELS, "∧", "∨", "→", "¬"]);
const BINDER_HEADS = new Set(["∀", "∃", "fun", "λ"]);
const OPENERS = "([{⟨⦃";
const CLOSERS = ")]}⟩⦄";

/** The single relation on a type's SPINE, with the offsets that split it into
LHS and RHS — or null when the type isn't that shape.
 *
 * Whitespace tokens, each tagged with the bracket depth at its start; the spine
 * is depth 0. Firing only on exactly one depth-0 spine token is what rules out
 * `a = b ∧ c = d` (three of them, so no `=` is the spine) and, with the binder
 * guard, `∀ m, f m = g m` (whose `=` belongs to the body, not the goal).
 *
 * Shared by two callers that must agree on what "the goal's relation" means:
 * the `calc` chip's offer test, and the chain-link LHS elision below. */
export function spineRelation(
  type: string,
): { rel: string; lhs: string; rhs: string } | null {
  if (BINDER_HEADS.has(type.trimStart().split(/\s+/)[0] ?? "")) return null;
  const spine: { tok: string; start: number }[] = [];
  let depth = 0;
  let i = 0;
  while (i < type.length) {
    while (i < type.length && /\s/.test(type[i])) i++;
    if (i >= type.length) break;
    const start = i;
    const atDepth = depth;
    while (i < type.length && !/\s/.test(type[i])) {
      if (OPENERS.includes(type[i])) depth++;
      else if (CLOSERS.includes(type[i])) depth--;
      i++;
    }
    const tok = type.slice(start, i);
    if (atDepth === 0 && SPINE_TOKENS.has(tok)) spine.push({ tok, start });
  }
  if (spine.length !== 1 || !CALC_RELS.has(spine[0].tok)) return null;
  const { tok, start } = spine[0];
  return {
    rel: tok,
    lhs: type.slice(0, start).trimEnd(),
    rhs: type.slice(start + tok.length).trim(),
  };
}

/** Which of a `calc` chain's link goals may show `_` for their left-hand side,
mapped to the exact text `_` stands in for.
 *
 * The source already writes chains this way — only the first link names its LHS,
 * every later one opens with `_` — and the tree has the same redundancy for the
 * same reason: a link's LHS is the previous link's RHS, drawn in the box
 * directly above. So a link elides iff its LHS is some SIBLING link's RHS. That
 * test is order-free, which matters because the wire order isn't source order
 * (`stepGoalsAfter` puts `goalsAfter` before `spawnedGoals`, so a chain mixing
 * `:= by` and `:= ?_` links comes back reversed), and it degrades exactly
 * right: a TERM-justified link produces no goal at all, so the link after it
 * finds no sibling RHS to match and keeps its LHS — which is correct, since
 * with nothing drawn above it that text is not redundant.
 *
 * The chain HEAD is excluded separately: its LHS is what the source writes on
 * the `calc` line itself, and it is already drawn as the LHS of the goal the
 * chain proves. Without that guard a chain that returns to its start
 * (`calc a = b … _ = a`) would elide its own head. */
function chainLhsElisions(
  links: { id: string; type: string }[],
  consumed: string | undefined,
): Map<string, string> {
  const parts = links.flatMap((g) => {
    const r = spineRelation(g.type);
    return r ? [{ id: g.id, lhs: r.lhs, rhs: r.rhs }] : [];
  });
  const head = consumed ? spineRelation(consumed)?.lhs : undefined;
  const out = new Map<string, string>();
  for (const p of parts)
    if (p.lhs !== head && parts.some((q) => q !== p && q.rhs === p.lhs))
      out.set(p.id, p.lhs);
  return out;
}
export const tacticId = (goalId: string): string =>
  `${TACTIC_PREFIX}${goalId}`;

/** Prefix on every goal-node label (the infoview's own goal convention).
The tagged renderer strips it before matching interactive prints. */
export const TURNSTILE = "⊢ ";

/** The edge-label line for one hypothesis, e.g. `h : p ∧ q` (`:= v` for lets).
Exported so the widget's tagged renderer can match label lines back to a goal's
hyps and swap in interactive types (see taggedRender.tsx). */
export function hypLine(h: Hypothesis): string {
  return h.value != null
    ? `${h.username} : ${h.type} := ${h.value}`
    : `${h.username} : ${h.type}`;
}

// A goal's local context, drawn inside its own box above the `⊢ ` line: its
// hypotheses, each flagged with whether the tactic that CONSUMES the goal
// actually uses it (`tacticDependsOn`, fvarIds — same ids as `Hypothesis.id`;
// a leaf goal has no consumer, so nothing is flagged).
//
// Four levels of verbosity, selected by the rail's hyp-mode button:
//
// - `full` — the goal's whole context.
// - `delta` — the hypotheses the goal GAINED over the goal its own
//   producing tactic consumed (Paperproof's "introduced here" semantics; for a
//   root goal, its binders — gained from the theorem statement), PLUS any older
//   hypotheses the consuming tactic uses: usage is half the point of showing
//   the context, so a used hyp is shown even when it isn't new.
// - `new` — ONLY the hypotheses the PRODUCING tactic introduced, i.e. the
//   bindings that step added to the context (`intro h`, `obtain ⟨a, ha⟩`,
//   `induction … with | succ k ih`, `have h :=`), and nothing else — no older
//   hyps, no "the next tactic uses it" additions. It is `delta` minus that
//   augmentation, computed as the fvarIds present here but absent from the
//   producer's `goalBefore`. A ROOT goal has no preceding tactic, so nothing
//   was introduced and its box shows the `⊢ ` line alone — that is the truth,
//   not a rendering gap. Same for a tactic that binds nothing (`rw`, `exact`).
// - `used` (default) — what the REST OF THE PROOF under this goal actually
//   depends on: the union of `tacticDependsOn` over every step in the goal's
//   SUBTREE, not just its immediate consumer. `tacticDependsOn` comes from the
//   elaborated proof term (Paperproof collects the fvars the mvar assignment
//   mentions), so implicit uses by `omega`/`linarith`/`simp_all` count — no
//   counterfactual re-elaboration is needed. Known blind spots, accepted as
//   data: `decide`-style proofs (the term goes through `of_decide_eq_true` and
//   mentions no hyp fvars) and delayed-assigned goals (Paperproof reads only
//   `eAssignment`).
//
//   A goal with NO consuming tactic falls back to `delta`'s rule instead of
//   coming back empty, and that carve-out is what makes this mode usable as
//   the default. "What the rest of the proof uses" is undefined when there is
//   no rest of the proof yet — and a goal with no consumer is precisely the
//   live FRONTIER, the one being written against, where an empty box reads as
//   broken rather than as data. `delta` is what such a goal showed before this
//   became the default, so the fallback can only hold that ground.
//
// `new` and `used` are incomparable — `new` is what the tactic ABOVE bound,
// `used` is what the subtree BELOW mentions — and immediate-consumer usage
// (the ▸ gutter flag, still per-step) is a subset of `used`, which is a subset
// of `full`. `delta` contains `new` plus the immediate-consumer part of `used`
// but not its deeper reaches. In every mode the shown lines are reordered
// data-first (see the partition at the end of contextFor); within each group
// the context's own order is preserved. That reordering is the one part of
// this a second control turns OFF — see `hypGroup`; the four breadths are
// about WHICH lines, grouping only about their order.
export type HypMode = "used" | "new" | "delta" | "full";

function contextFor(
  goal: GoalInfo,
  consumedBy: ProofStep | undefined,
  producedBy: ProofStep | undefined,
  mode: HypMode,
  // Source flags governing this goal (see NodeFlags): `.no-hyps` drops the
  // context outright, `.h#name` narrows it to a named few.
  flags?: ParsedFlags,
  // For `used` mode: fvarId → username over the goal's whole subtree (see
  // `subtreeUsed` in proofToTree). Ids are matched first; usernames are the
  // fallback for ids the goal's own context has never held — `rw … at h` /
  // `simp at h` mint a NEW fvarId for `h` in the child goal, so a descendant's
  // dependency can arrive under an id this goal doesn't know while plainly
  // meaning its `h`.
  deepUsed?: Map<string, string>,
  // Whether to reorder the shown lines data-then-props (see the partition at
  // the end). Off restores the context's OWN order — see `hypGroup`.
  group = true,
  // Context lines an ENCLOSING node already draws, by their drawn text. Set for
  // every goal inside a `calc` chain whose ledger carries the chain's context
  // block (see TreeNode.ledger): those binders are on screen at the top of the
  // chain's own column, and repeating them in every link's justification box
  // was 59% of that box's ink, 43% of it byte-identical.
  //
  // Keyed on the TEXT and not on the fvarId, deliberately: ids are not stable
  // down the tree (`rw … at h` mints a new one), so an id test both misses a
  // genuine repeat and — the direction that matters — cannot tell a repeat from
  // a hypothesis whose TYPE has changed under it. The text answers exactly the
  // question being asked, "is this line already on screen above me".
  //
  // Applied where `.h#name` is and for the same reason: it INTERSECTS with the
  // rail's breadth rather than overriding it, so ∀ (`full`) still shows the
  // whole context and the four-way cycle keeps working inside a chain.
  inherited?: ReadonlySet<string>,
): HypLine[] {
  if (flags?.noHyps) return [];
  const used = new Set(consumedBy?.tacticDependsOn ?? []);
  // What this goal gained over the goal its producer consumed, plus anything
  // its own consumer uses — `delta`'s rule, and the leaf fallback for `used`.
  const deltaOf = () => {
    const inherited = new Set(producedBy?.goalBefore.hyps.map((h) => h.id));
    return goal.hyps.filter((h) => !inherited.has(h.id) || used.has(h.id));
  };
  let shown = goal.hyps;
  if (mode === "used") {
    // No consumer means no subtree to read a dependency off, so there is no
    // honest subtree answer — see the mode's comment above for why the
    // fallback rather than an empty box.
    if (!consumedBy) shown = deltaOf();
    else {
      const deep = deepUsed ?? new Map<string, string>();
      const ownIds = new Set(goal.hyps.map((h) => h.id));
      const fallbackNames = new Set<string>();
      for (const [id, name] of deep)
        if (!ownIds.has(id) && name) fallbackNames.add(name);
      shown = goal.hyps.filter(
        (h) => deep.has(h.id) || fallbackNames.has(h.username),
      );
    }
  } else if (mode === "new") {
    // Only what the PRODUCING tactic bound: fvarIds present now but absent from
    // the goal that tactic consumed. A root goal (no producer) introduced
    // nothing, so its context is empty.
    if (!producedBy) shown = [];
    else {
      const inherited = new Set(producedBy.goalBefore.hyps.map((h) => h.id));
      shown = goal.hyps.filter((h) => !inherited.has(h.id));
    }
  } else if (mode === "delta") {
    shown = deltaOf();
  }
  // A chain's inherited context, dropped BEFORE the partition so a block left
  // with only propositions loses its divider too. `full` is the reader asking
  // for everything and is exempt — that is the whole of "still a breadth cycle,
  // not a new mode".
  if (inherited?.size && mode !== "full")
    shown = shown.filter((h) => !inherited.has(hypLine(h)));
  // `.h#name` INTERSECTS with the rail's breadth rather than overriding it, so
  // the two controls compose: a named hyp the current mode wouldn't show stays
  // hidden, and switching to ∀ reveals it. Filtering last is what makes that
  // true — the mode branches above rebuild from `goal.hyps` each time.
  if (flags?.onlyHyps?.length)
    shown = shown.filter((h) => flags.onlyHyps!.includes(h.username));
  // DATA before PROPOSITIONS, stable within each group — the signature reading
  // (`(a b : ℕ)` then `(h : b ≤ a)`), where Lean's own lctx interleaves them
  // in binder order. The classification is Paperproof's `isProof`, computed
  // from the elaborated type ("proof" vs "data"/"universe" — a `Sort`-typed
  // hyp like `α : Type` sits with data; it is no proposition). Runs LAST so
  // every mode and flag composes with it, and stamps `sep` on the first prop
  // line only when both groups are present — a one-group block needs no
  // divider and must stay byte-identical to before this existed.
  // Ungrouped (`hypGroup` off) is the same list in the context's OWN order,
  // which is a dependency order: a later hyp may mention an earlier one, and
  // reordering can put the reference above what it names. No `sep` there —
  // the divider marks a boundary that no longer exists.
  if (!group)
    return shown.map((h) => ({ text: hypLine(h), used: used.has(h.id) }));
  const data = shown.filter((h) => h.isProof !== "proof");
  const props = shown.filter((h) => h.isProof === "proof");
  return [...data, ...props].map((h, i) => ({
    text: hypLine(h),
    used: used.has(h.id),
    sep: data.length > 0 && props.length > 0 && i === data.length
      ? true
      : undefined,
  }));
}

const IDENT_CH = /[A-Za-z0-9_']/;

/** How many METAVARIABLES a printed goal type mentions.
 *
 * `?` opens a metavariable's printed form (`?m`, `?b`, `?m.1234`) and nothing
 * else — but an identifier may END with one (`Option.get?`, `List.find?`), so
 * the test is a `?` that both STARTS a token and is followed by an identifier
 * character. Neither half alone is enough.
 *
 * Mirrors `mvarOccurrences` in ProofTreeComments.lean, which picks between
 * TAGGED prints of the same goal exactly as this picks between plain ones —
 * change one, change both. If they disagree the tagged text stops matching the
 * measured label and the goal silently drops to plain SVG, losing its type
 * tooltips in precisely the place they explain the most. */
export function mvarOccurrences(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "?") continue;
    if (i > 0 && IDENT_CH.test(s[i - 1])) continue;
    if (i + 1 < s.length && IDENT_CH.test(s[i + 1])) n++;
  }
  return n;
}

// All goals referenced by a proof, indexed by mvarId. `allGoals` is
// authoritative, but we also fold in goals embedded in steps so a tree can
// never reference an id we don't have.
//
// A goal is printed MORE THAN ONCE and the prints can disagree: Paperproof
// prints each with the producing tactic's `mctxAfter`, so a metavariable that
// a later tactic assigns is still open there and shows as `?m` even in a
// finished proof — `apply Nat.le_trans` puts `⊢ a ≤ ?m` in `allGoals` while
// the `exact h1` that consumes it prints `⊢ a ≤ 5`. Fewer metavariables means
// strictly more instantiated, so the most-resolved print wins.
//
// Ties keep the FIRST offered, which is `allGoals` — so this changes nothing
// except where a metavariable is actually eliminated. Measured over the corpus
// plus proofs/mvars.lean: of 179 goals printed both ways only 2 differ at all,
// and both differences are exactly a resolved metavariable.
function goalIndex(proof: Proof): Map<string, GoalInfo> {
  const goals = new Map<string, GoalInfo>();
  const score = new Map<string, number>();
  const offer = (g: GoalInfo) => {
    const s = mvarOccurrences(g.type);
    const cur = score.get(g.id);
    if (cur === undefined || s < cur) {
      goals.set(g.id, g);
      score.set(g.id, s);
    }
  };
  for (const g of proof.allGoals) offer(g);
  for (const step of proof.steps) {
    for (const g of [step.goalBefore, ...stepGoalsAfter(step)]) offer(g);
  }
  return goals;
}

// Root goal ids: consumed by some tactic but never produced by one — the
// original theorem goal(s). Order follows first appearance in `steps`.
//
// An OPEN BLOCK (`:= by` with nothing written into it) is the one root that no
// step consumes, so it cannot be derived from `steps` at all and is named by
// the server instead (`Proof.openBlock`). It comes FIRST: the payload that
// carries one has no steps, so there is nothing to come before it, and putting
// it first keeps `proofTitle`/comment attribution reading the theorem's own
// goal rather than a later one. A payload cannot carry both — the block is
// empty exactly when no tactic exists — but the dedupe is kept anyway, since
// this list feeds `visitGoal` and a repeated root would emit the node twice.
export function rootIds(proof: Proof): string[] {
  const produced = new Set<string>();
  for (const step of proof.steps) {
    for (const g of stepGoalsAfter(step)) produced.add(g.id);
  }
  const open = proof.openBlock ? [proof.openBlock.goal.id] : [];
  return [...open, ...proof.steps.map((s) => s.goalBefore.id)].filter(
    (id, i, arr) => arr.indexOf(id) === i && !produced.has(id),
  );
}

// A short human label for a proof — its root goal's type — for the picker.
export function proofTitle(proof: Proof): string {
  const goals = goalIndex(proof);
  const root = rootIds(proof)[0];
  return (root && goals.get(root)?.type) || "(proof)";
}

// The case name a goal carries, when its producing tactic split into named
// branches (`induction … with | zero | succ`, `by_cases` → `pos`/`neg`).
//
// Paperproof passes Lean's tag through verbatim, so the name arrives with the
// MACRO-HYGIENE suffix attached — `by_cases` yields
// `pos._@.282783777._hygCtx._hyg.77`, which is an implementation detail of
// name generation and not something to put on screen. Everything from the
// `._@.` marker on is dropped. Unnamed goals (`[anonymous]`, or a bare `_`
// case) get no badge rather than a meaningless one.
function caseName(goal: GoalInfo | undefined): string | undefined {
  const raw = goal?.username;
  if (!raw) return undefined;
  const name = raw.split("._@.")[0].trim();
  if (name === "" || name === "[anonymous]" || name === "_") return undefined;
  return name;
}

// ---- Cursor → tactic node ---------------------------------------------------

/** `a` is at or before `b`. Exported so the pure edit modules share ONE coding
of "compare two LSP positions" with the cursor-accent lookups here. */
export const posLE = (a: LspPos, b: LspPos) => cmpPos(a, b) <= 0;
/** HALF-OPEN containment, `[start, stop)`. See the widget's accent notes: step
ranges include trailing trivia, so consecutive tactics share a boundary
position and an inclusive end lets a neighbour match. */
export function positionContains(r: ProofStepPosition, p: LspPos): boolean {
  return posLE(r.start, p) && !posLE(r.stop, p);
}

/** Every source range that should resolve to a node, as `tacticNodeAt` wants
them.
 *
 * One list for three readers — the cursor accent, the gallery's follow, and
 * diagnostics — because they are asking the same question and three copies of
 * it drifted: the gallery's own copy filtered on `d.position`, which an elide
 * marker never has, so paging could not follow the cursor into a combined run.
 *
 * A MARKER owns several ranges, one per tactic it swallowed, and offers each of
 * them under its own id: the marker is what now stands for that run, so a
 * position anywhere inside it must resolve to the thing actually on screen.
 *
 * Goals are excluded, as they always have been: a goal's `position` is its
 * PRODUCER's range, so it is always redundant with that tactic's own node. */
export function tacticTargets(
  nodes: TreeNode[],
): { id: string; position: ProofStepPosition }[] {
  return nodes.flatMap((d) => {
    const parts = d.elidedCut?.parts;
    if (parts)
      return parts
        .filter((p) => p.position)
        .map((p) => ({ id: d.id, position: p.position! }));
    return d.type === "tactic" && d.position
      ? [{ id: d.id, position: d.position }]
      : [];
  });
}

/**
 * The single tactic node the editor cursor should accent, or null.
 *
 * Two steps, and the second one exists because parts of a proof belong to NO
 * tactic's range. A structured tactic's recorded range stops at its first case
 * marker — `induction n … with` is `23:4 → 24:4`, ending exactly ON the `|` —
 * and a bullet `·` sits just past the range of the tactic before it. Those
 * regions are covered only by the ENCLOSING construct, so containment alone
 * resolved `| _ n ih =>` to the whole `have … := by` at the top of the proof.
 *
 * So: take the innermost containing tactic, then prefer the nearest tactic
 * that has already CLOSED at or before the cursor from within it. On a case
 * marker that is the `induction` the marker belongs to; on a bullet it is the
 * tactic that split the goal. When the cursor sits inside a leaf tactic no
 * such candidate exists and the innermost answer stands, so the property this
 * had to preserve — cursor at a tactic's own start resolves to that tactic —
 * is untouched.
 */
export function tacticNodeAt(
  tactics: { id: string; position: ProofStepPosition }[],
  p: LspPos,
): string | null {
  // A tactic that STARTS on the cursor's own line wins outright, and this is
  // the rule that makes the accent track the cursor the way a reader expects.
  //
  // Without it the `prior` rule below — which prefers the nearest tactic that
  // has already CLOSED — fires far beyond the case-marker/bullet gaps it was
  // written for, because a `calc` link's term text, a bullet and a comment line
  // all belong to NO tactic's range. The result was a systematic one-line LAG:
  // measured on the scratch file's `calc_workout`, the cursor on
  // `_ ≤ _ := by linarith` (line 181) accented the PREVIOUS link's `ring`, the
  // cursor on the `calc` head accented the `have` above it, and the cursor on
  // chain 2's last link accented the next bullet's `calc`. Every one of those
  // now resolves to the tactic written on that line.
  //
  // The cursor may sit BEFORE the line's tactic starts (`= 2 * … := by ring`
  // is mostly term text, with `ring` at the end) — that still means "this
  // line", so the first tactic on the line stands in.
  const onLine = tactics.filter((t) => t.position.start.line === p.line);
  if (onLine.length > 0) {
    let best: (typeof tactics)[number] | null = null;
    for (const t of onLine)
      if (
        cmpPos(t.position.start, p) <= 0 &&
        (!best || cmpPos(best.position.start, t.position.start) < 0)
      )
        best = t;
    if (!best)
      for (const t of onLine)
        if (!best || cmpPos(t.position.start, best.position.start) < 0) best = t;
    return best!.id;
  }
  const span = (r: ProofStepPosition) =>
    (r.stop.line - r.start.line) * 1e4 + (r.stop.character - r.start.character);
  let inner: (typeof tactics)[number] | null = null;
  for (const t of tactics)
    if (
      positionContains(t.position, p) &&
      (!inner || span(t.position) < span(inner.position))
    )
      inner = t;
  if (!inner) return null;
  // Nearest tactic that closed at/before the cursor, strictly inside `inner`.
  let prior: (typeof tactics)[number] | null = null;
  for (const t of tactics) {
    if (t === inner) continue;
    if (cmpPos(t.position.start, inner.position.start) <= 0) continue;
    if (!posLE(t.position.stop, p)) continue;
    if (!prior || cmpPos(prior.position.stop, t.position.stop) < 0) prior = t;
  }
  return (prior ?? inner).id;
}

// ---- Source comments → node attribution -------------------------------------

type LspPos = { line: number; character: number };
// Exported alongside `posLE`: THE one coding of "compare two LSP positions"
// in the web half — every sort or ordering test goes through these two.
export const cmpPos = (a: LspPos, b: LspPos): number =>
  a.line - b.line || a.character - b.character;

// A non-breaking space: the wrapper splits on ordinary spaces, so joining a
// span's words with these makes it one unbreakable token. Renders identically.
const NBSP = " ";

// Lightweight markdown cleanup for a comment strip (docstrings especially are
// written in markdown). We DON'T render markdown — the strip is one muted
// italic block — so the delimiters are pure noise on screen (`**Sums…**`, the
// backticks around `` `m` ``). Strip the ones that show up in proof prose:
//
// - bold `**x**` / `__x__` → `x`;
// - a leading `#` heading marker per line;
// - inline code `` `x` `` → `x`, but with its inner spaces turned to
//   NON-BREAKING ones, so the wrapper keeps the whole span on one line instead
//   of breaking a formula like `1 + 3 + ⋯ + (2m−1) = m²` at a `+`.
//
// Single-`*` italics are deliberately left alone: `2 * k` is multiplication,
// not emphasis, and telling them apart reliably isn't worth it here.
//
// Exported for the token doc popup (docTip.tsx), the one caller that wants
// `breakableCode`: a popup wraps freely, so a code span's inner spaces stay
// ORDINARY there — NBSP exists for the label wrapper alone.
export function cleanMarkdown(
  text: string,
  opts?: { breakableCode?: boolean },
): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, (_, code: string) =>
      opts?.breakableCode ? code : code.replace(/ /g, NBSP),
    );
}

// Display form of a raw comment: delimiters stripped, block-comment lines
// trimmed (they carry the source indentation), blank edge lines dropped.
//
// `cleanMarkdown` is deliberately NOT applied here — it runs on the PROSE that
// survives flag parsing instead (see `add` below), because it turns
// `` `.fold` `` into `.fold`: a comment that MENTIONS a flag in code ticks at
// its start would otherwise become a directive, prose about the feature
// silently invoking it. That is not hypothetical — it is what happened writing
// this repo's own `proofs/flags.lean` fixture. Flags first, markdown after.
function stripCommentText(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("--")) t = t.slice(2);
  else if (t.startsWith("/-")) {
    t = t.replace(/^\/-[-!]?/, "");
    t = t.replace(/-\/$/, "");
  }
  const lines = t.split("\n").map((l) => l.trim());
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  // Collapse soft-wrapped lines within a paragraph. A block comment (a
  // docstring especially) is wrapped to the .lean file's own width, but the
  // tree has its own budget — so a single newline is a soft break (joined with
  // a space) and only a BLANK line separates paragraphs. Without this the
  // display inherits the source's physical breaks and re-wraps each fragment
  // independently, leaving ragged short lines mid-paragraph. Single-line `--`
  // comments have no internal newline, so they are untouched.
  const paras: string[] = [];
  let para: string[] = [];
  for (const l of lines) {
    if (l === "") {
      if (para.length) paras.push(para.join(" "));
      para = [];
    } else para.push(l);
  }
  if (para.length) paras.push(para.join(" "));
  // Paragraphs stay separated by a blank line (the author's own structure —
  // e.g. a docstring's title above its body).
  return paras.join("\n\n");
}

// ---- Alectryon-style display flags ------------------------------------------

/** The flags parsed out of one comment, plus whatever prose followed them.
 *
 * Alectryon (and, through LeanInk, Lean) lets a proof author write display
 * directives as comment flags — `(* .fold *)` in Coq, `-- .fold` here — that
 * say how a sentence's OUTPUT should be shown. Translated to a tree, a
 * "sentence" is a tactic (or the root goal, for the pre-proof narrative slot)
 * and its "output" is the goals below it, so the same vocabulary controls
 * subtrees, and `.no-hyps`/`.h#name` control the context blocks inside them.
 *
 * Flags are only recognised at the START of a comment, and scanning stops at
 * the first word that is not one: `-- .fold why this is boring` is a directive
 * with a note, `-- see .fold above` is ordinary prose. */
interface ParsedFlags {
  fold?: boolean;
  elide?: boolean;
  noHyps?: boolean;
  /** `.h#name`, repeatable: show only these hypotheses. */
  onlyHyps?: string[];
  /** Text after the flags — kept as the node's comment strip, and shown in
  place of whatever `.none` removed. */
  prose: string;
  /** Whether any flag at all was recognised (an all-prose comment is not a
  directive, and must keep its leading word). */
  any: boolean;
}

// `.name` or `.name#argument`. The name must start with a letter, so a decimal
// (`-- .5 of the cases`) is prose rather than a malformed flag.
// Exported for flagEdit.ts, whose REMOVAL edit strips exactly the words this
// recognises — one regex, so the writer and the reader cannot drift.
export const FLAG_RE = /^\.([a-zA-Z][\w-]*)(?:#(\S+))?$/;

export function parseFlags(text: string): ParsedFlags {
  const out: ParsedFlags = { prose: text, any: false };
  // Flags live on the comment's FIRST line; a block comment's later lines are
  // prose no matter what they start with.
  const [head, ...rest] = text.split("\n");
  const words = head.split(/\s+/);
  let i = 0;
  for (; i < words.length; i++) {
    const m = FLAG_RE.exec(words[i]);
    if (!m) break;
    const [, name, arg] = m;
    switch (name) {
      case "fold":
        out.fold = true;
        break;
      case "unfold":
        // The default, but Alectryon has it, and writing it makes "this one
        // stays open" explicit next to a sibling that doesn't.
        out.fold = false;
        break;
      case "none":
        out.elide = true;
        break;
      case "no-hyps":
        out.noHyps = true;
        break;
      case "h":
        if (arg) out.onlyHyps = [...(out.onlyHyps ?? []), arg];
        break;
      default:
        // An unrecognised but well-formed flag is CONSUMED, not left in the
        // prose: Alectryon's vocabulary is bigger than the part that means
        // anything to a tree (`.in`, `.messages`, `.g#1`), and echoing those
        // into a comment strip would be noise.
        break;
    }
    out.any = true;
  }
  if (!out.any) return out;
  out.prose = [words.slice(i).join(" "), ...rest].join("\n").trim();
  return out;
}

// The subset of the parsed flags the RENDERER acts on. The hypothesis flags
// are consumed in proofToTree (contextFor), so they never reach a TreeNode.
// Returns undefined when nothing is left to say, keeping the field absent on
// the overwhelming majority of nodes.
//
// The two directives need `targets` differently, and conflating them was a
// silent drop: `.fold` folds the TARGETS, so with none it means nothing, but a
// `.none` on a TACTIC cuts that tactic ITSELF (the seed block passes `n.id`
// and never looks at targets). A CLOSING tactic has no goalsAfter and no
// spawned goals, so the shared gate threw its `.none` away before the seed
// ever saw it — `-- .none why this grind is dull` above the last step of a
// proof did nothing at all, and the pill offered to write it.
function nodeFlags(
  f: ParsedFlags | undefined,
  targets: string[],
  /** True on a TACTIC node, where `.none` is self-targeting (above). */
  selfElide = false,
): NodeFlags | undefined {
  if (!f) return undefined;
  const fold = !!f.fold && targets.length > 0;
  const elide = !!f.elide && (selfElide || targets.length > 0);
  if (!fold && !elide) return undefined;
  const out: NodeFlags = { targets };
  if (fold) out.fold = true;
  if (elide) out.elide = true;
  // The note is only ever SHOWN in place of an elision; anywhere else the
  // prose is already the node's comment strip.
  if (elide && f.prose) out.note = f.prose;
  return out;
}

// Attribute each comment to a tree node id (tactic node, or a root goal),
// joining multiple comments per node in source order.
//
// The one wrinkle: Paperproof's step ranges include TRAILING TRIVIA — a
// tactic's range runs past its trailing comment up to the next token. That
// makes containment the reliable trailing test (`simp -- trivial case` puts
// the comment inside `simp`'s range) where a naive same-line check misfires.
// The rules, in order:
//
// 1. CONTAINED in some step's range → that step (innermost, i.e. latest
//    start, when nested)… UNLESS another step starts between the comment and
//    the container's end — then the comment PRECEDES code inside the same
//    construct (`have := by` + comment + inner tactic) and reads as that
//    inner step's LEADING comment instead.
// 2. The declaration's DOCSTRING → the ROOT goal: that's the "here's the
//    plan" narrative slot, and the root box draws the STATEMENT, which is
//    what a docstring is written about.
// 3. LEADING — the next tactic starting at/after it (the common
//    `-- explain, then do` shape; bullet lines land here too, since the
//    consumed goal's tactic starts past the `·`).
// 4. Dangling after everything (rare) → the last tactic before it.
//
// Rule 2 used to read "entirely before the FIRST TACTIC", which is a much
// bigger region than a docstring: it swallowed the leading comment of the
// first tactic too, so a proof narrated `-- Step 1` / `-- Step 2` / `-- Step
// 3` drew steps 2 and 3 on their own tactics and step 1 on the root goal
// (reported; `proofs/euclid.lean` has the same shape). The honest boundary is
// the `by` — before it you are writing about the statement, after it about a
// move — and inside a declaration's source range the only comment that can
// precede the `by` IS the docstring, so the prefix test is that boundary
// without a wire field for it. A `-- preamble` line written ABOVE the
// `theorem` never reaches here at all: it lands in the PREVIOUS command's
// trailing trivia, outside the range the comments are lexed from.
//
// Accepted limit: a comment written INSIDE a multi-line signature (before the
// `by`, after the docstring) now falls to the first tactic rather than the
// root. Not observed in the corpus, and unlike the reported case it is not a
// shape anyone writes in a series.
//
// Rule 1's inner search asks "does a step BEGIN between the comment and the
// container's end", and a step's own `position.start` cannot answer it: a
// split `rw [h] at x` records its start at the RULE, inside the brackets,
// while trivia inflation ends the container exactly at the `rw` KEYWORD — so
// the inner step looked like it started past its container and every comment
// written above an `rw` fell onto the tactic ABOVE it (reported; measured on
// `have hpfac … ` / `rw [Nat.dvd_add_right hpfac] at hpdvd`, container stop
// 10:2, step start 10:6). `tacticSlots` is the as-written unit and answers it
// exactly, so the bound is tested against the step's SLOT start.
/** Is this comment a declaration's DOCSTRING rather than an ordinary one?
`SourceComment.text` is VERBATIM source, delimiters included (`cleanLabel`
scrubs labels by exact text, so it has to be), which makes the opening
delimiter the whole test. */
const isDocComment = (c: SourceComment) => c.text.startsWith("/--");

function attributeComments(
  comments: SourceComment[],
  steps: ProofStep[],
  rootId: string | undefined,
  slots: TacticSlot[],
): {
  text: Map<string, string>;
  ranges: Map<string, ProofStepPosition[]>;
  flags: Map<string, ParsedFlags>;
  /** The DIRECTIVE comments' own source ranges, per node — what a flag
  REMOVAL edit deletes. Kept separate from `ranges` on purpose: that map
  means "the node whose strip is SHOWING this" and a flags-only comment
  deliberately claims no entry there, but its range is still real text the
  reverse gesture must be able to find. Recorded for every directive,
  hyp-narrowing ones included (which never reach TreeNode.flags at all). */
  flagRanges: Map<string, ProofStepPosition[]>;
} {
  const out = new Map<string, string>();
  const ranges = new Map<string, ProofStepPosition[]>();
  const flags = new Map<string, ParsedFlags>();
  const flagRanges = new Map<string, ProofStepPosition[]>();
  if (comments.length === 0 || steps.length === 0)
    return { text: out, ranges, flags, flagRanges };
  const byStart = [...steps].sort((a, b) =>
    cmpPos(a.position.start, b.position.start),
  );
  // Where the step's tactic BEGINS as written — the innermost containing slot
  // (a bullet contains every slot inside it, and the tactic is the inner one).
  // Falls back to the recorded start on a wire that ships no slots, which is
  // exactly the behaviour this widening replaced.
  const surfaceStart = (s: ProofStep) => {
    let best: TacticSlot | undefined;
    for (const sl of slots)
      if (
        cmpPos(sl.start, s.position.start) <= 0 &&
        cmpPos(s.position.start, sl.stop) < 0 &&
        (!best || cmpPos(sl.start, best.start) > 0)
      )
        best = sl;
    return best?.start ?? s.position.start;
  };
  const first = byStart[0];
  let cur: SourceComment;
  const add = (nodeId: string, raw: string) => {
    // Flags off the UN-cleaned text (see stripComment), markdown cleaned only
    // on the prose that is left — so a `` `.fold` `` written about the feature
    // stays prose.
    const parsed = parseFlags(raw);
    const f: ParsedFlags = { ...parsed, prose: cleanMarkdown(parsed.prose) };
    if (f.any) {
      const prev = flags.get(nodeId);
      // Several directive comments on one node merge; the note is whichever
      // one bothered to write prose.
      flags.set(nodeId, {
        ...prev,
        ...f,
        onlyHyps: [...(prev?.onlyHyps ?? []), ...(f.onlyHyps ?? [])],
        prose: f.prose || prev?.prose || "",
        any: true,
      });
      flagRanges.set(nodeId, [
        ...(flagRanges.get(nodeId) ?? []),
        { start: cur.start, stop: cur.stop },
      ]);
    }
    // A directive's own prose moves INTO the elision marker rather than being
    // drawn twice (see NodeFlags.note), so `.none why` reads as one thing.
    const text = f.elide ? "" : f.prose;
    // A comment with nothing left to draw claims no range either:
    // `commentRanges` means "the node whose strip is SHOWING this", and the
    // widget's cursor accent trusts it (see ProofTreeView's commentOwner).
    if (text === "") return;
    out.set(nodeId, out.has(nodeId) ? `${out.get(nodeId)}\n${text}` : text);
    ranges.set(nodeId, [
      ...(ranges.get(nodeId) ?? []),
      { start: cur.start, stop: cur.stop },
    ]);
  };
  const sorted = [...comments].sort((a, b) => cmpPos(a.start, b.start));
  for (const c of sorted) {
    cur = c;
    const text = stripCommentText(c.text);
    if (text === "") continue;
    const container = byStart
      .filter(
        (s) =>
          cmpPos(s.position.start, c.start) < 0 &&
          cmpPos(c.start, s.position.stop) < 0,
      )
      .pop(); // byStart order → last = innermost
    if (container) {
      // A comment starting on the container's OWN first line is its trailing
      // comment (`simp -- why`) and stays with it — step ranges include
      // trailing trivia, so it is genuinely part of that step's text.
      //
      // Anything else sits on its own line inside the container's inflated
      // range and INTRODUCES what follows, so it belongs to the next step.
      // The container-end bound must be inclusive: trivia inflation makes the
      // next step start exactly AT the container's stop, so the strict test
      // this used to run never fired and every leading comment fell back onto
      // the PRECEDING tactic — "-- Step 2: apply it to N! + 1" was drawn above
      // the last `exact` of the previous branch instead of the `have` it
      // introduces, and the cursor accent jumped there with it.
      const inner =
        c.start.line === container.position.start.line
          ? undefined
          : byStart.find(
              (s) =>
                cmpPos(s.position.start, c.stop) >= 0 &&
                cmpPos(surfaceStart(s), container.position.stop) <= 0,
            );
      add(tacticId((inner ?? container).goalBefore.id), text);
      continue;
    }
    // Rule 2 — the docstring alone (see the header). Anything else in this
    // region sits inside the `by` block and introduces the tactic below it,
    // which is rule 3's job.
    if (rootId && isDocComment(c) && cmpPos(c.stop, first.position.start) <= 0) {
      add(rootId, text);
      continue;
    }
    const next = byStart.find((s) => cmpPos(s.position.start, c.stop) >= 0);
    if (next) {
      add(tacticId(next.goalBefore.id), text);
      continue;
    }
    const prev = [...byStart]
      .reverse()
      .find((s) => cmpPos(s.position.start, c.start) <= 0);
    if (prev) add(tacticId(prev.goalBefore.id), text);
  }
  return { text: out, ranges, flags, flagRanges };
}

// Tactic labels are raw source text of the step's range — which, because the
// range includes trailing trivia, can carry the very comments we now draw as
// strips. Scrub them from the label (they're identified by exact text) and
// tidy the leftover line-end whitespace.
function cleanLabel(label: string, comments: SourceComment[]): string {
  let t = label;
  let scrubbed = false;
  for (const c of comments)
    if (t.includes(c.text)) {
      t = t.split(c.text).join("");
      scrubbed = true;
    }
  const lines = t.split("\n").map((l) => l.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1].trim() === "")
    lines.pop();
  // A comment that occupied a whole INTERIOR line of a multi-line label leaves
  // that line empty after the scrub — a blank LINE_H inside the box. Drop
  // empty interior lines only when a scrub happened: a blank line the author
  // wrote inside a tactic never survives to a label (labels are tight slot
  // slices), so this can only be the scrub's residue. Token alignment degrades
  // gracefully past the divergence (the commonPrefix branch).
  const kept = scrubbed ? lines.filter((l, i) => i === 0 || l !== "") : lines;
  return kept.join("\n");
}

export interface ProofToTreeOptions {
  /**
   * How much of each goal's local context to draw — see `HypMode`. Defaults to
   * `used` (what the proof below the goal actually depends on), matching the
   * rail's own starting mode so the two can't drift.
   */
  hypMode?: HypMode;
  /**
   * Whether each context block is reordered DATA-then-PROPOSITIONS (the
   * signature reading, with a hairline divider between the groups). On by
   * default. Off draws the context in Lean's own binder order, which is what a
   * dependent context is written in: a hypothesis may mention an earlier one,
   * and the grouped view can float the mention above the binder it names.
   * Orthogonal to `hypMode`, which chooses which lines are shown at all.
   */
  hypGroup?: boolean;
  /**
   * Brief mode: collapse mechanical boilerplate inside each tactic label to
   * `…` (see briefLabel.ts). Off by default; a geometry-affecting toggle, so
   * the engine is rebuilt when it flips (same as reflow).
   */
  brief?: boolean;
  /**
   * The as-written tactic slots, which comment attribution needs to bound rule
   * 1's inner search (see `attributeComments`). An OPTION rather than a read of
   * `proof.deleteSlots` because the widget deliberately keeps slots OFF its
   * rebuilt `Proof` — one source of truth, on `stable` beside it — so the field
   * is present on the CLI wire and absent on the widget's, and reading only the
   * field silently gave the widget the unfixed behaviour. Falls back to the
   * field, which is what the standalone app (no slots prop) rides.
   */
  slots?: TacticSlot[];
  /**
   * Draw a `calc` chain's SETTLED links as one LEDGER node — the source's own
   * column of `<relation> <RHS>` rows — instead of one goal box per link, with
   * each link's justification hanging off it as an ordinary child. See
   * TreeNode.ledger. On by default; a geometry-affecting option, so the engine
   * is rebuilt when it flips (same as `brief`).
   *
   * PROTOTYPE. Off restores today's per-link goal boxes exactly.
   */
  ledger?: boolean;
}

export function proofToTree(
  proof: Proof,
  {
    hypMode = "used",
    hypGroup = true,
    brief = false,
    slots,
    ledger = true,
  }: ProofToTreeOptions = {},
): TreeNode[] {
  const goals = goalIndex(proof);

  // Which steps the supplemental parser synthesized (see paperproof.ts
  // `RecoveredStep`) — joined by position.start, the sidecar's key.
  const recoveredAt = new Map<string, "failed" | "skipped" | "term">();
  for (const r of proof.recovered ?? [])
    recoveredAt.set(`${r.start.line}:${r.start.character}`, r.kind);

  // Each goal is consumed by at most one tactic → index steps by goalBefore.
  const stepByGoal = new Map<string, ProofStep>();
  for (const step of proof.steps) stepByGoal.set(step.goalBefore.id, step);

  // The step ending LAST in source within the subtree under a goal — where a
  // new sibling branch's text must be inserted after. Trivia-inflated stops
  // are fine for the COMPARISON (they preserve source order); the widget
  // resolves the winner's TIGHT end via tacticEdits before inserting.
  function subtreeLastStep(goalId: string): ProofStep | undefined {
    const s = stepByGoal.get(goalId);
    if (!s) return undefined;
    let best = s;
    for (const g of stepGoalsAfter(s)) {
      const b = subtreeLastStep(g.id);
      if (b && cmpPos(b.position.stop, best.position.stop) > 0) best = b;
    }
    return best;
  }

  // What the rest of the proof under a goal depends on: the union of
  // `tacticDependsOn` over every step in the goal's subtree, each fvarId
  // paired with its username — resolved in the reporting step's OWN
  // `goalBefore.hyps`, the one context where the id is guaranteed live. The
  // username is what lets an ancestor goal recognise a dependency whose
  // fvarId was re-minted below it (`rw … at h`); see `contextFor`'s `used`
  // branch. Memoized per goal — a parent's set unions its children's, so the
  // walk is linear in practice over a proof-sized tree.
  const subtreeUsedMemo = new Map<string, Map<string, string>>();
  function subtreeUsed(goalId: string): Map<string, string> {
    const memo = subtreeUsedMemo.get(goalId);
    if (memo) return memo;
    const out = new Map<string, string>();
    const s = stepByGoal.get(goalId);
    if (s) {
      const nameById = new Map(s.goalBefore.hyps.map((h) => [h.id, h.username]));
      for (const id of s.tacticDependsOn) out.set(id, nameById.get(id) ?? "");
      for (const g of stepGoalsAfter(s))
        for (const [id, name] of subtreeUsed(g.id))
          if (!out.has(id)) out.set(id, name);
    }
    subtreeUsedMemo.set(goalId, out);
    return out;
  }

  // Where a NEW tactic for a pending goal would go — the seam behind the
  // tree's (+) chips. The producing step's SHAPE picks the insertion form:
  //
  // - producer ends in `with`: a `| case => ` line (the with-block form;
  //   anonymous cases fall back to `_`).
  // - one of SEVERAL goalsAfter: a `· ` bullet at the producer's indent.
  // - otherwise: a plain next line at the producer's indent.
  //
  // `after` is the last-in-source step among the producer's subtrees, so the
  // new branch lands BELOW its already-written siblings. Known v1 limit: with
  // SEVERAL pending siblings, each (+) inserts at the same anchor, so adding
  // them out of source order attaches text to the wrong goal — Lean's bullets
  // bind by position, and only `case`-named insertion could do better.
  // Holes the author wrote, keyed by the goal each stands for. The Lean side
  // pairs them by metavariable, so this join is exact rather than positional
  // (see paperproof.ts `Hole`). `dup` entries are dropped rather than
  // overwriting: a named `?foo` written twice is ONE goal at two spans, and the
  // fill belongs at the first — which a plain Map would silently lose.
  const holeByGoal = new Map<string, Hole>(
    (proof.holes ?? []).filter((h) => !h.dup).map((h) => [h.goalId, h]),
  );
  // Holes the tree fills IN PLACE — the ones with nowhere to append a sibling
  // (see `addSpecFor`, which reads the returned hole; other callers just test
  // it). Only these displace the ordinary chips; a hole inside a tactic block
  // keeps the `+`/`sorry`/`calc` row it always had. One home for the offer
  // rule, so the chip gate and the spec builder cannot drift.
  const fillableHole = (goalId: string): Hole | undefined => {
    const h = holeByGoal.get(goalId);
    return h && !h.inBlock ? h : undefined;
  };
  // The `calc` blocks themselves, keyed the way a step reaches us: a calc
  // step's `position.start` IS its tactic's start (both come from the same
  // syntax node), so the residue goal's producer looks its chain up directly.
  const chainByTactic = new Map<string, CalcChain>(
    (proof.calcChains ?? []).map((c) => [
      `${c.tacticStart.line}:${c.tacticStart.character}`,
      c,
    ]),
  );
  const isChain = (step: ProofStep) => /^calc\b/.test(step.tacticString);
  /** A step that is nothing but `sorry` — the justification every generated
  calc link carries (see calcEdit's STUB), and the node the second half of the
  gesture types over. */
  const isStub = (step: ProofStep) => step.tacticString.trim() === "sorry";
  /** Line of the FIRST link of the chain this calc step proves, read off the
  lines of the steps proving its links. The wire's link order is not source
  order (`stepGoalsAfter` puts `goalsAfter` before `spawnedGoals`), so the
  minimum is taken rather than the first entry; `undefined` when no link is
  proved by a step at all. Used only to refuse growing ABOVE the first link,
  whose LHS is the chain's head. */
  function firstStubLine(prod: ProofStep): number | undefined {
    let min: number | undefined;
    for (const g of stepGoalsAfter(prod)) {
      const s = stepByGoal.get(g.id);
      if (!s) continue;
      const l = s.position.start.line;
      if (min === undefined || l < min) min = l;
    }
    return min;
  }

  /** A `calc` step's SETTLED links as ledger rows (see TreeNode.ledger), or
   * null when there are fewer than two and today's per-link boxes stand.
   *
   * SETTLED means "some real justification consumes this link's goal". The two
   * exclusions are the whole scope guard: a `sorry` is the stub every generated
   * link carries — as unfinished as a hole, and the node `pendingFill` claims
   * by label — and a hole is consumed by nothing at all, so both keep their own
   * goal boxes, with their chips, staged fills and repair gestures untouched.
   * A link whose type is not a single relation on its spine is not a row this
   * can draw, so it keeps its box too.
   *
   * Rows go in SOURCE order, read off each link's own JUSTIFICATION: the
   * justification is written on the link's line, so its position is the link's.
   * (Following RHS→LHS from the head agrees wherever both apply — RHS_i ≡
   * LHS_{i+1} held 16/16 byte-identical across the corpus — but it needs a
   * fallback for a chain whose prints disagree, and this needs none.)
   *
   * THE ROWS ARE A CHAIN, AND THE CHAIN IS CHECKED. A row states only its
   * relation and RHS; the LHS it steps FROM is the row above it, and that is a
   * claim about the goals, not a layout convention. It is false the moment a
   * link in the MIDDLE is unsettled — a hole, a stub, a type this cannot
   * decompose — because the settled links on either side of it are then drawn
   * adjacent while the mathematics skips a step, and nothing on screen says so.
   * So the rows are the longest PREFIX over which RHS_i ≡ LHS_{i+1} holds
   * literally, and every link past the break keeps the goal box it always had
   * (with its chips and its own statement, LHS included). A PREFIX rather than
   * the longest run anywhere, for two reasons that agree: the head row is the
   * chain's starting expression, so a ledger beginning mid-chain would have to
   * state a head the source never wrote; and the ledgered links are emitted
   * ahead of the unsettled ones (see `order` below), which is source order only
   * while they are the chain's first. The cost is a chain broken EARLY — a hole
   * in link 1, four settled links after it — falling back to boxes throughout,
   * which is today's drawing rather than a wrong one.
   *
   * Falling out of the same test: a chain whose prints simply disagree ledgers
   * nothing and today's boxes stand, which is the fallback the paragraph above
   * says this needs — it is this. */
  function ledgerFor(
    step: ProofStep,
  ): { rows: LedgerRow[]; settled: Set<string> } | null {
    const links: {
      goalId: string;
      lhs: string;
      rhs: string;
      hidden: string;
      text: string;
      at: ProofStepPosition;
    }[] = [];
    for (const g of stepGoalsAfter(step)) {
      const just = stepByGoal.get(g.id);
      if (!just || isStub(just) || holeByGoal.has(g.id)) continue;
      const type = goals.get(g.id)?.type ?? "";
      const r = spineRelation(type);
      if (!r) continue;
      // The relation's offset in the printed type: `spineRelation` trims the
      // LHS at its end, so what separates them is the whitespace the PRINTER
      // chose. Slicing rather than re-joining keeps the row a verbatim SUFFIX
      // of the goal's type — which is what lets the tagged renderer reuse its
      // one sanctioned prefix-drop rewrite on it (see LedgerRow).
      const tail = type.slice(r.lhs.length);
      const ws = tail.length - tail.trimStart().length;
      links.push({
        goalId: g.id,
        lhs: r.lhs,
        rhs: r.rhs,
        hidden: type.slice(0, r.lhs.length + ws),
        text: type.slice(r.lhs.length + ws),
        at: just.position,
      });
    }
    links.sort((a, b) => cmpPos(a.at.start, b.at.start));
    // The invariant, asserted as it is built: keep links only while each one
    // steps from where the last one arrived. An unsettled link in the middle is
    // detected by this and needs no position of its own (a hole is proved by no
    // step, so it has none) — its absence shows up as the gap it leaves.
    const rows: typeof links = [];
    for (const l of links) {
      if (rows.length > 0 && l.lhs !== rows[rows.length - 1].rhs) break;
      rows.push(l);
    }
    // One row is not a ledger: a lone `<rel> RHS` under a head is two lines
    // saying what one goal box says, with the box's gestures gone.
    if (rows.length < 2) return null;
    return {
      // The head row is the first link's LHS — the expression the chain starts
      // from, which the source writes on the `calc` line itself. It states no
      // link, so it carries no goal and takes no justification child. Whether
      // it is DRAWN is the caller's call: where the `calc` node's own label
      // already writes the LHS, this row is its second copy (see `ledgerHead`).
      rows: [
        { text: rows[0].lhs },
        ...rows.map((l) => ({
          goalId: l.goalId,
          text: l.text,
          hiddenLhs: l.hidden,
          position: l.at,
        })),
      ],
      settled: new Set(rows.map((l) => l.goalId)),
    };
  }

  /** Whether a chain's ledger draws its HEAD row — the chain's starting
   * expression — given the `calc` node's own DRAWN label.
   *
   * Where the label states the LHS (`calc x = y := j`, the node directly above
   * the ledger), the head row is that same expression a second time one line
   * lower, so it goes. The test is on the label AS DRAWN and nothing else:
   * brief mode's Rule D collapses a long chain head to `calc …`, which states
   * nothing, and a chain written with `calc` alone on its line never did — in
   * both the head row is the LHS's only copy and stays.
   *
   * The ledger's own x used to be read off this label too (indent the box by
   * `measureText("calc ")` and row 0 lands under the source's own LHS). That
   * half is gone: the ledger sits on the trunk under `calc` like any other
   * node — see `trunkLayout`. */
  function ledgerHead(drawnLabel: string): boolean {
    const first = drawnLabel.split("\n")[0] ?? "";
    const m = /^calc[ \t]+/.exec(first);
    const rest = m ? first.slice(m[0].length) : "";
    // `…` is brief's elision mark, the one thing that can stand where the LHS
    // was written and not be it.
    return !(m && rest !== "" && !rest.startsWith("…"));
  }

  // Tactics whose several `goalsAfter` are NOT peers: the first is the
  // mathematics continuing and the rest are proof OBLIGATIONS the tactic
  // generated (a conditional rewrite's side condition). Read off the label for
  // the `isChain` reason — it has to work on both wires, and the CLI ships no
  // syntax.
  //
  // The list is exactly what was MEASURED to branch this way, not a guess.
  // Probed through ppharness: `rw [Nat.sub_add_cancel]` yields
  // `[a = a + 0, b ≤ a]` — main first, and both children arrive `[anonymous]`,
  // so nothing but this family test can tell them apart. `simp only`,
  // `norm_num` and `field_simp` were probed too and DO NOT branch (they
  // discharge the side condition from context or leave a single goal), so
  // listing them would be dead weight. `apply` is deliberately absent: its
  // goals are one per lemma argument and are genuine peers, with no main
  // thread among them — it stays on the plain source-order rule.
  //
  // A multi-rule `rw [a, b]` is SPLIT by Paperproof into one step per rule and
  // the side condition hangs off the split step, whose label is still
  // `rw [...]` — which is why matching the label rather than the whole tactic
  // is what reaches it.
  const MAIN_FIRST_RE = /^(rw|rewrite|erw)\b/;
  const mainFirst = (step: ProofStep) =>
    MAIN_FIRST_RE.test(step.tacticString) && step.goalsAfter.length >= 2;

  // Which relations a chain on each goal could be built out of, enumerated
  // server-side from the real `Trans` instances (see ProofTreeComments.lean's
  // `calcRelationsFor`). An entry with empty `options` is a positive "not
  // chainable"; NO entry means this wire didn't ship the field, and only then
  // does the string-level `spineRelation` heuristic stand in.
  const relsByGoal = new Map<string, CalcRelations>(
    (proof.calcRelations ?? []).map((r) => [r.goalId, r]),
  );
  /** The options for a gesture whose new link must compose back to `T`.
   *
   * `want` is the relation the link BELOW already carries, if any: inserting
   * above a hole leaves that link's relation alone, so only pairs whose SECOND
   * component is it are sound. Getting this wrong emits a suggestion that does
   * not elaborate, which is the one failure this feature cannot tolerate.
   * Opening or appending has no such constraint — both write the second link
   * themselves — so `want` is left undefined there. */
  function relOptions(
    goalId: string,
    fallbackRel: string | undefined,
    want?: string,
  ): CalcRelOption[] | undefined {
    const entry = relsByGoal.get(goalId);
    if (!entry)
      return fallbackRel
        ? [{ rel: fallbackRel, next: fallbackRel, same: true }]
        : undefined;
    const opts = want
      ? entry.options.filter((o) => o.next === want)
      : entry.options;
    return opts.length ? opts : undefined;
  }

  // A calc block that does not PARSE (`calc e` with no subsequent step — the
  // state you are in while typing one) reaches us from SYNTAX alone: it yields
  // no step of its own, and because the whole command fails to parse, nothing
  // below it elaborates either. Measured on the scratch file: a bare `calc`
  // inside the first of three bullets took the other two chains down with it,
  // leaving 2 steps where the repaired file has 12. So the tree shows a proof
  // that just stops, with no hint that a chain was ever started.
  //
  // Attaching the chain to a goal is what puts it back on screen, and which
  // goal depends on how far the block got. Two cases, measured:
  //
  // (a) The block half-elaborated — its FIRST link was complete (`calc a = b
  //     := by omega` with nothing after it), so a step stands for it and that
  //     step's `goalBefore` is the goal the chain must prove. The step may be
  //     labelled with the enclosing bullet rather than the calc, so it is
  //     found by CONTAINMENT of the block's start, innermost first.
  // (b) The block produced no step at all (`calc e`, no relation yet — the
  //     user's case). Then the goal is the PENDING one whose producer sits
  //     closest above it in the source: the tactic the author was working
  //     under. Ties (several pending siblings of one producer) resolve to the
  //     first in source order, the same v1 limit `addSpecFor`'s anchor has.
  //
  // Containment is half-open, which is what keeps (b) out of (a): the producer
  // above a bare calc has a trivia-inflated range ending exactly AT the calc's
  // start, and an inclusive test would hand the chain that tactic's own goal.
  // Value carries the containing step (case (a)) when there is one: the block
  // is then ALREADY drawn as a real tactic node, so the repair chip belongs on
  // that node rather than on a synthesized twin.
  const brokenChainByGoal = new Map<
    string,
    { chain: CalcChain; step?: ProofStep }
  >();
  {
    const broken = (proof.calcChains ?? [])
      .filter((c) => c.broken)
      .sort((a, b) => cmpPos(a.tacticStart, b.tacticStart));
    if (broken.length) {
      const producer = new Map<string, ProofStep>();
      for (const s of proof.steps)
        for (const g of s.goalsAfter) producer.set(g.id, s);
      const pendingIds = [...producer.keys()].filter((id) => !stepByGoal.has(id));
      for (const c of broken) {
        let target: string | undefined;
        // (a) innermost step containing the block: steps nest, so the latest
        // start among the containers is the innermost.
        let inner: ProofStep | undefined;
        for (const s of proof.steps) {
          if (!positionContains(s.position, c.tacticStart)) continue;
          if (!inner || cmpPos(s.position.start, inner.position.start) > 0) inner = s;
        }
        target = inner?.goalBefore.id;
        // (b) no step at all: the nearest pending goal above.
        if (!target) {
          let bestPos: LspPos | undefined;
          for (const id of pendingIds) {
            if (brokenChainByGoal.has(id)) continue;
            const p = producer.get(id)!.position.start;
            if (cmpPos(p, c.tacticStart) >= 0) continue;
            if (!bestPos || cmpPos(p, bestPos) > 0) {
              target = id;
              bestPos = p;
            }
          }
        }
        if (target && !brokenChainByGoal.has(target))
          brokenChainByGoal.set(target, { chain: c, step: inner });
      }
    }
  }

  /** The repair chip for a block that never parsed: one appended link, which
  hands the step parser back the `colGe` anchor it lacked. Shares the
  `calc-append` EDIT exactly — a chain that stopped short and one that never
  parsed both want a link after their last well-formed one. */
  function repairSpec(
    goalId: string,
    chain: CalcChain,
    prod: ProofStep | undefined,
  ): AddSpec | undefined {
    // No well-formed link to append AFTER. When the block is a bare `calc`
    // keyword, that is the state to help with most: write its first link
    // (`calc-first`), both ends `_`, which the staged fill then walks. When it
    // got as far as `calc a = b :=`, the author is mid-keystroke on the
    // justification and there is no honest edit to suggest, so the chain is
    // drawn but carries no chip.
    const first = chain.links < 1;
    if (first && !chain.firstBare) return undefined;
    // The block has no goal of its own, so the relation comes from the goal it
    // was started to prove — which is this one.
    const rels = relOptions(goalId, spineRelation(goals.get(goalId)?.type ?? "")?.rel);
    const rel = rels?.[0].rel;
    if (!rel) return undefined;
    // `producer`/`after` go unread for this kind (calcEdit works off `chain`),
    // but a root goal has no producing step, so fall back to the block itself.
    const at = prod?.position ?? { start: chain.tacticStart, stop: chain.tacticStart };
    return {
      kind: first ? "calc-first" : "calc-append",
      chain,
      rel,
      rels,
      indent: chain.indent,
      producer: at,
      after: at,
    };
  }

  /** The relation a `calc` chain on this goal would be built out of, or
  undefined when the goal isn't the shape a chain can prove.
   *
   * Read off the goal's TYPE STRING, which both wires carry — the alternative
   * (asking the server for the target's head symbol) would have to
   * pretty-print it anyway, and this keeps the whole feature source-agnostic.
   * The test is deliberately conservative: collect the relation-ish tokens at
   * BRACKET DEPTH 0 and fire only when there is exactly one and it is a
   * relation `calc` can chain. That is what rules out `a = b ∧ c = d` (three
   * depth-0 tokens, so the `=` is not the goal's spine) and `∀ m, f m = g m`
   * (a binder head, whose `=` belongs to the body, not the goal). A false
   * positive only costs an edit the author can undo; a false negative hides
   * the affordance entirely, so the bias is toward offering it.
   *
   * Where the server shipped a `Trans` enumeration for this goal, THAT is the
   * answer and the heuristic is not consulted: it is the real test (does a
   * chain of this relation compose back to the goal?) rather than a reading of
   * the printed type, and it declines `Even n ∨ Odd n` and `a ≠ b` — which
   * genuinely cannot be chained — where the vocabulary alone accepted them. */
  function calcRelations(
    goalId: string,
    type: string,
  ): CalcRelOption[] | undefined {
    return relOptions(goalId, spineRelation(type)?.rel);
  }

  /** Grow the chain, in whichever of the two senses this pending goal is:
   *
   * - a HOLE inside the chain (`_ = c := ?_`) grows by inserting a link ABOVE
   *   it, the only extension of a well-formed chain that stays well-typed (the
   *   chain must end at the goal's RHS, so nothing can follow the last link);
   * - the chain's RESIDUE — a `calc.step` goal, what is left when the links
   *   stop short of that RHS — grows by APPENDING a link, which is the only
   *   thing that can close it while staying inside the chain.
   *
   * The two are exclusive by construction (a hole is inside a link, the residue
   * is what the whole block failed to reach) and neither is offered on a
   * chain's first link, which has nothing to insert above it.
   *
   * A third sense shares the append EDIT exactly and is handled by
   * `repairSpec` above, since it applies to a goal that need not be pending:
   * a block that never PARSED also wants one link after its first. */
  function addLinkFor(
    goalId: string,
    prod: ProofStep,
    // The step that PROVES this link, when there is one and it is a bare
    // `sorry` — see the stub branch below.
    stub?: ProofStep,
  ): AddSpec | undefined {
    // A link the tree's own gestures wrote: its justification is a `sorry`
    // (see calcEdit's STUB), so the goal is CONSUMED and none of the pending
    // machinery reaches it — yet it is exactly as unfinished as a hole, and
    // growing the chain above it is exactly as valid. Everything the insert
    // needs is already here: the `sorry`'s line is the link's line, and the
    // chain knows the column its links are written at (which the sorry's own
    // column is not). So the same `calc-link` edit runs against a synthesized
    // anchor, and the two states differ only in what the author typed.
    if (stub) {
      const chain = chainByTactic.get(
        `${prod.position.start.line}:${prod.position.start.character}`,
      );
      // Never above the chain's FIRST link, whose LHS is the chain's head
      // rather than a `_` that would absorb a new predecessor's RHS — the
      // rule `Hole.first` states. Which link is first is read off the
      // consuming steps' own positions, since the wire's link order is not
      // source order.
      const first = firstStubLine(prod);
      if (!chain || first === undefined || stub.position.start.line <= first)
        return undefined;
      const own = spineRelation(goals.get(goalId)?.type ?? "")?.rel;
      const rels = relOptions(goalId, own, relsByGoal.get(goalId)?.rel ?? own);
      return {
        kind: "calc-link",
        hole: {
          goalId,
          start: stub.position.start,
          stop: stub.position.stop,
          ownerStart: {
            line: stub.position.start.line,
            character: chain.indent,
          },
          first: false,
          inCalc: true,
          inBlock: false,
        },
        rel: rels?.[0].rel ?? own,
        rels,
        indent: chain.indent,
        producer: prod.position,
        after: prod.position,
      };
    }
    const hole = holeByGoal.get(goalId);
    // Growing a link ABOVE a hole only means anything inside a chain: it works
    // because the hole's goal restates from the new link's RHS. A `refine`
    // hole has no such structure above it, so it gets the fill-in-place chip
    // (`addSpecFor`) and nothing here.
    if (hole?.inCalc) {
      if (hole.first) return undefined;
      // The link BELOW keeps its own relation, so a new one above it must
      // compose with THAT back to it — hence `want`.
      const own = spineRelation(goals.get(goalId)?.type ?? "")?.rel;
      const rels = relOptions(goalId, own, relsByGoal.get(goalId)?.rel ?? own);
      return {
        kind: "calc-link",
        hole,
        rel: rels?.[0].rel ?? own,
        rels,
        indent: hole.ownerStart.character,
        producer: prod.position,
        after: prod.position,
      };
    }
    // The residue: produced by a calc block, and pending because the chain
    // owes it. `spineRelation` is what the new link would chain — the residue
    // carries the composite relation, which need not be any single link's.
    if (!isChain(prod)) return undefined;
    const chain = chainByTactic.get(
      `${prod.position.start.line}:${prod.position.start.character}`,
    );
    const rels = relOptions(goalId, spineRelation(goals.get(goalId)?.type ?? "")?.rel);
    const rel = rels?.[0].rel;
    if (!chain || !rel) return undefined;
    return {
      kind: "calc-append",
      chain,
      rel,
      rels,
      indent: chain.indent,
      producer: prod.position,
      after: prod.position,
    };
  }

  // The goals a tactic's block OWNS — what a delete on it takes with it.
  //
  // Both halves of this rule are load-bearing and both are already justified
  // elsewhere in this file. Spawned-first is `NodeFlags.targets`' rule: a
  // `have … := by` opens a side proof AND continues the main line, and "delete
  // this have" plainly means the former. And the split test reads `goalsAfter`
  // ALONE, never `stepGoalsAfter` — the same conflation that made a `have`'s
  // continuation look like one branch of a two-way split (see addSpecFor). A
  // single `goalsAfter` is a linear continuation, which the tactic does not own
  // and a delete must leave standing.
  function ownedGoals(step: ProofStep): string[] {
    if (step.spawnedGoals.length > 0) return step.spawnedGoals.map((g) => g.id);
    return step.goalsAfter.length > 1 ? step.goalsAfter.map((g) => g.id) : [];
  }

  // Where a delete gesture on this node reaches (see types.ts DeleteSpec).
  // Positions only — the widget resolves each to a `TacticSlot` and unions
  // them, which is what makes a truncated `induction … with` range and a
  // bullet belonging to no step both come out right.
  function deleteSpecFor(
    kind: "tactic" | "goal",
    step: ProofStep | undefined,
    comments: ProofStepPosition[] | undefined,
  ): DeleteSpec | undefined {
    if (!step) return undefined;
    // A step synthesized from a TERM stands for no `TacticSlot`, and the
    // widget's extent maths resolves an anchor to the SMALLEST slot containing
    // it — so a `calc` link justified by a term (`_ = c := Nat.add_comm a b`)
    // would resolve to the whole `calc` block and the one gesture that writes
    // destructively would take the entire chain, labelled with the link. There
    // is no as-written tactic to delete here, so decline rather than guess —
    // the `prevSameLine` rule, and the same reason it exists. (Term-MODE steps
    // decline for the same reason; they used to do it by accident, because a
    // proof with no `by` has no slots at all, which stops being true the moment
    // one is nested inside it.)
    if (
      recoveredAt.get(
        `${step.position.start.line}:${step.position.start.character}`,
      ) === "term"
    )
      return undefined;
    const anchors = [step.position];
    // A goal's whole proof is everything below it, continuation included —
    // that IS its proof. A tactic keeps its continuation.
    const owned =
      kind === "goal"
        ? stepGoalsAfter(step).map((g) => g.id)
        : ownedGoals(step);
    for (const g of owned) {
      const last = subtreeLastStep(g);
      if (last) anchors.push(last.position);
    }
    return { kind, anchors, comments: comments ?? [] };
  }

  /** Where a FIRST tactic goes, in a `by` block with nothing in it.
   *
   * Everything an insertion needs is on `Proof.openBlock`, because the client
   * cannot work any of it out: there is no producing step whose column to copy
   * and no `TacticEdit` to resolve a tight end through. `kind: "seq"` — a plain
   * next line — since nothing has split yet; `producer` and `after` are both
   * the anchor (end of the `by`), which no `TacticEdit` starts at, so
   * `addTactic`'s two lookups miss and fall back to exactly the shipped
   * `indent` and to end-of-line on the anchor's line. That is the ordinary
   * insertion rule, which is why a trailing comment on the `by` line keeps its
   * place and the new tactic lands under it. */
  function openBlockSpec(ob: OpenBlock): AddSpec {
    const at = { start: ob.anchor, stop: ob.anchor };
    return { kind: "seq", indent: ob.indent, producer: at, after: at };
  }

  function addSpecFor(goalId: string, prod: ProofStep): AddSpec {
    // A pending goal that is a HOLE no sibling can serve is filled where it
    // sits. `inBlock` is the whole test, and it is narrower than "is a hole"
    // on purpose: where a sibling tactic CAN be written it is the better edit,
    // because `refine ⟨?_, ?_⟩` + `· exact h` is what one writes by hand and
    // filling in place would give `refine ⟨by exact h, ?_⟩` — legal, worse.
    // The two cases left are the ones with nowhere to append: a `calc` link
    // (whose generic anchor is the last step INSIDE the chain, so the new
    // tactic lands mid-block and breaks it) and a hole in a term-mode proof
    // (no tactic block at all).
    const hole = fillableHole(goalId);
    if (hole)
      return {
        kind: "hole",
        hole,
        indent: hole.ownerStart.character,
        producer: prod.position,
        after: prod.position,
      };
    const label = prod.tacticString.trimEnd();
    const base = prod.position.start.character;
    let anchor = prod;
    for (const g of stepGoalsAfter(prod)) {
      const b = subtreeLastStep(g.id);
      if (b && cmpPos(b.position.stop, anchor.position.stop) > 0) anchor = b;
    }
    // The `with` test MUST outrank the split rule: an induction with a single
    // case still needs its `| case =>` marker — a bare next line after `with`
    // is a syntax error, and a one-case with-block is common
    // (`Nat.strong_induction_on`).
    if (label.endsWith("with"))
      return {
        kind: "case",
        indent: base,
        producer: prod.position,
        after: anchor.position,
        caseName: caseName(goals.get(goalId)),
      };
    // Whether to bullet is decided by `goalsAfter` ALONE — a genuine case
    // split — never by `stepGoalsAfter`, which folds in `spawnedGoals`. That
    // conflation is what made a `have … := by`'s CONTINUATION look like one
    // branch of a two-way split and emit `· tac` where a plain next line
    // belongs: one continuation + one spawned body counts 2 and isn't a split
    // at all.
    if (prod.goalsAfter.length <= 1)
      return {
        kind: "seq",
        indent: base,
        producer: prod.position,
        after: anchor.position,
      };
    return {
      kind: "bullet",
      indent: base,
      producer: prod.position,
      after: anchor.position,
    };
  }

  const roots = rootIds(proof);

  // Source comments, attributed to node ids (see attributeComments). Root
  // narrative (before the first tactic / the docstring) keys on the root goal.
  const commentByNode = attributeComments(
    proof.comments ?? [],
    proof.steps,
    roots[0],
    slots ?? proof.deleteSlots ?? [],
  );

  // Which GOAL each comment's hypothesis flags speak about. A flag comment
  // attributed to a tactic is written directly above it, and the goal box
  // drawn there is the one that tactic CONSUMES — so that is what `.no-hyps` /
  // `.h#name` narrow. (Alectryon frames a flag as governing its sentence's
  // OUTPUT, which is the right reading for `.fold`/`.none` below, where the
  // output is the subtree. It does not survive the translation for context:
  // a tree draws a goal above its tactic, not after it, and a closing tactic
  // like `omega` has no output at all — so under the output reading the flag
  // on the branch you were annotating would silently do nothing.)
  const hypFlags = new Map<string, ParsedFlags>();
  for (const [nodeId, f] of commentByNode.flags)
    hypFlags.set(
      nodeId.startsWith(TACTIC_PREFIX) ? nodeId.slice(TACTIC_PREFIX.length) : nodeId,
      f,
    );

  const nodes: TreeNode[] = [];
  const emittedGoals = new Set<string>();

  // DFS from a goal, given the parent edge that reaches it and the step that
  // produced it. Root goals get neither: they're the theorem's original
  // goal(s), not produced by any tactic.
  function visitGoal(
    goalId: string,
    parents: TreeNode["parents"],
    producedBy?: ProofStep,
    // The case name in force at the parent goal. A case tag propagates to
    // every descendant, so showing it unconditionally would stamp `neg` on all
    // nine goals of a branch; the badge marks where a case is ENTERED.
    parentCase?: string,
    // Brief mode, `calc` links only: the LHS text this goal may show as `_`
    // (see chainLhsElisions). Decided by the producing tactic, which is the
    // only place the sibling links are all in view.
    lhsElide?: string,
    // I am a generated proof obligation rather than the main line (see
    // TreeNode.side). Decided by the producing tactic, the only place the
    // goalsAfter/spawnedGoals boundary and the sibling ORDER are still visible.
    side?: boolean,
    // I came from the producer's `spawnedGoals` — a block it opened, not the
    // main line (see TreeNode.spawned). Same reasoning as `side`: the
    // goalsAfter/spawnedGoals boundary exists only here.
    spawned?: boolean,
    // I am a SETTLED `calc` link whose statement is a row of this ledger node
    // (see TreeNode.ledger): draw no goal box, and hang my justification off
    // the ledger instead. The recursion below is otherwise identical — the
    // tactic node keeps its own id, position and editing seam.
    ledgerParent?: string,
    // I am somewhere inside a `calc` chain's justification subtrees, and `ctx`
    // is the context block the chain draws once at its top (empty when the
    // chain has no ledger to draw it in). Two chain-local defaults ride it, and
    // both are about ink the reader has already read: context lines repeating
    // `ctx` are dropped (see contextFor's `inherited`), and an `rw`'s `x = x`
    // residue is stamped so the proof opens with it folded (TreeNode.rflResidue).
    // Threaded rather than derived because "am I under a chain" is a fact about
    // the path, and this recursion is the only place it is in hand.
    chainCtx?: ReadonlySet<string>,
  ): void {
    if (emittedGoals.has(goalId)) return; // a proof tree is acyclic, but be safe
    emittedGoals.add(goalId);

    const goal = goals.get(goalId);
    const step = stepByGoal.get(goalId);
    const thisCase = caseName(goal);
    // A chain link may show `_` for its LHS, exactly as the source writes it.
    // Slicing the ORIGINAL text (rather than re-joining `_` with the relation
    // and RHS) keeps the spacing the pretty-printer chose, and the startsWith
    // guard means a mismatch simply leaves the label whole.
    // (+) only on an unconsumed goal reached through `goalsAfter`. An
    // unconsumed SPAWNED goal is not the editing frontier: Paperproof emits
    // side goals that no tactic ever consumes because they are restatements of
    // goals already handled inside the branches (factorization.lean's
    // `induction … with` spawns two, from merged `intro p hpm` binders), and
    // offering to "solve" those put chips on a complete proof. Measured across
    // the incomplete-proof corpora, every genuine frontier goal arrives via
    // goalsAfter and none via spawnedGoals. The three chip slots share the
    // test, so they can never disagree about whether a goal is pending.
    //
    // The OPEN BLOCK's root is the second clause, and it is a different shape
    // rather than a widening of the first: it has no producer to be reached
    // THROUGH, because nothing has been written yet. It is the frontier by the
    // plain reading — a goal nothing consumes — and the spawned-goal exclusion
    // above does not touch it (that rule is about restatements a branch already
    // handled; there are no branches here). This is what puts the ordinary
    // `+`/`sorry`/`calc` row under `theorem foo : P := by`, where the tree used
    // to draw a dashed counterfactual stub labelled with the theorem line.
    // Server-side `calcRelationGoals` carries the mirror clause.
    const openRoot = !step && !producedBy && goalId === proof.openBlock?.goal.id;
    const pending =
      openRoot ||
      (!step && !!producedBy && producedBy.goalsAfter.some((g) => g.id === goalId));
    // A block that never parsed gets its repair chip whether or not the goal
    // is pending: when the block's first link WAS complete, a step stands for
    // it and the goal it consumes is an ordinary interior goal.
    const brokenChain = brokenChainByGoal.get(goalId);
    // The repair chip ALWAYS rides the `calc` node — the thing it acts on —
    // never the goal above it: where a step stands for the block that is the
    // step's own node, and where none does it is the node synthesized below.
    // The goal must therefore not carry it too, or the same repair is offered
    // twice, one lane drawing over the node between them.
    // A link the tree wrote is proved by a `sorry` rather than left pending,
    // so growing the chain there has to be offered off the CONSUMING step
    // instead. Everything else is unchanged: a broken block owns the lane,
    // and a goal that is neither pending nor a stubbed link gets nothing.
    const stub =
      !brokenChain && !pending && step && producedBy && isChain(producedBy) && isStub(step)
        ? step
        : undefined;
    const addLink =
      // `!producedBy` excludes exactly the OPEN BLOCK's root: no chain has
      // been written above a goal nothing produced, so there is none to grow.
      brokenChain || !producedBy || (!pending && !stub)
        ? undefined
        : addLinkFor(goalId, producedBy, stub);
    const goalText = goal?.type ?? goalId;
    const elided =
      lhsElide && goalText.startsWith(lhsElide)
        ? "_" + goalText.slice(lhsElide.length)
        : undefined;
    // The local context this goal draws. Hoisted out of the node literal
    // because the LEDGER below draws the chain goal's own block — the same
    // lines, computed once here, so the block a chain shows at its top and the
    // block its links are measured against cannot be two different answers.
    const goalHyps =
      goal &&
      contextFor(
        goal,
        step,
        producedBy,
        hypMode,
        hypFlags.get(goalId),
        hypMode === "used" ? subtreeUsed(goalId) : undefined,
        hypGroup,
        chainCtx,
      );
    // The `x = x` an `rw` leaves behind, inside a chain (see
    // TreeNode.rflResidue). Structural on both halves of the pair: the goal is
    // a reflexivity on its relation spine, and the step consuming it is the
    // `rw [rfl]` the macro's own `with_reducible rfl` gets prettified into.
    // A hand-written `rw [rfl]` closing an `x = x` matches too, which is right
    // — it is the same no-op, and the fold is one click from being undone.
    const rflResidue = (() => {
      if (!chainCtx || !goal || !step) return undefined;
      if (!/^rw \[rfl\](\s|$)/.test(step.tacticString)) return undefined;
      const r = spineRelation(goal.type);
      return r && r.rel === "=" && r.lhs === r.rhs ? true : undefined;
    })();
    // A settled `calc` link states itself as a row of the ledger node above,
    // so it draws no box of its own. Everything computed for it (the chips, the
    // delete spec) is dead here BY CONSTRUCTION rather than by omission: a link
    // that could carry any of them is not settled and never reaches this.
    if (!ledgerParent)
      nodes.push({
      id: goalId,
      // The turnstile prefix marks goal boxes as GOALS at a glance (same
      // convention as the infoview's goal display). The widget's tagged
      // renderer strips it before matching the interactive print
      // (taggedRender), so keep the two in sync via TURNSTILE.
      label: TURNSTILE + (elided ?? goalText),
      goalElision: elided ? { hidden: lhsElide! } : undefined,
      type: "goal",
      parents,
      // An obligation the producing tactic generated, not the main line (see
      // TreeNode.side) — `undefined` rather than `false` so a plain goal's
      // node is byte-identical to what it was before this existed.
      side: side || undefined,
      // A block the producing tactic opened rather than the main line (see
      // TreeNode.spawned) — `undefined` not `false`, same reason as `side`.
      spawned: spawned || undefined,
      // The producing tactic's source span, for the widget's node↔source link
      // (see types.ts `TreeNode.position`).
      position: producedBy?.position,
      // The local context rides the goal node itself and is drawn inside its
      // box, above the `⊢ ` line — the goal and the assumptions it holds under
      // are one thing to read, exactly as the infoview shows them.
      hyps: goalHyps,
      // Open folded: the `x = x` an `rw` left behind (see TreeNode.rflResidue).
      rflResidue,
      comment: commentByNode.text.get(goalId),
      commentRanges: commentByNode.ranges.get(goalId),
      // A root goal's own flags (the pre-proof narrative slot) act on the
      // tactic that opens the proof, i.e. on everything below.
      flags: nodeFlags(
        commentByNode.flags.get(goalId),
        step ? [tacticId(goalId)] : [],
      ),
      flagRanges: commentByNode.flagRanges.get(goalId),
      // A hyp-narrowing directive was consumed for THIS goal's context (its
      // comment — and so its flagRanges — lives on the consuming tactic).
      hypFlagged:
        !!hypFlags.get(goalId)?.noHyps ||
        (hypFlags.get(goalId)?.onlyHyps?.length ?? 0) > 0 ||
        undefined,
      // Lean's tag is the full case PATH (`refine_1.calc.step`), whose head is
      // the case the goal above already badges — so show only what this goal
      // adds. Without that, the residue of a chain inside a branch reads as
      // `refine_1.calc.step` under a box already labelled `refine_1`.
      caseLabel:
        thisCase === parentCase
          ? undefined
          : parentCase && thisCase?.startsWith(parentCase + ".")
            ? thisCase.slice(parentCase.length + 1)
            : thisCase,
      // A goal whose calc block failed to parse gets the repair chip ALONE.
      // The other two would insert above the broken block, leaving it broken —
      // even `sorry` cannot close a goal the parser never reached.
      addSpec:
        pending && !brokenChainByGoal.has(goalId)
          ? producedBy
            ? addSpecFor(goalId, producedBy)
            : openBlockSpec(proof.openBlock!)
          : undefined,
      // Grow the chain — insert a link above this hole, or append one to close
      // the chain's residue (see addLinkFor).
      addLink,
      // OPEN a chain: offered on a pending goal that is a relation and isn't
      // already part of one. The three are mutually exclusive on purpose —
      // inside a chain the chain gesture is `addLink`, outside it is this — so
      // a goal never shows more than three chips.
      calcRels:
        pending &&
        goal &&
        !fillableHole(goalId) &&
        !addLink &&
        !brokenChain
          ? calcRelations(goalId, goal.type)
          : undefined,
      // Clearing a goal removes its whole proof. A ROOT goal is excluded from
      // the comment sweep rather than from the gesture: its strip is the
      // theorem's docstring (and any pre-proof narrative), which is not part
      // of the proof being cleared.
      deleteSpec: deleteSpecFor(
        "goal",
        step,
        roots.includes(goalId) ? [] : commentByNode.ranges.get(goalId),
      ),
      });

    // A block that never parsed and has no step of its own is INVENTED here,
    // so the tree can draw the chain the moment `calc` is typed. It stands
    // where the calc is, laid out as a chain column, and carries the repair
    // chip; everything below it is genuinely absent, because the command did
    // not parse. Emitted before the `!step` return so DFS pre-order — which
    // combineRuns and elide.ts's slot arithmetic rely on — is preserved.
    if (brokenChain && !brokenChain.step) {
      const c = brokenChain.chain;
      nodes.push({
        id: `calc:${c.tacticStart.line}:${c.tacticStart.character}`,
        label: c.text,
        type: "tactic",
        parents: [{ id: ledgerParent ?? goalId }],
        // The REPORTABLE span, never the block's syntax range: a broken block's
        // range covers the tactic the parser swallowed, and the cursor accent
        // would let this node claim a neighbour's positions.
        position: { start: c.tacticStart, stop: c.stop },
        chain: true,
        synthetic: true,
        addLink: repairSpec(goalId, c, producedBy),
      });
    }

    if (!step) return; // leaf: this goal was closed by its tactic

    const tId = tacticId(goalId);
    const fullLabel = cleanLabel(step.tacticString, proof.comments ?? []);
    // Brief mode collapses boilerplate to `…`: the node then carries the
    // collapsed string as its label (what layout measures) plus the map back
    // to the original for the token renderer. `null` = nothing collapsed.
    const collapsed = brief ? collapseLabel(fullLabel) : null;
    const chain = isChain(step);
    const drawnLabel = collapsed ? collapsed.text : fullLabel;
    nodes.push({
      id: tId,
      label: drawnLabel,
      elision: collapsed
        ? {
            original: collapsed.original,
            keep: collapsed.keep,
            marks: collapsed.marks,
          }
        : undefined,
      type: "tactic",
      parents: [{ id: ledgerParent ?? goalId }],
      // A `calc` block's children are the chain's links (see TreeNode.chain).
      // Read off the RAW tacticString rather than a server-side syntax kind
      // because the flag has to work on BOTH wires, and the CLI's NDJSON ships
      // no syntax; `calc` is a keyword at the head of the tactic, so the
      // prefix is the same signal the parser used.
      chain,
      // Carry the tactic's source span so the widget can link this node back to
      // the `.lean` source (see types.ts `TreeNode.position`).
      position: step.position,
      recovered: recoveredAt.get(
        `${step.position.start.line}:${step.position.start.character}`,
      ),
      comment: commentByNode.text.get(tId),
      commentRanges: commentByNode.ranges.get(tId),
      // Spawned goals first (see NodeFlags.targets): a `have … := by` opens a
      // side proof AND continues the main line, and a flag on it means the
      // side proof.
      flags: nodeFlags(
        commentByNode.flags.get(tId),
        (step.spawnedGoals.length > 0 ? step.spawnedGoals : step.goalsAfter).map(
          (g) => g.id,
        ),
        true, // a `.none` here cuts THIS tactic, targets or not
      ),
      flagRanges: commentByNode.flagRanges.get(tId),
      // The repair chip for a block that never parsed, when a step DOES stand
      // for it (its first link was complete, so the block half-elaborated).
      // It rides the calc's own node — the thing the repair acts on — rather
      // than the goal above, which is where a chip would point at nothing.
      // The step may be labelled with the enclosing bullet (`· calc a ≤ b`),
      // which is exactly why the chain was found by CONTAINMENT.
      addLink:
        brokenChain?.step === step
          ? repairSpec(goalId, brokenChain.chain, producedBy)
          : undefined,
      // Delete this tactic and any block it owns — never its continuation.
      deleteSpec: deleteSpecFor("tactic", step, commentByNode.ranges.get(tId)),
    });

    // The LEDGER: this chain's settled links, drawn as one column under the
    // `calc` node instead of one goal box each. Emitted here — directly after
    // the tactic node and before any child — so DFS preorder holds, which
    // elide.ts's slot arithmetic and combineRuns rely on. Its id is the
    // chain's own START POSITION (the synthesized `calc:` node's precedent):
    // a source fact, never an mvarId, though the rows carry the link goal ids
    // for the lookups that need them.
    //
    // Declined on a BROKEN block: that state already has its own synthesized
    // node and repair chip, and its links are exactly the ones not to redraw.
    const built = ledger && chain && !brokenChain ? ledgerFor(step) : null;
    // The head row goes wherever the `calc` node's own label already writes the
    // chain's LHS (see `ledgerHead`).
    const led =
      built && !ledgerHead(drawnLabel)
        ? { ...built, rows: built.rows.filter((r) => !isLedgerHead(r)) }
        : built;
    // The chain's own context, drawn ONCE at the top of its column and then
    // subtracted from every goal inside it. The lines are the ones the goal
    // above the `calc` draws — the same call, hoisted — so the two cannot say
    // different things about what this chain holds under.
    // An EMPTY set inside a chain that has no ledger to draw the block in: the
    // presence of the set is "I am under a chain" (which is what stamps the
    // `rw` residues), its contents are "and this much is already drawn above
    // you" (which is what the context lines subtract). The two are independent
    // — `?no-ledger` still folds residues — so they are one value with two
    // readings rather than two parameters that could disagree about the path.
    const chainCtxNext = chain
      ? led && goalHyps
        ? new Set(goalHyps.map((h) => h.text))
        : EMPTY_CTX
      : chainCtx;
    if (led) {
      const at = step.position.start;
      nodes.push({
        id: `ledger:${at.line}:${at.character}`,
        // The joined rows: a generic reader (the overview chip, a `<title>`,
        // an elide preview) gets the chain's text, while the LAYOUT measures
        // the rows themselves so each keeps its own indent (see ledgerSize).
        label: led.rows.map((r) => r.text).join("\n"),
        type: "goal",
        parents: [{ id: tId }],
        // A goal node's position is its PRODUCER's, and the producer of every
        // row here is this one `calc` step.
        position: step.position,
        ledger: led.rows,
        // The chain's context block, drawn above the rows. Its lines belong to
        // the goal the `calc` consumes, which is what the widget's interactive
        // context lines have to be keyed by (see TreeNode.hypGoalId).
        //
        // The SAME lines that goal box draws, since it is the same call: the
        // goal sits two links above the ledger in every layout, so drawn as
        // well as computed they are one block printed twice, adjacently (3
        // lines, 39px, on the tour's chain). So the ledger says whose copy its
        // is and lets the LAYOUT drop it while that copy is on screen — see
        // TreeNode.hypsInheritedFrom, and `inherited` above for the same
        // subtraction applied to the links' own boxes.
        //
        // Not under ∀ (`full`), where the reader has asked every box for its
        // whole context and `inherited` stands down too. One rule, so the
        // breadth cycle keeps working inside a chain.
        hyps: goalHyps,
        hypGoalId: goalId,
        hypsInheritedFrom:
          hypMode !== "full" && goalHyps?.length ? goalId : undefined,
        // My children are the chain's JUSTIFICATIONS — one per row, a list and
        // not a split — so none of them resumes the trunk and they read as a
        // column under the rows they answer. Exactly why the `calc` node above
        // carries the flag (see TreeNode.chain); the ledger inherits it because
        // the ledger is now what those children hang off.
        chain: true,
      });
    }

    // A chain's links can drop the LHS the box above them already shows —
    // brief-only, since it hides text that is genuinely part of the goal. A
    // LEDGERED link needs none of it: the ledger writes the chain the way the
    // source does, LHS omitted, by construction.
    const children = stepGoalsAfter(step);
    const linkElisions =
      brief && chain && !led
        ? chainLhsElisions(children, step.goalBefore.type)
        : undefined;
    // Everything a main-first tactic produced EXCEPT `goalsAfter[0]` is an
    // obligation it generated. Keyed on the goal id rather than the loop index
    // because `children` is `goalsAfter ++ spawnedGoals` and only the first of
    // the goalsAfter half is the main line.
    const mainGoalId = mainFirst(step) ? step.goalsAfter[0].id : undefined;
    const spawnedIds = new Set(step.spawnedGoals.map((g) => g.id));
    // Ledgered links go FIRST and in ROW order, so each row's justification
    // subtree sits under the row that states it; the unsettled links follow in
    // the order they always had. Both halves are one `visitGoal` call apiece —
    // the only difference is that a settled link's goal box is replaced by its
    // row, which is what `ledgerParent` says.
    const order = led
      ? [
          ...led.rows.flatMap((r) =>
            children.filter((c) => c.id === r.goalId),
          ),
          ...children.filter((c) => !led.settled.has(c.id)),
        ]
      : children;
    const ledgerId = `ledger:${step.position.start.line}:${step.position.start.character}`;
    // THE SPINE, AND IT IS A GLOSS — said plainly because this repository
    // documents its glosses. A chain's links really are INDEPENDENT goals: the
    // `calc` step spawns all of them at once, none is reached through another,
    // and hung off the ledger as the peers they are they fan into one sibling
    // subtree per link. Read as a tree that is honest and useless — four
    // parallel stubs saying nothing about the order they are read in, and under
    // ⋔ wide a rectangle of unrelated columns.
    //
    // So each link's justification is re-parented onto the PREVIOUS link's
    // terminal node, chaining them in SOURCE order. What that draws is what the
    // source writes and what the reader needs: link i+1 steps from where link i
    // arrived, top to bottom, one column. The dependence is real mathematics
    // (RHS_i ≡ LHS_{i+1} is the ledger's own prefix invariant — see
    // `ledgerFor`); what is glossed is only that Lean reaches the links side by
    // side rather than one through the next.
    //
    // Only `parents` moves. Ids, positions, the editing seam and DFS PREORDER
    // are untouched — the new parent is always a node emitted earlier in the
    // same array, which is what elide.ts's slot arithmetic and `combineRuns`
    // rely on. Fold state keys on tree PATH (`pathKeys`), so it re-keys once.
    let spine: string | undefined;
    for (const child of order) {
      const ledgered = led?.settled.has(child.id) ?? false;
      const parent = ledgered ? (spine ?? ledgerId) : undefined;
      const mark = nodes.length;
      visitGoal(
        child.id,
        [{ id: tId }],
        step,
        thisCase,
        linkElisions?.get(child.id),
        mainGoalId !== undefined && child.id !== mainGoalId,
        spawnedIds.has(child.id),
        parent,
        chainCtxNext,
      );
      if (ledgered) spine = chainTerminal(mark, parent!);
    }
  }

  /** Where the NEXT link in a chain hangs — the deepest node of the link just
   * emitted at `from`, walking down last-child by last-child from `parent`.
   *
   * It stops ABOVE an `rw`'s folded `x = x` residue, so the terminal is that
   * link's justification and the residue stays a leaf beside the next link.
   * That is the choice between the two properties: the residue opens FOLDED
   * (see TreeNode.rflResidue), and a fold hides every child, so hanging the
   * next link under the residue would take the whole rest of the chain with it
   * the moment the proof opened. Seeding the fold to hide only the `rw [rfl]`
   * is not expressible — `collapsed` names a node, not a subset of its
   * children. Both properties hold this way: residues folded, chain visible,
   * and the residue branches off a spine that carries on past it. */
  function chainTerminal(from: number, parent: string): string {
    const range = nodes.slice(from);
    let cur = parent;
    for (;;) {
      let next: TreeNode | undefined;
      // Last in EMISSION order: DFS preorder makes that the deepest branch.
      for (const n of range) if (n.parents.some((p) => p.id === cur)) next = n;
      if (!next || next.rflResidue) return cur;
      cur = next.id;
    }
  }

  for (const rootId of roots) visitGoal(rootId, []);
  return nodes;
}

