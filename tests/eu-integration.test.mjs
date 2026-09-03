import { describe, it, expect } from 'vitest';
import '../js/eu-integration.js';
const EU = globalThis.FlowMouseEuIntegration;

const on = (over = {}) => ({ euIntegration: { enabled: true, consent: { version: EU.CURRENT_INTEGRATION_CONSENT, date: '2026-09-02T00:00:00Z' }, devOrigin: '', ...over } });

describe('normalizeLocal', () => {
	it('fills defaults for an empty store', () => {
		expect(EU.normalizeLocal({})).toEqual({ euIntegration: { enabled: false, consent: null, devOrigin: '' } });
		expect(EU.normalizeLocal(undefined)).toEqual(EU.LOCAL_DEFAULTS);
	});
	it('drops garbage shapes', () => {
		const n = EU.normalizeLocal({ euIntegration: { enabled: 'yes', consent: { version: '1' }, devOrigin: 42 } });
		expect(n.euIntegration).toEqual({ enabled: false, consent: null, devOrigin: '' });
	});
	it('keeps a well-formed consent', () => {
		const n = EU.normalizeLocal(on());
		expect(n.euIntegration.consent).toEqual({ version: 2, date: '2026-09-02T00:00:00Z' });
	});
});

describe('API_LEVEL', () => {
	it('announces the level the update endpoint belongs to', () => {
		expect(EU.API_LEVEL).toBe(2);
		expect(EU.helloAnswer({ requestId: 'r' }, '2.8.0')).toEqual({ requestId: 'r', version: '2.8.0', apiLevel: 2 });
	});
});

describe('effectiveEnabled', () => {
	it('is off by default', () => { expect(EU.effectiveEnabled(EU.normalizeLocal({}))).toBe(false); });
	it('is on with enabled + current consent', () => { expect(EU.effectiveEnabled(on())).toBe(true); });
	it('a stale consent version authorizes nothing', () => {
		expect(EU.effectiveEnabled(on({ consent: { version: EU.CURRENT_INTEGRATION_CONSENT - 1, date: 'x' } }))).toBe(false);
	});
	it('enabled without consent is off', () => { expect(EU.effectiveEnabled(on({ consent: null }))).toBe(false); });
	it('consent without enabled is off', () => { expect(EU.effectiveEnabled(on({ enabled: false }))).toBe(false); });
});

describe('isValidDevOrigin', () => {
	it.each([
		['https://index.example', true],
		['http://localhost:5173', true],
		['http://127.0.0.1:8080', true],
		['http://localhost', true],
		['http://localhost.attacker.com', false],
		['http://index.example', false],
		['https://index.example/', false],
		['https://index.example/path', false],
		['index.example', false],
		['', false],
		['javascript:alert(1)', false],
	])('%s → %s', (input, ok) => { expect(EU.isValidDevOrigin(input)).toBe(ok); });
});

describe('allowedOrigins / qualifiedOrigin', () => {
	it('production only when no dev origin is set', () => {
		expect(EU.allowedOrigins(on())).toEqual(['https://gestura.eu']);
	});
	it('adds a valid dev origin, ignores an invalid one', () => {
		expect(EU.allowedOrigins(on({ devOrigin: 'http://localhost:5173' }))).toEqual(['https://gestura.eu', 'http://localhost:5173']);
		expect(EU.allowedOrigins(on({ devOrigin: 'http://evil.example' }))).toEqual(['https://gestura.eu']);
	});
	it('qualifiedOrigin judges the final URL, path and query ignored', () => {
		const local = on({ devOrigin: 'http://localhost:5173' });
		expect(EU.qualifiedOrigin('https://gestura.eu/de/index/foo.json?x=1', local)).toBe('https://gestura.eu');
		expect(EU.qualifiedOrigin('http://localhost:5173/api/bundle', local)).toBe('http://localhost:5173');
		expect(EU.qualifiedOrigin('https://cdn.gestura.eu/foo.json', local)).toBe(null);
		expect(EU.qualifiedOrigin('not a url', local)).toBe(null);
		expect(EU.qualifiedOrigin('', local)).toBe(null);
	});
	it('allowed origins do not depend on the switch', () => {
		expect(EU.qualifiedOrigin('https://gestura.eu/x', EU.normalizeLocal({}))).toBe('https://gestura.eu');
	});
});

describe('handOffAllowed', () => {
	it('needs the switch AND an allowed origin', () => {
		expect(EU.handOffAllowed('https://gestura.eu/de/index', on())).toBe(true);
		// The switch alone is not a permission: this is what keeps a third-party
		// operator button from working until it gets its own opt-in.
		expect(EU.handOffAllowed('https://shop.example/menu', on())).toBe(false);
		// An allowed origin alone is not one either.
		expect(EU.handOffAllowed('https://gestura.eu/de/index', EU.normalizeLocal({}))).toBe(false);
		expect(EU.handOffAllowed('https://gestura.eu/de/index', on({ consent: null }))).toBe(false);
	});
	it('covers the configured developer origin, and only it', () => {
		const local = on({ devOrigin: 'http://localhost:5173' });
		expect(EU.handOffAllowed('http://localhost:5173/de/index', local)).toBe(true);
		expect(EU.handOffAllowed('http://localhost:5174/de/index', local)).toBe(false);
		// An invalid dev origin grants nothing, even when it matches the page.
		expect(EU.handOffAllowed('http://evil.example/x', on({ devOrigin: 'http://evil.example' }))).toBe(false);
	});
	it('a subdomain or a lookalike host is not the origin', () => {
		expect(EU.handOffAllowed('https://cdn.gestura.eu/x', on())).toBe(false);
		expect(EU.handOffAllowed('http://gestura.eu/x', on())).toBe(false);
		expect(EU.handOffAllowed('https://gestura.eu.evil.example/x', on())).toBe(false);
	});
	it('refuses anything that is not a URL', () => {
		expect(EU.handOffAllowed('', on())).toBe(false);
		expect(EU.handOffAllowed('not a url', on())).toBe(false);
		expect(EU.handOffAllowed(undefined, on())).toBe(false);
	});
});

describe('canonicalize', () => {
	it('sorts keys recursively and strips whitespace', () => {
		expect(EU.canonicalize({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}');
	});
	it('drops undefined properties, keeps null', () => {
		expect(EU.canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
		expect(EU.canonicalize({ b: null })).toBe(EU.canonicalize({ a: undefined, b: null }));
	});
	it('undefined inside arrays becomes null, like JSON.stringify', () => {
		expect(EU.canonicalize([1, undefined, 2])).toBe('[1,null,2]');
	});
	it('scalars round-trip', () => {
		expect(EU.canonicalize('a"b')).toBe('"a\\"b"');
		expect(EU.canonicalize(3)).toBe('3');
		expect(EU.canonicalize(true)).toBe('true');
		expect(EU.canonicalize(null)).toBe('null');
	});
});

describe('baselineHash / modifiedState', () => {
	const stored = { name: 'Shop', icon: 'cart', patterns: ['*example.com*'], items: [], source: { type: 'site', indexId: 'com.example.shop', indexOrigin: 'https://gestura.eu', version: '1.0.0' } };

	it('hash is 16 lowercase hex chars and deterministic', async () => {
		const h = await EU.baselineHash(stored);
		expect(h).toMatch(/^[0-9a-f]{16}$/);
		expect(await EU.baselineHash(JSON.parse(JSON.stringify(stored)))).toBe(h);
	});
	it('ignores the source object and key order', async () => {
		const reordered = { source: { indexId: 'other', type: 'file' }, items: [], patterns: ['*example.com*'], icon: 'cart', name: 'Shop' };
		expect(await EU.baselineHash(reordered)).toBe(await EU.baselineHash(stored));
	});
	it('changes when content changes', async () => {
		expect(await EU.baselineHash({ ...stored, name: 'Shop 2' })).not.toBe(await EU.baselineHash(stored));
	});
	it('modifiedState: unknown without baseline, false when equal, true when changed', async () => {
		expect(await EU.modifiedState(stored)).toBe('unknown');
		const base = await EU.baselineHash(stored);
		const withBase = { ...stored, source: { ...stored.source, baselineHash: base } };
		expect(await EU.modifiedState(withBase)).toBe(false);
		expect(await EU.modifiedState({ ...withBase, name: 'edited' })).toBe(true);
	});
});
