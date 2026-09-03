// The anonymous update check for imported entries: which origins are due, what
// each is asked, how its answer is validated, where the result is cached, and
// which stored entry a cached result belongs to.
//
// This file owns the euUpdates key end to end. GesturaEuLocal deliberately does
// not: that one holds the switch and the consent, which every gated path in
// every frame reads on every action, and it is loaded in content scripts and the
// service worker where the update cache has no business existing. The cache is a
// different key with a different lifetime, read only by the options page.
//
// Everything here is pure except read/write/clear, checkAndPersist() and
// runUpdateCheck(), which takes its fetch as an argument - so the whole file is
// testable in vitest without chrome and without a network. The two
// subscriptions at the bottom are this file's only load-time side effects: they
// are what make a cache write announce itself and a dropped origin prune itself,
// instead of leaving both to whoever happened to write.
(function (root) {
	'use strict';

	const EU = root.FlowMouseEuIntegration;

	const KEY = 'euUpdates';
	const PATH = '/api/v1/updates';
	const THROTTLE_MS = 24 * 60 * 60 * 1000;
	const REQUEST_TIMEOUT_MS = 8000;
	const LIMITS = { responseMaxBytes: 256 * 1024, resultsMax: 200, changelogMax: 1000 };
	// Mirrors SEMVER_RE in js/menu-exchange.js, which is not exported. The exchange
	// format accepts nothing else as a version, so the update check must not
	// either - and a numeric triple is what makes a real comparison possible.
	const SEMVER_RE = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;

	// --- cache ------------------------------------------------------------------
	// An array of per-origin slots, never an object keyed by origin: the keys
	// would be arbitrary strings from storage, and one shared checkedAt could not
	// express "production answered, the dev index was down".

	function normalizeCache(cache) {
		const list = (cache && Array.isArray(cache.origins)) ? cache.origins : [];
		const origins = [];
		const seen = new Set();
		for (const slot of list) {
			if (!slot || typeof slot !== 'object') continue;
			if (typeof slot.origin !== 'string' || !slot.origin || seen.has(slot.origin)) continue;
			seen.add(slot.origin);
			origins.push({
				origin: slot.origin,
				checkedAt: typeof slot.checkedAt === 'string' ? slot.checkedAt : '',
				results: Array.isArray(slot.results)
					? slot.results.filter(r => r && typeof r === 'object' && typeof r.id === 'string')
					: [],
			});
		}
		return { origins };
	}

	// In place, so the stored order stays stable and a write changes as little as
	// possible.
	function mergeSlot(cache, origin, results, checkedAtIso) {
		const origins = normalizeCache(cache).origins.slice();
		const slot = { origin, checkedAt: checkedAtIso, results };
		const idx = origins.findIndex(s => s.origin === origin);
		if (idx >= 0) origins[idx] = slot; else origins.push(slot);
		return { origins };
	}

	// A developer origin that changed or went away leaves a slot nobody can ever
	// ask about again. Reconciling against the allowed set - rather than dropping
	// one origin at the keystroke that replaced it - is what lets the
	// GesturaEuLocal subscription at the bottom of this file do the cleaning for
	// every writer of devOrigin, not just for the panel's own field.
	function pruneOrigins(cache, allowed) {
		const keep = new Set(allowed || []);
		return { origins: normalizeCache(cache).origins.filter(s => keep.has(s.origin)) };
	}

	// Folds a finished run's slots into whatever the cache looks like NOW, rather
	// than writing back a whole cache captured before the requests went out. The
	// panel can have dropped a developer origin's slot in the meantime, and a
	// second options tab can have written its own answer; both survive this, and a
	// slot whose origin is no longer allowed is refused even if the run produced
	// one.
	function applySlots(cache, slots, allowed) {
		const keep = new Set(allowed || []);
		let out = pruneOrigins(cache, allowed);
		for (const slot of slots || []) {
			if (!slot || !keep.has(slot.origin)) continue;
			out = mergeSlot(out, slot.origin, slot.results, slot.checkedAt);
		}
		return out;
	}

	// "Different" is not good enough: after a manual import of 1.4.0 a cache entry
	// still announcing 1.3.0 would otherwise offer the user a downgrade as an
	// update. Nothing comparable stored (an entry imported before versions were
	// recorded) counts as older, because the index's version is then the only one
	// anybody knows.
	function isNewer(candidate, known) {
		if (!SEMVER_RE.test(candidate || '')) return false;
		if (!SEMVER_RE.test(known || '')) return true;
		const a = candidate.split('.').map(Number);
		const b = known.split('.').map(Number);
		for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
		return false;
	}

	// --- what to ask -------------------------------------------------------------

	// `entries` is exactly the request body: id and version, nothing else. The kind
	// stays behind in `kinds`, where it is used to check the answer rather than
	// disclosed - a menu/engine split is information about the user's entries, and
	// the index does not need it to look an id up.
	function updateRequestGroups(settings, local) {
		const allowed = new Set(EU.allowedOrigins(local));
		const byOrigin = new Map();
		for (const e of EU.listProvenanced(settings)) {
			const s = e.stored.source;
			if (!s || typeof s.indexOrigin !== 'string' || !allowed.has(s.indexOrigin)) continue;
			if (typeof s.indexId !== 'string' || !EU.ID_RE.test(s.indexId)) continue;
			if (!byOrigin.has(s.indexOrigin)) byOrigin.set(s.indexOrigin, new Map());
			const entries = byOrigin.get(s.indexOrigin);
			// The same index entry can sit in two storage places (a custom copy and
			// an edited catalog copy). One question is enough.
			if (entries.has(s.indexId)) continue;
			entries.set(s.indexId, {
				id: s.indexId,
				kind: e.kind,
				version: typeof s.version === 'string' ? s.version : null,
			});
		}
		return [...byOrigin].map(([origin, entries]) => {
			const list = [...entries.values()];
			return {
				origin,
				entries: list.map(e => ({ id: e.id, version: e.version })),
				// A Map, not an object: an id like "constructor" is pattern-valid and
				// must not reach an object's prototype chain (same reason as
				// statusAnswer's byId map in eu-integration.js).
				kinds: new Map(list.map(e => [e.id, e.kind])),
			};
		});
	}

	// force skips the window and nothing else - it does not clear, reset or
	// otherwise touch what is cached. "Check now" is a scheduling override, not a
	// reason to lose the answers already on record.
	function dueOrigins(cache, groups, nowMs, force) {
		if (force) return (groups || []).slice();
		const slots = new Map(normalizeCache(cache).origins.map(s => [s.origin, s]));
		return (groups || []).filter(g => {
			const slot = slots.get(g.origin);
			if (!slot || !slot.checkedAt) return true;
			const t = Date.parse(slot.checkedAt);
			// A stamp from the future means the clock was wrong when it was written;
			// treating it as "not due" would lock the check out until it passes.
			if (Number.isNaN(t) || t > nowMs) return true;
			return nowMs - t >= THROTTLE_MS;
		});
	}

	// --- the answer ---------------------------------------------------------------
	// Strict on the envelope, lenient on the element: a broken envelope leaves the
	// slot untouched (so a bad answer starts no throttle window), while a single
	// element the client cannot use is dropped - an element naming a type some
	// future level introduces must not invalidate today's answer.

	function normalizeResult(raw, origin, kinds, seen) {
		if (!raw || typeof raw !== 'object') return null;
		if (typeof raw.id !== 'string' || seen.has(raw.id)) return null;
		// Asked about, and answered as the kind it actually is. Without the second
		// half the index could answer a menu question with an engine and the badge
		// would point at the wrong thing; `type` travels in the answer for exactly
		// this check, which is the only reason it is in the protocol at all.
		if (kinds.get(raw.id) !== raw.type) return null;
		if (typeof raw.version !== 'string' || !SEMVER_RE.test(raw.version)) return null;
		if (typeof raw.url !== 'string') return null;
		let url;
		try { url = new URL(raw.url); } catch { return null; }
		// Never a download from anywhere but the origin that answered - the
		// extension is not a fetch proxy for a third party.
		if (url.origin !== origin) return null;
		const out = { id: raw.id, type: raw.type, version: raw.version, url: url.href };
		if (typeof raw.changelog === 'string' && raw.changelog) out.changelog = raw.changelog.slice(0, LIMITS.changelogMax);
		if (raw.deprecated === true) out.deprecated = true;
		if (typeof raw.successor === 'string' && EU.ID_RE.test(raw.successor)) out.successor = raw.successor;
		return out;
	}

	function parseUpdateResponse(text, origin, kinds) {
		if (typeof text !== 'string' || !text) return null;
		if (new TextEncoder().encode(text).length > LIMITS.responseMaxBytes) return null;
		let json;
		try { json = JSON.parse(text); } catch { return null; }
		if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
		if (!Array.isArray(json.updates) || json.updates.length > LIMITS.resultsMax) return null;
		const asked = kinds instanceof Map ? kinds : new Map();
		const seen = new Set();
		const results = [];
		for (const raw of json.updates) {
			const r = normalizeResult(raw, origin, asked, seen);
			if (!r) continue;
			seen.add(r.id);
			results.push(r);
		}
		return { results };
	}

	// --- what to show ---------------------------------------------------------------

	// Compared against what the entry stores NOW, not against the server's idea of
	// "newer": the cache still holds the answer after the user adopted it, and this
	// is what makes the badge disappear on import instead of at the next check.
	function updateFor(cache, stored) {
		const s = stored && stored.source;
		if (!s || typeof s.indexOrigin !== 'string' || typeof s.indexId !== 'string') return null;
		const slot = normalizeCache(cache).origins.find(o => o.origin === s.indexOrigin);
		if (!slot) return null;
		const hit = slot.results.find(r => r.id === s.indexId);
		if (!hit) return null;
		const known = typeof s.version === 'string' ? s.version : null;
		// `newer` is not the opposite of `deprecated`: an index may retire an entry
		// and still publish one last fix for it, and it may also announce a
		// retirement at the version the user already has. The badge reads
		// `deprecated`, the adopt button reads `newer`, and both can be true.
		const newer = isNewer(hit.version, known);
		if (!newer && !hit.deprecated) return null;
		// origin travels with the result so the adopt button can name the origin it
		// expects; the results themselves are stored per slot and carry none.
		return { ...hit, newer, origin: slot.origin };
	}

	// --- the run ------------------------------------------------------------------

	const CHANGED_EVENT = 'eu-updates-changed';

	// One origin, one request. Nothing here throws and nothing here decides
	// anything: a null return means "this origin said nothing usable", and the
	// caller then leaves its slot exactly as it was - checkedAt included, which is
	// what keeps a network error from starting the 24-hour window.
	async function askOrigin(group, fetchImpl) {
		const ctl = new AbortController();
		const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
		try {
			const res = await fetchImpl(group.origin + PATH, {
				method: 'POST',
				credentials: 'omit',
				cache: 'no-store',
				// Not 'follow'. A 307/308 preserves method AND body, so a redirect off
				// the index would hand this request's ids and versions to whatever
				// origin it names - and an attacker's endpoint can answer the preflight
				// with Access-Control-Allow-Origin: * just as happily. A JSON API has
				// no business redirecting, so any redirect is an error here. The
				// same-origin promise has to hold at request time, not only for the
				// url an answer announces.
				redirect: 'error',
				signal: ctl.signal,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ apiLevel: EU.API_LEVEL, entries: group.entries }),
			});
			if (!res.ok) return null;
			// Advisory only - a chunked answer declares no length - so this is an
			// early exit, not the limit. The limit is the byte count inside
			// parseUpdateResponse, and the abort timer is what bounds a body that
			// keeps arriving slowly.
			const declared = Number(res.headers?.get?.('content-length'));
			if (Number.isFinite(declared) && declared > LIMITS.responseMaxBytes) return null;
			return parseUpdateResponse(await res.text(), group.origin, group.kinds);
		} catch {
			return null;
		} finally {
			// Cleared here and nowhere earlier: fetch() resolves on the response
			// HEADERS, so clearing the timer around the fetch alone would leave
			// res.text() unbounded and a slow body could hang the check for good.
			clearTimeout(timer);
		}
	}

	// Sequential on purpose: two requests, at most once a day, on a page the user
	// just opened. Nothing here is worth the concurrency.
	//
	// Returns the slots it actually obtained - not a whole cache. `local` is a
	// snapshot taken before the first request, and a request may hang for the full
	// 8 seconds: long enough for the user to hit "Withdraw" in the panel right
	// beside this, or to change the developer origin. Writing back a cache captured
	// before all that would revive a slot the panel just dropped and clobber
	// anything a second options tab wrote meanwhile. So the run reports deltas and
	// persist() folds them into whatever the cache looks like afterwards.
	//
	// stillAllowed(origin) is re-asked after every answer and must re-read the
	// live state, not close over the snapshot - the same reason the hand-off fetch
	// in js/background.js re-checks euHandOffAllowed() after its own fetch.
	async function runUpdateCheck(opts) {
		const { settings, local, cache, now, fetchImpl, force, stillAllowed } = opts;
		const slots = [];
		if (!EU.effectiveEnabled(local)) return { slots };
		const groups = updateRequestGroups(settings, local);
		for (const group of dueOrigins(cache, groups, now, force)) {
			const answer = await askOrigin(group, fetchImpl);
			if (stillAllowed && !(await stillAllowed(group.origin))) continue;
			if (!answer) continue;
			slots.push({ origin: group.origin, checkedAt: new Date(now).toISOString(), results: answer.results });
		}
		return { slots };
	}

	// --- storage --------------------------------------------------------------------
	// Read on demand rather than cached: the options page reads once per open and
	// once per change event, and a stale cache here would show badges for an entry
	// the user just updated.

	async function read() {
		try {
			const raw = await chrome.storage.local.get(KEY);
			return normalizeCache(raw && raw[KEY]);
		} catch {
			// Storage unavailable (private mode, invalidated context): no badges is a
			// fine answer, a broken settings page is not.
			return { origins: [] };
		}
	}

	async function write(cache) {
		try { await chrome.storage.local.set({ [KEY]: normalizeCache(cache) }); } catch { /* see read() */ }
	}

	// Counted, not just performed: persist() takes a reading before it starts and
	// compares it before it writes, which is what lets a withdrawal that lands
	// between two awaits win over a run that had already been cleared to write.
	let revocations = 0;

	async function clear() {
		// Incremented before the await, so an in-flight persist() sees it at once.
		revocations++;
		try { await chrome.storage.local.remove(KEY); } catch { /* see read() */ }
	}

	// The write half of a run, deliberately separate from it: the live state is
	// read again here, after every request has finished, so a revoke or a changed
	// developer origin during the run wins over the run's own findings. Writes
	// nothing when nothing would change, so nothing re-renders for a no-op.
	//
	// Every `await` below is a gap a withdrawal can land in, and the promise in
	// PRIVACY.md - withdrawing deletes the stored notices - is only kept if the
	// LAST word belongs to the withdrawal. Hence the state is read after the
	// cache rather than before it, and checked once more after the write.
	async function persist(slots) {
		const seen = revocations;
		const fresh = await read();
		// Read here, not before `fresh`: what decides is the state that holds
		// immediately before the write, and `allowedOrigins` must come from it too
		// - otherwise a developer origin removed mid-run is still treated as
		// allowed and its slot is written back.
		const live = await root.GesturaEuLocal.read();
		if (seen !== revocations || !EU.effectiveEnabled(live)) return false;
		const next = applySlots(fresh, slots, EU.allowedOrigins(live));
		// EU.canonicalize is R1's stable stringifier; plain JSON.stringify would
		// report a change whenever a key order happened to differ.
		if (EU.canonicalize(next) === EU.canonicalize(fresh)) return false;
		await write(next);
		// The one gap no check can cover is between that check and the set() it
		// guards. Landing there is repaired rather than left standing: a cache
		// that outlives its permission is exactly what must not happen.
		if (seen !== revocations || !EU.effectiveEnabled(await root.GesturaEuLocal.read())) {
			await clear();
			return false;
		}
		return true;
	}

	// The one way a check is run: the options page on open (throttled), the
	// panel's "check now" (force). Both used to assemble this argument object
	// themselves, which put stillAllowed - the predicate that makes a mid-run
	// revoke win - in the hands of every caller, optional and easy to forget. It
	// lives here now; runUpdateCheck stays injectable for the tests.
	//
	// `settings` comes in from outside because this is a classic script and cannot
	// import the SettingsStore module.
	async function checkAndPersist(settings, force) {
		try {
			const local = await root.GesturaEuLocal.read();
			// Nothing to ask and nothing to show: skip the cache read as well.
			if (!EU.effectiveEnabled(local)) return false;
			const { slots } = await runUpdateCheck({
				settings,
				local,
				cache: await read(),
				now: Date.now(),
				fetchImpl: (url, init) => fetch(url, init),
				force: !!force,
				// Re-reads the live state per answer, so both a revoke and a changed
				// developer origin during the run drop that answer on the floor.
				stillAllowed: async (origin) => {
					const cur = await root.GesturaEuLocal.read();
					return EU.effectiveEnabled(cur) && EU.allowedOrigins(cur).includes(origin);
				},
			});
			return await persist(slots);
		} catch {
			// A nicety in the background: no dialog, no status line. The next open
			// tries again, because a failed origin's checkedAt was never written.
			return false;
		}
	}

	// --- keeping the cache honest --------------------------------------------------
	// Both of these exist so that no writer has to remember anything. eu-local.js
	// gets the same guarantees from storage.onChanged for its own key; this is that
	// pattern, applied to euUpdates.

	// typeof-guarded, unlike eu-local.js's identical block: that file only ever
	// runs where chrome exists, this one is also imported bare by vitest.
	if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area !== 'local' || !changes[KEY]) return;
			// A removal from ANOTHER tab has to stop an in-flight persist() here just
			// as a local clear() does - the counter is what carries that across.
			if (changes[KEY].newValue === undefined) revocations++;
			// One announcement per actual write, wherever it came from - including a
			// SECOND OPTIONS TAB, which a window event could never have reached. That
			// is the concurrency runUpdateCheck's own comment reasons about.
			if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED_EVENT));
		});
	}

	if (root.GesturaEuLocal && root.GesturaEuLocal.onChange) {
		root.GesturaEuLocal.onChange(async (local) => {
			// Reconciled on the state change rather than at the one keystroke that
			// caused it, so an imported settings file or a second tab prunes too.
			const cur = await read();
			const next = pruneOrigins(cur, EU.allowedOrigins(local));
			if (EU.canonicalize(next) !== EU.canonicalize(cur)) await write(next);
		});
	}

	const api = {
		PATH, LIMITS, CHANGED_EVENT,
		normalizeCache, mergeSlot, pruneOrigins, applySlots, isNewer,
		updateRequestGroups, dueOrigins, parseUpdateResponse, updateFor,
		runUpdateCheck, read, write, clear, persist, checkAndPersist,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaEuUpdates = api;
})(typeof self !== 'undefined' ? self : globalThis);
