// The ARMED DELETE's pill: what the trash will write (`delete N lines` /
// `replace … with sorry`) and a cancel, under the armed node. Nothing is
// written until the reader clicks it. Split out of ProofTreeView.tsx.
import { ICON } from "./icons";
import {
  TRUNK_INSET,
  CHIP_TOP_GAP,
  bandTopH,
  getCodeFontFamily,
} from "./layout";
import type { DeleteSpec } from "./types";
import type { DeleteExtent } from "./deleteEdit";
import { CMD } from "./gestures";
import {
  DANGER_FILL,
  CHROME_BORDER,
  CHROME_RADIUS,
  CHIP_SHADOW,
} from "./theme";
import {
  CHIP_FONT_PX,
  CHIP_GAP,
  CHIP_H,
  CHIP_W_ADD,
  chipWidth,
} from "./chipMetrics";
import { FrontierChip } from "./pickChips";
import { CARD_PAD } from "./viewConstants";
import type { PlacedNode } from "./types";

export function ArmPill({
  arming,
  armExtent,
  placed,
  drawnParentIds,
  commitDelete,
  setArming,
}: {
  arming: { id: string; spec: DeleteSpec };
  armExtent: DeleteExtent | null;
  placed: ReadonlyMap<string, PlacedNode>;
  drawnParentIds: ReadonlySet<string>;
  commitDelete: (id: string, spec: DeleteSpec) => void;
  setArming: (v: null) => void;
}) {
  const an = placed.get(arming.id);
  const ext = armExtent;
  if (!an || !ext) return null;
  const { w, h } = an.data;

  const boxTop = (bandTopH(an.data) - h) / 2;

  const label = ext.empties
    ? `replace ${ext.lines} with sorry`
    : `delete ${ext.lines} line${ext.lines === 1 ? "" : "s"}`;
  const wide = chipWidth(label, CHIP_FONT_PX);
  const x0 = -CHIP_W_ADD / 2;
  const rowW = wide + CHIP_GAP + CHIP_W_ADD;

  const shift = drawnParentIds.has(arming.id)
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
        title={`Confirm — ${CMD}Z in the editor undoes it`}
        x={x0}
        width={wide}
        color={DANGER_FILL}
        fontSize={CHIP_FONT_PX}
        solid
        fontFamily={getCodeFontFamily()}
        onPick={() => commitDelete(arming.id, arming.spec)}
      />
      <FrontierChip
        glyph="×"
        icon={ICON["chip.cancel"]}
        title="Cancel"
        x={x0 + wide + CHIP_GAP}
        width={CHIP_W_ADD}
        color="var(--ptw-comment)"
        fontFamily={getCodeFontFamily()}
        onPick={() => setArming(null)}
      />
    </g>
  );
}
