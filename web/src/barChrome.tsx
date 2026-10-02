// The status bar's small parts: buttons, checks, rows, panels and menus, the drawn glyphs (eye, comment,
// chevron, layout marks), the glyph box, and the extras slots under a bar item.
import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  useRef,
  useLayoutEffect,
  type CSSProperties,
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
} from "./theme";
import { type CommentMode, type LayoutMode } from "./viewModes";
import { focusFirstRow, panelKeys, useRestoreFocus } from "./panelKeys";
import {
  BAR_GLYPH_SW,
  BAR_ITEM,
  BAR_ITEM_H,
  BAR_ROW,
  type BarRowKind,
  GLYPH_BOX_W,
  HDR_CHEVRON_H,
  HDR_CHEVRON_W,
  MENU_PANEL,
  SLOT_GAP_PX,
  SLOT_OFF,
  SLOT_PX,
} from "./barMetrics";

/** The one `<svg>` every drawn chrome mark is: `currentColor`, fill-less, the
 chrome's own stroke (`BAR_GLYPH_SW`) with round caps and joins, hidden from
 assistive tech. `glyph` is a `data-ptw-glyph` hook for the harness; `block`
 drops the baseline gap an inline svg leaves (`style` says anything else). */
export function BarSvg({
  w,
  h,
  viewBox,
  glyph,
  block,
  style,
  children,
}: {
  w: number;
  h: number;
  viewBox?: string;
  glyph?: string;
  block?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <svg
      data-ptw-glyph={glyph}
      width={w}
      height={h}
      viewBox={viewBox ?? `0 0 ${w} ${h}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={BAR_GLYPH_SW}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      style={style ?? (block ? { display: "block" } : undefined)}
    >
      {children}
    </svg>
  );
}

/** THE chevron, for every pager in the chrome (the Marks item's `‹ ›` and the
 message strip's `‹ 1/3 ›`): drawn, so it inks the same in every face — a text
 guillemet inked 5.4px at the bar's 12px and had to be sized to 18 to level with
 the other marks. 5×8 of ink at the chrome's `BAR_GLYPH_SW`, in `currentColor`. */
export function ChevronGlyph({ dir }: { dir: "prev" | "next" }) {
  return (
    <BarSvg w={6} h={8}>
      <path d={dir === "prev" ? "M4.5 1L1.5 4L4.5 7" : "M1.5 1L4.5 4L1.5 7"} />
    </BarSvg>
  );
}

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
function ExtraSlots({ slots }: { slots: boolean[] }) {
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

  if (slots.length === 0) return null;
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
      {slots.map((on, i) => (
        <span
          key={i}
          style={{
            width: size,
            height: size,
            flex: `0 0 ${size}px`,
            // An UNSET slot is drawn faint rather than empty: an empty one
            // left a lone lit square reading as off-centre (the eye with only
            // its last extra up), where the group is centred and the square
            // is simply in its own place (user report, 2026-09-24).
            background: on ? CHROME_INK : SLOT_OFF,
          }}
        />
      ))}
    </span>
  );
}

export function BarButton({
  label,
  title,
  accent,
  muted,
  disabled,
  slots,
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
  // One entry per extra behind this menu, in a FIXED order; see `ExtraSlots`.
  slots?: boolean[];
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
      <ExtraSlots slots={slots ?? []} />
    </button>
  );
}

/** The toggle row's mark: a square at the chrome's glyph stroke
 (`BAR_GLYPH_SW`), outline at the radio's resting 0.45 when off, filled in the
 same `RAIL_PRESSED` the lit `●` uses with an `ACCENT_TEXT` tick when on —
 the radio's two states, squared. Drawn, so it inks the same in every face. */
function BarCheck({ on }: { on: boolean }) {
  return (
    <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden>
      <rect
        x={1.5}
        y={1.5}
        width={7}
        height={7}
        rx={1.5}
        fill={on ? RAIL_PRESSED : "none"}
        stroke={on ? RAIL_PRESSED : "currentColor"}
        strokeOpacity={on ? 1 : DIM_OPACITY}
        strokeWidth={BAR_GLYPH_SW}
      />
      {on && (
        <path
          d="M3.2 5.1 4.5 6.4 6.9 3.7"
          fill="none"
          stroke={ACCENT_TEXT}
          strokeWidth={BAR_GLYPH_SW}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
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
  /** A drawn mark in a fixed `ROW_ICON_W` box between the row's own mark and
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
      style={{ ...BAR_ROW, opacity: disabled ? DISABLED_OPACITY : 1 }}
    >
      {kind === "toggle" ? (
        <span
          style={{
            flex: "0 0 12px",
            alignSelf: "center",
            display: "inline-flex",
          }}
        >
          <BarCheck on={!!on} />
        </span>
      ) : kind === "action" ? (
        <span aria-hidden style={{ flex: "0 0 12px" }} />
      ) : (
        <span
          style={{
            flex: "0 0 12px",
            fontSize: 10,
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
bar's own lists use. Actions leave the panel up, like every action row. */
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

/** The width of the icon column a panel's rows may share (`BarRow`'s `icon`). */
export const ROW_ICON_W = 14;

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
  slots,
  onToggle,
  onAlt,
}: {
  label: ReactNode;
  title: string;
  accent?: boolean;
  /** Its panel is up (`aria-expanded`). */
  open?: boolean;
  slots?: boolean[];
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
      slots={slots}
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
        minWidth: width ?? 150,
      }}
    >
      {children}
    </div>
  );
}

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

// The reading menu's head. An SVG, not an emoji or a font glyph: the bar has
// exactly one pictorial mark and it must ink the same in every theme and on
// every font stack. Cropped to the eye's own ink (the path spans y 4.1–11.9 of
// a 16-unit box) so it is no taller than a line of the bar's text and every
// item — and so every accent pill — is the same height.
export function EyeGlyph() {
  return (
    <BarSvg w={14} h={10} viewBox="1 3 14 10" block>
      <path d="M1.4 8C3 5.4 5.3 4.1 8 4.1S13 5.4 14.6 8C13 10.6 10.7 11.9 8 11.9S3 10.6 1.4 8Z" />
      <circle cx={8} cy={8} r={1.9} />
    </BarSvg>
  );
}

/** The `▾` after `Reading`: a drawn chevron at the chrome's stroke, the
 header chevron's ink (8 × 5), so it reads the same in every face. */
export function DisclosureGlyph() {
  const w = HDR_CHEVRON_W;
  const h = HDR_CHEVRON_H;
  const m = BAR_GLYPH_SW / 2;
  return (
    <BarSvg w={w} h={h} glyph="disclosure" block>
      <path d={`M${m} ${m}L${w / 2} ${h - m}L${w - m} ${m}`} />
    </BarSvg>
  );
}

// The comment switch's head, in the eye's own idiom: an inline SVG in
// `currentColor`, cropped to its own ink and dropped into the same fixed
// `GlyphBox`, so every item — and so every accent pill — is the same height
// whichever form is showing. It replaced `❝`, a typographic mark that read as
// punctuation the bar had accidentally left in. (Width's `word-wrap` mark went
// with Width's bar item, 2026-09-24: the width is a row in the Layout panel.)
//
// It is the GLYPH form only: the word forms are `Comments: show` and `show`,
// and this is what stands in their place when the row runs out of room.
//
// The bubble is codicon `comment` — a rounded rectangle with a small tail off
// the bottom-LEFT corner. It inks ~11 × 10.
export function CommentGlyph({ mode }: { mode: CommentMode }) {
  return (
    <BarSvg w={12} h={11} glyph={`comment-${mode}`} block>
      {mode === "instead" ? (
        // In place: a small bubble sitting inside the tactic's own box.
        <>
          <rect x={0.8} y={0.8} width={10.4} height={9.4} rx={1.6} />
          <rect x={3} y={2.6} width={6} height={3.2} rx={1} />
          <path d="M4.4 5.8v1.4l1.4-1.4" />
        </>
      ) : (
        // The bubble and its tail, and what the mode puts with it: shown,
        // two lines of prose; hidden, a strike through it; narrate, ∴ drawn
        // as three dots.
        <>
          <rect x={1} y={1} width={10} height={7} rx={2} />
          <path d={`M3.5 8v2.2l2.4-2.2${COMMENT_EXTRA[mode]}`} />
          {mode === "narrate" && (
            <g fill="currentColor" stroke="none">
              <circle cx={6} cy={3} r={0.8} />
              <circle cx={4.3} cy={5.6} r={0.8} />
              <circle cx={7.7} cy={5.6} r={0.8} />
            </g>
          )}
        </>
      )}
    </BarSvg>
  );
}

const COMMENT_EXTRA = {
  shown: "M3.7 3.4h4.6M3.7 5.6h2.6",
  hidden: "M1.4 10.2 10.6 0.8",
  narrate: "",
} as const;

/** The signature header's open/close mark: a drawn chevron (`▾` / `▴`) in the
    status bar's stroke, so it reads as a control at any editor font. */
export function HeaderChevron({ up }: { up: boolean }) {
  const w = HDR_CHEVRON_W;
  const h = HDR_CHEVRON_H;
  const m = BAR_GLYPH_SW / 2;
  return (
    <BarSvg w={w} h={h} glyph={up ? "hdr-close" : "hdr-open"} block>
      <path
        d={
          up
            ? `M${m} ${h - m}L${w / 2} ${m}L${w - m} ${h - m}`
            : `M${m} ${m}L${w / 2} ${h - m}L${w - m} ${m}`
        }
      />
    </BarSvg>
  );
}

export function LayoutGlyph({ mode }: { mode: LayoutMode }) {
  return (
    <BarSvg w={12} h={10} glyph={`layout-${mode}`} block>
      {mode === "stacked" ? (
        // The outline as an F: the trunk, with a step off it at the top and
        // a shorter one below — an outliner's nesting, not a menu's ☰ (user
        // direction; the shape matches the spine and wide marks' family).
        <path d="M2.6 1.3v7.4M2.6 1.3h7.2M2.6 5h5" />
      ) : mode === "spine" ? (
        // `⊦`: the goal spine, with one tactic branching off it.
        <path d="M2.2 1.3v7.4M2.2 5h6.3" />
      ) : mode === "tracks" ? (
        // `||`: the two aligned columns, as two bars of equal length.
        <path d="M3.2 1.3v7.4M8.8 1.3v7.4" />
      ) : (
        // `⑃`: one stem forking into two, the layered tree seen head-on.
        <path d="M6 1.3v2.9M6 4.2 2.2 8.7M6 4.2 9.8 8.7" />
      )}
    </BarSvg>
  );
}
