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
