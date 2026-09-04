import { describe, it, expect, beforeEach, vi } from 'vitest';
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

	// load()'s read and a storage.onChanged for the area can cross: the snapshot
	// the read returns is OLDER than the event. Without a guard the stale read
	// would win and this context would sit on the wrong area until the next
	// switch. A fresh module instance, so load() is in flight when the change lands.
	it('does not let a slow first read overwrite a change that arrived meanwhile', async () => {
		// Wait for the hook itself, not for a timer: under a loaded test runner the
		// module import can take longer than a macrotask, and a timer would let the
		// change land BEFORE the read even started - which is not the race.
		let release;
		const snapshotTaken = new Promise(taken => {
			fake.hooks.beforeGetReturns = () => { taken(); return new Promise(r => { release = r; }); };
		});
		vi.resetModules();
		const loading = import('../js/settings-storage.js');
		await snapshotTaken;
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'local', movedAt: 'x', movedTo: 'local' } });
		release();
		await loading;
		const fresh = globalThis.GesturaSettingsStorage;
		await fresh.ready();
		expect(fresh.area()).toBe('local');
		// The rest of this file talks to the first instance.
		globalThis.GesturaSettingsStorage = S;
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

	// The code stays 'write' - isStorageFull() and every caller switch on it - and
	// the browser's own words ride along on `message`, which is the whole
	// diagnosis of the failure this feature exists to handle. Nothing shows the
	// raw string to the user; js/settings-store.js logs it.
	it("set reports a failing store as a write error, carrying the browser's reason", async () => {
		const orig = chrome.storage.sync.set;
		chrome.storage.sync.set = async () => { throw new Error('QUOTA_BYTES quota exceeded'); };
		try {
			expect(await S.set({ theme: 'dark' })).toEqual({ ok: false, error: 'write', message: 'QUOTA_BYTES quota exceeded' });
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

	// Same race as load()'s area test above, but for a settings change rather than
	// the area itself: a storage.local change can land while the first read is
	// still in flight. Deciding the namespace against cache.area right then would
	// measure it against the not-yet-loaded default 'sync' and drop it - a cold
	// context already in state 'local' whose first change arrives before it has
	// discovered so. A fresh module instance, with 'local' already the real area
	// in storage before it loads, so load() is in flight when the change lands.
	it('delivers a change that arrives while the first read of a local area is still in flight', async () => {
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'local', movedAt: 'x', movedTo: 'local' } });
		let release;
		const snapshotTaken = new Promise(taken => {
			fake.hooks.beforeGetReturns = () => { taken(); return new Promise(r => { release = r; }); };
		});
		vi.resetModules();
		const loading = import('../js/settings-storage.js');
		await snapshotTaken;
		const fresh = globalThis.GesturaSettingsStorage;
		const seen = [];
		const off = fresh.onChanged(c => seen.push(c));
		await chrome.storage.local.set({ theme: 'dark' });
		release();
		await loading;
		off();
		expect(seen).toHaveLength(1);
		expect(seen[0].theme.newValue).toBe('dark');
		// The rest of this file talks to the first instance.
		globalThis.GesturaSettingsStorage = S;
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
		expect(u.total).toBe(u.branches.theme + u.branches.siteMenus + S.entryBytes(S.FORMAT_KEY, 1));
		expect(u.quota).toEqual({ item: 8192, total: 102400 });
	});

	it('has no per-item quota in state local', async () => {
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'local', movedAt: 'x', movedTo: 'local' } });
		expect(S.usage({}).quota).toEqual({ item: null, total: 1024 * 1024 });
	});

	// §10.1's marker is written beside the settings in state 'sync' and counted by
	// the pre-check. Leaving it out of the display let the data section read
	// "102 395 of 102 400" over a save that was refused - eleven bytes, and the
	// difference between a number the user can act on and one they cannot.
	it('counts the format marker in state sync, and not in state local', async () => {
		const marker = S.entryBytes(S.FORMAT_KEY, 1);
		expect(marker).toBe(11);
		expect(S.usage({}).total).toBe(marker);
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'local', movedAt: 'x', movedTo: 'local' } });
		expect(S.usage({}).total).toBe(0);
	});

	// The point of the marker fix: what the data section shows and what the
	// pre-check refuses on are the same number.
	it('reports the same total the pre-check refuses on', async () => {
		const settings = {};
		for (const k of KNOWN.slice(0, 13)) settings[k] = valueOfSize(k, 8192);
		const u = S.usage(settings);
		expect(u.total).toBeGreaterThan(u.quota.total);
		expect(await S.set(settings)).toMatchObject({ ok: false, error: 'total-full', bytes: u.total });
	});
});

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

	// set() must never reject, for any input, in any area. The pre-check reads
	// the store to weigh the untouched keys; that read can fail the same way any
	// other storage call can (a dead extension context, a transient error). A
	// read failure has no code of its own in the contract, so it is reported as
	// 'write' - the same imprecision Task 3 already carries for its own reads.
	it('resolves { ok: false, error: "write" } instead of rejecting when the pre-check read fails', async () => {
		fake.hooks.failNext = { area: 'sync', op: 'get', after: 0 };
		await expect(S.set({ theme: 'dark' })).resolves
			.toEqual({ ok: false, error: 'write', message: 'injected failure: sync.get' });
		expect(fake.raw('sync')).not.toHaveProperty('theme');
	});
});

describe('switchTo local', () => {
	beforeEach(async () => {
		for (const k of KNOWN) await chrome.storage.sync.set({ [k]: DEFAULTS[k] });
		await chrome.storage.sync.set({ theme: 'dark' });
	});

	it('copies every known key, sets the area with date and reason, and deletes nothing in sync', async () => {
		const before = fake.raw('sync');
		expect(await S.switchTo('local', 'local')).toEqual({ ok: true, noted: true });
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
		expect(await S.switchTo('sync')).toEqual({ ok: true, noted: true });
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

// One failing write at a time. `after` counts the matching writes that succeed
// before the injected one fails - the order of writes is the order the code
// above makes them, and each test names which one it kills.
describe('switchTo under a failing write', () => {
	beforeEach(async () => {
		for (const k of KNOWN) await chrome.storage.sync.set({ [k]: DEFAULTS[k] });
	});

	it('to local: a failed first copy changes nothing', async () => {
		fake.hooks.failNext = { area: 'local', op: 'set', after: 0 };
		expect(await S.switchTo('local', 'local')).toEqual({ ok: false, error: 'write' });
		expect(S.area()).toBe('sync');
		expect(fake.raw('local')).not.toHaveProperty('theme');
		expect(fake.raw('sync')).not.toHaveProperty('syncMovedAt');
	});

	it('to local: a failed area write leaves the area on sync and writes no note', async () => {
		fake.hooks.failNext = { area: 'local', op: 'set', after: 1 };
		expect(await S.switchTo('local', 'local')).toEqual({ ok: false, error: 'write' });
		expect(S.area()).toBe('sync');
		expect(fake.raw('local')[S.AREA_KEY].area).toBe('sync');
		expect(fake.raw('sync')).not.toHaveProperty('syncMovedAt');
	});

	it('to local: a failed second copy puts the area back', async () => {
		// The second copy writes only what changed during the first, so make
		// something change - otherwise there is no third local write to fail.
		fake.hooks.onSet = async (name) => {
			if (name === 'local') await chrome.storage.sync.set({ edgeGestureConflict: true });
		};
		fake.hooks.failNext = { area: 'local', op: 'set', after: 2 };
		expect(await S.switchTo('local', 'local')).toEqual({ ok: false, error: 'write' });
		expect(S.area()).toBe('sync');
		expect(fake.raw('local')[S.AREA_KEY].area).toBe('sync');
		expect(fake.raw('sync')).not.toHaveProperty('syncMovedAt');
	});

	it('to local: a failed note still counts as switched, and says so', async () => {
		fake.hooks.failNext = { area: 'sync', op: 'set', after: 0 };
		expect(await S.switchTo('local', 'local')).toEqual({ ok: true, noted: false });
		expect(S.area()).toBe('local');
		expect(fake.raw('sync')).not.toHaveProperty('syncMovedAt');
		expect(await S.note()).toBe(null);
	});

	it('to sync: a failed data write leaves the browser local with the note in place', async () => {
		await S.switchTo('local', 'local');
		fake.hooks.failNext = { area: 'sync', op: 'set', after: 0 };
		expect(await S.switchTo('sync')).toEqual({ ok: false, error: 'write' });
		expect(S.area()).toBe('local');
		expect(fake.raw('sync').syncMovedAt).toBeDefined();
	});

	it('to sync: a failed area write leaves the browser local, with a fresher copy in sync', async () => {
		await S.switchTo('local', 'local');
		await S.set({ theme: 'dark' });
		fake.hooks.failNext = { area: 'local', op: 'set', after: 0 };
		expect(await S.switchTo('sync')).toEqual({ ok: false, error: 'write' });
		expect(S.area()).toBe('local');
		expect(fake.raw('sync').theme).toBe('dark');
		expect(fake.raw('sync').syncMovedAt).toBeDefined();
	});

	it('to sync: a failed note removal still counts as switched', async () => {
		await S.switchTo('local', 'local');
		fake.hooks.failNext = { area: 'sync', op: 'remove', after: 0 };
		expect(await S.switchTo('sync')).toEqual({ ok: true, noted: false });
		expect(S.area()).toBe('sync');
		expect(fake.raw('sync').syncMovedAt).toBeDefined();
	});
});

// Save, export and import share one CEILING - and, which is the part that broke,
// one MEASURE. The number was always the same on both sides; what differed was
// what it was applied to. The façade counts key + JSON value per branch; the
// validator used to count the UTF-8 length of the file text, and our own
// exporter writes that file with two-space indentation. On real catalog data
// that indentation is about 1.72x the compact form, so a settings set that saved
// fine produced an export the same build refused to read back.
//
// The fourth door, upload, is bounded by the contract's 512 KiB envelope and is
// measured at upload time, not promised here (storage-move design §8).
describe('save, export and import share one ceiling', () => {
	// A menu-shaped entry: many small nested values, which is where indentation
	// costs what it costs. One big string would inflate by almost nothing and
	// would not reproduce the failure this guards.
	function menuEntry(i) {
		return {
			id: `m${i}`,
			name: `Menu number ${i}`,
			icon: 'globe',
			patterns: [`https://example${i}.test/*`, `https://www.example${i}.test/*`],
			items: [0, 1, 2, 3].map(n => ({
				id: `m${i}i${n}`,
				action: 'searchEngine',
				engineId: `engine-${n}`,
				label: `Entry ${n} of menu ${i}`,
			})),
		};
	}

	// Fills siteMenus.custom until the façade's own measure sits just under the
	// ceiling - "just under" because the two measures differ by JSON's punctuation
	// (quotes, colons, commas), some four bytes a branch, which is structure and
	// not formatting.
	function settingsAtCeiling() {
		const custom = {};
		const settings = { ...structuredClone(DEFAULTS), siteMenus: { ...structuredClone(DEFAULTS.siteMenus), custom } };
		const budget = S.QUOTA.local.total - 4096;
		// Estimated first, then measured: re-measuring a megabyte after every one
		// of some thousand entries is quadratic and takes seconds.
		const base = S.usage(settings).total;
		const per = S.byteLength(JSON.stringify(menuEntry(0))) + 8;
		let n = Math.max(0, Math.floor((budget - base) / per));
		for (let i = 0; i < n; i++) custom[`m${i}`] = menuEntry(i);
		while (S.usage(settings).total < budget) custom[`m${n++}`] = menuEntry(n);
		while (S.usage(settings).total > budget) delete custom[`m${--n}`];
		return settings;
	}

	it('is the same number on both sides', async () => {
		await import('../js/eu-integration.js');
		await import('../js/eu-settings-schema.js');
		expect(globalThis.GesturaSettingsSchema.MAX_BYTES).toBe(S.QUOTA.local.total);
	});

	// The assertion that would have caught the break: not two constants compared,
	// but a settings set at the ceiling carried the whole way round. The
	// intermediate expectations are the demonstration - the file IS bigger than
	// the ceiling, and it is accepted anyway, because what is measured is the
	// content and not the indentation.
	it('takes back a pretty-printed export of a settings set at the ceiling', async () => {
		await import('../js/eu-integration.js');
		await import('../js/eu-settings-schema.js');
		const Schema = globalThis.GesturaSettingsSchema;
		await chrome.storage.local.set({ [S.AREA_KEY]: { area: 'local', movedAt: '2026-09-04T00:00:00.000Z', movedTo: 'local' } });

		const settings = settingsAtCeiling();
		const total = S.usage(settings).total;
		expect(total).toBeLessThanOrEqual(S.QUOTA.local.total);
		expect(total).toBeGreaterThan(S.QUOTA.local.total - 8192);
		// It saves.
		expect(await S.set(settings)).toEqual({ ok: true });

		// It exports, through the exporter the options page uses.
		const result = Schema.validatedExport(settings, '2.8.0');
		expect(result.ok).toBe(true);
		const text = result.json;
		// The file is larger than the ceiling - two spaces of indentation a line.
		expect(S.byteLength(text)).toBeGreaterThan(Schema.MAX_BYTES);
		// And the content is not.
		expect(S.byteLength(JSON.stringify(JSON.parse(text)))).toBeLessThanOrEqual(Schema.MAX_BYTES);

		// It comes back.
		const back = Schema.validate(text);
		expect(back.error).toBe(null);
		expect(back.ok).toBe(true);
		expect(Object.keys(back.settings.siteMenus.custom).length)
			.toBe(Object.keys(settings.siteMenus.custom).length);
	});

	// The guard in front of JSON.parse still refuses a file no export could be,
	// and it is far enough above the ceiling that the pretty-printed export above
	// passes it untouched.
	it('refuses a file too big to be an export before parsing it', () => {
		const Schema = globalThis.GesturaSettingsSchema;
		expect(Schema.RAW_MAX_BYTES).toBeGreaterThan(2 * Schema.MAX_BYTES);
		const huge = `{"gesturaSettings":1,"theme":"${'x'.repeat(Schema.RAW_MAX_BYTES)}"}`;
		expect(Schema.validate(huge)).toMatchObject({ ok: false, error: 'too-large' });
	});
});
