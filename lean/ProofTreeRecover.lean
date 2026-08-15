import Lean
import Services.BetterParser
import ProofTreeComments

/-!
# ProofTreeRecover — the supplemental parser

Recovers what Paperproof's `BetterParser_Tree` structurally cannot see. The
vendored parser is goal-identity-keyed and bottom-up: the only relation it can
express is "this mvar became those mvars" inside one `TacticInfo`, and a
FAILED tactic has no `TacticInfo` at all — `evalTactic`'s error handler does
`s.restore (restoreInfo := true)`, rolling the failed attempt's info subtree
back. A failed tactic is therefore not "a step with an error"; it is an
absence, and (measured) the absence is not even locally detectable: the failed
goal may be `sorryAx`-assigned afterwards, so the enclosing step's
`goalsAfter` looks proved.

The SYNTAX survives what the info tree loses. `tacticSlots` (ProofTreeComments)
already finds every tactic as the author wrote it, failed or not, and the raw
`TacticInfo.goalsBefore/goalsAfter` lists still carry the goals a failure
orphaned — BetterParser filters them out via `getUnassignedGoals`, but they
are printable. This module joins the two and emits RESULT-SHAPED data —
real `ProofStep`s and `GoalInfo`s merged into the parse result the moment
`BetterParser_Tree` returns (the `withRwLocation` precedent, on both wires) —
so `stepByGoal`, layout, folding, comments, brief, elide, token colouring and
editing all work downstream with no new client machinery.

This is the one module allowed to import Paperproof's types.
`ProofTreeComments` deliberately stays `import Lean` only; never fork the
vendored parser — the standing rule. Everything here is additive.

Three facts below were settled by probing the real fixtures
(`ProofTreeErrors.lean`), not reasoned about:

- **Uncovered ≠ failed.** `skip` records no step either — `getGoalsChange`
  cancels a no-op's goals as common — so a slot with no step is only FAILED if
  an ERROR from the message log lands inside it. Slots after the failure in
  the same block are SKIPPED (the sequence aborted; Lean never ran them), and
  a no-op with no error near it is simply not recovered.
- **The orphaned goal is findable two ways.** If the failing tactic attacked a
  goal some step PRODUCED, it is pending and the client already draws it —
  rule (a), nearest producer above. If the failure orphaned a goal the harvest
  never saw (an `induction` branch's case goal, a `have`'s side goal whose
  `by` failed — both measured absent), it still sits in some `TacticInfo`'s
  RAW goal lists, unconsumed and unproduced — rule (b) prints it with the
  vendored `printGoalInfo` (public) and GRAFTS it into the `spawnedGoals` of
  the step containing the slot, so it draws as a branch of the `induction` or
  `have` rather than as a disconnected root. With no containing step at all
  (a proof whose ONLY tactic failed — zero steps today, tree vanishes) the
  goal becomes the root, which it is.
- **A broken `calc` is excluded**: that state already has its own synthesized
  node and repair chip, keyed on the chain's own start.
-/

open Lean Elab Paperproof.Services

namespace ProofTree.Recover

/-- The sidecar: which steps in the merged result were synthesized here, and
why. `ProofStep` has derived `ToJson` upstream and cannot grow a field, so
synthetic-ness is keyed by `position.start` — the `stepStart` precedent. -/
structure RecoveredStep where
  start : Lsp.Position
  /-- `"failed"` — an error landed inside this tactic; `"skipped"` — it sits
  after a failure in its block, so Lean never ran it; `"term"` — synthesized
  from a TERM rather than from a tactic (a term-mode proof's structure, or a
  `calc` link justified by a term). Only the first two draw as broken; a term
  is a complete proof of what it stands for. -/
  kind : String
  deriving ToJson, FromJson, Inhabited

/-- What a recovery pass wants merged into the vendored parser's `Result`. -/
structure Recovery where
  steps     : List ProofStep := []
  /-- Goals the harvest never saw (printed here) plus the ghosts chaining a
  skipped run. Joined into `allGoals`. -/
  goals     : List GoalInfo := []
  /-- Graft `GoalInfo` into the `spawnedGoals` of the step starting at the
  position — what hangs an orphaned branch goal under its `induction`/`have`
  instead of letting it become a second root. SEVERAL grafts may share one
  position (a `calc` with two term-justified links), and all of them land. -/
  grafts    : List (Lsp.Position × GoalInfo) := []
  recovered : Array RecoveredStep := #[]

def Recovery.isEmpty (r : Recovery) : Bool := r.steps.isEmpty

/-- Merge a recovery into the parse result. Runs BEFORE anything reads the
result, so every downstream pass (rw-location remap excepted — recovered
labels never start `rw [`) treats recovered steps as ordinary ones. -/
def Recovery.apply (rc : Recovery) (r : Result) : Result :=
  let steps := r.steps.map fun s =>
    -- EVERY graft for this position, not the first: a chain with two
    -- term-justified links grafts two goals onto the one `calc` step, and a
    -- `find?` here silently drew only one of them.
    match rc.grafts.filterMap
        (fun (p, g) => if p == s.position.start then some g else none) with
    | [] => s
    | gs => { s with spawnedGoals := s.spawnedGoals ++ gs }
  { steps := steps ++ rc.steps
    allGoals := rc.goals.foldl (·.insert ·) r.allGoals }

/-- A synthesized goal's id. Position-derived — view identity keys on SOURCE
facts, never on anything elaboration mints — and spelled with underscores
because `Name.mkSimple "goal:12:2"` serializes with guillemets («goal:12:2»),
measured, while this form rides the wire verbatim. Collision-free against real
mvarIds (`_uniq.N`), the client's `tactic:` prefix, `calc:<l>:<c>` synthetic
ids and elide markers. -/
def syntheticGoalId (p : Lsp.Position) : MVarId :=
  ⟨Name.mkSimple s!"goal_{p.line}_{p.character}"⟩

private def posLE (a b : Lsp.Position) : Bool := (compare a b).isLE

/-- Half-open `[start, stop)` — the standing convention. -/
private def containsPos (start stop p : Lsp.Position) : Bool :=
  posLE start p && !posLE stop p

/-- One raw goal fact: where the goal FIRST appears in the info tree (the
context that can print it) and the position of that node — the anchor the
nearest-above rule measures from. -/
private structure RawGoal where
  mvarId : MVarId
  ctx    : ContextInfo
  ti     : TacticInfo
  anchor : Lsp.Position

/-- Every distinct goal mvar in the tree's raw `TacticInfo` lists, first
appearance wins (the `goalContexts` recipe — its `mctxAfter` is the print
context). BetterParser only ever sees these AFTER `getUnassignedGoals`
filtering; the raw lists are what still hold the goals a failure orphaned. -/
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

/--
Synthesize steps for tactics the parser lost to failure.

A slot is COVERED iff some step's START falls inside it (half-open). Step
starts, not range containment: a split `rw` step starts at the rule, a merged
`intro` at the head, the synthetic closing `rfl` at the bare `]` — all inside
their slot — while nested steps start inside the structured slot that owns
them, which its own step covers.

`errorPositions` gates FAILED classification (see the module doc: uncovered
alone also matches no-ops like `skip`). Both wires have a message log to feed
this from.
-/
def recoverFailed (fileMap : FileMap) (tree : InfoTree)
    (steps : List ProofStep) (slots : Array TacticSlot)
    (calcChains : Array CalcChain) (errorPositions : Array Lsp.Position) :
    IO Recovery := do
  let src := fileMap.source
  -- Uncovered slots, outermost-uncovered only (a failure inside a structured
  -- tactic that ALSO lost its own step should draw once, as the whole tactic).
  let uncovered := slots.filter fun sl =>
    !steps.any fun st => containsPos sl.start sl.stop st.position.start
  let outer := uncovered.filter fun sl =>
    !uncovered.any fun o =>
      (o.start != sl.start || o.stop != sl.stop) &&
      posLE o.start sl.start && posLE sl.stop o.stop
  -- A broken calc's slot belongs to the repair machinery, which already
  -- synthesizes a node for it; recovering it too would double-draw.
  let outer := outer.filter fun sl =>
    !calcChains.any fun c => c.broken && c.tacticStart == sl.start
  if outer.isEmpty then return {}
  -- Pending goals: produced by some step, consumed by none — the client's
  -- frontier rule (`goalsAfter`/`spawnedGoals`, and the GoalInfo object is the
  -- producer's own print, so nothing is re-printed). Anchored at the producer.
  let consumed : Std.HashSet String :=
    steps.foldl (fun a s => a.insert s.goalBefore.id.name.toString) {}
  let mut pending : Array (Lsp.Position × GoalInfo) := #[]
  for st in steps do
    for g in st.goalsAfter ++ st.spawnedGoals do
      unless consumed.contains g.id.name.toString do
        pending := pending.push (st.position.start, g)
  -- Invisible goals: in the raw lists, neither consumed nor produced by any
  -- step — exactly what a failure orphans.
  let producedOrConsumed : Std.HashSet String := steps.foldl
    (fun a s =>
      let a := a.insert s.goalBefore.id.name.toString
      (s.goalsAfter ++ s.spawnedGoals).foldl
        (fun a g => a.insert g.id.name.toString) a)
    {}
  let invisible := (rawGoals fileMap tree).filter fun rg =>
    !producedOrConsumed.contains rg.mvarId.name.toString
  -- Per block (keyed by blockStart), in slot order: the first uncovered slot
  -- holding an ERROR is the failure; everything uncovered after it in the
  -- block never ran.
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
    -- The goal the failure was attacking: pending nearest above, else an
    -- invisible raw goal nearest at-or-above (by LINE — an anchor routinely
    -- sits left of the slot on the same line), printed and grafted.
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
            -- Graft into the step CONTAINING the slot, so the orphaned branch
            -- hangs off its induction/have; no container means the failure
            -- took the whole proof, and root is the truth. Containment is
            -- tested against SLOTS, not step ranges — a `induction … with`
            -- STEP's range is truncated at its first case marker (the
            -- documented Paperproof trap), so the step never contains a slot
            -- inside its own branches; the slot carries the true extent.
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
    -- Chain the run: each step consumes the previous ghost; the failed tactic
    -- changed nothing, so a ghost restates its predecessor's goal — which is
    -- exactly what a restated box should say. The LAST step produces nothing.
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

/-! ## Part B — term-mode proofs

A proof written as a TERM (`:= term`, no top-level `by`) produces no
`TacticInfo` at all, so the vendored parser returns nothing and both wires
used to drop it. But the structure is right there in the syntax, and
`TermInfo` carries an `expectedType?` and an `lctx` at every node — measured
over the fixture corpus: populated on every construct the v1 vocabulary
keys on (`have`/`let` bodies and sides, `fun` bodies, `calc`, `match`).

The v1 vocabulary maps term structure onto the SAME step shape the tactic
side uses, so the client needs nothing new:

- `have` → a have-like step: the binding's proof is a spawned side goal, the
  continuation is `goalsAfter` — the tactic-`have` shape exactly.
- `let`  → like `have` but no side goal (a value is data, not a proof).
- `fun`  → an intro-like step.
- a nested `by` block → NO synthesized goal: its REAL root `GoalInfo` (the
  `TacticInfo` whose stx is the `byTactic` node) stands in, so BetterParser's
  own harvested chain hangs under it through `stepByGoal` — an exact mvarId
  join, the `CalcHole` precedent.
- `calc` / `match` / anything else → a leaf step, with any nested `by`
  blocks' root goals attached as `spawnedGoals` (which is what makes
  `⟨by simp, rfl⟩` graft its tactic chain without decomposing the ctor).

Ids are position-derived (`syntheticGoalId`), never invented mvar names —
the source-facts rule. `suffices` and application spines are recorded
non-goals for v1: they degrade to leaves, which is honest if coarse.
-/

/-- The command's syntax from a CLI InfoTree — the widget passes `snap.stx`
directly; the CLI recovers it from `CommandInfo` (measured present). -/
def commandStx? (tree : InfoTree) : Option Syntax :=
  tree.foldInfo (init := none) fun _ info acc =>
    match acc, info with
    | none, .ofCommandInfo ci => some ci.stx
    | acc, _ => acc

private def isTheoremLike (cmdStx : Syntax) : Bool :=
  !(nodesOfKind [``Parser.Command.theorem, ``Parser.Command.example] cmdStx).isEmpty

/-- The declaration's body term (`:= term`), if that is its shape. -/
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

/-- Print a synthesized goal: type + hypotheses from a `TermInfo`'s own
`lctx`. A ~15-line re-derivation of the vendored `printGoalInfo`'s loop,
justified because that keys on an mvar DECL, which a term node does not
have — it has `lctx + expectedType?` and nothing else. -/
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

/-- The REAL root goal of a `by` block, as the harvest printed it when a step
consumes it (so the mvarId join closes), else printed here. -/
private def byRootGoal (w : TermWalk) (byStx : Syntax) : IO (Option GoalInfo) := do
  let some (b, e) := byteRange? byStx | return none
  let hit := w.tacticInfos.find? fun (_, ti) =>
    match byteRange? ti.stx with
    | some (b', e') => b' ≥ b && e' ≤ e && !ti.goalsBefore.isEmpty
    | none => false
  let some (cctx, ti) := hit | return none
  let some g := ti.goalsBefore.head? | return none
  -- Prefer the harvested print: byte-identical id, no second printing.
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

/-- Verbatim slice `[b, bodyStart)`, trailing trivia trimmed — a step's label
and tight position, the alignInLabel-identity property again. -/
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
  -- The goal standing for a SUBTERM: a `by` block's real root (harvested
  -- chain joins by mvarId), else a synthesized goal from the subterm's own
  -- TermInfo, else nothing (the caller degrades to a leaf).
  let subGoal (sub : Syntax) (fallbackTy : Option GoalInfo) :
      IO (Option (GoalInfo × Bool)) := do  -- (goal, needsRecursion)
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
  -- A leaf: the whole term is one step; nested `by` blocks spawn their real
  -- root goals so harvested chains still hang somewhere.
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
    -- The side term: the decl's last argument, when it has the `x : T := e`
    -- shape; anything else (eqns, patterns) degrades to leaf. The decl child
    -- is found BY KIND, never by index — measured on v4.27, `have`'s args are
    -- `[kw, letConfig, letDecl, optSemicolon, body]`, so the obvious `stx[1]`
    -- lands on the config node (the same index-is-not-a-contract rule as
    -- `collectRwLocations`).
    -- On v4.27 `have` reuses the LET decl kinds (measured: its decl child is
    -- a `letDecl` holding a `letIdDecl`); there is no separate haveDecl.
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
    -- Should not arrive here (subGoal short-circuits it), but a top-level
    -- `by` body is Part A's territory anyway.
    return {}
  else
    leaf

/--
Part B: synthesize a proof tree for a TERM-MODE proof.

Gated on the command being a `theorem`/`example` (a `def`'s body must not grow
a fake proof tree) whose body is NOT a `by` block (that shape is Part A's,
disambiguated purely by syntax kind). NOT gated on `steps.isEmpty`: a term
proof with nested `by` blocks harvests steps today — rooted nowhere — and the
walk is what gives them a root to hang under.
-/
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

/-! ## Part C — the OPEN block

`theorem foo : P := by` with nothing written after the `by`. The state every
proof starts in, and the one where the tree has most to say — yet it used to
draw nothing at all, then (once the counterfactual existed) a dashed stub
labelled with the THEOREM LINE, which is neither a tactic nor editable.

Three facts, all measured (see the module doc for the house style):

* **It PARSES.** The block is a well-formed `byTactic` whose
  `tacticSeq1Indented` holds an EMPTY sepArray — not `Syntax.missing`, not a
  parse error. Lean elaborates the declaration and reports one honest
  `unsolved goals` on the `by`.
* **The goal is already in the info tree**, as `goalsBefore` of the `byTactic`
  node's own `TacticInfo` (`before=1 after=1`, measured on v4.32.2). So this
  needs no re-elaboration of anything — it is a read of the tree the request
  already walked, which is why the counterfactual is DECLINED here (see
  `cfWanted`): the goal cost 0ms where the counterfactual cost ~830ms.
* **`tacticSlots` is EMPTY for exactly this shape, and non-empty the moment a
  character is typed** — `by c` and `by ri` both record one slot (an
  `unknown tactic` still occupies its slot). That is the whole gate, and it is
  what keeps the counterfactual alive for the case it exists for: a first
  tactic being typed is NOT an open block.

No STEP is synthesized, deliberately — a step is a box, and a box standing for
the tactic nobody has written yet is the vestigial stub this replaces. What
ships is the GOAL and where a first tactic goes, so the client draws one
pending goal with its ordinary `+`/`sorry`/`calc` chips: the same frontier
shape a `constructor`'s two branches get, which is the point.
-/

/-- An empty `by` block: the goal it owes, and where a first tactic is written.

`anchor` is the END of the `by` token; the client inserts at the end of THAT
line, which is the ordinary insertion rule (so a trailing comment on the `by`
line stays glued to it, as everywhere else). It is shipped rather than derived
from `declRange` because it drives a WRITE: `declRange.stop` happens to equal
it while the block is empty, and a client re-deriving that coincidence would be
guessing at the one place a guess edits the buffer — the `cfStubPos` rule. -/
structure OpenBlock where
  /-- The block's root goal — the real `GoalInfo`, printed by the vendored
  `printGoalInfo` with a real mvarId, so it indexes and renders like any
  other goal. -/
  goal   : GoalInfo
  /-- End of the `by` token. -/
  anchor : Lsp.Position
  /-- Column a first tactic takes: the declaration's own indent + 2. -/
  indent : Nat
  deriving ToJson, FromJson

/-- Part C: the declaration's `by` block, when the author has written no tactic
into it.

Gated on a `theorem`/`example` whose body IS a `byTactic` (Part B owns the
term-mode shape, disambiguated purely by syntax kind, and the two gates are
complements so they cannot both fire) with NO tactic slot anywhere in the
command. Slots rather than `steps.isEmpty`: a proof whose only tactic FAILED
also harvests zero steps, and that is Part A's territory — it has a slot. -/
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
  -- The `byTactic`'s own `TacticInfo` — the innermost one is the empty
  -- sequence, but every one of the four in this shape carries the same single
  -- `goalsBefore`, so the first with a goal is the answer.
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

/-! ## Part D — a `calc` link justified by a TERM

`_ = (c+b)+a := Nat.add_comm a (c+b)` is a link like any other to read and an
ABSENCE to the harvest: the vendored parser can only see what a `TacticInfo`
records, and a term justification elaborates no tactic at all. So the link's
relation is drawn nowhere, its proof is drawn nowhere, and a four-link chain
comes back with three spawned goals — measured on the fixture, and independent
of where the link sits (the first link is no different from the third).

The goal IS reachable and needs no re-elaboration: the justification term has
a `TermInfo` whose `expectedType?` is exactly the link's relation, with the
link's own `lctx` beside it. That is the seam Part B already prints goals
through (`synthGoal`), and it is EXACT — matched to the justification by
SYNTAX RANGE, never by position-nearest or by mvar, so a nested chain cannot
claim an outer link's proof. Measured on `proofs/calc.lean`'s term-justified
link: `⊢ ∑ i ∈ Finset.range (k+1+1), (2*i+1) = ∑ i ∈ Finset.range (k+1), (2*i+1)
+ (2*(k+1)+1)`, which is the relation the source writes.

So the link gets what every other proof step gets — a goal box, and one node
under it whose label is the VERBATIM justification (label ≡ source, so
`alignInLabel` is an identity and the token colouring lands). The shape is
exactly a `by`-justified link's: the goal grafts into the `calc` step's
`spawnedGoals`, the node consumes it and produces nothing.

Two gates, both conservative:

* **The block must not be BROKEN.** That state has its own synthesized node
  and repair chip keyed on the chain's own start — the standing exclusion.
* **No harvested step may START inside the justification.** This is the
  completeness witness, not a syntax test on `byTactic`: it stands down
  wherever the tree already draws something, so `:= by tac` is skipped for the
  reason it should be (a step is there) and a term with a nested `by` inside it
  is skipped too rather than drawing a second node over the same source.
-/

/-- The hypotheses a justification term MENTIONS, in Paperproof's own coding:
the fvars of the instantiated proof term, restricted to the local context.

`findHypsUsedByTactic` cannot be reused — it reads the mvar ASSIGNMENT, and a
term justification assigns no metavariable — but the expression it would have
instantiated is `TermInfo.expr` itself, so the rest of the recipe is verbatim.
Without it the link's goal box would be empty under the DEFAULT `used`
breadth, which is the one mode most readers ever see. -/
private def termDeps (cctx : ContextInfo) (ti : TermInfo) : IO (List String) :=
  cctx.runMetaM ti.lctx do
    try
      let full ← instantiateMVars ti.expr
      let ids := (collectFVars {} full).fvarIds
      return (ids.filterMap ti.lctx.find?).map (·.fvarId.name.toString) |>.toList
    catch _ => return []

/-- Part D: one step per `calc` link the harvest left undrawn.

`steps` is the harvest as it stands (the vendored parser's, label fix-ups
applied); `extra` is the widget's `snap.stx`, threaded through to `calcBlocks`
for the same reason every other collector takes it. -/
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
    -- The step the chain hangs off: the INNERMOST harvested step containing
    -- the `calc` keyword. Containment rather than an exact start match,
    -- because a chain that is the only tactic of a bullet is recorded under
    -- the bullet's own range (`· calc a ≤ b`) — the same reason the client's
    -- `brokenChainByGoal` looks the owner up this way.
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
      -- A HOLE justification (`?_`, or a named `?foo`) is not an undrawn link:
      -- the hole's goal is PENDING, so the client already draws it as a goal
      -- box carrying the fill and grow-a-link chips. The completeness witness
      -- below cannot see that — it tests harvested STEPS, and a hole is proved
      -- by none — so without this gate the link is drawn TWICE, once as the
      -- pending goal and once as a term-recovered copy of it. `?_` and a named
      -- `?foo` are the same syntax kind, which is the same one test
      -- `ProofTree.collectHoles` collects on: keep the two pointing at each
      -- other.
      if just.isOfKind ``Lean.Parser.Term.syntheticHole then continue
      let some jr := just.getRange? (canonicalOnly := true) | continue
      let jStart := fileMap.utf8PosToLspPos jr.start
      let jStop := fileMap.utf8PosToLspPos jr.stop
      -- The tree already draws this link (see the gates above).
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
      -- Verbatim, trailing trivia trimmed — the label ≡ source property the
      -- whole recovery parser keeps (`sliceStep`).
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
