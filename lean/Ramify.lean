import Lean
import Services.BetterParser
import ProofTreeComments
import ProofTreeRecover
import ProofWidgets.Component.Basic
import ProofWidgets.Component.Panel.Basic

open Lean Elab Meta Server RequestM ProofWidgets

namespace ProofTree

structure TaggedGoalEntry where
  goalId : String
  goal   : Widget.InteractiveGoal
  deriving Server.RpcEncodable

structure DeclRange where
  start : Lsp.Position
  stop  : Lsp.Position
  deriving Server.RpcEncodable

structure TreeDiag where

  range     : DeclRange

  fullRange : DeclRange

  severity  : Nat
  message   : String
  isSilent  : Bool := false

  leanTags  : Array Nat := #[]
  deriving Server.RpcEncodable

structure TacticTokenInfo where

  start : Lsp.Position

  code  : Option Widget.CodeWithInfos := none
  doc   : Option String := none
  deriving Server.RpcEncodable

partial def declName? (stx : Syntax) : Option Name :=
  match stx with
  | .node _ k args =>
    if k == ``Lean.Parser.Command.declId && args.size > 0 then
      some args[0]!.getId
    else args.foldl (fun acc a => acc <|> declName? a) none
  | _ => none

structure ProofTreeData where
  steps       : List Paperproof.Services.ProofStep
  allGoals    : List Paperproof.Services.GoalInfo
  taggedGoals : Array TaggedGoalEntry := #[]

  comments    : Array SourceComment := #[]

  tacticEdits : Array TacticEdit := #[]

  tokenInfos  : Array TacticTokenInfo := #[]

  deleteSlots : Array TacticSlot := #[]

  holes       : Array Hole := #[]

  calcChains  : Array CalcChain := #[]

  calcRelations : Array CalcRelations := #[]

  proofId       : String := ""

  tacticNames   : Array String := #[]

  declRange     : Option DeclRange := none

  recovered     : Array ProofTree.Recover.RecoveredStep := #[]

  openBlock     : Option ProofTree.Recover.OpenBlock := none

  diagnostics   : Array TreeDiag := #[]

  cfLine        : Option Nat := none

  cfStubPos     : Option Lsp.Position := none

  cfDraft       : Option String := none

  cfDraftCol    : Option Nat := none

  declHeader    : String := ""
  declHeaderTokens : Array TacticToken := #[]

  declHeaderStart : Option Lsp.Position := none

  cfDraftTokens : Array TacticToken := #[]

  cfDraftInfos  : Array TacticTokenInfo := #[]

  cfPending     : Bool := false
  deriving Server.RpcEncodable

def tacticNames (ctx : Elab.ContextInfo) : IO (Array String) :=
  ctx.runMetaM .empty do
    return (← Tactic.Doc.allTacticDocs).map (·.userName)

private def jsonField {α : Type} [FromJson α] (j : Json) (k : String)
    (dflt : α) : α :=
  match j.getObjVal? k >>= fromJson? with
  | .ok v => v
  | .error _ => dflt

structure GetProofTreeParams where
  pos : Lsp.Position
  cf  : Bool := true
  deriving ToJson

instance : FromJson GetProofTreeParams where
  fromJson? j := do
    let pos ← j.getObjValAs? Lsp.Position "pos"
    return { pos, cf := jsonField j "cf" true }

private def diffedGoalsAfter (printCtx : Elab.ContextInfo) (ti : Elab.TacticInfo)
    : IO (Std.HashMap String Widget.InteractiveGoal) := do

  let igs : Widget.InteractiveGoals ←
    tryCatch
      (printCtx.runMetaM {} do
        let mut goals : Array Widget.InteractiveGoal := #[]
        for mvarId in ti.goalsAfter do
          let ig? : Option Widget.InteractiveGoal ←
            tryCatch (some <$> Widget.goalToInteractive mvarId) (fun _ => pure none)
          if let some ig := ig? then goals := goals.push ig
        let batch : Widget.InteractiveGoals := { goals }
        tryCatch (Widget.diffInteractiveGoals true ti batch) (fun _ => pure batch))
      (fun _ => pure { goals := #[] })
  return igs.goals.foldl (init := {}) fun acc ig =>
    acc.insert ig.mvarId.name.toString ig

def collectTaggedGoals (infoTree : InfoTree)
    (wanted : Std.HashMap String String := {}) : IO (Array TaggedGoalEntry) := do
  let tacticNodes := infoTree.foldInfo (init := #[]) fun ctx info acc =>
    if let .ofTacticInfo ti := info then acc.push (ctx, ti) else acc

  let mut best : Std.HashMap String (Nat × TaggedGoalEntry) := {}
  for (ctx, ti) in tacticNodes do
    let printCtx := { ctx with mctx := ti.mctxAfter }

    let needDiff := ti.goalsAfter.any fun g =>
      match best[g.name.toString]? with
      | some (0, _) => false
      | _ => true
    let diffed ← if needDiff then diffedGoalsAfter printCtx ti else pure {}
    for mvarId in ti.goalsBefore ++ ti.goalsAfter do
      let key := mvarId.name.toString
      let cur := best[key]?

      if let some (0, _) := cur then continue
      let goal? ← match diffed[key]? with

        | some ig => pure (some ig)
        | none =>
          try
            some <$> printCtx.runMetaM {} (Widget.goalToInteractive mvarId)
          catch _ => pure none
      if let some goal := goal? then
        let text := goal.type.stripTags
        let score :=
          if wanted[key]? == some text then 0
          else 1 + ProofTree.mvarOccurrences text
        if cur.all (fun (s, _) => score < s) then
          best := best.insert key (score, { goalId := key, goal })
  return best.toArray.map fun (_, (_, e)) => e

partial def collectNumberTokens (stx : Syntax) : Array FileWorker.LeanSemanticToken :=
  match stx with
  | .atom info val =>

    if val.length > 0 && val.front.isDigit && (info matches .original ..) then
      #[{ stx, type := Lsp.SemanticTokenType.number }]
    else #[]
  | .node _ _ args => args.flatMap collectNumberTokens
  | _ => #[]

def collectConstIdentTokens (tree : InfoTree) : Array FileWorker.LeanSemanticToken :=
  List.toArray <| tree.deepestNodes fun _ info _ => do
    let .ofTermInfo ti := info | none
    let .original .. := ti.stx.getHeadInfo | none
    guard ti.stx.isIdent

    guard ti.expr.getAppFn.isConst
    return { stx := ti.stx, type := Lsp.SemanticTokenType.function }

def semanticTokensFor (fileMap : FileMap) (stx : Syntax) (tree : InfoTree)
    : Array FileWorker.AbsoluteLspSemanticToken :=
  FileWorker.handleOverlappingSemanticTokens <|
    FileWorker.computeAbsoluteLspSemanticTokens fileMap ⟨0⟩ none <|
      FileWorker.collectSyntaxBasedSemanticTokens fileMap stx
        ++ FileWorker.collectInfoBasedSemanticTokens tree
        ++ collectConstIdentTokens tree
        ++ collectNumberTokens stx

def collectTacticRanges (tree : InfoTree) : Array (Nat × Nat) :=
  tree.foldInfo (init := #[]) fun _ info acc =>
    match info, info.stx.getRange? (canonicalOnly := true) with
    | .ofTacticInfo _, some r => acc.push (r.start.byteIdx, r.stop.byteIdx)
    | _, _ => acc

def surfaceTacticRange (fileMap : FileMap) (src : String) (ranges : Array (Nat × Nat))
    (pos : Lsp.Position) (label : String) (b e : String.Pos.Raw)
    : Option (Nat × Nat) := Id.run do

  let head (s : String) : String := Id.run do
    let t := s.dropWhile Char.isWhitespace
    return (t.takeWhile fun c => !c.isWhitespace && c != '[' && c != '(').toString
  let want := head label
  if want.isEmpty then
    return none
  let lineStart := (fileMap.lspPosToUtf8Pos ⟨pos.line, 0⟩).byteIdx
  let mut best : Option (Nat × Nat) := none
  for (rb, re) in ranges do
    if lineStart ≤ rb && rb < b.byteIdx && re ≥ e.byteIdx then
      if head (String.Pos.Raw.extract src ⟨rb⟩ ⟨re⟩) == want then
        if best.all fun (bb, be) => re - rb < be - bb then
          best := some (rb, re)
  return best

def rwClosingRflLabel (env : Environment) (srcSlice label : String)
    : IO (Array ProofTree.LabelToken) := do
  unless srcSlice == "]" && label.startsWith "rw [rfl]" do return #[]
  let some doc ← findDocString? env ``Lean.Parser.Tactic.tacticRfl | return #[]

  return #[{ labelAt := 4, text := "rfl", type := "keyword",
             doc := FileWorker.Hover.rewriteExamples doc }]

def hoverEligible (info : Elab.Info) : Bool :=
  !info.stx.isOfKind nullKind
  && !info.toElabInfo?.any (·.elaborator == `Lean.Elab.Tactic.evalWithAnnotateState)
  && ((info matches .ofFieldInfo _ | .ofOptionInfo _ | .ofErrorNameInfo _)
      || info.toElabInfo?.isSome)

def isSyntheticSorryInfo (info : Elab.Info) : Bool :=
  match info with
  | .ofTermInfo ti => ti.expr.isSyntheticSorry
  | _              => false

def parserDocAt (env : Environment) (root : Syntax) (pos : String.Pos.Raw) :
    IO (Option (String × Lean.Syntax.Range)) := do
  let some stack := root.findStack? (·.getRange?.any (·.contains pos))
    | return none
  stack.findSomeM? fun (stx, _) => do
    let .node _ kind _ := stx | pure none
    let some doc ← findDocString? env kind | pure none
    return some (doc, stx.getRange?.get!)

def popupNonempty (env : Environment) (info : Elab.Info) : IO Bool := do
  match info with
  | .ofTermInfo _ | .ofFieldInfo _ | .ofOptionInfo _ | .ofErrorNameInfo _ =>
    pure true
  | _ =>
    match info.toElabInfo? with
    | some ei =>
      pure ((← findDocString? env ei.stx.getKind).isSome
        || (← findDocString? env ei.elaborator).isSome)
    | none => pure false

structure HoverItem where
  start : Nat
  stop  : Nat
  depth : Nat
  info  : Elab.InfoWithCtx

structure HoverIndex where
  items         : Array HoverItem
  prefixMaxStop : Array Nat

partial def collectHoverItems (ctx? : Option Elab.ContextInfo) (depth : Nat)
    (t : InfoTree) (acc : Array HoverItem) : Array HoverItem :=
  match t with
  | .context c t' => collectHoverItems (c.mergeIntoOuter? ctx?) depth t' acc
  | .node i cs =>
    let acc := match ctx? with
      | some ctx =>
        if !hoverEligible i || isSyntheticSorryInfo i then acc
        else match i.stx.getRange? (canonicalOnly := true) with
          | some r =>
            acc.push { start := r.start.byteIdx, stop := r.stop.byteIdx, depth,
                       info := { ctx, info := i, children := .empty } }
          | none => acc
      | none => acc
    cs.foldl (init := acc) fun a c =>
      collectHoverItems (i.updateContext? ctx?) (depth + 1) c a
  | .hole _ => acc

def mkHoverIndex (infoTree : InfoTree) : HoverIndex := Id.run do
  let raw := collectHoverItems none 0 infoTree #[]
  let items := raw.qsort fun a b => a.start < b.start
  let mut pm : Array Nat := Array.mkEmpty items.size
  let mut best := 0
  for it in items do
    best := max best it.stop
    pm := pm.push best
  return { items, prefixMaxStop := pm }

def HoverIndex.innermost (idx : HoverIndex) (p : Nat)
    : Option (Nat × Nat × Elab.InfoWithCtx) := Id.run do

  let mut lo := 0
  let mut hi := idx.items.size
  while lo < hi do
    let mid := (lo + hi) / 2
    match idx.items[mid]? with
    | some it => if it.start ≤ p then lo := mid + 1 else hi := mid
    | none    => hi := mid
  let mut i := lo
  let mut best : Option HoverItem := none
  while i > 0 do
    i := i - 1
    match idx.prefixMaxStop[i]? with
    | some m => if m ≤ p then break
    | none   => break
    if let some it := idx.items[i]? then
      if it.start ≤ p && p < it.stop then
        let width := it.stop - it.start
        let wins := match best with
          | none => true
          | some b =>
            width < b.stop - b.start ||
              (width == b.stop - b.start && it.depth > b.depth)
        if wins then
          best := some it
  return best.map fun it => (it.start, it.stop, it.info)

initialize proofTreeCache :

    IO.Ref (Option ((String × Nat × Nat × Nat) × ProofTreeData)) ← IO.mkRef none

private def tokenInfoAt (env : Environment) (stx : Syntax) (hoverIdx : HoverIndex)
    (src : String) (fileMap : FileMap)
    (refCache : Std.HashMap (Nat × Nat) (Server.WithRpcRef Elab.InfoWithCtx))
    (t : TacticToken) :
    RequestM (Option TacticTokenInfo ×
      Std.HashMap (Nat × Nat) (Server.WithRpcRef Elab.InfoWithCtx)) := do
  let tb := fileMap.lspPosToUtf8Pos t.start
  let tend := fileMap.lspPosToUtf8Pos t.stop

  let stxDoc? ← parserDocAt env stx tb
  match hoverIdx.innermost tb.byteIdx with
  | some (rs, re, ictx) =>
    let docWins ← match stxDoc? with
      | none => pure false
      | some (_, stxRange) =>
        if !stxRange.includes ⟨⟨rs⟩, ⟨re⟩⟩ then pure true
        else do pure !(← popupNonempty env ictx.info)
    if docWins then
      return (some
        { start := t.start
          doc := stxDoc?.map (FileWorker.Hover.rewriteExamples ·.1) }, refCache)

    unless (← popupNonempty env ictx.info) do
      return (none, refCache)

    let (ref, refCache) ← match refCache[(rs, re)]? with
      | some r => pure (r, refCache)
      | none   => do
        let r ← Server.WithRpcRef.mk ictx
        pure (r, refCache.insert (rs, re) r)
    return (some {
      start := t.start
      code  := some <| .tag
        { info := ref, subexprPos := SubExpr.Pos.root }
        (.text (String.Pos.Raw.extract src tb tend)) }, refCache)
  | none =>

    if let some (doc, _) := stxDoc? then
      return (some
        { start := t.start
          doc := some (FileWorker.Hover.rewriteExamples doc) }, refCache)
    return (none, refCache)

def mkTreePayload (snap : Snapshots.Snapshot) (fileMap : FileMap)
    (parsed : Paperproof.Services.Result)
    (errorPositions : Array Lsp.Position) (treeDiags : Array TreeDiag) :
    RequestM ProofTreeData := do

    let snapStart := (snap.stx.getRange?.map (·.start.byteIdx)).getD 0

    let fixup := labelFixup fileMap snap.infoTree (extra := some snap.stx)
    let remapped := { parsed with
      steps := parsed.steps.map fun (s : Paperproof.Services.ProofStep) =>
        { s with tacticString := fixup.apply s.position.start s.tacticString } }

    let slots := tacticSlots fileMap snap.infoTree (extra := some snap.stx)
    let calcChains := collectCalcChains fileMap snap.infoTree (extra := some snap.stx)

    let recovA ← Recover.recoverFailed fileMap snap.infoTree remapped.steps slots
      calcChains errorPositions

    let recovB ← Recover.recoverTerm fileMap snap.infoTree (some snap.stx)
      remapped.steps

    let recovD ← Recover.recoverCalcLinks fileMap snap.infoTree remapped.steps
      (extra := some snap.stx)
    let recov : Recover.Recovery := {
      steps := recovA.steps ++ recovB.steps ++ recovD.steps
      goals := recovA.goals ++ recovB.goals ++ recovD.goals
      grafts := recovA.grafts ++ recovB.grafts ++ recovD.grafts
      recovered := recovA.recovered ++ recovB.recovered ++ recovD.recovered }

    let openBlock ← Recover.recoverOpenBlock fileMap snap.infoTree (some snap.stx)
      slots
    let parsedTree := recov.apply remapped
    if parsedTree.steps.isEmpty && openBlock.isNone then
      return { steps := [], allGoals := [] }

    let parsedTree := match openBlock with
      | some ob => { parsedTree with allGoals := parsedTree.allGoals.insert ob.goal }
      | none => parsedTree

    let wanted : Std.HashMap String String := Id.run do
      let mut out : Std.HashMap String String := {}
      let offer (out : Std.HashMap String String) (g : Paperproof.Services.GoalInfo) :=
        let key := g.id.name.toString
        match out[key]? with
        | some cur =>
          if ProofTree.mvarOccurrences g.type < ProofTree.mvarOccurrences cur then
            out.insert key g.type
          else out
        | none => out.insert key g.type
      for g in parsedTree.allGoals do out := offer out g
      for st in parsedTree.steps do
        out := offer out st.goalBefore
        for g in st.goalsAfter ++ st.spawnedGoals do out := offer out g
      return out
    let taggedGoals ← collectTaggedGoals snap.infoTree wanted

    let comments := match snap.stx.getRange? with
      | some range => commentsInRange fileMap.source fileMap range
      | none => #[]

    let allTokens := semanticTokensFor fileMap snap.stx snap.infoTree

    let constStarts : Std.HashSet (Nat × Nat) :=
      (FileWorker.computeAbsoluteLspSemanticTokens fileMap ⟨0⟩ none
          (collectConstIdentTokens snap.infoTree)).foldl (init := {}) fun acc t =>
        acc.insert (t.pos.line, t.pos.character)
    let wireTokenType (t : FileWorker.AbsoluteLspSemanticToken) : String :=
      if t.type matches .function
          && constStarts.contains (t.pos.line, t.pos.character) then
        "const"
      else
        Lsp.SemanticTokenType.names[t.type.toNat]!

    let src := fileMap.source

    let hoverIdx := mkHoverIndex snap.infoTree
    let mut seen : Std.HashSet (Nat × Nat) := {}
    let mut tacticEdits : Array TacticEdit := #[]
    let mut tokenInfos : Array TacticTokenInfo := #[]

    let mut refCache : Std.HashMap (Nat × Nat) (Server.WithRpcRef Elab.InfoWithCtx) := {}

    let mut seenTok : Std.HashSet (Nat × Nat) := {}

    let tacticRanges := collectTacticRanges snap.infoTree
    for s in parsedTree.steps do
      let key := (s.position.start.line, s.position.start.character)
      unless seen.contains key do
        seen := seen.insert key
        let indent := tacticIndentAt fileMap s.position.start.line
        let b0 := fileMap.lspPosToUtf8Pos s.position.start
        let e0 := fileMap.lspPosToUtf8Pos s.position.stop

        let e0t := tightStop src b0 e0

        let (b, e, start) : String.Pos.Raw × String.Pos.Raw × Lsp.Position :=
          match surfaceTacticRange fileMap src tacticRanges s.position.start
                  s.tacticString b0 e0t with
          | some (rb, re) =>
            (⟨rb⟩, ⟨re⟩, fileMap.utf8PosToLspPos ⟨rb⟩)
          | none => (b0, e0, s.position.start)
        let raw := String.Pos.Raw.extract src b e
        let tight := trimmedEnd raw
        let stop := fileMap.utf8PosToLspPos ⟨b.byteIdx + tight.byteIdx⟩
        let tokens := allTokens.filterMap fun t =>
          if posLE start t.pos && posLE t.tailPos stop then

            some { start := t.pos, stop := t.tailPos,
                   type := wireTokenType t : TacticToken }
          else none

        let ownSlice := String.Pos.Raw.extract src b0 e0t
        let labelTokens ← rwClosingRflLabel snap.env ownSlice s.tacticString
        tacticEdits := tacticEdits.push {
          stepStart := s.position.start
          start
          stop
          text  := String.Pos.Raw.extract raw ⟨0⟩ tight
          tokens
          labelTokens

          tacticIndent := indent
        }

    for c in calcChains do
      let key := (c.tacticStart.line, c.tacticStart.character)
      if c.broken && !seen.contains key then
        seen := seen.insert key
        let tokens := allTokens.filterMap fun t =>
          if posLE c.tacticStart t.pos && posLE t.tailPos c.stop then
            some { start := t.pos, stop := t.tailPos,
                   type := wireTokenType t : TacticToken }
          else none
        tacticEdits := tacticEdits.push {
          stepStart := c.tacticStart
          start     := c.tacticStart
          stop      := c.stop
          text      := c.text
          tokens
          tacticIndent := tacticIndentAt fileMap c.tacticStart.line
        }

    for te in tacticEdits do
      for t in te.tokens do
        let tb := fileMap.lspPosToUtf8Pos t.start
        let tend := fileMap.lspPosToUtf8Pos t.stop
        if seenTok.contains (tb.byteIdx, tend.byteIdx) then
          continue
        seenTok := seenTok.insert (tb.byteIdx, tend.byteIdx)

        let (info?, rc) ←
          tokenInfoAt snap.env snap.stx hoverIdx src fileMap refCache t
        refCache := rc
        if let some info := info? then
          tokenInfos := tokenInfos.push info

    let declStart? : Option Lsp.Position :=
      let hdrStx := match snap.stx with
        | .node _ k args =>
          if k == ``Lean.Parser.Command.declaration && args.size ≥ 2 then
            args[1]!
          else snap.stx
        | _ => snap.stx
      match hdrStx.getRange? with
      | some r => some (fileMap.utf8PosToLspPos r.start)
      | none   => none
    let mut headerToks : Array TacticToken := #[]
    let mut declHeader : String := ""
    if let some dStart := declStart? then

      let byStop? : Option Lsp.Position :=

        match (ProofTree.nodesOfKind [``Lean.Parser.Term.byTactic] snap.stx).foldl
            (init := none) (fun acc st =>
              match st.getRange?, acc with
              | some r, none => some r.start.byteIdx
              | some r, some b => some (min r.start.byteIdx b)
              | none, _ => acc) with
        | some b => some (fileMap.utf8PosToLspPos ⟨b + 2⟩)
        | none   => none
      let bodyStart : Lsp.Position :=
        match byStop? with
        | some b => b
        | none =>
          match slots.foldl (init := none) (fun acc sl =>
              match acc with
              | none => some sl.start
              | some b => if posLE sl.start b then some sl.start else acc) with
          | some b => b
          | none   => ⟨dStart.line, 100000⟩
      let hb := fileMap.lspPosToUtf8Pos dStart
      let he := fileMap.lspPosToUtf8Pos bodyStart
      if hb.byteIdx < he.byteIdx then
        declHeader := (String.Pos.Raw.extract src hb he).trimRight
        let hEnd := fileMap.utf8PosToLspPos ⟨hb.byteIdx + declHeader.utf8ByteSize⟩
        headerToks := allTokens.filterMap fun t =>
          if posLE dStart t.pos && posLE t.tailPos hEnd then
            some { start := t.pos, stop := t.tailPos,
                   type := wireTokenType t : TacticToken }
          else none
        for t in headerToks do
          let tb := fileMap.lspPosToUtf8Pos t.start
          let tend := fileMap.lspPosToUtf8Pos t.stop
          if seenTok.contains (tb.byteIdx, tend.byteIdx) then continue
          seenTok := seenTok.insert (tb.byteIdx, tend.byteIdx)
          let (info?, rc) ←
            tokenInfoAt snap.env snap.stx hoverIdx src fileMap refCache t
          refCache := rc
          if let some info := info? then tokenInfos := tokenInfos.push info
    let calcRelations ← collectCalcRelations snap.infoTree <|
      calcRelationGoals
        (parsedTree.steps.toArray.map fun s =>
          { goalBefore := s.goalBefore.id.name.toString
            goalsAfter := (s.goalsAfter.map (·.id.name.toString)).toArray
            start := s.position.start
            stop  := s.position.stop })
        calcChains

        (match openBlock with
          | some ob => #[ob.goal.id.name.toString]
          | none => #[])
    let proofId := match declName? snap.stx with
      | some n => n.toString
      | none   => s!"@{snapStart}"

    let tacticNames ← match anyGoalContext snap.infoTree with
      | some (ctx, _) => tacticNames ctx
      | none => pure #[]
    return {
      proofId,
      tacticNames,
      declRange := snap.stx.getRange?.map fun r =>
        ⟨fileMap.utf8PosToLspPos r.start, fileMap.utf8PosToLspPos r.stop⟩,
      declHeader, declHeaderTokens := headerToks,
      declHeaderStart := declStart?,
      diagnostics := treeDiags,
      steps       := parsedTree.steps,
      allGoals    := parsedTree.allGoals.toList,
      taggedGoals,
      comments,
      tacticEdits,
      tokenInfos,
      deleteSlots := slots
      recovered   := recov.recovered
      openBlock
      holes       := collectHoles fileMap snap.infoTree slots (extra := some snap.stx)
      calcChains
      calcRelations
    }

private structure CfSplice where

  text : Unit → String

  draft : String

  draftCol : Nat

  stubByte : Nat

private def cfSplice (fileMap : FileMap) (line : Nat) (cursorCol : Nat) :
    Option CfSplice :=
  if line + 1 ≥ fileMap.positions.size then none else
  let src := fileMap.source
  let lineStart := fileMap.lspPosToUtf8Pos ⟨line, 0⟩
  let nextStart := fileMap.lspPosToUtf8Pos ⟨line + 1, 0⟩
  let lineRaw := String.Pos.Raw.extract src lineStart nextStart
  let hasNl := lineRaw.endsWith "\n"
  let contentEnd : String.Pos.Raw :=
    if hasNl then ⟨nextStart.byteIdx - 1⟩ else nextStart
  let content := String.Pos.Raw.extract src lineStart contentEnd
  let ws := (content.takeWhile fun c => c == ' ' || c == '\t').toString
  let body := (content.drop ws.length).toString
  let byParts := content.splitOn ":= by"
  let arrowParts := content.splitOn "=>"
  let newContent :=
    if body.startsWith "--" || body.startsWith "/-" then

      content
    else if body.isEmpty then

      if cursorCol == 0 then content
      else ("".pushn ' ' cursorCol) ++ "sorry"
    else if byParts.length ≥ 2 then
      String.intercalate ":= by" byParts.dropLast ++ ":= by sorry"
    else if body.startsWith "· " then ws ++ "· sorry"
    else if body.startsWith "| " && arrowParts.length ≥ 2 then
      arrowParts.head! ++ "=> sorry"
    else ws ++ "sorry"
  if newContent == content then none
  else

    some {
      text := fun _ =>
        String.Pos.Raw.extract src ⟨0⟩ lineStart
          ++ newContent ++ (if hasNl then "\n" else "")
          ++ String.Pos.Raw.extract src nextStart ⟨src.utf8ByteSize⟩
      draft := body
      draftCol := ws.length
      stubByte := lineStart.byteIdx + newContent.utf8ByteSize - "sorry".utf8ByteSize }

private def declContainsPos (real : ProofTreeData) (pos : Lsp.Position) : Bool :=
  match real.declRange with
  | some r => posLE r.start pos && posLE pos r.stop
  | none => false

private def errInDecl (real : ProofTreeData) : Bool :=
  real.diagnostics.any fun d =>
    d.severity == 1 && (match real.declRange with
      | some r =>
        d.range.start.line ≤ r.stop.line && r.start.line ≤ d.fullRange.stop.line
      | none => true)

private def payloadHealthy (real : ProofTreeData) (pos : Lsp.Position) : Bool :=
  !real.steps.isEmpty && declContainsPos real pos && !errInDecl real

private def cfWanted (real : ProofTreeData) (pos : Lsp.Position)
    (stepStartsHere : Bool) : Bool :=
  let declContains := declContainsPos real pos
  let errInDecl := errInDecl real
  let broken := real.steps.isEmpty
    || real.recovered.any (·.start.line == pos.line)
    || !declContains
    || errInDecl
  broken && !stepStartsHere

private inductive CfEntry where
  | pending (startMs : Nat)
  | done (payload : Option ProofTreeData)

initialize cfElabCache : IO.Ref (Option (UInt64 × CfEntry)) ← IO.mkRef none

private def cfExitSettleMs : Nat := 750

initialize cfServeCache :
    IO.Ref (Option (UInt64 × Nat × Nat × UInt64 × ProofTreeData)) ←
  IO.mkRef none

private def tokensInSpan (snap : Snapshots.Snapshot) (fileMap : FileMap)
    (inSpan : Lsp.Position → Bool) :
    RequestM (Array TacticToken × Array TacticTokenInfo) := do
  let onDraft := inSpan
  let all := semanticTokensFor fileMap snap.stx snap.infoTree
  let constStarts : Std.HashSet (Nat × Nat) :=
    (FileWorker.computeAbsoluteLspSemanticTokens fileMap ⟨0⟩ none
        (collectConstIdentTokens snap.infoTree)).foldl (init := {}) fun acc t =>
      acc.insert (t.pos.line, t.pos.character)
  let mut toks : Array TacticToken := #[]
  for t in all do
    unless onDraft t.pos do continue
    let type :=
      if t.type matches .function
          && constStarts.contains (t.pos.line, t.pos.character) then "const"
      else Lsp.SemanticTokenType.names[t.type.toNat]!
    toks := toks.push { start := t.pos, stop := t.tailPos, type }
  if toks.isEmpty then return (#[], #[])
  let hoverIdx := mkHoverIndex snap.infoTree
  let src := fileMap.source
  let mut refCache : Std.HashMap (Nat × Nat) (Server.WithRpcRef Elab.InfoWithCtx) := {}
  let mut infos : Array TacticTokenInfo := #[]
  for t in toks do
    let (info?, rc) ← tokenInfoAt snap.env snap.stx hoverIdx src fileMap refCache t
    refCache := rc
    if let some info := info? then infos := infos.push info
  return (toks, infos)

private def computeCf (doc : FileWorker.EditableDocument) (pos : Lsp.Position)
    (draftCol : Nat)
    (cfText : String) (stubByte : Nat) : RequestM (Option ProofTreeData) := do
  let fileMap := doc.meta.text
  let lineStart := fileMap.lspPosToUtf8Pos ⟨pos.line, 0⟩
  let (snaps, _, _) ← doc.cmdSnaps.getFinishedPrefix

  let prev? := snaps.foldl (init := none) fun acc s =>
    if s.endPos.byteIdx ≤ lineStart.byteIdx then some s else acc
  let some prev := prev? | return none
  let ictx := Parser.mkInputContext cfText doc.meta.uri
  let cfMap := ictx.fileMap
  let scopes := prev.cmdState.scopes.map fun sc =>
    { sc with opts := Elab.async.set sc.opts false }
  let cmdState0 : Command.State := { prev.cmdState with
    scopes, messages := {}, traceState := {}, snapshotTasks := #[],
    infoState := { enabled := true } }
  let some scope := cmdState0.scopes.head? | return none
  let pmctx : Parser.ParserModuleContext := {
    env := cmdState0.env, options := scope.opts,
    currNamespace := scope.currNamespace, openDecls := scope.openDecls }
  let (stx, mpState', parseMsgs) :=
    Parser.parseCommand ictx pmctx prev.mpState {}
  unless stx.getKind == ``Lean.Parser.Command.declaration do return none
  let some r := stx.getRange? | return none
  unless r.start.byteIdx ≤ lineStart.byteIdx
      && lineStart.byteIdx < r.stop.byteIdx do
    return none
  let cmdCtx : Command.Context := {
    fileName := doc.meta.uri, fileMap := cfMap,
    cmdPos := prev.mpState.pos, snap? := none, cancelTk? := none }
  let ref ← IO.mkRef cmdState0
  Command.withLoggingExceptions
    (Elab.getResetInfoTrees *> Command.elabCommandTopLevel stx) cmdCtx ref
  let stFinal ← ref.get

  unless stFinal.infoState.trees.size == 1 do return none
  let synth : Snapshots.Snapshot :=
    { stx, mpState := mpState', cmdState := stFinal }
  let mut cfDiags : Array TreeDiag := #[]
  let mut errPos : Array Lsp.Position := #[]
  for m in parseMsgs.toList ++ stFinal.messages.toList do
    let text ← m.data.toString

    if m.severity == .warning && text.startsWith "declaration uses " then
      continue
    let s := cfMap.leanPosToLspPos m.pos
    let e := match m.endPos with
      | some e => cfMap.leanPosToLspPos e
      | none => s
    let sev := match m.severity with
      | .error => 1 | .warning => 2 | .information => 3
    cfDiags := cfDiags.push {
      range := ⟨s, e⟩, fullRange := ⟨s, e⟩, severity := sev, message := text
      leanTags := if text.startsWith "unsolved goals" then #[1] else #[] }
    if sev == 1 then errPos := errPos.push s
  let parsed ← (do
    match ← RequestM.runTermElabM synth
      (liftM <| Paperproof.Services.BetterParser_Tree cfMap synth.infoTree) with
    | some res => pure res
    | none => pure { steps := [], allGoals := {} })
  let payload ← mkTreePayload synth cfMap parsed errPos cfDiags
  if payload.steps.isEmpty then return none

  let stubPos := cfMap.utf8PosToLspPos ⟨stubByte⟩

  let (draftToks, draftInfos) ←
    tokensInSpan synth cfMap fun p =>
      p.line == pos.line && p.character ≥ draftCol
        && p.character < stubPos.character

  let onLine (p : Lsp.Position) := p.line == pos.line
  let edits := payload.tacticEdits.filter fun e =>
    !(e.start.line ≤ pos.line && pos.line ≤ e.stop.line)
  let slots := payload.deleteSlots.filter fun s =>
    !(onLine s.start || onLine s.stop)
  return some { payload with
    cfLine := some pos.line, cfStubPos := some stubPos
    cfDraftTokens := draftToks, cfDraftInfos := draftInfos
    tacticEdits := edits, deleteSlots := slots }

private def maybeCounterfactual (wantCf : Bool) (pos : Lsp.Position)
    (doc : FileWorker.EditableDocument) (fileMap : FileMap)
    (real : ProofTreeData) : RequestM ProofTreeData := do
  unless wantCf do return real

  let withDraft (blob : ProofTreeData) (draft : String) (col : Nat) :
      ProofTreeData :=
    { blob with cfDraft := some draft, cfDraftCol := some col }

  let serveReal (r : ProofTreeData) : RequestM ProofTreeData := do
    if let some (_, _, ln, _, _) ← cfServeCache.get then
      if ln == pos.line then cfServeCache.set none
    return r
  if real.openBlock.isSome then return ← serveReal real

  if !real.steps.isEmpty
      && declContainsPos real pos
      && !real.deleteSlots.isEmpty
      && real.deleteSlots.all (·.start.line > pos.line) then
    return ← serveReal real
  let some splice := cfSplice fileMap pos.line pos.character
    | return ← serveReal real
  let draft := splice.draft

  let stepStartsHere := real.steps.any fun s => s.position.start.line == pos.line
  if let some (sh, seen, ln, ck, blob) ← cfServeCache.get then
    if ln == pos.line && !stepStartsHere then
      let srcHash : UInt64 := hash fileMap.source
      let now ← IO.monoMsNow

      if sh == srcHash then
        if now - seen ≥ cfExitSettleMs && payloadHealthy real pos then
          cfServeCache.set none
          return real

        cfServeCache.set (some (srcHash, seen, ln, ck, blob))
        return withDraft blob draft splice.draftCol
      if ck == hash (splice.text ()) then

        cfServeCache.set (some (srcHash, now, ln, ck, blob))
        return withDraft blob draft splice.draftCol
  unless cfWanted real pos stepStartsHere do return ← serveReal real

  let cfText := splice.text ()
  let cfKey : UInt64 := hash cfText
  let srcHash : UInt64 := hash fileMap.source
  let now ← IO.monoMsNow
  if let some (k, entry) ← cfElabCache.get then
    if k == cfKey then
      match entry with
      | .done (some blob) =>
        cfServeCache.set (some (srcHash, now, pos.line, cfKey, blob))
        return withDraft blob draft splice.draftCol
      | .done none => return ← serveReal real
      | .pending t0 =>

        if now - t0 < 20000 then
          return { real with cfPending := true }
  cfElabCache.set (some (cfKey, .pending now))
  let rc ← read
  let _ ← IO.asTask (prio := .default) do
    let res ← match ← ((computeCf doc pos splice.draftCol cfText splice.stubByte).run rc).toBaseIO with
      | .ok res => pure res
      | .error _ => pure none

    cfElabCache.set (some (cfKey, .done res))
    if let some blob := res then

      cfServeCache.set (some (srcHash, ← IO.monoMsNow, pos.line, cfKey, blob))
  return { real with cfPending := true }

private def cfNudgePos? (fileMap : FileMap) (pos : Lsp.Position) :
    Option String.Pos.Raw :=
  if pos.character != 0 then none
  else if pos.line + 1 ≥ fileMap.positions.size then none
  else
    let src := fileMap.source
    let lineStart := fileMap.lspPosToUtf8Pos ⟨pos.line, 0⟩
    let nextStart := fileMap.lspPosToUtf8Pos ⟨pos.line + 1, 0⟩
    let lineRaw := String.Pos.Raw.extract src lineStart nextStart
    let contentEnd : String.Pos.Raw :=
      if lineRaw.endsWith "\n" then ⟨nextStart.byteIdx - 1⟩ else nextStart
    let content := String.Pos.Raw.extract src lineStart contentEnd
    let ws := (content.takeWhile fun c => c == ' ' || c == '\t').toString
    let body := (content.drop ws.length).toString
    if body.isEmpty then none
    else some (fileMap.lspPosToUtf8Pos ⟨pos.line, max 1 ws.length⟩)

private def realPayloadFor (doc : FileWorker.EditableDocument) (fileMap : FileMap)
    (snap : Snapshots.Snapshot) : RequestM ProofTreeData := do
    let snapStart := (snap.stx.getRange?.map (·.start.byteIdx)).getD 0

    let interactiveDiags := (← doc.collectCurrentDiagnostics).toArray
    let cacheKey := (doc.meta.uri, doc.meta.version, snapStart, interactiveDiags.size)

    let cachedReal? : Option ProofTreeData :=
      match ← proofTreeCache.get with
      | some (key, payload) => if key == cacheKey then some payload else none
      | none => none
    match cachedReal? with
      | some real => pure real
      | none => do
        let parsed ← (do
          match ← RequestM.runTermElabM snap
            (liftM <| Paperproof.Services.BetterParser_Tree fileMap snap.infoTree) with
          | some r => pure r
          | none => pure { steps := [], allGoals := {} })

        let errorPositions := interactiveDiags.foldl (init := #[]) fun acc d =>
          if d.severity? == some .error then acc.push d.range.start else acc
        let treeDiags : Array TreeDiag := interactiveDiags.map fun d =>
          let full := d.fullRange?.getD d.range
          { range := ⟨d.range.start, d.range.end⟩
            fullRange := ⟨full.start, full.end⟩
            severity := match d.severity? with
              | some .error => 1 | some .warning => 2 | _ => 3

            message := d.toDiagnostic.message
            isSilent := d.isSilent?.getD false
            leanTags := (d.leanTags?.getD #[]).map fun
              | .unsolvedGoals => 1 | .goalsAccomplished => 2 }
        let real ← mkTreePayload snap fileMap parsed errorPositions treeDiags
        proofTreeCache.set <| some (cacheKey, real)
        pure real

@[server_rpc_method]
def getProofTree (params : GetProofTreeParams) : RequestM (RequestTask ProofTreeData) := do
  let doc ← readDoc
  let fileMap : FileMap := doc.meta.text
  let withCf (real : ProofTreeData) : RequestM (RequestTask ProofTreeData) :=
    RequestM.pureTask (maybeCounterfactual params.cf params.pos doc fileMap real)

  let atCursor : RequestM (RequestTask ProofTreeData) :=
    let cursorPos := fileMap.lspPosToUtf8Pos params.pos
    RequestM.bindWaitFindSnap doc (fun s => s.endPos >= cursorPos)
      (notFoundX := throw ⟨.invalidParams, s!"no snapshot found at {params.pos}"⟩)
      (x := fun snap => do withCf (← realPayloadFor doc fileMap snap))
  match cfNudgePos? fileMap params.pos with
  | none => atCursor
  | some nudge =>
    RequestM.bindWaitFindSnap doc (fun s => s.endPos >= nudge)

      (notFoundX := atCursor)
      (x := fun snap => do
        let real ← realPayloadFor doc fileMap snap

        if real.steps.isEmpty && real.openBlock.isNone then atCursor
        else withCf real)

partial def ciPrefix (pref s : String) : Bool :=
  go ⟨0⟩ ⟨0⟩
where
  go (pi si : String.Pos.Raw) : Bool :=
    if String.Pos.Raw.atEnd pref pi then true
    else if String.Pos.Raw.atEnd s si then false
    else if (String.Pos.Raw.get pref pi).toLower ==
        (String.Pos.Raw.get s si).toLower then
      go (String.Pos.Raw.next pref pi) (String.Pos.Raw.next s si)
    else false

def lastDotPos? (s : String) : Option String.Pos.Raw := Id.run do
  let mut p : String.Pos.Raw := ⟨0⟩
  let mut found : Option String.Pos.Raw := none
  while !String.Pos.Raw.atEnd s p do
    if String.Pos.Raw.get s p == '.' then found := some p
    p := String.Pos.Raw.next s p
  return found

def minCompletionQuery : Nat := 3

def maxCompletionNames : Nat := 50

def scanNames (query : String) : MetaM (Array String) := do
  let (nsQuery?, frag) :=
    match lastDotPos? query with
    | some p =>
      (some (String.Pos.Raw.extract query ⟨0⟩ p),
       String.Pos.Raw.extract query (String.Pos.Raw.next query p) query.rawEndPos)
    | none => (none, query)
  let acc ← IO.mkRef (#[] : Array String)
  Server.Completion.forEligibleDeclsM fun declName _ => do

    let .str parent s := declName | return ()
    unless ciPrefix frag s do return ()
    if isPrivateName declName || declName.isInternalDetail then return ()
    if let some ns := nsQuery? then
      let ps := parent.toString

      unless ps.utf8ByteSize == ns.utf8ByteSize && ciPrefix ns ps do return ()
    acc.modify (·.push declName.toString)
  let names ← acc.get
  let names := names.qsort fun a b =>
    a.length < b.length || (a.length == b.length && a < b)
  return names.take maxCompletionNames

structure CompletionNamesParams where
  pos   : Lsp.Position
  query : String
  deriving FromJson, ToJson

@[server_rpc_method]
def completionNames (params : CompletionNamesParams) :
    RequestM (RequestTask (Array String)) := do
  withWaitFindSnapAtPos params.pos fun snap => do
    if params.query.length < minCompletionQuery then return #[]
    let some (ctx, _) := anyGoalContext snap.infoTree
      | return #[]
    ctx.runMetaM {} (scanNames params.query)

structure GoalAnnotation where
  line : Nat
  text : String
  deriving FromJson, ToJson

structure PopoutEditParams where
  uri    : String
  start  : Lsp.Position
  stop   : Lsp.Position
  action : String := "popout"

  annotations : Array GoalAnnotation := #[]
  deriving FromJson, ToJson

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
      ("action", toJson params.action),
      ("annotations", toJson params.annotations)
    ]
    IO.FS.writeFile (dir / "popout-request.json") payload.compress
    return "ok"

structure ThemeTokenColor where
  type  : String
  color : String
  deriving ToJson, FromJson

structure ThemeAbbrev where

  abbreviation : String
  symbol : String
  deriving ToJson, FromJson

structure InputConfig where

  enabled : Bool := true

  leader : String := "\\"

  eager : Bool := true

  custom : Array ThemeAbbrev := #[]
  deriving ToJson

instance : FromJson InputConfig where
  fromJson? j :=
    .ok { enabled := jsonField j "enabled" true,
          leader := jsonField j "leader" "\\",
          eager := jsonField j "eager" true,
          custom := jsonField j "custom" #[] }

structure ThemeColors where

  theme  : String := ""

  brackets : Bool := false

  outline : Bool := false

  linkTint : Bool := false

  linkMarks : Bool := false

  typingHoldMs : Nat := 600

  counterfactual : Bool := true

  hypMarkStyle : String := "highlight"

  input : InputConfig := {}
  colors : Array ThemeTokenColor := #[]
  deriving ToJson

instance : FromJson ThemeColors where
  fromJson? j :=
    .ok { theme := jsonField j "theme" "",
          brackets := jsonField j "brackets" false,
          outline := jsonField j "outline" false,
          linkTint := jsonField j "linkTint" false,
          linkMarks := jsonField j "linkMarks" false,
          typingHoldMs := jsonField j "typingHoldMs" 600,
          counterfactual := jsonField j "counterfactual" true,
          hypMarkStyle := jsonField j "hypMarkStyle" "highlight",
          input := jsonField j "input" {},
          colors := jsonField j "colors" #[] }

structure ThemeColorsParams where
  deriving FromJson, ToJson

@[server_rpc_method]
def themeColors (_ : ThemeColorsParams) : RequestM (RequestTask ThemeColors) := do
  RequestM.asTask do
    let some home ← IO.getEnv "HOME" | return {}
    let file := System.FilePath.mk home / ".proof-tree-companion" / "theme-colors.json"

    unless ← file.pathExists do return {}
    let txt ← IO.FS.readFile file
    match Json.parse txt >>= fromJson? with
    | .error _ => return {}
    | .ok (c : ThemeColors) => return c

end ProofTree

@[widget_module]
def Ramify : ProofWidgets.Component ProofWidgets.PanelWidgetProps where
  javascript := include_str ".." / "web" / "dist" / "proofTreeWidget.js"
