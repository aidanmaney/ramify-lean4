#!/bin/bash
# Build the playground's live tier (wasm32 Lean + the PlaygroundLive engine) ON A MAC,
# with no 32-bit native Lean and no Linux box. docs/wasm-spike.md has the original
# (cloud, i386-stage0) recipe; this one replaces the 32-bit stage:
#
#   1. C:      the native v4.32.2 `lean -c` over every Init/Std/Lean module (the C is
#              pointer-size independent; the toolchain's own oleans are the imports)
#   2. C++:    Lean's runtime/kernel/shell, configured for Emscripten (MMAP off)
#   3. objs:   emcc every module's C → libInit/libStd/libLean.a
#   4. CLI:    a wasm `lean` (node), linked static with the Init symbol table
#   5. oleans: that wasm `lean` compiles Init → 32-bit .olean/.ir (gen-oleans.mjs)
#   6. engine: lean/PlaygroundLive.lean → C → live.js/live.wasm; init.tar of the oleans
#
#   scripts/wasm/build-mac.sh [STEP...]     (default: all; steps are idempotent)
#
# Output: build-wasm/out/web/{live.js,live.wasm,live.worker.js,init.tar}, served by
# web/scripts/serve-playground.mjs. Measured 2026-10-05 on an M-series Mac (10 cores):
# C 4 min, objs 2.5 min, oleans ~15 min, engine link ~6 min.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
W=$repo/build-wasm
T=~/.elan/toolchains/leanprover--lean4---v4.32.2
B=$W/build/stage1
J=${J:-$(sysctl -n hw.ncpu)}
steps=${*:-"fetch c cpp objs cli oleans engine"}
mkdir -p "$W"; cd "$W"

has() { [[ " $steps " == *" $1 "* ]]; }
emsdk_env() { source "$W/emsdk/emsdk_env.sh" >/dev/null 2>&1; }

if has fetch; then
  [ -d emsdk ] || { git clone -q https://github.com/emscripten-core/emsdk.git
    (cd emsdk && ./emsdk install 3.1.44 && ./emsdk activate 3.1.44); }
  if [ ! -d lean4 ]; then
    git clone -q --depth 1 --branch v4.32.2 https://github.com/leanprover/lean4.git
    (cd lean4 && git apply "$here/recipe/lean4-v4.32.2-wasm.patch" && git apply "$here/recipe/lean4-v4.32.2-mac.patch")
  fi
  # Lean/Environment.lean: the reader skips a missing `.olean.private` (§7), and
  # registering a persistent env extension no longer recurses once per extension
  # already registered (Safari's worker stack, §8). Applied to an older checkout
  # too; a change here means `rm c/Lean/Environment.c` and `objs engine`.
  (cd lean4 && { git apply --reverse --check "$here/recipe/lean4-v4.32.2-env.patch" 2>/dev/null ||
    { git checkout -q src/Lean/Environment.lean && git apply "$here/recipe/lean4-v4.32.2-env.patch"; }; })
fi

if has c; then
  (cd $T/lib/lean && find Init Std Lean -name '*.olean' | sed 's/\.olean$//'; printf 'Init\nStd\nLean\n') | sort -u > modules.txt
  genc() {  # one module: native lean -c, against the toolchain's own oleans
    m=$1; mkdir -p "c/$(dirname "$m")"; [ -s "c/$m.c" ] && return 0
    LEAN_PATH=$T/lib/lean $T/bin/lean -R lean4/src -Dcompiler.postponeCompile=false \
      -c "c/$m.c.tmp" "lean4/src/$m.lean" > "c/$m.log" 2>&1 && mv "c/$m.c.tmp" "c/$m.c" && rm -f "c/$m.log" || echo "FAIL c $m"
  }
  export -f genc; export T
  xargs -P "$J" -I{} bash -c 'genc {}' < modules.txt
fi

if has cpp; then
  emsdk_env
  [ -f $B/CMakeCache.txt ] || emcmake cmake -S lean4/src -B $B -DSTAGE=1 -DPREV_STAGE=$W/build/noprev \
    -DCMAKE_BUILD_TYPE=Release -DUSE_MIMALLOC=OFF -DUSE_GMP=OFF -DMMAP=OFF \
    -DCMAKE_AR="$(which emar)" -DCMAKE_C_COMPILER_WORKS=1
  make -C $B -j"$J" leancpp leanrt leanshell leanmain
fi

CFLAGS=(-O3 -DNDEBUG -pthread -fwasm-exceptions -ffp-contract=off -Wno-unused-command-line-argument -I$B/include)

if has objs; then
  emsdk_env
  cc1() {
    m=$1; mkdir -p "o/$(dirname "$m")"; [ "o/$m.o" -nt "c/$m.c" ] && return 0
    emcc -c -O3 -DNDEBUG -pthread -fwasm-exceptions -ffp-contract=off -Wno-unused-command-line-argument \
      -I$B/include "c/$m.c" -o "o/$m.o" || echo "FAIL o $m"
  }
  export -f cc1; export B
  xargs -P "$J" -I{} bash -c 'cc1 {}' < modules.txt
  mkdir -p lib out
  for P in Init Std Lean; do
    rm -f lib/lib$P.a
    (find o/$P -name '*.o'; echo o/$P.o) | sort > lib/$P.list
    emar rcs lib/lib$P.a $(cat lib/$P.list)
  done
  python3 "$here/gen-symtab.py" out/symtab.c c Init
  emcc -c -O2 "${CFLAGS[@]}" out/symtab.c -o out/symtab.o
fi

LINK=(-Llib -L$B/lib/lean -lleancpp -lInit -lStd -lLean -lleanrt $B/libuv/src/libuv/libuv.a -lstdc++ -lm
  -s ALLOW_MEMORY_GROWTH=1 -s MAXIMUM_MEMORY=4GB -fwasm-exceptions -pthread
  -s ERROR_ON_UNDEFINED_SYMBOLS=0 -s STACK_SIZE=8MB -s PTHREAD_POOL_SIZE=4 -s FORCE_FILESYSTEM=1)

if has cli; then
  emsdk_env; mkdir -p out/cli
  emcc $B/lib/temp/libleanmain.a out/symtab.o $B/lib/temp/libleanshell.a "${LINK[@]}" -lnodefs.js \
    -s EXIT_RUNTIME=1 -s EXPORTED_FUNCTIONS=_main,_malloc,_free -s EXPORTED_RUNTIME_METHODS=FS,callMain,ENV \
    -O1 -o out/cli/lean.js
fi

if has oleans; then
  node "$here/gen-oleans.mjs" out/cli/lean.js lean4/src out/lib/lean -j "$((J - 1))" Init
fi

if has engine; then
  emsdk_env; mkdir -p live out/web
  # the engine and the one module of ours it imports (ProofTreeBake: tagged
  # goals), as LAKE compiled them: Lake prefixes the package's symbols
  # (`lp_ppharness_…`, `initialize_ppharness_…`), and a hand-run `lean -c`
  # of one module would not match the other's references
  (cd "$repo/lean" && lake build playgroundlive >/dev/null)
  for m in ProofTreeBake PlaygroundLive; do cp "$repo/lean/.lake/build/ir/$m.c" live/$m.c; done
  sed 's/initialize_LiveEngine/initialize_ppharness_PlaygroundLive/g' "$here/live_shim.c" > live/live_shim.c
  for f in ProofTreeBake PlaygroundLive live_shim; do emcc -c "${CFLAGS[@]}" live/$f.c -o live/$f.o; done
  emcc live/live_shim.o live/PlaygroundLive.o live/ProofTreeBake.o out/symtab.o "${LINK[@]}" -s EXIT_RUNTIME=0 \
    -s EXPORTED_FUNCTIONS=_main,_malloc,_free,_ramify_init,_ramify_answer \
    -s EXPORTED_RUNTIME_METHODS=FS,ENV,ccall,UTF8ToString -O2 -o out/web/live.js
  # the oleans the engine imports, WITHOUT `.olean.private` (187 of 275 MB): the
  # engine imports Init at the exported level, and the reader (mac patch) skips
  # a missing private part — 36,179/36,179 identical (docs/wasm-spike.md §7)
  (cd out/lib/lean && find Init.* Init -type f ! -name '*.ilean' ! -name '*.olean.private' | sort > ../../init.list &&
    COPYFILE_DISABLE=1 tar --format=ustar -cf ../../web/init.tar -T ../../init.list)
  ls -la out/web
fi
