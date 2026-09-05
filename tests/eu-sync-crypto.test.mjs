import { describe, it, expect } from 'vitest';
import '../js/eu-sync-code.js';
import '../js/eu-sync-crypto.js';
const C = globalThis.GesturaSyncCode;
const X = globalThis.GesturaSyncCrypto;

const SECRET_A = C.fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
const SECRET_B = C.fromHex('6e31aaf7266804808840320a2a6550b0b8fe93f7b88bcc96e016452a69840aa8');
const STATE = '0123456789abcdef0123456789abcdef';

describe('key derivation', () => {
	// The contract's vectors. A change here strands every uploaded state, because
	// the key is derived on every use and never stored.
	it('matches the locator vectors', async () => {
		expect(await X.deriveLocator(SECRET_A)).toBe('zoogXw2lwmt_ZqFnRu-lFOWYxyJaU2kpxfunpy3Umsk');
		expect(await X.deriveLocator(SECRET_B)).toBe('3qzyS44KqXaBNzKvFSontDE8CfLPp8lwOUVHroaeg7M');
	});

	it('matches the key vectors', async () => {
		const raw = await crypto.subtle.exportKey('raw', await X.deriveKey(SECRET_A));
		expect(C.toHex(new Uint8Array(raw)))
			.toBe('ca25c2f6d9e2392b270755cf04b75ff545fa536a387a4c4d4d16fcfeb2e7cba3');
	});

	it('derives a locator that is not the key', async () => {
		const raw = await crypto.subtle.exportKey('raw', await X.deriveKey(SECRET_A));
		const locatorBytes = Buffer.from(await X.deriveLocator(SECRET_A), 'base64url');
		expect(C.toHex(new Uint8Array(raw))).not.toBe(C.toHex(new Uint8Array(locatorBytes)));
	});

	it('produces a base64url locator without padding', async () => {
		expect(await X.deriveLocator(SECRET_A)).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});
});

describe('state ids', () => {
	it('are 32 hex characters and fresh each time', () => {
		const a = X.newStateId();
		expect(a).toMatch(X.STATE_ID_RE);
		expect(a).not.toBe(X.newStateId());
	});
});

describe('envelope', () => {
	it('round-trips an object', async () => {
		const key = await X.deriveKey(SECRET_A);
		const env = await X.encryptBlob(key, STATE, 'payload', { theme: 'dark', n: 1 });
		expect(await X.decryptBlob(key, STATE, 'payload', env)).toEqual({ theme: 'dark', n: 1 });
	});

	// Two encryptions of the same value under the same key must differ, or the IV
	// was reused - which breaks GCM outright, not gradually.
	it('uses a fresh IV every time', async () => {
		const key = await X.deriveKey(SECRET_A);
		const a = await X.encryptBlob(key, STATE, 'meta', { name: 'Work' });
		const b = await X.encryptBlob(key, STATE, 'meta', { name: 'Work' });
		expect(a).not.toBe(b);
		expect(a.slice(0, 16)).not.toBe(b.slice(0, 16));
	});

	it('fails on the wrong secret', async () => {
		const env = await X.encryptBlob(await X.deriveKey(SECRET_A), STATE, 'meta', { name: 'Work' });
		await expect(X.decryptBlob(await X.deriveKey(SECRET_B), STATE, 'meta', env)).rejects.toThrow('decrypt');
	});

	// The AAD binding. Without it the server could serve a valid meta blob as a
	// payload, or one state's blob under another state's id, and the client would
	// decrypt it happily.
	it('fails when the role is swapped', async () => {
		const key = await X.deriveKey(SECRET_A);
		const env = await X.encryptBlob(key, STATE, 'meta', { name: 'Work' });
		await expect(X.decryptBlob(key, STATE, 'payload', env)).rejects.toThrow('decrypt');
	});

	it('fails when the state id is swapped', async () => {
		const key = await X.deriveKey(SECRET_A);
		const env = await X.encryptBlob(key, STATE, 'meta', { name: 'Work' });
		await expect(X.decryptBlob(key, 'ffffffffffffffffffffffffffffffff', 'meta', env)).rejects.toThrow('decrypt');
	});

	it.each([
		['garbage', 'not base64 at all!'],
		['an empty string', ''],
		['a truncated envelope', 'AQIDBAUGBwgJCgsM'],
	])('rejects %s', async (_label, env) => {
		await expect(X.decryptBlob(await X.deriveKey(SECRET_A), STATE, 'meta', env)).rejects.toThrow('decrypt');
	});

	it('matches the envelope vector when the IV is fixed', async () => {
		const key = await X.deriveKey(SECRET_A);
		const iv = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const env = await X.encryptBlob(key, STATE, 'meta', { name: 'Work' }, iv);
		expect(env).toBe('AQIDBAUGBwgJCgsMhBezK2ZidsR4vw2Le+JA1vfSdGXw0lkopKj0PjhL9A==');
		expect(await X.blobHash(env)).toBe('wTZSj7yLdniic9fTzg1YQgD4WVynX3BgPTYosChka2c');
	});

	it('composes the AAD exactly as the contract says', () => {
		expect(new TextDecoder().decode(X.aad(STATE, 'meta')))
			.toBe('gestura-sync-v10123456789abcdef0123456789abcdefmeta');
	});
});

describe('compression', () => {
	const big = () => ({ gesturaSettings: 1, customCss: 'body { color: red; }\n'.repeat(4000) });

	it('round-trips a gzipped payload through encryptCompressed and decryptBlob', async () => {
		const key = await X.deriveKey(SECRET_A);
		const env = await X.encryptCompressed(key, STATE, 'payload', big());
		expect(await X.decryptBlob(key, STATE, 'payload', env)).toEqual(big());
	});

	it('is smaller than the uncompressed envelope for a real payload', async () => {
		const key = await X.deriveKey(SECRET_A);
		const plain = await X.encryptBlob(key, STATE, 'payload', big());
		const gz = await X.encryptCompressed(key, STATE, 'payload', big());
		expect(gz.length * 4).toBeLessThan(plain.length);
	});

	// An older client never compressed. Its payloads must keep decrypting.
	it('still decrypts an uncompressed payload', async () => {
		const key = await X.deriveKey(SECRET_A);
		const env = await X.encryptBlob(key, STATE, 'payload', { theme: 'dark' });
		expect(await X.decryptBlob(key, STATE, 'payload', env)).toEqual({ theme: 'dark' });
	});

	it('encryptBlob still matches the envelope vector byte for byte', async () => {
		const key = await X.deriveKey(SECRET_A);
		const iv = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		expect(await X.encryptBlob(key, STATE, 'meta', { name: 'Work' }, iv))
			.toBe('AQIDBAUGBwgJCgsMhBezK2ZidsR4vw2Le+JA1vfSdGXw0lkopKj0PjhL9A==');
	});

	it('recognises gzip by its magic and nothing else', () => {
		expect(X.isGzip(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))).toBe(true);
		expect(X.isGzip(new TextEncoder().encode('{"a":1}'))).toBe(false);
		expect(X.isGzip(new Uint8Array([0x1f]))).toBe(false);
	});

	// The gzip bomb. The server cannot plant one (GCM authenticates), but a code
	// handed over by a third party can. 2 MiB of zeros gzips to about 2 KB and
	// would inflate past the ceiling; it must fail as 'decrypt', not exhaust memory.
	it('refuses a blob that inflates past 1 MiB as decrypt', async () => {
		const key = await X.deriveKey(SECRET_A);
		const zeros = new Uint8Array(2 * 1024 * 1024);
		const gz = await X.gzip(zeros);
		expect(gz.length).toBeLessThan(10000);
		const env = await X.encryptBytes(key, STATE, 'payload', gz);
		await expect(X.decryptBlob(key, STATE, 'payload', env)).rejects.toThrow('decrypt');
	});

	it('gunzipBounded returns the bytes when they fit', async () => {
		const bytes = new TextEncoder().encode('hello '.repeat(1000));
		const out = await X.gunzipBounded(await X.gzip(bytes), 1024 * 1024);
		expect(new TextDecoder().decode(out)).toBe('hello '.repeat(1000));
	});
});
