// Minimal ustar reader: write every regular file of `buf` into Emscripten's FS under `root`.
export function untarInto(FS, buf, root) {
  let files = 0, bytes = 0;
  const dec = new TextDecoder();
  for (let off = 0; off + 512 <= buf.length; ) {
    const h = buf.subarray(off, off + 512);
    if (h[0] === 0) break;
    const str = (a, b) => dec.decode(h.subarray(a, b)).replace(/\0.*$/s, "");
    const name = (str(345, 500) ? str(345, 500) + "/" : "") + str(0, 100);
    const size = parseInt(str(124, 136).trim() || "0", 8);
    const type = h[156];
    off += 512;
    if (type === 48 || type === 0) {
      const path = `${root}/${name}`;
      mkdirp(FS, path.slice(0, path.lastIndexOf("/")));
      // canOwn: MEMFS keeps a VIEW of the tar's bytes instead of copying them (one copy, not two)
      const st = FS.open(path, "w");
      FS.write(st, buf, off, size, 0, /* canOwn */ true);
      FS.close(st);
      files++; bytes += size;
    }
    off += Math.ceil(size / 512) * 512;
  }
  return { files, bytes };
}

const made = new WeakMap();
/** `mkdir -p` with only FS.mkdir (WasmFS's JS API has no mkdirTree). */
function mkdirp(FS, dir) {
  let seen = made.get(FS);
  if (!seen) made.set(FS, (seen = new Set()));
  let cur = "";
  for (const part of dir.split("/").filter(Boolean)) {
    cur += "/" + part;
    if (seen.has(cur)) continue;
    try { FS.mkdir(cur); } catch (e) { /* exists */ }
    seen.add(cur);
  }
}
