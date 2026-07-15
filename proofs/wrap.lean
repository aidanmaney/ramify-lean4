import Mathlib

/-!
# Wrapping stress sample

A theorem whose statement (and inner goals) exceed the renderer's ~100-column
wrap budget, so the goal boxes exercise the intelligent line wrapping
(breaks at commas / before connectives, hanging indent on continuations).
Mathematically trivial on purpose.
-/

theorem long_statement_wraps (α : Type) (f : α → ℕ) (g : ℕ → ℕ) (xs : List α)
    (n m k : ℕ) (hn : 2 ≤ n) (hm : m ∣ n) (hk : k < n) :
    n = n ∧ (m ∣ n → 2 ≤ n) ∧ (k < n ∨ n ≤ k) ∧ (∀ x ∈ xs, f x = f x) ∧
      g (n + m + k) = g (n + m + k) ∧ (2 ≤ n → n = n ∧ m ∣ n) := by
  refine ⟨rfl, fun _ => hn, Or.inl hk, fun x _ => rfl, rfl, fun h => ⟨rfl, hm⟩⟩
