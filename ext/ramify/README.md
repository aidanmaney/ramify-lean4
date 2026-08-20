# Ramify

The editor side of [Ramify](https://github.com/aidanmaney/ramify-lean4), a
proof-tree visualizer and editor for Lean 4 that lives in the VS Code
infoview.

The tree itself comes from the Ramify Lake package — install that first
(see its INSTALL.md). It draws and edits proofs on its own; this extension
adds the gestures that need the editor's cooperation:

- **The lens** — the `⧉` button on a tactic (or the `Ramify: Open Tactic in
  Lens` command) opens the proof in a slim pane directly below the infoview,
  tactic selected, each tactic's resulting goal drawn inline at the end of
  its line. Same window, same document, same Lean server — vim, LSP and your
  keybindings all still work, and edits sync with no re-elaboration.
- **Reveal** — click a tactic in the tree to jump to it in the source, in
  the lens when one is open.
- **Live highlights** — hovering a tactic lights its range in the editor,
  and arming a delete shows exactly the lines it would remove, before you
  confirm.
- **Undo / redo** — the tree's `↶` `↷`, wired to the editor's own history.
- **Your theme, in the tree** — the tree's syntax colours are resolved from
  your actual colour theme, so its labels match the buffer. (A webview
  cannot read token colours on its own.)
- **Settings** — everything under `ramify.*` in the Settings UI: link marks
  and tint, the counterfactual typing preview, the redraw hold, and more.
  Each is documented where you set it.

## Troubleshooting

Every request the extension handles — or deliberately skips — is logged to
the **Ramify** output channel (View → Output). If a tree gesture seems to do
nothing, read that first.

MIT licensed.
