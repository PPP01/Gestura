import { describe, it, expect, beforeAll } from 'vitest';

let M, S, DEFAULTS;

beforeAll(async () => {
	// constants.js is a browser IIFE that assigns to window.GestureConstants -
	// the same shim tests/settings-defaults.test.mjs uses.
	globalThis.window = globalThis;
	await import('../js/constants.js');
	await import('../js/eu-integration.js');
	await import('../js/eu-settings-schema.js');
	await import('../js/settings-merge.js');
	M = globalThis.GesturaSettingsMerge;
	S = globalThis.GesturaSettingsSchema;
	DEFAULTS = globalThis.GestureConstants.DEFAULT_SETTINGS;
});

describe('MERGE_MAP', () => {
	// The guard of spec §4: three disjoint sets that together are DEFAULT_SETTINGS.
	// Of NEVER's three members only lastSyncTime is in DEFAULT_SETTINGS; the other
	// two are separate storage.local keys and never reach this loop.
	it('puts every key of DEFAULT_SETTINGS in exactly one of MERGE_MAP, DEVICE_LOCAL, NEVER', () => {
		for (const key of Object.keys(DEFAULTS)) {
			const n = [key in M.MERGE_MAP, M.DEVICE_LOCAL.includes(key), S.NEVER.has(key)].filter(Boolean).length;
			expect(n, `${key} is in ${n} sets`).toBe(1);
		}
	});

	it('names no key DEFAULT_SETTINGS does not have', () => {
		for (const key of Object.keys(M.MERGE_MAP)) expect(key in DEFAULTS, key).toBe(true);
		for (const key of M.DEVICE_LOCAL) expect(key in DEFAULTS, key).toBe(true);
	});

	it('names every fixed child of a container, and only those', () => {
		for (const [key, raw] of Object.entries(M.MERGE_MAP)) {
			const s = M.spec(raw);
			if (s.kind !== 'container') continue;
			expect(Object.keys(s.children).sort(), key).toEqual(Object.keys(DEFAULTS[key]).sort());
		}
	});

	it('uses only the five kinds plus container', () => {
		const walk = (raw) => {
			const s = M.spec(raw);
			expect(['scalar', 'record', 'keyed-list', 'set', 'order', 'container']).toContain(s.kind);
			if (s.kind === 'keyed-list') expect(typeof s.key).toBe('string');
			if (s.kind === 'order') expect(typeof s.of).toBe('string');
			if (s.both) expect(typeof s.idPrefix).toBe('string');
			if (s.kind === 'container') Object.values(s.children).forEach(walk);
		};
		Object.values(M.MERGE_MAP).forEach(walk);
	});

	it('does not offer Both for edited copies, overrides or drag gestures', () => {
		expect(M.spec(M.spec(M.MERGE_MAP.siteMenus).children.edited).both).toBeFalsy();
		expect(M.spec(M.spec(M.MERGE_MAP.searchEngines).children.overrides).both).toBeFalsy();
		expect(M.spec(M.MERGE_MAP.textDragGestures).both).toBeFalsy();
	});

	it('agrees with the schema on which keys are device-local', () => {
		expect([...M.DEVICE_LOCAL].sort()).toEqual([...S.DEVICE_LOCAL].sort());
	});
});

describe('deepEqual', () => {
	// The copy of settings-store.js's deepEqual (not exported there), pinned on
	// the cases the merge relies on.
	it('compares by value, not by reference', () => {
		expect(M.deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
	});
	it('tells arrays from objects and null from undefined', () => {
		expect(M.deepEqual([], {})).toBe(false);
		expect(M.deepEqual(null, undefined)).toBe(false);
		expect(M.deepEqual(undefined, undefined)).toBe(true);
		expect(M.deepEqual(null, null)).toBe(true);
	});
	it('sees a missing key', () => {
		expect(M.deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
		expect(M.deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
	});
});

// A settings object holding only what a test is about. merge() reads MERGE_MAP
// keys and treats a missing key as absent, so this is a complete input.
// `chains` is a bare record (usable from Task 2 on); `menus` sits inside the
// siteMenus container, whose `set` and `order` children exist from Task 3 on.
const chains = (custom) => ({ actionChains: custom });
const menus = (custom) => ({ siteMenus: { custom } });
const A = { name: 'A', items: [] };
const A1 = { name: 'A edited here', items: [] };
const A2 = { name: 'A edited there', items: [] };

describe('mergeEntry - the decision table of spec §5', () => {
	const t = (b, l, r) => M.mergeEntry(b, l, r);
	it('row 1: new over there -> taken', () => expect(t(undefined, undefined, A)).toEqual({ value: A, status: 'taken' }));
	it('row 2: new here -> uploaded', () => expect(t(undefined, A, undefined)).toEqual({ value: A, status: 'uploaded' }));
	it('row 3: only remote moved -> taken', () => expect(t(A, A, A2)).toEqual({ value: A2, status: 'taken' }));
	it('row 4: only local moved -> uploaded', () => expect(t(A, A1, A)).toEqual({ value: A1, status: 'uploaded' }));
	it('row 5: deleted over there -> deleted', () => expect(t(A, A, undefined)).toEqual({ value: undefined, status: 'deleted' }));
	it('row 6: deleted here -> stays deleted, and that is uploaded', () => expect(t(A, undefined, A)).toEqual({ value: undefined, status: 'uploaded' }));
	it('row 7: both moved -> conflict', () => expect(t(A, A1, A2).status).toBe('conflict'));
	it('row 8: deleted here, changed there -> conflict', () => expect(t(A, undefined, A2).status).toBe('conflict'));
	it('row 9: changed here, deleted there -> conflict', () => expect(t(A, A1, undefined).status).toBe('conflict'));
	it('row 10: both created the same id differently -> conflict', () => expect(t(undefined, A1, A2).status).toBe('conflict'));
	it('the trivial combinations are unchanged', () => {
		expect(t(A, A, A).status).toBe('unchanged');
		expect(t(undefined, A, A).status).toBe('unchanged');
		expect(t(A, A1, A1).status).toBe('unchanged');
		expect(t(A, undefined, undefined).status).toBe('unchanged');
	});
	it('compares by value, not by reference', () => {
		expect(t(A, { ...A }, { name: 'A', items: [] }).status).toBe('unchanged');
	});
	it('a conflict carries the local value', () => expect(t(A, A1, A2).value).toEqual(A1));
});

describe('merge - record entries', () => {
	it('takes a new remote entry without a question', () => {
		const m = M.merge(chains({}), chains({}), chains({ c1: A }));
		expect(m.result.actionChains).toEqual({ c1: A });
		expect(m.conflicts).toEqual([]);
		expect(m.summary.taken).toBe(1);
	});
	it('keeps a locally deleted entry deleted even though remote still has it', () => {
		const m = M.merge(chains({ c1: A }), chains({}), chains({ c1: A }));
		expect(m.result.actionChains).toEqual({});
		expect(m.summary.uploaded).toBe(1);
	});
	it('deletes here what was deleted over there', () => {
		const m = M.merge(chains({ c1: A, c2: A }), chains({ c1: A, c2: A }), chains({ c2: A }));
		expect(m.result.actionChains).toEqual({ c2: A });
		expect(m.summary).toEqual({ taken: 0, uploaded: 0, deleted: 1, unchanged: 1 });
	});
	it('reports one conflict per entry both sides changed, with path, id and both values', () => {
		const m = M.merge(chains({ c1: A }), chains({ c1: A1 }), chains({ c1: A2 }));
		expect(m.conflicts).toHaveLength(1);
		const c = m.conflicts[0];
		expect(c).toMatchObject({ path: 'actionChains', id: 'c1', kind: 'record', mine: A1, theirs: A2, canKeepBoth: true });
		expect(typeof c.key).toBe('string');
		expect(m.result.actionChains.c1).toEqual(A1);
	});
	it('does not offer Both when one side deleted', () => {
		const m = M.merge(chains({ c1: A }), chains({}), chains({ c1: A2 }));
		expect(m.conflicts[0].canKeepBoth).toBe(false);
		expect(m.conflicts[0].mine).toBeUndefined();
	});
	it('does not offer Both for a record without generated ids', () => {
		const g = (action) => ({ mouseGestures: { '←': { action } } });
		const m = M.merge(g('back'), g('newTab'), g('closeTab'));
		expect(m.conflicts[0]).toMatchObject({ path: 'mouseGestures', id: '←', canKeepBoth: false });
	});
	it('gives two conflicts with the same values the same key, and a changed theirs a new one', () => {
		const a = M.merge(chains({ c1: A }), chains({ c1: A1 }), chains({ c1: A2 })).conflicts[0].key;
		const b = M.merge(chains({ c1: A }), chains({ c1: A1 }), chains({ c1: { ...A2 } })).conflicts[0].key;
		const c = M.merge(chains({ c1: A }), chains({ c1: A1 }), chains({ c1: { name: 'A3', items: [] } })).conflicts[0].key;
		expect(a).toBe(b);
		expect(a).not.toBe(c);
	});
});

describe('merge - scalars and containers', () => {
	it('takes a one-sided scalar change silently and asks on a two-sided one', () => {
		const one = M.merge({ trailWidth: 5 }, { trailWidth: 5 }, { trailWidth: 8 });
		expect(one.result.trailWidth).toBe(8);
		expect(one.conflicts).toEqual([]);
		const two = M.merge({ trailWidth: 5 }, { trailWidth: 6 }, { trailWidth: 8 });
		expect(two.conflicts[0]).toMatchObject({ path: 'trailWidth', id: '', kind: 'scalar', mine: 6, theirs: 8, canKeepBoth: false });
		expect(two.result.trailWidth).toBe(6);
	});
	it('merges the fixed children of a container each on their own', () => {
		const b = { gestureTriggerButtons: { right: true, middle: false } };
		const l = { gestureTriggerButtons: { right: true, middle: true } };
		const r = { gestureTriggerButtons: { right: false, middle: false } };
		const m = M.merge(b, l, r);
		expect(m.result.gestureTriggerButtons).toEqual({ right: false, middle: true });
		expect(m.conflicts).toEqual([]);
	});
	it('merges an undeclared child of a container as a scalar', () => {
		const m = M.merge({ customMenuSwitcher: {} }, { customMenuSwitcher: {} }, { customMenuSwitcher: { futureKey: 1 } });
		expect(m.result.customMenuSwitcher).toEqual({ futureKey: 1 });
	});
	it('returns only MERGE_MAP keys, and no empty containers for keys nobody has', () => {
		const m = M.merge({}, { theme: 'dark', gesturaSettings: 1, _version: '1' }, { theme: 'light' });
		expect(Object.keys(m.result)).toEqual([]);
		expect(m.conflicts).toEqual([]);
		expect(m.summary).toEqual({ taken: 0, uploaded: 0, deleted: 0, unchanged: 0 });
	});
	it('counts the summary from what the result contains', () => {
		const m = M.merge(
			{ trailWidth: 5, hudBlurRadius: 5, customCss: '', actionChains: { c1: A } },
			{ trailWidth: 5, hudBlurRadius: 6, customCss: '', actionChains: { c1: A } },
			{ trailWidth: 8, hudBlurRadius: 5, customCss: '', actionChains: {} },
		);
		expect(m.summary).toEqual({ taken: 1, uploaded: 1, deleted: 1, unchanged: 1 });
		// taken: trailWidth · uploaded: hudBlurRadius · deleted: c1 · unchanged: customCss
	});
});

describe('merge - set', () => {
	const bl = (list) => ({ blacklist: list });
	it('keeps what was added on either side', () => {
		const m = M.merge(bl(['a.com']), bl(['a.com', 'b.com']), bl(['a.com', 'c.com']));
		expect(m.result.blacklist.sort()).toEqual(['a.com', 'b.com', 'c.com']);
		expect(m.conflicts).toEqual([]);
	});
	it('drops what was removed on either side, and what both removed', () => {
		const m = M.merge(bl(['a.com', 'b.com', 'c.com']), bl(['a.com', 'b.com']), bl(['a.com', 'c.com']));
		expect(m.result.blacklist).toEqual(['a.com']);
		const both = M.merge(bl(['a.com', 'b.com']), bl(['a.com']), bl(['a.com']));
		expect(both.result.blacklist).toEqual(['a.com']);
	});
	it('never reports a conflict for a set', () => {
		const m = M.merge(bl(['a.com']), bl(['b.com']), bl(['c.com']));
		expect(m.conflicts).toEqual([]);
		expect(m.result.blacklist.sort()).toEqual(['b.com', 'c.com']);
	});
	it('counts added-there as taken, added-here as uploaded, removed-there as deleted', () => {
		const m = M.merge(bl(['a.com']), bl(['a.com', 'b.com']), bl(['c.com']));
		expect(m.summary).toMatchObject({ taken: 1, uploaded: 1, deleted: 1 });
	});
	it('tolerates a set that is not an array', () => {
		expect(M.merge(bl(null), bl('x'), bl(['a.com'])).result.blacklist).toEqual(['a.com']);
	});
});

describe('merge - order', () => {
	const sm = (order, custom = {}) => ({ siteMenus: { order, custom } });
	it('keeps a local-only reorder when remote equals the base', () => {
		const m = M.merge(sm(['a', 'b', 'c']), sm(['c', 'a', 'b']), sm(['a', 'b', 'c']));
		expect(m.result.siteMenus.order).toEqual(['c', 'a', 'b']);
		expect(m.conflicts).toEqual([]);
	});
	it('takes a remote-only reorder', () => {
		const m = M.merge(sm(['a', 'b', 'c']), sm(['a', 'b', 'c']), sm(['b', 'c', 'a']));
		expect(m.result.siteMenus.order).toEqual(['b', 'c', 'a']);
	});
	it('lets remote win when both reordered, without a conflict', () => {
		const m = M.merge(sm(['a', 'b', 'c']), sm(['c', 'b', 'a']), sm(['b', 'a', 'c']));
		expect(m.result.siteMenus.order).toEqual(['b', 'a', 'c']);
		expect(m.conflicts).toEqual([]);
	});
	it('appends a local-only id at the end', () => {
		const m = M.merge(sm(['a', 'b']), sm(['a', 'b', 'menu_new'], { menu_new: A }), sm(['b', 'a']));
		expect(m.result.siteMenus.order).toEqual(['b', 'a', 'menu_new']);
	});
	it('drops an id whose custom entry the merge deleted, but never a catalogue id', () => {
		// `search` is a catalogue id: never in `custom`, so never dropped.
		const m = M.merge(
			sm(['search', 'menu_x'], { menu_x: A }),
			sm(['search', 'menu_x'], { menu_x: A }),
			sm(['search'], {}),
		);
		expect(m.result.siteMenus.custom).toEqual({});
		expect(m.result.siteMenus.order).toEqual(['search']);
	});
	it('drops an id deleted here that the untouched remote order still lists', () => {
		const m = M.merge(
			sm(['search', 'menu_x'], { menu_x: A }),
			sm(['search'], {}),
			sm(['search', 'menu_x'], { menu_x: A }),
		);
		expect(m.result.siteMenus.order).toEqual(['search']);
	});
	// searchEngines.custom is a keyed-list; idsOf's keyed-list branch (Task 3)
	// is what lets mergeOrder find the surviving ids here.
	it('works for the engine order against a keyed-list', () => {
		const se = (order, custom) => ({ searchEngines: { order, custom } });
		const e = { id: 'engine_x', name: 'X', url: 'https://x/?q=%s' };
		const m = M.merge(se(['google', 'engine_x'], [e]), se(['google', 'engine_x'], [e]), se(['google'], []));
		expect(m.result.searchEngines.order).toEqual(['google']);
	});
});

describe('merge - records inside the siteMenus container', () => {
	it('merges custom menus like any record, with Both on offer', () => {
		const m = M.merge(menus({ m1: A }), menus({ m1: A1 }), menus({ m1: A2 }));
		expect(m.conflicts[0]).toMatchObject({ path: 'siteMenus.custom', id: 'm1', kind: 'record', canKeepBoth: true });
		expect(m.result.siteMenus.custom.m1).toEqual(A1);
	});
	it('does not offer Both for an edited catalogue copy', () => {
		const m = M.merge({ siteMenus: { edited: {} } }, { siteMenus: { edited: { search: A1 } } }, { siteMenus: { edited: { search: A2 } } });
		expect(m.conflicts[0]).toMatchObject({ path: 'siteMenus.edited', id: 'search', canKeepBoth: false });
	});
	it('leaves a domain attached to a menu the other side deleted (spec §7: resolvers tolerate it)', () => {
		const b = { siteMenus: { custom: { m1: A }, domains: {} } };
		const l = { siteMenus: { custom: {}, domains: {} } };
		const r = { siteMenus: { custom: { m1: A }, domains: { m1: 'example.com' } } };
		const m = M.merge(b, l, r);
		expect(m.result.siteMenus.custom).toEqual({});
		expect(m.result.siteMenus.domains).toEqual({ m1: 'example.com' });
		expect(m.conflicts).toEqual([]);
	});
});

describe('merge - keyed-list', () => {
	const se = (custom) => ({ searchEngines: { custom } });
	const g = { id: 'engine_g', name: 'G', url: 'https://g/?q=%s' };
	const h = { id: 'engine_h', name: 'H', url: 'https://h/?q=%s' };
	const h1 = { ...h, name: 'H here' };
	const h2 = { ...h, name: 'H there' };

	it('identifies items by id, not by array position', () => {
		// h moved to index 0 on the remote side and was edited there; index-based
		// identity would compare g with h.
		const m = M.merge(se([g, h]), se([g, h]), se([h2, g]));
		expect(m.result.searchEngines.custom).toEqual([h2, g]);
		expect(m.conflicts).toEqual([]);
		expect(m.summary.taken).toBe(1);
	});
	it('keeps a local edit when remote only reordered', () => {
		const m = M.merge(se([g, h]), se([h1, g]), se([h, g]));
		expect(m.result.searchEngines.custom).toEqual([h1, g]);
		expect(m.summary.uploaded).toBe(1);
	});
	it('writes remote items first and appends local-only ones', () => {
		const x = { id: 'engine_x', name: 'X', url: 'https://x/?q=%s' };
		const m = M.merge(se([g]), se([g, x]), se([h, g]));
		expect(m.result.searchEngines.custom.map(e => e.id)).toEqual(['engine_h', 'engine_g', 'engine_x']);
	});
	it('reports a conflict with kind keyed-list and offers Both for custom engines', () => {
		const m = M.merge(se([h]), se([h1]), se([h2]));
		expect(m.conflicts[0]).toMatchObject({ path: 'searchEngines.custom', id: 'engine_h', kind: 'keyed-list', mine: h1, theirs: h2, canKeepBoth: true });
		expect(m.result.searchEngines.custom).toEqual([h1]);
	});
	it('does not offer Both for a drag gesture (fixed key)', () => {
		const d = (action) => ({ textDragGestures: [{ direction: '→', action }] });
		const m = M.merge(d('search'), d('copy'), d('openTab'));
		expect(m.conflicts[0]).toMatchObject({ path: 'textDragGestures', id: '→', canKeepBoth: false });
	});
	it('ignores an item without the key field', () => {
		const m = M.merge(se([]), se([{ name: 'no id' }]), se([g]));
		expect(m.result.searchEngines.custom).toEqual([g]);
	});
});
