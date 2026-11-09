// D1 — THE PROPOSAL PILL: the armed delete's pill, in the same place and the
// same idiom, because a rewrite is the same kind of promise (see the comment
// at its call site in ProofTreeView.tsx). Split out of ProofTreeView.tsx.
import { ICON } from "./icons";
import { plainTicks } from "./ticks";
import {
  TRUNK_INSET,
  CHIP_TOP_GAP,
  bandTopH,
  getCodeFontFamily,
} from "./layout";
import { pillMove } from "./moves";
import { CMD } from "./gestures";
import { SEQ_STROKE, CHROME_BORDER, CHROME_RADIUS, CHIP_SHADOW } from "./theme";
import {
  CHIP_FONT_PX,
  CHIP_GAP,
  CHIP_H,
  CHIP_W_ADD,
  chipWidth,
} from "./chipMetrics";
import { FrontierChip } from "./pickChips";
import type { ProofTreeViewProps } from "./proofTreeViewProps";
import { clipLine, CARD_PAD } from "./viewConstants";
import type { Rewrite } from "./rewrite";
import type { PlacedNode } from "./types";

/** The proposal being shown: one at a time, on the node it was asked from. */
export interface Proposal {
  id: string;
  kind: Rewrite["kind"];
  rewrite: Rewrite;
  phase: "checking" | "ok" | "bad";
  message?: string;
  delta?: number;
  /** D2a — a collapse has no title until the server names the candidate
   that closed the run, so the pill's line is set when the answer lands. */
  title?: string;
  /** D6 — where an AGENT chose this move, the one line it gave for why.
   It rides the `<title>`, not the pill's own label: the label says what
   will be written and whether the elaborator agreed, which is the promise,
   and the reason is the thing you hover to read. */
  why?: string;
}

export function ProposalPill({
  proposal,
  placed,
  drawnParentIds,
  onApplyRewrite,
  setProposal,
}: {
  proposal: Proposal;
  placed: ReadonlyMap<string, PlacedNode>;
  drawnParentIds: ReadonlySet<string>;
  onApplyRewrite: ProofTreeViewProps["onApplyRewrite"];
  setProposal: (v: Proposal | null) => void;
}) {
  const an = placed.get(proposal.id);
  if (!an) return null;
  const { w, h } = an.data;
  const boxTop = (bandTopH(an.data) - h) / 2;
  const d = proposal.delta ?? 0;
  const shorter =
    d > 0
      ? `${d} step${d === 1 ? "" : "s"} fewer`
      : d < 0
        ? `${-d} step${d === -1 ? "" : "s"} more`
        : "same length";
  // A COLLAPSE has no title until the server names the tactic
  // that closed the run, so while it is out the pill says what
  // is being asked (`proposal.title`) and the answer replaces
  // it with the move itself.
  const said = pillMove(
    proposal.kind,
    proposal.title ?? proposal.rewrite.title,
  );
  // An EXPAND is not about length — it writes out what the
  // automation used and the proof is the same proof — so it
  // does not carry the step-count clause the other three do.
  // …and neither is a LINT FIX: `write \`·\` for the focusing
  // dot → same length` was true and beside the point. Only the
  // moves that claim to shorten the proof carry the clause.
  // …and neither is a COLLAPSE (2026-09-22): "Replace these 4
  // steps with `omega`" already says how many go.
  const lenClause =
    proposal.kind === "expand" ||
    proposal.kind === "rename" ||
    proposal.kind === "lint" ||
    proposal.kind === "namecases" ||
    proposal.kind === "collapse"
      ? ""
      : ` → ${shorter}`;
  // The pill is code font throughout, so a code span cannot be
  // told apart by face: its ticks are stripped (ticks.ts),
  // and `chipWidth` measures exactly the string painted.
  const label = plainTicks(
    proposal.phase === "checking"
      ? `${said} — checking with Lean…`
      : proposal.phase === "ok"
        ? `${pillMove(proposal.kind, proposal.rewrite.title)}${lenClause} · ✓ elaborates`
        : `✗ ${clipLine(proposal.message ?? "it does not check", 72)}`,
  );
  const live = proposal.phase === "ok";
  const wide = chipWidth(label, CHIP_FONT_PX);
  const x0 = -CHIP_W_ADD / 2;
  const rowW = wide + CHIP_GAP + CHIP_W_ADD;
  const shift = drawnParentIds.has(proposal.id)
    ? CHIP_W_ADD / 2 + 6 + CARD_PAD
    : 0;
  return (
    <g
      transform={`translate(${
        an.x - w / 2 + TRUNK_INSET + shift
      }, ${an.y + boxTop + h + CHIP_TOP_GAP})`}
    >
      <rect
        x={x0 - CARD_PAD}
        y={-CARD_PAD}
        width={rowW + 2 * CARD_PAD}
        height={CHIP_H + 2 * CARD_PAD}
        rx={CHROME_RADIUS}
        fill="var(--ptw-surface)"
        stroke={CHROME_BORDER}
        strokeWidth={1}
        style={{
          filter: CHIP_SHADOW,
        }}
      />
      <FrontierChip
        glyph={label}
        title={
          (proposal.why ? `Proposed: ${proposal.why}\n` : "") +
          (live
            ? `Write it — ${CMD}Z in the editor undoes it`
            : proposal.phase === "checking"
              ? "Lean is re-checking the proof with this change in place"
              : "Lean rejected this change; nothing was written")
        }
        x={x0}
        width={wide}
        color={live ? SEQ_STROKE : "var(--ptw-comment)"}
        fontSize={CHIP_FONT_PX}
        solid={live}
        fontFamily={getCodeFontFamily()}
        onPick={() => {
          if (!live) return;
          onApplyRewrite?.(
            proposal.rewrite.edits,
            proposal.rewrite.kind === "extract"
              ? proposal.rewrite.renameAt
              : undefined,
          );
          setProposal(null);
        }}
      />
      <FrontierChip
        glyph="×"
        icon={ICON["chip.cancel"]}
        title="Cancel"
        x={x0 + wide + CHIP_GAP}
        width={CHIP_W_ADD}
        color="var(--ptw-comment)"
        fontFamily={getCodeFontFamily()}
        onPick={() => setProposal(null)}
      />
    </g>
  );
}
