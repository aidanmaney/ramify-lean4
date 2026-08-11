import Mathlib

/-!
# Multi-line tactic labels

Pins `collectTacticTails`/`withTacticTail` (ProofTreeComments.lean): the
vendored prettifier keeps only a tactic's FIRST source line, so before the
tail pass a multi-line tactic's label silently dropped real text — most
visibly `rcases … <| by … with ⟨…⟩`, whose `with` clause appeared nowhere in
the tree. The corpus had ZERO multi-line `tacticString`s before this file, so
nothing pinned the behaviour either way.
-/

/-- The reported case: a tactic-valued argument's multi-line `by` block, with
a trailing `with` clause AFTER it. The label must show the `rcases` line AND
the `with ⟨p, hp, hpdvd⟩` line — but never the `grind`, which owns its own
node as the nested block's step. -/
theorem tail_after_nested_by (N : ℕ) : ∃ p, Nat.Prime p ∧ 1 ≤ p := by
  rcases Nat.exists_prime_and_dvd (n := (Nat.factorial N + 1)) <| by
    grind [Nat.factorial_pos]
    with ⟨p, hp, _⟩
  exact ⟨p, hp, hp.pos⟩

/-- A multi-line tactic with NO nested block restores its whole remainder —
label ≡ source, so token alignment covers everything. -/
theorem multiline_term_argument (a b : ℕ) (h : a = b) : a = b ∧ b = a := by
  exact ⟨h,
    h.symm⟩

/-- The no-op cases the tail rule must NOT touch: a `have … := by` whose
nested block runs to the tactic's end (label stays the first line), and an
`induction … with` whose case markers stay out of the label (the tree draws
case badges instead). -/
theorem tail_noops (n : ℕ) : 0 + n = n := by
  have h : 0 + 0 = 0 := by
    rfl
  induction n with
  | zero => exact h
  | succ d hd => rw [Nat.add_succ, hd]
