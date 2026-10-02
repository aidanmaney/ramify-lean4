# Changelog

The full changelog is [CHANGELOG.md](https://github.com/aidanmaney/ramify-lean4/blob/main/CHANGELOG.md) in the repository. The 0.0.x releases were pre-release builds.

## 1.0.0 — 2026-09-28

The first stable release of the extension, released together with the Ramify Lake package `v1.0.0`; install the two at matching versions.

- The lens (`⧉`, or **Ramify: Open Tactic in Lens**), show in source, hover highlights, undo/redo from the tree, theme-accurate colours, and Rename Symbol after an extract.
- Settings: `ramify.experience`, `ramify.hoverBar.*`, `ramify.hypMarkStyle`, `ramify.lensHideChrome` and the rest, all documented in INSTALL.md. While the lens is open it hides tabs, breadcrumbs, the minimap and sticky scroll through user settings; `ramify.lensHideChrome: false` turns that off.
- Optional model features (`ramify.narration.polish`, `ramify.restructure.propose`), off by default. They send text to `api.anthropic.com` only when the setting is on and a key is available (**Ramify: Set model API key** or `ANTHROPIC_API_KEY`).
- Hardening: every request file is validated (size, shape, document ownership); the settings restored after the lens closes are allowlisted; the file watcher recovers from errors; activation is on startup so a crash with the lens open is repaired in any window.
- Request files are written atomically and the `~/.proof-tree-companion` directory is found through `USERPROFILE` where `HOME` is unset. A model request is answered by one window only: the focused window that has a Lean file open claims it.
