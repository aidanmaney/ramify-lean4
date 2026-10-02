// The status bar's vocabulary: the words, glyphs and ⌥-cycles for the context, layout and
// comment settings, and the reflow slider's stop coding. Read by the bar, its toasts and the view.
import { REFLOW_MAX_CHARS } from "./layout";
import type { ReflowMode } from "./layout";
import { type HypMode } from "./proofToTree";

// The bar says every setting in WORDS: `Context: used ▾`, and `used ·
// intro · diff · all` in the popover. Words are the bar's own vocabulary: a
// reader who has to be told what Γ means is being charged for the abbreviation
// twice.
//
// `glyph` is the COMPACT fallback, and only that. The bar is ONE ROW, always,
// so at a frame too narrow for the words every menu drops to its glyph rather
// than wrapping or losing items off the end (see StatusBar's `fit`). It is
// drawn in the TREE's code font, never the bar's system UI font — measured on
// the raster, at 13px `▸` inks 5px tall against `λ`'s 10, `Δ`'s 9 and `∀`'s 9,
// and in the system font they are worse; the code font is where they were
// designed to sit. Compact is why that second font stack is affordable now:
// there are no words beside them to be out of key with.
//
// `glyphPx` is the rail's own rule — the target is equal INK HEIGHT, not equal
// font size — and these marks need it badly, because they are drawn from
// different corners of Unicode. Re-measured on the raster in the code font,
// `▸` is a small solid triangle inking 6×5 at 13 against `λ`'s 8×10, `Δ`'s
// 8×9 and `∀`'s 8×9, so it alone takes 19 (8×8) and the four then share a
// width of 8 as well as a height.
//
// The four LAYOUT marks were levelled the same way (`☰ ⊦ || ⑃` at 14/14/8/15)
// and have since left Unicode altogether: equal ink height did nothing about
// equal ink WEIGHT, and three of the four drew at half the stroke of every
// other mark in the row. They are drawn SVG now — see `LayoutGlyph`, which
// carries the measurements.
//
// `next` is the ⌥-CLICK cycle: plain click opens the list, ⌥-click advances to
// the next value through the same toasting wrapper. One coding, read by the
// label, the popover row and the toast alike.
export const HYP_MODES: Record<
  HypMode,
  {
    name: string;
    glyph: string;
    glyphPx?: number;
    next: HypMode;
    title: string;
  }
> = {
  used: {
    name: "used",
    glyph: "▸",
    glyphPx: 19,
    next: "new",
    title: "Context: used — only hypotheses the rest of the proof below actually uses",
  },
  new: {
    // `intro`, not `binders`: the item RESERVES the width of its widest
    // value, so the longest word in this set is charged to the row at every
    // setting — and `binders` was the widest label in the whole bar. `intro`
    // is Lean's own word for the move that makes these hypotheses, and it is
    // one character off the other three.
    name: "intro",
    glyph: "λ",
    next: "delta",
    title:
      "Context: intro — only hypotheses the preceding tactic introduced as a binding",
  },
  delta: {
    name: "diff",
    glyph: "Δ",
    next: "full",
    title: "Context: diff — hypotheses this goal introduced, plus any its tactic uses",
  },
  full: {
    name: "all",
    glyph: "∀",
    next: "used",
    title: "Context: all — every hypothesis in scope",
  },
};

export type LayoutMode = "stacked" | "spine" | "tracks" | "wide";

export const LAYOUT_MODES: Record<
  LayoutMode,
  {
    name: string;
    next: LayoutMode;
    title: string;
  }
> = {
  stacked: {
    name: "outline",
    next: "spine",
    title:
      "Layout: outline — a compact outline, every node on its own line off a left trunk",
  },
  spine: {
    name: "spine",
    next: "tracks",
    title:
      "Layout: spine — a goal spine: two tracks, goals stacked tight on the left and each tactic beside its step in a right-hand track",
  },
  tracks: {
    name: "tracks",
    next: "wide",
    title:
      "Layout: tracks — aligned tracks: the spine with goals wrapped to a modest width, so every tactic starts at the same x and the two tracks read as columns",
  },
  wide: {
    name: "wide",
    next: "stacked",
    title:
      "Layout: wide — a wide layered tree, nodes at the same depth share one horizontal band",
  },
};

/** The engine arguments a layout mode stands for (`computeLayout`'s `compact`
 and `aside`; `sideBySide` is the reader's own toggle, not the mode's): wide is
 the only non-compact mode, spine floats a tactic's strip aside and tracks
 does it in aligned columns. One mapping, read by the view and the probes. */
export const layoutArgs = (
  mode: LayoutMode,
): { compact: boolean; aside: boolean | "track" } => ({
  compact: mode !== "wide",
  aside: mode === "tracks" ? "track" : mode === "spine",
});

export type CommentMode = "shown" | "hidden" | "instead" | "narrate";

// One coding of the comment switch's three stops: the word the bar prints and
// the ⌥-cycle's order. StatusBar's own row list keeps its per-row titles, but
// the NAME lives here so bar label and toast cannot drift.
export const COMMENT_MODES: Record<CommentMode, { name: string; next: CommentMode }> =
  {
    shown: { name: "show", next: "hidden" },
    hidden: { name: "hide", next: "instead" },
    // `instead` used to print the word "narrate"; C2/C3 took that word for the
    // GENERATED prose, which is what a reader means by it, and gave this mode
    // back the name it has always had in the code — the author's comment
    // standing in INSTEAD of the tactic's own text.
    instead: { name: "in place", next: "narrate" },
    narrate: { name: "narrate", next: "shown" },
  };

export const REFLOW_OFF_STOP = REFLOW_MAX_CHARS + 1;

export const reflowToStop = (m: ReflowMode) => (m === "off" ? REFLOW_OFF_STOP : m);

export const stopToReflow = (v: number): ReflowMode =>
  v >= REFLOW_OFF_STOP ? "off" : v;
