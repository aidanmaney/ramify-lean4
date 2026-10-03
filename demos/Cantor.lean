import Mathlib

/-!
# Cantor's diagonal argument

No set can be mapped ONTO its own power set: there are strictly more sets of
points than points. The proof builds the one set the map must miss — the
points that are not in their own image — and asks whether its preimage
belongs to it.
-/

/-- **Cantor's theorem**: no function from `α` onto the subsets of `α`. -/
theorem cantor {α : Type*} (f : α → Set α) : ¬ Function.Surjective f := by
  -- Suppose `f` were onto.
  intro hf
  -- The diagonal set: the points not in their own image.
  let D : Set α := {x | x ∉ f x}
  -- Being onto, `f` reaches `D` from some point `d`.
  obtain ⟨d, hd⟩ := hf D
  -- Is `d` in `D`? Either answer contradicts itself.
  by_cases h : d ∈ D
  · -- If `d ∈ D`, then by definition `d ∉ f d` — but `f d` is `D`.
    have hnot : d ∉ f d := h
    rw [hd] at hnot
    exact hnot h
  · -- If `d ∉ D`, then `d ∈ f d` (that is what failing `D`'s test means)
    -- — and `f d` is `D` again.
    have hin : d ∈ f d := by
      by_contra h'
      exact h h'
    rw [hd] at hin
    exact h hin
