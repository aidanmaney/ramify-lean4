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

  hypGoalId?: string;

  hypsInheritedFrom?: string;

  rflResidue?: boolean;

  side?: boolean;

  spawned?: boolean;

  synthetic?: boolean;

  recovered?: "failed" | "skipped" | "term";

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
