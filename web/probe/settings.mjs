// @probe
// The SETTINGS BEHIND THE BAND (batch 5): the widget's table
// (web/src/viewSettings.ts) against the companion's allow-list
// (ext/ramify/settingWrites.js, loaded as the extension loads it), and the
// companion's validation run offline.  Run:   npm run probe -- settings
//
// Checks: the two tables name the same keys with the same domains; every view
// value the band can produce becomes a setting value the companion accepts and
// parses back to itself; the companion refuses every key off the list and
// every value outside its domain; `readPrefs` publishes only set, valid values
// (else null) and the widget reads null / junk as unset; the retuned presets.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SETTING_KEY, SETTING_DOMAIN, LAYOUT_SETTING, CONTEXT_SETTING, COMMENTS_SETTING,
  parseViewSettings, settingValue, parseSettingsQuery, PRESETS, READING_OPTIONS, readingOn,
} from "./lib.mjs";
import { tally } from "./corpus.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const sw = require(path.resolve(here, "../../ext/ramify/settingWrites.js"));
const t = tally();
const json = (x) => JSON.stringify(x);

// 1. One table, two languages.
const webKeys = Object.values(SETTING_KEY).sort();
t.eq(json(webKeys), json(Object.keys(sw.SETTING_WRITES).sort()), "allow-list = viewSettings.ts SETTING_KEY");
const prefIds = Object.keys(SETTING_KEY).filter((k) => k !== "appearance");
t.eq(json(Object.entries(sw.PREF_KEYS).sort()), json(prefIds.map((k) => [k, SETTING_KEY[k]]).sort()), "PREF_KEYS = SETTING_KEY minus appearance");
for (const [id, key] of Object.entries(SETTING_KEY))
  t.eq(json(SETTING_DOMAIN[id]), json(sw.SETTING_WRITES[key]), `domain of ${key}`);

// 2. Every value the band can produce round-trips.
const views = {
  layout: Object.keys(LAYOUT_SETTING),
  context: Object.keys(CONTEXT_SETTING),
  comments: Object.keys(COMMENTS_SETTING),
  width: ["off", 20, 44, 100],
  appearance: ["vscode", "classic"],
};
let trips = 0;
for (const id of Object.keys(SETTING_KEY)) {
  const vals = views[id] ?? [true, false];
  for (const v of vals) {
    const sv = settingValue(id, v);
    t.ok(sw.validSetting(SETTING_KEY[id], sv), `companion refuses ${SETTING_KEY[id]} = ${json(sv)} (from ${json(v)})`);
    if (id !== "appearance") t.eq(json(parseViewSettings({ [id]: sv })[id]), json(v), `round trip ${id} ${json(v)}`);
    trips++;
  }
}

// 3. The allow-list refuses.
const refused = [
  ["outlineOnly", true], ["hoverBar.tactic", ["source"]], ["experience", "beginner"],
  ["constructor", true], ["__proto__", true], ["toString", "x"], [undefined, true], [42, true],
  ["narration.polish", true], ["restructure.propose", true],
  ["view.layout", "stacked"], ["view.layout", true], ["view.layout", null],
  ["view.context", "full"], ["view.comments", "in place"], ["view.comments", "show"],
  ["view.width", 19], ["view.width", 101], ["view.width", 44.5], ["view.width", "44"], ["view.width", "off"],
  ["reading.brief", "true"], ["reading.brief", 1], ["diagnostics.autoOpen", null], ["appearance", "dark"],
];
for (const [k, v] of refused) t.ok(!sw.validSetting(k, v), `companion accepts ${json(k)} = ${json(v)}`);

// 4. Publishing and reading: only set, valid values; null / junk is unset.
const set = { "view.layout": "wide", "view.width": 7, "reading.brief": "yes", "diagnostics.autoOpen": false };
const prefs = sw.readPrefs((k) => set[k]);
t.eq(prefs.layout, "wide", "readPrefs keeps a valid set value");
t.eq(prefs.width, null, "readPrefs drops an out-of-range width");
t.eq(prefs.brief, null, "readPrefs drops a wrongly typed boolean");
t.eq(prefs.autoOpen, false, "readPrefs keeps false");
t.eq(prefs.context, null, "readPrefs: unset is null");
t.eq(json(parseViewSettings(prefs)), json({ layout: "wide", autoOpen: false }), "the widget reads null as unset");
for (const junk of [null, undefined, [], "x", 3, { layout: "stacked", context: "new", brief: "on" }])
  t.eq(json(parseViewSettings(junk)), "{}", `junk prefs ${json(junk)} read as unset`);
t.eq(json(parseSettingsQuery("layout:spine,width:full,brief:true,context:all")),
  json({ layout: "spine", context: "full", width: "off", brief: true }), "?settings= parses");

// 5. The retune (2026-10-04, owner-approved) and the new reading row.
t.eq(PRESETS.beginner.context, "used", "beginner Context used");
t.eq(PRESETS.beginner.comments, "shown", "beginner Comments show");
t.eq(PRESETS.beginner.hypOrigins, true, "beginner origins on");
t.ok(PRESETS.beginner.hoverBar.tactic.includes("trace"), "beginner ⁇ on the tactic bar");
t.eq(PRESETS.expert.brief, false, "expert brief off");
t.ok(READING_OPTIONS.some((o) => o.id === "autoOpen"), "autoOpen is a reading option");
t.eq(readingOn({ brief: false, merge: false, lints: false, hypOrigins: false, polish: false, upToCursor: false, autoOpen: true }).length, 0, "autoOpen (on by default) does not light Reading");

console.log(`${webKeys.length} settings on the allow-list, ${trips} values round-tripped, ${refused.length} writes refused`);
t.done();
