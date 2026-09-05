// Everything the sync does with crypto.subtle: HKDF from the secret to a server
// locator and an AES-256-GCM key, and the envelope that carries a JSON object
// as one base64 string.
//
// The parameters are contract (docs/gestura-eu-api.md), pinned by test vectors:
// the zero salt, the two info strings, the 12-byte IV and the AAD composition.
// The key is derived on every use and stored nowhere - so a changed parameter
// does not break a running feature, it strands data that is already uploaded.
(function (root) {
	'use strict';

	const INFO_LOCATOR = 'gestura-sync-locator-v1';
	const INFO_KEY = 'gestura-sync-key-v1';
	const AAD_PREFIX = 'gestura-sync-v1';
	const IV_BYTES = 12;
	const STATE_ID_RE = /^[0-9a-f]{32}$/;

	// The secret carries the full 256 bits of entropy, so the salt has no work to
	// do; HKDF requires one, and a fixed zero salt is the standard answer when the
	// input keying material is already uniform.
	const SALT = new Uint8Array(32);
	const enc = new TextEncoder();

	// §8 of the storage-move design. The payload plaintext may be gzip; meta never
	// is. Recognised by the magic, so there is no format field to keep in step and
	// an older client's uncompressed payload still reads.
	const GZIP_MAGIC_0 = 0x1f;
	const GZIP_MAGIC_1 = 0x8b;
	// The local settings ceiling. DecompressionStream would happily turn 512 KiB
	// into gigabytes; a blob that inflates past this is treated like any other
	// damaged blob.
	const INFLATE_MAX_BYTES = 1024 * 1024;

	function isGzip(bytes) {
		return bytes.length > 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
	}

	async function gzip(bytes) {
		const cs = new CompressionStream('gzip');
		const writer = cs.writable.getWriter();
		writer.write(bytes);
		writer.close();
		return new Uint8Array(await new Response(cs.readable).arrayBuffer());
	}

	// Reads chunk by chunk and stops the moment the total passes `max` - never
	// materialises the whole output first.
	async function gunzipBounded(bytes, max) {
		const ds = new DecompressionStream('gzip');
		const writer = ds.writable.getWriter();
		writer.write(bytes).catch(() => {});
		writer.close().catch(() => {});
		const reader = ds.readable.getReader();
		const chunks = [];
		let total = 0;
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			total += value.length;
			if (total > max) {
				await reader.cancel();
				throw new Error('decrypt');
			}
			chunks.push(value);
		}
		const out = new Uint8Array(total);
		let offset = 0;
		for (const c of chunks) { out.set(c, offset); offset += c.length; }
		return out;
	}

	function bytesToB64(bytes) {
		let s = '';
		for (const b of bytes) s += String.fromCharCode(b);
		return btoa(s);
	}

	function b64ToBytes(b64) {
		const s = atob(b64);
		const out = new Uint8Array(s.length);
		for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
		return out;
	}

	const b64url = (bytes) => bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

	async function deriveBits(secret, info) {
		const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
		return new Uint8Array(await crypto.subtle.deriveBits(
			{ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(info) }, key, 256));
	}

	async function deriveLocator(secret) {
		return b64url(await deriveBits(secret, INFO_LOCATOR));
	}

	async function deriveKey(secret) {
		const raw = await deriveBits(secret, INFO_KEY);
		return crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
	}

	function newStateId() {
		return Array.from(crypto.getRandomValues(new Uint8Array(16)))
			.map(b => b.toString(16).padStart(2, '0')).join('');
	}

	// stateId is fixed-length hex and role is one of two fixed words, so plain
	// concatenation cannot be ambiguous - no separator is needed and adding one
	// later would be a format change.
	function aad(stateId, role) {
		return enc.encode(AAD_PREFIX + stateId + role);
	}

	// The primitive: bytes in, envelope out. `iv` is an argument for one reason
	// only: the contract's test vector needs a fixed one. Every caller in the
	// extension omits it and gets a fresh random IV, which is what GCM requires -
	// reusing one under the same key discloses the key stream, and both blobs of
	// a state share a key.
	async function encryptBytes(key, stateId, role, bytes, iv) {
		const nonce = iv || crypto.getRandomValues(new Uint8Array(IV_BYTES));
		const ct = new Uint8Array(await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce, additionalData: aad(stateId, role), tagLength: 128 },
			key, bytes));
		const out = new Uint8Array(nonce.length + ct.length);
		out.set(nonce, 0);
		out.set(ct, nonce.length);
		return bytesToB64(out);
	}

	// Signature and behaviour unchanged: the meta blob and the contract's vector.
	async function encryptBlob(key, stateId, role, value, iv) {
		return encryptBytes(key, stateId, role, enc.encode(JSON.stringify(value)), iv);
	}

	// The payload path.
	async function encryptCompressed(key, stateId, role, value) {
		return encryptBytes(key, stateId, role, await gzip(enc.encode(JSON.stringify(value))));
	}

	// One error for every failure: a wrong secret, a swapped blob, a corrupted
	// byte and a truncated envelope are indistinguishable to the receiver, and
	// telling them apart would only ever help an attacker. The panel turns this
	// into "wrong code or damaged data".
	async function decryptBlob(key, stateId, role, envelope) {
		try {
			if (typeof envelope !== 'string' || !envelope) throw new Error('decrypt');
			const bytes = b64ToBytes(envelope);
			if (bytes.length <= IV_BYTES + 16) throw new Error('decrypt');
			const pt = await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES), additionalData: aad(stateId, role), tagLength: 128 },
				key, bytes.slice(IV_BYTES));
			let plain = new Uint8Array(pt);
			if (isGzip(plain)) plain = await gunzipBounded(plain, INFLATE_MAX_BYTES);
			return JSON.parse(new TextDecoder().decode(plain));
		} catch {
			throw new Error('decrypt');
		}
	}

	// Over the envelope's raw bytes, not over its base64 spelling: base64 has
	// more than one encoding of the same bytes, and the server may normalise.
	async function blobHash(envelope) {
		const digest = await crypto.subtle.digest('SHA-256', b64ToBytes(envelope));
		return b64url(new Uint8Array(digest));
	}

	const api = {
		INFO_LOCATOR, INFO_KEY, AAD_PREFIX, IV_BYTES, STATE_ID_RE, INFLATE_MAX_BYTES,
		deriveLocator, deriveKey, newStateId, aad,
		encryptBytes, encryptBlob, encryptCompressed, decryptBlob, blobHash, bytesToB64, b64ToBytes,
		gzip, gunzipBounded, isGzip,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSyncCrypto = api;
})(typeof self !== 'undefined' ? self : globalThis);
