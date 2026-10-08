// The only reader/writer of the sync state in chrome.storage.local: the sync
// switch, its own consent, the secret, and this browser's map of the states it
// has uploaded to.
//
// Shaped like js/eu-local.js - live cache, fed by storage.onChanged - for the
// same reason: every gated path must be able to ask "may I, right now" and get
// today's answer. It is a separate key and a separate file because sync is a
// feature of its own: it does not depend on the gestura.eu integration
// (js/eu-local.js), turning that off leaves sync alone, and no content script or
// service worker ever loads this file.
(function (root) {
	'use strict';

	const EU = root.FlowMouseEuIntegration;
	const KEY = 'euSync';
	// Sync's own consent, independent of the integration's. R3 = 1.
	const CURRENT_SYNC_CONSENT = 1;

	const DEFAULTS = { enabled: false, consent: null, secret: '', states: {}, activeState: '' };

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
		// The state this browser last uploaded to, adopted or merged with: the one
		// whose "settings changed since" hint means something. It is always one of
		// the states recorded above, so removing a state, or all of them, cannot
		// leave a marker pointing at nothing - no caller has to remember to clear it.
		const active = (typeof src.activeState === 'string' && Object.hasOwn(states, src.activeState))
			? src.activeState : '';
		return {
			euSync: {
				enabled: src.enabled === true,
				consent,
				secret: typeof src.secret === 'string' ? src.secret : '',
				states,
				activeState: active,
			},
		};
	}

	// A consent that is on record but no longer counts: its version is not the
	// current one, because the text changed. Sync used to ride on the
	// integration's consent as well and went stale whenever that was given
	// again; it is a feature of its own now, and only its own text decides.
	function consentStale(s) {
		return s.consent !== null && s.consent.version !== CURRENT_SYNC_CONSENT;
	}

	function syncConsentStale(sync) {
		return consentStale(normalizeSync(sync).euSync);
	}

	// The gate: the switch is on and carries a current consent. Nothing else -
	// in particular not the integration, which sync does not need. Coupling the
	// two switched sync off, without a word, whenever the integration was
	// turned off.
	function syncEnabled(sync) {
		const s = normalizeSync(sync).euSync;
		return s.enabled === true && s.consent !== null && !consentStale(s);
	}

	// Sync talks to exactly one server, unlike the update check which asks every
	// origin an entry came from. There is one secret and one blob store; a state
	// that lived on two servers would need a UI explaining which one it is on.
	// allowedOrigins() answers [production] or [production, dev]. The developer
	// origin names WHICH gestura.eu this browser talks to - it is not a
	// permission, so it applies whether the integration is on or off; switching
	// the integration must never move sync to another server.
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

	async function write(patch) {
		const next = { ...(await read()).euSync, ...(patch || {}) };
		await chrome.storage.local.set({ [KEY]: next });
		return absorb({ [KEY]: next });
	}

	// Merges into the state rather than replacing it: the name is written when the
	// state is created, the hash and date on every upload, and those are separate
	// moments.
	// `activate` makes it the active state in the same write - one storage event,
	// so a listener never sees the new state without the marker or the reverse.
	async function setState(stateId, patch, opts) {
		const states = { ...(await read()).euSync.states };
		states[stateId] = { name: '', lastUploadHash: '', lastUploadDate: '', ...(states[stateId] || {}), ...(patch || {}) };
		return write(opts && opts.activate ? { states, activeState: stateId } : { states });
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
		});
	}

	load();

	const api = {
		KEY, CURRENT_SYNC_CONSENT,
		normalizeSync, syncConsentStale, syncEnabled, syncOrigin,
		read, write, setState, removeState, onChange,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSyncLocal = api;
})(typeof self !== 'undefined' ? self : globalThis);
