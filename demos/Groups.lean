import Mathlib

/-!
# A first taste of group theory

Two short computations from the axioms of a group, each a single chain of
equalities — the shape most algebra proofs take. In the tree a `calc` draws as
a ledger: one row per step, each with the fact that justifies it.
-/

variable {G : Type*} [Group G]

/-- **Inverses are unique**: a left inverse and a right inverse agree. -/
theorem inverse_unique {a b c : G} (hb : a * b = 1) (hc : c * a = 1) : b = c := by
  calc b = 1 * b := (one_mul b).symm
    _ = (c * a) * b := by rw [hc]
    _ = c * (a * b) := mul_assoc c a b
    _ = c * 1 := by rw [hb]
    _ = c := mul_one c

/-- **If every element squares to 1, the group is abelian.** -/
theorem mul_comm_of_sq_eq_one (h : ∀ x : G, x * x = 1) (a b : G) :
    a * b = b * a := by
  -- Every element is its own inverse.
  have inv_self : ∀ x : G, x⁻¹ = x := fun x => inv_eq_of_mul_eq_one_right (h x)
  -- Invert the product: inverting reverses the order, and changes nothing else.
  calc a * b = (a * b)⁻¹ := (inv_self _).symm
    _ = b⁻¹ * a⁻¹ := mul_inv_rev a b
    _ = b * a := by rw [inv_self, inv_self]
