import Lean
import Services.BetterParser
import ProofTreeComments

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
    `comments` and `calcHoles` are ours (not the parser's): the command's source
    comments, for the renderer's comment strips, and the unproved `calc` links,
    for its per-link (+) chips (both from ProofTreeComments.lean). -/
def resultToJson (r : Result) (comments : Array ProofTree.SourceComment)
    (calcHoles : Array ProofTree.CalcHole) : Json :=
  Json.mkObj [
    ("steps",    toJson r.steps),          -- List ProofStep  (ToJson derived upstream)
    ("allGoals", toJson r.allGoals.toList), -- flatten the goal set into an array
    ("comments", toJson comments),
    ("calcHoles", toJson calcHoles)
  ]

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
  let mut out := #[]
  let mut idx := 0
  for tree in trees do
    match ← runParser finalEnv fileMap tree with
    | some r =>
        -- Drop trees that produced no proof (keeps output to real theorems only).
        if !(r.steps.isEmpty && r.allGoals.isEmpty) then
          -- The command's comments ride along; the InfoTree never holds them
          -- (they're parser trivia), so re-lex the command's source range.
          let comments := match ProofTree.commandRange tree with
            | some range => ProofTree.commentsInRange src fileMap range
            | none => #[]
          -- Unproved calc links, for the renderer's per-link (+) chips. Unlike
          -- the widget's tagged goals these are plain data, so they ride the
          -- CLI wire too (which is what lets a probe check them offline).
          let calcHoles := ProofTree.collectCalcHoles fileMap tree
          out := out.push (Json.mkObj
            [("index", toJson idx), ("proof", resultToJson r comments calcHoles)])
    | none => pure ()
    idx := idx + 1
  return out

end Ppharness
