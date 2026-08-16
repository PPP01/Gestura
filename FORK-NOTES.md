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
| `firefox-build` | **Firefox build.** `main` + Firefox commits (Firefox manifest, `menu-patterns.js` via `background.scripts` + `importScripts` guard, Chrome-only entries dropped, AMO-listed distribution). Load this in Firefox. See "Firefox" below. | **merged** from `main` — never rebased |
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

# 2. carry the updated main into the Firefox build — merge, never rebase
git checkout firefox-build
git merge main
#   conflicts: manifest.json (keep the Firefox form, take main's version),
#   and CHANGELOG.md on release merges
git push gestura firefox-build

git checkout main
```

Rebase rewrites history, hence the `--force-with-lease` push on `main` (fine for
a solo-maintained fork). Because Gestura is a small linear stack, conflicts are
localized and rare (mostly the ~40 `_locales` files). Do *not* rebase
`feature/search-links` (130 commits = pain); it is only kept for reference.

### Why `main` rebases but `firefox-build` merges

Not an inconsistency — the two branches have different jobs.

`main` is replayed onto `upstream/main` so it stays a clean, inspectable patch
stack; that stack is the thing that could theoretically go upstream one day
(see the last section). `firefox-build` goes nowhere: it is only built and
signed. Two things make merging the better fit there:

- **Conflicts stay small.** A merge resolves against the previous merge base, so
  each release only re-decides what changed since — not the whole Firefox
  manifest shape. A rebase replays every Firefox commit onto a base it has never
  seen and re-fights the same `manifest.json` conflict every time. (`git config
  rerere.enabled true` would soften that, but it is not set.)
- **Shipped commits keep their hashes.** Each `release(ff): x.y.z` commit is the
  exact source of a signed artifact published on AMO. Rebasing would give it a
  new hash and tree, and "which commit was 2.6.1?" stops being answerable.

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

Gestura is distributed **AMO-listed** (`a8eb50a`): Mozilla hosts, signs and
updates it. There is no self-hosting — no `update_url`, no `updates.json`.

**Full build / sign guide:**
[`docs/firefox-build-guide.md`](docs/firefox-build-guide.md) (on the
`firefox-build` branch). Quick reference:

- Develop: `npm run ff:run`
- Ship a version: **`npm run ff:release`**. It prompts for the AMO key and
  secret (the secret is not echoed) and passes them to `web-ext` through the
  environment, so they never reach your shell history — always prefer it over
  calling `ff:sign` with `--api-key=…` on the command line.
- Once the signed `.xpi` lands in `web-ext-artifacts/`, the version is public
  and installed copies auto-update via AMO.

`ff:release` bumps the version before signing, because AMO refuses a number it
has already signed and the script cannot know whether the current one went out.
The third digit is the Firefox build counter for `main`'s feature set — 2.6 →
`2.6.1` means "first Firefox build of the 2.6 features". Note that `2.6` and
`2.6.0` are the *same* version to Firefox (missing parts count as 0), which is
why the bump skips `2.6.0`.

If you already raised the version yourself — usually by taking it from `main`
during the merge — skip the bump and keep your number:

```bash
npm run ff:release -- --no-bump
```

## If you ever re-attempt an upstream PR

Exclude `docs/plans/`, `docs/dev/`, `docs/superpowers/`, `docs/store/`, and
`FORK-NOTES.md` — they must not ship upstream, and drop the rebrand commits. Base
the PR branch directly on `upstream/main`.
