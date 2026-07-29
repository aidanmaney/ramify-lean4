import type {
  CalcChain,
  CalcHole,
  CalcRelOption,
  CalcRelations,
  GoalInfo,
  Hypothesis,
  Proof,
  ProofStep,
  ProofStepPosition,
  SourceComment,
} from "./paperproof";
import { stepGoalsAfter } from "./paperproof";
import type {
  AddSpec,
  DeleteSpec,
  HypLine,
  NodeFlags,
  TreeNode,
} from "./types";
import { collapseLabel } from "./briefLabel";

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
const tacticId = (goalId: string): string => `${TACTIC_PREFIX}${goalId}`;

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
// but not its deeper reaches. Context order is preserved in every mode.
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
  // `.h#name` INTERSECTS with the rail's breadth rather than overriding it, so
  // the two controls compose: a named hyp the current mode wouldn't show stays
  // hidden, and switching to ∀ reveals it. Filtering last is what makes that
  // true — the mode branches above rebuild from `goal.hyps` each time.
  if (flags?.onlyHyps?.length)
    shown = shown.filter((h) => flags.onlyHyps!.includes(h.username));
  return shown.map((h) => ({ text: hypLine(h), used: used.has(h.id) }));
}

// All goals referenced by a proof, indexed by mvarId. `allGoals` is
// authoritative, but we also fold in goals embedded in steps so a tree can
// never reference an id we don't have.
function goalIndex(proof: Proof): Map<string, GoalInfo> {
  const goals = new Map<string, GoalInfo>();
  for (const g of proof.allGoals) goals.set(g.id, g);
  for (const step of proof.steps) {
    for (const g of [step.goalBefore, ...stepGoalsAfter(step)]) {
      if (!goals.has(g.id)) goals.set(g.id, g);
    }
  }
  return goals;
}

// Root goal ids: consumed by some tactic but never produced by one — the
// original theorem goal(s). Order follows first appearance in `steps`.
export function rootIds(proof: Proof): string[] {
  const produced = new Set<string>();
  for (const step of proof.steps) {
    for (const g of stepGoalsAfter(step)) produced.add(g.id);
  }
  return proof.steps
    .map((s) => s.goalBefore.id)
    .filter((id, i, arr) => arr.indexOf(id) === i && !produced.has(id));
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
const cmpPos = (a: LspPos, b: LspPos): number =>
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
function cleanMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, (_, code: string) => code.replace(/ /g, NBSP));
}

// Display form of a raw comment: delimiters stripped, block-comment lines
// trimmed (they carry the source indentation), blank edge lines dropped, and
// markdown noise cleaned (see cleanMarkdown).
function stripComment(raw: string): string {
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
  return cleanMarkdown(paras.join("\n\n"));
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
const FLAG_RE = /^\.([a-zA-Z][\w-]*)(?:#(\S+))?$/;

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
function nodeFlags(
  f: ParsedFlags | undefined,
  targets: string[],
): NodeFlags | undefined {
  if (!f || (!f.fold && !f.elide) || targets.length === 0) return undefined;
  const out: NodeFlags = { targets };
  if (f.fold) out.fold = true;
  if (f.elide) out.elide = true;
  // The note is only ever SHOWN in place of an elision; anywhere else the
  // prose is already the node's comment strip.
  if (f.elide && f.prose) out.note = f.prose;
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
// 2. Entirely BEFORE the first tactic (between `by` and step 1 — including
//    the theorem's docstring, which the command range covers) → the ROOT
//    goal: that's the "here's the plan" narrative slot.
// 3. LEADING — the next tactic starting at/after it (the common
//    `-- explain, then do` shape; bullet lines land here too, since the
//    consumed goal's tactic starts past the `·`).
// 4. Dangling after everything (rare) → the last tactic before it.
function attributeComments(
  comments: SourceComment[],
  steps: ProofStep[],
  rootId: string | undefined,
): {
  text: Map<string, string>;
  ranges: Map<string, ProofStepPosition[]>;
  flags: Map<string, ParsedFlags>;
} {
  const out = new Map<string, string>();
  const ranges = new Map<string, ProofStepPosition[]>();
  const flags = new Map<string, ParsedFlags>();
  if (comments.length === 0 || steps.length === 0)
    return { text: out, ranges, flags };
  const byStart = [...steps].sort((a, b) =>
    cmpPos(a.position.start, b.position.start),
  );
  const first = byStart[0];
  let cur: SourceComment;
  const add = (nodeId: string, raw: string) => {
    const f = parseFlags(raw);
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
    const text = stripComment(c.text);
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
                cmpPos(s.position.start, container.position.stop) <= 0,
            );
      add(tacticId((inner ?? container).goalBefore.id), text);
      continue;
    }
    if (rootId && cmpPos(c.stop, first.position.start) <= 0) {
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
  return { text: out, ranges, flags };
}

// Tactic labels are raw source text of the step's range — which, because the
// range includes trailing trivia, can carry the very comments we now draw as
// strips. Scrub them from the label (they're identified by exact text) and
// tidy the leftover line-end whitespace.
function cleanLabel(label: string, comments: SourceComment[]): string {
  let t = label;
  for (const c of comments)
    if (t.includes(c.text)) t = t.split(c.text).join("");
  const lines = t.split("\n").map((l) => l.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1].trim() === "")
    lines.pop();
  return lines.join("\n");
}

export interface ProofToTreeOptions {
  /**
   * How much of each goal's local context to draw — see `HypMode`. Defaults to
   * `used` (what the proof below the goal actually depends on), matching the
   * rail's own starting mode so the two can't drift.
   */
  hypMode?: HypMode;
  /**
   * Brief mode: collapse mechanical boilerplate inside each tactic label to
   * `…` (see briefLabel.ts). Off by default; a geometry-affecting toggle, so
   * the engine is rebuilt when it flips (same as reflow).
   */
  brief?: boolean;
}

export function proofToTree(
  proof: Proof,
  { hypMode = "used", brief = false }: ProofToTreeOptions = {},
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
  // Unproved `calc` links, keyed by the goal each `?_` stands for. The Lean
  // side pairs them by metavariable, so this join is exact rather than
  // positional (see paperproof.ts `CalcHole`).
  const holeByGoal = new Map<string, CalcHole>(
    (proof.calcHoles ?? []).map((h) => [h.goalId, h]),
  );
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
    // keyword, that is the state to help with most: write its first two links
    // (`calc-first`). When it got as far as `calc a = b :=`, the author is
    // mid-keystroke on the justification and there is no honest edit to
    // suggest, so the chain is drawn but carries no chip.
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
  function addLinkFor(goalId: string, prod: ProofStep): AddSpec | undefined {
    const hole = holeByGoal.get(goalId);
    if (hole) {
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
        indent: hole.linkStart.character,
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

  function addSpecFor(goalId: string, prod: ProofStep): AddSpec {
    // A pending goal that is a calc HOLE is filled where it sits: the generic
    // line insertion below would anchor on the last step written INSIDE the
    // chain and drop a tactic into the middle of the block, breaking it.
    const hole = holeByGoal.get(goalId);
    if (hole)
      return {
        kind: "hole",
        hole,
        indent: hole.linkStart.character,
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
    const pending =
      !step && !!producedBy && producedBy.goalsAfter.some((g) => g.id === goalId);
    // A block that never parsed gets its repair chip whether or not the goal
    // is pending: when the block's first link WAS complete, a step stands for
    // it and the goal it consumes is an ordinary interior goal.
    const brokenChain = brokenChainByGoal.get(goalId);
    // The repair chip ALWAYS rides the `calc` node — the thing it acts on —
    // never the goal above it: where a step stands for the block that is the
    // step's own node, and where none does it is the node synthesized below.
    // The goal must therefore not carry it too, or the same repair is offered
    // twice, one lane drawing over the node between them.
    const addLink =
      brokenChain || !pending ? undefined : addLinkFor(goalId, producedBy!);
    const goalText = goal?.type ?? goalId;
    const elided =
      lhsElide && goalText.startsWith(lhsElide)
        ? "_" + goalText.slice(lhsElide.length)
        : undefined;
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
      // The producing tactic's source span, for the widget's node↔source link
      // (see types.ts `TreeNode.position`).
      position: producedBy?.position,
      // The local context rides the goal node itself and is drawn inside its
      // box, above the `⊢ ` line — the goal and the assumptions it holds under
      // are one thing to read, exactly as the infoview shows them.
      hyps:
        goal &&
        contextFor(
          goal,
          step,
          producedBy,
          hypMode,
          hypFlags.get(goalId),
          hypMode === "used" ? subtreeUsed(goalId) : undefined,
        ),
      comment: commentByNode.text.get(goalId),
      commentRanges: commentByNode.ranges.get(goalId),
      // A root goal's own flags (the pre-proof narrative slot) act on the
      // tactic that opens the proof, i.e. on everything below.
      flags: nodeFlags(
        commentByNode.flags.get(goalId),
        step ? [tacticId(goalId)] : [],
      ),
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
          ? addSpecFor(goalId, producedBy!)
          : undefined,
      // Grow the chain — insert a link above this hole, or append one to close
      // the chain's residue (see addLinkFor).
      addLink,
      // OPEN a chain: offered on a pending goal that is a relation and isn't
      // already part of one. The three are mutually exclusive on purpose —
      // inside a chain the chain gesture is `addLink`, outside it is this — so
      // a goal never shows more than three chips.
      calcRels:
        pending && goal && !holeByGoal.has(goalId) && !addLink && !brokenChain
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
        parents: [{ id: goalId }],
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
    nodes.push({
      id: tId,
      label: collapsed ? collapsed.text : fullLabel,
      elision: collapsed
        ? { original: collapsed.original, keep: collapsed.keep }
        : undefined,
      type: "tactic",
      parents: [{ id: goalId }],
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
      ),
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

    // A chain's links can drop the LHS the box above them already shows —
    // brief-only, since it hides text that is genuinely part of the goal.
    const children = stepGoalsAfter(step);
    const linkElisions =
      brief && chain
        ? chainLhsElisions(children, step.goalBefore.type)
        : undefined;
    for (const child of children) {
      visitGoal(
        child.id,
        [{ id: tId }],
        step,
        thisCase,
        linkElisions?.get(child.id),
      );
    }
  }

  for (const rootId of roots) visitGoal(rootId, []);
  return nodes;
}

