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
// C4 / D6 — the two channels that go OUT to a model. The widget's webview
// reaches no network; this process does, so the RPC writes a request file and
// polls for the response file this module writes back. Same directory, same
// `fs.watch`, opposite direction.
const POLISH_REQUEST = "polish-request.json";
const POLISH_RESPONSE = "polish-response.json";
const PROPOSE_REQUEST = "propose-request.json";
const PROPOSE_RESPONSE = "propose-response.json";
// D1 extract's follow-up (2026-09-17): its own file, because it is written as
// the pointer leaves the accepted pill and a hover `clear` into
// `popout-request.json` would otherwise overwrite it before the watcher read.
const RENAME_REQUEST = "rename-request.json";
// A `⋯`-menu PIN in the tree → `ramify.hoverBar.tactic|goal`. Its own file for
// the reason `rename` has one: the pin is clicked with the pointer on its way
// back over the tree, whose hover `highlight`/`clear` lands in
// `popout-request.json` a moment later and would overwrite it unread.
const SETTINGS_REQUEST = "settings-request.json";
// The move ids a hover-bar list may hold — package.json's enum, and
// web/src/moves.ts `MOVE_IDS`.
const MOVE_IDS = [
  "source", "focus", "skip", "path", "delete", "trace", "collapse",
  "expand", "inline", "extract", "lint", "lens", "goal",
];
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

/* ════════════════════════════════════════════════════════════════════════
   C4 / D6 — the model channels
   ════════════════════════════════════════════════════════════════════════

   Two constrained asks, one client. C4 POLISHES the templated narration —
   the configuration every informalization paper reports as the best one: the
   model rewrites a sentence that is already true rather than writing one from
   the Lean. D6 CHOOSES among rewrites this side already computed and could
   already write; it never returns an edit.

   The API key is read from `context.secrets` (command "Ramify: Set narration
   API key") or from the environment. It is NEVER a setting, never written to
   any file, and never logged — nor is the prompt, which carries the user's
   proof. What the Output channel gets is the request id, the line count, the
   latency and the token usage. */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const SECRET_KEY = "ramify.narrationApiKey";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

/** What the widget is told, through the theme file. `ready` is the whole
 answer to "can this be asked at all". */
let aiState = { polish: false, propose: false, ready: false, why: "" };
let secrets = null;
let memento = null;

function aiConfig() {
  const cfg = vscode.workspace.getConfiguration("ramify");
  return {
    polish: cfg.get("narration.polish") === true,
    propose: cfg.get("restructure.propose") === true,
    model: cfg.get("narration.model") || DEFAULT_MODEL,
  };
}

async function apiKey() {
  const stored = secrets ? await secrets.get(SECRET_KEY) : undefined;
  return stored || process.env.ANTHROPIC_API_KEY || "";
}

/** Recompute what the widget is allowed to offer, and republish it. Called on
 activation, on any `ramify` setting change, and after the key is set. */
async function refreshAi() {
  const cfg = aiConfig();
  const key = await apiKey();
  aiState = {
    polish: cfg.polish,
    propose: cfg.propose,
    ready: !!key,
    why: key
      ? ""
      : "No API key — run “Ramify: Set narration API key”, or set ANTHROPIC_API_KEY",
  };
  publishThemeColors();
}

/** One call. Returns the assistant's text plus the usage line the log wants. */
async function callModel({ system, user, maxTokens }) {
  const key = await apiKey();
  if (!key) throw new Error("no API key");
  const cfg = aiConfig();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": API_VERSION,
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    // The body can carry the key back in an error echo on some proxies, so
    // only the status is logged or surfaced.
    throw new Error(`API returned ${res.status}`);
  }
  const body = await res.json();
  const text = (body.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const u = body.usage || {};
  return { text, usage: `${u.input_tokens ?? "?"}→${u.output_tokens ?? "?"} tok` };
}

/** The model is asked for JSON and answers with JSON, but a preamble is always
 possible; take the outermost braces rather than trusting the whole body. */
function parseJsonBody(text) {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON in the reply");
  return JSON.parse(text.slice(a, b + 1));
}

function hashOf(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function writeResponse(name, payload) {
  fs.mkdirSync(REQUEST_DIR, { recursive: true });
  fs.writeFileSync(path.join(REQUEST_DIR, name), JSON.stringify(payload));
}

// THE CONSTRAINED PROMPT. Every clause is a restriction: rewrite, do not
// generate; keep the symbols; add no facts; one line per input, same order;
// JSON out. The states ride along as CONTEXT so the sentence can be made
// fluent, never as material to prove anything from.
const POLISH_SYSTEM = [
  "You rewrite templated sentences that describe steps of a Lean 4 proof into fluent mathematical English.",
  "Rules, all of them absolute:",
  "1. Rewrite only. Never state a fact, justification or conclusion that is not already in the sentence you were given.",
  "2. Keep every symbol, identifier, hypothesis name and lemma name exactly as written, character for character.",
  "3. One output line per input line, in the same order, with the same nodeId.",
  "4. Keep each line under 120 characters. No markdown, no numbering, no commentary.",
  "5. The goal states are context for phrasing only. Do not describe them beyond what the sentence already says.",
  'Reply with JSON only: {"lines":[{"nodeId":"…","text":"…"}]}',
].join("\n");

async function polish(req) {
  const lines = Array.isArray(req.lines) ? req.lines : [];
  const t0 = Date.now();
  const key = `polish:${req.proofKey || ""}:${hashOf(
    lines.map((l) => `${l.nodeId} ${l.template}`).join(""),
  )}`;
  const hit = memento && memento.get(key);
  if (hit) {
    say(`polish ${req.id}: ${lines.length} line(s) from cache`);
    writeResponse(POLISH_RESPONSE, { id: req.id, lines: hit });
    return;
  }
  if (lines.length === 0) {
    writeResponse(POLISH_RESPONSE, { id: req.id, lines: [] });
    return;
  }
  const { text, usage } = await callModel({
    system: POLISH_SYSTEM,
    user: JSON.stringify({
      lines: lines.map((l) => ({
        nodeId: l.nodeId,
        sentence: l.template,
        tactic: l.tactic,
        goalBefore: l.goalBefore,
        goalAfter: l.goalAfter,
      })),
    }),
    // Sized to the batch: the reply is one short sentence per line plus its
    // id, and the cap is a guard rather than a budget.
    maxTokens: Math.min(8192, 400 + 80 * lines.length),
  });
  const parsed = parseJsonBody(text);
  const wanted = new Set(lines.map((l) => l.nodeId));
  const out = (parsed.lines || [])
    .filter((l) => l && wanted.has(l.nodeId) && typeof l.text === "string")
    .map((l) => ({ nodeId: l.nodeId, text: l.text }));
  if (memento) await memento.update(key, out);
  say(
    `polish ${req.id}: ${lines.length} line(s) in, ${out.length} out, ` +
      `${Date.now() - t0}ms, ${usage}`,
  );
  writeResponse(POLISH_RESPONSE, { id: req.id, lines: out });
}

// D6. The agent CHOOSES; it never writes. The list it is given is the whole
// space of moves, each one already computed and already checkable, so the
// worst a bad answer can do is open a proposal the elaborator then rejects.
const PROPOSE_SYSTEM = [
  "You are helping a reader make a Lean 4 proof easier to read.",
  "You are given the proof's tree as text, and a numbered list of rewrites the tool already offers.",
  "Choose AT MOST ONE of the offered rewrites — the one that most improves readability — and say in one line why.",
  "You may not invent a rewrite, edit any text, or suggest anything not on the list.",
  'Reply with JSON only: {"index":<number from the list>,"reason":"…"} or {"index":-1,"reason":"…"} if none helps.',
].join("\n");

async function propose(req) {
  const prims = Array.isArray(req.primitives) ? req.primitives : [];
  const t0 = Date.now();
  if (prims.length === 0) {
    writeResponse(PROPOSE_RESPONSE, { id: req.id, note: "nothing offered" });
    return;
  }
  const { text, usage } = await callModel({
    system: PROPOSE_SYSTEM,
    user: [
      "PROOF:",
      String(req.text || "").slice(0, 8000),
      "",
      "OFFERED REWRITES:",
      ...prims.map((p, i) => `${i}. [${p.kind}] ${p.title}`),
    ].join("\n"),
    maxTokens: 512,
  });
  const parsed = parseJsonBody(text);
  const i = Number(parsed.index);
  const pick = Number.isInteger(i) && i >= 0 && i < prims.length ? prims[i] : null;
  say(
    `propose ${req.id}: ${prims.length} offered, ` +
      `${pick ? `chose ${i} (${pick.kind})` : "chose none"}, ` +
      `${Date.now() - t0}ms, ${usage}`,
  );
  writeResponse(
    PROPOSE_RESPONSE,
    pick
      ? {
          id: req.id,
          nodeId: pick.nodeId,
          kind: pick.kind,
          reason: String(parsed.reason || pick.title).slice(0, 200),
        }
      : { id: req.id, note: String(parsed.reason || "none chosen").slice(0, 200) },
  );
}

/** One handler for both channels: read the request, refuse it if the setting
 that gates it is off, run it, and write an `error` response on any failure so
 the widget's poll ends rather than timing out. */
function makeAiHandler(file, responseFile, gate, run) {
  let lastId = null;
  return async () => {
    let req;
    try {
      req = JSON.parse(fs.readFileSync(path.join(REQUEST_DIR, file), "utf8"));
    } catch {
      return;
    }
    if (!req || !req.id || req.id === lastId) return;
    lastId = req.id;
    try {
      if (!aiConfig()[gate])
        throw new Error(`ramify.${gate === "polish" ? "narration.polish" : "restructure.propose"} is off`);
      await run(req);
    } catch (e) {
      say(`${gate} ${req.id}: FAILED: ${e && e.message ? e.message : e}`);
      writeResponse(responseFile, {
        id: req.id,
        error: String(e && e.message ? e.message : e).slice(0, 200),
      });
    }
  };
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

    // `ramify.experience` is passed through as a NAME; the widget owns the
    // table (web/src/experience.ts) and fills only DEFAULTS from it. `inspect`
    // says whether the reader chose it, for the log line below.
    const expInfo = vscode.workspace
      .getConfiguration("ramify")
      .inspect("experience");
    const experience =
      expInfo?.workspaceFolderValue ??
      expInfo?.workspaceValue ??
      expInfo?.globalValue ??
      expInfo?.defaultValue ??
      "intermediate";
    const experienceSet =
      expInfo?.workspaceFolderValue !== undefined ||
      expInfo?.workspaceValue !== undefined ||
      expInfo?.globalValue !== undefined;

    // `ramify.hoverBar.*`: sent ONLY where the reader set it (`inspect()`), so
    // an unset list leaves the widget on the experience preset's default —
    // the setting wins where it exists, the preset where it does not.
    const explicit = (key) => {
      const i = vscode.workspace.getConfiguration("ramify").inspect(key);
      const v =
        i?.workspaceFolderValue ?? i?.workspaceValue ?? i?.globalValue;
      return Array.isArray(v) ? v.filter((x) => MOVE_IDS.includes(x)) : null;
    };
    const hoverBar = {
      tactic: explicit("hoverBar.tactic"),
      goal: explicit("hoverBar.goal"),
    };

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
          ai: aiState,
          experience,
          hoverBar,
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
        `hyp mark ${hypMarkStyle || "highlight"}, ` +
        `experience ${experience}${experienceSet ? "" : " (default)"}, ` +
        `hover bar tactic=${hoverBar.tactic ? hoverBar.tactic.join(",") : "(preset)"} ` +
        `goal=${hoverBar.goal ? hoverBar.goal.join(",") : "(preset)"}): ` +
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

// D1 EXTRACT → RENAME SYMBOL (2026-09-17). The widget has just written
// `have this : … := by …` and asks for VS Code's own Rename Symbol on that
// `this`, so the author types the name and Lean renames the binder and every
// use. Two things arrive asynchronously and both are WAITED FOR, bounded:
//  1. the TEXT — the widget's `applyEdit` reaches this document a moment
//     after the RPC that wrote the request file; poll until the range reads
//     `this` (RENAME_TEXT_WAIT_MS).
//  2. LEAN — measured with the LSP probe: right after the edit the server
//     answers rename from the PREVIOUS snapshot (null where nothing stood,
//     otherwise ranges of the OLD text: `thi`, `hxy `), and answers correctly
//     ~210 ms later on a small declaration, core or Mathlib alike. So poll
//     `vscode.prepareRename` until it returns exactly this range AND a dry-run
//     `vscode.executeDocumentRenameProvider` returns edits that all read
//     `this` in the current text, one of them the binder
//     (RENAME_READY_WAIT_MS). Only then is the rename box opened.
// Giving up at either stage leaves `this` — a valid file — and a log line.
const RENAME_TEXT_WAIT_MS = 2000;
const RENAME_READY_WAIT_MS = 10000;
const RENAME_POLL_MS = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function leanRenameReady(doc, range) {
  let prep;
  try {
    prep = await vscode.commands.executeCommand(
      "vscode.prepareRename",
      doc.uri,
      range.start,
    );
  } catch {
    return "prepareRename refused";
  }
  if (!prep || !prep.range) return "prepareRename: nothing";
  if (!prep.range.isEqual(range))
    return `prepareRename: stale range reads ${JSON.stringify(doc.getText(prep.range))}`;
  let we;
  try {
    we = await vscode.commands.executeCommand(
      "vscode.executeDocumentRenameProvider",
      doc.uri,
      range.start,
      "this_renamed",
    );
  } catch {
    return "rename provider refused";
  }
  const edits = we ? we.get(doc.uri) : [];
  if (!edits.length) return "rename: no edits";
  if (!edits.some((e) => e.range.isEqual(range))) return "rename: binder not among edits";
  const bad = edits.find((e) => doc.getText(e.range) !== "this");
  if (bad) return `rename: stale edit reads ${JSON.stringify(doc.getText(bad.range))}`;
  return null;
}

async function renameAfterHoist(req) {
  const tag = `rename ${req.nonce}`;
  if (!flag("restructure.renameAfterHoist", true)) {
    say(`${tag}: skipped — ramify.restructure.renameAfterHoist is off`);
    return;
  }
  const uri = vscode.Uri.parse(req.uri, true);
  const range = new vscode.Range(
    req.start.line,
    req.start.character,
    req.stop.line,
    req.stop.character,
  );
  const t0 = Date.now();
  const doc = await vscode.workspace.openTextDocument(uri);

  while (doc.getText(range) !== "this") {
    if (Date.now() - t0 > RENAME_TEXT_WAIT_MS) {
      say(
        `${tag}: gave up after ${Date.now() - t0}ms — text at ${range.start.line}:${range.start.character} reads ${JSON.stringify(doc.getText(range))}, not "this"`,
      );
      return;
    }
    await sleep(RENAME_POLL_MS);
  }
  const tText = Date.now() - t0;

  let why = "not asked";
  let polls = 0;
  const t1 = Date.now();
  for (;;) {
    if (doc.getText(range) !== "this") {
      say(`${tag}: the text moved while waiting for Lean — left as is`);
      return;
    }
    polls++;
    why = await leanRenameReady(doc, range);
    if (why === null) break;
    if (Date.now() - t1 > RENAME_READY_WAIT_MS) {
      say(`${tag}: text after ${tText}ms; Lean not ready after ${Date.now() - t1}ms (${polls} polls, last: ${why}) — gave up, \`this\` stays`);
      return;
    }
    await sleep(RENAME_POLL_MS);
  }
  say(`${tag}: text after ${tText}ms, Lean ready after ${Date.now() - t1}ms (${polls} polls)`);

  // Rename Symbol acts on the FOCUSED editor: prefer an ordinary editor on
  // this file over the lens, then the lens, then column one.
  const lens = findLensColumn(uri);
  const editors = vscode.window.visibleTextEditors.filter(
    (e) => e.document.uri.toString() === uri.toString(),
  );
  const main = editors.find((e) => e.viewColumn !== lens) ?? editors[0];
  const ed = await vscode.window.showTextDocument(doc, {
    viewColumn: main?.viewColumn ?? lens ?? vscode.ViewColumn.One,
    selection: new vscode.Selection(range.start, range.end),
    preserveFocus: false,
    preview: false,
  });
  ed.selection = new vscode.Selection(range.start, range.end);
  ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  await vscode.commands.executeCommand("editor.action.rename");
  say(`${tag}: Rename Symbol opened in column ${ed.viewColumn} after ${Date.now() - t0}ms`);
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

  // C4/D6 — the key lives in VS Code's own secret storage and nowhere else;
  // the cache is `globalState`, so re-opening a proof costs nothing.
  secrets = context.secrets;
  memento = context.globalState;
  context.subscriptions.push(
    vscode.commands.registerCommand("ramify.setNarrationKey", async () => {
      const v = await vscode.window.showInputBox({
        prompt: "Anthropic API key for Ramify's narration polish",
        placeHolder: "sk-ant-…  (leave empty to clear)",
        password: true,
        ignoreFocusOut: true,
      });
      if (v === undefined) return;
      if (v.trim() === "") {
        await context.secrets.delete(SECRET_KEY);
        void vscode.window.showInformationMessage("Ramify: narration API key cleared.");
      } else {
        await context.secrets.store(SECRET_KEY, v.trim());
        void vscode.window.showInformationMessage("Ramify: narration API key stored.");
      }
      say("narration API key updated");
      await refreshAi();
    }),
  );
  // `ramify.experience` as a quick pick — the setting is the whole state, so
  // the pick just writes it and the config listener republishes.
  context.subscriptions.push(
    vscode.commands.registerCommand("ramify.setExperience", async () => {
      const cur =
        vscode.workspace.getConfiguration("ramify").get("experience") ||
        "intermediate";
      const items = [
        {
          label: "beginner",
          detail:
            "The step under the cursor shows what its automation used · ⁇ on the tactic bar · narrated comments · full context · lints on",
        },
        {
          label: "intermediate",
          detail: "Comments shown · used context · lints on",
        },
        {
          label: "expert",
          detail: "Brief mode on · lints off",
        },
      ].map((i) => ({ ...i, description: i.label === cur ? "current" : "" }));
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder:
          "How much should the proof tree explain itself? (fills defaults only)",
      });
      if (!pick) return;
      // Write where the value that wins already lives: a workspace setting
      // would shadow a User-scope write and the pick would do nothing.
      const cfg = vscode.workspace.getConfiguration("ramify");
      const target =
        cfg.inspect("experience")?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
      await cfg.update("experience", pick.label, target);
      say(`experience set to ${pick.label}`);
    }),
  );
  context.subscriptions.push(
    context.secrets.onDidChange((e) => {
      if (e.key === SECRET_KEY) void refreshAi();
    }),
  );
  void refreshAi();

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
        e.affectsConfiguration("lean4.input")
      )
        publishThemeColors();
      // A `ramify` change can be one of the two AI gates, and those are
      // published through `refreshAi` (which re-reads the key and then
      // publishes), so it takes the whole namespace.
      else if (e.affectsConfiguration("ramify")) void refreshAi();
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
  let lastRenameNonce = null;
  const handleRename = async () => {
    let req;
    try {
      req = JSON.parse(
        fs.readFileSync(path.join(REQUEST_DIR, RENAME_REQUEST), "utf8"),
      );
    } catch {
      return;
    }
    if (!req || req.nonce === lastRenameNonce) return;
    const target = vscode.Uri.parse(req.uri, true);
    // A rename acts on a document this window has OPEN (it was just edited
    // here); another window's companion sees the same file and must not act.
    const open = vscode.workspace.textDocuments.some(
      (d) => d.uri.toString() === target.toString(),
    );
    if (!open) return;
    lastRenameNonce = req.nonce;
    say(`request ${req.nonce}: action=rename uri=${req.uri} at ${req.start.line}:${req.start.character}`);
    try {
      await renameAfterHoist(req);
    } catch (e) {
      say(`  rename FAILED: ${e && e.stack ? e.stack : e}`);
    }
  };
  // A `⋯`-menu pin: write the list where the value that wins already lives
  // (a Workspace value would shadow a User-scope write), as the experience
  // pick does. The config listener then republishes the theme file.
  let lastSettingsNonce = null;
  const handleSettings = async () => {
    let req;
    try {
      req = JSON.parse(
        fs.readFileSync(path.join(REQUEST_DIR, SETTINGS_REQUEST), "utf8"),
      );
    } catch {
      return;
    }
    if (!req || req.nonce === lastSettingsNonce) return;
    if (req.action !== "hoverbar") return;
    if (req.setting !== "tactic" && req.setting !== "goal") return;
    const target = vscode.Uri.parse(req.uri, true);
    const owned =
      !!vscode.workspace.getWorkspaceFolder(target) ||
      vscode.workspace.textDocuments.some(
        (d) => d.uri.toString() === target.toString(),
      );
    if (!owned) return;
    lastSettingsNonce = req.nonce;
    const ids = (req.values ?? []).filter((x) => MOVE_IDS.includes(x));
    const key = `hoverBar.${req.setting}`;
    const cfg = vscode.workspace.getConfiguration("ramify");
    const scope =
      cfg.inspect(key)?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    try {
      await cfg.update(key, ids, scope);
      say(`request ${req.nonce}: ramify.${key} = [${ids.join(", ")}]`);
    } catch (e) {
      say(`  hoverbar FAILED: ${e && e.stack ? e.stack : e}`);
    }
  };
  const handlePolish = makeAiHandler(
    POLISH_REQUEST,
    POLISH_RESPONSE,
    "polish",
    polish,
  );
  const handlePropose = makeAiHandler(
    PROPOSE_REQUEST,
    PROPOSE_RESPONSE,
    "propose",
    propose,
  );
  try {
    fs.mkdirSync(REQUEST_DIR, { recursive: true });
    const watcher = fs.watch(REQUEST_DIR, (_event, filename) => {
      if (filename === REQUEST_FILE) void handleRequest();
      else if (filename === RENAME_REQUEST) void handleRename();
      else if (filename === SETTINGS_REQUEST) void handleSettings();
      else if (filename === POLISH_REQUEST) void handlePolish();
      else if (filename === PROPOSE_REQUEST) void handlePropose();
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
