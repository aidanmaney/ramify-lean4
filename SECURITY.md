# Security

Ramify is a Lean package (the widget, which runs in the infoview) and a VS Code extension. This page says what they read and write, what leaves your machine and when, and how to report a problem.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting: on [aidanmaney/ramify-lean4](https://github.com/aidanmaney/ramify-lean4), open the **Security** tab and choose **Report a vulnerability**. If that option is not available to you, open an [issue](https://github.com/aidanmaney/ramify-lean4/issues) that says you have a security problem and asks for a private way to send it, without the details. This is a small project maintained by one person; expect a reply within a few days, not hours.

## The local file protocol

The widget cannot open editor panes or change settings, and its webview reaches no network. To do those things it writes small JSON files into `~/.proof-tree-companion` (on Windows, the same name in your user profile folder), and the extension watches that directory:

| File | Direction | Used for |
| --- | --- | --- |
| `popout-request.json` | widget → extension | open the lens, show a range in the source, highlight, undo/redo |
| `rename-request.json` | widget → extension | open Rename Symbol after an accepted extract |
| `settings-request.json` | widget → extension | write `ramify.hoverBar.*` when you pin a move |
| `polish-request.json`, `propose-request.json` | widget → extension | the two optional model features |
| `polish-response.json`, `propose-response.json` | extension → widget | their answers |
| `theme-colors.json` | extension → widget | theme colours and the values of a few `ramify.*` settings (never the API key) |
| `chrome-backup.json` | extension only | the editor settings the lens changed, so they can be restored |
| `ai-claims/` | extension only | one empty file per model request, so only one VS Code window answers it |

**Any program running as you can write these files.** They are not a security boundary against your own user account, and Ramify does not pretend they are. What it does is treat every file as untrusted data:

- A request over 4 MiB, or that does not parse as a JSON object, is ignored.
- A request's document must be one open in that window or under one of its workspace folders; ranges and positions must be non-negative integers; an unknown action is ignored. Nothing in a request is ever executed or evaluated.
- A `settings-request.json` can only set the two hover-bar lists, and only to known move ids.
- `chrome-backup.json` is cut down to the four editor settings the lens changes, each with the type it must have, before anything is restored from it; anything else is logged and dropped. It also records the process id of the window that changed them, so a second window does not restore settings out from under a first.
- The model channels cap what they accept (200 narration lines, 50 offered rewrites, about 8000 characters of proof text) and refuse to run at all unless the setting that gates them is on.
- Responses are written to a temporary file and renamed, so a reader never sees half a file.

The worst a local program can do through this protocol is what an ordinary VS Code command could: open or show a file that window already owns, change your hover-bar lists, or, if you have turned a model feature on and stored a key, cause a request that costs a few cents. It cannot make the extension run code or read files outside the workspace.

Edits you make from the tree do not go through these files; they are ordinary VS Code text edits, so the buffer and its undo stack stay yours.

## Your editor settings

While the lens is open, and unless `ramify.lensHideChrome` is `false`, the extension changes four **user-level** settings: `workbench.editor.showTabs`, `breadcrumbs.enabled`, `editor.minimap.enabled` and `editor.stickyScroll.enabled`. It restores them when the lens closes, and on the next start if VS Code quit with the lens open.

## The API key

The two model features need an Anthropic API key. It is read from VS Code's secret storage (**Ramify: Set model API key**) or, if none is stored, from the `ANTHROPIC_API_KEY` environment variable of the VS Code process. It is never a setting, never written to `~/.proof-tree-companion` or any other file by Ramify, and never logged; neither is the prompt, which contains your proof. The output channel records a request's id, counts, latency and token usage.

## What is sent to Anthropic, and when

Nothing, unless a setting is on **and** a key is available. Then, to `https://api.anthropic.com/v1/messages` and nowhere else:

- `ramify.narration.polish`: for each narrated step, the generated sentence, the tactic's text and the goal states before and after it (at most 200 steps per request). Your own comments are never sent.
- `ramify.restructure.propose`: the tree's outline as text, up to about 8000 characters of the proof's text, and the list of rewrites the tree already offers. The reply can only choose one of those; it cannot supply text to write.

Answers are cached in VS Code's own extension state. A workspace's settings can switch these features on, so if you open a project you do not trust, check `ramify.narration.polish` and `ramify.restructure.propose` in its `.vscode/settings.json` — though they do nothing unless you have stored or exported a key yourself. There is no telemetry.

## Supply chain

The Lean package fetches Paperproof (pinned to a commit) and ProofWidgets (pinned to a tag) with Lake. The renderer bundle, `web/dist/proofTreeWidget.js`, is committed and rebuilt in CI, which fails if the tracked file is not what the sources produce. See [NOTICE](NOTICE) for the third-party components.
