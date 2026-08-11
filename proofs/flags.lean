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
    -- Elided into the trunk, with the note above standing in for it: the
    -- tactic and its whole branch collapse to one dashed ghost. Unlike
    -- `.fold` the fold controls do not reach it — the source has decided it
    -- is not part of the picture — but the ghost itself opens on a click.
    rcases Nat.even_or_odd n with he | ho
    · left
      exact he
    · right
      exact ho

/-- **`.none` on a step that CLOSES its goal.** Everywhere else the flag lifts a
tactic and whatever it opened out of the tree; on the last step of a branch
there is nothing below it to put away, so the ghost carries only the sentence —
which is why the words are not optional here. A bare `.none` on a closing step
is refused (it would replace one box with a ghost restating the same label);
written out, it stands in for the step exactly as it does anywhere else.

The second branch is the contrast: an unflagged closing step draws its box. -/
theorem flag_closing (n : ℕ) : n + 0 = n ∧ 0 ≤ n := by
  constructor
  · -- .none `Nat.add_zero`, under whatever name `simp` knows it by
    simp
  · omega

/-- **A `.none` inside a `.none`.** Both flags are honest — the author put one
away and, inside it, put a smaller thing away — and the OUTER one is what the
tree shows: the inner ghost is inside the block the outer one lifted out, so it
reappears the moment the outer ghost is opened.

The two cuts overlap, which is the case `applyElisions` needs `disjointCuts` for:
a node can belong to only one marker, and two markers claiming the same node end
up as each other's parents — a cycle the layout draws as a link running back UP
into a ghost, across the box. Note the flags reach the seed in SOURCE order,
outer first, which is why the bigger cut wins rather than the later one. -/
theorem flag_nested (n : ℕ) : n + 0 = n := by
  -- .none the detour, and everything it opened, in one ghost
  have h : n + 0 = n ∧ 0 ≤ n := by
    constructor
    · -- .none `simp` again, one level further in
      simp
    · omega
  exact h.1
