// The only reader and writer of the `euSyncBase` key in chrome.storage.local:
// per gestura.eu state, the payload this browser last agreed on with the server
// and the payloadHash the server holds for it. That pair is the third point the
// three-way merge (js/settings-merge.js) needs; without it every difference
// would look like "both sides moved".
//
// Separate from `euSync` on purpose (spec §3): that key is read on every gated
// path and must stay small; this one is read only during a reconciliation.
// The payload is stored gzipped - a realistic 18 KB base is about 3.6 KB.
//
// No live cache, no onChanged listener: nothing needs "the base, right now"
// without awaiting. Reads never throw; a damaged entry reads as "no base" and
// is removed, so a corrupted store cannot wedge the panel.
(function (root) {
	'use strict';

	const KEY = 'euSyncBase';

	const X = () => root.GesturaSyncCrypto;

	// The same gzip the sync envelope uses (js/eu-sync-crypto.js), as base64 for
	// storage.
	async function gzipText(text) {
		return X().bytesToB64(await X().gzip(new TextEncoder().encode(text)));
	}

	// null for anything that is not a gzip of at most `max` bytes of text:
	// b64ToBytes throws on bad base64, gunzipBounded on a non-gzip and past the
	// bound. All three are "no base", none is an exception.
	async function gunzipText(b64, max) {
		try {
			return new TextDecoder().decode(await X().gunzipBounded(X().b64ToBytes(b64), max));
		} catch {
			return null;
		}
	}

	async function readAll() {
		try {
			const got = await chrome.storage.local.get(KEY);
			const raw = got && got[KEY];
			return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? { ...raw } : {};
		} catch {
			return {};
		}
	}

	// Guarded like readAll and clear. The base write in the panel's #uploadTo is
	// the one that runs neither inside #guarded nor inside the afterSave
	// try/catch of options-page.js: a rejection there would be an unhandled one
	// and would skip the state record and the refresh behind it - a successful
	// upload left with a stale list, a wrong "changed since last upload" hint and
	// no error line.
	async function writeAll(all) {
		try {
			await chrome.storage.local.set({ [KEY]: all });
		} catch {
			// A base that could not be stored is "no base": the next Sync says so.
		}
	}

	const wellFormed = (id, e) => X().STATE_ID_RE.test(id) && !!e && typeof e === 'object'
		&& typeof e.hash === 'string' && !!e.hash && typeof e.gz === 'string';

	// Which states have a base, and under which hash - for the panel's row
	// buttons. Nothing is inflated here.
	async function list() {
		const all = await readAll();
		const out = {};
		for (const [id, e] of Object.entries(all)) {
			if (wellFormed(id, e)) out[id] = { hash: e.hash, date: typeof e.date === 'string' ? e.date : '' };
		}
		return out;
	}

	async function remove(stateId) {
		const all = await readAll();
		if (!(stateId in all)) return;
		delete all[stateId];
		await writeAll(all);
	}

	async function read(stateId) {
		const all = await readAll();
		const e = all[stateId];
		if (e === undefined) return null;
		if (!wellFormed(stateId, e)) {
			await remove(stateId);
			return null;
		}
		const text = await gunzipText(e.gz, X().INFLATE_MAX_BYTES);
		let payload = null;
		if (text !== null) {
			try { payload = JSON.parse(text); } catch { payload = null; }
		}
		if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
			await remove(stateId);
			return null;
		}
		return { hash: e.hash, payload, date: typeof e.date === 'string' ? e.date : '' };
	}

	// Called only after the server has acknowledged the payload this hash names
	// (spec §3): after an upload with the hash uploadState returned, after a
	// download with the hash the payload was checked against.
	async function write(stateId, { hash, payload, date }) {
		if (!X().STATE_ID_RE.test(stateId)) return;
		const all = await readAll();
		all[stateId] = {
			hash,
			gz: await gzipText(JSON.stringify(payload)),
			date: date || new Date().toISOString(),
		};
		await writeAll(all);
	}

	// After a SUCCESSFUL listing only: a base for a state the server no longer
	// has is a copy of the user's settings with no purpose.
	async function prune(knownStateIds) {
		const keep = new Set(knownStateIds || []);
		const all = await readAll();
		let dropped = 0;
		for (const id of Object.keys(all)) {
			if (!keep.has(id)) {
				delete all[id];
				dropped++;
			}
		}
		if (dropped) await writeAll(all);
		return dropped;
	}

	async function clear() {
		try { await chrome.storage.local.remove(KEY); } catch { /* nothing to clear */ }
	}

	// MAX_INFLATED is the crypto module's bound, read through the same lazy
	// accessor as everything else here - GesturaSyncCrypto may load after this
	// file. One bound for both, so moving it moves it everywhere.
	const api = {
		KEY,
		get MAX_INFLATED() { return X().INFLATE_MAX_BYTES; },
		gzipText, gunzipText, list, read, write, remove, prune, clear,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSyncBase = api;
})(typeof self !== 'undefined' ? self : globalThis);
