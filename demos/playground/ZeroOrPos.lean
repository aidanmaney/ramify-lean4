/-!
# Zero or positive

Every natural number is `0` or a successor. `cases n` splits the goal in two,
one per constructor; each side then picks its half of the `∨`.
-/
-- @try exact Or.inl rfl
-- @try exact Nat.succ_pos _
-- @try exact Nat.zero_lt_succ _
theorem zero_or_pos : ∀ n : Nat, n = 0 ∨ 0 < n := by
  intro n
  cases n
  · left
    rfl
  · right
    omega
