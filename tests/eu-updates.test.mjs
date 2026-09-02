import { describe, it, expect } from 'vitest';
import '../js/eu-integration.js';
import '../js/eu-updates.js';
const EU = globalThis.FlowMouseEuIntegration;
const U = globalThis.GesturaEuUpdates;

const PROD = 'https://gestura.eu';
const DEV = 'http://localhost:8123';

const local = (over = {}) => ({
	euIntegration: {
		enabled: true,
		consent: { version: EU.CURRENT_INTEGRATION_CONSENT, date: '2026-09-02T00:00:00Z' },
		devOrigin: '',
		...over,
	},
});

// A menu, an engine override and a file import, so grouping has something to
// leave out as well as something to include.
const settings = () => ({
	siteMenus: {
		custom: {
			m1: { name: 'Shop', source: { type: 'site', indexId: 'eu.example.shop', indexOrigin: PROD, version: '1.2.0' } },
			m2: { name: 'From a file', source: { type: 'file', indexId: 'eu.example.shop', version: '1.0.0' } },
			m3: { name: 'Dev', source: { type: 'site', indexId: 'eu.example.dev', indexOrigin: DEV, version: '0.1.0' } },
		},
		edited: {},
	},
	searchEngines: {
		custom: [],
		overrides: {
			google: { name: 'G', source: { type: 'site', indexId: 'eu.example.search', indexOrigin: PROD, version: null } },
		},
	},
});

describe('updateRequestGroups', () => {
	it('groups qualified entries by origin and leaves file imports out', () => {
		const groups = U.updateRequestGroups(settings(), local({ devOrigin: DEV }));
		expect(groups.map(g => g.origin).sort()).toEqual([DEV, PROD]);
		const prod = groups.find(g => g.origin === PROD);
		// The body carries id and version only - the kind stays local.
		expect(prod.entries).toEqual([
			{ id: 'eu.example.shop', version: '1.2.0' },
			{ id: 'eu.example.search', version: null },
		]);
		expect([...prod.kinds]).toEqual([['eu.example.shop', 'menu'], ['eu.example.search', 'engine']]);
	});

	it('drops an origin that is no longer allowed', () => {
		const groups = U.updateRequestGroups(settings(), local({ devOrigin: '' }));
		expect(groups.map(g => g.origin)).toEqual([PROD]);
	});

	it('asks about a shared id once per origin', () => {
		const s = settings();
		s.siteMenus.edited = { m4: { name: 'Dup', source: { type: 'site', indexId: 'eu.example.shop', indexOrigin: PROD, version: '1.2.0' } } };
		const prod = U.updateRequestGroups(s, local()).find(g => g.origin === PROD);
		expect(prod.entries.filter(e => e.id === 'eu.example.shop')).toHaveLength(1);
	});
});

describe('dueOrigins', () => {
	const groups = [{ origin: PROD, entries: [] }];
	const at = (iso) => ({ origins: [{ origin: PROD, checkedAt: iso, results: [] }] });
	const now = Date.parse('2026-09-02T12:00:00Z');

	it('an origin never checked is due', () => {
		expect(U.dueOrigins({ origins: [] }, groups, now)).toHaveLength(1);
	});
	it('within the window it is not', () => {
		expect(U.dueOrigins(at('2026-09-02T06:00:00Z'), groups, now)).toHaveLength(0);
	});
	it('past the window it is again', () => {
		expect(U.dueOrigins(at('2026-09-01T11:00:00Z'), groups, now)).toHaveLength(1);
	});
	it('an unparseable or future timestamp does not lock the check out', () => {
		expect(U.dueOrigins(at('not a date'), groups, now)).toHaveLength(1);
		expect(U.dueOrigins(at('2027-01-01T00:00:00Z'), groups, now)).toHaveLength(1);
	});
});

describe('parseUpdateResponse', () => {
	const asked = new Map([['eu.example.shop', 'menu'], ['eu.example.search', 'engine']]);
	const body = (updates) => JSON.stringify({ apiLevel: 2, updates });
	const one = {
		id: 'eu.example.shop', type: 'menu', version: '1.3.0',
		url: PROD + '/api/v1/menus/eu.example.shop/1.3.0',
	};

	it('keeps a well-formed result', () => {
		expect(U.parseUpdateResponse(body([one]), PROD, asked).results).toEqual([one]);
	});
	it('an empty answer is valid and empty', () => {
		expect(U.parseUpdateResponse(body([]), PROD, asked)).toEqual({ results: [] });
	});
	it.each([
		['not json', 'nope'],
		['an array at the top level', '[]'],
		['a missing updates field', JSON.stringify({ apiLevel: 2 })],
		['a non-array updates field', JSON.stringify({ updates: {} })],
	])('rejects the whole answer: %s', (_label, text) => {
		expect(U.parseUpdateResponse(text, PROD, asked)).toBeNull();
	});
	it('rejects a body over the byte cap', () => {
		const huge = body([{ ...one, changelog: 'x'.repeat(300 * 1024) }]);
		expect(U.parseUpdateResponse(huge, PROD, asked)).toBeNull();
	});
	it.each([
		['an id nobody asked about', { ...one, id: 'eu.other.thing' }],
		['an unknown type', { ...one, type: 'bookmark' }],
		['the wrong type for the id that was asked', { ...one, type: 'engine' }],
		['a missing version', { ...one, version: undefined }],
		['a version that is not a numeric triple', { ...one, version: '1.3' }],
		['a url on another origin', { ...one, url: 'https://evil.example/x.json' }],
		['an unparseable url', { ...one, url: 'not a url' }],
	])('drops just the element: %s', (_label, bad) => {
		expect(U.parseUpdateResponse(body([bad, one]), PROD, asked).results).toEqual([one]);
	});
	it('drops a repeated id', () => {
		expect(U.parseUpdateResponse(body([one, one]), PROD, asked).results).toEqual([one]);
	});
	it('truncates the changelog and keeps deprecation', () => {
		const r = U.parseUpdateResponse(body([{ ...one, changelog: 'y'.repeat(2000), deprecated: true, successor: 'eu.example.new' }]), PROD, asked).results[0];
		expect(r.changelog).toHaveLength(U.LIMITS.changelogMax);
		expect(r.deprecated).toBe(true);
		expect(r.successor).toBe('eu.example.new');
	});
});

describe('mergeSlot, dropOrigin, pruneOrigins', () => {
	const seed = {
		origins: [
			{ origin: PROD, checkedAt: '2026-09-01T00:00:00Z', results: [{ id: 'a', type: 'menu', version: '2.0.0', url: PROD + '/a' }] },
			{ origin: DEV, checkedAt: '2026-09-01T00:00:00Z', results: [] },
		],
	};

	it('replaces only its own slot, in place', () => {
		const next = U.mergeSlot(seed, DEV, [{ id: 'b', type: 'menu', version: '3.0.0', url: DEV + '/b' }], '2026-09-02T00:00:00Z');
		expect(next.origins.map(s => s.origin)).toEqual([PROD, DEV]);
		expect(next.origins[0]).toEqual(seed.origins[0]);
		expect(next.origins[1].checkedAt).toBe('2026-09-02T00:00:00Z');
	});
	it('appends an origin it has never seen', () => {
		const next = U.mergeSlot({ origins: [] }, PROD, [], '2026-09-02T00:00:00Z');
		expect(next.origins).toHaveLength(1);
	});
	it('drops one origin and keeps the other', () => {
		expect(U.dropOrigin(seed, DEV).origins.map(s => s.origin)).toEqual([PROD]);
	});
	it('prunes every origin that is not allowed any more', () => {
		expect(U.pruneOrigins(seed, [PROD]).origins.map(s => s.origin)).toEqual([PROD]);
	});
});

describe('normalizeCache', () => {
	it('yields an empty cache for junk', () => {
		expect(U.normalizeCache(undefined)).toEqual({ origins: [] });
		expect(U.normalizeCache({ origins: 'nope' })).toEqual({ origins: [] });
	});
	it('drops slots without an origin and collapses duplicates', () => {
		const n = U.normalizeCache({ origins: [{ results: [] }, { origin: PROD }, { origin: PROD, checkedAt: 'x' }] });
		expect(n.origins).toEqual([{ origin: PROD, checkedAt: '', results: [] }]);
	});
});

describe('updateFor', () => {
	const cache = {
		origins: [{
			origin: PROD, checkedAt: '2026-09-02T00:00:00Z',
			results: [
				{ id: 'eu.example.shop', type: 'menu', version: '1.3.0', url: PROD + '/a' },
				{ id: 'eu.example.old', type: 'menu', version: '1.0.0', url: PROD + '/b', deprecated: true },
			],
		}],
	};
	const stored = (over) => ({ name: 'x', source: { type: 'site', indexOrigin: PROD, indexId: 'eu.example.shop', version: '1.2.0', ...over } });

	it('reports a newer version, marked adoptable', () => {
		const up = U.updateFor(cache, stored());
		expect(up.version).toBe('1.3.0');
		expect(up.newer).toBe(true);
	});
	it('a retirement at the version the user already has is not adoptable', () => {
		const s = { source: { indexOrigin: PROD, indexId: 'eu.example.old', version: '1.0.0' } };
		expect(U.updateFor(cache, s).newer).toBe(false);
	});
	it('a retirement with one last version stays adoptable', () => {
		const s = { source: { indexOrigin: PROD, indexId: 'eu.example.old', version: '0.9.0' } };
		const up = U.updateFor(cache, s);
		expect(up.deprecated).toBe(true);
		expect(up.newer).toBe(true);
	});
	it('says nothing once the stored version has caught up', () => {
		expect(U.updateFor(cache, stored({ version: '1.3.0' }))).toBeNull();
	});
	it('never offers a downgrade after a manual import of something newer', () => {
		// The cache still announces 1.3.0; the user has since imported 1.4.0 by
		// hand. "Different" would offer 1.3.0 as an update - a downgrade.
		expect(U.updateFor(cache, stored({ version: '1.4.0' }))).toBeNull();
	});
	it('names the origin the entry came from, for the adopt path to check', () => {
		expect(U.updateFor(cache, stored()).origin).toBe(PROD);
	});
	it('reports a deprecation even at the same version', () => {
		const s = { source: { indexOrigin: PROD, indexId: 'eu.example.old', version: '1.0.0' } };
		expect(U.updateFor(cache, s).deprecated).toBe(true);
	});
	it('says nothing for a file import, whatever its id', () => {
		expect(U.updateFor(cache, { source: { indexId: 'eu.example.shop', version: '1.0.0' } })).toBeNull();
	});
	it('says nothing for the same id from another origin', () => {
		expect(U.updateFor(cache, stored({ indexOrigin: DEV }))).toBeNull();
	});
	it('says nothing for an entry with no provenance at all', () => {
		expect(U.updateFor(cache, { name: 'x' })).toBeNull();
	});
});
