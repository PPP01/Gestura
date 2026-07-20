import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// chrome.i18n treats any `$word$` in a message as a PLACEHOLDER that MUST be
// declared in that message's `placeholders` object (names match case-insensitively).
// An undeclared placeholder makes Chrome refuse to load the whole extension:
//   "Variable $X$ used but not defined. Manifest konnte nicht geladen werden."
// (`$$` is an escaped literal `$` and is fine.) If a string needs a runtime
// substitution the code does with `.replace()`, use a NON-`$...$` token such as
// `{detail}` so chrome.i18n never tries to resolve it.
const PLACEHOLDER_RE = /(?<!\$)\$([A-Za-z0-9_@]+)\$/g;

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '_locales');

function undeclaredPlaceholders(entry) {
	const msg = entry && entry.message;
	if (typeof msg !== 'string') return [];
	const declared = new Set(Object.keys(entry.placeholders || {}).map(k => k.toLowerCase()));
	const bad = [];
	for (const m of msg.matchAll(PLACEHOLDER_RE)) {
		if (!declared.has(m[1].toLowerCase())) bad.push(m[0]);
	}
	return bad;
}

describe('locale placeholder safety (chrome.i18n manifest-load guard)', () => {
	for (const lang of readdirSync(localesDir)) {
		it(`${lang} declares every $placeholder$ it uses`, () => {
			const cat = JSON.parse(readFileSync(join(localesDir, lang, 'messages.json'), 'utf8'));
			const offenders = [];
			for (const [key, entry] of Object.entries(cat)) {
				const bad = undeclaredPlaceholders(entry);
				if (bad.length) offenders.push(`${key}: ${bad.join(', ')}`);
			}
			expect(offenders, `${lang} has undeclared placeholders:\n${offenders.join('\n')}`).toEqual([]);
		});
	}
});
