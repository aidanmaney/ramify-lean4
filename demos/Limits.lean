import Mathlib

/-!
# Limits, ε by ε

Sequences and limits from first principles: the ε–N definition written out,
then the two facts every analysis course proves first. Watch how each proof
is shaped by its quantifiers — an ε is handed in, an N is handed back.
-/

/-- `a` converges to `L`: for every `ε > 0` there is an `N` past which every
term is within `ε` of `L`. -/
def ConvergesTo (a : ℕ → ℝ) (L : ℝ) : Prop :=
  ∀ ε > 0, ∃ N, ∀ n ≥ N, |a n - L| < ε

/-- **The limit of a sum is the sum of the limits.** -/
theorem convergesTo_add {a b : ℕ → ℝ} {L M : ℝ}
    (ha : ConvergesTo a L) (hb : ConvergesTo b M) :
    ConvergesTo (fun n => a n + b n) (L + M) := by
  -- Given `ε`, ask each sequence to come within `ε / 2`.
  intro ε hε
  obtain ⟨N₁, hN₁⟩ := ha (ε / 2) (by linarith)
  obtain ⟨N₂, hN₂⟩ := hb (ε / 2) (by linarith)
  -- Once both have settled down, so has their sum.
  use max N₁ N₂
  intro n hn
  have h₁ := hN₁ n (le_of_max_le_left hn)
  have h₂ := hN₂ n (le_of_max_le_right hn)
  -- The triangle inequality splits the error into the two halves.
  calc |a n + b n - (L + M)| = |(a n - L) + (b n - M)| := by ring_nf
    _ ≤ |a n - L| + |b n - M| := abs_add_le _ _
    _ < ε / 2 + ε / 2 := by linarith
    _ = ε := by ring

/-- **Limits are unique.** -/
theorem convergesTo_unique {a : ℕ → ℝ} {L M : ℝ}
    (hL : ConvergesTo a L) (hM : ConvergesTo a M) : L = M := by
  -- Suppose the two limits differ.
  by_contra hne
  -- Then they are a positive distance apart; take ε to be half of it.
  have hpos : 0 < |L - M| := abs_pos.mpr (sub_ne_zero.mpr hne)
  obtain ⟨N₁, hN₁⟩ := hL (|L - M| / 2) (by linarith)
  obtain ⟨N₂, hN₂⟩ := hM (|L - M| / 2) (by linarith)
  -- Far enough out, one term is within that distance of BOTH limits.
  have h₁ := hN₁ (max N₁ N₂) (le_max_left _ _)
  have h₂ := hN₂ (max N₁ N₂) (le_max_right _ _)
  -- So the distance between them would be less than itself.
  have hlt : |L - M| < |L - M| := by
    calc |L - M| = |(L - a (max N₁ N₂)) + (a (max N₁ N₂) - M)| := by ring_nf
      _ ≤ |L - a (max N₁ N₂)| + |a (max N₁ N₂) - M| := abs_add_le _ _
      _ = |a (max N₁ N₂) - L| + |a (max N₁ N₂) - M| := by rw [abs_sub_comm]
      _ < |L - M| / 2 + |L - M| / 2 := by linarith
      _ = |L - M| := by ring
  exact lt_irrefl _ hlt
