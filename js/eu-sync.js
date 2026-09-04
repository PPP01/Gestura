// The four sync endpoints, and the gate around them.
//
// The gate is why this is a file rather than four fetch calls in the panel:
// every operation re-reads the live state immediately before it acts and again
// after the answer arrives. A request can be in flight for fifteen seconds -
// long enough for the user to hit "Withdraw" in the panel right beside it, or
// for a second options tab to do it. R2's persist() is where this shape comes
// from, and tests/eu-updates-persist.test.mjs is why it exists at all.
//
// Everything below the gate takes its fetch as an argument, so the whole
// protocol is testable without a network.
(function (root) {
	'use strict';

	const EU = root.FlowMouseEuIntegration;
	const BASE = '/api/v1/sync';
	const PATHS = { list: BASE + '/list', state: BASE + '/state', get: BASE + '/get', del: BASE + '/delete' };

	// Mirrors docs/gestura-eu-api.md. Checked client-side too, so an oversized
	// state is refused with the number rather than with a 413.
	const LIMITS = {
		metaMaxBytes: 8 * 1024,
		payloadMaxBytes: 512 * 1024,
		statesMax: 5,
		responseMaxBytes: 1024 * 1024,
		timeoutMs: 15000,
	};

	const STATUS = {
		400: 'bad-request', 404: 'not-found', 409: 'quota-states',
		412: 'conflict', 413: 'too-large', 429: 'rate-limited',
	};

	// `updatedAt` is carried only by a conflict, where the contract puts it in the
	// refusal so the panel can say WHEN the state moved under the upload without
	// asking a second time. Empty everywhere else.
	function syncError(code, updatedAt) {
		const e = new Error(code);
		e.code = code;
		e.updatedAt = typeof updatedAt === 'string' ? updatedAt : '';
		return e;
	}

	async function request(opts) {
		const { origin, path, method, body, fetchImpl } = opts;
		const ctl = new AbortController();
		const timer = setTimeout(() => ctl.abort(), LIMITS.timeoutMs);
		let res;
		try {
			res = await fetchImpl(origin + path, {
				method,
				credentials: 'omit',
				cache: 'no-store',
				// A JSON API has no business redirecting, and a redirect is how a
				// same-origin promise quietly stops being one. Same rule as the update
				// check.
				redirect: 'error',
				signal: ctl.signal,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
		} catch {
			clearTimeout(timer);
			throw syncError('network');
		}
		try {
			if (!res.ok) {
				const code = STATUS[res.status] || 'server';
				// The body of an error is read for exactly one code, and defensively:
				// a conflict carries the current updatedAt, and a body that is missing,
				// truncated or not JSON must still arrive as a clean conflict rather
				// than as a second, unrelated failure.
				let updatedAt = '';
				if (code === 'conflict') {
					try { updatedAt = JSON.parse(await res.text()).updatedAt; } catch { /* no date, still a conflict */ }
				}
				throw syncError(code, updatedAt);
			}
			const declared = Number(res.headers?.get?.('content-length'));
			if (Number.isFinite(declared) && declared > LIMITS.responseMaxBytes) throw syncError('too-large');
			const text = await res.text();
			if (new TextEncoder().encode(text).length > LIMITS.responseMaxBytes) throw syncError('too-large');
			let parsed;
			try { parsed = JSON.parse(text); } catch { throw syncError('malformed'); }
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw syncError('malformed');
			return parsed;
		} finally {
			// Cleared here, not around the fetch: fetch() resolves on the response
			// HEADERS, so a body that keeps arriving slowly would otherwise be
			// unbounded.
			clearTimeout(timer);
		}
	}

	const isEnvelope = (v) => typeof v === 'string' && v.length > 0;

	async function listStates(opts) {
		const { secret, origin, fetchImpl } = opts;
		const X = root.GesturaSyncCrypto;
		const answer = await request({
			origin, path: PATHS.list, method: 'POST', fetchImpl,
			body: { apiLevel: EU.API_LEVEL, locator: await X.deriveLocator(secret) },
		});
		if (!Array.isArray(answer.states)) throw syncError('malformed');
		const key = await X.deriveKey(secret);
		const out = [];
		for (const s of answer.states) {
			if (!s || typeof s !== 'object') throw syncError('malformed');
			// The id has to be right, or the state cannot even be addressed to delete
			// it. The meta blob does not: missing or undecryptable, THAT state is
			// unreadable - reported below, not thrown, because a throw here would
			// read as "all your states are gone" and take the delete button with it.
			// decryptBlob refuses a non-envelope itself.
			if (!X.STATE_ID_RE.test(s.stateId)) throw syncError('malformed');
			let meta = null;
			try { meta = await X.decryptBlob(key, s.stateId, 'meta', s.meta); } catch { /* broken below */ }
			out.push({
				stateId: s.stateId,
				size: Number(s.size) || 0,
				updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : '',
				meta,
				broken: meta === null,
			});
		}
		return out;
	}

	// `basePayloadHash` names the state this upload is built on: the payloadHash
	// out of the meta blob the client read. Sending it turns the write into
	// "replace what I saw"; leaving it out means "write unconditionally", which is
	// how a new state is created and how the user says "overwrite anyway" after a
	// conflict. It works as a token because every encryption uses a fresh IV, so
	// two uploads of identical settings still hash differently.
	async function uploadState(opts) {
		const { secret, origin, stateId, name, createdAt, exportObj, extVersion, basePayloadHash, fetchImpl } = opts;
		const X = root.GesturaSyncCrypto;
		const key = await X.deriveKey(secret);
		const payload = await X.encryptCompressed(key, stateId, 'payload', exportObj);
		if (payload.length > LIMITS.payloadMaxBytes) throw syncError('too-large');
		const meta = await X.encryptBlob(key, stateId, 'meta', {
			name,
			createdAt: createdAt || new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			extVersion,
			// Binds the two blobs of this state to each other, so the server cannot
			// pair this meta with an older payload.
			payloadHash: await X.blobHash(payload),
		});
		if (meta.length > LIMITS.metaMaxBytes) throw syncError('too-large');
		const body = { apiLevel: EU.API_LEVEL, locator: await X.deriveLocator(secret), stateId, meta, payload };
		// Only a usable hash travels. Anything else - '', null, a number - would be
		// a token the server has to reject, and the caller meant "unconditional".
		if (typeof basePayloadHash === 'string' && basePayloadHash) body.basePayloadHash = basePayloadHash;
		return request({ origin, path: PATHS.state, method: 'PUT', fetchImpl, body });
	}

	// expectPayloadHash is REQUIRED, and deliberately so. It is the only
	// cryptographic tie between a state's meta blob and its payload, and an
	// optional check is one a hostile server can switch off: serve a meta whose
	// payloadHash is missing, and `if (hash && ...)` skips the comparison for it.
	// So the absence of a hash is itself a failure, not a reason to skip.
	async function downloadState(opts) {
		const { secret, origin, stateId, expectPayloadHash, fetchImpl } = opts;
		const X = root.GesturaSyncCrypto;
		if (typeof expectPayloadHash !== 'string' || !expectPayloadHash) throw syncError('decrypt');
		const answer = await request({
			origin, path: PATHS.get, method: 'POST', fetchImpl,
			body: { apiLevel: EU.API_LEVEL, locator: await X.deriveLocator(secret), stateId },
		});
		if (!isEnvelope(answer.payload)) throw syncError('malformed');
		// blobHash decodes the base64 first, and a payload that is not base64 is a
		// malformed answer - not a server status, which is what an uncaught
		// DOMException would be reported as.
		let hash;
		try { hash = await X.blobHash(answer.payload); } catch { throw syncError('malformed'); }
		if (hash !== expectPayloadHash) throw syncError('decrypt');
		const key = await X.deriveKey(secret);
		try {
			return await X.decryptBlob(key, stateId, 'payload', answer.payload);
		} catch {
			throw syncError('decrypt');
		}
	}

	async function deleteStates(opts) {
		const { secret, origin, stateId, fetchImpl } = opts;
		const X = root.GesturaSyncCrypto;
		const body = { apiLevel: EU.API_LEVEL, locator: await X.deriveLocator(secret) };
		if (stateId) body.stateId = stateId;
		return request({ origin, path: PATHS.del, method: 'POST', fetchImpl, body });
	}

	// The gate. Read the live state, act, read it again - and throw 'disabled'
	// rather than return, so no caller can mistake a discarded answer for an
	// empty one.
	async function gated(fn) {
		const L = root.GesturaSyncLocal;
		const local = await root.GesturaEuLocal.read();
		const sync = await L.read();
		if (!L.syncEnabled(local, sync)) throw syncError('disabled');
		const parsed = await root.GesturaSyncCode.parse(sync.euSync.secret);
		if (!parsed.secret) throw syncError('no-secret');

		const result = await fn({
			secret: parsed.secret,
			origin: L.syncOrigin(local),
			fetchImpl: (url, init) => fetch(url, init),
		});

		if (!L.syncEnabled(await root.GesturaEuLocal.read(), await L.read())) throw syncError('disabled');
		return result;
	}

	const list = () => gated(ctx => listStates(ctx));
	const upload = (opts) => gated(ctx => uploadState({ ...opts, ...ctx }));
	const download = (opts) => gated(ctx => downloadState({ ...opts, ...ctx }));
	const remove = (stateId) => gated(ctx => deleteStates({ ...ctx, stateId }));

	const api = {
		PATHS, LIMITS, syncError, request,
		listStates, uploadState, downloadState, deleteStates,
		list, upload, download, remove,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSync = api;
})(typeof self !== 'undefined' ? self : globalThis);
