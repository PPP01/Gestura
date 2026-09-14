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
		const host = u.hostname.toLowerCase();
		if (!host) return null;
		return { host, port: u.port || '', path: u.pathname.replace(/\/+$/, '') };
	}

	function normalize(input) {
		const p = parse(input);
		if (!p) return null;
		return p.host + (p.port ? ':' + p.port : '') + p.path;
	}

	const api = { parse, normalize, effectivePort };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaBlacklist = api;
})(typeof self !== 'undefined' ? self : globalThis);
