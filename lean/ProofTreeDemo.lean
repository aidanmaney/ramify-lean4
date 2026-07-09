import ProofTreeWidget

/-!
# Proof-tree widget demo

Open this file in VS Code with the Lean 4 extension (in *this* Lake project, so
`ProofTreeWidget` is on the import path). Build the renderer bundle first:

```bash
cd web && npm run build:widget
cd ../lean && lake build ProofTreeWidget
```

`show_panel_widgets [ProofTreeWidget]` turns the panel on for the whole file, so
the infoview shows the proof tree for the theorem under the cursor. Move the
cursor across the tactics below — the matching tactic node highlights (source→tree)
— and click a tactic node to jump the editor selection to its source (tree→source).

This demo is core-only (no `import Mathlib`), so it elaborates without running
`lake exe cache get`.
-/

show_panel_widgets [ProofTreeWidget]

theorem and_comm_demo (p q : Prop) (h : p ∧ q) : q ∧ p := by
  obtain ⟨hp, hq⟩ := h
  constructor
  · exact hq
  · exact hp
