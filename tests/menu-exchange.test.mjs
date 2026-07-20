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
});
