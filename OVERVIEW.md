# Proof-tree visualizer — project overview

> **Provenance.** This document was written by an LLM (Claude, working in this
> repository) and is kept as a **secondary record**: a navigable tour of a
> system whose primary sources are the code, the README and `CLAUDE.md`. It is
> not a specification and carries no authority over them — where it disagrees
> with the code, the code is right. It is included because a reader coming to
> the project cold benefits from a level of description that sits between the
> README's orientation and `CLAUDE.md`'s dense per-decision record, and because
> that middle level is otherwise unwritten. Treat particular claims,
> measurements and file references here as needing confirmation against the
> source before being relied on.

A technical tour of the whole system, one level below the README and one level
above `CLAUDE.md`. It assumes passing familiarity with Lean 4, functional
programming and parsers, but explains everything specific to this project.

Where a design looks arbitrary, this document tries to say why. Most of the odd
choices here came from measuring something and finding the obvious approach
wrong, and it is cheaper to record those results than to rediscover them.

Companion documents: the [README](README.md) covers orientation and building,
and [CLAUDE.md](CLAUDE.md) is the dense engineering record — the constraints,
measurements and traps behind individual decisions. This file sits between them.

---

## 1. What it is

A Lean 4 proof, rendered as an interactive tree inside the VS Code infoview.

The tree is not a picture of the proof term. It is a picture of what the tactic
script does to goals. Each tactic becomes a node, each goal becomes a box, and
an edge means "this tactic turned this goal into these goals". Everything
structural about a proof — case splits, side conditions, `calc` chains, nested
`have` blocks — falls out of that one relation, with no special-case drawing.

The tree is also an editing surface, not just a viewer. You can type a tactic
into a node, add one to an unsolved goal, stub a branch with `sorry`, open and
grow a `calc` chain, delete a step, and undo. Every edit goes through the
editor's own edit pipeline, so the buffer and the undo stack stay
authoritative.

Roughly 4.8k lines of Lean, 16.9k lines of TypeScript/React, and a 1.2k-line
VS Code companion extension.

---

## 2. Architecture: two data sources, one renderer

The most important structural fact: two independent pipelines feed the same
renderer.

```
# 1. Live infoview widget (the product):
cursor pos ──ProofTree.getProofTree RPC──▶ Proof ──proofToTree──▶ tree

# 2. Offline CLI (development harness):
proofs/*.lean ──ppharness (Lean CLI)──▶ NDJSON ──proofToTree──▶ tree
```

`ProofTreeView.tsx` is the shared view. It takes one `Proof` plus optional
hooks, and knows nothing about where the proof came from. `widget.tsx` feeds it
over RPC inside the infoview. `App.tsx` feeds it from the generated NDJSON
file, as a standalone browser app (`npm run dev`) that draws the same trees
with no editor and no language server involved.

Wire 2 is development equipment and ships nowhere. `dist/lakefile.toml`
declares no executable at all, and the install branch (`main`) carries only the
three Lean sources the widget compiles — `Ppharness.lean` and `Main.lean` are
not in it. Nothing an end user installs can run it, and nothing needs to.

The reason to keep the second pipeline is testability. The pure client modules
(`calcEdit.ts`, `deleteEdit.ts`, `completion.ts`, `diagnostics.ts`,
`layoutKey.ts`) can be run offline against a corpus of real harvested proofs,
with no language server in the loop. One deliberate consequence: any editing
data that is plain data (`tacticSlots`, `deleteSlots`, the calc structures) is
sent on both wires, precisely so offline probes can exercise the real logic.
Only data carrying live RPC references (tagged goals, token hover info) stays
widget-only, because a reference means nothing outside the session that
created it.

One rule keeps the split honest: `proofToTree.ts`, `layout.ts` and
`ProofTreeView.tsx` may not import either data source's APIs. Only
`taggedRender.tsx` and `tacticTokens.tsx` are allowed to touch infoview APIs.

---

## 3. The Lean side

### 3.1 Harvesting a proof

When Lean elaborates a file it produces an `InfoTree`: a trace that records,
for each tactic, the goals before and after it and the metavariable context
needed to print them. Both pipelines read proofs out of that trace through an
upstream dependency, **Paperproof** — pinned to an exact commit (forking it is allowed as of 2026-09-09 where post-processing runs out) —
whose `BetterParser_Tree` turns an `InfoTree` into a list of proof steps.

- `lean/Ppharness.lean` + `Main.lean` — the CLI. It elaborates a file to
  completion with `IO.processCommands` and prints one NDJSON line per proof.
- `lean/Ramify.lean` — the widget. Its `@[server_rpc_method]
  ProofTree.getProofTree` runs the same parser over the live server's
  `snap.infoTree`, reached through `withWaitFindSnapAtPos`. No CLI, no NDJSON.
  The same file embeds the compiled renderer bundle with `include_str` as a
  `@[widget_module]`.

The former standing rule was **never fork the vendored parser** (struck 2026-09-09; post-processing remains the first choice). Anything the project
needs beyond upstream's output is added by post-processing — fixing up labels,
shipping extra payloads alongside the steps, and running separate walks over
the same `InfoTree`. That keeps the project able to track upstream, and it
confines the risk of a Lean version bump to a small surface.

### 3.2 What post-processing adds

`lean/ProofTreeComments.lean` (imports only `Lean`, no Paperproof types) is a
shared toolkit used by both pipelines. It re-lexes the proof's source text and
walks its syntax to recover things the `InfoTree` cannot tell you:

- **Comments.** Comments are parser trivia and never appear in an `InfoTree`,
  so they are re-lexed from source (handling `--`, nested `/- -/`, strings and
  char literals) and shipped as text-plus-range records. Deciding which node a
  comment belongs to happens client-side, and it leans on an upstream quirk:
  a step's recorded range includes the trivia after it, so "is the comment
  inside the step's range" is exactly the test for "is this a trailing
  comment".
- **Tactic slots.** The direct children of every `tacticSeq1Indented` /
  `tacticSeqBracketed` — in other words, one tactic as the author wrote it.
  This is the unit used for deletion. It is deliberately not the step range,
  because step ranges are wrong in both directions: `intro p hpm` is one step
  whose range covers only `intro p`, and an `induction … with` step's range is
  cut off at its first case marker.
- **`calc` blocks**, including blocks that never elaborated. These are found by
  descending the syntax tree rather than the info tree, so a broken block
  still reports.
- **Holes** (`?_`, `?foo`). An info-tree walk gives each hole's goal, a syntax
  walk gives the surrounding link structure, and the two are joined exactly by
  metavariable id — never by position.
- **Relation enumeration for `calc`** — real `Trans` instances rather than
  guesses from symbols (see §9).
- **Verbatim edit ranges** (`tacticEdits`). The displayed `tacticString` is
  prettified and the recorded `position` includes trailing trivia, so neither
  is safe to write back into the document; these ranges are re-extracted from
  source instead.
- **Label fix-ups**, applied the moment the parser returns, before anything
  else reads a label. Upstream's prettifier loses real information in two
  ways. It re-synthesises `rw` labels without their location clause, even
  though `rw [h]` and `rw [h] at hn` are different tactics. And it implements
  "strip trailing comments" as literally "keep the first line", so a
  multi-line tactic lost its `with ⟨…⟩` tail entirely. Both are restored from
  source, with guards narrow enough that every deliberate truncation — case
  bodies, nested `by` blocks — stays truncated. Measured on regeneration: all
  pre-existing corpus proofs came out byte-identical.

### 3.3 The recovery parser

`lean/ProofTreeRecover.lean` draws what the upstream parser structurally
cannot: **failed tactics and term-mode proofs**.

Upstream cannot even see a failed tactic. When a tactic fails, `evalTactic`'s
error handler restores the info tree and may assign `sorryAx`, so a proof whose
only tactic failed harvested zero steps and zero goals. The tree went blank at
exactly the moment it would have been most useful.

The design decision that made recovery cheap: the recovery parser emits data in
the same shape as the ordinary harvest — real `ProofStep`s and `GoalInfo`s,
merged in the moment the parser returns, on both pipelines. Every downstream
feature therefore works on recovered steps with no client changes. The fact
that a step is synthetic travels in a separate `recovered` list, emitted only
when non-empty, so a clean corpus stays byte-identical.

It handles two cases:

- **Failures.** A slot counts as covered if some harvested step starts inside
  it. Uncovered slots are candidates — but uncovered alone does not mean
  failed, because `skip` records no step either. So a slot is classified as
  failed only when an actual error landed in it. Later uncovered slots in the
  same block are marked `skipped` and chained under ghost goals.
- **Term proofs.** Triggered by a `theorem`/`example` whose body is not a
  `by` block. Term structure (`have`, `let`, `fun`, nested `by`, `calc`,
  `match`) is mapped onto the same step shape.

The result: when the widget says "no proof here", there genuinely is none. It
no longer means "your only tactic failed".

### 3.4 Toolchain, and a disproved constraint

The project was pinned to **Lean v4.27.0** for months because of a recorded
blocker: "on v4.29+ tactic subtrees elaborate asynchronously and aren't
attached, so the parser returns empty proofs."

During the upgrade to **v4.32.2** that claim was tested and found false:

- `Elab.async` defaults to *false* for embedded drivers. Only the `lean` CLI
  and the language server turn it on.
- The info-tree collection in `IO.processCommands` is unchanged across the
  whole version range.
- Both pipelines were probed directly. The CLI harvest came back byte-identical
  to v4.27, step for step, and the live-server path — where async genuinely is
  on — was driven over LSP and returned complete proofs.

The real v4.32 trap was somewhere else entirely. `withImporting`'s `finally`
now clears the interpreter-initializers flag after **every** `importModules`,
so a batch run that armed the flag once had every file after the first come
back with an empty environment: no `Init`, every command a parse error, zero
steps, and nothing on stderr. `Main.lean` now re-arms the flag for each file.

This is the general habit of the project: a recorded constraint is something to
re-test, not something to obey forever.

---

## 4. The wire format

Paperproof's `ProofStep` / `GoalInfo` / `Hypothesis` structures are mirrored
field-for-field in `web/src/paperproof.ts`; changing one side means changing
the other. Two constraints shape everything built on top:

- **`ProofStep` cannot grow fields**, because it is upstream's type. New
  per-step data therefore travels in separate sidecar lists, keyed by
  `position.start`.
- **`Lsp.Range` must never cross the wire.** Its second field is named `end`,
  so a derived `ToJson` emits `{start, end}` while the client reads
  `{start, stop}` — a mismatch nothing reports. Use `DeclRange` or an explicit
  start/stop pair instead.

A related hazard on the client: `widget.tsx` rebuilds the incoming `Proof`
field by field, so a field someone forgets to copy is silently absent rather
than a type error.

---

## 5. From proof to tree

`web/src/proofToTree.ts` turns steps into nodes. Each step contributes
`goalBefore ──(tactic node)──▶ goalsAfter ++ spawnedGoals`, and the root is the
goal that gets consumed but never produced. Nodes are emitted in depth-first
preorder, which later machinery (layout order, elision arithmetic) depends on.

**A goal's local context travels with the goal node** and is drawn inside its
box, above the `⊢` line. Context lines are marked as used or unused from the
consuming tactic's `tacticDependsOn` — and this stays accurate even for
`omega` or `simp_all`, because Paperproof computes usage from the elaborated
proof term, so implicit uses are counted too.

There are **four context breadths**, named in words on the status bar's
`Context:` item (pick one from its list, or ⌥-click the item to advance):

| Mode | Bar reads | Shows |
|---|---|---|
| `used` (default) | `used` | what the rest of the proof *below* this goal depends on |
| `new` | `binders` | only what the producing tactic introduced (sometimes legitimately empty) |
| `delta` | `diff` | what the goal gained over its producer's input, plus older hyps the consumer uses |
| `full` | `all` | everything, accumulating down the tree |

A goal with no consuming tactic falls back to `delta`'s rule while in `used`
mode: "what the rest of the proof uses" is undefined at a live frontier, and an
empty box there would read as a bug.

One subtle correctness point: hypothesis ids (`fvarId`s) are not stable down
the tree — `rw … at h` mints a new one for `h`. So the subtree walk carries
`(fvarId, username)` pairs and matches by id first, falling back to the name.

Context lines are ordered data first, then propositions, with a hairline
divider between the groups. They are deliberately never wrapped mid-line,
because a break would destroy the exact `name : type` string that the
interactive type-tooltip renderer matches against.

---

## 6. Layout

`web/src/layout.ts` binds one tree and returns placed nodes and links,
whichever positioner ran, so the renderer never needs to know the layout mode.
There are four modes:

- **☰ stacked** (default) — a hand-rolled depth-first layout with a global
  y-cursor and per-branch x-indent. Hand-rolled because the standard Sugiyama
  algorithm forces all nodes of the same depth into one horizontal band; here
  every node gets its own vertical slot and branches stay next to their tactic.
- **⊦ spine** — two side-by-side tracks. Goals stack tightly down the left;
  each tactic sits in its own right-hand track, beside the seam between the
  goal it consumes and the goals it produces.
- **|| tracks** — the spine with the per-tactic zigzag removed: all the
  right-hand tactics share one column.
- **⑃ wide** — the original Sugiyama tree, normalised into the same placed
  shape, with a custom decrossing pass so that folding never reshuffles
  siblings.

Two details worth knowing:

**Source order is computed, not taken from the wire.** Upstream puts the main
continuation first, which is backwards for `by_cases`. So a node's rank is the
earliest source position anywhere in its subtree. That rank is then overridden
where a tactic's output goals are not really peers: a conditional rewrite
leaves the rewritten goal *and* a side condition, and the usual rule — last
goal in source order continues the trunk — would hand the trunk to the side
condition. Generated obligations are therefore marked, and the list of tactics
treated this way contains only what was actually measured to behave this way
(`rw`/`erw`; `apply` is deliberately excluded because its goals are genuine
peers).

A related bug surfaced late: a skip marker has to stand in for the source
positions of the nodes it replaced. A marker deliberately has no position of
its own, so the subtree-minimum of a collapsed branch fell to infinity and the
branch swapped places with its siblings. Measured: 145 of the 784 possible cuts
reordered the surviving nodes — meaning every cut the tree had ever drawn was
affected. Ranking markers by their members' recorded positions brought that to
0 of 784, verified by re-running the same sweep.

**Connectors carry a small mark near each end that tells you what the line
leads to**: a gap with a dot means the line ends at a goal, a gap with a dash
means it ends at a tactic. You know what you will find before following a line
off the trunk. The marks are painted over the stroke, never edits to the path
itself, and they sit only on the horizontal leg that belongs to that link
alone — a vertical run looks like the trunk (or has every sibling's elbow
drawn over it), so it stays clean. The wide layout draws no marks at all: on
its splayed curves the straight cuts look like debris, and the depth bands
already tell you what kind of node comes next. The marks are on by default
because they are the accessible baseline — the one channel that still works
without colour. Settings can swap them for emoji, or tint each edge toward its
target's hue instead.

**Box sizing uses canvas `measureText` in the exact font the tree renders in**,
because Lean labels are full of wide Unicode. Text is wrapped at a budget of
roughly 100 columns, preferring semantically sensible break points. The
renderer must then match the measurer exactly. This is a rule that recurs all
over the codebase: measurer and renderer come in pairs — change one, change
both.

---

## 7. Reading aids

A large proof is unreadable at full fidelity, so the tree offers several
independent ways to compress it. All of them compose, and all are reversible:

- **Folding and skipping are one mechanism, drawn in the two idioms readers
  already know.** Every hiding is a cut. `−` on a goal that continues its
  producer *skips* the step below it: the tactic and whatever it opened beside
  the continuation (a `have`'s side proof, a rewrite's side condition) go, the
  trunk stays, and the tactic remains in place cut down to its head in a dashed
  box with a `+N` badge for what it swallowed (`have gap… +2`) — the preview
  node. `−` on any other goal — a nested block's root, an `induction` case, a
  case under a split — and on every goal in the wide layout, where there is no
  trunk, *folds*: everything below goes and the goal itself is the reduced
  node, its corner reading `+N` — the collapsed-tree convention. Click the
  ghost, or the `+N`, to bring it back. The hover-bar skip on a tactic mints
  the same cut, `.fold` and `.none` flags in the source seed cuts, `collapse
  all` folds every branch root (the outline), and the cursor peeks a seeded cut
  open when it enters the source it stands for. Measured on the corpus's
  biggest proof: the goal after `have key` takes 71 nodes to 70 with the rest
  of the proof still drawn; the root's skip 71 → 57; `collapse all` 80 → 14.
- **Brief mode (⋯)** collapses boilerplate within a label. The rules are
  deliberately asymmetric, and getting the asymmetry right was the actual work.
  For a binder-like tactic, the keyword is dropped and the statement kept
  (`have hp1 : p ∣ 1 := …` → `… hp1 : p ∣ 1 := …`): the statement is the
  content, the command word is ceremony. Every other tactic keeps its keyword
  and loses its arguments (`exact ⟨…⟩` → `exact …`): there, the keyword is
  what you skim for. A single uniform rule was tried first and measured wrong
  for half the cases.
- **Comment strips off** — a global status-bar toggle plus a per-node hide.
  Both take effect at the one place a strip is measured, so a hidden strip
  gives its room back to the layout; this is geometry, not just paint, and it
  was measured at −8.8% total corpus height. The per-node set survives the
  global switch being flipped, because turning comments back on globally
  should not silently undo the ones you hid individually.
- **Skip** (elision, in the code) — two kinds of cut sharing one mechanism: a pure transform on
  the node list, applied before layout, because a layout-level mask can only
  hide whole subtrees and a cut in the middle of the tree must keep what hangs
  below it. The two are a **band** (the marquee selection's `skip` verb, over
  an explicit set of nodes) and a **step cut** that removes a tactic
  together with everything not reachable through its continuation. Its button
  is a small drawn dashed box — a picture of the ghost the gesture leaves
  behind, where the dotted circle it replaced named nothing on screen. Which child
  counts as the continuation is read from semantic markers on the nodes, not
  from geometry. A leaf tactic is declined outright: it opened nothing, so
  there is nothing to skip. Overlapping
  cuts are made disjoint before applying. Two cuts sharing a node used to
  emit two markers that pointed at each other — a two-node cycle, drawn as
  links running back up the tree through ghost boxes. Of 318 possible
  overlapping pairs, 159 cycled; after the fix, none. When two cuts overlap,
  the bigger set wins (nested `.none` flags create the outer cut first, so
  preferring the more recent cut would drop the outer flag), and the losing
  cut is remembered rather than discarded — removing the survivor brings it
  back.
- **Marquee selection** — dragging on the tree background rubber-bands a
  rectangle, and a row of verb chips appears above the selection: skip,
  merge, hide/show notes, and the flag writers described below. The
  chips sit on one opaque backing card, because the row lands wherever the
  selection's top edge is — routinely on top of tree ink, where outlined chips
  with the tree showing through are unreadable.
- **Merge** — every maximal straight-line run of tactics collapses into
  a single node that joins their labels, keeping per-token colouring intact.
- **Focus and path** — the two scoping views, mutually exclusive, each with a
  breadcrumb in the header that names it and exits it. **Focus** (◎ or ⌥-click
  on a goal) scopes to one subtree. **Path** (⊹ on any node) shows only the
  way to that node from the root and everything under it — the reading you
  want when a branch is the answer and the rest of the tree is context. Both
  are view state keyed on source facts and remapped across a re-elaboration;
  neither suspends folding.
- **Gallery** — show one of a branching tactic's subtrees at a time, with
  a pager. It follows the editor cursor: if the cursor lands in a hidden
  branch, the gallery pages to it.
- **Side-by-side** — a branching tactic's subtrees become columns. Columns
  are packed by contour: each column's ragged left profile slides left until
  it nearly touches the previous column. The contour includes the connector
  lines, mirroring exactly what the renderer draws.
- **Width (status bar)** — re-wraps labels and comment strips at a narrower,
  slider-controlled width. The key discovery: labels were never the limiting
  factor. Most wide boxes are wide because of their widest *context* line, so
  the width setting wraps those too — at a known cost: a wrapped hypothesis line no
  longer matches its measured text, so it loses its type tooltip. In the
  **tracks** layout the same setting has a second, direct input: the boundary
  between the goal column and the shared tactic column is drawn as a hairline
  **seam** you can drag — right for more columns, left for fewer, with a live
  `44 col` readout beside the pointer. The seam is not new layout state; it is
  the column the aligned pass had already computed, published so the width can
  be set by pulling on the thing it governs.

Source comments can also carry **Alectryon-style display flags**: `-- .fold`,
`-- .none`, `-- .no-hyps`, `-- .h#name` and `-- .mark` are directives that seed
the initial view. `-- .mark` is the odd one out: it hides nothing, it drops a
**mark** — one stop in an ordered reading of the proof, modelled on VS Code's
CodeTour crossed with vim marks. `.mark 3` gives a mark an explicit rank
(explicit ranks sort ahead of bare ones, which run in source order), and the
comment's first sentence captions it. `<` and `>` step through the marks — from
a standing start `>` takes the first and `<` the last; the status bar's
`Marks:` item says how far in you are (`–/5` before you have started), its two
slots which of the two lists are on — the source's `.mark`s and your own
temporary ones — and ⌥-click cycles them (both → source → temp → none, where
the value reads a dimmed `off`). A mark of your own is dropped from the nub at
a box's top-left corner; ⌥-click there writes the author's `.mark` into the
source instead. A proof with `.mark`s wears its tabs the moment you open it.
Esc lets go of the current mark and leaves the list where it was. A mark hidden
inside a fold or a hop is *peeked* open for as long as you are reading it — a
reading never destroys your folds. The parse order matters: flags are parsed before the markdown
cleanup, because cleanup turns `` `.fold` `` into `.fold` — so prose merely
*mentioning* a flag in backticks used to become a directive. That happened for
real.

Flags are now **written as well as read**. The marquee pill's flag verbs
write the directives into the source — one comment line above the tactic, at
the tactic's own column — and remove them again, closing the loop with the
read side. They live behind a single expanding `flag` chip: the resting pill
reads `skip · merge · comments · + · flag`, and clicking `flag` opens the five
writers in place in the same card (clicking it again, Esc, or a click on the
background shuts them). Writing flags by hand remains fully supported, and is exactly what
the write path round-trips through. The rules for where a written flag lands
were settled by an offline probe that patches the source, runs the real
attribution code, and asserts which node the flag lands on: 95 of 95 passed,
with 8 cases correctly declined.

Two `.none` refinements came out of real reports. First: a `.none` on a
closing (childless) tactic used to disappear without a word. Two independent
checks each — correctly — refused to cut a childless step, but both were wrong
for a *written* directive, because a closing step's ghost carries the author's
sentence, which is worth strictly more than the label it replaces. `.none` on
a closing step is now honoured when it carries prose; a bare `.none` there is
still refused, and the pill's prompt treats an empty commit as a cancel rather
than writing a directive that would do nothing. Second: the note is durable
across gestures. Expanding a flagged ghost and then putting the step away
again by hand used to replace the author's sentence with `⋯ 1 tactic`; the
ghost label now falls back to the flagged tactic's own note no matter which
gesture cut it. Deliberately narrow, though: only for a cut that is about that
one step. A band sweeping five steps with one flagged among them keeps
`⋯ 5 tactics`, because a sentence about one step should not stand in for the
other four.

---

## 8. Editing from the tree

Double-clicking a tactic swaps its box for a textarea. This forces a server
seam, for the two wire facts named in §4: the displayed label is prettified and
the recorded position includes trivia, so neither can be written back to the
file. The server therefore ships verbatim re-extracted source ranges, and
commits go through the editor's own `applyEdit` — so undo, re-elaboration and
every other extension behave normally.

The editor stands exactly where the box stood: its border box is the box's own
rect — same left edge, same top, same height, same corner radius — and it says
"you are editing" with the border's *colour* (the accent, or the prose ink for
a comment) rather than by drawing a smaller rectangle inside the one it
replaced. Its border and padding add up to the box's own text inset, so the
first glyph does not move when the editor opens: measured, 0.16px against
1.16px before.

Around that core sit several features with deliberate shapes:

- **Syntax colouring while typing** uses a mirror element behind a transparent
  textarea — the only way to paint rich text underneath a real caret. The trap
  was inherited CSS: a textarea is insulated by the browser's user-agent
  stylesheet, but a `div` is not, so the app root's `text-align: center`
  quietly put the mirror's glyphs 68 pixels away from the caret.
- **Completion** comes from what is already on screen — the goal's hypotheses,
  its subterms, and the imported tactic names — with no RPC round-trip. Full
  `idCompletion` over RPC was measured (3.8s cold, ~525ms warm, up to 240k
  items) and rejected. A fourth tier, global names, was added later over a
  dedicated RPC — but as a carefully priced prefix scan, with each earlier
  objection answered structurally: the expensive per-declaration work is never
  triggered, results are truncated to 50 on the server, queries need a
  3-character prefix at both ends, requests are debounced, and answers are
  cached per editing session.
- **Unicode abbreviations** (`\dvd` → `∣`) reuse upstream's own table and
  state machine, adapted to the one host upstream never targeted: a controlled
  React textarea. Every code path that writes the draft text must report
  through one synchronisation point, because otherwise a later flush can
  resurrect a stale draft.
- **Frontier chips.** An unsolved goal grows dashed chips below its box: `+`
  to write the next tactic, `sorry` to stub the goal in one click. The shape
  of the insertion (bullet, case marker, plain line) is computed from the
  producing step and shipped as data, and the insertion column is read from
  the source — both of the plausible client-side answers turn out to be wrong.
- **Delete** (a trash can in the hover bar) is the only destructive gesture,
  so it arms on the first click and only writes on the second, previewing the
  exact text range in the buffer in between. Hovering the can *before* arming
  fades the nodes the extent would take — the same set the armed state dims,
  computed by the one helper both read. When a tactic shares a line with a
  neighbour, it declines rather than guessing.
- **Undo/redo from the tree** exists because every widget edit leaves keyboard
  focus in the webview, where ⌘Z reaches nothing.

---

## 9. The `calc` arc

`calc` got more design attention than any other feature, and its history is
worth telling.

A `calc` block is one tactic node whose links are its children. The governing
rule: **every link the tree generates is justified `by sorry`, never `?_`.** A
hole is an unsolved goal — an error — so a half-written chain would break the
file it was written into. A `sorry` is a warning and a complete term, and it
comes back to the tree as an ordinary editable node.

The tree can *open* a chain on a goal that is a relation, *grow* one above an
unproved link, *append* to a chain that stopped short, and *repair* a block
that never parsed at all. That last case matters because a `calc` with no
valid first link fails to parse and swallows whatever follows it — the first
thing to check when a proof mysteriously disappears.

Two findings shaped the gestures:

**Relations are enumerated from real `Trans` instances**, not guessed from
symbols. The acceptance test is that the goal's relation chains with *itself*,
because `Trans Eq r r` holds for any relation whatsoever — so accepting "some
instance verified" would offer `calc` on `∨`. Three bugs here could only be
found by running the code. The best of them: a `have`'s continuation goal
arrives wrapped in metadata, and the relation decomposition saw the wrapper,
answered "not a relation", and silently declined the chip exactly where it was
most wanted.

**A one-link `calc` does parse.** This was verified against the grammar and by
elaborating six test cases; whether the block parses depends on what *follows*
it, not on the link count. The project initially believed the opposite, and
that belief had produced a gesture which wrote a second, closing link using a
relation the author had not chosen. Correcting it produced a standing user
directive: no gesture ever inserts more than one line; ask for the left- and
right-hand sides separately; never place the author's expression inside a
relation they did not pick. That generalises to a project-wide rule — *prefer
leaving the author's text unfinished over completing it with something they
did not choose.*

The staged fill (insert the line first, then prompt for each side) also
exposed an interaction bug worth recording: a stage's blur handler must do
nothing. The real infoview reflows and moves focus the moment the insertion's
own re-elaboration lands, so if the stages had committed on blur — the way the
ordinary editor does — both prompts would have been walked to `_` before the
author ever saw them.

---

## 10. Diagnostics

Lean's errors and warnings are drawn on the tree itself: the worst diagnostic
on a node thickens its left edge into a coloured ribbon, and a pill in the
corner pages through all of them one at a time, unfolding and scrolling to
each.

Finding the right *source* for diagnostics took two wrong answers, both worth
knowing:

1. The `publishDiagnostics` notification only fires on changes, and a webview
   subscribes after it loads. On a small file the server finished elaborating
   first, so the feature drew nothing — while appearing to work whenever you
   were watching, because your attention kept the timing different.
2. `snap.msgLog` is empty on the live server. The file worker rebuilds its
   compatibility snapshots with the messages already drained off, while the
   CLI populates the field normally — so every offline probe reported the
   broken source as working.

What settled it was driving the real language server over LSP from a script.
That is now the recorded recipe whenever the widget path disagrees with an
offline probe.

Two constraints on the drawing: the surfaces reserve no space, because an
error overlay must not make proofs lay out differently — and diagnostics
attach against *all* nodes, not just visible ones, because a folded-away error
is precisely the one the pager exists to find.

---

## 11. Metavariables and holes

Three unrelated things arrive under this one name, and each has its own rule.

**Holes the author wrote** (`?_`, `?foo`) ship on both pipelines with two
flags: whether the hole sits inside a `calc` chain (which decides whether the
tree may grow a link above it), and whether a sibling tactic could be written
instead of filling the hole in place. The second flag is deliberately narrower
than "is a hole": where a sibling tactic *can* be written, it is the better
edit. `refine ⟨?_, ?_⟩` followed by `· exact h` is what a person writes by
hand; filling in place gives `refine ⟨by exact h, ?_⟩` — legal, and worse.

**Metavariables inside a printed goal** are almost always an artifact of
*when* the goal was printed. Paperproof prints a step's goals with that step's
own metavariable context, so anything a later tactic assigns still looks open:
`apply Nat.le_trans` shows `⊢ a ≤ ?m` even in a complete proof, while the
`exact` that consumes the goal prints `⊢ a ≤ 5`. The fix needed no new wire
data, because the resolved print already exists in the consuming step — the
client just keeps whichever print has the fewest metavariable occurrences.
Measured: of 179 goals printed both ways, exactly 2 differ, and both
differences are precisely a metavariable getting resolved.

**A genuinely open metavariable cannot occur in a clean file.** Lean refuses
to finish a command with one, so that state is always an error state. The
useful future work is linking the goals that mention `?m` to the node that
owns it, rather than badging goals in isolation.

Separately: **delayed assignment is real, and universal for `induction`.**
That is why an `induction` step has empty `goalsAfter` and its branches arrive
as "spawned" goals — and therefore why an unfinished induction branch draws no
frontier chips.

---

## 12. Living inside the infoview

A surprising share of the work is about being a good citizen of a panel you
don't control.

- **Tree first.** The infoview renders its blocks as siblings, and the blocks
  above the widget resize on every cursor move — which would make the tree
  jump constantly. There is no API for section order, but the widget shares
  the webview's document, so it injects a stylesheet (scoped with `:has()`)
  that turns the host into a flex column with the tree ordered first.
- **Folding.** The panel folds like a native infoview section, but the
  disclosure element is ours. The infoview only wraps a widget in `<details>`
  when a name field is set, and core only sets that field for a deprecated
  widget form, so the native wrapper never exists for this widget. Three
  things matter: collapsing must not unmount the component (all view state
  lives inside it), the marker attribute must sit outside the `<details>` so
  the ordering rules keep matching while collapsed, and the element whose
  height is measured must sit inside it.
- **Frame height.** The widget takes all the remaining viewport there is,
  less a fixed clearance at the bottom, because the infoview's own floating
  "Restart File" button owns that strip — and the status bar and the zoom rail
  sit in the frame's own bottom corners. The number that clearance is
  subtracted from is the widget root's top **in viewport
  coordinates**, and getting that wrong is what put the frame's bottom (and
  the status bar with it) below the fold in the real panel: the measurement
  used to add the page's scroll offset, i.e. it reported the root's position
  in the *document*, which agrees with the viewport only at scroll 0 and only
  while nothing above the tree has moved — and in the infoview the blocks
  above it resize on every cursor move. The listeners follow from the same
  fact: a `ResizeObserver` on the body sees nothing when a section above grows
  inside a fixed-height body, and `window`'s `scroll` event never fires for an
  inner scroller, so the scroll listener is a capturing one and a no-dep
  layout effect re-measures after every render. The height stays a CSS `calc`
  over `100vh` rather than a resolved pixel number, because a webview hidden
  while the panel is resized fires neither observer nor handler. Measuring a
  *collapsed* panel needed two different guards, because Chromium changed how
  a closed `<details>` hides its content and a webview can be either vintage:
  older versions drop the boxes entirely, newer ones keep stale boxes that
  only `checkVisibility()` admits are hidden. Whether the tree should stop
  short of the bottom edge or run right up to it used to be a setting
  (`ramify.tallFrame`) and then a fraction; both are gone — with an absolute
  clearance doing the real work, each was a second number saying the same
  thing, and the strip it left behind is real page that takes a wheel.
  The infoview host imposes no cap of its own on a panel widget's height —
  read off the shipped bundle after a report of a short frame: every element
  between the widget and the page body is an auto-height block box. What the
  frame is guarded against instead is being *shrunk*: the rule that reorders
  the sections makes the container a flex column, where a height is only a
  hypothetical, so the widget's item is pinned and the frame carries its
  height as a minimum as well.
- **The status bar floats over the tree, and it is always one row.** It is a
  card as wide as its content, hugging the bottom-left corner and capped short
  of the zoom rail's own column, over a tree that flows *under* it: the scroll
  container reserves nothing for the card, and the layout's full viewport of
  bottom padding means anything can still be scrolled clear of it. It hugs
  rather than stretches because a card held open to a fixed right edge reads as
  a strip claiming room it is not using. Neither of the other two answers
  to a narrow panel survived: clipping silently loses items off the right end,
  and wrapping buys them back by growing a second row over the tree. What a
  narrow panel gets instead is a **compact** row — the same items, the same
  order, the same menus, drawn as glyphs with the words moved into the
  tooltips they were already carrying. The switch is measured rather than
  guessed at a breakpoint: a hidden copy of the row, always rendered with the
  full labels, reports what the words would need (492px, measured), and compact
  is simply "that does not fit" in the *lane* — the frame less the two insets,
  never the card's own width, which with a hugging card is just what it already
  draws. It cannot oscillate, because the hidden copy says the same thing
  whichever row is drawn. Each compact glyph carries its own point size, set so
  they all ink to the same height: they come from four corners of Unicode, and
  at one flat size the tracks mark stood 6px taller than the outline mark. There are no dividers between items. The
  gesture
  reference (`?`) is the bar's last item and opens upward from it; the rail in
  the opposite (bottom-right) corner is down to zoom in, zoom out, and fit.
  Each bar item reads `Name: value` and ⌥-clicking one advances its setting
  instead of opening its list; a small drawn chevron says which items open a
  list. Two names are an *icon* rather than a word even in the full row — a
  speech bubble before `show` for comments, an outward double arrow before
  `full` for width, and `↺` for reset — where the value already implies the
  name and the row needs the width back; the tooltip always spells the word
  out. The icons are drawn, not typed: a character has to be chosen for what
  every font stack happens to have, and the two that stood here read as
  punctuation left in by accident rather than as controls. An item is highlighted only when it
  names a feature that is *on* (width, and the reading options): a choice
  among equals, like which layout is drawn, says which it is and leaves it
  at that. While a mode is up (an
  armed delete, a staged `calc` fill) a banner says so at top-centre, so the
  bar never changes shape underneath the pointer.
- **Interactive tooltips.** Goal labels get the infoview's own per-subterm
  type popups. Three invariants make that safe: text equality (a tagged line
  is only used if its stripped text equals the measured string), no second
  round of wrapping, and font normalisation.
- **Syntax colouring** uses the same pair of token collectors that the
  editor's own semantic-tokens request uses, so a token means the same thing
  in the tree as in the buffer. The map from token type to colour scope is VS
  Code's own documented default table, not a hand-picked one — anything else
  guarantees divergence. Where Lean emits no token, each gap was measured and
  handled on its own terms: numerals are filled in (the editor colours them
  from its grammar, which the tree doesn't have), operators deliberately are
  not (they are uncoloured in the buffer too), and brackets are reproduced
  from bracket-pair colourisation using a stack rather than a counter.
- **A hidden webview fires no animation frames** and no native focus or scroll
  transitions. This one fact shapes several implementations: timeouts instead
  of `requestAnimationFrame`, animation loops backed by a timeout that snaps
  to the target, and a preview harness that has to dispatch synthetic events.

---

## 13. The companion extension

`ext/proof-tree-companion/` exists because the infoview's editor API has no
`executeCommand`, and both of the available webview bridges fail (one silently
drops non-file URIs; the other navigates the webview to a blank page). So the
widget's Lean RPC writes a request file, and the extension watches that file.

Its flagship feature is the **lens**: a slim editor pane split directly below
the infoview, showing the real buffer with the tactic's exact range selected.
Same window, same document, same server — so vim bindings, LSP and keybindings
all still work, and nothing re-elaborates. This replaced a floating
auxiliary-window design that fought VS Code on every front: focus that landed
visually but not actually, no window-geometry API, and platform-specific
scripting. The lens can also draw each tactic's resulting goal inline at the
end of its line, Alectryon-style, costing no vertical space.

The companion is also the only channel through which the webview can read a VS
Code setting or the user's actual theme colours. A webview cannot get TextMate
token colours any other way — verified: the theme API exposes only light/dark,
and no CSS variable carries them. The extension resolves the active theme's
JSON, follows its `include` chain, and writes the palette to a file that the
widget reads back over RPC.

Because the relay is invisible by construction, both ends log. The extension's
output channel distinguishes a request that never arrived from one that
arrived and was skipped from one that arrived and threw.

---

## 14. View identity — the project's most repeated lesson

**View identity and view state must key on source facts — a declaration name,
a source position — never on anything elaboration mints.**

Metavariable ids are artifacts of elaboration order: any edit that changes how
many metavariables get allocated before a node renumbers that node. This
mistake was made **four times** — in the proof key, cursor tracking, relayout
anchoring and the staged calc fill — before it became a written rule.

The concrete failures are worth spelling out, because each one was a mechanism
built to hold the view still, defeated by exactly the edits it was built for:

- The proof key was once the root goal's mvarId. Inserting a `calc` renumbered
  every id in the theorem *below* the insertion, so the proof being edited
  "became a different proof" and the view scrolled the author away mid-edit.
  The key is now the declaration name.
- The relayout anchor was id-keyed. After commenting out one tactic, 8 of 69
  nodes still matched by id — versus 69 of 69 when keyed on source position.
- Fold, focus, scope and elision state were silently wiped by editing a
  *different theorem* in the same file, because not one stored id still
  resolved. Translating old ids to new ones by tree position recovered 10 of
  10, where ids alone recovered 0 of 10.

The resolution is to notice that there are two different identity questions,
and no single key answers both. "Is this the same place on screen?" is
answered by source position, because that is where the reader's eye rests.
"Is this the same node I folded?" is answered by the node's path in the tree,
which edits above the node cannot disturb, and which changes exactly when the
shape changes. Deliberately, the change *detector* still keys on mvarIds — it
has to fire precisely when the ids move, because that is when the remapping
has work to do.

---

## 15. Theming

Every drawable colour is a CSS custom property, so a theme switch repaints
without a React render. Two principles:

- **Everything anchors to the theme's own background and foreground.** Colour
  recipes are written once, as a mix of a hue into the theme's bg/fg; the dark
  block overrides only the inputs to those recipes. Vendor palettes used
  verbatim look neon against soft themes (Catppuccin, Solarized, Nord),
  because they were calibrated against their own backgrounds — so token hues
  are pulled 72% toward the live foreground.
- **Light versus dark is one decision, made once, for boxes and tokens
  together.** Deciding them separately just swaps a light-on-light bug for its
  mirror image. The decision derives from the background's measured luminance,
  not from VS Code's body class — which makes it correct for custom themes,
  high-contrast themes, and hosts that aren't webviews at all.

---

## 16. Distribution

`dist/` is the installable Lake package; `INSTALL.md` is its manual. The split
exists because the development lakefile requires **Mathlib** only so the
offline CLI can elaborate `import Mathlib` fixtures — the widget itself needs
none of it. Sources are shared, never copied: every library in `dist/` points
its source directory back at `lean/`, so the two packages cannot drift apart.

One consequence is worth flagging because it breaks a normal convention: the
compiled renderer bundle is tracked in git. This is forced, not chosen. The
Lean widget reads the bundle with `include_str`, a fresh clone runs no npm
step, and Lake has no hook for running one on behalf of a dependency. Without
the artifact in the tree, an install simply cannot build.

The companion extension ships the same way: a prebuilt `.vsix` (currently
0.0.6) is built into `ext/` (ignored) and copied into `dist/` (tracked), with
`INSTALL.md` kept in step by hand. A rebuild is needed whenever a new setting
lands, or existing installs never see it.

Both live in one public repository, [aidanmaney/ramify-lean4](https://github.com/aidanmaney/ramify-lean4):
development happens on the `dev` branch, and `main` is the install branch, a
hand-assembled subset of `dev` that users' `require` blocks point at. The two
branches have separate histories and there is no automated sync, so a change to
the widget, the shared Lean modules or the bundle has to be copied across to
`main` by hand — or installs silently run stale.

---

## 17. How it evolved

| When | What |
|---|---|
| **Jun 2026** | Initial CLI harness: parse `proofs/*.lean` to NDJSON, render with d3-dag. |
| **Jul 9–15** | The pivot: an infoview widget with bidirectional node↔source linking, type tooltips, a compact hand-rolled layout, and live editor-font adoption. The product stops being the harness. |
| **Jul 17** | Source comments in the tree; the hover action bar; **in-place tactic editing**; the floating control rail. The tree becomes writable. |
| **Jul 21** | The densest day: hypotheses merged into goal boxes, semantic tokens, full theme resolution, reflow mode, side-by-side columns, and the `+`/`sorry` frontier chips. |
| **Jul 22–23** | Reading aids mature — gallery, relayout anchoring, display flags, brief mode, the three elision cuts, combine — and `calc` chains get drawn as columns. |
| **Jul 24** | `calc` becomes editable: append to a chain that stopped short, repair one that never parsed. |
| **Jul 29–30** | Context breadth by what the proof *below* uses; two-track layouts; `calc` stubs replace holes; **packaging for installation elsewhere**. |
| **Aug 2** | Staged `calc` opening (one prompt per side), overview mode, easier unfocus. |
| **Aug 5** | Metavariables and holes as first-class; keyword hover docs; a global-name completion tier; the **v4.27 → v4.32.2 toolchain upgrade**; native-feeling panel folding and frame-height control. |
| **Aug 7** | Link target marks on connectors; floating aside comment strips (with the track-floor overlap fix behind them); companion 0.0.2 and an INSTALL.md catch-up. |
| **Aug 8–9** | **Marquee selection with a verb pill** — flags become *writable*; comment strips toggleable globally and per node; multi-line labels get their dropped tails back; `.none` works on closing steps and its note is durable; two elision correctness fixes (sibling reordering, overlapping cuts); companion 0.0.3. The corpus reaches 23 proofs. |

The shape of the arc: harness → widget → reading → editing → robustness →
distribution → integration polish. One thing stands out: the diagnostics and
recovery work — making the tree behave well on *broken* proofs — arrived late
but changed the product's character. Before it, the tree was most likely to
vanish exactly when a proof was going wrong.

---

## 18. Recurring engineering rules

Distilled from the codebase's own recorded rationale; each was learned the
hard way:

1. **Post-process the vendored parser before forking it** (the outright ban was lifted 2026-09-09).
2. **Key identity on source facts, never on elaboration artifacts.**
3. **Decompose syntax by kind, never by argument index** — the index is the
   current shape, not a contract. This one bit twice.
4. **Measurer and renderer come in pairs** — change one, change both.
5. **Prefer leaving the author's text unfinished** over completing it with
   something they did not choose.
6. **A hidden webview fires no animation frames** — and no focus transitions,
   which is why some bugs survive verification in a preview harness.
7. **Probe the real thing.** Offline probes vouch for broken behaviour
   whenever the live server differs; when the two disagree, drive the actual
   language server over LSP.
8. **A recorded constraint is a hypothesis.** The nine-release toolchain jump
   was unblocked by disproving one, at the cost of two compile fixes.

---

## 19. Known gaps

- **Fixture files drift, and the notes about them go stale silently.** Two
  were found wrong on 2026-08-07 and corrected: the Natural-Number-Game
  exercise file is `ProofTreeGoalsDemo.lean` (not `ProofTreeGoals.lean`, which
  is now a small solved companion), and `ProofTreeDemo.lean` has grown from a
  "minimal demo" into a ~580-line intrinsically-typed λ-calculus development
  that currently elaborates with 14 errors. Neither is a Lake target, so
  `lake build` stays green and nothing announces the drift — re-measure before
  trusting a count.
- **Open metavariables are not yet surfaced.** The owning node already exists
  in the tree, so the useful step is linking the goals that mention `?m` to
  it, rather than badging goals in isolation.
- **Known accepted limits**, recorded rather than hidden: several pending
  siblings share one insertion anchor, so adding tactics out of source order
  can attach to the wrong goal; all four nodes of a multi-rule `rw` share one
  deletion slot; and deleting an individual `calc` link is out of scope, since
  the links restate each other's endpoints.
