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

export interface RecoveredStep {
  start: { line: number; character: number };
  kind: "failed" | "skipped" | "term";
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

  declRange?: ProofStepPosition;

  declHeader?: string;
  declHeaderTokens?: {
    start: { line: number; character: number };
    stop: { line: number; character: number };
    type: string;
  }[];
  declHeaderStart?: { line: number; character: number };

  proofId?: string;

  tacticNames?: string[];

  cfLine?: number;

  cfStubPos?: { line: number; character: number };

  openBlock?: OpenBlock;
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
    calcRelations: p.calcRelations,
    proofId: p.proofId,
    declRange: p.declRange,

    declHeader: p.declHeader,
    declHeaderTokens: p.declHeaderTokens,
    declHeaderStart: p.declHeaderStart,
    cfLine: p.cfLine,
    cfStubPos: p.cfStubPos,
    openBlock: p.openBlock,
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
