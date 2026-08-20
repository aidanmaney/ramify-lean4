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

// Widget-land composition of the tagged (hover-interactive) rendering: builds
// the `renderTaggedGoal` / `renderTaggedHyps` hooks ProofTreeView accepts,
// backed by the `taggedGoals` the RPC returned alongside the proof. This is
// the only renderer-side module that may import infoview APIs — ProofTreeView
// stays source-agnostic and receives finished ReactNodes.
//
// Everything here is guarded by *text equality*: a tagged line is only used
// when its stripped text is exactly the plain string the layout measured, so
// the interactive overlay can never disagree with the box geometry. Any
// mismatch (a goal printed under a different mctx, a missing bundle, …) falls
// back to the plain SVG text for that node/line — tooltips degrade, layout
// never breaks.

/** One `taggedGoals` entry as `ProofTree.getProofTree` returns it. */
export interface TaggedGoalEntry {
  goalId: string; // mvarId string — same key as GoalInfo.id
  goal: InteractiveGoal;
}

// InteractiveCode wraps its output in <span class="font-code">, which the
// infoview styles with the EDITOR's font (family/size/line-height, plus the
// theme foreground color). Our boxes are measured in the tree's own font
// (layout.ts — same FAMILY as the editor's, via getCodeFontFamily, but our own
// size/line-height), so left alone the rich text renders bigger than the box it was
// measured for (and near-invisible on our light boxes in dark themes). Undo it
// inside our labels only: every tagged line is wrapped in .ptw-tagged, and
// this injected rule makes .font-code inherit the surrounding div's font —
// the very one the canvas measurer used. The hover type-popups are safe: the
// infoview portals them to document.body, outside any .ptw-tagged ancestor,
// so they keep their native editor styling.
/** Inject a stylesheet into the document head once, keyed by element id.
Deliberately never removed: each sheet is inert without its target markup, and
widget remounts are frequent (every cursor move). Shared by the tagged-label
sheet below and widget.tsx's section-order sheet. */
export function injectStyleOnce(id: string, css: string) {
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

const TAGGED_CSS = [
    ".ptw-tagged .font-code { font: inherit; line-height: inherit; color: inherit; }",
    // Hold a type popup back while its content is still in flight, so it never
    // flashes "Loading.." and then resizes under the pointer. The infoview
    // renders the loading (and error) state as a BARE TEXT NODE inside
    // .tooltip-code-content and the resolved state as real elements, so
    // `:not(:has(.tooltip-code-content > *))` is exactly "content hasn't
    // arrived yet".
    //
    // The rule applies ONLY in that state, so the resolved popup — the
    // overwhelmingly common one — is never animated and never delayed: the
    // moment content lands the selector stops matching and it is simply
    // visible. That also means a failure to animate cannot strand a populated
    // popup invisible, which an earlier "hide everything, reveal by animation"
    // shape could. The keyframe holds it hidden for 150ms then reveals it
    // regardless, so a genuinely slow call still shows "Loading.." and an
    // error still shows itself; only the sub-150ms flicker goes.
    //
    // This is the one rule here that is NOT scoped to [data-ptw-root]: the
    // popups are portalled to document.body, outside our subtree, so there is
    // no ancestor to scope on. It is deliberately confined to appearance
    // timing — no restyling — and applies only to tooltips carrying code
    // content, leaving the infoview's menu tooltips alone.
    "@keyframes ptw-tooltip-hold { from, 99% { opacity: 0; pointer-events: none } to { opacity: 1 } }",
    // POPUPS ABOVE THE SIGNATURE HEADER. They portal to `document.body`, but
    // the header is a positioned, painted bar inside our own root, and a token
    // hovered IN the header opens its popup right where the header is — which
    // drew the popup UNDER it, the statement's own glyphs sitting on top of
    // the popup's text (reported). Raising the popups is the right direction
    // rather than lowering the header: a popup is transient and must win over
    // everything, while the header is chrome that must sit above the tree.
    ".tooltip { z-index: 3000; }\n" +
    ".tooltip:has(.tooltip-code-content):not(:has(.tooltip-code-content > *))" +
      " { animation: ptw-tooltip-hold 150ms both; }",
    // Drop the popup's type line when there is no type to show. The infoview
    // renders `{exprExplicit} : {type}` with the separator UNCONDITIONAL, and
    // `makePopup` fills neither field for a `TacticInfo` (it produces
    // `exprExplicit` only for term/field info, and `Info.type?` is none for a
    // tactic) — so hovering a tactic keyword, whose whole value is its
    // docstring, led with a line reading just " : ". Both halves missing is
    // exactly "this div has no element children", so the empty case is the
    // only one hidden: a popup with a real expr or a real type keeps its line,
    // colon and all. The following <hr> goes too, or the popup would open on a
    // rule with nothing above it.
    ".tooltip-code-content > .font-code.pre-wrap:not(:has(> *))," +
      " .tooltip-code-content > .font-code.pre-wrap:not(:has(> *)) + hr" +
      " { display: none; }",
    // TACTIC DIFF. `InteractiveCode` already puts `inserted-text`/`removed-text`
    // on a subterm whose SubexprInfo carries a `diffStatus` (the class map is
    // in the infoview bundle), and the infoview's own stylesheet paints them —
    // in the infoview. These rules exist for two things it does not do.
    //
    // GEOMETRY. Our boxes are sized by canvas `measureText` over the plain
    // string, so a highlight may add background and NOTHING that advances the
    // inline box. The infoview's base rule is safe (background + radius, no
    // padding, no margin) but its high-contrast variant is `border: thin
    // solid`, and a border on an inline span DOES add width — it would push
    // text past the box it was measured for on exactly the themes that need
    // the signal most. So the border is dropped and re-drawn as an INSET
    // box-shadow, which paints in the same place and occupies no space.
    //
    // FALLBACK. `--vscode-diffEditor-*` exists only in a VS Code host. The
    // `var(…, …)` chain keeps the editor's own colour wherever it is defined —
    // so in the infoview this repaints exactly what the infoview would have —
    // and falls through to a --ptw recipe otherwise. The recipe is mixed
    // against --ptw-surface, not --ptw-bg: these land INSIDE a node box (the
    // --ptw-prose lesson).
    // `span.` and not `.` is deliberate: the high-contrast rule being undone
    // is `.vscode-high-contrast .inserted-text`, the SAME specificity as
    // `.ptw-tagged .inserted-text`, which would leave the winner decided by
    // sheet order — ours is injected at mount and the infoview's is a static
    // sheet, so we win today and would silently stop winning if that ever
    // changed. The element is a `<span>` in both paths (InteractiveCode
    // renders one; the hypothesis-name mark below is one), so naming it costs
    // nothing and settles the tie.
    ".ptw-tagged span.inserted-text, .ptw-tagged span.removed-text" +
      " { border: 0; padding: 0; margin: 0; border-radius: 2pt; }",
    ".ptw-tagged span.inserted-text {" +
      " background-color: var(--vscode-diffEditor-insertedTextBackground, var(--ptw-diff-ins));" +
      " box-shadow: inset 0 0 0 1px var(--vscode-diffEditor-insertedTextBorder, transparent); }",
    ".ptw-tagged span.removed-text {" +
      " background-color: var(--vscode-diffEditor-removedTextBackground, var(--ptw-diff-del));" +
      " box-shadow: inset 0 0 0 1px var(--vscode-diffEditor-removedTextBorder, transparent); }",
    // UNDERLINE VARIANT (ramify.hypMarkStyle). The hover answer and the diff
    // land on the same context lines and often on the SAME one, so they have
    // to be told apart. By default that is hue — the wash beside these is
    // --ptw-hyp-lit, a different hue at the same weight. This variant trades
    // both for SHAPE: the hover answer draws a DASHED rule (in HypBlock) and
    // the diff the SOLID one here, which is the pair that still separates for
    // a reader who cannot use the colours, and the reason the connectors'
    // marks are the accessible baseline too.
    //
    // The rule is an INSET box-shadow, never border-bottom or
    // text-decoration: a border adds inline advance (the recorded geometry
    // trap two comments up) and text-decoration is inherited by, and drawn
    // across, nested spans. The background goes fully transparent — keeping a
    // wash under a solid rule would put three marks on one line.
    //
    // Scoped on the ROOT attribute, so it costs nothing when off and needs no
    // second sheet; `span.` for the specificity reason above, and last in the
    // sheet so it wins over the two rules it overrides.
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
    // Brief mode: the LHS the label replaced with `_` (TreeNode.goalElision).
    hiddenLhs?: string,
    // What the dropped prefix is replaced BY. `_` is the brief-mode elision's
    // own stand-in; a `calc` LEDGER row replaces it with nothing at all (its
    // drawn text opens on the relation, which is already the first token of
    // what is left). The same one rewrite either way — see LedgerRow.
    prefix?: string,
  ) => ReactNode[] | null;
  renderTaggedHyps: (
    goalId: string,
    lines: string[],
  ) => (ReactNode | null)[] | null;
}

// The tagged text, cut at the layout's exact line breaks (see taggedText.ts) —
// one non-wrapping InteractiveCode per line, or null if the flat text doesn't
// reconstruct the lines (then the plain render stands).
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

  // Result caches. The view calls these hooks for EVERY visible node on EVERY
  // render — each hover enter/leave, zoom tick and editing keystroke — and
  // un-cached each call redid the tag-tree slicing and rebuilt the ReactNode
  // arrays wholesale. The caches live in this closure, so they are dropped
  // exactly when the inputs change (the renderers are rebuilt per
  // (proof, taggedGoals) pair); the key carries the wrapped lines too, because
  // a font change re-measures lines without rebuilding the renderers.
  // Returning the identical array also lets React bail on reconciliation.
  const goalCache = new Map<string, ReactNode[] | null>();
  const hypsCache = new Map<string, (ReactNode | null)[] | null>();
  const keyOf = (goalId: string, lines: string[]) =>
    `${goalId}\u0000${lines.join("\u0000")}`;

  // Context blocks show a goal's own hypotheses (whichever subset the label
  // mode picked), drawn inside that goal's box — so index every goal we know
  // of.
  const goalById = new Map<string, GoalInfo>();
  for (const g of proof.allGoals) goalById.set(g.id, g);
  for (const step of proof.steps) {
    goalById.set(step.goalBefore.id, step.goalBefore);
    for (const g of stepGoalsAfter(step)) goalById.set(g.id, g);
  }

  // The fvarIds a produced goal's PRODUCER already had in scope — what the
  // inserted-hypothesis mark is refined against below. First producer wins,
  // matching the tree's own producer rule (proofToTree emits
  // goalBefore ──tactic──▶ goalsAfter ++ spawnedGoals).
  const producerCtx = new Map<string, Set<string>>();
  for (const step of proof.steps) {
    for (const g of stepGoalsAfter(step)) {
      if (!producerCtx.has(g.id))
        producerCtx.set(g.id, new Set(step.goalBefore.hyps.map((h) => h.id)));
    }
  }

  // The cache key needs no elision component: an elided label produces
  // different `lines`, which are already in the key.
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
    // Brief mode elided this link's LHS to `_`. Rebuild the tagged print the
    // same way — drop the hidden prefix, prepend a plain `_` — so the flat
    // text matches the shortened label exactly and the equality guard below
    // still holds. The `_` carries no tag, which is right: it stands for text
    // that isn't being drawn, so there is no subterm to hover.
    let fmt = ig.type;
    if (hiddenLhs) {
      const flat = flattenTaggedText(fmt);
      if (!flat.startsWith(hiddenLhs)) return null;
      const rest = sliceTaggedText(fmt, hiddenLhs.length, flat.length);
      if (!rest) return null;
      // An empty prefix (a ledger row) appends nothing: the row's drawn text
      // IS the suffix, so the flat text must be it exactly.
      fmt = prefix ? { append: [{ text: prefix }, rest] } : rest;
    }
    // Goal labels carry a plain "⊢ " prefix (proofToTree) that the
    // interactive print doesn't — strip it for the text-equality match,
    // then re-attach it as plain text in the identical spot. The measured
    // line includes the prefix, so geometry is unchanged.
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

  // Context lines aren't pixel-wrapped (the box grows to the widest line), so
  // each is rebuilt as plain `name : ` + interactive type — no slicing. Lines
  // are matched back to the goal's hyps BY TEXT, one at a time: this covers
  // both label modes (the delta and the full context are each a subset of the
  // goal's hyps) and degrades per-line, not wholesale.
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

    // Which lines the tactic that produced this goal INTRODUCED. The gate is
    // core's own `isInserted?` — set by the same diff pass that tagged the
    // type, so we never mark a name the editor would not — but core's flag is
    // per BUNDLE, and the infoview draws a bundle as one line (`ih h : …`)
    // where we draw one line per hypothesis. Taking the flag straight would
    // therefore highlight `ih` because `h` was bundled with it, which is a
    // claim about a line the editor never made. So the flag is REFINED by the
    // producer's own context: a name is marked only when its fvarId was not
    // already in scope. A bundle mutated in place (`rw … at h` — same name,
    // new fvarId) is not `isInserted?` at all; core answers those with a type
    // diff, which the tagged type carries free. With no producer on the wire
    // there is nothing to refine against and the bundle flag stands, which is
    // the editor's own answer.
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
          {/* Background only — the text is byte-identical either way, so the
              measured line is unchanged (see TAGGED_CSS). */}
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
