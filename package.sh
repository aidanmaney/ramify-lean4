#!/usr/bin/env bash
# Build everything a user needs to INSTALL this project, and check it.
#
# Two artifacts, both landing in dist/:
#
#   dist/../web/dist/proofTreeWidget.js   the renderer bundle (a Lean build
#                                         input via include_str — tracked in
#                                         git for exactly that reason)
#   dist/ramify-<v>.vsix              the optional VS Code extension
#
# and refreshes dist/ProofTreeTour.lean from lean/ProofTreeTour.lean.
#
# and one check: that dist/ — the minimal, Mathlib-free Lake package a user
# actually depends on — really does build from those sources. See INSTALL.md.
set -euo pipefail
cd "$(dirname "$0")"
root=$(pwd)

echo "==> renderer bundle (web/dist/proofTreeWidget.js)"
cd "$root/web"
[ -d node_modules ] || npm install
npm run build:widget

echo
echo "==> typecheck + lint (the bundle is shipped; it should not ship broken)"
npm run typecheck
npm run lint

echo
echo "==> installable Lake package builds (no Mathlib)"
cd "$root/dist"
lake build Ramify

echo
echo "==> VS Code extension (.vsix)"
cd "$root/ext/ramify"
rm -f ./*.vsix
# No --allow-missing-repository: ext/ramify/package.json carries a
# `repository` field, so vsce has nothing to warn about. If that field is ever
# dropped this step fails, which is the point.
#
# NO --skip-license. It used to be passed here on the ground that "the
# repository's own licence covers it", which was false twice over: there was no
# LICENSE file at all, and vsce only ever looks NEXT TO package.json — a
# licence at the repo root is invisible to it. The flag silenced the warning
# that was telling the truth, and every .vsix ever shipped went out with no
# licence inside it. The fix is the file, not the flag:
# `ext/ramify/LICENSE` is a copy of the root MIT licence, and
# vsce packages it as `extension/LICENSE.txt` (verified by unzipping the
# result, not by trusting the absence of a warning).
npx --yes @vscode/vsce@4.0.0 package >/dev/null
vsix=$(ls ./*.vsix)
mkdir -p "$root/dist"
# Drop every earlier build first: dist/ tracks exactly one .vsix, and a version
# bump would otherwise leave the old file beside the new one for INSTALL.md to
# point at ambiguously.
command rm -f "$root"/dist/ramify-*.vsix
cp "$vsix" "$root/dist/"

echo
echo "==> dist/ProofTreeTour.lean (copy of lean/ProofTreeTour.lean)"
# INSTALL.md and dist/Demo.lean point users at `ProofTreeTour.lean` sitting
# next to Demo.lean, in the INSTALLABLE package. The tour is authored under
# lean/ with the other demos, but a file under lean/ is served by the
# development package (which requires Mathlib) — vscode-lean4 resolves a file's
# Lake workspace by walking UP from it. So the install surface carries a copy:
# core-only (it imports Ramify and Init only), and byte-identical, which CI
# asserts with `cmp`. Never edit the copy; edit lean/ProofTreeTour.lean.
cp "$root/lean/ProofTreeTour.lean" "$root/dist/ProofTreeTour.lean"

echo
echo "==> done"
echo "    $root/web/dist/proofTreeWidget.js"
echo "    $root/dist/$(basename "$vsix")"
echo
echo "Install instructions: INSTALL.md"
