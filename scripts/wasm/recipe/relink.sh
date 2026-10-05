#!/bin/bash
# relink.sh OUTDIR [extra emcc flags]  -- detached
D=$1; shift
mkdir -p /tmp/claude-0/wasm/$D
EXTRA_OBJS=/tmp/claude-0/wasm/out/symtab.o /tmp/claude-0/wasm/link-static.sh /tmp/claude-0/wasm/$D/lean.js -s EXPORTED_FUNCTIONS=_main,_malloc,_free -s EXPORTED_RUNTIME_METHODS=FS,callMain,ENV -s FORCE_FILESYSTEM=1 "$@" > /tmp/claude-0/wasm/$D.log 2>&1
