#!/usr/bin/env bash
# Prepare the `main` INSTALL branch from `dev`, reproducibly.
#
#     scripts/sync-main.sh                    dry run: say what would change
#     scripts/sync-main.sh --apply            do it, in a worktree of main
#     scripts/sync-main.sh --apply --working-tree
#                                             take files from the working tree
#                                             instead of the committed dev
#     scripts/sync-main.sh --worktree PATH    where the worktree lives
#                                             (default: ../ramify-lean4-main)
#
# `main` is a hand-copied SUBSET of dev: the installable package (dist/), the
# Lean sources it shares, the widget bundle, the extension, and the user docs.
# This script is that subset written down. It never commits, never pushes and
# never touches your working tree on dev; --apply writes only into a worktree of
# `main`, where you then `git status`, `git diff`, commit and push by hand.
#
# Where each file comes from:
#   * by default, from the COMMITTED `dev` (what a release would ship), so
#     uncommitted edits cannot leak into the install branch. Files that differ
#     in the working tree are listed as a warning.
#   * README.md is DIFFERENT on main: it is the user-facing page, not dev's
#     developer README. Its source is docs/README.main.md on dev.
#   * .gitignore is main's own (Lake artifacts only) and is left alone.
#   * dist/ramify-<version>.vsix is whichever single .vsix dev tracks; older
#     ones on main are removed.
#
# Needs: git, and a fetched origin (`git fetch origin` is run for you).
# no `-u`: macOS ships bash 3.2, where an empty array trips it
set -eo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

apply=0
worktree=""
src="dev"          # git ref to read from, or "" for the working tree
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --working-tree) src="" ;;
    --worktree) shift; worktree=${1:?--worktree needs a path} ;;
    -h|--help) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "sync-main.sh: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$worktree" ] || worktree="$(cd "$root/.." && pwd)/ramify-lean4-main"

git fetch --quiet origin
git rev-parse --verify --quiet origin/main >/dev/null || { echo "no origin/main" >&2; exit 1; }
if [ -n "$src" ]; then git rev-parse --verify --quiet "$src" >/dev/null || { echo "no ref $src" >&2; exit 1; }; fi

# ---- the manifest: every path main carries, as "<path-on-main>:<source-on-dev>"
# A bare path means the same path on dev.
if [ -z "$src" ]; then
  # working-tree mode: whatever .vsix sits in dist/
  tracked_vsix=$(cd "$root" && ls dist/ramify-*.vsix 2>/dev/null || true)
else
  tracked_vsix=$(git ls-tree -r --name-only "$src" -- dist | grep '^dist/ramify-.*\.vsix$' || true)
fi
if [ "$(printf '%s\n' "$tracked_vsix" | grep -c .)" -ne 1 ]; then
  echo "expected exactly one dist/ramify-<version>.vsix on ${src:-the working tree}, found:" >&2
  printf '  %s\n' $tracked_vsix >&2
  exit 1
fi

manifest=(
  LICENSE
  NOTICE
  INSTALL.md
  SECURITY.md
  CHANGELOG.md
  "README.md:docs/README.main.md"
  dist/Demo.lean
  dist/ProofTreeTour.lean
  dist/lake-manifest.json
  dist/lakefile.toml
  dist/lean-toolchain
  "$tracked_vsix"
  ext/ramify/.vscodeignore
  ext/ramify/LICENSE
  ext/ramify/README.md
  ext/ramify/CHANGELOG.md
  ext/ramify/extension.js
  ext/ramify/package.json
  lean/ProofTreeComments.lean
  lean/ProofTreeRecover.lean
  lean/Ramify.lean
  web/dist/proofTreeWidget.js
)
# Files main has that this script deliberately never writes or removes.
keep_main=(.gitignore)

dest_of() { echo "${1%%:*}"; }
src_of()  { case "$1" in *:*) echo "${1#*:}" ;; *) echo "$1" ;; esac; }

# read a file's bytes from the chosen source
have_src() { if [ -n "$src" ]; then git cat-file -e "$src:$1" 2>/dev/null; else [ -f "$root/$1" ]; fi; }
cat_src()  { if [ -n "$src" ]; then git show "$src:$1"; else cat "$root/$1"; fi; }
cat_main() { git show "origin/main:$1"; }

in_list() { local x=$1; shift; local y; for y in "$@"; do [ "$x" = "$y" ] && return 0; done; return 1; }

main_files=$(git ls-tree -r --name-only origin/main)
dests=(); for e in "${manifest[@]}"; do dests+=("$(dest_of "$e")"); done

added=(); changed=(); same=(); missing=(); removed=()
for e in "${manifest[@]}"; do
  d=$(dest_of "$e"); s=$(src_of "$e")
  if ! have_src "$s"; then missing+=("$d   (source $s not on ${src:-the working tree})"); continue; fi
  if ! grep -qxF "$d" <<<"$main_files"; then added+=("$d"); continue; fi
  if cmp -s <(cat_src "$s") <(cat_main "$d"); then same+=("$d"); else changed+=("$d"); fi
done
while IFS= read -r f; do
  in_list "$f" "${dests[@]}" && continue
  in_list "$f" "${keep_main[@]}" && continue
  removed+=("$f")
done <<<"$main_files"

# warn about manifest files whose committed dev version is not the working tree's
dirty=()
if [ -n "$src" ]; then
  for e in "${manifest[@]}"; do
    s=$(src_of "$e")
    [ -f "$root/$s" ] || { have_src "$s" && dirty+=("$s   (deleted in the working tree)"); continue; }
    have_src "$s" || { dirty+=("$s   (untracked or uncommitted on dev)"); continue; }
    cmp -s <(git show "$src:$s") "$root/$s" || dirty+=("$s   (modified in the working tree)")
  done
fi

show() { local title=$1; shift; printf '%s (%d)\n' "$title" "$#"; local x; for x in "$@"; do printf '    %s\n' "$x"; done; }

echo "main install branch  <-  ${src:-working tree} of $(git rev-parse --abbrev-ref HEAD)   [origin/main $(git rev-parse --short origin/main)]"
echo "main carries ${#dests[@]} files (plus kept: ${keep_main[*]})"
echo
show "unchanged" "${same[@]}"
show "would CHANGE on main" "${changed[@]}"
show "would ADD to main" "${added[@]}"
show "would REMOVE from main" "${removed[@]}"
show "SOURCE MISSING (skipped)" "${missing[@]}"
if [ -n "$src" ]; then echo; show "manifest files whose working tree differs from committed $src (not used; commit them, or pass --working-tree)" "${dirty[@]}"; fi
echo

if [ "$apply" -eq 0 ]; then
  echo "dry run: nothing written. --apply writes into a worktree at $worktree"
  [ "${#missing[@]}" -eq 0 ] || echo "note: ${#missing[@]} source file(s) missing; --apply would refuse until they exist."
  exit 0
fi

[ "${#missing[@]}" -eq 0 ] || { echo "refusing to apply: source files missing (above)" >&2; exit 1; }

# ---- apply, into a worktree of main
# Local `main` must be origin/main or behind it: this script diffs against
# origin/main, so writing onto a `main` that has moved on (or diverged) would
# mix two bases. Behind -> fast-forward it; diverged -> refuse.
sync_local_main() { # $1 = worktree path (already on main), or "" for the ref alone
  local head; head=$(git rev-parse refs/heads/main)
  local remote; remote=$(git rev-parse origin/main)
  [ "$head" = "$remote" ] && return 0
  if git merge-base --is-ancestor "$head" "$remote"; then
    echo "local main ($(git rev-parse --short "$head")) is behind origin/main ($(git rev-parse --short "$remote")): fast-forwarding"
    if [ -n "$1" ]; then git -C "$1" merge --ff-only origin/main
    else git branch -f main origin/main; fi
  else
    echo "refusing to apply: local main ($(git rev-parse --short "$head")) is not origin/main ($(git rev-parse --short "$remote")) or an ancestor of it —" >&2
    echo "it has commits origin/main lacks. Reconcile by hand (git log origin/main..main), then re-run." >&2
    exit 1
  fi
}

if [ -e "$worktree/.git" ]; then
  echo "reusing worktree $worktree"
  branch=$(git -C "$worktree" rev-parse --abbrev-ref HEAD)
  [ "$branch" = "main" ] || { echo "$worktree is on '$branch', not main" >&2; exit 1; }
  sync_local_main "$worktree"
elif git show-ref --verify --quiet refs/heads/main; then
  # a local main that is not checked out anywhere: verify it before it is used
  sync_local_main ""
  git worktree add "$worktree" main
else
  git worktree add -b main "$worktree" origin/main
fi

for e in "${manifest[@]}"; do
  d=$(dest_of "$e"); s=$(src_of "$e")
  mkdir -p "$worktree/$(dirname "$d")"
  cat_src "$s" > "$worktree/$d"
  # keep the executable bit where dev has it
  [ -x "$root/$s" ] && chmod +x "$worktree/$d" || true
done
for f in "${removed[@]}"; do command rm -f "$worktree/$f"; done

echo "written to $worktree (main; nothing committed, nothing pushed):"
git -C "$worktree" status --short
echo
echo "next: review with  git -C $worktree diff  , then commit and push main yourself."
