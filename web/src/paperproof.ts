import type { Lint } from "./lints";

export interface Hypothesis {
  username: string;
  type: string;
  value: string | null;
  id: string;
  isProof: string;
}

export interface GoalInfo {
  username: string;
  type: string;
  hyps: Hypothesis[];
  id: string;
}

export interface ProofStepPosition {
  start: { line: number; character: number };
  stop: { line: number; character: number };
}

export interface ProofStep {
  tacticString: string;
  goalBefore: GoalInfo;
  goalsAfter: GoalInfo[];
  spawnedGoals: GoalInfo[];
  tacticDependsOn: string[];
  position: ProofStepPosition;
  theorems: unknown[];
}

export interface SourceComment {
  text: string;
  start: { line: number; character: number };
  stop: { line: number; character: number };
}

export interface Hole {
  goalId: string;

  start: { line: number; character: number };
  stop: { line: number; character: number };

  ownerStart: { line: number; character: number };

  first: boolean;

  inCalc: boolean;

  inBlock: boolean;

  dup?: boolean;
}

/** Where a hypothesis came from: the source position of the step that first
    put this fvarId into a context. Computed server-side (`ProofTree.hypOrigins`)
    and shipped on BOTH wires as plain, position-keyed data. A hypothesis with
    no entry is one of the declaration's own binders — "from the statement". */
export interface HypOrigin {
  id: string;
  username: string;
  start: { line: number; character: number };
}

/** D1 — how many steps use a `have`/`obtain`-introduced hypothesis, and which.
    `hypOrigins` (B2, which step first bound each fvarId) composed with
    Paperproof's own `tacticDependsOn` (which ids a step read), computed
    server-side (`ProofTree.haveUses`) and shipped on BOTH wires keyed on the
    introducing step's `position.start`.

    Restricted to the NAMED-BINDER forms (`ProofTree.ALLOWED_INTRODUCERS`):
    `have`/`obtain`, and since D3/D5 the intro family (`intro`, `intros`,
    `by_contra`, and so `by_contra!`). What a `by_cases`/`rintro`/`rcases`
    pattern binds is not one token a reader can point at, and nothing offers to
    inline what the intro family binds either — but the redirection analysis
    counts a `by_contra` binder's readers, and the rename move needs the use
    list of any hypothesis the author NAMED, whichever tactic named it.

    NOT a syntactic occurrence count. `omega` reads `hle1` from the context and
    never names it, so `hle1` has one user and no occurrence — which is why the
    inline move requires both (`rewrite.ts`). An EMPTY `users` is emitted and
    means a `have` nothing uses. */
export interface HaveUses {
  stepStart: { line: number; character: number };
  name: string;
  users: { line: number; character: number }[];
}

/** B3 — one constant a step's tactic text names, with the environment's own
    docstring. Computed server-side (`ProofTree.lemmaRefs`) from the SAME
    predicate that paints constants (`collectConstIdentTokens`), attributed to
    the INNERMOST harvested step whose position contains the identifier, so a
    lemma inside a nested `by` belongs to the inner step alone. Plain data on
    BOTH wires: the docstring is a `String`, not a `CodeWithInfos`. */
export interface LemmaRef {
  stepStart: { line: number; character: number };
  name: string;
  doc?: string;

  /** `theorem` | `def` | `axiom` | `inductive` | `ctor` | `rec` | `opaque` |
      `quot`, from the environment's `ConstantInfo`; `""` if unresolved. */
  kind?: string;
}

/** B4 — what an AUTOMATION step used, read back from core's own `?` form.
    The server rewrites `simp`/`simp_all`/`grind`/`aesop` to `simp?` &c, re-
    elaborates the declaration ONCE with every site rewritten, and parses the
    `Try this:` suggestions. Plain data, so it ships on the offline wire too
    (`ppharness --traces`, `gen.sh --traces`); in the widget it arrives from
    the `ProofTree.getAutomationTrace` RPC instead, on demand.

    `kind` is `lemmas` (a suggestion was read), `opaque` (the tactic has no `?`
    form in this toolchain — `omega`, `linarith`, `ring`, … — so there is no
    lemma list to show and saying so is the answer) or `failed` (the `?` form
    ran and said nothing). */
export interface AutomationTrace {
  stepStart: { line: number; character: number };
  /** The tactic's head word, as written. */
  tactic: string;
  kind: "lemmas" | "opaque" | "failed";
  /** The full `Try this` text, verbatim minus the header. */
  suggestion?: string;
  lemmas?: LemmaRef[];
}

/** B5 — one arm of a branching tactic: the case tag Lean names the goal by,
    the names the arm BINDS (`succ k ih` → `["k","ih"]`), the pattern text
    where the form has one, and the goal the arm produced. */
export interface BranchArm {
  tag: string;
  binders: string[];
  pattern?: string;
  goalId?: string;
}

/** B5 — what a branching tactic did, decoded from its SYNTAX KIND server-side
    (`ProofTree.branches`) and shipped on BOTH wires, keyed on the step's
    `position.start` like every other sidecar.

    `arms` EMPTY means the walk could not decode this form (`match`, `split`,
    a nested `rcases` alternation) and said so rather than guessing — the
    client keeps whatever it did before. `form` is still meaningful there. */
export interface BranchInfo {
  stepStart: { line: number; character: number };
  /** `induction` | `cases` | `rcases` | `obtain` | `rintro` | `by_cases` |
      `constructor` | `refine` | `match` | `split` | `interval_cases` |
      `fin_cases` | `rewrite`. */
  form: string;
  /** The discriminant's source text, where the form has one. */
  on?: string;
  /** The author wrote a `with | … =>` alternatives block. */
  withAlts?: boolean;
  arms: BranchArm[];
}

/** B1/Part E — one ROW of the LEDGER a structured term (`exact ⟨a, b, c⟩`)
 draws as: a component that has a goal to name, and where it was written. The
 row's TEXT is not on the wire — the client reads it off the goal, as a calc
 row's text is read off its link's goal. */
export interface TermLedgerRow {
  goalId: string;
  start: { line: number; character: number };
  stop: { line: number; character: number };
}

/** One host tactic's ledger, keyed by `position.start` like every other
 per-step sidecar. `kind` is the one thing the tree branches on; the CALC
 ledger threads its own rows out of `spineRelation` and needs no sidecar, so
 `"ctor"` is the only value this carries. */
export interface TermLedger {
  tacticStart: { line: number; character: number };
  kind: "ctor";
  rows: TermLedgerRow[];
}

export interface RecoveredStep {
  start: { line: number; character: number };
  kind: "failed" | "skipped" | "term" | "subterm";
}

export interface TacticSlot {
  start: { line: number; character: number };
  stop: { line: number; character: number };

  blockStart: { line: number; character: number };

  index: number;
  count: number;

  lineStart: boolean;

  tailIsTrivia: boolean;

  tailStop: { line: number; character: number };

  prevSameLine: boolean;
}

export interface CalcChain {
  tacticStart: { line: number; character: number };

  lastLink: { line: number; character: number };

  indent: number;

  broken: boolean;

  links: number;

  stop: { line: number; character: number };

  text: string;

  firstBare: boolean;
}

export interface CalcRelOption {
  rel: string;
  next: string;
  same: boolean;
}

export interface CalcRelations {
  goalId: string;

  rel: string;
  options: CalcRelOption[];
}

export interface Proof {
  steps: ProofStep[];
  allGoals: GoalInfo[];
  comments?: SourceComment[];
  holes?: Hole[];
  calcChains?: CalcChain[];
  calcRelations?: CalcRelations[];

  deleteSlots?: TacticSlot[];

  recovered?: RecoveredStep[];

  termLedgers?: TermLedger[];

  hypOrigins?: HypOrigin[];

  haveUses?: HaveUses[];

  lemmaRefs?: LemmaRef[];

  branches?: BranchInfo[];

  /** B4. Offline only — the widget's traces arrive from the RPC and are passed
      to the view as a SIBLING, so a reader of this field must take it as an
      argument with the field as fallback (the `deleteSlots` rule). */
  automationTraces?: AutomationTrace[];

  /** D4 — Mathlib's own style linters, as `ProofTree.Lint` puts them on the
      wire. Offline only (`ppharness --lint`): in the widget the lints do NOT
      ride `getProofTree` — they cost a re-elaboration, so they come from the
      lazy `ProofTree.lintDecl` and reach the view as a SIBLING. A reader of
      this field must therefore take it as an argument with the field as
      fallback (the `deleteSlots` rule). */
  lints?: Lint[];

  declRange?: ProofStepPosition;

  declHeader?: string;
  declHeaderTokens?: {
    start: { line: number; character: number };
    stop: { line: number; character: number };
    type: string;
  }[];
  declHeaderStart?: { line: number; character: number };
  /** Where the header's name ends and its binders begin — the start of the
      `declSig`/`optDeclSig` node, found by syntax KIND on the server. Absent
      where the signature is empty. The scope breadcrumb's keyword + name. */
  declHeaderNameStop?: { line: number; character: number };
  /** Where the header's type spec begins — the `:` of the `typeSpec`, by
      KIND; without one, the end of the binders or of the name. The resting
      header is the text up to here: keyword, name, binders. */
  declHeaderSigStop?: { line: number; character: number };

  proofId?: string;

  tacticNames?: string[];

  cfLine?: number;

  cfStubPos?: { line: number; character: number };

  openBlock?: OpenBlock;

  /** C1 — a LaTeX reading of each goal print, keyed by the goal id the tree
      already draws. ALWAYS EMPTY today: the producer (kmill/LeanTeX) does not
      build against Lean v4.32.2, so the seam ships and the reading option that
      would consume it is drawn disabled. See docs/design-record.md 2026-09-09. */
  latex?: LatexGoal[];
}

/** One goal's statement in LaTeX. Plain data, so it rides both wires. */
export interface LatexGoal {
  goalId: string;
  tex: string;
}

export interface OpenBlock {
  goal: GoalInfo;

  anchor: { line: number; character: number };

  indent: number;
}

export function stableProofOf(p: Proof): Proof {
  return {
    steps: p.steps,
    allGoals: p.allGoals,
    comments: p.comments,
    holes: p.holes,
    calcChains: p.calcChains,
    recovered: p.recovered,
    termLedgers: p.termLedgers,
    hypOrigins: p.hypOrigins,
    haveUses: p.haveUses,
    lemmaRefs: p.lemmaRefs,
    branches: p.branches,
    automationTraces: p.automationTraces,
    lints: p.lints,
    calcRelations: p.calcRelations,
    proofId: p.proofId,
    declRange: p.declRange,

    declHeader: p.declHeader,
    declHeaderTokens: p.declHeaderTokens,
    declHeaderStart: p.declHeaderStart,
    declHeaderNameStop: p.declHeaderNameStop,
    declHeaderSigStop: p.declHeaderSigStop,
    cfLine: p.cfLine,
    cfStubPos: p.cfStubPos,
    openBlock: p.openBlock,
    latex: p.latex,
  };
}

export interface ProofRecord {
  file: string;
  data: { index: number; proof: Proof };
}

export function stepGoalsAfter(step: ProofStep): GoalInfo[] {
  return [...step.goalsAfter, ...step.spawnedGoals];
}

export function parseNdjson(text: string): ProofRecord[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ProofRecord);
}
