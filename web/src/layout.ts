import { coordSimplex, graphStratify, sugiyama } from "d3-dag";
import type { GraphNode, SugiNode } from "d3-dag";
import type { LayoutNode, TreeNode } from "./types";

// Data carried on each link: the hypotheses introduced along that edge, if any
// (goal→tactic edges carry none).
type LinkDatum = string | undefined;

const CHAR_W = 7.2;
// Inner padding of a node box. Exported so the render can left-inset its text by
// the same amount the geometry reserves.
export const NODE_PAD = 12;
// Wrap node labels at a modern ~100-column line before growing the box; the box
// width is still content-driven (MIN_W..MAX_W), this is just the wrap point.
const MAX_CHARS = 100;
const MAX_W = MAX_CHARS * CHAR_W + 2 * NODE_PAD;
const MIN_W = 60;

// Shared geometry: sets both a node's box height (in sizeOf) and the tspan line
// spacing in the render, so the two must agree.
export const LINE_H = 16;

// Vertical breathing room between a hypothesis label's bottom edge and the top
// of the goal node it annotates, and between an arrowhead and that node. Shared
// with the render (App.tsx) and with the layer-gap reservation in nodeSize so
// the box the layout reserves matches what's drawn.
export const HYP_GAP = 22;
export const ARROW_GAP = 8;

// Hypothesis (local-context) label geometry. Shared with the render in App.tsx
// so the box the layout reserves room for matches the box actually drawn.
export const HYP_CHAR_W = 6.6;
export const HYP_LINE_H = 13;
export const HYP_PAD = 5;

// Box size of a hypothesis label (empty when there's no hyp). Uses code-point
// length so wide unicode in Lean contexts measures consistently.
export function hypSize(text: string | undefined): { w: number; h: number } {
  if (!text) return { w: 0, h: 0 };
  const lines = text.split("\n");
  const longest = Math.max(...lines.map((l) => [...l].length));
  return {
    w: longest * HYP_CHAR_W + 2 * HYP_PAD,
    h: lines.length * HYP_LINE_H + 2 * HYP_PAD,
  };
}

// Width-wrap a single line (no newlines) at word boundaries.
function wrapLine(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? cur + " " + w : w;
    if (candidate.length <= maxChars || !cur) cur = candidate;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Honor explicit newlines in the label first, then width-wrap each segment.
function wrapText(text: string, maxChars: number): string[] {
  return text.split("\n").flatMap((segment) => wrapLine(segment, maxChars));
}

// Compute the wrapped label lines and box geometry for a node label.
function sizeOf(text: string): Pick<LayoutNode, "lines" | "w" | "h"> {
  const lines = wrapText(text, MAX_CHARS);
  const longest = Math.max(...lines.map((l) => l.length));
  return {
    lines,
    w: Math.max(MIN_W, Math.min(MAX_W, longest * CHAR_W + 2 * NODE_PAD)),
    h: lines.length * LINE_H + 2 * NODE_PAD,
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

  function computeLayout(collapsed: Set<string>) {
    // Hide a node iff ALL parents are hidden-or-collapsed. Fixpoint sweep.
    const hidden = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of data) {
        if (hidden.has(n.id) || n.parents.length === 0) continue;
        const allParentsGone = n.parents.every(
          (p) => collapsed.has(p.id) || hidden.has(p.id),
        );
        if (allParentsGone) {
          hidden.add(n.id);
          changed = true;
        }
      }
    }

    const visible: LayoutNode[] = data
      .filter((n) => !hidden.has(n.id))
      .map((n) => ({
        ...n,
        parents: n.parents.filter((p) => !hidden.has(p.id)),
        foldable: HAS_CHILDREN.has(n.id),
        // A node has at most one parent edge carrying hyps; treat it as the
        // subgoal's context, drawn above the node.
        incHyp: n.parents.map((p) => p.hyps).find(Boolean),
        ...sizeOf(n.label),
      }));

    const graph = graphStratify().parentData((d: LayoutNode) =>
      d.parents.map((p): [string, LinkDatum] => [p.id, p.hyps]),
    )(visible);
    const layout = sugiyama()
      .nodeSize((node: GraphNode<LayoutNode, LinkDatum>) => {
        // Reserve room for the hyp label drawn above this node: widen so
        // siblings spread enough to clear it horizontally, and grow the layer
        // gap to fit it vertically (90 stays the floor for the short-hyp case).
        const hb = hypSize(node.data.incHyp);
        return [
          Math.max(node.data.w, hb.w) + 40,
          // Layer gap must fit: the hyp box, HYP_GAP below it to the node, and
          // the arrow descending from the parent. Keep 100 as the floor for the
          // no-hyp / short-hyp case.
          node.data.h + Math.max(100, hb.h + HYP_GAP + 40),
        ] as const;
      })
      .decross(stableDecross) // fixed sibling order, immune to folding
      .coord(coordSimplex());
    const extent = layout(graph);

    return { nodes: [...graph.nodes()], links: [...graph.links()], extent };
  }

  return { foldableIds, siblingIds, computeLayout };
}
