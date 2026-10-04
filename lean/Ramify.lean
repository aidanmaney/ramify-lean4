import Lean
import Services.BetterParser
import ProofTreeComments
import ProofTreeRecover
import ProofTreeHarvest
import ProofWidgets.Component.Basic
import ProofWidgets.Component.Panel.Basic

open Lean Elab Meta Server RequestM ProofWidgets

namespace ProofTree


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

def lastDotPos? (s : String) : Option String.Pos.Raw := Id.run do
  let mut p : String.Pos.Raw := ⟨0⟩
  let mut found : Option String.Pos.Raw := none
  while !String.Pos.Raw.atEnd s p do
    if String.Pos.Raw.get s p == '.' then found := some p
    p := String.Pos.Raw.next s p
  return found

def minCompletionQuery : Nat := 3

def maxCompletionNames : Nat := 50

/-- Stop scanning the environment after this many matches. A bound on the
match list that is collected and sorted, not a speed-up: measured on a
Mathlib environment (2026-09-28) the scan is ~800 ms warm however early it
stops (the cost is walking every constant), and a cap of 200 dropped the short
names (`mul` lost `Mul`, `Prime` lost `Nat.Prime`) where 5000 and 20000 return
exactly the full scan's 50 for `add_comm`, `Nat.succ`, `mul`, `Prime`, `le_of`. -/
def maxCompletionMatches : Nat := 5000

/-- One completable declaration, taken apart ONCE: the name and the LOWER-CASED
last component as bytes. `Char.toLower` is ASCII-only, so lower-casing both
sides is exactly the per-character test the scan used to do. -/
structure CompletionEntry where
  name : Name
  last : ByteArray

/-- The header half of the completion scan, precomputed: every eligible header
declaration (Lean's own `getEligibleHeaderDecls`, so the same rules) whose name
is a `.str` that is neither private nor an internal detail, in that map's own
iteration order — the order matters, because `maxCompletionMatches` truncates
by traversal — filed two ways, each list keeping that order:

* `byFirst`: by the first byte of the lower-cased last component (a query
  whose fragment is non-empty scans one of 256 lists, not all 437k), and
  `byTwo`: by its first two bytes (`mul` scans the `mu` list, not the `m` one —
  measured 75 ms against a dozen);
* `byParent`: by the lower-cased `Name.toString` of the PARENT (a namespace
  query, `Nat.` or `Nat.su`, scans that namespace alone).

There is no list for the one query shape neither can answer (no namespace and
an empty fragment): the RPC's own three-character floor makes it unreachable, so
`scanNames` answers it with nothing.

Why buckets and not a faster loop: the Ramify library is NOT precompiled, so the
worker INTERPRETS this file, and an interpreted per-entry test costs ~0.6 µs —
measured 2026-09-28: 270 ms a query over 437k entries with the tightest
byte-compare loop that could be written, against ~800 ms for the original walk
of Lean's `HashMap`. The work has to be not done, not done faster.

A file worker is one process per file and the header is fixed for its life, so a
single entry suffices; `key` (the header's constant count) is a guard, not the
identity. -/
structure CompletionIndex where
  key : Nat
  byFirst : Array (Array CompletionEntry)
  byTwo : Std.HashMap UInt16 (Array CompletionEntry)
  byParent : Std.HashMap String (Array CompletionEntry)

initialize completionIndex : IO.Ref (Option CompletionIndex) ← IO.mkRef none

/-- The pieces of a name completion may offer, else none. -/
def completableParts? (declName : Name) : Option (ByteArray × Name) :=
  match declName with
  | .str parent s =>
    if isPrivateName declName || declName.isInternalDetail then none
    else some (s.toLower.toUTF8, parent)
  | _ => none

/-- `e` appended to the list filed under `k`. -/
def addTo {α : Type} [BEq α] [Hashable α] (m : Std.HashMap α (Array CompletionEntry))
    (k : α) (e : CompletionEntry) : Std.HashMap α (Array CompletionEntry) :=
  m.alter k fun
    | some es => some (es.push e)
    | none => some #[e]

/-- Build the index from Lean's own eligible-header-declaration map, in one
pass. Cold cost on Mathlib (437k entries): Lean's map ~2.3 s (shared with the
editor's own completion, paid once per worker) plus this walk ~2–3 s,
interpreted. -/
def buildCompletionIndex : MetaM CompletionIndex := do
  let env ← getEnv
  let key := env.constants.map₁.size
  let mut byFirst : Array (Array CompletionEntry) := .replicate 256 #[]
  let mut byTwo : Std.HashMap UInt16 (Array CompletionEntry) := {}
  let mut byParent : Std.HashMap String (Array CompletionEntry) := {}
  -- parents repeat (one namespace, many entries): render each `Name` once.
  let mut rendered : Std.HashMap Name String := {}
  for (declName, _) in (← Server.Completion.getEligibleHeaderDecls env) do
    let some (last, parent) := completableParts? declName | continue
    let e : CompletionEntry := { name := declName, last }
    if 0 < last.size then
      byFirst := byFirst.modify (last.get! 0).toNat (·.push e)
    if 1 < last.size then
      byTwo := addTo byTwo ((last.get! 0).toUInt16 * (256 : UInt16) + (last.get! 1).toUInt16) e
    let ps ← match rendered[parent]? with
      | some ps => pure ps
      | none =>
        let ps := parent.toString.toLower
        rendered := rendered.insert parent ps
        pure ps
    byParent := addTo byParent ps e
  return { key, byFirst, byTwo, byParent }

/-- Set while a background build is in flight, so a query that arrives mid-build
waits for it rather than repeating five seconds of work. -/
initialize completionIndexBuilding : IO.Ref Bool ← IO.mkRef false

def getCompletionIndex : MetaM CompletionIndex := do
  let env ← getEnv
  let key := env.constants.map₁.size
  let cached : IO (Option CompletionIndex) := do
    if let some ix ← completionIndex.get then
      if ix.key == key then return some ix
    return none
  if let some ix ← cached then return ix
  -- a background build is under way: wait for it (bounded), don't repeat it.
  let mut waited := 0
  while (← completionIndexBuilding.get) && waited < 60000 do
    IO.sleep 25
    waited := waited + 25
    if let some ix ← cached then return ix
  let ix ← buildCompletionIndex
  completionIndex.set (some ix)
  return ix

/-- Start building the index off the request path, once. Called where a payload
is built (the file's header is elaborated by then), so the reader's first
completion finds it ready instead of paying for it. Nothing waits on the task:
failure leaves the flag down and the first query builds for itself. -/
def prewarmCompletionIndex (ctx : Elab.ContextInfo) : IO Unit := do
  if (← completionIndex.get).isSome then return
  let started ← completionIndexBuilding.modifyGet fun b => (!b, true)
  unless started do return
  let _ ← IO.asTask (prio := .dedicated) do
    try
      let ix ← ctx.runMetaM .empty buildCompletionIndex
      completionIndex.set (some ix)
    catch _ => pure ()
    completionIndexBuilding.set false

/-- `pre` is a byte prefix of `s`. -/
def bytePrefix (pre s : ByteArray) : Bool :=
  pre.size ≤ s.size && go 0
where
  go (i : Nat) : Bool :=
    if i < pre.size then pre.get! i == s.get! i && go (i + 1) else true
  termination_by pre.size - i

/-- The scan proper, pure: a header list (already narrowed by the caller) then
`locals` (the file's own declarations, few, taken apart on the fly), stopping at
`maxCompletionMatches` exactly as the old traversal did. `lcNs?` is only
consulted for locals — the header list is already that namespace's. -/
def scanEntries (lcNs? : Option String) (frag : String)
    (entries : Array CompletionEntry) (locals : Array Name) : Array String := Id.run do
  let lcFrag := frag.toLower.toUTF8
  let mut acc : Array String := #[]
  for e in entries do
    if bytePrefix lcFrag e.last then
      acc := acc.push e.name.toString
      if acc.size ≥ maxCompletionMatches then return acc
  for declName in locals do
    if let some (last, parent) := completableParts? declName then
      if bytePrefix lcFrag last then
        if let some ns := lcNs? then
          unless parent.toString.toLower == ns do continue
        acc := acc.push declName.toString
        if acc.size ≥ maxCompletionMatches then return acc
  return acc

def scanNames (query : String) : MetaM (Array String) := do
  let (nsQuery?, frag) :=
    match lastDotPos? query with
    | some p =>
      (some (String.Pos.Raw.extract query ⟨0⟩ p),
       String.Pos.Raw.extract query (String.Pos.Raw.next query p) query.rawEndPos)
    | none => (none, query)
  let ix ← getCompletionIndex
  -- `map₂` are exactly the local declarations (Lean's `forEligibleDeclsM`).
  let env ← getEnv
  let locals ← IO.mkRef (#[] : Array Name)
  env.constants.map₂.forM fun name _ => do
    if Lean.Meta.allowCompletion env name then locals.modify (·.push name)
  let lcNs? := nsQuery?.map String.toLower
  -- The header entries this query can match, in traversal order.
  let header : Array CompletionEntry :=
    match lcNs? with
    | some ns => (ix.byParent[ns]?).getD #[]
    | none =>
      let fb := frag.toLower.toUTF8
      if 1 < fb.size then
        (ix.byTwo[fb[0]!.toUInt16 * (256 : UInt16) + fb[1]!.toUInt16]?).getD #[]
      else match fb[0]? with
        | some b => ix.byFirst[b.toNat]!
        | none => #[]
  let names := scanEntries lcNs? frag header (← locals.get)
  -- shortest first, ties alphabetical; `String.length` is O(n), so each is
  -- measured once rather than at every comparison.
  let keyed := names.map fun n => (n.length, n)
  let keyed := keyed.qsort fun (la, a) (lb, b) => la < lb || (la == lb && a < b)
  return (keyed.map (·.2)).take maxCompletionNames

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

-- Keyed on the document version, the declaration's start and a HASH of the
-- diagnostics (range, severity, message text) — not their count, which a
-- message that changed under the same count would leave stale.
initialize proofTreeCache :

    IO.Ref (Option ((String × Nat × Nat × UInt64) × ProofTreeData)) ← IO.mkRef none

/-- The message's own text nodes; an embedded expression or goal is not
walked (a change there is a change in the source, hence in the version). -/
private partial def messageHash : Widget.TaggedText Widget.MsgEmbed → UInt64
  | .text s => hash s
  | .append ts => ts.foldl (fun h t => mixHash h (messageHash t)) 0
  | .tag _ t => messageHash t

private def diagnosticsHash (ds : Array Widget.InteractiveDiagnostic) : UInt64 :=
  ds.foldl (init := hash ds.size) fun h d =>
    mixHash h <| mixHash (hash (d.range.start.line, d.range.start.character,
        d.range.end.line, d.range.end.character, sevOf d.severity?)) (messageHash d.message)

/-- One token's hover on the RPC wire: the shared choice (`tokenHoverAt`),
with an `.info` answer wrapped in a reference the infoview resolves on hover —
one per byte range, so a token seen twice shares its reference. -/
private def tokenInfoAt (env : Environment) (stx : Syntax) (hoverIdx : HoverIndex)
    (src : String) (fileMap : FileMap)
    (refCache : Std.HashMap (Nat × Nat) (Server.WithRpcRef Elab.InfoWithCtx))
    (t : TacticToken) :
    RequestM (Option TacticTokenInfo ×
      Std.HashMap (Nat × Nat) (Server.WithRpcRef Elab.InfoWithCtx)) := do
  match ← tokenHoverAt env stx hoverIdx fileMap t with
  | none => return (none, refCache)
  | some (.doc d) => return (some { start := t.start, doc := some d }, refCache)
  | some (.info rs re ictx) =>
    let (ref, refCache) ← match refCache[(rs, re)]? with
      | some r => pure (r, refCache)
      | none   => do
        let r ← Server.WithRpcRef.mk ictx
        pure (r, refCache.insert (rs, re) r)
    let tb := fileMap.lspPosToUtf8Pos t.start
    let tend := fileMap.lspPosToUtf8Pos t.stop
    return (some {
      start := t.start
      code  := some <| .tag
        { info := ref, subexprPos := SubExpr.Pos.root }
        (.text (String.Pos.Raw.extract src tb tend)) }, refCache)

def mkTreePayload (snap : Snapshots.Snapshot) (fileMap : FileMap)
    (parsed : Paperproof.Services.Result)
    (errorPositions : Array Lsp.Position) (treeDiags : Array TreeDiag) :
    RequestM ProofTreeData := do

    let snapStart := (snap.stx.getRange?.map (·.start.byteIdx)).getD 0

    let parsed := Recover.closeHiddenFinishers fileMap snap.infoTree parsed
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

    let wanted := wantedGoalTypes parsedTree.allGoals.toList parsedTree.steps
    let taggedGoals ← collectTaggedGoals snap.infoTree wanted

    let comments := match snap.stx.getRange? with
      | some range => commentsInRange fileMap.source fileMap range
      | none => #[]

    let src := fileMap.source
    -- The edits, their tokens and the header: the ONE harvest the CLI also
    -- calls (ProofTreeHarvest.lean). Only the hover resolution is the wire's.
    let ed ← harvestEdits snap.env fileMap snap.stx snap.infoTree
      parsedTree.steps slots calcChains
    let hoverIdx := mkHoverIndex snap.infoTree
    let mut tokenInfos : Array TacticTokenInfo := #[]
    let mut refCache : Std.HashMap (Nat × Nat) (Server.WithRpcRef Elab.InfoWithCtx) := {}
    for t in ed.hoverTokens do
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
      | some (ctx, _) =>
        prewarmCompletionIndex ctx
        tacticNames ctx
      | none => pure #[]
    return {
      proofId,
      tacticNames,
      declRange := snap.stx.getRange?.map fun r =>
        ⟨fileMap.utf8PosToLspPos r.start, fileMap.utf8PosToLspPos r.stop⟩,
      declHeader := ed.declHeader, declHeaderTokens := ed.declHeaderTokens,
      declHeaderStart := ed.declHeaderStart,
      declHeaderNameStop := ed.declHeaderNameStop,
      declHeaderSigStop := ed.declHeaderSigStop,
      declHeaderBodyStop := ed.declHeaderBodyStop,
      diagnostics := treeDiags,
      steps       := parsedTree.steps,
      allGoals    := parsedTree.allGoals.toList,
      taggedGoals,
      comments,
      tacticEdits := ed.tacticEdits,
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

/-- The live counterfactual's cancel token.  A pending elaboration is
abandoned by the CLIENT after 20 s but the task keeps running; a new cf sets
this token first, so at most one elaboration is ever burning CPU (the cache
above is one slot for the same reason). -/
initialize cfCancel : IO.Ref (Option IO.CancelToken) ← IO.mkRef none

private def cfExitSettleMs : Nat := 750

initialize cfServeCache :
    IO.Ref (Option (Nat × Nat × Nat × UInt64 × ProofTreeData)) ←
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
    (opts : Options → Options := id)
    -- The counterfactual's abandon switch: elaboration polls it (heartbeat
    -- checks) and stops, so a superseded cf does not keep running.
    (cancelTk? : Option IO.CancelToken := none) :
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
    cmdPos := prev.mpState.pos, snap? := none, cancelTk? }
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
    (cfText : String) (stubByte : Nat) (cancelTk : IO.CancelToken) :
    RequestM (Option ProofTreeData) := do
  let fileMap := doc.meta.text
  let lineStart := fileMap.lspPosToUtf8Pos ⟨pos.line, 0⟩
  let some re ← reElabDecl doc cfText lineStart.byteIdx (cancelTk? := some cancelTk)
    | return none
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
    let sev := sevOf (match m.severity with
      | .error => some .error | .warning => some .warning | .information => none)
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
  -- The serve cache is keyed on the document VERSION (as `proofTreeCache` is):
  -- the same version is the same text. Across versions the spliced text is the
  -- test, and it is built once, only where something needs it.
  let ver := doc.meta.version
  let cached ← cfServeCache.get
  let near : Bool := match cached with
    | some (_, _, ln, _, _) => ln == pos.line && !stepStartsHere
    | none => false
  if let some (cv, seen, _, _, blob) := cached then
    if near && cv == ver then
      let now ← IO.monoMsNow
      if now - seen ≥ cfExitSettleMs && payloadHealthy real pos then
        cfServeCache.set none
        return real
      return withDraft blob draft splice.draftCol
  let wanted := cfWanted real pos stepStartsHere
  unless near || wanted do return ← serveReal real
  let cfText := splice.text ()
  let cfKey : UInt64 := hash cfText
  let now ← IO.monoMsNow
  if let some (_, _, ln, ck, blob) := cached then
    if near && ck == cfKey then
      cfServeCache.set (some (ver, now, ln, ck, blob))
      return withDraft blob draft splice.draftCol
  unless wanted do return ← serveReal real

  if let some (k, entry) ← cfElabCache.get then
    if k == cfKey then
      match entry with
      | .done (some blob) =>
        cfServeCache.set (some (ver, now, pos.line, cfKey, blob))
        return withDraft blob draft splice.draftCol
      | .done none => return ← serveReal real
      | .pending t0 =>

        if now - t0 < 20000 then
          return { real with cfPending := true }
  cfElabCache.set (some (cfKey, .pending now))
  -- One cf at a time: stop the superseded elaboration (an abandoned 20 s one
  -- included) before starting this one.
  if let some old ← cfCancel.get then old.set
  let tk ← IO.CancelToken.new
  cfCancel.set (some tk)
  let rc ← read
  let _ ← IO.asTask (prio := .default) do
    let res ← match ← ((computeCf doc pos splice.draftCol cfText splice.stubByte tk).run rc).toBaseIO with
      | .ok res => pure res
      | .error _ => pure none

    -- A cancelled run's answer is an interrupted elaboration, and its key is
    -- no longer the cache's: write nothing.
    if ← tk.isSet then return
    cfElabCache.set (some (cfKey, .done res))
    if let some blob := res then

      cfServeCache.set (some (ver, ← IO.monoMsNow, pos.line, cfKey, blob))
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
    let cacheKey := (doc.meta.uri, doc.meta.version, snapStart, diagnosticsHash interactiveDiags)

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
        let treeDiags : Array TreeDiag := interactiveDiags.map treeDiagOf
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
      -- An empty or not-yet-elaborated file has no snapshot at the cursor: that
      -- is "no proof here", the same payload a position outside any
      -- declaration gets, not an error the infoview would print.
      (notFoundX := RequestM.pureTask (pure { steps := [], allGoals := [] }))
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
      -- An edit that starts before the declaration cannot be the client's
      -- own (every edit is computed from a tactic range inside it), and
      -- splicing it in would re-elaborate a different declaration's text.
      -- `semantic`, not `structural`: the rewrite parsed nothing at all, and
      -- `structural` promises "it does not parse"; the pill shows the message.
      if params.edits.any fun e => (fileMap.lspPosToUtf8Pos e.start).byteIdx < declByte then
        return ({ verdict := "semantic", before
                  message := some "edit outside the declaration" } : CheckRewriteResult)
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
        return { verdict := if isParse then "structural" else "semantic"
                 before, message := some (firstLine t) }
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

/-- Per-candidate heartbeat budget for `tryClose` (thousands, as
`maxHeartbeats` counts them). `aesop`/`grind` on a run they cannot close would
otherwise search until the option the FILE sets (possibly `0`, unlimited) ends
it; a candidate that needs more than this is not a one-click answer anyway. A
file's own smaller limit stands. -/
def tryCloseHeartbeats : Nat := 200000

def withCandidateBudget (o : Options) : Options :=
  let cur := maxHeartbeats.get o
  if cur == 0 || tryCloseHeartbeats < cur then maxHeartbeats.set o tryCloseHeartbeats
  else o

/-- Keyed on the document, the run's extent AND the candidate list the answer
was computed for: a call with its own `tactics` is not answered from the
default list's result. -/
initialize tryCloseCache :
    IO.Ref (Option ((String × Nat × Nat × Nat × Array String) × TryCloseResult)) ←
  IO.mkRef none

/-- The newest `tryClose`'s cancel token, as `cfCancel` is the newest
counterfactual's: a click is abandoned when another replaces it, and the older
one's remaining candidates (up to nine re-elaborations) must not keep burning
CPU. The RPC's own cancellation (the client's `$/cancelRequest`, or an edit) is
polled beside it between candidates. -/
initialize tryCloseCancel : IO.Ref (Option IO.CancelToken) ← IO.mkRef none

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
      let cands := match params.tactics with
        | some c => if c.isEmpty then closingCandidates else c
        | none => closingCandidates
      let key := (doc.meta.uri, doc.meta.version, s, t, cands)
      if let some (k, cached) ← tryCloseCache.get then
        if k == key then return cached
      if let some old ← tryCloseCancel.get then old.set
      let tk ← IO.CancelToken.new
      tryCloseCancel.set (some tk)
      let rc ← read
      let cancelled : BaseIO Bool := do
        return (← tk.isSet) || (← rc.cancelTk.wasCancelled)
      let declByte := declByteOf fileMap snap real
      let before ← rawStepsIn snap fileMap
      let src := fileMap.source
      let pre := String.Pos.Raw.extract src ⟨0⟩ ⟨s⟩
      let post := String.Pos.Raw.extract src ⟨t⟩ src.rawEndPos
      let mut tried : Array String := #[]
      let mut times : Array Nat := #[]
      let mut lastMsg : Option String := none
      let nothing := s!"nothing closes it (tried {cands.size})"
      let mut out : TryCloseResult :=
        { before := before, verdict := "none", message := some nothing }
      for cand in cands do
        -- Abandoned (superseded, or the request was cancelled): stop, and
        -- leave nothing in the cache — an interrupted candidate is not an
        -- answer about the text.
        if ← cancelled then return { before := before, message := some "cancelled" }
        let t0 ← IO.monoMsNow
        let text := pre ++ cand ++ post
        let re? ← reElabDecl doc text declByte (opts := withCandidateBudget)
          (cancelTk? := some tk)
        if ← cancelled then return { before := before, message := some "cancelled" }
        let dt := (← IO.monoMsNow) - t0
        tried := tried.push cand
        times := times.push dt
        match re? with
        | none => lastMsg := some "the spliced declaration did not parse"
        | some re =>
          let mut firstErr : Option String := none
          for m in re.msgs do
            if m.severity == .error && firstErr.isNone then
              firstErr := some (← m.data.toString)
          match firstErr with
          | some e => lastMsg := some (firstLine e)
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
  -- `HOME` on POSIX, `USERPROFILE` on Windows (the extension's `os.homedir()`).
  let home? ← do
    match ← IO.getEnv "HOME" with
    | some h => if h.isEmpty then IO.getEnv "USERPROFILE" else pure (some h)
    | none => IO.getEnv "USERPROFILE"
  let some home := home? | return none
  if home.isEmpty then return none
  return some (System.FilePath.mk home / ".proof-tree-companion")

/-- The companion's directory, created if absent — the write side. -/
private def companionDir : IO System.FilePath := do
  let some dir ← companionHome
    | throw <| IO.userError "neither HOME nor USERPROFILE is set"
  IO.FS.createDirAll dir
  return dir

/-- Write one request file for the companion's `fs.watch` to pick up. The
write is ATOMIC — a UNIQUE sibling `<name>.<nanos>.tmp` (concurrent `popoutEdit`
tasks must not share a temp name, or one tears the other's file or loses it to
ENOENT), then a rename onto the target — so the watcher, which fires on the
first byte, never reads a half-written file (the extension dispatches only on
the request names, so a `.tmp` event is inert). A failed write or rename removes
the temp file best-effort and rethrows. -/
private def writeCompanionRequest (name : String) (payload : Json) : IO Unit := do
  let dir ← companionDir
  let tmp := dir / s!"{name}.{← IO.monoNanosNow}.tmp"
  try
    IO.FS.writeFile tmp payload.compress
    IO.FS.rename tmp (dir / name)
  catch e =>
    let _ ← (IO.FS.removeFile tmp).toBaseIO
    throw e

/-- `writeCompanionRequest` for an RPC: an IO failure (no home, a read-only
directory, a full disk) is reported as a request error naming the file and the
cause, which the widget's relay/ask paths already surface, rather than as a raw
IO error. -/
private def sendCompanionRequest (name : String) (payload : Json) : RequestM Unit := do
  match ← (writeCompanionRequest name payload).toBaseIO with
  | .ok _ => pure ()
  | .error e =>
    throw ⟨.internalError, s!"could not write the extension request {name}: {e}"⟩

/-- Read a companion response file, or `none` where it is absent or unparseable
(the companion writes it whole, but a read can still land mid-write). -/
private def readCompanionFile (name : String) : IO (Option Json) := do
  let some dir ← companionHome | return none
  let file := dir / name
  unless ← file.pathExists do return none
  -- a file that vanished or is unreadable between the check and the read is
  -- "no answer yet", like one that is absent
  let .ok txt ← (IO.FS.readFile file).toBaseIO | return none
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
    sendCompanionRequest file payload
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
    sendCompanionRequest "polish-request.json" <| Json.mkObj [
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
    sendCompanionRequest "propose-request.json" <| Json.mkObj [
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
  /-- `ramify.appearance`: `vscode`/`classic`, absent where the file predates
  it. Passed through; the client owns the skins. An `Option` (a new optional
  wire field). -/
  appearance : Option String := none
  /-- `ramify.hoverBar.{tactic,goal}` where the reader SET them (`inspect()`),
  else absent. Passed through; the client owns the move ids. -/
  hoverBar : Json := Json.null
  /-- `{version, pid, at}` stamped by a LIVE companion on every publish; absent
  where the file is left over from an extension that is gone (or predates the
  stamp). The client's only answer to "is there a companion". Passed through. -/
  companion : Json := Json.null
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
          appearance := (j.getObjVal? "appearance").toOption.bind
            fun v => (fromJson? v : Except String String).toOption,
          hoverBar := (j.getObjVal? "hoverBar").toOption.getD Json.null,
          companion := (j.getObjVal? "companion").toOption.getD Json.null,
          colors := jsonField j "colors" #[] }

structure ThemeColorsParams where
  /-- The document the widget is showing. Where given, the file's `byFolder`
  entry for the workspace folder that contains it (the longest matching
  folder) is merged over the top-level values (every key it holds replaces the
  top-level one), so one window's workspace settings do not leak into
  another's. Absent: the top-level values,
  as before. An `Option`, so a caller that omits it still decodes. -/
  uri : Option String := none
  deriving FromJson, ToJson

/-- A path as the extension writes a folder key: forward slashes, no leading
slash before a Windows drive letter. -/
private def normFolderPath (p : String) : String :=
  let p := p.replace "\\" "/"
  match p.toList with
  | '/' :: c :: ':' :: rest => if c.isAlpha then String.ofList (c :: ':' :: rest) else p
  | _ => p

/-- The `byFolder` entry whose key is the longest folder prefix of the
document's path, or `none`. -/
private def folderEntry? (byFolder : Json) (uri : String) : Option Json :=
  match System.Uri.fileUriToPath? uri, byFolder with
  | some path, .obj kvs =>
    let doc := normFolderPath path.toString
    let hits := kvs.toArray.filter fun ⟨k, _⟩ =>
      let k := normFolderPath k
      doc == k || doc.startsWith (if k.endsWith "/" then k else k ++ "/")
    let best := hits.foldl (init := (none : Option (String × Json))) fun acc ⟨k, v⟩ =>
      match acc with
      | some (bk, _) => if k.length > bk.length then some (k, v) else acc
      | none => some (k, v)
    best.map (·.2)
  | _, _ => none

@[server_rpc_method]
def themeColors (params : ThemeColorsParams) : RequestM (RequestTask ThemeColors) := do
  RequestM.asTask do
    let some dir ← companionHome | return {}
    let file := dir / "theme-colors.json"

    unless ← file.pathExists do return {}
    let .ok txt ← (IO.FS.readFile file).toBaseIO | return {}
    let .ok j := Json.parse txt | return {}
    -- Per-folder settings (the extension writes `byFolder`, keyed by the
    -- workspace folder's path, each entry holding the same setting keys as the
    -- top level): the entry for the document's folder is laid over the top
    -- level before it is decoded, so every setting it carries wins.
    let j := match params.uri.bind (folderEntry? ((j.getObjVal? "byFolder").toOption.getD .null)) with
      | some entry => j.mergeObj entry
      | none => j
    match fromJson? j with
    | .error _ => return {}
    | .ok (c : ThemeColors) => return c

end ProofTree

@[widget_module]
def Ramify : ProofWidgets.Component ProofWidgets.PanelWidgetProps where
  javascript := include_str ".." / "web" / "dist" / "proofTreeWidget.js"
