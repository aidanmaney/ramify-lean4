import Mathlib

/-!
# Generic names over conventional shapes (the D5 fixture)

The corpus's other files are proofs first and fixtures second, and their
authors named every hypothesis well: `hmdvd`, `hle1`, `hpp`, `he`/`ho`. That
is the right way to write Lean and it leaves the rename move nothing to say —
measured, `probe rewrite` offers **no** rename anywhere else in `proofs/`.

So this file is the specimen: three short proofs whose hypotheses carry the
anonymous names a reader actually meets (`h`, `h2`) over types Mathlib has a
settled name for. Each theorem is true and kernel-checked; the names are the
only thing wrong with them.

* `dvd_le_of_generic` — `h : p ∣ n` (→ `hpn`) and `h2 : 0 < n` (→ `hn`) bound
  by ONE `intro` and named by ONE later step: two hypotheses at one source
  position, which is the case `usesEach` exists for.
* `lt_succ_of_generic` — `h : a < b` (→ `hab`), one binder and one use.
* `sub_pos_of_generic` — `h : b < a` (→ `hba`) used by a step that names it
  and by an `omega` that does not, which is what makes the rename's edit count
  smaller than its use count.
-/

theorem dvd_le_of_generic (p n : ℕ) : p ∣ n → 0 < n → p ≤ n := by
  intro h h2
  exact Nat.le_of_dvd h2 h

theorem lt_succ_of_generic (a b : ℕ) : a < b → a < b + 1 := by
  intro h
  exact Nat.lt_succ_of_lt h

theorem sub_pos_of_generic (a b : ℕ) : b < a → 0 < a - b := by
  intro h
  have hlt : b ≤ a := Nat.le_of_lt h
  omega
