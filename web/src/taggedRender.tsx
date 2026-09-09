import type { ReactNode } from "react";
import {
  InteractiveCode,
  type CodeWithInfos,
  type InteractiveGoal,
  type InteractiveHypothesisBundle,
} from "@leanprover/infoview";
import type { GoalInfo, Proof } from "./paperproof";
import { stepGoalsAfter } from "./paperproof";
import { hypLine, TURNSTILE } from "./proofToTree";
import { flattenTaggedText, lineOffsets, sliceTaggedText } from "./taggedText";

export interface TaggedGoalEntry {
  goalId: string;
  goal: InteractiveGoal;
}

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
      " background-color: var(--vscode-diffEditor-insertedTextBackground, var(--ptw-diff-ins));" +
      " box-shadow: inset 0 0 0 1px var(--vscode-diffEditor-insertedTextBorder, transparent); }",
    ".ptw-tagged span.removed-text {" +
      " background-color: var(--vscode-diffEditor-removedTextBackground, var(--ptw-diff-del));" +
      " box-shadow: inset 0 0 0 1px var(--vscode-diffEditor-removedTextBorder, transparent); }",

    '[data-ptw-hypmark="underline"] .ptw-tagged span.inserted-text {' +
      " background-color: transparent;" +
      " box-shadow: inset 0 -1px 0 var(--vscode-diffEditor-insertedTextBackground, var(--ptw-diff-ins)); }",
    '[data-ptw-hypmark="underline"] .ptw-tagged span.removed-text {' +
      " background-color: transparent;" +
      " box-shadow: inset 0 -1px 0 var(--vscode-diffEditor-removedTextBackground, var(--ptw-diff-del)); }",
].join("\n");

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

function taggedLines(fmt: CodeWithInfos, lines: string[]): ReactNode[] | null {
  const offsets = lineOffsets(flattenTaggedText(fmt), lines);
  if (!offsets) return null;
  return offsets.map(([start, end], i) => {
    const part = sliceTaggedText(fmt, start, end);
    return part ? (
      <span key={i} className="ptw-tagged">
        <InteractiveCode fmt={part} />
      </span>
    ) : (
      lines[i]
    );
  });
}

export function makeTaggedRenderers(
  proof: Proof,
  entries: TaggedGoalEntry[],
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
    const nodes = taggedLines(fmt, bare);
    if (!nodes || !hasTurnstile) return nodes;
    return [
      <span key="turnstile-line">
        {TURNSTILE}
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
    const byFvar = new Map<string, InteractiveHypothesisBundle>();
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

          {diffCls ? <span className={diffCls}>{h.username}</span> : h.username}
          {" : "}
          <InteractiveCode fmt={b.type} />
          {h.value != null && b.val ? (
            <>
              {" := "}
              <InteractiveCode fmt={b.val} />
            </>
          ) : null}
        </span>
      );
    });
  };

  return { renderTaggedGoal, renderTaggedHyps };
}
