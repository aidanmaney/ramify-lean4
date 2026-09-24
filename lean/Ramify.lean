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

  -- B1/Part E — the LEDGER a structured term draws as, one row per component.
  -- Plain data, so it rides both wires and the offline probes see it.
  termLedgers   : Array ProofTree.Recover.TermLedger := #[]

  hypOrigins    : Array ProofTree.HypOrigin := #[]

  -- D1 — how many steps use each `have`/`obtain`-introduced hypothesis, and
  -- which. `hypOrigins` ∘ `tacticDependsOn`; the input the inline move needs.
  haveUses      : Array ProofTree.HaveUse := #[]

  lemmaRefs     : Array ProofTree.LemmaRef := #[]

  branches      : Array ProofTree.BranchInfo := #[]

  openBlock     : Option ProofTree.Recover.OpenBlock := none

  diagnostics   : Array TreeDiag := #[]

  cfLine        : Option Nat := none

  cfStubPos     : Option Lsp.Position := none

  cfDraft       : Option String := none

  cfDraftCol    : Option Nat := none

  declHeader    : String := ""
  declHeaderTokens : Array TacticToken := #[]

  declHeaderStart : Option Lsp.Position := none

  /-- Where the header's name ENDS and its binders begin: the start of the
  declaration's `declSig`/`optDeclSig` node, found by KIND. Absent where the
  signature is empty (`example := …`) or no signature node is found. -/
  declHeaderNameStop : Option Lsp.Position := none

  /-- Where the header's TYPE SPEC begins: the `:` of the `typeSpec` inside the
  `declSig`/`optDeclSig`, found by KIND. Without a type spec, the end of the
  binders; with neither, the end of the keyword/`declId`. The widget's resting
  header is the text up to here (keyword, name, binders). -/
  declHeaderSigStop : Option Lsp.Position := none

  /-- Where the header ENDS and the body begins: the start of the
  declaration's value node — `declValSimple` (its `:=`), `declValEqns` (the
  first `|`) or `whereStructInst` (`where`) — the first in preorder, found by
  KIND. The widget's greedy resting header is the text up to here (keyword,
  name, binders, `: type`), shown whole wherever it fits on one line. -/
  declHeaderBodyStop : Option Lsp.Position := none

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

-- ONE predicate, shared with `lemmaRefs` (B3): what paints as a constant and
-- what appears in a step's reference list are the same set of identifiers, by
-- construction rather than by two matching guards.
def collectConstIdentTokens (tree : InfoTree) : Array FileWorker.LeanSemanticToken :=
  (constIdentNodes tree).toArray.map fun (stx, _) =>
    { stx, type := Lsp.SemanticTokenType.function }

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

    let recovE ← Recover.recoverTermInStep fileMap snap.infoTree remapped.steps
    let recov : Recover.Recovery := {
      steps := recovA.steps ++ recovB.steps ++ recovD.steps ++ recovE.steps
      goals := recovA.goals ++ recovB.goals ++ recovD.goals ++ recovE.goals
      grafts := recovA.grafts ++ recovB.grafts ++ recovD.grafts ++ recovE.grafts
      recovered := recovA.recovered ++ recovB.recovered ++ recovD.recovered
                     ++ recovE.recovered
      ledgers := recovE.ledgers }

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

    -- The tight source of one written tactic, by its start.  A step whose
    -- macro expands to NESTED tactics (`intro h h2` → `intro h; intro h2`) is
    -- harvested at the inner node's range, and `surfaceTacticRange` cannot
    -- widen it: the outer node begins at the same byte, and the rule there
    -- deliberately takes the smallest container starting STRICTLY before the
    -- step (loosening it would swallow `induction … with`'s whole block).
    -- The slot knows the answer, so the slot is asked — but only where its
    -- own text reads exactly the step's LABEL, which is what tells one
    -- tactic written long (`intro h h2`) from a slot that owns more than the
    -- step (`induction … with`, a `<;>` combinator).
    let slotStops : Std.HashMap (Nat × Nat) Lsp.Position :=
      slots.foldl (init := {}) fun acc sl =>
        acc.insert (sl.start.line, sl.start.character) sl.stop
    let tightOf (t : String) : String :=
      String.Pos.Raw.extract t ⟨0⟩ (trimmedEnd t)

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

        let (b, e) : String.Pos.Raw × String.Pos.Raw :=
          match slotStops[(start.line, start.character)]? with
          | some sstop =>
            let se := fileMap.lspPosToUtf8Pos sstop
            if se.byteIdx > e.byteIdx
                && tightOf (String.Pos.Raw.extract src b se) == tightOf s.tacticString then
              (b, se)
            else (b, e)
          | none => (b, e)

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
    -- The signature split, by syntax KIND: the first `declSig`/`optDeclSig`
    -- in preorder (the declaration's own; a nested `by` holds none), then the
    -- `typeSpec` inside it.
    let sigNode? : Option Syntax :=
      (ProofTree.nodesOfKind [``Lean.Parser.Command.declSig,
          ``Lean.Parser.Command.optDeclSig] snap.stx)[0]?
    let declHeaderNameStop? : Option Lsp.Position :=
      sigNode?.bind (·.getPos?) |>.map fileMap.utf8PosToLspPos
    let declHeaderSigStop? : Option Lsp.Position := Id.run do
      let some sig := sigNode? | return none
      let specs := ProofTree.nodesOfKind [``Lean.Parser.Term.typeSpec] sig
      if let some p := specs[0]? |>.bind (·.getPos?) then
        return some (fileMap.utf8PosToLspPos p)
      if let some p := sig.getTailPos? then
        return some (fileMap.utf8PosToLspPos p)
      let ids := ProofTree.nodesOfKind [``Lean.Parser.Command.declId] snap.stx
      if let some p := ids[0]? |>.bind (·.getTailPos?) then
        return some (fileMap.utf8PosToLspPos p)
      -- `example := …`: nothing but the keyword, the head atom of the
      -- declaration's own node.
      let decls := ProofTree.nodesOfKind [``Lean.Parser.Command.example,
        ``Lean.Parser.Command.instance, ``Lean.Parser.Command.definition,
        ``Lean.Parser.Command.abbrev, ``Lean.Parser.Command.theorem] snap.stx
      return decls[0]? |>.bind (·.getHead?) |>.bind (·.getTailPos?)
        |>.map fileMap.utf8PosToLspPos
    let declHeaderBodyStop? : Option Lsp.Position :=
      (ProofTree.nodesOfKind [``Lean.Parser.Command.declValSimple,
          ``Lean.Parser.Command.declValEqns,
          ``Lean.Parser.Command.whereStructInst] snap.stx)[0]?
        |>.bind (·.getPos?) |>.map fileMap.utf8PosToLspPos
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

    let lemmaRefs ← ProofTree.lemmaRefs snap.env fileMap snap.infoTree
      parsedTree.steps (declName? snap.stx)

    let branches ← ProofTree.branches fileMap snap.infoTree parsedTree.steps

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
      declHeaderNameStop := declHeaderNameStop?,
      declHeaderSigStop := declHeaderSigStop?,
      declHeaderBodyStop := declHeaderBodyStop?,
      diagnostics := treeDiags,
      steps       := parsedTree.steps,
      allGoals    := parsedTree.allGoals.toList,
      taggedGoals,
      comments,
      tacticEdits,
      tokenInfos,
      deleteSlots := slots
      recovered   := recov.recovered
      termLedgers := recov.ledgers
      hypOrigins  := ProofTree.hypOrigins parsedTree.steps
      haveUses    := ProofTree.haveUses parsedTree.steps
      lemmaRefs
      branches
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

/-- The RE-ELABORATION SEAM, shared by the counterfactual pipeline and B4's
automation traces. Given a whole-file text that differs from the document's own
only INSIDE one declaration, re-parse and re-elaborate that single declaration
against the snapshot standing before it, and hand back the synthetic snapshot
plus the messages it produced.

`anchorByte` is the byte the declaration must contain — the same offset in both
texts, since every rewrite either splices one line (`cfSplice`) or inserts `?`
characters (`traceRewrite`), neither of which touches anything before the
declaration's own start.

`needInfoTree` is what the cf path wants and the trace path does not: cf reads
the synthetic tree with `BetterParser_Tree`, while a trace reads only messages,
and a `sorry`-free re-elaboration can legitimately leave more than one tree. -/
private structure ReElab where
  snap  : Snapshots.Snapshot
  map   : FileMap
  /-- Parse messages and elaboration messages together, in that order. -/
  msgs  : List Message
  /-- How many of `msgs` came from the PARSE phase, i.e. the prefix. An error
  in that prefix is a STRUCTURAL failure of a candidate rewrite (the text no
  longer parses); one after it is a semantic failure (it parses and does not
  check). D1's classifier is the only reader. -/
  nParse : Nat := 0

private def reElabDecl (doc : FileWorker.EditableDocument) (text : String)
    (anchorByte : Nat) (needInfoTree : Bool := true)
    -- D4: `opts` is what the re-elaboration runs under, on top of the scope's
    -- own.  The one caller that passes anything is `lintDecl`, which turns
    -- Mathlib's linters on; `Elab.async` is forced off either way, which is
    -- what makes `runLintersAsync` run the linters SYNCHRONOUSLY and log them
    -- into the state this returns.
    (opts : Options → Options := id) :
    RequestM (Option ReElab) := do
  let (snaps, _, _) ← doc.cmdSnaps.getFinishedPrefix

  let prev? := snaps.foldl (init := none) fun acc s =>
    if s.endPos.byteIdx ≤ anchorByte then some s else acc
  let some prev := prev? | return none
  let ictx := Parser.mkInputContext text doc.meta.uri
  let map := ictx.fileMap
  let scopes := prev.cmdState.scopes.map fun sc =>
    { sc with opts := opts (Elab.async.set sc.opts false) }
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
  unless r.start.byteIdx ≤ anchorByte && anchorByte < r.stop.byteIdx do
    return none
  let cmdCtx : Command.Context := {
    fileName := doc.meta.uri, fileMap := map,
    cmdPos := prev.mpState.pos, snap? := none, cancelTk? := none }
  let ref ← IO.mkRef cmdState0
  Command.withLoggingExceptions
    (Elab.getResetInfoTrees *> Command.elabCommandTopLevel stx) cmdCtx ref
  let stFinal ← ref.get
  if needInfoTree && stFinal.infoState.trees.size != 1 then return none
  return some {
    snap := { stx, mpState := mpState', cmdState := stFinal }
    map
    msgs := parseMsgs.toList ++ stFinal.messages.toList
    nParse := parseMsgs.toList.length }

/-- The RAW parser's step count over a snapshot.  D1 and D2a both report step
counts before and after a candidate rewrite, and both count them this way: the
raw parser over the declaration as written.  `real.steps` has the recovery
parser's own steps (subterms, term proofs, failed tactics) folded in, and the
rewritten text gets no recovery pass, so comparing the two would report a
saving that is really a difference of pipelines. -/
private def rawStepsIn (sn : Snapshots.Snapshot) (fm : FileMap) : RequestM Nat := do
  match ← RequestM.runTermElabM sn
    (liftM <| Paperproof.Services.BetterParser_Tree fm sn.infoTree) with
  | some r => pure r.steps.length
  | none => pure 0

private def computeCf (doc : FileWorker.EditableDocument) (pos : Lsp.Position)
    (draftCol : Nat)
    (cfText : String) (stubByte : Nat) : RequestM (Option ProofTreeData) := do
  let fileMap := doc.meta.text
  let lineStart := fileMap.lspPosToUtf8Pos ⟨pos.line, 0⟩
  let some re ← reElabDecl doc cfText lineStart.byteIdx | return none
  let cfMap := re.map
  let synth := re.snap
  let mut cfDiags : Array TreeDiag := #[]
  let mut errPos : Array Lsp.Position := #[]
  for m in re.msgs do
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

/-- The declaration's start byte, read off the SNAPSHOT alone.  It is the same
number `declByteOf` reads off the payload: `declRange` is minted in
`mkTreePayload` as this very range put through `utf8PosToLspPos`, and
`realPayloadFor`'s cache key pins a payload to its own snapshot's start, so the
round trip back through `lspPosToUtf8Pos` lands here and the `none` fallback is
this number too.  That is what lets `lintDecl` answer from its cache without
asking for the harvest at all. -/
private def declAnchorByte (snap : Snapshots.Snapshot) : Nat :=
  (snap.stx.getRange?.map (·.start.byteIdx)).getD 0

/-- The declaration's anchor byte: where `reElabDecl` is told the declaration
starts.  The payload's own `declRange` where the harvest found one, and the
snapshot's syntax range otherwise — the same fallback in all four callers. -/
private def declByteOf (fileMap : FileMap) (snap : Snapshots.Snapshot)
    (real : ProofTreeData) : Nat :=
  match real.declRange with
  | some r => (fileMap.lspPosToUtf8Pos r.start).byteIdx
  | none => declAnchorByte snap

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

/-! ## B4 — automation traces, on demand

WHAT `simp` USED. The reader's question about an automation step is the one
the source cannot answer: the author wrote no lemma name, and the premises are
whatever the search found. Core's own `?` forms report exactly that, so a trace
is the declaration re-elaborated with its automation tactics rewritten to
`simp?`/`simp_all?`/`grind?`/`aesop?` and the `Try this` suggestions read back
(`ProofTree.collectTraces`).

LAZY, and PER DECLARATION rather than per step. Lazy because an extra
elaboration of a Mathlib declaration on every cursor move is not affordable and
most readers never ask; per declaration because a `?` form behaves exactly as
the bare one, so ONE re-elaboration with every site rewritten answers for the
whole proof — the brief's per-step splice would pay that cost once per `simp`.
The client asks about one step and is handed the declaration's whole list,
which is also what makes a second step's trace free.

Cached on `(uri, version, declaration start)`: the same key `proofTreeCache`
uses minus the diagnostics count, since a trace does not depend on them.
Synchronous, unlike the counterfactual — the reader asked for this one and is
watching a pending affordance, where cf fires unbidden on a cursor move. -/

structure GetAutomationTraceParams where
  pos : Lsp.Position
  /-- The step the reader asked about. Carried for the log and for a future
  narrowing; the answer is the whole declaration's list either way. -/
  stepStart : Option Lsp.Position := none
  deriving ToJson, FromJson, Server.RpcEncodable

structure AutomationTraces where
  traces : Array ProofTree.AutomationTrace := #[]
  /-- Why the list is short of what was asked for, where it is. -/
  note   : Option String := none
  deriving Server.RpcEncodable

initialize automationTraceCache :
    IO.Ref (Option ((String × Nat × Nat) × AutomationTraces)) ←
  IO.mkRef none

private def computeTraces (doc : FileWorker.EditableDocument)
    (snap : Snapshots.Snapshot) (real : ProofTreeData) (declByte : Nat) :
    RequestM AutomationTraces := do
  let fileMap := doc.meta.text
  let sites := ProofTree.traceSites fileMap real.steps
  if sites.isEmpty then return {}
  match ProofTree.traceRewrite fileMap.source sites with
  | none =>

    return { traces := ← ProofTree.collectTraces snap.env sites #[] }
  | some text =>
    let some re ← reElabDecl doc text declByte (needInfoTree := false)
      | return { traces := ← ProofTree.collectTraces snap.env sites #[]
                 note := some "the declaration could not be re-elaborated" }
    let mut msgs : Array (Lsp.Position × String) := #[]
    for m in re.msgs do
      msgs := msgs.push (re.map.leanPosToLspPos m.pos, ← m.data.toString)
    return { traces := ← ProofTree.collectTraces snap.env sites msgs }

@[server_rpc_method]
def getAutomationTrace (params : GetAutomationTraceParams) :
    RequestM (RequestTask AutomationTraces) := do
  let doc ← readDoc
  let fileMap : FileMap := doc.meta.text
  let cursorPos := fileMap.lspPosToUtf8Pos params.pos
  RequestM.bindWaitFindSnap doc (fun s => s.endPos >= cursorPos)
    (notFoundX := throw ⟨.invalidParams, s!"no snapshot found at {params.pos}"⟩)
    (x := fun snap => RequestM.pureTask do
      let real ← realPayloadFor doc fileMap snap
      if real.steps.isEmpty then
        return ({ note := some "no steps to trace" } : AutomationTraces)
      let declByte := declByteOf fileMap snap real
      let key := (doc.meta.uri, doc.meta.version, declByte)
      if let some (k, cached) ← automationTraceCache.get then
        if k == key then return cached
      let out ← computeTraces doc snap real declByte
      automationTraceCache.set (some (key, out))
      return out)

/-! ## D4 — the linters, asked of the elaborator (`lintDecl`)

Mathlib's style rules ship as `linter.*` options that run at elaboration and
log a warning at the syntax they object to, so D4 reimplements nothing: the
declaration is re-elaborated ONCE with `ProofTree.withLinters` on the scope's
options and the linter messages come back with their own ranges and their own
option names (read off the message's tag, not scraped out of its text).

LAZY, on the same seam and for the same reason as B4's traces: an extra
elaboration of a Mathlib declaration on every cursor move is not affordable
and most readers never ask. The client asks once per declaration, when the
reader turns `lints` on.

Two things the CLAUDE.md warnings predicted and that hold here:

* **`Elab.async` is ON on the server**, and `runLintersAsync` would then post
  the linters to a snapshot task whose messages this call never sees.
  `reElabDecl` already forces it off, so `runLinters` runs inline and the
  messages land in the command state this reads.
* **`snap.msgLog` is empty on the server**, which is why the messages are the
  re-elaboration's own (`re.msgs`) and not the file's.

Cached on `(uri, version, declaration start)` — the automation trace's key,
and for the same reason: the answer depends on the declaration's text alone. -/

structure LintDeclParams where
  pos : Lsp.Position
  deriving ToJson, FromJson, Server.RpcEncodable

structure LintDeclResult where
  lints : Array ProofTree.Lint := #[]
  /-- Why the list is short of what was asked for, where it is. -/
  note  : Option String := none
  /-- The options that were on, so the `?` panel can name them. -/
  linters : Array String := #[]
  deriving Server.RpcEncodable

initialize lintCache :
    IO.Ref (Option ((String × Nat × Nat) × LintDeclResult)) ←
  IO.mkRef none

@[server_rpc_method]
def lintDecl (params : LintDeclParams) :
    RequestM (RequestTask LintDeclResult) := do
  let doc ← readDoc
  let fileMap : FileMap := doc.meta.text
  let cursorPos := fileMap.lspPosToUtf8Pos params.pos
  let names := ProofTree.lintLinters.map (·.toString)
  RequestM.bindWaitFindSnap doc (fun s => s.endPos >= cursorPos)
    (notFoundX := throw ⟨.invalidParams, s!"no snapshot found at {params.pos}"⟩)
    (x := fun snap => RequestM.pureTask do
      -- The cache is asked BEFORE anything is elaborated or harvested: the
      -- key is the declaration's own start byte, which `declAnchorByte` reads
      -- off the snapshot, so a repeat ask costs nothing.  Nothing below this
      -- needs the payload.
      let declByte := declAnchorByte snap
      let key := (doc.meta.uri, doc.meta.version, declByte)
      if let some (k, cached) ← lintCache.get then
        if k == key then return cached
      let some re ← reElabDecl doc fileMap.source declByte
          (needInfoTree := false) (opts := ProofTree.withLinters)
        | return ({ note := some "the declaration could not be re-elaborated"
                    linters := names } : LintDeclResult)
      let out : LintDeclResult :=
        { lints := ← ProofTree.lintsOf re.map re.msgs, linters := names }
      lintCache.set (some (key, out))
      return out)

/-! ## D1 — verify a candidate rewrite before it is offered (`checkRewrite`)

The Sledgehammer "preplay" discipline: a restructuring is a set of TEXT EDITS
computed on the client (`web/src/rewrite.ts`), and it is not offered to the
reader until the elaborator has been asked whether the rewritten declaration
still checks. Nothing is written to the document by this RPC — the edits are
applied to a COPY of the file's text and re-elaborated through the same seam
the counterfactual and the automation traces use (`reElabDecl`), so a rejected
proposal costs one elaboration and changes nothing.

The verdict is the delete gesture's three-way classification, decided here
because only here are the parse messages distinguishable from the elaboration
ones:

* `structural` — the rewritten text does not PARSE (no declaration came back,
  or an error message from the parse prefix). The rewrite is malformed; the
  reader is told nothing beyond "it does not parse", because a parse error
  inside a rewrite we generated is our bug and not their proof's.
* `semantic` — it parses and does not check: `unsolved goals`, a type error,
  an unknown identifier. The FIRST error's first line is handed back, since
  that is the sentence a reader can act on.
* `benign` — no error at all. `sorry` warnings are ignored the way `computeCf`
  ignores them, and `steps` comes back so the pill can say how much shorter
  the proof got.

NOT cached. A trace is asked for once per declaration and reused; a rewrite is
asked for once per proposal, and the proposals differ by their edits, which is
the whole key — caching them would mean keying on the edit text for a saving
of at most one repeat click. -/

structure RewriteEdit where
  start   : Lsp.Position
  stop    : Lsp.Position
  newText : String
  deriving FromJson, ToJson, Server.RpcEncodable

structure CheckRewriteParams where
  pos   : Lsp.Position
  edits : Array RewriteEdit
  deriving FromJson, ToJson, Server.RpcEncodable

structure CheckRewriteResult where
  /-- `benign` | `semantic` | `structural`. -/
  verdict : String := "structural"
  ok      : Bool := false
  /-- The first error's first line, where there is one. -/
  message : Option String := none
  /-- Steps in the REWRITTEN proof (0 unless the verdict is `benign`). -/
  steps   : Nat := 0
  /-- Steps in the proof as written. -/
  before  : Nat := 0
  deriving Server.RpcEncodable

/-- Splice every edit into the file's text, latest first so earlier offsets
stay valid. Edits are expected to be pairwise disjoint (the client computes
them from tight tactic ranges); an overlap simply loses the earlier one. -/
private def applyRewriteEdits (fileMap : FileMap) (edits : Array RewriteEdit) :
    String := Id.run do
  let sorted := edits.qsort fun a b => (compare a.start b.start).isGT
  let mut text := fileMap.source
  for e in sorted do
    let s := (fileMap.lspPosToUtf8Pos e.start)
    let t := (fileMap.lspPosToUtf8Pos e.stop)
    if s.byteIdx ≤ t.byteIdx && t.byteIdx ≤ text.rawEndPos.byteIdx then
      text := String.Pos.Raw.extract text ⟨0⟩ s ++ e.newText
        ++ String.Pos.Raw.extract text t text.rawEndPos
  return text

@[server_rpc_method]
def checkRewrite (params : CheckRewriteParams) :
    RequestM (RequestTask CheckRewriteResult) := do
  let doc ← readDoc
  let fileMap : FileMap := doc.meta.text
  let cursorPos := fileMap.lspPosToUtf8Pos params.pos
  RequestM.bindWaitFindSnap doc (fun s => s.endPos >= cursorPos)
    (notFoundX := throw ⟨.invalidParams, s!"no snapshot found at {params.pos}"⟩)
    (x := fun snap => RequestM.pureTask do
      let real ← realPayloadFor doc fileMap snap
      let before ← rawStepsIn snap fileMap
      if params.edits.isEmpty then
        return ({ verdict := "structural", before
                  message := some "no edits" } : CheckRewriteResult)
      let declByte := declByteOf fileMap snap real
      let text := applyRewriteEdits fileMap params.edits
      let some re ← reElabDecl doc text declByte
        | return ({ verdict := "structural", before
                    message := some "the rewritten declaration did not parse"
                  } : CheckRewriteResult)
      let mut i := 0
      let mut firstErr : Option (Bool × String) := none
      for m in re.msgs do
        if m.severity == .error then
          let t ← m.data.toString
          if firstErr.isNone then firstErr := some (i < re.nParse, t)
        i := i + 1
      match firstErr with
      | some (isParse, t) =>
        let line := (t.trim.splitOn "\n").headD t
        return { verdict := if isParse then "structural" else "semantic"
                 before, message := some line }
      | none =>
        return { verdict := "benign", ok := true, before
                 steps := ← rawStepsIn re.snap re.map })

/-! ## D2a — collapse a run of steps to one automation tactic (`tryClose`)

`tryAtEachStep`'s trick, asked of a RUN rather than of a step, and on the same
seam D1 and B4 already use. The client finds the LINEAR RUNS (`linearRuns` in
web/src/rewrite.ts — consecutive trunk steps, each producing exactly one
ordinary goal, the last of them closing it) and asks this RPC whether any one
tactic closes the run's first goal on its own. The run's own text extent — the
first step's tight start to the last step's tight stop — is spliced to the
candidate and the declaration re-elaborated; the FIRST candidate that comes
back benign is the offer, and nothing is written by this call.

`from`/`to` are the first and last step's `position.start`, and the extent is
looked up here from the payload's own `deleteSlots`: the wire carries two
positions rather than a range, so a client cannot ask for the splice of a
range it did not compute from the tree.

Cost is bounded by construction: at most `tactics.size` re-elaborations, one
run at a time, only when the reader clicks. Cached on
`(uri, version, from, to)` — the answer for one run cannot change while the
document does not. -/

structure TryCloseParams where
  pos    : Lsp.Position
  /-- The first step of the run (its `position.start`). -/
  «from» : Lsp.Position
  /-- The last step of the run. -/
  to     : Lsp.Position
  /-- Overrides the default candidate list, in order. -/
  tactics : Option (Array String) := none
  deriving FromJson, ToJson, Server.RpcEncodable

structure TryCloseResult where
  /-- The first candidate that elaborated benignly, where there was one. -/
  tactic  : Option String := none
  /-- `benign` (a candidate closed it) | `none` (none did) | `structural`. -/
  verdict : String := "structural"
  ok      : Bool := false
  message : Option String := none
  /-- Every candidate tried, in order, and the milliseconds each one cost. -/
  tried   : Array String := #[]
  ms      : Array Nat := #[]
  /-- Raw parser step counts, as `checkRewrite` reports them. -/
  before  : Nat := 0
  steps   : Nat := 0
  deriving Server.RpcEncodable

/-- The candidates, in order, MIRRORED from `AUTOMATION_CANDIDATES` in
web/src/rewrite.ts. `omega` first because it is the cheapest and the most
common answer; `aesop` last because it is the most expensive. -/
def closingCandidates : Array String :=
  #["omega", "simp", "linarith", "norm_num", "grind", "decide", "ring",
    "simp_all", "aesop"]

initialize tryCloseCache :
    IO.Ref (Option ((String × Nat × Nat × Nat) × TryCloseResult)) ←
  IO.mkRef none

@[server_rpc_method]
def tryClose (params : TryCloseParams) :
    RequestM (RequestTask TryCloseResult) := do
  let doc ← readDoc
  let fileMap : FileMap := doc.meta.text
  let cursorPos := fileMap.lspPosToUtf8Pos params.pos
  RequestM.bindWaitFindSnap doc (fun s => s.endPos >= cursorPos)
    (notFoundX := throw ⟨.invalidParams, s!"no snapshot found at {params.pos}"⟩)
    (x := fun snap => RequestM.pureTask do
      let real ← realPayloadFor doc fileMap snap
      let slotAt (p : Lsp.Position) :=
        real.deleteSlots.find? fun s =>
          s.start.line == p.line && s.start.character == p.character
      let some a := slotAt params.from
        | return { message := some "the run's first step has no extent" }
      let some b := slotAt params.to
        | return { message := some "the run's last step has no extent" }
      let s := (fileMap.lspPosToUtf8Pos a.start).byteIdx
      let t := (fileMap.lspPosToUtf8Pos b.stop).byteIdx
      if t < s then
        return { message := some "the run's extent runs backwards" }
      let key := (doc.meta.uri, doc.meta.version, s, t)
      if let some (k, cached) ← tryCloseCache.get then
        if k == key then return cached
      let declByte := declByteOf fileMap snap real
      let before ← rawStepsIn snap fileMap
      let src := fileMap.source
      let pre := String.Pos.Raw.extract src ⟨0⟩ ⟨s⟩
      let post := String.Pos.Raw.extract src ⟨t⟩ src.rawEndPos
      let cands := match params.tactics with
        | some c => if c.isEmpty then closingCandidates else c
        | none => closingCandidates
      let mut tried : Array String := #[]
      let mut times : Array Nat := #[]
      let mut lastMsg : Option String := none
      let nothing := s!"nothing closes it (tried {cands.size})"
      let mut out : TryCloseResult :=
        { before := before, verdict := "none", message := some nothing }
      for cand in cands do
        let t0 ← IO.monoMsNow
        let text := pre ++ cand ++ post
        let re? ← reElabDecl doc text declByte
        let dt := (← IO.monoMsNow) - t0
        tried := tried.push cand
        times := times.push dt
        match re? with
        | none => lastMsg := some "the spliced declaration did not parse"
        | some re =>
          let mut i := 0
          let mut firstErr : Option String := none
          for m in re.msgs do
            if m.severity == .error && firstErr.isNone then
              firstErr := some (← m.data.toString)
            i := i + 1
          match firstErr with
          | some e => lastMsg := some ((e.trim.splitOn "\n").headD e)
          | none =>
            out := { tactic := some cand, verdict := "benign", ok := true,
                     before := before, steps := ← rawStepsIn re.snap re.map,
                     tried := tried, ms := times }
            break
      if !out.ok then
        let msg := out.message.orElse fun _ => lastMsg
        out := { out with tried := tried, ms := times, message := msg }
      tryCloseCache.set (some (key, out))
      return out)

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

  /- Every optional field is an `Option`: the derived `FromJson` ignores
  defaults, so a plain field with one is still REQUIRED on the wire, and the
  widget's calls send only what their action uses (2026-09-22: `setting` and
  `values` added as plain fields failed every lens/highlight call). -/
  annotations : Option (Array GoalAnnotation) := none
  /-- `hoverbar` only: which list (`tactic`/`goal`) and the move ids, in order —
  a `⋯`-menu pin asking the companion to write `ramify.hoverBar.<setting>`. -/
  setting : Option String := none
  values : Option (Array String) := none
  deriving FromJson, ToJson

/-! ## The companion's request directory

`~/.proof-tree-companion/` is named HERE and nowhere else: the lens/reveal
channel (`popoutEdit`), the two model channels (C4's polish, D6's propose) and
every response read all go through these three. -/

/-- The companion's directory, without creating it — the read side, which must
not mint a directory just to find it empty. -/
private def companionHome : IO (Option System.FilePath) := do
  let some home ← IO.getEnv "HOME" | return none
  return some (System.FilePath.mk home / ".proof-tree-companion")

/-- The companion's directory, created if absent — the write side. -/
private def companionDir : IO System.FilePath := do
  let some dir ← companionHome | throw <| IO.userError "no HOME"
  IO.FS.createDirAll dir
  return dir

/-- Write one request file for the companion's `fs.watch` to pick up. -/
private def writeCompanionRequest (name : String) (payload : Json) : IO Unit := do
  let dir ← companionDir
  IO.FS.writeFile (dir / name) payload.compress

/-- Read a companion response file, or `none` where it is absent or unparseable
(the companion writes it whole, but a read can still land mid-write). -/
private def readCompanionFile (name : String) : IO (Option Json) := do
  let some dir ← companionHome | return none
  let file := dir / name
  unless ← file.pathExists do return none
  let txt ← IO.FS.readFile file
  match Json.parse txt with
  | .error _ => return none
  | .ok j => return some j

@[server_rpc_method]
def popoutEdit (params : PopoutEditParams) : RequestM (RequestTask String) := do
  RequestM.asTask do
    let nonce ← IO.monoNanosNow
    let payload := Json.mkObj [
      ("nonce", toJson nonce),
      ("uri", toJson params.uri),
      ("start", toJson params.start),
      ("stop", toJson params.stop),
      ("action", toJson params.action),
      ("annotations", toJson (params.annotations.getD #[])),
      ("setting", toJson (params.setting.getD "")),
      ("values", toJson (params.values.getD #[]))
    ]
    -- `rename` (the D1 extract's follow-up) gets a file of its own: it is
    -- written as the pointer leaves the accepted pill, so a hover `clear` or
    -- `preview-clear` landing in `popout-request.json` a moment later would
    -- overwrite it before the companion's watcher read it.
    -- `hoverbar` (a `⋯`-menu pin → `ramify.hoverBar.*`) likewise: the pin is
    -- clicked with the pointer on its way back to the tree, whose hover
    -- `highlight`/`clear` would overwrite a shared file first.
    let file :=
      if params.action == "rename" then "rename-request.json"
      else if params.action == "hoverbar" then "settings-request.json"
      else "popout-request.json"
    writeCompanionRequest file payload
    return "ok"

/-! ## C4 / D6 — the companion channel, in the direction the widget cannot go

The infoview's webview reaches no network; the companion extension does. So
the widget ASKS through the file idiom `popoutEdit` already established — the
server writes a request file into `~/.proof-tree-companion/`, the companion's
`fs.watch` picks it up — and then POLLS for the answer, because there is no
route from the extension back into a running RPC session.

Two channels, one shape each way:

* `polish-request.json` / `polish-response.json`   (C4, narration)
* `propose-request.json` / `propose-response.json` (D6, restructuring)

Every request carries an `id` the widget minted; a response is only ever read
as the answer to the id that is being waited on, so a stale file left by an
earlier session is simply pending forever rather than wrong. Nothing here
knows an API key exists — that stays in the extension's secret storage. -/

structure PolishLine where
  nodeId     : String
  template   : String
  goalBefore : String := ""
  goalAfter  : Option String := none
  tactic     : String := ""
  deriving ToJson

instance : FromJson PolishLine where
  fromJson? j :=
    .ok { nodeId := jsonField j "nodeId" "",
          template := jsonField j "template" "",
          goalBefore := jsonField j "goalBefore" "",
          goalAfter := jsonField j "goalAfter" (none : Option String),
          tactic := jsonField j "tactic" "" }

structure PolishRequestParams where
  id       : String
  proofKey : String := ""
  lines    : Array PolishLine := #[]
  deriving ToJson

instance : FromJson PolishRequestParams where
  fromJson? j :=
    .ok { id := jsonField j "id" "",
          proofKey := jsonField j "proofKey" "",
          lines := jsonField j "lines" #[] }

@[server_rpc_method]
def polishRequest (params : PolishRequestParams) : RequestM (RequestTask String) := do
  RequestM.asTask do
    writeCompanionRequest "polish-request.json" <| Json.mkObj [
      ("id", toJson params.id),
      ("proofKey", toJson params.proofKey),
      ("lines", toJson params.lines)
    ]
    return "ok"

structure PolishedLine where
  nodeId : String
  text   : String
  deriving ToJson

instance : FromJson PolishedLine where
  fromJson? j :=
    .ok { nodeId := jsonField j "nodeId" "", text := jsonField j "text" "" }

structure PolishResult where
  /-- `"ok"`, `"pending"` or `"error"`. -/
  status : String := "pending"
  lines  : Array PolishedLine := #[]
  note   : String := ""
  deriving ToJson

instance : FromJson PolishResult where
  fromJson? j :=
    .ok { status := jsonField j "status" "pending",
          lines := jsonField j "lines" #[],
          note := jsonField j "note" "" }

structure ResultParams where
  id : String
  deriving ToJson

instance : FromJson ResultParams where
  fromJson? j := .ok { id := jsonField j "id" "" }

@[server_rpc_method]
def polishResult (params : ResultParams) : RequestM (RequestTask PolishResult) := do
  RequestM.asTask do
    let some j ← readCompanionFile "polish-response.json" | return {}
    if jsonField j "id" "" != params.id then return {}
    let err := jsonField j "error" ""
    if err != "" then return { status := "error", note := err }
    return { status := "ok", lines := jsonField j "lines" #[] }

structure ProposePrimitive where
  nodeId : String
  kind   : String
  title  : String
  deriving ToJson

instance : FromJson ProposePrimitive where
  fromJson? j :=
    .ok { nodeId := jsonField j "nodeId" "",
          kind := jsonField j "kind" "",
          title := jsonField j "title" "" }

structure ProposeRequestParams where
  id         : String
  proofKey   : String := ""
  text       : String := ""
  primitives : Array ProposePrimitive := #[]
  deriving ToJson

instance : FromJson ProposeRequestParams where
  fromJson? j :=
    .ok { id := jsonField j "id" "",
          proofKey := jsonField j "proofKey" "",
          text := jsonField j "text" "",
          primitives := jsonField j "primitives" #[] }

@[server_rpc_method]
def proposeRequest (params : ProposeRequestParams) : RequestM (RequestTask String) := do
  RequestM.asTask do
    writeCompanionRequest "propose-request.json" <| Json.mkObj [
      ("id", toJson params.id),
      ("proofKey", toJson params.proofKey),
      ("text", toJson params.text),
      ("primitives", toJson params.primitives)
    ]
    return "ok"

structure ProposeResult where
  status : String := "pending"
  nodeId : String := ""
  kind   : String := ""
  reason : String := ""
  note   : String := ""
  deriving ToJson

instance : FromJson ProposeResult where
  fromJson? j :=
    .ok { status := jsonField j "status" "pending",
          nodeId := jsonField j "nodeId" "",
          kind := jsonField j "kind" "",
          reason := jsonField j "reason" "",
          note := jsonField j "note" "" }

@[server_rpc_method]
def proposeResult (params : ResultParams) : RequestM (RequestTask ProposeResult) := do
  RequestM.asTask do
    let some j ← readCompanionFile "propose-response.json" | return {}
    if jsonField j "id" "" != params.id then return {}
    let err := jsonField j "error" ""
    if err != "" then return { status := "error", note := err }
    return { status := "ok",
             nodeId := jsonField j "nodeId" "",
             kind := jsonField j "kind" "",
             reason := jsonField j "reason" "",
             note := jsonField j "note" "" }

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

/-- What the companion says about the two opt-in model channels. `ready` is the
whole answer to "can this be asked at all" — the extension is running, and an
API key is in its secret storage or the environment; `why` is what the disabled
row says instead. The key itself is never here and never anywhere else the
widget can see. -/
structure AiConfig where

  polish : Bool := false

  propose : Bool := false

  ready : Bool := false

  why : String := ""
  deriving ToJson

instance : FromJson AiConfig where
  fromJson? j :=
    .ok { polish := jsonField j "polish" false,
          propose := jsonField j "propose" false,
          ready := jsonField j "ready" false,
          why := jsonField j "why" "" }

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

  ai : AiConfig := {}
  /-- `ramify.experience`: `beginner`/`intermediate`/`expert`, or empty (the
  client's default). Passed through; the client owns the table. -/
  experience : String := ""
  /-- `ramify.hoverBar.{tactic,goal}` where the reader SET them (`inspect()`),
  else absent. Passed through; the client owns the move ids. -/
  hoverBar : Json := Json.null
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
          ai := jsonField j "ai" {},
          experience := jsonField j "experience" "",
          hoverBar := (j.getObjVal? "hoverBar").toOption.getD Json.null,
          colors := jsonField j "colors" #[] }

structure ThemeColorsParams where
  deriving FromJson, ToJson

@[server_rpc_method]
def themeColors (_ : ThemeColorsParams) : RequestM (RequestTask ThemeColors) := do
  RequestM.asTask do
    let some dir ← companionHome | return {}
    let file := dir / "theme-colors.json"

    unless ← file.pathExists do return {}
    let txt ← IO.FS.readFile file
    match Json.parse txt >>= fromJson? with
    | .error _ => return {}
    | .ok (c : ThemeColors) => return c

end ProofTree

@[widget_module]
def Ramify : ProofWidgets.Component ProofWidgets.PanelWidgetProps where
  javascript := include_str ".." / "web" / "dist" / "proofTreeWidget.js"
