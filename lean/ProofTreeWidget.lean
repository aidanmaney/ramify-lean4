import Lean
import Services.BetterParser
import ProofTreeComments
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

/-- The hover popup seam for ONE token of a tactic's source: the token's span
plus a `CodeWithInfos` whose single tag carries the very `InfoWithCtx` the
editor's own hover would use for that position, wrapping the token's *source*
text.

The point of the shape is total reuse. `InteractiveCode` on the JS side renders
the tagged text and, on hover, resolves the tag through
`Lean.Widget.InteractiveDiagnostics.infoToInteractive` — the same RPC that
powers the goal-label tooltips and the editor's hover. So a token here gets the
native popup (type, docs, links) without a bespoke popup component, and because
the tagged text is the SOURCE text rather than a pretty-printed expression, what
is drawn is byte-identical to what the layout measured. -/
structure TacticTokenInfo where
  -- The token's START alone identifies it: the client joins `tokenInfos` onto
  -- `TacticEdit.tokens` by start position (a token's extent is already on the
  -- edit entry), so a stop here would be dead weight on the wire.
  start : Lsp.Position
  code  : Widget.CodeWithInfos
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
  -- The command's source comments (parser trivia, so re-lexed from the raw
  -- source — see ProofTreeComments.lean); the client attributes them to nodes.
  comments    : Array SourceComment := #[]
  -- Per-tactic tight ranges + verbatim text for in-place editing (see
  -- TacticEdit). Widget-only, like taggedGoals: the CLI has no editor.
  tacticEdits : Array TacticEdit := #[]
  -- Hover popups for identifier tokens inside tactics (see TacticTokenInfo).
  -- Like taggedGoals, these hold live RPC references, so they are widget-only.
  tokenInfos  : Array TacticTokenInfo := #[]
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

/-- Semantic tokens for CONSTANT identifiers — `Nat.Prime`,
`Nat.strong_induction_on`, `Nat.add_zero`.

The server's own `collectInfoBasedSemanticTokens` deliberately emits tokens
only for identifiers bound to local `fvar`s and for field projections; a
constant gets nothing, because in the editor those are coloured by the
TextMate grammar rather than by semantic tokens. We have no TextMate grammar,
and — worse — the token list is also what carries the hover popups, so every
constant in a tactic silently had neither colour nor tooltip. This fills that
gap from the info tree, mirroring upstream's shape (`deepestNodes`, an
`.original` head so macro-generated syntax is skipped) and leaving overlap
resolution to `handleOverlappingSemanticTokens` as usual. -/
def collectConstIdentTokens (tree : InfoTree) : Array FileWorker.LeanSemanticToken :=
  List.toArray <| tree.deepestNodes fun _ info _ => do
    let .ofTermInfo ti := info | none
    let .original .. := ti.stx.getHeadInfo | none
    guard ti.stx.isIdent
    -- `.getAppFn` because an ident often elaborates to the constant already
    -- applied to its implicit arguments.
    guard ti.expr.getAppFn.isConst
    return { stx := ti.stx, type := Lsp.SemanticTokenType.function }

/-- The tokens the widget colours (and hangs hover popups on): exactly the pair
the editor's `textDocument/semanticTokens` request uses, plus our constant
identifiers. Shared with the offline probe so both exercise one code path. -/
def semanticTokensFor (fileMap : FileMap) (stx : Syntax) (tree : InfoTree)
    : Array FileWorker.AbsoluteLspSemanticToken :=
  FileWorker.handleOverlappingSemanticTokens <|
    FileWorker.computeAbsoluteLspSemanticTokens fileMap ⟨0⟩ none <|
      FileWorker.collectSyntaxBasedSemanticTokens fileMap stx
        ++ FileWorker.collectInfoBasedSemanticTokens tree
        ++ collectConstIdentTokens tree

/-- Would the editor's own hover consider this info node? Mirrors the
eligibility test inside `InfoTree.hoverableInfoAt?`: anything carrying
elaborator info, plus field/option/error-name nodes, minus the `nullKind` and
`withAnnotateState` nodes tactics use to steer which goal the infoview shows.

Deliberately NOT restricted to `TermInfo`. `makePopup` — the server side of
`infoToInteractive` — ends with `doc := ← i.info.docString?`, which is
populated for ANY info kind, so a `TacticInfo` yields the tactic's own
documentation. That is what puts a real popup on `induction`, `simp` and
friends rather than only on identifiers. -/
def hoverEligible (info : Elab.Info) : Bool :=
  !info.stx.isOfKind nullKind
  && !info.toElabInfo?.any (·.elaborator == `Lean.Elab.Tactic.evalWithAnnotateState)
  && ((info matches .ofFieldInfo _ | .ofOptionInfo _ | .ofErrorNameInfo _)
      || info.toElabInfo?.isSome)

/-- A synthetic `sorry` has no meaningful popup; `hoverableInfoAt?` drops these
too. -/
def isSyntheticSorryInfo (info : Elab.Info) : Bool :=
  match info with
  | .ofTermInfo ti => ti.expr.isSyntheticSorry
  | _              => false

/-- Hoverable info nodes indexed for innermost-range lookup: `items` sorted by
start offset, and `prefixMaxStop[i]` = the largest stop among `items[0..i]`.

The tree is walked ONCE per request and the index shared by every token —
calling `InfoTree.hoverableInfoAt?` per token would re-walk the whole tree each
time, and this runs on every cursor move. The prefix-max array keeps the lookup
itself off O(targets): scanning backwards from the last candidate, the moment
the running maximum stop falls at or before the query offset, no earlier item
can contain it either, so the scan stops. -/
structure HoverIndex where
  items         : Array (Nat × Nat × Elab.InfoWithCtx)
  prefixMaxStop : Array Nat

def mkHoverIndex (infoTree : InfoTree) : HoverIndex := Id.run do
  let raw : Array (Nat × Nat × Elab.InfoWithCtx) :=
    infoTree.foldInfo (init := #[]) fun ctx info acc =>
      if !hoverEligible info || isSyntheticSorryInfo info then acc
      else match info.stx.getRange? (canonicalOnly := true) with
        | some r =>
          acc.push (r.start.byteIdx, r.stop.byteIdx,
                    { ctx, info, children := .empty })
        | none => acc
  let items := raw.qsort fun a b => a.1 < b.1
  let mut pm : Array Nat := Array.mkEmpty items.size
  let mut best := 0
  for (_, stop, _) in items do
    best := max best stop
    pm := pm.push best
  return { items, prefixMaxStop := pm }

/-- The smallest eligible range containing byte offset `p`, as
`(start, stop, info)`. The range comes back with the info so callers can use it
as an identity key for the node (see the ref cache in `getProofTree`). -/
def HoverIndex.innermost (idx : HoverIndex) (p : Nat)
    : Option (Nat × Nat × Elab.InfoWithCtx) := Id.run do
  -- Binary search for the first index whose start exceeds `p`.
  let mut lo := 0
  let mut hi := idx.items.size
  while lo < hi do
    let mid := (lo + hi) / 2
    match idx.items[mid]? with
    | some (start, _, _) => if start ≤ p then lo := mid + 1 else hi := mid
    | none               => hi := mid
  let mut i := lo
  let mut best : Option (Nat × Nat × Nat × Elab.InfoWithCtx) := none
  while i > 0 do
    i := i - 1
    match idx.prefixMaxStop[i]? with
    | some m => if m ≤ p then break
    | none   => break
    if let some (start, stop, ictx) := idx.items[i]? then
      if start ≤ p && p < stop then
        let width := stop - start
        if best.all fun (bw, _, _, _) => width < bw then
          best := some (width, start, stop, ictx)
  return best.map fun (_, start, stop, ictx) => (start, stop, ictx)

/-- One-entry cache for `getProofTree`'s payload, keyed on
`(uri, document version, command start)`. Nothing in the payload depends on the
cursor beyond which command snapshot it lands in, yet the handler runs on EVERY
cursor move — so walking a proof line-by-line (the dominant interaction, and
exactly what tree↔lens tracking generates) recomputed an identical payload per
keypress: five info-tree walks plus a tagged pretty-print of every goal.

Caching the `WithRpcRef`-carrying halves is safe, and deliberately so: a ref's
id is minted once by `WithRpcRef.mk`, but its session registration happens at
response-ENCODE time (`rpcStoreRef` is `StateM RpcObjectStore`, run while
serialising the response into whichever session made the request). Re-serving
the cached value therefore registers fresh refs in a reconnected session's
store — the client-side self-heal in widget.tsx is untouched — and within one
session the client receives byte-identical ref ids across cursor moves, which
is what lets it skip re-installing an unchanged interactive payload. The
DOCUMENT VERSION is what must gate reuse (a stale `InfoWithCtx` against an old
environment), and it is in the key; `version` counts every edit
(`DocumentMeta.version`), so an edited file can never be served a stale tree.
One entry suffices: the panel follows a single cursor, and switching files or
proofs just evicts. -/
initialize proofTreeCache :
    IO.Ref (Option (String × Nat × Nat × ProofTreeData)) ← IO.mkRef none

/-- Parse the proof tree for the theorem under the cursor.

Mirrors the `.tree` branch of `Paperproof.getSnapshotData`: wait for the snapshot
containing `pos`, then run `BetterParser_Tree` over its (fully elaborated) info
tree. A cursor outside a tactic proof is a normal outcome, not an error: it
returns an EMPTY proof (`steps := []`), which the widget renders as a quiet
"no proof here" — keeping the empty state in the data model rather than encoding
it in error-message strings the client would have to pattern-match. That empty
answer short-circuits BEFORE the enrichment passes (tagged goals, tokens, hover
index): the cursor sits outside a proof most of the time in a working file, and
the client reads none of the rich payload in that state. -/
@[server_rpc_method]
def getProofTree (params : GetProofTreeParams) : RequestM (RequestTask ProofTreeData) := do
  withWaitFindSnapAtPos params.pos fun snap => do
    let doc ← readDoc
    let fileMap : FileMap := doc.meta.text
    let snapStart := (snap.stx.getRange?.map (·.start.byteIdx)).getD 0
    let cacheKey := (doc.meta.uri, doc.meta.version, snapStart)
    if let some (uri, ver, start, payload) ← proofTreeCache.get then
      if (uri, ver, start) == cacheKey then
        return payload
    let finish (payload : ProofTreeData) : RequestM ProofTreeData := do
      proofTreeCache.set <| some (cacheKey.1, cacheKey.2.1, cacheKey.2.2, payload)
      return payload
    let some parsedTree ← RequestM.runTermElabM snap
      (liftM <| Paperproof.Services.BetterParser_Tree fileMap snap.infoTree)
      | finish { steps := [], allGoals := [] }
    if parsedTree.steps.isEmpty then
      return ← finish { steps := [], allGoals := [] }
    let taggedGoals ← collectTaggedGoals snap.infoTree
    -- Comments live in the raw source, not the InfoTree; `snap.stx` is the
    -- whole command, so its range bounds the lex (same result as the CLI's
    -- `commandRange` walk).
    let comments := match snap.stx.getRange? with
      | some range => commentsInRange fileMap.source fileMap range
      | none => #[]
    -- Syntax highlighting, from the server's OWN highlighter rather than a
    -- hand-rolled Lean lexer: `collectSyntaxBasedSemanticTokens` (keywords and
    -- syntactic categories from `snap.stx`) plus `collectInfoBasedSemanticTokens`
    -- (identifiers classified by what they elaborated to, from the info tree) —
    -- exactly the pair `computeSemanticTokens` feeds the real
    -- `textDocument/semanticTokens` request. Overlaps are resolved the same way
    -- too, so a token span here means what it means in the editor. Computed
    -- once for the whole command and sliced per tactic below.
    let allTokens := semanticTokensFor fileMap snap.stx snap.infoTree
    -- `Lsp.Position` derives `Ord`; no bespoke comparator to keep in sync.
    let lePos (a b : Lsp.Position) : Bool := (compare a b).isLE
    -- The editing seam: per distinct step range, the tactic's tight span and
    -- verbatim text (see TacticEdit), plus the tokens falling inside it.
    let src := fileMap.source
    -- Hover targets, walked once and shared by every token below.
    let hoverIdx := mkHoverIndex snap.infoTree
    let mut seen : Std.HashSet (Nat × Nat) := {}
    let mut tacticEdits : Array TacticEdit := #[]
    let mut tokenInfos : Array TacticTokenInfo := #[]
    -- One RPC reference per distinct info NODE, not per token. Many tokens in
    -- a tactic resolve to the same node — its keyword and punctuation all land
    -- on the enclosing `TacticInfo` — and `rpcStoreRef` keys its store on the
    -- `WithRpcRef` id, so handing out the same value keeps them a single store
    -- entry (and lets the client reuse UI state for it) instead of one per
    -- token. Keyed by the node's range, which identifies it here.
    let mut refCache : Std.HashMap (Nat × Nat) (Server.WithRpcRef Elab.InfoWithCtx) := {}
    -- Tactic ranges NEST, so a token inside a branch of a structured tactic
    -- appears in that tactic's token list AND in every ancestor's. The client
    -- indexes `tokenInfos` by absolute position, so emit each position once.
    let mut seenTok : Std.HashSet (Nat × Nat) := {}
    for s in parsedTree.steps do
      let key := (s.position.start.line, s.position.start.character)
      unless seen.contains key do
        seen := seen.insert key
        let b := fileMap.lspPosToUtf8Pos s.position.start
        let e := fileMap.lspPosToUtf8Pos s.position.stop
        let raw := String.Pos.Raw.extract src b e
        let tight := trimmedEnd raw
        let stop := fileMap.utf8PosToLspPos ⟨b.byteIdx + tight.byteIdx⟩
        let tokens := allTokens.filterMap fun t =>
          if lePos s.position.start t.pos && lePos t.tailPos stop then
            -- `names` is upstream's canonical constructor-name array (it
            -- carries a sanity-check example against `toJson`); no JSON
            -- round-trip per token.
            some { start := t.pos, stop := t.tailPos,
                   type := Lsp.SemanticTokenType.names[t.type.toNat]! : TacticToken }
          else none
        tacticEdits := tacticEdits.push {
          start := s.position.start
          stop
          text  := String.Pos.Raw.extract raw ⟨0⟩ tight
          tokens
          -- Where this line's tactic text starts, which is neither the step's
          -- column nor the bare line indent (see tacticIndentAt).
          tacticIndent := tacticIndentAt fileMap s.position.start.line
        }
        -- Per token, the innermost info node covering it — the same node the
        -- editor's hover would land on — tagged onto the token's own source
        -- text (see TacticTokenInfo). EVERY token is offered, not just the
        -- identifier-ish ones: a tactic keyword resolves to its `TacticInfo`,
        -- whose docstring is exactly the reference text you'd otherwise leave
        -- the widget to read. Tokens with no info node (punctuation, most
        -- syntactic keywords) simply find nothing and cost nothing.
        for t in tokens do
          let tb := fileMap.lspPosToUtf8Pos t.start
          let te := fileMap.lspPosToUtf8Pos t.stop
          if seenTok.contains (tb.byteIdx, te.byteIdx) then
            continue
          seenTok := seenTok.insert (tb.byteIdx, te.byteIdx)
          if let some (rs, re, ictx) := hoverIdx.innermost tb.byteIdx then
            -- WithRpcRef.mk (not ⟨_⟩ — the constructor is private): allocates
            -- the session-scoped id the client hands back to
            -- `infoToInteractive` when the popup opens.
            let ref ← match refCache[(rs, re)]? with
              | some r => pure r
              | none   => do
                let r ← Server.WithRpcRef.mk ictx
                refCache := refCache.insert (rs, re) r
                pure r
            tokenInfos := tokenInfos.push {
              start := t.start
              code  := .tag
                { info := ref, subexprPos := SubExpr.Pos.root }
                (.text (String.Pos.Raw.extract src tb te))
            }
    finish {
      steps       := parsedTree.steps,
      allGoals    := parsedTree.allGoals.toList,
      taggedGoals,
      comments,
      tacticEdits,
      tokenInfos
    }

/-- Parameters for `popoutEdit`: the document and the tactic's TIGHT range
(from `TacticEdit`) to select in the lens editor. `action` selects the
companion behavior: `"popout"` opens (or reuses) the lens; `"reveal"` shows
the range in the lens when one is open, else in the main editor — the tree's
click-to-reveal rides this, so it can target the lens (vscode-lean4's own
reveal always picks the first visible editor). -/
structure PopoutEditParams where
  uri    : String
  start  : Lsp.Position
  stop   : Lsp.Position
  action : String := "popout"
  deriving FromJson, ToJson

/-- The widget→companion bridge for the "edit in the lens" action (a tactic's
hover-bar `⧉` button) and for click-to-reveal. The infoview's `EditorApi` has no `executeCommand`, and both
webview-side escape hatches fail (vscode-lean4's `showDocument` silently drops
non-file URIs; a synthetic anchor click navigates the webview blank) — so the
request is relayed through the filesystem: this writes a one-shot request file
under `~/.proof-tree-companion/`, which the companion extension
(`ext/proof-tree-companion`) watches and turns into a slim LENS editor group
directly below the infoview with the range selected. The nonce lets the
watcher dedupe double fire (fs.watch often reports one write as several
events). -/
@[server_rpc_method]
def popoutEdit (params : PopoutEditParams) : RequestM (RequestTask String) := do
  RequestM.asTask do
    let some home ← IO.getEnv "HOME"
      | throw <| RequestError.internalError "popoutEdit: no HOME"
    let dir := System.FilePath.mk home / ".proof-tree-companion"
    IO.FS.createDirAll dir
    let nonce ← IO.monoNanosNow
    let payload := Json.mkObj [
      ("nonce", toJson nonce),
      ("uri", toJson params.uri),
      ("start", toJson params.start),
      ("stop", toJson params.stop),
      ("action", toJson params.action)
    ]
    IO.FS.writeFile (dir / "popout-request.json") payload.compress
    return "ok"

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
