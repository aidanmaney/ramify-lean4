// The node hover bar and its ⋯ move menu: the NodeAction/NodeMove shapes the tree hands it, the bar itself
// (a VS Code action bar of codicons) and the icon-explainer menu.
import { useState, useRef, useLayoutEffect } from "react";
import { type CodiconName } from "./codicon";
import { Codicon } from "./codiconView";
import { CodeText } from "./codeSpans";
import { plainTicks } from "./ticks";
import { pinLabel, type BarKind, type MoveId } from "./moves";
import { useTip } from "./tipController";
import {
  DANGER_FILL,
  CHROME_BG,
  CHROME_UNDERLAY,
  CHROME_BORDER,
  CHROME_INK,
  CHROME_BTN,
  CHROME_RADIUS,
  DIM_OPACITY,
  DISABLED_OPACITY,
  CHROME_TEXT_SM,
  MENU_SEL_BG,
  MENU_SEL_FG,
  WIDGET_SHADOW,
  Z,
} from "./theme";
import { MENU_PANEL } from "./barMetrics";
import {
  BAR_BTN,
  BAR_FRAME_INSET,
  BAR_GAP,
  BAR_ICON,
  BAR_OVERLAP,
  BAR_PAD,
} from "./hoverBarMetrics";

/** A hover bar is GLYPH BUTTONS with tooltips and nothing else (in-page tips,
not `<title>`s: tipController.ts says why). A dwell row
of words under them was tried and removed: the bar appears on hover over every
box in the tree, so a row that grows the card under the pointer moves the very
buttons it is naming, and it says on every node what the tooltip says on the
one you are aiming at. The vocabulary lives in `?` (the gesture panel), which
reads the same `nodeHints` list. */
interface NodeAction {
  /** Also the button's React key, so it must be unique within one bar; drawn
   as text only where there is no `codicon` (a busy `…`). */
  glyph: string;
  /** The move's codicon (moveSlots.ts `MOVE_LOOK`): what the bar draws, and
   what heads the move's row in the `⋯` menu. */
  codicon?: CodiconName;
  title: string;
  /** The button's own element rides along, for the one move that hangs a
   popover off it (`⋯`); every other move ignores it. */
  onClick: (el?: Element) => void;
  /** ⌥-click, where the button has a second reading (⚑: drop MY stop, or
   write the author's `.mark` into the source). Absent, ⌥ is a plain click. */
  onAlt?: () => void;
  onHover?: (on: boolean) => void;
  danger?: boolean;
  /** The move is armed / in progress (the delete's confirm is up): a
   `danger` move wears its red only while hovered or active. */
  active?: boolean;
  /** The slot is kept but the move cannot be used on this node: drawn at
   `DISABLED_OPACITY`, no click, no hover side effect — but still hoverable, so
   its tip can say why (pointer events, not `disabled`, which drops them). */
  disabled?: boolean;
}

/** One MOVE on a node: a hover-bar button and/or a row of the `⋯` menu. The
 menu reads `label` (the move in the reader's words, moves.ts) and `shortcut`
 (the gesture that reaches it without the menu or the bar — absent where the
 bar button, whose glyph heads the row, is the only way); the bar reads the
 `NodeAction` half. One object, so a row and its button run one closure.
 (The bar's list and the menu-only list are kept as two arrays and spread
 together, never FILTERED: the compiler lint reads a property read over an
 array of ref-touching closures as a ref read during render.) */
export interface NodeMove extends NodeAction {
  label: string;
  shortcut?: string;
  /** The move's id where it can sit on the bar (moves.ts `MOVE_IDS`) — the
   menu row then wears a PIN. Menu-only rows (edit, marks, rename, fold) have
   none. */
  id?: MoveId;
  /** The glyph is a frontier chip's WORD (`sorry`, `calc`, `step`): drawn
   small, as the chip draws it, where the icon box takes two characters. */
  chip?: boolean;
}

export function NodeActionBar({
  placement = "top-right",
  x,
  y,
  actions,
  boxTop,
  clearLeft,
}: {
  placement?: "top-right" | "right";
  x: number;
  y: number;
  actions: NodeAction[];
  /** The box's top edge (node-local), for a `right` bar that has to leave
   the right of the box: it goes up onto the top edge, as a goal's does. */
  boxTop?: number;
  /** Node-local x the bar may not start left of: a mark tab's right edge plus
   `BAR_GAP`, so a bar hung over a narrow box's top edge never touches the
   tab straddling its corner. Paint only. */
  clearLeft?: number;
}) {
  // ICONS ONLY (2026-09-22): every button is one `BAR_BTN` square. The
  // icon+word bar the experience preset once drew was "way too aggro" —
  // several times wider, it lay across the neighbouring boxes — and it is
  // gone, not dormant; the `⋯` menu is where a glyph is put into words.
  const w =
    actions.length * BAR_BTN + (actions.length - 1) * BAR_GAP + 2 * BAR_PAD;
  const h = BAR_BTN + 2 * BAR_PAD;
  const { ctl } = useTip();
  // Which button the pointer is on: PAINT only (a hover fill, a danger move's
  // red) — it moves nothing, and the bar is measured off `w`/`h` alone.
  const [hovered, setHovered] = useState<number | null>(null);
  const x0 = Math.max(placement === "right" ? x : x - w, clearLeft ?? -Infinity);
  const y0 =
    placement === "right"
      ? y - (BAR_BTN + 2 * BAR_PAD) / 2
      : y - h + BAR_OVERLAP;
  // KEPT INSIDE THE FRAME. The bar is an overlay (it reserves nothing), so a
  // node near the frame's edge hung it past the edge. The fix is PAINT: measured against the visible
  // scroll frame after mount and moved by a transform written straight onto
  // the element (the `TipLayer` idiom — no state, no relayout, and nothing a
  // re-render resets, since `transform` is never in the JSX). A bar hung to
  // the RIGHT of a tactic that would cross the frame's edge goes UP onto the
  // box's top edge first (the goal bar's place — beside the label it would
  // have covered the tactic's own text), then slides left as far as it must.
  // Re-run every render: the bar's width and place change with the node.
  const gRef = useRef<SVGGElement | null>(null);
  useLayoutEffect(() => {
    const g = gRef.current;
    if (!g) return;
    g.removeAttribute("transform");
    const frame = g.closest("[data-ptw-scroll]");
    if (!frame) return;
    const r = g.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    if (r.width === 0) return;
    const scale = r.width / w;
    const right = f.right - BAR_FRAME_INSET;
    const left = f.left + BAR_FRAME_INSET;
    let dx = 0;
    let dy = 0;
    if (r.right > right && placement === "right" && boxTop !== undefined) {
      // To the top-right corner, where a goal's bar sits.
      dx = -w * scale;
      dy = (boxTop - h + BAR_OVERLAP - y0) * scale;
    }
    if (r.right + dx > right) dx = right - r.right;
    if (r.left + dx < left) dx = left - r.left;
    if (dx !== 0 || dy !== 0)
      g.setAttribute("transform", `translate(${dx / scale},${dy / scale})`);
  });
  return (
    <g data-ptw-bar="" ref={gRef}>
      {/* VS CODE'S ACTION BAR (2026-10-04), the notebook cell toolbar's
          look: one widget-surface rectangle with the editor widget's border
          and shadow, `BAR_BTN` squares with no dividers, a codicon in each,
          the toolbar's hover wash on the square under the pointer and its
          active wash while pressed (theme.ts `[data-ptw-barbtn]:active`).
          `w`/`h` are what the frame clamp measures, and what paints. */}
      <rect
        x={x0}
        y={y0}
        width={w}
        height={h}
        rx={CHROME_RADIUS}
        fill={CHROME_UNDERLAY}
        style={{ filter: `drop-shadow(0 0 3px ${WIDGET_SHADOW})` }}
      />
      <rect
        x={x0}
        y={y0}
        width={w}
        height={h}
        rx={CHROME_RADIUS}
        fill={CHROME_BG}
        stroke={CHROME_BORDER}
      />
      {actions.map((a, i) => {
        const bx = x0 + BAR_PAD + i * (BAR_BTN + BAR_GAP);
        const cx = bx + BAR_BTN / 2;
        const cy = y0 + BAR_PAD + BAR_BTN / 2;
        const ink =
          a.danger && !a.disabled && (hovered === i || a.active)
            ? DANGER_FILL
            : CHROME_INK;
        return (
          <g
            key={a.glyph}
            data-ptw-barbtn=""
            onClick={(e) => {
              e.stopPropagation();
              if (a.disabled) return;
              if (a.onAlt && e.altKey) a.onAlt();
              else a.onClick(e.currentTarget);
            }}
            aria-label={plainTicks(a.title)}
            aria-disabled={a.disabled || undefined}
            onPointerEnter={(e) => {
              ctl.enter(e.currentTarget);
              setHovered(i);
              if (!a.disabled) a.onHover?.(true);
            }}
            onPointerLeave={(e) => {
              ctl.leave(e.currentTarget);
              setHovered((cur) => (cur === i ? null : cur));
              if (!a.disabled) a.onHover?.(false);
            }}
            opacity={a.disabled ? DISABLED_OPACITY : undefined}
            style={{ cursor: a.disabled ? "default" : "pointer" }}
          >
            <rect
              x={bx}
              y={y0 + BAR_PAD}
              width={BAR_BTN}
              height={BAR_BTN}
              rx={CHROME_RADIUS}
              fill={hovered === i && !a.disabled ? CHROME_BTN : "transparent"}
              pointerEvents="all"
            />
            {a.codicon ? (
              <Codicon
                name={a.codicon}
                size={BAR_ICON}
                x={cx - BAR_ICON / 2}
                y={cy - BAR_ICON / 2}
                color={ink}
                style={{ pointerEvents: "none" }}
              />
            ) : (
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={13}
                fontFamily="monospace"
                fill={ink}
                pointerEvents="none"
              >
                {a.glyph}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

// The keyed row is drawn by its LIT FILL alone (`idx`); DOM focus still
// follows it for assistive tech, but draws no ring — a ring on top of the fill
// said the same thing twice (2026-09-22).
const MENU_ROW_CSS =
  "[data-ptw-menu] .ptw-menu-row:focus," +
  "[data-ptw-menu] .ptw-menu-row:focus-visible{outline:none;box-shadow:none}";

/* THE `⋯` MENU (2026-09-22). Every move on one node, in words, with the
gesture that reaches it without the menu — the answer to "what can I do here?"
for a reader who does not yet read the bar's glyphs. HTML, hung in the frame
beside the tooltip layer and positioned like it (measured off the `⋯` button's
rect, written onto the element in a layout effect, clamped inside the frame):
an overlay, so opening it moves nothing. Rows are the node's own `NodeMove`s,
so a row runs exactly the closure its button or gesture runs. Arrow keys,
Home/End and Enter; Esc, a press outside, a scroll and a proof change close
it (the view's `nodeMenu` layer). Moves that are not available are simply
not in the list — a greyed row is a question the reader cannot act on. */
export function NodeMenu({
  at,
  moves,
  kind,
  pinned,
  onPin,
  onClose,
}: {
  at: { x: number; top: number; bottom: number };
  moves: NodeMove[];
  /** Which bar the pins write to: this node's kind. */
  kind: BarKind;
  pinned: readonly MoveId[];
  onPin: (id: MoveId) => void;
  onClose: () => void;
}) {
  const { ctl } = useTip();
  const boxRef = useRef<HTMLDivElement | null>(null);
  // The row the keys are on. In STATE, not only DOM focus: the row is drawn
  // lit from this, so the reader sees where Enter will land even where the
  // webview has not got system focus (a press elsewhere, the hidden pane).
  const [idx, setIdx] = useState(0);
  const pick = (m: NodeMove) => {
    onClose();
    m.onClick();
  };
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const root = box.offsetParent as HTMLElement | null;
    if (!root) return;
    const bw = box.offsetWidth;
    const bh = box.offsetHeight;
    let left = at.x;
    left = Math.max(4, Math.min(left, root.clientWidth - bw - 4));
    let top = at.bottom + 4;
    if (top + bh > root.clientHeight - 4) top = at.top - 4 - bh;
    top = Math.max(4, Math.min(top, root.clientHeight - bh - 4));
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
    box.style.visibility = "visible";
  }, [at]);
  // DOM focus follows the lit row (the accessible half of `idx`).
  useLayoutEffect(() => {
    const rows =
      boxRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]");
    rows?.[idx]?.focus({ preventScroll: true });
  }, [idx]);
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const n = moves.length;
    if (n === 0) return;
    // A pin is its own button beside its row: Right reaches the lit row's pin
    // (where it has one), Left comes back, and on a pin Enter/Space are the
    // pin's own click — never the row's move.
    const onPinBtn = !!(e.target as HTMLElement).closest("[data-ptw-pin]");
    const rows =
      boxRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]");
    if (e.key === "ArrowRight" && !onPinBtn) {
      const pin = rows?.[idx]?.parentElement?.querySelector<HTMLElement>(
        "[data-ptw-pin]",
      );
      if (pin) {
        e.preventDefault();
        pin.focus({ preventScroll: true });
      }
      return;
    }
    if (e.key === "ArrowLeft" && onPinBtn) {
      e.preventDefault();
      rows?.[idx]?.focus({ preventScroll: true });
      return;
    }
    if (onPinBtn && (e.key === "Enter" || e.key === " ")) return;
    const go = (f: (cur: number) => number) => {
      e.preventDefault();
      setIdx((cur) => (f(cur) + n) % n);
    };
    if (e.key === "ArrowDown") go((c) => c + 1);
    else if (e.key === "ArrowUp") go((c) => c - 1);
    else if (e.key === "Home") go(() => 0);
    else if (e.key === "End") go(() => n - 1);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (moves[idx]) pick(moves[idx]);
    } else if (e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  };
  return (
    <div
      ref={boxRef}
      role="menu"
      aria-label="Moves on this node"
      data-ptw-menu=""
      onKeyDown={onKey}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        ...MENU_PANEL,
        position: "absolute",
        visibility: "hidden",
        zIndex: Z.nodeMenu,
        minWidth: 200,
        maxWidth: "min(360px, 90%)",
        whiteSpace: "nowrap",
      }}
    >
      {/* Focus draws no outline of its own; the lit row (`idx`) is what
          says where the keys are. */}
      <style>{MENU_ROW_CSS}</style>
      {moves.map((m, i) => {
        const pinOn = !!m.id && pinned.includes(m.id);
        const pinSaid = pinLabel(pinOn, kind);
        return (
          <div
            key={`${m.glyph}:${m.label}:${i}`}
            onMouseEnter={() => setIdx(i)}
            style={{
              display: "flex",
              alignItems: "center",
              borderRadius: CHROME_RADIUS,
              // The keyed row in the editor menus' selection pair.
              background: i === idx ? MENU_SEL_BG : "transparent",
              color: i === idx ? MENU_SEL_FG : undefined,
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => pick(m)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flex: 1,
                minWidth: 0,
                boxSizing: "border-box",
                padding: "3px 6px",
                border: "none",
                borderRadius: CHROME_RADIUS,
                background: "transparent",
                color: m.danger ? DANGER_FILL : "inherit",
                font: "inherit",
                textAlign: "left",
                cursor: "pointer",
              }}
              className="ptw-menu-row"
            >
              {/* THE ICON — the bar's own codicon, so the menu is where the
                  bar's icons are put into words; a chip's WORD where the
                  move is a frontier chip. */}
              <span
                aria-hidden
                style={{
                  width: 16,
                  flex: "none",
                  display: "inline-flex",
                  justifyContent: "center",
                  fontFamily: "monospace",
                  fontSize: 13,
                }}
              >
                {m.codicon ? (
                  <Codicon
                    name={m.codicon}
                    color={m.danger ? DANGER_FILL : "currentColor"}
                  />
                ) : m.glyph.length <= 2 ? (
                  m.glyph
                ) : m.chip ? (
                  <span style={{ fontSize: 8, letterSpacing: -0.3 }}>
                    {m.glyph}
                  </span>
                ) : null}
              </span>
              {/* The label WRAPS (never ellipsised: the explanation is the
                  point of the menu); where the gesture will not fit beside it,
                  it drops under the label. */}
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexWrap: "wrap",
                  columnGap: 8,
                  rowGap: 0,
                  alignItems: "baseline",
                }}
              >
                <span
                  style={{
                    flex: "1 1 auto",
                    minWidth: 0,
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                  }}
                >
                  <CodeText text={m.label} />
                </span>
                {m.shortcut && (
                  <span
                    style={{
                      flex: "0 0 auto",
                      marginLeft: "auto",
                      whiteSpace: "nowrap",
                      opacity: DIM_OPACITY,
                      fontSize: CHROME_TEXT_SM,
                    }}
                  >
                    <CodeText text={m.shortcut} />
                  </span>
                )}
              </span>
            </button>
            {/* THE PIN: whether this move sits on the bar for this node's
                kind. Its own button (a button inside the row's would not be
                one), so a pin leaves the menu open and runs nothing else. */}
            {m.id ? (
              <button
                type="button"
                data-ptw-pin=""
                aria-label={pinSaid}
                aria-pressed={pinOn}
                onClick={() => onPin(m.id!)}
                onPointerEnter={(e) => ctl.enter(e.currentTarget)}
                onPointerLeave={(e) => ctl.leave(e.currentTarget)}
                style={{
                  flex: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 20,
                  height: 20,
                  marginRight: 2,
                  padding: 0,
                  border: "none",
                  borderRadius: CHROME_RADIUS,
                  background: "transparent",
                  color: "inherit",
                  opacity: pinOn ? 0.9 : i === idx ? 0.5 : 0.22,
                  cursor: "pointer",
                }}
              >
                <Codicon name={pinOn ? "pinned" : "pin"} />
              </button>
            ) : (
              <span aria-hidden style={{ flex: "none", width: 22 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
