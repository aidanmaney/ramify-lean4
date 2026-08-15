import Lean

/-!
# ProofTreeComments

Source-comment extraction shared by both data paths (the `ppharness` CLI and
the `Ramify` RPC). Comments are parser trivia — they never appear in
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

/-- A span of the step's DISPLAY LABEL that the SOURCE does not contain, with
what the editor would show for the thing it names.

`TacticToken`s are absolute document positions, aligned into label space by
`alignInLabel`, which claims only the runs where label and source agree
character for character. That is exactly right and it is why a word the
prettifier MINTED can never be reached: it indexes into no source at all. The
one such word in the corpus is the `rfl` of a `rw [rfl]` node — the closing
`rfl` `rw`'s macro appends, whose step Paperproof harvests at the bare `]`.

So this is the other coordinate space, stated by the server because only the
server can: `labelAt` is an offset into the step's label (UTF-16 code units,
what a JS string index is), and `text` is the label slice it claims, which the
client checks before drawing — the same equality guard the tagged goal labels
use, and the only thing standing between a label fix-up and a span that
colours someone else's characters. `doc` is plain markdown (the
`TacticTokenInfo.doc` path), never a `WithRpcRef`: there is no info node to
reference, which is the whole reason this field exists. -/
structure LabelToken where
  labelAt : Nat
  text    : String
  type    : String
  doc     : String
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
  /-- Spans of the LABEL that no source token can reach (see `LabelToken`).
  Empty for every tactic anyone actually wrote. -/
  labelTokens : Array LabelToken := #[]
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

/-- A range's stop tightened past trailing trivia: `trimmedEnd` of the range's
own slice, re-anchored at its start. Idempotent when there is nothing to trim.
THE one coding of the "tight stop" idiom — every site that narrows a
trivia-inflated range goes through it. -/
def tightStop (src : String) (start stop : String.Pos.Raw) : String.Pos.Raw :=
  ⟨start.byteIdx + (trimmedEnd (String.Pos.Raw.extract src start stop)).byteIdx⟩

/-- End of the line containing `p` (the newline itself, or end of string). -/
def lineEnd (src : String) (p : String.Pos.Raw) : String.Pos.Raw := Id.run do
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

/-- Compare two LSP positions: is `a` at or before `b`?

The one coding of it on the Lean side, mirroring `posLE` in proofToTree.ts.
Every containment test here is HALF-OPEN — `[start, stop)` — and this codebase
has been bitten by that boundary before (the cursor accent's 0-of-86 result
depends on it), so it is worth exactly one definition. -/
def posLE (a b : Lsp.Position) : Bool := (compare a b).isLE

/-- How many METAVARIABLES a printed goal type mentions.

`?` opens a metavariable's printed form (`?m`, `?b`, `?m.1234`) and nothing
else — but an identifier may END with one (`Option.get?`, `List.find?`), so the
test is a `?` that both STARTS a token and is followed by an identifier
character. Neither half alone is enough.

Used to choose between several prints of the SAME goal. Paperproof prints a
goal with its producing tactic's `mctxAfter`, so a metavariable assigned by a
later tactic is still open in that print and shows as `?m` even in a finished
proof; the step that CONSUMES the goal prints it again, later, resolved. Fewer
occurrences means strictly more instantiated, so this is the whole rule.

Counts the TYPE only, deliberately: hypotheses can carry metavariables too, but
both sides of the wire must pick the same print or the tagged text stops
matching the measured label, and the narrower rule is the easier one to keep in
agreement. Mirrored by `mvarOccurrences` in proofToTree.ts — change one, change
both. -/
def mvarOccurrences (s : String) : Nat := Id.run do
  let isIdent (c : Char) : Bool := c.isAlphanum || c == '_' || c == '\''
  let mut n := 0
  let mut prev : Char := ' '
  let mut pending := false
  for c in s.toList do
    if pending && isIdent c then n := n + 1
    pending := c == '?' && !isIdent prev
    prev := c
  return n

/-- The syntax roots the three descents below share: every `TacticInfo`'s own
`stx`, seeded with `extra`.

`extra` is the widget's `snap.stx`, the whole command — the last resort for a
tactic that never elaborated, which therefore has no info node of its own but
whose syntax still survives inside the enclosing one. -/
def tacticInfoRoots (tree : Elab.InfoTree) (extra : Option Syntax := none) :
    Array Syntax :=
  tree.foldInfo (init := extra.toArray) fun _ info acc =>
    match info with
    | .ofTacticInfo ti => acc.push ti.stx
    | _ => acc

/-- Every node of one of `kinds` anywhere under `stx`, outermost first.

Shared by the two syntax descents in this file (tactic sequences for
`tacticSlots`, `calc` blocks for `calcBlocks`), which are otherwise the same
walk written twice — and any refinement to it, macro-hygiene handling most
obviously, has to apply to both. Note a matched node is still descended into:
a `calc` nests inside a `calc`, and a sequence inside a sequence. -/
def nodesOfKind (kinds : List SyntaxNodeKind) (stx : Syntax) : Array Syntax :=
  Id.run do
    let mut out := #[]
    match stx with
    | .node _ k args =>
      if kinds.contains k then out := out.push stx
      for a in args do out := out ++ nodesOfKind kinds a
    | _ => pure ()
    return out

/-- One tactic AS THE AUTHOR WROTE IT — a direct child of some tactic sequence
— plus the lexical facts around it that only the source can answer.

This is what a DELETION acts on, and it exists because a Paperproof step range
is not it. Two measured counterexamples: `intro p hpm` is ONE step whose range
covers `intro p ` only (the label is a merged display string), and
`rcases … <;> exact h` is a step covering just the `rcases`. Deleting either
range strands text. `surfaceTacticRange` cannot fix this — it requires the
container to start STRICTLY BEFORE the step, and both containers start at the
same column — and it must not be loosened, since its 86/86 alignment behaviour
is load-bearing for token colouring and it wants the SMALLEST qualifying node
where deletion wants the LARGEST.

A direct child of a `tacticSeq` is the right unit with no head-token
heuristics: `intro p hpm`, `tac <;> tac`, `try simp`, `have … := by …`,
`induction … with | … | …` (whose syntax DOES cover its alternatives, unlike
its step range) and `· tac; tac` are each exactly one child.

Deliberately NOT built from `collectTacticRanges` (Ramify.lean): that
is a flat, kind-less list of `TacticInfo` ranges, and a `tacticSeq` carries its
own info node starting at the same offset as its first child — so any
largest-container rule over it swallows the whole block for the first tactic of
every sequence.

The client joins by CONTAINMENT rather than by a step key, which is why every
block's children are shipped rather than only the ones a step landed on: given
a slot deep inside a branch, finding the slot of the same enclosing block is a
containment search, and needs no parent pointers on the wire. -/
structure TacticSlot where
  /-- The slot's own span, tightened past trailing trivia (`trimmedEnd`). -/
  start : Lsp.Position
  stop  : Lsp.Position
  /-- The enclosing sequence's start — the block KEY. Two slots are siblings
  iff these agree. -/
  blockStart : Lsp.Position
  /-- Position among the block's children, and how many there are. Together
  these are the emptiness test: a deletion covering `0 … count-1` leaves the
  block with no tactic at all, which is where a `sorry` has to go. -/
  index : Nat
  count : Nat
  /-- Nothing but whitespace precedes `start` on its line — so the slot can be
  removed by whole LINES. False for `· intro h` and `:= by omega`, where whole
  lines would eat the bullet or the `by`. -/
  lineStart : Bool
  /-- Everything after `stop` on the last line is whitespace and/or comments.
  Computed with `trimmedEnd`, so it agrees with what the tree drew. -/
  tailIsTrivia : Bool
  /-- End of that line when `tailIsTrivia`, else `stop`. Replacing through here
  keeps a `sorry` from inheriting the dead tactic's trailing comment. -/
  tailStop : Lsp.Position
  /-- A SIBLING of the same block starts on this slot's line (`intro n; simp`).
  The delete gesture declines there rather than guessing — unlike `lineStart`,
  which is false for a bullet body too, where deleting is perfectly well
  defined. -/
  prevSameLine : Bool
  deriving ToJson, FromJson, Inhabited

/-- The `at …` location clause of one `rw`/`rewrite` tactic, verbatim, with
that tactic's own range. -/
structure RwLocation where
  /-- The `rw` tactic's own span; a step of it starts inside `[start, stop)`. -/
  start : Lsp.Position
  stop  : Lsp.Position
  /-- The clause exactly as written — `at hn`, `at hx ⊢`, `at *`. -/
  text  : String
  deriving ToJson, Inhabited

/-- Every `rw`/`rewrite` that rewrites somewhere OTHER than the goal.

This exists to undo a loss in the vendored parser rather than to add anything:
Paperproof's `prettifySteps` matches `rw [$_,*] $(_)?` and then re-synthesizes
the label as `s!"rw [{rule}]"` — one step per rewrite rule, and the matched
location clause never referenced again. So `rw [h] at hn` reaches the tree
labelled `rw [h]`, which is not a display shortening but a different tactic:
one rewrites the goal, the other a hypothesis, and the tree drew them alike.
Recovering the clause here rather than forking the parser keeps the vendored
copy untouched, which is the standing rule for this project.

Found by SYNTAX, like `calcBlocks` and `tacticSlots`, and over the same roots.
The clause is located by KIND rather than by argument index — the index is
`rwSeq`'s current shape, not a contract — but only a `location` node starting
at or after the rule list is taken, so a nested `by … at h` inside a rewrite
rule cannot be mistaken for this tactic's own. -/
def collectRwLocations (fileMap : FileMap) (tree : Elab.InfoTree)
    (extra : Option Syntax := none) : Array RwLocation := Id.run do
  let src := fileMap.source
  let roots := tacticInfoRoots tree extra
  let mut out : Array RwLocation := #[]
  for root in roots do
    for stx in nodesOfKind
        [``Lean.Parser.Tactic.rwSeq, ``Lean.Parser.Tactic.rewriteSeq] root do
      let some r := stx.getRange? (canonicalOnly := true) | continue
      let start := fileMap.utf8PosToLspPos r.start
      let stop  := fileMap.utf8PosToLspPos r.stop
      -- Macro expansion surfaces one tactic under several `TacticInfo`s.
      if out.any (fun l => l.start == start && l.stop == stop) then continue
      let afterRules :=
        match (nodesOfKind [``Lean.Parser.Tactic.rwRuleSeq] stx)[0]?
                >>= (·.getRange? (canonicalOnly := true)) with
        | some rr => rr.stop.byteIdx
        | none    => r.start.byteIdx
      let locs := nodesOfKind [``Lean.Parser.Tactic.location] stx
      let some loc := locs.find? (fun l =>
          match l.getRange? (canonicalOnly := true) with
          | some lr => lr.start.byteIdx ≥ afterRules
          | none    => false)
        | continue
      let some lr := loc.getRange? (canonicalOnly := true) | continue
      out := out.push
        { start, stop, text := String.Pos.Raw.extract src lr.start lr.stop }
  return out

/-- The innermost of `items` whose HALF-OPEN `[start, stop)` span contains
`pos` — latest start wins. The one containment-and-tie rule every label
fix-up lookup shares (`withRwLocation`, `withTacticTail`). -/
def innermostContaining (items : Array α)
    (spanOf : α → Lsp.Position × Lsp.Position) (pos : Lsp.Position) :
    Option α := Id.run do
  let mut best : Option α := none
  for it in items do
    let (s, e) := spanOf it
    if posLE s pos && !posLE e pos then
      if best.all (fun b => posLE (spanOf b).1 s) then best := some it
  return best

/-- Put the clause back on a step's label.

Applied by BOTH wires to every step before anything downstream sees it, so the
label a node is drawn with, measured at, coloured through and edited against is
one string everywhere. Two guards keep it idempotent and narrow: only a label
in the exact shape `prettifySteps` re-synthesizes (`rw [...]`, which it emits
for `rewrite` too) is touched, and one that already carries the clause — a
tactic whose label the prettifier left alone — is returned unchanged.

Containment is HALF-OPEN, as everywhere else here. The step's start is the
rewrite RULE's position for a split step and the bare `]` for the synthetic
`rfl` that closes one, both of which sit inside the tactic — so every node of
one `rw` picks up the same clause, which is what makes them read as one tactic. -/
def withRwLocation (locs : Array RwLocation) (start : Lsp.Position)
    (label : String) : String :=
  if !label.startsWith "rw [" then label
  else match innermostContaining locs (fun l => (l.start, l.stop)) start with
    | none => label
    | some l => if label.endsWith l.text then label else label ++ " " ++ l.text

/-- The tactic-sequence kinds every slot walk here descends to. -/
def tacticSeqKinds : List Name :=
  [``Lean.Parser.Tactic.tacticSeq1Indented,
   ``Lean.Parser.Tactic.tacticSeqBracketed]

/-- A tactic sequence's direct children, as syntax — a direct child IS one
tactic as written. `sepBy1IndentSemicolon` interleaves elements with
separators, so the elements are the EVEN indices; the bracketed form holds
its sequence one slot in. THE one coding of that grammar-shape fact (exactly
what breaks on a toolchain bump), consumed by `tacticSlots` and
`collectTacticTails` — which must agree on it, or tails silently stop
landing in their slots. -/
def seqChildrenStx (seq : Syntax) : Array Syntax := Id.run do
  let inner :=
    if seq.getKind == ``Lean.Parser.Tactic.tacticSeqBracketed then seq[1]
    else seq[0]
  let args := inner.getArgs
  let mut out := #[]
  for i in [0:args.size] do
    if i % 2 == 0 then out := out.push args[i]!
  return out

/-- Every tactic-sequence child in the tree, in source order per block.

Descends SYNTAX for the same reason `calcBlocks` does — an unelaborated tactic
has no info node of its own but its syntax survives inside the enclosing one —
and takes the same roots (`extra` is the widget's `snap.stx`). Blocks are
deduped by range, since macro expansion surfaces the same sequence under
several `TacticInfo`s. -/
def tacticSlots (fileMap : FileMap) (tree : Elab.InfoTree)
    (extra : Option Syntax := none) : Array TacticSlot := Id.run do
  let src := fileMap.source
  let roots := tacticInfoRoots tree extra
  let mut blocks : Array (Lean.Syntax.Range × Array Lean.Syntax.Range) := #[]
  for root in roots do
    for seq in nodesOfKind tacticSeqKinds root do
      let some r := seq.getRange? (canonicalOnly := true) | continue
      if blocks.any fun (br, _) => br.start == r.start && br.stop == r.stop then
        continue
      -- A child with no canonical range (the parser's failed attempt) is
      -- dropped.
      let kids := (seqChildrenStx seq).filterMap
        (·.getRange? (canonicalOnly := true))
      unless kids.isEmpty do
        blocks := blocks.push (r, kids)
  let mut out : Array TacticSlot := #[]
  for (br, kids) in blocks do
    let blockStart := fileMap.utf8PosToLspPos br.start
    for i in [0:kids.size] do
      let kr := kids[i]!
      -- A canonical range's stop already excludes trailing trivia, but a
      -- structured tactic's does not always — tighten unconditionally, which
      -- is idempotent when there is nothing to trim.
      let tight := tightStop src kr.start kr.stop
      let start := fileMap.utf8PosToLspPos kr.start
      let stop := fileMap.utf8PosToLspPos tight
      let lineBeg := fileMap.lspPosToUtf8Pos ⟨start.line, 0⟩
      let lineStart :=
        (String.Pos.Raw.extract src lineBeg kr.start).all fun c =>
          c == ' ' || c == '\t'
      let le := lineEnd src tight
      -- The whole tail trims to nothing iff it is whitespace and comments.
      let tailIsTrivia :=
        (trimmedEnd (String.Pos.Raw.extract src tight le)).byteIdx == 0
      out := out.push {
        start, stop, blockStart, index := i, count := kids.size, lineStart
        tailIsTrivia
        tailStop := if tailIsTrivia then fileMap.utf8PosToLspPos le else stop
        prevSameLine := match kids[i-1]? with
          | some p => i > 0 && (fileMap.utf8PosToLspPos p.stop).line == start.line
          | none => false
      }
  return out

/-- The source lines a MULTI-LINE tactic's label lost, verbatim, with the
tactic's own slot range.

This exists to undo another loss in the vendored parser: Paperproof's
`prettifyTacticString` implements "strip the comments and blank lines after
the tactic" as literally *keep the first line* — so a step's `position` covers
the whole tactic while its LABEL is cut at the first newline. Single-line
nested `by` survives (`(by order)`), multi-line does not.

What the truncation dropped falls in TWO regions, on either side of the
material the tree draws for itself, and the rule needs both — the second was
missing for three weeks and is the shape this record now exists for:

```
rcases foo <| by          ← head
  grind                   ← nested block: its OWN node, not the label's
  with ⟨p, hp, hpdvd⟩     ← TRAILING: after the last nested block
```
```
have gap : ∀ m : ℕ,                 ← head
    (∑ i ∈ Finset.range (m+1), f i) ← CONTINUATION: before the first nested
      = … + f m := by               ←   block, i.e. still the STATEMENT
  intro m                           ← nested block: its own node
```

A `have`'s nested block runs to the slot's end, so the trailing region is
empty and a trailing-only rule restored NOTHING here: the box drew a binder
and a dangling comma. The continuation is not a tail and never could be
reached by widening one — it is the head line's own sentence, finished.

`head` is the prettifier's own output for this slot (first line, trimmed) —
the application guard: only a label that IS that truncation is extended, so
re-synthesized labels (`rw […]`) and split multi-rule steps are never
touched. -/
structure TacticTail where
  /-- The slot's tight span; a step of it starts inside `[start, stop)`. -/
  start : Lsp.Position
  stop  : Lsp.Position
  /-- What `prettifyTacticString` produces for this slot: first line, trimmed. -/
  head  : String
  /-- The lines the truncation dropped and the tree does not draw elsewhere:
  those before the first line any nested block or alternatives clause BEGINS
  on (VERBATIM — they are contiguous with the head, so the label stays a
  prefix of the source and every token aligns), plus those strictly after the
  last line any nested block touches (dedented by the slot's start column —
  a block was cut out above them, so no indent makes them align). In source
  order, joined with `\n`. With neither: everything after the first line,
  dedented, exactly as before. The two regions are one per-line test, so a
  tactic with no nested block cannot collect a line twice. -/
  tail  : String
  deriving Inhabited

/-- The alternatives clauses whose per-case markers the TREE draws, as case
badges, rather than the label — so they bound the label's continuation
exactly as a nested block does.

Measured, and the reason this list exists at all: with only `tacticSeqKinds`
as the boundary, an `induction`/`match` whose cases are written

```
induction n with
  | zero =>
    rfl
```

has its first nested block on the BODY line, two lines down, so "restore the
lines before the first nested block" pulls `| zero =>` into the label — a
marker the badge already carries, and the one thing the old trailing-only
rule's own doc promised would never happen. `inductionAlts` starts at the
`with` (measured: the head line) and `matchAlts` at the first marker, so
either way the boundary lands at or before the first marker and nothing of
the clause is restored. Decomposed by KIND, never by position, as everywhere
here. `first | tac | tac` needs no entry — its alternatives ARE tactic
sequences and each marker shares its body's line. -/
def altClauseKinds : List Name :=
  [``Lean.Parser.Tactic.inductionAlts, ``Lean.Parser.Term.matchAlts]

/-! A COMMENT written above a nested block's first tactic lands in the
continuation region, and is removed CLIENT-SIDE rather than here.

The tempting server-side fix — bound the continuation at the block's LEADING
TRIVIA instead of its first character — was built and MEASURED not to work:
on `proofs/commented.lean`'s `nested_narration`, Lean attributes that comment
to the PREVIOUS token's TRAILING trivia, so the block's leading trivia starts
at line 63 exactly like its canonical range, and the two cannot be told apart
from the block alone. Widening the boundary to include the trivia line then
restored the block's own first tactic (`rfl`) into the label, which is worse
than the comment.

`cleanLabel` (proofToTree.ts, both wires) already answers this: it scrubs
every comment's verbatim text out of a label and DROPS interior lines its
scrub emptied — a clause written by the same commit as the trailing rule, for
"a comment that occupied a whole INTERIOR line of a multi-line label". The
continuation region is verbatim, so the comment text matches byte for byte
and the line goes. Measured: the rendered label for that `have` is unchanged
by this whole change. -/

/-- Every multi-line tactic whose label truncation dropped real text.

Same syntax descent as `tacticSlots` (direct children of every tactic
sequence, over the same roots, deduped by range). TWO regions are restored
and the second is not a widening of the first (see `TacticTail`): the lines
BEFORE the first line any nested block or `altClauseKinds` clause begins on,
and the lines strictly AFTER the last line any nested block touches. One
per-line predicate computes both, so the no-nested-block case — where the
first region already covers everything — cannot restore a line twice.

That pair is what keeps existing labels right everywhere the truncation is
deliberate or harmless: `have h : P := by / tac / tac` on ONE statement line
(the block begins on the next line, so nothing is before it; it runs to the
slot's end, so nothing is after), `induction … with | zero => …` (the clause
bounds the front, the case bodies are the trailing blocks; markers stay out
of the label either way). `calc` is excluded by KIND — its first-line label
is deliberate, the chain's links are drawn by the tree itself. A multi-line
tactic with NO nested block (`exact ⟨a,` / `b⟩`) restores its whole
remainder, making label ≡ source.

Deliberately NOT a boundary: `conv`'s `convSeq` is not a `tacticSeq`, so a
multi-line `conv` restores its whole body into the label — pre-existing,
unchanged here, and left for whoever decides what a conv block should draw. -/
def collectTacticTails (fileMap : FileMap) (tree : Elab.InfoTree)
    (extra : Option Syntax := none) : Array TacticTail := Id.run do
  let src := fileMap.source
  let roots := tacticInfoRoots tree extra
  let mut seenSeqs : Array Lean.Syntax.Range := #[]
  let mut out : Array TacticTail := #[]
  for root in roots do
    for seq in nodesOfKind tacticSeqKinds root do
      -- Dedupe by the SEQUENCE's range first (`tacticSlots`' structure):
      -- `tacticInfoRoots` yields one root per TacticInfo, so each sequence
      -- is re-discovered once per ancestor tactic, and a per-child dedupe
      -- would re-scan every duplicate appearance's children.
      let some sr := seq.getRange? (canonicalOnly := true) | continue
      if seenSeqs.any (fun r => r.start == sr.start && r.stop == sr.stop) then
        continue
      seenSeqs := seenSeqs.push sr
      for child in seqChildrenStx seq do
        -- A `calc` restores NOTHING: every one of its links is drawn by the
        -- tree, so every line after the head is already on screen somewhere.
        -- That was once true only of links 2..n and of `by`-justified ones —
        -- a TERM-justified link spawned no goal and no step, so the label's
        -- first line was its only copy anywhere, and the restoration above
        -- was extended to cover it. `ProofTreeRecover.recoverCalcLinks` now
        -- gives that link its own goal box and node from the elaborator's own
        -- `expectedType?`, which is strictly more (the relation is drawn, the
        -- justification aligns as an identity, the node is hoverable), so the
        -- exclusion's premise holds again for every link and the restoration
        -- would now draw the same text twice. ONE mechanism, and this is not
        -- it.
        if child.getKind == ``Lean.calcTactic then continue
        let some kr := child.getRange? (canonicalOnly := true) | continue
        let tight := tightStop src kr.start kr.stop
        let text := String.Pos.Raw.extract src kr.start tight
        unless text.contains '\n' do continue
        let start := fileMap.utf8PosToLspPos kr.start
        let stop := fileMap.utf8PosToLspPos tight
        -- The last document line any nested block touches (tightened the same
        -- way, or a block's trailing trivia would swallow a tail line) and the
        -- FIRST line the tree's own material begins on — a nested block or an
        -- alternatives clause. `none` means the tactic has neither, so every
        -- line after the head is the label's.
        let mut lastBlockLine := start.line
        let mut drawnFrom : Option Nat := none
        for blk in nodesOfKind tacticSeqKinds child do
          let some br := blk.getRange? (canonicalOnly := true) | continue
          let bLine := (fileMap.utf8PosToLspPos (tightStop src br.start br.stop)).line
          if bLine > lastBlockLine then lastBlockLine := bLine
          drawnFrom := minLine drawnFrom (fileMap.utf8PosToLspPos br.start).line
        for alts in nodesOfKind altClauseKinds child do
          let some ar := alts.getRange? (canonicalOnly := true) | continue
          drawnFrom := minLine drawnFrom (fileMap.utf8PosToLspPos ar.start).line
        let lines := (text.splitOn "\n").toArray
        let head := (lines[0]?.getD text).trimAscii.toString
        -- One predicate over the lines AFTER the head (`j` from 1): a line is
        -- the label's if it comes before everything the tree draws, or after
        -- the last of it. The two regions can both be non-empty and can
        -- coincide (no nested block), which is why this is a per-line test
        -- and not two appended slices.
        let mut tailLines : Array String := #[]
        for j in [1:lines.size] do
          let line := start.line + j
          if line > lastBlockLine then
            -- TRAILING region — tested first, so a tactic with no nested block
            -- at all (where both tests pass) keeps the dedent it has always
            -- had. A block was cut out above such a line, so the label can
            -- never be a prefix of the source here whatever we do with the
            -- indent, and dedenting reads better in the box.
            tailLines := tailLines.push (dedent start.character lines[j]!)
          else if drawnFrom.all (line < ·) then
            -- CONTINUATION region — VERBATIM, deliberately not dedented, and
            -- this is the one place the two differ. These lines are CONTIGUOUS
            -- with the head in the source, so leaving them alone makes the
            -- label a literal PREFIX of the slot text — `alignInLabel`'s first
            -- and best case. Measured on the reported `have gap`: verbatim
            -- aligns 133/133 label characters, dedented 24/129 (the head line
            -- and four spaces), i.e. dedenting restores the statement and then
            -- draws it with no syntax colour and no per-token hover popups.
            -- The cost is that the continuation keeps the tactic's own start
            -- column, reading as a hanging indent under the trimmed head.
            tailLines := tailLines.push lines[j]!
        let tail := "\n".intercalate tailLines.toList
        unless tail.trimAscii.toString.isEmpty do
          out := out.push { start, stop, head, tail }
  return out
where
  /-- The earlier of a running boundary and a candidate line; `none` is "no
  boundary seen yet", never line 0. -/
  minLine (cur : Option Nat) (l : Nat) : Option Nat :=
    some (match cur with | none => l | some c => min c l)
  /-- Drop up to `col` leading spaces, so a restored line's indent reads
  relative to the tactic rather than to the file's left margin. -/
  dedent (col : Nat) (l : String) : String := Id.run do
    let mut drop := 0
    for c in l.toList do
      if drop < col && c == ' ' then drop := drop + 1 else break
    return (l.drop drop).toString

/-- Put a truncated multi-line label's tail back.

Applied by BOTH wires to every step right after `withRwLocation`, before
anything downstream reads a label. The guard is exact: only a label equal to
the slot's own first-line truncation (`TacticTail.head`) is extended — which
excludes re-synthesized `rw` labels, the split steps of a multi-rule `rw`,
the synthetic closing `rfl`, and anything already complete. Containment is
HALF-OPEN, innermost slot wins, as everywhere else here. -/
def withTacticTail (tails : Array TacticTail) (start : Lsp.Position)
    (label : String) : String :=
  match innermostContaining tails (fun t => (t.start, t.stop)) start with
  | none => label
  | some t =>
    -- The equality guard alone already guarantees idempotence (an extended
    -- label no longer equals `head`); the `endsWith` mirrors
    -- `withRwLocation`'s shape as pure defense, and can only DECLINE the
    -- pathological coincidence of a first line literally ending with its own
    -- tail — conservative by choice.
    if label == t.head && !label.endsWith t.tail then
      label ++ "\n" ++ t.tail
    else label

/-- BOTH label fix-up passes' collected inputs, gathered once per payload.

A STRUCTURE rather than the composed applier this used to return, and the
reason is a compilation fact rather than a taste: a `def` whose result type is
a function is eta-expanded to the full arity, so `labelFixup fileMap tree extra`
was not a closure over two computed arrays — it was a partial application of a
five-argument function, and BOTH collectors (two whole-info-tree syntax
descents) re-ran on EVERY step the caller mapped it over. Measured on a live
Mathlib proof: 38 steps × ~24ms = 904ms of a 1382ms cache miss, the same shape
at every size (17 steps → 156ms, 8 → 25ms). A constructor application is
strict, so building this record runs each collector exactly once, and
`apply` below is two array lookups. -/
structure LabelFixup where
  rwLocs   : Array RwLocation
  tacTails : Array TacticTail

/-- BOTH label fix-up passes, collected in their required order. The ONE entry
the two wires call (`Ppharness` and `getProofTree`), which is what keeps the
pipeline and its order from diverging between them as fix-ups accrete. Callers
collect once and map `apply` over every step. -/
def labelFixup (fileMap : FileMap) (tree : Elab.InfoTree)
    (extra : Option Syntax := none) : LabelFixup :=
  { rwLocs   := collectRwLocations fileMap tree (extra := extra)
    tacTails := collectTacticTails fileMap tree (extra := extra) }

/-- Apply both passes to one label, rw clause first then the multi-line tail,
so each guard sees the label state it was written against. -/
def LabelFixup.apply (f : LabelFixup) (start : Lsp.Position) (label : String) :
    String :=
  withTacticTail f.tacTails start (withRwLocation f.rwLocs start label)

/-- A hole the AUTHOR wrote — a `?_` or a named `?foo` — with the goal it
stands for and enough of what encloses it to edit it in place.

A hole is the work-in-progress state of an expression rather than of a tactic
block: the surrounding term is already written and something is missing from
the middle of it, so the honest edit REPLACES the hole where it sits instead of
appending a line somewhere after. That is true of `refine ⟨?_, ?_⟩` exactly as
it is of a `calc` link, which is why this is not calc-specific — though `calc`
is the case that forced it, being the one construct that cannot simply be left
short (the chain must reach the goal's RHS).

The pairing is EXACT, not positional: a hole elaborates to a metavariable whose
id is the very `GoalInfo.id` the wire carries, so `goalId` joins the two with
no assumption about the order holes or links are reported in.

Note the tree's OWN gestures never write a hole — a hole is an unsolved goal,
i.e. an error, where the generated `by sorry` is a warning and a complete term
(see `calcEdit`'s STUB). This structure is entirely about holes it finds. -/
structure Hole where
  /-- The hole's metavariable = `GoalInfo.id` on the wire. -/
  goalId : String
  /-- The hole token itself (`?_`, `?foo`): replacing exactly this fills it in
  place. Filling one hole shifts a later one on the SAME line, which cannot
  bite — every commit re-elaborates and the tree redraws from a fresh wire
  before a second fill is possible. -/
  start : Lsp.Position
  stop  : Lsp.Position
  /-- Start of what encloses the hole: the calc step (`_ = c := ?_`) when
  `inCalc`, else the enclosing `TacticSlot`. Its line is where a new calc link
  is inserted and its character is the column to indent to. -/
  ownerStart : Lsp.Position
  /-- `inCalc` only: the enclosing step is the chain's FIRST link
  (`calcFirstStep`). Nothing can be inserted above one — its LHS is the chain's
  real head rather than a `_` that would absorb a new predecessor's RHS. -/
  first : Bool
  /-- The hole sits inside a `calc` link. Only then is growing a link ABOVE it
  meaningful — the hole's goal restates from the new RHS. -/
  inCalc : Bool
  /-- The hole sits inside a tactic BLOCK, so its goal could equally be proved
  by a sibling tactic written after the enclosing one.

  This is what decides whether filling in place is the right offer. Where a
  sibling CAN be written it is the better edit and the tree should keep making
  it: `refine ⟨?_, ?_⟩` followed by `· exact h` is what one writes by hand,
  where filling in place gives `refine ⟨by exact h, ?_⟩` — legal, and worse
  style. Where no sibling can be written the question does not arise, and those
  are exactly the two cases in-place editing exists for: a `calc` link, which
  must reach the goal's RHS and so cannot be appended to, and a hole in a
  TERM-mode proof, which has no tactic block to append to at all. -/
  inBlock : Bool
  /-- A NAMED hole may be written more than once — `?foo` reuses the mvar it
  already introduced, so every occurrence shares one `goalId` and one goal.
  All but the source-earliest are marked here, because a client keying holes by
  goal would otherwise silently keep whichever came last, and the fill belongs
  at the first. -/
  dup : Bool := false
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

/-- One well-formed link of a `calc` block, as SYNTAX.

The range alone was what this used to be, and it is not enough for the one
question a link's own node answers: WHAT PROVES IT. A link justified by a
`by` block is drawn by the tree already (goal box + tactic node under it); a
link justified by a TERM spawns neither, so its justification has to be found
and given a node of its own (`ProofTreeRecover.recoverCalcLinks`). Both halves
are syntax facts — the justification is the `:=`'s right-hand argument — so
they are recorded here rather than re-derived by a second descent that could
disagree about which node is which link's. -/
structure CalcLink where
  /-- The `calcFirstStep`/`calcStep` node itself. -/
  stx : Syntax
  range : Lean.Syntax.Range
  /-- This is the block's `calcFirstStep` (the one link that names its LHS). -/
  isFirst : Bool
  /-- The justification term (`:= proof`). `none` only for a bare first step,
  whose justification is optional — see `CalcChain.firstBare`. -/
  just? : Option Syntax

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
  links : Array CalcLink
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
  let roots := tacticInfoRoots tree extra
  let mut out := #[]
  for root in roots do
    for stx in nodesOfKind [``Lean.calcTactic] root do
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
            (fun a b => a.range.start.byteIdx < b.range.start.byteIdx)
          |>.filter fun l =>
            let lp := fileMap.utf8PosToLspPos l.range.start
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
  /-- The block's `calcFirstStep` node, if it read one at all. -/
  firstStep (stx : Syntax) : Option Syntax :=
    match stx with
    | .node _ k args =>
      if k == ``Lean.calcFirstStep then some stx
      else args.foldl (fun acc a => acc <|> firstStep a) none
    | _ => none
  /-- The `calcFirstStep`/`calcStep` nodes under `stx`, with their ranges and
  their justifications. Recursive over raw syntax: a link is not an info node
  of its own.

  The justification is found by KIND, never by index — the standing rule. Both
  grammars end in the proof term, but they get there differently:
  `calcFirstStep := ppIndent(colGe term (" := " term)?)` wraps `:=` and the
  proof in an OPTIONAL group (which is empty for a bare first step, exactly
  what `firstBare` tests), while `calcStep := ppIndent(colGe term " := " term)`
  has them flat. Taking "the last argument that is a term" over the flattened
  children is one rule for both and cannot be broken by a grammar that grows a
  config node the way `have`'s did. -/
  calcSteps (stx : Syntax) : Array CalcLink := Id.run do
    let mut out := #[]
    match stx with
    | .node _ k args =>
      if k == ``Lean.calcFirstStep || k == ``Lean.calcStep then
        -- A link the parser only half-read is not a link; see `CalcBlock`.
        if !stx.hasMissing then
          if let some r := stx.getRange? (canonicalOnly := true) then
            out := out.push {
              stx, range := r
              isFirst := k == ``Lean.calcFirstStep
              just? := justOf stx }
      for a in args do out := out ++ calcSteps a
    | _ => pure ()
    return out
  /-- The link's proof term: the argument after the `:=` atom, looking through
  the first step's optional group. `none` when the link is bare. -/
  justOf (link : Syntax) : Option Syntax := Id.run do
    -- Flatten one level of optional/group wrapping: a null node holding the
    -- `:= proof` pair is the first step's shape.
    let args := link.getArgs.flatMap fun a =>
      if a.getKind == nullKind then a.getArgs else #[a]
    let mut seen := false
    let mut out := none
    for a in args do
      if seen then out := some a
      if a.isOfKind `«:=» || (a.isAtom && a.getAtomVal == ":=") then seen := true
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
        | some l => (fileMap.utf8PosToLspPos l.range.start).character
        | none => start.character + 2
      -- The reportable span (see `CalcChain.stop`): through the last
      -- well-formed link, or to the end of the `calc`'s own line when the
      -- block has none — never the block's range, which when broken runs on
      -- into the tactic the parser swallowed.
      let stopPos := match b.links.back? with
        | some l => l.range.stop
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

/-- Every hole the author wrote, paired with the goal it stands for.

Two independent walks, because neither half knows the other's coordinates. The
info tree gives goal → hole SPAN (a `Term.syntheticHole` whose elaborated `expr`
is the metavariable); the SYNTAX gives the link structure, which no info node
records. Note the calc `_` placeholder is a `Term.hole`, not a syntheticHole,
so filtering on the kind excludes it — it is not a goal either. `?_` and a
named `?foo` ARE the same kind, so both are collected by the one test.

Every hole is reported, whether or not a `calc` link contains it — it used to
be only the calc ones, which left the client unable to say anything at all
about a `refine` hole. What the client does with each is decided by `inCalc`
and `inBlock` rather than by what is reported: a hole with a tactic block
around it keeps the bullet insertion that was always right for it, and only
the ones that cannot take a sibling are filled in place. -/
def collectHoles (fileMap : FileMap) (tree : Elab.InfoTree)
    (slots : Array TacticSlot) (extra : Option Syntax := none) :
    Array Hole := Id.run do
    let links := (calcBlocks fileMap tree extra).flatMap (·.links)

    let mut out : Array Hole := #[]
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
      let start := fileMap.utf8PosToLspPos r.start
      let stop := fileMap.utf8PosToLspPos r.stop
      -- The SMALLEST containing link, so a nested calc's links can't claim a
      -- hole belonging to an inner one.
      let mut best : Option CalcLink := none
      for l in links do
        let lr := l.range
        if lr.start ≤ r.start && r.stop ≤ lr.stop then
          match best with
          | some b =>
            if lr.stop.byteIdx - lr.start.byteIdx
                < b.range.stop.byteIdx - b.range.start.byteIdx then
              best := some l
          | none => best := some l
      match best with
      | some l =>
        out := out.push {
          goalId, start, stop
          ownerStart := fileMap.utf8PosToLspPos l.range.start
          first := l.isFirst
          inCalc := true
          -- A calc link is inside the calc TACTIC, but a link is not a slot
          -- and nothing may be appended between links; it is exactly the case
          -- in-place filling was built for.
          inBlock := false
        }
      | none =>
        -- Outside any chain the owner is the enclosing tactic AS WRITTEN, so
        -- the column reported is the tactic's own — the same fact `TacticSlot`
        -- exists to carry, rather than a second walk that would answer it
        -- differently. Innermost wins, for the same reason as links. A hole in
        -- a TERM-mode proof is inside no slot at all; it owns itself, which
        -- costs nothing because filling a hole replaces a range and inserts no
        -- line.
        let mut owner : Option TacticSlot := none
        for sl in slots do
          if posLE sl.start start && posLE stop sl.stop then
            if owner.all (fun b => posLE b.start sl.start) then owner := some sl
        out := out.push {
          goalId, start, stop
          ownerStart := (owner.map (·.start)).getD start
          first := false
          inCalc := false
          inBlock := owner.isSome
        }
    -- One goal, several source spans: a named `?foo` written twice. Keep the
    -- source-earliest unmarked and flag the rest, so a goal-keyed client can
    -- take the first without knowing the reporting order.
    let mut seen : Std.HashSet String := {}
    let sorted := out.qsort fun a b => !posLE b.start a.start
    let mut marked : Array Hole := #[]
    for h in sorted do
      if seen.contains h.goalId then
        marked := marked.push { h with dup := true }
      else
        seen := seen.insert h.goalId
        marked := marked.push h
    return marked

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

/-- `goalContexts` for the callers that only need SOME goal's context (the
environment is per-file, not per-goal — `tacticNames`, `completionNames`).
Both used to build the full map and read one arbitrary entry; this early-exits
at the first `TacticInfo` mentioning a goal, with the same `mctxAfter` context
the map would have carried for it. -/
partial def anyGoalContext (tree : Elab.InfoTree)
    (ctx? : Option Elab.ContextInfo := none) :
    Option (Elab.ContextInfo × MVarId) :=
  match tree with
  | .context c t => anyGoalContext t (c.mergeIntoOuter? ctx?)
  | .node i cs => Id.run do
    if let some ctx := ctx? then
      if let .ofTacticInfo ti := i then
        if let some mvarId := (ti.goalsBefore ++ ti.goalsAfter).head? then
          return some ({ ctx with mctx := ti.mctxAfter }, mvarId)
    for c in cs do
      if let some r := anyGoalContext c (i.updateContext? ctx?) then
        return some r
    return none
  | .hole _ => none

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
        (← Lean.mkArrow α (← Lean.mkArrow α (mkSort Level.zero)))
      let s ← Lean.Meta.mkFreshExprMVar
        (← Lean.mkArrow α (← Lean.mkArrow γ (mkSort Level.zero)))
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
  test would hand the chain that tactic's own goal instead;
* plus `extra` — the root of an OPEN block (`:= by` with nothing written into
  it, see `Recover.recoverOpenBlock`). It is pending for the same reason the
  first bullet's goals are, and only reaches this rule separately because it is
  reached through no step at all. The client's `pending` carries the mirror
  clause; keep the two pointing at each other. -/
def calcRelationGoals (steps : Array CalcGoalStep) (chains : Array CalcChain)
    (extra : Array String := #[]) : Array String := Id.run do
  let consumed := steps.foldl (init := ({} : Std.HashSet String))
    fun acc s => acc.insert s.goalBefore
  let lt (a b : Lsp.Position) : Bool := !posLE b a
  let le := posLE
  let mut out : Array String := extra
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
