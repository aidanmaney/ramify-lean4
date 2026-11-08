#!/usr/bin/env bash
# Move Ramify to another Lean release, with the ProofWidgets and Mathlib that
# go with it.
#
#     scripts/bump-toolchain.sh v4.35.0          rewrite the pins, run lake update
#     scripts/bump-toolchain.sh v4.35.0 --no-lake    rewrite the pins only
#
# What moves, and why each value is what it is:
#   * lean/lean-toolchain, dist/lean-toolchain   the Lean tag itself
#   * lean/lakefile.toml  mathlib rev           Mathlib's tag of the same name
#   * dist/lakefile.toml  proofwidgets rev      the ProofWidgets commit THAT
#                                               Mathlib tag pins (named by its
#                                               tag), so a Mathlib project
#                                               resolves to one copy
#   * the docs that state the current pins (INSTALL.md, docs/README.main.md,
#     README.md, CONTRIBUTING.md, NOTICE, CLAUDE.md, dist/lakefile.toml's note)
#
# Paperproof stays pinned to its commit: upstream moved to the module system, so
# a newer rev is a decision, not a bump. If the build fails because of it, the
# bump's pull request says so.
#
# What does NOT move: the playground's WebAssembly engine (scripts/wasm/), which
# carries its own Lean patches for v4.32.2 and is rebuilt on its own schedule.
# INSTALL.md's table of past releases (between the `releases:` markers) is
# history and is left alone.
#
# Exit codes: 0 bumped (or already there), 3 Mathlib has no tag for this Lean
# release yet (try again later), anything else an error.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

new=${1:?usage: bump-toolchain.sh vX.Y.Z [--no-lake]}
lake_update=1
[ "${2:-}" = "--no-lake" ] && lake_update=0
case "$new" in v4.*) ;; *) echo "bump-toolchain.sh: expected a Lean tag like v4.35.0, got $new" >&2; exit 2 ;; esac

old=$(sed 's/.*://' dist/lean-toolchain | tr -d '[:space:]')
pw_old=$(sed -n '/^name = "proofwidgets"/,/^rev/{s/^rev = "\(.*\)"/\1/p}' dist/lakefile.toml)
[ -n "$pw_old" ] || { echo "bump-toolchain.sh: no proofwidgets rev in dist/lakefile.toml" >&2; exit 1; }

if [ "$new" = "$old" ]; then
  echo "already on $new"
  exit 0
fi

# The ProofWidgets tag Mathlib pins at this release. No Mathlib tag yet means
# the release is too fresh to follow.
manifest_url="https://raw.githubusercontent.com/leanprover-community/mathlib4/$new/lake-manifest.json"
if ! mathlib_manifest=$(curl -fsSL "$manifest_url"); then
  echo "Mathlib has no tag $new yet ($manifest_url); nothing to do until it does."
  exit 3
fi
# Mathlib's manifest pins ProofWidgets by commit (its own requirement floats on
# `main`); name that commit by its release tag where it has one, as
# dist/lakefile.toml always has.
pw_rev=$(node -e '
  const m = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const p = m.packages.find((p) => p.name === "proofwidgets");
  if (!p) process.exit(1);
  process.stdout.write(p.rev);
' <<<"$mathlib_manifest") || { echo "bump-toolchain.sh: Mathlib $new pins no proofwidgets" >&2; exit 1; }
pw_new=$(git ls-remote --tags https://github.com/leanprover-community/ProofWidgets4 \
  | awk -v r="$pw_rev" '$1 == r { t = $2; sub("refs/tags/", "", t); sub("\\^\\{\\}$", "", t); print t; exit }')
[ -n "$pw_new" ] || pw_new=$pw_rev

echo "Lean         $old -> $new"
echo "Mathlib      $old -> $new"
echo "ProofWidgets $pw_old -> $pw_new"

# Replace literal strings (no regex: the versions are full of dots).
swap() { # file from to
  FROM="$2" TO="$3" perl -0pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/g' "$1"
}
# Same, but leave the lines between `<!-- releases:start -->` and
# `<!-- releases:end -->` alone (the history of what each release was built on).
swap_outside_releases() { # file from to
  FROM="$2" TO="$3" perl -pi -e '
    $in = 1 if /<!-- releases:start -->/;
    s/\Q$ENV{FROM}\E/$ENV{TO}/g unless $in;
    $in = 0 if /<!-- releases:end -->/;
  ' "$1"
}

printf 'leanprover/lean4:%s\n' "$new" > lean/lean-toolchain
printf 'leanprover/lean4:%s\n' "$new" > dist/lean-toolchain

# lean/lakefile.toml: the mathlib requirement's rev (the comments there are
# history and say which release they measured).
perl -0pi -e "s/(name = \"mathlib\"\nscope = \"leanprover-community\"\nrev = \")\Q$old\E\"/\${1}$new\"/" lean/lakefile.toml
grep -q "rev = \"$new\"" lean/lakefile.toml || { echo "bump-toolchain.sh: did not find the mathlib rev in lean/lakefile.toml" >&2; exit 1; }

# dist/lakefile.toml: the proofwidgets rev and the note above it.
swap dist/lakefile.toml "$pw_old" "$pw_new"
swap dist/lakefile.toml "Mathlib $old" "Mathlib $new"

for f in INSTALL.md docs/README.main.md CONTRIBUTING.md; do
  swap_outside_releases "$f" "$old" "$new"
  swap_outside_releases "$f" "$pw_old" "$pw_new"
done
swap README.md "Pinned to **Lean $old**" "Pinned to **Lean $new**"
swap NOTICE "Pinned to $pw_old, which is" "Pinned to $pw_new, which is"
swap NOTICE "what Mathlib $old itself pins" "what Mathlib $new itself pins"
swap CLAUDE.md "Toolchain **Lean $old**, Mathlib \`$old\`" "Toolchain **Lean $new**, Mathlib \`$new\`"

if [ "$lake_update" = 1 ]; then
  # dist/: ProofWidgets moves, Paperproof stays on its commit.
  (cd dist && lake update)
  # lean/: Mathlib moves. Skip Mathlib's post-update cache download (gigabytes
  # of oleans nothing here needs to rewrite a manifest).
  (cd lean && MATHLIB_NO_CACHE_ON_UPDATE=1 lake update mathlib)
fi

echo "done: $old -> $new"
