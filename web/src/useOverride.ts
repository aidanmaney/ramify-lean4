// A session OVERRIDE of a default (the `polishOverride` idiom): null reads the
// default, so a default that arrives late (the companion's theme file is read
// after mount) needs no effect. Setting a value EQUAL to the current default
// stores null, so a later change of the default applies again.
//
// An override holds only OVER THE DEFAULT IT WAS SET AGAINST (batch 5,
// 2026-10-04): once the default moves — the setting the band just wrote comes
// back through the theme file, the reader edits settings.json, the preset
// changes — the override lets go and the new default reads. So a band change
// that the companion persisted collapses into the setting by itself, and a
// stale session value never shadows a setting changed since. Without a
// companion the default never moves and the override stands, as before.
import { useState } from "react";

export function useOverride<T>(dflt: T): [T, (v: T) => void] {
  const [override, setOverride] = useState<{ v: T; over: T } | null>(null);
  return [
    override !== null && override.over === dflt ? override.v : dflt,
    (v) => setOverride(v === dflt ? null : { v, over: dflt }),
  ];
}
