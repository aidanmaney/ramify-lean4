# Ramify — three-user critique

Sources: CLAUDE.md, `web/src/experience.ts`, `moves.ts`, `gestures.ts`, `viewModes.ts`, `ext/ramify/package.json`, INSTALL.md. The harness was run at `localhost:5173/?stub-edit`, with `&experience=beginner|expert` and `&diag-stub=ewl`. Screenshots are in this folder:

| Screenshot | What it shows |
| --- | --- |
| `01-default` | The default view |
| `02`–`06` | The panels: Layout, Context, Comments, Reading, `?` |
| `07-hover-tactic` | The tactic hover bar |
| `08-more-menu` | The `⋯` menu |
| `10-beginner`, `11-expert` | The two presets |
| `12-diag` | Diagnostics |
| `13-skip` | A hop |
| `15-collapse-all` | Collapse to the outline |

**What I saw in the UI.**

- **Status strip.** At rest it reads `Layout: outline · Context: used · Comments: show │ Reading ⌄ ……… 15 steps │ ?`.
- **Tactic hover bar.** It shows `» ◌ ⊹ 🗑 ⋯`. The ◎ is missing on a tactic because it is goal-only.
- **Hover side effect.** Hovering `have hsq` puts an orange wash on `a`, `b` in the goal above. This is unexplained unless you open `?`.
- **`⋯` menu.** It is the best surface in the product: a glyph, a sentence, the gesture, and a pin.
- **Fold vs skip.** Collapse-all makes `+5` corners. A skip makes `+1` plus a tiny `≠ have` break. The two differ by one 6-px stroke.
- **Goal corner.** The `−` is about 6 px of faint ink and almost invisible at 100 % zoom.
- **Expert `brief`.** It renders `have hsq : … := …`. That is the one thing the expert wanted to read.
- **Beginner narration.** The `∴` line over `calc` is a garbled one-line chain (`∴ Chain: (a + b) ^ 2 = 2 * (a ^ 2 + b ^ 2) - (a - b) ^ 2 ≤ …`), which is worse than nothing.
- **Diagnostics strip.** It works and is clear. The lint count's glyph `◇` reads as a bullet (`✕1 · ⚠1 · 1`).

---

## 1. Persona needs in the first five minutes

### NOVICE — "Maya", 3rd-year maths, week 4 of *Mathematics in Lean*

> "I opened the infoview and there's a tree. Great — I can *see* the cases from `induction`! But then I hovered a box and some letters turned orange, I don't know why. What's `◌`? What's `⊹`? Why are there a `−` and a `+5` in the corner? Is 'Context: used' something I did wrong?"

What she needs:
1. See the goal and its hypotheses. She needs to understand that the green box is *what I typed* and the blue box is *what's left*.
2. See where she is: the cursor's node highlighted, and click a node to jump to source.
3. See errors on the step that caused them, in words.
4. Know what to type next: the open-goal `+`/`sorry` chips are excellent for her.
5. Know what `simp` did (`⁇`). Her preset already has this.

What gets in her way:
- Unlabelled glyphs (`◌ ⊹ » ⧉ ⁇ ⇓ ⇑ ⤵ ⤴ ✎ § ∴ ≈ +N`). She cannot learn them from tooltips because the dwell is 1 s.
- Modifier gestures that change meaning per target. On a goal, ⌥-click focuses. On a tactic, it skips. On a context line, it renames. On the corner, it writes `.mark` into her file. On a zoom button, it expands or collapses everything.
- Hover side effects: the orange wash, and the beginner preset's dashed connector from a hypothesis line.
- The beginner preset sets `Context: all`. That puts `n : ℕ` on every box of a real-analysis proof, so there are more lines for the user who can least filter them.
- Her narration (`∴`) is a template that sometimes produces junk. She can't tell the generated text from the lecturer's comment, because both are italic grey strips.

### EXPERT — "Kenji", Mathlib reviewer, 300-line tactic proofs, vim keys

> "I want the tree to be a *minimap of goals*. Show me which goal each `·` is on, show me where it breaks, get out of the way. I will not mouse to a 1-second tooltip. `brief` just ate my `have` statements. Where are the keybindings? Why does a preset decide my defaults — just give me settings."

What he needs:
1. Speed. Mostly that is a big proof that stays responsive, and the tree following the cursor without moving on its own.
2. Fold, focus and skip from the keyboard. That exists only via Tab into the frame, then arrows, → and ←. No command or keybinding reaches it from the editor.
3. Errors on the node, with no auto-opening banner. He tolerates the error strip but wants a setting to keep it closed.
4. The automation tools (`⇓` collapse a run to `omega`, `⇑` expand `simp` to `simp only`) and lint fixes, as actions that are reachable by keybinding or the palette and verified by the elaborator. This is Ramify's real expert value.
5. No lints by default, but **not** because he is an expert: he runs them in CI anyway.

What gets in his way:
- Status-strip settings that reset every session. Layout, Context and Comments have no settings.json key, so his choice of `wide` is lost on window reload.
- `brief` on by default hides `have` types.
- Hover-only discovery.
- Hover wash and connectors that flicker as the mouse crosses the tree.
- Marks: tabs, a nub, `<`/`>` and two lists. To him this is a second bookmark system next to VS Code's own.
- `polish` and `suggest a rewrite` are the "AI" features. He never wants them, and they are rightly hidden without a key.

### READER / EDUCATOR — "Dr Okafor", lectures *Intro to formal proof*, projects the tree, shares static-site links

> "I write a proof, add `-- .fold` and `-- .mark` comments, and walk the class through it: mark 1, mark 2, mark 3. I collapse to the outline first, then open each case. Students open my link at home. What I need is that the link opens exactly as I left it, and that students can't get lost."

What she needs:
1. **Collapse to the outline** and **expand** as visible buttons. Today they are ⌥-click on the zoom `+`/`−`, which is undiscoverable.
2. Fold and unfold per goal, with an obvious control. The `−` is too faint for a projector.
3. **Marks**, her killer feature. She needs `.mark N` in source, `<`/`>` stepping, and the anchored caption toast.
4. Author comments that look different from the machine's narration.
5. For the static link, the view state baked into the URL: layout, cuts and the current mark.
6. A big-type mode for projection. There is a zoom rail, but no "presentation" font-size setting.

What gets in her way:
- The difference between a fold and a hop on a projector: the class sees `+5` and `+1` and cannot see the 6-px break.
- The "temporary marks" list confuses students who click the nub by accident.
- `merge`, `brief` and `Context: diff` are vocabulary she would have to teach before teaching maths.

---

## 2. Every control, rated per persona

E = essential · N = nice · — = noise · ? = confusing

| Control / mark | Novice | Expert | Educator | Note |
| --- | --- | --- | --- | --- |
| Goal box / tactic box / connector trunk | E | E | E | The product. The goal-blue / tactic-green split is good. |
| Case tag above a branch (`refine_1`, `succ k ih`) | E | E | E | Grown from the elaborator, which is excellent. `refine_1` itself is ugly but true. |
| Click tactic → source | E | E | N | Correct. The goal needs Ctrl-click for the same thing, which is inconsistent. |
| Double-click to edit tactic/comment | N | N | — | Fine. Editing in the tree is rarely what an expert wants; it reads as an editor-in-an-editor. |
| Goal corner `−` / `+N` (fold) | ? (invisible) | E | E | Make it a codicon chevron in a gutter (VS Code fold idiom). |
| `+N` with axis-break and caption (hop/skip) | ? | N | ? | Two "hidden" looks share one `+N`. |
| Hover bar `»` show in source | — (click does it) | — | — | It duplicates a plain click on a tactic, so it is pure chrome there. |
| Hover bar `◎` focus | N | E | E | Goal-only. Name it "Focus". The glyph is OK. |
| Hover bar `◌` skip | ? | N | ? | Overlaps with fold. See the debate. |
| Hover bar `⊹` path | ? | N | N | A glyph nobody can guess. |
| Hover bar trash (delete tactic) | ? (scary) | N | — | A destructive action on a hover bar. In VS Code it belongs in the context menu with the Delete key. |
| `⋯` move menu | E | N | N | The best surface in the product. Promote it to the right-click context menu. |
| `⁇` what did simp use | E | N | N | Its glyph looks like an error. |
| `⇓` replace run with automation / `⇑` write out `simp` | — | E | — | Expert power. It needs to be a command plus a code action, not only a glyph. |
| `⤵` inline / `⤴` extract / D5 rename | — | N | — | These are refactors, so they belong in VS Code's **Refactor…** code-action menu. |
| `✎` linter fix | N | N | — | This is a quick fix: the lightbulb idiom. |
| `⧉` lens | — | ? | — | Needs the companion. Most users won't know what a "lens" is. |
| Frontier chips `+ / sorry / calc / step / ?_` | E | N | — | Great for novices. `?_` and `step` are cryptic. |
| Mark tabs / nub / `<` `>` / Marks item | — | — | E | Educator-only. It should be invisible unless the source has `.mark`, and today the nub is still discoverable on hover. |
| Temporary marks list | — | — | ? | Two lists is one too many. |
| Status strip: `Layout:` | N | E | E | |
| Status strip: `Context:` (used/intro/diff/all) | ? | N | N | "used" sounds like a verdict. |
| Status strip: `Comments:` (show/hide/in place/narrate) | N | N | E | Four modes mix two axes. |
| `Reading ⌄` panel: brief | ? | ? | — | It hides information under a reassuring name. |
| `Reading`: merge | ? | N | N | |
| `Reading`: lints | N | N (setting) | — | |
| `Reading`: hypothesis origins | N | — | N | A hover connector. |
| `Reading`: up to cursor | N | N | E | Lovely for teaching ("the proof so far"). |
| `Reading`: polish / suggest a rewrite | — | — | — | Key-gated. Correctly hidden. |
| Status readout `15 steps · 1 open · 4 hidden` | N | N | N | Good. `open` and `hidden` are clickable, which is a nice touch. |
| Diagnostics count + message strip | E | E | N | Good. The lint glyph `◇` is weak. |
| Zoom rail `+ − ⛶` | N | — | E | ⌥-click = expand all / collapse all is undiscoverable. |
| Signature header with chevron | N | N | E | Good. |
| `?` help panel | E | N | N | Reads like a reference card. It needs a "first 3 things" intro. |
| `∴` narration strips | ? (quality varies) | — | N | |
| `§` seeded marks / italics | — | — | N | Author-only semantics. |
| Hypothesis `▸` "used by the tactic below" | N | N | N | Good, quiet. |
| Orange hover wash on used hyps | ? (unexplained) | — | N | Show it only after the dwell, with a legend in `?`. |
| Toast with Undo | N | N | E | Good, VS Code-like. |
| Experience preset | ? (on first run) | — (wants settings) | — | See below. |

---

## 3. The debate

**On the experience preset.**

- **NOVICE:** "I picked 'beginner' and got *more* stuff: narration, every hypothesis, connectors on hover, auto-traces. I'm the one who can least sort through it."
- **EXPERT:** "Presets that set seven unrelated defaults are a VS Code anti-pattern. If I set `expert` I get `brief` and lose lints, which are two unrelated choices. Give me `ramify.view.layout`, `ramify.view.context`, `ramify.comments.mode`, `ramify.lints.enabled`, and let me put them in settings.json. Nothing else in VS Code has an experience level."
- **EDUCATOR:** "I like that I can tell students 'set beginner'. One setting is easier to dictate than six."
- **Resolution.** Keep the *idea* (one-sentence onboarding), but invert the mechanism. Real settings come first, one per row, which makes everything persistable, settings-sync'd and per-folder. Turn the preset into a one-shot **command** (`Ramify: Apply Reading Preset…`) that *writes* those settings, like VS Code's "Configure Display Language" or a profile, rather than a live setting that shadows them. That makes the behaviour inspectable: open Settings and see exactly what "beginner" did. It also removes the session-override layering (`useOverride`). Retune "beginner" to *less, explained* rather than *more*:
  - Context `used`, not `all`.
  - Narration off by default; offer it as a toggle.
  - Hypothesis origins on.
  - Auto-trace on.
  - Bar plus `⁇`.

**On fold vs skip vs ghost (hide vs hop).**

- **EXPERT:** "Fold is all I need: hide below this goal. 'Skip a step but keep the goal after it' is cute, but it's a second hiding concept with a second visual (`+1` plus a slanted break)."
- **EDUCATOR:** "Actually skip is great for teaching. I hide the boring `have` and keep the interesting goal after it. But on a projector `+1` with a break looks the same as `+5` folded, and students click the wrong one."
- **NOVICE:** "I don't understand either. I clicked the dashed thing and it came back. OK."
- **Resolution.** Keep both mechanics and make them look categorically different, using one vocabulary:
  - **Fold** (VS Code's word): a chevron at the left of the goal box (`codicon-chevron-down`/`-right`), with "+5 steps" as a dim *pill inside the box's bottom edge*.
  - **Skip** (rename "hide step"): the collapsed step stays as a thin dashed *placeholder line* carrying the step's head word, so it *is* a ghost.
  - Drop the axis-break glyph. A pill on the connector with "`have` …" reads the same and is legible at projector distance.
  - Never use the same `+N` text on both.

**On the hover bar.**

- **EXPERT:** "Delete it. Context menu plus keybindings."
- **NOVICE:** "I need something to click on, I don't know right-click exists in a webview."
- **EDUCATOR:** "I never use it. It covers the neighbouring box when I'm pointing at things."
- **Resolution.**
  - Shrink the default bar to **two** buttons: Focus, then `⋯`. Drop `»`, which duplicates click. Drop trash: destructive, and it belongs in the menu or on the Delete key.
  - Move `◌` and `⊹` into `⋯`.
  - Make right-click open the same `⋯` menu. That is the VS Code context-menu idiom, and the webview can do it.
  - Keep pins, so a power user can rebuild the bar.

**On Marks.**

- **EXPERT:** "Noise. I have bookmarks and `.mark` comments clutter source."
- **EDUCATOR:** "Essential."
- **Resolution.** Marks exist only when the source has `.mark`. The quick-add nub and the temporary list go off by default, behind `ramify.marks.temporary` (false). An educator who wants them turns them on. Students who receive a marked proof get only `‹ 2/5 ›`.

**On `brief`.**

- **EXPERT:** "I thought brief would hide `:= by` boilerplate. It hid my `have` *types*."
- **Resolution.**
  - Brief must never drop the statement of a `have`/`obtain`. Cut only the justification (`have hsq : 0 ≤ (a-b)^2 := …`).
  - Remove it from the expert preset.
  - Rename it "Shorten tactic text".

**On narration (`∴`).**

- **EDUCATOR:** "My comments and the machine's sentences look identical. In a lecture that's dangerous."
- **NOVICE:** "The calc one was gibberish."
- **Resolution.**
  - Narration goes off by default for everyone.
  - Split Comments into two independent controls:
    - `Comments: show/hide/in place`, about the author's text.
    - `Explain steps` (a toggle), about generated text.
  - Generated text gets a distinct style: non-italic, a smaller sans face, and a leading "Lean:" or codicon `sparkle`, not the bare `∴`.
  - Suppress the template when it would just echo a term longer than about 60 chars. The calc case is the example.

**On modifier-click overload.**

- **All three agree:** ⌥-click means a different thing on every target (focus, skip, rename, write-mark, expand-all, cycle-setting). Ctrl-click on a goal means "go to source", while plain click on a tactic means the same. This is the biggest learnability tax.
- **Resolution.** Use one rule throughout. Then everything else (skip, rename, write `.mark`, expand all) moves to the context menu plus commands.

  | Input | Meaning |
  | --- | --- |
  | click | Select and reveal in source (both node kinds) |
  | double-click | Edit |
  | ⌥-click | Focus (show only this subtree) |
  | right-click | The move menu |
  | Chevron click | Fold |

  This keeps the expert's favourites reachable by keybinding.

**On where settings live.**

- **EXPERT:** "Layout, Context and Comments in the strip are fine *as view toggles*, but they must also be settings so the choice survives a reload. VS Code's own views work that way: the Explorer's 'Compact Folders' is a setting *and* a view-menu toggle."
- **Resolution.** Every strip value is backed by a setting. The strip changes the setting at workspace or user scope (opt-in: `ramify.rememberViewChoices`, default true). There are no session-only layers.

---

## 4. Options placement

Key: settings = settings.json; strip = the status-strip panels; ctx = the right-click / `⋯` menu; palette = Command Palette; keys = contributed keybinding (`when: ramify.treeFocused` or editor).

| Option / action | Today | Proposed home | Default (Nov / Exp / Edu) | Why |
| --- | --- | --- | --- | --- |
| Layout (outline/spine/tracks/wide) | strip, session only | **settings** `ramify.view.layout` + strip toggle + palette "Ramify: Change Layout…" | outline / outline / wide | A persistent preference; must survive reload. |
| Side-by-side, gallery | Layout panel, session | settings `ramify.view.sideBySide`, `ramify.view.gallery` + panel | off | Same. |
| Width (wrap) | Layout panel slider | settings `ramify.view.wrapColumn` + panel slider | full | Same. |
| Expand all / Collapse to outline / Reset | Layout panel action row + ⌥-click on zoom `+`/`−` | **palette + keys** (`ctrl+k ctrl+0` / `ctrl+k ctrl+j`, mirroring VS Code Fold All / Unfold All) + view title buttons; remove the ⌥-zoom overload | — | VS Code already has these exact verbs and chords. |
| Context breadth (used/intro/diff/all) | strip | settings `ramify.view.hypotheses` + strip; rename values (see renames); **drop `intro`** (merge into `diff`) | changes / changes / used | Four near-identical modes, of which only two are distinguishable to readers. |
| Group hypotheses by type (`hypGroup`) | Context panel toggle | Context panel; settings key | off | Fine as is; persist it. |
| Comments (show/hide/in place) | strip | settings `ramify.comments.display` + strip (3 values) | show | Author text only. |
| Narration (`∴`) | 4th Comments value | separate toggle **"Explain steps"** in Reading panel + settings `ramify.explain.enabled` | off / off / off (educator turns on per lecture) | It is a different axis; quality is not yet good enough to be on by default. |
| Polish (model rewrite of narration) | Reading panel (key-gated) + setting | settings only (`ramify.explain.polish`) | off | One switch; no panel row needed. |
| Suggest a rewrite (D6) | Reading panel action (key-gated) | **palette** "Ramify: Suggest a Restructuring" + ctx | n/a | It is an action, not an option. |
| Brief | Reading panel | Reading panel, renamed "Shorten tactic text"; settings key; **never drops a `have` type** | off / off / off | Information loss by default is the wrong default. |
| Merge | Reading panel | Reading panel, renamed "Join straight runs"; settings key | off / on / off | Expert minimap value. |
| Lints | Reading panel + preset | settings `ramify.lints.enabled` + Reading toggle | on / off / off | Persistent; experts lint in CI. |
| Hypothesis origins (connector) | Reading panel + preset | settings + Reading toggle | on / off / on | Fine as a toggle; a teaching aid. |
| Up to cursor | Reading panel | Reading panel + palette toggle + keybinding | off | Great teaching mode; deserves a key. |
| Hover-wash of used hyps (`hypMarkStyle`) | settings | settings; add `none` | highlight / none / highlight | An expert wants it off. |
| Experience preset | live setting + command | **command only**: "Ramify: Apply Reading Preset…", writes the real settings | n/a | Inspectable, sync-able, no hidden layer. |
| Hover bar buttons | settings ×2 + pins | keep settings + pins; **default = Focus, ⋯** | Focus ⁇ ⋯ / Focus ⋯ / Focus ⋯ | Less chrome; menu explains everything. |
| `»` show in source | bar default | delete from bar (click does it); keep in ctx | — | Duplicate. |
| Delete tactic (trash) | bar default | ctx + `Delete` key when tree focused | — | Destructive actions don't sit on hover. |
| Skip step (`◌`) | bar default + ⌥-click tactic | ctx + key (`ctrl+k ctrl+[`?) | — | Less common than fold. |
| Path to here (`⊹`) | bar default | ctx (rename "Show only this branch") | — | Rare. |
| Focus subtree (`◎`) | goal bar + ⌥-click goal | bar + ⌥-click (both kinds) + Enter-with-modifier | — | Most-used reading verb. |
| ⁇ What did `simp` use | ⋯ (beginner: bar) | bar for novice; **code lens / hover in editor** too | auto / click / click | Belongs where the `simp` is typed as well. |
| ⇓ / ⇑ / ⤵ / ⤴ / ✎ / rename | ⋯ + D5's ⌥-click on hypothesis line | ctx **and** VS Code **code actions** (Refactor… / Quick Fix) at the tactic's range | — | That is precisely what code actions are for; keyboard users get `ctrl+.`. |
| Lens (`⧉`) | ⋯ + command | ctx + palette (exists) | — | OK; rename "Open in side editor". |
| Marks: source `.mark` stepping | `<` `>` + strip item | keep `<`/`>`; add palette "Next/Previous Mark" + keybinding; strip item only when marks exist (already) | — | Educator core. |
| Marks: temporary list + nub | on, nub on corner hover | **off by default**, setting `ramify.marks.temporary` | off / off / on | Removes a second list and a hover affordance for 2 of 3 personas. |
| Write `.mark` into source | ⌥-click corner nub | ctx "Add `.mark` comment" | — | Writes the file; should be deliberate. |
| Diagnostics strip auto-open on error | always | setting `ramify.diagnostics.autoOpen` | on / off / on | The expert dislikes modal surprises. |
| Counterfactual, typingHoldMs | settings | keep | on / on / on | Correct home already. |
| linkMarks, linkTint, outlineOnly | settings | **delete** `linkMarks` and `linkTint`; keep `outlineOnly` → fold into a theme choice | off | Cosmetic knobs nobody asked for; economy. |
| lensGoals, lensWordWrap, lensHideChrome | settings | keep, group under "Ramify › Lens" | on | Fine. |
| Projection / font size | none (zoom rail only) | settings `ramify.view.fontScale` + "Ramify: Presentation Mode" | 1 / 1 / 1.4 | An educator projects. |
| Static link view state | partial | URL carries layout + cuts + current mark (`viewerLink.ts`) | — | "Opens as I left it". |

### VS Code-idiomatic surfaces missing today

- **No `contributes.keybindings` at all.** Add focus-tree (`ctrl+k ctrl+t`), fold and unfold at the cursor's goal, fold-all and unfold-all, next and previous open goal, and next and previous mark.
- **No `menus`**:
  - an `editor/context` "Show in Proof Tree";
  - `editor/title` buttons when a `.lean` file is active;
  - `commandPalette` entries for every strip action.
- **No `when` context keys** (`ramify.treeFocused`, `ramify.hasMarks`).
- **No code actions.** The rewrites are refactors already verified by the elaborator, which is exactly the contract VS Code's lightbulb promises.

---

## 5. Renames

| Today | Misread by | As | Proposed |
| --- | --- | --- | --- |
| hop / skip (`◌`) | all | "skip = jump the cursor"; "hop" is internal but leaks into tips | **Hide step** (UI) — keep `hop` in code only |
| fold (goal `−`) | novice | fine for VS Code users; the `−` glyph reads as "minus/remove" | **Fold**, with a chevron codicon |
| ghost (dashed box) | — (internal) | — | **Hidden steps** placeholder |
| `+N` | educator, novice | "N new goals" / "add N" | "**5 hidden**" pill (word, not sign) |
| `§` seeded | all | section sign = legal / LaTeX | drop the glyph; italic + tooltip "folded by the author" |
| Marks | expert | VS Code/vim marks (a cursor position), not an ordered walkthrough | **Tour stops**, or "Walkthrough" (CodeTour's word). The code already says tour |
| temporary / source (mark lists) | educator | | "My stops" / "Author's stops" |
| narrate (`∴`) | novice, educator | "∴ therefore" is a maths claim; generated text masquerading as reasoning | **Explain steps**; mark with a `sparkle` codicon or "Lean:" |
| in place (Comments) | all | "edit in place" | **replace tactic** ("Comments: instead of code") |
| brief | expert | "brief = summarise", not "delete the type" | **Shorten tactic text** |
| merge | novice, educator | "merge = git merge / combine proofs" | **Join straight runs** |
| Context: used | novice | "used = consumed / already used up" | **Hypotheses: needed** (needed below) |
| Context: intro / diff | all | jargon; `diff` = git | merge into **Hypotheses: new** |
| Context: all | — | fine | **Hypotheses: all** (the word is "Context" in Lean's infoview, but students know "hypotheses") |
| Reading ⌄ | expert | "reading mode = read-only?" | **View options** (or the codicon `settings` in the title bar) |
| ⊹ path | all | glyph unguessable | "Show only this branch", codicon `filter` |
| » source | all | `»` = "next" / fast-forward | drop (click); in menu "Go to source" |
| ◎ focus | — | OK | **Focus**, codicon `target` (or `zoom-in`) |
| ⁇ | novice | `⁇` = an error / unknown | **What did simp use?**, codicon `question` or `list-tree` |
| ⇓ / ⇑ | expert | arrows = scroll / move | "Replace with automation" / "Expand automation", codicon `wand` / `list-unordered` |
| ⤵ / ⤴ | expert | arrows = move up/down | "Inline `h`" / "Extract to `have`" (VS Code's own refactor names) |
| ✎ lint fix | novice | pencil = edit | "Fix: …" (a lightbulb item) |
| lens / ⧉ | all | "lens" = CodeLens | **Open in side editor** |
| frontier chips `step`, `?_` | novice | | `step` → "next step", `?_` → "split into goals" |
| `refine_1` case tag | novice | variable name | show `goal 1 of 3` where the tag is synthetic (`<tactic>_N`) |
| status readout `hidden` | — | fine | keep |

---

## 6. Ranked top 12 changes

1. **Back every view choice with a real setting** (`ramify.view.layout`, `.hypotheses`, `ramify.comments.display`, `ramify.lints.enabled`, `ramify.explain.enabled`, …). The strip writes them, so the choice survives a reload, syncs, and works per folder. This removes the `useOverride` session layer. *(All three; the expert's top complaint.)*
2. **Turn the experience preset into a command** ("Ramify: Apply Reading Preset…") that *writes* those settings, and delete `ramify.experience` as a live setting. Retune beginner to *fewer* things: Context `needed`, narration off, origins on, ⁇ on the bar.
3. **One modifier grammar.** The table is in §3 (click selects and reveals, double-click edits, ⌥-click focuses, right-click opens the move menu, the chevron folds). Remove ⌥ from zoom buttons, context lines, the nub and tactics. Ctrl-click on a goal becomes plain click.
4. **Right-click opens the `⋯` menu**, and the default hover bar shrinks to `Focus · ⋯` (plus ⁇ for beginners). `»`, trash, `◌` and `⊹` leave the default bar.
5. **Contribute keybindings, menus and when-clauses.** Fold or unfold the goal at the cursor, Fold All, Unfold All, focus the tree, next and previous open goal, next and previous stop, toggle "up to cursor". Mirror VS Code's own fold chords.
6. **Expose the restructurings as VS Code code actions** (Quick Fix / Refactor…) at the tactic's range: `⇓ ⇑ ⤵ ⤴ ✎` and the D5 rename. Keep them in the tree menu too. This gives the expert `ctrl+.` and the novice the familiar lightbulb.
7. **Make fold and hide-step categorically different and legible.** Use a chevron codicon in the goal's gutter for fold (replacing the 6-px `−`) and a "5 hidden" pill, not `+5`. Hide-step leaves a dashed one-line placeholder with the head word. The axis-break glyph goes.
8. **Split narration from comments.** Comments become `show / hide / replace tactic`. "Explain steps" is a separate toggle, off by default, with a visibly *different* style (not italic grey, not `∴`). Suppress templates that echo long terms (the garbled calc line).
9. **Fix `brief`** so it never hides a `have`/`obtain` statement. Rename it "Shorten tactic text" and take it out of every default.
10. **Marks:** temporary marks, the quick-add nub and the two-list panel go behind `ramify.marks.temporary` (off). Stops appear only when the source has `.mark`. Rename them to "Tour stops", and add palette and keybinding next/previous.
11. **Teaching affordances.** Add a `ramify.view.fontScale` / "Presentation Mode" command. The static-viewer URL carries layout, cuts and the current stop. Expand/Collapse All become visible title-bar buttons, not ⌥ on the zoom rail.
12. **Prune cosmetic settings and jargon.** Delete `linkMarks` and `linkTint`. Merge `Context: intro` into `diff` (→ "new"). Rename `Reading ⌄` → "View options", `merge` → "Join straight runs", `lens` → "side editor", `⁇`/`»`/`⊹` → codicons with words in the menu. Fix the lint count glyph (`◇` → codicon `lightbulb` or `info`). The help panel gets a three-line "start here" (click a box → source; chevron → fold; right-click → everything).

### What not to change (consensus)

- The `⋯` menu as a self-explaining legend: glyph, sentence, gesture, pin.
- The diagnostics count plus message strip, and errors drawn on the node.
- The frontier chips on open goals (novice gold).
- The status readout (`15 steps · 1 open · 4 hidden`), with clickable counts.
- Verify-then-offer: nothing is written until the elaborator agrees.
- Toasts with Undo, and the anchored mark-caption toast.
- The rule that the view never moves on its own.
