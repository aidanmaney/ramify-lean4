import Lean
import Services.BetterParser
import ProofTreeComments
import ProofTreeRecover
import ProofWidgets.Component.Basic
import ProofWidgets.Component.Panel.Basic

/-!
# ProofTreeWidget

A Lean **infoview user-widget** that renders the same proof tree as the standalone
web app (`web/`), but in-process: no NDJSON, no CLI. It is the RPC counterpart of
`Ppharness` — where the CLI elaborates a file itself and serialises `Result` to
NDJSON, here the *live* Lean server already holds the elaborated `InfoTree`, so we
run the very same `BetterParser_Tree` over `snap.infoTree` and hand the result to
the React renderer over the LSP/RPC bridge.

Two halves:

* `getProofTree` — a `@[server_rpc_method]` the widget JS calls (by the string
  `"ProofTree.getProofTree"`) with the cursor position. It returns the parsed
  proof tree for the theorem under the cursor. This is `Paperproof.getSnapshotData`
  (`.tree` mode) minus the single-tactic branch, plus `allGoals`.
* `ProofTreeWidget` — a `@[widget_module]` bound to the bundled renderer
  (`web/dist/proofTreeWidget.js`). Shown with `show_panel_widgets [ProofTreeWidget]`,
  it is handed `PanelWidgetProps` (which carries the cursor `pos`, including the
  document `uri`) by the infoview on every cursor move — that is the source→tree
  half of the bidirectional link. The tree→source half (reveal a tactic's span on
  click) is done JS-side via the infoview `EditorContext`, using `ProofStep.position`.

The widget bundle is a build input via `include_str`, so run `npm run build:widget`
in `web/` before `lake build`. See CLAUDE.md.
-/

open Lean Elab Meta Server RequestM ProofWidgets

namespace ProofTree

/-- A goal's `Widget.InteractiveGoal` (tagged pretty-printed type + hypotheses),
keyed by the same mvarId string as `GoalInfo.id`. This is what powers the
infoview-style hover tooltips: each subterm tag carries a `WithRpcRef InfoWithCtx`
that the JS `<InteractiveCode>` resolves on hover via `infoToInteractive`. -/
structure TaggedGoalEntry where
  goalId : String
  goal   : Widget.InteractiveGoal
  deriving Server.RpcEncodable

/-- A source span in the shape the CLIENT reads every span in: `{start, stop}`.
Deliberately not `Lsp.Range`, whose derived `ToJson` emits `end` — see
`ProofTreeData.declRange`. -/
structure DeclRange where
  start : Lsp.Position
  stop  : Lsp.Position
  deriving Server.RpcEncodable

/-- One diagnostic of the declaration under the cursor, in the client's own
span shape.

This RIDES THE PAYLOAD instead of being read off `textDocument/publishDiagnostics`
client-side, and the reason is a race that made the feature look haunted:
the notification is EDGE-triggered, and a webview subscribes only after it
loads — so whenever elaboration finished first (a restart on a small file,
reliably), no notification ever arrived and the tree drew nothing until the
next edit. Diagnostics in the payload are LEVEL-triggered: they arrive with
every response, so the drawn errors can never be out of step with the drawn
tree.

The source is `doc.diagnosticsRef` — the very ref the publish path and
`getInteractiveDiagnostics` serve, so nothing here can disagree with the
editor's own squiggles. NOT `snap.msgLog`, which was the first attempt and is
EMPTY on this path (see the read site in `getProofTree`). -/
structure TreeDiag where
  /-- As published: a multi-line message's end is truncated to `{line+1, 0}`
  (a VS Code squiggly workaround). Everything client-side anchors on
  `range.start`, which equals `fullRange.start`. -/
  range     : DeclRange
  /-- Same start, true end. -/
  fullRange : DeclRange
  /-- LSP numbering: 1 error, 2 warning, 3 information. -/
  severity  : Nat
  message   : String
  isSilent  : Bool := false
  /-- Mirrors `Lean.Lsp.LeanDiagnosticTag`: 1 unsolvedGoals, 2
  goalsAccomplished — read off the message's own tags, exactly as
  `msgToInteractiveDiagnostic` does. -/
  leanTags  : Array Nat := #[]
  deriving Server.RpcEncodable

/-- The hover popup seam for ONE token of a tactic's source: the token's span
plus a `CodeWithInfos` whose single tag carries the very `InfoWithCtx` the
editor's own hover would use for that position, wrapping the token's *source*
text.

The point of the shape is total reuse. `InteractiveCode` on the JS side renders
the tagged text and, on hover, resolves the tag through
`Lean.Widget.InteractiveDiagnostics.infoToInteractive` — the same RPC that
powers the goal-label tooltips and the editor's hover. So a token here gets the
native popup (type, docs, links) without a bespoke popup component, and because
the tagged text is the SOURCE text rather than a pretty-printed expression, what
is drawn is byte-identical to what the layout measured. -/
structure TacticTokenInfo where
  -- The token's START alone identifies it: the client joins `tokenInfos` onto
  -- `TacticEdit.tokens` by start position (a token's extent is already on the
  -- edit entry), so a stop here would be dead weight on the wire.
  start : Lsp.Position
  -- Exactly one of `code`/`doc` is set. `code` is the interactive path: a
  -- `.tag` carrying the info node the editor's hover would resolve. `doc` is
  -- the PARSER-DOCSTRING path — the half of `handleHover` the tag cannot
  -- express, because the docstring lives on a syntax KIND (`by` →
  -- `Lean.Parser.Term.byTactic`), not on any info node the hover index could
  -- point at. Shipping it as a plain string is not a shortcut: there is no
  -- `InfoWithCtx` to reference, so a ref-shaped carrier would have to
  -- fabricate one. See the decision rule at the emit site.
  code  : Option Widget.CodeWithInfos := none
  doc   : Option String := none
  deriving Server.RpcEncodable

/-- The DECLARATION NAME under the cursor (`example` and friends fall back to
the command's byte offset).

This is the proof's identity for the client, and it exists because the obvious
answer is wrong in a way that only shows up under editing: the root goal's
mvarId was standing in for it, and an mvarId is an ELABORATION-ORDER artifact.
Measured — adding one `calc` link to a theorem changed its own root id (the
extra `?_` shifts allocation) and renumbered every mvarId in the theorem BELOW
it in the file, 34 of 34. The client resets scroll and re-centres when this
changes, so a proof that "changed identity" mid-edit scrolled the author back
to the top of the proof they were editing. A name does not move when its body
does. -/
-- Not `private`: an offline probe checks it against real command syntax.
partial def declName? (stx : Syntax) : Option Name :=
  match stx with
  | .node _ k args =>
    if k == ``Lean.Parser.Command.declId && args.size > 0 then
      some args[0]!.getId
    else args.foldl (fun acc a => acc <|> declName? a) none
  | _ => none

/-- The wire payload sent to the renderer: the CLI's `{ steps, allGoals }` shape
plus `taggedGoals`, the interactive (tagged) rendering of each goal. The tagged
half contains live RPC references, so the whole payload derives
`Server.RpcEncodable` rather than `ToJson` (the Paperproof structs still encode
via their derived `FromJson`/`ToJson` through the blanket instance) — and it is
exactly the part that can never ride the CLI's NDJSON. The document `uri` is
*not* included: the panel widget already receives it in `props.pos`. -/
structure ProofTreeData where
  steps       : List Paperproof.Services.ProofStep
  allGoals    : List Paperproof.Services.GoalInfo
  taggedGoals : Array TaggedGoalEntry := #[]
  -- The command's source comments (parser trivia, so re-lexed from the raw
  -- source — see ProofTreeComments.lean); the client attributes them to nodes.
  comments    : Array SourceComment := #[]
  -- Per-tactic tight ranges + verbatim text for in-place editing (see
  -- TacticEdit). Widget-only, like taggedGoals: the CLI has no editor.
  tacticEdits : Array TacticEdit := #[]
  -- Hover popups for identifier tokens inside tactics (see TacticTokenInfo).
  -- Like taggedGoals, these hold live RPC references, so they are widget-only.
  tokenInfos  : Array TacticTokenInfo := #[]
  -- Every tactic-sequence child, for the tree's delete gesture (see
  -- TacticSlot). Plain data, so it rides the CLI wire too (`resultToJson` in
  -- Ppharness.lean) even though the standalone app draws no delete affordance:
  -- that is what lets a probe run the REAL client-side extent maths offline.
  -- Keep the two emit sites in step. The client joins these by CONTAINMENT
  -- rather than by a step key, so the whole set ships rather than one entry
  -- per step.
  deleteSlots : Array TacticSlot := #[]
  -- Holes the author wrote (`?_`, `?foo`), so the tree's chips can fill one
  -- exactly where it sits instead of appending a line after the term it is
  -- missing from. Plain data, so it rides the CLI wire too.
  holes       : Array Hole := #[]
  -- Where a chain that stops SHORT of its goal continues, so the residue goal's
  -- chip can append a link instead of abandoning the chain. Plain data too.
  calcChains  : Array CalcChain := #[]
  -- Which relations a chain on each PENDING goal could be built out of, from
  -- the real `Trans` instances (see collectCalcRelations). An entry with empty
  -- `options` means "looked, not chainable"; no entry at all means the wire
  -- didn't ship this and the client falls back to its string heuristic.
  calcRelations : Array CalcRelations := #[]
  -- Stable identity of the proof under the cursor (see `declName?`): what the
  -- client keys "is this a different proof?" on, instead of a metavariable id.
  proofId       : String := ""
  -- Every tactic's name, for the in-place editor's completion list (see
  -- `tacticNames`). Environment-only — it does not depend on the cursor or on
  -- which goal is being edited — so it rides the once-per-edit cache rather
  -- than being recomputed per keystroke.
  tacticNames   : Array String := #[]
  /-- The whole DECLARATION's span (`snap.stx`, the command), not the tactics'.
  The client tells this proof's diagnostics from a neighbouring theorem's with
  it, and a span derived from the steps will not do: `declaration uses 'sorry'`
  is reported on the declaration NAME, above every tactic in the proof.

  `DeclRange`, NOT `Lsp.Range`, and that is the whole point of the structure:
  `Lsp.Range`'s second field is `end`, so its derived `ToJson` emits
  `{start, end}` while every range the client reads is `{start, stop}`
  (`ProofStepPosition`). Hit for real — the field decoded to a span whose
  `stop` was `undefined`, and the client's position compare read `.line` off
  it. The CLI wire never had the bug because it hand-serializes this field and
  renames `end` to `stop` there (Ppharness.lean); the two wires disagreeing on
  one field's key is exactly what "the wire format is a cross-language
  contract" is about. -/
  declRange     : Option DeclRange := none
  /-- Which steps the SUPPLEMENTAL parser synthesized (failed/skipped/term),
  keyed by `position.start` — `ProofStep` is upstream's type and cannot grow a
  field. The client styles these dashed and, for `failed`, in danger ink. -/
  recovered     : Array ProofTree.Recover.RecoveredStep := #[]
  /-- This DECLARATION's diagnostics (see `TreeDiag` for why they ride the
  payload rather than the publish notification). Scoped to the command
  snapshot's own `msgLog`, which is exactly the span the client filter keeps. -/
  diagnostics   : Array TreeDiag := #[]
  /-- COUNTERFACTUAL marker: when set, this payload's tree was elaborated from
  the document with line `cfLine`'s content replaced by `sorry` — the live
  preview shown while the author is mid-typing a tactic and the real document
  does not elaborate. The client keys the stub node's identity on this (it is
  stable across keystrokes, so it belongs in the text signature); the DRAFT —
  the real line's current content — deliberately rides the separate `cfDraft`
  field below, which the client must keep OUT of the signature or every
  keystroke would defeat the typing hold this exists to serve. -/
  cfLine        : Option Nat := none
  /-- The real document's current content on `cfLine` (indent stripped),
  refreshed per request even when the tree itself comes from the cache. Paint
  only, never part of the client's stable signature. -/
  cfDraft       : Option String := none
  /-- A counterfactual is being elaborated in the background for this state;
  the client may re-poll shortly instead of waiting for the next document
  event. -/
  cfPending     : Bool := false
  deriving Server.RpcEncodable

/-- Every tactic's user-facing name, for the in-place editor's completion list.

This is what `Lean.Server.Completion.tacticCompletion` is built from — it maps
`allTacticDocs` into `ResolvableCompletionItem`s — so taking the names directly
skips the LSP item machinery (and the docstrings, which are the bulk of the
cost) for a list the client only ever matches a prefix against. Measured, the
full collector is 215ms for 494 items.

Environment-only: it depends on which tactics are imported, not on the cursor or
on any goal, so it is computed once per `getProofTree` and rides
`proofTreeCache` — i.e. once per EDIT, never per keystroke. Not `private`: an
offline probe checks the count. -/
def tacticNames (ctx : Elab.ContextInfo) : IO (Array String) :=
  ctx.runMetaM .empty do
    return (← Tactic.Doc.allTacticDocs).map (·.userName)

/-- Parameters for `getProofTree`: the cursor position, plus whether the client
wants the counterfactual preview (`proofTree.counterfactual`, decided
client-side since settings ride the companion channel). The widget passes the
whole `DocumentPosition`; the extra `uri` field is ignored when decoding as an
`Lsp.Position`. -/
structure GetProofTreeParams where
  pos : Lsp.Position
  cf  : Bool := true
  deriving ToJson

/-- Hand-written for the theme-channel reason (`ThemeColors` below): the two
ends can ship separately, and a derived instance makes a MISSING `cf` key an
error rather than the default — an older bundle sends `{pos}` alone. -/
instance : FromJson GetProofTreeParams where
  fromJson? j := do
    let pos ← j.getObjValAs? Lsp.Position "pos"
    let cf := match j.getObjVal? "cf" >>= fromJson? with
      | .ok b => b
      | .error _ => true
    return { pos, cf }

/-- Collect an `InteractiveGoal` for every goal mentioned by any tactic in the
info tree, keyed by mvarId string (= `GoalInfo.id` on the wire).

This is the additive counterpart of the vendored parser's `printGoalInfo`, which
computes the very same tagged pretty-print (`ppExprWithInfos`) and then discards
the tags with `.fmt.pretty`. Rather than forking the parser, we re-walk the tree
here and keep them: for each `TacticInfo` print its goals with `mctxAfter` —
matching `BetterParser`'s `printCtx`, so the tagged text and the plain `GoalInfo`
strings agree. A goal that fails to print (e.g. not in this `mctx`) is simply
skipped; the client falls back to plain text.

Several tactics mention the same goal, so it is printed several times, and
which print we keep is NOT arbitrary: `mctxAfter` means a metavariable assigned
later is still open in the earlier print, so the producing tactic's print of
`a ≤ ?m` and the consuming tactic's print of `a ≤ 5` are both here. It used to
be first-wins, which took the `?m` one.

`wanted` is the plain string the CLIENT will draw for each goal — it applies
the same fewest-`mvarOccurrences` rule to the strings on the wire — and an
exact match against it is what we keep. Preferring the most resolved print
HERE, independently, would very nearly agree and is the fallback, but only
nearly: this walk sees every `TacticInfo` while the wire carries only
Paperproof's steps, so the minimum can be a print the client never had. A
disagreement is not an error, it is silence — the text-equality guard drops the
goal to plain SVG, losing its type tooltips exactly where a metavariable makes
them worth most. -/
def collectTaggedGoals (infoTree : InfoTree)
    (wanted : Std.HashMap String String := {}) : IO (Array TaggedGoalEntry) := do
  let tacticNodes := infoTree.foldInfo (init := #[]) fun ctx info acc =>
    if let .ofTacticInfo ti := info then acc.push (ctx, ti) else acc
  -- Lower is better: an exact match with what the client draws beats every
  -- near miss, and among near misses the most resolved wins.
  let mut best : Std.HashMap String (Nat × TaggedGoalEntry) := {}
  for (ctx, ti) in tacticNodes do
    let printCtx := { ctx with mctx := ti.mctxAfter }
    for mvarId in ti.goalsBefore ++ ti.goalsAfter do
      let key := mvarId.name.toString
      let cur := best[key]?
      -- Nothing beats an exact match, so stop looking for this goal.
      if let some (0, _) := cur then continue
      let goal? ← try
          some <$> printCtx.runMetaM {} (Widget.goalToInteractive mvarId)
        catch _ => pure none
      if let some goal := goal? then
        let text := goal.type.stripTags
        let score :=
          if wanted[key]? == some text then 0
          else 1 + ProofTree.mvarOccurrences text
        if cur.all (fun (s, _) => score < s) then
          best := best.insert key (score, { goalId := key, goal })
  return best.toArray.map fun (_, (_, e)) => e

/-- Semantic tokens for NUMERIC LITERALS.

The same gap as `collectConstIdentTokens`, from the other end.
`collectSyntaxBasedSemanticTokens` pushes a keyword token only for an atom
whose first character `isIdFirst` (or `#`), so a numeral is skipped outright —
measured over `calc (a + b) ^ 2`, the characters left with NO token at all are
exactly `( + ) ^ 2`. In the editor that does not matter: the lean4 TextMate
grammar has a `constant.numeric.lean4` rule and paints numbers from it. We have
no grammar, so without this a literal renders in plain foreground while the
buffer shows it coloured — the one visible difference left after the palette
itself became theme-accurate.

Brackets and operators are deliberately NOT filled in here: the grammar has no
rules for them either, so they are unscoped in the buffer too and fall to the
editor foreground, which is already what the tree paints them. (What colours
them in the buffer is bracket-pair colourisation, a separate mechanism handled
client-side — see `renderTacticTokens`.) -/
partial def collectNumberTokens (stx : Syntax) : Array FileWorker.LeanSemanticToken :=
  match stx with
  | .atom info val =>
    -- `.original` only, so macro-generated numerals (which have no source span
    -- to colour) are skipped, matching every other collector here.
    if val.length > 0 && val.front.isDigit && (info matches .original ..) then
      #[{ stx, type := Lsp.SemanticTokenType.number }]
    else #[]
  | .node _ _ args => args.flatMap collectNumberTokens
  | _ => #[]

/-- Semantic tokens for CONSTANT identifiers — `Nat.Prime`,
`Nat.strong_induction_on`, `Nat.add_zero`.

The server's own `collectInfoBasedSemanticTokens` deliberately emits tokens
only for identifiers bound to local `fvar`s and for field projections; a
constant gets nothing, because in the editor those are coloured by the
TextMate grammar rather than by semantic tokens — WHICH IS FALSE (the shipped
lean4 grammar has no identifier rule at all; a qualified constant is plain
foreground in the buffer), but the tokens must exist regardless: the token
list is also what carries the hover popups, so without this every constant in
a tactic silently had no tooltip. They ride the pipeline as `.function` and
are reclassified to `"const"` at the WIRE (see `wireTokenType` in
getProofTree), which the client leaves unpainted — plain like the buffer —
while the popup survives. Mirrors upstream's shape (`deepestNodes`, an
`.original` head so macro-generated syntax is skipped) and leaves overlap
resolution to `handleOverlappingSemanticTokens` as usual. -/
def collectConstIdentTokens (tree : InfoTree) : Array FileWorker.LeanSemanticToken :=
  List.toArray <| tree.deepestNodes fun _ info _ => do
    let .ofTermInfo ti := info | none
    let .original .. := ti.stx.getHeadInfo | none
    guard ti.stx.isIdent
    -- `.getAppFn` because an ident often elaborates to the constant already
    -- applied to its implicit arguments.
    guard ti.expr.getAppFn.isConst
    return { stx := ti.stx, type := Lsp.SemanticTokenType.function }

/-- The tokens the widget colours (and hangs hover popups on): exactly the pair
the editor's `textDocument/semanticTokens` request uses, plus our constant
identifiers. Shared with the offline probe so both exercise one code path. -/
def semanticTokensFor (fileMap : FileMap) (stx : Syntax) (tree : InfoTree)
    : Array FileWorker.AbsoluteLspSemanticToken :=
  FileWorker.handleOverlappingSemanticTokens <|
    FileWorker.computeAbsoluteLspSemanticTokens fileMap ⟨0⟩ none <|
      FileWorker.collectSyntaxBasedSemanticTokens fileMap stx
        ++ FileWorker.collectInfoBasedSemanticTokens tree
        ++ collectConstIdentTokens tree
        ++ collectNumberTokens stx

/-- Every `TacticInfo`'s source range, as byte offsets. Used to find the
SURFACE tactic a split step belongs to (see `surfaceTacticRange`). -/
def collectTacticRanges (tree : InfoTree) : Array (Nat × Nat) :=
  tree.foldInfo (init := #[]) fun _ info acc =>
    match info, info.stx.getRange? (canonicalOnly := true) with
    | .ofTacticInfo _, some r => acc.push (r.start.byteIdx, r.stop.byteIdx)
    | _, _ => acc

/-- The range of the tactic a step was SPLIT out of, or none when the step is a
tactic in its own right.

Paperproof emits one step per rewrite rule, so the steps of `rw [h, hk]` have
ranges covering `h,` and `hk` — a range nobody wrote, useless to edit and
missing the `rw` keyword whose docstring is the whole point of hovering it.

The answer is the SMALLEST `TacticInfo` that contains the step's tight range
and starts strictly before it, subject to two further conditions. Each rules
out a real construct that would otherwise be swallowed, and neither is
sufficient alone:

* **its first token must be the step LABEL's first token.** The smallest strict
  container of an `induction n with` step (whose range is truncated at the
  first case marker) is the enclosing `by` block, and of an `omega` inside
  `| succ k ih => omega` it is the whole `induction`. A split step, by
  contrast, is always labelled after the tactic it came out of — that is what
  makes the label alignable against the widened source at all.
* **it must start on the step's own LINE.** Nested `have … := by have … ` puts
  a `have` step inside an outer `have` whose head token matches, and only the
  line rules it out. The cost is that a `rw` broken across lines widens only
  for the rules on its first line; the rest keep the old per-rule behaviour.

Containment must be tested against the step's TIGHT end (`trimmedEnd`): a
Paperproof range runs into the following trivia, so a step sitting at the very
end of its tactic — the synthetic `rfl` closing an `rw`, whose range is the
bare `]` — stops PAST the tactic that owns it and would never widen.

An earlier version anchored on `tacticIndentAt` instead of on containment.
That is the wrong tool: it deliberately does not skip a `| case =>` marker (it
exists to place INSERTIONS), so on `| succ d hd => rw [Nat.add_succ, hd]` — a
perfectly ordinary line — it pointed at the `|` and nothing widened at all. -/
def surfaceTacticRange (fileMap : FileMap) (src : String) (ranges : Array (Nat × Nat))
    (pos : Lsp.Position) (label : String) (b e : String.Pos.Raw)
    : Option (Nat × Nat) := Id.run do
  -- The head token: up to the first space or opening bracket. Enough to say
  -- "this label is about that tactic" without parsing either.
  let head (s : String) : String := Id.run do
    let t := s.dropWhile Char.isWhitespace
    return (t.takeWhile fun c => !c.isWhitespace && c != '[' && c != '(').toString
  let want := head label
  if want.isEmpty then
    return none
  let lineStart := (fileMap.lspPosToUtf8Pos ⟨pos.line, 0⟩).byteIdx
  let mut best : Option (Nat × Nat) := none
  for (rb, re) in ranges do
    if lineStart ≤ rb && rb < b.byteIdx && re ≥ e.byteIdx then
      if head (String.Pos.Raw.extract src ⟨rb⟩ ⟨re⟩) == want then
        if best.all fun (bb, be) => re - rb < be - bb then
          best := some (rb, re)
  return best

/-- Would the editor's own hover consider this info node? Mirrors the
eligibility test inside `InfoTree.hoverableInfoAt?`: anything carrying
elaborator info, plus field/option/error-name nodes, minus the `nullKind` and
`withAnnotateState` nodes tactics use to steer which goal the infoview shows.

Deliberately NOT restricted to `TermInfo`. `makePopup` — the server side of
`infoToInteractive` — ends with `doc := ← i.info.docString?`, which is
populated for ANY info kind, so a `TacticInfo` yields the tactic's own
documentation. That is what puts a real popup on `induction`, `simp` and
friends rather than only on identifiers. -/
def hoverEligible (info : Elab.Info) : Bool :=
  !info.stx.isOfKind nullKind
  && !info.toElabInfo?.any (·.elaborator == `Lean.Elab.Tactic.evalWithAnnotateState)
  && ((info matches .ofFieldInfo _ | .ofOptionInfo _ | .ofErrorNameInfo _)
      || info.toElabInfo?.isSome)

/-- A synthetic `sorry` has no meaningful popup; `hoverableInfoAt?` drops these
too. -/
def isSyntheticSorryInfo (info : Elab.Info) : Bool :=
  match info with
  | .ofTermInfo ti => ti.expr.isSyntheticSorry
  | _              => false

/-- The PARSER-DOCSTRING half of the editor's hover — the half `tokenInfos`'
info-node tags cannot express, verbatim from `handleHover`
(`Lean/Server/FileWorker/RequestHandling.lean`): walk the syntax stack over the
position innermost-first and take the first NODE whose syntax kind has a
docstring.

This is what puts text on `by` in the buffer: the innermost info node over a
`by` is a 2-byte `TacticInfo` whose stx is the bare ATOM `by` — `getKind` on an
atom is the meaningless name `by`, and `findDocString?` on it is `none` — while
the docstring sits on the KIND of the node one level up,
`Lean.Parser.Term.byTactic`. No width-minimising search over info nodes can
find that; only the syntax walk can. Not `private`: the offline probe replays
`handleHover`'s decision against this. -/
def parserDocAt (env : Environment) (root : Syntax) (pos : String.Pos.Raw) :
    IO (Option (String × Lean.Syntax.Range)) := do
  let some stack := root.findStack? (·.getRange?.any (·.contains pos))
    | return none
  stack.findSomeM? fun (stx, _) => do
    let .node _ kind _ := stx | pure none
    let some doc ← findDocString? env kind | pure none
    return some (doc, stx.getRange?.get!)

/-- Would `makePopup` render anything for this info node? The cheap mirror of
`Info.fmtHover?`'s emptiness, costing two environment lookups and NO
pretty-printing: term-like nodes always render a type, so only an
elaboration-info node with no docstring on its kind or its elaborator comes up
empty — exactly `Info.docString?`'s own fallback chain. (The divergence left
open: a `TermInfo` whose type fails to format AND has no doc would count
nonempty here while the buffer falls through to the parser docstring. That
needs the formatter to throw, which nothing in the corpus does, and the cost of
being exact is a pretty-print per token per request.) -/
def popupNonempty (env : Environment) (info : Elab.Info) : IO Bool := do
  match info with
  | .ofTermInfo _ | .ofFieldInfo _ | .ofOptionInfo _ | .ofErrorNameInfo _ =>
    pure true
  | _ =>
    match info.toElabInfo? with
    | some ei =>
      pure ((← findDocString? env ei.stx.getKind).isSome
        || (← findDocString? env ei.elaborator).isSome)
    | none => pure false

/-- Hoverable info nodes indexed for innermost-range lookup: `items` sorted by
start offset, and `prefixMaxStop[i]` = the largest stop among `items[0..i]`.

The tree is walked ONCE per request and the index shared by every token —
calling `InfoTree.hoverableInfoAt?` per token would re-walk the whole tree each
time, and this runs on every cursor move. The prefix-max array keeps the lookup
itself off O(targets): scanning backwards from the last candidate, the moment
the running maximum stop falls at or before the query offset, no earlier item
can contain it either, so the scan stops.

Each item carries its tree DEPTH because width alone does not decide the
buffer's pick: `hoverableInfoAt?` lets a DESCENDANT's result win over every
ancestor outright, and ranges legitimately tie — `by simp` puts `tacticSeq`,
`tacticSeq1Indented` and `simp` on the same four bytes (measured), and taking
the wrong one of those hands `simp`'s hover to a wrapper node whose popup is
empty. Depth is the flat-index encoding of "prefer innermost results". -/
structure HoverItem where
  start : Nat
  stop  : Nat
  depth : Nat
  info  : Elab.InfoWithCtx

structure HoverIndex where
  items         : Array HoverItem
  prefixMaxStop : Array Nat

/-- The depth-carrying clone of `InfoTree.foldInfo`'s traversal (same context
merging: `mergeIntoOuter?` at `.context`, `updateContext?` descending a node) —
`foldInfo` itself does not expose depth, and depth is the tie-break `innermost`
needs. -/
partial def collectHoverItems (ctx? : Option Elab.ContextInfo) (depth : Nat)
    (t : InfoTree) (acc : Array HoverItem) : Array HoverItem :=
  match t with
  | .context c t' => collectHoverItems (c.mergeIntoOuter? ctx?) depth t' acc
  | .node i cs =>
    let acc := match ctx? with
      | some ctx =>
        if !hoverEligible i || isSyntheticSorryInfo i then acc
        else match i.stx.getRange? (canonicalOnly := true) with
          | some r =>
            acc.push { start := r.start.byteIdx, stop := r.stop.byteIdx, depth,
                       info := { ctx, info := i, children := .empty } }
          | none => acc
      | none => acc
    cs.foldl (init := acc) fun a c =>
      collectHoverItems (i.updateContext? ctx?) (depth + 1) c a
  | .hole _ => acc

def mkHoverIndex (infoTree : InfoTree) : HoverIndex := Id.run do
  let raw := collectHoverItems none 0 infoTree #[]
  let items := raw.qsort fun a b => a.start < b.start
  let mut pm : Array Nat := Array.mkEmpty items.size
  let mut best := 0
  for it in items do
    best := max best it.stop
    pm := pm.push best
  return { items, prefixMaxStop := pm }

/-- The smallest eligible range containing byte offset `p` — DEEPEST first
among equal ranges (see `HoverIndex`) — as `(start, stop, info)`. The range
comes back with the info so callers can use it as an identity key for the node
(see the ref cache in `getProofTree`). -/
def HoverIndex.innermost (idx : HoverIndex) (p : Nat)
    : Option (Nat × Nat × Elab.InfoWithCtx) := Id.run do
  -- Binary search for the first index whose start exceeds `p`.
  let mut lo := 0
  let mut hi := idx.items.size
  while lo < hi do
    let mid := (lo + hi) / 2
    match idx.items[mid]? with
    | some it => if it.start ≤ p then lo := mid + 1 else hi := mid
    | none    => hi := mid
  let mut i := lo
  let mut best : Option HoverItem := none
  while i > 0 do
    i := i - 1
    match idx.prefixMaxStop[i]? with
    | some m => if m ≤ p then break
    | none   => break
    if let some it := idx.items[i]? then
      if it.start ≤ p && p < it.stop then
        let width := it.stop - it.start
        let wins := match best with
          | none => true
          | some b =>
            width < b.stop - b.start ||
              (width == b.stop - b.start && it.depth > b.depth)
        if wins then
          best := some it
  return best.map fun it => (it.start, it.stop, it.info)

/-- One-entry cache for `getProofTree`'s payload, keyed on
`(uri, document version, command start)`. Nothing in the payload depends on the
cursor beyond which command snapshot it lands in, yet the handler runs on EVERY
cursor move — so walking a proof line-by-line (the dominant interaction, and
exactly what tree↔lens tracking generates) recomputed an identical payload per
keypress: five info-tree walks plus a tagged pretty-print of every goal.

Caching the `WithRpcRef`-carrying halves is safe, and deliberately so: a ref's
id is minted once by `WithRpcRef.mk`, but its session registration happens at
response-ENCODE time (`rpcStoreRef` is `StateM RpcObjectStore`, run while
serialising the response into whichever session made the request). Re-serving
the cached value therefore registers fresh refs in a reconnected session's
store — the client-side self-heal in widget.tsx is untouched — and within one
session the client receives byte-identical ref ids across cursor moves, which
is what lets it skip re-installing an unchanged interactive payload. The
DOCUMENT VERSION is what must gate reuse (a stale `InfoWithCtx` against an old
environment), and it is in the key; `version` counts every edit
(`DocumentMeta.version`), so an edited file can never be served a stale tree.
One entry suffices: the panel follows a single cursor, and switching files or
proofs just evicts. -/
initialize proofTreeCache :
    -- The fourth Nat is the diagnostics count (see the `doc.diagnosticsRef`
    -- read in getProofTree): diagnostics are REPORTED asynchronously, so a
    -- request racing the reporter would otherwise cache a payload with a
    -- partial list under a key that never changes again for this version.
    -- The count grows monotonically within a version, so it is exactly
    -- "reporting progress"; once elaboration settles it is stable and cursor
    -- moves stay cached.
    IO.Ref (Option ((String × Nat × Nat × Nat) × ProofTreeData)) ← IO.mkRef none

/-- The whole enrichment pipeline, from a parsed `Result` to the wire payload:
label fix-ups, slots, calc chains, recovery merge, tagged goals, comments,
semantic tokens, the editing seam, hover refs, relations, holes.

Factored out of `getProofTree` so the COUNTERFACTUAL path (below) can run the
identical pipeline over a synthetic snapshot — one re-elaborated from a
spliced source — instead of growing a second, drifting copy. Everything here
reads only `snap`/`fileMap`/`parsed` and the two diagnostic inputs; nothing
touches the live document, which is precisely what makes a synthetic caller
sound. `errorPositions`/`treeDiags` are PARAMETERS rather than computed here
because the two callers get them from different places: the real path from
`doc.collectCurrentDiagnostics` (see getProofTree — `snap.msgLog` is empty on
the live server), the counterfactual from its own elaboration's message log
(which IS populated, since we run the elaboration ourselves). -/
def mkTreePayload (snap : Snapshots.Snapshot) (fileMap : FileMap)
    (parsed : Paperproof.Services.Result)
    (errorPositions : Array Lsp.Position) (treeDiags : Array TreeDiag)
    (snapStart : Nat) : RequestM ProofTreeData := do
    -- The label fix-ups (the `rw` location clause, a multi-line tactic's
    -- dropped tail), applied FIRST, before anything reads a label: the tokens
    -- align against it, brief mode collapses it, the completion list is keyed
    -- off it — so it has to be the same string everywhere, and on both wires
    -- (`labelFixup` is the one place the pass list and its order live).
    -- `snap.stx` is the whole command, which is what still finds a `rw`
    -- inside a tactic that failed to elaborate.
    let fixup := labelFixup fileMap snap.infoTree (extra := some snap.stx)
    let remapped := { parsed with
      steps := parsed.steps.map fun (s : Paperproof.Services.ProofStep) =>
        { s with tacticString := fixup s.position.start s.tacticString } }
    -- The supplemental parser: synthesize steps for tactics the vendored one
    -- lost to failure (their info subtree was rolled back; the syntax survives
    -- in the slots). Runs BEFORE the empty early-out — a proof whose only
    -- tactic failed parses to zero steps, and this is what stops the tree
    -- vanishing at exactly that moment. Slots and chains are computed here and
    -- reused by the payload below; the message log is the failure gate (a
    -- no-op like `skip` records no step either, so uncovered alone is not
    -- failed — measured, see ProofTreeRecover).
    let slots := tacticSlots fileMap snap.infoTree (extra := some snap.stx)
    let calcChains := collectCalcChains fileMap snap.infoTree (extra := some snap.stx)
    -- Error starts (`errorPositions`) gate the recovery below; `treeDiags` are
    -- the payload's diagnostics. Both arrive as parameters — see the doc
    -- comment above for why the two callers source them differently.
    let recovA ← Recover.recoverFailed fileMap snap.infoTree remapped.steps slots
      calcChains errorPositions
    -- Part B: a TERM-MODE proof (`:= term`, no `by`) parses to nothing at
    -- all — synthesize its structure from the syntax + TermInfo.
    let recovB ← Recover.recoverTerm fileMap snap.infoTree (some snap.stx)
      remapped.steps
    let recov : Recover.Recovery := {
      steps := recovA.steps ++ recovB.steps
      goals := recovA.goals ++ recovB.goals
      grafts := recovA.grafts ++ recovB.grafts
      recovered := recovA.recovered ++ recovB.recovered }
    let parsedTree := recov.apply remapped
    if parsedTree.steps.isEmpty then
      return { steps := [], allGoals := [] }
    -- Which print of each goal the client will draw, by its own rule (see
    -- `goalIndex` in proofToTree.ts): fewest metavariables, ties keeping the
    -- first offered, and `allGoals` is offered first. Mirrored here so the
    -- tagged rendering can match it exactly rather than nearly.
    let wanted : Std.HashMap String String := Id.run do
      let mut out : Std.HashMap String String := {}
      let offer (out : Std.HashMap String String) (g : Paperproof.Services.GoalInfo) :=
        let key := g.id.name.toString
        match out[key]? with
        | some cur =>
          if ProofTree.mvarOccurrences g.type < ProofTree.mvarOccurrences cur then
            out.insert key g.type
          else out
        | none => out.insert key g.type
      for g in parsedTree.allGoals do out := offer out g
      for st in parsedTree.steps do
        out := offer out st.goalBefore
        for g in st.goalsAfter ++ st.spawnedGoals do out := offer out g
      return out
    let taggedGoals ← collectTaggedGoals snap.infoTree wanted
    -- Comments live in the raw source, not the InfoTree; `snap.stx` is the
    -- whole command, so its range bounds the lex (same result as the CLI's
    -- `commandRange` walk).
    let comments := match snap.stx.getRange? with
      | some range => commentsInRange fileMap.source fileMap range
      | none => #[]
    -- Syntax highlighting, from the server's OWN highlighter rather than a
    -- hand-rolled Lean lexer: `collectSyntaxBasedSemanticTokens` (keywords and
    -- syntactic categories from `snap.stx`) plus `collectInfoBasedSemanticTokens`
    -- (identifiers classified by what they elaborated to, from the info tree) —
    -- exactly the pair `computeSemanticTokens` feeds the real
    -- `textDocument/semanticTokens` request. Overlaps are resolved the same way
    -- too, so a token span here means what it means in the editor. Computed
    -- once for the whole command and sliced per tactic below.
    let allTokens := semanticTokensFor fileMap snap.stx snap.infoTree
    -- CONSTANT tokens go on the wire as `"const"`, a type name of ours, not
    -- as the `.function` they ride through the semantic pipeline. The buffer
    -- paints a qualified constant PLAIN — checked against the shipped lean4
    -- TextMate grammar, which has no identifier rule at all (keywords,
    -- Prop/Type/Sort, sorry, strings, numerals, attributes — nothing else),
    -- and the info-based pass covers only fvars and projections — so colouring
    -- constants function-blue made the tree visibly disagree with the editor
    -- (the original comment on `collectConstIdentTokens` claimed the grammar
    -- colours them; it was wrong). The client inherits the label foreground
    -- for any UNMAPPED type — that rule is load-bearing here — so "const"
    -- renders plain in both palettes with no client change, while the token
    -- itself survives to carry its hover popup. Real `.function` tokens from
    -- the info pass (an fvar applied as a function head) keep their colour,
    -- which is why this is a wire-side reclassification by START position
    -- rather than a different enum in the collector: the pipeline (overlap
    -- resolution included) stays byte-identical to the editor's.
    let constStarts : Std.HashSet (Nat × Nat) :=
      (FileWorker.computeAbsoluteLspSemanticTokens fileMap ⟨0⟩ none
          (collectConstIdentTokens snap.infoTree)).foldl (init := {}) fun acc t =>
        acc.insert (t.pos.line, t.pos.character)
    let wireTokenType (t : FileWorker.AbsoluteLspSemanticToken) : String :=
      if t.type matches .function
          && constStarts.contains (t.pos.line, t.pos.character) then
        "const"
      else
        Lsp.SemanticTokenType.names[t.type.toNat]!
    -- `Lsp.Position` derives `Ord`; no bespoke comparator to keep in sync.
    -- The editing seam: per distinct step range, the tactic's tight span and
    -- verbatim text (see TacticEdit), plus the tokens falling inside it.
    let src := fileMap.source
    -- Hover targets, walked once and shared by every token below.
    let hoverIdx := mkHoverIndex snap.infoTree
    let mut seen : Std.HashSet (Nat × Nat) := {}
    let mut tacticEdits : Array TacticEdit := #[]
    let mut tokenInfos : Array TacticTokenInfo := #[]
    -- One RPC reference per distinct info NODE, not per token. Many tokens in
    -- a tactic resolve to the same node — its keyword and punctuation all land
    -- on the enclosing `TacticInfo` — and `rpcStoreRef` keys its store on the
    -- `WithRpcRef` id, so handing out the same value keeps them a single store
    -- entry (and lets the client reuse UI state for it) instead of one per
    -- token. Keyed by the node's range, which identifies it here.
    let mut refCache : Std.HashMap (Nat × Nat) (Server.WithRpcRef Elab.InfoWithCtx) := {}
    -- Tactic ranges NEST, so a token inside a branch of a structured tactic
    -- appears in that tactic's token list AND in every ancestor's. The client
    -- indexes `tokenInfos` by absolute position, so emit each position once.
    let mut seenTok : Std.HashSet (Nat × Nat) := {}
    -- Every tactic's span, for re-widening the steps Paperproof split out of
    -- one (see surfaceTacticRange).
    let tacticRanges := collectTacticRanges snap.infoTree
    for s in parsedTree.steps do
      let key := (s.position.start.line, s.position.start.character)
      unless seen.contains key do
        seen := seen.insert key
        let indent := tacticIndentAt fileMap s.position.start.line
        let b0 := fileMap.lspPosToUtf8Pos s.position.start
        let e0 := fileMap.lspPosToUtf8Pos s.position.stop
        -- The step's TIGHT end. Containment below must be tested against this,
        -- not the raw stop: a Paperproof range runs into the following trivia,
        -- so a step at the very end of its tactic (the synthetic `rfl` closing
        -- an `rw`) stops PAST the tactic that owns it and would never widen.
        let e0t := tightStop src b0 e0
        -- A split step (`rw [a, b]` → one step per rule) edits and colours as
        -- the tactic it came from; everything else is its own range.
        let (b, e, start) : String.Pos.Raw × String.Pos.Raw × Lsp.Position :=
          match surfaceTacticRange fileMap src tacticRanges s.position.start
                  s.tacticString b0 e0t with
          | some (rb, re) =>
            (⟨rb⟩, ⟨re⟩, fileMap.utf8PosToLspPos ⟨rb⟩)
          | none => (b0, e0, s.position.start)
        let raw := String.Pos.Raw.extract src b e
        let tight := trimmedEnd raw
        let stop := fileMap.utf8PosToLspPos ⟨b.byteIdx + tight.byteIdx⟩
        let tokens := allTokens.filterMap fun t =>
          if posLE start t.pos && posLE t.tailPos stop then
            -- `wireTokenType`: upstream's canonical name array, except our
            -- const-filler tokens which cross as "const" (see above).
            some { start := t.pos, stop := t.tailPos,
                   type := wireTokenType t : TacticToken }
          else none
        tacticEdits := tacticEdits.push {
          stepStart := s.position.start
          start
          stop
          text  := String.Pos.Raw.extract raw ⟨0⟩ tight
          tokens
          -- Where this line's tactic text starts, which is neither the step's
          -- column nor the bare line indent (see tacticIndentAt).
          tacticIndent := indent
        }
    -- `extra := snap.stx` is the whole command: a `calc` that never elaborated
    -- has no TacticInfo of its own, and this is what still finds it.
    -- An editing seam for a BROKEN chain, which by definition has no step and so
    -- got none from the loop above. The client draws a synthesized node for such
    -- a block (see proofToTree's `calc:<line>:<col>`), and without an entry here
    -- that node was the one tactic in the tree you could not double-click — in
    -- the one state where you most want to, since a block that does not parse is
    -- unfinished text and the repair chip only offers the single canned fix.
    --
    -- This is NOT the fabricated entry the alignInLabel invariant warns about.
    -- Everything in it is real: `[tacticStart, stop)` is a measured range, `text`
    -- is the server's own verbatim slice of it, and the synthesized node's LABEL
    -- is that same text — so the label-vs-source alignment the token renderer
    -- does is an identity here rather than the guesswork it warns of, and the
    -- block gets syntax colouring it has never had. `stop` is the last
    -- WELL-FORMED link, never the block's syntax range (which runs on into the
    -- tactic the parser swallowed), so an edit built from this can never write
    -- over a neighbour.
    --
    -- `seen` skips a chain a step already stands for: that is exactly the
    -- client's own "no step, so synthesize" condition, keyed the same way.
    for c in calcChains do
      let key := (c.tacticStart.line, c.tacticStart.character)
      if c.broken && !seen.contains key then
        seen := seen.insert key
        let tokens := allTokens.filterMap fun t =>
          if posLE c.tacticStart t.pos && posLE t.tailPos c.stop then
            some { start := t.pos, stop := t.tailPos,
                   type := wireTokenType t : TacticToken }
          else none
        tacticEdits := tacticEdits.push {
          stepStart := c.tacticStart
          start     := c.tacticStart
          stop      := c.stop
          text      := c.text
          tokens
          tacticIndent := tacticIndentAt fileMap c.tacticStart.line
        }
    -- Per token, what the EDITOR's hover would show there, decided the way
    -- `handleHover` decides it. Two sources, mirrored exactly:
    --
    -- * the INFO path — the innermost eligible info node, tagged onto the
    --   token's own source text (see TacticTokenInfo). A tactic keyword
    --   resolves to its `TacticInfo`, whose docstring is the reference text.
    -- * the PARSER-DOCSTRING path (`parserDocAt`) — what the buffer shows on
    --   `by`, where the innermost info node is a bare atom carrying nothing.
    --
    -- The doc string wins in exactly `handleHover`'s two cases: the info
    -- node's popup would be EMPTY (`popupNonempty`), or the docstring node's
    -- range does not `includes` the info node's range — the second is why the
    -- buffer shows `by`'s doc inside `have … := by`, whose innermost eligible
    -- info node is the whole `have`. Everywhere else the ref ships as before.
    --
    -- ONE pass over every edit built above, rather than a copy inside each of
    -- the two loops that build them: an unparsed `calc` block wants exactly the
    -- same treatment as a tactic (it just has less elaboration behind it, so
    -- most of its tokens find nothing), and the dedup and ref-sharing below are
    -- precisely the state that must not diverge between the two.
    for te in tacticEdits do
      for t in te.tokens do
        let tb := fileMap.lspPosToUtf8Pos t.start
        let tend := fileMap.lspPosToUtf8Pos t.stop
        if seenTok.contains (tb.byteIdx, tend.byteIdx) then
          continue
        seenTok := seenTok.insert (tb.byteIdx, tend.byteIdx)
        -- The buffer post-processes docstrings once, at hover time
        -- (`rewriteExamples` turns ```` ```lean ```` example blocks into plain
        -- ones); the same rewrite runs at the two emit sites below so the
        -- shipped text is byte-identical to what the editor renders — NOT
        -- here: most tokens' info popup wins and the doc is discarded, and
        -- rewriting a multi-KB docstring per token to throw it away was the
        -- loop's one avoidable cost.
        let stxDoc? ← parserDocAt snap.env snap.stx tb
        match hoverIdx.innermost tb.byteIdx with
        | some (rs, re, ictx) =>
          let docWins ← match stxDoc? with
            | none => pure false
            | some (_, stxRange) =>
              if !stxRange.includes ⟨⟨rs⟩, ⟨re⟩⟩ then pure true
              else do pure !(← popupNonempty snap.env ictx.info)
          if docWins then
            tokenInfos := tokenInfos.push
              { start := t.start
                doc := stxDoc?.map (FileWorker.Hover.rewriteExamples ·.1) }
          else
            -- WithRpcRef.mk (not ⟨_⟩ — the constructor is private): allocates
            -- the session-scoped id the client hands back to
            -- `infoToInteractive` when the popup opens. Keyed by the info
            -- node's range, so a tactic's keyword and its punctuation — which
            -- resolve to the same `TacticInfo` — share one store entry.
            let ref ← match refCache[(rs, re)]? with
              | some r => pure r
              | none   => do
                let r ← Server.WithRpcRef.mk ictx
                refCache := refCache.insert (rs, re) r
                pure r
            tokenInfos := tokenInfos.push {
              start := t.start
              code  := some <| .tag
                { info := ref, subexprPos := SubExpr.Pos.root }
                (.text (String.Pos.Raw.extract src tb tend))
            }
        | none =>
          -- No info node at all (an unparsed calc block's tokens, mostly).
          -- The buffer would still show the parser docstring; so do we.
          if let some (doc, _) := stxDoc? then
            tokenInfos := tokenInfos.push
              { start := t.start
                doc := some (FileWorker.Hover.rewriteExamples doc) }
    let calcRelations ← collectCalcRelations snap.infoTree <|
      calcRelationGoals
        (parsedTree.steps.toArray.map fun s =>
          { goalBefore := s.goalBefore.id.name.toString
            goalsAfter := (s.goalsAfter.map (·.id.name.toString)).toArray
            start := s.position.start
            stop  := s.position.stop })
        calcChains
    let proofId := match declName? snap.stx with
      | some n => n.toString
      | none   => s!"@{snapStart}"
    -- Any goal's context will do — `allTacticDocs` reads the environment, not
    -- the goal — so take the first one rather than plumbing a context down.
    -- Empty when the proof somehow has no goal at all, which the client reads
    -- as "this wire ships no tactic names" and simply offers none.
    let tacticNames ← match anyGoalContext snap.infoTree with
      | some (ctx, _) => tacticNames ctx
      | none => pure #[]
    return {
      proofId,
      tacticNames,
      declRange := snap.stx.getRange?.map fun r =>
        ⟨fileMap.utf8PosToLspPos r.start, fileMap.utf8PosToLspPos r.stop⟩,
      diagnostics := treeDiags,
      steps       := parsedTree.steps,
      allGoals    := parsedTree.allGoals.toList,
      taggedGoals,
      comments,
      tacticEdits,
      tokenInfos,
      deleteSlots := slots
      recovered   := recov.recovered
      holes       := collectHoles fileMap snap.infoTree slots (extra := some snap.stx)
      calcChains
      calcRelations
    }

-- ======================= The counterfactual =================================

/-- Splice for the counterfactual: the cursor line's content replaced by
`sorry`, preserving what structure the line carries. Returns
`(cfText, draft)` — the whole spliced source and the line's real content
(indent stripped) for the client's stub label — or `none` when there is
nothing to do.

Tiers, from most to least structure preserved:
* a line carrying a justification (`… := by ring`, a `calc` link or one-line
  `have`) keeps everything through its LAST `:= by` — replacing the whole
  line would break the link, and the counterfactual would elaborate to
  nothing;
* a bullet keeps its `· `; a case line keeps `| c =>` — the marker is block
  structure, not the tactic;
* an empty line takes the CURSOR's column as its indent (the editor put the
  caret where a tactic belongs; the line itself has no whitespace to read);
* anything else is replaced whole at its own indent.

A wrong guess is SAFE by construction: the spliced command elaborates to
nothing, `computeCf` caches the failure for this exact text, and the client
keeps today's behaviour. -/
private def cfSplice (fileMap : FileMap) (line : Nat) (cursorCol : Nat) :
    Option (String × String) :=
  if line + 1 ≥ fileMap.positions.size then none else
  let src := fileMap.source
  let lineStart := fileMap.lspPosToUtf8Pos ⟨line, 0⟩
  let nextStart := fileMap.lspPosToUtf8Pos ⟨line + 1, 0⟩
  let lineRaw := String.Pos.Raw.extract src lineStart nextStart
  let hasNl := lineRaw.endsWith "\n"
  let contentEnd : String.Pos.Raw :=
    if hasNl then ⟨nextStart.byteIdx - 1⟩ else nextStart
  let content := String.Pos.Raw.extract src lineStart contentEnd
  let ws := (content.takeWhile fun c => c == ' ' || c == '\t').toString
  let body := (content.drop ws.length).toString
  let byParts := content.splitOn ":= by"
  let arrowParts := content.splitOn "=>"
  let newContent :=
    if body.startsWith "--" || body.startsWith "/-" then
      -- A comment line is never the tactic being typed; splicing it would
      -- offer a preview with an extra sorry nobody is writing.
      content
    else if body.isEmpty then
      -- An empty line with the caret at column 0 is not "typing a tactic";
      -- leave it alone (this also keeps the between-declarations case out).
      if cursorCol == 0 then content
      else ("".pushn ' ' cursorCol) ++ "sorry"
    else if byParts.length ≥ 2 then
      String.intercalate ":= by" byParts.dropLast ++ ":= by sorry"
    else if body.startsWith "· " then ws ++ "· sorry"
    else if body.startsWith "| " && arrowParts.length ≥ 2 then
      arrowParts.head! ++ "=> sorry"
    else ws ++ "sorry"
  if newContent == content then none
  else
    let cfText := String.Pos.Raw.extract src ⟨0⟩ lineStart
      ++ newContent ++ (if hasNl then "\n" else "")
      ++ String.Pos.Raw.extract src nextStart ⟨src.utf8ByteSize⟩
    some (cfText, body)

/-- Is the counterfactual wanted? Two conjuncts, both read off the payload the
normal path just built (no extra parse):

**Something is broken in this declaration** — no steps at all; a recovered
(failed/skipped) step on the cursor's line; the declaration's range not
containing the cursor (the calc-swallow signature: a broken block re-names the
cursor's command after the NEXT theorem — the client-side `navigated` gate
exists for the same measurement); or an error diagnostic intersecting the
declaration. Declaration-wide, not cursor-line, deliberately: deleting a whole
tactic line reports `unsolved goals` on the CONTAINER (`have`/`induction`),
never on the now-blank line (measured — the line-scoped version missed the
delete-and-retype scenario entirely).

**AND the cursor's line holds no completed tactic** — no step STARTS on it.
This is what keeps cf out of the way while merely READING a broken proof with
the cursor on some valid line, and what hands back the real tree the moment
the typed tactic elaborates. A false fire (cursor resting on a blank line of a
broken proof) costs one background elaboration, cached by spliced text; the
splice's own declines (comment lines, blank at column 0) keep the browsing
cases out. -/
private def cfWanted (real : ProofTreeData) (pos : Lsp.Position) : Bool :=
  let declContains := match real.declRange with
    | some r =>
      (r.start.line < pos.line
        || (r.start.line == pos.line && r.start.character ≤ pos.character))
      && (pos.line < r.stop.line
        || (pos.line == r.stop.line && pos.character ≤ r.stop.character))
    | none => false
  let errInDecl := real.diagnostics.any fun d =>
    d.severity == 1 && (match real.declRange with
      | some r =>
        d.range.start.line ≤ r.stop.line && r.start.line ≤ d.fullRange.stop.line
      | none => true)
  let broken := real.steps.isEmpty
    || real.recovered.any (·.start.line == pos.line)
    || !declContains
    || errInDecl
  let lineIncomplete :=
    !(real.steps.any fun s => s.position.start.line == pos.line)
  broken && lineIncomplete

/-- The counterfactual's two caches plus its in-flight marker. `cfElabCache`
is the expensive layer, keyed by the HASH OF THE SPLICED TEXT — which is what
makes the feature affordable: while the author types on one line, the real
document changes every keystroke but the spliced document (that line reads
`sorry` either way) does not, so ONE elaboration serves the whole burst. A
`none` value records a failure, so a splice that elaborates to nothing is not
retried per keystroke. `cfServeCache` short-circuits the splice+hash for the
repeated identical request; `cfComputing` dedupes the background task (its
timestamp expires a marker orphaned by a dead task). -/
initialize cfElabCache : IO.Ref (Option (UInt64 × Option ProofTreeData)) ←
  IO.mkRef none
/-- (real-source hash, line, spliced-text hash, blob) — the last serve. The
extra keys carry the STICKY rule; see `maybeCounterfactual`. -/
initialize cfServeCache : IO.Ref (Option (UInt64 × Nat × UInt64 × ProofTreeData)) ←
  IO.mkRef none
initialize cfComputing : IO.Ref (Option (UInt64 × Nat)) ← IO.mkRef none

/-- Elaborate the counterfactual: parse ONE command of the spliced text from
the state the document's own elaboration reached just before it, run the
elaborator over it, and push the result through the same `mkTreePayload`
pipeline as the real path.

The recipe is `Frontend.processCommand`'s, adapted to a mid-file start: the
compat `Snapshot` carries `mpState`/`cmdState` — the parser and elaboration
states AFTER its command — so the predecessor of the cursor's command is a
valid restart point, and it is byte-identical in the spliced text (the splice
touches only the cursor's line, which sits strictly after it). Three details
are load-bearing:

* **`Elab.async` is forced OFF.** The server runs with it ON, and an embedded
  `elabCommandTopLevel` under async scatters messages and info subtrees into
  snapshot tasks nothing here drains — the v4.29 "empty proofs" trap, in
  exactly the environment where it is real (the option's own docstring names
  this case).
* **Kind-gated to `declaration`s.** An arbitrary command (`#eval`,
  `initialize`) has genuinely global side effects a copied `Command.State`
  does not sandbox.
* The diagnostics come from the counterfactual's OWN message log — populated,
  unlike the live compat snapshots' (nothing drained it; we ran the
  elaboration). The injected stub's `declaration uses 'sorry'` warning is our
  own noise and is dropped; everything else is honest and ribbons as usual. -/
private def computeCf (doc : FileWorker.EditableDocument) (pos : Lsp.Position)
    (cfText : String) : RequestM (Option ProofTreeData) := do
  let fileMap := doc.meta.text
  let lineStart := fileMap.lspPosToUtf8Pos ⟨pos.line, 0⟩
  let (snaps, _, _) ← doc.cmdSnaps.getFinishedPrefix
  -- The LAST snapshot ending at or before the cursor's line start: the state
  -- just before the command being counterfactually rebuilt. The list is
  -- ordered, so the fold keeps the latest match.
  let prev? := snaps.foldl (init := none) fun acc s =>
    if s.endPos.byteIdx ≤ lineStart.byteIdx then some s else acc
  let some prev := prev? | return none
  let ictx := Parser.mkInputContext cfText doc.meta.uri
  let cfMap := ictx.fileMap
  let scopes := prev.cmdState.scopes.map fun sc =>
    { sc with opts := Elab.async.set sc.opts false }
  let cmdState0 : Command.State := { prev.cmdState with
    scopes, messages := {}, traceState := {}, snapshotTasks := #[],
    infoState := { enabled := true } }
  let some scope := cmdState0.scopes.head? | return none
  let pmctx : Parser.ParserModuleContext := {
    env := cmdState0.env, options := scope.opts,
    currNamespace := scope.currNamespace, openDecls := scope.openDecls }
  let (stx, mpState', parseMsgs) :=
    Parser.parseCommand ictx pmctx prev.mpState {}
  unless stx.getKind == ``Lean.Parser.Command.declaration do return none
  let some r := stx.getRange? | return none
  unless r.start.byteIdx ≤ lineStart.byteIdx
      && lineStart.byteIdx < r.stop.byteIdx do
    return none
  let cmdCtx : Command.Context := {
    fileName := doc.meta.uri, fileMap := cfMap,
    cmdPos := prev.mpState.pos, snap? := none, cancelTk? := none }
  let ref ← IO.mkRef cmdState0
  Command.withLoggingExceptions
    (Elab.getResetInfoTrees *> Command.elabCommandTopLevel stx) cmdCtx ref
  let stFinal ← ref.get
  -- `Snapshot.infoTree` asserts exactly one tree; guard rather than trust.
  unless stFinal.infoState.trees.size == 1 do return none
  let synth : Snapshots.Snapshot :=
    { stx, mpState := mpState', cmdState := stFinal }
  let mut cfDiags : Array TreeDiag := #[]
  let mut errPos : Array Lsp.Position := #[]
  for m in parseMsgs.toList ++ stFinal.messages.toList do
    let text ← m.data.toString
    if m.severity == .warning && text.startsWith "declaration uses 'sorry'" then
      continue
    let s := cfMap.leanPosToLspPos m.pos
    let e := match m.endPos with
      | some e => cfMap.leanPosToLspPos e
      | none => s
    let sev := match m.severity with
      | .error => 1 | .warning => 2 | .information => 3
    cfDiags := cfDiags.push {
      range := ⟨s, e⟩, fullRange := ⟨s, e⟩, severity := sev, message := text
      leanTags := if text.startsWith "unsolved goals" then #[1] else #[] }
    if sev == 1 then errPos := errPos.push s
  let parsed ← (do
    match ← RequestM.runTermElabM synth
      (liftM <| Paperproof.Services.BetterParser_Tree cfMap synth.infoTree) with
    | some res => pure res
    | none => pure { steps := [], allGoals := {} })
  let payload ← mkTreePayload synth cfMap parsed errPos cfDiags
    ((stx.getRange?.map (·.start.byteIdx)).getD 0)
  if payload.steps.isEmpty then return none
  return some { payload with cfLine := some pos.line }

/-- Decide the payload: the real one, or the counterfactual preview.

Serving is two-level. The SERVE memo keys on (real source, cursor line) — the
repeated request while nothing changed. The ELAB cache keys on the SPLICED
text: a keystroke changes the real source but usually not the spliced one, so
the elaboration is reused and only the `cfDraft` field is refreshed — which is
also why the draft is attached HERE, per request, never inside the cached
blob. A miss spawns the elaboration on a DETACHED task and returns the real
payload marked `cfPending` — a request is never blocked on seconds of
elaboration, the client re-polls, and the next request serves the cache. The
pending answer is also served while a fresh marker is in flight, so a burst of
keystrokes starts exactly one elaboration. -/
private def maybeCounterfactual (wantCf : Bool) (pos : Lsp.Position)
    (doc : FileWorker.EditableDocument) (fileMap : FileMap)
    (real : ProofTreeData) : RequestM ProofTreeData := do
  unless wantCf do return real
  let some (cfText, draft) := cfSplice fileMap pos.line pos.character
    | return real
  let srcHash : UInt64 := hash fileMap.source
  let cfKey : UInt64 := hash cfText
  -- The completeness witness: a step STARTING on the cursor's line means the
  -- line's tactic elaborated for real, which is what turns the sticky serve
  -- back off the moment the typed tactic becomes valid.
  let stepStartsHere := real.steps.any fun s => s.position.start.line == pos.line
  if let some (sh, ln, ck, blob) ← cfServeCache.get then
    -- Identical request state: serve what was served.
    if sh == srcHash && ln == pos.line then
      return { blob with cfDraft := some draft }
    -- The STICKY rule, and it exists because `cfWanted`'s signals RACE the
    -- diagnostics reporter: measured, one keystroke after a delete the calc
    -- CONTAINER step still covered the cursor's line, no error had been
    -- published yet, and the raw 3-step wreck was served between two cf
    -- serves. If the last serve was cf FOR THIS LINE, and the current text
    -- splices to the SAME counterfactual (i.e. the edit stayed within the
    -- line — the typing case by construction), and no step starts here, the
    -- author is still mid-word: keep serving the cf.
    if ln == pos.line && ck == cfKey && !stepStartsHere then
      cfServeCache.set (some (srcHash, ln, ck, blob))
      return { blob with cfDraft := some draft }
  unless cfWanted real pos do return real
  if let some (k, res) ← cfElabCache.get then
    if k == cfKey then
      match res with
      | some blob =>
        cfServeCache.set (some (srcHash, pos.line, cfKey, blob))
        return { blob with cfDraft := some draft }
      | none => return real
  let now ← IO.monoMsNow
  if let some (k, t0) ← cfComputing.get then
    if k == cfKey && now - t0 < 20000 then
      return { real with cfPending := true }
  cfComputing.set (some (cfKey, now))
  let rc ← read
  let line := pos.line
  let _ ← IO.asTask (prio := .default) do
    let res ← match ← ((computeCf doc pos cfText).run rc).toBaseIO with
      | .ok res => pure res
      | .error _ => pure none
    cfElabCache.set (some (cfKey, res))
    if let some blob := res then
      cfServeCache.set (some (srcHash, line, cfKey, blob))
  return { real with cfPending := true }

/-- Parse the proof tree for the theorem under the cursor.

Mirrors the `.tree` branch of `Paperproof.getSnapshotData`: wait for the snapshot
containing `pos`, run `BetterParser_Tree` over its (fully elaborated) info
tree, then the enrichment pipeline (`mkTreePayload`). A cursor outside a tactic
proof is a normal outcome, not an error: it returns an EMPTY proof
(`steps := []`), which the widget renders as a quiet "no proof here" — keeping
the empty state in the data model rather than encoding it in error-message
strings the client would have to pattern-match.

When the document is BROKEN at the cursor — the author is mid-typing — the
payload may instead be the COUNTERFACTUAL preview: the same theorem with the
cursor's line as `sorry`, so the tree keeps its shape and marks where the
tactic being written lands. See `maybeCounterfactual`. -/
@[server_rpc_method]
def getProofTree (params : GetProofTreeParams) : RequestM (RequestTask ProofTreeData) := do
  withWaitFindSnapAtPos params.pos fun snap => do
    let doc ← readDoc
    let fileMap : FileMap := doc.meta.text
    let snapStart := (snap.stx.getRange?.map (·.start.byteIdx)).getD 0
    -- The FILE's diagnostics, as reported so far — the very state the publish
    -- path serves (on v4.32 `EditableDocumentCore.collectCurrentDiagnostics`,
    -- sticky ++ per-version, mutex-guarded; it replaced v4.27's bare
    -- `doc.diagnosticsRef`) — and NOT `snap.msgLog`, which looks right and is
    -- empty: the file worker rebuilds these compat snapshots from the
    -- incremental architecture (FileWorker/Utils.lean `mkCmdSnaps`), and the
    -- `cmdState` it hands them has its `messages` already drained into the
    -- reporting stream. The CLI path is different on purpose —
    -- `IO.processCommands` populates `cmdState.messages`, which is why every
    -- offline probe of the msgLog path passed while the live widget saw an
    -- empty log (measured, by driving the real server over LSP and reading
    -- the payload).
    let interactiveDiags := (← doc.collectCurrentDiagnostics).toArray
    let cacheKey := (doc.meta.uri, doc.meta.version, snapStart, interactiveDiags.size)
    if let some (key, payload) ← proofTreeCache.get then
      -- A cached PENDING payload is a promise, not an answer: fall through
      -- and re-decide, or the client's re-poll would loop on it forever
      -- within one document version.
      if key == cacheKey && !payload.cfPending then
        return payload
    let parsed ← (do
      match ← RequestM.runTermElabM snap
        (liftM <| Paperproof.Services.BetterParser_Tree fileMap snap.infoTree) with
      | some r => pure r
      | none => pure { steps := [], allGoals := {} })
    -- Error starts for the recovery gate, and the payload's diagnostics, both
    -- from `interactiveDiags` above (see its comment: `snap.msgLog` is EMPTY
    -- on this path). File-wide is fine for both consumers: recovery tests
    -- containment in this command's slots, and the client filters to the
    -- declaration's span.
    let errorPositions := interactiveDiags.foldl (init := #[]) fun acc d =>
      if d.severity? == some .error then acc.push d.range.start else acc
    let treeDiags : Array TreeDiag := interactiveDiags.map fun d =>
      let full := d.fullRange?.getD d.range
      { range := ⟨d.range.start, d.range.end⟩
        fullRange := ⟨full.start, full.end⟩
        severity := match d.severity? with
          | some .error => 1 | some .warning => 2 | _ => 3
        -- `toDiagnostic`'s flattener, NOT `d.message.stripTags`. The two agree
        -- only when the editor initialised the server with `hasWidgets: false`
        -- — which a bare LSP probe does and VS Code never does. In widget mode
        -- an embed's text lives INSIDE the `MsgEmbed` constructor and the
        -- outer tag's subtext is EMPTY, so `stripTags` walks past all of it
        -- and every message flattened to "" (measured: 9/9 empty with
        -- `initializationOptions.hasWidgets: true`, 9/9 full without).
        message := d.toDiagnostic.message
        isSilent := d.isSilent?.getD false
        leanTags := (d.leanTags?.getD #[]).map fun
          | .unsolvedGoals => 1 | .goalsAccomplished => 2 }
    let real ← mkTreePayload snap fileMap parsed errorPositions treeDiags
      snapStart
    let payload ← maybeCounterfactual params.cf params.pos doc fileMap real
    proofTreeCache.set <| some (cacheKey, payload)
    return payload

/-- Case-insensitive prefix test, allocation-free — the client's own matcher
(`matches` in completion.ts) lowercases both sides, so the server must agree or
the client's re-filter silently drops what the server sent. Char-by-char rather
than `toLower.isPrefixOf`: the scan below runs this against every eligible
declaration in the environment, and two string allocations per candidate is
the difference between a scan and a stall. -/
partial def ciPrefix (pref s : String) : Bool :=
  go ⟨0⟩ ⟨0⟩
where
  go (pi si : String.Pos.Raw) : Bool :=
    if String.Pos.Raw.atEnd pref pi then true
    else if String.Pos.Raw.atEnd s si then false
    else if (String.Pos.Raw.get pref pi).toLower ==
        (String.Pos.Raw.get s si).toLower then
      go (String.Pos.Raw.next pref pi) (String.Pos.Raw.next s si)
    else false

/-- Last `.` in `s`, hand-rolled: `String.revPosOf` is deprecated and its
replacement traffics in slice-pattern iterators for what is one loop here. -/
def lastDotPos? (s : String) : Option String.Pos.Raw := Id.run do
  let mut p : String.Pos.Raw := ⟨0⟩
  let mut found : Option String.Pos.Raw := none
  while !String.Pos.Raw.atEnd s p do
    if String.Pos.Raw.get s p == '.' then found := some p
    p := String.Pos.Raw.next s p
  return found

/-- Below this the answer set is noise (a 1-char prefix of Mathlib matched
240,284 names when the full completion RPC was priced); the client holds the
same gate so a short prefix never even makes the round trip. -/
def minCompletionQuery : Nat := 3
/-- Shortest-first, so the cap keeps the names a prefix most plausibly means —
and for a prefix match the shortest candidate IS the exact one, the same rule
the client's tactic tier already applies. -/
def maxCompletionNames : Nat := 50

/-- The scan itself, factored so the offline timing probe drives the REAL
function (the `mkHoverIndex` precedent). See `completionNames` for the design;
this is the part whose cost had to be measured.

The query splits at its LAST dot: the fragment after it matches the
declaration's last component, the part before must equal the parent namespace.
This keeps the hot test on the last component for dotted and undotted queries
alike — the first version tested a dotted query against `declName.toString`,
and materialising 240k names tripled the scan (110ms → 345ms, measured). The
loss versus a whole-string prefix is a query straddling a namespace boundary
(`Nat.Pri` finds `Nat.Prime` but not `Nat.Prime.one_lt`); the buffer's
subsequence match would find both, and typing the next dot recovers it.

`isPrivateName`/`isInternalDetail` are skipped explicitly: core's eligibility
filter deliberately admits private declarations (they complete inside their own
module), but the label this scan returns is the FULL name, and
`_private.Mathlib.….0.foo` is not text anyone can type into a tactic —
measured, one leaked into the very first probe run. -/
def scanNames (query : String) : MetaM (Array String) := do
  let (nsQuery?, frag) :=
    match lastDotPos? query with
    | some p =>
      (some (String.Pos.Raw.extract query ⟨0⟩ p),
       String.Pos.Raw.extract query (String.Pos.Raw.next query p) query.rawEndPos)
    | none => (none, query)
  let acc ← IO.mkRef (#[] : Array String)
  Server.Completion.forEligibleDeclsM fun declName _ => do
    -- The prefix test comes FIRST: nearly every candidate fails on its first
    -- character, and putting the name-hygiene checks ahead of it made every
    -- scan pay them 240k times (measured, roughly 2× on the whole scan).
    let .str parent s := declName | return ()
    unless ciPrefix frag s do return ()
    if isPrivateName declName || declName.isInternalDetail then return ()
    if let some ns := nsQuery? then
      let ps := parent.toString
      -- Case-insensitive EQUALITY: same byte length plus a CI prefix. (toLower
      -- preserves byte width over the ASCII that names are made of.)
      unless ps.utf8ByteSize == ns.utf8ByteSize && ciPrefix ns ps do return ()
    acc.modify (·.push declName.toString)
  let names ← acc.get
  let names := names.qsort fun a b =>
    a.length < b.length || (a.length == b.length && a < b)
  return names.take maxCompletionNames

/-- `query`, not `prefix` — `prefix` is a Lean keyword, and the field name is
the wire contract the client writes into the call. -/
structure CompletionNamesParams where
  pos   : Lsp.Position
  query : String
  deriving FromJson, ToJson

/-- Global names matching a typed prefix — the ENVIRONMENT tier of the
in-place editor's completion, the one pool the payload cannot carry.

This deliberately does not reopen `idCompletion`, which was measured (3.8s
cold / ~525ms warm / up to 240k items) and rejected. Every term of that
rejection is answered structurally rather than hopefully: the scan touches
NOTHING per-candidate but name strings — `forEligibleDeclsM`'s `kind`/`tags`
are lazy `MetaM` thunks whose forcing (a `whnf` per declaration) is the bulk
of `idCompletion`'s cost, and they are never forced here — the result is
truncated server-side, and the client gates the call on prefix length and
debounces it. The first call per file worker warms core's own
`getEligibleHeaderDecls` mutex cache (the eligibility pass over the import
header); after that a call is one linear pass of prefix tests.

Matching: the declaration's LAST COMPONENT always (`le_tr` → `Nat.le_trans`,
and for a root-namespace lemma like `sq_nonneg` the last component IS the full
name), plus the full dotted string when the query itself is dotted
(`Nat.le_tr`). The label returned is always the FULL name — the one string
guaranteed to elaborate wherever the tactic is typed, no `open`s assumed.
Case-insensitive prefix, not the buffer's subsequence match: it mirrors the
client's own matcher, which re-filters as typing continues.

The `ContextInfo` comes from any goal of the snapshot (the `tacticNames`
precedent — the environment is per-file, not per-goal); a cursor outside a
proof gets an empty answer, matching a widget that isn't showing a tree. -/
@[server_rpc_method]
def completionNames (params : CompletionNamesParams) :
    RequestM (RequestTask (Array String)) := do
  withWaitFindSnapAtPos params.pos fun snap => do
    if params.query.length < minCompletionQuery then return #[]
    let some (ctx, _) := anyGoalContext snap.infoTree
      | return #[]
    ctx.runMetaM {} (scanNames params.query)

/-- One line's worth of goal state, for the lens's inline annotations.

Computed CLIENT-side and passed through: the widget is what holds the proof
and knows which line each step ends on, and this RPC is only a file writer.
The companion paints it as an `after` decoration on that line in the lens. -/
structure GoalAnnotation where
  line : Nat
  text : String
  deriving FromJson, ToJson

/-- Parameters for `popoutEdit`: the document and the tactic's TIGHT range
(from `TacticEdit`) to select in the lens editor. `action` selects the
companion behavior: `"popout"` opens (or reuses) the lens; `"reveal"` shows
the range in the lens when one is open, else in the main editor — the tree's
click-to-reveal rides this, so it can target the lens (vscode-lean4's own
reveal always picks the first visible editor). -/
structure PopoutEditParams where
  uri    : String
  start  : Lsp.Position
  stop   : Lsp.Position
  action : String := "popout"
  /-- Inline goal state for the lens (see `GoalAnnotation`). Rides the popout
  request, and the `annotate` action refreshes it after an edit. Unlike
  `ThemeColors` the derived `FromJson`'s indifference to defaults is harmless
  here: this end of the wire is the BUNDLED widget, which ships inside the same
  build as this file and always sends the field. -/
  annotations : Array GoalAnnotation := #[]
  deriving FromJson, ToJson

/-- The widget→companion bridge for the "edit in the lens" action (a tactic's
hover-bar `⧉` button) and for click-to-reveal. The infoview's `EditorApi` has no `executeCommand`, and both
webview-side escape hatches fail (vscode-lean4's `showDocument` silently drops
non-file URIs; a synthetic anchor click navigates the webview blank) — so the
request is relayed through the filesystem: this writes a one-shot request file
under `~/.proof-tree-companion/`, which the companion extension
(`ext/proof-tree-companion`) watches and turns into a slim LENS editor group
directly below the infoview with the range selected. The nonce lets the
watcher dedupe double fire (fs.watch often reports one write as several
events). -/
@[server_rpc_method]
def popoutEdit (params : PopoutEditParams) : RequestM (RequestTask String) := do
  RequestM.asTask do
    let some home ← IO.getEnv "HOME"
      | throw <| RequestError.internalError "popoutEdit: no HOME"
    let dir := System.FilePath.mk home / ".proof-tree-companion"
    IO.FS.createDirAll dir
    let nonce ← IO.monoNanosNow
    let payload := Json.mkObj [
      ("nonce", toJson nonce),
      ("uri", toJson params.uri),
      ("start", toJson params.start),
      ("stop", toJson params.stop),
      ("action", toJson params.action),
      ("annotations", toJson params.annotations)
    ]
    IO.FS.writeFile (dir / "popout-request.json") payload.compress
    return "ok"

/-- One LSP semantic token type and the colour the editor's theme paints it. -/
structure ThemeTokenColor where
  type  : String
  color : String
  deriving ToJson, FromJson

/-- Read one field of a JSON object, falling back to `dflt` when it is absent
or does not decode.

This is what the two hand-written `FromJson` instances below are made of, and
the reason they are hand-written at all: the DERIVED instance treats a missing
key as an error rather than as the field's default, so one absent field fails
the whole decode. That matters on this wire and nowhere else, because its two
ends ship separately — the companion is a dev-installed extension that can
easily be older than the server, and losing the whole palette over one new flag
is exactly what happened before this. Shared so the rule cannot drift between
the two structures that depend on it. -/
private def jsonField {α : Type} [FromJson α] (j : Json) (k : String)
    (dflt : α) : α :=
  match j.getObjVal? k >>= fromJson? with
  | .ok v => v
  | .error _ => dflt

/-- One of the user's `lean4.input.customTranslations` entries. An ARRAY of
these rather than a JSON object keyed by abbreviation, for the same reason
`ThemeColors.colors` is an array: a derived `FromJson` decodes it straight into
an `Array`, where an object would need map-API surgery. -/
structure ThemeAbbrev where
  -- `abbrev` is a Lean keyword, hence the longer name; the JS side matches.
  abbreviation : String
  symbol : String
  deriving ToJson, FromJson

/-- The user's `lean4.input.*` settings, so the in-place tactic editor's unicode
input matches the buffer's. Settings, not colours — they ride this file for the
same reason `brackets` and `outline` do: a webview cannot read one.

Only a CUSTOMISED input mode needs this to arrive. The abbreviation table itself
is bundled with the renderer, so with no companion the editor still expands
`\dvd` — it just uses vscode-lean4's own defaults, which is what these fields
default to. -/
structure InputConfig where
  /-- `lean4.input.enabled`. -/
  enabled : Bool := true
  /-- `lean4.input.leader`. -/
  leader : String := "\\"
  /-- `lean4.input.eagerReplacementEnabled`. -/
  eager : Bool := true
  /-- `lean4.input.customTranslations`. -/
  custom : Array ThemeAbbrev := #[]
  deriving ToJson

/-- Hand-written for the reason spelled out on `ThemeColors`'s instance below:
this wire's two ends ship separately, so a missing field must default rather
than fail the whole decode. -/
instance : FromJson InputConfig where
  fromJson? j :=
    .ok { enabled := jsonField j "enabled" true,
          leader := jsonField j "leader" "\\",
          eager := jsonField j "eager" true,
          custom := jsonField j "custom" #[] }

/-- The editor theme's syntax colours, for the tree's own token rendering.
Empty when the companion isn't installed, which the client reads as "keep the
built-in palette". -/
structure ThemeColors where
  /-- The active theme's name, for the log; the client only uses the rest. -/
  theme  : String := ""
  /-- `editor.bracketPairColorization.enabled`. A SETTING rather than a colour,
  so unlike the six colours it cycles it is not in the webview's `--vscode-*`
  set and has to come the long way round too. -/
  brackets : Bool := false
  /-- `proofTree.outlineOnly` — draw node boxes as borders with no fill. Not a
  colour at all, but it rides here for the same reason `brackets` does: a
  webview cannot read a VS Code SETTING, so anything of the kind has to come
  back through the companion. -/
  outline : Bool := false
  /-- `proofTree.tallFrame` — run the tree's frame closer to the bottom edge,
  giving back most of the strip the default leaves clear below it. A setting,
  so it comes the same long way round as `outline`; which fractions the two
  states mean is the RENDERER's business (`FRAME_FRACTION*` in widget.tsx),
  since the frame is measured from the widget's own offset down. -/
  tallFrame : Bool := false
  /-- `proofTree.linkEmoji` — swap the connectors' subtle target-type marks
  (gap-with-dot = goal-bound, gap-with-dash = tactic-bound) for unmistakable
  emoji (🎯/⚙️). A setting, the same long way round. -/
  linkEmoji : Bool := false
  /-- `proofTree.linkTint` — additionally tint each connector toward its
  target's hue. Ditto. -/
  linkTint : Bool := false
  /-- `proofTree.linkMarks` — draw the target-type marks at all. Defaults
  TRUE, the only setting on this wire that does, and deliberately: the marks
  are the accessible baseline (the one channel that survives without colour),
  so this is an opt-OUT for readers who find them distracting and take the
  target's kind from the tint or the box shape instead. The default also
  makes the field's absence — an older companion, which never wrote the key —
  mean exactly what that companion was already drawing. -/
  linkMarks : Bool := true
  /-- `proofTree.typingHoldMs` — how long a changed proof text sits quiet
  before the widget swaps the new tree in (the anti-shudder hold while typing
  in the buffer; see the `stable` machinery in widget.tsx, which owns the
  default and the clamp — this end just carries the number). The one
  non-Bool setting on this wire. -/
  typingHoldMs : Nat := 600
  /-- `proofTree.counterfactual` — the live sorry-stub preview while typing
  (see `maybeCounterfactual`). Defaults TRUE like `linkMarks`: absence means
  an older companion, which should get the shipped behaviour. The client
  passes it back per `getProofTree` call, since the decision is made
  server-side but the setting rides this channel. -/
  counterfactual : Bool := true
  /-- `lean4.input.*` — unicode abbreviations for the in-place tactic editor.
  Settings again, so again the long way round. -/
  input : InputConfig := {}
  colors : Array ThemeTokenColor := #[]
  deriving ToJson

/-- Hand-written because the DERIVED `FromJson` does not honour the field
defaults above: a missing key is an error, not the default. That matters here
and nowhere else on this wire, because the two ends ship SEPARATELY — the
companion is a dev-installed extension that can easily be older than the
server. With the derived instance, a `theme-colors.json` written before
`outline` existed failed to decode outright, so `themeColors` fell back to `{}`
and the user lost the WHOLE PALETTE over one absent flag, until the extension
host happened to restart and rewrite the file. Every field is therefore
optional and a bad value is the default, so a new field can only ever be
ignored by an old reader and defaulted by a new one. -/
instance : FromJson ThemeColors where
  fromJson? j :=
    .ok { theme := jsonField j "theme" "",
          brackets := jsonField j "brackets" false,
          outline := jsonField j "outline" false,
          tallFrame := jsonField j "tallFrame" false,
          linkEmoji := jsonField j "linkEmoji" false,
          linkTint := jsonField j "linkTint" false,
          linkMarks := jsonField j "linkMarks" true,
          typingHoldMs := jsonField j "typingHoldMs" 600,
          counterfactual := jsonField j "counterfactual" true,
          input := jsonField j "input" {},
          colors := jsonField j "colors" #[] }

/-- `themeColors` takes nothing; `Unit` is not `RpcEncodable`, so this stands in
(the same shape as `GetProofTreeParams`). -/
structure ThemeColorsParams where
  deriving FromJson, ToJson

/-- Read the palette the companion resolved from the active VS Code theme.

This exists because the return path of the relay is otherwise missing. A webview
is handed `--vscode-*` variables for the workbench colour REGISTRY only, and
TextMate/semantic token colours are not in it — the extension API has no
token-colour member at all (`ColorTheme` exposes nothing but `kind`), so the
widget cannot ask. Only an extension can read the theme's JSON, and only the
server can read a file for the widget. Hence: companion writes, this reads.

Deliberately NOT part of `getProofTree`'s payload, and deliberately not cached:
that payload is keyed on `(uri, version, command start)`, so a theme switch
would not invalidate it and the colours would not change until the next EDIT.
This is a few hundred bytes read on demand instead. -/
@[server_rpc_method]
def themeColors (_ : ThemeColorsParams) : RequestM (RequestTask ThemeColors) := do
  RequestM.asTask do
    let some home ← IO.getEnv "HOME" | return {}
    let file := System.FilePath.mk home / ".proof-tree-companion" / "theme-colors.json"
    -- Absent companion, absent file, half-written file: all mean the same
    -- thing to the client — keep the built-in palette.
    unless ← file.pathExists do return {}
    let txt ← IO.FS.readFile file
    match Json.parse txt >>= fromJson? with
    | .error _ => return {}
    | .ok (c : ThemeColors) => return c

end ProofTree

/-- The proof-tree panel widget: the bundled React renderer from `web/`.

`Component PanelWidgetProps` means the infoview supplies the standard panel props
(cursor `pos`, current goals, …); the renderer reads `props.pos` and calls
`ProofTree.getProofTree` over RPC. Turn it on in a proof file with:

```lean
show_panel_widgets [ProofTreeWidget]
```
-/
@[widget_module]
def ProofTreeWidget : ProofWidgets.Component ProofWidgets.PanelWidgetProps where
  javascript := include_str ".." / "web" / "dist" / "proofTreeWidget.js"
