import Lean
import Services.BetterParser
import ProofTreeComments
import ProofTreeRecover

open Lean Elab Paperproof.Services

namespace Ppharness

def resultToJson (r : Result) (comments : Array ProofTree.SourceComment)
    (holes : Array ProofTree.Hole)
    (calcChains : Array ProofTree.CalcChain)
    (calcRelations : Array ProofTree.CalcRelations)
    (deleteSlots : Array ProofTree.TacticSlot)
    (declRange : Option Lsp.Range)
    (recovered : Array ProofTree.Recover.RecoveredStep)
    (termLedgers : Array ProofTree.Recover.TermLedger)
    (hypOrigins : Array ProofTree.HypOrigin)
    (haveUses : Array ProofTree.HaveUse)
    (lemmaRefs : Array ProofTree.LemmaRef)
    (branches : Array ProofTree.BranchInfo)
    (openBlock : Option ProofTree.Recover.OpenBlock)
    (latex : Array ProofTree.LatexGoal := #[])
    (lints : Array ProofTree.Lint := #[]) : Json :=
  Json.mkObj [
    ("steps",    toJson r.steps),
    ("allGoals", toJson r.allGoals.toList),
    ("comments", toJson comments),
    ("holes", toJson holes),
    ("calcChains", toJson calcChains),
    ("calcRelations", toJson calcRelations),

    ("deleteSlots", toJson deleteSlots),

    ("declRange", match declRange with
      | some r => Json.mkObj [("start", toJson r.start), ("stop", toJson r.end)]
      | none => Json.null)
  ] |> fun base => Id.run do

    let mut out := base
    unless recovered.isEmpty do
      out := out.setObjVal! "recovered" (toJson recovered)
    unless termLedgers.isEmpty do
      out := out.setObjVal! "termLedgers" (toJson termLedgers)
    unless hypOrigins.isEmpty do
      out := out.setObjVal! "hypOrigins" (toJson hypOrigins)
    unless haveUses.isEmpty do
      out := out.setObjVal! "haveUses" (toJson haveUses)
    unless lemmaRefs.isEmpty do
      out := out.setObjVal! "lemmaRefs" (toJson lemmaRefs)
    unless branches.isEmpty do
      out := out.setObjVal! "branches" (toJson branches)
    if let some ob := openBlock then
      out := out.setObjVal! "openBlock" (toJson ob)
    -- C1: non-empty only, so an untouched corpus is byte-identical. The
    -- printer is not built on this toolchain, so this is always empty today.
    unless latex.isEmpty do
      out := out.setObjVal! "latex" (toJson latex)
    -- D4: non-empty only, so a corpus generated without `--lint` is
    -- byte-identical to one generated before D4 existed.
    unless lints.isEmpty do
      out := out.setObjVal! "lints" (toJson lints)
    return out

def runParser (env : Environment) (fileMap : FileMap) (tree : InfoTree) :
    IO (Option Result) := do

  let coreCtx   : Core.Context := { fileName := "<ppharness>", fileMap := fileMap, options := {} }
  let coreState : Core.State   := { env := env }

  let (res, _) ← ((BetterParser_Tree fileMap tree).run' (ctx := {}) (s := {})).toIO coreCtx coreState
  return res

/-- B4 — the automation traces for a whole FILE, in one extra elaboration.

Every automation tactic in the file is rewritten to its `?` form at once
(`ProofTree.traceRewrite`) and the file re-elaborated once; each `Try this`
message is matched back to its site by the rewritten text's own position. The
alternative — one splice and one elaboration per `simp` — costs a Mathlib
elaboration per automation step, which is what makes it unaffordable; a `?`
form behaves exactly as the bare one, so doing them together is sound.

Opaque sites (`omega`, `linarith`, …) need no elaboration at all and are still
returned, so the reader is told the tactic keeps no lemma list rather than
meeting silence. -/
def automationTracesFor (headerEnv finalEnv : Environment) (fileMap : FileMap)
    (fileName : String) (steps : List ProofStep) :
    IO (Array ProofTree.AutomationTrace) := do
  let sites := ProofTree.traceSites fileMap steps
  if sites.isEmpty then return #[]
  let msgs : Array (Lsp.Position × String) ←
    match ProofTree.traceRewrite fileMap.source sites with
    | none => pure #[]
    | some src2 => do
      let ictx := Parser.mkInputContext src2 fileName
      let (_, parserState, messages) ← Parser.parseHeader ictx
      -- The HEADER environment, not the finished one: re-elaborating the file
      -- against an environment that already holds its declarations reports
      -- nothing but "has already been declared".
      let st ← Lean.Elab.IO.processCommands ictx parserState
        (Command.mkState headerEnv messages {})
      let map2 := ictx.fileMap
      let mut acc : Array (Lsp.Position × String) := #[]
      for m in st.commandState.messages.toList do
        acc := acc.push (map2.leanPosToLspPos m.pos, ← m.data.toString)
      pure acc
  if (← IO.getEnv "PPH_TRACE_DEBUG").isSome then
    for s in sites do
      (← IO.getStderr).putStrLn s!"[site] {s.head} orig={s.stepStart.line}:{s.stepStart.character} new={s.newStart.line}:{s.newStart.character} ins={s.insertAt}"
    for (p, t) in msgs do
      (← IO.getStderr).putStrLn s!"[msg] {p.line}:{p.character} {t.take 60}"
  ProofTree.collectTraces finalEnv sites msgs

def parseSource (src : String) (fileName : String := "<ppharness>")
    (traces : Bool := false) (lint : Bool := false) : IO (Array Json) := do

  initSearchPath (← findSysroot)
  let inputCtx := Parser.mkInputContext src fileName
  let (header, parserState, messages) ← Parser.parseHeader inputCtx
  let (env, messages) ← processHeader header {} messages inputCtx
  -- D4: the linters ride the ONE elaboration this harness already runs, so
  -- `--lint` costs the linter passes and not a second pass over the file.
  let commandState := Command.mkState env messages
    (if lint then ProofTree.withLinters {} else {})

  let frontendState ← Lean.Elab.IO.processCommands inputCtx parserState commandState
  let trees    := frontendState.commandState.infoState.trees.toList
  let finalEnv := frontendState.commandState.env
  let fileMap  := inputCtx.fileMap

  let allLints ← if lint then
      ProofTree.lintsOf fileMap frontendState.commandState.messages.toList
    else pure #[]
  let errorPositions := frontendState.commandState.messages.toList.foldl
    (init := #[]) fun acc m =>
      if m.severity matches .error then
        acc.push (fileMap.leanPosToLspPos m.pos)
      else acc
  let mut out := #[]
  let mut idx := 0
  -- Every harvested step in the file, so B4's traces cost ONE extra
  -- elaboration for the file rather than one per declaration.
  let mut allSteps : List ProofStep := []
  let mut starts : Array (Array Lsp.Position) := #[]
  for tree in trees do
    match ← runParser finalEnv fileMap tree with
    | some r0 =>

        let fixup := ProofTree.labelFixup fileMap tree
        let r1 := { r0 with steps := r0.steps.map fun s =>
          { s with tacticString := fixup.apply s.position.start s.tacticString } }

        let slots := ProofTree.tacticSlots fileMap tree
        let calcChains := ProofTree.collectCalcChains fileMap tree
        let recovA ← ProofTree.Recover.recoverFailed fileMap tree r1.steps slots
          calcChains errorPositions

        let recovB ← ProofTree.Recover.recoverTerm fileMap tree
          (ProofTree.Recover.commandStx? tree) r1.steps

        let recovD ← ProofTree.Recover.recoverCalcLinks fileMap tree r1.steps

        let recovE ← ProofTree.Recover.recoverTermInStep fileMap tree r1.steps
        let recov : ProofTree.Recover.Recovery := {
          steps := recovA.steps ++ recovB.steps ++ recovD.steps ++ recovE.steps
          goals := recovA.goals ++ recovB.goals ++ recovD.goals ++ recovE.goals
          grafts := recovA.grafts ++ recovB.grafts ++ recovD.grafts ++ recovE.grafts
          recovered := recovA.recovered ++ recovB.recovered ++ recovD.recovered
                         ++ recovE.recovered
          ledgers := recovE.ledgers }

        let openBlock ← ProofTree.Recover.recoverOpenBlock fileMap tree
          (ProofTree.Recover.commandStx? tree) slots
        let r := recov.apply r1
        let r := match openBlock with
          | some ob => { r with allGoals := r.allGoals.insert ob.goal }
          | none => r

        if !(r.steps.isEmpty && r.allGoals.isEmpty) then

          let cmdRange := ProofTree.commandRange tree
          let comments := match cmdRange with
            | some range => ProofTree.commentsInRange src fileMap range
            | none => #[]
          let declRange := cmdRange.map fun r =>
            ⟨fileMap.utf8PosToLspPos r.start, fileMap.utf8PosToLspPos r.stop⟩

          -- Each declaration keeps the lints inside its OWN range: the
          -- elaboration is one pass over the file and the wire is per
          -- declaration, exactly as B4's traces are re-owned below.
          let lints := match declRange with
            | some dr => allLints.filter fun l =>
                ProofTree.posLE dr.start l.start && ProofTree.posLE l.start dr.end
            | none => #[]

          let holes := ProofTree.collectHoles fileMap tree slots

          let lemmaRefs ← ProofTree.lemmaRefs finalEnv fileMap tree r.steps
            (ProofTree.Recover.commandStx? tree >>= ProofTree.declName?)

          let branches ← ProofTree.branches fileMap tree r.steps

          let calcRelations ← ProofTree.collectCalcRelations tree <|
            ProofTree.calcRelationGoals
              (r.steps.toArray.map fun s =>
                { goalBefore := s.goalBefore.id.name.toString
                  goalsAfter := (s.goalsAfter.map (·.id.name.toString)).toArray
                  start := s.position.start
                  stop  := s.position.stop })
              calcChains
              (match openBlock with
                | some ob => #[ob.goal.id.name.toString]
                | none => #[])
          allSteps := allSteps ++ r.steps
          starts := starts.push (r.steps.toArray.map (·.position.start))
          out := out.push (Json.mkObj
            [("index", toJson idx),
             ("proof", resultToJson r comments holes calcChains calcRelations
                          slots declRange recov.recovered recov.ledgers
                          (ProofTree.hypOrigins r.steps)
                          (ProofTree.haveUses r.steps) lemmaRefs branches
                          openBlock (lints := lints))])
    | none => pure ()
    idx := idx + 1
  unless traces do return out
  let all ← automationTracesFor env finalEnv fileMap fileName allSteps
  if all.isEmpty then return out
  -- Back onto the record each site belongs to, by its step's own start: the
  -- traces are computed once for the file and the wire is per declaration.
  return out.mapIdx fun i obj =>
    let owned : Array ProofTree.AutomationTrace := match starts[i]? with
      | some ps => all.filter fun t =>
          ps.any fun p => p.line == t.stepStart.line
            && p.character == t.stepStart.character
      | none => #[]
    if owned.isEmpty then obj
    else match obj.getObjVal? "proof" with
      | .ok proof =>
        obj.setObjVal! "proof" (proof.setObjVal! "automationTraces" (toJson owned))
      | .error _ => obj

end Ppharness
