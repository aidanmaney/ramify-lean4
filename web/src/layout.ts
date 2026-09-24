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

type LinkDatum = undefined;

export const CHAR_W = 7.2;

function resolveCodeFontFamily(): string {
  if (typeof document === "undefined") return "monospace";
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--vscode-editor-font-family")
    .trim();
  return v !== "" ? `${v}, monospace` : "monospace";
}

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

export const NODE_FONT_PX = 12;
export const HYP_FONT_PX = 11;

export const NODE_PAD = 12;
export const NODE_PAD_Y = 5;

const MAX_CHARS = 100;

const WRAP_W = MAX_CHARS * CHAR_W;
const MAX_W = WRAP_W + 2 * NODE_PAD;

export const REFLOW_CHARS = 44;

export const REFLOW_MIN_CHARS = 20;

export const REFLOW_MAX_CHARS = MAX_CHARS;

export type ReflowMode = "off" | number;

const budgetFor = (m: ReflowMode): number =>
  m === "off"
    ? WRAP_W
    : Math.max(REFLOW_MIN_CHARS, Math.min(REFLOW_MAX_CHARS, m)) * CHAR_W;
const MIN_W = 60;

export const measureText = (() => {
  const ctx =
    typeof document !== "undefined"
      ? document.createElement("canvas").getContext("2d")
      : null;

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

export const LINE_H = 16;

export const HYP_GAP = 6;

export const ARROW_GAP = 3;

export const LINK_MARK_OFF = 8;

const HYP_CHAR_W = 6.6;
export const HYP_LINE_H = 13;

export const hypGutterW = (lines: readonly { used?: boolean }[]) =>
  lines.some((l) => l.used) && !lines.every((l) => l.used) ? HYP_MARK_W : 0;
export const HYP_MARK_W = 11;

export const HYP_SEP_H = 7;

/** The vertical CENTRE of hyp line `j`, measured from the top of the context
 block. The ONE coding of that arithmetic: `HypBlock` paints marks, washes and
 hit strips from it, and the provenance connector anchors on it — measurer and
 renderer paired, as the separator's extra height is easy to forget. */
export function hypLineOffset(lines: readonly HypLine[], j: number): number {
  const sepIndex = lines.findIndex((l) => l.sep);
  return (
    (sepIndex >= 0 && j >= sepIndex ? HYP_SEP_H : 0) + (j + 0.5) * HYP_LINE_H
  );
}

export const TRUNK_INDENT = 56;

const SPAWN_INDENT_MAX = 4;
export const TRUNK_INSET = 16;

export const ASIDE_X = TRUNK_INSET + 14;
const ASIDE_DROP = 4;
const ASIDE_CLEAR = 10;
const ASIDE_TRACK_GAP = 24;

function floatsComment(
  aside: boolean | "track",
  d: { type: string; parents: readonly unknown[]; commentBlockH: number },
): boolean {
  return (
    !!aside && d.type === "tactic" && d.parents.length > 0 && d.commentBlockH > 0
  );
}

/** The room a strip drawn BELOW the box takes (`TreeNode.commentBelow`: a
 folded goal's generated summary), 0 for every other node. Like a floated
 strip it is outside the band, so `bandTopH` leaves it out and `inkExtent`,
 `nodeSpan` and the trunk's `bottom` add it back — on the other side. */
export function belowH(d: LayoutNode): number {
  return d.commentBelow && !d.commentFloats && d.commentBlockH > 0
    ? d.commentBlockH - COMMENT_GAP + BELOW_GAP
    : 0;
}

/** Box to strip, for a strip BELOW the box: the trunk's step gap, so a folded
 goal's summary lands where its first step's strip stood in the stacked
 layout while the goal was open (`TRUNK_GAP_STEP` down to that step's band,
 whose strip is the band's first thing). */
const BELOW_GAP = 14;

export function bandTopH(d: LayoutNode): number {
  return d.caseH + (d.commentFloats || belowH(d) > 0 ? 0 : d.commentBlockH);
}

export function inkExtent(d: LayoutNode): { up: number; down: number } {
  const half = (bandTopH(d) + d.h) / 2;
  return {
    up: half + (d.commentFloats ? d.commentBlockH : 0),
    down: half + belowH(d),
  };
}

/** The TOP edge of the comment strip, relative to the node's placed `y` — the
 one coding every paint site (lines, the clamp rule, the `⋯ more` row, the
 comment editor) and `probe overlap` read. Above the box the block is the
 lines then `COMMENT_GAP`; below it (`belowH`) `BELOW_GAP` comes first and
 the lines follow. */
export function commentStripTop(d: LayoutNode): number {
  const top = bandTopH(d);
  const boxTop = (top - d.h) / 2;
  if (belowH(d) > 0) return boxTop + d.h + BELOW_GAP;
  return boxTop - top + (d.commentFloats ? -d.commentBlockH : d.caseH);
}

/** The strip's left inset from the box's left edge in the compact layouts. A
 strip BELOW a goal starts where its first step's strip started while the goal
 was open (that step sits at the goal's own left, its strip `COMMENT_INDENT`
 in), the root goal included. */
export function commentIndentOf(d: {
  parents: readonly unknown[];
  commentBelow?: boolean;
}): number {
  return d.parents.length > 0 || d.commentBelow ? COMMENT_INDENT : 0;
}

export const CHIP_TOP_GAP = 8;
export const CHIP_LANE_H = 15;
const TRUNK_GAP_STEP = 14;
export const TRUNK_GAP_BRANCH = 24;
/** The run below a HOPPED goal: room for the axis break with line on BOTH
 sides of it, so the reader sees the spine pick up again after the cut
 (14px left the break hugging the box — reported as not obviously
 continuing). The break is drawn at the run's midpoint. */
export const TRUNK_GAP_HOP = 34;
const BRANCH_COL_GAP = 18;

function trunkLayout(
  visible: LayoutNode[],
  srcRank: (id: string) => number,

  sideBySide = false,

  aside: boolean | "track" = false,

  srcCol: (id: string) => number = () => Infinity,
): {
  nodes: PlacedNode[];
  links: PlacedLink[];
  extent: { width: number; height: number; trackX?: number };
} {
  const kids = new Map<string, LayoutNode[]>();
  for (const n of visible)
    for (const p of n.parents)
      (kids.get(p.id) ?? kids.set(p.id, []).get(p.id)!).push(n);

  const placed = new Map<string, PlacedNode>();
  const nodes: PlacedNode[] = [];
  const links: PlacedLink[] = [];
  let width = 0;

  let trackFloor = -Infinity;

  const effOf = (n: LayoutNode): number => {
    const indent = commentIndentOf(n);
    return Math.max(
      n.w,
      (n.commentW > 0 ? indent : 0) + n.commentW,
      (n.caseW > 0 ? indent : 0) + n.caseW,
    );
  };

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

    return {
      y0: pn.y - band / 2 - (floats ? d.commentBlockH : 0),
      y1: pn.y + band / 2 + belowH(d),
      lo: left,
      hi: left + effOf(d),
    };
  };

  function linkSpans(l: PlacedLink): Span[] {
    const sd = l.source.data;
    const td = l.target.data;

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
    a.y0 < b.y1 + 1 && b.y0 < a.y1 + 1;

  // global cursor precisely so a column can restart at its sibling's top.
  function place(
    n: LayoutNode,
    x0: number,
    y0: number,
  ): { pn: PlacedNode; bottom: number; right: number } {
    const already = placed.get(n.id);
    if (already)

      return { pn: already, bottom: y0, right: x0 };

    const floats =
      floatsComment(aside, n) &&
      !(sideBySide && (kids.get(n.id) ?? []).length > 1);
    n.commentFloats = floats;
    const below = belowH(n);
    const cB = floats || below > 0 ? 0 : n.commentBlockH;
    const band = n.caseH + cB + n.h;

    const eff = effOf(n);

    const isAside = !!aside && n.type === "tactic" && n.parents.length > 0;

    if (isAside) y0 = Math.max(y0, trackFloor + (floats ? n.commentBlockH : 0));
    const pn: PlacedNode = { x: x0 + n.w / 2, y: y0 + band / 2, data: n };
    placed.set(n.id, pn);
    nodes.push(pn);
    let bottom = y0 + band + below + n.chipH;
    let right = x0 + eff;
    // A strip BELOW a goal reaches right, into the lane the aside modes float
    // tactics (and their strips, which hang ABOVE the tactic) in, so it raises
    // the track's floor exactly as an aside tactic's own box does — else the
    // next floated strip lands on it (`probe overlap`, spine: 2 before this).
    if (aside && below > 0)
      trackFloor = Math.max(trackFloor, y0 + band + below + ASIDE_DROP);

    const cs = (kids.get(n.id) ?? []).slice().sort((a, b) => {
      const ra = srcRank(a.id);
      const rb = srcRank(b.id);

      return ra === rb ? 0 : ra - rb;
    });

    const mainCs = cs.filter((c) => !c.side);
    const sideCs = cs.filter((c) => c.side);
    const order =
      sideCs.length === 0 || mainCs.length === 0
        ? cs
        : sideBySide
          ? [...mainCs, ...sideCs]
          : [...sideCs, ...mainCs];
    if (sideBySide && order.length > 1) {
      const top = bottom + TRUNK_GAP_BRANCH;

      const contour: Span[] = [];
      let colX = x0;

      const floorAtSplit = trackFloor;
      let floorAfter = trackFloor;
      for (const c of order) {
        const isFirst = colX === x0;
        trackFloor = floorAtSplit;

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

          const minLo = Math.min(...spans.map((s) => s.lo));
          shift = Math.min(shift, minLo - x0);
          shift = Math.max(0, shift === Infinity ? 0 : shift);
          if (shift > 0)
            for (const cn of colNodes) cn.x -= shift;
        }

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

    const last = order[order.length - 1];
    const trunk =
      n.ledger !== undefined
        ? undefined
        : n.chain
          ? order.find((c) => c.ledger !== undefined)
          : // B4 — a trace's leaves are ALL side-work: not one of them
            // continues the proof, so none of them takes the trunk lane. The
            // default (`last` resumes the trunk) put the sixth lemma of a
            // `simp` under the step and the other five beside it, which read
            // as though that one were the step's continuation.
            last?.traceLeaf
            ? undefined
            : last;

    const stubY = y0 + n.caseH + cB + n.h / 2;
    const boxBottom = y0 + band + below + n.chipH;
    const mark = nodes.length;

    if (isAside) trackFloor = Math.max(trackFloor, boxBottom + ASIDE_DROP);
    if (isAside) bottom = stubY + ASIDE_CLEAR;
    for (const c of order) {
      const gap = isAside
        ? c === order[0]
          ? 0
          : TRUNK_GAP_BRANCH
        : n.type === "goal" && order.length === 1
          ? c.type === "tactic" && aside
            ? ASIDE_DROP
            : n.folded?.kind === "hop"
              ? TRUNK_GAP_HOP
              : TRUNK_GAP_STEP
          : TRUNK_GAP_BRANCH;

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

      links.push(
        isAside
          ? { source: pn, target: r.pn, lane: x0 + TRUNK_INSET }
          : { source: pn, target: r.pn },
      );
      bottom = r.bottom;
      right = Math.max(right, r.right);
    }
    if (isAside) {
      const parentPn = placed.get(n.parents[0].id);

      let clearX = Math.max(
        x0 + ASIDE_X,
        parentPn
          ? parentPn.x -
              parentPn.data.w / 2 +
              (floats ? effOf(parentPn.data) : parentPn.data.w) +
              ASIDE_TRACK_GAP
          : x0 + ASIDE_X,
      );

      const inkTop = floats ? y0 - n.commentBlockH : y0;
      for (const o of nodes.slice(mark)) {
        const b = nodeSpan(o);
        if (b.y0 < boxBottom && inkTop < b.y1)
          clearX = Math.max(clearX, b.hi + ASIDE_TRACK_GAP);
      }
      pn.x = clearX + n.w / 2;
      right = Math.max(right, clearX + eff);
      bottom = Math.max(bottom, boxBottom);

      trackFloor = Math.max(trackFloor, boxBottom + ASIDE_DROP);
    }
    return { pn, bottom, right };
  }

  let cursor = 0;
  for (const r of visible.filter((n) => n.parents.length === 0)) {
    if (nodes.length > 0) cursor += TRUNK_GAP_BRANCH;
    cursor = place(r, 0, cursor).bottom;
  }

  // The one shared column the aligned pass slides every aside tactic to. It is
  // PUBLISHED (never re-derived downstream) so the view can draw the seam the
  // reflow width is dragged by; nothing here moves because of it.
  let trackX: number | undefined;
  if (aside === "track" && !sideBySide) {
    const isTrack = (pn: PlacedNode) =>
      pn.data.type === "tactic" && pn.data.parents.length > 0;
    trackX = 0;
    for (const pn of nodes)
      if (!isTrack(pn))
        trackX = Math.max(
          trackX,
          pn.x - pn.data.w / 2 + effOf(pn.data) + ASIDE_TRACK_GAP,
        );

    for (const pn of nodes)
      if (isTrack(pn)) pn.x = Math.max(pn.x, trackX + pn.data.w / 2);
  }

  for (const pn of nodes) width = Math.max(width, pn.x - pn.data.w / 2 + effOf(pn.data));
  return { nodes, links, extent: { width, height: cursor, trackX } };
}

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

export const CONT_INDENT = 18;

const NEST_INDENT = 10;

const SEAM_MIN_FILL = 0.4;

const EAGER_MIN_FILL = 0.3;

const EAGER_MIN_SEG = 0.65;

const BREAK_BEFORE_STRONG = new Set([
  "→", "↔", "∧", "∨", "⊢",

  "∀", "∃", "Σ", "λ", "fun",
]);

const BREAK_BEFORE_KEYWORD = new Set([
  "using", "with", "at", "by", "from", "generalizing", ":=",
]);
const BREAK_BEFORE_WEAK = new Set([
  "=", "≠", "≤", "≥", "<", ">", "∣", ":=", ":", "↦",
]);

const OPENERS = "([{⟨";
const CLOSERS = ")]}⟩";

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

function seamRank(
  left: string,
  right: string | undefined,
  depth = 0,
): number {
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

function wrapLine(
  text: string,
  maxW: number,
  fontPx = NODE_FONT_PX,
  italic = false,

  indentMode: "flat" | "nested" | "none" = "flat",

  eagerSeams = indentMode === "nested",
): WrappedLine[] {
  const prose = indentMode === "none";
  const out: WrappedLine[] = [];
  const words = text.split(" ");
  let i = 0;
  let depth = 0;
  while (i < words.length) {
    const cont = out.length > 0;

    const indent =
      !cont || indentMode === "none"
        ? 0
        : indentMode === "nested"
          ? Math.min(CONT_INDENT + depth * NEST_INDENT, maxW * 0.4)
          : CONT_INDENT;
    const budget = maxW - indent;

    if (measureText(words[i], fontPx, italic) > budget) {
      const cut = fitPrefix(words[i], budget, fontPx, italic);
      const head = words[i].slice(0, cut);
      out.push({ text: head, cont, indent, seg: 0 });
      depth += depthDelta(head);
      words[i] = words[i].slice(cut);
      continue;
    }

    const seamLast: (string | null)[] = [null, null, null, null];
    const seamFirst: (string | null)[] = [null, null, null, null];
    const note = (rank: number, line: string, hasMore: boolean) => {
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

    const usable = (s: string | null): s is string =>
      s !== null && measureText(s, fontPx, italic) >= SEAM_MIN_FILL * budget;

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
        ? cur
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

      wrapLine(segment, maxW, fontPx, italic, indentMode, eagerSeams).map(
        (l) => ({ ...l, seg: i }),
      ),
    );
}

export const COMMENT_FONT_PX = 11;

export const COMMENT_LINE_H = 18;
export const COMMENT_GAP = 10;

export const COMMENT_INDENT = TRUNK_INSET + 8;

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

export const COMMENT_CLAMP_MIN = 4;
export const COMMENT_CLAMP_SHOWN = 2;
export const COMMENT_RULE_INDENT = 9;

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

    commentBlockH:
      (commentLines.length + (commentMore ? 1 : 0)) * COMMENT_LINE_H +
      COMMENT_GAP,
    commentW,
    commentMore,
  };
}

/** Room reserved at a goal box's TOP-RIGHT for the corner glyph (`−`, or
 `+N` once folded): `+40` inks ~13px at `BADGE_FONT_PX + 1`, plus its 6px
 inset and a little air. Only a goal that CAN wear the glyph reserves it (one
 with children, or one already folded), and only the TOP line — the line the
 glyph shares — is widened; measured without it, `+2` overprinted a full-width
 first line by 7px on `sum_range_odd` while the bare `−` cleared it by 0.5. */
export const CORNER_W = 22;

/** The ink width of a box's TOP line — the first hyp line (gutter included)
 when there is a context block, else the label's first line. The corner
 control sits at the END of this line, VS Code's fold-badge placement, rather
 than at the box's far right: a goal wider than the panel keeps its right edge
 off-screen, which is how the root's `−` came to be reported as missing. ONE
 coding, read by `sizeOf`'s corner reserve and by the renderer's glyph x. */
export function topLineWidth(
  lines: readonly WrappedLine[],
  hypLines: readonly HypLine[],
): number {
  return hypLines.length > 0
    ? (hypLines[0].indent ?? 0) +
        measureText(hypLines[0].text, HYP_FONT_PX) +
        hypGutterW(hypLines)
    : (lines[0]?.indent ?? 0) +
        measureText(lines[0]?.text ?? "", NODE_FONT_PX);
}

function sizeOf(
  text: string,
  hyps: HypLine[] | undefined,
  reflow: ReflowMode = "off",
  corner = 0,
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
  // The corner glyph shares the box's TOP line: the first hyp line when there
  // is a context block, else the label's first line. Widen only for that.
  const topW = corner > 0 ? topLineWidth(lines, hypLines) : 0;
  return {
    lines,
    hyps: hypLines,
    w: Math.max(labelW, hypW, corner > 0 ? topW + 2 * NODE_PAD + corner : 0),
    h: hypH + lines.length * LINE_H + 2 * NODE_PAD_Y,
    hypH,
  };
}

function hypBlockSize(
  hyps: HypLine[] | undefined,
  reflow: ReflowMode,
): { hypLines: HypLine[]; hypW: number; hypH: number } {
  const budget = budgetFor(reflow);
  const raw = hyps ?? [];

  const gutter = hypGutterW(raw);

  const hypLines: HypLine[] = reflow === "off"
    ? raw
    : raw.flatMap((l) =>
        wrapText(
          l.text,
          budget - gutter,
          HYP_FONT_PX,
          false,
          "nested",

          false,
        ).map(
          (w) => ({
            text: w.text,
            used: l.used,
            cont: w.cont,
            indent: w.indent,
            sep: w.cont ? undefined : l.sep,
            // Provenance rides every wrapped piece: a hypothesis that spills
            // over two lines came from ONE step, and hovering either half must
            // say so.
            origin: l.origin,
            originText: l.originText,
            originLine: l.originLine,
            // D5 — and the hypothesis itself, for the same reason: the rename
            // reads the WHOLE type from whichever piece the pointer is on.
            hypName: l.hypName,
            hypType: l.hypType,
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

  const sepExtra = hypLines.some((l) => l.sep) ? HYP_SEP_H : 0;
  const hypH =
    hypLines.length > 0 ? hypLines.length * HYP_LINE_H + sepExtra + HYP_GAP : 0;
  return { hypLines, hypW, hypH };
}

export type LayoutEngine = ReturnType<typeof createLayoutEngine>;

export interface LayoutEngineOptions {
  reflow?: ReflowMode;

  chips?: boolean;

  comments?: boolean | "instead";

  commentsHidden?: ReadonlySet<string>;

  commentsExpanded?: ReadonlySet<string>;
}

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

    indent: head && !isLedgerHead(r) ? LEDGER_INDENT : 0,
    seg: i,
  }));
  const widest = Math.max(
    ...lines.map((l) => l.indent + measureText(l.text, NODE_FONT_PX)),
  );

  const { hypLines, hypW, hypH } = hypBlockSize(hyps, reflow);
  return {
    lines,
    hyps: hypLines,
    w: Math.max(MIN_W, widest + 2 * NODE_PAD, hypW),
    h: hypH + lines.length * LINE_H + 2 * NODE_PAD_Y,
    hypH,
  };
}

/** A GHOST is the tactic REDUCED IN PLACE: a dashed box the size of one line
 of its head, plus a `+N` badge for whatever else the cut swallowed. ONE
 predicate says which nodes are ghosts, shared with the renderer so measurer
 and paint cannot disagree; a MERGED run is a full box and is deliberately
 not one, and a FOLD mints no node at all (the goal wears the `+N`).

 An AXIS BREAK — two ticks on the trunk lane and an italic caption — was
 built here and rejected: the glyph read as confusing and the reduced-node
 reading was lost. Do not bring it back. */
export const isGhostNode = (d: {
  elidedCut?: { combined?: boolean };
}): boolean => !!d.elidedCut && !d.elidedCut.combined;

/** The `+N` badge. It is a pill at the box's RIGHT edge, so the width rule
 below and the renderer's `x` must agree: the label starts one `NODE_PAD` in,
 the badge ends one `NODE_PAD` in from the other side, and `BADGE_GAP` is
 exactly what lies between them. */
export const BADGE_FONT_PX = 10;
export const BADGE_H = 14;
export const BADGE_PAD = 5;
export const BADGE_GAP = 8;

export function badgeWidth(more: number): number {
  return 2 * BADGE_PAD + measureText(`+${more}`, BADGE_FONT_PX);
}

/** The gap between the trunk lane and the CAPTION beside a hop's axis break
 (`hopCaption`), and that caption's ink. The break is paint on a link, not a
 node, so nothing reserves room for it: these two are what the renderer places
 it with and what the probes measure it as, and they must stay one coding. */
export const HOP_CAPTION_GAP = 8;

export function hopCaptionWidth(text: string, italic: boolean): number {
  return measureText(text, BADGE_FONT_PX, italic);
}

/** A TOUR STOP's numbered tab: `BADGE_H` tall, `BADGE_PAD` either side of the
 number, `BADGE_FONT_PX` ink, STRADDLING the box's top-left corner — centred on
 the corner, so it juts half its width left and half its height up.
 It was hung clear of the LEFT edge first, at the box's mid-height; `probe
 overlap` found 33 collisions in the side-by-side layout, where a right-hand
 column's tab reaches into the left column's comment strips and boxes. The
 corner halves the reach in both axes and sweeps clean (0 over 730 layouts).
 Like the hop caption this is PAINT — nothing reserves room for it — so the
 renderer and the probe place it from this one width, and stay one coding. */
export function tourTabWidth(n: number): number {
  return 2 * BADGE_PAD + measureText(String(n), BADGE_FONT_PX);
}

function ghostSize(
  label: string,
  more: number,
  italic: boolean,
): Pick<LayoutNode, "lines" | "w" | "h" | "hypH" | "hyps"> {
  return {
    // ONE line, never wrapped: the head is already cut to length by
    // `tacticHead`, and a ghost that grew to two lines would stop reading as
    // a reduction of the box it replaced.
    lines: [{ text: label, cont: false, indent: 0, seg: 0 }],
    hyps: [],
    w: Math.max(
      MIN_W,
      2 * NODE_PAD +
        measureText(label, NODE_FONT_PX, italic) +
        (more > 0 ? BADGE_GAP + badgeWidth(more) : 0),
    ),
    h: LINE_H + 2 * NODE_PAD_Y,
    hypH: 0,
  };
}

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

type SizeRec = ReturnType<typeof sizeOf> &
  ReturnType<typeof commentSize> &
  ReturnType<typeof caseSize> &
  Pick<LayoutNode, "chipH" | "proseLabel">;

export function createLayoutEngine(
  data: TreeNode[],
  {
    reflow = "off",
    chips = false,
    comments = true,
    commentsHidden,
    commentsExpanded,
  }: LayoutEngineOptions = {},
) {
  const ORD = new Map<string, number>();

  const HAS_CHILDREN = new Set(data.flatMap((n) => n.parents.map((p) => p.id)));

  const CHILDREN = new Map<string, string[]>();
  for (const n of data)
    for (const p of n.parents)
      (CHILDREN.get(p.id) ?? CHILDREN.set(p.id, []).get(p.id)!).push(n.id);
  const NODE = new Map(data.map((n): [string, TreeNode] => [n.id, n]));

  // The same index by NODE rather than by id, for elide.ts's cut rules
  // (`goalCut`, `outlineCuts`). Built once per engine: the rules are asked
  // per layout, and rebuilding the index there would cost a pass over the
  // whole tree on every click.
  const KIDS = new Map<string, TreeNode[]>();
  for (const n of data)
    for (const p of n.parents)
      (KIDS.get(p.id) ?? KIDS.set(p.id, []).get(p.id)!).push(n);

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

  // A FOLDED goal stands in for the positions it swallowed, exactly as a
  // marker does: a goal alone carries only its PRODUCER's position, which
  // every sibling under a split shares, so with its subtree gone a folded
  // case tied with its siblings and changed places in the tree (reported).
  const ownPositions = (n: TreeNode): ProofStepPosition[] =>
    n.type !== "tactic"
      ? (n.folded?.parts ?? []).flatMap((p) => (p.position ? [p.position] : []))
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

  const SRC = subtreeMin((n) =>
    ownMin(n, (p) => p.start.line * 1e4 + p.start.character),
  );
  const srcRank = (id: string) => SRC.get(id) ?? Infinity;

  const COL = subtreeMin((n) => ownMin(n, (p) => p.start.character));
  const srcCol = (id: string) => COL.get(id) ?? Infinity;

  data
    .map((n, i) => ({ n, i }))
    .sort((a, b) => {
      const ra = srcRank(a.n.id);
      const rb = srcRank(b.n.id);
      return ra === rb ? a.i - b.i : ra - rb;
    })
    .forEach(({ n }, rank) => ORD.set(n.id, rank));

  const BY_ID = new Map(data.map((n) => [n.id, n]));

  const HYP_ALT = new Map<string, { src: string; size: SizeRec }>();
  const SIZE = new Map(
    data.map(
      (n): [string, SizeRec] => {
        const hideComment =
          !comments || (commentsHidden?.has(n.id) ?? false);

        // A GHOST carries a box and its one head line, but no context, no
        // strip and no case badge — the chrome is paired with `undefined`
        // rather than skipped so every downstream reader (`bandTopH`,
        // `inkExtent`, `nodeSpan`, `linkSpans`, Sugiyama's `nodeSize`) simply
        // sees a node with none of it, and `floatsComment` needs
        // `commentBlockH > 0` so a ghost can never float either. A marker is
        // minted by `applyElisions` with no comment and no case label, so this
        // is what the generic branch would compute anyway; stating it keeps
        // the ghost's size in one place.
        if (isGhostNode(n))
          return [
            n.id,
            {
              ...ghostSize(
                n.label,
                n.elidedCut?.tactics.length ?? 1,
                // Italic for a `.none` note (the author's sentence) and for
                // any SEEDED cut (the author's hand). The `§` mark is already
                // in `n.label`, so this measures exactly what is painted.
                !!n.elidedCut?.note || !!n.elidedCut?.seeded,
              ),
              ...commentSize(undefined, reflow),
              ...caseSize(undefined),
              chipH: 0,
              proseLabel: undefined,
            },
          ];

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
            ...sizeOf(
              n.label,
              n.hyps,
              reflow,
              n.type === "goal" && (HAS_CHILDREN.has(n.id) || !!n.folded)
                ? CORNER_W
                : 0,
            ),
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

  // The SPLITS — every node with more than one child, which is what the
  // gallery pages between. It used to ask the fold gate, which was a
  // coincidence rather than a rule (that gate only ever excluded goals with
  // exactly ONE child, which are never splits); now it asks the question it
  // means.
  function splitIds(): Set<string> {
    const out = new Set<string>();
    for (const id of HAS_CHILDREN)
      if ((KIDS.get(id) ?? []).length > 1) out.add(id);
    return out;
  }

  // What `collapse all` writes: a `fold` cut on each branch root (see
  // elide.ts's `outlineCuts`), so the trunk stays drawn with one break per
  // branch, each reopening it.



  function childrenOf(id: string): string[] {
    return [...(CHILDREN.get(id) ?? [])].sort((a, b) => {
      const ra = srcRank(a);
      const rb = srcRank(b);
      return ra === rb ? 0 : ra - rb;
    });
  }

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

  function computeLayout(
    only?: Set<string> | null,
    focus?: Set<string> | null,
    compact = false,

    sideBySide = false,

    hide?: Set<string> | null,

    aside: boolean | "track" = false,
  ): {
    nodes: PlacedNode[];
    links: PlacedLink[];
    extent: { width: number; height: number; trackX?: number };
  } {
    const inScope = (id: string) => !focus || focus.has(id);

    const hidden = new Set<string>(
      hide ? [...hide].filter((id) => inScope(id)) : [],
    );
    // The sweep carries the `hide` SEEDS (the gallery's unshown branches,
    // to-cursor's tail) down the tree: a node is hidden when every parent it
    // still has in scope is gone, and a hidden node takes its own children
    // with it unless another parent still reaches them. Folding no longer
    // enters here at all — a fold is an `ElideCut` applied to the node list
    // BEFORE the engine, so the nodes it takes are simply not in `data`.
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of data) {
        if (!inScope(n.id) || hidden.has(n.id)) continue;
        const parents = n.parents.filter((p) => inScope(p.id));
        if (parents.length === 0) continue;
        if (parents.every((p) => hidden.has(p.id))) {
          hidden.add(n.id);
          changed = true;
        }
      }
    }

    // `only` NARROWS — it never suspends the sweep. Sequence view used to
    // skip it entirely; the path scope (its one caller now) composes with the
    // gallery's and to-cursor's `hide` seed for free.
    const shown = (id: string) =>
      inScope(id) && !hidden.has(id) && (!only || only.has(id));

    const visible: LayoutNode[] = data
      .filter((n) => shown(n.id))
      .map((n) => {
        const alt = HYP_ALT.get(n.id);
        return {
          ...n,
          parents: n.parents.filter((p) => shown(p.id)),
          hasChildren: HAS_CHILDREN.has(n.id),

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
        return [
          Math.max(node.data.w, node.data.commentW, node.data.caseW) + 40,
          node.data.caseH +
            node.data.commentBlockH +
            node.data.h +
            node.data.chipH +
            42,
        ] as const;
      })
      .decross(stableDecross)
      .coord(coordSimplex());
    const extent = layout(graph);

    // Sugiyama centres the node's WHOLE reserved height on `n.y`; a strip
    // below the box makes the ink asymmetric about the band, so the band is
    // lifted by half the strip and the ink is centred on the layer again.
    const byNode = new Map<GraphNode<LayoutNode, LinkDatum>, PlacedNode>(
      [...graph.nodes()].map((n) => [
        n,
        { x: n.x, y: n.y - belowH(n.data) / 2, data: n.data },
      ]),
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

  function allNodes(): TreeNode[] {
    return data;
  }

  return {
    splitIds,
    subtreeIds,
    childrenOf,
    allNodes,
    pathBetween,
    computeLayout,
  };
}
