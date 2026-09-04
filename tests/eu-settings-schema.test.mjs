import { describe, it, expect, beforeAll } from 'vitest';

let S, DEFAULTS;

beforeAll(async () => {
	// constants.js is a browser IIFE that assigns to window.GestureConstants -
	// the same shim tests/settings-defaults.test.mjs uses.
	globalThis.window = globalThis;
	await import('../js/constants.js');
	await import('../js/eu-integration.js');
	await import('../js/eu-settings-schema.js');
	S = globalThis.GesturaSettingsSchema;
	DEFAULTS = globalThis.GestureConstants.DEFAULT_SETTINGS;
});

const settings = () => ({ ...structuredClone(DEFAULTS), theme: 'dark', trailWidth: 9 });

describe('export', () => {
	it('carries the format version and the extension version', () => {
		const out = S.buildExport(settings(), '2.8.0');
		expect(out.gesturaSettings).toBe(1);
		expect(out._version).toBe('2.8.0');
	});

	it('never exports the local-only keys', () => {
		const out = S.buildExport({ ...settings(), euIntegration: { enabled: true }, euSync: { secret: 'x' } }, '2.8.0');
		expect(out).not.toHaveProperty('euIntegration');
		expect(out).not.toHaveProperty('euSync');
	});

	// It changes on every save and means nothing in another browser. Carrying it
	// would also make the "changed since last upload" hint fire after a save that
	// changed nothing else.
	it('does not export lastSyncTime', () => {
		expect(S.buildExport({ ...settings(), lastSyncTime: '2026-09-03T00:00:00Z' }, '2.8.0'))
			.not.toHaveProperty('lastSyncTime');
	});

	it('round-trips through the validator unchanged', () => {
		const before = settings();
		const res = S.validate(S.exportText(before, '2.8.0'));
		expect(res.ok).toBe(true);
		expect(res.dropped).toEqual([]);
		expect(res.settings.theme).toBe('dark');
		expect(res.settings.trailWidth).toBe(9);
	});

	// What leaves the browser - file export, sync upload - is validated like
	// what enters it, and the object that is written or hashed is the very one
	// the preview text was made of.
	it('validatedExport hands back the object its preview text is made of', () => {
		const res = S.validatedExport(settings(), '2.8.0');
		expect(res.ok).toBe(true);
		expect(res.exportObj.gesturaSettings).toBe(1);
		expect(res.exportObj._version).toBe('2.8.0');
		expect(JSON.stringify(res.exportObj, null, 2)).toBe(res.json);
	});

	it('validatedExport repairs a malformed container and names it', () => {
		const res = S.validatedExport({ ...settings(), searchEngines: { ...DEFAULTS.searchEngines, custom: {} } }, '2.8.0');
		expect(res.retyped).toEqual(['searchEngines.custom']);
		expect(res.exportObj.searchEngines.custom).toEqual([]);
	});

	// The hash path needs the object, never the text - and the text is the
	// single most expensive thing the validator produces.
	it('validatedExport can leave the preview text out', () => {
		const res = S.validatedExport(settings(), '2.8.0', { json: false });
		expect(res.ok).toBe(true);
		expect(res.json).toBe('');
		expect(res.exportObj.theme).toBe('dark');
	});
});

describe('validation', () => {
	it('accepts the current format', () => {
		const res = S.validate({ gesturaSettings: 1, theme: 'dark' });
		expect(res.ok).toBe(true);
		expect(res.legacy).toBe(false);
		expect(res.settings.theme).toBe('dark');
	});

	it('fills every key it was not given from the defaults', () => {
		const res = S.validate({ gesturaSettings: 1, theme: 'dark' });
		expect(res.settings.trailWidth).toBe(DEFAULTS.trailWidth);
		expect(Object.keys(res.settings).sort()).toEqual(Object.keys(DEFAULTS).sort());
	});

	it('refuses an unknown format version instead of guessing', () => {
		expect(S.validate({ gesturaSettings: 2, theme: 'dark' }))
			.toMatchObject({ ok: false, error: 'unknown-format' });
	});

	it('refuses text that is not JSON', () => {
		expect(S.validate('{ not json')).toMatchObject({ ok: false, error: 'not-json' });
	});

	it.each([['an array', '[]'], ['a number', '42'], ['null', 'null']])
		('refuses %s at the top level', (_label, text) => {
			expect(S.validate(text)).toMatchObject({ ok: false, error: 'not-object' });
		});

	it('refuses a file that holds no settings at all', () => {
		expect(S.validate({ gesturaSettings: 1, nothing: 'here' }))
			.toMatchObject({ ok: false, error: 'not-settings' });
	});

	// JSON.parse is iterative and accepts any depth under the size cap. Settings
	// are a few levels deep; a file far beyond that is refused by an explicit
	// limit - not by whatever RangeError the engine's stack happens to throw,
	// which would escape the import as an unhandled rejection.
	it('refuses a file nested deeper than the limit', () => {
		const depth = 60000;
		const text = '{"a":'.repeat(depth) + '1' + '}'.repeat(depth);
		expect(new TextEncoder().encode(text).length).toBeLessThan(S.MAX_BYTES);
		expect(S.validate(text)).toMatchObject({ ok: false, error: 'not-settings' });
	});

	it('accepts a file at the limit', () => {
		const nest = (n) => (n ? { a: nest(n - 1) } : 1);
		const res = S.validate({ gesturaSettings: 1, theme: 'dark', deep: nest(S.MAX_DEPTH - 1) });
		expect(res.ok).toBe(true);
		expect(res.dropped).toEqual(['deep']);
	});

	it('refuses text above the size cap', () => {
		const big = JSON.stringify({ gesturaSettings: 1, theme: 'x'.repeat(S.MAX_BYTES) });
		expect(S.validate(big)).toMatchObject({ ok: false, error: 'too-large' });
	});

	it('drops unknown top-level keys and names them', () => {
		const res = S.validate({ gesturaSettings: 1, theme: 'dark', evil: 1, alsoEvil: 2 });
		expect(res.ok).toBe(true);
		expect(res.settings).not.toHaveProperty('evil');
		expect(res.dropped).toEqual(['evil', 'alsoEvil']);
	});

	// A crafted file must not be able to turn the integration on, plant a secret,
	// or hand this browser somebody else's locator.
	// Skipped, not "dropped": dropped is what the preview calls "unknown to
	// Gestura", and these are keys Gestura itself defines. Saying it does not
	// know them would be false, and they are left out for a different reason.
	it('skips euIntegration and euSync in a crafted file without calling them unknown', () => {
		const res = S.validate({ gesturaSettings: 1, theme: 'dark', euIntegration: { enabled: true }, euSync: { secret: 'GS1-…' } });
		expect(res.settings).not.toHaveProperty('euIntegration');
		expect(res.settings).not.toHaveProperty('euSync');
		expect(res.dropped).toEqual([]);
	});

	// Every export the shipped version wrote is {...store.current, _version} and
	// so carries lastSyncTime. A warning on every one of those files would be a
	// warning about nothing.
	it('does not warn about lastSyncTime, which every older export carries', () => {
		const res = S.validate({ _version: '2.7.0', theme: 'dark', lastSyncTime: 1725000000000 });
		expect(res.ok).toBe(true);
		expect(res.dropped).toEqual([]);
		expect(res.settings.lastSyncTime).toBe(DEFAULTS.lastSyncTime);
	});

	it('falls back to the default when an allowlisted value has the wrong shape', () => {
		const res = S.validate({ gesturaSettings: 1, siteMenus: 'not an object', trailWidth: 7 });
		expect(res.ok).toBe(true);
		expect(res.settings.siteMenus).toEqual(DEFAULTS.siteMenus);
		expect(res.retyped).toEqual(['siteMenus']);
		expect(res.settings.trailWidth).toBe(7);
	});
});

// The container shapes inside the record keys. This is not tidiness: consumers
// iterate these. `for (const c of {})` throws, and engine-registry.js does
// exactly that over searchEngines.custom on every page load.
describe('the shapes inside a record key', () => {
	it.each([
		['searchEngines.custom as an object', 'searchEngines', { custom: {} }, 'custom'],
		['searchEngines.custom as a string', 'searchEngines', { custom: 'invalid' }, 'custom'],
		['searchEngines.hidden as an object', 'searchEngines', { hidden: {} }, 'hidden'],
		['searchEngines.order as an object', 'searchEngines', { order: {} }, 'order'],
		['searchEngines.overrides as an array', 'searchEngines', { overrides: [] }, 'overrides'],
		['siteMenus.custom as an array', 'siteMenus', { custom: [] }, 'custom'],
		['siteMenus.disabled as an object', 'siteMenus', { disabled: {} }, 'disabled'],
		['menuAppend.items as an object', 'menuAppend', { items: {} }, 'items'],
	])('repairs %s', (_label, key, value, child) => {
		const res = S.validate({ gesturaSettings: 1, [key]: value });
		expect(res.ok).toBe(true);
		expect(res.settings[key][child]).toEqual(DEFAULTS[key][child]);
		expect(res.retyped).toContain(`${key}.${child}`);
	});

	// Only the offending child. Losing every engine override because `custom` was
	// mistyped would be a worse outcome than the file caused.
	it('keeps the children that were fine', () => {
		const res = S.validate({
			gesturaSettings: 1,
			searchEngines: { custom: {}, overrides: { google: { name: 'G' } }, order: ['google'] },
		});
		expect(res.settings.searchEngines.custom).toEqual([]);
		expect(res.settings.searchEngines.overrides).toEqual({ google: { name: 'G' } });
		expect(res.settings.searchEngines.order).toEqual(['google']);
		expect(res.retyped).toEqual(['searchEngines.custom']);
	});

	// mouseGestures is keyed by gesture patterns: its default entries are DATA,
	// not a schema. Filling in "missing" ones would hand back every gesture the
	// user deliberately removed.
	it('does not treat mouseGestures as a record', () => {
		const res = S.validate({ gesturaSettings: 1, mouseGestures: { '→': { action: 'forward' } } });
		expect(res.settings.mouseGestures).toEqual({ '→': { action: 'forward' } });
		expect(res.retyped).toEqual([]);
	});

	it('leaves a child the default does not describe alone', () => {
		const res = S.validate({ gesturaSettings: 1, siteMenus: { custom: { mine: { name: 'Mine' } } } });
		expect(res.settings.siteMenus.custom).toEqual({ mine: { name: 'Mine' } });
		expect(res.retyped).toEqual([]);
	});

	// The consumer's own guard, tested through the consumer: even settings that
	// never passed the validator - anything already in chrome.storage.sync, which
	// content scripts read directly - must not take the engine list down.
	it('leaves engine resolution standing for every malformed custom', async () => {
		await import('../js/search-url.js');
		await import('../js/search-engines-catalog.js');
		await import('../js/engine-registry.js');
		const R = globalThis.FlowMouseEngineRegistry;
		for (const custom of [{}, 'invalid', 42, [null], [{ id: 'x' }], []]) {
			expect(() => R.resolveEngines([], { custom, overrides: {}, hidden: [], order: [] })).not.toThrow();
		}
		for (const hidden of [{}, 42]) {
			expect(() => R.resolveEngines([], { custom: [], overrides: {}, hidden, order: [] })).not.toThrow();
		}
		for (const order of [{}, 42]) {
			expect(() => R.resolveEngines([], { custom: [], overrides: {}, hidden: [], order })).not.toThrow();
		}
	});

	it('leaves the provenance walk standing for every malformed custom', () => {
		const EU = globalThis.FlowMouseEuIntegration;
		for (const custom of [{}, 'invalid', 42, [null], []]) {
			expect(() => EU.listProvenanced({ siteMenus: {}, searchEngines: { custom } })).not.toThrow();
			expect(() => EU.findStored({ siteMenus: {}, searchEngines: { custom } }, 'engine', 'x')).not.toThrow();
		}
	});

	// Written as TEXT, not as object literals: `__proto__:` in a literal sets the
	// prototype instead of creating a property, so JSON.stringify would silently
	// drop the very thing under test. This is also the form the attack arrives in.
	it.each([
		['at the top level', '{"gesturaSettings":1,"theme":"dark","__proto__":{"polluted":1}}'],
		['nested in an object', '{"gesturaSettings":1,"siteMenus":{"custom":{"m1":{"constructor":1}}}}'],
		['nested in an array', '{"gesturaSettings":1,"blacklist":[{"prototype":1}]}'],
		['deeply nested', '{"gesturaSettings":1,"siteMenus":{"custom":{"m1":{"items":[{"__proto__":{"x":1}}]}}}}'],
	])('refuses a forbidden key %s', (_label, text) => {
		expect(S.validate(text)).toMatchObject({ ok: false, error: 'forbidden-key' });
	});

	it('is not polluted by a rejected file', () => {
		S.validate('{"gesturaSettings":1,"theme":"dark","__proto__":{"polluted":1}}');
		expect({}.polluted).toBeUndefined();
	});
});

describe('legacy files', () => {
	// `legacy` is what the preview turns into "converted as it is written". The
	// shipped version's export has no format field either, and nothing in it is
	// converted - so the missing field alone must not earn that sentence.
	it('are not recognised by the missing format field alone', () => {
		const res = S.validate({ _version: '2.7.0', enableGesture: true, theme: 'dark' });
		expect(res.ok).toBe(true);
		expect(res.legacy).toBe(false);
	});

	it('are recognised by the pre-2.4 gesture keys that get converted', () => {
		const res = S.validate({ _version: '2.3.1', gestures: { '→': 'forward' } });
		expect(res.ok).toBe(true);
		expect(res.legacy).toBe(true);
	});

	it('migrate the pre-2.4 gesture keys into mouseGestures', () => {
		const res = S.validate({
			enableGesture: true,
			gestures: { '→': 'forward' },
			customGestures: { '←': 'openUrl' },
			customGestureUrls: { '←': 'https://example.org' },
		});
		expect(res.settings.mouseGestures['→']).toEqual({ action: 'forward' });
		expect(res.settings.mouseGestures['←']).toEqual({ action: 'openUrl', customUrl: 'https://example.org' });
		expect(res.dropped).not.toContain('gestures');
	});

	it('drop a gesture the old file had switched off', () => {
		const res = S.validate({ enableGesture: true, gestures: { '→': 'forward' }, customGestures: { '→': null } });
		expect(res.settings.mouseGestures).not.toHaveProperty('→');
	});

	it('leave mouseGestures alone when the file already has it', () => {
		const res = S.validate({ enableGesture: true, mouseGestures: { '↑': { action: 'top' } }, gestures: { '→': 'forward' } });
		expect(res.settings.mouseGestures).toEqual({ '↑': { action: 'top' } });
	});
});

describe('the upload hash', () => {
	it('ignores key order', async () => {
		const a = await S.hashOf({ gesturaSettings: 1, theme: 'dark', trailWidth: 5 });
		const b = await S.hashOf({ trailWidth: 5, gesturaSettings: 1, theme: 'dark' });
		expect(a).toBe(b);
	});

	// The reminder answers "did I change anything since I uploaded", and updating
	// the extension is not a change to the settings.
	it('ignores the extension version', async () => {
		const a = await S.hashOf({ gesturaSettings: 1, _version: '2.8.0', theme: 'dark' });
		const b = await S.hashOf({ gesturaSettings: 1, _version: '2.9.0', theme: 'dark' });
		expect(a).toBe(b);
	});

	it('changes when a value changes', async () => {
		const a = await S.hashOf({ gesturaSettings: 1, trailWidth: 5 });
		const b = await S.hashOf({ gesturaSettings: 1, trailWidth: 6 });
		expect(a).not.toBe(b);
	});
});

describe('device-local keys', () => {
	const SEVEN = ['theme', 'language', 'macLinuxHintDismissed', 'edgeGestureConflict', 'navCollapsed', 'engineManagerLocalOnly', 'sectionAdvanced'];

	it('names exactly the seven', () => {
		expect([...S.DEVICE_LOCAL].sort()).toEqual([...SEVEN].sort());
	});

	it('buildExport keeps them by default', () => {
		const out = S.buildExport(settings(), '2.8.0');
		for (const k of SEVEN) expect(out).toHaveProperty(k);
	});

	it('buildExport omits them for sync', () => {
		const out = S.buildExport(settings(), '2.8.0', { forSync: true });
		for (const k of SEVEN) expect(out).not.toHaveProperty(k);
		expect(out.trailWidth).toBe(9);
	});

	// The flag has to survive the rebuild inside validate(), or the object that is
	// uploaded and hashed is not the one the preview showed.
	it('validatedExport for sync hands back an object without them', () => {
		const res = S.validatedExport(settings(), '2.8.0', { forSync: true });
		expect(res.ok).toBe(true);
		for (const k of SEVEN) expect(res.exportObj).not.toHaveProperty(k);
		expect(JSON.parse(res.json)).not.toHaveProperty('theme');
	});

	it('import from a file accepts them either way', () => {
		const res = S.validate({ gesturaSettings: 1, theme: 'dark', navCollapsed: true });
		expect(res.settings.theme).toBe('dark');
		expect(res.settings.navCollapsed).toBe(true);
	});

	// Adopting a sync state keeps THIS device's seven. validate() seeds its result
	// from the defaults, and the adopt path writes that result whole - so without
	// this a downloaded state that carries no theme would write 'auto' over 'dark'.
	it('validate for sync fills them from the supplied local copy, not the defaults', () => {
		const local = { ...structuredClone(DEFAULTS), theme: 'dark', language: 'de', navCollapsed: true };
		const res = S.validate({ gesturaSettings: 1, trailWidth: 3 }, { forSync: true, local });
		expect(res.ok).toBe(true);
		expect(res.settings.theme).toBe('dark');
		expect(res.settings.language).toBe('de');
		expect(res.settings.navCollapsed).toBe(true);
		expect(res.settings.trailWidth).toBe(3);
	});

	it('validate for sync ignores a device-local key the payload carries', () => {
		const local = { ...structuredClone(DEFAULTS), theme: 'dark' };
		const res = S.validate({ gesturaSettings: 1, trailWidth: 3, theme: 'light' }, { forSync: true, local });
		expect(res.settings.theme).toBe('dark');
		expect(res.dropped).toEqual([]);
	});

	it('validate for sync without a local copy falls back to the defaults', () => {
		const res = S.validate({ gesturaSettings: 1, trailWidth: 3 }, { forSync: true });
		expect(res.settings.theme).toBe(DEFAULTS.theme);
	});

	it('hashOf ignores a theme change', async () => {
		const a = S.buildExport(settings(), '2.8.0');
		const b = S.buildExport({ ...settings(), theme: 'light' }, '2.8.0');
		expect(await S.hashOf(a)).toBe(await S.hashOf(b));
	});

	it('hashOf still sees a real change', async () => {
		const a = S.buildExport(settings(), '2.8.0');
		const b = S.buildExport({ ...settings(), trailWidth: 1 }, '2.8.0');
		expect(await S.hashOf(a)).not.toBe(await S.hashOf(b));
	});
});

describe('the size cap', () => {
	it('is 1 MiB of JSON text', () => {
		expect(S.MAX_BYTES).toBe(1024 * 1024);
	});
});
