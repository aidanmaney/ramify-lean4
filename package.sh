#!/usr/bin/env bash
# Build everything a user needs to INSTALL this project, and check it.
#
# Two artifacts, both landing in dist/:
#
#   dist/../web/dist/proofTreeWidget.js   the renderer bundle (a Lean build
#                                         input via include_str — tracked in
#                                         git for exactly that reason)
#   dist/proof-tree-companion-<v>.vsix    the optional VS Code companion
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
lake build ProofTreeWidget

echo
echo "==> VS Code companion extension (.vsix)"
cd "$root/ext/proof-tree-companion"
rm -f ./*.vsix
# --allow-missing-repository: this is distributed as a file, not from the
# Marketplace.
#
# NO --skip-license. It used to be passed here on the ground that "the
# repository's own licence covers it", which was false twice over: there was no
# LICENSE file at all, and vsce only ever looks NEXT TO package.json — a
# licence at the repo root is invisible to it. The flag silenced the warning
# that was telling the truth, and every .vsix ever shipped went out with no
# licence inside it. The fix is the file, not the flag:
# `ext/proof-tree-companion/LICENSE` is a copy of the root MIT licence, and
# vsce packages it as `extension/LICENSE.txt` (verified by unzipping the
# result, not by trusting the absence of a warning).
npx --yes @vscode/vsce package --allow-missing-repository >/dev/null
vsix=$(ls ./*.vsix)
mkdir -p "$root/dist"
cp "$vsix" "$root/dist/"

echo
echo "==> done"
echo "    $root/web/dist/proofTreeWidget.js"
echo "    $root/dist/$(basename "$vsix")"
echo
echo "Install instructions: INSTALL.md"
