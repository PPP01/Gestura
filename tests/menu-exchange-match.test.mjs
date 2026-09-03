import { describe, it, expect } from 'vitest';
import '../js/menu-exchange.js';
const X = globalThis.FlowMouseMenuExchange;

const PROD = 'https://gestura.eu';
const DEV = 'http://localhost:5173';
const s = (indexId, indexOrigin) => ({ type: indexOrigin ? 'site' : 'file', indexId, ...(indexOrigin ? { indexOrigin } : {}) });
const val = { id: 'com.same' };
const CAT_MENUS = [{ id: 'google', name: 'Google' }];

const menus = (custom) => ({ custom, edited: {} });
const engines = (custom, overrides = {}) => ({ custom, overrides });

describe('matchImport — the same id from production, dev origin and a file', () => {
	const branch = menus({
		m_prod: { name: 'Prod', source: s('com.same', PROD) },
		m_dev: { name: 'Dev', source: s('com.same', DEV) },
		m_file: { name: 'File', source: s('com.same', null) },
	});
	it('a production import matches only the production entry', () => {
		expect(X.matchImport('menu', val, { type: 'site', indexOrigin: PROD }, branch, [])).toEqual({ id: 'm_prod', name: 'Prod', own: true });
	});
	it('a dev import matches only the dev entry', () => {
		expect(X.matchImport('menu', val, { type: 'site', indexOrigin: DEV }, branch, [])).toEqual({ id: 'm_dev', name: 'Dev', own: true });
	});
	it('a file import with qualified entries in the way is ambiguous', () => {
		const m = X.matchImport('menu', val, { type: 'file' }, branch, []);
		expect(m.ambiguous).toBe(true);
		expect(m.candidates.map(c => c.id).sort()).toEqual(['m_dev', 'm_file', 'm_prod']);
	});
});

describe('matchImport — unqualified imports', () => {
	it('matches the single unqualified entry when nothing qualified exists', () => {
		const branch = menus({ m_file: { name: 'File', source: s('com.same', null) } });
		expect(X.matchImport('menu', val, { type: 'file' }, branch, [])).toEqual({ id: 'm_file', name: 'File', own: true });
	});
	it('never automatically overwrites a qualified entry', () => {
		const branch = menus({ m_prod: { name: 'Prod', source: s('com.same', PROD) } });
		expect(X.matchImport('menu', val, { type: 'file' }, branch, []).ambiguous).toBe(true);
	});
	it('two unqualified entries are ambiguous', () => {
		const branch = menus({ a: { name: 'A', source: s('com.same', null) }, b: { name: 'B', source: s('com.same', null) } });
		expect(X.matchImport('menu', val, { type: 'url', url: 'https://x/y.json' }, branch, []).ambiguous).toBe(true);
	});
});

describe('matchImport — qualified imports', () => {
	it('ignores unqualified entries with the same id and falls through', () => {
		const branch = menus({ m_file: { name: 'File', source: s('com.same', null) } });
		expect(X.matchImport('menu', val, { type: 'site', indexOrigin: PROD }, branch, [])).toBe(null);
	});
	it('two entries from the same origin are ambiguous', () => {
		const branch = menus({ a: { name: 'A', source: s('com.same', PROD) }, b: { name: 'B', source: s('com.same', PROD) } });
		expect(X.matchImport('menu', val, { type: 'site', indexOrigin: PROD }, branch, []).ambiguous).toBe(true);
	});
});

describe('matchImport — catalog fallback and storage places', () => {
	it('falls back to the catalog entry with own:false', () => {
		expect(X.matchImport('menu', { id: 'google' }, { type: 'file' }, menus({}), CAT_MENUS)).toEqual({ id: 'google', name: 'Google', own: false });
	});
	it('an occupied catalog slot is ambiguous, never a blind "replace the standard entry"', () => {
		// The user edited the catalog menu by hand: no provenance at all.
		const handEdited = { custom: {}, edited: { google: { name: 'My Google' } } };
		expect(X.matchImport('menu', { id: 'google' }, { type: 'site', indexOrigin: PROD }, handEdited, CAT_MENUS))
			.toEqual({ ambiguous: true, candidates: [{ id: 'google', name: 'My Google', indexOrigin: null }] });
		// Another origin already owns the single edited[] slot.
		const devOwned = { custom: {}, edited: { google: { name: 'Dev Google', source: s('google', DEV) } } };
		expect(X.matchImport('menu', { id: 'google' }, { type: 'site', indexOrigin: PROD }, devOwned, CAT_MENUS).ambiguous).toBe(true);
		// Same origin: still a normal update, not ambiguous.
		const ours = { custom: {}, edited: { google: { name: 'Ours', source: s('google', PROD) } } };
		expect(X.matchImport('menu', { id: 'google' }, { type: 'site', indexOrigin: PROD }, ours, CAT_MENUS)).toEqual({ id: 'google', name: 'Ours', own: true });
	});
	it('an occupied override slot is ambiguous for engines too', () => {
		const CAT_ENGINES = [{ id: 'bing', name: 'Bing' }];
		expect(X.matchImport('engine', { id: 'bing' }, { type: 'site', indexOrigin: PROD }, engines([], { bing: { name: 'My Bing' } }), CAT_ENGINES).ambiguous).toBe(true);
		expect(X.matchImport('engine', { id: 'bing' }, { type: 'site', indexOrigin: PROD }, engines([]), CAT_ENGINES)).toEqual({ id: 'bing', name: 'Bing', own: false });
	});
	it('an edited catalog copy with provenance is an own match on its catalog id', () => {
		const branch = { custom: {}, edited: { google: { name: 'G2', source: s('google', PROD) } } };
		expect(X.matchImport('menu', { id: 'google' }, { type: 'site', indexOrigin: PROD }, branch, CAT_MENUS)).toEqual({ id: 'google', name: 'G2', own: true });
	});
	it('engines: custom list and overrides are both searched', () => {
		const branch = engines([{ id: 'eng_1', name: 'E', source: s('com.e', PROD) }], { bing: { name: 'B2', source: s('bing', PROD) } });
		expect(X.matchImport('engine', { id: 'com.e' }, { type: 'site', indexOrigin: PROD }, branch, [])).toEqual({ id: 'eng_1', name: 'E', own: true });
		expect(X.matchImport('engine', { id: 'bing' }, { type: 'site', indexOrigin: PROD }, branch, [])).toEqual({ id: 'bing', name: 'B2', own: true });
	});
	it('returns null when nothing matches anywhere', () => {
		expect(X.matchImport('engine', { id: 'com.none' }, { type: 'file' }, engines([]), [])).toBe(null);
	});
	it('tolerates missing branches', () => {
		expect(X.matchImport('menu', val, { type: 'file' }, undefined, undefined)).toBe(null);
	});
});
