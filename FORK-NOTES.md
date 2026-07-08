# Fork maintenance notes

**This fork is published as its own extension, "Gestura".** Upstream declined the
search-engine/menu PR (they want to keep FlowMouse lightweight and gesture-focused),
so the feature — and now the Gestura rebrand — live here. These notes keep future
upstream (FlowMouse) updates cheap to merge.

Gestura is a small linear stack of commits (the feature commit + the rebrand)
on top of `upstream/main`, published as the `main` branch. Branding is
**user-facing only** — internal `FlowMouse*` code identifiers are left untouched
to minimise rebase conflicts. See
`docs/superpowers/specs/2026-07-08-gestura-rebrand-design.md`.

## Remotes

- `gestura`  → your Gestura repo (`PPP01/Gestura`, SSH) — where you publish
- `upstream` → original FlowMouse  (`Hmily-LCG/FlowMouse`) — where updates come from
- `origin`   → legacy personal FlowMouse fork (`PPP01/FlowMouse`) — no longer used

**SSH from Git Bash on Windows:** the bundled MSYS `ssh` doesn't see the Windows
ssh-agent, so pushes fail with `Permission denied (publickey)`. Point git at the
native Windows OpenSSH instead:
`git config core.sshCommand "C:/Windows/System32/OpenSSH/ssh.exe"` (already set
repo-local; add `--global` to apply everywhere).

## Branch roles

| Branch | Role | Keep it… |
|---|---|---|
| `main` | **Your Gestura product (Chrome/Edge).** The Gestura commits (feature + rebrand) stacked on `upstream/main`. Default branch; this is what you load as the unpacked extension. | rebased on `upstream/main` |
| `firefox-build` | **Firefox build.** `main` + Firefox commits (Firefox manifest, `menu-patterns.js` via `background.scripts` + `importScripts` guard, Chrome-only entries dropped, AMO-listed distribution). Load this in Firefox. See "Firefox" below. | rebased on `main` |
| `feature/search-links` | Full 130-commit development history + the plans/recon docs + the personal-engines migration snippet (`docs/dev/`). Archive — don't rebase. | untouched |
| `firefox-test` | Old Firefox branch (built on the 130-commit history). Backup — safe to delete once `firefox-build` is confirmed. | — |

> Historical note: the Gestura work used to live on a `feature/search-engine-suite`
> branch with `main` kept as a pristine `upstream/main` mirror. That mirror was
> redundant (identical to `upstream/main`, which `upstream` already provides), so
> the product now *is* `main` and the feature branch was dropped.

## Updating from upstream

Updates come from the `upstream` **remote** — there is no mirror branch to keep
in sync. You replay your Gestura commits on top of the latest FlowMouse:

```bash
git fetch upstream

# 1. replay your Gestura commits onto the new upstream
git checkout main
git rebase upstream/main
#   resolve conflicts only in files both sides touched
#   (usually a few _locales/* files — always keep "Gestura"), then:
git push --force-with-lease gestura main

# 2. replay the Firefox build on top of the updated main
git checkout firefox-build
git rebase main
git push --force-with-lease gestura firefox-build

git checkout main
```

Rebase rewrites history, hence the `--force-with-lease` push (fine for a
solo-maintained fork). Because Gestura is a small linear stack, conflicts are
localized and rare (mostly the ~40 `_locales` files). Do *not* rebase
`feature/search-links` (130 commits = pain); it is only kept for reference.

## Personal (German) search engines

The neutral catalog ships without region-specific engines. Your own German
engines and `.de` domains live in the browser's synced settings, restored
once via the console snippet:

    docs/dev/migrate-personal-engines.snippet.js   (on the feature/search-links branch)

They are stored as settings data, not code, so they never affect a rebase.

## Firefox

`firefox-build` swaps the Chrome service-worker manifest for a Firefox one.
`web-ext lint` → 0 errors. Known gaps (Firefox lacks the APIs): the JS-transform
sandbox (`offscreen`), engine favicons (`favicon`), and save-as-MHTML
(`pageCapture`). The core search/menu features work.

### Packaging / permanent install

A temporary add-on (`about:debugging`) disappears on Firefox restart. For a
build a `.zip`/`.xpi`:

```bash
git checkout firefox-build
npx web-ext build --overwrite-dest   # writes web-ext-artifacts/*.zip (rename to .xpi)
```

A permanent install needs a **signed** `.xpi`. Two paths:

- **Regular Firefox** installs only signed extensions. Sign it as an *unlisted*
  add-on via a free Mozilla add-on account + API key:
  `npx web-ext sign --channel=unlisted --api-key=… --api-secret=…`
  → produces a signed `.xpi` installable in normal Firefox.
- **Developer Edition / Nightly / ESR** can install an unsigned `.xpi` after
  setting `xpinstall.signatures.required = false` in `about:config`.

## If you ever re-attempt an upstream PR

Exclude `docs/plans/`, `docs/dev/`, `docs/superpowers/`, `docs/store/`, and
`FORK-NOTES.md` — they must not ship upstream, and drop the rebrand commits. Base
the PR branch directly on `upstream/main`.
