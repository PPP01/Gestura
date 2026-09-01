# AGENTS.md

This file provides guidance to coding agents (Codex and others) working in this repository. It is kept identical to [CLAUDE.md](CLAUDE.md) apart from this header — change both together.

## What this is

Gestura is a **Manifest V3 browser extension** (Chrome/Edge/Firefox) for mouse gestures, super drag, wheel/rocker gestures, area selection, and per-site website menus. It is a GPL-3.0 fork of [FlowMouse](https://github.com/Hmily-LCG/FlowMouse). [README.md](README.md) describes what the fork adds; [FORK-NOTES.md](FORK-NOTES.md) owns remotes, branch roles and the upstream-update workflow.

The repo root **is** the unpacked extension. Nothing compiles — no bundler, no transpiler, no preprocessor. `package.json` exists only for the test runner and the Firefox packaging tools; never introduce a build step the extension depends on.

**The rebrand is user-facing only.** Internal `FlowMouse*` identifiers (`window.FlowMouseUtils`, `window.FlowMouseMenuModel`, …) are deliberately left untouched to keep upstream rebases cheap. Do not "clean them up".

## Commands

```bash
npm install                                     # only for tests / Firefox tooling
npm test                                        # vitest, 21 suites
npx vitest run tests/menu-model.test.mjs        # a single file
npx vitest run -t "edited copy wins over catalog"   # a single test by name
```

Firefox — on the `firefox-build` branch only:

```bash
npm run ff:run     # launch Firefox with the extension, reloads on save
npm run ff:build   # unsigned zip into web-ext-artifacts/
npx web-ext lint --source-dir . --config web-ext-config.mjs   # must report 0 errors
```

Chrome/Edge upload package — `git archive` reads the **committed** tree, so commit first:

```bash
git archive --format=zip -o web-ext-artifacts/gestura-<version>-chrome.zip HEAD \
  manifest.json js _locales icons pages css LICENSE NOTICE THIRD_PARTY_LICENSES.md
```

There is no linter for the extension source itself.

## Development

Load the repo folder at `chrome://extensions` (Developer mode → "Load unpacked"). After editing, click reload on the extension card — content scripts and `manifest.json` require it; for options/popup pages reopening the page is usually enough. Debug the service worker via its link on the extension card, content scripts via the page's own DevTools.

## Branches

`main` is the Chrome/Edge product. `firefox-build` is `main` plus a small Firefox patch set (~8 files: a Gecko manifest, `background.scripts` instead of a service worker, the `ff:*` tooling).

**Both branches are kept current by merging, never rebasing** — `main` from `upstream/main`, `firefox-build` from `main`. `main` used to be rebased; with 150+ Gestura commits on top of the upstream base that stopped being practical. See [FORK-NOTES.md](FORK-NOTES.md).

## Releasing

**One version, one tag, one release — every browser's package is attached to it.**

```text
v2.8.0
  gestura-2.8.0-chrome.zip     Chrome and Edge, the same package for both
  gestura-2.8.0-firefox.xpi    signed by Mozilla, added when AMO is done
```

Bump `version` in `manifest.json`, add a `CHANGELOG.md` entry (that is the only changelog file), commit, then tag the `release:` commit itself, annotated, and push the tag:

```sh
git tag -a v2.8.0 <release-commit> -m "Gestura v2.8.0"
git push gestura v2.8.0
```

[.github/workflows/release.yml](.github/workflows/release.yml) takes it from there: it refuses the tag unless `manifest.json` agrees with it and `CHANGELOG.md` has a `### v2.8.0` section, then builds the zip from the tag and opens the release with that section as its text. There is no manual `git archive` step any more.

Firefox follows from `firefox-build`, which carries **the same version number** — merge `main` in first, do not bump on top. **`npm run ff:release`** signs it at AMO and uploads `gestura-<version>-firefox.xpi` onto the existing release. It prompts for the AMO credentials and hands them to `web-ext` via the environment — never call `ff:sign` with `--api-key=` on the command line, that puts the secret in the shell history. Signing is asynchronous, so the release lives with only the Chrome package for as long as the review takes; that is expected, and the release text says so.

The shared version number is what keeps both packages in one release, and it has a price: **a failed AMO upload burns the number for everyone.** AMO refuses a version it has already signed, so the next attempt has to go out as a new version on *all* browsers, Chrome included. Never upload to AMO from a version you are not ready to release.

Step-by-step store guides live in [docs/store/](docs/store/); the Firefox build/sign mechanics are in `docs/firefox-build-guide.md` on the `firefox-build` branch.

**The retired `ff-vX.Y[.Z]` namespace.** Firefox used to be released on its own tags, because AMO's refusal to re-sign a number made that line drift (2.5 → 2.5.1, 2.6 → 2.6.1). Those tags and the `ff-v2.5.1` / `ff-v2.6.1` releases stay as history — do not create new ones. Tags before `v2.4` were backfilled after the fact.

### `version_name` is generated — never edit it

`manifest.json`'s `version_name` carries `<version>+<short-hash>[-dirty]` so `chrome://extensions` shows exactly which commit is loaded. A git clean filter strips it back to the bare version on commit (so the committed value never holds a hash), and the hooks in [.githooks/](.githooks/) re-stamp it after commit/checkout/merge/rewrite. Bump only the numeric `version`.

One-time setup per clone or worktree — git config and hooks do not survive a clone:

```sh
git config core.hooksPath .githooks
git config filter.fmversion.clean "sh scripts/stamp-version.sh clean"
git config filter.fmversion.smudge cat
sh scripts/stamp-version.sh stamp
git add --renormalize manifest.json
```

**Switching branches with a stamped manifest fails.** `git checkout <branch>` aborts with *"Please commit your changes or stash them"* even though `git diff` is empty — checkout decides from the cached stat without running the clean filter, and the stamp changed the file's size. Nothing is at stake: the filtered content hashes to exactly the committed blob. But `commit`, `stash` and `git checkout HEAD -- manifest.json` all fail to clear it, the last because `post-checkout` re-stamps immediately. Use **`git checkout -f <branch>`** — the stamp is the only thing it can discard, and the hook re-stamps for the new branch. Commit or stash real work first.

## Architecture

### Two execution contexts, two settings paths

- **Service worker** — [js/background.js](js/background.js) owns everything privileged (`tabs`, `windows`, `sessions`, `contextMenus`, `search`, `downloads`, `bookmarks`). Entry point is `handleAction(request, sender)`, a switch on `request.action`. It reads `chrome.storage.sync` directly.
- **Content scripts** — injected at `document_start` in **all frames**; they do gesture/drag detection and page-local actions (scrolling, clipboard, in-page menus). They also read `chrome.storage.sync` directly.
- **UI pages** — Lit components that go through the `SettingsStore` ES module ([js/settings-store.js](js/settings-store.js)), which adds change listeners and sync-conflict handling.

So settings are touched two different ways. `DEFAULT_SETTINGS` in [js/constants.js](js/constants.js) is the single source of truth for their shape; both paths layer stored values over it.

### Content scripts talk through window globals

Content scripts **cannot use ES modules**. The `content_scripts` list in `manifest.json` is load-ordered, and each file hands the next one a `window.*` global (`GestureConstants`, `GestureRecognizer`, `GestureOverlay`, `FlowMouseMenuModel`, `FlowMouseEngineRegistry`, …). A new dependency has to be inserted into that list at the right position.

Component code under [js/components/](js/components/) is the exact opposite — ES modules, no window globals, Lit vendored locally at `js/lib/lit-all.min.js` (no CDN). Each `pages/*.html` loads the legacy globals as classic `<script>` and the components as `<script type="module">`. Don't mix the two worlds.

### Action routing

Whether a gesture action runs in the page or goes to the worker is decided by set membership declared in **two files that must stay in sync**: `LOCAL_ACTIONS` in [js/constants.js](js/constants.js) and `CONTENT_ACTIONS` in [js/background.js](js/background.js).

Adding a gesture action means touching, in concert: `ACTION_KEYS` (action id → i18n message key — this is what makes it selectable in the UI), `ACTION_DEFAULTS`, both routing sets, a `case` in `handleAction` or the content dispatcher, and the i18n strings. Drag actions have parallel registries (`TEXT_DRAG_ACTIONS`, `LINK_DRAG_ACTIONS`, `IMAGE_DRAG_ACTIONS`, `DRAG_ACTION_DEFAULTS`).

### Menus and search engines resolve catalog + user deltas

Website menus come from a built-in catalog ([js/menu-catalog.js](js/menu-catalog.js)) layered with the user's edits, per-menu flags and own menus; [js/menu-model.js](js/menu-model.js) does that resolution, [js/menu-patterns.js](js/menu-patterns.js) matches URLs to menus, [js/menu-exchange.js](js/menu-exchange.js) handles import/export. Search engines follow the same shape: the catalog in [js/search-engines-catalog.js](js/search-engines-catalog.js) resolved against user overrides by [js/engine-registry.js](js/engine-registry.js).

In both cases **stored settings hold deltas, not full copies** — a menu the user never edited is not in storage at all. Read the resolver before changing anything about stored shapes.

### i18n has two runtimes

`_locales/<lang>/messages.json` are standard `chrome.i18n` catalogs across **39 locales**; `en` is `default_locale`. Extension pages use [js/i18n.js](js/i18n.js), which resolves `data-i18n` / `data-i18n-placeholder` / `data-i18n-title` attributes and exposes `isEdge` / `isFirefox` / platform. Content scripts use `ContentI18n` at the top of [js/content.js](js/content.js), which fetches a user-selected language override from `_locales/<lang>/messages.json` via `web_accessible_resources` and falls back to `chrome.i18n.getMessage`. Both honor the `language` setting (`'auto'` follows the browser UI language).

## Gotchas the test suite enforces

- **New `siteMenu*`, `menuMode*`, `iconPicker*` and `fork*` keys must land in all 39 locales**, not just `en` — `tests/site-menu-locales.test.mjs` fails otherwise. Relying on the `en` fallback is not enough. Where a locale already translates the same word for another key, reuse that value rather than inventing one.
- **Never put an undeclared `$WORD$` into a message string.** `chrome.i18n` reads it as a placeholder and the extension fails to load entirely. Use `{token}` plus `.replace()` instead; `tests/locale-placeholders.test.mjs` guards this.
- **`js/background.js`'s `importScripts` list must match `background.scripts` in the Firefox manifest.** Firefox has no `importScripts` in a background script, so every new top-level dependency has to be registered in both places. Nothing warns you — check after each merge into `firefox-build`.
- **`web-ext build` packages the working tree, not the git tree.** Untracked files land in the xpi unless they are listed in `ignoreFiles` in `web-ext-config.mjs`.

## Conventions

- Indentation is **tabs**, throughout.
- Edge and Firefox are detected by user-agent sniffing (`Edg/`, `Firefox`), surfaced to pages as `window.i18n.isEdge` / `window.i18n.isFirefox`; several actions are gated on it.
- Prefer `optional_permissions` requested on demand over widening the required set — privacy is a stated project value (see [README.md](README.md) and `PRIVACY.md`).
- Design docs and implementation plans belong in `docs/superpowers/specs/` and `docs/superpowers/plans/`.
- **Reports and hand-overs from other environments go into `exchange/` — never into `docs/`, never into git.** The folder is in `.gitignore` and holds working material that crosses the WSL2 ↔ Windows boundary in both directions (status reports, hand-over contracts, notes from a sibling project). It is not product documentation and must not be committed, referenced from tracked files, or packaged. If something in such a report has to survive, restate it in a tracked doc under `docs/` instead of pointing at `exchange/`.
- **The repo language is English.** [README.md](README.md) is canonical, `README.de.md` is its German translation — change both together. `docs/` is still partly German (historical) and is being migrated; write new docs in English.
