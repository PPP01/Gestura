import { describe, it, expect, vi } from 'vitest';

// The first test file in this suite that needs a chrome stub. js/eu-local.js is a
// classic script that calls load() at module scope and registers an onChanged
// listener there too, so the stub has to exist before the import — and the module
// memoises in closure state, so one import is one instance. Hence a single ordered
// sequence rather than independent cases with a beforeEach: once a read has
// succeeded, "not loaded yet" is no longer reachable through the public API.
const get = vi.fn(async () => ({}));
let onChangedListener = null;
globalThis.chrome = {
	storage: {
		local: { get, set: vi.fn(async () => { }) },
		onChanged: { addListener: (fn) => { onChangedListener = fn; } },
	},
};

// Queued before the import, so the load() inside the module body is the one that
// fails — and it fails the way an invalidated extension context fails: the call
// throws synchronously rather than returning a rejected promise.
get.mockImplementationOnce(() => { throw new Error('context invalidated'); });

await import('../js/eu-integration.js');
await import('../js/eu-local.js');
const LOCAL = globalThis.GesturaEuLocal;
const EU = globalThis.FlowMouseEuIntegration;

// Let the import-time load settle before asserting anything about it.
await new Promise(r => setTimeout(r, 0));

const ON = { enabled: true, consent: { version: EU.CURRENT_INTEGRATION_CONSENT, date: '2026-09-02T00:00:00Z' }, devOrigin: '' };
const OFF = { enabled: false, consent: null, devOrigin: '' };

describe('a failed load is retried, not memoised', () => {
	it('fails closed, retries, and only caches once a read succeeded', async () => {
		// A transient storage error must not become this context's answer for good.
		// The defaults say "off", so a memoised failure is indistinguishable from the
		// user having switched the integration off — and would stay that way until
		// the page was reloaded.
		expect(get).toHaveBeenCalledTimes(1);                          // the module's own load()
		expect(EU.effectiveEnabled(LOCAL.current())).toBe(false);      // failed closed

		// Second failure, the other shape: a rejected promise rather than a throw.
		get.mockRejectedValueOnce(new Error('storage unavailable'));
		expect(EU.effectiveEnabled(await LOCAL.read())).toBe(false);
		expect(get).toHaveBeenCalledTimes(2);                          // retried, not memoised

		get.mockResolvedValueOnce({ euIntegration: ON });
		expect(EU.effectiveEnabled(await LOCAL.read())).toBe(true);
		expect(get).toHaveBeenCalledTimes(3);

		// Now that a read succeeded it is cached: storage is not touched again.
		expect(EU.effectiveEnabled(await LOCAL.read())).toBe(true);
		expect(get).toHaveBeenCalledTimes(3);
	});
});

describe('the live cache', () => {
	it('current() is synchronous and follows storage.onChanged', () => {
		onChangedListener({ euIntegration: { newValue: OFF } }, 'local');
		expect(EU.effectiveEnabled(LOCAL.current())).toBe(false);
		onChangedListener({ euIntegration: { newValue: ON } }, 'local');
		expect(EU.effectiveEnabled(LOCAL.current())).toBe(true);
	});

	it('ignores a change in another storage area', () => {
		onChangedListener({ euIntegration: { newValue: OFF } }, 'sync');
		expect(EU.effectiveEnabled(LOCAL.current())).toBe(true);       // unchanged
	});

	it('normalizes whatever storage hands back', () => {
		onChangedListener({ euIntegration: { newValue: { enabled: 'yes', consent: { version: '1' }, devOrigin: 42 } } }, 'local');
		expect(LOCAL.current().euIntegration).toEqual(OFF);
		onChangedListener({ euIntegration: { newValue: ON } }, 'local');
	});

	it('notifies subscribers, and one that throws does not stop the others', () => {
		const seen = [];
		const off1 = LOCAL.onChange(() => { throw new Error('this must not break the next listener'); });
		const off2 = LOCAL.onChange((local) => seen.push(EU.effectiveEnabled(local)));
		onChangedListener({ euIntegration: { newValue: OFF } }, 'local');
		expect(seen).toEqual([false]);

		off1(); off2();
		onChangedListener({ euIntegration: { newValue: ON } }, 'local');
		expect(seen).toEqual([false]);                                  // unsubscribed
	});
});
