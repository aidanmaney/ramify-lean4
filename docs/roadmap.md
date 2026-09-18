# Ramify: level-up roadmap — "make NEW Lean 4 proofs easier to understand, automatically"

## Context

The FLT formalization (Anthropic, Sept 2026) is 13.4M lines, 29,500 theorems, machine-named, "written to be checked rather than read". Buzzard's reaction the same day: nobody is going to build "a dynamic document enabling humans to explore the modern proof". Prove2Me's own answer to legibility is a per-theorem natural-language card plus a "read-back" sub-agent that re-verbalises the Lean statement for auditors. So the gap the field now has is exactly this project's shape: a tool that takes a proof someone else (or something else) wrote and makes its *argument* visible.

Ramify already has the substrate: Paperproof's goal/tactic harvest, a source-faithful tree, elision/brief/combine as granularity controls, editing seams verified over LSP, a recovery parser for failed/term/calc proofs. What it lacks: (1) a UI a newcomer can read without a legend; (2) a parser that sees more than `TacticInfo` boundaries; (3) any prose; (4) any restructuring.

This plan is grounded in four literatures, each of which already answered part of the question:

- **Proof presentation at the assertion level** (Huang PROVERB 1994; Fiedler P.rex; Schiller & Autexier, granularity-adaptive presentation, 2009): human proofs are read at "one lemma application per step", and the right granularity is learned/tuned, not fixed. Ramify's brief/elide/combine are an ad-hoc version of this.
- **Readable structured proof languages** (Wenzel Isar 1999; Wiedijk formal proof sketches 2003; Massot Verbose Lean ITP 2024): readability comes from *stated intermediate facts* (`have`), explicit case structure, and `calc`; Isar's `show`/`obtain`/`from` is the idiom list.
- **Machine proof → readable proof** (Blanchette–Böhme–Fleury–Smolka, "Semi-intelligible Isar proofs", JAR 2016): (a) redirect proofs by contradiction into direct proofs, (b) *iteratively test and compress* linear chains — every candidate rewrite is re-checked ("preplay") before it is kept. This is the template for restructuring: propose, re-elaborate, keep only what checks.
- **Informalization** (Coscoy–Kahn–Théry 1995 Coq; Holland-Minkley–Barzilay–Constable AAAI 1999 Nuprl; Coqatoo 2017; Herald ICLR 2025; CoSProver "chain of states" 2025; Hattori et al. INLG 2025): the SOTA that actually measures well is **template-per-tactic + proof states + recursive summarization along the proof tree**. Hattori: templates lift step accuracy from ~54% to ~89%; recursive (tree-structured) summarization beats flat. Pure end-to-end LLM prose is the *worst* configuration in every one of these papers.

Design rules that follow: everything Ramify shows or writes must be **derived from the elaborator or re-checked by it**; prose is templated first and LLM-polished at most; restructurings are proposals verified by re-elaboration, never applied blind.

---

## Workstream A — Controls: a status bar of words (replaces the rail)

**Decided (user, 2026-09-04):** status bar of words at the bottom of the tree; symbols only where they are the actual notation of the thing (Γ, λ, Δ, ⊢, ∎) plus conventional icons for zoom/undo; reflow width as a draggable seam in the tracks layout. The rail — including the interim slide-out/View-menu version — goes away entirely.

### Why
The rail held three unlike things as one column of invented 26px glyphs: persistent view settings (layout, context, comments, reflow, brief, combine, side-by-side, gallery, accordion, up-to-here), modal gestures that take over every click (sequence/path/band picking, calc stage, armed delete, selection), and one-shot actions (expand/collapse, undo/redo, fit, help). Mature tools show settings as their *current value in words* (VS Code status bar, Blender headers), show modal state loudly with a way out, and keep icons only where they are universal.

### A1. `StatusBar` (new component, ProofTreeView.tsx; replaces `ControlRail`, `RailButton`, `RailFlyout`, `ReflowControl`, `ViewMenu`, `useRailExpanded`, `useAltHeld`)
One 22px strip pinned to the bottom of the scroll frame (`position: absolute; bottom: 0`, the scroll container gets `paddingBottom`/height minus the bar; `useFrameOffset`'s frame maths unchanged). Left-to-right:
- **Layout item** `Outline ▾` — click opens a segmented list `Outline · Spine · Tracks · Wide` (all four visible; `LAYOUT_MODES[*].name`); accented when not `stacked`.
- **Context item** `Γ used ▾` — list `used · λ new · Δ · all` (`HYP_MODES[*].name`, glyphs are notation: Γ the context, λ binder-introduced, Δ the delta), plus a `binder order` checkbox row (`hypGroup`).
- **Comments item** `Comments: strips ▾` — list `strips · hidden · narration` (`commentMode`).
- **Reflow item** `Reflow: off` / `44 col` / `44 col (tracks)` — click opens the existing slider (`REFLOW_MIN_CHARS…REFLOW_OFF_STOP`, `reflowToStop`/`stopToReflow`); reads the EFFECTIVE value (`forcedReflow ?? reflow`, the ¶ rule).
- **Toggles as text chips**, muted at default, accented when on: `brief` (hover keeps driving `briefPreviewOn`), `combine`, `side by side` (disabled + title reason in wide), `gallery` (disabled in sequence), `accordion`, `up to here` (disabled without a cursor / in sequence). Disabled/pressed follow the existing rule verbatim (draw pressed only where it changes the drawing; overridden → effective state).
- **Pick ▾** — list in words: `Sequence`, `Elide a path`, `Cut a band` (disabled outside compact stacked); choosing arms the mode and the item turns into the MODAL indicator `Picking a sequence — Esc` in `SEQ_STROKE`, replacing today's `HintPill`s. Calc stage and armed delete surface there too. `layers` keeps every entry; the bar's `✕`/Esc route through `layerOff` as the pills do today.
- **Diagnostics**: `DiagnosticPill`'s content moves into the bar (`⨯ 2/5 message… ‹ ›`), so `floaterTop` loses a row; the focus breadcrumb stays in the header trail.
- **Right end, icons only**: `↶ ↷` (widget only) and `⛶` fit. Expand/collapse all become words `expand all · collapse all` (⌥ on expand keeps the source-view reset; the title says so).
- **A three-button rail stays at top-right — `+ − ?` only** (user decision: they earn their keep; universal icons, the zoom pair beside the canvas they act on and `?` where a reference is looked for). `RailButton` survives for these three, glyph-only, no labels; everything else on the rail is deleted.
- **Implementation: delegated to Opus 5 subagents** (user decision), one per part (A1 bar, A2 toast+keys, A3 seam), each verifying in the preview harness; the coordinator reviews and runs the final checks.
- Every item has a `title`; `nodeHints`/`?` panel unchanged. `RAIL_GLYPH_*` constants and the ⑃/⊹/⋮/⊞/⊟/¶ glyphs are deleted.

### A2. Toast + keys
- `Toast` (paint-only, top-centre, `FLOATER_H` chrome): on any mode change show `Layout · tracks` for 1.5s via `setTimeout` (no rAF — hidden webview rule). Fired from the same setters the bar uses, so keyboard changes are confirmed.
- Document `keydown` (skipped in textareas, alongside the existing `?`/Esc handler): `l` layout cycle, `g` context cycle, `b` brief, `c` comments cycle, `k` combine, `u` up to here. Listed in the `?` panel under a new "Keys" section (`GESTURES` gains rows with `target: "keys"`).

### A3. Reflow width as a draggable seam (tracks only)
- `layout.ts`: the aligned-track pass already computes one shared `trackX`; publish it on the layout result (`extent.trackX`).
- ProofTreeView: in `layout === "tracks"` draw a full-height hairline at `trackX − TRUNK_GAP_BRANCH/2` with `cursor: col-resize` and a 8px hit strip; drag maps Δpx/zoom → columns via `CHAR_W` (`REFLOW_MIN_CHARS…REFLOW_MAX_CHARS` clamp), writing `setReflow` live; the readout `44 col` floats beside the seam while dragging. No new layout state — it is the existing reflow setting with a second input. Each drag step is one engine rebuild (~2–3ms, measured for the slider).

### A4. Action bar words
Keep the dwell labels already added (`NodeAction.label`, `BAR_LABEL_DWELL_MS`).

### Files
`web/src/ProofTreeView.tsx` (bar, toast, seam, keys; delete rail components), `web/src/layout.ts` (`trackX`), `web/src/gestures.ts` (keys section), `web/src/helpPanel.tsx` (render it), CLAUDE.md Controls section, OVERVIEW.md.

### Verification
`?stub-edit&cursor=…` harness: bar renders every item, lists open/close via `layers` (Esc order: list → mode → selection), each toggle accents only when it changes the drawing (wide: side-by-side disabled), picking modes show the modal indicator and exit on Esc/✕; keys cycle with toast; tracks seam drag changes `reflow` and the readout, clamped; frame heights 240/580/760 — the bar is one line, so nothing clips. Layout sweep unchanged (no `viewKey` change except reflow, which already re-centres). Then `npm run typecheck && npm run lint`, `build:widget`, `lake build Ramify`.
## Workstream B — Extend the parser (additive walks over `snap.infoTree` first; forking Paperproof's `BetterParser` is allowed since 2026-09-09)

Paperproof's `BetterParser` is 253 lines and harvests *only* `TacticInfo` goal deltas. Things the tree cannot currently see, each recoverable from data the request already holds:

1. **Term-level structure inside a tactic** — `exact ⟨h1, fun x => …⟩`, `refine`, anonymous-constructor arguments: `TermInfo` nodes with `expectedType?` give every sub-term its "goal" (the Part-B `synthGoal` seam already does this for term-mode proofs). Extend Part B to run *inside* tactic steps, so a big `exact` becomes an expandable subtree.
2. **Hypothesis provenance** — which earlier step introduced each hypothesis (Paperproof's own selling point that our tree dropped). `(fvarId, username)` chain is already carried by `contextFor`; ship `introducedBy : Map fvarId stepStart` and draw it as a dotted link on demand.
3. **Lemma references per step** — from `TermInfo` for constants under the tactic's syntax range, with `docString?` (already collected for popups). This is the input every informalization paper needs ("premise library") and what `▸`-style "used" marks lack today.
4. **Automation trace** — for `simp`/`grind`/`omega`/`linarith`/`aesop`, run the `?`-suggesting form (`simp?`, `says`) in the counterfactual pipeline (`computeCf` already re-elaborates a spliced declaration) to expose *which lemmas* closed the goal, as an optional subtree. This is `tryAtEachStep`'s trick applied to one step.
5. **Case/branch semantics** — `induction`/`cases`/`rcases` patterns → structured "case on X: zero | succ" data instead of label-family regexes (`MAIN_FIRST_RE`). Kind-based, not index-based.

Alternative considered: swapping Paperproof for **jixia** (frenzymath) — extracts tactic info, per-line states, reference graphs; used by Herald and CoSProver. Rejected as a replacement (it is a batch tool, and we need the live-server path), but its `elabTree` output is the reference for what B1–B3 should ship.

---

## Workstream C — Informalization ("what does this proof say?")

Grounded stack, in order of trust:

1. **Statement rendering via LeanTeX / LeanTeX-mathlib** (kmill). Mechanism: `@[latex_pp kind]` / `latex_pp_app_rules (const := …)` printers over `Expr`, `#latex` command, a widget. Use it for goal boxes' *reading* form (`\mathbb{N}`, `\frac`, `\mapsto`) beside Lean's own print; both are elaborator-derived. Ship as an optional dependency in `dist/` (it is core-only; mathlib rules come with LeanTeX-mathlib). Render with KaTeX in the widget (bundled, offline).
2. **Templated step narration** (Coscoy/Holland-Minkley/Hattori): one template per tactic *kind* (`intro` → "Let x be …", `have` → "First, note that P (by …)", `rcases`/`obtain` → "Write h as …", `induction` → "By induction on n:", `calc` → the ledger *is* the prose, `exact lemma` → "This is exactly `lemma` (doc)", `rw` → "Rewriting with …", automation → "This is routine (simp/omega)"). Inputs are what Ramify already has per node: tactic syntax kind, goal before/after, used hyps, referenced lemmas + docstrings (B3). Deterministic, offline-probeable against the CLI corpus.
3. **Recursive summarization along the tree** (Hattori 2025, Herald): a node's summary = its own template line + children's summaries, folded by the `have`/case structure the tree already has. Rendered as the **narration-mode strip** (comment mode `instead` already draws prose in the box) — i.e. auto-narration is a *fourth comment mode*: author's comment if present, else generated.
4. **Optional LLM polish** behind a setting, via the companion (it can reach an API; the widget cannot). Constrained to *rewriting* the templated text with the states as context — the configuration all four papers report as best — never generating from the raw Lean. Off by default. Prove2Me-style "read-back" (re-verbalise the *statement* for a non-Lean reader) is the first use.

   **Model choice for C4 and for D's proposal engine: Leanstral** (Mistral, 2026 — open weights, Apache 2.0, 120B-A6B sparse so it runs locally, "specifically trained to achieve maximal performance with the frequently used lean-lsp-mcp", also a free `labs-leanstral-2603` endpoint). It changes the economics of "opt-in LLM": the companion can drive a *local* model through MCP with no data leaving the machine, and the model already speaks the LSP the widget's server sits behind. Its FLTEval numbers (pass@2 26.3 vs Sonnet 23.7 at 1/15 the cost; Opus 39.6) are proving numbers, not readability numbers — which is why it stays a rewriter/proposer here and the elaborator stays the judge.

Not doing: end-to-end proof → essay generation; anything that prints text not traceable to a node.

---

## Workstream D — Restructuring (tree transformations toward human idioms)

The `infinitude_of_primes` diff (initial commit → current scratch) is the specimen. A Lean user turned 30 lines into 12 by exactly five moves, each of which is a known refactoring:

| move | original | after | grounded in |
|---|---|---|---|
| **Library replacement** | inline `have exists_prime_dvd … := by induction …` | `Nat.exists_prime_and_dvd` | `exact?`/`tryAtEachStep`; Sledgehammer relevance |
| **Inline single-use `have`** | `have hM : 2 ≤ N! + 1 := by …; obtain … := f _ hM` | `rcases f (n := …) <| by grind [...]` | Whiteside et al. proof-script refactorings ("inline lemma") |
| **Automation collapse** | `have hp1; have hle1; have h2; omega` | `grind [Nat.not_prime_one, Nat.dvd_one]` | Isar compression ("iteratively test and compress"); Mathlib `unusedHaveSuffices`/`unusedTactic` linters |
| **Absorb a normalisation step** | `push_neg at hle` + later use | `(by order)` at the use site | same |
| **Term ↔ tactic swap** | `have hpfac : … := lemma a b` | `rw [...] at hpdvd` | Isar `from … have`/`show` idioms |

Ramify already *writes* source (tacticEdits, flags, calc, delete). Restructuring = **propose a rewrite as a diff on the tree, verify it in the counterfactual pipeline (`computeCf` re-elaborates a spliced declaration and returns its diagnostics), then offer it as a one-click edit** — the Sledgehammer preplay discipline, and the same structural safety the calc gestures have (every intermediate state is a valid file, `sorry` not `?_`).

Catalogue for v1 (each is a pure function over the tree + a re-check):
1. **Inline single-use `have`** (and the inverse, **extract a `have`** from a nested `by` — Proof-Refactor 2026 measured this as the move with the largest readability gain).
2. **Collapse to automation**: try `omega`/`simp`/`grind`/`linarith`/`exact?` at each internal node of a linear run (`tryAtEachStep`, per node, via cf); offer "these 3 steps are `omega`" — *and the inverse*, **expand automation** (`simp?`/`says`) when a reader wants to see the lemmas.
3. **Direct-ify contradiction proofs** (`by_contra` whose body ends in a contradiction on a positive fact → `intro`/direct form) — Blanchette et al.'s redirection, restricted to the shapes that are one edit.
4. **Idiom normalisation, lint-driven**: bullets for multi-goal steps, `obtain` over `cases … with`, `calc` for chains of `rw`/`trans`, one tactic per line, no non-terminal `simp` (Mathlib style guide + `mathlibStandardSet` linters run through the cf pipeline; the tree shows the lint on the node it names).
5. **Rename** hypotheses/`have`s to Mathlib conventions (`hxy`, `hpos`) — pure text edit, re-checked.

6. **Agent-proposed rewrites** (after 1–5 exist as verified primitives): Leanstral over `lean-lsp-mcp`, prompted with the tree's own diff vocabulary ("inline `hM`", "collapse steps 4–7 to automation", "extract a `have` from this `by` block"), each proposal run through the same cf re-elaboration gate and shown as a tree diff before it is offered. The primitives are what make the proposals checkable and undoable; the agent only chooses among them. Also the natural home for an **FLTEval-style readability eval**: a fixed corpus (the `infinitude_of_primes` pair, the Tour, a sample of `anthropics/fermats-last-theorem` `P2M/Sol` files) scored on steps, depth, `have`-per-goal and lint count before/after.

What we do *not* claim: a normal form. Each transformation is offered, measured (steps before/after, depth, elaboration time), and reversible in the editor's undo.

---

## Phasing

1. **A (rail/labels/text)** — 1–2 weeks. No wire changes. Unblocks user testing of everything after.
2. **B1–B3** — parser walks; ship as sidecars keyed by `position.start` (the existing rule). Fixtures in `proofs/`.
3. **C1–C3** — LeanTeX + templates + recursive narration as the fourth comment mode. Offline-probeable; measure template coverage over the corpus and `ProofTreeTour.lean` (target: every tactic kind in the corpus has a template; report the residue).
4. **D1–D2** — inline/extract `have`, automation collapse/expand, on the cf pipeline. Then D3–D5.
5. **C4** — LLM polish through the companion, opt-in.

## Verification (per workstream)
- A: harness screenshots at three frame heights; overlap sweep unchanged; `?` panel lists every gesture still reachable.
- B/C: `gen.sh` corpus byte-identical for untouched fields; new sidecars diffed; LSP probe (`initializationOptions.hasWidgets`) for widget-only data.
- D: every offered rewrite applied to the corpus fixtures elaborates with 0 structural errors (the delete-verification classifier: benign/semantic/structural); `infinitude_of_primes` original → offered rewrites reach the human version's shape (5/5 moves offered).

## Sources (checked this session)
- Anthropic, *Formalizing Fermat's Last Theorem* (2026); repo `anthropics/fermats-last-theorem` README/PROOF-PATH; Buzzard, *FLT: Anthropic has beaten me to it* (2026-09-04); Prove2Me arXiv:2608.28433.
- Hattori et al., *NL translation of formal proofs through informalization of steps and recursive summarization*, INLG 2025, arXiv:2509.09726. Herald, ICLR 2025, arXiv:2410.10878. CoSProver "chain of states", arXiv:2512.10317. Coqatoo arXiv:1712.03894. Coscoy–Kahn–Théry TLCA 1995. Holland-Minkley–Barzilay–Constable AAAI 1999.
- Huang, *Reconstructing proofs at the assertion level* (CADE 1994) / PROVERB; Schiller–Autexier, *Granularity-adaptive proof presentation*, arXiv:0903.0314.
- Wenzel, Isar (TPHOLs 1999); Wiedijk, *Formal proof sketches* (2003); Massot, *Teaching mathematics using Lean and controlled natural language*, ITP 2024; Pit-Claudel, Alectryon SLE 2020 / LeanInk.
- Blanchette–Böhme–Fleury–Smolka, *Semi-intelligible Isar proofs from machine-generated proofs*, JAR 2016. Whiteside–Aspinall–Dixon–Grov, *Towards formal proof script refactoring*, 2011. Proof-Refactor arXiv:2606.03743. Renshaw `tryAtEachStep`; Mathlib linters (`unusedTactic`, `unnecessarySeqFocus`, `flexible`, `mathlibStandardSet`); Mathlib style guide; mathlib4 issue #24212.
- kmill/LeanTeX (`latex_pp`, `latex_pp_app`, `#latex`, widget) and LeanTeX-mathlib; frenzymath/jixia; Lean Atlas arXiv:2604.16347; Aspinall–Kaliszyk *Towards formal proof metrics* (2016, library-level C&K analogues — not step-level, noted for completeness).

