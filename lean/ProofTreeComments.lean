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

end ProofTree
