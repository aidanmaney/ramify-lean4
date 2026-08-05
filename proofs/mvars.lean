/-
  mvars — the three ways a metavariable reaches the tree.

  Core-only on purpose: every phenomenon here is about elaboration order, not
  about mathematics, and a core-only file can also be driven by the offline
  `IO.processCommands` probes (Mathlib needs the interpreter flags those can't
  give).

  The corpus before this file contained ZERO metavariable occurrences across
  all 2224 printed goal and hypothesis strings — its one `apply`
  (`Nat.mul_pos`, side_goals.lean) has its arguments fully determined by the
  goal. So nothing here was reachable by any existing fixture.
-/

/-- PRINT-TIMING. `Nat.le_trans` has an implicit midpoint that the goal does
not determine, so `apply` leaves `a ≤ ?b` and `?b ≤ c`. The proof is COMPLETE —
`exact h1` pins `?b := 5` — but Paperproof prints a step's goals with that
step's own `mctxAfter`, and at `apply`'s `mctxAfter` the midpoint is still
open. So `?b` reaches the wire in a finished proof: an artifact of when the
goal was snapshotted, not of the proof. -/
theorem resolved_later (a c : Nat) (h1 : a ≤ 5) (h2 : 5 ≤ c) : a ≤ c := by
  apply Nat.le_trans
  · exact h1
  · exact h2

-- The GENUINELY OPEN case is not here, and cannot be: Lean does not let a
-- command finish with an unassigned natural metavariable. `apply` promotes the
-- undetermined midpoint to a goal of its own (`case m ⊢ Nat`), and leaving that
-- unproved is an `unsolved goals` ERROR rather than a `sorry` warning. So a
-- still-open metavariable only exists in a broken or half-written proof — it
-- lives in `lean/ProofTreeScratch.lean`, which is allowed to be broken.

/-- HOLES the author wrote, outside any `calc`. Both goals arrive through
`goalsAfter` and are pending, so today they get the generic bullet-insertion
chip; the `?_` itself is dropped by the collector. -/
theorem plain_holes (n : Nat) (h : 0 < n) : 0 < n ∧ n + 0 = n := by
  refine ⟨?_, ?_⟩
  · exact h
  · sorry

/-- A NAMED hole, written twice. `?foo` reuses the mvar it already introduced,
so both occurrences elaborate to the SAME metavariable — one goal, two source
spans, and therefore two hole records sharing one `goalId`. The fill belongs at
the first. -/
theorem named_hole_twice (n : Nat) (h : 0 < n) : 0 < n ∧ 0 < n := by
  refine ⟨?foo, ?foo⟩
  exact h
