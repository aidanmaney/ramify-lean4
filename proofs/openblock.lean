/-! The OPEN BLOCK: `:= by` with nothing written into it.

Every theorem here elaborates with `unsolved goals`, deliberately — that state
IS the fixture. What it pins is that the wire ships an `openBlock` (see
ProofTreeRecover.lean's `recoverOpenBlock`) and NO step: the tree draws one
PENDING root goal with its ordinary chips, never a box standing for the tactic
nobody has written yet.

The last theorem is the negative control and the one that matters most: a
single character occupies a tactic slot, so the open block declines and the
counterfactual keeps the mid-typing case it exists for. -/

/-- The reported shape: body deleted (or not yet written) at top level. -/
theorem open_top (n : Nat) : 0 < n + 1 ∧ n + 0 = n := by

/-- A trailing comment on the `by` line. The anchor is the end of `by`, and the
insertion runs to end-of-LINE, so the comment stays glued and the new tactic
lands under it — the ordinary insertion rule, not a special case. -/
theorem open_comment (n : Nat) : n + 0 = n := by -- todo

/-- `by` on its own line: the anchor follows the `by`, not the signature. -/
theorem open_split (a b : Nat) : a + b = b + a :=
  by

/-- NOT an open block. `r` is an `unknown tactic`, but it still owns a slot, so
`recoverOpenBlock` declines and this state stays the counterfactual's. -/
theorem open_typed (n : Nat) : n + 0 = n := by
  r
