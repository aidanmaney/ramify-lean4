// The tagged-goal renderers, independent of WHAT draws a piece of tagged code.
// `taggedRender.tsx` binds them to the infoview's interactive code (live
// hovers over RPC); the static viewer binds them to `BakedCode` (popups baked
// at harvest time). Nothing here imports the infoview, so a page that never
// talks to a Lean server does not bundle it.
import type { ReactNode } from "react";
import type { GoalInfo, Proof } from "./paperproof";
import { stepGoalsAfter } from "./paperproof";
import { hypLine, isInaccessibleName, TURNSTILE } from "./proofToTree";
import {
  flattenTaggedText,
  lineOffsets,
  sliceTaggedText,
  type TaggedText,
} from "./taggedText";

/** The parts of an infoview hypothesis bundle the renderers read, over any
 tag type. */
export interface HypBundleOf<T> {
  fvarIds?: string[];
  type: TaggedText<T>;
  val?: TaggedText<T>;
  isInserted?: boolean;
  isRemoved?: boolean;
}

/** The parts of an infoview goal the renderers read. */
export interface GoalOf<T> {
  type: TaggedText<T>;
  hyps: HypBundleOf<T>[];
}

export interface TaggedGoalEntryOf<T> {
  goalId: string;
  goal: GoalOf<T>;
}

/** Draws one piece of tagged code: the infoview's live, `BakedCode` offline. */
export type CodeRenderer<T> = (fmt: TaggedText<T>) => ReactNode;

export function injectStyleOnce(id: string, css: string) {
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

const TAGGED_CSS = [
    ".ptw-tagged .font-code { font: inherit; line-height: inherit; color: inherit; }",

    "@keyframes ptw-tooltip-hold { from, 99% { opacity: 0; pointer-events: none } to { opacity: 1 } }",

    ".tooltip { z-index: 3000; }\n" +
    ".tooltip:has(.tooltip-code-content):not(:has(.tooltip-code-content > *))" +
      " { animation: ptw-tooltip-hold 150ms both; }",

    ".tooltip-code-content > .font-code.pre-wrap:not(:has(> *))," +
      " .tooltip-code-content > .font-code.pre-wrap:not(:has(> *)) + hr" +
      " { display: none; }",

    ".ptw-tagged span.inserted-text, .ptw-tagged span.removed-text" +
      " { border: 0; padding: 0; margin: 0; border-radius: 2pt; }",
    ".ptw-tagged span.inserted-text {" +
      " background-color: var(--ptw-diff-ins);" +
      " box-shadow: inset 0 0 0 1px var(--ptw-diff-ins-border); }",
    ".ptw-tagged span.removed-text {" +
      " background-color: var(--ptw-diff-del);" +
      " box-shadow: inset 0 0 0 1px var(--ptw-diff-del-border); }",

    '[data-ptw-hypmark="underline"] .ptw-tagged span.inserted-text {' +
      " background-color: transparent;" +
      " box-shadow: inset 0 -1px 0 var(--ptw-diff-ins); }",
    '[data-ptw-hypmark="underline"] .ptw-tagged span.removed-text {' +
      " background-color: transparent;" +
      " box-shadow: inset 0 -1px 0 var(--ptw-diff-del); }",

    // The infoview's own inks, one pane over (theme.ts `--ptw-hypname` & co):
    // a hypothesis NAME, the turnstile, and an inaccessible `x✝` name, which
    // the goal list draws italic at 0.7. Colour and style only — the code
    // font's italic keeps the advance, so nothing measured moves.
    ".ptw-hypname { color: var(--ptw-hypname); }",
    ".ptw-turnstile { color: var(--ptw-turnstile); }",
    ".ptw-inaccessible { color: var(--ptw-inaccessible); font-style: italic; opacity: 0.7; }",
].join("\n");

/** A hypothesis name's classes: the infoview's ink (inaccessible or not),
 plus the diff wash where the producing tactic minted it. */
const hypNameClass = (name: string, diffCls?: string): string =>
  [isInaccessibleName(name) ? "ptw-inaccessible" : "ptw-hypname", diffCls]
    .filter(Boolean)
    .join(" ");

export function ensureTaggedStyle() {
  injectStyleOnce("proof-tree-tagged-style", TAGGED_CSS);
}

export interface TaggedRenderers {
  renderTaggedGoal: (
    goalId: string,
    lines: string[],

    hiddenLhs?: string,

    prefix?: string,
  ) => ReactNode[] | null;
  renderTaggedHyps: (
    goalId: string,
    lines: string[],
  ) => (ReactNode | null)[] | null;
}

function taggedLines<T>(
  fmt: TaggedText<T>,
  lines: string[],
  code: CodeRenderer<T>,
): ReactNode[] | null {
  const offsets = lineOffsets(flattenTaggedText(fmt), lines);
  if (!offsets) return null;
  return offsets.map(([start, end], i) => {
    const part = sliceTaggedText(fmt, start, end);
    return part ? (
      <span key={i} className="ptw-tagged">
        {code(part)}
      </span>
    ) : (
      lines[i]
    );
  });
}

export function makeTaggedRenderersWith<T>(
  proof: Proof,
  entries: TaggedGoalEntryOf<T>[],
  code: CodeRenderer<T>,
): TaggedRenderers {
  ensureTaggedStyle();
  const tagged = new Map(entries.map((e) => [e.goalId, e.goal]));

  const goalCache = new Map<string, ReactNode[] | null>();
  const hypsCache = new Map<string, (ReactNode | null)[] | null>();
  const keyOf = (goalId: string, lines: string[]) =>
    `${goalId}\u0000${lines.join("\u0000")}`;

  const goalById = new Map<string, GoalInfo>();
  for (const g of proof.allGoals) goalById.set(g.id, g);
  for (const step of proof.steps) {
    goalById.set(step.goalBefore.id, step.goalBefore);
    for (const g of stepGoalsAfter(step)) goalById.set(g.id, g);
  }

  const producerCtx = new Map<string, Set<string>>();
  for (const step of proof.steps) {
    for (const g of stepGoalsAfter(step)) {
      if (!producerCtx.has(g.id))
        producerCtx.set(g.id, new Set(step.goalBefore.hyps.map((h) => h.id)));
    }
  }

  const renderTaggedGoal = (
    goalId: string,
    lines: string[],
    hiddenLhs?: string,
    prefix = "_",
  ) => {
    const key = keyOf(goalId, lines);
    const hit = goalCache.get(key);
    if (hit !== undefined) return hit;
    const out = computeTaggedGoal(goalId, lines, hiddenLhs, prefix);
    goalCache.set(key, out);
    return out;
  };
  const computeTaggedGoal = (
    goalId: string,
    lines: string[],
    hiddenLhs?: string,
    prefix = "_",
  ) => {
    const ig = tagged.get(goalId);
    if (!ig) return null;

    let fmt = ig.type;
    if (hiddenLhs) {
      const flat = flattenTaggedText(fmt);
      if (!flat.startsWith(hiddenLhs)) return null;
      const rest = sliceTaggedText(fmt, hiddenLhs.length, flat.length);
      if (!rest) return null;

      fmt = prefix ? { append: [{ text: prefix }, rest] } : rest;
    }

    const hasTurnstile = lines[0]?.startsWith(TURNSTILE);
    const bare = hasTurnstile
      ? [lines[0].slice(TURNSTILE.length), ...lines.slice(1)]
      : lines;
    const nodes = taggedLines(fmt, bare, code);
    if (!nodes || !hasTurnstile) return nodes;
    return [
      <span key="turnstile-line">
        <span className="ptw-turnstile">{TURNSTILE}</span>
        {nodes[0]}
      </span>,
      ...nodes.slice(1),
    ];
  };

  const renderTaggedHyps = (goalId: string, lines: string[]) => {
    const key = keyOf(goalId, lines);
    const hit = hypsCache.get(key);
    if (hit !== undefined) return hit;
    const out = computeTaggedHyps(goalId, lines);
    hypsCache.set(key, out);
    return out;
  };
  const computeTaggedHyps = (goalId: string, lines: string[]) => {
    const ig = tagged.get(goalId);
    const child = goalById.get(goalId);
    if (!ig || !child) return null;

    const byLine = new Map(child.hyps.map((h) => [hypLine(h), h]));
    const byFvar = new Map<string, HypBundleOf<T>>();
    for (const b of ig.hyps) for (const fv of b.fvarIds ?? []) byFvar.set(fv, b);

    const prev = producerCtx.get(goalId);
    return lines.map((line) => {
      const h = byLine.get(line);
      const b = h && byFvar.get(h.id);
      if (!h || !b || flattenTaggedText(b.type) !== h.type) return null;
      if (h.value != null && (!b.val || flattenTaggedText(b.val) !== h.value))
        return null;
      const diffCls =
        b.isInserted && !prev?.has(h.id)
          ? "inserted-text"
          : b.isRemoved && !prev?.has(h.id)
            ? "removed-text"
            : undefined;
      return (
        <span className="ptw-tagged">

          <span className={hypNameClass(h.username, diffCls)}>{h.username}</span>
          {" : "}
          {code(b.type)}
          {h.value != null && b.val ? (
            <>
              {" := "}
              {code(b.val)}
            </>
          ) : null}
        </span>
      );
    });
  };

  return { renderTaggedGoal, renderTaggedHyps };
}
