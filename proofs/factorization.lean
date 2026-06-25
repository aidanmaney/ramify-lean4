import Mathlib

/-!
# Existence of prime factorizations (Fundamental Theorem of Arithmetic, existence half)

Every natural number `n ≥ 2` is a product of primes: there is a list `l` of primes
whose product is `n`. Proved by strong induction:

* if `n` is prime, `[n]` works;
* otherwise `n` has a proper divisor `m` (`2 ≤ m < n`); writing `n = m * k`, both
  `m` and `k` lie in `[2, n)`, so the induction hypothesis factors each, and the
  concatenated list factors `n`.

The inner arithmetic (that the cofactor `k` also satisfies `2 ≤ k < n`) is carried
out explicitly, so this renders as one large branching proof tree. Kernel-checked;
`#print axioms` confirms no `sorry`.
-/

theorem prime_factorization :
    ∀ n : ℕ, 2 ≤ n → ∃ l : List ℕ, (∀ p ∈ l, Nat.Prime p) ∧ l.prod = n := by
  intro n
  induction n using Nat.strong_induction_on with
  | _ n ih =>
    intro hn
    by_cases hp : Nat.Prime n
    · -- n is prime: the singleton list [n].
      refine ⟨[n], ?_, ?_⟩
      · intro p hpm
        rw [List.mem_singleton] at hpm
        subst hpm
        exact hp
      · simp
    · -- n is composite: split off a proper divisor m, factor m and the cofactor k.
      obtain ⟨m, hmdvd, hm2, hmlt⟩ := Nat.exists_dvd_of_not_prime2 hn hp
      obtain ⟨k, hk⟩ := hmdvd          -- hk : n = m * k
      -- The cofactor k satisfies 2 ≤ k < n.
      have hk0 : k ≠ 0 := by
        rintro rfl
        simp at hk
        omega
      have hk1 : k ≠ 1 := by
        rintro rfl
        simp at hk
        omega
      have hk2 : 2 ≤ k := by omega
      have hkn : k < n := by
        have hmk : 2 * k ≤ m * k := Nat.mul_le_mul hm2 (Nat.le_refl k)
        omega
      -- Recurse on both factors and concatenate the resulting prime lists.
      obtain ⟨l₁, hl₁p, hl₁prod⟩ := ih m hmlt hm2
      obtain ⟨l₂, hl₂p, hl₂prod⟩ := ih k hkn hk2
      refine ⟨l₁ ++ l₂, ?_, ?_⟩
      · intro p hpm
        rcases List.mem_append.mp hpm with h | h
        · exact hl₁p p h
        · exact hl₂p p h
      · rw [List.prod_append, hl₁prod, hl₂prod, ← hk]

#print axioms prime_factorization
