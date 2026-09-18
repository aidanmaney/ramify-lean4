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

# B4's automation traces are ON: every `simp`/`grind`/`aesop` in a file is
# rewritten to its `?` form and the file re-elaborated ONCE, so the corpus
# carries what closed each automation step and the harness can show it with no
# server. That "once per file, not once per site" is what makes it affordable —
# MEASURED over this corpus: 167.0s without, 171.0s with, i.e. +3.9s (2.3%),
# because the cost of these files is Mathlib's import and not the elaboration.
# `--no-traces` is the escape hatch.
TRACES="--traces"
# D4's linters are ON: Mathlib's own `linter.*` options ride the ONE
# elaboration this harness already runs, so they cost the linter passes and not
# a second pass over the file. MEASURED over this corpus: 176.5s without,
# 173.0s with — the difference is inside the run-to-run noise, because the cost
# of these files is Mathlib's import and not the elaboration. It is also
# BYTE-IDENTICAL today: proofs/ has zero lints, which is the finding.
# `--no-lint` is the escape hatch.
LINT="--lint"
for a in "$@"; do
  case "$a" in
    --traces) TRACES="--traces" ;;
    --no-traces) TRACES="" ;;
    --lint) LINT="--lint" ;;
    --no-lint) LINT="" ;;
    *) echo "gen.sh: unknown option $a" >&2; exit 2 ;;
  esac
done

cd "$ROOT/lean"
echo "building ppharness…"
lake build ppharness >/dev/null

echo "parsing $ROOT/proofs/*.lean (import Mathlib loads Mathlib — first run is slow)…"
# ppharness records each record's `file` as the path it was HANDED, and lake has
# to run from lean/, so the paths going in are absolute. The app shows that field
# in its footer and the file is TRACKED, so the author's home directory would be
# committed and displayed; strip the repo root back off on the way out, leaving
# `proofs/euclid.lean` — the path a reader of this repository can actually use.
# One process per file: a single run over the whole corpus is killed
# (exit 137) part-way through, each file's Mathlib import staying resident.
for f in "$ROOT"/proofs/*.lean; do lake env lake exe ppharness "$f" $TRACES $LINT; done \
  | sed "s|\"file\":\"$ROOT/|\"file\":\"|g" > "$OUT"

echo "wrote $OUT ($(grep -c . "$OUT") proof(s))"
