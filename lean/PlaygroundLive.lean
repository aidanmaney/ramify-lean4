import Lean.Elab.Frontend
import Lean.Widget.InteractiveGoal
import ProofTreeBake
/-!
# PlaygroundLive — the playground's LIVE tier: one tactic on one goal, by real Lean

The baked playground (`PlaygroundBake.lean`) answers from a table. This module
answers what the table does not hold, in the table's own shape, so a goal it
leaves that the bake knows JOINS the baked graph (goals are named by their
KEY, the infoview's `ppGoal` print — `web/src/playgroundAnswer.ts`).

It is the ONE copy of the stepping functions: `ppKey`, `runOne`, `usedHyps`,
`normTac` and `hypKinds` are what the baker calls too, so a live answer is the
baker's answer by construction. Imports are deliberately narrow (no `import
Lean`, no Paperproof): the module is compiled to WebAssembly
(`scripts/wasm/`, docs/wasm-spike.md), where the full `Lean` import is
blocked by an unreadable `.ir` file.

Entry points:

* `ramify_live_init(leanPath)` (`@[export]`): imports `Init` once.
* `ramify_live_answer(json)` (`@[export]`): `{file, theorem, path, tactic}` →
  `{goals: [{key, goal, kinds}], uses, popups}` or `{error}`. `path` is
  `[[tactic, pick]…]` from the theorem's type — STATE, NOT TEXT: the goal is
  rebuilt by replaying the path, each step's `pick`-th goal continuing it.
  `goal` is a `BakedGoal` TAGGED as the baker's are (`ProofTreeBake`), its
  `{h: k}` indexing this answer's `popups`, which the page re-bases.

Natively, `lake exe playgroundlive LEANPATH` answers one request per stdin
line (the identity check against the bake, and a desktop dev backend).
-/

open Lean Elab Meta Term

namespace Playground

/-- The infoview's own print of a goal (`ppGoal`: grouping, `n✝`, the case
tag) — the state's KEY. -/
def ppKey (g : MVarId) : MetaM String := return toString (← ppGoal g)

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

/-- `"proof" | "universe" | "data"`: Paperproof's `mayBeProof`, restated here
so this module needs no Paperproof (the same three tests in the same order). -/
def mayBeProof (e : Expr) : MetaM String := do
  let type ← inferType e
  if ← isProof e then return "proof"
  if type.isSort then return "universe"
  return "data"

/-- `mayBeProof` per hypothesis NAME, in context order — `BakedState.kinds`. -/
def hypKinds (g : MVarId) : MetaM (Array String) := g.withContext do
  let mut ks := #[]
  for d in ← getLCtx do
    if d.isImplementationDetail then continue
    ks := ks.push (← mayBeProof d.toExpr)
  return ks

/-! ## Candidates — what is tried on a goal (the baker's BFS and the live
hints alike; moved here from PlaygroundBake.lean so both read one list) -/

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

/-- The directives (`-- @try`, `-- @depth`) are comment LINES, read as text. -/
def directives (src : String) : Array String × Option Nat := Id.run do
  let mut tries := #[]
  let mut depth := none
  for line in src.splitOn "\n" do
    let l := line.trimAscii.toString
    if l.startsWith "-- @try " then tries := tries.push (l.drop 8).toString.trimAscii.toString
    else if l.startsWith "-- @depth " then depth := (l.drop 10).toString.trimAscii.toString.toNat?
  return (tries, depth)

/-! ## The live engine -/

/-- `Init`, imported once. -/
initialize baseEnv : IO.Ref (Option Environment) ← IO.mkRef none
/-- Per theorem file: the environment after its commands (helper `def`s, the theorem). -/
initialize fileEnvs : IO.Ref (Std.HashMap String Environment) ← IO.mkRef {}
/-- Per theorem file: its first elaboration error, if any. -/
initialize fileErrs : IO.Ref (Std.HashMap String String) ← IO.mkRef {}

def elabFile (src : String) : IO Environment := do
  if let some e := (← fileEnvs.get)[src]? then return e
  let some env ← baseEnv.get | throw <| IO.userError "ramify_live_init first"
  let inputCtx := Parser.mkInputContext src "<playground>"
  let (_, parserState, messages) ← Parser.parseHeader inputCtx
  let fs ← IO.processCommands inputCtx parserState (Command.mkState env messages {})
  let env := fs.commandState.env
  -- the file's first error, said where its theorem goes missing
  if let some m := fs.commandState.messages.toList.find? (·.severity == .error) then
    fileErrs.modify (·.insert src (← m.toString))
  fileEnvs.modify (·.insert src env)
  return env

def errJson (s : String) : Json := Json.mkObj [("error", toJson s)]

def answer (req : Json) : IO Json := do
  let file ← IO.ofExcept (req.getObjValAs? String "file")
  let thm ← IO.ofExcept (req.getObjValAs? String "theorem")
  let path ← IO.ofExcept (req.getObjValAs? (Array (String × Nat)) "path")
  -- `{hints: true}` instead of a tactic: the candidates that SUCCEED here
  let hints := (req.getObjValAs? Bool "hints").toOption.getD false
  let tactic ← if hints then pure "" else normTac <$> IO.ofExcept (req.getObjValAs? String "tactic")
  let env ← elabFile file
  let some ci := env.find? thm.toName
    | return errJson s!"no theorem {thm}{match (← fileErrs.get)[file]? with | some e => s!": {e}" | none => ""}"
  let ctx : Core.Context := {
    fileName := "<playground>", fileMap := default, options := maxHeartbeats.set {} 20000,
    maxHeartbeats := 20000 * 1000, maxRecDepth := 4000 }
  let parse (t : String) : Except String Syntax := Parser.runParserCategory env `tactic t
  let act : TermElabM Json := do
    let root ← mkFreshExprMVar ci.type (kind := .syntheticOpaque)
    let mut g := root.mvarId!
    for (t, pick) in path do
      let some stx := (parse t).toOption | return errJson s!"path: cannot parse {t}"
      modifyThe Core.State fun s => { s with messages := {} }
      match ← runOne g stx with
      | .error e => return errJson s!"path: {t}: {e}"
      | .ok gs =>
        let some g' := gs[pick]? | return errJson s!"path: {t} left no goal {pick}"
        g := g'
    modifyThe Core.State fun s => { s with messages := {} }
    if hints then
      -- the baker's own per-goal candidates, each run from this state; a
      -- success that leaves a goal mentioning another's metavariable is not
      -- a step the page can draw, so it is not offered either
      let guard (m : MetaM (Array String)) : TermElabM (Array String) :=
        tryCatchRuntimeEx (withCurrHeartbeats m) (fun _ => pure #[])
      let intros ← guard (canonicalIntros g)
      let all := intros ++ (← guard (canonicalRenames g)) ++ (← guard (hypCandidates g)) ++
        coreCandidates ++ (directives file).1
      let st ← saveState
      let mut seen : Std.HashSet String := {}
      let mut ok := #[]
      for c in all do
        let c := normTac c
        if (isIntro c && !intros.contains c) || seen.contains c then continue
        seen := seen.insert c
        st.restore (restoreInfo := true)
        modifyThe Core.State fun s => { s with messages := {} }
        let some stx := (parse c).toOption | continue
        if let .ok gs ← runOne g stx then
          unless ← gs.anyM (fun g => (hasSorryOrMVar g : MetaM Bool)) do ok := ok.push c
      return Json.mkObj [("hints", toJson ok)]
    match parse tactic with
    | .error e => return errJson s!"parse: {e}"
    | .ok stx =>
      match ← runOne g stx with
      | .error e => return errJson e
      | .ok gs =>
        -- TAGGED, as the baker's goals are (ProofTreeBake: one bake, every
        -- wire): popups are interned per ANSWER and the page re-bases them
        let bake ← IO.mkRef ({} : ProofTree.BakeState)
        let goals ← gs.mapM fun g' => do
          let ig ← Widget.goalToInteractive g'
          let (j, st) ← (ProofTree.bakeInteractiveGoal ig).run (← bake.get)
          bake.set st
          return Json.mkObj [("key", toJson (← ppKey g')), ("goal", j),
            ("kinds", toJson (← hypKinds g'))]
        let uses ← usedHyps g tactic
        return Json.mkObj [("goals", Json.arr goals.toArray), ("uses", toJson uses),
          ("popups", toJson (← bake.get).popups)]
  let (j, _) ← (act.run' {} |>.run' {}).toIO ctx { env }
  return j

@[export ramify_live_init]
def liveInit (leanPath : String) : IO String := do
  try
    let t0 ← IO.monoMsNow
    initSearchPath leanPath [leanPath]
    unsafe enableInitializersExecution
    -- Without `Init`'s `.olean.private` parts (the browser's download drops
    -- them: 187 of its 275 MB) `Init` is imported at the EXPORTED level, as a
    -- `module` importer would; `RAMIFY_EXPORTED=1` forces that natively, so
    -- the identity check can run on it (docs/wasm-spike.md §7).
    let exported := (← System.FilePath.pathExists (leanPath / "Init.olean.private")) == false ||
      (← IO.getEnv "RAMIFY_EXPORTED") == some "1"
    let inputCtx := Parser.mkInputContext "" "<init>"
    let (header, _, messages) ← Parser.parseHeader inputCtx
    let (env, msgs) ← if exported then
        -- `importModules`, but with `isModule := false`: at the exported level
        -- it would make the env a `module`, and the file's own theorem and
        -- `def`s private (`_private.0.double.eq_def` in Lean's hints)
        let imports := #[{ module := `Init : Import }]
        let env ← withImporting do
          let (_, st) ← (importModulesCore (globalLevel := .exported) imports).run
          finalizeImport (leakEnv := false) (loadExts := true) (level := .exported) (isModule := false)
            st imports {}
        pure (env, messages)
      else processHeader header {} messages inputCtx
    baseEnv.set env
    let ok := !msgs.hasErrors
    let msgs ← msgs.toList.mapM (·.toString)
    return (Json.mkObj [("ok", toJson ok), ("ms", toJson ((← IO.monoMsNow) - t0)),
      ("constants", toJson env.constants.map₁.size), ("exported", toJson exported),
      ("messages", toJson msgs)]).compress
  catch e => return (errJson (toString e)).compress

@[export ramify_live_answer]
def liveAnswer (req : String) : IO String := do
  let t0 ← IO.monoMsNow
  let j ← try
      match Json.parse req with
      | .ok r => answer r
      | .error e => pure (errJson s!"request: {e}")
    catch e => pure (errJson (toString e))
  return (j.setObjVal! "ms" (toJson ((← IO.monoMsNow) - t0))).compress

end Playground
