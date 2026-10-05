/-!
# A chain of rewrites

Two equations and a `+ 0`: rewrite the goal one step at a time — drop the
`+ 0`, replace `a` by `b`, then `b` by `c` — until both sides agree.
-/
-- @try rw [Nat.add_zero]
-- @try rw [hab, hbc]
-- @try exact hbc
-- @try exact hab
-- @try rw [hbc]
theorem rw_chain : ∀ a b c : Nat, (hab : a = b) → (hbc : b = c) → a + 0 = c := by
  intro a b c hab hbc
  rw [Nat.add_zero]
  rw [hab]
  exact hbc
