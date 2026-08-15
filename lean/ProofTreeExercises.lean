import Ramify

/-!
# Proof-tree widget exercises

Five goals to prove FROM THE TREE — easy, but each needs one real idea before
`omega` can land. Every theorem below is seeded with one honest opening move,
so its remaining goals sit at the live frontier where the tree offers its
dashed chips: `+` to type the next tactic (with completion — the goal's own
hypotheses and subterms lead the list), `sorry` to park a branch, `calc` to
open a chain on a goal that is a relation.

Try to work without touching the buffer: chips to add, double-click to revise,
`⊘` to take back, [↶] to undo. Hints ride the docstrings; full solutions are
in the comment block at the bottom of the file.

Core-only, so it needs no `lake exe cache get`. Unfinished by design, so it
does not compile and is not a Lake target. (Note there is no error pill while
you work — an `unsolved goals` on a goal that already wears chips is the tree
repeating itself, so it is dropped.)
-/

show_panel_widgets [Ramify]

/-! ## 1 · Warm-up

The witness is already chosen — `refine ⟨n, ?_⟩` picked `k := n` — so one
arithmetic tactic on the pending goal finishes it. Click its `+` chip and type
the tactic (hint: three letters, closes any linear goal). -/
theorem ex_double (n : Nat) : ∃ k, n + n = 2 * k := by
  refine ⟨n, ?_⟩

/-! ## 2 · Two goals, two hypotheses

`apply Nat.le_antisymm` split the equality into the two inequalities the
hypotheses already state. Fill each pending goal with an `exact` — open the
`+` chip and start typing `h`: the goal's own hypotheses lead the completion
list, and an exact match commits on Enter. -/
theorem ex_antisymm (a b : Nat) (h1 : a ≤ b) (h2 : b ≤ a) : a = b := by
  apply Nat.le_antisymm

/-! ## 3 · Divisibility is an existential

`3 ∣ n * 3` unfolds to `∃ c, n * 3 = 3 * c`, and the anonymous constructor
went through `refine` the same way as exercise 1 — so what is left is plain
arithmetic. (Typing `⟨` yourself in the editor works too: `\langle`, exactly
as in the buffer.) -/
theorem ex_dvd (n : Nat) : 3 ∣ n * 3 := by
  refine ⟨n, ?_⟩

/-! ## 4 · Open a chain

The pending goal is an equation, so its lane carries the `calc` chip: click
it, give the middle expression (`c + b` — swap the `a` first, commute after),
and the skeleton lands with both endpoints `_` and a `?_` hole per link, each
hole a pending goal with its own chips. The first link is arithmetic on `h`;
the second is exactly the `hc` the seed already proved (`exact hc` through its
`+` chip). Or ignore the chain and land it in one tactic — both are
victories. -/
theorem ex_chain (a b c : Nat) (h : a = b) : c + a = b + c := by
  have hc : c + b = b + c := Nat.add_comm c b

/-! ## 5 · Induction, with one lemma to find

The base case is done and the step is seeded up to the rewrite that unfolds
`2 ^ (k + 1)`. What remains is linear — but `omega` alone can't see it, since
it treats `2 ^ k` as an opaque atom that might be zero. So: `have` its
positivity first (`Nat.two_pow_pos k`, or state `1 ≤ 2 ^ k` and prove it
however you like), then `omega`. Two `+` chips, each inserting on its own
line; note the goal box shows `ih` in its context with a `▸` once your tactic
uses it. -/
theorem ex_pow (n : Nat) : n + 1 ≤ 2 ^ n := by
  induction n with
  | zero => decide
  | succ k ih => rw [Nat.pow_succ]

/-!
## Solutions

```
theorem ex_double (n : Nat) : ∃ k, n + n = 2 * k := by
  refine ⟨n, ?_⟩
  omega

theorem ex_antisymm (a b : Nat) (h1 : a ≤ b) (h2 : b ≤ a) : a = b := by
  apply Nat.le_antisymm
  exact h1
  exact h2

theorem ex_dvd (n : Nat) : 3 ∣ n * 3 := by
  refine ⟨n, ?_⟩
  omega

theorem ex_chain (a b c : Nat) (h : a = b) : c + a = b + c := by
  have hc : c + b = b + c := Nat.add_comm c b
  calc c + a
      = c + b := by omega
    _ = b + c := by exact hc

theorem ex_pow (n : Nat) : n + 1 ≤ 2 ^ n := by
  induction n with
  | zero => decide
  | succ k ih =>
    rw [Nat.pow_succ]
    have hpos : 1 ≤ 2 ^ k := Nat.two_pow_pos k
    omega
```
-/
