// Pure core of the gestura.eu integration: consent invariant, origin rules,
// canonical hashing and the bridge protocol. No chrome.*, no DOM, no i18n —
// shared between content scripts, the service worker, the Lit UI and the
// vitest suites, like menu-exchange.js. crypto.subtle and TextEncoder are the
// only platform APIs used; both exist everywhere the file runs.
(function (root) {
	'use strict';

	const PRODUCTION_ORIGIN = 'https://gestura.eu';
	// Bumping this re-prompts every user: effectiveEnabled() is false until the
	// stored consent carries the current number. R1 = 1. R2 raises it to 2.
	const CURRENT_INTEGRATION_CONSENT = 1;
	const API_LEVEL = 1;
	const LIMITS = { detailMaxBytes: 32 * 1024, requestIdMax: 64, idsMax: 100, idMax: 128 };
	const ID_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
	const LOCAL_DEFAULTS = { euIntegration: { enabled: false, consent: null, devOrigin: '' } };

	// --- local state -----------------------------------------------------------

	function normalizeLocal(raw) {
		const src = (raw && raw.euIntegration && typeof raw.euIntegration === 'object') ? raw.euIntegration : {};
		const consent = (src.consent && typeof src.consent === 'object' && typeof src.consent.version === 'number')
			? { version: src.consent.version, date: typeof src.consent.date === 'string' ? src.consent.date : '' }
			: null;
		return {
			euIntegration: {
				enabled: src.enabled === true,
				consent,
				devOrigin: typeof src.devOrigin === 'string' ? src.devOrigin : '',
			},
		};
	}

	// The one invariant every gated path checks. A stale consent version
	// authorizes nothing — the UI shows "needs re-confirmation" instead.
	function effectiveEnabled(local) {
		const s = normalizeLocal(local).euIntegration;
		return s.enabled === true && s.consent !== null && s.consent.version === CURRENT_INTEGRATION_CONSENT;
	}

	// --- origins ----------------------------------------------------------------

	// Exact, never substring-based: `new URL(input).origin === input` rejects
	// paths and trailing slashes; only https, or http on a loopback host.
	function isValidDevOrigin(input) {
		if (typeof input !== 'string' || !input) return false;
		let url;
		try { url = new URL(input); } catch { return false; }
		if (url.origin !== input) return false;
		if (url.protocol === 'https:') return true;
		return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
	}

	function allowedOrigins(local) {
		const dev = normalizeLocal(local).euIntegration.devOrigin;
		return isValidDevOrigin(dev) ? [PRODUCTION_ORIGIN, dev] : [PRODUCTION_ORIGIN];
	}

	// Which allowed origin a URL belongs to, or null. Callers pass the FINAL url
	// (Response.url after redirects, sender.url), never what the user typed.
	function qualifiedOrigin(urlString, local) {
		if (typeof urlString !== 'string' || !urlString) return null;
		let origin;
		try { origin = new URL(urlString).origin; } catch { return null; }
		return allowedOrigins(local).includes(origin) ? origin : null;
	}

	// --- canonical JSON + baseline hash ------------------------------------------
	// JSON.stringify is not key-order stable across code paths; the baseline
	// needs one canonical form. undefined properties are dropped (like
	// JSON.stringify), null is kept, arrays keep their order.

	function canonicalize(value) {
		if (value === undefined) return undefined;
		if (value === null || typeof value !== 'object') return JSON.stringify(value);
		if (Array.isArray(value)) return '[' + value.map(v => (v === undefined ? 'null' : canonicalize(v))).join(',') + ']';
		const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
		return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
	}

	// 64 bits (16 hex chars): collision-safe for a local integrity check, gentle
	// on the scarce sync quota where it is stored.
	async function hash64(str) {
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
		return Array.from(new Uint8Array(digest).slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
	}

	// The baseline is the stored runtime entry exactly as the import wrote it,
	// after all import transformations, minus the source object itself.
	function projection(stored) {
		const out = { ...stored };
		delete out.source;
		return out;
	}

	async function baselineHash(stored) {
		return hash64(canonicalize(projection(stored)));
	}

	async function modifiedState(stored) {
		const base = stored && stored.source && stored.source.baselineHash;
		if (typeof base !== 'string' || !base) return 'unknown';
		return (await baselineHash(stored)) !== base;
	}

	const api = {
		PRODUCTION_ORIGIN, CURRENT_INTEGRATION_CONSENT, API_LEVEL, LIMITS, LOCAL_DEFAULTS, ID_RE,
		normalizeLocal, effectiveEnabled, isValidDevOrigin, allowedOrigins, qualifiedOrigin,
		canonicalize, hash64, projection, baselineHash, modifiedState,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseEuIntegration = api;
})(typeof self !== 'undefined' ? self : globalThis);
