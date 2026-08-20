# Ramify

The editor side of [Ramify](https://github.com/aidanmaney/ramify-lean4), a proof-tree visualizer and editor for Lean 4 that lives in the infoview. The tree widget comes from the Ramify Lake package which should be installed first (see its INSTALL.md). This extension adds what needs the editor integration:

- **The lens** — `⧉` on a tactic opens the proof in a slim pane below the infoview
- **Reveal** — click a tactic in the tree to jump to it in the source
- **Live highlights** — hovering a tactic highlights it in the editor
- **Undo / redo** — the tree’s `↶` `↷` buttons work by routing it through the editor
- **Native Theming** — syntax colors in the tree are resolved from your theme; without this they fall back to generic light/dark palettes
- **Additional Settings** — permanent widget display settings

## Troubleshooting

Every request the extension handles or skips is logged to the **Ramify** output channel (View → Output). If an action does nothing, check that first.

MIT licensed.
