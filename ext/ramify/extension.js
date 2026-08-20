// Ramify Companion — the editor-side half of widget gestures the infoview
// API can't express (its EditorApi has no executeCommand).
//
// Primary bridge: the widget calls the `ProofTree.popoutEdit` RPC, the Lean
// server writes a one-shot request file under ~/.proof-tree-companion/, and
// the watcher below opens a LENS GROUP — a slim editor group split off
// directly below the Lean infoview's own group, showing the real buffer with
// the tactic's tight range selected and scrolled to the top. Same window,
// same document, same Lean server: vim/LSP/keybindings all apply, edits sync
// live with zero re-elaboration, and (unlike the floating-window approach
// this replaced) same-window group focus is reliable — no vscode#198797
// keyboard-focus glitch, no osascript geometry, no Accessibility permission.
// (Webview-side bridges were tried and rejected: vscode-lean4's showDocument
// drops non-file URIs, and a synthetic anchor click NAVIGATES the infoview
// blank — webviews only intercept trusted clicks.)
//
// Secondary route, same action: a `vscode://aidan.ramify/edit`
// deep link (usable from the OS / other tooling, not from the infoview).
const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Everything the relay does is invisible by design (a file written by a Lean
// server, read by a watcher in another process), so every step logs here.
// Open it from Output → "Ramify" when a widget gesture appears
// to do nothing: the log says whether the request arrived at all, and if it
// was skipped, why.
let log = null;
function say(msg) {
  if (log) log.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

const REQUEST_DIR = path.join(os.homedir(), ".proof-tree-companion");
const REQUEST_FILE = "popout-request.json";
const CHROME_BACKUP = path.join(REQUEST_DIR, "chrome-backup.json");
const THEME_FILE = path.join(REQUEST_DIR, "theme-colors.json");

// ---- theme token colours -------------------------------------------------
// The tree colours tactics from the Lean server's semantic tokens, but it had
// no way to learn what COLOUR the user's theme paints those with: a webview is
// given `--vscode-*` variables for the workbench colour REGISTRY only, and
// TextMate/semantic token colours are not in it. Checked rather than assumed —
// the whole extension API surface (`vscode.d.ts`) has zero token-colour
// members, and `ColorTheme` exposes nothing but `kind`. So the tree shipped a
// fixed Light+/Dark+ palette and drifted from the buffer on any other theme.
//
// An extension CAN read the theme, though: the active theme is a contribution
// of some installed extension, and its JSON is on disk. We resolve it here and
// leave the answer where the Lean server can hand it to the widget (the relay
// only runs widget→companion, so this is the return path).
//
// Fidelity is close, not exact, and the reason is worth stating: VS Code
// resolves a colour against the FULL scope stack the TextMate grammar produced
// for that character (`source.lean meta.tactic keyword.control`), and all we
// have is one LSP token type. So we ask for a representative scope per type and
// take the theme's best match for it.
// VS Code's OWN default map from semantic token type to TextMate scope — the
// same table it uses when a theme has no `semanticTokenColors` rule for a type.
// Using the documented mapping rather than a hand-picked scope is what makes
// this match the buffer, because with `semanticHighlighting` on the buffer
// resolves Lean's tokens through exactly this table.
//
// It replaced a guessed list, and the guesses were wrong in a way only
// measurement showed: for `variable` it asked for `variable.other`, which
// Catppuccin does not define, and the sub-scope fallback then picked the
// SHORTEST `variable.other.*` rule in the file — `variable.other.env`, a rule
// about shell environment variables — painting every Lean fvar GraphQL-blue
// instead of the theme's actual `variable.other.readwrite`. The earlier
// preference for `keyword.control` over `keyword` was likewise asserted rather
// than measured; the documented answer is plain `keyword`.
const TOKEN_SCOPES = {
  keyword: ["keyword"],
  function: ["entity.name.function", "support.function"],
  variable: ["variable.other.readwrite", "variable"],
  property: ["variable.other.property", "variable"],
  number: ["constant.numeric"],
  string: ["string"],
  comment: ["comment"],
  type: ["entity.name.type", "support.type", "storage.type"],
  // No `operator` entry on purpose: Lean's server emits no operator tokens
  // (`collectSyntaxBasedSemanticTokens` only tags atoms starting with an
  // identifier character) and the lean4 TextMate grammar has no operator rules
  // either, so `=`/`*`/`:=` are unscoped in the BUFFER too and fall to the
  // editor foreground — which is already what the tree paints them
  // (`--ptw-node-text` is `--vscode-editor-foreground`).
};

/** JSON with comments and trailing commas — what theme files actually are.
Hand-rolled because this extension deliberately has no build step and no
dependencies; the string-awareness is the whole point, or a `//` inside a colour
string would truncate the file. */
function parseJsonc(text) {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** Path to the active theme's JSON, found through the extension contributing
it. `workbench.colorTheme` holds the theme's LABEL, which is what the
contribution is keyed by (older themes key by `id`). */
function activeThemeFile() {
  const label = vscode.workspace
    .getConfiguration("workbench")
    .get("colorTheme");
  for (const ext of vscode.extensions.all) {
    const themes = ext.packageJSON?.contributes?.themes;
    if (!Array.isArray(themes)) continue;
    for (const t of themes)
      if (t && (t.label === label || t.id === label))
        return path.join(ext.extensionPath, t.path);
  }
  return null;
}

/** A theme plus everything it `include`s, flattened. The INCLUDED theme is the
base (Dark+ includes dark_vs), so its rules come first and the including file's
own rules override them. */
function loadTheme(file, depth = 0) {
  const empty = { tokenColors: [], semanticTokenColors: {} };
  if (!file || depth > 8) return empty;
  let json;
  try {
    json = parseJsonc(fs.readFileSync(file, "utf8"));
  } catch (e) {
    say(`theme: cannot read ${file}: ${e}`);
    return empty;
  }
  const base =
    typeof json.include === "string"
      ? loadTheme(path.join(path.dirname(file), json.include), depth + 1)
      : empty;
  return {
    tokenColors: base.tokenColors.concat(
      Array.isArray(json.tokenColors) ? json.tokenColors : [],
    ),
    semanticTokenColors: Object.assign(
      {},
      base.semanticTokenColors,
      json.semanticTokenColors || {},
    ),
  };
}

/** The theme's foreground for a TextMate scope. TextMate resolution: a rule's
selector matches a scope it PREFIXES (`keyword` matches `keyword.control`), the
longer selector wins, and ties go to the later rule — hence `>=` scanning
forward. Descendant selectors (`source.cpp keyword.operator`) need the full
scope stack to evaluate and are skipped rather than guessed at. */
function scopeColor(rules, want) {
  let best = null;
  let bestLen = -1;
  // Last resort: a rule MORE specific than what we asked for
  // (`variable.other.readwrite` when we wanted `variable.other`). Not TextMate
  // semantics — such a rule would not apply to a bare `variable.other` token —
  // but it is the theme's own opinion about that family, and the alternative is
  // falling back to a hard-coded hue from a different theme entirely. Measured:
  // Catppuccin scopes variables only this way, so without it `variable` and
  // `property` came back empty (6 of 8 types resolved, now 8).
  let sub = null;
  let subLen = Infinity;
  for (const r of rules) {
    const fg = r?.settings?.foreground;
    if (!fg) continue;
    let scopes = r.scope;
    if (typeof scopes === "string") scopes = scopes.split(",");
    if (!Array.isArray(scopes)) continue;
    for (const s of scopes) {
      const e = String(s).trim();
      if (!e || e.includes(" ")) continue;
      if (want === e || want.startsWith(e + ".")) {
        if (e.length >= bestLen) {
          bestLen = e.length;
          best = fg;
        }
      } else if (e.startsWith(want + ".") && e.length < subLen) {
        // Closest to the family root wins, so `variable.other.readwrite` beats
        // `variable.other.constant.property.something`.
        subLen = e.length;
        sub = fg;
      }
    }
  }
  return best ?? sub;
}

/** The user's own overrides, which sit ON TOP of the theme. Both settings may
be flat or keyed by theme name (`{"[Dark+]": {…}}`), so the active theme's
section is merged after the flat one. Appended LAST, so they win ties. */
function customizations(themeName) {
  const pick = (cfg) => {
    if (!cfg || typeof cfg !== "object") return [{}];
    const scoped = cfg[`[${themeName}]`];
    return scoped && typeof scoped === "object" ? [cfg, scoped] : [cfg];
  };
  const ed = vscode.workspace.getConfiguration("editor");
  const tm = [];
  for (const c of pick(ed.get("tokenColorCustomizations")))
    if (Array.isArray(c.textMateRules)) tm.push(...c.textMateRules);
  const sem = {};
  for (const c of pick(ed.get("semanticTokenColorCustomizations")))
    if (c.rules && typeof c.rules === "object") Object.assign(sem, c.rules);
  return { tokenColors: tm, semanticTokenColors: sem };
}

/** LSP semantic token type → colour, for the types the tree actually draws. */
function resolveTokenColors() {
  const themeName = vscode.workspace
    .getConfiguration("workbench")
    .get("colorTheme");
  const base = loadTheme(activeThemeFile());
  const custom = customizations(themeName);
  const theme = {
    tokenColors: base.tokenColors.concat(custom.tokenColors),
    semanticTokenColors: Object.assign(
      {},
      base.semanticTokenColors,
      custom.semanticTokenColors,
    ),
  };
  const out = {};
  for (const type of Object.keys(TOKEN_SCOPES)) {
    // A theme's own semantic-token colour for this exact type is the most
    // direct answer there is, so it wins over any scope guess.
    const sem = theme.semanticTokenColors?.[type];
    const semFg = typeof sem === "string" ? sem : sem?.foreground;
    if (typeof semFg === "string" && semFg.startsWith("#")) {
      out[type] = semFg;
      continue;
    }
    for (const want of TOKEN_SCOPES[type]) {
      const c = scopeColor(theme.tokenColors, want);
      if (c) {
        out[type] = c;
        break;
      }
    }
  }
  return out;
}

/** Publish the palette where the Lean server can read it back to the widget. */
function publishThemeColors() {
  try {
    fs.mkdirSync(REQUEST_DIR, { recursive: true });
    const colors = resolveTokenColors();
    const name = vscode.workspace
      .getConfiguration("workbench")
      .get("colorTheme");
    // Bracket-pair colourisation is a SETTING, not a colour, so it is not in
    // the `--vscode-*` set the webview gets — the six colours it cycles are.
    // Default is on, which is why the tree looked wrong without it.
    const brackets =
      vscode.workspace
        .getConfiguration("editor")
        .get("bracketPairColorization.enabled") !== false;
    // Not a colour either, and it rides here for the same reason: a webview
    // cannot read a VS Code setting, so this file is the only channel the
    // widget has for one. It is a standing look-of-the-boxes preference
    // rather than a reading gesture, which is why it is a setting and not a
    // button on the tree's rail.
    const outline =
      vscode.workspace.getConfiguration("ramify").get("outlineOnly") ===
      true;
    // How close to the bottom edge the tree's frame runs. A CHECKBOX rather
    // than a number: the two answers worth having are "leave a strip to scroll
    // the column from" and "give the tree that room back", and the fractions
    // either one means belong with the renderer, which is what knows the frame
    // is measured from its own offset rather than from the top of the page.
    const tallFrame =
      vscode.workspace.getConfiguration("ramify").get("tallFrame") === true;
    // The connectors' target-type marks' hue tint: a standing look
    // preference, so a setting rather than a rail button, riding the same
    // channel for the same webview-can't-read-settings reason.
    const linkTint =
      vscode.workspace.getConfiguration("ramify").get("linkTint") === true;
    // Whether the marks are drawn at all. `!== false` rather than `=== true`:
    // this one DEFAULTS ON (shape is the baseline that survives without
    // colour), so it is an opt-out, and an unset value must read as on.
    const linkMarks =
      vscode.workspace.getConfiguration("ramify").get("linkMarks") !== false;
    // The typing hold's quiet period in ms — the one NUMBER on this wire.
    // Written through raw; the widget owns the default and the clamp, so a
    // bad value here degrades to the default there rather than in two places.
    const typingHoldMs = vscode.workspace
      .getConfiguration("ramify")
      .get("typingHoldMs");
    // The counterfactual preview. `!== false`: defaults ON, so an unset value
    // must read as on (the linkMarks pattern).
    const counterfactual =
      vscode.workspace.getConfiguration("ramify").get("counterfactual") !==
      false;
    // How the hover answer over a goal's context lines is drawn: a background
    // wash in its own hue (default), or a dashed rule paired with the solid
    // one the tactic diff takes in that mode — shape instead of colour, for
    // readers the two hues do not separate for. Written through RAW, like
    // typingHoldMs: the widget owns the default and the validation, so an
    // unknown string degrades in exactly one place.
    const hypMarkStyle = vscode.workspace
      .getConfiguration("ramify")
      .get("hypMarkStyle");
    // The tree's in-place tactic editor has the buffer's own unicode input
    // (`\dvd` → `∣`), driven by the same upstream package vscode-lean4 uses.
    // The TABLE is bundled with the renderer, so this is only about the user's
    // customisations — an absent companion still gets the default input mode.
    // Rides here for the third time for the same reason: a webview cannot read
    // a VS Code setting.
    const inputCfg = vscode.workspace.getConfiguration("lean4.input");
    const custom = inputCfg.get("customTranslations") || {};
    const input = {
      enabled: inputCfg.get("enabled") !== false,
      leader: inputCfg.get("leader") || "\\",
      eager: inputCfg.get("eagerReplacementEnabled") !== false,
      // An array, like `colors` below and for the same decoding reason.
      custom: Object.keys(custom).map((abbreviation) => ({
        abbreviation,
        symbol: String(custom[abbreviation]),
      })),
    };
    // An ARRAY of {type, color}, not an object keyed by type: the Lean side
    // decodes this straight into `Array ThemeTokenColor` with a derived
    // FromJson, where an object would need map-API surgery.
    fs.writeFileSync(
      THEME_FILE,
      JSON.stringify(
        {
          theme: name,
          brackets,
          outline,
          tallFrame,
          linkTint,
          linkMarks,
          typingHoldMs,
          counterfactual,
          hypMarkStyle,
          input,
          colors: Object.keys(colors).map((type) => ({
            type,
            color: colors[type],
          })),
        },
        null,
        1,
      ),
    );
    // Log the palette, not just the count: this is the only place the
    // resolution is visible, and "the tree's blue vs the buffer's pink" is
    // diagnosed by reading these against the theme.
    say(
      `theme "${name}" (brackets ${brackets ? "on" : "off"}, ` +
        `outline ${outline ? "on" : "off"}, ` +
        `tall frame ${tallFrame ? "on" : "off"}, ` +
        `link tint ${linkTint ? "on" : "off"}, ` +
        `link marks ${linkMarks ? "on" : "off"}, ` +
        `typing hold ${typingHoldMs}ms, ` +
        `counterfactual ${counterfactual ? "on" : "off"}, ` +
        `hyp mark ${hypMarkStyle || "highlight"}): ` +
        Object.keys(colors)
          .map((t) => `${t}=${colors[t]}`)
          .join(" "),
    );
  } catch (e) {
    say(`theme colours failed: ${e}`);
  }
}

// ---- editor-chrome strip -------------------------------------------------
// There is NO per-window and NO per-group settings API, so anything beyond
// per-editor options can only be stripped GLOBALLY while a lens is open and
// restored when it closes. The goal is maximum vertical room in the infoview
// column: tab rows and breadcrumbs go entirely, plus the minimap.
//
// WHAT IS PER-EDITOR AND WHAT IS NOT — re-checked against the RUNNING VS Code
// (1.132), both in `vscode.d.ts` and in the extension host's own options
// object, because this question keeps coming back. `TextEditorOptions` is
// EXACTLY tabSize / indentSize / insertSpaces / cursorStyle / lineNumbers, and
// the ext-host `ExtHostTextEditorOptions` value exposes those five accessors
// and nothing else. So of everything that makes up an editor's left margin:
//   - line numbers      PER-EDITOR  → off in the lens only (and our lens tag)
//   - glyph margin      GLOBAL only → NOT stripped any more, see below
//   - folding controls  GLOBAL only → never stripped
// and of the rest of the chrome: tabs, breadcrumbs, minimap and sticky scroll
// are all global-only too.
//
// The originals are snapshotted to disk (PID-stamped) so a crash mid-lens
// can't permanently eat the user's settings — restored on next activation if
// the owning extension host is dead.
const STATIC_STRIP = {
  "workbench.editor.showTabs": "none",
  "breadcrumbs.enabled": false,
  // NOT `editor.glyphMargin: false`. It WAS stripped, and it is the one strip
  // the user could see from outside the lens: the glyph margin is the gutter's
  // breakpoint lane, so opening a lens narrowed the left margin of every
  // editor in every window and the text jumped sideways — reported as the
  // gutter disappearing being jarring. It is `editor.fontSize`'s case exactly
  // (a global setting bought for a slim pane's benefit), and it goes the same
  // way. There is no per-editor route to salvage it: the five-key list above
  // has no glyph margin in it, and a per-LANGUAGE scope (`"[lean4]": …`) would
  // hit the main buffer too, which is the very editor being protected. The
  // lens keeps the lane; that costs it ~20px of WIDTH, which is what
  // `lensWordWrap` is for, and no height at all.
  //
  // NOT `editor.folding: false` either. It was stripped once for the last
  // scrap of gutter, then kept because the lens folded itself down to the
  // cursor's path — and that fold is now gone too (it collapsed and
  // re-expanded the whole file every time a lens opened, which is half of the
  // reported shaking). What remains is the plain reason not to strip it: the
  // gutter costs nothing in a pane with `lineNumbers: Off`, folding is the
  // user's own editor working normally, and it is one less global side effect.
  "editor.minimap.enabled": false,
  // Sticky scroll pins the enclosing declaration to the top of the editor —
  // in a lens a few lines tall that is `theorem foo … := by` eating a large
  // fraction of the visible height, and it re-renders as the cursor moves
  // between tactics, which is exactly the jitter you feel while typing.
  "editor.stickyScroll.enabled": false,
};
// The lens deliberately does NOT touch `editor.fontSize`. It used to scale it
// down so more of the proof fit the same height, and that was the one strip
// felt everywhere OUTSIDE the lens: settings are user-global, so opening a lens
// resized the text in the main editor and every other window. Shrinking the
// glyphs to buy four lines is not worth making the file you are actually
// reading smaller. (`editor.glyphMargin` has since gone the same way for the
// same reason — see above.) Everything left in STATIC_STRIP is chrome — tabs,
// breadcrumbs, the minimap, sticky scroll — that a reader can lose for the
// duration without the text under their eyes MOVING.
//
// There is genuinely no per-editor alternative, which is why the trade existed
// and why it can't be salvaged: `TextEditorOptions` exposes only
// tabSize/indentSize/insertSpaces/cursorStyle/lineNumbers, and decoration
// render options have no fontSize. Smuggling `font-size` through a decoration's
// `textDecoration` CSS string does paint smaller glyphs per editor, but VS Code
// measures character advance width from the CONFIGURED font, so cursor, click
// hit-testing and selection rectangles all stay on the old grid — unusable in a
// pane meant for typing — and it gains no lines either, since line height
// derives from the fontSize setting rather than the painted glyphs.
//
// The height knob is not a setting at all: it is `vscode.setEditorLayout`,
// applied once to the freshly split group (see sizeLens/popout).
// Keys to snapshot and restore. Every strip now has a static target, so this
// is exactly STATIC_STRIP's keys. (A crash backup written by an OLDER version
// may still carry `editor.fontSize` or `editor.glyphMargin`; restore iterates
// the SNAPSHOT's keys, not this list, so such a backup is still undone
// correctly — which is also what un-strips a glyph margin left off by the
// version before this one.)
const STRIP_KEYS = Object.keys(STATIC_STRIP);
let strippedOriginals = null; // in-memory while a lens is open

function readChromeBackup() {
  try {
    return JSON.parse(fs.readFileSync(CHROME_BACKUP, "utf8"));
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stripEditorChrome() {
  if (strippedOriginals) return;
  const cfg = vscode.workspace.getConfiguration();
  // Settings are USER-global, shared by every window. If another window's
  // companion already stripped (live snapshot on disk), re-inspecting now
  // would capture the STRIPPED values as "originals" and make them
  // permanent on restore — adopt its originals instead.
  const prior = readChromeBackup();
  let originals;
  if (prior && prior.pid !== process.pid && pidAlive(prior.pid)) {
    originals = prior.originals;
  } else {
    originals = {};
    for (const key of STRIP_KEYS) {
      // `globalValue` (not the effective value): update() writes the USER
      // scope, so that's the scope that must be restored — possibly to unset.
      originals[key] = cfg.inspect(key)?.globalValue ?? null;
    }
  }
  strippedOriginals = originals;
  try {
    fs.writeFileSync(
      CHROME_BACKUP,
      JSON.stringify({ pid: process.pid, originals }),
    );
  } catch {
    // non-fatal: worst case a crash loses the snapshot
  }
  for (const [key, val] of Object.entries(STATIC_STRIP)) {
    await cfg.update(key, val, vscode.ConfigurationTarget.Global);
  }
}

/** Restore the user's chrome settings. `fromDisk` is the crash-recovery
 * path (activation): only applies a leftover snapshot whose owning
 * extension host is DEAD — a live owner means another window's lens is
 * open and its strip must stand. */
async function restoreEditorChrome(fromDisk) {
  let originals = strippedOriginals;
  if (!originals && fromDisk) {
    const prior = readChromeBackup();
    if (prior && !pidAlive(prior.pid)) originals = prior.originals;
  }
  if (!originals) return;
  strippedOriginals = null;
  const cfg = vscode.workspace.getConfiguration();
  for (const [key, orig] of Object.entries(originals)) {
    await cfg.update(
      key,
      orig === null ? undefined : orig,
      vscode.ConfigurationTarget.Global,
    );
  }
  try {
    fs.unlinkSync(CHROME_BACKUP);
  } catch {
    // already gone
  }
}

// ---- the lens group ------------------------------------------------------

// `workbench.action.newGroupBelow` acts on the ACTIVE group, and the only
// way to activate an arbitrary group from an extension is the positional
// focus commands.
const FOCUS_GROUP_CMDS = [
  null,
  "workbench.action.focusFirstEditorGroup",
  "workbench.action.focusSecondEditorGroup",
  "workbench.action.focusThirdEditorGroup",
  "workbench.action.focusFourthEditorGroup",
  "workbench.action.focusFifthEditorGroup",
  "workbench.action.focusSixthEditorGroup",
  "workbench.action.focusSeventhEditorGroup",
  "workbench.action.focusEighthEditorGroup",
];

/** The tab group hosting the Lean infoview webview, if any. */
function findInfoviewColumn() {
  for (const g of vscode.window.tabGroups.all) {
    for (const t of g.tabs) {
      const viewType = t.input?.viewType;
      if (
        (typeof viewType === "string" && /lean/i.test(viewType)) ||
        /lean\s*infoview/i.test(t.label ?? "")
      ) {
        return g.viewColumn;
      }
    }
  }
  return undefined;
}

// The lens group's viewColumn while one is open. viewColumns renumber as
// groups come and go, so reuse double-checks the group still holds the doc.
let lensColumn = null;
// Word wrap is a per-editor TOGGLE (`editor.action.toggleWordWrap`) with no
// "set" form, so we have to remember whether we already flipped this lens or a
// second popout would flip it back off. Cleared wherever `lensColumn` is, i.e.
// when the lens goes away and its editor state with it.
let lensWrapped = false;

/** The share of the infoview column the lens takes when it is first split off.
 * The split's own default is half and half; the lens is meant to be a slim
 * strip of buffer UNDER the tree, not its equal, so it takes a third. One
 * constant, one edit to retune. */
const LENS_HEIGHT_SHARE = 1 / 3;

/**
 * Locate a viewColumn's leaf inside a `vscode.getEditorLayout` tree.
 *
 * The layout is a tree of `{size, groups?}` carrying NO group identity — the
 * only handle on it is order: leaves in depth-first order ARE the groups in
 * grid-appearance order, which is what viewColumn numbers. Returns the leaf's
 * SIBLING ARRAY and its index in it, i.e. everything sharing one axis with it.
 */
function locateLayoutLeaf(layout, column) {
  let seen = 0;
  const walk = (siblings) => {
    for (let i = 0; i < siblings.length; i++) {
      const n = siblings[i];
      if (Array.isArray(n.groups) && n.groups.length) {
        const hit = walk(n.groups);
        if (hit) return hit;
      } else if (++seen === column) {
        return { siblings, index: i };
      }
    }
    return null;
  };
  return walk(Array.isArray(layout?.groups) ? layout.groups : []);
}

/**
 * Give the freshly split lens `LENS_HEIGHT_SHARE` of the height it shares with
 * the infoview, in ONE atomic `vscode.setEditorLayout` call.
 *
 * This is the replacement for the run of `decreaseViewHeight` nudges that was
 * removed: not because a resize must not animate — it does, and that is
 * accepted — but because a single call states the proportion it wants instead
 * of stepping toward it, and because the pane reaches its final height BEFORE
 * the document is opened in it, so `revealAtFraction` measures the height the
 * lens will keep and needs no second pass.
 *
 * Three facts about the command, read off the running VS Code (1.132) rather
 * than assumed:
 *
 *  1. Sizes are RELATIVE, not pixels and not fractions. The deserializer sums
 *     each branch's children and scales the result to the real container, so
 *     any consistent unit works — and MIXING units does not. `getEditorLayout`
 *     hands back absolute pixels, so this rescales within the branch's own
 *     total instead of writing 0.33/0.67 into a tree measured in hundreds.
 *  2. A layout with FEWER leaves than there are groups MERGES the extras —
 *     silently, destructively. So the tree that goes back is the tree that
 *     came out, one branch's sizes rewritten and nothing else touched. Never
 *     synthesise `{groups:[{},{}]}` here.
 *  3. It applies to the ACTIVE editor part and restores focus to the active
 *     group, which at this point is the lens. Focus therefore survives.
 *
 * Nothing needs restoring on close, and that is worth stating because the
 * obvious "capture the layout and put it back" is a TRAP — by then the group
 * count may have changed and (2) would merge the user's groups. We only ever
 * rewrite sizes WITHIN the infoview/lens branch, never the branch's own size
 * in the root axis; when the lens closes the branch dissolves and its sibling
 * reclaims the whole of it, which is exactly the pre-split state.
 *
 * Only on CREATE. A reused lens keeps whatever height it has, since after the
 * first popout that height may be one the user dragged.
 */
async function sizeLens(column) {
  let layout;
  try {
    layout = await vscode.commands.executeCommand("vscode.getEditorLayout");
  } catch (e) {
    say(`  size: getEditorLayout failed (${e}); leaving the split as it is`);
    return;
  }
  const spot = locateLayoutLeaf(layout, column);
  if (!spot || spot.siblings.length < 2) {
    say(`  size: no sibling axis for column ${column}; leaving the split`);
    return;
  }
  const before = spot.siblings.map((g) => g.size);
  if (!before.every((s) => typeof s === "number" && isFinite(s) && s > 0)) {
    say(`  size: unusable sizes ${JSON.stringify(before)}; leaving the split`);
    return;
  }
  const total = before.reduce((a, b) => a + b, 0);
  const rest = total - before[spot.index];
  if (rest <= 0) {
    say("  size: lens has no siblings to take from; leaving the split");
    return;
  }
  const want = total * LENS_HEIGHT_SHARE;
  spot.siblings.forEach((g, i) => {
    g.size = i === spot.index ? want : (before[i] / rest) * (total - want);
  });
  try {
    await vscode.commands.executeCommand("vscode.setEditorLayout", layout);
    say(
      `  size: lens ${before[spot.index].toFixed(0)}→${want.toFixed(0)} of ` +
        `${total.toFixed(0)} (${Math.round(LENS_HEIGHT_SHARE * 100)}%)`,
    );
  } catch (e) {
    say(`  size: setEditorLayout failed (${e}); the split keeps its own size`);
  }
}

/** How much of the lens to leave ABOVE the tactic. AtTop alone pins it to the
 * very first row, which reads as though the proof began there; a third of the
 * way down shows the step it follows from without pushing what comes next off
 * the bottom of a pane this short. */
const LENS_TOP_FRACTION = 1 / 3;

/** Scroll the lens so `selection` sits LENS_TOP_FRACTION down it. There is no
 * "reveal at fraction" API, so this reveals a line that far ABOVE the target
 * AtTop instead, measuring the pane's height in lines from `visibleRanges`.
 * It runs ONCE, and the ordering in `popout` is what earns that: the group is
 * resized to its final height BEFORE the document is shown in it, so the
 * `visibleRanges` this measures are the lens's own. (While the old shrink
 * nudges existed they ran after, this measured a pane twice the height it
 * would end up at, and a first popout had to reveal a second time.) A resize
 * AFTER the reveal would put that second pass back, which is the standing
 * reason not to move the call. Degenerate readings (an editor that hasn't
 * laid out yet, a
 * tactic near the top of the file) clamp to a zero pad, i.e. plain AtTop. */
function revealAtFraction(ed, selection) {
  const vis = ed.visibleRanges[0];
  const lines = vis ? vis.end.line - vis.start.line + 1 : 0;
  const pad = Math.max(0, Math.floor(lines * LENS_TOP_FRACTION));
  const top = Math.max(0, selection.start.line - pad);
  ed.revealRange(
    new vscode.Range(top, 0, top, 0),
    vscode.TextEditorRevealType.AtTop,
  );
}

/** A boolean setting from `ramify.*`, defaulting when unset. */
function flag(key, fallback) {
  const v = vscode.workspace.getConfiguration("ramify").get(key);
  return typeof v === "boolean" ? v : fallback;
}

/** Turn word wrap on for the lens, once.
 *
 * The pane is slim and Lean types are long, so the lens spends its width on
 * horizontal scrolling — which is most of what made it feel cramped. Unlike
 * the font size this leaks NOWHERE: `toggleWordWrap` is a command that flips
 * the editor's own session state, not a setting, so no other editor and no
 * other window sees it.
 *
 * Skipped when wrapping is already on globally, since the command is a toggle
 * with no "set" form and would turn the user's own preference OFF. */
async function wrapLens(ed) {
  if (lensWrapped || !flag("lensWordWrap", true)) return;
  const mode = vscode.workspace.getConfiguration("editor").get("wordWrap");
  if (mode && mode !== "off") {
    lensWrapped = true; // already wrapping; nothing to toggle, nothing to undo
    return;
  }
  if (vscode.window.activeTextEditor !== ed) return;
  try {
    await vscode.commands.executeCommand("editor.action.toggleWordWrap");
    lensWrapped = true;
  } catch (e) {
    say(`  wrap: ${e}`);
  }
}

/** Show `uri` in the lens editor: selection set, tactic a third of the way
 * down (see revealAtFraction), line numbers off (a per-editor option; other
 * editors keep their own). Returns the editor so the caller can re-reveal
 * once the pane has settled at its final height. */
async function showInLens(doc, selection, column) {
  // Same narrowing as the hover highlight: a raw step range would select the
  // trailing trivia too, and a structured tactic's whole block — more than the
  // lens is tall. The start is untouched, so the cursor still lands there.
  try {
    selection = tightenRange(doc, selection) ?? selection;
  } catch {
    // stale range after an edit: fall through with what we were given
  }
  const ed = await vscode.window.showTextDocument(doc, {
    viewColumn: column,
    selection,
    preview: false,
  });
  ed.options = { lineNumbers: vscode.TextEditorLineNumbersStyle.Off };
  // Keep the range highlighted but put the CURSOR (the selection's active end)
  // at its start. The cursor is what flows back to the widget as highlightPos
  // and picks the accented node, and a range's end is the worst possible place
  // to leave it: Paperproof ranges run into the next tactic's first token, and
  // a structured tactic's range ends deep inside its last nested tactic — so a
  // cursor at the end selects the wrong node. Its start is unambiguous.
  ed.selection = new vscode.Selection(selection.end, selection.start);
  // Wrapping changes which lines are visible, so it runs BEFORE the reveal
  // that positions the tactic a third of the way down.
  await wrapLens(ed);
  revealAtFraction(ed, selection);
  return { ed, selection };
}

/** Is this group showing `uri`? */
function groupHolds(g, key) {
  return g.tabs.some((t) => t.input?.uri?.toString?.() === key);
}

/** An editor we marked as a lens: `lineNumbers: Off` is a per-editor option
 * nothing else here sets, so it doubles as our own tag on the lens editor. */
function markedLens(key) {
  return vscode.window.visibleTextEditors.find(
    (e) =>
      (key === null || e.document.uri.toString() === key) &&
      e.options.lineNumbers === vscode.TextEditorLineNumbersStyle.Off,
  );
}

/**
 * The column of a lens we should REUSE for `uri`, or null to split a new one.
 *
 * Remembering the column alone is not enough, and both failure modes leave a
 * lens plainly visible on screen while the next popout splits another one
 * underneath it:
 *
 *  1. A window reload restarts the extension host — `lensColumn` resets to null
 *     — but VS Code RESTORES the editor layout, lens group and all.
 *  2. viewColumns renumber whenever a group closes, so the remembered number
 *     starts naming a different group (or none).
 *
 * So fall back from the remembered number to properties of the lens itself:
 * our own `lineNumbers: Off` tag (survives renumbering, not a reload — editor
 * options are runtime state), then simply "a second group already showing this
 * document" (survives both; the infoview group can't be mistaken for it, since
 * it holds a webview tab, not the uri). Reusing a second view of the doc that
 * we did not open is the right call anyway — better than stacking another.
 */
function findLensColumn(uri) {
  const key = uri.toString();
  const groups = vscode.window.tabGroups.all;
  if (lensColumn !== null) {
    const g = groups.find((g) => g.viewColumn === lensColumn);
    if (g && groupHolds(g, key)) return lensColumn;
  }
  const marked = markedLens(key);
  if (marked?.viewColumn != null) {
    lensColumn = marked.viewColumn;
    say(`  lens re-found by tag in column ${lensColumn}`);
    return lensColumn;
  }
  const cols = groups
    .filter((g) => groupHolds(g, key))
    .map((g) => g.viewColumn)
    .sort((a, b) => a - b);
  if (cols.length > 1) {
    lensColumn = cols[cols.length - 1];
    say(`  lens adopted (second group on the doc) in column ${lensColumn}`);
    return lensColumn;
  }
  lensColumn = null;
  lensWrapped = false;
  return null;
}

// ---- hover highlight -----------------------------------------------------
// The hover-weight counterpart of reveal: the widget reports a dwell on a
// tactic node and we paint its range, without moving the cursor or stealing
// focus (which reveal does, and which would make hovering unusable). One
// decoration type for the whole session — setting it with an empty array is
// how VS Code clears it.
const highlightDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor("editor.wordHighlightBackground"),
  borderRadius: "2px",
  isWholeLine: false,
});

/**
 * Shrink an incoming range to the span actually worth painting — used for
 * BOTH the hover highlight and the selection a reveal/popout leaves in the
 * lens, which overshoot for the same two reasons.
 *
 * Paperproof's step ranges include TRAILING TRIVIA — they run to the next
 * tactic's first token — so `obtain ⟨p, hpp, hpm⟩ := ih m hmlt hm2` arrives as
 * `31:8 → 32:8` and covers the end of its own line plus the whole indent of
 * the next. And a structured tactic's range covers its entire block, so
 * `have … := by` spans 13 lines in euclid for a node whose box shows one —
 * as a highlight that lights up half the screen, as a lens selection that
 * paints more than the lens is tall.
 *
 * Both are POINTERS ("the node is here"), not region selectors, so the range
 * is clamped to the START line and then trimmed back over trailing
 * whitespace. The start is never moved: the cursor left there is what flows
 * back as `highlightPos` and picks the accented node (see showInLens).
 *
 * The widget already sends the server's tight range where it has one (which
 * also strips a trailing comment, invisible from here); this is the geometric
 * backstop, and the only thing standing for a tactic missing from
 * `tacticEdits`.
 */
function tightenRange(doc, range) {
  const lineEnd = doc.lineAt(range.start.line).range.end;
  let end = range.end.isAfter(lineEnd) ? lineEnd : range.end;
  const text = doc.getText(new vscode.Range(range.start, end));
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed.length < text.length) {
    // Whitespace-only tail, so counting UTF-16 units back from the end is
    // safe: no multi-byte character can be split by this.
    end = end.translate(0, -(text.length - trimmed.length));
  }
  return end.isAfter(range.start) ? new vscode.Range(range.start, end) : null;
}

// The region an ARMED delete would remove. A separate decoration from the
// hover highlight, and deliberately: that one says "this is the tactic you are
// pointing at", this one says "this is about to go", so it takes the editor's
// own deleted-text colour and spans whole lines.
/** Set `decoration` on every visible editor showing `uri`, to whatever
`rangeFor(document)` returns — `null` clears it.
 *
 * A document can be visible in more than one group at once (the lens is exactly
 * that: the same buffer beside the main editor), so every decoration here has
 * to sweep them all. `rangeFor` takes the document because the range may need
 * clamping against it, which the hover highlight does and the delete preview
 * deliberately does not. */
function paintEveryEditor(uri, decoration, rangeFor) {
  for (const ed of vscode.window.visibleTextEditors) {
    if (uri && ed.document.uri.toString() !== uri.toString()) continue;
    const r = rangeFor(ed.document);
    ed.setDecorations(decoration, r ? [r] : []);
  }
}

const previewDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor("diffEditor.removedTextBackground"),
  borderRadius: "2px",
  isWholeLine: false,
});

/** Paint the delete-preview span in every visible editor for `uri`.
 *
 * NOT run through `tightenRange`: that clamps to the END OF THE START LINE,
 * which is right for a hover (a structured tactic would otherwise light up its
 * whole 13-line block) and exactly wrong here — a delete extent is routinely
 * many lines and showing all of them is the entire point of arming. */
function preview(uri, range) {
  paintEveryEditor(uri, previewDecoration, () => range);
}

// Inline goal state in the lens: `⊢ …` at the end of each tactic's last line,
// so a proof read in the lens carries its intermediate states the way an
// Alectryon page does. An `after` decoration costs no lines and no width the
// code was using, which is the whole reason it fits a pane this small.
//
// LENS ONLY, deliberately. The main buffer has the infoview for this, and
// stamping every tactic line there would be noise competing with the thing the
// user is editing.
const goalDecoration = vscode.window.createTextEditorDecorationType({
  after: {
    color: new vscode.ThemeColor("editorCodeLens.foreground"),
    fontStyle: "italic",
    margin: "0 0 0 2em",
  },
  // The text belongs to the LINE, not to the characters around it: without
  // this a decoration at end-of-line grows as you type past it.
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

/** The lens's editor, or null. Reuses the same three-step ladder as reveal. */
function lensEditor(uri) {
  const key = uri.toString();
  const col = findLensColumn(uri);
  if (col === null) return null;
  return (
    vscode.window.visibleTextEditors.find(
      (e) => e.viewColumn === col && e.document.uri.toString() === key,
    ) ?? null
  );
}

/** Paint (or with an empty list, clear) the lens's inline goal state. */
function annotate(uri, items) {
  const ed = lensEditor(uri);
  if (!ed) return; // no lens open: nothing to annotate, and not an error
  if (!flag("lensGoals", true)) {
    ed.setDecorations(goalDecoration, []);
    return;
  }
  const opts = [];
  for (const a of items) {
    // The payload is computed from the last parse; the document may have moved
    // on. A line past the end is simply dropped rather than clamped, since a
    // goal drawn on the wrong line is worse than one missing.
    if (typeof a.line !== "number" || a.line < 0 || a.line >= ed.document.lineCount)
      continue;
    const end = ed.document.lineAt(a.line).range.end;
    opts.push({
      range: new vscode.Range(end, end),
      renderOptions: { after: { contentText: a.text } },
    });
  }
  ed.setDecorations(goalDecoration, opts);
}

/** Run an editor command against the doc holding `uri`.
 *
 * `undo`/`redo` act on whatever is FOCUSED — there is no document-targeted
 * undo API — so the group has to be activated first, by the same positional
 * ladder `popout` uses (the only way an extension can activate an arbitrary
 * group). Focus therefore moves to the editor. That is unavoidable, and it is
 * also the better behaviour: you land where the change happened, and every
 * subsequent ⌘Z is native, which keeps repeats off this one-shot relay
 * entirely. */
async function runEditorCommand(uri, command) {
  const doc = await vscode.workspace.openTextDocument(uri);
  const lens = findLensColumn(uri);
  const existing = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === uri.toString(),
  );
  const column = lens ?? existing?.viewColumn ?? vscode.ViewColumn.One;
  // showTextDocument focuses (no preserveFocus), which is what the command
  // needs; it also handles the case where the doc is open in no group at all.
  await vscode.window.showTextDocument(doc, { viewColumn: column, preview: false });
  await vscode.commands.executeCommand(command);
}

/** Paint `range` in every visible editor showing `uri`; `null` clears. */
function highlight(uri, range) {
  paintEveryEditor(uri, highlightDecoration, (doc) => {
    if (!range) return null;
    try {
      return tightenRange(doc, range);
    } catch {
      return range; // a stale range after an edit — better than nothing
    }
  });
}

/** tree→source reveal. The lens is the working surface, so it wins when one
 * is open; otherwise the first visible editor of the doc (what
 * vscode-lean4's own reveal would pick). Either way the target editor's
 * cursor lands on the range, which flows back to the widget as
 * `highlightPos` — closing the tree↔editor loop. */
async function reveal(uri, selection) {
  const doc = await vscode.workspace.openTextDocument(uri);
  const lens = findLensColumn(uri);
  if (lens !== null) {
    await showInLens(doc, selection, lens);
    return;
  }
  const existing = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === uri.toString(),
  );
  // Collapsed at the range's START, for the reason in showInLens — and in the
  // main buffer there is nothing to be gained from selecting the whole tactic
  // anyway, so this just places the cursor.
  const caret = new vscode.Range(selection.start, selection.start);
  await vscode.window.showTextDocument(doc, {
    viewColumn: existing?.viewColumn ?? vscode.ViewColumn.One,
    selection: caret,
    preview: false,
  });
}

/** Open (or reuse) the lens group under the infoview and put the tactic in
 * it. */
async function popout(uri, selection) {
  const doc = await vscode.workspace.openTextDocument(uri);
  const lens = findLensColumn(uri);
  if (lens !== null) {
    say(`  popout: reusing lens in column ${lens}`);
    await showInLens(doc, selection, lens);
    return;
  }
  say("  popout: no lens found, splitting a new one");
  const infoColumn = findInfoviewColumn();
  const focusCmd = FOCUS_GROUP_CMDS[infoColumn ?? -1];
  say(`  popout: infoview column=${infoColumn}`);
  if (!focusCmd) {
    void vscode.window.showErrorMessage(
      "Ramify: no Lean infoview group found to attach the lens to.",
    );
    return;
  }
  // Split a NEW empty group off below the infoview (newGroupBelow, not
  // splitEditorDown: the latter would try to duplicate the webview editor).
  await vscode.commands.executeCommand(focusCmd);
  await vscode.commands.executeCommand("workbench.action.newGroupBelow");
  lensColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
  say(`  popout: lens opened in column ${lensColumn}`);
  // The split is half and half; the lens takes a third of the column. ORDER IS
  // LOAD-BEARING: resize the EMPTY group first, open the document into it
  // second. That way the reveal inside `showInLens` measures the height the
  // lens will keep, so it is the last word and runs once — the old run of
  // `decreaseViewHeight` nudges resized after the text was placed, which is
  // why it needed a second reveal chasing it.
  await sizeLens(lensColumn);
  await showInLens(doc, selection, lensColumn);
  await stripEditorChrome();
}

function activate(context) {
  log = vscode.window.createOutputChannel("Ramify");
  context.subscriptions.push(
    log,
    highlightDecoration,
    previewDecoration,
    goalDecoration,
  );
  // Annotations are positional, so the first edit invalidates every one below
  // it. Drop them immediately and wait for the widget's next `annotate` (it
  // re-sends whenever the proof it holds changes) rather than leave goals
  // pinned to lines that have moved.
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length === 0) return;
      const ed = lensEditor(e.document.uri);
      if (ed) ed.setDecorations(goalDecoration, []);
    }),
  );
  say(`activated (pid ${process.pid}), watching ${REQUEST_DIR}`);
  // Crash recovery: a leftover snapshot means a previous session died with a
  // lens open (its global settings still stripped) — restore before
  // anything else.
  void restoreEditorChrome(true);
  // The tree's syntax colouring follows the editor's theme, and this is the
  // only place that can resolve it (see TOKEN_SCOPES). Published on activation
  // and whenever the theme changes; the widget re-reads it through the server.
  publishThemeColors();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => publishThemeColors()),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      // A theme EDIT (tokenColorCustomizations) changes colours without
      // changing the active theme, so watch the customisation keys too — and
      // every SETTING the file carries alongside them, or toggling one would
      // not be seen until the next theme change. The whole `ramify`
      // SECTION rather than one line per key: the per-key list had to be fed
      // by hand for every new setting (and a key left out shipped
      // half-working — this is the recorded failure mode), while the section
      // test covers future keys for free. Lens-only settings republishing is
      // harmless: one file write.
      if (
        e.affectsConfiguration("workbench.colorTheme") ||
        e.affectsConfiguration("editor.tokenColorCustomizations") ||
        e.affectsConfiguration("editor.semanticTokenColorCustomizations") ||
        e.affectsConfiguration("editor.bracketPairColorization.enabled") ||
        e.affectsConfiguration("ramify") ||
        e.affectsConfiguration("lean4.input")
      )
        publishThemeColors();
    }),
  );
  // Restore the stripped chrome when the lens group closes (its column
  // vanishes from tabGroups, or gets renumbered away — the doc check in
  // popout handles the rare renumber-collision).
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabGroups(() => {
      if (lensColumn === null) return;
      const live = vscode.window.tabGroups.all.some(
        (g) => g.viewColumn === lensColumn,
      );
      if (live) return;
      // A vanished COLUMN NUMBER is not a closed lens: numbers renumber when
      // any group closes. Re-resolve by our tag before restoring the chrome —
      // otherwise closing an unrelated group un-strips the editor and orphans
      // the lens from `lensColumn`, so the next popout splits a second one.
      const marked = markedLens(null);
      if (marked?.viewColumn != null) {
        lensColumn = marked.viewColumn;
        say(`lens renumbered to column ${lensColumn}`);
        return;
      }
      say("lens closed; restoring editor chrome");
      lensColumn = null;
      lensWrapped = false;
      void restoreEditorChrome(false);
    }),
  );
  // --- command-palette entrypoint ---------------------------------------
  // Modifier-free route into the lens that does not depend on the widget at
  // all: acts on the active editor's cursor/selection. Also the isolation
  // test when the tree's own button misbehaves — if this opens the lens, the
  // companion half (group discovery, split, sizing) is proven good and the
  // fault is purely widget-side.
  context.subscriptions.push(
    vscode.commands.registerCommand("ramify.openLens", async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) {
        void vscode.window.showErrorMessage(
          "Ramify: no active editor to open in the lens.",
        );
        return;
      }
      try {
        await popout(ed.document.uri, ed.selection);
      } catch (e) {
        void vscode.window.showErrorMessage(
          `Ramify: open in lens failed: ${e}`,
        );
      }
    }),
  );

  // --- filesystem bridge -------------------------------------------------
  // Plain node fs.watch (not vscode's watcher: it is workspace-oriented and
  // this file deliberately lives in the home dir, shared by every window).
  // fs.watch commonly fires several events per write, and every open window
  // runs a companion — the nonce dedupes within a window, the workspace
  // check keeps foreign windows from reacting.
  let lastNonce = null;
  const handleRequest = async () => {
    let req;
    try {
      req = JSON.parse(
        fs.readFileSync(path.join(REQUEST_DIR, REQUEST_FILE), "utf8"),
      );
    } catch {
      return; // partial write or already consumed — a later event retries
    }
    if (!req) return;
    if (req.nonce === lastNonce) return; // fs.watch double-fire
    const target = vscode.Uri.parse(req.uri, true);
    // highlight/clear fire on hover, so they'd drown the log; the rest are
    // deliberate gestures and each one is worth a line.
    const chatty =
      req.action === "highlight" ||
      req.action === "clear" ||
      req.action === "preview" ||
      req.action === "preview-clear" ||
      req.action === "annotate";
    if (!chatty)
      say(`request ${req.nonce}: action=${req.action ?? "popout"} uri=${req.uri}`);
    // Every open window runs a companion, so exactly one must react. The
    // workspace folder is the primary test, but it is NOT sufficient on its
    // own: a file opened outside any workspace folder (a loose file, a
    // scratch buffer) has none, and the request would be dropped in total
    // silence — indistinguishable from a dead button. Having the document
    // OPEN in this window is just as good a claim of ownership.
    const owned =
      !!vscode.workspace.getWorkspaceFolder(target) ||
      vscode.workspace.textDocuments.some(
        (d) => d.uri.toString() === target.toString(),
      );
    if (!owned) {
      say("  skipped: this window neither owns the workspace nor has the doc open");
      return;
    }
    lastNonce = req.nonce;
    const range = new vscode.Range(
      req.start.line,
      req.start.character,
      req.stop.line,
      req.stop.character,
    );
    try {
      if (req.action === "highlight") {
        highlight(target, range);
      } else if (req.action === "clear") {
        highlight(null, null);
      } else if (req.action === "preview") {
        preview(target, range);
      } else if (req.action === "preview-clear") {
        preview(null, null);
      } else if (req.action === "annotate") {
        annotate(target, req.annotations ?? []);
      } else if (req.action === "undo" || req.action === "redo") {
        await runEditorCommand(target, req.action);
      } else if (req.action === "reveal") {
        await reveal(target, range);
        annotate(target, req.annotations ?? []);
      } else {
        await popout(target, range);
        // After the lens exists, not before: `annotate` resolves the lens
        // editor and a fresh split has none until popout returns.
        annotate(target, req.annotations ?? []);
      }
      if (!chatty) say("  done");
    } catch (e) {
      say(`  FAILED: ${e && e.stack ? e.stack : e}`);
      void vscode.window.showErrorMessage(
        `Ramify: ${req.action ?? "popout"} failed: ${e}`,
      );
    }
  };
  try {
    fs.mkdirSync(REQUEST_DIR, { recursive: true });
    const watcher = fs.watch(REQUEST_DIR, (_event, filename) => {
      if (filename === REQUEST_FILE) void handleRequest();
    });
    say("watcher started");
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch (e) {
    void vscode.window.showErrorMessage(
      `Ramify: request watcher failed to start: ${e}`,
    );
  }

  // --- URI deep link (secondary) ----------------------------------------
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri) {
        if (uri.path !== "/edit") return;
        try {
          const q = new URLSearchParams(uri.query);
          await popout(
            vscode.Uri.parse(q.get("uri"), true),
            new vscode.Range(
              Number(q.get("startLine")),
              Number(q.get("startChar")),
              Number(q.get("endLine")),
              Number(q.get("endChar")),
            ),
          );
        } catch (e) {
          void vscode.window.showErrorMessage(
            `Ramify: popout failed: ${e}`,
          );
        }
      },
    }),
  );
}

// Best-effort: async work in deactivate is not guaranteed to finish, but the
// on-disk snapshot covers the gap (restored on next activation).
function deactivate() {
  return restoreEditorChrome(false);
}

module.exports = { activate, deactivate };
