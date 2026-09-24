# Ramify

The editor side of [Ramify](https://github.com/aidanmaney/ramify-lean4), a proof-tree visualizer and editor for Lean 4 that lives in the infoview. The tree widget comes from the Ramify Lake package which should be installed first (see its INSTALL.md). This extension adds what needs the editor integration:

- **The lens** — `⧉` (in a tactic's `⋯` menu, or pinned to its hover bar) opens the proof in a slim pane below the infoview
- **Reveal** — click a tactic in the tree to jump to it in the source
- **Live highlights** — hovering a tactic highlights it in the editor
- **Undo / redo** — the tree’s `↶` `↷` buttons work by routing it through the editor
- **Native Theming** — syntax colors in the tree are resolved from your theme; without this they fall back to generic light/dark palettes
- **Optional model polish** — with `ramify.narration.polish` on and a key set (**Ramify: Set narration API key**), the tree's own generated narration is rewritten as fluent English; nothing you wrote yourself is ever sent, and the key lives in VS Code's secret storage
- **Experience level** — `ramify.experience` (`beginner` / `intermediate` / `expert`, or **Ramify: Set experience level**) sets how much the tree explains itself: the automation step under the cursor showing what it used, and the defaults for comments, context, lints and brief mode. It only fills defaults; what you switch in the tree keeps your choice
- **Hover-bar buttons** — `ramify.hoverBar.tactic` and `ramify.hoverBar.goal` choose which icons a box's hover bar carries, in order (default: source, focus, skip, path, delete); `⋯` is always last, names every move with its icon, and its pin toggles write these settings
- **Additional Settings** — permanent widget display settings

## Troubleshooting

Every request the extension handles or skips is logged to the **Ramify** output channel (View → Output). If an action does nothing, check that first.

MIT licensed.
