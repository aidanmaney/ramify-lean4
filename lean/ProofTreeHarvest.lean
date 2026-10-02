import Lean
import Services.BetterParser
import ProofTreeComments
import ProofTreeRecover

/-!
# The widget-only harvests, shared by both wires

Diagnostics, the tight tactic edits (with their semantic tokens), the
declaration header and its signature cuts, the hover choice for a token, and the
tagged goals. They were born in `Ramify.lean`'s widget path; they live here so
that `Ramify.lean` (the RPC) and `Ppharness.lean` (the CLI, which cannot import
ProofWidgets) call the SAME function — one harvest, both wires.

What differs between the wires is only the last step for `WithRpcRef` data: the
widget hands the infoview a reference it resolves on hover, the CLI resolves it
NOW (`bakePopup`) into plain strings, so a static page can show the same popup
with no server. Nothing else is decided twice.
-/

open Lean Elab Meta Server

namespace ProofTree

structure TaggedGoalEntry where
  goalId : String
  goal   : Widget.InteractiveGoal
  deriving Server.RpcEncodable

structure DeclRange where
  start : Lsp.Position
  stop  : Lsp.Position
  deriving Server.RpcEncodable, ToJson

structure TreeDiag where

  range     : DeclRange

  fullRange : DeclRange

  severity  : Nat
  message   : String
  isSilent  : Bool := false

  leanTags  : Array Nat := #[]
  deriving Server.RpcEncodable, ToJson

/-- The wire's severity number: 1 error, 2 warning, 3 anything else. -/
def sevOf : Option Lsp.DiagnosticSeverity → Nat
  | some .error => 1
  | some .warning => 2
  | _ => 3

/-- A message's first line, trimmed. -/
def firstLine (t : String) : String := (t.trimAscii.toString.splitOn "\n").headD t

def diffedGoalsAfter (printCtx : Elab.ContextInfo) (ti : Elab.TacticInfo)
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
    let some rng := stx.getRange? | pure none
    let some doc ← findDocString? env kind | pure none
    return some (doc, rng)

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


/-- The printed type each goal id SHOULD have — the least-mvar'd print the
parser saw — which `collectTaggedGoals` prefers among a goal's candidates. -/
def wantedGoalTypes (allGoals : List Paperproof.Services.GoalInfo)
    (steps : List Paperproof.Services.ProofStep) : Std.HashMap String String := Id.run do
  let mut out : Std.HashMap String String := {}
  let offer (out : Std.HashMap String String) (g : Paperproof.Services.GoalInfo) :=
    let key := g.id.name.toString
    match out[key]? with
    | some cur =>
      if ProofTree.mvarOccurrences g.type < ProofTree.mvarOccurrences cur then
        out.insert key g.type
      else out
    | none => out.insert key g.type
  for g in allGoals do out := offer out g
  for st in steps do
    out := offer out st.goalBefore
    for g in st.goalsAfter ++ st.spawnedGoals do out := offer out g
  return out

/-- The tree's view of one interactive diagnostic. The widget gets these from
`doc.collectCurrentDiagnostics`; the CLI makes them from the elaboration's own
messages with `Widget.msgToInteractiveDiagnostic`, so both read one shape. -/
def treeDiagOf (d : Widget.InteractiveDiagnostic) : TreeDiag :=
  let full := d.fullRange?.getD d.range
  { range := ⟨d.range.start, d.range.end⟩
    fullRange := ⟨full.start, full.end⟩
    severity := sevOf d.severity?
    message := d.toDiagnostic.message
    isSilent := d.isSilent?.getD false
    leanTags := (d.leanTags?.getD #[]).map fun
      | .unsolvedGoals => 1 | .goalsAccomplished => 2 }

/-- What a token's hover shows, decided once: a parser docstring, or the
innermost eligible info node (by its byte range, the cache key). -/
inductive TokenHover where
  | doc  (text : String)
  | info (rs re : Nat) (ictx : Elab.InfoWithCtx)

/-- The hover CHOICE for one tactic/header token. The widget turns `.info` into
a `WithRpcRef` the infoview resolves lazily; the CLI bakes it (`bakePopup`). -/
def tokenHoverAt (env : Environment) (stx : Syntax) (hoverIdx : HoverIndex)
    (fileMap : FileMap) (t : TacticToken) : IO (Option TokenHover) := do
  let tb := fileMap.lspPosToUtf8Pos t.start
  let stxDoc? ← parserDocAt env stx tb
  match hoverIdx.innermost tb.byteIdx with
  | some (rs, re, ictx) =>
    let docWins ← match stxDoc? with
      | none => pure false
      | some (_, stxRange) =>
        if !stxRange.includes ⟨⟨rs⟩, ⟨re⟩⟩ then pure true
        else do pure !(← popupNonempty env ictx.info)
    if docWins then
      return stxDoc?.map fun (d, _) => .doc (FileWorker.Hover.rewriteExamples d)
    unless (← popupNonempty env ictx.info) do
      return none
    return some (.info rs re ictx)
  | none =>
    return stxDoc?.map fun (d, _) => .doc (FileWorker.Hover.rewriteExamples d)

/-- Everything the edit harvest produces for one declaration. `hoverTokens` is
every token that wants a hover, deduplicated by its byte range and in the order
the widget always resolved them (tactic tokens, then header tokens). -/
structure EditHarvest where
  tacticEdits      : Array TacticEdit := #[]
  hoverTokens      : Array TacticToken := #[]
  declHeader       : String := ""
  declHeaderTokens : Array TacticToken := #[]
  declHeaderStart    : Option Lsp.Position := none
  declHeaderNameStop : Option Lsp.Position := none
  declHeaderSigStop  : Option Lsp.Position := none
  declHeaderBodyStop : Option Lsp.Position := none

/-- The tight tactic edits (with their semantic tokens) and the declaration
header with its three signature cuts, for one declaration's command syntax
`stx` and info tree. `steps` are the harvested steps AFTER recovery. -/
def harvestEdits (env : Environment) (fileMap : FileMap) (stx : Syntax)
    (tree : InfoTree) (steps : List Paperproof.Services.ProofStep)
    (slots : Array TacticSlot) (calcChains : Array CalcChain) :
    IO EditHarvest := do
    let allTokens := semanticTokensFor fileMap stx tree

    let constStarts : Std.HashSet (Nat × Nat) :=
      (FileWorker.computeAbsoluteLspSemanticTokens fileMap ⟨0⟩ none
          (collectConstIdentTokens tree)).foldl (init := {}) fun acc t =>
        acc.insert (t.pos.line, t.pos.character)
    let wireTokenType (t : FileWorker.AbsoluteLspSemanticToken) : String :=
      if t.type matches .function
          && constStarts.contains (t.pos.line, t.pos.character) then
        "const"
      else
        Lsp.SemanticTokenType.names[t.type.toNat]!

    let src := fileMap.source
    let mut seen : Std.HashSet (Nat × Nat) := {}
    let mut tacticEdits : Array TacticEdit := #[]
    let mut hoverTokens : Array TacticToken := #[]
    let mut seenTok : Std.HashSet (Nat × Nat) := {}

    let tacticRanges := collectTacticRanges tree

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

    for s in steps do
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
        let labelTokens ← rwClosingRflLabel env ownSlice s.tacticString
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
        hoverTokens := hoverTokens.push t

    let declStart? : Option Lsp.Position :=
      let hdrStx := match stx with
        | .node _ k args =>
          if k == ``Lean.Parser.Command.declaration && args.size ≥ 2 then
            args[1]!
          else stx
        | _ => stx
      match hdrStx.getRange? with
      | some r => some (fileMap.utf8PosToLspPos r.start)
      | none   => none
    -- The signature split, by syntax KIND: the first `declSig`/`optDeclSig`
    -- in preorder (the declaration's own; a nested `by` holds none), then the
    -- `typeSpec` inside it.
    let sigNode? : Option Syntax :=
      (nodesOfKind [``Lean.Parser.Command.declSig,
          ``Lean.Parser.Command.optDeclSig] stx)[0]?
    let declHeaderNameStop? : Option Lsp.Position :=
      sigNode?.bind (·.getPos?) |>.map fileMap.utf8PosToLspPos
    let declHeaderSigStop? : Option Lsp.Position := Id.run do
      let some sig := sigNode? | return none
      let specs := nodesOfKind [``Lean.Parser.Term.typeSpec] sig
      if let some p := specs[0]? |>.bind (·.getPos?) then
        return some (fileMap.utf8PosToLspPos p)
      if let some p := sig.getTailPos? then
        return some (fileMap.utf8PosToLspPos p)
      let ids := nodesOfKind [``Lean.Parser.Command.declId] stx
      if let some p := ids[0]? |>.bind (·.getTailPos?) then
        return some (fileMap.utf8PosToLspPos p)
      -- `example := …`: nothing but the keyword, the head atom of the
      -- declaration's own node.
      let decls := nodesOfKind [``Lean.Parser.Command.example,
        ``Lean.Parser.Command.instance, ``Lean.Parser.Command.definition,
        ``Lean.Parser.Command.abbrev, ``Lean.Parser.Command.theorem] stx
      return decls[0]? |>.bind (·.getHead?) |>.bind (·.getTailPos?)
        |>.map fileMap.utf8PosToLspPos
    let declHeaderBodyStop? : Option Lsp.Position :=
      (nodesOfKind [``Lean.Parser.Command.declValSimple,
          ``Lean.Parser.Command.declValEqns,
          ``Lean.Parser.Command.whereStructInst] stx)[0]?
        |>.bind (·.getPos?) |>.map fileMap.utf8PosToLspPos
    let mut headerToks : Array TacticToken := #[]
    let mut declHeader : String := ""
    if let some dStart := declStart? then

      let byStop? : Option Lsp.Position :=

        match (nodesOfKind [``Lean.Parser.Term.byTactic] stx).foldl
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
        declHeader := (String.Pos.Raw.extract src hb he).trimAsciiEnd.toString
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
          hoverTokens := hoverTokens.push t
    return {
      tacticEdits, hoverTokens, declHeader
      declHeaderTokens := headerToks
      declHeaderStart := declStart?
      declHeaderNameStop := declHeaderNameStop?
      declHeaderSigStop := declHeaderSigStop?
      declHeaderBodyStop := declHeaderBodyStop? }

/-! ## Baking: `WithRpcRef` data resolved now, for a page with no server

The infoview resolves a `SubexprInfo`'s reference on hover by calling core's
`makePopup` (`Lean.Widget.InteractiveDiagnostics.infoToInteractive`). A static
page has no server to call, so the CLI runs the same three questions here, at
harvest time, and prints the answers to plain strings: the expression (as
`makePopup` prints it, explicit), its type, and its docstring. Popups are
INTERNED per declaration — a goal mentions the same `n : ℕ` many times — and
a baked tag carries the popup's index. -/

/-- One baked hover popup. Absent fields are omitted on the wire. -/
structure BakedPopup where
  expr : Option String := none
  type : Option String := none
  doc  : Option String := none
  deriving ToJson, BEq, Hashable

/-- The interning table, threaded through one declaration's bake. -/
structure BakeState where
  popups : Array BakedPopup := #[]
  index  : Std.HashMap BakedPopup Nat := {}

abbrev BakeM := StateT BakeState IO

/-- `makePopup`'s three answers, printed plain. -/
def bakePopup (i : Elab.InfoWithCtx) : IO BakedPopup :=
  tryCatch (i.ctx.runMetaM i.info.lctx do
      let type? ← match (← i.info.type?) with
        | some ty => some <$> (toString <$> ppExpr ty)
        | none => pure none
      let expr? ← match i.info with
        | .ofTermInfo ti =>
          some <$> (toString <$> withOptions (pp.explicit.set · true) (ppExpr ti.expr))
        | .ofFieldInfo fi => pure (some fi.fieldName.toString)
        | _ => pure none
      return ({ expr := expr?, type := type?, doc := ← i.info.docString? } : BakedPopup))
    (fun _ => pure ({} : BakedPopup))

/-- The index of `p` in the table, adding it if new. -/
def internPopup (p : BakedPopup) : BakeM Nat := do
  let st ← get
  if let some k := st.index[p]? then return k
  let k := st.popups.size
  set ({ popups := st.popups.push p, index := st.index.insert p k } : BakeState)
  return k

/-- A `CodeWithInfos` with every tag's reference baked: the same tagged-text
JSON the infoview receives, with `{"h": k, "diffStatus"?: …}` where the RPC
puts `{"info": <ref>, "subexprPos", "diffStatus"?}`. -/
partial def bakeCode : Widget.CodeWithInfos → BakeM Json
  | .text s => pure (Json.mkObj [("text", toJson s)])
  | .append ts => do
    let parts ← ts.mapM bakeCode
    pure (Json.mkObj [("append", Json.arr parts)])
  | .tag info t => do
    let k ← internPopup (← bakePopup info.info.val)
    let inner ← bakeCode t
    let tag := Json.mkObj ([("h", toJson k)] ++
      (match info.diffStatus? with
        | some d => [("diffStatus", toJson d)]
        | none => []))
    pure (Json.mkObj [("tag", Json.arr #[tag, inner])])

/-- One tagged goal, baked into the shape `taggedRender` reads
(`InteractiveGoal`'s RPC JSON with the references replaced). -/
def bakeGoal (e : TaggedGoalEntry) : BakeM Json := do
  let g := e.goal
  let hyps ← g.hyps.mapM fun h => do
    let mut fields : List (String × Json) :=
      [("names", toJson h.names),
       ("fvarIds", toJson (h.fvarIds.map (·.name.toString))),
       ("type", ← bakeCode h.type)]
    if let some v := h.val? then fields := fields ++ [("val", ← bakeCode v)]
    if let some b := h.isInserted? then fields := fields ++ [("isInserted", toJson b)]
    if let some b := h.isRemoved? then fields := fields ++ [("isRemoved", toJson b)]
    pure (Json.mkObj fields)
  let mut goal : List (String × Json) :=
    [("hyps", Json.arr hyps), ("type", ← bakeCode g.type),
     ("goalPrefix", toJson g.goalPrefix), ("mvarId", toJson g.mvarId.name.toString)]
  if let some u := g.userName? then goal := goal ++ [("userName", toJson u)]
  pure (Json.mkObj [("goalId", toJson e.goalId), ("goal", Json.mkObj goal)])

/-- One token's hover, baked: the widget's `TacticTokenInfo` shape, with a
one-tag `code` over the token's own text where the widget sends a reference. -/
def bakeTokenHover (fileMap : FileMap) (t : TacticToken) :
    TokenHover → BakeM Json
  | .doc d => pure (Json.mkObj [("start", toJson t.start), ("doc", toJson d)])
  | .info _ _ ictx => do
    let k ← internPopup (← bakePopup ictx)
    let tb := fileMap.lspPosToUtf8Pos t.start
    let te := fileMap.lspPosToUtf8Pos t.stop
    let text := String.Pos.Raw.extract fileMap.source tb te
    pure (Json.mkObj [("start", toJson t.start),
      ("code", Json.mkObj [("tag", Json.arr #[Json.mkObj [("h", toJson k)],
        Json.mkObj [("text", toJson text)]])])])

end ProofTree
