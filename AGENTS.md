# AGENTS.md

This file provides guidance to coding agents (Codex and others) working in this repository. It is kept identical to [CLAUDE.md](CLAUDE.md) apart from this header — change both together.

## What this is

Gestura is a **Manifest V3 browser extension** (Chrome/Edge/Firefox) for mouse gestures, super drag, wheel/rocker gestures, area selection, and per-site website menus. It is a GPL-3.0 fork of [FlowMouse](https://github.com/Hmily-LCG/FlowMouse). [README.md](README.md) describes what the fork adds; [FORK-NOTES.md](FORK-NOTES.md) owns remotes, branch roles and the upstream-update workflow.

The repo root **is** the unpacked extension. Nothing compiles — no bundler, no transpiler, no preprocessor. `package.json` exists only for the test runner and the Firefox packaging tools; never introduce a build step the extension depends on.

**The rebrand is user-facing only.** Internal `FlowMouse*` identifiers (`window.FlowMouseUtils`, `window.FlowMouseMenuModel`, …) are deliberately left untouched to keep upstream rebases cheap. Do not "clean them up".

## Commands

```bash
npm install                                     # only for tests / Firefox tooling
npm test                                        # vitest, 17 suites
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

Bump `version` in `manifest.json`, add a `CHANGELOG.md` entry (that is the only changelog file), commit, then build the package. Chrome and Edge upload the *same* zip. Firefox is signed and published from `firefox-build` with **`npm run ff:release`**, which prompts for the AMO credentials and hands them to `web-ext` via the environment — never call `ff:sign` with `--api-key=` on the command line, that puts the secret in the shell history. `ff:release` bumps the version first (AMO refuses a number it already signed); add `-- --no-bump` when you already took the version from `main`. Step-by-step store guides live in [docs/store/](docs/store/); the Firefox build/sign mechanics are in `docs/firefox-build-guide.md` on the `firefox-build` branch.

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
