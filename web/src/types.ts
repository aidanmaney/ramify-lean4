import type {
  CalcChain,
  Hole,
  CalcRelOption,
  ProofStepPosition,
} from "./paperproof";
import type { KeepSeg, Mark } from "./briefLabel";
// Type-only, and so erased: `elide.ts` imports the node types back from here.
import type { SeedOrigin } from "./elide";

export interface HypLine {
  cont?: boolean;
  indent?: number;
  text: string;
  used: boolean;

  sep?: boolean;

  /** The id of the TACTIC NODE that introduced this hypothesis (B2 provenance,
      resolved from the `hypOrigins` sidecar's position). Absent for the
      declaration's own binders and for any origin whose step is not drawn. */
  origin?: string;

  /** That tactic's head word, for the line's `<title>` — carried here so the
      renderer needs no second lookup. */
  originText?: string;

  /** The introducing step's line, 1-based as the editor counts. */
  originLine?: number;

  /** D5 — the hypothesis this line prints, as the ELABORATOR gave it: the
      name the author bound and the type it stands for. Carried structurally
      rather than parsed back out of `text`, because the rename move must read
      the WHOLE type from a line the reflow may have cut in half, and because
      `text` is a rendering (`h : T := v`) rather than a pair. Copied onto
      every wrapped piece, exactly as the provenance fields are. */
  hypName?: string;
  hypType?: string;
}

export interface DeleteSpec {
  kind: "tactic" | "goal";
  anchors: ProofStepPosition[];

  comments: ProofStepPosition[];
}

export interface TextSlot {
  at: number;
  len: number;
}

export interface AddResult {
  fill: ProofStepPosition | null;
  stages?: { lhs: ProofStepPosition; rhs: ProofStepPosition };
}

export interface AddSpec {
  kind:
    | "seq"
    | "bullet"
    | "case"
    | "hole"
    | "calc-link"
    | "calc-append"
    | "calc-first";

  hole?: Hole;

  chain?: CalcChain;
  rel?: string;

  rels?: CalcRelOption[];

  indent: number;
  producer: ProofStepPosition;
  after: ProofStepPosition;
  caseName?: string;
}

export interface ParentEdge {
  id: string;
}

export interface CombinedPart {
  label: string;
  position?: ProofStepPosition;
  elision?: { original: string; keep: KeepSeg[]; marks: Mark[] };
}

export interface LedgerRow {
  goalId?: string;

  text: string;

  hiddenLhs?: string;

  position?: ProofStepPosition;
}

export const isLedgerHead = (r: LedgerRow) => r.goalId === undefined;

export type NodeType = "goal" | "tactic";
export interface TreeNode {
  id: string;
  label: string;
  type: NodeType;
  parents: ParentEdge[];

  position?: ProofStepPosition;

  hyps?: HypLine[];

  comment?: string;

  /** The comment strip is drawn BELOW the box instead of above it. Set only by
   `applyNarrationLines`, only on a FOLDED goal (`folded.kind === "fold"`)
   whose strip is the GENERATED summary of what its `+N` hides: expanded, the
   first step's `∴` line sat under the goal (the tactic's strip), so the fold's
   summary stays under it too rather than jumping above the box (2026-09-22).
   An author's comment on a goal never wears it. Layout reads it through
   `bandTopH`/`inkExtent`/`commentStripTop`/`commentIndentOf` — one coding. */
  commentBelow?: boolean;

  addSpec?: AddSpec;

  addLink?: AddSpec;

  deleteSpec?: DeleteSpec;

  calcRels?: CalcRelOption[];

  goalElision?: { hidden: string };

  caseLabel?: string;

  commentRanges?: ProofStepPosition[];

  flags?: NodeFlags;

  flagRanges?: ProofStepPosition[];

  hypFlagged?: boolean;

  elision?: { original: string; keep: KeepSeg[]; marks: Mark[] };

  chain?: boolean;

  ledger?: LedgerRow[];

  /** Which LEDGER this is — the one flag anything downstream of the rows
   branches on. Set on BOTH the host tactic and the ledger node it opened, so
   a reader of either can tell a calc chain from a structured term without
   walking the tree. */
  ledgerKind?: "calc" | "ctor";

  hypGoalId?: string;

  hypsInheritedFrom?: string;

  rflResidue?: boolean;

  side?: boolean;

  spawned?: boolean;

  synthetic?: boolean;

  recovered?: "failed" | "skipped" | "term" | "subterm";

  /** B3 — the constants this step's tactic text names, in source order of
      first occurrence, deduped by name. Attributed INNERMOST server-side, so a
      lemma inside a nested `by` is on the inner step only and never repeated
      on its host. Tactic nodes only. */
  lemmas?: { name: string; doc?: string; kind?: string }[];

  /** D1 — this step is a `have`/`obtain` whose hypothesis the elaborator says
      is read by exactly `count` later steps, `users` being their node ids (the
      ones that are drawn). The input the inline move reads; a `count` of 0 is
      a hypothesis nothing uses. Tactic nodes only. */
  uses?: { name: string; count: number; users: string[] };

  /** D5 — EVERY name this step bound, with its own use list. `obtain ⟨k, hk⟩`
      and `intro m n` bind two, and `uses` can only be one of them; the rename
      move starts from a hypothesis LINE and needs that line's own entry.
      Same shape, same source (`haveUses`); `uses` is the last of these. */
  usesEach?: { name: string; count: number; users: string[] }[];

  /** B5 — what this branching tactic did, decoded from its SYNTAX KIND
      server-side. Tactic nodes only. An `arms` array that is EMPTY means the
      form was recognised and its arms were not (`match`, `split`, a nested
      `rcases` alternation): the client keeps its pre-B5 answer there. */
  branch?: import("./paperproof").BranchInfo;

  /** B5 — the arm of the branch above that produced THIS goal, resolved by
      `goalId` server-side. Goal nodes only; what makes the case badge read
      `succ k ih` rather than `succ`. */
  arm?: import("./paperproof").BranchArm;

  /** B5 — how a multi-goal tactic's child order and side-obligation marking
      were decided: `branch` (the sidecar answered), `regex` (the label-family
      fallback had to), `none` (nothing to decide). Probe-facing; the `counts`
      probe asserts no drawn tactic node still reads `regex`. */
  shapeSource?: "branch" | "regex" | "none";

  /** B4 — this step's automation trace, once the reader has asked for it and
      the RPC (or `ppharness --traces`) has answered. Tactic nodes only. */
  trace?: import("./paperproof").AutomationTrace;

  /** B4 — a LEAF of an open trace: one lemma the automation used, or the one
      line that says why there is no list. Minted onto the DRAWN tree by
      `applyTraces`, so elide.ts never sees it; positionless, so nothing offers
      to edit, reveal, delete or flag it. */
  traceLeaf?: { title: string; tactic: string; kind: string };

  // A FOLD leaves no node of its own: the GOAL is the reduced node, and this
  // is what it now stands for. The corner that carried `−` reads `+N` over
  // `tactics.length`, and the `<title>` lists them. `parts` is the marker's
  // own shape (label + position + brief elision per tactic), so anything that
  // wants the folded steps' source reads one field whichever cut hid them.
  folded?: {
    tactics: string[];
    parts: CombinedPart[];
    note?: string;
    /** Which goal-keyed cut hid them — `fold` (everything below) or `hop`
     (the step and its continuation goal, the next spine tactic re-parented
     onto this goal). */
    kind: "fold" | "hop";
    /** The SOURCE asked for this cut (a `.fold` / `.none` flag, or an `rw`'s
     `x = x` residue), not the reader. The caption and the corner `+N` then
     draw in the author's voice — `§` and italics, comment ink. */
    seeded?: true;
    seededBy?: SeedOrigin;
  };

  elidedCut?: {
    tactics: string[];
    combined?: boolean;

    parts?: CombinedPart[];

    ghost?: boolean;

    note?: string;

    /** As `folded.seeded`: this ghost stands for something the SOURCE put
     away. Its label already carries the `§` mark (`applyElisions` writes it
     in, so `ghostSize` measures it); this is what makes it italic and what
     the `<title>` names. */
    seeded?: true;
    seededBy?: SeedOrigin;
  };
}

export interface NodeFlags {
  fold?: boolean;

  elide?: boolean;

  /** An author's TOUR STOP (`.mark`, or `.mark <rank>`): `true` is "rank me by
   source position", a positive integer is an explicit rank. Read by `tour.ts`
   alone; it rides the comments sidecar on BOTH wires, since the flag grammar
   is parsed on the client out of the comment's own text. */
  mark?: number | true;

  targets?: string[];

  note?: string;
}

export interface PlacedNode {
  x: number;
  y: number;
  data: LayoutNode;
}

export interface PlacedLink {
  source: PlacedNode;
  target: PlacedNode;
  col?: boolean;

  lane?: number;
}

export interface WrappedLine {
  text: string;
  cont: boolean;

  indent: number;

  seg: number;
}

export interface LayoutNode extends TreeNode {
  hasChildren: boolean;
  lines: WrappedLine[];
  w: number;
  h: number;

  hypH: number;

  commentLines: WrappedLine[];
  commentBlockH: number;
  commentW: number;

  commentFloats?: boolean;

  caseH: number;
  caseW: number;

  chipH: number;


  commentMore?: { hidden: number; expanded: boolean; label: string };

  proseLabel?: boolean;
}
