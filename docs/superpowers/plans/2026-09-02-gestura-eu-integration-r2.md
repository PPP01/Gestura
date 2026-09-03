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
- **i18n: en and de only, and every new key goes into `PENDING_TRANSLATION`** in `tests/site-menu-locales.test.mjs`. This is the mechanism [CLAUDE.md](../../../CLAUDE.md) documents for text still being drafted ("*may live in `en` and `de` alone, but only by being listed in `PENDING_TRANSLATION` — that list is the release checklist*"), and the owner confirmed it for R2. New keys use the `euIntegration*` prefix, which `NEW_KEY_PREFIXES` already covers. Note that **`AGENTS.md` is a stale copy of `CLAUDE.md` that is missing exactly this paragraph** — read from `CLAUDE.md`, and see "Open for the owner" below.
- **R2 is not releasable while any key is still in `PENDING_TRANSLATION`.** "Build now, release when the endpoint answers" is about the server, not about the texts: consent copy is the one thing a user must be able to read in their own language. Task 8 carries the gate explicitly.
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
		{ "id": "eu.example.shop", "version": "1.2.0" },
		{ "id": "eu.example.search", "version": null }
	]
}
```

- **Id and version, and nothing else.** Whether an entry is a menu or a search
  engine is information about the user's setup, and ids are unique across both in
  the index, so the kind is not needed to look one up. The client keeps it locally
  and uses it to check the answer (below).
- `version` is the content version the entry was imported with, or `null` when
  the entry carries none (imported before versions were recorded). `null` means
  "tell me the current version"; the client decides for itself whether that
  differs from what it stores.
- **The endpoint must not redirect.** The client sends `redirect: "error"`,
  because a `307`/`308` preserves method *and* body: a redirect off the index
  would forward these ids and versions to whatever origin it names, and that
  origin can answer the preflight permissively. A `3xx` is therefore a failed
  check, not a hop.

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

- `type` is `"menu"` or `"engine"` and is **checked against the kind the client
  asked about**: an answer that calls a menu an engine is dropped. This is the
  only reason `type` is in the protocol, and it is why it travels in the answer
  rather than in the request.
- `version` must be a numeric triple (`\d{1,5}\.\d{1,5}\.\d{1,5}`, the same
  `SEMVER_RE` the exchange format enforces) and is compared **numerically**
  against what the entry stores. Merely differing is not enough: after a manual
  import of `1.4.0`, an answer still naming `1.3.0` must not be offered as an
  update.
- `url` is where the entry's exchange JSON for that version can be fetched. It
  **must** be on the same origin that answered; the extension drops any result
  whose `url` points elsewhere. When the user then adopts the update, the
  extension checks the **final** URL after redirects against that same origin and
  refuses the import if it moved — so the guarantee holds at download time too,
  not only for the URL the answer announced.
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
missing or disagrees with the kind that id was asked about, `version` is not a
numeric triple, or `url` is unparseable or not on the answering origin. At most
200 elements.

The response is read under the same abort timer as the request — `fetch` resolves
on the response *headers*, so a body that arrives slowly forever would otherwise
hang the check indefinitely. A `Content-Length` above the cap is an early exit;
because a chunked answer declares none, the byte count on the received text is
the actual limit and the timer is what bounds the rest.

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
- Produces: `GesturaEuUpdates` with `KEY`, `PATH`, `THROTTLE_MS`, `LIMITS`, `SEMVER_RE`, `normalizeCache(cache)`, `updateRequestGroups(settings, local)` → `[{origin, entries: [{id, version}], kinds: Map<id, kind>}]`, `dueOrigins(cache, groups, nowMs, force)`, `parseUpdateResponse(text, origin, kinds)`, `mergeSlot(cache, origin, results, checkedAtIso)`, `dropOrigin(cache, origin)`, `pruneOrigins(cache, allowedOrigins)`, `applySlots(cache, slots, allowedOrigins)`, `isNewer(candidate, known)`, `updateFor(cache, stored)` → the cached result plus `newer` and `origin`, or `null`. Task 3 adds `runUpdateCheck`, `read`, `write`, `clear`, `persist` to the same object.

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
		// The body carries id and version only - the kind stays local.
		expect(prod.entries).toEqual([
			{ id: 'eu.example.shop', version: '1.2.0' },
			{ id: 'eu.example.search', version: null },
		]);
		expect([...prod.kinds]).toEqual([['eu.example.shop', 'menu'], ['eu.example.search', 'engine']]);
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
	const asked = new Map([['eu.example.shop', 'menu'], ['eu.example.search', 'engine']]);
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
		['the wrong type for the id that was asked', { ...one, type: 'engine' }],
		['a missing version', { ...one, version: undefined }],
		['a version that is not a numeric triple', { ...one, version: '1.3' }],
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
			{ origin: PROD, checkedAt: '2026-09-01T00:00:00Z', results: [{ id: 'a', type: 'menu', version: '2.0.0', url: PROD + '/a' }] },
			{ origin: DEV, checkedAt: '2026-09-01T00:00:00Z', results: [] },
		],
	};

	it('replaces only its own slot, in place', () => {
		const next = U.mergeSlot(seed, DEV, [{ id: 'b', type: 'menu', version: '3.0.0', url: DEV + '/b' }], '2026-09-02T00:00:00Z');
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

	it('reports a newer version, marked adoptable', () => {
		const up = U.updateFor(cache, stored());
		expect(up.version).toBe('1.3.0');
		expect(up.newer).toBe(true);
	});
	it('a retirement at the version the user already has is not adoptable', () => {
		const s = { source: { indexOrigin: PROD, indexId: 'eu.example.old', version: '1.0.0' } };
		expect(U.updateFor(cache, s).newer).toBe(false);
	});
	it('a retirement with one last version stays adoptable', () => {
		const s = { source: { indexOrigin: PROD, indexId: 'eu.example.old', version: '0.9.0' } };
		const up = U.updateFor(cache, s);
		expect(up.deprecated).toBe(true);
		expect(up.newer).toBe(true);
	});
	it('says nothing once the stored version has caught up', () => {
		expect(U.updateFor(cache, stored({ version: '1.3.0' }))).toBeNull();
	});
	it('never offers a downgrade after a manual import of something newer', () => {
		// The cache still announces 1.3.0; the user has since imported 1.4.0 by
		// hand. "Different" would offer 1.3.0 as an update - a downgrade.
		expect(U.updateFor(cache, stored({ version: '1.4.0' }))).toBeNull();
	});
	it('names the origin the entry came from, for the adopt path to check', () => {
		expect(U.updateFor(cache, stored()).origin).toBe(PROD);
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
	const LIMITS = { responseMaxBytes: 256 * 1024, resultsMax: 200, changelogMax: 1000 };
	// Mirrors SEMVER_RE in js/menu-exchange.js, which is not exported. The exchange
	// format accepts nothing else as a version, so the update check must not
	// either - and a numeric triple is what makes a real comparison possible.
	const SEMVER_RE = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;

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

	// Folds a finished run's slots into whatever the cache looks like NOW, rather
	// than writing back a whole cache captured before the requests went out. The
	// panel can have dropped a developer origin's slot in the meantime, and a
	// second options tab can have written its own answer; both survive this, and a
	// slot whose origin is no longer allowed is refused even if the run produced
	// one.
	function applySlots(cache, slots, allowed) {
		const keep = new Set(allowed || []);
		let out = pruneOrigins(cache, allowed);
		for (const slot of slots || []) {
			if (!slot || !keep.has(slot.origin)) continue;
			out = mergeSlot(out, slot.origin, slot.results, slot.checkedAt);
		}
		return out;
	}

	// "Different" is not good enough: after a manual import of 1.4.0 a cache entry
	// still announcing 1.3.0 would otherwise offer the user a downgrade as an
	// update. Nothing comparable stored (an entry imported before versions were
	// recorded) counts as older, because the index's version is then the only one
	// anybody knows.
	function isNewer(candidate, known) {
		if (!SEMVER_RE.test(candidate || '')) return false;
		if (!SEMVER_RE.test(known || '')) return true;
		const a = candidate.split('.').map(Number);
		const b = known.split('.').map(Number);
		for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
		return false;
	}

	// --- what to ask -------------------------------------------------------------

	// `entries` is exactly the request body: id and version, nothing else. The kind
	// stays behind in `kinds`, where it is used to check the answer rather than
	// disclosed - a menu/engine split is information about the user's entries, and
	// the index does not need it to look an id up.
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
				kind: e.kind,
				version: typeof s.version === 'string' ? s.version : null,
			});
		}
		return [...byOrigin].map(([origin, entries]) => {
			const list = [...entries.values()];
			return {
				origin,
				entries: list.map(e => ({ id: e.id, version: e.version })),
				// A Map, not an object: an id like "constructor" is pattern-valid and
				// must not reach an object's prototype chain (same reason as
				// statusAnswer's byId map in eu-integration.js).
				kinds: new Map(list.map(e => [e.id, e.kind])),
			};
		});
	}

	// force skips the window and nothing else - it does not clear, reset or
	// otherwise touch what is cached. "Check now" is a scheduling override, not a
	// reason to lose the answers already on record.
	function dueOrigins(cache, groups, nowMs, force) {
		if (force) return (groups || []).slice();
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

	function normalizeResult(raw, origin, kinds, seen) {
		if (!raw || typeof raw !== 'object') return null;
		if (typeof raw.id !== 'string' || seen.has(raw.id)) return null;
		// Asked about, and answered as the kind it actually is. Without the second
		// half the index could answer a menu question with an engine and the badge
		// would point at the wrong thing; `type` travels in the answer for exactly
		// this check, which is the only reason it is in the protocol at all.
		if (kinds.get(raw.id) !== raw.type) return null;
		if (typeof raw.version !== 'string' || !SEMVER_RE.test(raw.version)) return null;
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

	function parseUpdateResponse(text, origin, kinds) {
		if (typeof text !== 'string' || !text) return null;
		if (new TextEncoder().encode(text).length > LIMITS.responseMaxBytes) return null;
		let json;
		try { json = JSON.parse(text); } catch { return null; }
		if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
		if (!Array.isArray(json.updates) || json.updates.length > LIMITS.resultsMax) return null;
		const asked = kinds instanceof Map ? kinds : new Map();
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
		// `newer` is not the opposite of `deprecated`: an index may retire an entry
		// and still publish one last fix for it, and it may also announce a
		// retirement at the version the user already has. The badge reads
		// `deprecated`, the adopt button reads `newer`, and both can be true.
		const newer = isNewer(hit.version, known);
		if (!newer && !hit.deprecated) return null;
		// origin travels with the result so the adopt button can name the origin it
		// expects; the results themselves are stored per slot and carry none.
		return { ...hit, newer, origin: slot.origin };
	}

	const api = {
		KEY, PATH, THROTTLE_MS, REQUEST_TIMEOUT_MS, LIMITS, SEMVER_RE,
		normalizeCache, mergeSlot, dropOrigin, pruneOrigins, applySlots, isNewer,
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
- Produces: `GesturaEuUpdates.runUpdateCheck({ settings, local, cache, now, fetchImpl, force?, stillAllowed? })` → `Promise<{ slots: [{origin, checkedAt, results}] }>`. It writes nothing: `force` skips the due-check only, and `stillAllowed(origin)` is an optional `async (origin) => boolean` re-asked after every answer, whose `false` drops that answer. Persisting is `persist(slots)` → `Promise<boolean>`, which re-reads the live state and the cache, folds the slots in through `applySlots`, writes only on a real change and then fires `CHANGED_EVENT`. Also `read()` → `Promise<cache>`; `write(cache)` → `Promise<void>`; `clear()` → `Promise<void>`; `CHANGED_EVENT = 'eu-updates-changed'`.

- [ ] **Step 1: Write the failing test**

Append to `tests/eu-updates.test.mjs`:

```js
describe('runUpdateCheck', () => {
	const now = Date.parse('2026-09-02T12:00:00Z');
	const iso = new Date(now).toISOString();
	const ok = (body) => {
		const text = JSON.stringify(body);
		return { ok: true, headers: new Headers({ 'content-length': String(text.length) }), text: async () => text };
	};
	const upd = (id) => ({ id, type: 'menu', version: '9.9.9', url: PROD + '/api/v1/menus/' + id + '/9.9.9' });

	// Records what was asked, so the per-origin grouping can be asserted from the
	// outside as well as from updateRequestGroups().
	const spy = (handler) => {
		const calls = [];
		const fetchImpl = async (url, init) => {
			calls.push({ url, body: JSON.parse(init.body), method: init.method, redirect: init.redirect });
			return handler(url, init);
		};
		return { calls, fetchImpl };
	};
	const run = (over = {}) => U.runUpdateCheck({
		settings: settings(), local: local(), cache: { origins: [] }, now,
		fetchImpl: over.fetchImpl, ...over,
	});

	it('asks each origin its own endpoint, with only its own entries', async () => {
		const { calls, fetchImpl } = spy(() => ok({ apiLevel: 2, updates: [] }));
		await run({ local: local({ devOrigin: DEV }), fetchImpl });
		expect(calls.map(c => c.url).sort()).toEqual([DEV + U.PATH, PROD + U.PATH]);
		const prod = calls.find(c => c.url.startsWith(PROD));
		expect(prod.method).toBe('POST');
		expect(prod.body.apiLevel).toBe(EU.API_LEVEL);
		expect(prod.body.entries.map(e => e.id)).toEqual(['eu.example.shop', 'eu.example.search']);
		// No entry kind on the wire, and no redirect may be followed: a 307/308
		// preserves the body, so following one would forward these ids elsewhere.
		expect(prod.body.entries.every(e => !('type' in e))).toBe(true);
		expect(prod.redirect).toBe('error');
		const dev = calls.find(c => c.url.startsWith(DEV));
		expect(dev.body.entries.map(e => e.id)).toEqual(['eu.example.dev']);
	});

	it('sends nothing while the integration is not effectively enabled', async () => {
		const { calls, fetchImpl } = spy(() => ok({ apiLevel: 2, updates: [] }));
		const off = local({ consent: { version: EU.CURRENT_INTEGRATION_CONSENT - 1, date: 'x' } });
		expect(await run({ local: off, fetchImpl })).toEqual({ slots: [] });
		expect(calls).toEqual([]);
	});

	it('reports one slot per origin that answered, and none for the others', async () => {
		const seed = { origins: [{ origin: DEV, checkedAt: '2026-09-02T11:00:00Z', results: [] }] };
		const { fetchImpl } = spy((url) => (url.startsWith(PROD)
			? ok({ apiLevel: 2, updates: [upd('eu.example.shop')] })
			: ok({ apiLevel: 2, updates: [] })));
		const { slots } = await run({ local: local({ devOrigin: DEV }), cache: seed, fetchImpl });
		// DEV was inside its window, so it was never asked and produces no slot.
		expect(slots.map(s => s.origin)).toEqual([PROD]);
		expect(slots[0]).toEqual({ origin: PROD, checkedAt: iso, results: [upd('eu.example.shop')] });
	});

	it('a network error produces no slot, so no checkedAt is ever written', async () => {
		const { fetchImpl } = spy(() => { throw new Error('offline'); });
		expect(await run({ fetchImpl })).toEqual({ slots: [] });
	});

	it('a non-200 and an invalid body produce no slot either', async () => {
		for (const res of [
			{ ok: false, headers: new Headers(), text: async () => '{}' },
			{ ok: true, headers: new Headers(), text: async () => 'not json' },
		]) {
			const { fetchImpl } = spy(() => res);
			expect(await run({ fetchImpl })).toEqual({ slots: [] });
		}
	});

	it('respects the window and skips the request entirely', async () => {
		const seed = { origins: [{ origin: PROD, checkedAt: '2026-09-02T06:00:00Z', results: [] }] };
		const { calls, fetchImpl } = spy(() => ok({ apiLevel: 2, updates: [] }));
		const { slots } = await run({ cache: seed, fetchImpl });
		expect(calls).toEqual([]);
		expect(slots).toEqual([]);
	});

	it('force asks anyway, and touches nothing that is cached', async () => {
		const kept = [upd('eu.example.shop')];
		const seed = { origins: [{ origin: PROD, checkedAt: '2026-09-02T06:00:00Z', results: kept }] };
		const { calls, fetchImpl } = spy(() => { throw new Error('offline'); });
		const { slots } = await run({ cache: seed, fetchImpl, force: true });
		expect(calls).toHaveLength(1);
		// The failed forced check reports nothing, so applySlots leaves the old
		// slot - checkedAt and results - exactly where it was.
		expect(slots).toEqual([]);
		expect(U.applySlots(seed, slots, [PROD])).toEqual(seed);
	});

	it('discards an answer whose origin stopped being allowed mid-run', async () => {
		const { fetchImpl } = spy(() => ok({ apiLevel: 2, updates: [upd('eu.example.shop')] }));
		const { slots } = await run({ fetchImpl, stillAllowed: async () => false });
		expect(slots).toEqual([]);
	});

	it('keeps the origins that are still allowed and drops only the others', async () => {
		const { fetchImpl } = spy(() => ok({ apiLevel: 2, updates: [upd('eu.example.shop')] }));
		const { slots } = await run({
			local: local({ devOrigin: DEV }), fetchImpl,
			stillAllowed: async (origin) => origin === PROD,
		});
		expect(slots.map(s => s.origin)).toEqual([PROD]);
	});
});

describe('applySlots', () => {
	const iso = '2026-09-02T12:00:00Z';
	const res = (id) => ({ id, type: 'menu', version: '9.9.9', url: PROD + '/' + id });

	it('merges a slot into whatever the cache looks like now', () => {
		const fresh = { origins: [{ origin: DEV, checkedAt: iso, results: [] }] };
		const out = U.applySlots(fresh, [{ origin: PROD, checkedAt: iso, results: [res('a')] }], [PROD, DEV]);
		expect(out.origins.map(s => s.origin)).toEqual([DEV, PROD]);
	});

	it('refuses a slot whose origin is no longer allowed', () => {
		const out = U.applySlots({ origins: [] }, [{ origin: DEV, checkedAt: iso, results: [res('a')] }], [PROD]);
		expect(out.origins).toEqual([]);
	});

	it('drops a cached slot whose origin is no longer allowed', () => {
		const fresh = { origins: [{ origin: DEV, checkedAt: iso, results: [res('a')] }] };
		expect(U.applySlots(fresh, [], [PROD]).origins).toEqual([]);
	});

	it('leaves a slot another writer added in the meantime alone', () => {
		const fresh = { origins: [{ origin: DEV, checkedAt: '2026-09-02T13:00:00Z', results: [res('b')] }] };
		const out = U.applySlots(fresh, [{ origin: PROD, checkedAt: iso, results: [] }], [PROD, DEV]);
		expect(out.origins.find(s => s.origin === DEV)).toEqual(fresh.origins[0]);
	});
});

describe('isNewer', () => {
	it.each([
		['1.3.0', '1.2.0', true],
		['1.2.0', '1.3.0', false],
		['1.2.0', '1.2.0', false],
		['1.10.0', '1.9.0', true],
		['2.0.0', '1.99.99', true],
		['1.3.0', null, true],
		['not.a.version', '1.0.0', false],
	])('%s over %s is %s', (a, b, expected) => {
		expect(U.isNewer(a, b)).toBe(expected);
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
		try {
			const res = await fetchImpl(group.origin + PATH, {
				method: 'POST',
				credentials: 'omit',
				cache: 'no-store',
				// Not 'follow'. A 307/308 preserves method AND body, so a redirect off
				// the index would hand this request's ids and versions to whatever
				// origin it names - and an attacker's endpoint can answer the preflight
				// with Access-Control-Allow-Origin: * just as happily. A JSON API has
				// no business redirecting, so any redirect is an error here. The
				// same-origin promise has to hold at request time, not only for the
				// url an answer announces.
				redirect: 'error',
				signal: ctl.signal,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ apiLevel: EU.API_LEVEL, entries: group.entries }),
			});
			if (!res.ok) return null;
			// Advisory only - a chunked answer declares no length - so this is an
			// early exit, not the limit. The limit is the byte count inside
			// parseUpdateResponse, and the abort timer is what bounds a body that
			// keeps arriving slowly.
			const declared = Number(res.headers?.get?.('content-length'));
			if (Number.isFinite(declared) && declared > LIMITS.responseMaxBytes) return null;
			return parseUpdateResponse(await res.text(), group.origin, group.kinds);
		} catch {
			return null;
		} finally {
			// Cleared here and nowhere earlier: fetch() resolves on the response
			// HEADERS, so clearing the timer around the fetch alone would leave
			// res.text() unbounded and a slow body could hang the check for good.
			clearTimeout(timer);
		}
	}

	// Sequential on purpose: two requests, at most once a day, on a page the user
	// just opened. Nothing here is worth the concurrency.
	//
	// Returns the slots it actually obtained - not a whole cache. `local` is a
	// snapshot taken before the first request, and a request may hang for the full
	// 8 seconds: long enough for the user to hit "Withdraw" in the panel right
	// beside this, or to change the developer origin. Writing back a cache captured
	// before all that would revive a slot the panel just dropped and clobber
	// anything a second options tab wrote meanwhile. So the run reports deltas and
	// persist() folds them into whatever the cache looks like afterwards.
	//
	// stillAllowed(origin) is re-asked after every answer and must re-read the
	// live state, not close over the snapshot - the same reason the hand-off fetch
	// in js/background.js re-checks euHandOffAllowed() after its own fetch.
	async function runUpdateCheck(opts) {
		const { settings, local, cache, now, fetchImpl, force, stillAllowed } = opts;
		const slots = [];
		if (!EU.effectiveEnabled(local)) return { slots };
		const groups = updateRequestGroups(settings, local);
		for (const group of dueOrigins(normalizeCache(cache), groups, now, force)) {
			const answer = await askOrigin(group, fetchImpl);
			if (stillAllowed && !(await stillAllowed(group.origin))) continue;
			if (!answer) continue;
			slots.push({ origin: group.origin, checkedAt: new Date(now).toISOString(), results: answer.results });
		}
		return { slots };
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

	// The write half of a run, deliberately separate from it: the live state is
	// read again here, after every request has finished, so a revoke or a changed
	// developer origin during the run wins over the run's own findings. Writes
	// nothing when nothing would change - and dispatches the event only when it
	// wrote, so the managers do not re-render for a no-op.
	async function persist(slots) {
		// GesturaEuLocal is loaded before this file (pages/options.html), and read()
		// hands back its live cache, which storage.onChanged keeps current - so this
		// sees a revoke that landed mid-run.
		const local = await root.GesturaEuLocal.read();
		if (!EU.effectiveEnabled(local)) return false;
		const fresh = await read();
		const next = applySlots(fresh, slots, EU.allowedOrigins(local));
		// EU.canonicalize is R1's stable stringifier; plain JSON.stringify would
		// report a change whenever a key order happened to differ.
		if (EU.canonicalize(next) === EU.canonicalize(fresh)) return false;
		await write(next);
		if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED_EVENT));
		return true;
	}
```

Then extend the exported object:

```js
	const api = {
		KEY, PATH, THROTTLE_MS, REQUEST_TIMEOUT_MS, LIMITS, SEMVER_RE, CHANGED_EVENT,
		normalizeCache, mergeSlot, dropOrigin, pruneOrigins, applySlots, isNewer,
		updateRequestGroups, dueOrigins, parseUpdateResponse, updateFor,
		runUpdateCheck, read, write, clear, persist,
	};
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/eu-updates.test.mjs`
Expected: PASS. `read`/`write`/`clear` are untested here on purpose — they are three `chrome.storage.local` calls with a catch, and a mock of `chrome` would test the mock. `persist()` is deliberately thin for the same reason: everything it decides lives in `applySlots`, which *is* tested above; what remains is a read, a comparison and a write.

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
	"euIntegrationConsentPoint5": { "message": "When you open these settings, Gestura asks gestura.eu — at most once a day — whether newer versions exist for the entries you took from there. Of those entries it sends nothing but their identifiers and version numbers, plus which version of the interface Gestura speaks: no account, no identifier of you, and nothing about the rest of your settings. Entries you imported from a file are never included. The check itself only reports what exists; an entry’s file is fetched when you ask for its update, and nothing is adopted or changed until you confirm it in the import window." },
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
	"euIntegrationConsentPoint5": { "message": "Wenn du diese Einstellungen öffnest, fragt Gestura höchstens einmal täglich bei gestura.eu nach, ob es für die von dort übernommenen Einträge neuere Versionen gibt. Von diesen Einträgen werden nur Kennungen und Versionsnummern übertragen, dazu die Version der Schnittstelle, die Gestura spricht: kein Konto, keine Kennung von dir und nichts über den Rest deiner Einstellungen. Aus einer Datei importierte Einträge sind nie dabei. Die Prüfung selbst meldet nur, was es gibt; die Datei eines Eintrags wird geladen, wenn du sein Update anforderst, und übernommen oder geändert wird nichts, bevor du im Import-Fenster bestätigst." },
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

All 39 files are tab-indented and LF-only today (checked), but the script must
not be able to fail *quietly*: a no-op match would leave a wrong promise in a
language file with nothing to say so. It therefore matches whitespace loosely,
tolerates CRLF, and refuses to finish unless it stripped exactly 37 files.

```bash
node -e '
const fs = require("fs");
const dir = "_locales";
let stripped = 0;
for (const lang of fs.readdirSync(dir)) {
	if (lang === "en" || lang === "de") continue;
	const p = dir + "/" + lang + "/messages.json";
	const before = fs.readFileSync(p, "utf8");
	// One key, one line: a JSON round-trip would reformat the whole file.
	const after = before.replace(/^[ \t]*"euIntegrationConsentPoint1":.*\r?\n/m, "");
	if (after === before) { console.error("NOT FOUND in " + lang); process.exit(1); }
	fs.writeFileSync(p, after);
	stripped++;
}
if (stripped !== 37) { console.error("expected 37, stripped " + stripped); process.exit(1); }
console.log("stripped " + stripped);'
```

If it exits non-zero it may already have rewritten some files — `git checkout -- _locales`
and find out why before running it again.

Run it, then confirm it reported 37 and that en/de still have the key:

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
		const EU = window.FlowMouseEuIntegration;
		try {
			const { slots } = await U.runUpdateCheck({
				settings: this._store.current,
				local: await window.GesturaEuLocal.read(),
				cache: await U.read(),
				now: Date.now(),
				fetchImpl: (url, init) => fetch(url, init),
				// Re-reads the live state per answer, so both a revoke and a changed
				// developer origin during the run drop that answer on the floor.
				stillAllowed: async (origin) => {
					const cur = await window.GesturaEuLocal.read();
					return EU.effectiveEnabled(cur) && EU.allowedOrigins(cur).includes(origin);
				},
			});
			// persist() re-reads state and cache once more, merges only these slots,
			// writes only if something actually changed, and fires the event.
			await U.persist(slots);
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

initialize them in the constructor (`this._checked = ''; this._checking = false;`), and give the panel the same event lifecycle the managers get in Task 6 — the automatic check runs *after* the panel is on screen, so a one-off read in `connectedCallback()` would leave "Not asked yet" standing until a reload. In `connectedCallback()`:

```js
		this._boundChecked = () => {
			window.GesturaEuUpdates.read().then(cache => { this._checked = this.#latestCheck(cache); });
		};
		this._boundChecked();
		window.addEventListener(window.GesturaEuUpdates.CHANGED_EVENT, this._boundChecked);
```

and in `disconnectedCallback()`, beside the existing `keydown` removal:

```js
		window.removeEventListener(window.GesturaEuUpdates.CHANGED_EVENT, this._boundChecked);
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

	// Ignores the 24-hour window via `force`, and NOTHING else: it does not clear
	// the cache first. Clearing would mean a failed manual check - the exact case
	// worth testing against a local index - destroys the answers already on record
	// and leaves the user worse off than before pressing the button. force acts on
	// the due-check alone; a failing origin still keeps its old slot untouched.
	async #checkNow() {
		const U = window.GesturaEuUpdates;
		const EU = window.FlowMouseEuIntegration;
		this._checking = true;
		try {
			const { slots } = await U.runUpdateCheck({
				settings: settingsStore.current,
				local: await window.GesturaEuLocal.read(),
				cache: await U.read(),
				now: Date.now(),
				fetchImpl: (url, init) => fetch(url, init),
				force: true,
				stillAllowed: async (origin) => {
					const cur = await window.GesturaEuLocal.read();
					return EU.effectiveEnabled(cur) && EU.allowedOrigins(cur).includes(origin);
				},
			});
			// No manual _checked assignment: persist() fires CHANGED_EVENT and the
			// listener below refreshes the line, the same way the managers refresh.
			await U.persist(slots);
		} catch {
			// Nothing to report: the line simply keeps its old date.
		} finally {
			// finally, not a trailing assignment: an early return or a throw would
			// otherwise leave the button disabled for the rest of the session.
			this._checking = false;
		}
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
6. **The revoke race:** with the mock artificially slow (`setTimeout(() => { … }, 6000)` around its response), open the settings and click *Withdraw* while the request is in flight. Expected: `euUpdates` is gone from `chrome.storage.local` and **stays** gone when the answer arrives. Without `stillAllowed` and `persist`'s re-read this is exactly where the deleted key comes back.
7. **The dev-origin race:** same slow mock, but instead of withdrawing, change the developer origin to another port while the request is in flight. Expected: no slot for the old origin survives, and none appears for it when the answer lands.
8. **A failed manual check keeps what it had:** with a cached answer on record, stop the mock and press *Check now*. Expected: `euUpdates` still holds the old slot with its old `checkedAt`. This is the case that the earlier draft's `clear()`-first approach destroyed.

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
	// Ein Absatz, kein Zeilenumbruch: der Tooltip setzt textContent und trägt kein
	// white-space: pre-line - ein "\n" verschwände lautlos mitten im Satz.
	const parts = [];
	// Abkündigung und neue Version schließen sich nicht aus: ein Index kann einen
	// Eintrag einstellen und dafür eine letzte Fassung nachliefern. Dann steht die
	// Abkündigung auf dem Abzeichen - sie ist die größere Nachricht - und die
	// Version steht trotzdem im Tooltip, wo sie zum Übernehmen-Knopf daneben passt.
	if (up.deprecated) {
		parts.push(up.successor
			? i18n.getMessage('euIntegrationRetiredSuccessor').replace('{id}', up.successor)
			: i18n.getMessage('euIntegrationRetiredTooltip'));
	}
	if (up.newer) parts.push(i18n.getMessage('euIntegrationUpdateTooltip').replace('{version}', up.version));
	if (up.changelog) parts.push(up.changelog);
	const cls = up.deprecated ? 'retired-badge' : 'update-badge';
	const label = up.deprecated ? 'euIntegrationRetiredBadge' : 'euIntegrationUpdateBadge';
	return html`<span class="${cls}" .tooltip=${tooltip(parts.join(' — '))}>${i18n.getMessage(label)}</span>`;
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
		// Both reads in one chain: #updateFor() consults GesturaEuLocal.current(),
		// which is synchronous and returns defaults until its own first load
		// resolves. Setting _updates only after that load has finished is what keeps
		// the very first render from suppressing every badge.
		this._boundUpdates = () => {
			Promise.all([window.GesturaEuLocal.read(), window.GesturaEuUpdates.read()])
				.then(([, cache]) => { this._updates = cache; });
		};
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
		// No badge while the integration authorizes nothing. Revoking and switching
		// off both clear the cache, but a consent that went STALE does not: it
		// leaves enabled:true beside an outdated consent.version, which is exactly
		// where every user lands the moment R3 raises the number again. Without this
		// guard their badges would keep offering downloads from an integration that
		// is off.
		if (!window.FlowMouseEuIntegration.effectiveEnabled(window.GesturaEuLocal.current())) return null;
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
					${up && up.newer ? html`
						<button class="menu-btn" .tooltip=${tooltip(i18n.getMessage('euIntegrationUpdateApply'))}
							@click=${(e) => { e.stopPropagation(); this.#importUrl(up.url, up.origin); }}>
							${unsafeHTML(icon('download', { size: 14, strokeWidth: 2 }))}
						</button>
					` : ''}
```

`#importUrl` already fetches, derives `indexOrigin` from the final `Response.url`, and opens the import dialog — so adopting an update is the same reviewed path as a manual URL import, including the "you changed this entry" warning that leaves an edited row unticked. Nothing about that is bypassed here, deliberately.

**But it needs one more argument.** For a *manual* URL import, following a redirect and then judging by the final URL is the R1 rule and stays. Adopting an update is a different question: the user is taking a named entry from a named index, so a redirect that leaves that origin is not a provenance nuance but a different party's file. Add an optional expected origin — the same edit in both managers:

```js
	async #importUrl(url, expectOrigin) {
		if (!url) return;
		try {
			const res = await fetch(url);
			const obj = await res.json();
			// Provenance from the final URL after redirects, never from what was typed.
			const indexOrigin = window.FlowMouseEuIntegration.qualifiedOrigin(res.url, await window.GesturaEuLocal.read());
			// Adopting an update names the origin it expects. A redirect that leaves
			// it is refused outright rather than imported as an unqualified entry:
			// the user asked for gestura.eu's version of this entry, not for whatever
			// a redirect chain ended up pointing at. Handled like a failed fetch,
			// because that is what it is from the user's side.
			if (expectOrigin && indexOrigin !== expectOrigin) {
				this.#dialog().openWith({}, { type: 'url', url });
				return;
			}
			this.#dialog().openWith(obj, { type: 'url', url, ...(indexOrigin ? { indexOrigin } : {}) });
		} catch { this.#dialog().openWith({}, { type: 'url', url }); }
	}
```

- [ ] **Step 4: Wire the engine manager the same way**

`js/components/engine-manager.js`, identical except for the kind and the row markup. The import, `_updates`, the constructor line, the two listener lines and:

```js
	#updateFor(id) {
		// Same guard, same reason as the menu manager's: a stale consent leaves the
		// cache in place while effectiveEnabled() is already false.
		if (!window.FlowMouseEuIntegration.effectiveEnabled(window.GesturaEuLocal.current())) return null;
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
					${up && up.newer ? html`
						<button class="engine-btn" .tooltip=${tooltip(i18n.getMessage('euIntegrationUpdateApply'))}
							@click=${(e) => { e.stopPropagation(); this.#importUrl(up.url, up.origin); }}>
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
5. Actually adopting the update makes the badge disappear immediately, without a new check — `updateFor` compares against the stored version. **This only works when the served payload's own `version` matches the version the mock announced.** The dialog stamps `source.version` from `row.result.value.version` ([menu-import-dialog.js:457](../../../js/components/menu-import-dialog.js)), falling back to `'1.0.0'`; a `bundle.json` without a version therefore stores `1.0.0` while the cache says `9.9.9`, and the badge correctly stays. If the badge survives an adoption, check the payload's version before suspecting the cache.
6. Set the mock's `deprecated: true` **without** changing its version: the badge becomes **Retired** and the adopt button is gone.
7. Set `deprecated: true` **and** a version newer than the stored one: the badge stays **Retired**, its tooltip names both the retirement and the final version, and the adopt button is back. An index that retires an entry and ships one last fix must not leave the user unable to take it.
8. Switch the integration off and reopen the settings: no badges anywhere. Then simulate a stale consent — in the service worker console, `chrome.storage.local.get('euIntegration', s => { s.euIntegration.consent.version = 1; chrome.storage.local.set(s); })` — reload the settings: still no badges, and the panel shows its re-confirmation row.

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
  you imported from there. Of those entries the request contains nothing but
  their ids and version numbers, plus which version of the interface Gestura
  speaks. Entries you imported from a file are never included,
  because Gestura cannot verify where they came from. The answer is stored on
  your device and shown as a badge on the entries it concerns. The check itself
  only reports what exists — it downloads no menus and changes nothing. When you
  then ask for an update, that entry's file is fetched so the import dialog can
  show you what it contains, and nothing is adopted or changed until you confirm
  it there. There is no account and no identifier, and the check is the only
  request Gestura makes without a click of yours.
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

- [ ] **Step 4: Write the release gate into the status section**

R2's code can sit on `main` unreleased, but it must not go out half-translated —
the consent overlay is the one text a user has to be able to read in their own
language, and R2 rewrites it. Record, verbatim, in the status section:

```markdown
### Cleanup pass, 2026-09-02 (after the tasks)

Four review angles (reuse, simplification, efficiency, altitude) were run over
the branch diff. What they changed, all in one commit on top of the eight task
commits — no behaviour was meant to change, and the 50 checks above were re-run
to confirm none did:

- **The run harness moved into `js/eu-updates.js` as `checkAndPersist()`.** Both
  callers had assembled the same fifteen lines, including `stillAllowed` — the
  predicate that makes a mid-run revoke win. It was a caller obligation that
  `runUpdateCheck` treats as optional, so a future third caller could have
  omitted it and silently lost the guarantee. `runUpdateCheck` stays exported and
  injectable for the tests.
- **`CHANGED_EVENT` is dispatched from a `chrome.storage.onChanged` listener**,
  the way `js/eu-local.js` already does it for its own key, instead of by
  `persist()` and by two hand-written lines in the panel. Every write now
  announces itself — **including a write from a second options tab**, which the
  window event could never reach, and which `runUpdateCheck`'s own comment
  reasons about.
- **`dropOrigin()` is gone.** `eu-updates.js` subscribes to
  `GesturaEuLocal.onChange` and prunes to `allowedOrigins()`, so a changed
  developer origin is reconciled wherever it was changed rather than only at the
  panel keystroke that caused it. The panel lost its `previous`-value
  bookkeeping.
- **The per-row `findStored()` lookup is gone**, replaced by passing the row's
  own stored object. The comments justifying it in both managers were **factually
  wrong**: `#getResolvedEngines()` does carry `source` (`engine-manager.js`,
  both branches) and `getBaseMenu()` spreads the whole stored def. Worse, the two
  lookups disagreed — `getBaseMenu()` prefers `edited` over `custom`,
  `findStored()` prefers `custom` over `edited` — so for an id present in both
  places the row rendered one record while the badge and the adopt button's
  origin came from the other.
- **`UpdateWatch` in `js/components/import-feedback.js`** replaces ~25 lines
  duplicated in each manager (the `_updates` field, the `_boundUpdates` closure,
  the listener pair, the private `#updateFor`), joining `ImportHighlight` and
  `renderUpdateBadge`, which are shared from there for the same reason. It also
  drops the reactive `_updates` property, whose fresh-object identity forced a
  second full render of both lists on every page open.
- Smaller: the adopt-path origin mismatch `throw`s into the existing catch
  instead of restating it; `.import-badge` and the two new badges share one pill
  block in `css/common.css`; `runUpdateCheck` no longer normalizes a cache
  `dueOrigins` normalizes again; `KEY`, `THROTTLE_MS`, `REQUEST_TIMEOUT_MS` and
  `SEMVER_RE` left the exported surface (no callers anywhere).

Consciously **not** done: moving `#importUrl` out of both managers (its real home
is `menu-import-dialog.js`, well outside this diff — it was already duplicated
before R2), and sharing `SEMVER_RE` with `js/menu-exchange.js` (which needs a
script-tag reorder in `options.html` for a cosmetic gain, and mirrors the split
`ID_RE` already has). Both are noted for whoever touches those files next.

### Not releasable until

1. `PENDING_TRANSLATION` in `tests/site-menu-locales.test.mjs` holds none of
   R2's keys any more: `euIntegrationConsentPoint1`,
   `euIntegrationConsentPoint5Label`, `euIntegrationConsentPoint5`,
   `euIntegrationUpdateCheck`, `euIntegrationCheckNow`,
   `euIntegrationLastChecked`, `euIntegrationNeverChecked`,
   `euIntegrationUpdateBadge`, `euIntegrationUpdateTooltip`,
   `euIntegrationUpdateApply`, `euIntegrationRetiredBadge`,
   `euIntegrationRetiredTooltip`, `euIntegrationRetiredSuccessor` — all of them
   translated into all 39 locales and deleted from the list. The list's own test
   fails once a key is everywhere but still listed, so this cannot be forgotten
   quietly; what it does not do is stop a release, which is why it is written
   here as well.
2. `https://gestura.eu/api/v1/updates` answers the contract in
   `docs/gestura-eu-api.md`, `OPTIONS` preflight included.
3. `PRIVACY.md` and both store data declarations carry the update check
   (Task 7).
```

- [ ] **Step 5: Commit**

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

**Type consistency.** `updateFor()` returns the cached result object plus one derived flag (`{id, type, version, url, changelog?, deprecated?, successor?, newer}`) everywhere — Task 2 defines it, Task 6's `renderUpdateBadge(i18n, up)` reads `deprecated`/`newer`/`changelog`, and both adopt buttons gate on `newer` alone. `runUpdateCheck` takes `{settings, local, cache, now, fetchImpl, force?, stillAllowed?}` and returns `{slots}` in Task 3, Task 5's caller and the panel's `#checkNow()`; `persist(slots)` is the only thing that writes, and it re-reads before merging. The cache shape is `{origins: [...]}` in every signature; only `read()`, `write()` and `persist()` touch the `euUpdates` wrapper. Note that `newer` is stored nowhere — it is computed per render against the entry's current `source.version`, which is what makes a badge vanish on import.

**Checked while writing, so an executor need not re-derive it:** `tooltip()` in `js/tooltip.js` is a Lit directive over a plain string, assigned to the tooltip element's `textContent`, styled with `max-width: 250px` and **no** `white-space` override. That is why Task 6 joins the version sentence and the changelog with `' — '` instead of a newline, and why `renderUpdateBadge` imports `tooltip` rather than building an object.

---

## External review, 2026-09-02

An external review (Gemini) raised three blockers and two risks against the first
draft. Each was checked against the code before anything was changed; three
findings held, one held for a different reason than the one given, and one did
not hold.

**1. Revive-after-revoke race — confirmed, fixed.** `runUpdateCheck` took
`local` as a snapshot and never looked again, and the caller wrote whenever
`changed` was true. A *Withdraw* during an in-flight request (up to 8 s) cleared
the key, and the arriving answer wrote it straight back. Fixed with a
`stillAllowed` predicate re-asked after every answer (Task 3), a second check
between the last answer and the write (Task 5), and both a unit test and a manual
check with a deliberately slow mock. This is the same shape
[js/background.js](../../../js/background.js) already uses after its hand-off
fetch, so the plan now follows an established idiom rather than inventing one.

**2. Badges outliving the switch — right conclusion, wrong mechanism.** The
review had `#onToggle` writing only `{enabled: false}`. It does not: switching
off calls `#revoke()`, which clears consent and (Task 4 step 11) the cache, so
that path was already covered. The real hole is a **stale consent** —
`enabled: true` beside an outdated `consent.version` makes `effectiveEnabled()`
false while the cache survives untouched, which is precisely the state every user
enters when R3 raises the number again. Guard added to both managers' `#updateFor`
(Task 6), plus a manual check that forces the state.

**3. Retired entry with one last version — confirmed, fixed.** The contract
permits `deprecated: true` alongside a newer version (a final security fix), and
the draft's UI made it unadoptable: `renderUpdateBadge` returned early on
`deprecated` and the button was gated on `!up.deprecated`. `updateFor` now
returns a `newer` flag independent of `deprecated`; the badge reads `deprecated`,
the button reads `newer`, the tooltip says both.

**4. Fragile locale strip — premise does not hold, hardened anyway.** All 39
`messages.json` are tab-indented and LF-only (verified), so `^\t…\n` matched
correctly. The valuable half of the objection is that the script could fail
*silently*, so it now matches whitespace loosely, tolerates CRLF, and exits
non-zero unless it stripped exactly 37 files.

**5. `source.version` lost on an update import — does not hold.** The claim was
that `#importUrl` passes no version, so the badge would never disappear.
[js/components/menu-import-dialog.js:457](../../../js/components/menu-import-dialog.js)
builds the stored provenance as
`{ ...this._source, version: row.result.value.version || '1.0.0' }` — the version
comes from the imported payload, which is the only place it can honestly come
from; the manager deliberately does not supply one. No change made. The review did
point at a real edge on the way there: a payload carrying **no** version stores
`'1.0.0'`, which will not match a cache entry announcing something else, and the
badge then persists — correctly, since the entry really is not at that version.
Recorded in Task 6's manual check so a tester does not misread it as a cache bug.

## Second external review, 2026-09-02 (codex)

Four blockers and four further findings against the revised draft. Six changed
the plan; two premises did not survive checking.

**1. Redirects defeated the same-origin promise — confirmed, fixed.** The check
used `redirect: 'follow'` and never looked at `res.url`. A `307`/`308` preserves
method **and** body, so a redirect off the index would have handed the request's
ids and versions to whatever origin it named — and that origin can answer the
preflight permissively, so CORS does not save it. Now `redirect: 'error'`, and
the contract states that the endpoint must not redirect. The adopt path was the
second half: `#importUrl` follows redirects by design (R1's rule for manual URL
imports, which stays) and would have imported a redirected file as merely
"unqualified". It now takes an expected origin and refuses a mismatch outright.

**2. "Check now" destroyed the cache it was meant to refresh — confirmed,
fixed.** `#checkNow()` called `clear()` first and started from `{origins: []}`,
so a failed manual check — the exact case one tests a local index with — wiped
the answers on record, and closing the page mid-request left them wiped. It also
contradicted this plan's own manual check. `force` now skips the due-check and
nothing else; the cache is never cleared to run one.

**3. A finished run could revive a dropped developer origin — confirmed,
fixed.** `stillEnabled` only asked about the master switch, and the caller wrote
back a whole cache captured before the requests went out — so a slot the panel
had just dropped came back, and a concurrent write from a second options tab was
clobbered. `runUpdateCheck` now returns *slots* and writes nothing;
`stillAllowed(origin)` re-reads the live state per answer; `persist(slots)`
re-reads state and cache, folds the slots in through the tested `applySlots`, and
refuses any origin no longer allowed.

**4. The 39-locale rule — premise does not hold; the release gap did.** The
finding cited `AGENTS.md`, which forbids en/de-only keys. `CLAUDE.md` — the
authoritative file — documents `PENDING_TRANSLATION` as exactly the mechanism for
text still being drafted, and the owner confirmed the deferral for R2. `AGENTS.md`
is a stale copy missing that paragraph; that drift is now item 4 under "Open for
the owner". The second half was fair: "ship when the endpoint answers" said
nothing about the texts, so Task 8 now carries an explicit **Not releasable
until** gate naming all thirteen keys.

**5. `newer` meant "different" and could offer a downgrade — confirmed, fixed.**
After a manual import of `1.4.0`, a cache entry still announcing `1.3.0` would
have shown an adopt button for the older version. The exchange format pins
versions to a numeric triple (`SEMVER_RE`, verified in
[js/menu-exchange.js:31](../../../js/menu-exchange.js)), so `isNewer()` now
compares numerically; response versions are validated against the same regex
instead of a length cap. Test added, downgrade case included.

**6. The abort timer ended at the response headers — confirmed, fixed.**
`clearTimeout` sat in a `finally` around the `fetch` alone, so `res.text()` ran
unbounded and a slow body could hang the check for good. The timer now covers the
body read and the validation. A `Content-Length` over the cap is an early exit;
the byte count on the received text remains the real limit, since a chunked
answer declares no length.

**7. "Last checked" never refreshed — confirmed, fixed.** The panel read the
cache once in `connectedCallback()`, and the automatic check finishes afterwards,
so the line would have read "Not asked yet" until a reload. It now uses the same
`CHANGED_EVENT` lifecycle as the managers, with the listener removed in
`disconnectedCallback()`.

**8. The disclosure texts did not match the request — confirmed, fixed by
shrinking the request.** The body carried `type` and `apiLevel` while consent and
`PRIVACY.md` promised "nothing but identifiers and version numbers". Rather than
widen the promise, `type` left the request: ids are unique across menus and
engines in the index, and the kind is information about the user's setup. It stays
in the *answer*, where it is now checked against the kind the client asked about —
which is also the extra test the review asked for. The texts name the interface
version explicitly.

## Third external review, 2026-09-03 (codex)

Three findings against the finished branch, all verified against the code before
anything was changed. All three held.

**1. A withdrawal could revive the cache — confirmed, fixed.** `persist()`
checked the consent, then `await read()` yielded, and a *Withdraw* landing in
that gap was overwritten by the write that followed: the deleted key came back.
The same gap let a developer origin removed mid-run keep its slot, because
`allowedOrigins` came from the state read *before* it. Reproduced deterministically
in `tests/eu-updates-persist.test.mjs` (both cases failed on the old code), then
fixed three ways: the live state is now read **after** the cache and supplies
`allowedOrigins`; `clear()` increments a revocation counter that `persist()`
compares before writing; and a third check after the write repairs the one gap no
check can cover — the instant between the last check and `set()`. The counter is
also incremented from `storage.onChanged` when the key is removed, so a
withdrawal in a second tab stops an in-flight `persist()` here too.

The review's second half — that the read-modify-write is not atomic across tabs —
is correct and **stays**. `chrome.storage` has no transactions; `applySlots`
merges into whatever the cache holds at write time, which narrows the window but
cannot close it. The cost of losing that race is one slot update that the next
check re-fetches, and it is bounded by the throttle, so it does not justify a
lock. Recorded here rather than silently accepted.

**2. Consent and privacy text promised the wrong download moment — confirmed,
fixed.** `euIntegrationConsentPoint5` and `PRIVACY.md` said nothing is
downloaded before the confirmation in the import window. `#importUrl()` fetches
the exchange JSON *before* it can open that window — the dialog needs the payload
to show a preview at all. Both texts now separate the two moments: the check
itself reports only what exists and downloads nothing; the entry's file is fetched
when the user asks for its update; nothing is **adopted or changed** before the
confirmation. Corrected in `en`/`de` and in this plan, which carried the same
sentence verbatim.

**3. The recorded test count was stale — confirmed, fixed.** The status section
still said 597/60 from before the `/simplify` pass removed `dropOrigin` and its
test. It now reads 601 across 29 files and says why the number moved twice.

All 50 manual checks were re-run after these fixes and stayed green.

## Open for the owner

1. **Issue #5's global conflict policy** — pull into R2 (it is worth more with badges than alone) or leave standing? Not folded in; it changes the dialog's model.
2. **`gestura-index` must implement the contract from Task 1** before R2 can be released. Task 8 writes the hand-over; the endpoint's arrival is what unblocks the release, not the code.
3. **Two small R1 findings stay open** and are untouched here: the bridge's `getManifest()`/`statusAnswer()` calls outside a try/catch (`js/eu-bridge.js`), and `js/eu-local.js` never retrying a failed first load. Neither blocks R2, and the session that found them is taking both. The third — `_devDraft` being clobbered by any storage change — is fixed in Task 4 step 13, because this plan edits that file anyway and two people editing it in parallel buys nothing but a conflict.
4. **`AGENTS.md` has drifted from `CLAUDE.md`.** It is a copy that is missing the `PENDING_TRANSLATION` paragraph (and two `Conventions` bullets), so an agent reading `AGENTS.md` concludes that en/de-only keys break a hard rule — one review did exactly that. Either sync it or make it a one-line pointer at `CLAUDE.md`; two instruction files that disagree will keep producing false findings. Not part of R2's tasks.
5. **`main` is 39 commits ahead of `gestura/main` and unpushed.** R2 branches off it either way, but the further the two drift the more a merge into `firefox-build` has to absorb at once.

---

## Execution status, 2026-09-02

Implemented on `feature/eu-integration-r2`, seven commits, `004923d`…`9706cbc`.
**`npm test`: 29 files, 601 tests green** (baseline before R2 was 27 files / 536).
`tests/eu-updates.test.mjs` contributes 59 of them and
`tests/eu-updates-persist.test.mjs` 5. The figure moved twice after the tasks:
the `/simplify` pass removed `dropOrigin` and its test, and the review pass added
the persist file - so a count taken mid-branch will not match.

| Task | State |
|---|---|
| 1 — the contract in `docs/gestura-eu-api.md` | done, `004923d` |
| 2 — the pure core of `js/eu-updates.js` | done, `2cde806` |
| 3 — orchestrator, storage accessors, `options.html` | done, `b4c2c37` |
| 4 — consent version 2, en/de texts, 37 locales stripped | done, `6d152a7` |
| 5 — the check on options open, panel line + "check now" | done, `9f7ddb9` |
| 6 — badges, adopt button, `expectOrigin` on `#importUrl` | done, `f4ca9a8` |
| 7 — `PRIVACY.md`, both store docs, `CHANGELOG.md` | done, `9706cbc` |

Nothing was deferred from the plan's task list. Two deviations, both noted below.

### Deviations from the plan

1. **The mock ran on `http://localhost:8199`, not `:8123`.** Port 8123 is taken
   on this machine by the `gestura-index` dev server. The port is only ever a
   developer origin, so nothing depends on the number.
2. **The manual checks were driven programmatically, in Edge.** Chrome 152
   ignores the **`--load-extension` command-line switch**, so a throwaway Chrome
   started that way came up without the extension
   (`--disable-features=DisableLoadExtensionCommandLineSwitch`,
   `--enable-unsafe-extension-debugging` and `--test-type` were all tried; none
   restores it). Note what this does *not* say: Chrome still runs the extension
   perfectly well from a profile it was loaded into by hand via
   `chrome://extensions`, which is how a normal development browser has it — an
   earlier draft of this section overstated the limitation as "Chrome cannot
   load an unpacked extension at all", and that is wrong.

   Edge — which this extension also targets, same Chromium — still honours the
   switch, so a throwaway profile was one command instead of a manual setup step,
   and the checks ran there against a real network and a real `chrome.storage`,
   driven over CDP. Every claim below was asserted, not eyeballed.

   Playwright would not have changed this either way: `@playwright/mcp` has **no
   option to load an unpacked extension** (`--extension` means "attach to a
   running Edge/Chrome that has the Playwright Extension installed"), so it too
   can only drive a browser that already carries it. Its `--cdp-endpoint` does
   make the two approaches combinable — start the browser once, attach both the
   CDP script and Playwright — which is the better setup when screenshots are
   wanted alongside assertions.

   **The one thing none of this covers is Firefox**, which R2 does not touch
   beyond the shared `pages/options.html` line.

   The scripts, the mock and the environment notes live outside this repo, in
   `browser-verify/` beside the project's memory directory.

### Verified by hand (driven over CDP, Edge 152 + a local mock)

All 50 assertions passed. Task 5 step 5:

1. **PASS, with one claim corrected** — the mock logs a
   `POST /api/v1/updates` whose body is `{"apiLevel":2,"entries":[{"id":
   "com.example.klein","version":"1.0.0"}]}`: the dev-index entry only, no
   entry kind on the wire, and **not** the file import that carries the same id.
   It logs **no `OPTIONS` preflight**, and that is correct: Chromium exempts an
   extension's `fetch` from CORS entirely when `host_permissions` match the
   target, so Edge and Chrome never send one. An earlier run of this check
   reported a preflight — that entry came from a manual `curl -X OPTIONS` smoke
   test which the mock's then-cumulative log replayed into the file after the
   driver cleared it. The mock now forgets its history when the log is cleared,
   and the assertion says what is actually verifiable here. **The preflight in
   the contract is a Firefox requirement** (MV3 withholds host permissions until
   the user opts in at `about:addons`), and it stays unverified along with the
   rest of Firefox.
2. **PASS** — reopening the settings inside the window logs nothing at all.
3. **PASS** — a forced check logs a fresh request and moves `checkedAt` forward.
4. **PASS** — `chrome.storage.local` holds `euUpdates` with exactly one slot for
   `http://localhost:8199`.
5. **PASS** — with the endpoint unreachable, a forced check reports no slot and
   leaves `checkedAt` **and** the cached results byte-identical.
6. **PASS (the revoke race)** — with the mock answering after 3 s, a withdrawal
   mid-flight deletes `euUpdates`, and it is **still** gone once the answer
   arrives. This is the case the first external review found.
7. **PASS (the dev-origin race)** — changing the developer origin mid-flight
   leaves no slot for the old origin and creates none when the answer lands.
8. **PASS** — a failed manual check keeps the slot and the `checkedAt` it had.
   This is the case the second review found in the `clear()`-first draft.

Task 6 step 7:

1. **PASS** — the index entry shows an **Update** badge; its tooltip reads
   "gestura.eu bietet Version 9.9.9 an. … — Two new patterns, one fixed icon."
2. **PASS** — the menu imported from a file with the same id shows no badge and
   offers no adopt button.
3. **PASS** — adopt opens the import dialog with the payload the mock served
   (version 9.9.9), the replace/new choice and the confirm button.
4. **PASS** — after renaming the entry (with a real `baselineHash`, so
   `modifiedState()` answers `true`), adopt opens the dialog with the
   `exchangeConflictModified` warning and `_importMode === 'new'`: it does not
   default to discarding the user's edit. R1 behaviour, working as intended.
5. **PASS** — actually adopting stamps `source.version = 9.9.9` and the badge is
   gone on the next render, with no new check and the cached answer still on
   record.
6. **PASS** — `deprecated: true` at the stored version renders **Eingestellt**,
   no Update badge, and no adopt button.
7. **PASS** — `deprecated: true` **with** a newer version keeps **Eingestellt**,
   names retirement, successor and version in one tooltip, and the adopt button
   is back.
8. **PASS** — switching the integration off removes every badge; a forced stale
   consent (`enabled: true`, `consent.version: 1`) leaves the cache in place,
   shows no badge, and the panel offers its re-confirmation row. That guard is
   the second review's finding.

Task 4 step 14 (the R1 draft defect):

- **PASS** — typing `http://localhost:81` into the developer-origin field and
  then causing a storage write keeps both the text and the caret (offset 19
  before and after).
- **PASS** — committing a pasted `http://localhost:8199/` stores and *displays*
  the trimmed origin.

### Not verified

- **Firefox.** R2 adds no content script and no `importScripts` entry, so the
  only shared surface is the `pages/options.html` line both branches carry.
  `npm run ff:run` / `web-ext lint` on `firefox-build` still belong to the merge
  that takes R2 there.
- **The real endpoint.** `https://gestura.eu/api/v1/updates` does not exist yet;
  everything above ran against the mock in the scratchpad
  (`updates-mock.mjs`, config-driven so the answer can change between checks).
- **`Content-Length` over the cap as an early exit.** The mock never sends an
  oversized declared length; the byte-count limit inside `parseUpdateResponse`
  *is* unit-tested.

### Defects found while verifying

**In the first pass, none** — every check passed on its first run. Two
environment findings, recorded because the next executor will hit them: Chrome
152 ignores `--load-extension` on the command line (a profile prepared by hand
still works, and so does Edge), and port 8123 belongs to the index dev server on
this machine.

**In the `/simplify` pass afterwards, two** — both introduced by that refactor
and both caught by re-running these same checks, which is the reason they were
re-run rather than assumed:

1. `UpdateWatch` cached the `effectiveEnabled` answer instead of asking per
   render, so switching the integration off — or a stale consent — no longer
   removed the badges (T6.8a and the second T6.8b failed). The cached flag was
   only refreshed on an `euUpdates` change, and both of those cases change
   `euIntegration` instead. Fixed by subscribing to `GesturaEuLocal.onChange`
   as well; the watch now reacts to the state change rather than depending on
   something else to trigger a re-render, which is stricter than the per-render
   guard it replaced.
2. The harness flaw described in check 1 above, which had made a manual `curl`
   look like a browser preflight.

### Beyond the plan

`PRIVACY.md`'s summary at the top (line 12) said the integration *"only answers
questions from gestura.eu"*. R2 makes that as wrong as the bullet the plan named,
and no test guards prose, so it was corrected in the same commit: it now says the
integration answers questions **and asks that index, at most once a day, when the
settings open**.

### Not releasable until

1. `PENDING_TRANSLATION` in `tests/site-menu-locales.test.mjs` holds none of
   R2's keys any more: `euIntegrationConsentPoint1`,
   `euIntegrationConsentPoint5Label`, `euIntegrationConsentPoint5`,
   `euIntegrationUpdateCheck`, `euIntegrationCheckNow`,
   `euIntegrationLastChecked`, `euIntegrationNeverChecked`,
   `euIntegrationUpdateBadge`, `euIntegrationUpdateTooltip`,
   `euIntegrationUpdateApply`, `euIntegrationRetiredBadge`,
   `euIntegrationRetiredTooltip`, `euIntegrationRetiredSuccessor` — all of them
   translated into all 39 locales and deleted from the list. The list's own test
   fails once a key is everywhere but still listed, so this cannot be forgotten
   quietly; what it does not do is stop a release, which is why it is written
   here as well.
2. `https://gestura.eu/api/v1/updates` answers the contract in
   `docs/gestura-eu-api.md`, `OPTIONS` preflight included.
3. `PRIVACY.md` and both store data declarations carry the update check
   (Task 7).
