import Mathlib

/-!
# Three kinds of induction

Ordinary induction twice — Gauss's sum and Bernoulli's inequality — and then
strong induction, where the step may use ANY smaller case: every positive
number is a power of two times an odd number.
-/

/-- **Gauss's sum**: `0 + 1 + ⋯ + n = n(n + 1) / 2`, stated without division. -/
theorem gauss_sum (n : ℕ) : 2 * ∑ i ∈ Finset.range (n + 1), i = n * (n + 1) := by
  induction n with
  | zero => simp
  | succ k ih =>
    -- Split off the last term and let the hypothesis handle the rest.
    rw [Finset.sum_range_succ, mul_add, ih]
    ring

/-- **Bernoulli's inequality**: `(1 + x)ⁿ ≥ 1 + nx` whenever `x ≥ -1`. -/
theorem bernoulli_inequality {x : ℝ} (hx : -1 ≤ x) (n : ℕ) : 1 + n * x ≤ (1 + x) ^ n := by
  induction n with
  | zero => simp
  | succ k ih =>
    -- `1 + x` is not negative, so multiplying by it keeps the inequality.
    have h1 : 0 ≤ 1 + x := by linarith
    calc 1 + ((k + 1 : ℕ) : ℝ) * x = 1 + k * x + x := by push_cast; ring
      _ ≤ 1 + k * x + x + k * x ^ 2 := by
          nlinarith [sq_nonneg x, (Nat.cast_nonneg k : (0 : ℝ) ≤ k)]
      _ = (1 + k * x) * (1 + x) := by ring
      _ ≤ (1 + x) ^ k * (1 + x) := mul_le_mul_of_nonneg_right ih h1
      _ = (1 + x) ^ (k + 1) := by ring

/-- **Strong induction**: every positive number is `2ᵏ · m` with `m` odd. -/
theorem two_pow_mul_odd (n : ℕ) (hn : 0 < n) : ∃ k m, Odd m ∧ n = 2 ^ k * m := by
  induction n using Nat.strong_induction_on with
  | _ n ih =>
    rcases Nat.even_or_odd n with ⟨r, hr⟩ | hodd
    · -- `n = r + r` is even. `r` is smaller, so factor `r`, then add one more 2.
      have hr0 : 0 < r := by omega
      obtain ⟨k, m, hm, hrm⟩ := ih r (by omega) hr0
      exact ⟨k + 1, m, hm, by rw [hr, hrm]; ring⟩
    · -- `n` is already odd: no twos at all.
      exact ⟨0, n, hodd, by simp⟩
