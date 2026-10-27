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
