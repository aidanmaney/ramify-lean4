#!/usr/bin/env bash
# Deploy the live tier to aidanmaney/ramify-live as ONE commit.
#
#   scripts/wasm/deploy-live.sh [--from build-wasm/out/deploy] [--repo URL] [--branch main] [--dry-run]
#
# ramify-live is build output served by GitHub Pages: nobody reads its history,
# but every deploy that changes the engine adds ~47 MB of it, and GitHub warns
# at 1 GB. So each deploy REPLACES the branch with a single orphan commit:
# package-live.mjs's folder plus the repository's own README.md, LICENSE-LEAN
# and LICENSES-LEAN/ as they stand on the branch now. The push is
# --force-with-lease against the commit this script read, so a deploy that
# raced another one fails instead of overwriting it.
#
# This rewrites the published branch: run it yourself, after
# `node scripts/wasm/package-live.mjs` and a look at `--dry-run`'s file list.
set -euo pipefail

FROM=build-wasm/out/deploy
REPO=https://github.com/aidanmaney/ramify-live
BRANCH=main
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM=$2; shift 2 ;;
    --repo) REPO=$2; shift 2 ;;
    --branch) BRANCH=$2; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -f "$FROM/manifest.json" ] || { echo "$FROM/manifest.json not found: run scripts/wasm/package-live.mjs first" >&2; exit 1; }
FROM=$(cd "$FROM" && pwd)
VERSION=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version)' "$FROM/manifest.json")

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# What the branch holds now: its tip (the lease) and the files we keep.
git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$WORK/old"
LEASE=$(git -C "$WORK/old" rev-parse HEAD)

git init --quiet "$WORK/new"
cd "$WORK/new"
git checkout --quiet --orphan "$BRANCH"
cp -R "$FROM"/. .
for keep in README.md LICENSE-LEAN LICENSES-LEAN; do
  [ -e "$WORK/old/$keep" ] && cp -R "$WORK/old/$keep" .
done
git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name || echo ramify)" \
    -c user.email="$(git -C "$OLDPWD" config user.email || echo ramify@localhost)" \
    commit --quiet -m "Live tier $VERSION" -m "One commit by scripts/wasm/deploy-live.sh; the previous history is not kept."

echo "branch $BRANCH of $REPO: $LEASE → one commit, version $VERSION"
git ls-files | while read -r f; do printf '  %10s  %s\n' "$(wc -c < "$f" | tr -d ' ')" "$f"; done
if [ "$DRY" = 1 ]; then echo "(dry run: nothing pushed)"; exit 0; fi
git push --force-with-lease="$BRANCH:$LEASE" "$REPO" "$BRANCH:$BRANCH"
echo "pushed. Pages republishes in a minute; readers' caches follow manifest.json's version."
