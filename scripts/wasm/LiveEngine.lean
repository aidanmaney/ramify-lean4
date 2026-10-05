import Lean.Elab.Frontend
/-!
# LiveEngine — the playground's live tier, as a WASM-embeddable Lean module (SPIKE)

docs/wasm-spike.md. Compiled to C by the 32-bit stage0 `lean -c`, linked into the
Emscripten build with `live_shim.c` (a C `main` that initialises Lean and keeps the
runtime alive) and the static symbol table (`gen-symtab.py`). JS calls two exports:

* `ramify_live_init(leanPath)`: imports `Init` ONCE (the expensive part) and keeps it.
* `ramify_live_answer(requestJson)`: `{file, theorem, path: [[tactic, pick]…], tactic}` →
  `{goals: [ppGoal key…], uses: [name…], ms}` or `{error, ms}` — the shape of
  `web/src/playgroundAnswer.ts`'s `EngineAnswer`.

STATE, NOT TEXT (docs/playground-spike.md "Levelling up"): the goal is rebuilt by
replaying `path` from the theorem's type — each step a tactic and the index of
the goal it leaves that the path continues from.

`runOne`, `ppKey` and `usedHyps` are COPIES of `lean/PlaygroundBake.lean`'s (the
spike's only copy): shipping this means moving them into a module with no
Paperproof import that both the baker and this engine compile, so a live answer
is the baker's answer by construction.
-/

open Lean Elab Meta Term

namespace RamifyLive

def ppKey (g : MVarId) : MetaM String := return toString (← ppGoal g)

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

/-- `Init`, imported once. -/
initialize baseEnv : IO.Ref (Option Environment) ← IO.mkRef none
/-- Per theorem file: the environment after its commands (helper `def`s, the theorem). -/
initialize fileEnvs : IO.Ref (Std.HashMap String Environment) ← IO.mkRef {}

def elabFile (src : String) : IO Environment := do
  if let some e := (← fileEnvs.get)[src]? then return e
  let some env ← baseEnv.get | throw <| IO.userError "ramify_live_init first"
  let inputCtx := Parser.mkInputContext src "<playground>"
  let (_, parserState, messages) ← Parser.parseHeader inputCtx
  let fs ← IO.processCommands inputCtx parserState (Command.mkState env messages {})
  let env := fs.commandState.env
  fileEnvs.modify (·.insert src env)
  return env

def answer (req : Json) : IO Json := do
  let file ← IO.ofExcept (req.getObjValAs? String "file")
  let thm ← IO.ofExcept (req.getObjValAs? String "theorem")
  let path ← IO.ofExcept (req.getObjValAs? (Array (String × Nat)) "path")
  let tactic ← IO.ofExcept (req.getObjValAs? String "tactic")
  let env ← elabFile file
  let some ci := env.find? thm.toName | return Json.mkObj [("error", toJson s!"no theorem {thm}")]
  let ctx : Core.Context := {
    fileName := "<playground>", fileMap := default, options := maxHeartbeats.set {} 20000,
    maxHeartbeats := 20000 * 1000, maxRecDepth := 4000 }
  let parse (t : String) : Except String Syntax := Parser.runParserCategory env `tactic t
  let act : TermElabM Json := do
    let root ← mkFreshExprMVar ci.type (kind := .syntheticOpaque)
    let mut g := root.mvarId!
    for (t, pick) in path do
      let some stx := (parse t).toOption | return Json.mkObj [("error", toJson s!"path: cannot parse {t}")]
      modifyThe Core.State fun s => { s with messages := {} }
      match ← runOne g stx with
      | .error e => return Json.mkObj [("error", toJson s!"path: {t}: {e}")]
      | .ok gs =>
        let some g' := gs[pick]? | return Json.mkObj [("error", toJson s!"path: {t} left no goal {pick}")]
        g := g'
    modifyThe Core.State fun s => { s with messages := {} }
    match parse tactic with
    | .error e => return Json.mkObj [("error", toJson s!"parse: {e}")]
    | .ok stx =>
      match ← runOne g stx with
      | .error e => return Json.mkObj [("error", toJson e)]
      | .ok gs =>
        let keys ← gs.mapM (fun g => (ppKey g : MetaM String))
        let uses ← usedHyps g tactic
        return Json.mkObj [("goals", toJson keys), ("uses", toJson uses)]
  let (j, _) ← (act.run' {} |>.run' {}).toIO ctx { env }
  return j

@[export ramify_live_init]
def liveInit (leanPath : String) : IO String := do
  try
    let t0 ← IO.monoMsNow
    initSearchPath leanPath [leanPath]
    unsafe enableInitializersExecution
    let inputCtx := Parser.mkInputContext "" "<init>"
    let (header, _, messages) ← Parser.parseHeader inputCtx
    let (env, msgs) ← processHeader header {} messages inputCtx
    baseEnv.set env
    let msgs ← msgs.toList.mapM (·.toString)
    return (Json.mkObj [("ok", toJson true), ("ms", toJson ((← IO.monoMsNow) - t0)),
      ("constants", toJson env.constants.map₁.size), ("messages", toJson msgs)]).compress
  catch e => return (Json.mkObj [("error", toJson (toString e))]).compress

@[export ramify_live_answer]
def liveAnswer (req : String) : IO String := do
  let t0 ← IO.monoMsNow
  let j ← try
      match Json.parse req with
      | .ok r => answer r
      | .error e => pure (Json.mkObj [("error", toJson s!"request: {e}")])
    catch e => pure (Json.mkObj [("error", toJson (toString e))])
  return (j.setObjVal! "ms" (toJson ((← IO.monoMsNow) - t0))).compress

end RamifyLive
