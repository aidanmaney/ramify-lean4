# proof-tree-companion

Editor-side companion for the proof-tree infoview widget. The infoview's
`EditorApi` has no `executeCommand`, so gestures that need workbench commands
are relayed through the filesystem: the widget calls the
`ProofTree.popoutEdit` RPC, the Lean server writes a one-shot request to
`~/.proof-tree-companion/popout-request.json`, and this extension's watcher
executes it. Intended to also grow the widget's global settings / persistent
state.

Current actions (the request file carries an `action` field):

- **Reveal** (`action: "reveal"` — a plain click on a tactic node): show the
  range in the **lens when one is open**, else in the first visible editor
  of the document. The target editor's cursor move flows back to the widget
  as the cursor accent, closing the tree↔editor loop. (vscode-lean4's own
  `revealLocation` always picks the first visible editor, which is why this
  routes through the companion.)

- **Lens edit** (the `⧉` button on a tactic node's hover bar, or the
  `Proof Tree: Open Tactic in Lens` command acting on the active editor's
  cursor): open the
  proof in a slim **lens editor group split off directly below the Lean
  infoview's group**, with the tactic's tight range selected and revealed at
  the top, line numbers off. Same window, same document, same Lean server —
  vim/LSP/keybindings apply and edits sync with zero re-elaboration; the
  lens is reused by subsequent popouts while it stays open. While a lens is
  open, chrome is stripped globally (no per-window settings API exists) to
  maximize the infoview column: tab rows, breadcrumbs, glyph margin, folding
  controls, minimap, sticky scroll, and a reduced `editor.fontSize` (scaled
  from the user's own, so it suits any starting size) — all restored when the
  lens closes, with a PID-stamped
  on-disk snapshot for crash recovery. An existing lens is re-found down a
  ladder (remembered column → our `lineNumbers: Off` tag → a second group
  already showing the doc), so a window reload or a viewColumn renumber
  can't strand one and split a second underneath it. Also reachable as a
  `vscode://aidan.proof-tree-companion/edit?uri&startLine&startChar&endLine&
  endChar` deep link (OS-side tooling only — the infoview webview cannot fire
  deep links: vscode-lean4's `showDocument` drops non-file URIs, and
  synthetic anchor clicks navigate the webview blank).

- **Highlight / clear** (`action: "highlight"` / `"clear"` — hovering a tactic
  node, debounced widget-side): paint a decoration over the range in every
  visible editor for the document, without moving the cursor or stealing
  focus the way a reveal would. The only chatty traffic on the relay, so it
  is the one thing the log skips.

Only the window that owns the request reacts — it must have the document's
workspace folder OR have the document open (a file outside any workspace
folder has no folder, and the workspace test alone would silently drop it).
A nonce dedupes fs.watch's duplicate events.

## Debugging

The relay is invisible by construction: a file written by a Lean server, read
by a watcher in another process. So the companion logs every request, skip
reason and failure to an **Output channel named "Proof Tree Companion"**. When
a widget gesture appears to do nothing, read that first — it distinguishes
never-arrived from arrived-and-skipped from arrived-and-threw.

## Dev install

No build step (plain CommonJS). Symlink into the extensions dir and reload:

```bash
ln -s "$(pwd)/ext/proof-tree-companion" ~/.vscode/extensions/aidan.proof-tree-companion-0.0.2
```

Uninstall by removing the symlink. After changing `package.json` (e.g.
activation events), a full VS Code restart may be needed for the manifest
rescan; `extension.js` changes need only a window reload.

## Settings

- `proofTree.lensFontScale` (default `0.85`) — scales `editor.fontSize` while
  the lens is open. Unavoidably global: VS Code has no per-editor font API, so
  the main editor shrinks too. Set to `1` to leave your font untouched (the
  key is then never written at all); height and sticky-scroll removal still
  apply.
- `proofTree.lensShrinkNudges` (default `3`) — how far to shrink the lens below
  the 50% split it opens at. The split is ~8-9 nudges tall, so **lower is
  taller**; `0` keeps it at half the column.

Changing `package.json` needs a full VS Code restart (manifest rescan);
`extension.js` changes need only a window reload.
