/-!
# From a false hypothesis

`n + 1 = 0` never holds, so from it anything follows — even `2 + 2 = 5`. The
work is in the hypothesis, not the goal.
-/
-- @try exact absurd h (Nat.succ_ne_zero n)
-- @try simp at h
-- @try cases h
-- @try exfalso
-- @try exact Nat.succ_ne_zero n h
theorem from_false : ∀ n : Nat, n + 1 = 0 → 2 + 2 = 5 := by
  intro n h
  omega
