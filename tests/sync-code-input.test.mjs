import { describe, it, expect, beforeAll } from 'vitest';

let checkDraft, maskCode, C;
beforeAll(async () => {
	// sync-code-input.js reads window.GesturaSyncCode, as the pages provide it.
	globalThis.window = globalThis;
	globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } } };
	await import('../js/eu-integration.js');
	await import('../js/eu-sync-code.js');
	C = globalThis.GesturaSyncCode;
	({ checkDraft, maskCode } = await import('../js/components/sync-code-input.js'));
});

const CODE = 'GS1-000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFG-CC6W';

describe('checkDraft (strict validation, as in the panel)', () => {
	it('a valid code is valid, no error', async () => {
		expect(await checkDraft(CODE)).toEqual({ valid: true, error: '' });
	});
	it('a short prefix-only draft is invalid but says nothing yet', async () => {
		expect(await checkDraft('GS')).toEqual({ valid: false, error: '' });
	});
	it('a wrong character is said at once', async () => {
		expect((await checkDraft('GS1-!')).error).toBe('euSyncCodeErrorCharset');
	});
	it('a checksum typo is said once the code is complete', async () => {
		const typo = CODE.slice(0, -1) + (CODE.endsWith('W') ? 'X' : 'W');
		const r = await checkDraft(typo);
		expect(r.valid).toBe(false);
		expect(r.error).toBe('euSyncCodeErrorChecksum');
	});
	it('"too short" is never said while typing - the grey button says it', async () => {
		for (const draft of ['GS1-000G', 'GS1-000G-40R4-0M30', CODE.slice(0, -5)]) {
			expect(await checkDraft(draft)).toEqual({ valid: false, error: '' });
		}
	});
});

describe('maskCode', () => {
	it('keeps the first two groups and the last, dots the rest, same shape', () => {
		const m = maskCode(CODE);
		expect(m.startsWith('GS1-000G-')).toBe(true);
		expect(m.endsWith('-CC6W')).toBe(true);
		expect(m.length).toBe(CODE.length);
		expect(m).toContain('••••');
	});
});
