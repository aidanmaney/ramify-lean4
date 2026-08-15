import Ramify

/-!
# Proof-tree widget demo — Lean's diagnostics, drawn on the tree

Open this file in VS Code with the Lean 4 extension, in *this* Lake project so
`Ramify` is on the import path. Build the renderer bundle first:

```bash
cd web && npm run build:widget
cd ../lean && lake build Ramify
```

**This file does not compile, on purpose** — every theorem below is broken in a
different way, because a diagnostic is the thing being demonstrated. It is
therefore not a Lake target and nothing imports it. Core-only, so it elaborates
without `lake exe cache get`.

## What to look for

Put the cursor inside a theorem and watch the infoview panel:

* a node carrying a problem grows a **ribbon** — a bar down the inside of its
  left edge, red for an error and the editor's warning colour for a warning,
  with that ink repeated on the box's border. Hover the box to read the full
  message in the tooltip;
* the **pill** at the bottom-left names one problem at a time, with a
  `‹ n/m ›` pager when there are several. Stepping *navigates*: it unfolds
  whatever hides the node, pages the gallery to it, and scrolls it into view.
  Clicking the message does the same for the one showing — which is how you get
  back to it after scrolling away.

The ribbon reserves no space: collapse the tree (⊟) and expand it again, or
compare a broken theorem with `diag_clean` at the bottom, and the boxes sit
exactly where they would with nothing wrong. That is deliberate — a proof must
not lay out differently depending on whether it currently elaborates.

Nothing here is a separate request to the server: this is the
`textDocument/publishDiagnostics` payload the widget already receives, which is
why the drawn problems keep step with the buffer as you type.
-/

show_panel_widgets [Ramify]

/-! ## 1 · One problem, one ribbon

The baseline. `exact` names something that does not exist, so the error lands
inside that tactic's own range and the ribbon appears on its node. The pill
reads `1/1`, and clicking its message scrolls straight back here. -/

theorem diag_one (n : Nat) : n + 0 = n := by
  exact Nat.no_such_lemma n

/-! ## 2 · A warning is a different ink — and may belong to no node

`sorry` is a WARNING, not an error, so the pill and any ribbon take
`--ptw-warn` instead of the error red.

It also shows the honest failure mode: Lean reports this one on the
DECLARATION NAME, above every tactic in the proof, so it resolves to no node at
all. The pill still pages it and still shows the message — it just has nowhere
to take you, and says so by not offering the pointer cursor on the message. -/

theorem diag_warning (n : Nat) : n + 0 = n := by
  sorry

/-! ## 3 · Several problems: the pager

Three independent errors in one proof. The pill reads `1/3`; `‹` and `›` walk
them in SOURCE order, and each step centres its node. The node the pager is
currently on wears a wider ribbon than the others, so you can see at a glance
which of the three you are reading. -/

theorem diag_pager (a b : Nat) : a + b = b + a := by
  have h1 : a = a := Nat.first_missing_lemma a
  have h2 : b = b := Nat.second_missing_lemma b
  exact Nat.third_missing_lemma a b

/-! ## 4 · A problem the view is hiding

The error is in the second branch. Collapse the tree with ⊟, or turn on the
gallery (❮❯) and page to the first branch, so the offending node is not drawn —
the pill still counts it, because the mapping runs over every node rather than
the visible ones. Then press `›`: the ancestors unfold, the gallery pages to
the right branch, and the view scrolls to it.

Scoping the count to what is drawn would have been the obvious shortcut and is
exactly wrong — the error you cannot see is the one you most need pointed at. -/

theorem diag_branch (n : Nat) : n = n ∨ n + 0 = n := by
  rcases Nat.eq_zero_or_pos n with h | h
  · left
    rfl
  · right
    exact Nat.no_such_lemma n

/-! ## 5 · A failing tactic has a node to put the ribbon on

`rw [Nat.succ_ne_zero]` fails, so Lean rolls its info subtree back and the
vendored parser harvests nothing for it — this used to be a hole in the tree,
and the error had to fall back to the goal above. The supplemental parser now
draws the failed tactic as a DASHED box in error ink, and everything after it
in the block as a dashed "never ran" ghost, so the ribbon lands on the tactic
that actually failed. -/

theorem diag_failed (n : Nat) : n + 1 = n + 1 := by
  have h : n = n := rfl
  rw [Nat.succ_ne_zero]
  exact rfl

/-! ## 6 · "unsolved goals", where the tree is not already saying it

An unfinished `induction` branch. The tree offers its `+` / `sorry` / `calc`
chips only for a goal reached through `goalsAfter`, and an unfinished branch
arrives SPAWNED — so no chip is drawn for `zero`, and in fact the whole case is
absent from the harvest. This diagnostic is the only trace that anything is
missing, which is why the tag is kept here.

There is nothing to hang a ribbon on, so it shows in the pill alone — the same
honest outcome as `diag_warning` above. Contrast `diag_frontier` below, where a
chip IS drawn and the identical tag is dropped as redundant ink. -/

theorem diag_unsolved (n : Nat) : n + 0 = n := by
  induction n with
  | zero => skip
  | succ k ih => simp

/-! ## 7 · …and where it is

A linear proof that simply stops short. Its open goal arrives through
`goalsAfter`, so the tree draws the frontier chips on it — `+` to type the next
tactic, `sorry` to park the branch. The `unsolved goals` diagnostic would add
nothing but a permanent error count on every proof in progress, so it is
dropped and no pill appears. -/

theorem diag_frontier (n : Nat) : n + 0 = n := by
  have h : n = n := rfl

/-! ## 8 · The control

Nothing wrong here, so no ribbon and no pill — and the boxes sit exactly where
their broken neighbours' do. -/

theorem diag_clean (p q : Prop) (h : p ∧ q) : q ∧ p := by
  obtain ⟨hp, hq⟩ := h
  exact ⟨hq, hp⟩
