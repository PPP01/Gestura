// The sync secret in the form a human can carry: 32 random bytes as one
// GS1- code, and back. Nothing else in the extension knows the alphabet, and
// nothing here knows what the secret is for - it is a byte string with a
// checksum, and the derivation lives in js/eu-sync-crypto.js.
//
// The format is contract (docs/gestura-eu-api.md) with fixed test vectors:
// prefix, alphabet, the 20-bit checksum and the zero padding bits are all
// pinned. A code the user wrote down last year has to keep working.
(function (root) {
	'use strict';

	const PREFIX = 'GS1';
	// Crockford base32: no I, L, O, U. The first three are ambiguous when read
	// aloud or off a screen and are accepted as aliases below; U is excluded so
	// that no accidental word can form.
	const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
	const SECRET_BYTES = 32;
	const BODY_CHARS = 52;   // 32 bytes = 256 bits, 52 * 5 = 260, 4 bits padding
	const CHECK_CHARS = 4;   // the top 20 bits of SHA-256(secret)
	const CODE_CHARS = BODY_CHARS + CHECK_CHARS;

	const VALUE = new Map();
	for (let i = 0; i < ALPHABET.length; i++) VALUE.set(ALPHABET[i], i);
	// Read, never written: encode() only ever emits canonical characters.
	VALUE.set('I', 1);
	VALUE.set('L', 1);
	VALUE.set('O', 0);

	function generateSecret() {
		return crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
	}

	// Big-endian bit stream. acc never holds more than 12 bits, so the 32-bit
	// shifts are safe.
	function encodeBody(bytes) {
		let out = '';
		let acc = 0;
		let bits = 0;
		for (const b of bytes) {
			acc = (acc << 8) | b;
			bits += 8;
			while (bits >= 5) {
				bits -= 5;
				out += ALPHABET[(acc >> bits) & 31];
			}
		}
		if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
		return out;
	}

	// null when the trailing padding bits are not zero. That is not pedantry: two
	// different final characters would otherwise decode to the same secret, and a
	// code would stop having exactly one spelling.
	function decodeBody(chars) {
		const out = [];
		let acc = 0;
		let bits = 0;
		for (const c of chars) {
			acc = (acc << 5) | VALUE.get(c);
			bits += 5;
			if (bits >= 8) {
				bits -= 8;
				out.push((acc >> bits) & 255);
			}
		}
		if ((acc & ((1 << bits) - 1)) !== 0) return null;
		return new Uint8Array(out);
	}

	async function checksum(secret) {
		const d = new Uint8Array(await crypto.subtle.digest('SHA-256', secret));
		const v = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4);
		let out = '';
		for (let i = 3; i >= 0; i--) out += ALPHABET[(v >>> (i * 5)) & 31];
		return out;
	}

	async function encode(secret) {
		const chars = encodeBody(secret) + await checksum(secret);
		return PREFIX + '-' + chars.match(/.{1,4}/g).join('-');
	}

	// The prefix is matched BEFORE anything is stripped: G, S and 1 are alphabet
	// characters themselves, so a blanket "keep only alphabet characters" would
	// swallow the prefix into the payload and turn a wrong version into a length
	// error - or worse, into a decodable but different secret.
	async function parse(input) {
		if (typeof input !== 'string') return { error: 'prefix' };
		const upper = input.trim().toUpperCase();
		if (!upper.startsWith(PREFIX)) return { error: 'prefix' };

		const chars = [];
		for (const c of upper.slice(PREFIX.length)) {
			if (c === '-' || /\s/.test(c)) continue;
			// Anything else that is not a character of the alphabet is an error, not
			// noise to skip. Skipping would let "GS1-...-CC6W." and a genuinely
			// corrupted code fail in different ways for the same reason.
			if (!VALUE.has(c)) return { error: 'charset' };
			chars.push(ALPHABET[VALUE.get(c)]);
		}
		if (chars.length !== CODE_CHARS) return { error: 'length' };

		const secret = decodeBody(chars.slice(0, BODY_CHARS));
		if (!secret) return { error: 'padding' };
		if (await checksum(secret) !== chars.slice(BODY_CHARS).join('')) return { error: 'checksum' };
		return { secret };
	}

	const toHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
	const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map(h => parseInt(h, 16)));

	const api = {
		PREFIX, ALPHABET, SECRET_BYTES, BODY_CHARS, CHECK_CHARS, CODE_CHARS,
		generateSecret, encode, parse, checksum, toHex, fromHex,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSyncCode = api;
})(typeof self !== 'undefined' ? self : globalThis);
