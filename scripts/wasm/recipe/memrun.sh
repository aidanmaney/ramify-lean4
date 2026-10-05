#!/bin/bash
# memrun.sh LABEL WASM TRIM
cd /tmp/claude-0/wasm/web && ln -sf "$2" live.wasm
F=/tmp/claude-0/wasm/live/stop.$1; rm -f $F
/tmp/claude-0/wasm/rss.sh $F > /tmp/claude-0/wasm/live/rss.$1.txt &
HOLD_MS=4000 timeout 600 node /home/user/ramify-lean4/scripts/wasm/browser-live.mjs /tmp/claude-0/wasm/web /tmp/claude-0/wasm/live/demo.jsonl $3 > /tmp/claude-0/wasm/live/mem.$1.out 2>&1
touch $F; sleep 0.5
python3 -c "
v=[int(x) for x in open('/tmp/claude-0/wasm/live/rss.$1.txt') if x.strip()]
print('$1: peak %d MB, steady (last 2s) %d MB, samples %d'%(max(v), sorted(v[-10:-2])[4], len(v)))"
grep -c '\"answer\"' /tmp/claude-0/wasm/live/mem.$1.out
