# AGENTS.md

**The instructions for this repository live in [CLAUDE.md](CLAUDE.md). Read that
file — all of it — before changing anything here.**

It applies to every coding agent, not just Claude Code: architecture, the
two-branch model, the release procedure, the generated `version_name`, and the
gotchas the test suite enforces.

## Why this file is only a pointer

It used to be a full copy of `CLAUDE.md`, kept in step by hand. It drifted. The
copy fell behind by the paragraph allowing text still being drafted to live in
`en` and `de` alone (via `PENDING_TRANSLATION`), and by the whole section on
`git merge` tripping over the stamped `manifest.json` — so an agent reading only
this file concluded that a rule was being broken when it was not, and filed that
as a review finding. A second one would have had no idea how to merge into
`firefox-build` at all.

Two files claiming to be the same rules will always drift, and the drift is
silent: nothing tests prose. One source of truth is worth more than a copy that
is convenient to reach.

**So do not restore any content here.** Adding "just the important bits" back is
how the copy came about in the first place. If something is missing for agents,
it is missing in `CLAUDE.md` — fix it there.
