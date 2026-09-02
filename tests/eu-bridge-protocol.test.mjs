import { describe, it, expect } from 'vitest';
import '../js/eu-integration.js';
const EU = globalThis.FlowMouseEuIntegration;

const PROD = 'https://gestura.eu';
const DEV = 'http://localhost:5173';
const src = (indexId, indexOrigin, extra = {}) => ({ type: 'site', indexId, ...(indexOrigin ? { indexOrigin } : {}), version: '1.2.0', ...extra });

async function settingsWithBaselines() {
	const s = {
		siteMenus: {
			custom: {
				menu_a: { name: 'A', icon: 'menu', patterns: [], items: [], source: src('com.a', PROD) },
				menu_b: { name: 'B', icon: 'menu', patterns: [], items: [], source: src('com.b', DEV) },
				menu_f: { name: 'F', icon: 'menu', patterns: [], items: [], source: src('com.f', null) },
				menu_own: { name: 'Own', icon: 'menu', patterns: [], items: [] },
			},
			edited: { google: { name: 'G', icon: 'search', patterns: ['*google*'], items: [], source: src('google', PROD) } },
		},
		searchEngines: {
			custom: [{ id: 'eng_1', name: 'E', url: 'https://e/%s', type: 'text', builtin: false, source: src('com.e', PROD) }],
			overrides: { bing: { name: 'Bing2', url: 'https://b/%s', source: src('bing', PROD) } },
		},
	};
	for (const e of EU.listProvenanced(s)) e.stored.source.baselineHash = await EU.baselineHash(e.stored);
	return s;
}

describe('parseBridgeRequest', () => {
	const ok = JSON.stringify({ requestId: 'r1', ids: ['com.a', 'com.b'] });
	it('accepts a well-formed request', () => {
		expect(EU.parseBridgeRequest(ok)).toEqual({ requestId: 'r1', ids: ['com.a', 'com.b'] });
		expect(EU.parseBridgeRequest(JSON.stringify({ requestId: 'r1' }))).toEqual({ requestId: 'r1' });
	});
	it.each([
		['not a string', 42],
		['empty', ''],
		['bad json', '{'],
		['array', '[]'],
		['no requestId', JSON.stringify({ ids: [] })],
		['requestId too long', JSON.stringify({ requestId: 'x'.repeat(65) })],
		['ids not array', JSON.stringify({ requestId: 'r', ids: 'com.a' })],
		['too many ids', JSON.stringify({ requestId: 'r', ids: Array.from({ length: 101 }, (_, i) => 'id' + i) })],
		['id violates pattern', JSON.stringify({ requestId: 'r', ids: ['__proto__'] })],
		['id too long', JSON.stringify({ requestId: 'r', ids: ['a'.repeat(129)] })],
		['non-string id', JSON.stringify({ requestId: 'r', ids: [1] })],
	])('rejects %s with null', (_, detail) => { expect(EU.parseBridgeRequest(detail)).toBe(null); });
	it('rejects an over-limit detail before parsing', () => {
		const huge = JSON.stringify({ requestId: 'r', ids: ['com.a'], junk: 'x'.repeat(EU.LIMITS.detailMaxBytes) });
		expect(EU.parseBridgeRequest(huge)).toBe(null);
	});
	it('accepts a pattern-valid hostile id', () => {
		expect(EU.parseBridgeRequest(JSON.stringify({ requestId: 'r', ids: ['constructor'] }))).toEqual({ requestId: 'r', ids: ['constructor'] });
	});
});

describe('helloAnswer', () => {
	it('echoes requestId, carries version and apiLevel', () => {
		expect(EU.helloAnswer({ requestId: 'r9' }, '2.9.0')).toEqual({ requestId: 'r9', version: '2.9.0', apiLevel: EU.API_LEVEL });
	});
});

describe('statusAnswer', () => {
	it('answers only asked ids, only for the asking origin, as an array', async () => {
		const s = await settingsWithBaselines();
		const a = await EU.statusAnswer({ requestId: 'r', ids: ['com.a', 'com.b', 'com.f', 'nope', 'google', 'bing', 'com.e'] }, PROD, s);
		expect(a.requestId).toBe('r');
		expect(Array.isArray(a.entries)).toBe(true);
		expect(a.entries).toEqual([
			{ id: 'com.a', installed: true, version: '1.2.0', modified: false },
			{ id: 'com.b', installed: false },      // dev-origin entry is invisible to production
			{ id: 'com.f', installed: false },      // file import (no indexOrigin) is never disclosed
			{ id: 'nope', installed: false },
			{ id: 'google', installed: true, version: '1.2.0', modified: false },   // edited catalog copy
			{ id: 'bing', installed: true, version: '1.2.0', modified: false },     // engine override
			{ id: 'com.e', installed: true, version: '1.2.0', modified: false },    // custom engine
		]);
	});
	it('the dev origin sees its own entries and not production ones', async () => {
		const s = await settingsWithBaselines();
		const a = await EU.statusAnswer({ requestId: 'r', ids: ['com.a', 'com.b'] }, DEV, s);
		expect(a.entries).toEqual([{ id: 'com.a', installed: false }, { id: 'com.b', installed: true, version: '1.2.0', modified: false }]);
	});
	it('reports modified after a local edit and unknown without baseline', async () => {
		const s = await settingsWithBaselines();
		s.siteMenus.custom.menu_a.name = 'A edited';
		delete s.searchEngines.custom[0].source.baselineHash;
		const a = await EU.statusAnswer({ requestId: 'r', ids: ['com.a', 'com.e'] }, PROD, s);
		expect(a.entries[0].modified).toBe(true);
		expect(a.entries[1].modified).toBe('unknown');
	});
	it('never enumerates: no ids → empty entries; duplicate ids answered once', async () => {
		const s = await settingsWithBaselines();
		expect((await EU.statusAnswer({ requestId: 'r' }, PROD, s)).entries).toEqual([]);
		expect((await EU.statusAnswer({ requestId: 'r', ids: ['com.a', 'com.a'] }, PROD, s)).entries).toHaveLength(1);
	});
	it('a hostile id is harmless', async () => {
		const s = await settingsWithBaselines();
		const a = await EU.statusAnswer({ requestId: 'r', ids: ['constructor'] }, PROD, s);
		expect(a.entries).toEqual([{ id: 'constructor', installed: false }]);
	});
});

describe('listProvenanced / findStored', () => {
	it('walks all four storage places and skips entries without source', async () => {
		const s = await settingsWithBaselines();
		expect(EU.listProvenanced(s).map(e => `${e.kind}:${e.id}`).sort()).toEqual(['engine:bing', 'engine:eng_1', 'menu:google', 'menu:menu_a', 'menu:menu_b', 'menu:menu_f']);
		expect(EU.findStored(s, 'menu', 'google').name).toBe('G');
		expect(EU.findStored(s, 'engine', 'bing').name).toBe('Bing2');
		expect(EU.findStored(s, 'engine', 'eng_1').name).toBe('E');
		expect(EU.findStored(s, 'menu', 'missing')).toBe(null);
	});
	it('tolerates empty settings', () => {
		expect(EU.listProvenanced({})).toEqual([]);
		expect(EU.findStored({}, 'engine', 'x')).toBe(null);
	});
});
