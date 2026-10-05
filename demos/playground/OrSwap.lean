/-!
# Or is symmetric

From `p ∨ q`, prove `q ∨ p`: there are two ways the hypothesis could hold, so
there are two cases, and each picks a side of the goal.
-/
-- @try exact Or.inr h
-- @try exact Or.inl h
-- @try exact h.symm
theorem or_swap' : ∀ p q : Prop, p ∨ q → q ∨ p := by
  intro p q h
  rcases h with h | h
  · right
    exact h
  · left
    exact h
