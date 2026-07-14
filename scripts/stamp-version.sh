#!/bin/sh
# Keeps manifest.json's "version_name" showing the exact loaded commit, so we can
# always tell which build is loaded at chrome://extensions.
#
#   stamp  -> rewrite the working-copy manifest.json version_name to
#             "<version>+<short-hash>[-dirty]" (run by git hooks in .githooks/)
#   clean  -> git "clean" filter (stdin->stdout): strip version_name back to the
#             bare "<version>" so the COMMITTED value never carries a hash and
#             `git status` stays clean even while the working copy shows a hash.
#
# Setup (local, not carried by clone — see CLAUDE.md):
#   git config core.hooksPath .githooks
#   git config filter.fmversion.clean "sh scripts/stamp-version.sh clean"
#   git config filter.fmversion.smudge cat
set -e

mode="$1"

# Extract the numeric "version" value (not version_name / manifest_version) from text.
base_version() {
	sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([0-9.]+)".*/\1/p' | head -1
}

# Replace only the value of the version_name entry, preserving indentation/comma.
set_version_name() {
	sed -E "s/(\"version_name\"[[:space:]]*:[[:space:]]*)\"[^\"]*\"/\1\"$1\"/"
}

case "$mode" in
	clean)
		content="$(cat)"
		ver="$(printf '%s' "$content" | base_version)"
		[ -n "$ver" ] || ver="0"
		printf '%s' "$content" | set_version_name "$ver"
		;;
	stamp)
		root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
		manifest="$root/manifest.json"
		[ -f "$manifest" ] || exit 0
		ver="$(base_version < "$manifest")"
		[ -n "$ver" ] || exit 0
		hash="$(git -C "$root" rev-parse --short HEAD 2>/dev/null)" || exit 0
		dirty=""
		if [ -n "$(git -C "$root" status --porcelain --untracked-files=no 2>/dev/null | grep -v 'manifest\.json$')" ]; then
			dirty="-dirty"
		fi
		name="$ver+$hash$dirty"
		tmp="$manifest.tmp.$$"
		set_version_name "$name" < "$manifest" > "$tmp" && mv "$tmp" "$manifest"
		;;
	*)
		echo "usage: stamp-version.sh clean|stamp" >&2
		exit 2
		;;
esac
