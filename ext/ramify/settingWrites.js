// THE SETTINGS BEHIND THE BAND (batch 5, 2026-10-04) — the extension's half.
//
// Pure CommonJS (no `vscode`), so node can load it to test it
// (web/probe/settings.mjs) and scripts/check-sync.mjs can compare it with
// package.json. web/src/viewSettings.ts is the widget's half; `probe
// settings` asserts the two tables equal.
//
//   SETTING_WRITES  every `ramify.<key>` a band / panel change may ask this
//                   extension to write (`settings-request.json`, action
//                   `setting`) — the ALLOW-LIST — with its value domain.
//   PREF_KEYS       the theme file's `prefs` name → the setting key, which
//                   `ramifySettings` publishes per folder.
"use strict";

const LAYOUTS = ["outline", "spine", "tracks", "wide"];
const CONTEXTS = ["used", "intro", "diff", "all"];
const COMMENTS = ["shown", "hidden", "instead", "narrate"];
// The Width slider's domain: `"full"`, or a column budget (web/src/layout.ts
// `REFLOW_MIN_CHARS` .. `REFLOW_MAX_CHARS`).
const WIDTH_MIN = 20;
const WIDTH_MAX = 100;

/** `ramify.<key>` → its domain: an array of the enum's values, or the kind. */
const SETTING_WRITES = {
  "view.layout": LAYOUTS,
  "view.sideBySide": "boolean",
  "view.gallery": "boolean",
  "view.width": "width",
  "view.context": CONTEXTS,
  "view.hypGroup": "boolean",
  "view.comments": COMMENTS,
  "reading.brief": "boolean",
  "reading.merge": "boolean",
  "reading.lints": "boolean",
  "reading.hypOrigins": "boolean",
  "reading.upToCursor": "boolean",
  "diagnostics.autoOpen": "boolean",
  appearance: ["vscode", "classic"],
};

/** The theme file's `prefs` key → `ramify.<key>` (every SETTING_WRITES key
 but `appearance`, which the theme file has carried on its own since the
 classic skin). */
const PREF_KEYS = {
  layout: "view.layout",
  sideBySide: "view.sideBySide",
  gallery: "view.gallery",
  width: "view.width",
  context: "view.context",
  hypGroup: "view.hypGroup",
  comments: "view.comments",
  brief: "reading.brief",
  merge: "reading.merge",
  lints: "reading.lints",
  hypOrigins: "reading.hypOrigins",
  upToCursor: "reading.upToCursor",
  autoOpen: "diagnostics.autoOpen",
};

/** Is `value` in the domain of `ramify.<key>`? False for a key that is not
 on the allow-list (an inherited name like `constructor` included). */
function validSetting(key, value) {
  if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(SETTING_WRITES, key))
    return false;
  const d = SETTING_WRITES[key];
  if (d === "boolean") return typeof value === "boolean";
  if (d === "width")
    return (
      value === "full" ||
      (typeof value === "number" && Number.isInteger(value) && value >= WIDTH_MIN && value <= WIDTH_MAX)
    );
  return typeof value === "string" && d.includes(value);
}

/** The `prefs` object for one resource: each key's value where the reader SET
 it and it is in its domain, else `null` (unset — the experience preset
 decides). `explicit(key)` is the set value of `ramify.<key>` or undefined
 (extension.js's `explicitValue(cfg.inspect(key))`). */
function readPrefs(explicit) {
  const out = {};
  for (const [name, key] of Object.entries(PREF_KEYS)) {
    const v = explicit(key);
    out[name] = validSetting(key, v) ? v : null;
  }
  return out;
}

module.exports = { SETTING_WRITES, PREF_KEYS, validSetting, readPrefs, WIDTH_MIN, WIDTH_MAX };
