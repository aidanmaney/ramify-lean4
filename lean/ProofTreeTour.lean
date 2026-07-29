import ProofTreeWidget

/-!
# Proof-tree widget tour

A guided walk through the widget, one theorem per feature cluster, ordered so
each gesture builds on the last. Open this file in VS Code in *this* Lake
project (build first: `cd web && npm run build:widget`, then
`cd ../lean && lake build ProofTreeWidget`), put the cursor inside a proof, and
follow the docstring above it.

Core-only, so it needs no `lake exe cache get`. The LAST two sections are left
deliberately unfinished — the frontier chips and the error ribbon are features,
and a tour of finished proofs could never show them — so this file does not
compile, on purpose, and is not a Lake target.

The controls live on the icon rail at the top right; every button has a
tooltip. Words in brackets below name the buttons by their glyphs.
-/

show_panel_widgets [ProofTreeWidget]

/-! ## 1 · Reading a proof

Blue boxes are GOALS, their hypotheses stacked above the `⊢` line exactly as
the infoview prints them; green boxes are TACTICS. Try, in order:

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
* Hover any identifier in a label — `Nat.le_total`, an `h`, even the `rcases`
  keyword — for the editor's own type/doc popup. -/
theorem tour_reading (n m : Nat) : n ≤ m ∨ m ≤ n := by
  -- totality gives the split; each side is its own branch below
  rcases Nat.le_total n m with h | h
  · left
    exact h
  · right
    exact h

/-! ## 2 · Reshaping the view

An induction (two named cases) followed by a straight run — the shapes the
layout gestures exist for:

* [❮❯] **gallery**: one branch at a time, paged by the `‹ n/m ›` pager under
  the split. Move the cursor into the hidden case in the buffer and the
  gallery pages to it by itself.
* [◫] **side-by-side**: branches as columns instead of a stack. Pairs with
  [¶] reflow, which wraps labels at a narrower column so the columns fit.
* [⇉] **combine**: merge each straight run of tactics into one stacked node —
  the `have`/`rw` run in the `succ` case becomes a single box that keeps every
  token's colour and hover popup.
* [⋯] **brief**: collapse boilerplate inside labels to `…` — hover a `…` to
  peek at what it hides.
* [⇝] linearize a path; [⇥]/[⇳] elide a run or a vertical band: pick two
  nodes and the stretch between them folds to one marker (click to restore). -/
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
  colouring while you type, expands unicode the way the buffer does
  (`\dvd` → `∣`, `\ne` → `≠`), and completes from what is already on screen —
  the goal's own hypotheses and subterms lead the list, every imported tactic
  name behind them.
* The hover bar on a tactic carries [⧉] — the LENS: a slim real-editor pane
  under the infoview, the tactic selected, every line annotated with the goal
  state after it (`⊢ …`, or `∎` where the line closes its goals).
* [⊘] on the bar ARMS a delete: the extent lights up in the buffer, every
  node it would remove dims in the tree, and a second click on the count
  confirms. On a goal it clears the whole sub-proof, returning the goal to
  the frontier of section 5. -/
theorem tour_editing (a b : Nat) (h : a ∣ b) (_hb : b ≠ 0) : a ∣ b * b := by
  have hbb : b ∣ b * b := Nat.dvd_mul_right b b
  exact Nat.dvd_trans h hbb

/-! ## 4 · `calc` chains

A chain draws as a COLUMN of links hanging off one `calc` node. Turn on [⋯]
brief mode here: the calc's label collapses to `calc …`, because everything
after the keyword is already drawn by the tree — and each later link elides
its left-hand side to `_`, exactly as the source writes it, since that text is
the box above it. A `:= by` justification is a real tactic node under its
link; a term justification (`Nat.add_comm …`) is part of the link itself. -/
theorem tour_calc (a b c : Nat) : (a + b) + c = c + (b + a) := by
  calc (a + b) + c
      = (b + a) + c := by rw [Nat.add_comm a b]
    _ = c + (b + a) := Nat.add_comm (b + a) c

/-! ## 5 · The live frontier (unfinished on purpose, from here down)

`constructor` splits the goal and nothing answers either half yet, so both
goals grow dashed CHIPS under their boxes — the tactic that isn't there:

* `+` opens the in-place editor to type it (`omega` closes either goal — type
  `om`, Enter twice: exact-match completions commit on Enter).
* `sorry` parks a branch in one click, so the rest keeps elaborating.
* `calc` opens a chain on a goal that is a relation: it asks only for the
  first intermediate expression and writes a two-link skeleton whose free
  ends are `_`, so nothing pretty-printed has to round-trip into source.
  Fill a link's `?_` with its own `+` chip, or insert a link above it with
  `step`.

Note the `unsolved goals` error does NOT show in the pill here: the chips are
already saying it, louder. -/
theorem tour_frontier (n : Nat) : 0 < n + 1 ∧ n + 0 = n := by
  constructor

/-! ## 6 · When it goes wrong

The first tactic below fails, and failure is DRAWN, not hidden: the failed
`rw` stands as a dashed box in error ink (Lean rolls the attempt back — the
widget's supplemental parser puts it back), the `exact` after it as a dashed
ghost that never ran, and the error rides the node as a thick cap on its left
edge with the full message in the tooltip. The pill at the top left counts
every problem in the proof; `‹ ›` walks them, unfolding and scrolling to each,
and clicking the message jumps back to the one showing.

To fix it, use section 3's gestures on the broken node itself: arm [⊘] on the
dashed `rw` and confirm — the `exact Nat.add_comm a b` below it already
closes the goal — or double-click it and type the rewrite you meant. -/
theorem tour_errors (a b : Nat) : a + b = b + a := by
  rw [Nat.succ_ne_zero]
  exact Nat.add_comm a b
