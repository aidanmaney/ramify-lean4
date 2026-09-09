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
    (openBlock : Option ProofTree.Recover.OpenBlock) : Json :=
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
    if let some ob := openBlock then
      out := out.setObjVal! "openBlock" (toJson ob)
    return out

def runParser (env : Environment) (fileMap : FileMap) (tree : InfoTree) :
    IO (Option Result) := do

  let coreCtx   : Core.Context := { fileName := "<ppharness>", fileMap := fileMap, options := {} }
  let coreState : Core.State   := { env := env }

  let (res, _) ← ((BetterParser_Tree fileMap tree).run' (ctx := {}) (s := {})).toIO coreCtx coreState
  return res

def parseSource (src : String) (fileName : String := "<ppharness>") : IO (Array Json) := do

  initSearchPath (← findSysroot)
  let inputCtx := Parser.mkInputContext src fileName
  let (header, parserState, messages) ← Parser.parseHeader inputCtx
  let (env, messages) ← processHeader header {} messages inputCtx
  let commandState := Command.mkState env messages {}

  let frontendState ← Lean.Elab.IO.processCommands inputCtx parserState commandState
  let trees    := frontendState.commandState.infoState.trees.toList
  let finalEnv := frontendState.commandState.env
  let fileMap  := inputCtx.fileMap

  let errorPositions := frontendState.commandState.messages.toList.foldl
    (init := #[]) fun acc m =>
      if m.severity matches .error then
        acc.push (fileMap.leanPosToLspPos m.pos)
      else acc
  let mut out := #[]
  let mut idx := 0
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
        let recov : ProofTree.Recover.Recovery := {
          steps := recovA.steps ++ recovB.steps ++ recovD.steps
          goals := recovA.goals ++ recovB.goals ++ recovD.goals
          grafts := recovA.grafts ++ recovB.grafts ++ recovD.grafts
          recovered := recovA.recovered ++ recovB.recovered ++ recovD.recovered }

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

          let holes := ProofTree.collectHoles fileMap tree slots

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
          out := out.push (Json.mkObj
            [("index", toJson idx),
             ("proof", resultToJson r comments holes calcChains calcRelations
                          slots declRange recov.recovered openBlock)])
    | none => pure ()
    idx := idx + 1
  return out

end Ppharness
