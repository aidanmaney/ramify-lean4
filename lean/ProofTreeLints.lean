import Ramify
import Mathlib

show_panel_widgets [Ramify]

/-!
# D4 against the live server

A fixture for the LIVE server (nothing under `lean/` is a Lake target and none
of it reaches `web/public/sample.ndjson`). `import Ramify` is what registers
the RPC methods, so this is the file `probe lsp … --lint` is pointed at.

One declaration per linter D4 turns on, written the way the linter objects to,
so the lint is a real message from Mathlib's own linter and not a shape this
project decided was bad style.

* `lint_multigoal` — `constructor` leaves two goals and the next tactic works
  on one of them (`linter.style.multiGoal`). The fix inserts `·`.
* `lint_unused` — `skip` does nothing (`linter.unusedTactic`). The fix deletes
  the step.
* `lint_flexible` — a non-terminal `simp at h` whose result a later tactic
  reads (`linter.flexible`). The fix is D2's `simp only [...]`.
* `lint_havelet` — a `have` binding a Type and not a Prop
  (`linter.haveLet`). The fix is `have` → `let`.
* `lint_cdot` — `.` where `·` is meant (`linter.style.cdot`). The fix is the
  character.
* `lint_lambda` — `λ` where `fun` is meant (`linter.style.lambdaSyntax`).
* `lint_cases` — `cases'`, which Mathlib deprecates in favour of `obtain` /
  `rcases` / `cases` (`linter.style.cases`). NO fix: the transposition is not
  a rewrite of one token.
* `lint_seqfocus` — `tac1 <;> tac2` where `(tac1; tac2)` would do
  (`linter.unnecessarySeqFocus`). NO fix.
-/

theorem lint_multigoal (a b : ℕ) : a + b = b + a ∧ b + a = a + b := by
  constructor
  omega
  omega

theorem lint_unused (n : ℕ) : n + 0 = n := by
  skip
  rfl

theorem lint_flexible (n : ℕ) (h : n + 0 = 1) : n = 1 := by
  simp at h
  exact h

theorem lint_havelet (n : ℕ) : n + 0 = n := by
  have m : ℕ := 3
  rfl

theorem lint_cdot (n : ℕ) (h : n = 0 ∨ n = 1) : n < 2 := by
  rcases h with h | h
  . omega
  . omega

theorem lint_lambda (n : ℕ) : (fun x => x) n = n := by
  show (λ x => x) n = n
  rfl

theorem lint_cases (n : ℕ) (h : n = 0 ∨ n = 1) : n < 2 := by
  cases' h with h h
  · omega
  · omega

theorem lint_seqfocus (n : ℕ) (h : n = 1) : n + 0 = 1 := by
  simp <;> omega
