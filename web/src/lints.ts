// D4 — IDIOM NORMALISATION, LINT-DRIVEN.
//
// Workstream D's fourth catalogue entry, and the one that reimplements the
// least: Mathlib's style rules ALREADY SHIP AS PROGRAMS. They are `linter.*`
// options that run at elaboration and log a warning at the syntax they object
// to, so nothing here decides what good Lean looks like. The declaration is
// re-elaborated once with the linters on (`ProofTree.lintDecl` on the server,
// `ppharness --lint` offline) and the messages come back with their own
// ranges and their own option names, read off the message's TAG rather than
// scraped out of its text.
//
// This module is the client half, and it is pure:
//
//   * `lintNodeAt` — which drawn node a lint belongs to.
//   * `lintFix`    — the one edit that answers it, where there is one.
//
// **Every fix is an edit at the LINTER'S OWN RANGE, or at a slot the linter's
// range starts.** That is not a coincidence but the reason the fix table is as
// short as it is: measured against the live server, `style.cdot` points at the
// `.`, `style.lambdaSyntax` at the `λ` and `unnecessarySeqFocus` at the `<;>`
// — each is one token, and the fix is that token rewritten. Where the linter
// points at something wider (`style.cases` at a whole `cases' h with h h`,
// `style.longLine` at a column), the transposition it asks for is not a token
// swap and NO fix is offered: the lint is shown and the reader writes their
// own answer, which is the standing rule about not completing an author's
// text with something they did not choose.
//
// Nothing here decides whether a fix is CORRECT. Every one goes through
// `ProofTree.checkRewrite` before the reader is offered it, exactly as D1's
// inline does — so a fix computed from the linter's range alone, with no
// verbatim source to check it against, is still never written on a guess.
import type { TacticSlot } from "./paperproof";
import type { TreeNode } from "./types";
import { deleteEdit, slotAt } from "./deleteEdit";
import { posLE } from "./proofToTree";
import { expandRewrite } from "./rewrite";
import type { Pos, Proposal, Rewrite, RewriteCtx } from "./rewrite";

/** One linter message, as `ProofTree.Lint` puts it on the wire. Plain data,
 so it rides both wires — the CLI's `--lint` writes it onto NDJSON and the
 widget asks `ProofTree.lintDecl` for it. */
export interface Lint {
  start: Pos;
  stop: Pos;
  /** The option's own name, e.g. `linter.unusedTactic`. */
  linter: string;
  /** The linter's message, with core's "can be disabled with" note cut. */
  message: string;
}

/** The severity lints ride at in the diagnostics pipeline. Errors are 1 and
 warnings 2 (LSP's own numbering); a lint is neither — the proof is correct —
 so it is LSP's `hint`, and the ribbon draws a third ink for it. */
export const SEVERITY_LINT = 3;

/** `linter.style.multiGoal` → `style.multiGoal`. What the ribbon's `<title>`
 and the bar's pager name, since every one of them starts `linter.`. */
export const lintName = (l: Lint | string): string =>
  (typeof l === "string" ? l : l.linter).replace(/^linter\./, "");

/** The node a lint is drawn on: the INNERMOST tactic node whose range holds
 it — B3's attribution — and failing that the LAST node, of either kind, that
 starts at or before it.

 The fallback earns its keep on the very lint whose fix is simplest.
 `linter.unusedTactic` fires on a tactic that DOES NOTHING, and a tactic that
 changes no goal is harvested as no step at all: measured on
 `lean/ProofTreeLints.lean`, the `skip` at 40:2 has a `deleteSlots` slot and no
 node. Without the fallback the one lint whose fix is a delete would have
 nowhere to be offered from. */
export function lintNodeAt(
  nodes: readonly TreeNode[],
  l: Lint,
): string | null {
  // ONE pass. The three candidates are independent of each other — only which
  // one is USED depends on the others — so they are all collected together
  // rather than by three sweeps of the node list per lint.
  let inner: TreeNode | null = null;
  let above: TreeNode | null = null;
  let below: TreeNode | null = null;
  for (const n of nodes) {
    if (!n.position) continue;
    const tactic = n.type === "tactic";
    const at = n.position.start;
    if (tactic && posLE(at, l.start) && posLE(l.start, n.position.stop))
      if (!inner || posLE(inner.position!.start, at)) inner = n;
    if (posLE(at, l.start))
      if (!above || posLE(above.position!.start, at)) above = n;
    if (tactic && posLE(l.start, at))
      if (!below || posLE(at, below.position!.start)) below = n;
  }
  if (inner) return inner.id;
  if (above) return above.id;
  // Nothing above it: the lint is on the FIRST thing in the proof, which is
  // where a `skip` most often is. The owner is then the GOAL the tactic below
  // it stands under — the root, in the measured case — and never that tactic
  // itself, which would put "'skip' tactic does nothing" on the `rfl` that
  // does the work.
  const parent = below?.parents[0]?.id;
  return parent ?? nodes[0]?.id ?? null;
}

/** Every lint, grouped by the node it lands on. */
export function lintsByNode(
  nodes: readonly TreeNode[],
  lints: readonly Lint[],
): Map<string, Lint[]> {
  const out = new Map<string, Lint[]>();
  for (const l of lints) {
    const id = lintNodeAt(nodes, l);
    if (!id) continue;
    const cur = out.get(id);
    if (cur) cur.push(l);
    else out.set(id, [l]);
  }
  return out;
}

/** What the fix DOES, in the reader's words — the pill's title and the `?`
 panel's table. A linter absent from this map has no one-edit answer. */
export const LINT_FIXES: Record<string, string> = {
  "linter.unusedTactic": "delete the step — it does nothing",
  "linter.style.multiGoal": "focus this goal with `·`",
  "linter.style.cdot": "write `·` for the focusing dot",
  "linter.style.lambdaSyntax": "write `fun` for `λ`",
  "linter.unnecessarySeqFocus": "write `;` for `<;>`",
  "linter.haveLet": "`have` binds a Type — write `let`",
  "linter.flexible": "write what `simp` used, so the step is not flexible",
};

/** How long `have` is, in the one fix that replaces a keyword by position
 rather than by the linter's whole range. */
const HAVE = "have".length;

const no = (why: string): Proposal => ({ ok: false, why });

export interface LintCtx extends RewriteCtx {
  slots: readonly TacticSlot[];
}

/**
 * The one edit that answers a lint, where there is one.
 *
 * `node` is the node the lint was drawn on — needed only by `flexible`, which
 * delegates to D2's expand and therefore needs the step's trace. Every other
 * fix is computed from the lint's own range and the slot table, which is why
 * they are offered in the offline harness with no source lookup at all.
 */
export function lintFix(
  l: Lint,
  node: TreeNode | null,
  ctx: LintCtx,
): Proposal {
  const at = (newText: string, start = l.start, end = l.stop): Proposal => ({
    ok: true,
    rewrite: {
      kind: "lint",
      nodeId: node?.id ?? "",
      name: lintName(l),
      targetId: node?.id ?? "",
      edits: [{ range: { start, end }, newText }],
      title: LINT_FIXES[l.linter] ?? lintName(l),
    },
  });

  switch (l.linter) {
    case "linter.style.cdot":
      return at("·");
    case "linter.style.lambdaSyntax":
      return at("fun");
    case "linter.unnecessarySeqFocus":
      // The linter points at the `<;>` itself (measured), so the fix is that
      // token and nothing else. A `<;>` that is genuinely load-bearing is
      // never flagged in the first place — deciding that is the linter's job
      // and not this module's.
      return at(";");
    case "linter.haveLet":
      // The linter points at the whole `have … := …`; the keyword is its
      // first four characters.
      return at("let", l.start, {
        line: l.start.line,
        character: l.start.character + HAVE,
      });
    case "linter.style.multiGoal": {
      // Focus the goal the linter says was left standing. One `· ` inserted
      // at the tactic's own column, and NOTHING else: re-indenting a run
      // below it is not one edit, so a tactic whose slot is not the whole of
      // what closes the goal is left to the reader.
      const s = slotAt(ctx.slots, l.start);
      if (!s) return no("the tactic has no slot of its own");
      if (!s.lineStart)
        return no("the tactic does not start its line — a bullet needs one");
      if (s.start.line !== s.stop.line)
        return no("the tactic runs over more than one line");
      return at("· ", s.start, s.start);
    }
    case "linter.unusedTactic": {
      // The delete gesture's own extent, so the step goes with its comment
      // line and the whole-line rule applies (`deleteEdit`).
      const s = slotAt(ctx.slots, l.start);
      if (!s) return no("the tactic has no slot of its own");
      const e = deleteEdit(
        { kind: "tactic", anchors: [{ start: s.start, stop: s.stop }], comments: [] },
        ctx.slots,
      );
      if (!e) return no("the step has no delete extent");
      if (e.newText !== "")
        return no("deleting it would empty the block — `sorry` is not a fix");
      return at("", e.range.start, e.range.end);
    }
    case "linter.flexible": {
      // D2b's own move: the flexible tactic is a `simp` whose result a later
      // step reads, and what makes it not flexible is writing the lemma list
      // core itself suggests. So the fix IS the expand, trace and all — and
      // where no trace is in hand the reader is told so rather than offered
      // a list this module made up.
      if (!node) return no("the step is not drawn");
      const p = expandRewrite(node, ctx);
      if (!p.ok) return p;
      return {
        ok: true,
        rewrite: { ...p.rewrite, kind: "lint", title: LINT_FIXES[l.linter] },
      };
    }
    default:
      return no(`\`${lintName(l)}\` has no one-edit answer`);
  }
}

/** The FIRST fix a node's lints offer, computed lazily: `linter.flexible`'s
 answer is D2b's expand, which needs a trace, so an earlier lint that already
 answered must not pay for it. The full list is `lintFixesFor`, which every
 caller uses only to SAY why nothing was offered. */
export function firstLintFix(
  node: TreeNode,
  lints: readonly Lint[],
  ctx: LintCtx,
): { lint: Lint; rewrite: Rewrite } | null {
  for (const lint of lints) {
    const proposal = lintFix(lint, node, ctx);
    if (proposal.ok) return { lint, rewrite: proposal.rewrite };
  }
  return null;
}

/** Every fix a node's lints offer, in the lints' own order. */
export function lintFixesFor(
  node: TreeNode,
  lints: readonly Lint[],
  ctx: LintCtx,
): { lint: Lint; proposal: Proposal }[] {
  return lints.map((lint) => ({ lint, proposal: lintFix(lint, node, ctx) }));
}
