import Lean

open Lean

namespace ProofTree

structure SourceComment where
  text  : String
  start : Lsp.Position
  stop  : Lsp.Position
  deriving ToJson, FromJson

private def isIdentish (c : Char) : Bool :=
  c.isAlphanum || c == '_' || c == '\''

private def mkComment (src : String) (fileMap : FileMap) (b e : String.Pos.Raw) :
    SourceComment :=
  { text  := String.Pos.Raw.extract src b e
    start := fileMap.utf8PosToLspPos b
    stop  := fileMap.utf8PosToLspPos e }

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

      let b := p
      while !atEnd p && getc p != '\n' do
        p := next p
      out := out.push (b, p)
      prev := '\n'
    else if c == '/' && get! (next p) == '-' then

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

      p := next p
      while !atEnd p && getc p != '"' do
        p := if getc p == '\\' then next (next p) else next p
      p := next p
      prev := '"'
    else if c == '\'' && !isIdentish prev then

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

def extractComments (src : String) (fileMap : FileMap)
    (startPos stopPos : String.Pos.Raw) : Array SourceComment :=
  commentSpans src startPos stopPos |>.map fun (b, e) =>
    mkComment src fileMap b e

structure TacticToken where
  start : Lsp.Position
  stop  : Lsp.Position
  type  : String
  deriving ToJson, FromJson

structure LabelToken where
  labelAt : Nat
  text    : String
  type    : String
  doc     : String
  deriving ToJson, FromJson

structure TacticEdit where

  stepStart : Lsp.Position
  start : Lsp.Position
  stop  : Lsp.Position
  text  : String

  tokens : Array TacticToken := #[]

  labelTokens : Array LabelToken := #[]

  tacticIndent : Nat := 0
  deriving ToJson, FromJson

def tacticIndentAt (fileMap : FileMap) (line : Nat) : Nat := Id.run do
  let src := fileMap.source
  let isSpace (c : Char) := c == ' ' || c == '\t'
  let mut p := fileMap.lspPosToUtf8Pos ⟨line, 0⟩
  while !String.Pos.Raw.atEnd src p && isSpace (String.Pos.Raw.get src p) do
    p := String.Pos.Raw.next src p

  if !String.Pos.Raw.atEnd src p then
    let c := String.Pos.Raw.get src p
    if c == '·' || c == '.' then
      let q := String.Pos.Raw.next src p
      if !String.Pos.Raw.atEnd src q && isSpace (String.Pos.Raw.get src q) then
        p := q
        while !String.Pos.Raw.atEnd src p && isSpace (String.Pos.Raw.get src p) do
          p := String.Pos.Raw.next src p
  return (fileMap.utf8PosToLspPos p).character

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

    match spans.find? (fun (_, stop) => stop.byteIdx == e) with
    | some (b, _) => e := b.byteIdx
    | none => go := false

  return ⟨e⟩

def tightStop (src : String) (start stop : String.Pos.Raw) : String.Pos.Raw :=
  ⟨start.byteIdx + (trimmedEnd (String.Pos.Raw.extract src start stop)).byteIdx⟩

def lineEnd (src : String) (p : String.Pos.Raw) : String.Pos.Raw := Id.run do
  let mut q := p
  while !String.Pos.Raw.atEnd src q && String.Pos.Raw.get src q != '\n' do
    q := String.Pos.Raw.next src q
  return q

def commentsInRange (src : String) (fileMap : FileMap) (range : Lean.Syntax.Range) :
    Array SourceComment :=
  extractComments src fileMap range.start (lineEnd src range.stop)

def commandRange (tree : Elab.InfoTree) : Option Lean.Syntax.Range :=
  tree.foldInfo (init := none) fun _ info acc =>
    match info.stx.getRange? with
    | some r =>
      match acc with
      | some a => some ⟨min a.start r.start, max a.stop r.stop⟩
      | none   => some r
    | none => acc

def posLE (a b : Lsp.Position) : Bool := (compare a b).isLE

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

def tacticInfoRoots (tree : Elab.InfoTree) (extra : Option Syntax := none) :
    Array Syntax :=
  tree.foldInfo (init := extra.toArray) fun _ info acc =>
    match info with
    | .ofTacticInfo ti => acc.push ti.stx
    | _ => acc

def nodesOfKind (kinds : List SyntaxNodeKind) (stx : Syntax) : Array Syntax :=
  Id.run do
    let mut out := #[]
    match stx with
    | .node _ k args =>
      if kinds.contains k then out := out.push stx
      for a in args do out := out ++ nodesOfKind kinds a
    | _ => pure ()
    return out

structure TacticSlot where

  start : Lsp.Position
  stop  : Lsp.Position

  blockStart : Lsp.Position

  index : Nat
  count : Nat

  lineStart : Bool

  tailIsTrivia : Bool

  tailStop : Lsp.Position

  prevSameLine : Bool
  deriving ToJson, FromJson, Inhabited

structure RwLocation where

  start : Lsp.Position
  stop  : Lsp.Position

  text  : String
  deriving ToJson, Inhabited

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

def innermostContaining (items : Array α)
    (spanOf : α → Lsp.Position × Lsp.Position) (pos : Lsp.Position) :
    Option α := Id.run do
  let mut best : Option α := none
  for it in items do
    let (s, e) := spanOf it
    if posLE s pos && !posLE e pos then
      if best.all (fun b => posLE (spanOf b).1 s) then best := some it
  return best

def withRwLocation (locs : Array RwLocation) (start : Lsp.Position)
    (label : String) : String :=
  if !label.startsWith "rw [" then label
  else match innermostContaining locs (fun l => (l.start, l.stop)) start with
    | none => label
    | some l => if label.endsWith l.text then label else label ++ " " ++ l.text

def tacticSeqKinds : List Name :=
  [``Lean.Parser.Tactic.tacticSeq1Indented,
   ``Lean.Parser.Tactic.tacticSeqBracketed]

def seqChildrenStx (seq : Syntax) : Array Syntax := Id.run do
  let inner :=
    if seq.getKind == ``Lean.Parser.Tactic.tacticSeqBracketed then seq[1]
    else seq[0]
  let args := inner.getArgs
  let mut out := #[]
  for i in [0:args.size] do
    if i % 2 == 0 then out := out.push args[i]!
  return out

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

      let kids := (seqChildrenStx seq).filterMap
        (·.getRange? (canonicalOnly := true))
      unless kids.isEmpty do
        blocks := blocks.push (r, kids)
  let mut out : Array TacticSlot := #[]
  for (br, kids) in blocks do
    let blockStart := fileMap.utf8PosToLspPos br.start
    for i in [0:kids.size] do
      let kr := kids[i]!

      let tight := tightStop src kr.start kr.stop
      let start := fileMap.utf8PosToLspPos kr.start
      let stop := fileMap.utf8PosToLspPos tight
      let lineBeg := fileMap.lspPosToUtf8Pos ⟨start.line, 0⟩
      let lineStart :=
        (String.Pos.Raw.extract src lineBeg kr.start).all fun c =>
          c == ' ' || c == '\t'
      let le := lineEnd src tight

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

structure TacticTail where

  start : Lsp.Position
  stop  : Lsp.Position

  head  : String

  tail  : String
  deriving Inhabited

def altClauseKinds : List Name :=
  [``Lean.Parser.Tactic.inductionAlts, ``Lean.Parser.Term.matchAlts]

def collectTacticTails (fileMap : FileMap) (tree : Elab.InfoTree)
    (extra : Option Syntax := none) : Array TacticTail := Id.run do
  let src := fileMap.source
  let roots := tacticInfoRoots tree extra
  let mut seenSeqs : Array Lean.Syntax.Range := #[]
  let mut out : Array TacticTail := #[]
  for root in roots do
    for seq in nodesOfKind tacticSeqKinds root do

      let some sr := seq.getRange? (canonicalOnly := true) | continue
      if seenSeqs.any (fun r => r.start == sr.start && r.stop == sr.stop) then
        continue
      seenSeqs := seenSeqs.push sr
      for child in seqChildrenStx seq do

        if child.getKind == ``Lean.calcTactic then continue
        let some kr := child.getRange? (canonicalOnly := true) | continue
        let tight := tightStop src kr.start kr.stop
        let text := String.Pos.Raw.extract src kr.start tight
        unless text.contains '\n' do continue
        let start := fileMap.utf8PosToLspPos kr.start
        let stop := fileMap.utf8PosToLspPos tight

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

        let mut tailLines : Array String := #[]
        for j in [1:lines.size] do
          let line := start.line + j
          if line > lastBlockLine then

            tailLines := tailLines.push (dedent start.character lines[j]!)
          else if drawnFrom.all (line < ·) then

            tailLines := tailLines.push lines[j]!
        let tail := "\n".intercalate tailLines.toList
        unless tail.trimAscii.toString.isEmpty do
          out := out.push { start, stop, head, tail }
  return out
where

  minLine (cur : Option Nat) (l : Nat) : Option Nat :=
    some (match cur with | none => l | some c => min c l)

  dedent (col : Nat) (l : String) : String := Id.run do
    let mut drop := 0
    for c in l.toList do
      if drop < col && c == ' ' then drop := drop + 1 else break
    return (l.drop drop).toString

def withTacticTail (tails : Array TacticTail) (start : Lsp.Position)
    (label : String) : String :=
  match innermostContaining tails (fun t => (t.start, t.stop)) start with
  | none => label
  | some t =>

    if label == t.head && !label.endsWith t.tail then
      label ++ "\n" ++ t.tail
    else label

structure LabelFixup where
  rwLocs   : Array RwLocation
  tacTails : Array TacticTail

def labelFixup (fileMap : FileMap) (tree : Elab.InfoTree)
    (extra : Option Syntax := none) : LabelFixup :=
  { rwLocs   := collectRwLocations fileMap tree (extra := extra)
    tacTails := collectTacticTails fileMap tree (extra := extra) }

def LabelFixup.apply (f : LabelFixup) (start : Lsp.Position) (label : String) :
    String :=
  withTacticTail f.tacTails start (withRwLocation f.rwLocs start label)

structure Hole where

  goalId : String

  start : Lsp.Position
  stop  : Lsp.Position

  ownerStart : Lsp.Position

  first : Bool

  inCalc : Bool

  inBlock : Bool

  dup : Bool := false
  deriving ToJson, FromJson

structure CalcChain where

  tacticStart : Lsp.Position

  lastLink : Lsp.Position

  indent : Nat

  broken : Bool

  links : Nat := 0

  stop : Lsp.Position

  text : String

  firstBare : Bool := false
  deriving ToJson, FromJson

structure CalcLink where

  stx : Syntax
  range : Lean.Syntax.Range

  isFirst : Bool

  just? : Option Syntax

structure CalcBlock where
  range : Lean.Syntax.Range
  links : Array CalcLink
  broken : Bool

  firstBare : Bool := false

def calcBlocks (fileMap : FileMap) (tree : Elab.InfoTree)
    (extra : Option Syntax := none) : Array CalcBlock := Id.run do
  let roots := tacticInfoRoots tree extra
  let mut out := #[]
  for root in roots do
    for stx in nodesOfKind [``Lean.calcTactic] root do
      let some r := stx.getRange? (canonicalOnly := true) | continue
      unless out.any (fun b => b.range.start == r.start && b.range.stop == r.stop) do
        let cp := fileMap.utf8PosToLspPos r.start

        let links := (calcSteps stx).qsort
            (fun a b => a.range.start.byteIdx < b.range.start.byteIdx)
          |>.filter fun l =>
            let lp := fileMap.utf8PosToLspPos l.range.start
            lp.line == cp.line || lp.character > cp.character

        let firstBare := match firstStep stx with
          | some fs => fs.getNumArgs > 1 && fs[1]!.getNumArgs == 0
          | none => false
        out := out.push {
          range := r, links := links, firstBare

          broken := stx.hasMissing || links.isEmpty
        }
  return out
where

  firstStep (stx : Syntax) : Option Syntax :=
    match stx with
    | .node _ k args =>
      if k == ``Lean.calcFirstStep then some stx
      else args.foldl (fun acc a => acc <|> firstStep a) none
    | _ => none

  calcSteps (stx : Syntax) : Array CalcLink := Id.run do
    let mut out := #[]
    match stx with
    | .node _ k args =>
      if k == ``Lean.calcFirstStep || k == ``Lean.calcStep then

        if !stx.hasMissing then
          if let some r := stx.getRange? (canonicalOnly := true) then
            out := out.push {
              stx, range := r
              isFirst := k == ``Lean.calcFirstStep
              just? := justOf stx }
      for a in args do out := out ++ calcSteps a
    | _ => pure ()
    return out

  justOf (link : Syntax) : Option Syntax := Id.run do

    let args := link.getArgs.flatMap fun a =>
      if a.getKind == nullKind then a.getArgs else #[a]
    let mut seen := false
    let mut out := none
    for a in args do
      if seen then out := some a
      if a.isOfKind `«:=» || (a.isAtom && a.getAtomVal == ":=") then seen := true
    return out

def collectCalcChains (fileMap : FileMap) (tree : Elab.InfoTree)
    (extra : Option Syntax := none) : Array CalcChain := Id.run do
    let src := fileMap.source
    let mut out : Array CalcChain := #[]
    for b in calcBlocks fileMap tree extra do
      let start := fileMap.utf8PosToLspPos b.range.start
      let indent := match b.links[1]? with
        | some l => (fileMap.utf8PosToLspPos l.range.start).character
        | none => start.character + 2

      let stopPos := match b.links.back? with
        | some l => l.range.stop
        | none => Id.run do
          let mut p := b.range.start
          while !String.Pos.Raw.atEnd src p && String.Pos.Raw.get src p != '\n' do
            p := String.Pos.Raw.next src p
          return p
      out := out.push {
        tacticStart := start

        lastLink := fileMap.utf8PosToLspPos stopPos
        indent := indent
        broken := b.broken
        links := b.links.size
        stop := fileMap.utf8PosToLspPos stopPos
        text := String.Pos.Raw.extract src b.range.start stopPos
        firstBare := b.firstBare
      }
    return out

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

          inBlock := false
        }
      | none =>

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

structure CalcRelOption where
  rel  : String
  next : String
  same : Bool
  deriving ToJson, FromJson

structure CalcRelations where
  goalId  : String

  rel     : String
  options : Array CalcRelOption
  deriving ToJson, FromJson

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

private def relSymbol (r : Expr) : Lean.MetaM (Option String) := do
  Lean.Meta.forallBoundedTelescope (← Lean.Meta.inferType r) (some 2) fun xs _ => do
    unless xs.size == 2 do return none
    let a ← Lean.Meta.inferType xs[0]!
    let b ← Lean.Meta.inferType xs[1]!
    Lean.Meta.withLocalDeclD `x a fun x => Lean.Meta.withLocalDeclD `y b fun y => do

      let s := toString (← Lean.Meta.ppExpr (mkAppN r #[x, y]).headBeta)
      let parts := s.splitOn " "
      return if parts.length == 3 then some parts[1]! else none

def calcRelationsFor (ctx : Elab.ContextInfo) (goalId : String) (mvarId : MVarId)
    (cap : Nat := 6) : IO CalcRelations := do
  let none? : CalcRelations := { goalId, rel := "", options := #[] }
  try

    ctx.runMetaM {} <| mvarId.withContext do

      let goalTy := (← Lean.instantiateMVars (← mvarId.getType)).consumeMData
      let some (t, a, b) ← Lean.Elab.Term.getCalcRelation? goalTy | return none?
      let some tsym ← relSymbol t | return none?
      let α ← Lean.Meta.inferType a
      let γ ← Lean.Meta.inferType b

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

          if r'.hasExprMVar || s'.hasExprMVar then return none
          let some rs ← relSymbol r' | return none
          let some ss ← relSymbol s' | return none

          match ← Lean.Meta.trySynthInstance (← Lean.Meta.mkAppM ``Trans #[r', s', t]) with
          | .some _ => return some (rs, ss)
          | _       => return none
        if let some p := got then pairs := pairs.push p
      unless pairs.any (fun p => p.1 == tsym && p.2 == tsym) do
        return { goalId, rel := tsym, options := #[] }

      let mut opts : Array CalcRelOption := #[]
      for (rel, _) in pairs do
        unless opts.any (·.rel == rel) do
          let cands := pairs.filter (·.1 == rel)
          let next := ((cands.find? (·.2 == tsym)).getD cands[0]!).2
          opts := opts.push { rel, next, same := rel == tsym && next == tsym }
      let ordered := (opts.filter (·.same)) ++ (opts.filter (!·.same))
      return { goalId, rel := tsym, options := ordered.take cap }
  catch _ => return none?

structure CalcGoalStep where
  goalBefore : String
  goalsAfter : Array String
  start      : Lsp.Position
  stop       : Lsp.Position

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

def collectCalcRelations (tree : Elab.InfoTree) (goalIds : Array String) :
    IO (Array CalcRelations) := do
  let ctxs := goalContexts tree
  let mut out : Array CalcRelations := #[]
  for goalId in goalIds do
    if let some (ctx, mvarId) := ctxs[goalId]? then
      out := out.push (← calcRelationsFor ctx goalId mvarId)
  return out

end ProofTree
