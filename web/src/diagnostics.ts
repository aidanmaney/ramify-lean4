// Lean's diagnostics, mapped onto tree nodes.
//
// The tree could read, navigate, edit, insert, complete, delete and undo before
// this, and still showed NOTHING about what failed — the one thing you most
// want while writing a proof was the one thing you had to leave the tree for.
//
// Pure and in its own module for the same reason as calcEdit.ts / deleteEdit.ts
// / lensGoals.ts: a probe drives the REAL filter and the REAL mapping over the
// real corpus offline, which is how the resolver below was chosen rather than
// assumed.
//
// The SOURCE of these is the `textDocument/publishDiagnostics` payload the
// widget already receives and used to discard (it declared the params as
// `{uri}` and read nothing else). Not the `getInteractiveDiagnostics` RPC:
// measured against the v4.27.0 source, the file worker publishes
// `(sticky ++ doc.diagnosticsRef).map (·.toDiagnostic)` and the RPC serves that
// SAME ref, with `toDiagnostic` differing only in `message := prettyTt message`
// — every other field byte-identical. So the RPC buys the message's TAGS and
// nothing structural, at the cost of a round trip per elaboration burst plus
// the session-bound-ref lifetime dance. It is worth having eventually (measured:
// every one of 10 fixture messages carries 3-26 `expr` embeds once the client
// asks for widgets) but it is a separate, later, on-demand fetch — not the
// thing the ribbon is drawn from.

import type { Proof, ProofStepPosition } from "./paperproof";
import { posLE, tacticNodeAt } from "./proofToTree";

type LspPos = ProofStepPosition["start"];

/** Mirrors `Lean.Lsp.DiagnosticWith` as the notification carries it, minus the
fields nothing here reads. The wire is a cross-language contract (the
`paperproof.ts` precedent), so these names track Lean's, except that `end`
becomes `stop` — our position space is `ProofStepPosition` throughout, and the
one normalization happens where the payload is received. */
export interface RawDiagnostic {
  range: ProofStepPosition;
  /** The UNtruncated span. `range.end` is truncated by the server to
  `{line + 1, column 0}` for any multi-line message (a VS Code squiggly-size
  workaround), which is a point inside no tactic at all — measured on real
  output: a two-tactic block's `unsolved goals` has `range.end` sitting inside
  the NEXT tactic while `fullRange` runs to the true end. Nothing here uses
  either END, but `fullRange` is what an enclosing-block question would want. */
  fullRange?: ProofStepPosition;
  /** LSP: 1 error, 2 warning, 3 information, 4 hint. */
  severity?: number;
  message: string;
  isSilent?: boolean;
  /** Mirrors `Lean.Lsp.LeanDiagnosticTag`: 1 unsolvedGoals, 2
  goalsAccomplished. Mutually exclusive in `msgToInteractiveDiagnostic`. */
  leanTags?: number[];
  /** e.g. `lean.unknownIdentifier`. */
  code?: string;
}

export const TAG_UNSOLVED_GOALS = 1;
export const TAG_GOALS_ACCOMPLISHED = 2;
export const SEVERITY_ERROR = 1;
export const SEVERITY_WARNING = 2;

/** One diagnostic the tree will draw. */
export interface TreeDiagnostic {
  /** Identity for React keys and for "which one is the pager on". Built from
  the position and the message rather than an index, so it survives the list
  being rebuilt by a re-elaboration that changed nothing. */
  key: string;
  severity: 1 | 2;
  range: ProofStepPosition;
  fullRange: ProofStepPosition;
  message: string;
  code?: string;
  /** Carries the `unsolvedGoals` tag through the filter. `attachDiagnostics`
  needs it (that tag is dropped only where a frontier chip is already saying
  the same thing) and `TreeDiagnostic` is what crosses into the view, so the
  alternative was a second predicate threaded beside every list. The `unsolved`
  PARAMETER survives it — a probe overrides the rule without rebuilding the
  list. */
  unsolved?: boolean;
}

/** What was dropped, and why. Counted rather than silent: a filter that
quietly discards is indistinguishable from a mapping that quietly fails, and
the pill shows these so the two can be told apart. */
export interface DiagnosticCounts {
  kept: number;
  goalsAccomplished: number;
  silent: number;
  info: number;
  outsideProof: number;
}

/** The span a diagnostic must fall inside to be this proof's.
 *
 * The DECLARATION's range when the wire ships one, falling back to the extent
 * of the steps. The difference is load-bearing rather than cosmetic: measured,
 * `declaration uses 'sorry'` is reported on the declaration NAME, which is
 * above every tactic — so a steps-derived span drops the one warning that most
 * needs showing. Both wires compute the declaration range already (it is what
 * bounds the comment lex), so this costs a field, not a walk. */
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

/**
 * Which diagnostics the tree draws.
 *
 * `isSilent` and `GoalsAccomplished` are not failures at all — the latter is
 * the success marker. Information/Hint is `Try this:` and `#check` output.
 *
 * `UnsolvedGoals` is NOT dropped here, and that was settled by measurement
 * rather than assumed. The plan was to drop it as redundant with the frontier
 * chips — but a chip is only offered for a goal reached through `goalsAfter`
 * (unconsumed SPAWNED goals restate goals handled inside branches, so chipping
 * them would put insertions in the wrong place), and an unfinished `induction`
 * BRANCH arrives spawned. Measured on the fixtures: `err_unsolved` leaves the
 * `zero` case open, the tree draws 0 chips for it, and dropping the tag lost
 * the only signal that anything was wrong. It is dropped in `attachDiagnostics`
 * instead, and only where a chip really is already saying it.
 *
 * `span` is the proof's own extent; a file holds other declarations, whose
 * diagnostics are not this tree's business. A null span (an empty proof) keeps
 * everything, which is deliberate — a proof whose FIRST tactic fails harvests
 * no steps at all (measured: 2 of 9 broken fixtures), so that is exactly when
 * the diagnostics are the only thing left to show.
 */
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
    // Containment against the FULL range: a diagnostic can start before the
    // first tactic (`declaration uses 'sorry'` sits on the declaration name)
    // and still belong to this proof.
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

/**
 * The node a diagnostic belongs to.
 *
 * `range.start`, and that is forced rather than chosen: in
 * `msgToInteractiveDiagnostic` both `range.start` and `fullRange.start` are the
 * same `low`, while `range.end` is the synthetic truncation point above. It is
 * also exactly the convention `tacticNodeAt` was measured at — the companion
 * leaves the editor cursor at a range's start for the same reason.
 *
 * One line, so the resolver can be swapped and re-measured in one place.
 */
export function diagnosticNodeAt(
  targets: { id: string; position: ProofStepPosition }[],
  d: TreeDiagnostic,
  pendingGoals: { id: string; position: ProofStepPosition }[] = [],
): string | null {
  const hit = tacticNodeAt(targets, d.range.start);
  if (hit) return hit;
  // No tactic owns it. **A FAILING TACTIC HAS NO NODE** — it records no
  // `TacticInfo`, so Paperproof harvests no step and the tree draws no box.
  // Measured on the fixtures: exactly the tactics whose errors most need
  // showing (`exact Nat.zero`, `exact h`) are the ones absent from the tree,
  // so resolving by tactic alone silently drops them.
  //
  // The fallback is the PENDING GOAL nearest above — the frontier goal the
  // failing tactic was attacking. It is drawn, and it already carries the
  // `+` / `sorry` / `calc` chips, so the error lands on the box that both
  // says what you were trying to prove and offers the ways to act on it.
  // Blaming the previous TACTIC was the alternative and is wrong: it worked.
  // Nearest at or above by LINE, not by full position. A goal's position is
  // its PRODUCING tactic's range, which routinely sits to the RIGHT of the
  // diagnostic on the same line — measured: `unsolved goals` on `| zero =>`
  // reports at column 9 while the goal `skip` left open is positioned at the
  // `skip` itself, so a strict position test found nothing at all. The question
  // being asked is "which open goal is this about", and the line is the honest
  // resolution for it.
  let best: { id: string; position: ProofStepPosition } | null = null;
  for (const g of pendingGoals) {
    if (g.position.start.line > d.range.start.line) continue;
    if (!best || best.position.start.line <= g.position.start.line) best = g;
  }
  return best?.id ?? null;
}

/** The goal nodes a diagnostic may fall back onto.
 *
 * `open` is every goal no tactic consumes — the honest "not closed yet" set,
 * and what a failing tactic's error attaches to. `chipped` is the subset the
 * tree already draws a frontier chip on (`goalsAfter` only, the `addSpecFor`
 * rule): narrower, because a chip inserts TEXT and an unconsumed spawned goal
 * is the wrong place to insert. The two differ exactly where an `induction`
 * branch is unfinished, which is why both are needed. */
export interface GoalContext {
  open: { id: string; position: ProofStepPosition }[];
  chipped: Set<string>;
}

export interface AttachedDiagnostics {
  /** Per node, sorted (severity, then source order). */
  byNode: Map<string, TreeDiagnostic[]>;
  /** Per node, the severity its ink should take. */
  worst: Map<string, 1 | 2>;
  /** Every kept diagnostic in SOURCE order — the pager's list. `nodeId` is
  null for one that belongs to the proof but to no drawn tactic. */
  ordered: { diag: TreeDiagnostic; nodeId: string | null }[];
  /** The `nodeId === null` subset, for convenience. */
  unattached: TreeDiagnostic[];
}

const bySource = (a: TreeDiagnostic, b: TreeDiagnostic) =>
  a.range.start.line - b.range.start.line ||
  a.range.start.character - b.range.start.character;

export function attachDiagnostics(
  targets: { id: string; position: ProofStepPosition }[],
  kept: TreeDiagnostic[],
  goals: GoalContext = { open: [], chipped: new Set() },
  /** Which of `kept` carry the unsolvedGoals tag. Defaults to the flag the
  filter already stamped; overridable so a probe can measure the rule's effect
  without rebuilding the list. */
  unsolved: (d: TreeDiagnostic) => boolean = (d) => !!d.unsolved,
): AttachedDiagnostics & { chipCovered: number } {
  // "You have not finished" is worth saying only where the tree is not already
  // saying it, and that turns out to be a PROOF-level question, not a per-node
  // one. Measured: `unsolved goals` is reported at the enclosing block — the
  // theorem's own line for a linear proof — so it sits ABOVE every node and
  // never resolves to one, whatever the resolver does. What distinguishes the
  // two real cases is whether the tree drew a frontier chip at all:
  //
  //   * a linear proof that stops short puts its open goal in `goalsAfter`, so
  //     a chip IS drawn, offering `+` / `sorry` / `calc` — the diagnostic adds
  //     nothing but a permanent error count on every proof in progress;
  //   * an unfinished `induction` BRANCH is not drawn at all (measured: for
  //     `err_unsolved` the whole `zero` case — its goal and its tactic — is
  //     absent from the harvest), so the diagnostic is the only trace of it,
  //     and its message names the case and the goal.
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
  const worst = new Map<string, 1 | 2>();
  for (const { diag, nodeId } of ordered) {
    if (!nodeId) continue;
    const list = byNode.get(nodeId);
    if (list) list.push(diag);
    else byNode.set(nodeId, [diag]);
    const w = worst.get(nodeId);
    if (w === undefined || diag.severity < w) worst.set(nodeId, diag.severity);
  }
  // Errors before warnings within a node, source order within a severity.
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
