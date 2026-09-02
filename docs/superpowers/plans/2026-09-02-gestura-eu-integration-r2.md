# gestura.eu Integration — R2 (Update notices) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship release stage R2: the anonymous, throttled update check against every allowed index origin, a per-origin result cache in `chrome.storage.local`, and update/retired badges on the affected entries in the options page — with consent raised to version 2 because the extension now sends a request nobody clicked.

**Architecture:** One new classic script, `js/eu-updates.js`, owns the whole feature: the pure logic (which origins are due, what each is asked, how its answer is validated, where the result lands, which stored entry a result belongs to), the `euUpdates` storage key, and one orchestrator whose `fetch` is injected so vitest drives it without a network. The options page calls it once on open; the two managers read the cache and render a badge per row; "adopt update" reuses the managers' existing `#importUrl()`, so the update goes through the same import dialog — with the same conflict warning — as any other URL import. Nothing is added to a stored entry, no content script and no service worker are touched.

**Tech Stack:** Manifest V3, plain JS classic scripts (IIFE + `root.X = api`), Lit (vendored `js/lib/lit-all.min.js`), `fetch` + `AbortController`, vitest (`npm test`, Node 24).

**Spec:** [docs/superpowers/specs/2026-09-02-gestura-eu-integration-design.md](../specs/2026-09-02-gestura-eu-integration-design.md) — section 4 (update check, per-origin cache), 6 (privacy/store/i18n obligations), 7 (error handling), 9 (test list) are R2. The plan argues from the spec; read both.

**Predecessor:** [2026-09-02-gestura-eu-integration-r1.md](2026-09-02-gestura-eu-integration-r1.md), landed on `main` at `d0219ce`, 531 tests green. R2 builds on `FlowMouseEuIntegration` exactly as R1 left it.

## Global Constraints

- **No build step.** The repo folder *is* the unpacked extension. `js/eu-updates.js` is a classic script (IIFE, `root.GesturaEuUpdates = api`, `module.exports` for vitest); components under `js/components/` stay ES modules. Never mix the two worlds.
- **Indentation is tabs**, throughout, in JS, JSON and CSS alike.
- **Internal `FlowMouse*` identifiers stay.** R1's pure core is `window.FlowMouseEuIntegration`; do not rename it. New R2 globals use the `Gestura*` prefix R1 established for new files (`GesturaEuLocal` → `GesturaEuUpdates`).
- **i18n: en and de only, and every new key goes into `PENDING_TRANSLATION`** in `tests/site-menu-locales.test.mjs`. Owner decision, carried over from R1: all 39 locales are filled before a release, not during development. New keys use the `euIntegration*` prefix, which `NEW_KEY_PREFIXES` already covers.
- **Never put an undeclared `$WORD$` in a message.** `chrome.i18n` reads it as a placeholder and the extension fails to load entirely. Use `{token}` plus `.replace()`; `tests/locale-placeholders.test.mjs` guards it.
- **Copy rule from the owner:** lead with what the service does for the user, not with warnings. Keep claims factual — where the extension genuinely acts without a click, the text says so plainly instead of implying nothing ever happens. R2's whole point is such a case.
- **`version_name` in `manifest.json` is generated** — a clean filter and the hooks in `.githooks/` own it. Never edit it; do not bump `version` in this plan either (that is a release step).
- **The byte-exactness invariant stays intact.** `withBaselinePlaceholders()` exists because the import preview must measure exactly what the save writes. R2 adds no field to a stored entry, so the invariant is untouched — if that ever changes, extend the placeholder projection rather than bypassing it.

---

## Decisions taken before this plan (2026-09-02)

The spec leaves four things open. The owner settled them:

1. **The `/api/v1/updates` contract is authored here** (`docs/gestura-eu-api.md` is copied into `gestura-index`, changes made here first), so R2 does not wait for the server. Task 1 pins request, response, validation and CORS.
2. **No field-level diff in R2.** The spec's "import dialog with diff" is deferred: no diff view exists, and building one is worth as much work as the whole update check. R3 needs a full settings preview anyway, and the diff is cheaper there. Adopting an update therefore runs through today's dialog — preview, replace/new choice, storage projection, transform-code confirmation, and the "you changed this entry" warning from `eab2734`. The `changelog` field is carried in the contract and cached, and shown in the badge tooltip; it is **not** rendered inside the dialog.
3. **Consent rises to version 2 and every user is asked again.** The disclosure genuinely widens: R1 answered only while the user was on gestura.eu, R2 sends a request when the settings open. `effectiveEnabled()` already makes a stale consent authorize nothing, and the panel's re-confirmation row already exists.
4. **Build now, release when the endpoint answers.** Everything is testable against a local mock on the developer origin; a failing check shows no badges and starts no throttle window, so a release with a dead endpoint would be inert rather than broken.

## What R1 constrains

- **Only `https://gestura.eu` and the single configured developer origin count.** `EU.allowedOrigins(local)` is the whole list; an entry whose `indexOrigin` is not on it is asked nothing. Third-party origins are not a thing R2 may lean on.
- **`indexOrigin` is the qualification.** A file import has an `indexId` but no `indexOrigin`, stays fully functional locally, and is **never** disclosed and never update-checked.
- **Entries are identified by the pair `(indexOrigin, indexId)`.** Never by id alone.
- **Adopting an update inherits the dialog's no-silent-overwrite behaviour.** An entry the user edited after importing arrives *unticked* with a warning, because replacing it discards their edit. That is correct and stays: an update is exactly the case where the user must see that choice. It costs one extra click on an edited entry.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `js/eu-updates.js` | The whole update check: cache normalization, request grouping, throttle decision, response validation, cache merge, badge lookup, the `euUpdates` storage key, and `runUpdateCheck()` with injected `fetch`. |
| `tests/eu-updates.test.mjs` | The pure logic and the orchestrator, driven with a fake `fetch`. |

**Modified**

| File | Change |
|---|---|
| `docs/gestura-eu-api.md` | R2 section: endpoint, request, response, validation, CORS preflight, cache shape; `apiLevel` 2; consent table row. |
| `js/eu-integration.js` | `API_LEVEL` 1 → 2, `CURRENT_INTEGRATION_CONSENT` 1 → 2. Nothing else. |
| `js/components/eu-integration-panel.js` | Fifth consent point; revoke clears the cache; changing the developer origin drops its slot; advanced-mode "check now" plus a last-checked line. |
| `js/components/import-feedback.js` | `renderUpdateBadge(i18n, up)` — shared by both managers, like `renderImportBadge`. |
| `js/components/site-menu-manager.js` | Badge on the row, adopt button, cache read + refresh listener. |
| `js/components/engine-manager.js` | The same, for engines. |
| `js/components/options-page.js` | Kick off the check at the end of `#init()`. |
| `css/common.css` | `.update-badge` / `.retired-badge`, beside `.import-badge`. |
| `pages/options.html` | Load `js/eu-updates.js` after `js/eu-integration.js`. |
| `_locales/en/messages.json`, `_locales/de/messages.json` | New keys; reworded consent points 1 and 4. |
| `_locales/<37 others>/messages.json` | Delete the now-wrong `euIntegrationConsentPoint1` (Task 4 explains why). |
| `tests/site-menu-locales.test.mjs` | New keys into `PENDING_TRANSLATION`. |
| `tests/eu-integration.test.mjs` | Consent version 2, `apiLevel` 2. |
| `PRIVACY.md` | The "no request Gestura makes on its own" bullet becomes wrong; replace it. |
| `CHANGELOG.md` | Entry under `### Unreleased`. |
| `docs/store/chrome-web-store-submission.md`, `docs/store/firefox-amo-submission.md` | Data-disclosure lines. |

**Deliberately not touched:** `manifest.json` (`content_scripts`, `importScripts`) and `js/background.js`. The check runs in the options page only, so R2 adds no content-script and no worker dependency — and therefore needs **no Firefox-manifest mirror** on `firefox-build` beyond the `pages/options.html` line, which both branches share. This is the one Firefox-parity obligation from spec §6 that R2 does incur, and it comes for free.

---

## Task 1: Pin the contract in `docs/gestura-eu-api.md`

The endpoint's response shape exists nowhere yet. Everything in tasks 2–6 validates against this text, and `gestura-index` implements from it, so it is written first and on its own.

**Files:**
- Modify: `docs/gestura-eu-api.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the field names and limits tasks 2 and 3 encode — `apiLevel`, `entries[{id,type,version}]`, `updates[{id,type,version,url,changelog?,deprecated?,successor?}]`, the `euUpdates` cache shape.

- [ ] **Step 1: Raise the level line**

Replace the `apiLevel: 1` paragraph near the top:

```markdown
**apiLevel: 2** (R2). The index must tolerate every older extension: no answer
is indistinguishable from "not installed" and must be handled as such, and an
extension at level 1 never calls `/api/v1/updates` at all. R3 adds the sync
endpoints to this file.
```

- [ ] **Step 2: Add the update-check section**

Insert after the "Hand-off" section, before "Provenance":

```markdown
## Update check (`POST /api/v1/updates`)

Anonymous, no account, no identifier. Sent **only** while *gestura.eu
integration* is on with a current consent, at most **once per 24 hours per
origin**, and only when the user opens the extension's settings — there is no
background alarm and no traffic while the settings are closed.

**One request per index origin.** Entries are grouped by `source.indexOrigin`:
production entries go to `https://gestura.eu` and dev-index entries to the
configured developer origin. Neither ever appears in the other's request.
Entries without `indexOrigin` — every file import — appear in none.

Request body:

```json
{
	"apiLevel": 2,
	"entries": [
		{ "id": "eu.example.shop", "type": "menu", "version": "1.2.0" },
		{ "id": "eu.example.search", "type": "engine", "version": null }
	]
}
```

- `type` is `"menu"` or `"engine"`. Ids are unique across both in the index, so
  `type` is redundant for the lookup; it travels because the answer must be
  attributable without a second lookup on the client.
- `version` is the content version the entry was imported with, or `null` when
  the entry carries none (imported before versions were recorded). `null` means
  "tell me the current version"; the client decides for itself whether that
  differs from what it stores.

Answer — **only** entries that have something to say (a newer version, a
deprecation, or both). Everything up to date is simply absent:

```json
{
	"apiLevel": 2,
	"updates": [
		{
			"id": "eu.example.shop",
			"type": "menu",
			"version": "1.3.0",
			"url": "https://gestura.eu/api/v1/menus/eu.example.shop/1.3.0",
			"changelog": "Two new patterns for /cart",
			"deprecated": false,
			"successor": null
		}
	]
}
```

- `url` is where the entry's exchange JSON for that version can be fetched. It
  **must** be on the same origin that answered; the extension drops any result
  whose `url` points elsewhere, and refuses to be sent shopping on a third
  party's behalf.
- `changelog` is optional plain text, no markup, truncated to 1000 characters by
  the client.
- `deprecated: true` says the index no longer maintains the entry. It may appear
  with an unchanged `version`, and `successor` may name the entry that replaces
  it.
- An empty `updates` array is the normal, healthy answer.

**Validation on the client — strict on the envelope, lenient on the element.**
A non-200 status, a body over 256 KiB, unparseable JSON, or a missing/non-array
`updates` makes the whole answer invalid: the origin's cache slot, `checkedAt`
included, stays exactly as it was, so **a network error does not start the
24-hour window** and the next settings open tries that origin again. A single
malformed *element* is dropped and the rest of the answer is kept — an element
naming a `type` a future level introduces must not invalidate today's answer.
Elements are dropped when: the `id` was not asked for, it repeats, `type` is
neither `menu` nor `engine`, `version` is missing or over 32 characters, or `url`
is unparseable or not on the answering origin. At most 200 elements.

**CORS.** Both manifests carry `<all_urls>`, but Firefox MV3 does not *grant*
host permissions automatically, so until the user opts in at `about:addons` this
is an ordinary cross-origin request from `moz-extension://…`. A JSON `POST` is
not a CORS simple request, so the endpoint must answer `OPTIONS` with:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

and the reverse proxy must not drop the unfamiliar `chrome-extension://` /
`moz-extension://` `Origin` before it reaches the API. Open CORS is safe here:
the endpoint is anonymous and returns only public index data.

**Result cache** (`chrome.storage.local`, key `euUpdates`), kept per origin — one
shared `checkedAt` could not express "production answered, the dev index was
down":

```json
{
	"origins": [
		{
			"origin": "https://gestura.eu",
			"checkedAt": "2026-09-02T15:04:05.000Z",
			"results": [ { "id": "…", "type": "menu", "version": "1.3.0", "url": "…" } ]
		}
	]
}
```

An array, not origin-keyed objects — no arbitrary strings as object keys. A
validated answer replaces only its own origin's slot, so badges survive closing
the settings instead of vanishing behind the throttle window. Withdrawing consent
or switching the integration off deletes the whole key; changing or clearing the
developer origin deletes that origin's slot.

A badge is shown when the cached result's `version` differs from what the entry
stores **now**, or when it is `deprecated`. Comparing against the stored version
rather than trusting the server's "newer" is what makes a badge disappear the
moment the user adopts the update, instead of at the next check.
```

- [ ] **Step 3: Add the consent row**

In the "Consent versions" table, below the row for 1:

```markdown
| 2 | Everything in 1, plus the anonymous update check: when the settings are opened, at most once a day per origin, Gestura sends the ids and versions of the entries imported from that origin. |
```

- [ ] **Step 4: Check the fences render**

Run: `sed -n '/^## Update check/,/^## Provenance/p' docs/gestura-eu-api.md`
Expected: the section prints whole, and the nested ```` ``` ```` fences inside it are intact (this file is Markdown only — nothing compiles it, so the check is a read).

- [ ] **Step 5: Commit**

```bash
git add docs/gestura-eu-api.md
git commit -m "docs(api): pin the update endpoint, its validation and its cache"
```

---

## Task 2: The pure core of `js/eu-updates.js`

**Files:**
- Create: `js/eu-updates.js`
- Create: `tests/eu-updates.test.mjs`

**Interfaces:**
- Consumes: `FlowMouseEuIntegration` — `allowedOrigins(local)`, `effectiveEnabled(local)`, `listProvenanced(settings)`, `ID_RE`, `API_LEVEL`.
- Produces: `GesturaEuUpdates` with `KEY`, `PATH`, `THROTTLE_MS`, `LIMITS`, `normalizeCache(cache)`, `updateRequestGroups(settings, local)`, `dueOrigins(cache, groups, nowMs)`, `parseUpdateResponse(text, origin, askedIds)`, `mergeSlot(cache, origin, results, checkedAtIso)`, `dropOrigin(cache, origin)`, `pruneOrigins(cache, allowedOrigins)`, `updateFor(cache, stored)`. Task 3 adds `runUpdateCheck`, `read`, `write`, `clear` to the same object.

- [ ] **Step 1: Write the failing test**

Create `tests/eu-updates.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import '../js/eu-integration.js';
import '../js/eu-updates.js';
const EU = globalThis.FlowMouseEuIntegration;
const U = globalThis.GesturaEuUpdates;

const PROD = 'https://gestura.eu';
const DEV = 'http://localhost:8123';

const local = (over = {}) => ({
	euIntegration: {
		enabled: true,
		consent: { version: EU.CURRENT_INTEGRATION_CONSENT, date: '2026-09-02T00:00:00Z' },
		devOrigin: '',
		...over,
	},
});

// A menu, an engine override and a file import, so grouping has something to
// leave out as well as something to include.
const settings = () => ({
	siteMenus: {
		custom: {
			m1: { name: 'Shop', source: { type: 'site', indexId: 'eu.example.shop', indexOrigin: PROD, version: '1.2.0' } },
			m2: { name: 'From a file', source: { type: 'file', indexId: 'eu.example.shop', version: '1.0.0' } },
			m3: { name: 'Dev', source: { type: 'site', indexId: 'eu.example.dev', indexOrigin: DEV, version: '0.1.0' } },
		},
		edited: {},
	},
	searchEngines: {
		custom: [],
		overrides: {
			google: { name: 'G', source: { type: 'site', indexId: 'eu.example.search', indexOrigin: PROD, version: null } },
		},
	},
});

describe('updateRequestGroups', () => {
	it('groups qualified entries by origin and leaves file imports out', () => {
		const groups = U.updateRequestGroups(settings(), local({ devOrigin: DEV }));
		expect(groups.map(g => g.origin).sort()).toEqual([DEV, PROD]);
		const prod = groups.find(g => g.origin === PROD);
		expect(prod.entries).toEqual([
			{ id: 'eu.example.shop', type: 'menu', version: '1.2.0' },
			{ id: 'eu.example.search', type: 'engine', version: null },
		]);
	});

	it('drops an origin that is no longer allowed', () => {
		const groups = U.updateRequestGroups(settings(), local({ devOrigin: '' }));
		expect(groups.map(g => g.origin)).toEqual([PROD]);
	});

	it('asks about a shared id once per origin', () => {
		const s = settings();
		s.siteMenus.edited = { m4: { name: 'Dup', source: { type: 'site', indexId: 'eu.example.shop', indexOrigin: PROD, version: '1.2.0' } } };
		const prod = U.updateRequestGroups(s, local()).find(g => g.origin === PROD);
		expect(prod.entries.filter(e => e.id === 'eu.example.shop')).toHaveLength(1);
	});
});

describe('dueOrigins', () => {
	const groups = [{ origin: PROD, entries: [] }];
	const at = (iso) => ({ origins: [{ origin: PROD, checkedAt: iso, results: [] }] });
	const now = Date.parse('2026-09-02T12:00:00Z');

	it('an origin never checked is due', () => {
		expect(U.dueOrigins({ origins: [] }, groups, now)).toHaveLength(1);
	});
	it('within the window it is not', () => {
		expect(U.dueOrigins(at('2026-09-02T06:00:00Z'), groups, now)).toHaveLength(0);
	});
	it('past the window it is again', () => {
		expect(U.dueOrigins(at('2026-09-01T11:00:00Z'), groups, now)).toHaveLength(1);
	});
	it('an unparseable or future timestamp does not lock the check out', () => {
		expect(U.dueOrigins(at('not a date'), groups, now)).toHaveLength(1);
		expect(U.dueOrigins(at('2027-01-01T00:00:00Z'), groups, now)).toHaveLength(1);
	});
});

describe('parseUpdateResponse', () => {
	const asked = ['eu.example.shop', 'eu.example.search'];
	const body = (updates) => JSON.stringify({ apiLevel: 2, updates });
	const one = {
		id: 'eu.example.shop', type: 'menu', version: '1.3.0',
		url: PROD + '/api/v1/menus/eu.example.shop/1.3.0',
	};

	it('keeps a well-formed result', () => {
		expect(U.parseUpdateResponse(body([one]), PROD, asked).results).toEqual([one]);
	});
	it('an empty answer is valid and empty', () => {
		expect(U.parseUpdateResponse(body([]), PROD, asked)).toEqual({ results: [] });
	});
	it.each([
		['not json', 'nope'],
		['an array at the top level', '[]'],
		['a missing updates field', JSON.stringify({ apiLevel: 2 })],
		['a non-array updates field', JSON.stringify({ updates: {} })],
	])('rejects the whole answer: %s', (_label, text) => {
		expect(U.parseUpdateResponse(text, PROD, asked)).toBeNull();
	});
	it('rejects a body over the byte cap', () => {
		const huge = body([{ ...one, changelog: 'x'.repeat(300 * 1024) }]);
		expect(U.parseUpdateResponse(huge, PROD, asked)).toBeNull();
	});
	it.each([
		['an id nobody asked about', { ...one, id: 'eu.other.thing' }],
		['an unknown type', { ...one, type: 'bookmark' }],
		['a missing version', { ...one, version: undefined }],
		['a url on another origin', { ...one, url: 'https://evil.example/x.json' }],
		['an unparseable url', { ...one, url: 'not a url' }],
	])('drops just the element: %s', (_label, bad) => {
		expect(U.parseUpdateResponse(body([bad, one]), PROD, asked).results).toEqual([one]);
	});
	it('drops a repeated id', () => {
		expect(U.parseUpdateResponse(body([one, one]), PROD, asked).results).toEqual([one]);
	});
	it('truncates the changelog and keeps deprecation', () => {
		const r = U.parseUpdateResponse(body([{ ...one, changelog: 'y'.repeat(2000), deprecated: true, successor: 'eu.example.new' }]), PROD, asked).results[0];
		expect(r.changelog).toHaveLength(U.LIMITS.changelogMax);
		expect(r.deprecated).toBe(true);
		expect(r.successor).toBe('eu.example.new');
	});
});

describe('mergeSlot, dropOrigin, pruneOrigins', () => {
	const seed = {
		origins: [
			{ origin: PROD, checkedAt: '2026-09-01T00:00:00Z', results: [{ id: 'a', type: 'menu', version: '2', url: PROD + '/a' }] },
			{ origin: DEV, checkedAt: '2026-09-01T00:00:00Z', results: [] },
		],
	};

	it('replaces only its own slot, in place', () => {
		const next = U.mergeSlot(seed, DEV, [{ id: 'b', type: 'menu', version: '3', url: DEV + '/b' }], '2026-09-02T00:00:00Z');
		expect(next.origins.map(s => s.origin)).toEqual([PROD, DEV]);
		expect(next.origins[0]).toEqual(seed.origins[0]);
		expect(next.origins[1].checkedAt).toBe('2026-09-02T00:00:00Z');
	});
	it('appends an origin it has never seen', () => {
		const next = U.mergeSlot({ origins: [] }, PROD, [], '2026-09-02T00:00:00Z');
		expect(next.origins).toHaveLength(1);
	});
	it('drops one origin and keeps the other', () => {
		expect(U.dropOrigin(seed, DEV).origins.map(s => s.origin)).toEqual([PROD]);
	});
	it('prunes every origin that is not allowed any more', () => {
		expect(U.pruneOrigins(seed, [PROD]).origins.map(s => s.origin)).toEqual([PROD]);
	});
});

describe('normalizeCache', () => {
	it('yields an empty cache for junk', () => {
		expect(U.normalizeCache(undefined)).toEqual({ origins: [] });
		expect(U.normalizeCache({ origins: 'nope' })).toEqual({ origins: [] });
	});
	it('drops slots without an origin and collapses duplicates', () => {
		const n = U.normalizeCache({ origins: [{ results: [] }, { origin: PROD }, { origin: PROD, checkedAt: 'x' }] });
		expect(n.origins).toEqual([{ origin: PROD, checkedAt: '', results: [] }]);
	});
});

describe('updateFor', () => {
	const cache = {
		origins: [{
			origin: PROD, checkedAt: '2026-09-02T00:00:00Z',
			results: [
				{ id: 'eu.example.shop', type: 'menu', version: '1.3.0', url: PROD + '/a' },
				{ id: 'eu.example.old', type: 'menu', version: '1.0.0', url: PROD + '/b', deprecated: true },
			],
		}],
	};
	const stored = (over) => ({ name: 'x', source: { type: 'site', indexOrigin: PROD, indexId: 'eu.example.shop', version: '1.2.0', ...over } });

	it('reports a newer version', () => {
		expect(U.updateFor(cache, stored()).version).toBe('1.3.0');
	});
	it('says nothing once the stored version has caught up', () => {
		expect(U.updateFor(cache, stored({ version: '1.3.0' }))).toBeNull();
	});
	it('reports a deprecation even at the same version', () => {
		const s = { source: { indexOrigin: PROD, indexId: 'eu.example.old', version: '1.0.0' } };
		expect(U.updateFor(cache, s).deprecated).toBe(true);
	});
	it('says nothing for a file import, whatever its id', () => {
		expect(U.updateFor(cache, { source: { indexId: 'eu.example.shop', version: '1.0.0' } })).toBeNull();
	});
	it('says nothing for the same id from another origin', () => {
		expect(U.updateFor(cache, stored({ indexOrigin: DEV }))).toBeNull();
	});
	it('says nothing for an entry with no provenance at all', () => {
		expect(U.updateFor(cache, { name: 'x' })).toBeNull();
	});
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/eu-updates.test.mjs`
Expected: FAIL — `Cannot find module '../js/eu-updates.js'`.

- [ ] **Step 3: Write the implementation**

Create `js/eu-updates.js`:

```js
// The anonymous update check for imported entries: which origins are due, what
// each is asked, how its answer is validated, where the result is cached, and
// which stored entry a cached result belongs to.
//
// This file owns the euUpdates key end to end. GesturaEuLocal deliberately does
// not: that one holds the switch and the consent, which every gated path in
// every frame reads on every action, and it is loaded in content scripts and the
// service worker where the update cache has no business existing. The cache is a
// different key with a different lifetime, read only by the options page.
//
// Everything here is pure except read/write/clear and runUpdateCheck(), which
// takes its fetch as an argument - so the whole file is testable in vitest
// without chrome and without a network.
(function (root) {
	'use strict';

	const EU = root.FlowMouseEuIntegration;

	const KEY = 'euUpdates';
	const PATH = '/api/v1/updates';
	const THROTTLE_MS = 24 * 60 * 60 * 1000;
	const REQUEST_TIMEOUT_MS = 8000;
	const LIMITS = { responseMaxBytes: 256 * 1024, resultsMax: 200, versionMax: 32, changelogMax: 1000 };

	// --- cache ------------------------------------------------------------------
	// An array of per-origin slots, never an object keyed by origin: the keys
	// would be arbitrary strings from storage, and one shared checkedAt could not
	// express "production answered, the dev index was down".

	function normalizeCache(cache) {
		const list = (cache && Array.isArray(cache.origins)) ? cache.origins : [];
		const origins = [];
		const seen = new Set();
		for (const slot of list) {
			if (!slot || typeof slot !== 'object') continue;
			if (typeof slot.origin !== 'string' || !slot.origin || seen.has(slot.origin)) continue;
			seen.add(slot.origin);
			origins.push({
				origin: slot.origin,
				checkedAt: typeof slot.checkedAt === 'string' ? slot.checkedAt : '',
				results: Array.isArray(slot.results)
					? slot.results.filter(r => r && typeof r === 'object' && typeof r.id === 'string')
					: [],
			});
		}
		return { origins };
	}

	// In place, so the stored order stays stable and a write changes as little as
	// possible.
	function mergeSlot(cache, origin, results, checkedAtIso) {
		const origins = normalizeCache(cache).origins.slice();
		const slot = { origin, checkedAt: checkedAtIso, results };
		const idx = origins.findIndex(s => s.origin === origin);
		if (idx >= 0) origins[idx] = slot; else origins.push(slot);
		return { origins };
	}

	function dropOrigin(cache, origin) {
		return { origins: normalizeCache(cache).origins.filter(s => s.origin !== origin) };
	}

	// Whatever the panel forgot to clean up: a developer origin that changed or
	// went away leaves a slot nobody can ever ask about again.
	function pruneOrigins(cache, allowed) {
		const keep = new Set(allowed || []);
		return { origins: normalizeCache(cache).origins.filter(s => keep.has(s.origin)) };
	}

	// --- what to ask -------------------------------------------------------------

	function updateRequestGroups(settings, local) {
		const allowed = new Set(EU.allowedOrigins(local));
		const byOrigin = new Map();
		for (const e of EU.listProvenanced(settings)) {
			const s = e.stored.source;
			if (!s || typeof s.indexOrigin !== 'string' || !allowed.has(s.indexOrigin)) continue;
			if (typeof s.indexId !== 'string' || !EU.ID_RE.test(s.indexId)) continue;
			if (!byOrigin.has(s.indexOrigin)) byOrigin.set(s.indexOrigin, new Map());
			const entries = byOrigin.get(s.indexOrigin);
			// The same index entry can sit in two storage places (a custom copy and
			// an edited catalog copy). One question is enough.
			if (entries.has(s.indexId)) continue;
			entries.set(s.indexId, {
				id: s.indexId,
				type: e.kind,
				version: typeof s.version === 'string' ? s.version : null,
			});
		}
		return [...byOrigin].map(([origin, entries]) => ({ origin, entries: [...entries.values()] }));
	}

	function dueOrigins(cache, groups, nowMs) {
		const slots = new Map(normalizeCache(cache).origins.map(s => [s.origin, s]));
		return (groups || []).filter(g => {
			const slot = slots.get(g.origin);
			if (!slot || !slot.checkedAt) return true;
			const t = Date.parse(slot.checkedAt);
			// A stamp from the future means the clock was wrong when it was written;
			// treating it as "not due" would lock the check out until it passes.
			if (Number.isNaN(t) || t > nowMs) return true;
			return nowMs - t >= THROTTLE_MS;
		});
	}

	// --- the answer ---------------------------------------------------------------
	// Strict on the envelope, lenient on the element: a broken envelope leaves the
	// slot untouched (so a bad answer starts no throttle window), while a single
	// element the client cannot use is dropped - an element naming a type some
	// future level introduces must not invalidate today's answer.

	function normalizeResult(raw, origin, asked, seen) {
		if (!raw || typeof raw !== 'object') return null;
		if (typeof raw.id !== 'string' || !asked.has(raw.id) || seen.has(raw.id)) return null;
		if (raw.type !== 'menu' && raw.type !== 'engine') return null;
		if (typeof raw.version !== 'string' || !raw.version || raw.version.length > LIMITS.versionMax) return null;
		if (typeof raw.url !== 'string') return null;
		let url;
		try { url = new URL(raw.url); } catch { return null; }
		// Never a download from anywhere but the origin that answered - the
		// extension is not a fetch proxy for a third party.
		if (url.origin !== origin) return null;
		const out = { id: raw.id, type: raw.type, version: raw.version, url: url.href };
		if (typeof raw.changelog === 'string' && raw.changelog) out.changelog = raw.changelog.slice(0, LIMITS.changelogMax);
		if (raw.deprecated === true) out.deprecated = true;
		if (typeof raw.successor === 'string' && EU.ID_RE.test(raw.successor)) out.successor = raw.successor;
		return out;
	}

	function parseUpdateResponse(text, origin, askedIds) {
		if (typeof text !== 'string' || !text) return null;
		if (new TextEncoder().encode(text).length > LIMITS.responseMaxBytes) return null;
		let json;
		try { json = JSON.parse(text); } catch { return null; }
		if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
		if (!Array.isArray(json.updates) || json.updates.length > LIMITS.resultsMax) return null;
		const asked = new Set(askedIds || []);
		const seen = new Set();
		const results = [];
		for (const raw of json.updates) {
			const r = normalizeResult(raw, origin, asked, seen);
			if (!r) continue;
			seen.add(r.id);
			results.push(r);
		}
		return { results };
	}

	// --- what to show ---------------------------------------------------------------

	// Compared against what the entry stores NOW, not against the server's idea of
	// "newer": the cache still holds the answer after the user adopted it, and this
	// is what makes the badge disappear on import instead of at the next check.
	function updateFor(cache, stored) {
		const s = stored && stored.source;
		if (!s || typeof s.indexOrigin !== 'string' || typeof s.indexId !== 'string') return null;
		const slot = normalizeCache(cache).origins.find(o => o.origin === s.indexOrigin);
		if (!slot) return null;
		const hit = slot.results.find(r => r.id === s.indexId);
		if (!hit) return null;
		const known = typeof s.version === 'string' ? s.version : null;
		if (hit.version === known && !hit.deprecated) return null;
		return hit;
	}

	const api = {
		KEY, PATH, THROTTLE_MS, REQUEST_TIMEOUT_MS, LIMITS,
		normalizeCache, mergeSlot, dropOrigin, pruneOrigins,
		updateRequestGroups, dueOrigins, parseUpdateResponse, updateFor,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaEuUpdates = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/eu-updates.test.mjs`
Expected: PASS, every test.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: 27 files, all green — nothing else imports this file yet.

- [ ] **Step 6: Commit**

```bash
git add js/eu-updates.js tests/eu-updates.test.mjs
git commit -m "feat(eu): the update check's pure core - grouping, validation, cache"
```

---

## Task 3: The orchestrator and the storage accessors

**Files:**
- Modify: `js/eu-updates.js`
- Modify: `tests/eu-updates.test.mjs`
- Modify: `pages/options.html:26-27`

**Interfaces:**
- Consumes: everything Task 2 produced, plus `EU.effectiveEnabled(local)`.
- Produces: `GesturaEuUpdates.runUpdateCheck({ settings, local, cache, now, fetchImpl })` → `Promise<{ cache, changed }>`; `read()` → `Promise<cache>`; `write(cache)` → `Promise<void>`; `clear()` → `Promise<void>`; `CHANGED_EVENT = 'eu-updates-changed'`.

- [ ] **Step 1: Write the failing test**

Append to `tests/eu-updates.test.mjs`:

```js
describe('runUpdateCheck', () => {
	const now = Date.parse('2026-09-02T12:00:00Z');
	const ok = (body) => ({ ok: true, text: async () => JSON.stringify(body) });
	const upd = (id) => ({ id, type: 'menu', version: '9.9.9', url: PROD + '/api/v1/menus/' + id + '/9.9.9' });

	// Records what was asked, so the per-origin grouping can be asserted from the
	// outside as well as from updateRequestGroups().
	const spy = (handler) => {
		const calls = [];
		const fetchImpl = async (url, init) => {
			calls.push({ url, body: JSON.parse(init.body), method: init.method });
			return handler(url, init);
		};
		return { calls, fetchImpl };
	};

	it('asks each origin its own endpoint, with only its own entries', async () => {
		const { calls, fetchImpl } = spy(() => ok({ apiLevel: 2, updates: [] }));
		await U.runUpdateCheck({ settings: settings(), local: local({ devOrigin: DEV }), cache: { origins: [] }, now, fetchImpl });
		expect(calls.map(c => c.url).sort()).toEqual([DEV + U.PATH, PROD + U.PATH]);
		const prod = calls.find(c => c.url.startsWith(PROD));
		expect(prod.method).toBe('POST');
		expect(prod.body.apiLevel).toBe(EU.API_LEVEL);
		expect(prod.body.entries.map(e => e.id)).toEqual(['eu.example.shop', 'eu.example.search']);
		const dev = calls.find(c => c.url.startsWith(DEV));
		expect(dev.body.entries.map(e => e.id)).toEqual(['eu.example.dev']);
	});

	it('sends nothing while the integration is not effectively enabled', async () => {
		const { calls, fetchImpl } = spy(() => ok({ apiLevel: 2, updates: [] }));
		const off = local({ consent: { version: EU.CURRENT_INTEGRATION_CONSENT - 1, date: 'x' } });
		const out = await U.runUpdateCheck({ settings: settings(), local: off, cache: { origins: [] }, now, fetchImpl });
		expect(calls).toEqual([]);
		expect(out.cache).toEqual({ origins: [] });
	});

	it('stores a validated answer in its own slot and leaves the other alone', async () => {
		const seed = { origins: [{ origin: DEV, checkedAt: '2026-09-02T11:00:00Z', results: [] }] };
		const { fetchImpl } = spy((url) => (url.startsWith(PROD) ? ok({ apiLevel: 2, updates: [upd('eu.example.shop')] }) : ok({ apiLevel: 2, updates: [] })));
		const out = await U.runUpdateCheck({ settings: settings(), local: local({ devOrigin: DEV }), cache: seed, now, fetchImpl });
		expect(out.changed).toBe(true);
		const prod = out.cache.origins.find(s => s.origin === PROD);
		expect(prod.results).toHaveLength(1);
		expect(prod.checkedAt).toBe(new Date(now).toISOString());
		// DEV was inside its window, so it was not even asked and is untouched.
		expect(out.cache.origins.find(s => s.origin === DEV)).toEqual(seed.origins[0]);
	});

	it('a network error starts no throttle window', async () => {
		const seed = { origins: [{ origin: PROD, checkedAt: '2026-09-01T00:00:00Z', results: [upd('eu.example.shop')] }] };
		const { fetchImpl } = spy(() => { throw new Error('offline'); });
		const out = await U.runUpdateCheck({ settings: settings(), local: local(), cache: seed, now, fetchImpl });
		expect(out.changed).toBe(false);
		expect(out.cache.origins[0]).toEqual(seed.origins[0]);
	});

	it('a non-200 and an invalid body leave the slot untouched too', async () => {
		const seed = { origins: [{ origin: PROD, checkedAt: '2026-09-01T00:00:00Z', results: [] }] };
		for (const res of [{ ok: false, text: async () => '{}' }, { ok: true, text: async () => 'not json' }]) {
			const { fetchImpl } = spy(() => res);
			const out = await U.runUpdateCheck({ settings: settings(), local: local(), cache: seed, now, fetchImpl });
			expect(out.cache.origins[0].checkedAt).toBe('2026-09-01T00:00:00Z');
		}
	});

	it('respects the window and skips the request entirely', async () => {
		const seed = { origins: [{ origin: PROD, checkedAt: '2026-09-02T06:00:00Z', results: [] }] };
		const { calls, fetchImpl } = spy(() => ok({ apiLevel: 2, updates: [] }));
		const out = await U.runUpdateCheck({ settings: settings(), local: local(), cache: seed, now, fetchImpl });
		expect(calls).toEqual([]);
		expect(out.changed).toBe(false);
	});

	it('prunes a slot whose origin is no longer allowed, without asking anyone', async () => {
		const seed = { origins: [{ origin: DEV, checkedAt: '2026-09-02T11:00:00Z', results: [upd('x')] }] };
		const { fetchImpl } = spy(() => ok({ apiLevel: 2, updates: [] }));
		const out = await U.runUpdateCheck({ settings: { siteMenus: {}, searchEngines: {} }, local: local({ devOrigin: '' }), cache: seed, now, fetchImpl });
		expect(out.cache.origins).toEqual([]);
		expect(out.changed).toBe(true);
	});
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/eu-updates.test.mjs -t runUpdateCheck`
Expected: FAIL — `U.runUpdateCheck is not a function`.

- [ ] **Step 3: Write the implementation**

In `js/eu-updates.js`, insert before the `const api = {` block:

```js
	// --- the run ------------------------------------------------------------------

	const CHANGED_EVENT = 'eu-updates-changed';

	// One origin, one request. Nothing here throws and nothing here decides
	// anything: a null return means "this origin said nothing usable", and the
	// caller then leaves its slot exactly as it was - checkedAt included, which is
	// what keeps a network error from starting the 24-hour window.
	async function askOrigin(group, fetchImpl) {
		const ctl = new AbortController();
		const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
		let res;
		try {
			res = await fetchImpl(group.origin + PATH, {
				method: 'POST',
				credentials: 'omit',
				cache: 'no-store',
				redirect: 'follow',
				signal: ctl.signal,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ apiLevel: EU.API_LEVEL, entries: group.entries }),
			});
		} catch {
			return null;
		} finally {
			clearTimeout(timer);
		}
		if (!res || !res.ok) return null;
		let text;
		try { text = await res.text(); } catch { return null; }
		return parseUpdateResponse(text, group.origin, group.entries.map(e => e.id));
	}

	// Sequential on purpose: two requests, at most once a day, on a page the user
	// just opened. Nothing here is worth the concurrency.
	async function runUpdateCheck(opts) {
		const { settings, local, cache, now, fetchImpl } = opts;
		const before = normalizeCache(cache);
		let out = pruneOrigins(before, EU.allowedOrigins(local));
		let changed = out.origins.length !== before.origins.length;
		if (!EU.effectiveEnabled(local)) return { cache: out, changed };
		for (const group of dueOrigins(out, updateRequestGroups(settings, local), now)) {
			const answer = await askOrigin(group, fetchImpl);
			if (!answer) continue;
			out = mergeSlot(out, group.origin, answer.results, new Date(now).toISOString());
			changed = true;
		}
		return { cache: out, changed };
	}

	// --- storage --------------------------------------------------------------------
	// Read on demand rather than cached: the options page reads once per open and
	// once per change event, and a stale cache here would show badges for an entry
	// the user just updated.

	async function read() {
		try {
			const raw = await chrome.storage.local.get(KEY);
			return normalizeCache(raw && raw[KEY]);
		} catch {
			// Storage unavailable (private mode, invalidated context): no badges is a
			// fine answer, a broken settings page is not.
			return { origins: [] };
		}
	}

	async function write(cache) {
		try { await chrome.storage.local.set({ [KEY]: normalizeCache(cache) }); } catch { /* see read() */ }
	}

	async function clear() {
		try { await chrome.storage.local.remove(KEY); } catch { /* see read() */ }
	}
```

Then extend the exported object:

```js
	const api = {
		KEY, PATH, THROTTLE_MS, REQUEST_TIMEOUT_MS, LIMITS, CHANGED_EVENT,
		normalizeCache, mergeSlot, dropOrigin, pruneOrigins,
		updateRequestGroups, dueOrigins, parseUpdateResponse, updateFor,
		runUpdateCheck, read, write, clear,
	};
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/eu-updates.test.mjs`
Expected: PASS. `read`/`write`/`clear` are untested here on purpose — they are three `chrome.storage.local` calls with a catch, and a mock of `chrome` would test the mock.

- [ ] **Step 5: Load the script on the options page**

In `pages/options.html`, after the `eu-local.js` line:

```html
	<script src="../js/eu-integration.js"></script>
	<script src="../js/eu-local.js"></script>
	<script src="../js/eu-updates.js"></script>
```

`eu-updates.js` reads `root.FlowMouseEuIntegration` at load, so it must come after `eu-integration.js`. It is **not** added to `manifest.json`'s `content_scripts` or to `js/background.js`'s `importScripts` — the check runs in the options page only, which is also why `firefox-build` needs no mirror.

- [ ] **Step 6: Guard the load order with a test**

Append to `tests/eu-updates.test.mjs`:

```js
describe('options.html', () => {
	it('loads eu-updates.js after eu-integration.js', async () => {
		const { readFileSync } = await import('node:fs');
		const { fileURLToPath } = await import('node:url');
		const { dirname, join } = await import('node:path');
		const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'pages', 'options.html'), 'utf8');
		const order = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(m => m[1].split('/').pop());
		const dep = order.indexOf('eu-integration.js');
		const own = order.indexOf('eu-updates.js');
		expect(dep).toBeGreaterThanOrEqual(0);
		expect(own).toBeGreaterThan(dep);
	});
});
```

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add js/eu-updates.js tests/eu-updates.test.mjs pages/options.html
git commit -m "feat(eu): run the update check per origin, cache what validates"
```

---

## Task 4: Consent version 2

The extension now sends a request the user did not click. Two claims currently on record become false, and both are load-bearing for consent — so this task is not "add a bullet", it is "correct what we promised".

**Files:**
- Modify: `js/eu-integration.js:12-13`
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json`
- Modify: `_locales/<the other 37>/messages.json` (delete one key)
- Modify: `tests/site-menu-locales.test.mjs:18-23`
- Modify: `tests/eu-integration.test.mjs`
- Modify: `js/components/eu-integration-panel.js:204`

**Interfaces:**
- Consumes: nothing new.
- Produces: `EU.CURRENT_INTEGRATION_CONSENT === 2`, `EU.API_LEVEL === 2`; message keys `euIntegrationConsentPoint5Label`, `euIntegrationConsentPoint5`.

- [ ] **Step 1: Write the failing test**

In `tests/eu-integration.test.mjs`, replace the two version assertions (search for `CURRENT_INTEGRATION_CONSENT` in the `normalizeLocal` block and any `apiLevel` assertion in the `helloAnswer` block):

```js
	it('keeps a well-formed consent', () => {
		const n = EU.normalizeLocal(on());
		expect(n.euIntegration.consent).toEqual({ version: 2, date: '2026-09-02T00:00:00Z' });
	});
```

and add, in the `helloAnswer` block:

```js
	it('announces the level the update endpoint belongs to', () => {
		expect(EU.API_LEVEL).toBe(2);
		expect(EU.helloAnswer({ requestId: 'r' }, '2.8.0')).toEqual({ requestId: 'r', version: '2.8.0', apiLevel: 2 });
	});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/eu-integration.test.mjs`
Expected: FAIL — `expected 1 to be 2`.

- [ ] **Step 3: Raise both numbers**

In `js/eu-integration.js`:

```js
	// Bumping this re-prompts every user: effectiveEnabled() is false until the
	// stored consent carries the current number. R1 = 1. R2 = 2 (the update
	// check sends a request the user did not click). R3 raises it again.
	const CURRENT_INTEGRATION_CONSENT = 2;
	const API_LEVEL = 2;
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/eu-integration.test.mjs tests/eu-bridge-protocol.test.mjs`
Expected: PASS. If a bridge test hard-codes `apiLevel: 1`, fix it to `EU.API_LEVEL` rather than to `2` — the assertion is about the echo, not about the number.

- [ ] **Step 5: Add the fifth consent point in en**

In `_locales/en/messages.json`, beside the other consent points:

```json
	"euIntegrationConsentPoint5Label": { "message": "Update notices:" },
	"euIntegrationConsentPoint5": { "message": "When you open these settings, Gestura asks gestura.eu — at most once a day — whether newer versions exist for the entries you took from there. It sends nothing but their identifiers and version numbers: no account, no identifier of you, and nothing about the rest of your settings. Entries you imported from a file are never included. Nothing is downloaded or changed without your confirmation in the import window." },
```

- [ ] **Step 6: Correct the two claims that R2 breaks in en**

`euIntegrationConsentPoint1` says *"sends no unsolicited requests — no account, no identifier, no background activity"* and `euIntegrationConsentPoint4` says *"Away from gestura.eu, nothing happens."* Both are now untrue. Replace them:

```json
	"euIntegrationConsentPoint1Label": { "message": "Anonymous throughout:" },
	"euIntegrationConsentPoint1": { "message": "No account, no registration, no identifier of you. Apart from the update check described below, Gestura turns to gestura.eu only when you click something — and it never hands over one of your menus, search engines or settings without your confirmation." },
	"euIntegrationConsentPoint4Label": { "message": "Local and reversible:" },
	"euIntegrationConsentPoint4": { "message": "Your consent applies to this device only, is never synced, and can be withdrawn at any time. Withdrawing switches the integration off in the same step and deletes the update notices Gestura has stored." },
```

Also `euIntegrationIntro` ends with *"Gestura sends nothing at all until you act"*, which now reads as a promise about the wrong thing. End it with **"…and Gestura stays silent until you switch this on."** instead.

- [ ] **Step 7: Mirror all of it in de**

```json
	"euIntegrationConsentPoint5Label": { "message": "Update-Hinweise:" },
	"euIntegrationConsentPoint5": { "message": "Wenn du diese Einstellungen öffnest, fragt Gestura höchstens einmal täglich bei gestura.eu nach, ob es für die von dort übernommenen Einträge neuere Versionen gibt. Übertragen werden dabei nur deren Kennungen und Versionsnummern: kein Konto, keine Kennung von dir und nichts über den Rest deiner Einstellungen. Aus einer Datei importierte Einträge sind nie dabei. Heruntergeladen oder geändert wird nichts ohne deine Bestätigung im Import-Fenster." },
	"euIntegrationConsentPoint1Label": { "message": "Durchweg anonym:" },
	"euIntegrationConsentPoint1": { "message": "Kein Konto, keine Anmeldung, keine Kennung von dir. Außer der unten beschriebenen Update-Prüfung wendet sich Gestura nur dann an gestura.eu, wenn du etwas anklickst – und gibt niemals eines deiner Menüs, eine Suchmaschine oder eine Einstellung ohne deine Bestätigung weiter." },
	"euIntegrationConsentPoint4Label": { "message": "Lokal und flexibel:" },
	"euIntegrationConsentPoint4": { "message": "Deine Zustimmung gilt nur auf diesem Gerät, wird nicht synchronisiert und lässt sich jederzeit widerrufen. Der Widerruf schaltet die Integration im selben Schritt ab und löscht die gespeicherten Update-Hinweise." },
```

And the German `euIntegrationIntro` ending, to match: **"…und Gestura bleibt still, bis du das hier einschaltest."**

- [ ] **Step 8: Delete the stale translations of the one all-39 key**

`euIntegrationConsentPoint1` is the only key changed here that already exists in all 39 locales (points 2 and 3 are unchanged; the labels and point 4 are still en/de-only). Its 37 other translations now promise something untrue, and **no test catches a changed wording** — so they are removed rather than left standing. An English consent sentence is honest where a translated one would not be.

**All 37, never a subset — and this is why.** `getMessage` in [js/i18n.js:96](../../../js/i18n.js) reads the loaded override catalog first and on a miss calls `chrome.i18n.getMessage(key)`, which resolves through the **browser's UI locale chain** to `default_locale` = `en` (a total miss yields a visible `[!!!]key`, never an empty string). That chain is *not* the language the user picked in Gestura. So with the key deleted from `de` but still present in `fr`, a French browser whose Gestura language is set to German renders the stale **French** sentence — precisely the failure this step exists to prevent. Only deleting every one of the 37 closes every such combination. Do not "restore" a few of them later.

The guard machinery then needs no change: `PENDING_TRANSLATION` excludes the key from the per-locale completeness check, the "exists in en and de" test still holds it, and "are not yet complete everywhere" passes at 2 of 39 and fails once someone translates all of them — which is the signal to drop it from the list.

```bash
node -e '
const fs = require("fs");
const dir = "_locales";
for (const lang of fs.readdirSync(dir)) {
	if (lang === "en" || lang === "de") continue;
	const p = dir + "/" + lang + "/messages.json";
	const before = fs.readFileSync(p, "utf8");
	// One key, one line, tabs preserved: a JSON round-trip would reformat the file.
	const after = before.replace(/^\t"euIntegrationConsentPoint1":.*\n/m, "");
	if (after !== before) { fs.writeFileSync(p, after); console.log("stripped", lang); }
}'
```

Run it, then confirm exactly 37 lines were reported and that en/de still have the key:

```bash
grep -l '"euIntegrationConsentPoint1"' _locales/*/messages.json
```
Expected: only `_locales/de/messages.json` and `_locales/en/messages.json`.

- [ ] **Step 9: Put every en/de-only key on the tracker**

In `tests/site-menu-locales.test.mjs`, extend `PENDING_TRANSLATION`:

```js
const PENDING_TRANSLATION = ['euIntegrationIntro', 'euIntegrationIntroLink',
	'euIntegrationConsentLead', 'euIntegrationConsentPoint4', 'euIntegrationConsentGranted',
	'euIntegrationConsentDate', 'euIntegrationConsentRevoke',
	'euIntegrationConsentPoint1Label', 'euIntegrationConsentPoint2Label',
	'euIntegrationConsentPoint3Label', 'euIntegrationConsentPoint4Label',
	'euIntegrationConsentPoint1', 'euIntegrationConsentPoint5Label', 'euIntegrationConsentPoint5',
	'exchangeConflictModified'];
```

(The badge keys land here in Task 6; keeping the two edits separate keeps each task's test run honest.)

- [ ] **Step 10: Render the fifth point**

In `js/components/eu-integration-panel.js`, in `#renderOverlay()`:

```js
		const points = [1, 2, 3, 4, 5].map(n => [`euIntegrationConsentPoint${n}Label`, `euIntegrationConsentPoint${n}`]);
```

The update check is point 5, after "local and reversible", because it is the one thing the user has to take on board *in addition to* what R1 described — and the overlay's own order goes from what the service does for you towards what it costs you.

- [ ] **Step 11: Clear the cache when consent goes away**

In the same file, `#revoke()` — the cache is derived from a permission that no longer exists, and a badge surviving a withdrawal would be exactly the kind of leftover the panel promises not to keep:

```js
	async #revoke() {
		this._consentOpen = false;
		this.#lockScroll(false);
		// A failed write leaves _local untouched, so the panel keeps showing the
		// consent that is still on record instead of a state nobody stored.
		try { await window.GesturaEuLocal.write({ enabled: false, consent: null }); } catch { /* nothing changed */ }
		// Derived from a permission that is gone: the notices go with it, and the
		// managers drop their badges on the event.
		await window.GesturaEuUpdates.clear();
		window.dispatchEvent(new Event(window.GesturaEuUpdates.CHANGED_EVENT));
	}
```

- [ ] **Step 12: Drop the old slot when the developer origin changes**

In `#commitDevOrigin()`, after the successful write — the entries imported from the previous dev origin can never be asked about again, so their cached answers are dead weight that would keep rendering badges:

```js
	async #commitDevOrigin() {
		// Origins get pasted from a browser bar far more often than typed, and those
		// carry a trailing slash that isValidDevOrigin rejects. Trim it instead of
		// blaming the user.
		const value = (this._devDraft || '').trim().replace(/\/+$/, '');
		if (value && !window.FlowMouseEuIntegration.isValidDevOrigin(value)) { this._devError = true; return; }
		this._devError = false;
		const previous = this.#state ? this.#state.devOrigin : '';
		await window.GesturaEuLocal.write({ devOrigin: value });
		if (previous && previous !== value) {
			const cache = await window.GesturaEuUpdates.read();
			await window.GesturaEuUpdates.write(window.GesturaEuUpdates.dropOrigin(cache, previous));
			window.dispatchEvent(new Event(window.GesturaEuUpdates.CHANGED_EVENT));
		}
	}
```

- [ ] **Step 13: Stop a storage change from eating the developer-origin draft**

An R1 defect in the file this task already edits, folded in so two people do not
edit `eu-integration-panel.js` in parallel for no reason. `#absorb(local)`
reassigns `this._devDraft` on **every** storage change — and the panel causes
those itself (the toggle, the revoke, steps 11 and 12 above, a write from a
second options tab). Typing an origin and then touching anything else discards
what was typed and moves the cursor.

```js
	#absorb(local) {
		this._local = local;
		// A storage change must not move the cursor or throw away an uncommitted
		// draft - and this panel triggers such changes itself. While the field has
		// focus its draft is the truth; #commitDevOrigin decides when that becomes
		// storage. renderRoot is undefined before the first render, which is exactly
		// when there is no draft to protect.
		const field = this.renderRoot && this.renderRoot.querySelector('.dev-field input');
		if (field && this.renderRoot.activeElement === field) return;
		this._devDraft = local.euIntegration.devOrigin;
	}
```

With the draft now surviving the write, `#commitDevOrigin` has to show what was
actually stored — otherwise a pasted `https://host/` keeps its trailing slash on
screen while storage holds the trimmed origin. Add one line after `_devError` is
cleared, before the write from step 12:

```js
		this._devError = false;
		this._devDraft = value;
```

- [ ] **Step 14: Verify the draft survives**

No test — this is focus behaviour, which vitest cannot see without a DOM harness
the project does not have. By hand, in the loaded extension: open the settings,
enable the integration, turn on the section's advanced mode, type
`http://localhost:81` into the developer-origin field **without leaving it**, and
switch some other setting on the page.
Expected: the half-typed text and the cursor are still there. Then press Enter
and confirm the stored value appears trimmed.

- [ ] **Step 15: Run the suite**

Run: `npm test`
Expected: all green — in particular `site-menu-locales` (both the completeness check and "are not yet complete everywhere") and `locale-placeholders` (no `$WORD$` slipped into the new strings).

- [ ] **Step 16: Commit**

```bash
git add js/eu-integration.js js/components/eu-integration-panel.js _locales tests/site-menu-locales.test.mjs tests/eu-integration.test.mjs
git commit -m "feat(eu): consent 2 - say that the update check sends a request

Also fixes an R1 defect in the same panel: any storage change reset the
developer-origin field while it was being typed into."
```

One commit, not two: steps 11–13 all edit `eu-integration-panel.js`, so the draft
fix cannot be staged on its own without dragging the cache clearing along. The
message names it instead.

---

## Task 5: Run the check when the settings open

**Files:**
- Modify: `js/components/options-page.js:330-350`
- Modify: `js/components/eu-integration-panel.js`
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json`
- Modify: `tests/site-menu-locales.test.mjs`

**Interfaces:**
- Consumes: `GesturaEuUpdates.{read, write, runUpdateCheck, clear, CHANGED_EVENT}`, `GesturaEuLocal.read()`.
- Produces: the `eu-updates-changed` window event that Task 6's managers listen for.

- [ ] **Step 1: Kick it off from `#init()`**

At the end of `#init()` in `js/components/options-page.js`, inside the existing `updateComplete.then(...)`:

```js
		this.updateComplete.then(() => {
			this.#handleHashNavigation();
			window.addEventListener('hashchange', () => this.#handleHashNavigation());
			this.#resumeAfterImport();
			this.#checkForEntryUpdates();
		});
```

and add the method beside `#checkPendingImport()`:

```js
	// The update check for imported entries (js/eu-updates.js). Deliberately here
	// and nowhere else: no alarm, no worker, no traffic while the settings are
	// closed. It is throttled per origin inside runUpdateCheck(), so calling it on
	// every open costs at most one request a day per index.
	//
	// Awaited after the first render, never before: the check must not delay the
	// page, and it has nothing to show until its answer is in.
	async #checkForEntryUpdates() {
		const U = window.GesturaEuUpdates;
		try {
			const { cache, changed } = await U.runUpdateCheck({
				settings: this._store.current,
				local: await window.GesturaEuLocal.read(),
				cache: await U.read(),
				now: Date.now(),
				fetchImpl: (url, init) => fetch(url, init),
			});
			if (!changed) return;
			await U.write(cache);
			window.dispatchEvent(new Event(U.CHANGED_EVENT));
		} catch {
			// A nicety in the background: no dialog, no status line. The next open
			// tries again, because a failed origin's checkedAt was never written.
		}
	}
```

- [ ] **Step 2: Add the panel's last-checked line and manual trigger**

Advanced mode only, beside the developer-origin field: without it, testing against a local mock means waiting out 24 hours or clearing storage by hand — the same reason the developer-origin field exists at all. In `js/components/eu-integration-panel.js`, add to `static properties`:

```js
		_checked: { state: true },
		_checking: { state: true },
```

initialize them in the constructor (`this._checked = ''; this._checking = false;`), read the cache in `connectedCallback()`:

```js
		window.GesturaEuUpdates.read().then(cache => { this._checked = this.#latestCheck(cache); });
```

The panel does not import the settings store today, and `#checkNow()` needs the
live settings to know what to ask about. Add it to the imports at the top of the
file:

```js
import { settingsStore } from '../settings-store.js';
```

and add:

```js
	// The newest checkedAt across all slots: the line answers "did this work at
	// all", not "when was each index asked".
	#latestCheck(cache) {
		return (cache.origins || [])
			.map(s => s.checkedAt)
			.filter(Boolean)
			.sort()
			.pop() || '';
	}

	// Ignores the 24-hour window by clearing the slots first - that is the whole
	// point of a manual check, and it is the only way to exercise a local index
	// without waiting a day.
	async #checkNow() {
		const U = window.GesturaEuUpdates;
		this._checking = true;
		try {
			await U.clear();
			const { cache } = await U.runUpdateCheck({
				settings: settingsStore.current,
				local: await window.GesturaEuLocal.read(),
				cache: { origins: [] },
				now: Date.now(),
				fetchImpl: (url, init) => fetch(url, init),
			});
			await U.write(cache);
			this._checked = this.#latestCheck(cache);
			window.dispatchEvent(new Event(U.CHANGED_EVENT));
		} catch { /* nothing to report: the line simply keeps its old date */ }
		this._checking = false;
	}
```

Render it inside the existing advanced-mode block, after the dev-origin row:

```js
				<div class="setting-row">
					<div class="setting-label">
						<span>${i18n.getMessage('euIntegrationUpdateCheck')}</span>
						<span>${this._checked
							? i18n.getMessage('euIntegrationLastChecked').replace('{date}', this.#formatCheck(this._checked))
							: i18n.getMessage('euIntegrationNeverChecked')}</span>
					</div>
					<div class="row-actions">
						<button class="btn btn-secondary" ?disabled=${this._checking} @click=${this.#checkNow}>
							${i18n.getMessage('euIntegrationCheckNow')}
						</button>
					</div>
				</div>
```

with a formatter beside `#consentDate()` (same shape, but the time matters here — a manual check twice in one minute must be visibly different):

```js
	#formatCheck(iso) {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		try {
			return d.toLocaleString(window.i18n.getHtmlLang(), { dateStyle: 'medium', timeStyle: 'short' });
		} catch {
			return d.toISOString().slice(0, 16).replace('T', ' ');
		}
	}
```

- [ ] **Step 3: Add the four keys in en and de**

en:

```json
	"euIntegrationUpdateCheck": { "message": "Update check" },
	"euIntegrationCheckNow": { "message": "Check now" },
	"euIntegrationLastChecked": { "message": "Last asked {date}. Normally at most once a day, when these settings open." },
	"euIntegrationNeverChecked": { "message": "Not asked yet. Happens when these settings open, at most once a day." },
```

de:

```json
	"euIntegrationUpdateCheck": { "message": "Update-Prüfung" },
	"euIntegrationCheckNow": { "message": "Jetzt prüfen" },
	"euIntegrationLastChecked": { "message": "Zuletzt gefragt am {date}. Normalerweise höchstens einmal täglich, beim Öffnen dieser Einstellungen." },
	"euIntegrationNeverChecked": { "message": "Noch nicht gefragt. Passiert beim Öffnen dieser Einstellungen, höchstens einmal täglich." },
```

Add all four to `PENDING_TRANSLATION`.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 5: Verify by hand against a local mock**

The endpoint does not exist yet, so serve one. In the scratchpad, not the repo:

```bash
cat > /tmp/updates-mock.mjs <<'EOF'
import { createServer } from 'node:http';
const body = JSON.stringify({
	apiLevel: 2,
	updates: [{
		id: process.env.ID || 'eu.example.shop',
		type: process.env.TYPE || 'menu',
		version: '9.9.9',
		url: 'http://localhost:8123/bundle.json',
		changelog: 'Two new patterns, one fixed icon.',
	}],
});
createServer((req, res) => {
	const cors = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
	};
	if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
	let raw = '';
	req.on('data', c => { raw += c; });
	req.on('end', () => {
		console.log(req.method, req.url, raw);
		res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
		res.end(body);
	});
}).listen(8123, () => console.log('mock on http://localhost:8123'));
EOF
node /tmp/updates-mock.mjs
```

Then: load the unpacked extension, set `http://localhost:8123` as the developer origin, import an entry from that origin (`docs/test-bundles`, served by the same port or another — the mock logs whatever it gets), reopen the settings.

Expected, and each of these is a claim to check rather than assume:
1. The mock logs an `OPTIONS` and then a `POST /api/v1/updates` whose body contains `apiLevel: 2` and exactly the entries imported from `localhost:8123` — and **no** entry imported from a file.
2. Reopening the settings within the same day logs nothing more.
3. "Check now" logs a fresh request and updates the date.
4. `chrome.storage.local` holds `euUpdates` with one slot for `http://localhost:8123`.
5. Stopping the mock and pressing "Check now" leaves the stored `checkedAt` at its old value.

- [ ] **Step 6: Commit**

```bash
git add js/components/options-page.js js/components/eu-integration-panel.js _locales tests/site-menu-locales.test.mjs
git commit -m "feat(options): ask each index for updates when the settings open"
```

---

## Task 6: The badges, and adopting an update

**Files:**
- Modify: `js/components/import-feedback.js`
- Modify: `js/components/site-menu-manager.js`
- Modify: `js/components/engine-manager.js`
- Modify: `css/common.css:684`
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json`
- Modify: `tests/site-menu-locales.test.mjs`

**Interfaces:**
- Consumes: `GesturaEuUpdates.{read, updateFor, CHANGED_EVENT}`, `FlowMouseEuIntegration.findStored`, the managers' existing `#importUrl(url)` and `#dialog()`.
- Produces: nothing later tasks build on.

- [ ] **Step 1: Add the shared badge**

Both managers already share `renderImportBadge` from `js/components/import-feedback.js`; the update badge belongs in the same place for the same reason — two copies could describe the same cached answer differently. Append to that file:

Add `tooltip` to that file's imports first — the directive takes a plain string
(`js/tooltip.js` assigns it to `textContent`, so it must be one flat string):

```js
import { tooltip } from '../tooltip.js';
```

```js
// Ein Update-Hinweis aus dem Cache (js/eu-updates.js). Zwei Formen, weil sie
// Verschiedenes bedeuten: eine neuere Version ist ein Angebot, eine Abkündigung
// ist eine Information - für die es nichts zu übernehmen gibt.
export function renderUpdateBadge(i18n, up) {
	if (!up) return '';
	if (up.deprecated) {
		const text = up.successor
			? i18n.getMessage('euIntegrationRetiredSuccessor').replace('{id}', up.successor)
			: i18n.getMessage('euIntegrationRetiredTooltip');
		return html`<span class="retired-badge" .tooltip=${tooltip(text)}>${i18n.getMessage('euIntegrationRetiredBadge')}</span>`;
	}
	// Ein Absatz, kein Zeilenumbruch: der Tooltip setzt textContent und trägt kein
	// white-space: pre-line - ein "\n" verschwände lautlos mitten im Satz.
	const parts = [i18n.getMessage('euIntegrationUpdateTooltip').replace('{version}', up.version)];
	if (up.changelog) parts.push(up.changelog);
	return html`<span class="update-badge" .tooltip=${tooltip(parts.join(' — '))}>${i18n.getMessage('euIntegrationUpdateBadge')}</span>`;
}
```

The tooltip is capped at 250px and wraps, so a long changelog costs height, not
legibility. It is the reason the changelog is truncated to 1000 characters when
it is cached rather than when it is rendered.

- [ ] **Step 2: Style the two badges**

In `css/common.css`, after the `.import-badge` block (it is inlined into the shadow roots via `commonStyles`, so this is the right file):

```css
.update-badge,
.retired-badge {
	flex-shrink: 0;
	padding: 1px 6px;
	border-radius: 999px;
	font-size: 10px;
	font-weight: 600;
	cursor: help;
}

.update-badge {
	color: var(--attention-color);
	background: color-mix(in srgb, var(--attention-color) 14%, transparent);
	box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--attention-color) 40%, transparent);
}

.retired-badge {
	color: var(--text-muted);
	background: color-mix(in srgb, var(--text-muted) 12%, transparent);
	box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text-muted) 30%, transparent);
}
```

- [ ] **Step 3: Wire the menu manager**

In `js/components/site-menu-manager.js` — the import line, a state field, the cache read, and the row.

```js
import { ImportHighlight, renderImportDone, renderImportBadge, renderUpdateBadge } from './import-feedback.js';
```

In `static properties`: `_updates: { state: true },`. In the constructor: `this._updates = { origins: [] };`.

In `connectedCallback()` (add beside the existing listeners; keep the bound reference so `disconnectedCallback()` can remove it):

```js
		this._boundUpdates = () => { window.GesturaEuUpdates.read().then(c => { this._updates = c; }); };
		this._boundUpdates();
		window.addEventListener(window.GesturaEuUpdates.CHANGED_EVENT, this._boundUpdates);
```

and in `disconnectedCallback()`:

```js
		window.removeEventListener(window.GesturaEuUpdates.CHANGED_EVENT, this._boundUpdates);
```

A lookup helper beside `#renderMenuRow`:

```js
	// The row's own def is not enough: a menu can sit in siteMenus.custom or in
	// siteMenus.edited, and listMenus() merges both into one shape. findStored()
	// is the resolver that knows where provenance actually lives.
	#updateFor(id) {
		const stored = window.FlowMouseEuIntegration.findStored(settingsStore.current, 'menu', id);
		return window.GesturaEuUpdates.updateFor(this._updates, stored);
	}
```

In `#renderMenuRow`, after the existing badges:

```js
		const up = this.#updateFor(m.id);
```

```js
					${m.isEdited ? html`<span class="edited-badge">${i18n.getMessage('siteMenuEdited')}</span>` : ''}
					${renderUpdateBadge(i18n, up)}
					${this.#highlight.isMarked(m.id) ? renderImportBadge(i18n) : ''}
```

and in `.menu-buttons`, before the export button:

```js
					${up && !up.deprecated ? html`
						<button class="menu-btn" .tooltip=${tooltip(i18n.getMessage('euIntegrationUpdateApply'))}
							@click=${(e) => { e.stopPropagation(); this.#importUrl(up.url); }}>
							${unsafeHTML(icon('download', { size: 14, strokeWidth: 2 }))}
						</button>
					` : ''}
```

`#importUrl` already fetches, derives `indexOrigin` from the final `Response.url`, and opens the import dialog — so adopting an update is the same reviewed path as a manual URL import, including the "you changed this entry" warning that leaves an edited row unticked. Nothing about that is bypassed here, deliberately.

- [ ] **Step 4: Wire the engine manager the same way**

`js/components/engine-manager.js`, identical except for the kind and the row markup. The import, `_updates`, the constructor line, the two listener lines and:

```js
	#updateFor(id) {
		const stored = window.FlowMouseEuIntegration.findStored(settingsStore.current, 'engine', id);
		return window.GesturaEuUpdates.updateFor(this._updates, stored);
	}
```

`#getResolvedEngines()` builds its rows from a **fixed field list** that does not include `source`, so reading `eng.source` here would silently always be `undefined` — going through `findStored()` is not a stylistic choice. In `#renderRow`, after the other badges:

```js
		const up = this.#updateFor(eng.id);
```

```js
						${hidden ? html`<span class="engine-badge">${i18n.getMessage('engineHiddenBadge')}</span>` : ''}
						${renderUpdateBadge(i18n, up)}
						${this.#highlight.isMarked(eng.id) ? renderImportBadge(i18n) : ''}
```

and in `.engine-buttons`, right after the edit button:

```js
					${up && !up.deprecated ? html`
						<button class="engine-btn" .tooltip=${tooltip(i18n.getMessage('euIntegrationUpdateApply'))}
							@click=${(e) => { e.stopPropagation(); this.#importUrl(up.url); }}>
							${unsafeHTML(icon('download', { size: 14, strokeWidth: 2 }))}
						</button>
					` : ''}
```

- [ ] **Step 5: Add the six keys in en and de**

en:

```json
	"euIntegrationUpdateBadge": { "message": "Update" },
	"euIntegrationUpdateTooltip": { "message": "gestura.eu offers version {version}. Adopting it opens the import window, where you decide." },
	"euIntegrationUpdateApply": { "message": "Adopt update" },
	"euIntegrationRetiredBadge": { "message": "Retired" },
	"euIntegrationRetiredTooltip": { "message": "gestura.eu no longer maintains this entry. Yours keeps working exactly as it is." },
	"euIntegrationRetiredSuccessor": { "message": "gestura.eu no longer maintains this entry; {id} takes its place. Yours keeps working exactly as it is." },
```

de:

```json
	"euIntegrationUpdateBadge": { "message": "Update" },
	"euIntegrationUpdateTooltip": { "message": "gestura.eu bietet Version {version} an. Beim Übernehmen öffnet sich das Import-Fenster, in dem du entscheidest." },
	"euIntegrationUpdateApply": { "message": "Update übernehmen" },
	"euIntegrationRetiredBadge": { "message": "Eingestellt" },
	"euIntegrationRetiredTooltip": { "message": "gestura.eu pflegt diesen Eintrag nicht mehr. Deiner funktioniert unverändert weiter." },
	"euIntegrationRetiredSuccessor": { "message": "gestura.eu pflegt diesen Eintrag nicht mehr; {id} tritt an seine Stelle. Deiner funktioniert unverändert weiter." },
```

All six into `PENDING_TRANSLATION`. Note `{version}` and `{id}` are `{token}` placeholders resolved with `.replace()` — never `$WORD$`, which would stop the extension from loading at all.

- [ ] **Step 6: Run the suite**

Run: `npm test`
Expected: all green, `locale-placeholders` included.

- [ ] **Step 7: Verify by hand**

With the mock from Task 5 still running and an entry imported from `localhost:8123`:

1. The imported entry's row shows an **Update** badge; its tooltip names version 9.9.9 and shows the changelog underneath.
2. A menu imported from a **file** with the same id shows **no** badge.
3. The adopt button opens the import dialog with the fetched payload and the replace/new choice visible beside the row.
4. Rename the imported entry first, then press adopt: the row arrives **unticked** with the "you changed this entry" warning. That is R1's behaviour working as intended, not a defect.
5. Actually adopting the update makes the badge disappear immediately, without a new check — `updateFor` compares against the stored version.
6. Set the mock's `deprecated: true` (edit the mock, restart, "Check now"): the badge becomes **Retired**, and the adopt button is gone.

- [ ] **Step 8: Commit**

```bash
git add js/components/import-feedback.js js/components/site-menu-manager.js js/components/engine-manager.js css/common.css _locales tests/site-menu-locales.test.mjs
git commit -m "feat(options): update and retired badges on the entries they concern"
```

---

## Task 7: Privacy, store declarations, changelog

Spec §6 makes this part of the release, not an afterthought — and `PRIVACY.md` currently contains a sentence R2 makes false.

**Files:**
- Modify: `PRIVACY.md:48-49`
- Modify: `docs/store/chrome-web-store-submission.md`, `docs/store/firefox-amo-submission.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Replace the false bullet in `PRIVACY.md`**

The current text reads *"Nothing is sent while you are not on such a page. There is no account, no identifier, and no request Gestura makes on its own."* Replace that bullet with:

```markdown
- When you open Gestura's settings, the extension asks gestura.eu — at most once
  a day, and separately per index — whether newer versions exist for the entries
  you imported from there. The request contains nothing but those entries' ids
  and version numbers. Entries you imported from a file are never included,
  because Gestura cannot verify where they came from. The answer is stored on
  your device and shown as a badge on the entries it concerns; nothing is
  downloaded or changed until you confirm it in the import dialog. There is no
  account and no identifier, and this is the only request Gestura makes without a
  click of yours.
- Nothing else is sent while you are not on such a page.
```

- [ ] **Step 2: Note the deletion in the closing paragraph**

The paragraph after the bullets ends *"…Either way everything above stops immediately, and entries you imported stay on your device."* Extend it:

```markdown
Either way everything above stops immediately, the stored update notices are
deleted, and entries you imported stay on your device.
```

- [ ] **Step 3: Update the two store submission docs**

Run: `grep -n "disclosure\|Datennutzung\|data usage" docs/store/chrome-web-store-submission.md docs/store/firefox-amo-submission.md`

In each, next to the existing gestura.eu integration disclosure, add one line in that file's own voice and language: the update check sends the ids and versions of entries imported from gestura.eu, at most once a day, only with the integration enabled, and receives version information back. It is **not** personally identifiable information, **not** an account, and **not** web-browsing activity — the disclosure category stays as it is; what changes is the description of when a request leaves the browser.

- [ ] **Step 4: Add the changelog entry**

Under `### Unreleased` in `CHANGELOG.md`, after the R1 entry:

```markdown
- **Update notices for imported entries:** with the gestura.eu integration
  enabled, opening the settings asks gestura.eu — at most once a day, and
  separately per index — whether newer versions exist for the entries you took
  from there. Only their ids and version numbers are sent; entries imported from
  a file are never included. Entries with a newer version get an *Update* badge
  and a button that opens the usual import window, where you decide what happens;
  entries the index has retired say so and are left alone. A failed check
  changes nothing and is simply retried the next time the settings open.
  Because the extension now sends a request you did not click, the consent text
  says so and asks once more — the integration stays off until you confirm it.
```

- [ ] **Step 5: Read it back**

Run: `sed -n '/^## gestura.eu integration/,/^## Permissions/p' PRIVACY.md`
Expected: no sentence claims Gestura makes no request of its own, and the deletion on withdrawal is stated.

- [ ] **Step 6: Commit**

```bash
git add PRIVACY.md CHANGELOG.md docs/store
git commit -m "docs(privacy): the update check is a request we now make ourselves"
```

---

## Task 8: Record the state and hand the contract over

**Files:**
- Modify: `docs/superpowers/plans/2026-09-02-gestura-eu-integration-r2.md` (this file)
- Create: `exchange/2026-09-02-r2-update-endpoint.md`

- [ ] **Step 1: Run the whole suite one more time**

Run: `npm test`
Expected: 27 files green. Record the exact test count in the status section below — not "all green", the number.

- [ ] **Step 2: Append an execution-status section to this plan**

Mirror R1's: what is implemented, what was verified by hand and how, what stayed open, which defects turned up while verifying. State the manual checks from Tasks 5 and 6 individually with their outcome — a check nobody ran is recorded as not run, never as passing.

- [ ] **Step 3: Write the hand-over for the index project**

`exchange/` is untracked working material that crosses the WSL2 ↔ Windows boundary; it is never committed and never referenced from a tracked file. Write `exchange/2026-09-02-r2-update-endpoint.md` in German, addressed to the index team, carrying: the endpoint's request and response verbatim from `docs/gestura-eu-api.md`, the CORS requirement including the `OPTIONS` preflight and the extension-scheme `Origin` a proxy must not drop, the client's validation rules (what invalidates a whole answer versus a single element), the rule that `url` must be same-origin with the answering index, and the fact that `apiLevel` is now 2 while extensions at level 1 never call the endpoint at all. Note that the extension side is finished and testable against a mock, and that nothing ships until the endpoint answers.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-02-gestura-eu-integration-r2.md
git commit -m "docs(plan): record R2's execution state"
```

---

## Self-review

**Spec coverage (§4, §6, §7, §9).**

| Spec requirement | Task |
|---|---|
| `POST /updates` with the `{id, version}` list of qualified entries | 1 (contract), 2 (`updateRequestGroups`) |
| Triggered on options-page open, throttled to once a day, no background alarm | 5 (trigger), 2 (`dueOrigins`) |
| Per-origin cache `{euUpdates: {origins: [{origin, checkedAt, results}]}}` | 1, 2, 3 |
| A success replaces only its own origin's slot | 2 (`mergeSlot`), 3 (test) |
| A network error starts no throttle window | 3 (`askOrigin` returns null, slot untouched; test) |
| Disabling deletes the whole cache | 4 (`#revoke`) |
| Changing/removing the dev origin deletes that slot | 4 (`#commitDevOrigin`), 2 (`pruneOrigins` as a backstop) |
| Grouped per origin; production and dev never mix; file imports in neither | 2, 3 (both tested) |
| Badges render from the cache onto the affected entries | 6 |
| Applying an update runs through the existing import dialog | 6 (`#importUrl`) |
| CORS: open headers plus an `OPTIONS` preflight for a JSON POST | 1 (contract), 5 (the mock answers `OPTIONS`, which is how it gets verified) |
| Deprecation notices | 1, 2, 6 |
| New i18n keys in the `euIntegration*` prefix, en/de + `PENDING_TRANSLATION` | 4, 5, 6 |
| No undeclared `$WORD$` | 4, 5, 6 (`{token}` throughout; `locale-placeholders` guards it) |
| Firefox parity | Task 3 step 5 — no content script, no worker dependency, so only the shared `pages/options.html` line |
| `PRIVACY.md` + store declarations change with R2 | 7 |
| Consent version rises and re-prompts | 4 |

**Deliberately out of scope, with the reason:**
- **The field-level diff** (spec §4, "import dialog with diff") — owner decision 2 above. R3 builds the preview this needs.
- **`transformCode` diff with a fresh confirmation** — the dialog's existing `_scriptAck` already forces a fresh confirmation for a transform script on every import, so an adopted update inherits it. What is missing is only the *diff*, which is the same deferral.
- **A global conflict policy for bundles** ([issue #5](https://github.com/PPP01/Gestura/issues/5): replace all / only what is new / keep all mine). It gains value once badges exist, but it is a change to the import dialog's model, not to the update check, and folding it in here would make every task in this plan wait on it. Flagged for the owner as its own decision.

**Type consistency.** `updateFor()` returns the cached result object (`{id, type, version, url, changelog?, deprecated?, successor?}`) everywhere — Task 2 defines it, Task 6's `renderUpdateBadge(i18n, up)` and both `#updateFor(id)` helpers consume exactly that. `runUpdateCheck` takes `{settings, local, cache, now, fetchImpl}` and returns `{cache, changed}` in Task 3, Task 5's caller and the panel's `#checkNow()`. The cache shape is `{origins: [...]}` in every signature; only `read()` and `write()` touch the `euUpdates` wrapper.

**Checked while writing, so an executor need not re-derive it:** `tooltip()` in `js/tooltip.js` is a Lit directive over a plain string, assigned to the tooltip element's `textContent`, styled with `max-width: 250px` and **no** `white-space` override. That is why Task 6 joins the version sentence and the changelog with `' — '` instead of a newline, and why `renderUpdateBadge` imports `tooltip` rather than building an object.

---

## Open for the owner

1. **Issue #5's global conflict policy** — pull into R2 (it is worth more with badges than alone) or leave standing? Not folded in; it changes the dialog's model.
2. **`gestura-index` must implement the contract from Task 1** before R2 can be released. Task 8 writes the hand-over; the endpoint's arrival is what unblocks the release, not the code.
3. **Two small R1 findings stay open** and are untouched here: the bridge's `getManifest()`/`statusAnswer()` calls outside a try/catch (`js/eu-bridge.js`), and `js/eu-local.js` never retrying a failed first load. Neither blocks R2, and the session that found them is taking both. The third — `_devDraft` being clobbered by any storage change — is fixed in Task 4 step 13, because this plan edits that file anyway and two people editing it in parallel buys nothing but a conflict.
4. **`main` is 39 commits ahead of `gestura/main` and unpushed.** R2 branches off it either way, but the further the two drift the more a merge into `firefox-build` has to absorb at once.
