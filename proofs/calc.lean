import Mathlib

/-!
# `calc` chains, and how they reach the tree.

A `calc` block arrives as ONE tactic node whose links are its CHILDREN — the
chain fans out sideways rather than running down the trunk, which is a shape no
other construct here produces (the closest is `have … := by`, which opens
exactly one side proof). The links are a LIST, not a case split: they are the
steps of one computation and nothing continues after them, so the compact
layout draws them as a column (see `TreeNode.chain`) instead of letting the
last one resume the trunk.

The three chains below are shaped to show different things:

1. a mixed `=`/`≤` chain, so the composite relation comes from `Trans` rather
   than from one relation throughout;
2. a chain nested inside the successor case of an induction, whose FIRST link
   is justified by a TERM rather than a tactic — which elaborates nothing, so
   the recovery parser synthesizes its goal and node (see recoverCalcLinks);
3. a two-link `<` then `≤` chain.
-/

theorem calc_workout (a b : ℝ) (n : ℕ) :
    (a + b) ^ 2 ≤ 2 * (a ^ 2 + b ^ 2)
      ∧ (∑ i ∈ Finset.range (n + 1), (2 * i + 1)) = (n + 1) ^ 2
      ∧ (0 : ℝ) < (a - b) ^ 2 + 1 := by
  refine ⟨?_, ?_, ?_⟩
  · -- Chain 1: rewrite to expose the square that has to be discarded, drop it,
    -- then tidy up. The middle link is the only inequality.
    have hsq : (0 : ℝ) ≤ (a - b) ^ 2 := sq_nonneg _
    calc (a + b) ^ 2
        = 2 * (a ^ 2 + b ^ 2) - (a - b) ^ 2 := by ring
      _ ≤ 2 * (a ^ 2 + b ^ 2) - 0 := by linarith
      _ = 2 * (a ^ 2 + b ^ 2) := by ring
  · -- Chain 2: the odd-sum identity, as a calc chain inside the successor case
    -- of an induction — a chain nested under a case split.
    induction n with
    | zero => simp
    | succ k ih =>
      calc (∑ i ∈ Finset.range (k + 1 + 1), (2 * i + 1))
          = (∑ i ∈ Finset.range (k + 1), (2 * i + 1)) + (2 * (k + 1) + 1) :=
            Finset.sum_range_succ (fun i => 2 * i + 1) (k + 1)
        _ = (k + 1) ^ 2 + (2 * (k + 1) + 1) := by rw [ih]
        _ = (k + 1 + 1) ^ 2 := by ring
  · -- Chain 3: two links, `<` then `≤`, so the composite relation is `<`.
    calc (0 : ℝ) < 1 := by norm_num
      _ ≤ (a - b) ^ 2 + 1 := by linarith [sq_nonneg (a - b)]
