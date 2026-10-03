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

The proof carries a guided reading: press `>` to step through its marks, which
take the argument in the order you would explain it — the answer first, then
why it works — rather than the order Lean needs it in.
-/

open Function Set

/-- **Schröder–Bernstein**: two injections, one each way, give a bijection. -/
theorem schroeder_bernstein' {α β : Type*} {f : α → β} {g : β → α}
    (hf : Injective f) (hg : Injective g) : ∃ h : α → β, Bijective h := by
  classical
  -- An empty `β` is a corner case, dealt with first and folded away.
  rcases isEmpty_or_nonempty β with hβ | hβ
  · -- .fold Then `α` is empty too, and the empty function is a bijection.
    have : IsEmpty α := Function.isEmpty f
    exact ⟨_, ((Equiv.equivEmpty α).trans (Equiv.equivEmpty β).symm).bijective⟩
  -- .mark 3 Where `S` comes from: the map `S ↦ A \ g(B \ f(S))` is monotone.
  -- A bigger `S` gives a smaller `B \ f(S)`, a smaller image under `g`, and a
  -- bigger complement.
  let F : Set α →o Set α :=
    { toFun := fun s => (g '' (f '' s)ᶜ)ᶜ
      monotone' := fun s t hst => by dsimp at hst ⊢; gcongr }
  -- .mark 4 Knaster–Tarski hands it over: a monotone map has a least fixed point.
  -- (Sets of `α` form a complete lattice, which is what the theorem needs.)
  -- Call that fixed point `S`.
  set S : Set α := F.lfp
  have hS : (g '' (f '' S)ᶜ)ᶜ = S := F.map_lfp
  -- .mark 2 Why that is possible: outside `S`, every point is some `g(b)`.
  -- Read the fixed-point equation from the other side: the points OUTSIDE `S`
  -- are exactly the images under `g` of the points outside `f(S)`.
  have hnS : g '' (f '' S)ᶜ = Sᶜ := compl_injective (by simp [hS])
  -- `g` is injective, so it has a left inverse `g'` that undoes it.
  set g' := invFun g
  have g'g : LeftInverse g' g := leftInverse_invFun hg
  have hg'nS : g' '' Sᶜ = (f '' S)ᶜ := by rw [← hnS, g'g.image_image]
  -- .mark 1 The answer first: `h` is `f` on `S`, and undoes `g` off it.
  -- Everything else in the proof is about finding `S` and checking `h`.
  set h : α → β := S.piecewise f g'
  -- .mark 6 Onto: `f` covers `f(S)`, and `g'` covers everything else.
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
    · -- .mark 5 The crux: a point of `S` and a point outside it never collide.
      -- `f` lands inside `f(S)`, `g'` lands outside it, so they cannot agree.
      intro x hx y hy hxy
      obtain ⟨y', hy', rfl⟩ : y ∈ g '' (f '' S)ᶜ := by rw [hnS]; exact hy
      rw [g'g _] at hxy
      exact hy' ⟨x, hx, hxy⟩
  exact ⟨h, hinj, hsurj⟩
