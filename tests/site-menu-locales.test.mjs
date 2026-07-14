import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Alle in diesem Feature eingeführten Keys müssen in JEDER Locale existieren.
const NEW_KEY_PREFIXES = ['siteMenuItem', 'siteMenu', 'iconPicker', 'menuMode', 'fork'];
const NEW_KEYS_EXPLICIT = ['customMenuOwnLabel', 'menuFallbackLabel', 'menuFallbackNone', 'editGlobalMenuHint', 'openSiteMenusSection'];

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '_locales');
const en = JSON.parse(readFileSync(join(localesDir, 'en', 'messages.json'), 'utf8'));
const featureKeys = Object.keys(en).filter(k =>
	NEW_KEYS_EXPLICIT.includes(k) || NEW_KEY_PREFIXES.some(p => k.startsWith(p)));

describe('site-menu locale completeness', () => {
	it('collected feature keys from en', () => {
		expect(featureKeys.length).toBeGreaterThanOrEqual(60);
	});
	for (const lang of readdirSync(localesDir)) {
		it(`${lang} has all feature keys`, () => {
			const cat = JSON.parse(readFileSync(join(localesDir, lang, 'messages.json'), 'utf8'));
			const missing = featureKeys.filter(k => !cat[k] || !cat[k].message);
			expect(missing, `${lang} missing: ${missing.join(', ')}`).toEqual([]);
		});
	}
});
