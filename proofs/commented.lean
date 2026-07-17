import Mathlib

/-!
# Comment-attribution sample

Exercises every comment→node rule in `proofToTree.ts` / `ProofTreeComments.lean`:
the docstring and the before-first-tactic block land on the ROOT goal; a leading
comment block lands on the tactic below it; a same-line comment trails its
tactic; adjacent comment lines merge. (This module doc itself must NOT appear —
it's outside the theorem's command range.)
-/

/-- Every natural is even or odd — by induction, flipping parity each step. -/
theorem even_or_odd (n : ℕ) : ∃ k, n = 2 * k ∨ n = 2 * k + 1 := by
  -- The plan: induct on n; the base case is 0 = 2·0, and the successor
  -- of an even is odd (same k) while the successor of an odd is even (k+1).
  induction n with
  | zero =>
    -- base case: k = 0, left disjunct
    exact ⟨0, Or.inl rfl⟩
  | succ m ih =>
    obtain ⟨k, hk | hk⟩ := ih -- split on the parity of m
    · -- m was even, so m+1 is odd with the SAME witness
      exact ⟨k, Or.inr (by omega)⟩
    · exact ⟨k + 1, Or.inl (by omega)⟩ -- m was odd: bump the witness
