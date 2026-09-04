import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
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

	// The façade's own pre-check reads the store, and that read can fail (Finding
	// 1). The façade resolves { ok: false, error: 'write' } for it rather than
	// rejecting (see tests/settings-storage.test.mjs); this proves save() rolls
	// #current back on that same path, exactly as it does for a typed refusal.
	it('resolves and rolls #current back when the façade read fails, rather than rejecting', async () => {
		const before = { ...store.current };
		fake.hooks.failNext = { area: 'sync', op: 'get', after: 0 };
		const res = await store.save({ trailWidth: 42 });
		expect(res).toEqual({ ok: false, error: 'write' });
		expect(store.current).toEqual(before);
		expect(fake.raw('sync').trailWidth).not.toBe(42);
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

// Placed last: it imports a fresh module instance via vi.resetModules(), which
// must not disturb the `store`/`mod` singleton the describe blocks above share.
describe('a failing load', () => {
	// Finding 2: before this fix, a rejecting Storage.get() left #loaded false
	// forever - waitForLoad() kept re-throwing and the options page never
	// rendered again. Falling back to defaults on a failed read is what the old
	// callback-based chrome.storage.sync.get did when it ran with lastError set,
	// so this is a regression fix, not new behaviour.
	it('falls back to defaults instead of leaving the store permanently unusable', async () => {
		fake.hooks.failNext = { area: 'sync', op: 'get', after: 0 };
		vi.resetModules();
		const fresh = await import('../js/settings-store.js');
		await expect(fresh.settingsStore.waitForLoad()).resolves.toBeDefined();
		expect(fresh.settingsStore.current).toEqual(DEFAULTS);
	});
});

describe('10.1 · absence means nothing', () => {
	it('when an external change removes a key with a null default, the local copy stands', async () => {
		// lastSyncTime is the one DEFAULT_SETTINGS key with null default.
		// sameShape(undefined, null) returns true, so the shape check does not reject it.
		// Only the newValue === undefined clause stops the update.
		const isoTime = new Date().toISOString();
		await store.save({ lastSyncTime: isoTime });
		const r = store.handleExternalChange({ lastSyncTime: { oldValue: isoTime } });
		expect(r.hasChange).toBe(false);
		expect(store.current.lastSyncTime).toBe(isoTime);
	});

	it('a value of the wrong shape leaves the local copy standing', async () => {
		// What an older Gestura would receive if storage.sync ever carried a
		// compressed branch: a string where an object lives.
		const before = store.current.siteMenus;
		const r = store.handleExternalChange({ siteMenus: { newValue: 'H4sIAAAAAAAA' } });
		expect(r.hasChange).toBe(false);
		expect(store.current.siteMenus).toEqual(before);
	});

	it('a key outside DEFAULT_SETTINGS never reaches #current', () => {
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
