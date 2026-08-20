import Mathlib

/-!
# `hyp_used` — what the ▸ gutter marker means, pinned by fixture.

The ▸ marker on a context line means "the tactic that CONSUMES this goal uses
this hypothesis", computed from that step's `tacticDependsOn` (the fvars
Paperproof reads off the elaborated proof term). Under the default `used`
breadth the LINES SHOWN are a wider set — the union of `tacticDependsOn` over
the goal's whole SUBTREE — so a line can legitimately be shown and NOT marked:
something below needs it, the immediate consumer does not.

The two theorems here pin both readings, so a regression in attribution or in
the marker's all-used/none-used suppression rule shows up as a corpus diff
rather than as a user report.
-/

/-- `some_marked` — the mixed case, and the shape a user reported as a bug.

`refine ⟨2 * k * k, ?_⟩`'s own term mentions `m` (through the predicate it
instantiates) and `k` (the witness) but NOT `hk`, so its consumed goal marks
two of the three lines it shows. `hk` is shown there because `rw [hk]` BELOW
uses it — present-but-unmarked, which is the two rules agreeing rather than a
dependency going missing. -/
theorem some_marked (m : ℕ) : Even m → Even (m ^ 2) := by
  rintro ⟨k, hk⟩
  refine ⟨2 * k * k, ?_⟩
  rw [hk]
  ring

/-- `all_marked` — the consuming `rw` uses every line its goal shows, so the
marker column carries no distinction and is suppressed entirely. -/
theorem all_marked (a b : ℕ) (hab : a = b) : a + a = b + b := by
  rw [hab]
