import Mathlib

/-!
# Multi-line tactic labels

Pins `collectTacticTails`/`withTacticTail` (ProofTreeComments.lean): the
vendored prettifier keeps only a tactic's FIRST source line, so without the
restoration pass a multi-line tactic's label silently drops real text — most
visibly `rcases … <| by … with ⟨…⟩`, whose `with` clause appeared nowhere in
the tree. The corpus had ZERO multi-line `tacticString`s before this file, so
nothing pinned the behaviour either way.

The dropped text falls in TWO regions, either side of what the tree draws for
itself, and this file pins both plus every no-op between them. The second
region — the STATEMENT'S CONTINUATION, before the nested block rather than
after it — was missed for three weeks: the original rule restored only the
trailing region, so a `have` whose type spans lines drew a binder and a
dangling comma. `proofs/odd_sums.lean`'s `have gap` was that shape the whole
time and was never noticed, because a rule that restores nothing is invisible
to a regen diff.
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

/-- The no-op cases the restoration must NOT touch: a `have … := by` whose
type fits on ONE line (its nested block begins on the next line and runs to
the tactic's end, so neither region has anything in it), and an
`induction … with` whose case markers stay out of the label (the tree draws
case badges instead). -/
theorem tail_noops (n : ℕ) : 0 + n = n := by
  have h : 0 + 0 = 0 := by
    rfl
  induction n with
  | zero => exact h
  | succ d hd => rw [Nat.add_succ, hd]

/-- The reported hole in the trailing-only rule: a `have` whose TYPE spans
several lines, justified `:= by`. The missing text is not a tail — the nested
block runs to the tactic's end, so there is nothing after it — it is the head
line's own sentence, finished. The label must carry the whole statement
through the `:= by`; the `intro`/`exact` below own their own nodes and must
stay out of it. -/
theorem head_continuation_before_nested_by (N : ℕ) :
    (∑ i ∈ Finset.range (N + 1), (2 * i + 1))
      = (∑ i ∈ Finset.range N, (2 * i + 1)) + (2 * N + 1) := by
  have gap : ∀ m : ℕ,
      (∑ i ∈ Finset.range (m + 1), (2 * i + 1))
        = (∑ i ∈ Finset.range m, (2 * i + 1)) + (2 * m + 1) := by
    intro m
    exact Finset.sum_range_succ (fun i => 2 * i + 1) m
  exact gap N

/-- The no-op the OBVIOUS version of that fix breaks, and the reason
`altClauseKinds` exists. Written this way an `induction`/`match`'s first
nested block sits on the case BODY line, two lines down, so "restore the
lines before the first nested block" pulls `| zero =>` into the label — a
marker the case badge already carries. Both labels must stay at their first
line. -/
theorem alt_markers_stay_out (n : ℕ) (h : 0 + 0 = 0) : 0 + n = n := by
  match n with
    | 0 =>
      exact h
    | k + 1 =>
      induction k with
        | zero =>
          simp
        | succ d _ =>
          simp
