import ProofTreeWidget

/-!
# Proof-tree goals — Natural Number Game difficulty

Six statements to prove, in rising order, each within reach of the tactics the
Natural Number Game teaches: `rfl`, `rw`, `induction`, `intro`, `exact`,
`apply`, `cases`. No solutions in this file — the goal is the exercise.

Every proof is a lone `sorry`, so the tree draws the root goal with the stub
under it. **Double-click the `sorry` node and type your first tactic over it**
(the overlay completes tactic names and the goal's own subterms, and expands
unicode like the buffer — `\l` for `←` in a rewrite). After it commits, any
goals your tactic leaves open sit at the frontier with dashed chips: `+` to
type the next step, `sorry` to park a branch, `calc` on a goal that is a
relation. The docstring on each theorem names the NNG world it echoes and at
most the SHAPE of the idea — not the proof.

You may use core lemmas by name (`Nat.succ_add`, `Nat.mul_succ`, …) the way
later NNG levels let you use earlier ones; the completion list in the editing
overlay will offer what you start typing. Core-only, so no `lake exe cache
get`. Compiles (every `sorry` is honest), so the only pill is the `sorry`
warning each stub earns.
-/

show_panel_widgets [ProofTreeWidget]

/-! ## 1 · Addition world: the one that needs induction

`n + 0 = n` is definitional, but `0 + n` is not — addition recurses on its
RIGHT argument, so this direction needs `induction`. Two cases; the step case
is one rewrite with the hypothesis the induction gave you. -/
theorem goal_zero_add (n : Nat) : 0 + n = n := by
  sorry

/-! ## 2 · Multiplication world: a rewrite chain

Unfold `* 1` once (`Nat.mul_succ`, since `1 = 0 + 1` by definition), then tidy
what remains with the multiplication and addition base lemmas. Three rewrites,
no induction. -/
theorem goal_mul_one (n : Nat) : n * 1 = n := by
  sorry

/-! ## 3 · Addition world, boss level: commutativity

Induct on one side; both cases are rewrites. The step case wants the lemma
about `succ` on the LEFT of a `+` (`Nat.succ_add`) — the mirror of the
definitional one. -/
theorem goal_add_comm (n m : Nat) : n + m = m + n := by
  sorry

/-! ## 4 · Implication world: an impossible hypothesis

`≠` unfolds to an implication, so it opens with `intro`. What you then hold is
a proof of something no constructor can build — `cases` on it closes the
goal with no cases at all. -/
theorem goal_succ_ne_zero (n : Nat) : n + 1 ≠ 0 := by
  sorry

/-! ## 5 · Inequality world

`≤` recurses on its right argument too, so induct on `m`: the base case is
reflexivity of `≤`, and the step case extends a `≤` by one (`Nat.le_succ_of_le`
— or build it with `apply` and let the completion list find the name). -/
theorem goal_le_add_right (n m : Nat) : n ≤ n + m := by
  sorry

/-! ## 6 · Multiplication world, boss level: distributivity

Induct on `c`. The base case is two `mul_zero`-shaped rewrites; the step case
is a longer rewrite chain (`mul_succ`, the hypothesis, and associativity of
`+`) — the tree draws each case as its own branch, so park one with its
`sorry` chip while you work the other. -/
theorem goal_mul_add (a b c : Nat) : a * (b + c) = a * b + a * c := by
  sorry
