import { describe, it, expect, beforeEach } from 'vitest';

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

const CODE = 'GS1-000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFG-CC6W';
const LOCATOR = 'zoogXw2lwmt_ZqFnRu-lFOWYxyJaU2kpxfunpy3Umsk';
const ID = '0123456789abcdef0123456789abcdef';

let tier1, tier2;
globalThis.GesturaEuLocal = { read: async () => tier1, current: () => tier1, onChange: () => () => {} };

await import('../js/eu-integration.js');
await import('../js/eu-sync-code.js');
await import('../js/eu-sync-crypto.js');
await import('../js/eu-sync-local.js');
await import('../js/eu-sync.js');
const EU = globalThis.FlowMouseEuIntegration;
const C = globalThis.GesturaSyncCode;
const X = globalThis.GesturaSyncCrypto;
const L = globalThis.GesturaSyncLocal;
const S = globalThis.GesturaSync;

const integration = (over = {}) => ({
	euIntegration: { enabled: true, consent: { version: EU.CURRENT_INTEGRATION_CONSENT, date: 'x' }, devOrigin: '', ...over },
});
const syncState = (over = {}) => ({
	enabled: true, consent: { version: L.CURRENT_SYNC_CONSENT, date: 'x' }, secret: CODE, states: {}, ...over,
});

// Every call records what was asked, so a test can assert on the body that
// actually went out rather than on what the code meant to send.
let calls;
const fetchOk = (payload) => async (url, init) => {
	calls.push({ url, init, body: JSON.parse(init.body) });
	return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payload) };
};
const fetchStatus = (status, body) => async (url, init) => {
	calls.push({ url, init, body: JSON.parse(init.body) });
	return { ok: false, status, headers: { get: () => null }, text: async () => JSON.stringify(body || {}) };
};

const secretBytes = async () => (await C.parse(CODE)).secret;

beforeEach(async () => {
	store.clear();
	calls = [];
	tier1 = integration();
	// Through the module, not into the store: GesturaSyncLocal caches, so a
	// direct store write would leave the cache holding the previous test's state.
	await L.write(syncState());
});

describe('the request body', () => {
	it('carries the api level and the locator, and never the secret', async () => {
		await S.listStates({ secret: await secretBytes(), origin: 'https://gestura.eu', fetchImpl: fetchOk({ states: [] }) });
		expect(calls[0].url).toBe('https://gestura.eu/api/v1/sync/list');
		expect(calls[0].body).toEqual({ apiLevel: 3, locator: LOCATOR });
		expect(calls[0].init.body).not.toContain('GS1');
	});

	// The server must not learn the state's name. It is inside the encrypted meta
	// blob, and this is the assertion that keeps it there.
	it('never sends a state name in the clear', async () => {
		await S.uploadState({
			secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			name: 'Arbeitsrechner', createdAt: '2026-09-03T00:00:00Z',
			exportObj: { gesturaSettings: 1, theme: 'dark' }, extVersion: '2.8.0',
			fetchImpl: fetchOk({ stateId: ID, updatedAt: 'x', size: 1 }),
		});
		expect(calls[0].init.body).not.toContain('Arbeitsrechner');
		expect(calls[0].init.method).toBe('PUT');
		expect(Object.keys(calls[0].body).sort()).toEqual(['apiLevel', 'locator', 'meta', 'payload', 'stateId']);
	});

	it('binds the meta blob to the payload it was uploaded with', async () => {
		await S.uploadState({
			secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			name: 'Work', createdAt: 'x', exportObj: { gesturaSettings: 1 }, extVersion: '2.8.0',
			fetchImpl: fetchOk({ stateId: ID, updatedAt: 'x', size: 1 }),
		});
		const key = await X.deriveKey(await secretBytes());
		const meta = await X.decryptBlob(key, ID, 'meta', calls[0].body.meta);
		expect(meta.name).toBe('Work');
		expect(meta.payloadHash).toBe(await X.blobHash(calls[0].body.payload));
	});
});

describe('reading a list', () => {
	it('decrypts the meta blobs', async () => {
		const key = await X.deriveKey(await secretBytes());
		const meta = await X.encryptBlob(key, ID, 'meta', { name: 'Work', updatedAt: 'x' });
		const out = await S.listStates({
			secret: await secretBytes(), origin: 'https://gestura.eu',
			fetchImpl: fetchOk({ states: [{ stateId: ID, size: 10, updatedAt: 'x', meta }] }),
		});
		expect(out[0].meta.name).toBe('Work');
		expect(out[0].broken).toBe(false);
	});

	// One damaged blob must not hide the other states - that would turn a single
	// corrupted upload into "all your states are gone".
	it('marks a meta blob it cannot read and keeps the rest', async () => {
		const key = await X.deriveKey(await secretBytes());
		const good = await X.encryptBlob(key, ID, 'meta', { name: 'Work' });
		const other = 'ffffffffffffffffffffffffffffffff';
		const out = await S.listStates({
			secret: await secretBytes(), origin: 'https://gestura.eu',
			fetchImpl: fetchOk({ states: [{ stateId: other, size: 1, updatedAt: 'x', meta: 'bm90aGluZw==' }, { stateId: ID, size: 10, updatedAt: 'x', meta: good }] }),
		});
		expect(out).toHaveLength(2);
		expect(out[0].broken).toBe(true);
		expect(out[0].meta).toBe(null);
		expect(out[1].meta.name).toBe('Work');
	});

	it.each([
		['a non-object answer', '[]'],
		['a missing states array', '{"ok":true}'],
		['a state with a bad id', '{"states":[{"stateId":"nope","size":1,"updatedAt":"x","meta":"AA=="}]}'],
	])('rejects %s', async (_label, text) => {
		const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => text });
		await expect(S.listStates({ secret: await secretBytes(), origin: 'https://gestura.eu', fetchImpl }))
			.rejects.toMatchObject({ code: 'malformed' });
	});
});

describe('downloading', () => {
	it('returns the decrypted export', async () => {
		const key = await X.deriveKey(await secretBytes());
		const payload = await X.encryptBlob(key, ID, 'payload', { gesturaSettings: 1, theme: 'dark' });
		const out = await S.downloadState({
			secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			expectPayloadHash: await X.blobHash(payload),
			fetchImpl: fetchOk({ stateId: ID, updatedAt: 'x', payload }),
		});
		expect(out).toEqual({ gesturaSettings: 1, theme: 'dark' });
	});

	// The AAD already stops a blob from moving between states and roles. This
	// stops the server from pairing an OLD payload with a NEW meta.
	it('refuses a payload the meta did not describe', async () => {
		const key = await X.deriveKey(await secretBytes());
		const payload = await X.encryptBlob(key, ID, 'payload', { gesturaSettings: 1 });
		await expect(S.downloadState({
			secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			expectPayloadHash: 'a-hash-of-something-else',
			fetchImpl: fetchOk({ stateId: ID, updatedAt: 'x', payload }),
		})).rejects.toMatchObject({ code: 'decrypt' });
	});

	// The binding must not be skippable. A server that leaves payloadHash out of
	// the meta blob would otherwise switch the check off for that one state -
	// exactly the move the binding exists to stop. So a missing hash is a
	// failure, and it fails before the request is even made.
	it.each([['no hash', undefined], ['an empty hash', ''], ['a hash that is not a string', 42]])
		('refuses to download with %s to check against', async (_label, expectPayloadHash) => {
			await expect(S.downloadState({
				secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
				expectPayloadHash, fetchImpl: fetchOk({ stateId: ID, updatedAt: 'x', payload: 'AA==' }),
			})).rejects.toMatchObject({ code: 'decrypt' });
			expect(calls).toHaveLength(0);
		});
});

describe('errors', () => {
	it.each([
		[400, 'bad-request'],
		[404, 'not-found'],
		[409, 'quota-states'],
		[413, 'too-large'],
		[429, 'rate-limited'],
		[500, 'server'],
	])('maps HTTP %i', async (status, code) => {
		await expect(S.listStates({ secret: await secretBytes(), origin: 'https://gestura.eu', fetchImpl: fetchStatus(status) }))
			.rejects.toMatchObject({ code });
	});

	it('maps a throwing fetch to network', async () => {
		const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
		await expect(S.listStates({ secret: await secretBytes(), origin: 'https://gestura.eu', fetchImpl }))
			.rejects.toMatchObject({ code: 'network' });
	});

	// Checked before the request, so the user is told the limit instead of
	// watching half a megabyte go out and come back as a 413.
	it('refuses an oversized payload without asking the server', async () => {
		const big = { gesturaSettings: 1, customCss: 'x'.repeat(S.LIMITS.payloadMaxBytes) };
		await expect(S.uploadState({
			secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			name: 'Work', createdAt: 'x', exportObj: big, extVersion: '2.8.0',
			fetchImpl: fetchOk({}),
		})).rejects.toMatchObject({ code: 'too-large' });
		expect(calls).toHaveLength(0);
	});
});

describe('the gate', () => {
	it('refuses to act while tier 2 is off', async () => {
		await L.write({ enabled: false });
		await expect(S.list()).rejects.toMatchObject({ code: 'disabled' });
	});

	it('refuses to act while tier 1 is off', async () => {
		tier1 = integration({ enabled: false });
		await expect(S.list()).rejects.toMatchObject({ code: 'disabled' });
	});

	it('refuses to act without a usable secret', async () => {
		await L.write({ secret: 'GS1-nonsense' });
		await expect(S.list()).rejects.toMatchObject({ code: 'no-secret' });
	});

	// The request has already gone out and come back. Its answer must still not
	// be used - the same rule R2's persist() follows for the update cache.
	it('discards an answer that arrived after the switch went off', async () => {
		const original = globalThis.fetch;
		globalThis.fetch = async (url, init) => {
			await L.write({ enabled: false });
			return fetchOk({ states: [] })(url, init);
		};
		await expect(S.list()).rejects.toMatchObject({ code: 'disabled' });
		globalThis.fetch = original;
	});
});
