# Installing the proof tree

An interactive proof tree for Lean 4, drawn in the VS Code infoview. It reads
the proof under your cursor from the live language server and lets you read,
navigate and **edit** it from the tree.

Two pieces, and only the first is required:

| | what it is | needed? |
|---|---|---|
| **Lean package** `proofTree` | the widget itself — the panel, the RPC, the renderer | **yes** |
| **VS Code extension** `proof-tree-companion` | the lens (a slim editor pane), theme-accurate syntax colours, a few settings | optional |

Without the companion the tree still draws, folds, navigates and edits; what
you lose is listed under [What the companion adds](#what-the-companion-adds).

---

## Before you start

**Your project must be on Lean `v4.32.2`.** The package pins its toolchain
and its dependencies to that release; a project on a different toolchain will
fail to resolve them cleanly. Mathlib `v4.32.2` is the matching release.

You also need the [Lean 4 VS Code extension](https://marketplace.visualstudio.com/items?itemName=leanprover.lean4)
(`leanprover.lean4`) — the tree is a panel inside its infoview.

---

## 1. The Lean package (required)

Add one dependency to your project's `lakefile.toml`:

```toml
[[require]]
name = "proofTree"
git = "https://github.com/aidanmaney/prooftree-lean4.git"
subDir = "dist"
rev = "main"
```

<details>
<summary>lakefile.lean instead of lakefile.toml</summary>

```lean
require proofTree from git
  "https://github.com/aidanmaney/prooftree-lean4.git" @ "main" / "dist"
```
</details>

Then:

```bash
lake update proofTree && lake build
```

It pulls **Paperproof** (the vendored parser, core-only) and **ProofWidgets
v0.0.105** — the same version Mathlib `v4.32.2` pins, so a Mathlib project
resolves to one copy rather than a conflict. It does **not** pull Mathlib.

A from-scratch build takes a few minutes, nearly all of it ProofWidgets
building its own widget JS (measured: 306s of a 320s cold build; our own Lean
sources are about 10s of it). Subsequent builds are seconds. That is the whole
point of `dist/` being separate — the development package requires Mathlib,
which is tens of minutes and gigabytes for a dependency the widget never uses.

Now turn the panel on in a proof file:

```lean
import ProofTreeWidget
show_panel_widgets [ProofTreeWidget]

theorem demo (a b : Nat) (h : a = b) : a + 0 = b := by
  rw [Nat.add_zero]
  exact h
```

Put your cursor inside the proof and the tree appears in the infoview. It
follows the cursor; the panel is on for the whole file after that one
`show_panel_widgets` line.

### Or: just clone this repo and try it

If you only want to look at it, skip the dependency entirely:

```bash
git clone https://github.com/aidanmaney/prooftree-lean4.git
cd prooftree-lean4/dist && lake build
code .
```

then open `Demo.lean` — a core-only file with five small proofs and a list of
things to try, written to be the shortest path from clone to working tree.

That file lives in `dist/` rather than beside the other demos on purpose:
vscode-lean4 resolves a file's Lake workspace by walking **up** from the file,
so anything under `lean/` is served by the *development* package — which does
require Mathlib, because it also builds the offline CLI. `dist/Demo.lean` is
served by the minimal one and needs none of it.

The richer walkthroughs do live under `lean/`, and so — however core-only their
own contents are — they are served by the development package and do cost that
Mathlib download:

- `ProofTreeTour.lean` — a guided tour, one feature cluster per theorem, with a
  docstring per section saying what to try. Its last two sections are
  deliberately unfinished, which is the point: the frontier chips and the error
  ribbon are what they demonstrate.
- `ProofTreeExercises.lean` — the tour's workbook. Five goals to prove *from the
  tree*, each seeded with one honest opening move, solutions at the bottom.
- `ProofTreeGoalsDemo.lean` — harder, no seeds. Six statements, each proof a
  lone `sorry` you replace by double-clicking its node.
- `ProofTreeDiagnostics.lean` — eight theorems, each broken a different way, for
  the error ribbon and the diagnostic pager.

Note the near-namesake `ProofTreeGoals.lean` is *not* the exercise sheet: it is a
small solved companion to `ProofTreeGoalsDemo.lean`, and the quickest check that
a term-mode proof draws a tree at all.

None of these files is deliberately clean, and none is a Lake target: the
unsolved goals of the workbook, the `sorry` warnings of the goals file and the
errors of the diagnostics file are the whole point, and `lake build` does not
touch any of them whatever state they are in. Open them, don't build them.

---

## 2. The VS Code companion (optional)

Install the packaged extension:

```bash
code --install-extension dist/proof-tree-companion-0.0.3.vsix
```

or in VS Code: **Extensions** → **⋯** → **Install from VSIX…** → pick
`dist/proof-tree-companion-0.0.3.vsix`. Reload the window afterwards.

<details>
<summary>Developing on it instead (no packaging step)</summary>

The extension is deliberately build-step-free CommonJS, so a symlink is enough:

```bash
ln -s "$PWD/ext/proof-tree-companion" \
      ~/.vscode/extensions/aidan.proof-tree-companion-0.0.3
```

Changes to `extension.js` need only a window reload; changes to `package.json`
need a full VS Code restart (the manifest is rescanned at startup).
</details>

### What the companion adds

- **The lens** (`⧉` on a tactic's hover bar) — opens the proof in a slim editor
  pane split below the infoview, with the tactic selected, folded to the path
  you are on, and each tactic's resulting goal drawn inline at the end of its
  line. Same window, same document, same Lean server, so vim/LSP/keybindings
  all still apply.
- **Theme-accurate syntax colours.** A webview cannot read the editor's token
  colours (they are not in the `--vscode-*` variable set and the extension API
  has no member for them), so the companion resolves the active theme's JSON
  and hands them over. Without it the tree falls back to a built-in Light+/Dark+
  palette — close, but not your theme.
- **Click-to-reveal retargeting**, so a node click moves the *lens*, not the
  main buffer.
- **Undo/redo from the tree** (`↶ ↷` on the rail). Edits made from the tree
  leave focus in the webview, where ⌘Z reaches nothing; the companion focuses
  the editor and runs the real command.
- **Settings**: `proofTree.outlineOnly`, `proofTree.tallFrame`,
  `proofTree.linkMarks`, `proofTree.linkEmoji`, `proofTree.linkTint`,
  `proofTree.lensGoals`,
  `proofTree.lensFold`, `proofTree.lensWordWrap`, `proofTree.lensShrinkNudges`,
  plus your `lean4.input.*` unicode-abbreviation customisations. (The
  abbreviation *table* is bundled, so `\dvd` → `∣` works in the tree's editor
  either way; only a customised input mode needs the companion.)

---

## Checking it works

1. Cursor inside a proof → boxes appear in the infoview. Goals are the blue
   boxes, tactics the green ones.
2. Move the cursor between tactics → the matching node takes an accent outline
   and the view scrolls to it.
3. Double-click a tactic → an editor opens in place; Escape cancels, Enter
   commits (⌘/Ctrl-Enter for multi-line).
4. Hover a goal box → an action bar with reveal / focus / elide / delete.
5. Leave a proof unfinished → the open goal grows `+` / `sorry` / `calc` chips.

If the tree says **"no proof here"** with the cursor plainly inside a proof,
the toolchain is the first thing to check (see [Before you start](#before-you-start)).

If a *gesture* does nothing — the lens not opening, colours not following the
theme — read the **Proof Tree Companion** output channel (**View** → **Output**,
pick it from the dropdown). The whole companion relay is a file written by the
Lean server and watched by the extension, so it is invisible by construction;
that channel is where every request, skip and failure is logged, and it
distinguishes never-arrived from arrived-and-skipped.

---

## What is in the box

```
dist/                       the installable Lake package
  lakefile.toml             requires Paperproof + ProofWidgets, no Mathlib
  lean-toolchain            v4.32.2
  lake-manifest.json        pinned dependency set
  Demo.lean                 the try-it file (core-only)
  proof-tree-companion-*.vsix
lean/                       the Lean sources (shared: dist/ points at them)
  ProofTreeWidget.lean      the panel widget + its RPC
  ProofTreeComments.lean    source-comment and edit-seam extraction
  ProofTreeRecover.lean     supplemental parser (failed tactics, term proofs)
  ProofTree*.lean           demo / tour / exercises / fixtures
web/                        the renderer (React + d3-dag)
  dist/proofTreeWidget.js   the built bundle — TRACKED, because the Lean
                            package `include_str`s it and a fresh clone runs
                            no npm step
ext/proof-tree-companion/   the VS Code extension (no build step)
package.sh                  rebuilds both artifacts and checks dist/ builds
```

To rebuild everything after a change:

```bash
./package.sh
```

That builds the renderer, typechecks and lints it, confirms the installable
package still compiles without Mathlib, and repackages the `.vsix`.
