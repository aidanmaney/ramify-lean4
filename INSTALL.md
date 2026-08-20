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

This will pull the **Paperproof** Lean4 library whose parser we graciously build upon and **ProofWidgets v0.0.105**, needed for rendering javascript in the infoview (this is the same version Mathlib `v4.32.2` pins, so Mathlib projects resolve to one copy rather than conflicting). Note: neither pulls Mathlib.

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
code --install-extension dist/ramify-0.0.14.vsix

# If you added ramify as a Lake dependency, from your project's root:
code --install-extension .lake/packages/ramify/dist/ramify-0.0.14.vsix
```

Or via the VS Code GUI: Extensions &#8594; &#8943; &#8594; Install from VSIX… &#8594; pick `ramify-0.0.14.vsix`. Reload the window afterwards (command palette).

### What the Extension Adds

- **The lens** (`⧉` on a tactic's hover bar)
	- Opens the proof in an editor pane split below the infoview.
	- A tactics resulting goals are drawn inline after the tactic.
	- Uses the same window, document, and Lean server as your original pane so vim/LSP suggestions/keybindings work.
- **Theme-accurate syntax colours**
	- Otherwise defaults to generic Light/Dark themes.
- **Reveal in source** (a node click, `»` on the hover bar, &#8984;-click, or a diagnostic in the top-left pill)
	- Jumps the editor to that tactic's range, and retargets to the lens when one is open rather than to the main buffer.
- **Hover-highlight**
	- Hovering a tactic node shows its range in the visible editors; arming a delete (`⊘`) previews the extent the same way.
- **Undo/redo from the tree** (`↶ ↷` on the rail).
	- Edits made from the tree leave focus in the webview, where &#8984;Z won't do anything; works around this by focusing the editor.
- **Settings** (see the extension itself for detailed descriptions):
	- `ramify.outlineOnly`,
	- `ramify.tallFrame`,
	- `ramify.linkMarks`,
	- `ramify.linkTint`,
	- `ramify.counterfactual`,
	- `ramify.typingHoldMs`,
	- `ramify.lensGoals`,
	- `ramify.lensWordWrap`,
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
> This is just a build, not the source, and is not intended to be edited. Hence why `web/dist/proofTreeWidget.js` is minified. The real source and development tooling is in another repo.

Ramify is MIT licensed; see [LICENSE](LICENSE). It builds on Paperproof, ProofWidgets and `@leanprover/unicode-input`; see [NOTICE](NOTICE) for the breakdown.

[^1]: It's likely possible the widget works with other editors but this is not currently tested/supported. Doing so is left as an exercise for the user.
