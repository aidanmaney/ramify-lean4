// The doc card's markdown (docTip.tsx): a docstring as blocks, its first
// paragraph, and the inline markers reduced to what is drawn. Pure.

export type DocBlock = { kind: "para"; text: string } | { kind: "code"; text: string };

/** A docstring as blocks: fenced code (```…```) verbatim, every other run of
 non-blank lines one paragraph (a list item or a heading starts its own). */
export function docBlocks(md: string): DocBlock[] {
  const out: DocBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "para", text: para.join(" ") });
    para = [];
  };
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = /^\s*(```+|~~~+)/.exec(l);
    if (fence) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) {
        code.push(lines[i]);
        i++;
      }
      out.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const t = l.trim();
    if (t === "") {
      flush();
      continue;
    }
    if (/^(#{1,6}\s|[*+-]\s|\d+[.)]\s)/.test(t)) flush();
    para.push(t.replace(/^#{1,6}\s+/, "").replace(/^[*+-]\s+/, "• "));
  }
  flush();
  return out;
}

/** The inline markdown a paragraph may carry, reduced to what is drawn:
 emphasis markers and link targets go, `code` spans stay for `CodeText`. */
export const inlinePlain = (s: string): string =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1");

/** The docstring's first paragraph, and whether anything follows it. */
export function docLead(md: string): { lead: string; more: boolean } {
  const blocks = docBlocks(md);
  const i = blocks.findIndex((b) => b.kind === "para");
  return {
    lead: i >= 0 ? inlinePlain(blocks[i].text) : "",
    more: blocks.length > (i >= 0 ? 1 : 0),
  };
}

