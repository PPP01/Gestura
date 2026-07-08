import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(__dirname, '..', 'pages');

// content.js consumes these window.* globals at gesture time. Any extension page
// that loads content.js must load its script dependencies too, or actions crash
// (e.g. resolveContextualMenuId -> window.FlowMouseSearchUrl.matchesPatterns).
const REQUIRED_BEFORE_CONTENT = [
	'constants.js',
	'gesture-visual.js',
	'gesture-recognizer.js',
	'search-url.js',
	'search-engines-catalog.js',
	'engine-registry.js',
];

function scriptSrcOrder(html) {
	return [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(m => m[1].split('/').pop());
}

const pages = readdirSync(pagesDir).filter(f => f.endsWith('.html'));
const contentPages = pages.filter(f =>
	scriptSrcOrder(readFileSync(join(pagesDir, f), 'utf8')).includes('content.js'));

describe('extension pages that load content.js', () => {
	it('finds at least one such page', () => {
		expect(contentPages.length).toBeGreaterThan(0);
	});

	for (const page of contentPages) {
		const scripts = scriptSrcOrder(readFileSync(join(pagesDir, page), 'utf8'));
		const contentIdx = scripts.indexOf('content.js');
		for (const dep of REQUIRED_BEFORE_CONTENT) {
			it(`${page} loads ${dep} before content.js`, () => {
				const depIdx = scripts.indexOf(dep);
				expect(depIdx, `${page} is missing ${dep}`).toBeGreaterThanOrEqual(0);
				expect(depIdx).toBeLessThan(contentIdx);
			});
		}
	}
});
