/-!
# And is symmetric

From `p ∧ q`, prove `q ∧ p`: take the hypothesis apart, then build the
conjunction one side at a time.
-/
-- @try exact ⟨h.2, h.1⟩
-- @try exact ⟨h.1, h.2⟩
-- @try exact h.1
-- @try exact h.2
-- @try exact h1
-- @try exact h2
-- @try apply And.intro
theorem and_swap' : ∀ p q : Prop, p ∧ q → q ∧ p := by
  intro p q h
  obtain ⟨h1, h2⟩ := h
  constructor
  · exact h2
  · exact h1
