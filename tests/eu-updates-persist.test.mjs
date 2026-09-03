import { describe, it, expect, beforeEach } from 'vitest';

// persist() is the only writer of the euUpdates key, and it is the one place
// where a withdrawal can race a finished run. It needs both chrome.storage and
// GesturaEuLocal, so it gets its own file with its own stubs - tests/eu-local.test.mjs
// established that pattern, and the stubs have to exist before the import.

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

// A stand-in for js/eu-local.js: only what eu-updates.js actually calls.
let localState;
globalThis.GesturaEuLocal = {
	read: async () => localState,
	current: () => localState,
	onChange: () => () => {},
};

await import('../js/eu-integration.js');
await import('../js/eu-updates.js');
const EU = globalThis.FlowMouseEuIntegration;
const U = globalThis.GesturaEuUpdates;

const PROD = 'https://gestura.eu';
const enabled = () => ({
	euIntegration: {
		enabled: true,
		consent: { version: EU.CURRENT_INTEGRATION_CONSENT, date: '2026-09-02T00:00:00Z' },
		devOrigin: '',
	},
});
const slot = { origin: PROD, checkedAt: '2026-09-02T12:00:00Z', results: [{ id: 'a', type: 'menu', version: '9.9.9', url: PROD + '/a' }] };

beforeEach(() => {
	store.clear();
	localState = enabled();
});

describe('persist', () => {
	it('writes a slot while the integration is on', async () => {
		expect(await U.persist([slot])).toBe(true);
		expect(store.get('euUpdates').origins.map(o => o.origin)).toEqual([PROD]);
	});

	it('writes nothing when the integration is already off', async () => {
		localState = { euIntegration: { enabled: false, consent: null, devOrigin: '' } };
		expect(await U.persist([slot])).toBe(false);
		expect(store.has('euUpdates')).toBe(false);
	});

	it('writes nothing when the result would not change the cache', async () => {
		await U.persist([slot]);
		expect(await U.persist([slot])).toBe(false);
	});

	// The race the second review found: the consent check happens, then read()
	// yields to the event loop, and a withdrawal lands in that gap. Without a
	// second look the finished run writes the slot the withdrawal just deleted -
	// and PRIVACY.md promises the opposite.
	it('does not revive the cache when a withdrawal lands mid-persist', async () => {
		const realGet = chrome.storage.local.get;
		chrome.storage.local.get = async (key) => {
			// Exactly the gap: persist() has passed its consent check and is now
			// reading the cache. The user hits Withdraw.
			chrome.storage.local.get = realGet;
			localState = { euIntegration: { enabled: false, consent: null, devOrigin: '' } };
			await U.clear();
			return realGet(key);
		};
		const wrote = await U.persist([slot]);
		expect(wrote).toBe(false);
		expect(store.has('euUpdates')).toBe(false);
	});

	// Same gap, but the integration stays on and only the developer origin goes
	// away - the slot for it must not come back either.
	it('does not revive a slot whose origin was dropped mid-persist', async () => {
		const DEV = 'http://localhost:8199';
		localState = { euIntegration: { ...enabled().euIntegration, devOrigin: DEV } };
		const devSlot = { origin: DEV, checkedAt: '2026-09-02T12:00:00Z', results: [] };
		const realGet = chrome.storage.local.get;
		chrome.storage.local.get = async (key) => {
			chrome.storage.local.get = realGet;
			localState = enabled();  // devOrigin back to ''
			return realGet(key);
		};
		await U.persist([devSlot]);
		const cached = store.get('euUpdates');
		expect(cached ? cached.origins.map(o => o.origin) : []).not.toContain(DEV);
	});
});
