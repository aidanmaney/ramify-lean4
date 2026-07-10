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

/-- A goal's `Widget.InteractiveGoal` (tagged pretty-printed type + hypotheses),
keyed by the same mvarId string as `GoalInfo.id`. This is what powers the
infoview-style hover tooltips: each subterm tag carries a `WithRpcRef InfoWithCtx`
that the JS `<InteractiveCode>` resolves on hover via `infoToInteractive`. -/
structure TaggedGoalEntry where
  goalId : String
  goal   : Widget.InteractiveGoal
  deriving Server.RpcEncodable

/-- The wire payload sent to the renderer: the CLI's `{ steps, allGoals }` shape
plus `taggedGoals`, the interactive (tagged) rendering of each goal. The tagged
half contains live RPC references, so the whole payload derives
`Server.RpcEncodable` rather than `ToJson` (the Paperproof structs still encode
via their derived `FromJson`/`ToJson` through the blanket instance) — and it is
exactly the part that can never ride the CLI's NDJSON. The document `uri` is
*not* included: the panel widget already receives it in `props.pos`. -/
structure ProofTreeData where
  steps       : List Paperproof.Services.ProofStep
  allGoals    : List Paperproof.Services.GoalInfo
  taggedGoals : Array TaggedGoalEntry := #[]
  deriving Server.RpcEncodable

/-- Parameters for `getProofTree`: just the cursor position. The widget passes the
whole `DocumentPosition`; the extra `uri` field is ignored when decoding as an
`Lsp.Position`. -/
structure GetProofTreeParams where
  pos : Lsp.Position
  deriving FromJson, ToJson

/-- Collect an `InteractiveGoal` for every goal mentioned by any tactic in the
info tree, keyed by mvarId string (= `GoalInfo.id` on the wire).

This is the additive counterpart of the vendored parser's `printGoalInfo`, which
computes the very same tagged pretty-print (`ppExprWithInfos`) and then discards
the tags with `.fmt.pretty`. Rather than forking the parser, we re-walk the tree
here and keep them: for each `TacticInfo` print its goals with `mctxAfter` —
matching `BetterParser`'s `printCtx`, so the tagged text and the plain `GoalInfo`
strings agree — first-wins per goal. A goal that fails to print (e.g. not in
this `mctx`) is simply skipped; the client falls back to plain text. -/
def collectTaggedGoals (infoTree : InfoTree) : IO (Array TaggedGoalEntry) := do
  let tacticNodes := infoTree.foldInfo (init := #[]) fun ctx info acc =>
    if let .ofTacticInfo ti := info then acc.push (ctx, ti) else acc
  let mut seen : Std.HashSet String := {}
  let mut out : Array TaggedGoalEntry := #[]
  for (ctx, ti) in tacticNodes do
    let printCtx := { ctx with mctx := ti.mctxAfter }
    for mvarId in ti.goalsBefore ++ ti.goalsAfter do
      let key := mvarId.name.toString
      unless seen.contains key do
        seen := seen.insert key
        let goal? ← try
            some <$> printCtx.runMetaM {} (Widget.goalToInteractive mvarId)
          catch _ => pure none
        if let some goal := goal? then
          out := out.push { goalId := key, goal }
  return out

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
    let taggedGoals ← collectTaggedGoals snap.infoTree
    return {
      steps       := parsedTree.steps,
      allGoals    := parsedTree.allGoals.toList,
      taggedGoals
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
