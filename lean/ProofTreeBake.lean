import Lean.Server.InfoUtils
import Lean.Widget.InteractiveGoal
/-!
# ProofTreeBake — hover popups resolved now, for a page with no server

Split out of `ProofTreeHarvest.lean` (2026-10-05) so that a module that may
not import Paperproof or the whole of `Lean` can bake goals too: the
playground's LIVE engine (`PlaygroundLive.lean`, compiled to WebAssembly)
draws its goals with the same tags and popups the baker's do. The harvest
re-exports everything here, so its callers are unchanged. One bake, every
wire — never a copy.
-/

open Lean Elab Meta Server

namespace ProofTree

/-! ## Baking: `WithRpcRef` data resolved now, for a page with no server

The infoview resolves a `SubexprInfo`'s reference on hover by calling core's
`makePopup` (`Lean.Widget.InteractiveDiagnostics.infoToInteractive`). A static
page has no server to call, so the CLI runs the same three questions here, at
harvest time, and prints the answers to plain strings: the expression (as
`makePopup` prints it, explicit), its type, and its docstring. Popups are
INTERNED per declaration — a goal mentions the same `n : ℕ` many times — and
a baked tag carries the popup's index. -/

/-- One baked hover popup. Absent fields are omitted on the wire. -/
structure BakedPopup where
  expr : Option String := none
  type : Option String := none
  doc  : Option String := none
  deriving BEq, Hashable

/-- Absent fields are left out, not `null`: the table is most of a payload's
popups, and the page reads a missing field and a null alike. -/
instance : ToJson BakedPopup where
  toJson p := Json.mkObj <|
    (p.expr.toList.map fun v => ("expr", toJson v)) ++
    (p.type.toList.map fun v => ("type", toJson v)) ++
    (p.doc.toList.map fun v => ("doc", toJson v))

/-- The interning table, threaded through one declaration's bake. -/
structure BakeState where
  popups : Array BakedPopup := #[]
  index  : Std.HashMap BakedPopup Nat := {}

abbrev BakeM := StateT BakeState IO

/-- The expression line of core's popup (`makePopup.ppExprForPopup`, a
`where` helper and so not callable): explicit at the hovered application ONLY
(`withOptionAtCurrPos`, not `pp.explicit` throughout), and an assigned
metavariable shown by its value. Printed plain. -/
def popupExprText (e : Expr) (explicit : Bool) : MetaM String := do
  let aux (e : Expr) (explicit : Bool) : MetaM String := do
    let code ← Widget.ppExprTagged e do
      if explicit then
        PrettyPrinter.Delaborator.withOptionAtCurrPos pp.tagAppFns.name true do
        PrettyPrinter.Delaborator.withOptionAtCurrPos pp.explicit.name true do
        PrettyPrinter.Delaborator.withOptionAtCurrPos pp.mvars.anonymous.name true do
          PrettyPrinter.Delaborator.delabApp
      else
        PrettyPrinter.Delaborator.withOptionAtCurrPos pp.proofs.name true do
        PrettyPrinter.Delaborator.withOptionAtCurrPos pp.sorrySource.name true do
          PrettyPrinter.Delaborator.delab
    return code.stripTags
  if explicit then
    if let .mvar mvarId := e then
      if let some e' ← getExprMVarAssignment? mvarId then
        return ← aux e' false
  aux e explicit

/-- `makePopup`'s three answers, asked now and printed plain: the type (as
`ppExprTagged` prints it), the expression (`popupExprText`, by the same cases
core uses) and the docstring. -/
def bakePopup (i : Elab.InfoWithCtx) : IO BakedPopup :=
  tryCatch (i.ctx.runMetaM i.info.lctx do
      let type? ← match (← i.info.type?) with
        | some ty => some <$> ((·.stripTags) <$> Widget.ppExprTagged ty)
        | none => pure none
      let expr? ← match i.info with
        | .ofTermInfo ti => some <$> popupExprText ti.expr true
        | .ofDelabTermInfo { toTermInfo := ti, explicit, .. } =>
          some <$> popupExprText ti.expr explicit
        | .ofFieldInfo fi => pure (some fi.fieldName.toString)
        | _ => pure none
      return ({ expr := expr?, type := type?, doc := ← i.info.docString? } : BakedPopup))
    (fun _ => pure ({} : BakedPopup))

/-- The index of `p` in the table, adding it if new. -/
def internPopup (p : BakedPopup) : BakeM Nat := do
  let st ← get
  if let some k := st.index[p]? then return k
  let k := st.popups.size
  set ({ popups := st.popups.push p, index := st.index.insert p k } : BakeState)
  return k

/-- A `CodeWithInfos` with every tag's reference baked: the same tagged-text
JSON the infoview receives, with `{"h": k, "diffStatus"?: …}` where the RPC
puts `{"info": <ref>, "subexprPos", "diffStatus"?}`. -/
partial def bakeCode : Widget.CodeWithInfos → BakeM Json
  | .text s => pure (Json.mkObj [("text", toJson s)])
  | .append ts => do
    let parts ← ts.mapM bakeCode
    pure (Json.mkObj [("append", Json.arr parts)])
  | .tag info t => do
    let k ← internPopup (← bakePopup info.info.val)
    let inner ← bakeCode t
    let tag := Json.mkObj ([("h", toJson k)] ++
      (match info.diffStatus? with
        | some d => [("diffStatus", toJson d)]
        | none => []))
    pure (Json.mkObj [("tag", Json.arr #[tag, inner])])

/-- One `InteractiveGoal`, baked into the shape `taggedRender` reads
(`InteractiveGoal`'s RPC JSON with the references replaced). -/
def bakeInteractiveGoal (g : Widget.InteractiveGoal) : BakeM Json := do
  let hyps ← g.hyps.mapM fun h => do
    let mut fields : List (String × Json) :=
      [("names", toJson h.names),
       ("fvarIds", toJson (h.fvarIds.map (·.name.toString))),
       ("type", ← bakeCode h.type)]
    if let some v := h.val? then fields := fields ++ [("val", ← bakeCode v)]
    if let some b := h.isInserted? then fields := fields ++ [("isInserted", toJson b)]
    if let some b := h.isRemoved? then fields := fields ++ [("isRemoved", toJson b)]
    pure (Json.mkObj fields)
  let mut goal : List (String × Json) :=
    [("hyps", Json.arr hyps), ("type", ← bakeCode g.type),
     ("goalPrefix", toJson g.goalPrefix), ("mvarId", toJson g.mvarId.name.toString)]
  if let some u := g.userName? then goal := goal ++ [("userName", toJson u)]
  pure (Json.mkObj goal)

end ProofTree
