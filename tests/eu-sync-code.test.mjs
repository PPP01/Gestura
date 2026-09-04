import { describe, it, expect } from 'vitest';
import '../js/eu-sync-code.js';
const C = globalThis.GesturaSyncCode;

// The two vectors from docs/gestura-eu-api.md. They are the contract: if one of
// these ever changes, every code a user wrote down stops working.
const VECTORS = [
	{
		hex: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
		code: 'GS1-000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFG-CC6W',
	},
	{
		hex: '6e31aaf7266804808840320a2a6550b0b8fe93f7b88bcc96e016452a69840aa8',
		code: 'GS1-DRRT-NXS6-D028-1220-6852-MSAG-P2WF-X4ZQ-Q25W-S5Q0-2S2J-MTC4-1AM0-56KY',
	},
];
const CODE = VECTORS[0].code;

describe('secret code', () => {
	it('encodes both vectors exactly', async () => {
		for (const v of VECTORS) {
			expect(await C.encode(C.fromHex(v.hex))).toBe(v.code);
		}
	});

	it('parses both vectors back to their bytes', async () => {
		for (const v of VECTORS) {
			const out = await C.parse(v.code);
			expect(C.toHex(out.secret)).toBe(v.hex);
		}
	});

	// Forgiving input: a code is read off a screen, out of a password manager or
	// off a piece of paper, and none of those preserve case or separators.
	it.each([
		['lower case', CODE.toLowerCase()],
		['no separators', CODE.replace(/-/g, '')],
		['spaces instead of dashes', CODE.replace(/-/g, ' ')],
		['surrounding whitespace', `\n  ${CODE}  \n`],
		['Crockford aliases I, L and O', CODE.replace('0M30', 'OM3O')],
	])('accepts %s', async (_label, input) => {
		const out = await C.parse(input);
		expect(C.toHex(out.secret)).toBe(VECTORS[0].hex);
	});

	// A typo must be an error. The alternative - decoding to a different secret -
	// derives a different locator, which addresses an empty blob store: the user
	// would be told their states are gone rather than that they mistyped.
	it.each([
		['a checksum typo', CODE.replace('CC6W', 'CC6X'), 'checksum'],
		['a body typo', CODE.replace('40R4', '40R5'), 'checksum'],
		['the excluded letter U', CODE.replace('CC6W', 'CC6U'), 'charset'],
		['a stray character', CODE + '.', 'charset'],
		['a truncated code', CODE.slice(0, 40), 'length'],
		['a code without the prefix', CODE.slice(4), 'prefix'],
		['a future prefix', CODE.replace('GS1', 'GS2'), 'prefix'],
		['non-zero padding bits', CODE.replace('3RFG', '3RFH'), 'padding'],
	])('rejects %s', async (_label, input, code) => {
		expect(await C.parse(input)).toEqual({ error: code });
	});

	it('rejects a non-string', async () => {
		expect(await C.parse(null)).toEqual({ error: 'prefix' });
	});

	it('generates 32 fresh bytes', () => {
		const a = C.generateSecret();
		const b = C.generateSecret();
		expect(a).toHaveLength(32);
		expect(C.toHex(a)).not.toBe(C.toHex(b));
	});

	it('round-trips a generated secret', async () => {
		const secret = C.generateSecret();
		const out = await C.parse(await C.encode(secret));
		expect(C.toHex(out.secret)).toBe(C.toHex(secret));
	});
});
