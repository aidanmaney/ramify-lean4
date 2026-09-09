const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");

let log = null;
function say(msg) {
  if (log) log.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

const REQUEST_DIR = path.join(os.homedir(), ".proof-tree-companion");
const REQUEST_FILE = "popout-request.json";
const CHROME_BACKUP = path.join(REQUEST_DIR, "chrome-backup.json");
const THEME_FILE = path.join(REQUEST_DIR, "theme-colors.json");

const TOKEN_SCOPES = {
  keyword: ["keyword"],
  function: ["entity.name.function", "support.function"],
  variable: ["variable.other.readwrite", "variable"],
  property: ["variable.other.property", "variable"],
  number: ["constant.numeric"],
  string: ["string"],
  comment: ["comment"],
  type: ["entity.name.type", "support.type", "storage.type"],
};

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

function scopeColor(rules, want) {
  let best = null;
  let bestLen = -1;

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
        subLen = e.length;
        sub = fg;
      }
    }
  }
  return best ?? sub;
}

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

function publishThemeColors() {
  try {
    fs.mkdirSync(REQUEST_DIR, { recursive: true });
    const colors = resolveTokenColors();
    const name = vscode.workspace
      .getConfiguration("workbench")
      .get("colorTheme");

    const brackets =
      vscode.workspace
        .getConfiguration("editor")
        .get("bracketPairColorization.enabled") !== false;

    const outline =
      vscode.workspace.getConfiguration("ramify").get("outlineOnly") ===
      true;

    const linkTint =
      vscode.workspace.getConfiguration("ramify").get("linkTint") === true;

    const linkMarks =
      vscode.workspace.getConfiguration("ramify").get("linkMarks") === true;

    const typingHoldMs = vscode.workspace
      .getConfiguration("ramify")
      .get("typingHoldMs");

    const counterfactual =
      vscode.workspace.getConfiguration("ramify").get("counterfactual") !==
      false;

    const hypMarkStyle = vscode.workspace
      .getConfiguration("ramify")
      .get("hypMarkStyle");

    const inputCfg = vscode.workspace.getConfiguration("lean4.input");
    const custom = inputCfg.get("customTranslations") || {};
    const input = {
      enabled: inputCfg.get("enabled") !== false,
      leader: inputCfg.get("leader") || "\\",
      eager: inputCfg.get("eagerReplacementEnabled") !== false,

      custom: Object.keys(custom).map((abbreviation) => ({
        abbreviation,
        symbol: String(custom[abbreviation]),
      })),
    };

    fs.writeFileSync(
      THEME_FILE,
      JSON.stringify(
        {
          theme: name,
          brackets,
          outline,
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

    say(
      `theme "${name}" (brackets ${brackets ? "on" : "off"}, ` +
        `outline ${outline ? "on" : "off"}, ` +
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

const STATIC_STRIP = {
  "workbench.editor.showTabs": "none",
  "breadcrumbs.enabled": false,

  "editor.minimap.enabled": false,

  "editor.stickyScroll.enabled": false,
};

const STRIP_KEYS = Object.keys(STATIC_STRIP);
let strippedOriginals = null;

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

  const prior = readChromeBackup();
  let originals;
  if (prior && prior.pid !== process.pid && pidAlive(prior.pid)) {
    originals = prior.originals;
  } else {
    originals = {};
    for (const key of STRIP_KEYS) {
      originals[key] = cfg.inspect(key)?.globalValue ?? null;
    }
  }
  strippedOriginals = originals;
  try {
    fs.writeFileSync(
      CHROME_BACKUP,
      JSON.stringify({ pid: process.pid, originals }),
    );
  } catch {}
  for (const [key, val] of Object.entries(STATIC_STRIP)) {
    await cfg.update(key, val, vscode.ConfigurationTarget.Global);
  }
}

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
  } catch {}
}

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

let lensColumn = null;

let lensWrapped = false;

const LENS_HEIGHT_SHARE = 1 / 3;

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

const LENS_TOP_FRACTION = 1 / 3;

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

function flag(key, fallback) {
  const v = vscode.workspace.getConfiguration("ramify").get(key);
  return typeof v === "boolean" ? v : fallback;
}

async function wrapLens(ed) {
  if (lensWrapped || !flag("lensWordWrap", true)) return;
  const mode = vscode.workspace.getConfiguration("editor").get("wordWrap");
  if (mode && mode !== "off") {
    lensWrapped = true;
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

async function showInLens(doc, selection, column) {
  try {
    selection = tightenRange(doc, selection) ?? selection;
  } catch {}
  const ed = await vscode.window.showTextDocument(doc, {
    viewColumn: column,
    selection,
    preview: false,
  });
  ed.options = { lineNumbers: vscode.TextEditorLineNumbersStyle.Off };

  ed.selection = new vscode.Selection(selection.end, selection.start);

  await wrapLens(ed);
  revealAtFraction(ed, selection);
  return { ed, selection };
}

function groupHolds(g, key) {
  return g.tabs.some((t) => t.input?.uri?.toString?.() === key);
}

function markedLens(key) {
  return vscode.window.visibleTextEditors.find(
    (e) =>
      (key === null || e.document.uri.toString() === key) &&
      e.options.lineNumbers === vscode.TextEditorLineNumbersStyle.Off,
  );
}

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

const highlightDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor("editor.wordHighlightBackground"),
  borderRadius: "2px",
  isWholeLine: false,
});

function tightenRange(doc, range) {
  const lineEnd = doc.lineAt(range.start.line).range.end;
  let end = range.end.isAfter(lineEnd) ? lineEnd : range.end;
  const text = doc.getText(new vscode.Range(range.start, end));
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed.length < text.length) {
    end = end.translate(0, -(text.length - trimmed.length));
  }
  return end.isAfter(range.start) ? new vscode.Range(range.start, end) : null;
}

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

function preview(uri, range) {
  paintEveryEditor(uri, previewDecoration, () => range);
}

const goalDecoration = vscode.window.createTextEditorDecorationType({
  after: {
    color: new vscode.ThemeColor("editorCodeLens.foreground"),
    fontStyle: "italic",
    margin: "0 0 0 2em",
  },

  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

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

function annotate(uri, items) {
  const ed = lensEditor(uri);
  if (!ed) return;
  if (!flag("lensGoals", true)) {
    ed.setDecorations(goalDecoration, []);
    return;
  }
  const opts = [];
  for (const a of items) {
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

async function runEditorCommand(uri, command) {
  const doc = await vscode.workspace.openTextDocument(uri);
  const lens = findLensColumn(uri);
  const existing = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === uri.toString(),
  );
  const column = lens ?? existing?.viewColumn ?? vscode.ViewColumn.One;

  await vscode.window.showTextDocument(doc, { viewColumn: column, preview: false });
  await vscode.commands.executeCommand(command);
}

function highlight(uri, range) {
  paintEveryEditor(uri, highlightDecoration, (doc) => {
    if (!range) return null;
    try {
      return tightenRange(doc, range);
    } catch {
      return range;
    }
  });
}

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

  const caret = new vscode.Range(selection.start, selection.start);
  await vscode.window.showTextDocument(doc, {
    viewColumn: existing?.viewColumn ?? vscode.ViewColumn.One,
    selection: caret,
    preview: false,
  });
}

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

  await vscode.commands.executeCommand(focusCmd);
  await vscode.commands.executeCommand("workbench.action.newGroupBelow");
  lensColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
  say(`  popout: lens opened in column ${lensColumn}`);

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

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length === 0) return;
      const ed = lensEditor(e.document.uri);
      if (ed) ed.setDecorations(goalDecoration, []);
    }),
  );
  say(`activated (pid ${process.pid}), watching ${REQUEST_DIR}`);

  void restoreEditorChrome(true);

  publishThemeColors();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => publishThemeColors()),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
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

  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabGroups(() => {
      if (lensColumn === null) return;
      const live = vscode.window.tabGroups.all.some(
        (g) => g.viewColumn === lensColumn,
      );
      if (live) return;

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

  let lastNonce = null;
  const handleRequest = async () => {
    let req;
    try {
      req = JSON.parse(
        fs.readFileSync(path.join(REQUEST_DIR, REQUEST_FILE), "utf8"),
      );
    } catch {
      return;
    }
    if (!req) return;
    if (req.nonce === lastNonce) return;
    const target = vscode.Uri.parse(req.uri, true);

    const chatty =
      req.action === "highlight" ||
      req.action === "clear" ||
      req.action === "preview" ||
      req.action === "preview-clear" ||
      req.action === "annotate";
    if (!chatty)
      say(`request ${req.nonce}: action=${req.action ?? "popout"} uri=${req.uri}`);

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

}

function deactivate() {
  return restoreEditorChrome(false);
}

module.exports = { activate, deactivate };
