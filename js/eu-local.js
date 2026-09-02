// The only reader/writer of the website-integration state in chrome.storage.local.
// One key, a live cache fed by storage.onChanged, and the effective-enabled
// check that every gated path calls right before it acts. Runs in content
// scripts (all frames), the service worker and the options page alike — hence
// a classic script with a root global and no window-only APIs.
(function (root) {
	'use strict';

	const EU = root.FlowMouseEuIntegration;
	const KEY = 'euIntegration';
	let cache = EU.normalizeLocal({});
	let loaded = false;
	let loading = null;
	const listeners = new Set();

	function absorb(raw) {
		cache = EU.normalizeLocal(raw);
		loaded = true;
		return cache;
	}

	function load() {
		if (!loading) {
			let promise;
			try {
				promise = chrome.storage.local.get(KEY);
			} catch {
				// Synchronous throw when extension context is invalidated (e.g. after
				// reload while an old content script is still running in an open tab).
				// Treat as storage unavailable and use defaults instead.
				promise = Promise.resolve({});
			}
			loading = promise.then(absorb).catch(() => absorb({}));
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
		const next = { ...(await read()).euIntegration, ...(patch || {}) };
		await chrome.storage.local.set({ [KEY]: next });
		return absorb({ [KEY]: next });
	}

	async function isEnabled() {
		return EU.effectiveEnabled(await read());
	}

	function onChange(fn) {
		listeners.add(fn);
		return () => listeners.delete(fn);
	}

	if (chrome.storage && chrome.storage.onChanged) {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area !== 'local' || !changes[KEY]) return;
			absorb({ [KEY]: changes[KEY].newValue });
			for (const fn of listeners) { try { fn(cache); } catch { /* a listener must not break the others */ } }
		});
	}

	load();

	root.GesturaEuLocal = { KEY, read, current, write, isEnabled, onChange };
})(typeof self !== 'undefined' ? self : globalThis);
