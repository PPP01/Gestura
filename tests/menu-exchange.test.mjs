import { describe, it, expect } from 'vitest';
import '../js/menu-exchange.js';
const X = globalThis.FlowMouseMenuExchange;

const validMenu = () => ({
	gesturaMenu: 1,
	id: 'com.example.shop',
	version: '1.0.0',
	name: { en: 'Shop', de: 'Laden' },
	icon: 'cart',
	patterns: ['*example.com*'],
	items: [
		{ id: 'orders', label: { en: 'Orders' }, icon: 'package', action: 'openCustomUrl', customUrl: 'https://example.com/orders' },
		{ id: 'sep1', type: 'separator' },
		{ id: 'search', label: { en: 'Search' }, action: 'searchLink', url: 'https://example.com/s?q=%s' },
	],
});

describe('detectType', () => {
	it('detects menu and engine and null', () => {
		expect(X.detectType({ gesturaMenu: 1 })).toBe('menu');
		expect(X.detectType({ gesturaEngine: 1 })).toBe('engine');
		expect(X.detectType({})).toBe(null);
		expect(X.detectType(null)).toBe(null);
	});
});

describe('isHttpsUrl', () => {
	it('accepts https only', () => {
		expect(X.isHttpsUrl('https://a.example/x')).toBe(true);
		expect(X.isHttpsUrl('http://a.example/x')).toBe(false);
		expect(X.isHttpsUrl('javascript:alert(1)')).toBe(false);
		expect(X.isHttpsUrl('data:text/html,x')).toBe(false);
		expect(X.isHttpsUrl('file:///etc/passwd')).toBe(false);
		expect(X.isHttpsUrl('not a url')).toBe(false);
	});
});

describe('pickLabel', () => {
	it('prefers lang, falls back to en, then to string', () => {
		expect(X.pickLabel({ en: 'Orders', de: 'Bestellungen' }, 'de')).toBe('Bestellungen');
		expect(X.pickLabel({ en: 'Orders' }, 'de')).toBe('Orders');
		expect(X.pickLabel('Plain', 'de')).toBe('Plain');
		expect(X.pickLabel(null, 'de')).toBe('');
	});
});

describe('validate(menu)', () => {
	it('accepts a well-formed menu', () => {
		const r = X.validate(validMenu());
		expect(r.ok).toBe(true);
		expect(r.type).toBe('menu');
		expect(r.errors).toEqual([]);
		expect(r.value.items).toHaveLength(3);
	});
	it('rejects unsupported format version', () => {
		const r = X.validate({ ...validMenu(), gesturaMenu: 2 });
		expect(r.ok).toBe(false);
		expect(r.errors.join()).toMatch(/format/i);
	});
	it('rejects missing id / bad semver', () => {
		expect(X.validate({ ...validMenu(), id: '' }).ok).toBe(false);
		expect(X.validate({ ...validMenu(), version: '1.0' }).ok).toBe(false);
		expect(X.validate({ ...validMenu(), version: '999999.0.0' }).ok).toBe(false);
	});
	it('rejects non-https item url and javascript url', () => {
		const m = validMenu();
		m.items[0].customUrl = 'http://example.com/x';
		expect(X.validate(m).ok).toBe(false);
		const m2 = validMenu();
		m2.items[0].customUrl = 'javascript:alert(1)';
		expect(X.validate(m2).ok).toBe(false);
	});
	it('rejects a disallowed action', () => {
		const m = validMenu();
		m.items[0].action = 'sendExtensionMessage';
		expect(X.validate(m).ok).toBe(false);
	});
	it('rejects duplicate item ids', () => {
		const m = validMenu();
		m.items[2].id = 'orders';
		expect(X.validate(m).ok).toBe(false);
	});
	it('rejects too many items', () => {
		const m = validMenu();
		m.items = Array.from({ length: 101 }, (_, i) => ({ id: 'i' + i, action: 'openCustomUrl', customUrl: 'https://x.example/' + i }));
		expect(X.validate(m).ok).toBe(false);
	});
	it('rejects an oversized blob', () => {
		const m = validMenu();
		m.description = { en: 'x'.repeat(200000) };
		expect(X.validate(m).ok).toBe(false);
	});
	it('rejects an over-long homepage', () => {
		const m = validMenu();
		m.homepage = 'https://example.com/' + 'x'.repeat(3000);
		expect(X.validate(m).ok).toBe(false);
	});
	it('rejects an item id with an unsafe charset', () => {
		const m = validMenu();
		m.items[0].id = '__pro to__';
		expect(X.validate(m).ok).toBe(false);
	});
});

const validEngine = () => ({
	gesturaEngine: 1,
	id: 'example-search',
	version: '1.0.0',
	name: { en: 'Example Search' },
	url: 'https://example.com/s?q=%s',
	type: 'text',
});

describe('validate(engine)', () => {
	it('accepts a well-formed engine without transform', () => {
		const r = X.validate(validEngine());
		expect(r.ok).toBe(true);
		expect(r.type).toBe('engine');
		expect(X.hasTransform(r.value)).toBe(false);
	});
	it('accepts an engine with transform and reports hasTransform', () => {
		const e = { ...validEngine(), transformEnabled: true, transformCode: 'return selection.trim();' };
		const r = X.validate(e);
		expect(r.ok).toBe(true);
		expect(X.hasTransform(r.value)).toBe(true);
	});
	it('reports hasTransform false for enabled-but-empty code', () => {
		expect(X.hasTransform({ transformEnabled: true, transformCode: '   ' })).toBe(false);
	});
	it('rejects non-https engine url', () => {
		expect(X.validate({ ...validEngine(), url: 'http://example.com/s?q=%s' }).ok).toBe(false);
	});
	it('rejects oversized transform code', () => {
		const e = { ...validEngine(), transformEnabled: true, transformCode: 'x'.repeat(11000) };
		expect(X.validate(e).ok).toBe(false);
	});
	it('rejects bad type value', () => {
		expect(X.validate({ ...validEngine(), type: 'video' }).ok).toBe(false);
	});
});

describe('toCustomMenu', () => {
	it('maps a validated menu to a custom siteMenus entry with fresh ids', () => {
		const v = X.validate(validMenu()).value;
		let n = 0;
		const genId = (p) => `${p}_test${n++}`;
		const source = { type: 'file', version: '1.0.0' };
		const { id, def } = X.toCustomMenu(v, source, genId);
		expect(id).toBe('menu_test0');
		expect(def.name).toEqual({ en: 'Shop', de: 'Laden' });
		expect(def.patterns).toEqual(['*example.com*']);
		expect(def.items).toHaveLength(3);
		expect(def.items[0].id).toBe('item_test1'); // neue ID
		expect(def.items[0].action).toBe('openCustomUrl');
		expect(def.items[0].customUrl).toBe('https://example.com/orders');
		expect(def.items[1].type).toBe('separator');
		expect(def.source).toEqual(source);
	});
});

describe('toCustomEngine', () => {
	it('maps a validated engine to a searchEngines.custom entry', () => {
		const v = X.validate({ ...validEngine(), transformEnabled: true, transformCode: 'return selection;' }).value;
		const genId = () => 'eng_test';
		const e = X.toCustomEngine(v, { type: 'file', version: '1.0.0' }, genId);
		expect(e.id).toBe('eng_test');
		expect(e.builtin).toBe(false);
		expect(e.url).toBe('https://example.com/s?q=%s');
		expect(e.transformEnabled).toBe(true);
		expect(e.transformCode).toBe('return selection;');
		expect(e.source.type).toBe('file');
	});
});
