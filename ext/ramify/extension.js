const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");

let log = null;
function say(msg) {
  if (log) log.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

const errText = (e) => (e && e.message ? e.message : String(e));
const errStack = (e) => (e && e.stack ? e.stack : String(e));

// ─── Request-file hygiene ──────────────────────────────────────────────────
// Everything in ~/.proof-tree-companion is written by another process (the Lean
// server) and is readable and writable by any other program of the user's, so
// every request is DATA: parsed under a guard, shape-checked before use, and a
// bad one is logged and dropped — it must never throw out of a watcher
// callback, and it must never reach a VS Code API as anything but the type it
// was checked to be.
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isCoord = (n) => Number.isInteger(n) && n >= 0 && n <= 0x7fffffff;
const isPos = (p) => isObj(p) && isCoord(p.line) && isCoord(p.character);
const str = (x, max) => (typeof x === "string" ? x.slice(0, max) : "");

/** A request file's JSON object, or null where it is absent, oversized, torn
 mid-write, unparseable or not an object. Silent: a half-written file is read
 whole on the next event. */
function readJsonFile(name) {
  try {
    const buf = fs.readFileSync(path.join(REQUEST_DIR, name));
    if (buf.length > MAX_REQUEST_BYTES) {
      say(`${name}: over ${MAX_REQUEST_BYTES} bytes — ignored`);
      return null;
    }
    const j = JSON.parse(buf.toString("utf8"));
    return isObj(j) ? j : null;
  } catch {
    return null;
  }
}

/** Write `payload` to `file` through a temp name and a rename, so a reader (the
 widget's poll, another window) never sees half a file; the temp name is unique
 per process and write, and the watcher ignores it (it dispatches on known
 files only). */
let writeSeq = 0;
function writeJsonAtomic(file, payload, space) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${writeSeq++}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(payload, null, space));
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw e;
  }
}

/** `req.uri` as a Uri, or null. */
function requestUri(req) {
  if (typeof req.uri !== "string" || req.uri.length === 0 || req.uri.length > 4096)
    return null;
  try {
    return vscode.Uri.parse(req.uri, true);
  } catch {
    return null;
  }
}

/** `req.start`/`req.stop` as a Range, or null unless both are {line, character}
 of finite non-negative integers. */
function requestRange(req) {
  if (!isPos(req.start) || !isPos(req.stop)) return null;
  return new vscode.Range(
    req.start.line,
    req.start.character,
    req.stop.line,
    req.stop.character,
  );
}

/** Nonces are numbers from the server's clock (or strings); anything else is
 not a request this side wrote. */
const validNonce = (n) =>
  (typeof n === "number" && Number.isFinite(n)) ||
  (typeof n === "string" && n.length > 0 && n.length <= 200);

// A Windows/macOS file system is case-insensitive by default, so the workspace
// comparison folds case there and only there.
const foldCase = (p) =>
  process.platform === "win32" || process.platform === "darwin" ? p.toLowerCase() : p;

/** Is a document with this uri open in this window? */
const isOpen = (uri) => {
  const key = uri.toString();
  return vscode.workspace.textDocuments.some((d) => d.uri.toString() === key);
};

/** Does THIS window act on a request about `target`? Either the document is
 open here, or it lies under one of this window's workspace folders. The folder
 test is on NORMALISED paths with a trailing separator, so `<root>/../elsewhere`
 and `<root>-sibling` are outside; a non-file uri falls back to VS Code's own
 folder lookup. */
function ownsUri(target) {
  if (isOpen(target)) return true;
  if (target.scheme !== "file") return !!vscode.workspace.getWorkspaceFolder(target);
  const t = foldCase(path.resolve(target.fsPath));
  return (vscode.workspace.workspaceFolders ?? []).some((f) => {
    if (f.uri.scheme !== "file") return false;
    const root = foldCase(path.resolve(f.uri.fsPath));
    return t === root || t.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  });
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
// The move ids a hover-bar list may hold — package.json's enums, and
// web/src/moves.ts `MOVE_IDS`. A list is per node KIND: an id that can never
// draw on that kind is not accepted (web/src/moveSlots.ts `appliesToKind`:
// `focus` is goal-only, `TACTIC_ONLY_MOVES` tactic-only). scripts/check-sync.mjs
// asserts all of it equal.
const MOVE_IDS = [
  "source", "focus", "skip", "path", "delete", "trace", "collapse",
  "expand", "inline", "extract", "lint", "lens", "goal",
];
const TACTIC_ONLY_MOVES = ["skip", "trace", "expand", "inline", "extract", "lens", "goal"];
const MOVE_IDS_FOR = {
  tactic: MOVE_IDS.filter((x) => x !== "focus"),
  goal: MOVE_IDS.filter((x) => !TACTIC_ONLY_MOVES.includes(x)),
};
/** `list` cut down to the ids a node of `kind` can draw, each once, in the
 order given. */
const idsFor = (kind, list) =>
  [...new Set(list)].filter((x) => MOVE_IDS_FOR[kind].includes(x));
// gen-experience:start (scripts/gen-experience.mjs — do not edit by hand)
const EXPERIENCE_DETAIL = {
  beginner: "Comments: narrate · Context: all · Brief: off · Lints: on · Hypothesis origins: on · Automation trace: opens by itself for the step under the cursor · Tactic hover bar: default, plus ⁇ · Replace with automation (⇓): not offered",
  intermediate: "Comments: show · Context: used · Brief: off · Lints: on · Hypothesis origins: off · Automation trace: on click · Tactic hover bar: default · Replace with automation (⇓): offered",
  expert: "Comments: show · Context: used · Brief: on · Lints: off · Hypothesis origins: off · Automation trace: on click · Tactic hover bar: default · Replace with automation (⇓): offered",
};
// gen-experience:end
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

function customizations(themeName, tokenBlob, semBlob) {
  const pick = (cfg) => {
    if (!cfg || typeof cfg !== "object") return [{}];
    const scoped = cfg[`[${themeName}]`];
    return scoped && typeof scoped === "object" ? [cfg, scoped] : [cfg];
  };
  const tm = [];
  for (const c of pick(tokenBlob))
    if (Array.isArray(c.textMateRules)) tm.push(...c.textMateRules);
  const sem = {};
  for (const c of pick(semBlob))
    if (c.rules && typeof c.rules === "object") Object.assign(sem, c.rules);
  return { tokenColors: tm, semanticTokenColors: sem };
}

function resolveTokenColors(file, custom) {
  const base = loadTheme(file);
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
const API_TIMEOUT_MS = 30000;
// Input caps: a request file is another process's data, and a model call is
// money. Over the cap the input is TRUNCATED (and logged), never refused — the
// first lines/primitives are the ones the widget lists first.
const MAX_POLISH_LINES = 200;
const MAX_PROPOSE_PRIMITIVES = 50;
const MAX_PROPOSE_TEXT = 8000;
// `globalState` answer cache: the most recent N entries, oldest evicted.
const CACHE_LIMIT = 200;
const CACHE_INDEX = "ramify.answerCache.index";

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
  let key = "";
  try {
    key = await apiKey();
  } catch (e) {
    say(`refreshAi: cannot read the key: ${errText(e)}`);
  }
  aiState = {
    polish: cfg.polish,
    propose: cfg.propose,
    ready: !!key,
    why: key
      ? ""
      : "No API key — run “Ramify: Set model API key”, or set ANTHROPIC_API_KEY",
  };
  publishThemeColors();
}

/** One call. Returns the assistant's text plus the usage line the log wants. */
async function callModel({ system, user, maxTokens }) {
  const key = await apiKey();
  if (!key) throw new Error("no API key");
  const cfg = aiConfig();
  let body;
  try {
    // The signal covers the body read too: a stalled connection ends the ask
    // (and the widget's poll gets its `error`) rather than hanging it.
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
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!res.ok) {
      // The body can carry the key back in an error echo on some proxies, so
      // only the status is logged or surfaced.
      throw new Error(`API returned ${res.status}`);
    }
    body = await res.json();
  } catch (e) {
    if (e && (e.name === "TimeoutError" || e.name === "AbortError"))
      throw new Error(`the model did not answer within ${API_TIMEOUT_MS / 1000}s`);
    throw e;
  }
  const text = (Array.isArray(body && body.content) ? body.content : [])
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  const u = (body && body.usage) || {};
  return { text, usage: `${u.input_tokens ?? "?"}→${u.output_tokens ?? "?"} tok` };
}

/** The model is asked for JSON and answers with JSON, but a preamble is always
 possible; take the outermost braces rather than trusting the whole body. */
function parseJsonBody(text) {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON in the reply");
  const j = JSON.parse(text.slice(a, b + 1));
  if (!isObj(j)) throw new Error("the reply is not a JSON object");
  return j;
}

/** Store an answer and evict the oldest past CACHE_LIMIT. The index is a list
 of keys in insertion order; where it does not exist yet (an install that
 cached before the bound did), it is seeded from the polish keys already there,
 in whatever order VS Code lists them. */
async function cachePut(key, value) {
  if (!memento) return;
  let index = memento.get(CACHE_INDEX);
  if (!Array.isArray(index))
    index = memento.keys().filter((k) => k.startsWith("polish:"));
  index = index.filter((k) => k !== key);
  index.push(key);
  const evicted = index.splice(0, Math.max(0, index.length - CACHE_LIMIT));
  await Promise.all([
    ...evicted.map((old) => memento.update(old, undefined)),
    memento.update(key, value),
    memento.update(CACHE_INDEX, index),
  ]);
}

function hashOf(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const writeResponse = (name, payload) =>
  writeJsonAtomic(path.join(REQUEST_DIR, name), payload);

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
  const raw = Array.isArray(req.lines) ? req.lines : [];
  if (raw.length > MAX_POLISH_LINES)
    say(`polish ${req.id}: ${raw.length} lines, truncated to ${MAX_POLISH_LINES}`);
  // Shape-checked and length-capped, so what is hashed, cached and sent is
  // exactly what was validated.
  const lines = raw
    .slice(0, MAX_POLISH_LINES)
    .filter((l) => isObj(l) && typeof l.nodeId === "string" && typeof l.template === "string")
    .map((l) => ({
      nodeId: str(l.nodeId, 200),
      template: str(l.template, 1000),
      tactic: str(l.tactic, 1000),
      goalBefore: str(l.goalBefore, 2000),
      goalAfter: str(l.goalAfter, 2000),
    }));
  const t0 = Date.now();
  // Same hash input as ever (NUL between id and template, \x01 between lines),
  // so answers cached by an earlier version still hit.
  const key = `polish:${str(req.proofKey, 200)}:${hashOf(
    lines.map((l) => `${l.nodeId}\0${l.template}`).join("\x01"),
  )}`;
  const hit = memento && memento.get(key);
  if (Array.isArray(hit)) {
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
  const out = (Array.isArray(parsed.lines) ? parsed.lines : [])
    .filter((l) => isObj(l) && wanted.has(l.nodeId) && typeof l.text === "string")
    .map((l) => ({ nodeId: l.nodeId, text: l.text.slice(0, 500) }));
  await cachePut(key, out);
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
  const rawPrims = Array.isArray(req.primitives) ? req.primitives : [];
  if (rawPrims.length > MAX_PROPOSE_PRIMITIVES)
    say(`propose ${req.id}: ${rawPrims.length} primitives, truncated to ${MAX_PROPOSE_PRIMITIVES}`);
  const prims = rawPrims
    .slice(0, MAX_PROPOSE_PRIMITIVES)
    .filter((p) => isObj(p) && typeof p.nodeId === "string" && typeof p.kind === "string")
    .map((p) => ({
      nodeId: str(p.nodeId, 200),
      kind: str(p.kind, 60),
      title: str(p.title, 300),
    }));
  const t0 = Date.now();
  if (prims.length === 0) {
    writeResponse(PROPOSE_RESPONSE, { id: req.id, note: "nothing offered" });
    return;
  }
  const { text, usage } = await callModel({
    system: PROPOSE_SYSTEM,
    user: [
      "PROOF:",
      str(req.text, MAX_PROPOSE_TEXT),
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

// OWNERSHIP FOR THE MODEL CHANNELS. Unlike the other requests these carry no
// uri (only an id, the declaration name and the lines), so the "does this
// window own the document" test has nothing to read, and with several VS Code
// windows open every one of them would make the same paid call. The rule:
//  1. only a window with a Lean document open is eligible (a window with none
//     cannot have hosted the widget that asked);
//  2. among those, the window the user is in — `window.state.focused` — has the
//     first go, and an unfocused one yields AI_CLAIM_YIELD_MS before trying;
//  3. whoever then creates the per-request claim file (`wx`, atomic across
//     processes) answers; every other window drops the request.
// So exactly one window answers, the focused one whenever there is one. If the
// claim directory cannot be written the window answers anyway: a doubled call
// costs a few cents, a dead feature costs the feature.
const CLAIM_DIR = path.join(REQUEST_DIR, "ai-claims");
const AI_CLAIM_YIELD_MS = 150;
const CLAIM_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function claimAiRequest(channel, id) {
  const hasLean = vscode.workspace.textDocuments.some(
    (d) => d.languageId === "lean4" || d.languageId === "lean",
  );
  if (!hasLean) return false;
  if (!vscode.window.state.focused) await sleep(AI_CLAIM_YIELD_MS);
  try {
    fs.mkdirSync(CLAIM_DIR, { recursive: true });
    const name = `${channel}-${id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100)}`;
    fs.closeSync(fs.openSync(path.join(CLAIM_DIR, name), "wx"));
    return true;
  } catch (e) {
    if (e && e.code === "EEXIST") return false;
    say(`${channel}: claim failed (${errText(e)}) — answering anyway`);
    return true;
  }
}

/** Claims older than a day are dead weight; ids are minted per widget session. */
function pruneClaims() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(CLAIM_DIR)) {
      const file = path.join(CLAIM_DIR, f);
      if (now - fs.statSync(file).mtimeMs > CLAIM_MAX_AGE_MS) fs.unlinkSync(file);
    }
  } catch {}
}

/** One request-file handler. Every request is DATA from another process, so
 the shape is fixed here and each channel supplies only what differs:
   file, tag   the request file and the word its log lines open with;
   key         the field that identifies a write (`nonce`, or `id` for the model
               channels) and `validKey`, what counts as one;
   check(req)  a string (why the request is dropped, logged) or the ctx that
               `owns` and `run` take; may put `what` in it to be logged once the
               request is accepted;
   owns(ctx, req)  does THIS window act on it (may be async);
   run(req, ctx)   does the work; a throw goes to `fail(e, req, ctx)`, else it is
               logged with its stack.
 A write is handled once: the key is consumed before the ownership test, so a
 re-read of the same write (the watcher may deliver it again) is a no-op in
 every window. Nothing needs a guard of its own: the watcher's `run` logs any
 rejection that does escape. */
function makeHandler({ tag, file, key = "nonce", validKey = validNonce, check, owns, run, fail }) {
  let last = null;
  return async () => {
    const req = readJsonFile(file);
    if (!req) return;
    const id = req[key];
    if (!validKey(id)) {
      say(`${tag}: no usable ${key} — ignored`);
      return;
    }
    if (id === last) return;
    last = id;
    const ctx = check ? check(req) : {};
    if (typeof ctx === "string") {
      say(`${tag} ${id}: ${ctx} — ignored`);
      return;
    }
    if (!(await owns(ctx, req))) {
      say(`${tag} ${id}: left to another window`);
      return;
    }
    if (ctx.what) say(`${tag} ${id}: ${ctx.what}`);
    try {
      await run(req, ctx);
    } catch (e) {
      if (fail) fail(e, req, ctx);
      else say(`${tag} ${id}: FAILED: ${errStack(e)}`);
    }
  };
}

/** The model channels: refuse the request if the setting that gates it is off
 (checked by the window that claimed, so its `error` answer is the only one
 written and the widget's poll ends at once), and write an `error` response on
 any failure so the poll ends rather than timing out. */
function makeAiHandler(gate, file, responseFile, run) {
  return makeHandler({
    tag: gate,
    file,
    key: "id",
    validKey: (id) => typeof id === "string" && id.length > 0 && id.length <= 200,
    owns: (_, req) => claimAiRequest(gate, req.id),
    run: async (req) => {
      if (!aiConfig()[gate])
        throw new Error(`ramify.${gate === "polish" ? "narration.polish" : "restructure.propose"} is off`);
      await run(req);
    },
    fail: (e, req) => {
      say(`${gate} ${req.id}: FAILED: ${errText(e)}`);
      writeResponse(responseFile, { id: req.id, error: errText(e).slice(0, 200) });
    },
  });
}

/** What each `popout-request.json` action does. `range`: it addresses text, so
 `start`/`stop` must be a Range; `chatty`: it fires on every hover and is not
 logged. This table is the validation, the logging and the dispatch. */
const ACTIONS = {
  highlight: { range: true, chatty: true, run: (t, r) => highlight(t, r) },
  clear: { chatty: true, run: () => highlight(null, null) },
  preview: { range: true, chatty: true, run: (t, r) => preview(t, r) },
  "preview-clear": { chatty: true, run: () => preview(null, null) },
  annotate: { chatty: true, run: (t, _r, anns) => annotate(t, anns) },
  undo: { run: (t) => runEditorCommand(t, "undo") },
  redo: { run: (t) => runEditorCommand(t, "redo") },
  reveal: {
    range: true,
    run: async (t, r, anns) => {
      await reveal(t, r);
      annotate(t, anns);
    },
  },
  popout: {
    range: true,
    run: async (t, r, anns) => {
      await popout(t, r);
      annotate(t, anns);
    },
  },
};

const handleRequest = makeHandler({
  tag: "request",
  file: REQUEST_FILE,
  check: (req) => {
    const target = requestUri(req);
    if (!target) return "bad uri";
    const action = req.action === undefined || req.action === "" ? "popout" : req.action;
    if (typeof action !== "string" || !Object.hasOwn(ACTIONS, action))
      return `unknown action ${JSON.stringify(String(action).slice(0, 40))}`;
    const def = ACTIONS[action];
    const range = requestRange(req);
    if (def.range && !range)
      return `${action}: start/stop are not {line, character} non-negative integers`;
    return {
      target,
      action,
      def,
      range,
      annotations: Array.isArray(req.annotations) ? req.annotations : [],
      what: def.chatty ? null : `action=${action} uri=${target.toString()}`,
    };
  },
  owns: (ctx) => ownsUri(ctx.target),
  run: async (req, { target, def, range, annotations }) => {
    await def.run(target, range, annotations);
    if (!def.chatty) say(`request ${req.nonce}: done`);
  },
  fail: (e, req, { action }) => {
    say(`request ${req.nonce}: FAILED: ${errStack(e)}`);
    void vscode.window.showErrorMessage(`Ramify: ${action} failed: ${errText(e)}`);
  },
});

// A rename acts on a document this window has OPEN (it was just edited here);
// another window's companion sees the same file and must not act.
const handleRename = makeHandler({
  tag: "rename",
  file: RENAME_REQUEST,
  check: (req) => {
    const target = requestUri(req);
    const range = requestRange(req);
    if (!target || !range) return "bad uri or range";
    return {
      target,
      range,
      what: `action=rename uri=${target.toString()} at ${range.start.line}:${range.start.character}`,
    };
  },
  owns: (ctx) => isOpen(ctx.target),
  run: (req, ctx) => renameAfterHoist(ctx.target, ctx.range, req.nonce),
});

// A `⋯`-menu pin: write the list where the value that wins already lives (a
// Workspace value would shadow a User-scope write), as the experience pick
// does. The config listener then republishes the theme file.
const handleSettings = makeHandler({
  tag: "settings",
  file: SETTINGS_REQUEST,
  check: (req) => {
    if (req.action !== "hoverbar") return "unknown action";
    const kind = req.setting;
    if (kind !== "tactic" && kind !== "goal") return "unknown setting";
    const target = requestUri(req);
    if (!target) return "bad uri";
    if (!Array.isArray(req.values)) return "values is not an array";
    return { target, kind, ids: idsFor(kind, req.values) };
  },
  owns: (ctx) => ownsUri(ctx.target),
  run: async (req, { target, kind, ids }) => {
    const key = `hoverBar.${kind}`;
    await vscode.workspace
      .getConfiguration("ramify", target)
      .update(key, ids, writeTarget(key, target));
    say(`settings ${req.nonce}: ramify.${key} = [${ids.join(", ")}]`);
  },
});

const handlePolish = makeAiHandler("polish", POLISH_REQUEST, POLISH_RESPONSE, polish);
const handlePropose = makeAiHandler("propose", PROPOSE_REQUEST, PROPOSE_RESPONSE, propose);

// Stamped into the theme file so the widget can tell a LIVE companion from a
// file an uninstalled one left behind (which carried nothing to tell by).
// `companionAt` is the activation time, never the publish time: a publish that
// changed nothing must leave the file byte-identical, so it can be skipped.
let companionVersion = "";
let companionAt = 0;

const SETTING_LEVELS = [
  ["workspaceFolderValue", () => vscode.ConfigurationTarget.WorkspaceFolder],
  ["workspaceValue", () => vscode.ConfigurationTarget.Workspace],
  ["globalValue", () => vscode.ConfigurationTarget.Global],
];
/** The `inspect()` level that holds the value that wins, if the reader set one. */
const explicitLevel = (info) => SETTING_LEVELS.find(([k]) => info?.[k] !== undefined);
/** The value the reader set (folder, else workspace, else user), or undefined. */
const explicitValue = (info) => {
  const l = explicitLevel(info);
  return l ? info[l[0]] : undefined;
};

/** Every `ramify.*` setting the widget reads, in the theme file's own names,
 as they stand for one resource (a workspace folder's uri; `undefined` is the
 window's own view). `experience` is a NAME (the widget owns the table and
 fills only defaults from it); `hoverBar` lists are sent ONLY where the reader
 set them, each cut down to the ids its kind can draw, so an unset list leaves
 the widget on the preset's default. `experienceSet` is for the log alone. */
function ramifySettings(resource) {
  const cfg = vscode.workspace.getConfiguration("ramify", resource);
  const expInfo = cfg.inspect("experience");
  const explicitBar = (kind) => {
    const v = explicitValue(cfg.inspect(`hoverBar.${kind}`));
    return Array.isArray(v) ? idsFor(kind, v) : null;
  };
  return {
    outline: cfg.get("outlineOnly") === true,
    linkTint: cfg.get("linkTint") === true,
    linkMarks: cfg.get("linkMarks") === true,
    typingHoldMs: cfg.get("typingHoldMs"),
    counterfactual: cfg.get("counterfactual") !== false,
    hypMarkStyle: cfg.get("hypMarkStyle"),
    experience: explicitValue(expInfo) ?? expInfo?.defaultValue ?? "intermediate",
    appearance: cfg.get("appearance") === "classic" ? "classic" : "vscode",
    experienceSet: explicitValue(expInfo) !== undefined,
    hoverBar: { tactic: explicitBar("tactic"), goal: explicitBar("goal") },
  };
}

/** Where a write to `ramify.<key>` must go to take effect: the level that
 already holds the value that wins (a Workspace or Folder value would shadow a
 User-scope write), else User. */
function writeTarget(key, resource) {
  const info = vscode.workspace.getConfiguration("ramify", resource).inspect(key);
  const l = explicitLevel(info);
  return l ? l[1]() : vscode.ConfigurationTarget.Global;
}

/** The token colours the theme gives the six kinds the widget paints, cached on
 what they are computed from: the theme's name and the two customisation blobs.
 A `ramify.*` change (and every publish that is not a theme change) re-reads
 neither the theme's JSON nor the extension list. A theme file that cannot be
 found is not cached, so it is looked for again. */
let tokenColorCache = { key: null, colors: null };
function tokenColors(themeName) {
  const ed = vscode.workspace.getConfiguration("editor");
  const tokenBlob = ed.get("tokenColorCustomizations");
  const semBlob = ed.get("semanticTokenColorCustomizations");
  const key = JSON.stringify([themeName, tokenBlob, semBlob]);
  if (tokenColorCache.key === key) return tokenColorCache.colors;
  const file = activeThemeFile();
  const colors = resolveTokenColors(file, customizations(themeName, tokenBlob, semBlob));
  tokenColorCache = file ? { key, colors } : { key: null, colors: null };
  return colors;
}

function publishThemeColors() {
  try {
    const name = vscode.workspace.getConfiguration("workbench").get("colorTheme");
    const colors = tokenColors(name);
    const brackets =
      vscode.workspace
        .getConfiguration("editor")
        .get("bracketPairColorization.enabled") !== false;

    // The top-level values are this window's own view; `byFolder` carries one
    // entry per workspace folder with the same keys, which the Lean side lays
    // over the top level for a document under that folder, so a workspace
    // setting in one window does not leak into another's.
    const { experienceSet, ...top } = ramifySettings(undefined);
    const mine = {};
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      if (f.uri.scheme !== "file") continue;
      const { experienceSet: _, ...entry } = ramifySettings(f.uri);
      mine[path.resolve(f.uri.fsPath)] = entry;
    }
    // Read-modify-write: another window's folders keep their entries, this
    // window replaces only its own. (Two windows publishing in the same
    // instant can lose one entry until its next publish; the rename is atomic
    // so the file itself is never torn.)
    const prior = readJsonFile("theme-colors.json");
    const byFolder = {};
    if (prior && isObj(prior.byFolder))
      for (const [k, v] of Object.entries(prior.byFolder))
        if (isObj(v)) byFolder[k] = v;
    Object.assign(byFolder, mine);

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

    const payload = {
      theme: name,
      brackets,
      ...top,
      input,
      ai: aiState,
      byFolder,
      companion: { version: companionVersion, pid: process.pid, at: companionAt },
      colors: Object.keys(colors).map((type) => ({ type, color: colors[type] })),
    };
    // Compared with what is ON DISK, not with what this window last wrote: the
    // file is shared, and another window may have replaced it since.
    if (prior && JSON.stringify(prior, null, 1) === JSON.stringify(payload, null, 1)) return;
    writeJsonAtomic(THEME_FILE, payload, 1);

    const { hoverBar } = top;
    say(
      `theme "${name}" (brackets ${brackets ? "on" : "off"}, ` +
        `outline ${top.outline ? "on" : "off"}, ` +
        `link tint ${top.linkTint ? "on" : "off"}, ` +
        `link marks ${top.linkMarks ? "on" : "off"}, ` +
        `typing hold ${top.typingHoldMs}ms, ` +
        `counterfactual ${top.counterfactual ? "on" : "off"}, ` +
        `hyp mark ${top.hypMarkStyle || "highlight"}, ` +
        `experience ${top.experience}${experienceSet ? "" : " (default)"}, ` +
        `hover bar tactic=${hoverBar.tactic ? hoverBar.tactic.join(",") : "(preset)"} ` +
        `goal=${hoverBar.goal ? hoverBar.goal.join(",") : "(preset)"}): ` +
        Object.keys(colors)
          .map((t) => `${t}=${colors[t]}`)
          .join(" "),
    );
  } catch (e) {
    say(`theme colours failed: ${errText(e)}`);
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

const readChromeBackup = () => readJsonFile(path.basename(CHROME_BACKUP));

/** The pid a backup names, or 0. `process.kill(0)` and a negative pid address
 a process GROUP, so only a positive integer is ever probed. */
function backupPid(prior) {
  return prior && Number.isInteger(prior.pid) && prior.pid > 0 ? prior.pid : 0;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The `originals` of a backup file, cut down to what this module may write
 back: ONLY the STRIP_KEYS, each `null` (was unset) or a value of the type
 STATIC_STRIP gives that key. The file lives where any program of the user's
 can edit it, and each surviving entry becomes a `cfg.update(Global)` — so an
 unknown key, or a known one with the wrong type, is dropped and logged rather
 than written into the user's settings. */
function sanitiseOriginals(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const key of STRIP_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const v = raw[key];
    if (v === null || typeof v === typeof STATIC_STRIP[key]) out[key] = v;
    else say(`chrome backup: ignoring ${key} (unexpected ${typeof v})`);
  }
  for (const key of Object.keys(raw))
    if (!STRIP_KEYS.includes(key)) say(`chrome backup: ignoring unknown key ${JSON.stringify(key)}`);
  return out;
}

async function stripEditorChrome() {
  if (strippedOriginals) return;
  const cfg = vscode.workspace.getConfiguration();

  const prior = readChromeBackup();
  let originals;
  if (prior && backupPid(prior) !== process.pid && pidAlive(backupPid(prior))) {
    originals = sanitiseOriginals(prior.originals);
  } else {
    originals = {};
    for (const key of STRIP_KEYS) {
      originals[key] = cfg.inspect(key)?.globalValue ?? null;
    }
  }
  strippedOriginals = originals;
  try {
    writeJsonAtomic(CHROME_BACKUP, { pid: process.pid, originals });
  } catch (e) {
    say(`chrome backup not written: ${errText(e)}`);
  }
  for (const [key, val] of Object.entries(STATIC_STRIP)) {
    try {
      await cfg.update(key, val, vscode.ConfigurationTarget.Global);
    } catch (e) {
      say(`chrome: cannot set ${key}: ${errText(e)}`);
    }
  }
}

async function restoreEditorChrome(fromDisk) {
  try {
    let originals = strippedOriginals;
    if (!originals && fromDisk) {
      const prior = readChromeBackup();
      // A dead pid means the window that stripped is gone (VS Code quit or
      // crashed with the lens open); a live one still owns its strip.
      if (prior && !pidAlive(backupPid(prior))) originals = sanitiseOriginals(prior.originals);
    }
    if (!originals) return;
    strippedOriginals = null;
    const cfg = vscode.workspace.getConfiguration();
    let failed = false;
    for (const key of STRIP_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(originals, key)) continue;
      const orig = originals[key];
      try {
        await cfg.update(
          key,
          orig === null ? undefined : orig,
          vscode.ConfigurationTarget.Global,
        );
      } catch (e) {
        failed = true;
        say(`chrome: cannot restore ${key}: ${errText(e)}`);
      }
    }
    // A backup that could not be fully applied stays, so the next start tries
    // again.
    if (failed) return;
    try {
      fs.unlinkSync(CHROME_BACKUP);
    } catch {}
  } catch (e) {
    say(`restoreEditorChrome failed: ${errStack(e)}`);
  }
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

const MAX_ANNOTATIONS = 5000;

function annotate(uri, items) {
  const ed = lensEditor(uri);
  if (!ed) return;
  if (!flag("lensGoals", true)) {
    ed.setDecorations(goalDecoration, []);
    return;
  }
  const opts = [];
  for (const a of items.slice(0, MAX_ANNOTATIONS)) {
    if (!isObj(a) || !Number.isInteger(a.line) || a.line < 0 || a.line >= ed.document.lineCount)
      continue;
    if (typeof a.text !== "string") continue;
    const end = ed.document.lineAt(a.line).range.end;
    opts.push({
      range: new vscode.Range(end, end),
      renderOptions: { after: { contentText: a.text.slice(0, 2000) } },
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
      "Ramify: Open the Lean infoview first, then run Ramify: Open Tactic in Lens",
    );
    return;
  }

  await vscode.commands.executeCommand(focusCmd);
  await vscode.commands.executeCommand("workbench.action.newGroupBelow");
  lensColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
  say(`  popout: lens opened in column ${lensColumn}`);

  await sizeLens(lensColumn);
  await showInLens(doc, selection, lensColumn);
  // `ramify.lensHideChrome` (default on): off leaves tabs, breadcrumbs, the
  // minimap and sticky scroll as the reader has them. A strip already in force
  // is still undone when the lens closes.
  if (flag("lensHideChrome", true)) await stripEditorChrome();
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

async function renameAfterHoist(uri, range, nonce) {
  const tag = `rename ${nonce}`;
  if (!flag("restructure.renameAfterHoist", true)) {
    say(`${tag}: skipped — ramify.restructure.renameAfterHoist is off`);
    return;
  }
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
  companionVersion = String(context.extension?.packageJSON?.version ?? "0");
  companionAt = Date.now();
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

  // Undo a strip left by a window that quit (or died) with the lens open. Runs
  // when the first Lean file opens — see `activationEvents`.
  restoreEditorChrome(true).catch((e) => say(`restore on start: ${errText(e)}`));
  pruneClaims();

  // C4/D6 — the key lives in VS Code's own secret storage and nowhere else;
  // the cache is `globalState`, so re-opening a proof costs nothing.
  secrets = context.secrets;
  memento = context.globalState;
  context.subscriptions.push(
    vscode.commands.registerCommand("ramify.setNarrationKey", async () => {
      const v = await vscode.window.showInputBox({
        prompt: "Anthropic API key for Ramify's model features (polish and suggest a rewrite)",
        placeHolder: "sk-ant-…  (leave empty to clear)",
        password: true,
        ignoreFocusOut: true,
      });
      if (v === undefined) return;
      if (v.trim() === "") {
        await context.secrets.delete(SECRET_KEY);
        void vscode.window.showInformationMessage("Ramify: model API key cleared");
      } else {
        await context.secrets.store(SECRET_KEY, v.trim());
        void vscode.window.showInformationMessage("Ramify: model API key stored");
      }
      say("model API key updated");
      await refreshAi();
    }),
  );
  // `ramify.experience` as a quick pick — the setting is the whole state, so
  // the pick just writes it and the config listener republishes.
  context.subscriptions.push(
    vscode.commands.registerCommand("ramify.setExperience", async () => {
      const cur =
        vscode.workspace
          .getConfiguration(
            "ramify",
            vscode.window.activeTextEditor?.document.uri ??
              vscode.workspace.workspaceFolders?.[0]?.uri,
          )
          .get("experience") || "intermediate";
      const items = ["beginner", "intermediate", "expert"].map((label) => ({
        label,
        detail: EXPERIENCE_DETAIL[label],
        description: label === cur ? "current" : "",
      }));
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder:
          "How much should the proof tree explain itself? (fills defaults only)",
      });
      if (!pick) return;
      // Write where the value that wins already lives: a workspace setting
      // would shadow a User-scope write and the pick would do nothing.
      const resource =
        vscode.window.activeTextEditor?.document.uri ??
        vscode.workspace.workspaceFolders?.[0]?.uri;
      const cfg = vscode.workspace.getConfiguration("ramify", resource);
      await cfg.update("experience", pick.label, writeTarget("experience", resource));
      say(`experience set to ${pick.label}`);
    }),
  );
  context.subscriptions.push(
    context.secrets.onDidChange((e) => {
      if (e.key === SECRET_KEY)
        refreshAi().catch((err) => say(`refreshAi: ${errText(err)}`));
    }),
  );
  refreshAi().catch((e) => say(`refreshAi: ${errText(e)}`));

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => publishThemeColors()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => publishThemeColors()),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      const themeChanged =
        e.affectsConfiguration("workbench.colorTheme") ||
        e.affectsConfiguration("editor.tokenColorCustomizations") ||
        e.affectsConfiguration("editor.semanticTokenColorCustomizations") ||
        e.affectsConfiguration("editor.bracketPairColorization.enabled") ||
        e.affectsConfiguration("lean4.input");
      // A `ramify` change can be one of the two AI gates, and those are
      // published through `refreshAi` (which re-reads the key and then calls
      // `publishThemeColors` itself), so it takes the whole namespace. The two
      // are independent: one event touching both refreshes both, and where
      // `refreshAi` runs it is the publisher, so the file is written once.
      const ramifyChanged = e.affectsConfiguration("ramify");
      if (ramifyChanged)
        refreshAi().catch((err) => say(`refreshAi: ${errText(err)}`));
      else if (themeChanged) publishThemeColors();
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
      restoreEditorChrome(false).catch((e) => say(`restore on close: ${errText(e)}`));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ramify.openLens", async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) {
        void vscode.window.showErrorMessage(
          "Ramify: no active editor to open in the lens",
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

  // The watcher. `fs.watch` fires two or three events per write (and one per
  // rename of the temp file a response lands through), and two DISTINCT writes
  // can land inside a few ms (a `popout`, then the hover's `clear`), so there
  // is no debounce: every event on a known file reads the file, and writes are
  // atomic, so a read sees a whole write. Two things keep that cheap and
  // harmless: every handler dedupes on nonce/id (a read of a write it has
  // already handled is a no-op), and a `stat` signature — inode, mtime, size;
  // a rename lands a new inode — skips the read when the file is the one the
  // last event already read.
  const handlers = new Map([
    [REQUEST_FILE, handleRequest],
    [RENAME_REQUEST, handleRename],
    [SETTINGS_REQUEST, handleSettings],
    [POLISH_REQUEST, handlePolish],
    [PROPOSE_REQUEST, handlePropose],
  ]);
  const lastRead = new Map(); // filename -> stat signature of the last read
  const dispatch = (filename) => {
    const h = handlers.get(filename);
    if (!h) return;
    let sig;
    try {
      const st = fs.statSync(path.join(REQUEST_DIR, filename));
      sig = `${st.ino}:${st.mtimeMs}:${st.size}`;
    } catch {
      lastRead.delete(filename);
      return;
    }
    if (lastRead.get(filename) === sig) return;
    lastRead.set(filename, sig);
    h().catch((e) => say(`${filename}: handler rejected: ${errText(e)}`));
  };

  // Re-arming: an `error` (the directory removed or its volume gone, EMFILE,
  // a network home) closes the watcher for good, and without a new one the
  // companion goes silently deaf. So: log, close, and try again after a
  // backoff that doubles from 1 s to 30 s and resets only once an event has
  // actually arrived — a watcher that errors at once every time is retried
  // ever more slowly, never in a spin.
  let watcher = null;
  let disposed = false;
  let retryTimer = null;
  let backoffMs = 0;
  let warned = false;
  const rearm = (why) => {
    if (watcher) {
      try {
        watcher.close();
      } catch {}
      watcher = null;
    }
    if (disposed || retryTimer) return;
    backoffMs = backoffMs ? Math.min(backoffMs * 2, 30000) : 1000;
    say(`watcher: ${why} — retrying in ${backoffMs}ms`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      arm();
    }, backoffMs);
  };
  const arm = () => {
    try {
      fs.mkdirSync(REQUEST_DIR, { recursive: true });
      watcher = fs.watch(REQUEST_DIR, (event, filename) => {
        backoffMs = 0;
        // A rename with the directory gone is the directory being removed.
        if (event === "rename" && !fs.existsSync(REQUEST_DIR)) {
          rearm("the request directory disappeared");
          return;
        }
        // Some platforms give no filename; every handler dedupes, so ask all.
        if (typeof filename !== "string") for (const f of handlers.keys()) dispatch(f);
        else dispatch(filename);
      });
      watcher.on("error", (e) => rearm(`error: ${errText(e)}`));
      say("watcher started");
    } catch (e) {
      if (!warned) {
        warned = true;
        void vscode.window.showErrorMessage(
          `Ramify: request watcher failed to start: ${errText(e)} — reload the window to retry`,
        );
      }
      rearm(`failed to start: ${errText(e)}`);
    }
  };
  arm();
  context.subscriptions.push({
    dispose: () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (watcher) watcher.close();
    },
  });
}

function deactivate() {
  // restoreEditorChrome guards itself and never rejects.
  return restoreEditorChrome(false);
}

module.exports = { activate, deactivate };
