import { describe, it, expect } from 'vitest';
import '../js/menu-exchange.js';
import '../js/menu-model.js';
const X = globalThis.FlowMouseMenuExchange;
const M = globalThis.FlowMouseMenuModel;

// Diese Zusammenführung lag bis zuletzt in <menu-import-dialog> und war damit
// ungetestet - dort entstanden nacheinander der ID-Fehler (ein Menü zeigte auf
// die alte Engine-ID) und die falsche Sortierung (neue Menüs landeten über dem
// Katalog). Beide sind hier abgesichert.

const CATALOG = [
	{ id: 'gh', name: 'GitHub', patterns: [], items: [] },
	{ id: 'amz', name: 'Amazon', patterns: [], items: [] },
];

const emptyMenus = () => ({ disabled: [], edited: {}, custom: {}, domains: {}, order: [], flags: {} });
const emptyEngines = () => ({ overrides: {}, hidden: [], custom: [], order: [] });

const menuValue = (extra = {}) => ({
	gesturaMenu: 1,
	id: 'com.example.menu',
	name: { en: 'Beispiel' },
	items: [{ action: 'openCustomUrl', name: { en: 'A' }, url: 'https://example.com/a' }],
	...extra,
});

const engineValue = (extra = {}) => ({
	gesturaEngine: 1,
	id: 'com.example.engine',
	name: { en: 'Beispielsuche' },
	url: 'https://example.com/?q={q}',
	...extra,
});

const rowOf = (value, over = {}) => ({
	type: X.detectType(value) === 'menu' ? 'menu' : 'engine',
	value,
	source: { type: 'file' },
	mode: 'new',
	matchId: null,
	...over,
});

describe('applyMenuTo', () => {
	it('legt ein neues Menü unter custom an und meldet seine ID', () => {
		const { next, id, isNew } = X.applyMenuTo(emptyMenus(), menuValue(), { type: 'file' }, 'de', 'new', null);
		expect(isNew).toBe(true);
		expect(Object.keys(next.custom)).toEqual([id]);
		expect(next.custom[id].name).toBe('Beispiel');
	});

	it('schreibt das neue Menü NICHT in order - sonst stünde es über dem Katalog', () => {
		// siteMenus.order ist eine Vorrang-Liste, keine vollständige Sortierung:
		// listMenus() liest sie zuerst und danach erst den Katalog. Ein Eintrag in
		// order bedeutet also "ganz nach oben", nicht "ans Ende".
		const { next, id } = X.applyMenuTo(emptyMenus(), menuValue(), { type: 'file' }, 'de', 'new', null);
		expect(next.order).toEqual([]);
		expect(M.listMenus(CATALOG, next).map(m => m.id)).toEqual(['gh', 'amz', id]);
	});

	it('hängt auch bei eigener Sortierung hinten an', () => {
		const cur = { ...emptyMenus(), order: ['amz', 'gh'] };
		const { next, id } = X.applyMenuTo(cur, menuValue(), { type: 'file' }, 'de', 'new', null);
		expect(M.listMenus(CATALOG, next).map(m => m.id)).toEqual(['amz', 'gh', id]);
	});

	it('zwei Importe behalten ihre Reihenfolge', () => {
		const first = X.applyMenuTo(emptyMenus(), menuValue(), { type: 'file' }, 'de', 'new', null);
		const second = X.applyMenuTo(first.next, menuValue({ id: 'com.example.zwei' }), { type: 'file' }, 'de', 'new', null);
		expect(M.listMenus(CATALOG, second.next).map(m => m.id)).toEqual(['gh', 'amz', first.id, second.id]);
	});

	it('ersetzt im replace-Modus das Katalog-Menü und meldet es als nicht neu', () => {
		const { next, id, isNew } = X.applyMenuTo(emptyMenus(), menuValue(), { type: 'file' }, 'de', 'replace', 'gh');
		expect(isNew).toBe(false);
		expect(id).toBe('gh');
		expect(next.edited.gh).toBeTruthy();
		expect(Object.keys(next.custom)).toEqual([]);
	});
});

describe('applyEngineTo', () => {
	it('hängt eine neue Engine ans Ende von custom', () => {
		const cur = { ...emptyEngines(), custom: [{ id: 'eng_alt', name: 'Alt' }] };
		const { next, id, isNew } = X.applyEngineTo(cur, engineValue(), { type: 'file' }, 'de', 'new', null, false);
		expect(isNew).toBe(true);
		expect(next.custom.map(e => e.id)).toEqual(['eng_alt', id]);
	});

	it('entfernt das Transform-Skript, wenn die Umgebung keines ausführt', () => {
		const v = engineValue({ transformEnabled: true, transformCode: 'return x;' });
		const { next, id } = X.applyEngineTo(emptyEngines(), v, { type: 'file' }, 'de', 'new', null, true);
		const eng = next.custom.find(e => e.id === id);
		expect(eng.transformEnabled).toBe(false);
		expect(eng.transformCode).toBe('');
	});

	it('lässt das Skript stehen, wenn die Engine darauf besteht', () => {
		const v = engineValue({ transformEnabled: true, transformCode: 'return x;', transformRequired: true });
		const { next, id } = X.applyEngineTo(emptyEngines(), v, { type: 'file' }, 'de', 'new', null, true);
		expect(next.custom.find(e => e.id === id).transformCode).toBe('return x;');
	});
});

describe('buildImportPatch', () => {
	const current = () => ({ siteMenus: emptyMenus(), searchEngines: emptyEngines() });

	it('biegt den Menü-Verweis auf die neu vergebene Engine-ID um', () => {
		// Der Fehler, der vor der Abhängigkeitsprüfung still auftrat: toCustomEngine
		// vergibt eine neue ID, das Menü zeigte weiter auf die aus der Datei - und
		// sein Sucheintrag verschwand beim Anzeigen wortlos.
		const menu = menuValue({
			items: [{ action: 'searchLink', name: { en: 'Suche' }, engineId: 'com.example.engine' }],
		});
		const { patch } = X.buildImportPatch(
			[rowOf(engineValue()), rowOf(menu)], current(), { lang: 'de', stripTransform: false });
		const engineId = patch.searchEngines.custom[0].id;
		const def = Object.values(patch.siteMenus.custom)[0];
		expect(engineId).not.toBe('com.example.engine');
		expect(def.items[0].engineId).toBe(engineId);
	});

	it('meldet jeden angefassten Eintrag mit Art, ID und ob er neu ist', () => {
		const { imported } = X.buildImportPatch(
			[rowOf(engineValue()), rowOf(menuValue()), rowOf(menuValue({ id: 'com.example.b' }), { mode: 'replace', matchId: 'gh' })],
			current(), { lang: 'de', stripTransform: false });
		expect(imported.map(e => e.kind)).toEqual(['engine', 'menu', 'menu']);
		expect(imported.filter(e => e.isNew)).toHaveLength(2);
		expect(imported.find(e => !e.isNew).id).toBe('gh');
	});

	it('schreibt nur die Zweige, die wirklich betroffen sind', () => {
		const onlyMenu = X.buildImportPatch([rowOf(menuValue())], current(), { lang: 'de', stripTransform: false });
		expect(Object.keys(onlyMenu.patch)).toEqual(['siteMenus']);
		const onlyEngine = X.buildImportPatch([rowOf(engineValue())], current(), { lang: 'de', stripTransform: false });
		expect(Object.keys(onlyEngine.patch)).toEqual(['searchEngines']);
	});

	it('liefert bei leerer Auswahl einen leeren Patch', () => {
		const { patch, imported } = X.buildImportPatch([], current(), { lang: 'de', stripTransform: false });
		expect(patch).toEqual({});
		expect(imported).toEqual([]);
	});
});
