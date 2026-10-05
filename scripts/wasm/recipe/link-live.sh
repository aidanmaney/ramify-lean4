#!/bin/bash
# link-live.sh OUTDIR [extra emcc flags] -- the LiveEngine wasm: shim main + LiveEngine + symtab + Lean libs
source /tmp/claude-0/wasm/env.sh
D=/tmp/claude-0/wasm/$1; shift; mkdir -p $D
B=/tmp/claude-0/wasm/build/stage1; L=/tmp/claude-0/wasm/live
start=$(date +%s)
emcc $L/live_shim.o $L/LiveEngine.o /tmp/claude-0/wasm/out/symtab.o \
  -L$B/lib/lean -lleancpp -lInit -lStd -lLean -lleanrt $B/libuv/src/libuv/libuv.a -lstdc++ -lm \
  -s ALLOW_MEMORY_GROWTH=1 -s MAXIMUM_MEMORY=4GB -fwasm-exceptions -pthread \
  -s EXIT_RUNTIME=0 -s ERROR_ON_UNDEFINED_SYMBOLS=0 -s STACK_SIZE=8MB -s PTHREAD_POOL_SIZE=4 \
  -s EXPORTED_FUNCTIONS=_main,_malloc,_free,_ramify_init,_ramify_answer \
  -s EXPORTED_RUNTIME_METHODS=FS,ENV,ccall,UTF8ToString -s FORCE_FILESYSTEM=1 \
  "$@" ${OPT:--O3} -o $D/live.js > $D.log 2>&1
echo "LINK_EXIT=$? SECONDS=$(( $(date +%s) - start ))" >> $D.log
