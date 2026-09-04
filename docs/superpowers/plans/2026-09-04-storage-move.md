# Storage Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the settings grow past `chrome.storage.sync`'s 8192 bytes per branch for users who choose it — by making the storage area a per-browser switch — while a user who never switches keeps today's behaviour byte for byte.

**Architecture:** One new classic script, `js/settings-storage.js` (`window.GesturaSettingsStorage`), becomes the only thing that touches `chrome.storage.sync` or `chrome.storage.local` for *settings*. It caches the active area from its own `storage.local` key `settingsArea`, filters every read and every change event to the 70 keys of `DEFAULT_SETTINGS`, runs the size pre-check before every write and returns a typed refusal instead of a failed write, and performs the one-time copy when the user switches. Every existing call site — service worker, content scripts, the pages' `SettingsStore`, three page scripts — is rewired onto it. Around that core: the refusal becomes a dialog with three ways out, the sync payload is gzipped inside the existing envelope, seven device-local keys stop travelling over gestura.eu, and four small repairs the move exposes are made.

**Tech Stack:** Manifest V3, plain JS classic scripts (IIFE + `root.X = api`, `module.exports` for vitest), Lit (vendored `js/lib/lit-all.min.js`), `CompressionStream` / `DecompressionStream` (Chrome 80+ / Firefox 113+, below the extension's floor of Chrome 109 / Firefox 140 — no feature detection), vitest (`npm test`, Node 24).

**Spec:** [docs/superpowers/specs/2026-09-04-storage-move-design.md](../specs/2026-09-04-storage-move-design.md) — the plan argues from the spec; executors read both. Section numbers below (§4, §10.1 …) refer to it.

**Predecessors:** the storage display ([2026-08-30-speicheranzeige.md](2026-08-30-speicheranzeige.md), which called this "Vorhaben zwei") and R3 sync ([2026-09-03-gestura-eu-integration-r3.md](2026-09-03-gestura-eu-integration-r3.md), whose `a32f7df` / `e3799f7` conflict protection is what makes waiting for the second document safe).

**Successor:** [2026-09-04-sync-reconciliation-design.md](../specs/2026-09-04-sync-reconciliation-design.md) builds on Task 9's `forSync` and Task 8's gzip. Nothing here anticipates it beyond those two.

## Global Constraints

- **No build step.** The repo folder *is* the unpacked extension. The new `js/settings-storage.js` is a classic script (IIFE, `root.GesturaSettingsStorage = api`, `module.exports` for vitest); components under `js/components/` stay ES modules. Never mix the two worlds.
- **Indentation is tabs**, throughout — JS, JSON, HTML, Markdown code blocks.
- **Internal `FlowMouse*` identifiers stay.** New globals use the `Gestura*` prefix: `GesturaSettingsStorage`.
- **State "browser sync on" is byte-for-byte today's behaviour** (spec §14): same store, same 8192 B per branch, same 102 400 B total. No migration. A user who never switches must not be able to tell the rebuild happened.
- **Exactly one storage area is active at a time.** Never write both.
- **The stale `storage.sync` copy is never deleted** (§4, §10.1). No task may call `chrome.storage.sync.clear()` or remove a settings key from `storage.sync`, except `switchTo('sync')` removing the two note keys.
- **The façade has no `clear()`.** Reset writes `DEFAULT_SETTINGS` as values.
- **`js/storage-usage.js` is inherited unchanged** (§11). The façade carries its own copy of the two-line formula, pinned by a test.
- **i18n: new keys use the `storage` prefix**, which is already in `NEW_KEY_PREFIXES` of `tests/site-menu-locales.test.mjs`; every new key lands in `en` and `de` **and** in `PENDING_TRANSLATION` there. Never put an undeclared `$WORD$` in a message — `{token}` plus `.replace()`.
- **Compression: payload only**, recognised by the `1f 8b` magic, decompression bounded at 1 MiB, the contract's envelope test vector unchanged byte for byte (§8).
- **`version_name` in `manifest.json` is generated** — never edit it; this plan bumps no version.
- **`js/background.js`'s `importScripts` list and `background.scripts` in the Firefox manifest on `firefox-build` must agree.** Task 4 changes the first; the second is changed at the next merge into `firefox-build` and is written out in Task 4 so it is not forgotten.
- **Nothing in `exchange/` is committed**, here or referenced from tracked files.

---

## Decisions taken in this plan (2026-09-04)

The spec leaves these to the plan, or does not foresee them. Decided here with the reason, so a reviewer can disagree with the reason rather than guess.

1. **`js/constants.js` becomes root-agnostic.** The façade needs `DEFAULT_SETTINGS` in the service worker, and `constants.js` is not loaded there today — it assigns `window.GestureConstants`, and a service worker has no `window`. Task 1 changes its two `window.` assignments to `root.`, with `root = typeof self !== 'undefined' ? self : globalThis`, the shape every `eu-*.js` already uses. In pages `self === window`, so nothing else changes; the test shims (`globalThis.window = globalThis`) keep working because in Node `self` is undefined and `root` is `globalThis`.

2. **`note()` is the façade's eighth function.** §5 says "seven things and nothing else", and §4 requires a browser still in state `sync` to *read* `syncMovedAt` / `syncMovedTo` out of `storage.sync`. Those two keys are not in `DEFAULT_SETTINGS`, so `get()` filters them by design, and letting the options page call `chrome.storage.sync.get` directly would reintroduce the very call site pattern the façade removes. `note()` returns `{ movedAt, movedTo } | null` and is the only reader of the note.

3. **The `onInstalled` update migrations stay on `chrome.storage.sync`.** [background.js:1543–1716](../../../js/background.js#L1543-L1716) runs once per update and migrates keys that predate this release (`gestures`, `customGestures`, `scrollAmount`, `enableAdvancedSettings`, `includeTitle`). Such data can only exist in `storage.sync`: a browser in state `local` was created by a Gestura that had already run these migrations. Going through the façade would also be *wrong* — `get()` drops the legacy keys as unknown and the migration would silently do nothing. One comment at the top of the block says so.

4. **`switchTo('sync')` reads `euSync.enabled` from `storage.local` directly** for the tier-2 refusal (§4). The alternative — the panel passing a flag — would let a caller forget it. One key name (`'euSync'`) and one boolean is the whole coupling; the façade never writes that key.

5. **Seven pages are registered, not five.** Beyond the five the spec names, `pages/about.html` loads `js/content.js` (which reads settings) and `pages/permission.html` loads `js/i18n.js` (which reads `theme` and `language`). Both would throw `GesturaSettingsStorage is undefined` on open. `tests/page-content-deps.test.mjs` gains the rule "`constants.js` → `settings-storage.js` → `i18n.js`, in that order, on every page that loads `i18n.js`", so the next page cannot forget it.

6. **`save()` returns the façade's result object; every caller reads `.ok`.** Today `save()` returns `true | false` and callers test `if (!ok)`. An object `{ ok: false }` is truthy, so the change is not backward compatible and every one of the 13 call sites is touched in Task 6, deliberately, rather than keeping a boolean and losing the reason.

7. **The favicon cap is a pure function in `js/favicon-util.js`.** `js/background.js` cannot be unit-tested (its first line is `importScripts`). `pruneCache(cache, max)` lives beside `parseIconLinks` and gets its test there; the worker calls it.

8. **The transport test fixture becomes incompressible.** `tests/eu-sync.test.mjs` builds its oversized payload from `'x'.repeat(…)`, which gzip reduces to a few hundred bytes — with compression the test would stop refusing and go red for the wrong reason. Task 8 replaces the fixture with a megabyte of random base64 characters, which gzip cannot shrink below the 512 KiB envelope limit. The test's claim ("the upload measures the real envelope and refuses over 512 KiB") is unchanged.

9. **`hashOf` strips the seven device-local keys itself**, in addition to `_version`. The spec says the hash uses the sync shape; making the caller responsible would let a theme change offer an upload the moment one caller forgets `forSync`. Stripping inside `hashOf` is idempotent on an already-stripped object.

10. **The three ways are a dialog owned by the options page.** `save()` dispatches `gestura:storage-full` (a window event, like the existing `gestura:settings-saved`) with the typed failure; `<options-page>` hosts one `<storage-full-dialog>` that renders it. Callers that used to `alert()` a generic message skip it when `isStorageFull(res)` is true, so the user sees the dialog once and not an alert on top. The popup and the CSS editor have no dialog: the popup keeps its silent rollback, the CSS editor shows one short hint pointing at the data section.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `js/settings-storage.js` | The façade: `area`, `ready`, `get`, `set`, `remove`, `onChanged`, `usage`, `switchTo`, `note`; the area cache fed by `storage.onChanged`; the key filter; the pre-check; the formula copy; the `syncFormat` marker. Nothing else touches `chrome.storage.*` for settings. |
| `js/components/storage-full-dialog.js` | The refusal as a decision: title with branch and numbers, the three ways, one `storage-way` event. |
| `tests/helpers/fake-chrome-storage.mjs` | An in-memory `chrome.storage` with two areas, `get` in all four key shapes, `onChanged` dispatch with namespace, and a one-shot `onSet` hook for the race test. Shared by the two new suites. |
| `tests/settings-storage.test.mjs` | Every façade test of §12, the formula agreement test, the `MAX_BYTES` equality test. |
| `tests/settings-store.test.mjs` | `reset()` as values, the 10.1 guard, the 10.2 filter, the 10.4 loader, the typed `save()` result. |

**Modified**

| File | Change |
|---|---|
| `js/constants.js` | `window.` → `root.` (decision 1). |
| `js/background.js` | `importScripts` for `constants.js` and `settings-storage.js`; 20 call sites onto the façade; the `onChanged` listener onto `onChanged`; the migration block commented; the favicon cap. |
| `js/content.js` | Two `get`, four `set`, two listeners onto the façade. |
| `js/eu-bridge.js` | One `get`. |
| `js/i18n.js` | One `get`. |
| `js/context-menu.js` | One `get`. |
| `js/tutorial.js` | One `set`. |
| `js/settings-store.js` | Delegates to the façade; typed `save()`; `reset()` as values; the 10.1 / 10.2 / 10.4 repairs; `isStorageFull`; named exports for tests. |
| `js/favicon-util.js` | `pruneCache`. |
| `js/eu-sync-crypto.js` | `encryptBytes`, `encryptCompressed`, `gzip`, `gunzipBounded`, the `1f 8b` sniff in `decryptBlob`. |
| `js/eu-sync.js` | Payload through `encryptCompressed`; `statesMax` 5. |
| `js/eu-settings-schema.js` | `DEVICE_LOCAL`; `forSync` through `allowedKeys`, `buildExport`, `validate`, `validatedExport`; `opts.local`; `hashOf` on the sync shape; `MAX_BYTES` 1 MiB. |
| `js/components/options-page.js` | Storage rows follow the area; the switch row; the note line; hosts the dialog; `.ok` on three `save()` results; `#applySettings` result. |
| `js/components/storage-line.js` | Takes the whole settings object; silent below 75 % in state `local`. |
| `js/components/site-menu-manager.js`, `engine-manager.js` | New `renderStorageLine` arguments; `.ok`; skip the alert when full. |
| `js/components/menu-import-dialog.js` | Projection against the total in state `local`; `.ok`; skip the alert when full. |
| `js/components/popup-page.js`, `css-editor-page.js`, `action-select.js`, `chain-panel.js` | `.ok` where the result is read. |
| `js/components/eu-sync-panel.js` | `#accept()` performs the switch; `forSync` on export and download; `local` on download. |
| `manifest.json` | `js/settings-storage.js` after `js/constants.js` in `content_scripts`. |
| `pages/options.html`, `popup.html`, `css-editor.html`, `tutorial.html`, `about.html`, `permission.html`, `context-menu.html` | `constants.js` → `settings-storage.js` → `i18n.js`; `options.html` also loads the dialog module. |
| `tests/page-content-deps.test.mjs` | `settings-storage.js` before `content.js`; the i18n ordering rule. |
| `tests/eu-settings-schema.test.mjs`, `tests/eu-sync-crypto.test.mjs`, `tests/eu-sync.test.mjs`, `tests/favicon-util.test.mjs` | Extended as §12 lists. |
| `tests/site-menu-locales.test.mjs` | New `storage*` keys into `PENDING_TRANSLATION`. |
| `_locales/en/messages.json`, `_locales/de/messages.json` | ~18 new `storage*` keys. |
| `docs/gestura-eu-api.md` | The six amendments of §9. |
| `PRIVACY.md` | Where settings live when browser sync is off; compressed length. |
| `CHANGELOG.md` | Entry under `### Unreleased`. |

**Deliberately not touched:** `js/storage-usage.js` and its test; `js/eu-local.js`, `js/eu-sync-local.js`, `js/eu-updates.js` (they own their own `storage.local` keys and are not settings); the `onInstalled` migrations (decision 3).

---

## Task 1: The façade — area, keys, formula

The core, test-first, with nothing else changing. After this task the file exists, is registered nowhere, and is used by nobody.

**Files:**
- Modify: `js/constants.js:335`, `js/constants.js:353`
- Create: `tests/helpers/fake-chrome-storage.mjs`
- Create: `js/settings-storage.js`
- Test: `tests/settings-storage.test.mjs`

**Interfaces:**
- Consumes: `root.GestureConstants.DEFAULT_SETTINGS` (70 keys).
- Produces: `root.GesturaSettingsStorage = { AREA_KEY, NOTE_KEYS, QUOTA, byteLength, entryBytes, area, ready, get, set, remove, onChanged, usage }`. `set(patch)` resolves `{ ok: true }` or `{ ok: false, error: 'write' }` in this task; Task 2 adds the size refusals. `get(keys)` accepts `null`, a string, an array or an object of defaults, exactly like `chrome.storage.*.get`, and never returns a key outside `DEFAULT_SETTINGS`. `onChanged(fn)` returns an unsubscribe function; `fn(changes)` receives only known keys from the active area.

- [ ] **Step 1: Make `constants.js` root-agnostic**

In `js/constants.js`, line 1 reads `(function () {`. Change the IIFE to take a root, and replace the two `window.` assignments:

```js
(function (root) {
	'use strict';
```

```js
	root.GestureConstants = {
```

```js
	root.litDisableBundleWarning = true;
})(typeof self !== 'undefined' ? self : globalThis);
```

Run `npm test` — every suite must stay green (the shims set `globalThis.window = globalThis`, and in Node `self` is undefined, so `root` is `globalThis`).

- [ ] **Step 2: Write the fake storage helper**

Create `tests/helpers/fake-chrome-storage.mjs`:

```js
// An in-memory chrome.storage with the two areas the façade selects between.
// `get` accepts the four key shapes chrome accepts (null, string, array, object
// of defaults); every write dispatches onChanged with its namespace, synchronously,
// which is how the façade's area cache is exercised without a browser.
//
// `hooks.onSet` is a ONE-SHOT hook run inside the next set(), before its onChanged
// fires: the race test of switchTo() uses it to land a write in storage.sync while
// the first copy is in flight.
export function fakeChromeStorage() {
	const areas = { sync: new Map(), local: new Map() };
	const listeners = new Set();
	const hooks = { onSet: null };
	const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

	function emit(changes, name) {
		for (const fn of [...listeners]) fn(changes, name);
	}

	function makeArea(name) {
		const m = areas[name];
		return {
			QUOTA_BYTES_PER_ITEM: 8192,
			QUOTA_BYTES: 102400,
			async get(keys) {
				const out = {};
				if (keys === null || keys === undefined) {
					for (const [k, v] of m) out[k] = clone(v);
					return out;
				}
				if (typeof keys === 'string') keys = [keys];
				if (Array.isArray(keys)) {
					for (const k of keys) if (m.has(k)) out[k] = clone(m.get(k));
					return out;
				}
				for (const [k, def] of Object.entries(keys)) out[k] = m.has(k) ? clone(m.get(k)) : clone(def);
				return out;
			},
			async set(obj) {
				const changes = {};
				for (const [k, v] of Object.entries(obj)) {
					changes[k] = { oldValue: clone(m.get(k)), newValue: clone(v) };
					m.set(k, clone(v));
				}
				if (hooks.onSet) {
					const hook = hooks.onSet;
					hooks.onSet = null;
					await hook(name, obj);
				}
				emit(changes, name);
			},
			async remove(keys) {
				const changes = {};
				for (const k of (Array.isArray(keys) ? keys : [keys])) {
					if (!m.has(k)) continue;
					changes[k] = { oldValue: clone(m.get(k)) };
					m.delete(k);
				}
				if (Object.keys(changes).length) emit(changes, name);
			},
			async clear() {
				const changes = {};
				for (const [k, v] of m) changes[k] = { oldValue: clone(v) };
				m.clear();
				emit(changes, name);
			},
		};
	}

	const chrome = {
		storage: {
			sync: makeArea('sync'),
			local: makeArea('local'),
			onChanged: {
				addListener: (fn) => listeners.add(fn),
				removeListener: (fn) => listeners.delete(fn),
			},
		},
		runtime: { lastError: null },
	};

	return {
		chrome,
		hooks,
		emit,
		// Raw access for assertions: what is REALLY in an area, unfiltered.
		raw: (name) => Object.fromEntries(areas[name]),
		// Empties both areas WITHOUT dispatching - a test fixture, not a user action.
		clear: () => { areas.sync.clear(); areas.local.clear(); },
		listenerCount: () => listeners.size,
	};
}
```

- [ ] **Step 3: Write the failing tests for area, keys and the formula**

Create `tests/settings-storage.test.mjs`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeChromeStorage } from './helpers/fake-chrome-storage.mjs';
import * as U from '../js/storage-usage.js';

const fake = fakeChromeStorage();
globalThis.chrome = fake.chrome;
globalThis.window = globalThis;
await import('../js/constants.js');
await import('../js/settings-storage.js');
const S = globalThis.GesturaSettingsStorage;
const DEFAULTS = globalThis.GestureConstants.DEFAULT_SETTINGS;
const KNOWN = Object.keys(DEFAULTS);

// The module caches the area for the life of the context. Between tests the
// fixture is emptied without events, and the area is put back to 'sync' THROUGH
// storage so the cache follows - the same reasoning tests/eu-sync-local.test.mjs
// gives for writing the defaults through the module.
beforeEach(async () => {
	fake.clear();
	await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'sync', movedAt: '', movedTo: '' } });
});

describe('area', () => {
	it('defaults to sync when nothing is stored', async () => {
		fake.clear();
		await chrome.storage.local.set({ [S.AREA_KEY]: undefined });
		expect(S.area()).toBe('sync');
	});

	it('follows the stored value', async () => {
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'local', movedAt: '2026-09-04T00:00:00.000Z', movedTo: 'local' } });
		expect(S.area()).toBe('local');
	});

	it('treats anything that is not "local" as sync', async () => {
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'somewhere' } });
		expect(S.area()).toBe('sync');
	});
});

describe('get and set address the selected area', () => {
	it('reads and writes storage.sync in state sync', async () => {
		await S.set({ theme: 'dark' });
		expect(fake.raw('sync').theme).toBe('dark');
		expect(fake.raw('local').theme).toBeUndefined();
		expect((await S.get(['theme'])).theme).toBe('dark');
	});

	it('reads and writes storage.local in state local', async () => {
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'local', movedAt: 'x', movedTo: 'local' } });
		await S.set({ theme: 'dark' });
		expect(fake.raw('local').theme).toBe('dark');
		expect(fake.raw('sync').theme).toBeUndefined();
		expect((await S.get(['theme'])).theme).toBe('dark');
	});

	it('get(null) returns the known keys only and omits a foreign one', async () => {
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'local', movedAt: 'x', movedTo: 'local' } });
		await chrome.storage.local.set({ theme: 'dark', faviconCache: { 'https://a': { icon: null, ts: 1 } } });
		const items = await S.get(null);
		expect(items.theme).toBe('dark');
		expect(items).not.toHaveProperty('faviconCache');
		expect(items).not.toHaveProperty(S.AREA_KEY);
	});

	it('get with an object of defaults fills what is missing, like chrome does', async () => {
		await S.set({ theme: 'dark' });
		const items = await S.get({ theme: 'auto', language: 'auto' });
		expect(items).toEqual({ theme: 'dark', language: 'auto' });
	});

	it('get with a string returns that one key', async () => {
		await S.set({ theme: 'dark' });
		expect(await S.get('theme')).toEqual({ theme: 'dark' });
	});

	it('set drops a foreign key rather than writing it', async () => {
		await S.set({ theme: 'dark', faviconCache: {} });
		expect(fake.raw('sync')).not.toHaveProperty('faviconCache');
	});

	it('set reports a failing store as a write error', async () => {
		const orig = chrome.storage.sync.set;
		chrome.storage.sync.set = async () => { throw new Error('QUOTA_BYTES quota exceeded'); };
		try {
			expect(await S.set({ theme: 'dark' })).toEqual({ ok: false, error: 'write' });
		} finally {
			chrome.storage.sync.set = orig;
		}
	});
});

describe('remove', () => {
	it('removes a known key from the active area', async () => {
		await S.set({ theme: 'dark' });
		await S.remove(['theme']);
		expect(fake.raw('sync')).not.toHaveProperty('theme');
	});

	it('refuses an unknown key and touches nothing', async () => {
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'local', movedAt: 'x', movedTo: 'local' } });
		await chrome.storage.local.set({ euIntegration: { enabled: true }, faviconCache: { a: 1 } });
		await S.remove(['euIntegration', 'faviconCache']);
		expect(fake.raw('local').euIntegration).toEqual({ enabled: true });
		expect(fake.raw('local').faviconCache).toEqual({ a: 1 });
	});
});

describe('onChanged', () => {
	it('delivers a change from the active area and drops one from the inactive area', async () => {
		const seen = [];
		const off = S.onChanged(c => seen.push(c));
		await chrome.storage.sync.set({ theme: 'dark' });
		await chrome.storage.local.set({ theme: 'light' });
		off();
		expect(seen).toHaveLength(1);
		expect(seen[0].theme.newValue).toBe('dark');
	});

	it('drops faviconCache and passes siteMenus', async () => {
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'local', movedAt: 'x', movedTo: 'local' } });
		const seen = [];
		const off = S.onChanged(c => seen.push(c));
		await chrome.storage.local.set({ faviconCache: { a: 1 } });
		await chrome.storage.local.set({ siteMenus: DEFAULTS.siteMenus, faviconCache: { a: 2 } });
		off();
		expect(seen).toHaveLength(1);
		expect(Object.keys(seen[0])).toEqual(['siteMenus']);
	});

	it('is one chrome listener however many callers subscribe', () => {
		const before = fake.listenerCount();
		const offs = [S.onChanged(() => {}), S.onChanged(() => {}), S.onChanged(() => {})];
		expect(fake.listenerCount()).toBe(before);
		offs.forEach(off => off());
	});

	it('follows the area after a switch through storage', async () => {
		const seen = [];
		const off = S.onChanged(c => seen.push(c));
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'local', movedAt: 'x', movedTo: 'local' } });
		await chrome.storage.sync.set({ theme: 'dark' });
		await chrome.storage.local.set({ theme: 'light' });
		off();
		expect(seen).toHaveLength(1);
		expect(seen[0].theme.newValue).toBe('light');
	});
});

describe('the formula', () => {
	// §6: the façade cannot import the ES module, so it carries a copy. This is
	// the test that keeps the copy honest.
	const fixtures = [
		['k', { a: 1 }],
		['siteMenus', DEFAULTS.siteMenus],
		['customCss', 'üü — ✓ 日本語'],
		['blacklist', ['example.com', 'ünïcödé.example']],
		['n', 42],
		['b', false],
		['z', null],
	];
	it.each(fixtures)('agrees with js/storage-usage.js on %s', (key, value) => {
		expect(S.entryBytes(key, value)).toBe(U.entryBytes(key, value));
	});
});

describe('usage', () => {
	it('measures the object it is given against the active area', async () => {
		const u = S.usage({ theme: 'dark', siteMenus: DEFAULTS.siteMenus, faviconCache: { a: 1 } });
		expect(u.area).toBe('sync');
		expect(u.branches).toHaveProperty('theme');
		expect(u.branches).toHaveProperty('siteMenus');
		expect(u.branches).not.toHaveProperty('faviconCache');
		expect(u.total).toBe(u.branches.theme + u.branches.siteMenus);
		expect(u.quota).toEqual({ item: 8192, total: 102400 });
	});

	it('has no per-item quota in state local', async () => {
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'local', movedAt: 'x', movedTo: 'local' } });
		expect(S.usage({}).quota).toEqual({ item: null, total: 1024 * 1024 });
	});
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/settings-storage.test.mjs`
Expected: FAIL — `Cannot find module '../js/settings-storage.js'`.

- [ ] **Step 5: Write the façade**

Create `js/settings-storage.js`:

```js
// The only thing that touches chrome.storage.sync or chrome.storage.local for
// SETTINGS. Every other module - the service worker, every content script, the
// pages' SettingsStore, the three page scripts - asks this one, and this one
// decides which area is active.
//
// Exactly one area is active at a time (docs/superpowers/specs/2026-09-04-
// storage-move-design.md, §2). The switch is its own storage.local key, so it is
// per browser, and it is cached here the way js/eu-local.js caches its key: fed
// by storage.onChanged, readable without awaiting. State 'sync' is today's
// behaviour byte for byte - same store, same limits.
//
// Classic script on purpose: content scripts cannot use modules and the service
// worker reaches it through importScripts. Loaded directly after constants.js
// everywhere, because the key filter below needs DEFAULT_SETTINGS.
(function (root) {
	'use strict';

	const AREA_KEY = 'settingsArea';
	// Left in storage.sync by the browser that switched, for the browsers that did
	// not (§4). Not settings: never in DEFAULT_SETTINGS, never exported.
	const NOTE_KEYS = ['syncMovedAt', 'syncMovedTo'];
	// §10.1: written beside the settings in storage.sync from this release on. It
	// means nothing yet; it is what makes a later format change detectable by a
	// reader that knows to look.
	const FORMAT_KEY = 'syncFormat';
	const FORMAT_VERSION = 1;
	const EU_SYNC_KEY = 'euSync';

	// Chrome's documented values for storage.sync; §3's decision for storage.local.
	// The item quota is null where the browser enforces none - a per-branch number
	// there would be an invention.
	const QUOTA = {
		sync: { item: 8192, total: 102400 },
		local: { item: null, total: 1024 * 1024 },
	};

	const defaults = () => root.GestureConstants.DEFAULT_SETTINGS;
	const knownKeys = () => Object.keys(defaults());
	const isKnown = (k) => Object.prototype.hasOwnProperty.call(defaults(), k);

	// The formula of js/storage-usage.js - key length plus the length of the JSON
	// value, in UTF-8 bytes, which is exactly Chrome's own accounting. A COPY, not
	// an import: storage-usage.js is an ES module and this file cannot import one.
	// tests/settings-storage.test.mjs runs both over the same fixtures.
	function byteLength(str) {
		return new TextEncoder().encode(str).length;
	}

	function entryBytes(key, value) {
		return byteLength(String(key)) + byteLength(JSON.stringify(value));
	}

	function pickKnown(items) {
		const out = {};
		for (const k of Object.keys(items || {})) {
			if (isKnown(k)) out[k] = items[k];
		}
		return out;
	}

	function normalizeArea(raw) {
		const src = (raw && raw[AREA_KEY] && typeof raw[AREA_KEY] === 'object') ? raw[AREA_KEY] : {};
		return {
			area: src.area === 'local' ? 'local' : 'sync',
			movedAt: typeof src.movedAt === 'string' ? src.movedAt : '',
			movedTo: typeof src.movedTo === 'string' ? src.movedTo : '',
		};
	}

	let cache = normalizeArea({});
	let loaded = false;
	let loading = null;
	const listeners = new Set();

	function absorb(raw) {
		cache = normalizeArea(raw);
		loaded = true;
		return cache;
	}

	function load() {
		if (!loading) {
			let promise;
			try {
				promise = chrome.storage.local.get(AREA_KEY);
			} catch (e) {
				promise = Promise.reject(e);
			}
			loading = promise.then(absorb).catch(() => {
				// Same reasoning as js/eu-local.js: a failed read must not become this
				// context's answer for good. The default is 'sync' - today's behaviour.
				loading = null;
				return cache;
			});
		}
		return loading;
	}

	async function ready() {
		return loaded ? cache : load();
	}

	function area() {
		return cache.area;
	}

	function store() {
		return chrome.storage[cache.area];
	}

	async function get(keys) {
		await ready();
		let query;
		if (keys === null || keys === undefined) {
			query = knownKeys();
		} else if (typeof keys === 'string') {
			query = isKnown(keys) ? [keys] : [];
		} else if (Array.isArray(keys)) {
			query = keys.filter(isKnown);
		} else {
			query = {};
			for (const k of Object.keys(keys)) if (isKnown(k)) query[k] = keys[k];
		}
		return pickKnown(await store().get(query));
	}

	// The whole patch or nothing. Task 2 puts the size pre-check in front of the
	// write; the shape of the answer is fixed here so callers never change.
	async function set(patch) {
		await ready();
		const known = pickKnown(patch);
		const toWrite = { ...known };
		if (cache.area === 'sync') toWrite[FORMAT_KEY] = FORMAT_VERSION;
		try {
			await store().set(toWrite);
			return { ok: true };
		} catch (e) {
			return { ok: false, error: 'write' };
		}
	}

	// Known keys only: this must never be the thing that deletes euIntegration
	// or faviconCache out of storage.local.
	async function remove(keys) {
		await ready();
		const list = (Array.isArray(keys) ? keys : [keys]).filter(isKnown);
		if (list.length) await store().remove(list);
	}

	function onChanged(fn) {
		listeners.add(fn);
		return () => listeners.delete(fn);
	}

	// Pure over the object it is given: the façade caches the AREA, never the
	// settings, so a synchronous usage() with no argument would have nothing to
	// measure.
	function usage(settings) {
		const q = QUOTA[cache.area];
		const branches = {};
		let total = 0;
		for (const [k, v] of Object.entries(settings || {})) {
			if (!isKnown(k)) continue;
			const bytes = entryBytes(k, v);
			branches[k] = bytes;
			total += bytes;
		}
		return { area: cache.area, branches, total, quota: { item: q.item, total: q.total } };
	}

	if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
		chrome.storage.onChanged.addListener((changes, namespace) => {
			// The switch itself, whichever context wrote it.
			if (namespace === 'local' && Object.prototype.hasOwnProperty.call(changes, AREA_KEY)) {
				absorb({ [AREA_KEY]: changes[AREA_KEY].newValue });
			}
			if (namespace !== cache.area) return;
			const known = {};
			for (const k of Object.keys(changes)) {
				if (isKnown(k)) known[k] = changes[k];
			}
			if (!Object.keys(known).length) return;
			for (const fn of listeners) {
				try { fn(known); } catch { /* one listener must not break the others */ }
			}
		});
	}

	load();

	const api = {
		AREA_KEY, NOTE_KEYS, FORMAT_KEY, EU_SYNC_KEY, QUOTA,
		byteLength, entryBytes,
		area, ready, get, set, remove, onChanged, usage,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSettingsStorage = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/settings-storage.test.mjs`
Expected: PASS, all tests. Then `npm test` — everything else still green.

- [ ] **Step 7: Commit**

```bash
git add js/constants.js js/settings-storage.js tests/helpers/fake-chrome-storage.mjs tests/settings-storage.test.mjs
git commit -m "feat(storage): the façade that picks the area, and filters to the known keys"
```

---

## Task 2: The pre-check, and the typed refusal

`set` computes the size the write would produce and refuses instead of writing. In state `sync` this is what the browser would have refused anyway — but *we* say which branch and how many bytes, and nothing is half-written. In state `local` only the total is checked, against 1 MiB.

**Files:**
- Modify: `js/settings-storage.js`
- Test: `tests/settings-storage.test.mjs`

**Interfaces:**
- Consumes: Task 1's `set`, `QUOTA`, `entryBytes`.
- Produces: `set(patch)` resolves `{ ok: false, error: 'branch-full' | 'total-full', branch, bytes, quota, area }` without writing when the check fails. `branch` is the offending key for `branch-full` and `''` for `total-full`. `bytes` is the size that would have resulted, `quota` the ceiling it broke, `area` the area it was checked against. Task 6 turns this into `gestura:storage-full`; Task 11 renders it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/settings-storage.test.mjs`:

```js
// A value that makes `key` weigh exactly `bytes` in storage: the key, two quotes
// and the payload. entryBytes('siteMenus', 'x'.repeat(n)) = 9 + n + 2.
const valueOfSize = (key, bytes) => 'x'.repeat(bytes - key.length - 2);

describe('the pre-check', () => {
	it('refuses at 8193 bytes on a branch in state sync, names it, and writes nothing', async () => {
		const res = await S.set({ theme: 'dark', siteMenus: valueOfSize('siteMenus', 8193) });
		expect(res).toEqual({ ok: false, error: 'branch-full', branch: 'siteMenus', bytes: 8193, quota: 8192, area: 'sync' });
		expect(fake.raw('sync')).not.toHaveProperty('theme');
		expect(fake.raw('sync')).not.toHaveProperty('siteMenus');
	});

	it('accepts exactly 8192 bytes on a branch', async () => {
		expect(await S.set({ siteMenus: valueOfSize('siteMenus', 8192) })).toEqual({ ok: true });
	});

	it('refuses over 102 400 bytes in total in state sync', async () => {
		// Thirteen branches of 8000 bytes are each under the item quota and together
		// over the total. Each is a real key, so the filter keeps them.
		const patch = {};
		const keys = KNOWN.slice(0, 13);
		for (const k of keys) patch[k] = valueOfSize(k, 8000);
		const res = await S.set(patch);
		expect(res.ok).toBe(false);
		expect(res.error).toBe('total-full');
		expect(res.branch).toBe('');
		expect(res.quota).toBe(102400);
		expect(res.bytes).toBeGreaterThan(102400);
		expect(fake.raw('sync')).not.toHaveProperty(keys[0]);
	});

	it('counts what is already stored toward the total', async () => {
		const keys = KNOWN.slice(0, 12);
		const first = {};
		for (const k of keys) first[k] = valueOfSize(k, 8000);
		expect((await S.set(first)).ok).toBe(true);
		// 96 000 stored; one more branch of 8000 tips the total.
		const res = await S.set({ [KNOWN[12]]: valueOfSize(KNOWN[12], 8000) });
		expect(res).toMatchObject({ ok: false, error: 'total-full' });
	});

	it('writes a branch over 8192 bytes without complaint in state local', async () => {
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'local', movedAt: 'x', movedTo: 'local' } });
		expect(await S.set({ siteMenus: valueOfSize('siteMenus', 300000) })).toEqual({ ok: true });
		expect(fake.raw('local').siteMenus).toHaveLength(300000 - 11);
	});

	it('refuses over 1 MiB in total in state local', async () => {
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'local', movedAt: 'x', movedTo: 'local' } });
		const res = await S.set({ siteMenus: valueOfSize('siteMenus', 1024 * 1024 + 1) });
		expect(res).toMatchObject({ ok: false, error: 'total-full', quota: 1024 * 1024, area: 'local' });
		expect(fake.raw('local')).not.toHaveProperty('siteMenus');
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/settings-storage.test.mjs -t "pre-check"`
Expected: FAIL — `set` resolves `{ ok: true }` where a refusal is expected.

- [ ] **Step 3: Add the pre-check to `set`**

In `js/settings-storage.js`, insert before `async function set(patch)`:

```js
	// §6: the size the write would produce, measured the way Chrome measures it,
	// against the ceiling of the active area. In state 'sync' each branch is an
	// item with its own quota; in state 'local' there is no item quota and only the
	// total counts. Reads the store once to know what the untouched keys weigh.
	async function precheck(patch) {
		const q = QUOTA[cache.area];
		if (q.item !== null) {
			for (const [k, v] of Object.entries(patch)) {
				const bytes = entryBytes(k, v);
				if (bytes > q.item) return { ok: false, error: 'branch-full', branch: k, bytes, quota: q.item, area: cache.area };
			}
		}
		const stored = pickKnown(await store().get(knownKeys()));
		const merged = { ...stored, ...patch };
		let total = 0;
		for (const [k, v] of Object.entries(merged)) total += entryBytes(k, v);
		if (cache.area === 'sync') total += entryBytes(FORMAT_KEY, FORMAT_VERSION);
		if (total > q.total) return { ok: false, error: 'total-full', branch: '', bytes: total, quota: q.total, area: cache.area };
		return { ok: true };
	}
```

and change `set` to run it first:

```js
	async function set(patch) {
		await ready();
		const known = pickKnown(patch);
		const check = await precheck(known);
		if (!check.ok) return check;
		const toWrite = { ...known };
		if (cache.area === 'sync') toWrite[FORMAT_KEY] = FORMAT_VERSION;
		try {
			await store().set(toWrite);
			return { ok: true };
		} catch (e) {
			return { ok: false, error: 'write' };
		}
	}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/settings-storage.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/settings-storage.js tests/settings-storage.test.mjs
git commit -m "feat(storage): the pre-check names the branch and writes nothing"
```

---

## Task 3: `switchTo`, both ways, and the note

The one-time copy, in the three-step sequence of §4 (copy → set area → copy again), the note left in `storage.sync`, and the two refusals on the way back.

**Files:**
- Modify: `js/settings-storage.js`
- Test: `tests/settings-storage.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `switchTo(target, reason)` → `Promise<{ ok, error?, branch?, bytes?, quota?, area? }>`; `target` is `'sync' | 'local'`, `reason` is `'local' | 'gestura.eu'` and only read when `target === 'local'`. Errors: `'bad-area'`, `'tier2-enabled'`, `'branch-full'`, `'total-full'`, `'write'`. `note()` → `Promise<{ movedAt, movedTo } | null>`, read from `storage.sync`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/settings-storage.test.mjs`:

```js
describe('switchTo local', () => {
	beforeEach(async () => {
		for (const k of KNOWN) await chrome.storage.sync.set({ [k]: DEFAULTS[k] });
		await chrome.storage.sync.set({ theme: 'dark' });
	});

	it('copies every known key, sets the area with date and reason, and deletes nothing in sync', async () => {
		const before = fake.raw('sync');
		expect(await S.switchTo('local', 'local')).toEqual({ ok: true });
		expect(S.area()).toBe('local');
		for (const k of KNOWN) expect(fake.raw('local')[k]).toEqual(before[k]);
		const area = fake.raw('local')[S.AREA_KEY];
		expect(area.area).toBe('local');
		expect(area.movedTo).toBe('local');
		expect(area.movedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		for (const k of KNOWN) expect(fake.raw('sync')[k]).toEqual(before[k]);
	});

	it('writes the note into storage.sync', async () => {
		await S.switchTo('local', 'gestura.eu');
		const sync = fake.raw('sync');
		expect(sync.syncMovedTo).toBe('gestura.eu');
		expect(sync.syncMovedAt).toBe(fake.raw('local')[S.AREA_KEY].movedAt);
		expect(await S.note()).toEqual({ movedAt: sync.syncMovedAt, movedTo: 'gestura.eu' });
	});

	it('does not copy a foreign key that sits in storage.sync', async () => {
		await chrome.storage.sync.set({ leftover: 1 });
		await S.switchTo('local', 'local');
		expect(fake.raw('local')).not.toHaveProperty('leftover');
	});

	it('picks up a key written into storage.sync during the first copy', async () => {
		// A context still in state 'sync' writes while the copy is in flight - the
		// worker adding a menu, content.js flagging a conflict. The hook lands that
		// write inside the first local.set(), before the area changes.
		fake.hooks.onSet = async (name) => {
			if (name === 'local') await chrome.storage.sync.set({ edgeGestureConflict: true });
		};
		await S.switchTo('local', 'local');
		expect(fake.raw('local').edgeGestureConflict).toBe(true);
	});

	it('is a no-op when already local', async () => {
		await S.switchTo('local', 'local');
		const movedAt = fake.raw('local')[S.AREA_KEY].movedAt;
		expect(await S.switchTo('local', 'gestura.eu')).toEqual({ ok: true });
		expect(fake.raw('local')[S.AREA_KEY].movedAt).toBe(movedAt);
	});

	it('refuses an unknown area', async () => {
		expect(await S.switchTo('session')).toEqual({ ok: false, error: 'bad-area' });
	});
});

describe('switchTo sync', () => {
	beforeEach(async () => {
		for (const k of KNOWN) await chrome.storage.sync.set({ [k]: DEFAULTS[k] });
		await S.switchTo('local', 'local');
	});

	it('is refused while a branch exceeds 8192 bytes, naming it', async () => {
		await S.set({ siteMenus: valueOfSize('siteMenus', 300000) });
		const res = await S.switchTo('sync');
		expect(res).toEqual({ ok: false, error: 'branch-full', branch: 'siteMenus', bytes: 300000, quota: 8192, area: 'sync' });
		expect(S.area()).toBe('local');
		expect(fake.raw('sync').syncMovedAt).toBeDefined();
	});

	it('is refused while the total exceeds 102 400 bytes', async () => {
		const patch = {};
		for (const k of KNOWN.slice(0, 13)) patch[k] = valueOfSize(k, 8000);
		await S.set(patch);
		expect(await S.switchTo('sync')).toMatchObject({ ok: false, error: 'total-full', quota: 102400 });
	});

	it('is refused while tier 2 is enabled, naming it', async () => {
		await chrome.storage.local.set({ [S.EU_SYNC_KEY]: { enabled: true, consent: { version: 1, date: 'x' }, secret: 'GS1-…', states: {} } });
		expect(await S.switchTo('sync')).toEqual({ ok: false, error: 'tier2-enabled' });
		expect(S.area()).toBe('local');
	});

	it('clears the note and writes every key when the data fits', async () => {
		await S.set({ theme: 'dark' });
		expect(await S.switchTo('sync')).toEqual({ ok: true });
		expect(S.area()).toBe('sync');
		const sync = fake.raw('sync');
		expect(sync).not.toHaveProperty('syncMovedAt');
		expect(sync).not.toHaveProperty('syncMovedTo');
		expect(sync.theme).toBe('dark');
		expect(sync[S.FORMAT_KEY]).toBe(1);
		expect(fake.raw('local')[S.AREA_KEY]).toEqual({ area: 'sync', movedAt: '', movedTo: '' });
		expect(await S.note()).toBe(null);
	});

	it('leaves the local copy in place', async () => {
		await S.set({ theme: 'dark' });
		await S.switchTo('sync');
		expect(fake.raw('local').theme).toBe('dark');
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/settings-storage.test.mjs -t "switchTo"`
Expected: FAIL — `S.switchTo is not a function`.

- [ ] **Step 3: Implement `switchTo` and `note`**

In `js/settings-storage.js`, insert before the `chrome.storage.onChanged.addListener` block:

```js
	async function writeArea(next) {
		await chrome.storage.local.set({ [AREA_KEY]: next });
		absorb({ [AREA_KEY]: next });
	}

	// One copy sync → local of the known keys. Returns what it wrote, so the
	// second pass can write only what changed since.
	async function copySyncToLocal(previous) {
		const items = pickKnown(await chrome.storage.sync.get(knownKeys()));
		const patch = {};
		for (const [k, v] of Object.entries(items)) {
			if (!previous || JSON.stringify(previous[k]) !== JSON.stringify(v)) patch[k] = v;
		}
		if (Object.keys(patch).length) await chrome.storage.local.set(patch);
		return items;
	}

	// §4. Not atomic, and the sequence is what makes that harmless: copy, set the
	// area, copy AGAIN. The second pass picks up whatever a context still in state
	// 'sync' wrote during the first - and writes only those keys, so it cannot
	// clobber a write a context already in state 'local' made in the meantime.
	// What remains is the latency of one onChanged delivery; named in the spec so
	// nobody tries to close it with a lock.
	//
	// The way back is conditional: every branch must fit its item quota and the
	// whole set the total, and tier 2 must be off. Refused with numbers, never
	// silent. The stale copies are never deleted in either direction (§10.1).
	async function switchTo(target, reason) {
		await ready();
		if (target !== 'sync' && target !== 'local') return { ok: false, error: 'bad-area' };
		if (target === cache.area) return { ok: true };
		try {
			if (target === 'local') {
				const movedTo = reason === 'gestura.eu' ? 'gestura.eu' : 'local';
				const movedAt = new Date().toISOString();
				const first = await copySyncToLocal(null);
				await writeArea({ area: 'local', movedAt, movedTo });
				await copySyncToLocal(first);
				await chrome.storage.sync.set({ [NOTE_KEYS[0]]: movedAt, [NOTE_KEYS[1]]: movedTo });
				return { ok: true };
			}
			const eu = await chrome.storage.local.get(EU_SYNC_KEY);
			if (eu[EU_SYNC_KEY] && eu[EU_SYNC_KEY].enabled === true) return { ok: false, error: 'tier2-enabled' };
			const items = pickKnown(await chrome.storage.local.get(knownKeys()));
			const q = QUOTA.sync;
			let total = entryBytes(FORMAT_KEY, FORMAT_VERSION);
			for (const [k, v] of Object.entries(items)) {
				const bytes = entryBytes(k, v);
				total += bytes;
				if (bytes > q.item) return { ok: false, error: 'branch-full', branch: k, bytes, quota: q.item, area: 'sync' };
			}
			if (total > q.total) return { ok: false, error: 'total-full', branch: '', bytes: total, quota: q.total, area: 'sync' };
			await chrome.storage.sync.remove(NOTE_KEYS);
			await chrome.storage.sync.set({ ...items, [FORMAT_KEY]: FORMAT_VERSION });
			await writeArea({ area: 'sync', movedAt: '', movedTo: '' });
			return { ok: true };
		} catch (e) {
			return { ok: false, error: 'write' };
		}
	}

	// The note another browser left (§4). Only meaningful in state 'sync'; the
	// options page asks and shows one line.
	async function note() {
		const items = await chrome.storage.sync.get(NOTE_KEYS);
		const movedAt = items[NOTE_KEYS[0]];
		if (typeof movedAt !== 'string' || !movedAt) return null;
		return { movedAt, movedTo: items[NOTE_KEYS[1]] === 'gestura.eu' ? 'gestura.eu' : 'local' };
	}
```

Add `switchTo, note` to the `api` object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/settings-storage.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/settings-storage.js tests/settings-storage.test.mjs
git commit -m "feat(storage): the switch, in three steps, and the note it leaves behind"
```

---

## Task 4: Registration, and the service worker

The façade goes into the two load-ordered lists nothing checks, and into the seven pages; then `js/background.js` is rewired. The test in `tests/page-content-deps.test.mjs` is extended first so the page ordering is enforced, not remembered.

**Files:**
- Modify: `manifest.json` (`content_scripts[0].js`)
- Modify: `js/background.js:1-7` (imports), `:931-934`, `:1543` (comment), `:1919`, `:2129-2136`, `:2146`, `:2155-2160`, `:2167-2203`, `:2206-2210`, `:2215-2239`, `:2243-2254`
- Modify: `pages/options.html`, `pages/popup.html`, `pages/css-editor.html`, `pages/tutorial.html`, `pages/about.html`, `pages/permission.html`, `pages/context-menu.html`
- Test: `tests/page-content-deps.test.mjs`

**Interfaces:**
- Consumes: `self.GesturaSettingsStorage.get / set / onChanged` (Tasks 1–3).
- Produces: nothing new. After this task the worker and all pages *load* the façade; content and page scripts are rewired in Task 5.

- [ ] **Step 1: Extend the page test**

In `tests/page-content-deps.test.mjs`, add `'settings-storage.js'` to `REQUIRED_BEFORE_CONTENT` directly after `'constants.js'`, and append this block at the end of the file:

```js
// The façade needs DEFAULT_SETTINGS, and i18n.js reads theme and language THROUGH
// the façade at load time (js/i18n.js: `initPromise = init()` runs synchronously up
// to its first await, which is that read). So on every page that loads i18n.js the
// order is constants.js → settings-storage.js → i18n.js. Nothing in the browser
// says so - a wrong order is an exception in the console and an unstyled page.
const i18nPages = pages.filter(f =>
	scriptSrcOrder(readFileSync(join(pagesDir, f), 'utf8')).includes('i18n.js'));

describe('extension pages that load i18n.js', () => {
	it('finds at least one such page', () => {
		expect(i18nPages.length).toBeGreaterThan(0);
	});

	for (const page of i18nPages) {
		it(`${page} loads constants.js, then settings-storage.js, then i18n.js`, () => {
			const scripts = scriptSrcOrder(readFileSync(join(pagesDir, page), 'utf8'));
			const c = scripts.indexOf('constants.js');
			const s = scripts.indexOf('settings-storage.js');
			const i = scripts.indexOf('i18n.js');
			expect(c, `${page} is missing constants.js`).toBeGreaterThanOrEqual(0);
			expect(s, `${page} is missing settings-storage.js`).toBeGreaterThanOrEqual(0);
			expect(c).toBeLessThan(s);
			expect(s).toBeLessThan(i);
		});
	}
});
```

Run: `npx vitest run tests/page-content-deps.test.mjs`
Expected: FAIL for every page — none loads `settings-storage.js` yet, and `i18n.js` precedes `constants.js` everywhere.

- [ ] **Step 2: Register the façade in the manifest**

In `manifest.json`, `content_scripts[0].js`, insert `"js/settings-storage.js"` directly after `"js/constants.js"`:

```json
			"js": [
				"js/constants.js",
				"js/settings-storage.js",
				"js/eu-integration.js",
```

(Only the numeric `version` is ever edited in this file; `version_name` is generated. This task does not touch either.)

- [ ] **Step 3: Register the façade in the seven pages**

In each page, the scripts become `constants.js` → `settings-storage.js` → `i18n.js`, with everything else in its existing position.

`pages/options.html` lines 24–25 become:

```html
	<script src="../js/constants.js"></script>
	<script src="../js/settings-storage.js"></script>
	<script src="../js/i18n.js"></script>
```

`pages/popup.html` lines 42–43, `pages/css-editor.html` lines 25–26, `pages/about.html` lines 24–25, `pages/tutorial.html` lines 1203–1204: the same three lines in place of the two.

`pages/permission.html` line 34 becomes:

```html
	<script src="../js/constants.js"></script>
	<script src="../js/settings-storage.js"></script>
	<script src="../js/i18n.js"></script>
```

`pages/context-menu.html` line 15 becomes:

```html
	<script src="../js/constants.js"></script>
	<script src="../js/settings-storage.js"></script>
	<script src="../js/menu-icons.js"></script>
```

(`context-menu.html` does not load `i18n.js`; `js/context-menu.js` is an ES module that reads `customCss` and gets the façade from the window.)

Run: `npx vitest run tests/page-content-deps.test.mjs`
Expected: PASS.

- [ ] **Step 4: Import the façade into the worker and comment the migration block**

In `js/background.js`, the first two lines become:

```js
importScripts('constants.js');
importScripts('settings-storage.js');
importScripts('menu-patterns.js');
```

Directly above `if (details.reason === 'update' && details.previousVersion) {` (line 1543) insert:

```js
	// Deliberately on chrome.storage.sync, not the façade. Everything in this
	// block migrates keys that predate the storage move (`gestures`,
	// `customGestures`, `scrollAmount`, `enableAdvancedSettings`, `includeTitle`),
	// and such data can only exist in storage.sync: a browser in state 'local' was
	// created by a Gestura that had already run these. The façade would also drop
	// the legacy keys as unknown and the migrations would silently do nothing.
```

- [ ] **Step 5: Rewire the worker's call sites**

Every remaining `chrome.storage.sync.get/set` in `js/background.js` outside the update block goes onto the façade. Reference the global `GesturaSettingsStorage` directly, the way the file already references `GesturaEuLocal` — no local alias.

Line 931–934 (`addSiteToMenu`):

```js
			const cur = (await GesturaSettingsStorage.get(['siteMenus'])).siteMenus || {};
			const { siteMenus, added } = self.FlowMouseMenuModel.addPatternToMenu(
				self.FlowMouseMenuCatalog.SITE_MENU_CATALOG, cur, menuId, pattern);
			if (added) await GesturaSettingsStorage.set({ siteMenus });
```

Line 1919 (`updateMenuForTab`):

```js
	const items = await GesturaSettingsStorage.get(['showRestrictedNotice', 'blacklist', 'enableBlacklistContextMenu', 'enableBlacklist', 'enableSiteMenus', 'enableContextMenu', 'ctxMenuAddSite', 'ctxMenuAssignSite', 'ctxMenuSiteMenu', 'ctxMenuSiteMenuMode', 'ctxMenuSiteMenuId', 'ctxMenuOptions', 'siteMenuAddAsk', 'siteMenus']);
```

Lines 2129 and 2136 (blacklist toggle):

```js
				const storageItems = await GesturaSettingsStorage.get(['blacklist']);
```
```js
				await GesturaSettingsStorage.set({ blacklist });
```

Line 2146:

```js
		const cfg = await GesturaSettingsStorage.get(['ctxMenuSiteMenuMode', 'ctxMenuSiteMenuId']);
```

Lines 2155 and 2160 (remove link):

```js
		const cur = (await GesturaSettingsStorage.get(['siteMenus'])).siteMenus || {};
```
```js
		await GesturaSettingsStorage.set({ siteMenus });
```

Lines 2167 and 2203 (add link) — the same two replacements. Lines 2206 and 2210 (assign clear):

```js
		const cur = await GesturaSettingsStorage.get(['siteMenus']);
```
```js
		await GesturaSettingsStorage.set({ siteMenus });
```

Lines 2215 and 2239 (assign) — the same two replacements.

Lines 2243–2254, the listener, become:

```js
GesturaSettingsStorage.onChanged((changes) => {
	if (changes.showRestrictedNotice || changes.language || changes.enableBlacklistContextMenu || changes.blacklist || changes.enableBlacklist ||
		changes.enableSiteMenus || changes.enableContextMenu || changes.ctxMenuAddSite || changes.ctxMenuAssignSite || changes.ctxMenuSiteMenu ||
		changes.ctxMenuSiteMenuMode || changes.ctxMenuSiteMenuId || changes.ctxMenuOptions || changes.siteMenuAddAsk || changes.siteMenus) {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			if (tabs[0]) {
				updateMenuForTab(tabs[0]);
			}
		});
	}
});
```

- [ ] **Step 6: Verify nothing is left**

Run:

```bash
grep -n "chrome.storage.sync\.\(get\|set\|remove\|clear\)" js/background.js
```

Expected: only lines inside the `details.reason === 'update'` block (between the new comment and the block's closing brace, roughly 1545–1715). Anything else is a miss.

Load the unpacked extension at `chrome://extensions`, reload it, open the service worker console: no `ReferenceError`. Right-click a page → the Gestura context menu still appears; add the site to a menu → the options page shows it.

- [ ] **Step 7: Note the Firefox mirror**

Nothing to do on this branch. **At the next merge of `main` into `firefox-build`**, `background.scripts` in that manifest must gain `"js/constants.js", "js/settings-storage.js"` as its first two entries, mirroring Step 4. Firefox has no `importScripts`; a missing entry is `GesturaSettingsStorage is not defined` on the first context-menu click, and no test catches it. Record this in the merge commit message.

- [ ] **Step 8: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add manifest.json js/background.js pages/options.html pages/popup.html pages/css-editor.html pages/tutorial.html pages/about.html pages/permission.html pages/context-menu.html tests/page-content-deps.test.mjs
git commit -m "feat(storage): register the façade, and move the service worker onto it"
```

---

## Task 5: Content scripts and page scripts

`js/content.js`, `js/eu-bridge.js`, `js/i18n.js`, `js/context-menu.js`, `js/tutorial.js`. All callback-style `chrome.storage.sync.get(keys, cb)` calls become `.then(cb)`, the `chrome.runtime.lastError` checks become `.catch`, and the two `content.js` listeners go onto `onChanged`.

**Files:**
- Modify: `js/content.js:2112-2121`, `:2125-2145`, `:2343-2347`, `:2417-2424`, `:2759`, `:2850`, `:3465`, `:3989`
- Modify: `js/eu-bridge.js:60`
- Modify: `js/i18n.js:276`
- Modify: `js/context-menu.js:335`
- Modify: `js/tutorial.js:270`

**Interfaces:**
- Consumes: `window.GesturaSettingsStorage.get / set / onChanged`.
- Produces: nothing new.

- [ ] **Step 1: `content.js` — the blacklist read and its listener**

Lines 2112–2121 become:

```js
	window.GesturaSettingsStorage.get({ blacklist: [], enableBlacklist: true }).then((items) => {
		blacklistFeatureEnabled = items.enableBlacklist !== false;
		currentBlacklist = items.blacklist || [];
		isBlacklisted = checkBlacklist(currentBlacklist);
		if (!isBlacklisted) {
			initGestures();
		}
	}).catch((e) => console.error(e));
```

Lines 2125–2126 (`chrome.storage.onChanged.addListener((changes, namespace) => {` and `if (namespace === 'sync') {`) become one line, and the matching closing brace of the `if` is removed so the body de-indents by one level:

```js
	window.GesturaSettingsStorage.onChanged((changes) => {
		if (changes.blacklist || changes.enableBlacklist) {
```

- [ ] **Step 2: `content.js` — `loadSettings` and its listener**

Line 2343–2347 become:

```js
			window.GesturaSettingsStorage.get(null).then(async (items) => {
				if (items) {
```

and the callback's closing `});` at the end of `loadSettings` gains a catch:

```js
			}).catch((e) => console.error(e));
```

Lines 2417–2424 become:

```js
		window.GesturaSettingsStorage.onChanged((changes) => {
			const keys = Object.keys(changes);
			if (keys.length === 1 && keys[0] === 'blacklist') return;

			loadSettings();
		});
```

- [ ] **Step 3: `content.js` — the four flag writes**

Line 2759 and line 2850:

```js
					try { window.GesturaSettingsStorage.set({ macLinuxHintDismissed: true }).catch(() => {}); } catch (e) {}
```

Line 3465:

```js
						try { window.GesturaSettingsStorage.set({ edgeGestureConflict: true }).catch(() => {}); } catch (e) { }
```

Line 3989:

```js
				try { window.GesturaSettingsStorage.set({ edgeGestureConflict: false }).catch(() => {}); } catch (e) { }
```

(The outer `try` stays: `set` can throw synchronously when the extension context has been invalidated by a reload, which is what the original guarded against.)

- [ ] **Step 4: `eu-bridge.js`**

Line 60:

```js
			const settings = await self.GesturaSettingsStorage.get(['siteMenus', 'searchEngines']);
```

- [ ] **Step 5: `i18n.js`**

Line 276:

```js
		const items = await window.GesturaSettingsStorage.get({ language: 'auto', theme: 'auto' });
```

- [ ] **Step 6: `context-menu.js` and `tutorial.js`**

`js/context-menu.js` line 335:

```js
			const { customCss } = await window.GesturaSettingsStorage.get({ customCss: '' });
```

`js/tutorial.js` line 270:

```js
						try { window.GesturaSettingsStorage.set({ macLinuxHintDismissed: true }).catch(() => {}); } catch (e) {}
```

- [ ] **Step 7: Verify nothing is left**

Run:

```bash
grep -rn "chrome.storage.sync\.\(get\|set\|remove\|clear\)" js/ --include=*.js | grep -v "js/lib/" | grep -v "js/background.js" | grep -v "js/settings-storage.js" | grep -v "js/settings-store.js"
```

Expected: only comments (two in `js/components/options-page.js`, which Task 6 rewrites). Then `grep -rn "storage.onChanged" js/content.js` — no direct listener left.

Reload the extension. Open any page: gestures work; toggle "Enable blacklist" in the options → the page reacts without reload. Open the tutorial and the popup: both render, no console error. Open `pages/permission.html` via a permission request (e.g. a bookmark action): themed, translated.

- [ ] **Step 8: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add js/content.js js/eu-bridge.js js/i18n.js js/context-menu.js js/tutorial.js
git commit -m "feat(storage): the content scripts and the page scripts go through the façade"
```

---

## Task 6: `SettingsStore` on the façade

The pages' ES module keeps everything it does — normalisation, the rollback, the change listeners — and delegates storage. `save()` returns the façade's result, `reset()` writes the defaults as values, and the 13 callers read `.ok`.

**Files:**
- Modify: `js/settings-store.js`
- Modify: `js/components/options-page.js:324-330`, `:1580-1586`, `:1698-1702`, `:1710`, and the two comments at `:292-296`, `:1371-1376`
- Modify: `js/components/site-menu-manager.js:163-164`, `:374-375`
- Modify: `js/components/menu-import-dialog.js:353-358`
- Modify: `js/components/popup-page.js:610-611`
- Modify: `js/components/css-editor-page.js:432-438`
- Test: `tests/settings-store.test.mjs`

**Interfaces:**
- Consumes: `window.GesturaSettingsStorage` (Tasks 1–3).
- Produces: `settingsStore.save(patch)` → `Promise<{ ok, error?, branch?, bytes?, quota?, area? }>`; `settingsStore.reset()` → the same shape; `export function isStorageFull(res)`; `export { reorderMouseGestures, normalizeSetting }` for Task 7's tests; the window event `gestura:storage-full` with `detail` = the failure (Task 11 renders it).

- [ ] **Step 1: Write the failing tests**

Create `tests/settings-store.test.mjs`:

```js
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { fakeChromeStorage } from './helpers/fake-chrome-storage.mjs';

const fake = fakeChromeStorage();
globalThis.chrome = fake.chrome;
globalThis.window = globalThis;
// The store dispatches window events after a save; Node's globalThis has none.
const events = [];
globalThis.dispatchEvent = (e) => { events.push(e); return true; };

let S, store, mod, DEFAULTS;

beforeAll(async () => {
	await import('../js/constants.js');
	await import('../js/settings-storage.js');
	S = globalThis.GesturaSettingsStorage;
	DEFAULTS = globalThis.GestureConstants.DEFAULT_SETTINGS;
	// The singleton reads storage once, at import. Seed a stored value first so the
	// load path is exercised with data, not just defaults.
	await chrome.storage.sync.set({ theme: 'dark', mouseGestures: 'not an object' });
	mod = await import('../js/settings-store.js');
	store = mod.settingsStore;
	await store.waitForLoad();
});

beforeEach(() => { events.length = 0; });

describe('load', () => {
	it('layers stored values over the defaults', () => {
		expect(store.current.theme).toBe('dark');
		expect(store.current.trailWidth).toBe(DEFAULTS.trailWidth);
	});

	// 10.4 and 10.1 together: `p in storedMG` used to throw for a string, inside
	// the load promise, which then never resolved and the options page never
	// rendered. On load the shape guard of 10.1 sees the string first and keeps
	// the default standing; Task 7 tests reorderMouseGestures on its own.
	it('survives a mouseGestures value that is not an object', () => {
		expect(store.current.mouseGestures).toEqual(DEFAULTS.mouseGestures);
	});
});

describe('save', () => {
	it('returns the façade result and writes the whole object', async () => {
		const res = await store.save({ trailWidth: 7 });
		expect(res).toEqual({ ok: true });
		expect(fake.raw('sync').trailWidth).toBe(7);
		expect(fake.raw('sync').theme).toBe('dark');
		expect(events.some(e => e.type === 'gestura:settings-saved')).toBe(true);
	});

	it('rolls back and reports a typed refusal without writing', async () => {
		const before = fake.raw('sync').siteMenus;
		const res = await store.save({ siteMenus: 'x'.repeat(9000) });
		expect(res).toMatchObject({ ok: false, error: 'branch-full', branch: 'siteMenus' });
		expect(mod.isStorageFull(res)).toBe(true);
		expect(store.current.siteMenus).toEqual(before ?? DEFAULTS.siteMenus);
		expect(fake.raw('sync').siteMenus).toEqual(before);
		const full = events.find(e => e.type === 'gestura:storage-full');
		expect(full).toBeDefined();
		expect(full.detail.error).toBe('branch-full');
	});

	it('isStorageFull is false for a write error and for success', () => {
		expect(mod.isStorageFull({ ok: false, error: 'write' })).toBe(false);
		expect(mod.isStorageFull({ ok: true })).toBe(false);
		expect(mod.isStorageFull(undefined)).toBe(false);
	});
});

describe('reset', () => {
	it('writes DEFAULT_SETTINGS as values in state sync and clears nothing', async () => {
		await store.save({ trailWidth: 7 });
		await chrome.storage.sync.set({ syncMovedAt: '2026-09-04T00:00:00.000Z' });
		expect(await store.reset()).toEqual({ ok: true });
		expect(fake.raw('sync').trailWidth).toBe(DEFAULTS.trailWidth);
		expect(fake.raw('sync').theme).toBe(DEFAULTS.theme);
		expect(fake.raw('sync').syncMovedAt).toBe('2026-09-04T00:00:00.000Z');
		expect(store.current).toEqual(DEFAULTS);
	});

	it('leaves the neighbours in storage.local untouched in state local', async () => {
		await chrome.storage.local.set({
			euIntegration: { enabled: true },
			euSync: { enabled: false, consent: null, secret: '', states: {} },
			faviconCache: { 'https://a': { icon: null, ts: 1 } },
		});
		await S.switchTo('local', 'local');
		await store.save({ trailWidth: 7 });
		expect(await store.reset()).toEqual({ ok: true });
		const local = fake.raw('local');
		expect(local.trailWidth).toBe(DEFAULTS.trailWidth);
		expect(local.euIntegration).toEqual({ enabled: true });
		expect(local.euSync).toEqual({ enabled: false, consent: null, secret: '', states: {} });
		expect(local.faviconCache).toEqual({ 'https://a': { icon: null, ts: 1 } });
		expect(local[S.AREA_KEY].area).toBe('local');
		await S.switchTo('sync');
	});
});

describe('external changes', () => {
	// 10.2: in state local the neighbour is faviconCache. The façade filters it,
	// so it never reaches #current and is never written back on the next save.
	it('never lets faviconCache into #current', async () => {
		await S.switchTo('local', 'local');
		await chrome.storage.local.set({ faviconCache: { 'https://a': { icon: null, ts: 1 } } });
		expect(store.current).not.toHaveProperty('faviconCache');
		await store.save({ trailWidth: 3 });
		expect(store.current).not.toHaveProperty('faviconCache');
		await S.switchTo('sync');
	});

	it('notifies listeners of a change from the other side with the normalised value', async () => {
		const seen = [];
		const off = store.onChange((changed) => seen.push(changed));
		await chrome.storage.sync.set({ wheelGestures: { '↑': { action: 'back' } } });
		off();
		expect(seen).toHaveLength(1);
		expect(seen[0].wheelGestures['↑']).toEqual({ action: 'back' });
		// normalizeSetting mixes the defaults under a partial wheelGestures.
		for (const k of Object.keys(DEFAULTS.wheelGestures)) expect(store.current.wheelGestures).toHaveProperty(k);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/settings-store.test.mjs`
Expected: FAIL — the store still calls `chrome.storage.sync.get(DEFAULT_SETTINGS, cb)` (the fake's `get` returns a promise and ignores the callback, so `waitForLoad()` never resolves and the suite times out). Stop it after the first failure; that is the expected shape.

- [ ] **Step 3: Rewrite `js/settings-store.js`**

Replace the file's contents:

```js
const { DEFAULT_SETTINGS } = window.GestureConstants;
const Storage = window.GesturaSettingsStorage;

// 10.4: storage can hold anything. `p in storedMG` throws for a string or a
// number - inside the load promise, which then never resolves. A non-object is
// "nothing stored", which is what the normalisation already does with {}.
export function reorderMouseGestures(storedMG) {
	if (!storedMG || typeof storedMG !== 'object' || Array.isArray(storedMG)) return {};
	const defaultOrder = Object.keys(DEFAULT_SETTINGS.mouseGestures || {});
	const ordered = {};
	for (const p of defaultOrder) {
		if (p in storedMG) ordered[p] = storedMG[p];
	}
	for (const p of Object.keys(storedMG)) {
		if (!(p in ordered)) ordered[p] = storedMG[p];
	}
	return ordered;
}

export function normalizeSetting(key, value) {
	if (key === 'mouseGestures' && value) {
		return reorderMouseGestures(value);
	}
	if (key === 'wheelGestures' && value) {
		return {
			...structuredClone(DEFAULT_SETTINGS.wheelGestures || {}),
			...value,
		};
	}
	if (key === 'specialGestures' && value) {
		return {
			...structuredClone(DEFAULT_SETTINGS.specialGestures || {}),
			...value,
		};
	}
	// Gespeicherte siteMenus aus aelteren Staenden kennen neue Felder
	// (flags, defaultMenuId) nicht - Defaults untermischen.
	if (key === 'siteMenus' && value) {
		return {
			...structuredClone(DEFAULT_SETTINGS.siteMenus || {}),
			...value,
		};
	}
	return value;
}

function deepEqual(obj1, obj2) {
	if (obj1 === obj2) return true;
	if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
		return false;
	}
	if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;
	const keys1 = Object.keys(obj1);
	const keys2 = Object.keys(obj2);
	if (keys1.length !== keys2.length) return false;
	for (const key of keys1) {
		if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
			return false;
		}
	}
	return true;
}

// The shape test of js/eu-settings-schema.js, copied for the same reason the
// façade copies the byte formula: this module runs in the popup, where the
// schema is not loaded. Object vs array vs primitive type, against the default.
function sameShape(value, def) {
	if (Array.isArray(def)) return Array.isArray(value);
	if (def === null) return true;
	if (typeof def === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
	return typeof value === typeof def;
}

// The typed refusal the façade returns when a write would not fit. The options
// page turns it into the dialog with the three ways out; every other caller
// skips its own generic message when this is true, so the user sees one answer.
export function isStorageFull(res) {
	return !!res && (res.error === 'branch-full' || res.error === 'total-full');
}

function emit(name, detail) {
	if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
	window.dispatchEvent(new CustomEvent(name, { detail }));
}

class SettingsStore {
	#current = structuredClone(DEFAULT_SETTINGS);
	#listeners = [];
	#listening = false;
	#resetting = false;
	#loaded = false;
	#loadPromise = null;

	constructor() {
		this.#loadPromise = this.#load();
	}

	get current() { this.#assertLoaded(); return this.#current; }

	async waitForLoad() {
		return await this.#loadPromise;
	}

	#assertLoaded() {
		if (!this.#loaded) throw new Error('SettingsStore not initialized');
	}

	async #load() {
		if (!this.#listening) {
			Storage.onChanged((changes) => this.handleExternalChange(changes));
			this.#listening = true;
		}
		const items = await Storage.get(DEFAULT_SETTINGS);
		this.#current = structuredClone(DEFAULT_SETTINGS);
		for (const [key, value] of Object.entries(items)) {
			// 10.1, on load: a stored value whose shape the reader does not
			// recognise leaves the default standing rather than being spread into
			// it. Nothing is written back - the value stays in storage for a
			// reader that does recognise it.
			if (sameShape(value, DEFAULT_SETTINGS[key])) this.#current[key] = value;
		}
		for (const key of ['mouseGestures', 'wheelGestures', 'specialGestures', 'siteMenus']) {
			this.#current[key] = normalizeSetting(key, this.#current[key]);
		}
		this.#loaded = true;
		return this.#current;
	}

	async save(patch = {}) {
		this.#assertLoaded();
		const now = new Date().toISOString();
		// Snapshot what a failed write would otherwise leave mutated: patched keys
		// plus lastSyncTime, which every save touches. A refused or failed write
		// must be a no-op on #current, or a retried save (e.g. after re-editing a
		// selection) sees data from the failed attempt as if it had already landed.
		const previous = {};
		for (const key of Object.keys(patch)) previous[key] = this.#current[key];
		previous.lastSyncTime = this.#current.lastSyncTime;
		Object.assign(this.#current, patch, { lastSyncTime: now });

		const res = await Storage.set(this.#current);
		if (res.ok) {
			// onChange() fires for EXTERNAL changes only - by design, so a component
			// does not react to its own write. The sync panel needs the other half:
			// its "changed since last upload" hint has to notice a save made on this
			// very page. A window event carries that without changing what onChange
			// means to its existing listeners.
			emit('gestura:settings-saved');
			return res;
		}
		if (res.error === 'write') console.error('Settings save failed:', res);
		for (const key of Object.keys(previous)) this.#current[key] = previous[key];
		if (isStorageFull(res)) emit('gestura:storage-full', res);
		return res;
	}

	// The defaults written as VALUES, not a clear(): a clear would take
	// euIntegration, euSync, settingsArea and faviconCache with it in state
	// 'local', and in state 'sync' a removed key is what makes another browser
	// fall back to its defaults (10.1) - which is exactly the propagation a reset
	// wants, and which writing the values achieves through what is there rather
	// than through what is missing. This is the upstream v2.3.1 behaviour.
	async reset() {
		this.#assertLoaded();
		this.#resetting = true;
		try {
			const res = await Storage.set(structuredClone(DEFAULT_SETTINGS));
			if (res.ok) this.#current = structuredClone(DEFAULT_SETTINGS);
			return res;
		} finally {
			this.#resetting = false;
		}
	}

	handleExternalChange(changes) {
		if (!this.#loaded || this.#resetting) return { changed: {}, hasChange: false };
		let changed = {};
		let hasChange = false;

		for (const [key, storageChange] of Object.entries(changes)) {
			// 10.1: absence is not "default". A key missing from an external change,
			// or a value whose shape this reader does not recognise, leaves the
			// local copy standing. Reset propagates by writing the defaults as
			// values, so nothing legitimate is lost here - and a future change of
			// what storage.sync holds cannot wipe an older Gestura's settings.
			const newValue = storageChange.newValue;
			if (newValue === undefined || !(key in DEFAULT_SETTINGS) || !sameShape(newValue, DEFAULT_SETTINGS[key])) continue;

			const normalized = normalizeSetting(key, newValue);
			if (!deepEqual(this.#current[key], normalized)) {
				this.#current[key] = normalized;
				changed[key] = normalized;
				hasChange = true;
			}
		}

		if (hasChange) this.#notifyExternal(changed);
		return { changed, hasChange };
	}

	onChange(fn) {
		this.#listeners.push(fn);
		return () => {
			const i = this.#listeners.indexOf(fn);
			if (i >= 0) this.#listeners.splice(i, 1);
		};
	}

	#notifyExternal(changed) {
		this.#listeners.forEach(fn => fn(changed, this.#current));
	}
}

export const settingsStore = new SettingsStore();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/settings-store.test.mjs`
Expected: PASS.

- [ ] **Step 5: The callers read `.ok`**

`js/components/options-page.js` lines 324–330:

```js
		this._store.save(patch).then((res) => {
			if (!res.ok) {
				if (!isStorageFull(res)) this.#showStatus(window.i18n.getMessage('saveFailure'), 'error');
				return;
			}
			this._settings = { ...this._store.current, ...(this._pendingPatch || {}) };
		});
```

Lines 1580–1586:

```js
		const res = await this._store.save(patch);
		if (!res.ok) {
			if (!isStorageFull(res)) this.#showStatus(window.i18n.getMessage('saveFailure'), 'error');
			return false;
		}
```

Lines 1698–1702 (`#applySettings`):

```js
		const res = await this._store.save(settings);
		if (!res.ok) {
			if (!isStorageFull(res)) this.#showStatus(window.i18n.getMessage('importFailedSyncError'), 'error');
			return false;
		}
```

Line 1710 (`#resetSettings`):

```js
			const res = await this._store.reset();
			if (!res.ok) { this.#showStatus(window.i18n.getMessage('saveFailure'), 'error'); return; }
```

Line 1 of `options-page.js` becomes `import { settingsStore, isStorageFull } from '../settings-store.js';`. Rewrite the two comments at lines 292–296 and 1371–1376 to say "before the façade's `set()` fires" instead of `chrome.storage.sync.set()`.

`js/components/site-menu-manager.js` line 163–164:

```js
		const res = await settingsStore.save({ siteMenus: next });
		if (!res.ok && !isStorageFull(res)) alert(window.i18n.getMessage('menuSyncSaveError'));
```

Line 374–375:

```js
		const res = await settingsStore.save({ menuAppend: next });
		if (!res.ok && !isStorageFull(res)) alert(window.i18n.getMessage('menuSyncSaveError'));
```

Extend its import: `import { settingsStore, isStorageFull } from '../settings-store.js';`.

`js/components/menu-import-dialog.js` line 353–358:

```js
		const res = await settingsStore.save(withBaselines);
		if (!res.ok) {
			if (!isStorageFull(res)) alert(window.i18n.getMessage('menuSyncSaveError'));
			this.#reportToPage('failed', []);
			return;
		}
```

Extend its import the same way.

`js/components/popup-page.js` line 610–611:

```js
		const res = await this._store.save({ blacklist: this._blacklist });
		if (!res.ok) {
```

`js/components/css-editor-page.js` line 432–438:

```js
		const res = await settingsStore.save({ customCss: this._css });
		if (res.ok) {
			this._savedCss = this._css;
			this.#showStatus(window.i18n.getMessage('customCssEditorSaved'), 'success');
		} else {
			this.#showStatus(isStorageFull(res) ? window.i18n.getMessage('storageFullHint') : 'Save failed', 'error');
		}
```

Extend its import: `import { settingsStore, isStorageFull } from '../settings-store.js';`. (`storageFullHint` is added in Task 11 with the other keys; until then `getMessage` returns `''` in the browser, which is harmless.)

The remaining `save()` calls — `action-select.js:1183`, `:1220`, `chain-panel.js:578`, `engine-manager.js:326`, `:649`, `site-menu-manager.js:293`, `:316`, `:331`, `:360`, `popup-page.js:594`, `:650` — ignore the result and need no change.

- [ ] **Step 6: Verify and commit**

Run:

```bash
grep -rn "const ok = await .*\.save(\|then((ok)" js/components/
```

Expected: no output.

Run: `npm test` — PASS. Reload the extension; in the options page change a setting, export, import the file, reset; each works and the reset leaves `euIntegration` in place (check `chrome.storage.local.get(null)` in the options page console).

```bash
git add js/settings-store.js js/components/options-page.js js/components/site-menu-manager.js js/components/menu-import-dialog.js js/components/popup-page.js js/components/css-editor-page.js tests/settings-store.test.mjs
git commit -m "feat(storage): SettingsStore delegates to the façade; reset writes values; save answers with a reason"
```

---

## Task 7: The reader guards, tested on their own

Task 6 carried the 10.1 and 10.4 repairs in its rewrite; this task pins each with its own test so either can be reverted or reasoned about alone. No production code changes unless a test fails.

**Files:**
- Test: `tests/settings-store.test.mjs`

**Interfaces:**
- Consumes: `reorderMouseGestures`, `normalizeSetting`, `settingsStore.handleExternalChange` from Task 6.

- [ ] **Step 1: Write the tests**

Append to `tests/settings-store.test.mjs`:

```js
describe('10.1 · absence means nothing', () => {
	it('a missing key in an external change leaves the local copy standing', async () => {
		await store.save({ trailWidth: 11 });
		const r = store.handleExternalChange({ trailWidth: { oldValue: 11 } });
		expect(r.hasChange).toBe(false);
		expect(store.current.trailWidth).toBe(11);
	});

	it('a value of the wrong shape leaves the local copy standing', async () => {
		// What an older Gestura would receive if storage.sync ever carried a
		// compressed branch: a string where an object lives.
		const before = store.current.siteMenus;
		const r = store.handleExternalChange({ siteMenus: { newValue: 'H4sIAAAAAAAA' } });
		expect(r.hasChange).toBe(false);
		expect(store.current.siteMenus).toEqual(before);
	});

	it('a key outside DEFAULT_SETTINGS is ignored even if it arrives', () => {
		const r = store.handleExternalChange({ syncFormat: { newValue: 2 } });
		expect(r.hasChange).toBe(false);
		expect(store.current).not.toHaveProperty('syncFormat');
	});
});

describe('10.4 · reorderMouseGestures on a non-object', () => {
	it.each([['a string', 'H4sI'], ['a number', 42], ['null', null], ['an array', [1, 2]]])
		('returns {} for %s', (_label, value) => {
			expect(mod.reorderMouseGestures(value)).toEqual({});
		});

	it('keeps the default order first for a real object', () => {
		const first = Object.keys(DEFAULTS.mouseGestures)[0];
		const out = mod.reorderMouseGestures({ '↓↓↓': { action: 'back' }, [first]: { action: 'forward' } });
		expect(Object.keys(out)[0]).toBe(first);
		expect(out['↓↓↓']).toEqual({ action: 'back' });
	});

	it('normalizeSetting hands mouseGestures through it', () => {
		expect(mod.normalizeSetting('mouseGestures', 'garbage')).toEqual({});
	});
});
```

- [ ] **Step 2: Run and commit**

Run: `npx vitest run tests/settings-store.test.mjs`
Expected: PASS (Task 6 already made these true). If any fails, the Task 6 implementation is wrong — fix it there, not by weakening the test.

```bash
git add tests/settings-store.test.mjs
git commit -m "test(storage): absence means nothing, and a non-object is nothing stored"
```

---

## Task 8: The favicon cap

`storage.local` now houses the settings. The favicon cache had no bound on the number of origins; it gets one — 48 entries, oldest `ts` first — checked on write, where the cache object is already in hand.

**Files:**
- Modify: `js/favicon-util.js`
- Modify: `js/background.js:1438` (constants), `:1503-1505` (the write)
- Test: `tests/favicon-util.test.mjs`

**Interfaces:**
- Produces: `FlowMouseFavicon.pruneCache(cache, max)` → a new object with at most `max` entries, the ones with the largest `ts`. An entry without a numeric `ts` counts as oldest.

- [ ] **Step 1: Write the failing test**

Append to `tests/favicon-util.test.mjs`:

```js
describe("pruneCache", () => {
	const { pruneCache } = globalThis.FlowMouseFavicon;
	const entry = (ts) => ({ icon: null, ts });

	it("keeps a cache under the cap unchanged", () => {
		const cache = { "https://a": entry(1), "https://b": entry(2) };
		expect(pruneCache(cache, 48)).toEqual(cache);
	});

	it("holds at most `max` entries after a write, dropping the oldest ts first", () => {
		const cache = {};
		for (let i = 0; i < 60; i++) cache[`https://o${i}`] = entry(1000 + i);
		const out = pruneCache(cache, 48);
		expect(Object.keys(out)).toHaveLength(48);
		expect(out).not.toHaveProperty("https://o0");
		expect(out).not.toHaveProperty("https://o11");
		expect(out).toHaveProperty("https://o12");
		expect(out).toHaveProperty("https://o59");
	});

	it("treats an entry without a timestamp as the oldest", () => {
		const cache = { "https://a": { icon: null }, "https://b": entry(5), "https://c": entry(6) };
		expect(Object.keys(pruneCache(cache, 2)).sort()).toEqual(["https://b", "https://c"]);
	});

	it("does not mutate its argument", () => {
		const cache = { "https://a": entry(1), "https://b": entry(2), "https://c": entry(3) };
		pruneCache(cache, 1);
		expect(Object.keys(cache)).toHaveLength(3);
	});
});
```

Run: `npx vitest run tests/favicon-util.test.mjs`
Expected: FAIL — `pruneCache is not a function`.

- [ ] **Step 2: Implement**

In `js/favicon-util.js`, before the `api` object, add:

```js
	// The favicon cache in storage.local had no bound on the number of origins.
	// Now that the settings can live beside it (spec §10.3), and storage.local is
	// 5 MB on Chrome 109–113, it gets one: the newest `max` entries by `ts`.
	// Returns a new object; an entry without a numeric ts counts as oldest.
	function pruneCache(cache, max) {
		const entries = Object.entries(cache || {});
		if (entries.length <= max) return { ...(cache || {}) };
		entries.sort((a, b) => (Number(b[1] && b[1].ts) || 0) - (Number(a[1] && a[1].ts) || 0));
		return Object.fromEntries(entries.slice(0, max));
	}
```

and add `pruneCache` to the `api` object.

In `js/background.js`, after `const FAVICON_MAX_BYTES = 60000;` add:

```js
// 48 × 60 KB worst case is 2.9 MB, which with the 1 MiB settings ceiling stays
// under the 5 MB storage.local of Chrome 109–113 with margin. In practice icons
// are a few KB and the cap is far from reached.
const FAVICON_MAX_ENTRIES = 48;
```

and change the write at line 1503–1505 to:

```js
			const fresh = (await chrome.storage.local.get(FAVICON_CACHE_KEY))[FAVICON_CACHE_KEY] || {};
			fresh[origin] = { icon, ts: Date.now() };
			await chrome.storage.local.set({ [FAVICON_CACHE_KEY]: self.FlowMouseFavicon.pruneCache(fresh, FAVICON_MAX_ENTRIES) });
```

- [ ] **Step 3: Run and commit**

Run: `npm test` — PASS.

```bash
git add js/favicon-util.js js/background.js tests/favicon-util.test.mjs
git commit -m "fix(favicon): cap the cache at 48 origins now that it shares a room with the settings"
```

---

## Task 9: Compression inside the envelope, and `statesMax` 5

gzip on the payload plaintext only, recognised on the way back by the `1f 8b` magic, decompression bounded at 1 MiB. `encryptBlob` keeps its signature and behaviour so the contract's envelope vector stays valid byte for byte.

**Files:**
- Modify: `js/eu-sync-crypto.js`
- Modify: `js/eu-sync.js:24`, `:138`
- Test: `tests/eu-sync-crypto.test.mjs`, `tests/eu-sync.test.mjs`

**Interfaces:**
- Produces in `GesturaSyncCrypto`: `INFLATE_MAX_BYTES = 1048576`, `gzip(bytes) → Promise<Uint8Array>`, `gunzipBounded(bytes, max) → Promise<Uint8Array>` (throws `Error('decrypt')` past `max`), `isGzip(bytes) → boolean`, `encryptBytes(key, stateId, role, bytes, iv) → Promise<string>`, `encryptCompressed(key, stateId, role, value) → Promise<string>`. `encryptBlob` and `decryptBlob` keep their signatures; `decryptBlob` gunzips when the plaintext starts `1f 8b`.
- `GesturaSync.LIMITS.statesMax === 5`.

- [ ] **Step 1: Write the failing crypto tests**

Append to `tests/eu-sync-crypto.test.mjs`:

```js
describe('compression', () => {
	const big = () => ({ gesturaSettings: 1, customCss: 'body { color: red; }\n'.repeat(4000) });

	it('round-trips a gzipped payload through encryptCompressed and decryptBlob', async () => {
		const key = await X.deriveKey(SECRET_A);
		const env = await X.encryptCompressed(key, STATE, 'payload', big());
		expect(await X.decryptBlob(key, STATE, 'payload', env)).toEqual(big());
	});

	it('is smaller than the uncompressed envelope for a real payload', async () => {
		const key = await X.deriveKey(SECRET_A);
		const plain = await X.encryptBlob(key, STATE, 'payload', big());
		const gz = await X.encryptCompressed(key, STATE, 'payload', big());
		expect(gz.length * 4).toBeLessThan(plain.length);
	});

	// An older client never compressed. Its payloads must keep decrypting.
	it('still decrypts an uncompressed payload', async () => {
		const key = await X.deriveKey(SECRET_A);
		const env = await X.encryptBlob(key, STATE, 'payload', { theme: 'dark' });
		expect(await X.decryptBlob(key, STATE, 'payload', env)).toEqual({ theme: 'dark' });
	});

	it('encryptBlob still matches the envelope vector byte for byte', async () => {
		const key = await X.deriveKey(SECRET_A);
		const iv = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		expect(await X.encryptBlob(key, STATE, 'meta', { name: 'Work' }, iv))
			.toBe('AQIDBAUGBwgJCgsMhBezK2ZidsR4vw2Le+JA1vfSdGXw0lkopKj0PjhL9A==');
	});

	it('recognises gzip by its magic and nothing else', () => {
		expect(X.isGzip(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))).toBe(true);
		expect(X.isGzip(new TextEncoder().encode('{"a":1}'))).toBe(false);
		expect(X.isGzip(new Uint8Array([0x1f]))).toBe(false);
	});

	// The gzip bomb. The server cannot plant one (GCM authenticates), but a code
	// handed over by a third party can. 2 MiB of zeros gzips to about 2 KB and
	// would inflate past the ceiling; it must fail as 'decrypt', not exhaust memory.
	it('refuses a blob that inflates past 1 MiB as decrypt', async () => {
		const key = await X.deriveKey(SECRET_A);
		const zeros = new Uint8Array(2 * 1024 * 1024);
		const gz = await X.gzip(zeros);
		expect(gz.length).toBeLessThan(10000);
		const env = await X.encryptBytes(key, STATE, 'payload', gz);
		await expect(X.decryptBlob(key, STATE, 'payload', env)).rejects.toThrow('decrypt');
	});

	it('gunzipBounded returns the bytes when they fit', async () => {
		const bytes = new TextEncoder().encode('hello '.repeat(1000));
		const out = await X.gunzipBounded(await X.gzip(bytes), 1024 * 1024);
		expect(new TextDecoder().decode(out)).toBe('hello '.repeat(1000));
	});
});
```

Run: `npx vitest run tests/eu-sync-crypto.test.mjs`
Expected: FAIL — `X.encryptCompressed is not a function`.

- [ ] **Step 2: Implement in `js/eu-sync-crypto.js`**

After `const enc = new TextEncoder();` add:

```js
	// §8 of the storage-move design. The payload plaintext may be gzip; meta never
	// is. Recognised by the magic, so there is no format field to keep in step and
	// an older client's uncompressed payload still reads.
	const GZIP_MAGIC_0 = 0x1f;
	const GZIP_MAGIC_1 = 0x8b;
	// The local settings ceiling. DecompressionStream would happily turn 512 KiB
	// into gigabytes; a blob that inflates past this is treated like any other
	// damaged blob.
	const INFLATE_MAX_BYTES = 1024 * 1024;

	function isGzip(bytes) {
		return bytes.length > 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
	}

	async function gzip(bytes) {
		const cs = new CompressionStream('gzip');
		const writer = cs.writable.getWriter();
		writer.write(bytes);
		writer.close();
		return new Uint8Array(await new Response(cs.readable).arrayBuffer());
	}

	// Reads chunk by chunk and stops the moment the total passes `max` - never
	// materialises the whole output first.
	async function gunzipBounded(bytes, max) {
		const ds = new DecompressionStream('gzip');
		const writer = ds.writable.getWriter();
		writer.write(bytes).catch(() => {});
		writer.close().catch(() => {});
		const reader = ds.readable.getReader();
		const chunks = [];
		let total = 0;
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			total += value.length;
			if (total > max) {
				await reader.cancel();
				throw new Error('decrypt');
			}
			chunks.push(value);
		}
		const out = new Uint8Array(total);
		let offset = 0;
		for (const c of chunks) { out.set(c, offset); offset += c.length; }
		return out;
	}
```

Replace `encryptBlob` with the primitive and two callers:

```js
	// The primitive: bytes in, envelope out. `iv` is an argument for one reason
	// only: the contract's test vector needs a fixed one. Every caller in the
	// extension omits it and gets a fresh random IV, which is what GCM requires -
	// reusing one under the same key discloses the key stream, and both blobs of
	// a state share a key.
	async function encryptBytes(key, stateId, role, bytes, iv) {
		const nonce = iv || crypto.getRandomValues(new Uint8Array(IV_BYTES));
		const ct = new Uint8Array(await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce, additionalData: aad(stateId, role), tagLength: 128 },
			key, bytes));
		const out = new Uint8Array(nonce.length + ct.length);
		out.set(nonce, 0);
		out.set(ct, nonce.length);
		return bytesToB64(out);
	}

	// Signature and behaviour unchanged: the meta blob and the contract's vector.
	async function encryptBlob(key, stateId, role, value, iv) {
		return encryptBytes(key, stateId, role, enc.encode(JSON.stringify(value)), iv);
	}

	// The payload path.
	async function encryptCompressed(key, stateId, role, value) {
		return encryptBytes(key, stateId, role, await gzip(enc.encode(JSON.stringify(value))));
	}
```

In `decryptBlob`, replace the `return JSON.parse(new TextDecoder().decode(pt));` line with:

```js
			let plain = new Uint8Array(pt);
			if (isGzip(plain)) plain = await gunzipBounded(plain, INFLATE_MAX_BYTES);
			return JSON.parse(new TextDecoder().decode(plain));
```

Extend the `api` object:

```js
	const api = {
		INFO_LOCATOR, INFO_KEY, AAD_PREFIX, IV_BYTES, STATE_ID_RE, INFLATE_MAX_BYTES,
		deriveLocator, deriveKey, newStateId, aad,
		encryptBytes, encryptBlob, encryptCompressed, decryptBlob, blobHash, bytesToB64, b64ToBytes,
		gzip, gunzipBounded, isGzip,
	};
```

Run: `npx vitest run tests/eu-sync-crypto.test.mjs`
Expected: PASS, including the existing vector.

- [ ] **Step 3: The transport uses it, and the fixture becomes incompressible**

In `js/eu-sync.js` line 24: `statesMax: 5,`. Line 138:

```js
		const payload = await X.encryptCompressed(key, stateId, 'payload', exportObj);
```

In `tests/eu-sync.test.mjs`, the test at line 210 (`refuses an oversized payload without asking the server`) builds `customCss: 'x'.repeat(S.LIMITS.payloadMaxBytes)`. gzip reduces that to a few hundred bytes, so it would now fit and the test would go red for the wrong reason. Add this helper above the `describe('errors', …)` block, and replace the `const big = …` line inside that test with the line that follows it:

```js
// Random base64 characters carry six bits each - gzip cannot shrink them
// meaningfully, so a megabyte of them stays over the 512 KiB envelope limit
// after compression. 'x'.repeat() would compress to nothing and the test would
// stop testing anything.
const incompressible = (n) => {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	const bytes = crypto.getRandomValues(new Uint8Array(n));
	let s = '';
	for (let i = 0; i < n; i++) s += alphabet[bytes[i] & 63];
	return s;
};
```

```js
		const big = { gesturaSettings: 1, customCss: incompressible(1024 * 1024) };
```

Add these two tests inside the same `describe('errors', …)` block, using the fixtures the file already has (`secretBytes()`, `ID`, `fetchOk`, `calls`, `X`):

```js
	it('mirrors five states per locator', () => {
		expect(S.LIMITS.statesMax).toBe(5);
	});

	// Whatever the body carries, decryptBlob must read it back - the sniff on
	// 1f 8b is what makes compressing the payload a non-event for the contract.
	it('uploads a compressed payload the download path can read', async () => {
		const exportObj = { gesturaSettings: 1, customCss: 'body{}'.repeat(2000) };
		await S.uploadState({
			secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			name: 'Work', createdAt: 'x', exportObj, extVersion: '2.8.0',
			fetchImpl: fetchOk({}),
		});
		const key = await X.deriveKey(await secretBytes());
		const sent = calls[0].body.payload;
		expect(await X.decryptBlob(key, ID, 'payload', sent)).toEqual(exportObj);
		const plain = await X.encryptBlob(key, ID, 'payload', exportObj);
		expect(sent.length).toBeLessThan(plain.length);
	});
```

Run: `npx vitest run tests/eu-sync.test.mjs`
Expected: PASS. If the file asserts `statesMax` anywhere as `10`, change it to `5`.

- [ ] **Step 4: Run all tests and commit**

Run: `npm test` — PASS. In the browser: enable sync against the dev origin (or check the request in the network tab), upload a state, download it: the preview shows the same settings. The listing shows `euSyncQuotaReached` at five states.

```bash
git add js/eu-sync-crypto.js js/eu-sync.js tests/eu-sync-crypto.test.mjs tests/eu-sync.test.mjs
git commit -m "feat(sync): gzip the payload inside the envelope; five states per locator"
```

---

## Task 10: Device-local keys, and the 1 MiB validator ceiling

Seven keys stop travelling over gestura.eu sync and are taken from the local copy when a state is adopted; file exports keep them. `MAX_BYTES` becomes the local ceiling and is pinned to the façade's number.

**Files:**
- Modify: `js/eu-settings-schema.js`
- Modify: `js/components/eu-sync-panel.js:265-267`, `:414`
- Test: `tests/eu-settings-schema.test.mjs`, `tests/settings-storage.test.mjs`

**Interfaces:**
- Produces in `GesturaSettingsSchema`: `DEVICE_LOCAL` (a `Set` of the seven keys); `allowedKeys(opts)`, `buildExport(settings, extVersion, opts)`, `validatedExport(settings, extVersion, opts)` and `validate(input, opts)` all read `opts.forSync`; `validate` additionally reads `opts.local` (the settings currently in storage) when `forSync` is true; `hashOf(exportObj)` ignores `_version` and the seven; `MAX_BYTES === 1048576`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/eu-settings-schema.test.mjs`:

```js
describe('device-local keys', () => {
	const SEVEN = ['theme', 'language', 'macLinuxHintDismissed', 'edgeGestureConflict', 'navCollapsed', 'engineManagerLocalOnly', 'sectionAdvanced'];

	it('names exactly the seven', () => {
		expect([...S.DEVICE_LOCAL].sort()).toEqual([...SEVEN].sort());
	});

	it('buildExport keeps them by default', () => {
		const out = S.buildExport(settings(), '2.8.0');
		for (const k of SEVEN) expect(out).toHaveProperty(k);
	});

	it('buildExport omits them for sync', () => {
		const out = S.buildExport(settings(), '2.8.0', { forSync: true });
		for (const k of SEVEN) expect(out).not.toHaveProperty(k);
		expect(out.trailWidth).toBe(9);
	});

	// The flag has to survive the rebuild inside validate(), or the object that is
	// uploaded and hashed is not the one the preview showed.
	it('validatedExport for sync hands back an object without them', () => {
		const res = S.validatedExport(settings(), '2.8.0', { forSync: true });
		expect(res.ok).toBe(true);
		for (const k of SEVEN) expect(res.exportObj).not.toHaveProperty(k);
		expect(JSON.parse(res.json)).not.toHaveProperty('theme');
	});

	it('import from a file accepts them either way', () => {
		const res = S.validate({ gesturaSettings: 1, theme: 'dark', navCollapsed: true });
		expect(res.settings.theme).toBe('dark');
		expect(res.settings.navCollapsed).toBe(true);
	});

	// Adopting a sync state keeps THIS device's seven. validate() seeds its result
	// from the defaults, and the adopt path writes that result whole - so without
	// this a downloaded state that carries no theme would write 'auto' over 'dark'.
	it('validate for sync fills them from the supplied local copy, not the defaults', () => {
		const local = { ...structuredClone(DEFAULTS), theme: 'dark', language: 'de', navCollapsed: true };
		const res = S.validate({ gesturaSettings: 1, trailWidth: 3 }, { forSync: true, local });
		expect(res.ok).toBe(true);
		expect(res.settings.theme).toBe('dark');
		expect(res.settings.language).toBe('de');
		expect(res.settings.navCollapsed).toBe(true);
		expect(res.settings.trailWidth).toBe(3);
	});

	it('validate for sync ignores a device-local key the payload carries', () => {
		const local = { ...structuredClone(DEFAULTS), theme: 'dark' };
		const res = S.validate({ gesturaSettings: 1, trailWidth: 3, theme: 'light' }, { forSync: true, local });
		expect(res.settings.theme).toBe('dark');
		expect(res.dropped).toEqual([]);
	});

	it('validate for sync without a local copy falls back to the defaults', () => {
		const res = S.validate({ gesturaSettings: 1, trailWidth: 3 }, { forSync: true });
		expect(res.settings.theme).toBe(DEFAULTS.theme);
	});

	it('hashOf ignores a theme change', async () => {
		const a = S.buildExport(settings(), '2.8.0');
		const b = S.buildExport({ ...settings(), theme: 'light' }, '2.8.0');
		expect(await S.hashOf(a)).toBe(await S.hashOf(b));
	});

	it('hashOf still sees a real change', async () => {
		const a = S.buildExport(settings(), '2.8.0');
		const b = S.buildExport({ ...settings(), trailWidth: 1 }, '2.8.0');
		expect(await S.hashOf(a)).not.toBe(await S.hashOf(b));
	});
});

describe('the size cap', () => {
	it('is 1 MiB of JSON text', () => {
		expect(S.MAX_BYTES).toBe(1024 * 1024);
	});
});
```

One **existing** test in the same file has to move with the change: `the upload hash › changes when a value changes` (around line 316) compares `theme: 'dark'` against `theme: 'light'`, and `theme` is now one of the keys the hash deliberately ignores. Change its two objects to `{ gesturaSettings: 1, trailWidth: 5 }` and `{ gesturaSettings: 1, trailWidth: 6 }` — the claim ("a real change changes the hash") stays, the fixture stops using a device-local key.

Append to `tests/settings-storage.test.mjs`:

```js
describe('one ceiling, true at all four doors', () => {
	it('the validator cap equals the local total quota', async () => {
		await import('../js/eu-integration.js');
		await import('../js/eu-settings-schema.js');
		expect(globalThis.GesturaSettingsSchema.MAX_BYTES).toBe(S.QUOTA.local.total);
	});
});
```

Run: `npx vitest run tests/eu-settings-schema.test.mjs tests/settings-storage.test.mjs`
Expected: FAIL — `S.DEVICE_LOCAL` undefined, `MAX_BYTES` 524288.

- [ ] **Step 2: Implement in `js/eu-settings-schema.js`**

Line 15: `const MAX_BYTES = 1024 * 1024;` with the comment:

```js
	// The local settings ceiling (storage-move design §3) - the same number the
	// façade enforces on save, so what can be stored can be exported and imported.
	// The 512 KiB payload cap of the contract is a limit on the ENVELOPE as
	// transmitted; compression sits between the two.
	const MAX_BYTES = 1024 * 1024;
```

After the `NEVER` set add:

```js
	// Facts about THIS device or the state of THIS browser's UI, not settings
	// (storage-move design §7). Excluded from the sync payload, kept in file
	// exports, and taken from the local copy when a sync state is adopted.
	const DEVICE_LOCAL = new Set([
		'theme', 'language', 'macLinuxHintDismissed', 'edgeGestureConflict',
		'navCollapsed', 'engineManagerLocalOnly', 'sectionAdvanced',
	]);
```

Replace the function `allowedKeys` (lines 31–33) with:

```js
	function allowedKeys(opts) {
		const forSync = !!(opts && opts.forSync);
		return Object.keys(defaults()).filter(k => !NEVER.has(k) && !(forSync && DEVICE_LOCAL.has(k)));
	}
```

and, separately — `sameShape`, `RECORD_KEYS`, `conformRecord`, `MAX_DEPTH` and `scanTree` sit between the two and stay — the function `buildExport` (lines 105–111) with:

```js
	function buildExport(settings, extVersion, opts) {
		const out = { [FORMAT_FIELD]: FORMAT_VERSION, _version: extVersion || '' };
		for (const key of allowedKeys(opts)) {
			if (settings && settings[key] !== undefined) out[key] = settings[key];
		}
		return out;
	}
```

In `validate`, after `const legacy = …; const source = …;` replace the three lines `const allowed = …; const settings = structuredClone(defaults());` with:

```js
		const forSync = !!(opts && opts.forSync);
		const allowed = new Set(allowedKeys({ forSync }));
		const settings = structuredClone(defaults());
		// The seven from the local copy, when a sync state is applied. A device that
		// never chose stays on the defaults; one that did keeps its choice. Only a
		// local value of the right shape is taken - storage can hold anything.
		if (forSync) {
			const local = (opts.local && typeof opts.local === 'object') ? opts.local : {};
			for (const k of DEVICE_LOCAL) {
				if (k in local && sameShape(local[k], defaults()[k])) settings[k] = structuredClone(local[k]);
			}
		}
```

In the `for (const [key, value] of Object.entries(source))` loop, directly after `if (NEVER.has(key)) continue;`:

```js
			// A sync payload from a client that still carried them: skipped in
			// silence, like NEVER - Gestura knows these keys, it just does not take
			// them from a sync state.
			if (forSync && DEVICE_LOCAL.has(key)) continue;
```

Replace `const exportObj = buildExport(settings, raw._version);` with:

```js
		const exportObj = buildExport(settings, raw._version, { forSync });
```

Replace `validatedExport` and `hashOf`:

```js
	function validatedExport(settings, extVersion, opts) {
		return validate(buildExport(settings, extVersion, opts), opts);
	}

	// What the "changed since last upload" hint compares. The extension version is
	// excluded deliberately - updating Gestura is not a change to the settings -
	// and so are the device-local keys, or a theme change would offer an upload
	// that carries nothing. Idempotent on an object that already lacks them.
	async function hashOf(exportObj) {
		const EU = root.FlowMouseEuIntegration;
		const copy = { ...exportObj };
		delete copy._version;
		for (const k of DEVICE_LOCAL) delete copy[k];
		return EU.hash64(EU.canonicalize(copy));
	}
```

Add `DEVICE_LOCAL` to the `api` object.

Run: `npx vitest run tests/eu-settings-schema.test.mjs tests/settings-storage.test.mjs`
Expected: PASS.

- [ ] **Step 3: The panel uses the sync shape**

`js/components/eu-sync-panel.js` line 265–267:

```js
	// Always the sync shape: the seven device-local keys stay home (storage-move
	// design §7). `opts` is passed through on top.
	#validatedExport(opts) {
		return window.GesturaSettingsSchema.validatedExport(settingsStore.current, window.i18n.version, { forSync: true, ...(opts || {}) });
	}
```

Line 414 in `#downloadState`:

```js
		const result = window.GesturaSettingsSchema.validate(payload, { forSync: true, local: settingsStore.current });
```

- [ ] **Step 4: Run all tests and commit**

Run: `npm test` — PASS. In the browser: set the theme to dark, upload a state, switch to light, download it → the theme stays light and the preview does not list `theme`. Export to a file → the file contains `theme`.

```bash
git add js/eu-settings-schema.js js/components/eu-sync-panel.js tests/eu-settings-schema.test.mjs tests/settings-storage.test.mjs
git commit -m "feat(sync): seven device-local keys stay home; the validator's ceiling is 1 MiB"
```

---

## Task 11: The storage display, the switch, the note, and the three ways

Everything the user sees. The storage rows follow the area; the central section gains the switch and the note line; the refusal becomes a dialog with three ways out; the import dialog projects against the total in state `local`; enabling tier 2 performs the switch. All new texts in `en` and `de`, listed in `PENDING_TRANSLATION`.

**Files:**
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json` (after the existing `storageAfterImport` line)
- Modify: `tests/site-menu-locales.test.mjs` (`PENDING_TRANSLATION`)
- Create: `js/components/storage-full-dialog.js`
- Modify: `js/components/storage-line.js`
- Modify: `js/components/site-menu-manager.js:216`, `js/components/engine-manager.js:688`
- Modify: `js/components/options-page.js` (imports, `static properties`, `connectedCallback`, `#init`, `#renderStorageRows`, the data section template)
- Modify: `js/components/menu-import-dialog.js:295-305`
- Modify: `js/components/eu-sync-panel.js:180-196`
- Modify: `pages/options.html` (module script for the dialog)

(`.storage-value.near` / `.over` already exist in `options-page.js`'s own styles at lines 260–262; no CSS file changes.)

**Interfaces:**
- Consumes: `GesturaSettingsStorage.usage / area / switchTo / note` (Tasks 1–3), `isStorageFull` and `gestura:storage-full` (Task 6).
- Produces: `<storage-full-dialog .failure=${…} ?open=${…}>` dispatching `storage-way` with `detail: { way: 'shrink' | 'eu' | 'local' }`; `renderStorageLine(i18n, key, settings, entries, avgFallback)` (the third argument is now the whole settings object).

- [ ] **Step 1: The texts**

In `_locales/en/messages.json`, after the `storageAfterImport` line (3077):

```json
	"storageBranchFullTitle": { "message": "{branch} is full ({used} of {total} bytes). Browser sync cannot carry more." },
	"storageTotalFullTitle": { "message": "Your settings are full ({used} of {total} bytes). Browser sync cannot carry more." },
	"storageLocalFullTitle": { "message": "Your settings are full ({used} of {total} bytes). Nothing was saved." },
	"storageWayShrink": { "message": "Make it smaller" },
	"storageWayShrinkDesc": { "message": "Nothing is saved. Remove some entries and try again." },
	"storageWayEu": { "message": "Switch to gestura.eu sync" },
	"storageWayEuDesc": { "message": "About 1 MiB, across your browsers — encrypted, under a code only you hold." },
	"storageWayLocal": { "message": "Turn off browser sync" },
	"storageWayLocalDesc": { "message": "About 1 MiB, on this device only." },
	"storageBrowserSync": { "message": "Browser sync" },
	"storageBrowserSyncOnDesc": { "message": "Your browser carries these settings to your other devices — 8192 bytes per section." },
	"storageBrowserSyncOffDesc": { "message": "Off. Up to 1 MiB, stored on this device only." },
	"storageSwitchRefusedBranch": { "message": "Browser sync cannot be turned back on: {branch} is {used} bytes, and browser sync carries at most {total} per section." },
	"storageSwitchRefusedTotal": { "message": "Browser sync cannot be turned back on: your settings are {used} bytes, and browser sync carries at most {total}." },
	"storageSwitchRefusedTier2": { "message": "Browser sync cannot be turned back on while gestura.eu sync is enabled. Turn that off first." },
	"storageSwitchFailed": { "message": "The switch did not go through. Nothing was changed." },
	"storageMovedNote": { "message": "These settings have not been synchronised since {date}: another browser turned browser sync off. You can switch this browser too." },
	"storageMovedSwitch": { "message": "Switch this browser" },
	"storageFullHint": { "message": "Storage is full. Open the data section of the settings to decide how to continue." },
```

In `_locales/de/messages.json`, after `storageAfterImport` (3015):

```json
	"storageBranchFullTitle": { "message": "{branch} ist voll ({used} von {total} Bytes). Der Browser-Sync trägt nicht mehr." },
	"storageTotalFullTitle": { "message": "Deine Einstellungen sind voll ({used} von {total} Bytes). Der Browser-Sync trägt nicht mehr." },
	"storageLocalFullTitle": { "message": "Deine Einstellungen sind voll ({used} von {total} Bytes). Nichts wurde gespeichert." },
	"storageWayShrink": { "message": "Kleiner machen" },
	"storageWayShrinkDesc": { "message": "Nichts wird gespeichert. Entferne einige Einträge und versuche es erneut." },
	"storageWayEu": { "message": "Auf gestura.eu-Sync umsteigen" },
	"storageWayEuDesc": { "message": "Etwa 1 MiB, über deine Browser hinweg — verschlüsselt, unter einem Code, den nur du hast." },
	"storageWayLocal": { "message": "Browser-Sync ausschalten" },
	"storageWayLocalDesc": { "message": "Etwa 1 MiB, nur auf diesem Gerät." },
	"storageBrowserSync": { "message": "Browser-Sync" },
	"storageBrowserSyncOnDesc": { "message": "Dein Browser trägt diese Einstellungen auf deine anderen Geräte — 8192 Bytes je Abschnitt." },
	"storageBrowserSyncOffDesc": { "message": "Aus. Bis zu 1 MiB, nur auf diesem Gerät gespeichert." },
	"storageSwitchRefusedBranch": { "message": "Der Browser-Sync lässt sich nicht wieder einschalten: {branch} ist {used} Bytes groß, der Browser-Sync trägt je Abschnitt höchstens {total}." },
	"storageSwitchRefusedTotal": { "message": "Der Browser-Sync lässt sich nicht wieder einschalten: deine Einstellungen sind {used} Bytes groß, der Browser-Sync trägt höchstens {total}." },
	"storageSwitchRefusedTier2": { "message": "Der Browser-Sync lässt sich nicht wieder einschalten, solange der gestura.eu-Sync eingeschaltet ist. Schalte den zuerst aus." },
	"storageSwitchFailed": { "message": "Der Wechsel ist nicht durchgegangen. Nichts wurde verändert." },
	"storageMovedNote": { "message": "Diese Einstellungen werden seit dem {date} nicht mehr synchronisiert: ein anderer Browser hat den Browser-Sync ausgeschaltet. Du kannst diesen Browser ebenfalls umstellen." },
	"storageMovedSwitch": { "message": "Diesen Browser umstellen" },
	"storageFullHint": { "message": "Der Speicher ist voll. Öffne den Abschnitt Daten in den Einstellungen, um zu entscheiden, wie es weitergeht." },
```

In `tests/site-menu-locales.test.mjs`, append to the `PENDING_TRANSLATION` array:

```js
	'storageBranchFullTitle', 'storageTotalFullTitle', 'storageLocalFullTitle',
	'storageWayShrink', 'storageWayShrinkDesc', 'storageWayEu', 'storageWayEuDesc',
	'storageWayLocal', 'storageWayLocalDesc',
	'storageBrowserSync', 'storageBrowserSyncOnDesc', 'storageBrowserSyncOffDesc',
	'storageSwitchRefusedBranch', 'storageSwitchRefusedTotal', 'storageSwitchRefusedTier2', 'storageSwitchFailed',
	'storageMovedNote', 'storageMovedSwitch', 'storageFullHint',
```

Run: `npx vitest run tests/site-menu-locales.test.mjs tests/locale-placeholders.test.mjs`
Expected: PASS (both files valid JSON, keys present in `en` and `de`, no `$WORD$`).

- [ ] **Step 2: The dialog component**

Create `js/components/storage-full-dialog.js`:

```js
import { LitElement, html, css } from '../../js/lib/lit-all.min.js';
import { commonStyles } from './shared-styles.js';

// The refusal as a decision (storage-move design §6). The façade refused a write
// with a branch and two numbers; this is where the user sees them and chooses
// one of three ways out. In state 'local' there is one way - make it smaller -
// because the other two lead here.
const BRANCH_LABELS = {
	siteMenus: 'siteMenusTitle',
	searchEngines: 'sectionSearchEngines',
	mouseGestures: 'basicSettings',
};

export function branchLabel(i18n, key) {
	return BRANCH_LABELS[key] ? i18n.getMessage(BRANCH_LABELS[key]) : key;
}

class StorageFullDialog extends LitElement {
	static properties = {
		open: { type: Boolean, reflect: true },
		failure: { attribute: false },
	};

	static styles = [commonStyles, css`
		:host { display: none; }
		:host([open]) { display: block; }
		.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 1000; display: flex; align-items: center; justify-content: center; }
		.modal { background: var(--bg-color); color: var(--text-color); border-radius: 10px; width: min(560px, 92vw); box-shadow: 0 12px 40px rgba(0,0,0,.35); }
		.modal-header { padding: 18px 20px 6px; font-weight: 600; font-size: 15px; }
		.ways { display: flex; flex-direction: column; gap: 10px; padding: 12px 20px 20px; }
		.way { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; text-align: left; padding: 12px 14px; border: 1px solid var(--border-color); border-radius: 8px; background: transparent; color: inherit; cursor: pointer; }
		.way:hover { border-color: var(--primary-color); }
		.way strong { font-size: 14px; }
		.way span { font-size: 12px; opacity: .8; }
	`];

	constructor() {
		super();
		this.open = false;
		this.failure = null;
		this._onKeydown = (e) => { if (e.key === 'Escape' && this.open) { e.stopPropagation(); this.#choose('shrink'); } };
	}

	connectedCallback() { super.connectedCallback(); document.addEventListener('keydown', this._onKeydown, true); }
	disconnectedCallback() { super.disconnectedCallback(); document.removeEventListener('keydown', this._onKeydown, true); }

	#choose(way) {
		this.dispatchEvent(new CustomEvent('storage-way', { detail: { way }, bubbles: true, composed: true }));
	}

	#title(i18n) {
		const f = this.failure;
		const fill = (key) => i18n.getMessage(key)
			.replace('{branch}', branchLabel(i18n, f.branch))
			.replace('{used}', String(f.bytes))
			.replace('{total}', String(f.quota));
		if (f.area === 'local') return fill('storageLocalFullTitle');
		return fill(f.error === 'branch-full' ? 'storageBranchFullTitle' : 'storageTotalFullTitle');
	}

	#way(i18n, way, labelKey, descKey) {
		return html`
			<button class="way" @click=${() => this.#choose(way)}>
				<strong>${i18n.getMessage(labelKey)}</strong>
				<span>${i18n.getMessage(descKey)}</span>
			</button>`;
	}

	render() {
		if (!this.open || !this.failure) return html``;
		const i18n = window.i18n;
		const local = this.failure.area === 'local';
		return html`
			<div class="backdrop" @click=${(e) => { if (e.target === e.currentTarget) this.#choose('shrink'); }}>
				<div class="modal" role="dialog" aria-modal="true">
					<div class="modal-header">${this.#title(i18n)}</div>
					<div class="ways">
						${this.#way(i18n, 'shrink', 'storageWayShrink', 'storageWayShrinkDesc')}
						${local ? '' : this.#way(i18n, 'eu', 'storageWayEu', 'storageWayEuDesc')}
						${local ? '' : this.#way(i18n, 'local', 'storageWayLocal', 'storageWayLocalDesc')}
					</div>
				</div>
			</div>`;
	}
}

customElements.define('storage-full-dialog', StorageFullDialog);
```

In `pages/options.html`, add before the `options-page.js` module line:

```html
	<script type="module" src="../js/components/storage-full-dialog.js"></script>
```

- [ ] **Step 3: The manager line follows the area**

Replace `js/components/storage-line.js`:

```js
import { html } from '../../js/lib/lit-all.min.js';
import { remainingEntries, percentOf } from '../storage-usage.js';

// Knapper Hinweis unter einer Liste. Bytes stehen bewusst nur in der
// Datenverwaltung - für die meisten Nutzer ist die Byte-Zahl keine brauchbare
// Größe. Unauffällig, solange Platz ist.
//
// Menü- und Engine-Manager teilen sich diese Fassung: die Schwellen (75/100),
// der Trenner und die Regel "keine Restanzahl bei 0" sind eine Aussage über den
// Speicher, keine über den jeweiligen Zweig.
//
// The ceiling follows the area (storage-move design §6). Browser sync on: this
// branch against 8192 bytes, with the remaining-count estimate. Browser sync
// off: the TOTAL against 1 MiB, and nothing at all below 75 % - "about 900 more
// menus" tells nobody anything, so the estimate is dropped there rather than
// translated. `settings` is the whole settings object; `key` says which branch
// this line stands under.
export function renderStorageLine(i18n, key, settings, entries, avgFallback) {
	const u = window.GesturaSettingsStorage.usage(settings);
	if (u.quota.item === null) {
		const percent = percentOf(u.total, u.quota.total);
		if (percent >= 100) return html`<div class="notice storage-full">${i18n.getMessage('storageFull')}</div>`;
		if (percent < 75) return '';
		return html`<div class="notice">${i18n.getMessage('storageUsed').replace('{percent}', percent)}</div>`;
	}
	const bytes = u.branches[key] || 0;
	const percent = percentOf(bytes, u.quota.item);
	if (percent >= 100) {
		return html`<div class="notice storage-full">${i18n.getMessage('storageFull')}</div>`;
	}
	const left = remainingEntries(u.quota.item - bytes, entries, avgFallback);
	// Bei 0 passt kein weiterer Eintrag mehr - "noch etwa 0" wäre nur
	// verwirrend, deshalb entfällt die Restanzahl dann.
	const text = i18n.getMessage('storageUsed').replace('{percent}', percent)
		+ (left > 0 ? ' · ' + i18n.getMessage('storageRemaining').replace('{count}', left) : '');
	return percent >= 75
		? html`<div class="notice">${text}</div>`
		: html`<div class="storage-line">${text}</div>`;
}
```

`js/components/site-menu-manager.js` line 216:

```js
		return renderStorageLine(i18n, 'siteMenus', settingsStore.current, Object.values(cur.custom || {}), AVG_FALLBACK.menu);
```

`js/components/engine-manager.js` line 688:

```js
		return renderStorageLine(i18n, 'searchEngines', settingsStore.current, cur.custom || [], AVG_FALLBACK.engine);
```

(Both files already import `settingsStore`; `cur` in each is the branch and stays for the entries argument.)

- [ ] **Step 4: The central section: rows, switch, note, dialog**

In `js/components/options-page.js`:

Imports: line 6, `import { usageOf, entryBytes, percentOf, TOTAL_QUOTA } from '../storage-usage.js';`, becomes `import { percentOf } from '../storage-usage.js';` (the other three have no caller left after this step), and `import { branchLabel } from './storage-full-dialog.js';` is added below it.

`static properties`: add `_storageFailure: { state: true },` and `_syncNote: { state: true },`.

Constructor: `this._storageFailure = null; this._syncNote = null;`.

`connectedCallback`, after the `gestura:settings-apply` listener (line 353):

```js
		this._boundStorageFull = (e) => { this._storageFailure = e.detail; };
		window.addEventListener('gestura:storage-full', this._boundStorageFull);
```

and the matching `removeEventListener` in `disconnectedCallback`.

`#init`, after `this._settings = { ...this._store.current };`:

```js
		await this.#refreshSyncNote();
```

New methods, placed after `#renderStorageRows`:

```js
	async #refreshSyncNote() {
		const S = window.GesturaSettingsStorage;
		this._syncNote = S.area() === 'sync' ? await S.note() : null;
	}

	// The switch of storage-move design §4, both directions. A refusal names its
	// reason and changes nothing; a success re-renders the rows against the new
	// ceiling. settingsStore keeps its #current - the values did not change, only
	// where they live.
	async #switchArea(toSync, reason = 'local') {
		const S = window.GesturaSettingsStorage;
		const i18n = window.i18n;
		const res = await S.switchTo(toSync ? 'sync' : 'local', reason);
		if (!res.ok) {
			const fill = (key) => i18n.getMessage(key)
				.replace('{branch}', branchLabel(i18n, res.branch))
				.replace('{used}', String(res.bytes))
				.replace('{total}', String(res.quota));
			const msg = res.error === 'branch-full' ? fill('storageSwitchRefusedBranch')
				: res.error === 'total-full' ? fill('storageSwitchRefusedTotal')
				: res.error === 'tier2-enabled' ? i18n.getMessage('storageSwitchRefusedTier2')
				: i18n.getMessage('storageSwitchFailed');
			this.#showStatus(msg, 'error');
		}
		await this.#refreshSyncNote();
		this.requestUpdate();
		return res.ok;
	}

	async #onStorageWay(e) {
		const way = e.detail.way;
		this._storageFailure = null;
		if (way === 'local') {
			await this.#switchArea(false, 'local');
		} else if (way === 'eu') {
			// Way two is way three plus tier 2. The switch happens here; the tier-2
			// consent is the sync panel's, so the page scrolls there.
			if (await this.#switchArea(false, 'gestura.eu')) this.#scrollToSection('websiteIntegration');
		}
	}

	#renderAreaSwitch(i18n) {
		const S = window.GesturaSettingsStorage;
		const on = S.area() === 'sync';
		return html`
			<div class="setting-row">
				<div class="setting-label">
					<span>${i18n.getMessage('storageBrowserSync')}</span>
					<span>${i18n.getMessage(on ? 'storageBrowserSyncOnDesc' : 'storageBrowserSyncOffDesc')}</span>
				</div>
				<label class="toggle">
					<input type="checkbox" .checked=${on} @change=${(e) => { const want = e.target.checked; e.target.checked = on; this.#switchArea(want); }}>
					<span class="slider"></span>
				</label>
			</div>`;
	}

	#renderSyncNote(i18n) {
		if (!this._syncNote) return '';
		return html`
			<div class="notice">
				${i18n.getMessage('storageMovedNote').replace('{date}', this.#formatSyncTime(this._syncNote.movedAt))}
				<button class="btn btn-secondary" @click=${() => this.#switchArea(false, this._syncNote.movedTo)}>${i18n.getMessage('storageMovedSwitch')}</button>
			</div>`;
	}
```

(`<label class="toggle">` with `.slider` is exactly the markup `#renderFeatureToggle` in the same file uses; `#formatSyncTime` already exists at line 1343.)

Replace `#renderStorageRows`:

```js
	// Der einzige Ort, an dem Bytes stehen: hier schaut jemand gezielt nach oder
	// meldet ein Problem. Überall sonst genügt der Prozentwert.
	//
	// Bewusst aus settingsStore.current statt this._settings gelesen: settingsStore.save()
	// (siehe #importSettings) aktualisiert #current, bevor die Fassade schreibt,
	// also bleibt this._settings nach einem Import aus dem Menü-/Engine-Manager
	// auf altem Stand, bis ein Reload sie neu zieht. Ein Lesezugriff auf den Store selbst
	// zeigt dagegen immer den aktuellen Wert; das erneute Rendern nach dem Import besorgt
	// der 'action-catalog-changed'-Listener in connectedCallback().
	//
	// The ceiling follows the area (storage-move design §6): browser sync on, the
	// three growing branches against 8192 bytes and the sum against 102 400;
	// browser sync off, one total against 1 MiB.
	#renderStorageRows(i18n) {
		const cur = this._store.current;
		const u = window.GesturaSettingsStorage.usage(cur);
		const detail = (bytes, quota) => i18n.getMessage('storageDetail')
			.replace('{used}', bytes).replace('{total}', quota).replace('{percent}', percentOf(bytes, quota));
		const cls = (bytes, quota) => { const p = percentOf(bytes, quota); return p >= 100 ? 'over' : (p >= 75 ? 'near' : ''); };
		const totalRow = html`
			<div class="setting-row">
				<div class="setting-label"><span>${i18n.getMessage('storageUsageLabel')}</span></div>
				<span class="storage-value ${cls(u.total, u.quota.total)}">${detail(u.total, u.quota.total)}</span>
			</div>`;
		if (u.quota.item === null) return html`${totalRow}${this.#renderAreaSwitch(i18n)}`;
		const branches = [
			['siteMenus', i18n.getMessage('siteMenusTitle')],
			['searchEngines', i18n.getMessage('sectionSearchEngines')],
			['mouseGestures', i18n.getMessage('basicSettings')],
		];
		const rows = branches.map(([key, label]) => html`
			<div class="setting-row">
				<div class="setting-label"><span>${label}</span></div>
				<span class="storage-value ${cls(u.branches[key] || 0, u.quota.item)}">${detail(u.branches[key] || 0, u.quota.item)}</span>
			</div>`);
		return html`${totalRow}${rows}${this.#renderAreaSwitch(i18n)}${this.#renderSyncNote(i18n)}`;
	}
```

In the data-section template, after `${this.#renderStorageRows(i18n)}` (line 1100), the dialog is hosted once at the end of `render()`'s root (beside the existing `<settings-preview-dialog>`):

```js
			<storage-full-dialog
				?open=${!!this._storageFailure}
				.failure=${this._storageFailure}
				@storage-way=${this.#onStorageWay}></storage-full-dialog>
```

- [ ] **Step 5: The import dialog projects against the total in state `local`**

In `js/components/menu-import-dialog.js`, replace `#projectedUsage` (lines 295–305):

```js
	#projectedUsage(patch, imported) {
		const cur = settingsStore.current;
		const measured = window.FlowMouseEuIntegration.withBaselinePlaceholders(patch, imported);
		const S = window.GesturaSettingsStorage;
		const now = S.usage(cur);
		const out = {};
		if (now.quota.item === null) {
			// Browser sync off: no per-branch ceiling exists, so the number that
			// matters is the TOTAL after the import, against 1 MiB. Every touched
			// branch reports that same total - the percentage means "of the storage",
			// and #overflowing / #tightBranches keep working unchanged.
			let total = now.total;
			for (const { key } of BRANCHES) {
				if (key in measured) total += S.entryBytes(key, measured[key]) - (now.branches[key] || 0);
			}
			for (const { key } of BRANCHES) {
				const touched = key in measured;
				out[key] = { bytes: total, quota: now.quota.total, percent: percentOf(total, now.quota.total), touched };
			}
			return out;
		}
		for (const { key } of BRANCHES) {
			const touched = key in measured;
			const value = touched ? measured[key] : cur[key];
			out[key] = value === undefined ? null : { ...usageOf(key, value), touched };
		}
		return out;
	}
```

Extend the import at line 4: `import { usageOf, percentOf } from '../storage-usage.js';`.

- [ ] **Step 6: Enabling tier 2 performs the switch**

In `js/components/eu-sync-panel.js`, `#accept()` (line 180), before `const patch = {`:

```js
		// gestura.eu sync requires browser sync off (storage-move design §4): one
		// switch, two consumers, no state in which both run. A refused switch keeps
		// the dialog open with the reason, exactly like a failed write below.
		const S = window.GesturaSettingsStorage;
		if (S.area() === 'sync') {
			const moved = await S.switchTo('local', 'gestura.eu');
			if (!moved.ok) {
				this._error = window.i18n.getMessage('storageSwitchFailed');
				return;
			}
		}
```

- [ ] **Step 7: Verify in the browser**

Run `npm test` — PASS. Then, with the extension reloaded, the six checks of spec §12:

1. Import menus until `siteMenus` passes 8192 B → the dialog with three ways appears; the manager line shows the previous state; nothing was saved.
2. "Turn off browser sync" → the settings are intact; `chrome.storage.local.get(null)` in the options console shows them plus `settingsArea`; `chrome.storage.sync.get(null)` shows the old copy plus `syncMovedAt` / `syncMovedTo`.
3. A second profile still in state `sync` shows the note line with the date and a button.
4. Import until well past 8192 B, then toggle "Browser sync" on → refused, with the branch and the numbers, and the toggle stays off.
5. From state `sync`, enable gestura.eu sync → `settingsArea.area` is `'local'` and `movedTo` is `'gestura.eu'`; toggling browser sync on is refused, naming tier 2.
6. In state `local`, the site-menu manager shows no storage line below 75 %; the central section shows one total against 1 048 576.

- [ ] **Step 8: Commit**

```bash
git add _locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs js/components/storage-full-dialog.js js/components/storage-line.js js/components/site-menu-manager.js js/components/engine-manager.js js/components/options-page.js js/components/menu-import-dialog.js js/components/eu-sync-panel.js pages/options.html
git commit -m "feat(storage): the limit as a decision - three ways out, the switch, and the note"
```

---

## Task 12: The contract, the privacy text, the changelog, and the hand-over

The six amendments of §9 into `docs/gestura-eu-api.md`; two sentences in `PRIVACY.md`; the changelog entry; the copy for gestura-index.

**Files:**
- Modify: `docs/gestura-eu-api.md:317-331` (envelope), `:438` (rate-limited row), `:446-448` (limits table), `:491` (maximum size)
- Modify: `PRIVACY.md:24-28`, `:83-89`
- Modify: `CHANGELOG.md` (`### Unreleased`)

- [ ] **Step 1: The contract**

In `docs/gestura-eu-api.md`, in the **Envelope** section after the AAD bullet (line 331), add:

````markdown
- **Plaintext of `payload`:** either the settings JSON or its **gzip**,
  recognised by the gzip magic `1f 8b` at the start of the decrypted bytes. A
  JSON object begins with `{` (`0x7b`), so the test is unambiguous and there is
  no format field. `meta` is never compressed. The test vectors below are
  unaffected — they use `role = meta`. Implementations **must bound
  decompression** (the extension stops at 1 MiB and reports the blob as
  undecryptable); the server cannot plant a gzip bomb, because GCM
  authenticates the ciphertext, but a code handed over by a third party can.
````

Replace the `rate-limited` row (line 438) and add a paragraph after the error table:

````markdown
| `rate-limited` | 429 | Per-IP rate limit on requests and on bytes written (the July design's RateLimiter). |
````

````markdown
**What protects the quota.** Locators are free and unlimited — 32 random bytes,
no registration, no account — so anyone treating the service as free blob
storage simply derives more of them. The per-locator limits below are
therefore *not* an abuse bound and should not be read as one. What bounds the
cost is the **per-IP rate limit** on bytes written and the **12-month
retention**. If abuse ever appears, the levers in order are: tighten the
per-IP write limit, shorten retention, lower the per-locator total, and only
then proof of work on a registration call.
````

In the limits table (lines 446–448) change `states per locator` to `5`, and add after the table:

````markdown
`5 × 512 KiB + 5 × 8 KiB` fits inside the 4 MiB total; the table cannot
contradict itself. **The state limit is checked on create only, never
retroactively:** a locator holding more states than the limit — after the
limit was lowered — keeps all of them; reading, writing and deleting stay
possible, only a further create is refused with `quota-states`. There is no
`locator-full` code: with per-state limits the total is unreachable by
construction.
````

Line 491:

````markdown
- **Maximum size:** 1 MiB of JSON text — the extension's local settings
  ceiling. The 512 KiB `payload` limit above is a limit on the *envelope* as
  transmitted; compression sits between the two numbers.
````

- [ ] **Step 2: `PRIVACY.md`**

Lines 24–28, the settings bullet, becomes:

````markdown
- **Your settings** (gestures, menus, search engines, appearance options) are stored
  **locally** through the browser's extension storage API. By default that is
  `storage.sync`: if you have browser sync enabled (e.g. Chrome Sync, Firefox
  Sync), your browser — not Gestura — syncs these settings across your signed-in
  devices, under your browser's own privacy and encryption controls. You can turn
  browser sync off for Gestura in the settings' data section; the settings then
  live in `storage.local` on that device only, and the copy that was already in
  `storage.sync` is left in place, not deleted.
````

In the sync section, the first bullet (lines 83–89) gains one sentence after "…because that name is inside the encrypted part.":

````markdown
  Your settings are compressed before they are encrypted, so the size gestura.eu
  sees reflects how repetitive your settings are, not how many bytes they take.
  Your theme, language and a few other facts about this device are not part of
  the upload and are not overwritten by a download.
````

- [ ] **Step 3: `CHANGELOG.md`**

Under `### Unreleased`, in **New Features**:

````markdown
- **Browser sync is now a switch.** Off, the settings live on this device only
  and can grow to 1 MiB in total instead of 8192 bytes per section. On — the
  default, and unchanged — nothing is different. When a save no longer fits,
  Gestura names the section and the numbers and offers three ways out: make it
  smaller, switch to gestura.eu sync, or turn browser sync off. The way back is
  checked and refused with numbers if the data would not fit.
- **gestura.eu sync compresses the settings** before encrypting them, so far
  more fits in one state; theme, language and a few device-only facts no longer
  travel with a state and are never overwritten by a download. Five states per
  code instead of ten.
````

Under **Fixes**, or a new heading if none exists:

````markdown
- A settings value of an unexpected shape arriving over browser sync no longer
  resets that setting to its default, and a malformed `mouseGestures` value no
  longer keeps the options page from loading.
- The favicon cache is capped at 48 sites.
````

- [ ] **Step 4: Run all tests and commit**

Run: `npm test` — PASS.

```bash
git add docs/gestura-eu-api.md PRIVACY.md CHANGELOG.md
git commit -m "docs: gzip in the envelope, five states, the 1 MiB ceiling - and where the settings live"
```

- [ ] **Step 5: The hand-over**

`docs/gestura-eu-api.md` is the source; gestura-index gets a byte-identical copy through **its** `exchange/` folder, as R2 and R3 were handed over — never through this repo's `exchange/`, which is on the wrong side of the boundary. Read gestura-index's `exchange/AUSTAUSCH.md` first, copy the file, and append one line there naming what changed: gzip on the payload plaintext (recognised by `1f 8b`, bounded), `states per locator` 10 → 5 checked on create only, no `locator-full` code, maximum settings size 1 MiB, the "not an abuse bound" paragraph. Nothing in either `exchange/` is committed.

---

## Self-review against the spec

**Coverage.** §2 one area, one switch → Tasks 1, 3. §3 the 1 MiB ceiling → Tasks 2, 10 (and the equality test). §4 the switch key, the note, the three-step sequence, the refusals, the never-deleted copy → Task 3; the note line and tier-2 hook → Task 11. §5 the façade API and all 47 call sites in three contexts, the four listeners, the page ordering and registration → Tasks 1, 4, 5, 6; `reset()` as values → Task 6. §6 the pre-check, the three ways, the swapped ceiling, the dropped estimate → Tasks 2, 11. §7 device-local keys, `forSync` through `validate`, the adopt path, `hashOf` → Task 10. §8 compression, the sniff, the bound, untouched vectors, the transport check → Task 9. §9 six amendments → Task 12. §10.1 / 10.2 / 10.4 → Tasks 6, 7; §10.3 → Task 8. §11 nothing here compresses `storage.sync`, chunks, reconciles, or touches `storage-usage.js`. §12 every listed automated test appears in a task; the six browser checks are Task 11 Step 7. §13 order 1 → 2 → 3 → 4 → (5, 6, 7 independent) → 8 → (9, 10) is honoured: Tasks 1–3 core, 4–6 call sites, 7–10 independent repairs and features, 11 display, 12 documents.

**Placeholders.** None: every step carries its code, every i18n key its text in both languages.

**Type consistency.** `set` / `switchTo` failure shape `{ ok, error, branch, bytes, quota, area }` in Tasks 2, 3, 6, 11. `usage()` returns `{ area, branches, total, quota: { item, total } }` in Tasks 1, 11. `renderStorageLine(i18n, key, settings, entries, avgFallback)` in Task 11, both callers. `validate(input, { forSync, local, json })` in Tasks 10, 11. `encryptCompressed(key, stateId, role, value)` in Task 9, called from `eu-sync.js`. `pruneCache(cache, max)` in Task 8, both places. `isStorageFull` exported from `settings-store.js` and imported in five components, Tasks 6 and 11.

**Smoke-tested before commit.** The code blocks of Tasks 1–3 (façade, fake, 31 tests), Task 6–7 (`settings-store.js`, 18 tests), Task 9 (`eu-sync-crypto.js`, the existing suite plus 7) and Task 10 (`eu-settings-schema.js`, the existing suite plus 12) were extracted from this document into a scratch copy of the repo and run under vitest: 130 tests, all green. That run is what found the one existing test Task 10 has to change (`the upload hash › changes when a value changes`). The UI of Task 11 and the wiring of Tasks 4, 5, 8 were not executed and are verified by the browser checks named in their steps.

**Deviations from the spec, all named above in "Decisions taken in this plan":** the eighth façade function `note()`; seven pages instead of five; `constants.js` root-agnostic; the update migrations left on `storage.sync`; the incompressible test fixture; `hashOf` stripping the seven itself.
