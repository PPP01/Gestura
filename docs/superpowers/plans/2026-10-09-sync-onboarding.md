# Sync onboarding and the three-way choice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The section "Abgleich zwischen Browsern" becomes the choice between the three ways settings travel (browser sync / only here / gestura.eu). Switching to gestura.eu runs a guided wizard behind a reachability check. The Settings tab gets its final card layout. Users read "Profil" instead of "Stand".

**Architecture:** The pure logic lives in small ES modules under `js/components/` with no Lit import, so vitest can load them:
- the card mapping and transition table;
- the area switch;
- reachability and maintenance texts;
- the wizard's finishing order;
- the code-field check.

Two classic scripts gain what the UI needs:
- `js/settings-storage.js`: the fit check and an area-change listener;
- `js/eu-sync.js`: GET without a body, `503`/maintenance, and the ping.

The Lit components carry the rendering:
- the sync panel renders the choice;
- a new `sync-onboarding-dialog` component is the wizard.

`options-page.js` gives the storage switch, status row and moved note to the panel.

**Tech Stack:** MV3 extension without a build step. Lit is vendored (`js/lib/lit-all.min.js`), the other scripts are classic scripts with window globals, and tests run on vitest 2 in node. Browser checks run in Edge with `--load-extension`, CDP on port 9461 and the sync mock on port 8198.

**Spec:** [docs/superpowers/specs/2026-10-09-sync-onboarding-design.md](../specs/2026-10-09-sync-onboarding-design.md). The section numbers (§n) below refer to it.

## Global Constraints

- Indentation is **tabs**. No build step, no new dependency. Classic scripts stay classic; components stay ES modules (CLAUDE.md "Don't mix the two worlds").
- Only `js/settings-storage.js` touches `chrome.storage.sync` or `chrome.storage.local` for settings or the `settingsArea` key. Nothing else reads them directly.
- **New message keys go into `_locales/en` and `_locales/de` only.** Each new `euSync*` key is added to `PENDING_TRANSLATION` in `tests/site-menu-locales.test.mjs` in the same commit.
- A key that already exists in all 39 locales and changes its en/de wording is noted by hand in the comment block below `PENDING_TRANSLATION`.
- Translations are not an open item; they happen once, before the release.
- **Never put an undeclared `$WORD$` into a message.** Use `{token}` plus `.replace()` instead.
- **Profil, not Stand.** Every user-visible sync string says "Profil"/"Profile" (en "profile"). Code, keys, storage and the contract keep `state`. Where a sentence could mean browser profiles, say "Gestura-Profil".
- **Texts from spec §11 are copied verbatim** (de). The en wording is written to match. Texts not in §11 are marked *(owner check)* in the task that introduces them.
- **No new storage keys** (§10). "Onboarding in progress" is the wizard being open, never a stored flag.
- **Nothing is stored before the wizard is done** (§6). Finishing order:
  1. re-read;
  2. one `GesturaSyncLocal.write`;
  3. area switch, judged by `area()`;
  4. base write.
- The merge's own write order (upload → local write → base) and `MERGE_MAP` are not touched.
- The area switch is always judged by `GesturaSettingsStorage.area()` after the call, never by `ok` alone.
- **The ping is the only new request.** It runs once when the gestura.eu card is activated, and again on its "Erneut versuchen". It never runs in the background or in a loop. With sync on, the list request is the check.
- `docs/gestura-eu-api.md` changes only deliberately:
  - the consent-v2 row in Task 16;
  - the ping text in Task 20, after the index reports the ping live.
- Nothing under `exchange/` is referenced from a tracked file.
- Commits stay local on `main`. Do not push and do not commit `manifest.json` (its `version_name` is stamped).

## Review Focus

1. **The area changes in another tab while this panel is open.** The cards must follow without a reload, and an open wizard must not finish over the change. Pinned in Task 1 (`onAreaChanged` fires on the storage event), Task 9 (`finishOnboarding` aborts on `other-tab`) and the Task 19 browser check "two tabs".
2. **The gestura.eu card is pressed twice quickly, or with Enter while focused.** Exactly one ping and one wizard must result. Arrow keys must do nothing. Pinned in Task 8, step "browser check: double activation and keyboard".
3. **The user cancels while the first upload is still in flight.** No profile may be left behind under a code nobody stored, as far as best effort can reach. Pinned in Task 10 (cancel deletes `_inFlight` as well as `_uploaded`) and the Task 19 check with `delayMs`.
4. **gestura.eu answers with an HTML page, a `404` or a `200` without `status:"ok"`** (a misrouted proxy). This must read "nicht erreichbar", never "erreichbar", and never as a server-error text inside the wizard. Pinned in Task 2's classification tests.
5. **A stale consent, a kept code and browser sync on, all at once.** "Mit diesem Code fortfahren" must switch the area to local and keep the profile map. Pinned in Task 9 (the kept-code path through `finishOnboarding`) and Task 11's browser check.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `js/settings-storage.js` | modify | + `syncFit(items)`, `fitsSync()`, `onAreaChanged(fn)` |
| `js/eu-sync.js` | modify | `request()`: bodyless GET, `503` → `unavailable` / `maintenance` + `until`. `list`/`PUT`: `404` → `unavailable`. New `pingService` and `ping` |
| `js/eu-sync-local.js` | modify | `CURRENT_SYNC_CONSENT = 2` (Task 16) |
| `js/components/storage-refusal.js` | create | `branchLabel`, `fillRefusal`, moved out of `storage-full-dialog.js` so node can import them |
| `js/components/storage-area-switch.js` | create | `switchArea(S, target, reason)` → `{ landed, refusal }`, `refusalText`, `wayBackText` |
| `js/components/storage-choice.js` | create | `cardFor(area, enabled)`, `planFor(from, to)` |
| `js/components/sync-reach.js` | create | `SYNC_ERRORS`, `syncErrorText`, `maintenanceText`, `reachText` |
| `js/components/sync-code-input.js` | create | `CODE_ERRORS`, `checkDraft(value)`, `maskCode(code)`, `lockText(i18n, n)`, `saveCodeFile(i18n, code)` |
| `js/components/sync-onboarding-flow.js` | create | `createGeneration()`, `sameSetup(a, b)`, `finishOnboarding(steps)` |
| `js/components/sync-onboarding-dialog.js` | create | The wizard (Lit) |
| `js/components/eu-sync-panel.js` | modify | Cards, status row, moved note, repair line, transitions, wizard host, Settings-tab cards, list-failed box, connecting line |
| `js/components/options-page.js` | modify | Drops the browser-sync switch, status row and moved note; storage-full ways go through the panel; follows `onAreaChanged` |
| `js/components/storage-line.js` | modify | "Mehr Platz bekommen →" link |
| `js/components/storage-full-dialog.js` | modify | Re-exports from `storage-refusal.js`; `failure.euNotice`; new Way-2 description |
| `js/components/shared-styles.js` | modify | `.storage-more` link style in `commonStyles` |
| `_locales/en/messages.json`, `_locales/de/messages.json` | modify | New keys, Stand→Profil |
| `tests/…` | create/modify | One test file per new pure module, plus additions |
| `docs/gestura-eu-api.md` | modify | Consent v2 row (Task 16), ping (Task 20) |
| `README.md`, `README.de.md`, `PRIVACY.md`, `CLAUDE.md` | modify | Task 17 |
| `~/.claude/projects/c--Programme-alt-Gestura/browser-verify/sync-mock.mjs` | modify (not in git) | Ping, maintenance, `GET` in CORS |

Commands used throughout (from the repo root, Git Bash):

```bash
npm test                                  # whole suite
npx vitest run tests/<file>.test.mjs      # one file
```

---

### Task 0: Baseline

- [ ] **Step 1: Confirm the suite is green before touching anything.**

Run: `npm test`
Expected: all suites pass (21+ files, 0 failed). If anything fails, stop and report; do not start on a red baseline.

- [ ] **Step 2: Confirm the working tree holds only the stamped manifest.**

Run: `git status --short`
Expected: ` M manifest.json` and nothing else.

**Acceptance:** green suite, clean tree apart from `manifest.json`.

---

### Task 1: Fit check and area listener in the storage façade

**Files:**
- Modify: `js/settings-storage.js` (`toSync()` measurement block, `absorb()`, `api` object)
- Test: `tests/settings-storage.test.mjs` (append)

**Interfaces:**
- Produces:
  - `GesturaSettingsStorage.syncFit(items: object) → { ok: true } | { ok: false, error: 'branch-full'|'total-full', branch: string, bytes: number, quota: number, checkedArea: 'sync' }`. Pure; identical to what `toSync()` refuses with.
  - `GesturaSettingsStorage.fitsSync() → Promise<same>`. Reads the active area and writes nothing. A failed read returns `{ ok: false, error: 'write' }`.
  - `GesturaSettingsStorage.onAreaChanged(fn: (area: 'sync'|'local') => void) → unsubscribe`. Fires whenever the cached area changes value, whether through this context's write, another context's storage event, or the first load.

- [ ] **Step 1: Write the failing tests** (append to `tests/settings-storage.test.mjs`).

```js
describe('syncFit / fitsSync (onboarding §3)', () => {
	const big = (n) => 'x'.repeat(n);

	it('answers exactly what toSync() refuses with, for a branch over the item quota', async () => {
		await seedLocal();
		await chrome.storage.local.set({ siteMenus: { custom: { a: big(9000) } } });
		const fit = await S.fitsSync();
		const real = await S.switchTo('sync');
		expect(fit.ok).toBe(false);
		expect(fit).toEqual(real);
		expect(S.area()).toBe('local');
	});

	it('answers exactly what toSync() refuses with, for the total', async () => {
		await seedLocal();
		const patch = {};
		// Each branch under 8192, together over 102400.
		for (const k of KNOWN.slice(0, 20)) patch[k] = big(7000);
		await chrome.storage.local.set(patch);
		const fit = await S.fitsSync();
		const real = await S.switchTo('sync');
		expect(fit.error).toBe('total-full');
		expect(fit).toEqual(real);
	});

	it('says ok for settings that fit, and writes nothing', async () => {
		await seedLocal();
		const before = JSON.stringify([...fake.areas.sync.entries()]);
		expect(await S.fitsSync()).toEqual({ ok: true });
		expect(JSON.stringify([...fake.areas.sync.entries()])).toBe(before);
		expect(S.area()).toBe('local');
	});

	it('reports a failed read as write, never as a fit', async () => {
		await seedLocal();
		fake.hooks.failNext = { area: 'local', op: 'get', after: 0 };
		expect(await S.fitsSync()).toEqual({ ok: false, error: 'write' });
	});
});

describe('onAreaChanged', () => {
	it('fires once with the new area when this context switches', async () => {
		const seen = [];
		const off = S.onAreaChanged(a => seen.push(a));
		await S.switchTo('local');
		off();
		expect(seen).toEqual(['local']);
	});

	it('fires for a write made by another context (storage event only)', async () => {
		const seen = [];
		const off = S.onAreaChanged(a => seen.push(a));
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'local', movedAt: 'x', movedTo: 'local' } });
		off();
		expect(seen).toEqual(['local']);
	});

	it('stays quiet when the area is written with the same value', async () => {
		const seen = [];
		const off = S.onAreaChanged(a => seen.push(a));
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'sync', movedAt: '', movedTo: '' } });
		off();
		expect(seen).toEqual([]);
	});
});
```

Before relying on `fake.areas` and `fake.hooks`, check that `tests/helpers/fake-chrome-storage.mjs` exposes them under these names. If it uses other names, use those; do not change the helper.

- [ ] **Step 2: Run the tests and watch them fail.**

Run: `npx vitest run tests/settings-storage.test.mjs`
Expected: FAIL with `S.fitsSync is not a function` and `S.onAreaChanged is not a function`.

- [ ] **Step 3: Implement.** In `js/settings-storage.js`:

(a) Below `usage()`, add `syncFit` and make `toSync()` use it. This is an extraction: `toSync()`'s refusals keep their exact shape.

```js
	// Whether a set of settings fits browser sync, measured the way toSync()
	// refuses: every branch against the item quota, then the total with the
	// format marker. Pure, so the onboarding can ask BEFORE it shows a dialog
	// whose second half (turning gestura.eu off) cannot be undone (spec §4).
	function syncFit(items) {
		const q = QUOTA.sync;
		const u = usage(items, 'sync');
		for (const [k, bytes] of Object.entries(u.branches)) {
			if (bytes > q.item) return { ok: false, error: 'branch-full', branch: k, bytes, quota: q.item, checkedArea: 'sync' };
		}
		if (u.total > q.total) return { ok: false, error: 'total-full', branch: '', bytes: u.total, quota: q.total, checkedArea: 'sync' };
		return { ok: true };
	}

	// The same question about the settings as they are stored now. Writes
	// nothing; a failed read is 'write' (the contract has no read code), never
	// a fit.
	async function fitsSync() {
		await ready();
		let items;
		try {
			items = pickKnown(await store().get(knownKeys()));
		} catch {
			return { ok: false, error: 'write' };
		}
		return syncFit(items);
	}
```

In `toSync()`, replace the block from `const q = QUOTA.sync;` through the `total-full` return with:

```js
		const fit = syncFit(items);
		if (!fit.ok) return fit;
```

(b) The area listener. Replace `absorb()` and add the listener set:

```js
	const areaListeners = new Set();

	// Every way the cached area changes goes through here - this context's own
	// write, another context's storage event, the first load - so a listener
	// learns of each change once, whichever path brought it.
	function absorb(raw) {
		const before = cache.area;
		cache = normalizeArea(raw);
		loaded = true;
		if (cache.area !== before) {
			for (const fn of areaListeners) {
				try { fn(cache.area); } catch { /* one listener must not break the others */ }
			}
		}
		return cache;
	}

	function onAreaChanged(fn) {
		areaListeners.add(fn);
		return () => areaListeners.delete(fn);
	}
```

`absorb` is declared before `cache` is read. Keep `areaListeners` above `absorb` and below `let cache`.

(c) Add `syncFit, fitsSync, onAreaChanged` to `api`.

- [ ] **Step 4: Run the tests and watch them pass.**

Run: `npx vitest run tests/settings-storage.test.mjs` → PASS (old and new tests).
Run: `npm test` → all pass.

- [ ] **Step 5: Commit.**

```bash
git add js/settings-storage.js tests/settings-storage.test.mjs
git commit -m "feat(storage): non-mutating fit check for browser sync and an area-change listener"
```

**Acceptance:**
- `fitsSync()` returns the same refusal object as `switchTo('sync')` would, for both refusal kinds.
- `fitsSync()` writes nothing.
- `onAreaChanged` fires exactly once per real change, from either source.
- Every earlier `settings-storage` test still passes unchanged (the extraction changed no refusal).

---

### Task 2: Transport: bodyless GET, 503/maintenance, 404 on list/PUT, ping

**Files:**
- Modify: `js/eu-sync.js`
- Test: `tests/eu-sync.test.mjs` (append)

**Interfaces:**
- Produces:
  - `syncError(code, updatedAt?, until?)`. The error now carries `.until`: an ISO string, or `''` when missing or unparsable.
  - New error codes `'unavailable'` (any `503`; also `404` from `list`/`PUT`) and `'maintenance'` (`503` with body `{ error: 'maintenance' }`).
  - `GesturaSync.PATHS.ping = '/api/v1/sync/ping'`.
  - `GesturaSync.pingService({ origin, fetchImpl }) → Promise<{ kind: 'reachable', features: string[] } | { kind: 'maintenance', until: string } | { kind: 'rate-limited' } | { kind: 'unreachable' }>`. Never throws.
  - `GesturaSync.ping() → same`. Takes the origin from `syncOrigin(await GesturaEuLocal.read())`.

- [ ] **Step 1: Write the failing tests** (append to `tests/eu-sync.test.mjs`).

```js
// The ping and 503 checks need answers with arbitrary text and no JSON body
// on the request side, which fetchOk/fetchStatus assume.
const fetchRaw = (status, text, seen = []) => async (url, init) => {
	seen.push({ url, init });
	return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => text };
};

describe('ping classification (spec §5)', () => {
	const ping = (status, text) => S.pingService({ origin: 'https://gestura.eu', fetchImpl: fetchRaw(status, text) });

	it('200 with status ok is reachable, with the features', async () => {
		expect(await ping(200, '{"status":"ok","features":["sync-meta",3]}')).toEqual({ kind: 'reachable', features: ['sync-meta'] });
	});
	it('200 with an HTML page is unreachable', async () => {
		expect(await ping(200, '<html>proxy</html>')).toEqual({ kind: 'unreachable' });
	});
	it('200 JSON without status ok is unreachable', async () => {
		expect(await ping(200, '{"status":"degraded"}')).toEqual({ kind: 'unreachable' });
	});
	it('503 maintenance with a valid until', async () => {
		expect(await ping(503, '{"error":"maintenance","until":"2026-10-09T12:00:00+00:00"}'))
			.toEqual({ kind: 'maintenance', until: '2026-10-09T12:00:00.000Z' });
	});
	it('503 maintenance with a garbage until drops the time', async () => {
		expect(await ping(503, '{"error":"maintenance","until":"14 Uhr"}')).toEqual({ kind: 'maintenance', until: '' });
	});
	it('503 maintenance without until', async () => {
		expect(await ping(503, '{"error":"maintenance"}')).toEqual({ kind: 'maintenance', until: '' });
	});
	it('503 unavailable, 503 HTML, 500, 404, 403 are unreachable', async () => {
		for (const [status, text] of [[503, '{"error":"unavailable"}'], [503, '<html/>'], [500, '{}'], [404, '{}'], [403, '{}']]) {
			expect(await ping(status, text)).toEqual({ kind: 'unreachable' });
		}
	});
	it('429 is rate-limited', async () => {
		expect(await ping(429, '{"error":"rate-limited"}')).toEqual({ kind: 'rate-limited' });
	});
	it('a network failure is unreachable', async () => {
		const r = await S.pingService({ origin: 'https://gestura.eu', fetchImpl: async () => { throw new TypeError('down'); } });
		expect(r).toEqual({ kind: 'unreachable' });
	});
	it('is a GET with no body and no Content-Type, to the ping path', async () => {
		const seen = [];
		await S.pingService({ origin: 'https://gestura.eu', fetchImpl: fetchRaw(200, '{"status":"ok"}', seen) });
		expect(seen[0].url).toBe('https://gestura.eu/api/v1/sync/ping');
		expect(seen[0].init.method).toBe('GET');
		expect(seen[0].init.body).toBeUndefined();
		expect(seen[0].init.headers).toBeUndefined();
		expect(seen[0].init.redirect).toBe('error');
		expect(seen[0].init.credentials).toBe('omit');
	});
});

describe('503 and 404 on the sync endpoints (spec §5, §8)', () => {
	it('a maintenance 503 from list throws maintenance with until', async () => {
		const err = await S.listStates({ secret: await secretBytes(), origin: 'https://gestura.eu',
			fetchImpl: fetchRaw(503, '{"error":"maintenance","until":"2026-10-09T12:00:00Z"}') }).catch(e => e);
		expect(err.code).toBe('maintenance');
		expect(err.until).toBe('2026-10-09T12:00:00.000Z');
	});
	it('a plain 503 is unavailable', async () => {
		const err = await S.listStates({ secret: await secretBytes(), origin: 'https://gestura.eu', fetchImpl: fetchRaw(503, 'x') }).catch(e => e);
		expect(err.code).toBe('unavailable');
	});
	it('404 from list reads as unavailable', async () => {
		const err = await S.listStates({ secret: await secretBytes(), origin: 'https://gestura.eu', fetchImpl: fetchStatus(404) }).catch(e => e);
		expect(err.code).toBe('unavailable');
	});
	it('404 from PUT state reads as unavailable', async () => {
		const err = await S.uploadState({ secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID, name: 'n',
			exportObj: { a: 1 }, extVersion: '1', fetchImpl: fetchStatus(404) }).catch(e => e);
		expect(err.code).toBe('unavailable');
	});
	it('404 from get stays not-found', async () => {
		const err = await S.downloadState({ secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			expectPayloadHash: 'h', fetchImpl: fetchStatus(404) }).catch(e => e);
		expect(err.code).toBe('not-found');
	});
	it('a POST still sends JSON with its Content-Type', async () => {
		await S.listStates({ secret: await secretBytes(), origin: 'https://gestura.eu', fetchImpl: fetchOk({ states: [] }) });
		expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json' });
	});
});
```

- [ ] **Step 2: Run the tests and watch them fail.**

Run: `npx vitest run tests/eu-sync.test.mjs`
Expected: FAIL. `S.pingService is not a function`; codes come back as `server`/`not-found`.

- [ ] **Step 3: Implement in `js/eu-sync.js`.**

(a) `PATHS` gains `ping: BASE + '/ping'`. `STATUS` gains `503: 'unavailable'`.

(b) `syncError`:

```js
	// `until` is carried only by maintenance: the expected end, as ISO, or ''
	// when the server sent none or something that is not a date (spec §5).
	function syncError(code, updatedAt, until) {
		const e = new Error(code);
		e.code = code;
		e.updatedAt = typeof updatedAt === 'string' ? updatedAt : '';
		e.until = typeof until === 'string' ? until : '';
		return e;
	}

	function validUntil(v) {
		if (typeof v !== 'string') return '';
		const t = Date.parse(v);
		return Number.isNaN(t) ? '' : new Date(t).toISOString();
	}
```

(c) In `request()`, build `init` so a request without a body has no `headers` and no `body`:

```js
		const init = {
			method,
			credentials: 'omit',
			cache: 'no-store',
			redirect: 'error',
			signal: ctl.signal,
		};
		// A GET carries nothing, and no Content-Type either: that keeps the ping a
		// simple request, which is what the server's CORS answer is built for
		// (spec §5).
		if (body !== undefined) {
			init.headers = { 'Content-Type': 'application/json' };
			init.body = JSON.stringify(body);
		}
		let res;
		try {
			res = await fetchImpl(origin + path, init);
		} catch {
```

Keep the existing comment about `redirect: 'error'` above `redirect`.

(d) In the `!res.ok` branch, change `const code` to `let code` and read a body for `503` too:

```js
			if (!res.ok) {
				let code = STATUS[res.status] || 'server';
				// The body of an error is read for exactly two codes, and defensively:
				// a conflict carries the current updatedAt, a 503 may say it is planned
				// maintenance and until when. A body that is missing, truncated or not
				// JSON still arrives as the plain code.
				let updatedAt = '';
				let until = '';
				if (code === 'conflict') {
					try { updatedAt = JSON.parse(await res.text()).updatedAt; } catch { /* no date, still a conflict */ }
				} else if (code === 'unavailable') {
					try {
						const b = JSON.parse(await res.text());
						if (b && b.error === 'maintenance') { code = 'maintenance'; until = validUntil(b.until); }
					} catch { /* not maintenance, just unavailable */ }
				}
				throw syncError(code, updatedAt, until);
			}
```

(e) The `404` reading for list and PUT. Add below `isEnvelope`:

```js
	// The contract never answers 404 to list or to PUT state - those create or
	// enumerate, there is nothing to be missing. A 404 there means the request
	// did not reach the sync service (a proxy, a wrong route), and "this state
	// no longer exists" would send the user looking for a deleted state.
	async function reachedService(promise) {
		try {
			return await promise;
		} catch (e) {
			throw (e && e.code === 'not-found') ? syncError('unavailable') : e;
		}
	}
```

In `listStates` wrap the request: `const answer = await reachedService(request({ … }));`. In `uploadState`: `const answer = await reachedService(request({ origin, path: PATHS.state, method: 'PUT', fetchImpl, body }));`.

(f) The ping, above `gated`:

```js
	// Reachability before the onboarding starts (spec §5). Only a 200 that
	// says status ok counts: an HTML page, a 404 from a misrouted proxy or any
	// other answer is "not reachable", because the wizard that follows would
	// fail on it anyway. Never throws - the caller shows one of four sentences.
	async function pingService(opts) {
		const { origin, fetchImpl } = opts;
		try {
			const answer = await request({ origin, path: PATHS.ping, method: 'GET', fetchImpl });
			if (answer.status !== 'ok') return { kind: 'unreachable' };
			const features = Array.isArray(answer.features) ? answer.features.filter(f => typeof f === 'string') : [];
			return { kind: 'reachable', features };
		} catch (e) {
			const code = e && e.code;
			if (code === 'maintenance') return { kind: 'maintenance', until: e.until };
			if (code === 'rate-limited') return { kind: 'rate-limited' };
			return { kind: 'unreachable' };
		}
	}

	// Not gated: it is asked exactly while sync is NOT on yet. The server is the
	// one gated() would talk to.
	async function ping() {
		const origin = root.GesturaSyncLocal.syncOrigin(await root.GesturaEuLocal.read());
		return pingService({ origin, fetchImpl: (url, init) => fetch(url, init) });
	}
```

Add `pingService, ping` to `api`.

- [ ] **Step 4: Run the tests and watch them pass.**

Run: `npx vitest run tests/eu-sync.test.mjs` → PASS.
Run: `npm test` → all pass.

- [ ] **Step 5: Commit.**

```bash
git add js/eu-sync.js tests/eu-sync.test.mjs
git commit -m "feat(sync): ping, 503 maintenance with until, 404 from list/PUT reads as unreachable"
```

**Acceptance:**
- Every row of the §5 classification table has a passing test.
- The ping goes out as a GET with no body and no Content-Type.
- `get` keeps `not-found`.
- No existing `eu-sync` test changed.

---

### Task 3: Error texts move into one module, then gain maintenance and "unreachable"

**Files:**
- Create: `js/components/sync-reach.js`
- Modify: `js/components/eu-sync-panel.js` (`SYNC_ERRORS`, `#fail`)
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json`, `tests/site-menu-locales.test.mjs`
- Test: `tests/sync-reach.test.mjs`

**Interfaces:**
- Produces (ES module, no Lit import):
  - `SYNC_ERRORS`: the panel's map, moved, plus `unavailable: 'euSyncUnreachable'`.
  - `syncErrorText(i18n, e) → string`. Handles maintenance; ignores the conflict date, which the panel appends itself.
  - `maintenanceText(i18n, until: string, now = new Date()) → string`.
  - `reachText(i18n, reach) → string`, for the four `pingService` kinds.

Two commits. The first is a pure move with no behaviour change; the second adds behaviour.

- [ ] **Step 1: Move the map (refactor).** Create `js/components/sync-reach.js`:

```js
// What the user reads when a sync request fails, or when gestura.eu cannot be
// used right now. Shared by the sync panel and the onboarding wizard, so both
// say the same thing about the same failure. No Lit import: tests load it.

// Written out rather than composed from the error code: a computed key cannot
// be found by searching, and a typo in one would surface to the user first.
export const SYNC_ERRORS = {
	network: 'euSyncErrorNetwork',
	'bad-request': 'euSyncErrorBadRequest',
	'not-found': 'euSyncErrorNotFound',
	'too-large': 'euSyncErrorTooLarge',
	'quota-states': 'euSyncErrorQuotaStates',
	'rate-limited': 'euSyncErrorRateLimited',
	server: 'euSyncErrorServer',
	malformed: 'euSyncErrorMalformed',
	decrypt: 'euSyncErrorDecrypt',
	stale: 'euSyncErrorStale',
	disabled: 'euSyncErrorDisabled',
	'no-secret': 'euSyncErrorNoSecret',
	conflict: 'euSyncErrorConflict',
};

export function syncErrorText(i18n, e) {
	const code = (e && e.code) || '';
	return i18n.getMessage(SYNC_ERRORS[code] || 'euSyncErrorServer');
}
```

In `eu-sync-panel.js`, delete `static SYNC_ERRORS = {…}` with its comment and import `import { SYNC_ERRORS, syncErrorText } from './sync-reach.js';`. Then:
- `#fail` becomes `this._error = syncErrorText(window.i18n, e);`, keeping the `_errorCode` line and the conflict-date block;
- `EuSyncPanel.SYNC_ERRORS['not-found']` in `#freshen` becomes `SYNC_ERRORS['not-found']`.

Run: `npm test` → all pass. Run: `grep -n "EuSyncPanel.SYNC_ERRORS" js/components/eu-sync-panel.js` → no output.

```bash
git add js/components/sync-reach.js js/components/eu-sync-panel.js
git commit -m "refactor(sync): the error-text map moves into sync-reach.js"
```

- [ ] **Step 2: Write the failing tests** `tests/sync-reach.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { syncErrorText, maintenanceText, reachText } from '../js/components/sync-reach.js';

const MSG = {
	euSyncMaintenance: 'M',
	euSyncMaintenanceUntil: 'M until {time}',
	euSyncMaintenanceUntilDate: 'M until {date}, {time}',
	euSyncUnreachable: 'U',
	euSyncErrorRateLimited: 'R',
	euSyncErrorServer: 'S',
};
const i18n = { getMessage: k => MSG[k] ?? k, getHtmlLang: () => 'de' };
const now = new Date(2026, 9, 9, 10, 0);          // local time, 10:00

describe('maintenanceText', () => {
	it('names the time for a later hour today', () => {
		expect(maintenanceText(i18n, new Date(2026, 9, 9, 14, 0).toISOString(), now)).toBe('M until 14:00');
	});
	it('names date and time for a later day', () => {
		const t = maintenanceText(i18n, new Date(2026, 9, 10, 9, 30).toISOString(), now);
		expect(t.startsWith('M until 10. Oktober, ')).toBe(true);
		expect(t.endsWith('09:30')).toBe(true);
	});
	it('drops the time for an until in the past', () => {
		expect(maintenanceText(i18n, new Date(2026, 9, 9, 9, 0).toISOString(), now)).toBe('M');
	});
	it('drops the time for a missing or unparsable until', () => {
		expect(maintenanceText(i18n, '', now)).toBe('M');
		expect(maintenanceText(i18n, 'soon', now)).toBe('M');
	});
});

describe('syncErrorText and reachText', () => {
	it('unavailable reads as unreachable', () => {
		expect(syncErrorText(i18n, { code: 'unavailable' })).toBe('U');
	});
	it('maintenance from any endpoint uses the maintenance sentence', () => {
		expect(syncErrorText(i18n, { code: 'maintenance', until: '' })).toBe('M');
	});
	it('the four ping kinds', () => {
		expect(reachText(i18n, { kind: 'unreachable' })).toBe('U');
		expect(reachText(i18n, { kind: 'rate-limited' })).toBe('R');
		expect(reachText(i18n, { kind: 'maintenance', until: '' })).toBe('M');
	});
	it('an unknown code falls back to the server sentence', () => {
		expect(syncErrorText(i18n, { code: 'weird' })).toBe('S');
	});
});
```

Run: `npx vitest run tests/sync-reach.test.mjs` → FAIL (`maintenanceText` is not exported).

- [ ] **Step 3: Implement.** Append to `js/components/sync-reach.js`, and add `unavailable: 'euSyncUnreachable'` to `SYNC_ERRORS`:

```js
// "gestura.eu wird gewartet (voraussichtlich bis 14:00 Uhr)." A later day adds
// the date; an until in the past or none at all drops the time rather than
// promising one that has already gone by (spec §8).
export function maintenanceText(i18n, until, now = new Date()) {
	const end = until ? new Date(until) : null;
	if (!end || Number.isNaN(end.getTime()) || end <= now) return i18n.getMessage('euSyncMaintenance');
	const lang = i18n.getHtmlLang();
	const time = end.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
	if (end.toDateString() === now.toDateString()) {
		return i18n.getMessage('euSyncMaintenanceUntil').replace('{time}', time);
	}
	const date = end.toLocaleDateString(lang, { day: 'numeric', month: 'long' });
	return i18n.getMessage('euSyncMaintenanceUntilDate').replace('{date}', date).replace('{time}', time);
}

// The ping's four answers, as one sentence each (spec §5).
export function reachText(i18n, reach) {
	if (reach.kind === 'maintenance') return maintenanceText(i18n, reach.until);
	if (reach.kind === 'rate-limited') return i18n.getMessage('euSyncErrorRateLimited');
	return i18n.getMessage('euSyncUnreachable');
}
```

and in `syncErrorText`, before the map lookup:

```js
	if (code === 'maintenance') return maintenanceText(i18n, e.until);
```

Keys (en / de):

| key | en | de |
|---|---|---|
| `euSyncUnreachable` | gestura.eu can't be reached right now. Please try again later. | gestura.eu ist derzeit nicht erreichbar. Bitte versuche es später noch einmal. |
| `euSyncMaintenance` | gestura.eu is under maintenance. | gestura.eu wird gewartet. |
| `euSyncMaintenanceUntil` | gestura.eu is under maintenance (expected until {time}). | gestura.eu wird gewartet (voraussichtlich bis {time} Uhr). |
| `euSyncMaintenanceUntilDate` | gestura.eu is under maintenance (expected until {date}, {time}). | gestura.eu wird gewartet (voraussichtlich bis {date}, {time} Uhr). |

Add all four to `PENDING_TRANSLATION`.

- [ ] **Step 4: Run.** `npx vitest run tests/sync-reach.test.mjs` → PASS. `npm test` → all pass. The locale tests pass too, because the keys are listed.

- [ ] **Step 5: Commit.**

```bash
git add js/components/sync-reach.js tests/sync-reach.test.mjs _locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs
git commit -m "feat(sync): maintenance and unreachable read as such, from every endpoint"
```

**Acceptance:**
- Commit 1 changes no behaviour (suite green, no new keys).
- Commit 2: all §8 maintenance rules pass:
  - same day → time;
  - later day → date and time;
  - past or garbage → no time.
- A `503` from any sync request shows the maintenance or unreachable sentence in the panel's banner.

---

### Task 4: The card mapping and the transition table

**Files:**
- Create: `js/components/storage-choice.js`
- Test: `tests/storage-choice.test.mjs`

**Interfaces:**
- Produces:
  - `cardFor(area: 'sync'|'local', enabled: boolean) → { card: 'browser'|'local'|'eu', repair: boolean }`.
  - `planFor(from, to) → 'none'|'to-local'|'to-browser'|'onboard'|'off'|'off-then-browser'`.

- [ ] **Step 1: Failing test** `tests/storage-choice.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { cardFor, planFor } from '../js/components/storage-choice.js';

describe('cardFor (spec §3) - total over all four combinations', () => {
	it.each([
		['sync', false, { card: 'browser', repair: false }],
		['local', false, { card: 'local', repair: false }],
		['local', true, { card: 'eu', repair: false }],
		['sync', true, { card: 'eu', repair: true }],
	])('(%s, enabled %s)', (area, enabled, want) => {
		expect(cardFor(area, enabled)).toEqual(want);
	});
});

describe('planFor (spec §4)', () => {
	it.each([
		['browser', 'local', 'to-local'],
		['local', 'browser', 'to-browser'],
		['browser', 'eu', 'onboard'],
		['local', 'eu', 'onboard'],
		['eu', 'local', 'off'],
		['eu', 'browser', 'off-then-browser'],
		['eu', 'eu', 'none'],
		['local', 'local', 'none'],
	])('%s -> %s', (from, to, want) => {
		expect(planFor(from, to)).toBe(want);
	});
});
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement** `js/components/storage-choice.js`:

```js
// The three ways settings travel, as the sync section shows them (onboarding
// design §3, §4). Pure: the panel renders, this decides. No Lit import.

// The mapping is total. It reads the switch, not syncEnabled(): a stale consent
// still shows "Über gestura.eu", with the reconfirm row. The fourth combination
// - browser sync on AND gestura.eu on - is a half-finished switch or a race
// between two tabs; it shows gestura.eu with the repair line.
export function cardFor(area, enabled) {
	if (enabled) return { card: 'eu', repair: area === 'sync' };
	return { card: area === 'local' ? 'local' : 'browser', repair: false };
}

// What activating card `to` does while `from` is active. One dialog per change
// at most; the panel runs the plan.
export function planFor(from, to) {
	if (from === to) return 'none';
	if (to === 'eu') return 'onboard';
	if (from === 'eu') return to === 'browser' ? 'off-then-browser' : 'off';
	return to === 'local' ? 'to-local' : 'to-browser';
}
```

- [ ] **Step 3: Run** → PASS; `npm test` → all pass.

- [ ] **Step 4: Commit.**

```bash
git add js/components/storage-choice.js tests/storage-choice.test.mjs
git commit -m "feat(sync): card mapping and transition table for the three-way choice"
```

**Acceptance:** all four (area, enabled) combinations and all six cross transitions have a passing test.

---

### Task 5: Extract the area switch from the options page (refactor, no behaviour change)

**Files:**
- Create: `js/components/storage-refusal.js` (moved code)
- Create: `js/components/storage-area-switch.js`
- Modify: `js/components/storage-full-dialog.js` (re-export)
- Modify: `js/components/options-page.js` (`#switchArea`, `#confirmWayBack`)
- Test: `tests/storage-area-switch.test.mjs`

**Interfaces:**
- Produces:
  - `branchLabel(i18n, key)` and `fillRefusal(i18n, key, res)`, now from `storage-refusal.js`. `storage-full-dialog.js` re-exports both, so existing imports keep working.
  - `switchArea(S, target: 'sync'|'local', reason = 'local') → Promise<{ landed: boolean, refusal: object|null }>`. The refusal is the façade's answer whenever the browser did not land on the target.
  - `refusalText(i18n, refusal) → string`.
  - `wayBackText(S, i18n, formatDate: (iso) => string) → Promise<string>`.

- [ ] **Step 1: Move `BRANCH_LABELS`, `branchLabel`, `fillRefusal`** verbatim (with their comments) from `storage-full-dialog.js` into a new `js/components/storage-refusal.js`. In `storage-full-dialog.js`, replace them with:

```js
import { fillRefusal } from './storage-refusal.js';
export { branchLabel, fillRefusal } from './storage-refusal.js';
```

The dialog uses `fillRefusal` itself, so keep the import.

- [ ] **Step 2: Failing test** `tests/storage-area-switch.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { switchArea, refusalText, wayBackText } from '../js/components/storage-area-switch.js';

const fakeS = (answer, landedArea, note = null) => {
	let area = 'sync';
	return {
		switchTo: async (target) => { area = landedArea ?? (answer.ok ? target : area); return answer; },
		area: () => area,
		note: async () => { if (note instanceof Error) throw note; return note; },
	};
};
const i18n = { getMessage: k => ({
	storageSwitchRefusedBranch: 'B {branch} {used} {total}',
	storageSwitchRefusedTotal: 'T {used} {total}',
	storageSwitchRefusedTier2: 'TIER2',
	storageSwitchFailed: 'FAILED',
	storageSwitchToSyncConfirm: 'BACK',
	storageSwitchToSyncConfirmSince: 'BACK since {date}',
	siteMenusTitle: 'Menus',
	storageBranchOther: 'Other',
}[k] ?? k) };

describe('switchArea', () => {
	it('landed, no refusal, on success', async () => {
		expect(await switchArea(fakeS({ ok: true }), 'local')).toEqual({ landed: true, refusal: null });
	});
	it('ok:false but the area moved anyway counts as landed (failed rollback)', async () => {
		expect(await switchArea(fakeS({ ok: false, error: 'write' }, 'local'), 'local')).toEqual({ landed: true, refusal: null });
	});
	it('refused: not landed, refusal carried', async () => {
		const res = { ok: false, error: 'branch-full', branch: 'siteMenus', bytes: 9000, quota: 8192 };
		expect(await switchArea(fakeS(res, 'sync'), 'local')).toEqual({ landed: false, refusal: res });
	});
});

describe('refusalText', () => {
	it.each([
		[{ error: 'branch-full', branch: 'siteMenus', bytes: 9000, quota: 8192 }, 'B Menus 9000 8192'],
		[{ error: 'total-full', branch: '', bytes: 200000, quota: 102400 }, 'T 200000 102400'],
		[{ error: 'tier2-enabled' }, 'TIER2'],
		[{ error: 'write' }, 'FAILED'],
	])('%o', (res, want) => { expect(refusalText(i18n, res)).toBe(want); });
});

describe('wayBackText', () => {
	it('names the date the other browser left', async () => {
		expect(await wayBackText(fakeS({ ok: true }, null, { movedAt: '2026-01-02' }), i18n, d => `<${d}>`)).toBe('BACK since <2026-01-02>');
	});
	it('without a note, or with a failing read, asks without a date', async () => {
		expect(await wayBackText(fakeS({ ok: true }), i18n, d => d)).toBe('BACK');
		expect(await wayBackText(fakeS({ ok: true }, null, new Error('x')), i18n, d => d)).toBe('BACK');
	});
});
```

Run → FAIL (module missing).

- [ ] **Step 3: Implement** `js/components/storage-area-switch.js`:

```js
import { fillRefusal } from './storage-refusal.js';

// Switching where the settings live, without component state (onboarding
// design §3). `S` is GesturaSettingsStorage; passed in so tests need no window.
//
// Judged by the area, not by ok: switchTo() answers { ok: false, error: 'write' }
// when its sequence broke, and a failed rollback inside it can leave the
// browser genuinely switched. "Nothing was changed" on the strength of ok:false
// alone would then be a lie.
export async function switchArea(S, target, reason = 'local') {
	const res = await S.switchTo(target, reason);
	const landed = S.area() === target;
	return { landed, refusal: (!res.ok && !landed) ? res : null };
}

// res.branch / res.bytes / res.quota describe the TARGET area's ceiling here -
// unlike a set() failure, where they describe the active one.
export function refusalText(i18n, res) {
	const fill = (key) => fillRefusal(i18n, key, res);
	return res.error === 'branch-full' ? fill('storageSwitchRefusedBranch')
		: res.error === 'total-full' ? fill('storageSwitchRefusedTotal')
		: res.error === 'tier2-enabled' ? i18n.getMessage('storageSwitchRefusedTier2')
		: i18n.getMessage('storageSwitchFailed');
}

// The way back writes this browser's whole local copy over browser sync; what
// another browser saved there since is overwritten. The date comes from the
// note the departing browser left; a failing read costs the date, not the
// question.
export async function wayBackText(S, i18n, formatDate) {
	let left = null;
	try { left = await S.note(); } catch { left = null; }
	return (left && left.movedAt)
		? i18n.getMessage('storageSwitchToSyncConfirmSince').replace('{date}', formatDate(left.movedAt))
		: i18n.getMessage('storageSwitchToSyncConfirm');
}
```

- [ ] **Step 4: Route `options-page.js` through it, without changing behaviour.**
  - Import `switchArea, refusalText, wayBackText` from `./storage-area-switch.js`.
  - In `#switchArea`, replace the `S.switchTo(...)` call, the `landed` computation and the message ternary with:

```js
		const { landed, refusal } = await switchArea(S, target, reason);
		if (refusal) this._switchRefusal = refusalText(i18n, refusal);
```

  - `#confirmWayBack` becomes `return window.confirm(await wayBackText(window.GesturaSettingsStorage, i18n, iso => this.#formatDate(iso)));`.
  - Remove the now-unused `fillRefusal` import if nothing else in the file uses it. Check with grep.

- [ ] **Step 5: Run.** `npx vitest run tests/storage-area-switch.test.mjs` → PASS. `npm test` → all pass.

- [ ] **Step 6: Browser check (behaviour unchanged).** Load the extension in the test Edge (see Task 19, "Setup"). In Datenverwaltung:
  1. toggle browser sync off → on → confirm;
  2. seed a 9000-byte `siteMenus` into `storage.local` and toggle on.

Expected: same as before. Off switches at once; on asks the `window.confirm`; the oversized branch shows the refusal notice with the branch name and both numbers.

- [ ] **Step 7: Commit.**

```bash
git add js/components/storage-refusal.js js/components/storage-area-switch.js js/components/storage-full-dialog.js js/components/options-page.js tests/storage-area-switch.test.mjs
git commit -m "refactor(storage): the area switch and its refusal texts become a module"
```

**Acceptance:**
- New module tests pass.
- `options-page.js` no longer calls `S.switchTo` directly. Check: `grep -n "switchTo" js/components/options-page.js` gives no output.
- The browser behaviour of the Datenverwaltung switch is unchanged (step 6).

---

### Task 6: Stand → Profil in every user-visible sync string (text only)

**Files:** `_locales/en/messages.json`, `_locales/de/messages.json`, `tests/site-menu-locales.test.mjs` (hand-note comment only)

There are no code changes and no new keys; only the values below change. The consent points (`euSyncConsentPoint*`) are **not** touched here; Task 16 rewrites them.

- [ ] **Step 1: Apply the table.** Edit the values with a script, so that only `message` values change and the key order stays. Put a node script in the scratchpad that reads both files, sets the values below, and writes them back with `JSON.stringify(obj, null, '\t') + '\n'`.

Before writing anything, compare the script's output with the original formatting: `git diff --stat` must show only changed `message` lines. If the files use a different indentation, match it.

| key | de | en |
|---|---|---|
| `settingsPreviewChangeThere` | Änderungen am Profil „{name}“ | Changes to the profile “{name}” |
| `euSyncOffBody` | Beim Ausschalten wird nichts gelöscht. Dein Code bleibt in diesem Browser gespeichert und deine Profile bleiben auf gestura.eu — schaltest du den Abgleich wieder ein, ist alles wieder da. | Turning sync off deletes nothing. Your code stays saved in this browser and your profiles stay on gestura.eu — turn sync back on and everything is there again. |
| `euSyncOffDeleteAllDesc` | Oder alles löschen: alle Profile unter diesem Code auf gestura.eu — auch für deine anderen Browser, die diesen Code verwenden — und den Code in diesem Browser. Das lässt sich nicht rückgängig machen. | Or delete everything: all profiles under this code on gestura.eu — also for your other browsers that use this code — and the code in this browser. This cannot be undone. |
| `euSyncSecretDesc` | Dieser Code ist der Schlüssel zu deinen Profilen. Leg ihn in deinen Passwortspeicher — und in den zweiten Browser, um ihn zu verbinden. | This code is the key to your profiles. Put it in your password manager — and into the second browser to pair it. |
| `euSyncSecretNewConfirm` | (replace „Deine bisherigen Stände“ with „Deine bisherigen Profile“; rest unchanged) | (replace "Your existing states" with "Your existing profiles") |
| `euSyncSecretLoaded` | Code geladen — die darunter gesicherten Profile siehst du jetzt hier. | Code loaded — the profiles saved under it are now shown here. |
| `euSyncSecretPairDesc` | Füge hier den Code aus deinem anderen Browser ein, um dessen Profile zu sehen. | Paste the code from your other browser here to see its profiles. |
| `euSyncStatesTitle` | Deine Profile | Your profiles |
| `euSyncStatesOne` | 1 Profil | 1 profile |
| `euSyncStatesMany` | {n} Profile | {n} profiles |
| `euSyncCreate` | Als neues Profil hochladen | Upload as a new profile |
| `euSyncRenameUnavailable` | gestura.eu kann Profile noch nicht umbenennen. | gestura.eu cannot rename profiles yet. |
| `euSyncDeleteConfirm` | Das Profil {name} auf gestura.eu löschen? | Delete the profile {name} from gestura.eu? |
| `euSyncDeleteAllConfirm` | Alle unter diesem Code gesicherten Profile auf gestura.eu löschen? Deine Einstellungen in diesem Browser bleiben, wie sie sind. | Delete every profile saved under this code from gestura.eu? Your settings in this browser stay as they are. |
| `euSyncStateBroken` | Dieses Profil lässt sich mit dem aktuellen Code nicht lesen. | This profile cannot be read with the current code. |
| `euSyncDuplicateName` | Ein Profil mit diesem Namen besteht bereits. Namen dürfen sich wiederholen — die Profile bleiben getrennt. | A profile with this name already exists. Names may repeat — the profiles stay separate. |
| `euSyncQuotaReached` | Du hast das Höchstmaß von {max} Profilen erreicht. Lösche eines, um ein weiteres zu sichern. | You have reached the maximum of {max} profiles. Delete one to save another. |
| `euSyncErrorNotFound` | Dieses Profil gibt es auf gestura.eu nicht mehr. | This profile no longer exists on gestura.eu. |
| `euSyncErrorQuotaStates` | Unter diesem Code ist kein Platz für ein weiteres Profil. | There is no room for another profile under this code. |
| `euSyncErrorStale` | Dieses Profil wurde inzwischen ersetzt. Die Liste wurde neu geladen, bitte versuche es noch einmal. | This profile was replaced in the meantime. The list has been refreshed, please try again. |
| `euSyncErrorChangedMeanwhile` | Dieses Profil hat sich inzwischen geändert ({date}). Die Liste wurde neu geladen; es wurde nichts verändert. | This profile changed in the meantime ({date}). The list has been refreshed; nothing was changed. |
| `euSyncErrorConflict` | Dieses Profil wurde inzwischen woanders geändert. Es wurde nichts überschrieben. | This profile was changed elsewhere in the meantime. Nothing was overwritten. |
| `euSyncMergeNewerVersion` | Dieses Profil stammt aus einer neueren Version von Gestura. Aktualisiere Gestura zuerst, oder sieh mit „Aktivieren“, was verloren ginge. | This profile was written by a newer Gestura. Update Gestura first, or use “Activate” to see what would be lost. |
| `euSyncMergeNoBase` | Dieser Browser hat dieses Profil noch nie aktiviert oder hochgeladen. Aktiviere es einmal hier; danach ist Abgleichen verfügbar. | This browser has not activated or uploaded this profile yet. Activate it here once; after that, Sync is available. |
| `euSyncMergeMovedAgain` | Das Profil hat sich inzwischen erneut geändert. Abgleich gegen die neue Version. | The profile changed again in the meantime. Merging against the new version. |
| `euSyncMergeTheirs` | Vom Profil | Theirs |
| `euSyncMergeAllTheirs` | Überall das Profil übernehmen | Take all theirs |

The following pending keys are rewritten in Task 13 and are therefore not touched here: `euSyncCodeSwitchDesc`, `euSyncCodeSwitchLockedUnknown`, `euSyncCodeSwitchLocked`.

- [ ] **Step 2: Find what is left.**

Run: `node -e "for (const l of ['de','en']) { const m=require('./_locales/'+l+'/messages.json'); for (const [k,v] of Object.entries(m)) if (/^(euSync|settingsPreview|syncMerge)/.test(k) && (l==='de' ? /\bSt(a|ä)nd(e|en|es)?\b/ : /\bstates?\b/i).test(v.message)) console.log(l,k) }"`

Expected: only `euSyncConsentPoint*` (Task 16) and the three Task-13 keys. Any other hit is changed the same way and added to the table in this plan.

- [ ] **Step 3: Note the all-locale keys by hand.** In `tests/site-menu-locales.test.mjs`, add a comment line below the existing hand notes:

```js
// Changed wording in all 39 locales, not caught by a test: Stand/state -> Profil/profile
// (onboarding design §2) in settingsPreviewChangeThere, euSyncOffBody, euSyncOffDeleteAllDesc,
// euSyncSecretDesc, euSyncSecretNewConfirm, euSyncStatesTitle, euSyncCreate, euSyncDeleteConfirm,
// euSyncDeleteAllConfirm, euSyncStateBroken, euSyncDuplicateName, euSyncQuotaReached,
// euSyncErrorNotFound, euSyncErrorQuotaStates, euSyncMerge*; the 37 others still say "state".
```

Before writing it, check every listed key against the PENDING list: keys that are pending are not "all 39" and do not belong in this note. Trim the list accordingly.

- [ ] **Step 4: Run.** `npm test` → all pass. The placeholder test passes, so no `$` was introduced.

- [ ] **Step 5: Commit.**

```bash
git add _locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs
git commit -m "i18n(sync): Profil replaces Stand in every user-visible sync string"
```

**Acceptance:**
- Step 2's search lists only the consent points and the three Task-13 keys.
- `git diff HEAD~1 --stat` touches only the three files.
- The suite is green.

---

### Task 7: Mock: ping, maintenance, GET in CORS (outside git)

**Files:** `C:\Users\pp.11COM7\.claude\projects\c--Programme-alt-Gestura\browser-verify\sync-mock.mjs` and `sync-config.json` beside it. Not in the repo, so no commit.

- [ ] **Step 1: Extend the config defaults** in `sync-mock.mjs`:

```js
	// Ping only: 0 = answer { status: 'ok' }; any other number = that status.
	pingStatus: 0,
	// Planned maintenance on ping AND every sync endpoint: { until?: ISO } or null.
	maintenance: null,
```

- [ ] **Step 2: CORS** becomes `'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'`.

- [ ] **Step 3: Route GET /api/v1/sync/ping** before the body handling. In the `createServer` callback, after the OPTIONS block:

```js
	if (req.method === 'GET' && req.url === '/api/v1/sync/ping') {
		record({ method: 'GET', url: req.url, contentType: req.headers['content-type'] || '' });
		const c = cfg();
		setTimeout(() => {
			if (c.maintenance) return send(res, 503, { error: 'maintenance', ...(c.maintenance.until ? { until: c.maintenance.until } : {}) });
			if (c.pingStatus) return fail(res, c.pingStatus, c.pingStatus === 503 ? 'unavailable' : 'server');
			send(res, 200, { status: 'ok', features: ['sync-meta'] });
		}, c.delayMs);
		return;
	}
```

At the top of `handleSync`, before `forceStatus`:

```js
	if (c.maintenance) return send(res, 503, { error: 'maintenance', ...(c.maintenance.until ? { until: c.maintenance.until } : {}) });
```

- [ ] **Step 4: Smoke test.** Start: `SYNC_PORT=8198 node sync-mock.mjs` (background). Then:

```bash
curl -s -i http://localhost:8198/api/v1/sync/ping | head -1      # HTTP/1.1 200 OK
curl -s -i -X OPTIONS http://localhost:8198/api/v1/sync/ping | grep -i allow-methods   # GET, POST, PUT, OPTIONS
```

Set `"maintenance": {"until": "2026-10-09T12:00:00Z"}` in `sync-config.json` and run the ping curl again: expect `503` and the body. Reset the config and stop the mock (kill the port-8198 listener).

**Acceptance:**
- The ping answers `200`/`503 maintenance`/a configured status.
- Maintenance also hits `/sync/list`.
- CORS allows GET.
- The mock is stopped afterwards.

---

### Task 8: The three cards in the sync section

The gestura.eu card still opens today's consent dialog; Task 10 replaces that dialog with the wizard.

**Files:**
- Modify: `js/components/eu-sync-panel.js`
- Modify: `js/components/options-page.js`
- Modify: `_locales/en|de/messages.json`, `tests/site-menu-locales.test.mjs`

**Interfaces:**
- Consumes:
  - `cardFor`, `planFor` (Task 4);
  - `switchArea`, `refusalText`, `wayBackText` (Task 5);
  - `GesturaSettingsStorage.fitsSync`, `onAreaChanged` (Task 1);
  - `GesturaSync.ping`, `reachText` (Tasks 2, 3).
- Produces, on `<eu-sync-panel>`:
  - public `async chooseWay(way: 'local'|'eu') → { opened: boolean, message: string }`, for the storage-full dialog (Task 15);
  - `#startOnboarding(opts?: { start?: 'existing' }) → Promise<{ opened, message }>`, which Tasks 10 and 11 replace.
  - Panel state `_area`, `_choiceMsg`, `_choiceRetry`, `_checking`, `_movedNote`. `_offOpen` becomes `false | { toBrowser: boolean }`.

- [ ] **Step 1: Keys** (en / de; all into `PENDING_TRANSLATION`). The card texts are verbatim from §11.

| key | de | en |
|---|---|---|
| `euSyncChoiceLabel` *(owner check)* | Wie sollen deine Einstellungen in andere Browser kommen? | How should your settings get to your other browsers? |
| `euSyncCardBrowserTitle` | Über deinen Browser | Through your browser |
| `euSyncCardBrowserDesc` | Automatische Synchronisation, aber nicht browserübergreifend (z. B. nur Chrome zu Chrome) und nicht in jedem Browser (Brave z. B. gar nicht). Bietet wenig Platz – nur für wenige eigene Suchmaschinen und Menüs. | Syncs automatically, but not across browsers (e.g. only Chrome to Chrome) and not in every browser (Brave, for example, not at all). Offers little room – only for a few custom search engines and menus. |
| `euSyncCardLocalTitle` | Nur in diesem Browser | Only in this browser |
| `euSyncCardLocalDesc` | Reichlich Platz und 100 % lokal: Dieser Browser überträgt deine Einstellungen nicht mehr – außer du exportierst sie selbst. Ein Abgleich mit anderen Browsern läuft manuell per Datei-Ex- und -Import. | Plenty of room and 100 % local: this browser no longer transfers your settings – unless you export them yourself. Syncing with other browsers is done by hand, via file export and import. |
| `euSyncCardEuTitle` | Über gestura.eu | Through gestura.eu |
| `euSyncCardEuDesc` | Ebenso reichlich Platz, Ende-zu-Ende-verschlüsselt und deutlich komfortabler als der Ex-/Import: Übertrage deine Einstellungen browserübergreifend zwischen Chrome, Firefox, Brave & Co. Bis zu 5 Profile (Büro, Laptop, Privat …), komplett ohne Konto. | Just as much room, end-to-end encrypted and far more convenient than export and import: transfer your settings across browsers – Chrome, Firefox, Brave & co. Up to 5 profiles (Office, Laptop, Private …), entirely without an account. |
| `euSyncCardSwitchConfirm` *(owner check)* | Umstellen | Switch |
| `euSyncStatusSaved` | Gespeichert um {time} | Saved at {time} |
| `euSyncStatusWayBrowser` | Abgleich über deinen Browser | Synced through your browser |
| `euSyncStatusWayLocal` | Nur in diesem Browser | Only in this browser |
| `euSyncStatusWayEu` | Abgleich über gestura.eu | Synced through gestura.eu |
| `euSyncRepair` | Die Umstellung ist nicht abgeschlossen. | The switch did not complete. |
| `euSyncRetry` | Erneut versuchen | Try again |
| `euSyncConnecting` | Verbinde mit gestura.eu … | Connecting to gestura.eu … |
| `euSyncOffToBrowser` | Danach überträgt wieder dein Browser – mit den Einstellungen aus diesem Browser. | Afterwards your browser transfers them again – with the settings from this browser. |

- [ ] **Step 2: Panel state and subscriptions.** In `eu-sync-panel.js`:
  - Imports:
    - `import { cardFor, planFor } from './storage-choice.js';`
    - `import { switchArea, refusalText, wayBackText } from './storage-area-switch.js';`
    - `import { reachText } from './sync-reach.js';` (merge it with the Task-3 import).
  - Add to `static properties`: `_area`, `_choiceMsg`, `_checking`, `_movedNote` (all `{ state: true }`).
  - In the constructor: `this._area = window.GesturaSettingsStorage.area(); this._choiceMsg = ''; this._choiceRetry = null; this._checking = false; this._movedNote = null; this._offArea = null;`.
  - In `connectedCallback`, add:

```js
		// The cards follow the storage area, whichever tab or context moves it.
		const S = window.GesturaSettingsStorage;
		S.ready().then(() => { this._area = S.area(); this.#refreshMovedNote(); });
		this._offArea = S.onAreaChanged(area => { this._area = area; this.#refreshMovedNote(); });
```

  - In `disconnectedCallback`: `if (this._offArea) this._offArea();`.
  - The `gestura:settings-saved` handler and the `settingsStore.onChange` handler also call `this.requestUpdate()`, so the status row shows the new time. Change `this._onSaved = () => { this.#recomputeHash(); this.requestUpdate(); };` and `settingsStore.onChange(() => { this.#recomputeHash(); this.requestUpdate(); })`.

```js
	// note() reads chrome.storage.sync and rejects when that store is broken -
	// caught here, and only asked in state 'sync', where it means something.
	async #refreshMovedNote() {
		const S = window.GesturaSettingsStorage;
		if (S.area() !== 'sync') { this._movedNote = null; return; }
		try { this._movedNote = await S.note(); } catch { this._movedNote = null; }
	}
```

- [ ] **Step 3: The transitions.** Add to the panel:

```js
	#card() {
		return cardFor(this._area, !!(this.#state && this.#state.enabled));
	}

	// One plan per change, one dialog at most (spec §4). Runs inside #exclusive.
	async #choose(to) {
		const i18n = window.i18n;
		const S = window.GesturaSettingsStorage;
		const from = this.#card().card;
		this._choiceMsg = '';
		this._choiceRetry = null;
		switch (planFor(from, to)) {
		case 'to-local':
			await this.#landOn('local', 'local');
			return;
		case 'to-browser': {
			const fit = await S.fitsSync();
			if (!fit.ok) { this._choiceMsg = refusalText(i18n, fit); return; }
			if (!await this.#ask({
				title: i18n.getMessage('euSyncCardBrowserTitle'),
				text: await wayBackText(S, i18n, iso => this.#formatDay(iso)),
				confirm: i18n.getMessage('euSyncCardSwitchConfirm'),
			})) return;
			await this.#landOn('sync');
			return;
		}
		case 'onboard':
			await this.#startOnboarding();
			return;
		case 'off':
			this.#openOff(false);
			return;
		case 'off-then-browser': {
			// Checked BEFORE the dialog: "Alles löschen" in it cannot be undone, and
			// a switch that is refused afterwards would have cost the profiles for
			// nothing.
			const fit = await S.fitsSync();
			if (!fit.ok) { this._choiceMsg = refusalText(i18n, fit); return; }
			this.#openOff(true);
			return;
		}
		default:
		}
	}

	async #landOn(target, reason = 'local') {
		const { refusal } = await switchArea(window.GesturaSettingsStorage, target, reason);
		if (refusal) this._choiceMsg = refusalText(window.i18n, refusal);
	}

	// The reachability check in front of the onboarding (spec §5): once per
	// activation, and again on "Erneut versuchen". On failure the choice stays
	// where it was.
	async #startOnboarding(opts = {}) {
		this._choiceMsg = '';
		this._choiceRetry = null;
		this._checking = true;
		let reach;
		try {
			reach = await window.GesturaSync.ping();
		} catch {
			reach = { kind: 'unreachable' };
		} finally {
			this._checking = false;
		}
		if (reach.kind !== 'reachable') {
			this._choiceMsg = reachText(window.i18n, reach);
			this._choiceRetry = () => this.#startOnboarding(opts);
			return { opened: false, message: this._choiceMsg };
		}
		this.#open();          // Task 10 replaces this with the wizard
		return { opened: true, message: '' };
	}

	// The storage-full dialog's ways out land here: the panel owns every change
	// of where settings live (spec §9).
	async chooseWay(way) {
		let result = { opened: false, message: '' };
		await this.#exclusive(async () => {
			if (way === 'local') {
				await this.#landOn('local', 'local');
				result = { opened: this._area === 'local', message: this._choiceMsg };
				return;
			}
			result = await this.#startOnboarding();
		});
		return result;
	}

	#formatDay(iso) {
		try {
			return new Date(iso).toLocaleDateString(window.i18n.getHtmlLang(), { year: 'numeric', month: 'long', day: 'numeric' });
		} catch { return String(iso).slice(0, 10); }
	}
```

- [ ] **Step 4: The turn-off dialog learns "and then browser sync".** `_offOpen` becomes `false | { toBrowser }`:
  - `#openOff(toBrowser = false) { this._offOpen = { toBrowser }; this.#lockScroll(true); }`;
  - every `this._offOpen = true` becomes `this.#openOff(false)`.
  - The stale-consent row's button calls `() => this.#openOff(false)`.
  - In `#offKeep` and `#offDeleteAll`, read `const toBrowser = !!(this._offOpen && this._offOpen.toBrowser);` **before** `this.#closeOff()`. After the switch-off succeeded (in `#offDeleteAll`, after the final `write`; in `#offKeep`, after `#revoke()`), add:

```js
		// gestura.eu -> Browser (spec §4): the fit was checked before the dialog;
		// toSync() refuses while the switch is on, so this comes after it.
		if (toBrowser) await this.#landOn('sync');
```

  - In `#renderOffDialog`, below the lead paragraph:

```js
						${this._offOpen && this._offOpen.toBrowser ? html`<p class="lead">${i18n.getMessage('euSyncOffToBrowser')}</p>` : ''}
```

- [ ] **Step 5: Render the cards, status row, moved note and repair line.** CSS (add to the panel's `css`):

```css
		.way-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-top: 4px; }
		.way-card { display: flex; flex-direction: column; gap: 6px; padding: 14px 16px; text-align: start; border-radius: 12px; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-primary); font: inherit; cursor: pointer; }
		.way-card:hover:not([aria-disabled="true"]) { border-color: color-mix(in srgb, var(--accent-color) 55%, var(--border-color)); }
		.way-card:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
		.way-card[aria-pressed="true"] { border-color: var(--accent-color); background: color-mix(in srgb, var(--accent-color) 6%, var(--card-bg)); cursor: default; }
		.way-card[aria-disabled="true"]:not([aria-pressed="true"]) { opacity: .6; cursor: not-allowed; }
		.way-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
		.way-title svg { width: 16px; height: 16px; color: var(--accent-color); }
		.way-desc { font-size: 13px; line-height: 1.45; color: var(--text-secondary); }
		.status-row { margin-top: 10px; font-size: 13px; color: var(--text-secondary); }
		.connecting { min-height: 0; font-size: 13px; color: var(--text-secondary); }
		.connecting:not(:empty) { margin-top: 8px; }
		.choice-msg { margin-top: 10px; }
		.moved-note { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 10px; font-size: 13px; color: var(--warning-color); }
```

Methods:

```js
	// The choice IS the explanation (spec §3). Buttons with aria-pressed, not a
	// radio group: arrow keys in a radio group select, and selecting here opens
	// dialogs and moves storage. The active card does nothing when pressed.
	#renderChoice() {
		const i18n = window.i18n;
		const { card, repair } = this.#card();
		const opt = (id, titleKey, descKey) => {
			const active = card === id;
			const blocked = this._busy || this._checking;
			return html`
				<button type="button" class="way-card" aria-pressed=${active ? 'true' : 'false'}
					aria-disabled=${blocked ? 'true' : 'false'}
					@click=${() => { if (!active && !blocked) this.#exclusive(() => this.#choose(id)); }}>
					<span class="way-title">${active ? unsafeHTML(icons.circleCheck) : ''}${i18n.getMessage(titleKey)}</span>
					<span class="way-desc">${i18n.getMessage(descKey)}</span>
				</button>`;
		};
		return html`
			<div class="way-cards" role="group" aria-label=${i18n.getMessage('euSyncChoiceLabel')}>
				${opt('browser', 'euSyncCardBrowserTitle', 'euSyncCardBrowserDesc')}
				${opt('local', 'euSyncCardLocalTitle', 'euSyncCardLocalDesc')}
				${opt('eu', 'euSyncCardEuTitle', 'euSyncCardEuDesc')}
			</div>
			<div class="connecting" role="status">${this._checking ? i18n.getMessage('euSyncConnecting') : ''}</div>
			${repair ? html`
				<div class="msg warn switch-lock choice-msg" role="alert">
					${unsafeHTML(icons.triangleAlert)}
					<span class="msg-text">${i18n.getMessage('euSyncRepair')}</span>
					<button type="button" class="btn btn-secondary" ?disabled=${this._busy}
						@click=${() => this.#exclusive(() => this.#landOn('local', 'gestura.eu'))}>${i18n.getMessage('euSyncRetry')}</button>
				</div>` : ''}
			${this._choiceMsg ? html`
				<div class="msg error-banner choice-msg" role="alert">
					${unsafeHTML(icons.triangleAlert)}
					<span class="msg-text">${this._choiceMsg}</span>
					${this._choiceRetry ? html`
						<button type="button" class="btn btn-secondary" ?disabled=${this._busy || this._checking}
							@click=${() => { const retry = this._choiceRetry; this.#exclusive(() => retry()); }}>${i18n.getMessage('euSyncRetry')}</button>` : ''}
				</div>` : ''}
			${this.#renderStatusRow(card)}
			${this.#renderMovedNote()}`;
	}

	#renderStatusRow(card) {
		const i18n = window.i18n;
		let time = '';
		try {
			const t = settingsStore.current.lastSyncTime;
			if (t) time = new Date(t).toLocaleTimeString(i18n.getHtmlLang(), { hour: '2-digit', minute: '2-digit' });
		} catch { /* store not loaded yet: no time */ }
		const way = i18n.getMessage({ browser: 'euSyncStatusWayBrowser', local: 'euSyncStatusWayLocal', eu: 'euSyncStatusWayEu' }[card]);
		return html`<div class="status-row">${time ? `${i18n.getMessage('euSyncStatusSaved').replace('{time}', time)} \u00b7 ` : ''}${way}</div>`;
	}

	// "Another browser switched browser sync off" - only in state 'sync' (spec
	// §3). Its button follows where that browser went: to local, or to
	// gestura.eu, where this user most likely has the other browser's code.
	#renderMovedNote() {
		const note = this._movedNote;
		if (!note || this._area !== 'sync') return '';
		const i18n = window.i18n;
		const go = note.movedTo === 'gestura.eu'
			? () => this.#startOnboarding({ start: 'existing' })
			: () => this.#landOn('local', 'local');
		return html`
			<div class="moved-note">
				<span>${i18n.getMessage('storageMovedNote').replace('{date}', this.#formatDay(note.movedAt))}</span>
				<button type="button" class="btn btn-secondary" ?disabled=${this._busy}
					@click=${() => this.#exclusive(go)}>${i18n.getMessage('storageMovedSwitch')}</button>
			</div>`;
	}
```

`render()`:
  - Replace the first `setting-row` (the toggle) with `${this.#renderChoice()}`.
  - Delete `#onToggle`.
  - Leave the stale row and the rest of `render()` as they are.
  - The `.first-row` class goes with the deleted row.
  - Add `this._choiceMsg` to the `updated()` scroll-into-view check:

```js
		if (changed.has('_choiceMsg') && this._choiceMsg) this.renderRoot.querySelector('.choice-msg')?.scrollIntoView({ block: 'nearest' });
```

- [ ] **Step 6: The options page lets go.** In `options-page.js`:
  - Data section: delete the `syncStatus` `setting-row`, so the section starts with `${this.#renderStorageRows(i18n)}`. Make the storage rows' first row `first-row` if the CSS needs it; compare a screenshot before and after.
  - `#renderStorageRows` returns `html\`${totalRow}${rows}\``. Delete `#renderAreaSwitch`, `#renderSyncNote`, `#refreshSyncNote`, `#confirmWayBack`, `#switchArea`, `_syncNote`, `_switchRefusal` and every call to them (grep each name until there are no hits).
  - Delete the now-unused imports from `./storage-area-switch.js` (Task 5) as well.
  - Subscribe to the area so the storage rows re-measure against the new ceiling:

```js
		// The sync section moves the area now; the storage rows here measure against it.
		this._offArea = window.GesturaSettingsStorage.onAreaChanged(() => this.requestUpdate());
```

  - (constructor `this._offArea = null;`, `disconnectedCallback`: `if (this._offArea) this._offArea();`).
  - `#onStorageWay`:

```js
	async #onStorageWay(e) {
		const way = e.detail.way;
		const panel = this.shadowRoot.querySelector('eu-sync-panel');
		this._storageFailure = null;
		if ((way === 'local' || way === 'eu') && panel) {
			this.#scrollToSection('euSync');
			await panel.chooseWay(way);
		}
	}
```

Task 15 refines the `'eu'` branch; this is today's behaviour, routed through the panel.

- [ ] **Step 7: Run.** `npm test` → all pass. The module-syntax test parses both components.

- [ ] **Step 8: Browser checks** (setup in Task 19). Start the mock, load the extension, open `options.html#euSync`:

| # | Action | Expected |
|---|---|---|
| 1 | Fresh profile | "Über deinen Browser" pressed; status row "Gespeichert um … · Abgleich über deinen Browser" (or only the way, before the first save) |
| 2 | Click "Nur in diesem Browser" | No dialog; card switches; `area()` = `local`; Datenverwaltung shows the 1 MiB rows |
| 3 | Click "Über deinen Browser" | `#ask` with the way-back text; Cancel → nothing changes; again + "Umstellen" → `area()` = `sync` |
| 4 | Seed a 9000-byte `siteMenus` in local, from local click "Über deinen Browser" | Refusal under the cards with branch name and numbers; **no** dialog |
| 5 | Mock `pingStatus: 503`, click "Über gestura.eu" | "Verbinde mit gestura.eu …" appears, then the unreachable sentence + "Erneut versuchen"; card stays |
| 6 | Mock `maintenance: { until: <today 14:00Z> }`, click again | Maintenance sentence with a time |
| 7 | Mock back to OK, "Erneut versuchen" | Ping goes out once (mock log), today's consent dialog opens |
| 8 | Double activation: focus the gestura.eu card, press Enter twice fast | Exactly one GET `/sync/ping` in the mock log, one dialog |
| 9 | Keyboard: Tab onto the cards, press arrow keys | Nothing happens; no request in the mock log |
| 10 | Set `chrome.storage.sync` `syncMovedAt`/`syncMovedTo='local'` via CDP in state sync, reload | Moved note under the cards; its button → `area()` = `local`, note gone |
| 11 | From gestura.eu (consent dialog accepted), click "Nur in diesem Browser" | The turn-off dialog, without the browser sentence |
| 12 | From gestura.eu, click "Über deinen Browser" with settings that fit | The turn-off dialog **with** "Danach überträgt wieder dein Browser …"; "Nur ausschalten" → `area()` = `sync`, `euSync.enabled` false |
| 13 | As 12 but seeded 9000-byte branch | Refusal at the cards, no dialog, gestura.eu stays on |
| 14 | Write `euSync.enabled = true` while `area` = `sync` (CDP) | gestura.eu pressed + repair line; "Erneut versuchen" → `area()` = `local` |
| 15 | Two tabs: switch to local in tab A | Tab B's cards follow without reload |

- [ ] **Step 9: Commit.**

```bash
git add js/components/eu-sync-panel.js js/components/options-page.js _locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs
git commit -m "feat(sync): the sync section becomes the choice between three ways"
```

**Acceptance:**
- All 15 browser checks pass.
- Datenverwaltung shows no browser-sync switch, no status row and no moved note.
- `grep -n "switchTo\|_syncNote\|_switchRefusal" js/components/options-page.js` gives no output.
- The suite is green.

---

### Task 9: The wizard's finishing order, pure

**Files:**
- Create: `js/components/sync-onboarding-flow.js`
- Test: `tests/sync-onboarding-flow.test.mjs`

**Interfaces:**
- Produces:
  - `createGeneration() → { next(): number, isCurrent(t: number): boolean }`.
  - `sameSetup(a: euSync, b: euSync) → boolean`. Compares `enabled`, `secret` and `consent`.
  - `finishOnboarding({ opened, reread, writeSync, patch, area, switchToLocal, rollback, writeBase }) → Promise<{ ok: true } | { ok: false, reason: 'other-tab'|'write'|'switch', rolledBack?: boolean }>`.
    - `opened` is `{ euSync }` as read when the wizard opened.
    - `reread()` resolves to `{ euSync }`.
    - `writeSync(patch)` writes it.
    - `area()` returns `'sync'|'local'`.
    - `switchToLocal()` performs the switch; its outcome is judged by `area()`.
    - `rollback(euSync)` writes it back.
    - `writeBase` is a function or `null`.

- [ ] **Step 1: Failing tests** `tests/sync-onboarding-flow.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { createGeneration, sameSetup, finishOnboarding } from '../js/components/sync-onboarding-flow.js';

const OFF = { enabled: false, consent: null, secret: '', states: {}, activeState: '' };
const PATCH = { enabled: true, consent: { version: 2, date: 'd' }, secret: 'GS1-NEW' };

// A recorder for the steps, as tests/settings-merge.test.mjs does for commitOrder.
function harness({ now = OFF, area = 'sync', landed = 'local', failWrite = false, failRollback = false, failBase = false, base = true } = {}) {
	const log = [];
	let current = area;
	const steps = {
		opened: { euSync: OFF },
		reread: async () => { log.push('reread'); return { euSync: now }; },
		writeSync: async (p) => { log.push(['write', p]); if (failWrite) throw new Error('w'); },
		patch: PATCH,
		area: () => current,
		switchToLocal: async () => { log.push('switch'); current = landed; },
		rollback: async (prev) => { log.push(['rollback', prev]); if (failRollback) throw new Error('r'); },
		writeBase: base ? async () => { log.push('base'); if (failBase) throw new Error('b'); } : null,
	};
	return { steps, log };
}

describe('finishOnboarding (spec §6)', () => {
	it('re-read, one write, switch, base - in that order', async () => {
		const { steps, log } = harness();
		expect(await finishOnboarding(steps)).toEqual({ ok: true });
		expect(log).toEqual(['reread', ['write', PATCH], 'switch', 'base']);
	});
	it('skips the switch when the area is already local', async () => {
		const { steps, log } = harness({ area: 'local' });
		expect(await finishOnboarding(steps)).toEqual({ ok: true });
		expect(log).toEqual(['reread', ['write', PATCH], 'base']);
	});
	it('another tab set sync up meanwhile: stops before writing anything', async () => {
		const { steps, log } = harness({ now: { ...OFF, enabled: true, secret: 'GS1-OTHER', consent: { version: 2, date: 'x' } } });
		expect(await finishOnboarding(steps)).toEqual({ ok: false, reason: 'other-tab' });
		expect(log).toEqual(['reread']);
	});
	it('another tab only changed the code: stops as well', async () => {
		const { steps } = harness({ now: { ...OFF, secret: 'GS1-OTHER' } });
		expect((await finishOnboarding(steps)).reason).toBe('other-tab');
	});
	it('the euSync write fails: nothing else happens', async () => {
		const { steps, log } = harness({ failWrite: true });
		expect(await finishOnboarding(steps)).toEqual({ ok: false, reason: 'write' });
		expect(log).toEqual(['reread', ['write', PATCH]]);
	});
	it('the switch does not land: rolls euSync back to what was opened, no base', async () => {
		const { steps, log } = harness({ landed: 'sync' });
		expect(await finishOnboarding(steps)).toEqual({ ok: false, reason: 'switch', rolledBack: true });
		expect(log).toEqual(['reread', ['write', PATCH], 'switch', ['rollback', OFF]]);
	});
	it('the switch throws but the area moved: counts as landed', async () => {
		const { steps, log } = harness();
		steps.switchToLocal = async () => { log.push('switch'); steps.area = () => 'local'; throw new Error('noted:false'); };
		expect(await finishOnboarding(steps)).toEqual({ ok: true });
	});
	it('the rollback fails too: reports it, so the repair line can take over', async () => {
		const { steps } = harness({ landed: 'sync', failRollback: true });
		expect(await finishOnboarding(steps)).toEqual({ ok: false, reason: 'switch', rolledBack: false });
	});
	it('a failed base write is harmless', async () => {
		const { steps } = harness({ failBase: true });
		expect(await finishOnboarding(steps)).toEqual({ ok: true });
	});
	it('Way B has no base to write', async () => {
		const { steps, log } = harness({ base: false });
		expect(await finishOnboarding(steps)).toEqual({ ok: true });
		expect(log).toEqual(['reread', ['write', PATCH], 'switch']);
	});
	it('the kept-code path (stale consent, browser sync on) switches and keeps the map', async () => {
		const kept = { enabled: true, consent: { version: 1, date: 'old' }, secret: 'GS1-KEPT', states: { a: {} }, activeState: 'a' };
		const { steps, log } = harness();
		steps.opened = { euSync: kept };
		steps.reread = async () => { log.push('reread'); return { euSync: kept }; };
		steps.patch = { enabled: true, consent: { version: 2, date: 'd' } };
		steps.writeBase = null;
		expect(await finishOnboarding(steps)).toEqual({ ok: true });
		expect(log).toEqual(['reread', ['write', { enabled: true, consent: { version: 2, date: 'd' } }], 'switch']);
	});
});

describe('createGeneration', () => {
	it('an answer whose token is no longer current is dropped', () => {
		const g = createGeneration();
		const t1 = g.next();
		expect(g.isCurrent(t1)).toBe(true);
		const t2 = g.next();            // cancelled / restarted / closed
		expect(g.isCurrent(t1)).toBe(false);
		expect(g.isCurrent(t2)).toBe(true);
	});
});

describe('sameSetup', () => {
	it('compares switch, code and consent - not the profile map', () => {
		expect(sameSetup(OFF, { ...OFF, states: { x: {} } })).toBe(true);
		expect(sameSetup(OFF, { ...OFF, enabled: true })).toBe(false);
		expect(sameSetup(OFF, { ...OFF, consent: { version: 2, date: 'x' } })).toBe(false);
	});
});
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement** `js/components/sync-onboarding-flow.js`:

```js
// The onboarding wizard's decisions, without a DOM (design §6) - the way
// commitOrder in js/settings-merge.js keeps the merge's write order testable.
// No Lit import.

// Every request the wizard makes carries the token of its attempt; an answer
// that comes back after a cancel, a restart or a close is dropped.
export function createGeneration() {
	let current = 0;
	return {
		next: () => ++current,
		isCurrent: (t) => t === current,
	};
}

// What another tab could have changed under an open wizard. The profile map is
// not part of it: listing prunes it, and that is no setup.
export function sameSetup(a, b) {
	return a.enabled === b.enabled
		&& a.secret === b.secret
		&& JSON.stringify(a.consent) === JSON.stringify(b.consent);
}

// Finishing, in exactly this order:
// 1. Re-read: if another tab set sync up or changed the code since the wizard
//    opened, stop and store nothing.
// 2. ONE write of euSync. It is the commit point, and from it on toSync()
//    refuses - so the race of §3 cannot start a switch back to browser sync.
// 3. The area to local, judged by area() - never by the switch's own answer:
//    a failed second copy can still leave the browser switched. Not landed:
//    roll euSync back to what was read at the start.
// 4. The base. A failed base write means "no base", which only delays Sync.
export async function finishOnboarding(steps) {
	const { opened, reread, writeSync, patch, switchToLocal, rollback, writeBase } = steps;
	const now = await reread();
	if (!sameSetup(opened.euSync, now.euSync)) return { ok: false, reason: 'other-tab' };
	try {
		await writeSync(patch);
	} catch {
		return { ok: false, reason: 'write' };
	}
	// steps.area() each time, not a destructured copy: where the browser is
	// after the switch is the one question that decides.
	if (steps.area() === 'sync') {
		try { await switchToLocal(); } catch { /* judged below */ }
		if (steps.area() !== 'local') {
			try {
				await rollback(opened.euSync);
			} catch {
				return { ok: false, reason: 'switch', rolledBack: false };
			}
			return { ok: false, reason: 'switch', rolledBack: true };
		}
	}
	if (writeBase) {
		try { await writeBase(); } catch { /* "no base" - Sync after the next activate */ }
	}
	return { ok: true };
}
```

- [ ] **Step 3: Run** → PASS. `npm test` → all pass.

- [ ] **Step 4: Commit.**

```bash
git add js/components/sync-onboarding-flow.js tests/sync-onboarding-flow.test.mjs
git commit -m "feat(sync): onboarding finishing order with rollback and the other-tab abort"
```

**Acceptance:**
- Every failure point of §6 has a passing test with its log:
  - other tab;
  - write;
  - switch not landed, with or without rollback;
  - base.
- So do the generation token and the kept-code path.

---

### Task 10: The wizard: consent, choice, Way A, Way B

**Files:**
- Create: `js/components/sync-code-input.js` (+ `tests/sync-code-input.test.mjs`)
- Create: `js/components/sync-onboarding-dialog.js`
- Modify: `js/components/eu-sync-panel.js`
- Modify: `_locales/en|de/messages.json`, `tests/site-menu-locales.test.mjs`

**Interfaces:**
- Consumes: `createGeneration`, `finishOnboarding` (Task 9); `syncErrorText` (Task 3); `switchArea` (Task 5); `GesturaSync.listStates/uploadState/deleteStates` (existing); `GesturaSyncCode.generateSecret/encode/parse`; `GesturaSyncCrypto.newStateId`; `GesturaSettingsSchema.validatedExport/hashOf`; `GesturaSyncBase.write`.
- Produces:
  - From `sync-code-input.js`:
    - `CODE_ERRORS`, moved from the panel;
    - `checkDraft(value) → Promise<{ valid: boolean, error: string /* i18n key or '' */ }>`;
    - `maskCode(code)`, moved from the panel's `#maskedCode`;
    - `saveCodeFile(i18n, code)`, moved from the panel's `#saveCode`.
  - The `<sync-onboarding-dialog>` element:
    - properties `open: Boolean`, `start: 'choice'|'existing'`;
    - events `onboarding-done` (`detail: { way: 'new'|'existing'|'kept' }`) and `onboarding-cancel`.

Three commits: a refactor (helpers move), the wizard, and the panel switching over to it.

- [ ] **Step 1: Failing test** `tests/sync-code-input.test.mjs`:

```js
import { describe, it, expect, beforeAll } from 'vitest';

let checkDraft, maskCode, C;
beforeAll(async () => {
	// sync-code-input.js reads window.GesturaSyncCode, as the pages provide it.
	globalThis.window = globalThis;
	globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } } };
	await import('../js/eu-integration.js');
	await import('../js/eu-sync-code.js');
	C = globalThis.GesturaSyncCode;
	({ checkDraft, maskCode } = await import('../js/components/sync-code-input.js'));
});

const CODE = 'GS1-000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFG-CC6W';

describe('checkDraft (strict validation, as in the panel)', () => {
	it('a valid code is valid, no error', async () => {
		expect(await checkDraft(CODE)).toEqual({ valid: true, error: '' });
	});
	it('a short prefix-only draft is invalid but says nothing yet', async () => {
		expect(await checkDraft('GS')).toEqual({ valid: false, error: '' });
	});
	it('a wrong character is said at once', async () => {
		expect((await checkDraft('GS1-!')).error).toBe('euSyncCodeErrorCharset');
	});
	it('a checksum typo is said once the code is complete', async () => {
		const typo = CODE.slice(0, -1) + (CODE.endsWith('W') ? 'X' : 'W');
		const r = await checkDraft(typo);
		expect(r.valid).toBe(false);
		expect(['euSyncCodeErrorChecksum', 'euSyncCodeErrorPadding']).toContain(r.error);
	});
});

describe('maskCode', () => {
	it('keeps the first two groups and the last, dots the rest, same shape', () => {
		const m = maskCode(CODE);
		expect(m.startsWith('GS1-000G-')).toBe(true);
		expect(m.endsWith('-CC6W')).toBe(true);
		expect(m.length).toBe(CODE.length);
		expect(m).toContain('••••');
	});
});
```

Run → FAIL.

- [ ] **Step 2: Implement** `js/components/sync-code-input.js`. Move these from the panel, with their comments:
  - `CODE_ERRORS`;
  - the body of `#onCodeInput`'s judgement;
  - `#maskedCode`;
  - `#saveCode`.

```js
// The code field's rules and the code's shapes, shared by the sync panel and
// the onboarding wizard - one strict validation, one masking, one file.
// No Lit import.

export const CODE_ERRORS = {
	prefix: 'euSyncCodeErrorPrefix',
	charset: 'euSyncCodeErrorCharset',
	length: 'euSyncCodeErrorLength',
	padding: 'euSyncCodeErrorPadding',
	checksum: 'euSyncCodeErrorChecksum',
};

// Valid only for a code that parses - prefix, alphabet, length, checksum. A
// wrong character or prefix is said at once; a checksum typo only once the code
// is complete. "Too short" is never said while typing: the grey button says it.
export async function checkDraft(value) {
	const parsed = await window.GesturaSyncCode.parse(value);
	if (parsed.secret) return { valid: true, error: '' };
	const early = parsed.error === 'charset' || (parsed.error === 'prefix' && value.trim().length >= 3);
	const say = early || parsed.error === 'padding' || parsed.error === 'checksum';
	return { valid: false, error: say ? CODE_ERRORS[parsed.error] : '' };
}

// The first two groups and the last stay readable - enough to tell two codes
// apart - the rest is dots, group for group, so the shape does not change.
export function maskCode(code) {
	const parts = code.split('-');
	if (parts.length <= 3) return code;
	return parts.map((p, i) => (i < 2 || i === parts.length - 1) ? p : '•'.repeat(p.length)).join('-');
}

// A blob and an <a download> - no downloads permission. The header line says
// what the file is, a year from now.
export function saveCodeFile(i18n, code) {
	const header = i18n.getMessage('euSyncSecretFileHeader').replace('{date}', new Date().toISOString().slice(0, 10));
	const blob = new Blob([header + '\n\n' + code + '\n'], { type: 'text/plain' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = 'gestura-sync-secret.txt';
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 10000);
}
```

In the panel:
  - delete `static CODE_ERRORS`, `#maskedCode` and `#saveCode`'s body;
  - `#saveCode()` becomes `saveCodeFile(window.i18n, this.#state.secret)`;
  - `#maskedCode(x)` calls become `maskCode(x)`;
  - `#useCode` uses `CODE_ERRORS[parsed.error]`.
  - `#onCodeInput`:

```js
	async #onCodeInput(value) {
		this._codeDraft = value;
		this._codeValid = false;
		this._codeError = '';
		const r = await checkDraft(value);
		if (this._codeDraft !== value) return;
		this._codeValid = r.valid;
		this._codeError = r.error ? window.i18n.getMessage(r.error) : '';
	}
```

Run `npx vitest run tests/sync-code-input.test.mjs` → PASS; `npm test` → all pass. Browser: in the Settings tab, the code field still flags `GS1-!` at once and enables the button only for a valid code; the masked code looks the same.

```bash
git add js/components/sync-code-input.js tests/sync-code-input.test.mjs js/components/eu-sync-panel.js
git commit -m "refactor(sync): code-field rules, masking and the code file move into sync-code-input.js"
```

- [ ] **Step 3: Keys for the wizard** (en / de, all `PENDING_TRANSLATION`). The texts are from §11 where given.

| key | de | en |
|---|---|---|
| `euSyncWizardTitle` *(owner check)* | Abgleich über gestura.eu einrichten | Set up sync through gestura.eu |
| `euSyncWizardBack` | Zurück | Back |
| `euSyncWizardClose` | Schließen | Close |
| `euSyncWizardBrowserSyncBox` | Dein Browser-Sync ist aktiv. gestura.eu löst ihn ab – deine Einstellungen werden danach nicht mehr über das Browser-Konto abgeglichen. | Your browser sync is on. gestura.eu replaces it – your settings are no longer synced through your browser account afterwards. |
| `euSyncWizardNewTitle` | Ich habe noch keinen Code | I don't have a code yet |
| `euSyncWizardNewDesc` | neuen Abgleich-Code erstellen | create a new sync code |
| `euSyncWizardExistingTitle` | Ich habe bereits einen Code | I already have a code |
| `euSyncWizardExistingDesc` | Profile aus einem anderen Browser laden | load profiles from another browser |
| `euSyncWizardSaveHint` | Sichere diesen Code (z. B. im Passwortmanager). Nur mit ihm hast du in anderen Browsern Zugriff auf deine Profile. | Save this code (e.g. in your password manager). Only with it can you reach your profiles from other browsers. |
| `euSyncWizardNamePlaceholder` | z. B. Büro | e.g. Office |
| `euSyncWizardNameLabel` *(owner check)* | Name des Profils | Profile name |
| `euSyncWizardUploadFirst` | Erstes Profil hochladen | Upload your first profile |
| `euSyncWizardExistingEmpty` | Unter diesem Code ist noch nichts gespeichert. Lade hier dein erstes Profil hoch. | Nothing is saved under this code yet. Upload your first profile here. |
| `euSyncWizardOtherTab` | Der Abgleich wurde inzwischen in einem anderen Tab eingerichtet. | Sync was set up in another tab in the meantime. |
| `euSyncWizardSaveFailed` *(owner check)* | Die Einrichtung konnte in diesem Browser nicht gespeichert werden. | The setup could not be saved in this browser. |
| `euSyncAfterWayB` | Wähle ein Profil aus, um es zu aktivieren – oder sichere deine aktuellen Einstellungen vorab als neues Profil. | Pick a profile to activate it – or first save your current settings as a new profile. |

The existing keys `euSyncConsentTitle`, the consent lead and points, `euSyncConsentCancel`, `tutorialContinue` ("Weiter"), `euSyncSecretCopy`/`Copied`/`Save`, `euSyncSecretPair`, `euSyncSecretPairApply`, `euSyncConnecting` and `euSyncRetry` are reused.

- [ ] **Step 4: The wizard component** `js/components/sync-onboarding-dialog.js`:

```js
import { LitElement, html, css, unsafeHTML } from '../../js/lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { icons } from '../icons.js';
import { settingsStore } from '../settings-store.js';
import { settingsErrorMessage } from './settings-preview-dialog.js';
import { syncErrorText } from './sync-reach.js';
import { checkDraft, maskCode, saveCodeFile } from './sync-code-input.js';
import { createGeneration, finishOnboarding } from './sync-onboarding-flow.js';
import { switchArea } from './storage-area-switch.js';

// Turning on sync through gestura.eu, as a guided dialog (onboarding design §6).
// Nothing is stored until it is done: code and consent live here. Cancel at any
// step leaves sync off and the storage area where it was; a profile uploaded
// on the way is deleted again.
//
// The calls in between do not go through gated() - it knows of no sync yet.
// The wizard has its own gate: a generation token per attempt, the server from
// syncOrigin() per request, and a re-read of euSync before finishing.
class SyncOnboardingDialog extends LitElement {
	static properties = {
		open: { type: Boolean },
		start: { type: String },      // 'choice' | 'existing' - where "Weiter" leads
		_step: { state: true },       // 'consent' | 'choice' | 'new' | 'existing'
		_code: { state: true },       // Way A's code, in clear
		_draft: { state: true },
		_draftValid: { state: true },
		_draftError: { state: true },
		_empty: { state: true },      // Way B found nothing readable: the name field follows
		_name: { state: true },
		_busy: { state: true },
		_error: { state: true },
		_retry: { state: true },
		_stopped: { state: true },    // the other-tab abort: only Close is left
		_preview: { state: true },
		_copied: { state: true },
		_opened: { state: true },
	};

	static styles = [commonStyles, optionStyles, css`
		:host { display: contents; }
		.modal-overlay { position: fixed; inset: 0; z-index: 10000; background: rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center; }
		.modal-panel { width: min(620px, 92vw); max-height: 88vh; display: flex; flex-direction: column; background: var(--card-bg); border-radius: 14px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--border-color); }
		.modal-panel:focus { outline: none; }
		.modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border-color); }
		.modal-header h3 { margin: 0; font-size: 17px; font-weight: 600; }
		.modal-body { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px; overflow-y: auto; }
		.modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--border-color); }
		.modal-footer .spacer { flex: 1 1 auto; }
		.lead { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.55; }
		ul { margin: 0; padding-inline-start: 20px; }
		li { margin: 8px 0; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
		li strong { color: var(--text-primary); }
		.box-warn { padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5; background: color-mix(in srgb, var(--warning-color) 10%, var(--card-bg)); border: 1px solid color-mix(in srgb, var(--warning-color) 35%, transparent); }
		.ways { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
		.way { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; text-align: start; border-radius: 12px; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-primary); font: inherit; cursor: pointer; }
		.way:hover { border-color: var(--accent-color); }
		.way:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
		.way strong { font-size: 14px; }
		.way span { font-size: 13px; color: var(--text-secondary); }
		.code-line { display: flex; align-items: center; gap: 4px; padding: 4px 4px 4px 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-tertiary); }
		.code-text { flex: 1; min-width: 0; padding: 6px 4px; font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace; font-size: 13px; letter-spacing: .06em; word-break: break-all; user-select: all; }
		.icon-btn { width: 32px; height: 32px; display: grid; place-items: center; padding: 0; border-radius: 6px; border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; }
		.icon-btn svg { width: 18px; height: 18px; }
		.icon-btn:hover { color: var(--text-primary); background: color-mix(in srgb, var(--text-primary) 8%, transparent); }
		.hint { font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
		.field { height: 36px; box-sizing: border-box; min-width: 0; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--input-bg); color: var(--text-primary); font: inherit; font-size: 14px; }
		.field.mono { font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace; font-size: 13px; }
		.field.invalid { border-color: var(--danger-color); }
		.field-row { display: flex; flex-wrap: wrap; gap: 8px; }
		.field-row .field { flex: 999 1 200px; }
		.field-row .btn { flex: 1 0 auto; min-height: 36px; }
		.error { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--danger-color); font-size: 13px; }
		.connecting { font-size: 13px; color: var(--text-secondary); }
		.kept { font-size: 13px; }
		.kept code { font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace; }
		.hidden { display: none; }
	`];

	constructor() {
		super();
		this.open = false;
		this.start = 'choice';
		this._gen = createGeneration();
		this._t = 0;
		this.#reset();
		this._onKeydown = (e) => {
			// The hosted preview has its own Escape; this one only while it is closed.
			if (e.key === 'Escape' && this.open && !this._preview) { e.stopPropagation(); this.#cancel(); }
		};
	}

	// Everything a wizard session holds. Never stored.
	#reset() {
		this._step = 'consent';
		this._secret = null;     // Way A's raw secret, generated once per session
		this._code = '';
		this._stateId = '';      // generated once per session, reused by every retry
		this._draft = '';
		this._draftValid = false;
		this._draftError = '';
		this._entered = null;    // Way B's raw secret, once accepted
		this._empty = false;
		this._name = '';
		this._busy = false;
		this._error = '';
		this._retry = null;
		this._stopped = false;
		this._preview = null;
		this._copied = false;
		this._opened = null;     // { euSync, area } as read when the wizard opened
		this._inFlight = null;   // { secret, stateId, origin } of an upload not yet answered
		this._uploaded = null;   // { secret, stateId, origin, payloadHash, exportObj, name, date }
		this._finishing = false;
	}

	connectedCallback() { super.connectedCallback(); document.addEventListener('keydown', this._onKeydown, true); }
	disconnectedCallback() {
		super.disconnectedCallback();
		document.removeEventListener('keydown', this._onKeydown, true);
		if (this.open) this.#cancel();
	}

	#lockScroll(on) { document.documentElement.style.overflow = on ? 'hidden' : ''; }

	willUpdate(changed) {
		if (changed.has('open') && this.open) this.#begin();
	}

	updated(changed) {
		if (changed.has('_step') || (changed.has('open') && this.open)) {
			const root = this.renderRoot;
			(root.querySelector('.focus-first') || root.querySelector('.modal-panel'))?.focus();
		}
	}

	async #begin() {
		this.#reset();
		this._t = this._gen.next();
		this.#lockScroll(true);
		const t = this._t;
		const sync = await window.GesturaSyncLocal.read();
		if (!this._gen.isCurrent(t)) return;
		this._opened = { euSync: sync.euSync, area: window.GesturaSettingsStorage.area() };
	}

	// Cancel, Escape and the X: nothing stays behind (§6). Ignored while
	// finishing - past the euSync write there is nothing left to cancel.
	#cancel() {
		if (this._finishing) return;
		this._gen.next();
		const orphan = this._uploaded || this._inFlight;
		if (orphan) {
			// Best effort. If it fails, the profile sits under a code nobody stored
			// and goes with the 12-month retention.
			window.GesturaSync.deleteStates({ secret: orphan.secret, origin: orphan.origin, stateId: orphan.stateId, fetchImpl: (u, i) => fetch(u, i) }).catch(() => {});
		}
		this.#close('onboarding-cancel');
	}

	#close(type, detail) {
		this.open = false;
		this.#lockScroll(false);
		this.#reset();
		this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
	}

	// One request of this attempt. The answer is dropped when the attempt is no
	// longer current; an error is shown, never thrown.
	async #request(fn) {
		const t = this._t;
		this._busy = true;
		this._error = '';
		this._retry = null;
		try {
			const origin = window.GesturaSyncLocal.syncOrigin(await window.GesturaEuLocal.read());
			const result = await fn({ origin, fetchImpl: (u, i) => fetch(u, i) });
			return this._gen.isCurrent(t) ? { result, origin } : null;
		} catch (e) {
			if (this._gen.isCurrent(t)) this._error = syncErrorText(window.i18n, e);
			return null;
		} finally {
			if (this._gen.isCurrent(t)) this._busy = false;
		}
	}

	#next() { this._step = this.start === 'existing' ? 'existing' : 'choice'; }

	async #toNew() {
		if (!this._secret) {
			this._secret = window.GesturaSyncCode.generateSecret();
			this._code = await window.GesturaSyncCode.encode(this._secret);
		}
		if (!this._stateId) this._stateId = window.GesturaSyncCrypto.newStateId();
		this._step = 'new';
	}

	#back() {
		this._error = '';
		this._retry = null;
		if (this._step === 'new' || this._step === 'existing') { this._step = 'choice'; this._empty = false; this._entered = null; return; }
		this._step = 'consent';
	}

	async #onDraft(value) {
		this._draft = value;
		this._draftValid = false;
		this._draftError = '';
		const r = await checkDraft(value);
		if (this._draft !== value) return;
		this._draftValid = r.valid;
		this._draftError = r.error ? window.i18n.getMessage(r.error) : '';
	}

	// Way B: done as soon as the code holds at least one READABLE profile.
	async #useExisting() {
		const parsed = await window.GesturaSyncCode.parse(this._draft);
		if (!parsed.secret) return;
		const got = await this.#request(ctx => window.GesturaSync.listStates({ ...ctx, secret: parsed.secret }));
		if (!got) { this._retry = () => this.#useExisting(); return; }
		if (got.result.some(s => !s.broken)) {
			await this.#finish({ secret: parsed.secret, way: 'existing' });
			return;
		}
		this._entered = parsed.secret;
		this._empty = true;
		if (!this._stateId) this._stateId = window.GesturaSyncCrypto.newStateId();
	}

	// Way A, and Way B under an empty code: the usual preview, hosted here.
	#openPreview() {
		const r = window.GesturaSettingsSchema.validatedExport(settingsStore.current, window.i18n.version, { forSync: true });
		if (!r.ok) { this._error = settingsErrorMessage(window.i18n, r.error); return; }
		this._preview = r;
	}

	#onPreviewCancel() {
		this._preview = null;
		// The preview released the scroll lock when it closed; the wizard is still open.
		this.#lockScroll(true);
	}

	async #onPreviewConfirm() {
		const r = this._preview;
		this._preview = null;
		this.#lockScroll(true);
		if (r) await this.#upload(r.exportObj);
	}

	async #upload(exportObj) {
		const secret = this._entered || this._secret;
		const name = this._name.trim();
		if (!this._uploaded) {
			const got = await this.#request(async ctx => {
				this._inFlight = { secret, stateId: this._stateId, origin: ctx.origin };
				// No basePayloadHash: a PUT without one replaces, so a retry after a
				// timeout that did reach the server writes the same profile again
				// instead of a second one (§6).
				return window.GesturaSync.uploadState({
					...ctx, secret, stateId: this._stateId, name, createdAt: '',
					exportObj, extVersion: window.i18n.version, basePayloadHash: null,
				});
			});
			if (!got) { this._retry = () => this.#upload(exportObj); return; }
			this._inFlight = null;
			this._uploaded = { secret, stateId: this._stateId, origin: got.origin, payloadHash: got.result.payloadHash, exportObj, name, date: new Date().toISOString() };
		}
		await this.#finish({ secret, way: this._entered ? 'existing' : 'new' });
	}

	// Done. The order and its failures live in finishOnboarding().
	async #finish({ secret, encoded, way }) {
		const L = window.GesturaSyncLocal;
		const S = window.GesturaSettingsStorage;
		const code = encoded || await window.GesturaSyncCode.encode(secret);
		const opened = this._opened.euSync;
		const patch = { enabled: true, consent: { version: L.CURRENT_SYNC_CONSENT, date: new Date().toISOString() }, secret: code };
		const u = this._uploaded;
		if (u) {
			patch.states = { [u.stateId]: { name: u.name, lastUploadHash: await window.GesturaSettingsSchema.hashOf(u.exportObj), lastUploadDate: u.date } };
			patch.activeState = u.stateId;
		} else if (code !== opened.secret) {
			// A different code: the map belongs to the old one and goes with it.
			patch.states = {};
			patch.activeState = '';
		}
		this._finishing = true;
		this._busy = true;
		this._error = '';
		let res;
		try {
			res = await finishOnboarding({
				opened: this._opened,
				reread: () => L.read(),
				writeSync: (p) => L.write(p),
				patch,
				area: () => S.area(),
				switchToLocal: () => switchArea(S, 'local', 'gestura.eu'),
				rollback: (prev) => L.write(prev),
				writeBase: u ? () => window.GesturaSyncBase.write(u.stateId, { hash: u.payloadHash, payload: u.exportObj, date: u.date }) : null,
			});
		} finally {
			this._finishing = false;
			this._busy = false;
		}
		const i18n = window.i18n;
		if (res.ok || (res.reason === 'switch' && !res.rolledBack)) {
			// Done - or stuck at (sync, enabled): the setup exists, and the panel's
			// repair line takes over from here.
			this._uploaded = null;
			this.#close('onboarding-done', { way });
			return;
		}
		if (res.reason === 'other-tab') {
			this._error = i18n.getMessage('euSyncWizardOtherTab');
			this._stopped = true;
			if (u) window.GesturaSync.deleteStates({ secret: u.secret, origin: u.origin, stateId: u.stateId, fetchImpl: (a, b) => fetch(a, b) }).catch(() => {});
			this._uploaded = null;
			return;
		}
		this._error = i18n.getMessage(res.reason === 'write' ? 'euSyncWizardSaveFailed' : 'storageSwitchFailed');
		this._retry = () => this.#finish({ secret, encoded, way });
	}

	async #copy() {
		try {
			await navigator.clipboard.writeText(this._code);
			this._copied = true;
			setTimeout(() => { this._copied = false; }, 2000);
		} catch {
			this._error = window.i18n.getMessage('euSyncSecretCopyFailed');
		}
	}

	#renderConsent(i18n) {
		const points = [1, 2, 3, 4, 5].map(n => [`euSyncConsentPoint${n}Label`, `euSyncConsentPoint${n}`]);
		return html`
			${this._opened && this._opened.area === 'sync' ? html`<div class="box-warn">${i18n.getMessage('euSyncWizardBrowserSyncBox')}</div>` : ''}
			<p class="lead">${i18n.getMessage('euSyncConsentLead')}</p>
			<ul>${points.map(([label, body]) => html`<li><strong>${i18n.getMessage(label)}</strong> ${i18n.getMessage(body)}</li>`)}</ul>`;
	}

	#renderChoice(i18n) {
		return html`
			<div class="ways">
				<button type="button" class="way focus-first" @click=${() => this.#toNew()}>
					<strong>${i18n.getMessage('euSyncWizardNewTitle')}</strong><span>${i18n.getMessage('euSyncWizardNewDesc')}</span>
				</button>
				<button type="button" class="way" @click=${() => { this._step = 'existing'; }}>
					<strong>${i18n.getMessage('euSyncWizardExistingTitle')}</strong><span>${i18n.getMessage('euSyncWizardExistingDesc')}</span>
				</button>
			</div>`;
	}

	#renderName(i18n) {
		const name = this._name.trim();
		const go = () => { if (name && !this._busy) this.#openPreview(); };
		return html`
			<div class="field-row">
				<input type="text" class="field focus-first" placeholder=${i18n.getMessage('euSyncWizardNamePlaceholder')}
					aria-label=${i18n.getMessage('euSyncWizardNameLabel')} .value=${this._name}
					@input=${e => { this._name = e.target.value; }}
					@keydown=${e => { if (e.key === 'Enter') go(); }}>
				<button class="btn btn-primary" ?disabled=${this._busy || !name} @click=${go}>${i18n.getMessage('euSyncWizardUploadFirst')}</button>
			</div>`;
	}

	#renderNew(i18n) {
		const copyLabel = i18n.getMessage(this._copied ? 'euSyncSecretCopied' : 'euSyncSecretCopy');
		return html`
			<div class="code-line">
				<code class="code-text">${this._code}</code>
				<button type="button" class="icon-btn" title=${copyLabel} aria-label=${copyLabel} @click=${() => this.#copy()}>${unsafeHTML(this._copied ? icons.check : icons.copy)}</button>
				<button type="button" class="icon-btn" title=${i18n.getMessage('euSyncSecretSave')} aria-label=${i18n.getMessage('euSyncSecretSave')}
					@click=${() => saveCodeFile(i18n, this._code)}>${unsafeHTML(icons.fileDown)}</button>
			</div>
			<div class="hint">${i18n.getMessage('euSyncWizardSaveHint')}</div>
			${this.#renderName(i18n)}`;
	}

	#renderExisting(i18n) {
		const apply = () => { if (this._draftValid && !this._busy) this.#useExisting(); };
		return html`
			<div class="field-row">
				<input type="text" class="field mono focus-first ${this._draftError ? 'invalid' : ''}" placeholder="GS1-…"
					aria-label=${i18n.getMessage('euSyncSecretPair')} aria-invalid=${this._draftError ? 'true' : 'false'}
					spellcheck="false" autocomplete="off" ?disabled=${this._empty}
					.value=${this._draft} @input=${e => this.#onDraft(e.target.value)}
					@keydown=${e => { if (e.key === 'Enter') apply(); }}>
				${this._empty ? '' : html`<button class="btn btn-primary" ?disabled=${this._busy || !this._draftValid} @click=${apply}>${i18n.getMessage('euSyncSecretPairApply')}</button>`}
			</div>
			${this._draftError ? html`<div class="error" role="alert">${this._draftError}</div>` : ''}
			${this._empty ? html`<div class="hint">${i18n.getMessage('euSyncWizardExistingEmpty')}</div>${this.#renderName(i18n)}` : ''}`;
	}

	render() {
		if (!this.open) return html``;
		const i18n = window.i18n;
		const step = this._step;
		const body = this._stopped ? ''
			: step === 'consent' ? this.#renderConsent(i18n)
			: step === 'choice' ? this.#renderChoice(i18n)
			: step === 'new' ? this.#renderNew(i18n)
			: this.#renderExisting(i18n);
		return html`
			<div class="modal-overlay ${this._preview ? 'hidden' : ''}" @mousedown=${() => this.#cancel()}>
				<div class="modal-panel" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="wizTitle" @mousedown=${e => e.stopPropagation()}>
					<div class="modal-header">
						<h3 id="wizTitle">${i18n.getMessage('euSyncWizardTitle')}</h3>
						<button type="button" class="modal-close" @click=${() => this.#cancel()} aria-label=${i18n.getMessage('euSyncConsentCancel')}>${unsafeHTML(icons.x)}</button>
					</div>
					<div class="modal-body">
						${body}
						<div class="connecting" role="status">${this._busy ? i18n.getMessage('euSyncConnecting') : ''}</div>
						${this._error ? html`
							<div class="error" role="alert">
								<span>${this._error}</span>
								${this._retry && !this._stopped ? html`<button type="button" class="btn btn-secondary" ?disabled=${this._busy} @click=${() => this._retry()}>${i18n.getMessage('euSyncRetry')}</button>` : ''}
							</div>` : ''}
					</div>
					<div class="modal-footer">
						${this._stopped ? html`<button class="btn btn-primary focus-first" @click=${() => this.#close('onboarding-cancel')}>${i18n.getMessage('euSyncWizardClose')}</button>` : html`
							${step !== 'consent' ? html`<button class="btn btn-secondary" ?disabled=${this._busy || !!this._uploaded} @click=${() => this.#back()}>${i18n.getMessage('euSyncWizardBack')}</button>` : ''}
							<span class="spacer"></span>
							<button class="btn btn-secondary" ?disabled=${this._finishing} @click=${() => this.#cancel()}>${i18n.getMessage('euSyncConsentCancel')}</button>
							${step === 'consent' ? html`<button class="btn btn-primary" ?disabled=${!this._opened} @click=${() => this.#next()}>${i18n.getMessage('tutorialContinue')}</button>` : ''}`}
					</div>
				</div>
			</div>
			<settings-preview-dialog
				?open=${!!this._preview}
				mode="upload"
				.json=${this._preview ? this._preview.json : ''}
				.dropped=${this._preview ? this._preview.dropped : []}
				.retyped=${this._preview ? this._preview.retyped : []}
				@preview-confirm=${() => this.#onPreviewConfirm()}
				@preview-cancel=${() => this.#onPreviewCancel()}></settings-preview-dialog>`;
	}
}

customElements.define('sync-onboarding-dialog', SyncOnboardingDialog);
```

Note for the implementer: the closed wizard renders nothing, so the preview element only exists while the wizard is open. That is intended: one modal at a time, one scroll lock, one Escape handler (§6).

Run `npm test` → green. The module-syntax test parses the new file.

```bash
git add js/components/sync-onboarding-dialog.js _locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs
git commit -m "feat(sync): onboarding wizard - consent, choice, new code, existing code"
```

- [ ] **Step 5: The panel hosts the wizard instead of the old consent dialog.** In `eu-sync-panel.js`:
  - `import './sync-onboarding-dialog.js';`
  - Add properties `_wizard` and `_wizardStart` to the state, and `_landingHint` as well.
  - In the constructor: `this._wizard = false; this._wizardStart = 'choice'; this._landingHint = false;`.
  - Delete `_consentOpen`, `#open`, `#decline`, `#accept`, `#renderOverlay`, the Escape branch for `_consentOpen`, and `this._consentOpen ? this.#renderOverlay() : ''` in `render()`. Grep for every name until there are no hits.
  - In `#startOnboarding`, the line `this.#open();` becomes:

```js
		this._wizardStart = opts.start === 'existing' ? 'existing' : 'choice';
		this._wizard = true;
```

  - Render the wizard last in `render()`, outside the `#effective` condition:

```js
			<sync-onboarding-dialog ?open=${this._wizard} .start=${this._wizardStart}
				@onboarding-done=${this.#onOnboarded}
				@onboarding-cancel=${() => { this._wizard = false; }}></sync-onboarding-dialog>
```

  - Handlers:

```js
	// Both ways land on "Deine Profile" (§6). After Way B the hint says what
	// the user may do next - activating is not required.
	#onOnboarded(e) {
		this._wizard = false;
		this._tab = 'states';
		this._landingHint = e.detail && e.detail.way === 'existing';
	}
```

  - In `#renderStates`, directly under the head:

```js
				${this._landingHint ? html`<div class="msg info" role="status">${unsafeHTML(icons.info)}<span>${i18n.getMessage('euSyncAfterWayB')}</span></div>` : ''}
```

  - Clear it when the user acts or leaves. `#exclusive` sets `this._landingHint = false;` as its first line, and the tab click handler does the same.
  - The stale row's "Weiter" button (`tutorialContinue`) calls `() => this.#exclusive(() => this.#startOnboarding())` instead of `#open`.

Run `npm test` → green.

- [ ] **Step 6: Browser checks** (the mock running, from "Über deinen Browser"):

| # | Action | Expected |
|---|---|---|
| 1 | Activate gestura.eu | Ping, then the wizard at step 1 with the yellow browser-sync box; nothing in `euSync` changed (`enabled` false) |
| 2 | From "Nur in diesem Browser" | Same, **without** the yellow box |
| 3 | Weiter → "Ich habe noch keinen Code" | Code in clear text; Back → choice → again: **the same code** |
| 4 | Upload button with an empty name | Disabled; with "Büro" enabled |
| 5 | Upload → preview opens, wizard hidden; Cancel in the preview | Back on step 3, wizard visible, page still scroll-locked; mock log: no PUT |
| 6 | Upload → confirm | One PUT; wizard closes; `euSync` = enabled, consent v1 (v2 after Task 16), the shown code, `states` holds the id with name "Büro" and `lastUploadHash`, `activeState` = that id; `area` = `local`; base exists for the id; tab "Deine Profile" lists "Büro" as active |
| 7 | Fresh profile, mock `delayMs: 3000`, upload → while "Verbinde …" shows, press Cancel | Wizard closes; `euSync` untouched; mock log: PUT then POST `/delete` with that stateId |
| 8 | Mock `forceStatus: 500` on upload, then "Erneut versuchen" after resetting | First: error + retry, nothing stored; retry: one more PUT **with the same stateId**; done |
| 9 | Way B with a code holding one readable profile (made in step 6, in a second profile dir or after "Alles löschen" here) | Done; lands on "Deine Profile" with the after-Way-B hint; `states` = `{}`, `activeState` = '' |
| 10 | Way B with an empty code | "Unter diesem Code ist noch nichts gespeichert …" + name field; upload → done under **that** code |
| 11 | Way B with a code whose only profile is broken (encrypt meta with another key via CDP or the mock store) | Treated as empty (step 10 behaviour) |
| 12 | Cancel at each step (consent, choice, Way A before upload, Way B) | `euSync` unchanged, `area` unchanged, no request after the cancel |
| 13 | Escape while the preview is open | Closes only the preview; wizard stays |
| 14 | Two tabs: open the wizard in A, finish onboarding in B, then confirm the upload in A | A shows "Der Abgleich wurde inzwischen in einem anderen Tab eingerichtet." with only "Schließen"; `euSync` is B's; A's uploaded profile deleted (mock log) |
| 15 | Keyboard only: Tab through every step | Focus lands in the panel/first field each step; Enter in the name field opens the preview |

- [ ] **Step 7: Commit.**

```bash
git add js/components/eu-sync-panel.js
git commit -m "feat(sync): the panel opens the onboarding wizard instead of the consent dialog"
```

**Acceptance:**
- All 15 browser checks pass.
- `grep -n "_consentOpen\|#renderOverlay\|#accept" js/components/eu-sync-panel.js` gives no output.
- Nothing is written to `euSync` before done (checks 1, 5, 7, 12).
- The suite is green.

---

### Task 11: The wizard re-enables with a kept code, and on stale consent

**Files:** `js/components/sync-onboarding-dialog.js`, `_locales/en|de/messages.json`, `tests/site-menu-locales.test.mjs`

**Interfaces:**
- Consumes: `maskCode`, `finishOnboarding` (via `#finish`).
- Produces: `onboarding-done` with `way: 'kept'`.

- [ ] **Step 1: Keys** (`PENDING_TRANSLATION`):

| key | de | en |
|---|---|---|
| `euSyncWizardKeptCode` | Gespeicherter Code: {code} | Saved code: {code} |
| `euSyncWizardKeptContinue` | Mit diesem Code fortfahren | Continue with this code |
| `euSyncWizardKeptOther` | Anderen Code verwenden | Use a different code |

- [ ] **Step 2: Implement.** In the wizard:

```js
	// A code kept by "Nur ausschalten", or a stale consent (§6): the consent step
	// names it and offers to go on with it.
	get #kept() { return this._opened && this._opened.euSync.secret ? this._opened.euSync.secret : ''; }
```

In `#renderConsent`, after the list:

```js
			${this.#kept ? html`<div class="kept">${i18n.getMessage('euSyncWizardKeptCode').replace('{code}', '')}<code>${maskCode(this.#kept)}</code></div>` : ''}
```

In the footer, for `step === 'consent'` and `this.#kept`, replace the single "Weiter" button with two:

```js
							${step === 'consent' && this.#kept ? html`
								<button class="btn btn-secondary" ?disabled=${this._busy} @click=${() => this.#next()}>${i18n.getMessage('euSyncWizardKeptOther')}</button>
								<button class="btn btn-primary" ?disabled=${this._busy} @click=${() => this.#finish({ encoded: this.#kept, way: 'kept' })}>${i18n.getMessage('euSyncWizardKeptContinue')}</button>` : ''}
							${step === 'consent' && !this.#kept ? html`<button class="btn btn-primary" ?disabled=${!this._opened} @click=${() => this.#next()}>${i18n.getMessage('tutorialContinue')}</button>` : ''}
```

Replace the existing consent-step "Weiter" line with these two. The patch in `#finish` keeps `states` and `activeState` for the kept code, because `code === opened.secret`. Confirm by reading `#finish`: the `else if` only fires for a different code.

`{code}` is replaced with `''` and the masked code follows in a `<code>`. Check that the de and en strings end with `{code}` (they do), so the result reads "Gespeicherter Code: GS1-XXXX-…".

- [ ] **Step 3: Run** `npm test` → green.

- [ ] **Step 4: Browser checks:**

| # | Setup | Action | Expected |
|---|---|---|---|
| 1 | Onboarded (Task 10 step 6), then "Nur in diesem Browser" → "Nur ausschalten" | Activate gestura.eu | Step 1 shows "Gespeicherter Code: GS1-XXXX-YYYY-••••-…-ZZZZ" and the two buttons |
| 2 | as 1 | "Mit diesem Code fortfahren" | Done without a request besides the ping; `euSync` enabled, consent fresh, **same** secret, `states` and `activeState` unchanged; tab "Deine Profile" lists the profiles |
| 3 | as 1 | "Anderen Code verwenden" → choice → Way B with another code | `states` = `{}`, new secret |
| 4 | Write `euSync.consent.version = 0` (stale), `enabled` true, `area` = `sync` (CDP) | Stale row "Weiter" | Ping, wizard with yellow box + kept code; "Mit diesem Code fortfahren" → `area` = `local`, consent current, map kept |

- [ ] **Step 5: Commit.**

```bash
git add js/components/sync-onboarding-dialog.js _locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs
git commit -m "feat(sync): re-enabling offers the kept code, also on a stale consent"
```

**Acceptance:**
- The four browser checks pass.
- Re-enabling with the kept code makes no request except the ping, and keeps the profile map and `activeState`.

---

### Task 12: (reserved: merged into Task 8)

The gestura.eu → Browser path and the turn-off dialog sentence are part of Task 8, steps 4 and 8, checks 11–13. There is no separate commit.

---

### Task 13: The Settings tab: change-code card and delete-all card

**Files:**
- Modify: `js/components/sync-code-input.js` (+ `lockText`), `tests/sync-code-input.test.mjs`
- Modify: `js/components/eu-sync-panel.js` (`#renderSettings`, `#renderCodeSwitch`, state `_pairOpen` removed)
- Modify: `_locales/en|de/messages.json`, `tests/site-menu-locales.test.mjs`

**Interfaces:**
- Produces: `lockText(i18n, n: number) → { before: string, here: string, after: string }`. For n ≥ 1 it uses the singular or plural message and splits it at `{here}`.

- [ ] **Step 1: Keys.** New keys go into `PENDING_TRANSLATION`. Reworded keys are already pending. `euSyncCodeSwitchLocked` is **removed** from en, de and the list.

| key | de | en |
|---|---|---|
| `euSyncCodeSwitchDesc` (reworded) | Nutzt du gestura.eu bereits? Gib deinen Code aus dem anderen Browser ein, um dessen Profile hier zu laden. | Already using gestura.eu? Enter your code from the other browser to load its profiles here. |
| `euSyncCodeSwitchLockedOne` | Ein Wechsel entfernt {here} dein Profil, deine aktuellen Einstellungen bleiben erhalten. Sichere den aktuellen Code vorher. | A change removes your profile {here}; your current settings stay as they are. Save the current code first. |
| `euSyncCodeSwitchLockedMany` | Ein Wechsel entfernt {here} deine {n} Profile, deine aktuellen Einstellungen bleiben erhalten. Sichere den aktuellen Code vorher. | A change removes your {n} profiles {here}; your current settings stay as they are. Save the current code first. |
| `euSyncCodeSwitchHere` | hier | here |
| `euSyncCodeSwitchLockedUnknown` (reworded) *(owner check)* | Ein Wechsel kann {here} deine Profile entfernen, deine aktuellen Einstellungen bleiben erhalten. Sichere den aktuellen Code vorher. | A change can remove your profiles {here}; your current settings stay as they are. Save the current code first. |
| `euSyncCodeSwitchUnlock` (reworded) | Code trotzdem wechseln | Change the code anyway |
| `euSyncCodeLoadTitle` | Code laden | Load a code |
| `euSyncCodeNewDesc` | Startet ohne Profile. Deine bisherigen erreichst du weiter mit dem alten Code. | Starts without profiles. You can still reach your existing ones with the old code. |
| `euSyncCodeNewButton` *(owner check)* | Neuen Code erzeugen | Generate a new code |
| `euSyncDeleteAllDesc` | Löscht deine Profile auf gestura.eu – auch für deine anderen Browser mit diesem Code. Zum Ausschalten wähle oben einen anderen Weg. | Deletes your profiles on gestura.eu – also for your other browsers with this code. To turn sync off, choose another way above. |
| `euSyncDeleteAllEmpty` | Unter diesem Code ist nichts gespeichert. | Nothing is saved under this code. |
| `euSyncDeleteAllButton` *(owner check)* | Alles löschen | Delete everything |

- [ ] **Step 2: Failing test** (append to `tests/sync-code-input.test.mjs`):

```js
describe('lockText (spec §11 lock, singular/plural, bold "hier")', () => {
	let lockText;
	beforeAll(async () => { ({ lockText } = await import('../js/components/sync-code-input.js')); });
	const i18n = { getMessage: k => ({
		euSyncCodeSwitchLockedOne: 'Ein Wechsel entfernt {here} dein Profil, Rest.',
		euSyncCodeSwitchLockedMany: 'Ein Wechsel entfernt {here} deine {n} Profile, Rest.',
		euSyncCodeSwitchHere: 'hier',
	}[k]) };
	it('one profile', () => {
		expect(lockText(i18n, 1)).toEqual({ before: 'Ein Wechsel entfernt ', here: 'hier', after: ' dein Profil, Rest.' });
	});
	it('several profiles', () => {
		expect(lockText(i18n, 3)).toEqual({ before: 'Ein Wechsel entfernt ', here: 'hier', after: ' deine 3 Profile, Rest.' });
	});
});
```

Run → FAIL.

- [ ] **Step 3: Implement** in `sync-code-input.js`:

```js
// The lock's sentence with "hier" set apart, so the panel can make it bold: a
// change removes the profiles HERE - with no way back without the old code
// (design §2: never promise a way back that does not exist).
export function lockText(i18n, n, key) {
	const msg = key ? i18n.getMessage(key)
		: n === 1 ? i18n.getMessage('euSyncCodeSwitchLockedOne')
		: i18n.getMessage('euSyncCodeSwitchLockedMany').replace('{n}', String(n));
	const [before, after = ''] = msg.split('{here}');
	return { before, here: i18n.getMessage('euSyncCodeSwitchHere'), after };
}
```

The optional `key` is for the "unknown" sentence (`euSyncCodeSwitchLockedUnknown`), which carries `{here}` too.

- [ ] **Step 4: The panel.**
  - Delete `_pairOpen`, `#openPair` and the `_pairOpen` focus line in `updated()`. Rename `#closePair` to `#resetDraft`, with the same body minus `_pairOpen`. Update all callers.
  - In `updated()`: `if (changed.has('_switchUnlocked') && this._switchUnlocked) this.renderRoot.querySelector('.pair-field')?.focus();`.
  - Replace `#renderCodeSwitch`:

```js
	// Loading another code or making a new one (spec §7). With profiles under the
	// current code - or a list that could not be read, which may hide some - the
	// card is locked behind a warning that names what a change costs HERE; one
	// click opens both ways. With a known zero there is nothing to lose: the
	// sentence and the field, open.
	#renderCodeSwitch() {
		const i18n = window.i18n;
		const n = this._states ? this._states.length : null;
		const zero = n === 0;
		const locked = !zero && !this._switchUnlocked;
		const apply = () => { if (this._codeValid) this.#exclusive(() => this.#useCode()); };
		const cancel = () => { this.#resetDraft(); this._switchUnlocked = false; };
		const field = html`
			<div class="field-row">
				<input type="text" class="field mono pair-field ${this._codeError ? 'invalid' : ''}" placeholder="GS1-…"
					aria-label=${i18n.getMessage('euSyncCodeLoadTitle')} aria-invalid=${this._codeError ? 'true' : 'false'}
					spellcheck="false" autocomplete="off" .value=${this._codeDraft}
					@input=${e => this.#onCodeInput(e.target.value)}
					@keydown=${e => {
						if (e.key === 'Enter') apply();
						if (e.key === 'Escape' && !zero) { e.stopPropagation(); cancel(); }
					}}>
				<button class="btn btn-primary" ?disabled=${this._busy || !this._codeValid} @click=${apply}>${i18n.getMessage('euSyncSecretPairApply')}</button>
			</div>
			${this._codeError ? html`<div class="error" role="alert">${this._codeError}</div>` : ''}`;
		let lock = null;
		if (locked) {
			const t = n === null ? lockText(i18n, 0, 'euSyncCodeSwitchLockedUnknown') : lockText(i18n, n);
			lock = html`
				<div class="msg warn switch-lock" role="note">
					${unsafeHTML(icons.triangleAlert)}
					<span class="msg-text">${t.before}<strong>${t.here}</strong>${t.after}</span>
					<button type="button" class="btn btn-secondary" ?disabled=${this._busy}
						@click=${() => { this._switchUnlocked = true; }}>${i18n.getMessage('euSyncCodeSwitchUnlock')}</button>
				</div>`;
		}
		return html`
			<div class="sync-card">
				<div class="card-title">${i18n.getMessage('euSyncCodeSwitchTitle')}</div>
				${zero ? html`<div class="card-desc">${i18n.getMessage('euSyncCodeSwitchDesc')}</div>${field}` : ''}
				${lock || ''}
				${!zero && !locked ? html`
					<div class="pair-box">
						<div class="block-title">${i18n.getMessage('euSyncCodeLoadTitle')}</div>
						<div class="pair-desc">${i18n.getMessage('euSyncSecretPairDesc')}</div>
						${field}
					</div>
					<div class="pair-box">
						<div class="block-title">${i18n.getMessage('euSyncSecretNew')}</div>
						<div class="pair-desc">${i18n.getMessage('euSyncCodeNewDesc')}</div>
						<div><button type="button" class="btn btn-secondary" ?disabled=${this._busy}
							@click=${() => this.#exclusive(() => this.#newCode())}>${i18n.getMessage('euSyncCodeNewButton')}</button></div>
					</div>
					<div class="code-foot end"><button type="button" class="text-btn" @click=${cancel}>${i18n.getMessage('euSyncConsentCancel')}</button></div>` : ''}
			</div>`;
	}
```

  - CSS: `.block-title { font-size: 14px; font-weight: 600; }`.
  - `#renderSettings`: replace the `delete-all-row` block with `${this.#renderDeleteAll()}` and delete the `.delete-all-row` CSS:

```js
	// Last, always, in the danger style (spec §7). Turning sync off is the choice
	// at the top; this only deletes. Active while profiles are known or the list
	// is unknown - a request while unreachable fails cleanly with its message.
	#renderDeleteAll() {
		const i18n = window.i18n;
		const empty = !!this._states && this._states.length === 0;
		return html`
			<div class="sync-card danger-card">
				<div class="card-title">${i18n.getMessage('euSyncDeleteAll')}</div>
				<div class="card-desc">${i18n.getMessage(empty ? 'euSyncDeleteAllEmpty' : 'euSyncDeleteAllDesc')}</div>
				${empty ? '' : html`<div><button type="button" class="btn btn-danger-outline" ?disabled=${this._busy}
					@click=${() => this.#exclusive(() => this.#deleteAll())}>${unsafeHTML(icons.trash2)} ${i18n.getMessage('euSyncDeleteAllButton')}</button></div>`}
			</div>`;
	}
```

  - CSS: `.sync-card.danger-card { border-color: color-mix(in srgb, var(--danger-color) 40%, var(--border-color)); }`.
  - Import `lockText` alongside the Task-10 imports from `./sync-code-input.js`.
  - In `#useCode` and `#newCode`, `#closePair()` → `#resetDraft()`.
  - The tab handler and the code-change edge already reset `_switchUnlocked`. Check `willUpdate`: on a secret change add `this._switchUnlocked = false; this.#resetDraft();` inside the edge block, so a code change locks again (§7).

- [ ] **Step 5: Run.** `npx vitest run tests/sync-code-input.test.mjs` → PASS. `npm test` → green, and the locale test passes after `euSyncCodeSwitchLocked` was removed from en, de and the list.

- [ ] **Step 6: Browser checks:**

| # | State | Expected in "Einstellungen" |
|---|---|---|
| 1 | 0 profiles | "Der Abgleich ist an · …", code card, "Code wechseln" with the 0-sentence and the field open; delete-all card says "Unter diesem Code ist nichts gespeichert." with no button |
| 2 | 1 profile | Lock: "Ein Wechsel entfernt **hier** dein Profil, …" + "Code trotzdem wechseln"; delete-all card with description and button |
| 3 | 3 profiles | Lock with "deine 3 Profile" |
| 4 | List failed (mock `forceStatus: 500`, reload) | Lock with the unknown sentence, "hier" bold; delete-all button active |
| 5 | Unlock | Two blocks "Code laden" (focused field) and "Neuer Code"; Cancel → locked again |
| 6 | Unlock, switch tab and back | Locked again |
| 7 | Load a valid other code | The count confirmation (as today) → code changes → locked state belongs to the new code |
| 8 | Delete-all button | The count confirmation → profiles gone → card shows the empty sentence |

- [ ] **Step 7: Commit.**

```bash
git add js/components/sync-code-input.js tests/sync-code-input.test.mjs js/components/eu-sync-panel.js _locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs
git commit -m "feat(sync): Settings tab - change-code card with two ways, delete-all as its own card"
```

**Acceptance:**
- The eight browser checks pass.
- The singular and plural tests pass.
- "hier" is bold in every lock sentence.
- `grep -n "_pairOpen\|#closePair\|euSyncCodeSwitchLocked'" js/components/eu-sync-panel.js` gives no output.

---

### Task 14: List failure box and the connecting line in "Deine Profile"

**Files:** `js/components/eu-sync-panel.js`, `_locales/en|de/messages.json`, `tests/site-menu-locales.test.mjs`

- [ ] **Step 1: Key** `euSyncListFailed` (`PENDING_TRANSLATION`): de "Deine Profile konnten nicht geladen werden. An deinen Einstellungen hier ändert das nichts." / en "Your profiles could not be loaded. This changes nothing about your settings here."

- [ ] **Step 2: Implement.**
  - Add `_listFailed: { state: true }` and initialise it to `false`.
  - In `#relist`:

```js
	async #relist() {
		const list = await this.#run(() => window.GesturaSync.list());
		if (list) {
			this._listFailed = false;
			await this.#absorbList(list);
		} else if (this._states === null && this._errorCode !== 'disabled') {
			// No list was ever read under this code: the box takes the list's place
			// and keeps the reason (maintenance, unreachable) beside it (spec §8).
			this._listFailed = true;
		}
		return list;
	}
```

  - In `willUpdate`'s edge block: `this._listFailed = false;`.
  - In `#renderStates`, after `${this.#renderFeedback()}`, insert the box. Hide the banner while the box carries the same error: render `#renderFeedback()` only when `!(this._listFailed && this._states === null)`.

```js
				${this._listFailed && this._states === null ? html`
					<div class="msg error-banner" role="alert">
						${unsafeHTML(icons.triangleAlert)}
						<span class="msg-text">${i18n.getMessage('euSyncListFailed')}${this._error ? html`<br>${this._error}` : ''}</span>
						<button type="button" class="btn btn-secondary" ?disabled=${this._busy}
							@click=${() => this.#exclusive(() => this.#refreshStates())}>${i18n.getMessage('euSyncRetry')}</button>
					</div>` : ''}
```

  - The connecting line. Render it once in `#renderStates` directly below the head, always present so the live region exists before it fills:

```js
				<div class="connecting" role="status">${this._busy && this._pending > 0 ? i18n.getMessage('euSyncConnecting') : ''}</div>
```

  - The upload field stays usable while the list failed. It is not gated on `_states`; confirm by reading `create`.

- [ ] **Step 3: Run** `npm test` → green.

- [ ] **Step 4: Browser checks:**
  1. Mock `forceStatus: 500`, open the tab → the box with the sentence and the server reason, plus "Erneut versuchen"; the upload field is enabled.
  2. Mock OK → "Erneut versuchen" → list shows, box gone.
  3. Mock `maintenance` → the box carries the maintenance sentence.
  4. Mock `delayMs: 3000` → "Verbinde mit gestura.eu …" while Refresh runs; a screen reader announces it (check that `role="status"` exists in the DOM before the request).
  5. A list that **was** read once, then Refresh fails → the old list stays, the banner shows the reason, no box.

- [ ] **Step 5: Commit.**

```bash
git add js/components/eu-sync-panel.js _locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs
git commit -m "feat(sync): a box when the profiles cannot be loaded, and a connecting line"
```

**Acceptance:** all five checks pass; uploading stays possible with the box shown.

---

### Task 15: The storage-warning link and the storage-full dialog into the wizard

**Files:** `js/components/storage-line.js`, `js/components/shared-styles.js`, `js/components/storage-full-dialog.js`, `js/components/options-page.js`, `_locales/en|de/messages.json`, `tests/site-menu-locales.test.mjs`

- [ ] **Step 1: Keys** (`PENDING_TRANSLATION`):

| key | de | en |
|---|---|---|
| `euSyncStorageMoreRoom` | Mehr Platz bekommen → | Get more room → |
| `euSyncStorageWayEuDesc` *(owner check)* | Deutlich mehr Platz, und deine Einstellungen lassen sich Ende-zu-Ende-verschlüsselt zwischen deinen Browsern übertragen. Ein Assistent führt dich durch die Einrichtung. Gespeichert ist noch nichts: Nimm die Änderung danach erneut vor. | Much more room, and your settings can travel end-to-end encrypted between your browsers. A short guide walks you through the setup. Nothing has been saved yet: make the change again afterwards. |
| `euSyncStorageWayEuUnreachable` *(owner check)* | Mehr Platz bekommst du auch mit „Browser-Sync ausschalten“. | You also get more room with “Turn off browser sync”. |

- [ ] **Step 2: The link.** In `storage-line.js`, inside the `quota.item !== null` branch (state 'sync'), add the link to the full line and to the ≥ 75 % notice:

```js
	// Only while browser sync is the way (spec §9): the line is shared by the
	// menu and engine managers, so the link asks the options page - via the
	// event it already handles - to jump to the sync section.
	const more = html` <button type="button" class="storage-more"
		@click=${(e) => e.currentTarget.dispatchEvent(new CustomEvent('navigate-section', { detail: { section: 'euSync' }, bubbles: true, composed: true }))}>${i18n.getMessage('euSyncStorageMoreRoom')}</button>`;
```

Use it in `html\`<div class="notice storage-full">${i18n.getMessage('storageFull')}${more}</div>\`` and in the `percent >= 75` notice: `html\`<div class="notice">${text}${more}</div>\``. The plain `storage-line` under 75 % gets nothing. Neither does the local branch.

In `shared-styles.js`, add to `commonStyles`:

```css
	.storage-more { margin-inline-start: 6px; padding: 0; border: 0; background: none; font: inherit; color: var(--accent-color); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
```

Before relying on it, check that both managers include `commonStyles` (`grep -n "commonStyles" js/components/site-menu-manager.js js/components/engine-manager.js`). If one does not, add the rule to that component's own styles instead.

- [ ] **Step 3: The storage-full dialog.**
  - In `storage-full-dialog.js`, the way `eu` uses `'euSyncStorageWayEuDesc'` instead of `'storageWayEuDesc'`.
  - Above the ways, when `this.failure.euNotice` is set:

```js
					${this.failure.euNotice ? html`<div class="eu-notice" role="alert">${this.failure.euNotice}</div>` : ''}
```

  - CSS: `.eu-notice { margin: 4px 20px 0; padding: 10px 12px; border-radius: 8px; font-size: 13px; background: color-mix(in srgb, var(--warning-color) 12%, transparent); }`.

- [ ] **Step 4: The options page keeps the dialog open until the wizard is really there.** Replace `#onStorageWay`:

```js
	// Way 'eu' opens the wizard behind the reachability check (spec §9). The
	// dialog stays until the wizard is open; unreachable, it says so there and
	// points at turning browser sync off instead.
	async #onStorageWay(e) {
		const way = e.detail.way;
		const failure = this._storageFailure;
		const panel = this.shadowRoot.querySelector('eu-sync-panel');
		if (way === 'shrink' || !panel) { this._storageFailure = null; return; }
		if (way === 'local') {
			this._storageFailure = null;
			this.#scrollToSection('euSync');
			await panel.chooseWay('local');
			return;
		}
		const i18n = window.i18n;
		this._storageFailure = { ...failure, euNotice: i18n.getMessage('euSyncConnecting') };
		const r = await panel.chooseWay('eu');
		if (r.opened) {
			this._storageFailure = null;
			this.#scrollToSection('euSync');
			return;
		}
		this._storageFailure = r.message
			? { ...failure, euNotice: `${r.message} ${i18n.getMessage('euSyncStorageWayEuUnreachable')}` }
			: failure;
	}
```

Check the dialog's `updated()`. It refocuses the first way when `open` changes, not when `failure` changes, so updating the notice does not steal focus. Confirm by reading.

- [ ] **Step 5: Run** `npm test` → green.

- [ ] **Step 6: Browser checks:**
  1. In state sync, fill `siteMenus` to ≥ 75 % → the menu manager's notice has "Mehr Platz bekommen →"; clicking it scrolls to the sync section.
  2. In state local → no link at any fill level.
  3. Trigger the storage-full dialog (save past the item quota in state sync); "Auf gestura.eu-Sync umsteigen" with the mock OK → dialog closes, wizard open with the yellow box.
  4. The same with mock `pingStatus: 503` → dialog stays, shows the unreachable sentence plus the hint at "Browser-Sync ausschalten"; that way still works.
  5. The dialog's eu description no longer mentions the integration.

- [ ] **Step 7: Commit.**

```bash
git add js/components/storage-line.js js/components/shared-styles.js js/components/storage-full-dialog.js js/components/options-page.js _locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs
git commit -m "feat(sync): storage warnings point to the sync section; storage-full opens the wizard"
```

**Acceptance:** all five checks pass; `storageWayEuDesc` is no longer referenced (`grep -rn "storageWayEuDesc" js` gives no output).

---

### Task 16: Consent version 2 and its text

**Precondition:** the index has answered whether `POST /sync/list` counts as a read for the 12-month retention. Read `//wsl.localhost/Ubuntu/home/patric/apache/projekte/gestura-index/exchange/AUSTAUSCH.md` (newest entries on top). **Without that answer, stop here and ask the owner**; do not guess the retention sentence.

**Files:** `js/eu-sync-local.js`, `_locales/en|de/messages.json`, `tests/site-menu-locales.test.mjs` (hand note), `docs/gestura-eu-api.md`, `tests/settings-storage.test.mjs:413` (only if it pins version 1 and the test needs a current consent; read it first)

- [ ] **Step 1: Retention sentence.** If a list counts as a read: de „Profile, die 12 Monate lang niemand nutzt, werden gelöscht.“ / en "Profiles that nobody uses for 12 months are deleted." Otherwise: de „Profile, die 12 Monate lang weder geladen noch geändert werden, werden gelöscht.“ / en "Profiles that are neither loaded nor changed for 12 months are deleted."

- [ ] **Step 2: The consent text** (§11, verbatim de; en matching). The keys already exist in all 39 locales; only en and de change.

| key | de | en |
|---|---|---|
| `euSyncConsentLead` | Übertrage deine Gestura-Einstellungen flexibel in andere Browser – Ende-zu-Ende-verschlüsselt, ohne Konto und ohne Passwort. | Take your Gestura settings to other browsers, flexibly – end-to-end encrypted, without an account and without a password. |
| `euSyncConsentPoint1Label` | Kein heimlicher Abgleich: | No sync behind your back: |
| `euSyncConsentPoint1` | Du bestimmst den Zeitpunkt. Einstellungen werden nur gespeichert oder geladen, wenn du es selbst auslöst. | You decide when. Settings are only saved or loaded when you trigger it yourself. |
| `euSyncConsentPoint2Label` | Echte Ende-zu-Ende-Verschlüsselung: | Real end-to-end encryption: |
| `euSyncConsentPoint2` | Die Verschlüsselung passiert direkt in deinem Browser. gestura.eu erhält deine Einstellungen nur verschlüsselt – selbst die Namen deiner Profile sind geschützt. Dein Code wird nie an gestura.eu gesendet. | Encryption happens right in your browser. gestura.eu only ever receives your settings encrypted – even the names of your profiles are protected. Your code is never sent to gestura.eu. |
| `euSyncConsentPoint3Label` | Volle Kontrolle vor jeder Änderung: | Full control before every change: |
| `euSyncConsentPoint3` | Gestura zeigt dir bei jeder Übertragung eine Vorschau, was sich an deinen Einstellungen ändert. | With every transfer, Gestura shows you a preview of what changes in your settings. |
| `euSyncConsentPoint4Label` | Dein Code ist der einzige Schlüssel: | Your code is the only key: |
| `euSyncConsentPoint4` | Nur wer deinen Code hat, kann deine Profile lesen und ändern. Bewahre ihn gut auf – ohne ihn gibt es keine Wiederherstellung. {retention, from step 1} | Only someone with your code can read and change your profiles. Keep it safe – without it there is no recovery. {retention, from step 1} |
| `euSyncConsentPoint5Label` | Ersetzt den Browser-Sync: | Replaces browser sync: |
| `euSyncConsentPoint5` | Gestura verwaltet deine Einstellungen ab jetzt lokal und über gestura.eu statt über das Sync-Konto deines Browsers. Du kannst das jederzeit oben wieder umstellen. | From now on, Gestura keeps your settings locally and on gestura.eu instead of in your browser's sync account. You can change this back at the top at any time. |

The lead is bold: the wizard's `.lead` style already has `font-weight: 600`.

- [ ] **Step 3: Version.** In `js/eu-sync-local.js`: `const CURRENT_SYNC_CONSENT = 2;` with the comment `// Sync's own consent, independent of the integration's. R3 = 1; 2 = the onboarding text (profiles, replaces browser sync).`

- [ ] **Step 4: Run** `npm test`. Read every failure. A test that hard-codes `version: 1` *for a current consent* moves to `L.CURRENT_SYNC_CONSENT`. A test that means "an old consent" keeps `1` and must still see it as stale. `tests/settings-storage.test.mjs:413` only needs `enabled: true` to provoke `tier2-enabled` and does not care about the version; leave it. Expected: green.

- [ ] **Step 5: Contract.** In `docs/gestura-eu-api.md`, sync-consent table, add the row:

```markdown
| 2 | Everything in 1, worded around profiles, plus: switching to gestura.eu replaces the browser's own sync for these settings (they move to local storage). Re-consent from version 1 keeps the stored code, the profile map and the active profile. |
```

- [ ] **Step 6: Hand note** in `tests/site-menu-locales.test.mjs`: replace the 2026-10-08 consent comment with:

```js
// Changed wording in all 39 locales, not caught by a test: euSyncConsentLead and
// euSyncConsentPoint1..5 (+Label) - the onboarding consent text, CURRENT_SYNC_CONSENT 2
// (2026-10-09). The other 37 still carry the version-1 text; translate before the release.
```

- [ ] **Step 7: Browser check.** With a v1 consent stored and sync on, open the page → the reconfirm row; "Weiter" → the wizard with the new text and the kept code; "Mit diesem Code fortfahren" → consent version 2, profiles kept.

- [ ] **Step 8: Commit.**

```bash
git add js/eu-sync-local.js _locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs docs/gestura-eu-api.md
git commit -m "feat(sync): consent version 2 with the onboarding text"
```

**Acceptance:**
- The text matches §11 verbatim (de), with the retention sentence the index's answer selects.
- The version is 2.
- The contract has the row.
- A v1 consent is stale and re-consents with the map kept.

---

### Task 17: Documentation

**Files:** `README.md`, `README.de.md`, `PRIVACY.md`, `CLAUDE.md`

- [ ] **Step 1:** Read the sync paragraphs of the four files (`grep -n -i "sync\|abgleich\|stand\|state" README.md README.de.md PRIVACY.md | head -80`).

- [ ] **Step 2: Update README and README.de together:**
  - "Profil"/"profile" instead of "Stand"/"state";
  - the three ways as the section presents them;
  - turning on gestura.eu runs a short guided setup;
  - switching to "only in this browser" leaves the copy already in the browser's own sync where it is (storage-move §10.1).

  English is canonical, and the German file says the same.

- [ ] **Step 3: PRIVACY.md:**
  - "profiles";
  - the new ping: an unauthenticated `GET /api/v1/sync/ping` when sync is being switched on, which sends no identifier, no settings and no code;
  - the retention sentence as in the consent.

- [ ] **Step 4: CLAUDE.md**, gestura.eu paragraph. Add one sentence after the switch description: "The sync section also owns the choice of where settings live (browser sync / only this browser / gestura.eu); `js/components/storage-area-switch.js` performs the switch, and `options-page.js` no longer has a browser-sync toggle." Add rows to the file table for `js/components/storage-choice.js` (the card mapping and transitions) and `js/components/sync-onboarding-dialog.js` with `sync-onboarding-flow.js` (the wizard and its finishing order).

- [ ] **Step 5: Commit.**

```bash
git add README.md README.de.md PRIVACY.md CLAUDE.md
git commit -m "docs: profiles, the three ways, the onboarding and the ping"
```

**Acceptance:**
- README and README.de say the same.
- PRIVACY names the ping and what it does not send.
- `grep -n -i "\bstates\?\b" README.md` hits no user-facing sync sentence.

---

### Task 18: Cleanup: messages no code uses any more (separate commit, no behaviour)

**Files:** all 39 `_locales/*/messages.json`, `tests/site-menu-locales.test.mjs`

- [ ] **Step 1: Find candidates.** For each key below, `grep -rn "'<key>'\|\"<key>\"" js pages` must come back empty before it is deleted:
  - `syncStatus`, `syncStatusDesc`, `saved` (check for other users first: `saved` may be used elsewhere);
  - `storageBrowserSync`, `storageBrowserSyncOnDesc`, `storageBrowserSyncOffDesc`, `storageWayEuDesc`;
  - `euSyncToggle`, `euSyncToggleDesc`, `euSyncConsentTitle` (unless the wizard uses it), `euSyncConsentAccept`;
  - `euSyncSecretLoad`, `euSyncSecretUseConfirmTitle` (unless `#useCode` still uses it);
  - `euSyncCodeHide`, `euSyncCodeShow` (still used by the code card: keep).

- [ ] **Step 2: Delete** only the keys with zero hits, from every locale file, with a node script. The pending ones also leave `PENDING_TRANSLATION`.

- [ ] **Step 3: Run** `npm test` → green.

- [ ] **Step 4: Commit.**

```bash
git add _locales tests/site-menu-locales.test.mjs
git commit -m "chore(i18n): drop messages the sync section no longer uses"
```

**Acceptance:**
- Every deleted key had zero code hits (list them in the commit body).
- The suite is green.
- No behaviour change: this commit touches only locale files and the pending list.

---

### Task 19: Full browser verification (spec §12)

**Setup** (the memory notes `browser-verifikation-werkzeuge` and `browser-tests-tabs-aufraeumen` hold the details):

```powershell
# mock
$env:SYNC_PORT=8198; node C:\Users\pp.11COM7\.claude\projects\c--Programme-alt-Gestura\browser-verify\sync-mock.mjs   # background
# Edge with the extension and remote debugging
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --user-data-dir=$env:TEMP\edge-profile --remote-debugging-port=9461 --load-extension=C:\Programme.alt\Gestura --no-first-run
```

Set the developer origin to `http://localhost:8198` through the integration panel's advanced mode, so that `syncOrigin()` targets the mock. Scripts go in the scratchpad, using `browser-verify/cdp.mjs`.

- [ ] **Step 1:** Re-run every browser table of Tasks 8, 10, 11, 13, 14, 15 and 16 in one session, in that order, and record pass/fail per row in the scratchpad.
- [ ] **Step 2: Additional §12 rows:**
  - "does not fit" for **both** ways into browser sync (from local, from gestura.eu);
  - 429 at the start (mock `pingStatus: 429`) → "Zu viele Anfragen …";
  - `storageMovedNote` with `movedTo = 'gestura.eu'` → its button opens the wizard straight to Way B after the consent;
  - an in-flight upload cancelled with `delayMs: 3000` → mock log shows the delete.
- [ ] **Step 3: Screenshots**, light and dark:
  - the three cards in each state;
  - the repair line;
  - wizard steps 1–4 plus the kept-code step;
  - the Settings tab with 0, 1 and 3 profiles;
  - the list-failed box;
  - the storage-full dialog with the unreachable notice.

  Save them in the scratchpad and show them to the owner.
- [ ] **Step 4: Clean up:**
  - `CloseMainWindow()` on every Edge process whose command line contains `edge-profile`, then wait 10 s;
  - stop the port-8198 listener;
  - delete the profile directory;
  - reset `sync-config.json` to `{ "delayMs": 0, "forceStatus": 0 }`.

**Acceptance:**
- Every row passes; failures go back to the owning task as a fix commit.
- The screenshots are shown to the owner.
- No test browser or mock is left running.

---

### Task 20: Contract text for the ping (after the index reports it live)

**Precondition:** an entry in `AUSTAUSCH.md` saying `https://gestura.eu/api/v1/sync/ping` answers. Until then this task waits; nothing else depends on it.

**Files:** `docs/gestura-eu-api.md`

- [ ] **Step 1: Read the live answer.**

```bash
curl -s -i https://gestura.eu/api/v1/sync/ping
curl -s -i -X OPTIONS https://gestura.eu/api/v1/sync/ping -H "Origin: chrome-extension://x" -H "Access-Control-Request-Method: GET"
```

Expected: `200` with `{"status":"ok",...}`, and `Access-Control-Allow-Methods` containing GET.

- [ ] **Step 2: Add to the contract:**
  - a `GET /api/v1/sync/ping` section (no body, no locator, no `apiLevel`, no Content-Type; `200 { status, features }`; `503 unavailable`; own per-IP limit, 429 over it);
  - maintenance (`503 { error: "maintenance", until? }` on ping and every `/sync/*`, `Retry-After`, `OPTIONS` stays `204`, no free text);
  - `GET` in the CORS methods line (line ~200);
  - the sentence at line ~511 becomes "it reads a body for exactly two codes, `conflict` and `503`";
  - `404` on `list` / `PUT state` is treated as unreachable.

- [ ] **Step 3: Commit.**

```bash
git add docs/gestura-eu-api.md
git commit -m "docs(contract): sync ping, maintenance 503 and GET in CORS"
```

**Acceptance:**
- The contract describes what the live server answers (step 1) and what the client does (Task 2), with no contradiction.
- The index is told in the logbook that the text is in.

---

## Self-review (done while writing)

- **Spec coverage:**
  - §1 goals → Tasks 8, 10, 13, 6.
  - §2 → Task 6 + texts in every task.
  - §3: mapping → T4; cards, status row and moved note → T8; module → T5; fit check → T1; repair → T8.
  - §4 → T8 (all five rows).
  - §5 → T2, T3, T7, T8.
  - §6: wizard → T9, T10; kept code → T11; Way-B landing hint → T10.
  - §7 → T13.
  - §8: list box and connecting line → T14; maintenance → T3; 404 → T2; wizard errors → T10.
  - §9 → T15.
  - §10: consent and contract row → T16; ping contract → T20; no storage keys holds.
  - §11 → every task's key table.
  - §12 → unit tests in T1–T5, T9, T10, T13; browser checks in T19.
  - §13 → T17.
  - §14 → T16 (retention), T10 (no gate on saving the code).
- **Placeholders:**
  - the retention sentence in Task 16 depends on the index answer by design (§14.4), with both variants written out;
  - the *(owner check)* texts are complete proposals, not gaps.
- **Type consistency:**
  - `switchArea(S, target, reason)` → `{landed, refusal}` is used in T5, T8, T10.
  - `finishOnboarding(steps)` keys are `opened, reread, writeSync, patch, area, switchToLocal, rollback, writeBase` (T9 = T10).
  - `pingService` kinds are `reachable|maintenance|rate-limited|unreachable` (T2 = T3 `reachText`).
  - `chooseWay` returns `{opened, message}` (T8 = T15).
  - `lockText(i18n, n, key?)` is the same in T13's test and implementation.
- **Review Focus:** all five lines have a pinned check in their owning task (T1, T8 #8/#9, T10 #7, T2, T9 + T11 #4).
