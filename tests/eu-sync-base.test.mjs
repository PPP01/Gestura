import { describe, it, expect, beforeEach } from 'vitest';

// The same storage fake tests/eu-sync-local.test.mjs uses.
const store = new Map();
globalThis.chrome = {
	storage: {
		local: {
			get: async (key) => (store.has(key) ? { [key]: store.get(key) } : {}),
			set: async (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
			remove: async (key) => { store.delete(key); },
		},
		onChanged: { addListener: () => {} },
	},
};

await import('../js/eu-sync-crypto.js');
await import('../js/eu-sync-base.js');
const B = globalThis.GesturaSyncBase;
const C = globalThis.GesturaSyncCrypto;

const ID1 = '0123456789abcdef0123456789abcdef';
const ID2 = 'fedcba9876543210fedcba9876543210';
const payload = { gesturaSettings: 1, _version: '2.8.0', trailWidth: 5, siteMenus: { custom: { m1: { name: 'A', items: [] } } } };

beforeEach(() => store.clear());

describe('gzip helpers', () => {
	it('round-trips text', async () => {
		const text = JSON.stringify(payload).repeat(50);
		const gz = await B.gzipText(text);
		expect(gz.length).toBeLessThan(text.length);
		expect(await B.gunzipText(gz, C.INFLATE_MAX_BYTES)).toBe(text);
	});
	it('answers null for garbage and for base64 that is not gzip', async () => {
		expect(await B.gunzipText('not base64!!', C.INFLATE_MAX_BYTES)).toBeNull();
		expect(await B.gunzipText(btoa('plain text'), C.INFLATE_MAX_BYTES)).toBeNull();
	});
	it('takes its inflate bound from the crypto module, not a copy of it', () => {
		expect(B.MAX_INFLATED).toBe(C.INFLATE_MAX_BYTES);
	});
	it('refuses to inflate past the bound', async () => {
		const gz = await B.gzipText('x'.repeat(10000));
		expect(await B.gunzipText(gz, 1000)).toBeNull();
	});
});

describe('read and write', () => {
	it('a written base reads back with hash, payload and date', async () => {
		await B.write(ID1, { hash: 'H1', payload, date: '2026-09-04T10:00:00Z' });
		expect(await B.read(ID1)).toEqual({ hash: 'H1', payload, date: '2026-09-04T10:00:00Z' });
	});
	it('stores the payload gzipped, not as JSON', async () => {
		await B.write(ID1, { hash: 'H1', payload });
		const raw = store.get(B.KEY)[ID1];
		expect(typeof raw.gz).toBe('string');
		expect(raw.gz).not.toContain('gesturaSettings');
		expect(raw.payload).toBeUndefined();
	});
	it('dates the base itself when no date is given', async () => {
		await B.write(ID1, { hash: 'H1', payload });
		expect((await B.read(ID1)).date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
	it('reads null for a state with no base', async () => {
		expect(await B.read(ID1)).toBeNull();
	});
	it('reads null for a damaged entry and removes it', async () => {
		store.set(B.KEY, {
			[ID1]: { hash: 'H1', gz: 42 },
			[ID2]: { hash: 'H2', gz: btoa('not gzip') },
		});
		expect(await B.read(ID1)).toBeNull();
		expect(await B.read(ID2)).toBeNull();
		expect(store.get(B.KEY)).toEqual({});
	});
	it('reads null when the inflated text is not a JSON object', async () => {
		store.set(B.KEY, { [ID1]: { hash: 'H1', gz: await B.gzipText('[1,2]') } });
		expect(await B.read(ID1)).toBeNull();
	});
	it('survives a storage key that is not an object', async () => {
		store.set(B.KEY, 'nonsense');
		expect(await B.read(ID1)).toBeNull();
		expect(await B.list()).toEqual({});
	});
	it('list() gives hash and date per state without a payload', async () => {
		await B.write(ID1, { hash: 'H1', payload, date: 'd1' });
		await B.write(ID2, { hash: 'H2', payload, date: 'd2' });
		expect(await B.list()).toEqual({ [ID1]: { hash: 'H1', date: 'd1' }, [ID2]: { hash: 'H2', date: 'd2' } });
	});
	it('write() with a malformed stateId leaves the store untouched', async () => {
		await B.write(ID1, { hash: 'H1', payload, date: 'd1' });
		await B.write('not-a-state-id', { hash: 'H2', payload });
		expect(await B.list()).toEqual({ [ID1]: { hash: 'H1', date: 'd1' } });
		expect(await B.read('not-a-state-id')).toBeNull();
	});
	it('list() skips entries whose id or hash is malformed', async () => {
		store.set(B.KEY, { nope: { hash: 'H', gz: '' }, [ID1]: { hash: '', gz: '' } });
		expect(await B.list()).toEqual({});
	});
});

describe('remove, prune, clear', () => {
	it('remove deletes exactly one base', async () => {
		await B.write(ID1, { hash: 'H1', payload });
		await B.write(ID2, { hash: 'H2', payload });
		await B.remove(ID1);
		expect(Object.keys(await B.list())).toEqual([ID2]);
	});
	it('prune drops bases for states absent from the listing and keeps the rest', async () => {
		await B.write(ID1, { hash: 'H1', payload });
		await B.write(ID2, { hash: 'H2', payload });
		expect(await B.prune([ID2])).toBe(1);
		expect(Object.keys(await B.list())).toEqual([ID2]);
		expect(await B.prune([ID2])).toBe(0);
	});
	it('clear removes the key', async () => {
		await B.write(ID1, { hash: 'H1', payload });
		await B.clear();
		expect(store.has(B.KEY)).toBe(false);
	});
});
