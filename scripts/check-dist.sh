#!/usr/bin/env bash
# Build the installable package (dist/) and check that its two Lean files
# elaborate the way they should. CI's `lean` job and the toolchain-bump job
# both run this, so "the package works on this toolchain" means one thing.
#
#   scripts/check-dist.sh            build, then check Demo.lean and the tour
#
# Demo.lean must elaborate cleanly. The tour imports only Ramify and Init; its
# last two theorems (tour_frontier, tour_errors) are BROKEN ON PURPOSE, to show
# unfinished proofs and errors in the tree, so `lean` exits 1 by design. The
# check is that every error sits at or after `theorem tour_frontier`: an import
# failure or an error in the working proofs above it fails. At least one error
# must appear, or the file was not really elaborated.
#
# Output prefixed `::error` is GitHub Actions' annotation syntax; elsewhere it
# is just a line.
set -euo pipefail
cd "$(dirname "$0")/../dist"

lake build

lake env lean Demo.lean

set +e
lake env lean ProofTreeTour.lean > tour.out 2>&1
set -e
cat tour.out
first=$(grep -n '^theorem tour_frontier' ProofTreeTour.lean | head -1 | cut -d: -f1)
[ -n "$first" ] || { echo "::error::no 'theorem tour_frontier' in the tour — update scripts/check-dist.sh"; exit 1; }
errs=$(sed -n 's/^ProofTreeTour\.lean:\([0-9][0-9]*\):[0-9][0-9]*: error.*/\1/p' tour.out)
[ -n "$errs" ] || { echo "::error::the tour produced no errors; its deliberate ones are missing, so it was probably not elaborated"; exit 1; }
bad=0
for l in $errs; do
  if [ "$l" -lt "$first" ]; then
    echo "::error file=lean/ProofTreeTour.lean,line=$l::unexpected error above the deliberately broken theorems"
    bad=1
  fi
done
rm -f tour.out
exit $bad
