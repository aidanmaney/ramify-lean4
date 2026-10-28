// The status bar's vocabulary: the words, glyphs and ⌥-cycles for the context, layout and
// comment settings, and the reflow slider's stop coding. Read by the bar, its toasts and the view.
import { ICON } from "./icons";
import { REFLOW_MAX_CHARS } from "./layout";
import type { ReflowMode } from "./layout";
import { type HypMode } from "./proofToTree";
import { type CodiconName } from "./codicon";

// The bar says every setting in WORDS: `[filter] used`, and `used · intro ·
// diff · all` in the popover. Words are the bar's own vocabulary: a reader who
// has to be told what Γ means is being charged for the abbreviation twice.
// Where the row is too narrow for the words, an item drops to its band icon
// (see StatusBar's `fit`); `icon` below is the PANEL row's codicon. (Context's
// text glyphs `▸ λ Δ ∀` were the classic look's compact form, removed with it
// 2026-10-28.)
//
// `next` is the ⌥-CLICK cycle: plain click opens the list, ⌥-click advances to
// the next value through the same toasting wrapper. One coding, read by the
// label, the popover row and the toast alike.
export const HYP_MODES: Record<
  HypMode,
  {
    name: string;
    /** The Context panel row's icon (icons.ts `context.*`). */
    icon: CodiconName;
    next: HypMode;
    title: string;
  }
> = {
  used: {
    name: "used",
    icon: ICON["context.used"],
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
    icon: ICON["context.intro"],
    next: "delta",
    title:
      "Context: intro — only hypotheses the preceding tactic introduced as a binding",
  },
  delta: {
    name: "diff",
    icon: ICON["context.diff"],
    next: "full",
    title: "Context: diff — hypotheses this goal introduced, plus any its tactic uses",
  },
  full: {
    name: "all",
    icon: ICON["context.all"],
    next: "used",
    title: "Context: all — every hypothesis in scope",
  },
};

export type LayoutMode = "stacked" | "spine" | "tracks" | "wide";

export const LAYOUT_MODES: Record<
  LayoutMode,
  {
    name: string;
    /** The Layout panel row's icon. */
    icon: CodiconName;
    next: LayoutMode;
    title: string;
  }
> = {
  stacked: {
    name: "outline",
    icon: ICON["layout.outline"],
    next: "spine",
    title:
      "Layout: outline — a compact outline, every node on its own line off a left trunk",
  },
  spine: {
    name: "spine",
    icon: ICON["layout.spine"],
    next: "tracks",
    title:
      "Layout: spine — a goal spine: two tracks, goals stacked tight on the left and each tactic beside its step in a right-hand track",
  },
  tracks: {
    name: "tracks",
    // `layout` is a tall column beside a track of small boxes — goals,
    // then tactics.
    icon: ICON["layout.tracks"],
    next: "wide",
    title:
      "Layout: tracks — aligned tracks: the spine with goals wrapped to a modest width, so every tactic starts at the same x and the two tracks read as columns",
  },
  wide: {
    name: "wide",
    icon: ICON["layout.wide"],
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
export const COMMENT_MODES: Record<
  CommentMode,
  { name: string; icon: CodiconName; next: CommentMode; title: string }
> = {
  shown: {
    name: "show",
    icon: ICON["comments.show"],
    next: "hidden",
    title: "Comments: show — comments drawn as strips above the box",
  },
  hidden: {
    name: "hide",
    icon: ICON["comments.hide"],
    next: "instead",
    title: "Comments: hide — no comment strips; the room goes back to the tree",
  },
  // `instead` used to print the word "narrate"; C2/C3 took that word for the
  // GENERATED prose, which is what a reader means by it, and gave this mode
  // back the name it has always had in the code — the author's comment
  // standing in INSTEAD of the tactic's own text.
  instead: {
    name: "in place",
    icon: ICON["comments.inPlace"],
    next: "narrate",
    title:
      "Comments: in place — a commented tactic's prose stands in for its label, inside the box",
  },
  narrate: {
    name: "narrate",
    icon: ICON["comments.narrate"],
    next: "shown",
    title:
      "Comments: narrate — strips as above, and where the author wrote none a line generated from the step itself (∴); a folded goal's strip summarises what it hides",
  },
};

export const REFLOW_OFF_STOP = REFLOW_MAX_CHARS + 1;

export const reflowToStop = (m: ReflowMode) => (m === "off" ? REFLOW_OFF_STOP : m);

export const stopToReflow = (v: number): ReflowMode =>
  v >= REFLOW_OFF_STOP ? "off" : v;
