// Proof Tree Companion — the editor-side half of widget gestures the infoview
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
// Secondary route, same action: a `vscode://aidan.proof-tree-companion/edit`
// deep link (usable from the OS / other tooling, not from the infoview).
const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Everything the relay does is invisible by design (a file written by a Lean
// server, read by a watcher in another process), so every step logs here.
// Open it from Output → "Proof Tree Companion" when a widget gesture appears
// to do nothing: the log says whether the request arrived at all, and if it
// was skipped, why.
let log = null;
function say(msg) {
  if (log) log.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

const REQUEST_DIR = path.join(os.homedir(), ".proof-tree-companion");
const REQUEST_FILE = "popout-request.json";
const CHROME_BACKUP = path.join(REQUEST_DIR, "chrome-backup.json");

// ---- editor-chrome strip -------------------------------------------------
// There is NO per-window settings API, so anything beyond per-editor options
// (line numbers) can only be stripped GLOBALLY while a lens is open and
// restored when it closes. The goal is maximum vertical room in the infoview
// column: tab rows and breadcrumbs go entirely, plus the gutter/minimap
// chaff. Main-window impact while a lens is open: no tab row (ctrl-tab still
// switches), no breadcrumbs, no minimap; folding controls only show on
// mouseover by default and the glyph margin is the breakpoint lane. The
// originals are snapshotted to disk (PID-stamped) so a crash mid-lens can't
// permanently eat the user's settings — restored on next activation if the
// owning extension host is dead.
const STATIC_STRIP = {
  "workbench.editor.showTabs": "none",
  "breadcrumbs.enabled": false,
  "editor.glyphMargin": false,
  "editor.folding": false,
  "editor.minimap.enabled": false,
  // Sticky scroll pins the enclosing declaration to the top of the editor —
  // in a lens a few lines tall that is `theorem foo … := by` eating a large
  // fraction of the visible height, and it re-renders as the cursor moves
  // between tactics, which is exactly the jitter you feel while typing.
  "editor.stickyScroll.enabled": false,
};
// The lens font is shrunk so more of the proof fits the same height. This one
// is DERIVED, not fixed: a literal size would be wrong for anyone whose editor
// font isn't the default, so it scales the user's own.
//
// It is also the one strip that is unavoidably felt OUTSIDE the lens, so it is
// user-configurable and can be turned off (`proofTree.lensFontScale: 1`).
// There is genuinely no per-editor alternative: `TextEditorOptions` exposes
// only tabSize/indentSize/insertSpaces/cursorStyle/lineNumbers, and decoration
// render options have no fontSize. Smuggling `font-size` through a
// decoration's `textDecoration` CSS string does render smaller glyphs per
// editor, but VS Code measures character advance width from the CONFIGURED
// font, so the cursor, click hit-testing and selection rectangles all stay on
// the old grid — unusable in a pane meant for typing — and it wouldn't even
// gain lines, since line height derives from the fontSize setting rather than
// the painted glyphs.
const DEFAULT_LENS_FONT_SCALE = 0.85;
const DEFAULT_FONT_SIZE = 14; // VS Code's own default, used when unset
const MIN_FONT_SIZE = 8;

/** A numeric setting from `proofTree.*`, falling back when unset/invalid. */
function tuning(key, fallback) {
  const v = vscode.workspace.getConfiguration("proofTree").get(key);
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
// Keys to snapshot and restore. `editor.fontSize` has no static target, so it
// is listed here but valued by `stripValues`.
const STRIP_KEYS = [...Object.keys(STATIC_STRIP), "editor.fontSize"];

/** What to write, given the user's ORIGINAL values. The font must scale off
 * the original and never off the live setting: another window's lens may have
 * already shrunk it, and re-deriving from that would compound each time. */
function stripValues(originals) {
  const scale = tuning("lensFontScale", DEFAULT_LENS_FONT_SCALE);
  const base =
    typeof originals["editor.fontSize"] === "number"
      ? originals["editor.fontSize"]
      : DEFAULT_FONT_SIZE;
  // Scale 1 (or anything that rounds back to the original) means "leave my
  // font alone": write nothing for it, so the setting is never touched and
  // restore has nothing to undo.
  const target = Math.max(MIN_FONT_SIZE, Math.round(base * scale));
  const out = { ...STATIC_STRIP };
  if (target !== base) out["editor.fontSize"] = target;
  return out;
}
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
  for (const [key, val] of Object.entries(stripValues(originals))) {
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

// How many `decreaseViewHeight` nudges to take off the fresh 50% split. The
// split is empirically ≈ 9 nudges tall, so the lens ends up ≈ (9−n) slices:
// LOWER IS TALLER. 5 was too cramped to edit in comfortably.
const DEFAULT_LENS_SHRINK_NUDGES = 3;

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

/** How much of the lens to leave ABOVE the tactic. AtTop alone pins it to the
 * very first row, which reads as though the proof began there; a third of the
 * way down shows the step it follows from without pushing what comes next off
 * the bottom of a pane this short. */
const LENS_TOP_FRACTION = 1 / 3;

/** Scroll the lens so `selection` sits LENS_TOP_FRACTION down it. There is no
 * "reveal at fraction" API, so this reveals a line that far ABOVE the target
 * AtTop instead, measuring the pane's height in lines from `visibleRanges` —
 * which is why the first popout re-reveals after the shrink nudges (before
 * them the pane is twice the height it will end up). Degenerate readings (an
 * editor that hasn't laid out yet, a tactic near the top of the file) clamp to
 * a zero pad, i.e. back to plain AtTop. */
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

/** Paint `range` in every visible editor showing `uri`; `null` clears. */
function highlight(uri, range) {
  for (const ed of vscode.window.visibleTextEditors) {
    if (uri && ed.document.uri.toString() !== uri.toString()) continue;
    let paint = null;
    if (range) {
      try {
        paint = tightenRange(ed.document, range);
      } catch {
        paint = range; // a stale range after an edit — better than nothing
      }
    }
    ed.setDecorations(highlightDecoration, paint ? [paint] : []);
  }
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
      "proof-tree-companion: no Lean infoview group found to attach the lens to.",
    );
    return;
  }
  // Split a NEW empty group off below the infoview (newGroupBelow, not
  // splitEditorDown: the latter would try to duplicate the webview editor).
  await vscode.commands.executeCommand(focusCmd);
  await vscode.commands.executeCommand("workbench.action.newGroupBelow");
  lensColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
  say(`  popout: lens opened in column ${lensColumn}`);
  const shown = await showInLens(doc, selection, lensColumn);
  await stripEditorChrome();
  // Shrink the lens: the split starts at 50% of the infoview column; each
  // nudge takes a fixed slice off (empirically the split ≈ 9 nudges, so
  // height ≈ (9−n) slices: 6→~3 lines, 3→double that, 5→two-thirds of 3's).
  // Height commands act on the active group (the lens); best-effort.
  try {
    const nudges = tuning("lensShrinkNudges", DEFAULT_LENS_SHRINK_NUDGES);
    for (let i = 0; i < nudges; i++) {
      await vscode.commands.executeCommand(
        "workbench.action.decreaseViewHeight",
      );
    }
  } catch {
    // sizing is cosmetic — an unshrunk lens still works
  }
  // The pane is only now at its final height, and the reveal inside showInLens
  // measured the pre-shrink one — so place the tactic again against what the
  // lens actually is. Reused lenses (the early return above) are already
  // settled and need no second pass.
  if (shown) revealAtFraction(shown.ed, shown.selection);
}

function activate(context) {
  log = vscode.window.createOutputChannel("Proof Tree Companion");
  context.subscriptions.push(log, highlightDecoration);
  say(`activated (pid ${process.pid}), watching ${REQUEST_DIR}`);
  // Crash recovery: a leftover snapshot means a previous session died with a
  // lens open (its global settings still stripped) — restore before
  // anything else.
  void restoreEditorChrome(true);
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
    vscode.commands.registerCommand("proofTree.openLens", async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) {
        void vscode.window.showErrorMessage(
          "proof-tree-companion: no active editor to open in the lens.",
        );
        return;
      }
      try {
        await popout(ed.document.uri, ed.selection);
      } catch (e) {
        void vscode.window.showErrorMessage(
          `proof-tree-companion: open in lens failed: ${e}`,
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
    const chatty = req.action === "highlight" || req.action === "clear";
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
      } else if (req.action === "reveal") {
        await reveal(target, range);
      } else {
        await popout(target, range);
      }
      if (!chatty) say("  done");
    } catch (e) {
      say(`  FAILED: ${e && e.stack ? e.stack : e}`);
      void vscode.window.showErrorMessage(
        `proof-tree-companion: ${req.action ?? "popout"} failed: ${e}`,
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
      `proof-tree-companion: request watcher failed to start: ${e}`,
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
            `proof-tree-companion: popout failed: ${e}`,
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
