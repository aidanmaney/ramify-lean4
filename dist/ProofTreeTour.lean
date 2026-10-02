import Ramify
import Init.Data.Nat.Basic

show_panel_widgets [Ramify]

/-! ## 1 · Reading a proof

Blue boxes are goals, their hypotheses stacked above the `⊢` line exactly as
the infoview prints them; green boxes are tactics. Try, in order:

* **Move the cursor** through the tactics below — the matching node lights up
  and the tree scrolls along with you. Click a tactic node to jump back the
  other way; hover one to light its range up in the buffer.
* **The `−` at a goal's top-right corner** folds everything below it into
  `+N`; click `+N` to open it again. ⌥-click the rail's `−` / `+` (bottom
  right) to fold or open every branch at once.
* The two branch goals wear their case names (`inl`, `inr`) as small badges,
  and this proof's source comments ride the nodes they annotate.
* **The status bar** along the bottom holds the reading controls. `Context`
  picks which hypotheses each goal shows: `used` (only those the proof below
  uses), `intro`, `diff`, or `all`. The `▸` gutter marks the ones the next
  tactic uses. `?` lists every gesture.
* Hover any identifier in a label, e.g. `Nat.le_total`, `h`, `rcases`, for
  type/doc popups.
-/
theorem tour_reading (n m : Nat) : n ≤ m ∨ m ≤ n := by
  -- .mark The split is the whole proof. `Nat.le_total` hands back one of two
  -- cases, and each branch closes with the hypothesis it was given.
  -- (A `.mark` flag makes this a source MARK: the status bar's Marks item
  -- counts it, and `<` / `>` walk the marks in order.)
  rcases Nat.le_total n m with h | h
  · left
    exact h
  · right
    exact h

/-! ## 2 · Reshaping the view

An induction proof with two named cases followed by a straight run, to try
the view controls on:

* **Layout** (status bar): `outline`, `spine`, `tracks` or `wide`, plus
  **side-by-side** (branches as columns), **gallery** (one branch at a time,
  paged; move the cursor into the hidden case and it pages there by itself)
  and a width slider that wraps labels narrower.
* **The eye** (reading options): **merge** turns each straight run of tactics
  into one stacked box (the `have`/`rw` run in the `succ` case), and **brief**
  shortens boilerplate inside labels to `…` (hover to see what it hides).
* **Hover a box** for its bar: `◌` skips a step (the line keeps a break naming
  what went), `◎` focuses a subtree, `⊹` draws the path to it, and `⋯` names
  every move the box has. Drag across the background to select a stretch and
  put it away in one go. -/
theorem tour_reshaping (n : Nat) : n + 0 = 0 + n := by
  induction n with
  | zero => rfl
  | succ k ih =>
    have h : k + 0 = 0 + k := ih
    rw [Nat.add_zero, Nat.zero_add]

/-! ## 3 · Editing from the tree

Every write goes through the editor's own pipeline, so ⌘Z undoes it like any
other edit:

* **Double-click** a tactic to edit it in place. The overlay keeps its syntax
  colouring while you type and expands unicode the way this buffer does, i.e.
  `\dvd` → `∣`, `\ne` → `≠`, and completes from what is already here:
  hypotheses, subterms, global constants/tactics.
* A tactic's `⋯` menu carries `⧉`, the lens: a slim pane under the
  infoview that annotates lines with the goal state after tactics run, i.e.
  `⊢ …`, or `∎` where the line closes its goals.
* The trash can on the bar arms a delete: the extent lights up in the buffer, every
  node it would remove dims in the tree, and a second click on the count
  confirms. On a goal it clears the whole sub-proof, returning the goal to
  the frontier (see below). -/
theorem tour_editing (a b : Nat) (h : a ∣ b) (hb : b ≠ 0) : a ∣ b * b ∧ 0 < b := by
  have hbb : b ∣ b * b := Nat.dvd_mul_right b b
  have hab : a ∣ b * b := Nat.dvd_trans h hbb
  have hpos : 0 < b := Nat.pos_of_ne_zero hb
  exact ⟨hab, hpos⟩

/-! ## 4 · `calc` chains

* Tactics and intermediate goals are stacked in the tree.
  Try commenting out a step here and then adding it back via the tree.
  Note: a `rw`'s implicit `rfl` starts folded — click its `+N` to see it. -/
theorem tour_calc (a b c : Nat) : (a + b) + c = c + (b + a) := by
  calc
    (a + b) + c = a + (b + c) := by rw [Nat.add_assoc a b c]
    _ = a + (c + b) := by rw [Nat.add_comm b c]
    _ = (c + b) + a := by rw [Nat.add_comm a (c + b)]
    _ = c + (b + a) := by rw [Nat.add_assoc c b a]

/-! ## 5 · The live frontier (unfinished on purpose, from here down)

`constructor` splits the goal into two unfinished ones, with dashed chips for
the missing tactics:

* `+` opens the in-place editor (`omega` closes either goal: type `om`, then
  enter twice).
* `sorry` stubs a branch so the rest can elaborate.
* `calc` opens a chain on a goal that is a relation (uses the `Trans`
  typeclass). -/
theorem tour_frontier (n : Nat) : 0 < n + 1 ∧ n + 0 = n := by
  constructor

/-! ## 6 · Errors

The first two tactics below fail and are shown in the tree.
The `exact` tactic doesn't get to run but is shown as a dashed ghost.
The error rides the node as a thick cap on the left edge: hover to see the
message. The status bar counts the problems in the proof; errors also open a
strip above it with the message, and `‹ ›` moves between them.

To fix it, delete the dashed `rw` (the trash can), or double-click it and write
what you meant. -/
theorem tour_errors (a b : Nat) : a + b = b + a := by
  have hmul : a * b = b * a := by exact Nat.add_comm a b
  rw [Nat.succ_ne_zero]
  exact Nat.add_comm a b
