import ProofTreeWidget
import Init.Data.Nat.Basic

show_panel_widgets [ProofTreeWidget]

/-! ## 1 · Reading a proof

Blue boxes are goals, their hypotheses stacked above the `⊢` line exactly as
the infoview prints them; green boxes are tactics. Try, in order:

* **Move the cursor** through the tactics below — the matching node lights up
  and the tree scrolls along with you. Click a tactic node to jump back the
  other way; hover one to light its range up in the buffer.
* **Click a goal box** to fold its subtree; click again to open it.
  [⊞]/[⊟] expand and collapse everything.
* The two branch goals wear their case names (`inl`, `inr`) as small badges,
  and this proof's source comments ride the nodes they annotate.
* Cycle the context breadth with the [Δ] button: Δ what this goal gained,
  ∀ everything in scope, ▸ only what the next tactic uses, ↓ only what the
  previous tactic bound. The `▸` gutter marks the used hypotheses.
* Hover any identifier in a label e.g. `Nat.le_total`, `h`, `rcases` for
  type/doc popups
-/
theorem tour_reading (n m : Nat) : n ≤ m ∨ m ≤ n := by
  -- tree shows the split: each case left/right is its own branch
  rcases Nat.le_total n m with h | h
  · left
    exact h
  · right
    exact h

/-! ## 2 · Reshaping the view

An induction proof with two named cases followed by a straight run to
demonstrate the layout gestures [⑃]:

* [❮❯] **gallery**: one branch at a time, paged by the `‹ n/m ›` pager under
  the split. Move the cursor into the hidden case in the buffer and the
  gallery pages to it by itself.
* [◫] **side-by-side**: branches as columns instead of a stack. Pairs with
  [¶] reflow, which wraps labels at a narrower column so the columns fit.
* [⇉] **combine**: merge each straight run of tactics into one stacked node —
  the `have`/`rw` run in the `succ` case becomes a single box
* [⋯] **brief**: collapse boilerplate inside labels to `…` — hover to
  peek at what it hides.
* [⇝] linearize a path; [⇥]/[⇳] elide a run or a vertical band: pick two
  nodes and the stretch between them folds to a restorable marker -/
theorem tour_reshaping (n : Nat) : n + 0 = 0 + n := by
  induction n with
  | zero => rfl
  | succ k ih =>
    have h : k + 0 = 0 + k := ih
    rw [Nat.add_zero, Nat.zero_add]

/-! ## 3 · Editing from the tree

Every write goes through the editor's own pipeline, so ⌘Z (or the rail's
[↶]/[↷]) undoes it like any other edit:

* **Double-click** a tactic to edit it in place. The overlay keeps its syntax
  colouring while you type and expands unicode the way this buffer does i.e.
  `\dvd` → `∣`, `\ne` → `≠`, and completes from what is already here:
  hypotheses, subterms, global constants/tactics
* The hover bar on a tactic carries [⧉] — the lens: a slim pane under the
  infoview, annotates lines with the goal state after tactics run i.e. `⊢ …`,
  or `∎` where the line closes its goals.
* [⊘] on the bar arms a delete: the extent lights up in the buffer, every
  node it would remove dims in the tree, and a second click on the count
  confirms. On a goal it clears the whole sub-proof, returning the goal to
  the frontier (see below). -/
theorem tour_editing (a b : Nat) (h : a ∣ b) (hb : b ≠ 0) : a ∣ b * b ∧ 0 < b := by
  have hbb : b ∣ b * b := Nat.dvd_mul_right b b
  have hab : a ∣ b * b := Nat.dvd_trans h hbb
  have hpos : 0 < b := Nat.pos_of_ne_zero hb
  exact ⟨hab, hpos⟩

/-! ## 4 · `calc` chains

A chain draws as a column/sequence of links hanging off one `calc` node.
Turn on [⋯] brief mode here: the calc's label collapses to `calc …`, because
everything after the keyword is already drawn by the tree — and each later
link elides its left-hand side to `_`, exactly as the source writes it, since
that text is the box above it. A `:= by` justification is a real tactic node
under its link; a term justification (`Nat.add_comm …`) is part of the link
itself. -/
theorem tour_calc (a b c : Nat) : (a + b) + c = c + (b + a) := by
  calc (a + b) + c = a + (b + c) := Nat.add_assoc a b c
    _ = a + (c + b) := by rw [Nat.add_comm b c]
    _ = (c + b) + a := by rw [Nat.add_comm a (c + b)]
    _ = c + (b + a) := by rw [Nat.add_assoc c b a]

/-! ## 5 · The live frontier (unfinished on purpose, from here down)

`constructor` splits the goal and nothing answers either half yet, so both
goals grow dashed chips under their boxes — the tactic that isn't there:

* `+` opens the in-place editor to type it (`omega` closes either goal — type
  `om` then enter twice)
* `sorry` stubs a branch in one click so the rest can elaborate
* `calc` opens a chain on a goal that is a relation: it asks only for the
  first intermediate expression and writes a two-link skeleton whose free
  ends are `_`

Note the `unsolved goals` error does NOT show in the pill here: the chips are
already saying it, louder. -/
theorem tour_frontier (n : Nat) : 0 < n + 1 ∧ n + 0 = n := by
  constructor

/-! ## 6 · When it goes wrong

The first two tactics below fail and shown in the tree, the `exact` after it
as a dashed ghost that never ran, and the error rides the node as a thick cap
on its left edge with the full message in the tooltip. The pill at the top
left counts every problem in the proof; `‹ ›` walks them, unfolding and
scrolling to each, and clicking the message jumps back to the one showing.

To fix it, use section 3's gestures on the broken node itself: arm [⊘] on the
dashed `rw` and confirm — the `exact Nat.add_comm a b` below it already
closes the goal — or double-click it and type the rewrite you meant. -/
theorem tour_errors (a b : Nat) : a + b = b + a := by
  have hmul : a * b = b * a := by exact Nat.add_comm a b
  rw [Nat.succ_ne_zero]
  exact Nat.add_comm a b
