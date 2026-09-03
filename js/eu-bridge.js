// The page ↔ extension bridge for gestura.eu (and one configured dev origin).
// Pull only: the page asks, we answer — and only while the website integration
// is effectively on and this frame's origin is allowed. Every other case is
// silence, indistinguishable from "not installed"; that silence is the
// fingerprinting protection. Wire contract as in the 2.8.0 hand-off: events on
// document, detail as a JSON string (Firefox Xray-safe, size-checkable before
// parsing).
(function () {
	'use strict';
	if (window.__gesturaEuBridge) return;
	window.__gesturaEuBridge = true;

	const EU = self.FlowMouseEuIntegration;
	const LOCAL = self.GesturaEuLocal;
	if (!EU || !LOCAL) return;

	// Cheap synchronous exit for origins that can never be allowed: the production
	// origin is https, and a dev origin is either https or http on a loopback host.
	// Everything else leaves without touching storage or registering a listener.
	// Registration itself stays synchronous on purpose - a page may ask at
	// document_start, and a listener deferred until the state load finished would
	// miss that request.
	const loopback = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
	if (location.protocol !== 'https:' && !(location.protocol === 'http:' && loopback)) return;

	function reply(type, answer) {
		document.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(answer), bubbles: true }));
	}

	// Re-read the switch and the origin list on every request — never across an
	// async gap: the local state is awaited first, then checked, then answered.
	async function gate() {
		const local = await LOCAL.read();
		if (!EU.effectiveEnabled(local)) return false;
		return EU.allowedOrigins(local).includes(location.origin);
	}

	// Both handlers are wrapped whole. Silence is the only failure mode this bridge
	// has toward a page, and an uncaught throw would break it: an unhandled rejection
	// prints to the page's own console, which the page can observe. Nothing in here
	// is guaranteed not to throw - getManifest() fails on an invalidated context,
	// storage can reject, and reply() touches JSON.stringify and the DOM.
	document.addEventListener('gestura:hello', async (e) => {
		try {
			const req = EU.parseBridgeRequest(e.detail);
			if (!req) return;
			if (!(await gate())) return;
			reply('gestura:hello-result', EU.helloAnswer(req, chrome.runtime.getManifest().version));
		} catch { /* silence */ }
	}, true);

	document.addEventListener('gestura:query-status', async (e) => {
		try {
			const req = EU.parseBridgeRequest(e.detail);
			// A request without `ids` is well-formed, just pointless: statusAnswer
			// returns an empty array for it. Only a request that fails to parse gets
			// silence - answering the empty case keeps the contract honest.
			if (!req) return;
			if (!(await gate())) return;
			const settings = await chrome.storage.sync.get(['siteMenus', 'searchEngines']);
			// The switch may have flipped while we read the settings.
			if (!(await gate())) return;
			reply('gestura:query-status-result', await EU.statusAnswer(req, location.origin, settings));
		} catch { /* silence */ }
	}, true);
})();
