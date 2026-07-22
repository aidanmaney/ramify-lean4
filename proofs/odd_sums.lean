import Mathlib

/-- **Sums of odd numbers, and what they know about parity.**

The plan: prove the classical identity `1 + 3 + ⋯ + (2m−1) = m²` by induction
on `m`, then read four corollaries off it — the identity at `n`, the fact that
squaring both preserves and reflects parity, the size of the gap between
consecutive partial sums, and the residue of `n` mod 2. Contrived on purpose:
the point is the shape of the argument, not its depth. -/
theorem sum_range_odd (n : ℕ) :
    (∑ i ∈ Finset.range n, (2 * i + 1)) = n ^ 2
      ∧ (Even n ↔ Even (n ^ 2))
      ∧ (∑ i ∈ Finset.range (n + 1), (2 * i + 1))
          = (∑ i ∈ Finset.range n, (2 * i + 1)) + (2 * n + 1)
      ∧ (n % 2 = 0 ∨ n % 2 = 1) := by
  -- Step 1: the identity itself. Everything below is a corollary of it.
  have key : ∀ m : ℕ, (∑ i ∈ Finset.range m, (2 * i + 1)) = m ^ 2 := by
    intro m
    induction m with
    | zero =>
      -- The empty sum is 0, and 0 ^ 2 = 0.
      simp
    | succ k ih =>
      -- Peel the last summand off the range, fold in the hypothesis, and let
      -- `ring` finish the binomial.
      rw [Finset.sum_range_succ, ih, add_comm]
      ring
  -- Step 2: the gap between consecutive partial sums is the next odd number.
  have gap : ∀ m : ℕ,
      (∑ i ∈ Finset.range (m + 1), (2 * i + 1))
        = (∑ i ∈ Finset.range m, (2 * i + 1)) + (2 * m + 1) := by
    intro m
    exact Finset.sum_range_succ (fun i => 2 * i + 1) m
  -- Step 3: parity survives squaring in both directions. This is the one part
  -- that really splits: forward is a construction, backward a case analysis on
  -- the parity of m.
  have parity : ∀ m : ℕ, Even m ↔ Even (m ^ 2) := by
    intro m
    constructor
    · -- Forward: m = k + k, so m ^ 2 = 2 * (2 * k * k).
      rintro ⟨k, hk⟩
      refine ⟨2 * k * k, ?_⟩
      rw [hk]
      ring
    · -- Backward: an odd m would square to something odd, so m is even.
      intro hsq
      rcases Nat.even_or_odd m with he | ho
      · -- Even case: the hypothesis is already the goal.
        exact he
      · -- Odd case: m = 2j + 1 makes m ^ 2 = 2 * (2j² + 2j) + 1, which is odd,
        -- and no natural number is both even and odd.
        exfalso
        obtain ⟨j, hj⟩ := ho
        have hodd : Odd (m ^ 2) := by
          refine ⟨2 * j * j + 2 * j, ?_⟩
          rw [hj]
          ring
        exact (Nat.not_even_iff_odd.mpr hodd) hsq
  -- Step 4: the residue, by splitting on evenness rather than on arithmetic.
  have residue : n % 2 = 0 ∨ n % 2 = 1 := by
    by_cases hn : Even n
    · -- Even: write n = k + k and compute the residue directly.
      left
      obtain ⟨k, hk⟩ := hn
      rw [hk]
      omega
    · -- Odd: the same, one step further along.
      right
      rw [Nat.not_even_iff_odd] at hn
      obtain ⟨k, hk⟩ := hn
      rw [hk]
      omega
  -- The four corollaries, in the order the statement lists them.
  exact ⟨key n, parity n, gap n, residue⟩
