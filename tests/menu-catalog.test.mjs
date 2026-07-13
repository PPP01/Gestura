import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import '../js/menu-icons.js';
import '../js/menu-catalog.js';

const { SITE_MENU_CATALOG } = globalThis.FlowMouseMenuCatalog;
const ICONS = globalThis.FlowMouseMenuIcons;
const en = JSON.parse(readFileSync(new URL('../_locales/en/messages.json', import.meta.url), 'utf8'));
const de = JSON.parse(readFileSync(new URL('../_locales/de/messages.json', import.meta.url), 'utf8'));

describe('SITE_MENU_CATALOG', () => {
	it('has the expected menus', () => {
		expect(SITE_MENU_CATALOG.map(m => m.id)).toEqual([
			'github', 'm365', 'amazon', 'google', 'gmail', 'gmaps', 'youtube',
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
	it('menus: brand name, valid icon, at least one pattern', () => {
		for (const m of SITE_MENU_CATALOG) {
			expect(typeof m.name, m.id).toBe('string');
			expect(ICONS[m.icon], `${m.id}: icon ${m.icon}`).toBeTruthy();
			expect(m.patterns.length, m.id).toBeGreaterThan(0);
		}
	});
	it('items: label present (labelKey in en+de, or customName), icon valid, urls https', () => {
		for (const m of SITE_MENU_CATALOG) {
			for (const it of m.items) {
				if (it.type === 'separator') continue;
				expect(!!it.labelKey || !!it.customName, `${it.id}: no label`).toBe(true);
				if (it.labelKey) {
					expect(en[it.labelKey], `en missing ${it.labelKey}`).toBeTruthy();
					expect(de[it.labelKey], `de missing ${it.labelKey}`).toBeTruthy();
				}
				if (it.icon) expect(ICONS[it.icon], `${it.id}: icon ${it.icon}`).toBeTruthy();
				expect(it.action, it.id).toBe('openCustomUrl');
				expect(it.customUrl, it.id).toMatch(/^https:\/\//);
				if (it.customUrl.includes('{domain}')) {
					expect(m.domains, `${m.id} uses {domain} without domains config`).toBeTruthy();
				}
			}
		}
	});
	it('domains config: default is one of choices', () => {
		for (const m of SITE_MENU_CATALOG) {
			if (!m.domains) continue;
			expect(m.domains.choices).toContain(m.domains.default);
		}
	});
});
