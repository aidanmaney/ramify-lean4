import Ramify
import Mathlib

show_panel_widgets [Ramify]

/-!
# D3 and D5 against the live server

A fixture for the LIVE server, not for the corpus (nothing under `lean/` is a
Lake target and none of it reaches `web/public/sample.ndjson`). `import Ramify`
is what registers the RPC methods, so this is the file `probe lsp … --direct`
and `probe lsp … --rename` are pointed at.

## D3 — the contradiction shapes, and the one that redirects

`proofs/` contains no instance of the redirectable shape — measured, and
recorded: the corpus's two contradiction shapes are `euclid`'s `by_contra` on a
positive goal and `odd_sums`' `exfalso`, and both are declined. So the shape
lives here instead, where `directRewrite` can be asked of a real elaborator.

Batteries documents the rule the redirection rests on (`Batteries/Tactic/
Init.lean`, `byContra`):

> `by_contra h` proves `⊢ p` by contradiction, introducing a hypothesis
> `h : ¬p` and proving `False`.
> * If `p` is a negation `¬q`, `h : q` will be introduced instead of `¬¬q`.

So on a NEGATED goal `by_contra h` *is* `intro h`, and saying so is one edit.

* `redirect_direct` — the shape: `⊢ ¬ (n + 1 = 0)`, opened with `by_contra`.
  `intro` is what it already does.
* `redirect_positive` — the counter-shape: `⊢ 0 < n + 1` is positive, the body
  genuinely derives `False` from `h : ¬ 0 < n + 1` (`euclid`'s own shape, with
  `omega` standing in for its `push_neg` + four lemmas), and no text edit turns
  it into a direct proof. Declined.
* `redirect_bang` — `by_contra!` also normalises the negation (`push Not`), so
  `intro` would not reproduce it. Declined.
* `redirect_exfalso` — `exfalso` replaces the goal; dropping it changes what is
  proved. Declined.

## D5 — generic names over conventional shapes

The same three proofs `proofs/rename.lean` carries into the corpus, so the live
`checkRewrite` sees exactly what the offline probe offers: `h : p ∣ n` → `hpn`
and `h2 : 0 < n` → `hn` from one `intro`, `h : a < b` → `hab`, and
`h : b < a` → `hba` whose second reader (`omega`) names it nowhere.
-/

theorem redirect_direct (n : ℕ) : ¬(n + 1 = 0) := by
  by_contra h
  exact Nat.succ_ne_zero n h

theorem redirect_positive (n : ℕ) : 0 < n + 1 := by
  by_contra h
  omega

theorem redirect_bang (n : ℕ) : ¬(n + 1 = 0) := by
  by_contra! h
  omega

theorem redirect_exfalso (n : ℕ) (h : n + 1 = 0) : n = 37 := by
  exfalso
  exact Nat.succ_ne_zero n h

theorem rename_dvd_le (p n : ℕ) : p ∣ n → 0 < n → p ≤ n := by
  intro h h2
  exact Nat.le_of_dvd h2 h

theorem rename_lt_succ (a b : ℕ) : a < b → a < b + 1 := by
  intro h
  exact Nat.lt_succ_of_lt h

theorem rename_sub_pos (a b : ℕ) : b < a → 0 < a - b := by
  intro h
  have hlt : b ≤ a := Nat.le_of_lt h
  omega
