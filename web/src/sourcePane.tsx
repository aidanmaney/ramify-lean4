// SOURCE PANE — the static viewer's read-only view of the proof's own file.
//
// It stands where the editor stands for the widget: clicking a line moves the
// CURSOR there (the view follows a cursor exactly as it follows the editor's —
// peeking seeded cuts, accenting the node), and `»` on a node scrolls here and
// washes the step's tight range (the widget's `revealPosition` fallback).
//
// Colouring is two layers. A small Lean lexer paints the whole file (comments,
// strings, numbers, command keywords), and the SEMANTIC tokens the payload
// carries for every tactic and declaration header — the server's own, the ones
// the tree's labels are painted with — are laid over it, so a tactic reads the
// same colour in the pane as in its box.
import { memo, useEffect, useMemo, useRef, type MouseEvent } from "react";
import { lexPaint, type Paint } from "./sourceLex";
import { TOKEN_COLOR } from "./theme";
import type { TacticToken } from "./tacticCore";

type LspPos = { line: number; character: number };
export type SourceRange = { start: LspPos; stop: LspPos };

interface Seg {
  text: string;
  paint: Paint;
}

/** One line cut into runs of equal paint. */
function segmentsOf(text: string, paint: Paint[]): Seg[] {
  const out: Seg[] = [];
  let a = 0;
  for (let k = 1; k <= text.length; k++) {
    if (k === text.length || paint[k] !== paint[a]) {
      out.push({ text: text.slice(a, k), paint: paint[a] });
      a = k;
    }
  }
  return out;
}

/** The line's runs as spans, cut at the wash's edges so the colours stay. */
function paintRuns(segs: Seg[], hl: [number, number] | null) {
  const out = [];
  let from = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const to = from + s.text.length;
    const color = s.paint ? TOKEN_COLOR[s.paint] : undefined;
    const style = color ? { color } : undefined;
    if (!hl || hl[1] <= from || hl[0] >= to) {
      out.push(
        <span key={i} style={style}>
          {s.text}
        </span>,
      );
    } else {
      const cuts = [from, Math.max(from, hl[0]), Math.min(to, hl[1]), to];
      for (let k = 0; k < 3; k++)
        if (cuts[k + 1] > cuts[k])
          out.push(
            <span
              key={`${i}.${k}`}
              className={k === 1 ? "ptw-src-hl" : undefined}
              style={style}
            >
              {s.text.slice(cuts[k] - from, cuts[k + 1] - from)}
            </span>,
          );
    }
    from = to;
  }
  return out;
}

const Line = memo(function Line({
  n,
  segs,
  cursorCol,
  hl,
  inDecl,
}: {
  n: number;
  segs: Seg[];
  /** The cursor's column when it is on this line. */
  cursorCol: number | null;
  /** The washed columns on this line, `[from, to)`. */
  hl: [number, number] | null;
  inDecl: boolean;
}) {
  const parts = paintRuns(segs, hl);
  return (
    <div
      className={
        "ptw-src-line" +
        (cursorCol !== null ? " ptw-src-cursor" : "") +
        (inDecl ? " ptw-src-decl" : "")
      }
      data-line={n}
    >
      <span className="ptw-src-gutter" aria-hidden>
        {n + 1}
      </span>
      <span className="ptw-src-text" data-text>
        {parts.length ? parts : "​"}
      </span>
    </div>
  );
});

/** The column under a click: the caret the browser would put there, counted
 over the line's own text (the gutter is not counted). */
function columnAt(e: MouseEvent, textEl: Element): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const pos = doc.caretPositionFromPoint?.(e.clientX, e.clientY);
  if (pos) {
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    const r = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (!node || !textEl.contains(node)) return null;
  const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
  let col = 0;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t === node) return col + offset;
    col += (t.textContent ?? "").length;
  }
  return null;
}

export default function SourcePane({
  source,
  tokens,
  cursor,
  highlight,
  declRange,
  onCursor,
}: {
  source: string;
  /** The server's semantic tokens: every tactic's and every header's. */
  tokens: TacticToken[];
  cursor: LspPos | null;
  /** The range `»` asked to see, washed and scrolled to. */
  highlight: SourceRange | null;
  /** The shown proof's declaration, marked in the gutter. */
  declRange: SourceRange | null;
  onCursor: (p: LspPos) => void;
}) {
  const lines = useMemo(() => source.split("\n"), [source]);
  const segs = useMemo(() => {
    const paint = lexPaint(source);
    const starts: number[] = [];
    let off = 0;
    for (const l of lines) {
      starts.push(off);
      off += l.length + 1;
    }
    for (const t of tokens) {
      if (t.start.line !== t.stop.line) continue;
      const base = starts[t.start.line];
      if (base === undefined) continue;
      for (let k = t.start.character; k < t.stop.character; k++)
        // As the type is: a `const` has no TOKEN_COLOR, so it stays in the
        // foreground here exactly as it does in the tree's labels.
        paint[base + k] = t.type;
    }
    return lines.map((l, i) =>
      segmentsOf(l, paint.slice(starts[i], starts[i] + l.length)),
    );
  }, [source, lines, tokens]);

  const scroller = useRef<HTMLDivElement>(null);
  // Read by the declaration effect below; kept in a ref so the effect runs
  // on a declaration change alone.
  const cursorLineRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    cursorLineRef.current = cursor?.line;
  }, [cursor]);
  // `»` scrolls the range into view; a cursor set by a click here is already
  // in view, and one set elsewhere (a deep link) is brought in once.
  useEffect(() => {
    const target = highlight?.start ?? null;
    if (!target) return;
    const el = scroller.current?.querySelector(`[data-line="${target.line}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);

  // A newly shown declaration is brought into view — unless the cursor line
  // or the declaration's first line already is (a click here that crossed
  // into another declaration must not move the pane under the pointer).
  const declStart = declRange?.start.line ?? null;
  useEffect(() => {
    const box = scroller.current;
    if (!box || declStart === null) return;
    const seen = (n: number | undefined) => {
      if (n === undefined) return false;
      const el = box.querySelector(`[data-line="${n}"]`);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      return r.bottom > b.top && r.top < b.bottom;
    };
    if (seen(declStart) || seen(cursorLineRef.current)) return;
    box
      .querySelector(`[data-line="${declStart}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [declStart]);

  const hlOn = (n: number): [number, number] | null => {
    if (!highlight) return null;
    const { start, stop } = highlight;
    if (n < start.line || n > stop.line) return null;
    return [
      n === start.line ? start.character : 0,
      n === stop.line ? stop.character : lines[n].length,
    ];
  };

  return (
    <div
      ref={scroller}
      className="ptw-src"
      role="region"
      aria-label="Source"
      onClick={(e) => {
        const lineEl = (e.target as Element).closest("[data-line]");
        if (!lineEl) return;
        const n = Number(lineEl.getAttribute("data-line"));
        const textEl = lineEl.querySelector("[data-text]");
        const col = textEl ? columnAt(e, textEl) : null;
        // A click left of the text (the gutter) or past its end lands on the
        // line's first written character, where the editor would put a
        // reader looking at that line.
        const first = lines[n].search(/\S/);
        onCursor({
          line: n,
          character: col ?? Math.max(0, first),
        });
      }}
    >
      {segs.map((s, n) => (
        <Line
          key={n}
          n={n}
          segs={s}
          cursorCol={cursor?.line === n ? cursor.character : null}
          hl={hlOn(n)}
          inDecl={
            !!declRange && n >= declRange.start.line && n <= declRange.stop.line
          }
        />
      ))}
    </div>
  );
}
