#!/usr/bin/env bash
#
# Regenerate the web app's proof data from the Lean sources in proofs/.
#
# This is the single seam between the two halves of the project: it runs the
# `ppharness` parser (Lean) over every proofs/*.lean and writes the NDJSON the
# web app reads (web/public/sample.ndjson). Run it from anywhere:
#
#     ./gen.sh
#
# `lake env` puts Mathlib's oleans on LEAN_PATH so `import Mathlib` proofs
# elaborate. The web app picks up the new file on its next load.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/web/public/sample.ndjson"

cd "$ROOT/lean"
echo "building ppharness…"
lake build ppharness >/dev/null

echo "parsing $ROOT/proofs/*.lean (import Mathlib loads Mathlib — first run is slow)…"
lake env lake exe ppharness "$ROOT"/proofs/*.lean > "$OUT"

echo "wrote $OUT ($(grep -c . "$OUT") proof(s))"
