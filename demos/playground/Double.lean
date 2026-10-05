/-!
# Doubling, by induction

A function defined by recursion, and a fact about it that no automation knows
yet: `double n = 2 * n`. Induct on `n`, unfold one step of `double`, and let
`omega` finish with the induction hypothesis.
-/
-- @depth 5
-- @try rw [double]
-- @try simp [double]
-- @try unfold double
-- @try simp_all [double]
-- @try rw [double, ih]
-- @try exact ih
def double : Nat → Nat
  | 0 => 0
  | n + 1 => double n + 2

theorem double_eq : ∀ n : Nat, double n = 2 * n := by
  intro n
  induction n
  · rfl
  · rw [double]
    omega
