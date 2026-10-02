// A session OVERRIDE of a default (the `polishOverride` idiom): the state is
// `T | null`, null reads the default, so a default that arrives late (the
// companion's theme file is read after mount) needs no effect, and a value the
// reader has set keeps the reader's choice. Setting a value EQUAL to the
// current default stores null, so a later change of the default applies again.
import { useState } from "react";

export function useOverride<T>(dflt: T): [T, (v: T) => void] {
  const [override, setOverride] = useState<T | null>(null);
  return [override ?? dflt, (v) => setOverride(v === dflt ? null : v)];
}
