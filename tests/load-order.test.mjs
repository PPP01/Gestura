import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// js/settings-storage.js is the only thing that reads or writes settings, and it
// needs DEFAULT_SETTINGS from js/constants.js at load time. So in every list
// that loads scripts - the content-script list of manifest.json, the
// importScripts block of js/background.js, and each extension page - those two
// come first, in that order.
//
// Nothing in the browser says so. Getting it wrong is
// "GesturaSettingsStorage is not defined" at document_start in every frame of
// every page: gestures dead, menus dead, options page blank. The repo's own
// convention is that a gotcha of that size is enforced by a test rather than
// described in prose.
//
// The Firefox manifest carries the same list under background.scripts and lives
// on the firefox-build branch, where this file arrives by merge and covers the
// two lists that are here.
const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, '..');

const FIRST_TWO = ['js/constants.js', 'js/settings-storage.js'];

describe('manifest.json content scripts', () => {
	const manifest = JSON.parse(readFileSync(join(repo, 'manifest.json'), 'utf8'));
	const list = manifest.content_scripts[0].js;

	it('begins with constants.js, then settings-storage.js', () => {
		expect(list.slice(0, 2)).toEqual(FIRST_TWO);
	});

	it('names only files that exist', () => {
		const missing = list.filter(f => !existsSync(join(repo, f)));
		expect(missing, `missing: ${missing.join(', ')}`).toEqual([]);
	});

	// GesturaBlacklist decides whether a frame gets gestures at all, so it has to
	// be defined before content.js runs.
	it('loads blacklist-match.js before content.js', () => {
		const b = list.indexOf('js/blacklist-match.js');
		const c = list.indexOf('js/content.js');
		expect(b, 'js/blacklist-match.js missing from content_scripts').toBeGreaterThanOrEqual(0);
		expect(b).toBeLessThan(c);
	});
});

// Inert here and load-bearing after the merge into firefox-build: that branch
// carries its own complete manifest.json, where background.scripts replaces the
// service worker. Firefox has no importScripts, so a missing entry there is the
// same dead extension - on the first context-menu click instead of at
// document_start. This file travels with the merge, so the guard arrives with it.
describe('the Gecko manifest background.scripts list', () => {
	const manifest = JSON.parse(readFileSync(join(repo, 'manifest.json'), 'utf8'));
	const scripts = manifest.background && manifest.background.scripts;

	it.skipIf(!Array.isArray(scripts))('begins with constants.js, then settings-storage.js', () => {
		expect(scripts.slice(0, 2)).toEqual(FIRST_TWO);
	});

	it.skipIf(!Array.isArray(scripts))('loads blacklist-match.js before background.js', () => {
		const b = scripts.indexOf('js/blacklist-match.js');
		const g = scripts.indexOf('js/background.js');
		expect(b, 'js/blacklist-match.js missing from background.scripts').toBeGreaterThanOrEqual(0);
		expect(b).toBeLessThan(g);
	});
});

describe('the service worker importScripts block', () => {
	// Relative to js/, which is where background.js runs from.
	const src = readFileSync(join(repo, 'js', 'background.js'), 'utf8');
	const imported = [...src.matchAll(/importScripts\(\s*'([^']+)'\s*\)/g)].map(m => m[1]);

	it('begins with constants.js, then settings-storage.js', () => {
		expect(imported.length).toBeGreaterThan(2);
		expect(imported.slice(0, 2).map(f => `js/${f}`)).toEqual(FIRST_TWO);
	});

	it('names only files that exist', () => {
		const missing = imported.filter(f => !existsSync(join(repo, 'js', f)));
		expect(missing, `missing: ${missing.join(', ')}`).toEqual([]);
	});

	it('imports blacklist-match.js', () => {
		expect(imported).toContain('blacklist-match.js');
	});
});

// tests/page-content-deps.test.mjs covers the pages that load content.js and the
// pages that load i18n.js. pages/context-menu.html is in neither set and was
// reached by no assertion at all, though it loads the façade like the rest.
describe('extension pages that load settings-storage.js', () => {
	const pagesDir = join(repo, 'pages');
	const order = (html) => [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(m => m[1].split('/').pop());
	const pages = readdirSync(pagesDir).filter(f => f.endsWith('.html'))
		.filter(f => order(readFileSync(join(pagesDir, f), 'utf8')).includes('settings-storage.js'));

	it('finds at least one such page', () => {
		expect(pages.length).toBeGreaterThan(0);
	});

	for (const page of pages) {
		it(`${page} loads constants.js before settings-storage.js`, () => {
			const scripts = order(readFileSync(join(pagesDir, page), 'utf8'));
			const c = scripts.indexOf('constants.js');
			expect(c, `${page} is missing constants.js`).toBeGreaterThanOrEqual(0);
			expect(c).toBeLessThan(scripts.indexOf('settings-storage.js'));
		});
	}
});
