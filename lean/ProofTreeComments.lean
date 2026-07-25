import Lean

/-!
# ProofTreeComments

Source-comment extraction shared by both data paths (the `ppharness` CLI and
the `ProofTreeWidget` RPC). Comments are parser trivia — they never appear in
the `InfoTree` — so the wire payload's `comments` field comes from re-lexing
the *raw source* of just the command (theorem) that produced the proof:

  command range ── extractComments ─▶ Array SourceComment ({text, start, stop})

Attribution of comments to tree nodes happens JS-side (`proofToTree.ts`),
which already has every tactic's LSP range; here we only find the comments.
The lexer understands `--` line comments, nested `/- -/` blocks (including
doc comments — the range of a `theorem` command includes its docstring,
which therefore attributes to the ROOT goal, deliberately), string literals,
and char literals (guarded so identifier primes like `h'` don't open one).
Known blind spot: raw string literals (`r"..."`) — a `--` inside one would be
taken for a comment; they don't realistically occur inside tactic proofs.
-/

open Lean

namespace ProofTree

/-- One source comment, raw text including its delimiters (`--`, `/- -/`);
the client strips/normalizes for display. Positions are LSP, the same space
as Paperproof's `ProofStepPosition`. -/
structure SourceComment where
  text  : String
  start : Lsp.Position
  stop  : Lsp.Position
  deriving ToJson, FromJson

/-- Would `c` extend an identifier? Guards the char-literal case: a `'` right
after an identifier char is a prime (`h'`), not a literal opener. Heuristic —
ASCII alnum + `_` + `'` covers real proofs; a false "ident" just means we skip
char-literal special-casing there, which only matters if the literal contains
`-` or `"`. -/
private def isIdentish (c : Char) : Bool :=
  c.isAlphanum || c == '_' || c == '\''

private def mkComment (src : String) (fileMap : FileMap) (b e : String.Pos.Raw) :
    SourceComment :=
  { text  := String.Pos.Raw.extract src b e
    start := fileMap.utf8PosToLspPos b
    stop  := fileMap.utf8PosToLspPos e }

/-- Lex `src` between `startPos` and `stopPos`, returning every comment's
raw span. Line comments end at the newline (exclusive); block comments nest.
String and char literals are skipped so their contents can't fake a comment
opener. The core of `extractComments`, also reused by `trimTrailingTrivia`. -/
partial def commentSpans (src : String)
    (startPos stopPos : String.Pos.Raw) :
    Array (String.Pos.Raw × String.Pos.Raw) := Id.run do
  let atEnd := (String.Pos.Raw.atEnd src)
  let next  := (String.Pos.Raw.next src)
  let getc  := (String.Pos.Raw.get src)
  let get! (p : String.Pos.Raw) : Char := if atEnd p then ' ' else getc p
  let mut out : Array (String.Pos.Raw × String.Pos.Raw) := #[]
  let mut p := startPos
  let mut prev : Char := ' '
  while p < stopPos && !atEnd p do
    let c := getc p
    if c == '-' && get! (next p) == '-' then
      -- `--` line comment: to end of line.
      let b := p
      while !atEnd p && getc p != '\n' do
        p := next p
      out := out.push (b, p)
      prev := '\n'
    else if c == '/' && get! (next p) == '-' then
      -- `/- -/` block comment (nested; also matches `/--` doc comments).
      let b := p
      let mut depth := 1
      p := next (next p)
      while !atEnd p && depth > 0 do
        let d := getc p
        if d == '/' && get! (next p) == '-' then
          depth := depth + 1
          p := next (next p)
        else if d == '-' && get! (next p) == '/' then
          depth := depth - 1
          p := next (next p)
        else
          p := next p
      out := out.push (b, p)
      prev := ' '
    else if c == '"' then
      -- String literal: skip to the closing quote, honoring escapes.
      p := next p
      while !atEnd p && getc p != '"' do
        p := if getc p == '\\' then next (next p) else next p
      p := next p
      prev := '"'
    else if c == '\'' && !isIdentish prev then
      -- Possible char literal ('a', '\n', '-'): look for the closing quote a
      -- few chars ahead; if none, it's something else — consume just the `'`.
      let mut q := next p
      let mut n := 0
      while n < 8 && !atEnd q && getc q != '\'' do
        q := if getc q == '\\' then next (next q) else next q
        n := n + 1
      p := if get! q == '\'' then next q else next p
      prev := '\''
    else
      prev := c
      p := next p
  return out

/-- Lex `src` between `startPos` and `stopPos`, collecting every comment. -/
def extractComments (src : String) (fileMap : FileMap)
    (startPos stopPos : String.Pos.Raw) : Array SourceComment :=
  commentSpans src startPos stopPos |>.map fun (b, e) =>
    mkComment src fileMap b e

/-- One semantic token inside a tactic's tight range: the span the Lean server's
own syntax highlighter assigns a `SemanticTokenType` to, plus that type's name
(`"keyword"`, `"variable"`, `"property"`, `"function"`, …). Positions are
ABSOLUTE document positions, like the enclosing `TacticEdit`'s — the client
turns them into offsets into `text`, which starts exactly at `TacticEdit.start`. -/
structure TacticToken where
  start : Lsp.Position
  stop  : Lsp.Position
  type  : String
  deriving ToJson, FromJson

/-- The in-place editing seam for one tactic: the TIGHT source range of the
tactic text proper and that text, verbatim. Paperproof's `ProofStep.position`
includes trailing trivia (comments, the newline + indentation up to the next
token) and its `tacticString` is prettified for display (first line only,
`rw` re-synthesized) — so neither is safe to edit with. The server, which has
the real source, re-extracts the range's text and trims trailing trivia
(`trimmedEnd`), so replacing `[start, stop)` with edited text can never eat a
trailing comment.

`start`/`stop` are the SURFACE tactic's range, which is not always the step's:
Paperproof splits `rw [a, b]` into one step per rule, so those steps' ranges
cover a rule (and its trailing separator) rather than a tactic anyone wrote.
Editing that is nonsense — you get `a,` in the box — and its tokens miss the
`rw` keyword entirely, so the label's own `rw` had neither colour nor
docstring popup. Such a step is widened to the tactic that owns it (see
`getProofTree`), and `stepStart` keeps the client's key on the step itself. -/
structure TacticEdit where
  /-- The STEP's own `position.start`: what the client keys this entry by, and
  equal to `start` for every tactic that wasn't split. -/
  stepStart : Lsp.Position
  start : Lsp.Position
  stop  : Lsp.Position
  text  : String
  /-- Syntax highlighting for `text`, from the server's own semantic tokens. -/
  tokens : Array TacticToken := #[]
  /-- Column where this step's LINE begins its tactic text — past the indent
  and past a bullet marker (see `tacticIndentAt`). The widget's (+) insertion
  indents new sibling tactics to it, because a step's own `start.character` is
  wrong for split tactics and the bare line indent is wrong for bulleted
  ones. -/
  tacticIndent : Nat := 0
  deriving ToJson, FromJson

/-- The column at which `line`'s TACTIC TEXT begins: past the leading
whitespace, and past a bullet marker (`·`/`.` followed by space) if there is
one. This is the column a new sibling tactic must be indented to.

Neither of the two obvious answers works alone, which is the whole reason this
exists. A step's own `start.character` lies whenever Paperproof SPLIT the
tactic: `rw [a, b]` becomes one step per rule, so the step for `b` starts at
the rule inside the brackets (col 13 of `      rw [h, hk]`, not the `rw` at
col 6). But the plain line indent lies in the other direction on a bulleted
line: in `  · constructor` the indent is 2, while that `constructor`'s own
branches belong at col 4, under the tactic rather than under the `·`. Skipping
whitespace-then-bullet gets both right.

A case marker (`| zero => …`) is deliberately NOT skipped: `case` insertions
write their own `| name =>` and so want the marker's own column. The `.` bullet
is only recognised before whitespace, so `.foo` dot-notation is not mistaken
for one. Counting code points matches the LSP `character` the client compares
against. Not `private`: a probe checks it directly. -/
def tacticIndentAt (fileMap : FileMap) (line : Nat) : Nat := Id.run do
  let src := fileMap.source
  let isSpace (c : Char) := c == ' ' || c == '\t'
  let mut p := fileMap.lspPosToUtf8Pos ⟨line, 0⟩
  while !String.Pos.Raw.atEnd src p && isSpace (String.Pos.Raw.get src p) do
    p := String.Pos.Raw.next src p
  -- A bullet belongs to the enclosing block; the tactic it introduces starts
  -- after it, and that is where ITS siblings go.
  if !String.Pos.Raw.atEnd src p then
    let c := String.Pos.Raw.get src p
    if c == '·' || c == '.' then
      let q := String.Pos.Raw.next src p
      if !String.Pos.Raw.atEnd src q && isSpace (String.Pos.Raw.get src q) then
        p := q
        while !String.Pos.Raw.atEnd src p && isSpace (String.Pos.Raw.get src p) do
          p := String.Pos.Raw.next src p
  return (fileMap.utf8PosToLspPos p).character

/-- The end of `s` with all trailing TRIVIA removed: whitespace, and any
comments that (after whitespace) close the string — iterated, so
`tac  -- a\n  -- b\n` trims to just `tac`. Interior comments stay. Used to
tighten a tactic's Paperproof range (which includes trailing trivia) down to
the tactic text proper for in-place editing: replacing the tight range can't
eat a trailing comment. -/
def trimmedEnd (s : String) : String.Pos.Raw := Id.run do
  let spans := commentSpans s ⟨0⟩ s.rawEndPos
  let bytes := s.toUTF8
  let isWs (b : UInt8) : Bool :=
    b == 32 || b == 9 || b == 10 || b == 13
  let mut e := bytes.size
  let mut go := true
  while go do
    while e > 0 && isWs (bytes.get! (e - 1)) do
      e := e - 1
    -- A comment closing exactly at the trimmed end is trailing trivia too.
    match spans.find? (fun (_, stop) => stop.byteIdx == e) with
    | some (b, _) => e := b.byteIdx
    | none => go := false
  -- `e` is a char boundary: either a comment start or the byte after a
  -- non-whitespace char we stopped at (whitespace is ASCII, so stripping it
  -- byte-wise can't split a multibyte char).
  return ⟨e⟩

/-- End of the line containing `p` (the newline itself, or end of string). -/
private def lineEnd (src : String) (p : String.Pos.Raw) : String.Pos.Raw := Id.run do
  let mut q := p
  while !String.Pos.Raw.atEnd src q && String.Pos.Raw.get src q != '\n' do
    q := String.Pos.Raw.next src q
  return q

/-- All comments within a command's source `range`, the range extended to the
end of its final line — the stop of a syntax range excludes trailing trivia,
which is exactly where a trailing comment on the proof's LAST line lives
(`exact foo -- done`). -/
def commentsInRange (src : String) (fileMap : FileMap) (range : Lean.Syntax.Range) :
    Array SourceComment :=
  extractComments src fileMap range.start (lineEnd src range.stop)

/-- The source range spanned by a command's `InfoTree`: min/max over every
info node's syntax range. Used by the CLI, which (unlike the widget's
`snap.stx`) has no direct handle on the command syntax. Token positions
exclude leading trivia, so a module doc or comments between commands
never fall inside. -/
def commandRange (tree : Elab.InfoTree) : Option Lean.Syntax.Range :=
  tree.foldInfo (init := none) fun _ info acc =>
    match info.stx.getRange? with
    | some r =>
      match acc with
      | some a => some ⟨min a.start r.start, max a.stop r.stop⟩
      | none   => some r
    | none => acc

/-- An unproved link of a `calc` chain: a `?_` standing where its justification
goes, plus enough of the enclosing link to write a new one above it.

A calc chain is the one construct here whose work-in-progress state is a HOLE
rather than a missing tactic — the chain must always end at the goal's RHS, so
it cannot simply be left short. Written `_ = c := ?_`, the link's goal is
genuinely pending (it arrives in `goalsAfter`, not `spawnedGoals`), and this is
what lets the tree fill it exactly where it belongs instead of appending a line
after the block.

The pairing is EXACT, not positional: a `?_` elaborates to a metavariable whose
id is the very `GoalInfo.id` the wire carries, so `goalId` joins the two with no
assumption about the order links are reported in. -/
structure CalcHole where
  /-- The `?_`'s metavariable = `GoalInfo.id` on the wire. -/
  goalId : String
  /-- The `?_` token itself: replacing exactly this fills the link in place. -/
  start : Lsp.Position
  stop  : Lsp.Position
  /-- Start of the enclosing calc step (`_ = c := ?_`) — its line is where a
  new link is inserted and its character is the column to indent it to. -/
  linkStart : Lsp.Position
  /-- Whether the enclosing step is the chain's FIRST link (`calcFirstStep`).
  Nothing can be inserted above one: its LHS is the chain's real head rather
  than a `_` that would absorb a new predecessor's RHS. -/
  first : Bool
  deriving ToJson, FromJson

/-- Where a chain that stops SHORT of its goal continues.

The dual of `CalcHole`, and the other half of editing a chain from the tree. A
chain whose links don't reach the goal's RHS still elaborates: Lean leaves the
remainder as a `calc.step` goal, which arrives on the wire as an ordinary
pending goal. Continuing it idiomatically means APPENDING a link, and that
needs two facts the wire doesn't carry — the line the chain currently ends on
(a step's range covers the whole tactic, trailing trivia and all) and the
column its links are written at (the author's layout, which nothing else
records).

Keyed by the `calc` tactic's own start, which is exactly `ProofStep.position.start`
for the step the residue goal hangs off. -/
structure CalcChain where
  /-- The `calc` keyword = `ProofStep.position.start` on the wire. -/
  tacticStart : Lsp.Position
  /-- End of the final link: a new one goes after this line. -/
  lastLink : Lsp.Position
  /-- Column the chain's links are written at. -/
  indent : Nat
  /-- The block failed to PARSE: it has no well-formed subsequent step, so the
  step parser had no column to anchor on and swallowed whatever followed.

  This is the state you are in while typing a chain — `calc e` and nothing yet —
  and it is much worse than it looks: the enclosing command fails to parse
  entirely, so nothing below the calc elaborates and the whole proof drops out
  of the tree. The syntax survives, though, which is what lets the chain still
  be reported and one appended link put the proof back. -/
  broken : Bool
  /-- How many WELL-FORMED links the block has. Zero is `calc` and nothing yet
  (or `calc a = b :=` with the proof unwritten): there is no link to hang an
  appended one after, so the chain is reported for VISIBILITY only and the
  client draws it without a repair chip. -/
  links : Nat := 0
  /-- End of the reportable span — the last well-formed link, or the end of the
  `calc`'s own first line when there is none. NOT the block's syntax range,
  which in the broken case covers the tactic the parser swallowed (see
  `CalcBlock`); the client hands this to the cursor accent, so a calc must not
  be able to claim a neighbour's positions. -/
  stop : Lsp.Position
  /-- The block's verbatim source over `[tacticStart, stop)`. The client draws
  a synthesized node for a chain that never elaborated, and this is its label —
  verbatim, so it can never disagree with the source the layout measured. -/
  text : String
  /-- The FIRST link carries no `:= proof` (`calcFirstStep`'s justification is
  optional). Repairing such a block by appending a link is WRONG: a bare first
  step is the chain's starting EXPRESSION, so `calc a ≤ b` followed by
  `_ ≤ _ := ?_` reads as `(a ≤ b) ≤ _` and fails to synthesize a `Trans`
  instance (elaborated, not reasoned about). It is also the commonest state
  while typing — the `:=` simply isn't there yet — so the repair COMPLETES the
  first link as well as adding the subsequent one. Both halves are needed:
  measured, completing alone leaves the block still unparsed, since the
  missing subsequent step is the actual trigger. -/
  firstBare : Bool := false
  deriving ToJson, FromJson

/-- One `calc` block: its range, its WELL-FORMED links in source order, and
whether the block as a whole failed to parse.

Links carrying `Syntax.missing` are dropped rather than reported. In a broken
block the trailing `calcStep` is the parser's failed attempt to read the next
tactic as a link — measured, its range covers the following `· trivial` bullet
verbatim — so its range means nothing and using it to place an insertion would
write into a neighbouring tactic. The `calcFirstStep` is intact in that state
(measured `missing=false` with an exact range), which is the one thing needed
to repair the block. -/
structure CalcBlock where
  range : Lean.Syntax.Range
  links : Array (Lean.Syntax.Range × Bool)
  broken : Bool
  /-- The first link has no `:= proof` — see `CalcChain.firstBare`. -/
  firstBare : Bool := false

/-- Every `calc` block in the tree, with its links in source order.

Shared by the two collectors below — one keys on the LINKS' ranges, the other
on the block's — and deduped by the block's range, since the same calc surfaces
in several `TacticInfo`s under macro expansion.

Blocks are found by descending SYNTAX, not by matching an info node's own kind:
a `calc` that never elaborated has no `TacticInfo` of its own, but its syntax
survives inside the enclosing tactic's (the `by` block, the bullet, the
`induction`), which is what lets a chain still be reported while it is being
typed. `extra` is the widget's `snap.stx`, the whole command — the last resort
for a proof where nothing under the calc elaborated at all.

Zero well-formed links is a REPORTED state, not a skipped one: `calc` and
nothing yet is precisely what the tree most needs to draw. -/
def calcBlocks (fileMap : FileMap) (tree : Elab.InfoTree)
    (extra : Option Syntax := none) : Array CalcBlock := Id.run do
  let roots := tree.foldInfo (init := extra.toArray) fun _ info acc =>
    match info with
    | .ofTacticInfo ti => acc.push ti.stx
    | _ => acc
  let mut out := #[]
  for root in roots do
    for stx in calcNodes root do
      let some r := stx.getRange? (canonicalOnly := true) | continue
      unless out.any (fun b => b.range.start == r.start && b.range.stop == r.stop) do
        let cp := fileMap.utf8PosToLspPos r.start
        -- `hasMissing` is not enough to reject a link the parser invented.
        -- Measured: after a bare `calc`, the FOLLOWING bullet is read as the
        -- first link's term (`· trivial` is cdot notation, so nothing is
        -- missing) and its range covers a neighbouring tactic verbatim. Lean's
        -- own layout rule rules it out — a link on a later line must be
        -- indented PAST the `calc`, or it is not part of the block.
        let links := (calcSteps stx).qsort
            (fun a b => a.1.start.byteIdx < b.1.start.byteIdx)
          |>.filter fun (lr, _) =>
            let lp := fileMap.utf8PosToLspPos lr.start
            lp.line == cp.line || lp.character > cp.character
        -- `calcFirstStep := ppIndent(colGe term (" := " term)?)`, so the
        -- justification is arg 1 and an empty node there means it is absent.
        let firstBare := match firstStep stx with
          | some fs => fs.getNumArgs > 1 && fs[1]!.getNumArgs == 0
          | none => false
        out := out.push {
          range := r, links := links, firstBare
          -- No well-formed link at all IS the broken state: the subsequent-step
          -- parser had no column to anchor on (see `CalcChain.broken`).
          broken := stx.hasMissing || links.isEmpty
        }
  return out
where
  /-- The `calcTactic` nodes anywhere under `stx`. -/
  calcNodes (stx : Syntax) : Array Syntax := Id.run do
    let mut out := #[]
    match stx with
    | .node _ k args =>
      if k == ``Lean.calcTactic then out := out.push stx
      for a in args do out := out ++ calcNodes a
    | _ => pure ()
    return out
  /-- The block's `calcFirstStep` node, if it read one at all. -/
  firstStep (stx : Syntax) : Option Syntax :=
    match stx with
    | .node _ k args =>
      if k == ``Lean.calcFirstStep then some stx
      else args.foldl (fun acc a => acc <|> firstStep a) none
    | _ => none
  /-- The `calcFirstStep`/`calcStep` nodes under `stx`, with their ranges.
  Recursive over raw syntax: a link is not an info node of its own. -/
  calcSteps (stx : Syntax) : Array (Lean.Syntax.Range × Bool) := Id.run do
    let mut out := #[]
    match stx with
    | .node _ k args =>
      if k == ``Lean.calcFirstStep || k == ``Lean.calcStep then
        -- A link the parser only half-read is not a link; see `CalcBlock`.
        if !stx.hasMissing then
          if let some r := stx.getRange? (canonicalOnly := true) then
            out := out.push (r, k == ``Lean.calcFirstStep)
      for a in args do out := out ++ calcSteps a
    | _ => pure ()
    return out

/-- Every `calc` block, with the line and column a NEW LAST link would take.

The column is the SECOND link's, because that is the one the chain's existing
links already prove parses — subsequent links are anchored on it by `colGe`, so
matching it is safe where guessing (`calc`'s own column plus two) is only a
convention. A one-link chain has no second link to read, and none of its own
column is meaningful either (`calc a = b := prf` puts the link mid-line), so it
falls back to that convention — which is also the BROKEN case, since a block
with no well-formed subsequent step is exactly the one the parser has no anchor
for (see `CalcBlock`). Appending there is a repair: it gives the parser its
anchor back, so everything the block swallowed elaborates again. -/
def collectCalcChains (fileMap : FileMap) (tree : Elab.InfoTree)
    (extra : Option Syntax := none) : Array CalcChain := Id.run do
    let src := fileMap.source
    let mut out : Array CalcChain := #[]
    for b in calcBlocks fileMap tree extra do
      let start := fileMap.utf8PosToLspPos b.range.start
      let indent := match b.links[1]? with
        | some (r, _) => (fileMap.utf8PosToLspPos r.start).character
        | none => start.character + 2
      -- The reportable span (see `CalcChain.stop`): through the last
      -- well-formed link, or to the end of the `calc`'s own line when the
      -- block has none — never the block's range, which when broken runs on
      -- into the tactic the parser swallowed.
      let stopPos := match b.links.back? with
        | some (r, _) => r.stop
        | none => Id.run do
          let mut p := b.range.start
          while !String.Pos.Raw.atEnd src p && String.Pos.Raw.get src p != '\n' do
            p := String.Pos.Raw.next src p
          return p
      out := out.push {
        tacticStart := start
        -- Nothing well-formed to append after: the `calc`'s own line is where
        -- a first link goes, which is where one is written by hand too.
        lastLink := fileMap.utf8PosToLspPos stopPos
        indent := indent
        broken := b.broken
        links := b.links.size
        stop := fileMap.utf8PosToLspPos stopPos
        text := String.Pos.Raw.extract src b.range.start stopPos
        firstBare := b.firstBare
      }
    return out

/-- Every `?_` inside a `calc` link, paired with the goal it stands for.

Two independent walks, because neither half knows the other's coordinates. The
info tree gives goal → hole SPAN (a `Term.syntheticHole` whose elaborated `expr`
is the metavariable); the SYNTAX gives the link structure, which no info node
records. Note the calc `_` placeholder is a `Term.hole`, not a syntheticHole,
so filtering on the kind excludes it — it is not a goal either.

A `?_` that is not inside a calc link is deliberately DROPPED: `refine ⟨?_, ?_⟩`
holes are better served by the existing `· ` bullet insertion, which is what
one would write there by hand. -/
def collectCalcHoles (fileMap : FileMap) (tree : Elab.InfoTree)
    (extra : Option Syntax := none) : Array CalcHole := Id.run do
    let links := (calcBlocks fileMap tree extra).flatMap (·.links)
    if links.isEmpty then return #[]

    let mut out : Array CalcHole := #[]
    let holes := tree.foldInfo (init := #[]) fun _ info acc =>
      match info with
      | .ofTermInfo ti =>
        match ti.expr, ti.stx.getRange? (canonicalOnly := true) with
        | .mvar id, some r =>
          if ti.stx.isOfKind ``Lean.Parser.Term.syntheticHole then
            acc.push (id.name.toString, r)
          else acc
        | _, _ => acc
      | _ => acc
    for (goalId, r) in holes do
      -- The SMALLEST containing link, so a nested calc's links can't claim a
      -- hole belonging to an inner one.
      let mut best : Option (Lean.Syntax.Range × Bool) := none
      for l@(lr, _) in links do
        if lr.start ≤ r.start && r.stop ≤ lr.stop then
          match best with
          | some (br, _) =>
            if lr.stop.byteIdx - lr.start.byteIdx < br.stop.byteIdx - br.start.byteIdx then
              best := some l
          | none => best := some l
      if let some (lr, isFirst) := best then
        out := out.push {
          goalId := goalId
          start := fileMap.utf8PosToLspPos r.start
          stop := fileMap.utf8PosToLspPos r.stop
          linkStart := fileMap.utf8PosToLspPos lr.start
          first := isFirst
        }
    return out

/-! ## Which relations a `calc` chain on a goal could be built out of -/

/-- One relation a chain on this goal could start with: the first link's
relation `rel`, and the relation `next` the SECOND link must carry for the two
to compose back to the goal's own relation T (`Trans rel next T`).

`same` marks the degenerate pair `rel = next = T`, which is the only one that
needs no intermediate expression — appending a single `_ T _ := ?_` link
discharges the goal directly. -/
structure CalcRelOption where
  rel  : String
  next : String
  same : Bool
  deriving ToJson, FromJson

/-- The relations offered for a goal. An entry with EMPTY `options` is a
positive answer ("we looked; this goal is not chainable"), which is why one is
emitted for every goal examined — the client distinguishes that from the field
being absent altogether (an older CLI dump), where it falls back to its own
string-level heuristic. -/
structure CalcRelations where
  goalId  : String
  /-- The goal's own relation symbol, `""` when it has none. -/
  rel     : String
  options : Array CalcRelOption
  deriving ToJson, FromJson

/-- Every goal in the tree, with a `MetaM` context to inspect it in.

Mirrors `collectTaggedGoals` exactly — same `TacticInfo` fold, same
`mctxAfter`, same first-wins — so a goal's type is decomposed in the very
context its printed form on the wire came from. -/
def goalContexts (tree : Elab.InfoTree) :
    Std.HashMap String (Elab.ContextInfo × MVarId) := Id.run do
  let tacticNodes := tree.foldInfo (init := #[]) fun ctx info acc =>
    if let .ofTacticInfo ti := info then acc.push (ctx, ti) else acc
  let mut out : Std.HashMap String (Elab.ContextInfo × MVarId) := {}
  for (ctx, ti) in tacticNodes do
    let printCtx := { ctx with mctx := ti.mctxAfter }
    for mvarId in ti.goalsBefore ++ ti.goalsAfter do
      let key := mvarId.name.toString
      unless out.contains key do out := out.insert key (printCtx, mvarId)
  return out

/-- A relation's infix symbol, by printing it applied to two variables and
taking the middle token.

Mathlib's own calc widget does this (`Mathlib/Tactic/Widget/Calc.lean`); the
arity check is ours, and load-bearing, because this string gets WRITTEN INTO
SOURCE. It rejects anything that does not print as a plain infix — measured,
`Nat.ModEq n` prints `x ≡ y [MOD n]` (four tokens) and is correctly declined
rather than emitted as an unwritable `≡`. -/
private def relSymbol (r : Expr) : Lean.MetaM (Option String) := do
  Lean.Meta.forallBoundedTelescope (← Lean.Meta.inferType r) (some 2) fun xs _ => do
    unless xs.size == 2 do return none
    let a ← Lean.Meta.inferType xs[0]!
    let b ← Lean.Meta.inferType xs[1]!
    Lean.Meta.withLocalDeclD `x a fun x => Lean.Meta.withLocalDeclD `y b fun y => do
      -- `headBeta` because an instance may state its relation as a LAMBDA
      -- (core's `Nat.instTransLe` is `Trans (fun a b => a ≤ b) …`), and an
      -- unreduced redex prints as `(fun a b => a ≤ b) x y` — many tokens, so
      -- the arity check below would reject a perfectly ordinary `≤`.
      let s := toString (← Lean.Meta.ppExpr (mkAppN r #[x, y]).headBeta)
      let parts := s.splitOn " "
      return if parts.length == 3 then some parts[1]! else none

/-- The relations a `calc` chain proving `mvarId` could start with.

The question `calc` actually asks is "which R and S satisfy `Trans R S T`" for
the goal's relation T, and there is no API for it — core only ever SYNTHESISES
`Trans r s ?t` with both inputs known (`mkCalcTrans`), and Mathlib's calc
widget never touches `Trans` at all, reusing the goal's own relation symbol for
every step. So: query the instance index with both inputs open, then verify
each concrete candidate with the very synthesis core would run.

The gate on offering anything at all is that **T chains with ITSELF**. That is
not a convenience: `Trans Eq r r` and `Trans r Eq r` are core instances holding
for ANY binary relation, so "some pair verified" is satisfied by `Even n ∨
Odd n` (measured — `∨ then =` synthesises fine). Requiring `(T, T)` is
name-free, rejects `∨`/`∧`/`≠`, and is exactly the assumption the two-link
skeleton the client writes already makes. -/
def calcRelationsFor (ctx : Elab.ContextInfo) (goalId : String) (mvarId : MVarId)
    (cap : Nat := 6) : IO CalcRelations := do
  let none? : CalcRelations := { goalId, rel := "", options := #[] }
  try
    -- `withContext`, not the empty lctx `runMetaM` starts in: the goal's type
    -- is written in terms of its own free variables, so inferring anything
    -- about it outside its context throws `unknown free variable`.
    ctx.runMetaM {} <| mvarId.withContext do
      -- `consumeMData` is load-bearing: a `have`'s CONTINUATION goal arrives
      -- wrapped in `mdata noImplicitLambda`, and `getCalcRelation?` decomposes
      -- with `getAppNumArgs`, which sees an `.mdata` head and answers 0 — so a
      -- perfectly ordinary `⊢ (a + b) ^ 2 ≤ 2 * (a ^ 2 + b ^ 2)` sitting under
      -- a `have` was declined outright. Found by dumping the raw Expr; the
      -- string-level heuristic this replaced never saw the wrapper.
      let goalTy := (← Lean.instantiateMVars (← mvarId.getType)).consumeMData
      let some (t, a, b) ← Lean.Elab.Term.getCalcRelation? goalTy | return none?
      let some tsym ← relSymbol t | return none?
      let α ← Lean.Meta.inferType a
      let γ ← Lean.Meta.inferType b
      -- Prop-valued and homogeneous in the midpoint: the overwhelming case,
      -- and a wrong guess costs a MISSING option, never a wrong one.
      let r ← Lean.Meta.mkFreshExprMVar
        (← Lean.mkArrow α (← Lean.mkArrow α (mkSort levelZero)))
      let s ← Lean.Meta.mkFreshExprMVar
        (← Lean.mkArrow α (← Lean.mkArrow γ (mkSort levelZero)))
      let query ← Lean.Meta.mkAppM ``Trans #[r, s, t]
      let insts ← try Lean.Meta.SynthInstance.getInstances query
                  catch _ => pure #[]
      let mut pairs : Array (String × String) := #[]
      for inst in insts.take 64 do
        let got ← Lean.withoutModifyingState do
          let (_, _, concl) ←
            Lean.Meta.forallMetaTelescopeReducing (← Lean.Meta.inferType inst.val)
          unless ← Lean.Meta.isDefEq concl query do return none
          let r' ← Lean.instantiateMVars r
          let s' ← Lean.instantiateMVars s
          -- Still open ⇒ this instance is a wildcard nothing pinned (e.g.
          -- Mathlib's `[IsTrans α r] : Trans r r r`); it names no relation.
          if r'.hasExprMVar || s'.hasExprMVar then return none
          let some rs ← relSymbol r' | return none
          let some ss ← relSymbol s' | return none
          -- The verify: `mkCalcTrans`'s own test, so an offered pair is one
          -- the calc elaborator will accept.
          match ← Lean.Meta.trySynthInstance (← Lean.Meta.mkAppM ``Trans #[r', s', t]) with
          | .some _ => return some (rs, ss)
          | _       => return none
        if let some p := got then pairs := pairs.push p
      unless pairs.any (fun p => p.1 == tsym && p.2 == tsym) do
        return { goalId, rel := tsym, options := #[] }
      -- One option per distinct FIRST relation, preferring the pair whose
      -- second relation is the goal's own (the most useful continuation), and
      -- with `(T, T)` first so today's one-click behaviour stays the default.
      let mut opts : Array CalcRelOption := #[]
      for (rel, _) in pairs do
        unless opts.any (·.rel == rel) do
          let cands := pairs.filter (·.1 == rel)
          let next := ((cands.find? (·.2 == tsym)).getD cands[0]!).2
          opts := opts.push { rel, next, same := rel == tsym && next == tsym }
      let ordered := (opts.filter (·.same)) ++ (opts.filter (!·.same))
      return { goalId, rel := tsym, options := ordered.take cap }
  catch _ => return none?

/-- Just enough of a `ProofStep` to apply the pending rule. Abstracted so the
rule below can live here, in the lib BOTH wires share, rather than being
written out twice against Paperproof's structure — which this module
deliberately does not import. -/
structure CalcGoalStep where
  goalBefore : String
  goalsAfter : Array String
  start      : Lsp.Position
  stop       : Lsp.Position

/-- Which goals to enumerate relations for.

VERBATIM the client's own rule (`proofToTree.ts`), and it must stay that way —
a drift shows up as chips silently vanishing, not as an error:

* PENDING — reached through `goalsAfter` (never `stepGoalsAfter`: a spawned
  goal no tactic consumes is not the frontier, it restates something already
  handled inside a branch) and consumed by no step;
* plus the goal a BROKEN block hangs off — the innermost step whose range
  contains the block's start. Containment is HALF-OPEN, the same fact the
  cursor accent rests on: the producer above a bare `calc` has a
  trivia-inflated range ending exactly AT the calc's start, and an inclusive
  test would hand the chain that tactic's own goal instead. -/
def calcRelationGoals (steps : Array CalcGoalStep) (chains : Array CalcChain) :
    Array String := Id.run do
  let consumed := steps.foldl (init := ({} : Std.HashSet String))
    fun acc s => acc.insert s.goalBefore
  let lt (a b : Lsp.Position) : Bool := (compare a b) == .lt
  let le (a b : Lsp.Position) : Bool := (compare a b) != .gt
  let mut out : Array String := #[]
  for s in steps do
    for g in s.goalsAfter do
      unless consumed.contains g || out.contains g do out := out.push g
  for c in chains do
    if c.broken then
      let mut inner : Option CalcGoalStep := none
      for s in steps do
        if le s.start c.tacticStart && lt c.tacticStart s.stop then
          match inner with
          | some i => if le i.start s.start then inner := some s
          | none   => inner := some s
      if let some i := inner then
        unless out.contains i.goalBefore do out := out.push i.goalBefore
  return out

/-- Relation options for the goals named by `goalIds`.

The caller supplies the ids because the policy — which goals are PENDING —
lives with the steps, and must stay verbatim the client's own rule in
`proofToTree.ts` (reached through `goalsAfter`, never `stepGoalsAfter`, plus
the owner of a broken block). A drift between the two shows up as chips
silently vanishing, not as an error. -/
def collectCalcRelations (tree : Elab.InfoTree) (goalIds : Array String) :
    IO (Array CalcRelations) := do
  let ctxs := goalContexts tree
  let mut out : Array CalcRelations := #[]
  for goalId in goalIds do
    if let some (ctx, mvarId) := ctxs[goalId]? then
      out := out.push (← calcRelationsFor ctx goalId mvarId)
  return out

end ProofTree
