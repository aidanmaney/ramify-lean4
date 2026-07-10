import type { ReactNode } from "react";
import {
  InteractiveCode,
  type CodeWithInfos,
  type InteractiveGoal,
  type InteractiveHypothesisBundle,
} from "@leanprover/infoview";
import type { GoalInfo, Proof } from "./paperproof";
import { stepGoalsAfter } from "./paperproof";
import { hypLine, newHypList } from "./proofToTree";
import { flattenTaggedText, lineOffsets, sliceTaggedText } from "./taggedText";

// Widget-land composition of the tagged (hover-interactive) rendering: builds
// the `renderTaggedGoal` / `renderTaggedHyps` hooks ProofTreeView accepts,
// backed by the `taggedGoals` the RPC returned alongside the proof. This is
// the only renderer-side module that may import infoview APIs — ProofTreeView
// stays source-agnostic and receives finished ReactNodes.
//
// Everything here is guarded by *text equality*: a tagged line is only used
// when its stripped text is exactly the plain string the layout measured, so
// the interactive overlay can never disagree with the box geometry. Any
// mismatch (a goal printed under a different mctx, a missing bundle, …) falls
// back to the plain SVG text for that node/line — tooltips degrade, layout
// never breaks.

/** One `taggedGoals` entry as `ProofTree.getProofTree` returns it. */
export interface TaggedGoalEntry {
  goalId: string; // mvarId string — same key as GoalInfo.id
  goal: InteractiveGoal;
}

// InteractiveCode wraps its output in <span class="font-code">, which the
// infoview styles with the EDITOR's font (family/size/line-height, plus the
// theme foreground color). Our boxes are measured in the tree's own font
// (layout.ts), so left alone the rich text renders bigger than the box it was
// measured for (and near-invisible on our light boxes in dark themes). Undo it
// inside our labels only: every tagged line is wrapped in .ptw-tagged, and
// this injected rule makes .font-code inherit the surrounding div's font —
// the very one the canvas measurer used. The hover type-popups are safe: the
// infoview portals them to document.body, outside any .ptw-tagged ancestor,
// so they keep their native editor styling.
const TAGGED_STYLE_ID = "proof-tree-tagged-style";
function ensureTaggedStyle() {
  if (document.getElementById(TAGGED_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = TAGGED_STYLE_ID;
  style.textContent =
    ".ptw-tagged .font-code { font: inherit; line-height: inherit; color: inherit; }";
  document.head.appendChild(style);
}

export interface TaggedRenderers {
  renderTaggedGoal: (goalId: string, lines: string[]) => ReactNode[] | null;
  renderTaggedHyps: (
    goalId: string,
    lines: string[],
  ) => (ReactNode | null)[] | null;
}

// The tagged text, cut at the layout's exact line breaks (see taggedText.ts) —
// one non-wrapping InteractiveCode per line, or null if the flat text doesn't
// reconstruct the lines (then the plain render stands).
function taggedLines(fmt: CodeWithInfos, lines: string[]): ReactNode[] | null {
  const offsets = lineOffsets(flattenTaggedText(fmt), lines);
  if (!offsets) return null;
  return offsets.map(([start, end], i) => {
    const part = sliceTaggedText(fmt, start, end);
    return part ? (
      <span key={i} className="ptw-tagged">
        <InteractiveCode fmt={part} />
      </span>
    ) : (
      lines[i]
    );
  });
}

export function makeTaggedRenderers(
  proof: Proof,
  entries: TaggedGoalEntry[],
): TaggedRenderers {
  ensureTaggedStyle();
  const tagged = new Map(entries.map((e) => [e.goalId, e.goal]));

  // For hyp deltas we need each produced goal and the goal its tactic consumed
  // (the same pairing proofToTree turns into an edge).
  const goalById = new Map<string, GoalInfo>();
  const parentOf = new Map<string, GoalInfo>();
  for (const step of proof.steps) {
    for (const g of stepGoalsAfter(step)) {
      goalById.set(g.id, g);
      parentOf.set(g.id, step.goalBefore);
    }
  }

  const renderTaggedGoal = (goalId: string, lines: string[]) => {
    const ig = tagged.get(goalId);
    return ig ? taggedLines(ig.type, lines) : null;
  };

  // Edge labels aren't pixel-wrapped (the box grows to the widest line), so
  // each line is rebuilt as plain `name : ` + interactive type — no slicing.
  const renderTaggedHyps = (goalId: string, lines: string[]) => {
    const ig = tagged.get(goalId);
    const child = goalById.get(goalId);
    const parent = parentOf.get(goalId);
    if (!ig || !child || !parent) return null;

    const delta = newHypList(parent, child);
    // The lines must be exactly this delta's lines, or the label predates a
    // wire-format drift we shouldn't paper over — fall back wholesale.
    if (
      delta.length !== lines.length ||
      delta.some((h, i) => hypLine(h) !== lines[i])
    )
      return null;

    const byFvar = new Map<string, InteractiveHypothesisBundle>();
    for (const b of ig.hyps) for (const fv of b.fvarIds ?? []) byFvar.set(fv, b);

    return delta.map((h) => {
      const b = byFvar.get(h.id);
      if (!b || flattenTaggedText(b.type) !== h.type) return null;
      if (h.value != null && (!b.val || flattenTaggedText(b.val) !== h.value))
        return null;
      return (
        <span className="ptw-tagged">
          {h.username} : <InteractiveCode fmt={b.type} />
          {h.value != null && b.val ? (
            <>
              {" := "}
              <InteractiveCode fmt={b.val} />
            </>
          ) : null}
        </span>
      );
    });
  };

  return { renderTaggedGoal, renderTaggedHyps };
}
