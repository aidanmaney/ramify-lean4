import Lean
import Services.BetterParser
import ProofWidgets.Component.Basic
import ProofWidgets.Component.Panel.Basic

/-!
# ProofTreeWidget

A Lean **infoview user-widget** that renders the same proof tree as the standalone
web app (`web/`), but in-process: no NDJSON, no CLI. It is the RPC counterpart of
`Ppharness` — where the CLI elaborates a file itself and serialises `Result` to
NDJSON, here the *live* Lean server already holds the elaborated `InfoTree`, so we
run the very same `BetterParser_Tree` over `snap.infoTree` and hand the result to
the React renderer over the LSP/RPC bridge.

Two halves:

* `getProofTree` — a `@[server_rpc_method]` the widget JS calls (by the string
  `"ProofTree.getProofTree"`) with the cursor position. It returns the parsed
  proof tree for the theorem under the cursor. This is `Paperproof.getSnapshotData`
  (`.tree` mode) minus the single-tactic branch, plus `allGoals`.
* `ProofTreeWidget` — a `@[widget_module]` bound to the bundled renderer
  (`web/dist/proofTreeWidget.js`). Shown with `show_panel_widgets [ProofTreeWidget]`,
  it is handed `PanelWidgetProps` (which carries the cursor `pos`, including the
  document `uri`) by the infoview on every cursor move — that is the source→tree
  half of the bidirectional link. The tree→source half (reveal a tactic's span on
  click) is done JS-side via the infoview `EditorContext`, using `ProofStep.position`.

The widget bundle is a build input via `include_str`, so run `npm run build:widget`
in `web/` before `lake build`. See CLAUDE.md.
-/

open Lean Elab Meta Server RequestM ProofWidgets

namespace ProofTree

/-- The wire payload sent to the renderer: mirrors the CLI's `resultToJson`
(`{ steps, allGoals }`). Like Paperproof's `OutputParams`, deriving `FromJson`/`ToJson`
is enough — the RPC layer picks up `RpcEncodable` from those. The document `uri`
is *not* included: the panel widget already receives it in `props.pos`. -/
structure ProofTreeData where
  steps    : List Paperproof.Services.ProofStep
  allGoals : List Paperproof.Services.GoalInfo
  deriving Inhabited, FromJson, ToJson

/-- Parameters for `getProofTree`: just the cursor position. The widget passes the
whole `DocumentPosition`; the extra `uri` field is ignored when decoding as an
`Lsp.Position`. -/
structure GetProofTreeParams where
  pos : Lsp.Position
  deriving FromJson, ToJson

/-- Parse the proof tree for the theorem under the cursor.

Mirrors the `.tree` branch of `Paperproof.getSnapshotData`: wait for the snapshot
containing `pos`, then run `BetterParser_Tree` over its (fully elaborated) info
tree. A cursor outside a tactic proof is a normal outcome, not an error: it
returns an EMPTY proof (`steps := []`), which the widget renders as a quiet
"no proof here" — keeping the empty state in the data model rather than encoding
it in error-message strings the client would have to pattern-match. -/
@[server_rpc_method]
def getProofTree (params : GetProofTreeParams) : RequestM (RequestTask ProofTreeData) := do
  withWaitFindSnapAtPos params.pos fun snap => do
    let fileMap : FileMap := (← readDoc).meta.text
    let some parsedTree ← RequestM.runTermElabM snap
      (liftM <| Paperproof.Services.BetterParser_Tree fileMap snap.infoTree)
      | return { steps := [], allGoals := [] }
    return {
      steps    := parsedTree.steps,
      allGoals := parsedTree.allGoals.toList
    }

end ProofTree

/-- The proof-tree panel widget: the bundled React renderer from `web/`.

`Component PanelWidgetProps` means the infoview supplies the standard panel props
(cursor `pos`, current goals, …); the renderer reads `props.pos` and calls
`ProofTree.getProofTree` over RPC. Turn it on in a proof file with:

```lean
show_panel_widgets [ProofTreeWidget]
```
-/
@[widget_module]
def ProofTreeWidget : ProofWidgets.Component ProofWidgets.PanelWidgetProps where
  javascript := include_str ".." / "web" / "dist" / "proofTreeWidget.js"
