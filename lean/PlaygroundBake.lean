import Lean
import ProofTreeHarvest
/-!
# PlaygroundBake — the baked playground's table, computed by real Lean

A static page (`site/playground.html`) lets a visitor type a tactic under any
open goal of a small core-Lean theorem and watch the tree grow, with NO Lean
server: every `(goal, tactic)` answer is computed HERE, once, and shipped as
JSON (`playgroundVersion: 1`). See `docs/viewer.md` ("The playground") and
`docs/playground-spike.md` (the spike this productionises).

    lake exe playgroundbake OUT.json demos/playground/ZeroAdd.lean

The input is a real Lean file (core only — it must elaborate with no imports):
a `/-! # Title … -/` block (the page's title and blurb, read by
`publish.mjs`), any helper `def`s, ONE `theorem` with a worked solution, and
directive comments:

    -- @try <tactic>    another candidate on every goal (a route or a mistake)
    -- @depth <n>       the depth cap (default 4); `intro` steps do not count

The baker elaborates the file, takes the theorem's TYPE as the root goal and
runs a breadth-first search: for each new goal, every candidate is run from
that goal's saved state; the outcome is the goals it leaves (each interned and
enqueued) or Lean's first error. The unit is ONE goal — the tree's own unit,
Paperproof's `goalBefore → tactic → goalsAfter`.

**Canonical naming** (the spike's finding: free naming multiplies the states
by up to 30×). Exactly ONE spelling per binder is baked: `intro` names each
binder as the statement does (an anonymous arrow's binder is `h`, made unused
with Lean's own `getUnusedName`: `h`, `h_1`, …), so the name depends only on the
context and every path to a state names it alike; `rename_i` names an
inaccessible `x✝` as `x`, and an inaccessible `a✝` proof (an induction
hypothesis) as `ih`. The CLIENT maps the visitor's own names onto these
(`web/src/playgroundAnswer.ts`): any identifier a step INTRODUCES may be
spelled differently, and the tree shows the visitor's spelling.

**Candidates** per goal: the canonical `intro`s (every prefix of the binder
telescope, up to six), `rename_i` (every suffix of the inaccessibles, up to
three), per-hypothesis moves (`exact h`, `apply h`, `cases h`, `simp at h`,
`rw [h]`, `rw [← h]`, `induction x`/`cases x` on a `Nat`/`List`), a fixed
core list (`simp omega rfl decide constructor left right …`, including the
mistakes a learner makes), the file's `@try` lines and the solution's own
tactics (read off its syntax by KIND).

**Hovers** go through the REAL harvest: each goal is `Widget.goalToInteractive`
and then `ProofTree.bakeGoal` (ProofTreeHarvest.lean — the function the
static viewer's CLI wire calls), interning every popup in one table per
theorem. One harvest, both wires, never a copy.
-/

open Lean Elab Meta Term

namespace Playground

/-- Every goal is tried against these, plus what the goal and the file add.
Three are deliberate mistakes a learner makes (`exact rfl` on a goal that is
not a reflexivity, `exfalso` too early, `contradiction` with nothing to
contradict); Lean's own error is what the page shows for them. -/
def coreCandidates : Array String := #[
  "simp", "simp_all", "omega", "rfl", "decide", "constructor", "left", "right",
  "assumption", "contradiction", "trivial", "exfalso", "exact rfl"
]

/-- An `intro`-family step: free under the depth cap. -/
def isIntro (tac : String) : Bool := tac == "intro" || tac.startsWith "intro "

structure GoalRec where
  id     : Nat
  depth  : Nat
  tagged : Json
  /-- `"proof" | "data" | "universe"` per hypothesis NAME, in order (the
  grouped print's names flattened), as Paperproof's `mayBeProof` says. -/
  kinds  : Array String
  /-- Not expanded: the cap was reached here, or only a PROBE step reached it. -/
  frontier : Bool := true
  queued   : Bool := false
  deriving Inhabited

inductive Outcome where
  | goals (ids : Array Nat) (uses : Array String)
  | error (msg : String)

structure Bake where
  goals   : Array GoalRec := #[]
  keyIdx  : Std.HashMap String Nat := {}
  steps   : Array (Nat × String × Outcome) := #[]
  /-- Goals whose tagged print disagreed with Paperproof's plain print. -/
  printMismatch : Nat := 0

/-- The infoview's own print of a goal (`ppGoal`: grouping, `n✝`, the case
tag) — the state's KEY. -/
def ppKey (g : MVarId) : MetaM String := return toString (← ppGoal g)

def hasSorryOrMVar (g : MVarId) : MetaM Bool := g.withContext do
  let t ← instantiateMVars (← g.getType)
  if t.hasSorry || t.hasExprMVar then return true
  for d in ← getLCtx do
    if d.isImplementationDetail then continue
    let ty ← instantiateMVars d.type
    if ty.hasSorry || ty.hasExprMVar then return true
  return false

/-- Lean's own name for an unused binder: the statement's, else `h` for a
proof and `x` for data, made unused against the context AND the names picked
before it (so `intro a b` and `intro a; intro b` name alike). -/
def pickName (lctx : LocalContext) (taken : Array Name) (n : Name) (isProp : Bool) : Name :=
  let base := if n.isAnonymous || n.hasMacroScopes then (if isProp then `h else `x)
    else n.eraseMacroScopes
  let lctx := taken.foldl (fun l t => l.mkLocalDecl ⟨t⟩ t (mkConst ``True)) lctx
  lctx.getUnusedName base

/-- The canonical `intro`s: every prefix (≤ 6) of the binder telescope. -/
def canonicalIntros (g : MVarId) : MetaM (Array String) := g.withContext do
  let lctx ← getLCtx
  let t ← instantiateMVars (← g.getType)
  let names ← forallBoundedTelescope t (some 6) fun xs _ => do
    let mut taken : Array Name := #[]
    for x in xs do
      let d ← x.fvarId!.getDecl
      taken := taken.push (pickName lctx taken d.userName (← isProp d.type))
    return taken
  let mut out := #[]
  for k in [1:names.size + 1] do
    out := out.push ("intro " ++ " ".intercalate ((names.extract 0 k).toList.map toString))
  return out

/-- The canonical `rename_i`s: the inaccessibles' own base names (`n✝` → `n`,
`left✝` → `left`), an inaccessible `a✝` proof as `ih`; every suffix ≤ 3. -/
def canonicalRenames (g : MVarId) : MetaM (Array String) := g.withContext do
  let lctx ← getLCtx
  let inacc := (lctx.foldl (init := #[]) fun acc d =>
    if d.isImplementationDetail then acc
    else if d.userName.hasMacroScopes || d.userName.isInaccessibleUserName then acc.push d
    else acc)
  if inacc.isEmpty then return #[]
  let mut taken : Array Name := #[]
  for d in inacc do
    let base := d.userName.eraseMacroScopes
    let isP ← isProp d.type
    let base := if isP && base == `a then `ih else base
    -- the context WITHOUT the inaccessibles, so `n✝` may become `n`
    let free := inacc.foldl (fun l e => l.erase e.fvarId) lctx
    taken := taken.push (pickName free taken base isP)
  let mut out := #[]
  for k in [1:(min 3 taken.size) + 1] do
    let names := taken.extract (taken.size - k) taken.size
    out := out.push ("rename_i " ++ " ".intercalate (names.toList.map toString))
  return out

/-- Moves read off the goal's own hypotheses (accessible ones only). -/
def hypCandidates (g : MVarId) : MetaM (Array String) := g.withContext do
  let mut out := #[]
  for d in ← getLCtx do
    if d.isImplementationDetail || d.userName.hasMacroScopes then continue
    let n := d.userName.toString
    let ty ← whnfR (← instantiateMVars d.type)
    if ← isProp d.type then
      out := out ++ #[s!"exact {n}", s!"simp at {n}"]
      if ty.isForall then out := out.push s!"apply {n}"
      match ty.getAppFn.constName? with
      | some ``Eq | some ``Iff => out := out ++ #[s!"rw [{n}]", s!"rw [← {n}]"]
      | some ``And | some ``Or | some ``Exists | some ``False => out := out.push s!"cases {n}"
      | _ => pure ()
    else
      match ty.getAppFn.constName? with
      | some ``Nat | some ``List => out := out ++ #[s!"induction {n}", s!"cases {n}"]
      | _ => pure ()
  return out

/-- Run one tactic on one goal from the current state: the goals it leaves, or
the first error. Errors come three ways and all three are caught: a thrown
exception, a LOGGED error with recovery, and a runtime exception (heartbeats,
recursion — `tryCatchRuntimeEx`; plain `try` misses them). -/
def runOne (g : MVarId) (tstx : Syntax) : TermElabM (Except String (List MVarId)) :=
  tryCatchRuntimeEx
    (withCurrHeartbeats do
      let gs ← withoutErrToSorry <| Tactic.run g (Tactic.evalTactic tstx)
      let msgs := (← getThe Core.State).messages
      if msgs.hasErrors then
        let errs := msgs.toList.filter (fun (m : Message) => m.severity == .error)
        let txt ← match errs.head? with
          | some m => m.data.toString
          | none => pure "error"
        return Except.error txt
      return Except.ok gs)
    (fun (e : Exception) => do return Except.error (← e.toMessageData.toString))

/-- The hypotheses (by name) of `g`'s context a step USED — the step's
`tacticDependsOn`: a PROOF the term it built mentions (so `omega` reports the
facts it used), or any hypothesis the tactic's text names (so `induction n`
uses `n`). Data the term merely mentions because the goal does is not a use. -/
def usedHyps (g : MVarId) (tac : String) : MetaM (Array String) := g.withContext do
  let pf ← instantiateMVars (mkMVar g)
  let fvs := (collectFVars {} pf).fvarSet
  let words := (tac.split (fun c => !(c.isAlphanum || c == '_' || c == '\'' || c == '.'))).toList.map (·.toString)
  let mut out := #[]
  for d in ← getLCtx do
    if d.isImplementationDetail then continue
    let shown := toString (← ppExpr d.toExpr)
    if (fvs.contains d.fvarId && (← isProp d.type)) || words.contains shown then
      out := out.push shown
  return out

/-- Whitespace-normalised (runs of blanks become one space, ends trimmed), as
the client normalises what the visitor types. -/
def normTac (s : String) : String := Id.run do
  let mut out := ""
  let mut gap := false
  for c in s.toList do
    if c == ' ' || c == '\n' || c == '\t' || c == '\r' then gap := !out.isEmpty
    else
      if gap then out := out.push ' '
      gap := false
      out := out.push c
  return out

/-- The solution's tactics, read off its syntax by KIND: the items of every
tactic sequence, descending into `·` blocks; `intro`s are left to the
canonical ones. -/
partial def solutionTactics (stx : Syntax) : Array String :=
  let rec go (s : Syntax) (acc : Array String) : Array String :=
    match s with
    | .node _ k args =>
      if k == ``Lean.Parser.Tactic.tacticSeq1Indented ||
         k == ``Lean.Parser.Tactic.tacticSeqBracketed then
        -- `sepByIndent`: one null node, tactics and separators interleaved
        args.foldl (init := acc) fun acc a =>
          a.getArgs.foldl (init := acc) fun acc t =>
            if t.isAtom || t.getKind == nullKind then acc
            else if t.getKind == ``Lean.cdot then go t acc
            else match t.reprint with
              | some txt => acc.push (normTac txt)
              | none => acc
      else args.foldl (init := acc) fun acc a => go a acc
    | _ => acc
  go stx #[] |>.filter (!isIntro ·)


structure Spec where
  name     : Name
  type     : Expr
  extras   : Array String
  depth    : Nat
  solution : Array String

def bakeTheorem (spec : Spec) (hv : IO.Ref ProofTree.BakeState) :
    TermElabM (Bake × Nat × Nat) := do
  let env ← getEnv
  let root ← mkFreshExprMVar spec.type (kind := .syntheticOpaque)
  let bake ← IO.mkRef ({} : Bake)
  let mut queue : Array (Nat × MVarId × Term.SavedState) := #[]
  let intern (g : MVarId) (depth : Nat) : TermElabM (Nat × Bool) := withCurrHeartbeats do
    let key ← ppKey g
    let b ← bake.get
    if let some id := b.keyIdx[key]? then
      -- the shallowest path wins the depth, so a goal first met deep is not
      -- left unexpanded when a shorter path reaches it
      if depth < b.goals[id]!.depth then
        bake.modify fun b => { b with goals := b.goals.modify id ({ · with depth }) }
      return (id, false)
    let id := b.goals.size
    let ig ← Widget.goalToInteractive g
    -- THE harvest: the same `bakeGoal` the static viewer's CLI wire calls
    let (j, st) ← (ProofTree.bakeGoal { goalId := toString id, goal := ig }).run (← hv.get)
    hv.set st
    let tagged := j.getObjValD "goal"
    -- Paperproof's `mayBeProof` per name, and a check that the tagged print
    -- reads as the plain one would (the viewer's text-equality guard)
    let kinds ← g.withContext do
      let mut ks := #[]
      for d in ← getLCtx do
        if d.isImplementationDetail then continue
        ks := ks.push (← Paperproof.Services.mayBeProof d.toExpr)
      pure ks
    let plain ← g.withContext do pure (toString (← ppExpr (← instantiateMVars (← g.getType))))
    let mismatch := ig.type.stripTags != plain
    bake.modify fun b => { b with
      goals := b.goals.push { id, depth, tagged, kinds }
      keyIdx := b.keyIdx.insert key id
      printMismatch := b.printMismatch + (if mismatch then 1 else 0) }
    return (id, true)
  let (rid, _) ← intern root.mvarId! 0
  queue := queue.push (rid, root.mvarId!, ← saveState)
  bake.modify fun b => { b with goals := b.goals.modify rid ({ · with queued := true }) }
  -- GUIDED steps are expanded; every other candidate is a PROBE: its answer
  -- is baked (goals or error) but the goals it leaves are not explored unless
  -- a guided path reaches them too. Guided = the canonical `intro`s and
  -- `rename_i`s, the solution, the file's `@try` lines, and the three moves
  -- that pick a side of the goal.
  let guidedFixed : Std.HashSet String :=
    (spec.solution ++ spec.extras ++ #["constructor", "left", "right"]).foldl
      (fun s t => s.insert (normTac t)) {}
  let mut tried := 0
  let mut timedOut := 0
  let mut qi := 0
  while qi < queue.size do
    let some (gid, g, st) := queue[qi]? | break
    qi := qi + 1
    let depth := (← bake.get).goals[gid]!.depth
    if depth ≥ spec.depth then continue
    bake.modify fun b => { b with goals := b.goals.modify gid ({ · with frontier := false }) }
    st.restore (restoreInfo := true)
    -- each under its own budget (heartbeats are cumulative otherwise)
    let guard (m : MetaM (Array String)) : TermElabM (Array String) :=
      tryCatchRuntimeEx (withCurrHeartbeats m) (fun _ => pure #[])
    let intros ← guard (canonicalIntros g)
    let renames ← guard (canonicalRenames g)
    let hyps ← guard (hypCandidates g)
    let all := intros ++ renames ++ hyps ++ coreCandidates ++ spec.extras ++ spec.solution
    let mut seen : Std.HashSet String := {}
    let mut cands := #[]
    for c in all do
      let c := normTac c
      -- a non-canonical `intro x` would re-open the name space the rule closes
      if isIntro c && !intros.contains c then continue
      if seen.contains c then continue
      seen := seen.insert c
      cands := cands.push c
    for tac in cands do
      tried := tried + 1
      st.restore (restoreInfo := true)
      modifyThe Core.State fun s => { s with messages := {} }
      let res ← match Parser.runParserCategory env `tactic tac with
        | .error e => pure (Except.error s!"parse: {e}")
        | .ok tstx => runOne g tstx
      let outcome? ← match res with
        | .error m => do
          if (m.splitOn "heartbeats").length > 1 || (m.splitOn "recursion").length > 1 then
            timedOut := timedOut + 1
          pure (some (Outcome.error m))
        | .ok gs => do
          -- a goal that mentions another goal's metavariable (`constructor`
          -- on `∃`) is not an independent goal; such a step is not baked
          if ← gs.anyM (fun g => (hasSorryOrMVar g : MetaM Bool)) then pure none
          else
            let uses ← usedHyps g tac
            let after ← saveState
            let free := isIntro tac
            let guided := guidedFixed.contains tac || intros.contains tac || renames.contains tac
            let mut ids := #[]
            for g' in gs do
              let (id, _) ← intern g' (if free then depth else depth + 1)
              ids := ids.push id
              if guided && !(← bake.get).goals[id]!.queued then
                bake.modify fun b => { b with goals := b.goals.modify id ({ · with queued := true }) }
                queue := queue.push (id, g', after)
            pure (some (Outcome.goals ids uses))
      if let some o := outcome? then
        bake.modify fun b => { b with steps := b.steps.push (gid, tac, o) }
  return (← bake.get, tried, timedOut)

def toJsonBake (spec : Spec) (stmt : String) (b : Bake) (hv : ProofTree.BakeState) : Json :=
  let goals := b.goals.map fun g =>
    Json.mkObj ([("goal", g.tagged), ("kinds", toJson g.kinds)] ++
      (if g.frontier then [("frontier", Json.bool true)] else []))
  -- error texts are interned: most errors repeat
  let (msgs, steps) := b.steps.foldl (init := ((#[] : Array String), (#[] : Array Json)))
    fun (msgs, acc) (gid, tac, o) =>
      match o with
      | .goals ids uses =>
        (msgs, acc.push (Json.arr (#[toJson gid, toJson tac, toJson ids] ++
          (if uses.isEmpty then #[] else #[toJson uses]))))
      | .error m =>
        let (msgs, k) := match msgs.idxOf? m with
          | some k => (msgs, k)
          | none => (msgs.push m, msgs.size)
        (msgs, acc.push (Json.arr #[toJson gid, toJson tac, Json.mkObj [("e", toJson k)]]))
  Json.mkObj [("playgroundVersion", toJson (1 : Nat)),
    ("theorem", toJson spec.name.toString), ("statement", toJson stmt),
    ("depth", toJson spec.depth), ("solution", toJson spec.solution),
    ("goals", Json.arr goals), ("steps", Json.arr steps), ("errors", toJson msgs),
    ("hovers", toJson hv.popups)]

/-- The directives (`-- @try`, `-- @depth`) are comment LINES, read as text. -/
def directives (src : String) : Array String × Option Nat := Id.run do
  let mut tries := #[]
  let mut depth := none
  for line in src.splitOn "\n" do
    let l := line.trimAscii.toString
    if l.startsWith "-- @try " then tries := tries.push (l.drop 8).toString.trimAscii.toString
    else if l.startsWith "-- @depth " then depth := (l.drop 10).toString.trimAscii.toString.toNat?
  return (tries, depth)

end Playground

open Playground in
unsafe def main (args : List String) : IO UInt32 := do
  let [out, path] := args
    | IO.eprintln "usage: playgroundbake OUT.json FILE.lean"; return 2
  initSearchPath (← findSysroot)
  enableInitializersExecution
  let src ← IO.FS.readFile path
  let inputCtx := Parser.mkInputContext src path
  let (header, parserState, messages) ← Parser.parseHeader inputCtx
  let (env, messages) ← processHeader header {} messages inputCtx
  let fs ← IO.processCommands inputCtx parserState (Command.mkState env messages {})
  let cs := fs.commandState
  for m in cs.messages.toList do
    if m.severity == .error then
      IO.eprintln s!"{path}: {← m.toString}"; return 1
  -- the file's ONE theorem, and its solution's syntax
  let env := cs.env
  -- the `theorem` command (by KIND): its name and its solution's syntax
  let thmCmds := cs.infoState.trees.foldl (init := #[]) fun acc t =>
    t.foldInfo (init := acc) fun _ info acc =>
      match info with
      | .ofCommandInfo ci =>
        match ci.stx.find? (·.getKind == ``Lean.Parser.Command.theorem) with
        | some thm => if acc.any (· == thm) then acc else acc.push thm
        | none => acc
      | _ => acc
  let some thmStx := thmCmds[0]? | IO.eprintln s!"{path}: no theorem"; return 1
  if thmCmds.size > 1 then IO.eprintln s!"{path}: more than one theorem"; return 1
  let thmName := thmStx[1][0].getId
  let some (.thmInfo ti) := env.find? thmName
    | IO.eprintln s!"{path}: theorem {thmName} not found"; return 1
  let solution := match thmStx.find? (·.getKind == ``Lean.Parser.Term.byTactic) with
    | some by_ => solutionTactics by_
    | none => #[]
  let (tries, depthCap) := directives src
  let sol := solution.foldl (fun a s => if a.contains s then a else a.push s) #[]
  let spec : Spec :=
    { name := thmName, type := ti.type, extras := tries, depth := depthCap.getD 4, solution := sol }
  let t0 ← IO.monoMsNow
  let hv ← IO.mkRef ({} : ProofTree.BakeState)
  let opts : Options := maxHeartbeats.set ({} : Options) 20000
  let ctx : Core.Context := {
    fileName := path, fileMap := inputCtx.fileMap, options := opts,
    maxHeartbeats := 20000 * 1000, maxRecDepth := 4000 }
  let act : CoreM ((Bake × Nat × Nat) × String) := do
    let r ← (bakeTheorem spec hv).run' {} |>.run' {}
    let stmt ← (do return toString (← ppExpr ti.type) : MetaM String).run' {}
    return (r, stmt)
  let (((b, tried, timedOut), stmt), _) ← act.toIO ctx { env }
  let t1 ← IO.monoMsNow
  let errs := b.steps.foldl (fun n (_, _, o) => match o with | .error _ => n + 1 | _ => n) 0
  let hvs ← hv.get
  let j := (toJsonBake spec stmt b hvs).compress
  IO.FS.writeFile out j
  let frontier := b.goals.foldl (fun n g => if g.frontier then n + 1 else n) 0
  IO.println s!"{thmName}: goals={b.goals.size} frontier={frontier} steps={b.steps.size} tried={tried} errors={errs} ok={b.steps.size - errs} timeouts={timedOut} popups={hvs.popups.size} printMismatch={b.printMismatch} ms={t1 - t0} bytes={j.utf8ByteSize}"
  return 0
