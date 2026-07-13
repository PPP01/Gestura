import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import '../js/menu-icons.js';
import '../js/menu-catalog.js';
import '../js/search-engines-catalog.js';

const { SITE_MENU_CATALOG } = globalThis.FlowMouseMenuCatalog;
const ICONS = globalThis.FlowMouseMenuIcons;
const ENGINE_IDS = new Set(globalThis.FlowMouseEngineCatalogApi.ENGINE_CATALOG.map(e => e.id));
const en = JSON.parse(readFileSync(new URL('../_locales/en/messages.json', import.meta.url), 'utf8'));
const de = JSON.parse(readFileSync(new URL('../_locales/de/messages.json', import.meta.url), 'utf8'));

describe('SITE_MENU_CATALOG', () => {
	it('has the expected menus', () => {
		expect(SITE_MENU_CATALOG.map(m => m.id)).toEqual([
			'search', 'github', 'm365', 'amazon', 'shopping', 'google', 'gmail', 'gmaps', 'youtube',
			'facebook', 'instagram', 'x', 'reddit', 'linkedin', 'wikipedia',
		]);
	});
	it('menu ids and item ids are globally unique; every item has an id', () => {
		const menuIds = new Set(); const itemIds = new Set();
		for (const m of SITE_MENU_CATALOG) {
			expect(menuIds.has(m.id)).toBe(false); menuIds.add(m.id);
			for (const it of m.items) {
				expect(it.id, `${m.id} item without id`).toBeTruthy();
				expect(itemIds.has(it.id), `duplicate item id ${it.id}`).toBe(false);
				itemIds.add(it.id);
			}
		}
	});
	it('menus: brand name or nameKey (in en+de), valid icon, patterns is an array', () => {
		for (const m of SITE_MENU_CATALOG) {
			expect(!!m.name || !!m.nameKey, `${m.id}: no name/nameKey`).toBe(true);
			if (m.nameKey) {
				expect(en[m.nameKey], `en missing ${m.nameKey}`).toBeTruthy();
				expect(de[m.nameKey], `de missing ${m.nameKey}`).toBeTruthy();
			}
			expect(ICONS[m.icon], `${m.id}: icon ${m.icon}`).toBeTruthy();
			expect(Array.isArray(m.patterns), m.id).toBe(true);
		}
	});
	it('site menus (with patterns) keep at least one pattern', () => {
		for (const m of SITE_MENU_CATALOG) {
			if (m.id === 'search' || m.id === 'shopping') continue;
			expect(m.patterns.length, m.id).toBeGreaterThan(0);
		}
	});
	it('items: label rules, icon valid, links are https, searches reference known engines', () => {
		for (const m of SITE_MENU_CATALOG) {
			for (const it of m.items) {
				if (it.type === 'separator') continue;
				if (it.icon) expect(ICONS[it.icon], `${it.id}: icon ${it.icon}`).toBeTruthy();
				if (it.action === 'searchLink') {
					// Label und Icon kommen aus der Engine-Registry; engineId muss existieren.
					expect(ENGINE_IDS.has(it.engineId), `${it.id}: unknown engine ${it.engineId}`).toBe(true);
					continue;
				}
				expect(it.action, it.id).toBe('openCustomUrl');
				expect(!!it.labelKey || !!it.customName, `${it.id}: no label`).toBe(true);
				if (it.labelKey) {
					expect(en[it.labelKey], `en missing ${it.labelKey}`).toBeTruthy();
					expect(de[it.labelKey], `de missing ${it.labelKey}`).toBeTruthy();
				}
				expect(it.customUrl, it.id).toMatch(/^https:\/\//);
				if (it.customUrl.includes('{domain}')) {
					expect(m.domains, `${m.id} uses {domain} without domains config`).toBeTruthy();
				}
			}
		}
	});
	it('the search menu exists with curated engines and the shopping menu with brave/google/amazon/ebay', () => {
		const search = SITE_MENU_CATALOG.find(m => m.id === 'search');
		expect(search.items.filter(i => i.type !== 'separator').map(i => i.engineId))
			.toEqual(['google', 'brave', 'perplexity', 'duckduckgo', 'bing', 'deepl', 'wikipedia']);
		const shopping = SITE_MENU_CATALOG.find(m => m.id === 'shopping');
		expect(shopping.items.filter(i => i.type !== 'separator').map(i => i.engineId))
			.toEqual(['brave', 'google', 'amazon', 'ebay']);
	});
	it('default menuAppend items reference known engines', async () => {
		globalThis.window = globalThis;
		await import('../js/constants.js');
		for (const it of globalThis.GestureConstants.DEFAULT_SETTINGS.menuAppend.items) {
			expect(ENGINE_IDS.has(it.engineId), it.id).toBe(true);
		}
	});
	it('domains config: default is one of choices', () => {
		for (const m of SITE_MENU_CATALOG) {
			if (!m.domains) continue;
			expect(m.domains.choices).toContain(m.domains.default);
		}
	});
});
