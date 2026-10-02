/** FNV-1a (32-bit) of a string, base 36 — a short stable fingerprint for cache
 keys and change detection. Not a security hash. `polishKey`'s output is the
 bits this has always produced (the companion keeps its own, same-family hash
 for what persists), so anything keyed on it stays valid. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
