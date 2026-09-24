// THE TOUR: an ordered reading of one proof, browsed with `<` and `>`.
//
// Two SETS of stops, each independently IN or OUT of the reading (two
// booleans, not a three-way choice: the reader only ever wants to say which
// sets are in, and an explicit `all` was a third thing to pick). The AUTHOR's
// is written in the source — a `.mark`
// flag in a step's comment, in the same flag grammar `.fold` / `.none` /
// `.no-hyps` / `.h#` live in (parsed in proofToTree.ts, before markdown
// cleanup, and shipped inside the comments sidecar, so it rides BOTH wires
// without a field of its own). The READER's is a set of node ids held in view
// state, keyed on SOURCE facts like every other id-holding view set: carried
// across a re-parse by `remapIds` and stashed under the proof key, session
// only.
//
// The models are VS Code's CodeTour (ordered steps pinned to lines, prev/next)
// and vim marks (one gesture to drop, one to jump). Nothing here paints or
// hides anything: a stop is a place to LOOK, so the jump peeks a cut open
// rather than dropping it, and the tab beside a stop's box reserves no room.
import type { TreeNode } from "./types";

export interface TourStop {
  /** The node the stop sits on — a step's tactic node for an author stop, any
   tactic or goal node for the reader's. */
  id: string;
  /** The rank the AUTHOR asked for (`.mark 3`), or null for a bare `.mark`
   and for every reader stop. It is not what the tab shows: that is the stop's
   1-based place in the ordered list. */
  rank: number | null;
  caption: string;
  who: "author" | "mine";
}

/** WHICH SETS are in the reading. Two independent toggles, not a kind: the
`source` set is the file's `.mark`s and `temp` the corner nub's drops of this session, and the
list being read is their UNION in one order. There is no "off" and no `all` —
a proof arrives with BOTH on, and the last one on cannot be turned off (there
would be nothing left to read). Not having STARTED is a `tourAt` of null,
held beside this. */
export interface TourLists {
  source: boolean;
  temp: boolean;
}

/** The caption cap, in characters, before the `…`. */
export const CAPTION_MAX = 80;

/** The first sentence of a comment — up to the first `.`/`!`/`?` followed by
whitespace or the end — capped, with `…` where it was cut. Newlines read as
whitespace: the strip already joins its paragraphs for the reader. */
export function firstSentence(text: string, cap = CAPTION_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const m = /[.!?](?=\s|$)/.exec(flat);
  const one = m ? flat.slice(0, m.index + 1) : flat;
  return one.length > cap ? `${one.slice(0, cap - 1).trimEnd()}…` : one;
}

/** What a stop says in the toast and on its `<title>`: the node's comment,
first sentence, and failing that the node's own label. */
export function stopCaption(n: TreeNode): string {
  const c = n.comment && firstSentence(n.comment);
  return c || firstSentence(n.label);
}

/** Source order: the position the node carries, then its place in the tree's
DFS preorder to break a tie (a goal carries its PRODUCER's position, which its
producing tactic shares). */
const orderKey = (n: TreeNode, i: number): [number, number, number] => [
  n.position?.start.line ?? Number.MAX_SAFE_INTEGER,
  n.position?.start.character ?? Number.MAX_SAFE_INTEGER,
  i,
];
const cmpKey = (a: [number, number, number], b: [number, number, number]) =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

type Found = { stop: TourStop; key: [number, number, number] };

/** THE ONE ORDER, whichever list is being read: the stops the author gave an
 explicit rank first (ascending, ties by source position), then everything else
 down the source. A reader stop never carries a rank, so this comparator is
 also plain source order for `mine`. */
const ranked = (found: Found[]): TourStop[] =>
  found
    .sort((a, b) => {
      const ra = a.stop.rank,
        rb = b.stop.rank;
      if (ra !== null && rb !== null) return ra - rb || cmpKey(a.key, b.key);
      if (ra !== null) return -1;
      if (rb !== null) return 1;
      return cmpKey(a.key, b.key);
    })
    .map((x) => x.stop);

const authorFound = (n: TreeNode, i: number): Found | null => {
  const m = n.flags?.mark;
  if (m === undefined) return null;
  return {
    stop: {
      id: n.id,
      rank: m === true ? null : m,
      caption: stopCaption(n),
      who: "author",
    },
    key: orderKey(n, i),
  };
};

/** The author's stops, in reading order: explicit ranks first (ascending, ties
by source position), then every bare `.mark` by source position. */
export function authorStops(nodes: readonly TreeNode[]): TourStop[] {
  const found: Found[] = [];
  nodes.forEach((n, i) => {
    const f = authorFound(n, i);
    if (f) found.push(f);
  });
  return ranked(found);
}

/** BOTH SETS, as one reading. A node that carries a `.mark` AND one of the
 reader's stops appears ONCE, in the author's voice — the author's is the
 stronger claim on it, and it is what the tab's ink then says. Order is the
 same one every list uses (`ranked`): the author's explicit ranks lead, and
 everything else runs down the source. */
export function allStops(
  nodes: readonly TreeNode[],
  mine: ReadonlySet<string>,
): TourStop[] {
  const found: Found[] = [];
  nodes.forEach((n, i) => {
    const f = authorFound(n, i);
    if (f) found.push(f);
    else if (mine.has(n.id))
      found.push({
        stop: { id: n.id, rank: null, caption: stopCaption(n), who: "mine" },
        key: orderKey(n, i),
      });
  });
  return ranked(found);
}

/** The reader's stops, in source order. `mine` is a set of node ids; ids that
no longer name a node (a re-parse dropped one) simply fall out. */
export function myStops(
  nodes: readonly TreeNode[],
  mine: ReadonlySet<string>,
): TourStop[] {
  const out: { stop: TourStop; key: [number, number, number] }[] = [];
  nodes.forEach((n, i) => {
    if (!mine.has(n.id)) return;
    out.push({
      stop: { id: n.id, rank: null, caption: stopCaption(n), who: "mine" },
      key: orderKey(n, i),
    });
  });
  return out.sort((a, b) => cmpKey(a.key, b.key)).map((x) => x.stop);
}

/** THE LIST BEING READ: the union of the enabled sets, in the one order
(`ranked`). With both on this is `allStops` — a node in both appears once, as
the source's; with one on it is that set alone; with neither (a state the view
refuses to enter) it is empty. */
export function tourList(
  nodes: readonly TreeNode[],
  mine: ReadonlySet<string>,
  lists: TourLists,
): TourStop[] {
  if (lists.source && lists.temp) return allStops(nodes, mine);
  if (lists.source) return authorStops(nodes);
  if (lists.temp) return myStops(nodes, mine);
  return [];
}

/** A tactic or goal node can carry a stop; a marker (a ghost, a merged run)
cannot — it stands for something rather than being it. */
export function stoppable(n: TreeNode): boolean {
  return !n.elidedCut && !n.synthetic;
}
