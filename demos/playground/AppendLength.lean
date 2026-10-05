/-!
# The length of an append

Induction on a list: one case for the empty list, one for `x :: xs`, with the
hypothesis about `xs` in hand. `simp` knows the whole fact already.
-/
-- @try simp [ih]
-- @try simp_all
-- @try omega
-- @try rfl
theorem length_append_nat : ∀ xs ys : List Nat, (xs ++ ys).length = xs.length + ys.length := by
  intro xs ys
  induction xs
  · simp
  · simp
    omega
