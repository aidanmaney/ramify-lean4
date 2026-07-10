# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Lean 4 proof rendered as an interactive tree. The renderer has **two data sources** feeding the same React/d3-dag view:

```
# 1. Offline CLI (dev harness):
proofs/*.lean ──ppharness (Lean CLI)──▶ NDJSON ──proofToTree (web)──▶ d3-dag tree

# 2. Live infoview widget (production target):
cursor pos ──ProofTree.getProofTree RPC──▶ Proof ──proofToTree (web)──▶ d3-dag tree
```

- `lean/` — **ppharness**, a thin owned wrapper around Paperproof's `BetterParser_Tree`. Elaborates a `.lean` file to completion and harvests the elaborator's `InfoTree`s into proof steps, emitting one NDJSON line per proof.
- `lean/ProofTreeWidget.lean` — the **infoview user-widget**: `@[server_rpc_method] ProofTree.getProofTree` runs the *same* `BetterParser_Tree` over the live server's `snap.infoTree`, and `@[widget_module] ProofTreeWidget` (`Component PanelWidgetProps`) `include_str`s the bundled renderer. It is the RPC counterpart of ppharness — no CLI, no NDJSON.
- `web/` — React + Vite + d3-dag renderer that draws goals as boxes, tactics as edge-nodes, hypotheses on edges. `ProofTreeView.tsx` is the shared, source-agnostic view; `App.tsx` feeds it a proof from NDJSON, `widget.tsx` feeds it a proof over RPC.
- `gen.sh` — the CLI seam: runs the parser over `proofs/*.lean` and writes `web/public/sample.ndjson`.

## Commands

**Lean** (run from `lean/`):
```bash
cd lean && lake exe cache get && lake build   # one-time: fetch Mathlib oleans, build
lake build ppharness                          # rebuild the CLI
echo 'theorem t : True := by trivial' | lake env lake exe ppharness   # parse stdin
lake env lake exe ppharness FILE.lean         # parse a file (lake env puts Mathlib on LEAN_PATH)
```

**Regenerate web data** (from repo root) — do this after editing anything in `proofs/`:
```bash
./gen.sh                                       # proofs/*.lean → web/public/sample.ndjson
```
Do not hand-edit `web/public/sample.ndjson`; it is generated.

**Web** (run from `web/`):
```bash
npm install
npm run dev          # Vite dev server (standalone app, reads sample.ndjson)
npm run build        # tsc -b && vite build (standalone app → dist-app/)
npm run build:widget # esbuild src/widget.tsx → dist/proofTreeWidget.js (the infoview bundle)
npm run typecheck    # tsc -b only (covers widget.tsx too)
npm run lint         # eslint .
```
There is no test runner configured in either half; "verify" means build + run the dev server and inspect the rendered tree.

The two builds have deliberately **separate output dirs** (`vite.config.ts` sets `outDir: 'dist-app'`): vite empties its outDir on every build, so sharing `dist/` would make `npm run build` silently delete `dist/proofTreeWidget.js` — the Lean build input — and break the next `lake build` / editor `setup-file` with "no such file or directory". Both dirs are gitignored artifacts.

**Infoview widget** — the bundle is a Lean build input via `include_str`, so build it *before* `lake build`:
```bash
cd web && npm run build:widget      # produces web/dist/proofTreeWidget.js (gitignored artifact)
cd ../lean && lake build ProofTreeWidget
```
Then open a file in *this* Lake project with `import ProofTreeWidget` and `show_panel_widgets [ProofTreeWidget]` (see `lean/ProofTreeDemo.lean`, which is core-only so it needs no Mathlib). The panel follows the cursor.

`lean/lakefile.toml` declares `web/dist/proofTreeWidget.js` as a Lake `input_file` and wires it into `ProofTreeWidget`'s library via `needs`, so the two commands above actually compose correctly. Without this, `lake build` is a **silent no-op** when only the JS changed: `include_str` is a bare `IO.FS.readFile` at elaboration time, invisible to Lake's dependency graph, so Lake sees `ProofTreeWidget.lean`'s own source as unchanged and reuses the stale `.olean` — hit this for real once, spent a while confirming via `.olean` mtimes and `strings`-grepping the compiled output. **Use `needs`, not the deprecated `extraDepTargets`** — the latter parses and resolves target names fine (a bogus name does error) but empirically does not propagate a changed file's hash into the rebuild trace; `needs` does (confirmed with a real edit → rebuild → `lake build` cycle, checking the compiled `.olean`'s bytes, not just exit status).

## Critical constraints

- **Toolchain is pinned to Lean v4.27.0 on purpose** (`lean/lean-toolchain`, `lean/lakefile.toml`). ppharness drives the frontend with `IO.processCommands` then reads `infoState.trees`. On v4.29+ tactic subtrees elaborate **asynchronously** and aren't attached when read, so `BetterParser_Tree` walks a tree with zero `TacticInfo` nodes and returns empty proofs (`{steps:[], allGoals:[]}`). Keep ppharness and Mathlib on the same v4.27.0. Do not bump without re-validating the harvest path.
- **Mathlib is a build dep only so its oleans land on `LEAN_PATH`** (via `lake env`); that's what lets real `import Mathlib` proofs elaborate at parse time. The Paperproof library itself is core-only.
- `Main.lean` calls `enableInitializersExecution` before the first import and the CLI is built with `supportInterpreter = true`, because importing Mathlib runs its `@[init]` declarations through the interpreter. Both are required; removing either breaks `import Mathlib` sources at runtime.

## Architecture notes that span files

**The wire format is a cross-language contract.** Paperproof's `ProofStep` / `GoalInfo` / `Hypothesis` structs (`lean/.lake/packages/Paperproof/lean/Services/BetterParser.lean`) are mirrored field-for-field in `web/src/paperproof.ts`. ppharness (`lean/Ppharness.lean`) only hand-serializes `Result` (which lacks a derived `ToJson`); everything else rides upstream's derived instances. Changing a field on either side requires changing the other. `BetterParser.annotated.lean` at the repo root is a study copy of the upstream parser annotated for this project (not part of the build).

**How a proof becomes a tree.** The renderer never consumes `paperproof.ts` types directly. `web/src/proofToTree.ts` adapts a `Proof` into `TreeNode[]`: each tactic `step` becomes `goalBefore ──(tactic node)──▶ goalsAfter ++ spawnedGoals`. The tree root is the goal consumed by some tactic but produced by none (`rootIds`). Hypotheses shown on an edge are the **delta** a child goal gained over its parent (`newHyps`), not the full context. Nodes are emitted in DFS preorder so layout ordering reads top-down/left-to-right.

**The layout engine is the heart of the web side** (`web/src/layout.ts`). `createLayoutEngine(data)` builds an engine bound to one tree; folding and relayout are pure functions of `data`. Key design choices:
- **Stable sibling order under folding**: a custom `stableDecross` sorts each Sugiyama layer by a fixed creation-order key (`ORD`) instead of minimizing crossings, so collapsing one subtree never reshuffles unrelated siblings.
- **Box sizing uses canvas `measureText` in the exact render font**, not char counts — Lean labels are full of wide unicode (ℕ ∀ ∃). Text is pixel-wrapped to a width budget so it's always bounded by its box. The render must match: node/hyp `<text>` set `letterSpacing: 0` (the page CSS sets a nonzero default that canvas wouldn't otherwise account for), and geometry constants (`LINE_H`, `HYP_GAP`, `NODE_PAD`, …) are exported and shared between layout and render.
- `computeLayout(collapsed, only?)` hides a node iff all its parents are collapsed/hidden (fixpoint sweep). The optional `only` set restricts layout to exactly those ids — used by the "sequence/linearize" feature (`pathBetween` walks single parents to get the ancestor→descendant path; with no branches, Sugiyama renders one column).

**Data source is swappable by design — and both sources now exist.** The shared view is `ProofTreeView.tsx` (layout, folding, zoom/scroll, SVG render); it takes one `Proof` and nothing else. Two thin shells feed it: `App.tsx` `fetch`es `SAMPLE_URL` (`sample.ndjson`); `widget.tsx` calls `ProofTree.getProofTree` over RPC inside the infoview. `proofToTree` / `layout.ts` / `ProofTreeView.tsx` are source-agnostic — do not import NDJSON or infoview APIs there.

**The node↔source link (widget only).** `ProofStep.position` (a tactic's LSP range, already on the wire) is the sole source of truth for every node's position — no vendored parser change needed. `proofToTree.ts` sets it three ways: a **tactic** node gets its own step's `position`; a **goal** node gets the `position` of the step that *produced* it (`producingPosition`, keyed by `stepGoalsAfter`) — root goals get none, since they're the theorem statement, not a tactic's output; a **hypothesis** shown on an edge (the `newHyps` delta) is introduced by that same producing step, so `ProofTreeView` reads its position straight off the edge's target node (`link.target.data.position`) rather than threading a second copy through `ParentEdge`.

`ProofTreeView` uses these two ways when the widget supplies the hooks: **tree→source** — clicking a positioned tactic node (whole box) or a goal node's small `»` corner icon (goals stay fold-on-click, since that's their primary interaction) or a hypothesis label calls `onReveal`, which `widget.tsx` maps to the infoview `EditorContext.revealLocation`; **source→tree** — `highlightPos` (the editor cursor from `PanelWidgetProps.pos`) accent-outlines whichever node/hyp-label's range contains it — this falls out of the shared `position` field with no extra logic. Both are inert in the standalone app (no `onReveal`/`highlightPos`). What's *not* recoverable this way is a hypothesis's exact identifier token (only the introducing tactic's whole range) and non-root goals having any span of their own (they're synthesized, not written) — closing that gap to token precision needs an additive `snap.infoTree` walk in our own `ProofTreeWidget.lean` (no vendored edit either), not a parser fork.

Every node and hyp label also carries a native SVG `<title>` (hover tooltip): the full un-wrapped label text, plus a `· click … to reveal in source` hint when a reveal action applies. This doubles as the only visible affordance that a hyp label or goal icon is clickable — there's otherwise just a CSS cursor change — and is unconditional (renders in the standalone app too; it just never gets the hint suffix there). When the interactive tagged label (next paragraph) takes over a box, the native `<title>` retreats to the box `<rect>` so it doesn't stack on the type tooltips.

**Interactive subterm tooltips (widget only).** Goal-node labels and hyp-label types get the infoview's own hover behavior (type popup per subterm) via core `Widget.goalToInteractive` → `CodeWithInfos` on the Lean side and `InteractiveCode` from `@leanprover/infoview` on the JS side — no ProofWidgets machinery, no vendored parser change. `collectTaggedGoals` in `ProofTreeWidget.lean` is an additive `snap.infoTree` walk that re-prints every tactic's goals with tags kept (the vendored `printGoalInfo` computes the same tagged print and drops the tags via `.fmt.pretty`), keyed by mvarId string = `GoalInfo.id`; it ships as `ProofTreeData.taggedGoals`, which forces the payload to derive `Server.RpcEncodable` (tags hold live `WithRpcRef`s — session-bound, hence never in the CLI's NDJSON). JS-side the seam is two optional `ProofTreeView` hooks (`renderTaggedGoal`/`renderTaggedHyps`, returning ReactNodes per line) implemented in `web/src/taggedRender.tsx` — the only renderer-adjacent module allowed to import infoview APIs; the view just swaps its SVG `<text>` for a `<foreignObject>` in the identical line geometry. Three invariants make this safe: **text equality** — a tagged line is used only if its stripped text exactly equals the plain string the layout measured (`taggedRender` checks; any mismatch falls back to plain SVG text per node/line); **no second wrapping** — `web/src/taggedText.ts` slices the `TaggedText` tree at the layout's own line-break offsets (duplicating tags that span a break), so the HTML lines are non-wrapping (`white-space: pre`) and can't disagree with the measured box; and **font normalization** — `InteractiveCode` wraps its output in `<span class="font-code">`, which the infoview styles with the *editor's* font and foreground color, so uncorrected it renders bigger than the measured box (and wrong-colored on our light boxes in dark themes). Every tagged line is wrapped in `.ptw-tagged`, and `taggedRender` injects a `.ptw-tagged .font-code { font: inherit; … }` rule so the rich text inherits the very font the canvas measurer used. The hover popups keep their native editor styling because the infoview portals them to `document.body`, outside any `.ptw-tagged` ancestor. `widget.tsx` deliberately excludes `taggedGoals` from the stable-proof signature: the RPC refs are freshly allocated every call, and keying on them would reset layout/fold state on every cursor move (old refs stay valid for the session's lifetime).

**The widget's RPC path mirrors the CLI's harvest.** `lean/ProofTreeWidget.lean`'s `getProofTree` is `Paperproof.getSnapshotData` (`.tree` mode) minus the single-tactic branch: `withWaitFindSnapAtPos` → `BetterParser_Tree fileMap snap.infoTree` → `{steps, allGoals, taggedGoals}`. No `uri` field is needed: the panel widget already gets it in `props.pos`. The **same v4.27.0 async-tactic caveat applies** — the live server must have fully elaborated the proof for `snap.infoTree` to contain `TacticInfo`; an empty parse returns an empty proof (`steps := []`), which the widget renders as "no proof here" — the not-in-a-proof state is data, not an error-message string for the client to pattern-match.

`web/src/makeTree.ts` is a seeded synthetic-tree generator for layout experiments, independent of real proof data.
