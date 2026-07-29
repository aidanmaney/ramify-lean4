/-!
# ProofTreeErrors — deliberately broken proofs

Fixtures for the tree's diagnostics surface. **This file does not compile, on
purpose**, so it is not a Lake target (like `ProofTreeScratch.lean` and
`ProofTreeDemo.lean`) and nothing imports it.

Kept CORE-ONLY, which is what lets the offline probe drive it through
`Lean.Elab.IO.processCommands` under `lake env lean --run` — the documented
recipe — instead of needing a `lake exe` with `supportInterpreter` just to load
Mathlib's `@[init]` declarations. Every shape below is about the SHAPE of the
diagnostic (where its range lands relative to the tactics around it), and none
of them needs Mathlib to exhibit that.

`proofs/*.lean` cannot serve here: they are complete, so they emit no
diagnostics at all. These are the measurement corpus for the mapping.

Each theorem is named for the shape it exercises.
-/

/-- A terminal tactic that simply fails. The error sits on the tactic itself —
the easy case, and the baseline every other shape is compared against. -/
theorem err_terminal (n : Nat) : n + 0 = n := by
  intro h

/-- A type mismatch under `exact`. Its message carries an `expr` embed, which is
what decides whether the rich-message stage is worth building (M7). -/
theorem err_mismatch (a b : Nat) (h : a = b) : b = a := by
  exact h

/-- An identifier that does not exist. -/
theorem err_unknown (n : Nat) : n = n := by
  exact Nat.no_such_lemma n

/-- `sorry`: a WARNING, and its range sits on the declaration NAME — above every
tactic in the proof. The residue case the pill has to show without a node. -/
theorem err_sorry (n : Nat) : n + 0 = n := by
  sorry

/-- An unfinished branch, so the block reports `unsolved goals` (leanTag 1).
The tree already draws this as a frontier chip on `zero`, which is the
redundancy M4 has to confirm before the tag is filtered out. -/
theorem err_unsolved (n : Nat) : n + 0 = n := by
  induction n with
  | zero => skip
  | succ k ih => simp

/-- An error whose range spans SEVERAL lines, so `msgToInteractiveDiagnostic`
truncates `range.end` to `{line + 1, column 0}` — a point inside no tactic at
all. This is the fixture that proves feeding `range.start` is not optional. -/
theorem err_multiline (a b c : Nat) (h : a = b) : a = c := by
  exact
    Nat.le_antisymm
      (Nat.le_of_eq h)
      (Nat.le_of_eq h)

/-- An error in the MIDDLE of a linear run — the run ⇉ merges into one node, so
the diagnostic must land on the marker rather than vanish. -/
theorem err_in_run (n : Nat) : n + 0 = n ∧ True := by
  constructor
  rfl
  exact Nat.zero

/-- An error inside ONE BRANCH of a split, which the gallery may have paged
away. Both branches are present so only one of them is bad. -/
theorem err_in_branch (n : Nat) : n = n ∨ n + 0 = n := by
  rcases Nat.eq_zero_or_pos n with h | h
  · left
    rfl
  · right
    exact h

/-- Two errors on ONE tactic's node, for the multiplicity count (M5). -/
theorem err_two (a b : Nat) : a + b = b + a := by
  exact Nat.add_comm a b c d

/-- A LINEAR proof that simply stops short. Its frontier goal arrives through
`goalsAfter`, so the tree draws a chip on it — which is exactly the case where
the `unsolved goals` diagnostic is redundant ink and should be dropped. The
`induction` fixture above is the opposite case (the unfinished branch is not
drawn at all), so the two together are what the redundancy rule is measured on. -/
theorem err_frontier (n : Nat) : n + 0 = n := by
  have h : n = n := rfl

/-- A failure with a tactic AFTER it in the same block: `rfl` fails, so Lean
never runs the `exact` below it. The failed/skipped split is measured here —
one `"failed"` node, one `"skipped"` ghost-chained under it. -/
theorem err_tail_skipped (n : Nat) : n + 1 = n + 1 := by
  have h : n = n := rfl
  rw [Nat.succ_ne_zero]
  exact rfl

/-- A failure inside ONE branch of an `induction`: the whole structured tactic
loses its steps, and the outermost-uncovered rule must emit ONE node for the
`induction`, not nested nodes for the branch bodies too. -/
theorem err_nested_branch (n : Nat) : n + 0 = n := by
  induction n with
  | zero => intro h
  | succ k ih => simp

/-- A failing `by` under a `have`: the failure happens inside TERM elaboration,
so `errToSorry` assigns the mvar and a step EXISTS — recovery must find
NOTHING here (the errToSorry-disjointness check, P7). -/
theorem err_have_by (n : Nat) : n = n := by
  have h : n + 0 = n := by intro w
  rfl
