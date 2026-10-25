// The playground's live tier: one wasm Lean behind two messages (web/src/playgroundLive.ts).
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
//
// TWO HOSTS, ONE COPY. In a Web Worker (Chrome, Firefox) this file answers the
// worker's messages. Loaded on the PAGE (Safari: a worker's native stack is 512 KiB,
// too small for some answers — docs/wasm-spike.md §8) it defines
// `self.ramifyLiveHost(post, {version, beforeBlocking})` → {handle(msg), dispose()}
// instead, and the page calls `handle` where the worker would get a message.
// `beforeBlocking` is awaited before each call that holds the thread (start-up,
// the Init import, every answer); on the page it waits for a quiet screen.
(function () {
const IN_WORKER = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;

/** `total`: the manifest's size (compressed bytes, what arrives over the wire);
 else the response's Content-Length, which a server may leave out. */
async function fetchWithProgress(post, url, step, known) {
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
    if (now - last > 100) { last = now; post({ progress: { step, done, total } }); }
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

/** A big file's cache version: its own content hash where the manifest has one
 (so a script-only deploy re-downloads nothing big), else the manifest's. */
const fileVersion = (m, name) => m.files[name]?.hash ?? m.version;
/** One file through the cache, keyed by `version`. */
async function versioned(post, url, version, total, step, cachedStep) {
  const cache = await openCache();
  const key = `${url}?v=${encodeURIComponent(version)}`;
  const hit = await cacheGet(cache, key);
  if (hit) {
    post({ progress: { step: cachedStep } });
    return hit;
  }
  const buf = await fetchWithProgress(post, url, step, total);
  await cachePut(cache, key, buf);
  return buf;
}

/** The OLD layout (serve-playground's /live/, no manifest): the version is the
 server's Last-Modified (or ETag), read off a HEAD. */
async function cachedBytes(post, url, step, cachedStep) {
  let v = "";
  try {
    const head = await fetch(url, { method: "HEAD" });
    v = head.headers.get("last-modified") ?? head.headers.get("etag") ?? "";
  } catch {
    /* the GET below says what is wrong */
  }
  return versioned(post, url, v, undefined, step, cachedStep);
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

/** One Lean. `post` carries what the worker would postMessage. */
function createHost(post, { version = "", beforeBlocking = async () => {} } = {}) {
  let ready = null;
  let M = null; // this instance's Module
  let disposed = false;
  const waits = new Set(); // [array, index] of Atomics.waitAsync calls still pending (page host)

  /** live.js, run with `Module`. In the worker: importScripts, as Emscripten
   expects. On the page: live.js's top-level `var`s (PThread, FS, HEAP…) would land
   on `window` and outlive a restart, so its text runs inside a function of its own
   (a blob <script>, not eval), with an `Atomics` whose `waitAsync` this host can
   release: Emscripten parks the main thread's mailbox on one and re-arms it on every
   wake, which would keep a dead instance's memory reachable for ever. */
  async function loadEngine(url, Module) {
    if (IN_WORKER) {
      self.Module = Module;
      importScripts(url);
      return;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const text = await res.text();
    const key = `__ramifyLive${Math.random().toString(36).slice(2)}`;
    const blob = URL.createObjectURL(
      new Blob([`self[${JSON.stringify(key)}] = function (Module, Atomics) {\n${text}\n};`], { type: "text/javascript" }),
    );
    try {
      await new Promise((ok, bad) => {
        const s = document.createElement("script");
        s.src = blob;
        s.onload = () => (s.remove(), ok());
        s.onerror = () => (s.remove(), bad(new Error(`${url}: the script did not load`)));
        document.head.append(s);
      });
    } finally {
      URL.revokeObjectURL(blob);
    }
    const run = self[key];
    delete self[key];
    const atomics = Object.create(Atomics);
    if (typeof Atomics.waitAsync === "function")
      atomics.waitAsync = (a, i, v, t) => {
        const r = Atomics.waitAsync(a, i, v, t);
        if (!r.async) return r;
        const w = [a, i];
        waits.add(w);
        // once disposed, a wake reaches nothing: the chain (checkMailbox → re-arm) ends
        return { async: true, value: r.value.then((x) => (waits.delete(w), disposed ? new Promise(() => {}) : x)) };
      };
    run(Module, atomics);
  }

  async function init(base) {
    const t0 = performance.now();
    const m = await manifestAt(base);
    let wasm, tar;
    if (m) {
      // the deployed layout: pre-gzipped files (a static host will not compress a
      // .wasm or a .tar), progress against the manifest's compressed sizes
      const gz = (f) => m.files[f]?.gzBytes;
      const wasmGz = await versioned(post, `${base}live.wasm.gz`, fileVersion(m, "live.wasm.gz"), gz("live.wasm.gz"), "downloading Lean", "loading Lean from this browser");
      const tarGz = await versioned(post, `${base}init.tar.gz`, fileVersion(m, "init.tar.gz"), gz("init.tar.gz"), "downloading Lean's library", "loading Lean's library from this browser");
      post({ progress: { step: "unpacking Lean" } });
      [wasm, tar] = await Promise.all([gunzip(wasmGz), gunzip(tarGz)]);
    } else {
      wasm = await cachedBytes(post, `${base}live.wasm`, "downloading Lean", "loading Lean from this browser");
      tar = await cachedBytes(post, `${base}init.tar`, "downloading Lean's library", "loading Lean's library from this browser");
    }
    // Compile here, not inside Emscripten, so the slow part has its own step:
    // Safari compiles a 69 MB module far more slowly than Chrome, and from
    // outside that looked like a hang at "starting Lean".
    // the manifest's version on every script this loads: a static host's HTTP
    // cache would otherwise mix an old loader with a new engine after a deploy
    const vq = version ? `?v=${version}` : "";
    post({ progress: { step: "compiling Lean" } });
    const tc = performance.now();
    const module = await WebAssembly.compile(wasm);
    const compileMs = Math.round(performance.now() - tc);
    post({ progress: { step: "starting Lean" } });
    await beforeBlocking(); // unpacking into MEMFS and Lean's main hold the thread
    const ts = performance.now();
    await new Promise((ok, bad) => {
      const Module = {
        instantiateWasm: (imports, done) => {
          WebAssembly.instantiate(module, imports).then((inst) => done(inst, module), (e) => bad(new Error(`instantiating Lean: ${e?.message ?? e}`)));
          return {};
        },
        // what start-up is still waiting on (e.g. Lean's thread pool), so a
        // stall names itself instead of sitting at "starting Lean"
        monitorRunDependencies: (left) => {
          if (left > 0) post({ progress: { step: `starting Lean (waiting on ${left})` } });
        },
        // Lean's threads are workers too. One made from a URL takes ITS OWN
        // response's headers (no COEP on a static host: blocked), so each is a
        // blob that imports the script — a blob worker inherits its creator's
        // isolation, as this one inherits the page's (playgroundLive.ts). Made
        // from the page, the same holds.
        locateFile: (f) => (f.endsWith(".worker.js") ? blobScript(base + f + vq) : base + f + vq),
        mainScriptUrlOrBlob: `${base}live.js${vq}`, // pthread workers import live.js, not this file
        preRun: [() => { untarInto(Module.FS, tar, "/lib/lean"); }],
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
      M = Module;
      loadEngine(`${base}live.js${vq}`, Module).catch(bad);
    });
    console.log(`[ramify] compiled in ${compileMs} ms, started in ${Math.round(performance.now() - ts)} ms`);
    post({ progress: { step: "importing Init" } });
    await beforeBlocking();
    const r = JSON.parse(M.ccall("ramify_init", "string", ["string"], ["/lib/lean"]));
    if (!r.ok) throw new Error(r.error ?? (r.messages ?? []).join("; ") ?? "Init did not import");
    return performance.now() - t0;
  }

  async function handle(data) {
    if (disposed) return;
    if (data.init) {
      try {
        ready ??= init(data.init.base);
        post({ ready: { ms: Math.round(await ready) } });
      } catch (e) {
        post({ failed: String(e?.message ?? e) });
      }
    } else if (data.id) {
      await ready;
      await beforeBlocking();
      if (disposed) return;
      let result;
      try {
        result = JSON.parse(M.ccall("ramify_answer", "string", ["string"], [data.answer]));
      } catch (e) {
        const msg = String(e?.message ?? e);
        // a native stack overflow (Safari's worker stack is smaller than
        // Chrome's or Firefox's): the instance is not sound after one — the
        // RangeError unwinds through wasm without C++ cleanup — so the page
        // restarts this host (from the cache) after the answer
        if (/call stack/i.test(msg)) {
          post({ id: data.id, restart: true, result: { error: "This step needs more stack than this browser gives Lean (Safari's is smaller than Chrome's or Firefox's). Try another tactic; live Lean restarts.", ms: 0 } });
          return;
        }
        result = { error: `live Lean: ${msg}`, ms: 0 };
      }
      post({ id: data.id, result });
    }
  }

  /** The page host's stop: Lean's thread workers terminated, the parked waits
   released, the Module dropped — what is left is garbage. (A worker host is
   stopped by terminating the worker, which takes its nested workers with it.) */
  function dispose() {
    disposed = true;
    try {
      M?.PThread?.terminateAllThreads();
    } catch {
      /* already gone */
    }
    for (const [a, i] of waits) {
      try {
        Atomics.notify(a, i);
      } catch {
        /* nothing waits */
      }
    }
    waits.clear();
    M = null;
    ready = null;
  }

  return { handle, dispose };
}

if (IN_WORKER) {
  const host = createHost(postMessage, { version: self.LIVE_VERSION ?? "" });
  self.onmessage = ({ data }) => host.handle(data);
} else {
  self.ramifyLiveHost = createHost;
}
})();
