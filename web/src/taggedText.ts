export type TaggedText<T> =
  | { text: string }
  | { append: TaggedText<T>[] }
  | { tag: [T, TaggedText<T>] };

export function flattenTaggedText<T>(tt: TaggedText<T>): string {
  if ("text" in tt) return tt.text;
  if ("append" in tt) return tt.append.map(flattenTaggedText).join("");
  return flattenTaggedText(tt.tag[1]);
}

export function sliceTaggedText<T>(
  tt: TaggedText<T>,
  start: number,
  end: number,
): TaggedText<T> | null {
  let pos = 0;
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

export function taggedSubterms<T>(tt: TaggedText<T>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (t: TaggedText<T>) => {
    if ("append" in t) {
      t.append.forEach(walk);
      return;
    }
    if ("tag" in t) {
      walk(t.tag[1]);
      const s = flattenTaggedText(t.tag[1]).replace(/\s+/g, " ").trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
  };
  walk(tt);
  return out;
}
