import Ramify
/-!
# Name the cases — the live fixture (`probe lsp … --namecases`)

Splits written WITHOUT alternatives, as a learner writes them: the cases' new
hypotheses are inaccessible (`h✝`, `n✝`, `a✝`). The Quick Fix rewrites each
split into `… with | tag names => sorry` (web/src/nameCases.ts) and
`ProofTree.checkRewrite` must call that BENIGN. Deliberately unfinished:
every theorem ends at its split, so each reports unsolved goals.
-/

theorem namecases_or (p q : Prop) (h : p ∨ q) : q ∨ p := by
  cases h

theorem namecases_and (p q : Prop) (h : p ∧ q) : q ∧ p := by
  cases h

theorem namecases_induction (n : Nat) : 0 + n = n := by
  induction n

theorem namecases_list (xs : List Nat) : xs ++ [] = xs := by
  induction xs
