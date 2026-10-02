// The small pickers drawn on the tree: the option row of a multi-way choice, the frontier chip on a
// pending goal, and the gallery pager.
import { useState } from "react";
import { getCodeFontFamily } from "./layout";
import type { CalcRelOption } from "./paperproof";
import { useTip } from "./tipController";
import {
  NODE_STYLES,
  CHROME_BG,
  CHROME_UNDERLAY,
  CHROME_BORDER,
  CHROME_INK,
  CHROME_RADIUS,
  TREE_INK_SW,
  FOCUS_INK,
} from "./theme";
import { CHIP_GAP, CHIP_H, CHIP_W_ADD, chipWidth } from "./chipMetrics";

const PICK_FONT_PX = 12;

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
  ) => {
    const width = chipWidth(glyph, PICK_FONT_PX);
    chips.push(
      <FrontierChip
        key={key}
        glyph={glyph}
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
  push("cancel", "×", "cancel", "var(--ptw-comment)", onCancel);
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
  title,
  x,
  width,
  color,
  fontSize = 12,

  fontFamily = "monospace",
  solid,
  onPick,
  keyboard,
}: {
  glyph: string;
  title: string;
  x: number;
  width: number;
  color: string;
  fontSize?: number;
  fontFamily?: string;

  solid?: boolean;
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
        height={CHIP_H}
        rx={CHROME_RADIUS}
        fill="transparent"
        stroke={focused ? FOCUS_INK : color}
        strokeWidth={focused ? 2 : TREE_INK_SW}
        strokeDasharray={solid ? undefined : "3 2"}
      />
      <text
        x={width / 2}
        y={CHIP_H / 2}
        textAnchor="middle"
        dy="0.32em"
        fontSize={fontSize}
        fontFamily={fontFamily}
        fill={color}
        style={{ userSelect: "none", letterSpacing: 0 }}
      >
        {glyph}
      </text>
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
  const arrow = (dx: number, glyph: string, at: number) => (
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
      <text
        x={PAGER_ARROW_W / 2}
        y={PAGER_H / 2}
        textAnchor="middle"
        dy="0.32em"
        fontSize={11}
        fontFamily="monospace"
        fill={CHROME_INK}
        style={{ userSelect: "none" }}
      >
        {glyph}
      </text>
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
      {arrow(-1, "‹", 0)}
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
      {arrow(1, "›", PAGER_ARROW_W + PAGER_LABEL_W)}
    </g>
  );
}
