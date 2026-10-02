# Contributing to Ramify

Thanks for looking. This file is the short version; [README.md](README.md) explains what the pieces are, [CLAUDE.md](CLAUDE.md) is the engineering record, and `docs/design-record.md` is the full history of decisions.

## Setup

- Install [elan](https://github.com/leanprover/elan). The toolchain is pinned in `lean/lean-toolchain` (Lean `v4.32.2`) and elan fetches it.
- Node 22 and npm for `web/`.

```bash
cd web && npm install && npm run build:widget     # the bundle is a Lean build input, so build it first
cd ../lean && lake exe cache get && lake build    # the cache download avoids compiling Mathlib for hours
```

Re-run `lake exe cache get` after any `lake clean`. Then open a file under `lean/` that imports `Ramify` (`lean/ProofTreeTour.lean` is the guided one) in VS Code with the Lean 4 extension.

## The gate

```bash
cd web && npm test
```

runs the typecheck and the lint (together), then the offline probes (`counts`, `narrate`, `overlap`, `order`, `hopgap`, `rewrite`, `fingerprint`) one after another, and stops at the first failure. The expected numbers in the probes are measured; a change in one is a finding, not noise.

`fingerprint` hashes the full output of every pure stage (the tree, the cuts, the narration, all four layouts) over the corpus and some large synthetic proofs, against `web/probe/fingerprint.baseline.json`. A refactor or a performance change must leave every hash alone. If you changed what is drawn on purpose, check the diff is the one you meant, then run `npm run probe -- fingerprint --update` and commit the new baseline with the change. `npm run probe -- perf` (timings and the recursion ceiling per stage) is informational and not part of the gate. There is no other test runner. A probe is a `web/probe/*.mjs` whose first line is `// @probe` (that is what `npm run probe` lists); it imports `./lib.mjs` (the bundled pure modules) and `./corpus.mjs`, which also holds the shared `MODES`, `layoutOf(nodes, mode)` (the view's own `layoutArgs` mapping), `hopEvery` and the `flag`/`opt` argument helpers. CI (`.github/workflows/ci.yml`) runs the same command, so run it before you push.

Also, depending on what you touched:

- **The widget.** `./dev.sh` rebuilds the bundle and the Lean package, then tells you whether the running file worker is newer than the build. If it is not, the editor is showing the old bundle: click **Restart File** in the infoview.
- **Widget-only data** (tagged goals, token infos, diagnostics, tactic edits) never rides the offline NDJSON, so the offline probes cannot see it. Use the LSP probe against the live server, e.g. `cd web && npm run probe -- lsp ../lean/ProofTreeTour.lean 31 4`. `npm run probe` lists the rest.
- **The extension.** `node --check ext/ramify/extension.js`, then reinstall the `.vsix` and reload the window; edits to `extension.js` reach the editor no other way.
- **Settings or commands.** Add them to `INSTALL.md`; `node scripts/check-settings.mjs` fails until you do.
- **Lists that exist in two files** (the hover-bar move ids, the automation candidates, the trace heads). `node scripts/check-sync.mjs` asserts they agree; run it after touching `web/src/moves.ts`, `moveSlots.ts`, `rewrite.ts`, `trace.ts`, `lean/Ramify.lean`, `lean/ProofTreeRecover.lean`, `ext/ramify/extension.js` or the hover-bar settings in `ext/ramify/package.json`.
- **Experience levels.** `web/src/experience.ts` (`PRESETS`, read through `describePreset`) is the one source. After changing it, run `node scripts/gen-experience.mjs`: it rewrites the setting's descriptions in `ext/ramify/package.json`, the quick pick in `extension.js` and the table in `INSTALL.md`; CI runs it with `--check`.

## Idioms to reuse

Before writing a second copy of one of these, use the one that exists: a probe is a `web/probe/*.mjs` whose first line is `// @probe`; a fold over a node's subtree is `postOrder(root, kids, combine, memo)` in `web/src/treeWalk.ts` (iterative, memoised, so a long trunk cannot overflow the stack); a session override of a default is `useOverride(default)` (`web/src/useOverride.ts`, which stores a value equal to the default as null); whether a hover-bar move is offered, greyed or absent is `availability(k)` in the view, and its glyph and icon come from `MOVE_LOOK` (`web/src/moveSlots.ts`).

## The tracked bundle

`web/dist/proofTreeWidget.js` is committed, on purpose: `Ramify.lean` reads it with `include_str` and a fresh clone runs no npm step. After any change under `web/src/`, run `npm run build:widget` and commit the result with the source. CI rebuilds it and fails if the tracked file differs.

## Platform notes

`dev.sh` uses macOS `stat -f` and BSD `ps`/`date`, so its freshness check is macOS-only; on Linux run `lake build` and restart the file worker by hand. Everything else, including `npm test`, is platform-independent.

## Where decisions are recorded

Before re-deriving a rule or "fixing" a number, grep `docs/design-record.md`: it holds every measurement, every rejected alternative and every reported bug with the reason its fix has the shape it has. `CLAUDE.md` is the current-behaviour summary, and its Standing rules apply to any change (view state keys on source facts, never mvarIds; the measurer and the renderer are changed together; no relayout on hover).

## Branches and releases

- `dev` is where development happens; open pull requests against it.
- `main` is the install branch, a subset of `dev`. Do not edit it by hand: `scripts/sync-main.sh` (a dry run by default; `--apply` writes into a worktree of `main`) builds it from the committed `dev`, and the user-facing `README.md` on `main` comes from `docs/README.main.md`.
- A release is a `v*` tag on a `dev` commit whose `ext/ramify/package.json` version matches the tag. `./package.sh` builds `dist/` and the `.vsix`; CI attaches the `.vsix` to the GitHub release.

By contributing you agree that your work is under the project's MIT licence (see [LICENSE](LICENSE)); Paperproof, ProofWidgets and `@leanprover/unicode-input` keep their own (see [NOTICE](NOTICE)).
