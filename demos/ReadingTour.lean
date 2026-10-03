import Mathlib

/-!
# How to read a Ramify tree

A short tour of the reading controls, one theorem per idea. Blue boxes are
goals — what is left to prove, with what you may assume listed above the `⊢`
line. Green boxes are tactics — the steps that turn one goal into the next.
Read from the top down.

On this page the source is on the left: click any line there and the tree
follows it, and click a tactic box to find it in the source.
-/

/-! ## 1 · Reading a proof

* A step that splits a goal opens BRANCHES, one per case; each branch's goal
  wears its case name as a small badge (`inl h`, `inr h`).
* Comments in the source ride the step they annotate.
* Hover any identifier or subterm — `Nat.le_total`, `h`, `≤` — for its type
  and documentation.
* The `▸` gutter marks the hypotheses the next step actually uses.
* A numbered tab on a box is a MARK: a stop on a guided reading the author
  wrote into the source. Press `>` and `<` to step through the marks; the
  status bar counts them. This proof has one; the Schröder–Bernstein showcase
  has six, taken in the order you would explain the argument. -/
theorem tour_reading (n m : ℕ) : n ≤ m ∨ m ≤ n := by
  -- .mark The split is the whole proof: `Nat.le_total` hands back one of two
  -- cases, and each branch closes with the hypothesis it was given.
  rcases Nat.le_total n m with h | h
  · left
    exact h
  · right
    exact h

/-! ## 2 · Reshaping the view

The status bar along the bottom holds the reading controls:

* **Layout** — `outline`, `spine`, `tracks` or `wide`.
* **Context** — which hypotheses each goal shows: `used` (only those the rest
  of the proof uses), `intro`, `diff` or `all`.
* **Comments** — show them, hide them, put the prose in place of the tactic,
  or `narrate`: a generated sentence for every step (marked `∴`).
* **Reading** — `brief` shortens boilerplate to `…`; `merge` stacks a
  straight run of tactics into one box.

Hover a box for its bar: `◌` skips a step (the line keeps a break naming what
went), `◎` focuses a subtree, `⊹` draws the path to it. The `−` at a goal's
corner folds everything below it into `+N`. Some folds come from the source
itself: the `-- .fold` comment below starts the `succ` case folded. -/
theorem tour_reshaping (n : ℕ) : n + 0 = 0 + n := by
  induction n with
  | zero => rfl
  | succ k ih =>
    -- .fold The successor case: one rewrite each side.
    have h : k + 0 = 0 + k := ih
    rw [Nat.add_zero, Nat.zero_add]

/-! ## 3 · Chains of equalities

A `calc` block draws as a LEDGER — one row per step of the chain, each with
the justification beside it. Click a row to see the goal that step proved. -/
theorem tour_calc (a b c : ℕ) : (a + b) + c = c + (b + a) := by
  calc (a + b) + c = a + (b + c) := by rw [Nat.add_assoc]
    _ = a + (c + b) := by rw [Nat.add_comm b c]
    _ = (c + b) + a := by rw [Nat.add_comm]
    _ = c + (b + a) := by rw [Nat.add_assoc]

/-! ## 4 · When a proof goes wrong

This one is broken on purpose. The failing step carries a thick red edge;
hover it for Lean's message. The status bar counts the problems, and the strip
above it shows the message — `‹ ›` steps between several. In VS Code, where
the tree is live, you would fix it right there in the tree. -/
theorem tour_errors (a b : ℕ) : a + b = b + a := by
  have hmul : a * b = b * a := by exact Nat.add_comm a b
  exact Nat.add_comm a b
