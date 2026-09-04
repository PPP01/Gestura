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

	// The base (js/eu-sync-base.js) needs the hash the server now holds for this
	// state. The server's answer does not carry it, and it cannot be derived from
	// the settings (fresh IV every time) - the uploader is the only one who knows.
	it('returns the payloadHash it wrote into the meta blob', async () => {
		const r = await S.uploadState({
			secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			name: 'Work', createdAt: 'x', exportObj: { gesturaSettings: 1 }, extVersion: '2.8.0',
			fetchImpl: fetchOk({ stateId: ID, updatedAt: 'x', size: 1 }),
		});
		expect(r).toMatchObject({ stateId: ID, updatedAt: 'x', size: 1 });
		expect(r.payloadHash).toBe(await X.blobHash(calls[0].body.payload));
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
	// corrupted upload into "all your states are gone", and take the button that
	// could delete the broken one with it. A meta that is missing altogether is
	// the same failure as one that does not decrypt: THAT state is unreadable.
	it.each([['does not decrypt', 'bm90aGluZw=='], ['is missing', null]])
		('marks a state whose meta %s and keeps the rest', async (_label, meta) => {
			const key = await X.deriveKey(await secretBytes());
			const good = await X.encryptBlob(key, ID, 'meta', { name: 'Work' });
			const other = 'ffffffffffffffffffffffffffffffff';
			const out = await S.listStates({
				secret: await secretBytes(), origin: 'https://gestura.eu',
				fetchImpl: fetchOk({ states: [{ stateId: other, size: 1, updatedAt: 'x', meta }, { stateId: ID, size: 10, updatedAt: 'x', meta: good }] }),
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

	// The hash is computed over the decoded bytes, and decoding is the first
	// thing that can fail on a payload the server made up. That failure belongs
	// to the answer, not to the server's status.
	it('reports a payload that is not base64 as malformed', async () => {
		await expect(S.downloadState({
			secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			expectPayloadHash: 'whatever-the-meta-said',
			fetchImpl: fetchOk({ stateId: ID, updatedAt: 'x', payload: 'not base64!!' }),
		})).rejects.toMatchObject({ code: 'malformed' });
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

// Pseudo-random base64 characters carry six bits each - gzip cannot shrink them
// meaningfully, so a megabyte of them stays over the 512 KiB envelope limit
// after compression. 'x'.repeat() would compress to nothing and the test would
// stop testing anything. xorshift32, not crypto.getRandomValues: WebCrypto caps
// one call at 65 536 bytes and throws QuotaExceededError above it, and a
// deterministic sequence makes a failure reproducible.
const incompressible = (n) => {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	let x = 0x9e3779b9;
	let s = '';
	for (let i = 0; i < n; i++) {
		x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
		s += alphabet[(x >>> 0) & 63];
	}
	return s;
};

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
		const big = { gesturaSettings: 1, customCss: incompressible(1024 * 1024) };
		await expect(S.uploadState({
			secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			name: 'Work', createdAt: 'x', exportObj: big, extVersion: '2.8.0',
			fetchImpl: fetchOk({}),
		})).rejects.toMatchObject({ code: 'too-large' });
		expect(calls).toHaveLength(0);
	});

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

// The write token. Without it the second browser to press Overwrite discards
// the first one's work in silence - the payloadHash inside the meta blob binds
// the two blobs of ONE upload to each other, never an upload to the state it
// replaces.
describe('the write token', () => {
	const upload = (over = {}) => S.uploadState({
		secret: null, origin: 'https://gestura.eu', stateId: ID,
		name: 'Work', createdAt: 'x', exportObj: { gesturaSettings: 1 }, extVersion: '2.8.0',
		fetchImpl: fetchOk({ stateId: ID, updatedAt: 'x', size: 1 }),
		...over,
	});

	it('travels in the body when the upload replaces a known state', async () => {
		await upload({ secret: await secretBytes(), basePayloadHash: 'the-hash-we-read' });
		expect(calls[0].body.basePayloadHash).toBe('the-hash-we-read');
	});

	// Absent means "write unconditionally" - that is how a new state is created,
	// and how the user says "overwrite anyway" after seeing the conflict. It is
	// also what keeps an older extension working against the same server.
	it('is absent for a new state, and the body keeps its five fields', async () => {
		await upload({ secret: await secretBytes() });
		expect(calls[0].body).not.toHaveProperty('basePayloadHash');
		expect(Object.keys(calls[0].body).sort()).toEqual(['apiLevel', 'locator', 'meta', 'payload', 'stateId']);
	});

	it.each([['an empty string', ''], ['null', null], ['a number', 42]])
		('is left out for %s rather than sent as junk', async (_label, basePayloadHash) => {
			await upload({ secret: await secretBytes(), basePayloadHash });
			expect(calls[0].body).not.toHaveProperty('basePayloadHash');
		});

	it('maps 412 to conflict', async () => {
		await expect(upload({ secret: await secretBytes(), basePayloadHash: 'stale', fetchImpl: fetchStatus(412, { error: 'conflict', updatedAt: '2026-09-03T14:12:00Z' }) }))
			.rejects.toMatchObject({ code: 'conflict' });
	});

	// The contract puts updatedAt in the refusal for exactly one reason: so the
	// panel can say WHEN the state moved without asking a second time.
	it('carries the date out of the refusal', async () => {
		await upload({ secret: await secretBytes(), basePayloadHash: 'stale', fetchImpl: fetchStatus(412, { error: 'conflict', updatedAt: '2026-09-03T14:12:00Z' }) })
			.catch(e => { expect(e.updatedAt).toBe('2026-09-03T14:12:00Z'); });
	});

	it.each([['no body at all', ''], ['a body that is not JSON', 'nope'], ['a body without the date', '{}']])
		('is still a clean conflict with %s', async (_label, text) => {
			const fetchImpl = async (url, init) => {
				calls.push({ url, init, body: JSON.parse(init.body) });
				return { ok: false, status: 412, headers: { get: () => null }, text: async () => text };
			};
			await expect(upload({ secret: await secretBytes(), basePayloadHash: 'stale', fetchImpl }))
				.rejects.toMatchObject({ code: 'conflict', updatedAt: '' });
		});

	// Every other status keeps behaving as it did; reading the body is a
	// conflict-only detour and must not become a second failure mode.
	it('does not read the body of any other error', async () => {
		let read = 0;
		const fetchImpl = async (url, init) => {
			calls.push({ url, init, body: JSON.parse(init.body) });
			return { ok: false, status: 500, headers: { get: () => null }, text: async () => { read++; return '{}'; } };
		};
		await expect(upload({ secret: await secretBytes(), fetchImpl })).rejects.toMatchObject({ code: 'server' });
		expect(read).toBe(0);
	});
});
