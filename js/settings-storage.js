// The only thing that touches chrome.storage.sync or chrome.storage.local for
// SETTINGS. Every other module - the service worker, every content script, the
// pages' SettingsStore, the three page scripts - asks this one, and this one
// decides which area is active.
//
// Exactly one area is active at a time (docs/superpowers/specs/2026-09-04-
// storage-move-design.md, §2). The switch is its own storage.local key, so it is
// per browser, and it is cached here the way js/eu-local.js caches its key: fed
// by storage.onChanged, readable without awaiting. State 'sync' is today's
// behaviour byte for byte - same store, same limits.
//
// Classic script on purpose: content scripts cannot use modules and the service
// worker reaches it through importScripts. Loaded directly after constants.js
// everywhere, because the key filter below needs DEFAULT_SETTINGS.
(function (root) {
	'use strict';

	const AREA_KEY = 'settingsArea';
	// Left in storage.sync by the browser that switched, for the browsers that did
	// not (§4). Not settings: never in DEFAULT_SETTINGS, never exported.
	const NOTE_KEYS = ['syncMovedAt', 'syncMovedTo'];
	// §10.1: written beside the settings in storage.sync from this release on. It
	// means nothing yet; it is what makes a later format change detectable by a
	// reader that knows to look.
	const FORMAT_KEY = 'syncFormat';
	const FORMAT_VERSION = 1;
	const EU_SYNC_KEY = 'euSync';

	// Chrome's documented values for storage.sync; §3's decision for storage.local.
	// The item quota is null where the browser enforces none - a per-branch number
	// there would be an invention.
	const QUOTA = {
		sync: { item: 8192, total: 102400 },
		local: { item: null, total: 1024 * 1024 },
	};

	const defaults = () => root.GestureConstants.DEFAULT_SETTINGS;
	const knownKeys = () => Object.keys(defaults());
	const isKnown = (k) => Object.prototype.hasOwnProperty.call(defaults(), k);

	// The formula of js/storage-usage.js - key length plus the length of the JSON
	// value, in UTF-8 bytes, which is exactly Chrome's own accounting. A COPY, not
	// an import: storage-usage.js is an ES module and this file cannot import one.
	// tests/settings-storage.test.mjs runs both over the same fixtures.
	function byteLength(str) {
		return new TextEncoder().encode(str).length;
	}

	function entryBytes(key, value) {
		return byteLength(String(key)) + byteLength(JSON.stringify(value));
	}

	function pickKnown(items) {
		const out = {};
		for (const k of Object.keys(items || {})) {
			if (isKnown(k)) out[k] = items[k];
		}
		return out;
	}

	function normalizeArea(raw) {
		const src = (raw && raw[AREA_KEY] && typeof raw[AREA_KEY] === 'object') ? raw[AREA_KEY] : {};
		return {
			area: src.area === 'local' ? 'local' : 'sync',
			movedAt: typeof src.movedAt === 'string' ? src.movedAt : '',
			movedTo: typeof src.movedTo === 'string' ? src.movedTo : '',
		};
	}

	let cache = normalizeArea({});
	let loaded = false;
	let loading = null;
	const listeners = new Set();

	function absorb(raw) {
		cache = normalizeArea(raw);
		loaded = true;
		return cache;
	}

	function load() {
		if (!loading) {
			let promise;
			try {
				promise = chrome.storage.local.get(AREA_KEY);
			} catch (e) {
				promise = Promise.reject(e);
			}
			// An onChanged for the area that arrived while this read was in flight
			// is NEWER than what the read returns. If one already filled the cache,
			// the read's snapshot is stale and must not overwrite it.
			loading = promise.then((raw) => (loaded ? cache : absorb(raw))).catch(() => {
				// Same reasoning as js/eu-local.js: a failed read must not become this
				// context's answer for good. The default is 'sync' - today's behaviour.
				loading = null;
				return cache;
			});
		}
		return loading;
	}

	async function ready() {
		return loaded ? cache : load();
	}

	function area() {
		return cache.area;
	}

	function store() {
		return chrome.storage[cache.area];
	}

	async function get(keys) {
		await ready();
		let query;
		if (keys === null || keys === undefined) {
			query = knownKeys();
		} else if (typeof keys === 'string') {
			query = isKnown(keys) ? [keys] : [];
		} else if (Array.isArray(keys)) {
			query = keys.filter(isKnown);
		} else {
			query = {};
			for (const k of Object.keys(keys)) if (isKnown(k)) query[k] = keys[k];
		}
		return pickKnown(await store().get(query));
	}

	// The whole patch or nothing. Task 2 puts the size pre-check in front of the
	// write; the shape of the answer is fixed here so callers never change.
	async function set(patch) {
		await ready();
		const known = pickKnown(patch);
		const toWrite = { ...known };
		if (cache.area === 'sync') toWrite[FORMAT_KEY] = FORMAT_VERSION;
		try {
			await store().set(toWrite);
			return { ok: true };
		} catch (e) {
			return { ok: false, error: 'write' };
		}
	}

	// Known keys only: this must never be the thing that deletes euIntegration
	// or faviconCache out of storage.local.
	async function remove(keys) {
		await ready();
		const list = (Array.isArray(keys) ? keys : [keys]).filter(isKnown);
		if (list.length) await store().remove(list);
	}

	function onChanged(fn) {
		listeners.add(fn);
		return () => listeners.delete(fn);
	}

	// Pure over the object it is given: the façade caches the AREA, never the
	// settings, so a synchronous usage() with no argument would have nothing to
	// measure.
	function usage(settings) {
		const q = QUOTA[cache.area];
		const branches = {};
		let total = 0;
		for (const [k, v] of Object.entries(settings || {})) {
			if (!isKnown(k)) continue;
			const bytes = entryBytes(k, v);
			branches[k] = bytes;
			total += bytes;
		}
		return { area: cache.area, branches, total, quota: { item: q.item, total: q.total } };
	}

	if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
		chrome.storage.onChanged.addListener((changes, namespace) => {
			// The switch itself, whichever context wrote it.
			if (namespace === 'local' && Object.prototype.hasOwnProperty.call(changes, AREA_KEY)) {
				absorb({ [AREA_KEY]: changes[AREA_KEY].newValue });
			}
			if (namespace !== cache.area) return;
			const known = {};
			for (const k of Object.keys(changes)) {
				if (isKnown(k)) known[k] = changes[k];
			}
			if (!Object.keys(known).length) return;
			for (const fn of listeners) {
				try { fn(known); } catch { /* one listener must not break the others */ }
			}
		});
	}

	load();

	const api = {
		AREA_KEY, NOTE_KEYS, FORMAT_KEY, EU_SYNC_KEY, QUOTA,
		byteLength, entryBytes,
		area, ready, get, set, remove, onChanged, usage,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSettingsStorage = api;
})(typeof self !== 'undefined' ? self : globalThis);
