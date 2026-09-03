import { describe, it, expect, beforeEach } from 'vitest';

// Storage and GesturaEuLocal stubs before the import, the way
// tests/eu-updates-persist.test.mjs establishes.
const store = new Map();
let onChangedListener = null;

globalThis.chrome = {
	storage: {
		local: {
			get: async (key) => (store.has(key) ? { [key]: store.get(key) } : {}),
			set: async (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
			remove: async (key) => { store.delete(key); },
		},
		onChanged: { addListener: (fn) => { onChangedListener = fn; } },
	},
};

let tier1;
const tier1Listeners = [];
globalThis.GesturaEuLocal = {
	read: async () => tier1,
	current: () => tier1,
	onChange: (fn) => { tier1Listeners.push(fn); return () => {}; },
};

await import('../js/eu-integration.js');
await import('../js/eu-sync-code.js');
await import('../js/eu-sync-crypto.js');
await import('../js/eu-sync-local.js');
const EU = globalThis.FlowMouseEuIntegration;
const L = globalThis.GesturaSyncLocal;

const integration = (over = {}) => ({
	euIntegration: {
		enabled: true,
		consent: { version: EU.CURRENT_INTEGRATION_CONSENT, date: '2026-09-03T00:00:00Z' },
		devOrigin: '',
		...over,
	},
});
const sync = (over = {}) => ({
	euSync: {
		enabled: true,
		consent: { version: L.CURRENT_SYNC_CONSENT, date: '2026-09-03T00:00:00Z' },
		secret: 'GS1-000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFG-CC6W',
		states: {},
		...over,
	},
});
const ID = '0123456789abcdef0123456789abcdef';

beforeEach(async () => {
	store.clear();
	tier1 = integration();
	// The module keeps a live cache, so emptying the store is not the same as
	// resetting the state - write the defaults THROUGH the module so the cache
	// goes back too. Without this the tests leak into each other.
	await L.write({ enabled: false, consent: null, secret: '', states: {} });
});

describe('normalizeSync', () => {
	it('answers the defaults for an empty store', () => {
		expect(L.normalizeSync({}).euSync).toEqual({ enabled: false, consent: null, secret: '', states: {} });
	});

	it('drops a consent without a numeric version', () => {
		expect(L.normalizeSync({ euSync: { consent: { date: 'x' } } }).euSync.consent).toBe(null);
	});

	it('drops a state whose id is not a state id', () => {
		const out = L.normalizeSync({ euSync: { states: { [ID]: { name: 'Work' }, 'nope': { name: 'X' } } } });
		expect(Object.keys(out.euSync.states)).toEqual([ID]);
		expect(out.euSync.states[ID]).toEqual({ name: 'Work', lastUploadHash: '', lastUploadDate: '' });
	});
});

describe('the tier-2 invariant', () => {
	it('holds when both tiers are current', () => {
		expect(L.syncEnabled(integration(), sync())).toBe(true);
	});

	// The whole point of two tiers: tier 2 can never authorise anything on its own.
	it.each([
		['tier 1 is off', integration({ enabled: false }), sync()],
		['tier 1 has a stale consent', integration({ consent: { version: 0, date: 'x' } }), sync()],
		['tier 1 has no consent', integration({ consent: null }), sync()],
		['tier 2 is off', integration(), sync({ enabled: false })],
		['tier 2 has a stale consent', integration(), sync({ consent: { version: 0, date: 'x' } })],
		['tier 2 has no consent', integration(), sync({ consent: null })],
	])('fails when %s', (_label, local, s) => {
		expect(L.syncEnabled(local, s)).toBe(false);
	});
});

describe('syncOrigin', () => {
	it('is production by default', () => {
		expect(L.syncOrigin(integration())).toBe('https://gestura.eu');
	});

	// One secret, one blob store. A developer testing against a local index must
	// not push states into production, and the panel says so.
	it('is the developer origin when one is configured', () => {
		expect(L.syncOrigin(integration({ devOrigin: 'http://localhost:8199' }))).toBe('http://localhost:8199');
	});

	it('ignores an invalid developer origin', () => {
		expect(L.syncOrigin(integration({ devOrigin: 'not an origin' }))).toBe('https://gestura.eu');
	});
});

describe('storage', () => {
	it('writes and reads back a patch', async () => {
		await L.write({ enabled: true, secret: 'GS1-X' });
		expect((await L.read()).euSync.enabled).toBe(true);
		expect((await L.read()).euSync.secret).toBe('GS1-X');
	});

	it('records a state and removes it again', async () => {
		await L.setState(ID, { name: 'Work', lastUploadHash: 'abc', lastUploadDate: '2026-09-03T10:00:00Z' });
		expect((await L.read()).euSync.states[ID].name).toBe('Work');
		await L.removeState(ID);
		expect((await L.read()).euSync.states).toEqual({});
	});

	it('merges into an existing state instead of replacing it', async () => {
		await L.setState(ID, { name: 'Work' });
		await L.setState(ID, { lastUploadHash: 'abc' });
		expect((await L.read()).euSync.states[ID]).toEqual({ name: 'Work', lastUploadHash: 'abc', lastUploadDate: '' });
	});
});

describe('when tier 1 goes away', () => {
	// A tier-2 consent that springs back to life the moment tier 1 is re-enabled
	// would be an authorisation nobody gave twice. The secret and the states stay -
	// they are local data and re-pairing should not cost the user their states.
	it('clears the tier-2 switch and consent but keeps the secret', async () => {
		await L.write(sync().euSync);
		tier1 = integration({ enabled: false, consent: null });
		for (const fn of tier1Listeners) await fn(tier1);
		const after = (await L.read()).euSync;
		expect(after.enabled).toBe(false);
		expect(after.consent).toBe(null);
		expect(after.secret).toMatch(/^GS1-/);
	});

	it('leaves everything alone while tier 1 is fine', async () => {
		await L.write(sync().euSync);
		for (const fn of tier1Listeners) await fn(integration());
		expect((await L.read()).euSync.enabled).toBe(true);
	});
});
