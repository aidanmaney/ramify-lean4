# Baked playground — feasibility spike (2026-10-04)

> **Shipped as v1 on 2026-10-05** — see `docs/viewer.md` ("The playground") and
> the design record's "2026-10-05 — The baked playground (v1)". The baker below
> was productionised in place (`lean/PlaygroundBake.lean`, now reading a theorem
> FILE and baking through the real `ProofTree.bakeGoal`); the viewer sketch
> `web/scratch/playground.mjs` was replaced by `web/src/playgroundAnswer.ts` and
> removed. What follows is the spike as it was.

**Question.** Can a static page let a visitor *type* tactics under a goal of a
tiny core-Lean proof and watch the Ramify tree grow, with no Lean server, in a
few MB — every `(goal, tactic)` answer pre-computed by real Lean and shipped as
data? (In-browser WASM Lean was measured too heavy for the default path: Init
oleans 98 MB raw / 29 MB gz, plus a ~158 MB `libleanshared`.)

**Answer: GO.** With canonical naming the bake is **2–4 KB gzipped per
theorem** (with hovers: **3–6 KB**), bakes in **0.1–2 s** per theorem, and the
synthesized step records build a real tree through the unmodified
`proofToTree`. The one design decision the numbers force is **canonical
naming**: without it, the visitor's choice of names multiplies the state space
by up to 30×.

## What was built (spike only, nothing wired into the product)

| file | what |
| --- | --- |
| `lean/PlaygroundBake.lean` | the baker; `lake exe playgroundbake OUTDIR [DEPTH] [canon]` (or `lean --run PlaygroundBake.lean …`, no Lake needed — it is core only) |
| `lean/lakefile.toml` | one new `lean_exe` target, `playgroundbake` (not a default target) |
| `web/scratch/playground.mjs` | the viewer-side sketch: the `answer` seam, typed text → baked step, completions, script → `ProofStep[]` → the real `proofToTree` (through the probes' bundle) |

### The baker

Imports `Init` into an environment (`importModules (loadExts := true)` —
without `loadExts` the `+` notation does not even parse), elaborates the
statement with `elabType`, makes one `syntheticOpaque` goal and runs a BFS. The
unit is ONE goal (the tree's own unit, `goalBefore → tactic → goalsAfter`), not
a goal list. For each new goal, every candidate is parsed with
`runParserCategory env `tactic` and run with `Tactic.run g (evalTactic stx)`
under `withoutErrToSorry` from the goal's saved `Term.SavedState`. Outcome:
the goals left (each interned and enqueued) or the first error's text — errors
come three ways and all three are needed: a thrown exception, a LOGGED error
with recovery (check `messages.hasErrors`), and a runtime exception (heartbeats,
recursion depth — `tryCatchRuntimeEx`, plain `try` misses them). A result
containing `sorry` is an error. Goals are deduplicated by **`ppGoal`'s own
print** (hyps with names, grouping, shadowed `n✝`). Every step runs under
`withCurrHeartbeats` at 20 000 heartbeats — heartbeats are cumulative across
the whole run otherwise, and the first version "timed out" 2 379 times.

Candidates (26): `intro n/m/h/l`, `intro p q h`, `induction n/l`, `cases n/h`,
`rename_i k ih`, `simp`, `simp at h`, `simp [Nat.add_succ]`, `omega`, `rfl`,
`decide`, `rw [Nat.add_comm]`, `constructor`, `exact h`, `assumption`,
`apply Nat.succ_le_succ`, `simp_all`, and the mistakes `exact rfl`,
`apply And.intro h`, `rw [Nat.mul_comm] at h`, `exact Nat.le_refl`. In
**canonical** mode every `intro x` is dropped and replaced by ONE `intro <c>`
per goal, `<c>` = the statement's own binder name (an arrow's anonymous binder
becomes `h`, made unused).

Hover estimate: a slim copy of `bakePopup` (ProofTreeHarvest.lean imports
Paperproof, so it is copied, not imported): `goalToInteractive` per goal, every
tag baked to `{expr, type, doc}` and interned in one table per theorem — the
static viewer's `hovers` idiom.

## Measurements

Theorems: `zero_add` `∀ n : Nat, 0 + n = n`; `and_swap`
`∀ p q : Prop, p ∧ q → q ∧ p`; `append_nil_length`
`∀ l : List Nat, (l ++ []).length = l.length`; `le_succ`
`∀ n m : Nat, n ≤ m → n + 1 ≤ m + 1`. Compiled exe, depth cap 4.

**Free naming (every `intro x` variant baked):**

| theorem | goals | steps | errors | α-dupes | bake | raw | gz | gz + hovers |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| zero_add | 16 | 390 | 285 | 9 | 0.6 s | 26 KB | 3.5 KB | 5.3 KB |
| and_swap | 361 | 3 224 | 2 716 | 355 | 1.8 s | 358 KB | 28 KB | 34 KB |
| append_nil_length | 10 | 260 | 220 | 6 | 0.5 s | 26 KB | 3.2 KB | 5.9 KB |
| le_succ | 641 | 4 290 | 2 881 | 567 | 16.8 s | 366 KB | 36 KB | 54 KB |

**Canonical naming:**

| theorem | goals | steps | errors | α-dupes | bake | raw | gz | gz + hovers |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| zero_add | 10 | 190 | 131 | 3 | 0.6 s | 13 KB | 2.2 KB | 3.7 KB |
| and_swap | 11 | 153 | 132 | 7 | 0.1 s | 14 KB | 2.2 KB | 2.8 KB |
| append_nil_length | 5 | 106 | 86 | 2 | 0.3 s | 12 KB | 2.0 KB | 4.2 KB |
| le_succ | 45 | 439 | 316 | 23 | 2.0 s | 36 KB | 4.0 KB | 6.3 KB |

All four together, with hovers, in one gzip stream: **15 KB**.

"α-dupes" = goals equal to an earlier one up to the NAMES of their hypotheses
(`Expr.eqv` on the goal closed over its context). Free naming: 355/361
(`and_swap`) and 567/641 (`le_succ`) of the goals are renamings — names
compound (5 names × 5 names × …). **Canonical naming is required**, not
optional. The residue under canonical naming comes from `induction n` vs
`cases n` leaving inaccessible `n✝` in differently-numbered places and from
`rename_i` — harmless.

**Depth (canonical):** `zero_add` and `append_nil_length` SATURATE (the
reachable space is closed by depth 4–6: 10 and 5 goals). `and_swap` 11 → 23
goals (depth 4 → 6, 2.2 → 3.8 KB gz). `le_succ` explodes: 45 → 297 → 1 551
goals at depth 4 / 6 / 8 (4 KB → 19 KB → 108 KB gz, 69 s): `cases`/`induction`
on `n`, `m` and `h : n ≤ m` keep producing new arithmetic states. Depth caps
also bite usefully the other way: at depth 4 `and_swap`'s `intro p; intro q;
intro h; constructor` uses the whole budget, so the two conjunct goals are not
expanded — **depth should not count `intro`** (or the cap should be per
theorem).

**Where the bytes go (canonical, gz):** error texts 1.1–1.6 KB per theorem
(interned; 45–120 distinct messages), successful steps alone 0.4–1.2 KB, hover
table 0.4–2.0 KB, tagged prints 0.3–1.1 KB. Three quarters of the steps are
errors, and nearly all are "`intro`: no binders" / "Unknown identifier `h`" —
a smarter candidate filter (or dropping errors except the curated mistakes,
showing "not in this demo" for the rest) halves the payload; at these sizes it
does not matter.

**Projection.** 20 playground theorems at depth 4–6, canonical, with hovers:
**~100–150 KB gzipped**, far under "a few MB"; even an `le_succ`-like theorem
at depth 8 is 146 KB gz with hovers. Hovers are cheap because docstrings
(`Nat`, `HAdd.hAdd`, …) repeat: a site-wide table would dedupe further.

**Baked hovers are approximate** in this spike: the slim `bakePopup` prints
`expr` with plain `ppExpr` rather than `popupExprText`; the size is
representative, the strings are not the product's.

## What worked / what did not

- Worked: the BFS; `ppGoal` as the key; the error triad; synthesized records
  building trees through the unchanged `proofToTree`:
  `node scratch/playground.mjs zero_add.json "intro x" "induction x" "simp"
  "rename_i k ih" "omega"` → 5 steps, 10 nodes, closed, with `x` shown where
  the bake says `n`; `intro a b h` splits into three baked intros.
- Fought: `loadExts := true` and `enableInitializersExecution` (so `main` is
  `unsafe`) to get notations; cumulative heartbeats; runtime exceptions escaping
  `try`; a hygienic name printing as `n._@._hyg.74` until the key moved to
  `ppGoal`.
- `simp [Nat.add_succ]` LOOPS (it fights simp's normal form) and costs a full
  20 000-heartbeat timeout per goal — 20 of `le_succ`'s 2 s. Fine as a
  "deliberate mistake", but candidate lists need a timing pass.
- Shared-metavariable goals (`constructor` on `∃`, `refine ⟨?_, ?_⟩`) are
  treated as independent goals; for tiny core proofs that did not come up, but
  the key would need the sibling assignment to be exact.
- Aliasing in the sketch renames by whole-word regex over printed text —
  wrong if a visitor's name collides with a constant. The product version
  should rename on the TAGGED print (fvar tags identify the hypothesis), which
  the hover bake already produces.

## Viewer sketch (`web/scratch/playground.mjs`)

1. **The seam** — `answer(goalKey, tactic): Promise<{goals: goalKey[]} |
   {error} | NOT_BAKED>`, built by `makeAnswer([bakedEngine(bake), …])`;
   engines are tried in order, first non-`NOT_BAKED` wins. Goals are named by
   their `ppGoal` KEY, never a bake-local id, so answers from any engine join
   one graph.
2. **Typed text → step**: whitespace normalisation (`[ ` / ` ]` too); the
   visitor's names mapped to canonical ones before lookup (`intro x` on a goal
   whose baked intro is `intro n` adds alias `x → n` for that subtree, and the
   goals display `x`); `intro a b c` = three intros; a COMPLETION list = the
   goal's successful baked tactics shown under the aliases; a miss draws "not in
   this demo" and leaves the goal open, an error draws Lean's own message.
3. **Records**: each line applies to the FIRST open goal (Lean's main goal);
   goal ids are minted per OCCURRENCE (`g0`, `g1`, … — a baked state can recur
   in one tree), hyp ids per (shown name, type), positions = the script line, so
   `proofToTree`, cuts and narration run as on any payload; `viewer.tsx` would
   take `{steps, allGoals}` plus the baked `taggedGoals`/`hovers` it already
   reads. A failed line would draw as the recovery parser's failed step.

## Levelling up (progressive enhancement)

Serve the baked table instantly; later a WASM Lean MAY stream in the background
and "level up" the page so tactics outside the table really elaborate.

- **One seam.** The live engine is just another entry in `makeAnswer`'s list,
  after the baked one, answering ONLY `NOT_BAKED` cases, in the SAME shape:
  `{goals: [ppGoal keys]} | {error}`. Because states are keyed by the
  pretty-printed goal (hyps + target, the infoview's print), a live answer whose
  goal equals a baked one JOINS the baked graph — the next keystroke is answered
  from the table again. The live engine must print with the same options and
  the same canonical names (a WASM worker running this same baker's step
  function, `runOne` + `ppKey`, guarantees that by construction).
- **State, not text.** The live engine cannot start from a pretty-printed key;
  it replays the path: root statement + the canonical tactic sequence that
  reached the goal (the client knows it — it is the tree). The page keeps that
  path per goal occurrence.
- **Cache.** Live answers go to IndexedDB under `(bake version, theorem,
  goalKey, normalised tactic)` → outcome (+ the new goals' tagged prints and
  hovers), merged into the in-memory table on load; a bake-version change drops
  them. Never `localStorage` (size, sync).
- **What the WASM tier costs.** Measured: Init oleans 98 MB raw / 29 MB gz
  (a core-only playground needs Init alone, no Std/Lean beyond what the
  elaborator itself links), `libleanshared` 158 MB native — the wasm build of
  the runtime + elaborator is of that order before compression. So: an EXPLICIT
  opt-in ("Enable live Lean — ~60+ MB download"), fetched in a worker, cached by
  the service worker / Cache Storage; a progress line in the status strip, the
  baked page fully usable meanwhile. **Phones: baked-only** (no offer).
- **Honesty in the UI.** Baked answers and live answers look the same; "not in
  this demo" becomes "checking with Lean…" only once the tier is loaded.

## Recommendation and next steps

**Go**, baked-only first; the live tier is a separate, later, opt-in project.

| step | effort |
| --- | --- |
| Candidate lists per theorem (curated mistakes + the proof's own tactics + a goal-derived `intro`/`cases <hyp>`/`exact <hyp>` generator); depth not counting `intro`; a per-candidate timing pass | 1–2 days |
| Bake output in the payload shape: real `bakePopup`/`bakeGoal` (move the core of ProofTreeHarvest's bake out of the Paperproof-importing module or import it), tagged prints per goal, one site-wide hover table | 1–2 days |
| Viewer: an editable line per open goal under the existing view (the chip/edit-in-place idiom, no edit hooks), completions, aliasing on the tagged print, failed-step drawing via the recovery shape; `publish.mjs --playground` | 3–5 days |
| A probe that replays every baked path through `proofToTree` (+ fingerprint) | 0.5 day |
| Live WASM tier (later): wasm toolchain build, worker, IndexedDB cache, opt-in UX | weeks; separate decision |
