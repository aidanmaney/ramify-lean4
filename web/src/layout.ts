import { coordSimplex, graphStratify, sugiyama } from "d3-dag";
import type { GraphNode, SugiNode } from "d3-dag";
import type {
  HypLine,
  LayoutNode,
  LedgerRow,
  PlacedLink,
  PlacedNode,
  TreeNode,
  WrappedLine,
} from "./types";
import { isLedgerHead } from "./types";
import type { ProofStepPosition } from "./paperproof";

// Links carry no data of their own: a goal's context now lives inside the goal
// node's own box, not on the edge below it.
type LinkDatum = undefined;

const CHAR_W = 7.2;
// Font family for code text (goal types, tactics, hypothesis labels). The Lean
// infoview webview exposes the EDITOR's font as a CSS variable — it's exactly
// what the infoview's own `.font-code` class uses — so when the variable is
// present, adopt it and the tree matches the source view; otherwise (the
// standalone app, headless layout) fall back to plain monospace.
function resolveCodeFontFamily(): string {
  if (typeof document === "undefined") return "monospace";
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--vscode-editor-font-family")
    .trim();
  return v !== "" ? `${v}, monospace` : "monospace";
}

// The family is MUTABLE state, not a load-time constant: when the user changes
// the editor font, VS Code does NOT reload the webview — it rewrites the CSS
// variables on document.documentElement's style attribute in place (the
// infoview's own components watch that attribute with a MutationObserver for
// exactly this reason). The view does the same (see ProofTreeView) and calls
// refreshCodeFontFamily, which re-resolves and — on an actual change — clears
// the width cache so every engine built afterwards measures in the new family.
// Anything measured in the family must be re-measured after a change: the view
// rebuilds its engine whenever the family it rendered with goes stale.
let codeFontFamily = resolveCodeFontFamily();
const measureCache = new Map<string, number>();
export function getCodeFontFamily(): string {
  return codeFontFamily;
}
export function refreshCodeFontFamily(): string {
  const f = resolveCodeFontFamily();
  if (f !== codeFontFamily) {
    codeFontFamily = f;
    measureCache.clear();
  }
  return f;
}
// Font sizes the render draws labels at; the width measurer below must use the
// same px/family so the reserved box matches the painted glyphs exactly.
// Exported so the render draws at the very sizes the geometry was measured for.
export const NODE_FONT_PX = 12;
export const HYP_FONT_PX = 11;
// Inner padding of a node box. NODE_PAD is the HORIZONTAL text inset (render
// left-insets by the same amount the geometry reserves); NODE_PAD_Y is the
// vertical one, deliberately tighter so a box reads like a line of text with
// a border, not a card.
export const NODE_PAD = 12;
export const NODE_PAD_Y = 5;
// Wrap node labels at a modern ~100-column line before growing the box; the box
// width is still content-driven (MIN_W..MAX_W), this is just the wrap point.
const MAX_CHARS = 100;
// Wrap budget and box cap as PIXELS (not chars): lines are wrapped/broken to fit
// WRAP_W, and the box never exceeds WRAP_W + padding, so a measured line always
// fits its box. Deriving from MAX_CHARS keeps the old ~100-col feel.
const WRAP_W = MAX_CHARS * CHAR_W;
const MAX_W = WRAP_W + 2 * NODE_PAD;
// Reflow mode's budget: a much narrower column, so several branches fit across
// the viewport at once (the point of the mode). Narrow enough to be worth the
// extra height, wide enough that a typical goal still lands in 2-3 lines.
export const REFLOW_CHARS = 44;
// The budget is CONTINUOUS, set in columns by the rail's ¶ slider. It used to
// be two fixed stops (44, and exactly twice that) because a cycling button can
// only offer a handful — but the right column depends on the proof, the
// viewport and how many branches you are trying to get across it, which is a
// judgement only the reader can make. The stops survive as landmarks: 44 is
// still the default (and what "narrow reflow" meant), 88 what "wide" meant.
// Everything else about the mode — the seam tiers, the eager break, the nested
// bracket indent, wrapped hyps — is independent of the number, so widening or
// narrowing moves exactly one thing.
export const REFLOW_MIN_CHARS = 20;
// The top of the range is the ORDINARY budget, so sliding all the way right
// lands on the same label width the tree wraps at with reflow off — the two
// then differ only in reflow's own rules (nested indent, eager breaks, and
// wrapped context lines, which cost their type tooltips). That is what makes
// the slider's far end continuous with `off` rather than a cliff.
export const REFLOW_MAX_CHARS = MAX_CHARS;

/** Off, or a wrap budget in COLUMNS (see the rail's ¶ slider). */
export type ReflowMode = "off" | number;
/** The wrap budget a mode asks for; `off` keeps the ordinary ~100-col one. */
const budgetFor = (m: ReflowMode): number =>
  m === "off"
    ? WRAP_W
    : Math.max(REFLOW_MIN_CHARS, Math.min(REFLOW_MAX_CHARS, m)) * CHAR_W;
const MIN_W = 60;

// Measure rendered text width using the very font the SVG draws with, so the box
// we reserve can't be undersized by a char-count estimate (Lean labels are full
// of wide unicode — ℕ, ∀, ∃ — that a fixed CHAR_W underestimates). Cached by
// font+text; falls back to the estimate when there's no DOM (headless layout).
export const measureText = (() => {
  const ctx =
    typeof document !== "undefined"
      ? document.createElement("canvas").getContext("2d")
      : null;
  // Keys are style+size+text only, no family: a family change clears the
  // whole cache (refreshCodeFontFamily), so stale-family entries can't
  // survive. `italic` exists for comment strips, which render italicized —
  // italics are wider, so the measurer must match the paint.
  return (text: string, fontPx: number, italic = false): number => {
    const key = `${italic ? "i" : ""}${fontPx}:${text}`;
    const hit = measureCache.get(key);
    if (hit !== undefined) return hit;
    const w = ctx
      ? ((ctx.font = `${italic ? "italic " : ""}${fontPx}px ${codeFontFamily}`),
        ctx.measureText(text).width)
      : [...text].length * (fontPx <= HYP_FONT_PX ? HYP_CHAR_W : CHAR_W);
    measureCache.set(key, w);
    return w;
  };
})();

// Shared geometry: sets both a node's box height (in sizeOf) and the tspan line
// spacing in the render, so the two must agree.
export const LINE_H = 16;

// Vertical breathing room INSIDE a goal box between the last context line and
// the `⊢ ` line below it — enough that the two blocks read apart without a
// rule. Shared with the render so the geometry reserved matches what's drawn.
export const HYP_GAP = 6;
// Air between a connector's end and the thing it runs into. Connectors are
// bare lines (no arrowheads), so this stays small — just enough that a line
// doesn't touch a border.
export const ARROW_GAP = 3;
// How far along a connector (from each end) its target-type mark sits — the
// gapped dot/dash that says whether the line terminates at a goal or a tactic
// (see the link render in ProofTreeView). Paint-only: the marks are halos OVER
// the stroke, never a path change, so linkSpans needs no mirror of this.
export const LINK_MARK_OFF = 8;

// Hypothesis (local-context) line geometry, for the block drawn inside a goal
// box. Shared with the render so the room the layout reserves matches what's
// drawn.
const HYP_CHAR_W = 6.6; // headless measureText fallback only
export const HYP_LINE_H = 13;
// Width of the left gutter holding the "used by the consuming tactic" markers;
// reserved only when some line is marked, so unmarked contexts stay tight.
export const HYP_MARK_W = 11;
// Extra leading between a context's DATA group and its PROPOSITIONS group
// (contextFor orders data first and stamps `HypLine.sep` on the first prop
// line of a mixed block). The divider hairline is drawn in this gap; sizeOf
// reserves it and HypBlock offsets by it — the usual measurer/render pair
// that must agree.
export const HYP_SEP_H = 7;

// ---- Compact ("trunk") layout geometry -------------------------------------
// The compact mode lays the proof out as a scrolling outline (Nuprl-style):
// every node gets its own vertical slot (a global y-cursor — no depth bands),
// and branches indent right off a left-most trunk. Left edges align per
// indent; connectors are orthogonal │└▶ elbows dropped from a column just
// inside the parent box's left edge.
export const TRUNK_INDENT = 56; // horizontal shift of a branched-off subtree
// Cap, in character cells, on the EXTRA indent a spawned (nested-by) branch
// gets past TRUNK_INDENT — the extra itself is source-column-derived (see the
// spawnExtra computation in trunkLayout).
const SPAWN_INDENT_MAX = 4;
export const TRUNK_INSET = 16; // connector column, from a box's left edge
// The SPINE variant (the ⊦ layout): TWO side-by-side tracks — goals stack
// down the left track, and each TACTIC box stands in its own track to the
// RIGHT, beside the seam between the goal it consumes and the goals it
// produces, instead of taking a trunk slot of its own. The tactic drops only
// a few pixels below its goal (enough to show the connector stub — `│——tac`)
// and its box is free to OVERLAP the next goal's band in y, because the two
// tracks are exclusive in x by construction: a tactic's left edge clears its
// own goal's box and every node its vertical range crosses. That x-clearing
// is what buys the height — the goal→goal distance collapses from
// gap + tactic band + gap to drop + half a band + clearance.
export const ASIDE_X = TRUNK_INSET + 14; // floor: an aside tactic clears the lane
const ASIDE_DROP = 4; // goal bottom → its tactic's band top
const ASIDE_CLEAR = 10; // stub y → the continuation's band top
const ASIDE_TRACK_GAP = 24; // right edge of the goal track → the tactic track

/** In the aside modes an annotated tactic's comment strip FLOATS: it is drawn
above the box, outside the band, rising into the open space beside the goal
the tactic consumes — so it stops costing the tree vertical room (the band,
`stubY` and `trackFloor` all shrink by the strip's height). This predicate is
only the STARTING guess: `place()` refines it (a side-by-side SPLIT keeps the
node at trunk x, where a floated strip would rise into its goal's box — the
column path returns before the aside slide ever runs) and STAMPS the final
answer on `LayoutNode.commentFloats`, which is what `nodeSpan`, `linkSpans`
and the renderer read. One writer, many readers — the measurer and renderer
cannot drift, and drift here means the strip and the boxes disagree about who
owns the vertical room, i.e. overlap. Stacked and wide (`aside === false`)
never stamp it, so they are untouched by construction. */
function floatsComment(
  aside: boolean | "track",
  d: { type: string; parents: readonly unknown[]; commentBlockH: number },
): boolean {
  return (
    !!aside && d.type === "tactic" && d.parents.length > 0 && d.commentBlockH > 0
  );
}

/** Height of the band ABOVE the box: case badge plus comment strip — unless
the strip FLOATS (aside modes, `commentFloats`), when it lives outside the
band and contributes nothing. THE one coding of this sum: every boxTop/band
computation (nodeSpan, linkSpans, and all the render sites in ProofTreeView)
must read it — an inline copy that forgets `commentFloats` hangs its ink
half a strip off on every annotated aside tactic (the armed-delete confirm
chip did exactly that). */
export function bandTopH(d: LayoutNode): number {
  return d.caseH + (d.commentFloats ? 0 : d.commentBlockH);
}

/** How far a node's INK reaches above and below its placed `y`, which is the
band's centre — the sibling of `bandTopH` for everything that asks "is this
node on screen" rather than "where does its box go".

It is ASYMMETRIC exactly when the strip floats: a floated strip hangs entirely
ABOVE the band (`up` gains all of `commentBlockH`), where the band arithmetic
that `y` comes from has already dropped it. The scroll sites used to hand-roll
`(h + commentBlockH) / 2` for both halves, which is wrong three ways at once —
it omits `caseH`, it credits a floated strip's height to the BOTTOM where none
of it is drawn, and it under-counts the top by the same amount. For a
non-floating node `up === down` and the midpoint is `y`, so routing the old
call sites through this changes nothing there; only floated ones move. */
export function inkExtent(d: LayoutNode): { up: number; down: number } {
  const half = (bandTopH(d) + d.h) / 2;
  return { up: half + (d.commentFloats ? d.commentBlockH : 0), down: half };
}
// The frontier-chip lane (`+`/`sorry`/`calc`/`step`, and the relation picker)
// hangs BELOW a node's box, outside its band — so unlike the comment strip and
// case badge it is not reserved by the band arithmetic, and whatever the trunk
// cursor placed next simply drew on top of it. That was invisible while chips
// only ever appeared on PENDING goals, which are leaves with a generous
// TRUNK_GAP_BRANCH under them; it became a real overlap as soon as chips could
// sit on an interior node (a `calc` whose block is broken, or a goal that has
// one below it), where the gap is the tight TRUNK_GAP_STEP. `chipH` is added
// to a node's OCCUPIED extent rather than its band, so the box stays at the
// band's bottom and every edge/label offset is untouched — only what comes
// after is pushed down.
export const CHIP_TOP_GAP = 8; // box bottom → chip top
export const CHIP_LANE_H = 15; // must equal ProofTreeView's CHIP_H
const TRUNK_GAP_STEP = 14; // goal → the tactic consuming it (one step, tight)
const TRUNK_GAP_BRANCH = 24; // tactic → what it generates; between siblings
const BRANCH_COL_GAP = 18; // horizontal air between side-by-side columns
// at their NEAREST approach — columns are contour-packed (each slides left
// until its ragged left profile is this close to the previous columns' right
// profile), not bounding-box packed, so the widest point of a tall column
// doesn't hold every neighbour at arm's length over its whole height.

// Position visible nodes as a trunk-and-branches outline. A branching tactic's
// children are laid out TOP-TO-BOTTOM IN SOURCE ORDER (`srcRank`); the last one
// resumes the trunk at the parent's indent while the earlier ones branch right
// and sit above it, so a branch stays local to the tactic that spawned it and
// the main proof line never drifts (the Nuprl text rendering: side goals branch
// off, the continuation resumes below them). The y-cursor is global, so no two
// bands ever overlap and the total height is exactly the content's.
//
// Source order is what makes scrolling the source and scanning the tree agree —
// move the cursor up a line and the accent moves up. It must be computed, not
// taken from Paperproof's child order, which is main-continuation-first: for a
// `have … := by` that happens to coincide (the body precedes the continuation
// in the source, and "first child on the trunk" put it above), but for a real
// case split it is exactly backwards. `by_cases` in euclid.lean listed `pos`
// then `neg`, so the old rule drew the `neg` branch ABOVE the `pos` one and
// walking the cursor up jumped from the composite branch to the prime branch.
function trunkLayout(
  visible: LayoutNode[],
  srcRank: (id: string) => number,
  // Side-by-side mode: a branching tactic's subtrees become COLUMNS sharing
  // one vertical span (leftmost continues the trunk lane, later ones fork
  // right in source order), instead of stacking down the page. The y-cursor
  // stops being global — each column threads its own — so the "no two bands
  // overlap" argument changes shape: columns overlap in y but are exclusive
  // in x by construction (each starts past the previous column's right edge).
  sideBySide = false,
  // Spine mode: tactic boxes stand in a right-hand track (see the ASIDE_*
  // constants). `"track"` is the ALIGNED variant: after placement every aside
  // tactic is slid out to one shared column x, so the two tracks read as
  // columns — it relies on the caller capping goal widths (the view forces
  // reflow's budget), since the column sits past the widest goal box.
  aside: boolean | "track" = false,
  // Minimum source column of any tactic in a node's subtree (Infinity when
  // none) — see the COL map in createLayoutEngine. Drives the spawned-branch
  // extra indent below; the default keeps direct callers (tests) unchanged.
  srcCol: (id: string) => number = () => Infinity,
): {
  nodes: PlacedNode[];
  links: PlacedLink[];
  extent: { width: number; height: number };
} {
  const kids = new Map<string, LayoutNode[]>();
  for (const n of visible)
    for (const p of n.parents)
      (kids.get(p.id) ?? kids.set(p.id, []).get(p.id)!).push(n);

  const placed = new Map<string, PlacedNode>();
  const nodes: PlacedNode[] = [];
  const links: PlacedLink[] = [];
  let width = 0;
  // Spine modes: the y below which the tactic track is free. Two consecutive
  // aside tactics can otherwise overlap in y — a tall tactic box reaches past
  // the short goal under it, and the NEXT tactic's drop point knows nothing
  // of it (it is computed from its own goal's bottom). Saved/restored around
  // side-by-side columns, which restart y and are x-exclusive anyway.
  let trackFloor = -Infinity;

  // A node's effective width: the box, or a strip hanging past it.
  const effOf = (n: LayoutNode): number => {
    // (unchanged by comment floating: a floated strip keeps the same x rule,
    // so the width contribution is identical — only its y moves.)
    const indent = n.parents.length > 0 ? COMMENT_INDENT : 0;
    return Math.max(
      n.w,
      (n.commentW > 0 ? indent : 0) + n.commentW,
      (n.caseW > 0 ? indent : 0) + n.caseW,
    );
  };

  // ---- contour packing (side-by-side columns) -----------------------------
  // Occupied ink as horizontal intervals over y-spans, so adjacent columns can
  // interleave their ragged profiles instead of standing bounding-box apart.
  // BOTH boxes and connectors count: a branch elbow's horizontal run and the
  // lane down to a distant child live OUTSIDE every node rect, and a column
  // packed against rects alone would sit right on top of them.
  interface Span {
    y0: number;
    y1: number;
    lo: number;
    hi: number;
  }

  const nodeSpan = (pn: PlacedNode): Span => {
    const d = pn.data;
    const floats = !!d.commentFloats;
    const band = bandTopH(d) + d.h;
    const left = pn.x - d.w / 2;
    // A floated strip hangs ABOVE the band (beside the consumed goal), so the
    // span still covers its ink — without this, contour packing and the aside
    // x-slide would run other boxes straight over the strip.
    return {
      y0: pn.y - band / 2 - (floats ? d.commentBlockH : 0),
      y1: pn.y + band / 2,
      lo: left,
      hi: left + effOf(d),
    };
  };

  // The ink of one compact link, as spans. MIRRORS the renderer's routing in
  // ProofTreeView (startY/bandTop/contentTop and the three elbow shapes) — if
  // the routing there changes, this must change with it, or packing will stop
  // clearing the connectors it can no longer see.
  function linkSpans(l: PlacedLink): Span[] {
    const sd = l.source.data;
    const td = l.target.data;
    // bandTopH keeps floated strips out of the band arithmetic here too (the
    // renderer's link mirror does the same).
    const startY = l.source.y + (sd.h + bandTopH(sd)) / 2;
    const bandTop = l.target.y - (td.h + bandTopH(td)) / 2;
    const contentTop = bandTop + bandTopH(td);
    const sLeft = l.source.x - sd.w / 2;
    const tLeft = l.target.x - td.w / 2;
    const col = sLeft + TRUNK_INSET;
    if (l.col) {
      const childLane = tLeft + TRUNK_INSET;
      const hy = bandTop - ARROW_GAP * 2;
      return [
        { y0: startY, y1: hy, lo: col, hi: col },
        { y0: hy, y1: hy, lo: Math.min(col, childLane), hi: Math.max(col, childLane) },
        { y0: hy, y1: contentTop - ARROW_GAP, lo: childLane, hi: childLane },
      ];
    }
    // Spine mode (an aside tactic's outgoing link): ride the TRUNK lane the
    // link carries, from the tactic's box middle — where the incoming elbow's
    // horizontal stub crosses that lane — straight down into a trunk child,
    // or │└ into an indented one. Deriving the lane from the tactic's own
    // left edge (the ordinary rule below) would run it through the goal
    // boxes stacked left of the track.
    if (l.lane !== undefined) {
      const srcBoxMid = l.source.y + bandTopH(sd) / 2;
      if (Math.abs(tLeft - (l.lane - TRUNK_INSET)) < 0.5)
        return [
          { y0: srcBoxMid, y1: contentTop - ARROW_GAP, lo: l.lane, hi: l.lane },
        ];
      const landY = contentTop + td.h / 2;
      return [
        { y0: srcBoxMid, y1: landY, lo: l.lane, hi: l.lane },
        { y0: landY, y1: landY, lo: l.lane, hi: tLeft - ARROW_GAP },
      ];
    }
    if (Math.abs(tLeft - sLeft) < 0.5)
      return [{ y0: startY, y1: contentTop - ARROW_GAP, lo: col, hi: col }];
    const landY = contentTop + td.h / 2;
    return [
      { y0: startY, y1: landY, lo: col, hi: col },
      { y0: landY, y1: landY, lo: col, hi: tLeft - ARROW_GAP },
    ];
  }

  const overlapsY = (a: Span, b: Span) =>
    a.y0 < b.y1 + 1 && b.y0 < a.y1 + 1; // ±1px slack so touching edges count

  // Place `n`'s subtree with its band starting at (x0, y0); returns the
  // subtree's bottom edge and right edge so a parent can stack (thread the
  // bottom) or columnise (thread the right). y is THREADED rather than a
  // global cursor precisely so a column can restart at its sibling's top.
  function place(
    n: LayoutNode,
    x0: number,
    y0: number,
  ): { pn: PlacedNode; bottom: number; right: number } {
    const already = placed.get(n.id);
    if (already)
      // DAG guard: extra parents just link to it, contributing no extent.
      return { pn: already, bottom: y0, right: x0 };
    // A floated strip (see floatsComment) leaves the band: the box rises by
    // the strip's height and the strip is drawn ABOVE it, beside the goal —
    // its ink is covered by nodeSpan and the crossing test below, never by
    // the band. NOT under a side-by-side SPLIT: that path returns before the
    // aside slide, leaving the node at trunk x, where a floated strip would
    // rise straight into its goal's box (found by the overlap sweep). The
    // final answer is STAMPED for every downstream reader.
    const floats =
      floatsComment(aside, n) &&
      !(sideBySide && (kids.get(n.id) ?? []).length > 1);
    n.commentFloats = floats;
    const cB = floats ? 0 : n.commentBlockH;
    const band = n.caseH + cB + n.h;
    // The box is left-aligned at x0; the comment strip too, except parented
    // nodes' strips hang indented off the incoming lane (COMMENT_INDENT) —
    // either may be the widest (effOf).
    const eff = effOf(n);
    // Spine mode: a parented tactic stands in the RIGHT track. Its x is
    // provisional here — after its children are placed (back on the trunk,
    // see the aside branch below), it is slid right until it clears its own
    // goal's box and every node its vertical range crosses. Mutating pn.x
    // after the fact is safe for the same reason column packing relies on:
    // links hold PlacedNode references, so geometry follows the node.
    const isAside = !!aside && n.type === "tactic" && n.parents.length > 0;
    // The track is a shared column (exactly shared in "track" mode), so a
    // tactic may not start above the previous track occupant's bottom. A
    // floated strip must clear it too — it hangs ABOVE y0, outside the band,
    // and the x-slide below never sees earlier nodes — so the floor applies
    // to the STRIP's top, costing the compression back only where the track
    // is actually that crowded.
    if (isAside) y0 = Math.max(y0, trackFloor + (floats ? n.commentBlockH : 0));
    const pn: PlacedNode = { x: x0 + n.w / 2, y: y0 + band / 2, data: n };
    placed.set(n.id, pn);
    nodes.push(pn);
    let bottom = y0 + band + n.chipH;
    let right = x0 + eff;
    // Source order, then the trunk resumption last. Sort is stable, so
    // children whose subtrees hold no tactic at all (rank Infinity) keep their
    // creation order rather than shuffling.
    const cs = (kids.get(n.id) ?? []).slice().sort((a, b) => {
      const ra = srcRank(a.id);
      const rb = srcRank(b.id);
      // Equality first: both-unpositioned would be Infinity - Infinity = NaN,
      // which silently corrupts a sort.
      return ra === rb ? 0 : ra - rb;
    });
    // Proof OBLIGATIONS a tactic generated (TreeNode.side — a conditional
    // rewrite's side condition) are not peers of the main line, so they must
    // never take the trunk. Partition them out, keeping source order within
    // each half. The two compact modes want the main child in OPPOSITE slots:
    // stacked resumes the trunk with its LAST child, columns with its FIRST.
    //
    // Putting obligations first in stacked mode draws them ABOVE the
    // continuation even though their proof text comes last — a deliberate
    // local source-order inversion, and exactly how a `have`'s side proof
    // already reads. `cs` is left untouched when nothing is stamped, which is
    // every proof containing no conditional rewrite.
    const mainCs = cs.filter((c) => !c.side);
    const sideCs = cs.filter((c) => c.side);
    const order =
      sideCs.length === 0 || mainCs.length === 0
        ? cs
        : sideBySide
          ? [...mainCs, ...sideCs]
          : [...sideCs, ...mainCs];
    if (sideBySide && order.length > 1) {
      // All columns start at the SAME y — that identical band top is what the
      // renderer's over-the-top connector routing relies on.
      const top = bottom + TRUNK_GAP_BRANCH;
      // The right contour of every column placed so far in THIS split.
      const contour: Span[] = [];
      let colX = x0;
      // Columns restart y, so each starts from the floor as it stood at the
      // split; the max over columns carries forward below the split.
      const floorAtSplit = trackFloor;
      let floorAfter = trackFloor;
      for (const c of order) {
        const isFirst = colX === x0;
        trackFloor = floorAtSplit;
        // Place PROVISIONALLY past everything (no collisions possible), then
        // slide the whole column left until its left profile sits
        // BRANCH_COL_GAP from the contour at the nearest approach. Shifting
        // after placement is safe because links reference PlacedNodes by
        // object — moving node.x moves their geometry with it.
        const nodeMark = nodes.length;
        const linkMark = links.length;
        const r = place(c, colX, top);
        const colNodes = nodes.slice(nodeMark);
        const colLinks = links.slice(linkMark);
        const spans = [
          ...colNodes.map(nodeSpan),
          ...colLinks.flatMap(linkSpans),
        ];
        let shift = 0;
        if (!isFirst && spans.length > 0) {
          shift = Infinity;
          for (const L of spans)
            for (const R of contour)
              if (overlapsY(L, R))
                shift = Math.min(shift, L.lo - R.hi - BRANCH_COL_GAP);
          // Never past the split's own base: below a short first column
          // there is nothing to collide with, but a box left of x0 would
          // escape the extent (and the trunk's own left margin).
          const minLo = Math.min(...spans.map((s) => s.lo));
          shift = Math.min(shift, minLo - x0);
          shift = Math.max(0, shift === Infinity ? 0 : shift);
          if (shift > 0)
            for (const cn of colNodes) cn.x -= shift;
        }
        // The parent link is pushed AFTER packing on purpose: its over-the-top
        // horizontal spans the gap between columns, and feeding it into the
        // contour would hold every later column out past it.
        links.push({ source: pn, target: r.pn, col: !isFirst });
        for (const sSpan of spans)
          contour.push(
            shift > 0 ? { ...sSpan, lo: sSpan.lo - shift, hi: sSpan.hi - shift } : sSpan,
          );
        const colRight = Math.max(...spans.map((s) => s.hi)) - shift;
        colX = Math.max(colX, colRight) + BRANCH_COL_GAP;
        bottom = Math.max(bottom, r.bottom);
        right = Math.max(right, colRight);
        floorAfter = Math.max(floorAfter, trackFloor);
      }
      trackFloor = floorAfter;
      return { pn, bottom, right };
    }
    // The last child resumes the trunk at the parent's own indent — last in
    // SOURCE order normally, but last of the MAIN children where a tactic
    // generated obligations (see `order` above), so the mathematics keeps the
    // trunk and the obligations branch off it. Excepted under a CHAIN (a
    // `calc` block), whose links are a list rather than a split, so every one
    // of them indents and they read as a column (see TreeNode.chain).
    // `undefined` never matches `c === trunk`.
    //
    // A chain that drew a LEDGER is the exception's exception: the ledger is
    // the chain's column itself rather than one of its links, and it is the
    // one child there is, so it resumes the trunk under its `calc` node and
    // the links hang off IT at the branch indent. (It once took an indent of
    // its own, read off the `calc` label's `"calc "` prefix so row 0 landed
    // under the source's own LHS; the author's reading is that a ledger just
    // follows `calc` down the trunk, and an offset that matched neither the
    // trunk nor the branch indent read as a misalignment.)
    //
    // Below the ledger the exception applies as written: the ledger's
    // children are the chain's link BRANCHES, one per row in row order (a
    // justification alone, or goal → justification where the reader opened
    // the link's goal box — see proofToTree's `openLinks`), so the ledger
    // takes NO trunk child and every branch indents equally, the column
    // matching the rows beside it.
    //
    // An `rw`'s folded `x = x` RESIDUE resumes the trunk like any last
    // child, so it sits at its `rw`'s own x — a link branch reads as ONE
    // flat column, goal, tactic and residue alike. (Under the removed SPINE
    // it was excluded from resumption, because the next LINK hung below it
    // and a residue on the spine's x read as the chain continuing through a
    // no-op; with the links fanned there is nothing below a residue but its
    // own folded `rw [rfl]`, and the exclusion just indented it — reported.)
    const last = order[order.length - 1];
    const trunk =
      n.ledger !== undefined
        ? undefined
        : n.chain
          ? order.find((c) => c.ledger !== undefined)
          : last;
    // Spine mode: this tactic leaves the trunk, so its children resume just
    // under the connector STUB (its box middle — where the incoming elbow's
    // horizontal lands) instead of under its whole band. That is the mode's
    // entire vertical saving: goal → goal collapses from
    // gap + band + gap to drop + half a band + ASIDE_CLEAR, and the box's
    // lower half overlaps the continuation's band in y, which the x-clearing
    // pass below makes safe. `bottom` still floors at the box's own bottom so
    // a LEAF tactic (nothing below it) can't be overlapped by a later
    // sibling, and so a tall box in the track pushes what follows down.
    const stubY = y0 + n.caseH + cB + n.h / 2;
    const boxBottom = y0 + band + n.chipH;
    const mark = nodes.length;
    // Claim the track BEFORE recursing. Every later tactic on this trunk is a
    // DESCENDANT — placed inside the loop below — so a floor published after
    // it (as this once was) is a floor nobody who needs it ever reads: down a
    // linear spine it stayed -Infinity and the y-exclusivity the whole aside
    // geometry assumes silently did not hold. It bit hardest with a FLOATED
    // strip, whose ink starts commentBlockH ABOVE a y0 that sits only
    // ASIDE_DROP + ASIDE_CLEAR + half a goal band below the previous tactic:
    // a three-line comment then drew straight through the box above it.
    // `boxBottom` is pure y arithmetic, already final here — the aside slide
    // below only ever moves x — so publishing it early is exact, not an
    // estimate. Monotone `max` for the same reason: a subtree placed lower
    // must not be un-floored when its ancestor finishes.
    if (isAside) trackFloor = Math.max(trackFloor, boxBottom + ASIDE_DROP);
    if (isAside) bottom = stubY + ASIDE_CLEAR;
    for (const c of order) {
      // A SPLIT keeps TRUNK_GAP_BRANCH between its branches even in spine
      // mode — the gallery pager lives in that gap — but the FIRST child sits
      // right at the resumed cursor (the ASIDE_CLEAR above already spaced it).
      const gap = isAside
        ? c === order[0]
          ? 0
          : TRUNK_GAP_BRANCH
        : n.type === "goal" && order.length === 1
          ? c.type === "tactic" && aside
            ? ASIDE_DROP
            : TRUNK_GAP_STEP
          : TRUNK_GAP_BRANCH;
      // A SPAWNED child is a nested by-block (`have … := by`'s side proof, a
      // tactic-valued argument's body): indent it a little past a plain
      // branch, echoing the source's own nesting. Column-DERIVED, not a
      // constant — the extra is how far the block's first tactic sits past
      // its parent tactic in the source, in character cells, capped so a
      // deeply-hung `(by order)` can't walk its branch off-page. Stacked only:
      // the aside slide overwrites branch x anyway, and side-by-side packs
      // columns on contours.
      // NEVER under a LEDGER: its branches are the chain's own column, and
      // the extra would make an OPENED link's goal (spawned) land right of
      // where the closed state drew its tactic (not spawned) — the reported
      // x-shift on expanding a row.
      const spawnCol =
        c.spawned && n.ledger === undefined ? srcCol(c.id) : Infinity;
      const spawnExtra =
        !aside && !sideBySide && Number.isFinite(spawnCol) && n.position
          ? Math.min(
              SPAWN_INDENT_MAX,
              Math.max(0, spawnCol - n.position.start.character),
            ) * CHAR_W
          : 0;
      const r = place(
        c,
        c === trunk ? x0 : x0 + TRUNK_INDENT + spawnExtra,
        bottom + gap,
      );
      // An aside tactic's outgoing links carry the trunk lane (the goal
      // column's, x0 + TRUNK_INSET) — its own left edge is in the right-hand
      // track and useless as a lane origin. See PlacedLink.lane.
      links.push(
        isAside
          ? { source: pn, target: r.pn, lane: x0 + TRUNK_INSET }
          : { source: pn, target: r.pn },
      );
      bottom = r.bottom;
      right = Math.max(right, r.right);
    }
    if (isAside) {
      // Slide the box into the right track: past the lane, past its own
      // goal's box, and past every node placed under it whose band crosses
      // the box's vertical range — the trunk continuation it overlaps by
      // construction, and any branch box tall enough to reach it.
      const parentPn = placed.get(n.parents[0].id);
      // With a floated strip the node's ink rises beside the goal, so the
      // clearance must cover the goal's WHOLE ink (its own strip or badge may
      // hang past its box — effOf); without a float the box never reaches the
      // goal's strip row and the box width suffices, as before.
      let clearX = Math.max(
        x0 + ASIDE_X,
        parentPn
          ? parentPn.x -
              parentPn.data.w / 2 +
              (floats ? effOf(parentPn.data) : parentPn.data.w) +
              ASIDE_TRACK_GAP
          : x0 + ASIDE_X,
      );
      // The tactic's own ink range includes its floated strip (above y0), so
      // the slide clears anything the strip could sit on — the previous aside
      // tactic's box can share that range (trackFloor only floors the BOX).
      const inkTop = floats ? y0 - n.commentBlockH : y0;
      for (const o of nodes.slice(mark)) {
        const b = nodeSpan(o);
        if (b.y0 < boxBottom && inkTop < b.y1)
          clearX = Math.max(clearX, b.hi + ASIDE_TRACK_GAP);
      }
      pn.x = clearX + n.w / 2;
      right = Math.max(right, clearX + eff);
      bottom = Math.max(bottom, boxBottom);
      // Already published above, before the recursion; keep the max so a
      // descendant's lower claim survives this node finishing.
      trackFloor = Math.max(trackFloor, boxBottom + ASIDE_DROP);
    }
    return { pn, bottom, right };
  }

  let cursor = 0;
  for (const r of visible.filter((n) => n.parents.length === 0)) {
    if (nodes.length > 0) cursor += TRUNK_GAP_BRANCH;
    cursor = place(r, 0, cursor).bottom;
  }
  // Aligned tracks: slide EVERY aside tactic out to one shared column — its
  // left edge at the widest non-track ink (goal boxes, strips, badges) plus
  // the track gap. Safe against goals because each tactic's per-node clearX
  // is by construction ≤ this maximum, and safe against other tactics
  // because trackFloor already keeps the track y-exclusive. Skipped under
  // side-by-side columns, where one global column would collide with the
  // column packing (columns are x-exclusive by contour, and a shared x
  // across them breaks exactly that).
  if (aside === "track" && !sideBySide) {
    const isTrack = (pn: PlacedNode) =>
      pn.data.type === "tactic" && pn.data.parents.length > 0;
    let trackX = 0;
    for (const pn of nodes)
      if (!isTrack(pn))
        trackX = Math.max(
          trackX,
          pn.x - pn.data.w / 2 + effOf(pn.data) + ASIDE_TRACK_GAP,
        );
    // MAX, never a plain assignment: a tactic's own slide may already have
    // pushed it past `trackX` to clear something the goal-only maximum cannot
    // see (a nested aside tactic in its own subtree). Overwriting that pulled
    // it back LEFT, onto the very node it had just cleared. Aligning to "at
    // least the column" keeps the two tracks reading as columns in every
    // ordinary case and still lets a crowded tactic stand out to its right.
    for (const pn of nodes)
      if (isTrack(pn)) pn.x = Math.max(pn.x, trackX + pn.data.w / 2);
  }
  // Width is computed AFTER placement, not tracked during it: contour packing
  // shifts whole columns left after their nodes were pushed, so a running
  // maximum would remember the provisional (pre-shift) positions.
  for (const pn of nodes) width = Math.max(width, pn.x - pn.data.w / 2 + effOf(pn.data));
  return { nodes, links, extent: { width, height: cursor } };
}

// Longest prefix of `text` whose measured width fits `maxW` (≥1 char so a single
// glyph wider than maxW still makes progress). Used to hard-break a token.
// Prefix width is monotone in length, so binary-search the cut point — a linear
// scan would measure O(len) growing prefixes per over-wide token, and Lean type
// expressions are exactly the long space-free tokens that triggers on.
function fitPrefix(
  text: string,
  maxW: number,
  fontPx: number,
  italic: boolean,
): number {
  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(text.slice(0, mid), fontPx, italic) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Indent (px) of a width-wrapped continuation line, so it visibly hangs under
// the line it continues. Shared with the render (tspan x / line paddingLeft);
// the wrap budget below subtracts it, so an indented line still fits WRAP_W.
export const CONT_INDENT = 18;
// Extra indent per open bracket in reflow mode (on top of CONT_INDENT).
const NEST_INDENT = 10;
// A seam is only worth breaking at once the line it closes is this full. Keeps
// an early comma from forcing a 10%-full line in normal wrapping, and stops
// reflow's eager break from shredding a label into two-token slivers.
const SEAM_MIN_FILL = 0.4;
// …and the floor for reflow's EAGER break is lower, because it is protecting
// against something else. Filling the line is not the goal there — narrowing
// the box is — so the only thing to avoid is a sliver first line. Keeping both
// floors at 0.4 was measurably worse than one number suggests: in
// `⊢ ∃ k, n = 2 * k ∨ n = 2 * k + 1` the `∨` seam sits at 36% and the `=` at
// 45%, so the shared floor rejected the CLAUSE seam and took the relation one
// — a worse break for a wider box (max line 20 cols vs 16).
const EAGER_MIN_FILL = 0.3;
// …and a line is only a candidate for an eager break once it is this much of
// the budget. Below it the text is already narrow relative to its neighbours,
// so splitting saves no width anywhere.
const EAGER_MIN_SEG = 0.65;

// Semantic seams to prefer when breaking a long line: break BEFORE one of
// these tokens, so the continuation line STARTS with the connective that ties
// it back to the previous line (`∧ 0 + n = n`, `→ ∃ p, …`). Two tiers by
// binding strength: a clause boundary (comma/semicolon, or a low-precedence
// logical connective) beats a relation/definition symbol — breaking at `≤`
// inside `(2 ≤ n → …)` splits an atom that a nearby `∧` seam keeps whole.
const BREAK_BEFORE_STRONG = new Set([
  "→", "↔", "∧", "∨", "⊢",
  // Binders open a clause exactly as an arrow does.
  "∀", "∃", "Σ", "λ", "fun",
]);
// Tactic-syntax keywords open a new clause of the invocation, so breaking
// before one reads like the source would if you wrapped it by hand
// (`induction n` / `using Nat.strong_induction_on` / `with`).
const BREAK_BEFORE_KEYWORD = new Set([
  "using", "with", "at", "by", "from", "generalizing", ":=",
]);
const BREAK_BEFORE_WEAK = new Set([
  "=", "≠", "≤", "≥", "<", ">", "∣", ":=", ":", "↦",
]);
// Bracket depth accumulated over a string — what reflow mode indents by, so a
// continuation inside `⟨…⟩` or `(…)` hangs under its opener instead of all
// wrapped lines sharing one flat indent. Angle brackets count: Lean anonymous
// constructors are everywhere in these proofs.
const OPENERS = "([{⟨";
const CLOSERS = ")]}⟩";
// A token made entirely of operator glyphs — `*`, `=`, `∧`, `:=`, `⊢`. Such a
// token must never END a wrapped line (see seamRank).
const OP_CHARS = "+-*/^=<>≤≥≠∣∧∨→↔↦%·∘:⊢";
const isOperator = (t: string) =>
  t.length > 0 && [...t].every((c) => OP_CHARS.includes(c));
function depthDelta(s: string): number {
  let d = 0;
  for (const ch of s) {
    if (OPENERS.includes(ch)) d++;
    else if (CLOSERS.includes(ch)) d--;
  }
  return d;
}

// Seam quality of a break between adjacent tokens:
//   3 = clause boundary (comma/semicolon, connective, binder, tactic keyword)
//   2 = group boundary  (a bracketed group ends here, or the next one opens)
//   1 = relation        (=, ≤, ∣, …)
//   0 = not a seam
//
// Groups sit BELOW clauses on purpose: `(2 ≤ n → …)` should split at a nearby
// `∧` rather than at the paren that wraps it, the same reasoning that already
// put relations below clauses.
//
// `depth` is the bracket nesting AT the break. A seam inside brackets is
// demoted one tier, because breaking there splits a group that reads as one
// unit — a comma between the fields of `⟨m, hmdvd, hm2, hmlt⟩` is a genuine
// seam, but a worse one than any boundary at top level.
function seamRank(
  left: string,
  right: string | undefined,
  depth = 0,
): number {
  // Never leave a line ending on a bare infix operator. The whole model here
  // is "break BEFORE the connective, so the continuation STARTS with it"; a
  // dangling `*` or `=` is that rule inverted. It bites via the GROUP tier,
  // which fires on the token after it: `⊢ m + 1 = 2 * (k + 1)` scored a seam
  // between `*` and `(k`, giving `⊢ m + 1 = 2 *` / `(k + 1)`.
  if (isOperator(left)) return 0;
  let base = 0;
  if (
    left.endsWith(",") ||
    left.endsWith(";") ||
    (right !== undefined &&
      (BREAK_BEFORE_STRONG.has(right) || BREAK_BEFORE_KEYWORD.has(right)))
  )
    base = 3;
  else if (
    CLOSERS.includes(left[left.length - 1]) ||
    (right !== undefined && right.length > 0 && OPENERS.includes(right[0]))
  )
    base = 2;
  else if (right !== undefined && BREAK_BEFORE_WEAK.has(right)) base = 1;
  return base > 0 && depth > 0 ? base - 1 : base;
}


// Width-wrap a single label segment (no newlines) by MEASURED pixel width
// rather than char count. Breaks happen at word boundaries, preferring the
// LATEST usable semantic seam (see seamRank) that fits — falling back to the
// plain greedy word break when no seam is usable. A single token wider than the whole
// budget is hard-broken: Lean type expressions are frequently one long
// space-free token, and without this they'd overflow the box (whose width is
// capped at MAX_W) instead of wrapping. Every line after the first is a
// continuation (`cont`), indented by CONT_INDENT out of its budget.
function wrapLine(
  text: string,
  maxW: number,
  fontPx = NODE_FONT_PX,
  italic = false,
  // How a continuation line is indented. `flat` hangs every one by
  // CONT_INDENT. `nested` (reflow) indents by the BRACKET DEPTH open at the
  // break instead, which is what keeps a narrow box readable: the wrapped tail
  // of `⟨p, hpp, hpm⟩` lines up inside the bracket rather than against
  // everything else. `none` is for PROSE — a comment strip is not a structured
  // expression, so neither hang means anything there, and mixing indented
  // wrapped lines with flush explicit-newline ones just makes the block ragged
  // and hard to read; comment strips get extra LEADING instead
  // (COMMENT_LINE_H).
  indentMode: "flat" | "nested" | "none" = "flat",
  // Break at the earliest worthwhile seam rather than filling the line to the
  // budget (see `eager` below). Defaults to reflow's own indent mode, since a
  // narrower box is only worth extra lines there.
  eagerSeams = indentMode === "nested",
): WrappedLine[] {
  // `none` is the comment-strip mode, and a comment is PROSE: it wraps by
  // whole words (greedy fill to the budget) with the operator/bracket seam
  // machinery below turned OFF. That machinery is tuned for Lean expressions —
  // "break before the connective" — and on prose it breaks a sentence at a `+`
  // or `=` and mid-formula, which is exactly what looked wrong. Inline-code
  // spans arrive pre-joined with non-breaking spaces (cleanMarkdown), so a
  // formula stays whole here without any special case.
  const prose = indentMode === "none";
  const out: WrappedLine[] = [];
  const words = text.split(" ");
  let i = 0;
  let depth = 0; // bracket depth at the START of the current line
  while (i < words.length) {
    const cont = out.length > 0;
    // Indent is capped so a deeply nested tail can never squeeze the budget to
    // nothing — past the cap the text simply stops indenting further.
    const indent =
      !cont || indentMode === "none"
        ? 0
        : indentMode === "nested"
          ? Math.min(CONT_INDENT + depth * NEST_INDENT, maxW * 0.4)
          : CONT_INDENT;
    const budget = maxW - indent;
    // Over-wide token: peel off the widest prefix that fits and go around.
    if (measureText(words[i], fontPx, italic) > budget) {
      const cut = fitPrefix(words[i], budget, fontPx, italic);
      const head = words[i].slice(0, cut);
      out.push({ text: head, cont, indent, seg: 0 });
      depth += depthDelta(head);
      words[i] = words[i].slice(cut);
      continue;
    }
    // Greedy fill, remembering per tier the LATEST seam that still fits (the
    // width-bound break) and the EARLIEST one that clears the fill floor (the
    // eager break). `d` is the bracket depth AT each candidate break, which
    // decides whether that seam is demoted for sitting inside a group (see
    // seamRank).
    const seamLast: (string | null)[] = [null, null, null, null]; // by rank
    const seamFirst: (string | null)[] = [null, null, null, null];
    const note = (rank: number, line: string, hasMore: boolean) => {
      // A "seam" at the very end of the text is not a break — there'd be
      // nothing after it. (seamRank sees `right === undefined` there and can
      // still score a trailing comma.)
      if (rank === 0 || !hasMore) return;
      seamLast[rank] = line;
      if (
        seamFirst[rank] === null &&
        measureText(line, fontPx, italic) >= EAGER_MIN_FILL * budget
      )
        seamFirst[rank] = line;
    };
    let cur = words[i];
    let d = Math.max(0, depth + depthDelta(words[i]));
    if (!prose) note(seamRank(words[i], words[i + 1], d), cur, i + 1 < words.length);
    let j = i + 1;
    for (; j < words.length; j++) {
      const cand = cur + " " + words[j];
      if (measureText(cand, fontPx, italic) > budget) break;
      cur = cand;
      d = Math.max(0, d + depthDelta(words[j]));
      if (!prose)
        note(seamRank(words[j], words[j + 1], d), cand, j + 1 < words.length);
    }
    // Clause beats group beats relation beats the plain word break — as long
    // as the seam doesn't waste most of the line (an early comma shouldn't
    // force a 10%-full line).
    const usable = (s: string | null): s is string =>
      s !== null && measureText(s, fontPx, italic) >= SEAM_MIN_FILL * budget;
    // Reflow mode breaks EAGERLY: at the earliest seam past the fill floor,
    // even when the remainder would have fit. Filling the line to the budget
    // is the wrong objective there — the box is sized by its widest line, so a
    // 38-column label that fits the 44-column budget still makes a 38-column
    // box, and side-by-side columns pay for every one of those columns. The
    // tier order is unchanged (it is what keeps the break readable); only
    // "latest that fits" becomes "earliest that's worth it".
    // …but only on a line that is actually LONG. Breaking a short one buys
    // nothing: `refine ⟨?_, ?_, ?_⟩` sitting under a full-width goal box is
    // already narrower than everything around it, so splitting it saves no
    // width anywhere and just reads as noise. Measured against the text
    // REMAINING for this line, which also stops a wrapped tail from being
    // split again once it has become short.
    const worthBreaking =
      measureText(words.slice(i).join(" "), fontPx, italic) >=
      EAGER_MIN_SEG * budget;
    const eager =
      eagerSeams && worthBreaking
        ? (seamFirst[3] ?? seamFirst[2] ?? seamFirst[1])
        : null;
    const chosen =
      eager ??
      (j >= words.length
        ? cur // the rest fits on this line
        : usable(seamLast[3])
          ? seamLast[3]
          : usable(seamLast[2])
            ? seamLast[2]
            : usable(seamLast[1])
              ? seamLast[1]
              : cur);
    out.push({ text: chosen, cont, indent, seg: 0 });
    depth = Math.max(0, depth + depthDelta(chosen));
    i += chosen.split(" ").length;
  }
  return out;
}

// Honor explicit newlines in the label first, then width-wrap each segment.
// Lines opened by an explicit newline are NOT continuations — only the
// wrapper's own breaks get the hanging indent.
function wrapText(
  text: string,
  maxW: number,
  fontPx = NODE_FONT_PX,
  italic = false,
  indentMode: "flat" | "nested" | "none" = "flat",
  eagerSeams = indentMode === "nested",
): WrappedLine[] {
  return text
    .split("\n")
    .flatMap((segment, i) =>
      // Stamp the segment index so a caller whose label is a JOIN of separate
      // texts (a combined node's stacked tactics) can map each drawn line back
      // to the text it came from.
      wrapLine(segment, maxW, fontPx, italic, indentMode, eagerSeams).map(
        (l) => ({ ...l, seg: i }),
      ),
    );
}

// Source-comment strip geometry: an italic block drawn at the very TOP of the
// node's band (comment → context label → box, mirroring source order where the
// comment precedes the whole invocation). Wrapped with the same machinery as
// labels — measured italic, because italics are wider. COMMENT_GAP separates
// the strip from whatever sits below it (the hyp label or the box).
export const COMMENT_FONT_PX = 11;
// Looser leading than the code blocks (1.6× vs LINE_H's 1.2×). Comment lines
// carry NO hanging indent — a strip is prose, and indenting it only made a
// wrapped block ragged against its own explicit-newline lines — so the gap
// between lines is the only thing separating them, and it has to be visible.
export const COMMENT_LINE_H = 18;
export const COMMENT_GAP = 10;
// Compact mode draws a parented node's incoming connector as a continuous
// lane straight down to the node's content (below the comment strip), and
// hangs the strip to the RIGHT of that lane, git-graph style — so the strip
// is indented past the connector column plus some air. Root comments (no
// incoming lane) stay flush-left.
export const COMMENT_INDENT = TRUNK_INSET + 8;
// A goal's case badge: one short line above the comment strip. Never wrapped —
// a case name is a single identifier, and the box grows to fit it if need be.
export const CASE_FONT_PX = 10;
export const CASE_LINE_H = 14;
export const CASE_GAP = 4;
function caseSize(
  label: string | undefined,
): Pick<LayoutNode, "caseH" | "caseW"> {
  if (!label) return { caseH: 0, caseW: 0 };
  return {
    caseH: CASE_LINE_H + CASE_GAP,
    caseW: measureText(label, CASE_FONT_PX),
  };
}

// Big-comment clamp: a strip wrapping to COMMENT_CLAMP_MIN or more lines is a
// DOCUMENT (a multi-paragraph docstring, a long /- -/ block), not an aside —
// and drawn whole it can be a third of a small proof's height (measured:
// 23-36% on the flags fixtures, 7-8 line root strips at 136-154px each). So a
// big strip shows only its first COMMENT_CLAMP_SHOWN lines plus one affordance
// line ("⋯ N more lines"), and expanding is a per-node CLICK — a relayout,
// anchored on the node, never a hover (the no-relayout-on-hover rule). The
// threshold is deliberately past 3: a 3-line strip clamped to 2+affordance
// saves nothing, and 1-3-line comments are the ones the user called fine.
// Big strips (clamped AND expanded) also hang their prose behind a hairline
// gutter rule — the indent is added HERE so commentW measures it and the
// render draws inside measured ink (contour packing and the overlap sweeps
// stay honest).
export const COMMENT_CLAMP_MIN = 4;
export const COMMENT_CLAMP_SHOWN = 2;
export const COMMENT_RULE_INDENT = 9;
/** Breathing room each side of the affordance's own text, so the hover
backing it draws reads as a control rather than as a highlight sitting on the
words. Measured here as well as drawn: the backing is INK, and ink outside
`commentW` is ink the contour packing cannot see. */
export const COMMENT_MORE_PAD = 4;
function commentSize(
  text: string | undefined,
  reflow: ReflowMode = "off",
  expanded = false,
): Pick<
  LayoutNode,
  "commentLines" | "commentBlockH" | "commentW" | "commentMore"
> {
  if (!text)
    return { commentLines: [], commentBlockH: 0, commentW: 0 };
  // Same budget as the labels: a narrow box under a full-width comment strip
  // would defeat the whole point of the mode, since the strip's width joins
  // the node's effective width in both layouts.
  const wrapped = wrapText(
    text,
    budgetFor(reflow),
    COMMENT_FONT_PX,
    true,
    "none",
    reflow !== "off",
  );
  const big = wrapped.length >= COMMENT_CLAMP_MIN;
  let shown =
    big && !expanded ? wrapped.slice(0, COMMENT_CLAMP_SHOWN) : wrapped;
  // A clamp cut at a paragraph break leaves a BLANK line as the last shown
  // one — a gap saying nothing, right above the affordance that says it
  // better. Trim trailing blanks off the clamped slice (they count as hidden,
  // honestly: the paragraph they separated is).
  while (big && !expanded && shown.length > 1 && !shown[shown.length - 1].text)
    shown = shown.slice(0, -1);
  const commentMore = big
    ? {
        hidden: expanded ? 0 : wrapped.length - shown.length,
        expanded,
        label: expanded
          ? "⌃ collapse"
          : `⋯ ${wrapped.length - shown.length} more lines`,
      }
    : undefined;
  // The gutter rule's indent joins every line of a big block, affordance
  // included, so the measured width covers the rule and the shifted text.
  const commentLines = big
    ? shown.map((l) => ({ ...l, indent: l.indent + COMMENT_RULE_INDENT }))
    : shown;
  const commentW = Math.max(
    ...commentLines.map(
      (l) =>
        l.indent + measureText(l.text, COMMENT_FONT_PX, true),
    ),
    commentMore
      ? COMMENT_RULE_INDENT +
          measureText(commentMore.label, COMMENT_FONT_PX, false) +
          COMMENT_MORE_PAD
      : 0,
  );
  return {
    commentLines,
    // The affordance occupies a line slot of its own, so the band arithmetic
    // (bandTopH, inkExtent, floated strips) needs no second reader: block
    // height stays lines-in-block × line height + gap.
    commentBlockH:
      (commentLines.length + (commentMore ? 1 : 0)) * COMMENT_LINE_H +
      COMMENT_GAP,
    commentW,
    commentMore,
  };
}

// Compute the wrapped label lines and box geometry for a node. The box holds
// the context block (a goal's hyps, if any) stacked above the label, so its
// height is both blocks and its width the wider of the two.
//
// Label lines are wrapped to fit WRAP_W, so the widest measured line + padding
// stays within MAX_W. Context lines are deliberately NOT wrapped — the box just
// grows to fit them, as the standalone context label used to. That keeps a
// context line's text exactly the `name : type` string the widget's tagged
// renderer matches on (taggedRender.tsx), which a mid-line break would destroy.
function sizeOf(
  text: string,
  hyps: HypLine[] | undefined,
  reflow: ReflowMode = "off",
): Pick<LayoutNode, "lines" | "w" | "h" | "hypH" | "hyps"> {
  const budget = budgetFor(reflow);
  const lines = wrapText(
    text,
    budget,
    NODE_FONT_PX,
    false,
    reflow !== "off" ? "nested" : "flat",
  );
  const widest = Math.max(
    ...lines.map(
      (l) => l.indent + measureText(l.text, NODE_FONT_PX),
    ),
  );
  const cap = reflow !== "off" ? budget + 2 * NODE_PAD : MAX_W;
  const labelW = Math.max(MIN_W, Math.min(cap, widest + 2 * NODE_PAD));
  const { hypLines, hypW, hypH } = hypBlockSize(hyps, reflow);
  return {
    lines,
    hyps: hypLines,
    w: Math.max(labelW, hypW),
    h: hypH + lines.length * LINE_H + 2 * NODE_PAD_Y,
    hypH,
  };
}

// The CONTEXT BLOCK's own geometry — the lines as drawn, the width they need
// and the height they occupy. Factored out of `sizeOf` when the `calc` ledger
// grew a context block of its own (it draws the chain's hyps once, above its
// rows): two boxes stacking hyps the same way must measure them with one body,
// or the gutter reservation and the divider's leading become a pair that can
// drift — and both of those already have a matching rule in HypBlock.
function hypBlockSize(
  hyps: HypLine[] | undefined,
  reflow: ReflowMode,
): { hypLines: HypLine[]; hypW: number; hypH: number } {
  const budget = budgetFor(reflow);
  const raw = hyps ?? [];
  // The `▸` gutter exists to tell used hyps from unused ones, so it is
  // reserved only when there is actually a distinction to draw. In `used` mode
  // every line is used by construction, and a marker on all of them would be
  // pure noise in an already-tight box. Must agree with HypBlock's own test.
  const gutter =
    raw.some((l) => l.used) && !raw.every((l) => l.used) ? HYP_MARK_W : 0;
  // Context lines are normally NOT wrapped — the box grows to fit them,
  // because a mid-line break destroys the exact `name : type` string the
  // widget's tagged renderer matches on (taggedRender.tsx). But they are what
  // actually sets most box widths (measured: 44 of 84 boxes with a context are
  // bound by their widest hyp, not their label), so leaving them alone made
  // reflow nearly pointless. In reflow mode they wrap too, and the cost is
  // paid exactly where it lands: a WRAPPED hyp line no longer matches by text,
  // so it renders as plain text and loses its type tooltip. Unwrapped ones —
  // the majority, and every hyp outside this mode — keep theirs.
  const hypLines: HypLine[] = reflow === "off"
    ? raw
    : raw.flatMap((l) =>
        wrapText(
          l.text,
          budget - gutter,
          HYP_FONT_PX,
          false,
          "nested",
          // NOT eager, unlike the label: an eagerly broken hyp line buys a
          // little width and costs a type tooltip (a wrapped line stops
          // matching by text). Measured over the corpus, eager hyps took the
          // total layout width a further 2% only, and wrapped 18 more context
          // lines to do it — the wrong side of that trade.
          false,
        ).map(
          // `sep` rides only the FIRST fragment of a wrapped line — the
          // divider sits above the hyp, not inside it.
          (w) => ({
            text: w.text,
            used: l.used,
            cont: w.cont,
            indent: w.indent,
            sep: w.cont ? undefined : l.sep,
          }),
        ),
      );
  const hypW =
    hypLines.length > 0
      ? Math.max(
          ...hypLines.map(
            (l) => (l.indent ?? 0) + measureText(l.text, HYP_FONT_PX),
          ),
        ) +
        gutter +
        2 * NODE_PAD
      : 0;
  // A mixed data/props block carries at most one `sep` (contextFor's
  // invariant), whose divider needs its own leading — reserve it here or the
  // shifted lines below it spill past the label (HypBlock must agree).
  const sepExtra = hypLines.some((l) => l.sep) ? HYP_SEP_H : 0;
  const hypH =
    hypLines.length > 0 ? hypLines.length * HYP_LINE_H + sepExtra + HYP_GAP : 0;
  return { hypLines, hypW, hypH };
}

// The full-size measurement, exported for the overview peek: hovering a mini
// chip renders the node at full size WITHOUT a relayout, so the view needs
// the same lines/geometry the engine would have computed had the node been in
// the keep set. Always at the "off" budget — a peek is read in place, and
// wrapping it to a reflow column would make it as cramped as what it expands.
export function measureNode(
  label: string,
  hyps: TreeNode["hyps"],
): Pick<LayoutNode, "lines" | "w" | "h" | "hypH" | "hyps"> {
  return sizeOf(label, hyps, "off");
}

// A layout engine bound to one tree. Folding state and re-layout are pure
// functions of `data`, so swapping the proof is just building a new engine —
// nothing about the renderer assumes where `data` came from. The return type is
// inferred and surfaced as `LayoutEngine` for the renderer's prop typing.
export type LayoutEngine = ReturnType<typeof createLayoutEngine>;

export interface LayoutEngineOptions {
  /** Wrap labels and comment strips at a much narrower column, with
   * bracket-depth indentation, so branches fit side by side. */
  reflow?: ReflowMode;
  /** Reserve room under a node for its frontier-chip lane. Off by default:
   * `addSpec`/`addLink` are computed on both wires, but only the widget
   * supplies `onAddTactic` and therefore only the widget DRAWS chips — the
   * standalone app must not get a band of empty space per pending goal. */
  chips?: boolean;
  /** Overview mode: every node NOT in `keep` lays out as a one-line mini
   * chip — first label line clipped to a small width, no context block, no
   * comment strip, no chip lane — so the tree reads as its SHAPE, with only
   * the cursor's local region (the `keep` set, computed by the view) at full
   * size. Geometry, not paint: the compression is what the mode is for, and a
   * scale transform would shrink ink while keeping the space. Hover-expand is
   * the VIEW's business (a paint-only peek overlay) precisely so pointing at
   * a chip never relayouts — the no-relayout-on-hover rule. */
  overview?: { keep: ReadonlySet<string> };
  /** Comment strips: drawn (`true`, default), not drawn (`false` — GEOMETRY,
   * not paint: the strip is part of a node's band, so hiding it has to
   * un-reserve the room too or the tree keeps a ragged column of holes), or
   * `"instead"` — narration mode: a commented TACTIC's prose stands in for its
   * label inside the box (see LayoutNode.proseLabel) and the strip is zeroed;
   * uncommented tactics, goals and markers keep their labels, so the tree
   * stays readable as a tree and the prose reads as what the steps say. */
  comments?: boolean | "instead";
  /** Ids whose strip is hidden individually (the selection pill's verb), on
   * top of whatever `comments` says globally. Same seam, same reason. */
  commentsHidden?: ReadonlySet<string>;
  /** Ids whose BIG comment strip (see COMMENT_CLAMP_MIN) is expanded to its
   * full wrapped height. Big strips clamp by default; expansion is per-node
   * view state with the `commentsHidden` lifecycle (remapped on shape change,
   * cleared on a proof change). GEOMETRY, hence engine-tier: the strip is
   * band height, and an expansion has to reserve the room it uncovers. */
  commentsExpanded?: ReadonlySet<string>;
}

// Overview chip geometry. Text stays at NODE_FONT_PX — a smaller font would
// need every downstream text-render site to learn a second size, and the
// compression comes from dropping hyps/comments and the label's tail, not
// from smaller glyphs.
const MINI_TEXT_W = 130; // px of label kept in a chip
function miniSize(
  text: string,
): Pick<LayoutNode, "lines" | "w" | "h" | "hypH" | "hyps"> {
  const first = text.split("\n")[0];
  let t = first;
  let clipped = false;
  while (t.length > 1 && measureText(t + (clipped ? "…" : ""), NODE_FONT_PX) > MINI_TEXT_W) {
    t = t.slice(0, -1);
    clipped = true;
  }
  const label = clipped ? t.trimEnd() + "…" : t;
  return {
    lines: [{ text: label, indent: 0, cont: false, seg: 0 }],
    hyps: [],
    w: Math.max(MIN_W, measureText(label, NODE_FONT_PX) + 2 * NODE_PAD),
    h: LINE_H + 2 * NODE_PAD_Y,
    hypH: 0,
  };
}

// A `calc` LEDGER (see TreeNode.ledger): one drawn line per row, the relation
// rows hanging under the head at the source's own step indent.
//
// Rows are deliberately NOT pixel-wrapped, for exactly the reason context lines
// are not: a row is a verbatim SUFFIX of its link goal's printed type, which is
// the string the widget's tagged renderer matches on, and a mid-row break would
// destroy it. So the box grows to fit instead — and unlike `sizeOf` there is no
// MAX_W clamp, since clamping a width nothing wrapped to only spills the text
// out of the box.
// The relation rows' own indent, Lean's own: a link is written `_ = z`, so with
// the HEAD row putting the chain's LHS at indent 0, two character cells is
// exactly where the relation lands under it.
//
// It is a RELATIVE shape, keyed on the head row's presence rather than
// assumed: the head is unconditional today (a ledgered chain's node label is
// forced to the bare `calc`, so the LHS always opens the ledger), and keying
// on the rows keeps this correct rather than accidental if that ever moves.
const LEDGER_INDENT = 2 * CHAR_W;
function ledgerSize(
  rows: LedgerRow[],
  hyps: HypLine[] | undefined,
  reflow: ReflowMode,
): Pick<LayoutNode, "lines" | "w" | "h" | "hypH" | "hyps"> {
  const head = rows.some(isLedgerHead);
  const lines: WrappedLine[] = rows.map((r, i) => ({
    text: r.text,
    cont: false,
    // Keyed on the HEAD row's presence, never on the index: after the head is
    // dropped, row 0 is an ordinary relation row and the whole block is flush.
    indent: head && !isLedgerHead(r) ? LEDGER_INDENT : 0,
    seg: i,
  }));
  const widest = Math.max(
    ...lines.map((l) => l.indent + measureText(l.text, NODE_FONT_PX)),
  );
  // The chain's CONTEXT, drawn once here instead of once per link box. Measured
  // through the same body every other box's is (hypBlockSize), so the ▸ gutter
  // and the data/props divider behave identically inside a chain.
  const { hypLines, hypW, hypH } = hypBlockSize(hyps, reflow);
  return {
    lines,
    hyps: hypLines,
    w: Math.max(MIN_W, widest + 2 * NODE_PAD, hypW),
    h: hypH + lines.length * LINE_H + 2 * NODE_PAD_Y,
    hypH,
  };
}

// Narration mode: the comment prose measured AS the label, italic at the
// label's own font and budget. A sibling of `sizeOf` rather than a flag on it
// because the two differ in every dimension that matters: italic (glyphs are
// wider — the measurement must match the paint, the recorded trap), `"none"`
// indent (prose has no bracket structure to hang under), and no hyp handling
// (only tactic boxes take a prose label, and they carry no context block).
function proseLabelSize(
  text: string,
  reflow: ReflowMode = "off",
): Pick<LayoutNode, "lines" | "w" | "h" | "hypH" | "hyps"> {
  const budget = budgetFor(reflow);
  const lines = wrapText(text, budget, NODE_FONT_PX, true, "none", reflow !== "off");
  const widest = Math.max(
    ...lines.map((l) => l.indent + measureText(l.text, NODE_FONT_PX, true)),
  );
  const cap = reflow !== "off" ? budget + 2 * NODE_PAD : MAX_W;
  return {
    lines,
    hyps: [],
    w: Math.max(MIN_W, Math.min(cap, widest + 2 * NODE_PAD)),
    h: lines.length * LINE_H + 2 * NODE_PAD_Y,
    hypH: 0,
  };
}

/** Everything the engine measures once per node: the box (label + context
 * block), the comment strip, the case badge, the chip lane, and the two bits a
 * measurement branch stamps for the render to read (`mini`, `proseLabel`).
 * Named because there are now two of these per ledger node — see `HYP_ALT`. */
type SizeRec = ReturnType<typeof sizeOf> &
  ReturnType<typeof commentSize> &
  ReturnType<typeof caseSize> &
  Pick<LayoutNode, "chipH" | "mini" | "proseLabel">;

export function createLayoutEngine(
  data: TreeNode[],
  {
    reflow = "off",
    chips = false,
    overview,
    comments = true,
    commentsHidden,
    commentsExpanded,
  }: LayoutEngineOptions = {},
) {
  // Stable left-to-right order key for the wide layout, assigned below once
  // `SRC` exists so that siblings there read in SOURCE order too — the wide
  // mode can't put source order on the vertical axis (that axis is depth), but
  // left-to-right is free to agree with the compact mode and the buffer.
  const ORD = new Map<string, number>();

  // Ids that are a parent of at least one node — i.e. the foldable nodes.
  // Derived from the full `data`, so it's constant; a node stays foldable even
  // while its children are hidden (that's exactly when you want the "+" to
  // re-expand them).
  const HAS_CHILDREN = new Set(data.flatMap((n) => n.parents.map((p) => p.id)));

  // parentId → its child ids (full tree). Used to find siblings for the
  // accordion behaviour ("expanding one branch collapses the others").
  const CHILDREN = new Map<string, string[]>();
  for (const n of data)
    for (const p of n.parents)
      (CHILDREN.get(p.id) ?? CHILDREN.set(p.id, []).get(p.id)!).push(n.id);
  const NODE = new Map(data.map((n): [string, TreeNode] => [n.id, n]));

  // Minimum of `own` over each node's whole SUBTREE (Infinity when no tactic
  // carries a value). Memoized DFS with a cycle guard — shared children make
  // the tree a DAG. Both consumers below need the SUBTREE's minimum, not the
  // node's own position: a goal node carries the position of the step that
  // PRODUCED it (proofToTree `producingPosition`), so every child of one
  // tactic reports the same position, and the first tactic reachable inside a
  // branch is the thing that actually says where the branch lives.
  const subtreeMin = (own: (n: TreeNode) => number): Map<string, number> => {
    const memo = new Map<string, number>();
    const visiting = new Set<string>();
    const walk = (id: string): number => {
      const m = memo.get(id);
      if (m !== undefined) return m;
      if (visiting.has(id)) return Infinity;
      visiting.add(id);
      const n = NODE.get(id);
      let r = n ? own(n) : Infinity;
      for (const c of CHILDREN.get(id) ?? []) r = Math.min(r, walk(c));
      visiting.delete(id);
      memo.set(id, r);
      return r;
    };
    for (const n of data) walk(n.id);
    return memo;
  };

  // A tactic node's OWN source positions, in the one place both rankings read
  // them. An ELIDE MARKER has no `position` of its own — deliberately, so
  // layoutKey's tactic↔marker pair can never form (see layoutKey.ts) — but it
  // STANDS IN for the tactics it swallowed and must rank exactly where they
  // did. Without this its branch's subtree-min falls to Infinity and the
  // branch changes places with its siblings: eliding the FIRST of two sibling
  // branches sent it to the BOTTOM of the tree, and the reader's answer to
  // "which branch is this" silently moved. `parts` is on every marker (ghost,
  // path, band and combined alike), so one rule covers every cut.
  const ownPositions = (n: TreeNode): ProofStepPosition[] =>
    n.type !== "tactic"
      ? []
      : n.position
        ? [n.position]
        : (n.elidedCut?.parts ?? []).flatMap((p) =>
            p.position ? [p.position] : [],
          );
  const ownMin = (n: TreeNode, of: (p: ProofStepPosition) => number): number => {
    let r = Infinity;
    for (const p of ownPositions(n)) r = Math.min(r, of(p));
    return r;
  };

  // Earliest source position anywhere in a node's subtree, as one sortable
  // number — what the compact layout orders branches by. Computed over the
  // full `data`, so folding never reorders anything.
  const SRC = subtreeMin((n) =>
    ownMin(n, (p) => p.start.line * 1e4 + p.start.character),
  );
  const srcRank = (id: string) => SRC.get(id) ?? Infinity;

  // Minimum source COLUMN of any tactic in a node's subtree — what gives a
  // SPAWNED branch (a nested by-block) its extra indent in the stacked layout
  // (the real column, `grind`'s inside `rcases … <| by`, lives on the
  // grandchild tactic).
  const COL = subtreeMin((n) => ownMin(n, (p) => p.start.character));
  const srcCol = (id: string) => COL.get(id) ?? Infinity;
  // Creation order (a DFS preorder of the full tree) breaks ties, so nodes
  // whose subtrees hold no tactic keep a deterministic place.
  data
    .map((n, i) => ({ n, i }))
    .sort((a, b) => {
      const ra = srcRank(a.n.id);
      const rb = srcRank(b.n.id);
      return ra === rb ? a.i - b.i : ra - rb;
    })
    .forEach(({ n }, rank) => ORD.set(n.id, rank));

  // Wrapped label lines + box geometry (and the comment strip's), per node. A
  // label never changes for the lifetime of an engine, so measure once here —
  // computeLayout runs on every fold toggle, and re-wrapping every visible
  // label there is pure waste.
  // Narration mode's bullet test needs a node's consumed goal; ids only, so a
  // plain map over the same array the SIZE pass walks.
  const BY_ID = new Map(data.map((n) => [n.id, n]));
  // The alternative size of a node whose context block SIZE dropped because an
  // ancestor draws it too (see TreeNode.hypsInheritedFrom): the block put back,
  // plus the id whose being drawn was the reason to drop it. `computeLayout`
  // reads it when that ancestor is not in the layout after all — focus scoped
  // to the chain, sequence mode, a paged-away branch — where the "already on
  // screen" premise fails and the only copy of the block is this one. Filled
  // by the SIZE pass below, which is where the decision is already being made;
  // empty for every proof that has no ledger.
  const HYP_ALT = new Map<string, { src: string; size: SizeRec }>();
  const SIZE = new Map(
    data.map(
      (n): [string, SizeRec] => {
        // Overview: a node outside the keep set is a mini chip. Its comment
        // strip and chip lane go with the context block — the mode shows
        // SHAPE, and the case badge stays because a branch's name IS shape.
        // The mini flag rides the size record so the render can gate the
        // chip lane, the action bar and the hover peek off the same bit the
        // sizing used (a second derivation could drift).
        if (overview && !overview.keep.has(n.id))
          return [
            n.id,
            {
              ...miniSize(n.label),
              commentLines: [],
              commentBlockH: 0,
              commentW: 0,
              ...caseSize(n.caseLabel),
              chipH: 0,
              mini: true,
            },
          ];
        // Hidden strips zero out at the ONE measurement seam, so every
        // downstream reader is right for free: `floatsComment` requires
        // commentBlockH > 0, so the aside float never gets stamped; the band
        // arithmetic, nodeSpan, linkSpans and the renderer all see a node
        // that simply has no comment. Same trick the overview branch uses.
        const hideComment =
          !comments || (commentsHidden?.has(n.id) ?? false);
        // A ledger measures its ROWS, not its joined label (which exists only
        // so a generic reader has text): each row keeps its own indent, and
        // none of them wraps. Its comment strip and case badge behave like any
        // other node's; it carries no chips, so no lane is reserved.
        if (n.ledger) {
          const chrome = {
            ...commentSize(
              hideComment ? undefined : n.comment,
              reflow,
              commentsExpanded?.has(n.id) ?? false,
            ),
            ...caseSize(n.caseLabel),
            chipH: 0,
          };
          // The context block, DROPPED while the ancestor that also draws it
          // is in the drawn tree (see TreeNode.hypsInheritedFrom). Structural:
          // `data` is the post-elision node list, so a band cut that took the
          // chain goal away answers "no" here and the block comes straight
          // back — the suppression is a claim about what is on screen, and
          // this is the last place that can still check it cheaply.
          const src =
            n.hypsInheritedFrom !== undefined
              ? BY_ID.get(n.hypsInheritedFrom)
              : undefined;
          const drawnAbove = !!src?.hyps?.length;
          if (drawnAbove)
            HYP_ALT.set(n.id, {
              src: n.hypsInheritedFrom!,
              size: { ...ledgerSize(n.ledger, n.hyps, reflow), ...chrome },
            });
          return [
            n.id,
            {
              ...ledgerSize(n.ledger, drawnAbove ? undefined : n.hyps, reflow),
              ...chrome,
            },
          ];
        }
        // Narration: a commented TACTIC's prose becomes its label; the strip
        // is zeroed (the prose moved, it didn't double). Only as-written
        // tactics — markers/synthetic/recovered nodes stand for no single
        // step, and goals keep their statements (the prose narrates the
        // MOVES; the goals are what the moves are about). A locally-hidden
        // node (`commentsHidden`, the pill's ¬note) falls back to its label —
        // "this node's prose is off" means off in this mode too. A `· ` bullet
        // prefixes the prose when the consumed goal is SPAWNED (a nested
        // by-block): the box sits indented under the tactic that opened the
        // block, and the bullet says "this narrates a step INSIDE it", the
        // source's own marker for that nesting. NOT when that goal carries a
        // case BADGE (induction branches arrive spawned too, via delayed
        // assignment) — the badge already names the nesting, and a bullet on
        // top double-marks it. Prefixed before measuring, so it is part of
        // the wrapped first line, never an overlay.
        if (
          comments === "instead" &&
          n.type === "tactic" &&
          n.comment &&
          !n.elidedCut &&
          !n.synthetic &&
          !n.recovered &&
          !(commentsHidden?.has(n.id) ?? false)
        ) {
          const consumed = BY_ID.get(n.parents[0]?.id ?? "");
          const spawnedBlock = !!consumed?.spawned && !consumed?.caseLabel;
          const prose = (spawnedBlock ? "· " : "") + n.comment;
          return [
            n.id,
            {
              ...proseLabelSize(prose, reflow),
              ...commentSize(undefined, reflow),
              ...caseSize(n.caseLabel),
              chipH:
                chips && (n.addSpec || n.addLink)
                  ? CHIP_TOP_GAP + CHIP_LANE_H
                  : 0,
              proseLabel: true,
            },
          ];
        }
        return [
          n.id,
          {
            ...sizeOf(n.label, n.hyps, reflow),
            ...commentSize(
              hideComment ? undefined : n.comment,
              reflow,
              commentsExpanded?.has(n.id) ?? false,
            ),
            ...caseSize(n.caseLabel),
            chipH:
              chips && (n.addSpec || n.addLink)
                ? CHIP_TOP_GAP + CHIP_LANE_H
                : 0,
          },
        ];
      },
    ),
  );

  // Foldable siblings of `id`: nodes sharing a parent with it, excluding itself.
  // Collapsing these is what keeps a single branch open at each level.
  function siblingIds(id: string): string[] {
    const sibs = new Set<string>();
    for (const p of NODE.get(id)?.parents ?? [])
      for (const c of CHILDREN.get(p.id) ?? [])
        if (c !== id && HAS_CHILDREN.has(c)) sibs.add(c);
    return [...sibs];
  }

  // Custom decrossing operator: instead of minimizing edge crossings (the
  // default decrossTwoLayer, and even decrossDfs, derive order from the CURRENT
  // graph shape, so folding a subtree reshuffles unrelated siblings), sort every
  // layer by the fixed ORD key. Dummy nodes on long edges use the average of
  // their endpoints' keys, per the d3-dag custom-decross recipe. Result: sibling
  // order is constant regardless of what's collapsed.
  function stableDecross(layers: SugiNode<LayoutNode, LinkDatum>[][]): void {
    const vals = new Map<SugiNode<LayoutNode, LinkDatum>, number>();
    for (const layer of layers) {
      for (const node of layer) {
        const d = node.data;
        vals.set(
          node,
          d.role === "node"
            ? ORD.get(d.node.data.id)!
            : (ORD.get(d.link.source.data.id)! +
                ORD.get(d.link.target.data.id)!) /
              2,
        );
      }
    }
    for (const layer of layers)
      layer.sort((a, b) => vals.get(a)! - vals.get(b)!);
  }

  function foldableIds(): Set<string> {
    return new Set(HAS_CHILDREN);
  }

  // A node's children in SOURCE order — the order the gallery cycles through,
  // and the same key the compact layout stacks branches by, so "next" in the
  // gallery means "next in the buffer".
  function childrenOf(id: string): string[] {
    return [...(CHILDREN.get(id) ?? [])].sort((a, b) => {
      const ra = srcRank(a);
      const rb = srcRank(b);
      return ra === rb ? 0 : ra - rb;
    });
  }

  // All ids in the subtree rooted at `id` (inclusive). Drives the "focus on a
  // subtree" mode: computeLayout treats this set as the whole world, making
  // `id` the layout root.
  function subtreeIds(id: string): Set<string> {
    const out = new Set<string>([id]);
    const stack = [id];
    while (stack.length > 0) {
      for (const c of CHILDREN.get(stack.pop()!) ?? []) {
        if (!out.has(c)) {
          out.add(c);
          stack.push(c);
        }
      }
    }
    return out;
  }

  // The unique node path from ancestor `fromId` down to descendant `toId`,
  // inclusive (root→leaf order), or null if `fromId` is not an ancestor of
  // `toId`. Each node has at most one parent (proof trees are trees), so we just
  // walk parents up from `toId` until we reach `fromId`.
  function pathBetween(fromId: string, toId: string): string[] | null {
    const path: string[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = toId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      path.push(cur);
      if (cur === fromId) return path.reverse();
      cur = NODE.get(cur)?.parents[0]?.id;
    }
    return null;
  }

  // Lay out the visible subtree. By default a node is hidden iff all its parents
  // are collapsed-or-hidden (the fold rule). If `only` is given, it instead
  // restricts the layout to exactly those ids — used to linearize a single path
  // (see `pathBetween`): with no branches present, Sugiyama renders one column.
  // `focus` (a `subtreeIds` set) scopes the world to one subtree WITHOUT
  // suspending the fold rule: the sweep ignores everything outside it — in
  // particular the focus root's out-of-scope parent, so it lays out as a root
  // and collapsed ancestors outside the subtree can't hide it.
  // `compact` picks the trunk outline (see trunkLayout) over Sugiyama bands;
  // both return the same PlacedNode/PlacedLink shape.
  function computeLayout(
    collapsed: Set<string>,
    only?: Set<string> | null,
    focus?: Set<string> | null,
    compact = false,
    // Compact-mode only: branches spawned by one tactic become side-by-side
    // columns instead of stacking (see trunkLayout).
    sideBySide = false,
    // Ids to force hidden, along with everything only reachable through them.
    // Seeds the same fixpoint sweep the fold rule uses, so a hidden node takes
    // its subtree with it for free. Drives the gallery (one branch at a time).
    hide?: Set<string> | null,
    // Compact-mode only: the SPINE variant — goals keep the trunk, tactic
    // boxes hang off the lane to the right (see trunkLayout's `aside`);
    // `"track"` additionally aligns every tactic to one shared column x.
    aside: boolean | "track" = false,
  ): {
    nodes: PlacedNode[];
    links: PlacedLink[];
    extent: { width: number; height: number };
  } {
    const inScope = (id: string) => !focus || focus.has(id);
    // Hide a node iff ALL in-scope parents are hidden-or-collapsed. Fixpoint
    // sweep. Skipped entirely when `only` drives visibility.
    const hidden = new Set<string>(
      hide ? [...hide].filter((id) => inScope(id)) : [],
    );
    let changed = true;
    while (!only && changed) {
      changed = false;
      for (const n of data) {
        if (!inScope(n.id) || hidden.has(n.id)) continue;
        const parents = n.parents.filter((p) => inScope(p.id));
        if (parents.length === 0) continue; // a true root, or the focus root
        const allParentsGone = parents.every(
          (p) => collapsed.has(p.id) || hidden.has(p.id),
        );
        if (allParentsGone) {
          hidden.add(n.id);
          changed = true;
        }
      }
    }

    const shown = (id: string) =>
      only ? only.has(id) : inScope(id) && !hidden.has(id);

    const visible: LayoutNode[] = data
      .filter((n) => shown(n.id))
      .map((n) => {
        // A context block dropped as a duplicate is put back when the node it
        // duplicated is not in THIS layout (see HYP_ALT): `focus` on the chain
        // and sequence mode both scope the ancestor away, and "already drawn
        // above you" then names nothing on screen. Both records were measured
        // when the engine was built — this picks between them, it never
        // measures.
        const alt = HYP_ALT.get(n.id);
        return {
          ...n,
          parents: n.parents.filter((p) => shown(p.id)),
          foldable: HAS_CHILDREN.has(n.id),
          // Box geometry (label + context block) and the comment strip's, both
          // measured once when the engine was built.
          ...(alt && !shown(alt.src) ? alt.size : SIZE.get(n.id)!),
        };
      });

    if (compact)
      return trunkLayout(visible, srcRank, sideBySide, aside, srcCol);

    const graph = graphStratify().parentData((d: LayoutNode) =>
      d.parents.map((p): [string, LinkDatum] => [p.id, undefined]),
    )(visible);
    const layout = sugiyama()
      .nodeSize((node: GraphNode<LayoutNode, LinkDatum>) => {
        // The comment strip lives INSIDE this node's band, so the vertical
        // reservation is exact by construction: band = comment strip + box +
        // a constant 42 layer gap. Horizontally, widen to the wider of the two
        // so siblings clear a strip that outgrows the box.
        return [
          Math.max(node.data.w, node.data.commentW, node.data.caseW) + 40,
          node.data.caseH +
            node.data.commentBlockH +
            node.data.h +
            node.data.chipH +
            42,
        ] as const;
      })
      .decross(stableDecross) // fixed sibling order, immune to folding
      .coord(coordSimplex());
    const extent = layout(graph);

    // Normalize the d3-dag graph to the shared placed shape (same identity for
    // a link's endpoints and the node list, so the renderer can compare them).
    const byNode = new Map<GraphNode<LayoutNode, LinkDatum>, PlacedNode>(
      [...graph.nodes()].map((n) => [n, { x: n.x, y: n.y, data: n.data }]),
    );
    return {
      nodes: [...byNode.values()],
      links: [...graph.links()].map((l) => ({
        source: byNode.get(l.source)!,
        target: byNode.get(l.target)!,
      })),
      extent,
    };
  }

  // Every node in the proof, visible or not. `computeLayout` returns only what
  // is DRAWN, which is the right answer for the render but the wrong one for
  // anything that has to reason about hidden nodes — the gallery's
  // follow-the-cursor, which must resolve a cursor sitting in the branch it is
  // NOT showing in order to page to it.
  function allNodes(): TreeNode[] {
    return data;
  }

  return {
    foldableIds,
    siblingIds,
    subtreeIds,
    childrenOf,
    allNodes,
    pathBetween,
    computeLayout,
  };
}
