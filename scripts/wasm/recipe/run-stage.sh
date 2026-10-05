#!/bin/bash
source /tmp/claude-0/wasm/env.sh
cd /tmp/claude-0/wasm
T="$1"; LOG="$2"
start=$(date +%s)
make -C build $T -j4 > "$LOG" 2>&1
echo "EXIT=$? SECONDS=$(( $(date +%s) - start ))" >> "$LOG"
