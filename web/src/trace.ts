/** B4 — AUTOMATION TRACES: what `simp` (or `grind`, or `aesop`) actually used.
 *
 * A reader's question about an automation step is the one the source cannot
 * answer. `▸` marks say which HYPOTHESES a step used; B3's `lemmas` say which
 * constants the author WROTE; neither helps at `simp`, where the author wrote
 * no name and the premises are whatever the search found. Core's own `?` forms
 * report exactly that, so the server re-elaborates the declaration with
 * `simp?`/`simp_all?`/`grind?`/`aesop?` in place and reads the `Try this`
 * suggestions back (`ProofTree.getAutomationTrace`, or `ppharness --traces`
 * offline).
 *
 * This module is the pure half: which nodes may be asked (the head-word list,
 * MIRRORED from `ProofTree.traceableHeads`/`opaqueHeads`/`suggestionHeads` in
 * lean/ProofTreeRecover.lean — the affordance must not need a round trip), and
 * the leaf nodes an open trace adds under its step.
 */
import type { AutomationTrace } from "./paperproof";
import type { TreeNode } from "./types";
import { posKey } from "./proofToTree";
import { headWord } from "./rewrite";

/** Automation with a `?` form in v4.32.2 (measured: `lake env lean` on a
 scratch file — all four exist and all four emit `Try this:`). */
export const TRACEABLE_HEADS = ["simp", "simp_all", "grind", "aesop"];

/** Automation with NO `?` form: the trace says so rather than saying nothing,
 which read as a broken affordance. */
export const OPAQUE_HEADS = [
  "omega",
  "linarith",
  "nlinarith",
  "decide",
  "norm_num",
  "positivity",
  "ring",
  "ring_nf",
  "trivial",
  "tauto",
];

/** Already a suggestion tactic: re-elaborated unchanged, its own message read. */
export const SUGGESTION_HEADS = [
  "exact?",
  "apply?",
  "simp?",
  "simp_all?",
  "grind?",
  "aesop?",
];

const ALL_HEADS = new Set([
  ...TRACEABLE_HEADS,
  ...OPAQUE_HEADS,
  ...SUGGESTION_HEADS,
]);

/** The head word of a tactic label, read the way the server reads it off the
 source: the leading run of identifier characters, taking a trailing `?` with
 it so `exact?` is one word. */
export function tacticHeadWord(label: string): string {
  return headWord(label, true);
}

/** Is this node an automation step a trace can be asked for? Source facts
 only — the head word and a real position — so the affordance is on the node
 the moment it is drawn, before any RPC. */
export function isAutomationNode(n: TreeNode): boolean {
  if (n.type !== "tactic" || !n.position || n.elidedCut || n.synthetic)
    return false;
  return ALL_HEADS.has(tacticHeadWord(n.label));
}

/** The key a trace is filed under: the step's own start, as every sidecar is —
 and so the one `posKey` every other sidecar is filed under. */
export const traceKey = posKey;

export function traceIndex(
  traces: AutomationTrace[] | undefined,
): Map<string, AutomationTrace> {
  const out = new Map<string, AutomationTrace>();
  for (const t of traces ?? []) out.set(traceKey(t.stepStart), t);
  return out;
}

/** The trace subtree, minted onto the DRAWN tree.
 *
 * Drawn and not base, deliberately: elide.ts never sees these nodes, so a
 * trace cannot change what a `−` or a `◌` does (a closing `simp` with its
 * trace open would otherwise stop being a leaf and the goal above would hop
 * where it used to fold), and a step a cut has hidden takes its trace with it
 * for nothing — there is no node to hang it under.
 *
 * Ids are POSITION-DERIVED (`trace:<line>:<char>:<i>`), so they survive a
 * re-parse without `remapIds` having to know about them, and they are stable
 * across the RPC arriving twice.
 *
 * The leaves are ordinary tactic nodes with `traceLeaf` set: no position, so
 * nothing offers to edit, reveal, delete or flag them, and the paint reads the
 * one flag for the dashed comment-ink box.
 */
export function applyTraces(
  nodes: TreeNode[],
  open: ReadonlySet<string>,
  index: Map<string, AutomationTrace>,
): TreeNode[] {
  if (index.size === 0) return nodes;
  const out: TreeNode[] = [];
  for (const n of nodes) {
    const t =
      n.type === "tactic" && n.position && !n.elidedCut
        ? index.get(traceKey(n.position.start))
        : undefined;
    // The STAMP goes on as soon as the answer is in, open or not: the step's
    // `<title>` gains its `via simp?:` line the moment the RPC returns, which
    // is what tells a reader the affordance did something before they open
    // the subtree.
    out.push(t ? { ...n, trace: t } : n);
    if (!t || !open.has(n.id) || !n.position) continue;
    const rows: { label: string; title: string }[] =
      t.kind === "lemmas" && (t.lemmas?.length ?? 0) > 0
        ? t.lemmas!.map((l) => ({
            label: l.name,
            title: [
              l.kind ? `${l.kind} ${l.name}` : l.name,
              l.doc ?? "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          }))
        : [
            {
              label:
                t.kind === "opaque"
                  ? `${t.tactic} keeps no lemma list`
                  : t.kind === "lemmas"
                    ? (t.suggestion ?? `${t.tactic} named nothing`)
                    : `${t.tactic}? reported nothing`,
              title:
                t.kind === "opaque"
                  ? `\`${t.tactic}\` has no \`?\` form in this toolchain — it closes the goal by decision procedure, not by a list of lemmas`
                  : `\`${t.tactic}?\` was re-elaborated and produced no suggestion`,
            },
          ];
    const at = traceKey(n.position.start);
    rows.forEach((r, i) => {
      out.push({
        id: `trace:${at}:${i}`,
        label: r.label,
        type: "tactic",
        parents: [{ id: n.id }],
        traceLeaf: { title: r.title, tactic: t.tactic, kind: t.kind },
      });
    });
  }
  return out;
}

/** The `<title>` line the automation step itself gains once its trace is in:
 the same `uses:` idiom B3 writes, said in the trace's voice. */
export function traceTip(t: AutomationTrace | undefined): string {
  if (!t) return "";
  if (t.kind === "opaque")
    return `via ${t.tactic}: no lemma list — ${t.tactic} has no \`?\` form`;
  if (t.kind === "failed") return `via ${t.tactic}?: nothing reported`;
  const names = (t.lemmas ?? []).map((l) => l.name);
  if (names.length === 0) return `via ${t.tactic}?: ${t.suggestion ?? ""}`;
  return `via ${t.tactic}?: ${names.slice(0, 4).join(" · ")}${
    names.length > 4 ? " …" : ""
  }`;
}
