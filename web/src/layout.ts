import { coordSimplex, graphStratify, sugiyama } from "d3-dag";
import type { GraphNode, SugiNode } from "d3-dag";
import type {
  HypLine,
  LayoutNode,
  PlacedLink,
  PlacedNode,
  TreeNode,
  WrappedLine,
} from "./types";

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

// Hypothesis (local-context) line geometry, for the block drawn inside a goal
// box. Shared with the render so the room the layout reserves matches what's
// drawn.
const HYP_CHAR_W = 6.6; // headless measureText fallback only
export const HYP_LINE_H = 13;
// Width of the left gutter holding the "used by the consuming tactic" markers;
// reserved only when some line is marked, so unmarked contexts stay tight.
export const HYP_MARK_W = 11;

// ---- Compact ("trunk") layout geometry -------------------------------------
// The compact mode lays the proof out as a scrolling outline (Nuprl-style):
// every node gets its own vertical slot (a global y-cursor — no depth bands),
// and branches indent right off a left-most trunk. Left edges align per
// indent; connectors are orthogonal │└▶ elbows dropped from a column just
// inside the parent box's left edge.
export const TRUNK_INDENT = 56; // horizontal shift of a branched-off subtree
export const TRUNK_INSET = 16; // connector column, from a box's left edge
const TRUNK_GAP_STEP = 14; // goal → the tactic consuming it (one step, tight)
const TRUNK_GAP_BRANCH = 24; // tactic → what it generates; between siblings

// Position visible nodes as a trunk-and-branches outline. A branching
// tactic's FIRST child (Paperproof lists the main continuation first —
// goalsAfter before spawnedGoals) resumes the trunk at the parent's indent;
// the remaining side goals branch right and are drawn ABOVE the resumption,
// so a branch stays local to the tactic that spawned it and the main proof
// line never drifts (the Nuprl text rendering: side goals branch off, the
// continuation resumes below them). The y-cursor is global, so no two bands
// ever overlap and the total height is exactly the content's.
function trunkLayout(visible: LayoutNode[]): {
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
  let cursor = 0;
  let width = 0;

  function place(n: LayoutNode, x0: number): PlacedNode {
    const already = placed.get(n.id);
    if (already) return already; // DAG guard: extra parents just link to it
    const band = n.commentBlockH + n.h;
    // The box is left-aligned at x0; the comment strip too, except parented
    // nodes' strips hang indented off the incoming lane (COMMENT_INDENT).
    // Either may be the widest.
    const eff = Math.max(
      n.w,
      (n.parents.length > 0 && n.commentW > 0 ? COMMENT_INDENT : 0) +
        n.commentW,
    );
    const pn: PlacedNode = { x: x0 + n.w / 2, y: cursor + band / 2, data: n };
    placed.set(n.id, pn);
    nodes.push(pn);
    width = Math.max(width, x0 + eff);
    cursor += band;
    const cs = kids.get(n.id) ?? [];
    // Side branches (children 2..n) first, then the trunk resumes (child 1).
    const trunk = cs[0];
    for (const c of cs.length > 1 ? [...cs.slice(1), trunk] : cs) {
      cursor +=
        n.type === "goal" && cs.length === 1
          ? TRUNK_GAP_STEP
          : TRUNK_GAP_BRANCH;
      const pc = place(c, c === trunk ? x0 : x0 + TRUNK_INDENT);
      links.push({ source: pn, target: pc });
    }
    return pn;
  }

  for (const r of visible.filter((n) => n.parents.length === 0)) {
    if (nodes.length > 0) cursor += TRUNK_GAP_BRANCH;
    place(r, 0);
  }
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

// Semantic seams to prefer when breaking a long line: break BEFORE one of
// these tokens, so the continuation line STARTS with the connective that ties
// it back to the previous line (`∧ 0 + n = n`, `→ ∃ p, …`). Two tiers by
// binding strength: a clause boundary (comma/semicolon, or a low-precedence
// logical connective) beats a relation/definition symbol — breaking at `≤`
// inside `(2 ≤ n → …)` splits an atom that a nearby `∧` seam keeps whole.
const BREAK_BEFORE_STRONG = new Set(["→", "↔", "∧", "∨", "⊢"]);
const BREAK_BEFORE_WEAK = new Set([
  "=", "≠", "≤", "≥", "<", ">", "∣", ":=", ":", "↦",
]);
// Seam quality of a break between adjacent tokens: 2 = clause boundary,
// 1 = relation, 0 = not a seam.
function seamRank(left: string, right: string | undefined): number {
  if (
    left.endsWith(",") ||
    left.endsWith(";") ||
    (right !== undefined && BREAK_BEFORE_STRONG.has(right))
  )
    return 2;
  return right !== undefined && BREAK_BEFORE_WEAK.has(right) ? 1 : 0;
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
): WrappedLine[] {
  const out: WrappedLine[] = [];
  const words = text.split(" ");
  let i = 0;
  while (i < words.length) {
    const cont = out.length > 0;
    const budget = maxW - (cont ? CONT_INDENT : 0);
    // Over-wide token: peel off the widest prefix that fits and go around.
    if (measureText(words[i], fontPx, italic) > budget) {
      const cut = fitPrefix(words[i], budget, fontPx, italic);
      out.push({ text: words[i].slice(0, cut), cont });
      words[i] = words[i].slice(cut);
      continue;
    }
    // Greedy fill, remembering the latest seam of each tier that still fits.
    const seamEnd: (string | null)[] = [null, null, null]; // indexed by rank
    let cur = words[i];
    seamEnd[seamRank(words[i], words[i + 1])] = cur;
    let j = i + 1;
    for (; j < words.length; j++) {
      const cand = cur + " " + words[j];
      if (measureText(cand, fontPx, italic) > budget) break;
      cur = cand;
      seamEnd[seamRank(words[j], words[j + 1])] = cur;
    }
    if (j >= words.length) {
      out.push({ text: cur, cont }); // the rest fits on this line
      break;
    }
    // A clause boundary beats a relation beats the plain word break — as long
    // as the seam doesn't waste most of the line (an early comma shouldn't
    // force a 10%-full line).
    const usable = (s: string | null): s is string =>
      s !== null && measureText(s, fontPx, italic) >= 0.4 * budget;
    const chosen = usable(seamEnd[2])
      ? seamEnd[2]
      : usable(seamEnd[1])
        ? seamEnd[1]
        : cur;
    out.push({ text: chosen, cont });
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
): WrappedLine[] {
  return text
    .split("\n")
    .flatMap((segment) => wrapLine(segment, maxW, fontPx, italic));
}

// Source-comment strip geometry: an italic block drawn at the very TOP of the
// node's band (comment → context label → box, mirroring source order where the
// comment precedes the whole invocation). Wrapped with the same machinery as
// labels — measured italic, because italics are wider. COMMENT_GAP separates
// the strip from whatever sits below it (the hyp label or the box).
export const COMMENT_FONT_PX = 11;
export const COMMENT_LINE_H = 15;
export const COMMENT_GAP = 10;
// Compact mode draws a parented node's incoming connector as a continuous
// lane straight down to the node's content (below the comment strip), and
// hangs the strip to the RIGHT of that lane, git-graph style — so the strip
// is indented past the connector column plus some air. Root comments (no
// incoming lane) stay flush-left.
export const COMMENT_INDENT = TRUNK_INSET + 8;
function commentSize(
  text: string | undefined,
): Pick<LayoutNode, "commentLines" | "commentBlockH" | "commentW"> {
  if (!text)
    return { commentLines: [], commentBlockH: 0, commentW: 0 };
  const commentLines = wrapText(text, WRAP_W, COMMENT_FONT_PX, true);
  const commentW = Math.max(
    ...commentLines.map(
      (l) =>
        (l.cont ? CONT_INDENT : 0) + measureText(l.text, COMMENT_FONT_PX, true),
    ),
  );
  return {
    commentLines,
    commentBlockH: commentLines.length * COMMENT_LINE_H + COMMENT_GAP,
    commentW,
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
): Pick<LayoutNode, "lines" | "w" | "h" | "hypH"> {
  const lines = wrapText(text, WRAP_W);
  const widest = Math.max(
    ...lines.map(
      (l) => (l.cont ? CONT_INDENT : 0) + measureText(l.text, NODE_FONT_PX),
    ),
  );
  const labelW = Math.max(MIN_W, Math.min(MAX_W, widest + 2 * NODE_PAD));
  const hypLines = hyps ?? [];
  const gutter = hypLines.some((l) => l.used) ? HYP_MARK_W : 0;
  const hypW =
    hypLines.length > 0
      ? Math.max(...hypLines.map((l) => measureText(l.text, HYP_FONT_PX))) +
        gutter +
        2 * NODE_PAD
      : 0;
  const hypH = hypLines.length > 0 ? hypLines.length * HYP_LINE_H + HYP_GAP : 0;
  return {
    lines,
    w: Math.max(labelW, hypW),
    h: hypH + lines.length * LINE_H + 2 * NODE_PAD_Y,
    hypH,
  };
}

// A layout engine bound to one tree. Folding state and re-layout are pure
// functions of `data`, so swapping the proof is just building a new engine —
// nothing about the renderer assumes where `data` came from. The return type is
// inferred and surfaced as `LayoutEngine` for the renderer's prop typing.
export type LayoutEngine = ReturnType<typeof createLayoutEngine>;

export function createLayoutEngine(data: TreeNode[]) {
  // Stable left-to-right order key: each node's index in creation order, which
  // is a DFS preorder of the FULL tree. Built from `data` (all nodes), so a
  // node's key never changes when other nodes are hidden by folding.
  const ORD = new Map(data.map((n, i): [string, number] => [n.id, i]));

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

  // Wrapped label lines + box geometry (and the comment strip's), per node. A
  // label never changes for the lifetime of an engine, so measure once here —
  // computeLayout runs on every fold toggle, and re-wrapping every visible
  // label there is pure waste.
  const SIZE = new Map(
    data.map(
      (
        n,
      ): [string, ReturnType<typeof sizeOf> & ReturnType<typeof commentSize>] => [
        n.id,
        { ...sizeOf(n.label, n.hyps), ...commentSize(n.comment) },
      ],
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
  ): {
    nodes: PlacedNode[];
    links: PlacedLink[];
    extent: { width: number; height: number };
  } {
    const inScope = (id: string) => !focus || focus.has(id);
    // Hide a node iff ALL in-scope parents are hidden-or-collapsed. Fixpoint
    // sweep. Skipped entirely when `only` drives visibility.
    const hidden = new Set<string>();
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
      .map((n) => ({
        ...n,
        parents: n.parents.filter((p) => shown(p.id)),
        foldable: HAS_CHILDREN.has(n.id),
        // Box geometry (label + context block) and the comment strip's, both
        // measured once when the engine was built.
        ...SIZE.get(n.id)!,
      }));

    if (compact) return trunkLayout(visible);

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
          Math.max(node.data.w, node.data.commentW) + 40,
          node.data.commentBlockH + node.data.h + 42,
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

  return { foldableIds, siblingIds, subtreeIds, pathBetween, computeLayout };
}
