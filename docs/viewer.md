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

The page opens in layout `wide`, context `diff`, one rail zoom step in
(`initialZoom` 1.25); the reader's own layout, context and comments ride the
hash beside `t=` in the viewer's words (`#t=ZeroAdd&layout=spine`, defaults
left out). The goal panel's hints are RANKED (`rankedCompletions`): "Closes
this goal", "Makes progress" (a goal left that the bake explored), "Other
moves" dimmed. An open goal the bake never explored (`frontier`, live Lean
off) is drawn dashed at `STUB_OPACITY` (`offMapGoalIds`) and the panel says
"Not explored in this demo — Undo to go back". A proof whose lines the
auto-indent nested under the first is named (`swallowed`, playgroundText.ts).
A complete proof washes the theorem strip in `--ptw-closed` with "Proved";
the tree pane draws no signature header (`signatureHeader={false}`: the
editor's first line is the signature). The live tier is offered by one quiet
line at the foot of the goal panel.

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

### The source (v2, 2026-10-05)

The page's source of truth is now **Lean text in an editor** (CodeMirror 6,
`web/src/playgroundEditor.tsx`; vim through `@replit/codemirror-vim` behind
the header's toggle, a 41 KB gz chunk loaded only when switched on —
`publish.mjs` bundles the playground code-split; `\` abbreviations; Enter keeps the indentation), with the
tree beside it. Every edit replays the whole body (`replayText`,
`web/src/playgroundText.ts`, debounced 180 ms; answers cached per goal state)
through the same `play()` path, with Lean's tactic-block semantics read by
line and column: a tactic works on the main goal, deeper lines continue it,
`·` takes the next goal, `case tag =>` the goal by tag, `cases …/induction …
with` + `| tag names =>` alternatives name each case (replayed as the split
then `rename_i names` on that case), `sorry` leaves its goal open, a failure
stops its block (a `·`/`case` block recovers, so its siblings run). Comments
are not tactics, but they are the tree's: `bodyComments` reports them as the
harvest does (`proof.comments`), each step's range for the tree is widened to
its line's end as Paperproof's positions are (so a trailing `-- note` is its
own step's), and the strips, `.fold`/`.none`/`.mark` flags and comment editing
work as in VS Code. A replay that takes over 300 ms (live Lean) shows
"Lean is checking…" in the goal panel. Not understood: `;`/`<;>` sequences on one line (they run as one
tactic), `next`, `all_goals` and other combinators with blocks.

The tree **writes the text**: each open goal has an `Anchor` (where its next
tactic goes: a new line under the block, `case tag =>` for a later goal,
a `sorry` replaced, a missing alternative added), the `+` chip, the goal
panel's hints and the Quick Fix rows write through it; double-click edits a
step's line (`getTacticEdit`/`onEditTactic` over the step's real range); the
trash deletes it (`deleteSlots`, the widget's `deleteEdit.ts`); ⌘Z in the tree
is the editor's undo; `»` reveals the line. The text is kept per theorem in
`localStorage` (with the vim and source toggles), never relied on.

**The goal panel** (under the editor, replacing v1's input bar): with the caret
on a step, the goal that line works on and Lean's message where it failed;
elsewhere, the open goal being worked on (a picker for several) — tagged, with
hovers — and its baked tactics as chips that write into the text. Where the
goal's hypotheses are inaccessible (`h✝`) because a split was written without
alternatives, it says so and offers **Name the cases** (`web/src/nameCases.ts`:
`cases h` → `cases h with` / `| inl h => sorry` / `| inr h => sorry`, the
dagger dropped, `a✝` → `ih`, a taken name primed). The same rewrite is the
tree's Quick Fix `namecases` (lightbulb, both wires).

**The baker** guides the FIRST `cases h` of a PROPOSITION (`∧ ∨ ∃ False`)
along each path — where a learner meets `h✝`; before, its cases were never
explored, so the hint led to a dead end — and makes `rename_i` free under the
depth cap, as `intro` is. Data splits stay guided only by the solution, and
only the first split per path: guiding every split ran AppendLength for 19 min
unfinished, and guiding data splits took RewriteChain from 144 to 4,891 states.
Data 106 KB → 181 KB gzipped (budget 2 MB). `publish.mjs` now also replays each theorem's
written solution **as text in the editor** and fails the build if it does not
close.

### Live Lean (opt-in)

**Run real Lean** (header) starts a Web Worker that downloads Lean compiled to
WebAssembly and answers what the table lacks, AFTER the baked engine behind
`answer` (`web/src/playgroundLive.ts`; the engine is `lean/PlaygroundLive.lean`,
the baker's own stepping code; goals come back in full and the table grows).
It needs cross-origin isolation (COOP/COEP) for threads — see "Deploying live
Lean to a static host" below for how a host with no headers gets it; the
downloads are kept in Cache Storage (`ramify-live-v1`), keyed on the
manifest's version (else Last-Modified). Turning it on is the one opt-in
and there is no off: later visits start it by themselves (localStorage, or
the files already in Cache Storage), the header button goes once Lean runs,
and until the reader opts in an arrival notification offers it. Build and serve locally:

```bash
scripts/wasm/build-mac.sh                        # once: emsdk, C, objects, CLI, Init oleans, engine (≈ 40 min)
scripts/wasm/build-mac.sh engine                 # after a change to lean/PlaygroundLive.lean (≈ 7 min)
node web/scripts/serve-playground.mjs            # http://localhost:8642/playground.html
node web/scripts/serve-playground.mjs --native   # the same page answered by the NATIVE engine
node web/scripts/live-check.mjs BAKES [--engine "node scripts/wasm/live-stdio.mjs …"] [--kinds]
```

`live-check` replays every baked step through an engine and requires identical
answers (goal keys, kinds, uses, errors up to metavariable numbers): 8,308 of
8,308 on the published bakes (and 36,179 of 36,179 on a wider bake), native
and wasm. Live goals are TAGGED (hover popups, `lean/ProofTreeBake.lean`, the
bake the CLI wire uses) and, where the demo has no hints for a goal, **Hints**
asks live Lean which of the baker's own candidates succeed there. The engine imports `Init` at the EXPORTED level
(`isModule := false`, so the file's own declarations stay public) and the
download omits `.olean.private` (a two-line Lean patch skips a missing part):
the identity check is what licenses that. docs/wasm-spike.md §6–7.

#### Deploying live Lean to a static host

GitHub Pages sends no COOP/COEP and will not reliably compress a `.wasm` or a
`.tar`. The layout (one origin, two Pages sites, so no CORS and the main repo,
which Lake clones on every install, never carries the binaries):

```
https://aidanmaney.github.io/ramify-lean4/playground.html   the page (+ coi-sw.js beside it)
https://aidanmaney.github.io/ramify-live/                    package-live.mjs's folder (its own repo)
```

```bash
node scripts/wasm/package-live.mjs [--from build-wasm/out/web] [--out build-wasm/out/deploy]
cd web && node scripts/publish.mjs --playground ../demos/playground.txt --live-base /ramify-live/
```

- **Assets** (`package-live.mjs`): `worker.js` (scripts/wasm/playground-worker.js),
  `live.js`, `live.worker.js`, `live.wasm.gz` (13.9 MB, from 68.9), `init.tar.gz`
  (33.0 MB, from 87.5), `.nojekyll` and `manifest.json` `{version, download,
  files: {name: {bytes, gzBytes}}}` — `version` a content hash, `download` what a
  start fetches (47 MB). gzip -9; it fails if any file is over 50 MiB. The worker
  reads the manifest, downloads the `.gz` forms with progress in compressed bytes
  against `gzBytes`, keeps the COMPRESSED bytes in Cache Storage under
  `<url>?v=<version>` (a new version evicts the old) and decompresses with
  `DecompressionStream("gzip")` (skipped where the bytes are not gzip, i.e. a
  server already decoded them). No manifest (serve-playground's `/live/`) = the
  old uncompressed layout, unchanged.
- **Isolation** (`web/public/coi-sw.js`, copied beside playground.html by
  publish.mjs): a service worker that re-serves the PLAYGROUND navigation with
  COOP `same-origin` + COEP `require-corp`, and every same-origin response with
  CORP `same-origin` (other pages in its scope pass through untouched).
  Registered ONLY on the reader's ask (the header button or the goal panel's
  offer) where the page is not isolated already; then one reload, marked in
  sessionStorage, and the page that comes back starts live Lean by itself. A
  reader who never asks gets no service worker and no reload; where registration
  fails the button says so in words. Later visits are controlled (isolated) and
  start from Cache Storage as before; an automatic start never reloads.
- **Workers**: a worker made from `/ramify-live/worker.js` is held to ITS OWN
  response's headers (none on Pages) and lies outside the service worker's
  scope, so it is blocked by COEP — measured. The page makes it from a BLOB that
  `importScripts` the script, which inherits the page's isolation
  (`crossOriginIsolated` true, SharedArrayBuffer present, measured), and the
  worker does the same for Lean's pthread workers (`locateFile` of
  `live.worker.js`).
- **Safari: the page's main thread** (docs/wasm-spike.md §8, 2026-10-25). A
  Safari worker's 512 KiB native stack is less than some answers need, so where
  the page's JS stack is at least 4× a worker's (Safari 12.7×, Chrome 2.0×,
  measured by the same recursion in both; no user-agent test) the SAME
  `worker.js` is loaded on the page and run there (`self.ramifyLiveHost`;
  `pagePort` in playgroundLive.ts), Lean's pthreads still blob workers. The page
  freezes for each answer, after a quiet-screen wait (`web/src/quietScreen.ts`:
  no finite animation, no input for 150 ms, a painted frame; capped at 1.5 s);
  a restart terminates the old instance's threads. `?live-host=main|worker`
  forces a host; the choice is one console line.
- **The base** is the build's: `--live-base URL` writes `<meta
  name="ramify-live-base">` (default `live/`, empty = no live tier); `?live=`
  still wins. Offered where a base is set AND the page is isolated or can
  register a service worker, never on a coarse-pointer-only device or under the
  playground's narrow breakpoint. The offer's size is the manifest's `download`.
- **Measured** (2026-10-24, Chrome, a plain `python3 -m http.server` mirror of
  that layout on 127.0.0.1): click → reload ≈ 20 ms; first start (localhost
  download, unpack, start, import Init) ≈ 9 s to ready; reload from Cache
  Storage ≈ 3.5 s to ready, no `.gz` requested. The Claude desktop app's browser
  pane cannot register service workers at all (the script fetch never leaves it),
  so test in a real browser.
