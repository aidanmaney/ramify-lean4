# Ramify

The editor side of [Ramify](https://github.com/aidanmaney/ramify-lean4), a proof-tree visualizer and editor for Lean 4 that lives in the infoview. The tree widget comes from the Ramify Lake package, which should be installed first: see [INSTALL.md](https://github.com/aidanmaney/ramify-lean4/blob/main/INSTALL.md) for the install steps, supported versions, troubleshooting and uninstall. This extension adds what needs the editor integration.

Requires VS Code 1.85 or later and the [Lean 4 extension](https://marketplace.visualstudio.com/items?itemName=leanprover.lean4).

## What it adds

- **The lens** — `⧉` (in a tactic's `⋯` menu, or pinned to its hover bar) or **Ramify: Open Tactic in Lens** opens the proof in a slim pane below the infoview
- **Show in source** — click a tactic in the tree to jump to it in the source
- **Live highlights** — hovering a tactic highlights it in the editor
- **Undo / redo** — ⌘Z / ⌘⇧Z (`Ctrl` on Windows and Linux) with the tree focused works by routing it through the editor
- **Native theming** — syntax colours in the tree are resolved from your theme; without this they fall back to generic light/dark palettes
- **Name a hoisted `have`** — after the tree's `⤴` writes `have this : … := by …`, the editor's own Rename Symbol opens on `this`
- **Optional model features** — polish of the generated narration, and `suggest a rewrite`; both off by default (see Privacy)

## Commands

- **Ramify: Open Tactic in Lens** — open the tactic under the cursor in the lens
- **Ramify: Set experience level** — pick `beginner`, `intermediate` or `expert`
- **Ramify: Set model API key** — store an Anthropic API key for the two model features; submit it empty to clear it

## Settings

Under `ramify.` in VS Code's settings UI.

**Reading**

- `ramify.experience` — `beginner` / `intermediate` / `expert`: how much the tree explains itself. It only fills defaults; what you switch in the tree keeps your choice
- `ramify.hoverBar.tactic`, `ramify.hoverBar.goal` — which icons each hover bar carries, in order; `⋯` is always last and its pins write these
- `ramify.hypMarkStyle` — `highlight` or `underline`: how the tree marks the hypotheses a tactic uses while you hover its box
- `ramify.counterfactual` — while the line you are typing does not elaborate, draw the tree as if it were `sorry`
- `ramify.typingHoldMs` — how long the cursor must sit still after you type before the tree redraws

**Appearance**

- `ramify.outlineOnly` — node boxes as borders with no fill
- `ramify.linkMarks` — node-type marks on the connectors
- `ramify.linkTint` — tint each connector by the node it ends at

**The lens**

- `ramify.lensGoals` — show each tactic's resulting goal inline
- `ramify.lensWordWrap` — wrap long lines in the lens only

**Editing**

- `ramify.restructure.renameAfterHoist` — open Rename Symbol on `this` after an accepted extract

**Model features** (off by default)

- `ramify.narration.polish` — send the generated narration to a model to be rewritten
- `ramify.restructure.propose` — enable `suggest a rewrite`
- `ramify.narration.model` — which model both features use (`claude-haiku-5-5` by default)

## The lens and your settings

The lens changes no settings. Versions before 1.1.0 hid tabs, breadcrumbs, the minimap and sticky scroll through your user-level settings while it was open; if one of those quit with the lens open, this version restores them on start.

## Privacy

Nothing is sent anywhere by default. The extension and the Lean widget talk through files in `~/.proof-tree-companion` on your machine.

With `ramify.narration.polish` on, the tactic text and the goal states before and after each narrated step, along with the generated sentence, are sent to `api.anthropic.com`; your own comments are never sent. With `ramify.restructure.propose` on, up to about 8000 characters of the proof's text and the outline of the rewrites the tree offers are sent. A request is made only when the setting is on **and** a key is available. The key comes from **Ramify: Set model API key** (VS Code's secret storage; never a setting, never written to a file, never logged) or from the `ANTHROPIC_API_KEY` environment variable. The output channel logs request ids, counts, latency and token usage, not text. See [SECURITY.md](https://github.com/aidanmaney/ramify-lean4/blob/main/SECURITY.md) for the details.

## Troubleshooting

Every request the extension handles or skips is logged to the **Ramify** output channel (View → Output). If an action does nothing, check that first. More in [INSTALL.md](https://github.com/aidanmaney/ramify-lean4/blob/main/INSTALL.md#troubleshooting).

[Changelog](CHANGELOG.md) · MIT licensed.
