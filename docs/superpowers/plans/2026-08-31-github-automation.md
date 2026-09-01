# GitHub automation and `.github` completion

Follow-up to [issue #3](https://github.com/PPP01/Gestura/issues/3). The artefact cleanup
(Chinese issue templates, FlowMouse screenshots, `README.de.md`, `exchange/`) is done;
this plan covers the two remaining items: **the releases are stale** and **`.github/`
is nearly empty**.

## Where we stand

| Fact | Consequence |
|---|---|
| Latest GitHub Release is `v2.3` (2026-07-14); tags exist through `v2.7.0` | The release badge in both READMEs shows 2.3, and the "download from Releases" install path hands people a four-versions-old build |
| No workflow of any kind under `.github/workflows/` | 21 vitest suites / 434 tests never run on push; a broken locale or a bad `$WORD$` placeholder can reach `main` unnoticed |
| Release zip is built by hand (`git archive … HEAD`) | Easy to forget "commit first"; easy to ship a zip that does not match the tag |
| Rules that only live in `CLAUDE.md` prose | `importScripts` vs Firefox `background.scripts`, manifest version vs `CHANGELOG.md` entry vs tag, committed `version_name` must be bare — nothing enforces any of them |
| No `config.yml`, PR template, `CONTRIBUTING.md`, `SECURITY.md` | Issue chooser has no contact links and allows blank issues; drive-by contributors get no guidance; no disclosure address for a security report |
| Repo has no topics, no homepage; Wiki and Projects are on but empty | Poor discoverability, three empty tabs |

## Constraints that shape the design

- **Two branches, merged never rebased.** Anything added on `main` lands on
  `firefox-build` at the next merge. A workflow file must therefore behave correctly
  on both branches, or gate itself on a branch/file check.
- **`web-ext lint` only exists on `firefox-build`** (`web-ext-config.mjs` and the
  `ff:*` scripts are part of that branch's patch set). A single workflow has to
  detect that rather than assume it.
- **`manifest.json` runs through the `fmversion` clean filter.** CI checks out with
  the committed (bare) value, so a *guard* that the committed `version_name` carries
  no `+hash` is cheap and catches a filter that was never configured in a clone.
- **Two tag namespaces**: `vX.Y[.Z]` on `main` (Chrome/Edge), `ff-vX.Y[.Z]` on
  `firefox-build` (AMO). Release automation must not treat `ff-*` as a Chrome release.
- **Push remote is `gestura`**, not `origin` (`origin` is the legacy `PPP01/FlowMouse`
  fork, documented as dead in `FORK-NOTES.md`). Irrelevant to Actions, but relevant to
  every manual `git push` step below.

## Step 1 — CI: run the tests that already exist — **done**

Implemented as a single `.github/workflows/ci.yml` on `main`, which reaches
`firefox-build` through the normal merge. The Firefox steps are guarded on the
presence of `web-ext-config.mjs`, so they skip on `main` and run on `firefox-build`.
Verified: `web-ext lint` against a `firefox-build` worktree reports **0 errors, 10
warnings, exit 0**, and `web-ext build` produces
`web-ext-artifacts/gestura_-_mouse_gestures-<version>.zip`, which the artifact glob
matches. The `version_name` guard from step 2 was folded in here — it fails on a
locally stamped manifest (`2.7.0+56dc205-dirty`) and passes on the committed one.

The original sketch, for reference:

`.github/workflows/ci.yml`, on `push` and `pull_request` for `main` and `firefox-build`:

1. `actions/checkout@v4`, `actions/setup-node@v4` with `node-version: 22`,
   `cache: npm`.
2. `npm ci` — `package-lock.json` is committed, so this is reproducible.
3. `npm test`.
4. Conditional Firefox lint: `if [ -f web-ext-config.mjs ]; then npx web-ext lint
   --source-dir . --config web-ext-config.mjs; fi` — a no-op on `main`, the required
   0-error gate on `firefox-build`.

**Verification:** open a throwaway PR with a deliberately broken locale string and
confirm the run goes red; then confirm a clean PR goes green on both branches.

## Step 2 — CI: turn the CLAUDE.md prose rules into checks

A second job (or a `tests/repo-consistency.test.mjs` suite, which has the advantage of
running locally too — preferred):

- **`version_name` is bare in the committed tree** — read `manifest.json` from
  `git show HEAD:manifest.json`, assert `version_name === version`.
- **`CHANGELOG.md` has a section for the current `manifest.json` version**, unless the
  version's section is still `### Unreleased`.
- **`importScripts` list matches `background.scripts`** — `firefox-build` replaces
  `manifest.json` itself (there is no second manifest file), so the check must branch on
  content, not on a filename: if the manifest has `background.scripts`, compare that
  array against the `importScripts` list parsed out of `js/background.js`; if it has
  `background.service_worker`, skip. That makes it a no-op on `main` and a real gate
  after each merge into `firefox-build`. This is the rule that has no warning today and
  the one most likely to bite.
- **Issue templates parse and EN/DE stay in step** — every `.yml` under
  `.github/ISSUE_TEMPLATE/` loads, and `bug_report.yml` / `bug_report_de.yml` (same for
  `feature_request*`) expose the same field `id`s and the same `required` flags. Cheap
  insurance now that there are two languages to keep aligned.

**Decision needed:** vitest suite (runs locally, needs a YAML dep for the template
check) vs. a separate workflow job (no new dep, only runs in CI). Recommendation:
vitest suite, and add `js-yaml` as a real devDependency — it currently sits in
`node_modules` only as an *extraneous* leftover (`npm ls` confirms: no package.json
entry, pulled in by a since-removed eslint), so `npm ci` in CI would not have it.

## Step 3 — Backfill the missing releases

Four tags have no GitHub Release: `v2.4`, `v2.5`, `v2.6`, `v2.7.0`. For each, build the
zip from the **tag** (not `HEAD`) and publish with the matching `CHANGELOG.md` section
as the body:

```sh
git archive --format=zip -o web-ext-artifacts/gestura-2.7.0-chrome.zip v2.7.0 \
  manifest.json js _locales icons pages css LICENSE NOTICE THIRD_PARTY_LICENSES.md
gh release create v2.7.0 web-ext-artifacts/gestura-2.7.0-chrome.zip \
  --repo PPP01/Gestura --title "Gestura v2.7.0" --notes-file <section>
```

Publish oldest-first so that "Latest" ends up on `v2.7.0`. Do the same for the AMO line
(`ff-v2.5.1`, `ff-v2.6.1`, `ff-v2.7.0`) **only if** we want the xpi on GitHub as well —
open question, since AMO already hosts the signed build.

**Verification:** the release badge in `README.md` / `README.de.md` shows 2.7.0, and
each release's zip loads unpacked and reports its own version in `chrome://extensions`.

## Step 4 — Release workflow

`.github/workflows/release.yml`, triggered on `push` of tag `v*` (explicitly **not**
`ff-v*`):

1. Checkout the tag.
2. Guard: `manifest.json`'s `version` equals the tag minus the `v`. Fail loudly on a
   mismatch — this is the failure mode that put a wrong zip in a store.
3. Guard: `CHANGELOG.md` contains a `### v<version>` section; extract it as the body.
4. `git archive` the same file list as above into
   `web-ext-artifacts/gestura-<version>-chrome.zip`.
5. `gh release create` (or `softprops/action-gh-release`) with that zip and body.

Firefox stays manual for now, and the workflow says so in a comment, so nobody assumes
a tag also ships to AMO. Automating it *is* feasible — `scripts/ff-release.mjs` already
reads `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` from the environment and only prompts
when one is missing, so it runs non-interactively as-is. Three things have to be solved
before it would be safe, established while researching this:

- **The bump has to go back into git.** `ff:bump` rewrites `manifest.json` in a throwaway
  checkout. The job must bump → commit `release(ff): x.y.z` → tag `ff-vx.y.z` → push,
  and only then sign, or the released version exists in no commit and the tag/manifest
  rule breaks. (CI has no `fmversion` filter configured, so the committed value stays
  bare by itself — that part is free.)
- **`--approval-timeout 0`.** `web-ext-config.mjs` signs on `channel: 'listed'`, and
  web-ext 8.10 waits for AMO approval by default. AMO review is human and can take days,
  so without this the job times out on a submission that actually succeeded.
- **A failed run cannot resume.** `.amo-upload-uuid` is gitignored and ephemeral in a
  runner, and AMO refuses a version number it has already seen — so a half-finished
  upload costs a version number. Reason enough to keep signing as the last step of a
  separately triggered job.

Plus the organisational part: the repo is public and the AMO credentials are long-lived
(no OIDC short-lived tokens). If it gets automated, then `workflow_dispatch` only, never
`pull_request`, with the secrets behind a protected environment (`amo`, required
reviewer) so a release needs a deliberate click.

**Verification:** dry-run by pushing a `v2.7.1-test` tag to a scratch branch, confirm
the release appears with the right zip, then delete tag and release.

## Step 5 — Fill in `.github/`

- **`ISSUE_TEMPLATE/config.yml`** — `blank_issues_enabled: false` plus contact links:
  the FlowMouse repo for upstream bugs (so upstream issues stop landing here), and
  `contact@gestura.eu` for anything private.
- **`PULL_REQUEST_TEMPLATE.md`** — English; three prompts: what changed, which branch
  it targets and why, `npm test` output. Mention that `manifest.json`'s `version_name`
  must not be touched.
- **`CONTRIBUTING.md`** — English. The one-time clone setup (hooks path + `fmversion`
  filter, straight from `CLAUDE.md`), `npm test`, the tabs convention, the
  "internal `FlowMouse*` identifiers stay" rule, and the branch roles.
- **`SECURITY.md`** — supported version = latest release; report to
  `contact@gestura.eu`; no bug bounty; expected response window.
- **`dependabot.yml`** — npm, monthly, devDependencies only (`vitest`, `web-ext`).
  Low value with two dependencies, but it also picks up GitHub Actions versions, which
  is where it actually earns its keep once steps 1 and 4 exist.

**Open question:** German versions of `CONTRIBUTING.md` / `SECURITY.md`? Recommendation
— no. Keep the contributor-facing docs English-only (`README.de.md` is the concession to
German readers); two more files to keep in sync buys little.

## Step 6 — Repo settings (manual, not in git)

```sh
gh repo edit PPP01/Gestura \
  --add-topic mouse-gestures --add-topic browser-extension --add-topic chrome-extension \
  --add-topic firefox-addon --add-topic manifest-v3 --add-topic privacy --add-topic gestures \
  --homepage https://github.com/PPP01/Gestura
gh repo edit PPP01/Gestura --enable-wiki=false --enable-projects=false
```

Homepage should become the Chrome Web Store listing once it is live. Enable Discussions
instead of the Wiki if we want a place for questions — that also gives `config.yml` a
better contact link than an email address.

## Suggested order

Steps 1 → 2 first (cheapest, immediately useful, and step 4's guards reuse step 2's
checks). Step 3 next, because a stale "Latest" is what a visitor actually sees. Then 4,
5, 6. Each step is independently shippable; none of them touch extension code.
