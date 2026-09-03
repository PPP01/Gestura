// The only reader/writer of the sync state in chrome.storage.local: the tier-2
// switch, its own consent, the secret, and this browser's map of the states it
// has uploaded to.
//
// Shaped like js/eu-local.js - live cache, fed by storage.onChanged - for the
// same reason: every gated path must be able to ask "may I, right now" and get
// today's answer. It is a separate key and a separate file because tier 2 has a
// separate lifetime: revoking tier 1 must not touch the secret, and no content
// script or service worker ever loads this file.
(function (root) {
	'use strict';

	const EU = root.FlowMouseEuIntegration;
	const KEY = 'euSync';
	// Tier 2's own consent, independent of the integration's. R3 = 1.
	const CURRENT_SYNC_CONSENT = 1;
	const STATES_MAX = 10;
	const CHANGED_EVENT = 'gestura:eu-sync-changed';

	const DEFAULTS = { enabled: false, consent: null, secret: '', states: {} };

	function normalizeSync(raw) {
		const src = (raw && raw[KEY] && typeof raw[KEY] === 'object') ? raw[KEY] : {};
		const consent = (src.consent && typeof src.consent === 'object' && typeof src.consent.version === 'number')
			? { version: src.consent.version, date: typeof src.consent.date === 'string' ? src.consent.date : '' }
			: null;
		const states = {};
		const stored = (src.states && typeof src.states === 'object') ? src.states : {};
		for (const [id, st] of Object.entries(stored)) {
			// Ids come from storage, which means they could be anything. Checking the
			// shape here keeps every consumer from having to.
			if (!root.GesturaSyncCrypto.STATE_ID_RE.test(id) || !st || typeof st !== 'object') continue;
			states[id] = {
				name: typeof st.name === 'string' ? st.name : '',
				lastUploadHash: typeof st.lastUploadHash === 'string' ? st.lastUploadHash : '',
				lastUploadDate: typeof st.lastUploadDate === 'string' ? st.lastUploadDate : '',
			};
		}
		return {
			euSync: {
				enabled: src.enabled === true,
				consent,
				secret: typeof src.secret === 'string' ? src.secret : '',
				states,
			},
		};
	}

	// The composed invariant from the design: tier 2 rides on tier 1 and can
	// never authorise anything by itself. Both halves are checked against their
	// own current consent version, so either one going stale stops sync.
	function syncEnabled(local, sync) {
		const s = normalizeSync(sync).euSync;
		return EU.effectiveEnabled(local)
			&& s.enabled === true
			&& s.consent !== null
			&& s.consent.version === CURRENT_SYNC_CONSENT;
	}

	// Sync talks to exactly one server, unlike the update check which asks every
	// origin an entry came from. There is one secret and one blob store; a state
	// that lived on two servers would need a UI explaining which one it is on.
	// allowedOrigins() answers [production] or [production, dev].
	function syncOrigin(local) {
		const origins = EU.allowedOrigins(local);
		return origins.length > 1 ? origins[1] : origins[0];
	}

	let cache = normalizeSync({});
	let loaded = false;
	let loading = null;
	const listeners = new Set();

	function absorb(raw) {
		cache = normalizeSync(raw);
		loaded = true;
		return cache;
	}

	function load() {
		if (!loading) {
			let promise;
			try {
				promise = chrome.storage.local.get(KEY);
			} catch (e) {
				promise = Promise.reject(e);
			}
			loading = promise.then(absorb).catch(() => {
				// Same reasoning as js/eu-local.js: a failed read must not become this
				// context's answer for good. Drop the memo, answer the defaults - and
				// the defaults say "off", so every gated path fails closed.
				loading = null;
				return cache;
			});
		}
		return loading;
	}

	async function read() {
		return loaded ? cache : load();
	}

	function current() {
		return cache;
	}

	async function write(patch) {
		const next = { ...(await read()).euSync, ...(patch || {}) };
		await chrome.storage.local.set({ [KEY]: next });
		return absorb({ [KEY]: next });
	}

	// Merges into the state rather than replacing it: the name is written when the
	// state is created, the hash and date on every upload, and those are separate
	// moments.
	async function setState(stateId, patch) {
		const states = { ...(await read()).euSync.states };
		states[stateId] = { name: '', lastUploadHash: '', lastUploadDate: '', ...(states[stateId] || {}), ...(patch || {}) };
		return write({ states });
	}

	async function removeState(stateId) {
		const states = { ...(await read()).euSync.states };
		delete states[stateId];
		return write({ states });
	}

	function onChange(fn) {
		listeners.add(fn);
		return () => listeners.delete(fn);
	}

	if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area !== 'local' || !changes[KEY]) return;
			absorb({ [KEY]: changes[KEY].newValue });
			for (const fn of listeners) { try { fn(cache); } catch { /* one listener must not break the others */ } }
			if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED_EVENT));
		});
	}

	// Withdrawing the website integration takes the sync consent with it. Sync is
	// already dead by composition at that moment - this is about what happens
	// NEXT time: a tier-2 consent left standing would silently authorise uploads
	// again the moment tier 1 is switched back on, and nobody agreed to that
	// twice. The secret and the states stay: they are local data, and re-pairing
	// should not cost the user the states they already have.
	if (root.GesturaEuLocal && root.GesturaEuLocal.onChange) {
		root.GesturaEuLocal.onChange(async (local) => {
			if (EU.effectiveEnabled(local)) return;
			const cur = (await read()).euSync;
			if (!cur.enabled && cur.consent === null) return;
			await write({ enabled: false, consent: null });
		});
	}

	load();

	const api = {
		KEY, CURRENT_SYNC_CONSENT, STATES_MAX, CHANGED_EVENT,
		normalizeSync, syncEnabled, syncOrigin,
		read, current, write, setState, removeState, onChange,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSyncLocal = api;
})(typeof self !== 'undefined' ? self : globalThis);
