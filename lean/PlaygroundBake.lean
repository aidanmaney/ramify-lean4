import Lean
/-!
# PlaygroundBake — feasibility spike for the "baked playground"

A static page that lets a visitor type tactics under a goal and watch the tree
grow, with NO Lean server: every `(goal, tactic)` answer is computed here, once,
by real Lean, and shipped as JSON.

The baker starts from a theorem's statement, makes one goal mvar and runs a
breadth-first search: for each new GOAL (one goal, not a goal list — the tree's
unit is `goalBefore → tactic → goalsAfter`, as Paperproof's `ProofStep` is) it
tries every tactic in a curated candidate list from a saved state, recording the
goals it leaves or its error. Goals are deduplicated by their pretty-printed
form (hypotheses with names + target). Depth cap: tactics from the root.

Core only (`import Lean`, environment `Init`), so it needs nothing but the
toolchain:  `lean --run PlaygroundBake.lean OUTDIR`  (or `lake exe playgroundbake`).

Per-goal hover data is estimated with a slim copy of `bakePopup`
(ProofTreeHarvest.lean, which imports Paperproof and so is not imported here):
every tag of the goal's interactive print gets `{expr, type, doc}`, interned in
ONE table per theorem, as the static viewer's `hovers` table is per record.

SPIKE CODE — not wired into anything. See docs/playground-spike.md.
-/

open Lean Elab Meta Term

namespace Playground

/-- The candidate list every goal is tried against. -/
def candidates : Array String := #[
  "intro n", "intro m", "intro h", "intro p q h", "intro l",
  "induction n", "cases n", "induction l", "cases h", "rename_i k ih",
  "simp", "simp at h", "simp [Nat.add_succ]", "omega", "rfl", "decide",
  "rw [Nat.add_comm]", "constructor", "exact h", "assumption",
  "apply Nat.succ_le_succ", "simp_all",
  -- deliberate mistakes a learner makes
  "exact rfl", "apply And.intro h", "rw [Nat.mul_comm] at h", "exact Nat.le_refl"
]

structure Theorem where
  name : String
  stmt : String

def theorems : Array Theorem := #[
  { name := "zero_add", stmt := "∀ n : Nat, 0 + n = n" },
  { name := "and_swap", stmt := "∀ p q : Prop, p ∧ q → q ∧ p" },
  { name := "append_nil_length", stmt := "∀ l : List Nat, (l ++ []).length = l.length" },
  { name := "le_succ", stmt := "∀ n m : Nat, n ≤ m → n + 1 ≤ m + 1" }
]

/-! ## Hover estimate: a slim `bakePopup` + interning -/

structure Hovers where
  table : Array Json := #[]
  index : Std.HashMap String Nat := {}

def popupOf (i : Elab.InfoWithCtx) : IO Json :=
  tryCatch (i.ctx.runMetaM i.info.lctx do
      let ty ← match (← i.info.type?) with
        | some ty => pure (toJson (toString (← ppExpr ty)))
        | none => pure Json.null
      let ex ← match i.info with
        | .ofTermInfo ti => pure (toJson (toString (← ppExpr ti.expr)))
        | _ => pure Json.null
      let doc ← match (← i.info.docString?) with
        | some d => pure (toJson d)
        | none => pure Json.null
      return Json.mkObj [("expr", ex), ("type", ty), ("doc", doc)])
    (fun _ => pure Json.null)

partial def bakeCode (hv : IO.Ref Hovers) : Widget.CodeWithInfos → IO Json
  | .text s => pure (Json.mkObj [("text", toJson s)])
  | .append ts => do
    pure (Json.mkObj [("append", Json.arr (← ts.mapM (bakeCode hv)))])
  | .tag info t => do
    let p ← popupOf info.info.val
    let key := p.compress
    let st ← hv.get
    let k ← match st.index[key]? with
      | some k => pure k
      | none => do
        hv.set { table := st.table.push p, index := st.index.insert key st.table.size }
        pure st.table.size
    pure (Json.mkObj [("tag", Json.arr #[Json.mkObj [("h", toJson k)], ← bakeCode hv t])])

/-! ## The BFS -/

structure GoalRec where
  id     : Nat
  hyps   : Array (String × String)   -- (names, type) as the infoview groups them
  target : String
  depth  : Nat
  tagged : Json := Json.null          -- the hover estimate's tagged print
  deriving Inhabited

inductive Outcome where
  | goals (ids : Array Nat)
  | error (msg : String)

structure Bake where
  goals   : Array GoalRec := #[]
  keyIdx  : Std.HashMap String Nat := {}
  /-- alpha-normalised key → first goal id, to measure what canonical naming saves -/
  alphaKeys : Array (Expr × Nat) := #[]
  alphaDupes : Nat := 0
  steps   : Array (Nat × String × Outcome) := #[]

def ppKey (g : MVarId) : MetaM (String × Array (String × String) × String) := g.withContext do
  let lctx ← getLCtx
  let mut hyps : Array (String × String) := #[]
  for d in lctx do
    if d.isImplementationDetail then continue
    -- the name as the infoview prints it: a hygienic name is `n✝`, never `n._@._hyg.74`
    let nm := if d.userName.hasMacroScopes then d.userName.eraseMacroScopes.toString ++ "✝"
      else d.userName.toString
    hyps := hyps.push (nm, toString (← ppExpr (← instantiateMVars d.type)))
  let tgt := toString (← ppExpr (← instantiateMVars (← g.getType)))
  -- the key is the infoview's own print (`ppGoal`: grouping, shadowing `n✝`)
  let key := toString (← ppGoal g)
  return (key, hyps, tgt)

/-- The goal closed over its context: equal up to binder NAMES (`Expr.eqv`
ignores them) iff the goals differ only in the names the visitor chose. -/
def alphaExpr (g : MVarId) : MetaM Expr := g.withContext do
  let fvars := (← getLCtx).foldl (init := #[]) fun acc d =>
    if d.isImplementationDetail then acc else acc.push d.toExpr
  instantiateMVars (← mkForallFVars fvars (← instantiateMVars (← g.getType)))

def hasSorry (g : MVarId) : MetaM Bool := g.withContext do
  let t ← instantiateMVars (← g.getType)
  if t.hasSorry then return true
  for d in ← getLCtx do
    if (← instantiateMVars d.type).hasSorry then return true
  return false

/-- Canonical naming: instead of one `intro x` per name a visitor might pick,
ONE `intro` per goal, naming the binder as the statement does (an arrow's
anonymous binder becomes `h`, made unused). The client maps the visitor's own
names onto these by renaming. -/
def canonicalIntro (g : MVarId) : MetaM (Option String) :=
  tryCatchRuntimeEx (withCurrHeartbeats <| g.withContext do
  let t ← whnfR (← instantiateMVars (← g.getType))
  match t with
  | .forallE n _ _ _ =>
    let base := if n.isAnonymous || n.hasMacroScopes
      then `h else n.eraseMacroScopes
    return some s!"intro {(← getLCtx).getUnusedName base}"
  | _ => return none) (fun _ => pure none)

/-- Run one tactic on one goal from the current state: the goals it leaves, or
the first error. Runtime exceptions (recursion depth, heartbeats) are caught. -/
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
      for g' in gs do
        if ← hasSorry g' then return Except.error "(produced sorry)"
      return Except.ok gs)
    (fun (e : Exception) => do return Except.error (← e.toMessageData.toString))

def bakeTheorem (thm : Theorem) (maxDepth : Nat) (canon : Bool) (hv : IO.Ref Hovers) :
    TermElabM (Bake × Nat × Nat) := do
  let env ← getEnv
  let stx ← match Parser.runParserCategory env `term thm.stmt with
    | .ok s => pure s
    | .error e => throwError "parse {thm.stmt}: {e}"
  let ty ← elabType stx
  synthesizeSyntheticMVarsNoPostponing
  let ty ← instantiateMVars ty
  let root ← mkFreshExprMVar ty (kind := .syntheticOpaque)
  let bake ← IO.mkRef ({} : Bake)
  -- queue: (goal record id, mvar, saved state it lives in)
  let mut queue : Array (Nat × MVarId × Term.SavedState) := #[]
  let intern (g : MVarId) (depth : Nat) : TermElabM (Nat × Bool) := withCurrHeartbeats do
    let (key, hyps, tgt) ← ppKey g
    let b ← bake.get
    if let some id := b.keyIdx[key]? then return (id, false)
    let id := b.goals.size
    let ae ← alphaExpr g
    let dup := b.alphaKeys.any (·.1.eqv ae)
    -- tagged print + hover table (the estimate)
    let ig ← Widget.goalToInteractive g
    let tagged ← do
      let hs ← ig.hyps.mapM fun h => do
        pure (Json.mkObj [("names", toJson h.names), ("type", ← bakeCode hv h.type)])
      pure (Json.mkObj [("hyps", Json.arr hs), ("type", ← bakeCode hv ig.type)])
    bake.set { b with
      goals := b.goals.push { id, hyps, target := tgt, depth, tagged }
      keyIdx := b.keyIdx.insert key id
      alphaKeys := if dup then b.alphaKeys else b.alphaKeys.push (ae, id)
      alphaDupes := b.alphaDupes + (if dup then 1 else 0) }
    return (id, true)
  let (rid, _) ← intern root.mvarId! 0
  queue := queue.push (rid, root.mvarId!, ← saveState)
  let mut tried := 0
  let mut timedOut := 0
  let mut qi := 0
  while qi < queue.size do
    let some (gid, g, st) := queue[qi]? | break
    qi := qi + 1
    let gs0 := (← bake.get).goals
    let depth := match gs0[gid]? with | some r => r.depth | none => 0
    if depth ≥ maxDepth then continue
    st.restore (restoreInfo := true)
    let cands ← if canon then do
        let fixed := candidates.filter (!·.startsWith "intro ")
        pure (match ← canonicalIntro g with | some i => #[i] ++ fixed | none => fixed)
      else pure candidates
    for tac in cands do
      tried := tried + 1
      st.restore (restoreInfo := true)
      modifyThe Core.State fun s => { s with messages := {} }
      -- run the tactic; runtime exceptions (recursion, heartbeats) are caught too
      let res : Except String (List MVarId) ← match Parser.runParserCategory env `tactic tac with
        | .error e => pure (.error s!"parse: {e}")
        | .ok tstx =>
          runOne g tstx
      let outcome ← match res with
        | .error m => do
          if (m.splitOn "heartbeats").length > 1 || (m.splitOn "recursion").length > 1 then
            timedOut := timedOut + 1
          pure (Outcome.error m)
        | .ok gs => do
          let after ← saveState
          let mut ids := #[]
          for g' in gs do
            let (id, fresh) ← intern g' (depth + 1)
            ids := ids.push id
            if fresh then queue := queue.push (id, g', after)
          pure (Outcome.goals ids)
      bake.modify fun b => { b with steps := b.steps.push (gid, tac, outcome) }
  return (← bake.get, tried, timedOut)

def toJsonBake (thm : Theorem) (b : Bake) (withHovers : Bool) (hv : Hovers) : Json :=
  let goals := b.goals.map fun g =>
    let base := [("id", toJson g.id),
      ("hyps", Json.arr (g.hyps.map fun (n, t) => Json.arr #[toJson n, toJson t])),
      ("target", toJson g.target)]
    Json.mkObj (if withHovers then base ++ [("tagged", g.tagged)] else base)
  -- error texts are interned: most errors repeat (`Unknown identifier \`h\``)
  let (msgs, steps) := b.steps.foldl (init := ((#[] : Array String), (#[] : Array Json)))
    fun (msgs, acc) (gid, tac, o) =>
      match o with
      | .goals ids => (msgs, acc.push (Json.arr #[toJson gid, toJson tac, toJson ids]))
      | .error m =>
        let (msgs, k) := match msgs.idxOf? m with
          | some k => (msgs, k)
          | none => (msgs.push m, msgs.size)
        (msgs, acc.push (Json.arr #[toJson gid, toJson tac, Json.mkObj [("e", toJson k)]]))
  Json.mkObj ([("theorem", toJson thm.name), ("statement", toJson thm.stmt),
    ("goals", Json.arr goals), ("steps", Json.arr steps), ("errors", toJson msgs)] ++
    (if withHovers then [("hovers", Json.arr hv.table)] else []))

end Playground

open Playground in
unsafe def main (args : List String) : IO UInt32 := do
  let outDir := args.headD "playground-out"
  let maxDepth := (args.drop 1).head?.bind String.toNat? |>.getD 4
  let canon := (args.drop 2).head? == some "canon"
  IO.FS.createDirAll outDir
  initSearchPath (← findSysroot)
  enableInitializersExecution
  let env ← importModules (loadExts := true) #[{ module := `Init }] {}
  for thm in theorems do
    let t0 ← IO.monoMsNow
    let hv ← IO.mkRef ({} : Hovers)
    let opts : Options := maxHeartbeats.set ({} : Options) 20000
    let ctx : Core.Context := {
      fileName := "<playground>", fileMap := default, options := opts,
      maxHeartbeats := 20000 * 1000, maxRecDepth := 4000 }
    let act : CoreM (Bake × Nat × Nat) :=
      (bakeTheorem thm maxDepth canon hv).run' {} |>.run' {}
    let ((b, tried, timedOut), _) ← act.toIO ctx { env }
    let t1 ← IO.monoMsNow
    let errs := b.steps.foldl (fun n (_, _, o) => match o with | .error _ => n + 1 | _ => n) 0
    let hvs ← hv.get
    let plain := (toJsonBake thm b false hvs).compress
    let full := (toJsonBake thm b true hvs).compress
    IO.FS.writeFile s!"{outDir}/{thm.name}.json" plain
    IO.FS.writeFile s!"{outDir}/{thm.name}.hovers.json" full
    IO.println s!"{thm.name}: goals={b.goals.size} steps={b.steps.size} tried={tried} errors={errs} ok={b.steps.size - errs} alphaDupes={b.alphaDupes} timeouts={timedOut} popups={hvs.table.size} ms={t1 - t0} plainBytes={plain.utf8ByteSize} fullBytes={full.utf8ByteSize}"
  return 0
