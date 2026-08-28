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
# ppharness records each record's `file` as the path it was HANDED, and lake has
# to run from lean/, so the paths going in are absolute. The app shows that field
# in its footer and the file is TRACKED, so the author's home directory would be
# committed and displayed; strip the repo root back off on the way out, leaving
# `proofs/euclid.lean` — the path a reader of this repository can actually use.
lake env lake exe ppharness "$ROOT"/proofs/*.lean \
  | sed "s|\"file\":\"$ROOT/|\"file\":\"|g" > "$OUT"

echo "wrote $OUT ($(grep -c . "$OUT") proof(s))"
