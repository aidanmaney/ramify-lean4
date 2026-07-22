import type {
  GoalInfo,
  Hypothesis,
  Proof,
  ProofStep,
  ProofStepPosition,
  SourceComment,
} from "./paperproof";
import { stepGoalsAfter } from "./paperproof";
import type { AddSpec, HypLine, TreeNode } from "./types";

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
const tacticId = (goalId: string): string => `tactic:${goalId}`;

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
// Three levels of verbosity, selected by the rail's hyp-mode button:
//
// - `full` — the goal's whole context.
// - `delta` (default) — the hypotheses the goal GAINED over the goal its own
//   producing tactic consumed (Paperproof's "introduced here" semantics; for a
//   root goal, its binders — gained from the theorem statement), PLUS any older
//   hypotheses the consuming tactic uses: usage is half the point of showing
//   the context, so a used hyp is shown even when it isn't new.
// - `used` — ONLY what the consuming tactic actually mentions. This is the
//   narrowest honest answer to "what does this step depend on", and it is the
//   one mode that can legitimately come back EMPTY: a leaf goal has no
//   consuming tactic, so nothing is used, and its box shows the `⊢ ` line
//   alone. That is the truth rather than a rendering gap.
//
// Context order is preserved in every mode.
export type HypMode = "used" | "delta" | "full";

function contextFor(
  goal: GoalInfo,
  consumedBy: ProofStep | undefined,
  producedBy: ProofStep | undefined,
  mode: HypMode,
): HypLine[] {
  const used = new Set(consumedBy?.tacticDependsOn ?? []);
  let shown = goal.hyps;
  if (mode === "used") {
    shown = goal.hyps.filter((h) => used.has(h.id));
  } else if (mode === "delta") {
    const inherited = new Set(producedBy?.goalBefore.hyps.map((h) => h.id));
    shown = goal.hyps.filter((h) => !inherited.has(h.id) || used.has(h.id));
  }
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
function rootIds(proof: Proof): string[] {
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

const posLE = (a: LspPos, b: LspPos) => cmpPos(a, b) <= 0;
/** HALF-OPEN containment, `[start, stop)`. See the widget's accent notes: step
ranges include trailing trivia, so consecutive tactics share a boundary
position and an inclusive end lets a neighbour match. */
export function positionContains(r: ProofStepPosition, p: LspPos): boolean {
  return posLE(r.start, p) && !posLE(r.stop, p);
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

// Display form of a raw comment: delimiters stripped, block-comment lines
// trimmed (they carry the source indentation), blank edge lines dropped.
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
  return lines.join("\n");
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
): { text: Map<string, string>; ranges: Map<string, ProofStepPosition[]> } {
  const out = new Map<string, string>();
  const ranges = new Map<string, ProofStepPosition[]>();
  if (comments.length === 0 || steps.length === 0) return { text: out, ranges };
  const byStart = [...steps].sort((a, b) =>
    cmpPos(a.position.start, b.position.start),
  );
  const first = byStart[0];
  let cur: SourceComment;
  const add = (nodeId: string, text: string) => {
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
  return { text: out, ranges };
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
   * Label each tactic with its goal's FULL local context instead of the delta
   * the goal gained (plus used) — contexts read additively down the tree.
   */
  hypMode?: HypMode;
}

export function proofToTree(
  proof: Proof,
  { hypMode = "delta" }: ProofToTreeOptions = {},
): TreeNode[] {
  const goals = goalIndex(proof);

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
  function addSpecFor(goalId: string, prod: ProofStep): AddSpec {
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
      return { kind: "seq", indent: base, after: anchor.position };
    return { kind: "bullet", indent: base, after: anchor.position };
  }

  const roots = rootIds(proof);

  // Source comments, attributed to node ids (see attributeComments). Root
  // narrative (before the first tactic / the docstring) keys on the root goal.
  const commentByNode = attributeComments(
    proof.comments ?? [],
    proof.steps,
    roots[0],
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
  ): void {
    if (emittedGoals.has(goalId)) return; // a proof tree is acyclic, but be safe
    emittedGoals.add(goalId);

    const goal = goals.get(goalId);
    const step = stepByGoal.get(goalId);
    const thisCase = caseName(goal);
    nodes.push({
      id: goalId,
      // The turnstile prefix marks goal boxes as GOALS at a glance (same
      // convention as the infoview's goal display). The widget's tagged
      // renderer strips it before matching the interactive print
      // (taggedRender), so keep the two in sync via TURNSTILE.
      label: TURNSTILE + (goal?.type ?? goalId),
      type: "goal",
      parents,
      // The producing tactic's source span, for the widget's node↔source link
      // (see types.ts `TreeNode.position`).
      position: producedBy?.position,
      // The local context rides the goal node itself and is drawn inside its
      // box, above the `⊢ ` line — the goal and the assumptions it holds under
      // are one thing to read, exactly as the infoview shows them.
      hyps: goal && contextFor(goal, step, producedBy, hypMode),
      comment: commentByNode.text.get(goalId),
      commentRanges: commentByNode.ranges.get(goalId),
      caseLabel: thisCase === parentCase ? undefined : thisCase,
      // (+) only on an unconsumed goal reached through `goalsAfter`. An
      // unconsumed SPAWNED goal is not the editing frontier: Paperproof emits
      // side goals that no tactic ever consumes because they are restatements
      // of goals already handled inside the branches (factorization.lean's
      // `induction … with` spawns two, from merged `intro p hpm` binders), and
      // offering to "solve" those put chips on a complete proof. Measured
      // across the incomplete-proof corpora, every genuine frontier goal
      // arrives via goalsAfter and none via spawnedGoals.
      addSpec:
        !step && producedBy && producedBy.goalsAfter.some((g) => g.id === goalId)
          ? addSpecFor(goalId, producedBy)
          : undefined,
    });

    if (!step) return; // leaf: this goal was closed by its tactic

    const tId = tacticId(goalId);
    nodes.push({
      id: tId,
      label: cleanLabel(step.tacticString, proof.comments ?? []),
      type: "tactic",
      parents: [{ id: goalId }],
      // Carry the tactic's source span so the widget can link this node back to
      // the `.lean` source (see types.ts `TreeNode.position`).
      position: step.position,
      comment: commentByNode.text.get(tId),
      commentRanges: commentByNode.ranges.get(tId),
    });

    for (const child of stepGoalsAfter(step)) {
      visitGoal(child.id, [{ id: tId }], step, thisCase);
    }
  }

  for (const rootId of roots) visitGoal(rootId, []);
  return nodes;
}
