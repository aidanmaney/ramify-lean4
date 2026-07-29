// Inline goal state for the lens: one line of text per source line, showing
// what the goal IS after the tactic on that line. The companion paints each as
// an `after` decoration in the lens editor, so a proof read there carries its
// intermediate states the way an Alectryon page does — without the tree, and
// without leaving the buffer.
//
// Pure and in its own module for the same reason as calcEdit.ts and
// deleteEdit.ts: a probe can run the REAL text the lens will show against the
// real corpus, which is the only way to know the lines line up and the strings
// are worth reading.

import type { Proof, ProofStepPosition } from "./paperproof";
// The one spelling of the goal prefix; the tree's own labels use it too.
import { TURNSTILE } from "./proofToTree";

export interface GoalAnnotation {
  line: number;
  text: string;
}

/** Longest annotation we will draw. An `after` decoration does not wrap and
does not scroll, so an over-long one just runs off the pane; better to cut it
and let the tree (or a hover) carry the full type. */
const MAX_LEN = 72;

/** The QED mark, for a tactic that left nothing to prove. Deliberately not
"no goals": on a line that closes a branch the useful signal is that it closed,
and a symbol reads as punctuation rather than as another goal. */
const CLOSED = "∎";

const flatten = (s: string) => s.replace(/\s+/g, " ").trim();

const clip = (s: string) =>
  s.length <= MAX_LEN ? s : s.slice(0, MAX_LEN - 1) + "…";

/**
 * One annotation per source LINE that a tactic ends on.
 *
 * `tightStop` resolves a step's start to the tight end the server computed
 * (`TacticEdit`), because a Paperproof range includes trailing trivia and runs
 * into the next tactic — annotating at its raw stop line would put the text a
 * line below where it belongs, and for a structured tactic several lines below.
 *
 * Prefers `goalsAfter`, falling back to `spawnedGoals` only when there are no
 * continuation goals at all. A `have … := by` has both — one continuation, one
 * side goal — and the continuation is what follows on from that line, so
 * `stepGoalsAfter` (which merges them) would label the `have` with a goal
 * belonging to the block underneath it. But a `induction … with` has ONLY
 * spawned goals, and calling that `∎` was measured to be plainly wrong: the
 * tactic branched, it did not close anything. So `∎` means both lists are
 * empty, which is the only state that really is "nothing left to prove".
 *
 * Several steps can share a line — a split `rw [a, b]`, a `tac <;> tac` — so
 * the LAST in source order wins: the state after the whole line is the only one
 * a single annotation can honestly report.
 */
export function goalAnnotations(
  proof: Proof,
  tightStop: (start: ProofStepPosition["start"]) =>
    | ProofStepPosition["stop"]
    | undefined,
): GoalAnnotation[] {
  const byLine = new Map<number, { at: ProofStepPosition["start"]; text: string }>();
  for (const step of proof.steps) {
    const stop = tightStop(step.position.start) ?? step.position.stop;
    const after =
      step.goalsAfter.length > 0 ? step.goalsAfter : step.spawnedGoals;
    const head = after[0]?.type;
    const text =
      after.length === 0
        ? CLOSED
        : clip(
            `${TURNSTILE}${flatten(head ?? "")}` +
              (after.length > 1 ? `   +${after.length - 1} more` : ""),
          );
    if (text === TURNSTILE) continue;
    const prev = byLine.get(stop.line);
    // "Last in source order" is decided on the step's START: two steps ending
    // on the same line are ordered by where they begin.
    if (
      !prev ||
      prev.at.line < step.position.start.line ||
      (prev.at.line === step.position.start.line &&
        prev.at.character <= step.position.start.character)
    )
      byLine.set(stop.line, { at: step.position.start, text });
  }
  return [...byLine.entries()]
    .map(([line, v]) => ({ line, text: v.text }))
    .sort((a, b) => a.line - b.line);
}
