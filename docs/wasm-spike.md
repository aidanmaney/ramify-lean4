# WASM spike: can real Lean run in the browser as the playground's live tier?

**Verdict: GO, with caveats.** Lean v4.32.2 builds for WebAssembly with 12 small
patches. A purpose-built entry point (`scripts/wasm/LiveEngine.lean`) runs in a
Chromium Web Worker. It imports `Init` in **0.74 s** and answers a tactic on a goal
in **18 ms median (p90 151 ms, max 0.8 s)**. On the 42 requests below, its answers
are **byte-identical to native Lean and to the baked table**. The download is
**6.7 MB br** of wasm plus **86 MB br** of `Init` oleans (**23 MB br** if a
patch lets us drop `.olean.private`). The tab peaks at **~1.1 GB RSS**, against
349 MB for an empty Chromium.

The caveats are the **download size**, **memory**, a **cross-origin-isolation**
requirement for GitHub Pages, and an **unmaintained upstream target**: we would
own a patch set and a build. The rest of this document gives the evidence.

Measured 2026-10-05 in the cloud container (4 cores, 15 GB). The raw logs are in
`docs/wasm-measurements/`, and the scripts that reproduce every step are in
`scripts/wasm/` (recipe: `scripts/wasm/recipe/`).

## 1. Toolchain

- `doc/make/emscripten.md` in the v4.32.2 tree is stale. It still describes the
  Lean 3 `lean_js` targets.
- The real recipe is the **commented-out "Web Assembly" job** in
  `.github/workflows/ci.yml`, together with the also commented-out "Linux 32bit"
  job. That job uses emsdk **3.1.44** (`build-template.yml`, `setup-emsdk`) and a
  native **32-bit stage0** to produce 32-bit oleans and C. The C is then compiled
  with `emcc`.
- emsdk 3.1.44 installs from git plus storage.googleapis.com. The 32-bit
  libraries come from apt: `gcc-multilib g++-multilib libuv1-dev:i386
  libssl-dev:i386 pkgconf:i386`.
- The CMake still has Emscripten branches throughout `src/CMakeLists.txt`. The
  support is **unmaintained rather than removed**: neither CI job has run for a
  while, and both 32-bit native and wasm had rotted.

## 2. Build

The configure command is in `scripts/wasm/recipe/cmake-cache-excerpt.txt`. Beyond
the CI job's flags, it needs these:

- `STAGE0_CMAKE_TOOLCHAIN_FILE=` (empty). Without it the toolchain file leaks into
  stage0, which then builds as wasm.
- `STAGE0_PKG_CONFIG_EXECUTABLE=/usr/bin/i386-linux-gnu-pkg-config`.
- `-m32 -msse2 -mfpmath=sse` in `STAGE0_CMAKE_{C,CXX}_FLAGS`, `STAGE0_LEANC_OPTS`
  and `STAGE0_LEAN_EXTRA_CXX_FLAGS`. Without SSE, x87 floating point fails
  `lean.h`'s `FLT_EVAL_METHOD == 0` check.
- `STAGE1_CMAKE_TOOLCHAIN_FILE`, `STAGE1_CMAKE_AR=emar` and
  `STAGE1_CMAKE_C_COMPILER_WORKS=1`. Stage1 does not inherit `PLATFORM_ARGS`.
- `USE_MIMALLOC=OFF`.

The patches below are all in `scripts/wasm/recipe/lean4-v4.32.2-wasm.patch`. Each
was found by a failing build or run.

| # | symptom | cause | fix |
|---|---|---|---|
| 1 | 32-bit stage0 aborts at startup: `unknown parser category 'level'` | `LEAN_SCALAR_PTR_LITERAL` (static closed terms) has a 32-bit form only under `LEAN_EMSCRIPTEN`, so on native i386 every static `Name`'s 64-bit hash was truncated (gdb: inserted `fd46672b5f7257f8`, looked up `000000005f7257f8`) | key the macro on `__SIZEOF_POINTER__ == 4` (stage0 and src `lean.h`) |
| 2 | stage1's Lake: `failed to create thread` | default thread stack is 1 GB unless `LEAN_EMSCRIPTEN`, which does not fit in a 32-bit address space | `-DLEAN_DEFAULT_THREAD_STACK_SIZE=32*1024*1024` for stage0 |
| 3 | `Leanc: some modules have bad imports` | `Leanc` is in `STDLIBS` and `defaultTargets`, but `Leanc.lean` is configured only for non-Emscripten builds | move `Leanc` to the non-Emscripten list (`CMakeLists.txt`, `lakefile.toml.in`) |
| 4–5 | C++ compile errors in `runtime/uv/{event_loop,system}.cpp` | the Emscripten stubs drifted from their headers | match the signatures |
| 6 | link: `--shared-memory is disallowed by Prelude.c.o.export` | Lake compiles the stdlib's C with `LEAN_CC` directly, so `-pthread` (atomics) never reached it | put `LEANC_EXTRA_CC_FLAGS` into `moreLeancArgs` for Emscripten |
| 7 | link: 8 `function signature mismatch` warnings | the new compiler ERASES the IO world token, but the C++ definitions (`lean_compacted_region_{read,save,free}`, `lean_run_init`, `lean_io_create_temp{file,dir}`, `lean_internal_get_default_max_{heartbeat,memory}`) disagree. This is harmless in native cdecl; in wasm the call becomes a TRAP, and `compacted_region_read` is the olean loader | make the C++ match the generated C |
| 8 | V8: `exports count of 231015 exceeds internal limit of 100000` | upstream links `MAIN_MODULE=1 EXPORT_ALL=1` so the IR interpreter can `dlsym` | link STATIC (`recipe/link-static.sh`): 128 → 66 MB, and the 139 MB JS glue becomes 110 KB |
| 9 | static link: `Could not find native implementation of external declaration 'IO.getRandomBytes'` | no `dlsym` | `scripts/wasm/gen-symtab.py`: a sorted name → address table of every `LEAN_EXPORT` symbol of `Init` (20,384), declared with the generated C's own prototypes; `lookup_symbol_in_cur_exe` bsearches it under `LEAN_EMSCRIPTEN` |
| 10 | link: `attempt to add bitcode file after LTO` | `leanc.sh` adds `-flto`, which pulls LTO libc in late | link with `emcc` directly |
| 11 | browser: `no Lean executable file exists in WASM outside of Node.js` | `IO.appPath` and `shell.cpp` assume node | outside node, return `/bin/lean` and skip the NODEFS mounts (the page populates MEMFS) |
| 12 | `import Lean` from C codegen: `failed to read …/LibrarySearch.ir: 'unreachable'` | one stage1 `.ir` file is unreadable by both the 32-bit stage0 and the wasm stage1. **Not fixed**; it is not on the playground's path | LiveEngine imports `Lean.Elab.Frontend` only |

**Build times** (4 cores):

| step | time |
|---|---|
| stage0 (i386) | 12 min |
| stage1: 4,885 Lake jobs, elaborated by the i386 stage0, C compiled by emcc | 32 min |
| C rebuild after patch 6 | ~8 min |
| each `-O3` static link (wasm-ld plus wasm-opt) | 12–22 min |

The whole build is ~1.5 h of machine time. Build tree: 0.8 GB stage0, 0.9 GB
stage1, 1.6 GB emsdk.

## 3. Run in node

### The stock CLI (`lean.js file.lean`)

With patches 1–10, the stock CLI elaborates
`theorem t (n : Nat) : 0 + n = n := by induction n <;> simp` correctly (`'t'
depends on axioms: [propext]`). Native Lean takes 0.58 s for this. The wasm CLI
takes **22 s**, all of it in importing `Init`; an empty file costs the same.

A `--cpu-prof` profile with `--profiling-funcs` shows where the time goes:

- **83–96 % of every thread is `emscripten_futex_wait`**. CPU work is about 2 s.
- The import reads ~2,400 files on Lean's task-pool pthreads.
- Every file syscall is proxied to the Emscripten main thread, which is itself
  parked on a futex.

So the cost is round-trip latency, not computation.

### The live engine (`LiveEngine.lean` + `live_shim.c`)

The live engine does the import **on the Emscripten main thread itself**: the
worker's JS thread calls `ramify_init`. MEMFS is local there, so the import takes
**0.74 s**, no more than native (0.23–0.4 s) by a small factor.

**How oleans load.** There is no `mmap`, so `MMAP=OFF` and
`lean_compacted_region_read` takes its `malloc` + `read` path. The fix-up walk
then relocates each region. This is supported and correct, but every olean byte is
copied into the wasm heap.

**What the import reads.** `readModuleDataPartsOfMod` "opportunistically" reads
**all three parts** of every module — `.olean`, `.olean.server` and
`.olean.private` — and the `.ir` file is needed too (`missing IR data file`
without it). The import reads all of them even when the importer is a `module`
(strace on native: 600 × 3 opens).

**Results** (node, `scripts/wasm/live-node.mjs`, `docs/wasm-measurements/wasm-node.out`):

| | |
|---|---|
| runtime + Lean init | 0.3 s |
| `import Init` | 0.74 s (65,273 constants) |
| 42 requests over 9 demo theorems | **42/42 identical to native**; median 12 ms, p90 122 ms, max 467 ms; sum 2.0 s (native 1.5 s) |
| wasm heap | 375 MB |
| node RSS | ~1.0 GB |

The 42 requests are each theorem's solution replayed step by step, plus tactics
the bake does not table, `grind` among them (`demo-requests.py`). The first answer
per theorem includes elaborating its file (helper `def`s), cached afterwards.

**Cross-check against the bake.** Where the 42 requests overlap
`web/probe/playground/AndSwap.json`, the live keys equal the baked keys exactly:

- `cases h` → `case intro\np q : Prop\nleft✝ : p\nright✝ : q\n⊢ q ∧ p`
- `obtain …; constructor` → `case left …`, `case right …`

The engine runs the baker's own `runOne` / `ppKey` / `usedHyps`.

## 4. Browser

Test setup: headless Chromium (Playwright) in a Web Worker, served with
COOP/COEP headers (`scripts/wasm/serve.mjs`). `crossOriginIsolated` is true, which
pthreads need for `SharedArrayBuffer`.

- **Stock CLI in a worker** (`worker.js`, `browser.mjs`): it works and reports
  `'t' depends on axioms: [propext]`. Like node, it spends ~20 s in the proxied
  import.
- **Live engine** (`worker-live.js`, `browser-live.mjs`,
  `docs/wasm-measurements/browser.out`):

| step | time (localhost) |
|---|---|
| fetch the tar | 0.8–1.4 s |
| compile wasm + start runtime + unpack | 0.8–1.1 s |
| `import Init` | **0.74 s** |
| 42 answers | **42/42 identical to native**; median 18 ms, p90 151 ms, max 0.8 s |
| worker creation to last answer | 6.1 s |

**Memory** (`docs/wasm-measurements/memory.txt`; summed RSS of every Chromium
process — desktop only, phones stay baked-only):

| configuration | peak RSS |
|---|---|
| empty Chromium page | 349 MB |
| live engine, first cut | 1,409–1,419 MB |
| + MEMFS `canOwn` (current `untar.mjs`) | **1,139 MB** |

Where the ~790 MB above an empty page goes (the last row):

- **Wasm heap, 375 MB.** About 270 MB of it is the olean bytes, which Lean
  `malloc`s and keeps (patch-free and unavoidable without `mmap`). The rest is the
  environment and the elaborator.
- **The tar's ArrayBuffer, 275 MB.** MEMFS now holds views of it rather than a
  second copy. The first cut copied every file, which is the extra 270 MB in the
  1.41 GB figure. Dropping the tar and unlinking the MEMFS files after the import
  (`trim`) did not lower RSS within the 4 s we watched. V8 frees large buffers
  lazily, but they are dead after `ramify_init`.
- **Compiled code and runtime, ~140 MB.** This covers Liftoff and TurboFan code
  for a 67 MB module, pthread workers and the JS heap.
- **Debug vs stripped wasm** made no difference to memory (1,419 vs 1,409 MB): the
  name section is not resident code. It matters for download only (73.7 → 66.9 MB
  raw).

What trimming further would cost:

1. **Drop `.olean.private`** (187 MB of the 275 MB) by making
   `readModuleDataPartsOfMod` skip missing parts and importing as a `module`.
   - Saves about 190 MB in the tar and 190 MB in the heap: roughly **−370 MB**,
     to ~0.75 GB.
   - Cuts the download to 23 MB br.
   - Cost: a ~5-line Lean patch to `Lean/Environment.lean`, which rebuilds every
     downstream stage1 module (~40 min of machine time), and a check that a
     `module` importer elaborates the playground theorems identically.
2. **Stream the tar into MEMFS** instead of holding the whole buffer. Saves about
   90 MB after (1), or 275 MB before it. Cost: a streaming untar, ~0.5 day.
3. Ship **only the `Init` modules the playground actually imports**. Upside not
   measured; probably modest, since `Init` is one closure.

**Download** (`docs/wasm-measurements/sizes.txt`):

| artefact | raw | gzip -9 | brotli -11 |
|---|---|---|---|
| `live.wasm` (stripped) | 66.9 MB | 12.1 MB | **6.7 MB** |
| `live.js` + `live.worker.js` | 0.11 MB | 0.03 MB | — |
| `Init` tar, all parts + `.ir` | 275.0 MB | 117.0 MB | **85.9 MB** |
| `Init` tar without `.olean.private` | 87.5 MB | 33.1 MB | **22.8 MB** |

These are wasm32 oleans. The 64-bit native `.olean`s alone are 98 MB; the 32-bit
ones are 67 MB.

So the honest offer today is "**Enable live Lean — ~93 MB download**". With
trimming step 1 it becomes "**~30 MB**".

**Hosting.** pthreads need cross-origin isolation, and GitHub Pages cannot set
COOP/COEP headers. The usual workaround is a service worker that re-serves the
site with the headers (`coi-serviceworker`). This is only needed on the page, and
only once the live tier is enabled. The alternative is a single-threaded build
(no `-pthread`): Lean's task manager with zero workers is untested and would need
work.

## 5. Engine prototype (not wired)

`scripts/wasm/LiveEngine.lean` exposes two calls, through the C shim
`scripts/wasm/live_shim.c` (C strings in, C strings out):

- **`ramify_init(leanPath)`** imports `Init` once and caches it.
- **`ramify_answer(json)`** takes `{file, theorem, path: [[tactic, pick]…],
  tactic}`, elaborates the theorem file once (cached by its text), rebuilds the
  goal by replaying `path` from the theorem's type — *state, not text*, as
  `playground-spike.md` prescribes — and runs the baker's `runOne`. It returns
  `{goals: [ppGoal keys], uses}` or `{error}`: the shape of `EngineAnswer`.

The copy of `runOne` / `ppKey` / `usedHyps` is the spike's only copy. Shipping
means moving them into a Paperproof-free module that both `PlaygroundBake.lean`
and the engine compile.

The engine is compiled to C by the i386 stage0 (`lean -c`) and linked by
`scripts/wasm/recipe/link-live.sh` with the symbol table. The same C runs natively
(`live_native`, `docs/wasm-measurements/native.out`) for the identical-answers
check.

The seam in `web/src/playgroundAnswer.ts`, sketched. The page already knows each
goal occurrence's path, since it is the tree:

```ts
/** The live tier: a worker running LiveEngine.wasm; answers only what the
 bake could not, in the same shape, so a goal it leaves that the bake knows
 joins the baked graph. */
export function wasmEngine(worker: LiveWorker, spec: { file: string; theorem: string },
                           pathOf: (goalKey: string) => [string, number][] | undefined): Engine {
  return async (key, tactic) => {
    const path = pathOf(key);
    if (!path || !worker.ready) return NOT_BAKED;     // still downloading → "not in this demo"
    const a = await worker.answer({ ...spec, path, tactic });   // postMessage round trip
    return "error" in a ? { error: a.error } : { goals: a.goals, uses: a.uses };
  };
}
// const answer = makeAnswer([bakedEngine(table), wasmEngine(live, spec, pathOf)]);
```

`Engine` is keyed by `goalKey` alone, so either `answer` gains a `path` argument
or the page passes `pathOf` as above. Live answers go to IndexedDB under
`(bake version, theorem, goalKey, tactic)`, as the spike doc already plans.

**Missing for the product:** a NEW goal (one that is not in the table) also needs
its tagged print and hovers to render. That means compiling `ProofTreeHarvest`'s
`bakeGoal` and Paperproof's `mayBeProof` into the engine. Both are plain Lean, but
they `import Lean`, which runs into the unreadable `LibrarySearch.ir` (patch 12) —
fix that or narrow their imports.

## Recommendation

**GO WITH CAVEATS** for an opt-in, desktop-only live tier.

**What is proven:** correctness (identical answers), speed (tens of ms per tactic
after a sub-second import) and memory headroom (1.1 GB of a 4 GB wasm32 space).

**The costs:**

- **Download:** ~93 MB, or ~30 MB after the `.private` patch.
- **A Lean fork:** 12 patches plus a symbol-table generator. These are worth
  upstreaming, since three of them are real 32-bit bugs (1, 2, 7) that would bite
  any wasm32 or i386 user.
- **A ~1.5 h build** in CI, once per Lean bump.
- **A COOP/COEP service worker** on Pages.

| work to ship | effort |
|---|---|
| CI job reproducing this build (emsdk 3.1.44, i386 stage0, patch set, symtab, `link-live.sh`), artefacts cached per Lean version | 2–3 days |
| `.olean.private` skip patch + `module` import check (download 86 → 23 MB br, −370 MB RSS) | 1–2 days |
| Factor `runOne`/`ppKey`/`usedHyps` out of PlaygroundBake; add `bakeGoal` tagged prints to the engine (fix or avoid patch 12) | 2–3 days |
| Page: opt-in button, worker download with progress in the status strip, Cache Storage, `coi-serviceworker`, `wasmEngine` in `makeAnswer`, IndexedDB answer cache | 2–3 days |
| Probe: replay every baked step through the live engine (node) and assert identical keys | 0.5 day |

The total is **~1.5–2 weeks**.

Not recommended: the stock `lean.js` CLI (22 s per call from proxied file I/O and
the import each run), or the upstream `MAIN_MODULE` link (V8 refuses to
instantiate it).
