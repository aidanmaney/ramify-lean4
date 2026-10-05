// The status band: VS Code's status bar docked on the frame's bottom edge, with a slot punched at its
// right end for the host's "Restart File" button — settings (layout, context, comments) and Reading on the
// left, the status readout, marks, the diagnostics count and `?` on the right — its three-form compaction,
// its second row, and its panels.
import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  useRef,
  useLayoutEffect,
} from "react";
import { REFLOW_MIN_CHARS, REFLOW_MAX_CHARS } from "./layout";
import type { ReflowMode } from "./layout";
import { type HypMode } from "./proofToTree";
import { type Caps } from "./gestures";
import { HelpPanel } from "./helpPanel";
import { useTip } from "./tipController";
import { type TourLists } from "./tour";
import {
  CHROME_TEXT,
  Z,
  CHROME_INK,
  CHROME_FONT,
  DIM_OPACITY,
  STATUSBAR_BG,
  STATUSBAR_BORDER,
  STATUSBAR_FG,
  STATUSBAR_ON,
} from "./theme";
import {
  COMMENT_MODES,
  type CommentMode,
  HYP_MODES,
  LAYOUT_MODES,
  type LayoutMode,
  REFLOW_OFF_STOP,
  reflowToStop,
  stopToReflow,
} from "./viewModes";
import {
  BAND_BORDER,
  BAND_PAD,
  BAND_SLOT_GAP,
  BAR_GROUP_GAP,
  BAR_H,
  type BarForm,
  type BarValueItem,
  DIAG_STRIP_GAP,
  HOST_BUTTON_CSS,
  STATUS_GAP,
  STATUS_PAD_X,
  type StatusInfo,
} from "./barMetrics";
import {
  BarButton,
  BarMenu,
  BarPanel,
  BarRow,
  GlyphBox,
  MenuDivider,
  ROW_ICON_W,
  StatusReadout,
} from "./barChrome";
import { READING_OPTIONS, readingOn, type ReadingId, type ReadingState } from "./experience";
import { type DiagBarProps, DiagCountItem, DiagStrip } from "./diagBar";
import { Codicon } from "./codiconView";

// One group of the band: its items in a flex row, one STATUS_GAP apart. The
// groups never shrink; a row clips at its ends only as the last resort.
// One row of the band: the groups in a flex row, centred on the row's
// height; a frame too narrow even for the all-glyph row clips at the sides
// (a clip-path, which leaves the vertical axis alone) rather than spill.
const ROW_STYLE = {
  boxSizing: "border-box",
  display: "flex",
  flexWrap: "nowrap",
  alignItems: "center",
  flex: "none",
  minWidth: 0,
  clipPath: "inset(-4px 0 -4px 0)",
} as const;

const GROUP_STYLE = {
  display: "flex",
  flexWrap: "nowrap",
  alignItems: "center",
  gap: STATUS_GAP,
  flex: "none",
} as const;

/** What the band reports to the view (`onPlace`): its own height, which the
 tree's frame gives up, and the open message strip's height plus its gap,
 which the zoom rail climbs over (0 while it is shut). */
export interface BandPlace {
  band: number;
  strip: number;
}

/* THE HOST BUTTON'S RULE, injected while ANY view is mounted (the render
matrix mounts many) and removed with the last: one `<style>`, counted. */
let hostRuleUsers = 0;
let hostRuleEl: HTMLStyleElement | null = null;
function useHostButtonRule() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (hostRuleUsers++ === 0) {
      hostRuleEl = document.createElement("style");
      hostRuleEl.setAttribute("data-ptw-host-button", "");
      hostRuleEl.textContent = HOST_BUTTON_CSS;
      document.head.appendChild(hostRuleEl);
    }
    return () => {
      if (--hostRuleUsers === 0) {
        hostRuleEl?.remove();
        hostRuleEl = null;
      }
    };
  }, []);
}

/* SET INTO THE FRAME'S CORNER, not the viewport's. The button is fixed to the
webview, and the infoview pads its content (measured: the frame ran 28 to 771
of a 795 viewport), so `right: 2px` left it hanging 22px past the band's end.
The rule is rewritten so the button's box stands `BAND_PAD` inside the
FRAME's bottom-right corner: its computed inset plus how far it is from where
it should be — linear, so one write lands it, and a second pass writes
nothing. A DOM write to our own `<style>`, never state. */
function placeHostButton(btn: HTMLElement, fr: DOMRect) {
  if (!hostRuleEl) return;
  const cs = getComputedStyle(btn);
  const b = btn.getBoundingClientRect();
  const right = parseFloat(cs.right);
  const bottom = parseFloat(cs.bottom);
  if (!Number.isFinite(right) || !Number.isFinite(bottom)) return;
  const dr = b.right - (fr.right - BAND_PAD);
  const db = b.bottom - (fr.bottom - BAND_PAD);
  if (Math.abs(dr) < 0.5 && Math.abs(db) < 0.5) return;
  const r = Math.round((right + dr) * 100) / 100;
  const bt = Math.round((bottom + db) * 100) / 100;
  hostRuleEl.textContent = `.restart-file-button{bottom:${bt}px !important;right:${r}px !important}`;
}

/** The host's "Restart File" button, where the page has one with a box. */
function hostButton(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(".restart-file-button");
  return el && el.getClientRects().length > 0 ? el : null;
}

export function StatusBar({
  onPlace,
  upToEnabled,
  reading,
  onReadingChange,
  layout,
  onLayoutChange,
  sideBySide,
  sbsEnabled,
  onSideBySideChange,
  gallery,
  onGalleryChange,
  classic,
  onClassicChange,
  onReset,
  reflow,
  forcedReflow,
  onReflowChange,
  barOpen,
  onBarOpenChange,
  onBriefHover,
  polishShown,
  polishWhy,
  proposeShown,
  proposeBusy,
  onPropose,
  commentMode,
  onCommentModeChange,
  hypMode,
  onHypModeChange,
  hypGroup,
  onHypGroupChange,
  tourLists,
  tourAt,
  tourCount,
  authorCount,
  myCount,
  onTourListToggle,
  onTourCycle,
  onTourClearMine,
  onTourStep,
  diag,
  status,
  helpOpen,
  onHelpOpenChange,
  caps,
  fontFamily,
}: {
  /** The band's height and the open message strip's (see `fit`). */
  onPlace: (p: BandPlace) => void;
  /** Whether the editor cursor exists (`up to cursor` needs it). */
  upToEnabled: boolean;
  /** The reading options as they stand, and the one way to change one
   (experience.ts `READING_OPTIONS`). */
  reading: ReadingState;
  onReadingChange: (id: ReadingId, v: boolean) => void;
  layout: LayoutMode;
  onLayoutChange: (v: LayoutMode) => void;
  sideBySide: boolean;
  sbsEnabled: boolean;
  onSideBySideChange: (v: boolean) => void;
  gallery: boolean;
  onGalleryChange: (v: boolean) => void;
  /** `ramify.appearance` (appearance.ts), with the session's override: the
   Layout panel's `classic look` row. Paint only. */
  classic: boolean;
  onClassicChange: (v: boolean) => void;
  /** The Layout panel's one action row, Reset tree. */
  onReset: () => void;
  reflow: ReflowMode;
  forcedReflow?: number;
  onReflowChange: (v: ReflowMode) => void;
  barOpen: string | null;
  onBarOpenChange: (v: string | null) => void;
  /** `brief`'s row hover drives the in-place preview of what it would elide. */
  onBriefHover: (h: boolean) => void;
  /** False: the row is not drawn (no companion, no key, or the setting off). */
  polishShown: boolean;
  polishWhy: string;
  /** False: the row is not drawn, as `polishShown`. */
  proposeShown: boolean;
  proposeBusy: boolean;
  onPropose: () => void;
  commentMode: CommentMode;
  onCommentModeChange: (v: CommentMode) => void;
  hypMode: HypMode;
  onHypModeChange: (v: HypMode) => void;
  hypGroup: boolean;
  onHypGroupChange: (v: boolean) => void;
  tourLists: TourLists;
  tourAt: number | null;
  tourCount: number;
  authorCount: number;
  myCount: number;
  onTourListToggle: (which: "source" | "temp") => void;
  onTourCycle: () => void;
  onTourClearMine: () => void;
  onTourStep: (d: number) => void;
  diag: DiagBarProps | null;
  /** The status readout's facts, or null where there is no proof to read
   (the readout is then not drawn and not measured). */
  status: StatusInfo | null;
  helpOpen: boolean;
  onHelpOpenChange: (v: boolean) => void;
  caps: Caps;
  fontFamily: string;
}) {
  // Where the open panel hangs from: the x its own item reported. Held here
  // rather than in `barOpen` because it is geometry, not view state — and the
  // rail's `"pick"` id shares that state without ever needing an x.
  const [menuX, setMenuX] = useState(0);
  const toggle = (id: string, x: number) => {
    setMenuX(x);
    onBarOpenChange(barOpen === id ? null : id);
  };
  const close = () => onBarOpenChange(null);
  const tip = useTip();

  const effReflow = forcedReflow ?? reflow;
  const reflowCols = forcedReflow ?? reflowToStop(reflow);
  const reflowMax = forcedReflow ? REFLOW_MAX_CHARS : REFLOW_OFF_STOP;

  const commentName = COMMENT_MODES[commentMode].name;
  // THE MARKS ITEM IS DRAWN ONLY WHERE THERE ARE MARKS (2026-09-24): a proof
  // with no `.mark` and no dropped mark has nothing to read, and `Marks: –/0`
  // was a whole item of the row saying so. `<` / `>` still work (and toast the
  // empty message); the corner nub still drops one, and the first drop brings
  // the item in — bar only, the tree is never laid out off the bar.
  const hasMarks = authorCount + myCount > 0;
  // `2/5` while reading; `–/5` (an EN DASH) before it has been started, and
  // `–/0` where the reading is empty — the count is a fact about the proof
  // either way, so it is always shown. NO LIST NAME and no dots: the value is
  // just the place (the panel's checkboxes say which sets are in).
  // …and `off` where BOTH lists are off: there is no reading at all then, so
  // a count would be a fact about nothing. It is drawn as an OFF value — the
  // dimming `Width: full` wears — rather than accented away.
  const marksOff = !tourLists.source && !tourLists.temp;
  const tourValue = marksOff
    ? "off"
    : tourAt === null
      ? `–/${tourCount}`
      : `${Math.min(tourAt + 1, tourCount)}/${tourCount}`;
  // The reading options that are on: the item's emphasis and its tip.
  const readingNames = readingOn(reading);
  // Layout's panel options that are ON: side-by-side only where it is
  // effective (wide draws nothing), and the width while labels wrap.
  const layoutTitle = LAYOUT_MODES[layout].title;
  const layoutCut = layoutTitle.indexOf(" — ");
  const layoutHead = layoutCut < 0 ? layoutTitle : layoutTitle.slice(0, layoutCut);
  const layoutRest = layoutCut < 0 ? "" : layoutTitle.slice(layoutCut);
  const layoutOn = [
    ...(sbsEnabled && sideBySide ? ["side-by-side"] : []),
    ...(gallery ? ["gallery"] : []),
    ...(effReflow !== "off" ? ["narrower width"] : []),
  ];

  // Context's compact label is drawn in the TREE's code font, not the bar's
  // system UI font: its glyphs (`▸ λ Δ ∀`) were designed to sit in that stack.
  // The `GlyphBox` is what stops `glyphPx` — up to 19 — from reaching the
  // item's own box. (Every other item's glyph is a codicon.)
  const glyph = (g: string, px = 13, w?: number) => (
    <GlyphBox w={w}>
      <span style={{ fontFamily, fontSize: px, lineHeight: 1 }}>{g}</span>
    </GlyphBox>
  );

  // THE VALUE ITEMS, in row order — three, or four where there are marks.
  // Each can be drawn `Name: value`, as the value alone, or as its glyph, and
  // the row decides per item (see `fit`).
  const valueItems: BarValueItem[] = [
    {
      id: "layout",
      prefix: "Layout:",
      glyph: (
        <GlyphBox>
          <Codicon name={LAYOUT_MODES[layout].icon} />
        </GlyphBox>
      ),
      value: LAYOUT_MODES[layout].name,
      values: Object.values(LAYOUT_MODES).map((m) => m.name),
      title: `${layoutHead}${layoutOn.length > 0 ? ` · ${layoutOn.join(" · ")}` : ""}${layoutRest}. ⌥-click: next layout`,
      // The four layouts are a CHOICE AMONG EQUALS, so the layout itself
      // never wears the emphasis; a panel option that is ON does (`layoutOn`,
      // which the tip lists): side-by-side, gallery, or a narrower width.
      on: layoutOn.length > 0,
      onAlt: () => onLayoutChange(LAYOUT_MODES[layout].next),
    },
    {
      id: "context",
      prefix: "Context:",
      glyph: glyph(HYP_MODES[hypMode].glyph, HYP_MODES[hypMode].glyphPx),
      value: HYP_MODES[hypMode].name,
      values: Object.values(HYP_MODES).map((m) => m.name),
      title: `${HYP_MODES[hypMode].title}${hypGroup ? " · data & props split" : ""}. ⌥-click: next breadth`,
      // `split data & props` is the OPT-IN extra — Lean's own binder order is
      // the default — so the item wears the emphasis when the split is SET.
      on: hypGroup,
      onAlt: () => onHypModeChange(HYP_MODES[hypMode].next),
    },
    {
      id: "comments",
      prefix: "Comments:",
      glyph: (
        <GlyphBox>
          <Codicon name={COMMENT_MODES[commentMode].icon} />
        </GlyphBox>
      ),
      value: commentName,
      values: Object.values(COMMENT_MODES).map((m) => m.name),
      title: `Comments: ${commentName} — how a tactic's prose is drawn: as strips above the box, hidden, standing in for the tactic's own text, or generated from the step itself (\u2234) where the author wrote none. ⌥-click: next mode`,
      onAlt: () => onCommentModeChange(COMMENT_MODES[commentMode].next),
    },
    // READING, the last of the LEFT group: how much of each node you are asked
    // to read, named for what it opens (`Reading ▾`), then `Reading`, then the
    // eye alone. It is a menu and not a setting, so it has no value — `words`
    // stands in for the two word forms.
    {
      id: "reading",
      prefix: "Reading",
      glyph: (
        <GlyphBox>
          <Codicon name="eye" />
        </GlyphBox>
      ),
      words: {
        full: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
            Reading
            <Codicon name="chevron-down" />
          </span>
        ),
        value: "Reading",
      },
      value: "",
      values: [],
      title: `Reading options: ${readingNames.length > 0 ? readingNames.join(" · ") : "all off"} — click to change`,
      // In the emphasis ink while any reading option is on; the tip names
      // which.
      on: readingNames.length > 0,
    },
    // THE MARKS, last in the ladder and so the first to compact at each
    // stage — it is the newest and the most transient of the five, and the
    // two chevrons beside it keep working in every form. It is the LEFT END
    // of the right group (so its arrival moves nothing: that group is anchored
    // on the strip's right edge). Present only where the proof has marks
    // (`hasMarks`).
    ...(!hasMarks ? [] : [{
      id: "tour",
      prefix: "Marks:",
      glyph: (
        <GlyphBox>
          <Codicon name="bookmark" />
        </GlyphBox>
      ),
      value: tourValue,
      // Every value it could show: the widest is what the row reserves, so
      // stepping from 2/5 to 3/5 moves nothing to its right.
      values: ["–/99", "99/99", "off"],
      // The OFF value dims, exactly as `Width: full` does, instead of
      // reading as a place in a reading that is not happening.
      dim: marksOff,
      // Every title opens `Marks: <value> — `, so the name the VALUE form
      // drops is the first thing its tip says.
      title: marksOff
        ? "Marks: off — both lists are off; click for the lists. ⌥-click: next list"
        : tourAt === null
          ? `Marks: ${tourValue} — an ordered reading of the proof, not started: ${authorCount} source mark${
              authorCount === 1 ? "" : "s"
            } (\`.mark\` in the source), ${myCount} temporary (the corner nub drops one, kept for this session); \`<\` and \`>\` start it. Click for the two lists. ⌥-click: next list`
          : `Marks: ${tourValue} — \`<\` and \`>\` step, Esc lets go of the current mark. Click for the two lists. ⌥-click: next list`,
      // NO EMPHASIS (user direction): the marks are a READING, not a
      // mode that is on, and the value already says how far into it you are
      // and, as `off`, whether the lists are in.
      after: (
        <>
          <BarButton
            // The pager's codicon chevrons, in the same fixed glyph box as
            // every other mark, so nothing the row measured moves.
            label={
              <GlyphBox>
                <Codicon name="chevron-left" />
              </GlyphBox>
            }
            title={
              tourCount === 0
                ? "Previous mark (`<`) — no marks in the lists that are on"
                : "Previous mark (`<`)"
            }
            disabled={tourCount === 0}
            onClick={() => onTourStep(-1)}
          />
          <BarButton
            label={
              <GlyphBox>
                <Codicon name="chevron-right" />
              </GlyphBox>
            }
            title={
              tourCount === 0
                ? "Next mark (`>`) — no marks in the lists that are on"
                : "Next mark (`>`)"
            }
            disabled={tourCount === 0}
            onClick={() => onTourStep(1)}
          />
        </>
      ),
      onAlt: onTourCycle,
    } satisfies BarValueItem]),
  ];

  /* A ROW NEVER WRAPS ITS ITEMS, NEVER LOSES ONE AND NEVER JUMPS FROM WORDS TO
  GLYPHS ALL AT ONCE. Clipping (`overflow: hidden` alone) silently dropped
  everything past `Comments` at a 432px frame; free wrapping grew rows over the
  tree; one boolean made every word vanish on the same pixel (the "abrupt
  transition"). The band's one SECOND ROW (2026-10-04) is a placement, not a
  wrap: the whole left group moves above the button row, and the frame gives
  that row up, so it is never over the tree.

  So compaction is PER ITEM, in THREE FORMS and TWO STAGES (2026-09-24):
  `Layout: outline` → `outline` → the glyph. Every item gives up its NAME
  before ANY item gives up its words — the name is what the tip says first,
  the value is what the reader came for — and within each stage it runs RIGHT
  TO LEFT (Marks, Reading, Comments, Context, Layout). `names` is how many LEADING
  items keep `Name: value`, `words` how many keep a word at all (`names ≤
  words`); the ladder walks `names` down to 0 first, then `words`. At half an
  infoview the row reads `outline · used · show` rather than two words and a
  run of icons (the reported "symbol-slop"). Only `?` is always a glyph.

  It is MEASURED, never guessed from a breakpoint, off a hidden GHOST of all
  three forms of every item, keyed by the item's id:

    chromeW   the full form with an EMPTY value — padding, name, gap, i.e.
              everything the value is not
    bareW     the value form with an EMPTY value — the padding alone
    resv      the widest that item's value could ever be, over EVERY value
              it can take (`outline` vs `tracks`, `intro`, `narrate`, `–/99`; none for Reading)
    glyphW    the glyph form
    helpW     `?`

  `resv` is also what the real row RESERVES for each value in BOTH word forms,
  so a value item never changes width when its value changes: `used` → `intro`
  moves nothing to its right, and `▸` → `λ` cannot move anything either (the
  glyph box is a fixed width).

  It CANNOT OSCILLATE: every measured width is independent of the stage (the
  chrome ghosts carry no value, the glyph boxes are fixed, `resv` is over the
  whole value set), and the room comes from the FRAME, not from the strip's own
  content — so neither input moves when the output flips. No hysteresis. */
  const [stage, setStage] = useState<{ names: number; words: number }>({
    names: 99,
    words: 99,
  });
  /* THE BAND'S GEOMETRY, decided in `fit` from the FRAME, the GHOST and the
  HOST BUTTON alone — never from the band's own drawn box — so it can no more
  oscillate than the stage can. `slot` is the width punched out at the right
  end for the host button (0 where there is none), `rowH` the button row's
  height (`BAR_H` without a button), and `twoRows` the one fallback: where
  even the all-glyph row cannot fit beside the slot, the LEFT group moves to a
  second row ABOVE the button row — the band grows by `BAR_H` and the frame
  gives that up, rather than the bar lifting into the tree. */
  const [geom, setGeom] = useState<{ slot: number; rowH: number; twoRows: boolean }>({
    slot: 0,
    rowH: BAR_H,
    twoRows: false,
  });
  useHostButtonRule();
  // Reached through a ref so `fit` (a stable callback) need not re-create
  // on every render of the parent; written in an effect, never in render.
  const onPlaceRef = useRef(onPlace);
  useEffect(() => {
    onPlaceRef.current = onPlace;
  });
  const [resv, setResv] = useState<Readonly<Record<string, number>>>({});
  const cardRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [diagCompact, setDiagCompact] = useState(false);
  // Whether the status readout is drawn. Decided in `fit` from the ghost and
  // the frame alone, like the stage.
  const [statusForm, setStatusForm] = useState<0 | 1 | 2>(0);
  const fit = useCallback(() => {
    const card = cardRef.current;
    const ghost = ghostRef.current;
    if (!card || !ghost) return;
    // A measurement with no boxes is declined for the reason `useFrameOffset`
    // declines one: a 0 there is the ABSENCE of an answer, not a width.
    if (card.getClientRects().length === 0) return;
    // The band spans the FRAME (its `offsetParent`), so its width is a fact
    // about the frame.
    const host = card.offsetParent as HTMLElement | null;
    if (!host) return;
    const frame = host.clientWidth;
    const fr = host.getBoundingClientRect();

    /* THE HOLE PUNCH. The host button is MEASURED: where one stands over the
    frame's bottom-right corner, the slot runs from its left edge to the
    frame's right plus a gap, and the button row is the frame's bottom to the
    button's top plus `BAND_PAD` — 2 + 26 + 2 once `HOST_BUTTON_CSS` has set
    it 2px in; 38 if a host ever kept it at 10 (the band still surrounds it).
    Read in the frame's own px (the rect over the frame's scale), so a CSS
    zoom on an ancestor does not change the answer. */
    let slot = 0;
    let rowH = BAR_H;
    const btn = hostButton();
    if (btn && fr.width > 0) {
      const k = frame / fr.width;
      let b = btn.getBoundingClientRect();
      const overCorner =
        b.width > 0 &&
        b.right > fr.left &&
        b.left < fr.right &&
        b.bottom > fr.bottom - 4 * BAR_H &&
        b.top < fr.bottom;
      if (overCorner) {
        placeHostButton(btn, fr);
        b = btn.getBoundingClientRect();
        slot = Math.ceil((fr.right - b.left) * k) + BAND_SLOT_GAP;
        rowH = Math.max(BAR_H, Math.ceil((fr.bottom - b.top) * k) + BAND_PAD);
      }
    }

    const chrome = 2 * STATUS_PAD_X;
    // Beside the slot, and (the second row) the whole frame.
    const lane = frame - slot - chrome;
    const full = frame - chrome;
    if (full <= 0) return;

    const pick = (k: string) =>
      Array.from(ghost.querySelectorAll<HTMLElement>(`[data-g="${k}"]`));
    const wide = (els: HTMLElement[]) =>
      els.reduce((m, el) => Math.max(m, el.getBoundingClientRect().width), 0);
    // The items in ROW ORDER, read off the ghost rather than closed over:
    // `fit` is a stable callback, and the Marks item comes and goes.
    const ids = pick("order").map((el) => el.dataset.id ?? "");
    const n = ids.length;
    const chromeW = ids.map((id) => wide(pick(`c:${id}`)));
    const bareW = ids.map((id) => wide(pick(`b:${id}`)));
    const glyphW = ids.map((id) => wide(pick(`g:${id}`)));
    const resvW = ids.map((id) => Math.ceil(wide(pick(`v:${id}`))));
    const helpW = wide(pick("help"));
    if (helpW <= 0) return;
    // The diagnostics COUNT item, where there is one: its ghost is the very
    // element the row draws, so what is measured is what is painted.
    const diagFull = wide(pick("d"));
    const diagShort = wide(pick("dc"));
    // The status readout at its ACTUAL width, in its two forms (with and
    // without the name); 0 where there is none.
    const statusW = wide(pick("status"));
    // The short form exists only where the readout carries a name (no
    // signature header); without one the readout IS its short form.
    const statusShortW = wide(pick("status-short")) || statusW;

    setResv((prev) =>
      Object.keys(prev).length === n &&
      ids.every((id, i) => prev[id] === resvW[i])
        ? prev
        : Object.fromEntries(ids.map((id, i) => [id, resvW[i]])),
    );

    // Item `i`'s width at a stage: its first `names` items wear the full form
    // (`Layout: outline`), the next up to `words` the value alone, the rest
    // the glyph.
    const itemW = (i: number, names: number, words: number) =>
      i < names
        ? chromeW[i] + resvW[i]
        : i < words
          ? bareW[i] + resvW[i]
          : glyphW[i];
    // A flex row of these parts, one STATUS_GAP between neighbours.
    const rowW = (parts: number[]) =>
      parts.length === 0
        ? 0
        : parts.reduce((a, b) => a + b, 0) + (parts.length - 1) * STATUS_GAP;
    /* TWO GROUPS, one gap between them and NO DIVIDERS (VS Code's status bar
    has none; the slack between the groups is the grouping). LEFT: the value
    items and Reading. RIGHT: the readout, the marks (when there are any), the
    diagnostics count (when there is one) and `?`. Marks is the LAST item of
    the ladder (it sheds first) and the left end of the right group. */
    const tIdx = ids.indexOf("tour");
    const groups = (names: number, words: number, dw: number, sw = 0) => {
      const left: number[] = [];
      ids.forEach((_, i) => {
        if (i !== tIdx) left.push(itemW(i, names, words));
      });
      const right: number[] = [];
      // The readout, where it is shown, is the LEFT END of the right group.
      if (sw > 0) right.push(sw);
      if (tIdx >= 0) right.push(itemW(tIdx, names, words));
      if (dw > 0) right.push(dw);
      right.push(helpW);
      return { l: rowW(left), r: rowW(right) };
    };
    // Whether a stage fits: ONE row — both groups beside the slot, at least
    // `BAR_GROUP_GAP` apart — or, in the second-row placement, the left group
    // across the whole frame and the right group beside the slot.
    const fitsWith = (two: boolean, names: number, words: number, dw: number, sw = 0) => {
      const g = groups(names, words, dw, sw);
      return two ? g.l <= full && g.r <= lane : g.l + g.r + BAR_GROUP_GAP <= lane;
    };
    /* ONE ROW while the all-glyph floor fits beside the slot; else the SECOND
    ROW. The test is the floor, from the ghost and the frame alone. */
    const twoRows = !fitsWith(false, 0, 0, diagShort);
    // The diagnostics COUNT compacts LAST: every value item goes to its glyph
    // before the per-severity counts fold into the worst glyph and a total.
    const diagCompact = diagFull > 0 && !fitsWith(twoRows, 0, 0, diagFull);
    setDiagCompact(diagCompact);
    const dw = diagCompact ? diagShort : diagFull;

    // The ladder, most words first: every name goes (right to left) before
    // any word does (right to left). Stage `n` is the all-value row; `2n`
    // the all-glyph floor, taken whether or not it fits.
    const at = (st: number) =>
      st <= n ? { names: n - st, words: n } : { names: 0, words: 2 * n - st };
    // The readout the ladder makes room for: the full one where even the floor
    // holds it, else the nameless one, else none — a readout that cannot fit
    // at all must not walk the settings down to glyphs for nothing (on the
    // second row it would have stripped the LEFT group for the right's sake).
    const swLadder = fitsWith(twoRows, 0, 0, dw, statusW)
      ? statusW
      : statusShortW > 0 && fitsWith(twoRows, 0, 0, dw, statusShortW)
        ? statusShortW
        : 0;
    let st = 0;
    while (st < 2 * n && !fitsWith(twoRows, at(st).names, at(st).words, dw, swLadder))
      st++;
    const got = at(st);
    setStage((prev) =>
      prev.names === got.names && prev.words === got.words ? prev : got,
    );
    /* THE STATUS READOUT IS THE LAST ITEM TO GO. It is state, not a setting,
    so it keeps its place until the settings have compacted as far as they
    go: the ladder above is walked with the readout at its full ACTUAL width,
    and only where even the all-glyph floor cannot hold it does it shed its
    name (where it has one), then go to nothing. */
    const fits = (sw: number) =>
      sw > 0 && fitsWith(twoRows, got.names, got.words, dw, sw);
    setStatusForm(fits(statusW) ? 2 : fits(statusShortW) ? 1 : 0);
    setGeom((prev) =>
      prev.slot === slot && prev.rowH === rowH && prev.twoRows === twoRows
        ? prev
        : { slot, rowH, twoRows },
    );
    /* What the view needs: the band's height (the frame gives it up) and the
    open message strip's, which floats above the band across the frame and
    which the rail climbs over. Its height is read off its drawn box: it wraps
    with the frame, and `fit` runs on every render and every resize. */
    const stripH = stripRef.current?.offsetHeight ?? 0;
    onPlaceRef.current({
      band: rowH + (twoRows ? BAR_H : 0) + BAND_BORDER,
      strip: stripH > 0 ? stripH + DIAG_STRIP_GAP : 0,
    });
  }, []);

  // After EVERY render, because a setting's own label changes width…
  useLayoutEffect(fit);

  // …and when the frame resizes without a render of ours, or the host button
  // does (its label's font arrives late).
  useEffect(() => {
    const card = cardRef.current;
    const host = card?.offsetParent as HTMLElement | null;
    if (!card) return;
    const ro = new ResizeObserver(fit);
    ro.observe(host ?? card);
    const btn = hostButton();
    if (btn) ro.observe(btn);
    return () => ro.disconnect();
  }, [fit]);

  // One value item. `form` picks the form; `value` overrides what it shows
  // (the ghost's chrome copies pass the empty string, so what they measure is
  // everything BUT the value, the value span still there to carry its gap).
  const valueMenu = (it: BarValueItem, form: BarForm, value?: string) => {
    const shown = value ?? it.value;
    const valueSpan = (
      <span
        style={{
          display: "inline-block",
          // The VALUE form centres its text in the reserved width (a left-set
          // `–/2` in a box sized for `99/99` read as off-centre, 2026-09-24).
          // The full form keeps the value left-set against its name —
          // `Layout: outline` is one phrase.
          textAlign: form === "value" ? "center" : "left",
          width: value === "" ? 0 : resv[it.id] || undefined,
          opacity: it.dim ? DIM_OPACITY : 1,
          // Something in its panel is ON: the value wears the band's emphasis
          // ink (it replaced the dot, 2026-10-04). Paint only.
          color: it.on ? STATUSBAR_ON : undefined,
        }}
      >
        {shown}
      </span>
    );
    const menu = (
      <BarMenu
        key={it.id}
        label={
          it.words ? (
            // A menu with no value (Reading): the whole label is what wears
            // the emphasis.
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                color: it.on ? STATUSBAR_ON : undefined,
              }}
            >
              {form === "full"
                ? it.words.full
                : form === "value"
                  ? it.words.value
                  : it.glyph}
            </span>
          ) : form === "full" ? (
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              {it.prefix}
              {valueSpan}
            </span>
          ) : form === "value" ? (
            valueSpan
          ) : (
            <span
              style={{
                display: "inline-flex",
                color: it.on ? STATUSBAR_ON : undefined,
              }}
            >
              {it.glyph}
            </span>
          )
        }
        title={it.title}
        // LIT WHILE ITS PANEL IS OPEN (2026-09-22), as `?` always was: the
        // item the panel hangs from says so — and nothing else lights it.
        accent={barOpen === it.id}
        open={barOpen === it.id}
        onToggle={(x) => toggle(it.id, x)}
        onAlt={it.onAlt}
      />
    );
    if (!it.after) return menu;
    return (
      <span
        key={it.id}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: STATUS_GAP,
        }}
      >
        {menu}
        {it.after}
      </span>
    );
  };

  // The reference is not a feature, it is the index of them — so it rides the
  // bar's own end rather than a rail slot of its own. It is declared apart
  // only because it sits after the diagnostics block in the right group; the
  // GHOST measures it on its own (`helpW`).
  const helpBtn = (
    <BarButton
      label={
        <GlyphBox>
          <Codicon name="question" />
        </GlyphBox>
      }
      title="What you can do here (?)"
      accent={helpOpen}
      popup="dialog"
      expanded={helpOpen}
      onClick={() => onHelpOpenChange(!helpOpen)}
    />
  );

  // The ladder's index of an item decides its form; the DRAW order is the two
  // groups. LEFT: the settings, Reading. RIGHT: the readout, Marks, the
  // count, `?`.
  const formOf = (i: number): BarForm =>
    i < stage.names ? "full" : i < stage.words ? "value" : "glyph";
  const drawItem = (id: string) => {
    const i = valueItems.findIndex((it) => it.id === id);
    return i < 0 ? null : valueMenu(valueItems[i], formOf(i));
  };

  const leftGroup = (
    <>
      {drawItem("layout")}
      {drawItem("context")}
      {drawItem("comments")}
      {drawItem("reading")}
    </>
  );

  return (
    // THE STATUS BAND (2026-10-04): VS Code's status bar, docked on the
    // frame's bottom edge, edge to edge, opaque, one top border, no radius,
    // no shadow. The tree's frame ends above it (the view gives up `band`),
    // so nothing paints under it. Its right end is a SLOT for the host's
    // "Restart File" button, which sits set into the band.
    <div
      ref={cardRef}
      data-ptw-band=""
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: geom.rowH + (geom.twoRows ? BAR_H : 0) + BAND_BORDER,
        zIndex: Z.chrome,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        fontFamily: CHROME_FONT,
        fontSize: CHROME_TEXT,
        lineHeight: 1,
        whiteSpace: "nowrap",
        // Figures at one width, as VS Code's status bar draws them: a count
        // ticking over moves nothing beside it.
        fontVariantNumeric: "tabular-nums",
        background: STATUSBAR_BG,
        borderTop: `${BAND_BORDER}px solid ${STATUSBAR_BORDER}`,
        color: STATUSBAR_FG,
        textAlign: "left",
        cursor: "default",
      }}
    >
      {/* THE SECOND ROW, above the button row, only where the all-glyph row
          cannot fit beside the slot: the left group across the whole band. */}
      {geom.twoRows && (
        <div style={{ ...ROW_STYLE, height: BAR_H, padding: `0 ${STATUS_PAD_X}px` }}>
          <div style={GROUP_STYLE}>{leftGroup}</div>
        </div>
      )}
      <div
        style={{
          ...ROW_STYLE,
          height: geom.rowH,
          // The slot: the host button stands in the band's last `slot` px.
          padding: `0 ${STATUS_PAD_X + geom.slot}px 0 ${STATUS_PAD_X}px`,
        }}
      >
        {/* LEFT, left-aligned: how the tree is drawn, then what you are asked
            to read (on the second row instead, where there is one). */}
        {!geom.twoRows && <div style={GROUP_STYLE}>{leftGroup}</div>}

        {/* RIGHT, right-aligned and so FLUSH against the host's button
            whatever the left group carries: the readout and the marks at its
            left end (their arrival moves nothing), the count, `?`. */}
        <div style={{ ...GROUP_STYLE, marginLeft: "auto" }}>
          {statusForm > 0 && status && (
            <StatusReadout info={statusForm === 2 ? status : { ...status, name: "" }} />
          )}
          {drawItem("tour")}
          {diag && (
            <div style={{ flex: "none" }}>
              <DiagCountItem {...diag} compact={diagCompact} />
            </div>
          )}
          {helpBtn}
        </div>
      </div>

      {/* The measurement, not a second bar: laid out at its natural width,
          painted nowhere, and out of the tab order. */}
      <div
        ref={ghostRef}
        aria-hidden
        inert
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "max-content",
          display: "flex",
          flexWrap: "nowrap",
          alignItems: "center",
          gap: STATUS_GAP,
          visibility: "hidden",
          pointerEvents: "none",
        }}
      >
        {/* The items in ROW ORDER, for `fit` to read (it is a stable
            callback, and the Marks item comes and goes). */}
        {valueItems.map((it) => (
          <span key={`o:${it.id}`} data-g="order" data-id={it.id} />
        ))}
        {/* Every item's CHROME in both word forms — `Name: value` and the
            value alone, each with the value emptied out, so what they
            measure is padding (and name, and gap). */}
        {valueItems.map((it) => (
          <span key={`c:${it.id}`} data-g={`c:${it.id}`}>
            {valueMenu(it, "full", "")}
          </span>
        ))}
        {valueItems.map((it) => (
          <span key={`b:${it.id}`} data-g={`b:${it.id}`}>
            {valueMenu(it, "value", "")}
          </span>
        ))}
        {/* …and its glyph form. */}
        {valueItems.map((it) => (
          <span key={`g:${it.id}`} data-g={`g:${it.id}`}>
            {valueMenu(it, "glyph")}
          </span>
        ))}
        {/* Every value each item could show, bare: the widest is what the
            real row RESERVES, so changing a setting moves nothing. */}
        {valueItems.flatMap((it) =>
          it.values.map((v) => (
            <span key={`v:${it.id}-${v}`} data-g={`v:${it.id}`}>
              {v}
            </span>
          )),
        )}
        {/* `?` on its own: `fit` lays the two groups out itself, counting
            the gaps. */}
        <span data-g="help" style={{ display: "inline-flex" }}>
          {helpBtn}
        </span>
        {/* The status readout as it will be drawn, in both forms: its actual
            text, so the strip never reserves more than it shows. */}
        {status && (
          <>
            <span data-g="status" style={{ display: "inline-flex" }}>
              <StatusReadout info={status} />
            </span>
            {status.name && (
              <span data-g="status-short" style={{ display: "inline-flex" }}>
                <StatusReadout info={{ ...status, name: "" }} />
              </span>
            )}
          </>
        )}
        {/* The diagnostics count item, measured on its own: it is present
            only while the proof has problems. */}
        {diag && (
          <>
            <span data-g="d" style={{ display: "inline-flex" }}>
              <DiagCountItem {...diag} />
            </span>
            <span data-g="dc" style={{ display: "inline-flex" }}>
              <DiagCountItem {...diag} compact />
            </span>
          </>
        )}
      </div>

      {diag?.open && <DiagStrip {...diag} stripRef={stripRef} />}

      {helpOpen && (
        <HelpPanel
          caps={caps}
          fontFamily={fontFamily}
          onClose={() => onHelpOpenChange(false)}
          // Starts at the strip's left edge; HelpPanel then hangs it from
          // the `?` item's RIGHT edge (a layout effect, clamped in the frame).
          anchor={{ left: 0, bottom: "100%", marginBottom: 4 }}
        />
      )}

      {barOpen === "layout" && (
        <BarPanel left={menuX} label="Layout" onClose={close}>
          {(Object.keys(LAYOUT_MODES) as LayoutMode[]).map((m) => (
            <BarRow
              key={m}
              label={LAYOUT_MODES[m].name}
              title={LAYOUT_MODES[m].title}
              on={layout === m}
              // Each mode wears its bar glyph, in a fixed box so the words
              // align.
              icon={<Codicon name={LAYOUT_MODES[m].icon} />}
              onClick={() => {
                onLayoutChange(m);
                close();
              }}
            />
          ))}
          <MenuDivider />
          {/* Below the divider the rows are TOGGLES, not a choice, so they
              leave the popover open — you may want both. */}
          <BarRow
            kind="toggle"
            label="side-by-side"
            title={
              sbsEnabled
                ? "Draw a split's subtrees as columns"
                : "Side-by-side needs a compact layout; the wide tree lays branches out itself"
            }
            on={sbsEnabled && sideBySide}
            icon={<Codicon name="split-horizontal" />}
            disabled={!sbsEnabled}
            onClick={() => onSideBySideChange(!sideBySide)}
          />
          <BarRow
            kind="toggle"
            label="gallery"
            title="Show one subtree at a time, with a pager"
            on={gallery}
            icon={<Codicon name="window" />}
            onClick={() => onGalleryChange(!gallery)}
          />
          <BarRow
            kind="toggle"
            label="classic look"
            title="Draw the tree and its chrome in Ramify's classic skin (the ramify.appearance setting is the default; this row overrides it for the session)"
            on={classic}
            icon={null}
            onClick={() => onClassicChange(!classic)}
          />
          <MenuDivider />
          {/* RESET TREE, a lone action (it leaves the panel up; the
              toast's Undo brings the view back). Expand all and Collapse to
              the outline were a row of buttons here while they hid on the
              rail's ⌥; they are the rail's own buttons now (2026-10-04). */}
          <BarRow
            kind="action"
            label="Reset tree"
            icon={null}
            title="Reset tree — put the view back to what the source asks for: folds and skips from its flags, no scoping, no temporary marks (Undo in the toast brings the view back)"
            onClick={onReset}
          />
          <MenuDivider />
          {/* THE WIDTH, which was a bar item of its own until 2026-09-24 —
              a setting about how the layout wraps, so it lives with the
              layout. Same slider, same `Width: …` toast (`applyReflow`), and
              the tracks seam still drags it; the item's third slot is lit
              while labels wrap narrower than full. */}
          <div
            role="menuitem"
            data-ptw-slider=""
            aria-label="Width — wrap labels and context lines at this many columns"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "3px 6px",
              whiteSpace: "nowrap",
            }}
          >
            <span aria-hidden style={{ flex: `0 0 ${ROW_ICON_W}px` }} />
            <span
              aria-hidden
              style={{
                flex: `0 0 ${ROW_ICON_W}px`,
                alignSelf: "center",
                display: "inline-flex",
                justifyContent: "center",
              }}
            >
              <Codicon name="word-wrap" />
            </span>
            <span>width</span>
            <input
              type="range"
              min={REFLOW_MIN_CHARS}
              max={reflowMax}
              step={1}
              value={reflowCols}
              {...tip.props(
                forcedReflow
                  ? `Width: ${forcedReflow} col — wrap at ${forcedReflow} columns, required by the tracks layout`
                  : "Width — wrap labels and context lines at this many columns (right end = full width)",
              )}
              onChange={(e) =>
                onReflowChange(stopToReflow(Number(e.target.value)))
              }
              style={{
                flex: "1 1 auto",
                minWidth: 60,
                margin: 0,
                accentColor: CHROME_INK,
              }}
            />
            <span
              style={{
                flex: "0 0 42px",
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
                opacity: effReflow === "off" || forcedReflow ? DIM_OPACITY : 1,
              }}
            >
              {effReflow === "off" ? "full" : `${effReflow} col`}
            </span>
          </div>
        </BarPanel>
      )}

      {barOpen === "context" && (
        <BarPanel left={menuX} label="Context" onClose={close}>
          {(Object.keys(HYP_MODES) as HypMode[]).map((m) => (
            <BarRow
              key={m}
              label={HYP_MODES[m].name}
              title={HYP_MODES[m].title}
              on={hypMode === m}
              onClick={() => {
                onHypModeChange(m);
                close();
              }}
            />
          ))}
          <MenuDivider />
          <BarRow
            kind="toggle"
            label="split data & props"
            title="Draw each goal's context as data first, then propositions, with a divider (default: Lean's own binder order)"
            on={hypGroup}
            onClick={() => onHypGroupChange(!hypGroup)}
          />
        </BarPanel>
      )}

      {barOpen === "comments" && (
        <BarPanel left={menuX} label="Comments" onClose={close}>
          {(Object.keys(COMMENT_MODES) as CommentMode[]).map((v) => (
            <BarRow
              key={v}
              label={COMMENT_MODES[v].name}
              title={COMMENT_MODES[v].title}
              on={commentMode === v}
              onClick={() => {
                onCommentModeChange(v);
                close();
              }}
            />
          ))}
        </BarPanel>
      )}

      {/* Gated on the item too: removing the last mark (⌥-click on its tab)
          with this panel up takes the item away, and the panel with it. */}
      {barOpen === "tour" && hasMarks && (
        <BarPanel left={menuX} label="Marks" onClose={close}>
          {/* TWO TOGGLES, not a choice among three: each says whether that
              set is IN the reading, and the reading is their union. Toggles,
              so the rows leave the panel open; with both off the bar item
              reads `off` and the chevrons grey. */}
          <BarRow
            kind="toggle"
            label={`source (${authorCount})`}
            title="The marks the file carries as `.mark` — bare, or `.mark 3` for an explicit rank. ⌥-click the Marks item cycles the lists (both → source → temp → none)"
            on={tourLists.source}
            onClick={() => onTourListToggle("source")}
          />
          <BarRow
            kind="toggle"
            label={`temporary (${myCount})`}
            title="The marks dropped from a box's top-left nub, in source order; kept for this session only — ⌥-click on the nub writes one into the source"
            on={tourLists.temp}
            onClick={() => onTourListToggle("temp")}
          />
          <MenuDivider />
          {/* An ACTION row: it leaves the panel up, and greys at none. */}
          <BarRow
            kind="action"
            label={`Clear temporary marks (${myCount})`}
            title="Take every temporary mark off — the source's `.mark`s stay; Undo in the toast brings them back"
            disabled={myCount === 0}
            onClick={onTourClearMine}
          />
        </BarPanel>
      )}

      {barOpen === "reading" && (
        <BarPanel left={menuX} label="Reading options" onClose={close}>
          {/* Toggles, so every row leaves the panel open. The rows are
              experience.ts's `READING_OPTIONS`, in its order. `brief`'s hover
              drives the in-place underline preview of what it would elide.
              `polish` mirrors `ramify.narration.polish` for THIS session (the
              setting is the default, the row the override) and is NOT DRAWN
              where there is no companion, no key or the setting is off
              (2026-09-22, "hide the API key-necessary stuff"; the panel's
              height is its rows', so a hidden row leaves no gap). */}
          {READING_OPTIONS.map((o) => (
            <Fragment key={o.id}>
              {(o.id !== "polish" || polishShown) && (
                <BarRow
                  kind="toggle"
                  label={o.label}
                  title={
                    o.id === "polish"
                      ? polishWhy
                      : o.id === "upToCursor" && !upToEnabled
                        ? "Up to cursor needs the editor cursor"
                        : o.title
                  }
                  on={reading[o.id]}
                  disabled={o.id === "upToCursor" && !upToEnabled}
                  onHover={o.id === "brief" ? onBriefHover : undefined}
                  onClick={() => onReadingChange(o.id, !reading[o.id])}
                />
              )}
              {/* D6. An ACTION, not a setting: it asks once, on the proof in
                  front of you, and the answer is a proposal pill on a node —
                  the same pill, the same `checkRewrite` gate, the same undo.
                  Hidden under the same rule as `polish`. */}
              {o.id === "polish" && proposeShown && (
                <BarRow
                  kind="action"
                  label={proposeBusy ? "Suggesting…" : "Suggest a rewrite"}
                  title="Ask for one of the rewrites already offered on this proof, with a reason — the elaborator still has the last word"
                  disabled={proposeBusy}
                  onClick={onPropose}
                />
              )}
            </Fragment>
          ))}
        </BarPanel>
      )}
    </div>
  );
}
