import Mathlib

/-
  demo_main — the comprehensive one.
  Exercises: intro (hyp delta), induction with named cases (zero/succ) + `ih`,
  obtain (hyp delta: ih → hPk, hsum), `have ... := by ...` (SPAWNED GOAL),
  constructor (branching ∧ → 2 goals), and goal-closing (exact / rfl / omega).
  Unicode + structured types: ℕ, ∀, →, ∧.
-/
theorem demo_main
    (P : ℕ → Prop)
    (h0 : P 0)
    (hstep : ∀ k, P k → P (k + 1)) :
    ∀ n, P n ∧ (0 + n = n) := by
  intro n
  induction n with
  | zero =>
    constructor
    · exact h0
    · rfl
  | succ k ih =>
    obtain ⟨hPk, hsum⟩ := ih
    have hP : P (k + 1) := by
      exact hstep k hPk
    constructor
    · exact hP
    · omega

/-
  demo_cases — branching with DIVERGENT per-branch hypotheses.
  Exercises: rcases alternation (named inl/inr), different new hyp per branch
  (hp : p  vs  hq : q), a spawned `have` goal in one branch only, and `→` types.
  This is the key test for sibling subtrees whose hyp-deltas differ.
-/
theorem demo_cases (p q : Prop) (h : p ∨ q) (hpq : p → q) : q := by
  rcases h with hp | hq
  · have h2 : q := by
      exact hpq hp
    exact h2
  · exact hq

/-
  demo_rw — a linear chain on a single goal lineage.
  Exercises: shared goal nodes across consecutive steps (#1) and goal-id
  equivalence (#2) — every `rw` changes the goal's MVarId while it stays
  logically "the same" goal — plus closing-by-rfl.
-/
theorem demo_rw (a b c : ℕ) (h1 : a = b) (h2 : b = c) : a + 0 = c := by
  rw [Nat.add_zero]   -- goal: a = c
  rw [h1]             -- goal: b = c
  rw [h2]             -- goal: c = c  (closed by rfl)
