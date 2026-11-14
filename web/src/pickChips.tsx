// The small pickers drawn on the tree: the option row of a multi-way choice, the frontier chip on a
// pending goal, and the gallery pager.
import { useState } from "react";
import { getCodeFontFamily } from "./layout";
import type { CalcRelOption } from "./paperproof";
import { useTip } from "./tipController";
import {
  NODE_STYLES,
  NODE_TEXT,
  CHROME_BG,
  CHROME_UNDERLAY,
  CHROME_BORDER,
  CHROME_INK,
  CHROME_RADIUS,
  TREE_INK_SW,
  TREE_INK_SW_BOLD,
  FOCUS_INK,
} from "./theme";
import { CHIP_GAP, CHIP_H, CHIP_W_ADD, FRONTIER_H, SLOT_PAD_X, chipWidth } from "./chipMetrics";
import { Codicon } from "./codiconView";
import { type CodiconName } from "./codicon";
import { ICON } from "./icons";

/** A chip's or the pager's codicon, px square (inside the chip's measured
 width: the glyph string still sizes the chip, so nothing measured moves). */
const CHIP_ICON = 12;

const PICK_FONT_PX = 12;

/** The next-step slot's corner: a tactic box's own (`nodeRx`). */
const SLOT_RX = 4;

const PAGER_H = 15;

const PAGER_ARROW_W = 15;

const PAGER_LABEL_W = 30;

const PAGER_W = 2 * PAGER_ARROW_W + PAGER_LABEL_W;

export function PickerRow({
  options,
  onPick,
  onCancel,
}: {
  options: CalcRelOption[];
  onPick: (o: CalcRelOption) => void;
  onCancel: () => void;
}) {
  const fam = getCodeFontFamily();
  let cursor = -CHIP_W_ADD / 2;
  const chips: React.ReactNode[] = [];
  const push = (
    key: string,
    glyph: string,
    title: string,
    color: string,
    onClick: () => void,
    icon?: CodiconName,
  ) => {
    const width = chipWidth(glyph, PICK_FONT_PX);
    chips.push(
      <FrontierChip
        key={key}
        glyph={glyph}
        icon={icon}
        title={title}
        x={cursor}
        width={width}
        fontSize={PICK_FONT_PX}
        fontFamily={fam}
        color={color}
        onPick={onClick}
      />,
    );
    cursor += width + CHIP_GAP;
  };
  push("cancel", "×", "cancel", "var(--ptw-comment)", onCancel, ICON["chip.cancel"]);
  for (const o of options) {
    push(
      o.rel,
      o.rel,
      o.same
        ? `one \`${o.rel}\` link — the relation this goal is in, so the chain can end on it`
        : `one \`${o.rel}\` link — a step on the way; the chain stays open and \`step\` continues it`,
      NODE_STYLES.tactic.stroke,
      () => onPick(o),
    );
  }
  return <>{chips}</>;
}

export function FrontierChip({
  glyph,
  icon,
  title,
  x,
  width,
  color,
  fontSize = 12,

  fontFamily = "monospace",
  solid,
  height = CHIP_H,
  onPick,
  keyboard,
}: {
  glyph: string;
  /** Draw this codicon instead of the glyph's text (a cancel chip's close):
   the glyph still names the chip and still sizes it. */
  icon?: CodiconName;
  title: string;
  x: number;
  width: number;
  color: string;
  fontSize?: number;
  fontFamily?: string;

  solid?: boolean;
  /** The chip's height: a pill's `CHIP_H`, or the frontier lane's own. */
  height?: number;
  onPick: () => void;
  /** A chip the KEYBOARD reaches (the selection pill's): a tab stop with
   `role="button"`, Enter/Space run `keyboard.activate` (default `onPick`),
   ← / → move between the chips beside it, and a ring in `--ptw-focus` says
   where it is. Plain frontier chips stay mouse-only — their moves are rows
   in the goal's `⋯` menu. */
  keyboard?: { activate?: () => void };
}) {
  const tip = useTip();
  const [focused, setFocused] = useState(false);
  return (
    <g
      transform={`translate(${x},0)`}
      style={{ cursor: "pointer", outline: "none" }}
      {...tip.props(title)}
      {...(keyboard
        ? {
            role: "button",
            tabIndex: 0,
            "data-ptw-chip-kb": "",
            "aria-label": title,
            onFocus: () => setFocused(true),
            onBlur: () => setFocused(false),
            onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                (keyboard.activate ?? onPick)();
              } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                const all = [
                  ...(e.currentTarget.parentElement?.querySelectorAll<SVGGElement>(
                    "[data-ptw-chip-kb]",
                  ) ?? []),
                ];
                const at = all.indexOf(e.currentTarget);
                const next = all[at + (e.key === "ArrowRight" ? 1 : -1)];
                if (next) {
                  e.preventDefault();
                  e.stopPropagation();
                  next.focus({ preventScroll: true });
                }
              }
            },
          }
        : {})}

      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={CHROME_RADIUS}
        fill="transparent"
        stroke={focused ? FOCUS_INK : color}
        strokeWidth={focused ? 2 : TREE_INK_SW}
        strokeDasharray={solid ? undefined : "3 2"}
      />
      {icon ? (
        <Codicon
          name={icon}
          size={CHIP_ICON}
          x={width / 2 - CHIP_ICON / 2}
          y={height / 2 - CHIP_ICON / 2}
          color={color}
        />
      ) : (
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          dy="0.32em"
          fontSize={fontSize}
          fontFamily={fontFamily}
          fill={color}
          style={{ userSelect: "none", letterSpacing: 0 }}
        >
          {glyph}
        </text>
      )}
    </g>
  );
}

/** THE NEXT-STEP SLOT under an open goal: an EMPTY TACTIC BOX, in the
 tactic's own fill, outline and corner, holding nothing but a blinking caret
 where a tactic's text would start — an input at rest, hung from the goal by
 a stub of trunk the view draws. No word and no glyph: the box is the place
 and the caret says it takes typing. It answers the pointer by paint alone
 (the outline firms up); a click opens the editor in its place. The `?_`
 hole keeps `FrontierChip`: what is typed there replaces the hole where it
 sits, not a step below. Measured by `slotWidth` × `FRONTIER_H`; the blink
 is theme.ts's `[data-ptw-caret]` (still under reduced motion). */
const CARET_W = 1.5;
const CARET_H = 13;

export function NextStepSlot({
  title,
  x,
  width,
  onPick,
}: {
  title: string;
  x: number;
  width: number;
  onPick: () => void;
}) {
  const tip = useTip();
  const [over, setOver] = useState(false);
  const ink = NODE_STYLES.tactic.stroke;
  return (
    <g
      transform={`translate(${x},0)`}
      style={{ cursor: "pointer" }}
      data-ptw-slot=""
      {...tip.props(title)}
      onPointerEnter={() => setOver(true)}
      onPointerLeave={() => setOver(false)}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <rect
        x={0}
        y={0}
        width={width}
        height={FRONTIER_H}
        rx={SLOT_RX}
        fill={NODE_STYLES.tactic.fill}
        stroke={ink}
        strokeWidth={over ? TREE_INK_SW_BOLD : TREE_INK_SW}
      />
      <rect
        data-ptw-caret=""
        x={SLOT_PAD_X}
        y={(FRONTIER_H - CARET_H) / 2}
        width={CARET_W}
        height={CARET_H}
        fill={NODE_TEXT}
        style={{ pointerEvents: "none" }}
      />
    </g>
  );
}

export function GalleryPager({
  index,
  count,
  label,
  x,
  onStep,
}: {
  index: number;
  count: number;
  label: string;
  x: number;
  onStep: (delta: number) => void;
}) {
  const arrow = (dx: number, icon: CodiconName, at: number) => (
    <g
      transform={`translate(${at},0)`}
      style={{ cursor: "pointer" }}

      onClick={(e) => {
        e.stopPropagation();
        onStep(dx);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <rect
        x={0}
        y={0}
        width={PAGER_ARROW_W}
        height={PAGER_H}
        fill="transparent"
      />
      <Codicon
        name={icon}
        size={CHIP_ICON}
        x={PAGER_ARROW_W / 2 - CHIP_ICON / 2}
        y={PAGER_H / 2 - CHIP_ICON / 2}
        color={CHROME_INK}
      />
    </g>
  );
  return (
    <g transform={`translate(${x},0)`}>
      <title>{`Branch ${index + 1} of ${count}${label ? `: ${label}` : ""} — ‹ › to cycle`}</title>
      <rect
        x={0}
        y={0}
        width={PAGER_W}
        height={PAGER_H}
        rx={CHROME_RADIUS}
        fill={CHROME_UNDERLAY}
      />
      <rect
        x={0}
        y={0}
        width={PAGER_W}
        height={PAGER_H}
        rx={CHROME_RADIUS}
        fill={CHROME_BG}
        stroke={CHROME_BORDER}
        strokeWidth={1}
      />
      {arrow(-1, ICON["gallery.prev"], 0)}
      <text
        x={PAGER_ARROW_W + PAGER_LABEL_W / 2}
        y={PAGER_H / 2}
        textAnchor="middle"
        dy="0.32em"
        fontSize={10}
        fontFamily="monospace"
        fill={CHROME_INK}
        style={{ userSelect: "none" }}
      >
        {`${index + 1}/${count}`}
      </text>
      {arrow(1, ICON["gallery.next"], PAGER_ARROW_W + PAGER_LABEL_W)}
    </g>
  );
}
