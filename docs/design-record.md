# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Lean 4 proof rendered as an interactive tree. The renderer has **two data sources** feeding the same React/d3-dag view:

```
# 1. Live infoview widget (production target):
cursor pos ──ProofTree.getProofTree RPC──▶ Proof ──proofToTree (web)──▶ d3-dag tree

# 2. Offline CLI (dev harness — ships nowhere; `dist/` declares no lean_exe):
proofs/*.lean ──ppharness (Lean CLI)──▶ NDJSON ──proofToTree (web)──▶ d3-dag tree
```

- `lean/` — **ppharness**, a thin owned wrapper around Paperproof's `BetterParser_Tree`. Elaborates a `.lean` file to completion and harvests the elaborator's `InfoTree`s into proof steps, one NDJSON line per proof.
- `lean/Ramify.lean` — the **infoview user-widget**: `@[server_rpc_method] ProofTree.getProofTree` runs the same parser over the live server's `snap.infoTree`; `@[widget_module] Ramify` `include_str`s the bundled renderer. The RPC counterpart of ppharness — no CLI, no NDJSON.
- `web/` — React + Vite + d3-dag renderer. `ProofTreeView.tsx` is the shared, source-agnostic view; `App.tsx` feeds it a proof from NDJSON, `widget.tsx` feeds it a proof over RPC.
- `gen.sh` — the CLI seam: runs the parser over `proofs/*.lean` and writes `web/public/sample.ndjson`.
- `ext/ramify/` — a small VS Code **companion extension** for widget gestures the infoview API can't express (see "Popout editing"); no build step. **Installed from the packaged `.vsix`, NOT a symlink** (`code --install-extension dist/ramify-0.0.15.vsix`): modern VS Code loads only what `~/.vscode/extensions/extensions.json` registers, so a symlink dropped into the extensions dir is silently ignored — measured 2026-08-21 when the renamed extension refused to load that way. The install is an unpacked SNAPSHOT, so an `extension.js` edit reaches the editor only via re-running the install command (then a window reload; `package.json` changes need a full restart).

## Installing it elsewhere

`dist/` is the INSTALLABLE Lake package; `INSTALL.md` is its manual; `./package.sh` builds both artifacts and checks the result. The split exists because `lean/lakefile.toml` requires **Mathlib** only so the offline CLI can elaborate `import Mathlib` fixtures — the widget needs none of it. `dist/lakefile.toml` requires only Paperproof (pinned to the exact commit the dev manifest resolved) and ProofWidgets v0.0.105 (what Mathlib v4.32.2 itself pins, so a Mathlib project resolves to one copy). Sources are SHARED, never copied: every `lean_lib` there sets `srcDir = "../lean"`, so the two packages cannot drift. Cold install ≈ 320s, of which ~306s is ProofWidgets building its own widget JS.

**The renderer bundle is TRACKED in git** (`web/dist/proofTreeWidget.js`, un-ignored by name in both `.gitignore`s) — forced, not chosen: `Ramify.lean` reads it with `include_str`, a fresh clone runs no npm step, and Lake has no hook to run one for a dependency, so without the artifact in the tree an install cannot build. It is the one generated file this repository tracks. `dist/lake-manifest.json` is tracked too (same transitive set on install); the `.vsix` is built into `ext/` (ignored) and COPIED to `dist/` (tracked).

**`dist/Demo.lean` is in `dist/`, not with the other demos, on purpose.** vscode-lean4 resolves a file's Lake workspace by walking UP from the file, so anything under `lean/` is served by the DEVELOPMENT package and drags Mathlib in even though those files are core-only. Note the widget is `Ramify` at TOP level — the `namespace ProofTree` closes before the `@[widget_module]` def — so `show_panel_widgets [ProofTree.Ramify]` is an unknown identifier.

## Commands

**Lean** (run from `lean/`):
```bash
cd lean && lake exe cache get && lake build   # fetch Mathlib oleans, build — RE-RUN cache get after any `lake clean` (it deletes the oleans; without them an `import Mathlib` file makes the editor compile Mathlib from source for hours)
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
There is no test runner in either half; "verify" means build + run the dev server and inspect the rendered tree.

The two builds have deliberately **separate output dirs** (`vite.config.ts` sets `outDir: 'dist-app'`): vite empties its outDir on every build, so sharing `dist/` would make `npm run build` silently delete `dist/proofTreeWidget.js` — the Lean build input.

**Infoview widget** — the bundle is a Lean build input via `include_str`, so build it *before* `lake build`:
```bash
cd web && npm run build:widget
cd ../lean && lake build Ramify
```
Then open a file in *this* Lake project with `import Ramify` and `show_panel_widgets [Ramify]`. The panel follows the cursor.

`lean/lakefile.toml` declares `web/dist/proofTreeWidget.js` as a Lake `input_file` wired into the library via `needs`. Without this, `lake build` is a **silent no-op** when only the JS changed — `include_str` is a bare `IO.FS.readFile` at elaboration time, invisible to Lake's dependency graph, so Lake reuses the stale `.olean`. **Use `needs`, not the deprecated `extraDepTargets`** — the latter resolves target names but empirically does not propagate a changed file's hash into the rebuild trace (confirmed by checking the compiled `.olean`'s bytes, not exit status).

**Demo and fixture files** (all core-only — `import Ramify` alone; NONE is a Lake target, so `lake build` stays green whatever state they are in, and the "broken" ones are deliberately left that way). Re-measure before trusting a count here — these are working files and they drift (this list was last checked 2026-08-07, when two entries were already wrong):
- `lean/ProofTreeDemo.lean` — no longer the "minimal demo" its own header still calls itself: it has grown into a ~580-line intrinsically-typed λ-calculus development (PLFA-style de Bruijn terms, renaming/substitution, β-reduction), kept as a REALISTIC rendering subject — deep term-mode structure, heavy notation, wide unicode, the shapes the corpus of small fixtures does not exercise. Currently elaborates with **14 errors** (a WIP proof state, not a curated fixture), which is also why it doubles as an unplanned diagnostics/recovery exercise. Use `ProofTreeTour.lean` for a working guided demo.
- `lean/ProofTreeTour.lean` — guided walkthrough: six theorems, one feature cluster each (reading, layout gestures, editing, calc, frontier chips, error ribbon), docstrings say what to try; its last two sections are deliberately unfinished. Claims verified over the live server path (the LSP-probe recipe, see Diagnostics) (§4's chain was rewritten in `384e1d5` to demonstrate what its docstring promises — first link on the `calc` line so the head clears Rule D's width gate, three ADJACENT `by` links so a link LHS is a sibling's RHS; measured, the head collapses and 5 link LHSs elide).
- `lean/ProofTreeExercises.lean` — the tour's workbook: five goals, each seeded with one honest opening move so the remaining goals sit at the frontier with chips; hints in docstrings, solutions in a comment block at the bottom. Invariants (verified): the file elaborates with exactly five `unsolved goals` and nothing else; the solutions are extracted from the comment block VERBATIM and elaborated. Tuned so `omega` can't one-shot any; ex 5 seeds `with | succ k ih =>` deliberately — a bare `induction n` leaves case variables INACCESSIBLE (`n✝`) and a chips-only flow can never name them.
- `lean/ProofTreeGoalsDemo.lean` — the harder sibling (NNG difficulty): six statements only, each a lone `sorry`. **This is the file the notes below have always described; it was `ProofTreeGoals.lean` until the two were split.** `by sorry` rather than `by skip` is what makes goals-only files workable — `getGoalsChange` cancels a no-op's goals, so `by skip` harvests ZERO steps and renders "no proof here", while `by sorry` draws root + editable stub. Solvability verified via an NNG-vocabulary solutions twin (`rfl`/`rw`/`induction`/`intro`/`exact`/`apply`/`cases` only); the file elaborates with exactly six `sorry` warnings and nothing else (re-measured on v4.32.2).
- `lean/ProofTreeGoals.lean` — now a small SOLVED companion to the above, not an exercise sheet: `cong` (tactic mode, `intro` + `rw`) and a term-mode recursive `match` (`goal_zero_add`), with the five remaining NNG statements commented out. Elaborates clean — zero diagnostics — so it is the quickest live check that the TERM-mode recovery path draws a tree at all (the `match` proof harvests no tactic steps).
- `lean/ProofTreeDiagnostics.lean` — eight theorems each broken a different way, one per diagnostics surface (claims checked by running the real filter/mapping over its harvest).
- `lean/ProofTreeErrors.lean` (13 broken theorems) / `lean/ProofTreeTerms.lean` (compiles) — recovery-parser fixtures.
- `lean/ProofTreeScratch.lean` — scratch fixtures (calc typing states, `three_column_demo`, brief-mode cases). Not a Lake target, so it may sit in a deliberately broken state.

## Critical constraints

- **Toolchain is Lean v4.32.2** (`lean/lean-toolchain`, `lean/lakefile.toml`; Mathlib tag `v4.32.2`, Paperproof pinned by exact commit — upstream `main` moved to the module system in 2026-07, so the rev must never float). The old v4.27 pin cited an async blocker ("on v4.29+ tactic subtrees elaborate asynchronously and aren't attached, so `BetterParser_Tree` returns empty proofs") — **falsified by measurement on v4.32.2**: `Elab.async` defaults to FALSE for embedded drivers (only the `lean` CLI and the server opt in), `IO.processCommands`' info-tree collection is unchanged v4.27→v4.33, and both wires were probed — CLI harvest byte-identical to v4.27 step-for-step, live-server (async ON) path complete via `withWaitFindSnapAtPos`. **The real v4.32 trap is the initializer flag**: `withImporting`'s `finally` now clears `runInitializersRef` after EVERY `importModules`, so a batch run that called `enableInitializersExecution` once had every file after the first come back with an EMPTY env (no Init, every command a parse error, zero steps, nothing on stderr) — hence Main.lean re-arms it per file. On a future bump re-run: the corpus diff (`gen.sh` both sides — expect only HashSet `allGoals` order and case-tag renames; v4.32 dropped the `.h` component from `Or.inl`/`by_cases` tags), the calc one-link parse matrix, and the LSP live probe.
- **Mathlib is a build dep only so its oleans land on `LEAN_PATH`** (via `lake env`), letting `import Mathlib` proofs elaborate at parse time. The Paperproof library itself is core-only.
- `Main.lean` calls `enableInitializersExecution` before the first import and the CLI is built with `supportInterpreter = true` — both required for `import Mathlib` sources at runtime.

## Standing rules

- **Never fork the vendored Paperproof parser.** Everything this project needs is done by post-processing its output (label fix-ups, sidecars, additive walks over `snap.infoTree`). `ProofTreeRecover.lean` is the one file allowed to import Paperproof's types besides the entry points; `ProofTreeComments.lean` stays `import Lean` only.
- **View identity and view state must key on SOURCE facts — a declaration name, a source position — never on anything elaboration mints.** mvarIds are elaboration-order artifacts: any edit that changes how many metavariables are allocated before a node renumbers it. This mistake recurred FOUR times (proofKey, cursor tracking, relayout anchoring, the staged calc fill) before becoming a rule. mvarIds are fine for matching nodes WITHIN one payload; never across payloads or for "is this the same thing I was looking at".
- **Decompose syntax by KIND, never by argument index** (index is the current shape, not a contract — bit twice: `rwSeq`'s location clause, `have`'s `letDecl`).
- **`Lsp.Range` must never cross the wire.** Its second field is `end`, so derived `ToJson` emits `{start, end}` while the client reads `{start, stop}`. Use `DeclRange` or an existing start/stop pair. Related: `incoming` in widget.tsx rebuilds the `Proof` field by field, so a field left out is silently absent, not a type error — both halves must be right. **Some fields are left out ON PURPOSE** (`deleteSlots`, to keep one source of truth), which makes `Proof` a different shape on the two wires: any NEW reader of an optional `Proof` field must therefore take it as an argument and treat the field as a fallback, or it silently works offline and does nothing in the widget — how the `rw` comment-attribution fix passed every offline check and changed nothing in the editor.
- **Prefer leaving the author's text unfinished over completing it with something they did not choose** (established three times over in the calc work).
- **A hidden webview fires no animation frames and no native focus/scroll transitions.** Use `setTimeout`, not rAF, for caret/scroll work; back rAF loops with a timeout that snaps to the target; in the preview harness drive gestures with real dispatched `MouseEvent`s (with `relatedTarget` — React synthesises mouseenter from mouseover) at `document.elementFromPoint(...)`, take a `computer{screenshot}` first (the pane has no height until then), and fire a synthetic `scroll` event after programmatic `scrollTop` writes.
- Measurer and renderer are paired everywhere (`sizeOf`/`HypBlock`, `linkSpans`/link routing, wrap geometry): **change one, change both.**

## Architecture notes

### Wire format

Paperproof's `ProofStep` / `GoalInfo` / `Hypothesis` structs (`lean/.lake/packages/Paperproof/lean/Services/BetterParser.lean`) are mirrored field-for-field in `web/src/paperproof.ts`. ppharness (`lean/Ppharness.lean`) hand-serializes only `Result`; everything else rides upstream's derived instances. Changing a field on either side requires changing the other. `ProofStep` cannot grow fields (it's upstream's type) — new per-step data rides SIDECARS keyed by `position.start` (`recovered`, `tacticEdits`, …). Editing-seam data (`tacticSlots`, `deleteSlots`, calc structures) ships on BOTH wires when it is plain data, so pure client modules can be probed offline against the CLI corpus; `WithRpcRef`-carrying data (tagged goals, token infos) is widget-only by nature.

### How a proof becomes a tree (`web/src/proofToTree.ts`)

Each tactic step becomes `goalBefore ──(tactic node)──▶ goalsAfter ++ spawnedGoals`; the root is the goal consumed but never produced (`rootIds`). Nodes are emitted in DFS preorder (layout order and elide.ts's slot arithmetic rely on it). Goal labels carry a `⊢ ` prefix (`TURNSTILE`) — part of the measured label; the tagged renderer strips it for its text-equality match then re-attaches it, so keep the two in sync.

**A goal's local context rides the goal node** (`TreeNode.hyps`), drawn inside its box above the `⊢ ` line. Lines are flagged `used` from the CONSUMING tactic's `tacticDependsOn` (▸ gutter marker + full ink; unused lines recede). That's honest even for `omega`/`linarith`/`simp_all` because Paperproof computes it from the elaborated PROOF TERM, so implicit uses count; known blind spots (accepted): `decide`-style proofs (term goes through `of_decide_eq_true`) and delayed-assigned goals.

**Four context breadths**, chosen from the bar's Context list (`HYP_MODES`; the item reads `Context: used` / `intro` / `diff` / `all` in words, and ⌥-click on it advances): **`used`** (default) — what the rest of the proof BELOW the goal depends on (union of `tacticDependsOn` over the goal's subtree, `subtreeUsed`); **`new`** (`intro` — Lean's own word for the move that makes them; it was `binders`, renamed because an item RESERVES the width of its widest value, so the longest label in the set is charged to the row at every setting, and `binders` was the widest in the whole bar — `intro` gives the Context item **15px** back) — only what the PRODUCING tactic introduced as a binding (can legitimately be empty: root goals, non-binding tactics — that is data); **`delta`** (`diff`) — what the goal gained over its producer's input, plus older hyps the consuming tactic uses; **`full`** (`all`) — everything, additive down the tree. Containments: immediate-used ⊆ `used` ⊆ `full`; `delta` ⊇ `new`; `used ⊄ delta`. **A goal with NO consuming tactic falls back to `delta`'s rule under `used`** — "what the rest of the proof uses" is undefined at the live frontier, and an empty box there reads as broken. **fvarIds are NOT stable down the tree** (`rw … at h`/`simp at h` mint a new id), so the subtree walk carries `(fvarId, username)` pairs and `contextFor` matches id-first with a username fallback (known false positive: a descendant binding shadowing an ancestor name — not observed in the corpus). The ▸ gutter flag stays IMMEDIATE-consumer in every mode; the marker and its reserved width are dropped when the flags don't separate anything (all- or none-used) — a rule enforced in two places that must agree, `sizeOf`'s reservation and `HypBlock`'s `anyUsed`. **Context lines are ordered DATA first, then PROPOSITIONS** (classification is `Hypothesis.isProof`; partition runs LAST in `contextFor` so every mode/flag composes); a mixed block draws a hairline divider (`HypLine.sep`, at most one, never when either group is empty; `HYP_SEP_H` reserved in `sizeOf`, applied in `HypBlock`, one shared `sepOff` shift; in reflow `sep` rides only a wrapped hyp's first fragment). **LEAN'S OWN BINDER ORDER IS THE DEFAULT, and the Context list's `Split data & props` row is the OPT-IN that groups** (`hypGroup`, a `proofToTree` option, default FALSE on both sides — the rule that module and bar defaults must not drift): unchecked draws the lines in the order Lean wrote them with no divider, checked partitions them data-then-propositions with the hairline. It was the other way round and was flipped by user direction ("grouping data and props should be the default. Setting split then adds the squares" — i.e. the DEPARTURE is what a mark should say): a dependent context is written in an order where a hypothesis may mention an earlier one, and grouping floats a mention above the binder it names (`obtain ⟨k, hk⟩` reads `k : ℕ` then `hk : n = m * k` in source order, but grouped puts every witness above every proposition), so the author's own order is the honest resting state. A SECOND AXIS rather than a fifth stop in the cycle: the breadths choose WHICH lines, grouping only their order, and the two compose — which is why it is a CHECKBOX row under the four breadth rows and not one of them, and why it rides the Context item's own extras SLOT (lit when the split is SET) while the item takes no accent and the label keeps naming the breadth alone. Mode switch rebuilds the engine with the same node ids, so fold/zoom/scope state survives (reset keys on a new *proof*). `proofToTree`'s own default is `used` too, so module and rail cannot drift.

**Node positions**: a tactic node gets its step's `position`; a goal node gets its PRODUCER's (`producingPosition`); root goals get none. Positions include trailing trivia (upstream quirk) — this fact drives half the machinery below.

### Layout engine (`web/src/layout.ts`)

`createLayoutEngine(data)` binds one tree; layout is a pure function of `data`. `computeLayout(only?, focus?, compact?, sideBySide?, hide?, aside?)` returns `PlacedNode`/`PlacedLink` from any positioner, so the renderer is layout-agnostic. **There is no fold parameter**: every hiding of nodes is an `ElideCut` applied BEFORE the engine (see Eliding nodes), and the hidden sweep here serves only the gallery's and ⤓'s `hide` seeds and the focus/path scoping. A node's band is comment strip + box, box pinned at the bottom; edges leave a box's bottom and land above the target's band.

**Four layout modes** (the bar's Layout list, `LAYOUT_MODES`; the item names the current one and accents away from home): **☰ stacked** (default) — hand-rolled DFS with a global y-cursor and per-branch x-indent (Sugiyama forces same-depth nodes into one band, hence hand-rolled); every node gets its own vertical slot, branches indent right by `TRUNK_INDENT` and stay local to their tactic, last child resumes the trunk. A SPAWNED branch (a nested by-block) indents a little further — `spawnExtra`, the block's source column past its parent tactic's in character cells × `CHAR_W`, capped at `SPAWN_INDENT_MAX` — read off a subtree-min COLUMN map (`srcCol`, the `SRC` recursion's sibling: the spawned goal itself carries its PRODUCER's position, so the real column lives on the grandchild tactic); stacked only (`!aside && !sideBySide` — the aside slide overwrites branch x, side-by-side packs on contours, wide never reaches this code). **⊦ spine** — two side-by-side tracks: goals stack tight down the left, each tactic in its own right-hand track beside the seam between the goal it consumes and the goals it produces; it drops only `ASIDE_DROP` below its goal, children resume at `stubY + ASIDE_CLEAR` (stubY = the tactic's box middle), `bottom` floors at the box bottom so a leaf tactic can't be overlapped. The tactic's x is provisional until its children are placed, then slid right past everything its box crosses (per-tactic zigzag — a wide goal doesn't push every tactic out). **An aside tactic's comment strip FLOATS**: drawn ABOVE the box, outside the band, rising into the open space beside the consumed goal — so an annotated tactic stops costing the tree height (the strip used to count twice, through `stubY → bottom` and `boxBottom → trackFloor`). The decision is STAMPED by `place()` on `LayoutNode.commentFloats` and only ever read downstream (`nodeSpan`, `linkSpans`, the renderer's `topH`/strip-y/link mirror) — one writer, so measurer and renderer cannot disagree. Three guards keep the escaped ink collision-free, each found by the overlap sweep or reasoning from it: `nodeSpan` extends the node's span up over the strip; the x-slide's crossing test uses `inkTop` (strip top, not band top) and clears the parent goal's `effOf` (its own strip may hang past its box); `trackFloor` floors the STRIP's top, not just the box (the slide never sees EARLIER nodes, and the previous track occupant's box shares that range). **Under a side-by-side SPLIT the stamp is false** — that path returns before the aside slide, leaving the node at trunk x, where a floated strip rose straight into its goal's box (the sweep's only hits).

**`trackFloor` must be PUBLISHED BEFORE the child recursion, and combined with `max`** — it was written after, which made it a floor nobody who needed it ever read: every later tactic on a trunk is a DESCENDANT, placed inside that very recursion, so down a linear spine the floor stayed `-Infinity` and the y-exclusivity the whole aside geometry assumes silently did not hold (an ancestor finishing then OVERWROTE a lower descendant's claim with its own, higher one). Harmless-looking until a floated strip: its ink starts `commentBlockH` above a `y0` sitting only `ASIDE_DROP + ASIDE_CLEAR + half a goal band` under the previous tactic, so a three-line comment drew straight through the box above it — the reported "comments and nodes overlap in the two-track view". `boxBottom` is pure y arithmetic and final before the loop (the slide only moves x), so publishing early is exact, not an estimate. Related and found with it: the aligned-track pass must be `pn.x = max(pn.x, trackX + w/2)`, never a plain assignment — a tactic's own slide may have cleared a nested aside tactic that the goals-only `trackX` cannot see, and overwriting pulled it back LEFT onto exactly what it had cleared. The directive that settles the trade-off: **lengthening the tree beats overlap.** Widening the slide's crossing scan past `nodes.slice(mark)` was considered and NOT done — with the floor fixed the sweep is clean without it, and it risks a runaway staircase.

Verified (re-created, since no sweep was ever committed and the previous one compared the wrong rects): pairwise intersection of INK rects — box, comment strip, case badge, each with its own x-range, `commentFloats` respected, and the strip's x taken per mode (compact hangs it off the box's left edge, wide CENTERS it — mirroring that wrong was what made the first run report 7 phantom wide offenders) — over the corpus plus the reported scratch proof, in stacked/spine/spine+¶/tracks/side-by-side/wide × combine on and off. Before: 4 offenders, all tracks, all box-over-strip. After: **0 in all twelve**, with stacked, side-by-side and wide placements byte-identical. Confirmed independently against the RENDERED DOM (`getBoundingClientRect` over each node's box and italic strip): 0 overlaps across four proofs in tracks. Outgoing links carry `PlacedLink.lane` (the consumed goal's trunk lane) as data — deriving the lane geometrically fails both for the track and for indented children. A SPLIT keeps `TRUNK_GAP_BRANCH`; in sideBySide a splitting tactic falls back to trunk placement. **|| tracks** — the spine with the zigzag removed: one pass slides every aside tactic to a single shared column; `trackFloor` keeps the track y-exclusive (threaded through `place`, saved/restored per side-by-side column). A single column needs no page-wide goals, so the VIEW forces reflow's budget when the user hasn't set one; **the ¶ control reports the EFFECTIVE state** (`forcedReflow`, derived once, read by both engine memo and rail): while forcing, ¶ draws pressed, the slider thumb sits on the forced column with the OFF notch dropped, and the readout dims. The global align pass is skipped under sideBySide (breaks contour packing; degrades to spine). **⑃ wide** — the original Sugiyama tree, normalized into the same placed shape; a custom `stableDecross` sorts layers by creation-order `ORD` (from `srcRank`) so folding never reshuffles siblings.

**Source order is COMPUTED, not taken from the wire** (upstream puts the main continuation first, which is backwards for `by_cases`): `srcRank` is the earliest source position in a node's whole SUBTREE (a goal alone carries its producer's position, so subtree-min is what makes sorting meaningful). **An ELIDE MARKER stands in for the positions it swallowed** (`ownPositions`, shared by `SRC` and `COL`): a marker has no `position` of its own — deliberately, so layoutKey's tactic↔marker pair can never form — so the subtree-min of a collapsed branch fell to `Infinity` and the branch CHANGED PLACES with its siblings. Reported on a `.none` over the first of two branches, which went to the bottom of the tree; the sweep then showed it was never leaf-specific — **145 of 784 tactic cuts reordered surviving nodes, across all four layout modes**, i.e. every cut this repository has ever drawn. `elidedCut.parts` already carries each member's position (it is the marker's source-range record for the cursor accent), so the fix is to rank on them; **0 of 784 after**, with the same sweep as its own negative control. Combine markers rank this way too — its own metric is SIBLING order, since collapsing a chain legitimately shortens the wide layout's depth (472 parents, 0 reordered). An uncut tree cannot be affected: only `applyElisions` mints a positionless tactic node. **Overridden where `goalsAfter` are not peers**: a conditional rewrite leaves the rewritten goal AND a side condition, and "last in source resumes the trunk" would hand the trunk to the obligation. `TreeNode.side` marks generated obligations (label-family test `MAIN_FIRST_RE` — the wire gives no distinguishing tag, only order); the list is only what was measured to branch this way (`rw`/`rewrite`/`erw`; `simp only`/`norm_num`/`field_simp` probed and don't; `apply` deliberately excluded — its goals are genuine peers; `control_apply` in `proofs/side_goals.lean` pins that). Layout partitions on `side`: obligations first in stacked, main first in columns.

**Box sizing uses canvas `measureText` in the exact render font** (Lean labels are full of wide unicode). Text is pixel-wrapped to a ~100-column budget; breaks prefer semantic seams (two tiers via `seamRank`: clause boundaries beat relations; greedy word break as last resort). Width-wrapped continuations carry `WrappedLine.cont`/`indent` and hang-indent in both measurer and render. Render must match: `letterSpacing: 0` on text (page CSS sets a nonzero default canvas can't see); geometry constants are exported and shared. The code font FAMILY follows the editor: `getCodeFontFamily()` resolves `--vscode-editor-font-family`, falls back to `monospace`; VS Code rewrites the CSS variable in place on font change (no reload), so `ProofTreeView` watches the root's `style` attribute with a MutationObserver and calls `refreshCodeFontFamily()` (clears the width cache); the engine memo is keyed on the family. **Context lines are deliberately NOT pixel-wrapped** (the box grows) — a mid-line break would destroy the exact `name : type` string the tagged renderer matches on; only the label half caps at `MAX_W`. (Reflow is the exception; see below.)

`computeLayout` hides a node iff every parent is HIDDEN or has had its edge to that node CUT BY A FOLD (fixpoint sweep; what a collapsed node cuts is `foldHideEdges`, next paragraph — for a collapsed tactic it is every edge it has, which is the old "all parents are collapsed/hidden" rule verbatim). `only` restricts to exactly those ids and NARROWS the sweep rather than suspending it (the `⊹` path scope, its one caller — sequence view, the previous one, skipped the sweep outright and so made folding inert); `focus` (◎ hover-bar button or ⌥-click on a goal) scopes to one subtree; `hide` seeds the sweep (gallery, to-cursor).

**FOLD IS A CUT, AND A GOAL'S `−` IS ONE GESTURE WITH TWO SHAPES** (`goalCut`, elide.ts — ONE coding, read by the corner glyph, the click, `nodeHints` and the hover fade). The `collapsed` fold set is GONE: it was a second hiding mechanism (layout-time edge cuts) beside the elide cuts (a pre-engine tree transform), and after the trunk rule below was fixed the two hid the SAME set except for one box — the consuming tactic. So a fold now IS an `ElideCut`, minted by the goal's `−` and dispatched by LAYOUT and by TRUNK-NESS: in ⑃ wide every goal with children FOLDS (`{kind: "fold", id: goal}` — everything strictly below it; the goal stays drawn and wears `+`; there is no trunk in a layered tree, so a subtree is the honest unit there); in the stacked/spine/tracks layouts a TRUNK goal — its producer's CONTINUATION under `continuationOf`, roots included — SKIPS the step below it (`{kind: "step", id: consumer}`, the very cut ◌ on that tactic mints, deduped by `cutId` in `addCut` so the two gestures cannot stack), while every OTHER goal — a spawned root, a generated side condition, a case under a split — FOLDS. A goal whose sole child is not a plain tactic (a break already standing there, a merged run, several consumers) offers nothing: the break below is its own restore control. **The trunk rule's history is the reason the goal skips rather than folds.** `−` on a trunk goal used to hide its whole subtree, which ON THE TRUNK is the rest of the proof; the first repair ("hide only what the consumer opened beside the continuation") then decided trunk-ness by asking whether the goal was its producer's SOLE CHILD — false for the goal after any `have … := by`, whose spawned side proof is a SIBLING, so exactly the most common trunk goal fell through to the old rule (measured on `sum_range_odd`: 63 of 80 hidden from the goal after `have key`, reported as "folding the top node gets rid of the rest of the proof"). The continuation test fixed that, and the user then asked for the tactic to go too and the interruption to be MARKED — which is the ◌ skip, so the merge followed. Two measured facts make it coherent: the trunk skip restores the mid-trunk `−` the side-branch rule cost (11 of 36 goals on `sum_range_odd` had lost it — every goal whose consumer was a single linear step), and the break's CAPTION, which names the skipped tactic, answers the objection that had ruled a step fold out ("two byte-identical goal boxes adjacent with nothing saying what happened between them"). Counts moved by +1 per applied cut because the break is a node: `sum_range_odd` seeded 80 → **72** (a `.fold` on `gap`'s side proof, one break), root `−` (skip) 72 → **58**, the goal after `have key` 72 → **70** — `have gap` and its side proof go, the goal it leaves and the closing `exact` stay drawn, the `succ` case (fold) 72 → **66**, a goal before a `refine ⟨?_, ?_, ?_⟩` (fold, everything below) 25 → 2. `collapse all` writes the OUTLINE (`outlineCuts`): a `fold` on every goal that STARTS a branch — spawned root, side condition, a case — and nothing else, so the trunk stays drawn with a break where each branch left it and each break reopens one branch (`sum_range_odd` 80 → **18** = the ten-node spine, four branch-root goals and four breaks — `disjointCuts` drops the nine outline cuts nested inside those; `factorization` 76 → **8**; a branchless proof folds nothing, honestly). `.fold` flags seed the same cuts (`cutsForTargets`: a goal target folds, a tactic target — the first-tactic case — skips), `rflResidue` rides the same door, and `sourceView` returns ONE list, cuts. Connectors are orthogonal │└ elbows from `TRUNK_INSET` inside the parent's left edge, no arrowheads (tried, removed: triangles were noise and poked into boxes). **What a connector DOES carry is a target-type mark near each end** (`LinkMark`): gap-with-DOT = the line terminates at a GOAL, gap-with-DASH = at a TACTIC — round↔goals' rounder corners, straight↔tactics' squarer; the dash is NOT a drawn glyph but a piece of the original stroke isolated by two background-coloured cuts (user directive: no unicode dash). The departure-end mark is the point (know before you follow a line off the trunk); the arrival confirms. **Marks are PAINTED halos over the stroke, never a path edit — `linkSpans` needs no mirror of them.** Placement, settled by a user correction: **an elbow's VERTICAL run reads as the TRUNK (or is overlaid by every sibling branch's elbow), so it stays CLEAN** — both marks ride the horizontal leg unique to the link (`branchMarks`, `Mark.horiz`): one right after the split, one before the box (`| - - —— - - [tac]`). The spine's straight lane links ARE the trunk, so they take an ARRIVAL mark only — one dot just above the goal, no departure to break the continuous line. Two exceptions: a LEFTWARD (trunk-resuming) elbow's horizontal runs back under its target box, so its mark falls back to the vertical drop (which is that link's alone); and the stacked trunk's straight goal→tactic links keep the two-ended `sharedMarks`. A run too short for `LINK_MARK_OFF` offset placement gets ONE mark CENTERED (`markAt`) — load-bearing: the stacked trunk's goal→tactic gap is 11px, the most common link in the default layout, and a 13px floor left 12/29 links bare (measured); micro-runs under `MARK_MIN` (boxes essentially touching) stay bare on purpose. **A link into or out of a BREAK carries no mark either** (`isBreakNode` on source or target): the break is not a target of either kind, and the cut-and-dot beside it would say it was. **⑃ wide draws NO marks at all** (user directive): the Béziers splay, so the straight cut-and-dot read as debris on curves — and the layered tree makes the target's kind obvious from the depth bands alone. Two settings ride the companion channel. `ramify.linkTint` defaults OFF (edge ink pulled toward the target's hue — `--ptw-link-goal`/`--ptw-link-tactic` recipes). **`ramify.linkMarks` gates the mark LAYER and defaults ON** — the marks are the accessible baseline, the one channel that survives without colour, so this is an opt-OUT for readers who take the target's kind from the tint or the box shapes and find the ink fussy. (A third, `ramify.linkEmoji`, drew 🎯/⚙️ in place of the marks and was REMOVED outright at the author's direction — the loud variant of an accessible baseline is not a preference worth a wire field, a Lean struct field, a render branch and a settings entry.) Defaulting on is also what makes the field's ABSENCE right: an older companion never writes the key, and absence must mean what that companion was already drawing (`jsonField … true`, `r.linkMarks !== false`, `get("linkMarks") !== false` — three places, all opt-out shaped). Gating is paint-only: `linkSpans` and every span the layout computes are untouched (measured — marks off leaves all 29 connector paths drawn and 0 mark elements). On a mode toggle the view re-centers (mode is in `viewKey`); compact pins the content's left edge near `COMPACT_LEFT`, wide centers the root.

### Data sources and the shared view

`ProofTreeView.tsx` takes one `Proof` and optional hooks, nothing else. `App.tsx` fetches `sample.ndjson`; `widget.tsx` calls `ProofTree.getProofTree`. `proofToTree` / `layout.ts` / `ProofTreeView.tsx` are source-agnostic — do not import NDJSON or infoview APIs there. The only renderer-adjacent modules allowed to import infoview APIs are `taggedRender.tsx` and `tacticTokens.tsx`.

**The widget's RPC path mirrors the CLI's harvest**: `getProofTree` is `Paperproof.getSnapshotData` (`.tree` mode) minus the single-tactic branch — `withWaitFindSnapAtPos` → `BetterParser_Tree`. An un-elaborated proof returns `steps := []`, which renders as "no proof here" — data, not an error string to pattern-match.

**What re-fires the RPC**: the cursor (`pos.uri/line/character`) AND the document — `useServerNotificationEffect("textDocument/publishDiagnostics")` bumps a `docRev` counter (diagnostics are published when the file worker has re-elaborated, i.e. exactly when a re-parse can return something new). Without the second dep, widget-made edits (commit, (+) insert, `sorry` stub — none move the cursor) never redrew. Bursts are affordable: `DOC_SETTLE_MS` trailing debounce, server-side `proofTreeCache` keyed `(uri, DocumentMeta.version, command start, diagnostics count)`, and `stable` only re-lays-out when the proof's TEXT signature changes. No loop risk (a response publishes no diagnostics).

**WHAT A PROOF SWITCH COSTS, and where.** Moving the cursor to another theorem is a `proofTreeCache` MISS by construction (the key holds the command's start), so it pays the whole parse + enrichment pipeline; a cursor move WITHIN a proof is a hit. Measured over LSP on `ProofTreeScratch.lean` (Mathlib, 7 proofs, warm worker): hit **1-18ms**, miss **26-520ms**, one pass through every proof in the file **1016ms**. The breakdown of the worst (38 steps): `BetterParser_Tree` 265 (upstream's, over half), `collectTaggedGoals` 97 (goal diffing included — the +25ms that commit reported is real and is the whole of its cost), `tokenInfos` 32, `labelFixup` 24, `tacticSlots` 12, `tacticNames` 14, everything else in single digits. **The CLIENT is not where the time is**: `proofToTree` + engine + `computeLayout` is 7.3ms on the largest corpus proof (80 nodes) and under 1ms on a typical one — two orders of magnitude under the server. Diagnose a slow switch server-side first, and measure it with the LSP probe, never from the CLI (the CLI's harvest is the same but nothing else about the timing is).

**The trap this cost model exists to record: a `def` whose result type is a FUNCTION is eta-expanded to full arity, so "collect once, return the applier" does not collect once.** `labelFixup` returned `Lsp.Position → String → String` over two `let`-bound whole-info-tree syntax descents; the caller's `let fixup := labelFixup …` was therefore not a closure over two computed arrays but a partial application of a five-argument function, and BOTH collectors re-ran on **every step** the caller mapped it over. Cost is O(steps × tree), so it grew with exactly the proofs that were already slowest: 904ms of a 1382ms miss at 38 steps, 156ms at 17, 25ms at 8 — and it more than doubled the price of reading a file (one pass 959ms → 2176ms, sum_range_odd 489 → 1359). Bisected to a single commit (`f0fef40`, which introduced the applier when it added the second pass); the eleven commits after it — typing hold, counterfactual, elide preview, goal diffing, open-block recovery — add **26ms between them**, so none of them is ever the answer to "switching got slower". The fix is a STRUCTURE (`LabelFixup` + `LabelFixup.apply`): a constructor application is strict, so each collector runs exactly once and `apply` is two array lookups. Verified unchanged, not just faster — the CLI corpus regenerates byte-identical over all 27 proofs (`multiline.lean` pins the tail restoration, and the `rw`-clause cases ride the same entry), and a live payload A/B over every proof in the scratch file is identical field for field. **Any future "collect once, apply per step" seam here must return DATA, never a function**, and the way to check is to time the mapping against the collector: if the map costs N × the collector, it is this.

**A cf latch was found while pricing the above, and is now FIXED** — the mechanism, the fix and its measurements live in the counterfactual's own section (§ THE LATCH), because it turned out to be a cf semantics question and not a performance one. In short: column 0 of a `theorem … := by` line resolves through `withWaitFindSnapAtPos` to the PRECEDING command's snapshot — trivia — so the real payload there was empty, which is `cfWanted`'s first disjunct, and the sticky serve then spread that one column across the whole line, where the designed exit is structurally unreachable. Measured at `e4631b0` too, where it was strictly worse (moving into the proof BODY stayed latched), so the serve had already been narrowed once. What remains here is the cost note that led to it: the latch cost an 800ms poll before the stub even appeared.

**The obvious gate for it is measurably WRONG, and that is the finding worth keeping.** "Refuse cf when the payload has no declaration identity at all" (`steps` empty ∧ `proofId == ""` ∧ `declRange` none) looks exact — you cannot claim a declaration is broken when you have not identified one — and it is not: the shapes cf EXISTS for report the identical signature. Measured on a core-only fixture over LSP with cf off, all four of `theorem ok … := by / sim` (only tactic unknown), `/ (((`  (only tactic garbage), one-line `:= by sim`, and a half-typed statement come back `steps=0, proofId="", declRange=null` — the same triple as the cursor at column 0 of a HEALTHY head line. So the empty payload carries no evidence either way and the discrimination has to come from somewhere else. Two facts narrow where: on the healthy head line **only column 0 is empty** (columns 5, mid and end all return the full 5-step payload), so the entry is a one-column artifact of `withWaitFindSnapAtPos` resolving trivia to the preceding command, and it is the STICKY serve that spreads it across all 54 columns. And the sticky cannot simply require `cfWanted`'s broken-ness conjunct, because the race it was built for is precisely a real payload that looks healthy while the diagnostics have not landed — the recorded 3-step wreck. Reproducing that race is what any fix here has to do first — and it is what gave the fix its shape: both refutations held, so the discrimination came from the ENTRY (the one-column artifact, killed at the snapshot lookup) and from the DOCUMENT (unchanged and settled, not merely healthy-looking). See § THE LATCH.

**The TYPING HOLD** (same file, the `stable` swap): a changed-text payload for the SAME proof is installed only once the CURSOR has been still for `typingHoldMs` (default 600, `ramify.typingHoldMs` over the companion channel, 0 = swap on arrival). Without it every keystroke that survived to elaboration relaid the tree out — through broken intermediates (`ri` = failed-tactic recovery node + error ribbon), the reported per-keystroke shudder; `DOC_SETTLE_MS` can't help because typing is one elaboration round PER keystroke, not one burst. **The quiet measured is the cursor's (`lastActivityRef`, bumped per `pos` change — the infoview delivers the cursor per keystroke at a ~50ms coalesce), never the payload clock's** — v1 debounced payload arrivals and was measured wrong both ways: on a Mathlib file elaboration spaces payloads wider than any sane hold (1-2s/burst), so every intermediate still swapped in even at 1.2s, while a payload arriving after the user had already stopped was held for nothing (the reported added lag). A pending swap now lands immediately when the activity clock is already quiet, else a self-rescheduling timer re-reads the ref each time it fires. Navigation bumps the clock too, deliberately: telling typing from navigation by (line, character) deltas is guessing, and the cost is one quiet period. Accepted limit (replaces v1's): after typing stops, ONE intermediate payload may still swap in before the final elaboration lands — "only swap payloads newer than the last keystroke" was rejected because edit-then-navigate would strand a pending swap waiting on a successor that never comes. Three immediate paths stay render-time swaps: first draw, real NAVIGATION, hold 0. **"Navigation" is `proofId` changed AND the cursor has LEFT the drawn declaration (`cursorInDecl` over `stable.proof.declRange`) — the second half is not belt-and-braces, it is the whole fix for the reported "no difference" after v2.** A half-typed tactic breaks the enclosing `calc`, which swallows what follows it, so the command containing the cursor is named after the NEXT theorem: measured on `ProofTreeScratch.lean`, retyping `ring` reports `proofId: "root_2_irrat_over_int"` with 17 steps and `declRange` 177-203 for two keystrokes, while the cursor never leaves line 162 and the drawn proof is `calc_workout` at 143-174. On the bare `proofId` test every one of those bypassed the hold, so the two payloads the hold most needed to suppress were exactly the ones it waved through — a foreign theorem's tree swapped in mid-word AND, since `proofKey` is the declaration name, fold/zoom/focus/scroll reset with it. The cursor is the honest witness (it did not move); `declRange` is already on the wire for `proofSpan`. Containment is INCLUSIVE at the stop, unlike `positionContains`' half-open step rule, and a missing `declRange` falls back to trusting `proofId`: a false "inside" costs one quiet period before a real navigation lands, a false "outside" restores the bug. Replayed against the recorded live-server stream: **old rule 2 swaps (one foreign), new rule 0 — the tree does not move at all while the word is retyped.** Two details are load-bearing: **the effect re-arms on the SIGNATURE, not the response object** — elaboration settling down a long file re-parses to fresh but text-identical payloads, and identity-keying churned the effect for the whole file's elaboration (the deferred swap still installs the LATEST payload via `candidateRef`); and **the widget's own writes bypass via `expectEditRef`, a 3s time WINDOW, not a consumed flag** — the first payload after an applyEdit can be a stale elaboration finishing, and a one-shot flag spent on it held the real redraw. Stamped in `editTactic` (comment edits and flag writers route through it), `addTactic`, `deleteTactic`, and the undo/redo relay.

**THE COUNTERFACTUAL (widget only; `ramify.counterfactual`, default ON): while the document is broken at the cursor, the tree drawn is the same theorem elaborated with the cursor's LINE replaced by `sorry`** — full shape held, a dashed stub (accent-inked, showing the live draft) marking where the tactic being written lands, snapping to the real tree the moment it elaborates. Server-side in Ramify.lean, riding `getProofTree` itself (one candidate pipeline, so the typing hold and the atomic swap apply unchanged). **How the re-elaboration works** (`computeCf` — the enrichment pipeline was factored into `mkTreePayload` so both callers share it, a synthetic `Snapshot` being the seam): the compat snapshots carry `mpState`/`cmdState` (the states AFTER each command), so the predecessor of the cursor's command — found in `cmdSnaps.getFinishedPrefix`, byte-identical in the spliced text — is a valid restart point; `Parser.parseCommand` + `Command.withLoggingExceptions (getResetInfoTrees *> elabCommandTopLevel)` is `Frontend.processCommand`'s recipe. **`Elab.async` is forced OFF in the copied scopes** — the server runs with it ON, and an embedded elaboration under async scatters messages and info subtrees into snapshot tasks nothing drains (the v4.29 trap, in the one environment where it is real; the option's own docstring names this case). Kind-gated to `declaration`s (`#eval`/`initialize` have global effects a copied `Command.State` does not sandbox). The cf's diagnostics come from its OWN message log — populated, since we ran the elaboration; the injected stub's `declaration uses …` warning is dropped as our noise. **That filter matched `declaration uses 'sorry'` and was therefore DEAD on v4.32.2, which writes ``declaration uses `sorry` ``** — measured on the wire, one stray warning ribboning every counterfactual payload. Core has now spelled this string with two different quote styles, so the test is the QUOTELESS prefix; do not re-add the quotes. **The economics: the spliced text is INVARIANT across keystrokes on the line** (that line reads `sorry` either way), so `cfElabCache` keys the one expensive elaboration (~1-3s, measured, detached task — a request is never blocked; `cfPending` tells the client to re-poll at 800ms — on its OWN `pollRev` tick, not `docRev`, which also keys the theme fetch) on the spliced text's hash and serves the whole burst; an entry is `pending (startMs)` or `done` — one ref, completion overwrites the in-flight marker, the timestamp expires one orphaned by a dead task. **`proofTreeCache` stores the REAL payload (a pure function of its key) and the cf decision runs per request AFTER it** — caching the decided payload instead forced a pending-is-not-an-answer special case whose miss re-ran the whole parse+enrichment pipeline once per poll; a poll now costs the line-local splice decision plus at most one deferred file build and two hashes (`cfSplice` returns a thunk; the healthy path declines before forcing it). `cfDraft` (the real line's content) is attached per request OUTSIDE the cached blob and, client-side, OUTSIDE the stable signature (`cfLine` is IN it — entering/leaving cf is a real tree change); client-side it is DERIVED from the latest resolved response (`useAsyncPersistent` already holds the previous value during a refetch), not latched in state. **Splice tiers** (`cfSplice`, safe-by-construction: a wrong guess elaborates to nothing, caches as failed, and the client keeps today's behaviour): `… := by <draft>` keeps everything through the LAST `:= by` (a calc link/one-line `have` — whole-line would break the link); `· ` and `| c =>` keep their markers; an empty line takes the CURSOR's column as indent; comment lines and blank-at-column-0 decline. **The trigger** (`cfWanted`): broken-in-this-declaration (steps empty ∨ recovered-on-line ∨ declRange not containing the cursor — the calc-swallow signature ∨ error diagnostic in the DECLARATION — declaration-wide because deleting a whole line reports `unsolved goals` on the CONTAINER, never the blank line; measured, the line-scoped version missed the delete-and-retype scenario entirely) AND no step STARTS on the cursor's line (the completeness witness — also what hands the real tree back when the typed tactic lands). **AND the cursor is not ABOVE THE WHOLE BODY of its own declaration** (`declContainsPos` ∧ slots non-empty ∧ every slot starting on a later line) — a signature line is not a place a tactic is written, so there is nothing to preview, and the `:= by` tier's splice there replaces THE ENTIRE BODY with `sorry`: a proof whose tactics merely fail, which is exactly the proof whose partial shape you want to read, was redrawn as a lone stub for as long as the cursor rested on its header (reported). Measured on `sum_range_odd` with a broken tactic in the body: from the header line, 18 steps and no cf, where before it was 1 step and a stub. **Both extra conjuncts are load-bearing.** "Slots below the cursor" alone is true of every line above the last tactic in every proof and would switch cf off product-wide. "The declaration's FIRST line" was the first version and is too narrow — a statement routinely spans lines (this one runs 43-56), so resting on its `:= by` failed the test and cf fired exactly where the report came from. And without `declContainsPos` the rule fires on the calc-SWALLOW shape, where the payload names the NEXT theorem and its slots are all below by accident of distance — measured, that took cf away from the line actually being typed. **AND the declaration is not an OPEN BLOCK** — see the next paragraph; that refusal sits at the top of `maybeCounterfactual`, not in `cfWanted`, because it has to dominate the sticky serve. **The trigger's signals race the diagnostics reporter, so SERVING is sticky** (`cfServeCache` carries line + spliced-hash): if the last serve was cf for this line and the current text splices to the SAME counterfactual and no step starts here, keep serving — measured, one keystroke after a delete every signal missed (the calc container's step covered the line) and the raw 3-step wreck was served mid-burst. **Sticky needed an EXIT, and the whole of THE LATCH is the next paragraph.** **WHICH node is the stub is the server's answer, not a guess** (`cfStubPos`, an `Lsp.Position` — never an `Lsp.Range`, see `declRange`): the splice already knows the byte it wrote `sorry` at (`CfSplice.stubByte`), `computeCf` maps it through the spliced `FileMap` into the same coordinate space the payload's steps carry, and the client matches position + label `sorry` the way `pendingFill` claims its own stub — falling back to the old "first tactic on `cfLine`" rule when the match fails or an older server ships no position (dropping the overlay entirely is the worse failure). **The ambiguity this removes was NOT reachable when attacked, and the reason is worth keeping**: a container and the stub CAN share a line, but `cfWanted`'s completeness witness declines cf whenever any step starts on the cursor's line, and a one-line `have … := by` records its container step there in the REAL payload whether its body is deleted or left unparseable (measured, both shapes: `stepStartsHere` true, cf never fires). The `:= by` calc-link tier — where cf does fire — yields exactly one step on the line, the `sorry` (measured). So this is a guess removed at the seam, not a bug observed, and its value is that the next splice tier inherits the right node instead of re-arguing which one it is. **The cf payload also WITHDRAWS the editing seam on the spliced line**, so no surface can act on counterfactual coordinates against the real buffer: `tacticEdits` whose range TOUCHES the line are dropped (they carry TEXT — a container's slice holds the injected `sorry`, and committing an in-place edit built from it would write it over the author's draft; the cost is that such a container's label loses its token colouring while the line is typed), while `deleteSlots` are dropped only when they START or END on it (they carry ranges alone, and a slot merely containing the line has correct endpoints — the splice adds no newline). The overlay's pointer-swallow stays, but the marquee pill's verbs and anything written next now decline through gates the client already has (`getTacticEdit` missing ⇒ no in-place edit, no flag write; a missing slot ⇒ `deleteExtent` declines). **But the withdrawal was never an argument against editing THE AUTHOR'S LINE** — only against editing a range whose TEXT came from the counterfactual, and the user's directive on the theorem-line stub was "fine, provided it is editable". So `cfDraftCol` ships beside `cfDraft`: the column the real line's content starts at (`CfSplice.draftCol`, the `ws` the splice already measured), which with `cfLine` is a REAL-coordinate range carrying no text at all. The overlay keeps swallowing the single click and grows a DOUBLE-click of its own: it opens the ordinary in-place editor prefilled with `cfDraft` and commits `[{cfLine, cfDraftCol} … {cfLine, 1e5}]` — **to end of line via the clamped-huge character `addTactic` already leans on (the same `1e5`, deliberately not a second magic number), and that is what makes a snapshot-derived range over a line being typed in honest**: however many more characters have landed since the payload was built, the replacement still takes the whole line. Continuation lines get the indent re-applied (`editing.cfIndent`, the `commentIndent` mirror); an empty commit CANCELS (the tactic rule, not the comment one — blanking must not erase a line mid-word); the colour mirror is declined OUTRIGHT rather than left to fall out of the withdrawal, since the node's position is a spliced coordinate whose tokens describe the injected `sorry`. Absent `col` (older server, or the `?cf-stub` harness) ⇒ inert overlay, the old behaviour. Measured over LSP: `line.slice(cfDraftCol) === cfDraft` on the whole-line, bullet and `| c =>` tiers; the widget's own committed edit (`[91:6 … 91:1e5] := "ring"`, read out of the harness's `window.__edits`) restores `ProofTreeScratch.lean:92` to a payload byte-identical to baseline; and the STALE-SNAPSHOT case passes too — a cf built on the draft `nlin`, the buffer then grown to `nlinarith [sq_nonneg 1]`, that same range committed, whole line replaced, sig back to baseline with no leftover tail. **The clamp is the EDITOR's, and a probe must supply it.** `ec.api.applyEdit` goes through VS Code, which validates the range against the document before the didChange leaves; Lean does NOT clamp, so a raw LSP probe sending the unclamped column ate the following lines wholesale (38 steps → 18) and `MAX_SAFE_INTEGER` wedged the file worker outright. That is why `cfedit2_probe` tracks the line's current text and sends its length: with the editor simulated, the test is of the RANGE rather than of the transport.

**THE LATCH: a healthy proof wore a `sorry`, and it took three mechanisms in series.** Reported as a screenshot — the cursor resting mid-word on the SIGNATURE line of a complete, green `tour_reading`, the tree drawing a dashed stub and `✎ writing line 40`. The proof was never broken. **Seed**: `withWaitFindSnapAtPos` takes the first snapshot with `s.endPos >= pos`, and the `>=` is the whole story — a command's `endPos` IS the byte the next line's leading trivia begins at, so at COLUMN 0 of a `theorem … := by` line the PREVIOUS command answers, with `steps=0, proofId="", declRange=null`, which is `cfWanted`'s first disjunct. The census: on a healthy head line ONLY column 0 is empty (5, mid and end all return the full 5-step payload), so this is a one-column artifact and not a fact about the proof — and it is hot traffic rather than an edge case, because `0`, `^`, `gg` and `j`/`k` off a short line all land a vim user on column 0. **Spread**: the sticky serve re-serves for every column of the line while no step starts there, and on a signature line no tactic can EVER start, so `stepStartsHere` — the designed exit — is structurally unreachable; each serve refreshed the last-serve hash, so `sh == srcHash` held forever on an unedited file. **Persistence**: `cfServeCache` was written on serves and cleared nowhere, so leaving the line and returning re-latched instantly. Each mechanism is harmless alone; in series they mean ANY transient false-broken signal on a signature line latches indefinitely.

**The fix is three changes, and each was verified to hold ALONE.** (1) The ENTRY NUDGE (`cfNudgePos?`) — at column 0 of a line with content, look the snapshot up one column in. **The target is `max 1 firstNonWs`, not "the first non-whitespace character"**: a `theorem` starts at column 0, so the literal rule names the cursor's own column and is a no-op on exactly the reported shape. **The nudged snapshot is tried FIRST, falling back to the plain lookup only when its payload is empty** — and **"empty" is `steps` empty AND `openBlock` NONE**, which testing `steps` alone got wrong and shipped: an OPEN BLOCK carries zero steps and a COMPLETE answer (the goal it owes, plus its chips), so at column 0 of a `:= by` whose body had just been deleted the nudge threw the good payload away for the trivia one, the tree read "no proof tree here", and the client held the PREVIOUS proof while it polled — one bug reported as two, a stale tree and then no tree, on vim's hottest column. Measured after: openBlock present at column 0, mid-name and end-of-line alike. Any future "is this payload empty?" test here must ask the same question — a payload's worth is not its step count — the other order computes the trivia payload every time, and `proofTreeCache` holds ONE entry, so it would store then evict, paying two pipeline misses (26-520ms each) on a vim user's hottest traffic. The two orders differ observably only when BOTH payloads are non-empty, and there the nudge shows the declaration the cursor's LINE belongs to rather than the one above it — the intended reading. A blank line at column 0 declines, which is the shape `cfSplice` already declines; keep the two agreeing. (2) The STICKY EXIT: on the `sh == srcHash` branch, `payloadHealthy real pos` overrules the sticky rule and evicts. (3) EVICTION (`serveReal`): every exit returning the REAL tree clears an entry for that line, so a latch cannot outlive its cause — hygiene, since with the nudge in place the exit already covers the same-document case.

**WHICH gate the replay demanded, and the two hardenings it refuted.** The wide "demonstrably healthy" gate is unusable and the recorded race payloads say so outright: the 3-step wreck has 37 steps, a `declRange` containing the cursor and ZERO error diagnostics, so it passes `payloadHealthy` whole. Narrowing to `sh == srcHash` is necessary but NOT sufficient, and the residual window is REACHABLE — measured, not feared: a `ck`-matched serve refreshes `sh`, so the second poll of an unchanged mid-typing document satisfies `sh == srcHash`, and polling four times per keystroke through the calc delete/retype replay served the wreck on exactly that beat (**1 drop in 17 post-cf rows, steps=3 against a 14-step baseline**). Two structural answers were tried and MEASURED not to close it. `cmdSnaps.getFinishedPrefix`'s `isComplete` — "the reporter has had its chance" in the file worker's own terms — is TRUE at the wreck beat: elaboration of the finished prefix completes before `collectCurrentDiagnostics` has the messages, which is the gap the race lives in (dumped at that beat: 0 diagnostics, then 6 errors 158ms later). And NOT refreshing `sh` on a `ck`-matched serve closes this window while reopening the defect being fixed — on a signature line the broken and the fixed text splice to the same `… := by sorry`, so after any edit the `ck` branch would serve forever and the exit would again be unreachable. So the gate is the CLOCK (`cfExitSettleMs`, 750): `cfServeCache` carries when the current source hash was first served, the exit waits that out, and a hash change restarts it. That is honest about what the race is — a timing gap between elaboration and publication that nothing on the wire names — and it is ~5× the measured lag while staying far under one re-elaboration cycle, so it never delays a handback `stepStartsHere` would have made anyway. Measured after: **0 drops in 17 post-cf rows over three runs, 0 in 81 rows at 20 polls per keystroke, and 0 on the bullet tier**; both splice tiers' payloads byte-identical to before (sigs and verdicts diff-clean). The accepted cost, recorded because it is the exit's whole shape: a latch cleared by the exit alone can persist up to `cfExitSettleMs` and needs a REQUEST to arrive (a cursor move or a `docRev` bump) — with the nudge in place nothing seeds it, and measured at GAP=0 the exit still fired at the very next column because the cf's own elaboration wait had already run the clock down. The two refutations above (§ the obvious gate) stay: the empty-identity triple carries no evidence either way, and the sticky cannot require `cfWanted`'s broken-ness.

**THE STUB IS SOUGHT, not merely followed** (`cfSeekKey` + `unhide`, ProofTreeView). It marks where the caret is RIGHT NOW, so a stub the reader cannot see makes the `✎ writing line N` floater a claim about nothing. Measured on the user's own file — `ProofTreeScratch.lean`, retyping `ring` on line 92, whose `have parity` carries `.none` on line 84 — the stub lands INSIDE the seeded ghost, so `cfStubNodeId` found no drawn node and the overlay drew **nothing at all**, while the cursor accent resolved to the ghost (`tacticTargets` hands a marker its members' positions) sitting 955px below the fold. The cursor follow cannot cover this and it is not a bug in it: its guard is the CURSOR key by design, and the counterfactual arrives seconds after the keystroke that caused it (7.3s on the first splice of this file), so by the time a payload first contains a stub the cursor has been still and the guard is shut; and even when it does fire it deliberately declines a hidden node ("don't fight the user"), right for a cursor parked in a folded region and wrong for the one node being written into. So the stub gets the pager's own machinery — `revealNode` factored into `unhide` (drop the ONE elide cut containing the target, unfold the ancestor chain, page the gallery) plus the shared `seek` slot — and the drop is what the user was doing by hand. **`unhide` must write NOTHING once there is nothing left to undo**, because it is called from RENDER (the `galleryFollowed` pattern; the house lint refuses setState in an effect) and that is the only thing stopping a loop; `setSeek` therefore stays OUT of it, minting a fresh object per call being exactly what the pager's `‹ ›` needs and a render-phase caller cannot have. Keyed on the stub's SOURCE position, never the draft (per keystroke) or the node id (per re-elaboration), so entering a counterfactual moves the view at most once. **And it must skip the `rekeying` render** — the pass where the proof/shape branches are re-keying view state — because the memos there were built before those writes, so `elideCuts` still holds the PREVIOUS elaboration's ids, they resolve to nothing against the new base tree, and every ghost's members come back as ordinary drawn nodes: the seek saw the stub as visible, latched itself satisfied, and the render that actually re-elided it never ran the reveal. That one boolean is the difference between the fix working and doing nothing at all. Measured in `?cf-replay` over the recorded stream: scrollTop 720 → **2859** with the stub at viewport y 347 and the ghost opened (41 nodes → 67, the NESTED `.none` on line 101 correctly left standing), then **2859 held byte-for-byte across three further keystrokes**; a deliberate scroll to 900 mid-cf is not yanked back until the cursor itself moves; leaving and re-entering the cf re-arms. Free with it: a diagnostic inside a ghost is now reachable by the pill's `‹ ›`, which previously could not open a cut either.

**The stub is COLOURED and hoverable, from the SPLICED elaboration** (`cfDraftHighlight` → `cfDraftTokens`/`cfDraftInfos`, rendered through a `render` hook on the `cfStub` prop that reuses `renderTacticTokens` — plain text when it declines, the tactic rule). The colour mirror used to be declined outright here because the payload's own tokens on this line describe the injected `sorry`; the fix is a different SOURCE, not a different renderer. **Collecting from the REAL snapshot is the obvious answer and is measurably WRONG**: when cf fires the real snapshot routinely does not contain the cursor's line — a broken `calc` swallows what follows, so the command holding the cursor is named after the NEXT theorem (`cfWanted`'s own declRange disjunct), and the first implementation duly returned 100 tokens from twenty lines further down the file. The splice replaces a SUFFIX and adds no newline, so from the draft's column up to the injected stub the two documents are byte-identical and the cf's own tokens describe the author's text exactly; the collector is bounded `[cfDraftCol, cfStubPos.character)` for that reason. Measured on the `:= by` calc-link tier: 9 tokens, all on `cfLine`, in bounds, 9 popups, 0 orphans, `by` a keyword — and 0 on the whole-line tier, which is honest (that splice replaces the whole content, so the only text before the stub is the word being typed, unpainted in the buffer too). It rides the blob, which `cfElabCache` keys on the spliced text, so it is collected once per counterfactual rather than once per keystroke. `tokenInfoAt` is the shared per-token popup decision, factored out of `mkTreePayload` so the two callers cannot drift. **There is NO `✎ writing line N` floater** — removed by user directive: the dashed accent-inked stub already says the line is being written, and that we re-elaborated the declaration with it spliced to `sorry` is an implementation fact the reader has no use for (the `<title>` still says it for anyone who asks). Client: `cfStub` prop → dashed overlay over the stub node; `?cf-stub=<line>:<draft>` fakes the marker in the standalone harness (line only, so it drives the FALLBACK rule — the exact path is exercised by `?cf-replay` over recorded payloads, which now replays `cfDraft`/`cfDraftCol` and stubs `onEditTactic` so the committed RANGE is readable). **The node's OWN box hides under the overlay** (`cfStubId`, read by the nodes loop's `hideForEdit`) for the reason a narration-mode comment edit hides its box: the overlay stands IN for the box. Here the two do not even coincide — the overlay widens to the draft while the box stays `sorry`-sized — so the box's solid stroke filled the dash gaps along the shared top and bottom edges and its right edge stood as a bar inside the overlay, one border reading as "partly dashed and partly full". Reported on a whole-theorem-line draft, where the gap is largest and the defect unmissable; measured after, at the stub's y there is now exactly one visible rect (the 465px dashed overlay) and one hidden (the 60px box). The overlay also steps aside while its OWN editor is open, or the same defect returns as two dashed rectangles. Probe (`cf_probe.mjs` pattern): both splice tiers measured end-to-end over LSP — delete → one pending beat → cf with the BASELINE's step count and ONE signature across all keystrokes with the draft tracking, then the valid tactic returns a payload byte-identical to baseline. Known limits, accepted: one line at a time (two broken regions fall back on the second), multi-line drafts shift line numbers below (the cf declines nothing here — it simply won't match the splice and falls back), and a `have h := by <draft>` on one line stubs the `by`, not the `have`.

**THE OPEN BLOCK — `:= by` with nothing written into it — is NOT a counterfactual case, and used to be the worst one.** `theorem tour_frontier … := by` with its body deleted drew a dashed stub whose label was THE THEOREM LINE, under a `✎ writing line 122` floater, with no chips anywhere: a node that is neither a tactic nor a goal, that cannot be edited (the cf payload withdraws the editing seam on the spliced line BY DESIGN, so it never could be), that shows source nothing else in the product shows, and that cost ~830ms of background elaboration to produce. All four complaints have one cause: the `:= by` splice tier fires on a theorem line as readily as on a calc link, and the injected `sorry` CONSUMES the root goal — so the root is not pending, and `FrontierChip`s never render. That is the whole difference between "vestigial stub" and the actionable shape a `constructor`'s two branches get.

**The goal was already in hand; nothing needed re-elaborating.** Measured on v4.32.2: an empty body PARSES — the block is a well-formed `byTactic` whose `tacticSeq1Indented` holds an EMPTY sepArray, not `Syntax.missing`, not a parse error — Lean elaborates the declaration and reports one honest `unsolved goals` on the `by`, and the root goal sits in `goalsBefore` of the `byTactic`'s own `TacticInfo` (`before=1 after=1`). The reason the tree drew nothing was `mkTreePayload`'s empty early-out (`steps.isEmpty` ⇒ `{steps := [], allGoals := []}`), which is also why the settled real payload measured `steps 0, allGoals 0, declRange null, proofId "", diagnostics 0` — not an absence of data, an early return ahead of every enrichment. So `Recover.recoverOpenBlock` (Part C) is a READ of the info tree the request already walked: **0ms, first request after re-elaboration, versus 829ms and a re-poll cycle for the counterfactual it replaces** (measured end-to-end over LSP on the reported state: 166ms edit→actionable payload, on poll 0, against 829ms edit→cf payload; typing `constructor` back returns the real tree in 165ms and the fully restored proof is byte-identical to the written baseline).

**It emits a GOAL and no STEP, which is the point** — a step is a box, and a box standing for the tactic nobody has written is the stub being removed. `ProofTreeData.openBlock` (plain data, both wires, absent unless it fired) carries the real `GoalInfo`, the ANCHOR (end of the `by`) and the INDENT (the declaration's own + 2). Three client clauses follow, each the only one of its kind: `rootIds` prepends the open goal (every other root is some step's `goalBefore` by construction, so this root cannot be derived from `steps` at all); `pending` gains an `openRoot` clause that is a different SHAPE rather than a widening — there is no producer to be reached THROUGH, and the spawned-goal exclusion is about restatements a branch already handled, of which there are none; and `openBlockSpec` builds the `AddSpec`, since no producing step's column can be copied and no `TacticEdit` exists to resolve a tight end through. The anchor is SHIPPED rather than derived from `declRange` — the two coincide while the block is empty — because it drives a WRITE, and the `cfStubPos` rule is that the server names its own seam. `kind: "seq"`, `producer` and `after` both the anchor: no `TacticEdit` starts there, so `addTactic`'s two lookups miss and fall back to exactly the shipped `indent` and to end-of-line, i.e. the ordinary insertion rule — which is why a trailing comment on the `by` line keeps its place and the tactic lands under it. Verified by PERFORMING the insertion, not by reasoning: every chip's edit applied to `proofs/openblock.lean` and elaborated, 6/6 with 0 structural errors, `+` and `sorry` both landing at column 2. Server-side `calcRelationGoals` carries the mirror `extra` clause so the `calc` chip is offered on real `Trans` instances here too (measured: `=` chainable, `∧` correctly not).

**The GATE is `tacticSlots` being empty, and it is what keeps cf alive.** A first tactic being TYPED occupies a slot — `by c` and `by ri` each record one, an `unknown tactic` still owning its slot (measured) — so `recoverOpenBlock` declines and every mid-typing case reaches the counterfactual exactly as before (re-measured: the `:= by` calc-link tier and the whole-line tier both still deliver one cf signature across the whole keystroke burst with the draft tracking, and hand back a payload byte-identical to baseline). Slots rather than `steps.isEmpty`: a proof whose only tactic FAILED also harvests zero steps, and that is Part A's territory — it has a slot. **The refusal is placed at the TOP of `maybeCounterfactual`, above the sticky serve, and that placement is load-bearing**: sticky is keyed on (line, spliced text), and `… := by rin` and `… := by` splice to the SAME `… := by sorry`, so deleting a half-typed first tactic matches the sticky key exactly — a gate in `cfWanted` alone would have kept serving the stale counterfactual over a payload that already had the goal (measured: with the gate above sticky, one poll after the delete serves the open block and stays there; the theorem-line draft never reappears). It tests the open block's PRESENCE on the payload rather than re-deriving "is the block empty?", so the refusal cannot disagree with what the payload drew. `proofs/openblock.lean` pins all of it, negative control included; the corpus is otherwise byte-identical through `gen.sh` (3 lines added, 0 changed).

**Residual, deliberately NOT changed: `cfDraft` is still the whole line, so a one-liner being typed AS `theorem foo : P := by ri` shows the theorem line again** (measured — that state has a slot, so it is a genuine cf case). The uniform fix would be to make every tier's draft "what the injected `sorry` replaced" (`ri`, not the line that contains it), which would also change the calc-link tier's label from `= 2 * … := by nlin` to `nlin`. That is paint-only (`cfDraft` rides no signature and no cache key) but it is a judgement about a shipped surface on tiers nobody complained about, so it was left for the author to call rather than folded into this change.

**The hold gates `interactive` too (`swapPending`), making the eventual swap ATOMIC.** v1 froze only the layout while `interactive` adopted every response, and all four of its consumers repainted per keystroke against the held tree: the tagged goal labels flashed in and out of colour (mvarIds renumber per elaboration, so the text-equality guard dropped them to plain SVG until the swap), the ribbons/pill flickered per response, `infoAt`'s popups and `getGoalTerms`' completion churned identities. Adoption now waits out a pending swap; the render after the swap adopts the same response, so layout, colours, tooltips and diagnostics move together once — and during the hold every surface stays CONSISTENT with the drawn tree, which they already pair against (`stable.proof`). The rejected-call branch is NOT gated: self-heal must not wait out a hold, and after a worker restart with unchanged text the sig matches so re-adoption is immediate. Two churn fixes found with it: `animateScroll` (ProofTreeView) lets an in-flight animation to the SAME target finish instead of restarting (`FollowAnim.tgt`) — the follow effect's guard is the cursor key by design (ids renumber per re-parse), so with the accented node outside the comfort band every keystroke restarted the ease, a scroll that never settled; and `useThemeTokenColors.setColors` is identity-compared like `abbrev` (it refetches per `docRev`, and a fresh object per fetch invalidated every `tokenColors`-keyed memo for a byte-identical palette).

**Ref lifetime** (widget.tsx): the payload is split — `stable` holds PLAIN data (proof text, comments, `tacticEdits`, `recovered`) and updates only when the proof text changes, so layout/fold state survives cursor moves; the `WithRpcRef`-carrying `taggedGoals`/`tokenInfos` live in `interactive`, tracking the LATEST successful in-proof response. They must not pin to `stable`: a ref is only resolvable in the session that issued it, and sessions die (worker crash, `RpcNeedsReconnect`, restart) — pinning rendered dead refs forever. Refreshing per response self-heals; a rejected call clears them; identity-compared against the response object so hold-previous-while-loading can't loop; no-steps responses deliberately don't clear (tooltips survive a trip outside the proof). Diagnostics ride `interactive` too (plain data, but they change without the text changing); the span filter runs against `stable`'s proof so a different theorem's response contributes nothing.

### Node ↔ source (widget only)

**Tree→source**: clicking a positioned tactic node calls `onReveal` (mapped to the companion's `reveal`, NOT `ec.revealLocation` — vscode-lean4's reveal always picks the first visible editor, while the companion targets the lens when open, closing the tree↔lens loop). Goals stay cut-on-click — the `−` skips the step below a trunk goal and folds the branch under any other (see FOLD IS A CUT); their secondary actions ride a hover action bar (`NodeActionBar`, rendered inside the node's `<g>` so box→bar travel can't un-hover) and modifier fast paths (⌘/Ctrl-click reveal, ⌥-click focus). **The bar's whole vocabulary, in render order**: `+` (open a closed calc link's goal), a dashed box for skip (drawn, see Eliding nodes), `»` reveal (goals), `◎` focus / unfocus (goals), **`⊹` path / unpath (EVERY node — see Controls)**, `⧉` lens (tactics), and a **trash can** for delete (an inline SVG, not a glyph — `NodeAction.icon` overrides `glyph`, which stays the React key; no code font carries a can, and the `⊘` it replaced says "forbidden", not "delete"; its paths span 7.5 units and its stroke is **0.9**, so the drawn ink is 8.4px against `◌`'s measured 8 and `⧉`'s 9 — five strokes inside 7.5 units means the weight that reads as one line on `◌` reads as a block here, so if it ever goes muddy the answer is a SIMPLER shape, never a thicker stroke). **The bar's marks are sized on EQUAL INK, not equal font size** (`RailButton.glyphPx`'s rule, now also `NodeAction.glyphPx`), and two of them needed it — measured on the raster at 8×, the shared 13px inks `◌` 8.00 tall, `◎` 8.00, `⧉` 8.88, `»` 6.00. The trash can is drawn to VS Code's own codicon `trash` — flat lid line, small centred handle, PLAIN rectangular body (no taper), two ribs, 1.25 stroke — because the tapered one it replaces inked **10.63 × 11.25**, one button visibly bigger than every glyph beside it; the paths now span 7.5 units and the stroke brings it to **8.88 × 10.00**, `⧉`'s height exactly. And `⊹` inks **7.00** at 13, the smallest mark in the row, so it carries `glyphPx: 15` (`PATH_GLYPH_PX`) and inks **8.00** — every mark in the bar now within 0.88px of every other. Each is gated on a real predicate, and `nodeHints`/`?` read the same gates.

**A MODIFIED click never falls through to the unmodified action.** `handleClick`'s tail returns on ⌘/Ctrl/⌥ instead of reaching `onNodeClick`: `goalRevealable` needs a position and root goals carry none, so ⌘-click on the very first node anyone clicks FOLDED THE ENTIRE PROOF (30 nodes → 1, measured; also ⌥ on a pending leaf, which is neither foldable nor focusable, and ⌘ on any goal in the standalone app, which has no reveal at all). A modifier that misses must do NOTHING — what the node does offer is in its hints and in `?`. The `isMarker` branch at the top still routes modified clicks through, deliberately: restoring a ghost with ⌥ held is harmless, and refusing it would be a new refusal rather than a fixed one.

**Source→tree**: `highlightPos` (from `PanelWidgetProps.pos`) accent-outlines exactly ONE node — the innermost (smallest-span) TACTIC containing the cursor. Recorded ranges overlap by construction (goals carry producers' ranges, structured tactics contain their branches, trivia inflates stops), so naive containment lights half a branch. **Two things make the pick land, and they are only correct together**: `positionContains` is HALF-OPEN `[start, stop)` (trivia makes a stop equal the successor's start), and the companion leaves the cursor at a range's **start**, never its end. Fixing only one is worse than the bug (measured exhaustively; cursor-at-start + half-open = 0 wrong). Goals never take the accent. `tacticNodeAt` (shared with the offline probe) adds two rules: parts of a proof belong to NO tactic's range (case markers, bullets), so from strictly inside a structured tactic prefer the nearest tactic that CLOSED at or before the cursor; and a tactic that STARTS on the cursor's own line wins outright (first tactic on the line stands in) — without it the accent lagged the cursor by a line on calc links/bullets/comments and read as latency. A cursor in a COMMENT resolves to the node whose strip is SHOWING it (read off `TreeNode.commentRanges`, never re-derived; `--` spans are extended to end-of-line first).

The accented node is TRACKED: the view scrolls it into a comfortable band (never from scroll/zoom/fold alone; folded-away nodes skipped until revealed). Vertical centers in both modes; horizontally, wide centers, compact only nudges when the box's LEFT EDGE leaves the band (bringing it to `COMPACT_LEFT` from either side — testing spill instead caused a rightward creep, since a wide box triggered it with its start perfectly visible). **The follow runs on OUR schedule** (`FOLLOW_MS` 130ms ease-out, not `behavior:"smooth"` whose duration the browser owns): in-flight animation cancelled by the next move, jumps longer than a viewport skip the animation, and a `setTimeout` snap backs the rAF loop — a hidden webview fires no frames at all, so without it the follow would never happen there. Clicking the widget BACKGROUND dismisses the accent (node clicks stopPropagation); a cursor move re-arms it — **and so does any REVEAL, through the one door every reveal goes through (`revealAt`/`deferReveal`)**. Two separate failures, one cause: the accent was derived PURELY from `highlightPos`. (1) Re-arming keys on `hlKey` CHANGING, and a reveal onto the position the cursor already holds changes nothing, so after any background dismiss, clicking the very node the cursor sat in left the tree with no accent at all — "highlights only land when you change lines in the buffer". (2) Once re-arming worked, the accent still could not appear until the cursor PHYSICALLY ARRIVED: click → the 300ms double-click window → the popout RPC → the companion's `fs.watch` relay → VS Code sets the selection → a fresh `pos` back to the widget. That chain for a highlight reads as broken, and it was invisible only because case (1) meant no accent appeared at all. **So the accent is LOCAL VIEW STATE that the cursor merely CONFIRMS**: `clickAccent` names the clicked node and wins over the derived value until any `hlKey` change clears it (at which point the position is authoritative again, including when the two disagree). Seeded on TACTICS only — goals never take the cursor accent, and seeding one here is the one way to break that — and remapped on shape change like every other id set. Only the REVEAL still waits out the double-click window (it steals focus into the editor, which is what would cut an in-place edit's opening gesture short); the accent lands on the first click. Measured with a deliberately slow (3s) stubbed relay: accent at 60ms with the cursor still on the PREVIOUS node's position, clean hand-off with no flicker when the real one landed. Both inert in the standalone app. Not recoverable this way: a hypothesis's exact token, and non-root goals having spans of their own — closing that needs an additive `snap.infoTree` walk in our widget, not a parser fork.

**Hovering a tactic lights its source range**: `onHoverTactic` → dwell debounce (`HOVER_DWELL_MS`, 180) → companion paints `editor.wordHighlightBackground` on visible editors. Narrowed at BOTH ends: the widget sends the tight span from `tacticEdits` (raw spans bleed into the next tactic), and the companion's `tightenRange` clamps to the end of the start line minus trailing whitespace (stops a structured tactic lighting its whole block; the only guard for tactics missing from `tacticEdits`). `reveal`/`popout` share the same clamp; **the range's START never moves** (the cursor-at-start invariant above). These two actions are the only chatty relay traffic, so the companion's log skips them. The same hover also washes the hypotheses the tactic USES in the goal box above (`hypLit`/`hypLitGoalId` → `HypBlock.lit`, the ▸ flags read a second time), behind its own longer dwell (`HYP_LIT_DWELL_MS` 350 against the relay's 180, for two compounding reasons: the editor paint lands outside the reader's field of view where firing early costs nothing, while this moves ink inside the box being read past; and it fires on every tactic the pointer CROSSES rather than one being aimed at, so it must clear an INCIDENTAL pause). **The state is cleared in the arming effect's CLEANUP, and that is the whole of it working**: v1 only made a stale value INERT (the derivation honours it while it still equals `hoverId`), which reads identically until you return to a node it already named — `hypLit` was still naming it, so it re-lit with NO dwell, reported as "delay on first touch, instant after". A number tuned against that bug measures the bug: 350 read as instant for that reason alone, 800 then over-corrected, and 350 — the author's ear, once every visit paid the dwell — is where it landed. Measured per visit in the harness (MutationObserver on the first wash rect, timings inflated by the hidden pane's ~1/sec timer throttle): A 1308ms, B 1077ms, A revisited 1270ms — no visit instant. The dwell state is ARMED by an effect and never cleared by one — the house lint refuses the synchronous setState — it EXPIRES by derivation instead (`hypLitGoalId` honours it only while it still equals `hoverId`), so crossing to another node kills the wash at once.

**Native `<title>` tooltips** list ONLY the actions available on the node (plus the ▸ legend where relevant) — never the node's own text, which the box already shows. No actions → no `<title>`. When the tagged label takes a box, the `<title>` retreats to the `<rect>` so it doesn't stack on type tooltips. **That retreat is why the hints alone are not a teaching surface, and the `?` panel exists** (below): in the infoview goal labels and hyps ARE tagged and covered by a `foreignObject`, so the whole vocabulary — ⌘-click reveal, ⌥-click elide, ⌥-click focus, double-click edit, the ▸ legend — survived only on the `NODE_PAD` border, i.e. the dev harness taught the gestures and the shipping widget did not. **The list itself is `nodeHints` (`web/src/gestures.ts`, pure), shared with the panel** — the array was inline in the render loop with the trapped `<title>` as its only consumer; moved out, the panel gets every gesture whose gate is a real predicate and the two cannot describe one gesture differently.

### Label fix-ups applied before anything reads a label

**`rw … at h` keeps its location clause.** Paperproof's prettifier re-synthesises `rw` labels as `s!"rw [{rule}]"`, one step per rule, dropping the location clause — but `rw [h]` and `rw [h] at hn` are DIFFERENT tactics. `collectRwLocations`/`withRwLocation` (ProofTreeComments.lean, both wires) put the clause back the moment the parser returns, before tokens/brief/completion read labels. Found by SYNTAX over the shared `nodesOfKind` roots and by KIND (a `location` node at/after the rule list, so a nested `by … at h` inside a rule can't be mistaken). Two guards keep it idempotent and narrow: only labels in the prettifier's exact shape (`rw [` prefix) are touched, and one already ending with the clause is unchanged — which also protects forms whose quotation doesn't match (`rw (config := …) […]`). Every node of a split multi-rule `rw` gets the same clause. Alignment gets better, not worse (label and source can now be identical); the synthetic closing `rfl` node keeps its head-only alignment.

**A multi-line tactic gets its dropped lines back, and they fall on BOTH SIDES of what the tree draws.** Paperproof's `prettifyTacticString` implements "strip trailing comments/blank lines" as literally *keep the first line* — STRING-level truncation (the step's `position` covers the whole tactic; only the label was cut, which is why single-line nested `by` survived while `rcases … <| by / grind / with ⟨p, hp, hpdvd⟩` lost its `with` clause entirely). `collectTacticTails`/`withTacticTail` (ProofTreeComments.lean, both wires, applied right after the rw pass) restore **the lines before the first line any nested block or alternatives clause BEGINS on (the CONTINUATION), plus the lines strictly after the last line any nested block touches (the TRAILING tail)** — with neither, everything after the first line. ONE per-line test computes both, so a tactic with no nested block cannot collect a line twice. The guards are unchanged and are what keep every deliberate truncation intact: label must EQUAL the slot text's trimmed first line (excluding re-synthesized `rw` labels and split steps), **`calc` is EXCLUDED by KIND, and the exclusion's premise had to be earned back**: it was skipped on the ground that "the chain's links are drawn by the tree itself" — true of links 2..n and of a `by`-justified FIRST link (goal box + tactic node), and FALSE of a term-justified one, which spawned no goal and no step, so the label's first line was its only copy in the whole tree (written `calc` alone on its own line that copy is the bare string `calc`, and the link vanished). It was briefly made a BOUNDARY for that reason — subsequent links bounding the front, trailing region off — and then put back, because the honest fix is a NODE, not a label: `ProofTreeRecover.recoverCalcLinks` (Part D) gives every term-justified link its own goal box and node from the justification's own `expectedType?`, which is strictly more than a restored label (the relation is drawn too, the node is hoverable and editable, and alignment is an identity). With the premise true for every link again, restoring would draw the same text twice — ONE mechanism. Meanwhile a single-statement `have h : P := by / tac / tac` still restores nothing — its block begins on the next line, so the continuation is empty, and runs to the slot's end, so the tail is.

**The trailing-only rule was a HOLE, not a regression, and how it hid is the lesson.** It shipped that way in `f0fef40` (2026-08-11) and was never narrowed since; its own doc promised `have … := by` "restores nothing" and justified that by where the nested block ENDS, which is silent on whether anything was lost before it BEGINS. What was lost there is the STATEMENT'S CONTINUATION — a `have` whose type spans lines drew a binder and a dangling comma (`have gap : ∀ m : ℕ,`), the information sitting on screen twice over in the goal node below and wrong in the tactic box. It is not a tail and no widening of a trailing rule could ever have reached it. **`proofs/odd_sums.lean`'s `have gap` had been exactly that shape since `fc330d0` (2026-07-22), three weeks BEFORE the machinery landed** — so the introducing commit's own check, "all 18 pre-existing corpus proofs byte-identical", certified this non-change as correct. **A rule that restores nothing is invisible to a regen diff**: byte-identity is evidence of safety only for labels you have separately established are already right, and the corpus gap here was that no fixture pinned a multi-line tactic whose lost text preceded its block.

**`altClauseKinds` (`inductionAlts`, `matchAlts`) is the boundary the obvious fix needs, and it was measured, not feared.** "Restore the lines before the first nested BLOCK" is wrong for the case style Mathlib actually writes — `induction n with` / `match n with` over `| zero =>` on its own line puts the first `tacticSeq` on the BODY line, two lines down, so the marker line is pulled into the label, the one thing the old rule's doc promised would never happen (badges carry the markers). `inductionAlts` starts at the `with` (on the head line) and `matchAlts` at the first marker, so either lands the boundary at or before the marker and the whole clause stays out. `first | tac | tac` needs no entry — its alternatives ARE tactic sequences and each marker shares its body's line. Deliberately NOT a boundary: `conv`'s `convSeq` is not a `tacticSeq`, so a multi-line `conv` restores its whole body into the label — pre-existing, unchanged, and left alone.

**The two regions are indented DIFFERENTLY, and that asymmetry is the alignment invariant, not sloppiness.** The continuation goes in VERBATIM; only the trailing tail is dedented by the slot's start column. The continuation is CONTIGUOUS with the head in the source, so leaving it alone makes the label a literal PREFIX of the slot text — `alignInLabel`'s first and best case. Measured on the reported `have gap`: **verbatim aligns 133/133 label characters, dedented 24/129** (the head line and four spaces), i.e. dedenting restores the statement and then draws it with no syntax colour and no per-token hover popups — self-defeating on exactly the text just recovered. The trailing tail has a block cut out above it, so it can never be a prefix whatever the indent, and the dedent (which reads better in the box) costs nothing; testing the trailing region FIRST is what keeps the no-nested-block case byte-identical to before. The visible cost of verbatim is that a continuation keeps the tactic's own start column, reading as a hanging indent under the trimmed head.

**A COMMENT above a nested block's first tactic lands in the continuation, and is removed CLIENT-SIDE — the server-side fix was built and MEASURED not to work.** Bounding the continuation at the block's LEADING TRIVIA instead of its first character looks exact and is not: measured on `proofs/commented.lean`'s `nested_narration`, Lean attributes that comment to the PREVIOUS token's TRAILING trivia, so the block's leading trivia starts on the same line as its canonical range and the two cannot be told apart from the block alone; widening the boundary to include that line then restored the block's own first tactic (`rfl`) into the label, which is worse than the comment. `cleanLabel` already answers it — it scrubs every comment's verbatim text and DROPS interior lines the scrub emptied, a clause written by the same commit as the trailing rule for exactly "a comment that occupied a whole INTERIOR line of a multi-line label", and the continuation is verbatim so the text matches byte for byte. Measured over the regenerated corpus: that `have`'s RENDERED label is unchanged, and of the 27 shared proofs only TWO labels move at all — this one (raw label only) and `odd_sums.lean`'s `have gap` (the fix). Zero non-label step fields change anywhere.

Ripples handled client-side: the plain-SVG label `<text>`s carry `xmlSpace="preserve"` (SVG default whitespace collapsed a restored line's leading indent that `sizeOf` had measured; the tagged path already used `white-space: pre`), and `cleanLabel` drops interior lines EMPTIED by its comment scrub (only when a scrub happened — a blank interior line can't otherwise reach a label). Brief composes free and was re-measured: Rule B elides across newlines, so `rcases … with ⟨…⟩` collapses back to ONE line under ⋯ (`emitKeep` trims `\n` like a space), and E1 takes the restored `have`'s keyword (`… gap : ∀ m : ℕ, / …`) while Rule 1 leaves the statement standing, since its `:=` RHS is `by` — a subtree the tree already folds. `proofs/multiline.lean` now pins five shapes: the trailing tail, the whole-remainder case, the single-statement `have`/`induction` no-ops, the multi-line-type `have` (`head_continuation_before_nested_by`), and the indented-marker `match`/`induction` the naive fix breaks (`alt_markers_stay_out`).

**The recovery parser's steps** (below) get verbatim slot slices as labels, so label ≡ source there.

### In-place tactic editing (widget only)

Double-click swaps a tactic's box for a textarea; Esc cancels, Enter commits single-line (Shift+Enter newline), ⌘/Ctrl-Enter always commits, blur commits, no-op edits just close. Two wire facts force a server seam: `tacticString` is prettified for display, and `position` includes trailing trivia — neither is safe to write back. So the server ships `tacticEdits: Array TacticEdit` (`{start, stop, text}` per step range): verbatim source re-extracted, trailing trivia trimmed with `trimmedEnd` (strips whitespace, then any comment closing at the trimmed end, iterated — so replacing `[start, stop)` can't eat a trailing comment). JS-side: `getTacticEdit` (keyed by `position.start`) gates the affordance; `onEditTactic` commits via `ec.api.applyEdit` (editor's own pipeline: undo stack, re-elaboration); the tree redraws off the next RPC. Commit uses `editingRef` nulled synchronously (Enter unmounts the textarea, whose blur would re-commit from a stale closure). **An EMPTY commit on a replace CANCELS, and never writes `""`** — the rule the `add` and `fill` branches always had and the replace branch did not: ⌘A, Delete, click away wrote an empty string over the tactic's range, bypassing `deleteEdit.ts`'s whole extent model (whole-line vs exact-range, the `prevSameLine` refusal, block-becomes-`sorry`, the comment above) for a gesture that never asked to delete anything. Deliberately NOT rerouted to `onDeleteTactic` either: that turns a slip into an UNARMED destructive write when the armed one is a glyph away in the same bar. What empty MEANS is signalled by a `placeholder` (it shows exactly when the field is empty and costs one attribute) — and it differs by surface, hence two: `empty = cancel` on a tactic, `empty = delete this comment` on a comment, which is deliberate and is the only way to remove one. The textarea also stops going transparent while empty: with a mirror behind it there are no glyphs to paint, and a transparent `color` leaves the placeholder at the mercy of the UA stylesheet. Disabled in the standalone app — though the standalone harness can stub the hooks via `?stub-edit` (App.tsx; writes land in `window.__edits` for probes — ranges and routing only, the document never changes; it also passes the wire's own `deleteSlots`, without which the view's flag verbs, `⊘` and the arming row are unreachable in the harness however much data the record carries — the blind spot that hid the pill's font bug — and `onAddTactic`, added for the same reason: the frontier chips are gated on that hook ALONE and the lane is not even reserved without it, so the harness could not draw a chip at all however complete the record, which hid the whole open-block frontier, a payload whose entire content is one goal and its chips; adds land in `window.__adds`). Editing states clear on a shape change — except the staged calc fill, which rides it out (below). COMMENTS are editable too, as their own `editing.comment` branch — see the comment-strip section.

**Clipboard, asymmetric on purpose**: ⌘A is implemented (`setSelectionRange`, no permission needed). ⌘C/X/V are NOT intercepted — whether they arrive as native clipboard actions in a webview isn't observable up front, and replacing native handling would break paste where the async Clipboard API is unavailable. The keydown clears a flag that `onCopy`/`onCut`/`onPaste` set; on the next tick the fallback fills in from `navigator.clipboard` only if no native event arrived. The fallback writes through `setEditing` (controlled textarea) with the caret restored via `setTimeout`.

**THE OVERLAY'S RECT IS THE BOX'S RECT, and at edit start that is an ARITHMETIC IDENTITY, not a tolerance.** A replace STANDS IN for the box: the textarea's border + padding is exactly the box's own text inset (2 + 10 = `NODE_PAD` across, 2 + 3 = `NODE_PAD_Y` down), so `measureText(draft) + 2 * NODE_PAD` IS `sizeOf`'s width rule and a draft equal to the label measures equal. What broke it was a floor and a slack the box knows nothing about — a 320px minimum and a spare 12px — which belong to the overlays standing in for NO box (the (+) add, the calc stage, a comment strip, whose text is not the node's) and were being applied to the replace as well. Measured in the harness (`?stub-edit`, 1280×720, box `[x,y,w,h]` against overlay): `rw [ih]` box 74.57 wide → overlay **320** (+245.43), `have hsq : (0 : ℝ) ≤ (a - b) ^ 2 := sq_nonneg _` box 363.56 → overlay **375.55** (+11.99) — the reported "gets smaller but wider". After: **0.00 / 0.00 / −0.01 / 0.00** on both, with the first glyph 0.01px across and 0.16px down from the label's (`getExtentOfChar(0)` against the same text laid out in the textarea's own computed styles), both at 12px in the code font with letter-spacing 0 — the page's non-zero default is zeroed on the SVG `<text>` and on the textarea alike. The SVG text's computed `line-height` (26.1px, inherited) reads differently from the textarea's 16px and is INERT: SVG text positions each wrapped line as its own `<text>` at `LINE_H` steps, which is the number the textarea carries. Height follows the DRAFT's line count (`valueLines`, not the original's) and floors at the box's `h`, so a wrapped label whose source is one line keeps the box's height instead of drawing a half-height editor inside the box it replaced, and Shift+Enter grows it. **In NARRATION mode a comment edit stands in for the box too**, at the BOX's metrics (`NODE_FONT_PX` 12 italic, `LINE_H` 16, no 320 floor, no +12 slack, `overlayY = boxTop`) — the prose IS the label there, so applying the strip's `COMMENT_FONT_PX` 11 / `COMMENT_LINE_H` 18 plus the floor and slack drew smaller text in a wider, taller box (measured at zoom 1 on `proofs/commented.lean`'s `nested_narration`: box `[80, 209, 378.01, 26]` → overlay `[79.99, 204, 380.37, 28]`, and a 269.64-wide box → the 320 floor, +50.36; after, dx 0 / dy 0 / dh 0 at 12px/16px, and the same at zoom 1.5623). **The residual is the `-- ` the DRAFT carries and the drawn prose does not** — the verbatim comment source keeps its delimiters, so `max(w, measureText(draft) + 2 * NODE_PAD)` comes out exactly one prefix wider (21.67px, = `measureText("-- ")`, scaling with zoom to 33.87); that is the box's own width rule applied honestly, not slack. The STRIP editor (comment mode `show`, and a goal's strip under `narrate`) keeps the strip's metrics and the floor, verified unchanged. **The harness stub had to be fixed to measure any of this**: `?stub-edit`'s `getTacticEdit` answered a constant `«stub tactic»`, so every geometry check in the preview measured the stub rather than the editor; it now returns the step's own `tacticString`, the way the widget's real `tacticEdits` return verbatim source.

**THE BORDER COINCIDES WITH THE BOX'S STROKE, NOT WITH ITS RECT — the residual shrink, reported from the real infoview and invisible in the harness.** An SVG stroke is CENTRED on the rect edge, and the edited node IS accented (the first click of the double-click seeds `clickAccent`), so the box's drawn outline runs from rect − 1 to rect + 1 at `strokeWidth` 2. Placed exactly on the rect, the overlay's 2px border lay entirely INSIDE that, so the visible outline stepped inward 1px per side on opening — at the reader's tree zoom (2-2.5×, retina) ~10 device px in each dimension, read as the box getting smaller. The `foreignObject` is therefore grown by half a stroke on every side (`EDIT_STROKE` = 2: `x = -w/2 - 1`, `y = overlayY - 1`, `width = fw + 2`, `height = fh + 2`), the border radius is `editRx + EDIT_STROKE/2` so the outer curve coincides too, and the text inset stays an IDENTITY: PADDING ALONE carries it (`NODE_PAD + EDIT_STROKE/2` across, `NODE_PAD_Y + EDIT_STROKE/2` down, from the layer's own edge one half-stroke outside the rect), and the outline is an inset `box-shadow`, NOT a CSS border — see the next paragraph for why. The completion list's `top`/`left` gain the same half-stroke so it lands where it did. Measured (`?stub-edit`, textarea border box against the hidden `<rect>`): **dx −1, dy −1, dw +2, dh +2 on all 15 tactic nodes at zoom 1** (three of them also legitimately wider — the verbatim source is longer than the drawn label), **−1.5625 / −1.5625 / +3.125 / +3.125 at zoom 1.5625**, i.e. exactly the transform; first glyph 0.007px across and 0.16px down from the label's.

**And an overlay standing in for the box wears THE BOX'S FILL** (`nodeBoxFill`, the one coding the `<rect>` itself draws from). `EDIT_BG` is `--vscode-input-background`, which in VS Code is the INPUT background — in a dark theme visibly darker than `--ptw-node-tactic-fill` — so the box changed colour as it "shrank". The harness cannot see this: with no `--vscode-input-background` defined the fallback is `--ptw-surface`, which is what the box is sitting on anyway; the check is to inject a magenta value for that variable and read the textarea's computed background. Overlays standing in for NO box keep `EDIT_BG` — measured with magenta injected: node fill on all 15 tactic replaces and on a narration prose edit, magenta on the (+) add and on all four comment-STRIP edits.

**ZOOM IS NOT A SEPARATE COORDINATE SPACE FOR THE EDITOR, and the report that it was is refuted by measurement.** The overlay is a `<foreignObject>` inside the same transformed `<g>` as the node, and the tree's zoom is the SVG's own `width/height = svg × zoom` against a fixed `viewBox` — so the mirror, the abbreviation underline, the textarea and the completion list are scaled by exactly the transform that scales the box they stand in for. Nothing here multiplies a position or a font size by `zoom`, and nothing may start to. Measured in the harness (`?stub-edit`, `rw [ih]`, box `[w,h]` against overlay): zoom 1 → **74.57×26 / 74.57×26**; zoom 1.25 → **93.22×32.5 / 93.21×32.5**; zoom 1.5625 → **116.52×40.63 / 116.52×40.63**, with the draft laid out in the textarea's OWN computed styles inking 79.03px against the label's 79.00. Swept over every tactic node at 1.5625: **dx, dy, dh all 0.00 on 15 of 15**. An overlay can never be NARROWER or SHORTER than its box — `fw = max(w, …)`, `fh = max(h, …)` — so "the edit box got smaller" cannot be produced here. What the same sweep DOES show is the opposite: where the verbatim source is longer than the drawn label (brief-collapsed, or a prettified `rw`), the overlay is WIDER — +124, +294 and +508px on three of the fifteen — and with the box hidden underneath, a box that grows sideways on a double-click is the size change a reader is most likely to be reporting.

**Render facts**: the overlay renders AFTER the nodes loop (SVG paints in document order); the edited node's box/label/glyph get `visibility: hidden`; the overlay WIDENS live via `measureText` but never below the box's width (textareas scroll to keep the caret visible); an add is one line. **THE OVERLAY'S BORDER BOX IS THE NODE BOX'S DRAWN OUTLINE** — the rect grown by `EDIT_STROKE`/2 on every side (see above), radius `editRx + EDIT_STROKE/2` over the box's own `boxRx` (4 for a tactic, 6 for a goal) — and the editing state is said by the border's COLOUR (`SEQ_STROKE` for a tactic, `PROSE_FILL` for a comment, at the box's 1.5 stroke + 0.5) rather than by a smaller rectangle drawn inside the one it replaces. The height was the whole of the inset: it was the DRAFT's line count (`openLines * LINE_H + 2 * NODE_PAD_Y`), which agrees with the box only when the label was not wrapped and disagrees exactly when it was — a two-line wrapped label whose source is one line drew a half-height editor sitting inside its own box. It is now `max(h, draft lines)`, the `max` being for the opposite case (a brief-collapsed multi-line tactic), where keeping the box's height would hide text. **THE OUTLINE IS PAINT, NEVER LAYOUT: the text inset is padding alone, and the border is an inset `box-shadow`.** It was border + padding (2 + 10 = `NODE_PAD`), which is exact in the harness and WRONG in the infoview, where the text moved a third of a pixel up and left on double-click (reported; at the reader's 2.4× tree zoom a visible nudge). Measured IN THE WEBVIEW with a temporary probe toasting `getBoundingClientRect` of the label's first glyph against the mirror's: `d=(−0.34, −0.34)`, `borderLeftWidth 1.66667px` — **Chrome snaps CSS border widths to whole DEVICE pixels**, and the infoview runs at a fractional ratio (retina 2 × VS Code zoom 1.2 = 2.4, so 2px → 4.8 → 4 device px → 1.667 CSS px), so any inset built from a border loses the rounding on both axes there and only there (the harness is at an integer ratio, where 2px is 2px). Padding is not snapped. So `editOverlayLayer` and the textarea carry `border: 0` with the WHOLE inset as padding (`NODE_PAD + EDIT_STROKE/2`, `NODE_PAD_Y + EDIT_STROKE/2`, measured from the layer edge one half-stroke outside the rect), the textarea paints its outline as `inset 0 0 0 EDIT_STROKE` shadow (paint only, follows the radius, visible over a transparent textarea), and the mirror and abbreviation underline need no outline at all. Re-measured in the webview after: **`d=(−0.01, −0.01)`, padding 13px/6px, border 0**. Every layer must carry the same padding — mirror, underline and the textarea itself — or the caret drifts off the paint. **The way to measure anything in the real infoview is a probe the WIDGET itself toasts** (there is no devtools path at the tool's tier): an effect on `editing` that reads the DOM and calls `showToast`, read off a zoomed screenshot, then stripped — and the worker must be restarted with the rebuilt olean first (check `lean --worker`'s start time against the build). **Its y comes from `bandTopH`, never an inline `caseH + commentBlockH`** — in the aside modes an annotated tactic's strip FLOATS out of the band, so the hand-rolled sum put the editor `commentBlockH/2` BELOW the box it covers (measured on a commented tactic: **+23px in ⊦ spine, +41px in || tracks, 0 in ☰/⑃** — the two modes where `commentFloats` holds), and the comment-edit branch, which subtracts the same `topH` again, was off with it. That is the third site to make this exact mistake (the armed-delete confirm chip, `hoverDiag`'s popup, then this), which is why `bandTopH`'s own doc comment names the trap: **the sum has ONE coding and every render site must read it.** On editable tactics single-click reveal is deferred 300ms and cancelled by dblclick (`deferReveal` — instant reveal steals focus mid-gesture and eats the second click).

**Syntax colouring while typing**: a mirror element behind a see-through textarea (the only way to paint rich text under a real caret). The draft is passed to `renderTaggedTactic` as the label with `value.split("\n")` as lines — `alignInLabel` already tolerates label/source disagreement, so colour comes from the saved source's tokens realigned onto the draft (typing at the end aligns fully; newly typed text is uncoloured until commit — colouring it would cost an RPC per keystroke). **The textarea only goes transparent when there is a mirror to show**; ADD and calc-stage overlays skip the mirror outright (their tokens would be another tactic's). Scroll syncs via DOM walk to `[data-ptw-mirror]` (not a ref — `react-hooks/refs`). **The trap is inherited CSS**: a textarea is insulated by the UA stylesheet, a div is not, so the mirror pins `textAlign`/`textRendering`/`unicodeBidi` (measured: the app root's `text-align: center` put glyphs 68.5px off the caret). The check worth rerunning if touched: computed-style diff between mirror and textarea — a new ancestor rule shows up as text drifting from the caret, not as an error.

**Completion** comes from what's already on screen, no RPC: (1) the consumed goal's `hyps` (`used` first); (2) the goal's subterms walked from the tagged print (`taggedSubterms`, fed through the `getGoalTerms` hook so the view stays source-agnostic); (3) imported tactic names (`ProofTreeData.tacticNames` from `Tactic.Doc.allTacticDocs`, computed once per edit on `proofTreeCache`, attached OUTSIDE the stable-proof signature). Full `idCompletion` over RPC was measured and rejected: 3.8s cold / ~525ms warm, up to 240k items — the lens gives real completion by being a real editor. **(4) GLOBAL names, the one pool the payload cannot carry, over the `ProofTree.completionNames` RPC** — this does NOT reopen that rejection; it is the same probe's priced prefix-scan arm, with every objection answered structurally: `forEligibleDeclsM` with the lazy `kind`/`tags` thunks NEVER forced (the `whnf` per decl is the bulk of `idCompletion`'s cost), truncated to 50 shortest-first server-side, ≥3-char prefix gated at BOTH ends, ~160ms debounce, per-query client cache scoped to ONE overlay (cleared when the edited node changes — imports cannot change under a draft). Measured: cold 1.9-3.7s (core's `getEligibleHeaderDecls` mutex cache, once per file worker), warm 110-230ms offline but ~700ms on a live worker — real, paid once per settled prefix, and the local tiers never wait on it. Scan details that were each measured: the query splits at its LAST dot (fragment vs last component, namespace vs parent) because testing dotted queries against `toString` of 240k names tripled the scan; `isPrivateName`/`isInternalDetail` are skipped explicitly (core's eligibility ADMITS private decls and a `_private.….0.foo` label leaked into the first probe run) but tested only AFTER the prefix hit (ahead of it they 2×'d the scan); matching is case-insensitive prefix (`ciPrefix`, allocation-free), mirroring the client's matcher, not the buffer's subsequence. Client pipeline runs through STATE, not refs (`globalWant` → debounce-by-effect-cleanup → fetch → `globalArrival` → a replay effect re-runs `refreshCompletion` against the textarea's LIVE value via the DOM walk) — a self-recursive ref-reading handler is unprovable to the React compiler and the taint spread to every caller, the abbreviation lesson's sibling. A truncated (=50) cached answer serves only its exact query; a complete one narrows locally. Hook-shaped (`fetchGlobalNames`, the `getGoalTerms` pattern), so the standalone app simply lacks the tier. The hyps tier now applies the `✝` filter too — it was asymmetric for no recorded reason, and a bare `induction n`'s `n✝` was offered into the buffer. The subterm tier is what matters for `calc` (a chain restates its goal at every link; candidate sets are tiny, no ranking needed). **Two matchers** (`completion.ts`, pure): names match the identifier token AROUND the caret (extended forwards too, or mid-word completion leaves the tail); terms match back to the last structural boundary (line start, `:=`, relation) and forward to the next. Terms are offered on EMPTY text (just typed `_ = ` is the moment the feature exists for); names are not. Load-bearing filters: drop anything containing `✝` (won't round-trip into source) and single-token terms (tier 1 covers those). **An EXACT match leads the list and is never filtered** — dropping it left the next candidate selected, so finishing `ring` + Enter inserted `ring1`; it's marked `exact`, making Enter mean COMMIT there. Tactic matches sort shortest-first (`allTacticDocs` order is arbitrary; shortest prefix-match IS the exact one). Traps already hit: the list's `onMouseDown` must `preventDefault` (blur commits and unmounts mid-gesture); the list owns Arrow/Enter/Tab/Escape only while open, ⌘/Ctrl-Enter checked FIRST, Escape dismisses the list before the edit; accepting writes through `setEditing` + `setTimeout` caret. The list's colours are the overlay's own `--ptw-edit-*` palette, NOT `--vscode-editorWidget-*` (light fallbacks made the selected row light-on-light in dark themes). Ordering facts: completion helpers declared AFTER `nodes` (React Compiler bails otherwise); the textarea is passed in explicitly, not read from a ref (`react-hooks/refs` taints every ref-touching call in the handler).

**Unicode abbreviations (`\dvd` → `∣`)** — table and state machine are upstream's `@leanprover/unicode-input` (what vscode-lean4 itself uses; nothing here can drift from the buffer). `web/src/abbreviation.ts` adapts it to the one host upstream never targeted: a CONTROLLED React textarea. `AbbrevSession` owns a SHADOW copy of the draft; **every path that writes `editing.value` (onChange, completion accept, clipboard fallback) must report through `syncAbbrev`**, or a later `flush()` resurrects a stale draft. `sync(value, caret)` is ONE idempotent entry point (event order is not dependable); a moved caret with unchanged value replaces any abbreviation the caret left (the buffer's rule). Settled by running, not reading: `Range.offsetEnd` is upstream's LAST CONTAINED offset, not exclusive (slicing at it kept the last char — `\alp` → `αp`); `run` takes a THUNK, not a promise (an async body runs to its first await — passing the call as an argument rewrote text before the baseline was read, silently losing every replacement); `flush()` is synchronous and must be (commit runs from blur/keydown with nothing to await into — committing `\alpha` must write `α`); React's `onSelect` is not reliably delivered, so caret-leave also rides `onKeyUp`/`onClick`. **Held in STATE, not a ref**: `react-hooks/refs` treats a ref read inside a JSX-called function as render-phase and the taint spreads (bisected); as state it's just a render value nothing compares. The emit finds the textarea by DOM walk (`[data-ptw-edit] textarea`) for the same reason. Pending abbreviations get an underline via a third transparent layer ABOVE the textarea (its background is opaque with no mirror), pinning the same three CSS properties. Tab expands pending, taking priority over the completion list's Tab, falling through when nothing is pending. Settings ride the companion's `theme-colors.json` (`lean4.input.*`; custom translations as an ARRAY for the decode reason below); the TABLE is bundled, so no companion still expands defaults. `ThemeAbbrev.abbreviation` is spelled out because `abbrev` is a Lean keyword.

### Adding tactics from the tree (widget only)

A PENDING goal (no consumer, **reached through `goalsAfter`** — unconsumed SPAWNED goals are not the frontier; upstream emits side goals no tactic consumes on complete proofs; the OPEN BLOCK's root is the one goal that is pending while reached through nothing at all, see the counterfactual section) grows dashed `FrontierChip`s below its box: **`+`** opens an empty overlay hung BELOW the box, commit INSERTS (`onAddTactic`); **`sorry`** stubs the goal in one click, no overlay (colour from `--ptw-tok-sorry`). Two chips rather than a modifier, deliberately: modifiers on tree nodes have a record of silently breaking (see Lens).

Insertion shape is data (`TreeNode.addSpec`) from the producing step: ends in `with` → `| case => ` (checked BEFORE the split rule — a single-case induction still needs its marker); several `goalsAfter` → `· ` bullet; else plain line. **The split test reads `goalsAfter`, never `stepGoalsAfter`** — the latter folds in `spawnedGoals`, so a `have … := by` counted 2 and bulleted its continuation (the reported wrong-indentation bug). **The insertion COLUMN comes from the source** (`TacticEdit.tacticIndent`), because both client-side answers lie: a split step's own `start.character` is the rule inside the brackets, and the bare line indent is the `·`'s column, not the tactic's. `tacticIndentAt` (ProofTreeComments.lean) skips whitespace then a bullet marker (`·`/`.` only before whitespace, so `.foo` dot-notation isn't one) and deliberately does NOT skip a `| case =>` marker (case insertions write their own and want the marker's column). `after` is the last-in-source step among the producer's subtrees (a new bullet lands below written siblings), except a by-body, which stays inside its block. The widget inserts at END OF LINE of the anchor's tight stop (a trailing comment stays glued; the huge character value is clamped by the editor — the widget never holds document text). Multi-line insertions indent continuations past the first line's CONTENT (`indent + prefix.length + 2`) — the bare indent made Lean read the continuation as a sibling. Known v1 limit (recorded in `addSpecFor`): several pending siblings share one anchor, so adding out of source order attaches to the wrong goal. The standalone app passes no `onAddTactic`, so chips never render there.

**The chip lane is RESERVED by the layout**: it hangs below the box, outside the band, so `LayoutNode.chipH` adds `CHIP_TOP_GAP + CHIP_LANE_H` to the node's occupied extent — not to its band (the box must stay pinned at the band's bottom; every edge endpoint measures from there). The lane centres its chips on the incoming trunk lane — **except when the node has a visible CHILD** (`drawnParentIds`), whose connector drops at that very x: a chip drawn ON the goal→child edge read as "insert between these two", while the one gesture offered there (`step` on a stub-consumed link, the repair chip on a half-parsed calc) inserts ABOVE the box. Those lanes shift right of the connector so the edge runs unbroken; pending-leaf chips stay centred. It's an engine option (`chips`) fed from `!!onAddTactic` (unconditional reservation would give the standalone app dead space). The check worth rerunning is a clearance sweep from lane bottom to next band, not a boolean overlap test — the boolean read 0 while lanes visibly collided (it compared against boxes; the collision was with a case badge).

### `calc` chains

A `calc` block is ONE tactic node whose links are its CHILDREN. `TreeNode.chain` (from `/^calc\b/` on the RAW `tacticString` — a label test because the CLI ships no syntax) makes `trunkLayout` skip trunk-resumption so every link indents equally and reads as a column (a real case split keeps resumption). `elide.ts` propagates `chain` from a cut's last constituent onto the marker. **Every link is drawn, whatever justifies it**: a `by`-justified link arrives from the harvest as a spawned goal with the block's tactics under it, and a TERM-justified one — which elaborates no `TacticInfo` and so reaches the harvest as an absence — is synthesized to the identical shape by `ProofTreeRecover.recoverCalcLinks` (Part D of the recovery parser, where the measurements are).

**A chain's SETTLED links draw as one LEDGER node, and the intermediate goals open on demand — the hybrid, arrived at through three attempts that each picked ONE of calc's two readings.** `calc` is the one construct whose source is already a 2-D layout (a formula column with a justification margin) and whose goals are a sliding window over one chain (each LHS restates the previous RHS, one shared context) — so the tree's uniform goal→tactic grammar duplicates on exactly this shape: measured at the ledger's introduction (`72ee248`), 59% of a link box's ink was context block, 43% of those lines byte-identical repeats, 36% of goal text restating the box above. The LEDGER (`ledgerFor`, `TreeNode.ledger`) is the paper reading: the settled links as one node's rows — each row a verbatim SUFFIX of its link goal's printed type, LHS dropped (it is the row above), rendered per row against its own goal through the `goalElision` rewrite so tooltips survive; rows are the longest PREFIX over which RHS_i ≡ LHS_{i+1} holds literally (an unsettled middle link breaks the column honestly); the head row is UNCONDITIONAL and the `calc` node's label is forced to the bare keyword whenever a ledger draws — one rendering however the source line-breaks the head (`calc\n lhs\n rel …` and `calc lhs rel := j` alike; the head expression otherwise smushed onto the node label and the ledger lost its opening row — reported), and the head row's indent gives the relation rows a clean strip to click left of their tooltip spans; the chain's context block rides the ledger ONCE and goals inside the justification subtrees draw only what they ADD (`hypsInheritedFrom`). **Each settled link's justification hangs off the ledger as its own BRANCH, in row order** — a SPINE that re-parented each justification onto the previous link's terminal was tried and removed: it glossed independent spawned goals into a chain the layout walked down deepest-node-first, and it left nowhere for the link's goal box to return. The ledger takes NO trunk child (`trunkLayout`), so compact draws the branches as a uniform column matching the rows and ⑃ wide fans them below — the waterfall. **The Lean reading is the reader's call, per link** (`openLinks`, keyed `` `${ledgerId}#${settledIdx}` `` — the ledger id is a SOURCE position and the index counts settled links, never raw rows, so brief's head row cannot shift the keys): clicking a ledger ROW opens that link's intermediate goal box between the row and its tactic — `visitGoal`'s own emission, which `ledgerParent` was merely skipping — with the full `⊢ LHS rel RHS`, tagged, gestures intact; ⌥-click walks the whole chain; the row keeps a faint fill while open (row ↔ box) and carries a `+`/`−` in its indent gutter — the fold glyph's own vocabulary, there so the rows read as CLICKABLE at rest (reported as unobvious without it; the unconditional head row is what guarantees the gutter exists); the toggle anchors on the LEDGER so what you are reading holds still; closing a row DROPS that goal's fold state (`setCollapsed`), or re-opening brought the goal back folded shut from the previous visit; a CLOSED link's justification carries the same gesture as `+` FIRST in its hover bar (`linkPlus`, joined by `tacticId(row.goalId)` — never positionally — and anchored on the TACTIC, since the goal opens above the box under the pointer; no collision with ◌'s leaf-fold `−` face, which needs a sole-child goal parent the ledger's fan never provides — a bare link tactic carries no ◌ at all, which is also why the bar exists there in the standalone app); the affordance rides the row DIVS on the tagged path and hit-rects on the plain path (a rect would sit over the `foreignObject` and eat its tooltips). The rows stay when a link is open — the duplication is the point: paper reading above, Lean reading below. `chainOpen` (the view's copy) follows the `commentsExpanded` lifecycle, with a bespoke remap translating only the ledger-id PREFIX through `remapIds` (the live-set prune doesn't apply — ledger ids are never step goal ids); ⌥-⊞ clears it, the source's own reading being the ledger alone. An `rw`'s `x = x` residue (`rflResidue`) that closes and leaves nothing is SKIPPED outright — no goal box, no `rw [rfl]` node (it drew folded; reported as adding nothing, since a literal `x = x` states no step) — the literal lhs ≡ rhs print test being what keeps a MEANINGFUL rfl safe: one closing a merely-definitional equality prints two different sides and never matches, and a `rw [rfl]` that somehow left goals still draws folded, resuming the trunk like any last child. `spawnExtra` is suppressed under a ledger so the whole link branch is ONE flat x and opening a row cannot move the tactic (reported as an indent). `?no-ledger` (App.tsx) restores per-link boxes wholesale for comparison.

**Doctrine: every link the tree generates is justified `by sorry`, never `?_`.** A hole is an unsolved goal — an ERROR — so a half-written chain broke the file it was written in; a stub is a warning and a complete term, and `by sorry` (not term `sorry`) arrives as an ordinary editable tactic node. Gestures ask for what they can't infer (`_` is a legitimate answer and the prefill throughout) and end by typing over the stub via the EXISTING in-place editor: `calcEdit`'s `STUB` is the one place the text lives; `fillRange` locates the stub just written (`DocEdit.fillNth` says which — 2 only for the bare-first-step repair, whose completion emits a stub of its own ahead of the link's); the view holds it as `pendingFill`, claimed during render **by SOURCE POSITION and label `sorry`** — never by id (insertions renumber mvarIds), and the label check expires unhonoured requests. A fill overlay's empty commit writes nothing (backing out can't blank a justification). **A leading `by` the author types into a fill is DE-DUPLICATED** (`dedupLeadingBy`, calcEdit.ts): the `by` is already in the document one character left of the box and invisible inside it, so typing `by ring` out of habit wrote `:= by by ring`. Two call sites and no third — the `?_` hole fill (which writes `by <text>` itself) and the stub fill, which is the one seam every chain gesture writes a `STUB` through. It is de-duplication ONLY, never completion: a missing `by` is not supplied, per the standing rule about leaving the author's text unfinished. **`by` is matched as a TOKEN, never a prefix** — `by_cases h : p` is an ordinary tactic and a prefix test turns it into `_cases h : p` — so it must be followed by whitespace AND a non-whitespace remainder; a bare `by` is left alone (the alternative is writing an empty replacement over the `sorry`, which every commit path here already refuses), and it is not recursive, removing exactly the one `by` we were about to add. The plain in-place editor is deliberately NOT a site: it edits a tactic already in the source and prepends nothing.

**Holes a person typed are fully supported** — `hole` (fill it) and `calc-link` (grow above it) chips. `ProofTree.Hole` (ProofTreeComments.lean, both wires) joins two walks — info tree gives goal → hole span, syntax gives link structure — **exactly, by mvarId** (a `?_`'s mvarId IS `GoalInfo.id`), never positionally. Three deliberate details: the calc `_` LHS is a `Term.hole`, not `syntheticHole` (kind filter excludes it); a hole pairs with its SMALLEST containing link; `?_` and a named `?foo` are the SAME syntax kind, so both are collected by the one test. Every hole in the file is now reported, not only the calc ones (see Metavariables) — `inCalc` is what keeps the calc gestures calc-only. `hole` replaces the hole with `by <tactic>` (a real node appears); `calc-link` inserts a whole link ABOVE the hole — the only always-valid growth direction (the hole's goal restates from the new RHS) — offered only when the enclosing step is a `calcStep`, never `calcFirstStep` (distinct syntax kinds, so the gate is free). Links the tree wrote are consumed by their stubs rather than pending, so `addLinkFor` grows those off the consuming `sorry` step (`isStub`), synthesizing the anchor from the stub's line and `CalcChain.indent`; growing above the FIRST link stays refused (`firstStubLine` — wire order is not source order).

**Opening a chain** — the `calc` chip, offered on a pending goal that IS a relation and isn't already a link (chain gestures are mutually exclusive; a goal never carries more than three chips). It asks only for the RELATION (only when there's a choice), then inserts one line through the ordinary insertion path (indent/bullets/markers handled): `calc _ <rel> _ := by sorry`. **Both endpoints `_` is the point**: Lean unifies them against the goal, so nothing pretty-printed lands in source (the standing round-trip risk). **The line goes in FIRST; the ends are filled afterwards, one prompt each** (`calcStage` in ProofTreeView, `calcOpenText`/`calcOpenSlots` in calcEdit) — insert-first keeps every intermediate state a valid file; Escape leaves the `_`s standing. Both prompts prefill `_` SELECTED, so the whole gesture is pick, Enter, Enter, type the tactic; a stage whose value is still `_` writes NOTHING (the Enter-Enter path touches the document exactly once, for the insertion). A writing stage shifts later same-line ranges by the length difference. **A stage's blur is a NO-OP — the fix for the reported "there is no option to enter the LHS".** The overlay textarea's blur commits a replace/add (click away = done), and routing a stage through that walked BOTH prompts to `_` before the author ever saw them: the real infoview reflows (and moves focus) the moment the insertion's own re-elaboration lands, so its stray blurs consumed the stages instantly. A stage is a walk, not a click-away editor: blur leaves it open and untouched; the deliberate ways out are Escape (the textarea's own keydown when focused; the document listener's second layer when a stray blur left it unfocused) and a background click (the scroll container's handler — which is why `[data-ptw-edit]` stops click propagation, or clicking into the stage's own textarea would bubble there and self-close it). **The preview harness fires no native focus transitions (the recorded gap), which is exactly why this survived verification** — reproduce focus bugs by dispatching synthetic `blur`/`focusout`, and treat any overlay that stays open across a real re-elaboration as needing that attack. Other load-bearing details: `calcStage` survives the shape-change reset (the redraw it rides out is its own insertion's) and its node is re-resolved by SOURCE POSITION (tactic starting on the link's line, falling back to one containing it — accepting `synthetic` nodes so a stage inside an unparsed block re-attaches); the abbreviation session and completion list are keyed by `editKey` = node id + STAGE — keyed on the id alone, the LHS's shadow draft survived the transition and committing the RHS flushed it over the top; the textarea is KEYED by stage (so `autoFocus` re-fires) but not by node id (the re-anchor rewrites it — remounting would lose the draft); the prefill selection runs on `setTimeout` (React's `autoFocus` fires before delegated listeners are live; rAF unavailable hidden); slot table (`calcLinkSlots`) is computed STRUCTURALLY, never by searching for `_` (a relation symbol may contain one); `calcLinkText` is shared by open and the `calc-first` repair (one slot calculation serves both); `offsetToPosition` (factored from `fillRange`) turns slots into absolute ranges in widget.tsx; stages fold newlines to spaces; an EMPTY stage commit means `_` — it advances, Escape is how you back out; `PLACEHOLDER` (calcEdit) and `CLOSE_RHS` (ProofTreeView) are two `"_"` constants that must agree (`selectPlaceholder` only selects on exact match, so drift kills the prefill silently).

**A one-link `calc` DOES parse — the rule is about what FOLLOWS.** From the grammar (`Init/NotationExtra.lean`; re-verified 6/6 on v4.32.2): `calcSteps`' second `withPosition` saves its `colGe` anchor ONCE, at the first token after the last written link, so with one link the guard is vacuous, the parser tries the follower as a TERM, and `manyAux` fails hard if that consumed anything. Clean before EOF/`| case =>`/the next `theorem`; breaks before a sibling `·` bullet, a dedented tactic, or a bare tactic word (tactic heads lex as identifiers). All six cases elaborated, 6/6 with the prediction. So opening mid-structure transiently breaks the parse until the second link — ACCEPTED, per explicit user directive (recorded below): it's the state hand-writing passes through, the tree draws it (synthesized node + repair chip), and writing a link the author didn't choose is the worse failure.

**A stepping relation cannot take `_` for its RHS** (`calc _ ≤ _` under `⊢ a < d` → `don't know how to synthesize placeholder` — an intermediate RHS is pinned by nothing). Prefill stays `_`; `calcStage.closes` carries whether the picked relation is the goal's own, and the right-side hint reads "this link steps, so name where it goes" instead of "Enter keeps `_`".

**Closing a hand-written chain** — a chain stopped short leaves a `calc.step` residue in the step's `goalsAfter`, an ordinary pending goal drawn at the chain's bottom, badged. `addLinkFor` offers **calc-append** there: one new last link `_ <rel> _ := by sorry` (the `_`s close the residue against the chain), overlay prefilled `_` for the RHS. Relation read off the RESIDUE's own type via `spineRelation` (the composite relation, not any link's). Anchor is `CalcChain` (ProofTreeComments.lean, keyed by the calc's own start = the residue's step position, no mvarId needed); it carries the final link's end (insert after end-of-LINE, comments stay glued) and **the column READ from the SECOND link** — the one the chain proves parses (calc+2 is a convention, and a link one column shallower is silently not part of the chain); falls back to calc+2 for one-link chains.

**A `calc` with no subsequent step and no valid first link doesn't parse and swallows what follows** — the first thing to check when a calc "disappears" (the tree now draws the state rather than going silent). The trigger is the missing SUBSEQUENT step, not the missing relation. `CalcBlock` drops links carrying `Syntax.missing` AND links the parser invented from the follower (Lean's own layout rule is the filter: a later-line link must be indented past the `calc` — `hasMissing` alone does NOT reject an invented link, whose range covers a neighbouring tactic verbatim); `broken = hasMissing || links.isEmpty`; **`CalcChain.stop` is the last well-formed link, never the block's syntax range** (which runs into the swallowed tactic — the client hands `stop` to the cursor accent and the edit range). `calcBlocks` descends SYNTAX via `nodesOfKind` (every `TacticInfo`'s stx plus, widget-side, `snap.stx`), so a calc that never elaborated still reports, with `links` count, verbatim `text`, and `firstBare`.

**The repair chip rides the `calc` node** — a real step's node when the block half-elaborated, else a SYNTHESIZED one (`calc:<line>:<col>` id, label = verbatim `chain.text`, `chain`+`synthetic`, position `[tacticStart, stop)`), emitted before `visitGoal`'s `!step` return so DFS preorder holds; never the goal above (that placed a chip pointing at nothing, and double-offered the edit). `combineRuns` blocks synthetic nodes. **It IS editable** — the one `tacticEdits` entry built from something other than a step, and it doesn't violate the never-fabricate invariant: the range is measured, `text` is the server's verbatim slice, and the label IS that text, so alignment is an identity. `getProofTree` emits one per broken chain whose start isn't in the steps loop's `seen` set — exactly the client's synthesize condition; keep the two pointing at each other. **Repair splits three ways on `firstBare`**: justified first link → `calc-append`; BARE first step → completed with ` := by sorry` AND given a subsequent link in one edit (the one form writing two justifications; `fillNth` 2); bare `calc` keyword → `calc-first`, one link both ends `_`, walked by the staged fill. `calc a = b :=` (links 0, not bare) stays visibility-only — the author is mid-keystroke and there is no honest edit. Appending `_ ≤ _` after a BARE first step without completing it reads as `(a ≤ b) ≤ _` and fails `Trans` — measured, hence the completion.

**Which goal a broken block hangs off** (`brokenChainByGoal`): with a step, that step's `goalBefore` (found by containment of the block's start, innermost first — the step may be labelled with the enclosing bullet); with none, the pending goal whose producer sits closest above. **Half-open containment keeps the second case out of the first** (the producer above a bare calc has a trivia-inflated range ending exactly AT the calc's start). The repair chip is thus offered on a goal that need not be pending (`addLink` computed outside the `pending` gate); on a broken block the other chips are SUPPRESSED (`+`/`sorry` would insert above an unparsed block).

**Relations are PICKED from the real `Trans` instances** — `calcRelationsFor` (ProofTreeComments.lean, both wires; plain symbols, no refs): `getCalcRelation?` for T, `SynthInstance.getInstances` on `Trans ?r ?s T` with both inputs open, per candidate `isDefEq` + verify with `trySynthInstance` (`mkCalcTrans`'s own test); pairs still carrying mvars dropped (discards the wildcard `[IsTrans α r]` instance). **The gate is that T chains with ITSELF**: `Trans Eq r r`/`Trans r Eq r` hold for ANY relation, so "some pair verified" accepts `∨`; requiring `(T,T)` is name-free and is the assumption a chain ending on the goal's relation already makes. Dedupe by first relation, `(T,T)` first. Three bugs only findable by running it: **`getCalcRelation?` needs a `consumeMData`'d type** (a `have`'s continuation goal arrives wrapped in `mdata noImplicitLambda`; the decomposition sees an `.mdata` head and answers 0 — declined the chip exactly where one most wants it); `ctx.runMetaM {}` has an empty local context → `mvarId.withContext`; an instance may state its relation as a LAMBDA (core's `Nat.instTransLe`) → `headBeta` before the 3-token arity check that keeps a symbol WRITABLE (correctly declines `Nat.ModEq`). Enumeration runs only for genuinely pending relation goals (`calcRelationGoals`, whose rule is VERBATIM the client's — `goalsAfter` only, plus the broken-block owner; keep the two comments pointing at each other, drift = chips silently vanishing), riding `proofTreeCache`. Empty `options` is a positive "not chainable"; NO entry means the wire didn't ship it, and only then `spineRelation` stands in (conservative: relation-ish tokens at bracket depth 0, fire only when exactly one and chainable — bias toward offering, a false positive costs an undoable edit). The sweep worth rerunning if touched: enumerate for EVERY corpus goal and diff server vs heuristic (the only known disagreements are `≠`, honest — you can't chain `≠`).

**The picker is the chip lane, expanded**: clicking `calc`/`step` with >1 option replaces the lane with one ghost chip per relation plus `×`; ONE option goes straight through (keeps the common `=`-only case at one click). Picking clones the spec with `rel`. Widths are MEASURED (`FrontierChip` takes `fontFamily` — measureText uses the editor font, the chip must paint it too). `picking` holds ranges, so it is dismissed everywhere `editing` is, especially the `shapeKey` reset. **NO gesture here ever inserts more than one line — user directive, arrived at through two corrections** (a closing second link finished the chain in a relation the author hadn't chosen; then "one-link calc doesn't parse" was disproven by counterexample and the directive given: never more than one line, ask LHS and RHS separately, never put the author's expression mid-double-relation). Do not re-litigate.

### Lean diagnostics on the tree (`web/src/diagnostics.ts` + ribbon/pill, widget only)

**The source is the `getProofTree` payload itself** (`ProofTreeData.diagnostics`, from `doc.collectCurrentDiagnostics` — the mutex-guarded state the publish path serves; on v4.27 this was the bare `doc.diagnosticsRef`, replaced in v4.32 by `DiagnosticsState` under `diagnosticsMutex`, sticky ++ per-version), arrived at through TWO wrong sources worth remembering: the `publishDiagnostics` notification is EDGE-triggered and a webview subscribes after load, so a server restart on a small file finished elaborating first and the feature drew nothing ("works while I watch it"); and **`snap.msgLog` is EMPTY on the live server** — the file worker rebuilds compat snapshots with `messages` already drained into the reporting stream (`mkCmdSnaps`) — while the CLI's `IO.processCommands` populates it normally, so every offline probe blesses the broken source. What settled it: **driving the real server over LSP from a script** (initialize → didOpen → wait for `$/lean/fileProgress` empty → `$/lean/rpc/connect` → `$/lean/rpc/call`) — the recipe whenever the widget path disagrees with offline probes. The probe must initialise with `initializationOptions: { hasWidgets: true }` as vscode-lean4 does, and the message string must come from `d.toDiagnostic.message`, never `d.message.stripTags` (in widget mode embed text lives inside `MsgEmbed` and `stripTags` returns `""`); `toDiagnostic`'s `prettyTt` keeps the multi-line goal state of `unsolved goals`. The reporter fills the ref asynchronously, so the diagnostics COUNT is the fourth `proofTreeCache` key component. `getInteractiveDiagnostics` RPC was checked and rejected: same ref, buys only message tags at the cost of a round trip per burst plus ref lifetimes — worth having eventually as a separate on-demand fetch, not what the ribbon draws from.

Rules settled by measurement: **`proofSpan` prefers the DECLARATION's range** (`declaration uses 'sorry'` is reported on the name, above every tactic); **`UnsolvedGoals` is NOT dropped in the filter** (an unfinished induction branch arrives spawned, draws 0 chips, and dropping the tag lost the only signal) — it's dropped in `attachDiagnostics`, on a PROOF-level does-any-chip-exist test; **the pending-goal fallback matches by LINE, not position** (a failing tactic has no node; the goal's position routinely sits right of the diagnostic on the same line). The anchor is `range.start` throughout — forced: `range.end` is truncated to `{line+1, col 0}` for multi-line messages. A null span keeps everything (a proof whose first tactic fails harvests no steps — exactly when diagnostics are all there is). Attaching resolves against `engine.allNodes()`, not visible ones (a folded-away error is the one the pager exists for). Module is pure so a probe drives the real filter offline.

**Two surfaces, reserving NOTHING** (an error overlay must not make proofs lay out differently). Ribbon: the box's left edge thickened in the worst severity's ink (`--ptw-danger`/`--ptw-warn` — the editor's own colours), a full-height rect CLIPPED to the box's rounded rect (inherits the corner radius exactly, which a path could not — `boxRx` is now one shared constant); clipPath id keyed by LAYOUT INDEX, not node id (ids carry characters illegal in `url(#…)`); drawn inside `NODE_PAD`. Selected = wider (4→8), never dimmer. **The message is read by hovering the ribbon** via an invisible `NODE_PAD`-wide hit strip (`cursor: help`) — load-bearing: on tagged nodes the box `<title>` is covered by the label's `<foreignObject>`, so the message was in the DOM and nowhere on screen. It shows a CUSTOM popup (`hoverDiag`), not `<title>`, for the two things a native tooltip can't do: appear NOW and style content; `pointer-events: none` throughout; the PILL's exact background/ink pair (the `--ptw-*`-over-light-fallback pairing is the recorded light-on-light trap). The strip never stops propagation. **`DiagnosticPill`**: top-left, stacked with the hints at `FLOATER_H` pitch, one diagnostic at a time (the tree is already the list) with a `‹ n/m ›` pager. Stepping and navigating are one gesture: `‹`/`›` unfold what hides the target, page the gallery to it, scroll it into view; clicking the message goes to the current one in tree AND source (the lens-aware `onReveal`; a diagnostic's range is the shape it takes, the `tacticEdits` lookup falls through to the raw range) — what gives NODE-LESS diagnostics a working click. Selection held by KEY (position + message), never index, so it survives re-elaboration with no clamp effects. The scroll is DEFERRED, guarded by a ref written in its effect, consumed on the seek object's identity; a node outside the current layout (a focus or path scope) leaves the request unspent. `inViewScroll`/`animateScroll` are factored out of the cursor-follow (one answer to "where must scroll sit", one place for the compact/wide asymmetry). The pill was bottom-left and invisible — the widget frame used to end below the fold; `useFrameOffset` (widget.tsx) now sets `max(MIN_FRAME_PX, calc(100vh − measured offset))`, settled by 1px hysteresis. **The offset is the root's top in VIEWPORT coordinates, and the bug worth recording is that it used to add `window.scrollY`** — i.e. it reported the root's position in the DOCUMENT. The two agree only at scroll 0 and only while nothing above the tree has moved, and in the real infoview neither holds: the blocks above the widget resize on every cursor move and the page scrolls, so `100vh − documentTop` sized the frame for a layout the panel no longer had and the frame's bottom — with the status card 8px inside it — ended up UNDER the "Restart File" lane (reported as the card sitting at the very bottom of the panel). The listeners follow from the same fact and each covers a hole the others do not: a ResizeObserver on `document.body` sees nothing when a section ABOVE grows inside a body of fixed height (so the root's parent is observed too), `window`'s own `scroll` never fires for an INNER scroller (so the scroll listener is registered in the CAPTURE phase, where every scroll in the document passes), and a no-dep `useLayoutEffect` re-measures after every render — one `getBoundingClientRect`, and the widget re-renders on each payload and cursor move, which is exactly when the blocks above it have moved. RO delivery rides rendering steps, hence the explicit mount measure. **THE FRAME TAKES ALL THE ROOM THERE IS — the fraction AND the clearance are both gone.** The height is `max(MIN_FRAME_PX, calc(100vh − offset))`, with no bottom rule left in it at all. The FRACTION (0.9) went first: with the tree flowing UNDER the status card rather than reserving room for it, it was only ever spending height nothing needed. The CLEARANCE (`FRAME_BOTTOM_CLEAR_PX` 44) has now followed it, for the same fact stated the other way round — it cost 44px of tree at EVERY panel size to keep two pieces of OUR OWN chrome off one button of the host's. **The lane that button owns is real and is still dodged, but by PLACEMENT** — `LANE_INSET` 10 / `LANE_BTN_H` 26 / `LANE_BTN_W` 100 / `LANE_GAP` 8 in ProofTreeView, ONE coding read by the card's `bottom`/`height`/`max-width`, by the rail's `bottom`, and by `fit`'s idea of how much width the words have. The button is `position: fixed; bottom: 10px; right: 10px` in vscode-lean4's own `index.css` over a webview-ui-toolkit button whose shadow-root CSS is `line-height: 22px; padding: 1px 13px; border-width: 1px` — 26px tall, and **~100px** wide (`measureText("Restart File")` is 68.3px in the macOS UI font at 13px and 66.5 in Segoe, plus 26 of padding and 2 of border; the older "~104" was an estimate), so it hangs over the bottom right of the VIEWPORT whatever the page scrolls to. **The status card now sits IN that lane** (`left: 8; bottom: 10; height: 26`, `max-width: calc(100% − 126px)`), so card and button read as one row of chrome; **the zoom rail moved UP above the button** (`right: 8; bottom: 44` = 10 + 26 + 8). Measured in the harness at a 594px frame: the frame's bottom is level with the viewport's (**0px**, where it used to stop 44 short), card and button share `top: 764 / bottom: 790` exactly, the rail's bottom lands **8px** above the button's top, and no pair of the three intersects. That is +44px of tree at every panel height. The earlier worry — that a frame ending exactly at the fold leaves nowhere to scroll the infoview page from, since the tree's own scroll container swallows the wheel — is answered by the button's own lane, which is real page and takes a wheel perfectly well. **There is no longer a SETTING for it either.** `ramify.tallFrame` selected a second fraction (0.93 against 0.9) and was REMOVED end to end when the clearance landed (companion `package.json` + `publishThemeColors`, `ThemeColors.tallFrame` and its `FromJson` line, `Settings.tallFrame`, `FRAME_FRACTION_TALL`); `FRAME_FRACTION` has now followed it, so the height has ONE number in it. An old `theme-colors.json` still carrying the key decodes exactly as before — the hand-written `FromJson` ignores what it is not asked for, which is the same property that let the key be ADDED without breaking an old companion. The one case placement cannot reach is `MIN_FRAME_PX` winning (room < 240), where the frame keeps its floor and the card's own `max-width` is the remaining guard. Kept as CSS units rather than resolved to px in JS: a webview hidden while the panel is resized fires neither observer nor resize handler, and a px height would stay wrong until something else moved — `100vh` stays live whatever we know, and only the measured top is ours. **THE HOST IMPOSES NO CAP, and that was read off the shipped bundle rather than assumed** — on a report of the frame ending at ~60% of the panel with the `Messages` header directly under the bar. `InfoDisplayContent` renders a panel widget through `PanelWidgetDisplay`/`DynamicComponent`, NEITHER of which adds a DOM element, so the whole chain above `[data-ptw-root]` is `div.ma1 > details[open] > div.ml1` (plus a `<details>` of the host's own only when the widget carries a `name`, which a ProofWidgets Component never does — the reason our own `<details>` exists). Every one of those is an auto-height block box with no `height`, `max-height`, `overflow` or `flex`; `@leanprover/infoview`'s stylesheet has NO `.infoview` selector at all, its only `max-height` is the tooltip's (set from JS by floating-ui), `html, body { height: 100% }` clips nothing because neither sets `overflow`, and `#react_root` has no rule anywhere. So there is nothing to override from `useSectionOrderCss`, and the two remaining mechanisms are ours: `height` is a HYPOTHETICAL size for a flex item, and the one flex container in the chain is the section-order rule's own (`div.ml1`, turned into a column purely to reorder it), where a default `flex-shrink: 1` plus the frame's `overflow: hidden` (which sets its automatic minimum size to 0) would let the tree be squeezed by whatever else the card carries. Both are now shut: `flex: 0 0 auto` on the ordered item, and `min-height` beside `height` on the frame itself — a min-height is not shrinkable. NEITHER was reproducible outside VS Code (the harness measures the frame at its full `calc` at every width), so these are the MECHANISM REMOVED, not a measured bug fixed; if a short frame survives them the remaining suspect is the user's own `lean4.infoViewStyle`, which vscode-lean4 concatenates into the webview's stylesheet verbatim. Standalone app: no `diagnostics` prop, neither surface.

### Metavariables

Three unrelated things arrive under this name, and each has its own rule.

**Holes the author wrote** (`?_`, `?foo`) ride `ProofTree.Hole` on BOTH wires — every hole in the file, not just the calc ones, which is what lets the client say anything at all about a `refine` hole. What it does with each is decided by two flags, not by what is reported. **`inCalc`** gates growing a link ABOVE the hole (only inside a chain does the hole's goal restate from the new RHS). **`inBlock`** gates filling IN PLACE, and it is narrower than "is a hole" on purpose: where a sibling tactic can be written it is the better edit — `refine ⟨?_, ?_⟩` + `· exact h` is what one writes by hand, where filling in place gives `refine ⟨by exact h, ?_⟩`, legal and worse. The two cases with nowhere to append are exactly the ones in-place editing exists for: a `calc` link, and a hole in a term-mode proof. All 18 corpus holes are `inBlock`, so this preserved existing behaviour byte-for-byte. `ownerStart` is the calc link when `inCalc`, else the enclosing `TacticSlot` (which is where the client's indent comes from). A named `?foo` written twice reuses ONE mvar, so it yields two records sharing a `goalId` — all but the source-earliest are marked `dup`, because a goal-keyed client would otherwise silently keep the last and fill at the wrong span. The fill chip is glyphed **`?_`**, not `+`: "add a tactic" and "fill this hole" are different gestures, and only the FIRST chip's width varies so the lane's origin is unchanged.

**Metavariables inside a printed goal** are almost always an artifact of WHEN the goal was printed, not of the proof. Paperproof prints a step's goals with that step's own `mctxAfter`, so anything a later tactic assigns is still open there: `apply Nat.le_trans` puts `⊢ a ≤ ?m` in `allGoals` of a COMPLETE proof, while the `exact h1` that consumes the goal prints `⊢ a ≤ 5`. **The fix needed no new wire data** — the resolved print is already on the wire, in the consuming step. `goalIndex` (proofToTree.ts) keeps the print with the fewest `mvarOccurrences`, ties keeping the first offered (`allGoals`), so nothing changes except where a metavariable is actually eliminated. Measured: of 179 goals printed both ways, **2 differ and both differences are exactly a resolved metavariable** — zero other differences. `mvarOccurrences` is mirrored in ProofTreeComments.lean and the two **must agree**: `collectTaggedGoals` picks the tagged print the same way, and a disagreement is not an error but SILENCE — the text-equality guard drops the goal to plain SVG, losing type tooltips exactly where a metavariable makes them worth most. It sees every `TacticInfo` while the wire carries only Paperproof's steps, so it is additionally handed `wanted`, the very string the client will draw, and prefers an exact match; fewest-metavariables is only the fallback. The `?` test is a `?` that both STARTS a token and is followed by an identifier char — neither half alone works, since `Option.get?` ends with one. **The TACTIC DIFF (see Interactive subterm tooltips) is subordinate to this rule, not a second answer to it**: the diff rides the producer's candidate, which scores identically to its undiffed twin, so this rule keeps deciding what text is drawn and the only price of losing here is a goal that ships untagged (measured: the resolved-metavariable case is the ONLY thing that costs a goal its tags — 98/98 tagged elsewhere on the Mathlib scratch file).

**A genuinely open metavariable cannot occur in a clean file.** Lean refuses to finish a command with an unassigned natural mvar, and `apply` promotes an undetermined one to a goal of its OWN (`⊢ Nat`, tagged `m`) — so this state is an `unsolved goals` ERROR, never a `sorry` warning, and the fixture for it lives in `ProofTreeScratch.lean` rather than `proofs/`. The consequence for any future work here: **the open metavariable IS already a node in the tree**, so the useful thing is to link the goals that mention `?m` to that node, not to badge goals in isolation. Not implemented.

**Delayed assignment is real and universal for `induction`.** `getUnassignedGoals` treats `mctx.dAssignment` as assigned, so those goals never reach the wire; the visible effect is that an `induction` step has EMPTY `goalsAfter` and its branches arrive spawned (11/177 corpus steps show the signature: induction 6, calc 3, exact 2 — same 11 on v4.27 and v4.32.2). That is why an unfinished induction branch draws no frontier chips. Left as it is.

### The recovery parser (`lean/ProofTreeRecover.lean`)

Draws what Paperproof structurally cannot: failed tactics, term-mode proofs, and `calc` links justified by a term. A FAILED tactic is an undetectable absence upstream — `evalTactic`'s handler restores the info tree and `closeUsingOrAdmit` may assign `sorryAx`, so a proof whose only tactic failed harvested zero steps AND zero goals: the tree vanished exactly when most needed. Design decision: it **emits Result-shaped data** — real `ProofStep`s/`GoalInfo`s merged the moment the parser returns, both wires, so all downstream machinery works with no client changes (`diagnostics.ts` needed zero: a recovered node's position is the slot's range). Synthetic-ness rides the sidecar `recovered: [{start, kind: "failed"|"skipped"|"term"}]`, emitted only when nonempty (keeps the complete corpus byte-identical through `gen.sh`).

**Part A, failures**: a slot (from `tacticSlots`) is covered iff some step STARTS inside it, half-open; uncovered filtered to outermost, minus broken-calc slots (they have their own machinery). **Uncovered alone is NOT failed** (`skip` records no step either) — classification is gated on an ERROR landing in the slot (CLI: frontend `messages`; widget: `doc.collectCurrentDiagnostics` — NOT `snap.msgLog`, the mkCmdSnaps trap again: this gate was silently dead in the widget until the diagnostics work drove the real server). Later uncovered slots in the block are `skipped`, chained under ghost goals (`goal_<line>_<col>` — underscores because `Name.mkSimple "goal:12:2"` serializes with guillemets; each restates its predecessor, correctly — the failure changed nothing). The attacked goal: a pending goal nearest above, else an INVISIBLE one from raw `TacticInfo.goalsBefore/goalsAfter` (unconsumed, unproduced — what a failure orphans), printed with the vendored `printGoalInfo` and **grafted into the `spawnedGoals` of the step whose SLOT contains the failed slot** — slots, not step ranges (an `induction … with` step's range is truncated at its first case marker, so step-range containment misses its own branches; hit and fixed by measurement). Labels are verbatim slot slices, so recovered steps are editable and align as identities. Client: `failed` = dashed + `DANGER_FILL`, `skipped` = dashed + comment-muted; `combineRuns` blocks recovered nodes; `lensGoals` filters failed/skipped steps at the widget call site.

**Part B, term proofs**: gated on `theorem`/`example` with non-`byTactic` body — NOT on `steps.isEmpty` (a term proof with nested `by` blocks harvests steps, rooted nowhere). v1 vocabulary maps term structure onto the same step shape: `have` → have-like (decomposed by KIND — the decl child is a `letDecl` behind a `letConfig`; shape unchanged on v4.32.2, 13/13 term recoveries); `let` → have without side goal; `fun` → intro-like; a nested `by` block contributes NO synthesized goal — its REAL root `GoalInfo` stands in (the `TacticInfo` whose stx is the `byTactic` node, preferring the harvest's own print so the mvarId join is byte-exact); term-level `calc` (kind ``Lean.calc``, distinct from ``calcTactic``) and `match` are v1 leaves; other terms are leaves whose nested `by` roots ride `spawnedGoals`. Goals from `TermInfo.expectedType?` + `lctx` via `synthGoal` (the one justified duplication of `printGoalInfo`'s loop — that keys on an mvar decl a term node doesn't have). Consequence: ppharness emits every tree, so the widget's "no proof here" now means genuinely none — not "your only tactic failed".

**Part D, a `calc` link justified by a TERM** (`recoverCalcLinks`): `_ = (c+b)+a := Nat.add_comm a (c+b)` elaborates no `TacticInfo`, so the harvest returns neither a goal nor a step for it — a four-link chain came back with **three spawned goals**, and neither the link's relation nor the lemma proving it was drawn anywhere (measured; independent of WHERE the link sits). The goal needs no re-elaboration: the justification has a `TermInfo` whose `expectedType?` IS the link's relation, with the link's own `lctx` — Part B's `synthGoal` seam exactly — matched to the justification by SYNTAX RANGE (never nearest-position, never by mvar), so a nested chain cannot claim an outer link's proof. So the link gets the ordinary pair: the goal grafts into the `calc` step's `spawnedGoals`, and one node under it labelled with the VERBATIM justification (label ≡ source, `alignInLabel` an identity). `tacticDependsOn` is Paperproof's own recipe with the one substitution forced on it — `findHypsUsedByTactic` reads the mvar ASSIGNMENT and a term assigns none, but the expression it would have instantiated is `TermInfo.expr` itself — without which the box is empty under the DEFAULT `used` breadth. Two gates, both conservative: the block must not be BROKEN (that state has its own synthesized node and repair chip), and **no harvested step may START inside the justification** — the completeness witness, not a syntax test on `byTactic`, so it stands down wherever the tree already draws something. Links are found through `CalcBlock.links`, which now carries each link's `stx` and its justification (`CalcLink`, found by KIND — the last argument past the `:=` atom over the flattened children, one rule for `calcFirstStep`'s optional group and `calcStep`'s flat shape alike). `Recovery.apply` grafts **every** match for a position, not the first: a chain with two term links grafts two goals onto the one `calc` step (measured, four in a row).

Three seams move with it. **The multi-line label restoration excludes `calc` again** (`collectTacticTails`): it had been extended to restore a term-justified FIRST link into the label, because that line was the link's only copy anywhere; with Part D the copy is a node, so restoring it too would draw the same text twice — ONE mechanism, and the node is the better one (it draws the relation as well, and it is hoverable and editable). Brief's Rule D goes back to covering the calc line to its end, and Rule A stands down on nothing. **`chainLhsElisions` now MATCHES around a term link** where it used to degrade: the link's goal is a real sibling RHS, so the link after it elides its LHS to `_` exactly as the source writes it (verified in the preview). **Delete DECLINES on a `"term"`-recovered node** (`deleteSpecFor`): it stands for no `TacticSlot`, and `deleteExtent` resolves an anchor to the SMALLEST containing slot — which for a calc link is the whole block, so the one destructive gesture would have taken the entire chain under the link's own label. Term-MODE steps declined by accident before (a proof with no `by` has no slots at all, which stops being true the moment one is nested inside it); now both decline on purpose. Measured over the corpus: 0 other tactic nodes lost a `deleteSpec`.

**Part C, the open block** (`recoverOpenBlock`): `:= by` with nothing written into it. The odd one out — it synthesizes NO step, only the goal the block owes plus where a first tactic goes (`OpenBlock`), because the whole point is that there is no tactic to draw a box for. It therefore SUSPENDS the empty early-out rather than feeding it, and rides `ProofTreeData.openBlock` instead of `recovered`. Gated on a `theorem`/`example` whose body IS a `byTactic` (the exact complement of Part B's gate, so the two can never both fire) with `tacticSlots` EMPTY — slots, not `steps.isEmpty`, since a proof whose only tactic failed also has no steps and is Part A's. Full reasoning and the measurements are in the counterfactual section, which this replaces for that state; `proofs/openblock.lean` is the fixture.

### Popout editing — the lens (widget + companion)

A tactic's hover bar carries `⧉` — deliberately NOT a modifier gesture: ⇧-double-click silently broke because ⇧-click is selection-extension in the webview (the second click never lands as dblclick). **Do not re-introduce a modifier here.** Gated on `onPopoutEdit` ALONE (the lens only needs a range; missing `tacticEdits` entries fall back to the trivia-inflated `position`). Tactic bars hang off the box's RIGHT edge (one-line boxes; the goals' corner placement would collide above); **both placements overlap the box by `BAR_OVERLAP` — load-bearing**: hover is tracked on the node's `<g>`, so any gap fires `mouseleave` and the bar dodges the mouse. The companion also registers `ramify.openLens` in the command palette — the isolation test when the tree's button misbehaves.

The lens is a slim editor group split directly below the infoview's group: the real buffer, tactic's tight range selected, scrolled to sit `LENS_TOP_FRACTION` down via `revealAtFraction` (no reveal-at-fraction API exists; it reveals a line that far above, `AtTop`, height from `visibleRanges`, clamping degenerate readings; runs ONCE — the group is resized before the document is shown in it, so it measures the height the lens keeps). Same window, same document, same server — vim/LSP/keybindings apply, zero re-elaboration. This REPLACED a floating auxiliary-window design that fought VS Code on every front (focus lands only visually ~10% of the time, no window-geometry API, macOS-only osascript…) — if tempted to resurrect floats, reread that history; a second full VS Code window is worse still (own server, unsaved edits don't sync).

**The relay**: the infoview's `EditorApi` has no `executeCommand`, and both webview bridges FAIL (vscode-lean4's `showDocument` silently drops non-file URIs; a synthetic `vscode://` click NAVIGATES the webview blank) — so widget → `ProofTree.popoutEdit` RPC → server writes `~/.proof-tree-companion/popout-request.json` → companion `fs.watch`. A nonce dedupes duplicate watch events; ownership = `getWorkspaceFolder` OR this window has the doc open (a folderless file would otherwise be dropped in silence). **The relay is invisible by construction, so both ends log**: the companion writes every request/skip/failure to the "Ramify Companion" Output channel; widget.tsx routes all companion calls through `callCompanion`, surfacing rejections in an inline banner. When a gesture "does nothing", read the Output channel FIRST — it distinguishes never-arrived / arrived-and-skipped / arrived-and-threw.

Mechanics: find the infoview group by webview tab, focus via positional `focusNthEditorGroup`, then `workbench.action.newGroupBelow` (NOT `splitEditorDown` — it would duplicate the webview), open the doc. **The lens takes `LENS_HEIGHT_SHARE` (1/3) of the infoview column, in ONE atomic `vscode.setEditorLayout` call** — the split's own default is half and half, which is not a slim strip of buffer. That command is the size knob the old run of `decreaseViewHeight` nudges was groping for; the nudges are still REMOVED, but the reason is no longer the animation (the resize animates too, and the user accepts that — the open still stutters with them long gone, so they were never the whole of it): a single call STATES the proportion instead of stepping toward it, and it can run on the group before the document is opened into it. **Order is load-bearing — resize the EMPTY group, THEN `showInLens`** — and that ordering is what buys back the second `revealAtFraction` pass: the nudges resized after the text was placed, so the first reveal measured a pane twice its eventual height. Three facts about the command, read off the running VS Code (1.132) and not assumed: sizes are **RELATIVE units**, neither pixels nor fractions (the deserializer sums each branch and scales to the container, so any consistent unit works and MIXING them does not — `getEditorLayout` hands back pixels, so `sizeLens` rescales within the branch's own total rather than writing 0.33 into a tree measured in hundreds); a layout with **FEWER leaves than there are groups MERGES the extras**, silently, so the tree that goes back is the tree that came out with one branch's sizes rewritten — never a synthesised `{groups:[{},{}]}`; and it applies to the active editor part and restores focus to the active group, which at that moment is the lens. The layout carries no group identity, so `locateLayoutLeaf` joins it to a viewColumn by ORDER (leaves in DFS order are the groups in grid-appearance order, which is what viewColumn numbers). **Nothing is captured for restore on close, and the obvious "put the old layout back" is a TRAP** — by then the group count may differ and the merge rule above would eat the user's groups. Only sizes WITHIN the infoview/lens branch are touched, never the branch's own size in the root axis, so when the lens closes the branch dissolves and its sibling reclaims exactly what it had. Sizing runs on CREATE only: a reused lens may be at a height the user dragged it to. The lens is REUSED via a three-step ladder in `findLensColumn` — a remembered `viewColumn` goes stale two ways (window reload restores layout but clears memory; viewColumns renumber when any group closes): (1) remembered column revalidated by the doc; (2) our tag — `lineNumbers: Off` is a per-editor option nothing else sets (doesn't survive reload); (3) any second group showing the document. The close listener re-resolves by the tag before restoring chrome (a vanished column number is not a closed lens). `stripEditorChrome` sets — GLOBALLY, there is no per-group settings API — `workbench.editor.showTabs: "none"`, breadcrumbs/minimap/stickyScroll off while a lens is open, restored on close (sticky scroll matters: it pins the enclosing theorem line and re-renders as the cursor moves — the jitter you feel typing). Originals are PID-stamped to `~/.proof-tree-companion/chrome-backup.json` (crash restore, dead-owner only); a second window adopts the first's originals. **PER-EDITOR vs GLOBAL is the question that keeps coming back, so here is the whole answer, re-measured against the RUNNING VS Code (1.132) in both `vscode.d.ts` and the extension host's own options object: `TextEditorOptions` is EXACTLY tabSize/indentSize/insertSpaces/cursorStyle/lineNumbers and `ExtHostTextEditorOptions` exposes those five accessors and nothing else.** So of the editor's left margin — what a user calls "the gutter" — **line numbers are per-editor** (off in the lens alone, and the lens's own identifying tag), while **the glyph margin and the folding controls are global-only**; tabs, breadcrumbs, minimap and sticky scroll are global-only too. No proposed API adds any of them, and a per-LANGUAGE scope (`"[lean4]": …`) is no help here because it would hit the main buffer, the very editor being protected. **Two settings have now been thrown out of the strip set for the one reason**, and it is the rule: *do not buy the lens anything at the cost of the text the reader is actually looking at.* `editor.fontSize` went first (it resized every editor in every window to buy four lines). **`editor.glyphMargin` has now gone the same way** — it is the breakpoint lane, i.e. the gutter, so opening a lens narrowed the left margin of every editor everywhere and the text jumped sideways (reported: the gutter disappearing is jarring). The lens keeps the lane; that costs it ~20px of WIDTH, which is what `lensWordWrap` is for, and no height at all. `restoreEditorChrome` iterates the SNAPSHOT's keys, not `STRIP_KEYS`, so old backups still restore both — which is also what un-strips a glyph margin left off by an older companion. On font size specifically there is no salvage either: smuggling it through decoration CSS paints smaller glyphs but hit-testing stays on the configured grid and line height doesn't change. `wrapLens` (`toggleWordWrap` — a per-editor SESSION toggle, unlike the setting) buys width back: only while the lens is ACTIVE, before the reveal, throws caught; `lensWrapped` guards the toggle's re-flip and an already-wrapping editor is skipped. Setting `ramify.lensWordWrap`, default on. **`foldToCursor` (foldAll + unfoldRecursively at the cursor) is REMOVED** with the shrink, and for the same reason: it collapsed and re-expanded the whole file on every popout, which is the other half of the reported shaking, and it bought vertical room the lens no longer needs to scrounge for. `editor.folding` stays out of the strip — now simply because the user's own folding is theirs and the gutter costs nothing at `lineNumbers: Off`. After changing the companion's `package.json`, a full VS Code restart may be needed; `extension.js` changes need only a window reload.

**Inline goal states in the lens** (`lensGoals.ts`, the `annotate` action): `⊢ …` drawn at each tactic's last line end as an `after` decoration — Alectryon-style, costing no lines. Computed client-side, passed through `popoutEdit`'s `annotations` field. LENS ONLY (the main buffer has the infoview). Three rules settled by measuring: the line must be the TIGHT stop from `tacticEdits` (raw stops put every annotation one tactic late — systematic off-by-one reading as plausible nonsense); **`∎` means BOTH `goalsAfter` and `spawnedGoals` empty** (keying `goalsAfter` alone marked every `induction … with` closed — backwards; and NOT `stepGoalsAfter`, which would label a `have` with its block's goal); several steps share a line → last in SOURCE order wins. Companion drops annotations on the first document change; the widget re-sends when its proof changes, gated on having opened a lens at least once. Lines past the document end are DROPPED, not clamped (a goal on the wrong line is worse than one missing).

**Tree primacy in the infoview column**: the info card renders its blocks as siblings and the ones above the widget resize on every cursor move. No section-order API — but the widget shares the webview document, so `useSectionOrderCss` injects a `:has()`-scoped stylesheet making the hosting body a flex column with the tree (`[data-ptw-root]`, set on tree root AND placeholder so the slot never flips) ordered first; the infoview's `<details>` summary around panel widgets is display-none'd. Selectors scoped entirely on `[data-ptw-root]`.

**The panel folds like a native section, and the disclosure is OURS.** The infoview wraps a widget in `<details><summary>{name}</summary>` only when `PanelWidgetInstance.name?` is set, and core fills that field for the DEPRECATED `UserWidgetDefinition` form alone (`getWidgets` filters on `·.type.isConstOf UserWidgetDefinition`) — a ProofWidgets `Component` never has one, so that wrapper does not exist for us and the summary rule above is purely defensive. `widget.tsx` renders its own `<details open={panelOpen}>` + `<summary className="mv2 pointer">Proof tree</summary>` (the infoview's own classes, so it reads as a sibling of "Tactic state"), toggled via `onToggle` so the keyboard path is the pointer path. Three things are load-bearing: **collapsing must not UNMOUNT** (fold/zoom/scroll/focus/elide state lives in `ProofTreeView`, and `<details>` hides without removing); **`data-ptw-root` sits on the WRAPPER, outside the `<details>`**, so the `:has()` rules keep matching while collapsed (anchored on the content they would stop matching and the collapsed section would drop back among the volatile blocks); and **`rootRef` goes INSIDE, below the summary**, or the frame overhangs the fold by the disclosure line's height. The section-order rule must never be widened to `details > summary` — that would hide this fold. **`useFrameOffset` skips measuring a collapsed panel, and needs BOTH tests** because Chromium changed how a closed `<details>` hides content and a webview can be either vintage: older puts `display: none` on the children (no client rects, every rect 0), current skips them via `::details-content`'s `content-visibility: hidden`, which keeps STALE boxes — measured while closed and contributing nothing to layout: `getClientRects().length` 1, `top` 47, `height` 400, with only `checkVisibility()` returning false. A 0 there is the absence of an answer, not an offset, and writing it flashes a full-viewport tree on expand. Skipping is non-regressive: `offset` starts at 0, which is exactly what a no-box measurement would have written.

### Interactive subterm tooltips (widget only)

Goal labels and context-line types get the infoview's own per-subterm type popups: core `Widget.goalToInteractive` → `CodeWithInfos` server-side (`collectTaggedGoals`, an additive `snap.infoTree` walk keyed by mvarId string = `GoalInfo.id`; ships as `taggedGoals`, forcing `Server.RpcEncodable` — tags hold live `WithRpcRef`s, hence never in NDJSON), `InteractiveCode` client-side via the `renderTaggedGoal`/`renderTaggedHyps` hooks (`taggedRender.tsx`); the view swaps `<text>` for a `<foreignObject>` in identical line geometry. **Three invariants make it safe**: text equality (a tagged line is used only if its stripped text equals the measured string; mismatch falls back to plain SVG per node/line); no second wrapping (`taggedText.ts` slices the `TaggedText` tree at the layout's own break offsets, duplicating tags that span one; lines are `white-space: pre`); font normalization (`.ptw-tagged .font-code { font: inherit }` — `InteractiveCode` wraps in `.font-code`, styled to the editor's font, which would disagree with the measured box). Hover popups keep native styling (portalled to `document.body`).

**TACTIC DIFF — what the producing tactic changed, highlighted (widget only).** The infoview's own goal view background-highlights the subterm a tactic rewrote and the hypothesis it introduced; the tree gets the same, from the same code. Server-side it is ONE call, `Lean.Widget.diffInteractiveGoals true ti batch` in `diffedGoalsAfter`, following `RequestHandling.getInteractiveGoals`' recipe verbatim (print under the context, run the diff under `mctxAfter`, swallow failures). The finer `diffInteractiveGoal`/`exprDiff`/`addDiffTags` were considered and are **not reachable**: `Lean/Widget/Diff.lean` is a `module` and marks only `diffInteractiveGoals` `public` (measured — `#check` on the other three is an unknown identifier on v4.32.2). That settles a judgement call in the direction it was already leaning: the whole-`TacticInfo` entry point owns the goal PAIRING (a `parentMap` from `getMVars` over `goalsBefore`) and the `showTacticDiff` option gate, neither reproducible without guessing. Client-side it is nearly FREE — `InteractiveCode` already maps `SubexprInfo.diffStatus` onto the infoview's `inserted-text`/`removed-text` classes.

**`useAfter := true`, always, and the diff RIDES the existing candidate rather than competing with it.** Our tree draws each goal ONCE as a node, so the reading it wants is "what did the tactic that PRODUCED me change" — the `goalsAfter` side; the `will*` half of the vocabulary is never generated here. A diffed print is byte-identical to its undiffed twin under `stripTags`, so it scores exactly the same and the fewest-`mvarOccurrences` rule above still decides WHAT text ships — the diff only decides whether that text carries tags. Where the producer's print LOSES the score to a consuming tactic's (the resolved-metavariable case), the goal ships untagged: silence, as everywhere here. **Measured agreement (producer's print won, so the tags shipped): 98/98 on `ProofTreeScratch.lean` (Mathlib, 16 collector runs), 11/11 on `ProofTreeTour.lean`, 11/12 on a purpose-built fixture** — the one loss being `apply Nat.le_trans`, i.e. exactly the case the score rule exists for. **The text-equality guard held over 3334 tagged goals with 0 mismatches** — that is THE regression test, since a diff tag that changed `stripTags` by one character would drop the goal to plain SVG. Cost: the collector is +25ms over 16 runs on the Mathlib file (157ms → 182ms), worst single proof +22ms (78 → 100ms on 38 goals), paid once per `proofTreeCache` MISS, i.e. once per edit. `needDiff` keeps the existing score-0 early-out, so a settled goal never pays `exprDiff` again.

**What it does NOT cover, and why that is not a bug to chase**: a goal that reaches the tree without ever sitting in some `TacticInfo`'s `goalsAfter`. `induction`'s branches are the standing example — delayed assignment empties its `goalsAfter` (see Metavariables) — so a `case succ` ROOT goal ships untagged while every goal inside the branch is diffed normally. Root goals likewise have nothing to diff against. Fidelity was checked against core's own `getInteractiveGoals` at every cursor ON the producing tactic, matching by mvarId and comparing spans + inserted-hypothesis names: **8/10 on the fixture, 38/46 on the Tour**, and every difference is one shape — a `rw`'s final `x = x` state, where `rw` is a macro (`rewrite …; with_reducible rfl`) so every cursor in its span resolves to the trailing `rfl`, a tactic that changes nothing; ours is the diff against the rewrite, which is what the node stands for. Split-`rw` INTERMEDIATE goals have no comparison at all: the tree draws them, the infoview never shows them.

**The hypothesis-NAME mark is core's flag REFINED, not core's flag copied.** `InteractiveHypothesisBundle.isInserted?` is per BUNDLE, and the infoview draws a bundle as one line (`ih h : k + 0 = 0 + k`) where we draw one line per hypothesis — so taking the flag straight highlights `ih` because `h` was bundled with it, a claim about a line the editor never made. `taggedRender` therefore gates on the flag (never marking what the editor would not) and refines it by the PRODUCER's own context (`producerCtx`, the step's `goalBefore.hyps` fvarIds): a name is marked only when its fvarId was not already in scope. Measured on the user's own example, `have h : k + 0 = 0 + k := ih` marks `h` alone; `intro hp hq` marks `hp` then `hp hq`. The context-breadth machinery's `new` was considered as the source and REJECTED: it would mark a hypothesis `rw … at h` mutated in place (same name, new fvarId), which core answers with a TYPE diff instead — a strictly better answer that the tagged type already carries. With no producer on the wire the bundle flag stands unrefined, which is the editor's answer.

**The one geometry trap, and it is real.** The infoview's base rule is safe (background + radius, no padding, no margin) but its high-contrast variant is `border: thin solid`, and a border on an inline span ADDS INLINE ADVANCE — measured in the harness: 121.211px against a plain 119.211px, +2px per highlighted subterm, on exactly the themes that need the signal most. `TAGGED_CSS` drops the border and re-draws it as an INSET `box-shadow`, which paints in the same place and occupies none. The selectors are `.ptw-tagged span.inserted-text`, **`span.` deliberately**: the rule being undone is `.vscode-high-contrast .inserted-text`, the same specificity as the classes-only form, which would leave the winner decided by sheet order — ours is injected at mount, the infoview's is static, so we win today and would silently stop winning if that changed (the element is a `<span>` in both paths — `InteractiveCode` renders one, and so does the name mark). Colour comes from `var(--vscode-diffEditor-*TextBackground, var(--ptw-diff-ins/del))`: in any VS Code host the editor's own colour, so the tree paints what the infoview paints; elsewhere a weak (22%) `--ptw` recipe mixed against `--ptw-surface`, not `--ptw-bg`, because it lands inside a node box (the `--ptw-prose` lesson). **This feature cannot be seen in the preview harness at all** — `taggedGoals` never rides NDJSON — so the LSP probe is the only gate; the harness can verify the CSS's geometry and nothing else.

The same injected sheet fixes **popup flicker** — the infoview renders a popup's loading state as a bare text node, so it popped up as `Loading..` and resized under the pointer; `.tooltip:has(.tooltip-code-content):not(:has(.tooltip-code-content > *))` is exactly "content hasn't arrived", held 150ms then revealed anyway. Applied ONLY in that state on purpose: the resolved popup gets `animation: none`, so a failure to animate (hidden documents don't advance CSS animations) can't strand a populated popup invisible. It also drops a popup's **empty type line** (core's `makePopup` fills neither field for a `TacticInfo`, and the ` : ` separator is unconditional): `.tooltip-code-content > .font-code.pre-wrap:not(:has(> *))` plus its trailing `<hr>`. These are the only selectors not scoped to `[data-ptw-root]` (the popups portal outside our subtree), confined to code-content tooltips.

### Syntax colouring of tactic labels (widget only)

Server-side, the very pair the editor's semanticTokens request uses — `collectSyntaxBasedSemanticTokens` ++ `collectInfoBasedSemanticTokens` through `computeAbsoluteLspSemanticTokens`/`handleOverlappingSemanticTokens` — so a token means what it means in the editor; no Lean lexer in JS. **Constants get no token upstream** (info-based emits only fvars and projections) and the lean4 TextMate grammar has NO identifier rule (checked — a qualified constant in the buffer is PLAIN foreground), so painting ours blue made the tree disagree with the editor. `collectConstIdentTokens` fills the gap **for the POPUP, not the paint**: tokens reclassified at the wire to `"const"` (`wireTokenType`), which the client leaves unmapped — inherits the label foreground, popup intact. All three collectors merge in `semanticTokensFor`; tokens ride `TacticEdit.tokens` (they index into that entry's verbatim `text`).

**Two invariants** (`tacticTokens.tsx`): colour only, never geometry; and **the LABEL is the coordinate space**. Tokens carry document positions into the step's verbatim source, but wrapped lines were measured from the LABEL, and `tacticString` disagrees with source three ways (label is a prefix of source; source is a prefix of the label — merged binders; source EMBEDDED in the label — re-synthesised `rw`). **A split step is widened back to its surface tactic server-side** (`surfaceTacticRange`): the smallest `TacticInfo` containing the step's TIGHT range (`trimmedEnd` — trivia inflation otherwise pushes the closing `rfl` past its owner) and starting strictly before it, subject to two conditions that are only sufficient together — its first token must equal the step LABEL's first token, and it must start on the step's own LINE (nested `have … := by have` defeats the token test alone). **Do not reach for `tacticIndentAt` here** — it deliberately doesn't skip `| case =>` markers, so on `| succ d hd => rw […]` it anchored on the `|` and nothing widened (the bug survived a probe that only covered `| zero => rfl`, where not widening is correct). `TacticEdit.stepStart` keeps the client's key on the step. `lineOffsets` runs EXACT against the label; `alignInLabel` returns the SEGMENTS where label and source agree character-for-character, and clipping to segment ends is load-bearing, not defensive (past a segment the label has `]` where the source has `,`). A list, not one window, because widening makes two segments the common case (`rw [` head + the rule wherever it sits). Any failure → plain SVG text.

**A word the PRETTIFIER minted indexes into no source, and alignment can never reach it — hence the second coordinate space, `TacticEdit.labelTokens`** (`LabelToken`: `labelAt` in UTF-16 units, the `text` it claims, a token type and a plain `doc`). The one producer is the `rfl` of a `rw [rfl]` node. `rw` is a macro — ``(rewrite …; with_annotate_state $rbrak (try (with_reducible rfl)))``, `$rbrak` being the closing `]` — and Paperproof harvests that annotated state as a step, sees its source slice is `"]"`, and re-synthesises the label as `rw [rfl]`; so the box draws a word the buffer does not contain, `semanticTokensFor` has nothing to collect for it, and `alignInLabel` correctly claims only the shared `rw [` head. Reported as "`rfl` gets no tooltip while the other tokens do", and it is 7 of the corpus's 204 tactic nodes. **The cause is NOT the empty-popup gate and NOT a missing `tokenInfos` entry** — measured: at the `]` byte the only info node of that width is a `TacticInfo` elaborated by `evalWithAnnotateState`, exactly the node `hoverEligible` excludes (mirroring core), and the macro's expansion contributes NO canonical range at all, so there is no `rfl` info node anywhere to reference. **Pointing the label's `rfl` at the `]`'s own hover would have been worse than silence**: `textDocument/hover` there answers with the `rwRuleSeq` parser docstring ("A `rwRuleSeq` is a list of `rwRule` in brackets"), which is about the brackets, not the tactic the label names. What ships is the environment's docstring for ``Lean.Parser.Tactic.tacticRfl``, the declaration the macro actually runs — a lookup, not a fabrication, byte-identical to what the buffer shows on a `rfl` you wrote yourself (measured both ways over LSP), through the existing `doc` render path (`DocTokenSpan`) at the token type a literal `rfl` carries (`keyword`, measured off `semanticTokens/full`). The GATE is the SOURCE SLICE, not the label — a step whose own tight text is a lone `]` is the annotated-state step by construction, which is what keeps a hand-written `rw [rfl]` (whose `rfl` is a real rule with a real token, slice `rfl`) from ever matching — plus the prettifier's exact output on top, `startsWith` because the location clause is put back before anything reads a label. Client-side these need no alignment (they are already in the space everything else is mapped INTO) but they DO take the same KEEP-map shift as every other span, and the guard is TEXT EQUALITY against the label the offsets were measured in — the tagged-label discipline, and the only thing between a later label fix-up and a span colouring someone else's characters. Measured after: payload ships exactly one label token on the closing-rfl step and none on any other (Tour 2/2, Mathlib scratch 3/3, `rw … at *` and a literal `rfl` node 0, 0 mismatches over 25 proofs); driving the real `renderTacticTokens` gives `rw` + plain `[rfl]` before and a `cursor: help` doc span after, with a deliberately shifted label dropping it. The corpus regenerates byte-identical — `tacticEdits` never rode the CLI wire, so this is invisible offline and the LSP probe is the only gate.

The probe worth rerunning if touched: bundle `proofToTree` + `alignInLabel` with esbuild (`--alias:@leanprover/infoview=…`), reconstruct each step's source from `position` replicating `trimmedEnd` (a plain trim makes trailing-comment cases look like failures), assert agreement over every returned segment.

**Colours resolve from the user's ACTUAL theme, the long way round** — a webview cannot (re-verified: `ColorTheme` exposes only `kind`; no CSS variable carries TextMate token colours; syntax highlighting ships as pre-coloured HTML). The COMPANION resolves it (`workbench.colorTheme` → contributing extension → theme JSON, following the `include` chain) and writes `~/.proof-tree-companion/theme-colors.json`; `ProofTree.themeColors` reads it back — the relay's only return path, and deliberately its own RPC (the `getProofTree` payload is keyed on `(uri, version, cmd start)`, which a theme switch doesn't invalidate). Client refreshes on the existing MutationObserver + a 400ms second read (the companion's write races). **The file is also the only channel for a VS Code SETTING** — it carries `editor.bracketPairColorization.enabled`, `ramify.outlineOnly`, `ramify.linkTint`, `ramify.linkMarks`, `ramify.typingHoldMs` (the wire's one NUMBER; the companion writes it raw and the CLIENT owns default + clamp, so a bad value degrades in one place) and `ramify.counterfactual` (default TRUE like linkMarks; the client passes it back per `getProofTree` call, since the decision is server-side but settings ride this channel) — which forces: refetch also rides `docRev` and webview refocus (a setting moves no CSS variable), and **`ThemeColors`' `FromJson` is HAND-WRITTEN** because the derived one errors on missing keys instead of defaulting — with the two ends shipping separately, an old `theme-colors.json` failed to decode outright and the user lost the whole palette over one absent flag. Every field optional; wrong-typed values default field-wise (re-checked for the link settings — present→true, absent→false with the palette intact, wrong-typed→false — and again for `linkMarks`, whose default is the other way: absent→TRUE with the palette intact, present false→false, wrong-typed→true; and again for `typingHoldMs` — absent→600 with the palette intact, present→the value, wrong-typed/negative→600, since `Nat`'s own `FromJson` rejects both and `jsonField` defaults the rejection). The companion's config listener watches the whole `ramify` SECTION (`affectsConfiguration("ramify")`) as well as the theme/customisation keys and `lean4.input` — the per-key list it replaced had to be fed by hand for every new setting, and a key left out shipped a setting that only took effect at the next theme change (the recorded failure mode); lens-only settings republishing is one harmless file write.

**The scope map is VS Code's OWN documented default table** (semantic token type → TextMate scope), not hand-picked — with semanticHighlighting on, the buffer resolves through exactly this table, so anything else guarantees divergence (the first version guessed `variable.other` and `keyword.control`; both wrong — Catppuccin painted fvars via a shell-env-variable rule). TextMate precedence applies within lookups; the closest-sub-scope pass survives only as last resort. **What Lean's tokens don't cover was measured**: core emits only keyword/variable/property/function (+`leanSorryLike`), and the syntax collector skips non-identifier atoms. The three gaps are NOT the same case: **numerals** — the editor colours via the grammar's `constant.numeric.lean4`; we have no grammar, so `collectNumberTokens` fills it (`.original` atoms only). **Operators** — no grammar rule EITHER; unscoped in the buffer too, so `TOKEN_SCOPES` deliberately has no `operator` entry (emitting ours would move AWAY from the buffer). **Brackets** — coloured by bracket-pair colourisation, a separate depth-cycling mechanism; `bracketDepths` (tacticTokens.tsx) reproduces it on runs no token claimed, with a STACK not a counter (an unmatched closer stays uncoloured rather than dragging the line down a level); the six colours ARE exposed as `--vscode-editorBracketHighlight-foregroundN` (registry entries, unlike token colours) — only the on/off setting needs the file. User overrides (`tokenColorCustomizations`, flat and `[Theme]`-scoped) append last. With real theme colours the 72% softening (below) is NOT applied — that exists for vendor palettes calibrated against their own backgrounds. No companion / old server → built-in palette.

### Per-token hover popups (widget only)

**A token whose popup would be EMPTY ships no payload at all** — third state, and the one the other two used to fall through to. `tokenInfoAt` consulted `popupNonempty` only to settle a contest between an info node and a parser docstring; with no docstring in the running there was no contest, so a resolving-but-empty info node minted a ref anyway and the popup opened as an empty bordered box under the pointer (reported on the signature header). The gate is now the second half of the same test: no doc, empty popup ⇒ `none`, which leaves the token coloured and silent — and silent is what the BUFFER does there too, by the same emptiness reached the same way. Measured by asking `infoToInteractive` for every shipped ref, the way the client's own popup does: **exactly one per proof, the `theorem` keyword itself** (198 refs on `sum_range_odd`, 121 on `calc_workout`), and after the gate 0 empty with the counts down by exactly one and the doc tokens untouched; a sweep of `ProofTreeTour.lean` finds 0 in 108. Cost is nil — `popupNonempty` answers term-like nodes with no lookup at all, so only the rare non-term node pays its two.

`tokenInfos : Array TacticTokenInfo` — per token EXACTLY ONE of two payloads, decided the way `handleHover` decides it. The INFO path: a `.tag` wrapping the token's **source text**, carrying the `InfoWithCtx` the editor's hover would use; `InteractiveCode` resolves it through the same RPC as the editor's hover, so the popup is native and the drawn text is byte-identical to what layout measured. EVERY token is offered, not just identifiers — `hoverEligible` mirrors `InfoTree.hoverableInfoAt?`'s test, and `makePopup` ends with `docString?`, so tactic keywords get their documentation. **But that only works when the innermost node's syntax kind carries the docstring — false for `by`**, whose innermost info node is a 2-byte bare ATOM (`findDocString?` on the kind-name `by` is nothing; the doc sits on `Lean.Parser.Term.byTactic`, one node up). Hence the PARSER-DOCSTRING path (`parserDocAt` — `handleHover`'s other half, never previously copied): the syntax stack over the token, innermost node kind with a docstring wins, and the plain STRING ships as `TacticTokenInfo.doc` iff it exists AND (the info popup would be empty — `popupNonempty`, two env lookups, no pretty-print — OR the doc node's range does not `.includes` the info node's: the second is why the buffer shows `by`'s doc inside `have … := by`, whose innermost eligible node is the whole `have`). Client: a doc token renders a PLAIN coloured span + custom portal popup (`DocTokenSpan`, docTip.tsx — the `hoverDiag` precedent, its own file for react-refresh), never `InteractiveCode`, whose tag popup is the empty/wrong one being replaced. Probe: 32/32 in-universe tokens match a `handleHover` replication (the 2 misses are `theorem`, outside every `TacticEdit` span). Cost control: the tree is walked ONCE per request into a `HoverIndex` (sorted starts + prefix-max-of-stop; `innermost` binary-searches then scans back until the running max stop clears the query); one RPC ref per distinct info NODE, not per token. **`innermost` breaks width TIES by tree DEPTH, deepest first** — `hoverableInfoAt?` lets a descendant's result beat every ancestor outright, and ranges legitimately tie: `by simp` puts `tacticSeq`, `tacticSeq1Indented` and `simp` on the SAME four bytes (measured), and the flat width-min was handing `simp`'s hover to a wrapper whose popup is empty. `collectHoverItems` is the depth-carrying clone of `foldInfo`'s traversal (same `mergeIntoOuter?`/`updateContext?`). **`proofTreeCache` caching the ref-carrying halves is SAFE and looks wrong**: a ref's id is minted once, but session registration happens at response-ENCODE time (`rpcStoreRef` runs while serialising into whichever session made the request), so reconnected sessions re-register cached refs; the document VERSION gates staleness and is in the key. The handler early-outs to empty before all enrichment when the parse yields no steps (the cursor is outside a proof most of the time). Note `WithRpcRef.mk`, not `⟨_⟩` — the constructor is private. **`tokenInfos` is a FLAT list keyed by absolute position and must stay that way**: tactic ranges NEST, so splitting per-tactic by containment resolves tokens to ancestors and the owner renders none (measured: 53/86 lost). The server dedupes `tokenInfos` by position while each `TacticEdit.tokens` stays complete (colouring is per tactic). Both `taggedGoals` and `tokenInfos` are excluded from the stable-proof signature (refs are freshly allocated every call). Offline diagnosis: a scratch file running `IO.processCommands` over a CORE-ONLY source yields real `InfoTree`s (Mathlib needs the interpreter flags `lake env lean --run` can't give); `mkHoverIndex`/`semanticTokensFor` are deliberately not `private` so probes can drive them. Two sweeps that found real bugs: comparing `HoverIndex.innermost` against upstream at every byte offset, and dumping every token with its resolved info node (what exposed the constant gap).

### Brief mode (the reading menu's `brief`) — within-tactic elision

Collapses boilerplate WITHIN a label to `…` (not the hover bar's step cut, which removes nodes — the two shared a glyph once and it caused a real mix-up; the cut's button is a drawn dashed box now, so they share nothing). **The keyword rules are ASYMMETRIC, and the asymmetry is the finding** (one rule for everything was measured half-backwards): **E1 — a BINDER's keyword goes** (`have hp1 : p ∣ 1 := …` → `… hp1 : p ∣ 1 := …`) — the statement is the content, the command word ceremony; E1 BYPASSES both width gates on purpose (the cases it exists for are short) and fires only when something remains — a `…` standing for a whole label says nothing (a bare word is F′'s territory now, where the glyph IS the content). `induction`/`calc`/`rcases`/`cases` are excluded (another rule already collapses their argument; dropping the head too leaves `… … with h | h`). **E2 — every OTHER tactic keeps its keyword and loses its arguments** (`simp only […]` → `simp only …`) — a non-binder's keyword is the skim anchor, its argument the noise; `rw [ih]` → `… [ih]` was the counterexample that settled it. **E2's premise fails for the tactics whose ARGUMENT is the move, and Rule F now owns those.** For `rw [lemma]` the bracket list IS the rewrite and the lemma name is drawn NOWHERE ELSE in the tree, so E2's reading produced `rw …` — the content gone, the noise kept. F elides the head, the brackets and any namespace prefix, and puts a TYPED MARKER where the command word was: `↪` for the rw family (`rw`/`rewrite`/`erw`/`nth_rewrite`), `∎` for `exact` (which closes its goal, the same thing `∎` already means on the lens's inline annotations — meaning-compatible reuse, not a collision). `rw [Nat.add_zero]` reads `↪ add_zero`, `rw [hb] at h` reads `↪ hb at h`, `rw [← hk]` reads `↪ ← hk`. **F bypasses BOTH width gates, for E1's reason plus a measurement E1 never had**: 19 of the corpus's 23 rw labels are under `MIN_LABEL`, so a width-gated F keeps `rw [` on those and drops it on the other four — the reported defect (`rw [Nat.add_zero]` whole at 17 chars, `rw [Finset.sum_range_succ]` → `rw …` at 26) with its sign flipped, not fixed. The marker is what keeps this from being a loss: dropping the head outright makes `rw [h]` and `exact h` both read `h`, two moves in one box (measured: 19 of 52 changed labels fell to ≤2 characters), and one glyph buys the distinction back. `apply` keeps its keyword — it closes nothing, so neither marker fits — but still loses its namespace. `simp only` is deliberately NOT in F: a simp set is not a rewrite and `↪` would say it was. `▸` was ruled out for the marker because it is already the used-hypothesis gutter mark AND the context-breadth rail glyph, and `←` because it occurs INSIDE rw labels, where it would collide with the content beside it; both survivors resolve on all eight code-font stacks. **Rule F′ (`HEAD_MARKS`, briefLabel.ts) extends the typed-marker vocabulary to every tactic whose command word IS a canonical symbol** — head-for-glyph, arguments kept verbatim, F's gate bypass and its `ruleF` flag shared so E2 stands down: `λ` intro/intros/rintro (Curry–Howard — intro IS lambda abstraction, and `λ` is Lean's own binder; these MOVED out of `BINDER_KW`, a typed glyph being strictly better than E1's `…`), `⊥` exfalso/contradiction/absurd (ex falso; Lean's `False`), `⊢` show/change (the tactic RESTATES the goal, and the turnstile is the tree's own goal prefix — the `∎` meaning-reuse precedent; a tactic box cannot otherwise contain `⊢`), `∎` assumption (joins exact's closing family), `δ` unfold/delta (δ-reduction is literally the move's name), `∃` use/exists (existential introduction — `use 5` reads `∃ 5`), `⟨⟩` constructor (the anonymous-constructor brackets; the fields are the child goals the tree draws below, Rule D's argument — the one 2-char marker, `Mark.len` was always generic). Per-entry `bare` says whether the glyph may stand ALONE: yes where the argument-less form is real Lean and the glyph still names the move (`exfalso` → `⊥`, `constructor` → `⟨⟩`, `assumption` → `∎`, `intros` → `λ`) — which needed the assembler's degenerate-result guard relaxed, since a bare glyph keeps NO run (`keep` empty is now legal exactly when a non-`…` mark exists); no where a bare head is a half-typed tactic (`show`, `use`, `unfold` decline). Rejected and not to be re-proposed: `subst` → `▸` (the collision above), `push_neg` → `¬` (`¬ at h` reads as a malformed proposition, and `¬` is the pill's flag-verb prefix), `revert` → `∀` (the context-breadth rail glyph). Measured over the corpus: exactly 9 labels move (8 intro-family `…`→`λ` upgrades plus `constructor`/`exfalso` newly collapsing), all 129 others byte-identical. Every glyph already occurs in the tree's own rendered content (goals, hyps), so font resolution is exercised by the product as it stands. **Hovering the rail's ⋯ while brief is OFF underlines, in place, exactly what brief would elide or replace** (the toggle stops being a leap of faith): paint-only hairline rects (the no-relayout-on-hover rule) computed from the SAME `collapseLabel`'s KEEP-map complement — so the preview cannot disagree with the collapse — drawn per wrapped line through `lineOffsets` + `measureText` (whitespace at a gap's edges trimmed per line: spacing normalisation, not replacement), after the label so they paint over the tagged path's `foreignObject` too, in `--ptw-comment` ink. Excluded shapes are the ones brief never collapses at node level: markers/combined (per-PART coordinate space), ledger heads (label forced to `calc`), prose labels, the synthetic calc node, minis. Hover rides a new optional `onHover` on `RailButton`/`FlyMember`; the effective flag (`briefPreviewOn`) additionally requires the reading flyout to be OPEN, because a collapsing row unmounts the ⋯ member without a mouseleave (click, Esc, background click) and the state would otherwise stick. **Elisions are now MARKED, TYPED or SILENT**, and the three are one mechanism: the assembler already inserted synthetic characters belonging to no KEEP segment, so a typed glyph is that machinery with a different string. `…` means hidden content (hoverable); a typed glyph means the move; SILENT means ceremony — a namespace prefix, a rewrite's brackets — removed with no trace, because there is nothing a reader would want revealed. `MIN_ELIDE` therefore applies to `…` ALONE: it prices the ellipsis, and a silent removal has nothing to price. Two ranges merge only when their MARKERS AGREE, and the ordered pass that follows is load-bearing — Rule C's `…` covers a list's tail and F's silent namespace strips sit INSIDE it, and overlapping ranges made the walk's cursor go backwards and resurrect hidden text (measured: `rw [Nat.add_zero, Nat.add_succ, Nat.zero_add]` printed `↪ add_zero, … zero_add`). A silent seam keeps the spacing on BOTH sides — without the leading half `rw [hb] at h` reads `↪ hbat h`, without the trailing half `apply Nat.le_trans` reads `applyle_trans`, both measured. **`elisionsOf` no longer RE-DERIVES the markers** by pairing KEEP gaps with a scan of the output for `…`: with three glyphs and gaps that emit none, that pairing hands a marker the wrong hidden text, so the assembler records `marks` and the node carries them. **And `mapRange` CLIPS rather than requiring containment — the one behavioural change outside the rules, and it is the silent-failure guard.** Lean lexes `Nat.add_zero` as ONE identifier token, and the strip removes `Nat.` from the MIDDLE of it, so under a containment test that span matches no kept run and the surviving `add_zero` renders uncoloured and un-hoverable with nothing anywhere reporting it. A span lying WHOLLY inside a gap still returns null, so a `…` keeps swallowing its tokens. E2 keeps the width gates and DEFERS to Rule C (a long bracket list keeps its first item — strictly more than `rw …`). `VERB_KW` is NOT the complement of `BINDER_KW`: unknown tactics are left alone. Width rules: RHS of a top-level `:=` that isn't `by` (a `:= by` opens a subtree the tree already folds); scrutinee of `rcases`/`cases … with`; over-long `[…]` lists keep the first item. Never `⟨…⟩`, never head keywords or `with |` tails. A **`calc` chain's first line collapses to `calc …` — but only PAST THE WIDTH GATE**, and that carve-out is the whole reason brief reads as dead on a hand-written chain. Rule D deliberately INVERTS rule 1 (everything after the keyword is already drawn by the TREE: start = LHS of the box above, relation = the box below, `:= by tac` = that tactic's node) and it also claims to normalise the accident that `tacticString` is the first source LINE — but it sits PAST `elisionRanges`' `short` return, so a head under `MIN_LABEL` (26 chars) is left whole. That is original and deliberate, not a regression: the commit that added the rule (`3eb1f4b`) says "The width gate still keeps a short head whole" in as many words, and nothing has touched it since. Measured over the corpus's three chain heads: `calc (∑ i ∈ Finset.range (k + 1 + 1), (2 * i + 1))` (50 chars) and `calc (0 : ℝ) < 1 := by norm_num` (31) collapse; `calc (a + b) ^ 2` (16) does not — and a chain hand-written with the line broken straight after the head lands at 16-17 chars, i.e. squarely under the gate, which is what a reader reports as "brief does nothing on a calc". **Rule D covers the calc line TO ITS END, including a term justification written on it, and Rule A is gated off nothing.** D was briefly narrowed to stop at the `:=` for a term justification (with A gated off calc labels so it could not elide what D had just protected), on the ground that a term justification was drawn nowhere else — true then, and false now: Part D gives every term-justified link its own goal box and node, so the justification is on screen whether the author wrote it on the `calc` line or three lines down, and a copy in the label is the one thing brief exists to remove. Both narrowings are reverted; measured over the union of the old and new corpus labels, exactly ONE label collapses differently and it is the multi-line one the restoration reversion deleted. **The gate is in tension with the rule's own second justification, and that WAS recorded rather than fixed**: the accident being normalised is precisely that the same construct measured 16, 50 and 128 chars across the corpus, so gating on that length re-introduces it — one chain collapses written on one line and does not when broken after `calc <lhs>`. E1 is the precedent on the other side (it bypasses both gates because it is about NOISE, not width, and Rule D's justification is redundancy too). Moving Rule D above the `short` return is a one-line change and a judgement about a shipped surface, so it is left for the author — do not make it just because brief looks inert on some chain. The `…` is one U+2026 with spacing normalised; synthetic spaces belong to no kept run so the token remap stays exact.

**The crux: the label is the coordinate space for tokens, so the collapse ships as a KEEP map** (`TreeNode.elision = {original, keep}`); the node's `label` becomes the collapsed string `sizeOf` measures — brief is an ENGINE-tier toggle (proofToTree option in the engine memo), deliberately OUT of `viewKey` with no `anchorRoot` (no structure moves; the shared `[nodes]` anchor pins the node nearest viewport centre). `renderTacticTokens` aligns against `elision.original` then `mapRange(keep, …)` maps spans into collapsed space, dropping any in a gap. Each `…` is a muted pseudo-span whose `<title>` carries the elided text. **Brief also elides a calc link's LHS to `_`, as the source writes it** — the one brief rule touching a GOAL label. `chainLhsElisions` elides a link's LHS iff it is some SIBLING link's RHS — ORDER-FREE, which is what makes it correct (wire order is not source order). **It used to degrade around a term-justified link and now simply works**: such a link produced no goal, so its successor found no sibling RHS and kept its LHS — correct then (nothing was drawn above it) and the reason a chain alternating term and `by` links elided almost nothing. Part D makes every link's goal real, so the rule needs no special case at all: measured, `ProofTreeTour.lean`'s `tour_calc` goes 2 → 3 of 4 and `proofs/calc.lean` 4 → 5 across its three chains, the gain in each case being exactly the link that follows a term. The chain HEAD is excluded separately (without the guard a chain returning to its start would elide its own head). The label is built by SLICING the original type (spacing preserved; mismatch leaves it whole); `TreeNode.goalElision` carries the hidden text so `computeTaggedGoal` rebuilds the tagged print the same way (`_` carries no tag, correctly) — otherwise the text-equality guard would drop the whole goal to plain text. Standalone app: collapse visible, colour/titles widget-only. Brief is a DECLUTTER, not a width tool (measured ~−0.5% width) — Rules A–D and reflow buy width.

### Comment strips on and off (rail `--`, and the selection pill)

Two switches over the same seam. **Global** is `LayoutEngineOptions.comments`; **local** is `commentsHidden`, a set of ids. Both are consumed at the ONE place a strip is measured (`commentSize`'s call inside `createLayoutEngine`'s `SIZE` map) by passing `undefined` text, which returns the zero record the overview mini branch already used — so every downstream reader is right for free: `floatsComment` requires `commentBlockH > 0` and so never stamps the aside float, and the band arithmetic, `nodeSpan`, `linkSpans` and the renderer all simply see a node with no comment. GEOMETRY, not paint: the strip is part of the band, so hiding it must give the room back or the tree keeps a ragged column of holes (measured: corpus height 43977 → 40119, −8.8%, with 0 strips drawn).

The view holds `showComments` (rail) and `commentsOff` (per node, the `combineOff` lifecycle exactly: remapped by `remapIds` on a shape change, cleared on a proof change). Neither rides `viewKey` and neither calls `anchorRoot` — only the strips leave, the structure you are reading does not move, so the `[nodes]` nearest-centre anchor holds the view (the ⋯ brief / ⇉ combine treatment). **The local set is NOT cleared when the global switch flips**, or turning comments back on would silently undo the ones you asked to hide.

The pill verb is ONE entry flipped by state (the already-flagged-heads precedent), never both at once. **It is labelled `comments`, constant in both directions, by user direction** — the old `¬note`/`¬¬note` pair spelled the flip in the pill's own flag syntax, the double negation being what kept the restore direction from colliding with `note…`, the writer a few chips along; that collision is gone with `note…` (now the `+` chip beside it), so the label can simply name the thing and the DIRECTION moves into the `<title>`, which is what `VERB_DOC.titleAlt` exists for — one doc entry, two readings, so the chip cannot say one thing and the panel another. Its candidate list is read off `treeNodes`, **not the placed nodes**: the engine has zeroed a hidden node's `commentLines`, so asking the drawn node whether it has a comment would make the verb vanish the moment it worked and leave no way back. Pure view state; the source keeps its prose (removing that is `unflag`'s business, a different gesture). Accepted caveat: `commentRanges` still claims a hidden strip's source range, so a cursor inside one accents the owning node although nothing is drawn — the accent still means "this node owns that comment".

**The rail glyph is `--`, Lean's own comment marker**, at `RAIL_GLYPH_FULL` (full-em ink, like `||` — at the shared 14px two hyphens draw a thin dash the eye slides off); pressed = away from "shown", the away-from-home convention.

**The switch is now THREE-state** (`commentMode: "shown" | "hidden" | "instead"`): click walks shown↔hidden, **⌥-click walks instead↔shown — NARRATION mode**, where a commented TACTIC's prose stands in for its label INSIDE the green box (user-confirmed decision, over boxless free-riding prose: the box keeps every edge landing where it lands, keeps the hover bar/reveal/delete/⌥-elide anchored, unifies with uncommented tactics — which keep their labels, or the tree goes unreadable — and free prose would need new band rules, the floated-strip saga's lesson). Engine tier like everything band-shaped: `LayoutEngineOptions.comments` is `boolean | "instead"`; the SIZE map's `"instead"` branch measures the prose as the label via `proseLabelSize` — a SIBLING of `sizeOf`, not a flag on it, because it differs in every dimension that matters (ITALIC at `NODE_FONT_PX` — measurement must match paint, the recorded trap; `"none"` indent — prose; no hyps) — zeroes the strip, and stamps `LayoutNode.proseLabel` (the `mini` discipline: one writer, render reads the bit). Only as-written tactics take it: goals keep statements and their strips (the prose narrates the MOVES), markers/synthetic/recovered stand for no single step, and a `commentsHidden` node falls back to its label. **A `· ` bullet prefixes the prose when the consumed goal is SPAWNED and UNBADGED** (a nested `by`-block — `have … := by`'s inline side proof): the bullet marks "this narrates a step INSIDE it"; induction branches arrive spawned too (delayed assignment) but carry a case BADGE that already names the nesting, and a bullet on top double-marked it (measured, corpus invariant bullet ⟺ spawned∧¬badge: 42 prose labels, 0 mismatches; `commented.lean`'s `nested_narration` pins the bullet). Prefixed BEFORE measuring, so it wraps as part of the first line. Render: plain SVG text, italic, comment ink, inside the tactic chrome — the tagged/token path is declined OUTRIGHT (prose is not source; letting the text-equality guard fail its way to the same answer would make "no colour" an accident); the `<title>` leads with the hidden tactic text, code one hover away. Double-click on a prose box edits the COMMENT (below). Mode changes don't re-centre (out of `viewKey`, the `[nodes]` anchor holds; round-trips measured byte-identical).

**Comments are EDITABLE in place (widget only)** — double-click on a strip (its own handlers on the strip `<text>`, `stopPropagation` on BOTH `click` and `dblclick`; SVG text is hit-testable by default, which is also why this used to misroute). **The click guard is not redundant with the dblclick one**: a double-click delivers two `click`s BEFORE the `dblclick`, and on a GOAL a click is the FOLD — so double-clicking a goal's strip to edit it folded and unfolded the whole subtree under it, most visibly on the root's "plan" comment, which sits above the entire tree (reported; measured 14 nodes → 1 on a single strip click, 14 → 14 after). Tactics were immune only because their click (reveal) is deferred past the double-click window and cancelled by it. The strip is its own surface: a single click does nothing, a double-click edits — which does cost reveal-by-clicking-the-strip on tactics, still available on the box, the hover bar's `»` and ⌘-click or on a narration-mode box. Gated on `onEditTactic` ALONE (`commentEditable`) — the range comes from `proof.comments`, not `tacticEdits`, so `getTacticEdit` has no say; declined on markers/synthetic/recovered. **The editor's text is the VERBATIM source reconstructed from `proof.comments`** (joined through `commentRanges` by start — the client never holds document text, and the strip's display string is LOSSY: delimiters stripped, markdown cleaned, soft-wraps joined, so it cannot be written back); several comments edit as ONE block only when on strictly consecutive lines (`commentEditFor`), else the first alone. **The block's COMMON indent is stripped for display and re-applied on commit** (`editing.commentIndent`): the edit range starts AT the first comment's `--`, so that line's indent is outside the range and never drawn, and giving the continuations their ABSOLUTE column therefore rendered two source-ALIGNED `--` lines as a flush line followed by an indented one — an indent nobody wrote, which read as the proof author's (reported as exactly that). Only the joins between separate comments are ours to normalize; a single `/- … -/`'s interior newlines are INSIDE the range and stay verbatim. The min over continuations, not the first line's column, so a deliberately stepped block stays stepped; re-applied to every line after the first on commit, so an untouched block round-trips byte-for-byte and a line the author ADDS lands at the block's own column instead of column 0 (where a `--` would fall outside the tactic and re-attribute). `editing.comment` is the flag (the `add`/`calcStage`/`fill` pattern): the overlay hangs over the STRIP (the floated-strip branch included) at the strip's own metrics (italic, `COMMENT_FONT_PX`/`COMMENT_LINE_H`), **lifted by `NODE_PAD_Y` so the textarea's vertical padding STRADDLES the strip's ink** rather than hanging entirely below it — unlifted it ate all of `COMMENT_GAP` and sat flush on the box (reported as "the boxes are a bit too close"; now 5px clear). `hideForEdit` exempts the box (the code being narrated stays on screen; the STRIP hides instead) — **except in narration mode, where the prose IS the box**: there the overlay is a box replace (`overlayY = boxTop`, height floored at the box's own) and the box hides like any tactic edit, since leaving it drawn put two boxes a few px apart with both borders showing. **A comment editor borders in the prose ink, never tactic green** (both flavours), and so does a narration node's own box: the border says what kind of thing is inside, and prose in a tactic-coloured box read as code. **That ink is `--ptw-prose`, NOT `--ptw-comment`** — same voice, different ground: the strip's ink is mixed against `--ptw-bg`, right for prose riding on the page, but a box sits on `--ptw-surface` (lifted 10% toward the foreground), so the identical grey lands with visibly less contrast there (reported). Mixed against the SURFACE for the same reason `--ptw-hyp-unused` is, and at 75% rather than 55%, since in narration the prose IS the box's content and only the italic and the hueless grey need to say it is not code. Measured on the default dark theme: 3.04:1 before, **5.19:1** after (WCAG AA for normal text is 4.5); the strip's own ink is deliberately unchanged, the colour mirror / abbreviation session / completion are all off (prose — `\n` in a sentence must not become a glyph). Commit replaces the block verbatim; **an EMPTY commit deletes the comment's whole line(s)** — clearing a comment is how you remove one — through `removeCommentPatch` with the `deleteSlots ?? proof.deleteSlots` fallback (the standing slots rule; found by the stub harness, where the prop is absent).

### Comments, flags, and case badges

**Comments are parser trivia** — never in the `InfoTree` — so both wires re-lex the proof's command source through `lean/ProofTreeComments.lean` (own `lean_lib`; handles `--`, nested `/- -/`, strings, char literals) and ship `comments: [{text, start, stop}]` (range extended to its final line's end — a stop excludes trailing trivia, exactly where a last-line comment lives; the docstring falls inside deliberately). Attribution is JS-side (`attributeComments`), built on the trivia quirk: range-containment IS the trailing-comment test. Rules in order: contained in a step → trailing if it starts on the step's own first line, else it belongs to the next step starting at-or-before the container's end — **that bound must be INCLUSIVE, and it must be tested against the next step's SLOT start, not its own** (two separate bugs, one line): trivia makes the next step start exactly AT the stop, so the strict test never fired and every leading comment fell on the preceding tactic; and a split `rw` records its start at the RULE inside the brackets, past the inflated stop (which lands on the `rw` KEYWORD), so an inclusive bound alone still lost every comment written above an `rw` to the tactic above it (reported and fixed 2026-08-08; `surfaceStart` resolves the innermost containing `TacticSlot`). **The slots reach `proofToTree` as an OPTION, not off `proof.deleteSlots`** — widget.tsx's `incoming` deliberately keeps slots OFF its rebuilt `Proof` (one source of truth, as a sibling on `stable`), so reading only the field fixed the CLI wire and left the widget unchanged: the fix verified green in the preview and the user saw the identical bug in the editor. The field is the fallback, which is what the standalone app rides. A multi-rule `rw` has one slot and therefore one comment line, so the comment attaches to the FIRST of its nodes — which is why `flagEdit`'s `headTactics` normalizes a head to its slot's first node before writing. Then: **the declaration's DOCSTRING → the ROOT goal ("the plan" slot)**; else next step by start; else previous. **That rule used to read "entirely before the FIRST TACTIC", which is a far bigger region and swallowed the first tactic's own leading comment**: a proof narrated `-- Step 1` / `-- Step 2` / `-- Step 3` drew 2 and 3 on their tactics and 1 on the root goal (reported; `proofs/euclid.lean` had it too, and `commented.lean` PINNED it). The honest boundary is the `by` — before it you write about the statement, after it about a move — and inside a declaration's source range the only comment that can precede the `by` IS the docstring, so `isDocComment` (a `/--` prefix on the verbatim text) is that boundary with no wire field for it. A `--` line above the `theorem` never reaches attribution at all: it is the PREVIOUS command's trailing trivia, outside the range comments are lexed from — so the root strip is simply empty when nothing was written about the statement. Accepted limit: a comment inside a multi-line SIGNATURE now falls to the first tactic. Measured over the corpus: 6 comments moved, all of that class, 0 other rows changed and none lost. `cleanLabel` scrubs trailing-comment text out of labels. Render: an italic, muted, box-less strip at the TOP of the band; in compact mode a parented node's strip hangs indented off the incoming connector (`COMMENT_INDENT`, git-graph style — the lane runs continuously past it); root comments flush-left; wide keeps centered. `proofs/commented.lean` exercises every rule.

**A BIG comment is a DOCUMENT, and it is clamped** (`COMMENT_CLAMP_MIN` 4, `COMMENT_CLAMP_SHOWN` 2, layout.ts). A strip wrapping to four or more lines is a multi-paragraph docstring rather than an aside, and drawn whole it is not a decoration on the proof but a third of it: measured over the corpus, **12 of 60 comments exceed two wrapped lines**, the tail being 7-8 line root docstrings at 136-154px each, and comment ink reaches **36% of total proof height** (23-29% on three more). So a big strip draws its first two lines plus one affordance line, and expanding is a per-node CLICK — a relayout, `anchorOn`'d, never a hover (the no-relayout-on-hover rule). Clamped and expanded alike it hangs behind a **hairline gutter rule**, the typographic half: it says *this is a document* without a box, which narration mode already owns. The threshold is deliberately past 3 — clamping a 3-liner to 2 + affordance saves nothing, and one- to three-line comments are the ones that read fine. Measured after: nothing draws over three line slots, worst fraction 36% → 28%, and **proofs whose strips were all ≤3 lines are height-identical**, so the common case is untouched by construction. Two seams keep it honest. The clamp and the rule's indent live in `commentSize`, the ONE place a strip is measured (the `comments`/`commentsHidden` seam), so `bandTopH`, `inkExtent`, `floatsComment`, `nodeSpan` and `linkSpans` need no second reader and the affordance simply occupies a line slot of its own; and the rule's indent is added THERE, so `commentW` covers it and the ink stays inside the measured width the contour packing sees (0 overlaps over 27 proofs × 4 modes × {clamped, expanded}). A clamp cut at a paragraph break trims the trailing BLANK line off the slice — a gap saying nothing directly above the affordance that says it better. `commentsExpanded` follows the `commentsOff` lifecycle exactly (remapped on shape change, cleared on proof change and ⌥-⊞), and display clamping never touches `commentEditFor`, which still reconstructs the whole verbatim block. **The affordance is a CONTROL sitting in a strip whose other ink is prose, and it has to say so**: the gutter rule stops at the end of the PROSE, leaving the line that opens and shuts the quote outside it; the text is upright where the strip is italic, underlined, and backed by its own hit rect — invisible at rest (the strip keeps its box-less look), a faint fill on hover, with the ink going full. That rect's padding is measured too (`COMMENT_MORE_PAD`), for the same reason the rule's indent is. **`text-decoration-style: dotted` is a dead end on SVG text** — the inline style reads `dotted` and `getComputedStyle` reads `solid`, i.e. it paints solid — so the underline is unconditional and the rest/hover difference is carried by the fill and the opacity, not by a dash pattern nobody could see.

**Alectryon-style flags**: a comment whose first word is a flag (`-- .fold`, `-- .none why this is dull`) is a DIRECTIVE riding the comment pipeline (`parseFlags` runs on the attributed comment; source-agnostic — `proofs/flags.lean` demonstrates in the standalone app). Recognised only at the START of a comment, first line, scanning stops at the first non-flag word; well-formed but unknown flags are CONSUMED (Alectryon's vocabulary is bigger than what means anything here). **The four meaningful ones split asymmetrically, forced**: `.fold`/`.none` govern the tactic's OUTPUT — `.fold` seeds a `fold` cut per `NodeFlags.targets` goal (the tactic's SPAWNED goals when any, else produced — spawned-first keeps a flag on `have … := by` from swallowing the proof) through `cutsForTargets`, the one door `resetToSource` and the pill's `.fold` verb also use (a TACTIC target — the first-tactic case, where the flag attributes to the root narrative slot — becomes a `step` cut); `.none` seeds a `step` ElideCut with the note — a break written into the proof, restorable by click or by ⊞ (which clears every cut, seeded ones included). **A `.none` on a step that CLOSES its goal needs its prose, and used to be dropped in SILENCE** (reported: the flag lands in the right place in the source and no ghost appears — read as a parser limit, but the harvest is complete and the gates are ours). Such a tactic has no `goalsAfter` and no spawned goals, so two independent rules refused it: `nodeFlags`' shared `targets.length === 0` gate — right for `.fold`, which folds the TARGETS — threw the flag away before the seed ever saw it, and `stepIds` separately declined a childless tactic ("one box for one ghost"). Both are correct for the note-less ◌ and wrong for a written directive, because a closing step's ghost carries the author's SENTENCE, which is strictly more than the label it replaces. So `.none` is now SELF-targeting on a tactic (the seed passes `n.id`; targets are `.fold`'s business — `nodeFlags` takes a `selfElide` argument rather than one gate for both), and `stepIds` gained an `allowLeaf` licence routed through `resolveCut` as `!!cut.note` — ONE door, so `pruneCuts` and `applyElisions` cannot disagree about it. `stepElidable` is deliberately unchanged, so the note-less ◌ still declines a leaf; and the pill's `.none…` treats an EMPTY commit on a closing step as a CANCEL rather than writing a directive that resolves to nothing (the writer must not leave dead text in the proof). `proofs/flags.lean`'s `flag_closing` pins both halves; measured over the corpus, 0 other nodes change. `.no-hyps`/`.h#name` (repeatable) narrow the CONSUMED goal's context instead — the output reading doesn't survive the translation (a closing `omega` has no output, and the flag above it would silently do nothing); they INTERSECT with the rail's breadth (filtered after the mode) and are consumed in `contextFor`, never reaching a `TreeNode`. Prose after flags becomes the strip — or on `.none`, the GHOST's label (`ElideCut.note`), replacing the preview and the `+N` (the author's sentence stands for the cut; full text stays in the `<title>`). **That note is a DURABLE fact about the step, not a property of the seeded cut**: `applyElisions` falls back to the flagged tactic's own `flags.note`, so ◌, ⌥-click and the marquee `elide` verb all label it the same way the seed did. Without it, expanding a seeded ghost and putting the step away again by hand (⊞ clears cuts, `.none`-seeded ones included, while the source still says `.none why`) swapped the author's sentence for `⋯ 1 tactic`, and one node read differently depending on which gesture had cut it. "Which tactic the cut is ABOUT" is deliberately narrow — a step cut's own `cut.id` (the very member set the seed builds, so the flag and ◌ now agree), and any other cut only when it collapses EXACTLY ONE tactic; a band sweeping five steps with one flagged among them keeps `⋯ 5 tactics`, since that sentence describes one step and would overstate itself as the label for the rest. The `<title>` tests the NOTE first for the same reason, ahead of the ghost/band split, so it cannot contradict the label the box is showing (and it pluralises — it read "1 tactics elided"). **Flags are parsed BEFORE the markdown cleanup — order load-bearing**: `cleanMarkdown` turns `` `.fold` `` into `.fold`, so prose MENTIONING a flag in backticks became a directive (happened for real). A flags-only comment draws no strip and claims no `commentRanges` entry (that map means "the node showing this", and the cursor accent trusts it) — its range rides `flagRanges` instead, the removal verb's target. **Flags are now WRITTEN as well as read** — the marquee selection's pill (see flagEdit.ts above) writes `.fold`/`.none <prose>`/`.no-hyps`/`.h#name` and removes them; hand-writing stays fully supported and is what the write direction round-trips through.

**THE CURSOR PEEKS INTO A SEEDED CUT** (`peekable`/`peekKey`, ProofTreeView) — putting the caret inside the source a `.none` break stands for opens it to show the tactic you are on, and leaving puts it back; since folds became cuts a `.fold`ed side proof opens the same way under the cursor, accepted as the same statement. `peekable`'s ranges are the TACTIC members' positions only — a spawned root carries its PRODUCER's position, which sits outside the cut, so counting it would open a `.fold` from the `have` line itself. A `.none` is the AUTHOR's default reading rather than one this reader chose, so entering its source is a statement that you are reading exactly that. Pure DERIVATION, no state: the cut is not removed (that is what clicking the ghost, ⊞ and the marquee already do) but temporarily not applied, so nothing is spent, nothing needs remapping on a re-parse, and there is no lifecycle to reset. **SEEDED cuts only** — a manual ◌ or marquee-`skip` cut is a thing you deliberately put away and having it spring open under a wandering cursor would be the tree fighting you (verified: a hand-cut tactic stays shut with the cursor on its own line). Seeded-ness is ASKED of `sourceView` by `cutId` rather than recorded on the cut, so the one translation of "what does the source say" keeps answering it (deleting the flag stops the peek with no state to migrate) and `ElideCut` grows no field for `remapIds`/`pruneCuts` to carry. **ALL containing cuts open, not the first**: cuts NEST, and `disjointCuts` drops an inner cut only while the outer one is applied, so opening the outer RE-ARMS the inner — measured on `flag_nested`, the cursor on the outer `have` opens it and leaves the inner ghost standing (4 → 10 nodes, 1 ghost), the cursor on the inner `simp` opens that too (0 ghosts), and backing out re-ghosts each in turn. The test is half-open containment OR **the member STARTS on the cursor's line**, and the second half is not slack: `tacticNodeAt` already hands a tactic starting on the cursor's line the node outright, so without it the accent would resolve to the tactic while its ghost stayed shut, and it is what makes the gesture reachable from COLUMN 0 — where `0`, `^`, `gg` and `j`/`k` off a short line all leave a vim user, against an indented tactic starting at column 6 (measured: strict containment missed `simp` at column 0). Reduced to a STRING before `treeNodes` reads it (the overview-cursor discipline), so moving within one ghost — or anywhere outside them all — rebuilds nothing. Peeked cuts drop out AFTER combine has composed, since `manual` is built from every stored cut: ⇉ must not claim the members a peek just exposed and stack them into a run. Composes with ⤓ for free, both being separate seams (`treeNodes` vs the `hide` seed): the members below the cursor's line stay hidden as the ghost opens, and a ghost whose earliest member is below the cursor is not drawn at all — you have not read that far yet.

**`reset` (the bar's text item; formerly ⌥-⊞) restores the source's own reading** — `.fold` folded again, `.none` ghosted again — and it exists because the seed's "a starting view, not a lock" was only true in ONE direction: undoing a directive by hand has always been one click, while ⊞ itself clears every cut, so a reader who opened a `.none` ghost to check it could not put the author's reading back. Plain ⊞ (nothing hidden at all) and ⌥-⊞ (exactly what the source asks) are the two ends of the same axis, hence one button rather than a new rail slot. The flag→view rule is factored into `sourceView` (elide.ts, pure), read by BOTH the once-per-proof seed and the reset, so a reset rebuilding the rule by hand can't become a second answer to "what does the source say". **The reset writes UNCONDITIONALLY where the seed guards on `length > 0`**: the seed runs in the same render as the proof-change branch that already emptied both, so an empty write there only costs a render, while for the reset it IS the gesture — on an unflagged proof "as the source asks" means nothing folded and nothing cut, and guarding would make ⌥-⊞ silently do nothing (measured: a 30-node proof folded to 1 by hand returns to a byte-identical 30). It also drops what a reading session accumulates and the proof-change reset also drops — the SCOPING modes (`focusId`, `pathId`: they hide the rest of the proof, which no flag asked for), the per-node exceptions (`combineOff`, `commentsOff`), the gallery's `pick`, and every transient holding ids or ranges (an armed delete or half-made pick pointing into a tree that just moved must not survive). Deliberately NOT reset: zoom and every rail toggle (how this reader reads, not this proof's state), and an open edit box or pending calc fill (they hold typed text a VIEW reset must not discard). Verified in the preview over `flag_demo`, `flag_nested` and an unflagged proof: from a state with the ghost opened by hand, an extra fold, a manual ◌ cut and a focus scoping the tree to 2 nodes, one ⌥-⊞ lands on an id list byte-identical to the seeded one. (Harness note: the focus breadcrumb is a `<button>` sitting AHEAD of the rail in the DOM, so a probe indexing buttons positionally clicks it instead of ⊞ — find rail buttons by glyph.)

**Named cases get a badge** (`TreeNode.caseLabel`): a small hue-free tag at the top of the band, above the comment strip (mirroring source order). Lean's tag arrives with the macro-hygiene suffix (drop from `._@.`; `[anonymous]`/`_` → no badge), PROPAGATES to descendants (badge emitted only where a case is ENTERED — `thisCase !== parentCase`), and is the full case PATH (show only what the goal ADDS to the parent's badge). Geometry mirrors the comment strip.

### View identity, anchoring, and scroll (the mvarId lesson)

**`proofKey` is the DECLARATION NAME** (`ProofTreeData.proofId` from `declName?`; `rootIds` is the CLI fallback) — only a change there re-keys fold/zoom/focus/path and re-centres — and a re-key is a RESTORE when the incoming proof has been read before, a reset only on first visit. **The per-proof `viewStash`** (ProofTreeView, held as state like `prevBase` — the branches run during render) writes the departing proof's durable reading state (elide cuts — folds are cuts — focus, path scope, gallery picks, combine/comment exceptions, open calc links, zoom) under its `proofKey` together with the BASE TREE those ids were minted in, and a return translates through `remapIds` against that stashed tree + liveness-prunes, the shape branch's own recipe — the ids were renumbered by whatever elaborations happened while away, so an untranslated restore is the demolition crew again. The `remapIds` work (c91d0f5) only ever covered SAME-proof re-elaboration; before the stash, switching theorems always landed back on a blank view. Transients (edits, relation picks, armed deletes — they hold RANGES) still reset both ways. **A stash suppresses the `.fold`/`.none` seed** — the source's directives are a starting view, and a proof with a stash has been read before; seeding in the same render would overwrite the restore. Measured in the harness: a fold cut (18-node view round-trips exactly), a ◌ cut's break and focus (2-node scope) all survive a switch away and back; an opened seeded ghost stays open on return instead of re-seeding. **The declaration name is a source fact but not a STABLE one while the file is being typed in**: a transient parse break renames the cursor's command to the next theorem (see the typing hold's `navigated` gate, which is what keeps that answer out of `proofKey` — without it, typing inside a `calc` link reset the whole view twice per word). It used to be the root goal's mvarId; a calc insertion renumbered 34/34 ids in the theorem BELOW it, so the proof being edited "became a different proof" and scrolled the author away mid-edit. `shapeKey` (all step goal ids) only PRUNES: cuts / focus root / path root dropped when no longer live; scroll/zoom stay.

**Scroll/fit sites read `inkExtent` (layout.ts), the `bandTopH` sibling**: how far a node's ink reaches ABOVE and BELOW its placed `y`, asymmetric exactly when the strip floats. `inViewScroll`, the deleted-node refocus, `fitWidth`'s `topY` and the initial centre each hand-rolled `(h + commentBlockH)/2` for both halves — wrong three ways at once (omits `caseH`; credits a floated strip's height to the BOTTOM, where none of it is drawn; under-counts the top by the same). The comment claimed the 32px comfort `pad` absorbed it, true for a one-line strip and false from three lines up (a 4-line strip is a 41px error). For a non-floating node `up === down` and the span's midpoint is `y`, so routing the old call sites through it is a NO-OP everywhere except the aside modes.

**THE VIEWPORT IS PART OF EVERY CONTENT COORDINATE, so a RESIZE has to be anchored too** (`padRef`, the compensation effect after the initial centring). `PAD_X`/`PAD_Y` are a full viewport of padding on each side — so any node can be scrolled to the edge — which puts the content at `MARGIN + PAD + x`, and PAD *is* the viewport's own size: change it and the whole tree moves in scroll space. Nothing compensated. Zoom changes are held by `zoomAnchorRef` and layout changes by the `[nodes]` anchor, but a pure resize changes neither `zoom` nor `nodes`, so both sat it out, while the initial centring is one-shot on (proofKey, viewKey) and declined to run again. **That is the reported "sometimes I have to press Fit width to find the tree on first launch", and it is a FIRST-LAUNCH bug because the widget's frame SETTLES**: `useFrameOffset` measures at mount and again from a ResizeObserver (with a `MIN_FRAME_PX` floor and 1px hysteresis), so the first non-zero viewport the centring runs against is routinely not the one the panel keeps. Measured on the identical rig, zoom 1, height 520 → 760: before, `scrollTop` frozen at 520 and the root pushed 80 → 320 — the exact viewport delta, an empty band above the tree, and off the top and left when SHRINKING instead; after, `scrollTop` follows 520 → 760 and the root holds at 80. The fix shifts scroll by `Δviewport * zoom`, the treatment a zoom change already gets, holding the same content point under the same screen point — verified at zoom 0.64 too (height −280 → `scrollTop` −179, root held to 0.2px) and with the view deliberately scrolled away from centre first, so it preserves an ARBITRARY view rather than re-centring. It shares `padRef` with the centring effect and is declared after it, so a render that both re-centres and resizes cannot double-move: the centring stamps the new size and the compensation sees no delta. **Verify a resize with `resize_window` plus a SCREENSHOT** — a hidden pane throttles ResizeObserver delivery, so driving the height from JS alone measures nothing and reports before and after as identical (it did); and never clear the scroll container's inline height to fake a resize — that wipes a style prop React owns and leaves the container unconstrained (`PAD_Y` 18556, a blank canvas that looks exactly like the bug).

**Every relayout is anchored.** `anchorOn(id)` (folds, commits, `sorry` chips) wins — but only if the node still resolves. **Next in line is the CURSOR'S node, when it survived AND was on screen** — it is where the user is WORKING (the buffer's caret, the node the accent marks), and a swap landing mid-edit must leave the view focused there, not on whatever sat nearest the centre; `refocus` rides along so a swap that would leave it outside the comfort band pulls it back in. The on-screen gate is load-bearing in BOTH directions (measured in the payload replay): a cursor parked in a proof you are not looking at must not yank the view back to itself. Only then does it fall through to the node nearest the viewport's vertical centre. **Elide and un-elide anchor across the SUBSTITUTION** (`anchorAs(currentId, nextId)`): a cut's commit pins the incoming marker (keyed `I<cutId>` — the marker has no position, so tactic↔marker can never pair through layoutKeys) at the collapsed node's y, and the marker's removal pins its topmost member (min base-preorder over `resolveCut`, = the tactic for a step cut) at the marker's y — so collapse holds the ghost under the pointer, expand puts the tactic back where the ghost sat, and the round trip is scroll-identity (measured exact; the fallback had drifted +69.5px on collapse and +1226px on expand, the restored node a full viewport off-screen — it can even match the WRONG node, since removing nodes re-deals the `P<line>:<char>#ord` ordinals). Residual: `PlacedNode.y` is the band CENTRE, so a strip-carrying tactic swaps with its stripless ghost at a half-band offset (−14px measured); the two directions cancel exactly (a named anchor that silently did nothing was the worst option: layout moved, scroll didn't). **Nodes are matched to themselves across relayouts by `layoutKeys`** (`web/src/layoutKey.ts`, pure) — SOURCE POSITION, never id (the mechanism that exists to hold the view still was itself id-keyed and defeated by exactly the edits it was written for: commenting one tactic matched 8/69 by id, 69/69 by position); nodes legitimately share positions (goals carry producers' ranges), so a running DFS-preorder ordinal disambiguates; positionless root goals fall back to id. When the node you were ON is the one an edit DELETED, `cursorChainRef` (cursor node + ancestors as layout keys, its effect declared AFTER the anchor effect so a relayout sees the previous chain) falls back to the nearest surviving ANCESTOR, scrolled INTO view rather than held (the subtree under it just vanished) — gated on having been on-screen; a position can outlive its place in the tree, so anchoring on any surviving position lurches. **Horizontal is followed only in WIDE mode** — its every x carries a global offset that moves with tree width (following dx cancels it), while compact x is absolute (following it scrolls sideways for no visible reason). The shift measures from the LIVE `el.scrollTop`, RECONCILED against `lastScrollRef` — the live value wins except in the one detectable case the record exists for: a SHORTER new layout has already clamped `el.scrollTop` by the time the layout effect reads it (live pinned at the new max, below the record → the record wins). v1 read the record unconditionally, and it goes STALE whenever a programmatic scroll lands between commits with its scroll event late or undelivered — `animateScroll`'s eased writes are exactly that. Measured in the payload replay (the cf_probe payloads through App's `?cf-replay` harness): cursor-follow at 3523, record still 975, and every same-proof swap "restored" 975 — the reported "flashes to the top of the proof while typing", observable once per edit because the counterfactual cache makes later swaps rare; after the reconciliation + cursor-priority anchor, 3523 → 3507 held across delete/broken/typing/cf/real with zero jumps. The record stays fed by the `scroll` listener plus the post-commit no-dep `useLayoutEffect` (scroll events ride rendering steps a hidden webview never runs). **View state is re-keyed across a re-parse by `remapIds`** (`layoutKey.ts`): `collapsed`, `focusId`, `pathId` and every `ElideCut` still hold mvarIds internally, but the shape-change branch translates them old→new by TREE POSITION before asking what is still live. Without it the prune was a demolition crew — editing a theorem EARLIER in the file renumbers every mvarId in this one, so nothing resolved and fold, focus, scope and cuts were all silently emptied although nothing here moved (measured: **0/10 surviving by id, 10/10 by path**). `shapeKey` stays keyed on mvarIds DELIBERATELY — it is a change DETECTOR, not an identity, and must fire exactly when ids move, which is when the remap has work to do. The cursor-tracking effect is keyed on `hlKey` (the cursor), never the resolved node id — ids renumber on every re-parse, and an id-keyed guard read that as "the cursor moved" and scrolled away.

### Theming

Every drawable colour is a CSS custom property on `[data-ptw-theme]` (stamped by `ProofTreeView` on its own root — not widget.tsx's `data-ptw-root`, which the standalone app lacks and whose `:has()` selectors a second copy would disturb); render sites carry `var(--ptw-…)`, so theme switches repaint in the browser with no React render. **Light/dark is ONE decision for boxes and tokens together** — fixing one half swaps light-on-light for its mirror bug. The stamp derives from the background's LUMINANCE (`resolveThemeKind`, Rec. 601 < 0.5), not VS Code's body class — correct for custom themes, high-contrast, and non-webview hosts; reads `--vscode-editor-background`, then body, then root, skipping fully transparent ones (the standalone body is `rgba(0,0,0,0)`; only the fall-through gets it right). Refreshed by the same MutationObserver (plus body `class`/`data-vscode-theme-kind`). **Everything anchors to the theme's own bg/fg**: recipes are written once as `color-mix` of a hue into `--ptw-bg`/`--ptw-fg`; the dark block overrides only the INPUTS (custom properties substitute lazily). Nodes sit on `--ptw-surface` (background lifted 10% toward foreground — a raised card). Token hues are the Light+/Dark+ values pulled 72% toward `--ptw-fg` — verbatim vendor palettes read as neon on soft themes. Context lines carry no hue; unused ones dim to 62% (lower compounds with a soft theme's own softness). Hue only where it carries meaning (goal vs tactic vs keyword). **Outline-only** (`ramify.outlineOnly`, widget-only — a SETTING, not a rail button: a standing preference, and it arrives over the companion channel, which the standalone app doesn't have): stamps `data-ptw-fill="none"`, a last-in-sheet block swaps the fill variables to `transparent` — purely paint, no relayout.

### Eliding nodes — three cuts, one mechanism (`web/src/elide.ts`)

**The UI calls all of this SKIP** — the selection pill's `skip` verb, the hover-bar button's titles and the break's own `<title>` (`skipped into the trunk` / `folded away`). These notes still call the tactic gesture ◌ after the glyph the button used to carry; the button itself draws the break it makes (below). A GOAL's `−` is the same mechanism from the other end — see FOLD IS A CUT under Layout engine. `elide`, `ElideCut`, `applyElisions` and the brief-mode elision internals stay the identifiers; only the words a reader sees changed.

All collapse an id-set to a single MARKER node drawn as a BREAK, applied as a **pure `TreeNode[]` transform BEFORE the engine** (`applyElisions`) — a `computeLayout` mask can only hide SUBTREES; an interior cut must KEEP what hangs below. An `ElideCut` is **band** (an explicit id set — the marquee selection's `skip` verb, `elideSelection`), **step** (hover-bar ◌ on a tactic, or `−` on a TRUNK goal, below), or **fold** (`−` on any other goal, and every goal in ⑃ wide: everything strictly BELOW the goal, the goal itself staying drawn with a `+`; `resolveCut` walks the subtree in the node array's own preorder so `parts[0]` is the goal's consumer and the caption names it). **The picked PATH cut and the picked BAND are both GONE** (removed by user direction with the three picking modes): the `"path"` kind, `pathIds`, `commitElide` and `commitBand` are all deleted, and `elideSelection` is now the one band producer, so a band's membership is the set you swept rather than a y-interval — which is also why ⇳'s stacked-only restriction no longer exists. The marker is emitted in the set's TOPMOST slot (DFS preorder preserved), gets the remapped union of members' parents (a band may yield a multi-parent marker — the trunk layout tolerates it), and every edge into the set re-parents onto it, so downstream features work free (the collapsed nodes aren't in the engine's tree). The marker is a real node (`TreeNode.elidedCut`, positionless, hidden tactics listed in `<title>`) — kept a NODE deliberately, because peek, `anchorAs`, `remapCut`, `pruneCuts`, `disjointCuts`, `tacticTargets` (the cursor accent) and ⤓'s `ownPositions` all work off that fact — **but it is DRAWN as a BREAK, not a box**: the `<rect>` stays (transparent, it is the hit target the `<title>` hangs on) with no stroke, and the paint is an axis-break glyph on the TRUNK LANE (`-w/2 + BREAK_LEAD`, `BREAK_LEAD = TRUNK_INSET`, exactly where the incoming and outgoing links run — in the aside modes a short horizontal lead from the box edge reaches it) — two 45° ticks `BREAK_TICK` long at `±BREAK_TICK_DX` straddling a gap in the line — plus a boxless CAPTION to its right in the comment strip's voice (italic, `COMMENT_FONT_PX`, `--ptw-comment` at 0.75 opacity, full ink on hover, `SEQ_STROKE` when the node carries the cursor or marquee accent): the `.none` note if one was written, else the first hidden tactic's preview and `+N` (the ghost's own text, minus the `◌`, which only ever made sense inside a chip). Sized by `breakSize` (`COMMENT_LINE_H` tall, `BREAK_LEAD + BREAK_GLYPH_W + BREAK_GAP + caption`, no `MIN_W` floor — a narrow break is the point), a sibling of `proseLabelSize` with its own `SIZE` branch, and it is the first node with `lines: []`: `taggedLines` is gated off it (`renderCombinedLines([])` is truthy and would swallow the plain fallback), `hypLitTactics` excludes it (a break uses nothing) while `hoverId` still tracks it for the caption. Combined (⇉) markers keep their box. Clicking the break removes the cut (checked first in `onNodeClick`), clicking a `+`-wearing goal removes its fold cut, and **⊞ expand-all clears them ALL** — folds included, since they are cuts. Only the MANUAL cuts live in `elideCuts`; ⇉ combine's runs are recomputed in the engine memo from its toggle, so a merged run survives ⊞ (it is a display mode, not something hidden). Cuts live in `elideCuts` (engine dep). A marker caught in a band is ABSORBED (cuts stay disjoint, no merge logic). `pruneCuts` drops unresolvable cuts on shape change.

**A region cut once had to SWALLOW what a fold was hiding under its members** (`foldHidden`, a 65,136-of-194,796-pair measurement): with folds now cuts there is no second mechanism for a band to disagree with — a marker caught in a band is absorbed like any other, the measurement is retired and the function deleted.

**Cuts must be pairwise DISJOINT, and `disjointCuts` now enforces what the code always assumed.** A node maps to exactly ONE marker, so two cuts sharing a node emit two markers that each inherit the other's edges — a 2-CYCLE, which the layout draws as a link running back UP from the lower ghost into the higher one, its terminating horizontal leg crossing the whole width of the box it aims at. That is the reported "branches drawn through ghost nodes", and the pair need not be exotic: **two NESTED `.none` flags in one proof are enough**, because the seed walks `baseNodes` in DFS preorder and pushes the outer cut first. Measured over the corpus: the base trees and all 123 single cuts give 0 cycles and 0 back edges, while of 318 overlapping ordered pairs 159 cycle — every one of them with a back edge in all four layout modes; 0 after. **The BIGGER set wins, not the later one** — the container hides its contents either way, so both flags are honoured, and it agrees with recency on every hand-made pair (you can only cut the outer one second, since the inner's tactic is inside the ghost by then); ties and partial overlap (0 observed) fall back to the later cut. An overlapped cut is dropped WHOLE rather than trimmed to the difference — a partial set is nothing anyone asked for. The dropped cut stays in `elideCuts` on purpose: removing the survivor brings it back, which is exactly the state before the last gesture. `proofs/flags.lean`'s `flag_nested` pins it. The sweep worth rerunning is structural, not geometric — a cycle check over the node graph plus "every link's target sits strictly below its source" — since the ink-overlap sweeps never looked at links at all, which is how this reached a user.

**The step cut (◌)** — "I've read this `have`'s side proof, take it out of my way": the tactic plus every descendant not reachable through its CONTINUATION, leaving `goalBefore → ghost → continuation`. **⌥-click on the tactic is the fast path** (`elideStep`, shared with the ◌ button) — the goals' ⌥-focus precedent, free because `focusable` is goals-only; it must be checked BEFORE the reveal branch, which otherwise consumes every tactic click in the widget. **Which child continues is read off two semantic bits, not geometry** (`continuationOf`): any `spawned` child ⇒ the non-spawned continue; else any `side` child ⇒ non-side continue; else the children are PEERS and nothing continues — which is NOT a refusal (the first version's mistake): a TERMINAL tactic (an `induction` whose branches are the rest of the proof) is the case the gesture exists for, so no continuation means the whole subtree goes and the ghost is a leaf. **A CHILDLESS tactic declines, and that is now the whole rule** (the cut would swap one box for one ghost). The offer set (`stepElidable`) is memoized per base tree — the test walks a subtree. **The leaf SUBSTITUTION is REMOVED by user direction**: ◌ used to be drawn on a childless tactic anyway and fold the consumed goal instead (`leafFoldTargets`, `leafFold`, the `−` face and the `self` fade), on the argument that a button missing from 78 of the corpus's 204 tactics reads as broken — one button doing two different things read as confusing, which is the stronger complaint, and the goal's own `−` already folds it. `leafFoldTargets` is deleted; `elideGateOf` returns null there. The break's caption is a truncated PREVIEW of the tactic + `+N` (`GHOST_PREVIEW`; a bare count is the same shadow whatever you cut), using the node's OWN label so brief composes free. **The button is a DRAWN DASHED BOX** (`SkipIcon`, `NodeAction.icon` — the trash can's precedent, at its 0.9 stroke), NOT the `◌` it was and never `⋯` (brief's glyph — that collision caused real confusion). **It is a TRUE dashed SQUARE — 7×7, NO `rx`** (it was a 12×9 rounded chip at dash `2 1.5`, and the report was simply "is there no true dashed square?"; 8×8 then read "just a hint too large" beside its neighbours and came down a notch by user direction): each 7px side takes exactly `1.75 1.75 1.75 1.75`, and **`strokeDashoffset={0.875}` anchors the pattern ON THE CORNERS** so every side reads corner-dash · gap · middle dash · gap · corner-dash with all four corners inked — off by that half-dash the corners fall in the gaps and the shape reads as four floating ticks. The perimeter is 28 = 8 × 3.5, so the pattern CLOSES exactly and there is no seam. Measured in the harness: the drawn rect's box is **7.00 × 7.00** against the ~8px the bar's equal-ink rule asks for (`◌` 8, `⧉` 8.88), and `isPointInStroke` answers true at all four corners and all four mid-edges and false at the two gap points on a side. It shows the thing the gesture MAKES: the ghost is a dashed chip, so the button is a picture of it, where `◌` was a dotted circle naming nothing on screen. The titles and the `?` panel say "the dashed box"; `elide.ts`'s ghost LABEL keeps its `◌ ` prefix (it is node text, measured by `sizeOf`, and the chip it sits in is dashed anyway) — the one place the character survives. Declined on markers, combined nodes, and the synthetic calc node — the same three delete declines. `pruneCuts` re-derives it per layout (unlike the frozen band); `parts` carries cut tactics' positions so the cursor accent resolves inside the cut. **Hovering ◌ — or ⌥-hovering the tactic — FADES what the cut would take** (`elidePreview`, `elideExtentIds`): the armed delete's preview at the same 0.35 and by the same rule, minus the arming step, since nothing is written and so nothing needs confirming. Paint only (the no-relayout-on-hover rule). Two details are load-bearing. **The ANCHOR never fades** — the action bar rides inside the node's own `<g>`, so group opacity would fade the ◌ under the pointer and read as a disabled button; arming spares its own node for the same reason, and the rule is therefore ONE rule, not two. **The extent resolves against `treeNodes`, not `baseNodes`**, though the commit works on base ids: a cut nested inside this one is a ghost NODE in the drawn tree and a set of base members in the base tree, so the drawn basis is what lets an existing ghost fade with everything around it (`disjointCuts` drops the inner cut when the bigger one lands, so the two agree about the region). Falls out of that basis: a COMBINED run (which swaps one marker for another) takes exactly the anchor, so nothing fades and the absence is the answer. `elidePreviewFor` carried a `self` flag for the leaf substitution's ⌥ fade; both went with the substitution. ⌥-hover rides `onMouseMove`, not `onMouseEnter`, because the modifier goes up and down while the pointer sits still; both branches compare before writing, so a settled pointer re-renders nothing. **The preview carries its SOURCE (`from: "alt" | "bar"`), and the clears must respect it** — the bar rides inside the node's `<g>`, so every pointer jiggle over the ◌ button fires the g's `onMouseMove` with `altKey` false, and an untagged clear there killed the button's own preview the instant it appeared (reported as "flashes but nothing real"): the ⌥ path clears only `"alt"`, the button's leave clears only its own `"bar"`, and only leaving the NODE clears either. **⌥ pressed over a MOTIONLESS pointer is a document `keydown`, not a mouse event** — the old "move a pixel" blind spot was reported as a real bug once the preview existed. **The gate has ONE coding, `elideGateOf`**, read directly by the render loop's `elidable` (per node per render, so it takes the node) and, through `elidePreviewFor` (gate + extent, a find per event), by EVERY fade surface — the Alt-keydown listener, the ⌥-mousemove branch and the ◌ hover all call the same helper, so no surface can disagree with another about where the gesture exists or what fades. The keydown reads latest state through a per-render-written ref so the listeners register once (the clear needs no ref — a pure functional update); `repeat` guarded (Alt autorepeats, and each unguarded fire builds a fresh Set); keyup and window `blur` clearing (a webview losing focus mid-press never sees the keyup). Known limit: a webview receives keys only while it has focus — clicking the tree grants it; with the caret in the editor the pointer paths remain the working pair. Verified in the preview with dispatched events: ⌥-move fades 6 / plain moves clear; keydown-while-resting fades 6 / keyup clears; ◌-hover fades 6 and SURVIVES jiggles over the button, clearing on leave. Earlier verified: on a `calc` node the faded set ∪ {anchor} is EXACTLY the 7 nodes the commit then removed, and the preview clears on commit (`elideStep` nulls it).

**Combine — labelled `merge` in the UI** (the reading menu's row, the selection pill's `merge`/`unmerge` verbs, the `k` key; `combine` stays the identifier throughout the code) — the automatic sibling: every maximal LINEAR run (single-parent/single-child chain, ≥2 tactics, boundary goals excluded so it still reads "from this goal, these steps, to that") collapses to a synthetic node rendering the joined labels. SYNTACTIC only — labels concatenated verbatim, nothing merged at the tactic level. An engine-tier toggle, not a stored cut. Computed over nodes manual cuts AND `combineOff` don't claim — `combineOff` is the un-combine verb's memory (base ids the auto pass must skip; remapped on shape change, cleared on proof change and when ⇉ turns off, so re-enabling the mode recombines everything). **A combined node keeps full per-token fidelity**: `elidedCut.parts` carries each part's label/position/brief-elision, `WrappedLine.seg` maps drawn lines back to parts (parts own segment RANGES — a part's label can be multi-line), `renderCombinedLines` renders each part against its own tactic; all-or-nothing per node (never half-coloured). `cursorTargets` offers every part's range under the combined id. **A combined node's gestures are a TACTIC's, per user directive — it never folds** (no −/+ glyph; the fold would hide the run behind a second mechanism nothing else clears): single click REVEALS at the FIRST part's position (`actPos` — the marker itself has none), deferred past the double-click window like any editable tactic; **double-click edits the PART under the pointer** (the tagged line divs carry `data-ptw-lineidx`; line → `seg` → part, the `renderCombinedLines` mapping; a miss or the plain-SVG fallback edits the first part; the mirror aligns tokens via `editing.tokPos` — the node's own position is undefined); the hover bar carries **⧉** (lens at the first part), **◌** (`elideCombined`: a BAND cut over the member ids the marker's own id encodes — `combineMemberIds` — replacing a same-id manual cut; ⌥-click works too, which is why `clickable` includes `elidable`), and **⊘** (delete the RUN: `delExtents` synthesizes a union spec from the member tactics' — anchors re-sorted to source order, `combineMemberIds` decodes them SORTED AS STRINGS — and `delSpecs` keeps it for the arming click). The marquee pill offers **uncombine** on swept combined nodes: a manual cut is removed; a ⇉-made run's members go into `combineOff`. No re-centre on toggle (out of `viewKey`, no anchorRoot; the `[nodes]` anchor holds). That anchor had a latent bug combine exposed: it compared content y against `scrollTop + h/2`, but screen position is `(MARGIN.top + PAD_Y + y) * zoom − scrollTop` — the pick was off by a screenful (the shift itself was right; differences cancel constants).

**Marquee selection (background drag)** — a drag on the tree BACKGROUND rubber-bands a rectangle (content coordinates — an SVG rect inside the translated `<g>`, so scroll/zoom apply free); mouseup selects every node whose BOX intersects (band-rect intersection would grab a node by its comment strip alone), members take the accent outline, and a **pill of verb chips** appears above the selection's bbox (`FrontierChip`s, `SEQ_STROKE`-inked, on ONE opaque backing card — `--ptw-surface` fill, hairline `--vscode-editorWidget-border`, `CARD_PAD` around the row, slight drop shadow; PAD_Y's viewport of headroom is why "above the bbox" never leaves the canvas). **The card is the pill's alone — frontier chips stay transparent** (under a pending goal they sit on empty canvas, where a fill reads as a solid button), but the pill hangs wherever the selection's TOP edge lands, routinely over a comment strip or a box, and dashed outlines full of tree ink behind them are unreadable. One card, not N opaque chips: the gaps between chips show the same ink, so filling only the chips fixes half of it. Chip widths are therefore measured UP FRONT (the card must span a row whose width is only known once every chip is measured) — through `chipWidth`, the one home for the padding/floor rule, and painted with an explicit `fontFamily={getCodeFontFamily()}` like the relation picker: `measureText` measures in the EDITOR's font, so a chip that paints the `"monospace"` default is sized from one font and drawn in another (measured with a serif editor font: slack ranged 2.8px on `.fold` to 11.3px on `note…` where it should be a constant 12; ragged rather than clipped, since no tested font overflowed). Free real estate: background drag was unclaimed, no modifier needed (⇧'s webview record), sub-4px drags stay clicks, and `user-select: none` was already on the container. Mechanics that are load-bearing: the node `<g>`s carry `data-node` and the mousedown hit-tests `closest("g[data-node], [data-ptw-edit]")` (stopPropagation would break native focus paths); the drag's own mouseup fires a CLICK on the container — the background-click-clears-selection gesture — so `marqueeDidDrag` swallows exactly that one click or every marquee dissolved itself; the pill and prompt are **straight-line body code, not JSX IIFEs** (their verbs reach `anchorAs` → a ref write, and react-hooks/refs taints any render-CALLED function that transitively touches a ref — verbs are plain DATA dispatched by `runSelectionVerb`, closures only in JSX attribute position); selection joins the Esc transient layer, the shape-change `remapIds` branch, and the proof-change reset. **Verbs, gated per set**: `elide` (a band cut from the explicit id set — the ONE band producer now that ⇳'s y-interval pick is gone, and it works in EVERY layout; markers absorbed, a swept ⇉ node dissolved via `combineMemberIds` — the member ids live in the marker's own `cutId`); `combine` (manual — offered iff `selectionRun` proves the selected TACTICS one linear run; goals in the sweep are ignored, boundary goals excluded as always); `comments` — ONE chip, by user direction, that hides the swept nodes' strips when any are shown and restores them when all are hidden (the `commentsOff` logic unchanged; the LABEL is constant and the TITLE says which way the click goes, via `VERB_DOC.titleAlt` — see the comment-strip section); `+` beside it, which is the old `note…` prose prompt under the glyph the frontier chips already use for "write something here", gated exactly as `note…` was (`soleHead`); and the five flag writers, now behind ONE `flag ▾` chip (widget-only, gated on `onEditTactic` + `deleteSlots`). The resting row is therefore `skip · merge/unmerge · comments · + · flag ▾`. **The row is kept SHORT deliberately** — it appears over the tree, so every chip costs reading room: `fold` was removed outright (⊟, the node's own −, and `.fold` all already fold, and it was the one verb that bought nothing the tree didn't offer where you were already looking), and **`.none…` is gated on the SELECTION holding exactly one tactic, not on one head**. That last is the asymmetry worth keeping: every other flag writer normalizes a ragged sweep to `headTactics`, which is right for them (`.fold`/`.no-hyps` describe a subtree, so a thirty-node band with one head is a sensible thing to flag), but `.none` replaces a step and everything it opened with a SENTENCE about that step — offered over a sweep, the ghost you got stood for far more than the tactic you thought you had picked. `soleHead` remains the write TARGET (the comment goes above the slot), so one node of a multi-rule `rw` still counts as one tactic. **The five writers hang off ONE expanding `flag ▾` chip, by user direction** — clicking it opens `.fold · .none… · .no-hyps · .h#used · unflag` IN PLACE in the same card, clicking it again shuts them, and the chip stays in the row while the group is open, which is what makes the same click the way out. Gating, titles and the `runSelectionVerb` dispatch are unchanged and `unflag` still arms its confirm chip; `flagOpen` is a plain boolean reset wherever the selection is (proof change, `resetToSource`, a fresh sweep, and every verb's own tail) with its own entry in the `layers` table directly above `selection`, so Esc and a background click shut the group first and the selection second. The group chip is NOT a verb — no `SelVerb` dispatches it — so its label and title live in `FLAG_GROUP` (gestures.ts) rather than in `VERB_DOC`, whose keys stay one-per-verb. **The `❯` SEAM that split view verbs from writers is REMOVED by user direction, and so is the dashed/solid outline split that reinforced it** — `SEAM_GLYPH`, `SEAM_GAP`, `seamWidth()` and the `writes` flag that located the boundary are all gone, along with the reasoning they were tuned by (10px of air either side against `CHIP_GAP`'s 6, measured 9.9/9.9 against 6.0; the ✎→❯ stem study; the eight-stack fallback check): with the writers folded behind `flag ▾` the resting row no longer mixes the two kinds, so there is no boundary left to mark. **Every chip in the pill is now `solid`** (the dash meant "not in the proof yet", which was one half of a distinction this row stopped drawing); `FrontierChip` keeps its `solid` prop for the pill alone — frontier chips elsewhere (`+`/`sorry`/`calc` under a pending goal) keep their dashed look, which is what that vocabulary still means there. **The card stays ONE uniform fill** — a tint over the writing zone was built (a clipped band, since per-chip fills would have shown the card through the gaps) and removed on sight by user directive: the seam and the outlines said it at the time (both since removed themselves), and a split background said it a third time in the one channel the card exists to keep quiet. Arming stays proportionate for the ADDING verbs — the line appears in the buffer at once and one keystroke takes it back — so only **`unflag` ARMS**, being the one verb that DELETES text the author wrote (whole lines, prose included): `pendingVerb` swaps the row for `[remove N comment lines] [×]` in `DANGER_FILL` inside the same card, and the resting chip is `DANGER_FILL` too so it looks different BEFORE you click. It reuses the pattern, not `arming` itself, which is keyed on a node (its extent, dimming and buffer preview all are) where a selection has none. Like `arming` it holds PATCHES against the current document, so it joins the layer table, the background click, and — the dangerous one — the shape-change branch beside `setArming(null)`. **Labels and tooltips live in `VERB_DOC` (`gestures.ts`), a `Record` over the verb union**, so the help panel and the chip cannot disagree and a verb added without documenting it fails `npm run typecheck`; the keys are VERBS, not the payload SHAPES they share (`.no-hyps` and `.h#used` both travel as bare patches, and describing them as one thing is how a chip gets someone else's tooltip). The chips carry an `act` DATA tag dispatched by `runPillChip` rather than closures — the same ref-taint rule the verbs themselves follow.

**The flag WRITE direction (`web/src/flagEdit.ts`, pure — the calcEdit/deleteEdit precedent)** — the selection pill's remaining verbs write Alectryon/LeanInk directives INTO the source, closing the loop with the read pipeline: `.fold` per head, `.none <prose>` (the prose prompt; the ghost shows the sentence), a plain `note…` annotation, `.no-hyps` and `.h#used` (one `.h#name` per ▸-used hyp, `✝` names dropped) above each selected goal's CONSUMER, and `unflag` (removal — **the comment's WHOLE LINE goes, prose included**, by user directive reversing the old keep-the-prose behaviour; see `removeCommentPatch` below). Rules measured by the offline probe (patch → shift the wire one line → run the REAL proofToTree → assert the landing node; 95/95 with 8 honest declines): a flag goes on its OWN LINE above the tactic at the slot's column; a ragged selection NORMALIZES TO HEAD TACTICS (`headTactics` — selected tactics whose producer isn't selected; subtree granularity accepted), **each head then normalized to the FIRST node of its SLOT** (a multi-rule `rw` is several nodes over one slot, so there is one comment line and it attaches to the first — and the returned head must BE that node, or the local view effect folds a different subtree than the next load will); `flagLine` DECLINES `!lineStart` (a `| zero =>` case's first tactic — the comment lands on the truncated `induction` container) and `prevSameLine`. It also used to decline **step-start ≠ slot-start** — every split `rw` — because a leading comment there provably attached to the PREVIOUS tactic; that was a reader bug (see the attribution rules above), and fixing it at the reader made 14 more corpus heads writable. Two seams that must stay paired: **the seed block only fires on a proofKey change, so every writer also applies its view effect locally** (the written flag is the durable copy; `foldTargetsOf` mirrors the seed's landing — including the FIRST-tactic case, where the comment attributes to the ROOT narrative slot whose targets are the tactic node itself); and patches apply **BOTTOM-UP** through `onEditTactic` (each range was computed against the original document; an insertion shifts only lines below itself). Removal needs `TreeNode.flagRanges` — recorded by `attributeComments` separately from `commentRanges` (a flags-only comment claims no strip entry by design) and INDEPENDENTLY of `TreeNode.flags` (hyp directives never reach it; goals get `hypFlagged` so the context verbs flip off). Already-flagged heads flip the verb to removal rather than writing a duplicate; `.unfold` is deliberately never written (`.fold` isn't recursive, so removal covers every real case; the parser keeps reading it).

**Whole-line removal is `removeCommentPatch` (flagEdit.ts), shared by `unflag` and the comment editor's empty commit**, and its veto took two tries to get right: testing whether any slot's SPAN touches the comment's lines vetoed 9 of the corpus's 11 flags (a bullet's or `induction … with`'s slot spans every interior line, comment-only ones included), while pure endpoint tests would eat a `| zero =>` marker line carrying a trailing comment (interior to the induction slot — no endpoint there either). The rule is the CONJUNCTION of two wire-answerable facts: no slot STARTS or STOPS on the comment's lines (slot stops are TIGHT, so a stop on the line means code ends there), AND the comment sits at the COLUMN of the next slot below — exactly the shape `flagLine` writes, so removal accepts what the writer produces; a trailing comment's column is nowhere near the case body's, so it keeps only its own range and the marker survives. Fails either test → the comment's own range only. Covers multi-line block comments (`stop.line + 1`). Patches dedupe by start line at BOTH ends (per node in `removeFlagPatches`, across nodes at the verb) — a whole-line patch applied twice would run its second copy against shifted coordinates. Measured over the corpus (probe: patch the fixture source, shift the wire, re-run the real `proofToTree`): 11/11 pass, 5 whole-line, 6 range-only, every bullet survives, no OTHER node's flags change.

**Gallery (Layout list › Gallery)** — shows ONE of a branching tactic's subtrees at a time (`‹ n/m ›` pager in the `TRUNK_GAP_BRANCH` gap — always visible, the only way to the hidden branches; a tactic with one VISIBLE child still gets the branch gap). Thin by design: `computeLayout`'s `hide` set seeds the existing fold sweep; the `pick` map is keyed by splitting node, read modulo child count (stale entries can't point at nothing). Nested splits compose. Paging does NOT re-center (`shownChild` out of `viewKey`; the trunk above a split is unmoved, so the anchor holds scroll). **The gallery follows the editor cursor via a second resolution path**: `cursorNodeId` resolves against VISIBLE nodes — null exactly when the follow has work — so `galleryTarget` walks `engine.allNodes()` root→cursor, naming the on-the-way child at each split; adjusted during render, guarded on the cursor landing on a DIFFERENT node so it never fights a hand-paged branch.

**To cursor (the reading menu's `to cursor`)** — draw only the nodes whose source START line is at or above the editor cursor's, so the tree unrolls as the reader walks the proof downward (the Alectryon step-through, as a view mode; default OFF: a reading discipline, not a property of the proof). Thin like the gallery and riding the same seam: a per-render memo over `treeNodes` collects ids whose `position.start.line` is past the cursor's, unioned with the gallery's set into `computeLayout`'s ONE `hide` seed (`hideAll`), so the two compose. A goal carries its PRODUCER's position, so a tactic on the cursor's line shows WITH the goals it leaves — the state after the line, which is what the editor itself shows there; root goals (no position) always show; an elide MARKER (positionless by design — layoutKey's tactic↔marker rule) stands on its members' earliest line, the `srcRank` substitution (measured on `flag_demo`: the `.none` ghost appears exactly at its members' first line). The set stores NOTHING — no ids, derived per render from the cursor line reduced to `upToThreshold`, the SMALLEST START LINE the cursor excludes (`l > cursor` ⟺ `l >= threshold`), and the reduction has to go that far: keyed on the raw LINE, every `j` — a comment line, a blank line, a multi-line tactic's continuation — minted a fresh Set, re-ran computeLayout and handed the render brand-new nodes/links arrays for an identical tree (measured ~36-55ms of commit per no-op move; ZERO DOM mutations after the threshold key — this was the felt "rescroll got slower" report). No anchorRoot: a node only moves when a branch above it in the stack grows (measured — walking even_or_odd's cursor moves only the succ goal, pushed down by the zero branch unrolling over it), the fold's own behaviour, and the `[nodes]` anchor plus the cursor follow hold the view. **While the mode is on the cursor follow PARKS the accented node at the top THIRD** (`inViewScroll`'s `park`, `FOLLOW_TOP_FRAC`): everything below the node is what it spawns — the goals not yet read — while above it is the parent already read as a subgoal one step ago, so two thirds of the room belongs below. **A LANDING offset was the obvious version and does nothing**, which is the finding: `inViewScroll`'s comfort band is the whole viewport minus 32px, so a node anywhere on screen returns "nothing to do" and no correction fires at all — changing only where a correction lands left the node wherever the unroll dropped it (measured at **0.71** of the viewport on the reported `refine ⟨p, hp, ?_⟩`) and re-aimed only the rare move that pushed a node off-screen. So `park` switches the vertical DISCIPLINE rather than offsetting the old one: keep-in-view when omitted, put-it-there when given. It costs nothing in stability because the caller's guard is already a real cursor move (`trackedCursorNode`) — a relayout, fold, zoom or scroll never reaches it — and the pager and cf-stub seek keep the band, since a jump to an error is not a reading position. Measured over euclid walking down and back up, every stop parks at **0.333** (0.353 on a comment-carrying node: the park centres INK, so the box sits a strip's half-height lower — correct), against **0.5** for the same moves with the mode off. Verify with waits over ~1.5s: a hidden preview pane throttles rAF AND `setTimeout` to about 1/sec, so a 420ms settle reads the ease mid-flight and reports phantom failures (it did, at 0.703/0.925/1.135). **It clears on `expand all` and on `reset`, and it CARRIES A MODAL BREADCRUMB while it is hiding anything.** The mode is global view state that survives a proof switch (correctly — it is how this reader reads), but it was the one hiding mode with no on-canvas affordance and no gesture that put it back: neither ⌥-`+` (which clears the fold set and every cut) nor `resetToSource` touched it, so a mode switched on by accident read as a renderer that would not draw the proof (the reported "stuck collapsed", by way of the `u` key — see § Controls). Both now `setUpToCursor(false)`; the gallery is deliberately left alone by the reset, being a layout choice. The modal BANNER gains a LAST branch (after `arming`) reading `to cursor · N hidden below the cursor` in `SEQ_STROKE`, the picking indicators' own chrome, whose `✕` is `applyUpToCursor(false)` — so the count says what the mode is costing you and the exit is where every other mode's exit is. Its `layers` entry is LAST of all (after `focus`) and `bg: false`, so Esc reaches it only when nothing else is up and a stray background click cannot take it; that entry's `up` is the MODE rather than the breadcrumb's `upToHide.size > 0` (the memo is declared below the table) and its `off` is the bare setter (`layerOff` is called during render and `showToast` reads a ref — the react-hooks/refs taint). Pressed/disabled rule applied at the one gate left: DISABLED with the reason when there is no cursor (the standalone app without a stub). The second gate — sequence view, whose `only` set bypassed the hide sweep — went with the mode, and `only` no longer bypasses it anyway. The glyph is ⤓ (down arrow TO a bar — growth stops at the line), measured at the shared 14px: 9h ink at cy −1.0, the ⊦ band exactly, uniform across all eight code-font stacks with no tofu, so no `glyphPx`/`glyphDy`. Harness: `?cursor=<line>[:<char>]` stubs `highlightPos` (0-based LSP coordinates) and exposes `window.__cursor(l,c)` so a probe walks the cursor without reloads — the accent and everything cursor-gated was previously undrawable in the preview, the standing stub blind spot. Accepted cosmetics: a goal whose children are all cursor-hidden still draws its fold glyph as if expanded, and frontier chips do NOT appear on the artificial frontier (`pending` is computed over the full tree) — right anyway, since inserting mid-proof is not what the mode is for.

**Side-by-side (Layout list › Side by side, compact)** — a branching tactic's subtrees become COLUMNS sharing one vertical span (leftmost continues the trunk lane; case badges on top). A `computeLayout` parameter (placement only, in `viewKey`), threading y instead of the global cursor. Columns are **contour-packed**: each placed provisionally, its ink collected as horizontal spans over y-ranges, slid left until its ragged profile sits `BRANCH_COL_GAP` from the previous at nearest approach. Two load-bearing parts: the spans include CONNECTOR ink (`linkSpans` MIRRORS the renderer's routing — change one, change both), and the split's own parent links feed the contour only AFTER packing (their over-the-top horizontals span the gaps being closed). Shifting after placement is safe (links hold `PlacedNode` references) but forces `width` to be computed after all placement. Column links are TAGGED (`PlacedLink.col`) and routed over the tops — the stacked elbow would cut earlier columns. Pairs with ¶ reflow.

### Reflow (rail ¶)

Re-wraps labels AND comment strips at a narrower budget — a `createLayoutEngine` option (geometry; engine rebuilds). **The budget is CONTINUOUS, in COLUMNS, set by a slider the ¶ button expands into** (`ReflowMode = "off" | number`; the number is what `budgetFor` multiplies by `CHAR_W`, so the readout IS the setting). One click engages `REFLOW_CHARS` (44); range `REFLOW_MIN_CHARS`…`MAX_CHARS` (the top of the range is continuous with `off` — same width the tree wraps at anyway, differing only in reflow's own rules); **`off` IS the top notch** (`REFLOW_OFF_STOP`), so leaving the mode is the same gesture. The COLUMN is out of `viewKey` — only on/off re-centres; a slider step is steadied by the `[nodes]` anchor (measured: 0px drift at the viewport centre). Per-step cost ≈ one engine rebuild (~2–3ms) — no debounce needed. The panel opens LEFT (the rail is on the right edge), dismissed like every transient surface; closing never changes the setting.

Wrapping rules: **seams are four tiers** — 3 clause (comma/semicolon, connectives, binders, tactic keywords), 2 GROUP (previous word closes a bracket or next opens one — below clauses deliberately: `(2 ≤ n → …)` should split at a nearby `∧`, not the paren), 1 relation, 0 none; a seam DEMOTES one tier at bracket depth > 0 (breaking inside `⟨…⟩` splits a unit). A token made entirely of operator glyphs may never END a line (break BEFORE the connective, so the continuation starts with it). **Reflow breaks EAGERLY** — earliest seam past a fill floor, even when the remainder would fit: a box is sized by its widest line, so "latest that fits" buys nothing; gated on the line being actually long (`EAGER_MIN_SEG`, against the text REMAINING, which also stops re-splitting a wrapped tail). The two floors are deliberately different numbers (`SEAM_MIN_FILL` 0.4 vs `EAGER_MIN_FILL` 0.3 — they protect against different things; sharing one measurably picked worse seams). Eager applies to labels and comments, NOT hyp lines (it cost 18 more lost type tooltips for 2% width). **Indentation is per line** (`WrappedLine.indent`; measurer and render must agree): `flat` (hang by `CONT_INDENT`), `nested` (reflow: + `bracketDepth × NEST_INDENT`, capped at 40% of budget), `none`. Comments take `none` in BOTH modes — a strip is PROSE — **and `none` also switches the wrapper into PROSE mode**: greedy word-fill, seam machinery OFF (those tiers break a sentence at `+`/`=` mid-formula). Comment prose is cleaned first in `stripComment`: markdown delimiters removed (`**`, leading `#`, `` `code` `` → text with inner spaces made non-breaking so a formula stays one token; single `*` left alone — multiplication), and soft-wrapped source lines re-joined (single newline → space, blank line → paragraph). **The load-bearing discovery: labels were never the binding constraint** — most wide boxes are width-bound by their widest context line, so reflow wraps HYPS too and pays exactly where it falls: a wrapped hyp line stops matching by text and loses its type tooltip; unwrapped ones keep theirs. The invariant to re-check if retuned: `lineOffsets` still reconstructs every node (goal tooltips and token colouring depend on it).

### Delete and undo (widget only)

Two gestures split by node type: the hover bar's TRASH CAN on a TACTIC removes it and any block it OWNS (spawned goals if any, else `goalsAfter` only when `length > 1` — a lone continuation must stand); the same button on a GOAL clears everything below, returning it to the frontier where the chips take over. **The unit is a `TacticSlot`, not a step — forced**: step ranges are wrong in both directions (`intro p hpm` is one step covering `intro p ` alone; `induction … with` is truncated at its first case marker), and `surfaceTacticRange` cannot bridge it and **must not be loosened** (its alignment behaviour is load-bearing for tokens; delete wants the LARGEST container where colouring wants the smallest). `tacticSlots` (ProofTreeComments.lean) descends syntax and emits the DIRECT CHILDREN of every `tacticSeq1Indented`/`tacticSeqBracketed` — a direct child IS one tactic as written. (Not `collectTacticRanges` — a flat kind-less list where a `tacticSeq` shares its first child's offset, so any largest-container rule swallows the block.) Each slot carries `index`/`count`, `blockStart`, and three LEXICAL facts the client can't know (it never holds document text): `lineStart`, `tailIsTrivia`/`tailStop`, `prevSameLine`. The whole set ships; the client joins by CONTAINMENT.

`deleteEdit.ts` is pure (probe-driven, the `calcEdit` precedent): extent = `slot(node) ∪ slot(subtreeLastStep(g))` over owned goals, lifted into ONE block; **whole-line** when `lineStart && tailIsTrivia`, **exact-range** otherwise (`· intro h` — whole lines would eat the marker), **declined** on `prevSameLine` (`intro n; simp` — the one destructive gesture should refuse rather than guess), **`sorry`** when the extent takes every child of its block (the extent's start IS the block's indent; the `·`/`| case =>` marker is never inside the extent and survives — it must, or the case becomes "alternative not covered"). An own-line comment above the extent goes too (`attributeComments` gave it to the deleted node), with two floors: never the previous sibling's last line, and for a block's FIRST child never above `blockStart` (a bullet and comment share a line in the corpus; extending deleted the `·`). **One click ARMS** (the can → extent lights in the buffer, nodes inside dim, bar becomes a `delete N lines`/`replace N with sorry` chip + `×`); only the second click writes — what lets a destructive control live in a hover bar. **HOVERING the can, before arming, fades exactly what it would take** (`deletePreview`, the ◌ preview's shape: `{anchor, ids}`, 0.35, anchor never fades since the bar rides inside its `<g>`, cleared on the button's leave and on leaving the node). **The preview and the armed dimming ask one question and must ask it once**: `extentIds(extent, anchorId)` — position containment over the drawn nodes, anchor always in — is the one coding, read by `armedIds` and by the hover; measured in the harness, preview set === armed set, 23 nodes both, on a `refine` taking the whole proof. **The armed row is SHIFTED clear of the descending lane and sits on an opaque card, and it needs both.** Its transform was `an.x - w/2 + TRUNK_INSET`, which IS the x a connector drops at, so the trunk ran 10px inside the confirm chip and straight through the label — unreadable on a dashed unfilled chip. Measured over the corpus in ☰: **116 of 186 armable tactics crossed, every one at that single offset of 10** and the `×` chip never. The shift is the frontier chip lane's own rule and gate (`drawnParentIds`), offset from the CARD's edge rather than the chip's since the card is what would cover the lane. The card is the selection pill's, for the half no shift can reach: **⑃ wide draws splayed Béziers that cross the row at every offset across its whole width** (9/24 confirm and 8/24 `×` chips, one at 99 sampled points spanning 566→704 of a 566→730 chip), and a shift is defined against a lane that mode does not have. After: **0 crossings in ☰ over all 186**, the card's own rect containing 0 path points, and wide's crossings occluded (the card is opaque and every crossing path precedes it in document order). **The row still reserves NOTHING** — arming must not shift the tree at the instant the reader is aiming at a destructive confirm, and it costs nothing: the row wants `CHIP_TOP_GAP + CHIP_H` = 23px where a tactic is followed by `TRUNK_GAP_BRANCH` = 24 (0/186 overlap any box). Known and NOT fixed: in `||` tracks one row of 24 clips 4px off the box below, pre-existing and identical before and after, because the shared track's floor reserves nothing for a lane it cannot know about — and buying those 4px means reserving space. `arming` holds ranges, dismissed everywhere `picking` is **plus on `docRev`** (the real staleness protection — the human-latency window). The preview rides its own relay action (`preview`, not `highlight`, whose one-line clamp is wrong for a multi-line extent). Suppressed on combined/elide markers and the synthetic calc node; not offered where `deleteExtent` declines. The mutation-classifier discipline from verification is worth keeping: **benign** (unsolved goals/sorry) is the deletion working, **semantic** fallout (type mismatch under a deleted `intro`) is what the gesture means, only **structural** (parse failure, a `with` losing a case) is a bug — and the test must be narrow ("expected" also appears in "is expected to have type"). The sweep worth rerunning: extents never CROSSING a slot boundary (half-in-half-out; ancestors properly containing are fine).

**Undo/redo**: every widget edit leaves focus in the webview, where ⌘Z reaches nothing. `undo`/`redo` are focus-dependent VS Code commands with no document-targeted API, so `runEditorCommand` (companion) resolves the editor for the uri (lens via `findLensColumn`, else visible), focuses it, executes — focus moving to the editor is the better behaviour anyway (subsequent ⌘Z is native). Rail `↶`/`↷` plus a document keydown skipped inside textareas. Both are explicit branches BEFORE the companion dispatch's `else` (unknown actions fall through to `popout`). **`documentChanges` (versioned edits) was checked and rejected**: vscode-lean4 runs `asWorkspaceEdit` + `applyEdit` directly — the version guard lives only in vscode-languageclient's server-initiated handler — so the version is silently dropped and a non-conforming edit is a silent no-op. Deletes stay on `changes`; safety = disarm-on-`docRev` + slots riding the version-keyed `proofTreeCache`. Known edges, accepted: a tactic inside a combinator (`try simp`) resolves to the inner slot (yields `try sorry`; still parses); all four nodes of a multi-rule `rw` share one slot/delete; the armed dimming keys on positions, so a goal produced by the deleted tactic dims too. Deleting an individual `calc` link is out of scope (links restate each other's endpoints). `deleteSlots` rides the CLI wire too so probes can run the real extent math offline.

### The signature header (widget only) — chrome, and the focus trail

A bar pinned above the canvas showing the theorem the tree belongs to. The statement is VERBATIM SOURCE (`ProofTreeData.declHeader` + `declHeaderTokens`/`declHeaderStart`, rendered through the same `renderTacticTokens` the labels use), not a pretty-print — nothing here may round-trip through the elaborator. **Both boundaries are measured, not guessed**: it starts at the `theorem` keyword (`Command.declaration`'s second child), never `declRange.start`, which opens at the DOCSTRING (14 lines of prose in the reported case; the docstring belongs to the tree's comment strips, not to the identity line); it ends at the earliest `byTactic` start + 2, i.e. through the `by`, or it runs into the body's own comments.

**At rest it is ONE line; hovering THE STATEMENT expands it into an OVERLAY.** The hover target is the text, not the bar — opening on the bar meant crossing the header at all, on the way to the pill most of all, dropped a full statement over the tree. A statement is routinely six lines of binders and conjuncts, and a header that tall is no longer chrome — it is a second pane the proof has to live under. The first source line carries the keyword and the NAME, which is what identifies the theorem; two truncations then say different things — an explicit `…` for lines not drawn (a fact about the source) and the CSS ellipsis for a first line too wide (a fact about the window). **The expansion must not move the tree**: `hdrH` is what every floater and the scroll box offset by, so the ResizeObserver is simply NOT SUBSCRIBED while expanded (state in the effect's deps, not a render-written ref — the house lint refuses those) and the collapsed height stands. Measured: 29px → 77px drawn with the root node's viewport top unchanged to the pixel. Expanded it also rises to z 11, ABOVE the floater stack (which offsets by the frozen height and therefore drew straight through the statement), and stops at `right: 38` so it never paints over the rail. **Each source line is its own block** — `renderTacticTokens` returns a node PER LINE, and rendering them inline into a `pre-wrap` box dropped every line break and turned the source's indentation into gaps mid-sentence (reported as "whitespace is all weird"); continuation indents are kept, since that is the author's own layout.

**The SCOPE — focus or path — rides the header as the trail's second segment** rather than a floater of its own: the two answer different questions (which theorem / which part of it) and both stay true at once, so the statement yields — collapsing to `declHead`, keyword + name — instead of being replaced. **They never share the bar in the OPEN state**: reading the whole statement is a different act from navigating out of a subtree, and an expanded statement left the pill marooned at the end of its last line, which is what made the pair read as one confused control; it returns when the pointer leaves. **`declHead` keeps its COLOUR**, by going through `renderDeclHeader` as a stand-in LABEL — `alignInLabel` returns the segments where label and source agree character for character, so the truncated head aligns and the `…` past it does not. Measured on four live payloads: the `commonPrefix` branch claims 21-30 characters and exactly two tokens land inside it, `keyword` (the `theorem`) and `const` (the name — unmapped for colour by design, so it inherits the foreground and keeps its popup). **The pill NAMES the branch** (`caseLabel` — `succ`, `refine_1`, `left`), falling back to the goal text truncated from the TAIL: sibling goals share a prefix and diverge late, so a head cut made every branch of a proof read the same. **How long that label may be is MEASURED, not a constant** — a fixed 34 left most of a wide panel empty and overflowed a narrow one: the bar's own width comes off the same ResizeObserver as its height, and the room for the label is that minus `measureText(declHead)` (exact, same font) and the fixed chrome. Erring SHORT is free — the slack goes to the statement, which then draws in full instead of being squeezed — while erring long hands the cut to the CSS ellipsis, which takes the TAIL, the half the truncation exists to keep. The trail is a FLEX ROW: the statement shrinks ten times as readily as the pill, and inside the pill `◎` and `✕` are `flexShrink: 0` so the last thing to give is label text and never the way out. A `maxWidth` pill plus an `overflow-y` on the bar (which computes `overflow-x` to `auto`) had scrolled the `✕` out of sight, reported as missing; verified at a 260px viewport — statement clipped to 56px, pill whole, right edge exactly inside the rail gutter. **Padding is written as the SHORTHAND in both hover states, never shorthand-plus-longhand** — React clears a longhand it stops seeing by writing `""` over that property, which does not restore the shorthand's value, and the resting bar silently lost its entire 46px rail gutter (React warns about this in the console; the computed `paddingRight` is the check). Click REVEALS (`onRevealHeader` → the companion's lens-aware reveal) and the segment's own click EXITS the scope — one verb per segment, `stopPropagation` at the seam. **ONE segment serves both modes** (they are mutually exclusive): `scopeKind` picks the glyph and the exit — `◎ <label>` for focus, `⊹ path · <label>` for the path scope — over one `scopeNode`/`scopeLabel` pair, so the trail cannot grow a second shape. Editing the statement here was built and REVERTED by user directive: a statement deserves completion, colouring and the full IDE, so starting a proof belongs in the source. There is no `<title>` — the bar says what it is.

### Controls

All view controls live in a **STATUS BAR of words** — a FLOATING CARD along the bottom of the tree (`StatusBar`) — plus a THREE-button rail in the opposite corner, `+ − ⛶` (`ZoomRail`, glyph-only `RailButton`s, bottom-RIGHT). **The `⊹` picking menu is GONE with the three PICKING MODES it held** (below). The `?` reference is the BAR's last item, not the rail's (below). Bar order, left to right: `Layout: outline` (its list also holds the two layout TOGGLES, below) · `Context: used` (rows `used · intro · diff · all`, plus a `Split data & props` row for `hypGroup`, UNCHECKED at rest — Lean's own binder order is the default and checking it groups the context data-then-propositions with the hairline divider; the checkbox names what it DOES, where `binder order` named the off state and read as backwards) · `Comments: show` (rows `show · hide · narrate`) · `Width: full` / `Width: 44 col`, opening the width slider and reporting the EFFECTIVE value (`forcedReflow ?? reflow`) — the value is the COLUMN COUNT and nothing else, the tracks override living in the title, where `44 col (tracks)` used to spend 60px of the one row on saying why · an EYE (reading options — `brief`, `merge`, `to cursor`, below) · `↺`, which is `resetToSource` (`Reset tree`, in its title and its toast) · then, right-aligned, the diagnostics item (`DiagnosticItem`, the old `DiagnosticPill`'s content: `⨯`/`⚠`, the `‹ n/m ›` pager, the truncated first message line, capped at 320px). Popovers open ABOVE their item (`bottom: 100%`) on `POPUP_CHROME`, one at a time (`barOpen: string | null`, whose `layers` entry `barPopover` is FIRST — the cheapest thing Esc can take); the rail now carries no menu at all, so `MENU_PANEL` is the bar's chrome alone. The card is AS WIDE AS ITS CONTENT and the row NEVER wraps: as the frame narrows the four value items drop to GLYPHS one at a time, RIGHT TO LEFT, measured rather than guessed (see THE BAR FLOATS below).

**HAIRLINE DIVIDERS mark the row's three group boundaries** (`BarDivider`): after the four value menus, which say how the tree is DRAWN; after the reading eye, which says how much of each node you are asked to READ; and after `↺`, an ACTION rather than a setting — leaving `?`, the INDEX of the row rather than a member of it, on the far side (the third was added by user direction, "need divider between eye and ?", so the row reads `| eye | ↺ | ?`). They were taken out once, on the argument that with the writers behind their own menus the row had become one short list and a rule between them claimed a grouping nobody was asked to hold; that argument does not survive the row having three KINDS of thing in it, so they are back. 1px of `--vscode-editorWidget-border`, 14px of the item's 20, `alignSelf: center` — so they cannot reach the card's height — and they ride INSIDE the always-glyph group, whose ghost carries its own gaps, so `fit` measures them with everything else (measured: `fixedW` **93** = 3 × 1 + 26 + 22 + 22 + 5 × `STATUS_GAP`; it was 88 with two). The `?` button is declared apart from the group — the diagnostics block drifts between it and `↺` in the real row — but its divider belongs to the group, whose ghost is what `fit` measures. They cost the row 15px, 5 apiece.

**THE THREE PICKING MODES ARE REMOVED** (user direction) — sequence view (`Seq`, `engine.pathBetween` fed to `computeLayout`'s `only`, `toggleSequence`), path-elide (`elidePick`, `commitElide`, `ElideCut`'s `"path"` kind, `pathIds`) and band-elide (`bandPick`, `commitBand`) are all deleted, with their `layers` entries, their modal banners, their `remapIds`/stash/reset branches, and every `seqActive` gate (the gallery's disabled reason and `upToEnabled`'s sequence clause each simplify to the remaining condition; the node loop's dozen `seq.mode === "off"` gates simply go). A mode that took over every click on the tree is a mode you have to be told how to leave; the two things they bought — a scoped reading and a swept skip — are the `⊹` path gesture and the marquee's `skip` verb, neither of which arms anything.

**`⊹` — ONLY THIS PATH** (U+22B9, hover bar, on goals AND tactics): show `ancestors(N) ∪ subtree(N)`, i.e. the root→N chain plus everything under N. Scoping VIEW STATE (`pathId`) handled exactly like `focusId` — remapped by `remapIds` on a shape change, stashed and restored per proof, cleared by the proof-change reset and by `resetToSource`, its own `layers` entry beside `focus` — and MUTUALLY EXCLUSIVE with focus, each setter clearing the other. `⊹` on the path root toggles it off (◎'s rule on the focus root); ⌥-click stays focus. It is fed to `computeLayout` as the `only` set, the seam sequence view used, computed over `engine.allNodes()` with EVERY ancestor walked (not just `parents[0]` — a band marker inherits several, and dropping one cuts the chain it stands on). Two details: **`only` now NARROWS rather than SUSPENDING the fold** (one line in `layout.ts` — sequence view skipped the hidden sweep entirely, so under it a fold click flipped the glyph and moved nothing; measured after, folding a goal inside a path scope takes 12 drawn nodes to 7), and **entering unfolds the chain and the node itself** (`pathOn`, `focusOn`'s rule), or a scope promising "the way here" could draw nothing. The glyph resolves (8.88px of advance at 13px against the tofu box's 7.83 — the ⬚ trap re-checked; it inks 6.88 × 7.00 where a genuine tofu at that size inks 8 × 12). It is the `⦿` (U+29BF) this replaced, changed by user direction because the target cross reads as "this one, and the way to it" where a filled bullseye read as a second focus glyph; it is also the mark the removed picking menu used, so the vocabulary is reclaimed rather than grown. Its `glyphPx: 15` is above. Measured in the harness: `⊹` on a `ring` four levels down takes 25 drawn nodes to 8 — the root goal, `refine`, two goal/tactic pairs, the ledger and the node — with the breadcrumb up; `✕`, Esc and `reset` each return 25.

**EVERY ITEM IS `Name: value`, IN WORDS, and the values are LOWER CASE** (`Layout: outline`, `Context: used`, `Comments: show`, `Width: full` / `Width: 44 col`) — one `name` field per mode table, read by the item label, the popover row and the toast alike, so the three cannot drift. **The TEXT form carries no icon.** Two of the four (Comments and Width) drew their icon in place of their name, on the argument that the value already implies the subject and the row's whole budget is the frame; the author's reading of the shipped row was the other way round — a row that says `Layout:` and `Context:` in words and then falls silent for two items reads as two controls with their labels missing, not as two labels abbreviated. So the icons are the GLYPH FORM'S BUSINESS ALONE, which is where an abbreviation is the point: they stand for the item only once the words have already gone (`CommentGlyph`, `WidthGlyph`, each tagged `data-ptw-glyph`, drawn beside `☰ ⊦ || ⑃` and `▸ λ Δ ∀` in the same fixed `GlyphBox`). **They are INLINE SVG in the eye's idiom** — a `viewBox` cropped to its own ink, `currentColor`, 1.25 stroke, no fill — drawn the way VS Code's own codicons draw them: `comment`, a rounded rectangle with a tail off the bottom-left, path ink measured **10.00 × 9.20** (≈ 11.25 × 10.45 with the stroke); `word-wrap`, two text lines the second of which ends in a return arrow hooking down and back to the left over a short third line, path ink **10.00 × 8.10** (≈ 11.25 × 9.35). Both have been redrawn twice on report — `❝` and `↔` first (typographic marks the author read as punctuation the bar had left in rather than as controls), then codicon `arrow-both` (which says "this much room" and reads as a resize handle where `word-wrap` says where the line BREAKS, which is what the setting sets), then the shapes above, given verbatim by the author. A drawn icon also inks the same on every font stack, which no character in this row can promise. **The TITLE always keeps the word** (`Comments: hide — …`, `Width: 44 col — …`, `reset — …`), so a glyph abbreviates the label and never the explanation. **The notation is GONE** (`Γ used` / `λ binders` / `Δ diff` / `∀ all`, and `Outline`/`Spine`/`Tracks`/`Wide` as bare capitalised words): a glyph a reader has to be told the meaning of charges for the abbreviation twice, and it dragged a whole apparatus behind it — `NotationLabel`, `BarGlyph`, `BAR_GLYPH_PX`, and the measurement that forced them (at 12px of the bar's system UI font Γ inks 8.46px against ∀'s 6.66, so the four had to be painted in the TREE's code font at 13px to ink within 0.4px of each other, i.e. a second font stack inside a row of words). `HYP_MODES` therefore keeps `name` alone; `hypModeText` is gone with the glyph it composed. What the flex-container lesson leaves behind is still true: a flex container DROPS whitespace-only text between its items, so the gap between a name and its value is a `gap`, never a space. **THERE IS NO DISCLOSURE MARK** — no `▾`, and no drawn `ChevronDown` either (both have now been in this row and both are deleted). The triangle put two triangles of two different meanings in one line (`▸ used ▾` — the context breadth's mark and "this opens a list"); the chevron that replaced it was quieter and still spending width, in a row whose whole budget is the frame, on a mark the item's own affordance and its title already carry. Neither `?` nor `↺` ever had one.

**⌥-CLICK ON AN ITEM ADVANCES ITS SETTING** — `Layout`, `Context` and `Comments` each carry a `next` in their mode table (`stacked → spine → tracks → wide → stacked`; `used → new → delta → full → used`; `shown → hidden → instead → shown`), and the modifier runs it through the SAME `applyX` wrapper the popover row calls, so a cycle toasts and anchors exactly as a pick does. Plain click still opens the list; the titles say `⌥-click: next`. It is `BarMenu.onAlt`, an optional prop, so a menu with no cycle (the width slider, the reading toggles) simply opens on either gesture. This is the single-letter keys' replacement in the one place they were worth having and the one place a vim key cannot be typed by accident — see "THERE ARE NO SINGLE-LETTER SHORTCUTS" below.

**ONE HEIGHT — AND THE ACCENT READS AS A PILL. Both are the same set of numbers.** The card is a fixed `height: BAR_H` (26, the host button's own) and every item a fixed `BAR_ITEM_H` (20) with `alignItems: center` and ZERO vertical padding — never a `min-height`, never a line box — because the row's content changes FONT: the compact glyphs are drawn in the TREE's code font at their own `glyphPx`, up to 19 for `▸`, so an item sized by its line box grew when the row compacted and again when a short value was swapped for a long one. Reported as exactly that, and the answer is structural: no font size may reach the layout at all. Every glyph — a compact mode mark, one of the drawn SVG icons, `↺`, `?` — therefore sits inside a `GlyphBox` of FIXED size (`display: inline-flex`, centred, `height: 20`, `width: 14` for the pictorial marks and `10` for the two text ones, `line-height: 1`, `overflow: visible`). 26 = 20 + 2 × `STATUS_PAD_Y` (2) + 2 (the card's border), and the item's `borderRadius` is half its height, so an accented item's highlight is a PILL with margin on all four sides rather than a block filling the card. Measured over all twelve Layout × Context × Comments values and every Width value from `full` to `100 col`: card **26.00 px** tall everywhere — **227.00** wide in the all-glyph row, **526.73** with the words (re-measured after the third divider went in; it was 222.00 / 521.73 with two — the slots are absolutely positioned inside the item's 20px box, so every one of these numbers is the same with all six lit and with none) — every item **20.00** tall, pill inset **3px** top and bottom. `BAR_ITEM_PAD_X` has come down twice, both times to buy row width — 10 → 8 when the glyph prefixes went in, 8 → 6 when the card moved into the host button's lane and gave up 68px of room on its right; six is where VS Code's own status-bar items sit, and below it the pill stops reading as a pill. The card is `fit-content` inside that lane and the row never wraps; see THE BAR FLOATS below.

**STABLE WIDTH: an item never changes width when its VALUE changes.** Each text item RESERVES its widest value — measured in the ghost over every value it can take (`outline` against `tracks`, `intro`, `narrate`, `100 col`) — with the text left-aligned inside that width; in glyph form the box is a fixed width, so `▸` → `λ` moves nothing either. Measured: cycling Layout, Context and Comments through all of their values and walking Width over 20 / 44 / 100 / full leaves the card's width and EVERY item's rect byte-identical — ONE signature across all sixteen states in the full row (`526.73`, items 96.50 / 91.79 / 121.51 / 93.94 — the Context item was 106.79 under `binders`) and one across all eleven in the all-glyph row (`227.00`, every value item 26.00). The EXTRAS SLOTS are held to the same promise and measured against it: all six off, all six on, and a mixed state leave the card and every item rect byte-identical (`526.73` / `297.50` in the two forms tested), because the slot group is `position: absolute` inside the item's own box and every slot reserves its width whether set or not.

**SIDE-BY-SIDE AND GALLERY ARE LAYOUTS, so they live in the Layout LIST** — below a divider, under `Outline · Spine · Tracks · Wide` — and not as chips of their own out on the bar: they change how a split is DRAWN, which is the layout item's whole subject, and a list (unlike the cycle the rail's glyph button used to be) can hold a choice and its modifiers together. The four layout rows are a CHOICE and close the popover; the two below it are TOGGLES, so they carry the check/dot mark `Split data & props` does and leave the popover OPEN — you may want both. `side-by-side` keeps the disabled reason its chip carried (it needs a compact layout, so it is disabled in Wide); `Gallery`'s disabled reason went with sequence view and it is now always available. The ITEM's label stays the layout's name while its accent follows the pressed rule for all three settings at once: `layout !== "stacked" || (sbsEnabled && sideBySide) || gallery` — accented only where the drawing actually differs. Both go through toasting wrappers (`applySideBySide`/`applyGallery`, `Side-by-side on/off`, `Gallery on/off`) like every other setting, so a click says what it did.

**THE READING OPTIONS ARE A MENU BEHIND AN EYE** — `brief`, `merge` and `to cursor`, the three toggles that change how much of each node you are asked to read. They were three loose words out on the bar, which is exactly the room a one-row card does not have; behind one head they cost 34px. Toggles, so every row leaves the panel OPEN (the Layout list's rule) and the head ACCENTS while any of the three is effective (`brief || combine || (upToCursor && upToEnabled)` — the pressed rule, so `to cursor` counts only where it is enabled). `brief`'s row carries `onMouseEnter`/`onMouseLeave` through `BarRow.onHover`, so hovering it still drives the in-place underline preview of what brief would elide (measured: hovering the row draws 6 preview rects, leaving clears them). The head's glyph is an inline SVG eye — an almond outline and a pupil, `stroke: currentColor` — never an emoji or a font glyph: the bar has exactly one pictorial mark and it must ink the same on every font stack and in every theme.

**THE BAR FLOATS, and that is not decoration**: it lives INSIDE the infoview document, so a full-width strip pinned to the bottom edge claims to be VS Code's own status bar when it is nothing of the kind. So it is a card IN the host button's own lane, `position: absolute; right: BAR_RIGHT_RESERVE; left: auto; bottom: 10; height: 26` — the button's own inset and height, so the two read as one row of chrome (and see the frame paragraphs: that placement is what lets the frame take all the room there is); `border-radius: 4`, a 1px `--vscode-editorWidget-border` on ALL sides and a DROP SHADOW of its own, `0 2px 8px rgba(0,0,0,0.35)` — `POPUP_CHROME`'s shadow one step deeper, written after the spread so the popovers keep their 0.25. The card floats over the tree's own canvas, where the hairline alone left it reading as ink drawn on the page rather than as a thing lying on top of it. **IT IS ANCHORED ON ITS RIGHT EDGE, and grows LEFTWARD** (user directive: "anchor the right edge of the status bar with the `?` then flex the space to the left so the distance between the end and the restart file button never changes"). Left-anchored and `fit-content`, the card grew rightward, so every setting that lengthened a value — and every step of the compaction ladder — moved the row's last item (`?`) closer to or further from the host's button; the gap that matters is the one to that button, so that is the edge that is pinned and the growth goes left into empty canvas, where nothing is measured against it. Measured at seven frame widths (1200 / 900 / 760 / 680 / 600 / 520 / 460): the card's right edge is **110.00px** in from the frame's at every one of them — `BAR_RIGHT_RESERVE` exactly, the lane constants' one coding — the card **26.00** tall at every one, and the left edge simply follows the content (frame 1200 → card 521.73 wide with all four values in words, 600 → 453.80 at three, 520 → 358.29 at two, 460 → 292.50 at one). **It IS AS WIDE AS ITS CONTENT** — `width: fit-content` with `max-width: calc(100% − 118px)`, the 118 being the button's reserve on the right (where it is now anchored) plus the 8px clearance it must leave at the far LEFT (`LANE_INSET` 10 + `LANE_BTN_W` 96 + `LANE_GAP` 4 — the button re-measured in the running editor at ~95px, and 4px is the gap between two items of chrome in one lane, where 8 was a guess; the two together give the words **8px** more room, and the same constants are what `fit` subtracts, so there is no second coding to keep in step. the zoom rail no longer reads `LANE_GAP` at all — it has its own `RAIL_INSET`/`RAIL_LANE_GAP` pair, below) — because a card stretched ACROSS the lane reads as a strip claiming room it is not using, and the slack sat between the settings and the diagnostics item. The reserve used to be 58 (the zoom rail's column); the rail has moved above the button and the card has moved into its lane, so the card now buys the frame's full height at the price of 68px of its own width. **What the ghost is measured against is therefore the LANE, not the row** — with `fit-content` the row's own width is what it already draws, which in compact is the glyphs, so measuring it would latch compact forever; `fit` reads `offsetParent.clientWidth` (the containing block the card's `100%` resolves against) and subtracts the same `118 + 2 × 6 + 2` the CSS does — **unchanged in VALUE by the right-anchoring**, which is why the compaction ladder is exactly where it was: nothing in `fit` reads the card's position at all. **The popovers are unaffected too**: `BarPanel` is placed by its item's `offsetLeft`, which is relative to the CARD, and the card is still the nearest positioned ancestor — measured, every panel's left edge lands on its item's to within 0.5px at a 1200px frame and at a 460px one alike. The ResizeObserver moved to that parent with it: the card's own box no longer moves with the frame. **It is ONE ROW, ALWAYS.** Both other answers were reports: `overflow: hidden` alone silently LOSES items off the right end (measured: a 432px frame dropped everything past `Comments: show ▾`), and `flex-wrap: wrap`, which replaced it, buys those back by growing a second row OVER THE TREE — the one thing a bar living on the tree's own canvas must not do (it is affordable at all only because the tree flows UNDER the card: the scroll container reserves nothing, and `PAD_Y` is a full viewport of padding below the content). **What a narrow frame gets instead is PROGRESSIVE COMPACTION: the same items, the same order, the same menus, drawn as GLYPHS one at a time, RIGHT TO LEFT** — `kText` is how many LEADING value items keep their words, so Width goes to its glyph first, then Comments, then Context, then Layout, and the three glyph-only items (the reading eye, `↺`, `?`) never change. One boolean — every word in the row vanishing on the same pixel — was the reported "abrupt transition". The glyphs are `☰ ⊦ || ⑃` for the layout and `▸ λ Δ ∀` for the context breadth, the two drawn ICONS standing alone for comments and width, with the words moved into the `<title>`, which they were already carrying. They are drawn in the TREE's code font, never the bar's 12px system UI font, and each carries its own SIZE (`glyphPx` on `LAYOUT_MODES`/`HYP_MODES`, the rail's rule: the target is equal INK HEIGHT, not equal font size). Re-measured on the raster because a flat 13px was reported as "wide too small, tracks too big, spine too small" — ink w×h at 13: `☰` 8×7, `⊦` 4×8, `||` **10×13**, `⑃` 6×7; and `▸` 6×5 against `λ` 8×10, `Δ` 8×9, `∀` 8×9. With `glyphPx` (☰ 14, ⊦ 14, || 8, ⑃ 15; ▸ 19) they ink `☰` 9×8, `⊦` 5×9, `||` 6×9, `⑃` 7×8 and `▸` 8×8 — every mark within 1px of its neighbours' height, and the context four within 0 of each other's WIDTH as well. Two facts worth keeping: `||` is the ONLY one of the eight that comes from the editor's own font (every code font carries `|`, none carries `☰ ⊦ ⑃ ▸`, which all fall back to the same face), so it is the only one whose ink moves with the user's font — 6×9 at 8px in Menlo/DejaVu against 3×6 in Consolas, and the value is chosen for the taller, macOS-default face; and it is two FULL-EM bars, which is why it takes a number so much smaller than the rest. **The switch is MEASURED per item, not a breakpoint** (`fit`): a hidden GHOST of BOTH forms of every item, `aria-hidden inert`, `visibility: hidden`, `width: max-content`, reports four numbers — `chromeW[i]` (the text form with its value EMPTIED, i.e. padding, name, gap), `resv[i]` (the widest that item's value could ever be, over every value it can take), `glyphW[i]`, and `fixedW` (the three glyph-only items as one group, so their own gaps are counted). `textW[i]` is then exactly `chromeW[i] + resv[i]`, and `kText` is the largest k whose row fits. It CANNOT OSCILLATE: every measured width is independent of `kText` (the chrome ghost carries no value, the glyph boxes are a fixed width, `resv` is over the whole value set) and the room comes from the FRAME rather than from the card's own content, so neither input moves when the output flips — no hysteresis at all now, where the boolean needed 1px of noise margin. Re-measured at a stub-harness frame of, after the right-anchoring (which does not move the ladder — `avail` is unchanged in value): **1200 / 900 / 760 / 680 → all four in words** (card 521.73), **600 → 3** (Width to its glyph, card 453.80), **520 → 2** (card 358.29), **460 → 1** (card 292.50) — with the card 26.00 tall and its right edge 110.00 in from the frame's at every one of them. The ghost must carry every non-shrinking item the row draws, `?` included: leaving it out measured the row short of what it drew and clipped the last button off at a 504px frame. The diagnostics block is deliberately OUT of it — `flex: 0 1 auto` with an ellipsis, so it yields on its own and must not drag the row into compaction. `fit` runs from a no-dep `useLayoutEffect` (a setting's own label changes width) plus a ResizeObserver on the card's PARENT, and declines a measurement with no client rects for `useFrameOffset`'s reason: a 0 there is the absence of an answer, not a width. **Verify the return trip with a SCREENSHOT** — a hidden preview pane throttles ResizeObserver delivery, so resizing from a script alone leaves the row in the state it was in until a frame is forced. **THE BAR HAS NO DIVIDERS** (`BarDivider` is deleted): with the writers behind their own menus the row is one short list of settings, and a rule drawn between them said a grouping the reader was not asked to hold. **A popover parented to its own item would be clipped by the row**, so a bar menu is still only ever the BUTTON: it reports its x through `onToggle` (`offsetLeft`, i.e. relative to the card, which is the nearest positioned ancestor) and `BarPanel` draws the panel as a SIBLING of the row, hung upward from the CARD (measured: each panel's left edge lands on its item's, 3px above the card).

**ONE ROW IS THE TARGET, AND WHERE EACH ITEM GIVES UP ITS WORDS IS MEASURED, NOT ASSUMED.** Re-measured after the chevrons came out and the two icons went back to words, the resting row is `Layout: outline` **96.50** · `Context: used` **106.79** · `Comments: show` **121.51** · `Width: full` **93.94** · eye **26** · `↺` **22** · `?` **22** plus six 4px gaps = **512.74px** of content with every word (card **526.73**), against **198.00** with none (card **212.00**); a value item costs 68 to 96px of row to keep its words, and dropping the chevron gave 12px back to each of the four. Available width is the frame less 140 (the card's 8px inset, the button's 118px reserve, the card's own 12 of padding and 2 of border), so measured in the harness: frame **1200 / 900 / 760** all four in words (card 526.73) · **680** three, Width in glyph (458.80) · **600** two (363.29) · **520 / 460** one (282.50) · **400** none (212.00). Every card is **26.00** tall and every value item **20.00** at all seven, nothing wraps and nothing is clipped; the all-glyph row stops fitting beside the host button at a frame of about **338** (198 + 14 + 126), below which the row clips, the documented last resort and the only one left. **Do not buy the words back** by clipping (the recorded regression), by wrapping (a second row over the tree), or by shrinking the button's lane, which is not ours.

**THE RAIL IS `+ − ⛶` IN THE BOTTOM-RIGHT CORNER — zoom and fit-width earn a place beside the canvas they act on, and `?` does not** (it moved to the bar's end, below). It is `position: absolute; right: RAIL_INSET; bottom: LANE_INSET + LANE_BTN_H + RAIL_LANE_GAP` = **`right: 4; bottom: 48`** — one lane UP, since the corner itself belongs to the infoview's own "Restart File" button and the frame no longer stops short of it, so the rail's bottom lands 12px above that button's top. It has its OWN pair of lane constants (`RAIL_INSET` 4, `RAIL_LANE_GAP` 12) rather than borrowing the card's `STATUS_INSET`/`LANE_GAP`: the rail is a column of round buttons hanging over the canvas, not a card lying in the button's lane, so it takes the canvas edge and wants daylight below it. Measured in the harness: the rail's right edge 4px inside the frame's, its bottom 48px above the frame's. A vertical column with `⛶` at the BOTTOM, diagonally opposite the status card — which also takes it out of the header's way for good: it reads NO `hdrH` at all (the header hangs at the top), so the latch below can no longer put it anywhere. **`+` and `−` carry the two fold-ALL gestures on ⌥** (⌥-click `+` = clear every cut — folds are cuts — and ⤓, ⌥-click `−` = write the outline, a fold cut on every branch root, both with `anchorRoot()`), said in their titles: they are the same open/shut axis as the zoom, with the modifier meaning "everything" rather than "here", which is how the tree's own nodes already read a modifier — and it is what let `expand all` / `collapse all` come off a bar that had run to three rows. **The fourth button, `⊹`, is GONE with the three picking modes it opened** (above), and with it the rail's only popover — so `MENU_PANEL` is now the bar's chrome alone and the rail is three buttons with no state of its own beyond ⌥.

**WHILE ⌥ IS HELD, `+` AND `−` WEAR `⊞` AND `⊟`** (`useAltHeld`, inside `ZoomRail` so a modifier press repaints two buttons and not the tree) — the marks expand-all and collapse-all have always used, so the modifier announces itself on the control it applies to instead of only in a tooltip nobody reads twice. TWO sources, neither sufficient alone: key events reach a webview only when it HAS FOCUS, and in the infoview the caret normally sits in the editor, so a held ⌥ over the tree would deliver nothing — the rail's own `onMouseMove` reads `altKey` off the mouse event whatever holds focus; and that alone misses a held ⌥ over a still pointer, which the window `keydown` catches. `e.altKey` on every key event, not `e.key === "Alt"` (a chord beginning with the modifier still reports it held, and Alt's own keyup reports false — exactly the release). A window `blur` CLEARS it: a webview losing focus mid-press never sees the keyup, and a glyph stuck in the ⌥ reading is worse than one that never moved.

**THE HOVER ACTION BAR IS GLYPH BUTTONS WITH `<title>`s AND NOTHING ELSE.** A dwell row of words under the glyphs was built and removed: that bar appears on hover over EVERY box in the tree, so a row that grows the card under the pointer moves the very buttons it is naming, and it says on every node what the tooltip says on the one being aimed at. `NodeAction` therefore carries no `label`, and the vocabulary lives in `?`, which reads the same `nodeHints` list — the same argument that took a `?` out of this bar once already: a surface charged to every node for a question asked once.

**A MODE PUTS UP A BANNER AT TOP-CENTRE, and it is NOT in the bar** (`TopCentre`, ProofTreeView) — the staged calc fill in `SEQ_STROKE`, an armed delete in `DANGER_FILL`, `to cursor` last — with the `✕` whose exit IS the mode's own `layers` entry, so banner and Esc cannot disagree. It used to be an ITEM spliced into the bar's left group behind a divider, which made entering a mode RESHUFFLE the row: every item to its right moved, so arming a delete shifted the very controls you might be reaching for next. Now **the bar never changes shape while a mode is up** (measured: arming a delete leaves all nine item rects byte-identical) and the loud surface reads where the transient toast already speaks. It wears the toast's own chrome and position; the two are ONE flex column with a 6px gap, not two absolutely-positioned floaters, so a toast stacks UNDER a standing banner with no constant to measure either against (measured: banner y 8 h 26.8, toast y 40.8). The column takes no pointer events; only the banner's button does. The banner is BUILT in the view (`modal`, a chain over the mode state) and RENDERED by `TopCentre`, which is what keeps the react-hooks/refs taint out of the view's own render: `modal.onExit` closes over `layerOff`/`applyUpToCursor`, so reading the value in a conditional during render is refused — passing it to a component is not.

**A mode change confirms itself in a TOAST** — paint-only, top-centre under the banner, `pointer-events: none`, the floater chrome (`POPUP_CHROME` + the editor-widget border, ink `--vscode-icon-foreground`, never a `--ptw-*` foreground over a light fallback), saying what the setting now IS (`Layout: tracks`, `Context: intro`, `Side-by-side: off`, `Gallery: off`, `Comments: narrate`, `Brief: on`, `Merge: on`, `To cursor: off`, `Width: 44 col` — the bar's own `Name: value` form since 2026-09-22; it was `Layout · tracks` / `Brief on` until then, `Reset to the source's view`, and — since undo/redo left the bar and are KEYS now — `Undo` / `Redo` off the ⌘Z relay, read through a per-render-written `toastRef` so that listener still registers once). It lives for `TOAST_MS` (1500) on a `window.setTimeout` held in a ref and cleared on unmount — **never rAF, which a hidden webview never fires** — and a new message REPLACES the standing one and resets that timer, so holding a key down reads as one message changing rather than a stack. **Fired from the same wrapped setters the bar's items call** (`applyLayout`/`applyHypMode`/`applyCommentMode`/`applyBrief`/`applyCombine`/`applyUpToCursor`/`applyReflow`/`applySideBySide`/`applyGallery`, each keeping the `anchorRoot()` its inline predecessor did — and each keeping the absence of one, which is why `applyGallery` anchors nothing), so a click and a keystroke do the same thing and say the same thing; `COMMENT_MODES` is the one coding of the comment switch's three names and its cycle order, read by the bar's own label too.

**THE WIDTH IS A DRAGGABLE SEAM in the `||` tracks layout** — the second input to the one `reflow` setting, no layout state of its own. `layout.ts` PUBLISHES the shared column the aligned pass slides every aside tactic to (`extent.trackX`, present only under tracks — `aside === "track" && !sideBySide`; the value was already computed, it was simply local); the view draws a hairline at `trackX − TRUNK_GAP_BRANCH / 2`, i.e. the middle of the gap the goals stop at (`ASIDE_TRACK_GAP` is the same 24), spanning the tree's y-extent inside the translated `<g>` so scroll and zoom apply for free, with an invisible 8px `cursor: col-resize` hit strip over it. **Rendered LAST, after the nodes**, so the strip is on top of everything and the drag cannot be swallowed by a box near the boundary. **Dragging RIGHT WIDENS** (`Δx / zoom / CHAR_W`, rounded, added to the reflow at drag start — `forcedReflow ?? reflow`, always a number in tracks — clamped to `[REFLOW_MIN_CHARS, REFLOW_MAX_CHARS]`): the goals are what the budget wraps and they sit LEFT of the seam, so more columns is more room for them. Measured in the harness: 80px right → 44 → 55 col, 80px left → back to 44, and ±2000px clamps at 20 and 100. Each step is one engine rebuild (~2-3ms, the slider's own cost) through a NON-toasting sibling of `applyReflow` (a plain `setReflow` — number→number needs no `anchorRoot`, and reflow's `viewKey` entry is on/off only), with ONE toast on mouseup. While dragging the hairline goes `SEQ_STROKE` and a `44 col` readout follows the pointer's y beside the seam. Listeners are document-level, held in a ref and removed on mouseup and on unmount — **no rAF** (hidden webview). The mousedown `stopPropagation`s so the background marquee never starts (verified: no selection rect, no pill), and the strip swallows its own `click` so the background-click dismissal does not fire. The bar's `Width: 44 col (tracks)` item and its slider keep working as the other input.

**THERE ARE NO SINGLE-LETTER SHORTCUTS, and the removal is the fix for a bug that read as a broken renderer.** `l g b c k u` drove the same wrappers the bar's items do; they are also core vim keys, and the document `keydown` fires whenever the WEBVIEW has focus — clicking a node grants it, with `activeElement` still `body` — so a vim user reaching for undo pressed `u`, switched **to cursor** on with the cursor on the theorem header, and reported the proofs as stuck collapsed (nothing was folded: the mode was drawing the root goal alone). The keys are gone from `keyActions`, from its `keydown` effect and from the `?` panel's Keys rows; `LAYOUT_MODES`/`HYP_MODES`/`COMMENT_MODES` lost the `next` fields that only the cycle keys read — and have them BACK, now read by the bar items' ⌥-click (above), which is the cycle put where it cannot be typed into a buffer by accident. **What remains is ⌘Z / ⌘⇧Z (the undo relay, with its toast) and Esc / `?`** — all three modified or non-alphabetic, so none of them can be a vim key typed at the buffer; the toast machinery stays, since every bar click still confirms itself through it.

**`RailButton.glyphPx` targets equal INK height, not equal font size**: the rail's glyphs ink a 7–11.6px band at the shared 14px, and the half-height math glyphs need an override to reach it — measured on the raster; a `font-weight` on a glyph the code font does not carry is silently nothing. No rail button passes one today (`⊹`, its last user at `RAIL_GLYPH_BIG` 17.5, went with the picking modes), so the prop is kept for the next glyph that needs it.

**The TOP-CENTRE STACK and the top-left floaters start CLEAR of the signature header**, at `floaterTop(0)` — which is the coding of "below the header" (row 0 adds no floater rows), so the header's measured height has ONE reader. **The measured `hdrH` FLOORS at `HDR_REST_H` rather than being defined by the measurement**, because the rule is only ever as good as the number and the number has a window in which there is nothing to measure: a hidden webview — the infoview panel behind another view, a `<details>` collapsed at mount — lays the document out at zero, so `getBoundingClientRect()` answered 0, `hdrH` LATCHED 0 (the 1px hysteresis writes it and nothing re-triggers until a ResizeObserver callback happens to arrive) and everything hung off it sat ON the header — reported when the ZOOM RAIL still hung off `floaterTop(0)` ("rail is way too high", the `+` level with the header text, in the editor while the harness measured 37 the whole time). The rail has since moved to the bottom-right corner and reads no header height at all, which removes that surface from the failure but not the failure: the modal banner, the toast and `headerExtra` still hang off it. Two halves, both needed and both already precedented: `read()` declines a measurement with no client rects / `checkVisibility()` false, exactly as `useFrameOffset` does (**a 0 there is the ABSENCE of an answer, not a height**), and the floor covers the window before the first good one. `HDR_REST_H = LINE_H + 13` is the resting header's own coding, not a guess — one `pre` line, 6px of padding above and below, the 1px bottom border — and it comes to exactly the 29 the harness measures, so the floor is non-regressive by construction and can only ever be an UNDER-estimate (a focus pill makes the row 18px and the header 31). `headerExtra` (standalone proof picker) and the hint pills float top-left. **THE ACCENT RULE ON THE BAR: a CHOICE AMONG EQUALS is not highlighted, an ENABLED FEATURE is.** `Layout`, `Context` and `Comments` carry no accent at any value (user direction) — one of their values is always up, the item already says which, and lighting three of the five items at once made the accent mean "not the default" rather than "something is on", which is not a thing a reader needs pointed out. `Width` DOES accent when the effective width is not `full` — its VALUE says the state, and off (`full`) is the tree's own wrapping. **The reading EYE no longer accents: its state is said by SLOTS instead**, which is the third answer here and the one that scales — the pill only ever said "at least one of the three", where the slots say which.

**EXTRAS SLOTS: one fixed SLOT per toggle behind a menu, under the item that opens it** (`ExtraSlots`). Three menus hold toggles beside their main setting and none of them showed in the item's own label, which names the choice and not the extras: **Layout** two slots (side-by-side, marked only where it is EFFECTIVE, then gallery), **Context** one (set when `Split data & props` is ON — Lean's own binder order is the default, so the mark says the departure from it, i.e. the grouped context; the polarity was flipped with the default, by the same user direction), **the eye** three (brief, merge, to cursor where it is enabled). **They are POSITIONAL, not a count** — the prop is `slots?: boolean[]`, never a number — so an unset slot is simply EMPTY and the eye with brief and to cursor up reads `■ · ■`, which says WHICH is off where a count only ever said how many. Each mark is a 3×3 SQUARE (no radius) in `var(--vscode-icon-foreground, var(--ptw-fg))`, 2px apart, every slot reserving its width whether set or not so the group's centre never moves; the group is centred under the label — or under the glyph box in the compact form, which gets it too (measured: group centre = glyph-box centre to 0.00). **The row must not `overflow: hidden`, and this was the actual "not squares" cause on the user's screen**: the marks hang 1px below the 20px item (`bottom: -1`), and the row's overflow clip — there for the too-narrow-frame last resort — took that pixel off the BOTTOM only, drawing 1.9px tall against 2.9 wide while every `getBoundingClientRect` in the harness reported 2.9 × 2.9 (rects are unclipped). The row now clips with `clip-path: inset(-4px 0 -4px 0)`, sides only. Verified in the real infoview after a worker restart.

**THEY ARE SNAPPED TO WHOLE DEVICE PIXELS, or they are not squares.** 3 CSS px is a square only where it lands on the grid, and in the infoview it lands nowhere near it: the panel runs at a FRACTIONAL ratio (retina 2 × an editor zoom of 1.2 = 2.4), so a 3px side is 7.2 device px, and `justifyContent: center` under an item of fractional width puts the left edge mid-pixel as well — the renderer then antialiases one axis and not the other and the mark reads as a RECTANGLE (reported as exactly that). Both halves are snapped: the SIZE **and the gap** (marks 2 and 3 drift off the grid however well mark 1 is placed) are rounded to whole device pixels and written back in CSS px, and the POSITION is corrected by a `transform` carrying the sub-device-pixel remainder of the FIRST MARK's own rect — the first mark, not the group, because centring is what makes the offset fractional. The rect already carries the nudge in force, so it is taken back out before the remainder is read, which is what makes the correction converge in ONE pass rather than chase itself. **The ratio is `devicePixelRatio × a MEASURED ancestor scale`, and the second factor is not optional**: a webview's own zoom moves `devicePixelRatio` (the infoview's case), but an ancestor CSS `zoom` does NOT — measured, the ratio still reads 2 under `zoom: 1.2` — so the scale is read off a box whose CSS size we know and never touch, the host item's `BAR_ITEM_H`. Reading it off one of our own marks instead feeds the snapped size back into the scale that computed it, and the layout's 1/64px quantization then makes the pair oscillate. A transform on an absolutely-positioned span reaches no layout, so ONE HEIGHT and STABLE WIDTH are untouched. Measured in the harness over all six marks: at dpr 2, left/top/width/height × dpr are integers with **max error 0.0000** (6 × 6 device px, and the transforms are real work — `−0.164` / `+0.195` / `−0.148` px); under the CSS-`zoom: 1.2` stand-in for a 2.4 ratio, the CSS side becomes 2.91667px and every mark measures exactly **7 × 7 device px**, max error 0.0000 again, with width === height in both. It is `position: absolute` inside the item's fixed 20px box, `bottom: -1` (down into the card's bottom padding, still 1px inside its border — measured, mark bottom 788 against the card's inner bottom 789), `pointer-events: none`, which is what keeps BOTH standing promises: a mark appearing can reach neither the card's height (ONE HEIGHT) nor the item's width (STABLE WIDTH), so nothing to its right moves — measured over three states (all six extras off, all six on, and brief + to cursor with merge off) the card is **526.73 × 26.00** and all seven item rects are byte-identical — re-measured after the default flip, lighting the Context slot moves neither the card nor any item. No `title` of its own — the popover rows name the extras, and the item's own title is unchanged. **THE PRESSED/DISABLED RULE, stated once in `ControlRail`'s doc comment because two buttons broke it**: a control may draw PRESSED only where it changes the drawing; where another mode makes it inert it is `disabled` with a title saying WHY (⇳'s pattern) and never draws pressed; where the setting is merely OVERRIDDEN it reports the EFFECTIVE state (¶'s `forcedReflow` pattern). The two offenders: **◫** is threaded only into `trunkLayout`, reached only under `compact`, so in ⑃ wide it toggled, lit up and changed nothing (`sbsEnabled={compact}`); **❮❯** is bypassed by sequence mode's `only` set, and its pager is already gated, so it stayed pressed while doing nothing (`disabled={seqActive}`). Disabling never CLEARS the underlying state — a rail toggle is how this reader reads, and returning to a compact layout must restore it. Swept the rest of the rail: no third site. **`?` opens the GESTURE REFERENCE** (`web/src/helpPanel.tsx`), and it is the STATUS BAR's last item — which does not breach "no button per feature": `?` is not a feature, it is the index of them, and it belongs at the end of the row of words rather than hanging off the rail of canvas verbs. TWO entry points: the bar item and the `?`/F1 KEY (skipped inside a textarea, where the completion list and abbreviation session own the keyboard). A third — a `?` first in the hover action bar — was built and REMOVED by user directive: that bar appears on hover over every box in the tree, so a button opening a reference charges every node forever for a question asked once. The bar is where a reference belongs. Rows come from `GESTURES` filtered by `Caps` (computed from the hooks the view was handed), so the standalone app shows a SHORTER AND TRUE list with no second list to maintain. It opens ABOVE the CARD (`HelpPanel.anchor`, `{left: 0, bottom: "100%"}`), hung from the card's LEFT edge and not its right — and still so now that the card is right-anchored: `right: 0` would give the panel a fixed x, but the card's right edge is `BAR_RIGHT_RESERVE` in from the frame's, so a 420px panel hung from there runs off the frame's LEFT on a narrow panel (measured at a 480px viewport, left −86; at a 460px frame it is still −30). From the card's left edge it lands on screen at every width the row compacts through — measured, frame 1200 panel 635.6→1055.6, frame 460 panel 84.0→482.5 inside a frame ending at 485.5. The anchor is a PROP rather than hardcoded because the panel used to hang off the rail (`right: 100%; top: 0`) and the placement belongs where the button is. **It also sets `white-space: normal`**: the bar's card is `nowrap` for its own one-line items, and inherited that ran every hint line straight off the panel's right edge — a class of bug that arrives free with moving a panel into a card. Ink is `--vscode-icon-foreground` over `POPUP_CHROME`'s background, never a `--ptw-*` fallback: the first version paired `--ptw-fg` with that light background and measured `rgb(230,230,230)` on `rgba(255,255,255,0.97)` — the recorded light-on-light trap, third occurrence. It deliberately does NOT enumerate the rail (twenty tooltips that already work would be the panel's biggest drift surface) and does not animate (a hidden webview fires no frames). `helpOpen` is plain state: out of `viewKey`, no `anchorRoot`, never remapped, and NOT cleared on a proof change — a reader's reference, the class `resetToSource` already preserves.

**THE DISMISSAL LAYERING is one table (`layers`), read by three consumers and no fourth**: Esc, the background click, and the modal BANNER's `✕` (its exit IS its layer's own `off`, so the two cannot disagree about what leaving a mode means). It replaced three hand-written lists that had already drifted, and the drift was not cosmetic — the three PICKING modes were in NONE of them, so the three modes that take over every click on the tree were the three with no announced way out. (Those modes have since been REMOVED outright; the table stays, and `focus` and `path` are the two scoping layers it now ends with.) **Esc dismisses the FIRST layer that is up, one keypress one visible effect**: it used to clear five at once, so closing the ¶ slider threw away a marquee selection built by a drag — the argument the focus layer was always given, now applied to every layer (realistic depth is two; focus and path are mutually exclusive with each other). Order puts cheap-to-rebuild first and `selection`/`focus` last. **`bg` says whether a BACKGROUND CLICK dismisses too, and the two SCOPING modes say NO deliberately** — a scope is a reading you set up on purpose and a stray click on empty canvas must not throw it away; they have Esc, the breadcrumb's `✕` and the node's own ◎/`⊹`, none of which is a misclick. The listener registers ONCE, reading the table through a per-render-written ref (the ⌥-keydown pattern) — the old effect listed its own state in the deps and re-subscribed once per keystroke in the in-place editor. The four hint pills are now one `HintPill` BUTTON beside the focus breadcrumb, for the reason the breadcrumb is one; the staged calc fill gets one too, its blur being deliberately a no-op. Harness note: four more buttons now sit ahead of the rail in the DOM, so a probe indexing buttons positionally is worse off than ever — find rail buttons BY GLYPH. Measured: selection + open slider, one Esc closes the slider and the selection SURVIVES; a second clears it; a path scope exits on Esc, on the breadcrumb's `✕` and on `reset`, and survives a background click.

**Leaving a focused subtree has THREE ways out and none of them is the rail** (it had exactly one, a `◎` rail button, which is both far from where the eye rests in a wide tree and reads as a view setting rather than a mode you need out of — and focus is easy to enter by ACCIDENT, ⌥-click being one modifier away from ⌘-click's reveal). The primary surface is a **breadcrumb pill** in the top-left floater stack: it names the focused goal (so it doubles as "you are here") and clicking it exits. Plus **Esc**, and **◎ / ⌥-click on the focus root itself** — the same two gestures that entered, so ◎ reads as a toggle rather than two glyphs (`isFocusRoot`, the complement of `focusable`). The pill's label comes from `engine.allNodes()`, not the drawn `nodes`: folding the focus root must not make the way out disappear. **Esc is LAYERED** — it dismisses a picker / disarms a delete / folds the ¶ slider first, and only unfocuses once nothing transient is up, so cancelling something else can't throw away the scope you are working inside (focus, unlike the others, costs a gesture to rebuild).

**The top-left floaters stack through one derived `floaterTop(row)`**, which now has ONE row left — the caller's slot (standalone only); the picking/calc hints became the top-centre modal banner and the diagnostics pill moved into the status bar, and `floaterTop(0)` doubles as that banner's (and the toast's) top. The zoom rail no longer reads it at all — it hangs off the bottom-right corner. Rows are `FLOATER_H` apart (all one line of 12px text in the same pill chrome, so one constant beats a per-row measurement). Derived once because it used to be four copies of the same `headerExtra ? …` expression plus a fifth in the pill's props — unextendable without editing all five — and focus, unlike the hints, COEXISTS with every other row (you can pick, elide or fill a calc while focused). Measured in the preview: picker 8 / focus 44 / hint 80, no overlap. The whole scroll container is `user-select: none` (the tree is click/double-click/drag-driven; stray selection fights all three — how the ⇧ gesture broke); the editor textarea opts back in. A short `pointer-events: none` **headroom veil** fades scrolled content under the floaters (absolute, zero layout). Wheel: zoom is `exp(-deltaY * 0.008)`; plain scrolling has a **vertical gesture lock** (a gesture that starts vertical stays vertical; ≥180ms idle starts a new one) because the compact layout is read by vertical scrolling and trackpad drift walks it sideways.


### Addendum (2026-09-06): the marker returns to a node, and folds draw none

The axis-break marker that the fold→skip merge first shipped (two 45° ticks on the trunk lane plus an italic caption) was rejected on sight: the glyph read as confusing — "looks a bit like a swastika" — and it threw away the immediate reading the old ghost chip had, that a REDUCED NODE stands here. Seven alternatives were mocked up (chip + count badge, stacked deck, tactic kept with a folded footer, pill on the lane, chip with the line cut around it, zigzag break, peel-one-step) and the user asked for a synthesis from UX conventions and the real constraints (width, the spine, intuitiveness). The synthesis is two standard idioms with one count field: a FOLD is the outliner's act, so the folded GOAL is the reduced node — its corner reads `+N` and nothing is drawn below it (VS Code's fold badge, every outliner, the "collapsed node appears as a leaf" convention) — and mints no marker at all, which also returns every node count to its pre-merge baseline (`sum_range_odd` seeded 71, root skip 57, `succ` 64, collapse-all 14); a SKIP is the sequence-elision act (code folding on a line, the DOM inspector's `<div>…</div>`), so the tactic stays in its slot cut down to its HEAD in a dashed box with a `+N` badge for what it swallowed — the "preview node with a metric" of the collapsed-tree literature. Width is bounded by the head (≤ 26 chars) instead of the old 30-char preview plus count, the spine's links and their marks are the ordinary tactic ones, and the skip icon is the dashed square again — a picture of the box the gesture makes.

Two findings from landing it, both measured in the harness: the `+N` corner glyph overprinted a full-width first line by 7px (`+2` on `sum_range_odd`'s goal after `have gap`, where the bare `−` had cleared by 0.5), so `sizeOf` now reserves `CORNER_W` (22px) on the TOP line — the first hyp line when there is a context block, else the label's first line — for goals that have children or are folded, and only for those (measured after: every `+N` clears by ≥ 8.2px, the widest by 121); and `collapse all` had computed its outline over the DRAWN tree, so from the seeded view it missed the branch roots inside the `.none` ghost (17 nodes / 3 folds against the probe's 14 / 4) — it now runs `outlineCuts` over the base tree, which is what "the outline of the proof" means, and replaces the cut list. The old engine-side `outlineCuts` method was deleted with it. Ghost geometry as shipped: `have gap… +2` is a 119.06 × 26 box (the pre-merge chip measured 189.6, the break 184.8), badge 22 × 14 at exactly `w/2 − NODE_PAD`, centred on the label line, `BADGE_GAP` 8 from the head.

## 2026-09-07 — The step ghost goes; the axis break says what went

The dashed ghost of a SINGLE skipped step is gone. Two gestures reached the
same position and drew it two different ways: `−` on a trunk goal hopped over
its consumer (the goal wearing `+N`, an axis break on the line below it), while
◌ on that same consumer left a dashed box where the tactic had been. One
position, two looks — so ◌ on ANY step is now the hop from its drawn parent
goal (`stepCut` → `hopForStep` in elide.ts, the one dispatch the click, the
hover preview and the probes all read). Where no hop can be read — a closing
tactic, a split with no continuation — ◌ falls through to `goalCut` on the goal
above, which folds; the ghost survives in exactly three places, and each is a
place a hop cannot carry the meaning: a `combine` run (a display mode, full
box), a marquee band that is not one straight trunk run (a band that IS one is
rewritten by `hopForBand`, an exact member-set test), and a `.none` seed on a
step with no continuation — `flag_closing`'s documented case, where the
author's sentence is the whole content and there is no break to write it
beside.

What replaces the ghost's reading is the CAPTION on the break: `hopCaption`
gives the `.none` note in italics, else the head word of each hidden tactic in
source order (`tacticKeyword`: leading identifier/keyword characters, else the
first character, so a bullet is `·`), ` · `-joined and capped at three elements
with `…` as the third. The chart convention — an axis break is labelled with
what the break skipped — and the division of labour is now clean: the goal's
corner `+N` says HOW MUCH went, the caption says WHAT. `odd_sums`'s root hop
reads `have · intro · …` over 8 tactics; its `.none` seed reads *the algebra:
m = 2j + 1 squares to 2 \* (2j² + 2j) + 1* in italics. Caption and strokes take
the same click as the corner `+N` (restore) and the same `<title>` listing what
is hidden, so the reader can undo the hop from either end of it. Placement is
`HOP_CAPTION_GAP` (8) right of the trunk lane at the break's own y, sized by
`hopCaptionWidth` — layout.ts, because the measurer and the paint must stay one
coding even though nothing in the layout reserves room for a link's ink.

Two supporting changes fell out. `stepIds` now returns its members in `byId`
insertion order (the tree's DFS preorder) rather than in the order its stack
happened to pop them, so `folded.parts` — and therefore the caption — reads in
source order. And a hop cut carries `note?`, since a `.none` seed's prose now
rides a hop rather than a step; `applyElisions` takes a hop's note from the CUT
alone, never from a member's own flags, or the first step of a multi-step run
would caption the lot.

Measured, all of it re-baselined in `web/probe/counts.mjs`: every `.none` seed
that CAN hop now draws one node fewer, since a hop mints no marker —
`odd_sums` seeded 71 → 70, `flag_nested` 4 → 3, and the three odd_sums cut
counts that include the seeds each lost the same one (root hop 56 → 55,
goal-after-key 69 → 68, succ fold 64 → 63). `flag_demo` stayed at 13: its
`.none` sits on an `rcases` that splits with no continuation, so it keeps its
ghost, which is the rule working. `probe order` now sweeps hops as well as
folds (1420 → 1696 placements, still 0 sibling moves); `probe overlap` counts a
hop's caption as ink and no longer skips a cut set that mints no ghost (20 →
730 layouts checked, 0 overlaps); `probe hopgap` sweeps 284 caption placements
across the corpus × four layouts for collisions with node boxes, and finds
none — including the 350px italic note caption, which lives in the widened
`TRUNK_GAP_HOP` run to the right of the trunk lane where nothing else is drawn.

Left standing: `SkipIcon` is still a picture of a dashed box, which is now what
the gesture makes only for a marquee run; and `proofs/flags.lean`'s prose still
describes `.none` as collapsing "to one dashed ghost", true only of the closing
and splitting cases. Both are text, and the second needs `./gen.sh`.

## 2026-09-08 — Cuts the source asked for are drawn in the author's voice

**Why.** A hop, fold or ghost minted by a `.fold` / `.none` flag, or by an
`rw`'s `x = x` residue, drew EXACTLY like one the reader had just made with ◌
or `−`. Two readings were gone. The first: whose hand this was. A proof opened
with four things already put away looked like a proof someone had been
collapsing, not one whose author had decided what the reader does not need —
and the difference matters most on first sight, which is the only time the
seed is standing on its own. The second: that there is a NOTE here. A `.none`
carries prose, and the prose was drawn in the same italics a caption uses for
any note, on a break that looked like every other break, so nothing said "this
sentence was written for you" as against "this is a summary of what you hid".

**What.** `ElideCut` gains `seeded?: true` and `seededBy?: "none" | "fold" |
"residue"` on every variant but `combine` (a display mode, never seeded).
`sourceView` is the ONE minting site — `reset` and the once-per-proof seed both
go through it, so they cannot disagree — and stamps the flag kind it read. The
flag is carried by `remapCut` (spread), `pruneCuts` and `disjointCuts`
(filters), and by `coalesceCuts`, which now decides per branch root: the
coalesced fold is seeded iff every cut it absorbs was, so a branch the author
folded stays the author's and one the reader finished off by hand becomes the
reader's. It is deliberately NOT part of `cutId`. That is the load-bearing
decision: `addCut` dedupes by id, and a reader's `−` on a goal the source
already folded mints the very same id, so the standing seeded cut simply
survives the gesture instead of being replaced by a plain one that would draw
differently for no reason the reader could see. `elideStep`, which replaces
rather than dedupes (it grows a hop's `steps`), carries the mark across by
hand for the same reason.

`applyElisions` stamps `folded.seeded`/`folded.seededBy` on the goal for a
seeded fold or hop and `elidedCut.seeded`/`seededBy` on the marker for a
seeded step or band. The paint:

- **Caption.** `hopCaption` returns `SEED_MARK + body` (`§ `, the printer's
  "this is the author speaking", and not a glyph any tactic starts with) with
  `italic: true`. One string, so `hopCaptionWidth` measures exactly what is
  painted and `probe hopgap` / `probe overlap` sweep the real rect.
- **Ghost.** The mark goes into the LABEL in `applyElisions`, not into the
  paint, for the same reason: `ghostSize` measures the label. The italic test
  in both `ghostSize` and the renderer is now `note || seeded`.
- **Corner.** The `+N` was inked `style.stroke` — the node's own colour. Seeded
  it is italic in `var(--ptw-comment)`, the ink the caption is written in, so
  the two ends of one cut read as one thing. A `§` glyph before the `+N` was
  the alternative and was NOT taken. Rendered in the harness (odd_sums, the
  `.none` seed's goal), `§ +4` in a corner reserved at `CORNER_W` = 22 simply
  did not fit: it overhung the box's right edge and printed over the first hyp
  line, so taking it would mean measuring the glyph into `topLineWidth`/`sizeOf`
  and widening every seeded goal's top line — for a mark that read as clutter
  at 11px next to a `+N` that is already unmistakable in comment ink and
  italics beside a stroke-inked upright one. Cheapest thing that is visibly
  different, which was the instruction. (The `§` earns its place on the caption
  and the ghost label, which have room and are read as prose.)
- **Titles.** `seedTitle` writes "From .none in the source — click to open" /
  "From .fold …" / "Folded by the source (an rw's x = x residue) …" ahead of
  the step count and the list of hidden tactics, on the caption, the strokes,
  the goal and the ghost.

`gestures.ts` says so in the ghost rows, the ghost section heading and the
`.none…` / flag-menu titles.

**Considered and deferred.** A status-bar item reading "N from source" that
scrolls to the next seeded cut. It is the natural next thing — the mark tells
you a seeded cut is THERE, not that there are three more below the fold — but
the bar is already at its compaction limit (`BAR_H` 26 with progressive
right-to-left glyphing), a new item would push the diagnostics pager, and a
scroll-to gesture is a relayout-adjacent motion that needs an anchor decision
of its own. Not attempted.

**Baselines.** One number moved, and only because the string it asserts is the
new one: `probe counts`'s "the note is the caption" now expects
`§ the algebra: m = 2j + 1 squares to 2 * (2j² + 2j) + 1`. Every node count,
`probe order`'s 1696/0, `probe overlap`'s 730/0 and `probe hopgap`'s 284
placements are unchanged — the mark widens two captions and no layout moved
under them.

## 2026-09-08 — Tour marks: an ordered reading, the author's and the reader's

The deferred item at the end of the entry above — a bar item reading "N from
source" that scrolls to the next seeded cut — is replaced by this rather than
built. It was the right instinct (a mark tells you a cut is *there*, not that
three more lie below the fold) aimed at the wrong object: what a reader wants
to be walked through is the ARGUMENT, and seeded cuts are only the places the
author decided to say less. So the walk is over places the author decided to
say *more*, and it is a first-class thing with its own syntax rather than a
side effect of the cut mechanism.

**The models are borrowed, deliberately.** VS Code's CodeTour — ordered steps
pinned to lines, prev/next, a caption per step — crossed with vim marks: one
gesture to drop, one to jump. Nothing in Lean tooling does this; both halves
are familiar enough that neither needs teaching.

**Syntax.** `.mark` joins `.fold` / `.none` / `.no-hyps` / `.h#` in the flag
grammar, parsed in `parseFlags` (proofToTree.ts) BEFORE the markdown cleanup,
for the reason the whole grammar is parsed there: cleanup turns `` `.mark` ``
into `.mark`, so prose merely mentioning the flag in backticks would become a
directive. It is the ONE flag with a bare-word argument — `.mark 3` — which
had to be eaten inside the `case` rather than left to the loop, since the loop
stops at the first word that is not a flag and `3` is not one. Ordering:
explicit ranks first, ascending; then every bare `.mark` in source position;
ties by source position and then DFS index. A rank of `true` in
`NodeFlags.mark` means "bare"; the tab does NOT show the declared rank, it
shows the stop's 1-based place in the ordered list, which is what a reader
counting through `2/5` is looking at.

**The wire, which needed nothing.** Flags are parsed on the CLIENT out of the
comment's own text; the Lean side never sees them. The comments sidecar is
plain data and `stableProofOf` already carries `comments`, so `.mark` rides
both wires — NDJSON and RPC — with no field, no `incoming` rebuild, and no
`ProofStep` growth. This is the sidecar rule paying off: the check was to read
`incoming` and confirm, not to add anything.

**Two lists, never mixed.** The author's is the source. The reader's is a
`Set<string>` of node ids in view state, ordered by source position, carried
across a re-parse by `remapIds` and stashed in `viewStash` under the proof key
— the standing rule about keying on source facts, applied to one more
id-holding set. Session only: a reading is not a document, and a mark that
outlives the session would have to be written into the file, which is what
`.mark` is for.

**The jump peeks, it does not unfold.** This is the one real design decision.
`revealNode` (the diagnostics pager's move) DROPS every cut covering its
target, which is right for "take me to the error" and wrong for a reading: a
reader who folded four branches to think about a fifth would find them all
open at the end of the tour. So `goToStop` collects the covering cuts and puts
their ids in `tourPeek`, which `treeNodes` filters out of the cut list exactly
as `peekKey` (the cursor's peek over seeded cuts) already does — the same
non-destructive move, asked of any cut instead of the seeded ones. Move on,
and the folds close behind you. Every covering cut, not the first: cuts nest,
and opening only the outer one re-arms the inner over the node being read
(`unhide`'s own rule, learned the same way).

**Keys.** `<` and `>`. The no-single-letter-keys rule exists because a bare
letter collides with vim's bindings in the editor beside us; these are
Shift-comma and Shift-period, punctuation, and nothing claims them. Esc leaves
the tour through a `layers` row placed between the prompts and the scopes: a
tour hides nothing, so it is cheaper to lose than a focus or a path.

**Paint, and where the tab ended up.** A stop's node wears a small numbered
pill, `BADGE_H` tall at `BADGE_FONT_PX`, comment ink for the author's stops
and `SEQ_STROKE` — the selection accent, the codebase's "yours" — for your
own, filled for the stop being read. It was first hung clear of the box's LEFT
edge at mid-height, which is where a tab belongs; `probe overlap`, extended to
model the rect against every node box the way it models the hop caption, found
**33 collisions** in the side-by-side layout, where a right-hand column's tab
reaches into the left column's comment strips and combined boxes. Moved to
STRADDLE the top-left corner — half its width left, half its height up — it
sweeps clean: 0 over 730 layouts. `TOUR_TAB_GAP` was minted for the first
placement and removed with it; the corner needs only `tourTabWidth`.
With the tour off, only the READER's stops wear tabs: the author's would tab
every proof in the corpus before anyone asked to read one.

**The bar.** A fifth value item, `Tour: off` / `Tour: author 2/5`, last in the
row and so the first to compact to its glyph (`⚑`) — it is the newest and the
most transient of the five. Its `‹ ›` chevrons ride a new `BarValueItem.after`
that is rendered inside BOTH of `valueMenu`'s forms, so the hidden ghost
measures them with the item and the progressive compaction stays honest; the
one arithmetic fix that needed was `base`'s `4 * STATUS_GAP`, which was the
item count spelled as a literal, now `n * STATUS_GAP`. ⌥-click cycles off →
author → mine → off, skipping an empty list and toasting "No author stops in
this proof" rather than parking on a mode with no next.

**Baselines.** No existing number moved: `probe counts` ALL OK, `probe order`
1696/0, `probe hopgap` 284 placements, and `probe overlap`'s layout count is
unchanged at 730 (the tab rides the existing sweep). `probe overlap`'s label
now reads "ghost/caption/tab overlaps". `counts.mjs` gains a tour block:
three author stops in odd_sums (`.mark 1` on the closing `exact`, bare marks
on `have key` and `have parity`), their captions, the reader list's source
ordering, a remap across a re-parse, and the `firstSentence` rule itself.

**2026-09-08 — the tour loses its off mode (user direction).** "No off mode —
just cycle marks if they're there (author's or user's)." `TourKind` is now
`author | mine`; not having STARTED is `tourAt: number | null` set to null, and
`tourOrder("off", …)` (with its probe assertion) is gone. The kind is decided
once per proof — the author's list where the proof carries `.mark`s, otherwise
the reader's — and the reader's choice stands within that proof; ⌥-click on the
bar item switches lists, toasting and STAYING where the target is empty (there
is no longer an off to fall back to). Tabs now show the current kind's list
always, so a marked proof is visibly marked on arrival, which is what marking
it was for. The bar reads `author –/5` (en dash) not started, `author –/0` for
an empty list, and accents only while a stop is current; Esc clears the stop
and the peek but keeps the list.

**2026-09-08 — one reading over both sets, and the tour's bar item stops
pretending to be a mode (user direction).** Four items, reported together.

**A combined list.** `TourKind` gains `all`, and `all` is where every proof
now arrives: the author's stops ∪ the reader's, as ONE ordered reading. The
reader who drops a ⚑ into a marked proof was, before this, choosing between
two lists neither of which was what they were doing. Dedupe is in the author's
favour — a node carrying a `.mark` AND one of yours appears once, `who:
"author"`, which is also what its tab's ink then says — and ordering is one
comparator for all three lists (`ranked` in tour.ts, factored out of the old
`authorStops`): explicit `.mark N` ranks first in rank order, then everything
else by source position and DFS index. `tourOrder("all", …)` dispatches to
`allStops`; the `tourFor`/`proofKey` block sets `"all"` unconditionally, so
the arrival rule no longer has to ask what the proof carries. ⌥-click cycles
all → author → mine → all, still toasting and STAYING put on an empty target,
and the bar panel gains an `all (n)` row first. Tabs keep their PER-STOP ink
on the mixed list — comment ink for the author's, `SEQ_STROKE` for yours —
because a combined reading is exactly where the reader needs to be told whose
each stop is.

**Disabled chevrons.** `‹ ›` are `BarButton disabled` while the CURRENT list
is empty (the shared 0.35 opacity, no click, no toast). The KEYS still toast
the empty message: a key press has no other way to say why nothing happened,
where a greyed button has already said it.

**The chevrons were too small, and the fix is a measured number.** Reported
against their neighbours in the compacted bar. Measured in the code font the
bar's glyphs are drawn in (`measureText`'s bounding box, harness): a guillemet
inks at ~0.45 of its font size, so at the bar's own inherited 12px it stood
5.38px tall against the ⚑'s 7.65, the `☰`'s 6.91 and the `▸`'s 7.37 — and 14,
the first size tried, reaches only 6.28, a difference no screenshot shows (two
were taken and compared). `CHEVRON_PX` is 18, where the glyph inks 8.07: level
with the ⚑, a hair over the rest, which is the side of the complaint to err
on. It is the largest px in the bar and draws one of its smallest marks; that
is the glyph. They are drawn by the same `glyph(g, px, w)` helper the ⚑ uses
(now taking a box width) inside `TEXT_GLYPH_BOX_W`, so both ghost forms
measure exactly what they measured before and no compaction threshold moved.

**Slots, not an accent.** `accent: tourAt !== null` is gone from the tour's
`BarValueItem`. An accent pill says "this mode is ON", and a tour is a
READING, not a mode — and the value already says how far into it you are.
Two extras SLOTS take its place, `[authorCount > 0, myCount > 0]`, the eye
item's own mechanism used verbatim (`ExtraSlots`, device-pixel-snapped 3px
squares), and they say what the pill never could: which of the two sets has
stops at all. The title names them.

**A hover nub, not a permanent one.** The user asked whether a permanent
corner nub for dropping a mark would clutter the tactic nodes. It would: every
node in every proof would wear an affordance for a gesture most readers never
use, and the tab position is already spoken for by the stops that exist. So it
is HOVER-ONLY — on a node with no stop, the tab's own rect is drawn as a
hollow pill (outline, `strokeDasharray "2 2"`, `SEQ_STROKE` at 0.6) with
`cursor: pointer` and "Drop a tour stop here (⚑)", clicking `toggleMyStop`.
Paint, inside the node's `<g>`, so no relayout on hover and nothing new for
`probe overlap` to model (it occupies the rect the tab sweep already checks).
Two things had to be fixed to make it clickable, both found by clicking it in
the harness and watching nothing happen: an unfilled SVG rect is not
hit-testable, so `pointerEvents="all"` is what puts it in the pointer's path
at all; and the pill straddles the box's corner, so half of it lies outside
`[data-ptw-box]` — the node's `onMouseMove` hit test now also admits
`[data-ptw-nub]`, or the hover that drew the nub is lost on the way to
pressing it.

**A tab is a place, so clicking one GOES there (correction, same day).** The
first cut of this made your own tab a toggle (click removes the stop) and the
author's a dead label, which got both halves wrong: the number on a tab is its
place in the reading, and an author's tab that cannot be clicked is a mark you
are shown and not allowed to follow. EVERY tab now jumps — `goToTab(id)` finds
the stop in the list being read and calls `goToStopIn(tourStops, i)`, and where
the stop is NOT in that list (an author's tab while the kind is `mine`) it
switches the kind to `all`, the one reading that holds both sets, and jumps
there rather than doing nothing. Removing one of your own stops moves to
⌥-click on its tab, which is also what keeps the hover nub's plain click
meaning "drop": one pill, one rect, and the plain click never both adds and
removes. Titles say the whole gesture — "Tour stop 3 of 4 — click to go,
⌥-click to remove" on yours, "Tour stop 2 of 3 (the author's) — click to go"
on the author's (the caption left the author's title with the click that used
to be absent from it; the toast says it on arrival). `NodeGates` gains
`tourTab: "author" | "mine" | null` so `gestures.ts` can say the two tab rows
apart in the `<title>`s and the `?` panel, and the nub's row is gated on
having no tab rather than on having no stop of your own.

**Baselines.** `probe counts` ALL OK with a new `all` block (union of 3
author ∪ 2 reader stops with one shared = 4, the shared one in the author's
voice, the ranked stop still leading, the rest down the source, `all` with no
reader stops equal to the author's list, and an unmarked proof empty); `probe
overlap` 730/0, `probe order` 1696/0, `probe hopgap` 284 — none moved.
Harness, odd_sums: arrival `Tour: all –/3`; the nub on `intro m` clicks to
`all –/4` with the new tab drawn 3rd, in `SEQ_STROKE`; ⌥-click gives
`author –/3` → `mine –/1` → `all –/4`; a proof with no marks reads `all –/0`
with both chevrons at 0.35 and both slots dark, and `>` toasts "No tour stops
in this proof — ⚑ on a node drops one". After the correction, same fixture:
clicking author tab 2 gives `Tour: all 2/3` and toasts `2/3 · Step 1: the
identity itself.`; the nub on `intro m` takes it to `all 2/4` with a reader tab
reading "Tour stop 3 of 4 — click to go, ⌥-click to remove"; clicking that tab
jumps (`all 3/4`, `3/4 · intro m`) and ⌥-clicking it removes the stop
("Tour stop removed", back to `all 3/3`).


**The nub answers to the CORNER, not to the node (2026-09-08).** Drawing it on
every hover of the box was the permanent-nub complaint one step quieter: a
reader hovering a node to READ it met the affordance each time — "if you're
just hovering the node you don't want to be distracted each time" (user
direction). So the nub now hangs off a dedicated hit region: an invisible rect
(`fill="transparent"` — `none` is not hit-testable — plus `pointerEvents="all"`)
at the tab's own rect grown by `NUB_SLACK` 8 on every side. Grown on every
side, not just inward, because the tab STRADDLES the corner: half the region
lies outside the box, which is what lets a pointer coming from the outside land
on it without crossing into the node first. Inward it stops at
`BADGE_H/2 + 8` = 15px, the tab's own height and no more, so the first hyp
line's text is not covered. The region carries the hover (`nubHoverId`, its own
state beside `hoverId`) and the click (`toggleMyStop`); `[data-ptw-nub]` moved
from the pill to the region and came OUT of the node's `onMouseMove` hit test,
which is again `[data-ptw-box] || [data-ptw-bar]` — the nub no longer needs the
node's hover to exist, so the bar answers to exactly what it answered to before
the nub was written. Still paint inside the node's `<g>`: no relayout, and
`probe overlap` models neither (the pill sits in the rect the tab sweep already
checks; the region is invisible).

Beside it, a duplication in the `<title>`s: a goal read `· ⚑ drops a tour stop
here …` and `· the dashed tab …` TWICE. `nodeHints` filters `GESTURES` on
`when` alone and has never known which target it is reading for — the gates
themselves are what separate a goal's rows from a tactic's
(`revealable`/`goalRevealable` and so on). The tour rows are the same sentence
under the same target-blind gate on BOTH targets, so both matched. It now
dedupes by rendered text, keeping the first; the `?` panel reads `GESTURES` per
section and still shows each row under both headings. The dashed-tab row was
reworded to say WHEN it appears: "same thing — it appears when the pointer is
at the box's top-left corner, on a node with no stop, and clicking it drops
one".

Readings (harness, odd_sums, `select(19)`): hovering the middle of `intro m`
draws no pill and still shows the node's hover bar; a `mousemove` 6px up-left
of the box's top-left corner lands on the region (`data-ptw-nub`) and the pill
appears at (123, 344) against the box's (131, 351) — straddling the corner as
the tab does; the click drops the stop (`Tour stop 3 of 4 (temporary)`,
`Tour: –/4`) and hovering the middle again draws no pill while the tab stays.
With the temporary list cycled OFF (⌥-click the bar item to source-only, left
slot lit, right dark, `–/3`), a drop through the nub toasts "Tour stop dropped
(⚑) — temporary list on", lights the right slot and reads `–/4`. Gates
unmoved: `probe counts` ALL OK, `overlap` 730/0, `order` 1696/0, `hopgap` 284.

## 2026-09-08 — Blank frame after Restart File: a cursor-follow racing the arrival

Reproduced every time in the live infoview (Mathlib file, `ProofTreeScratch.lean`): after a real click on Restart File the tree came back with the frame BLANK — header and bar drawn, nothing else — until ⛶. Zooming out showed the tree sitting one viewport of padding to the right and below the origin: scroll (0, ~750) where the centring had written (622, 778).

Instrumented with an on-screen log of every scroll writer, scroll event and ResizeObserver tick (the toast was too short and too narrow for it):

```
.24 RO c=548x778
.25 ANIM→0,751  s=0,0   c=548x778 sc=935x3205     ← cursor-follow, on the UNPADDED layout (PAD 0), from (0,0)
.25 CENTRE n=40 v=548x778 P=548,778 → W622,778     ← the arrival centring, took
.27 GROW dy=-69 → W622,709                          ← the frame settling by its header; took
.30 S 0,306  .32 S 0,625 … .38 S 0,751  .44 L0,751  ← the animation's frames, absolute, from its stale origin
```

The follow effect ran on the first commit that had nodes, before the ResizeObserver had reported a size, so `inViewScroll` computed its target with `PAD_X = PAD_Y = 0` and `animateScroll` captured `(x0, y0) = (0, 0)`; it then wrote `x0 + dx·e` for `FOLLOW_MS`, over the top of the centring and the compensation that landed a few milliseconds later. Nothing was wrong with the container, the SVG, the clamps or the browser — three earlier hypotheses (a collapsed content clamp, a refused write, an unobserved wide-container transient), each tried with a retrying write, an "intent" ref and settle ticks, all failed for that reason and were removed.

Fix: the follow and seek effects return early while `PAD_X === 0 || PAD_Y === 0` (they re-run through those deps when the viewport arrives), and the arrival centring calls `cancelFollow` on the shared `FollowAnim` before writing. Verified: after Restart File the tree arrives centred on the cursor node with the tour tab drawn. The `viewport.h === 0` guard added to the centring alongside `viewport.w === 0` stays.

**2026-09-08 — the tour's lists become two toggles (user direction).** "Remove
the explicit `all` option and make the others non-exclusive. The squares: left
square for source, right square for temp, both for both."

The three-way `TourKind` (`all | author | mine`) asked the reader to pick a
READING when the only question they ever actually ask is which SETS are in.
`all` was a third thing to name, sitting beside the two things it was made of,
and it had to be kept in step with them by hand (the tab click's "switch to
`all` and jump there" fallback existed only because a stop could be outside the
list being read). And the item's two extras slots — which had been reporting
`authorCount > 0` / `myCount > 0`, a fact you can also read in the panel — LOOK
like a pair of on/off switches, so the honest thing was to make them be one.

The state is now `tourLists: { source: boolean; temp: boolean }`, both on where
a proof arrives. `tourList(nodes, mine, lists)` in tour.ts is the one dispatch
over the pure functions that were already there (`allStops` for both, then each
set alone, then `[]`), so the ORDER is unchanged: the author's explicit ranks
first, then source position then DFS index, a node in both sets appearing once
as the source's. Turning the last enabled set off is refused with a toast ("One
list stays on") rather than allowed and drawn empty — an empty reading is a
state with no way out but the panel, and nothing else in the bar can be turned
all the way off either. Toggling either set restarts the reading from a
standing start (`tourAt` null, `tourPeek` cleared): the reader asked for a
different set of marks, not to be carried to one of them.

What follows from it, and is the reason the change is small: TABS are drawn for
the list being read, which is now the union, so a disabled set's tabs simply go
— and `goToTab` loses its fallback, since every tab on screen is in the list.
The bar value drops the list name (`Tour: 2/5`, reserving `["–/99", "99/99"]`)
because the slots say which sets are on; the panel's three exclusive rows
become two checkbox rows, `source (n)` and `temporary (n)`, that leave the
panel open; ⌥-click on the item cycles both → source → temp → both; and the
three empty-list messages collapse to one, "No tour stops in the lists that are
on — ⚑ on a node drops one", which is all there is left to say. `TourKind` and
`TOUR_NAMES` are gone.

Measured in the harness on `odd_sums` (3 source stops, ⚑ on one node): arrival
`Tour: –/3` with both slots lit and 3 tabs; source off → `–/0`, 0 tabs,
chevrons disabled, left slot dark; ⚑ → `–/1`, 1 tab; source back on → `–/4`
(the union, 3 ∪ 1); temp off with source already off → refused, toast, state
unchanged; ⌥-click cycles `–/4` → `–/3` → `–/1` → `–/4` with the slots
following; `>` then a toggle takes `1/4` back to `–/3`. `probe counts` covers
the four toggle combinations (4 / 3 / 2 / 0 over one proof with a shared node)
and the rank-first ordering under each.


**Same day, after use:** the refusal went. The two rows are plain checkboxes and both may be off — an empty reading greys the chevrons and draws no tabs, which is what "both off" means; the ⌥-click cycle gained the fourth state (both → source → temp → none → both). And dropping a ⚑ while the temporary list is off now turns that list ON (the gesture says "I want to see this stop"; a mark that did not appear read as a failure). The alternatives weighed: show the tab briefly then let it go (a vanishing mark looks broken, and is still unfindable later), or refuse the drop (two gestures for one intent). The reading restarts from a standing start as on any list change; the view does not move.


### 2026-09-08 — "Tour" becomes **Marks**, and the hover bar loses its ⚑

Two renamings and a subtraction, all of them the same point: *tour* was the
name of the MECHANISM (an ordered reading, CodeTour crossed with vim marks),
and it was leaking into the reader's view of it. What the reader actually sees
on the tree is a numbered tab on a box — a **mark**. So every user-facing
string now says mark: the bar item's prefix (`Marks:`), its title, the tab
titles ("Mark 2 of 4 (source) — click to go"), the panel's two rows, the
toasts ("Mark dropped" — "(⚑)" until 2026-09-22 —, "Mark removed", "Marks: source"), the empty-list
message ("No marks in the lists that are on — the corner nub drops one"), the
`?` panel's rows and the `<`/`>` key row. The CODE keeps `tour.ts`,
`tourLists`, `tourAt`, `TourStop`: renaming identifiers would have been a
large diff over the whole view for no reader's benefit, and the file is the
mechanism, which is still what `tour` names well.

**The ⚑ is off the hover bar.** It was the second way to reach one position:
the corner nub, added the same day, already drops a reader's mark with a plain
click, and the bar's ⌥-⚑ (write `-- .mark` into the source) is now ⌥-click on
that same nub. One position, one place — the rule that took the single-step
ghost out of `elide.ts` in September, applied to a gesture. The nub's
`<title>` carries both clicks ("Drop a mark here — ⌥-click writes `.mark` into
the source"), the gestures table loses four rows (two ⚑ rows per target) and
gains the two clicks on the nub row, and the bar's glyph list drops the ⚑
("for ⧉ lens, skip, ⊹ path and the trash can"). `stoppableHere` no longer
feeds `hasBar`, so a node whose only offered action was the flag now draws no
bar at all. Nothing measured moves: the bar is laid out from its actions, and
the nub occupies the tab's rect, which `probe overlap` already sweeps.

**`Marks: off`.** With both lists off there is no reading, so `–/0` was a
count of nothing — a place in something that is not happening. The value now
reads `off` and is drawn as an OFF value, the treatment the width readout
already had at `full`: opacity 0.6 on the value text alone, added to
`BarValueItem` as `dim` so the two sites share one coding. `values` gains
`"off"` (the reserve is the widest of the three, so nothing to its right moves
when it turns off), and the title says what the state is and how to leave it
("Marks: off — both lists are off; click for the lists, ⌥-click cycles"). The
chevrons stay `disabled` on an empty union, as before — `off` is the special
case of that, said in words instead of as a fraction.

Gates: typecheck, lint, `probe counts` / `overlap` (730 layouts, 0) / `order`
(1696, 0) / `hopgap` (284) all unchanged — the change is strings, one boolean
and a deleted button, and none of it reserves room.

## 2026-09-09 — The bar fills a thin frame, centres a wide one, and the layout marks leave Unicode

**The report.** An infoview pulled thin (frame ≈ 560 device px, ≈ 280 CSS px)
drew the status bar as **two glyphs at the far left**, with the rest of the
frame empty to their right.

**The cause, and it is one line.** `fit` had exactly one idea of how much
width the row had: `avail = frame − (STATUS_INSET + BAR_RIGHT_RESERVE) − 2 ×
STATUS_PAD_X − 2` — the LANE beside the host's "Restart File" button. That is
the right number while the card and the button share a row of chrome. It is
the wrong number when they cannot: at a 252px measured frame the lane is
**148px** against the all-glyph row's own floor of **≈295px**, so the ladder
bottomed out at `kText = 0` and the card, `fit-content` under `max-width:
calc(100% − 118px)`, clamped to 134px, sat right-anchored at
`BAR_RIGHT_RESERVE`, and CLIPPED (`clip-path`, the documented last resort)
everything past the second glyph. Every symptom in the report follows: two
glyphs, because that is what 134px of card holds; far left, because the card's
right edge is pinned 110px in and it had nowhere to grow; empty to the right,
because those 110px were reserved for a button the frame no longer had room to
sit beside. Nothing was broken about the ladder — it was measuring against a
lane that had stopped existing.

**The fix: three placements, one decision, all of it measured.** `fit` now
computes both widths and lets the row's own floor choose between them:

    lane = frame − (STATUS_INSET + BAR_RIGHT_RESERVE) − chrome
    full = frame − 2 × STATUS_INSET − chrome
    dodge = lane >= need(0)          // the all-glyph row still fits beside the button
    avail = dodge ? lane : full

and then, from the width the chosen `kText` actually draws (`cardW = need(k) +
chrome` — from the GHOST, never from the card's own box, so a placement can no
more feed back into the width that chose it than `kText` can):

    place = !dodge                             ? "fill"
          : cardW <= frame − 2 × BAR_RIGHT_RESERVE ? "center"
          : "right"

Each placement carries its own `max-width`, and each one ENFORCES the
precondition it was chosen under: `BAR_MAX_W` (`100% − 118`) for the right
anchor, `BAR_FILL_MAX_W` (`100% − 16`) for the fill, `BAR_CENTER_MAX_W` (`100%
− 220`) for the centre — so a centred card cannot reach the button's lane
however far the diagnostics block runs, whatever the ghost said.

**What survives of the right anchor, and why.** The recorded reason (user
directive: "anchor the right edge … so the distance between the end and the
restart file button never changes") is about the card being BESIDE the button:
the two read as one row of chrome and the eye reads the gap between them, so
that gap must not move when a setting lengthens a value. That reason is intact
and still governs — it is why "center" requires a WHOLE second
`BAR_RIGHT_RESERVE` of clearance rather than a hairline, and why anything
closer falls back to the anchor. It simply says nothing about a card that is
nowhere near the button: centred, the card's growth is symmetric, half a
value's length to each side, and neither edge is measured against anything.
Centring is `left: 50%; transform: translateX(-50%)` — a transform reaches no
layout, and `BarPanel`/`HelpPanel` are placed by `offsetLeft` inside the card,
which is still their nearest positioned ancestor.

**Measured, harness at `?stub-edit` (viewport → measured frame; card l/r are
offsets from the frame's own edges):**

| viewport | frame | placement | `kText` | card w | left margin | right margin |
|---|---|---|---|---|---|---|
| 280 | 252 | fill | 0 | 236 | 8 | 8 |
| 360 | 324 | fill | 0 | 308 | 8 | 8 |
| 480 | 432 | right | 0 | 309 | 13 | 110 |
| 700 | 630 | right | 2 | 445.3 | 74.7 | 110 |
| 1000 | 900 | **center** | 5 | 671.5 | **114.2** | **114.2** |

The card is 26.00 tall at every one. The right-anchored rows still measure
**110.00** in from the frame's right edge — `BAR_RIGHT_RESERVE`, unchanged —
and the ladder is untouched at every width that still dodges: `avail` there is
the same `lane` it always was, so `kText` steps exactly where it stepped. What changed is only the band below the dodge: at 324 the row now
draws **all eight items with none clipped**, where before it was clamped to
206px and lost the eye, `↺` and `?`; at 252 it draws five of eight and clips
the last three, against two of eight before. In the widget the host button is
real and this is the whole point of the fill: below the threshold the button
floats over a row of glyphs (which still read) instead of over 110px of empty
canvas beside a row clipped to nothing. In the HARNESS there is no host button
at all, and the widget does not look for one — the decision is made entirely
from the frame's width against `BAR_RIGHT_RESERVE`, a constant, so harness and
infoview take the same placement at the same width.

**The layout marks: equal ink height was never the complaint.** The 2026 pass
that gave `☰ ⊦ || ⑃` a per-mark `glyphPx` (14/14/8/15) levelled their ink
HEIGHTS and left their WEIGHTS alone. Re-measured in the harness on an 8×
supersampled raster in the code font — median run length across each mark's
own strokes, i.e. stem thickness, in CSS px:

    ☰ 1.25   ⊦ 0.88   || 0.75   ⑃ 0.63
    eye 1.2 (its own strokeWidth)   comment / word-wrap glyphs 1.25   ⚑ 2.9 (solid)

so three of the four drew at **half to two-thirds** the weight of every other
mark in the row. That is the reported "too thin/small", and a font glyph has
no weight knob: the stems come with the face, they thin as `glyphPx` comes
down (`||` sits at 8 precisely so two full-em bars do not tower), and they move
with whatever editor font the user has set — `||` was already the one mark
whose ink follows it (6×9 Menlo, 3×6 Consolas).

So the four are DRAWN now (`LayoutGlyph`), in the idiom the eye and the
comment/word-wrap glyphs already established: inline SVG, `currentColor`,
cropped to its own ink, inside the same fixed `GlyphBox`, one shared
`LAYOUT_GLYPH_SW = 1.4` — a hair over the eye's 1.2 and the other two glyphs'
1.25, which is the side of "too thin" to err on, and these are pure line marks
with none of the ⚑'s solid mass. Geometry, in a 12 × 10 box, ink w × h:

    outline  three full-width bars, y 1.3 / 5.0 / 8.7    10.0 × 8.8
    spine    stem x 2.2, y 1.3–8.7, arm to x 8.5          7.7 × 8.8
    tracks   two bars, x 3.2 and x 8.8, y 1.3–8.7         7.0 × 8.8
    wide     stem to y 4.2, forking to (2.2, 8.7)/(9.8, 8.7)   9.0 × 8.8

— level in height as the `glyphPx` pass left them (8.8 against the old set's
7–9), and now level in weight as well. **The outline mark's SHAPE is
untouched**: three full-width bars, `☰` as it stood, the user deciding on it
separately; only its stroke moved, 1.25 → 1.4, to sit with the rest.
`LAYOUT_MODES` loses its `glyph`/`glyphPx` fields — there is no second coding.
The `GlyphBox` is unchanged at 14, so every width the ghost measures is the
width it measured before and no compaction threshold moved (`probe counts`,
`overlap`, `order`, `hopgap` all clean).


**2026-09-09, after the fill landed in the live pane:** at a 424px infoview the numbers were frame 424, lane 292, floor 295 — `dodge` false by 3px — so the card filled the frame in the button's lane and the host button, drawn over it, hid `?` and ↺. A row of glyphs under the button does NOT read after all. The filling card now sits one lane above the button (`BAR_LIFT = LANE_INSET + LANE_BTN_H + LANE_GAP`), a second row of chrome that costs the tree 30px only at widths where the alternative is hidden controls, and the zoom rail climbs over it (`lifted`, reported by the bar through `onPlace`, read through a ref written in an effect so `fit` stays stable). Centring gained `BAR_CENTER_SLACK` (48) of clearance per side after a first cut at 24 still put a centred card's edge at the button.


**2026-09-09, the outline mark:** ☰ read as a menu. It is now an F — the trunk with a step off it at the top and a shorter one at the middle (`M2.6 1.3v7.4M2.6 1.3h7.2M2.6 5h5`), the same stroke as the other three and the same family as the spine mark. Two alternatives were offered (indented bars; a ▸ before the bars); the user's own instinct was "just an F", and the tree-stub option was already one.


**2026-09-09, the break and the toast.** The skip icon's gap read as a crossed line at 1.2px (the two slants nearly touching); it is 3.6px now, and both the icon and the link's `HopBreak` are drawn JOINED: the line runs into the centre of the upper slant and resumes from the centre of the lower one, so the break is one stroke of chrome rather than a line with two ticks laid over it (gap 6px on the link). And the toast moved from the top-centre column (shared with the modal banner) to bottom-centre above the status bar, lifting with it in a thin pane: a mark jump brings its node to the top of the frame, and `2/5 · caption` sat over the very node it announced, so nothing could be read between marks. The bar is where every toast's cause lives anyway. Note for the record: `prettier --write` was run once over ProofTreeView.tsx during this change; the project has no prettier config but its style is prettier's (the other modules differ from it by a few dozen lines, all long lines from recent edits), so the diff is wrapping noise, not a rewrite.


**Same night, corrected:** the toast's Y was never the complaint — it goes back to the top-centre column. What the reader wanted was the COUNTER to hold still: tabbing through marks, the eye parks on `1/5 → 2/5` and reads the caption after it, and a centred box moved the counter left and right with every caption's length. A mark jump's toast is now `anchored`: the column takes a fixed width (`TOAST_ANCHORED_W` 420, within its 80% cap) and the box fills it, text left-aligned, ellipsis at the right; every other toast stays centred and sized to fit. Harness: two consecutive marks, x 430 / w 420 both times.


**2026-09-09, B1 — term-level structure inside a tactic (Part E).** `exact ⟨key n, parity n, gap n, residue⟩` was one leaf: four propositions the author proved, drawn as one box. `ProofTreeRecover.recoverTermInStep` now walks the four term-taking tactics (`exact`, `refine`, `refine'`, `apply` — kind-matched on `TacticInfo.stx`, the term taken as the LAST NON-ATOM CHILD so nothing counts argument indices), finds the `⟨…⟩` the term is built around (`ctorTarget?`: itself, or one inside a parenthesis or standing as an argument of an application, so `exact Or.inl ⟨h, hk⟩` decomposes and `exact foo a b` stays the leaf it reads as), and for each component synthesises a goal from `TermInfo.expectedType?` and GRAFTS it onto the harvested step — the same seam `recoverCalcLinks` uses for a calc justification, so nothing downstream needed a new shape. Below each goal `walkTerm` runs, which is Part B unchanged except for one addition: `anonymousCtor`, until now a `leaf`, is a case, so a term-mode `⟨…⟩` decomposes too. Every step it mints is stamped `recovered: "subterm"` (Part E restamps `walkTerm`'s "term"), a new value in the client's `RecoveredStep.kind` union; goal ids come from `syntheticGoalId`, i.e. source position, not mvarIds.

Three guards, each of them a component that is already somewhere else or says nothing:

* **a hole** (`?_`, `_`) is the tactic's own remaining goal, already drawn — `refine ⟨2 * k * k, ?_⟩` must not draw it twice;
* **a component containing a harvested step** belongs to the harvest. `⟨by simp, rfl⟩`: Part B's `leaf` already spawns that block's root goal, and a second box for it would draw the same subtree twice. Measured on `ProofTreeTerms.lean`'s `term_nested_by` — the `by simp` graft appears once, `rfl` gains its own goal, 2 steps → 3;
* **a data component** is a witness, not an argument. `2 * k * k : ℕ` would get `⊢ ℕ`, which says nothing, so `Meta.isProp` on the expected type is the gate. Together with the hole rule, `refine ⟨2 * k * k, ?_⟩` grafts NOTHING — the case the counts probe pins.

Numbers (measured, `gen.sh` corpus). odd_sums 70 → 78 nodes: four goals and four leaves under the closing `exact`, whose spawned goals are now `goal_80_9 … goal_80_33` in source order (grafts are APPENDED, not prepended — `Recovery.apply` grafts in list order, and a prepend reversed the components). Every odd_sums cut number moves by the same +8: root hop 55 → 63, goal-after-key 68 → 76, succ fold 63 → 71, parity hop 44 → 52; collapse-all 14 → 18 with 4 → 8 folded goals, because each new component goal is a branch root with a child and so earns its own `outlineCuts` fold. Elsewhere: euclid +5 (`⟨n, hp, dvd_refl n⟩`, `⟨p, hpp, hpm.trans hmdvd⟩`, and `hp` out of `refine ⟨p, hp, ?_⟩`), multiline +4, commented +1 (`⟨0, Or.inl rfl⟩`; its sibling `⟨k, Or.inr (by omega)⟩` grafts nothing, the nested-`by` guard), wrap +11 (the widest fixture: nested ctor and two `fun` bodies, walked by Part B). Every other record in `sample.ndjson` is byte-identical, and every change is an addition. `probe counts` (with a new Part E block), `overlap` (730 layouts, 0), `order` (1912, 0 moves), `hopgap` all green; `structural` clean on every record and every cut.

Two places the design bent. **The lens.** `goalAnnotations` keeps ONE annotation per source line, latest start wins; four subterm steps share the `exact`'s line, so the last of them (`residue`, no goals after) would have spoken for the line, and the host `exact`'s own reading would have become "⊢ ∑ … +3 more" because `after` falls back to `spawnedGoals` when `goalsAfter` is empty. `lensGoals` in widget.tsx now drops subterm steps AND filters the grafted goals out of their host's `spawnedGoals` — Part B's `term` steps still stay, because in a term-mode proof they ARE the script. **The look.** The brief asked for a deliberate look for the new kind; `recovered === "term"` has none today (no `recoveredStroke`, so it draws as an ordinary tactic), and a subterm is the same species as a term step — inventing a stroke for one and not the other would have said they differ. Rejected: the dashed comment-ink stroke `skipped` wears, which in this vocabulary means REDUCED IN PLACE and would misread a real piece of source. What the new kind gets instead is a `<title>` line ("A term the tactic above supplied — its goal is the component's expected type"), ahead of the fold tip; `nodeHints` has no row about term steps to extend, so no help row was added.

Left undone: `apply` and `refine'` are wired but no corpus fixture exercises them; a structured term that is a bare `fun`/`have`/`show` at the top of a tactic (`exact fun x => …`) still mints nothing, because grafting a goal for the body would need a box for the term itself and the tactic node already is that box — the anonymous constructor is the only shape where the components have somewhere to hang.

**2026-09-09, B1 Part E drawn as a LEDGER (the calc idiom, one mechanism).** The user, on a screenshot of the live infoview: *"Should inline like calc blocks since they're related."* Part E's four component goals under `exact ⟨key n, parity n, gap n, residue⟩` were drawing as four spawned side branches (goal box + leaf each), the last of them dropping into the trunk lane. They now draw as ONE LEDGER: the tactic keeps its own text, a ledger node lists one row per component (the row's text IS the component's goal, the way a calc row is the link's relation), and each component's proof hangs off it as a calc justification does.

**The mechanism is the client's ledger, not the `CalcChain` sidecar** — and this is a deliberate departure from the brief, which asked for a `CalcChain`-shaped sidecar with a `kind` field. `CalcChain` carries NO rows: it is calc's EDIT affordance (`indent`, `broken`, `firstBare`, `links`, `text`, feeding `repairSpec`/`addLinkFor`), and a constructor has none of those. The rows come from `ledgerFor` in proofToTree.ts, client-side, off the harvested goals. So the shared thing is `LedgerRow[]` + the `ledger:<line>:<char>` node + `ledgerParent`, and adding a second `CalcChain` would have added a mechanism rather than shared one. What Part E DOES emit is the minimum the client cannot compute: WHICH spawned goals are components, and in what source order. `TermLedger {tacticStart, kind: "ctor", rows: [{goalId, start, stop}]}`, a per-step sidecar keyed on `position.start` like every other, plain data on both wires (`Recovery.ledgers` → `ProofTreeData.termLedgers` → `stableProofOf`). No text and no justification range ride it: the client reads the row's text off the goal (`goals.get(id).type`) and the justification off `stepByGoal`, exactly as `ledgerFor` does, so the printed statement keeps ONE source of truth. Row identification needed the sidecar for a reason the guards make plain: a nested `by` component grafts NOTHING (the harvest already owns its root goal) but is still a component and still a row, so `harvestedGoalIn` names it from the outermost harvested step written inside the component.

**The renderer branches nowhere.** `ProofTreeView.tsx`'s ledger paint, the row `<title>`s, `chainOpen`, `toggleRow`, `remapIds`' ledger sets and `ledgerSize` in layout.ts are all generic over `LedgerRow[]` already — `ledgerSize` even reads `rows.some(isLedgerHead)` to decide the indent, so a head-less ctor row set lays out with no change. THREE places branch, and they are the three that would otherwise say something false: `narrateFamily` (a ctor is not "a chain of (in)equalities"), `runnable` in rewrite.ts and `blocked` in `combineRuns` (a ledger host's sole child is the ledger, not a goal a linear run can continue through — `chain` covered the calc host alone). The flag they read is `TreeNode.ledgerKind: "calc" | "ctor"`, stamped on BOTH the host tactic and the ledger node. Inside `proofToTree` a local `calcLed` keeps the four calc-only behaviours: the label `calc` standing for its chain (a constructor keeps its own text and its brief-mode elision), `chain: true` on the ledger node, `chainCtxNext`, and `linkElisions`. Layout needed nothing: `n.ledger !== undefined` already means "no child takes the trunk", so the rows' justifications indent together and the `?_` continuation of a `refine ⟨…, ?_⟩` — a child of the TACTIC, after the ledger — stays `last` and keeps the trunk.

**Gates.** The calc ones, asked of the same things: a row needs a justification step that is neither a `sorry` stub nor a hole, and below TWO rows nothing is minted, because one component is better served by the branch box it already had. That is what leaves `commented.lean`'s `⟨0, Or.inl rfl⟩` (one prop component) and `refine ⟨p, hp, ?_⟩` (a witness, a prop, a hole) exactly as they were.

**Cuts.** ◌ on a ctor row's justification does what ◌ on a CALC row's justification does, and that was measured before it was decided: the justification hangs off the ledger NODE, which is `type: "goal"`, so `stepCut` takes its goal branch and gets `goalCut`'s answer — a `fold` of the whole ledger. Every row of every ledger in the corpus, calc and ctor alike, answers `fold @ledger:…`. Making ◌ skip one component would have made the constructor answer differently from the chain for no reason the reader could see, and the per-component gesture already exists: click the ROW to bring that component's goal out, then its own `−` folds that justification alone. The `stepCut` comment claiming a calc step "hangs off the ledger tactic" and is "the one place ◌ still mints a ghost" was WRONG and is corrected in place: the ghost's last remaining door is a step hanging off a TACTIC — a broken chain's synthetic `calc` node.

**Narration.** `ctor` is a family of its own, `Prove each part: <row>; <row>; …` (LINE_CAP as everywhere). `probe narrate` stays at 251/251 templated, residue 0, with `ctor:6` beside `calc:3`. Summaries needed nothing: the ledger node falls in `opened`'s `main`, so `summaryOfTactic` folds the rows' justifications with the same `; then` join it uses for a chain.

**Numbers (measured, `gen.sh` corpus).** Six ledgers: odd_sums (4 rows), euclid ×2 and multiline ×2 (2 each), wrap (6 — `refine ⟨rfl, fun _ => hn, Or.inl hk, fun x _ => rfl, rfl, fun h => …⟩`). Every NDJSON record is byte-identical apart from an added `termLedgers` key on those five records. odd_sums 78 → 75 nodes (four goal boxes become one ledger node); root hop 63 → 60, goal-after-key 76 → 73, succ fold 71 → 68, parity hop 52 → 49; collapse-all 18 → 19 drawn with 8 → 4 folded goals — the component goals are no longer branch roots, so `outlineCuts` no longer folds them and the ledger's rows and leaves stay drawn in the outline. That is the CALC ledger's own standing behaviour (a calc's rows and justifications survive collapse-all too), and it was left alone rather than made a special case. Corpus-wide context lines carrying provenance 395 → 409: the ledger node carries the host goal's context (as a calc ledger does, suppressed in paint by `hypsInheritedFrom`) where the four component goals carried their own. `probe overlap` 1640 layouts / 0, `order` 1872 / 0 moves, `hopgap` all OK, `rewrite`, `eval` and `lints` unchanged. The counts probe's Part E block was rewritten to assert the ledger: `ledgerKind`, one child, four rows with `goalId` and no `hiddenLhs`, the leaves in source order all stamped `subterm`, and — the point of the change — ZERO spawned goals still hanging off the host tactic.

**Verified live and in the harness.** `probe lsp ../lean/ProofTreeTour.lean 77 4 --json` on the running server returns `termLedgers: [{kind: "ctor", tacticStart: 77:2, rows: [goal_77_9 @77:9-12, goal_77_14 @77:14-18]}]` for `exact ⟨hab, hpos⟩`. Harness `select(19)`: the ledger draws as the calc block does — tactic, ledger box with the four component goals as rows, four leaves indented beneath it at one x (measured 120 for both the first, `key n`, and the last, `residue`), none of them in the trunk lane (the host tactic's own x is 72). A calc ledger screenshotted beside it is the same picture with a head row and an indent.

**Left undone.** No corpus fixture has a `refine ⟨…, ?_⟩` that mints two or more rows, so the "continuation keeps the trunk beside a ledger" case is structural (layout's `last` rule) and not measured. And the ROW-to-LEAF correspondence is positional only — the leaves stack under the whole ledger box rather than each beside its own row, which is how calc has always drawn and is what "the calc idiom" was asked for.

### 2026-09-09 — The "never fork Paperproof" rule is struck

User direction: "relax never fork the paperproof parser … strike it as a project rule. All bets off now." Post-processing and additive walks stay the first choice because they are cheap and keep the pin, but where `BetterParser`'s harvest is itself the limit (B2 provenance, B4 automation traces, B5 case semantics) the parser may be changed. If it is: vendor the changed files under `lean/` (never edit `.lake/packages/`), keep the upstream commit pin so the diff against it is readable, and record each departure here.


### 2026-09-09 — B2, hypothesis provenance

**Where a hypothesis came from.** Paperproof ships the raw `fvarId` on every
`Hypothesis` and correlates nothing across steps, which is why a reader of a
context box could see `hk : n = 2 * k + 1` and have no way to ask which line
of the proof put it there. That reading is now recovered — and it needed no
change to `BetterParser`. **The post-pass sufficed**: the harvest already
carries every id on both sides of every step, so one walk over the FINAL step
list (after every recovery is applied, so a recovered `have`/term step
introduces like any other) in SOURCE ORDER answers it. `ProofTree.hypOrigins`
(ProofTreeRecover.lean, `Array HypOrigin {id, username, start}`) emits one
entry per id that appears in `goalsAfter ++ spawnedGoals` and is absent from
that step's `goalBefore.hyps`. It ships on both wires: a field on
`ProofTreeData` for the widget, an optional `("hypOrigins", …)` pair emitted
only when non-empty in `resultToJson`, so an untouched record's NDJSON line is
byte-identical.

Two rules decide the shape.

* **First writer wins**, which is not a tie-break but the reading itself. A
  rewritten hypothesis gets a NEW fvarId, so the rewriting step registers it
  and *is* its origin: in odd_sums, `hn` is introduced by `by_cases hn` on line
  67 in both branches, and in the odd branch `rw [Nat.not_even_iff_odd] at hn`
  on line 75 introduces the `hn : Odd n` that the branch below actually reads.
  A reader following `hn` down that branch is told about the rewrite, not sent
  back past it.
* **The declaration's binders get nothing.** They sit in the root step's
  `goalBefore`, so they are never "absent from goalBefore" anywhere and no
  special case is needed. `hyp_used.lean`'s `all_marked` (`a b : ℕ`,
  `hab : a = b`, one `rw`) ships an EMPTY sidecar, i.e. none at all. "From the
  statement" is said by silence: no title, no wash, no connector.

**Matching, client-side, is by ID ALONE** — a deliberate departure from the
used-set's `deepUsed`, which matches id-first and falls back to `username`
because a subtree's ids drift from the goal's. Here the drift is the point:
the re-minting step registers the new id, so the table's key is always the id
the goal in hand carries, and an id-miss means "no step introduced this". The
username fallback was written anyway and MEASURED over the corpus: it fired
twice in ~1300 context lines and was wrong both times, pointing
`commented.lean`'s statement binder `h` at the `rw [hb] at h` that would later
rewrite it — i.e. it invented provenance from the future. Removed. There is no
third matching rule.

`proofToTree` turns the sidecar into node ids through one position→step map
(`tacticId(step.goalBefore.id)`), and stamps `HypLine.origin` (the introducing
tactic node), `originText` (`tacticHead` of its label — the same cut the ghost
labels use) and `originLine` (1-based, as the editor counts). Layout's wrap
copies all three onto every wrapped piece: a hypothesis that spills over two
lines came from ONE step and hovering either half must say so.

**The view, on demand and paint only.** `hoverHyp` (the line under the
pointer) and `hypOrigin` (the line dwelt on for `HYP_LIT_DWELL_MS`, the same
350 ms the used-hyp wash waits) are two `nodeId\u0000lineIndex` strings — a
primitive, so the dwell effect can depend on it — and neither reaches the
engine, the cut list, an anchor or a `viewKey`. On the dwell: the introducing
tactic box takes `HYP_LIT_FILL`, the wash `hypLitTactics` already uses in the
other direction (that lights the LINES a tactic uses; this lights the TACTIC a
line came from — one relation, read from both ends, and no new colour), and a
dashed connector runs from the hyp line's left edge out to a channel
`ORIGIN_CHANNEL` (12) clear of both boxes and back into the introducing box's
left edge: one elbow each end, `--ptw-comment`, `strokeDasharray "3 3"`,
`pointerEvents` none, drawn in the overlay above every node so it reads as one
line rather than an edge of the proof. An origin that is folded away resolves
to nothing and no ink is spent claiming a box that is not there; the `<title>`
("introduced by \`have key…\` (line 17)") still says where it came from.
Hit-testing has two paths because the two render paths differ: on the plain
`<text>` path a per-line transparent rect (`data-ptw-hyp`, geometry from
`hypLineOffset`/`HYP_LINE_H`, the measurer's own numbers) — the glyphs alone
are hit-testable and the gaps between them are not; on the tagged path the
line's own `<div>` carries enter/leave and the title, because a rect laid over
it would swallow the `InteractiveCode` popups the hyp types carry. One
`nodeHints` row under `goal`: "hover a context line → names the step that
introduced it, lights that step and points at it".

**Measured.** `./gen.sh`: 17 of 31 records gain `hypOrigins` and change in no
other way (the four that also moved — odd_sums, euclid, multiline#1, wrap,
commented#1 — moved in `steps`/`allGoals`/`recovered`, which is B1's Part E);
`hyp_used#2` is byte-identical, having no origins to ship. 390 context lines
across the corpus carry provenance, every one of them resolving to a tactic
node of the same tree (`probe counts`, new B2 block, which also pins
`hyp_used`'s `rintro ⟨k, hk⟩` on line 26 for both `k` and `hk` with the binder
`m` beside them bare, odd_sums' `have key` on 17, `by_cases hn` on 67, the
line-75 re-origin, and `obtain ⟨k, hk⟩` on 76). `counts`, `overlap` (730
layouts, 0), `order` (1912, 0 moves) and `hopgap` all unchanged — the sidecar
adds no node and reserves no space. Live server (`probe lsp
../lean/ProofTreeTour.lean 75 4 --json`, `tour_editing`): three origins,
`hbb`/`hab`/`hpos` at lines 75/76/77 (0-based), and the four statement binders
`a b h hb` absent — the widget wire carries it, through `stableProofOf`, with
nothing added to `incoming`. Harness (`?stub-edit`, `select(19)`, real pointer
hover on `m : ℕ` in the goal `intro m` opened): connector
`M82.4,332.5 H58.4 V284 H70.4` landing exactly on the washed box's left edge
(`translate(107.686,284)`, half-width 37.286), one wash rect, and every
existing `<g transform>` byte-identical across the hover — the only DOM
addition being the node's own hover bar. Nothing moved.

Left undone: nothing in the design; the connector is a single elbow and makes
no attempt to route around intervening boxes, which on a wide tree can run it
across a node's corner in the channel — acceptable because it is 1px dashed
comment ink and lives only while the pointer dwells.

## 2026-09-09 — B3: the constants a step names, with their docstrings

The premise library Workstream C's templates need: for every step, the
lemmas and definitions its tactic text actually references. `▸`-style used
marks answer "which HYPOTHESES did this use?"; this is the other half of the
same question, and it is the one input every informalization paper
(Hattori, Herald, CoSProver) takes as given.

**Nothing new was harvested.** `collectConstIdentTokens` (Ramify.lean) already
walked `tree.deepestNodes` for `TermInfo` nodes whose syntax is an ORIGINAL
identifier and whose `expr.getAppFn.isConst` — computing exactly the right
set of nodes and then throwing the constant's NAME away, keeping only the
range so the token could be painted `const`-coloured. B3 is that walk with the
name kept. The predicate now lives ONCE, as `ProofTree.constIdentNodes`
(ProofTreeRecover.lean, returning `(Syntax × Name)`), and
`collectConstIdentTokens` is three lines over it. That sharing is the point,
not tidiness: a name that colours as a constant and a name that appears in a
step's reference list must be the same set, and two matching guards in two
files is exactly the drift CLAUDE.md's measurer/renderer rule exists to stop.
Paperproof's own `GetTheorems`/`ProofStep.theorems` was NOT used — it is
always `[]` on both wires and expensive to fill.

**Attribution is INNERMOST, and that is the whole design decision.** Tactic
ranges NEST: `have key : … := by induction m with … rw [Finset.sum_range_succ]`
is a harvested step that contains three more harvested steps. Attributing an
identifier to every containing step would give the outer `have` its entire
subtree's premises, and a list that contains everything says nothing. So each
identifier goes to the containing step with the LATEST start (ties to the
tightest stop) and to that one alone. Measured on odd_sums: the `rw` owns
`Finset.sum_range_succ`, and the enclosing `have key` does not repeat it.

One thing the innermost rule does that is worth recording because it looks
like a bug and is not: `have key`'s list is
`Finset.range · Nat.zero · Nat.succ`. `Nat.zero`/`Nat.succ` are the CASE
LABELS of the `induction m with | zero | succ` below it — the `induction`
step's own `position` stops at the end of its line, so the labels on the
following lines are outside it, and the innermost step that does contain them
is the `have`. This is the rule reporting honestly, not a misattribution; the
`induction` step's own range genuinely names nothing. `probe counts` asserts
both halves so a later change to step ranges shows up as a diff.

**Local hypotheses need no exclusion.** They are fvars, not constants, so the
shared predicate drops them for free — the closing
`exact ⟨key n, parity n, gap n, residue⟩` of odd_sums has an EMPTY list, and
so does each of its four B1 subterm leaves, which are harvested steps with
positions of their own and therefore attribute innermost like any other.
Excluded by name: the declaration under elaboration (structural recursion
refers to itself, which is not a premise), and internal / macro-scoped names.
Instances were considered for the `kind` field and dropped: `ConstantInfo`
alone gives `theorem | def | axiom | inductive | ctor | rec | opaque | quot`
for free from `env.find?`, and "is this a registered instance" needs an
attribute lookup for a distinction C's templates do not yet make. Per step the
list is deduped by name and keeps source order of first occurrence
(`have parity : ∀ m, Even m ↔ Even (m ^ 2)` writes `Even` twice, lists it once).

**Wire.** `lemmaRefs : Array LemmaRef` with `{stepStart, name, doc?, kind}` —
plain data, so it ships on BOTH wires (`resultToJson` emits it only when
non-empty, as the other sidecars do; `stableProofOf` carries it). The
docstring is `findDocString?`'s raw markdown, a `String` and not a
`CodeWithInfos`, which is what makes the offline corpus able to see it at all.
It is computed in `mkTreePayload`, so the counterfactual path gets it for
nothing. `declName?` moved from Ramify.lean to ProofTreeRecover.lean so both
entry points can name the declaration to exclude.

**Coverage, measured over the 31-proof CLI corpus (the numbers C will quote):**
244 drawn tactic nodes, 61 of them (25.0%) naming at least one constant; 70
references in all, 29 of them (41.4%) carrying a docstring; 37 distinct names,
12 of which are documented. By kind: 43 theorem, 19 def, 8 ctor. Top ten
names: `rfl`, `Nat.add_zero` (5 each), `Finset.range`, `Finset.sum_range_succ`,
`Nat.factorial` (4), `Or.inl`, `Nat.Prime`, `Nat.sub_add_cancel` (3),
`sq_nonneg`, `Nat.strong_induction_on` (2). The 75% of steps with no
reference at all are the structural ones — `intro`, `constructor`, `ring`,
`omega`, bullets — which is the shape C's templates should expect: the
premise library is sparse and it is the `rw`/`exact`/`have` steps that carry
it. On the live server (LSP probe, `ProofTreeScratch.lean` at 11:2) the same
walk gives `infinitude_of_primes` nine references across five steps, two with
docstrings, so the widget sees exactly what the CLI does.

**Surfaced minimally, on purpose.** The tactic node's `<title>` gains a
`uses: Nat.dvd_one · Nat.not_prime_one` line (first four, ` · `-joined, `…`
beyond) and `nodeHints` gains one row saying so. NOTHING is drawn: no badge,
no lane, no reserved room, so no measurer changes and `probe overlap` has
nothing new to model. `probe counts`, `overlap`, `order` and `hopgap` are
unchanged; the only diff in `sample.ndjson` is the `lemmaRefs` arrays.

**Left undone, deliberately.** Making `docTip.tsx` show `lemmas[].doc` in the
harness was scoped and dropped. The popup hangs off `DocTokenSpan`, which is
reached from `tacticTokens.tsx` — a DOM span path fed by `tokenInfos` and
`tacticEdits`, both widget-only, and one the harness does not run at all
(offline node labels are SVG `<text>`, not spans). Showing a docstring there
means giving the harness a whole token-span rendering path and a DOM overlay
over an SVG label — far more than the ~40 lines the brief allowed, and a new
overlay to pair with the measurer. The docstrings are on the offline wire and
probeable; only the offline POPUP is missing. In the widget the docstring for
a constant is already reachable by hovering the token itself, which is where a
reader looks for it.

## 2026-09-09 — B4: what the automation used

The reader's question at a `simp` is the one the source cannot answer. `▸`
marks say which HYPOTHESES a step used (B2 says where each came from); B3's
`lemmaRefs` say which constants the author WROTE. At `simp`, `grind` or
`aesop` the author wrote no name at all and the premises are whatever the
search found, so both of those lists are empty and correct and useless. B4 is
the third question: **which lemmas closed this goal**, answered by the
elaborator and not by us.

**Mechanism: core's own `?` forms, and nothing invented.** Measured on this
toolchain (`lake env lean` over a scratch file, v4.32.2): `simp?`, `simp_all?`,
`grind?` and `aesop?` all exist and all emit a suggestion. `simp?` and
`aesop?` say `Try this:\n  [apply] simp only [a, b, c]`; **`grind?` says "Try
these:"** — plural — and offers a LIST of scripts (`grind only [!foo]` and
`grind => instantiate only [!foo]`), with a `!` prefix on the names. Both
headers are read, every line of a list is kept, and the names are pooled and
deduped, so a reader gets the union of what the search reported. The `!`, `←`,
`<-`, `↑`, `@` and `-` prefixes are stripped; anything in a bracket that is not
a dotted identifier (a numeral, a parenthesised term, `*`) is skipped. The raw
suggestion text is kept beside the parse, so nothing depends on the parse being
complete.

Tactics with NO `?` form in v4.32.2 — `omega`, `linarith`, `nlinarith`,
`decide`, `norm_num`, `positivity`, `ring`, `ring_nf`, `trivial`, `tauto` —
are **not left out**: they get a trace of kind `opaque`, computed with no
elaboration at all, and the subtree opens to one line, `omega keeps no lemma
list`. Silence at an offered affordance reads as a broken affordance; saying
"this one closes by decision procedure, there is no list" is the answer.

**ALL SITES AT ONCE — the decision that makes it affordable.** The brief asked
for the counterfactual pipeline's per-step splice: one tactic replaced, one
declaration re-elaborated, per step. A `?` form behaves EXACTLY as the bare one
(it only says more), so every automation tactic in the declaration can be
rewritten together and ONE re-elaboration answers for the whole proof. On a
proof with ten `simp`s the per-step shape pays ten Mathlib elaborations for
data the first pass already had in hand. Rejected accordingly. What survives
the brief is the laziness: the widget still computes nothing until the reader
asks, and then the first ask pays for every automation step in the declaration
and the rest are free.

Positions come back from that rewrite unshifted in the only way that matters:
inserting `?` never adds a line, so a rewritten tactic's start moves by exactly
the number of `?`s inserted EARLIER ON ITS OWN LINE. `traceSites` records both
the original start (the sidecar's key) and the new one (what the message's
position will read), and `collectTraces` matches on the new one EXACTLY — no
proximity guess, and a mismatch surfaces as `kind: "failed"` rather than as a
lemma list attributed to the wrong step.

**The re-elaboration seam is now shared.** `computeCf`'s first forty lines —
find the finished snapshot before the anchor byte, re-parse one command against
its `cmdState` with `Elab.async` off, `elabCommandTopLevel` it into a fresh
ref, hand back the synthetic snapshot — are `reElabDecl` (Ramify.lean), which
cf and B4 both call. The one difference is a flag: cf needs `infoState.trees`
to be exactly one tree (it runs `BetterParser_Tree` over it), while a trace
reads only messages and a `sorry`-free re-elaboration can legitimately leave
more, so `needInfoTree` is false there. `computeCf`'s behaviour is unchanged —
same anchor (`lineStart`), same messages, same order (parse messages then
elaboration messages).

**The environment trap, hit for real.** The CLI's second pass is a whole-file
`processCommands`, and the first version handed it `finalEnv` — the environment
the first pass finished with. Every declaration then reported
`'sum_range_odd' has already been declared` and not one `Try this` came out;
the traces all read `failed` and looked like a parse bug. The second pass takes
the HEADER environment; name resolution (docstrings, `ConstantInfo` kinds)
still takes the finished one, since that is where the declarations are.

(`PPH_TRACE_DEBUG=1` on the CLI prints every site and every message with its
position, which is the only way to see a position mismatch — the symptom is a
silent `failed`, and that is what it looked like here.)

**Shape.** `ProofTree.AutomationTrace {stepStart, tactic, kind, suggestion?,
lemmas}` — plain data, so it ships on BOTH wires; `lemmas` is B3's own
`LemmaRef`, resolved through the same `env.find?`/`findDocString?` pair, so the
two lists read identically in the client. `kind` is `"lemmas" | "opaque" |
"failed"`. On the offline wire it rides `Proof.automationTraces` (carried by
`stableProofOf`); in the widget it does NOT ride the payload at all — a proof
with ten `simp`s must not re-elaborate on every cursor move — and arrives from
`ProofTree.getAutomationTrace {pos, stepStart?}`, held in widget.tsx's own
state and passed to the view as a SIBLING, which is why `ProofTreeView` takes
`automationTraces` as an argument with `proof.automationTraces` as fallback
(the `deleteSlots` rule). The RPC is synchronous (the reader asked and is
watching a pending glyph, where cf fires unbidden on a cursor move) and cached
on `(uri, version, declaration start)` — `proofTreeCache`'s key minus the
diagnostics count, which a trace does not depend on. The widget's own list is
keyed on `proofId` in STATE, not a ref: navigating to another declaration
simply stops matching and the list falls away, with no effect and nothing to
clear (the refs lint is the gate and it caught the first version).

**The subtree is minted on the DRAWN tree, and that is deliberate.**
`applyTraces` (web/src/trace.ts) runs AFTER `applyElisions`, and `treeIdx` —
the index elide.ts's cut rules read — filters trace leaves out. Otherwise a
closing `simp` with its trace open would stop being a leaf, `stepIds` would
return non-empty, and the goal above would HOP where it used to FOLD: opening
a lemma list would silently change what `−` does. As a bonus, a step a cut has
hidden takes its trace with it for nothing — there is no node to hang it under.
The leaves are ordinary tactic nodes with `traceLeaf` set, positionless (so
nothing offers to edit, reveal, delete or flag them) and id'd
`trace:<line>:<char>:<i>` from the step's own position, which is what carries
them across a re-parse without `remapIds` needing to know they exist. They
paint like a ghost — transparent fill, `3 3` dash, comment ink for box and text
— because they are the same kind of thing: not the author's words.

**Gesture.** One hover-bar button, `⁇` (the tactic's own `?` said twice: the
affordance and the mechanism are one character, and it is a question, which is
what the reader is asking). Click opens, click closes, and while the RPC is out
the glyph is `…` and the title says so. It is offered on every automation node
(`isAutomationNode`, a SOURCE fact — the head word and a position — so the
button is there before any round trip) wherever an `onTrace` exists, and
offline wherever the corpus already carries a trace. The subtree IS a relayout,
so `toggleTrace` calls `anchorOn` first, like every other one. The step's
`<title>` gains a `via simp?: Finset.range_zero · Finset.sum_empty · …` line
beside B3's `uses:` as soon as the answer is in — which is what tells a reader
the button did something before they open anything — and `nodeHints` gains two
rows (one for open, one for closed), so the `?` panel says it too.

**Timing, measured over the 13-file / 31-proof CLI corpus.** `gen.sh` without
traces: 167.0s. With: 171.0s. **+3.9s, 2.3%** — because the cost of these files
is Mathlib's import, not the elaboration, and the second pass reuses the header
environment. Well under the 10s the brief set as the threshold, so traces are
ON by default in `gen.sh` (`--no-traces` is the escape) and the corpus carries
them: the harness can show the real gesture with no server, and `probe counts`
can assert them. The NDJSON is byte-identical to the traces-off run once
`automationTraces` is stripped (checked field by field over all 31 records).

**What the corpus says.** 36 traces over 13 of the 31 records: 26 `opaque`
(`omega` ×16, `ring` ×7, `linarith` ×2, `norm_num` ×1), 10 with a lemma list
(9 `simp` and `proofs/multiline.lean:28`'s `grind [Nat.factorial_pos]`, which
reports `grind only [!Nat.factorial_pos]`), none `failed`. **22 lemmas named,
NONE of them documented** — the `simp` set is `Finset.range_zero`, `zero_add`,
`mul_one`, `add_zero`, `ne_eq`, `not_false_eq_true`, `zero_pow` &c, and Mathlib
does not docstring its simp lemmas. Worth knowing before C leans on `doc` for
narration: B3 measured 41% of the constants an author WRITES as documented, and
B4 measures 0% of the ones the search FINDS.

That `grind` was the specimen that turned up both of the format surprises —
"Try these:" and the `!` prefix — and it read `failed` until they were handled.
Which is the argument for keeping `failed` as a kind rather than dropping the
trace: an unhandled suggestion format shows up as a step that says "nothing
reported", visibly, instead of as a step with no affordance.

**One layout rule bent, once.** `computeLayout`'s stacked pass gives the LAST
child the trunk lane (the proof continues under its step, side work goes
beside it). A trace's leaves are all side work — not one of them continues the
proof — so the sixth lemma of odd_sums' `simp` was drawn under the step with
the other five beside it, reading as if that one were the continuation.
`trunk` is now `undefined` when the last child is a trace leaf, which is the
same answer the ledger case already gives. Placement only: no size changes, so
no measurer moves with it, and `overlap`/`order`/`hopgap` are unchanged.

**Verified.** `probe counts` gains a B4 block (a closed trace adds NO node —
the invariant that lets every cut number above keep meaning what it meant; the
stamp lands anyway; opening odd_sums' `simp` adds exactly six positionless
leaves parented on the step with `trace:23:6:*` ids; `omega` opens to its one
opaque line; every one of the corpus's 36 traces hangs on a tactic node the
client would offer the affordance for). `overlap` 730/0, `order` 1912/0,
`hopgap` 284 — all unchanged, since the subtree exists only while it is open
and reserves nothing when it is not. Live server (`probe lsp
../lean/ProofTreeScratch.lean 11 2 --trace`): `infinitude_of_primes`'s two
`grind`s trace to `Nat.factorial_pos` and to
`Nat.not_prime_one · Nat.dvd_one`, **75ms** for the first call (one declaration
re-elaborated) and **1ms** for the second, off the cache. The counterfactual
pipeline still works after the `reElabDecl` refactor — a scratch declaration
with `· omeg` on its last line returns `cfPending` then serves
`cf: line 6 draft="· omeg"` with three steps (the probe now polls for the
served payload, so a cf regression is visible from it rather than only in the
editor). Harness (`?stub-edit&trace-stub`, record 19): the `⁇` opens 78 → 84
with six dashed comment-ink boxes in ONE lane, the step's `<title>` reads
`via simp?: Finset.range_zero · Finset.sum_empty · ne_eq ·
OfNat.ofNat_ne_zero …`, closing returns 84 → 78 with the `simp` box at exactly
the same client rect (204, 310) and `scrollTop` unchanged — the anchor holds —
and `omega` opens to the single line `omega keeps no lemma list`.

**Left undone, deliberately.** (1) `getAutomationTrace` ignores its
`stepStart` argument beyond logging: the answer is the whole declaration's
list either way, and narrowing would cost a second elaboration to save nothing.
The parameter stays because a future narrowing is the obvious extension and the
wire should not have to change for it. (2) The trace leaves show a NAME, not a
statement: `Finset.sum_range_succ`, not what it says. The statement is a
`CodeWithInfos` the widget could render and the offline wire could not, and the
docstring is already reachable by hovering the constant. (3) No trace is
offered for a tactic inside a `calc` ledger row — a ledger step hangs off the
ledger tactic and has no box of its own to grow a subtree under.

## 2026-09-09 — B5: what a branching tactic did, asked of its syntax kind

The tree drew a case split from two facts and neither of them was the
tactic. `GoalInfo.username` gave the tag (`zero`, `succ`, `inl`, `pos`,
`mp`), and one regex over the tactic's TEXT — `MAIN_FIRST_RE`,
`/^(rw|rewrite|erw)\b/` — decided which of several goals-after is the
proof's continuation and which are obligations the tactic made on the way.
Everything the author actually wrote about the branch was lost: `induction m
with | succ k ih` drew a badge reading `succ`, and `k` and `ih` — the names
the reader has to carry down that whole case — appeared nowhere;
`rcases h with ⟨k, hk⟩ | h` drew `inl`/`inr` with the patterns gone.

**The inventory, before.** Smaller than the brief assumed, and worth
recording because the shape of B5 follows from it. Regexes that decided tree
SHAPE, child ORDER or a case LABEL:

| where | regex | decided |
|---|---|---|
| `proofToTree.ts` `MAIN_FIRST_RE` | `/^(rw\|rewrite\|erw)\b/` | `TreeNode.side` on every child but the first, for a step with ≥2 goals-after |
| `proofToTree.ts` `addSpecFor` | `label.endsWith("with")` | `AddSpec.kind === "case"` — a pending goal takes a `\| case =>` alternative |
| `briefLabel.ts` `HEAD_MARKS` | `/^constructor\b/`, `/^(intro\|intros\|rintro)\b/` | the `⟨⟩` / `λ` mark brief mode puts in place of the head word |
| `briefLabel.ts` `mB` | `/^(\s*)(rcases\|cases)\s+/` | brief mode elides the discriminant between the head and `with` |

And regexes that decide something else and were left alone: `isChain`
(`/^calc\b/`, which the `calcChains` sidecar already backs up),
`rflResidue`'s `/^rw \[rfl\]/`, `elide.ts`'s `tacticKeyword`
(`/^[A-Za-z_'.₀-₉]+/` — a lexical head-word scan, not a family test),
`briefLabel`'s `BINDER_KW`/`VERB_KW`/`pushNamespace`/`mF`/`mX`/`mH`/`mD`
(presentation: which part of a LABEL to hide, at character offsets the label
alone can give). **No regex ever named a case.** The tags were always the
elaborator's, through `username`; what was missing was everything beside the
tag.

**The walk.** `ProofTree.branches` (ProofTreeRecover.lean) folds `TacticInfo`
and dispatches on `stx.getKind` — a table of thirteen kinds, verified against
this toolchain by parsing each form and printing its kind rather than by
memory (`tacticErw___`, `Mathlib.Tactic.intervalCases`,
`Lean.Elab.Tactic.finCases` and `«tacticBy_cases_:_»` are none of them
guessable). Per step it emits
`{stepStart, form, on, withAlts, arms}` with `arms : Array {tag, binders,
pattern, goalId}` in SOURCE order, keyed on `position.start` like every other
sidecar, plain data on both wires, emitted only when non-empty.

Tags come from the elaborator in four different ways, one per form, and never
from the text:

* `induction`/`cases` take them from the `with | … =>` alternatives where the
  author wrote them and from the discriminant's inductive `ctors` in
  DECLARATION order where they did not. Preferring the alternatives is not
  laziness: it is also what makes `induction n using Nat.strong_induction_on
  with | h n ih` right, where the eliminator's tags are nothing the type's
  constructors know about. No `using` detection is needed anywhere.
* `constructor` takes the target STRUCTURE's fields (`And` → `left`/`right`,
  `Iff` → `mp`/`mpr`). A non-structure inductive does not split under
  `constructor` at all — it picks one constructor — and correctly gets no arms.
* `by_cases` is `pos`/`neg`, the two names its own macro expansion writes,
  both binding the hypothesis the author named.
* `refine` reads the synthetic holes; a named `?foo` names its arm, an
  anonymous `?_` adopts the goal's own (`refine_1`, `refine_2`).
* `rcases`/`obtain`/`rintro` have no tags of their own. Lean names those goals
  positionally from the pattern's alternatives, so they resolve positionally —
  which is the brief's own exception, "positional only where Lean itself is
  positional" — and then ADOPT the goal's tag, so `rcases … with he | ho`
  comes back tagged `inl`/`inr` without anything here knowing that word.

`resolveArms` is one function with three rules in order: by tag where every
arm has one and every one of them names a produced goal; positionally where
the counts match; and a single arm takes the FIRST produced goal even where
the step also spawned side work (one arm is one continuation).

**The trap, and it is a real one: a macro expansion wears the original's
source range.** `have h : P := by …`, `by_contra` and `exfalso` all expand to
`refine`, and the `TacticInfo` for the expansion carries `Parser.Tactic.refine`
as its kind AND the `have`'s own range. The first run gave 39 `refine`
branches over the corpus, 28 of them on `have`s, tagged with things like
`body._@.4130051218._hygCtx._hyg.129`. The guard is `.original` head info —
the same one `constIdentNodes` (B3) uses to decide what paints as a constant —
and it takes the count to 11, all of them tactics the author wrote. `by_cases`
survives it because `by_cases` is a macro whose OWN node is the author's; only
its expansion is synthetic.

Two more places the walk had to stop looking. A tactic's own parts must be
searched WITHOUT descending into a nested tactic block (`ptNodesHere` prunes
at `tacticSeq`/`byTactic`), or `induction n using … with | h n ih => rcases x
with a | b` reads the inner `rcases`'s `elimTarget` as part of its own
discriminant — measured, `on` came back as `"n, List.mem_append.mp hpm"`. And
an alternation NESTED inside a tuple (`obtain ⟨k, hk | hk⟩ := ih`) splits the
goal without splitting the top-level pattern; reading it as one arm listed
`hk` twice and claimed one arm for two goals, so it is undecoded instead.

**Where the walk cannot decode, it says so.** `arms := #[]` with the `form`
still set, and every client fallback keys on that array being empty rather
than on the sidecar being absent. Over the corpus that is three steps:
`match n with` (form and discriminant only — its alternatives are a term-level
`matchAlts`, not this walk's shape), `obtain ⟨k, hk | hk⟩ := ih` (the nested
alternation above), and `refine ⟨rfl, fun _ => hn, Or.inl hk, …⟩`, which has
no holes and therefore no arms — correctly.

**Client.** `Proof.branches` (carried by `stableProofOf`, so `incoming` needed
nothing), `TreeNode.branch` on the tactic, `TreeNode.arm` on each child goal.
Each of the four regexes above now reads the data first and keeps its text
test as the fallback where no branch reached the step: `mainFirst` is
`form === "rewrite"`, `addSpecFor` is `withAlts`, and briefLabel takes an
optional `form` argument, with a LEXICAL `headEnd` scan supplying the
character offsets the elision machinery needs (a label-family regex cannot be
replaced by a fact that carries no offsets, so the offsets are computed
lexically and the FAMILY question is the only one the sidecar answers).
`shapeSource` (`"branch" | "regex" | "none"`) is stamped on every tactic node
so the probe can assert the point directly: **0 nodes over the corpus are
still shaped by a regex**, 32 by the sidecar, 212 with nothing to decide.

`rw [a, b]` is harvested as one step PER RULE, each with its own position
inside the `rw`, so a `rewrite` branch would have reached only the first of
them if it were keyed on the syntax's start. It is emitted for EVERY step the
`rw`'s syntax range covers instead — 40 over the corpus, and confirmed on the
live server, where `rw [Nat.add_zero, Nat.zero_add]` at Tour line 55 ships
three `rewrite` branches at characters 8, 22 and 34.

**The badge is GROWN, never minted.** `caseLabel` still comes from the goal's
own tag with the parent's prefix stripped, and the arm only adds to it: the
pattern the author wrote where there is one, else the names bound.
`succ k ih`, `inl he`, `pos hn`, `mp` (nothing to add). A goal that shares its
parent's tag draws no badge and gains none, so not one node grew a line of
chrome it did not have; `caseSize` measures whatever string it is handed, so
the measurer/renderer pair needed no change and `probe overlap` had nothing
new to model. Child order follows the arms' source order only on FULL
coverage (every arm resolved, every child claimed, counts equal); measured,
**0 records move** — the arms' source order and Lean's own goal order agree
everywhere in this corpus — so the reordering is a correctness guarantee for
proofs that do not yet exist rather than a change to what is drawn.

**Surfaced minimally.** One `<title>` line on the tactic
(`induction on m: zero | succ k ih`), one on a goal whose arm has a pattern,
one `nodeHints` row. Nothing else is drawn and nothing reserves room.

**Measured.** `./gen.sh`: 23 of 31 records gain `branches`, 89 branches with
72 arms, **every arm resolving to a goal the client draws** and every arm's
tag equal to that goal's own; the NDJSON is byte-identical field-for-field
once `branches` is stripped. `probe counts` gains a PART B5 block pinning the
odd_sums specimens the brief named (`induction m with` → `zero` / `succ k ih`;
`obtain ⟨k, hk⟩ := hn` → binders `k hk` and the pattern verbatim; `by_cases hn
: Even n` → `pos`/`neg` both binding `hn`; `rcases Nat.even_or_odd m with he |
ho` → `inl`/`inr`; `constructor` on an `↔` → `mp`/`mpr` from `Iff`'s fields),
the corpus-wide resolution invariant, the per-form counts, the `shapeSource`
tally and the zero-order-change measurement. `overlap` 730/0, `order` 1912/0,
`hopgap` 284 — all unchanged. One expected-value edit: `counts` found the
succ goal by `caseLabel === "succ"` and now matches on the prefix, which is
the badge change showing up exactly where it should. Live server (`probe lsp
../lean/ProofTreeTour.lean 28 4` and `52 4`): `tour_reading`'s `rcases
Nat.le_total n m with h | h` ships one branch, arms `inl`/`inr` each binding
`h`, and `tour_reshaping` ships the `induction` with `zero` / `succ k ih` plus
the three `rewrite` branches — the widget wire carries it with nothing added
to `incoming`. Harness (`?stub-edit`, `select(19)`): 78 nodes, unchanged, and
the badges read `zero · succ k ih · mp · mpr · inl he · inr ho · pos hn ·
left · neg hn · right`.

**Left undone.** (1) `match` is form-and-discriminant only; decoding
`matchAlts` means walking term-level patterns, which is a different grammar
from `rcasesPat` and would want its own pass. (2) `split`,
`interval_cases` and `fin_cases` are in the kind table but no corpus fixture
exercises them, so they have never emitted an arm; the first two would want
the same `matchAlts`/range work, and `fin_cases` produces one goal per element
of a finite type, which is a count the syntax does not carry. (3) A nested
`rcases` alternation is undecoded rather than expanded — the cross-product of
a tuple's alternatives is the right answer and it is more machinery than the
one corpus specimen justifies. (4) `refine'` and Mathlib's own spelling of it
are in the table by name and untested, like B1's. (5) briefLabel still owns
its own character offsets: the sidecar answers WHICH tactic this is, and the
label answers WHERE its head ends.

## 2026-09-09 — C2/C3: templated narration and recursive summaries, as the fourth comment mode

The roadmap's Workstream C, items 2 and 3, on top of the B parser work that
landed this morning. Hattori et al. (INLG 2025) measure two things: a template
per tactic KIND lifts step accuracy from ~54% to ~89% over free generation, and
a summary folded along the PROOF TREE beats a flat one. Both are what this tree
already has the shape for, so neither needed new geometry.

**`web/src/narrate.ts`** — pure, in the probe barrel, no React and no infoview.
`narrateStep(node, ctx)` writes one line; the family it dispatches on comes from
B5's `branch.form` FIRST (the syntax kind the server decoded) and the head word
second. Never an argument index, and never a regex over the whole label where
the elaborator's own data answers — the three places a template reads text
rather than data are stated in the file: `rw`'s rule list (which is `rw`'s own
`[rules]` syntax, taken only when `lemmas` is empty because the rules are local
hypotheses), an anonymous `have`'s statement (only when `hypOrigins` gave no
introduced hypothesis), and the `at h` clause.

What each B item bought:

| B item | what narration reads it for |
|---|---|
| B2 `hypOrigins` | a step's NEW hypotheses are the child goal's `HypLine`s whose `origin` is this step — so `intro`, `have`, `let`, `by_contra` say the name and type Lean gave them, not the text the author typed |
| B3 `lemmaRefs` | "This is exactly `Nat.not_even_iff_odd` — …" with the docstring's first sentence; the principal lemma is chosen by `ConstantInfo` KIND (theorem/axiom first, constructors and recursors last), because every term mentions `Nat.succ` in passing |
| B4 `automationTraces` | "simp used `a`, `b`, `c`" where a trace is open; "This is routine (omega)" where it is not |
| B5 `branches` | the discriminant (`branch.on`), the arm tags and what they bind — "By induction on n: zero, succ (k, ih)", "Case on `Nat.even_or_odd m`: inl (he), inr (ho)". Where `arms` is EMPTY (the server recognised the form, not its arms — `obtain`, `match`) the patterns are read off the produced GOALS' own `arm`, which is where `obtain`'s `⟨p, hp, hpdvd⟩` lives |
| recovery (B1) | `term`/`subterm` steps get their own family, `failed` and `skipped` one line each |
| the calc ledger | the ledger IS the prose: "Chain: a = b ≤ c". The rows hang off the goal the `calc` step opened, not off the step, so the template walks one child to find them — by structure, not by index |

**Coverage, measured (`npm run probe -- narrate`): 244 tactic nodes in the
corpus, 244 templated, residue 0.** Families: rw 39, exact 38, auto 36, have 26,
term 26, intro 16, obtain 12, refine 11, induction 8, cases 6, constructor 5,
rfl 4, side 4, calc 3, by_cases 3, apply 2, by_contra/push_neg/subst/sorry/
exfalso 1 each. The probe pins `COVERAGE_MIN = 1` and `RESIDUE_MAX = 0`: the
residue path (`Then <tacticHead>`) is still there and still counted, and a new
fixture with an unhandled kind is meant to FAIL the probe rather than quietly
print prose nobody wrote a template for. It also asserts every line fits 96
chars (the strip's two clamped lines; the longest measured is 90), that every
summary is under its cap, that summaries are deterministic across two runs, and
that narration never lands on a node the author commented.

**C3, the recursion.** `summarize(nodes)` gives every node the fold of its own
line with its children's, by the tree's own structure: a step's SPAWNED
obligations become "(proved by: …)", a split's continuations become
"Case zero: …; Case succ: …", a linear run becomes "…; then …". Bounded at ONE
level (`SUMMARY_DEPTH`), deeper subtrees collapsing to "(3 more steps)", and
clipped at 260 chars — a summary is 1–3 lines, because the reader looking at a
folded goal wants the shape of what is under it, not its transcript.

**The fourth mode.** `Comments: show | hide | instead | narrate`. The existing
`instead` mode PRINTED the word "narrate" on the bar; C2 takes that word for the
generated prose, which is what a reader means by it, and gives `instead` back
the name it has always had in the code. The bar's `values` reservation derives
from `COMMENT_MODES`, so the row widened itself; ⌥-click cycles
show → hide → instead → narrate → show, and each stop toasts as every mode
change does.

In `narrate`: the author's comment still wins on any node that has one; every
other tactic gets its templated line, and a FOLDED goal gets the summary of what
its `+N` hides — the corner says how much, the strip says what. A HOP's strip is
composed from the parts the cut names (its kept goal's subtree is still on
screen, so the goal's own summary would over-report); a FOLD's is the goal's
subtree summary outright.

Decisions, and what they are instead of:

- **`∴ ` written INTO the text, not a style.** Strips are already italic comment
  ink for everyone, so italics cannot be the distinguisher; a glyph can. It is
  written into the string so `commentSize` measures exactly what is painted —
  the `SEED_MARK` idiom, and the reason nothing new had to learn about it.
  Rejected: a second ink (light-on-light is this project's recorded trap), a
  separate lane (the strips' geometry is the one thing this feature must not
  touch), and a `(generated)` suffix (it costs a line and says less than ∴).
- **Narration reaches the LAYOUT ENGINE ONLY.** `narratedNodes` is a memo beside
  `treeNodes` and is passed to `createLayoutEngine`; every other reader — the
  cut rules, the selection verbs, `commentEditFor` — keeps seeing the real tree.
  So a generated line is never something a gesture offers to edit, hide or
  delete, and `commentEditFor` returning null on a node with no `commentRanges`
  already made the double-click a no-op without a new gate.
- **Goals get no line of their own.** A goal box already prints its statement;
  narrating it would say the same thing twice. Only folded goals speak.
- **A closing step names the goal it discharges only inside a SUMMARY.**
  `narrateStep(n, ctx, withGoal)`: off for a strip, because the goal box sits
  directly above the tactic and "…, giving ∑ i ∈ Finset.range n, …" would print
  the statement twice on adjacent lines (seen in the harness, 2026-09-09); on
  inside a summary, where the goals have been folded away and the statement is
  the only thing left saying what was closed.
- **`summarize` is bounded by depth, not by a character budget alone.** A budget
  alone gives a different answer depending on how verbose the first child was,
  which is not deterministic reading — the depth bound plus a clip is.

Probe changes: `web/probe/narrate.mjs` is new (`--print` prints odd_sums as an
indented narrated outline plus the branch-root summaries). `probe overlap` now
sweeps BOTH strip modes — `applyNarration` gives a strip to every step the
author left unremarked, which is the widest the strips ever get, so the ghost,
hop-caption and tour-tab clearances are checked against it: 1460 layouts, 0
overlaps (was 730, 0). `counts`, `order` and `hopgap` are unchanged.

Not done here: C1 (LeanTeX statement rendering) and C4 (the opt-in LLM polish
through the companion) are still ahead of this in the roadmap's order. The
automation-trace template is written and UNEXERCISED offline — the corpus is
generated without `--traces`, so the `auto` family's 36 nodes all take the
"This is routine (…)" branch; the trace branch has no fixture behind it yet.


## 2026-09-09 — C1: the LaTeX seam, and why the printer is not behind it

*(Superseded 2026-09-24: C1 is PUNTED and the seam described below was REMOVED — see that entry. The spike's findings stand.)*

Workstream C item 1 asks for the goal box's *reading* form — `\sum_{i \in
[0,n)}` beside the tree's `∑ i ∈ Finset.range n` — from kmill's LeanTeX, both
prints elaborator-derived. The spike came back **no**, and the "no" is small
and precise, so it is recorded in full: the work to unblock it is a decision,
not a discovery.

**LeanTeX does not build on Lean v4.32.2.** `kmill/LeanTeX` @
`d66db4582b6cb4d9fa0b6309168103a248a5fd46` (2025-03-05, the tip of `main` —
the repository has had no push since) declares `leanprover/lean4:v4.18.0-rc1`
and requires `proofwidgets v0.0.53`. Built against v4.32.2 with the ProofWidgets
module (`LeanTeX/Widget.lean`) removed, since the widget is the one part we
would never use, it fails in exactly three places:

1. `LeanTeX/LatexCmd.lean:18` — `String.split` now returns `Std.Iter
   String.Slice`, not `List String`:
   `Application type mismatch: … has type Std.Iter String.Slice but is expected
   to have type List String in the application " ".intercalate (…)`.
2. `LeanTeX/Builtins.lean:19` — the same change, in `String.toLatex`:
   `Type mismatch: x :: namedPattern xs … has type List ?m but is expected to
   have type Std.Iter ?m`.
3. `LeanTeX/RuleSyntax.lean:104, 125, 141` — `aux_def` is now
   `scoped syntax … visibility "aux_def" …` with the visibility MANDATORY and
   the syntax scoped to `Lean.Elab.Command`, so all three
   `latex_pp_rules`/`latex_pp_const_rule`/`latex_pp_app_rules` expanders emit
   an unparseable command: `unexpected token 'aux_def'; expected 'abbrev', …,
   'private', 'public', …`.

Patched locally (`.toList.map (·.toString)` twice; `open Lean.Elab.Command in`
+ `private aux_def` three times) the library **builds clean and the printer
runs**. Better: the same three patches already exist upstream-adjacent, in the
fork `must-show-your-work/LeanTeX` @ `779ac83` ("Bump toolchain to Lean
v4.31.0-rc1", 2026-06-03) — arrived at independently and character-for-character
the same fix, which is good evidence the bump is the whole of the work. And
`kmill/LeanTeX-Mathlib` @ `02f8d141` (2025-04-17, 232 lines) **compiles against
Mathlib v4.32.2 with deprecation warnings only** (`lo` →
`MonomialOrder.linearOrderSyn`, ×13). So the dependency is one bump away, not a
port.

**What it emits** (measured, `LeanTeX.run_latexPP : Expr → Config → MetaM
String`, with LeanTeX-Mathlib's rules loaded):

| statement | LaTeX |
|---|---|
| `∀ n : ℕ, ∑ i ∈ Finset.range n, (2*i+1) = n^2` | `\forall n : \mathbb{N},\ \sum_{i \in [0, n)}(2 \cdot i + 1) = n^{2}` |
| `∀ m : ℕ, Even m ↔ Even (m^2)` | `\forall m : \mathbb{N},\ \text{Even}(m) ⇔ \text{Even}(m^{2})` |
| `∀ a b : ℕ, a ∣ b` | `\forall a : \mathbb{N},\ \forall b : \mathbb{N},\ \text{Dvd.dvd}(a, b)` |
| `∀ (f : ℝ → ℝ) (x : ℝ), f x = x/2 ∧ √x ≤ \|x\|` | `\forall f : \mathbb{R} \to \mathbb{R},\ \forall x : \mathbb{R},\ f(x) = \frac{x}{2} \mathrel{\mathrm{and}} \sqrt{x} \leq \text{abs}(x)` |
| `∀ (s : Finset ℕ) (p : ℕ → Prop), (∀ x ∈ s, p x) → s.card ≥ 0` | `\forall s : \text{Finset}_{\mathbb{N}},\ \forall p : \mathbb{N} \to \mathbf{Prop},\ (\forall x : \mathbb{N},\ x \in s \implies p(x)) \implies \text{Finset.card}(s) \geq 0` |

Read that table before deciding the bump is worth taking. The good half is very
good — `\sum_{i \in [0,n)}`, `\frac`, `\sqrt`, `\mathbb{N}`, `\implies` — and it
is exactly the roadmap's claim. The other half is a *worse* read than Lean's own
print: `a ∣ b` becomes `\text{Dvd.dvd}(a, b)`, `∧` becomes
`\mathrel{\mathrm{and}}`, `|x|` becomes `\text{abs}(x)`, `s.card` becomes
`\text{Finset.card}(s)` — and `↔` is emitted as a RAW `⇔`, which is not LaTeX at
all and which KaTeX would refuse. A reading form that prints `Dvd.dvd(a, b)`
where the source says `a ∣ b` does not make a proof easier to understand; it
makes it harder, and it does so silently, on exactly the statements a newcomer
needs most. The residue is per-constant printer rules, i.e. open-ended work in
LeanTeX-Mathlib, not in this repository.

**So C1 ships the seam and stops there** — the roadmap's own "optional
dependency" phrasing, taken literally. Three things landed:

- **`ProofTree.LatexGoal`** (`lean/ProofTreeComments.lean`, `import Lean` only):
  `{ goalId, tex }`. Keyed on the GOAL ID the tree already draws, not on
  `position.start` — every other sidecar keys on the producing step because it
  describes a step; this one describes a *print*, and the print is the goal's.
  Plain data, so it rides both wires by the standing rule.
- **The field on both wires, always empty.** `Proof.latex` in `Ramify.lean`;
  `resultToJson` gains a trailing `(latex := #[])` parameter and writes the key
  NON-EMPTY ONLY, so the corpus is byte-identical (verified: `gen.sh` leaves
  `sample.ndjson` unchanged). Client: `Proof.latex?: LatexGoal[]` in
  `paperproof.ts` and, critically, a line in `stableProofOf` — the field-by-
  field rebuild is the thing a new wire field is silently absent from, and it is
  the only client edit the widget path needed.
- **One disabled row in the reading panel**, `goals as TeX`, titled "Needs
  LeanTeX, which is not built for this toolchain (Lean v4.32.2)". It carries no
  state at all: nothing for `remapIds`, the view stash or `viewKey` to know
  about, and the layout with the option off is the layout that was there before
  (probes below, all byte-identical numbers).

Drawn-and-disabled rather than absent, deliberately. The alternative — ship
nothing visible — leaves a reader who has met the idea with no way to find out
where it went; a disabled row with the reason in its title is the same courtesy
the `to cursor` row already pays when there is no editor cursor.

**Not done, and the reason is a decision rather than a difficulty.** Wiring the
printer in needs one of: (a) depending on `must-show-your-work/LeanTeX`, a
personal fork whose lakefile floats `proofwidgets @ main` — a supply-chain
choice for the INSTALLABLE package, not just the dev one; (b) vendoring a
patched LeanTeX (1263 lines) + LeanTeX-Mathlib (232) under `lean/`, Apache-2.0,
with the NOTICE entry that implies; or (c) waiting for upstream, which has been
dormant for 18 months. None of those is a coding question, and (see the table)
the payoff is currently half a reading form. `dist/` therefore takes no new
dependency and `INSTALL.md` is unchanged.

**KaTeX was never bundled**, so the bundle number is the one client row's worth:
`web/dist/proofTreeWidget.js` 372,567 → 372,713 bytes (+146). The ~270 KB
question the brief flagged is still open and still unasked — it is (a)/(b)'s
second half, and the measurement to take then is whether KaTeX's `output:
"html"` mode reads acceptably without its fonts, since the infoview webview
fetches nothing.

**The statement-level fallback was already there.** The brief's plan B second
half — show the theorem STATEMENT on the goal box, from `declHeader` — is not
needed: `declHeader` has drawn as an expandable header band at the top of the
view since it landed, with its own semantic tokens (`declHeaderTokens`), which
is strictly more than a `<title>` would give. Checked, and stopped.

## 2026-09-09 — D1: inline a single-use `have`, extract one from a nested `by`

The first two entries of Workstream D's catalogue, and the first time this
tool proposes a change to a proof rather than a change to how a proof is
DRAWN. The discipline is Blanchette et al.'s preplay, borrowed whole: a
restructuring is a set of text edits, and it is not offered to the reader
until the elaborator has been asked whether the rewritten declaration still
checks. Nothing is written on a guess.

**The specimen.** `proofs/euclid.lean` is `infinitude_of_primes` as first
written (the file has not changed since commit `b846a29`); the same theorem in
`lean/ProofTreeScratch.lean` is what a Lean user cut it down to, 30 lines to
12, by the five moves the roadmap tabulates. The second of those was inlining
`have hM : 2 ≤ Nat.factorial N + 1 := by …` into the `obtain` below it.
`probe rewrite` asserts that move is offered, byte for byte.

### The datum: `haveUses`, which is B2 ∘ `tacticDependsOn`

No new harvest. `hypOrigins` (B2) already says which step first bound each
`fvarId`; Paperproof's own `tacticDependsOn` already says which ids a step
read. `ProofTree.haveUses` (ProofTreeRecover.lean) is one pass over the two:
for every origin whose introducing step's head word is `have` or `obtain`, the
`position.start` of every step whose `tacticDependsOn` holds that id, in
source order. Plain data, emitted non-empty only, on both wires.

Two restrictions, both deliberate.

* **`have`/`obtain` only.** Every origin has a use list, and 390 of them in
  the corpus would triple the sidecar for data nothing reads. What
  `intro`/`by_cases`/`rintro`/`rcases` bind is the shape of the proof rather
  than a fact stated in passing, and no move offers to inline it.
* **An empty `users` is EMITTED.** A `have` nothing uses is exactly the
  finding a reader wants — it is what Mathlib's `unusedHaveSuffices` linter
  asks — and silence there is indistinguishable from "not computed". Two of
  the corpus's 44 entries are empty (`commented.lean#5`'s `h`,
  `sample.lean#0`'s `hsum`).

**It is NOT an occurrence count, and that gap is the whole design of the
inline rule.** `omega` closes a goal from the context: it depends on `hle1`
and names it nowhere. So `hle1` has one USER and zero written occurrences, and
`rewrite.ts` requires BOTH before it offers anything. That single test is what
keeps `omega`, `assumption`, `decide` and `simp_all` out without anyone having
to write a tactic taxonomy — the deny-list that exists beside it
(`CONTEXT_ONLY`) buys nothing but a decline that SAYS why, instead of
reporting "not named" for a tactic that structurally cannot name anything.

Corpus: **44 entries over 13 of the 31 records**, 29 of them used exactly
once, 2 unused. Everything else in `sample.ndjson` is byte-identical (checked
field by field against the pre-D1 run).

### The moves (`web/src/rewrite.ts`)

Pure text over the tactic's own verbatim source, which is what lets
`probe rewrite` run exactly what the widget runs. The lookup is one function,
`SourceLookup`: in the widget it is `tacticEdits` (`getTacticEdit`, now also
handing back `tacticIndent`); offline it is the tactic's `deleteSlots` extent
sliced out of the `.lean` file, which is the same bytes.

**`⤵` inline.** Delete the `have` — through `deleteEdit`, so it is the delete
gesture's own extent and takes the `have`'s comment line with it, which is why
the `hM` assertion pins line 33 and not 34 — and put the justification,
parenthesised, where the one user named the hypothesis. Refused where:

| decline | corpus count |
|---|---|
| the hypothesis is used more than once, or not at all | 4 |
| the introducer is an `obtain` (a destructuring has no ONE justification) | 8 |
| the one user is context-reading (`omega` &c) — it names nothing | 4 |
| the occurrence is an `at` target, not a term (`rw [Int.isUnit_iff] at h2`) | live only |
| the justification is longer than `MAX_INLINE_LINES` = 3 | 6 |
| the tactic's source is not verbatim at the range it claims | harness only |

`MAX_INLINE_LINES` is 3 because that is what admits `euclid`'s two-line `hM`
and declines its 13-line `exists_prime_dvd`: an inlined block longer than that
reads worse than the `have` it replaced, which is the whole point of the move.
Continuation lines are re-indented to the USING tactic's column + 2, keeping
their relative shape (`reindent` strips the shallowest indent and re-adds).

**`⤴` extract.** The inverse: hoist a nested `by` block out of a term into
`have this : <type> := by …` on the line above at the host's own indent, and
leave `this` behind. Three things decide its shape.

* **The name is `this`.** Lean's own anonymous idiom, and the author's to
  rename. `h1` would be putting a word in their mouth (CLAUDE.md's standing
  rule), and prompting would make a one-click gesture a dialogue. Declined
  where `this` is already bound in that context.
* **The TYPE is the elaborator's.** The `have` must state the block's goal,
  and only the elaborator knows it: the spawned goal the host step opened
  whose own first tactic falls inside the block's range. Where that goal was
  not harvested, or does not print on one line, the move is not offered — no
  `have this : _`, which Lean often cannot infer and a reader cannot read.
* **PARENTHESISED BLOCKS ONLY**, and that is a rule rather than a gap. Without
  brackets a `by` block ends where indentation and the host's own trailing
  clauses say it ends — `rcases f <| by grind [Nat.factorial_pos]` on one line
  and `with ⟨p, hp, hpdvd⟩` on the next, which is exactly the shape the human
  wrote in the scratch file — and text alone cannot decide that. A reader who
  wants the move there can put the parentheses in, and then it is offered.

### Verify, then offer (`ProofTree.checkRewrite`)

A new lazy RPC beside `getAutomationTrace`, on the same seam. It applies the
candidate edits to a COPY of the file's text (descending order, so earlier
offsets stay valid) and re-elaborates the one declaration through
`reElabDecl`. Nothing is written to the document by this call, so a rejected
proposal costs one elaboration and changes nothing.

**The classifier — benign / semantic / structural — is decided HERE**, and had
to be: only inside `reElabDecl` are the parse messages distinguishable from
the elaboration ones. (The roadmap's verification section speaks of "the
delete-verification classifier" as if it existed; it did not. The delete
gesture arms and writes, and never asks. This is the first implementation of
that three-way split, and the delete gesture is the obvious next caller.)
`ReElab` gained one field, `nParse`, the length of the parse-message prefix:

* `structural` — no declaration came back, or the first error is in that
  prefix. The text does not parse; a parse error inside a rewrite WE generated
  is our bug and not the reader's proof, so nothing more is said about it.
* `semantic` — it parses and does not check. The first error's first line
  comes back, because that is the sentence a reader can act on.
* `benign` — no error at all, `sorry` warnings ignored as `computeCf` ignores
  them.

**Both step counts are RAW.** The first version returned
`real.steps.length` as `before` and the rewritten `BetterParser_Tree` count as
`after`, and `tour_editing`'s one-line inline reported **6→3**: `real.steps`
has the recovery parser's own steps folded in (subterms, term proofs, failed
tactics) and the rewritten text gets no recovery pass, so the "saving" was a
difference of pipelines. `before` is now `BetterParser_Tree` over the ORIGINAL
snapshot — no elaboration, the tree is already there — and the same inline
reports 4→3. NOT cached: a trace is asked once per declaration and reused, but
proposals differ by their edits, which is the whole key, and keying on edit
text would save one repeat click.

### The view

One `useMemo` over the drawn tree computes both proposals for every tactic
node (`rewrites`), so the bar can offer them with no round trip;
`getTacticEdit` is now memoised in widget.tsx for exactly that dependency —
a fresh closure per render recomputed every proposal on every render. Two bar
buttons: `⤵` down into the use, `⤴` up out of the term — the arrows point the
way the text moves, and they are one glyph mirrored because the two moves are
inverse. Neither writes: the click opens a PROPOSAL.

The pill is the ARMED DELETE'S PILL, in the same place and the same idiom,
because a rewrite is the same kind of promise: it says what will happen, it
says whether the elaborator agreed, and nothing is written until the reader
clicks it. `checking…` while the RPC is out, then
`inline `hpfac` into `have` → 1 step fewer · ✓ elaborates` (live, `SEQ_STROKE`,
solid) or `✗ Unknown identifier `hbb`` (inert, comment ink). One `layers` row
between `arming` and `pendingVerb`, so Esc backs out of it. Two `nodeHints`
rows under `tactic`, gated `needs: "restructure"`. It reserves nothing and
measures nothing, so `overlap` / `order` / `hopgap` have nothing new to model.

Offline (`?stub-edit`) `onCheckRewrite` is deliberately NOT wired: with no
checker the proposal goes straight to ✓, so both gestures and the pill can be
seen and measured while the verdict stays the server's alone. The harness's
`getTacticEdit` stub now answers with the TIGHT range (`deleteSlots`) instead
of the step's trivia-inclusive `position` — with the old stop, `verbatim`
declined every rewrite in the harness — but its text is still Paperproof's
`tacticString`, a pretty-print, so every MULTI-LINE tactic is declined there
and the offline probe (which reads the real file) is the one that sees `hM`.

### Measured

`probe rewrite` over the corpus: **8 inlines and 2 extracts offered**, 24
declines with reasons among the nodes that have use counts. The two extracts
are `commented.lean#1`'s `exact ⟨k, Or.inr (by omega)⟩` and its `Or.inl`
sibling; the inlines are `euclid`'s `hM`, `hpfac` and `hp1`, `flags#0`'s `h`,
`multiline#4`'s and `odd_sums`'s `gap`, and `sample`'s `hP` and `h2`. Applied
to `proofs/euclid.lean` and run through `lake env lean`, the `hM` inline
kernel-checks (`depends on axioms: [propext, Classical.choice, Quot.sound]`).

`probe counts`, `overlap` (1460 layouts, 0), `order` (1912, 0 moves),
`hopgap` (284), `narrate` — all unchanged. `typecheck`, `lint` clean.

**Live server** (`probe lsp … --rewrite`, which builds the tree from the
payload the server just returned, computes both proposals from the payload's
OWN `tacticEdits`, and calls `checkRewrite` on each):

* `lean/ProofTreeTour.lean` at 74:4 (`tour_editing`) — three inlines
  (`hbb`, `hab`, `hpos`), all `benign`, 4→3, **12–19 ms** each.
* `lean/ProofTreeScratch.lean` at 185:2 (`root_2_irrat_over_int`) — one
  inline (`hnn` into `rcases`) `benign` 17→16 and one EXTRACT
  (`(by linear_combination -hmn)`) `benign` 17→18, ~130 ms each; beside them
  the declines the design asks for, live: `hm` used 3 times, `have hn`'s
  6-line justification, `h2` an `at` target (`rw [Int.isUnit_iff] at h2`), and
  — the innermost rule reporting honestly — the outer `have hn`'s own text,
  whose only nested `(by …)` belongs to a step INSIDE it, declined with "the
  block's goal was not harvested".
* The reject side, on the same rig: the `have` deleted with NOTHING put where
  it was used — which is what inlining into a context-reading tactic would
  amount to, and the reason `rewrite.ts` refuses to offer it — comes back
  `semantic: Unknown identifier `hbb``.

**Harness** (`?stub-edit`, record 4 = `proofs/euclid.lean`): hovering
`have hpfac` shows `⤵` on the bar with the title "Inline `hpfac` into the one
step that uses it — the elaborator is asked first"; the click draws the pill
`inline `hpfac` into `have` → 1 step fewer · ✓ elaborates`, and clicking it
writes exactly two edits into `window.__rewrites` — `42:0–44:0 → ""` (the
comment line and the `have`) and `45:41–45:46 → "(Nat.dvd_factorial hp.pos
hle)"` (1-based lines). Record 1 (`commented.lean`) shows `⤴` and writes
`24:0 → "      have this : m + 1 = 2 * k + 1 := by omega\n"` plus
`24:23–24:33 → "this"`.

### Left undone, deliberately

1. **No inline into a `calc` row.** A ledger step hangs off the ledger tactic
   rather than a goal and has no slot extent of its own; the same exception
   the delete gesture and B4's traces already carry.
2. **The offline probe under-reports by one.** `commented.lean#3`'s
   `have hb : b + 0 = b := Nat.add_zero b`, used once by `rw [hb] at h`, is
   declined with "no source for the step that uses it": the using step's
   `position.start` matches no `deleteSlots` entry, so the probe's slice-based
   lookup finds nothing where the widget's `tacticEdits` would. A probe-rig
   limitation, not a rule.
3. **The inline takes the `have`'s comment with it.** That is `deleteExtent`'s
   standing rule (a comment attached to a tactic belongs to it), and it is
   right for a delete; for an inline it can cost a sentence that was really
   about the step below. Left as it is rather than given a second extent rule,
   and the editor's undo takes it back.
4. **`before`/`steps` are raw parser counts, not drawn nodes.** They answer
   "how much shorter is the proof", which is what the pill claims; the drawn
   count depends on the reader's cuts and would make the pill's number depend
   on the view.

## 2026-09-09 — D2: collapse a run to automation, and expand automation to its lemmas

Workstream D's third catalogue entry and its inverse, on the seam D1 built.
The discipline is unchanged — the client computes TEXT EDITS, the elaborator
is asked whether they hold, and only then is the reader offered the write —
but the question is new: D1 asked the tree *where* a `have` was used; D2 asks
the elaborator *whether a shorter proof exists*, and that is a search rather
than a lookup, so the cost bound is part of the design.

### First, the C2 bug the brief named

`probe narrate --print` printed `This is routine (simp)` for every automation
step, with the corpus's own lemma lists sitting in `Proof.automationTraces`.
The template was right and read the right field (`n.trace`); the field was
never on the node it was handed. B4 stamps traces in `applyTraces`, which runs
on the DRAWN tree (after the cuts, deliberately — an open trace must not
change what a `−` does), and `narrationFor(base, drawn)` narrates a tactic
from `ctx.byId.get(d.id) ?? d`, i.e. from the BASE node, which never carries
one. So the bug was live in the widget too: a reader who opened `⁇` and then
switched to `Comments: narrate` still read "routine".

`narrationFor` now carries the drawn tree's stamps back onto the base nodes
before the context and the summaries are built (one map, skipped entirely
when nothing is traced), so the trace reaches BOTH the strip and every
summary that folds that step in. `probe narrate` asserts it: the corpus's
traced tree narrates **9** steps as `simp used …` (10 traces carry a lemma
list; the tenth is `multiline.lean:28`'s `grind`, which narrates under the
`grind` head), and `--print` now runs on a traced tree so the fix is visible
from the same command that showed the bug.

### The datum: a LINEAR RUN, and what "closes" means

`linearRuns(nodes, source?)` (web/src/rewrite.ts) — pure, on the BASE tree,
because a run is a fact about the author's text and a reader's cut must not
change what is offered. A run is a MAXIMAL chain of consecutive steps, each
producing exactly one ordinary goal (not `side`, not `spawned`) whose only
step is the next, of length ≥ 2. Maximal: a run's head is nobody's successor,
so the same steps are never offered twice under two heads.

Two rules were forced by the live server and are worth the record:

* **A step with no extent ENDS a run.** `rw [Nat.add_zero, Nat.zero_add]` is
  harvested by Paperproof as THREE steps — one per rule plus a closing `rfl`
  — at inner positions (`55:8`, `55:22`, `55:34`) that no `deleteSlots` entry
  covers, while the slot is the whole `55:4–55:35`. A splice is over the
  author's text, and a step with no text of its own has none to give, so
  `hasSlot(slots)` is the `source` predicate every caller passes. Measured on
  `lean/ProofTreeTour.lean`: `tour_reshaping` has 6 steps and 4 slots, and
  after this rule it offers NO run at all — which is right, and is why the
  Tour is not D2's specimen.
* **CLOSING is `openBelow`, not "no children".** The first version asked
  whether the last step had children; the `rfl` residue is a child, so a `rw`
  that finished a goal read as open. `closes` is now "no goal anywhere below
  the last step is drawn without a tactic under it". Only a closing run is
  offered — a run that ends at a branch cannot be replaced by a closing
  tactic, because the tactics below it would then have no goal. That change
  alone moved the corpus from 68 runs / 44 collapsible to **57 / 56**.

**The second entry point is the reader's own fold.** A maximal run is often
longer than the move a human would make: in `proofs/euclid.lean` the maximal
run starts at the `by_contra` on line 40 and takes nine lines, while the
roadmap's "automation collapse" row is the four steps `have hp1; have hle1;
have h2; omega` on 45–49. `runForFold(goal, base)` offers the collapse on any
FOLDED goal whose `+N` hides a linear CHAIN (contiguous, nothing else hanging
off it, nothing open below) — not necessarily a maximal run. Folding is how a
reader says "I do not want to read this", which is exactly where the offer
belongs, and it is how the human's own extent is reached: `probe rewrite`
pins that the fold above `have hp1` offers 45–49 and the harness writes
`44:2–48:7 → "omega"` (0-based) for it, byte for byte the lines the human
replaced.

### `ProofTree.tryClose` — the search, bounded

A new lazy RPC beside `getAutomationTrace` and `checkRewrite`, on the same
`reElabDecl` seam. Params are `{pos, from, to, tactics?}` where `from`/`to`
are the first and last step's `position.start`: **the wire carries two
positions, not a range**, and the server looks the extent up in its OWN
`deleteSlots`, so a client cannot ask for the splice of a range it did not
compute from the tree. Each candidate is spliced over that extent and the one
declaration re-elaborated; the first with no error message wins, and the
result carries every candidate tried with what each cost.

Candidates, one exported constant on each side (`AUTOMATION_CANDIDATES` in
rewrite.ts, `closingCandidates` in Ramify.lean, mirrored the way B4's head
lists already are): `omega simp linarith norm_num grind decide ring simp_all
aesop`. `omega` first because it is the cheapest and the most common answer,
`aesop` last because it is the most expensive (measured below: 3–4× the
others). Cost is bounded by construction — at most nine re-elaborations, one
run, only on a click — and cached on `(uri, version, from, to)`, the run
being the only thing the answer depends on.

The splice is ONE edit: the first step's tight start to the last step's tight
stop, the candidate as its whole text. Everything between goes, comments
included — they belonged to the steps that are being replaced. And the first
step's column is inherited from the extent's start, so there is no indent
arithmetic to get wrong (`probe rewrite` asserts the column on all 56).

### D2b — the inverse, and the verbatim rule

`⇑` writes what B4 already read back. The replacement is **core's own
suggestion text, verbatim**: the first line of `AutomationTrace.suggestion`,
never a list rebuilt from `lemmas` — the parse is for reading and the
suggestion is for writing, which is the Mathlib `says` idiom and the standing
rule about not completing the author's text with something they did not
choose (here the words are Lean's). `grind?` answers with a LIST of scripts;
the first is written and the rest stay in the `⁇` subtree where the reader
can see them, so `grind` offers `grind only [!Nat.factorial_pos]` — the `!`
included, because that is what core said.

Offered only where the suggestion's head word matches the tactic's, so an
`opaque` trace (`omega`, `ring`, `linarith`, …) offers nothing and says why.
Where no trace is in hand the click asks `getAutomationTrace` first and
proposes on its answer, so one click still means "write what it used"; the
freshly-arrived index is reached through a ref written in an effect (the
`toastRef` pattern — no ref read during render).

### The view

Two more hover-bar buttons beside D1's pair, and the same proposal pill. `⇓`
takes a run down to one tactic, `⇑` brings what a tactic used back up into
the source: the double arrows say the same thing the single ones already say,
one direction each, and the two D2 moves are inverse exactly as D1's are.
`⇓` is offered on a run's first step AND on a folded goal, but as ONE
`nodeHints` row under `tactic`: `nodeHints` gates on `when` alone and never on
the target, so a second row under `goal` said itself twice on every tactic —
the trap that rule was written for. The row's `says` names both places.

One thing the pill had to learn: a COLLAPSE has no title until the server
names the candidate, so the proposal opens with `collapse 4 steps to one
tactic — asking the elaborator…` and the answer replaces it with the move
(`these 4 steps are `omega` → 3 steps fewer · ✓ elaborates`). And an EXPAND
carries NO step-count clause at all — the move is not about length, and
`write what `simp` used → 1 step more` was both true and beside the point.

`collapseRewrite` reads the SLOTS and nothing else — no tactic text — so it
takes its own minimal context (`collapseCtx`) and is offered in a harness
with no `getTacticEdit`. Nothing D2 adds reserves space or measures anything:
`overlap` (1460, 0), `order` (1912, 0) and `hopgap` (284) are unchanged.

### Measured

**Corpus, offline (`probe rewrite`).** 57 linear runs, **56 collapsible**
(one open run declined), over 31 records; run lengths 2–7. **10 traced steps
with something to write** (9 `simp`, 1 `grind`), out of 36 traces — the other
26 are `opaque` and offer nothing. Every collapse is one splice whose text is
the candidate alone and whose column is the run's own. The D1 numbers are
unchanged (8 inlines, 2 extracts).

**Live server (`probe lsp … --collapse` / `--expand`).**

* `lean/ProofTreeScratch.lean` at 46:2 (`sum_range_odd`) — 6 runs, all
  closing. One is ACCEPTED: the 2-step run at 67:4 (`intro m` …
  `exact Finset.sum_range_succ …`) is closed by **`grind`**, after `omega`
  85ms, `simp` 88ms, `linarith` 85ms and `norm_num` 95ms all failed —
  `grind` 133ms, 486ms of elaboration and 980ms wall for the accepted call,
  splice `67:4–68:54`. The other five run the full nine and report
  `nothing closes it (tried 9)` in 1.28–1.38s (`aesop` alone is 272–363ms of
  that; every other candidate is 70–165ms).
* `lean/ProofTreeScratch.lean` at 11:2 (`infinitude_of_primes`, the human's
  own 12-line version) — one 2-step run, `nothing closes it (tried 9)`,
  **321ms** for all nine (24–81ms each; the declaration is short).
* `--expand` on `sum_range_odd`: traces in 112ms, 6 automation steps, one
  offer — the `simp` at 53:6 → `simp only [Finset.range_zero,
  Finset.sum_empty, ne_eq, OfNat.ofNat_ne_zero, not_false_eq_true,
  zero_pow]`, `checkRewrite` **benign** in 628ms. The other five are `omega`
  ×2 and `ring` ×3, declined with "keeps no lemma list".

**Harness (`?stub-edit&trace-stub`).** Record 4 (`proofs/euclid.lean`):
hovering `by_contra hle` shows `⇓` titled "Collapse 7 steps to one automation
tactic — omega, simp, …"; the click draws
`these 7 steps are `omega` → 6 steps fewer · ✓ elaborates` and accepting
writes ONE edit, `39:2–48:7 → "omega"` (0-based; lines 40–49). In `wide`,
folding the goal above `have hp1` (`4 steps folded`) offers
`Collapse 4 steps…` on the GOAL and writes `44:2–48:7 → "omega"` — the
human's own extent. Record 19 (`proofs/odd_sums.lean`): `⇑` on the `simp`
reads "Write what `simp` used into the source, in core's own words", the pill
reads `write what `simp` used · ✓ elaborates`, and the write is
`23:6–23:10 → "simp only [Finset.range_zero, Finset.sum_empty, ne_eq,
OfNat.ofNat_ne_zero, not_false_eq_true, zero_pow]"`.

### Not offered, and why

1. **A run that does not close.** Replacing it would leave the tactics below
   it with no goal. 1 of the corpus's 57.
2. **A SUB-RUN of a maximal run, except through a fold.** Offering every
   suffix would multiply the search by the run's length for a question the
   reader can ask precisely by folding. The fold is the extent picker.
3. **A run through `rw`'s harvested sub-steps**, or any step with no slot of
   its own — there is no text to splice. This is what silences
   `tour_reshaping`.
4. **A calc row.** The standing exception: a ledger step hangs off the ledger
   tactic and has no extent of its own (the delete gesture and B4's traces
   already carry it).
5. **An `opaque` trace's expand.** `omega` has no `?` form and no lemma list;
   the decline says so rather than offering an empty write.
6. **`tryClose` does not try `exact?`.** It suggests a term rather than
   closing the goal itself, so its answer is not a splice of the same shape;
   the roadmap's `exact?` line belongs to D1's library-replacement move,
   which is not built.
7. **No cross-candidate ranking.** The first that elaborates wins, in the
   fixed order. Preferring the "best" of several would need a criterion this
   tool does not have, and the order already encodes cost.

## 2026-09-09 — D3: the contradiction shapes, and D5: Mathlib's own names

Workstream D's remaining two catalogue entries, on the seam D1 built and
verified through the same `ProofTree.checkRewrite`. They came out very
differently: D5 is a gesture, D3 is an analysis, and the reason is the corpus.

### The datum both needed: the use machinery grows the intro family

`haveUses` (D1) was `have`/`obtain` only, on the argument that what
`intro`/`by_cases`/`rintro` bind is the shape of the proof rather than a fact
stated in passing, and that nothing offers to inline it. That argument still
holds for INLINING and is unchanged. But D3 has to know whether a `by_contra`
binder is read anywhere but the closing step, and D5 has to know which steps
read a hypothesis whatever tactic named it, so the head-word test is now a
named constant, `ProofTree.ALLOWED_INTRODUCERS`:

```
#["have", "obtain", "intro", "intros", "by_contra"]
```

`by_contra!` arrives as `by_contra` because a head word is alphabetic. The
pattern binders (`rintro`, `rcases`, `by_cases`) stay out, and that is a rule
rather than an omission: what they bind is not one token a reader can point
at, and the corpus proves it — `factorization`'s
`rcases List.mem_append.mp hpm with h | h` names `h` TWICE in one pattern, so
even with the form admitted the rename declines it ("`h` is written 2 times in
its binder").

`./gen.sh`: **5 of 34 records change and `haveUses` is the only field that
moves**, 44 entries → 56 (euclid 17→20, factorization 2→5, multiline#4 1→2,
odd_sums 11→15, sample 3→4); checked field by field against the pre-change
run.

Client side, one new field beside `uses`. A step can bind several names —
`intro h h2` and `obtain ⟨k, hk⟩` ship one `haveUses` entry PER NAME at ONE
position — and `usesAt` is a position map, so `uses` was silently the LAST of
them. D1 never noticed because `inlineRewrite` declines anything but a `have`,
which binds one. `TreeNode.usesEach` is all of them in source order;
`uses` is unchanged and is still what the inline reads. And `HypLine` gained
`hypName`/`hypType` — the elaborator's own pair, carried structurally rather
than parsed back out of the printed `h : T := v`, and copied onto every
wrapped piece exactly as B2's provenance fields are, because the rename must
read the WHOLE type from a line the reflow may have cut in half.

### D5 — the table is MEASURED, not quoted

Mathlib's naming conventions page governs THEOREM names; it says nothing about
hypotheses. So the table was measured over Mathlib itself at the pinned
toolchain (`lean/.lake/packages/mathlib`), counting binder names against binder
types over `Mathlib/`:

| type | the names Mathlib uses | the predicate form |
|---|---|---|
| `0 < x` | `ha` 245 · `hr` 204 · `hn` 172 · `hb` 160 · `hx` 154 | `hpos` 23 |
| `a ≤ b` | `hab` 255 · `hmn` 106 · `hbc` 59 · `hij` 54 | `hle` 66 |
| `a < b` | `hab` 124 · `hxy` 102 · `hmn` 35 | `hlt` 16 |
| `x ≠ 0` | `hn` 569 · `ha` 468 · `hx` 394 | `hne` 1 |
| `a ∣ b` | `hab` 18 · `hba` 15 · `hpq` 13 · `hmn` 10 | `hdvd` 11 |
| `Even n` | `hn` 39 · `ha` 13 | `heven` 3 |
| `p.Prime` | `hp` 147 · `hq` 3 | `hpri` 2 |
| `x ∈ s` | `hx` 596 · `ha` 241 · `hy` 170 · `hs` 43 | `hmem` — |
| `¬ P x` | `ha` 71 · `hb` 52 · `hs` 33 · `hx` 24 | — |

(`h` itself outranks every name for the binary relations, and is exactly what
the move renames FROM, so it is not a candidate.)

One rule falls out, not nine: **the name is `h` followed by the SUBJECT LETTERS
of the type.** Two rows settled questions the brief had guessed the other way.

* **`x ∈ s` names the ELEMENT, not the set** — 596 to 43. The brief offered
  `hx`/`hmem`; the collection never gets the letter.
* **Polarity does not reach the name.** The brief asked for `¬ P` → `hn…`;
  Mathlib writes `ha`/`hx`, i.e. the positive's own name. So `¬` is STRIPPED
  (through parentheses too) before the table is read, and `¬ Even n` and
  `Even n` are both `hn`. Where both are in scope the shadow test declines the
  second, which is the only place the collision can bite.

Each rule still records its predicate form (`hpos`, `hle`, `hdvd`, …) because
it is a real minority idiom, and the pill offers the PRIMARY alone: a gesture
that asked which of two names you wanted would be a dialogue, not a click.

A subject is a plain variable — one letter, optionally numbered or primed.
`Nat.factorial N + 1 ≤ p` has no subject letter, so no rule fires and nothing
is offered; that is the whole of the "compound type" handling.

**What is never renamed.** A name the author CHOSE (only `h`, `h1`, `H`, `hyp`,
`this`, `x_1` are candidates — the standing rule about not replacing the
author's words); a name that would SHADOW one bound anywhere under the
introducing step (the scope the edits reach, walked on the tree); a hypothesis
the elaborator counted no uses for — a statement binder, a pattern binder, or
one re-minted by `rw … at h`, whose B2 origin is the `rw` and which therefore
binds no name of its own; a binder written more than once in its own binder
text; and anything whose introducing or using step is not available verbatim.

**The rewrite.** The BINDER — the part of the introducing step before its
top-level `:=`, so an `h` in a `have`'s justification is left alone, being a
term from an enclosing scope — plus every whole-identifier occurrence in the
steps `haveUses` says READ it. Occurrences are scanned in CODE only: a line
comment, a block comment or a string literal inside a tactic's tight extent is
skipped, because a rename that reached into one would edit prose. A reader
that names it nowhere (`omega` off the context) needs no edit and is not an
obstacle, which is why the edit count can be SMALLER than the use count.

**The gesture is ⌥-CLICK ON THE CONTEXT LINE**, and no glyph. B2 already gave
every hyp line a hit target and a `<title>`; a `✎` on each renamable line would
put chrome on the one part of the box that is a list of the author's own words,
and it would have to be measured and modelled in `probe overlap`. The title
now reads `introduced by \`intro h h2\` (line 26) — ⌥-click renames \`h\` →
\`hpn\` (Mathlib's name for divisibility)`, one `nodeHints` row under `goal`
gated `needs: "restructure"`, and the pill is D1's, without the step-count
clause (a rename is not about length): `rename \`h\` → \`hpn\` · ✓ elaborates`.
`HypBlock` gained one prop, `onLineClick`, wired on BOTH render paths — the
per-line hit rect and, on the tagged path, the line's own `<div>` — and a plain
click is ignored, so a context line still behaves like part of the goal box.

### D3 — one shape is one edit, and this corpus has none of it

Batteries documents the rule the redirection rests on (`Batteries/Tactic/
Init.lean`, `byContra`): "If `p` is a negation `¬q`, `h : q` will be introduced
instead of `¬¬q`." So on a NEGATED goal `by_contra h` is not a proof by
contradiction at all — it is `intro h`, and saying so is one edit and a strict
simplification of the reading. That is `directRewrite`, and it is the only
redirection offered.

`contradictionShapes` is the analysis: every `by_contra` / `by_contra!` /
`exfalso` / negated-goal `intro` in a tree, with the goal's polarity, the
binder, its use count, the head word of the step the block ends at, and the
condition that decided it. **The corpus contains two shapes and neither is
redirectable:**

| where | head | goal | why not |
|---|---|---|---|
| `proofs/euclid.lean:40` | `by_contra hle` | `⊢ N < p` (positive) | the body really does derive `False` from `hle : ¬N < p`, through `push_neg` and four lemmas; a direct proof is a different proof, not moved text |
| `proofs/odd_sums.lean:57` | `exfalso` | `⊢ Even m` | `exfalso` REPLACES the goal, and three steps stand between it and the closing `exact`; dropping it changes what is proved |

The brief anticipated exactly this and asked, in that case, for the analysis
rather than "a gesture with nothing to offer". So **D3 ships no hover-bar
button**: `directRewrite` and `contradictionShapes` are pure functions, printed
by `probe rewrite`, and one line in ProofTreeView would wire the button the day
a proof in this repository needs it.

`by_contra!` is declined even on a negated goal: it also normalises the
negation (`push Not`), which `intro` would not reproduce.

### The fixtures, and why there are two

`proofs/` had nothing to rename either — its authors named every hypothesis
well (`hmdvd`, `hle1`, `hpp`, `he`/`ho`), which is the right way to write Lean
and leaves the move nothing to say. That is the finding; it is not a reason to
ship an untested gesture. Two fixtures were added, and neither manufactures a
measurement:

* **`proofs/rename.lean`** — three short proofs whose hypotheses carry the
  anonymous names a reader actually meets. It joins the corpus, so the harness
  can show the gesture and `probe rewrite` can pin the edits. `probe rewrite`
  asserts separately that **no rename is offered anywhere else in the corpus**.
* **`lean/ProofTreeRestructure.lean`** — the same three proofs plus the four
  contradiction shapes, `import Ramify` (which is what registers the RPCs), for
  the live gate. Nothing under `lean/` reaches the corpus.

The arrival of `proofs/rename.lean` moved every corpus-WIDE total in
`probe counts` by exactly its own contribution (3 proofs, 7 tactic nodes):
origins 390→395, tactic nodes 244→251, nodes naming a constant 61→64, lemma
references 70→73, traces 36→37 (opaque 26→27), undecided shapes 212→219. The
baselines are updated with that note beside them. `overlap` 1460→1540 layouts
(0 overlaps), `order` 1912→1968 (0 moves), `hopgap` 284→300, `narrate`
unchanged.

### Measured

**Corpus (`probe rewrite`).** D1 unchanged at 8 inlines and 2 extracts; D2's
runs 57→64 with 63 collapsible and 10 expands (the fixture's own runs).
**2 contradiction shapes, 0 redirections. 4 renames, all in the fixture, 0
elsewhere.**

```
proofs/rename.lean#1:26  `h`  → `hpn`  (dvd: p ∣ n)   26:8–26:9  27:25–27:26
proofs/rename.lean#1:26  `h2` → `hn`   (pos: 0 < n)   26:10–26:12 27:22–27:24
proofs/rename.lean#2:30  `h`  → `hab`  (lt: a < b)    30:8–30:9  31:26–31:27
proofs/rename.lean#3:34  `h`  → `hba`  (lt: b < a)    34:8–34:9  35:35–35:36
```

The first two are the case `usesEach` exists for: `intro h h2` binds both at
one position. The `h`/`h2` pair is also the whole-identifier test — the use is
`exact Nat.le_of_dvd h2 h`, and `h`'s edit lands at column 25 and not on the
`h` inside `h2` at column 22. `sub_pos_of_generic`'s `h : b < a` is read by two
steps and named by one (`omega` names nothing), so it is two edits for two
users.

**Live server** (`probe lsp ../lean/ProofTreeRestructure.lean <line> 2`):

* `--direct` at 49:2 (`redirect_direct`, `⊢ ¬n + 1 = 0`) — offered,
  `by_contra` → `intro`, **benign in 16 ms**, 2→2 steps. At 53:2 declined "the
  goal is not a negation"; at 57:2 "`by_contra!` also normalises the
  negation"; at 61:2 "`exfalso` replaces the goal".
* `--rename` at 65:2 / 69:2 / 73:2 — `h`→`hpn`, `h`→`hab`, `h`→`hba`, all
  **benign in 15–28 ms**, two edits each.

**The one live/offline disagreement, and it is not the rename's.** At 65:2 the
live server offers ONE rename where the offline probe offers two: the payload's
`tacticEdits` entry for `intro h h2` stops at column 9 with text `"intro h"`,
while `deleteSlots` for the same step correctly reaches column 12. The rename
therefore cannot see `h2` in its own binder and declines with "the step does
not name `h2` directly" — a SAFE failure, and the verbatim discipline working:
the text it is handed is a genuine prefix at a genuine offset, so an occurrence
it FINDS is at a correct document position and one it MISSES costs an offer or
a `semantic` verdict from `checkRewrite`, never a wrong edit. The truncation is
a `tacticEdits` bug with consequences beyond D5 (in-place editing of that
tactic would overwrite only `intro h`) and is filed as its own task rather than
patched around here.

**Harness** (`?stub-edit`, record 23 = `proofs/rename.lean#1`). The two context
lines carry the titles above; ⌥-clicking `h : p ∣ n` draws
`rename \`h\` → \`hpn\` · ✓ elaborates` and accepting writes exactly
`[25:8–25:9 → "hpn", 26:25–26:26 → "hpn"]` (0-based); ⌥-clicking `h2 : 0 < n`
writes `[25:10–25:12 → "hn", 26:22–26:24 → "hn"]`. Nothing else in the DOM
moved — the offer reserves nothing, measures nothing and draws nothing.

### Left undone, deliberately

1. **Statement binders are not renamed.** `mvars`' `h : 0 < n` and
   `side_goals`' `h : b ≤ a` are exactly the shapes the table is for, and they
   live in the declaration's own header: B2 gives them no origin (they are
   never "absent from `goalBefore`"), `haveUses` gives them no use list, and
   the client has no verbatim text for the signature. It would need a sidecar
   of its own.
2. **A `rw … at h` re-mint is not renamed.** Its B2 origin is the `rw`, which
   binds no name — first-writer-wins reading straight through to a decline.
3. **The alternate name is recorded and never offered.** `hpos`/`hle`/`hdvd`
   are in the table for the record; offering both would make a click a
   dialogue.
4. **No equality rule.** Measured, `x = y` is `h` 297 to `hab` 15: there is no
   convention to apply, and inventing one is what the standing rule forbids.
   This is why `ProofTreeTour.lean:55`'s `have h : k + 0 = 0 + k` is not
   offered a name.
5. **D3's redirection has no button.** Above.

## 2026-09-09 — The `intro h h2` truncation, and what the sweep found beside it

D5's live gate ended with one disagreement between the offline probe and the
server: at `lean/ProofTreeRestructure.lean:65` the offline probe offered two
renames and the live one offered a single one, because the payload's
`tacticEdits` entry for `intro h h2` stopped at column 9 with the text
`"intro h"` while `deleteSlots` for the same step correctly reached column 12.
It was filed as its own task rather than patched around, and this is it.

### The trap

`intro h h2` is a MACRO. Core expands it to `intro h; intro h2`, and the
expansion's own `TacticInfo` nodes carry positions inherited from the original
syntax — so the innermost one covers `intro h ` and Paperproof harvests the
step at 65:2–65:10, which `tightStop` trims to 65:9. The label is right
(`tacticString` is `"intro h h2"`, the whole surface tactic); it is the RANGE
that is a prefix.

`surfaceTacticRange` exists to widen exactly this kind of split step back to
its surface tactic, and it could not: its rule is the SMALLEST `TacticInfo`
that starts **strictly before** the step and contains it, and the outer
`intro h h2` node begins at the same byte. Loosening the rule to `≤` is what
the 2026-08 record already forbids in as many words — "delete wants the
LARGEST container where colouring wants the smallest" — because on
`induction n with` the container that starts at the same byte is the whole
alternatives block, and `tacticEdits.text` would then be a block where the
label is a line.

### The fix: ask the SLOT, and believe it only where the LABEL agrees

`tacticSlots` already knows the answer — a slot is one tactic AS WRITTEN — so
the loop in `mkTreePayload` now looks the step's start up in the slot table
and widens to the slot's stop **only where the slot's own verbatim text equals
the step's label**. That one test is what separates the two cases without a
taxonomy:

| step | label | slot text | widened |
|---|---|---|---|
| `intro h h2` | `intro h h2` | `intro h h2` | yes |
| `induction n with` | `induction n with` | the whole block | no |
| `rcases … <;>\n exact h` | the left operand | the whole combinator | no |

And where it widens, `tacticEdits.text` becomes character-for-character the
label, which is the best case `alignInLabel` has (one segment, no clipping).

### Measured

`probe lsp … --edits` is the new invariant and it is permanent: for every
`tacticEdits` entry that STARTS a `deleteSlots` slot, the entry must reach
that slot's stop, or stop where the slot goes on to open a block or a `<;>`;
and its `text` must be the file's own bytes at the range it claims. It works
under `--all`.

* `lean/ProofTreeRestructure.lean` — the entry is now `65:2–65:12`
  `"intro h h2"`, and `--rename` at 65:2 offers BOTH renames live
  (`h`→`hpn` and `h2`→`hn`, both `benign` in 15–19 ms), matching the offline
  probe exactly. The token count for that step went 17 → 18: `h2` is coloured
  now, which it was not.
* `lean/ProofTreeTour.lean` (31 entries) and `lean/ProofTreeScratch.lean`
  (104 entries) — **0 short, 0 off** after the change. Before it, the 8 rows
  that did not reach their slot were all legitimate: seven
  `induction … with` block openers and two `rcases … <;> exact h`
  combinators (`root_2_irrat_over_int` 188:4 and 196:4), where the step IS the
  left operand and the slot is the whole thing.
* **The corpus, swept offline** (`sample.ndjson` + the `.lean` files, step
  tight range against the slot it starts): exactly **3 true prefix
  truncations in 34 records, and every one of them a multi-binder `intro`** —
  `factorization.lean` 27:8 and 52:8 (`intro p` for `intro p hpm`) and
  `rename.lean` 25:2. Nothing else in the corpus truncates: `rw [a, b]`'s
  sub-steps sit at INNER positions that start no slot at all (a different
  phenomenon, already handled by D2's `hasSlot`), and `obtain ⟨k, hk⟩ := h`,
  `rcases … with a | b` and `simp at h` are harvested at their full extent.
  So the family is `intro`, and the fix is sized to it.

`tacticEdits` is widget-only, so **`web/public/sample.ndjson` is byte-identical
across this change** — checked, and stated here because a wire fix that moved
the corpus would mean the field had leaked onto the offline wire.

## 2026-09-09 — D4: idiom normalisation, and the linters are Mathlib's own

Workstream D's fourth catalogue entry. It is the one that writes the least
code, and deliberately: **Mathlib's style rules already ship as programs.**
They are `linter.*` options that run at elaboration and log a warning at the
syntax they object to, so this project decides nothing about what good Lean
looks like — it turns the linters on, carries their messages back with their
own ranges, and draws them on the node they name.

### The seam: `reElabDecl` with options

B4 built the seam and D1 built the classifier on it; D4 needed one parameter.
`reElabDecl` now takes `opts : Options → Options`, applied on top of the
scope's own, and `ProofTree.lintDecl` passes `ProofTree.withLinters`. Two of
CLAUDE.md's standing warnings turned out to be load-bearing:

* **`Elab.async` is ON on the server**, and `runLintersAsync` would then post
  every linter to a snapshot task whose messages this call never sees.
  `reElabDecl` already forces it off for its own reasons, and that is what
  makes `runLinters` run inline so the messages land in the command state the
  RPC reads.
* **`snap.msgLog` is empty on the server**, which is why the lints are the
  re-elaboration's own messages and never the file's.

The RPC is lazy and cached on `(uri, version, declaration start)` — B4's key,
for B4's reason. Measured on `lean/ProofTreeLints.lean`: **8–27 ms** per
declaration, 0–1 ms cached.

### The set is EXPLICIT, and it is the tactic-level half of the standard set

`linter.mathlibStandardSet` enables 25 linters at once, and a lint is
re-elaborated out of ONE declaration rather than out of its file. Every linter
that judges the FILE — `style.header`, `style.longFile`, `style.missingEnd`,
`style.openClassical`, `style.setOption`, `privateModule`, `hashCommand`,
`minImports`, `upstreamableDecl`, `auxLemma` — would be answering about a file
that does not exist, so `ProofTree.lintBoolLinters` names the fifteen that
speak about a proof:

```
unusedTactic · unnecessarySeqFocus · style.multiGoal · flexible · style.cases
style.cdot · style.refine · style.induction · style.show · style.lambdaSyntax
style.dollarSyntax · style.longLine · oldObtain · style.admit
style.nativeDecide                                    (+ haveLet, a Nat option)
```

`unusedTactic` and `haveLet` are NOT in Mathlib's own set — they are
informational there — and they are the two whose findings a READER most wants,
so they are in. `linter.haveLet` is a `Nat` (0 off / 1 noisy declarations only
/ 2 always) and is set to 2: a reader who asked for lints has asked about this
declaration.

**The linter's NAME is read off the message's TAG** (`.tagged
linterOption.name`, `Lean.Linter.logLint`), never scraped out of its text. One
thing that cost a debugging round: the guard is `severity == .warning` plus a
matching tag, and NOT `MessageData.isLinterMessage` — Mathlib's
`logLint0Disable` (the `Nat`-valued linters, `haveLet` among them) never adds
core's `linterMessageTag`, so a guard on it dropped exactly the lint whose fix
is the simplest one D4 offers. Core's "This linter can be disabled with …"
note is cut for display (`stripLintNote`); it is chrome for a compiler log.

### The fix table is MEASURED, not designed

The brief guessed at six fixes. What the live server actually hands back
decided them, and the deciding fact is where each linter POINTS:

| linter | the range it points at | fix | verdict |
|---|---|---|---|
| `style.cdot` | the `.` | → `·` | benign 22 ms |
| `style.lambdaSyntax` | the `λ` | → `fun` | benign 8 ms |
| `unnecessarySeqFocus` | the `<;>` | → `;` | benign 11 ms |
| `haveLet` | the whole `have … := …` | its first four characters → `let` | benign 11 ms |
| `style.multiGoal` | the tactic left standing | `· ` inserted at its column | benign 25 ms |
| `unusedTactic` | the tactic | the delete gesture's extent → `""` | benign 9 ms |
| `flexible` | the `simp at h` | D2b's expand, verbatim | benign 11 ms |
| `style.cases` | a whole `cases' h with h h` | — | shown only |
| the rest | — | — | shown only |

Three of the seven are ONE TOKEN AT THE LINTER'S OWN RANGE, which is the shape
of the whole table: where a linter points at a token, the fix is that token
rewritten and nothing is invented; where it points at something wider
(`style.cases` wants `obtain`/`rcases`/`cases` — three different answers, none
of them a transposition of the text), no fix is offered and the reader writes
their own, which is the standing rule about not completing an author's text.

**The brief's guess about `unnecessarySeqFocus` was wrong in an instructive
way.** It asked for "drop the `·`"; the linter's message is "Used
`tac1 <;> tac2` where `(tac1; tac2)` would suffice" and its range is the `<;>`
itself, so the fix is one character. Reading the linter beat reasoning about
it.

**Nothing is written on a guess even so.** Every fix goes through
`ProofTree.checkRewrite` — D1's preplay, unchanged — before the reader is
offered it. That is what lets `lints.ts` compute an edit from the linter's
range with no verbatim source to check it against: the elaborator is the gate,
not the text.

### `unusedTactic` fires on a tactic the tree does not draw

Measured, and it shaped `lintNodeAt`. A tactic that does nothing changes no
goal, so Paperproof harvests no step for it: `lean/ProofTreeLints.lean`'s
`skip` at 40:2 has a `deleteSlots` slot and NO node. The innermost-containing
rule (B3's attribution) therefore returns nothing for the one lint whose fix
is simplest. `lintNodeAt` falls back to the last node starting at or before
the lint, and — when the lint is the first thing in the proof, which is where
a `skip` usually is — to the GOAL the tactic below it stands under, never to
that tactic itself, which would put "'skip' tactic does nothing" on the `rfl`
that does the work. Measured: the lint lands on `⊢ n + 0 = n`, the root.

### The corpus is CLEAN, and that is the finding

`gen.sh` now runs `ppharness --lint` by default. The linters ride the ONE
elaboration the harness already runs, so the cost is the linter passes and not
a second pass: **176.5s without, 173.0s with**, i.e. inside the run-to-run
noise, because the cost of these files is Mathlib's import. Well under the
brief's 10s bar, so the default is ON.

And `web/public/sample.ndjson` is **byte-identical** with it on, because
`proofs/` produces **0 lints over 34 records**. That is not a gap in the
plumbing — the CLI path was checked against the live server on the fixture and
returns the same nine lints at the same positions — it is that this corpus is
written the way Mathlib asks. `probe rewrite` pins the zero and says so.

**No lint fixture was added to `proofs/`.** D5 added `proofs/rename.lean`
because the shapes it needed were GOOD Lean that merely used anonymous names;
a D4 fixture would be `cases'`, a stray `.`, a `λ` and a do-nothing `skip`
dropped into a corpus every other probe measures. The live fixture
`lean/ProofTreeLints.lean` carries them instead — one theorem per linter,
`import Ramify`, nothing under `lean/` reaching the corpus — which is D5's own
split between the two halves.

### Left undone, deliberately

1. **No `style.multiGoal` fix for a goal closed by more than one tactic.** One
   bullet is one insertion; bulleting a RUN means re-indenting every line
   under it, which is not one edit. The linter re-fires on the next tactic
   after the first bullet is accepted, so a reader bullets a block one click
   at a time and the elaborator checks each one.
2. **No `oldObtain`, `style.refine`, `style.show`, `style.induction` fixes.**
   Each wants a different tactic, not a different spelling.
3. **`style.longLine` has no fix and should not.** Where to break a line is a
   reader's judgement about their own text.
4. **The `lints` option is a STANDING question, not a one-shot ask.** The
   first cut fetched on the toggle alone, and walking to the next declaration
   then left the row reading `lints` with nothing drawn until the reader
   re-ticked it — a reading option that silently stops answering, which is
   the class of bug this record is full of. It now re-fires on `proofKey`, and
   `proofKey` moves only when the DECLARATION does, so a cursor move inside
   one proof still costs nothing. The effect calls the RPC and sets state in
   the promise's callback (never synchronously), and the requester — memoised
   on the cursor, so a fresh closure per move — is reached through a ref
   written in an effect, the `toastRef` pattern; `react-hooks` and the React
   Compiler lint both pass.
5. **A declaration with ERRORS lints thinly, and that is the linters' own
   rule.** `unnecessarySeqFocus` returns early on `messages.hasErrors`, and
   `haveLet` at level 1 does the same; measured, `lean/ProofTreeDiagnostics.lean`
   — five deliberately broken declarations — produces 0 lints and no crash in
   4–5 ms each. Lints are a finished-proof affordance. (`lean/ProofTreeErrors.lean`
   cannot be a live gate at all: it has no `import` line, so no RPC is
   registered there.)
6. **The lints are per DECLARATION, not per file.** A reader asking about one
   proof gets that proof's lints; the file-level linters are not in the set at
   all (above).

## 2026-09-09 — C4: the polish is a REWRITE, and the companion is the only thing that can reach a model

The roadmap's C4 is one sentence with a lot of restraint in it: "constrained
to *rewriting* the templated text with the states as context — the
configuration all four papers report as best — never generating from the raw
Lean." Everything below follows from taking that literally.

### Where it runs, and why it cannot run anywhere else

The infoview is a webview with no network. The Lean server could open a
socket, but a proof assistant's language server making outbound HTTP calls on
a cursor move is not a thing to build. The companion extension already exists,
already has a channel, and is already the place the project puts everything
the infoview API cannot do.

So the direction of the existing idiom is reversed. `popoutEdit` writes
`~/.proof-tree-companion/popout-request.json` and the companion's `fs.watch`
picks it up; that channel has no answer, because every one of its actions is
something the editor does. Polish has an answer, and there is no route from a
VS Code extension back into a live RPC session — so the widget POLLS:

    widget ──ProofTree.polishRequest {id, proofKey, lines}──▶ server
           ──writes polish-request.json──▶ companion (fs.watch)
           ──API──▶ writes polish-response.json
    widget ──ProofTree.polishResult {id}──▶ (pending … pending … ok)

`setTimeout` at 400 ms, twenty seconds and then give up — never `rAF`, which
is the standing rule and which this is precisely the case for: a hidden
webview fires no frames and the ask would simply hang. On give-up the strip
draws the TEMPLATE, which was never wrong; nothing retries on its own.

Every request carries an id this session minted (`companionId`), and
`polishResult` returns `pending` unless the response file's id matches. A
response left behind by another window is therefore never mistaken for an
answer — the failure mode the theme file does not have (it is a broadcast) and
this channel would.

### What is sent

`polishLines(base, drawn)` is exactly `narrationFor`'s own map with the
`∴ ` stripped back off. That has a consequence worth stating: **the author's
own comments are never sent**, because they are already absent from that map —
the strip draws the author's words when there are any, and narration only
fills the silence. Beside each sentence go the two goal states and the
tactic's own text, as CONTEXT for phrasing.

The prompt is five absolute clauses and a JSON envelope: rewrite only, never
state a fact that is not already in the sentence; keep every symbol,
identifier, hypothesis name and lemma name character for character; one output
line per input line in the same order with the same `nodeId`; under 120
characters, no markdown; the states are context for phrasing and not material.
The model is `claude-haiku-4-5-20251001` by default — polish is a rewriting
task and not a reasoning one, and the roadmap's own note about a local
Leanstral through `lean-lsp-mcp` remains the eventual answer for people who
want nothing to leave the machine. `max_tokens` is sized to the batch
(`400 + 80 × lines`, capped at 8192) rather than fixed, because the whole
proof goes in one request.

**Batched per proof, cached per proof.** One request for the whole tree, and
the companion caches on `(proofKey, hash of the templated text)` in
`globalState`, so re-opening a proof costs nothing and a re-parse that changed
nothing about the sentences costs nothing either. The client caches PER SENTENCE, not per tree: `polishCacheKey` is
`nodeId + " " + template`, and only lines nobody has asked for go out
(`askedRef`). Keying the client's copy on the whole tree was the first cut and
was wrong for a reason worth recording — a CUT changes which nodes are drawn
and nothing else, so folding one goal would have re-asked for every sentence
in the proof, an API call per fold. A line that failed or came back empty
stays marked (stored as `""`), so nothing retries on its own; a key that does
not match draws the template, which was never wrong.

### What is drawn

`≈ ` (`POLISH_MARK`), in place of `∴ `, written INTO the string so
`commentSize` measures what is painted — the `SEED_MARK` idiom, third use.
Two marks and a plain strip is now the whole vocabulary of voices: the
author's words bare, the tree's template `∴`, the rewritten template `≈`.
`applyNarration` takes the polished map as an optional third argument and is
otherwise untouched, so narration still reaches the layout engine alone and no
gesture can edit, hide or delete a generated line.

### The setting is the DEFAULT; the row is an OVERRIDE

`ramify.narration.polish` is off by default. The reading-options row `polish`
mirrors it for the session. The state is deliberately `polishOverride:
boolean | null` and not a copy: the setting arrives late (it rides the theme
file, fetched after mount), so a copy would have to be synced from an effect,
and the setting would then lose to a value nobody chose. `null` means "follow
the setting" and there is nothing to sync.

Where there is no companion, or no key, the row is DISABLED with the reason in
its title — the `goals as TeX` rule said again: a reader who has met the
setting should find out where it went. The two facts come down the theme file
as `ai: {polish, propose, ready, why}`; `ready` is the whole answer to "can
this be asked at all".

### The key

`context.secrets`, set by `Ramify: Set narration API key`, falling back to
`ANTHROPIC_API_KEY` in the environment. Never a setting (settings sync, and
they are readable by every other extension in the window). Never logged — and
neither is the prompt, which carries the user's proof. What the "Ramify"
Output channel gets is the request id, the line count in and out, the latency
and the token usage; an API failure is logged by STATUS ONLY, since some
proxies echo the request back in an error body.

### Offline

`?polish-stub` fabricates the rewrite — first letter raised, full stop added —
and records the lines it was handed in `window.__polish`. That is enough to
see the `≈` strip, its wrap and the 2-line clamp with no key and no companion,
and it is deliberately NOT a probe: what a model returns is not a fixture, and
the only thing worth pinning offline is the request, which `polishLines` builds
out of the narration probe's own map.

---

## 2026-09-09 — D6: the readability eval, and the agent as a chooser

### The eval (`web/probe/eval.mjs`)

`npm run probe -- eval`. Per proof: steps (the raw parser count — the number
the rewrite pill claims to change, and the one thing here that does not depend
on a reader's cuts), max tree depth, goals, `have`s, `have` per goal, unused
`have`s (`haveUses` count 0), lints, closing linear runs and the longest run,
and the rewrites OFFERED by each of D1/D2/D3/D5.

The corpus is the CLI corpus plus two files that are not in it:
`lean/ProofTreeTour.lean` (proofs written to be read) and
`lean/ProofTreeScratch.lean` (which holds `infinitude_of_primes` as a Lean user
rewrote it). Neither is a Lake target and neither reaches `sample.ndjson`, so
the probe ELABORATES them itself into `probe/eval-extra.ndjson` — git-ignored,
cached against the sources' mtimes, ~20 s cold, one ppharness process per file
exactly as `gen.sh` does it. Putting them in `proofs/` was considered and
rejected: `gen.sh`'s output is tracked, and this is a fixture for a
measurement, not for the harness.

**Measured (47 proofs):** 389 steps, max depth 35, 378 goals, 45 `have`s
(0.12 per goal), 5 unused `have`s, 2 lints, 44 closing runs (longest 7), and
122 rewrites offered — 14 inline, 4 extract, 85 collapse, 15 expand, 4 rename,
0 lint fix. (The corpus's 2 lints are both in `ProofTreeScratch.lean`; `proofs/`
is still clean, which is D4's own finding.)

**The pair.**

| | original (`proofs/euclid.lean`) | human (`ProofTreeScratch`) |
|---|---|---|
| steps | 26 | 9 |
| max depth | 21 | 11 |
| `have`s | 7 | 1 |
| `have` per goal | 0.27 | 0.11 |
| linear runs | 6 | 1 |
| longest run | 7 | 2 |
| rewrites offered | 16 | 4 |

Asserted: fewer steps, shallower, fewer stated facts per goal. All three hold.
The last row is the one to read carefully — the tool offers four times as many
restructurings on the version that needs them.

### The five moves: 4/5, and the missing one is a whole primitive

The roadmap's table of what the Lean user did, answered from the OFFERS
computed on the original rather than from a hand-written verdict:

| move | offered? | by what |
|---|---|---|
| Library replacement (`exists_prime_dvd` → `Nat.exists_prime_and_dvd`) | **no** | nothing searches a library |
| Inline single-use `have` (`hM`) | yes | D1a, `inline hM into obtain` |
| Automation collapse (the `have` chain ending in `omega`) | yes | D2a, `these 7 steps are omega` |
| Absorb a normalisation step (`push_neg at hle`) | yes | D2a — it is INSIDE that run |
| Term ↔ tactic swap (`have hpfac := lemma a b`) | yes | D1a, `inline hpfac into have` |

**4/5**, and the probe asserts that number so a change in either direction is a
finding. Two honest notes about it:

1. The fourth row is offered *incidentally*. The human moved `push_neg` to its
   use site as `(by order)`; what the tool offers is a collapse of the whole
   seven-step run that happens to contain it. The end state is shorter and the
   step is gone, but the move is not the same move, and no primitive
   relocates a normalisation step to its use site — D1's inline is about a
   `have`'s justification, not a tactic's effect on the context.
2. The missing row is the one Workstream D never built: `exact?`-style premise
   selection. It is not a gap in D1–D5's coverage of what they do; it is a
   sixth primitive. Reporting 4/5 rather than "5/5 with an asterisk" is the
   point of measuring it.

### The agent, and why it may only choose

Roadmap: "the agent only chooses among them." That is implemented literally.

The request carries the drawn tree's outline and `agentPrimitives` — every
rewrite this client has ALREADY COMPUTED, with its edit list: inline, extract,
lint fix, rename. D2's collapse and expand are deliberately absent, because
their replacement TEXT is the server's answer (`tryClose` names the tactic,
`getAutomationTrace` names the lemmas) and not the client's: a primitive an
agent may pick has to be one this side can hand over whole.

The answer is an INDEX into that list plus one line of reason. There is no
free-form edit anywhere in the channel, which is what makes a bad answer
harmless: the worst it can do is open a proposal the elaborator then rejects,
through the same `checkRewrite` gate, the same pill and the same undo as a
rewrite the reader asked for by hand. The reason rides the pill's `<title>`
and an anchored toast — never the pill's LABEL, which says what will be
written and whether the elaborator agreed, and is the promise.

`suggest a rewrite` is a row in the reading options and an ACTION, not a
setting: one ask, on the proof in front of you. It is gated on
`ramify.restructure.propose` (off) and a key, and disabled with the reason
otherwise. `?propose-stub` picks the first primitive offline and records the
request in `window.__proposals`.

**No agent ships.** What ships is the channel, the primitive list, the pill and
the gate; the model call reuses C4's client in the companion. That is the
whole of what "hook only" meant.

## 2026-09-16 — In-page tooltips for the chrome, because native `title` does not survive the infoview

**Report.** "Most of the new buttons don't have or don't show on-hover tooltips.
Status bar and node menu absolutely should."

**Measured in the live VS Code infoview (macOS).** The text EXISTED for every
status-bar item, every Reading-options row and every hover-bar action; the
native tooltip is what failed, two ways:

1. While VS Code is NOT the active macOS app, no native tooltip shows at all —
   yet pointer events still reach the webview (the hover bar appears, Lean's
   own in-page hover popups appear). A reader with the editor beside a PDF gets
   no tooltips, ever.
2. With VS Code active they are FLAKY: the trash button, whose `onHover` sets
   `deletePreview` and re-renders the tree, showed nothing after 2.5 s; the eye
   failed on a first hover and worked on a retry. Skip, lens, Layout, Comments,
   Width, Marks, the chevrons, ↺, ? and the panel rows worked.

**What ships.** `web/src/tipController.ts` (a plain `TipController` object held
in `useState`, never React state, plus `TipContext`/`useTip`) and `TipLayer` in
`web/src/tip.tsx`, rendered once as the last child of the view's frame
(`zIndex` 30, `pointerEvents: none`, `POPUP_CHROME` + the editor-widget border —
the toast's and the doc-token popup's chrome — max-width 320, `pre-line`).
`useSyncExternalStore` means a tip re-renders that one div and never the view;
its `left`/`top` are written by a layout effect straight onto the element, above
the target, flipped below where there is no room, clamped inside the frame.

- **Text source:** the control's own `aria-label`, which replaces its `title` /
  `<title>` (so the accessible name is unchanged and VS Code-active users never
  see two). It is re-read every 200 ms while the tip stands, so `⁇` going to
  `…` or the Marks count changing under the pointer is what the tip says.
- **Timing:** 450 ms dwell; once one tip has shown, entering another target
  shows it at once (native "tooltip mode") until the pointer has been off every
  target for 600 ms. Measured in the harness: Layout → Context showed the second
  tip 30 ms after the move; a cold hover on the trash had no tip at 300 ms and
  its tip at 550 ms.
- **Hides on:** pointerdown (capture — and the target stays quiet until left,
  as a native tooltip does after a click), `scroll` (capture, so the tree's own
  scroller counts), `wheel` (the ⌘-scroll zoom), target unmount (React sends no
  leave for a removed node; the 200 ms poll checks `isConnected` — the hover bar
  disappearing under a tip), and Esc as the FIRST row of the `layers` table. The
  row reads `upNow: tipCtl.shown` at key time, a field added to `Layer` for
  state that lives outside the view's render; a render-captured `up` would be
  stale because a tip showing does not render the view. One Esc takes the tip,
  the next the popover under it.
- **POINTER events, not mouse.** React drops `onMouseEnter` on a disabled
  `<button>` (Chrome itself delivers the events — measured, `:hover` and the
  native `mouseenter` both reached `goals as TeX`), and the disabled rows are
  exactly the ones whose tip says why. Existing `onHover` callbacks (brief's
  preview, skip's and trash's fades, the D1/D2 range previews) stay on the
  mouse pair; the tip rides `onPointerEnter`/`onPointerLeave` beside them.

**Converted:** `BarButton` (every value item in both forms, the eye, ↺, ?, the
Marks chevrons), `BarRow` (every row of the Layout, Context, Comments, Marks and
Reading-options panels, disabled ones included), the Width slider, the
diagnostics item's `‹ ›` and message, `RailButton` (`+ − ⛶`), every
`NodeActionBar` button, `FrontierChip` (frontier chips, the calc relation
picker, and the armed-delete and proposal pills' two parts), and the help
panel's `✕`. The harness driver's `__ptw.button(prefix)` now matches
`aria-label` first.

**Left native, deliberately:** node BOX `<title>`s — the long node tooltip,
hypothesis lines, ledger rows, trace leaves, the hop break and caption, the
corner `+N`/`−` and the mark nub — which are reading aids on the tree rather
than labels of a control, and several sit over `InteractiveCode`, whose own
popups must not be covered; the gallery pager (an in-tree group title); the
top-centre modal banner and the scope breadcrumb (outside the bar/rail/menu the
report named).

**Controls with no text at all:** none, in the surfaces the report named — the
audit over every `onClick` the B/C/D work added (`⁇` and its busy `…`, `⤵ ⤴ ⇓ ⇑
✎`, the lints / polish / suggest-a-rewrite / goals-as-TeX rows, the proposal
pill's ✓ and × parts, trace leaves, ledger rows, the diagnostics pager) found a
title on each. The report was the native failure. Three titles were
nonetheless incomplete and now say more: the Marks chevrons, disabled with an
empty reading, add "— no marks in the lists that are on" (the empty message's
own words); the eye's bare "Reading options" names its rows and which four the
slots report; the diagnostics message adds "Click to show it on its node and in
the source" where the click does that.

Gates unchanged: typecheck, lint, `counts`, `overlap` (1640 / 0), `order` (1872
/ 0), `hopgap`. The tip draws nothing the layout engine sees; node `transform`s
compared equal across a tip on the trash (which sets `deletePreview`).

**Addendum, same day — the inactive app, measured again live.** With Calculator in front and the new in-page tips built, hovering the status bar showed nothing, and the webview had received no pointer events at all: the skip button's tip from before the switch stayed on screen and the trash button's delete-preview fade stayed applied until the reader clicked back into VS Code. An earlier inactive run had seen the node hover bar and Lean's own popups respond, so delivery to an inactive window is not dependable. No in-page tooltip can answer while another app is in front. What the view can do is not leave one standing: `TipLayer` now dismisses on window `blur`. The in-page tips still fix what native `title` got wrong with VS Code active: the trash can showed "Delete this tactic" live, and skip followed at once.

**Addendum, same day — the dwell.** 450 ms was "a little quick to the jump" (user report). The first tip now waits `TIP_DWELL_MS` 1000, which is about when macOS shows a native tooltip, so the chrome's tips arrive on the same beat as every other tooltip on the desktop. Moving to a neighbouring control while a tip is up still shows the next one at once, as native tooltips do.

## 2026-09-17 — D1 extract hands the name to Rename Symbol

**Direction** (user, 2026-09-17): "If we're going to enable hoist we should
probably fire off a vscode rename symbol command from `this` to the user's
desired name." The 2026-09-09 rule "the name is `this` and is never invented or
prompted for" is superseded in its second half: the name is still never
INVENTED — it is asked through the editor's own Rename Symbol box, which the
author can Esc out of, leaving `this` (a valid file).

**Spike first — does Lean's server rename a `have this` binder?** Driven with
the LSP rig (`lake serve`, a scratch `lean/SpikeRename.lean` opened by
`didOpen` only, never written to disk; script kept out of the tree), on
`theorem t1 (a b : Nat) (h : a < b) : a < b + 1`, once with no imports and once
under `import Mathlib`, identical results both times:

- `initialize` advertises `renameProvider: {prepareProvider: true}`.
- Settled, `have this : a < b := by omega` + `exact Nat.lt_succ_of_lt this`:
  `prepareRename` at the binder returns exactly the 4-char range; `rename`
  returns TWO edits, binder and use, from the binder or from the use (0–2 ms).
  `this` behaves exactly as an ordinary name (`hxy` gave the same shape).
  The ANONYMOUS `have : …` renames only the use — irrelevant here, the extract
  always writes `have this :`.
- **Stale right after an edit.** Polling every 20 ms after a `didChange`: at
  0 ms the server answers from the PREVIOUS snapshot — `null` where nothing
  stood before (the extract's case: the position was inside the old `exact`),
  otherwise edits at the OLD text's ranges (`hxy ` read with a trailing space,
  `thi` read short) — and first answers correctly at 205–218 ms, core and
  Mathlib alike, on a small declaration. `$/lean/fileProgress` with an empty
  `processing` for the new version is NOT a usable signal: a rename sent right
  after it still came back one version stale.

So Lean renames the binder, and the multi-cursor fallback (select the binder
and the one replaced occurrence from the edit's own positions) was NOT built.

**Shape.**
- `extractRewrite` stamps `Rewrite.renameAt` = `{insert line, indent + "have ".length}`,
  the binder in the WRITTEN text (the insertion is a whole line at column 0 and
  the other edit lies after it, so nothing shifts it). `probe rewrite` applies
  each offered extract's edits to the real file and asserts `this :` stands
  there (both corpus extracts, `commented.lean` 24/25).
- The view passes it as `onApplyRewrite(edits, renameAt)` for `kind ===
  "extract"` only; widget.tsx sends `callCompanion("rename", {renameAt, +4})`
  in the `applyEdit` promise's success arm — never a condition of the write.
  The harness records `window.__companion` (`?stub-edit`): accepting the
  extract on `exact ⟨k, Or.inr (by omega)⟩` recorded `{action: "rename", pos:
  {line: 23, character: 11}}` beside the written `      have this : m + 1 = 2
  * k + 1 := by omega` at line 23 — column 11 is `this`.
- **Its own request file.** `popoutEdit` writes `rename-request.json` when
  `action == "rename"`: the write happens as the pointer leaves the accepted
  pill, and a hover `clear`/`preview-clear` into `popout-request.json` a moment
  later would overwrite it before the watcher read it (the watcher reads the
  file at event time, and dedupes on nonce). Verified live: the RPC returns
  `ok` and the file carries the action, range and nonce.
- **Companion wait, bounded, two stages** (`renameAfterHoist`, extension.js):
  (1) poll the document text until the range reads `this`, ≤ 2 s
  (`RENAME_TEXT_WAIT_MS`); (2) poll, every 120 ms, ≤ 10 s
  (`RENAME_READY_WAIT_MS`), until `vscode.prepareRename` returns EXACTLY that
  range and a dry-run `vscode.executeDocumentRenameProvider(…, "this_renamed")`
  returns edits that include the binder and ALL read `this` in the current
  text — the second half is what catches the one-version-stale answer, which
  a range check alone would not on an equal-length name. If the text moves
  during the wait it gives up. Then it shows the document (an ordinary editor
  on the file first, the lens second, column one last — Rename Symbol acts on
  the FOCUSED editor), selects and reveals the binder and runs
  `editor.action.rename`. Every stage logs to the Output channel with waited
  ms and poll count; a give-up leaves `this`.
- Setting `ramify.restructure.renameAfterHoist` (default true); off, the
  companion logs a skip and does nothing. Only a window with the document open
  acts on the request.
- Extension 0.0.17.

Not exercised: the companion half inside VS Code (installing is the user's
step). 10 s is a guess sized for a long declaration under Mathlib; the 210 ms
measured is a small one.

## 2026-09-17 — Hide and skip split by verb

**Direction.** "While reading to the end I go for skip; while taking a
high-level look I go for hide." Two reading modes, two verbs, and until now
one of them did the other's job: a trunk goal's `−` HOPPED its consumer in the
compact layouts, so `−` and ◌ drew the same position, and ◌ inside a branch
fell through to the fold of the goal above. The rule is now THE VERB DECIDES
THE IDIOM, NOT THE GOAL'S POSITION.

**The rule.**
- `−` on a goal HIDES: always a `fold`, in every layout, trunk goals and the
  root included (on a trunk goal that is the rest of the proof — intended).
  Only a childless goal has no corner control.
- ◌ on a step SKIPS: a `hop` from the goal above, keeping the continuation
  goal, on the trunk and inside branches alike, in all four layouts. Offered
  only where the step has EXACTLY ONE continuation or is a LEAF (a leaf that
  is its goal's sole consumer folds that goal — reading a branch to its end by
  skips). One continuation under a TACTIC (a broken chain's synthetic `calc`)
  keeps the ghost.
- NOT offered: a split (`induction`, `cases`, `constructor`, `rcases`,
  `by_cases`, `refine ⟨?_, ?_⟩`, `match`…), a closing step whose only children
  are spawned/side obligations, a ledger row.
- Marquee bands follow the verb (`cutForBand`): exactly one goal's strict
  subtree → that goal's fold; a straight run → the hop; anything else → the
  ghost.
- `.none` gives ◌'s answer (`noneSeedCut`): a seeded hop captioned with the
  note where a continuation exists; the fold of the goal above on a leaf, the
  note riding `folded.note` and heading the goal's `<title>`; the ghost only
  on a split.

So the look names the verb: `+N` with a break on the line = skipped, `+N`
without = hidden.

**What changed.**
- `elide.ts`: `goalCut(byId, id, idx)` lost its `{trunk, stepElidable}`
  options and is one line (fold iff the goal has children) — the trunk-hop
  branch, the ghost/merged-run absorption and the continuation test all went.
  `stepCut(byId, id, idx)` likewise lost its options: `hopForStep` → leaf fold
  (`leafFoldFor`) → ghost under a tactic → `null`. Both hop and leaf fold go
  through `soleConsumedGoal`, which is what refuses a ledger row (the ledger
  node has one consumer per row). `hopForStep` no longer asks "first child"
  but "sole consumer". `stepElidable` is now literally `stepCut(…) !== null`,
  so the gate and the cut cannot disagree. New `foldForBand` / `cutForBand`.
  `ElideCut`'s `fold` gained `note?`; `applyElisions` reads it.
- `ProofTreeView.tsx`: `goalCuts` and `stepCutFor` call the option-less forms
  (the layout no longer enters); the marquee calls `cutForBand` and anchors on
  the goal for a fold as for a hop; the `.none` pill anchors likewise and its
  bare-`.none` gate is `noneBareIds` (◌-able steps plus every tactic with
  children, since a split's `.none` is its ghost); a folded goal's `<title>`
  says "skipped" or "folded" by kind and leads with a leaf-`.none` note; the
  hover bar's ◌ title distinguishes a closing step ("the goal above folds");
  in ⑃ wide a hop whose kept goal sits to one side drops VERTICALLY through
  the break before it curves (the strokes had stood beside a curve that had
  already left). Two stale comments fixed in review (the `treeIdx` note still
  said `goalCut` declines on a ghost below; `addCut`'s dedupe note still said
  `−` and ◌ mint the same `elide-step:` cut — it is now `−` and ◌ on a LEAF
  that mint the same `elide-fold:`, and a subtree band a third way).
- `gestures.ts`: `NodeGates.goalCut` is `"fold" | "open" | null` (`"skip"`
  went with its row); the `−` row says "to hide everything below this goal",
  with a note pointing at ◌ for reading on; ◌'s note says a closing step just
  folds and a split has no skip; the marquee `skip` verb's title names all
  three outcomes.
- Probes. `corpus.mjs` gained `readerCuts(lib, nodes)` — every goal's `−` plus
  every step's ◌, deduped by `cutId` — and `order`, `overlap`, `hopgap` sweep
  it, so hops INSIDE branches are measured for the first time. `counts` pins
  the rule (below). `fold.mjs` gained `skip:<tactic>` (`t<k>`, a label prefix
  or an id) and prints "◌ not offered" on a split; `wide:` is gone.

**Numbers** (odd_sums unless named; "before" is
`refs/snapshots/before-skip-hide:web/probe/counts.mjs`).

| | before | after |
|---|---|---|
| `−` on the root | hop, 60 drawn | fold, 1 drawn |
| ◌ on `have key` | hop, 60 (same cut as the root's `−`) | hop, 60 — now the ONLY route |
| `−` on the goal after `have key` | hop, 73 | fold, 17 |
| ◌ on `have gap` | — | hop, 73 |
| `−` on succ | fold, 68 | fold, 68 |
| ◌ on `have parity` | hop, 49 | hop, 49 |
| ◌ on `induction m with` | fold of the goal above | `null`, not offered |
| ◌ on `constructor`, `rcases … he \| ho`, the 4 ctor-ledger rows | offered | not offered |
| ◌ on `rw [Finset.sum_range_succ]` (succ case) | fold of succ | hop, 74 drawn, captioned `rw` |
| `.none` on a leaf (`flag_closing`) | ghost | fold of the goal above, note carried, 0 ghosts |
| `.none` on a split (`flag_demo`'s `rcases`) | ghost | ghost |
| collapse-all odd_sums / factorization | 19 (4 folded) / 7 | unchanged |

Reading the succ case to its end by ◌ (three chained hops on the case root,
then `ring` folding the kept goal) COALESCES into the case root's fold,
tallying 4; a lone branch hop does not coalesce. Probes after: `counts` ALL
OK; `hopgap` hops 114 (inside branches 66), folds 234, caption placements 456
(seeded 2), min gap below a hopped goal stacked/spine/tracks 34, wide 43, and
every hop keeps exactly one child while no fold keeps any; `order` 1384
checked (112 hop cuts), 0 moved; `overlap` 2300 layouts, 0.

**Edge decisions.**
- *Ledger rows are not offered.* The ledger node consumes one justification
  per row, so no row is "the step below"; folding the ledger for one row would
  take its siblings. The row click and the component goal's own `−` are the
  per-row gesture. The ledger's HOST (`exact ⟨key n, …⟩`) still skips — the
  ledger is its continuation.
- *Closing with obligations is not offered.* `exact ⟨0, Or.inl rfl⟩` has
  children but no continuation and is not a leaf: a hop would keep nothing to
  break above, a fold would be `−`'s job.
- *`.none` fallback* follows ◌ exactly, with the ghost kept only where ◌ is not
  offered (a split) — the author's sentence still needs somewhere to stand.
- *Band: fold before hop.* A run that ends by closing its goal is both a goal's
  whole subtree and a straight run; as a hop it would keep no goal and draw no
  break, so the look would lie about the verb. `foldForBand` is asked first.

**Harness, measured** (`?stub-edit`, odd_sums, 75 drawn with the source's
seeds: a `§` hop on the `obtain ⟨j, hj⟩` goal `+4` and the `have gap` body's
fold `+2`).
- `−` on the root: 75 → 1, root wears `+44`, 0 breaks; click restores 75.
- `−` on the trunk goal before `have residue`: 75 → 47, `+16`, no new break,
  it is the last node drawn.
- ◌ on `have parity` (trunk): 75 → 49, `+17`, one break captioned
  `have · intro · …` (the seeded hop inside it absorbed, bigger wins), the
  continuation goal kept, the spawned body gone.
- ◌ on `rw [Finset.sum_range_succ]` (succ case): 75 → 74, `+1`, break
  captioned `rw`, the goal `rw [ih]` solves kept. ◌ on `intro m` inside the
  `have key` body: 75 → 74, `+1`, break `intro`, `m : ℕ` goal kept.
- Hover bar: `rw [add_comm]` offers "Skip this step"; `ring` and
  `exact (Nat.not_even_iff_odd.mpr hodd) hsq` offer "Skip this closing step";
  `induction m with` and `constructor` offer no skip. ⌥-click on
  `induction m with`: 75 → 75, no corner, no break, no ghost.
- Marquee driven by dispatched mouse events over the succ case's 7 subtree
  nodes → the pill's `skip` → 68 drawn, succ wears `+4`, no break, no ghost.
- **Layout switch** with the succ-case hop and a fold on the `have residue`
  body standing, ⌥-cycling outline → spine → tracks → wide → outline: 55 drawn
  in every layout, corners `+1 +2 +4 +10` and breaks `rw` plus the seeded one
  in every layout (the fold never breaks), no console errors. A second cycle
  read each node's screen rect right after the relayout and again 2 s later:
  identical in all four switches — nothing moved on its own after the
  anchored relayout.

**Restoring.** `refs/snapshots/before-skip-hide` holds the tree from before
this change; `git checkout refs/snapshots/before-skip-hide -- <paths>`
restores any file.

## 2026-09-17 — The signature header shows less, and opens only on click

**Report.** The header band was "pretty clunky: the ellipses + the immediate
dropdown of the full signature". At rest it drew the FIRST SOURCE LINE of the
signature clipped with a `…` (`theorem sum_range_odd (n : ℕ) : …`), and
pointer-enter on that text dropped the whole multi-line signature over the
tree at once; leaving closed it. Crossing the band on the way to anything
below it flashed a statement.

**Four options were put; the user chose 1.** (1) SHOW LESS: keyword, name and
binders at rest, the statement left to the root goal below, a click-only
disclosure. (2) Keep the hover but DWELL-open it. (3) FIT-AND-FADE the whole
signature onto one line. (4) PUSH the tree down when opened instead of
overlaying it. (2) keeps an open-on-pass-through, only slower; (3) still
repeats the statement the root goal prints directly below and is the widest
text to fade; (4) is the tree moving on its own, which is the standing
complaint.

**The split is by SYNTAX KIND, on the server.** `Ramify.lean` ships two new
plain positions beside `declHeaderStart`: `declHeaderSigStop` — the start of
the `Lean.Parser.Term.typeSpec` inside the declaration's first
`declSig`/`optDeclSig` node (found with `nodesOfKind`, preorder; a nested `by`
holds none) — falling back, where there is no type spec, to that signature
node's tail, then the `declId`'s tail, then the head atom of the declaration's
own node (`example := …`); and `declHeaderNameStop` — the signature node's
start (its first token: a binder's bracket, or the `:` where there are no
binders), absent when the signature is empty. No argument index, no text scan.
Both ride `stableProofOf` and widget.tsx's `ProofTreeData`; the CLI does not
carry the header at all, so `gen.sh` and the corpus are untouched. The client
(`headerPrefix`, briefLabel.ts) cuts `declHeader` there, collapses every
whitespace run — newlines and continuation indents — to one space, and returns
`keep` segments, so the existing token colouring maps through
`renderTacticTokens`'s `Elision` path (`renderDeclHeader` gained the argument)
and `theorem`, the name and the binders stay coloured. A position that does
not fall inside the text returns null and the header falls back to today's
first line (with its `…`, which then IS a fact about the source).

**Measured on the live server** (`probe lsp --json`, a temporary fixture beside
the Scratch and Tour files, since deleted): the stop lands on the `:` in every
case, and the rest text is
`example` (`example : 1 + 1 = 2`), `def twice` (`def twice : ℕ → ℕ`),
`instance` (`instance : Inhabited (Fin 3)`), `instance finInh`,
`lemma lem_add (a b : ℕ) {c : ℕ} [NeZero c] (h : a ≤ b)` (binders over three
lines, collapsed), `abbrev three` (no type spec, empty signature → the
`declId`'s tail), `example (n : ℕ) (h : 0 < n)`, `def withBinders (n : ℕ)` (no
type spec → the binders' tail), `theorem modded (n : ℕ)` (under a docstring,
`@[simp] private`), `example` (`example := by`, nothing but the keyword → the
head atom), `theorem infinitude_of_primes (N : ℕ)`,
`theorem sum_range_odd (n : ℕ)` (type on the next line),
`theorem tour_reading (n m : Nat)`,
`theorem tour_editing (a b : Nat) (h : a ∣ b) (hb : b ≠ 0)`. The name stops
give `example`, `def twice`, `instance`, `instance finInh`, `lemma lem_add`,
`theorem modded`, … and none for `abbrev three`/`example :=`, where the client
uses the sig stop.

**Too wide: a fade, not a glyph.** The resting span's `scrollWidth` against its
`clientWidth` is read by the header's own ResizeObserver (now also observing
the span), and only when it overflows does the span wear a 24px
`mask-image` to transparent — a fade on text that fits would eat its last
characters. Harness at 300px: `theorem tour_editing (a b : Nat) (h : a ∣ b)
(hb : b ≠ 0)` in a 224px box, faded.

**The hover is GONE.** A `▾` button at the band's right edge (a SIBLING of the
header, so the open overlay's scroll does not carry it and its click never
reaches the band's reveal-in-source) opens the overlay — styling, `maxHeight
60%` and scroll as before — and reads `▴` while open; in-page tip "Show the
full signature" / "Hide the full signature". It closes by the button, Esc (a
`signature` row SECOND in `layers`, after the tip: the overlay sits above every
popover), a capture-phase `pointerdown` anywhere not inside `[data-ptw-hdr]`
(a document listener rather than `bg`, which answers only the tree's
background), and a proof change (reset in the `proofKey` block, no effect).
Clicking anywhere else on the band still reveals. The open overlay no longer
stops at `right: 38` — that gutter was the zoom rail's when it hung at the top
right, and the rail lives bottom-right now — and both states pad
`HDR_BTN_LANE` (36px) on the right for the button, against the old 46px; the
vertical padding is unchanged, so the band is `HDR_REST_H` (29) at rest,
measured.

**The scope trail** drops its `…` and takes the name stop's text:
`theorem tour_editing › ◎ refine_1 ✕`.

**Harness checks** (`?stub-edit&hdr=…&hdr-name=l:c&hdr-sig=l:c`, new stubs; the
reveal stub now counts into `window.__reveals`): rest reads
`theorem sum_range_odd (n : ℕ)` at 29px; synthetic pointer/mouse enter on the
text opens nothing; `▾` opens (45px, `▴`, 0 reveals), `▴` closes, Esc closes,
a pointerdown on the tree closes, a click inside the open overlay keeps it open
and reveals once, a band click at rest reveals; the first node's screen rect
identical before, during and after all of it. Without `hdr-sig` the rest text
is today's `theorem sum_range_odd (n : ℕ) : …`.

## 2026-09-22 — The key-gated rows are hidden, not disabled

User direction: "Hide the API key-necessary stuff." The eye's `Reading options`
panel drew `polish` (C4) and `suggest a rewrite` (D6) DISABLED, with the reason
("no companion", "no API key", "the setting is off") in the title, on the
`goals as TeX` rule that a reader who has met a feature should find out where
it went. For a feature that needs the reader to have bought a key that rule
reads as an advert, so both rows are now NOT DRAWN unless their gate is open.
The gates are unchanged: `polishShown` = `onPolish && polishReady` (the widget
passes `ai.ready`), `proposeShown` = `onPropose && proposeReady` (`ai.ready &&
ai.propose`). While a suggestion is out the propose row stays drawn and is
disabled (`suggesting…`), as before. The eye's own title lists the two only
when they are drawn. `goals as TeX` (C1) is untouched: it is not key-gated, and
its disabled row is the seam's explanation.

Nothing is measured against the panel: `BarPanel`'s 196 is a `minWidth` and its
height is its rows', so a hidden row leaves no gap; `readingSlots` never
included either row. The not-ready titles (and the view's `polishWhy`/
`proposeWhy` props that carried the companion's `ai.why`) are gone; the widget
still parses `ai.why` off the theme file, unused. Nothing else the reader sees
was key-gated: no `nodeHints`/`?` row, toast or status-bar item names polish or
propose (the toasts fire only from the rows themselves). The companion's
settings and its `Ramify: Set narration API key` command are unchanged.

Harness: plain `/` — the panel reads `brief · merge · lints · to cursor · goals
as TeX`, no gap; `/?polish-stub&propose-stub` (the stubs set `polishReady`/
`proposeReady` true) — both rows back, `polish` live with the "shows in
Comments: narrate" title.

## 2026-09-22 — D1's `⤵`/`⤴` are drawn, not typed

`⤵`/`⤴` fell back to a symbol font and inked 12.3×12.1 px at the bar's 13px (raster, 8× offscreen, euclid's `have hpfac` bar) against `⊹` 7.9×8.0, trash 9.5×8.5, skip 6.3×10.5; now `InlineIcon` (one path mirrored for `⤴`, stroke 0.9, 7.6-unit span) inks 8.5×8.3, in the same 20px box. `⇓`/`⇑` (4.2×7.0) and `✎` (6.7×6.7, canvas `measureText`) are not oversized and stay text.

## 2026-09-22 — The moves say what they do; a `⋯` menu lists them; an experience preset fills the defaults

User problem: the automation and restructuring gestures ("write automation",
"show what this step used", `⁇ ⇓ ⇑ ⤵ ⤴ ✎`) were opaque — named after the
feature that implements them, reachable only by a glyph. Three changes, in
order, each gated (typecheck, lint, `counts narrate overlap order hopgap
rewrite`) before the next.

**B — name the step, not the feature.** `web/src/moves.ts` (pure) is the one
place the moves are worded, and it names the concrete tactic or hypothesis:
`⁇` "What did `simp` use?" / "Hide what `simp` used" / "Asking Lean what
`simp` used…" (the head word is the trace's `tactic`, else `tacticHeadWord` of
the label), `⇓` "Replace these N steps with automation", `⇑` "Write out what
`simp` used", `⤵` "Move `h` into its one use", `⤴` "Pull this `by` block out
as a `have`", `✎` "Apply the linter's fix: <LINT_FIXES sentence>", D5 "Rename
`h` to `hx` (Mathlib style)". Bar tooltips add one clause, "Lean checks it
first; nothing is written until you click the pill"; `⇓`'s says which
candidates are tried (the first four and `…`). The REWRITE TITLES in
rewrite.ts/rename.ts moved to the same words in lower case (`move `hM` into
`obtain``, `pull the `by` block out as `have this``, `replace these 4 steps with
`omega``, `write out what `simp` used`, `rename `h` to `hab` (Mathlib
style)`), so the pill, the D6 agent's primitive list and `probe rewrite` read
alike; `pillMove` capitalises and prefixes a lint's sentence. The pill: the
checking phase reads "… — checking with Lean…", the rejected title "Lean
rejected this change; nothing was written", and a COLLAPSE lost its step-count
clause (the user's example: "Replace these 4 steps with `omega` · ✓
elaborates" already says how many go). Toasts: "Can't replace these steps —
…", "Nothing to write out — …", "No linter fix to apply — …", "Lean could not
say what `simp` used". `GESTURES` (the `?` panel and every node `<title>`) was
reworded to match, and a duplicated tactic `branches` row (it printed twice in
the panel's Tactic section) was removed. `probe rewrite`'s output changed in
exactly its ten title strings; every count is unchanged.

**C — the `⋯` menu.** The last hover-bar button opens a menu of EVERY move on
the node, in B's words, with the gesture that reaches it without the menu
(`⌥-click`, `double-click`, `click +N`, `⌥-click the line`, `top-left
corner`…; nothing where the bar button — whose glyph heads the row — is the
only way). Unavailable moves are omitted, not greyed. Menu-only rows: a
ghost's restore, a goal's hide/`+N` restore, a tactic's show-in-source (click)
and edit (double-click), edit the comment, drop/remove a mark and write
`.mark`, and every D5 rename the goal's context lines offer (deduplicated —
a reflowed line answers twice). One `NodeMove[]` per node: the bar's array and
the menu-only array spread together, so a row runs the button's closure;
double-click's edit became `startEdit(li)`, called by both. Two things the
React Compiler lint forced, both recorded in the code: the bar's list is its
own array and is never `.filter`ed out of the combined one (a property read
over an array of ref-touching closures reads to the lint as a ref read during
render), and the menu-only list is an expression, not a helper function called
during render (the same objection, one level up). The menu is HTML, portalled
into the frame (`frameEl` state through a callback ref — no ref read) but
owned by the node, so it stops mouse events at its edge (React bubbles through
the portal into the node's `<g>` click and the scroll frame's marquee
mousedown). Positioned in a layout effect off the `⋯` rect taken at the click
(below it, above if no room, clamped in the frame), `TipLayer`'s idiom. The
keyed row is `idx` STATE and drawn lit — in the hidden pane, and whenever the
webview lacks system focus, `:focus` never matches, so a focus-only highlight
showed nothing — with DOM focus following it; ↑ ↓ Home End Enter Space, Tab
closes. Dismissal: Esc (`nodeMenu`, second in `layers` after the tip), a
pointerdown outside, any scroll or wheel, a proof change. The glyph is `⋯`
by user direction; the record's old objection (brief's rail glyph) no longer
applies — brief moved into the eye's panel and writes `…` (U+2026) in labels;
the only other `⋯` is a comment strip's "⋯ N more lines". Measured in the
harness: the menu opens with the node's screen rect and the scroll offsets
unchanged; ↓↓↓ + Enter on a `grind` picked "Write out what `grind` used" and
its pill read "Write out what `grind` used · ✓ elaborates"; Esc, an outside
pointerdown, a scroll and a proof change each closed it.

**A — `ramify.experience`.** `beginner | intermediate | expert`, default
intermediate (web/src/experience.ts `PRESETS`, the user-approved table):
hover-bar words on/on/off, the cursor's automation trace auto/click/click,
`⇓` hidden/offered/offered, lints on/on/off, Comments narrate/show/show,
Context all/used/used, brief off/off/on. The preset ONLY FILLS DEFAULTS: every
row the reader can toggle is a session OVERRIDE (`hypModeOverride`,
`commentModeOverride`, `briefOverride`, `lintsOverride`; the widget keeps its
own `lintsOverride` for `lintDecl`, both reading `PRESETS[experience].lints`),
the `polishOverride` idiom — a preset read late from the theme file changes
the defaults with no effect, and a row the reader set keeps its value. None of
the seven rows is a VS Code setting of its own, so the companion has no
explicit-vs-preset setting to arbitrate; it reads `ramify.experience` with
`inspect()` (the Output line says `(default)` when unset) and publishes the
name as `experience` in `theme-colors.json`; `ThemeColors.experience` in
Ramify.lean passes it through; widget.tsx parses it. `Ramify: Set experience
level` is a quick pick that writes the setting where the winning value lives
(Workspace if set there, else User). The harness takes `?experience=`. Note the
intermediate default turns `lints` ON, so the widget now asks `lintDecl` on
arrival (8–27 ms, cached per declaration) where it used to wait for the row.

Words on the bar: `BAR_WORDS` (moves.ts) — `used skip source focus all path
lens inline extract automate write out fix delete more` — drawn after the
glyph at `BAR_WORD_PX` 11 in the code font; `barCellW` is the ONE measure the
bar's width and each button's rect come from. The bar was already an overlay
(nothing reserves room) and is now up to ~300px wide, so it is KEPT INSIDE THE
FRAME by paint: a layout effect measures it against `[data-ptw-scroll]` and
writes a transform straight onto the `<g>` (never in the JSX). First try slid a
tactic's right-hung bar left and it covered the tactic's own label (measured
at a 560px viewport on `have hp1 …`); a right-hung bar that would cross the
edge now goes UP onto the box's top-right corner — the goal bar's place — and
only then slides left.

Beginner's auto-trace: the cursor's step is found on the BASE tree
(`tacticNodeAt(tacticTargets(baseNodes), highlightPos)`; the drawn tree is
downstream of the traces), only for `TRACEABLE_HEADS` (an `omega` has nothing
to show), fetched once per step per proof through `onTrace` (an effect that
issues a request and sets nothing; the answer lands in the caller's `traces`).
Open is DERIVED — `traceOpenNow` = `traceOpen` ∪ the cursor's step while its
trace is in hand, unless the reader shut it with `⁇` (`traceShut`, remembered
for the session). The relayout is anchored by the cursor chain as every
cursor-driven relayout is: measured on record 5, cursor 37→38→37→38 over a
`simp`, 76↔77 nodes, the step's screen rect unchanged at every stop.

Expert's brief default exposed a standing bug: rewrite.ts reads a step's head
word off its LABEL (`headWord(node.label) !== "have"`, the user's `uHead`),
and brief's E1 draws `have hp1 : …` as `… hp1 : …`, so brief mode silently
withdrew every `⤵`. `rewriteCtx.nodes` now carries `elision.original` as the
label; `⤵` on euclid's `hp1` is back under brief.

Screenshots (headless Chrome over CDP against the harness, euclid's
`have hp1`): the bar at each level and the menu open at intermediate. Probes:
`counts narrate overlap order hopgap` byte-identical to before; `rewrite`
differs only in the ten title strings. `./dev.sh --all` built the bundle,
`lake build Ramify`, `dist/`, and `dist/ramify-0.0.18.vsix`.

## 2026-09-22 — Marks survive an edit, ⌥ shows which ones it removes, and a fold's summary stays below

Three user-reported fixes, one mechanism each.

**Marks while editing.** Double-clicking a marked node made its tab vanish,
which read as the mark having been deleted. The cause was one guard: the tab
was drawn under `!hideForEdit`, the predicate that hides the box's own chrome
while the editor stands in for it. The editor is painted in a LATER layer (the
`editing && …` block after every node), so simply dropping the guard would
have put the tab UNDER the overlay. Now the in-node tab is suppressed for the
editing node (`!isEditing`) and an INERT copy is drawn after the editor's
`foreignObject`, in the same `<g>` and at the same `boxTop`: same place, same
ink, same fill for the stop being read, but `pointerEvents: none`, no
`<title>`, no ×, no click — measured in headless Chrome, `elementFromPoint` at
the box's top-left under the tab returns the TEXTAREA. Both are one component,
`TourTab`, so the two paints cannot drift.

**⌥ on your own marks.** ⌥-click takes a TEMPORARY mark off, and nothing said
so until you read the title. While ⌥ is held, every temporary tab draws a `×`
in place of its number; the author's (source) tabs do not change, since
⌥-click on them only jumps. The `×` is a PATH (half-arm 3, centred at the
pill's centre), never a glyph, so the pill stays exactly `tourTabWidth(n)` —
the rect `probe overlap` models. ⌥ state: the view had no such state
(`useAltHeld` lives in `ZoomRail` precisely so a modifier press repaints two
buttons, not the tree), and adding it to the view would re-render 12k lines on
every ⌥. So `altHeldStore` is a module-level external store read through
`useSyncExternalStore` by each `TourTab` — no setState in an effect, listeners
attached only while a tab is mounted. Sources as `useAltHeld`'s, plus one:
keydown/keyup `altKey` (focus only), `pointermove`'s `altKey` (arrives whatever
holds focus — in the infoview the caret is normally in the editor), cleared on
window `blur` so a missed keyup cannot leave a stuck ×.

**The fold summary jumped.** In `Comments: narrate`, an open goal's first step
wears its `∴` line in the TACTIC's strip, under the goal; folding the goal put
the summary on the goal's OWN strip, drawn above the box — "∴ Give hp" under
`⊢ Nat.Prime p`, then "∴ Give hp, giving Nat.Prime p" above it. Two changes:

- `TreeNode.commentBelow`, stamped by `applyNarrationLines` on a goal with
  `folded.kind === "fold"` and a GENERATED strip only (an author's comment on a
  goal is never in the narration map, so it stays above). A HOP keeps its
  summary above: the run below a hopped goal belongs to the axis break and its
  caption (`TRUNK_GAP_HOP`), and a strip there would need the run widened
  again. Layout reads the flag through one coding in layout.ts: `belowH`
  (lines + `BELOW_GAP` 14, the trunk step gap, so in stacked the line lands
  EXACTLY where the first step's strip was — screenshot pair below, same pixel
  row), `bandTopH` (leaves it out), `inkExtent().down`, `nodeSpan().y1`, the
  trunk's `bottom`/`boxBottom`, `commentStripTop` (the strip's top relative to
  the node's y — the three strip paint sites and the comment editor now all
  call it, where each carried its own copy of the float arithmetic) and
  `commentIndentOf` (`COMMENT_INDENT` for a below strip, root goal included —
  where the child's strip started). Wide: Sugiyama centres the whole reserved
  height, so the placed `y` is lifted by `belowH/2` and the ink is centred on
  the layer as before. Aside modes (spine, tracks): a below strip reaches right
  into the lane where tactics float, and a floated tactic strip hangs ABOVE its
  tactic into the gap — `probe overlap` found 2 collisions in spine on the
  wrap record (`goal_15_50` × `tactic:goal_15_55`'s strip), fixed by raising
  `trackFloor` past the below strip exactly as an aside tactic's box does.
- The `, giving <statement>` clause is dropped where `<statement>` is the goal
  the summary is WRITTEN ON: `summaryOfGoal(…, own)` from `summarize` narrates
  its direct steps without `withGoal`; `hopSummary` does the same for a hidden
  step whose parent is the hopped goal. Deeper goals keep the clause (the
  statement is folded away there). Corpus effect, `probe narrate --print`: one
  line, `ledger:80:2`, which was "Give key n, giving <the ledger's own four
  lines>; then Give parity n, giving …" and is now "Give key n; then Give
  parity n; then Give gap n; then Give residue". Coverage unchanged (244/244,
  residue 0).

`probe overlap` now models the strip at `commentStripTop` (not its own copy)
and treats a BELOW strip as checked paint; it also sweeps fold-only trees in
narrate mode, where the below strip exists — layouts checked 2300 → 4870
(2600 below strips seen), overlaps 0. `.none` fold notes are unaffected (they
ride `folded.note` and the `<title>`, not a strip); hop captions are unaffected
(hops excluded above; `probe hopgap` unchanged). `counts order hopgap rewrite`
unchanged.

Screenshots (headless Chrome over CDP against the harness, `?stub-edit`):
`c-expanded.png`/`c-folded.png` (infinitude_of_primes, `⊢ Nat.Prime p`, the
line at the same place), `a-editing-tab-visible.png`, `b-alt-held-x.png`,
`b-alt-held-source-vs-temp.png` (odd_sums: source `2` unchanged, temp `×`).

## 2026-09-22 — The hover bar is icons only, the reader picks its buttons, and the hyp → origin connector is opt-in

User feedback, on a screenshot of the bar reading `» source  ◎ focus  ⊹ path
⋯ more` across the node below it: "Text buttons way too aggro: intrusive and
overlapping nodes. Source focus skip path delete more should be there by
default as icons. More gives icon explainer. Needs to be some way for users to
set which they want on which nodes. Also drawing path from a hyp to its
introducing goal should probably be off by default."

**Icons only, always.** The icon+word bar (the `ramify.experience`
beginner/intermediate row `barWords`, `BAR_WORDS` in moves.ts, `barCellW`,
`BAR_WORD_PX/GAP/PAD`, the `word` field on `NodeAction`, the word `<text>` in
`NodeActionBar`) is DELETED, not left dormant: every button is one `BAR_BTN`
square again and the bar's width is `n·BAR_BTN + (n−1)·BAR_GAP + 2·BAR_PAD`.
The `⋯` menu is where a glyph is put into words.

**Which buttons: an id list per node kind.** moves.ts `MOVE_IDS` names every
bar-able move — `source focus skip path delete trace collapse expand inline
extract lint lens goal` (that order is the `⋯` menu's) — and `DEFAULT_BAR` is
the user's `source focus skip path delete`. `⋯` is always last and is not in
any list. Each move is still drawn only where it is available on the node
(focus on goals, skip where `stepCut` offers it, …). `»` is now on the TACTIC
bar too (a tactic's plain click already revealed, and the menu carried a
separate click-only row for it, now gone — `source` is one move with a
kind-dependent closure and shortcut). Off the default bar and into `⋯` alone:
`⁇ ⇓ ⇑ ⤵ ⤴ ✎`, `⧉` (the LENS — the tactic opened in a slim editor group below
the infoview) and `+` (show the goal a ledger step proves; its row click does
the same). The view resolves the list as pin (session) → setting → preset, the
override idiom. In render, `movesFor(id) → NodeMove[]` is one `switch`; the bar
is `barIds[kind].flatMap(movesFor)` and the menu `MOVE_IDS.flatMap(movesFor)`
plus the menu-only rows — ids are mapped, moves are never filtered (the
compiler-lint rule from the menu's first entry), and the lint is clean.

**Settings.** `ramify.hoverBar.tactic` and `ramify.hoverBar.goal` (package.json,
arrays of the enum above, `uniqueItems`, default `DEFAULT_BAR`). The companion
reads each with `inspect()` and puts it in the theme file's `hoverBar` ONLY
where the reader set it (workspace-folder/workspace/global value), else `null`,
so an unset list leaves the preset in charge and a set one wins; the log line
says `(preset)` for an unset list. `ThemeColors.hoverBar` in Ramify.lean is a
`Json` pass-through; widget.tsx `parseBarList`s it (known ids, each once).
Presets: beginner's TACTIC bar is `source focus skip path trace delete` —
"what did `simp` use?" is the question a beginner is asking of automation,
and beginner already auto-opens the cursor step's trace; intermediate and
expert use `DEFAULT_BAR` for both kinds (expert gets no extra: an expert who
wants `⇓` on the bar pins it once). Harness: `?hoverbar-tactic=` /
`?hoverbar-goal=` (comma-separated ids; empty = `⋯` alone).

**Pins.** Each `⋯` row that is a bar move carries a push-pin toggle at its
right (filled = on this kind's bar; `aria-label` "Show on the bar for tactics"
/ "Take off the bar for goals", through the in-page tip). A pin is its own
`<button>` beside the row's (a button inside a button is not one), leaves the
menu open, applies at once (`pinOverride`, per kind, session state), toasts
"On the bar for tactics", and calls `onHoverBarChange(kind, ids)`. Pinning
APPENDS — the new button lands just before `⋯`, beside the menu it came from;
unpinning keeps the others' order. The widget sends it as `popoutEdit` with
`action: "hoverbar"`, `setting: kind`, `values: ids`, and the server routes that
action to its OWN FILE, `settings-request.json`, for `rename-request.json`'s
reason: the pin is clicked with the pointer on its way back over the tree,
whose hover `highlight`/`clear` lands in `popout-request.json` a moment later.
The companion writes `ramify.hoverBar.<kind>` where the winning value already
lives (Workspace if set there, else User), the `setExperience` rule, and the
config listener republishes the theme file. Offline, `window.__hoverBar`
records each `{kind, ids}`.

**The hyp → origin connector is OFF.** B2's hover (context line → dashed
connector to the introducing step + that step's wash) is now a `Reading
options` row, `hyp origins`, default off at every experience level and not a
preset row (session state, no setting). `hypOriginHit` returns null while it is
off, which removes both the connector and the wash; the dwell effect is
untouched. The line's `<title>` still names the origin; the `?` panel's row
says both halves. Paint only, so nothing moves.

Measured (headless Chrome over CDP, `?stub-edit&trace-stub`, every node of the
first proof, 75 nodes, pointer on each box): the new bar overlaps another node
box on 0 nodes; so does the old icon bar reconstructed at the same anchor from
the same node's available moves (0). Average buttons per bar 4.4 against the
old icon bar's 4.1 — the harness has no lens, so `⧉` is missing from the
"old" figure; in the widget the new bar is one button SHORTER on a tactic
(`⧉` out, `»` in) and shorter still on any step offering `⁇ ⇑ ⤵ ⤴ ✎ ⇓`. Probes
unchanged: `counts` ALL OK, `narrate` 251/251 residue 0 (the corpus's figure
since today's earlier regeneration, not this change), `overlap` 0 over 4870,
`order` 0 over 1384, `hopgap` min 34/34/34/43, `rewrite` ALL OK. Companion
0.0.19. Screenshots in the session scratchpad `shots/`:
`1-tactic-bar-default.png`, `2-goal-bar-default.png`, `3-more-menu.png`,
`4-more-menu-after-pin.png`, `5-tactic-bar-after-pinning-trace.png`.

## 2026-09-22 — The signature header is greedy, and its chevron is a control

User report, on `infinitude_of_primes` in a wide panel: the header read `theorem infinitude_of_primes (N : ℕ)` with a tiny `▾` at the far right, while the whole `… : ∃ p, Nat.Prime p ∧ N < p` would easily fit — "the dropdown icon here is way too small. And we should be greedier with showing the type signature. The whole one can fit here so it should."

The 2026-09-17 option 1 ("at rest show keyword + name + binders only") was a rule for the NARROW case taken as the rule for every case. Now the resting line is the LONGEST of three cuts that fits:

1. the whole signature up to the body — a new server stop, `declHeaderBodyStop`, the start of the first `declValSimple` / `declValEqns` / `whereStructInst` in preorder (by KIND: the `:=`, the first `|`, or `where`), so the `: type` is shown and `:= by` never is (the body's opener says nothing the tree below does not);
2. keyword + name + binders (`declHeaderSigStop`, as before);
3. the first-line fallback with the right-edge fade.

The decision is `measureText(full, NODE_FONT_PX) <= hdrW − 2·HDR_PAD_X − 1` — the tree's own canvas measurer (same code font, same px) against the band's width, which the existing ResizeObserver already holds in `hdrW` state; no new effect, no setState in render. Measured in the harness: at 486px the full text inks 455 of 466 available; the switch happens at ~476px of band. The header is one `pre` line in every state, so its height is 29 either side of the threshold (measured at 534/526px viewport) and nothing below moves.

The chevron is drawn ONLY where something is hidden (or to close the open signature): where (1) fits there is nothing to open, the button is not rendered and the right padding drops from `HDR_BTN_LANE` to `HDR_PAD_X`. The text `▾` at 11px inked about 5px at opacity 0.6; it is now `HeaderChevron`, a drawn SVG at 12×7 ink in `LAYOUT_GLYPH_SW` (1.4, the status bar's stroke) in a 20×28 box at opacity 0.75 (0.95 open), labels "Show/Hide the full signature" through the in-page tip layer as before.

Wire: `declHeaderBodyStop : Option Lsp.Position` in `ProofTreeData` (Ramify.lean), `Proof.declHeaderBodyStop` + `stableProofOf` (paperproof.ts), widget.tsx's `ProofTreeData` and the view prop. The NDJSON carries no header (as before), so the corpus is untouched and `gen.sh` was not run; the harness stubs it with `&hdr-body=l:c`. Live check: `probe lsp ../lean/ProofTreeScratch.lean 11 4 --json` gives `declHeaderBodyStop {line 10, character 64}`, the `:=`.

## 2026-09-22 — Taste pass: one ink, one face, one radius, one stroke, one voice

User request: "Run a consistency and taste pass over anything that gets rendered to the screen. Intuitive and simple + straightforward design language." The rules it produced are in CLAUDE.md's **Design language** paragraph; this entry is the evidence and the changes. Measured in the harness over CDP (headless Chrome, 2×, `?stub-edit&trace-stub`, light and dark, 1100 and 420 px), glyph inks on an 8× canvas.

**The dark harness was a light product.** Every floater read `--vscode-editorWidget-*` / `--vscode-icon-foreground` / `--vscode-toolbar-hoverBackground` / `--vscode-list-activeSelectionBackground` straight, each with a LIGHT literal fallback (`#cbd5e0`, `#2d3748`, `rgba(255,255,255,0.97)`, `#f7fafc`…), 36 sites in ProofTreeView.tsx, 3 in tip.tsx, 2 in helpPanel.tsx. Where the host does not set them (the harness, any host that omits them) a dark theme drew white status bar, rail, hover bar, menus and tips with dark ink. Now theme.ts owns `--ptw-chrome-bg/-border/-ink/-btn/-lit` and `--ptw-focus`, each wrapping the SAME host variable with a fallback derived from `--ptw-bg`/`--ptw-fg` (`CHROME_*` exports); inside VS Code nothing changes, since the host variable still wins. `FLOATER_CHROME` (POPUP_CHROME + border + ink + face) is what `MENU_PANEL` and the tip spread.

**One face.** The status bar, menus and modal banner said `system-ui, sans-serif`, the tip `var(--vscode-font-family, …)`, the toast `monospace` — three faces for one kind of thing, and the toast repeated the bar's own words (`Layout · spine`) in a different font from the bar. All chrome is `CHROME_FONT` (the host face), the toast with `tabular-nums` so an anchored `n/N` keeps its width. widget.tsx's loading/relay-error lines too (and `#888` became `--vscode-descriptionForeground`). Lean text stays in the code font; the hover bar's and rail's glyphs stay `monospace`, because every ink measurement in this record was taken there.

**One radius, two opacities, one shadow.** HTML chrome radius 3 everywhere (`CHROME_RADIUS`) — the modal banner (4) sat directly above the toast (3) in one column, and the status card (4) beside the rail's buttons (3). Node radii were written twice (box and in-place editor); now `nodeRx`. Disabled was 0.35 on bar items, rail and chevrons and 0.4 on menu rows → `DISABLED_OPACITY` 0.35; secondary text ranged 0.5 / 0.55 / 0.6 / 0.65 → `DIM_OPACITY` 0.6 (header `…`, scope `›`, completion kind, menu shortcut, width readout, dimmed values). The completion list's shadow (0.18) takes the popovers' own.

**One stroke in the chrome.** The eye drew at 1.2, the comment/width marks at 1.25, the layout marks and the header chevron at 1.4: `LAYOUT_GLYPH_SW` is renamed `BAR_GLYPH_SW` and every drawn chrome mark uses it (screenshots at 420 px: the compact row now reads as one weight). The hover bar's in-tree icons keep 0.9, now named `HOVER_ICON_SW`.

**Glyphs that inked off-size.** `»` (on every default bar) inked 6.0 × 5.9 at the bar's 13px against `◎` 7.9, `⧉` 8.9 and the drawn icons' ~8.5 — the `⊹` rule had never reached it; `SOURCE_GLYPH_PX` 17 (≈ 7.8). The diagnostics marks came from three fallback faces: in the bar's 11px UI face `⨯` inked 3.7 px against `⚠` 9.0 and `◇` 10.5 — the error was the smallest mark in the row. `DiagGlyph` draws all three (~8 px, `BAR_GLYPH_SW`) in the bar item and the node's diagnostics popover; native `<title>`s keep the text glyphs.

**Voice.** Context titles now name their value like Layout's (`Context: used — …`); all-caps emphasis left the UI strings (`GENERATED`, `SAME`, `AUTHOR's`, `KIND`, `AND`, `PEEKED`, `SOURCE`, `WHOLE`); native titles start upper-case (`Collapse this comment…`, `Show the rest…`, `Being written in the buffer…`, `Branch 2 of 3…`, `Click to dismiss`); `(or Esc)` → `(Esc)`; `Can't` → `Could not`; `Escape` → `Esc`; `->` → `→`; `E.g.` inside a note → `e.g.`. The width toast said `Width · off` while the bar said `Width: full` — now `Width · full` (and, after the follow-up below, `Width: full`). Menu shortcuts name their target (`double-click the strip`, `click the corner`, beside `⌥-click the corner`). The `?` panel's hover rows were stale since the icons-only bar: the tactic row promised `⧉ lens` (now in `⋯`) and was gated on the lens capability; both rows now list the default bar (`» reveal, skip, ⊹ path and the trash can`; goals `» reveal, ◎ focus, ⊹ path and the trash can`) and the tactic row is no longer gated. Narration joined clauses as `…; then This is exactly …` — `continueClause` lower-cases the opening WORD of a clause after `; then ` (a plain capitalised word followed by a space, comma or colon only, so `Nat.Prime …` is untouched).

Not applied — judgment calls, restyles, or recorded choices — are listed in the session's `taste-pass.md` (radio vs checkbox rows, `?`'s accent, the toast separator `·` vs the bar's `:`, the `(⚑)` in mark toasts, literal backticks in tips and menus, the goal corner `−`'s hit target, among others).

Probes: `counts` ALL OK, `narrate` 251/251 residue 0, `overlap` 0 over 4870, `order` 0 over 1384, `hopgap` min 34/34/34/43, `rewrite` ALL OK — unchanged, as nothing measured moved (every size change was paint inside a fixed box, or a bar glyph the ghost measures).

## 2026-09-22 — Taste pass, applied: row looks, lit items, one toast form, code spans, a corner you can hit

The eight proposals the taste pass left open (`taste-pass.md`), all approved ("Go").

**Pick rows and toggle rows look different.** `BarRow` takes `kind: "pick" | "toggle" | "action"`. Pick rows (Layout's four, Context's four, Comments' four) keep the `●/○` radio; toggle rows (every Reading option, both Marks lists, and the modifiers under a divider — side-by-side, gallery, `Split data & props`) wear `BarCheck`, a drawn 7px square at `BAR_GLYPH_SW` with `rx` 1.5: outline at the radio's resting 0.45 when off, filled `RAIL_PRESSED` with an `ACCENT_TEXT` tick when on — the radio's two states, squared, so it is the same ink in light and dark. `suggest a rewrite` is an ACTION (it asks once) and wears neither — a blank 12px slot, so its label stays in the column. The rows gained `role` `menuitemradio`/`menuitemcheckbox` + `aria-checked`.

**Every bar item is lit while its own panel is open**, as `?` always was: `accent={it.accent || barOpen === it.id}` on the value items and `barOpen === "reading"` on the eye. The standing accent rule is unchanged — only Width lights for a setting (`effReflow !== "off"`); Layout, Context, Comments, Marks and the eye light only for the panel. Paint only: the accent is a background, and the ghost measures no background.

**Toasts speak the bar's form.** `Layout: spine`, `Context: used`, `Comments: narrate`, `Width: 44 col` / `Width: full`, `Brief: on`, `Merge: off`, `Lints: on`, `Polish: on`, `To cursor: off`, `Side-by-side: on`, `Gallery: off`, `Hyp origins: on` — and `Split data & props: on`, which had no toast at all. `Marks: …` already had a colon. This reverses the recorded `Layout · tracks` form (the 2026-09 toast paragraph above is amended to say so); `·` stays the LIST joiner (rule 9).

**No ⚑ where there is none.** `Mark dropped (⚑)` → `Mark dropped` (and `… — temporary list on`): marks on a node are numbered tabs and a dashed nub. The ⚑ is still the Marks bar item's glyph, the one place it is drawn.

**Backticks: one rule, `ticks.ts`.** `plainTicks` strips a `` `…` `` span's ticks (a pair on one line; a lone tick, a Lean name literal inside quoted code, is left); `CodeText` (codeSpans.tsx — a separate file only because react-refresh wants a component module to export components) draws the span in the editor's code font at 0.94em with no chip. Drawn as code: the `⋯` menu's rows and shortcut column (`What did omega use?`, `Write a .mark into the source`), the `?` panel's rows, notes and section titles (`textTransform: none` on the code, since the titles are upper-cased). Stripped: every in-page tip (in `useTip().props`, `BarButton`, `BarRow`, the hover bar's `aria-label` — the accessible name loses the ticks too — and once more in `TipLayer`), the node `<title>`'s UI sentences (hints, the trace's `via` line, diagnostics; NOT the label, tactic lists or arm patterns, which quote the source), the nub's title, and the proposal pill — which is code font throughout, so a span could not be told apart by face; `chipWidth` measures the stripped string it paints.

**The goal corner is a target.** The `−` was a 12px text dash (≈ 7 × 1 px ink) and its only hit target. Now a DRAWN stroke, `CORNER_MINUS_W` 8 at `BAR_GLYPH_SW`, centred where the dash's ink was (x `w/2 − 8`, y `boxTop + 8`, the top line's x-height middle), so its right end is where the dash's was; and one invisible `[data-ptw-corner]` rect, `CORNER_W` (22) × `CORNER_HIT_H` (18), at the box's top-right — exactly the top-line reserve `sizeOf` already makes, so it lies over no text and nothing is re-measured. The rect carries the cursor and the `−` face's fade preview (moved off the glyph, which is now `pointerEvents: none`); the click stays the goal's own (a goal's click folds/opens). `+N` is unchanged (same x, same anchor). `probe overlap` 0, `order` 0 — unchanged.

**The keyed `⋯` row is its fill alone.** `MENU_ROW_CSS` now sets `outline: none; box-shadow: none` on `:focus` and `:focus-visible`; DOM focus still follows `idx` (measured: the focused element is the lit `menuitem`, outline `none`, shadow `none`).

**Copy and small things.** The tactic `»` title `Show in source (click)` → `Show in source — or click the box` (the goal's `(⌘-click)` → `— or ⌘-click the box`, parallel). `wide`'s title lost `Sugiyama` (`nodes at the same depth share one horizontal band`). A lint diagnostic leads with the linter's own words and ends its first line `(linter: unusedTactic)` — the pager shows the first line, and it used to open on the id. `linter.flexible`'s fix sentence: `write out what simp used, so later steps do not depend on it`. The `?` panel: `the elaborator says` → `Lean says`, `Alectryon flags` → `Source flags`. The `⋯` menu's pin draws at `HOVER_ICON_SW` 0.9 (was 1.1; checked at 2× — it reads). The width readouts (`44 col` on the seam drag and in the width panel) speak `CHROME_FONT` with `tabular-nums` (they are chrome; the seam readout's 54px rect still holds `100 col`).

**Dismissal audit.** The `⋯` menu and the tip already closed on press/scroll/wheel. The bar's panels, the `?` panel and the open signature did not close on a wheel: one effect now closes all three on a `wheel` anywhere outside `[data-ptw-panel]` / `[data-ptw-hdr]` (the `?` panel and the signature scroll their own content). NOT on `scroll`: a toggle row leaves its panel open, and the anchored relayout it causes scrolls the frame programmatically — measured, `brief` toggled with the panel open keeps it open. Harness (CDP, both themes): Layout, Reading options, Width and `?` all close on a wheel over the tree; `?` stays open on a wheel over itself.

Screenshots (2×, light and dark): `scratchpad/shots/taste2-{light,dark}-{reading,marks,layout,context,toast,tip,menu-omega,corner,corner-hover,corner-folded,help}.png`.

Probes: `counts` ALL OK, `narrate` 251/251 residue 0, `overlap` 0 over 4870, `order` 0 over 1384, `hopgap` min 34/34/34/43, `rewrite` ALL OK — no number moved.

## 2026-09-24 — C1 punted; a smaller header chevron and goal corner; hover previews wait the tip dwell

Four requests, prepared for the public repository (so nothing dead is left behind).

**C1 (goals as TeX) is PUNTED, and the seam is gone.** Upstream LeanTeX does not build on v4.32.2 (the three incompatibilities in the 2026-09-09 entry) and half of what the fork prints reads worse than Lean's own print. The user will talk to its authors; failing that, a custom printer gets built later. Until then an always-empty field and a disabled row are dead weight in a public tree, so both went: `ProofTree.LatexGoal` and its doc block (ProofTreeComments.lean), `ProofTreeData.latex` (Ramify.lean), `resultToJson`'s `latex` parameter and its non-empty-only write (Ppharness.lean), `Proof.latex?` / `LatexGoal` and the `stableProofOf` line (paperproof.ts), and the Reading options' disabled `goals as TeX` row with its title and comment (ProofTreeView.tsx; two comments that cited it as the measured disabled-row case now say it generically). widget.tsx's `incoming` never carried the field and no client code read it. `gen.sh` was NOT run: the field was written non-empty only and was always empty, so `grep -c '"latex"' web/public/sample.ndjson` is 0 — the corpus never carried it. The roadmap's C1 now reads "punted" with the same reason; the idea (a reading form beside Lean's print, bundled KaTeX) is kept there, and the 2026-09-09 entry keeps the spike's detail for whoever picks it up.

**The header chevron, smaller.** 12 × 7 ink (the 2026-09-22 fix for a `▾` that inked ~5px) read too big — louder than the signature it opens. Now `HDR_CHEVRON_W` × `HDR_CHEVRON_H` = 8 × 5 ink, same `BAR_GLYPH_SW`, about the header's lowercase x-height; the hit box stays `HDR_BTN_W` 20 × 28. The measurer is untouched because it never measured the ink: the lane (`HDR_BTN_LANE`) reserves the BOX, and `hdrFits` tests against `HDR_PAD_X`. Measured in the harness at 380px: button 20 × 28, svg 8 × 5.

**The goal corner `−`, quieter.** `CORNER_MINUS_W` 8 at `BAR_GLYPH_SW` 1.4 → 6 at `CORNER_MINUS_SW` 1.15, in the node's stroke ink as before, same centre (x `w/2 − 8`, y `boxTop + 8`). It is in-tree ink, not chrome, so it no longer borrows the chrome's stroke; at 2× beside a folded `+5` it now reads at the numeral's weight. The invisible `[data-ptw-corner]` hit rect is unchanged (`CORNER_W` 22 × `CORNER_HIT_H` 18), `+N` is unchanged (same x, anchor and font), and nothing measured moved.

**Hover previews wait the tip dwell.** Hovering the trash can, the goal corner's `−` or ◌ dimmed what the click would take IMMEDIATELY, so a pointer crossing the hover bar on its way elsewhere flashed half the tree. Every hover preview that dims or washes nodes now waits `TIP_DWELL_MS` (1000, imported from tipController.ts — one constant for "the pointer has come to rest") and is dropped if the pointer leaves first. Mechanism: `afterDwell(show)` / `cancelDwell()` in ProofTreeView, ONE timer in a ref (the pointer is over one control at a time), armed in the pointerenter handler and cleared in pointerleave, on the gesture's click (`elideStep`, the trash's arming), on the node's own leave, and on unmount; render never reads the ref, and nothing is set in an effect. The hover bar's buttons, `BarButton` and `BarRow` now fire `onHover` from POINTER events (beside the tip's own), and the corner rect carries `onPointerEnter`/`onPointerLeave`/`onPointerDown` — leave and press are wired on BOTH faces, since the press folds the goal and a `+N` face with no leave handler would have stranded a preview or a pending dwell. Audit of the other hover previews: the `brief` row's wash (hovering the row paints what brief would elide) now waits the same dwell; the used-hyp wash and the hyp-origin connector already dwelt at `HYP_LIT_DWELL_MS` 350 in an effect's timer — ALIGNED to `TIP_DWELL_MS` and the separate constant deleted, so the tree has one hover timing. Left immediate, deliberately: the ⌥-held skip preview (a held modifier is an ask, not a pointer passing through) and the `⤵`/`⇓` hovers, which light the EDITOR's range rather than any node. Measured in the harness over CDP with real `Input.dispatchMouseEvent` moves: corner `−` 0 dimmed at 300 ms, 24 at 1100 ms, 0 after leaving; left at 300 ms → 0 at 1300 ms. Trash: 0 / 24 / cancelled 0. ◌ (odd_sums had only single-step skips, whose extent is the anchor alone, so proof 3): 0 / 2 / cancelled 0. `brief` row: the tree's SVG unchanged at 300 ms, grown at 1100 ms.

**A probe race, fixed in passing.** `probe lsp … 28 2` crashed intermittently (`r` undefined): the reader treated a server-to-client REQUEST whose id happened to equal a pending client id as that call's response. `lsp.mjs` now resolves a pending call only on a message without a `method`. Five runs clean after.

Probes: `counts` ALL OK, `narrate` ALL OK residue 0, `overlap` 0 over 4870, `order` 0 over 1384, `hopgap` min 34/34/34/43, `rewrite` ALL OK. `lake build Ramify` and `ppharness` build; `probe lsp ../lean/ProofTreeTour.lean … --all` returns every tour declaration. Screenshots (2×): `scratchpad/shots/punt-{header-380,header-chevron-zoom,corner-zoom,corner-plusN-zoom,reading-options,corner-dwell-1100,dwell-delete-1100,dwell-skip-1100}.png`.

### 2026-09-24 — The `?` panel, stripped

User direction: "Aggressively strip the help popover prose. Items and descriptions; half of that is intuitable." `GESTURES` (gestures.ts) went from ~55 rows, many carrying a second-line `note`, to 17 one-line rows in seven sections (Goals, Tactics, Marks, Dashed boxes, Comments, Background, Keys). What went: every `note` (the field is gone), every row for a hover-bar icon (`⊹ ⁇ ⤵ ⤴ ⇓ ⇑ ✎ +` and the trash — each has its own tooltip and its row in the `⋯` menu, which is the icon explainer), every `hover` row (a tooltip explaining a tooltip), the frontier chips (labelled buttons), `Comments: narrate` (the bar's own tooltip), the background click, the ghost hover. The mark rows, previously repeated under Goals and Tactics, are one `Marks` section. `says` stays in title form (`click to fold …`) because `nodeHints` still feeds node `<title>`s from the same list; the panel drops the leading `to `. Ten `NodeGates` fields no row reads any more (`pathable`, `isPathRoot`, `automation`, `traceOpen`, `linkGoal`, `inlinable`, `extractable`, `collapsible`, `expandable`, `lintFixable`) were removed with their setters, along with five the earlier trim orphaned (`proseLabel`, `hypOrigins`, `usesHyps`, `usesLemmas`, `branches`). A node's title therefore no longer lists its bar moves — the bar and `⋯` say them.

Follow-up the same day (user report: "ellipses are no good"): the input column was a fixed 132px with `text-overflow: ellipsis`, which cut `⌥-click a context line` to `⌥-click a contex…`. The panel is now ONE grid (`max-content minmax(0, 1fr)`) across every section, so the input column is the longest input's width and nothing is cut; the panel went 420 → 500px (`86vw` cap) so the descriptions mostly hold one line. Merged back, one clause each, the facts from the old prose that are not guessable: edit keys (Enter / ⇧Enter / `\alpha` → α), the skip's break naming what went, `.mark 3` ranks, a mark's fold opening only while it is read, Esc backing out most recent first, rename touching only a generic `h`/`this`, and two legends — `§`/italics (hidden because the source asked) and `∴` (written by Ramify, not the author).

## 2026-09-24 — The diagnostics item counts; the messages get a strip of their own

**Report.** The status bar's diagnostics pager drew the first diagnostic's first line, truncated to whatever the row left: `◇ This lin…` for Mathlib's `style.longLine` lint, the words only in the tooltip. Unreadable. User direction: "keep count then add a secondary status bar over the status bar tinged color-wise to denote transient help-dialogue. On by default for serious stuff, optional open from lower status bar for other stuff."

**The item counts, never quotes.** `DiagCountItem` draws per-severity counts (`✕ 2 · ⚠ 1 · ◇ 3`) in the drawn `DiagGlyph`s and each severity's ink. Each count reserves two tabular digits (`minWidth: 2ch` + `tabular-nums`), so 1 → 12 moves nothing; a severity appearing or going is a real change and does. It used to be a shrinkable `flex: 0 1 auto` block outside `fit`'s arithmetic (the row squeezed it into the stub); now it is `flex: none` and IN `need`: the ghost carries the very element (`data-g="d"`), so measurer and renderer are one. At a ~380px frame the full form did not fit beside the all-glyph row (it clipped `?` — measured), so there is a COMPACT form (`dc`: the worst severity's glyph and the TOTAL, `✕ 3`), chosen by `fit` only where the all-glyph row cannot hold the full one — the counts compact LAST, after every value item has gone to its glyph. The dodge floor is taken with the compact form (the old item could shrink to nothing, so this is the nearest equivalent). Reserving the widest plausible form (all three severities at two digits, ~105px) was considered and declined: on a thin panel it would push every value item to its glyph for counts that are almost never all present. Tip: `2 errors, 1 lint — click for the messages` (`… — click to close the messages (Esc)` while open). Lit while the strip is up (design rule 13: the strip is this item's panel).

**The message strip.** `DiagStrip`, a child of the status card at `left: 0; right: 0; bottom: 100%` + `LANE_GAP`, so it has the card's horizontal extent in all three placements with no geometry of its own. Tinted per severity by new tokens (`--ptw-diag-{error,warn,lint}-wash` = 13/13/11% of `--ptw-danger`/`--ptw-warn`/`--ptw-comment` mixed into `--ptw-chrome-bg`, so it stays opaque over the tree and the chrome ink stays readable on either side of the luminance split; `-edge` is the ink whole, a 3px left border). Content: glyph, the message's FIRST line (`(linter: …)` untouched), wrapping, clamped at 3 lines with the whole message in the tip; `‹ n/N ›` when there are several; a drawn `×`. The message click is the old pager's (`revealNode` + `revealAt`). No enter fade: a hidden webview runs no animation frames and an opacity animation could have stuck at 0. The bar's panels and `?` still hang from the card's top and paint OVER the strip (later in the card's DOM) — the most recently opened thing wins.

**When it opens by itself — a derivation.** Open iff (the reader opened it on THIS proof: `diagStripPinnedOn === proofKey`, so a proof change closes it with no reset) OR (the proof has an error AND the error set's key — the error diagnostics' `key`s, which are severity + position + message prefix, joined — is not `diagDismissed`). `diagDismissed` is written only by the close gestures (`×`, Esc, the item's click while open). So a NEW error re-opens the strip; a dismissed set stays shut across re-elaborations. With nothing left to show a reader's pin is let go by a render-time adjust (so the next lint does not arrive open). **Errors only are serious**: a warning is most often `declaration uses 'sorry'`, the author's own choice mid-proof, and a lint means the proof checks. Where no problem has been picked the strip shows the FIRST ERROR (it is what opened it), else the first problem in source order.

**Esc and the rail.** `diagStrip` is a `layers` row after the prompts (an armed delete or a pending proposal is the more urgent thing for Esc) and before `selection`; `bg: false`, since an error that opened itself must not close on a stray canvas click; its `up` is read through `upNow` because the derivation sits below the table. The rail's `lifted: boolean` became `lift: number`, reported by `fit` via `StatusBar.onPlace`: 0 beside the button, `BAR_H + LANE_GAP` for a filling card, plus the strip's measured height + gap when the strip is up (the filling card's strip spans the frame under the rail's column). Measured in the harness at 420px: strip top 673, rail bottom 660; at 1100px the right/centre card keeps the strip clear of the rail's column by the button's reserve and the rail does not move.

Harness: `?diag-stub=ewl` (App.tsx) — one letter per diagnostic on the proof's steps: an error whose first line is long enough to wrap, `declaration uses 'sorry'`, and a `style.longLine`-shaped lint.

## 2026-09-24 — The bar sheds names before words; Width, reset and an empty Marks leave it

**Report.** "Symbol-slop moved from the rail to the status bar — only Layout and Context are labelled at half-width infoview." At a ~560px frame the row read `Layout: outline · Context: used · ▢ · ↔ · ⚑ ‹ › · eye · ↺ · ?`: two items in words and a run of icons whose meaning lived only in their tips. Approved plan A + B, plus "reset to the rail".

**A — three forms, two stages.** A value item is now drawn `Name: value` (FULL), `value` (VALUE), or its glyph (GLYPH). The ladder is stage-wise across the row: every item sheds its NAME (right to left: Marks, Comments, Context, Layout) before ANY item drops to its glyph (again right to left). State is `stage = {names, words}` (`names ≤ words`; item `i` is full below `names`, value below `words`, glyph otherwise), replacing `kText`. `fit` walks `st = 0 … 2n` (`st ≤ n`: `names = n − st`; beyond: `words = 2n − st`) and takes the first that fits; `2n`, the all-glyph floor, is `need(0, 0)` and still decides the dodge, the diagnostics count's compact form and the rail's climb exactly as before. The ghost carries all three forms per item, keyed by the item's ID rather than its index (Marks comes and goes, and `fit` is a stable callback, so it reads the row order off the ghost's `data-g="order"` spans): `c:<id>` the full form with the value emptied, `b:<id>` the value form emptied (padding alone), `g:<id>` the glyph, `v:<id>` every value bare; `resv` is a `Record<id, number>` and reserves the widest value in BOTH word forms, so a value change moves nothing in either. Measured (1100 frame, cycling all four Layouts, four Contexts, four Comments): one card width, **398.81**. Every value item's tip now OPENS `Name: value — …` (the Layout titles were `Layout: compact outline — …` and are now `Layout: outline — a compact outline, …`; the Marks titles `Marks: –/3 — …` / `Marks: 2/5 — …`), so the name the value form drops is the first thing its tip says.

**B — fewer items.**
- **Width** is a `width` row in the LAYOUT panel, under the side-by-side/gallery toggles and a divider: the same slider (`REFLOW_MIN_CHARS … full`, forced to `REFLOW_MAX_CHARS` in tracks), the same dimmed `full`/`N col` readout, the same `applyReflow` and so the same `Width: …` toast; the tracks seam still drags it. Panel `minWidth` 150 → 220 to hold it. What relied on the item: its ACCENT (lit while wrapping narrower than full) becomes Layout's THIRD SLOT (`effReflow !== "off"`, so lit in tracks, which wraps); it had no slot and no ⌥-cycle, so nothing else moved. `WidthGlyph`, the `"reflow"` bar id and its panel are deleted; design rule 13's "plus Width while it wraps" is struck.
- **↺ reset** is the rail's fourth button, below `⛶` (both put the view back to a standing start), `ResetGlyph` drawn at `BAR_GLYPH_SW` (an open circle with the gap at the top and its head turning anticlockwise), same `resetToSource`, same title. The rail is bottom-anchored with no measured height, so the column grows upward and `lift` (which clears the card, not the rail) is unchanged: rail buttons at y 636/666/696/726 in an 800px viewport at every width.
- **Marks** is drawn only where the proof HAS marks in either list (`hasMarks = authorCount + myCount > 0`). Both lists off with marks present still reads `Marks: off`, dimmed. `<`/`>` still step and toast the empty message; the Marks panel is gated on `hasMarks` too, so removing the last mark with the panel up takes both away. Dropping the FIRST mark by the nub on a markless proof (560 frame): bar `Layout: outline · Context: used · show · eye · ?` → `Layout: outline · used · show · –/1 ‹ › · eye · ?`; every `g[data-node]` transform and the scroll position byte-identical before and after — bar only.
- **The diagnostics count** was already conditional (`diag` is null while `diagList` is empty); verified, unchanged.

**What the bar holds (harness, dark, 2× headless Chrome; `shots/bar2-*.png`):**

| frame | no marks | with marks (odd_sums, 3 source) | placement |
|---|---|---|---|
| 1100 | `Layout: outline · Context: used · Comments: show · eye · ?` (399) | `… · Comments: show · Marks: –/3 ‹ › · eye · ?` (544) | centred |
| 560 | `Layout: outline · Context: used · show · eye · ?` (330) | `Layout: outline · used · show · –/3 ‹ › · eye · ?` (382) | right / right |
| 380 | `outline · used · ▢ · eye · ?` (205) | `outline · used · show · ⚑ ‹ › · eye · ?` (315) | right / fill |

So at half-width every item keeps a WORD; only Layout (and, without marks, Context) keep their names. At 380 with marks the card fills one lane up and the rail climbs over it, as before.

### 2026-09-24 — Slots centred under what they mark

User report (screenshot, half-width infoview): the squares under `–/2` and under the eye sat off-centre. Two causes. (1) A value item's box is RESERVED to its widest value (`99/99`), the slots centre under the box, and the value form set its text LEFT in it — measured `–/2` ink centre vs slot centre was ~25px apart. The VALUE form now centres its text in the reserve (the full form keeps it left-set against its name, one phrase); measured after: 229.6 vs 229.5 at 560px. (2) An unset slot was EMPTY, so the eye with only its last extra up showed one square at the group's right end. Unset slots are now drawn FAINT (`SLOT_OFF`, the chrome ink at 25%), so the group's extent — and its centre — shows, and the position still says WHICH extra is up.

### 2026-09-24 — Saying plainly what comes from Paperproof

Before the public sync, the user asked that the docs be clear about how Ramify builds on Paperproof: "It's MIT licensed but we need to be kind". The licence was already honoured (NOTICE carried Paperproof's full MIT text), but the README gave it one clause, and NOTICE called Ramify "a thin wrapper". The README now has a **Built on Paperproof** section, and NOTICE's Paperproof entry was rewritten to match. Both name Anton Kovsharov, Evgenia Karunus and the contributors. They say what is Paperproof's: the idea of reading a proof as the history of its goals and hypotheses, and `BetterParser_Tree`, where every tree starts. Ramify calls it unchanged, pinned to a commit, not forked. `web/src/paperproof.ts` mirrors its structures, and `haveUses` reads its `tacticDependsOn`. The two docs also say what Ramify adds, and that it keeps all of it in extra data keyed by position, never inside the parser's structures. The README also points readers who want the paper view at Paperproof itself. INSTALL.md's "graciously build upon" became a pointer to NOTICE.

The same pass rewrote `dist/Demo.lean` and the Tour's docstrings. Both still taught the old top-right rail (`⊞/⊟`, `↶`, `❮❯`, `¶`, `⇝`, the top-left diagnostics pill), which has not existed since the status bar. Now they describe:
- the goal corner's `−` / `+N`;
- the status bar's Layout, Context and Comments, the eye and `?`;
- the rail's ⌥ fold-alls;
- the hover bar's `◌ ◎ ⊹` and the trash can;
- `⋯` and the lens inside it;
- the diagnostics count and its message strip.

INSTALL.md now points at the 0.0.19 `.vsix` and lists `ramify.experience` and `ramify.hoverBar.*`.
