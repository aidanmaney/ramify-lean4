/-!
# A square has its root's parity

`n * n` and `n` leave the same remainder mod 2. `omega` cannot see it — it
does linear arithmetic, and `n * n` is not linear — so split on the remainder
of `n` and compute.
-/
-- @try rcases Nat.mod_two_eq_zero_or_one n with h | h
-- @try rw [Nat.mul_mod, h]
-- @try rw [Nat.mul_mod]
-- @try simp [Nat.mul_mod, h]
theorem sq_mod_two : ∀ n : Nat, n * n % 2 = n % 2 := by
  intro n
  rcases Nat.mod_two_eq_zero_or_one n with h | h
  · rw [Nat.mul_mod, h]
  · rw [Nat.mul_mod, h]
