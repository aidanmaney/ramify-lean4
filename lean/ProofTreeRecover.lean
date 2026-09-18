import Lean
import Services.BetterParser
import ProofTreeComments

open Lean Elab Paperproof.Services

namespace ProofTree.Recover

structure RecoveredStep where
  start : Lsp.Position

  kind : String
  deriving ToJson, FromJson, Inhabited

/-- One ROW of a TERM LEDGER: a component of an `⟨…⟩` that earned a goal box,
    named by that goal's id and by where the component was written.  The row's
    TEXT is deliberately NOT carried: the client reads it off the goal, exactly
    as a calc row's text is read off its link's goal, so the printed statement
    has one source of truth on either wire. -/
structure TermLedgerRow where
  goalId : String

  start  : Lsp.Position
  stop   : Lsp.Position
  deriving ToJson, FromJson, Inhabited

/-- What a STRUCTURED TERM draws as: one row per proof-relevant component of
    the `⟨…⟩`, in SOURCE order, keyed by the host tactic's `position.start` the
    way every other per-step sidecar is.  This is the IDENTIFICATION the ledger
    needs and nothing more — the calc ledger gets the same list for free by
    threading `spineRelation` down its links, and a constructor has no relation
    to thread.  `kind` is what the client branches on; `"ctor"` is the only
    value today. -/
structure TermLedger where
  tacticStart : Lsp.Position

  kind : String := "ctor"

  rows : Array TermLedgerRow := #[]
  deriving ToJson, FromJson, Inhabited

structure Recovery where
  steps     : List ProofStep := []

  goals     : List GoalInfo := []

  grafts    : List (Lsp.Position × GoalInfo) := []
  recovered : Array RecoveredStep := #[]

  ledgers   : Array TermLedger := #[]

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

private def isPropTy (cctx : ContextInfo) (lctx : LocalContext) (ty : Expr) :
    IO Bool :=
  cctx.runMetaM lctx do
    try Meta.isProp ty catch _ => pure false

-- One component of a structured term (an `⟨…⟩` element) earns a goal box only
-- if it is PROOF-RELEVANT and not already someone else's:
--   * a hole (`_`, `?_`) is a goal the reader can already see on the tactic;
--   * a component CONTAINING a harvested step (a nested `by`) belongs to the
--     harvest — Part B's `leaf` already spawns that block's root goal, and a
--     second box for it would draw the same subtree twice;
--   * a DATA component (`2 * k * k : ℕ`) is not an argument, it is a witness;
--     `⊢ ℕ` says nothing, so `Meta.isProp` is the gate.
private def componentGoal (w : TermWalk) (sub : Syntax) : IO (Option GoalInfo) := do
  if sub.isOfKind ``Parser.Term.syntheticHole || sub.isOfKind ``Parser.Term.hole then
    return none
  let some r := sub.getRange? | return none
  let sStart := w.fileMap.utf8PosToLspPos r.start
  let sStop := w.fileMap.utf8PosToLspPos r.stop
  if w.steps.any (fun st => containsPos sStart sStop st.position.start) then
    return none
  let some (cctx, ti) := findInfo w sub | return none
  let some ety := ti.expectedType? | return none
  unless ← isPropTy cctx ti.lctx ety do return none
  try
    let g ← synthGoal cctx ti.lctx ety sStart
    return some g
  catch _ => return none

-- The goal a component ALREADY has because the harvest owns it: a nested `by`
-- block's root, which `componentGoal` refuses to graft a second copy of.  It
-- is still a component of the term, so it is still a ROW — the outermost
-- harvested step written inside the component names it.
private def harvestedGoalIn (w : TermWalk) (sub : Syntax) : Option GoalInfo :=
  match sub.getRange? with
  | none => none
  | some r => Id.run do
    let sStart := w.fileMap.utf8PosToLspPos r.start
    let sStop := w.fileMap.utf8PosToLspPos r.stop
    let mut best : Option ProofStep := none
    for st in w.steps do
      if containsPos sStart sStop st.position.start then
        match best with
        | some c => if posLE st.position.start c.position.start then best := some st
        | none => best := some st
    return best.map (·.goalBefore)

-- The term a term-taking tactic applies, by KIND rather than by index: the
-- last child that is not an atom (`exact`/`apply`/`refine`/`refine'` are all
-- `atom term`, but nothing here counts arguments).
private def lastTermChild? (stx : Syntax) : Option Syntax := Id.run do
  let mut best : Option Syntax := none
  for a in stx.getArgs do
    match a with
    | .atom .. => pure ()
    | _ => if a.getRange?.isSome then best := some a
  return best

-- The `⟨…⟩` a term is built around: itself, or one inside a parenthesis or
-- standing as an argument of an application (`exact Or.inl ⟨h, hk⟩`).  Anything
-- else — a bare identifier, an ordinary application — is NOT structured, and
-- the tactic keeps its single leaf.
private partial def ctorTarget? (stx : Syntax) : Option Syntax :=
  if stx.getKind == ``Parser.Term.anonymousCtor then some stx
  else if stx.getKind == ``Parser.Term.paren
       || stx.getKind == ``Parser.Term.app
       || stx.getKind == nullKind then
    stx.getArgs.findSome? ctorTarget?
  else none

private def ctorComponents (stx : Syntax) : Array Syntax :=
  if stx.getNumArgs ≥ 2 then stx[1].getSepArgs else #[]

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
  else if k == ``Parser.Term.anonymousCtor then
    -- `⟨a, b, c⟩`: the node itself stays one step (the term the reader wrote),
    -- and every proof-relevant component hangs under it as a spawned goal with
    -- the component's own term walked below it.  Nested `by` blocks keep the
    -- `leaf` treatment they already had.
    let some (b, e) := stx.getRange? |>.map (fun r => (r.start, r.stop)) | leaf
    let (label, start, stop) := sliceStep w b e
    let mut spawned : List GoalInfo := []
    for byNode in nodesOfKind [``Parser.Term.byTactic] stx do
      if let some g ← byRootGoal w byNode then
        spawned := spawned ++ [g]
    let mut minted : List GoalInfo := []
    let mut sub : Recovery := {}
    for c in ctorComponents stx do
      let some g ← componentGoal w c | continue
      minted := minted ++ [g]
      let r ← walkTerm w g c
      sub := { steps := sub.steps ++ r.steps
               goals := sub.goals ++ r.goals
               grafts := sub.grafts ++ r.grafts
               recovered := sub.recovered ++ r.recovered }
    if minted.isEmpty && spawned.isEmpty then leaf else
    return push sub (mkStep label start stop goalBefore [] (spawned ++ minted)) minted
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

-- Part E — term-level structure INSIDE a tactic.  `exact ⟨key n, parity n, gap
-- n, residue⟩` is one leaf today; every component of it is a proposition the
-- author supplied a proof of, and `TermInfo.expectedType?` already knows which.
-- Only the four term-taking tactics are read (decomposed by KIND: the term is
-- the last non-atom child), and only a STRUCTURED term — an `⟨…⟩`, possibly
-- parenthesised or standing as an argument of an application — mints anything,
-- so `exact foo a b` stays the leaf it reads as.  The components' goals are
-- GRAFTED onto the harvested step (the tactic node already exists; Part B's
-- `walkTerm` runs below each goal), which is the same seam `recoverCalcLinks`
-- uses for a calc justification.
def recoverTermInStep (fileMap : FileMap) (tree : InfoTree)
    (steps : List ProofStep) : IO Recovery := do
  let infos := tree.foldInfo (init := (#[] : Array (ContextInfo × TermInfo)))
    fun ctx info acc => match info with
      | .ofTermInfo ti => acc.push (ctx, ti)
      | _ => acc
  if infos.isEmpty then return {}
  let tacticInfos := tree.foldInfo (init := (#[] : Array (ContextInfo × TacticInfo)))
    fun ctx info acc => match info with
      | .ofTacticInfo ti => acc.push (ctx, ti)
      | _ => acc
  let w : TermWalk := { fileMap, infos, tacticInfos, steps }
  let mut out : Recovery := {}
  let mut seen : Std.HashSet String := {}
  for (_, ti) in tacticInfos do
    let k := ti.stx.getKind
    unless k == ``Parser.Tactic.exact || k == ``Parser.Tactic.refine
        || k == ``Parser.Tactic.refine' || k == ``Parser.Tactic.apply do
      continue
    let some term := lastTermChild? ti.stx | continue
    let some ctor := ctorTarget? term | continue
    let some cr := ctor.getRange? | continue
    let key := s!"{cr.start.byteIdx}:{cr.stop.byteIdx}"
    if seen.contains key then continue
    seen := seen.insert key
    let ctorStart := fileMap.utf8PosToLspPos cr.start

    let container := steps.foldl (init := (none : Option ProofStep)) fun best st =>
      if containsPos st.position.start st.position.stop ctorStart then
        match best with
        | some c => if posLE c.position.start st.position.start then some st else best
        | none => some st
      else best
    let some host := container | continue
    -- The LEDGER's rows, in source order: every component that has a goal to
    -- name, whether this pass grafted it or the harvest already owned it.  A
    -- witness and a hole name none and so are no row.
    let mut rows : Array TermLedgerRow := #[]
    let pushRow (rows : Array TermLedgerRow) (c : Syntax) (g : GoalInfo) :
        Array TermLedgerRow :=
      match c.getRange? with
      | some rg => rows.push
          { goalId := g.id.name.toString
            start  := fileMap.utf8PosToLspPos rg.start
            stop   := fileMap.utf8PosToLspPos rg.stop }
      | none => rows
    for c in ctorComponents ctor do
      match ← componentGoal w c with
      | none =>
        if let some g := harvestedGoalIn w c then rows := pushRow rows c g
      | some g =>
        rows := pushRow rows c g
        let r ← walkTerm w g c
        -- Appended, never prepended: `Recovery.apply` grafts in list order, and
        -- the components must reach `spawnedGoals` in the order they were
        -- written.
        out := { out with
                 steps := out.steps ++ r.steps
                 goals := out.goals ++ r.goals ++ [g]
                 grafts := out.grafts ++ r.grafts ++ [(host.position.start, g)]
                 recovered := out.recovered ++ r.recovered }
    -- One component is a branch, not a ledger: below two rows the reader is
    -- better served by the box the component already had.
    if rows.size ≥ 2 then
      let led : TermLedger := { tacticStart := host.position.start, rows }
      out := { out with ledgers := out.ledgers.push led }

  return { out with
    recovered := out.recovered.map fun r => { r with kind := "subterm" } }

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

/-! ## Hypothesis provenance (B2)

Which earlier step introduced each hypothesis in a goal's context. Paperproof
ships the raw `fvarId` on every `Hypothesis` but correlates nothing across
steps, so the reading is recovered here, by a pure post-pass over the FINAL
step list (after every recovery has been applied, so a recovered `have`/term
step can be an introducer like any other).

The rule is one comparison per step, in SOURCE ORDER: an id that appears in
`goalsAfter ++ spawnedGoals` and is absent from `goalBefore.hyps` was
introduced *by that step*. FIRST WRITER WINS — a hypothesis that is rewritten
or renamed gets a NEW fvarId, whose introducer is the rewriting step, which is
the reading we want (`rw [h] at hx` really does re-introduce `hx`); the same
id reappearing further down is the same hypothesis travelling, not a second
introduction.

The declaration's own binders need no special case: they sit in the ROOT
step's `goalBefore`, so they are never "absent from goalBefore" anywhere and
simply get no entry. The client reads a missing origin as "from the statement".
-/
namespace ProofTree

structure HypOrigin where

  id : String

  username : String

  start : Lsp.Position
  deriving ToJson, FromJson, Inhabited

def hypOrigins (steps : List Paperproof.Services.ProofStep) : Array HypOrigin :=
  Id.run do
    let ordered := steps.toArray.qsort fun a b =>
      (compare a.position.start b.position.start).isLT
    let mut seen : Std.HashSet String := {}
    let mut out : Array HypOrigin := #[]
    for s in ordered do
      let mut before : Std.HashSet String := {}
      for h in s.goalBefore.hyps do before := before.insert h.id
      for g in s.goalsAfter ++ s.spawnedGoals do
        for h in g.hyps do
          unless before.contains h.id || seen.contains h.id do
            seen := seen.insert h.id
            out := out.push
              { id := h.id, username := h.username, start := s.position.start }
    return out

end ProofTree

/-! ## Lemma references per step (B3)

The constants a step's tactic text names — the "premise library" every
informalization paper takes as its input, and what a reader asking "what did
this step USE?" is looking at when a hypothesis is not the answer.

Harvested from ONE predicate, `constIdentNodes`, which is also what
`collectConstIdentTokens` (Ramify.lean) paints `const`-coloured: an ORIGINAL
identifier whose elaborated term is headed by a constant. Sharing the
predicate is the point — a name that colours as a constant and a name that
appears in the reference list must be the same set, or the two readings drift.
Local hypotheses are fvars, not constants, so they are excluded for free; the
declaration under elaboration is excluded by name (structural recursion refers
to itself, which is not a premise), as are internal and macro-scoped names.

ATTRIBUTION IS INNERMOST. Tactic ranges NEST (`have h : P := by simp [foo]` is
one step containing another), and a lemma named inside a nested `by` belongs
to the inner step; the outer one must not repeat it, or every enclosing step
inherits its whole subtree's premises and the list stops meaning anything.
So each identifier goes to the containing step with the LATEST start (ties to
the tightest stop), and to that one only.

Per step the list is deduped by name and keeps SOURCE ORDER of first
occurrence. The docstring is the environment's own (`findDocString?`), raw
markdown — the client already knows how to clean it (`cleanMarkdown`).
-/
namespace ProofTree

structure LemmaRef where

  stepStart : Lsp.Position

  name : String

  doc : Option String := none

  kind : String := ""
  deriving ToJson, FromJson, Inhabited

def constIdentNodes (tree : InfoTree) : List (Syntax × Name) :=
  tree.deepestNodes fun _ info _ => do
    let .ofTermInfo ti := info | none
    let .original .. := ti.stx.getHeadInfo | none
    guard ti.stx.isIdent
    let f := ti.expr.getAppFn
    guard f.isConst
    return (ti.stx, f.constName!)

private def constKind (env : Environment) (n : Name) : String :=
  match env.find? n with
  | some (.thmInfo _)    => "theorem"
  | some (.axiomInfo _)  => "axiom"
  | some (.defnInfo _)   => "def"
  | some (.inductInfo _) => "inductive"
  | some (.ctorInfo _)   => "ctor"
  | some (.recInfo _)    => "rec"
  | some (.opaqueInfo _) => "opaque"
  | some (.quotInfo _)   => "quot"
  | none                 => ""

def lemmaRefs (env : Environment) (fileMap : FileMap) (tree : InfoTree)
    (steps : List Paperproof.Services.ProofStep) (self : Option Name := none) :
    IO (Array LemmaRef) := do
  if steps.isEmpty then return #[]
  let idents : Array (Nat × Name) :=
    (constIdentNodes tree).toArray.filterMap fun (stx, n) =>
      match stx.getRange? (canonicalOnly := true) with
      | some r => some (r.start.byteIdx, n)
      | none   => none
  let idents := idents.qsort fun a b => a.1 < b.1
  let mut seen : Std.HashSet String := {}
  let mut docs : Std.HashMap Name (Option String) := {}
  let mut out : Array LemmaRef := #[]
  for (b, n) in idents do
    if n.isAnonymous || n.isInternal || n.hasMacroScopes then continue
    if self == some n then continue
    let p := fileMap.utf8PosToLspPos ⟨b⟩
    let host := steps.foldl (init := (none : Option Paperproof.Services.ProofStep))
      fun best st =>
        if (compare st.position.start p).isLE && (compare p st.position.stop).isLE then
          match best with
          | none => some st
          | some c =>
            match compare c.position.start st.position.start with
            | .lt => some st
            | .eq => if (compare st.position.stop c.position.stop).isLT then some st else best
            | .gt => best
        else best
    let some h := host | continue
    let key := s!"{h.position.start.line}:{h.position.start.character}:{n}"
    if seen.contains key then continue
    seen := seen.insert key
    let doc ← match docs[n]? with
      | some d => pure d
      | none   => do
        let d ← findDocString? env n
        docs := docs.insert n d
        pure d
    out := out.push
      { stepStart := h.position.start, name := n.toString, doc,
        kind := constKind env n }
  return out

partial def declName? (stx : Syntax) : Option Name :=
  match stx with
  | .node _ k args =>
    if k == ``Lean.Parser.Command.declId && args.size > 0 then
      some args[0]!.getId
    else args.foldl (fun acc a => acc <|> declName? a) none
  | _ => none

end ProofTree

/-! ## Automation traces (B4)

WHICH LEMMAS closed the goal, for a step whose tactic is an automation call.
`▸` marks answer "which hypotheses"; B3's `lemmaRefs` answers "which constants
did the author WRITE"; this answers the one a reader of `simp` or `grind`
actually asks, and which neither of the other two can: the author wrote no
name at all, and the premises are the ones the search found.

MECHANISM: core's own `?`-suggesting forms. `simp?`, `simp_all?`, `grind?` and
`aesop?` all exist in v4.32.2 (measured, `lake env lean` on a scratch file) and
each emits an information message `Try this:\n  [apply] simp only [a, b, c]`.
So a trace is the declaration RE-ELABORATED with its automation tactics
rewritten to their `?` forms, and the suggestion text parsed for the bracketed
list. Nothing is invented: every name in the list is core's own report of what
it used, and the raw text is kept beside the parse so a reader can see it.

ALL SITES AT ONCE, not one per request. A `?` form behaves exactly as the bare
one — it only says more — so rewriting every automation tactic in the
declaration together costs ONE re-elaboration for the whole proof instead of
one per `simp`. That is what makes the feature affordable at all: the
alternative (the brief's per-step splice) re-elaborates a Mathlib declaration
once per automation step, which on a proof with ten `simp`s is ten times the
cost for data the first pass already had in hand.

The tactics with NO `?` form — `omega`, `linarith`, `nlinarith`, `decide`,
`norm_num`, `positivity`, `ring` — are not left out: they get a trace of kind
`opaque`, computed with no elaboration at all, so the reader is told "closed by
`omega`, which keeps no lemma list" rather than being met with silence that
looks like a bug.

Positions: inserting `?` never adds a line, so a rewritten tactic's start moves
only by the number of `?`s inserted EARLIER ON ITS OWN LINE. `siteFor` records
both the original start (the sidecar's key, and the client's) and the new one
(what the message's position will read), so the two are matched exactly rather
than by proximity.
-/
namespace ProofTree

/-- The automation tactics, as ONE list. Head words; `exact?` carries its `?`
in its own name. The client mirrors this (web/src/trace.ts) to decide which
node gets the affordance — the affordance must not need a round trip. -/
def traceableHeads : Array String :=
  #["simp", "simp_all", "grind", "aesop"]

/-- Automation with no `?` form in v4.32.2: a trace of kind `opaque`. -/
def opaqueHeads : Array String :=
  #["omega", "linarith", "nlinarith", "decide", "norm_num", "positivity",
    "ring", "ring_nf", "trivial", "tauto"]

/-- Already a suggestion tactic: re-elaborated unchanged, its own message read. -/
def suggestionHeads : Array String :=
  #["exact?", "apply?", "simp?", "simp_all?", "grind?", "aesop?"]

def isAutomationHead (h : String) : Bool :=
  traceableHeads.contains h || opaqueHeads.contains h || suggestionHeads.contains h

structure AutomationTrace where

  stepStart : Lsp.Position

  tactic : String

  /-- `"lemmas"` (a suggestion was read), `"opaque"` (no `?` form exists) or
  `"failed"` (the `?` form ran and said nothing). -/
  kind : String

  /-- The full `Try this` text, minus the header and core's `[apply]` link
  marker — kept verbatim beside the parse. -/
  suggestion : Option String := none

  lemmas : Array LemmaRef := #[]
  deriving ToJson, FromJson, Inhabited

/-- One automation tactic in the source, ready to rewrite. -/
structure TraceSite where

  stepStart : Lsp.Position

  head : String

  /-- Byte offset in the ORIGINAL source where a `?` goes (end of the head
  word). `none` for a head that needs no rewrite. -/
  insertAt : Option Nat

  /-- The tactic's start once every `?` has been inserted — what the
  suggestion message's own position will read. -/
  newStart : Lsp.Position

private def isHeadChar (c : Char) : Bool :=
  c.isAlphanum || c == '_' || c == '\''

/-- The head word at a byte offset, plus the offset just past it: the run of
identifier characters, taking a trailing `?` with it so `exact?` reads as one
word. -/
def headWordAt (src : String) (b : Nat) : String × Nat :=
  let n := src.utf8ByteSize
  -- to the end of the file, not a byte window: a window's far end can land
  -- mid-character, and the head word is a handful of bytes either way.
  let rest := String.Pos.Raw.extract src ⟨b⟩ ⟨n⟩
  let w := (rest.takeWhile isHeadChar).toString
  let after := b + w.utf8ByteSize
  if w.isEmpty then (w, after)
  else if (rest.drop w.length).toString.startsWith "?" then (w ++ "?", after + 1)
  else (w, after)

/-- Every automation tactic among the harvested steps, in source order, with
the rewritten text's positions already worked out. -/
def traceSites (fileMap : FileMap) (steps : List Paperproof.Services.ProofStep) :
    Array TraceSite := Id.run do
  let src := fileMap.source
  let mut raw : Array (Nat × Lsp.Position × String × Option Nat) := #[]
  let mut seen : Std.HashSet (Nat × Nat) := {}
  for s in steps do
    let p := s.position.start
    if seen.contains (p.line, p.character) then continue
    let b := (fileMap.lspPosToUtf8Pos p).byteIdx
    let (head, after) := headWordAt src b
    unless isAutomationHead head do continue
    seen := seen.insert (p.line, p.character)
    let insertAt := if traceableHeads.contains head then some after else none
    raw := raw.push (b, p, head, insertAt)
  let sorted := raw.qsort fun a b => a.1 < b.1
  -- The shift a site's own start takes: one column per `?` inserted earlier on
  -- the same line (an insertion is always PAST its site's start, so a site is
  -- never moved by its own).
  let mut out : Array TraceSite := #[]
  for (_, p, head, insertAt) in sorted do
    let shift := sorted.foldl (init := 0) fun acc (_, q, _, ins) =>
      match ins with
      | some i => if q.line == p.line && i ≤ (fileMap.lspPosToUtf8Pos p).byteIdx
                  then acc + 1 else acc
      | none => acc
    out := out.push
      { stepStart := p, head,
        insertAt,
        newStart := ⟨p.line, p.character + shift⟩ }
  return out

/-- The source with every traceable site's `?` inserted. `none` when there is
nothing to rewrite (every site is opaque, or already a suggestion form). -/
def traceRewrite (src : String) (sites : Array TraceSite) : Option String :=
  let ins := sites.filterMap (·.insertAt) |>.qsort (· < ·)
  if ins.isEmpty then none
  else Id.run do
    let mut out := ""
    let mut prev := 0
    for i in ins do
      out := out ++ String.Pos.Raw.extract src ⟨prev⟩ ⟨i⟩ ++ "?"
      prev := i
    out := out ++ String.Pos.Raw.extract src ⟨prev⟩ ⟨src.utf8ByteSize⟩
    return some out

/-- The body of a `Try this:` message: the header dropped, core's `[apply]`
link marker dropped from each line, blank lines squeezed. -/
def suggestionBody (text : String) : Option String :=
  -- `grind?` says "Try these:" and offers a list; `simp?` says "Try this:".
  -- Both are read, and every line of a list is kept — the names are pooled and
  -- deduped, so a reader gets the union of what the search reported.
  let header := if text.startsWith "Try this:" then some "Try this:"
    else if text.startsWith "Try these:" then some "Try these:"
    else none
  match header with
  | none => none
  | some h =>
    let rest := (text.drop h.length).toString
    let lines := rest.splitOn "\n" |>.map fun l =>
      let t := l.trimAscii.toString
      if t.startsWith "[apply]" then ((t.drop "[apply]".length).toString).trimAscii.toString
      else t
    let kept := lines.filter fun l => !l.isEmpty
    if kept.isEmpty then none else some (String.intercalate "\n" kept)

private def isNameStart (c : Char) : Bool := c.isAlpha || c == '_'

/-- The names in a suggestion's bracketed lists, in order of first occurrence.
`simp only [a, ← b, Foo.bar]` gives `a`, `b`, `Foo.bar`; a `←` or `↑` prefix is
dropped, and anything that is not a dotted identifier (a numeral, a term in
parentheses, `*`) is skipped. -/
def suggestionNames (body : String) : Array String := Id.run do
  let cs := body.toList
  let mut depth := 0
  let mut cur := ""
  let mut chunks : Array String := #[]
  for c in cs do
    if c == '[' then
      depth := depth + 1
      if depth == 1 then cur := ""
    else if c == ']' then
      if depth == 1 then
        chunks := chunks.push cur
        cur := ""
      depth := max 0 (depth - 1)
    else if depth ≥ 1 then
      cur := cur.push c
  let mut seen : Std.HashSet String := {}
  let mut out : Array String := #[]
  for chunk in chunks do
    for piece in chunk.splitOn "," do
      let mut t := piece.trimAscii.toString
      -- `grind` writes `!Nat.factorial_pos`, `simp` writes `← foo`.
      for pre in ["←", "<-", "↑", "@", "!", "-"] do
        if t.startsWith pre then t := ((t.drop pre.length).toString).trimAscii.toString
      -- Take the leading dotted identifier and nothing else: `Nat.foo` yes,
      -- `(h : p)` and `*` no.
      let mut nm := ""
      for c in t.toList do
        if nm.isEmpty then
          if isNameStart c then nm := nm.push c else break
        else if isHeadChar c || c == '.' then nm := nm.push c
        else break
      if nm.isEmpty then continue
      if nm.endsWith "." then continue
      unless seen.contains nm do
        seen := seen.insert nm
        out := out.push nm
  return out

/-- Resolve a suggestion's names against the environment: the docstring and
kind B3's `LemmaRef` carries, so the two lists read the same in the client.
A name the environment does not know keeps its text with an empty kind — the
suggestion is core's own words and is shown either way. -/
def traceLemmas (env : Environment) (at_ : Lsp.Position) (names : Array String) :
    IO (Array LemmaRef) := do
  let mut out : Array LemmaRef := #[]
  for s in names do
    let n := s.toName
    let doc ← if (env.find? n).isSome then findDocString? env n else pure none
    out := out.push
      { stepStart := at_, name := s, doc,
        kind := match env.find? n with
          | some (.thmInfo _)    => "theorem"
          | some (.axiomInfo _)  => "axiom"
          | some (.defnInfo _)   => "def"
          | some (.inductInfo _) => "inductive"
          | some (.ctorInfo _)   => "ctor"
          | some (.recInfo _)    => "rec"
          | some (.opaqueInfo _) => "opaque"
          | some (.quotInfo _)   => "quot"
          | none                 => "" }
  return out

/-- Turn the messages of a rewritten elaboration into one trace per site.
`msgs` is `(position in the REWRITTEN text, message text)`; a site is matched
by its `newStart`, exactly, so no proximity guess is needed. Opaque sites get
their trace without any message at all. -/
def collectTraces (env : Environment) (sites : Array TraceSite)
    (msgs : Array (Lsp.Position × String)) : IO (Array AutomationTrace) := do
  let mut out : Array AutomationTrace := #[]
  for site in sites do
    if opaqueHeads.contains site.head then
      out := out.push
        { stepStart := site.stepStart, tactic := site.head, kind := "opaque" }
      continue
    let body := msgs.findSome? fun (p, text) =>
      if p.line == site.newStart.line && p.character == site.newStart.character
      then suggestionBody text else none
    match body with
    | none =>
      out := out.push
        { stepStart := site.stepStart, tactic := site.head, kind := "failed" }
    | some b =>
      let lemmas ← traceLemmas env site.stepStart (suggestionNames b)
      out := out.push
        { stepStart := site.stepStart, tactic := site.head, kind := "lemmas",
          suggestion := some b, lemmas }
  return out

end ProofTree

/-! ## Case and branch semantics (B5)

What a branching tactic actually did, decoded from its SYNTAX KIND rather than
from the shape of its label. Before this the client asked a regex whether a
tactic's text began with `rw`/`rewrite`/`erw` (to decide which of several
goals-after is the proof's continuation and which are side obligations), and
read case tags off `GoalInfo.username` alone — so `induction m with | succ k ih`
drew a case badge saying `succ` and nothing about `k` or `ih`, and
`rcases h with ⟨k, hk⟩ | h` said `inl`/`inr` with the patterns lost.

`branches` emits one `BranchInfo` per branching step, keyed (like every other
sidecar) on `position.start`:

* `form` is the KIND, normalised to a word: `induction`, `cases`, `rcases`,
  `obtain`, `rintro`, `by_cases`, `constructor`, `refine`, `match`, `split`,
  `interval_cases`, `fin_cases`, `rewrite`.
* `on` is the discriminant's source text where the form has one.
* `arms` are the branches in SOURCE order, each with the case `tag` Lean names
  the goal by, the names the arm BINDS, the pattern text where the form has
  one, and the id of the goal the arm produced.

Tags come from the elaborator, never from the text:

* `induction`/`cases` take them from the `with | … =>` alternatives when the
  author wrote them (which is also what makes a `using` eliminator's own tags
  right), and otherwise from the inductive type's constructors in DECLARATION
  order, which is what Lean itself names the goals by;
* `constructor` takes them from the target structure's FIELDS (`And` splits
  `left`/`right`, `Iff` `mp`/`mpr`); a non-structure inductive does not split
  under `constructor` at all and gets no arms;
* `by_cases` is `pos`/`neg`, the two names its own macro expansion writes;
* `refine` takes a named hole's name, and otherwise the goal's;
* `rcases`/`obtain`/`rintro` have no tags of their own — Lean names those goals
  positionally from the pattern's alternatives, so they are resolved
  positionally and then ADOPT the goal's own tag.

Where the kind is one this walk cannot decode (`match`, `split`,
`interval_cases`, `fin_cases`) the form is emitted with `arms := #[]` rather
than a guess: the client reads an empty arm list as "no structured answer" and
keeps whatever it did before.
-/
namespace ProofTree

structure BranchArm where

  tag : String := ""

  binders : Array String := #[]

  pattern : Option String := none

  goalId : Option String := none
  deriving ToJson, FromJson, Inhabited

structure BranchInfo where

  stepStart : Lsp.Position

  form : String

  «on» : Option String := none

  withAlts : Bool := false

  arms : Array BranchArm := #[]
  deriving ToJson, FromJson, Inhabited

private def branchForm (k : Name) : Option String :=
  if k == ``Lean.Parser.Tactic.induction then some "induction"
  else if k == ``Lean.Parser.Tactic.cases then some "cases"
  else if k == ``Lean.Parser.Tactic.rcases then some "rcases"
  else if k == ``Lean.Parser.Tactic.obtain then some "obtain"
  else if k == ``Lean.Parser.Tactic.rintro then some "rintro"
  else if k == ``Lean.Parser.Tactic.constructor then some "constructor"
  else if k == ``Lean.Parser.Tactic.refine then some "refine"
  else if k == ``Lean.Parser.Tactic.split then some "split"
  else if k == ``Lean.Parser.Tactic.rwSeq then some "rewrite"
  else if k == ``Lean.Parser.Tactic.rewriteSeq then some "rewrite"
  else if k == `Lean.Parser.Tactic.tacticErw___ then some "rewrite"
  else if k == `Lean.Parser.Tactic.refine' then some "refine"
  else if k == `Mathlib.Tactic.tacticRefine'_ then some "refine"
  else if k == `Lean.Parser.Tactic.match then some "match"
  else if k == `Mathlib.Tactic.intervalCases then some "interval_cases"
  else if k == `Lean.Elab.Tactic.finCases then some "fin_cases"
  else if k == `«tacticBy_cases_:_» then some "by_cases"
  else none

private def srcOf (fileMap : FileMap) (stx : Syntax) : Option String := do
  let r ← stx.getRange?
  let raw := String.Pos.Raw.extract fileMap.source r.start r.stop
  let t := raw.trimAscii.toString
  if t.isEmpty then none else some t

private partial def ptNodes (k : Name) (stx : Syntax) : Array Syntax :=
  if stx.getKind == k then #[stx]
  else stx.getArgs.foldl (fun acc a => acc ++ ptNodes k a) #[]

/-- Like `ptNodes`, but never descends into a nested tactic BLOCK: the
alternatives of `induction … with | h n ih => rcases x with a | b` carry a
whole proof of their own, and its `elimTarget`s and patterns are not this
tactic's. -/
private partial def ptNodesHere (k : Name) (stx : Syntax) : Array Syntax :=
  if stx.getKind == k then #[stx]
  else if stx.getKind == ``Lean.Parser.Tactic.tacticSeq
       || stx.getKind == ``Lean.Parser.Term.byTactic then #[]
  else stx.getArgs.foldl (fun acc a => acc ++ ptNodesHere k a) #[]

/-- Every ident bound by an `rcases` pattern, in source order.  Only
`rcasesPat.one` binds; `_` and `-` bind nothing. -/
private partial def patBinders (stx : Syntax) : Array String :=
  if stx.getKind == ``Lean.Parser.Tactic.rcasesPat.one then
    stx.getArgs.foldl (init := #[]) fun acc a =>
      match a with
      | .ident _ _ n _ => if n == `_ then acc else acc.push n.toString
      | _ => acc
  else stx.getArgs.foldl (fun acc a => acc ++ patBinders a) #[]

/-- The `|`-separated alternatives of an `rcasesPatMed`, by kind: the `|`s are
atoms and everything that is not an atom is an alternative. -/
private def medAlts (med : Syntax) : Array Syntax :=
  med.getArgs.foldl (init := #[]) fun acc a =>
    acc ++ (a.getArgs.filter fun c => !(c matches .atom ..))

/-- The alternatives of an `rcases`/`obtain`/`rintro` pattern.  A pattern with
no `|` is ONE arm. -/
private def rcasesArms (fileMap : FileMap) (pat : Syntax) (produced : Nat) :
    Array BranchArm :=
  let meds := ptNodesHere ``Lean.Parser.Tactic.rcasesPatMed pat
  let top := meds[0]?
  let alts := match top with
    | some m => let a := medAlts m; if a.size ≤ 1 then #[] else a
    | none   => #[]
  if alts.isEmpty then
    -- An alternation NESTED inside a tuple (`⟨k, hk | hk⟩`) splits the goal
    -- without splitting the top-level pattern, and reading its binders as one
    -- arm's would list `hk` twice.  Undecoded rather than wrong.
    let nested := pat.getArgs.foldl (init := (#[] : Array Syntax)) fun acc a =>
      acc ++ ptNodesHere ``Lean.Parser.Tactic.rcasesPatMed a
    if produced > 1 && nested.any (fun m => (medAlts m).size > 1) then #[]
    else #[{ binders := patBinders pat, pattern := srcOf fileMap pat }]
  else
    alts.map fun a => { binders := patBinders a, pattern := srcOf fileMap a }

/-- The tag and the bound names of one `inductionAltLHS`, by kind: the tag is
the ident inside the `group`, the binders are the idents beside it. -/
private def altTagBinders (lhs : Syntax) : String × Array String := Id.run do
  let mut tag := ""
  let mut binders : Array String := #[]
  for a in lhs.getArgs do
    match a with
    | .atom .. => pure ()
    | .ident _ _ n _ => binders := binders.push n.toString
    | .node _ k args =>
      if k == `group then
        for g in args do
          if let .ident _ _ n _ := g then
            if tag.isEmpty then tag := n.getString!
      else
        for g in args do
          match g with
          | .ident _ _ n _ => binders := binders.push n.toString
          | _ => pure ()
    | _ => pure ()
  return (tag, binders)

/-- Every synthetic hole (`?_`, `?name`) in a term, in source order. -/
private partial def holeNames (stx : Syntax) : Array String :=
  if stx.getKind == ``Lean.Parser.Term.syntheticHole then
    #[stx.getArgs.foldl (init := "") fun acc a =>
        match a with
        | .ident _ _ n _ => if acc.isEmpty then n.toString else acc
        | _ => acc]
  else stx.getArgs.foldl (fun acc a => acc ++ holeNames a) #[]

/-- Lean's own tag for a goal, out of the mvar's user name: the macro scope
goes, and a nested tag (`mpr.inl`, `neg.refine_1.inl`) keeps its LAST
component, which is the one the branching step in hand minted. -/
def caseTag (username : String) : String :=
  let base := match username.splitOn "._@." with
    | b :: _ => b
    | []     => username
  let base := base.trimAscii.toString
  if base.isEmpty || base == "[anonymous]" || base == "_" then ""
  else match base.splitOn "." |>.getLast? with
    | some l => l
    | none   => ""

private structure Produced where
  id  : String
  tag : String
  deriving Inhabited

private def producedOf (s : Paperproof.Services.ProofStep) : Array Produced :=
  (s.goalsAfter ++ s.spawnedGoals).toArray.map fun g =>
    { id := g.id.name.toString, tag := caseTag g.username }

/-- Arms to goals.  BY TAG where the syntax gave tags and every one of them
names a produced goal; POSITIONALLY where it did not (which is where Lean
itself is positional), in which case the arm ADOPTS the goal's own tag. -/
private def resolveArms (arms : Array BranchArm) (prod : Array Produced) :
    Array BranchArm := Id.run do
  if arms.isEmpty then return arms
  let tagged := arms.all fun a => !a.tag.isEmpty
  if tagged then
    let byTag := arms.map fun a =>
      match prod.find? fun p => p.tag == a.tag with
      | some p => { a with goalId := some p.id }
      | none   => a
    if byTag.all (·.goalId.isSome) then return byTag
  if arms.size == prod.size then
    return arms.mapIdx fun i a =>
      { a with goalId := some prod[i]!.id,
               tag := if a.tag.isEmpty then prod[i]!.tag else a.tag }
  -- One arm is one continuation: it is the goal the step goes on with, even
  -- where the step also spawned side work.
  if arms.size == 1 && prod.size > 1 then
    let p : Produced := prod[0]!
    let a0 : BranchArm := arms[0]!
    let tag := if a0.tag.isEmpty then p.tag else a0.tag
    return #[{ a0 with goalId := some p.id, tag }]
  return arms

/-- The constructors of the inductive the discriminant lives in, in
DECLARATION order — what Lean names `induction`/`cases` goals by. -/
private def ctorTagsOf (ctx : ContextInfo) (ti : TacticInfo) (target : Name) :
    IO (Array String) := do
  let some g := ti.goalsBefore.head? | return #[]
  let some decl := ti.mctxBefore.findDecl? g | return #[]
  let printCtx := { ctx with mctx := ti.mctxBefore }
  try
    printCtx.runMetaM decl.lctx do
      let some fv := (← getLCtx).findFromUserName? target | return #[]
      let ty ← Meta.whnf (← Meta.inferType fv.toExpr)
      let some c := ty.getAppFn.constName? | return #[]
      match (← getEnv).find? c with
      | some (.inductInfo iv) => return iv.ctors.toArray.map (·.getString!)
      | _ => return #[]
  catch _ => return #[]

/-- The fields of the target's structure — the arms `constructor` splits into.
A non-structure inductive does not split (`constructor` picks one ctor), and
gets no arms. -/
private def structFieldsOf (ctx : ContextInfo) (ti : TacticInfo) :
    IO (Array String) := do
  let some g := ti.goalsBefore.head? | return #[]
  let some decl := ti.mctxBefore.findDecl? g | return #[]
  let printCtx := { ctx with mctx := ti.mctxBefore }
  try
    printCtx.runMetaM decl.lctx do
      let ty ← Meta.whnf decl.type
      let some c := ty.getAppFn.constName? | return #[]
      let env ← getEnv
      if isStructure env c then
        return (getStructureFields env c).map (·.toString)
      else return #[]
  catch _ => return #[]

/-- The text after the `:=` of an `obtain`. -/
private def afterAssign (fileMap : FileMap) (stx : Syntax) : Option String := do
  let r ← stx.getRange?
  let asn ← stx.getArgs.findSome? fun a =>
    (ptNodes nullKind a).findSome? fun n =>
      n.getArgs.findSome? fun c => match c with
        | .atom info ":=" => info.getRange?.map (·.stop)
        | _ => none
  let t := (String.Pos.Raw.extract fileMap.source asn r.stop).trimAscii.toString
  if t.isEmpty then none else some t

private def discriminant (fileMap : FileMap) (form : String) (stx : Syntax) :
    Option String :=
  match form with
  | "induction" | "cases" | "rcases" | "interval_cases" | "fin_cases" =>
    let ts := (ptNodesHere ``Lean.Parser.Tactic.elimTarget stx).filterMap
      (srcOf fileMap ·)
    if ts.isEmpty then
      -- `interval_cases n` / `fin_cases i` take a bare term, not an elimTarget.
      (stx.getArgs.filterMap fun a =>
        match a with | .atom .. => none | _ => srcOf fileMap a)[0]?
    else some (String.intercalate ", " ts.toList)
  | "obtain" => afterAssign fileMap stx
  | "by_cases" | "split" =>
    (stx.getArgs.reverse.filterMap fun a =>
      match a with | .atom .. => none | _ => srcOf fileMap a)[0]?
  | "match" =>
    -- The scrutinee, not the alternatives: the FIRST thing that is not a
    -- keyword.
    (stx.getArgs.filterMap fun a =>
      match a with | .atom .. => none | _ => srcOf fileMap a)[0]?
  | _ => none

/-- One branching step, decoded. -/
private def decode (fileMap : FileMap) (ctx : ContextInfo) (ti : TacticInfo)
    (form : String) (prod : Array Produced) : IO (Array BranchArm × Bool) := do
  let stx := ti.stx
  let alts := ptNodes ``Lean.Parser.Tactic.inductionAlts stx
  let withAlts := !alts.isEmpty
  match form with
  | "induction" | "cases" =>
    let lhss := alts.foldl (init := #[]) fun acc a =>
      acc ++ ptNodesHere ``Lean.Parser.Tactic.inductionAltLHS a
    if !lhss.isEmpty then
      let arms := lhss.map fun l =>
        let (tag, binders) := altTagBinders l
        ({ tag, binders } : BranchArm)
      return (arms, withAlts)
    -- No `with`: the constructors of the discriminant's own type.
    let target :=
      (ptNodesHere ``Lean.Parser.Tactic.elimTarget stx).findSome? fun t =>
        t.getArgs.findSome? fun a => match a with
          | .ident _ _ n _ => some n
          | _ => none
    let tags ← match target with
      | some t => ctorTagsOf ctx ti t
      | none   => pure #[]
    return (tags.map fun t => { tag := t }, withAlts)
  | "rcases" | "obtain" =>
    let meds := ptNodesHere ``Lean.Parser.Tactic.rcasesPatMed stx
    match meds[0]? with
    | some m => return (rcasesArms fileMap m prod.size, withAlts)
    | none   => return (#[], withAlts)
  | "rintro" =>
    let pats := ptNodesHere ``Lean.Parser.Tactic.rintroPat.one stx
    let split := pats.findSome? fun p =>
      let a := rcasesArms fileMap p prod.size
      if a.size > 1 then some a else none
    match split with
    | some a => return (a, withAlts)
    | none =>
      let binders := pats.foldl (init := #[]) fun acc p => acc ++ patBinders p
      let pattern := String.intercalate " " <|
        (pats.filterMap (srcOf fileMap ·)).toList
      if binders.isEmpty && pattern.isEmpty then return (#[], withAlts)
      return (#[{ binders, pattern := if pattern.isEmpty then none else some pattern }],
              withAlts)
  | "by_cases" =>
    let h := stx.getArgs.findSome? fun a =>
      a.getArgs.findSome? fun c => match c with
        | .ident _ _ n _ => some n.toString
        | _ => none
    let b := match h with | some n => #[n] | none => #["h"]
    return (#[{ tag := "pos", binders := b }, { tag := "neg", binders := b }],
            withAlts)
  | "constructor" =>
    let fields ← structFieldsOf ctx ti
    return (fields.map fun f => { tag := f }, withAlts)
  | "refine" =>
    let holes := holeNames stx
    if holes.isEmpty then return (#[], withAlts)
    let arms : Array BranchArm := holes.map fun h => { tag := h }
    -- `refine ⟨?foo, ?foo⟩` writes one goal twice; a named tag names one arm.
    let arms := arms.foldl (init := (#[] : Array BranchArm)) fun acc a =>
      if !a.tag.isEmpty && acc.any (·.tag == a.tag) then acc else acc.push a
    return (arms, withAlts)
  | _ => return (#[], withAlts)
  where _unused := prod

/-- B5 — the branching structure of every step that has one. -/
def branches (fileMap : FileMap) (tree : InfoTree)
    (steps : List Paperproof.Services.ProofStep) : IO (Array BranchInfo) := do
  if steps.isEmpty then return #[]
  let tacticInfos := tree.foldInfo (init := (#[] : Array (ContextInfo × TacticInfo)))
    fun ctx info acc => match info with
      | .ofTacticInfo ti => acc.push (ctx, ti)
      | _ => acc
  let key (p : Lsp.Position) : String := s!"{p.line}:{p.character}"
  let mut seen : Std.HashSet String := {}
  let mut out : Array BranchInfo := #[]
  for (ctx, ti) in tacticInfos do
    let some form := branchForm ti.stx.getKind | continue
    -- `have h : P := by …`, `by_contra`, `exfalso` all EXPAND to `refine`, and
    -- the expansion inherits the original's source range, so a kind test alone
    -- would give a `have` a branch it never wrote.  Only original syntax
    -- counts (the same guard `constIdentNodes` uses).
    let .original .. := ti.stx.getHeadInfo | continue
    let some r := ti.stx.getRange? | continue
    let start := fileMap.utf8PosToLspPos r.start
    let stop := fileMap.utf8PosToLspPos r.stop
    if form == "rewrite" then
      -- `rw [a, b]` is harvested as one step PER RULE, each with its own
      -- position inside the `rw`, so the fact rides every step the syntax
      -- covers rather than only the one that starts where it does.
      for s in steps do
        if (compare start s.position.start).isLE
            && (compare s.position.start stop).isLE then
          let k := key s.position.start
          unless seen.contains k do
            seen := seen.insert k
            out := out.push { stepStart := s.position.start, form }
      continue
    let k := key start
    if seen.contains k then continue
    let hosts := steps.filter fun s =>
      s.position.start.line == start.line
        && s.position.start.character == start.character
    let some host := hosts.head? | continue
    seen := seen.insert k
    let prod := producedOf host
    let (arms, withAlts) ← decode fileMap ctx ti form prod
    out := out.push {
      stepStart := start
      form
      «on» := discriminant fileMap form ti.stx
      withAlts
      arms := resolveArms arms prod }
  return out.qsort fun a b => (compare a.stepStart b.stepStart).isLT

end ProofTree

/-! ## Use counts for `have`/`obtain`-introduced hypotheses (D1)

The input the two restructuring moves need, and the only new datum D1 asks
for. B2's `hypOrigins` already says which step first bound each `fvarId`;
Paperproof's own `tacticDependsOn` already says which ids a step read. Put the
two together and you have, for every hypothesis an author NAMED, the list of
steps that use it — which is what makes "this `have` is used exactly once"
a fact of the elaboration rather than a guess from the text.

Restricted to a NAMED-BINDER list on purpose (`ALLOWED_INTRODUCERS`). Every
origin has a use list, but `by_cases`/`rintro`/`rcases` bind a PATTERN — a
name the reader cannot point at as one token in the source — and emitting all
390 of the corpus's origins would triple the sidecar for data nothing reads.
The head word is taken from the introducing step's own `tacticString`.

D3/D5 (2026-09-09) added the INTRO FAMILY to that list — `intro`, `intros`,
`by_contra` (and so `by_contra!`, whose head word stops at the `!`). What they
bind is still the shape of the proof rather than a lemma stated in passing, so
no move offers to INLINE one; but the redirection analysis needs to know
whether a `by_contra` binder is read anywhere but the closing step, and the
rename move needs the use list of any hypothesis the author NAMED, whichever
tactic named it. One list, two readers.

A hypothesis with an EMPTY `users` array is emitted too: a `have` nothing uses
is exactly the finding a reader wants (Mathlib's `unusedHaveSuffices` linter
asks the same question), and silence there would be indistinguishable from
"not computed".

Note what this is NOT: a syntactic occurrence count. `omega` closes a goal
from the context and depends on `hle1` without ever naming it, so `hle1` has
one USER and zero syntactic occurrences — which is exactly why `rewrite.ts`
requires BOTH before it offers an inline.
-/
namespace ProofTree

structure HaveUse where

  /-- The introducing step's `position.start` — the sidecar key every other
  per-step sidecar uses. -/
  stepStart : Lsp.Position

  /-- The hypothesis as the author named it. -/
  name : String

  /-- The `position.start` of every step whose `tacticDependsOn` holds this
  hypothesis's id, in source order. -/
  users : Array Lsp.Position
  deriving ToJson, FromJson, Inhabited

/-- The introducing tactics whose binders get a use list. `have`/`obtain` are
D1's (a fact stated in passing, which the inline move can move); the intro
family is D3's and D5's (the shape of the proof, which nothing inlines, but
whose binder the reader can rename and whose uses the redirection analysis
counts). A head word is alphabetic, so `by_contra!` arrives here as
`by_contra`. -/
def ALLOWED_INTRODUCERS : Array String :=
  #["have", "obtain", "intro", "intros", "by_contra"]

private def headWordOf (s : String) : String :=
  ((s.dropWhile fun c => c == ' ' || c == '\n' || c == '\t').takeWhile
    fun c => c.isAlpha || c == '_').toString

def haveUses (steps : List Paperproof.Services.ProofStep) : Array HaveUse :=
  Id.run do
    let ordered := steps.toArray.qsort fun a b =>
      (compare a.position.start b.position.start).isLT
    let mut heads : Std.HashMap (Nat × Nat) String := {}
    for s in ordered do
      let k := (s.position.start.line, s.position.start.character)
      unless heads.contains k do
        heads := heads.insert k (headWordOf s.tacticString)
    let mut out : Array HaveUse := #[]
    for o in hypOrigins steps do
      let k := (o.start.line, o.start.character)
      let some head := heads.get? k | continue
      unless ALLOWED_INTRODUCERS.contains head do continue
      let mut users : Array Lsp.Position := #[]
      for s in ordered do
        if (compare s.position.start o.start).isGT
            && s.tacticDependsOn.contains o.id then
          users := users.push s.position.start
      out := out.push { stepStart := o.start, name := o.username, users }
    return out

end ProofTree
