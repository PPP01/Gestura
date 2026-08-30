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
