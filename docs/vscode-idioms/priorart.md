# Ramify: prior art, and what to take from it

Scope: what peers do for node boxes, connectors, case tags, hypothesis lists, prose, diagnostics, folding and focus, and what Ramify could take or drop. Each claim says where it came from:
- **[src]** I read the source: Paperproof `app/src/index.css` and its components; lean4-infoview `src/infoview/{goals,info,messages}.tsx` and `index.css`; vscode-lean4 `package.json` colours; code-server's VS Code `workbench.css`; the npm tarballs of `@xyflow/react` 12.12, `@vscode-elements/elements` 2.5.1 and `markmap-view` 0.18; Alectryon's `alectryon.css`, fetched from GitHub raw.
- **[k]** From memory. coq-lsp, vscoq, Prooftree, Isabelle, Obsidian, Mermaid, Graphviz and Git Graph were not fetched.

The current look, from `01-default.png` and `theme.ts`: goal boxes are blue-tinted with a blue 1.5px stroke and 6px radius. Tactic boxes are green-tinted with a green stroke and 4px radius. Grey elbow connectors, coloured by the kind of node at each end. A `−` sits in each goal's top-right corner. Case tags such as `refine_1` are 10px grey text above the box. Comments are italic grey monospace strips. Diagnostics are a 3px left ribbon clipped inside the rounded box (solid for errors, dashed for warnings, thin for lints) plus a faint wash. Used hypotheses get a `▸` gutter mark and unused ones are dimmed. The cursor node gets a 2px amber stroke.

---

## 1. Paperproof [src]: the closest relative

The layout is Gentzen upside-down. Hypotheses sit at the top and flow down. Goals sit at the bottom, and tactics stack between them. Boxes are **scopes**, not nodes.

What to take:
1. **Shape and fill say the kind, and tactics have no fill.** `.tactic` has a transparent background and a dashed outline (an SVG `stroke-dasharray 4,6`, `#c7ccce`, 3px wide), with grey text `#72787c`. Goals are solid pink (`rgb(249,195,195)` with a 2px border) and hypotheses solid green (`#a4dabc`). The tactic reads as an annotation between two states rather than as a third kind of state.
2. **The tactic at the cursor is bold, not outlined.** `.tactic.-position-matches { font-weight: bold; color: #363d59 }`. There is no ring, no accent hue and no change of stroke. The emphasis lives in the text.
3. **Scopes are tinted by nesting depth.** `.box { --color: color-mix(in srgb, rgba(132,147,171), white calc(90% - var(--level)*7%)) }`, with levels 0 to 8. A `have … := by` or a case gets a slightly darker container, and a container titled `HYPOTHESES` uses 10px uppercase grey. Depth is read from the background with no extra lines.
4. **Dependency arrows only on hover.** A `.perfect-arrow` (2px, `#a0ceb0`) runs from a hypothesis to the tactic that uses it. It has `display: none` until `.tactic:hover`. Hypothesis names inside the tactic text are tinted (`.fancy-substring-hypothesis { color: #d0005b }`), and lemma names are underlined and clickable (`text-underline-offset: 2px`).
5. **Defaults that leave things out.** `isHiddenGoalNames` defaults to **true**, so case names are not drawn. `areHypsHighlighted` defaults to false. The settings are few: compact mode, compact tactics, single-tactic mode and font size.
6. **Proof hypotheses look different from data hypotheses.** `.hypothesis.data` (for example `a : ℝ`) is yellow `#f9e9b5` when "green hypotheses" is off. Proof terms are green. The split is Prop against data, with no grouping UI.

What Paperproof does that Ramify should not copy: hard-coded light colours (it barely themes and has no dark recipe), 🎉 emoji on a closing tactic, and a hand-drawn dashed background SVG.

## 2. Lean 4 infoview [src]: what the reader sees one pane over

Ramify lives inside this panel, so **parity with it is the cheapest form of "regular"**.

1. **The goal is not a box.** `.font-code tl pre-wrap bl bw1 pl1 b--transparent mb3`: monospace text with a 2px **left** border that is transparent by default. It turns `--vscode-diffEditor-insertedTextBackground` when the goal is new (`b--inserted`) and the removed colour when it is gone. A goal box only gains colour when it has changed.
2. **Theme colours registered by the extension**, so every user's theme can set them:
   - `lean4.infoView.hypothesisName` (`#cc7a00` light, `#ffcc00` dark), used **bold** (`<strong class="goal-hyp">`)
   - `lean4.infoView.turnstile` (`#367cb6` / `#569cd6`) for `⊢`
   - `lean4.infoView.caseLabel` (`#1f7a1f` / `#a1df90`), drawn as bold `case` followed by the tag in a `<details open>` summary
   - `lean4.infoView.goalCount`

   Inside the webview these are `var(--vscode-lean4-infoView\.hypothesisName)` and so on. Ramify uses none of them today: `grep lean4-infoView web/src` returns nothing.
3. **The tactic diff marks only the NAME.** `isInserted` puts `.inserted-text { background: var(--vscode-diffEditor-insertedTextBackground); border-radius: 2pt }` on the hypothesis name, and `.removed-text` on removed ones. Ramify mixes its own `--ptw-diff-ins/del` from its green hue and the danger red.
4. **Inaccessible names** (`x✝`) are `opacity: .7; font-style: italic`.
5. **Goals other than the first are de-emphasised.** `emphasizeFirstGoal` adds `o-70 font-size-code-smaller` (70% opacity, 0.8× size) to every goal but the first.
6. **The toolbar is codicons.** Actions are `link pointer mh2 dim codicon codicon-{pin,pinned,go-to-file,debug-pause,refresh,settings-gear}`, dim until hovered. The gear's filter menu uses `codicon-check` / `codicon-blank` rows. `main.tsx` imports `@vscode/codicons/dist/codicon.css`, **so the codicon font is already loaded wherever the widget renders.** Ramify hand-draws `DiagGlyph`, chevrons, a trash can and a comment bubble that copy codicons.

   The All Messages summary uses `codicon-error`, `codicon-warning` and `codicon-info` with counts, which is the shape of Ramify's diagnostics count.

## 3. VS Code itself [src: workbench.css; vscode-elements tree styles]

1. **Tree rows and indent guides.**
   - Rows are 22px high. The twistie is a 16px codicon chevron to the left of the label, and `.collapsed:before { transform: rotate(-90deg) }` turns it.
   - Indent guides are 1px `border-left`. They are hidden (`opacity: 0`, 0.1s transition) until the tree is hovered, unless the user sets "always".
   - **The active guide is highlighted.** The guide on the focused element's ancestry is drawn in `tree.indentGuidesStroke` (`#585858`). The rest are `tree.inactiveIndentGuidesStroke` (`rgba(88,88,88,.4)`). This is how VS Code says "where am I in the tree" with no box styling at all.
2. **Folding in the editor gutter.** `.codicon-folding-expanded` sits at `opacity: 0; transition: opacity .5s` and turns `opacity: 1` on gutter hover. **A collapsed region's chevron is always shown.** The collapsed text gets an inline `⋯` (`content: "\22ef"`) in `editor.foldPlaceholderForeground`, plus `editor.foldBackground` on the header line. The expand control is quiet while open and loud while shut.
3. **Problems in trees are a colour plus an icon, never a pattern.**
   - Labels with problems take `list.errorForeground` or `list.warningForeground`, and a right-aligned decoration letter or count is added.
   - The Testing view puts a **status codicon to the LEFT of the label**: `.codicon-testing-passed-icon { color: var(--vscode-testing-iconPassed) }`, plus failed, errored and queued.
   - In the editor, severity is **squiggle colour**: `editorError.foreground`, `editorWarning.foreground`, `editorInfo.foreground`. **Hints are three grey dots** under the first characters (`editorHint.foreground`). Lints are what VS Code calls hints.
   - Nothing in VS Code encodes severity as solid against dashed.
4. **Focus and selection.**
   - `list.focusOutline` (`focusBorder`) is a 1px **inset** outline, drawn only for keyboard focus.
   - Selection is a full-row fill, `list.activeSelectionBackground` or `list.inactiveSelectionBackground`.
   - A notebook's focused cell gets a thin coloured **left** focus-indicator bar (`notebook.focusedCellBorder`) and a top and bottom hairline. The left edge belongs to *focus*, not to errors.
   - The status of a run cell is a ✓/✗ codicon in a 22px status bar under the cell (`.cell-statusbar-container { height: 22px; font-size: 12px }`).
5. **Secondary text is dimmed.** `.label-description { opacity: .7; margin-left: .5em; font-size: .9em }`, and deprecated items get `line-through; opacity: .66`. Two opacity steps and a size step: Ramify's `DIM_OPACITY` is the same idea.
6. **Count badges.** `.monaco-count-badge { padding: 3px 5px; border-radius: 11px; font-size: 11px; min-width: 18px }` in `badge.background` and `badge.foreground`. This is the canonical "N hidden" chip.
7. **Peek view.** A header with a coloured top border (`peekView.border`; the error peek takes the marker's severity colour) over a body tinted `peekViewEditor.background`. "This box is about an error" is said by one edge in the severity colour, applied to the *whole frame*.
8. **SCM graph** [k, constants not pinned in the minified bundle]: 1px lanes, 4px-radius commit circles with a 2px stroke against `sideBar.background`, lane colours `scmGraph.foreground1..5`, and the current ref drawn larger or hollow (CSS `stroke-width: 3px` on the expanded row's last path). This is how VS Code draws a graph of nodes without boxes.

## 4. Alectryon and jsCoq [src: alectryon.css; jsCoq from memory]

1. **The hypotheses and the goal are split by a rule, Gentzen-style.** `.goal-separator hr { border-top: thin solid #555753 }`. The **goal name sits ON the rule**, right-aligned at `font-size: .75em`, with the line taking a fixed 1em height. The case label costs no row.
2. **A dashed rule means hypotheses are hidden.** "Dashes indicate that the hypotheses are hidden" (`border-top-style: dashed` while the extra-goal toggle is off). The reader is told the context is filtered, in the line already present.
3. **Extra goals are previewed and clipped.** `max-height: 5.2em; overflow-y: auto` shows 3 to 4 lines, and the full goal opens on toggle.
4. **Neutral, theme-quiet boxes.** A goal is `#d3d7cf` around `#eeeeec` cells, with `border-radius: .15em` and `padding: .5em`. There is no hue per kind; hypotheses are flex chips with the name in `font-weight: 600`.
5. **Messages carry an icon in the corner.** A 14px speech-bubble SVG floats right in each message, instead of being encoded in the frame.

## 5. coq-lsp, vscoq, Isabelle/jEdit, Prooftree [k]

- **coq-lsp / vscoq 2.** Goals panel: `Goals (n)` as a collapsible `<details>`, hypotheses as `name : type` with names bold, then a horizontal rule, then the goal. vscoq 2 adds diff highlighting with green and red backgrounds on changed subterms. Messages are listed with a severity codicon.

  Take: the **horizontal rule instead of `⊢`** is optional for Lean users, who expect `⊢`. Keep `⊢` in the turnstile colour.
- **Isabelle/jEdit.** A "theory status" overview bar in the right gutter colours each command by state: processed, running (pink), unprocessed (light purple), error (red), warning (orange). Errors are a coloured background *and* an icon in the left gutter.

  Take: state as a **gutter icon**, and the overview strip idea (a minimap of the tree's errors and open goals) if the tree gets long.
- **Prooftree (Proof General's tree for Coq).**
  - Nodes are the proof commands as text, with no boxes. The sequent (goal) appears on click, in a separate window.
  - Branch lines are coloured by state: the current branch is highlighted, proved branches are green, `admit`/cheated branches have their own colour, and open ones are the default.
  - Branching is drawn as plain lines, and the tactic text is the label of the node at the fork.

  Take: **colour the connector by proof state** (closed or open) instead of by endpoint type. Also: tactics need no box.

## 6. Graph and mind-map tools [src for xyflow and markmap; k for the rest]

- **React Flow (xyflow 12) defaults.**
  - Node: `--xy-node-border-default: 1px solid #1a192b`, `--xy-node-border-radius-default: 3px`, background `#fff`.
  - Edges: `1px #b1b1b7`.
  - Selected: `box-shadow 0 0 0 .5px`, an extra half-pixel ring rather than a new colour.
  - Hover: a `0 1px 4px 1px rgba(0,0,0,.08)` shadow.

  One node style and one neutral edge. Kind is the caller's business.
- **Markmap.**
  - **No boxes at all.** The text sits on an **underline in the branch's colour**, and the link curves into the underline's start.
  - The fold control is a **circle of radius 6 at the end of the underline**, stroke 1.5px. It is filled with the branch colour when collapsed and with `--markmap-circle-open-bg` when open.
  - A collapsed node therefore shows one solid dot. That is the most economical fold marker among these peers.
- **Mermaid** (flowchart defaults): one node style (`#ECECFF` fill, `#9370DB` 1px stroke), `#333` 1px edges with arrowheads. **Kind is encoded by shape** (rect, rounded, stadium, diamond), not by fill. **Graphviz**: black 1px, shape per kind (box, ellipse, diamond).
- **Git Graph (mhutchie)** and VS Code's SCM graph: lanes coloured per branch, commits as dots of radius about 4, HEAD hollow, and **uncommitted work as a dashed grey dot and line**. Dashed means not yet done, which fits a `sorry` or an open goal.
- **Obsidian Canvas**: neutral cards (1–2px border, theme-coloured, radius about 8). Colour is opt-in from six user presets. A group's **label sits above the group's top-left, outside the border**, which matches Ramify's case label. Edge labels sit mid-edge on a background chip.
- **Gentzen trees and Fitch diagrams.**
  - In Gentzen notation, the **rule name** (the tactic, in Lean terms) is a small label to the **right of the inference bar**, not a box.
  - Fitch draws scope as **a vertical bar** with a short horizontal under the assumptions.

  Both carry structure with lines, and text carries content.

---

## What Ramify does that no peer does (candidates to stop)

1. **Diagnostics as a clipped left ribbon with severity encoded as solid, dashed or thin.**
   - No peer encodes severity by dash pattern. Everyone uses an icon, a colour or a squiggle.
   - Clipping a stroke inside a rounded rect makes the reported "lumps": the ribbon's ends meet the corner arcs.
   - The left edge is also VS Code's *focus* indicator (notebook cells) and the infoview's *diff* indicator (`bl bw1 b--inserted`), so the ribbon reuses an edge that already means two other things.
2. **Two tinted box kinds plus kind-coloured edges** (`--ptw-link-goal`, `--ptw-link-tactic`). Mermaid, Graphviz, xyflow and Obsidian use one neutral node style. Alectryon, Prooftree and the infoview do not box tactics at all. Paperproof, the only peer that colours by kind, leaves tactics **unfilled and dashed**. Nobody colours an edge by the kind of node at its ends.
3. **The `▸` used-hypothesis gutter mark.**
   - In every VS Code tree, `▸` / `›` means "collapsed, click to expand", so the mark reads as a twistie.
   - Dimming the unused lines already says "used"; the infoview and Paperproof rely on emphasis or hover arrows.
4. **Italic monospace prose for comments.** Alectryon renders prose as prose, Obsidian and Markmap use the UI font, and the editor uses the *theme's* comment colour and style.
5. **An amber accent for the cursor.** VS Code uses `focusBorder` (keyboard), selection backgrounds (pointer) or the active indent guide (position). Paperproof uses bold text.
6. **Fold controls drawn on every open goal.** VS Code hides `codicon-folding-expanded` until hover and always shows the collapsed one. Markmap shows a hollow dot while open and a filled one while shut.
7. **Hand-drawn copies of codicons**: the diagnostic glyphs, chevrons, trash and comment bubble. The real font is loaded in the infoview.
8. **Novel marks with no peer**: the HopBreak axis-break, mark tabs straddling the box corner, the `§` / `∴` / `≈` prefixes, and the dashed ghost boxes. They are not wrong, but each is a private glyph the reader has to learn. Keep the count down.

What *is* well precedented and worth keeping:
- `+N` on a folded node (count badges, the notebook's "N cells hidden").
- The 1px elbow connectors (indent guides).
- The status strip's `Name: value` form (the status bar).
- The bar's `✕2 · ⚠1 · ◇3` count (the infoview's All Messages summary).
- The `⋯` overflow menu.
- In-place double-click editing (rename in VS Code trees).

---

## Top 12 to take, ranked

Effort is one of S (hours), M (a day or two) or L (a design change).

1. **Show diagnostics as a squiggle under the tactic text plus a codicon, and delete the ribbon (S–M).**
   - Draw a wavy SVG path under the offending label's extent. Use `--vscode-editorError-foreground` for errors and `editorWarning.foreground` for warnings. For lints, draw VS Code's **hint idiom**: three dots under the first characters in `editorHint.foreground`.
   - Put the severity codicon (`codicon-error`, `codicon-warning`, `codicon-lightbulb` or `codicon-info`) in the box's top-right status slot, Testing-tree style.
   - Keep the faint wash if you want it.
   - Result: no pattern encoding, no clipped lumps, and the same mark the reader sees in the buffer.
2. **Use the infoview's own theme colours (S).**
   - Hypothesis names bold in `var(--vscode-lean4-infoView\.hypothesisName)`.
   - `⊢` in `…turnstile`.
   - Case tags in `…caseLabel`, with a dim `case ` prefix as the infoview prints it.
   - Inaccessible `x✝` names italic at 0.7.
   - Fall back to today's tokens where the variables are missing, as in the static viewer.
3. **Take the diff colours from `--vscode-diffEditor-insertedTextBackground` / `removedTextBackground` (S)**, and paint the **name only** for a new or removed hypothesis, as the infoview does. The tree's diff then matches the goal list beside it.
4. **Drop the `▸` mark (S).** Used lines are full ink and unused lines dimmed, as now. A line *introduced by this step* gets the inserted-name wash from #3. That frees the gutter and removes a fake twistie.
5. **Unbox the tactics, or reduce them to a hairline with no fill (M).**
   - The goal is the only card. The tactic is code text on the trunk: Paperproof's transparent dashed node, Alectryon's plain source, Gentzen's rule label.
   - Keep a 1px `--ptw-link`-coloured outline only on hover and focus, so there is still a hit target and a place for the bar.
   - This removes the green fill, the green stroke and the second radius.
6. **Make goal cards neutral (S).**
   - Fill `--vscode-editorWidget-background` (the hover and peek surface).
   - Border 1px `--vscode-editorWidget-border`, falling back to `widget.border` or `panel.border`.
   - Radius 3 to 4 (xyflow 3, Alectryon about 2).
   - No blue hue. Colour is then free for state: error, open, cursor.
7. **Show cursor and selection the way VS Code lists do (S).**
   - The cursor node gets the `list.inactiveSelectionBackground` (or `editor.rangeHighlightBackground`) fill.
   - The tactic at the cursor is **bold**, as in Paperproof's `-position-matches`.
   - Keyboard focus is a 1px inset `focusBorder` outline, which is already the rule for chrome.
   - Retire the 2px amber stroke.
8. **Highlight the guide path to the cursor (S–M).**
   - All connectors 1px in `tree.inactiveIndentGuidesStroke`.
   - The ancestry from the root to the cursor (or the focused node) in `tree.indentGuidesStroke`, like VS Code's active indent guide.
   - Drop `--ptw-link-goal` / `--ptw-link-tactic`.
   - This answers "where am I" without a box ring.
9. **Fold controls should behave like the editor gutter (S).**
   - On an open goal, `codicon-chevron-down` at `opacity: 0`, faded in over 0.5s when the box is hovered.
   - On a collapsed goal, `codicon-chevron-right` always visible, plus the `+N` count as a `monaco-count-badge`-shaped chip in `badge.background` at reduced weight.
   - Or Markmap's dot: hollow while open, filled while shut.
   - Place it at the left of the top line, where twisties live, if the owner accepts moving it from top-right.
10. **Say when hypotheses are filtered, and put the case label on the rule (S–M).**
    - When the `used` breadth hides context lines, draw the hyp/goal separator **dashed**, Alectryon style, with a dim `+k` on it. The reader then knows the list is partial.
    - Optionally, place the case tag on the box's top edge, right-aligned (fieldset legend or Alectryon goal-name), and reclaim the 18px `CASE_LINE_H + CASE_GAP` row.
11. **Render comment prose in the UI face (S).** Use `CHROME_FONT`, upright, in the theme's comment token colour, which the companion already supplies. Code inside backticks stays in the code font (`CodeText`). Prose then reads as prose, and the theme decides italics.
12. **Use the codicon font the infoview already loads, and colour links by proof state (M).**
    - Replace `DiagGlyph`, `HeaderChevron`, the trash, the comment bubble and the chevrons with `<span class="codicon codicon-…">`. That is one icon vocabulary with VS Code's own ink. The static viewer would need to bundle the woff, about 80 KB.
    - For proof state, take Prooftree and Git Graph: a branch that still holds an open goal or a `sorry` gets a **dashed** connector, and a closed branch a solid one. That replaces kind colouring with one meaningful state signal.

Also worth considering:
- Infoview `emphasizeFirstGoal`: siblings of the main goal at 0.7 opacity.
- Paperproof's hover-only hypothesis→tactic arrows as the hyp-origin connector's default.
- An Isabelle-style overview strip of error and open-goal positions on long trees.
