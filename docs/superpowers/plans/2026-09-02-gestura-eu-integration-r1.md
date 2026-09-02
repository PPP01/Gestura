# gestura.eu Integration — R1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship release stage R1 of the gestura.eu integration: a default-off "Website integration" switch with versioned consent, gating of every website-triggered import path, the page ↔ extension bridge (`hello` / `query-status`), and origin-bound provenance with a baseline hash on every import mode.

**Architecture:** Two new classic scripts carry the logic — `js/eu-integration.js` (pure: consent invariant, origin rules, canonical hash, bridge protocol) and `js/eu-local.js` (the only `chrome.storage.local` reader/writer for the integration state). A third, `js/eu-bridge.js`, is the content script that answers gestura.eu pages. Provenance is threaded through the existing import pipeline in `js/menu-exchange.js` and preserved by the engine resolver and editors. A new Lit component renders the switch and consent inside the options page. Nothing new goes into `DEFAULT_SETTINGS` or `chrome.storage.sync` except the `source` metadata that imports already write.

**Tech Stack:** Manifest V3, plain JS classic scripts (IIFE + `root.X = api`), Lit (vendored `js/lib/lit-all.min.js`), WebCrypto (`crypto.subtle.digest`, `TextEncoder`), vitest (`npm test`, Node 24).

**Spec:** [docs/superpowers/specs/2026-09-02-gestura-eu-integration-design.md](../specs/2026-09-02-gestura-eu-integration-design.md) — sections 1–4, 6, 7, 9 are R1; the plan argues from it, read both.

## Global Constraints

- **No build step.** The repo folder *is* the unpacked extension. New scripts are classic `<script>` files for content-script/worker use, ES modules only under `js/components/`.
- **Content scripts cannot use ES modules.** They hand each other `window.*` / `self.*` globals; `manifest.json`'s `content_scripts.js` list is load-ordered.
- **Indentation is tabs**, throughout, including tests and docs code blocks.
- **Pure modules stay pure:** `js/eu-integration.js` and `js/menu-exchange.js` use no `chrome.*`, no DOM, no i18n (`crypto.subtle` and `TextEncoder` are allowed — they exist in every target and in Node).
- **Every new `euIntegration*` i18n key must exist in all 39 locales** (`_locales/*/messages.json`); Task 10 extends `tests/site-menu-locales.test.mjs` to enforce it. Never put an undeclared `$WORD$` in a message; use `{token}` + `.replace()`.
- **`js/background.js`'s `importScripts` list must match `background.scripts` in the Firefox manifest** on the `firefox-build` branch; likewise `content_scripts`. This plan works on `main`; Task 14 records the parity items to apply after the merge.
- **Storage:** integration state lives in `chrome.storage.local` under the single key `euIntegration`. It is never exported, never imported, never synced.
- **Consent version for R1 is `1`.** R2 (update check) will raise it to `2` and re-prompt; the R1 consent text must therefore describe R1 scope only.
- **Silence is the only failure mode toward pages.** The bridge never emits an error event; malformed, over-limit, off-switch or wrong-origin requests get no answer.
- **Wire contract (from 2.8.0):** bridge events are dispatched on and listened to on `document`; `detail` is always a JSON **string**.
- **Production origin:** `https://gestura.eu`. **Dev origin:** at most one, validated by exact `URL` origin equality, `https:` or `http://localhost|127.0.0.1[:port]`.
- Commit after every task with a conventional-commit message; `npm test` must be green before each commit.

---

## File structure

| File | Responsibility | Status |
|---|---|---|
| `js/eu-integration.js` | Pure core: constants, `normalizeLocal`, `effectiveEnabled`, dev-origin validation, `allowedOrigins`, `qualifiedOrigin`, canonical JSON, 64-bit baseline hash, projection/`modifiedState`, `listProvenanced`/`findStored`/`addBaselines`, bridge request parsing + answers. Global `FlowMouseEuIntegration`, `module.exports` for tests. | create |
| `js/eu-local.js` | Thin `chrome.storage.local` wrapper for the `euIntegration` key with a live cache and change listeners. Global `GesturaEuLocal`. Used by content scripts, worker and options page. | create |
| `js/eu-bridge.js` | Content script answering `gestura:hello` / `gestura:query-status` on allowed origins while the switch is effectively on. | create |
| `js/menu-exchange.js` | `toStandardMenu` / `toEngineOverride` gain a trailing `source` argument; `applyMenuTo` / `applyEngineTo` pass it; new pure `matchImport` (three-case dedup). | modify |
| `js/engine-registry.js` | `toEngine` passes `source` through. | modify |
| `js/components/engine-manager.js` | `#saveEdit`, `#saveAdd`, `#getResolvedEngines` preserve `source`; `#importUrl` records `indexOrigin`. | modify |
| `js/components/site-menu-manager.js` | `#importUrl` records `indexOrigin`. | modify |
| `js/components/menu-import-dialog.js` | Uses `matchImport`; ambiguity forces "import as new"; `addBaselines` before save. | modify |
| `js/content.js` | Hand-off IIFE gated on the effective switch (click, inline payload, result dispatch). | modify |
| `js/background.js` | `importScripts` for the two new files; `importFromSite`/`importInline`/`reportImportResult` gated; `indexOrigin` stashed in `pendingImport`. | modify |
| `js/components/options-page.js` | Passes `indexOrigin` into the import source; registers the new section. | modify |
| `js/components/eu-integration-panel.js` | Lit component: switch, consent block, re-confirm state, dev-origin field. | create |
| `pages/options.html` | Loads `eu-integration.js`, `eu-local.js` (classic) and the panel (module). | modify |
| `manifest.json` | `content_scripts` gains the three new scripts. | modify |
| `_locales/*/messages.json` | 15 `euIntegration*` keys × 39 locales. | modify |
| `tests/site-menu-locales.test.mjs` | Enforce the `euIntegration` prefix. | modify |
| `tests/eu-integration.test.mjs`, `tests/eu-bridge-protocol.test.mjs`, `tests/menu-exchange-provenance.test.mjs`, `tests/menu-exchange-match.test.mjs` | New suites. | create |
| `tests/engine-registry.test.mjs` | `source` pass-through case. | modify |
| `docs/gestura-eu-api.md` | The tracked API contract (R1 part). | create |
| `docs/test-bundles/bridge-test.html` | Local page to exercise the bridge and the gated hand-off end to end. | create |
| `README.md`, `README.de.md`, `PRIVACY.md`, `CHANGELOG.md` | Operator section, privacy section, changelog entries. | modify |

---

### Task 1: Pure core — local state, consent invariant, origin rules

**Files:**
- Create: `js/eu-integration.js`
- Test: `tests/eu-integration.test.mjs`

**Interfaces:**
- Produces (global `FlowMouseEuIntegration`, also `module.exports`):
  - `PRODUCTION_ORIGIN = 'https://gestura.eu'`, `CURRENT_INTEGRATION_CONSENT = 1`, `API_LEVEL = 1`
  - `LIMITS = { detailMaxBytes: 32768, requestIdMax: 64, idsMax: 100, idMax: 128 }`
  - `LOCAL_DEFAULTS = { euIntegration: { enabled: false, consent: null, devOrigin: '' } }`
  - `normalizeLocal(raw) → { euIntegration: { enabled: boolean, consent: {version:number, date:string} | null, devOrigin: string } }`
  - `effectiveEnabled(local) → boolean`
  - `isValidDevOrigin(input) → boolean`
  - `allowedOrigins(local) → string[]`
  - `qualifiedOrigin(urlString, local) → string | null`

- [ ] **Step 1: Write the failing tests**

```js
// tests/eu-integration.test.mjs
import { describe, it, expect } from 'vitest';
import '../js/eu-integration.js';
const EU = globalThis.FlowMouseEuIntegration;

const on = (over = {}) => ({ euIntegration: { enabled: true, consent: { version: EU.CURRENT_INTEGRATION_CONSENT, date: '2026-09-02T00:00:00Z' }, devOrigin: '', ...over } });

describe('normalizeLocal', () => {
	it('fills defaults for an empty store', () => {
		expect(EU.normalizeLocal({})).toEqual({ euIntegration: { enabled: false, consent: null, devOrigin: '' } });
		expect(EU.normalizeLocal(undefined)).toEqual(EU.LOCAL_DEFAULTS);
	});
	it('drops garbage shapes', () => {
		const n = EU.normalizeLocal({ euIntegration: { enabled: 'yes', consent: { version: '1' }, devOrigin: 42 } });
		expect(n.euIntegration).toEqual({ enabled: false, consent: null, devOrigin: '' });
	});
	it('keeps a well-formed consent', () => {
		const n = EU.normalizeLocal(on());
		expect(n.euIntegration.consent).toEqual({ version: 1, date: '2026-09-02T00:00:00Z' });
	});
});

describe('effectiveEnabled', () => {
	it('is off by default', () => { expect(EU.effectiveEnabled(EU.normalizeLocal({}))).toBe(false); });
	it('is on with enabled + current consent', () => { expect(EU.effectiveEnabled(on())).toBe(true); });
	it('a stale consent version authorizes nothing', () => {
		expect(EU.effectiveEnabled(on({ consent: { version: EU.CURRENT_INTEGRATION_CONSENT - 1, date: 'x' } }))).toBe(false);
	});
	it('enabled without consent is off', () => { expect(EU.effectiveEnabled(on({ consent: null }))).toBe(false); });
	it('consent without enabled is off', () => { expect(EU.effectiveEnabled(on({ enabled: false }))).toBe(false); });
});

describe('isValidDevOrigin', () => {
	it.each([
		['https://index.example', true],
		['http://localhost:5173', true],
		['http://127.0.0.1:8080', true],
		['http://localhost', true],
		['http://localhost.attacker.com', false],
		['http://index.example', false],
		['https://index.example/', false],
		['https://index.example/path', false],
		['index.example', false],
		['', false],
		['javascript:alert(1)', false],
	])('%s → %s', (input, ok) => { expect(EU.isValidDevOrigin(input)).toBe(ok); });
});

describe('allowedOrigins / qualifiedOrigin', () => {
	it('production only when no dev origin is set', () => {
		expect(EU.allowedOrigins(on())).toEqual(['https://gestura.eu']);
	});
	it('adds a valid dev origin, ignores an invalid one', () => {
		expect(EU.allowedOrigins(on({ devOrigin: 'http://localhost:5173' }))).toEqual(['https://gestura.eu', 'http://localhost:5173']);
		expect(EU.allowedOrigins(on({ devOrigin: 'http://evil.example' }))).toEqual(['https://gestura.eu']);
	});
	it('qualifiedOrigin judges the final URL, path and query ignored', () => {
		const local = on({ devOrigin: 'http://localhost:5173' });
		expect(EU.qualifiedOrigin('https://gestura.eu/de/index/foo.json?x=1', local)).toBe('https://gestura.eu');
		expect(EU.qualifiedOrigin('http://localhost:5173/api/bundle', local)).toBe('http://localhost:5173');
		expect(EU.qualifiedOrigin('https://cdn.gestura.eu/foo.json', local)).toBe(null);
		expect(EU.qualifiedOrigin('not a url', local)).toBe(null);
		expect(EU.qualifiedOrigin('', local)).toBe(null);
	});
	it('allowed origins do not depend on the switch', () => {
		expect(EU.qualifiedOrigin('https://gestura.eu/x', EU.normalizeLocal({}))).toBe('https://gestura.eu');
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/eu-integration.test.mjs`
Expected: FAIL — `Cannot find module '../js/eu-integration.js'`.

- [ ] **Step 3: Create `js/eu-integration.js` with the core**

```js
// Pure core of the gestura.eu integration: consent invariant, origin rules,
// canonical hashing and the bridge protocol. No chrome.*, no DOM, no i18n —
// shared between content scripts, the service worker, the Lit UI and the
// vitest suites, like menu-exchange.js. crypto.subtle and TextEncoder are the
// only platform APIs used; both exist everywhere the file runs.
(function (root) {
	'use strict';

	const PRODUCTION_ORIGIN = 'https://gestura.eu';
	// Bumping this re-prompts every user: effectiveEnabled() is false until the
	// stored consent carries the current number. R1 = 1. R2 raises it to 2.
	const CURRENT_INTEGRATION_CONSENT = 1;
	const API_LEVEL = 1;
	const LIMITS = { detailMaxBytes: 32 * 1024, requestIdMax: 64, idsMax: 100, idMax: 128 };
	const ID_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
	const LOCAL_DEFAULTS = { euIntegration: { enabled: false, consent: null, devOrigin: '' } };

	// --- local state -----------------------------------------------------------

	function normalizeLocal(raw) {
		const src = (raw && raw.euIntegration && typeof raw.euIntegration === 'object') ? raw.euIntegration : {};
		const consent = (src.consent && typeof src.consent === 'object' && typeof src.consent.version === 'number')
			? { version: src.consent.version, date: typeof src.consent.date === 'string' ? src.consent.date : '' }
			: null;
		return {
			euIntegration: {
				enabled: src.enabled === true,
				consent,
				devOrigin: typeof src.devOrigin === 'string' ? src.devOrigin : '',
			},
		};
	}

	// The one invariant every gated path checks. A stale consent version
	// authorizes nothing — the UI shows "needs re-confirmation" instead.
	function effectiveEnabled(local) {
		const s = normalizeLocal(local).euIntegration;
		return s.enabled === true && s.consent !== null && s.consent.version === CURRENT_INTEGRATION_CONSENT;
	}

	// --- origins ----------------------------------------------------------------

	// Exact, never substring-based: `new URL(input).origin === input` rejects
	// paths and trailing slashes; only https, or http on a loopback host.
	function isValidDevOrigin(input) {
		if (typeof input !== 'string' || !input) return false;
		let url;
		try { url = new URL(input); } catch { return false; }
		if (url.origin !== input) return false;
		if (url.protocol === 'https:') return true;
		return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
	}

	function allowedOrigins(local) {
		const dev = normalizeLocal(local).euIntegration.devOrigin;
		return isValidDevOrigin(dev) ? [PRODUCTION_ORIGIN, dev] : [PRODUCTION_ORIGIN];
	}

	// Which allowed origin a URL belongs to, or null. Callers pass the FINAL url
	// (Response.url after redirects, sender.url), never what the user typed.
	function qualifiedOrigin(urlString, local) {
		if (typeof urlString !== 'string' || !urlString) return null;
		let origin;
		try { origin = new URL(urlString).origin; } catch { return null; }
		return allowedOrigins(local).includes(origin) ? origin : null;
	}

	const api = {
		PRODUCTION_ORIGIN, CURRENT_INTEGRATION_CONSENT, API_LEVEL, LIMITS, LOCAL_DEFAULTS, ID_RE,
		normalizeLocal, effectiveEnabled, isValidDevOrigin, allowedOrigins, qualifiedOrigin,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseEuIntegration = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/eu-integration.test.mjs`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add js/eu-integration.js tests/eu-integration.test.mjs
git commit -m "feat(eu): pure core for the website integration - consent invariant and origin rules"
```

---

### Task 2: Canonical JSON, baseline hash, modified state

**Files:**
- Modify: `js/eu-integration.js`
- Test: `tests/eu-integration.test.mjs` (append)

**Interfaces:**
- Produces:
  - `canonicalize(value) → string` — recursively key-sorted, no whitespace, `undefined` properties dropped, `null` kept
  - `hash64(str) → Promise<string>` — first 8 bytes of SHA-256 as 16 lowercase hex chars
  - `projection(stored) → object` — the stored entry without its `source`
  - `baselineHash(stored) → Promise<string>`
  - `modifiedState(stored) → Promise<true | false | 'unknown'>`

- [ ] **Step 1: Append the failing tests**

```js
describe('canonicalize', () => {
	it('sorts keys recursively and strips whitespace', () => {
		expect(EU.canonicalize({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}');
	});
	it('drops undefined properties, keeps null', () => {
		expect(EU.canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
		expect(EU.canonicalize({ b: null })).toBe(EU.canonicalize({ a: undefined, b: null }));
	});
	it('undefined inside arrays becomes null, like JSON.stringify', () => {
		expect(EU.canonicalize([1, undefined, 2])).toBe('[1,null,2]');
	});
	it('scalars round-trip', () => {
		expect(EU.canonicalize('a"b')).toBe('"a\\"b"');
		expect(EU.canonicalize(3)).toBe('3');
		expect(EU.canonicalize(true)).toBe('true');
		expect(EU.canonicalize(null)).toBe('null');
	});
});

describe('baselineHash / modifiedState', () => {
	const stored = { name: 'Shop', icon: 'cart', patterns: ['*example.com*'], items: [], source: { type: 'site', indexId: 'com.example.shop', indexOrigin: 'https://gestura.eu', version: '1.0.0' } };

	it('hash is 16 lowercase hex chars and deterministic', async () => {
		const h = await EU.baselineHash(stored);
		expect(h).toMatch(/^[0-9a-f]{16}$/);
		expect(await EU.baselineHash(JSON.parse(JSON.stringify(stored)))).toBe(h);
	});
	it('ignores the source object and key order', async () => {
		const reordered = { source: { indexId: 'other', type: 'file' }, items: [], patterns: ['*example.com*'], icon: 'cart', name: 'Shop' };
		expect(await EU.baselineHash(reordered)).toBe(await EU.baselineHash(stored));
	});
	it('changes when content changes', async () => {
		expect(await EU.baselineHash({ ...stored, name: 'Shop 2' })).not.toBe(await EU.baselineHash(stored));
	});
	it('modifiedState: unknown without baseline, false when equal, true when changed', async () => {
		expect(await EU.modifiedState(stored)).toBe('unknown');
		const base = await EU.baselineHash(stored);
		const withBase = { ...stored, source: { ...stored.source, baselineHash: base } };
		expect(await EU.modifiedState(withBase)).toBe(false);
		expect(await EU.modifiedState({ ...withBase, name: 'edited' })).toBe(true);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/eu-integration.test.mjs`
Expected: FAIL — `EU.canonicalize is not a function`.

- [ ] **Step 3: Add the hashing block to `js/eu-integration.js`** (insert before `const api = {`, and add the new names to `api`)

```js
	// --- canonical JSON + baseline hash ------------------------------------------
	// JSON.stringify is not key-order stable across code paths; the baseline
	// needs one canonical form. undefined properties are dropped (like
	// JSON.stringify), null is kept, arrays keep their order.

	function canonicalize(value) {
		if (value === undefined) return undefined;
		if (value === null || typeof value !== 'object') return JSON.stringify(value);
		if (Array.isArray(value)) return '[' + value.map(v => (v === undefined ? 'null' : canonicalize(v))).join(',') + ']';
		const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
		return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
	}

	// 64 bits (16 hex chars): collision-safe for a local integrity check, gentle
	// on the scarce sync quota where it is stored.
	async function hash64(str) {
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
		return Array.from(new Uint8Array(digest).slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
	}

	// The baseline is the stored runtime entry exactly as the import wrote it,
	// after all import transformations, minus the source object itself.
	function projection(stored) {
		const out = { ...stored };
		delete out.source;
		return out;
	}

	async function baselineHash(stored) {
		return hash64(canonicalize(projection(stored)));
	}

	async function modifiedState(stored) {
		const base = stored && stored.source && stored.source.baselineHash;
		if (typeof base !== 'string' || !base) return 'unknown';
		return (await baselineHash(stored)) !== base;
	}
```

Add to `api`: `canonicalize, hash64, projection, baselineHash, modifiedState`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/eu-integration.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/eu-integration.js tests/eu-integration.test.mjs
git commit -m "feat(eu): canonical JSON, 64-bit baseline hash and modified state"
```

---

### Task 3: Bridge protocol (pure)

**Files:**
- Modify: `js/eu-integration.js`
- Test: `tests/eu-bridge-protocol.test.mjs`

**Interfaces:**
- Produces:
  - `listProvenanced(settings) → [{ kind: 'menu'|'engine', id, stored }]` — every stored entry (custom menus, edited menus, custom engines, engine overrides) that carries a `source`
  - `findStored(settings, kind, id) → stored | null`
  - `parseBridgeRequest(detail) → { requestId, ids? } | null`
  - `helloAnswer(req, version) → { requestId, version, apiLevel }`
  - `statusAnswer(req, origin, settings) → Promise<{ requestId, entries: [{ id, installed, version?, modified? }] }>`

- [ ] **Step 1: Write the failing tests**

```js
// tests/eu-bridge-protocol.test.mjs
import { describe, it, expect } from 'vitest';
import '../js/eu-integration.js';
const EU = globalThis.FlowMouseEuIntegration;

const PROD = 'https://gestura.eu';
const DEV = 'http://localhost:5173';
const src = (indexId, indexOrigin, extra = {}) => ({ type: 'site', indexId, ...(indexOrigin ? { indexOrigin } : {}), version: '1.2.0', ...extra });

async function settingsWithBaselines() {
	const s = {
		siteMenus: {
			custom: {
				menu_a: { name: 'A', icon: 'menu', patterns: [], items: [], source: src('com.a', PROD) },
				menu_b: { name: 'B', icon: 'menu', patterns: [], items: [], source: src('com.b', DEV) },
				menu_f: { name: 'F', icon: 'menu', patterns: [], items: [], source: src('com.f', null) },
				menu_own: { name: 'Own', icon: 'menu', patterns: [], items: [] },
			},
			edited: { google: { name: 'G', icon: 'search', patterns: ['*google*'], items: [], source: src('google', PROD) } },
		},
		searchEngines: {
			custom: [{ id: 'eng_1', name: 'E', url: 'https://e/%s', type: 'text', builtin: false, source: src('com.e', PROD) }],
			overrides: { bing: { name: 'Bing2', url: 'https://b/%s', source: src('bing', PROD) } },
		},
	};
	for (const e of EU.listProvenanced(s)) e.stored.source.baselineHash = await EU.baselineHash(e.stored);
	return s;
}

describe('parseBridgeRequest', () => {
	const ok = JSON.stringify({ requestId: 'r1', ids: ['com.a', 'com.b'] });
	it('accepts a well-formed request', () => {
		expect(EU.parseBridgeRequest(ok)).toEqual({ requestId: 'r1', ids: ['com.a', 'com.b'] });
		expect(EU.parseBridgeRequest(JSON.stringify({ requestId: 'r1' }))).toEqual({ requestId: 'r1' });
	});
	it.each([
		['not a string', 42],
		['empty', ''],
		['bad json', '{'],
		['array', '[]'],
		['no requestId', JSON.stringify({ ids: [] })],
		['requestId too long', JSON.stringify({ requestId: 'x'.repeat(65) })],
		['ids not array', JSON.stringify({ requestId: 'r', ids: 'com.a' })],
		['too many ids', JSON.stringify({ requestId: 'r', ids: Array.from({ length: 101 }, (_, i) => 'id' + i) })],
		['id violates pattern', JSON.stringify({ requestId: 'r', ids: ['__proto__'] })],
		['id too long', JSON.stringify({ requestId: 'r', ids: ['a'.repeat(129)] })],
		['non-string id', JSON.stringify({ requestId: 'r', ids: [1] })],
	])('rejects %s with null', (_, detail) => { expect(EU.parseBridgeRequest(detail)).toBe(null); });
	it('rejects an over-limit detail before parsing', () => {
		const huge = JSON.stringify({ requestId: 'r', ids: ['com.a'], junk: 'x'.repeat(EU.LIMITS.detailMaxBytes) });
		expect(EU.parseBridgeRequest(huge)).toBe(null);
	});
	it('accepts a pattern-valid hostile id', () => {
		expect(EU.parseBridgeRequest(JSON.stringify({ requestId: 'r', ids: ['constructor'] }))).toEqual({ requestId: 'r', ids: ['constructor'] });
	});
});

describe('helloAnswer', () => {
	it('echoes requestId, carries version and apiLevel', () => {
		expect(EU.helloAnswer({ requestId: 'r9' }, '2.9.0')).toEqual({ requestId: 'r9', version: '2.9.0', apiLevel: 1 });
	});
});

describe('statusAnswer', () => {
	it('answers only asked ids, only for the asking origin, as an array', async () => {
		const s = await settingsWithBaselines();
		const a = await EU.statusAnswer({ requestId: 'r', ids: ['com.a', 'com.b', 'com.f', 'nope', 'google', 'bing', 'com.e'] }, PROD, s);
		expect(a.requestId).toBe('r');
		expect(Array.isArray(a.entries)).toBe(true);
		expect(a.entries).toEqual([
			{ id: 'com.a', installed: true, version: '1.2.0', modified: false },
			{ id: 'com.b', installed: false },      // dev-origin entry is invisible to production
			{ id: 'com.f', installed: false },      // file import (no indexOrigin) is never disclosed
			{ id: 'nope', installed: false },
			{ id: 'google', installed: true, version: '1.2.0', modified: false },   // edited catalog copy
			{ id: 'bing', installed: true, version: '1.2.0', modified: false },     // engine override
			{ id: 'com.e', installed: true, version: '1.2.0', modified: false },    // custom engine
		]);
	});
	it('the dev origin sees its own entries and not production ones', async () => {
		const s = await settingsWithBaselines();
		const a = await EU.statusAnswer({ requestId: 'r', ids: ['com.a', 'com.b'] }, DEV, s);
		expect(a.entries).toEqual([{ id: 'com.a', installed: false }, { id: 'com.b', installed: true, version: '1.2.0', modified: false }]);
	});
	it('reports modified after a local edit and unknown without baseline', async () => {
		const s = await settingsWithBaselines();
		s.siteMenus.custom.menu_a.name = 'A edited';
		delete s.searchEngines.custom[0].source.baselineHash;
		const a = await EU.statusAnswer({ requestId: 'r', ids: ['com.a', 'com.e'] }, PROD, s);
		expect(a.entries[0].modified).toBe(true);
		expect(a.entries[1].modified).toBe('unknown');
	});
	it('never enumerates: no ids → empty entries; duplicate ids answered once', async () => {
		const s = await settingsWithBaselines();
		expect((await EU.statusAnswer({ requestId: 'r' }, PROD, s)).entries).toEqual([]);
		expect((await EU.statusAnswer({ requestId: 'r', ids: ['com.a', 'com.a'] }, PROD, s)).entries).toHaveLength(1);
	});
	it('a hostile id is harmless', async () => {
		const s = await settingsWithBaselines();
		const a = await EU.statusAnswer({ requestId: 'r', ids: ['constructor'] }, PROD, s);
		expect(a.entries).toEqual([{ id: 'constructor', installed: false }]);
	});
});

describe('listProvenanced / findStored', () => {
	it('walks all four storage places and skips entries without source', async () => {
		const s = await settingsWithBaselines();
		expect(EU.listProvenanced(s).map(e => `${e.kind}:${e.id}`).sort()).toEqual(['engine:bing', 'engine:eng_1', 'menu:google', 'menu:menu_a', 'menu:menu_b', 'menu:menu_f']);
		expect(EU.findStored(s, 'menu', 'google').name).toBe('G');
		expect(EU.findStored(s, 'engine', 'bing').name).toBe('Bing2');
		expect(EU.findStored(s, 'engine', 'eng_1').name).toBe('E');
		expect(EU.findStored(s, 'menu', 'missing')).toBe(null);
	});
	it('tolerates empty settings', () => {
		expect(EU.listProvenanced({})).toEqual([]);
		expect(EU.findStored({}, 'engine', 'x')).toBe(null);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/eu-bridge-protocol.test.mjs`
Expected: FAIL — `EU.listProvenanced is not a function`.

- [ ] **Step 3: Add the protocol block to `js/eu-integration.js`** (before `const api`, add names to `api`)

```js
	// --- provenance walk -------------------------------------------------------------
	// The four places an imported entry can live. Custom menus and engines
	// (new imports), edited catalog copies and engine overrides (replacements).

	function listProvenanced(settings) {
		const out = [];
		const sm = (settings && settings.siteMenus) || {};
		const se = (settings && settings.searchEngines) || {};
		for (const [id, def] of Object.entries(sm.custom || {})) if (def && def.source) out.push({ kind: 'menu', id, stored: def });
		for (const [id, def] of Object.entries(sm.edited || {})) if (def && def.source) out.push({ kind: 'menu', id, stored: def });
		for (const e of se.custom || []) if (e && e.source) out.push({ kind: 'engine', id: e.id, stored: e });
		for (const [id, ov] of Object.entries(se.overrides || {})) if (ov && ov.source) out.push({ kind: 'engine', id, stored: ov });
		return out;
	}

	function findStored(settings, kind, id) {
		const sm = (settings && settings.siteMenus) || {};
		const se = (settings && settings.searchEngines) || {};
		if (kind === 'menu') return (sm.custom && sm.custom[id]) || (sm.edited && sm.edited[id]) || null;
		return (se.custom || []).find(e => e && e.id === id) || (se.overrides && se.overrides[id]) || null;
	}

	// --- bridge protocol ----------------------------------------------------------------
	// Everything that is not exactly right yields null → the caller stays silent.

	function parseBridgeRequest(detail) {
		if (typeof detail !== 'string' || !detail) return null;
		if (new TextEncoder().encode(detail).length > LIMITS.detailMaxBytes) return null;
		let req;
		try { req = JSON.parse(detail); } catch { return null; }
		if (!req || typeof req !== 'object' || Array.isArray(req)) return null;
		if (typeof req.requestId !== 'string' || !req.requestId || req.requestId.length > LIMITS.requestIdMax) return null;
		const out = { requestId: req.requestId };
		if (Object.prototype.hasOwnProperty.call(req, 'ids')) {
			if (!Array.isArray(req.ids) || req.ids.length > LIMITS.idsMax) return null;
			for (const id of req.ids) {
				if (typeof id !== 'string' || id.length > LIMITS.idMax || !ID_RE.test(id)) return null;
			}
			out.ids = req.ids.slice();
		}
		return out;
	}

	function helloAnswer(req, version) {
		return { requestId: req.requestId, version, apiLevel: API_LEVEL };
	}

	// Origin-bound: only entries whose source.indexOrigin equals the asking
	// origin exist as far as that page is concerned. A Map keyed by indexId keeps
	// hostile ids ("constructor") off any object prototype chain.
	async function statusAnswer(req, origin, settings) {
		const byId = new Map();
		for (const e of listProvenanced(settings)) {
			const s = e.stored.source;
			if (!s || s.indexOrigin !== origin || typeof s.indexId !== 'string') continue;
			if (!byId.has(s.indexId)) byId.set(s.indexId, e);
		}
		const entries = [];
		for (const id of new Set(req.ids || [])) {
			const hit = byId.get(id);
			if (!hit) { entries.push({ id, installed: false }); continue; }
			entries.push({
				id,
				installed: true,
				version: typeof hit.stored.source.version === 'string' ? hit.stored.source.version : null,
				modified: await modifiedState(hit.stored),
			});
		}
		return { requestId: req.requestId, entries };
	}
```

Add to `api`: `listProvenanced, findStored, parseBridgeRequest, helloAnswer, statusAnswer`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/eu-bridge-protocol.test.mjs tests/eu-integration.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/eu-integration.js tests/eu-bridge-protocol.test.mjs
git commit -m "feat(eu): bridge protocol - request parsing, hello and origin-bound status answers"
```

---

### Task 4: Provenance on every import mode + baselines on the patch

**Files:**
- Modify: `js/menu-exchange.js:233-245` (`toStandardMenu`), `:268-286` (`toEngineOverride`), `:344-364` (`applyMenuTo`), `:369-391` (`applyEngineTo`)
- Modify: `js/eu-integration.js` (add `addBaselines`)
- Test: `tests/menu-exchange-provenance.test.mjs`

**Interfaces:**
- Consumes: `storedSource(source, formatId)` (`menu-exchange.js:212`), `listProvenanced`, `findStored`, `baselineHash` (Tasks 2–3)

**Two facts verified in the code before writing this task — do not "fix" them:**
1. `buildImportPatch` returns `imported: [{ kind, id, isNew }]` — `kind`, not `type`. `type` is a property of the *input* `rows`, never of the output. Every consumer reads `.kind` (`import-marker.js:35`, `menu-import-dialog.js:363`, `import-feedback.js:19`) and `tests/menu-exchange-apply.test.mjs:128` asserts it. `addBaselines` destructures `{ kind, id }` accordingly.
2. `strip()` inside `applyEngineTo` is **not** a key whitelist — it only blanks `transformEnabled`/`transformCode` and returns the same object (`menu-exchange.js:370-373`). Wrapping `toEngineOverride(value, lang, source)` in it therefore preserves `source`.
- Produces:
  - `toStandardMenu(menuValue, lang, engineIdMap, source)` — new trailing optional `source`; when given, the def carries `source: storedSource(source, menuValue.id)`
  - `toEngineOverride(engineValue, lang, source)` — same
  - `applyMenuTo` / `applyEngineTo` unchanged signatures, now pass `source` into the replace-catalog / override branches
  - `FlowMouseEuIntegration.addBaselines(patch, imported) → Promise<patch>` — deep copy of the patch where every `imported` entry's `source.baselineHash` is set; entries not in `imported` are untouched

Existing callers `toStandardMenu(v, 'en')`, `toStandardMenu(v, 'en', map)`, `toEngineOverride(v, 'en')` (tests) keep working — the new argument is optional.

- [ ] **Step 1: Write the failing tests**

```js
// tests/menu-exchange-provenance.test.mjs
import { describe, it, expect } from 'vitest';
import '../js/menu-exchange.js';
import '../js/eu-integration.js';
const X = globalThis.FlowMouseMenuExchange;
const EU = globalThis.FlowMouseEuIntegration;

const menu = (id) => ({ gesturaMenu: 1, id, version: '1.0.0', name: { en: 'M' }, icon: 'menu', patterns: ['*x.example*'], items: [{ id: 'a', label: { en: 'A' }, action: 'openCustomUrl', customUrl: 'https://x.example/a' }] });
const engine = (id) => ({ gesturaEngine: 1, id, version: '2.0.0', name: { en: 'E' }, url: 'https://e.example/?q=%s', type: 'text' });
const SITE = { type: 'site', url: 'https://gestura.eu/de/index', indexOrigin: 'https://gestura.eu' };
const FILE = { type: 'file' };

describe('provenance on every import mode', () => {
	it('toStandardMenu carries source when given, stays source-less otherwise', () => {
		expect(X.toStandardMenu(menu('google'), 'en').source).toBeUndefined();
		const def = X.toStandardMenu(menu('google'), 'en', undefined, SITE);
		expect(def.source).toEqual({ ...SITE, indexId: 'google' });
	});
	it('toEngineOverride carries source when given', () => {
		expect(X.toEngineOverride(engine('bing'), 'en').source).toBeUndefined();
		expect(X.toEngineOverride(engine('bing'), 'en', FILE).source).toEqual({ type: 'file', indexId: 'bing' });
	});
	it('replace-catalog menu keeps provenance in siteMenus.edited', () => {
		const { next } = X.applyMenuTo({ custom: {}, edited: {} }, menu('google'), { ...SITE, version: '1.0.0' }, 'en', 'replace', 'google');
		expect(next.edited.google.source).toEqual({ ...SITE, version: '1.0.0', indexId: 'google' });
	});
	it('engine override keeps provenance in searchEngines.overrides', () => {
		const { next } = X.applyEngineTo({ custom: [], overrides: {} }, engine('bing'), { ...SITE, version: '2.0.0' }, 'en', 'replace', 'bing', false);
		expect(next.overrides.bing.source).toEqual({ ...SITE, version: '2.0.0', indexId: 'bing' });
	});
	it('new custom entries still carry provenance (unchanged 2.8.0 behaviour)', () => {
		const m = X.applyMenuTo({ custom: {}, edited: {} }, menu('com.x'), FILE, 'en', 'new', null);
		expect(m.next.custom[m.id].source).toEqual({ type: 'file', indexId: 'com.x' });
		const e = X.applyEngineTo({ custom: [], overrides: {} }, engine('com.e'), FILE, 'en', 'new', null, false);
		expect(e.next.custom[0].source).toEqual({ type: 'file', indexId: 'com.e' });
	});
});

describe('addBaselines', () => {
	const current = { siteMenus: { custom: {}, edited: {}, order: [] }, searchEngines: { custom: [], overrides: {} } };

	it('sets baselineHash on every imported entry and leaves others alone', async () => {
		const rows = [
			{ type: 'engine', value: engine('bing'), source: SITE, mode: 'replace', matchId: 'bing' },
			{ type: 'engine', value: engine('com.e'), source: SITE, mode: 'new', matchId: null },
			{ type: 'menu', value: menu('google'), source: SITE, mode: 'replace', matchId: 'google' },
			{ type: 'menu', value: menu('com.x'), source: SITE, mode: 'new', matchId: null },
		];
		const cur = JSON.parse(JSON.stringify(current));
		cur.siteMenus.custom.menu_old = { name: 'Old', icon: 'menu', patterns: [], items: [], source: { type: 'file', indexId: 'old', baselineHash: 'deadbeefdeadbeef' } };
		const { patch, imported } = X.buildImportPatch(rows, cur, { lang: 'en', stripTransform: false });
		const withBase = await EU.addBaselines(patch, imported);
		for (const { kind, id } of imported) {
			const stored = EU.findStored(withBase, kind, id);
			expect(stored.source.baselineHash).toMatch(/^[0-9a-f]{16}$/);
			expect(await EU.modifiedState(stored)).toBe(false);   // modified === false right after import, every mode
		}
		expect(withBase.siteMenus.custom.menu_old.source.baselineHash).toBe('deadbeefdeadbeef');
		expect(patch.searchEngines.overrides.bing.source.baselineHash).toBeUndefined();   // input not mutated
	});
	it('Firefox transform-strip happens before the baseline', async () => {
		const withScript = { ...engine('com.s'), transformEnabled: true, transformCode: 'return q' };
		const { patch, imported } = X.buildImportPatch([{ type: 'engine', value: withScript, source: SITE, mode: 'new', matchId: null }], current, { lang: 'en', stripTransform: true });
		const withBase = await EU.addBaselines(patch, imported);
		const stored = EU.findStored(withBase, 'engine', imported[0].id);
		expect(stored.transformCode).toBe('');
		expect(await EU.modifiedState(stored)).toBe(false);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/menu-exchange-provenance.test.mjs`
Expected: FAIL — `toStandardMenu(...).source` is undefined for the SITE case, `EU.addBaselines is not a function`.

- [ ] **Step 3: Thread `source` through `js/menu-exchange.js`**

Replace `toStandardMenu` (`:236-245`) so it accepts and stores `source`:

```js
	function toStandardMenu(menuValue, lang, engineIdMap, source) {
		const lg = lang || 'en';
		const items = (menuValue.items || []).map(it => mapImportItem(it, (x) => x.id, lg, engineIdMap));
		const def = {
			name: pickLabel(menuValue.name, lg),
			icon: menuValue.icon || 'menu',
			patterns: Array.isArray(menuValue.patterns) ? menuValue.patterns.slice() : [],
			items,
		};
		// Provenance for a replaced catalog menu — without it, status and update
		// lookups could not see this legitimate import mode at all.
		const src = storedSource(source, menuValue.id);
		if (src) def.source = src;
		return def;
	}
```

(Keep the existing body's exact `items` construction if it differs from the line above — the point is the trailing `source` parameter and the `def.source` assignment; do not change how items are mapped.)

In `toEngineOverride` (`:271-286`) add the trailing parameter and, right before `return out;`:

```js
	function toEngineOverride(engineValue, lang, source) {
		// … existing body unchanged …
		const src = storedSource(source, engineValue.id);
		if (src) out.source = src;
		return out;
	}
```

In `applyMenuTo` (`:355`) pass the source: `const def = toStandardMenu(value, lang, engineIdMap, source);`
In `applyEngineTo` (`:386`) pass the source: `const ov = strip(toEngineOverride(value, lang, source));`

Update the comment at `:268-270` (it says "no id/builtin/source") to: `// Full field set, no id/builtin — the engine registry merges this over the built-in (stored at searchEngines.overrides[builtinId]). source is kept when the import supplies one.`

- [ ] **Step 4: Add `addBaselines` to `js/eu-integration.js`** (before `const api`, add to `api`)

```js
	// Sets source.baselineHash on exactly the entries an import wrote — never on
	// the rest of the patch, which carries the whole siteMenus/searchEngines branch
	// and therefore every previously imported (possibly edited) entry too.
	async function addBaselines(patch, imported) {
		const out = JSON.parse(JSON.stringify(patch || {}));
		for (const { kind, id } of imported || []) {
			const stored = findStored(out, kind, id);
			if (stored && stored.source) stored.source.baselineHash = await baselineHash(stored);
		}
		return out;
	}
```

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — including the pre-existing `tests/menu-exchange.test.mjs` and `tests/menu-exchange-engine-deps.test.mjs` (they call the two functions without `source`).

- [ ] **Step 6: Commit**

```bash
git add js/menu-exchange.js js/eu-integration.js tests/menu-exchange-provenance.test.mjs
git commit -m "feat(exchange): provenance on catalog replacements and engine overrides; baselines on import"
```

---

### Task 5: Three-case dedup — `matchImport`

**Files:**
- Modify: `js/menu-exchange.js` (new function + export)
- Test: `tests/menu-exchange-match.test.mjs`

**Interfaces:**
- Produces: `matchImport(kind, value, source, branch, catalog)` where `kind` is `'menu'|'engine'`, `value` a validated exchange value, `source` the import's source (`indexOrigin` present ⇒ qualified), `branch` is `settings.siteMenus` or `settings.searchEngines`, `catalog` the built-in catalog array. Returns:
  - `{ id, name, own: true }` — exactly one own entry to update
  - `{ ...catalogEntry, own: false }` — a catalog entry to replace
  - `{ ambiguous: true, candidates: [{ id, name, indexOrigin }] }` — the dialog must offer "import as new" only
  - `null` — nothing matches; import as new

Rules (spec section 4): a **qualified** import matches only entries with the same `(indexOrigin, indexId)`; an **unqualified** import matches only among unqualified entries and **never automatically overwrites a qualified one**; more than one candidate, or any qualified entry in the way of an unqualified import, is ambiguous.

One more collision, easy to miss: replacing a **catalog** entry writes into a single slot — `siteMenus.edited[catalogId]` or `searchEngines.overrides[builtinId]`. Two origins cannot both own that slot, and neither can an index import and the user's own hand-edit of the catalog entry. So when the catalog fallback would apply but something already occupies that slot which the qualified match above did not claim, the result is `ambiguous` as well. Without that check the dialog would offer "replace the standard entry" and silently overwrite the user's edited copy, or another origin's entry.

This applies to every import path, file imports included, and it changes 2.8.0 behavior in two visible ways. A hand-edited catalog entry is no longer overwritten by an import of the same id — the dialog imports a new entry instead. And a catalog replacement imported **before** R1 carries no provenance (`toStandardMenu` dropped it), so re-importing it now reads as an occupied slot and also lands as a new entry; those entries have to be tidied up by hand once, the same one-off as the 2.8.0 dedup change. Both are the safe direction: nothing is overwritten that Gestura cannot prove is the same thing.

- [ ] **Step 1: Write the failing tests**

```js
// tests/menu-exchange-match.test.mjs
import { describe, it, expect } from 'vitest';
import '../js/menu-exchange.js';
const X = globalThis.FlowMouseMenuExchange;

const PROD = 'https://gestura.eu';
const DEV = 'http://localhost:5173';
const s = (indexId, indexOrigin) => ({ type: indexOrigin ? 'site' : 'file', indexId, ...(indexOrigin ? { indexOrigin } : {}) });
const val = { id: 'com.same' };
const CAT_MENUS = [{ id: 'google', name: 'Google' }];

const menus = (custom) => ({ custom, edited: {} });
const engines = (custom, overrides = {}) => ({ custom, overrides });

describe('matchImport — the same id from production, dev origin and a file', () => {
	const branch = menus({
		m_prod: { name: 'Prod', source: s('com.same', PROD) },
		m_dev: { name: 'Dev', source: s('com.same', DEV) },
		m_file: { name: 'File', source: s('com.same', null) },
	});
	it('a production import matches only the production entry', () => {
		expect(X.matchImport('menu', val, { type: 'site', indexOrigin: PROD }, branch, [])).toEqual({ id: 'm_prod', name: 'Prod', own: true });
	});
	it('a dev import matches only the dev entry', () => {
		expect(X.matchImport('menu', val, { type: 'site', indexOrigin: DEV }, branch, [])).toEqual({ id: 'm_dev', name: 'Dev', own: true });
	});
	it('a file import with qualified entries in the way is ambiguous', () => {
		const m = X.matchImport('menu', val, { type: 'file' }, branch, []);
		expect(m.ambiguous).toBe(true);
		expect(m.candidates.map(c => c.id).sort()).toEqual(['m_dev', 'm_file', 'm_prod']);
	});
});

describe('matchImport — unqualified imports', () => {
	it('matches the single unqualified entry when nothing qualified exists', () => {
		const branch = menus({ m_file: { name: 'File', source: s('com.same', null) } });
		expect(X.matchImport('menu', val, { type: 'file' }, branch, [])).toEqual({ id: 'm_file', name: 'File', own: true });
	});
	it('never automatically overwrites a qualified entry', () => {
		const branch = menus({ m_prod: { name: 'Prod', source: s('com.same', PROD) } });
		expect(X.matchImport('menu', val, { type: 'file' }, branch, []).ambiguous).toBe(true);
	});
	it('two unqualified entries are ambiguous', () => {
		const branch = menus({ a: { name: 'A', source: s('com.same', null) }, b: { name: 'B', source: s('com.same', null) } });
		expect(X.matchImport('menu', val, { type: 'url', url: 'https://x/y.json' }, branch, []).ambiguous).toBe(true);
	});
});

describe('matchImport — qualified imports', () => {
	it('ignores unqualified entries with the same id and falls through', () => {
		const branch = menus({ m_file: { name: 'File', source: s('com.same', null) } });
		expect(X.matchImport('menu', val, { type: 'site', indexOrigin: PROD }, branch, [])).toBe(null);
	});
	it('two entries from the same origin are ambiguous', () => {
		const branch = menus({ a: { name: 'A', source: s('com.same', PROD) }, b: { name: 'B', source: s('com.same', PROD) } });
		expect(X.matchImport('menu', val, { type: 'site', indexOrigin: PROD }, branch, []).ambiguous).toBe(true);
	});
});

describe('matchImport — catalog fallback and storage places', () => {
	it('falls back to the catalog entry with own:false', () => {
		expect(X.matchImport('menu', { id: 'google' }, { type: 'file' }, menus({}), CAT_MENUS)).toEqual({ id: 'google', name: 'Google', own: false });
	});
	it('an occupied catalog slot is ambiguous, never a blind "replace the standard entry"', () => {
		// The user edited the catalog menu by hand: no provenance at all.
		const handEdited = { custom: {}, edited: { google: { name: 'My Google' } } };
		expect(X.matchImport('menu', { id: 'google' }, { type: 'site', indexOrigin: PROD }, handEdited, CAT_MENUS))
			.toEqual({ ambiguous: true, candidates: [{ id: 'google', name: 'My Google', indexOrigin: null }] });
		// Another origin already owns the single edited[] slot.
		const devOwned = { custom: {}, edited: { google: { name: 'Dev Google', source: s('google', DEV) } } };
		expect(X.matchImport('menu', { id: 'google' }, { type: 'site', indexOrigin: PROD }, devOwned, CAT_MENUS).ambiguous).toBe(true);
		// Same origin: still a normal update, not ambiguous.
		const ours = { custom: {}, edited: { google: { name: 'Ours', source: s('google', PROD) } } };
		expect(X.matchImport('menu', { id: 'google' }, { type: 'site', indexOrigin: PROD }, ours, CAT_MENUS)).toEqual({ id: 'google', name: 'Ours', own: true });
	});
	it('an occupied override slot is ambiguous for engines too', () => {
		const CAT_ENGINES = [{ id: 'bing', name: 'Bing' }];
		expect(X.matchImport('engine', { id: 'bing' }, { type: 'site', indexOrigin: PROD }, engines([], { bing: { name: 'My Bing' } }), CAT_ENGINES).ambiguous).toBe(true);
		expect(X.matchImport('engine', { id: 'bing' }, { type: 'site', indexOrigin: PROD }, engines([]), CAT_ENGINES)).toEqual({ id: 'bing', name: 'Bing', own: false });
	});
	it('an edited catalog copy with provenance is an own match on its catalog id', () => {
		const branch = { custom: {}, edited: { google: { name: 'G2', source: s('google', PROD) } } };
		expect(X.matchImport('menu', { id: 'google' }, { type: 'site', indexOrigin: PROD }, branch, CAT_MENUS)).toEqual({ id: 'google', name: 'G2', own: true });
	});
	it('engines: custom list and overrides are both searched', () => {
		const branch = engines([{ id: 'eng_1', name: 'E', source: s('com.e', PROD) }], { bing: { name: 'B2', source: s('bing', PROD) } });
		expect(X.matchImport('engine', { id: 'com.e' }, { type: 'site', indexOrigin: PROD }, branch, [])).toEqual({ id: 'eng_1', name: 'E', own: true });
		expect(X.matchImport('engine', { id: 'bing' }, { type: 'site', indexOrigin: PROD }, branch, [])).toEqual({ id: 'bing', name: 'B2', own: true });
	});
	it('returns null when nothing matches anywhere', () => {
		expect(X.matchImport('engine', { id: 'com.none' }, { type: 'file' }, engines([]), [])).toBe(null);
	});
	it('tolerates missing branches', () => {
		expect(X.matchImport('menu', val, { type: 'file' }, undefined, undefined)).toBe(null);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/menu-exchange-match.test.mjs`
Expected: FAIL — `X.matchImport is not a function`.

- [ ] **Step 3: Add `matchImport` to `js/menu-exchange.js`** (next to `applyEngineTo`, and add `matchImport` to the `api` object at `:435`)

```js
	// --- Wiedererkennung eines Imports (drei Fälle, Spec Abschnitt 4) --------------
	// Lag bis 2.8.0 im Dialog (#menuMatch/#engineMatch) und verglich nur die
	// indexId - die aber auch eine Datei behaupten kann. Ein qualifizierter Import
	// (source.indexOrigin gesetzt) trifft ausschließlich das Paar (indexOrigin,
	// indexId); ein unqualifizierter trifft nur unqualifizierte Einträge und
	// überschreibt nie automatisch einen qualifizierten. Mehrdeutig → der Dialog
	// bietet nur "als neu importieren" an und rät nicht.

	function provenancedEntries(kind, branch) {
		const out = [];
		const b = branch || {};
		if (kind === 'menu') {
			for (const [id, def] of Object.entries(b.custom || {})) if (def && def.source) out.push({ id, name: def.name, source: def.source });
			for (const [id, def] of Object.entries(b.edited || {})) if (def && def.source) out.push({ id, name: def.name, source: def.source });
		} else {
			for (const e of b.custom || []) if (e && e.source) out.push({ id: e.id, name: e.name, source: e.source });
			for (const [id, ov] of Object.entries(b.overrides || {})) if (ov && ov.source) out.push({ id, name: ov.name, source: ov.source });
		}
		return out;
	}

	function matchImport(kind, value, source, branch, catalog) {
		const withId = provenancedEntries(kind, branch).filter(e => e.source.indexId === value.id);
		const candidates = (list) => ({ ambiguous: true, candidates: list.map(e => ({ id: e.id, name: e.name, indexOrigin: e.source.indexOrigin || null })) });
		const origin = source && typeof source.indexOrigin === 'string' ? source.indexOrigin : null;
		if (origin) {
			const same = withId.filter(e => e.source.indexOrigin === origin);
			if (same.length === 1) return { id: same[0].id, name: same[0].name, own: true };
			if (same.length > 1) return candidates(same);
			// Nothing of our own from this origin: unqualified twins are not ours to touch.
		} else {
			const unqualified = withId.filter(e => !e.source.indexOrigin);
			if (withId.length === 1 && unqualified.length === 1) return { id: unqualified[0].id, name: unqualified[0].name, own: true };
			if (withId.length >= 1) return candidates(withId);
		}
		const cat = (catalog || []).find(c => c && c.id === value.id);
		if (!cat) return null;
		// Ein Katalog-Eintrag wird in genau einen Platz geschrieben: edited[id] bzw.
		// overrides[id]. Was dort schon liegt und oben nicht als eigener Treffer
		// erkannt wurde, gehört jemand anderem - der Handarbeit des Nutzers oder
		// einer anderen Origin. "Standard-Eintrag ersetzen" wäre dafür die falsche
		// Beschreibung, also lieber mehrdeutig.
		const b = branch || {};
		const occupant = kind === 'menu' ? (b.edited || {})[value.id] : (b.overrides || {})[value.id];
		if (occupant) {
			return { ambiguous: true, candidates: [{ id: value.id, name: occupant.name, indexOrigin: (occupant.source && occupant.source.indexOrigin) || null }] };
		}
		return { ...cat, own: false };
	}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/menu-exchange-match.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/menu-exchange.js tests/menu-exchange-match.test.mjs
git commit -m "feat(exchange): matchImport - origin-bound three-case dedup as a pure function"
```

---

### Task 6: Provenance survives resolution and editing (engines)

**Files:**
- Modify: `js/engine-registry.js:9-26` (`toEngine`)
- Modify: `js/components/engine-manager.js:352-378` (`#getResolvedEngines` custom loop), `:447-485` (`#saveEdit`), `:526-538` (`#saveAdd`)
- Test: `tests/engine-registry.test.mjs` (append)

Menus already survive: `site-menu-manager.js#saveDef` mutates a full clone from `menu-model.getBaseMenu`, and `menu-model.js` clones whole objects. Engines do not: `toEngine` rebuilds a fixed 14-field object and `#saveEdit` rebuilds from the draft. This task closes both (spec section 4, "Provenance survives mutation").

- [ ] **Step 1: Append the failing registry test**

```js
// append to tests/engine-registry.test.mjs (uses the file's existing imports of resolveEngines / getEngineById)
describe('source pass-through', () => {
	const CAT = [{ id: 'bing', name: 'Bing', url: 'https://b/%s', type: 'text' }];
	it('custom engines keep source through resolveEngines and getEngineById', () => {
		const se = { custom: [{ id: 'eng_1', name: 'E', url: 'https://e/%s', type: 'text', source: { type: 'site', indexId: 'com.e', indexOrigin: 'https://gestura.eu' } }], overrides: {}, hidden: [], order: [] };
		expect(resolveEngines(CAT, se).find(e => e.id === 'eng_1').source).toEqual(se.custom[0].source);
		expect(getEngineById(CAT, se, 'eng_1').source).toEqual(se.custom[0].source);
	});
	it('an override with source exposes it on the resolved builtin', () => {
		const se = { custom: [], overrides: { bing: { name: 'B2', source: { type: 'file', indexId: 'bing' } } }, hidden: [], order: [] };
		expect(resolveEngines(CAT, se).find(e => e.id === 'bing').source).toEqual({ type: 'file', indexId: 'bing' });
	});
	it('engines without source have no source key set to a value', () => {
		expect(resolveEngines(CAT, { custom: [], overrides: {}, hidden: [], order: [] })[0].source).toBeUndefined();
	});
});
```

If the file imports differ (check its first lines: `const { resolveEngines, getEngineById } = globalThis.FlowMouseEngineRegistry;` or similar), use those names.

The editor itself lives in a Lit component and cannot run under vitest, so append a pure test of the *rule* it has to obey to `tests/menu-exchange-provenance.test.mjs` — an edit keeps `source`, and the entry then reports `modified: true`:

```js
describe('an edited import stays an import', () => {
	it('keeps provenance and reports modified after the editor rebuilds an entry', async () => {
		const { patch, imported } = X.buildImportPatch(
			[{ type: 'engine', value: engine('com.e'), source: SITE, mode: 'new', matchId: null }],
			{ siteMenus: { custom: {}, edited: {} }, searchEngines: { custom: [], overrides: {} } },
			{ lang: 'en', stripTransform: false },
		);
		const saved = await EU.addBaselines(patch, imported);
		const stored = EU.findStored(saved, 'engine', imported[0].id);

		// What engine-manager's #saveEdit does: rebuild from a fixed field list.
		// With `source` carried over (Task 6) the entry stays recognisable.
		const rebuilt = { id: stored.id, name: 'renamed by the user', url: stored.url, type: stored.type, builtin: false, source: stored.source };
		expect(await EU.modifiedState(rebuilt)).toBe(true);

		// Dropping `source` - the bug this task fixes - loses the entry entirely.
		const { source, ...withoutSource } = rebuilt;
		expect(EU.listProvenanced({ searchEngines: { custom: [withoutSource], overrides: {} } })).toEqual([]);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/engine-registry.test.mjs`
Expected: FAIL — `source` is `undefined` where an object is expected.

- [ ] **Step 3: Pass `source` through `toEngine` in `js/engine-registry.js`**

Inside `toEngine(e, builtin)` (`:9-26`) add one property to the returned object, after `type`:

```js
			source: e.source,
```

`mergeOverride` (`:2-4`) is a spread, so an override's `source` reaches `toEngine` unchanged.

- [ ] **Step 4: Preserve `source` in `js/components/engine-manager.js`**

In `#getResolvedEngines`, custom loop (`:357-375`): add `source: c.source,` after `type:`.

In `#saveEdit` builtin branch (`:459-472`): capture the previous override and carry its `source`:

```js
				const overrides = { ...(se.overrides || {}) };
				const prev = overrides[id] || {};
				overrides[id] = {
					name,
					url,
					plus: draft.plus,
					slug: draft.slug,
					suffix: draft.suffix,
					clipboardMode: draft.clipboardMode,
					transformEnabled: draft.transformEnabled,
					transformCode: draft.transformCode,
					transformClipboard: draft.transformClipboard,
					transformRawResult: draft.transformRawResult,
					rawResult: draft.rawResult,
					...(prev.source ? { source: prev.source } : {}),
				};
```

In `#saveEdit` custom branch (`:475-481`): the rebuilt object ends with `type: c.type };` — change the tail to `type: c.type, ...(c.source ? { source: c.source } : {}) };`.

`#saveAdd` (`:526-538`) creates a hand-made engine — no `source`, correct as is. `#deleteCustom` and `#resetBuiltin` remove the entry/override and with it the provenance — that is the only allowed removal path.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/engine-registry.js js/components/engine-manager.js tests/engine-registry.test.mjs
git commit -m "fix(engines): keep source provenance through the resolver and the editor"
```

---

### Task 7: `js/eu-local.js` — the storage.local wrapper, and script registration

**Files:**
- Create: `js/eu-local.js`
- Modify: `manifest.json:41-52` (`content_scripts.js`), `pages/options.html:24-35`, `js/background.js:1-5` (`importScripts`)

**Interfaces:**
- Consumes: `FlowMouseEuIntegration.normalizeLocal`, `.effectiveEnabled`
- Produces (global `GesturaEuLocal`):
  - `KEY = 'euIntegration'`
  - `read() → Promise<local>` — normalized `{ euIntegration: {...} }`, from cache after the first load
  - `current() → local` — synchronous snapshot; equals the defaults (switch off) until the first load resolved
  - `write(patch) → Promise<local>` — merges `patch` into `euIntegration` and persists
  - `isEnabled() → Promise<boolean>` — `effectiveEnabled(await read())`
  - `onChange(fn) → unsubscribe` — `fn(local)` after every `storage.local` change of the key (own writes included)

No unit test: the file is a thin `chrome.*` adapter and the harness has no chrome stub; behavior is verified in Task 14.

- [ ] **Step 1: Create `js/eu-local.js`**

```js
// The only reader/writer of the website-integration state in chrome.storage.local.
// One key, a live cache fed by storage.onChanged, and the effective-enabled
// check that every gated path calls right before it acts. Runs in content
// scripts (all frames), the service worker and the options page alike — hence
// a classic script with a root global and no window-only APIs.
(function (root) {
	'use strict';

	const EU = root.FlowMouseEuIntegration;
	const KEY = 'euIntegration';
	let cache = EU.normalizeLocal({});
	let loaded = false;
	let loading = null;
	const listeners = new Set();

	function absorb(raw) {
		cache = EU.normalizeLocal(raw);
		loaded = true;
		return cache;
	}

	function load() {
		if (!loading) {
			loading = chrome.storage.local.get(KEY).then(absorb).catch(() => absorb({}));
		}
		return loading;
	}

	async function read() {
		return loaded ? cache : load();
	}

	function current() {
		return cache;
	}

	async function write(patch) {
		const next = { ...(await read()).euIntegration, ...(patch || {}) };
		await chrome.storage.local.set({ [KEY]: next });
		return absorb({ [KEY]: next });
	}

	async function isEnabled() {
		return EU.effectiveEnabled(await read());
	}

	function onChange(fn) {
		listeners.add(fn);
		return () => listeners.delete(fn);
	}

	if (chrome.storage && chrome.storage.onChanged) {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area !== 'local' || !changes[KEY]) return;
			absorb({ [KEY]: changes[KEY].newValue });
			for (const fn of listeners) { try { fn(cache); } catch { /* a listener must not break the others */ } }
		});
	}

	load();

	root.GesturaEuLocal = { KEY, read, current, write, isEnabled, onChange };
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 2: Register the scripts**

`manifest.json` — in `content_scripts[0].js`, insert after `"js/constants.js"`:

```json
                "js/eu-integration.js",
                "js/eu-local.js",
```

and insert `"js/eu-bridge.js",` immediately before `"js/content.js"` (the file is created in Task 9; the extension refuses to load until it exists, so create an empty `js/eu-bridge.js` containing only `// filled in by Task 9` now).

`pages/options.html` — after `<script src="../js/constants.js"></script>` add:

```html
	<script src="../js/eu-integration.js"></script>
	<script src="../js/eu-local.js"></script>
```

`js/background.js` — the file starts with five `importScripts(...)` lines; add after them:

```js
importScripts('eu-integration.js');
importScripts('eu-local.js');
```

- [ ] **Step 3: Smoke-test the load**

Load the repo folder at `chrome://extensions` (reload the card if already loaded). Open the service-worker console: `GesturaEuLocal.current()` prints `{ euIntegration: { enabled: false, consent: null, devOrigin: '' } }`. Open `pages/options.html` DevTools console: the same. No errors on any page's console from the content scripts.

- [ ] **Step 4: Run the suite and commit**

Run: `npm test` — PASS.

```bash
git add js/eu-local.js js/eu-bridge.js manifest.json pages/options.html js/background.js
git commit -m "feat(eu): storage.local wrapper for the integration state; register scripts"
```

---

### Task 8: Gate every website-triggered import path

**Files:**
- Modify: `js/content.js:69-176` (hand-off IIFE)
- Modify: `js/background.js:1284-1298` (`stashPendingImport`), `:1334-1375` (`importFromSite`), `:1384-1397` (`importInline`), `:1310-1324` (`reportImportResult`)
- Modify: `js/components/options-page.js:359-394` (`#checkPendingImport`)
- Modify: `js/components/site-menu-manager.js:233-240`, `js/components/engine-manager.js:700-707` (`#importUrl`)

**Interfaces:**
- Consumes: `GesturaEuLocal.current/isEnabled/read`, `FlowMouseEuIntegration.effectiveEnabled/qualifiedOrigin`
- Produces: `pendingImport` in `chrome.storage.session` gains `indexOrigin: string | null`; import sources gain `indexOrigin` when qualified; new worker error `'integrationDisabled'`

Spec section 2: with tier 1 off, Gestura ignores `rel="gestura-menu"` links, `data-gestura-inline` hand-offs and `gestura:import` events, and sends no `gestura:import-result`. The content script gates first (so an operator link simply navigates as if no extension were installed); the worker verifies again (defense in depth, and it covers a stale content script).

- [ ] **Step 1: Gate the content-script hand-off in `js/content.js`**

At the top of the IIFE body (after `'use strict';` and the `__gesturaMenuLinkImport` guard), add:

```js
	// The switch is read at every decision point, never captured across an
	// async gap: GesturaEuLocal.current() is a live snapshot fed by
	// storage.onChanged. Until the first load resolves it reports "off".
	function integrationOn() {
		const local = self.GesturaEuLocal;
		return !!local && self.FlowMouseEuIntegration.effectiveEnabled(local.current());
	}
```

In the click listener (`:138`), directly after the `if (!e.isTrusted) return;` line: `if (!integrationOn()) return;` — before `closest()`, so a link is not even prevented and just navigates.

In `onInlinePayload` (`:87`), after `closeInlineWindow();` and before the `sendMessage`: `if (!integrationOn()) return;`.

In the `gesturaImportResult` listener (`:115`), before `document.dispatchEvent(...)`: `if (!integrationOn()) return;` — a result arriving after the switch went off is dropped (the worker also refuses to send it, see Step 2).

Update the block comment at `:56-68` with one sentence: `Both paths are inert while the website integration (chrome.storage.local, key euIntegration) is off — the default.`

- [ ] **Step 2: Gate and qualify in `js/background.js`**

`stashPendingImport` gains a fourth parameter and stores it:

```js
async function stashPendingImport(json, url, sender, indexOrigin) {
	await chrome.storage.session.set({
		pendingImport: {
			json, url, ts: Date.now(),
			tabId: sender && sender.tab ? sender.tab.id : null,
			frameId: sender && typeof sender.frameId === 'number' ? sender.frameId : 0,
			indexOrigin: indexOrigin || null,
		},
	});
	await openOptionsPage('');
	return { success: true };
}
```

`importFromSite(request, sender)` — as the first statement: `if (!(await GesturaEuLocal.isEnabled())) return { success: false, error: 'integrationDisabled' };`. Where the fetch response is handled (before `JSON.parse(text)`), keep the `Response` in a variable if it is not already (`const response = await fetch(...)`), and at the end call `stashPendingImport(json, url.href, sender, FlowMouseEuIntegration.qualifiedOrigin(response.url, await GesturaEuLocal.read()))` — the **final** URL after redirects decides.

`importInline(request, sender)` — same first statement; the stash call becomes:

```js
	const pageUrl = sender.url || (sender.tab && sender.tab.url) || '';
	return await stashPendingImport(json, pageUrl, sender, FlowMouseEuIntegration.qualifiedOrigin(pageUrl, await GesturaEuLocal.read()));
```

`reportImportResult(request)` — first statement: `if (!(await GesturaEuLocal.isEnabled())) return { success: false, error: 'integrationDisabled' };` (no result after switch-off).

- [ ] **Step 3: Pass `indexOrigin` into the import source**

`js/components/options-page.js#checkPendingImport` (`:392`): replace the `openWith` call's source with

```js
		dialog.openWith(pending.json,
			{ type: 'site', url: pending.url, ...(pending.indexOrigin ? { indexOrigin: pending.indexOrigin } : {}) },
			{ tabId: pending.tabId, frameId: pending.frameId });
```

`#importUrl(url)` in **both** `site-menu-manager.js` and `engine-manager.js` (identical bodies) becomes:

```js
	async #importUrl(url) {
		if (!url) return;
		try {
			const res = await fetch(url);
			const obj = await res.json();
			// Provenance from the final URL after redirects, never from what was typed.
			const indexOrigin = window.FlowMouseEuIntegration.qualifiedOrigin(res.url, await window.GesturaEuLocal.read());
			this.#dialog().openWith(obj, { type: 'url', url, ...(indexOrigin ? { indexOrigin } : {}) });
		} catch { this.#dialog().openWith({}, { type: 'url', url }); }
	}
```

Manual URL imports are **not** gated (spec: manual imports stay available); they merely record provenance when the origin is allowed.

- [ ] **Step 4: Verify by hand**

Reload the extension. With the switch off (default), on any page a `rel="gestura-menu"` link navigates to the JSON; a `data-gestura-inline` button does nothing Gestura-related. Set the switch on directly for now (the UI arrives in Task 12): in the worker console `await GesturaEuLocal.write({ enabled: true, consent: { version: 1, date: new Date().toISOString() } })`; the hand-off works as in 2.8.0; `chrome.storage.session.get('pendingImport')` during the dialog shows `indexOrigin: null` for a non-allowed page. `await GesturaEuLocal.write({ enabled: false })` — the next click is inert again without reloading the page.

- [ ] **Step 5: Run the suite and commit**

Run: `npm test` — PASS.

```bash
git add js/content.js js/background.js js/components/options-page.js js/components/site-menu-manager.js js/components/engine-manager.js
git commit -m "feat(eu): gate every website-triggered import behind the integration switch; record indexOrigin"
```

---

### Task 9: `js/eu-bridge.js` — the content-script bridge

**Files:**
- Create (fill): `js/eu-bridge.js`

**Interfaces:**
- Consumes: `FlowMouseEuIntegration.parseBridgeRequest/helloAnswer/statusAnswer/allowedOrigins/effectiveEnabled`, `GesturaEuLocal.read`
- Produces: answers `gestura:hello-result` and `gestura:query-status-result` on `document`, `detail` = JSON string

The bridge runs in all frames; `location.origin` of the frame is what counts (an iframe's answers stay inside that iframe's realm).

- [ ] **Step 1: Write `js/eu-bridge.js`**

```js
// The page ↔ extension bridge for gestura.eu (and one configured dev origin).
// Pull only: the page asks, we answer — and only while the website integration
// is effectively on and this frame's origin is allowed. Every other case is
// silence, indistinguishable from "not installed"; that silence is the
// fingerprinting protection. Wire contract as in the 2.8.0 hand-off: events on
// document, detail as a JSON string (Firefox Xray-safe, size-checkable before
// parsing).
(function () {
	'use strict';
	if (window.__gesturaEuBridge) return;
	window.__gesturaEuBridge = true;

	const EU = self.FlowMouseEuIntegration;
	const LOCAL = self.GesturaEuLocal;
	if (!EU || !LOCAL) return;

	// Cheap synchronous exit for origins that can never be allowed: the production
	// origin is https, and a dev origin is either https or http on a loopback host.
	// Everything else leaves without touching storage or registering a listener.
	// Registration itself stays synchronous on purpose - a page may ask at
	// document_start, and a listener deferred until the state load finished would
	// miss that request.
	const loopback = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
	if (location.protocol !== 'https:' && !(location.protocol === 'http:' && loopback)) return;

	function reply(type, answer) {
		document.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(answer), bubbles: true }));
	}

	// Re-read the switch and the origin list on every request — never across an
	// async gap: the local state is awaited first, then checked, then answered.
	async function gate() {
		const local = await LOCAL.read();
		if (!EU.effectiveEnabled(local)) return false;
		return EU.allowedOrigins(local).includes(location.origin);
	}

	document.addEventListener('gestura:hello', async (e) => {
		const req = EU.parseBridgeRequest(e.detail);
		if (!req) return;
		if (!(await gate())) return;
		reply('gestura:hello-result', EU.helloAnswer(req, chrome.runtime.getManifest().version));
	}, true);

	document.addEventListener('gestura:query-status', async (e) => {
		const req = EU.parseBridgeRequest(e.detail);
		// A request without `ids` is well-formed, just pointless: statusAnswer
		// returns an empty array for it. Only a request that fails to parse gets
		// silence - answering the empty case keeps the contract honest.
		if (!req) return;
		if (!(await gate())) return;
		let settings;
		try { settings = await chrome.storage.sync.get(['siteMenus', 'searchEngines']); } catch { return; }
		// The switch may have flipped while we read the settings.
		if (!(await gate())) return;
		reply('gestura:query-status-result', await EU.statusAnswer(req, location.origin, settings));
	}, true);
})();
```

- [ ] **Step 2: Verify with the console**

Reload the extension. Enable the switch in the worker console as in Task 8 Step 4 and set `devOrigin` to a local origin you can serve, e.g. `await GesturaEuLocal.write({ devOrigin: 'http://localhost:8123' })`. Serve any folder there (`npx serve -l 8123 docs/test-bundles` or `python -m http.server 8123`), open a page from it and run in its console:

```js
document.addEventListener('gestura:hello-result', e => console.log('hello', JSON.parse(e.detail)));
document.dispatchEvent(new CustomEvent('gestura:hello', { detail: JSON.stringify({ requestId: 'r1' }) }));
```

Expected: `hello { requestId: 'r1', version: '2.8.0', apiLevel: 1 }`. Repeat on any other origin: no output. Turn the switch off: no output on the dev origin either.

- [ ] **Step 3: Commit**

```bash
git add js/eu-bridge.js
git commit -m "feat(eu): content-script bridge answering hello and query-status on allowed origins"
```

---

### Task 10: i18n keys in all 39 locales + test enforcement

**Files:**
- Modify: `_locales/<each of 39>/messages.json`
- Modify: `tests/site-menu-locales.test.mjs:7`

**Interfaces:**
- Produces the 15 keys below, used by Tasks 11 and 12.

- [ ] **Step 1: Extend the locale guard**

In `tests/site-menu-locales.test.mjs:7` add `'euIntegration'` to `NEW_KEY_PREFIXES`:

```js
const NEW_KEY_PREFIXES = ['siteMenuItem', 'siteMenu', 'iconPicker', 'menuMode', 'fork', 'storage', 'euIntegration'];
```

- [ ] **Step 2: Add the English keys to `_locales/en/messages.json`**

```json
	"euIntegrationTitle": { "message": "Website integration" },
	"euIntegrationToggle": { "message": "Allow websites to talk to Gestura" },
	"euIntegrationToggleDesc": { "message": "Off by default. While off, Gestura ignores every hand-off a website triggers and has no contact with gestura.eu. Importing files here in the settings always works." },
	"euIntegrationConsentTitle": { "message": "Before you enable this" },
	"euIntegrationConsentPoint1": { "message": "Websites can hand menus and search engines to the import dialog. Nothing is imported without your confirmation." },
	"euIntegrationConsentPoint2": { "message": "gestura.eu pages may ask which of their entries you have installed, in which version, and whether you changed them. Gestura answers only about entries you imported from gestura.eu, and only to gestura.eu — never about anything else you have." },
	"euIntegrationConsentPoint3": { "message": "Gestura tells gestura.eu pages its version number. No account, no personal data, and nothing at all is sent while you are not on gestura.eu." },
	"euIntegrationConsentAccept": { "message": "Enable" },
	"euIntegrationConsentCancel": { "message": "Not now" },
	"euIntegrationReconfirmTitle": { "message": "Please confirm again" },
	"euIntegrationReconfirmDesc": { "message": "The integration has changed since you enabled it. It stays off until you have read and confirmed the new description." },
	"euIntegrationDevOrigin": { "message": "Developer origin" },
	"euIntegrationDevOriginDesc": { "message": "One additional origin treated like gestura.eu, for testing a local index — https://host or http://localhost:port, no path. Leave empty unless you develop the index." },
	"euIntegrationDevOriginInvalid": { "message": "Not a valid origin. Use https://host or http://localhost:port, without a path." },
	"euIntegrationImportAmbiguous": { "message": "Several of your entries share this ID — it will be imported as a new entry." }
```

(15 keys.) Place them next to the other `exchange*` / `siteMenu*` keys; keep the file's existing 4-space or tab indentation.

- [ ] **Step 3: Add the German keys to `_locales/de/messages.json`**

```json
	"euIntegrationTitle": { "message": "Website-Integration" },
	"euIntegrationToggle": { "message": "Websites dürfen mit Gestura kommunizieren" },
	"euIntegrationToggleDesc": { "message": "Standardmäßig aus. Solange aus, ignoriert Gestura jede von einer Website ausgelöste Übergabe und hat keinen Kontakt zu gestura.eu. Der Datei-Import hier in den Einstellungen funktioniert immer." },
	"euIntegrationConsentTitle": { "message": "Bevor du einschaltest" },
	"euIntegrationConsentPoint1": { "message": "Websites können Menüs und Suchmaschinen an den Import-Dialog übergeben. Ohne deine Bestätigung wird nichts importiert." },
	"euIntegrationConsentPoint2": { "message": "gestura.eu-Seiten dürfen fragen, welche ihrer Einträge du installiert hast, in welcher Version und ob du sie verändert hast. Gestura antwortet nur zu Einträgen, die du von gestura.eu importiert hast, und nur an gestura.eu – nie zu irgendetwas anderem, das du hast." },
	"euIntegrationConsentPoint3": { "message": "Gestura teilt gestura.eu-Seiten seine Versionsnummer mit. Kein Konto, keine personenbezogenen Daten, und solange du nicht auf gestura.eu bist, wird gar nichts gesendet." },
	"euIntegrationConsentAccept": { "message": "Einschalten" },
	"euIntegrationConsentCancel": { "message": "Jetzt nicht" },
	"euIntegrationReconfirmTitle": { "message": "Bitte erneut bestätigen" },
	"euIntegrationReconfirmDesc": { "message": "Die Integration hat sich geändert, seit du sie eingeschaltet hast. Sie bleibt aus, bis du die neue Beschreibung gelesen und bestätigt hast." },
	"euIntegrationDevOrigin": { "message": "Entwickler-Origin" },
	"euIntegrationDevOriginDesc": { "message": "Eine zusätzliche Origin, die wie gestura.eu behandelt wird, zum Testen eines lokalen Index – https://host oder http://localhost:port, ohne Pfad. Leer lassen, außer du entwickelst den Index." },
	"euIntegrationDevOriginInvalid": { "message": "Keine gültige Origin. Nutze https://host oder http://localhost:port, ohne Pfad." },
	"euIntegrationImportAmbiguous": { "message": "Mehrere deiner Einträge tragen diese ID – er wird als neuer Eintrag importiert." }
```

- [ ] **Step 4: Run the guard to see which locales are missing**

Run: `npx vitest run tests/site-menu-locales.test.mjs`
Expected: FAIL for 37 locales, each listing the 15 missing keys.

- [ ] **Step 5: Translate into the remaining 37 locales**

For each of `ar bg bn cs da el es es_419 fa fi fil fr he hi hr hu id it ja ko ms nl no pl pt_BR pt_PT ro ru sk sr sv th tr uk vi zh_CN zh_TW`, add the 15 keys with a faithful translation of the English text. Where the locale already translates a word used here for another key (e.g. "Enable", "Not now", "Version"), reuse that locale's existing wording. Keep `gestura.eu`, `https://host`, `http://localhost:port` verbatim. Do not use `$…$` anywhere.

- [ ] **Step 6: Run both locale guards**

Run: `npx vitest run tests/site-menu-locales.test.mjs tests/locale-placeholders.test.mjs`
Expected: PASS for all 39 locales.

- [ ] **Step 7: Commit**

```bash
git add _locales tests/site-menu-locales.test.mjs
git commit -m "i18n: euIntegration keys in all 39 locales; enforce the prefix"
```

---

### Task 11: Import dialog — `matchImport`, ambiguity, baselines

**Files:**
- Modify: `js/components/menu-import-dialog.js:133-153` (row building), `:158-216` (`#findMatch`, `#menuMatch`, `#engineMatch`), `:229-247` (`#renderModeChoice`), `:316-332` (`#commitPatch`), `:417-430` (`#patchFor`)

**Interfaces:**
- Consumes: `FlowMouseMenuExchange.matchImport` (Task 5), `FlowMouseEuIntegration.addBaselines` (Task 4), i18n key `euIntegrationImportAmbiguous` (Task 10)

- [ ] **Step 1: Replace the two match methods**

Delete `#menuMatch` and `#engineMatch` (`:201-216`) and make `#findMatch` delegate to the pure function:

```js
	#findMatch(result) {
		const cur = settingsStore.current;
		if (result.type === 'menu') {
			const cat = (window.FlowMouseMenuCatalog && window.FlowMouseMenuCatalog.SITE_MENU_CATALOG) || [];
			return X().matchImport('menu', result.value, this._source, cur.siteMenus || {}, cat);
		}
		const cat = (window.FlowMouseEngineCatalogApi && window.FlowMouseEngineCatalogApi.ENGINE_CATALOG) || [];
		return X().matchImport('engine', result.value, this._source, cur.searchEngines || {}, cat);
	}
```

- [ ] **Step 2: Ambiguity forces "new"**

Add a helper next to `#findMatch`:

```js
	// An ambiguous match is shown, never acted on: the row imports as new.
	#usableMatch(match) { return match && !match.ambiguous ? match : null; }
```

In `openWith` (`:139`): `mode: this.#usableMatch(match) ? 'replace' : 'new'`. At `:153`: `this._importMode = this.#usableMatch(this._match) ? 'replace' : 'new';`.

In `#patchFor` (`:417-430`): `matchId: this.#usableMatch(row.match) ? row.match.id : null,`.

In `#renderModeChoice` (`:229`), replace `if (!match) return '';` with:

```js
		if (!match) return '';
		if (match.ambiguous) {
			return html`<div class="mode"><div class="mode-label">${i18n.getMessage('euIntegrationImportAmbiguous')}</div></div>`;
		}
```

Check every other reader of `match.id` / `match.own` in the file (`#matchName`, the badge at `:675`, `#rowNeedsAck`, `#dropDependentMenus`) and route them through `this.#usableMatch(...)` so an ambiguous match never reaches code that expects an `id`.

- [ ] **Step 3: Baselines before the save**

In `#commitPatch(patch, imported)` (`:316`), make the first line:

```js
		const withBaselines = await window.FlowMouseEuIntegration.addBaselines(patch, imported);
		const ok = await settingsStore.save(withBaselines);
```

- [ ] **Step 4: Verify by hand**

Reload the extension, switch on (Task 8 Step 4). Import a bundle from a file twice: the second time the entry is marked *Already added* (unqualified ↔ unqualified, single candidate). Inspect `chrome.storage.sync.get('siteMenus')` in the options DevTools: the imported entry's `source.baselineHash` is 16 hex chars. Edit the menu's name in the manager, then in the options console:

```js
const s = await chrome.storage.sync.get(['siteMenus']); await FlowMouseEuIntegration.modifiedState(Object.values(s.siteMenus.custom).find(d => d.source))
```

Expected: `true`. Repeat the file import once more: still *Already added* (a menu edit does not remove provenance).

- [ ] **Step 5: Run the suite and commit**

Run: `npm test` — PASS.

```bash
git add js/components/menu-import-dialog.js
git commit -m "feat(import): origin-bound matching, ambiguity imports as new, baselines written on save"
```

---

### Task 12: Options page — the "Website integration" section

**Files:**
- Create: `js/components/eu-integration-panel.js`
- Modify: `js/components/options-page.js:1187-1201` (`#getSections`), the section markup in `render()` (insert after the `contextMenu` section block), `pages/options.html:56` (module script)

**Interfaces:**
- Consumes: `GesturaEuLocal`, `FlowMouseEuIntegration.{CURRENT_INTEGRATION_CONSENT, effectiveEnabled, isValidDevOrigin}`, i18n keys from Task 10, styles from `./shared-styles.js`
- Produces: `<eu-integration-panel>` — self-contained; reads/writes `storage.local` itself (like `site-menu-manager` owns its store access), no properties required

- [ ] **Step 1: Create `js/components/eu-integration-panel.js`**

```js
import { LitElement, html, css } from '../../js/lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';

// The tier-1 switch of the gestura.eu integration. State lives in
// chrome.storage.local (GesturaEuLocal), not in the SettingsStore: consent is
// per browser and must never travel over browser sync. Turning the toggle on
// opens the consent block; only "Enable" there persists enabled + consent.
class EuIntegrationPanel extends LitElement {
	static properties = {
		_local: { state: true },
		_consentOpen: { state: true },
		_devDraft: { state: true },
		_devError: { state: true },
	};

	static styles = [commonStyles, optionStyles, css`
		:host { display: block; }
		.consent { margin: 8px 0 4px; padding: 14px 16px; border: 1px solid var(--border-color, #ccc); border-radius: 8px; background: var(--card-bg, transparent); }
		.consent h4 { margin: 0 0 8px; font-size: 15px; }
		.consent ul { margin: 0 0 12px 18px; padding: 0; }
		.consent li { margin: 4px 0; font-size: 13px; line-height: 1.45; }
		.consent .actions { display: flex; gap: 8px; }
		.reconfirm { color: var(--warning-color, #b26a00); }
		.dev input { width: 100%; max-width: 360px; }
		.error { color: var(--error-color, #c62828); font-size: 12px; margin-top: 4px; }
	`];

	constructor() {
		super();
		this._local = null;
		this._consentOpen = false;
		this._devDraft = '';
		this._devError = false;
		this._unsubscribe = null;
	}

	connectedCallback() {
		super.connectedCallback();
		window.GesturaEuLocal.read().then(local => this.#absorb(local));
		this._unsubscribe = window.GesturaEuLocal.onChange(local => this.#absorb(local));
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		if (this._unsubscribe) this._unsubscribe();
	}

	#absorb(local) {
		this._local = local;
		this._devDraft = local.euIntegration.devOrigin;
	}

	get #state() { return this._local ? this._local.euIntegration : null; }
	get #effective() { return this._local ? window.FlowMouseEuIntegration.effectiveEnabled(this._local) : false; }
	get #stale() {
		const s = this.#state;
		return !!(s && s.enabled && s.consent && s.consent.version !== window.FlowMouseEuIntegration.CURRENT_INTEGRATION_CONSENT);
	}

	#onToggle(e) {
		if (e.target.checked) {
			// Not persisted yet — the consent block decides.
			e.target.checked = false;
			this._consentOpen = true;
			return;
		}
		this._consentOpen = false;
		window.GesturaEuLocal.write({ enabled: false });
	}

	#accept() {
		this._consentOpen = false;
		window.GesturaEuLocal.write({
			enabled: true,
			consent: { version: window.FlowMouseEuIntegration.CURRENT_INTEGRATION_CONSENT, date: new Date().toISOString() },
		});
	}

	#cancel() { this._consentOpen = false; }

	#commitDevOrigin() {
		// Origins get pasted from a browser bar far more often than typed, and those
		// carry a trailing slash that isValidDevOrigin rejects. Trim it instead of
		// blaming the user.
		const value = (this._devDraft || '').trim().replace(/\/+$/, '');
		if (value && !window.FlowMouseEuIntegration.isValidDevOrigin(value)) { this._devError = true; return; }
		this._devError = false;
		window.GesturaEuLocal.write({ devOrigin: value });
	}

	render() {
		const i18n = window.i18n;
		const s = this.#state;
		if (!s) return html``;
		const points = ['euIntegrationConsentPoint1', 'euIntegrationConsentPoint2', 'euIntegrationConsentPoint3'];
		return html`
			<div class="setting-row first-row">
				<div class="setting-label">
					<span>${i18n.getMessage('euIntegrationToggle')}</span>
					<span>${i18n.getMessage('euIntegrationToggleDesc')}</span>
				</div>
				<label class="toggle">
					<input type="checkbox" .checked=${this.#effective} @change=${this.#onToggle}>
					<span class="slider"></span>
				</label>
			</div>
			${this.#stale && !this._consentOpen ? html`
				<div class="setting-row">
					<div class="setting-label reconfirm">
						<span>${i18n.getMessage('euIntegrationReconfirmTitle')}</span>
						<span>${i18n.getMessage('euIntegrationReconfirmDesc')}</span>
					</div>
					<button class="btn" @click=${() => { this._consentOpen = true; }}>${i18n.getMessage('euIntegrationConsentAccept')}</button>
				</div>` : ''}
			${this._consentOpen ? html`
				<div class="consent">
					<h4>${i18n.getMessage('euIntegrationConsentTitle')}</h4>
					<ul>${points.map(k => html`<li>${i18n.getMessage(k)}</li>`)}</ul>
					<div class="actions">
						<button class="btn primary" @click=${this.#accept}>${i18n.getMessage('euIntegrationConsentAccept')}</button>
						<button class="btn" @click=${this.#cancel}>${i18n.getMessage('euIntegrationConsentCancel')}</button>
					</div>
				</div>` : ''}
			${this.#effective ? html`
				<div class="setting-row dev">
					<div class="setting-label">
						<span>${i18n.getMessage('euIntegrationDevOrigin')}</span>
						<span>${i18n.getMessage('euIntegrationDevOriginDesc')}</span>
						<input type="url" placeholder="http://localhost:5173" .value=${this._devDraft}
							@input=${e => { this._devDraft = e.target.value; this._devError = false; }}
							@blur=${this.#commitDevOrigin}
							@keydown=${e => { if (e.key === 'Enter') this.#commitDevOrigin(); }}>
						${this._devError ? html`<div class="error">${i18n.getMessage('euIntegrationDevOriginInvalid')}</div>` : ''}
					</div>
				</div>` : ''}
		`;
	}
}

customElements.define('eu-integration-panel', EuIntegrationPanel);
```

If `.btn` / `.btn.primary` are not the button classes `css/option.css` provides, use the class names the `data` section's Export/Import buttons use in `options-page.js` (search for `#exportSettings` in the template and copy its button markup).

- [ ] **Step 2: Register the section in `js/components/options-page.js`**

In `#getSections` (`:1187`), after the `contextMenu` entry:

```js
			{ id: 'websiteIntegration', label: i18n.getMessage('euIntegrationTitle'), icon: icons.globe },
```

In `render()`, after the closing `</div>` of the `data-nav="contextMenu"` section block:

```js
				<div class="section ${this._activeSection === 'websiteIntegration' ? 'active' : ''}" data-nav="websiteIntegration">
					<h2><span class="section-icon">${unsafeHTML(icon('globe', { strokeWidth: 2.3 }))}</span> <span>${i18n.getMessage('euIntegrationTitle')}</span></h2>
					<div class="section-body">
						<eu-integration-panel></eu-integration-panel>
					</div>
				</div>
```

`pages/options.html` — before the `options-page.js` module script:

```html
	<script type="module" src="../js/components/eu-integration-panel.js"></script>
```

- [ ] **Step 3: Verify by hand**

Reset state first: worker console `await chrome.storage.local.remove('euIntegration')`. Reload the extension, open the options page: the new section appears in the nav with the globe icon and a toggle that is off. Flip it on: the consent block appears, the toggle stays off. "Not now" closes it, nothing stored. Flip again, "Enable": toggle is on; `chrome.storage.local.get('euIntegration')` shows `enabled: true, consent: { version: 1, date }`. The developer-origin field appears; `http://localhost.attacker.com` shows the error and stores nothing; `http://localhost:5173` is stored. Flip off: `enabled: false`, dev field hidden, `devOrigin` kept. Stale-consent path: `await GesturaEuLocal.write({ consent: { version: 0, date: 'x' } })` — the toggle renders off, the "Please confirm again" row appears, confirming re-enables with `version: 1`.

- [ ] **Step 4: Run the suite and commit**

Run: `npm test` — PASS.

```bash
git add js/components/eu-integration-panel.js js/components/options-page.js pages/options.html
git commit -m "feat(options): Website integration section with versioned consent and dev origin"
```

---

### Task 13: Documentation — API contract, README, PRIVACY, CHANGELOG

**Files:**
- Create: `docs/gestura-eu-api.md`
- Modify: `README.md:74-80` ("For site operators" intro), `README.de.md` (same section), `PRIVACY.md` (new section after "What data Gestura processes and where it stays", bump the date line), `CHANGELOG.md:8-10` (`### Unreleased`)

- [ ] **Step 1: Write `docs/gestura-eu-api.md`**

```markdown
# gestura.eu ↔ Gestura API contract

This file is the versioned contract between the Gestura extension and the
gestura.eu index. It is copied into the `gestura-index` repository; changes are
made here first. Design rationale lives in
[the integration design](superpowers/specs/2026-09-02-gestura-eu-integration-design.md).

**apiLevel: 1** (R1). The index must tolerate every older extension: no answer
is indistinguishable from "not installed" and must be handled as such. R2 adds
the update endpoint and R3 the sync endpoints to this file.

## Bridge (page → extension, DOM events)

- Events are dispatched on and listened to on `document`.
- `detail` is always the request as a **JSON string** (never an object).
- The extension answers **only** when the user has enabled *Website
  integration* with a current consent, **and** `location.origin` of the frame is
  `https://gestura.eu` or the user's single configured developer origin.
  Everything else — off, wrong origin, malformed request, over limit — is
  silence. There is no error event.

| Request event | Answer event | Answer body |
|---|---|---|
| `gestura:hello` `{ requestId }` | `gestura:hello-result` | `{ requestId, version, apiLevel }` |
| `gestura:query-status` `{ requestId, ids }` | `gestura:query-status-result` | `{ requestId, entries }` |
| `gestura:import` (hand-off, since 2.8.0) | `gestura:import-result` | `{ status, menus, engines }` |

Limits (violations → silence): `detail` ≤ 32 KiB UTF-8, checked before parsing;
`requestId` string ≤ 64 chars; `ids` array ≤ 100 strings, each matching
`^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$` and ≤ 128 chars.

`entries` is an **array**: `[{ id, installed: true, version, modified }, { id, installed: false }]`.
Every asked id appears exactly once (duplicates collapsed); `version` is the
content version the entry was imported with (may be `null`); `modified` is
`true | false | "unknown"` (`"unknown"` = imported before baselines existed).
Only entries imported from **the asking origin** are ever reported; file
imports and other origins' entries answer `installed: false`.

Example:

```js
document.addEventListener('gestura:query-status-result', (e) => {
	const { requestId, entries } = JSON.parse(e.detail);
});
document.dispatchEvent(new CustomEvent('gestura:query-status', {
	detail: JSON.stringify({ requestId: crypto.randomUUID(), ids: ['com.example.shop'] }),
}));
// Keep your own timeout: silence is a legitimate outcome.
```

## Provenance

An imported entry stores `source = { type, url?, version, indexId, indexOrigin?, baselineHash? }`.

- `indexId` is the exchange-format id the payload claimed — any file can claim any id.
- `indexOrigin` is set **only by the extension**, and only when the payload's
  origin is verifiable: a website hand-off from an allowed origin, or a URL
  import whose final `Response.url` (after redirects) is on an allowed origin.
  File imports never get one. Disclosure through the bridge requires
  `indexOrigin === location.origin`.
- Entries are identified by the pair `(indexOrigin, indexId)`. Re-import
  matching: a qualified import matches only the same pair; an unqualified import
  matches only unqualified entries and never overwrites a qualified one; any
  ambiguity is imported as a new entry.

## Baseline and canonical form

`baselineHash` = first 16 hex chars (64 bits) of SHA-256 over the canonical
JSON of the stored entry **after** all import transformations, with the `source`
object removed. Canonical JSON: objects with keys sorted recursively, no
whitespace, `undefined` properties dropped, `null` kept, arrays in order
(`undefined` elements become `null`). `modified` = current canonical hash ≠ baseline.

## Consent versions

| Version | Scope |
|---|---|
| 1 | Website hand-offs to the import dialog; bridge `hello` / `query-status` (version and per-entry status to the asking allowed origin). |

A stored consent below the current version disables the integration until the
user confirms again.

## Developer origin

Exactly one, validated as `new URL(input).origin === input` and either `https:`
or `http:` with hostname `localhost` / `127.0.0.1`. It is treated like
`https://gestura.eu` for the bridge and for provenance, and never ships enabled.
```

- [ ] **Step 2: Update the operator sections**

`README.md` — insert after the first paragraph of `## For site operators` (before "**By link, …**"):

```markdown
**The user has to opt in first.** Hand-offs only work while the user has enabled
*Website integration* in Gestura's settings — it is off by default. While it is
off, Gestura ignores the click entirely: a `rel="gestura-menu"` link is simply
followed by the browser (so point it at a URL that makes sense to open), and an
inline button does nothing Gestura-related (so offer a plain download as
fallback). Gestura does not tell your page whether the integration is on.
```

`README.de.md` — the same paragraph in German in the corresponding section:

```markdown
**Der Nutzer muss zuerst zustimmen.** Übergaben funktionieren nur, solange der
Nutzer in den Gestura-Einstellungen die *Website-Integration* eingeschaltet hat –
sie ist standardmäßig aus. Solange sie aus ist, ignoriert Gestura den Klick
vollständig: Einem `rel="gestura-menu"`-Link folgt der Browser einfach (also auf
eine URL zeigen, die sich sinnvoll öffnen lässt), und ein Inline-Button tut
nichts Gestura-Bezogenes (also einen normalen Download als Fallback anbieten).
Gestura verrät der Seite nicht, ob die Integration eingeschaltet ist.
```

- [ ] **Step 3: Update `PRIVACY.md`**

Change the date line to `_Last updated: 2026-09-02_`. Insert a new section before `## Permissions`:

```markdown
## Website integration (optional, off by default)

Gestura ships with its website integration switched off. In that state the
extension ignores every hand-off a website tries to start and has no contact
with gestura.eu.

If you enable *Website integration* in the settings, and only then:

- Websites can hand menus and search engines to Gestura's import dialog after
  you click a button on their page. Nothing is imported without your
  confirmation in that dialog.
- Pages on **gestura.eu** (and one developer origin you may configure yourself)
  can ask Gestura which of *their* entries you have installed, in which version,
  and whether you changed them locally. Gestura answers only about entries you
  imported from that very origin, only to that origin, and never about anything
  else in your settings. Gestura also tells such pages its own version number.
- Nothing is sent while you are not on such a page. There is no account, no
  identifier, and no request Gestura makes on its own.

The switch and your consent are stored only on the device where you enabled
them (`chrome.storage.local`); they are never synced, exported or imported.
Turning the switch off stops all of the above immediately. Entries you imported
stay on your device.
```

In `## Summary`, append one sentence to the existing claim: `The optional website integration (below) is off by default and, when enabled, only answers questions from gestura.eu about entries you imported from there.`

- [ ] **Step 4: `CHANGELOG.md` — replace `_Nothing yet._` under `### Unreleased`**

```markdown
**New Features:**

- **Website integration, off by default:** a new settings section with a single
  switch and a plain-language consent. While it is off — the default — Gestura
  is fully standalone: it ignores every hand-off a website triggers (operator
  links, inline buttons, `gestura:import`) and has no contact with gestura.eu.
  Turning it on lets gestura.eu pages ask which of their entries you have
  installed, in which version and whether you changed them — answered only for
  entries imported from that origin, only to that origin, as an array of the
  ids the page asked about. The consent is versioned; a later change to what the
  integration does re-asks before anything is sent again.
- **Imports remember where they came from — verifiably:** entries now carry the
  origin they were imported from (`source.indexOrigin`), set only when the
  extension itself verified it, plus a baseline hash of the imported state.
  That is what lets an index page tell "installed" from "modified locally"
  without ever seeing the change itself. Replacing a catalog menu or overriding
  a built-in engine keeps this provenance too — until now those two import
  modes forgot it, and editing a search engine used to drop it as well.

**Fixes & Improvements:**

- **Re-imports no longer guess.** A repeat import matches an existing entry only
  when the origin agrees; the same id arriving from a file, from gestura.eu and
  from a development index are three different entries, and when several could
  be meant the dialog imports a new entry instead of overwriting one.
- **Behaviour change for site operators:** the operator hand-off shipped in
  2.8.0 now requires the user to have enabled *Website integration*. See *For
  site operators* in the README.
```

- [ ] **Step 5: Run the suite and commit**

Run: `npm test` — PASS (docs do not affect tests, but the commit gate holds).

```bash
git add docs/gestura-eu-api.md README.md README.de.md PRIVACY.md CHANGELOG.md
git commit -m "docs: gestura.eu API contract (R1), operator opt-in, privacy section, changelog"
```

---

### Task 14: End-to-end check page and Firefox parity notes

**Files:**
- Create: `docs/test-bundles/bridge-test.html`
- Modify: `docs/test-bundles/README.md` (one paragraph on how to use the page)

- [ ] **Step 1: Create `docs/test-bundles/bridge-test.html`**

```html
<!doctype html>
<meta charset="utf-8">
<title>Gestura bridge test</title>
<style>
	body { font: 14px system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
	pre { background: #f4f4f4; padding: 8px; min-height: 3em; white-space: pre-wrap; }
	button { margin: 4px 4px 4px 0; }
</style>
<h1>Gestura bridge test</h1>
<p>Serve this folder on the origin you configured as <em>Developer origin</em>
(e.g. <code>npx serve -l 8123 docs/test-bundles</code> → <code>http://localhost:8123</code>).
With the integration off, every button below stays silent.</p>

<h2>Bridge</h2>
<button id="hello">gestura:hello</button>
<label>ids (comma-separated): <input id="ids" value="com.example.demo, google, bing, nope" size="50"></label>
<button id="status">gestura:query-status</button>
<button id="bad">oversized request (must be silent)</button>
<pre id="out">—</pre>

<h2>Hand-off</h2>
<button data-gestura-inline>Inline hand-off (a demo bundle)</button>
<a rel="gestura-menu" href="./demo-menu.json">rel="gestura-menu" link</a>
<pre id="result">—</pre>

<script>
	const out = document.getElementById('out');
	const log = (label, e) => { out.textContent = label + '\n' + JSON.stringify(JSON.parse(e.detail), null, 2); };
	document.addEventListener('gestura:hello-result', e => log('hello-result', e));
	document.addEventListener('gestura:query-status-result', e => log('query-status-result', e));
	document.addEventListener('gestura:import-result', e => { document.getElementById('result').textContent = e.detail; });

	const send = (type, body) => {
		out.textContent = type + ' sent — waiting (silence after 2 s means: off, wrong origin, or rejected)';
		document.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(body) }));
	};
	document.getElementById('hello').onclick = () => send('gestura:hello', { requestId: 'h-' + Date.now() });
	document.getElementById('status').onclick = () => {
		const ids = document.getElementById('ids').value.split(',').map(s => s.trim()).filter(Boolean);
		send('gestura:query-status', { requestId: 's-' + Date.now(), ids });
	};
	document.getElementById('bad').onclick = () => send('gestura:query-status', { requestId: 'x', ids: ['com.a'], junk: 'z'.repeat(40000) });

	document.querySelector('[data-gestura-inline]').addEventListener('click', () => {
		const bundle = { gesturaBundle: 1, entries: [{
			gesturaMenu: 1, id: 'com.example.demo', version: '1.0.0',
			name: { en: 'Demo menu' }, icon: 'menu', patterns: ['*example.com*'],
			items: [{ id: 'home', label: { en: 'Home' }, action: 'openCustomUrl', customUrl: 'https://example.com/' }],
		}] };
		document.getElementById('result').textContent = 'hand-off dispatched — waiting for gestura:import-result';
		document.dispatchEvent(new CustomEvent('gestura:import', { detail: JSON.stringify(bundle) }));
	});
</script>
```

Also create `docs/test-bundles/demo-menu.json` next to it with the same single `gesturaMenu` object as in the bundle above (so the `rel` link has a same-origin target).

- [ ] **Step 2: Walk the end-to-end script**

Serve the folder on `http://localhost:8123`, set that as developer origin (Task 12 UI), integration **on**:

1. `gestura:hello` → `{ requestId, version: "2.8.0", apiLevel: 1 }`.
2. Inline hand-off → import dialog opens in the options tab; confirm → the page shows `{"status":"imported","menus":1,"engines":0}`.
3. `gestura:query-status` with `com.example.demo` → `installed: true, version: "1.0.0", modified: false`; `google`/`bing`/`nope` → `installed: false`.
4. Edit the demo menu's name in the options page → query again → `modified: true`.
5. Oversized request → silence.
6. Integration **off** → all three buttons silent; the `rel` link now navigates to the JSON; the inline button does nothing.
7. Open the same page on `http://127.0.0.1:8123` (not the configured origin) with the integration on → silence.

Record the results in the commit message.

- [ ] **Step 3: Add the usage paragraph to `docs/test-bundles/README.md`**

```markdown
## Bridge and hand-off check

`bridge-test.html` exercises the gestura.eu bridge (`gestura:hello`,
`gestura:query-status`) and the gated hand-off against a locally served origin.
Serve this folder (`npx serve -l 8123 docs/test-bundles`), enter
`http://localhost:8123` as *Developer origin* in the options page, enable the
integration and follow the buttons. See `docs/gestura-eu-api.md` for the contract.
```

- [ ] **Step 4: Firefox parity — record for the `firefox-build` merge**

Not done on `main`; list it in the commit message and in `docs/test-bundles/README.md` under the paragraph above:

```markdown
After merging `main` into `firefox-build`: add `js/eu-integration.js`,
`js/eu-local.js` (after `js/constants.js`) and `js/eu-bridge.js` (before
`js/content.js`) to the Gecko manifest's `content_scripts`, and
`js/eu-integration.js`, `js/eu-local.js` to `background.scripts` — the same
order as `importScripts` in `js/background.js`. `npx web-ext lint` must stay at 0 errors.
```

- [ ] **Step 5: Run the suite and commit**

Run: `npm test` — PASS.

```bash
git add docs/test-bundles/bridge-test.html docs/test-bundles/demo-menu.json docs/test-bundles/README.md
git commit -m "test(eu): local bridge/hand-off check page; firefox-build parity notes"
```

---

## Self-review against the spec

**Spec coverage (R1 sections):**

| Spec item | Task |
|---|---|
| §2 two tiers, `storage.local`, consent version + date | 1 (invariant), 7 (storage), 12 (UI) — tier 2 deliberately absent (ships with R3) |
| §2 `effectiveEnabled` invariant, stale consent authorizes nothing, re-confirm UI | 1, 12 |
| §2 disable semantics: storage watch, re-check before every answer/hand-off, no result after switch-off | 7 (`onChange`), 8 (`integrationOn()` at each point, worker refuses `importResult`), 9 (`gate()` before and after the settings read) |
| §2 all website-triggered paths gated, manual imports unconditional | 8 |
| §3 bridge: document events, string detail, origin list incl. one dev origin, exact validation, silence | 1, 3, 9 |
| §3 limits: 32 KiB pre-parse, requestId ≤ 64, ids ≤ 100, ID pattern ≤ 128 | 3 |
| §3 answer events named, array entries, `installed:false` for unknown, `constructor` harmless | 3 |
| §3 origin-bound answers `indexOrigin === location.origin` | 3, 9 |
| §4 provenance on every import mode incl. catalog replacement and engine override | 4 |
| §4 qualified provenance via `indexOrigin`, final `Response.url`, hand-off sender origin | 1, 8 |
| §4 provenance survives mutation (engine editor, resolver) | 6 |
| §4 baseline = stored runtime entry after import transforms minus `source`; canonical form; 16 hex; `unknown` | 2, 4 |
| §4 three-case dedup, ambiguity → import as new, triple test | 5, 11 |
| §4 update check / cache | R2 — not in this plan |
| §6 PRIVACY.md, i18n in 39 locales + test prefix, Firefox parity, Lit components, no build step | 10, 13, 14 |
| §7 error handling: malformed events ignored silently | 3, 9 |
| §9 tests: bridge, modified status, provenance, dedup, canonicalization, consent | 1–6 |
| §1 API contract doc `docs/gestura-eu-api.md` | 13 |

**Placeholder scan:** no TBD/TODO; every code step carries code. The one deliberately empty artifact (`js/eu-bridge.js` in Task 7) is filled in Task 9 and the plan says so.

**Type consistency:** `normalizeLocal/effectiveEnabled/isValidDevOrigin/allowedOrigins/qualifiedOrigin` (Task 1) are used with those names in Tasks 7–12; `parseBridgeRequest/helloAnswer/statusAnswer` (Task 3) in Task 9; `addBaselines(patch, imported)` (Task 4) in Task 11; `matchImport(kind, value, source, branch, catalog)` (Task 5) in Task 11 with `settingsStore.current.siteMenus` / `.searchEngines` as `branch`; `GesturaEuLocal.{read,current,write,isEnabled,onChange}` (Task 7) in Tasks 8, 9, 12; the i18n keys in Task 10 match those rendered in Tasks 11 and 12 (`euIntegrationImportAmbiguous`, `euIntegrationTitle`, `euIntegrationToggle`, `euIntegrationToggleDesc`, `euIntegrationConsentTitle`, `euIntegrationConsentPoint1-3`, `euIntegrationConsentAccept`, `euIntegrationConsentCancel`, `euIntegrationReconfirmTitle`, `euIntegrationReconfirmDesc`, `euIntegrationDevOrigin`, `euIntegrationDevOriginDesc`, `euIntegrationDevOriginInvalid`).

---

## Status after execution (2026-09-02)

All 14 tasks implemented on `feature/eu-integration-r1`, 19 commits, 524 tests passing (443 before the branch). Each task was reviewed individually; a final whole-branch review found no Critical issues and four Important ones, all fixed in one wave and re-verified. **Not merged** — the branch waits until the feature feels finished.

### Verified in a real browser

- With the switch **off**, a website-triggered hand-off from the local index is ignored. This is the deliberate behaviour change against shipped 2.8.0.
- With the switch **on**, the hand-off works again. It is gated by the switch alone, not by the origin, which is why it needed no developer-origin entry.

### Still to check by hand

Checked 2026-09-02 against `docs/test-bundles/bridge-test.html` served on
`http://localhost:8123`, configured as the developer origin:

1. ~~`query-status` answering~~ **passes.** `hello-result` returns `{requestId, version: "2.8.0", apiLevel: 1}`; `query-status-result` returns `entries` as an array with one object per requested id, `installed: false` for all four while nothing provenanced was stored yet.
2. The `modified` flag after renaming an imported entry — **still open.**
3. ~~An oversized request (over 32 KiB of `detail`) must stay silent~~ **passes.** No answer, no console output.
4. ~~A non-configured origin must stay silent~~ **passes.** The same page over `http://127.0.0.1:8123` answers neither the bridge nor the hand-off.

**One defect found while checking, fixed in `054ab65`:** the import preview
reported "99 % used after import" and the save then failed with "exceeds the sync
storage limit". `#projectedUsage` measured the patch, while `#commitPatch` saves
`addBaselines(patch, imported)` — 34 bytes longer per provenanced entry, the
`baselineHash` R1 introduced. Near the 8192-byte item cap that is enough to
promise a fit and then refuse the write. The preview now measures a patch stamped
with fixed-length placeholders, and `tests/menu-exchange-provenance.test.mjs`
asserts byte-for-byte equality between measured and stored. The failure was
reported to the page correctly as `{"status":"failed"}`, so the reply path was
never in doubt.

Steps 3 and 4 need no test page; dispatching the events from the page's own console is enough. `docs/test-bundles/bridge-test.html` covers all of it including the hand-off, which needs a real click and therefore a button.

**Note on provenance while testing:** an entry imported while no developer origin was configured carries no `indexOrigin`. It stays fully usable but is never disclosed through the bridge, and a later import of the same id *with* the origin configured creates a second entry rather than updating it — a qualified import never silently overwrites an unqualified one. Delete such test entries before testing the status path.

### Open minor findings

From the final whole-branch review, in rough order of how much they matter:

- ~~**The developer-origin row breaks the section's label styling.**~~ Fixed 2026-09-02: the input moved out of `.setting-label` into its own column on the right of the row, the way every other setting row places its control, and the validation message now takes a full-width line below both columns instead of wrapping into four lines inside a 260 px column. The row also moved behind the section's *Erweitert* toggle — a developer-only field has no business in the default view.
- **`_devDraft` is clobbered by any storage change**, so an unsaved edit in the developer-origin field can vanish while the user is typing if the state changes for another reason.
- **Two `write()` calls in the panel are neither awaited nor caught** (the developer origin, and the toggle's off path via revoke). The consent write is now awaited, and the panel renders from `_local`, so a failed write cannot make the UI claim a state that was never stored — it shows up as a click that did nothing.
- ~~**Turning the switch off cannot clear a stale consent.**~~ Fixed 2026-09-02: turning the switch off and the new *Withdraw* button both write `{enabled: false, consent: null}`, and the re-confirmation row carries a *Withdraw* button of its own. "Off" now always means "no consent on record", so turning it back on always goes through the overlay.
- **The bridge's `getManifest()` and `statusAnswer()` calls sit outside a try/catch.** A throw there would log to the console. Not scriptable by the page, so not a fingerprinting vector, but it breaks the "silence only" rule on paper.
- **`eu-local.js` never retries a failed first load.** The memoised promise keeps the defaults for the lifetime of that context, so a transient storage error reads as "switch off" until a reload.
- **A third un-guarded copy of the exchange id rule** exists; the rule now lives in `js/exchange-schema.json`, `js/menu-exchange.js` and `js/eu-integration.js`.
- **The Firefox parity note sits in `docs/test-bundles/README.md`**, which is otherwise about test bundles. It belongs in `FORK-NOTES.md`, and that file's dedup explanation is now stale.
- **Following redirects lets a third party end up stamped with an allowed origin.** Bounded and pre-existing fetch behaviour; the README wording was corrected, the mechanism was not changed.
- **The content script reads storage once per frame at `document_start`**, which is more reads than necessary on pages with many frames.
- **`query-status` has no rate limit.** An allowed origin can ask as often as it likes.

### Parked

The two regression tests for the engine field-list fix build the rebuilt object themselves instead of calling the real editor, because vitest here cannot mount a Lit component. They therefore cannot fail if someone drops those fields again. The durable fix is one shared field-list helper used by `toCustomEngine`, `toEngineOverride` and the editor's save path.

### Before a release

- The store data-use answers were updated in `docs/store/*-submission.md`; the `firefox-build` manifest still carries the old `data_collection_permissions` value and must be updated when this is merged there.
- After merging into `firefox-build`: register `js/eu-integration.js`, `js/eu-local.js` and `js/eu-bridge.js` in the Gecko manifest's `content_scripts` (same order as here) and the first two in `background.scripts`, then check `web-ext lint` reports zero errors and run one bridge round-trip in Firefox.
- 27 of the 39 locales received only mechanical checks on the new consent text, not a fluent read.
- **The section's own copy is `en`/`de` only.** It was rewritten on 2026-09-02 to name gestura.eu instead of "websites" (below), by the owner's decision that translation waits until the text is final. Five keys need it:
  - Eleven keys are new and exist only in `en`/`de`: `euIntegrationIntro`, `euIntegrationIntroLink`, `euIntegrationConsentLead`, `euIntegrationConsentPoint4`, `euIntegrationConsentPoint1Label` … `Point4Label`, `euIntegrationConsentGranted`, `euIntegrationConsentDate`, `euIntegrationConsentRevoke`. The four `…Label` keys are the bold lead-in of each consent point; label and body are separate keys because `messages.json` carries plain text and translations must never hold markup. They are listed in `PENDING_TRANSLATION` in `tests/site-menu-locales.test.mjs`, and a test there fails once they are translated everywhere but still listed. Every other locale falls back to `en` at runtime in the meantime. `euIntegrationConsentDate` carries a `{date}` token replaced in the component — not a `$…$` placeholder, deliberately (see CLAUDE.md).
  - Six keys changed wording: `euIntegrationTitle`, `euIntegrationToggle`, `euIntegrationToggleDesc`, `euIntegrationConsentTitle`, `euIntegrationConsentPoint1`, `euIntegrationConsentPoint2`, `euIntegrationConsentPoint3` and `euIntegrationConsentAccept`. The other 37 locales still hold the **old** text — including consent points that still say *websites* may hand entries over, which is no longer true, and a title that reads as a warning ("Before you enable this") rather than an explanation. No test catches this: the keys exist, they are just stale. The consent points matter most, since they are what the user agrees to.
- The intro paragraph links to `https://gestura.eu/` (`EuIntegrationPanel.SITE_URL`). If the "why use gestura.eu" page gets its own path, or a per-language one, that has to be set before release — a per-language target belongs in the locales, not in the component.
