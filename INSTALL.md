# Installing Ramify

An interactive proof tree visualizer for Lean 4, drawn in the VS Code infoview. Read a proof as a tree, edit it in place, and choose what the tree shows you.

Ramify comes in two parts: a Lean 4 widget and a VS Code extension.[^1] ([Quickstart](#quickstart))

|                                              |                                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Lean package** `ramify`                 | the tree itself, control panel, renderer and Lean 4 plumbing                                                                                                             |
| **VS Code extension** `ramify` | adds a minimal editing pane, source code tactic highlighting, reveal tactic/goal in source, undo/redo buttons, theme-accurate syntax colours, persistent global settings |
|                                              |                                                                                                                                                                          |

---

## Prerequisites

**Your project must be on Lean `v4.32.2`.** The package pins its toolchain and its dependencies to that release; projects on a different toolchain will fail to resolve them cleanly. Mathlib `v4.32.2` is the matching release.

You also need the [Lean 4 VS Code extension](https://marketplace.visualstudio.com/items?itemName=leanprover.lean4) since the tree widget operates in the infoview panel.

---

## 1. The Lean Package

Add one dependency to your project's `lakefile.toml`:

```toml
[[require]]
name = "ramify"
git = "https://github.com/aidanmaney/ramify-lean4.git"
subDir = "dist"
rev = "main"
```

<details>
<summary>lakefile.lean instead of lakefile.toml</summary>

```lean
require ramify from git
  "https://github.com/aidanmaney/ramify-lean4.git" @ "main" / "dist"
```
</details>

Then:

```bash
lake update ramify && lake build
```

This will pull the **Paperproof** Lean 4 library, whose parser is where every Ramify tree starts (see [NOTICE](NOTICE)), and **ProofWidgets v0.0.105**, needed for rendering javascript in the infoview (this is the same version Mathlib `v4.32.2` pins, so Mathlib projects resolve to one copy rather than conflicting). Note: neither pulls Mathlib.

A fresh build will take a few minutes; mostly building ProofWidgets. Further builds will be much faster since they need only rebuild Ramify.

To turn the panel on in a `.lean` proof file:

```lean
import Ramify
show_panel_widgets [Ramify]

theorem demo (a b : Nat) (h : a = b) : a + 0 = b := by
  rw [Nat.add_zero]
  exact h
```

Put your cursor inside the proof and the tree will appear in the infoview. It follows the cursor; the panel is on for the whole file after the top `show_panel_widgets` line.

### Quickstart

If you only want to look at it without Mathlib (omits the full dependency):

```bash
git clone https://github.com/aidanmaney/ramify-lean4.git
cd ramify-lean4/dist && lake build
code .
```

then open `Demo.lean` — a simple file with five small proofs and a list of things to try. 
OR skip to `ProofTreeTour.lean` for a longer guided walkthrough.

> [!IMPORTANT]
> The tour will not compile since it demonstrates failed/in-progress proofs.

## 2. The VS Code Extension

The extension ships as a `.vsix` file inside this package. Where that file is depends on how you installed the Lean package:

```bash
# If you cloned this repository (the "try it" route above), from its root:
code --install-extension dist/ramify-0.0.19.vsix

# If you added ramify as a Lake dependency, from your project's root:
code --install-extension .lake/packages/ramify/dist/ramify-0.0.19.vsix
```

Or via the VS Code GUI: Extensions &#8594; &#8943; &#8594; Install from VSIX… &#8594; pick `ramify-0.0.19.vsix`. Reload the window afterwards (command palette).

### What the Extension Adds

- **The lens** (`⧉` on a tactic's hover bar)
	- Opens the proof in an editor pane split below the infoview.
	- A tactics resulting goals are drawn inline after the tactic.
	- Uses the same window, document, and Lean server as your original pane so vim/LSP suggestions/keybindings work.
- **Theme-accurate syntax colours**
	- Otherwise defaults to generic Light/Dark themes.
- **Reveal in source** (a node click, `»` on the hover bar, &#8984;-click, or a message in the status bar's diagnostics strip)
	- Jumps the editor to that tactic's range, and retargets to the lens when one is open rather than to the main buffer.
- **Hover-highlight**
	- Hovering a tactic node shows its range in the visible editors; arming a delete (the trash can) previews the extent the same way.
- **Undo/redo from the tree** (&#8984;Z / &#8984;&#8679;Z with the tree focused).
	- Edits made from the tree leave focus in the webview, where &#8984;Z won't do anything; works around this by focusing the editor.
- **Name a hoisted `have`** (`⤴`, in a tactic's `⋯` menu)
	- Hoisting a `(by …)` writes `have this : … := by …`; the companion then opens the editor's own Rename Symbol on `this` once Lean has caught up, so you type the name and Lean renames every use. Escape keeps `this`. `ramify.restructure.renameAfterHoist` turns it off.
- **Optional model polish of the generated narration** (off by default)
	- In `Comments: narrate` the tree writes a sentence per step from the step itself; turning on `ramify.narration.polish` sends those sentences — and nothing you wrote yourself — to be rewritten as fluent English, shown with `≈` instead of `∴`. Run **Ramify: Set narration API key** once from the command palette (the key is kept in VS Code's secret storage, never in a setting and never logged); `ramify.narration.model` chooses the model and `ramify.restructure.propose` lets `suggest a rewrite` ask for one of the restructurings the tree already offers.
- **Settings** (see the extension itself for detailed descriptions):
	- `ramify.experience` (`beginner` / `intermediate` / `expert`; also **Ramify: Set experience level**) — how much the tree explains itself; it only fills defaults,
	- `ramify.hoverBar.tactic`, `ramify.hoverBar.goal` — which icons each hover bar carries (the `⋯` menu's pins write these),
	- `ramify.outlineOnly`,
	- `ramify.linkMarks`,
	- `ramify.linkTint`,
	- `ramify.counterfactual`,
	- `ramify.typingHoldMs`,
	- `ramify.lensGoals`,
	- `ramify.lensWordWrap`,
	- `ramify.narration.polish`, `ramify.narration.model`, `ramify.restructure.propose`,
	- `ramify.restructure.renameAfterHoist`,
	- Also adds any custom `lean4.input.*` unicode-abbreviations

---

## Troubleshooting

If the tree says “no proof here” with the cursor inside a proof, check the toolchain first (see [Prerequisites](#prerequisites)). If an action does nothing e.g. the lens not opening or colors not following the theme, read the Ramify output channel (View &#8594; Output, pick it from the dropdown); if you cannot resolve the issue on your own raise it on GitHub.

---

## This Repo

```python
dist/                       the Lake package and sample files
  lakefile.toml             requires Paperproof + ProofWidgets, no Mathlib
  lean-toolchain            v4.32.2
  lake-manifest.json        pinned dependency set
  Demo.lean                 the try-it file
  ProofTreeTour.lean        the guided tour
  ramify-*.vsix
lean/                       the Lean sources the package compiles
  Ramify.lean               the panel widget + RPC machinery
  ProofTreeComments.lean    handles comments and editing
  ProofTreeRecover.lean     supplemental parser for erroring tactics and term proofs
web/dist/proofTreeWidget.js the renderer bundle
ext/ramify/       the VS Code extension
```

> [!Note]
> The layout above is what an install gives you, and it is a subset of this repository — you are reading the source. `dist/` is assembled by `./package.sh` and copied to this repository's `main` branch, which is what the instructions above clone; development happens here on `dev`. Sources are shared rather than copied: every library in `dist/lakefile.toml` points its source directory back at `lean/`, so the two cannot drift. `web/dist/proofTreeWidget.js` is minified there and here alike — it is a build artifact of `web/src/`, tracked because `Ramify.lean` reads it with `include_str` and a fresh clone runs no npm step.

Ramify is MIT licensed; see [LICENSE](LICENSE). It builds on Paperproof, ProofWidgets and `@leanprover/unicode-input`; see [NOTICE](NOTICE) for the breakdown.

[^1]: It's likely possible the widget works with other editors but this is not currently tested/supported. Doing so is left as an exercise for the user.
