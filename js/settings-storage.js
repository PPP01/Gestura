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

	// §6: the size the write would produce, measured the way Chrome measures it,
	// against the ceiling of the active area. In state 'sync' each branch is an
	// item with its own quota; in state 'local' there is no item quota and only the
	// total counts. Reads the store once to know what the untouched keys weigh.
	async function precheck(patch) {
		const q = QUOTA[cache.area];
		if (q.item !== null) {
			for (const [k, v] of Object.entries(patch)) {
				const bytes = entryBytes(k, v);
				if (bytes > q.item) return { ok: false, error: 'branch-full', branch: k, bytes, quota: q.item, area: cache.area };
			}
		}
		const stored = pickKnown(await store().get(knownKeys()));
		const merged = { ...stored, ...patch };
		let total = 0;
		for (const [k, v] of Object.entries(merged)) total += entryBytes(k, v);
		if (cache.area === 'sync') total += entryBytes(FORMAT_KEY, FORMAT_VERSION);
		if (total > q.total) return { ok: false, error: 'total-full', branch: '', bytes: total, quota: q.total, area: cache.area };
		return { ok: true };
	}

	// The whole patch or nothing. The pre-check runs first so a write that would
	// fail never gets partially applied.
	async function set(patch) {
		await ready();
		const known = pickKnown(patch);
		const check = await precheck(known);
		if (!check.ok) return check;
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

	async function writeArea(next) {
		await chrome.storage.local.set({ [AREA_KEY]: next });
		absorb({ [AREA_KEY]: next });
	}

	// One copy sync → local of the known keys. Returns what it wrote, so the
	// second pass can write only what changed since.
	async function copySyncToLocal(previous) {
		const items = pickKnown(await chrome.storage.sync.get(knownKeys()));
		const patch = {};
		for (const [k, v] of Object.entries(items)) {
			if (!previous || JSON.stringify(previous[k]) !== JSON.stringify(v)) patch[k] = v;
		}
		if (Object.keys(patch).length) await chrome.storage.local.set(patch);
		return items;
	}

	// §4. Not atomic, and the sequence is what makes that harmless: copy, set the
	// area, copy AGAIN. The second pass picks up whatever a context still in state
	// 'sync' wrote during the first - and writes only those keys, so it cannot
	// clobber a write a context already in state 'local' made in the meantime.
	// What remains is the latency of one onChanged delivery; named in the spec so
	// nobody tries to close it with a lock.
	//
	// The point of no return is the area write. Before it, a failure changes
	// nothing anyone reads - a partial copy in storage.local is data no context
	// looks at while the area is 'sync'. After it, a failed second copy puts the
	// area BACK: storage.sync still holds everything, so the pre-switch state is
	// fully valid. The note is a courtesy for other browsers; if it cannot be
	// written the switch has still happened, and `noted: false` says so rather
	// than pretending nothing changed. The stale copies are never deleted (§10.1).
	async function toLocal(reason) {
		const movedTo = reason === 'gestura.eu' ? 'gestura.eu' : 'local';
		const movedAt = new Date().toISOString();
		let first;
		try {
			first = await copySyncToLocal(null);
			await writeArea({ area: 'local', movedAt, movedTo });
		} catch {
			return { ok: false, error: 'write' };
		}
		try {
			await copySyncToLocal(first);
		} catch {
			try { await writeArea({ area: 'sync', movedAt: '', movedTo: '' }); } catch { /* area() tells the caller where we ended up */ }
			return { ok: false, error: 'write' };
		}
		try {
			await chrome.storage.sync.set({ [NOTE_KEYS[0]]: movedAt, [NOTE_KEYS[1]]: movedTo });
			return { ok: true, noted: true };
		} catch {
			return { ok: true, noted: false };
		}
	}

	// The way back is conditional: every branch must fit its item quota and the
	// whole set the total, and tier 2 must be off. Refused with numbers, never
	// silent. Then data → area → note: a failure after the data write leaves the
	// browser in state 'local' with a FRESHER stale copy in storage.sync, which
	// is consistent, and the note is removed last and best-effort.
	async function toSync() {
		let eu, items;
		try {
			eu = await chrome.storage.local.get(EU_SYNC_KEY);
			items = pickKnown(await chrome.storage.local.get(knownKeys()));
		} catch {
			return { ok: false, error: 'write' };
		}
		if (eu[EU_SYNC_KEY] && eu[EU_SYNC_KEY].enabled === true) return { ok: false, error: 'tier2-enabled' };
		const q = QUOTA.sync;
		let total = entryBytes(FORMAT_KEY, FORMAT_VERSION);
		for (const [k, v] of Object.entries(items)) {
			const bytes = entryBytes(k, v);
			total += bytes;
			if (bytes > q.item) return { ok: false, error: 'branch-full', branch: k, bytes, quota: q.item, area: 'sync' };
		}
		if (total > q.total) return { ok: false, error: 'total-full', branch: '', bytes: total, quota: q.total, area: 'sync' };
		try {
			await chrome.storage.sync.set({ ...items, [FORMAT_KEY]: FORMAT_VERSION });
			await writeArea({ area: 'sync', movedAt: '', movedTo: '' });
		} catch {
			return { ok: false, error: 'write' };
		}
		try {
			await chrome.storage.sync.remove(NOTE_KEYS);
			return { ok: true, noted: true };
		} catch {
			return { ok: true, noted: false };
		}
	}

	async function switchTo(target, reason) {
		await ready();
		if (target !== 'sync' && target !== 'local') return { ok: false, error: 'bad-area' };
		if (target === cache.area) return { ok: true };
		return target === 'local' ? toLocal(reason) : toSync();
	}

	// The note another browser left (§4). Only meaningful in state 'sync'; the
	// options page asks and shows one line.
	async function note() {
		const items = await chrome.storage.sync.get(NOTE_KEYS);
		const movedAt = items[NOTE_KEYS[0]];
		if (typeof movedAt !== 'string' || !movedAt) return null;
		return { movedAt, movedTo: items[NOTE_KEYS[1]] === 'gestura.eu' ? 'gestura.eu' : 'local' };
	}

	function fanOut(changes, namespace) {
		if (namespace !== cache.area) return;
		const known = {};
		for (const k of Object.keys(changes)) {
			if (isKnown(k)) known[k] = changes[k];
		}
		if (!Object.keys(known).length) return;
		for (const fn of listeners) {
			try { fn(known); } catch { /* one listener must not break the others */ }
		}
	}

	if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
		chrome.storage.onChanged.addListener((changes, namespace) => {
			// The switch itself, whichever context wrote it.
			if (namespace === 'local' && Object.prototype.hasOwnProperty.call(changes, AREA_KEY)) {
				absorb({ [AREA_KEY]: changes[AREA_KEY].newValue });
			}
			// Before the first read resolves, cache.area is only the default 'sync' -
			// deciding the namespace against it now would silently drop a change that
			// arrives during that window (a cold context already in state 'local',
			// whose first change lands before it has discovered so). Defer the
			// decision until the area is known rather than guessing it.
			if (loaded) fanOut(changes, namespace);
			else load().then(() => fanOut(changes, namespace));
		});
	}

	load();

	const api = {
		AREA_KEY, NOTE_KEYS, FORMAT_KEY, EU_SYNC_KEY, QUOTA,
		byteLength, entryBytes,
		area, ready, get, set, remove, onChanged, usage,
		switchTo, note,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSettingsStorage = api;
})(typeof self !== 'undefined' ? self : globalThis);
