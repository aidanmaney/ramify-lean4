/-!
# Cantor's diagonal argument

No `f` maps `α` onto its predicates (its subsets). If one did, some `d` would
hit the diagonal, `fun x => ¬ f x x`, and `f d d` could be neither true nor
false.
-/
-- @depth 5
-- @try exact hdd
-- @try rw [hd] at hdd
-- @try contradiction
theorem cantor : ∀ (α : Type) (f : α → α → Prop), ¬ Function.Surjective f := by
  intro α f h
  obtain ⟨d, hd⟩ := h (fun x => ¬ f x x)
  by_cases hdd : f d d
  · apply absurd hdd
    rw [hd] at hdd
    exact hdd
  · apply hdd
    rw [hd]
    exact hdd
