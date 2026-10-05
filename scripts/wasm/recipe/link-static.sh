#!/bin/bash
# Relink the wasm `lean` WITHOUT MAIN_MODULE/EXPORT_ALL (V8 caps a module at 100k exports).
# emcc directly (leanc.sh adds -flto, which pulls LTO libc in after LTO: "attempt to add bitcode file after LTO").
source /tmp/claude-0/wasm/env.sh
OUT=${1:-/tmp/claude-0/wasm/out/lean.js}; shift
B=/tmp/claude-0/wasm/build/stage1
start=$(date +%s)
emcc $B/lib/temp/libleanmain.a ${EXTRA_OBJS} $B/lib/temp/libleanshell.a \
  -L$B/lib/lean -lleancpp -lInit -lStd -lLean -lleanrt $B/libuv/src/libuv/libuv.a -lstdc++ -lm \
  -s ALLOW_MEMORY_GROWTH=1 -s MAXIMUM_MEMORY=4GB -fwasm-exceptions -pthread -lnodefs.js \
  -s EXIT_RUNTIME=1 -s ERROR_ON_UNDEFINED_SYMBOLS=0 -s STACK_SIZE=8MB -s PTHREAD_POOL_SIZE=4 \
  "$@" -O3 -o "$OUT"
echo "LINK_EXIT=$? SECONDS=$(( $(date +%s) - start ))"
