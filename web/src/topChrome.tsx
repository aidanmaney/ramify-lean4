// The floating chrome over the tree: the hop chip and link marks, the mark tabs (with the ⌥-held
// store that turns a temporary tab into an ×), the top-centre toast, and the zoom rail.
import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { useClassic } from "./appearance";
import {
  getCodeFontFamily,
  BADGE_FONT_PX,
  BADGE_H,
  HOP_CAPTION_GAP,
  HOP_CHIP_H,
  HOP_CHIP_W,
  tourTabWidth,
} from "./layout";
import { type SeedOrigin, hopCaption, seedTitle } from "./elide";
import { CHORD_FOLD_ALL, CHORD_UNFOLD_ALL, CMD } from "./gestures";
import { useTip } from "./tipController";
import {
  SEQ_STROKE,
  POPUP_CHROME,
  FLOATER_CHROME,
  CHROME_BORDER,
  CHROME_FONT,
  CHROME_RADIUS,
  CHROME_TEXT,
  Z,
  DIM_OPACITY,
  TREE_INK_SW_BOLD,
  NOTIF_BG,
  NOTIF_BORDER,
  NOTIF_FG,
  chromeSurface,
  CHROME_SURFACE,
  WIDGET_SHADOW,
} from "./theme";
import { Codicon } from "./codiconView";
import {
  BARE_BTN,
  LANE_BTN_H,
  LANE_INSET,
  RAIL_BTN,
  RAIL_GROUP_GAP,
  RAIL_GROUP_PAD,
  RAIL_INSET,
  RAIL_LANE_GAP,
} from "./barMetrics";

/** Width of an ANCHORED toast (a mark jump's `n/N · caption`): fixed, so the
 counter keeps its x across a run of marks; capped by the column's 80%. */
const TOAST_ANCHORED_W = 420;

/** CLASSIC: where the caption started beside the axis break (the lane plus
 8), and the section sign a seeded caption led with (`SEED_MARK`, removed from
 the label 2026-10-04 and kept here as paint only). */
const HOP_CAPTION_GAP_CLASSIC = 8;
const SEED_MARK = "\u00a7 ";

/** The HOP CHIP on a link leaving a HOPPED goal (2026-10-04; it replaced a
 graph-style axis break of two slants that no reader recognised): the editor's
 FOLDED-LINE placeholder — a `⋯` codicon in `--ptw-fold-ph` on a `--ptw-bg`
 underlay that cuts the line (`HOP_CHIP_W` × `HOP_CHIP_H`, layout.ts), with
 line left on both sides of it — saying "steps were skipped between these
 two" without standing in the tree as a node. Paint only, like `LinkMark`;
 `linkSpans` needs no mirror. It is not gated on `linkMarks` — it is the one
 mark that carries state.

 Beside it, to the right, the CAPTION: the head word of each hidden tactic
 (or the `.none` note in italics), so the run reads `⋯ have · intro` as the
 editor's folded line does. It is clickable exactly like the goal's `+N` —
 the same restore, so the reader can undo the hop from either end of it. */
export function HopChip({
  x,
  y,
  stroke,
  folded,
  onRestore,
}: {
  x: number;
  y: number;
  /** The link's own stroke: the CLASSIC break's slants are drawn in it. */
  stroke: string;
  folded: {
    tactics: string[];
    note?: string;
    seeded?: true;
    seededBy?: SeedOrigin;
  };
  onRestore: () => void;
}) {
  const caption = hopCaption(folded);
  // A SEEDED break says WHOSE hand it is before it says how much went — the
  // caption is already italic, and this is where that is spelled out.
  const tip = folded.seeded
    ? `${seedTitle(folded.seededBy, folded.tactics.length)}\n\n${folded.tactics.join("\n")}`
    : `${folded.tactics.length} ${
        folded.tactics.length === 1 ? "step" : "steps"
      } skipped — click to restore\n\n${folded.tactics.join("\n")}`;
  const classic = useClassic();
  if (classic)
    // CLASSIC (appearance.ts): the AXIS BREAK it replaced — two slanted
    // strokes in the link's ink, the line JOINED into the centre of the upper
    // one and out of the centre of the lower, the gap masked in the page
    // colour; the caption `HOP_CAPTION_GAP_CLASSIC` right of the lane, a
    // seeded one led by `§ `. Paint only: nothing reserves room for either.
    return (
      <g
        style={{ cursor: "pointer" }}
        onClick={(e) => {
          e.stopPropagation();
          onRestore();
        }}
      >
        <title>{tip}</title>
        <line x1={x} y1={y - 3} x2={x} y2={y + 3} stroke="var(--ptw-bg)" strokeWidth={4} />
        <line
          x1={x - 4.5}
          y1={y - 1}
          x2={x + 4.5}
          y2={y - 5}
          stroke={stroke}
          strokeWidth={TREE_INK_SW_BOLD}
          strokeLinecap="round"
        />
        <line
          x1={x - 4.5}
          y1={y + 5}
          x2={x + 4.5}
          y2={y + 1}
          stroke={stroke}
          strokeWidth={TREE_INK_SW_BOLD}
          strokeLinecap="round"
        />
        {caption && (
          <text
            x={x + HOP_CAPTION_GAP_CLASSIC}
            y={y + BADGE_FONT_PX / 2 - 1}
            fontSize={BADGE_FONT_PX}
            fontFamily={getCodeFontFamily()}
            fontStyle={caption.italic ? "italic" : undefined}
            fill="var(--ptw-comment)"
          >
            {(folded.seeded ? SEED_MARK : "") + caption.text}
          </text>
        )}
      </g>
    );
  return (
    <g
      style={{ cursor: "pointer" }}
      onClick={(e) => {
        e.stopPropagation();
        onRestore();
      }}
    >
      <title>{tip}</title>
      <rect
        x={x - HOP_CHIP_W / 2}
        y={y - HOP_CHIP_H / 2}
        width={HOP_CHIP_W}
        height={HOP_CHIP_H}
        rx={CHROME_RADIUS}
        fill="var(--ptw-bg)"
      />
      <Codicon
        name="ellipsis"
        size={HOP_CHIP_W}
        x={x - HOP_CHIP_W / 2}
        y={y - HOP_CHIP_W / 2}
        color="var(--ptw-fold-ph)"
      />
      {caption && (
        <text
          x={x + HOP_CAPTION_GAP}
          y={y + BADGE_FONT_PX / 2 - 1}
          fontSize={BADGE_FONT_PX}
          fontFamily={getCodeFontFamily()}
          fontStyle={caption.italic ? "italic" : undefined}
          fill="var(--ptw-comment)"
        >
          {caption.text}
        </text>
      )}
    </g>
  );
}

export function LinkMark({
  x,
  y,
  horiz = false,
  goal,
  stroke,
}: {
  x: number;
  y: number;

  horiz?: boolean;
  goal: boolean;
  stroke: string;
}) {
  const cut = (key: string, c: number, len: number) =>
    horiz ? (
      <line
        key={key}
        x1={x + c - len / 2}
        y1={y}
        x2={x + c + len / 2}
        y2={y}
        stroke="var(--ptw-bg)"
        strokeWidth={4}
      />
    ) : (
      <line
        key={key}
        x1={x}
        y1={y + c - len / 2}
        x2={x}
        y2={y + c + len / 2}
        stroke="var(--ptw-bg)"
        strokeWidth={4}
      />
    );
  return (
    <g pointerEvents="none">
      {goal ? (
        <>
          {cut("c", 0, 7)}
          <circle cx={x} cy={y} r={2} fill={stroke} />
        </>
      ) : (
        <>
          {cut("a", -3.25, 2.5)}
          {cut("b", 3.25, 2.5)}
        </>
      )}
    </g>
  );
}

/** One button of the rail: VS Code's action-bar item — a `RAIL_BTN` square,
 a 16px codicon, no border of its own, the toolbar's hover and pressed
 washes. The rail's GROUP is what wears the widget surface (`RailGroup`). */
/** The classic rail button (`RAIL_BTN` before batch 2): a 26px square on
 the chrome surface with its own border, the hover wash over it. */
const RAIL_BTN_CLASSIC: CSSProperties = {
  ...RAIL_BTN,
  width: 26,
  height: 26,
  background: `linear-gradient(var(--ptw-bar-item-bg, transparent), var(--ptw-bar-item-bg, transparent)), ${CHROME_SURFACE}`,
  border: `1px solid ${CHROME_BORDER}`,
};

function RailButton({
  glyph,
  title,
  onClick,
}: {
  glyph: ReactNode;
  title: string;
  onClick: () => void;
}) {
  const tip = useTip();
  const classic = useClassic();
  return (
    <button
      type="button"
      {...tip.props(title)}
      onClick={onClick}
      data-ptw-baritem=""
      style={classic ? RAIL_BTN_CLASSIC : RAIL_BTN}
    >
      {glyph}
    </button>
  );
}

/** A column of rail buttons on one widget surface: the editor widget's
 background, border and shadow, as the hover bar wears them. */
function RailGroup({ children }: { children: ReactNode }) {
  // CLASSIC: no shared surface — each button is its own bordered square.
  const classic = useClassic();
  if (classic)
    return (
      <div
        role="toolbar"
        aria-orientation="vertical"
        style={{ display: "flex", flexDirection: "column", gap: 4 }}
      >
        {children}
      </div>
    );
  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      style={{
        display: "flex",
        flexDirection: "column",
        padding: RAIL_GROUP_PAD,
        background: CHROME_SURFACE,
        border: `1px solid ${CHROME_BORDER}`,
        borderRadius: CHROME_RADIUS,
        boxShadow: `0 0 3px ${WIDGET_SHADOW}`,
      }}
    >
      {children}
    </div>
  );
}

/** ⌥ held, as a tiny EXTERNAL STORE rather than view state: the mark tabs
read it (a temporary mark's number turns into `×` while ⌥ is down, since
⌥-click is what takes it off), and a keypress must repaint those few pills, not
the 12k-line view. Same sources and the same blur rule as `useAltHeld` below —
key events (only while the webview has focus) plus `altKey` off every pointer
move over the page (which arrives whatever holds focus, so ⌥ held with the caret
in the editor still shows once the pointer moves over the tree), cleared on
window blur. Listeners are attached only while some tab is subscribed. */
const altHeldStore = (() => {
  let held = false;
  const subs = new Set<() => void>();
  const set = (v: boolean) => {
    if (v === held) return;
    held = v;
    for (const f of subs) f();
  };
  const onKey = (e: KeyboardEvent) => set(e.altKey);
  const onPointer = (e: PointerEvent) => set(e.altKey);
  const clear = () => set(false);
  return {
    subscribe(f: () => void): () => void {
      if (subs.size === 0) {
        window.addEventListener("keydown", onKey);
        window.addEventListener("keyup", onKey);
        window.addEventListener("pointermove", onPointer, { passive: true });
        window.addEventListener("blur", clear);
      }
      subs.add(f);
      return () => {
        subs.delete(f);
        if (subs.size > 0) return;
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("keyup", onKey);
        window.removeEventListener("pointermove", onPointer);
        window.removeEventListener("blur", clear);
        held = false;
      };
    },
    get: (): boolean => held,
    server: (): boolean => false,
  };
})();

/** One MARK TAB: a `BADGE_H` pill straddling a box's top-left corner, its
number the stop's place in the reading. The rect is `tourTabWidth(n)` whatever
is drawn inside it (`probe overlap` models that rect), so the `×` a TEMPORARY
mark shows while ⌥ is held is a drawn glyph centred in the same pill, never a
character that could widen it. The author's (source) tabs never change: ⌥-click
on them just jumps.

`inert` is the copy drawn ABOVE the in-place editor while its node is being
edited: same place, same ink, but `pointerEvents: none`, no title and no ×, so
the mark visibly survives the edit without ever taking a click meant for the
caret (2026-09-22 — the tab used to vanish with the box, which read as the mark
being deleted). */
export function TourTab({
  cx,
  cy,
  n,
  total,
  mine,
  on,
  font,
  inert,
  onJump,
  onRemove,
}: {
  /** The pill's centre: the box's left edge, at the box's top. */
  cx: number;
  cy: number;
  n: number;
  total: number;
  mine: boolean;
  on: boolean;
  font: string;
  inert?: boolean;
  onJump?: () => void;
  onRemove?: () => void;
}) {
  const alt = useAltHeld();
  const tabW = tourTabWidth(n);
  const ink = mine ? SEQ_STROKE : "var(--ptw-comment)";
  const text = on ? "var(--ptw-surface)" : ink;
  const cross = mine && alt && !inert;
  // The × is codicon `close` at 12px, centred: its ink (~6.5px) sits well
  // inside the narrowest (one-digit) tab's 14px height.
  const crossPx = 12;
  return (
    <g
      pointerEvents={inert ? "none" : undefined}
      style={inert ? undefined : { cursor: "pointer" }}
      onClick={
        inert
          ? undefined
          : (e) => {
              e.stopPropagation();
              if (mine && e.altKey) onRemove?.();
              else onJump?.();
            }
      }
    >
      {!inert && (
        <title>
          {mine
            ? `Mark ${n} of ${total} (temporary) — click to go, ⌥-click to remove`
            : `Mark ${n} of ${total} (source) — click to go`}
        </title>
      )}
      <rect
        x={cx - tabW / 2}
        y={cy - BADGE_H / 2}
        width={tabW}
        height={BADGE_H}
        rx={CHROME_RADIUS}
        fill={on ? ink : "var(--ptw-surface)"}
        stroke={ink}
      />
      {cross ? (
        <Codicon
          name="close"
          size={crossPx}
          x={cx - crossPx / 2}
          y={cy - crossPx / 2}
          color={text}
        />
      ) : (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={BADGE_FONT_PX}
          fontFamily={font}
          fill={text}
        >
          {n}
        </text>
      )}
    </g>
  );
}

/** Whether ⌥ is held right now, from `altHeldStore`: the mark tabs read it
(a temporary tab's number turns into `×`). The store's two sources (key events
while the webview has focus, `altKey` off every pointer move whatever holds
focus) and its blur rule are why no subscriber needs listeners of its own. A
press repaints the subscribers, not the tree. */
const useAltHeld = (): boolean =>
  useSyncExternalStore(
    altHeldStore.subscribe,
    altHeldStore.get,
    altHeldStore.server,
  );

/** THE TOP-CENTRE STACK: the MODAL BANNER, and the TOAST beneath it.

The banner says "you are in a mode" — a picking mode, the staged calc fill, an
armed delete, to-cursor — for as long as the mode is up. It used to be an item
spliced into the STATUS BAR's left group, which made entering a mode RESHUFFLE
the row: every item to its right moved, so arming a delete shifted the very
controls you might be reaching for next. Here the bar never changes shape while
a mode is up, and the banner reads where the transient toast already speaks.

It wears the toast's own chrome and position (`POPUP_CHROME` + the
editor-widget border), inked `SEQ_STROKE` — DANGER for an armed delete — and
carries the `✕` whose exit IS the mode's own `layers` entry, so banner and Esc
cannot disagree.

The two are ONE flex column rather than two absolutely-positioned floaters, so
the toast stacks under a standing banner with no constant to measure either
against. The column takes no pointer events; only the banner's button does. */
export function TopCentre({
  top,
  modal,
  toast,
}: {
  top: number;
  modal: {
    text: string;
    title: string;
    ink: string;
    onExit: () => void;
  } | null;
  toast: {
    text: string;
    key: number;
    anchored?: boolean;
    action?: { label: string; run: () => void };
  } | null;
}) {
  const classic = useClassic();
  // The column is ALWAYS mounted, and so is the status region inside it: a
  // live region has to exist before its text does for a screen reader to
  // announce the text. Idle, both are empty boxes with no paint, no size to
  // speak of and no pointer events.
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: Z.popup,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        maxWidth: "80%",
        // The anchored toast wants the column's full width to be a FIXED one.
        width: toast?.anchored ? TOAST_ANCHORED_W : undefined,
      }}
    >
      {modal && (
        <button
          type="button"
          title={modal.title}
          onClick={modal.onExit}
          style={{
            pointerEvents: "auto",
            boxSizing: "border-box",
            maxWidth: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            whiteSpace: "nowrap",
            ...POPUP_CHROME,
            padding: "4px 10px",
            border: `1px solid ${CHROME_BORDER}`,
            borderRadius: CHROME_RADIUS,
            color: modal.ink,
            fontFamily: CHROME_FONT,
            fontSize: CHROME_TEXT,
            lineHeight: 1.4,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {modal.text}
          </span>
          <span style={{ opacity: DIM_OPACITY, flexShrink: 0 }}>
            <Codicon name="close" />
          </span>
        </button>
      )}
      <div
        role="status"
        aria-live="polite"
        style={{
          width: "100%",
          maxWidth: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {toast && (
          <div
            key={toast.key}
            style={{
              boxSizing: "border-box",
              maxWidth: "100%",
              // ANCHORED (a mark jump's `n/N · caption`): the box is the
              // column's fixed width and its text is left-aligned, so the
              // counter sits at one x from mark to mark and the caption reads
              // to its right; a centred box moved the counter with every
              // caption's length. Other toasts stay centred, sized to fit.
              width: toast.anchored ? "100%" : undefined,
              textAlign: toast.anchored ? "left" : undefined,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              ...FLOATER_CHROME,
              // A NOTIFICATION (2026-10-04, batch 2): every toast wears VS
              // Code's notification surface, border and ink — one look for
              // the plain echo and the one with an Undo.
              background: chromeSurface(NOTIF_BG),
              border: `1px solid ${NOTIF_BORDER}`,
              color: NOTIF_FG,
              padding: "4px 10px",
              // The UI face, as the banner above it and the bar it reports on
              // speak (it was the lone monospace floater). Tabular figures keep
              // an anchored `n/N` at one width from mark to mark.
              fontVariantNumeric: "tabular-nums",
              fontSize: CHROME_TEXT,
              lineHeight: 1.4,
            }}
          >
            {toast.action ? (
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
              >
                <span>{toast.text}</span>
                {/* The action is VS Code's primary BUTTON, as a
                    notification's is (`data-ptw-btn`: its ink and hover). */}
                <button
                  type="button"
                  data-ptw-btn={classic ? undefined : ""}
                  onClick={toast.action.run}
                  style={
                    classic
                      ? // CLASSIC: the bold underlined link it was.
                        {
                          ...BARE_BTN,
                          pointerEvents: "auto",
                          padding: "0 4px",
                          font: "inherit",
                          fontWeight: 600,
                          textDecoration: "underline",
                        }
                      : {
                          pointerEvents: "auto",
                          margin: 0,
                          border: "none",
                          padding: "1px 8px",
                          borderRadius: CHROME_RADIUS,
                          font: "inherit",
                          lineHeight: "18px",
                          cursor: "pointer",
                        }
                  }
                >
                  {toast.action.label}
                </button>
              </span>
            ) : (
              toast.text
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ZoomRail({
  lift,
  onZoomIn,
  onZoomOut,
  onExpandAll,
  onCollapseAll,
  onFit,
}: {
  /** Extra px to climb over the status strip's chrome (`StatusBar.onPlace`). */
  lift: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onFit: () => void;
}) {
  return (
    <div
      // THE BOTTOM-RIGHT CORNER, beside the canvas these verbs act on. It
      // needs no `hdrH`: the header hangs at the TOP, so the one measurement
      // the rail used to depend on (and once latched at 0, putting the rail on
      // top of the header) cannot reach it. Its bottom sits one lane UP — the
      // host's "Restart File" button owns the corner itself, and with the
      // frame now taking all the room there is (widget.tsx) the rail has to
      // clear that button by placement rather than by the frame stopping
      // short of it.
      style={{
        position: "absolute",
        right: RAIL_INSET,
        bottom:
          LANE_INSET +
          LANE_BTN_H +
          RAIL_LANE_GAP +
          lift,
        zIndex: Z.chrome,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: RAIL_GROUP_GAP,
      }}
    >
      {/* TWO ACTION BARS (2026-10-04, batch 2): the view's zoom, then the
          tree's fold-all pair — each its own visible button, where the
          fold-all pair used to hide on the zoom buttons' ⌥ (the glyph swap
          is gone, and the Layout panel's Expand/Collapse buttons with it). */}
      <RailGroup>
        <RailButton
          glyph={<Codicon name="zoom-in" />}
          title={`Zoom in (${CMD}-scroll zooms at the cursor)`}
          onClick={onZoomIn}
        />
        <RailButton
          glyph={<Codicon name="zoom-out" />}
          title="Zoom out"
          onClick={onZoomOut}
        />
        <RailButton
          glyph={<Codicon name="screen-full" />}
          title="Fit width"
          onClick={onFit}
        />
      </RailGroup>
      <RailGroup>
        <RailButton
          glyph={<Codicon name="collapse-all" />}
          title={`Collapse to the outline (${CHORD_FOLD_ALL}) — fold each branch where it leaves the trunk; Undo in the toast`}
          onClick={onCollapseAll}
        />
        <RailButton
          glyph={<Codicon name="expand-all" />}
          title={`Expand all (${CHORD_UNFOLD_ALL}) — clear every fold and skip; Undo in the toast`}
          onClick={onExpandAll}
        />
      </RailGroup>
    </div>
  );
}
