import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The drift CLAUDE.md warns about, with a test instead of a reminder: every
// helper js/background.js pulls in via importScripts must also be listed in
// background.scripts of the Gecko manifest, because Firefox has no
// importScripts in a background script and loads them from the manifest alone.
//
// This was not hypothetical. Merging R1+R2 into firefox-build added
// eu-integration.js and eu-local.js to the importScripts list; background.scripts
// still named five helpers, so both globals would have been undefined in the
// Firefox worker - which the hand-off path calls on every import from a website.
// Nothing failed, nothing warned; the extension would simply have thrown at
// runtime in one browser.
//
// On `main` the manifest has a service_worker and no background.scripts at all,
// so the test reports itself as not applicable there rather than failing. That
// keeps the file harmless if it ever travels to the Chrome branch.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const background = readFileSync(join(root, 'js', 'background.js'), 'utf8');

// Only the calls, not the comments around them.
const imported = [...background.matchAll(/^\s*importScripts\('([^']+)'\)/gm)].map(m => m[1]);
const declared = manifest.background && Array.isArray(manifest.background.scripts)
	? manifest.background.scripts
	: null;

describe('Firefox background parity', () => {
	it('background.js pulls in at least the known helpers', () => {
		expect(imported.length).toBeGreaterThanOrEqual(5);
	});

	it.skipIf(!declared)('background.scripts lists every importScripts entry, in the same order', () => {
		// background.js itself closes the list - it is the file doing the importing.
		const helpers = declared.map(s => s.replace(/^js\//, '')).filter(s => s !== 'background.js');
		expect(helpers).toEqual(imported);
	});

	it.skipIf(!declared)('background.js is the last entry, so its helpers exist when it runs', () => {
		expect(declared[declared.length - 1]).toBe('js/background.js');
	});

	it.skipIf(!declared)('every declared script exists on disk', () => {
		for (const rel of declared) {
			expect(() => readFileSync(join(root, rel)), `${rel} is declared but missing`).not.toThrow();
		}
	});

	// The counterpart: a file that must NOT be here. eu-updates.js is loaded by
	// pages/options.html only; putting it in the worker would give the update
	// check a second home that nothing throttles together with the first.
	it.skipIf(!declared)('does not drag the options-page-only update check into the worker', () => {
		expect(declared.some(s => s.includes('eu-updates'))).toBe(false);
		expect(imported.some(s => s.includes('eu-updates'))).toBe(false);
	});
});
