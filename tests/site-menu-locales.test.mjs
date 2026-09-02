import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Alle in diesem Feature eingeführten Keys müssen in JEDER Locale existieren.
const NEW_KEY_PREFIXES = ['siteMenuItem', 'siteMenu', 'iconPicker', 'menuMode', 'fork', 'storage', 'euIntegration'];
const NEW_KEYS_EXPLICIT = ['customMenuOwnLabel', 'menuFallbackLabel', 'menuFallbackNone', 'editGlobalMenuHint', 'openSiteMenusSection',
	'importDoneTitle', 'importBadgeNew', 'exchangeConflictModified'];

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '_locales');
const en = JSON.parse(readFileSync(join(localesDir, 'en', 'messages.json'), 'utf8'));

// Keys whose wording is still being settled. They live in en and de only; every
// other locale falls back to en at runtime, which chrome.i18n does on its own for
// a missing key. Translating them means deleting them from this list - the two
// tests below are what keep that from being forgotten before a release.
const PENDING_TRANSLATION = ['euIntegrationIntro', 'euIntegrationIntroLink',
	'euIntegrationConsentLead', 'euIntegrationConsentPoint4', 'euIntegrationConsentGranted',
	'euIntegrationConsentDate', 'euIntegrationConsentRevoke',
	'euIntegrationConsentPoint1Label', 'euIntegrationConsentPoint2Label',
	'euIntegrationConsentPoint3Label', 'euIntegrationConsentPoint4Label',
	'euIntegrationConsentPoint1', 'euIntegrationConsentPoint5Label', 'euIntegrationConsentPoint5',
	'euIntegrationUpdateCheck', 'euIntegrationCheckNow',
	'euIntegrationLastChecked', 'euIntegrationNeverChecked',
	'exchangeConflictModified'];

const featureKeys = Object.keys(en).filter(k =>
	!PENDING_TRANSLATION.includes(k)
	&& (NEW_KEYS_EXPLICIT.includes(k) || NEW_KEY_PREFIXES.some(p => k.startsWith(p))));

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

describe('keys still awaiting translation', () => {
	it('exist in the two development locales', () => {
		for (const lang of ['en', 'de']) {
			const cat = JSON.parse(readFileSync(join(localesDir, lang, 'messages.json'), 'utf8'));
			const missing = PENDING_TRANSLATION.filter(k => !cat[k] || !cat[k].message);
			expect(missing, `${lang} missing: ${missing.join(', ')}`).toEqual([]);
		}
	});

	// Fails once every locale has the key, which is the signal to delete it from
	// PENDING_TRANSLATION and let the completeness check above take it over.
	it('are not yet complete everywhere, or have been removed from the list', () => {
		const langs = readdirSync(localesDir);
		for (const k of PENDING_TRANSLATION) {
			const have = langs.filter(lang =>
				JSON.parse(readFileSync(join(localesDir, lang, 'messages.json'), 'utf8'))[k]);
			expect(have.length, `${k} is translated in all ${langs.length} locales - drop it from PENDING_TRANSLATION`)
				.toBeLessThan(langs.length);
		}
	});
});
