import type { Proof, ProofStepPosition } from "./paperproof";
import { posLE, tacticNodeAt } from "./proofToTree";
import { SEVERITY_LINT, lintName, type Lint } from "./lints";

type LspPos = ProofStepPosition["start"];

export interface RawDiagnostic {
  range: ProofStepPosition;

  fullRange?: ProofStepPosition;

  severity?: number;
  message: string;
  isSilent?: boolean;

  leanTags?: number[];

  code?: string;
}

export const TAG_UNSOLVED_GOALS = 1;
export const TAG_GOALS_ACCOMPLISHED = 2;
export const SEVERITY_ERROR = 1;
export const SEVERITY_WARNING = 2;

export interface TreeDiagnostic {
  key: string;
  /** 1 error, 2 warning — LSP's own numbering — and 3 a LINT (D4). A lint is
   neither: the proof is correct and a style rule is speaking, so it rides the
   SAME pipeline at LSP's `hint` severity and the ribbon draws a third ink for
   it. `worst` takes the minimum, so an error on the same node still wins. */
  severity: 1 | 2 | 3;
  range: ProofStepPosition;
  fullRange: ProofStepPosition;
  message: string;
  code?: string;

  unsolved?: boolean;

  /** D4 — the linter option's own name (`linter.style.cdot`), on lints alone.
   What the `<title>` and the bar's pager name the rule by. */
  linter?: string;

  /** The node this diagnostic belongs to, where the CALLER already knows it.
   Lints are attributed by `lintNodeAt` (which has a fallback a position scan
   over tactic nodes does not — a `skip` is harvested as no step at all), so
   they arrive with their node decided and `diagnosticNodeAt` honours it. */
  nodeId?: string;
}

export interface DiagnosticCounts {
  kept: number;
  goalsAccomplished: number;
  silent: number;
  info: number;
  outsideProof: number;
}

export function proofSpan(proof: Proof): ProofStepPosition | null {
  if (proof.declRange) return proof.declRange;
  let start: LspPos | null = null;
  let stop: LspPos | null = null;
  for (const s of proof.steps) {
    if (!s.position) continue;
    if (!start || !posLE(start, s.position.start)) start = s.position.start;
    if (!stop || posLE(stop, s.position.stop)) stop = s.position.stop;
  }
  return start && stop ? { start, stop } : null;
}

const clampSeverity = (s: number | undefined): 1 | 2 | null =>
  s === SEVERITY_ERROR ? 1 : s === SEVERITY_WARNING ? 2 : null;

/** D4 — the linter messages as DIAGNOSTICS, so there is ONE painting path.
 They are merged into the kept list before `attachDiagnostics`, and from there
 the node ribbon, the `worst` map, the `<title>` and the bar's pager get them
 for nothing. `byNode` is `lintsByNode`'s answer, computed by the caller (it
 needs the drawn tree, which this module does not have).

 Nothing here reserves space: a lint is a third INK, not a fourth thing. */
export function lintDiagnostics(
  lints: readonly Lint[],
  byNode: ReadonlyMap<string, Lint[]>,
): TreeDiagnostic[] {
  const nodeOf = new Map<Lint, string>();
  for (const [id, ls] of byNode) for (const l of ls) nodeOf.set(l, id);
  return lints.map((l) => ({
    key: `${SEVERITY_LINT}:${l.start.line}:${l.start.character}:${l.linter}`,
    severity: SEVERITY_LINT as 3,
    range: { start: l.start, stop: l.stop },
    fullRange: { start: l.start, stop: l.stop },
    // The linter's own words lead (the pager shows the first line); its
    // name — what `set_option` would turn off — closes that line.
    message: withLinterName(l.message, lintName(l)),
    linter: l.linter,
    nodeId: nodeOf.get(l),
  }));
}

export function filterDiagnostics(
  raw: RawDiagnostic[],
  span: ProofStepPosition | null,
): { kept: TreeDiagnostic[]; counts: DiagnosticCounts } {
  const counts: DiagnosticCounts = {
    kept: 0,
    goalsAccomplished: 0,
    silent: 0,
    info: 0,
    outsideProof: 0,
  };
  const kept: TreeDiagnostic[] = [];
  for (const d of raw) {
    if (d.isSilent) {
      counts.silent++;
      continue;
    }
    const tags = d.leanTags ?? [];
    if (tags.includes(TAG_GOALS_ACCOMPLISHED)) {
      counts.goalsAccomplished++;
      continue;
    }
    const severity = clampSeverity(d.severity);
    if (severity === null) {
      counts.info++;
      continue;
    }
    const fullRange = d.fullRange ?? d.range;

    if (
      span &&
      !(posLE(span.start, fullRange.stop) && posLE(fullRange.start, span.stop))
    ) {
      counts.outsideProof++;
      continue;
    }
    counts.kept++;
    kept.push({
      key: `${severity}:${d.range.start.line}:${d.range.start.character}:${d.message.length}:${d.message.slice(0, 32)}`,
      severity,
      range: d.range,
      fullRange,
      message: d.message,
      code: d.code,
      unsolved: tags.includes(TAG_UNSOLVED_GOALS),
    });
  }
  return { kept, counts };
}

export function diagnosticNodeAt(
  targets: { id: string; position: ProofStepPosition }[],
  d: TreeDiagnostic,
  pendingGoals: { id: string; position: ProofStepPosition }[] = [],
): string | null {
  // A lint arrives with its owner already decided (`lintNodeAt`); nothing
  // here can improve on it, and the position scan below would lose the
  // fallback that puts "`skip` does nothing" somewhere at all.
  if (d.nodeId) return d.nodeId;
  const hit = tacticNodeAt(targets, d.range.start);
  if (hit) return hit;

  let best: { id: string; position: ProofStepPosition } | null = null;
  for (const g of pendingGoals) {
    if (g.position.start.line > d.range.start.line) continue;
    if (!best || best.position.start.line <= g.position.start.line) best = g;
  }
  return best?.id ?? null;
}

export interface GoalContext {
  open: { id: string; position: ProofStepPosition }[];
  chipped: Set<string>;
}

export interface AttachedDiagnostics {
  byNode: Map<string, TreeDiagnostic[]>;

  worst: Map<string, 1 | 2 | 3>;

  ordered: { diag: TreeDiagnostic; nodeId: string | null }[];

  unattached: TreeDiagnostic[];
}

const bySource = (a: TreeDiagnostic, b: TreeDiagnostic) =>
  a.range.start.line - b.range.start.line ||
  a.range.start.character - b.range.start.character;

export function attachDiagnostics(
  targets: { id: string; position: ProofStepPosition }[],
  kept: TreeDiagnostic[],
  goals: GoalContext = { open: [], chipped: new Set() },

  unsolved: (d: TreeDiagnostic) => boolean = (d) => !!d.unsolved,
): AttachedDiagnostics & { chipCovered: number } {
  const anyChip = goals.chipped.size > 0;
  let chipCovered = 0;
  const ordered = [...kept]
    .sort(bySource)
    .filter((diag) => {
      if (!unsolved(diag) || !anyChip) return true;
      chipCovered++;
      return false;
    })
    .map((diag) => ({ diag, nodeId: diagnosticNodeAt(targets, diag, goals.open) }));
  const byNode = new Map<string, TreeDiagnostic[]>();
  const worst = new Map<string, 1 | 2 | 3>();
  for (const { diag, nodeId } of ordered) {
    if (!nodeId) continue;
    const list = byNode.get(nodeId);
    if (list) list.push(diag);
    else byNode.set(nodeId, [diag]);
    const w = worst.get(nodeId);
    if (w === undefined || diag.severity < w) worst.set(nodeId, diag.severity);
  }

  for (const list of byNode.values())
    list.sort((a, b) => a.severity - b.severity || bySource(a, b));
  return {
    byNode,
    worst,
    ordered,
    unattached: ordered.filter((o) => !o.nodeId).map((o) => o.diag),
    chipCovered,
  };
}

/** `msg` with ` (linter: name)` at the end of its FIRST line. */
function withLinterName(msg: string, name: string): string {
  const nl = msg.indexOf("\n");
  return nl < 0
    ? `${msg} (linter: ${name})`
    : `${msg.slice(0, nl)} (linter: ${name})${msg.slice(nl)}`;
}
