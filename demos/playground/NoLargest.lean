/-!
# No largest number

For every `n` there is a bigger `m`. The witness may depend on `n`: take
`n + 1`, and the rest is arithmetic.
-/
-- @try refine ⟨n + 1, ?_⟩
-- @try refine ⟨n, ?_⟩
-- @try exact ⟨n + 1, Nat.lt_succ_self n⟩
-- @try exact Nat.lt_succ_self n
theorem no_largest : ∀ n : Nat, ∃ m, n < m := by
  intro n
  refine ⟨n + 1, ?_⟩
  omega
