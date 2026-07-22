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


example
    (P Q R S T U V W X Y : Prop)
    (h1 : P ∧ Q)
    (h2 : R ∨ S)
    (h3 : T ∧ U)
    (h4 : V ∨ W)
    (h5 : X ∧ Y) :
    (((P ∧ R) ∨ (Q ∧ S)) ∧ ((T ∧ V) ∨ (U ∧ W))) ∨
    (((P ∧ S) ∨ (Q ∧ R)) ∧ ((T ∧ W) ∨ (U ∧ V))) := by

  cases h1 with
  | intro hp hq =>
    cases h3 with
    | intro ht hu =>
      cases h5 with
      | intro hx hy =>

        cases h2 with

        | inl hr =>

          cases h4 with

          | inl hv =>
            left
            constructor

            · left
              constructor
              · exact hp
              · exact hr

            · left
              constructor
              · exact ht
              · exact hv

          | inr hw =>
            right
            constructor

            · right
              constructor
              · exact hq
              · exact hr

            · left
              constructor
              · exact ht
              · exact hw

        | inr hs =>

          cases h4 with

          | inl hv =>
            right
            constructor

            · left
              constructor
              · exact hp
              · exact hs

            · right
              constructor
              · exact hu
              · exact hv

          | inr hw =>
            left
            constructor

            · right
              constructor
              · exact hq
              · exact hs

            · right
              constructor
              · exact hu
              · exact hw
