# Changelog

## Unreleased

**The static viewer**
- Proofs can be published as a static website, or as one self-contained HTML file, that draws the same tree as the infoview with no Lean server: hovers, comments, diagnostics, every layout and reading option, and a coloured source pane beside the tree that the tree follows. Lean runs once, on the author's machine (`web/scripts/publish.mjs`); see `docs/viewer.md`.
- `ppharness --widget-data` emits what only the widget carried before (diagnostics, tactic tokens, the declaration header, tagged goals and token hovers), from the same harvest functions the widget calls.
- The `?` panel no longer mentions model polish, flag writes or the frontier chips where they cannot be used.

## 1.0.0 — 2026-09-28

The first stable release. The 0.0.x releases were pre-release builds; there is no upgrade path to describe from them beyond installing this one.

**The tree**
- A Lean proof drawn as a tree of goals and tactics, live in the VS Code infoview, following the cursor; every tree starts from Paperproof's parser (see NOTICE).
- Four layouts — stacked, spine, tracks, wide — with a width setting, calc chains drawn as ledgers, and recovery for failed tactics, term-mode proofs and an empty `:= by`.

**Reading**
- Cuts: hide a goal's subtree with `−`, skip a step with `◌` (a break in the line and a caption say what went), `.fold` and `.none` in the source seed them, ⌥-click on the rail's `−` / `+` to fold or unfold every branch.
- Marks: an ordered reading of a proof (`.mark` in the source, or your own from the corner nub), stepped with `<` and `>`.
- Narration: one templated sentence per tactic, folded up the tree; optional model polish, off by default.
- Context breadth, brief labels, hypothesis origins, and what `simp`, `grind` and `aesop` used.
- Undo on bulk view actions: Reset tree, collapse all, expand all and clear temporary marks each offer an Undo button in their toast.
- Clear temporary marks from the Marks panel (source `.mark`s stay); Reset tree clears them too.
- The Marks counter stays on its node: it appears at the free end of the status bar, so nothing else shifts when the first mark is dropped.
- Dismissed errors stay dismissed: the message strip reopens only for an error you have not already put away.

**Keyboard and calm**
- Keyboard access to frontier chips (also in the `⋯` menu), to selection (Shift+↑/↓ then the pill's chips), and to a calc ledger's rows.
- A calmer hover bar (one pill) and diagnostic ribbons (thinner, with a faint wash); warnings have their own colour.

**Editing**
- Type a tactic into a node, add one to an unsolved goal, stub with `sorry`, grow a `calc`, edit comments, delete a step, undo. Every edit is an ordinary editor edit.

**Restructuring, each checked by Lean before it is offered**
- Inline a single-use `have`, or pull a `(by …)` out as one (then Rename Symbol); replace a closing run with one automation tactic, or write out what it used; rename a hypothesis to Mathlib's convention; the by-contradiction analysis; a model that may only choose among these (off by default).

**Errors**
- Clearer messages: a failed model request points at Ramify: Set model API key, a silent extension says to check the Ramify output channel, and a rejected proof tree suggests Restart File.

**Lints and diagnostics**
- Mathlib's own linters, with a fix where one edit is enough; diagnostics on the node, a count on the status bar and a message strip.

**The extension**
- The lens, show in source, hover highlights, undo/redo from the tree, theme-accurate colours, experience presets (`beginner`, `intermediate`, `expert`) and hover-bar settings, each settable per workspace folder. The lens hides tabs, breadcrumbs, the minimap and sticky scroll through user settings while it is open (`ramify.lensHideChrome` turns this off).

**Accessibility**
- The tree is keyboard-operable: `Tab` into it, `↑` `↓` `Home` `End` move through the boxes, `→` and `←` open or fold a goal (else step in or out), `Enter` goes to the source, `F2` edits a tactic, `⇧F10` opens a node's moves menu. A focus ring shows the box you are on.
- Status-bar panels and the `⋯` menu are keyboard-operable with proper menu roles; toasts are announced by screen readers; the `?` panel is a dialog with a "Reading this" section.
- Text contrast meets WCAG AA in the default light and dark themes; scrolling is not eased under `prefers-reduced-motion`.

**Performance**
- Proofs of a thousand tactics or more open in tens of milliseconds in the compact layouts. The wide layout switches to a faster packing above about 200 tactics (it was two seconds at 1000); smaller proofs draw exactly as before. Very long proofs (more than 6000 steps) no longer overflow the stack.
- Completing a lemma name while typing into a node takes 1–40 ms instead of about 800 ms on a Mathlib file; the index is built in the background when the first proof tree loads (a few seconds).

**Hardening in 1.0**
- A render error in the tree draws a message and a retry instead of blanking the infoview; failed edits are reported instead of dropped.
- The extension treats every request file as untrusted: size cap, shape checks, document ownership, an allowlist for the settings it will write back, and a watcher that recovers from errors.
- The extension's request files (in `~/.proof-tree-companion`) are written atomically (and found through `USERPROFILE` where `HOME` is unset); model requests are capped and answered by one window.
- Lean side: one-click automation (`⇓`) gives each candidate a heartbeat budget, so `aesop` or `grind` on a run they cannot close gives up instead of holding the server; a superseded counterfactual elaboration is cancelled; the tree cache notices a change in the diagnostics themselves, not only their number; a file with nothing elaborated yet answers "no proof here" instead of an error; a rewrite check refuses edits outside the declaration.
- The extension activates on startup, so the editor settings the lens changed are restored after a crash in any window.
- CI: typecheck, lint, offline probes, a stale-bundle check, the Mathlib-free package build, the tour, packaging, and a check that every setting is documented; `npm test` runs the same gate locally, including a behaviour fingerprint of the layout engine. `scripts/sync-main.sh` prepares the install branch.
- Docs: supported versions, uninstall, security notes, contributing guide; the dependency is pinned to `v1.0.0`.

**Under the hood**
- A simplify pass before 1.0, with the behaviour fingerprint unchanged: one post-order walk, one move gate and look table, one reading-options table and override hook, one request-handler shape in the extension, shared string and hash helpers. The extension now writes every theme-file setting per workspace folder (not only the experience level and hover bar), a `tryClose` answer is keyed on its candidate list and can be cancelled, and `vsce` is pinned to 4.0.0 in CI and `package.sh`.
