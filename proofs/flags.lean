import Mathlib

/-- **Alectryon-style display flags.**

Every comment below that begins with `.something` is a DIRECTIVE rather than
prose: it says how the tree should show the part of the proof it introduces,
in the vocabulary Alectryon uses for Coq (and LeanInk for Lean). A flag
governs its sentence's OUTPUT, which here means the goals below it.

The statement is deliberately dull — four independent facts about `n` — so
that what varies between the branches is the flags, not the mathematics. -/
theorem flag_demo (n : ℕ) (hn : 2 ≤ n) :
    0 < n ∧ n ≠ 1 ∧ n + 0 = n ∧ (Even n ∨ Odd n) := by
  refine ⟨?_, ?_, ?_, ?_⟩
  · -- .no-hyps
    -- Nothing this branch needs is worth showing: the goal alone is the point.
    omega
  · -- .h#hn
    -- Only `hn` matters here, so only `hn` is drawn — the rest of the context
    -- is still there, just not on screen.
    omega
  · -- .fold
    -- Folded by default: the branch is routine, but one click opens it.
    have h : n + 0 = n := by
      rw [Nat.add_zero]
    exact h
  · -- .none this branch is just `Nat.even_or_odd`
    -- Elided outright, with the note above standing in for it. Unlike `.fold`
    -- there is no way to open it — the source has decided it is not part of
    -- the picture.
    rcases Nat.even_or_odd n with he | ho
    · left
      exact he
    · right
      exact ho
