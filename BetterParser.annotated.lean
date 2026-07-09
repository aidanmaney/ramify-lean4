-- ============================================================================
-- ANNOTATED COPY of Paperproof's Services/BetterParser.lean
-- (source: lean/.lake/packages/Paperproof/lean/Services/BetterParser.lean)
--
-- This is a READ-ONLY study copy, not part of the build. Annotations relate the
-- upstream parser to *our* system:
--
--   source .lean ──► Ppharness.parseSource ──► InfoTree(s)
--                                          ──► BetterParser_Tree  ◄── THIS FILE
--                                          ──► Result {steps, allGoals}
--                                          ──► resultToJson ──► NDJSON
--                                          ──► (web) paperproof.ts mirrors these
--                                                   structs verbatim
--                                          ──► proofToTree.ts turns steps into
--                                                   the goal/tactic render tree.
--
-- So every structure below with a `ToJson` instance is literally the wire format
-- our TypeScript decodes. `ProofStep`, `GoalInfo`, `Hypothesis` are the contract.
--
-- METAPROGRAMMING THEME: this file never *runs* tactics. It inspects the residue
-- the elaborator leaves behind — `InfoTree` nodes (esp. `TacticInfo`) and the
-- `MetavarContext` snapshots taken before/after each tactic — and reconstructs a
-- proof tree by diffing which metavariables (goals) got assigned to what.
-- ============================================================================

import Lean
import Lean.Meta.Basic
import Lean.Meta.CollectMVars      -- Meta.collectMVars: harvest the mvars an Expr mentions

import Services.GetTheorems        -- TheoremSignature + GetTheorems (lemmas a tactic invoked)
import Services.GetTacticSubstring -- maps a TacticInfo back to its source text span

open Lean Elab Server

namespace Paperproof.Services

-- ── WIRE STRUCTS ────────────────────────────────────────────────────────────
-- These four `deriving ToJson` structures ARE our NDJSON schema. `web/src/
-- paperproof.ts` declares TS interfaces that match field-for-field; if you add a
-- field here, add it there too.

-- A single entry of a goal's local context (one hypothesis `h : T` or `h : T := v`).
-- `id` is the fvarId — a stable identity our `newHyps` diff in proofToTree.ts keys
-- on to show only the hypotheses a step *introduced*, not the whole growing context.
structure Hypothesis where
  username : String
  type : String
  value : Option String          -- present for `let`-bound / definition hyps
  -- unique identifier for the hypothesis, fvarId
  id : String
  isProof : String               -- "proof" | "universe" | "data" (see mayBeProof)
  deriving Inhabited, ToJson, FromJson

-- A goal = a metavariable plus its local context, pretty-printed to strings.
-- METAPROGRAMMING: a "goal" in Lean is just an `MVarId` (a hole in a proof term);
-- its *type* is the proposition to prove and its `LocalContext` holds the hyps.
-- Our renderer draws each GoalInfo as a box.
structure GoalInfo where
  username : String
  type : String                  -- the pretty-printed goal proposition
  hyps : List Hypothesis
  -- unique identifier for the goal, mvarId
  id : MVarId                     -- note: serialized via MVarId's ToJson (its Name)
  deriving Inhabited, ToJson, FromJson

-- Goals are compared/hashed purely by mvarId identity. This is what lets the code
-- below treat goals as set elements (Std.HashSet GoalInfo) and erase/dedup them.
instance : BEq GoalInfo where
  beq g1 g2 := g1.id == g2.id

instance : Hashable GoalInfo where
  hash g := hash g.id

-- Source span of a tactic (LSP line/col). Drives editor highlighting in the real
-- widget; our CLI/web path currently ignores it, but it rides along in the JSON.
structure ProofStepPosition where
  start: Lsp.Position
  stop: Lsp.Position
  deriving Inhabited, ToJson, FromJson

-- THE central record. One tactic application:
--   goalBefore  ──(tacticString)──▶ goalsAfter (+ spawnedGoals)
-- This is exactly the Gentzen-style edge our proofToTree.ts turns into a
-- goal→tactic-node→goals subtree. `tacticDependsOn`/`theorems` are extra metadata
-- (which hyps/lemmas the tactic actually used) that our web layout doesn't yet draw.
structure ProofStep where
  tacticString    : String
  goalBefore      : GoalInfo
  goalsAfter      : List GoalInfo
  tacticDependsOn : List String           -- fvarIds the tactic genuinely consumed
  spawnedGoals    : List GoalInfo          -- side-goals not flowing from goalBefore
  position        : ProofStepPosition
  theorems        : List TheoremSignature  -- lemmas referenced (from GetTheorems)
  deriving Inhabited, ToJson, FromJson

-- Both kinds of produced goal, concatenated. Our web side mirrors this exact
-- helper: `stepGoalsAfter(step) = goalsAfter ++ spawnedGoals` in paperproof.ts,
-- and proofToTree.ts uses it to enumerate a tactic node's children.
def stepGoalsAfter (step : ProofStep) : List GoalInfo := step.goalsAfter ++ step.spawnedGoals

-- Goals that no step produces — i.e. tree roots (the original theorem goal[s]).
-- Computed by starting from `allGoals` and erasing everything that appears as some
-- step's output. Our rootIds() in proofToTree.ts reimplements this same "consumed
-- but never produced" idea on the TS side.
def noInEdgeGoals (allGoals : Std.HashSet GoalInfo) (steps : List ProofStep) : Std.HashSet GoalInfo :=
  -- Some of the orphaned goals might be matched by tactics in sibling subtrees, e.g. for tacticSeq.
  (steps.flatMap stepGoalsAfter).foldl Std.HashSet.erase allGoals

/-
  Instead of doing parsing of what user wrote (it wouldn't work for linarith etc),
  let's do the following.
  We have assigned something to our goal in mctxAfter.
  All the fvars used in these assignments are what was actually used instead of what was in syntax.
-/
-- KEY METAPROGRAMMING IDEA. Rather than parse the tactic's surface syntax, look at
-- what the elaborator *assigned* to the goal metavariable, and read off which
-- hypotheses (free variables) that assignment actually mentions. This is robust to
-- tactics like `linarith`/`simp` whose syntax doesn't name what they use.
--   • mctxAfter.eAssignment.find? goalId   — the proof term filled into the hole
--   • instantiateExprMVars                 — splice in all other solved mvars so the
--                                            term is fully concrete
--   • collectFVars                         — gather free variables it references
--   • goalDecl.lctx.find?                   — keep only those that are real hyps of
--                                            this goal's local context
def findHypsUsedByTactic (goalId: MVarId) (goalDecl : MetavarDecl) (mctxAfter : MetavarContext) : MetaM (List String) := do
  let some expr := mctxAfter.eAssignment.find? goalId
    | return []

  -- Need to instantiate it to get all fvars
  let fullExpr ← instantiateExprMVars expr
  let fvarIds := (collectFVars {} fullExpr).fvarIds
  let fvars := fvarIds.filterMap goalDecl.lctx.find?
  return fvars.map (fun x => x.fvarId.name.toString) |>.toList

-- This is used to match goalsBefore with goalsAfter to see what was assigned to what
-- Same trick, but collecting *metavariables* instead of fvars: the new goals a
-- tactic created live as unassigned mvars inside the term it assigned to the old
-- goal. This is how an edge knows which "after" goals belong to which "before" goal.
def findMVarsAssigned (goalId : MVarId) (mctxAfter : MetavarContext) : MetaM (List MVarId) := do
  let some expr := mctxAfter.eAssignment.find? goalId
    | return []
  let (_, s) ← (Meta.collectMVars expr).run {}
  return s.result.toList

-- Classify a hypothesis by its type's nature, for display. `Meta.isProof` asks "is
-- this a term whose type is a Prop?"; a `Sort` means it's itself a type/universe;
-- otherwise it's ordinary data. Surfaces as Hypothesis.isProof in the JSON.
def mayBeProof (expr : Expr) : MetaM String := do
  let type : Expr ← Lean.Meta.inferType expr
  if ← Meta.isProof expr then
    return "proof"
  if type.isSort then
    return "universe"
  else
    return "data"

-- ── PRETTY-PRINTING A GOAL ────────────────────────────────────────────────────
-- Turn an mvarId + its context into the string-laden GoalInfo our renderer needs.
-- METAPROGRAMMING: pretty-printing requires a ContextInfo (env + mctx + options).
-- Recall Ppharness.runParser's comment: each InfoTree node carries its OWN
-- ContextInfo, so the printing here uses goal-local context, which is why our
-- outer environment in Ppharness can be just the file's final env.
public def printGoalInfo (printCtx : ContextInfo) (id : MVarId) : MetaM GoalInfo := do
  let some decl := printCtx.mctx.findDecl? id      -- MetavarDecl: type + lctx of the goal
    | throwError "goalNotFoundInMctx"
  -- to get tombstones in name ✝ for unreachable hypothesis
  let lctx := decl.lctx |>.sanitizeNames.run' {options := {}}
  let ppContext := printCtx.toPPContext lctx        -- bundle env+lctx for ppExpr
  -- Fold the local context into a hyp list, skipping compiler-internal entries.
  let hyps ← lctx.foldrM (init := []) (fun hypDecl acc => do
    if hypDecl.isAuxDecl || hypDecl.isImplementationDetail then
      return acc
    let type ← ppExprWithInfos ppContext hypDecl.type
    let value ← hypDecl.value?.mapM (fun expr => ppExprWithInfos ppContext expr)
    -- runMetaM: drop from ContextInfo back into MetaM with this goal's lctx so
    -- inferType/isProof inside mayBeProof resolve fvars correctly.
    let isProof : String ← printCtx.runMetaM decl.lctx (mayBeProof hypDecl.toExpr)
    return ({
      username := hypDecl.userName.toString,
      type     := type.fmt.pretty,           -- Format ──► String (what we render)
      value    := value.map (·.fmt.pretty),
      id       := hypDecl.fvarId.name.toString,
      isProof  := isProof
    } : Hypothesis) :: acc)
  return {
    username := decl.userName.toString
    type     := (← ppExprWithInfos ppContext decl.type).fmt.pretty
    hyps     := hyps
    id       := id
  }

-- Returns unassigned goals from the provided list of goals
-- A goal counts as "still open" iff it exists in the mctx and has neither an
-- expression assignment (eAssignment) nor a delayed assignment (dAssignment).
-- Used to compare the open-goal set before vs after a tactic.
def getUnassignedGoals (goals : List MVarId) (mctx : MetavarContext) : MetaM (List MVarId) := do
  goals.filterMapM fun id => do
    if let none := mctx.findDecl? id then
      return none
    if mctx.eAssignment.contains id ||
       mctx.dAssignment.contains id then
      return none
    return some id

-- The parser's accumulator and final output. `allGoals` is every goal seen
-- anywhere (set, dedup by mvarId); `steps` are the reconstructed edges. Ppharness
-- hand-serializes exactly these two fields (Result has no derived ToJson).
structure Result where
  steps : List ProofStep
  allGoals : Std.HashSet GoalInfo

-- ── THE DIFF: what one tactic did ──────────────────────────────────────────────
-- Given a TacticInfo (which records goalsBefore/goalsAfter and mctx snapshots
-- taken immediately before and after the tactic ran), reconstruct the edges
-- (goalBefore, goalsAfter) by metavariable-assignment matching.
def getGoalsChange (ctx : ContextInfo) (tInfo : TacticInfo) : MetaM (List (List String × GoalInfo × List GoalInfo)) := do
  -- We want to filter out `focus` like tactics which don't do any assignments
  -- therefore we check all goals on whether they were assigned during the tactic
  let goalMVars := tInfo.goalsBefore ++ tInfo.goalsAfter
  -- For printing purposes we always need to use the latest mctx assignments. For example in
  -- have h := by calc
  --  3 ≤ 4 := by trivial
  --  4 ≤ 5 := by trivial
  -- at mctxBefore type of `h` is `?m.260`, but by the time calc is elaborated at mctxAfter
  -- it's known to be `3 ≤ 5`
  let printCtx := {ctx with mctx := tInfo.mctxAfter}   -- print with fully-resolved types
  -- Open goals before vs after, then drop goals untouched by this tactic (common to
  -- both) — that's how `focus`/structuring tactics produce no edges.
  let mut goalsBefore ← getUnassignedGoals goalMVars tInfo.mctxBefore
  let mut goalsAfter ← getUnassignedGoals goalMVars tInfo.mctxAfter
  let commonGoals := goalsBefore.filter fun g => goalsAfter.contains g
  goalsBefore := goalsBefore.filter (!commonGoals.contains ·)
  goalsAfter :=  goalsAfter.filter (!commonGoals.contains ·)
  -- We need to match them into (goalBefore, goalsAfter) pairs according to assignment.
  let mut result : List (List String × GoalInfo × List GoalInfo) := []
  for goalBefore in goalsBefore do
    if let some goalDecl := tInfo.mctxBefore.findDecl? goalBefore then
      -- Which after-goals did this before-goal's assignment spawn? (mvar matching)
      let assignedMVars ← ctx.runMetaM goalDecl.lctx (findMVarsAssigned goalBefore tInfo.mctxAfter)
      -- Which hyps did the tactic actually use? (fvar matching)
      let tacticDependsOn ← ctx.runMetaM goalDecl.lctx
          (findHypsUsedByTactic goalBefore goalDecl tInfo.mctxAfter)

      result := (
        tacticDependsOn,
        ← printGoalInfo printCtx goalBefore,
        -- keep only the after-goals this before-goal actually produced
        ← goalsAfter.filter assignedMVars.contains |>.mapM (printGoalInfo printCtx)
      ) :: result
  return result

-- ── SURFACE-SYNTAX CLEANUP ──────────────────────────────────────────────────
-- Cosmetic normalization of the tactic string, matched on the tactic's Syntax.
-- METAPROGRAMMING: the `` `(tactic| ...) `` quasiquotation patterns match against
-- the parsed Syntax tree of the tactic, not a raw string — robust to whitespace.
-- These tweaks are why our rendered tactic labels read cleanly (e.g. `rw [...]`).
def prettifySteps (stx : Syntax) (steps : List ProofStep) (tacticString : String) : List ProofStep := Id.run do
  match stx with
  | `(tactic| rw [$_,*] $(_)?)
  | `(tactic| rewrite [$_,*] $(_)?) =>
    let prettify (tStr : String) :=
      let res := (tStr.trimAscii.toString.dropEndWhile (· == ',')).toString
      -- rw puts final rfl on the "]" token
      if res == "]" then "rfl" else res
    return steps.map fun a => { a with tacticString := s!"rw [{prettify a.tacticString}]" }
  | `(tactic| intro $_ $_ $_*) =>
    -- intro with 2+ names generates one child TacticInfo per name; merge into a single step
    if steps.isEmpty then return steps
    return [{ steps.head! with
      tacticString        := tacticString,
      goalsAfter          := steps.getLast!.goalsAfter,
      tacticDependsOn     := (steps.flatMap (·.tacticDependsOn)).eraseDups }]
  | _ => return steps

-- Comparator for names, e.g. so that _uniq.34 and _uniq.102 go in the right order.
-- That's not completely right because it doesn't compare prefixes but
-- it's much shorter to write than correct version and serves the purpose.
-- Orders spawned goals deterministically by their mvar's numeric suffix — gives a
-- stable left-to-right ordering (our layout's ORD key relies on stable emission order).
def nameNumLt (n1 n2 : Name) : Bool :=
  match n1, n2 with
  | .num _ n₁, .num _ n₂ => n₁ < n₂
  | .num _ _,  _ => true
  | _, _ => false

/--
  By default, `.getSubstring()` captures empty lines and comments after the tactic - this function removes them.
-/
def prettifyTacticString (tacticString: String) : String :=
  ((tacticString.splitOn "\n").head?.getD tacticString).trimAscii.toString

-- Convert a raw source substring to LSP start/stop positions via the FileMap.
-- The FileMap (built by Ppharness from the input text) is the byte-offset ⇄
-- line/col oracle; same object threaded all the way from parseSource.
def getProofStepPosition (fileMap : FileMap) (tacticSubstring: Substring.Raw) : ProofStepPosition := {
  start := Lean.FileMap.utf8PosToLspPos fileMap tacticSubstring.startPos,
  stop  := Lean.FileMap.utf8PosToLspPos fileMap tacticSubstring.stopPos
}

-- ── ASSEMBLE ONE TACTIC'S STEPS ───────────────────────────────────────────────
-- Combines the edges from getGoalsChange with the steps already gathered from
-- child nodes, computes spawned/orphaned goals, and emits the new ProofSteps.
def parseTacticBody (fileMap : FileMap) (ctx : ContextInfo) (tInfo : TacticInfo) (tacticSubstring : Substring.Raw) (steps : List ProofStep) (allGoals : Std.HashSet GoalInfo) (tacticString : String) (theorems : List TheoremSignature) : MetaM Result := do
  let steps := prettifySteps tInfo.stx steps tacticString
  let position := getProofStepPosition fileMap tacticSubstring

  let proofTreeEdges ← getGoalsChange ctx tInfo
  let currentGoals := proofTreeEdges.map (fun ⟨ _, g₁, gs ⟩ => g₁ :: gs)  |>.flatten
  let allGoals := allGoals.insertMany $ currentGoals
  -- It's like tacticDependsOn but unnamed mvars instead of hyps.
  -- Important to sort for have := calc for example, e.g. calc 3 < 4 ... 4 < 5 ...
  -- "Orphaned" = goals present but not produced by any known step at this level →
  -- side goals this tactic spawned. They become each new step's spawnedGoals.
  let orphanedGoals := currentGoals.foldl Std.HashSet.erase (noInEdgeGoals allGoals steps)
    |>.toArray.insertionSort (nameNumLt ·.id.name ·.id.name) |>.toList

  let newSteps := proofTreeEdges.filterMap fun ⟨ tacticDependsOn, goalBefore, goalsAfter ⟩ =>
    -- Leave only steps which are not handled in the subtree.
    -- (A child node already produced the edge for this goalBefore — don't double-count.)
    if steps.map (·.goalBefore) |>.elem goalBefore then
      none
    else
      some {
        tacticString,
        goalBefore,
        goalsAfter,
        tacticDependsOn,
        spawnedGoals := orphanedGoals
        position,
        theorems
      }

  return { steps := newSteps ++ steps, allGoals }

-- ── ENTRY POINT WE CALL ───────────────────────────────────────────────────────
-- THIS is the function Ppharness.runParser invokes (`BetterParser_Tree fileMap tree`).
-- METAPROGRAMMING: `InfoTree.visitM (postNode := ...)` is a bottom-up fold over the
-- elaboration info tree. For each node we receive its ContextInfo, the Info payload,
-- and the already-folded `results` of its children — so steps bubble up from leaves
-- to the root, accumulating into a single Result. This bottom-up shape is why a
-- tactic only emits an edge if a child didn't already handle that goalBefore.
public def BetterParser_Tree (fileMap : FileMap) (infoTree : InfoTree) : MetaM (Option Result) :=
  infoTree.visitM (postNode := fun ctx info _ results => do
    -- Remove `Option.none` values from the `results` list (we have them because of the `.visitM` implementation)
    let results : List Result := results.filterMap id
    -- 1. Flatten `ProofStep`s
    let steps : List ProofStep := (results.map (λ result => result.steps)).flatten
    -- 2. Flatten `GoalInfo`s
    let allGoals : Std.HashSet GoalInfo := Std.HashSet.ofList ((results.map (λ result => result.allGoals.toList)).flatten)
    -- 3. Parse tactic
    -- info.updateContext?: refine the inherited ContextInfo with this node's delta.
    let .some ctx := info.updateContext? ctx              | panic! "unexpected context node"
    -- Only TacticInfo nodes carry goal-change data; everything else just passes the
    -- accumulated children's results upward unchanged. THIS is the node type that, if
    -- absent (e.g. async elaboration on Lean ≥4.29), leaves us with an empty Result —
    -- exactly the failure mode our v4.27.0 toolchain pin in lakefile.toml avoids.
    let .ofTacticInfo tInfo := info                       | return { steps, allGoals }
    let .some tacticSubstring := getTacticSubstring tInfo | return { steps, allGoals }
    let tacticString := prettifyTacticString (Substring.Raw.toString tacticSubstring)
    -- NB: `theorems := []` here — the tree entry point skips GetTheorems (the
    -- single-tactic entry below populates it). So our NDJSON's `theorems` is empty
    -- on the CLI path; harmless, since proofToTree.ts doesn't read it.
    parseTacticBody fileMap ctx tInfo tacticSubstring steps allGoals tacticString []
  )

-- Alternate entry for the real infoview widget: parses ONE tactic node (not the
-- whole tree) and DOES compute `theorems` via GetTheorems. We don't use this on the
-- CLI path, but it's the shape the production user-widget (README "Production
-- direction") would lean on when calling over RPC inside the user's Lean server.
public def BetterParser_SingleTactic (fileMap: FileMap) (infoTree: InfoTree) (ctx : ContextInfo) (info : Info) (steps : List ProofStep) (allGoals : Std.HashSet GoalInfo) (forcedTacticString : String) : MetaM Result := do
  -- 1. Parse tactic
  let .some ctx := info.updateContext? ctx               | panic! "unexpected context node"
  let .ofTacticInfo tInfo := info                        | return { steps, allGoals }
  let .some tacticSubstring := getTacticSubstring tInfo  | return { steps, allGoals }
  let tacticString := if forcedTacticString.length > 0
    then forcedTacticString
    else prettifyTacticString (Substring.Raw.toString tacticSubstring)
  let theorems ← GetTheorems infoTree tInfo ctx
  parseTacticBody fileMap ctx tInfo tacticSubstring steps allGoals tacticString theorems

end Paperproof.Services
