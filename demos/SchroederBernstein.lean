import Mathlib

/-!
# The Schröder–Bernstein theorem, from the ground up

If `A` injects into `B` and `B` injects into `A`, then `A` and `B` are in
bijection — "the same size", even for infinite sets. Cantor conjectured it;
Dedekind, Bernstein and Schröder proved it. This file builds it from the set
theory it rests on: images and preimages, inverse functions, then two proofs.

The first is the classical construction, following *Mathematics in Lean*
§4.2–4.3 (Avigad and Massot, Apache 2.0; see `NOTICE`): chase points back and
forth along the two injections, collect the ones whose chain starts outside
`g`'s range, and use `f` there and `g⁻¹` elsewhere. The second is the modern
proof, where a fixed-point theorem hands over the same set in one stroke; it
carries a guided reading — press `>` to step through its marks.
-/

open Function Set

namespace SchroederBernstein

/-! ## 1 · Images and preimages

The two ways a function moves sets: forwards, `f '' s = {f x | x ∈ s}`, and
backwards, `f ⁻¹' v = {x | f x ∈ v}`. The construction below is all images and
unions, so these are the facts it leans on. -/

section images
variable {α β : Type*} (f : α → β) (s t : Set α) (v : Set β)

/-- Images and preimages are adjoint: `f(s) ⊆ v` exactly when `s ⊆ f⁻¹(v)`. -/
theorem image_subset_iff_subset_preimage : f '' s ⊆ v ↔ s ⊆ f ⁻¹' v := by
  constructor
  · -- Forwards: a point of `s` maps into `f(s)`, which sits inside `v`.
    intro h x xs
    have : f x ∈ f '' s := mem_image_of_mem _ xs
    exact h this
  · -- Backwards: a point of `f(s)` is `f x` for some `x ∈ s ⊆ f⁻¹(v)`.
    intro h y ymem
    rcases ymem with ⟨x, xs, fxeq⟩
    rw [← fxeq]
    apply h xs

/-- For an injective `f`, pulling back the image of `s` gives nothing new. -/
theorem preimage_image_subset_of_injective (h : Injective f) : f ⁻¹' (f '' s) ⊆ s := by
  -- If `f x = f y` with `y ∈ s`, injectivity makes `x = y`.
  rintro x ⟨y, ys, fxeq⟩
  rw [← h fxeq]
  exact ys

/-- Images respect inclusion. -/
theorem image_subset_image_of_subset (h : s ⊆ t) : f '' s ⊆ f '' t := by
  rintro y ⟨x, xs, fxeq⟩
  use x, h xs

/-- The image of a union is the union of the images — the fact that lets the
construction below work one iterate at a time. -/
theorem image_iUnion_eq {I : Type*} (A : I → Set α) :
    (f '' ⋃ i, A i) = ⋃ i, f '' A i := by
  ext y; simp
  constructor
  · rintro ⟨x, ⟨i, xAi⟩, fxeq⟩
    use i, x
  · rintro ⟨i, x, xAi, fxeq⟩
    exact ⟨x, ⟨i, xAi⟩, fxeq⟩

end images

/-! ## 2 · Inverse functions

An injective function can be undone on its range. Outside the range there is
nothing to undo, so the inverse picks an arbitrary default — which is why it
needs the domain to be nonempty, and choice to pick a preimage. -/

section inverses
variable {α β : Type*} [Inhabited α]

open Classical in
/-- A preimage of `y` if there is one, else a default. -/
noncomputable def inverse (f : α → β) : β → α := fun y : β ↦
  if h : ∃ x, f x = y then Classical.choose h else default

/-- On the range, the inverse really is an inverse. -/
theorem inverse_spec {f : α → β} (y : β) (h : ∃ x, f x = y) : f (inverse f y) = y := by
  rw [inverse, dif_pos h]
  exact Classical.choose_spec h

/-- Injective means: the inverse undoes `f`. -/
theorem injective_iff_leftInverse (f : α → β) : Injective f ↔ LeftInverse (inverse f) f := by
  constructor
  · -- If `f` is injective, `inverse f (f x)` is a preimage of `f x`, so it is `x`.
    intro h y
    apply h
    apply inverse_spec
    use y
  · -- Conversely, `f x₁ = f x₂` gives `x₁ = inverse (f x₁) = inverse (f x₂) = x₂`.
    intro h x1 x2 e
    rw [← h x1, ← h x2, e]

/-- Surjective means: `f` undoes the inverse. -/
theorem surjective_iff_rightInverse (f : α → β) :
    Surjective f ↔ RightInverse (inverse f) f := by
  constructor
  · intro h y
    apply inverse_spec
    apply h
  · intro h y
    use inverse f y
    apply h

end inverses

/-! ## 3 · The classical construction

Start from the points of `α` that `g` never reaches. Push them across and back
again — `g (f x)` — over and over. `sbSet` collects every point reached this
way. On `sbSet` the bijection is `f`; everywhere else it is `g⁻¹` (Mathlib's
`invFun g`, the inverse of §2), which is defined there because a point outside
`sbSet` is always in `g`'s range. -/

section construction
variable {α β : Type*} [Nonempty β] (f : α → β) (g : β → α)

/-- The `n`th iterate: start outside `g`'s range, then apply `g ∘ f` `n` times. -/
def sbAux : ℕ → Set α
  | 0 => univ \ g '' univ
  | n + 1 => g '' (f '' sbAux n)

/-- Every point reachable that way. -/
def sbSet : Set α :=
  ⋃ n, sbAux f g n

open Classical in
/-- The bijection: `f` on `sbSet`, and `g⁻¹` off it. -/
noncomputable def sbFun (x : α) : β :=
  if x ∈ sbSet f g then f x else invFun g x

/-- Off `sbSet`, `g⁻¹` is a genuine inverse: such a point is in `g`'s range. -/
theorem sb_right_inv {x : α} (hx : x ∉ sbSet f g) : g (invFun g x) = x := by
  -- A point outside `g`'s range would be in the 0th iterate, hence in `sbSet`.
  have : x ∈ g '' univ := by
    contrapose! hx
    rw [sbSet, mem_iUnion]
    use 0
    rw [sbAux, mem_sdiff]
    exact ⟨mem_univ _, hx⟩
  have : ∃ y, g y = x := by
    simp at this
    assumption
  exact invFun_eq this

/-- **The hard direction**: the glued function is injective. -/
theorem sb_injective (hf : Injective f) : Injective (sbFun f g) := by
  set A := sbSet f g with A_def
  set h := sbFun f g with h_def
  intro x₁ x₂ (hxeq : h x₁ = h x₂)
  show x₁ = x₂
  simp only [h_def, sbFun, ← A_def] at hxeq
  -- .mark 1 Split on where the two points lie: at least one in `A`, or neither.
  by_cases xA : x₁ ∈ A ∨ x₂ ∈ A
  · -- By symmetry, say `x₁ ∈ A`.
    wlog x₁A : x₁ ∈ A generalizing x₁ x₂ hxeq xA
    · symm
      apply this hxeq.symm xA.symm (xA.resolve_left x₁A)
    -- .mark 2 The crux: then `x₂ ∈ A` too. Otherwise `x₂ = g (f x₁)` is one more
    -- step along `x₁`'s chain, so it would be in `A` after all.
    have x₂A : x₂ ∈ A := by
      apply _root_.not_imp_self.mp
      intro (x₂nA : x₂ ∉ A)
      rw [if_pos x₁A, if_neg x₂nA] at hxeq
      rw [A_def, sbSet, mem_iUnion] at x₁A
      have x₂eq : x₂ = g (f x₁) := by
        rw [hxeq, sb_right_inv f g x₂nA]
      rcases x₁A with ⟨n, hn⟩
      rw [A_def, sbSet, mem_iUnion]
      use n + 1
      simp [sbAux]
      exact ⟨x₁, hn, x₂eq.symm⟩
    -- Both in `A`, where the bijection is `f`, which is injective.
    rw [if_pos x₁A, if_pos x₂A] at hxeq
    exact hf hxeq
  -- .mark 3 Neither in `A`: both values are `g⁻¹ x`, and `g⁻¹` is undone by `g`.
  push Not at xA
  rw [if_neg xA.1, if_neg xA.2] at hxeq
  rw [← sb_right_inv f g xA.1, hxeq, sb_right_inv f g xA.2]

/-- The glued function is onto. -/
theorem sb_surjective (hg : Injective g) : Surjective (sbFun f g) := by
  set A := sbSet f g with A_def
  set h := sbFun f g with h_def
  intro y
  -- Ask whether `g y` lies in `A`.
  by_cases gyA : g y ∈ A
  · -- Then `g y` came from some iterate: it is `g (f x)` for an `x` in `A`,
    -- and `f x = y` by injectivity of `g`.
    rw [A_def, sbSet, mem_iUnion] at gyA
    rcases gyA with ⟨n, hn⟩
    rcases n with _ | n
    · simp [sbAux] at hn
    simp [sbAux] at hn
    rcases hn with ⟨x, xmem, hx⟩
    use x
    have : x ∈ A := by
      rw [A_def, sbSet, mem_iUnion]
      exact ⟨n, xmem⟩
    rw [h_def, sbFun, if_pos this]
    apply hg hx
  -- Otherwise `g y` is off `A`, where the bijection undoes `g`.
  use g y
  rw [h_def, sbFun, if_neg gyA]
  apply leftInverse_invFun hg

/-- **Schröder–Bernstein**, by the classical construction. -/
theorem schroeder_bernstein {f : α → β} {g : β → α} (hf : Injective f) (hg : Injective g) :
    ∃ h : α → β, Bijective h :=
  ⟨sbFun f g, sb_injective f g hf, sb_surjective f g hg⟩

end construction

/-! ## 4 · The modern proof

The same theorem with the set found by a fixed-point theorem instead of by
iteration: the least `S ⊆ A` with `S = A \ g(B \ f(S))`. It needs no
`Nonempty β` and no iterates. Press `>` for its guided reading. -/

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

end SchroederBernstein
