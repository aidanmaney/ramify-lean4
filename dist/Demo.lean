import Ramify

/-!
# Ramify — try it here

This file is the smallest thing that shows the widget working, and it lives in
the INSTALLABLE package on purpose: it is core-only, so nothing here needs
Mathlib and `lake build` in this directory is all it takes.

Open it in VS Code with the Lean 4 extension, put your cursor inside any proof
below, and the tree appears in the infoview panel. It follows the cursor.

Things to try, roughly in order. A few of them reach back OUT into the editor,
which the infoview gives a widget no way to do on its own — those are marked
`[companion]` and need the VS Code extension (see INSTALL.md). Everything
else, every edit included, works with the Lean package alone.

* **Move the cursor** between tactics — the matching node takes an accent
  outline and the view scrolls to it. Click a tactic node to go the other way
  `[companion]`.
* **Fold** a goal: the `−` at its top-right corner hides the proof below it
  as `+N`, and clicking `+N` brings it back. ⌥-click the rail's `−` / `+`
  (bottom right) to fold or open everything.
* **Double-click a tactic** to edit it in place. Esc cancels, Enter commits
  (⇧Enter adds a line). The edit lands through the editor's own pipeline, so
  ⌘Z undoes it (from the tree too `[companion]`).
* **Hover a box** for its bar: `»` reveal in source `[companion]`, `◎` focus
  this subtree, `◌` skip the step (a break on the line says what went; click
  `+N` to bring it back), `⊹` the path to it, the trash can to delete (it arms
  first — the second click writes; the extent lights up in the buffer
  `[companion]`), and `⋯`, which names every move the box has.
* **The status bar**, along the bottom, is the whole view: `Layout` (outline,
  spine, tracks, wide; side-by-side, gallery, label width), `Context` (which
  hypotheses each goal shows), `Comments`, the eye's reading options (brief
  labels, merge straight runs, …), and `?`, which lists every gesture.
* **The `sorry` in `stub_me` below** is an ordinary editable tactic node —
  double-click it and write the real proof. That is also how the tree's own
  `calc` gestures leave a link they have not proved yet.

For the rest — the frontier chips that write tactics for you, `calc` chains
built from the tree, and Lean's errors drawn on the nodes — open
`ProofTreeTour.lean`, right next to this file. It is core-only too, and it is a
guided walkthrough: six theorems, one cluster of features each, with a
docstring above every one saying what to try.

NOTE: the tour does NOT compile, and that is deliberate. Its last two sections
are left unfinished because the frontier chips and the error ribbon only exist
where a proof is unfinished or broken — a tour of finished proofs could never
show them. The errors there are the exhibit, not a fault in your install.
Neither file is a Lake target, so `lake build` stays green either way.
-/

show_panel_widgets [Ramify]

/-- A short linear proof: goal, tactic, goal, tactic. The plainest shape the
tree draws, and the one to read first. -/
theorem add_zero_eq (a b : Nat) (h : a = b) : a + 0 = b := by
  rw [Nat.add_zero]
  exact h

/-- A case split, so the tree has something to branch. Each branch is a
separate branch under the tactic that opened it; `Layout`'s side-by-side and
gallery rows are about exactly this. -/
theorem le_or_lt (a b : Nat) : a ≤ b ∨ b < a := by
  rcases Nat.lt_or_ge b a with h | h
  · right
    exact h
  · left
    exact h

/-- An induction, whose branches are NAMED — the tree badges each goal with
the case it belongs to. -/
theorem zero_add_eq (n : Nat) : 0 + n = n := by
  induction n with
  | zero => rfl
  | succ k ih =>
    rw [Nat.add_succ, ih]

/-- A `have`, which opens a side proof AND continues the main line. The tree
draws the side proof as a branch and keeps the continuation on the trunk; the
`−` on the side proof's goal puts a finished side proof away. -/
theorem have_demo (a b : Nat) (h : a = b) : a + 0 = b + 0 := by
  have key : a + 0 = a := Nat.add_zero a
  rw [key, Nat.add_zero]
  exact h

/-- A proof left deliberately unfinished. `sorry` is a real tactic node in the
tree: double-click it and write the proof. -/
theorem stub_me (a : Nat) : a + 0 = a := by
  sorry
