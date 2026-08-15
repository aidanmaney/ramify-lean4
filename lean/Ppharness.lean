import Lean
import Services.BetterParser
import ProofTreeComments
import ProofTreeRecover

/-!
# Ppharness

A thin, fully-owned wrapper around paperproof's current `BetterParser_Tree`.

Per call the pipeline is:

  source text
    ── Parser.parseHeader / processHeader ─▶ environment (from the source's imports)
    ── Lean.Elab.IO.processCommands ───────▶ COMPLETE InfoTrees
    ── BetterParser_Tree fileMap tree ─────▶ Result          (MetaM)
    ── resultToJson ───────────────────────▶ Json

Why the frontend (`IO.processCommands`) and not an in-file `elab` command?
Modern Lean elaborates tactic blocks incrementally/asynchronously. If you grab
`infoState.trees` right after a nested `elabCommand`, the tactic subtree may not
be attached yet, so `BetterParser_Tree` walks a tree with zero `TacticInfo`
nodes and returns an empty `Result` (`{steps: [], allGoals: []}`). Running the
frontend to completion guarantees the trees are fully materialised first -- this
is the same source of trees the Lean REPL (and LeanTree) rely on.
-/

open Lean Elab Paperproof.Services

namespace Ppharness

/-- `Result` itself has no `ToJson` instance (only `ProofStep`, `GoalInfo`, and
    `Hypothesis` derive one), so we encode its two fields by hand.
    `allGoals` is a `Std.HashSet`, which has no canonical JSON form → dump as a list.
    `comments`, `holes` and `calcChains` are ours (not the parser's): the
    command's source comments, for the renderer's comment strips, and the two
    `calc` editing seams — the unproved links a chain already has, and where a
    chain that stops short of its goal continues (both from
    ProofTreeComments.lean) — plus `calcRelations`, the relations a chain on
    each pending goal could be built out of. -/
def resultToJson (r : Result) (comments : Array ProofTree.SourceComment)
    (holes : Array ProofTree.Hole)
    (calcChains : Array ProofTree.CalcChain)
    (calcRelations : Array ProofTree.CalcRelations)
    (deleteSlots : Array ProofTree.TacticSlot)
    (declRange : Option Lsp.Range)
    (recovered : Array ProofTree.Recover.RecoveredStep)
    (openBlock : Option ProofTree.Recover.OpenBlock) : Json :=
  Json.mkObj [
    ("steps",    toJson r.steps),          -- List ProofStep  (ToJson derived upstream)
    ("allGoals", toJson r.allGoals.toList), -- flatten the goal set into an array
    ("comments", toJson comments),
    ("holes", toJson holes),
    ("calcChains", toJson calcChains),
    ("calcRelations", toJson calcRelations),
    -- Plain data, like the calc seams above, so it rides this wire too even
    -- though the standalone app draws no delete affordance: it is what lets a
    -- probe run the REAL client-side extent maths offline. (Mirrored on the
    -- RPC wire by `ProofTreeData.deleteSlots`; keep the two in step.)
    ("deleteSlots", toJson deleteSlots),
    -- The whole DECLARATION's span, not the tactics'. The diagnostics surface
    -- needs it to tell this proof's errors from a neighbouring theorem's, and a
    -- span derived from the steps is not enough: `declaration uses 'sorry'` is
    -- reported on the declaration NAME, above every tactic in the proof.
    ("declRange", match declRange with
      | some r => Json.mkObj [("start", toJson r.start), ("stop", toJson r.end)]
      | none => Json.null)
  ] |> fun base => Id.run do
    -- Both optional fields are emitted only when they FIRED, which is what
    -- keeps the complete-proof corpus byte-identical through gen.sh (verified:
    -- recovery fires 0 times on it, and so does the open block).
    --
    -- A `do` block rather than a chain of `|>`: written as a second
    -- `|> fun base => …` after the `if`, the pipe binds inside the `else`
    -- branch, so the field was attached only for proofs that ALSO had
    -- recovered steps — i.e. never, on this corpus. Caught by the fixture,
    -- which showed `calcRelations` naming the open block's goal while the
    -- block itself was absent from the same object.
    let mut out := base
    unless recovered.isEmpty do
      out := out.setObjVal! "recovered" (toJson recovered)
    if let some ob := openBlock then
      out := out.setObjVal! "openBlock" (toJson ob)
    return out

/-- Run the (MetaM) parser from plain `IO`.
    Each node inside the InfoTree carries its own `ContextInfo` (env + mctx) which
    BetterParser uses for pretty-printing, so this OUTER environment only needs to
    be the proof's final environment, not anything goal-specific. -/
def runParser (env : Environment) (fileMap : FileMap) (tree : InfoTree) :
    IO (Option Result) := do
  -- Minimal Core context/state to host a MetaM computation:
  let coreCtx   : Core.Context := { fileName := "<ppharness>", fileMap := fileMap, options := {} }
  let coreState : Core.State   := { env := env }
  -- MetaM.run' : MetaM α → CoreM α ;  CoreM.toIO : CoreM α → IO (α × Core.State)
  let (res, _) ← ((BetterParser_Tree fileMap tree).run' (ctx := {}) (s := {})).toIO coreCtx coreState
  return res

/-- Parse one chunk of Lean source to completion.
    Returns one JSON object `{ index, proof }` per InfoTree that yielded an actual
    tactic proof; sources with no `by`-proofs (bare `#check`, definitions, …) yield
    `#[]`. `index` is the 0-based position of the tree within the source. -/
def parseSource (src : String) (fileName : String := "<ppharness>") : IO (Array Json) := do
  -- Make the core library importable. When run under `lake env` / `lake exe`,
  -- package paths (e.g. Mathlib) are layered on top of this via LEAN_PATH.
  initSearchPath (← findSysroot)
  let inputCtx := Parser.mkInputContext src fileName              -- wraps text + builds the FileMap
  let (header, parserState, messages) ← Parser.parseHeader inputCtx        -- parse leading `import`s
  let (env, messages) ← processHeader header {} messages inputCtx          -- env built from those imports
  let commandState := Command.mkState env messages {}                      -- fresh command state on it
  -- THE KEY STEP: elaborate every command fully (synchronous) → complete trees.
  let frontendState ← Lean.Elab.IO.processCommands inputCtx parserState commandState
  let trees    := frontendState.commandState.infoState.trees.toList
  let finalEnv := frontendState.commandState.env                  -- env AFTER all decls are added
  let fileMap  := inputCtx.fileMap
  -- Error positions gate the failed-tactic recovery below: a slot with no
  -- step is only FAILED if an error landed inside it (a no-op like `skip`
  -- records no step either — measured, see ProofTreeRecover).
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
        -- The label fix-ups (the `rw` location clause, a multi-line tactic's
        -- dropped tail), applied before anything else reads a label so
        -- `tacticString` means the same thing on both wires — `labelFixup`
        -- is the one place the pass list and its order live.
        let fixup := ProofTree.labelFixup fileMap tree
        let r1 := { r0 with steps := r0.steps.map fun s =>
          { s with tacticString := fixup.apply s.position.start s.tacticString } }
        -- The supplemental parser: synthesize steps for tactics the vendored
        -- one lost to failure (their info subtree was rolled back; the syntax
        -- survives in tacticSlots). Merged HERE, before anything reads the
        -- result, so recovered steps are ordinary steps downstream — and
        -- before the empty guard below, which is what stops a proof whose
        -- only tactic failed from vanishing entirely.
        let slots := ProofTree.tacticSlots fileMap tree
        let calcChains := ProofTree.collectCalcChains fileMap tree
        let recovA ← ProofTree.Recover.recoverFailed fileMap tree r1.steps slots
          calcChains errorPositions
        -- Part B: a TERM-MODE proof (`:= term`, no `by`) parses to nothing at
        -- all — synthesize its structure from the syntax + TermInfo.
        let recovB ← ProofTree.Recover.recoverTerm fileMap tree
          (ProofTree.Recover.commandStx? tree) r1.steps
        -- Part D: a `calc` link justified by a TERM, which elaborates no
        -- tactic and so reaches the harvest as an absence — the link's
        -- relation and its proof are both drawn nowhere without this.
        let recovD ← ProofTree.Recover.recoverCalcLinks fileMap tree r1.steps
        let recov : ProofTree.Recover.Recovery := {
          steps := recovA.steps ++ recovB.steps ++ recovD.steps
          goals := recovA.goals ++ recovB.goals ++ recovD.goals
          grafts := recovA.grafts ++ recovB.grafts ++ recovD.grafts
          recovered := recovA.recovered ++ recovB.recovered ++ recovD.recovered }
        -- Part C: an EMPTY `by` block — no step, just the goal it owes and
        -- where a first tactic goes. Read before the empty guard below, which
        -- it suspends: this payload has no steps by construction.
        let openBlock ← ProofTree.Recover.recoverOpenBlock fileMap tree
          (ProofTree.Recover.commandStx? tree) slots
        let r := recov.apply r1
        let r := match openBlock with
          | some ob => { r with allGoals := r.allGoals.insert ob.goal }
          | none => r
        -- Drop trees that produced no proof (keeps output to real theorems only).
        if !(r.steps.isEmpty && r.allGoals.isEmpty) then
          -- The command's comments ride along; the InfoTree never holds them
          -- (they're parser trivia), so re-lex the command's source range.
          let cmdRange := ProofTree.commandRange tree
          let comments := match cmdRange with
            | some range => ProofTree.commentsInRange src fileMap range
            | none => #[]
          let declRange := cmdRange.map fun r =>
            ⟨fileMap.utf8PosToLspPos r.start, fileMap.utf8PosToLspPos r.stop⟩
          -- Holes the author wrote, for the renderer's fill-in-place chips.
          -- Unlike the widget's tagged goals these are plain data, so they ride
          -- the CLI wire too (which is what lets a probe check them offline).
          let holes := ProofTree.collectHoles fileMap tree slots
          -- Same enumeration the widget runs, over the same pending rule; it
          -- needs only a MetaM context, which the info tree carries.
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
