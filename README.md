# Ramify

A Lean 4 proof rendered as an interactive tree, live in the VS Code infoview.

The tree draws the tactic script's effect on goals — `goalBefore ──(tactic)──▶
goalsAfter` — so case splits, side conditions, `calc` chains and nested `have`
blocks fall out of that relation rather than being drawn specially. It is also
an **editing surface**: type a tactic into a node, add one to an unsolved goal,
stub a branch with `sorry`, open or grow a `calc` chain, delete a step, edit the
comment above a tactic, write or remove Alectryon-style `.fold` / `.none`
directives, undo. Every edit goes through the editor's own pipeline, so the
buffer and the undo stack stay authoritative.

Reading the tree is a second, separate vocabulary — four layout modes, elision,
context breadth, brief labels, narration from the proof's own comments — all on
one floating rail, none of it touching the file.

- **Using it in your own project?** See [INSTALL.md](INSTALL.md).
- **Working on it?** [CLAUDE.md](CLAUDE.md) is the engineering record —
  constraints, measurements, and the reasons behind the non-obvious choices.

## Two data sources, one renderer

```
# 1. Live infoview widget — the product:
cursor pos ──ProofTree.getProofTree RPC──▶ Proof ──proofToTree──▶ tree

# 2. Offline CLI — the development harness:
proofs/*.lean ──ppharness (Lean CLI)──▶ NDJSON ──proofToTree──▶ tree
```

Both wires feed the same source-agnostic renderer. The CLI path is not legacy:
it is what makes the system testable, letting the pure client modules
(`calcEdit`, `deleteEdit`, `completion`, `diagnostics`, `layoutKey`) be driven
offline against a corpus of real harvested proofs with no language server in the
loop. Editing-seam data that is plain data ships on *both* wires for exactly
that reason; only RPC-reference-carrying data (tagged goals, token hover info)
is widget-only.

```
diss/
├── lean/
│   ├── ProofTreeWidget.lean    # the infoview widget: getProofTree RPC + bundled renderer
│   ├── ProofTreeComments.lean  # shared syntax/source walks (comments, slots, calc, holes)
│   ├── ProofTreeRecover.lean   # supplemental parser: failed tactics, term-mode proofs
│   ├── Ppharness.lean, Main.lean  # the CLI harness (source → NDJSON)
│   └── ProofTree*.lean         # demos and fixtures (not Lake targets)
├── web/src/
│   ├── ProofTreeView.tsx       # the shared view — knows nothing about either data source
│   ├── proofToTree.ts          # steps → render tree
│   ├── layout.ts               # four layout modes
│   ├── widget.tsx / App.tsx    # the two data sources
│   └── …                       # elision, brief mode, diagnostics, editing, theming
├── ext/proof-tree-companion/   # VS Code extension: the lens, theme/settings relay
├── dist/                       # the installable Lake package (see INSTALL.md)
├── proofs/                     # corpus for the CLI harness
└── gen.sh                      # proofs/*.lean → web/public/sample.ndjson
```

## Build and run

**The widget** (the renderer bundle is a Lean build input via `include_str`, so
build it *first*):

```bash
cd web && npm install && npm run build:widget
cd ../lean && lake exe cache get && lake build
```

Then open a file in *this* Lake project with `import ProofTreeWidget` and
`show_panel_widgets [ProofTreeWidget]` — `lean/ProofTreeTour.lean` is a guided
walkthrough. The panel follows the cursor.

**The standalone app** (browser, reads the generated NDJSON):

```bash
./gen.sh                        # parse proofs/ → web/public/sample.ndjson
cd web && npm run dev
```

`gen.sh` runs the parser under `lake env`, which puts Mathlib's oleans on
`LEAN_PATH` so real `import Mathlib` proofs elaborate. Don't hand-edit
`web/public/sample.ndjson`; it is generated.

Other useful targets: `npm run typecheck`, `npm run lint`, `npm run build`
(standalone app → `dist-app/`). There is no test runner in either half —
"verify" means build, run, and inspect the rendered tree.

> Re-run `lake exe cache get` after any `lake clean`: it deletes Mathlib's
> oleans, and without them an `import Mathlib` file makes the editor compile
> Mathlib from source for hours.

## Toolchain

Pinned to **Lean v4.32.2** (`lean/lean-toolchain`), with Mathlib at the matching
tag and Paperproof pinned to an exact commit — never a floating `rev`, since
upstream moved to the module system in 2026-07.

Mathlib is a dependency of the *harness* only, so its oleans land on `LEAN_PATH`
and the CLI can elaborate `import Mathlib` fixtures. The widget itself needs
none of it, which is why `dist/` is a separate, much lighter package.

> **Superseded:** this README long carried a note pinning the project to v4.27.0
> because "on v4.29+ tactic subtrees elaborate asynchronously and aren't
> attached, yielding empty proofs." That was **falsified by measurement** during
> the v4.32.2 upgrade: `Elab.async` defaults to *false* for embedded drivers
> (only the `lean` CLI and the language server opt in), the info-tree collection
> in `IO.processCommands` is unchanged across v4.27→v4.33, and both wires were
> probed directly — the CLI harvest came back byte-identical step-for-step, and
> the live-server path (async genuinely on) returned complete proofs. The real
> v4.32 trap was elsewhere: `withImporting` now clears the initializers flag
> after *every* `importModules`, so a batch driver must re-arm it per file or
> every file after the first silently comes back with an empty environment. See
> CLAUDE.md for what to re-verify on the next bump.

## Distribution

`dist/` is the installable Lake package and `./package.sh` builds it. Sources are
**shared, not copied** — every library there points its source directory back at
`lean/`, so the two packages cannot drift.

One consequence worth knowing: **the compiled renderer bundle
(`web/dist/proofTreeWidget.js`) is tracked in git.** That is forced, not chosen —
`ProofTreeWidget.lean` reads it with `include_str`, a fresh clone runs no npm
step, and Lake has no hook to run one for a dependency. Without the artifact in
the tree, an install cannot build. It is the one generated file this repository
tracks.

## Licence

MIT — see [LICENSE](LICENSE). The companion extension carries its own copy at
`ext/proof-tree-companion/LICENSE`, because `vsce` only looks next to
`package.json` and would otherwise ship the `.vsix` with no licence in it.

Ramify builds on Paperproof (MIT), ProofWidgets (Apache-2.0) and
`@leanprover/unicode-input` (Apache-2.0, bundled into the renderer). The
distribution repository carries the full third-party notices.
