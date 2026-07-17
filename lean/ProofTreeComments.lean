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

/-- Lex `src` between `startPos` and `stopPos`, collecting every comment.
Line comments end at the newline (exclusive); block comments nest. String and
char literals are skipped so their contents can't fake a comment opener. -/
partial def extractComments (src : String) (fileMap : FileMap)
    (startPos stopPos : String.Pos.Raw) : Array SourceComment := Id.run do
  let atEnd := (String.Pos.Raw.atEnd src)
  let next  := (String.Pos.Raw.next src)
  let getc  := (String.Pos.Raw.get src)
  let get! (p : String.Pos.Raw) : Char := if atEnd p then ' ' else getc p
  let mut out : Array SourceComment := #[]
  let mut p := startPos
  let mut prev : Char := ' '
  while p < stopPos && !atEnd p do
    let c := getc p
    if c == '-' && get! (next p) == '-' then
      -- `--` line comment: to end of line.
      let b := p
      while !atEnd p && getc p != '\n' do
        p := next p
      out := out.push (mkComment src fileMap b p)
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
      out := out.push (mkComment src fileMap b p)
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
