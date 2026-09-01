import { describe, it, expect } from 'vitest';
import '../js/menu-exchange.js';
const X = globalThis.FlowMouseMenuExchange;

const menu = (...items) => ({
	gesturaMenu: 1,
	id: 'com.example.m',
	version: '1.0.0',
	name: { en: 'M' },
	items,
});

const search = (id, engineId) => ({ id, label: { en: id }, action: 'searchLink', engineId });

describe('menuEngineIds', () => {
	it('collects the engineId of every searchLink item', () => {
		expect(X.menuEngineIds(menu(search('a', 'google'), search('b', 'brave')))).toEqual(['google', 'brave']);
	});

	it('reports each engine once, in order of first mention', () => {
		const m = menu(search('a', 'brave'), search('b', 'google'), search('c', 'brave'));
		expect(X.menuEngineIds(m)).toEqual(['brave', 'google']);
	});

	it('ignores items that are not searchLink', () => {
		const m = menu(
			{ id: 'x', label: { en: 'X' }, action: 'openCustomUrl', customUrl: 'https://example.com/x' },
			{ id: 'y', label: { en: 'Y' }, action: 'back' },
			{ id: 'sep', type: 'separator' },
		);
		expect(X.menuEngineIds(m)).toEqual([]);
	});

	it('ignores a searchLink that carries its own url instead of an engineId', () => {
		const m = menu({ id: 'u', label: { en: 'U' }, action: 'searchLink', url: 'https://example.com/s?q=%s' });
		expect(X.menuEngineIds(m)).toEqual([]);
	});

	it('ignores an empty or non-string engineId', () => {
		const m = menu(search('a', ''), search('b', 42), search('c', null), search('d', 'google'));
		expect(X.menuEngineIds(m)).toEqual(['google']);
	});

	it('returns an empty list for a menu without items and for junk input', () => {
		expect(X.menuEngineIds(menu())).toEqual([]);
		expect(X.menuEngineIds({ gesturaMenu: 1 })).toEqual([]);
		expect(X.menuEngineIds(null)).toEqual([]);
		expect(X.menuEngineIds('nope')).toEqual([]);
	});

	it('does not read engineId off an engine', () => {
		const engine = { gesturaEngine: 1, id: 'e', version: '1.0.0', name: 'E', url: 'https://e.tld/?q=%s' };
		expect(X.menuEngineIds(engine)).toEqual([]);
	});
});

// Eine eigene Engine bekommt beim Import eine frisch vergebene ID; das Menü im
// selben Bundle zeigt aber noch auf die ID aus der Datei. Ohne Umschreiben liefe
// der Verweis nach dem Import ins Leere — genau der Fehler, den die Prüfung
// eigentlich verhindern soll.
describe('engineId-Umschreibung beim Import', () => {
	const menu = (engineId) => ({
		gesturaMenu: 1, id: 'com.example.m', version: '1.0.0', name: { en: 'M' },
		items: [
			{ id: 'a', label: { en: 'A' }, action: 'searchLink', engineId },
			{ id: 'b', label: { en: 'B' }, action: 'openCustomUrl', customUrl: 'https://example.com/b' },
		],
	});
	const source = { type: 'site', url: 'https://x.tld', version: '1.0.0' };

	it('biegt toCustomMenu auf die gespeicherte Engine-ID um', () => {
		const { def } = X.toCustomMenu(menu('com.example.foo'), source, undefined, 'en', { 'com.example.foo': 'eng_abc123' });
		expect(def.items[0].engineId).toBe('eng_abc123');
	});

	it('biegt toStandardMenu genauso um', () => {
		const def = X.toStandardMenu(menu('com.example.foo'), 'en', { 'com.example.foo': 'eng_abc123' });
		expect(def.items[0].engineId).toBe('eng_abc123');
	});

	it('lässt eine ID unangetastet, für die es keine Zuordnung gibt', () => {
		const { def } = X.toCustomMenu(menu('google'), source, undefined, 'en', { 'com.example.foo': 'eng_abc123' });
		expect(def.items[0].engineId).toBe('google');
	});

	it('ändert ohne Zuordnung nichts (Verhalten des Einzel-Imports)', () => {
		const { def } = X.toCustomMenu(menu('google'), source, undefined, 'en');
		expect(def.items[0].engineId).toBe('google');
		expect(X.toStandardMenu(menu('google'), 'en').items[0].engineId).toBe('google');
	});

	it('rührt Einträge ohne engineId nicht an', () => {
		const { def } = X.toCustomMenu(menu('com.example.foo'), source, undefined, 'en', { 'com.example.foo': 'eng_abc123' });
		expect(def.items[1].engineId).toBeUndefined();
		expect(def.items[1].customUrl).toBe('https://example.com/b');
	});
});
