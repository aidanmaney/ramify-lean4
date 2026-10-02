// The source pane's whole-file lexer: comments, strings, numbers and command
// keywords, as `TOKEN_COLOR` types. The server's own semantic tokens are laid
// over it wherever the payload has them (every tactic, every header); this is
// what colours the rest of the file. Pure, so a probe can run it.

/** Words the lexer paints as keywords outside the server's tokens: the
 command vocabulary plus the tactic-block words a reader meets at the top
 level. Inside a proof the server's own tokens win. */
const KEYWORDS = new Set(
  (
    "theorem lemma def example abbrev instance structure class inductive where " +
    "extends deriving namespace section end open import variable universe " +
    "noncomputable private protected partial unsafe set_option attribute " +
    "macro syntax notation infix infixl infixr prefix postfix mutual " +
    "by fun λ have show from let in if then else do match with at calc " +
    "return for unless termination_by decreasing_by sorry"
  ).split(" "),
);

export type Paint = string | null;

/** Lexer paint for every UTF-16 unit of `src` (the LSP column unit). */
export function lexPaint(src: string): Paint[] {
  const out: Paint[] = new Array(src.length).fill(null);
  const fill = (a: number, b: number, t: string) => {
    for (let k = a; k < b; k++) out[k] = t;
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "-" && src[i + 1] === "-") {
      const e = src.indexOf("\n", i);
      const stop = e < 0 ? src.length : e;
      fill(i, stop, "comment");
      i = stop;
    } else if (c === "/" && src[i + 1] === "-") {
      // Nested block comments, as Lean nests them.
      let depth = 0;
      let j = i;
      while (j < src.length) {
        if (src[j] === "/" && src[j + 1] === "-") {
          depth++;
          j += 2;
        } else if (src[j] === "-" && src[j + 1] === "/") {
          depth--;
          j += 2;
          if (depth === 0) break;
        } else j++;
      }
      fill(i, j, "comment");
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      fill(i, Math.min(j + 1, src.length), "string");
      i = j + 1;
    } else if (/[0-9]/.test(c) && !/[\p{L}\p{N}_.']/u.test(src[i - 1] ?? " ")) {
      let j = i;
      while (j < src.length && /[0-9_.xXa-fA-F]/.test(src[j])) j++;
      fill(i, j, "number");
      i = j;
    } else if (/[\p{L}_λ]/u.test(c)) {
      let j = i;
      while (j < src.length && /[\p{L}\p{N}_.'!?]/u.test(src[j])) j++;
      const word = src.slice(i, j);
      if (KEYWORDS.has(word)) fill(i, j, word === "sorry" ? "leanSorryLike" : "keyword");
      i = j;
    } else i++;
  }
  return out;
}

