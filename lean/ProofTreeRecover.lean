import Lean
import Services.BetterParser
import ProofTreeComments

open Lean Elab Paperproof.Services

namespace ProofTree.Recover

structure RecoveredStep where
  start : Lsp.Position

  kind : String
  deriving ToJson, FromJson, Inhabited

structure Recovery where
  steps     : List ProofStep := []

  goals     : List GoalInfo := []

  grafts    : List (Lsp.Position × GoalInfo) := []
  recovered : Array RecoveredStep := #[]

def Recovery.isEmpty (r : Recovery) : Bool := r.steps.isEmpty

def Recovery.apply (rc : Recovery) (r : Result) : Result :=
  let steps := r.steps.map fun s =>

    match rc.grafts.filterMap
        (fun (p, g) => if p == s.position.start then some g else none) with
    | [] => s
    | gs => { s with spawnedGoals := s.spawnedGoals ++ gs }
  { steps := steps ++ rc.steps
    allGoals := rc.goals.foldl (·.insert ·) r.allGoals }

def syntheticGoalId (p : Lsp.Position) : MVarId :=
  ⟨Name.mkSimple s!"goal_{p.line}_{p.character}"⟩

private def posLE (a b : Lsp.Position) : Bool := (compare a b).isLE

private def containsPos (start stop p : Lsp.Position) : Bool :=
  posLE start p && !posLE stop p

private structure RawGoal where
  mvarId : MVarId
  ctx    : ContextInfo
  ti     : TacticInfo
  anchor : Lsp.Position

private def rawGoals (fileMap : FileMap) (tree : InfoTree) : Array RawGoal := Id.run do
  let collected := tree.foldInfo (init := (#[] : Array (ContextInfo × TacticInfo)))
    fun ctx info acc => match info with
      | .ofTacticInfo ti => acc.push (ctx, ti)
      | _ => acc
  let mut seen : Std.HashSet Name := {}
  let mut out : Array RawGoal := #[]
  for (ctx, ti) in collected do
    let anchor := match ti.stx.getRange? with
      | some rg => fileMap.utf8PosToLspPos rg.start
      | none => ⟨0, 0⟩
    for g in ti.goalsBefore ++ ti.goalsAfter do
      unless seen.contains g.name do
        seen := seen.insert g.name
        out := out.push { mvarId := g, ctx, ti, anchor }
  return out

def recoverFailed (fileMap : FileMap) (tree : InfoTree)
    (steps : List ProofStep) (slots : Array TacticSlot)
    (calcChains : Array CalcChain) (errorPositions : Array Lsp.Position) :
    IO Recovery := do
  let src := fileMap.source

  let uncovered := slots.filter fun sl =>
    !steps.any fun st => containsPos sl.start sl.stop st.position.start
  let outer := uncovered.filter fun sl =>
    !uncovered.any fun o =>
      (o.start != sl.start || o.stop != sl.stop) &&
      posLE o.start sl.start && posLE sl.stop o.stop

  let outer := outer.filter fun sl =>
    !calcChains.any fun c => c.broken && c.tacticStart == sl.start
  if outer.isEmpty then return {}

  let consumed : Std.HashSet String :=
    steps.foldl (fun a s => a.insert s.goalBefore.id.name.toString) {}
  let mut pending : Array (Lsp.Position × GoalInfo) := #[]
  for st in steps do
    for g in st.goalsAfter ++ st.spawnedGoals do
      unless consumed.contains g.id.name.toString do
        pending := pending.push (st.position.start, g)

  let producedOrConsumed : Std.HashSet String := steps.foldl
    (fun a s =>
      let a := a.insert s.goalBefore.id.name.toString
      (s.goalsAfter ++ s.spawnedGoals).foldl
        (fun a g => a.insert g.id.name.toString) a)
    {}
  let invisible := (rawGoals fileMap tree).filter fun rg =>
    !producedOrConsumed.contains rg.mvarId.name.toString

  let mut out : Recovery := {}
  let mut claimed : Std.HashSet String := {}
  let blocks := outer.foldl (init := (#[] : Array (Lsp.Position × Array TacticSlot)))
    fun acc sl =>
      match acc.findIdx? (fun (b, _) => b == sl.blockStart) with
      | some i => acc.set! i (acc[i]!.1, acc[i]!.2.push sl)
      | none => acc.push (sl.blockStart, #[sl])
  for (_, blockSlots) in blocks do
    let sorted := blockSlots.qsort (fun a b => a.index < b.index)
    let some failIdx := sorted.findIdx?
      (fun sl => errorPositions.any fun p => containsPos sl.start sl.stop p)
      | continue
    let run := sorted.extract failIdx sorted.size
    let head := run[0]!

    let pendingHit := pending.foldl (init := (none : Option (Lsp.Position × GoalInfo)))
      fun best (p, g) =>
        if claimed.contains g.id.name.toString then best
        else if !posLE p head.start then best
        else match best with
          | some (bp, _) => if posLE bp p then some (p, g) else best
          | none => some (p, g)
    let goalBefore? ← do
      match pendingHit with
      | some (_, g) => pure (some g)
      | none =>
        let hit := invisible.foldl (init := (none : Option RawGoal))
          fun best rg =>
            if claimed.contains rg.mvarId.name.toString then best
            else if rg.anchor.line > head.start.line then best
            else match best with
              | some b => if b.anchor.line <= rg.anchor.line then some rg else best
              | none => some rg
        match hit with
        | none => pure none
        | some rg =>
          let printCtx := { rg.ctx with mctx := rg.ti.mctxAfter }
          try
            let gi ← printCtx.runMetaM {} do printGoalInfo printCtx rg.mvarId

            let containerSlot := slots.foldl (init := (none : Option TacticSlot))
              fun best sl =>
                if containsPos sl.start sl.stop head.start &&
                   !(sl.start == head.start && sl.stop == head.stop) &&
                   steps.any (fun st => containsPos sl.start sl.stop st.position.start)
                then
                  match best with
                  | some b => if posLE b.start sl.start then some sl else best
                  | none => some sl
                else best
            let container := containerSlot.bind fun sl =>
              steps.find? fun st => containsPos sl.start sl.stop st.position.start
            if let some c := container then
              out := { out with grafts := (c.position.start, gi) :: out.grafts }
            out := { out with goals := gi :: out.goals }
            pure (some gi)
          catch _ => pure none
    let some goalHead := goalBefore? | continue
    claimed := claimed.insert goalHead.id.name.toString

    let mut goalBefore := goalHead
    for i in [0:run.size] do
      let sl := run[i]!
      let b := fileMap.lspPosToUtf8Pos sl.start
      let e := fileMap.lspPosToUtf8Pos sl.stop
      let ghost? :=
        if i + 1 < run.size then
          let nxt := run[i + 1]!
          some { goalBefore with id := syntheticGoalId nxt.start }
        else none
      out := { out with
        steps := out.steps ++ [{
          tacticString := String.Pos.Raw.extract src b e
          goalBefore
          goalsAfter := match ghost? with
            | some g => [g] | none => []
          tacticDependsOn := []
          spawnedGoals := []
          position := { start := sl.start, stop := sl.stop }
          theorems := [] }]
        goals := match ghost? with
          | some g => g :: out.goals | none => out.goals
        recovered := out.recovered.push
          { start := sl.start, kind := if i == 0 then "failed" else "skipped" } }
      if let some g := ghost? then goalBefore := g
  return out

def commandStx? (tree : InfoTree) : Option Syntax :=
  tree.foldInfo (init := none) fun _ info acc =>
    match acc, info with
    | none, .ofCommandInfo ci => some ci.stx
    | acc, _ => acc

private def isTheoremLike (cmdStx : Syntax) : Bool :=
  !(nodesOfKind [``Parser.Command.theorem, ``Parser.Command.example] cmdStx).isEmpty

private def declBody? (cmdStx : Syntax) : Option Syntax := do
  let dv := (nodesOfKind [``Parser.Command.declValSimple] cmdStx)[0]?
  match dv with
  | some n => if n.getNumArgs ≥ 2 then some n[1] else none
  | none => none

private def byteRange? (stx : Syntax) : Option (Nat × Nat) :=
  stx.getRange? |>.map fun r => (r.start.byteIdx, r.stop.byteIdx)

private structure TermWalk where
  fileMap     : FileMap
  infos       : Array (ContextInfo × TermInfo)
  tacticInfos : Array (ContextInfo × TacticInfo)
  steps       : List ProofStep

private def findInfo (w : TermWalk) (stx : Syntax) :
    Option (ContextInfo × TermInfo) :=
  match byteRange? stx with
  | none => none
  | some (b, e) => w.infos.find? fun (_, ti) =>
      match byteRange? ti.stx with
      | some (b', e') => b == b' && e == e'
      | none => false

private def synthGoal (cctx : ContextInfo) (lctx : LocalContext) (ty : Expr)
    (pos : Lsp.Position) : IO GoalInfo :=
  cctx.runMetaM lctx do
    let mut hyps : List Hypothesis := []
    for decl in lctx do
      if decl.isAuxDecl || decl.isImplementationDetail then continue
      let tyStr := toString (← Meta.ppExpr decl.type)
      let isP ← try Meta.isProof (mkFVar decl.fvarId) catch _ => pure false
      hyps := hyps ++ [{
        username := decl.userName.toString
        type := tyStr
        value := none
        id := decl.fvarId.name.toString
        isProof := if isP then "proof" else "data" }]
    return { username := ""
             type := toString (← Meta.ppExpr ty)
             hyps
             id := syntheticGoalId pos }

private def byRootGoal (w : TermWalk) (byStx : Syntax) : IO (Option GoalInfo) := do
  let some (b, e) := byteRange? byStx | return none
  let hit := w.tacticInfos.find? fun (_, ti) =>
    match byteRange? ti.stx with
    | some (b', e') => b' ≥ b && e' ≤ e && !ti.goalsBefore.isEmpty
    | none => false
  let some (cctx, ti) := hit | return none
  let some g := ti.goalsBefore.head? | return none

  for st in w.steps do
    if st.goalBefore.id == g then return some st.goalBefore
  let printCtx := { cctx with mctx := ti.mctxAfter }
  try
    let gi ← printCtx.runMetaM {} do printGoalInfo printCtx g
    return some gi
  catch _ => return none

private def lspStart (w : TermWalk) (stx : Syntax) : Lsp.Position :=
  match stx.getRange? with
  | some r => w.fileMap.utf8PosToLspPos r.start
  | none => ⟨0, 0⟩

private def sliceStep (w : TermWalk) (b e : String.Pos.Raw) :
    String × Lsp.Position × Lsp.Position :=
  let raw := String.Pos.Raw.extract w.fileMap.source b e
  let tight := trimmedEnd raw
  ( String.Pos.Raw.extract raw ⟨0⟩ tight
  , w.fileMap.utf8PosToLspPos b
  , w.fileMap.utf8PosToLspPos ⟨b.byteIdx + tight.byteIdx⟩ )

private def mkStep (label : String) (start stop : Lsp.Position)
    (goalBefore : GoalInfo) (goalsAfter : List GoalInfo)
    (spawnedGoals : List GoalInfo) : ProofStep :=
  { tacticString := label, goalBefore, goalsAfter, spawnedGoals
    tacticDependsOn := [], theorems := []
    position := { start, stop } }

private partial def walkTerm (w : TermWalk) (goalBefore : GoalInfo)
    (stx : Syntax) : IO Recovery := do
  let k := stx.getKind
  let push (r : Recovery) (st : ProofStep) (extraGoals : List GoalInfo) : Recovery :=
    { r with
      steps := st :: r.steps
      goals := extraGoals ++ r.goals
      recovered := r.recovered.push { start := st.position.start, kind := "term" } }

  let subGoal (sub : Syntax) (fallbackTy : Option GoalInfo) :
      IO (Option (GoalInfo × Bool)) := do
    if sub.getKind == ``Parser.Term.byTactic then
      return (← byRootGoal w sub).map (·, false)
    match findInfo w sub with
    | some (cctx, ti) =>
      match ti.expectedType? with
      | some ty =>
        let g ← synthGoal cctx ti.lctx ty (lspStart w sub)
        return some (g, true)
      | none => return fallbackTy.map fun f =>
        ({ f with id := syntheticGoalId (lspStart w sub) }, true)
    | none => return fallbackTy.map fun f =>
        ({ f with id := syntheticGoalId (lspStart w sub) }, true)
  let recurse (g : GoalInfo) (needed : Bool) (sub : Syntax) : IO Recovery := do
    if needed then walkTerm w g sub else return {}

  let leaf : IO Recovery := do
    let some (b, e) := stx.getRange? |>.map (fun r => (r.start, r.stop)) | return {}
    let (label, start, stop) := sliceStep w b e
    let mut spawned : List GoalInfo := []
    for byNode in nodesOfKind [``Parser.Term.byTactic] stx do
      if let some g ← byRootGoal w byNode then
        spawned := spawned ++ [g]
    return push {} (mkStep label start stop goalBefore [] spawned) []
  if k == ``Parser.Term.have || k == ``Parser.Term.let then
    let isHave := k == ``Parser.Term.have
    let body := stx.getArgs.back!
    let some (hb, _) := stx.getRange? |>.map (fun r => (r.start, r.stop)) | leaf
    let some bodyRg := body.getRange? | leaf

    let decl? := stx.getArgs.find? fun a => a.getKind == ``Parser.Term.letDecl
    let inner := match decl? with
      | some d => if d.getNumArgs ≥ 1 then d[0] else d
      | none => stx
    let side :=
      if inner.getKind == ``Parser.Term.letIdDecl then
        inner.getArgs.back?
      else none
    match side with
    | none => leaf
    | some side =>
      if side.getRange?.isNone then leaf else do
      let (label, start, stop) := sliceStep w hb bodyRg.start
      let sideRes ← if isHave then subGoal side none else pure none
      let contRes ← subGoal body (some goalBefore)
      match contRes with
      | none => leaf
      | some (contGoal, contRec) =>
        let (spawned, sideRecovery) ← match sideRes with
          | some (g, needs) => do
            let r ← recurse g needs side
            pure ([g], r)
          | none => pure ([], ({} : Recovery))
        let bodyRecovery ← recurse contGoal contRec body
        let step := mkStep label start stop goalBefore [contGoal] spawned
        let merged : Recovery := {
          steps := sideRecovery.steps ++ bodyRecovery.steps
          goals := sideRecovery.goals ++ bodyRecovery.goals ++ [contGoal]
          grafts := sideRecovery.grafts ++ bodyRecovery.grafts
          recovered := sideRecovery.recovered ++ bodyRecovery.recovered }
        return push merged step spawned
  else if k == ``Parser.Term.fun then
    let basic := stx[1]
    let body := basic.getArgs.back!
    match stx.getRange?, body.getRange? with
    | some rg, some bodyRg =>
      let (label, start, stop) := sliceStep w rg.start bodyRg.start
      match ← subGoal body (some goalBefore) with
      | none => leaf
      | some (bodyGoal, needs) =>
        let r ← recurse bodyGoal needs body
        let step := mkStep label start stop goalBefore [bodyGoal] []
        return push { r with goals := bodyGoal :: r.goals } step []
    | _, _ => leaf
  else if k == ``Parser.Term.byTactic then

    return {}
  else
    leaf

def recoverTerm (fileMap : FileMap) (tree : InfoTree)
    (cmdStx? : Option Syntax) (steps : List ProofStep) : IO Recovery := do
  let some cmdStx := cmdStx? | return {}
  unless isTheoremLike cmdStx do return {}
  let some body := declBody? cmdStx | return {}
  if body.getKind == ``Parser.Term.byTactic then return {}
  let infos := tree.foldInfo (init := (#[] : Array (ContextInfo × TermInfo)))
    fun ctx info acc => match info with
      | .ofTermInfo ti => acc.push (ctx, ti)
      | _ => acc
  let tacticInfos := tree.foldInfo (init := (#[] : Array (ContextInfo × TacticInfo)))
    fun ctx info acc => match info with
      | .ofTacticInfo ti => acc.push (ctx, ti)
      | _ => acc
  let w : TermWalk := { fileMap, infos, tacticInfos, steps }
  let some (cctx, ti) := findInfo w body | return {}
  let some ety := ti.expectedType? | return {}
  let rootGoal ← synthGoal cctx ti.lctx ety (lspStart w body)
  let rec' ← walkTerm w rootGoal body
  if rec'.steps.isEmpty then return {}
  return { rec' with goals := rootGoal :: rec'.goals }

structure OpenBlock where

  goal   : GoalInfo

  anchor : Lsp.Position

  indent : Nat
  deriving ToJson, FromJson

def recoverOpenBlock (fileMap : FileMap) (tree : InfoTree)
    (cmdStx? : Option Syntax) (slots : Array TacticSlot) :
    IO (Option OpenBlock) := do
  let some cmdStx := cmdStx? | return none
  unless isTheoremLike cmdStx do return none
  unless slots.isEmpty do return none
  let some body := declBody? cmdStx | return none
  unless body.getKind == ``Parser.Term.byTactic do return none
  let some bodyRg := body.getRange? | return none
  let some cmdRg := cmdStx.getRange? | return none

  let hit := tree.foldInfo (init := (none : Option (ContextInfo × TacticInfo)))
    fun ctx info acc =>
      match acc, info with
      | none, .ofTacticInfo ti =>
        match ti.stx.getRange? with
        | some r =>
          if r.start.byteIdx ≥ bodyRg.start.byteIdx
              && r.stop.byteIdx ≤ bodyRg.stop.byteIdx
              && !ti.goalsBefore.isEmpty then
            some (ctx, ti)
          else acc
        | none => acc
      | acc, _ => acc
  let some (cctx, ti) := hit | return none
  let some g := ti.goalsBefore.head? | return none
  let printCtx := { cctx with mctx := ti.mctxAfter }
  let goal? ← try
      let gi ← printCtx.runMetaM {} do printGoalInfo printCtx g
      pure (some gi)
    catch _ => pure none
  let some goal := goal? | return none
  return some {
    goal
    anchor := fileMap.utf8PosToLspPos bodyRg.stop
    indent := (fileMap.utf8PosToLspPos cmdRg.start).character + 2 }

private def termDeps (cctx : ContextInfo) (ti : TermInfo) : IO (List String) :=
  cctx.runMetaM ti.lctx do
    try
      let full ← instantiateMVars ti.expr
      let ids := (collectFVars {} full).fvarIds
      return (ids.filterMap ti.lctx.find?).map (·.fvarId.name.toString) |>.toList
    catch _ => return []

def recoverCalcLinks (fileMap : FileMap) (tree : InfoTree)
    (steps : List ProofStep) (extra : Option Syntax := none) : IO Recovery := do
  let blocks := calcBlocks fileMap tree extra
  if blocks.isEmpty then return {}
  let src := fileMap.source
  let infos := tree.foldInfo (init := (#[] : Array (ContextInfo × TermInfo)))
    fun ctx info acc => match info with
      | .ofTermInfo ti => acc.push (ctx, ti)
      | _ => acc
  let mut out : Recovery := {}
  for b in blocks do
    if b.broken then continue

    let blockStart := fileMap.utf8PosToLspPos b.range.start
    let container := steps.foldl (init := (none : Option ProofStep)) fun best st =>
      if containsPos st.position.start st.position.stop blockStart then
        match best with
        | some c => if posLE c.position.start st.position.start then some st else best
        | none => some st
      else best
    let some calcStep := container | continue
    for lnk in b.links do
      let some just := lnk.just? | continue

      if just.isOfKind ``Lean.Parser.Term.syntheticHole then continue
      let some jr := just.getRange? (canonicalOnly := true) | continue
      let jStart := fileMap.utf8PosToLspPos jr.start
      let jStop := fileMap.utf8PosToLspPos jr.stop

      if steps.any (fun st => containsPos jStart jStop st.position.start) then
        continue
      let hit := infos.find? fun (_, ti) =>
        match ti.stx.getRange? (canonicalOnly := true) with
        | some r =>
          r.start == jr.start && r.stop == jr.stop && ti.expectedType?.isSome
        | none => false
      let some (cctx, ti) := hit | continue
      let some ety := ti.expectedType? | continue
      let goal ← try synthGoal cctx ti.lctx ety jStart catch _ => continue
      let deps ← termDeps cctx ti

      let raw := String.Pos.Raw.extract src jr.start jr.stop
      let tight := trimmedEnd raw
      out := { out with
        steps := out.steps ++ [{
          tacticString := String.Pos.Raw.extract raw ⟨0⟩ tight
          goalBefore := goal
          goalsAfter := []
          tacticDependsOn := deps
          spawnedGoals := []
          position :=
            { start := jStart
              stop := fileMap.utf8PosToLspPos ⟨jr.start.byteIdx + tight.byteIdx⟩ }
          theorems := [] }]
        goals := goal :: out.goals
        grafts := (calcStep.position.start, goal) :: out.grafts
        recovered := out.recovered.push { start := jStart, kind := "term" } }
  return out

end ProofTree.Recover
