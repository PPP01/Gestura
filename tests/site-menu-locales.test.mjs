import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Alle in diesem Feature eingeführten Keys müssen in JEDER Locale existieren.
const NEW_KEY_PREFIXES = ['siteMenuItem', 'siteMenu', 'iconPicker', 'menuMode', 'fork', 'storage', 'euIntegration', 'euSync', 'settingsPreview', 'blacklist'];
const NEW_KEYS_EXPLICIT = ['customMenuOwnLabel', 'menuFallbackLabel', 'menuFallbackNone', 'editGlobalMenuHint', 'openSiteMenusSection',
	'importDoneTitle', 'importBadgeNew', 'exchangeConflictModified', 'menuBlacklisted'];

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '_locales');
const en = JSON.parse(readFileSync(join(localesDir, 'en', 'messages.json'), 'utf8'));

// Keys whose wording is still being settled. They live in en and de only; every
// other locale falls back to en at runtime, which chrome.i18n does on its own for
// a missing key. Translating them means deleting them from this list - the two
// tests below are what keep that from being forgotten before a release.
// Empty since all 175 pending keys were translated into the 37 other locales.
const PENDING_TRANSLATION = ['euSyncErrorStale', 'euSyncErrorChangedMeanwhile', 'euSyncErrorDismiss', 'euSyncActive',
	'settingsPreviewAreaGestures',
	'settingsPreviewAreaMenus',
	'settingsPreviewAreaEngines',
	'settingsPreviewAreaSettings',
	'settingsPreviewChangeAdded',
	'settingsPreviewChangeRemoved',
	'settingsPreviewChangeChanged',
	'settingsPreviewChangeValue',
	'settingsPreviewChangeMore',
	'settingsPreviewChangeLess',
	'settingsPreviewChangeNone',
	'settingsPreviewTechnical',
	'settingsPreviewFullJson',
	'settingsPreviewChangeHere',
	'settingsPreviewChangeThere',
	'settingsPreviewMergeCombines',
	'euSyncRename',
	'euSyncRenamePrompt',
	'euSyncRenameUnavailable',
	'euSyncOffTitle',
	'euSyncOffBody',
	'euSyncOffKeep',
	'euSyncOffDeleteAll',
	'euSyncOffDeleteAllDesc',
	'euSyncCodeShow',
	'euSyncCodeHide',
	'euSyncCodeHiddenLabel',
	'euSyncStatesCount',
	'euSyncSecretLoad',
	'euSyncSecretUseConfirmTitle',
	'euSyncSecretLoaded',
	'euSyncCodeSwitchTitle',
	'euSyncCodeSwitchDesc',
	'euSyncCodeSwitchLockedUnknown',
	'euSyncCodeSwitchUnlock',
	'euSyncStatesOne',
	'euSyncStatesMany',
	'euSyncReplaceCount',
	'euSyncDeleteCount',
	'euSyncOffNothingLeft',
	'euSyncUnreachable',
	'euSyncMaintenance',
	'euSyncMaintenanceUntil',
	'euSyncMaintenanceUntilDate',
	'euSyncChoiceLabel',
	'euSyncCardBrowserTitle',
	'euSyncCardBrowserDesc',
	'euSyncCardLocalTitle',
	'euSyncCardLocalDesc',
	'euSyncCardEuTitle',
	'euSyncCardEuDesc',
	'euSyncCardSwitchConfirm',
	'euSyncStatusSaved',
	'euSyncStatusWayBrowser',
	'euSyncStatusWayLocal',
	'euSyncStatusWayEu',
	'euSyncRepair',
	'euSyncRetry',
	'euSyncConnecting',
	'euSyncOffToBrowser',
	'euSyncWizardTitle',
	'euSyncWizardBack',
	'euSyncWizardClose',
	'euSyncWizardBrowserSyncBox',
	'euSyncWizardNewTitle',
	'euSyncWizardNewDesc',
	'euSyncWizardExistingTitle',
	'euSyncWizardExistingDesc',
	'euSyncWizardSaveHint',
	'euSyncWizardNamePlaceholder',
	'euSyncWizardNameLabel',
	'euSyncWizardUploadFirst',
	'euSyncWizardExistingEmpty',
	'euSyncWizardOtherTab',
	'euSyncWizardSaveFailed',
	'euSyncAfterWayB',
	'euSyncWizardKeptCode',
	'euSyncWizardKeptContinue',
	'euSyncWizardKeptOther',
	'euSyncCodeSwitchLockedOne',
	'euSyncCodeSwitchLockedMany',
	'euSyncCodeSwitchHere',
	'euSyncCodeLoadTitle',
	'euSyncCodeNewDesc',
	'euSyncCodeNewButton',
	'euSyncDeleteAllDesc',
	'euSyncDeleteAllEmpty',
	'euSyncDeleteAllButton',
	'euSyncListFailed',
	'euSyncStorageMoreRoom',
	'euSyncStorageWayEuDesc',
	'euSyncStorageWayEuUnreachable'];
// Changed wording in all 39 locales, not caught by a test: euSyncConsentLead and
// euSyncConsentPoint1..5 (+Label) - the onboarding consent text, CURRENT_SYNC_CONSENT 2
// (2026-10-09). The other 37 still carry the version-1 text; translate before the release.
// Changed wording in all 39 locales, not caught by a test: euIntegrationIntro
// (sync is no longer 'being built' there and is independent of the integration).
// Changed wording in all 39 locales, not caught by a test: euSyncSecretNewConfirm
// (en/de now say the old states stay reachable while the old code exists anywhere; 37 still say they are lost).
// Changed wording in all 39 locales, not caught by a test: Stand/state -> Profil/profile
// (onboarding design §2) in euSyncSecretDesc, euSyncSecretNewConfirm, euSyncSecretPairDesc, euSyncStatesTitle, euSyncCreate, euSyncDeleteConfirm, euSyncDeleteAllConfirm, euSyncStateBroken, euSyncDuplicateName, euSyncQuotaReached, euSyncErrorNotFound, euSyncErrorQuotaStates, euSyncErrorConflict, euSyncMergeNewerVersion, euSyncMergeNoBase, euSyncMergeMovedAgain, euSyncMergeTheirs, euSyncMergeAllTheirs;
// the 37 others still say "state".

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
