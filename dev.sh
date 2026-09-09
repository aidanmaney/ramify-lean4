#!/usr/bin/env bash
# The fast inner loop for the WIDGET: rebuild what the editor actually loads,
# then say whether the editor has loaded it.
#
#     ./dev.sh            build:widget → lake build Ramify (lean/) → freshness
#     ./dev.sh --check    freshness only (is the running file worker newer
#                         than the olean it must have loaded?)
#     ./dev.sh --all      the full ship: package.sh (dist/, .vsix) after this
#
# Why a second script beside package.sh: the editor's Lake workspace for every
# file under lean/ is the DEVELOPMENT package, so dist/ and the .vsix are not
# on the path from an edit to a pixel; package.sh spends ~1-2 min on them.
# And the bundle only reaches the infoview when the FILE WORKER restarts
# (Restart File) — two rounds of a fix were once measured against a worker
# that predated the build, so the check at the end is the point of the
# script, not a courtesy.
set -euo pipefail
cd "$(dirname "$0")"
root=$(pwd)

freshness() {
  local olean="$root/lean/.lake/build/lib/lean/Ramify.olean"
  [ -f "$olean" ] || { echo "no Ramify.olean built yet"; return; }
  local built; built=$(stat -f %m "$olean")
  echo "Ramify.olean built $(date -r "$built" +%H:%M:%S)"
  local any=0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    any=1
    # `ps -o lstart` prints e.g. "Sun Sep  6 01:20:12 2026"
    local start; start=$(date -j -f "%a %b %d %T %Y" "$(echo "$line" | awk '{print $1,$2,$3,$4,$5}')" +%s 2>/dev/null || echo 0)
    local file; file=$(echo "$line" | sed -n 's/.*file:\/\/\(.*\)$/\1/p')
    if [ "$start" -ge "$built" ]; then
      echo "  worker $(date -r "$start" +%H:%M:%S) ✓ loaded   ${file##*/}"
    else
      echo "  worker $(date -r "$start" +%H:%M:%S) ✗ STALE    ${file##*/}   → Restart File in VS Code (a real click; AXPress does nothing)"
    fi
  done < <(ps -axo lstart,command | grep "lean --worker" | grep -v grep)
  [ "$any" = 1 ] || echo "  no lean file worker running (open a .lean file in VS Code)"
}

case "${1:-}" in
  --check) freshness; exit 0 ;;
esac

echo "==> web: build:widget"
( cd web && npm run build:widget 2>&1 | tail -1 )
echo "==> lean: lake build Ramify"
( cd lean && lake build Ramify 2>&1 | tail -1 )
freshness
if [ "${1:-}" = "--all" ]; then
  echo "==> package.sh"
  ./package.sh
fi
