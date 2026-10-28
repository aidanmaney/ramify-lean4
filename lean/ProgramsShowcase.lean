import Ramify

show_panel_widgets [Ramify]

/-!
# Programs as trees — a tour

Put the cursor inside any declaration and read the Proof tree panel.
Each one shows off a different shape; the comment above it says what to look for.
-/

structure Stats where
  count : Nat
  total : Int
deriving Repr

/-! ## Term-style definitions -/

/-- **Equations.** One split, one branch per `|`, badged with its pattern
(`case 0`, `case 1`, `case n + 2`); `n` is in the third branch's context. -/
def fib : Nat → Nat
  | 0 => 0
  | 1 => 1
  | n + 2 => fib n + fib (n + 1)

/-- **`match`, `let`, `if` and a structure built from data.** The `x :: rest`
branch binds `x` and `rest`; `let s := …` puts `s` in the context below it;
`if` splits into `case then` / `case else`, and each `⟨…, …⟩` hangs a goal per
field (`⊢ Nat`, `⊢ Int`) — data, not proofs. -/
def summarize (xs : List Int) : Stats :=
  match xs with
  | [] => ⟨0, 0⟩
  | x :: rest =>
    let s := summarize rest
    if x > 0 then ⟨s.count + 1, s.total + x⟩ else s

/-- **Dependent `if`.** `case then h` carries `h : i < xs.size`, which is what
makes `xs[i]` safe; hover the line to see it came from the `if`. -/
def nth (xs : Array Int) (i : Nat) : Int :=
  if h : i < xs.size then xs[i] else 0

/-- **A `where` helper.** `go xs []` spawns `case go` with the helper's own
type, and the helper's equations split below it (`case [], acc` …). -/
def reverse (xs : List α) : List α := go xs []
where
  go : List α → List α → List α
    | [], acc => acc
    | y :: ys, acc => go ys (y :: acc)

/-- **`let rec`.** The local helper hangs off as `case loop`; the trunk
continues with `loop n`. -/
def countDown (n : Nat) : List Nat :=
  let rec loop : Nat → List Nat
    | 0 => [0]
    | k + 1 => (k + 1) :: loop k
  loop n

/-- **An instance with fields.** `where` → `case add` → `add a b :=` → the
two data fields. -/
instance : Add Stats where
  add a b := ⟨a.count + b.count, a.total + b.total⟩

/-- **`abbrev` draws too.** -/
abbrev clamp (lo hi n : Int) : Int :=
  if n < lo then lo else if n > hi then hi else n

/-! ## `do` blocks: a spine, one step per line -/

/-- **`let mut`, `for h : i in`, `if let`, early `return`, reassignment.**
`seen` is drawn once with its latest type however many times it is
reassigned; the loop body hangs off as `case body i h`, the `if let` as
`case then j`, and its `return` is narrated as an early return. -/
def twoSum (xs : Array Int) (target : Int) : Option (Nat × Nat) := Id.run do
  let mut seen : Std.HashMap Int Nat := {}
  for h : i in [0:xs.size] do
    let x := xs[i]   -- no bounds check: h proves i < xs.size
    if let some j := seen[target - x]? then
      return some (j, i)
    seen := seen.insert x i
  return none

/-- **`while` with an `if`/`else` inside.** -/
def collatzSteps (n : Nat) : Nat := Id.run do
  let mut k := n
  let mut steps := 0
  while k > 1 do
    if k % 2 == 0 then
      k := k / 2
    else
      k := 3 * k + 1
    steps := steps + 1
  return steps

/-- **Nested `for`.** Two `case body` levels, the inner one with an `if`. -/
def countPairs (xs : List Int) : Nat := Id.run do
  let mut count := 0
  for a in xs do
    for b in xs do
      if a < b then
        count := count + 1
  return count

/-- **`IO`: `←` binds, `unless`, and `match` inside `do`.** Goals read
`IO Unit`; `out` comes from the `let … ←` step. -/
def report (xs : List Int) : IO Unit := do
  let s := summarize xs
  unless s.count == 0 do
    IO.println s!"{s.count} positive, total {s.total}"
  match xs.head? with
  | none => IO.println "empty"
  | some x =>
    let out ← IO.getStdout
    out.putStrLn s!"first: {x}"

/-- **`StateM`.** Same spine, a different monad. -/
def tick : StateM Nat Nat := do
  let n ← get
  set (n + 1)
  return n

/-! ## Nothing to draw -/

/-- A definition that is one expression has no structure, so the panel stays
empty — on purpose. -/
def three : Nat := 3

/-! ## They really run -/

#guard fib 10 == 55
#guard (summarize [3, -1, 4]).total == 7
#guard nth #[1, 2, 3] 5 == 0
#guard reverse [1, 2, 3] == [3, 2, 1]
#guard countDown 3 == [3, 2, 1, 0]
#guard clamp 0 10 42 == 10
#guard twoSum #[2, 7, 11, 15] 9 == some (0, 1)
#guard collatzSteps 6 == 8
#guard countPairs [1, 2, 3] == 3
#guard (tick.run 4).1 == 4
