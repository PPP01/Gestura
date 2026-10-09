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
	await L.write({ enabled: false, consent: null, secret: '', states: {}, activeState: '' });
});

describe('normalizeSync', () => {
	it('answers the defaults for an empty store', () => {
		expect(L.normalizeSync({}).euSync).toEqual({ enabled: false, consent: null, secret: '', states: {}, activeState: '' });
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

describe('the active state', () => {
	it('is the state this browser last uploaded to, adopted or merged', async () => {
		await L.setState(ID, { name: 'Work' }, { activate: true });
		expect((await L.read()).euSync.activeState).toBe(ID);
	});

	it('is left alone by a write that does not name it', async () => {
		await L.setState(ID, { name: 'Work' }, { activate: true });
		await L.setState('fedcba9876543210fedcba9876543210', { name: 'Other' });
		expect((await L.read()).euSync.activeState).toBe(ID);
	});

	it('goes with the state when that is removed, but not with another one', async () => {
		const OTHER = 'fedcba9876543210fedcba9876543210';
		await L.setState(ID, { name: 'Work' }, { activate: true });
		await L.setState(OTHER, { name: 'Other' });
		await L.removeState(OTHER);
		expect((await L.read()).euSync.activeState).toBe(ID);
		await L.removeState(ID);
		expect((await L.read()).euSync.activeState).toBe('');
	});

	it('is dropped by normalisation unless it is one of the recorded states', () => {
		expect(L.normalizeSync({ euSync: { activeState: 'nope', states: { nope: {} } } }).euSync.activeState).toBe('');
		expect(L.normalizeSync({ euSync: { activeState: ID } }).euSync.activeState).toBe('');
		expect(L.normalizeSync({ euSync: { activeState: ID, states: { [ID]: {} } } }).euSync.activeState).toBe(ID);
	});

	it('goes when every state is cleared in one write, as deleting all or pairing a new code does', async () => {
		await L.setState(ID, { name: 'Work' }, { activate: true });
		await L.write({ states: {} });
		expect((await L.read()).euSync.activeState).toBe('');
	});
});

describe('the sync switch', () => {
	it('holds with its own current consent', () => {
		expect(L.syncEnabled(sync())).toBe(true);
	});

	it.each([
		['it is off', sync({ enabled: false })],
		['its consent is of an older version', sync({ consent: { version: 0, date: 'x' } })],
		['it has no consent', sync({ consent: null })],
	])('fails when %s', (_label, s) => {
		expect(L.syncEnabled(s)).toBe(false);
	});

	// Sync is its own feature with its own consent. It does not need the
	// integration: no page hands anything over, no update check runs for it.
	// Coupling the two switched sync off, without a word, whenever the
	// integration was turned off.
	it('does not depend on the integration at all', () => {
		expect(L.syncEnabled(sync())).toBe(true);
		expect(L.syncEnabled.length).toBe(1);
	});

	// The panel shows a reconfirm row for exactly the consents syncEnabled()
	// refuses - so the same function has to say which those are.
	it.each([
		['no consent', sync({ consent: null }), false],
		['a current consent', sync(), false],
		['a consent of an older version', sync({ consent: { version: 0, date: 'x' } }), true],
	])('calls %s stale: %s', (_label, s, stale) => {
		expect(L.syncConsentStale(s)).toBe(stale);
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

	// The developer origin names which gestura.eu instance this browser talks
	// to; it is not a permission. Sync follows it whether the integration is on
	// or off - switching the integration must not move sync to another server.
	it('follows the developer origin whether the integration is on or off', () => {
		const off = integration({ enabled: false, consent: null, devOrigin: 'http://localhost:8199' });
		expect(L.syncOrigin(off)).toBe('http://localhost:8199');
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

describe('when the integration goes away', () => {
	// Turning the integration off must not touch sync: different feature,
	// different consent. It used to clear the sync switch and consent at once.
	it('leaves the sync switch, consent and secret as they are', async () => {
		await L.write(sync().euSync);
		tier1 = integration({ enabled: false, consent: null });
		for (const fn of tier1Listeners) await fn(tier1);
		const after = (await L.read()).euSync;
		expect(after.enabled).toBe(true);
		expect(after.consent).not.toBe(null);
		expect(after.secret).toMatch(/^GS1-/);
		expect(L.syncEnabled({ euSync: after })).toBe(true);
	});
});

describe('readFresh', () => {
	it('sees a write the cache has not heard of yet', async () => {
		await L.write({ enabled: false, secret: 'GS1-A' });
		// Behind the module's back, as another tab whose onChanged has not arrived.
		await chrome.storage.local.set({ [L.KEY]: { ...(await L.read()).euSync, secret: 'GS1-B' } });
		expect((await L.read()).euSync.secret).toBe('GS1-A');     // the cache, as documented
		expect((await L.readFresh()).euSync.secret).toBe('GS1-B');
		expect((await L.read()).euSync.secret).toBe('GS1-B');     // and absorbed
	});
});
