import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const EXCHANGE_KEYS = [
	'exchangeImportTitle', 'exchangeImportFromFile', 'exchangeImportFromUrl',
	'exchangeImportUrlPlaceholder', 'exchangeExport', 'exchangePreviewTitle',
	'exchangePreviewMenu', 'exchangePreviewEngine', 'exchangePreviewItems',
	'exchangeConfirmImport', 'exchangeCancel', 'exchangeInvalid', 'exchangeInvalidDetail',
	'exchangeScriptWarnTitle', 'exchangeScriptWarnBody', 'exchangeScriptChromeOnly',
	'exchangeScriptChromeOnlyRequired', 'exchangeScriptConfirm',
	'exchangeImportedMenu', 'exchangeImportedEngine', 'exchangeFromSite',
	'exchangeImportAs', 'exchangeReplaceStandard', 'exchangeAddAsNew',
	'exchangeBundleSummary', 'exchangeBundleInvalid', 'exchangeBundleSelectAll',
	'exchangeBundleImport', 'exchangeBundleScriptPending', 'exchangeBundleEmpty',
	'exchangeMissingEngine', 'exchangeUpdateExisting', 'exchangeBadgeExisting',
];

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '_locales');

describe('menu-exchange locale completeness', () => {
	for (const lang of readdirSync(localesDir)) {
		it(`${lang} has all exchange keys`, () => {
			const cat = JSON.parse(readFileSync(join(localesDir, lang, 'messages.json'), 'utf8'));
			const missing = EXCHANGE_KEYS.filter(k => !cat[k] || !cat[k].message);
			expect(missing, `${lang} missing: ${missing.join(', ')}`).toEqual([]);
		});
	}
});
