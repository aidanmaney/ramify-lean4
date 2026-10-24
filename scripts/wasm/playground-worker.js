// The playground's live tier: one Web Worker = one wasm Lean (web/src/playgroundLive.ts).
//
//   {init: {base}}           fetch live.js/live.wasm/init.tar under `base`, unpack the
//                            oleans into MEMFS, import Init once → {ready: {ms}}
//   {id, answer: json}       one tactic on one goal → {id, result}
//
// Lean runs on THIS thread (Emscripten's main thread), so MEMFS reads are local, not
// proxied from a pthread — that is what keeps the import under a second
// (docs/wasm-spike.md). Progress goes back as {progress: {step, done, total}}.
let ready = null;

async function fetchWithProgress(url, step) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || undefined;
  const reader = res.body.getReader();
  const parts = [];
  let done = 0, last = 0;
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    parts.push(value);
    done += value.length;
    const now = performance.now();
    if (now - last > 100) { last = now; postMessage({ progress: { step, done, total } }); }
  }
  const buf = new Uint8Array(done);
  let off = 0;
  for (const p of parts) { buf.set(p, off); off += p.length; }
  return buf;
}

/** The big downloads (init.tar, live.wasm) through Cache Storage, keyed by the
 server's Last-Modified (or ETag): a second visit, or a reload, reads them
 from disk instead of downloading again. Anything that fails here (no Cache
 Storage, a private window) falls back to a plain download. */
const CACHE = "ramify-live-v1";
async function cachedBytes(url, step, cachedStep) {
  let cache = null;
  let key = null;
  try {
    const head = await fetch(url, { method: "HEAD" });
    const v = head.headers.get("last-modified") ?? head.headers.get("etag") ?? "";
    cache = await caches.open(CACHE);
    key = `${url}?v=${encodeURIComponent(v)}`;
    const hit = await cache.match(key);
    if (hit) {
      postMessage({ progress: { step: cachedStep } });
      return new Uint8Array(await hit.arrayBuffer());
    }
  } catch {
    cache = null;
  }
  const buf = await fetchWithProgress(url, step);
  if (cache && key)
    try {
      // the previous version of this file goes
      for (const old of await cache.keys()) if (old.url.split("?")[0] === new URL(url, location.href).href) await cache.delete(old);
      await cache.put(key, new Response(buf));
    } catch {
      /* quota: the next visit downloads again */
    }
  return buf;
}

/** ustar → MEMFS under `root`; canOwn keeps views of `buf`, not copies. */
function untarInto(FS, buf, root) {
  const dec = new TextDecoder();
  const made = new Set();
  const mkdirp = (dir) => {
    let cur = "";
    for (const part of dir.split("/").filter(Boolean)) {
      cur += "/" + part;
      if (made.has(cur)) continue;
      try { FS.mkdir(cur); } catch (e) { /* exists */ }
      made.add(cur);
    }
  };
  let files = 0;
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
      mkdirp(path.slice(0, path.lastIndexOf("/")));
      const st = FS.open(path, "w");
      FS.write(st, buf, off, size, 0, /* canOwn */ true);
      FS.close(st);
      files++;
    }
    off += Math.ceil(size / 512) * 512;
  }
  return files;
}

async function init(base) {
  const t0 = performance.now();
  const wasm = await cachedBytes(`${base}live.wasm`, "downloading Lean", "loading Lean from this browser");
  const tar = await cachedBytes(`${base}init.tar`, "downloading Lean's library", "loading Lean's library from this browser");
  postMessage({ progress: { step: "starting Lean" } });
  await new Promise((ok, bad) => {
    self.Module = {
      locateFile: (f) => base + f,
      wasmBinary: wasm.buffer, // from the cache above, not a second fetch
      mainScriptUrlOrBlob: `${base}live.js`, // pthread workers import live.js, not this file
      preRun: [() => { untarInto(self.Module.FS, tar, "/lib/lean"); }],
      postRun: [ok],
      onAbort: (w) => bad(new Error(`Lean aborted: ${w}`)),
      printErr: (s) => console.log("[lean]", s),
    };
    importScripts(`${base}live.js`);
  });
  postMessage({ progress: { step: "importing Init" } });
  const r = JSON.parse(self.Module.ccall("ramify_init", "string", ["string"], ["/lib/lean"]));
  if (!r.ok) throw new Error(r.error ?? (r.messages ?? []).join("; ") ?? "Init did not import");
  return performance.now() - t0;
}

self.onmessage = async ({ data }) => {
  if (data.init) {
    try {
      ready ??= init(data.init.base);
      postMessage({ ready: { ms: Math.round(await ready) } });
    } catch (e) {
      postMessage({ failed: String(e?.message ?? e) });
    }
  } else if (data.id) {
    await ready;
    let result;
    try {
      result = JSON.parse(self.Module.ccall("ramify_answer", "string", ["string"], [data.answer]));
    } catch (e) {
      result = { error: `live Lean: ${e?.message ?? e}`, ms: 0 };
    }
    postMessage({ id: data.id, result });
  }
};
