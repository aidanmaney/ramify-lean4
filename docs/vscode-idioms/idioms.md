# Ramify → VS Code idiom map

Reviewed against: VS Code 1.140 workbench CSS (`code-server/lib/vscode/out/vs/code/browser/workbench/workbench.css`), `@vscode/codicons` 0.0.40 (the version the Lean infoview bundles, `lean4-infoview/package.json`) and 0.0.46, and `lean4-infoview/src/infoview/*.tsx`. Ramify was read at HEAD and checked in the harness at HEAD. The live working tree is mid-edit: an uncommitted `web/src/squiggle.tsx` exists and throws "Squiggle is not defined" at render, so someone is already doing item #1 below. Screenshots are in `/tmp/claude-0/critique/h1.png`, `h2.png` and `m1.png`.

## Three facts that make most of this cheap

1. **Codicons are already loaded in the infoview.** `lean4-infoview/src/infoview/main.tsx:6` imports `@vscode/codicons/dist/codicon.css` and the `.ttf`. The infoview draws its own toolbar with them: `codicon-go-to-file` (reveal in file), `codicon-pin`/`codicon-pinned`, `codicon-refresh`, `codicon-collapse-all`, `codicon-settings-gear`, and `codicon-check`/`codicon-blank` in its goal-settings menu. Its message tally is `codicon-error N codicon-warning N codicon-info N` (`messages.tsx:482 TallyDisplay`). Every name proposed below exists in 0.0.40.
   - **Recommended mechanism:** a `codicon.ts` table of the 16×16 `path d` strings taken from `@vscode/codicons/src/icons/*.svg` at build time. Most of Ramify's chrome is SVG (the hover bar is `<g>`s in the tree's `<svg>`, see `nodeBar.tsx:280`), and the static viewer has no infoview font, so path data works everywhere. A `<text font-family="codicon">` glyph would only work inside the infoview.
2. **Every `--vscode-*` colour token reaches the webview.** The ones that matter here: `toolbar-hoverBackground`, `toolbar-activeBackground`, `menu-*`, `editorHoverWidget-*`, `editorGutter-foldingControlForeground`, `editor-foldPlaceholderForeground`, `editorError/Warning/Info/Hint-foreground`, `editorLightBulb-foreground`, `list-*`, `focusBorder`, `badge-*`, `keybindingLabel-*`, `editorMarkerNavigation*`, `widget-shadow`, `disabledForeground`.
   - The new size tokens `--vscode-cornerRadius-{xSmall 2, small 4, medium 6, large 8}` are registered as sizes, not colours, so they may not reach webviews. Use them with literal fallbacks.
3. **The real idioms, measured from the CSS:**

   | Idiom | What VS Code does |
   |---|---|
   | Action bar | `.monaco-action-bar .action-label` has `padding:3px`, a 16px codicon (so 22×22), `border-radius: var(--vscode-cornerRadius-medium)`, hover `--vscode-toolbar-hoverBackground`, disabled `opacity:.6` or `--vscode-disabledForeground`. No dividers between icons. |
   | Squiggles | Wavy SVG background in `editorError/Warning/Info-foreground`. Hint is `2px dotted` (`.squiggly-hint`). Unnecessary code is faded (`editorUnnecessaryCode.opacity`). |
   | Folding | `codicon-folding-expanded`/`-collapsed` (chevron-down/right) in `--vscode-editorGutter-foldingControlForeground`. The expanded chevron shows only on gutter hover (`opacity:0` → 1); the collapsed one always shows. |
   | Folded text | `.inline-folded:after { content:"\22ef"; color: var(--vscode-editor-foldPlaceholderForeground) }`: the `⋯` badge, clickable to unfold. |
   | Lightbulb | `codicon-light-bulb` / `codicon-lightbulb-autofix` in `--vscode-editorLightBulb(AutoFix)-foreground`. Opens the action widget: `--vscode-menu-background`, border `--vscode-editorHoverWidget-border`, `--vscode-cornerRadius-large`, grouped "Quick Fix" / "Refactor…" headers, keybinding labels in `keybindingLabel-*`. |
   | Status bar item | 22px line, `padding:0 5px`, `font-variant-numeric: tabular-nums`, no dividers. Problems item: `$(error) 2 $(warning) 1 $(info) 0`. |
   | Infoview tooltip | `.tooltip`: `editorHoverWidget-background/-border`, radius 4px, `box-shadow: 1px 1px 5px var(--vscode-widget-shadow)`. |
   | Sticky scroll | `.sticky-widget`: `border-bottom:1px solid var(--vscode-editorStickyScroll-border)`, shadow `--vscode-editorStickyScroll-shadow`. |

## Inventory → idiom table

Effort: S = under half a day, M = 1–2 days, L = more. Confidence (H/M/L) is how sure I am that a VS Code user reads the native idiom correctly in this context.

### Diagnostics

| Current thing | Where | VS Code idiom | Concrete adoption | Eff | Conf |
|---|---|---|---|---|---|
| Error/warning/lint **ribbon**: 3px left stripe, thick solid for error, dashed for warning, thin for lint | `diagInk.ts` (`ribbonStrokeOf`, `RIBBON_W*`), ProofTreeView ribbon paint | **Squiggle under the offending text** | Draw a wavy underline under the tactic **label's text extent**, not the box: a 6×3 sine tile in `--vscode-editorError-foreground` / `-editorWarning-foreground`. The severity then lives in hue + wave, exactly as in the buffer 2 cm away. Delete the stripe, the dash pattern and `RIBBON_TAB_GAP`. (A WIP `squiggle.tsx` is already in the tree.) | M | H |
| Lint (`SEVERITY_LINT`, comment ink, thin line) | `diagInk.ts` `DIAG[3]` | **Hint dots** (`.squiggly-hint` = `2px dotted var(--vscode-editorHint-foreground)`) under the first few characters | VS Code's own idiom for "not a problem, a suggestion". The record's objection ("dots read as bullets beside hyps") was about a vertical left-edge run; a horizontal 3-dot run under the label is the editor's hint, not a bullet. | S | M |
| Error **box wash** (`DIAG_BOX_WASH_OPACITY`) + box **border recoloured** red/amber (see h1.png: the `have hsq` box is red-bordered, ribboned *and* washed) | ProofTreeView, theme `--ptw-diag-*-wash` | One channel. VS Code never tints a whole region for an error except `editorError-background` (transparent by default). | Keep the squiggle. Optionally keep a **1px border** in `editorError-border` only when that var is set (high contrast). Drop the wash and the border recolour. Today it is triple-encoded. | S | H |
| Node `<title>` "Error: …" | ProofTreeView | Hover shows the message (editor hover with the marker) | Keep, but route the message through the same hover as goals (see Tips) | S | M |
| Status-bar **count** `✕ 2 · ⚠ 1 · ◇ 3` (drawn `DiagGlyph`s, `·` separators, dark pill in h1.png) | `statusBar.tsx` `DiagCountItem`, `diagBar.tsx`, `diagInk.ts` glyphs `⨯ ⚠ ◇` | **Problems status item** and the infoview's own `TallyDisplay`: `$(error) 2 $(warning) 1 $(info) 3` | `codicon-error` / `codicon-warning` / `codicon-info` (lint → info), a space not `·`, plain ink, no background block. Delete `DiagGlyph`, the compact `dc` form and the "two tabular digits reserved" logic (use `tabular-nums`, as the status bar does). | S | H |
| **Message strip** (`DiagStrip`): floating tinted bar, 3px severity edge, wraps to 3 lines, `‹ n/N ›`, `×`; auto-opens on a new error | `statusBar.tsx` DiagStrip, theme `--ptw-diag-*-edge/-wash` | **Marker navigation widget** (F8 peek): severity codicon, message, "n of N", `codicon-arrow-down`/`arrow-up` ("Next/Previous Problem"), `codicon-close`, header coloured by `--vscode-editorMarkerNavigationError-headerBackground`, body `--vscode-editorMarkerNavigation-background` | Restyle it as the marker widget: tokens as listed, arrows not chevrons. Open it **inline under the node** (as F8 opens under the line) or keep it docked, but take its colours. Add **F8 / ⇧F8** while the tree frame has focus. Do **not** auto-open: VS Code never opens the problem peek by itself; the squiggle + count are the notice. | M | M |
| Diag pager chevrons `ChevronGlyph` | `barChrome.tsx:91` | `codicon-chevron-left/right` (or arrow-up/down for problems) | Replace the drawn mark with the codicon | S | H |

### Hover bar and moves

| Current thing | Where | VS Code idiom | Concrete adoption | Eff | Conf |
|---|---|---|---|---|---|
| Hover bar container: one rect at `CHROME_RADIUS` 3, **hairline dividers** between icons, `BAR_BTN` squares | `nodeBar.tsx`, `hoverBarMetrics.ts` | **Floating action bar** (notebook cell toolbar / editor title actions): `editorWidget-background` + `editorWidget-border`, `widget-shadow`, 22px items, **no dividers** | Item 22×22, 16px codicon, 3px padding, radius `var(--vscode-cornerRadius-medium, 5px)`, hover `--vscode-toolbar-hoverBackground`, pressed `--vscode-toolbar-activeBackground`. Delete the dividers and `HOVER_ICON_SW`. | S | H |
| `»` show in source | `moves.ts` MOVE_MARK.source | Infoview's own **`codicon-go-to-file`**, which means "reveal this location in the file" in the infoview header and on every message | `codicon-go-to-file` | S | H |
| `◎` focus (goal) | MOVE_MARK.focus | VS Code has no "focus subtree" verb. Nearest: Explorer "Focus on…", Zen/maximise | `codicon-zoom-in` (focusing narrows the view) or `codicon-target`. I prefer `zoom-in`: the rail's `+` is zoom too, but it lives in another surface. | S | M |
| `◌` skip (SkipIcon) | `nodeBar.tsx` SkipIcon | **Debugger "Step Over"**: pass over this step and keep reading the next | `codicon-debug-step-over`. For a reader stepping down a proof the metaphor is exact. | S | H |
| `⊹` show only the path to here | MOVE_MARK.path | Breadcrumbs / "Reveal in tree"; `type-hierarchy-super` shows the ancestor chain | `codicon-type-hierarchy-super` or `codicon-list-tree`. Better: make it the breadcrumb idiom (see header). | S | M |
| trash (delete step) | `TrashIcon` | `codicon-trash` (SCM "Discard", Explorer delete) | `codicon-trash`. Keep the armed-confirm pill, but style it as an inline **Undo** toast rather than a confirm (see Toasts). | S | H |
| `⁇` what did simp use (trace) | MOVE_MARK.trace | "Find All References" / peek | `codicon-references`; the open trace leaves read as a references peek | S | M |
| `⇓` replace N steps with automation | MOVE_MARK.collapse | **Code Action → Refactor** | Remove from the bar. Show it as a row in the lightbulb menu (see next table). | M | H |
| `⇑` write out what simp used | MOVE_MARK.expand | **Quick Fix**: "Try this: simp only […]" is already shown in Lean as a code action | Lightbulb row | M | H |
| `⤵` inline `have` / `⤴` extract `by` block (InlineIcon) | `nodeBar.tsx` InlineIcon | **Refactor → Inline… / Extract…** (VS Code's own refactor kinds `refactor.inline`, `refactor.extract`) | Lightbulb rows "Inline `h`" and "Extract to `have`". Delete InlineIcon. | M | H |
| `✎` apply linter fix | MOVE_MARK.lint | **Quick Fix** on a diagnostic, shown with `codicon-lightbulb-autofix` when a preferred fix exists | Lightbulb row. The lightbulb turns autofix-coloured (`editorLightBulbAutoFix-foreground`) when a lint fix is available. | M | H |
| D5 rename (⌥-click a context line) | `rename.ts` | **Rename Symbol (F2)** / a Quick Fix "Rename to `hx`" | Put it in the same lightbulb menu on the goal. Drop the ⌥-click-on-text gesture, which nobody discovers. | S | H |
| `⧉` open in lens | MOVE_MARK.lens | "Open to the Side" (`codicon-split-horizontal`) / peek (`codicon-open-preview`) | `codicon-split-horizontal` (the lens is a slim editor group below) | S | M |
| `+` show a ledger step's goal | MOVE_MARK.goal | — | `codicon-add` (or move to `⋯` only) | S | M |
| `⋯` "More" opens the move menu | `nodeBar.tsx:474` | **`codicon-ellipsis` "More Actions…"** opening a **context menu** | Keep the icon. The menu is a context menu: `menu-background`, `menu-foreground`, `menu-selectionBackground/Foreground`, `menu-separatorBackground`, `menu-border`, radius `cornerRadius-large`(8) / 5 fallback, 26px rows, keybinding column right-aligned in `keybindingLabel` look. Also open it on **right-click / ⇧F10**, which VS Code users try first. | M | H |
| Push-pin toggle per menu row ("Show on the bar for tactics") | `nodeBar.tsx:604` | `codicon-pin` / `codicon-pinned` (the infoview's own pin) | Swap the drawn pin. In VS Code, though, "which actions are on a toolbar" is done by **right-click on the toolbar → check/uncheck items** (title-bar/activity bar). Move the pins there: a row of checkmarks, not a pin column. | M | M |
| Disabled slots (`DISABLED_OPACITY` 0.35) with "Name — reason" tip | `moves.ts` `unavailableTip` | Action-bar disabled = `opacity:.6` / `disabledForeground`; VS Code **hides** unavailable contributed actions, it does not grey them | Hide unavailable moves on the bar (keep "not available because…" only in the menu, as VS Code's action widget shows disabled code actions with a reason). | S | M |
| Proposal pill "Replace these 4 steps with `omega` · ✓ elaborates" (live) / "✗ …" (inert) | ProofTreeView, `moves.ts` CHECKED_FIRST | **Code action preview**: the action widget's **preview pane** shows the edit before apply. Rejected actions appear disabled with the reason. | Verify while the menu row is hovered: show a spinner (`codicon-loading codicon-modifier-spin`, exactly the infoview's spinner), then the row becomes enabled or disabled-with-reason. Delete the separate pill and its "click the pill" step: one click applies, ⌘Z undoes. | L | M |
| D6 "suggest a rewrite" | Reading options | Copilot's **sparkle code actions** (`codicon-lightbulb-sparkle`, `editorLightBulb-foreground`) | Make it a lightbulb row with `codicon-sparkle` ("Ask the model for a rewrite"), not a reading option | S | M |

### Folding, cuts and tree marks

| Current thing | Where | VS Code idiom | Concrete adoption | Eff | Conf |
|---|---|---|---|---|---|
| Goal corner `−` (drawn stroke, top-right) | `CORNER_MINUS_*`, `[data-ptw-corner]` | **Folding chevron** in the gutter: `codicon-chevron-down` when expanded (shown only on hover, `opacity 0→1` over .5s); `codicon-chevron-right` when collapsed (always shown); colour `--vscode-editorGutter-foldingControlForeground` | Move it to the box's **top-left, outside the box, in the link gutter** where the trunk enters (the tree's "gutter"). Chevron-down on hover only, chevron-right always when folded. Every tree view (Explorer, Outline) puts the twistie on the **left**. | M | H |
| `+N` corner badge on a folded goal (label ink at DIM_OPACITY) | ProofTreeView `folded.tactics` | **Folded-region placeholder**: `⋯` after the folded line in `--vscode-editor-foldPlaceholderForeground`, clickable; `editor.foldBackground` wash on the folded line | Draw `⋯` (or `⋯ 7 steps`) as a trailing chip at the **bottom-left under the goal**, where the hidden content would be, in `foldPlaceholderForeground`. Optional `editor-foldBackground` wash on the folded box. Click unfolds. | S | H |
| Hop: `+N` + **HopBreak** (two slanted strokes on the link, 34px gap) + italic **caption** `have · intro · …` | `elide.ts` hopCaption, layout `TRUNK_GAP_HOP` | No graph-axis-break idiom. Closest: the folded `⋯` placeholder **inline on the line** | Replace the slashes with a single `⋯` placeholder chip on the link (`foldPlaceholderForeground`, hover text = the caption). Keep the caption only as the chip's hover. | M | M |
| Skip vs hide distinction (`+N` with break = skipped; without = hidden) | elide.ts | VS Code has one fold look | Honest recommendation: **one look** (`⋯` chip). The verb difference is in what is kept (continuation goal visible or not), which the layout already shows. | M | M |
| Ghost (dashed tactic box, `+N` badge at right edge) | `ghostSize`, `isGhostNode` | Same `⋯` placeholder | Dashed box → a plain `⋯ 4 steps` chip on the link | M | M |
| Seeded cuts: `§ ` prefix + italics + comment-ink `+N` | `SEED_MARK` | Code-defined folding regions (`#region`) look **identical** to user folds in VS Code | Delete `§` and the seeded italics. The `<title>` can still say "folded by `.fold` in the source". | S | H |
| Mark tab (rounded tab straddling top-left, numbered, two inks: author vs yours) + dashed quick-add **nub** in an invisible corner region | `TourTab`, `NUB_SLACK`, `tour.ts` | **Bookmarks** (glyph-margin `codicon-bookmark`) / **breakpoints** (glyph-margin dot that appears ghosted on hover, click to toggle) | A glyph in the box's left gutter: `codicon-bookmark` in `--vscode-editorBookmark...` or plain icon ink. Source `.mark` = filled, temporary = outline. Number only in the hover. The **hover ghost** is the breakpoint idiom: a faint icon shown while the pointer is in the gutter, click to set. The breakpoint gutter is a well-known spot, so use a real left gutter strip, not an 8px invisible corner region. Navigation `<` `>` → also bind **F2-free Bookmarks idiom ⌥⌘K / ⌥⌘L** is extension-only; keep `<`/`>`. | M | M |
| Case badge (`succ k ih`, `inl ⟨k, hk⟩`, `refine_1`) | layout `caseSize` | Infoview's own **`case` label** (`--vscode-lean4-infoView.caseLabel`, `.goal-case`) | Colour it with `var(--vscode-lean4-infoView\.caseLabel)` and prefix `case `, exactly as the infoview prints it. | S | H |
| Context hyp lines: used vs unused dim (74%) | theme `--ptw-hyp-unused` | `editorUnnecessaryCode.opacity` (faded unused code) | `opacity: var(--vscode-editorUnnecessaryCode-opacity, .67)` on unused lines | S | M |
| Hyp-used hover wash `--ptw-hyp-lit` | theme | **Highlight occurrences**: `editor-wordHighlightBackground` / `-wordHighlightStrongBackground` (read vs write) | Wash used hyps with `wordHighlightBackground`, the introducing step with `wordHighlightStrongBackground`. This maps exactly: read access vs write access. | S | H |
| Hyp-origin dashed elbow connector | ProofTreeView `hypOriginHit` | Go to Definition (⌘-click / F12), **peek** | Make ⌘-click on a hyp line jump to (anchor + accent) the introducing step, the Go-to-Definition idiom. Drop the dashed connector. | M | M |
| Tactic diff wash (`diffEditor-*TextBackground`) | taggedRender | Already native | Keep | – | H |
| Accent / selected node (`SEQ_STROKE`, `--ptw-accent`) | theme | **List selection**: `list-activeSelectionBackground`, `list-focusOutline`; hover `list-hoverBackground` | Selected box: `list-activeSelectionBackground` fill tint + `focusBorder` outline when the frame has focus, `list-inactiveSelectionBackground` when not. | S | H |
| Keyboard focus ring (`--ptw-focus`, open path `ringPath.ts` leaving room for the tab) | theme, ringPath.ts | `focusBorder` 1px outline, `outline-offset:-1px` (list focus) | Already on `focusBorder`. Delete the open-path special case once the mark moves to the gutter. | S | H |
| Marquee selection + pill | `selectionPill.tsx`, `pillPlace.ts` | Multi-select in lists (⇧/⌘-click); selection colour `list-activeSelectionBackground` | Keep the marquee (no VS Code analogue, but it is learnable). The marquee rect: `--vscode-editor-selectionBackground` fill. The pill → the same context menu as `⋯` for a multi-selection. | M | M |
| Frontier chips `+ / sorry / calc / step / ?_` on open goals | `chipMoves.ts`, `pickChips.tsx` | **CodeLens** (`editorCodeLens-foreground`, small text links above a symbol) | Restyle as CodeLens text: `sorry · calc · step · ?_` in `editorCodeLens-foreground`, 90% font, hover underline, no boxes. Delete `CHIP_SHADOW`. | S | H |
| Trace leaves (dashed positionless leaves) | trace.ts | References peek results | Keep, styled like inlay hints: `editorInlayHint-background/-foreground` | S | M |
| Generated narration `∴` / polished `≈` strips | narrate.ts, `NARRATE_MARK` | **Inlay hints** / ghost text (`editorGhostText-foreground`, italics). Machine-written text in the editor | Colour generated strips `--vscode-editorGhostText-foreground`. Drop `∴`/`≈` and use `codicon-sparkle` only for the model-polished one. Ghost text is how VS Code says "not your words". | S | M |
| Author comment strips (`--ptw-comment`) | theme | Syntax comment colour | `--ptw-tok-comment` (already the theme's own token) | S | M |
| `⋯ more` clamp | layout | Hover / "Show more" link (`textLink-foreground`) | Colour it `textLink-foreground` | S | H |
| Counterfactual dashed stub | widget | — | No native counterpart; keep | – | – |
| Wide-layout comment hairline tie | `data-ptw-strip-tie` | — | Delete (see Delete list) | S | M |

### Status strip, panels and rail

| Current thing | Where | VS Code idiom | Concrete adoption | Eff | Conf |
|---|---|---|---|---|---|
| Status strip: own bordered card, `BAR_H` 26, two groups, `BarDivider`s, three-form compaction ladder | `statusBar.tsx`, `barMetrics.ts` | **Status bar**: 22px, flat, items `padding:0 5px`, hover `statusBarItem-hoverBackground`, **no dividers**, items simply drop when space runs out (priority order) | Height 22, no border card (or the infoview's own `--vscode-panel-border` top line), no dividers, `tabular-nums`. Replace the 2-stage ladder with **priority drop**. VS Code never turns `Layout: outline` into a glyph-only form; it shows `$(icon) value` and drops whole items. | M | H |
| `Layout: outline` / `Context: used` / `Comments: show` value items + ⌥-click cycles + dot | statusBar | Status items such as `Spaces: 4`, `UTF-8`, `LF`, `Lean 4`: **value only, click opens a quick pick** | Write `$(icon) outline` (or just `outline`) with the name in the tooltip, like `Spaces: 4`. Drop ⌥-click cycling: no status item does it. Drop the per-item **dot**: VS Code marks a non-default setting nowhere in the status bar. | M | H |
| Bar **panels** (Layout, Context, Comments, Reading, Marks): hang from the item, `●/○` radio rows, `BarCheck` toggles, `BarActionRow` | `barChrome.tsx` BarPanel, BarRow | **Quick Pick** (status item click → `showQuickPick` at top centre, current value marked `$(check)`) or the **infoview's own settings menu** (`goals.tsx:353`: `tooltip-menu` rows with `codicon-check`/`codicon-blank`) | Use the infoview idiom, since it is in the same panel: a hover-widget-styled menu, `codicon-check` for on rows and `codicon-blank` for off. That one rule replaces `●/○` and `BarCheck`. Colours: `menu-*` tokens. | M | H |
| Reading options (eye glyph, 7 toggles, one dot) | barChrome EyeGlyph, experience.ts | Infoview **gear** (`codicon-settings-gear`) menu; "View" toggles in a `⋯` overflow | Fold Reading + Comments + Context into **one `codicon-settings-gear` menu** with section headers, as the infoview's goal-settings gear does. The bar keeps Layout + Status + Problems. | M | M |
| `?` help panel (320px grid) | `helpPanel.tsx` | **Keyboard Shortcuts editor** / walkthrough; `codicon-question` | `codicon-question`. Content as a two-column table with `keybindingLabel` key caps. | S | M |
| Status readout `tour_reading · 5 steps · 1 open · 4 hidden` with clickable counts | `StatusReadout` | Status bar text items + **Problems-style click to navigate** | Keep, but `1 open` → `$(circle-outline) 1` ("next open goal", like the sorry count) and `4 hidden` → `$(fold) 4`. Click behaviour stays. | S | M |
| Marks item `Marks: 2/5 ‹ ›` | statusBar | Search result navigation `2 of 5` + `codicon-arrow-up/down` | `$(bookmark) 2/5` with arrows only on hover | S | M |
| `Reading ▾` / DisclosureGlyph / HeaderChevron | barChrome | `codicon-chevron-down` | Replace the drawn marks with the codicon | S | H |
| Layout glyphs (LayoutGlyph ×4, LayoutExtraGlyph ×3) | barChrome.tsx:840,869 | `codicon-list-tree` (outline), `codicon-layout-sidebar-left` (spine), `codicon-split-horizontal` (tracks/side-by-side), `codicon-type-hierarchy` (wide), `codicon-word-wrap` (width), `codicon-window`/pager (gallery) | Swap the 7 drawn marks for codicons | S | M |
| Comment-mode glyphs `CommentGlyph({mode})` (4 drawn marks) | barChrome.tsx:785 | `codicon-comment`, `codicon-comment-discussion`, `codicon-eye-closed` | Use one `codicon-comment` with the value as text; delete the per-mode glyphs | S | M |
| Zoom **rail** `+ − ⛶` (round buttons, ⌥ swaps to `⊞/⊟`) bottom-right | `topChrome.tsx:603` | Infoview toolbar (top-right, `link pointer mh2 dim codicon`). Zoom in VS Code is ⌘= / ⌘- / ⌘0; tree views have `codicon-collapse-all`/`expand-all` buttons | `codicon-zoom-in`, `codicon-zoom-out`, `codicon-screen-full` (fit). **Separate** `codicon-collapse-all` / `codicon-expand-all` buttons instead of ⌥ swapping glyphs. Square 22px action-bar buttons, not round. | S | H |
| Layout panel `Expand all · Collapse · Reset` | barChrome BarActionRow | Tree view title actions `$(collapse-all)` `$(expand-all)` `$(refresh)`/`$(discard)` | Same codicons on the rail; delete the panel row | S | H |
| Signature header (one greedy line, HeaderChevron, click to open the full signature) | topChrome, briefLabel `headerPrefix` | **Sticky Scroll** (pinned declaration line, `editorStickyScroll-*`, border-bottom + shadow) + **Breadcrumbs** for the path | Style the header as a sticky-scroll line (background `--vscode-editorStickyScroll-background`, `editorStickyScroll-border`, the shadow). Turn "show path to here" into a **breadcrumb trail** in that header: `theorem foo › induction › succ › calc`, each segment `breadcrumb-foreground`, clickable. That gives ⊹ a native home. | M | H |

### Tooltips, toasts, menus, keys, settings

| Current thing | Where | VS Code idiom | Concrete adoption | Eff | Conf |
|---|---|---|---|---|---|
| In-page tooltips (`TipLayer`, 1000 ms dwell, `FLOATER_CHROME`) | `tip.tsx`, `tipController.ts` | **Hover widget**: `editorHoverWidget-background/-foreground/-border`, radius 4, `widget-shadow`. Workbench hover delay is ~500 ms (`workbench.hover.delay`), then instant on neighbours | Tokens = `editorHoverWidget-*` (`--ptw-chrome-bg` currently reads `editorWidget-background`). Keep the dwell mechanics (they already copy VS Code). Format `Name — gesture` as VS Code does: title, then a dim `(⌥-click)` keybinding. | S | H |
| Node box `<title>`s (native) | ProofTreeView | Editor hover with sections separated by `hover-row` borders | Route the long node titles (diagnostic, uses:, hints) through the hover widget with sections. A native `<title>` looks like a browser, not VS Code. | M | M |
| Toasts (top-centre, `TOAST_MS` 1500, optional Undo button; anchored 420px) | ProofTreeView `showToast`, `TopCentre` | **Notifications** (bottom-right, `notifications-*` tokens, action buttons) for actions with Undo; **status-bar message** (`window.setStatusBarMessage`, transient left text) for "Layout: spine" echoes | Mode-change echo toasts → **delete**: the status item already changed. Undo toasts → notification-styled (`notifications-background/-border`, `button-*` for Undo). | S | H |
| Armed delete pill (trash → confirm) | ProofTreeView | VS Code deletes **immediately** and offers Undo (SCM discard asks via a modal only for irreversible ops) | One click deletes. The undo relay covers it. Delete the armed state. | S | M |
| `⋯` node menu: icon column (`MENU_ICON` drawn), shortcut column, push-pins | `menuIcons.ts`, nodeBar | **Context menu**: no icons in rows (VS Code context menus are text + keybinding; only the action widget has icons), separators between groups, check marks for toggles | Drop `MENU_ICON` entirely; text rows with keybinding labels; group with separators: Navigate / Fold / Edit / Refactor. | S | H |
| Keyboard: ↑↓ Home End → ← Enter F2 ⇧F10 on `role=tree` | ProofTreeView `nav` | Exactly the **tree/list** keyboard model (+ Space to toggle, type-to-filter) | Already right. Add **Space** to fold/unfold. Add **⌘. / Ctrl+.** for the lightbulb menu (VS Code's Quick Fix key), and F8. | S | H |
| `<` `>` mark stepping | gestures.ts | Next/previous match **F4/⇧F4** (search results), **F8** (problems) | Keep `<`/`>`; also accept ⌥↓/⌥↑? Low value; leave. | – | L |
| Double-click to edit tactic, F2 | gestures | **F2 = Rename**, Enter/double-click = edit in lists (Explorer: F2/Enter on mac renames) | Keep. Input styling: `input-background`, `input-border`, `focusBorder`, which already happens via `--ptw-edit-*`. | – | H |
| ⌥-click overloads (rail, items, nub, tabs, hyp lines, corner) | gestures.ts | VS Code's ⌥-click is used sparingly (multi-cursor, "open to side" in explorer) | Remove ⌥ gestures from chrome (rail swap, item cycle, tab remove); keep only ⌥-click on a corner = **fold recursively** (VS Code: ⌥-click a fold chevron = fold all children). | M | M |
| Hover-preview washes after dwell (trash dim, ◌ preview) | tipController `afterDwell` | None. VS Code does not preview an action's effect on hover (except the inline diff in the code action preview) | Keep at most the delete-preview; delete the others | S | L |
| `ramify.experience` preset, `ramify.hoverBar.tactic/goal` | experience.ts, package.json | Settings + **"Configure toolbar" via right-click** | `hoverBar.*` stays a setting, edited via a right-click "toggle" menu on the bar (see pins). The preset is fine (cf. `editor.accessibilitySupport`-style presets); expose it in the gear menu. | S | M |
| Colours: `--ptw-chrome-bg` = `editorWidget-background` etc. | theme.ts:184 | Already right in spirit | Swap `--ptw-chrome-lit` from list selection to `toolbar-activeBackground` for "panel open" items; add `--ptw-hover-*` = `editorHoverWidget-*` and `--ptw-menu-*` = `menu-*` | S | H |
| `CHROME_RADIUS` 3 everywhere | theme.ts:389 | `cornerRadius-small` 4 (hover), `-medium` 6 (action labels), `-large` 8 (menus/action widget) | `var(--vscode-cornerRadius-small, 4px)` for hover/tips, `-medium` 5/6 for buttons, `-large` 8 for menus | S | M |
| Node boxes (goal blue rx 6, tactic green rx 4) | `NODE_STYLES` | — (domain content) | Keep. Optionally take goal ink from `--vscode-lean4-infoView.turnstile`/`goalCount` | – | L |

## Top 15: biggest "a VS Code user instantly gets it" payoff

1. **Diagnostics as squiggles** (wavy error/warning, dotted hint for lints) under the tactic text. Delete the ribbon, dash patterns, box wash and border recolour. It is the most recognised mark in the editor, and the buffer next to the tree already shows it.
2. **One lightbulb (`codicon-light-bulb` / `-autofix`) per node, opening a Code Action menu** with Quick Fix (lint fix, write out `simp`, rename) and Refactor (inline, extract, replace with automation, sparkle "suggest") groups. Bind ⌘. / Ctrl+. This removes `⇓ ⇑ ⤵ ⤴ ✎` and D5's hidden ⌥-click in one go.
3. **Folding chevrons** at the box's top-left gutter (chevron-down shown on hover, chevron-right always when folded, `editorGutter-foldingControlForeground`) instead of a top-right `−`.
4. **The `⋯` fold placeholder** (`editor-foldPlaceholderForeground`, click to unfold) instead of `+N` corners, HopBreak slashes, ghost boxes and `§`. One look for every fold.
5. **Hover bar as a VS Code action bar**: codicons `go-to-file` · `zoom-in` · `debug-step-over` · `type-hierarchy-super` · `trash` · `ellipsis`; 22px, `toolbar-hoverBackground`, no dividers.
6. **Problems count** = `$(error) 2 $(warning) 1 $(info) 3`, exactly the status bar and the infoview tally.
7. **Message strip → marker-navigation widget**: F8/⇧F8, `editorMarkerNavigation*` tokens, arrows, and no auto-open.
8. **Bar panels → the infoview's own check menu** (`codicon-check`/`codicon-blank`, `menu-*` tokens). This kills `●/○`, `BarCheck` and the `BarActionRow` dialect.
9. **Status strip → real status bar look**: 22px, flat, no dividers, `value` only with the name in the tooltip, priority drop instead of the name→glyph ladder, no ⌥-cycle, no dots.
10. **Signature header → Sticky Scroll + breadcrumbs.** The path-to-here becomes a clickable breadcrumb, which retires `⊹`.
11. **Rail → codicon action buttons** `zoom-in` `zoom-out` `screen-full` + **separate** `collapse-all` / `expand-all`. No ⌥ glyph swap, no round buttons.
12. **Highlight occurrences**: used hyps in `editor-wordHighlightBackground`, the introducing step in `wordHighlightStrongBackground`. ⌘-click a hyp = go to its definition, which replaces the dashed connector.
13. **Frontier chips → CodeLens** text (`editorCodeLens-foreground`) over the open goal.
14. **Marks → bookmark glyph in a left gutter**, with the breakpoint-style ghost on gutter hover replacing the invisible 8px nub region.
15. **Context menu discipline**: right-click/⇧F10 opens `⋯`, text rows with keybinding labels and separators, no drawn icons; toolbar customisation via right-click checkmarks instead of per-row push-pins.

## Delete outright (no VS Code counterpart, or redundant)

- **Ribbon machinery**: `ribbonStrokeOf`, `RIBBON_W*`, `RIBBON_TAB_GAP`, `DIAG_BOX_WASH_OPACITY`, the `--ptw-diag-*-wash/-edge` tokens (if the strip takes marker-nav tokens), and the error border recolour.
- **`DiagGlyph`** (`⨯ ⚠ ◇`) and the compact `dc` count form.
- **HopBreak** slanted strokes, `TRUNK_GAP_HOP`, and the hop caption as painted text. The `⋯` chip's hover carries it.
- **Ghost dashed box + `+N` badge** (`ghostSize`, `badgeWidth`). Fold to `⋯` instead.
- **`§` SEED_MARK** and the seeded italics/comment-ink `+N`.
- **Proposal pill as a second click.** Apply from the menu after the check, and undo via ⌘Z.
- **Armed-delete confirm pill.** Delete immediately with Undo.
- **Hairline dividers** in the hover bar and `BarDivider`s in the status strip.
- **Per-item lit dots** on status items (`BarValueItem.dot`).
- **⌥-click cycling** on status items, the ⌥ glyph swap on the rail (`⊞/⊟`), and ⌥-held `×` on mark tabs.
- **Name→value→glyph three-form ladder** in `fit` (keep priority drop only).
- **Mode-change echo toasts** (`Layout: spine`, `Brief: on`).
- **All drawn chrome marks** that have a codicon: `ChevronGlyph`, `DisclosureGlyph`, `HeaderChevron`, `EyeGlyph`, `CommentGlyph` ×4, `LayoutGlyph` ×4, `LayoutExtraGlyph` ×3, `SkipIcon`, `TrashIcon`, `InlineIcon`, and all of `MENU_ICON`. Together with `BAR_GLYPH_SW`, `HOVER_ICON_SW` and `glyphPx` ink-levelling, this is around 400 lines that codicon path data replaces.
- **Hyp-origin dashed connector** (replaced by ⌘-click go-to-definition + highlight).
- **Wide-layout strip tie** hairline.
- **Quick-add nub invisible region** (`NUB_SLACK`) once the mark lives in a left gutter.
- **`∴` / `≈` text prefixes** (ghost-text colour + `codicon-sparkle` for the polished line).
- **Unicode move marks** in prose (`MOVE_MARK`): name moves by their codicon/words.

## Caveats

- Webviews may not receive `--vscode-cornerRadius-*`, so always give fallbacks.
- In the static viewer, ship the codicon path table, not the font.
- F8 and ⌘. inside a focused webview are delivered to the webview first. The infoview already handles its own keys, but verify that VS Code's keybinding forwarding does not swallow them.
- The lightbulb consolidation is the only L-sized item. It touches the verify-then-offer flow (D1/D2/D4/D5/D6), but it reuses `checkRewrite` unchanged.
