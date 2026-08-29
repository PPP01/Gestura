import { describe, it, expect } from 'vitest';
import '../js/menu-exchange.js';
const X = globalThis.FlowMouseMenuExchange;

const validMenu = () => ({
	gesturaMenu: 1,
	id: 'com.example.shop',
	version: '1.0.0',
	name: { en: 'Shop', de: 'Laden' },
	items: [
		{ id: 'orders', label: { en: 'Orders' }, action: 'openCustomUrl', customUrl: 'https://example.com/orders' },
	],
});

const validEngine = () => ({
	gesturaEngine: 1,
	id: 'com.example.search',
	version: '2.1.0',
	name: 'Example Search',
	url: 'https://example.com/s?q=%s',
});

// Ein Menü, dessen Item-URL nicht https ist: scheitert an genau einem Feld.
const brokenMenu = () => ({
	...validMenu(),
	id: 'com.example.broken',
	items: [
		{ id: 'x', label: { en: 'X' }, action: 'openCustomUrl', customUrl: 'http://example.com/x' },
	],
});

const bundle = (...entries) => ({ gesturaBundle: 1, entries });

describe('detectType(bundle)', () => {
	it('detects a bundle wrapper', () => {
		expect(X.detectType({ gesturaBundle: 1 })).toBe('bundle');
	});
});

describe('validate() rejects bundles', () => {
	it('never lets a bundle through as a single format', () => {
		const r = X.validate(bundle(validMenu()));
		expect(r.ok).toBe(false);
		expect(r.type).toBe('bundle');
		expect(r.errors).toEqual(['notSingleFormat']);
		expect(r.value).toBe(null);
	});
});

describe('validateBundle', () => {
	it('accepts a mixed bundle and validates every entry on its own', () => {
		const r = X.validateBundle(bundle(validMenu(), validEngine()));
		expect(r.ok).toBe(true);
		expect(r.type).toBe('bundle');
		expect(r.errors).toEqual([]);
		expect(r.entries).toHaveLength(2);
		expect(r.entries[0].ok).toBe(true);
		expect(r.entries[0].type).toBe('menu');
		expect(r.entries[0].value.id).toBe('com.example.shop');
		expect(r.entries[1].ok).toBe(true);
		expect(r.entries[1].type).toBe('engine');
	});

	it('reports a broken entry without blocking the others', () => {
		const r = X.validateBundle(bundle(validMenu(), brokenMenu(), validEngine()));
		expect(r.ok).toBe(true);
		expect(r.entries.map(e => e.ok)).toEqual([true, false, true]);
		expect(r.entries[1].errors).toContain('itemUrl');
		expect(r.entries[1].value).toBe(null);
	});

	it('preserves the order of entries', () => {
		const r = X.validateBundle(bundle(validEngine(), validMenu()));
		expect(r.entries.map(e => e.type)).toEqual(['engine', 'menu']);
	});

	it('rejects anything that is not a bundle', () => {
		expect(X.validateBundle(validMenu()).errors).toEqual(['notGesturaFormat']);
		expect(X.validateBundle(null).errors).toEqual(['notGesturaFormat']);
		expect(X.validateBundle({}).errors).toEqual(['notGesturaFormat']);
	});

	it('rejects an unsupported wrapper version', () => {
		const r = X.validateBundle({ gesturaBundle: 2, entries: [validMenu()] });
		expect(r.ok).toBe(false);
		expect(r.errors).toEqual(['unsupportedFormatVersion']);
	});

	it('rejects a missing, non-array or empty entries list', () => {
		expect(X.validateBundle({ gesturaBundle: 1 }).errors).toEqual(['entries']);
		expect(X.validateBundle({ gesturaBundle: 1, entries: {} }).errors).toEqual(['entries']);
		expect(X.validateBundle(bundle()).errors).toEqual(['entries']);
	});

	it('rejects more entries than bundleEntriesMax', () => {
		const many = Array.from({ length: X.LIMITS.bundleEntriesMax + 1 }, validEngine);
		const r = X.validateBundle({ gesturaBundle: 1, entries: many });
		expect(r.ok).toBe(false);
		expect(r.errors).toEqual(['tooManyEntries']);
		expect(r.entries).toEqual([]);
	});

	it('rejects a bundle over bundleBlobMax before looking at entries', () => {
		const fat = { ...validEngine(), suffix: 'x' };
		const entries = Array.from({ length: 120 }, () => ({ ...fat, transformCode: 'y'.repeat(9000), transformEnabled: true }));
		const r = X.validateBundle({ gesturaBundle: 1, entries });
		expect(r.ok).toBe(false);
		expect(r.errors).toEqual(['tooLarge']);
	});

	it('lets a single oversized entry fail on its own', () => {
		const huge = { ...validMenu(), id: 'com.example.huge', description: { en: 'z'.repeat(1999) } };
		huge.items = Array.from({ length: 100 }, (_, i) => ({
			id: 'i' + i, label: { en: 'q'.repeat(199) }, action: 'openCustomUrl',
			customUrl: 'https://example.com/' + 'p'.repeat(900),
		}));
		const r = X.validateBundle(bundle(huge, validEngine()));
		expect(r.ok).toBe(true);
		expect(r.entries[0].ok).toBe(false);
		expect(r.entries[0].errors).toContain('tooLarge');
		expect(r.entries[1].ok).toBe(true);
	});
});
