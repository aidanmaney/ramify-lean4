import Ramify

show_panel_widgets [Ramify]

/-!
# ProofTreeTerms — term-mode proof fixtures

The Part B corpus: proofs written as TERMS (`:= term`, no top-level `by`),
which Paperproof's parser cannot see at all — its traversal consumes exactly
one of the seventeen `Info` constructors (`ofTacticInfo`), so a term proof
yields `{steps: [], allGoals: ∅}` and both wires drop it.

Core-only and COMPILES (unlike `ProofTreeErrors.lean`), so the offline probes
run it under the documented `lake env lean --run` recipe. Not a Lake target.
Each theorem is named for the v1 construct it exercises.
-/

/-- The degenerate case: a bare term. One exact-like leaf. -/
theorem term_direct : True := trivial

/-- A `have` chain — the term-mode analogue of tactic `have`s: each binding is
a side goal, the continuation carries on. -/
theorem term_have_chain (n : Nat) : n + 0 = n + 0 :=
  have h1 : n + 0 = n := Nat.add_zero n
  have h2 : n = n + 0 := h1.symm
  h1.trans h2

/-- Binders — the term-mode `intro`. -/
theorem term_fun : ∀ (n : Nat), n = n := fun n => rfl

/-- A term-level `calc` — a DIFFERENT syntax kind from the tactic `calc`
(`calcTactic`); P5 identifies it. -/
theorem term_calc (a b : Nat) (h : a = b) : a + 0 = b :=
  calc a + 0 = a := Nat.add_zero a
    _ = b := h

/-- A nested `by` block: BetterParser DOES harvest its steps today, but they
root nowhere — the graft is what hangs them under the term structure. -/
theorem term_nested_by (n : Nat) : n + 0 = n ∧ n = n :=
  ⟨by simp, rfl⟩

/-- `match` — a leaf in v1 (recorded non-goal). -/
theorem term_match (n : Nat) : n = n :=
  match n with
  | 0 => rfl
  | _ + 1 => rfl

/-- `let`, beside `have`. -/
theorem term_let (n : Nat) : n + 0 = n :=
  let m := n
  Nat.add_zero m

-- Theorem provers in education and THEDU; theorem provers and UIs; ITP;
