// Browser Web Worker for the LiveEngine wasm (docs/wasm-spike.md). One worker = one Lean:
// {init: {tar}} unpacks the Init oleans into MEMFS and imports Init once; then each
// {answer: requestJson} is one tactic on one goal, answered in the baker's shape.
// Lean runs on THIS thread (the Emscripten main thread), so its MEMFS reads are local
// rather than proxied from a pthread, which is what makes the import fast.
importScripts("untar.js");
let ready;
self.onmessage = async ({ data }) => {
  if (data.init) {
    const t0 = performance.now();
    let buf = new Uint8Array(await (await fetch(data.init.tar)).arrayBuffer());
    const tFetch = performance.now();
    ready = new Promise((ok) => {
      self.Module = {
        mainScriptUrlOrBlob: "live.js", // pthread workers import live.js, not this file
        preRun: [() => { self.untarInto(self.Module.FS, buf, "/lib/lean"); }],
        postRun: [ok],
        printErr: (s) => console.log("[lean]", s),
      };
      importScripts("live.js");
    });
    await ready;
    const tMain = performance.now();
    const r = self.Module.ccall("ramify_init", "string", ["string"], ["/lib/lean"]);
    const tInit = performance.now();
    if (data.init.trim) {
      // Lean has read every olean into its own heap (no mmap in wasm): the tar and the MEMFS
      // copies are dead weight from here on.
      buf = null;
      const rm = (d) => { for (const n of self.Module.FS.readdir(d)) { if (n === "." || n === "..") continue;
        const p = `${d}/${n}`; if (self.Module.FS.isDir(self.Module.FS.stat(p).mode)) { rm(p); self.Module.FS.rmdir(p); } else self.Module.FS.unlink(p); } };
      rm("/lib/lean");
    }
    postMessage({ init: JSON.parse(r), ms: { fetch: tFetch - t0, runtimeAndUnpack: tMain - tFetch, importInit: tInit - tMain },
      heapMB: self.Module.HEAP8.length / 1e6 });
  } else if (data.answer) {
    await ready;
    const t = performance.now();
    const r = self.Module.ccall("ramify_answer", "string", ["string"], [data.answer]);
    postMessage({ answer: JSON.parse(r), wallMs: performance.now() - t, heapMB: self.Module.HEAP8.length / 1e6 });
  }
};
