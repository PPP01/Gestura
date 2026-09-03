import { describe, it, expect } from 'vitest';
import '../js/menu-exchange.js';
import '../js/eu-integration.js';
const X = globalThis.FlowMouseMenuExchange;
const EU = globalThis.FlowMouseEuIntegration;

const menu = (id) => ({ gesturaMenu: 1, id, version: '1.0.0', name: { en: 'M' }, icon: 'menu', patterns: ['*x.example*'], items: [{ id: 'a', label: { en: 'A' }, action: 'openCustomUrl', customUrl: 'https://x.example/a' }] });
const engine = (id) => ({ gesturaEngine: 1, id, version: '2.0.0', name: { en: 'E' }, url: 'https://e.example/?q=%s', type: 'text' });
const SITE = { type: 'site', url: 'https://gestura.eu/de/index', indexOrigin: 'https://gestura.eu' };
const FILE = { type: 'file' };

describe('provenance on every import mode', () => {
	it('toStandardMenu carries source when given, stays source-less otherwise', () => {
		expect(X.toStandardMenu(menu('google'), 'en').source).toBeUndefined();
		const def = X.toStandardMenu(menu('google'), 'en', undefined, SITE);
		expect(def.source).toEqual({ ...SITE, indexId: 'google' });
	});
	it('toEngineOverride carries source when given', () => {
		expect(X.toEngineOverride(engine('bing'), 'en').source).toBeUndefined();
		expect(X.toEngineOverride(engine('bing'), 'en', FILE).source).toEqual({ type: 'file', indexId: 'bing' });
	});
	it('replace-catalog menu keeps provenance in siteMenus.edited', () => {
		const { next } = X.applyMenuTo({ custom: {}, edited: {} }, menu('google'), { ...SITE, version: '1.0.0' }, 'en', 'replace', 'google');
		expect(next.edited.google.source).toEqual({ ...SITE, version: '1.0.0', indexId: 'google' });
	});
	it('engine override keeps provenance in searchEngines.overrides', () => {
		const { next } = X.applyEngineTo({ custom: [], overrides: {} }, engine('bing'), { ...SITE, version: '2.0.0' }, 'en', 'replace', 'bing', false);
		expect(next.overrides.bing.source).toEqual({ ...SITE, version: '2.0.0', indexId: 'bing' });
	});
	it('new custom entries still carry provenance (unchanged 2.8.0 behaviour)', () => {
		const m = X.applyMenuTo({ custom: {}, edited: {} }, menu('com.x'), FILE, 'en', 'new', null);
		expect(m.next.custom[m.id].source).toEqual({ type: 'file', indexId: 'com.x' });
		const e = X.applyEngineTo({ custom: [], overrides: {} }, engine('com.e'), FILE, 'en', 'new', null, false);
		expect(e.next.custom[0].source).toEqual({ type: 'file', indexId: 'com.e' });
	});
});

describe('addBaselines', () => {
	const current = { siteMenus: { custom: {}, edited: {}, order: [] }, searchEngines: { custom: [], overrides: {} } };

	it('sets baselineHash on every imported entry and leaves others alone', async () => {
		const rows = [
			{ type: 'engine', value: engine('bing'), source: SITE, mode: 'replace', matchId: 'bing' },
			{ type: 'engine', value: engine('com.e'), source: SITE, mode: 'new', matchId: null },
			// replace-custom: a repeat import onto an entry already in .custom, not the
			// catalog/override branch above — same functions as "new", but Spec §9 names
			// it as its own of the five import modes and it was missing from this fixture.
			{ type: 'engine', value: engine('com.repeat'), source: SITE, mode: 'replace', matchId: 'eng_repeat' },
			{ type: 'menu', value: menu('google'), source: SITE, mode: 'replace', matchId: 'google' },
			{ type: 'menu', value: menu('com.x'), source: SITE, mode: 'new', matchId: null },
			{ type: 'menu', value: menu('com.repeat'), source: SITE, mode: 'replace', matchId: 'menu_repeat' },
		];
		const cur = JSON.parse(JSON.stringify(current));
		cur.siteMenus.custom.menu_old = { name: 'Old', icon: 'menu', patterns: [], items: [], source: { type: 'file', indexId: 'old', baselineHash: 'deadbeefdeadbeef' } };
		cur.siteMenus.custom.menu_repeat = { name: 'Old repeat', icon: 'menu', patterns: [], items: [], source: { type: 'file', indexId: 'old-repeat', baselineHash: 'deadbeefdeadbeef' } };
		cur.searchEngines.custom.push({ id: 'eng_repeat', name: 'Old repeat', url: 'https://old-repeat.example/?q=%s', type: 'text', source: { type: 'file', indexId: 'old-repeat', baselineHash: 'deadbeefdeadbeef' } });
		const { patch, imported } = X.buildImportPatch(rows, cur, { lang: 'en', stripTransform: false });
		const withBase = await EU.addBaselines(patch, imported);
		for (const { kind, id } of imported) {
			const stored = EU.findStored(withBase, kind, id);
			expect(stored.source.baselineHash).toMatch(/^[0-9a-f]{16}$/);
			expect(await EU.modifiedState(stored)).toBe(false);   // modified === false right after import, every mode
		}
		expect(withBase.siteMenus.custom.menu_old.source.baselineHash).toBe('deadbeefdeadbeef');
		expect(patch.searchEngines.overrides.bing.source.baselineHash).toBeUndefined();   // input not mutated
	});
	// The import preview measures the patch synchronously to decide whether it still
	// fits the 8192-byte item quota, but the real hashes are added afterwards and are
	// async. If the measured shape is one byte short of the stored one, the preview
	// can say "fits" and the save can then fail - which is what happened in a real
	// browser at 99 % usage. Byte-exact equality is the only assertion that holds
	// that line; "roughly the same" would not have caught it.
	it('the preview measures byte-for-byte what the save will store', async () => {
		const rows = [
			{ type: 'menu', value: menu('google'), source: SITE, mode: 'replace', matchId: 'google' },
			{ type: 'menu', value: menu('com.x'), source: SITE, mode: 'new', matchId: null },
			{ type: 'engine', value: engine('bing'), source: SITE, mode: 'replace', matchId: 'bing' },
			{ type: 'engine', value: engine('com.e'), source: SITE, mode: 'new', matchId: null },
		];
		const { patch, imported } = X.buildImportPatch(rows, JSON.parse(JSON.stringify(current)), { lang: 'en', stripTransform: false });
		const stored = await EU.addBaselines(patch, imported);
		const measured = EU.withBaselinePlaceholders(patch, imported);

		expect(imported.length).toBe(4);
		for (const key of ['siteMenus', 'searchEngines']) {
			expect(JSON.stringify(measured[key]).length).toBe(JSON.stringify(stored[key]).length);
		}
		// And the placeholder is the reason it lines up: same length as a real hash.
		expect(EU.BASELINE_PLACEHOLDER).toHaveLength((await EU.baselineHash({ a: 1 })).length);
		// Measuring must not have written anything into the patch it measured.
		expect(JSON.stringify(patch)).not.toContain('baselineHash');
	});

	it('Firefox transform-strip happens before the baseline', async () => {
		const withScript = { ...engine('com.s'), transformEnabled: true, transformCode: 'return q' };
		const { patch, imported } = X.buildImportPatch([{ type: 'engine', value: withScript, source: SITE, mode: 'new', matchId: null }], current, { lang: 'en', stripTransform: true });
		const withBase = await EU.addBaselines(patch, imported);
		const stored = EU.findStored(withBase, 'engine', imported[0].id);
		expect(stored.transformCode).toBe('');
		expect(await EU.modifiedState(stored)).toBe(false);
	});
});

describe('a no-op editor save does not flip modified (Important 1 regression)', () => {
	// engine-manager.js's #saveEdit rebuilds the stored entry from a fixed field
	// list rather than spreading the original object. That list has to match, key
	// for key, what the import wrote (toCustomEngine / toEngineOverride in
	// js/menu-exchange.js) — the baseline hashes the whole stored object minus
	// `source`, so a rebuild that drops or adds a field changes the hash even
	// when no user-visible value changed. Both cases below build the rebuilt
	// object the way #saveEdit does today (`builtin` added for the custom branch,
	// `type` added for the override branch) and open the editor without touching
	// any field, exactly as a user pressing Save without editing anything would.

	it('custom-engine branch: rebuild with the corrected field list stays unmodified', async () => {
		const { patch, imported } = X.buildImportPatch(
			[{ type: 'engine', value: engine('com.e'), source: SITE, mode: 'new', matchId: null }],
			{ siteMenus: { custom: {}, edited: {} }, searchEngines: { custom: [], overrides: {} } },
			{ lang: 'en', stripTransform: false },
		);
		const saved = await EU.addBaselines(patch, imported);
		const stored = EU.findStored(saved, 'engine', imported[0].id);

		// #saveEdit's custom branch, field for field, with `draft` standing in for
		// an editor opened on `stored` and closed again without any edit.
		const draft = { ...stored };
		const rebuilt = {
			id: stored.id, name: draft.name, url: draft.url,
			plus: draft.plus, slug: draft.slug, suffix: draft.suffix, clipboardMode: draft.clipboardMode,
			rawResult: draft.rawResult, transformEnabled: draft.transformEnabled, transformCode: draft.transformCode,
			transformClipboard: draft.transformClipboard, transformRawResult: draft.transformRawResult,
			type: stored.type, builtin: false,
			...(stored.source ? { source: stored.source } : {}),
		};
		expect(await EU.modifiedState(rebuilt)).toBe(false);
	});

	it('built-in-override branch: rebuild with the corrected field list stays unmodified', async () => {
		const { patch, imported } = X.buildImportPatch(
			[{ type: 'engine', value: engine('bing'), source: SITE, mode: 'replace', matchId: 'bing' }],
			{ siteMenus: { custom: {}, edited: {} }, searchEngines: { custom: [], overrides: {} } },
			{ lang: 'en', stripTransform: false },
		);
		const saved = await EU.addBaselines(patch, imported);
		const prev = EU.findStored(saved, 'engine', 'bing');

		// #saveEdit's built-in branch, field for field, `draft` again standing in
		// for an editor opened and closed without any edit.
		const draft = { ...prev };
		const rebuilt = {
			name: draft.name, url: draft.url,
			plus: draft.plus, slug: draft.slug, suffix: draft.suffix, clipboardMode: draft.clipboardMode,
			transformEnabled: draft.transformEnabled, transformCode: draft.transformCode,
			transformClipboard: draft.transformClipboard, transformRawResult: draft.transformRawResult,
			rawResult: draft.rawResult, type: draft.type,
			...(prev.source ? { source: prev.source } : {}),
		};
		expect(await EU.modifiedState(rebuilt)).toBe(false);
	});
});

describe('an edited import stays an import', () => {
	it('keeps provenance and reports modified after the editor rebuilds an entry', async () => {
		const { patch, imported } = X.buildImportPatch(
			[{ type: 'engine', value: engine('com.e'), source: SITE, mode: 'new', matchId: null }],
			{ siteMenus: { custom: {}, edited: {} }, searchEngines: { custom: [], overrides: {} } },
			{ lang: 'en', stripTransform: false },
		);
		const saved = await EU.addBaselines(patch, imported);
		const stored = EU.findStored(saved, 'engine', imported[0].id);

		// What engine-manager's #saveEdit does: rebuild from a fixed field list.
		// With `source` carried over (Task 6) the entry stays recognisable.
		const rebuilt = { id: stored.id, name: 'renamed by the user', url: stored.url, type: stored.type, builtin: false, source: stored.source };
		expect(await EU.modifiedState(rebuilt)).toBe(true);

		// Dropping `source` - the bug this task fixes - loses the entry entirely.
		const { source, ...withoutSource } = rebuilt;
		expect(EU.listProvenanced({ searchEngines: { custom: [withoutSource], overrides: {} } })).toEqual([]);
	});
});
