/-!
# A witness

To prove `∃ n, n * n = 49`, name the `n`: `refine ⟨7, ?_⟩` leaves the check
`7 * 7 = 49`, which is a computation. Guess wrong and Lean says so.
-/
-- @try exact ⟨7, rfl⟩
-- @try exact ⟨6, rfl⟩
-- @try refine ⟨7, ?_⟩
-- @try refine ⟨6, ?_⟩
-- @try exists 7
theorem seven_sq : ∃ n : Nat, n * n = 49 := by
  refine ⟨7, ?_⟩
  rfl
