import ProofTreeWidget
import Mathlib

/-!
# Proof-tree widget scratchpad (Mathlib proofs)

The Mathlib counterpart of `ProofTreeDemo.lean` (which stays deliberately
core-only so it opens instantly): open this file in VS Code to view any of the
`proofs/*.lean` samples in the widget — they are CLI inputs outside this Lake
project, so the widget can't attach to them directly. Paste a sample's theorem
below (they all just `import Mathlib`) and put the cursor inside its proof.

Elaborating this file needs Mathlib's prebuilt oleans on disk. They are a
build-dep fetched by `lake exe cache get` — re-run it after any `lake clean`,
which deletes them (letting the editor rebuild Mathlib from source instead
takes hours).

`proofs/euclid.lean` is inlined below as a starting point.
-/

show_panel_widgets [ProofTreeWidget]

theorem infinitude_of_primes (N : ℕ) : ∃ p, Nat.Prime p ∧ N < p := by
  -- Step 1: every n ≥ 2 is divisible by some prime (strong induction on n).
  have exists_prime_dvd : ∀ n : ℕ, 2 ≤ n → ∃ p, Nat.Prime p ∧ p ∣ n := by
    intro (n : ℕ)
    induction n using Nat.strong_induction_on with
    | _ n ih =>
      intro hn
      by_cases hp : Nat.Prime n
      · -- n itself is prime.
        exact ⟨n, hp, dvd_refl n⟩
      · -- n is composite: peel off a proper divisor m, recurse on it.
        obtain ⟨m, hmdvd, hm2, hmlt⟩ := Nat.exists_dvd_of_not_prime2 hn hp
        obtain ⟨p, hpp, hpm⟩ := ih m hmlt hm2
        exact ⟨p, hpp, hpm.trans hmdvd⟩
  -- Step 2: apply it to N! + 1, which is ≥ 2.
  have hM : 2 ≤ Nat.factorial N + 1 := by
    have hpos := Nat.factorial_pos N
    omega
  obtain ⟨p, hp, hpdvd⟩ := exists_prime_dvd (Nat.factorial N + 1) hM
  refine ⟨p, hp, ?_⟩
  -- Step 3: show N < p by contradiction.
  by_contra hle
  push_neg at hle
  -- If p ≤ N then p divides N!, and it already divides N! + 1.
  have hpfac : p ∣ Nat.factorial N := Nat.dvd_factorial hp.pos hle
  -- p ∣ N! and p ∣ N! + 1, so p ∣ 1.
  have hp1 : p ∣ 1 := (Nat.dvd_add_right hpfac).mp hpdvd
  -- But a prime is ≥ 2 and cannot divide 1.
  have hle1 : p ≤ 1 := Nat.le_of_dvd one_pos hp1
  have h2 : 2 ≤ p := hp.two_le
  grind


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
      -- The empty sum is 0, and 0 ^ 2 = 0.
      simp
    | succ k ih =>
      -- Peel the last summand off the range, fold in the hypothesis, and let
      -- `ring` finish the binomial.
      rw [Finset.sum_range_succ, ih, add_comm]
      ring
  -- Step 2: the gap between consecutive partial sums is the next odd number.
  have gap : ∀ m : ℕ,
      (∑ i ∈ Finset.range (m + 1), (2 * i + 1))
        = (∑ i ∈ Finset.range m, (2 * i + 1)) + (2 * m + 1) := by
    intro m
    exact Finset.sum_range_succ (fun i => 2 * i + 1) m
  -- Step 3: parity survives squaring in both directions. This is the one part
  -- that really splits: forward is a construction, backward a case analysis on
  -- the parity of m.
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
        have hodd : Odd (m ^ 2) := by
          refine ⟨2 * j * j + 2 * j, ?_⟩
          rw [hj]
          ring
        exact (Nat.not_even_iff_odd.mpr hodd) hsq
  -- Step 4: the residue, by splitting on evenness rather than on arithmetic.
  have residue : n % 2 = 0 ∨ n % 2 = 1 := by
    by_cases hn : Even n
    · -- Even: write n = k + k and compute the residue directly.
      left
      obtain ⟨k, hk⟩ := hn
      rw [hk]
      omega
    · -- Odd: the same, one step further along.
      right
      rw [Nat.not_even_iff_odd] at hn
      obtain ⟨k, hk⟩ := hn
      rw [hk]
      omega
  -- The four corollaries, in the order the statement lists them.
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
      grind
