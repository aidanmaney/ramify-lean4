import Mathlib

/-
  side_goals — tactics that generate PROOF OBLIGATIONS alongside the main goal.

  A `rw` with a conditional rewrite leaves two goals: the rewritten goal (the
  mathematics continuing) and the rule's side condition (an obligation the
  rewrite generated). Lean puts the main goal FIRST, but its proof text is
  written first too, so the obligation's text comes LAST in source — and the
  trunk layout's "last child in source order resumes the trunk" rule therefore
  handed the trunk to the OBLIGATION, branching the actual mathematics off to
  the side. These fixtures pin the corrected placement.

  `apply` is the CONTROL: its goals are one per lemma argument, peers with no
  main thread among them, so it must keep the plain source-order rule.
-/

/-- Single-rule `rw` with a bulleted side condition. `Nat.sub_add_cancel`
needs `b ≤ a`, so this branches into `a = a + 0` (main) and `b ≤ a` (side). -/
theorem side_bulleted (a b : ℕ) (h : b ≤ a) : a - b + b = a + 0 := by
  rw [Nat.sub_add_cancel]
  · rfl
  · exact h

/-- The same obligation discharged LINEARLY instead of under a bullet — the
main line closes first, then the leftover goal. Same shape on the wire. -/
theorem side_linear (a b : ℕ) (h : b ≤ a) : a - b + b + 0 = a := by
  rw [Nat.add_zero, Nat.sub_add_cancel]
  exact h

/-- Multi-rule `rw`: Paperproof splits one step per rewrite rule, so the side
condition hangs off the SPLIT step for `Nat.sub_add_cancel` rather than off
the whole tactic. Its label is still `rw [...]`, which is what the family test
keys on. -/
theorem side_multi_rule (a b c : ℕ) (h : b ≤ a) (hc : c = 0) :
    a - b + b + c = a := by
  rw [hc, Nat.add_zero, Nat.sub_add_cancel]
  exact h

/-- CONTROL: `apply` produces one goal per argument of the lemma. Neither is
"the main goal" — they are peers, like a case split — so this proof's layout
must be untouched by the side-goal rule. -/
theorem control_apply (n m : ℕ) (hn : 0 < n) (hm : 0 < m) : 0 < n * m := by
  apply Nat.mul_pos
  · exact hn
  · exact hm
