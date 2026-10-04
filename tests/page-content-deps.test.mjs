import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(__dirname, '..', 'pages');

// content.js consumes these window.* globals at gesture time. Any extension page
// that loads content.js must load its script dependencies too, or actions crash
// (e.g. resolveGestureMenu -> window.FlowMouseMenuCatalog / window.FlowMouseMenuModel,
// or window.FlowMouseSearchUrl.matchesPatterns).
const REQUIRED_BEFORE_CONTENT = [
	'constants.js',
	'settings-storage.js',
	'gesture-visual.js',
	'gesture-recognizer.js',
	'search-url.js',
	'search-engines-catalog.js',
	'engine-registry.js',
	'menu-catalog.js',
	'menu-model.js',
	'page-icons.js',
	'page-icons-homeassistant.js',
	'blacklist-match.js',
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

// The façade needs DEFAULT_SETTINGS, and i18n.js reads theme and language THROUGH
// the façade at load time (js/i18n.js: `initPromise = init()` runs synchronously up
// to its first await, which is that read). So on every page that loads i18n.js the
// order is constants.js → settings-storage.js → i18n.js. Nothing in the browser
// says so - a wrong order is an exception in the console and an unstyled page.
const i18nPages = pages.filter(f =>
	scriptSrcOrder(readFileSync(join(pagesDir, f), 'utf8')).includes('i18n.js'));

describe('extension pages that load i18n.js', () => {
	it('finds at least one such page', () => {
		expect(i18nPages.length).toBeGreaterThan(0);
	});

	for (const page of i18nPages) {
		it(`${page} loads constants.js, then settings-storage.js, then i18n.js`, () => {
			const scripts = scriptSrcOrder(readFileSync(join(pagesDir, page), 'utf8'));
			const c = scripts.indexOf('constants.js');
			const s = scripts.indexOf('settings-storage.js');
			const i = scripts.indexOf('i18n.js');
			expect(c, `${page} is missing constants.js`).toBeGreaterThanOrEqual(0);
			expect(s, `${page} is missing settings-storage.js`).toBeGreaterThanOrEqual(0);
			expect(c).toBeLessThan(s);
			expect(s).toBeLessThan(i);
		});
	}
});

// popup.html loads neither content.js nor i18n.js in the shape the blocks above
// look for, so it was reached by no assertion — and it needs GesturaBlacklist for
// the switch that decides whether the current tab is blocked.
describe('extension pages that load popup-page.js', () => {
	const order = (html) => [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(m => m[1].split('/').pop());
	const popupPages = pages.filter(f =>
		order(readFileSync(join(pagesDir, f), 'utf8')).includes('popup-page.js'));

	it('finds at least one such page', () => {
		expect(popupPages.length).toBeGreaterThan(0);
	});

	for (const page of popupPages) {
		it(`${page} loads blacklist-match.js before popup-page.js`, () => {
			const scripts = order(readFileSync(join(pagesDir, page), 'utf8'));
			const b = scripts.indexOf('blacklist-match.js');
			expect(b, `${page} is missing blacklist-match.js`).toBeGreaterThanOrEqual(0);
			expect(b).toBeLessThan(scripts.indexOf('popup-page.js'));
		});
	}
});
