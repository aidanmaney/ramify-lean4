// THE PLAYGROUND'S TEXT — the editor is the source of truth (playground.tsx).
//
// The visitor writes the proof as Lean text in the editor; every edit replays
// the WHOLE body through `play()` (baked table first, then the live engine),
// with Lean's own tactic-block semantics, into the `Attempt`s `buildProof`
// draws. Every tree gesture is a TEXT EDIT computed here (an open goal's
// `Anchor`, a step's tight range, the delete gesture's `TacticSlot`s), so the
// tree writes the text and the text redraws the tree, as in VS Code.
//
// What is understood (by line, by indentation — Lean's column rule):
//
//   tactic            runs on the MAIN goal (the first of the block's goals);
//                     lines indented deeper than it continue it
//                     (`induction n with` / `| zero => rfl` …)
//   · tactics         a bullet: focuses the main goal, its block below at the
//                     column after `· `
//   case tag => …     focuses the goal tagged `tag` (rest of line, or a block)
//   sorry             leaves the main goal OPEN (the page's own convention:
//                     a pending goal is `sorry`, so the text checks in Lean)
//   -- comment        ignored, as is a trailing `-- …`
//
// A tactic that fails stops its block (Lean stops there too); a `·` block
// recovers, so its siblings still run. A tactic the table lacks while live
// Lean is off stops its block the same way, with a note instead of an error.
// Pure but for `answer` (async): `probe playground` can run it offline.
import type { RawDiagnostic } from "./diagnostics";
import type { DocEdit } from "./calcEdit";
import type { ProofStepPosition, SourceComment, TacticSlot } from "./paperproof";
import {
  NOT_BAKED,
  play,
  type Aliases,
  type Attempt,
  type Engine,
  type Play,
  type Table,
} from "./playgroundAnswer";

type Pos = { line: number; character: number };

/** One physical line's content as a block sees it: where it starts (`col`)
 and its text without indentation or a trailing comment. */
interface Seg {
  line: number;
  col: number;
  text: string;
}

/** One `| tag binders => …` alternative of a `cases`/`induction … with`. */
interface Alt {
  seg: Seg;
  tag: string;
  binders: string[];
  items: Item[];
  col: number;
}

type Item =
  | { kind: "tactic"; segs: Seg[] }
  | { kind: "alts"; head: Seg; alts: Alt[] }
  | { kind: "bullet"; seg: Seg; items: Item[]; col: number }
  | { kind: "case"; seg: Seg; tag: string; items: Item[]; col: number };

const ROOT = "g0";

/** A line's code without its comment (`--` outside a string). */
function stripComment(s: string): string {
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== "\\") inStr = !inStr;
    else if (!inStr && c === "-" && s[i + 1] === "-") return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

/** The body's segments (line 0 is the declaration header). Block comments
 (`/- … -/`) are skipped whole. */
export function segments(doc: string): Seg[] {
  const out: Seg[] = [];
  const lines = doc.split("\n");
  let inBlock = false;
  for (let line = 1; line < lines.length; line++) {
    const raw = lines[line];
    if (inBlock) {
      if (raw.includes("-/")) inBlock = false;
      continue;
    }
    const t = raw.trimStart();
    if (t.startsWith("/-")) {
      if (!t.includes("-/")) inBlock = true;
      continue;
    }
    const text = stripComment(t);
    if (text === "") continue;
    out.push({ line, col: raw.length - t.length, text });
  }
  return out;
}

const BULLET = /^[·.](\s+|$)/;
/** A split written WITH alternatives: `cases h with` / `induction n with`. */
const WITH_HEAD = /^(cases|induction)\s+\S+\s+with$/;
const ALT = /^\|\s*([^\s=]+)((?:\s+[^\s=]+)*)\s*=>\s*(.*)$/;
const CASE = /^case\s+([^\s=]+)(?:\s+[^=]*)?\s*=>\s*(.*)$/;

/** One block: every segment at the block's column starts an item; deeper
 segments belong to the item above (its continuation, or its bullet's or
 case's block). */
function parseItems(segs: Seg[]): Item[] {
  if (segs.length === 0) return [];
  const col = segs[0].col;
  const items: Item[] = [];
  let i = 0;
  while (i < segs.length) {
    const s = segs[i];
    let j = i + 1;
    // a split's `|` alternatives stand at ITS column (Lean's style), so they
    // belong to it as deeper lines would
    const split = WITH_HEAD.test(s.text);
    while (j < segs.length && (segs[j].col > col || (split && segs[j].col === col && segs[j].text.startsWith("|")))) j++;
    const rest = segs.slice(i + 1, j);
    const b = s.text.match(BULLET);
    const c = s.text.match(CASE);
    if (b) {
      const after = s.text.slice(b[0].length);
      const innerCol = s.col + b[0].length;
      const inner = after ? [{ line: s.line, col: innerCol, text: after }, ...rest] : rest;
      items.push({ kind: "bullet", seg: s, items: parseItems(inner), col: inner[0]?.col ?? innerCol });
    } else if (c) {
      const after = c[2];
      const innerCol = s.col + s.text.length - after.length;
      const inner = after ? [{ line: s.line, col: innerCol, text: after }, ...rest] : rest;
      items.push({ kind: "case", seg: s, tag: c[1], items: parseItems(inner), col: inner[0]?.col ?? s.col + 2 });
    } else if (WITH_HEAD.test(s.text) && rest[0]?.text.startsWith("|")) {
      // each `|` line at the alternatives' column starts one; deeper lines
      // are its body
      const altCol = rest[0].col;
      const alts: Alt[] = [];
      let k = 0;
      while (k < rest.length) {
        const a = rest[k];
        let z = k + 1;
        while (z < rest.length && !(rest[z].col <= altCol && rest[z].text.startsWith("|"))) z++;
        const m = a.text.match(ALT);
        if (m) {
          const after = m[3];
          const innerCol = a.col + a.text.length - after.length;
          const body = rest.slice(k + 1, z);
          const inner = after ? [{ line: a.line, col: innerCol, text: after }, ...body] : body;
          alts.push({
            seg: a,
            tag: m[1],
            binders: m[2].trim() ? m[2].trim().split(/\s+/) : [],
            items: parseItems(inner),
            col: inner[0]?.col ?? a.col + 2,
          });
        }
        k = z;
      }
      items.push({ kind: "alts", head: s, alts });
    } else {
      items.push({ kind: "tactic", segs: [s, ...rest] });
    }
    i = j;
  }
  return items;
}

/** A tactic's first word, where the word is one a line would START with as
 a tactic of its own (the swallowed-lines check below; not a parser). */
const TACTIC_HEAD =
  /^(?:intro|intros|rintro|exact|apply|refine|refine'|rw|rewrite|rwa|simp|simp_all|dsimp|omega|linarith|nlinarith|ring|ring_nf|norm_num|decide|constructor|cases|rcases|obtain|induction|have|show|calc|left|right|exfalso|by_contra|by_cases|contradiction|assumption|rfl|trivial|use|exists|unfold|specialize|subst|split|aesop|grind|positivity|sorry|change|let|suffices|ext|funext|congr|norm_cast|push_neg|rename_i|next|all_goals|any_goals|repeat|first|try|exact\?|apply\?)(?![\w'])/;
/** A line that ends asking for more (`with`, `=>`, an open bracket, `by`,
 `:=`, a combinator…): the next line continuing it is Lean's meaning. */
const ASKS_MORE = /(?:\bwith|=>|,|\[|\(|⟨|\{|\bby|:=|<;>|←|\bat|\bfrom|\bthen|\belse|\bfun|↦|\+|\*|-|=|∧|∨|→|↔)$/;

/** SWALLOWED LINES: a tactic whose continuation lines would each stand as a
 tactic of their own — the editor's auto-indent nested them under it, and
 Lean reads the whole run as ONE tactic. Lines in the editor's numbering (the
 header is line 1); null where the continuation is Lean's ordinary meaning. */
export function swallowed(
  segs: readonly { line: number; col: number; text: string }[],
): { head: number; from: number; to: number } | null {
  if (segs.length < 2) return null;
  const [head, next] = segs;
  if (ASKS_MORE.test(head.text) || next.text.startsWith("|") || !TACTIC_HEAD.test(next.text)) return null;
  return { head: head.line + 1, from: next.line + 1, to: segs[segs.length - 1].line + 1 };
}

/** The sentence for a `swallowed` run. */
export function swallowedMessage(w: { head: number; from: number; to: number }): string {
  return w.from === w.to
    ? `Line ${w.from} is indented under line ${w.head}, so Lean reads it as part of that line — line it up with line ${w.head}`
    : `Lines ${w.from}–${w.to} are indented under line ${w.head}, so Lean reads them as part of it — line them up with line ${w.head}`;
}

/** Where an open goal's next tactic goes: the edit that writes `tac` there. */
export type Anchor = (tac: string) => DocEdit;

export interface TextRun {
  attempts: Attempt[];
  /** Notes the TREE cannot carry (no step stands there): a tactic not in the
   demo, a line not run. The editor shows them; failed steps' errors ride the
   attempts (buildProof) and are added here too. */
  editorDiagnostics: RawDiagnostic[];
  /** Open goal node id → where its next tactic goes. A goal with none waits on
   a failing line above it. */
  anchors: Map<string, Anchor>;
  /** The delete gesture's extents (deleteEdit.ts), one per block item. */
  slots: TacticSlot[];
  /** Each step's tight range and verbatim text, by start (getTacticEdit). */
  edits: { pos: ProofStepPosition; text: string }[];
  /** A goal (by node id) that waits on a line the table lacks: the reason the
   page states (completions under it). */
  notBaked: Map<string, Extract<Play, { kind: typeof NOT_BAKED }>>;
  /** A goal (by occurrence) whose tactic did not run because later lines are
   indented under it (`swallowed`): the sentence the page states. */
  indent: Map<string, string>;
  /** The body's comments, as the harvest reports them (`proof.comments`):
   the tree attributes them to steps and reads their flags (`.fold`,
   `.none`, `.mark`). */
  comments: SourceComment[];
}

/** Every `-- …` and `/- … -/` comment after the header, with its range. */
export function bodyComments(doc: string): SourceComment[] {
  const lines = doc.split("\n");
  const out: SourceComment[] = [];
  let open: { line: number; character: number } | null = null;
  let acc: string[] = [];
  for (let line = 1; line < lines.length; line++) {
    const l = lines[line];
    if (open) {
      const e = l.indexOf("-/");
      if (e < 0) {
        acc.push(l);
        continue;
      }
      acc.push(l.slice(0, e + 2));
      out.push({ text: acc.join("\n"), start: open, stop: { line, character: e + 2 } });
      open = null;
      acc = [];
      continue;
    }
    let inStr = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"' && l[i - 1] !== "\\") inStr = !inStr;
      if (inStr) continue;
      if (c === "-" && l[i + 1] === "-") {
        out.push({ text: l.slice(i), start: { line, character: i }, stop: { line, character: l.length } });
        break;
      }
      if (c === "/" && l[i + 1] === "-") {
        const e = l.indexOf("-/", i + 2);
        if (e >= 0) {
          out.push({ text: l.slice(i, e + 2), start: { line, character: i }, stop: { line, character: e + 2 } });
          i = e + 1;
          continue;
        }
        open = { line, character: i };
        acc = [l.slice(i)];
        break;
      }
    }
  }
  return out;
}

/** `play()` answers keyed by goal state, aliases and text, kept across
 replays (an edit replays the whole body; everything above it is a hit). */
export type PlayCache = Map<string, Play>;

const lineEnd = (lines: string[], line: number): Pos => ({ line, character: lines[line]?.length ?? 0 });
/** A tactic typed in the tree may run over several lines (⇧Enter), each
 written relative to its first: placed at column `col`, every later line moves
 in by `col` too, so the block keeps its shape where it lands. */
const indentRest = (text: string, col: number): string =>
  text.split("\n").join(`\n${" ".repeat(col)}`);
/** `tac` under a head that opens a block (`· `, `case t =>`, `| t … =>`):
 one line stays on the head's line; several go the way Lean lays a block out —
 after `·` the rest line up under the first tactic (two in), after `=>` the
 block starts on a line of its own, two in from the head. */
const headed = (head: string, tac: string): string =>
  !tac.includes("\n")
    ? `${head} ${tac}`
    : head === "·"
      ? `· ${indentRest(tac, 2)}`
      : `${head}\n  ${indentRest(tac, 2)}`;
const insertAfter = (lines: string[], line: number, col: number, text: string): DocEdit => {
  const at = lineEnd(lines, line);
  return { range: { start: at, end: at }, newText: `\n${" ".repeat(col)}${indentRest(text, col)}` };
};
const replaceRange = (r: ProofStepPosition, text: string): DocEdit => ({
  range: { start: r.start, end: r.stop },
  newText: indentRest(text, r.start.character),
});

/** The last physical line an item (with its blocks) occupies. */
function lastLine(it: Item): number {
  if (it.kind === "tactic") return it.segs[it.segs.length - 1].line;
  if (it.kind === "alts") {
    const a = it.alts[it.alts.length - 1];
    if (!a) return it.head.line;
    return Math.max(a.seg.line, a.items.length ? lastLine(a.items[a.items.length - 1]) : a.seg.line);
  }
  const inner = it.items.length ? lastLine(it.items[it.items.length - 1]) : it.seg.line;
  return Math.max(it.seg.line, inner);
}

function tacticRange(segs: Seg[]): ProofStepPosition {
  const a = segs[0];
  const z = segs[segs.length - 1];
  return { start: { line: a.line, character: a.col }, stop: { line: z.line, character: z.col + z.text.length } };
}

function itemStart(it: Item): Pos {
  const s = it.kind === "tactic" ? it.segs[0] : it.kind === "alts" ? it.head : it.seg;
  return { line: s.line, character: s.col };
}

/** Replay the editor's text into attempts. `doc` is the whole editor text,
 line 0 the declaration header. */
export async function replayText(
  t: Table,
  answer: Engine,
  doc: string,
  cache: PlayCache,
  /** Whether this page can offer live Lean (cross-origin isolated). Off — on
   GitHub Pages — no message points the reader at a button that is not there. */
  liveOffered = true,
): Promise<TextRun> {
  const runIt = (what: string) => (liveOffered ? ` Run real Lean (top right) to check ${what}.` : "");
  const lines = doc.split("\n");
  const items = parseItems(segments(doc));
  const attempts: Attempt[] = [];
  const editorDiagnostics: RawDiagnostic[] = [];
  const anchors = new Map<string, Anchor>();
  const slots: TacticSlot[] = [];
  const edits: TextRun["edits"] = [];
  const notBaked: TextRun["notBaked"] = new Map();
  const indent: TextRun["indent"] = new Map();
  const occs = new Map<string, { state: number; aliases: Aliases }>([[ROOT, { state: 0, aliases: [] }]]);
  let occN = 1;

  const cachedPlay = async (state: number, aliases: Aliases, text: string): Promise<Play> => {
    const key = `${state}\u0000${JSON.stringify(aliases)}\u0000${text}`;
    const hit = cache.get(key);
    if (hit && hit.kind !== NOT_BAKED) return hit;
    const r = await play(t, answer, state, aliases, text);
    if (r.kind !== NOT_BAKED) cache.set(key, r);
    return r;
  };
  const caseTag = (occ: string) => t.bake.goals[occs.get(occ)!.state].goal.userName;

  const slotsFor = (block: Item[]) => {
    if (block.length === 0) return;
    const blockStart = itemStart(block[0]);
    block.forEach((it, index) => {
      const start = itemStart(it);
      const last = lastLine(it);
      const stop =
        it.kind === "tactic" ? tacticRange(it.segs).stop : lineEnd(lines, last);
      slots.push({
        start,
        stop,
        blockStart,
        index,
        count: block.length,
        // the first tactic of a `·`/`case` line does not start its line
        lineStart: (lines[start.line] ?? "").slice(0, start.character).trim() === "",
        tailIsTrivia: true,
        tailStop: lineEnd(lines, last),
        prevSameLine: false,
      });
    });
  };

  /** Notes on every line of the items from `from` on: not run. */
  const notRun = (block: Item[], from: number) => {
    for (const it of block.slice(from)) {
      const a = itemStart(it);
      const z = lineEnd(lines, lastLine(it));
      editorDiagnostics.push({
        range: { start: a, stop: z },
        fullRange: { start: a, stop: z },
        severity: 4,
        message: "Not run: a line above it in this block did not succeed.",
      });
    }
  };

  /** Run one block on its goals (Lean's tactic-sequence semantics). Returns
   the goals left and whether the block stopped early. */
  const runBlock = async (
    block: Item[],
    goals: string[],
    col: number,
    endLine: number,
  ): Promise<{ left: string[]; stopped: boolean }> => {
    slotsFor(block);
    let gs = goals;
    for (let k = 0; k < block.length; k++) {
      const it = block[k];
      const main = gs[0];
      const r =
        it.kind === "tactic"
          ? tacticRange(it.segs)
          : it.kind === "alts"
            ? tacticRange([it.head])
            : { start: itemStart(it), stop: lineEnd(lines, it.seg.line) };
      if (main === undefined) {
        editorDiagnostics.push({ range: r, fullRange: r, severity: 1, message: "No goals to be proved." });
        notRun(block, k + 1);
        return { left: [], stopped: true };
      }
      if (it.kind === "alts") {
        const o = occs.get(main)!;
        const headText = it.head.text.replace(/\s+with$/, "");
        const p = await cachedPlay(o.state, o.aliases, headText);
        if (p.kind !== "ok") {
          if (p.kind === "error") {
            attempts.push({ occ: main, play: { ...p, label: it.head.text }, at: r });
            anchors.set(`${main}~`, (tac) => replaceRange(r, tac));
            editorDiagnostics.push({ range: r, fullRange: r, severity: 1, message: p.error });
          } else {
            notBaked.set(main, p);
            anchors.set(main, (tac) => replaceRange(r, tac));
            editorDiagnostics.push({ range: r, fullRange: r, severity: 2, message: `Not in this demo.${runIt("any tactic")}` });
          }
          notRun(block, k + 1);
          return { left: gs, stopped: true };
        }
        // each case the split left, named by ITS alternative: `rename_i` over
        // the names the alternative binds (Lean's own meaning of the binders:
        // the case's new, inaccessible hypotheses, in order)
        const states: number[] = [];
        const kidAliases: Aliases[] = [];
        const altOf: (Alt | undefined)[] = [];
        for (const st of p.goals) {
          const tag = t.bake.goals[st].goal.userName;
          const alt = it.alts.find((a) => a.tag === tag);
          altOf.push(alt);
          let state = st;
          let aliases = p.aliases;
          if (alt && alt.binders.length > 0) {
            const rn = await cachedPlay(st, p.aliases, `rename_i ${alt.binders.join(" ")}`);
            const ar = { start: { line: alt.seg.line, character: alt.seg.col }, stop: lineEnd(lines, alt.seg.line) };
            if (rn.kind === "ok" && rn.goals.length === 1) {
              state = rn.goals[0];
              aliases = rn.aliases;
            } else {
              editorDiagnostics.push({
                range: ar,
                fullRange: ar,
                severity: rn.kind === "error" ? 1 : 2,
                message:
                  rn.kind === "error"
                    ? rn.error
                    : `Naming this case is not in this demo.${runIt("it")}`,
              });
            }
          }
          states.push(state);
          kidAliases.push(aliases);
        }
        const kids = states.map((state, n) => {
          const id = `g${occN++}`;
          occs.set(id, { state, aliases: kidAliases[n] });
          return id;
        });
        attempts.push({
          occ: main,
          play: { ...p, label: it.head.text, goals: states },
          at: r,
          kids,
          kidAliases,
        });
        edits.push({ pos: r, text: it.head.text });
        const altCol = it.alts[0]?.seg.col ?? r.start.character;
        let lastAlt = it.head.line;
        for (const a of it.alts) lastAlt = Math.max(lastAlt, a.seg.line, a.items.length ? lastLine(a.items[a.items.length - 1]) : a.seg.line);
        for (let n = 0; n < kids.length; n++) {
          const alt = altOf[n];
          if (!alt) {
            // a case with no alternative yet: the next tactic for it is one
            const tag = t.bake.goals[states[n]].goal.userName ?? "_";
            anchors.set(kids[n], (tac) => insertAfter(lines, lastAlt, altCol, headed(`| ${tag} =>`, tac)));
            continue;
          }
          if (alt.items.length === 0) {
            anchors.set(kids[n], (tac) => insertAfter(lines, alt.seg.line, alt.seg.col + 2, tac));
            continue;
          }
          // `| tag names => sorry` (the skeleton): the first tactic replaces
          // the placeholder on a line of its own, so the case's block stands
          // two columns in from its `|`, as Lean's style has it
          const only = alt.items[0];
          if (
            alt.items.length === 1 &&
            only.kind === "tactic" &&
            only.segs.length === 1 &&
            only.segs[0].text === "sorry" &&
            only.segs[0].line === alt.seg.line
          ) {
            const sr = tacticRange(only.segs);
            const arrow = (lines[alt.seg.line] ?? "").lastIndexOf("=>", sr.start.character);
            const from = { line: alt.seg.line, character: arrow + 2 };
            anchors.set(kids[n], (tac) => ({
              range: { start: from, end: sr.stop },
              newText: `\n${" ".repeat(alt.seg.col + 2)}${indentRest(tac, alt.seg.col + 2)}`,
            }));
            continue;
          }
          await runBlock(alt.items, [kids[n]], alt.col, Math.max(alt.seg.line, lastLine(alt.items[alt.items.length - 1])));
        }
        gs = gs.slice(1);
        continue;
      }
      if (it.kind === "bullet" || it.kind === "case") {
        let target = main;
        if (it.kind === "case") {
          const hit = gs.filter((g) => caseTag(g) === it.tag);
          if (hit.length === 0) {
            editorDiagnostics.push({ range: r, fullRange: r, severity: 1, message: `Case tag '${it.tag}' not found.` });
            notRun(block, k + 1);
            return { left: gs, stopped: true };
          }
          target = hit[0];
        }
        const inner = await runBlock(it.items, [target], it.col, lastLine(it));
        if (it.items.length === 0) anchors.set(target, (tac) => insertAfter(lines, it.seg.line, it.col, tac));
        void inner; // a `·`/`case` block recovers: its siblings run either way
        gs = gs.filter((g) => g !== target);
        continue;
      }
      const verbatim = lines
        .slice(r.start.line, r.stop.line + 1)
        .map((l, i, all) =>
          i === 0 && i === all.length - 1
            ? l.slice(r.start.character, r.stop.character)
            : i === 0
              ? l.slice(r.start.character)
              : i === all.length - 1
                ? l.slice(0, r.stop.character)
                : l,
        )
        .join("\n");
      const o = occs.get(main)!;
      if (verbatim.trim() === "sorry") {
        // the page's placeholder: the goal stays OPEN, the next line works on
        // the goal after it (Lean's `sorry` closes the main goal)
        anchors.set(main, (tac) => replaceRange(r, tac));
        gs = gs.slice(1);
        continue;
      }
      const p = await cachedPlay(o.state, o.aliases, verbatim);
      const sw = p.kind === "ok" ? null : swallowed(it.segs);
      if (sw) indent.set(main, swallowedMessage(sw));
      if (p.kind === NOT_BAKED) {
        notBaked.set(main, p);
        anchors.set(main, (tac) => replaceRange(r, tac));
        editorDiagnostics.push({
          range: r,
          fullRange: r,
          severity: 2,
          message: sw
            ? swallowedMessage(sw)
            : p.frontier
            ? `Not in this demo: it was not explored past this goal.${runIt("it")}`
            : `Not in this demo.${runIt("any tactic")}`,
        });
        notRun(block, k + 1);
        return { left: gs, stopped: true };
      }
      if (p.kind === "error") {
        attempts.push({ occ: main, play: p, at: r, span: { start: r.start, stop: lineEnd(lines, r.stop.line) } });
        edits.push({ pos: r, text: verbatim });
        anchors.set(`${main}~`, (tac) => replaceRange(r, tac));
        editorDiagnostics.push({ range: r, fullRange: r, severity: 1, message: p.error });
        notRun(block, k + 1);
        return { left: gs, stopped: true };
      }
      const kids = p.goals.map((state) => {
        const id = `g${occN++}`;
        occs.set(id, { state, aliases: p.aliases });
        return id;
      });
      attempts.push({ occ: main, play: p, at: r, span: { start: r.start, stop: lineEnd(lines, r.stop.line) }, kids });
      edits.push({ pos: r, text: verbatim });
      gs = [...kids, ...gs.slice(1)];
    }
    // the goals left at the end of a block that ran through: where the next
    // tactic for each goes — the main goal on a new line, another one by its
    // case tag, else bullets in order (a `sorry` stands for the earlier goals)
    gs.forEach((g, k) => {
      if (k === 0) {
        anchors.set(g, (tac) => insertAfter(lines, endLine, col, tac));
        return;
      }
      const tag = caseTag(g);
      const unique = tag && gs.filter((h) => caseTag(h) === tag).length === 1;
      anchors.set(g, (tac) =>
        unique
          ? insertAfter(lines, endLine, col, headed(`case ${tag} =>`, tac))
          : insertAfter(
              lines,
              endLine,
              col,
              [...gs.slice(0, k).map(() => "· sorry"), headed("·", tac)].join("\n"),
            ),
      );
    });
    return { left: gs, stopped: false };
  };

  const endLine = items.length ? lastLine(items[items.length - 1]) : 0;
  await runBlock(items, [ROOT], items.length ? itemStart(items[0]).character : 2, endLine);
  // an empty body: the first tactic takes the place of whatever blank lines
  // follow the header
  if (items.length === 0)
    anchors.set(ROOT, (tac) => ({
      range: { start: lineEnd(lines, 0), end: lineEnd(lines, lines.length - 1) },
      newText: `\n  ${indentRest(tac, 2)}`,
    }));
  return { attempts, editorDiagnostics, anchors, slots, edits, notBaked, indent, comments: bodyComments(doc) };
}

/** A fresh body for a theorem: its header and an indented empty line. */
export const freshDoc = (header: string) => `${header}\n  `;

/** Apply a `DocEdit` to a text (line/character positions). */
export function applyDocEdit(doc: string, e: DocEdit): string {
  const lines = doc.split("\n");
  const off = (p: Pos) => {
    let n = 0;
    for (let i = 0; i < p.line && i < lines.length; i++) n += lines[i].length + 1;
    return n + Math.min(p.character, lines[p.line]?.length ?? 0);
  };
  return doc.slice(0, off(e.range.start)) + e.newText + doc.slice(off(e.range.end));
}
