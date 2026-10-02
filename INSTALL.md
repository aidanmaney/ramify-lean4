# Installing Ramify

An interactive proof tree visualizer for Lean 4, drawn in the VS Code infoview. Read a proof as a tree, edit it in place, and choose what the tree shows you.

Ramify comes in two parts: a Lean 4 widget and a VS Code extension.[^1] ([Quickstart](#quickstart))

|                                              |                                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Lean package** `ramify`                 | the tree itself, control panel, renderer and Lean 4 plumbing                                                                                                             |
| **VS Code extension** `ramify` | adds a minimal editing pane, source code tactic highlighting, show tactic/goal in source, undo/redo buttons, theme-accurate syntax colours, persistent global settings |
|                                              |                                                                                                                                                                          |

---

## Prerequisites

**Your project must be on Lean `v4.32.2`.** The package pins its toolchain and its dependencies to that release; projects on a different toolchain will fail to resolve them cleanly. Mathlib `v4.32.2` is the matching release.

You also need the [Lean 4 VS Code extension](https://marketplace.visualstudio.com/items?itemName=leanprover.lean4) since the tree widget operates in the infoview panel. The Ramify extension declares it as a dependency.

### Supported versions

| Component | Version |
| --- | --- |
| Lean | `v4.32.2` (the package's `lean-toolchain`) |
| Mathlib, if your project uses it | `v4.32.2` |
| ProofWidgets | `v0.0.105` (what Mathlib `v4.32.2` pins, so the two resolve to one copy) |
| Paperproof | pinned by commit in `dist/lakefile.toml`; never a floating `rev` |
| VS Code | 1.85 or later |
| Lean 4 VS Code extension (`leanprover.lean4`) | required |
| Operating system | macOS is what Ramify is developed and tested on. Linux and Windows are expected to work but are less tested, so expect rough edges and please report them |

Other editors are not supported: the widget may work in them, but that is untested.

---

## 1. The Lean Package

Add one dependency to your project's `lakefile.toml`:

```toml
[[require]]
name = "ramify"
git = "https://github.com/aidanmaney/ramify-lean4.git"
subDir = "dist"
rev = "v1.0.0"
```

`rev = "v1.0.0"` pins your project to that release, so an update is a change you make on purpose. The `main` branch follows the latest release; use `rev = "main"` if you want each `lake update` to take the newest.

<details>
<summary>lakefile.lean instead of lakefile.toml</summary>

```lean
require ramify from git
  "https://github.com/aidanmaney/ramify-lean4.git" @ "v1.0.0" / "dist"
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
code --install-extension dist/ramify-1.0.0.vsix

# If you added ramify as a Lake dependency, from your project's root:
code --install-extension .lake/packages/ramify/dist/ramify-1.0.0.vsix
```

Or via the VS Code GUI: Extensions &#8594; &#8943; &#8594; Install from VSIX… &#8594; pick `ramify-1.0.0.vsix`. Reload the window afterwards (command palette).

The same `.vsix` is attached to each [GitHub release](https://github.com/aidanmaney/ramify-lean4/releases).

### What the Extension Adds

- **The lens** (`⧉` in a tactic's `⋯` menu, or **Ramify: Open Tactic in Lens** from the command palette)
	- Opens the proof in an editor pane split below the infoview.
	- A tactic's resulting goals are drawn inline after the tactic.
	- Uses the same window, document, and Lean server as your original pane so vim/LSP suggestions/keybindings work.
	- **While the lens is open, Ramify hides editor tabs, breadcrumbs, the minimap and sticky scroll.** It does this by changing your *user-level* VS Code settings (`workbench.editor.showTabs`, `breadcrumbs.enabled`, `editor.minimap.enabled`, `editor.stickyScroll.enabled`), so the change applies to every VS Code window, not only the one with the lens. It remembers what those settings were, restores them when the lens closes, and restores them on the next start if VS Code quit or crashed with the lens open. Set `ramify.lensHideChrome` to `false` to leave them alone. If you ever find them still changed after the lens has closed, see [Troubleshooting](#troubleshooting).
- **Theme-accurate syntax colours**
	- Otherwise defaults to generic Light/Dark themes.
- **Show in source** (a node click, `»` on the hover bar, ⌘-click, or a message in the status bar's diagnostics strip)
	- Jumps the editor to that tactic's range, and retargets to the lens when one is open rather than to the main buffer.
- **Hover-highlight**
	- Hovering a tactic node shows its range in the visible editors; arming a delete (the trash can) previews the extent the same way.
- **Undo/redo from the tree** (⌘Z / ⌘⇧Z with the tree focused)
	- Edits made from the tree leave focus in the webview, where ⌘Z won't do anything; the extension works around this by focusing the editor.
- **Name a hoisted `have`** (`⤴`, in a tactic's `⋯` menu)
	- Hoisting a `(by …)` writes `have this : … := by …`; the extension then opens the editor's own Rename Symbol on `this` once Lean has caught up, so you type the name and Lean renames every use. `Esc` keeps `this`. `ramify.restructure.renameAfterHoist` turns it off.
- **Optional model features** (both off by default; see [Privacy](#privacy-and-the-optional-model-features))
	- *Polish*: in `Comments: narrate` the tree writes a sentence per step from the step itself; with `ramify.narration.polish` on, those sentences are sent to be rewritten as fluent English, shown with `≈` instead of `∴`.
	- *Suggest a rewrite*: with `ramify.restructure.propose` on, the tree's reading options gain `suggest a rewrite`, which asks a model to pick one of the restructurings the tree already offers. The model never writes text; whatever it picks is still checked by Lean before you are offered it.
	- Rows that need a model are not drawn at all unless the setting is on and a key is available.

### Commands

| Command | What it does |
| --- | --- |
| **Ramify: Open Tactic in Lens** | Opens the tactic under the cursor in the lens (the same as `⧉` in the tree). |
| **Ramify: Set experience level** | A quick pick that writes `ramify.experience`. |
| **Ramify: Set model API key** | Stores an Anthropic API key in VS Code's secret storage, for the two model features. Leave it empty to clear the stored key. |

### Experience levels

`ramify.experience` picks one of three presets. A preset only fills defaults; anything you switch in the tree keeps your choice for the session.

<!-- gen-experience:start -->
<!-- generated by scripts/gen-experience.mjs from web/src/experience.ts — do not edit by hand -->

| | beginner | intermediate | expert |
| --- | --- | --- | --- |
| Comments | narrate | show | show |
| Context | all | used | used |
| Brief | off | off | on |
| Lints | on | on | off |
| Hypothesis origins | on | off | off |
| Automation trace | opens by itself for the step under the cursor | on click | on click |
| Tactic hover bar | default, plus ⁇ | default | default |
| Replace with automation (⇓) | not offered | offered | offered |

<!-- gen-experience:end -->

### Settings

All settings live under `ramify.` in VS Code's settings UI; the extension's own descriptions there are the detailed ones. `ramify.experience` and `ramify.hoverBar.*` can be set per workspace folder: each window (and each folder of a multi-root workspace) uses the value for the folder that holds the file being shown, so one workspace's choice does not change another window's tree.

| Setting | Default | What it does |
| --- | --- | --- |
| `ramify.experience` | `intermediate` | `beginner`, `intermediate` or `expert`: how much the tree explains itself. A preset that only fills defaults (the hover bar's buttons, the automation trace, comments, context, lints, brief mode, and whether hovering a context line shows where the hypothesis came from — on for beginner); anything you switch in the tree keeps your choice for the session. Also **Ramify: Set experience level**. |
| `ramify.hoverBar.tactic`, `ramify.hoverBar.goal` | source, focus, skip, path, delete | Which icons each hover bar carries, in order. `⋯` is always last. The `⋯` menu's pins write these; unset, the experience preset decides. |
| `ramify.outlineOnly` | off | Draw node boxes as borders with no fill. Cosmetic. |
| `ramify.linkMarks` | off | Draw a dot near either end of a connector for goals, a dash for tactics. |
| `ramify.linkTint` | off | Tint each connector by the node it ends at. |
| `ramify.hypMarkStyle` | `highlight` | How the tree marks the hypotheses a tactic uses while you hover its box: `highlight` or `underline`. |
| `ramify.counterfactual` | on | While the line you are typing does not elaborate, draw the tree as if it were `sorry`, so the tree keeps its shape. Costs one Lean re-check of the current theorem per edited line (cached). |
| `ramify.typingHoldMs` | `600` | How long the cursor must sit still after you type before the tree redraws (0 to 5000; `0` redraws on every change). Edits made from the tree always redraw at once. |
| `ramify.lensGoals` | on | Show each tactic's resulting goal inline after its line in the lens. |
| `ramify.lensWordWrap` | on | Wrap long lines in the lens only. Skipped when you already wrap globally. |
| `ramify.lensHideChrome` | on | Hide editor tabs, breadcrumbs, the minimap and sticky scroll while the lens is open (user-level settings, restored when it closes; see [The lens](#what-the-extension-adds)). Off leaves them alone. |
| `ramify.restructure.renameAfterHoist` | on | Open Rename Symbol on `this` after an accepted `⤴` extract. |
| `ramify.narration.polish` | off | Send the generated narration to a model to be rewritten. Needs a key. |
| `ramify.narration.model` | `claude-haiku-4-5-20251001` | The model used for both model features. |
| `ramify.restructure.propose` | off | Enable `suggest a rewrite`. Needs a key. |

The extension also adds any custom `lean4.input.*` unicode abbreviations you have set, so they work in the tree's editors.

### Privacy and the optional model features

Ramify sends nothing anywhere by default. The Lean widget and the extension talk to each other through files in `~/.proof-tree-companion` on your machine, and neither reaches the network unless you turn one of the two model features on.

A request goes to `api.anthropic.com` only when **both** are true: the setting is on (`ramify.narration.polish` or `ramify.restructure.propose`) and a key is available. The key comes from **Ramify: Set model API key** (kept in VS Code's secret storage, never in a setting or a file, and never logged) or, if none is stored, from the `ANTHROPIC_API_KEY` environment variable of the VS Code process. A workspace's settings can switch the features on, but they do nothing without a key you stored yourself or exported.

What is sent:

- **Polish**: for each narrated step, the generated sentence, the tactic's text, and the goal states before and after it. Your own comments are never sent. At most 200 steps go in one request.
- **Suggest a rewrite**: the tree's outline as text (up to about 8000 characters of the proof's text) and the list of rewrites the tree already offers.

Answers are cached in VS Code's own state, so a step you have already had polished is not sent again. The output channel logs the request id, counts, latency and token usage — not the text.

### Keyboard and mouse

The tree can be read and edited from the keyboard. `Tab` moves focus into it (one tab stop, ring on the current box); then:

| Key | Does |
| --- | --- |
| `↑` `↓` `Home` `End` | move through the boxes, top to bottom in reading order |
| `→` / `←` | open or fold a goal; otherwise step to its first child / its parent |
| `Enter` | go to the source |
| `F2` | edit a tactic in place |
| `⇧↑` `⇧↓` | select a run of boxes from the current one, as a drag does; `Tab` moves into the pill's buttons (`←` `→` between them, `Enter` runs one), `Esc` clears |
| `⇧F10` (or the Menu key) | open the box's moves menu — on an open goal it also offers the chips' moves (add a tactic, `sorry`, `calc`), on a calc its show-every-row toggle |
| `<` / `>` | go to the previous / next mark (from not started, `>` takes the first, `<` the last) |
| `Esc` | close one thing at a time, the top layer first; focus stays |

With the pointer:

| Gesture | Does |
| --- | --- |
| click the top-right corner of a goal | fold or unfold everything below it |
| click the top-left corner of a box | drop a mark there; `⌥`-click writes a `.mark` into the source |
| `⌥`-click a goal / a tactic | focus the goal's subtree / skip the step |
| `⌥`-click an item in the status bar | cycle its setting instead of opening its panel |
| `⌥`-click `+` / `−` on the zoom rail | unfold every branch and restore every skipped run / fold every branch (also "Expand all" / "Collapse to the outline" in the Layout panel) |
| `⌘`-scroll | zoom at the pointer |
| drag on the background | select a region, then fold, skip or write a flag from the pill |
| `+`, `sorry`, `calc` chips on an open goal | add a tactic there, stub it with `sorry`, or start a `calc` |

`?` (or `F1`) opens the key list in the tree itself. Status-bar panels and menus take `↑` `↓` `Home` `End`, and `Tab` closes them.

This document and the tree's tooltips are written for macOS. On Windows and Linux:

| Written as | Use |
| --- | --- |
| ⌘ (e.g. ⌘-click, ⌘Z) | `Ctrl` (`Ctrl`-click, `Ctrl+Z`, `Ctrl+Shift+Z`) |
| ⌥ (e.g. ⌥-click) | `Alt` (`Alt`-click) |
| ⇧ | `Shift` |

Some Linux window managers reserve `Alt`-click for moving windows; if `Alt`-click does nothing in the tree, change that in your window manager's settings. `Esc`, double-click, `F2` and the tree's `<` and `>` keys are the same everywhere.

---

## Troubleshooting

**The tree says "no proof here" with the cursor inside a proof.** Check the toolchain first (see [Supported versions](#supported-versions)), then that the file starts with `import Ramify` and `show_panel_widgets [Ramify]`, and that the file's Lake project depends on `ramify`.

**The tree shows an old version after an update, or a change to the package has no effect.** The Lean file worker keeps the bundle it loaded when the file was opened. Click **Restart File** in the infoview (or run *Lean 4: Restart File*) after `lake build`.

**An action does nothing** (the lens does not open, colours do not follow the theme, a hover-highlight is missing). Open View → Output and pick **Ramify** from the dropdown; every request the extension handles or skips is logged there, with the reason. If you cannot resolve it, raise it on [GitHub](https://github.com/aidanmaney/ramify-lean4/issues) with that log.

**Syntax colours are the generic light or dark ones.** The extension is not installed, or not running in this window. Check the Extensions view, and reload the window after installing.

**A model row (`polish`, `suggest a rewrite`) is missing from the reading options.** It is drawn only when its setting is on and a key is available: turn on `ramify.narration.polish` or `ramify.restructure.propose`, and run **Ramify: Set model API key** (or set `ANTHROPIC_API_KEY` before starting VS Code).

**Tabs, breadcrumbs, the minimap or sticky scroll are gone after using the lens.** They come back when the lens closes, or on the next start if VS Code quit with it open. If they do not, restore them in your user settings by hand (`workbench.editor.showTabs`, `breadcrumbs.enabled`, `editor.minimap.enabled`, `editor.stickyScroll.enabled`), and set `ramify.lensHideChrome` to `false` so it does not happen again. Please report it with the Ramify output channel.

**The package and the extension are different versions.** They are released together and should match. Check the extension's version in the Extensions view against the `rev` in your `lakefile`; after `lake update ramify`, reinstall the `.vsix` from `.lake/packages/ramify/dist/` and reload the window.

**The first build takes a long time.** Almost all of it is ProofWidgets compiling its own JavaScript. Later builds only rebuild Ramify.

---

## Uninstall

1. Close the lens first, if it is open, so the editor chrome it hid is restored.
2. Remove the `[[require]]` block for `ramify` from your `lakefile.toml` (or the `require ramify …` line from `lakefile.lean`), and the `import Ramify` and `show_panel_widgets [Ramify]` lines from your files. Run `lake update` if you want the manifest cleaned up.
3. Uninstall the **Ramify** extension from the Extensions view, and reload the window.
4. Delete `~/.proof-tree-companion` (on Windows, `.proof-tree-companion` in your user profile folder). It holds only the request and theme files described in [SECURITY.md](SECURITY.md).
5. If you stored an API key, run **Ramify: Set model API key** and submit it empty before you uninstall; that clears it from VS Code's secret storage.

Removing the settings you changed under `ramify.` is optional; they do nothing without the extension.

---

Release notes are in [CHANGELOG.md](CHANGELOG.md); to report a security problem see [SECURITY.md](SECURITY.md).

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
  ProofTreeHarvest.lean     diagnostics, tactic tokens, header and hovers for the tree
web/dist/proofTreeWidget.js the renderer bundle
ext/ramify/       the VS Code extension
```

> [!Note]
> The layout above is what an install gives you, and it is a subset of this repository — you are reading the source. `dist/` is assembled by `./package.sh` and copied to this repository's `main` branch, which is what the instructions above clone; development happens here on `dev`. Sources are shared rather than copied: every library in `dist/lakefile.toml` points its source directory back at `lean/`, so the two cannot drift. `web/dist/proofTreeWidget.js` is minified there and here alike — it is a build artifact of `web/src/`, tracked because `Ramify.lean` reads it with `include_str` and a fresh clone runs no npm step.

Ramify is MIT licensed; see [LICENSE](LICENSE). It builds on Paperproof, ProofWidgets and `@leanprover/unicode-input`; see [NOTICE](NOTICE) for the breakdown.

[^1]: It's likely possible the widget works with other editors but this is not currently tested/supported. Doing so is left as an exercise for the user.
