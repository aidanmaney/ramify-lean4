# Demo proofs for the Ramify website

The proofs the static viewer publishes (`docs/viewer.md`). `site.txt` lists them
in index order, in groups; publish with

```bash
cd web && npm run publish:site      # → ../site/, then deploy it to gh-pages
```

- **`ReadingTour.lean`** — how to read a tree, for a web reader (the VS Code
  tour, `lean/ProofTreeTour.lean`, also teaches editing, which the website cannot
  do).
- **Classic proofs, written to be read** — `Irrationality`, `Cantor`, `Euclid`,
  `Induction`, `Limits`, `Groups`, and the showcase `SchroederBernstein`. Each
  step's comment is written for a reader with a mathematics background: in the
  tree it rides the step it explains.
- **`mathlib-archive/`** — unedited copies of real community proofs from
  Mathlib's `Archive/` (Freek Wiedijk's 100 theorems), Apache-2.0, headers
  intact; see `NOTICE`. Before adding one, check it draws with no goal
  counted open: a closing macro (`rwa`, `simpa … using`, `conv`) used to leave
  such goals, fixed on `dev` ("Goals the elaborator closed are not open").

Every file elaborates against the dev package's Mathlib (`cd lean && lake env
lean ../demos/<file>.lean`); `ReadingTour.lean` has one error, on purpose.
Each file's leading `/-! # Title … -/` block is its heading and blurb on the
index.

## The playground's theorems

`playground/*.lean`, listed by `playground.txt`, are the baked playground's
theorems (`docs/viewer.md`, "The playground"): core Lean only (each elaborates
with plain `lean`, no Mathlib), one theorem with a worked solution, and
`-- @try` / `-- @depth` directive comments for the baker.
