// Pure manipulation of the infoview's TaggedText tree — the shape of
// `CodeWithInfos` (`Lean.Widget.TaggedText SubexprInfo` on the wire). Declared
// structurally here rather than imported so this module stays dependency-free
// (it is generic tree surgery; only widget-land composes it with the infoview).
//
// Why slicing exists: the layout wraps a goal's pretty-printed text into lines
// by *measured pixel width* (layout.ts `wrapText`), and the SVG boxes are sized
// to exactly those lines. To render the tagged (hover-interactive) version of
// the same text without a second, subtly different CSS wrapping, we cut the
// TaggedText at the very character offsets of the layout's line breaks and
// render one non-wrapping piece per line. A tag spanning a break is duplicated
// onto both halves — both slices then reference the same subexpression info,
// so hover works on either.

export type TaggedText<T> =
  | { text: string }
  | { append: TaggedText<T>[] }
  | { tag: [T, TaggedText<T>] };

/** The plain text of a TaggedText, tags stripped. */
export function flattenTaggedText<T>(tt: TaggedText<T>): string {
  if ("text" in tt) return tt.text;
  if ("append" in tt) return tt.append.map(flattenTaggedText).join("");
  return flattenTaggedText(tt.tag[1]);
}

/**
 * The subtree covering flat-text offsets [start, end), or null when empty.
 * Tags intersecting the range are kept (wrapping just the retained part).
 */
export function sliceTaggedText<T>(
  tt: TaggedText<T>,
  start: number,
  end: number,
): TaggedText<T> | null {
  let pos = 0; // running offset into the flat text, advanced by every leaf
  function go(t: TaggedText<T>): TaggedText<T> | null {
    if ("text" in t) {
      const s = pos;
      pos += t.text.length;
      const lo = Math.max(start, s);
      const hi = Math.min(end, pos);
      if (lo >= hi) return null;
      return { text: t.text.slice(lo - s, hi - s) };
    }
    if ("append" in t) {
      const parts = t.append
        .map(go)
        .filter((x): x is TaggedText<T> => x !== null);
      if (parts.length === 0) return null;
      return parts.length === 1 ? parts[0] : { append: parts };
    }
    const inner = go(t.tag[1]);
    return inner ? { tag: [t.tag[0], inner] } : null;
  }
  return go(tt);
}

/**
 * Match the layout's wrapped `lines` back onto the flat text they were wrapped
 * from, returning each line's [start, end) offsets — or null if they don't
 * reconstruct it exactly (then the caller falls back to plain rendering).
 *
 * A break consumed either one separator character (the space at a word wrap,
 * the newline of an explicit line break) or nothing (a hard break inside an
 * over-wide token), so between lines we skip one separator iff one is there.
 *
 * Always exact: both callers pass the very string the layout wrapped (a goal's
 * tagged print, a tactic node's label), so a partial match means something is
 * wrong and the caller should fall back to plain text. Tactic colouring used to
 * pass the step's SOURCE here and needed a prefix-match relaxation to cope;
 * it now aligns the source into the label instead (tacticTokens.ts
 * `alignInLabel`), which handles the misalignments a prefix test could not.
 */
export function lineOffsets(
  flat: string,
  lines: string[],
): [number, number][] | null {
  const out: [number, number][] = [];
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && (flat[pos] === " " || flat[pos] === "\n")) pos += 1;
    if (!flat.startsWith(lines[i], pos)) return null;
    out.push([pos, pos + lines[i].length]);
    pos += lines[i].length;
  }
  return pos === flat.length ? out : null;
}
