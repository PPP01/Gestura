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
