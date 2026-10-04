// The status bar's small parts: buttons, checks, rows, panels and menus, the glyph box, and the one dot
// under a bar item. Every mark is a codicon (codiconView.tsx).
import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  useRef,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { plainTicks } from "./ticks";
import { useTip } from "./tipController";
import {
  ACCENT_TEXT,
  RAIL_PRESSED,
  CHROME_BORDER,
  CHROME_INK,
  CHROME_TEXT_SM,
  DISABLED_OPACITY,
  DIM_OPACITY,
  CHROME_RADIUS,
} from "./theme";
import { Codicon } from "./codiconView";
import { focusFirstRow, panelKeys, useRestoreFocus } from "./panelKeys";
import {
  BARE_BTN,
  BAR_ITEM,
  BAR_ITEM_H,
  BAR_ROW,
  type BarRowKind,
  GLYPH_BOX_W,
  MENU_PANEL,
  SLOT_GAP_PX,
  SLOT_PX,
  type StatusInfo,
  STATUS_GAP,
  statusParts,
  statusTip,
} from "./barMetrics";

export function GlyphBox({ children, w }: { children: ReactNode; w?: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: BAR_ITEM_H,
        width: w ?? GLYPH_BOX_W,
        flex: `0 0 ${w ?? GLYPH_BOX_W}px`,
        lineHeight: 1,
        overflow: "visible",
      }}
    >
      {children}
    </span>
  );
}

/* THE DEVICE-PIXEL RATIO, live. It is not a constant even on one screen: the
editor's own zoom multiplies it (measured in the infoview at 2.4 = retina 2 ×
zoom 1.2), and a zoom change fires `resize`. */
function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() =>
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  );
  useEffect(() => {
    const read = () => setDpr(window.devicePixelRatio || 1);
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return dpr;
}

/* A 3×3 CSS square is only a square on screen when it lands on WHOLE DEVICE
PIXELS, and in the infoview it routinely does neither: at dpr 2.4 a 3px side
is 7.2 device px, and the group is centred under an item of fractional width,
so its left edge falls mid-pixel too. The renderer then antialiases one axis
and not the other and the mark reads as a RECTANGLE — reported as exactly
that.

So both halves are snapped. The SIZE (and the gap, or marks 2 and 3 drift off
the grid however well mark 1 is placed) is rounded to whole device pixels and
expressed back in CSS px; the POSITION is corrected by a `transform` carrying
the sub-device-pixel remainder of the FIRST mark's own rect — the first mark,
not the group, because `justifyContent: center` is what makes the offset
fractional in the first place. The rect already carries the nudge in force, so
it is taken back out before the remainder is read, which is what makes the
correction converge in one pass instead of chasing itself.

A transform on an absolutely-positioned span reaches no layout, so both
standing promises hold untouched: ONE HEIGHT and STABLE WIDTH. */
function ExtraSlots({ on }: { on: boolean }) {
  const dpr = useDevicePixelRatio();
  const ref = useRef<HTMLSpanElement | null>(null);
  // The nudge in force, held twice: as STATE (what the render draws) and in a
  // ref (what the next measurement takes back out). The pair is what lets the
  // effect run after EVERY render — which is when the row's own layout can
  // have moved the group — without listing itself in its deps; it is `fit`'s
  // shape exactly, and it converges in one pass because taking the applied
  // nudge back out leaves the same raw position it was computed from.
  const applied = useRef({ dx: 0, dy: 0 });
  const [nudge, setNudge] = useState({ dx: 0, dy: 0 });

  /* THE SECOND HALF OF THE RATIO, and it has to be MEASURED. A webview's own
  zoom moves `devicePixelRatio` (that is the infoview's case: retina 2 × zoom
  1.2 = 2.4), but an ancestor CSS `zoom` does NOT — measured, the ratio still
  reads 2 under `zoom: 1.2` — so the scale in force is read off a box whose
  CSS size we KNOW and never touch: the item this group is absolutely
  positioned inside, `BAR_ITEM_H` tall by construction. Reading it off one of
  our own marks would feed the snapped size back into the scale that computed
  it, and the layout's 1/64px quantization then makes the pair oscillate. */
  const [scale, setScale] = useState(1);
  const ratio = dpr * scale;

  const size = Math.max(1, Math.round(SLOT_PX * ratio)) / ratio;
  const gap = Math.max(1, Math.round(SLOT_GAP_PX * ratio)) / ratio;

  const snap = useCallback(() => {
    const el = ref.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return;
    const r = first.getBoundingClientRect();
    // A measurement with no box is the ABSENCE of an answer, not a position
    // (`useFrameOffset`'s rule) — a hidden webview lays the row out at zero.
    if (r.width === 0 && r.height === 0) return;
    const host = el.parentElement?.getBoundingClientRect();
    const s = host && host.height > 0 ? host.height / BAR_ITEM_H : 1;
    if (Math.abs(s - scale) > 1e-3) {
      setScale(s);
      return;
    }
    // Everything below is in DEVICE pixels of the rect's own (already scaled)
    // coordinate space; the nudge itself is written in the element's CSS px,
    // which the ancestor scale multiplies — hence the `s` on the way in and
    // the `ratio` on the way out.
    const cur = applied.current;
    const rawL = (r.left - cur.dx * s) * dpr;
    const rawT = (r.top - cur.dy * s) * dpr;
    const dx = (Math.round(rawL) - rawL) / ratio;
    const dy = (Math.round(rawT) - rawT) / ratio;
    if (Math.abs(dx - cur.dx) > 1e-4 || Math.abs(dy - cur.dy) > 1e-4) {
      applied.current = { dx, dy };
      setNudge({ dx, dy });
    }
  }, [dpr, ratio, scale]);
  useLayoutEffect(snap);

  // ONE dot, drawn only while lit: an unlit square on every item is chrome
  // that says nothing.
  if (!on) return null;
  return (
    <span
      ref={ref}
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: -1,
        display: "flex",
        justifyContent: "center",
        gap,
        pointerEvents: "none",
        lineHeight: 0,
        transform: `translate(${nudge.dx}px, ${nudge.dy}px)`,
      }}
    >
      <span
        style={{
          width: size,
          height: size,
          flex: `0 0 ${size}px`,
          background: CHROME_INK,
        }}
      />
    </span>
  );
}

export function BarButton({
  label,
  title,
  accent,
  muted,
  disabled,
  dot,
  popup,
  expanded,
  onClick,
  onHover,
}: {
  label: ReactNode;
  title: string;
  accent?: boolean;
  muted?: boolean;
  disabled?: boolean;
  // Lit when something in this item's panel is switched on; see `ExtraSlots`.
  dot?: boolean;
  /** What the button opens, for assistive tech; `expanded` is whether it is up. */
  popup?: "menu" | "dialog";
  expanded?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onHover?: (h: boolean) => void;
}) {
  const { ctl } = useTip();
  return (
    <button
      type="button"
      data-ptw-baritem=""
      aria-label={plainTicks(title)}
      aria-haspopup={popup}
      aria-expanded={popup ? !!expanded : undefined}
      disabled={disabled}
      onClick={onClick}
      // POINTER events for the tip and the hover preview, not mouse: React
      // drops `onMouseEnter` on a DISABLED button, and a disabled control's
      // tip is the one that says why.
      onPointerEnter={(e) => {
        ctl.enter(e.currentTarget);
        onHover?.(true);
      }}
      onPointerLeave={(e) => {
        ctl.leave(e.currentTarget);
        onHover?.(false);
      }}
      style={{
        ...BAR_ITEM,
        opacity: disabled ? DISABLED_OPACITY : muted ? DIM_OPACITY : 1,
        cursor: disabled ? "default" : "pointer",
        ...(accent ? { background: RAIL_PRESSED, color: ACCENT_TEXT } : null),
      }}
    >
      {label}
      <ExtraSlots on={!!dot} />
    </button>
  );
}

/** THE STATUS READOUT (2026-10-02): `tour_reading · 5 steps · 1 open · 4 hidden`
 — a readout, not a setting, so no `Name:` and no dot. One `<span>` so the
 ghost measures one unit; its two counts that can be acted on are real
 `<button>`s styled as text (`BARE_BTN`) — `open` goes to the next open goal,
 `hidden` expands everything — and the name and the step count are inert.
 Drawn at `DIM_OPACITY`, like secondary text. */
export function StatusReadout({ info }: { info: StatusInfo }) {
  const { props, ctl } = useTip();
  const p = statusParts(info);
  const sep = <span style={{ whiteSpace: "pre" }}> · </span>;
  const btn = (text: string, label: string, run: () => void) => {
    const n = parseInt(text, 10);
    const tip = label.replace("{n}", Number.isNaN(n) ? text : String(n));
    return (
    <button
      type="button"
      data-ptw-baritem=""
      aria-label={tip}
      onClick={run}
      onPointerEnter={(e) => ctl.enter(e.currentTarget)}
      onPointerLeave={(e) => ctl.leave(e.currentTarget)}
      style={{
        ...BARE_BTN,
        font: "inherit",
        height: BAR_ITEM_H - 4,
        // The wash reaches 3px past the text on each side and the margin takes
        // it back, so the readout's width is its text's.
        padding: "0 3px",
        margin: "0 -3px",
        borderRadius: CHROME_RADIUS,
        whiteSpace: "pre",
        background: "var(--ptw-bar-item-bg, transparent)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {text}
    </button>
    );
  };
  return (
    <span
      role="group"
      {...props(statusTip(info))}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: BAR_ITEM_H,
        padding: `0 ${STATUS_GAP}px`,
        whiteSpace: "pre",
        flexShrink: 0,
        opacity: DIM_OPACITY,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {info.name && (
        <>
          <span>{info.name}</span>
          {sep}
        </>
      )}
      <span>{p.steps}</span>
      {p.open && (
        <>
          {sep}
          {btn(p.open, "Open goals: {n} — click to go to the next", info.onOpen)}
        </>
      )}
      {p.hidden && (
        <>
          {sep}
          {btn(p.hidden, "Hidden steps: {n} — click to expand all", info.onHidden)}
        </>
      )}
    </span>
  );
}

export function BarRow({
  label,
  title,
  on,
  kind = "pick",
  icon,
  disabled,
  onClick,
  onHover,
}: {
  label: ReactNode;
  title: string;
  on?: boolean;
  kind?: BarRowKind;
  /** A codicon in a fixed `ROW_ICON_W` box between the row's own mark and
   its word, so the words of a panel's rows align. `null` reserves the box and
   draws nothing (a row of the same panel with no mark of its own); omitted
   means the panel has no icon column. */
  icon?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  onHover?: (h: boolean) => void;
}) {
  const { ctl } = useTip();
  return (
    <button
      type="button"
      aria-label={plainTicks(title)}
      aria-checked={kind === "action" ? undefined : !!on}
      role={
        kind === "pick"
          ? "menuitemradio"
          : kind === "toggle"
            ? "menuitemcheckbox"
            : "menuitem"
      }
      disabled={disabled}
      onClick={onClick}
      // POINTER events for the tip and the hover preview, not mouse: React
      // drops `onMouseEnter` on a DISABLED button, and a disabled control's
      // tip is the one that says why.
      onPointerEnter={(e) => {
        ctl.enter(e.currentTarget);
        onHover?.(true);
      }}
      onPointerLeave={(e) => {
        ctl.leave(e.currentTarget);
        onHover?.(false);
      }}
      data-ptw-baritem=""
      style={{
        ...BAR_ROW,
        opacity: disabled ? DISABLED_OPACITY : 1,
        background: "var(--ptw-bar-item-bg, transparent)",
      }}
    >
      {/* THE ROW'S MARK, in one 16px column: a toggle is the infoview's
          check menu (`check` when on, nothing when off); a pick keeps its
          radio; an action has none. */}
      {kind === "toggle" ? (
        <span style={{ flex: `0 0 ${ROW_MARK_W}px`, alignSelf: "center" }}>
          <Codicon name={on ? "check" : "blank"} />
        </span>
      ) : kind === "action" ? (
        <span aria-hidden style={{ flex: `0 0 ${ROW_MARK_W}px` }} />
      ) : (
        <span
          style={{
            flex: `0 0 ${ROW_MARK_W}px`,
            fontSize: 10,
            textAlign: "center",
            color: on ? RAIL_PRESSED : "inherit",
            opacity: on ? 1 : DIM_OPACITY,
          }}
        >
          {on ? "●" : "○"}
        </span>
      )}
      {icon !== undefined && (
        <span
          aria-hidden
          style={{
            flex: `0 0 ${ROW_ICON_W}px`,
            alignSelf: "center",
            display: "inline-flex",
            justifyContent: "center",
          }}
        >
          {icon}
        </span>
      )}
      <span>{label}</span>
    </button>
  );
}

/* ONE ROW OF SHORT ACTIONS under a panel's divider (`Expand all · Collapse ·
Reset`), where three `BarRow`s took three full rows. Each is a real `<button>`
with the `menuitem` role, so `panelKeys`' ↑/↓ reach every one in turn and its
←/→ move between them (the row is a `[data-ptw-rowgroup]`); the tip and the
aria-label are `name — what it does`, the name being the full one the short
label stands for. Left-aligned, `CHROME_TEXT_SM`, a `·` between — the voice the
bar's own lists use. Actions leave the panel up, like every action row.
RULE: a LONE action in a panel is a full `BarRow kind="action"`; a GROUP of 2+ is this compact row. */
export function BarActionRow({
  actions,
}: {
  actions: {
    label: string;
    name: string;
    title: string;
    onClick: () => void;
    disabled?: boolean;
  }[];
}) {
  const { ctl } = useTip();
  return (
    <div
      role="group"
      data-ptw-rowgroup=""
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "3px 6px",
        fontSize: CHROME_TEXT_SM,
        whiteSpace: "nowrap",
      }}
    >
      {actions.map((a, i) => (
        <Fragment key={a.name}>
          {i > 0 && (
            <span aria-hidden style={{ opacity: DIM_OPACITY }}>
              ·
            </span>
          )}
          <button
            type="button"
            role="menuitem"
            data-ptw-baritem=""
            aria-label={plainTicks(`${a.name} — ${a.title}`)}
            disabled={a.disabled}
            onClick={a.onClick}
            onPointerEnter={(e) => ctl.enter(e.currentTarget)}
            onPointerLeave={(e) => ctl.leave(e.currentTarget)}
            style={{
              ...BAR_ROW,
              width: "auto",
              alignItems: "center",
              padding: "2px 5px",
              fontSize: CHROME_TEXT_SM,
              opacity: a.disabled ? DISABLED_OPACITY : 1,
              background: "var(--ptw-bar-item-bg, transparent)",
            }}
          >
            {a.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

/** The width of the icon column a panel's rows may share (`BarRow`'s `icon`),
 and of the row's own check/radio column: a codicon's 16. */
export const ROW_ICON_W = 16;
const ROW_MARK_W = 16;

// The bar is ONE ROW, always — a popover parented to its own item would be
// clipped by that row's `overflow: hidden`. So a menu item is only ever the
// BUTTON: it reports its left x through `onToggle` (relative to the strip,
// which is the nearest positioned ancestor) and the panel is rendered
// by `StatusBar` as a SIBLING of the row, hung upward from that x.
export function BarMenu({
  label,
  title,
  accent,
  open,
  dot,
  onToggle,
  onAlt,
}: {
  label: ReactNode;
  title: string;
  accent?: boolean;
  /** Its panel is up (`aria-expanded`). */
  open?: boolean;
  dot?: boolean;
  onToggle: (x: number) => void;
  // ⌥-click advances the setting to its next value instead of opening the
  // list — the same wrapper the list's own rows call, so it toasts and
  // anchors identically. Where a menu has no cycle (the width slider, the
  // reading toggles) the modifier simply opens the list.
  onAlt?: () => void;
}) {
  return (
    <BarButton
      // NO DISCLOSURE MARK on the settings: a chevron here spent width on a
      // row whose whole budget is the frame, and their titles say what a
      // click does. The one item that wears one is `Reading ▾` — it is a menu
      // named for what it opens, not a setting with a value (its `words`).
      label={label}
      title={title}
      accent={accent}
      dot={dot}
      popup="menu"
      expanded={open}
      onClick={(e) => {
        if (onAlt && e.altKey) {
          onAlt();
          return;
        }
        // The item's LEFT edge in the strip's padding box (where the panel's
        // `left` resolves), exact rather than `offsetLeft`'s whole pixel.
        const el = e.currentTarget as HTMLElement;
        const host = el.offsetParent as HTMLElement | null;
        onToggle(
          host
            ? el.getBoundingClientRect().left -
                host.getBoundingClientRect().left -
                host.clientLeft
            : el.offsetLeft,
        );
      }}
    />
  );
}

// The panel half of a bar menu, positioned from the item's measured x. A
// `menu` for assistive tech, named for the item that opened it. Opened from
// the keyboard it takes focus onto its checked row (else its first), so the
// arrows work at once; opened with the mouse it takes none. Closing gives
// focus back to the item that was focused when it opened — only if focus was
// inside the panel, so a click elsewhere keeps the focus it made.
export function BarPanel({
  left,
  width,
  label,
  onClose,
  children,
}: {
  left: number;
  width?: number;
  /** The item's name, e.g. `Layout`. */
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useRestoreFocus(ref, focusFirstRow);
  // HUNG FROM ITS ITEM'S LEFT EDGE, and kept inside the frame: where the
  // panel would cross the frame's far edge (a glyph item near the strip's
  // right end, a thin pane) it slides left by the overshoot. Paint only — a
  // transform written to the element, never state — and measured from the
  // frame (the strip's own containing block), so it is exact at every width.
  useLayoutEffect(() => {
    const el = ref.current;
    const strip = el?.offsetParent as HTMLElement | null;
    const frame = (strip?.offsetParent as HTMLElement | null) ?? strip;
    if (!el || !frame) return;
    el.style.transform = "";
    const r = el.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const dx = Math.min(
      0,
      f.right - PANEL_EDGE - r.right,
    );
    const fixed = Math.max(dx, f.left + PANEL_EDGE - r.left);
    if (fixed !== 0) el.style.transform = `translateX(${fixed}px)`;
  });
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      data-ptw-panel=""
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => panelKeys(e, onClose)}
      style={{
        ...MENU_PANEL,
        position: "absolute",
        bottom: "100%",
        left,
        marginBottom: 4,
        minWidth: width ?? MENU_MIN_W,
      }}
    >
      {children}
    </div>
  );
}

/** One minimum width for every bar panel (the recorded Reading width); Help is a document and keeps its own. */
export const MENU_MIN_W = 196;

/** The room a panel keeps from the frame's edge when it is slid back inside. */
const PANEL_EDGE = 4;

/* A hairline between GROUPS in the bar's own row. It has been taken out and
put back twice, and the reason it stands now is that the row MIXES KINDS:
the settings that say how the tree is drawn, then `Reading` (how much of each
node you are asked to take in), then — in the right group — the marks (a
reading position) and the diagnostics count (a fact about the proof). The
rule says where one kind of thing ends: one between the settings and
Reading, one between Marks and the count where both exist.

It is the item's 20px tall, centred, so it cannot reach the strip's height;
`fit` measures it off its own ghost and counts one STATUS_GAP either side. */
export function BarDivider() {
  return (
    <span
      aria-hidden
      style={{
        flex: "0 0 1px",
        width: 1,
        height: BAR_ITEM_H,
        alignSelf: "center",
        background: CHROME_BORDER,
      }}
    />
  );
}

// A hairline between groups of rows INSIDE a menu panel — the same rule as
// `BarDivider`, drawn across a panel instead of down a row.
export function MenuDivider() {
  return (
    <div
      aria-hidden
      style={{
        height: 1,
        margin: "4px 6px",
        background: CHROME_BORDER,
        opacity: DIM_OPACITY,
      }}
    />
  );
}
