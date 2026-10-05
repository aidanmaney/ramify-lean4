/-!
# Zero plus n

On `Nat`, addition recurses on its SECOND argument, so `n + 0 = n` holds by
definition but `0 + n = n` does not: it needs induction. `omega` and `simp`
know it already; `induction n` shows why it is true.
-/
-- @try exact rfl
-- @try rw [Nat.add_comm]
-- @try simp [Nat.add_succ]
theorem zero_add_nat : ∀ n : Nat, 0 + n = n := by
  intro n
  induction n
  · rfl
  · omega
