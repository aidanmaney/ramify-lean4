import Mathlib

/-!
# Irrational numbers

Two classics. First the proof most mathematicians meet early: √2 is
irrational, by contradiction and parity. Then a famous non-constructive
argument: there are irrational numbers `a` and `b` with `a ^ b` rational —
and the proof never says which pair works.
-/

/-- If `n²` is even then `n` is even: the parity fact the √2 argument leans on. -/
theorem even_of_even_sq {n : ℕ} (h : Even (n ^ 2)) : Even n := by
  -- Suppose not: then `n` is odd.
  by_contra hn
  rw [Nat.not_even_iff_odd] at hn
  -- Write the odd number as `2k + 1`.
  obtain ⟨k, rfl⟩ := hn
  -- Its square is `2(2k² + 2k) + 1`, which is odd …
  have hodd : Odd ((2 * k + 1) ^ 2) := ⟨2 * k ^ 2 + 2 * k, by ring⟩
  -- … and no number is both even and odd.
  exact Nat.not_even_iff_odd.mpr hodd h

/-- **√2 is irrational**: there is no fraction `p / q` in lowest terms whose
square is 2. -/
theorem sqrt_two_irrational :
    ¬ ∃ p q : ℕ, 0 < q ∧ Nat.Coprime p q ∧ p ^ 2 = 2 * q ^ 2 := by
  -- Suppose `p / q` were such a fraction, in lowest terms.
  rintro ⟨p, q, hq, hcop, h⟩
  -- `p² = 2q²` is even, so `p` is even: `p = k + k`.
  have hp : Even p := even_of_even_sq ⟨q ^ 2, by rw [h]; ring⟩
  obtain ⟨k, rfl⟩ := hp
  -- Then `4k² = 2q²`, so `q² = 2k²` is even too, and so is `q`.
  have hq2 : q ^ 2 = 2 * k ^ 2 := by nlinarith [h]
  have hqe : Even q := even_of_even_sq ⟨k ^ 2, by rw [hq2]; ring⟩
  obtain ⟨m, rfl⟩ := hqe
  -- Now 2 divides both `p` and `q` — but the fraction was in lowest terms.
  have h2 : 2 ∣ Nat.gcd (k + k) (m + m) := Nat.dvd_gcd ⟨k, by ring⟩ ⟨m, by ring⟩
  rw [hcop.gcd_eq_one] at h2
  omega

/-- **An irrational power can be rational.** The proof splits on a question it
never answers: is `√2 ^ √2` rational? -/
theorem exists_irrational_pow_rational :
    ∃ a b : ℝ, Irrational a ∧ Irrational b ∧ ¬ Irrational (a ^ b) := by
  -- Look at `√2 ^ √2`. Either it is irrational or it is not.
  by_cases h : Irrational (Real.sqrt 2 ^ Real.sqrt 2)
  · -- If it is irrational, raise it to `√2` once more:
    -- `(√2 ^ √2) ^ √2 = √2 ^ (√2 · √2) = √2 ^ 2 = 2`, which is rational.
    refine ⟨Real.sqrt 2 ^ Real.sqrt 2, Real.sqrt 2, h, irrational_sqrt_two, ?_⟩
    rw [← Real.rpow_mul (Real.sqrt_nonneg 2), Real.mul_self_sqrt (by norm_num),
      Real.rpow_two, Real.sq_sqrt (by norm_num)]
    exact_mod_cast Nat.not_irrational 2
  · -- If it is not irrational, `a = b = √2` already works.
    exact ⟨Real.sqrt 2, Real.sqrt 2, irrational_sqrt_two, irrational_sqrt_two, h⟩
