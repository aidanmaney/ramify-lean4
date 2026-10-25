// The playground's live tier: one Web Worker = one wasm Lean (web/src/playgroundLive.ts).
//
//   {init: {base}}           fetch live.js, live.wasm and init.tar under `base` (the
//                            .gz forms where `manifest.json` lists them —
//                            scripts/wasm/package-live.mjs), unpack the oleans into
//                            MEMFS, import Init once → {ready: {ms}}
//   {id, answer: json}       one tactic on one goal → {id, result}
//
// Lean runs on THIS thread (Emscripten's main thread), so MEMFS reads are local, not
// proxied from a pthread — that is what keeps the import under a second
// (docs/wasm-spike.md). Progress goes back as {progress: {step, done, total}}.
let ready = null;

/** `total`: the manifest's size (compressed bytes, what arrives over the wire);
 else the response's Content-Length, which a server may leave out. */
async function fetchWithProgress(url, step, known) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = known ?? (Number(res.headers.get("content-length")) || undefined);
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

/** Cache Storage for the big downloads: one name (the page probes it, playground.tsx
 LIVE_CACHE), keys `<url>?v=<version>`. Storing a version evicts every other
 version of the same file. Anything that fails here (no Cache Storage, a private
 window, quota) falls back to a plain download. */
const CACHE = "ramify-live-v1";
const bare = (u) => u.split("?")[0];
async function openCache() {
  try {
    return await caches.open(CACHE);
  } catch {
    return null;
  }
}
async function cacheGet(cache, key) {
  try {
    const hit = cache && (await cache.match(key));
    return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
async function cachePut(cache, key, buf) {
  if (!cache) return;
  try {
    for (const old of await cache.keys()) if (bare(old.url) === bare(key) && old.url !== key) await cache.delete(old);
    await cache.put(key, new Response(buf));
  } catch {
    /* quota: the next visit downloads again */
  }
}

/** One file through the cache, keyed by `version`. */
async function versioned(url, version, total, step, cachedStep) {
  const cache = await openCache();
  const key = `${url}?v=${encodeURIComponent(version)}`;
  const hit = await cacheGet(cache, key);
  if (hit) {
    postMessage({ progress: { step: cachedStep } });
    return hit;
  }
  const buf = await fetchWithProgress(url, step, total);
  await cachePut(cache, key, buf);
  return buf;
}

/** The OLD layout (serve-playground's /live/, no manifest): the version is the
 server's Last-Modified (or ETag), read off a HEAD. */
async function cachedBytes(url, step, cachedStep) {
  let v = "";
  try {
    const head = await fetch(url, { method: "HEAD" });
    v = head.headers.get("last-modified") ?? head.headers.get("etag") ?? "";
  } catch {
    /* the GET below says what is wrong */
  }
  return versioned(url, v, undefined, step, cachedStep);
}

/** gzip → bytes. A server that already decoded it (Content-Encoding: gzip on a
 .gz) hands over the plain bytes, so the magic number decides. */
async function gunzip(buf) {
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return buf;
  const out = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** `manifest.json` (scripts/wasm/package-live.mjs), or null: the old layout. */
async function manifestAt(base) {
  try {
    const r = await fetch(`${base}manifest.json`, { cache: "no-cache" });
    if (!r.ok) return null;
    const m = await r.json();
    return m && typeof m.version === "string" && m.files ? m : null;
  } catch {
    return null;
  }
}

/** A same-origin script as a blob URL that imports it. */
function blobScript(url) {
  return URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(url)});`], { type: "text/javascript" }));
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
  const m = await manifestAt(base);
  let wasm, tar;
  if (m) {
    // the deployed layout: pre-gzipped files (a static host will not compress a
    // .wasm or a .tar), progress against the manifest's compressed sizes
    const gz = (f) => m.files[f]?.gzBytes;
    const wasmGz = await versioned(`${base}live.wasm.gz`, m.version, gz("live.wasm.gz"), "downloading Lean", "loading Lean from this browser");
    const tarGz = await versioned(`${base}init.tar.gz`, m.version, gz("init.tar.gz"), "downloading Lean's library", "loading Lean's library from this browser");
    postMessage({ progress: { step: "unpacking Lean" } });
    [wasm, tar] = await Promise.all([gunzip(wasmGz), gunzip(tarGz)]);
  } else {
    wasm = await cachedBytes(`${base}live.wasm`, "downloading Lean", "loading Lean from this browser");
    tar = await cachedBytes(`${base}init.tar`, "downloading Lean's library", "loading Lean's library from this browser");
  }
  // Compile here, not inside Emscripten, so the slow part has its own step:
  // Safari compiles a 69 MB module far more slowly than Chrome, and from
  // outside that looked like a hang at "starting Lean".
  // the manifest's version on every script this loads: a static host's HTTP
  // cache would otherwise mix an old loader with a new engine after a deploy
  const vq = self.LIVE_VERSION ? `?v=${self.LIVE_VERSION}` : "";
  postMessage({ progress: { step: "compiling Lean" } });
  const tc = performance.now();
  const module = await WebAssembly.compile(wasm);
  const compileMs = Math.round(performance.now() - tc);
  postMessage({ progress: { step: "starting Lean" } });
  const ts = performance.now();
  await new Promise((ok, bad) => {
    self.Module = {
      instantiateWasm: (imports, done) => {
        WebAssembly.instantiate(module, imports).then((inst) => done(inst, module), (e) => bad(new Error(`instantiating Lean: ${e?.message ?? e}`)));
        return {};
      },
      // what start-up is still waiting on (e.g. Lean's thread pool), so a
      // stall names itself instead of sitting at "starting Lean"
      monitorRunDependencies: (left) => {
        if (left > 0) postMessage({ progress: { step: `starting Lean (waiting on ${left})` } });
      },
      // Lean's threads are workers too. One made from a URL takes ITS OWN
      // response's headers (no COEP on a static host: blocked), so each is a
      // blob that imports the script — a blob worker inherits its creator's
      // isolation, as this one inherits the page's (playgroundLive.ts).
      locateFile: (f) => (f.endsWith(".worker.js") ? blobScript(base + f + vq) : base + f + vq),
      mainScriptUrlOrBlob: `${base}live.js${vq}`, // pthread workers import live.js, not this file
      preRun: [() => { untarInto(self.Module.FS, tar, "/lib/lean"); }],
      postRun: [ok],
      onAbort: (w) => bad(new Error(`Lean aborted: ${w}`)),
      // An exception escaping Lean's main (Safari: "Maximum call stack size
      // exceeded" in the module initializers — its worker stack is smaller)
      // ends in Emscripten's quit, which nothing awaited: the page sat at
      // "starting Lean" for ever. It fails here instead, and the page keeps
      // the baked answers.
      quit: (status, toThrow) => {
        // a NORMAL exit (Lean's main returning 0) also comes here, as
        // Emscripten's ExitStatus: that one is start-up finishing, not failing
        if (toThrow?.name === "ExitStatus" && status === 0) throw toThrow;
        const msg = String(toThrow?.message ?? toThrow ?? `exit ${status}`);
        bad(new Error(/call stack/i.test(msg) ? "this browser's worker call stack is too small for Lean's start-up (Safari); the answers computed in advance still work" : `Lean stopped: ${msg}`));
        throw toThrow;
      },
      printErr: (s) => console.log("[lean]", s),
    };
    importScripts(`${base}live.js${vq}`);
  });
  console.log(`[ramify] compiled in ${compileMs} ms, started in ${Math.round(performance.now() - ts)} ms`);
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
