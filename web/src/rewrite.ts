// D1 — RESTRUCTURING, AS TEXT EDITS OVER VERBATIM SOURCE.
//
// Two moves, inverse to each other, and the first two entries of Workstream
// D's catalogue:
//
//   inline   `have h : P := j` used by exactly one later step → delete the
//            `have` and put `(j)` where that step named `h`.
//   extract  a `(by …)` nested in a tactic's term → hoist it to
//            `have this : <the block's goal> := by …` on the line above and
//            leave `this` behind.
//
// Everything here is a PURE function over the tree, the `haveUses` sidecar and
// the tactic's verbatim source, so the offline probe runs exactly what the
// widget runs. Nothing here decides whether a rewrite is CORRECT: that is the
// elaborator's answer, asked through `ProofTree.checkRewrite` before the
// reader is offered the edit at all (the Sledgehammer preplay discipline).
//
// Two rules shape every decline, and both are recorded rather than inferred:
//
//  * **The name must be BOTH used and written.** `haveUses` counts what the
//    elaborator says a step read; `omega` reads `hle1` from the context and
//    never names it, so there is no occurrence to substitute and no inline is
//    offered. That single test is what keeps `omega`, `assumption` and
//    `decide` out without a tactic taxonomy.
//  * **Verbatim or nothing.** Every edit is cut from the tactic's own source
//    text at its own tight range. Where the text handed in does not match the
//    range it claims (the offline harness stubs it with Paperproof's
//    pretty-print, which is one line for a multi-line tactic), no rewrite is
//    offered at all rather than an edit computed from a paraphrase.
import type { ProofStepPosition, TacticSlot } from "./paperproof";
import type { TreeNode } from "./types";
import { deleteEdit, deleteExtent } from "./deleteEdit";
import { childIndex } from "./elide";
import { posKey } from "./proofToTree";

export interface Pos {
  line: number;
  character: number;
}

/** One tactic's VERBATIM source at its own tight range. In the widget this is
 `tacticEdits` (`getTacticEdit`); offline it is a slice of the `.lean` file
 taken at the tactic's `deleteSlots` extent. */
export interface TacticSource {
  start: Pos;
  stop: Pos;
  text: string;
  /** The column the tactic's own line starts its tactic at — where a hoisted
   `have` goes and what a wrapped continuation is measured from. */
  indent: number;
}

export type SourceLookup = (start: Pos) => TacticSource | null;

export interface RewriteEdit {
  range: { start: Pos; end: Pos };
  newText: string;
}

export interface Rewrite {
  kind: "inline" | "extract" | "collapse" | "expand" | "rename" | "lint";
  /** The node the gesture was offered on. */
  nodeId: string;
  /** The hypothesis inlined, or the name the extraction introduces. */
  name: string;
  /** The node whose text the substitution lands in. */
  targetId: string;
  /** Pairwise disjoint, in source order; applied together in one
   `applyEdit`, so every range is in the CURRENT document's coordinates. */
  edits: RewriteEdit[];
  /** One line for the pill and the `<title>`. */
  title: string;
  /** EXTRACT only: where the `this` binder stands AFTER `edits` are written
   (the inserted line, past its indent and `have `). Once the write lands the
   widget asks the companion to open VS Code's own Rename Symbol there, so the
   placeholder name is replaced by one the author types — never one this
   module invents. */
  renameAt?: Pos;
}

export type Proposal =
  | { ok: true; rewrite: Rewrite }
  | { ok: false; why: string };

const no = (why: string): Proposal => ({ ok: false, why });

/** A LEAN identifier character, for the whole-token test the occurrence scan
 needs: subscripts and primes are part of a name, `.` is not (it starts a
 projection, so `hp` in `hp.pos` IS an occurrence of `hp` and `pos` is not). */
export const IDENT = /[A-Za-z0-9_'!?₀-₉ₐ-ₜÀ-ɏͰ-ϿḀ-῿]/;

/** The tactic's head word — the same lexical scan `elide.ts` does.
 `keepQuestion` takes a trailing `?` with it, which is what B4 wants: `exact?`
 and `simp?` are one word there, and one scanner answers for both. */
export const headWord = (s: string, keepQuestion = false): string =>
  (s.trimStart().match(keepQuestion ? /^[A-Za-z_][A-Za-z0-9_]*\??/ : /^[A-Za-z_][A-Za-z0-9_]*/) ??
    [""])[0];

/** Where index `i` of `text` sits in the document, given that `text` starts at
 `origin`. LSP counts UTF-16 units and so does a JS string index, so this is
 the identity on the units that matter. */
export function advance(origin: Pos, text: string, i: number): Pos {
  let line = origin.line;
  let character = origin.character;
  for (let k = 0; k < i; k++) {
    if (text[k] === "\n") {
      line++;
      character = 0;
    } else character++;
  }
  return { line, character };
}

const OPEN = "([{⟨⦃";
const CLOSE = ")]}⟩⦄";

/** The index of the top-level `:=` — the one that separates a `have`'s
 statement from its justification. Bracket-aware, so `have h : f (a := 1) = b
 := rfl` finds the second one and not the named argument. */
export function topLevelAssign(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (depth === 0 && c === ":" && text[i + 1] === "=") return i;
  }
  return -1;
}

/** Every whole-token occurrence of `name` in `text`, as start indices —
 skipping anything inside a line comment, a block comment or a string literal.
 One scanner for D1's inline and D5's rename: a tactic's tight extent can
 carry all three (a multi-line `have … := by` block with a `--` note in it),
 and an edit that reached into one would rewrite prose. */
export function occurrences(text: string, name: string): number[] {
  const out: number[] = [];
  let i = 0;
  let block = 0;
  while (i < text.length) {
    if (block > 0) {
      if (text.startsWith("-/", i)) {
        block--;
        i += 2;
        continue;
      }
      if (text.startsWith("/-", i)) {
        block++;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (text.startsWith("/-", i)) {
      block = 1;
      i += 2;
      continue;
    }
    if (text.startsWith("--", i)) {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl;
      continue;
    }
    if (text[i] === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (text.startsWith(name, i)) {
      const before = text[i - 1];
      const after = text[i + name.length];
      if (
        !(before !== undefined && (IDENT.test(before) || before === ".")) &&
        !(after !== undefined && IDENT.test(after))
      ) {
        out.push(i);
        i += name.length;
        continue;
      }
    }
    i++;
  }
  return out;
}

/** Is this occurrence the target of an `at` clause (`rw [foo] at h`, `simp at
 h ⊢`)? Substituting a term for a hypothesis NAME there is meaningless — the
 clause names a place in the context, not a proof. */
function inAtClause(text: string, at: number): boolean {
  const head = text.slice(0, at);
  return /\bat\s+[A-Za-z0-9_'!?₀-₉\s,⊢*←]*$/.test(head);
}

/** The tactic's text really is the source at the range it claims. The offline
 harness stubs `getTacticEdit` with Paperproof's `tacticString`, which is a
 pretty-print and is one line for a multi-line tactic; every rewrite here cuts
 text at computed offsets, so a paraphrase would produce a plausible edit that
 deletes the wrong bytes. Checked, not trusted. */
export function verbatim(s: TacticSource): boolean {
  return s.text.split("\n").length === s.stop.line - s.start.line + 1;
}

/** Re-indent a justification's continuation lines under a new host. The first
 line is left alone (it continues the host's own line); the rest keep their
 relative shape and are moved so the shallowest sits at `col`. */
function reindent(lines: string[], col: number): string[] {
  const rest = lines.slice(1);
  const base = Math.min(
    ...rest
      .filter((l) => l.trim() !== "")
      .map((l) => l.length - l.trimStart().length),
  );
  const pad = " ".repeat(col);
  return [
    lines[0],
    ...rest.map((l) => (l.trim() === "" ? "" : pad + l.slice(base))),
  ];
}

/** A justification of more than this many lines is left where the author put
 it: an inlined block that long reads worse than the `have` it replaced, which
 is the whole point of the move. Measured against the corpus in the design
 record (2026-09-09): 3 admits `euclid`'s `hM`, declines its 13-line
 `exists_prime_dvd`. */
export const MAX_INLINE_LINES = 3;

/** Head words that read their premises from the CONTEXT rather than from a
 term. The occurrence test already excludes them (they name nothing), so this
 is belt and braces — and it is what makes the decline SAY why, instead of
 reporting "not named" for a tactic that structurally cannot name anything. */
const CONTEXT_ONLY = new Set([
  "omega",
  "assumption",
  "decide",
  "trivial",
  "tauto",
  "positivity",
  "linarith",
  "nlinarith",
  "norm_num",
  "ring",
  "ring_nf",
  "aesop",
  "simp_all",
  "grind",
  "order",
]);

export interface RewriteCtx {
  nodes: readonly TreeNode[];
  src: SourceLookup;
  slots: readonly TacticSlot[];
}

/** The two indexes every move over a context wants — the node by id and the
 children by parent. Built ONCE per context and held beside it rather than on
 it, so every construction site (the view's memo, the probes' literals, the
 LSP rig) gets them without having to know about them; a context is a memo
 object with a lifetime of its own, which is exactly what makes it the right
 cache key. Before this, one proposal pass over a 70-node tree ran a linear
 `find` per candidate step and rebuilt the child map per rename. */
const CTX_INDEX = new WeakMap<
  RewriteCtx,
  { byId: Map<string, TreeNode>; kids: Map<string, TreeNode[]> }
>();

export function ctxIndex(ctx: RewriteCtx): {
  byId: Map<string, TreeNode>;
  kids: Map<string, TreeNode[]>;
} {
  let i = CTX_INDEX.get(ctx);
  if (!i) {
    i = {
      byId: new Map(ctx.nodes.map((n) => [n.id, n])),
      kids: childIndex(ctx.nodes),
    };
    CTX_INDEX.set(ctx, i);
  }
  return i;
}

/** One node of a context, by id. */
export const ctxNode = (ctx: RewriteCtx, id: string | undefined) =>
  id === undefined ? undefined : ctxIndex(ctx).byId.get(id);

/** D1a — INLINE A SINGLE-USE `have`. */
export function inlineRewrite(node: TreeNode, ctx: RewriteCtx): Proposal {
  const u = node.uses;
  if (!u) return no("not a `have` the elaborator counted uses for");
  if (headWord(node.label) !== "have")
    return no("`obtain` destructures — there is no one justification to move");
  if (u.count === 0) return no(`nothing uses \`${u.name}\``);
  if (u.count > 1) return no(`\`${u.name}\` is used ${u.count} times`);
  if (u.users.length !== 1) return no("the step that uses it is not drawn");
  if (!node.position || !node.deleteSpec) return no("no source for this step");

  const me = ctx.src(node.position.start);
  if (!me) return no("no source for this step");
  if (!verbatim(me)) return no("the tactic's source is not available verbatim");

  const cut = topLevelAssign(me.text);
  if (cut < 0) return no("this `have` states a goal rather than proving one");
  const head = me.text.slice(0, cut);
  if (occurrences(head, u.name).length === 0)
    return no("the `have` does not bind that name directly");
  const just = me.text.slice(cut + 2).replace(/^[ \t]*/, "");
  if (just.trim() === "") return no("this `have` has no justification");

  const user = ctxNode(ctx, u.users[0]);
  if (!user?.position) return no("the step that uses it is not drawn");
  const us = ctx.src(user.position.start);
  if (!us) return no("no source for the step that uses it");
  if (!verbatim(us))
    return no("the using step's source is not available verbatim");

  const uHead = headWord(user.label);
  if (CONTEXT_ONLY.has(uHead))
    return no(`\`${uHead}\` reads the context — it names no term to replace`);

  const hits = occurrences(us.text, u.name);
  if (hits.length === 0)
    return no(`\`${uHead}\` uses \`${u.name}\` without naming it`);
  if (hits.length > 1)
    return no(`\`${u.name}\` is named ${hits.length} times in one step`);
  if (inAtClause(us.text, hits[0]))
    return no(`\`${u.name}\` is an \`at\` target, not a term`);

  const ext = deleteExtent(node.deleteSpec, ctx.slots);
  if (!ext) return no("the `have` has no whole-line extent to remove");
  if (ext.empties) return no("the `have` is the only tactic in its block");
  const del = deleteEdit(node.deleteSpec, ctx.slots);
  if (!del) return no("the `have` has no whole-line extent to remove");

  // The justification, re-shaped for its new home. One line goes in as it
  // stands; up to MAX_INLINE_LINES are re-indented under the using tactic;
  // anything longer is left alone.
  const lines = just.split("\n");
  if (lines.length > MAX_INLINE_LINES)
    return no(
      `the justification is ${lines.length} lines — longer than ${MAX_INLINE_LINES}, it reads better where it is`,
    );
  const body =
    lines.length === 1
      ? lines[0].trimEnd()
      : reindent(lines, us.indent + 2)
          .map((l) => l.trimEnd())
          .join("\n");
  const newText = `(${body})`;

  const start = advance(us.start, us.text, hits[0]);
  const end = advance(us.start, us.text, hits[0] + u.name.length);

  return {
    ok: true,
    rewrite: {
      kind: "inline",
      nodeId: node.id,
      name: u.name,
      targetId: user.id,
      edits: [
        { range: { start: del.range.start, end: del.range.end }, newText: del.newText },
        { range: { start, end }, newText },
      ].sort((a, b) =>
        a.range.start.line - b.range.start.line ||
        a.range.start.character - b.range.start.character,
      ),
      title: `inline \`${u.name}\` into \`${uHead}\``,
    },
  };
}

/** The nested `(by …)` a tactic's term carries, as a slice of its own text.
 PARENTHESISED ONLY, and that is the rule rather than a limitation: without
 brackets a `by` block ends where indentation and the enclosing tactic's own
 trailing clauses say it ends (`rcases f <| by grind` … `with ⟨p, hp⟩`), which
 the text alone cannot decide. A reader who wants the move there can put the
 parentheses in, and then it is offered. */
function nestedBy(text: string): { open: number; by: number; close: number } | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "(") continue;
    const m = /^\(\s*by\b/.exec(text.slice(i));
    if (!m) continue;
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (OPEN.includes(text[j])) depth++;
      else if (CLOSE.includes(text[j])) {
        depth--;
        if (depth === 0)
          return { open: i, by: i + m[0].length - 2, close: j };
      }
    }
    return null;
  }
  return null;
}

/** D1b — EXTRACT A NESTED `by` BLOCK AS A `have`.
 The name is `this` and is not negotiable: Lean's own anonymous idiom, and the
 author's to rename. Inventing `h1` would be putting a word in their mouth
 (CLAUDE.md's standing rule), and prompting for one would make the gesture a
 dialogue. */
export function extractRewrite(node: TreeNode, ctx: RewriteCtx): Proposal {
  if (node.type !== "tactic" || !node.position)
    return no("no source for this step");
  const me = ctx.src(node.position.start);
  if (!me) return no("no source for this step");
  if (!verbatim(me)) return no("the tactic's source is not available verbatim");

  const at = nestedBy(me.text);
  if (!at) return no("no parenthesised `(by …)` in this step's term");

  const blockStart = advance(me.start, me.text, at.by);
  const blockStop = advance(me.start, me.text, at.close);

  // The block's GOAL is what the `have` must state, and only the elaborator
  // knows it: the spawned goal this step opened whose own first tactic falls
  // inside the block's range.
  const inside = (p: Pos) =>
    (p.line > blockStart.line ||
      (p.line === blockStart.line && p.character >= blockStart.character)) &&
    (p.line < blockStop.line ||
      (p.line === blockStop.line && p.character <= blockStop.character));
  const index = ctxIndex(ctx);
  const kids = index.kids.get(node.id) ?? [];
  const goal = kids.find(
    (g) =>
      g.type === "goal" &&
      (index.kids.get(g.id) ?? []).some(
        (t) => t.type === "tactic" && t.position && inside(t.position.start),
      ),
  );
  if (!goal) return no("the block's goal was not harvested");
  const type = goal.label.replace(/^⊢\s*/, "").trim();
  if (type === "" || type.includes("\n"))
    return no("the block's goal does not print on one line");
  if (goal.hyps?.some((h) => h.text.trimStart().startsWith("this ")))
    return no("`this` is already bound here");

  const block = me.text.slice(at.by, at.close);
  const bl = block.split("\n");
  const body =
    bl.length === 1
      ? bl[0].trimEnd()
      : reindent(bl, me.indent + 2)
          .map((l) => l.trimEnd())
          .join("\n");

  const line = `${" ".repeat(me.indent)}have this : ${type} := ${body}\n`;
  const insertAt: Pos = { line: me.start.line, character: 0 };

  return {
    ok: true,
    rewrite: {
      kind: "extract",
      nodeId: node.id,
      name: "this",
      targetId: node.id,
      edits: [
        { range: { start: insertAt, end: insertAt }, newText: line },
        {
          range: {
            start: advance(me.start, me.text, at.open),
            end: advance(me.start, me.text, at.close + 1),
          },
          newText: "this",
        },
      ],
      title: `extract \`by\` as \`have this\``,
      renameAt: { line: insertAt.line, character: me.indent + "have ".length },
    },
  };
}

/** The tight range of a step, as `deleteSlots` records it — the offline
 source lookup's other half (the widget has `tacticEdits` instead). */
export function slotSource(
  slot: TacticSlot,
  lineOf: (line: number) => string,
): TacticSource {
  const lines: string[] = [];
  for (let l = slot.start.line; l <= slot.stop.line; l++) {
    const t = lineOf(l);
    lines.push(
      l === slot.start.line
        ? l === slot.stop.line
          ? t.slice(slot.start.character, slot.stop.character)
          : t.slice(slot.start.character)
        : l === slot.stop.line
          ? t.slice(0, slot.stop.character)
          : t,
    );
  }
  return {
    start: slot.start,
    stop: slot.stop,
    text: lines.join("\n"),
    indent: slot.start.character,
  };
}

export type { ProofStepPosition };

/* ══════════════════════════════════════════════════════════════════════════
   D2 — COLLAPSE A RUN TO AUTOMATION, AND EXPAND AUTOMATION TO ITS LEMMAS
   ══════════════════════════════════════════════════════════════════════════

   The third catalogue entry of Workstream D, and its inverse. Both are the
   same shape as D1: a pure function computes the EDITS here, the elaborator
   answers whether they hold, and only then is the reader offered the write.

   * collapse (`⇓`) — a LINEAR RUN of consecutive trunk steps that ends by
     closing its goal is replaced, in one splice, by whichever automation
     tactic closes the run's first goal on its own. The candidates are tried
     in order by `ProofTree.tryClose`; the first that elaborates benignly is
     the offer. This is Renshaw's `tryAtEachStep` trick asked of a RUN rather
     than of a step, and Blanchette et al.'s "iteratively test and compress".
   * expand (`⇑`) — the inverse. Where B4 has already read back what `simp`
     (or `grind`, or `aesop`) actually used, write it into the source: the
     tactic's tight range is replaced by core's OWN suggestion text, verbatim.
     This is the Mathlib `says` idiom, and the verbatim rule is the standing
     one — the words are Lean's, and completing them ourselves would be
     putting a tactic in the author's mouth. */

/** The candidates `tryClose` tries, in order. `omega` first because it is the
 cheapest and the most common answer; `aesop` last because it is the most
 expensive. One exported constant: the client names them in the `<title>` and
 the server takes the same list as its default, so the two cannot drift. */
export const AUTOMATION_CANDIDATES = [
  "omega",
  "simp",
  "linarith",
  "norm_num",
  "grind",
  "decide",
  "ring",
  "simp_all",
  "aesop",
];

/** A maximal chain of consecutive TRUNK steps: each one produced exactly one
 ordinary goal, and that goal's only step is the next. `closes` says the last
 step left no goal at all — which is what makes the run collapsible, since a
 run that does NOT close is followed by tactics that would then have no goal
 to work on. */
export interface LinearRun {
  steps: TreeNode[];
  closes: boolean;
}

/** A node a run may contain: the author's own tactic, drawn, with a source
 extent of its own. Recovery-minted steps (a failed tactic, a term proof, a
 subterm) and ledger rows have no slot to splice and are not the author's
 line-per-line text, so a run stops at them. */
const runnable = (n: TreeNode): boolean =>
  n.type === "tactic" &&
  !!n.position &&
  !n.synthetic &&
  !n.elidedCut &&
  !n.traceLeaf &&
  !n.recovered &&
  !n.chain &&
  !n.ledgerKind &&
  !n.ledger;

/** The goal a step continues into, where there is exactly one and it is an
 ordinary continuation (not a side obligation, not a spawned `by` block). */
function trunkGoal(t: TreeNode, kids: Map<string, TreeNode[]>): TreeNode | null {
  const ks = kids.get(t.id) ?? [];
  if (ks.length !== 1) return null;
  const g = ks[0];
  return g.type === "goal" && !g.side && !g.spawned ? g : null;
}

function nextStep(
  t: TreeNode,
  kids: Map<string, TreeNode[]>,
): TreeNode | null {
  const g = trunkGoal(t, kids);
  if (!g) return null;
  const ks = (kids.get(g.id) ?? []).filter(runnable);
  return ks.length === 1 ? ks[0] : null;
}

const kidsOf = (nodes: readonly TreeNode[]): Map<string, TreeNode[]> =>
  childIndex(nodes);

/** The slot a step OWNS — the one whose start is exactly the step's own.
 Named apart from `deleteEdit.ts`'s `slotAt`, which asks the other question
 (the innermost slot CONTAINING a position). */
function slotStartingAt(
  slots: readonly TacticSlot[],
  at: Pos,
): TacticSlot | undefined {
  return slots.find((s) => posKey(s.start) === posKey(at));
}

/** Is any goal below this step still open — i.e. drawn with no tactic under
 it? This, and not "the last step has no children", is what CLOSES means: a
 `rw` is harvested with its own closing `rfl` residue hanging under it, and
 that residue is not the author's text and cannot end a run, but the goal it
 discharged is discharged all the same. */
function openBelow(t: TreeNode, kids: Map<string, TreeNode[]>): boolean {
  const stack = [...(kids.get(t.id) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    const ks = kids.get(n.id) ?? [];
    if (n.type === "goal" && ks.length === 0) return true;
    for (const k of ks) stack.push(k);
  }
  return false;
}

/** Every MAXIMAL linear run of length ≥ 2 in a tree, in source order.
 Maximal: a run's first step is nobody's `nextStep`, so the same steps are
 never offered twice under two different heads. The offer is gated on
 `closes` by the caller — a run that ends at a branch cannot be replaced by a
 closing tactic.

 `source` says a step has a spliceable extent of its own (a `deleteSlots`
 entry). A step without one — Paperproof harvests `rw`'s closing `rfl` as a
 step sharing the `rw`'s position — ends the run rather than joining it: the
 splice is over the author's text, and a step with no text of its own has
 none to give. It does not stop the run CLOSING, which `openBelow` answers
 from the tree. */
export function linearRuns(
  nodes: readonly TreeNode[],
  source?: (n: TreeNode) => boolean,
): LinearRun[] {
  const kids = kidsOf(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const usable = (n: TreeNode) => runnable(n) && (source?.(n) ?? true);
  const continued = new Set<string>();
  for (const n of nodes) {
    if (!usable(n)) continue;
    const nx = nextStep(n, kids);
    if (nx && usable(nx)) continued.add(nx.id);
  }
  const out: LinearRun[] = [];
  for (const n of nodes) {
    if (!usable(n) || continued.has(n.id)) continue;
    const steps = [n];
    let cur = n;
    for (;;) {
      const nx = nextStep(cur, kids);
      if (!nx || !usable(nx)) break;
      steps.push(nx);
      cur = nx;
    }
    if (steps.length < 2) continue;
    out.push({ steps, closes: !openBelow(cur, kids) });
  }
  // A defensive read of `byId`, so a tree with a dangling parent edge cannot
  // produce a run whose steps are not all in the tree it came from.
  return out.filter((r) => r.steps.every((s) => byId.has(s.id)));
}

/** The predicate `linearRuns` wants, built from the slot list every splice is
 cut at — one place, so the view, the probes and the LSP rig agree. */
export const hasSlot =
  (slots: readonly TacticSlot[]) =>
  (n: TreeNode): boolean =>
    !!n.position && slotStartingAt(slots, n.position.start) !== undefined;

/** The run a FOLDED goal hides, where what it hides is one — a `+N` is the
 reader saying "I do not want to read this", which is exactly where the offer
 belongs, and the extent is theirs rather than the maximal run's.
 A fold's hidden steps need only be a linear CHAIN (not a maximal run): the
 fold is how a reader picks the tail of a longer run. */
export function runForFold(
  goal: TreeNode,
  base: readonly TreeNode[],
): LinearRun | null {
  const f = goal.folded;
  if (!f || f.kind !== "fold") return null;
  const byPos = new Map<string, TreeNode>();
  for (const n of base) if (runnable(n)) byPos.set(posKey(n.position!.start), n);
  const hidden: TreeNode[] = [];
  for (const p of f.parts) {
    if (!p.position) return null;
    const n = byPos.get(posKey(p.position.start));
    if (!n) return null;
    hidden.push(n);
  }
  if (hidden.length < 2) return null;
  const kids = kidsOf(base);
  const ids = new Set(hidden.map((n) => n.id));
  // Contiguous and linear: each step but the last continues into the next,
  // and nothing outside the set hangs off any of them.
  for (let i = 0; i < hidden.length - 1; i++)
    if (nextStep(hidden[i], kids)?.id !== hidden[i + 1].id) return null;
  const last = hidden[hidden.length - 1];
  if (openBelow(last, kids)) return null;
  // The fold's own goal must be the run's first step's parent, so the splice
  // starts where the reader's `+N` says it does.
  if (!hidden[0].parents.some((p) => p.id === goal.id)) return null;
  for (const n of hidden)
    for (const k of kids.get(n.id) ?? [])
      if (k.type === "tactic" && !ids.has(k.id)) return null;
  return { steps: hidden, closes: true };
}

/** The document range one run occupies: the first step's tight start to the
 last step's tight stop. Everything between them — the newlines, the indents,
 any comment the author left among the steps — is inside the splice, because
 the steps it belonged to are what the collapse removes. */
export function runExtent(
  run: LinearRun,
  slots: readonly TacticSlot[],
): { start: Pos; stop: Pos } | null {
  const a = slotStartingAt(slots, run.steps[0].position!.start);
  const b = slotStartingAt(
    slots,
    run.steps[run.steps.length - 1].position!.start,
  );
  if (!a || !b) return null;
  if (
    b.stop.line < a.start.line ||
    (b.stop.line === a.start.line && b.stop.character < a.start.character)
  )
    return null;
  return { start: a.start, stop: b.stop };
}

/** D2a — COLLAPSE A RUN TO ONE AUTOMATION TACTIC. `tactic` is whatever the
 server found closes the run's first goal; nothing here decides that. The
 splice keeps the first step's own column, because the extent starts at it. */
export function collapseRewrite(
  run: LinearRun,
  ctx: RewriteCtx,
  tactic: string,
): Proposal {
  if (run.steps.length < 2) return no("a run is two steps or more");
  if (!run.closes)
    return no("this run does not close its goal — the steps below it need one");
  if (run.steps.some((s) => !s.position)) return no("no source for this run");
  const ext = runExtent(run, ctx.slots);
  if (!ext) return no("the run has no source extent");
  return {
    ok: true,
    rewrite: {
      kind: "collapse",
      nodeId: run.steps[0].id,
      name: tactic,
      targetId: run.steps[run.steps.length - 1].id,
      edits: [
        { range: { start: ext.start, end: ext.stop }, newText: tactic },
      ],
      title: `these ${run.steps.length} steps are \`${tactic}\``,
    },
  };
}

/** D2b — EXPAND AUTOMATION TO WHAT IT USED. The replacement is core's own
 `Try this` text, VERBATIM and never reconstructed from the parsed names: the
 parse is for reading, the suggestion is for writing. `grind?` answers with a
 LIST of scripts ("Try these:"); the first line is the one written, and the
 rest stay in the trace subtree where the reader can see them. */
export function expandRewrite(node: TreeNode, ctx: RewriteCtx): Proposal {
  if (node.type !== "tactic" || !node.position)
    return no("no source for this step");
  const t = node.trace;
  if (!t) return no("the trace has not been read yet");
  if (t.kind === "opaque")
    return no(`\`${t.tactic}\` keeps no lemma list — there is nothing to write`);
  if (t.kind !== "lemmas" || !t.suggestion)
    return no(`\`${t.tactic}?\` reported nothing to write`);
  const text = (t.suggestion.split("\n")[0] ?? "").trim();
  if (text === "") return no("the suggestion was empty");
  const me = ctx.src(node.position.start);
  if (!me) return no("no source for this step");
  if (!verbatim(me)) return no("the tactic's source is not available verbatim");
  if (me.text.trim() === text) return no("the source already says it");
  if (headWord(text) !== headWord(me.text))
    return no(
      `the suggestion is a \`${headWord(text)}\`, not a \`${headWord(me.text)}\``,
    );
  return {
    ok: true,
    rewrite: {
      kind: "expand",
      nodeId: node.id,
      name: t.tactic,
      targetId: node.id,
      edits: [
        { range: { start: me.start, end: me.stop }, newText: text },
      ],
      title: `write what \`${t.tactic}\` used`,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   D3 — DIRECT-IFY A CONTRADICTION PROOF (Blanchette et al.'s REDIRECTION)
   ══════════════════════════════════════════════════════════════════════════

   Blanchette–Böhme–Fleury–Smolka turn a machine's proof by contradiction into
   a direct proof. Restricted, as the catalogue says, to the shapes that are
   ONE EDIT, that is a much smaller move than the paper's, and the restriction
   is where all the content is.

   **The one shape that is one edit.** Batteries documents `by_contra` as:

       `by_contra h` proves `⊢ p` by contradiction, introducing a hypothesis
       `h : ¬p` and proving `False`.
       * If `p` is a negation `¬q`, `h : q` will be introduced instead of `¬¬q`.
                                       (Batteries/Tactic/Init.lean, `byContra`)

   So on a NEGATED goal `by_contra h` is not a proof by contradiction at all:
   it is `intro h`, spelled as though something classical were happening. The
   redirection there is one word — and it is the only redirection this module
   offers, because it is the only one whose result is determined by the text.

   **What is NOT offered, and why each is a rule rather than a gap.**

   * `by_contra h` on a POSITIVE goal `P`. The body genuinely derives `False`
     from `h : ¬P`, usually after a `push_neg at h`; turning it into a direct
     proof means finding a different proof, not moving text. This is
     `proofs/euclid.lean:40` (`⊢ N < p`), and the brief names it as the case
     to decline.
   * `exfalso` followed by anything but a single closing step. `exfalso` only
     ever REPLACES the goal with `False`; dropping it means the steps below it
     prove the original goal, which no text test can decide. This is
     `proofs/odd_sums.lean:57`, where three steps stand between the `exfalso`
     and the `exact`.
   * A closing step that reads the binder without naming it (`contradiction`),
     or names it more than once. There is nothing to substitute and no way to
     tell what would be left.

   `contradictionShapes` is the ANALYSIS: every contradiction-flavoured step in
   a proof, with the condition that decided it. The corpus's answer is in the
   design record and in `probe rewrite`. */

/** The head words that open a proof by contradiction, plus `intro`, which
 opens the same block when the goal is already a negation. */
const CONTRA_HEADS = new Set(["by_contra", "by_contra!", "exfalso", "intro"]);

/** Is this goal a negation — `¬ P`, `Not P` or `P → False`? Only there is
 `by_contra` the same tactic as `intro`. */
export function negatedGoal(label: string): boolean {
  const g = label.replace(/^⊢\s*/, "").replace(/\s+/g, " ").trim();
  return /^¬/.test(g) || /^Not\b/.test(g) || /→ False$/.test(g);
}

export interface ContradictionShape {
  nodeId: string;
  /** The step's head word, as written. */
  head: string;
  /** The goal it acted on, printed. */
  goal: string;
  negated: boolean;
  /** The name it bound, where it bound one. */
  binder?: string;
  /** How many steps the elaborator says read that binder. */
  uses?: number;
  /** The head word of the last step of the block it opened. */
  closing?: string;
  /** The redirection, or the condition that declined it. */
  offer: Proposal;
}

/** The step a block ends at: the last step, in source order, anywhere below
 this one. */
function lastStepBelow(
  node: TreeNode,
  kids: Map<string, TreeNode[]>,
): TreeNode | null {
  let best: TreeNode | null = null;
  const seen = new Set<string>();
  const stack = [...(kids.get(node.id) ?? [])];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    if (n.type === "tactic" && n.position) {
      if (
        !best ||
        n.position.start.line > best.position!.start.line ||
        (n.position.start.line === best.position!.start.line &&
          n.position.start.character > best.position!.start.character)
      )
        best = n;
    }
    for (const k of kids.get(n.id) ?? []) stack.push(k);
  }
  return best;
}

/** D3 — the redirection, where it is one edit: a `by_contra` on a NEGATED goal
 becomes the `intro` it already is. Nothing else is offered; every other
 contradiction shape is a change of proof rather than a change of text. */
export function directRewrite(node: TreeNode, ctx: RewriteCtx): Proposal {
  if (node.type !== "tactic" || !node.position)
    return no("no source for this step");
  const head = headWord(node.label);
  if (head !== "by_contra") return no("not a `by_contra`");
  const parent = ctxNode(ctx, node.parents[0]?.id);
  if (!parent || parent.type !== "goal")
    return no("the goal this step acted on is not drawn");
  if (!negatedGoal(parent.label))
    return no(
      "the goal is not a negation — the contradiction is doing real work",
    );
  const me = ctx.src(node.position.start);
  if (!me) return no("no source for this step");
  if (!verbatim(me)) return no("the tactic's source is not available verbatim");
  const m = /^(\s*)by_contra(!?)/.exec(me.text);
  if (!m) return no("the step's source does not start with `by_contra`");
  // `by_contra!` also PUSHES the negation in, which on a negated goal is a
  // second thing it does; `intro` alone would not reproduce it.
  if (m[2] === "!") return no("`by_contra!` also normalises the negation");
  const start = advance(me.start, me.text, m[1].length);
  const end = advance(me.start, me.text, m[0].length);
  return {
    ok: true,
    rewrite: {
      kind: "inline",
      nodeId: node.id,
      name: "by_contra",
      targetId: node.id,
      edits: [{ range: { start, end }, newText: "intro" }],
      title: "prove directly — the goal is a negation",
    },
  };
}

/** Every contradiction-flavoured step in a tree, classified. The analysis D3
 ships: what the corpus contains, and which condition declined each one. */
export function contradictionShapes(
  nodes: readonly TreeNode[],
  ctx: RewriteCtx,
): ContradictionShape[] {
  const out: ContradictionShape[] = [];
  // One kids index for the whole sweep: `lastStepBelow` used to rebuild it
  // per candidate step.
  const kids = kidsOf(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n.type !== "tactic" || !n.position) continue;
    const head = headWord(n.label) + (/^by_contra!/.test(n.label.trim()) ? "!" : "");
    if (!CONTRA_HEADS.has(head)) continue;
    const parent = byId.get(n.parents[0]?.id ?? "");
    const goal = (parent?.label ?? "").replace(/^⊢\s*/, "").split("\n")[0];
    const negated = !!parent && negatedGoal(parent.label);
    // An `intro` is only a contradiction shape at all where the goal it
    // introduces into is already a negation; everywhere else it is just a
    // binder and this analysis has nothing to say about it.
    if (head === "intro" && !negated) continue;
    const binder = n.uses?.name;
    const closing = lastStepBelow(n, kids);
    out.push({
      nodeId: n.id,
      head,
      goal,
      negated,
      binder,
      uses: n.uses?.count,
      closing: closing ? headWord(closing.label) : undefined,
      offer:
        head === "exfalso"
          ? no("`exfalso` replaces the goal — dropping it changes what is proved")
          : head === "intro"
            ? no("already direct")
            : directRewrite(n, ctx),
    });
  }
  return out;
}
