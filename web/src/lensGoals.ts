import type { Proof, ProofStepPosition } from "./paperproof";

import { TURNSTILE } from "./proofToTree";

export interface GoalAnnotation {
  line: number;
  text: string;
}

const MAX_LEN = 72;

const CLOSED = "∎";

const flatten = (s: string) => s.replace(/\s+/g, " ").trim();

const clip = (s: string) =>
  s.length <= MAX_LEN ? s : s.slice(0, MAX_LEN - 1) + "…";

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
