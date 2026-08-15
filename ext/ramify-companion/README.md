# ramify-companion

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
  proof in a **lens editor group split off directly below the Lean
  infoview's group**, with the tactic's tight range selected and revealed at
  the top, line numbers off. It keeps the height the split gives it — it used
  to be shrunk by a run of view-height nudges, and each of those is an animated
  resize of the whole editor area, so opening a lens visibly stepped the window
  down and then re-placed its text. Same window, same document, same Lean server —
  vim/LSP/keybindings apply and edits sync with zero re-elaboration; the
  lens is reused by subsequent popouts while it stays open. While a lens is
  open, chrome is stripped globally (no per-window settings API exists) to
  maximize the infoview column: tab rows, breadcrumbs, glyph margin, minimap
  and sticky scroll — all restored when the lens closes, with a PID-stamped
  on-disk snapshot for crash recovery. Two things are deliberately **not** in
  that set any more: `editor.fontSize`, because a global setting resized every
  editor in the window to buy the lens four lines, and `editor.folding`, which
  is simply the user's own editor working normally and costs nothing in a pane
  with line numbers off. Restore iterates the *snapshot's* keys rather than
  the current strip list, so a backup written by an older version still puts
  back what that version took. An existing lens is re-found down a
  ladder (remembered column → our `lineNumbers: Off` tag → a second group
  already showing the doc), so a window reload or a viewColumn renumber
  can't strand one and split a second underneath it. Also reachable as a
  `vscode://aidan.ramify-companion/edit?uri&startLine&startChar&endLine&
  endChar` deep link (OS-side tooling only — the infoview webview cannot fire
  deep links: vscode-lean4's `showDocument` drops non-file URIs, and
  synthetic anchor clicks navigate the webview blank).

- **Highlight / clear** (`action: "highlight"` / `"clear"` — hovering a tactic
  node, debounced widget-side): paint a decoration over the range in every
  visible editor for the document, without moving the cursor or stealing
  focus the way a reveal would. The only chatty traffic on the relay, so it
  is the one thing the log skips.

- **Preview / preview-clear** (`action: "preview"` / `"preview-clear"` — the
  first click on a node's `⊘`): light the exact extent a delete would remove,
  so the second click confirms something you have seen. Its own action rather
  than a reuse of `highlight`, whose range is clamped to one line.

- **Annotate** (`action: "annotate"`, sent with a lens): draw each tactic's
  resulting goal at the end of its last line as an inline decoration —
  Alectryon-style, costing no lines. Lens only; the main editor has the
  infoview. Dropped on the first document change and re-sent by the widget.

- **Undo / redo** (`action: "undo"` / `"redo"` — the rail's `↶` `↷`): the
  widget's own edits leave focus in the webview, where the editor's ⌘Z reaches
  nothing. These are focus-dependent workbench commands with no
  document-targeted API, so the companion resolves the editor for the URI
  (the lens if one is open), focuses it, and executes — after which further
  undos are native, which is the better end state anyway.

The relay also has one **return** path: the companion resolves the active
colour theme (following the theme JSON's `include` chain) plus a handful of VS
Code settings the webview cannot read, and writes them to
`~/.proof-tree-companion/theme-colors.json`, which the widget reads back over
its own `ProofTree.themeColors` RPC. That is how tactic labels are coloured in
the user's real theme: a webview has no access to TextMate token colours, and
no CSS variable carries them.

Only the window that owns the request reacts — it must have the document's
workspace folder OR have the document open (a file outside any workspace
folder has no folder, and the workspace test alone would silently drop it).
A nonce dedupes fs.watch's duplicate events.

## Debugging

The relay is invisible by construction: a file written by a Lean server, read
by a watcher in another process. So the companion logs every request, skip
reason and failure to an **Output channel named "Ramify Companion"**. When
a widget gesture appears to do nothing, read that first — it distinguishes
never-arrived from arrived-and-skipped from arrived-and-threw.

## Dev install

No build step (plain CommonJS). Symlink into the extensions dir and reload:

```bash
ln -s "$(pwd)/ext/ramify-companion" ~/.vscode/extensions/aidan.ramify-companion-0.0.4
```

Uninstall by removing the symlink. After changing `package.json` (e.g.
activation events), a full VS Code restart may be needed for the manifest
rescan; `extension.js` changes need only a window reload.

## Settings

The lens's own, acted on by this extension:

- `ramify.lensWordWrap` (default `true`) — turn on word wrap in the lens.
  A per-editor *session* toggle, unlike the setting, so it affects nothing
  else; an editor already wrapping is left alone.
- `ramify.lensGoals` (default `true`) — the inline goal annotations
  described above.

Settings the extension only *relays* — it writes them into
`theme-colors.json` for the widget, which is the sole channel a webview has for
reading a VS Code setting:

- `ramify.outlineOnly` (default `false`) — draw node boxes as outlines, no
  fill.
- `ramify.tallFrame` (default `false`) — let the tree take 95% of the
  infoview column rather than 90%. Deliberately not 100%: the tree's own scroll
  container swallows the wheel, so the page needs a strip of itself to scroll
  from.
- `ramify.linkMarks` (default `true`) — the small marks on each connector
  saying whether it lands on a goal or a tactic. The accessible baseline (it
  survives without colour), hence the one of the two defaulting on.
- `ramify.linkTint` (default `false`) — tint each edge toward its target's
  hue.
- `ramify.counterfactual` (default `true`) — while you type a tactic and
  the proof doesn't elaborate, the tree shows the theorem as if the line you
  are writing were `sorry` (re-elaborated in the background, cached per
  line): full shape held, a dashed stub carrying your draft where the tactic
  lands, snapping to the real tree when it becomes valid.
- `ramify.typingHoldMs` (default `600`) — how long the cursor must sit
  still after typing before the tree redraws to match the changed proof, so
  typing in the buffer doesn't relayout the tree per keystroke. If you
  already paused, the redraw lands as soon as elaboration finishes — no
  added delay. Raise it if you type slowly and still see churn; `0` redraws
  on every change. Edits made from the tree itself always redraw
  immediately. Relayed raw; the widget owns the default and the clamp
  (0–5000).

`ramify.lensFontScale` is **gone**: it scaled a user-global
`editor.fontSize`, so it shrank every editor in the window (see above).

The configuration listener watches every one of these keys as well as the
colour theme — a key left out of it is a setting that would only take effect at
the next theme change.

Changing `package.json` needs a full VS Code restart (manifest rescan);
`extension.js` changes need only a window reload.
