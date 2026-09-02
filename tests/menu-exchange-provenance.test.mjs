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
			{ type: 'menu', value: menu('google'), source: SITE, mode: 'replace', matchId: 'google' },
			{ type: 'menu', value: menu('com.x'), source: SITE, mode: 'new', matchId: null },
		];
		const cur = JSON.parse(JSON.stringify(current));
		cur.siteMenus.custom.menu_old = { name: 'Old', icon: 'menu', patterns: [], items: [], source: { type: 'file', indexId: 'old', baselineHash: 'deadbeefdeadbeef' } };
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
	it('Firefox transform-strip happens before the baseline', async () => {
		const withScript = { ...engine('com.s'), transformEnabled: true, transformCode: 'return q' };
		const { patch, imported } = X.buildImportPatch([{ type: 'engine', value: withScript, source: SITE, mode: 'new', matchId: null }], current, { lang: 'en', stripTransform: true });
		const withBase = await EU.addBaselines(patch, imported);
		const stored = EU.findStored(withBase, 'engine', imported[0].id);
		expect(stored.transformCode).toBe('');
		expect(await EU.modifiedState(stored)).toBe(false);
	});
});
