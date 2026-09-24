import Ramify
import Mathlib



show_panel_widgets [Ramify]


/-- **Euclid's theorem: theVjre are infinitely many primes.**
-/
theorem infinitude_of_primes (N : ℕ) : ∃ p, Nat.Prime p ∧ N < p := by
  -- Step 1: N! + 1 is divisible by some prime
  rcases Nat.exists_prime_and_dvd (n := (Nat.factorial N + 1)) <| by
    grind [Nat.factorial_pos]
    with ⟨p, hp, hpdvd⟩
  -- Step 2: apply it to N! + 1, which is ≥ 2.
  refine ⟨p, hp, ?_⟩
  -- Step 3: show N < p by contradiction.
  by_contra hle
  -- p ∣ N! and p ∣ N! + 1, so p ∣ 1.
  have hpdf : p ≤ N := by order
  rw [Nat.dvd_add_right (Nat.dvd_factorial (hp.pos) hpdf)] at hpdvd
  -- But a prime cannot divide 1.
  grind only [Nat.not_prime_one, Nat.dvd_one]

theorem my_zero_add (n : ℕ) : 0 + n = n := by
  induction n with
  | zero => rw [Nat.zero_add]
  | succ d hd => rw [Nat.add_succ, hd]

/-- **Sums of odd numbers, and what they know about parity.**

The plan: prove the classical identity `1 + 3 + ⋯ + (2m−1) = m²` by induction
on `m`, then read four corollaries off it — the identity at `n`, the fact that
squaring both preserves and reflects parity, the size of the gap between
consecutive partial sums, and the residue of `n` mod 2. Contrived on purpose:
the point is the shape of the argument, not its depth. -/
theorem sum_range_odd (n : ℕ) :
    (∑ i ∈ Finset.range n, (2 * i + 1)) = n ^ 2
      ∧ (Even n ↔ Even (n ^ 2))
      ∧ (∑ i ∈ Finset.range (n + 1), (2 * i + 1))
          = (∑ i ∈ Finset.range n, (2 * i + 1)) + (2 * n + 1)
      ∧ (n % 2 = 0 ∨ n % 2 = 1) := by

  -- Step 1: the identity itself. Everything below is a corollary of it.
  have key : ∀ m : ℕ, (∑ i ∈ Finset.range m, (2 * i + 1)) = m ^ 2 := by
    intro m
    induction m with
    | zero =>
      -- .no-hyps
      -- The empty sum is 0, and 0 ^ 2 = 0.  Nothing in the context bears on
      -- this, so the flag above drops it.
      simp
    | succ k ih =>
      -- .h#ih
      -- Peel the last summand off the range, fold in the hypothesis, and let
      -- `ring` finish the binomial. Only `ih` is worth reading here.
      rw [Finset.sum_range_succ, ih, add_comm]
      -- .mark hello
      ring
  -- .fold
  -- Step 2: the gap between consecutive partial sums is the next odd number.
  -- Its proof is one lemma application, so it starts folded.
  have gap : ∀ m : ℕ,
      (∑ i ∈ Finset.range (m + 1), (2 * i + 1))
        = (∑ i ∈ Finset.range m, (2 * i + 1)) + (2 * m + 1) := by
    intro m
    exact Finset.sum_range_succ (fun i => 2 * i + 1) m
  -- Step 3: parity survives squaring in both directions. This is the one part
  -- that really splits: forward is a construction, backward a case analysis on
  -- the parity of m.
  -- .none
  -- .mark
  have parity : ∀ m : ℕ, Even m ↔ Even (m ^ 2) := by
    intro m
    constructor
    · -- Forward: m = k + k, so m ^ 2 = 2 * (2 * k * k).
      rintro ⟨k, hk⟩
      refine ⟨2 * k * k, ?_⟩
      rw [hk]
      ring
    · -- Backward: an odd m would square to something odd, so m is even.
      intro hsq
      rcases Nat.even_or_odd m with he | ho
      · -- Even case: the hypothesis is already the goal.
        exact he
      · -- Odd case: m = 2j + 1 makes m ^ 2 = 2 * (2j² + 2j) + 1, which is odd,
        -- and no natural number is both even and odd.
        exfalso
        obtain ⟨j, hj⟩ := ho
        -- .none the algebra: m = 2j + 1 squares to 2 * (2j² + 2j) + 1
        have hodd : Odd (m ^ 2) := by
          refine ⟨2 * j * j + 2 * j, ?_⟩
          rw [hj]
          ring
        exact (Nat.not_even_iff_odd.mpr hodd) hsq
  -- Step 4: the residue, by splitting on evenness rather than on arithmetic.
  have residue : n % 2 = 0 ∨ n % 2 = 1 := by
    by_cases hn : Even n
    · -- Even: write n = k + k and compute the residue directly.
      obtain ⟨k, hk⟩ := hn
      rw [hk]
      omega
    · -- Odd: the same, one step further along.
      rw [Nat.not_even_iff_odd] at hn
      -- .mark
      obtain ⟨k, hk⟩ := hn
      rw [hk]
      omega
  -- The four corollaries, in the order the statement lists them.
  -- .mark
  exact ⟨key n, parity n, gap n, residue⟩

/-- Shaped for the rail's ◫ side-by-side layout (best with ¶ reflow on too):
one `refine` spawns three columns of very different heights — a one-liner, a
`ring`, and a branch that SPLITS AGAIN into nested `zero`/`succ` columns — so
the columns read left-to-right in source order with their case badges on top. -/
theorem three_column_demo (n : ℕ) :
    0 < n + 1 ∧ (n + 1) * (n + 1) = n * n + 2 * n + 1 ∧ ∃ k, n * (n + 1) = 2 * k := by
  refine ⟨?_, ?_, ?_⟩
  · -- A one-step column.
    exact Nat.succ_pos n
  · -- A little algebra.
    ring
  · -- This column splits again: nested columns of unequal height.
    induction n with
    | zero => exact ⟨0, rfl⟩
    | succ m ih =>
      obtain ⟨k, hk⟩ := ih
      refine ⟨k + m + 1, ?_⟩
      show (m + 1) * (m + 2) = 2 * (k + m + 1)
      have h : (m + 1) * (m + 2) = m * (m + 1) + 2 * (m + 1) := by ring
      grind only

/-- **A `calc`-mode workout.** Three chained computations, contrived on purpose:
the shapes are the point. A `calc` block reaches the tree as ONE tactic node —
labelled with its first line, like `induction … with` — whose links arrive as
SPAWNED goals, so the chain fans out sideways rather than running down the trunk,
and each link's `by` justification hangs under the goal it proves.

The links deliberately mix relations (`=` with `≤`, `<` with `≤`), so the chains
lean on `Trans` rather than one relation throughout. Chain 2's first link is
justified by a TERM rather than a tactic, which is worth seeing in the tree: it
spawns no goal at all, so a three-link chain draws two branches. Chains 1 and 3
each end on a link written `_ ≤ _` — both endpoints left for Lean to unify
against the goal, the same shape the tree's own calc gestures write — so the
link's goal is readable only in the tree (chain 3 keeps the spelled-out
version in a comment for comparison). -/
theorem calc_workout (a b : ℝ) (n : ℕ) :
    (a + b) ^ 2 ≤ 2 * (a ^ 2 + b ^ 2)
      ∧ (∑ i ∈ Finset.range (n + 1), (2 * i + 1)) = (n + 1) ^ 2
      ∧ (0 : ℝ) < (a - b) ^ 2 + 1 := by
  refine ⟨?_, ?_, ?_⟩
  · -- Chain 1: rewrite to expose the square that has to be discarded, drop it,
    -- then tidy up. The middle link is the only inequality.
    have hsq : (0 : ℝ) ≤ (a - b) ^ 2 := sq_nonneg _
    calc
      (a + b) ^ 2
      = 2 * (a ^ 2 + b ^ 2) - (a - b) ^ 2 := by ring
      _ ≤ _ := by linarith
  · -- Chain 2: the odd-sum identity again, this time as a calc chain inside the
    -- successor case of an induction — a calc nested under a case split.
    induction n with
    | zero => simp
    | succ k ih =>
      calc
        (∑ i ∈ Finset.range (k + 1 + 1), (2 * i + 1)) = (∑ i ∈ Finset.range (k + 1), (2 * i + 1)) + (2 * (k + 1) + 1) := Finset.sum_range_succ (fun i => 2 * i + 1) (k + 1)
        _ = (k + 1) ^ 2 + (2 * (k + 1) + 1) := by rw [ih]
        _ = _ := by ring
  · calc
      (0 : ℝ) < 1 := by norm_num
      _ ≤ _ := by linarith [sq_nonneg (a-b)]
      -- _ ≤ (a - b) ^ 2 + 1 := by linarith [sq_nonneg (a-b)]


/-- **√2 is irrational, over ℤ.** No coprime integers `m, n` satisfy
`m * m = 2 * n * n`. This is the Nuprl `root_2_irrat_over_int` translated step
for step: assert `2 ∣ m`, then `2 ∣ n`, then read off `2 ∼ 1` from coprimality,
which is absurd. -/
theorem root_2_irrat_over_int :
    ¬ ∃ m n : ℤ, IsCoprime m n ∧ m * m = 2 * n * n := by
  -- D 0 THENM ExRepD: destruct the existential and split its conjunction, so
  -- m, n, the coprimality witness and the equation are all in context.
  rintro ⟨m, n, hcop, hmn⟩
  -- Assert ⌜2 ∣ m⌝: m * m = 2 * n * n is even, and 2 is prime, so m is even.
  have hm : (2 : ℤ) ∣ m := by
    -- This is a comment on have
    have hmm : m * m = 2 * (n * n) := by linear_combination hmn
    rcases Int.prime_two.dvd_or_dvd (⟨n * n, hmm⟩ : (2 : ℤ) ∣ m * m) with h | h <;>
      exact h
  -- Assert ⌜2 ∣ n⌝: write m = 2 * c, so 2 * n * n = 4 * c * c, hence n * n is
  -- even too, and again primality of 2 gives 2 ∣ n.
  have hn : (2 : ℤ) ∣ n := by
    obtain ⟨c, rfl⟩ := hm
    have hnn : n * n = 2 * (c * c) :=
      mul_left_cancel₀ two_ne_zero (by linear_combination -hmn)
    rcases Int.prime_two.dvd_or_dvd (⟨c * c, hnn⟩ : (2 : ℤ) ∣ n * n) with h | h <;>
      exact h
  -- coprime_elim: a common divisor of coprime m, n is a unit — so 2 ∼ 1.
  have h2 : IsUnit (2 : ℤ) := hcop.isUnit_of_dvd' hm hn
  -- assoced_elim: but the only units of ℤ are ±1, so 2 ∼ 1 is a contradiction.
  rw [Int.isUnit_iff] at h2
  omega

/-- **A still-open metavariable.** `Nat.le_trans`' midpoint is determined by
neither the goal nor a `sorry`, so `?m` survives to the end of the command —
and this is what that costs: `apply` promotes the undetermined midpoint to a
goal of its OWN (`⊢ Nat`, tagged `m`), which the tree draws as a pending node
next to two goals that mention `?m` and say nothing about where it came from.

It cannot be written any other way. Lean refuses to finish a command with an
unassigned natural metavariable, so this state is an `unsolved goals` ERROR,
never a `sorry` warning — which is why it lives here and not in `proofs/`. -/


theorem add_comm_zero (n : ℕ) : n + 0 = 0 + n := by
  induction n with
  | zero =>
    rfl
  | succ k ih =>
    rw [Nat.add_zero] at ih ⊢
    rw [Nat.zero_add]
