import Mathlib

/-!
# Euclid's theorem: there are infinitely many primes.

A single, self-contained proof that for every `N` there is a prime exceeding `N`.
It inlines two ideas as nested sub-proofs, so the whole argument renders as one
large proof tree:

1. **Every `n ≥ 2` has a prime divisor** — by strong induction (a prime divides
   itself; a composite has a proper divisor `m`, and a prime dividing `m` divides
   `n` by transitivity).
2. **Euclid's trick** — a prime factor `p` of `N! + 1` must exceed `N`, since
   otherwise `p ∣ N!` and `p ∣ N! + 1`, hence `p ∣ 1`, which no prime does.

Kernel-checked; `#print axioms` at the bottom confirms no `sorry`.
-/

theorem infinitude_of_primes (N : ℕ) : ∃ p, Nat.Prime p ∧ N < p := by
  -- Step 1: every n ≥ 2 is divisible by some prime (strong induction on n).
  have exists_prime_dvd : ∀ n : ℕ, 2 ≤ n → ∃ p, Nat.Prime p ∧ p ∣ n := by
    intro n
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
  omega

#print axioms infinitude_of_primes
