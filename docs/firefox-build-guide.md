# FlowMouse fork — Firefox build & release guide

How to build, sign, install, and auto-update the Firefox variant of this fork.
Everything here runs on the **`firefox-build`** branch.

- `firefox-build` = `feature/search-engine-suite` (the feature work) + a few
  Firefox-only commits (Firefox manifest, `menu-patterns.js` loaded via
  `background.scripts`, Chrome-only manifest entries dropped).
- `web-ext lint` → 0 errors, loads warning-free.
- **Works in Firefox:** search-engine manager, contextual menus, drag search,
  clipboard mode — the core gesture/menu features.
- **Does not work in Firefox** (APIs absent, by design): the JS-transform
  sandbox (`offscreen`), engine favicons (`favicon`), save-as-MHTML
  (`pageCapture`). These degrade gracefully; the rest is unaffected.

## One-time setup

```bash
git checkout firefox-build
npm install
```

Signing needs a free Mozilla add-on account. On
`addons.mozilla.org` → **Developer Hub → Manage API Keys**, generate an API
key + secret. Never commit them — pass them per command or via the
`WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` environment variables.

## npm scripts

| Script | What it does |
|---|---|
| `npm run ff:run` | Launch Firefox with the extension, live-reload on save. Dev only — no signing, no version bump. |
| `npm run ff:build` | Build an **unsigned** `.zip` into `web-ext-artifacts/` (runtime files only). |
| `npm run ff:bump` | Bump `manifest.json` version (`2.2` → `2.2.1`, then `2.2.2`, …). |
| `npm run ff:sign` | Upload to Mozilla and download a **signed** `.xpi` (channel `unlisted`). |
| `npm run ff:release` | `ff:bump` then `ff:sign` — the one-shot release command. |

## Scenario A — just develop / try it out

```bash
git checkout firefox-build
npm run ff:run
```

No signing, no restart problem. This launches a dedicated Firefox instance and
reloads the extension whenever you save a file.

## Scenario B — new installable version (manual install)

```bash
git checkout firefox-build
git rebase feature/search-engine-suite       # only if you changed the feature
npm run ff:release -- --api-key=YOUR_KEY --api-secret=YOUR_SECRET
```

This bumps the version, signs, and writes the signed `.xpi` to
`web-ext-artifacts/`. Install it once via **about:addons → gear → Install
Add-on From File**.

> AMO refuses to sign a version it has already signed — that is why
> `ff:release` bumps first. Version `2.2` is already signed, so the next
> release becomes `2.2.1`.

Regular Firefox installs only **signed** extensions. Developer Edition /
Nightly / ESR can install an unsigned `.xpi` after setting
`xpinstall.signatures.required = false` in `about:config`.

## Scenario C — auto-update (install the signed `.xpi` only once, ever)

`manifest.json` already points `browser_specific_settings.gecko.update_url`
at `updates.json` on this branch (a raw GitHub URL). Per release:

1. `npm run ff:release -- --api-key=… --api-secret=…`
2. Create a GitHub release on your fork (e.g. tag `ff-2.2.1`) and upload the
   signed `.xpi` as an asset.
3. Add an entry to `updates.json` — `version` = new manifest version,
   `update_link` = the exact release asset URL — and push the branch:
   ```bash
   git commit -am "release ff-2.2.1"
   git push origin firefox-build
   ```

Firefox polls `updates.json`, sees the higher version, and updates itself — no
more manual re-install.

Requirements for auto-update to resolve:
- `firefox-build` must be pushed to `origin` (so the raw `update_url` works).
- The extension id in `updates.json` must match the manifest
  (`flowmouse-fork@local`).
- `update_link` must be HTTPS and point to the **signed** `.xpi`.

Until you create the first release + `updates.json` entry, Firefox simply
finds no newer version — nothing breaks.

## Keeping up with upstream

When upstream FlowMouse changes, replay this branch on top of the updated
feature branch (see `../FORK-NOTES.md` for the full remote/branch workflow):

```bash
git fetch upstream
git checkout firefox-build
git rebase feature/search-engine-suite
```

Because `firefox-build` is only a handful of commits on top of the feature
branch, this rebase is small.
