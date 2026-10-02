/** Clip `s` to `cap` characters, ending in `…` where it was cut (never a bare
 slice, which stops mid-word and says nothing about it). `s` is taken as it
 is — callers flatten or take a line first, as their surface needs. `words`
 backs up to the last space when that keeps more than half of `cap`; `trim`
 (default on) drops the whitespace the cut leaves before the `…`. One coding
 for the narration lines, the tour captions, the toast and pill messages and
 the lens's goal annotations. */
export function clipText(
  s: string,
  cap: number,
  opts: { words?: boolean; trim?: boolean } = {},
): string {
  if (s.length <= cap) return s;
  let cut = s.slice(0, cap - 1);
  if (opts.words) {
    const sp = s.lastIndexOf(" ", cap - 1);
    if (sp > cap / 2) cut = s.slice(0, sp);
  }
  return `${opts.trim === false ? cut : cut.trimEnd()}…`;
}
