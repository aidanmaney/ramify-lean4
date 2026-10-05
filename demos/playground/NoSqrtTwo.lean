/-!
# No square root of 2 mod 5

`x * x ≠ 2` for every `x` in `Fin 5`: there are five cases, so `decide`
checks them all. Introduce `x` first and `decide` has a variable it cannot
evaluate.
-/
-- @try revert x
-- @try exact fun x => by decide
theorem no_sqrt_two_mod_five : ∀ x : Fin 5, x * x ≠ 2 := by
  decide
