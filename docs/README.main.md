# Ramify

An interactive proof tree widget for Lean 4 drawn in the VS Code Lean infoview. It reads the tactics under your cursor and lets you read and edit the source proof from the tree. Comes in two parts: the widget and a VS Code extension.

<img height="420" alt="image" src="https://github.com/user-attachments/assets/f17400d8-79b3-4b4c-a3d3-5cf6c59c1667" />



## Install

Add one dependency to your project's `lakefile.toml`:

```toml
[[require]]
name = "ramify"
git = "https://github.com/aidanmaney/ramify-lean4.git"
subDir = "dist"
rev = "v1.0.0"
```

then `lake update ramify && lake build`, and put `import Ramify` and `show_panel_widgets [Ramify]` at the top of a proof file. The tree follows your cursor in the infoview. The VS Code extension (`dist/ramify-1.0.0.vsix`) is optional and adds the lens, reveal in source, undo/redo from the tree and theme-accurate colours.

To look at it first without touching a project, see the [Quickstart](INSTALL.md#quickstart). Full instructions, settings, troubleshooting and uninstall are in [INSTALL.md](INSTALL.md).

> [!Note]
> - Your project must be on Lean `v4.32.2` (with Mathlib `v4.32.2` if you use Mathlib), with VS Code 1.85 or later and the Lean 4 extension. macOS is what it is tested on; Linux and Windows are expected to work but are less tested.
> - The first build takes a few minutes, almost all of it ProofWidgets compiling its own widget JS.
> - `ProofTreeTour.lean` purposefully does not compile, since it shows errors/proofs in progress.
> - Nothing is sent anywhere unless you turn on one of the two optional model features (narration polish, suggest a rewrite) and give it an API key; see [Privacy](INSTALL.md#privacy-and-the-optional-model-features) and [SECURITY.md](SECURITY.md).
> - While the lens is open the extension hides tabs, breadcrumbs, the minimap and sticky scroll through your user settings, and restores them when it closes; `ramify.lensHideChrome` turns that off.

Release notes: [CHANGELOG.md](CHANGELOG.md).

## Built on Paperproof

Ramify would not exist without [Paperproof](https://github.com/Paper-Proof/paperproof), by Anton Kovsharov, Evgenia Karunus and other contributors. We graciously build upon their parser for this project.

This project is MIT licensed: see [LICENSE](LICENSE). For third-party attribution see [NOTICE](NOTICE).
