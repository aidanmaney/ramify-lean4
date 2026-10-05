// Browser Web Worker for the WASM-Lean spike (docs/wasm-spike.md).
// Loads the Emscripten `lean.js` (static link, pthreads), unpacks an Init olean tar into
// MEMFS under /lib/lean, writes the source, runs `lean <file>` once, posts timings + output.
// Usage (from a page): new Worker("worker.js").postMessage({src, tar: "init.tar"})
self.onmessage = async (ev) => {
  const { src, tar = "init.tar", args = [] } = ev.data;
  const t0 = performance.now();
  const out = [];
  const buf = new Uint8Array(await (await fetch(tar)).arrayBuffer());
  const tFetch = performance.now();
  self.Module = {
    noInitialRun: true,
    mainScriptUrlOrBlob: "lean.js", // pthread workers must import lean.js, not this file
    print: (s) => out.push(s),
    printErr: (s) => out.push("[err] " + s),
    onRuntimeInitialized() {
      const tInit = performance.now();
      const FS = self.Module.FS;
      let files = 0, bytes = 0;
      // minimal ustar reader: 512-byte headers, name at 0..100, prefix at 345..500, size octal at 124
      for (let off = 0; off + 512 <= buf.length; ) {
        const h = buf.subarray(off, off + 512);
        if (h[0] === 0) break;
        const str = (a, b) => new TextDecoder().decode(h.subarray(a, b)).replace(/\0.*$/s, "");
        const name = (str(345, 500) ? str(345, 500) + "/" : "") + str(0, 100);
        const size = parseInt(str(124, 136).trim() || "0", 8);
        const type = String.fromCharCode(h[156] || 48);
        off += 512;
        if (type === "0" || type === "\0") {
          const path = "/lib/lean/" + name;
          FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
          FS.writeFile(path, buf.subarray(off, off + size));
          files++; bytes += size;
        }
        off += Math.ceil(size / 512) * 512;
      }
      FS.mkdirTree("/bin"); FS.writeFile("/bin/lean", ""); // IO.appPath outside node (patched io.cpp)
      self.Module.ENV.LEAN_PATH = "/lib/lean";
      FS.writeFile("/a.lean", src);
      const tFs = performance.now();
      let rc;
      try { rc = self.Module.callMain([...args, "/a.lean"]); } catch (e) { rc = String(e); }
      const tRun = performance.now();
      postMessage({
        rc, out, files, bytes,
        ms: { fetch: tFetch - t0, init: tInit - tFetch, fs: tFs - tInit, run: tRun - tFs, total: tRun - t0 },
        heapMB: self.Module.HEAP8 ? self.Module.HEAP8.length / 1e6 : null,
      });
    },
  };
  importScripts("lean.js");
};
