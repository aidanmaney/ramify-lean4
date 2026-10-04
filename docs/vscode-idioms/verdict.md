# Verdict — making Ramify more VS Code-native

Judge's ruling over the three reports (`idioms.md`, `personas.md`, `priorart.md`), the screenshots 01–15 and the code at HEAD (`cffa2be`, squiggles landed). Nothing in the repo was edited.

## 0. What I checked, and where a critic was wrong

Verified true (grep / tarball / screenshot):
- **No codicon is used anywhere** (`grep codicon web/src` finds two comments), yet the infoview loads `@vscode/codicons` and the 0.0.40 tarball ships `src/icons/*.svg` (497 files) — every name proposed below exists in it, so a path-data table is buildable at build time with no new dependency.
- **The extension contributes no `keybindings`, no `menus`, no `when` context keys** — `ext/ramify/package.json` has `commands` and `configuration` only. No `onContextMenu` anywhere in `web/src`: right-click does nothing in the tree.
- **`brief` does drop a `have`'s statement**: screenshot `11-expert` reads `have hsq : … := …`. The expert's complaint is real and `brief` is ON in the expert preset (`experience.ts`).
- **The fold `−` is a 6px stroke** (`CORNER_MINUS_W` 6) and **the hop's only visual difference from a fold is the two slanted strokes** (`13-skip` vs `14-fold`): `+1` with a break vs `+5` without. All three personas could not tell them apart at a glance.
- **Nothing in the status strip persists**: the only `localStorage` users are the static viewer's split and theme. Layout/Context/Comments are session state (`useOverride`).
- **The lint glyph `◇`** (`diagInk.ts` `DIAG[3]`) is a private mark; the infoview's tally is `codicon-error/warning/info`.
- **Narration's calc template** emits `Chain: <whole relation chain>` (`narrate.ts:513`) — the "garbled line" is real.

Critics wrong or over-claiming:
- **idioms.md "VS Code deletes immediately and offers Undo"** — false: Explorer delete confirms (`explorer.confirmDelete` default true), SCM discard confirms. The armed-delete pill is *more* native than an immediate delete. **Rejected.**
- **idioms.md `editorUnnecessaryCode.opacity`** is a colour token whose alpha channel encodes opacity (`#000000aa`); CSS cannot read alpha out of it. Not adoptable as proposed.
- **idioms.md "the ladder has no VS Code precedent"** — but VS Code's status bar *does* drop names (`$(icon)` compaction is exactly what the glyph form is), and the owner measured the ladder 2026-10-02. The real difference is only the dividers and the card.
- **priorart.md "Ramify uses none of the infoview colours"** — true today, and cheap to fix (one recipe each in `theme.ts`).
- **personas.md's `hypMarkStyle: none`** — the enum is `highlight | underline`; adding `none` is trivial, but the `hypothesis origins` reading option already removes the connector; only the used-hyp wash has no off switch.
- **idioms.md "drop `∴`/`≈`"** — the marks are written *into* the string so `commentSize` measures what is painted (CLAUDE.md, `SEED_MARK` idiom). Dropping them is fine for the measurer only if the ink change carries the meaning; keep the mechanism, change the ink.
- **Both idioms and priorart propose moving the fold control to the top-left** — CLAUDE.md records this as a *user direction* (top-right, "after a try at the end of the top line"). Not a judge's call; it is strategic question 2.

## 1. Debate — every proposal, merged

Grouped by surface. **C** = contested (steelman given), **U** = uncontested.

### A. Icons and chrome tokens

| # | Proposal (sources) | Debate |
|---|---|---|
| A1 | **Replace every drawn chrome mark with codicon path data** — `ChevronGlyph`, `DisclosureGlyph`, `HeaderChevron`, `EyeGlyph`, `CommentGlyph`×4, `LayoutGlyph`×4, `LayoutExtraGlyph`×3, `SkipIcon`, `TrashIcon`, `InlineIcon`, `MENU_ICON`, `DiagGlyph`, `BarCheck`, pin (idioms, priorart) | U. ~400 lines of hand-drawn copies of codicons go; one vocabulary with the infoview one pane over; the static viewer works because paths, not the font, ship. Risk: `glyphPx` ink-levelling was tuned per glyph — codicons are levelled by design at 16px, so the levelling code goes with them. |
| A2 | Hover-widget tokens for tips (`editorHoverWidget-*`), menu tokens for `⋯` and panels (`menu-*`), `toolbar-hoverBackground/-activeBackground` for buttons, notification tokens for Undo toasts, sticky-scroll tokens for the header, `editorMarkerNavigation*` for the message strip (idioms) | U. Fits the design-language rule exactly: the host var goes INSIDE the `--ptw-*` token with a derived fallback. |
| A3 | Infoview's own colours: `lean4-infoView.hypothesisName` (bold), `.turnstile`, `.caseLabel` + `case ` prefix, inaccessible `x✝` italic .7; diff from `diffEditor-inserted/removedTextBackground`, name only (priorart) | U for colours. **C** for bold names: `sizeOf`/`HypBlock` measure in one weight — bold widens, so measurer and renderer must change together. For: parity with the goal list beside it. Against: a bold measurement pass across every context line. Ruling: colours now, bold later with the measurer. |
| A4 | Per-surface radius (4/6/8 via `--vscode-cornerRadius-*`) instead of one `CHROME_RADIUS` 3 (idioms) | **C**. For: VS Code 1.9x does this (186 uses of `cornerRadius-small` in `wb.css`). Against: the 2026-10-02 taste pass chose ONE radius deliberately; size tokens may not reach webviews; 3→4 is invisible. Defer. |
| A5 | Hyp-used wash → `editor-wordHighlightBackground`, introducing step → `wordHighlightStrongBackground` (idioms) | U. Read vs write access maps exactly; a token swap. |
| A6 | Comment prose in the UI face, upright, theme comment colour (priorart, personas) | **C**. For: prose reads as prose, machine text can then differ. Against: `commentSize` measures in the code font — a second face needs a second measurer and the viewer's font set; many VS Code themes italicise comments anyway. Ruling: colour from the theme's comment token now; face change deferred. |
| A7 | Generated narration in `editorGhostText-foreground` (idioms); split from author comments by style (personas) | U for the ink. Ghost text is VS Code's "not your words"; the educator's "they look identical" is the strongest persona finding. Keep `∴`/`≈` as the measured mark (A: it is in the string), add the ink. |

### B. Hover bar, menu, moves

| # | Proposal | Debate |
|---|---|---|
| B1 | Hover bar as a VS Code action bar: 22px items, 16px codicons, no dividers, `toolbar-hoverBackground`, radius `cornerRadius-medium` (idioms) | U. The dividers and `HOVER_ICON_SW` go. Codicons: `go-to-file` · `target` · `debug-step-over` · `filter` · `trash` · `ellipsis`; menu-only `references` (trace), `wand` (⇓), `list-tree` (⇑), `fold-down` (⤵), `fold-up` (⤴), `lightbulb-autofix` (✎), `split-horizontal` (lens), `add` (ledger goal). |
| B2 | Right-click (and ⇧F10, exists) opens the `⋯` menu (idioms, personas) | U. One `onContextMenu` + `preventDefault` on the node `<g>`. VS Code users try it first. |
| B3 | `⋯` menu as a context menu: `menu-*` tokens, separators between groups (Navigate / Fold / Edit / Refactor), keybinding-label column (idioms) | U for tokens and groups. **C** on "drop the icon column": personas call the menu "the best surface — a glyph, a sentence, the gesture, a pin", and it is the ICON EXPLAINER by design. Ruling: keep icons (they are the legend for the bar), take tokens, separators and the keycap column. |
| B4 | Shrink the default bar to `Focus · ⋯` (+`⁇` beginner); `»` duplicates click, trash is destructive (personas) | **C**. For: economy; the educator says the bar covers neighbours. Against: `»` on a tactic is the only way to reveal WITHOUT selecting/anchoring (click also accents and seeks), the trash is the delete's one discoverable door, ◌ is the reading verb the owner specified 2026-09-17. Changes `DEFAULT_BAR` semantics. **Needs owner sign-off.** |
| B5 | Hide unavailable moves instead of greying (idioms) | **C**. VS Code toolbars hide; its action widget greys with a reason. CLAUDE.md 2026-09-28 chose stable slots so a slot never changes look when it wakes — a cousin of "the view never moves". Reject. |
| B6 | One **lightbulb** (`lightbulb` / `lightbulb-autofix` when a lint fix exists) per node opening Quick Fix / Refactor groups, replacing `⇓ ⇑ ⤵ ⤴ ✎` + D5's hidden ⌥-click; bind ⌘./Ctrl+. (idioms, personas) | **C**. For: the most recognised "there is a fix here" mark; D5 rename today has no visible door at all; the five restructure moves share one reason (`RESTRUCTURE`). Against: changes `MOVE_IDS` (synced across moves.ts/extension.js/package.json enums by `check-sync.mjs`), and verify-then-offer must stay a pill (one click applies is NOT the owner's contract). Ruling: accept as a *menu section with a lightbulb bar slot* that opens it; the pill stays. |
| B7 | Real VS Code **code actions** at the tactic's range via the companion (personas) | **C**. For: `ctrl+.` in the editor, the native lightbulb in the buffer. Against: the companion has no access to the widget's computed primitives; it would need a `actions.json` the widget publishes per `(uri, version)` and a `CodeActionProvider` reading it — a new wire. Defer; strategic Q4. |
| B8 | Push-pins → right-click-the-toolbar checkmarks (idioms) | Reject. The pin row is working and self-explaining; swap the glyph to `pin`/`pinned` only. |
| B9 | Proposal pill → verify-on-hover in the menu row with a spinner (idioms, L) | Defer. The pill IS the verify-then-offer promise; the row-spinner is a redesign of D1/D2/D4/D5 for little native gain. |
| B10 | Armed-delete → immediate delete + Undo (idioms) | **Reject** — VS Code confirms deletes (see §0). |
| B11 | Drop hover-preview washes after dwell except delete (idioms, low confidence) | Reject; 2026-09-24 design, dwell-gated, evidence assumed. |
| B12 | Rename: `⁇` "What did simp use?", ⊹ "Show only this branch", lens "Open in side editor", `step`/`?_` chips (personas) | Mostly already so in `moves.ts` (the menu says "Skip this step", "Show only the path to here"). Accept "Open in side editor" for the lens row's wording; chips wording accept; the rest is codicons (B1). |

### C. Folding, hops, ghosts, seeds

| # | Proposal | Debate |
|---|---|---|
| C1 | Fold control = `chevron-down` on hover only (open), `chevron-right` always (folded), ink `editorGutter-foldingControlForeground`, 16px (idioms, priorart, personas) | U on the look; **C** on the position (top-left gutter vs owner's top-right). For moving: every tree twistie is left; the mark tab is top-left already though. Against: user direction on record. Ruling: the look now, at the owner's corner; position = strategic Q2. The hover reveal is paint-only (no relayout) and the hit rect is unchanged (`CORNER_W × CORNER_HIT_H`). |
| C2 | `+N` → `⋯` placeholder (idioms) / "5 hidden" words (personas) / count badge (priorart) | **C**. For `⋯`: the editor's own fold placeholder. Against: `+N` is precedented (notebook "N cells hidden", outliner badges), the status readout sums it, `probe counts` pins it, and `⋯` loses the number a projector needs. Ruling: keep `+N`, paint it in `editor-foldPlaceholderForeground` next to the `chevron-right`, add `editor-foldBackground` wash on the folded box. |
| C3 | Hop's slanted axis-break → a `⋯` fold-placeholder chip on the link; caption stays (idioms, personas) | **C**. For: the break is a private glyph no peer uses and the personas could not see it; the caption `have` is already there, so `⋯ have` on the link IS the editor's folded-line look. Against: owner designed the break 2026-09-17. It is paint only (`HopBreak` in topChrome.tsx; `probe hopgap`/`overlap` already model the caption rect). Accept, with a look-over. |
| C4 | One look for skip and hide (idioms) | **Reject** — user direction 2026-09-17: the verb decides, two looks. C1+C3 make them *categorically* different (a folded goal wears a chevron-right; a hop wears `⋯ have` on the line). |
| C5 | Ghost dashed box → `⋯ 4 steps` chip (idioms) | Defer. The ghost survives only for `.none` on a split and a broken chain; rare, and `ghostSize`/`badgeWidth` are paired. Not worth a batch. |
| C6 | Delete `§` seeded prefix (idioms, personas); keep italics + `<title>` (personas) | Accept the glyph's removal (private, reads as "section"/legal); keep seeded italics and `seedTitle`. `SEED_MARK` becomes `""`-safe: the measurer measures the string either way. |
| C7 | Rail: codicons `zoom-in/zoom-out/screen-full`, square 22px, **separate** `collapse-all`/`expand-all` instead of the ⌥ glyph swap (idioms, personas) | U. Removes an ⌥ overload without removing a function; the educator's #1 ask. The Layout panel's `Expand all · Collapse` action row then duplicates — keep `Reset tree` there, drop the other two from the panel after the rail lands. Position stays bottom-right (the lane dodges the host's button; `lift` unchanged). |

### D. Status strip, panels, settings

| # | Proposal | Debate |
|---|---|---|
| D1 | Strip → status-bar look: 22px, flat, no `BarDivider`s, `tabular-nums` (idioms) | U for height/dividers/nums (the card is already flat since 2026-10-02). |
| D2 | Priority-drop instead of the three-form ladder (idioms) | **C**. For: VS Code drops whole items. Against: on the reported ~280px pane the ladder keeps `Layout` reachable as a glyph where drop would lose it; measured 2026-10-02. Reject. |
| D3 | Drop the per-item dots; drop ⌥-click cycling (idioms, personas) | **C**. Dots: VS Code marks non-default settings nowhere in the status bar; the tip already lists what is on. ⌥-cycle: an accelerator with no native model, and the personas' "modifier overload" count. Both are 2026-09/10 owner design. **Sign-off** — recommend dropping both. |
| D4 | Value-only items (`outline`) with the name in the tip (idioms) | Reject: VS Code has both forms (`Spaces: 4`); the ladder already sheds names. |
| D5 | Panels → the infoview's own check menu: `codicon-check`/`blank` rows, `menu-*` tokens, replacing `●/○` and `BarCheck` (idioms) | U. Same panel, one pane over; kills a private dialect. |
| D6 | Merge Reading + Comments + Context into one `settings-gear` menu (idioms) | **C**. For: the infoview gear. Against: the three values are the status-bar idiom and the educator reads them at a glance; a gear hides them. Defer; strategic Q5. |
| D7 | **Back every strip value with a real setting** (`ramify.view.layout`, `.context`, `.comments`, `.lints`…), the strip writing it (personas #1) | U in *direction*; mechanism matters. The companion already publishes every `ramify.*` into `theme-colors.json` per folder, and `useOverride(default)` already means "a setting is the default, the session wins" — so new keys only need the companion's existing path. Writing back reuses `settings-request.json` (`action: "setting"`, allow-listed keys), as the pin does. No `useOverride` removal needed. Accept, later batch; `Option` fields on `ThemeColors` (the FromJson rule). |
| D8 | Preset → a one-shot command writing settings; retune beginner (personas) | **C**. For: inspectable, no shadow layer; "nothing in VS Code has an experience level". Against: the preset only FILLS DEFAULTS (2026-09-22) and D7 makes real settings win anyway; the educator wants one word to dictate. Ruling: keep the live preset; after D7 it is harmless. Retuning beginner (Context `all`→`used`, narration off) changes defaults — **sign-off**; strategic Q3. |
| D9 | Delete `linkMarks`/`linkTint`; `hypMarkStyle: none` (personas) | Defer; pruning is owner's. `none` is a two-line add — accept with D7. |
| D10 | Diagnostics count → `codicon-error 2 codicon-warning 1 codicon-info 3`, plain ink, spaces not `·`, no dark block (idioms, priorart) | U. Lint → `info` at `DIM_OPACITY` (VS Code's markers view draws hints as `severity-ignore` info). `DiagGlyph` and the `dc` compact form go; `tabular-nums` replaces the reserved digits. |
| D11 | Message strip → marker-navigation widget tokens, `arrow-up/down`, F8/⇧F8, **no auto-open** (idioms); `ramify.diagnostics.autoOpen` (personas) | Tokens and keys U. Auto-open **C**: VS Code never opens the peek by itself; the owner's derived-open rule (2026-09-24) says a NEW error opens it. Ruling: keep auto-open for now, make it a reading option after D7 (`errors open the message strip`); strategic Q-adjacent. |
| D12 | Mode-change echo toasts → delete (idioms) | **C**. For: the item changed, VS Code echoes nothing. Against: owner rule 14; on a glyph-only strip the toast is the only word. Defer; sign-off. |
| D13 | Undo toasts in `notifications-*` tokens, `button-*` Undo (idioms) | Accept tokens; keep top-centre (bottom-right collides with the rail). |
| D14 | `?` → `codicon-question`; help panel gets a three-line "start here" (idioms, personas) | U. |
| D15 | Readout `1 open` → `$(circle-outline) 1`; Marks → `$(bookmark) 2/5` (idioms) | Reject the first (words are the 2026-10-02 design, clearer). Accept `bookmark` only as the Marks item's glyph FORM in the ladder. |
| D16 | Context: drop `intro` into `diff`, rename used→needed / Hypotheses: (personas) | **Sign-off**; the four breadths are measured/pinned (fingerprint). Recommend no rename ("Context" is the infoview's word). |

### E. Keys, gestures, marks

| # | Proposal | Debate |
|---|---|---|
| E1 | Space folds/unfolds; `ctrl+k ctrl+0` / `ctrl+k ctrl+j` fold-all/unfold-all; F8/⇧F8 next/prev diagnostic; ⌘./ctrl+. opens the `⋯` menu — all **frame-scoped** in `onKeyDown` (idioms, personas) | U. Chords and function keys do not trip "no single-letter keys". Risk: VS Code may consume ⌘. / F8 before the webview — verify live. |
| E2 | Contributed `keybindings`/`menus`/`when` keys in package.json (personas) | **C**. For: the expert's palette and chords from the editor. Against: there is NO route from the extension into the live widget (CLAUDE.md), so "Fold All" from the palette would need a push channel or a poll. Defer; strategic Q4. |
| E3 | One modifier grammar: click = select+reveal both kinds, ⌥-click = focus both kinds, right-click = menu, chevron = fold; remove ⌥ from rail/items/nub/context lines (personas) | **C**. Right-click (B2) and the rail (C7) are accepted. ⌥-click on a tactic = skip and on a context line = rename are the owner's; the nub's ⌥ writes `.mark` (the author's words — deliberate). Ruling: cut ⌥ where a visible button replaces it (rail, strip cycle per D3); keep the node-level ⌥ until B6 gives rename a visible door, then revisit. **Sign-off.** |
| E4 | Marks → bookmark glyph in a left gutter, number in hover; temporary list + nub off by default (`ramify.marks.temporary`); rename "Tour stops"/"Author's stops" (idioms, personas) | **C**. Rename: **reject** — user direction ("the reader's word is MARK"). Gutter glyph: the number is what a projector reads; reject. Temporary-off-by-default: both-on was the owner's 2026-09-08 design; the persona case (students clicking the nub) is real but assumed. **Sign-off** (Q3). Keep `bookmark` as the item's glyph (D15). |
| E5 | Hyp-origin connector → ⌘-click go-to-definition + highlight (idioms) | Defer: ⌘-click on a goal box already means reveal; the connector is a dwell-gated reading option that is off by default outside beginner. |
| E6 | Signature header → sticky-scroll tokens; `⊹` → breadcrumb trail in the header (idioms) | Tokens U. Breadcrumbs **C**: `⊹` is a view FILTER, a breadcrumb is NAVIGATION — different verbs. Defer; strategic Q5. |

### F. Tree identity (priorart only)

| # | Proposal | Debate |
|---|---|---|
| F1 | Unbox tactics; neutral goal cards; colour links by proof state; cursor accent → list selection + bold | **C**, and large. For: every peer boxes less; colour becomes free for state. Against: the hover bar, edit overlay, squiggle, hit targets, `nodeRx`, `NODE_STYLES`, the viewer's palette all key on the box; the amber cursor ring is what the eye tracks across relayouts. Reject unboxing; defer the neutral card and the cursor change (Q1). |
| F2 | Active indent guide: all links in `tree.inactiveIndentGuidesStroke`, the cursor's ancestry in `tree.indentGuidesStroke`; drop `--ptw-link-goal/-tactic` kind colouring (priorart) | Accept: paint only, VS Code's own "where am I", and "nobody colours an edge by endpoint kind". `linkSpans`/routing untouched — only stroke ink. |
| F3 | Drop the `▸` used mark (priorart) | **C**: every VS Code tree reads `▸` as a twistie; dimming already says used. Personas call it "good, quiet". Feature removal — **sign-off**. |
| F4 | Dashed hyp/goal separator + `+k` when `Context: used` hides lines (Alectryon) | Defer: a new mark, economy; raise with the owner. |
| F5 | Frontier chips → CodeLens text (idioms) | Reject: "novice gold" as boxes; CodeLens text at 90% is less findable. |
| F6 | `emphasizeFirstGoal` 0.7 siblings; overview strip; case tag on the rule | Reject the first (goals are peers in a tree); defer the others. |

## 2. Ruling table

| Accept | Reject | Defer / sign-off |
|---|---|---|
| A1 codicon path table, all drawn marks | B5 hide unavailable moves | A4 per-surface radius |
| A2 host tokens per surface | B8 toolbar-checkmark pins | A3 bold hyp names (with measurer) |
| A3 infoview colours, `case ` prefix, diff tokens | B10 immediate delete | A6 prose face |
| A5 word-highlight tokens | B11 drop dwell previews | B4 shrink default bar (sign-off) |
| A7 ghost-text ink for generated strips | C4 one look for skip/hide | B7 real code actions (Q4) |
| B1 action-bar hover bar | D2 priority drop | B9 row-spinner verify |
| B2 right-click menu | D4 value-only items | C1 position of the chevron (Q2) |
| B3 menu tokens/groups/keycaps (icons stay) | D15a readout glyphs | C5 ghost chip |
| B6 lightbulb section + slot (pill stays) | D16 context renames | D3 dots + ⌥-cycle (sign-off) |
| B12 lens/chip wording | E4 marks renames, gutter glyph | D6 gear merge (Q5) |
| C1 chevron look at the owner's corner | F1 unboxing | D8 preset retune (Q3) |
| C2 `+N` in fold ink + fold wash | F5 CodeLens chips | D9 setting prune |
| C3 hop break → `⋯ caption` chip | F6a sibling de-emphasis | D11 auto-open (option after D7) |
| C6 drop `§` (italics stay) | | D12 echo toasts (sign-off) |
| C7 rail codicons + collapse/expand buttons | | E2 contributed keybindings (Q4) |
| D1 22px flat strip, no dividers | | E3 node-level ⌥ grammar (sign-off) |
| D5 check-menu panels | | E4 temporary marks default (sign-off) |
| D7 settings behind strip values | | E5 ⌘-click hyp origin |
| D10 codicon problems count | | E6 breadcrumbs (Q5) |
| D11 marker-nav tokens, arrows, F8 | | F3 `▸` removal (sign-off) |
| D13 notification tokens for Undo | | F4 dashed separator |
| D14 `question` + start-here | | F1 neutral goal card / cursor (Q1) |
| D15b `bookmark` glyph form | | |
| E1 frame-scoped keys | | |
| F2 active indent guide | | |
| Brief keeps `have` types; calc narration clipped | | brief out of expert preset (sign-off) |

## 3. Batches

Each ≤ ~1 day for an agent, independently shippable, in order of payoff ÷ effort and nativeness. Gate for every batch: `cd web && npm test` green, `probe fingerprint` unchanged unless noted, `probe overlap`/`order`/`hopgap` unchanged, `node scripts/check-sync.mjs`, a harness screenshot at `/?stub-edit` (1200 and 760 wide, light and dark).

### Batch 1 — codicons and host tokens (no semantics change)

**Files.** New `web/src/codicon.ts` (+ `scripts/gen-codicons.mjs` that reads `node_modules/@vscode/codicons/src/icons/<name>.svg` for an explicit name list and writes `{name: pathD}`; `check` mode in CI like `gen-experience`); `barChrome.tsx`, `nodeBar.tsx`, `topChrome.tsx`, `statusBar.tsx`, `diagInk.ts`, `diagBar.tsx`, `menuIcons.ts`, `moveSlots.ts`, `theme.ts`, `helpPanel.tsx`, `tip.tsx`; delete `glyphPx` levelling where a codicon replaces the glyph.

**Spec.**
- `Codicon({name, size=16, color="currentColor"})`: `<svg viewBox="0 0 16 16" width height fill=color><path d={…}/></svg>`; usable inside the tree `<svg>` as `<g>` and in HTML chrome. Add `@vscode/codicons` as a **devDependency** only.
- Mapping (all verified in 0.0.40): `ChevronGlyph`→`chevron-left/right`; `DisclosureGlyph`/`HeaderChevron`→`chevron-down`; `EyeGlyph`→`eye`; `CommentGlyph`×4→`comment` (show), `eye-closed` (hide), `comment-discussion` (in place), `sparkle` (narrate); `LayoutGlyph`: outline `list-tree`, spine `layout-sidebar-left`, tracks `split-horizontal`, wide `type-hierarchy-super`; `LayoutExtraGlyph`: side-by-side `split-horizontal`, gallery `window`, width `word-wrap`; rail `zoom-in`/`zoom-out`/`screen-full`; `?`→`question`; `BarCheck`→`check`/`blank`; pin→`pin`/`pinned`; `DiagGlyph`→`error`/`warning`/`info`; Marks glyph form→`bookmark`; `MENU_ICON` and `MOVE_LOOK`: source `go-to-file`, focus `target`, skip `debug-step-over`, path `filter`, delete `trash`, trace `references`, collapse `wand`, expand `list-tree`, inline `fold-down`, extract `fold-up`, lint `lightbulb-autofix`, lens `split-horizontal`, goal `add`, more `ellipsis`; the `⋯` menu's edit rows `edit`, `comment`, mark rows `bookmark`.
- Keep `MOVE_MARK` strings for prose/toasts (`probe rewrite` prints them) — only the PAINT changes.
- **Tokens** (`theme.ts`, host var inside the token, fallback derived from bg/fg as the rule says): `--ptw-hover-bg/-border/-fg` = `editorHoverWidget-*` (tips); `--ptw-menu-bg/-fg/-sel-bg/-sel-fg/-sep/-border` = `menu-*` (`⋯` menu, panels); `--ptw-toolbar-hover/-active` = `toolbar-hoverBackground/-activeBackground` (hover bar, rail, bar items' hover wash); `--ptw-hyp-lit` = `editor-wordHighlightBackground`, new `--ptw-hyp-lit-strong` = `editor-wordHighlightStrongBackground` for the introducing step's wash; `--ptw-diff-ins/del` = `diffEditor-insertedTextBackground/-removedTextBackground`; `--ptw-hypname` = `lean4-infoView.hypothesisName`, `--ptw-turnstile` = `lean4-infoView.turnstile`, `--ptw-case` = `lean4-infoView.caseLabel`; `--ptw-fold-ctl` = `editorGutter-foldingControlForeground`; `--ptw-fold-ph` = `editor-foldPlaceholderForeground`; `--ptw-fold-bg` = `editor-foldBackground`; `--ptw-ghost-text` = `editorGhostText-foreground`; `--ptw-comment` takes `--ptw-tok-comment` first. Escaped as `var(--vscode-lean4-infoView\.hypothesisName)`.
- Paint: hyp NAMES in `--ptw-hypname` (colour only, weight unchanged); `⊢` in `--ptw-turnstile`; the case badge in `--ptw-case` with a dim `case ` prefix (the `caseSize` string grows — it measures what it is handed); inaccessible `✝` names `font-style: italic; opacity: .7`; generated `∴`/`≈` strips in `--ptw-ghost-text`.
- **Problems count** (`DiagCountItem`): `[error-icon] 2  [warning-icon] 1  [info-icon] 3` — 16px codicon in the severity ink (`editorError/Warning/Info-foreground`, lint = info at `DIM_OPACITY`), a 3px gap, count in `tabular-nums`, NO background block, two-space separation instead of `·`; the compact `dc` form becomes "worst icon + total"; drop the reserved-digit logic.
- **Message strip**: `--ptw-marker-bg` = `editorMarkerNavigation-background`, header tint per severity from `editorMarkerNavigationError/Warning/Info-headerBackground`, arrows `arrow-up`/`arrow-down` with tips "Previous problem (⇧F8)"/"Next problem (F8)", `close`.
- **Hover bar**: item `22×22`, 16px codicon, padding 3, radius `var(--vscode-cornerRadius-medium, 5px)`, hover `--ptw-toolbar-hover`, pressed `--ptw-toolbar-active`, NO hairline dividers (`BAR_BTN` 22 — `hoverBarMetrics.ts` is the measurer, `nodeBar.tsx` the renderer: change both), container `editorWidget-background` + `-border` + `widget-shadow`.

**Delete.** `ChevronGlyph`, `DisclosureGlyph`, `HeaderChevron`, `EyeGlyph`, `CommentGlyph`, `LayoutGlyph`, `LayoutExtraGlyph`, `SkipIcon`, `TrashIcon`, `InlineIcon`, `DiagGlyph`, `MENU_ICON` paths, `BAR_GLYPH_SW`, `HOVER_ICON_SW`, `glyphPx`, hover-bar dividers, `CHEVRON`-related measurement constants, the `dc` reserved-digit logic.

**Acceptance.** Screenshot: hover bar reads as the notebook cell toolbar (no dividers, codicons); the bar's count is `⊗ 1  ⚠ 1  ⓘ 1` in VS Code's three inks; `case refine_1` in the infoview's green; `⊢` blue; node transforms and scroll identical before/after (hover bar paints outside the measured tree; the case badge is above the box — `probe overlap` and `order` unchanged, `fingerprint` unchanged). `probe viewer` passes (paths, not a font). `check-sync` green.

**Risks.** `--vscode-cornerRadius-*` may not reach webviews — always a literal fallback. The infoview colour vars are absent in the static viewer and the harness — fallbacks are today's inks. `glyphPx` removal needs a dark-theme screenshot pass.

### Batch 2 — menus, panels, strip, keys (chrome structure; no feature removed)

**Files.** `nodeBar.tsx` (menu), `barChrome.tsx` (`BarPanel`, `BarRow`), `statusBar.tsx`, `barMetrics.ts`, `topChrome.tsx` (rail, header), `ProofTreeView.tsx` (`onContextMenu`, `onKeyDown`), `gestures.ts`, `helpPanel.tsx`, `panelKeys.ts`.

**Spec.**
- **Right-click** on a node `<g>`: `onContextMenu` → `preventDefault` → open the `⋯` menu at the pointer (reuse the ⇧F10 path). `gestures.ts` row: `right-click` "to open the move menu". Esc row unchanged.
- **`⋯` menu as a context menu**: `--ptw-menu-*`, radius `var(--vscode-cornerRadius-large, 5px)`, rows 26px, icons stay (16px codicons in the left column), separators (`1px --ptw-menu-sep`) between groups in this order: Navigate (source, focus, path, lens) · Fold (skip, collapse/expand) · Edit (edit tactic, edit comment, delete, marks) · Refactor (inline, extract, lint, rename, trace); the gesture column styled as a keycap (`keybindingLabel-background/-border/-bottomBorder/-foreground`, 11px, radius 3) for keys and plain dim text for `⌥-click`.
- **Panels as check menus**: every `BarPanel` row = `[check|blank 16px] label`, both pick-one and toggle rows (the infoview gear idiom); `BarActionRow` stays a row of buttons; `●/○` and `BarCheck` go. Panel surface `--ptw-menu-*`, radius large.
- **Strip**: `BAR_H` 26→22, items 18, `padding: 0 5px`, `BarDivider` deleted, `font-variant-numeric: tabular-nums`; groups unchanged, ladder unchanged.
- **Rail**: square 22px action-bar buttons, `zoom-in` · `zoom-out` · `screen-full` · gap · `collapse-all` · `expand-all`; ⌥ glyph swap deleted; tips "Collapse to the outline" / "Expand all". Layout panel's `Expand all · Collapse` buttons go; `Reset tree` stays a `BarRow` action.
- **Header**: `--ptw-sticky-bg/-border/-shadow` = `editorStickyScroll-background/-border/-shadow`.
- **Keys** (frame-scoped, `onKeyDown` where `target === frame`): `Space` = the goal's fold/unfold (same `onNodeClick` path as →/←); `Ctrl+K Ctrl+0` / `Ctrl+K Ctrl+J` = collapse all / expand all (chord state cleared after 1 s or any other key); `F8` / `⇧F8` = next/previous diagnostic (pager + reveal, the strip's own click path); `⌘.`/`Ctrl+.` = open the `⋯` menu (same as ⇧F10). Help panel lists them with keycaps.
- **Help panel**: a "Start here" head: *click a box → source · the corner chevron folds · right-click → every move*.
- Toasts with Undo: `--ptw-notif-bg/-border` = `notifications-background/-border`, Undo as `button-background/-foreground`. Position stays.

**Delete.** `BarDivider`, `BarCheck`, radio glyphs, the rail's ⌥ swap, Layout panel's Expand/Collapse buttons, `CARD`-era `BAR_H` constants.

**Acceptance.** Screenshot: `⋯` reads as a VS Code context menu (separators, keycaps), panels show `✓` rows; strip 22px with no dividers and every item rect measured (`fit`) — `probe` harness `window.__ptw` count/nodes unchanged, no node transform moves (the strip is outside the tree); right-click on a node opens the menu with the browser menu suppressed; `Space` on a focused goal folds (screenshot `+N`). `fingerprint` unchanged.

**Risks.** VS Code may consume `⌘.`/`F8` before the webview — test live and fall back to ⇧F10 / the strip's arrows. The chord needs a tiny state machine; keep it in a ref, never read in render.

### Batch 3 — fold, hop, seed, brief, narration (tree marks; look-over, one semantics fix)

**Files.** `ProofTreeView.tsx` (corner paint, fold wash), `topChrome.tsx` (`HopBreak`), `layout.ts` (`hopCaptionWidth` only), `elide.ts` (`SEED_MARK`), `briefLabel.ts`, `narrate.ts`, `probe/fingerprint.baseline.json` (`--update`, INTENDED), `probe/counts.mjs` if a count moves, `theme.ts`.

**Spec.**
- **Fold control** (at the owner's top-right corner, pending Q2): open goal → `chevron-down` 16px in `--ptw-fold-ctl`, `opacity 0 → 1` over 0.5 s while the box is hovered or the node is keyboard-active (paint only; the `[data-ptw-corner]` hit rect unchanged); folded → `chevron-right` ALWAYS, then `+N` in `--ptw-fold-ph`, the box washed `--ptw-fold-bg`. Seeded folds: italic `+N` as today, no `§`.
- **Hop**: `HopBreak`'s two slants → a `⋯` in `--ptw-fold-ph` centred on the link's midpoint on a `--ptw-bg` underlay, the caption (`have · intro · …`) immediately to its right as now — so the break reads as the editor's folded line; `TRUNK_GAP_HOP` 34 stays (the chip needs the run). Click/`<title>` unchanged. `probe hopgap` asserts line both sides — the chip must not cover the line ends; model its rect in `probe overlap` where the caption's is.
- **`SEED_MARK` → ""** for the caption and ghost label; seeded italics and `seedTitle` stay (the author's voice is still visible, just not a `§`).
- **Brief E1**: a `have/obtain/let/suffices` binder keeps `name : type` and elides the JUSTIFICATION only (`:= …`); the `Scan.assign` offset is where the cut starts. `rewriteCtx.nodes` already reads `elision.original`. This changes the fingerprint on purpose.
- **Narration calc**: `Chain: ` echoes the chain only up to `clipText(…, 60, {words: true})` plus ` (N links)`; coverage stays 251/251 (a line is still emitted; `probe narrate` residue 0).
- Generated strips upright? No — only ink (batch 1 did it).

**Delete.** `CORNER_MINUS_W/SW` and the drawn minus; `HopBreak`'s slants; `§`.

**Acceptance.** `14-fold` shows a chevron-right + `+5` in the fold-placeholder ink and a washed box; `13-skip` shows `⋯ have` on the line; `probe order`, `hopgap`, `overlap` 0 regressions; `counts` unchanged; `fingerprint --update` with the diff limited to brief labels + the calc narration line; `11-expert` reads `have hsq : 0 ≤ (a - b) ^ 2 := …`.

**Risks.** The hover-only chevron is less discoverable than an always-on mark for the novice — the hover bar appears on the same hover, so the box already "wakes"; if the owner objects, draw it always at `DIM_OPACITY`. The `+N` corner's `topLineWidth` reserve (`CORNER_W`) must hold the 16px chevron + `+N`: widen `CORNER_W` and re-check `probe overlap`.

### Batch 4 — lightbulb section and slot (changes `MOVE_IDS`; owner look-over)

**Files.** `moves.ts`, `moveSlots.ts`, `nodeBar.tsx`, `ext/ramify/extension.js` (`MOVE_IDS_FOR`), `ext/ramify/package.json` (hoverBar enums), `scripts/check-sync.mjs`, `gestures.ts`, `rename.ts` wiring in the view.

**Spec.** One move id `fix` (bar glyph `lightbulb`, `lightbulb-autofix` in `editorLightBulbAutoFix-foreground` when a lint fix is available, else `editorLightBulb-foreground`) whose click opens the `⋯` menu scrolled to its Refactor section — rows: Quick Fix (lint fix ✎, write out `simp` ⇑, rename `h` → `hx` — D5 gets a visible door; its ⌥-click on the line stays), Refactor (inline ⤵, extract ⤴, replace run ⇓, `sparkle` "Ask the model for a rewrite" where `proposeReady`). The five ids stay in `MOVE_IDS` (pinnable) but leave the DEFAULT lists for `fix`; the slot is DISABLED (same `unavailableTip`) where no row is available. The **pill stays**: a row click still goes through `checkRewrite` → the pill → the second click. `⌘.` (batch 2) opens the same section.

**Acceptance.** `check-sync` green; `probe rewrite` output unchanged (titles unchanged); screenshot of a lint fixture node showing the autofix bulb; harness `?stub-edit` applies an inline through the row + pill. **Needs owner sign-off** (it moves rename out of a hidden gesture and changes the bar's vocabulary).

### Batch 5 — settings behind the strip (persistence; new wire fields)

**Files.** `ext/ramify/package.json` (new `ramify.view.layout|sideBySide|gallery|width|context|hypGroup|comments`, `ramify.reading.brief|merge|lints|hypOrigins|upToCursor`, `ramify.diagnostics.autoOpen`, `hypMarkStyle: none`), `extension.js` (`ramifySettings` already publishes every `ramify.*` per folder; add `action: "setting"` to `settings-request.json` with an allow-list = these keys, written Workspace-if-set-there else User via `writeTarget`), `Ramify.lean` (`ThemeColors` fields as `Option`), `widget.tsx` (parse → defaults), `ProofTreeView.tsx` (`useOverride(default)` for each — the pattern exists), `INSTALL.md` + `scripts/check-settings.mjs`.

**Spec.** A strip or panel change (a) sets the session override as today and (b) asks the companion to write the setting (`popoutEdit` action `setting`), so the choice survives reload and syncs; the preset keeps filling defaults beneath the settings. `useOverride`'s "equal to the default → null" rule makes the layering collapse by itself once the written setting arrives. No companion: session only, as today. `autoOpen` becomes the reading option `errors open the message strip` (default on). **Sign-off** for the key names.

**Acceptance.** `check-settings` green; `probe lsp … --wire` identical (plain data only); live: change Layout → `settings.json` gains `ramify.view.layout`; reload → the layout holds. The static viewer ignores all of it (`caps`).

### Later, each on sign-off

Default bar shrink (B4), dots and ⌥-cycle (D3), beginner retune and `brief` out of expert (D8), temporary marks off (E4), `▸` (F3), echo toasts (D12), bold hyp names with the measurer (A3), prose face (A6), real code actions + contributed keybindings (B7/E2 — need a push channel), neutral goal card / cursor selection look (F1), breadcrumbs (E6), ghost chip (C5), per-surface radius (A4).

## 4. Strategic questions for the owner

1. **How far toward "neutral VS Code list" should the tree's identity go?** Priorart proposes neutral goal cards, unboxed tactics, state-coloured links and a list-selection cursor. My recommendation: take F2 (active indent guide, kind-neutral links) now; keep the two coloured box kinds and the amber cursor ring — they are the product's one piece of domain colour and what the eye tracks through an anchored relayout. Revisit after batches 1–3 with screenshots.
2. **Fold control: top-right (your direction) or the left gutter (every VS Code tree)?** Recommendation: move it left, outside the box where the trunk enters, once the mark tab question (4) is settled — the two compete for the top-left corner. Until then, batch 3 draws the chevron at the top-right.
3. **Defaults: who is "intermediate", and do beginners want more or less?** Three personas say the beginner preset gives the user who can least filter the most (Context `all`, narration on, connectors). Recommendation: beginner = Context `used`, narration OFF, origins ON, `⁇` on the bar; `brief` OFF for expert; temporary marks stay ON (the nub is dwell-gated and the harm is assumed, not observed).
4. **Do you want a push channel from the extension into the widget?** Everything the expert asked for — palette commands, contributed keybindings, real code actions at the tactic's range — needs the companion to reach the live view, which today has only the request-file → RPC → poll path. Recommendation: not yet; frame-scoped keys (batch 2) cover 80% at zero architecture, and a `ramify.focusTree` command that focuses the infoview is the one contributed key worth adding now.
5. **Strip vs gear: should Reading/Comments/Context stay as status-bar values or fold into one `settings-gear` menu like the infoview's?** Recommendation: keep the values (the educator reads them at a glance, and after batch 5 they are real settings), and keep `⊹` a filter rather than making the header a breadcrumb — a breadcrumb navigates, `⊹` hides.
