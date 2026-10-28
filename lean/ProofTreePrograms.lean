import Ramify

show_panel_widgets [Ramify]

/-
Programs as trees — the fixture.  Core Lean only (no Mathlib), so it
elaborates in a second (`import Ramify` registers the RPCs `probe lsp`
calls).  NOT a Lake target.  Every declaration below is a
FUNCTIONAL PROGRAM except the last theorem, which must draw exactly as it did
before programs were drawn at all.  `three` must draw nothing.
-/

/-- Equations: one split, one alternative per `|`. -/
def fib : Nat → Nat
  | 0 => 0
  | 1 => 1
  | n + 2 => fib n + fib (n + 1)

/-- A term `match` on a list, cons patterns. -/
def sumList (xs : List Nat) : Nat :=
  match xs with
  | [] => 0
  | x :: rest => x + sumList rest

/-- `if … then … else`. -/
def clampTen (n : Nat) : Nat :=
  if n < 10 then n else 10

/-- A dependent `if h : …`, the hypothesis used in the `then` branch. -/
def safeHead (xs : List Nat) : Nat :=
  if h : xs ≠ [] then xs.head h else 0

/-- A data `let`. -/
def area (w h : Nat) : Nat :=
  let a := w * h
  a + a

structure Point where
  x : Nat
  y : Nat

/-- A structure built from data components. -/
def swap (p : Point) : Point :=
  ⟨p.y, p.x⟩

/-- An instance by anonymous constructor. -/
instance : Inhabited Point := ⟨⟨0, 0⟩⟩

/-- An instance by `where`. -/
instance : Add Point where
  add p q := ⟨p.x + q.x, p.y + q.y⟩

/-- A `where` helper. -/
def revAcc (xs : List Nat) : List Nat :=
  go xs []
where
  go : List Nat → List Nat → List Nat
    | [], acc => acc
    | y :: ys, acc => go ys (y :: acc)

/-- A `let rec` helper. -/
def countDown (n : Nat) : List Nat :=
  let rec loop : Nat → List Nat
    | 0 => [0]
    | k + 1 => (k + 1) :: loop k
  loop n

/-- An `abbrev` with structure. -/
abbrev pick (b : Bool) (x y : Nat) : Nat :=
  if b then x else y

/-- Nothing to draw. -/
def three := 3

/-- An ordinary theorem — unchanged. -/
theorem add_zero' (n : Nat) : n + 0 = n := by
  induction n with
  | zero => rfl
  | succ k ih => rfl

/-! ### Do blocks — a spine, one step per element. -/

/-- Indices of the first pair that sums to `target`. Pure, though it reads as imperative. -/
def twoSum (xs : Array Int) (target : Int) : Option (Nat × Nat) := Id.run do
  let mut seen : Std.HashMap Int Nat := {}
  for h : i in [0:xs.size] do
    let x := xs[i]                      -- no bounds check: `h` proves `i < xs.size`
    if let some j := seen[target - x]? then
      return some (j, i)
    seen := seen.insert x i
  return none

#guard twoSum #[2, 7, 11, 15] 9 == some (0, 1)

/-- `let x ← e` in `IO`, `unless`, a bare action. -/
def greet (name : String) : IO Unit := do
  let stdout ← IO.getStdout
  unless name.isEmpty do
    stdout.putStrLn s!"hello, {name}"
  stdout.flush

/-- `StateM`: read, write, return. -/
def tick : StateM Nat Nat := do
  let n ← get
  set (n + 1)
  return n

/-- `match` inside `do`, a block per arm. -/
def describe (xs : List Nat) : IO String := do
  match xs with
  | [] => return "empty"
  | x :: _ =>
    IO.println s!"head {x}"
    return s!"starts with {x}"

/-- A nested `for`, an `if … else`, a mutable accumulator. -/
def countPairs (n : Nat) : Nat := Id.run do
  let mut count := 0
  for i in [0:n] do
    for j in [0:n] do
      if i < j then
        count := count + 1
      else
        count := count
  return count

/-- `x ← e` (reassign from an action) and a nested `(← e)` lift. -/
def readSum (stdin : IO.FS.Stream) : IO Nat := do
  let mut total := 0
  let line ← stdin.getLine
  total ← pure (total + line.length)
  let more := (← stdin.getLine).length
  return total + more

/-- `while`. -/
def halve (n : Nat) : Nat := Id.run do
  let mut k := n
  let mut steps := 0
  while k > 1 do
    k := k / 2
    steps := steps + 1
  return steps
