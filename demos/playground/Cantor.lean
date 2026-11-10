/-!
# Cantor's diagonal argument

No function `f` from `α` onto the predicates on `α` (its subsets): some set is
always missed. Suppose `f` were onto and build the diagonal set — the points
`x` with `¬ f x x`, not in their own image. Some `d` reaches it, and asking
whether `f d d` holds contradicts itself either way.
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
