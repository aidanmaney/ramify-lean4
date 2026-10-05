# The static viewer

A website that shows Lean proofs as Ramify trees, with **no Lean server**. Lean runs once, on the author's machine; the result is saved as a JSON payload per source file, and the page is plain HTML, JS and JSON that any static host (GitHub Pages) serves as is.

It has two jobs: let anyone open a link and read a proof as a tree with every reading feature Ramify has, and show a visitor who likes it, in one line, what the VS Code extension adds and where to get it.

```
proofs/*.lean ──ppharness --widget-data──▶ records ──publish.mjs──▶ site/data/<name>.json ──▶ viewer.tsx ──▶ ProofTreeView
                (Lean, once, locally)                (one payload per file, versioned)        (the page)     (the same view)
```

## Publishing

```bash
cd lean && lake build ppharness            # once; a Mathlib file also needs `lake exe cache get`
cd ../web
node scripts/publish.mjs ../lean/ProofTreeTour.lean ../proofs/euclid.lean ../proofs/odd_sums.lean
python3 -m http.server -d ../site 8000     # then open http://localhost:8000/
```

`publish.mjs` elaborates each file with `ppharness --widget-data --traces --lint`, builds one payload per file and writes the site to `site/` at the repository root (git-ignored):

| path | what |
| --- | --- |
| `site/index.html` | a hero picture and a card per published file — its title, its featured proof's tree, a download for the one-file copy; prose only in tooltips |
| `site/cards.json` | what the cards show (file, featured proof, the hero), read by `thumbs.mjs` |
| `site/thumbs/*.webp` | the pictures, drawn by `thumbs.mjs` — absent, a card shows its title alone |
| `site/view.html` | the viewer: `view.html#file=<name>&proof=<decl>` |
| `site/viewer-<hash>.js` | the viewer bundle, shared by every page; the hash changes with its content, so it caches safely |
| `site/data/<name>.json` | one payload per source file |
| `site/export/<name>.html` | the same file as **one self-contained page** (JS and payload inline), for email or a paper's supplement; opens from disk |

Options: `--out DIR`, `--list FILE` (the sources a list names, in order, `## Heading` lines grouping them on the index), `--single FILE` (also write the first file's export to `FILE`), `--no-exports`, `--no-traces`, `--no-lint`, `--cache DIR` (keep each file's `ppharness` output and reuse it while it is newer than the source) and `--ndjson OUT=SRC` (use an existing `--widget-data` output instead of running Lean).

### The demo set

The website's own proofs live in `demos/` (see `demos/README.md`), listed in
index order by `demos/site.txt`, where `## Heading` lines group them:

```bash
cd web && npm run publish:site    # = node scripts/publish.mjs --list ../demos/site.txt
```

Each file's leading `/-! # Title … -/` block gives its card's title (a
copyright header before it is skipped) and its first paragraph the card's
tooltip. A line may name the proof the card opens and pictures
(`Cantor.lean cantor`; otherwise the file's longest), and `@hero <name>` the
file whose viewer the index opens with.

The pictures are the viewer's own rendering: `scripts/thumbs.mjs [site]`
(the second half of `publish:site`) serves the site on loopback and, in
headless Chromium (Playwright: `npm i -D playwright`, or `NODE_PATH` to an
install), shoots each featured tree in the wide layout (stacked where wide is
wider than 1300px), cropped to its ink, light and dark, as ≤640px WebP (about
2 MB for the demo set). On hover a card pans down through its whole tree.

The hero advertises the EXTENSION, so its picture is a VS Code screenshot:
drop `demos/hero-light.png` (and optionally `hero-dark.png`; dark falls back
to light) — a window with the hero file open and Ramify in the infoview,
about 16:9. Until one exists the hero is the viewer's own rendering. Its
`Preview` button opens the same proof here, in the browser.

The committed pair was shot in code-server (VS Code in a browser, which runs
the real extension host, unlike vscode.dev/github.dev, which have no Lean
server): Node 24, `npm i code-server`, the `leanprover.lean4` extension built
from its repository with `vsce package`, `dist/ramify-*.vsix`, then Playwright
at 1600×900 @2x with `Default Light Modern` / `Default Dark Modern`, the
sidebar hidden and the cursor on `by_cases`. Allow ~90 s for the worker to
load Mathlib, and move the cursor once after it finishes so the infoview
re-asks.

### Deploying to GitHub Pages

The site is generated, so it lives on its own branch rather than in `dev`:

```bash
git worktree add ../pages gh-pages          # first time: git worktree add --orphan -b gh-pages ../pages
rsync -a --delete --exclude .git site/ ../pages/
cd ../pages && git add -A && git commit -m "Publish the viewer" && git push origin gh-pages
```

Then, once, in the repository's Settings → Pages: deploy from the `gh-pages` branch, root. `publish.mjs` writes `.nojekyll`, so Pages serves the files untouched.

## Links

`view.html#file=euclid&proof=infinitude_of_primes&layout=spine&context=all&comments=narrate`

- `file` picks the payload; `proof` the declaration by name (`@<index>` for an `example`). A single-file export ignores `file`.
- `layout`, `context` and `comments` are the status bar's own words (`outline` / `spine` / `tracks` / `wide`; `used` / `intro` / `diff` / `all`; `show` / `hide` / `in place` / `narrate`). They set where the reader **starts**; the page keeps its hash in step as the reader changes them, leaving out whatever equals the default, so the address bar is always a link to what is on screen.
- `?experience=beginner|intermediate|expert` picks the preset (default `intermediate`), as in the harness: lints, traces and narration are on as the preset says.

## The page

- **The tree** is `ProofTreeView`, the same component the widget and the harness draw, fed from the payload.
- **The source pane** to the tree's left (the tree on the right, where the infoview sits beside the editor in VS Code) shows the file, read-only, coloured by a small Lean lexer with the server's own semantic tokens laid over every tactic and declaration header. Clicking a line moves the cursor there, and the view follows it exactly as it follows the editor's (peeking seeded cuts, accenting the node); clicking into another declaration switches to it. `»` on a node (or a click on a tactic box) scrolls the pane to the step and washes its tight range. The handle between the pane and the tree resizes the split (drag, or ←/→ when focused; double-click resets it to 40%; the source keeps at least 240px and the tree 360px); the split is remembered as a fraction of the row in `localStorage`, wrapped like the theme pick. `Source` hides the pane; under 860px it stacks under the tree and the handle goes.
- **Theme**: light and dark sets of the `--vscode-*` variables the view's palette reads, written on `:root`, plus a fixed Lean-flavoured token palette. It follows `prefers-color-scheme` until the reader picks one with the toggle, which is remembered (in `localStorage`, wrapped: the page draws the same without it).
- **Onboarding**: one line in the header names what the editor adds (editing in the tree, live diagnostics, restructuring checked by Lean) and links the latest release and `INSTALL.md`. Nothing else names a move the page cannot make.

## What is absent, and how

The viewer passes **no edit hooks and no companion**. Every move that needs Lean — editing a tactic, the frontier chips, delete, completion, `⇓ ⇑ ⤵ ⤴ ✎`, the D5 rename, the counterfactual, polish, propose, the lens, undo — is then absent through the gates the view already had (`caps`; `availability` answering `never-session`). There is no "viewer mode" inside the view: if a Lean-only move ever shows, the gate is what is wrong, and it is fixed there.

That rule found three leaks in the `?` panel, all fixed at the gate (`gestures.ts`): the `≈` row (model polish) now needs a `polish` capability, and the background drag and `⇧F10` rows each have a reading-only wording (`unless: "flags"` / `unless: "add"`) instead of naming flag writes and chips.

## The payload (format version 1)

```ts
{
  version: 1,
  file: "proofs/euclid.lean",           // as published
  source: "…",                          // the whole file, for the pane
  hovers: [{ expr?, type?, doc? }, …],  // every popup, interned per FILE
  proofs: [{ name: "Nat.foo" | null, index: 3, proof: { …the CLI record… } }]
}
```

`proof` is the CLI record (`ppharness`): today's NDJSON proof plus the groups only the widget used to carry —

| group | the viewer draws |
| --- | --- |
| `diagnostics` | error/warning ribbons, the count item, the message strip |
| `tacticEdits` (tight ranges, verbatim text, semantic tokens) | coloured tactic labels; `»`'s tight range |
| `declHeader`, `declHeaderTokens`, `declHeaderStart`, `…NameStop/SigStop/BodyStop` | the signature header |
| `taggedGoals`, `tokenInfos` — **baked** | hover popups on goals, hypotheses and tactic tokens; diff washes |

The page reads exactly version 1 and refuses anything else with a sentence a reader can act on (`checkPayload`), rather than drawing a payload it misreads. Bump `PAYLOAD_VERSION` in both `web/src/viewerPayload.ts` and `web/scripts/publish.mjs` on any change a version-1 page would misread.

### One harvest, both wires

The four groups are harvested by **the same functions** on both wires: `lean/ProofTreeHarvest.lean` holds what used to be inline in `Ramify.lean`'s widget path (`harvestEdits`, `treeDiagOf`, `tokenHoverAt`, `collectTaggedGoals`, `wantedGoalTypes`, the hover index), and `Ramify.lean` (the RPC) and `Ppharness.lean` (the CLI) both call them. The CLI makes its diagnostics with core's own `msgToInteractiveDiagnostic`, then `treeDiagOf`, as the widget does.

Only the last step differs. A tagged goal's tags and a token's hover are `WithRpcRef`s on the RPC, which the infoview resolves on hover by calling core's `makePopup`; a static page has no server to call, so the CLI asks `makePopup`'s three questions at harvest time (`bakePopup`: the expression, explicit at the hovered application only and an assigned metavariable by its value, exactly as core prints it; its type; its docstring) and stores the plain answers, omitting absent fields. A baked tag is `{"h": k, "diffStatus"?}` where the RPC sends `{"info": <ref>, "subexprPos", "diffStatus"?}`; `k` indexes the file's `hovers`. On the page, `BakedCode` (`web/src/bakedCode.tsx`) stands where the infoview's `InteractiveCode` stands: it washes the innermost tag under the pointer and shows its popup after the infoview's own 150 ms hold.

The renderers are shared too: `taggedCore.tsx` and `tacticCore.tsx` hold the tagged-goal and tactic-token logic with the code renderer as a parameter; `taggedRender.tsx` and `tacticTokens.tsx` bind it to `InteractiveCode` (and remain the only files that import the infoview), the viewer binds `BakedCode`. The viewer bundle contains no infoview.

### Checks

- `npm run probe -- lsp <file> 0 0 --all --wire` — the live gate: elaborates the file in a real `lake serve` and with the CLI, and compares every widget-only group per declaration (goals by content, since mvar ids renumber per elaboration). Then it resolves every token hover's and every goal tag's reference with the server's own `infoToInteractive` — what the infoview calls on hover — and compares the answer with the baked popup. Measured identical over `ProofTreeTour.lean` (6 declarations, 544 popups) and `ProofTreeDiagnostics.lean` (8 declarations, 273 popups).
- `npm run probe -- viewer` (in `npm test`) — offline, over real `--widget-data` output in `web/probe/viewer/`: version and shape, every baked tag indexes `hovers`, tagged goals read exactly as their printed goals, tactic edits are the source's own text at their ranges, a wrong or missing version is refused, links round-trip, the lexer, and the `?` panel naming no Lean-only move in a reading-only session.

## Sizes

Measured 2026-10-03 over the whole corpus (`proofs/*.lean`, Mathlib) and the Tour — 15 files, 40 proofs, published in 2m11s; minified:

| | raw | gzip |
| --- | --- | --- |
| `viewer-<hash>.js` (shared by every page) | 645 KB | 215 KB |
| largest payload, `data/odd_sums.json` (1 proof, 44 steps, 153 popups) | 365 KB | 27 KB |
| typical payload, `data/euclid.json` (1 proof, 26 steps) | 162 KB | — |
| smallest payload, `data/openblock.json` (3 proofs) | 17 KB | — |
| largest single-file export, `export/odd_sums.html` | 1010 KB | 244 KB |
| `export/euclid.html` | 808 KB | 234 KB |
| smallest single-file export, `export/openblock.html` | 663 KB | — |

A single-file export is the bundle plus one payload, so it never falls below ~650 KB; payloads compress about 13:1 (repeated goal text), and a host serving gzip delivers a page for the bundle's 215 KB plus a few tens of KB per file.

## The playground

`playground.html` lets a visitor **type** a tactic under any open goal of a
small core-Lean theorem and watch the tree grow, with no Lean server: every
`(goal, tactic)` answer was computed by real Lean when the site was published.
What a visitor sees — goals, errors (as squiggles), hovers — is what Lean said.
The design and its measurements are `docs/playground-spike.md` and the design
record's "2026-10-05 — The baked playground (v1)".

```
demos/playground/*.lean ──playgroundbake──▶ playground/<name>.json ──play()──▶ attempts ──buildProof()──▶ records ──▶ ProofTreeView
  (Lean, once, locally)   (BFS over goals)     (playgroundVersion 1)   (typed text → baked step)            (the same view)
```

```bash
cd lean && lake build playgroundbake
cd ../web && node scripts/publish.mjs --playground ../demos/playground.txt --cache /tmp/pg   # only the playground
npm run publish:site                                                                       # everything, cards first
```

`--playground LIST` bakes each theorem (`--cache DIR` keeps `playground-<name>.json`
while it is newer than the source and the baker), checks that the theorem's
**own solution**, typed line by line as written, closes the proof in the page's
client, writes `playground/<name>.json`, `playground/index.json`,
`playground.html` and its bundle `playground-<hash>.js`, prints the sizes and
**fails over 2 MB gzipped** (the data; the bundle is printed beside it). With
no source files it rewrites only the playground; with them the index gets a
**Try it** card above every group (its picture: `thumbs.mjs` types five
tactics into `Double` through the page's own input).

### A theorem file

```lean
/-! # Zero plus n
On `Nat`, addition recurses on its SECOND argument, … -/   -- the picker's title and the blurb
-- @try exact rfl                                         -- another candidate on every goal
-- @depth 5                                               -- the cap (default 4; `intro` is free)
theorem zero_add_nat : ∀ n : Nat, 0 + n = n := by         -- ONE theorem, core Lean, no imports
  intro n                                                  -- a worked solution: its tactics are
  induction n                                              -- candidates, and publish replays it
  · rfl
  · omega
```

Write the statement with every binder AFTER the colon (the root goal is the
theorem's type), name arrow hypotheses in the statement where the solution uses
them (`(hab : a = b) → …`), and spell the solution with the canonical names
(below) so its lines are the baked ones.

### Names

The bake is **canonical**: one spelling per binder, or the visitor's choice of
names multiplies the states (up to 30× in the spike). `intro` names each binder
as the statement does (an anonymous one `h`, then `h_1`… — Lean's
`getUnusedName`), `rename_i` names `x✝` as `x` and a proof `a✝` as `ih`. The
page then **aliases**: any name a step introduces (present in a goal it leaves,
absent from the goal it starts from) may be typed differently — `intro a b hab`
is the baked `intro p q h` — and the subtree shows the visitor's names (renamed
on the tagged print, so the plain and tagged prints agree; Lean's error texts
and the popups' strings are renamed word by word). A respelling that would show
two hypotheses alike is refused. Not aliased in v1: a pattern whose
alternatives bind the same canonical name in different goals
(`rcases h with hp | hq` against the baked `h | h`) — the completions show the
baked spelling.

### Typed text → a step

`play()` (`web/src/playgroundAnswer.ts`): expand `\` abbreviations (the
editor's own table, `@leanprover/unicode-input`), collapse whitespace, read the
visitor's names back through the aliases, then match the goal's baked tactics
**token by token** (`n+1` = `n + 1`); failing that, the same tactic with its
introduced names respelled. The outcome comes from `answer(goalKey, tactic)` —
THE seam, one async function; goals are named by their print, so a later live
engine (WASM Lean) whose goals print the same joins the baked graph. A miss is
"not in this demo" with the goal's baked successes as completions (and "the
demo was not explored past this goal" on a frontier state). An error is Lean's
own: the attempt draws as a failed step (recovery's `failed` kind) with the
message as its diagnostic, and the goal stays open in a copy below it; the next
attempt on that goal replaces the failure. Undo drops the last attempt; Reset
drops them all.

### What the page passes the view

Exactly the viewer's inputs (`BakedCode`, `BakedPopups` — the bake's popups
plus renamed copies — the viewer theme) and ONE narrow hook, `onTryTactic`
(+ `getGoalTactics`, the in-place editor's completion pool): the `+` chip on an
open goal opens the in-place editor and its commit comes to the page; `sorry`,
`calc` and `step` are not offered (they write source). Every Lean-only move is
absent through `caps`/`availability` as on the viewer; `caps.play` gates the
`?` panel's row. The page starts in the `all` context (an open goal has no
consumer, so `used` would show nothing) and follows the newest step as the
editor's caret would (`highlightPos`). A bar under the tree — goal picker,
input, Try, Hints — is the same question for a phone. Phones are baked-only.

Measured 2026-10-05 (12 theorems): 105 KB gzipped of data (2.4–23 KB each),
the bundle 696 KB / 235 KB gz, baking ~40 s.
