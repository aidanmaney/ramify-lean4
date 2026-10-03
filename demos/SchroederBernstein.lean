import Mathlib

/-!
# The Schröder–Bernstein theorem

If `A` injects into `B` and `B` injects into `A`, then `A` and `B` are in
bijection — "the same size", even for infinite sets. Cantor conjectured it;
Dedekind, Bernstein and Schröder proved it.

The proof here is the modern one. Glue a bijection together from the two
injections: use `f` on part of `A`, and undo `g` on the rest. The whole
difficulty is finding the part, and a fixed-point theorem hands it over: the
least set `S ⊆ A` with `S = A \ g(B \ f(S))`. On `S` the bijection is `f`;
off `S` every point is some `g(b)`, and the bijection sends it back to `b`.
-/

open Function Set

/-- **Schröder–Bernstein**: two injections, one each way, give a bijection. -/
theorem schroeder_bernstein' {α β : Type*} {f : α → β} {g : β → α}
    (hf : Injective f) (hg : Injective g) : ∃ h : α → β, Bijective h := by
  classical
  -- An empty `β` is a corner case: then `α` is empty too, and the empty
  -- function is a bijection.
  rcases isEmpty_or_nonempty β with hβ | hβ
  · have : IsEmpty α := Function.isEmpty f
    exact ⟨_, ((Equiv.equivEmpty α).trans (Equiv.equivEmpty β).symm).bijective⟩
  -- The operator `S ↦ A \ g(B \ f(S))` is monotone: a bigger `S` gives a
  -- smaller `B \ f(S)`, a smaller image under `g`, and a bigger complement.
  let F : Set α →o Set α :=
    { toFun := fun s => (g '' (f '' s)ᶜ)ᶜ
      monotone' := fun s t hst => by dsimp at hst ⊢; gcongr }
  -- Knaster–Tarski: a monotone map on a complete lattice has a least fixed
  -- point. Call it `S`.
  set S : Set α := F.lfp
  have hS : (g '' (f '' S)ᶜ)ᶜ = S := F.map_lfp
  -- Read the fixed-point equation from the other side: the points OUTSIDE
  -- `S` are exactly the images under `g` of the points outside `f(S)`.
  have hnS : g '' (f '' S)ᶜ = Sᶜ := compl_injective (by simp [hS])
  -- `g` is injective, so it has a left inverse `g'` that undoes it.
  set g' := invFun g
  have g'g : LeftInverse g' g := leftInverse_invFun hg
  have hg'nS : g' '' Sᶜ = (f '' S)ᶜ := by rw [← hnS, g'g.image_image]
  -- The bijection: `f` on `S`, `g'` off it.
  set h : α → β := S.piecewise f g'
  -- Onto: `f` covers `f(S)`, and `g'` covers everything else.
  have hsurj : Surjective h := by
    rw [← range_eq_univ, range_piecewise, hg'nS, union_compl_self]
  -- One to one, checked in three cases.
  have hinj : Injective h := by
    refine (injective_piecewise_iff _).2 ⟨hf.injOn, ?_, ?_⟩
    · -- Two points outside `S`: both are values of `g`, and `g'` undoes `g`.
      intro x hx y hy hxy
      obtain ⟨x', _, rfl⟩ : x ∈ g '' (f '' S)ᶜ := by rw [hnS]; exact hx
      obtain ⟨y', _, rfl⟩ : y ∈ g '' (f '' S)ᶜ := by rw [hnS]; exact hy
      rw [g'g _, g'g _] at hxy
      rw [hxy]
    · -- One point in `S`, one outside: `f` lands inside `f(S)`, `g'` outside
      -- it, so they can never agree.
      intro x hx y hy hxy
      obtain ⟨y', hy', rfl⟩ : y ∈ g '' (f '' S)ᶜ := by rw [hnS]; exact hy
      rw [g'g _] at hxy
      exact hy' ⟨x, hx, hxy⟩
  exact ⟨h, hinj, hsurj⟩
