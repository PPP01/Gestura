// The blacklist rule, in one place. Four callers used to carry their own
// blacklist.includes(hostname): the gesture gate in js/content.js, the popup
// switch, and the context menu's state and its toggle. Four exact-string
// comparisons were four correct implementations of the same thing; four prefix
// matchers would have been four chances to drift.
//
// Design: docs/superpowers/specs/2026-09-14-blacklist-port-path-design.md
(function (root) {
	const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

	// The port a URL really speaks on. new URL() leaves .port empty when it is the
	// scheme's default, so an entry naming 443 has to be compared against this and
	// not against .port, or it would never match anything.
	function effectivePort(port, protocol) {
		if (port) return port;
		if (protocol === 'https:') return '443';
		if (protocol === 'http:') return '80';
		return '';
	}

	// Parsed under a non-special scheme on purpose. The URL standard gives those no
	// default port, so ':443' and ':80' survive; under 'https://' they are removed
	// and the entry silently widens to the whole host. A non-special scheme also
	// leaves hostname unfolded — hence the explicit toLowerCase — and leaves the
	// path's case alone, which is what we want: hosts are case-insensitive, paths
	// are not.
	function parse(entry) {
		const s = String(entry == null ? '' : entry).trim().replace(SCHEME, '');
		if (!s) return null;
		let u;
		try { u = new URL('gestura://' + s); } catch { return null; }
		if (!u.hostname) return null;
		// The non-special scheme above is what keeps an explicit default port
		// (:443, :80) from being silently dropped, but it also skips IDNA: a
		// Unicode host like "bücher.de" comes back as percent-encoded garbage
		// instead of the punycode form location.hostname would report. Re-parse
		// just the host under a special scheme to get correct punycode and
		// case-folding; keep port and path from the parse above, since a
		// special-scheme parse is exactly the one that drops a default port.
		let host;
		try { host = new URL('https://' + u.hostname).hostname; } catch { return null; }
		return { host, port: u.port || '', path: u.pathname.replace(/\/+$/, '') };
	}

	function normalize(input) {
		const p = parse(input);
		if (!p) return null;
		return p.host + (p.port ? ':' + p.port : '') + p.path;
	}

	// The boundary is the path separator, which is why the rule needs no wildcard
	// syntax: /games covers /games/pong and stops short of /gameszone. Compared
	// case-sensitively, because paths are.
	function pathMatches(pathname, path) {
		if (!path) return true;
		if (pathname === path) return true;
		return pathname.startsWith(path + '/');
	}

	function matches(url, entry) {
		const e = parse(entry);
		if (!e) return false;
		let u;
		try { u = new URL(url); } catch { return false; }
		if (u.hostname.toLowerCase() !== e.host) return false;
		if (e.port && effectivePort(u.port, u.protocol) !== e.port) return false;
		return pathMatches(u.pathname, e.path);
	}

	// Every match, not the first: the quick toggle may only act when the bare host
	// is the sole reason a page is blocked, and asking "which one wins" would make
	// that depend on the order entries were added in. Deduplicated by normalized
	// form, not raw string: two entries that only differ in case, or an exact
	// duplicate from an import, must not defeat the "bare host is the only
	// reason" check that decides whether the toggle may act.
	function matchingEntries(url, entries) {
		if (!Array.isArray(entries)) return [];
		const seen = new Set();
		const result = [];
		for (const entry of entries) {
			if (!matches(url, entry)) continue;
			const key = normalize(entry);
			if (key === null || seen.has(key)) continue;
			seen.add(key);
			result.push(entry);
		}
		return result;
	}

	// The document-level verdict, split the way js/content.js needs it: host and
	// port are fixed for the life of a document and decided here, once; a path can
	// change under a single-page app, so its entries are only collected here and
	// re-checked per gesture. Pure, so it can be tested without a DOM.
	function evaluate(loc, entries) {
		const result = { originBlocked: false, pathEntries: [] };
		if (!Array.isArray(entries)) return result;

		const host = String(loc.hostname || '').toLowerCase();
		const port = effectivePort(loc.port, loc.protocol);

		for (const raw of entries) {
			const e = parse(raw);
			if (!e || e.host !== host) continue;
			if (e.port && e.port !== port) continue;
			if (e.path) result.pathEntries.push(e);
			else result.originBlocked = true;
		}

		// A frame inside a blocked page is blocked too. An origin has no path, so
		// only host and port entries can decide this one — see issue #7.
		if (!result.originBlocked && loc.ancestorOrigin) {
			let a = null;
			try { a = new URL(loc.ancestorOrigin); } catch { a = null; }
			if (a) {
				result.originBlocked = entries.some(raw => {
					const e = parse(raw);
					if (!e || e.path) return false;
					if (a.hostname.toLowerCase() !== e.host) return false;
					return !e.port || effectivePort(a.port, a.protocol) === e.port;
				});
			}
		}
		return result;
	}

	const api = { parse, normalize, effectivePort, pathMatches, matches, matchingEntries, evaluate };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaBlacklist = api;
})(typeof self !== 'undefined' ? self : globalThis);
