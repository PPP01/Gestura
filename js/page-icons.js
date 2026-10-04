(function (root) {
	// "Icon of the page": read the SVG path a page draws next to a link, so a
	// menu entry can wear the same icon. Content-script side, runs only when a
	// menu opens and an item asks for it. Only the path data (the `d` string)
	// leaves this file, after validation - the menu builds its own <svg>, page
	// markup never enters the menu.

	const MAX_PATH_LENGTH = 4096;
	const MAX_LINKS = 1500;
	const MIN_NUMBERS = 4;
	// A path is a run of commands, numbers and separators - nothing else, so
	// nothing that could close an attribute or start markup.
	const PATH_TOKENS = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[\s,]+/g;
	const PATH_NUMBERS = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

	function sanitizePathData(d) {
		if (typeof d !== 'string') return null;
		const s = d.trim();
		if (!s || s.length > MAX_PATH_LENGTH || !/^[Mm]/.test(s)) return null;
		if (s.replace(PATH_TOKENS, '') !== '') return null;
		// Too few numbers cannot draw anything; show the fallback icon instead of
		// an empty one.
		if ((s.match(PATH_NUMBERS) || []).length < MIN_NUMBERS) return null;
		return s;
	}

	function normalizePath(p) {
		return p.length > 1 ? p.replace(/\/+$/, '') || '/' : p;
	}

	// Path of `url` on the page's own origin; null for anything else. Icons are
	// never looked up for other sites.
	function targetPath(url, pageUrl) {
		try {
			const u = new URL(url);
			if (u.origin === 'null' || u.origin !== new URL(pageUrl).origin) return null;
			return normalizePath(u.pathname);
		} catch { return null; }
	}

	function isSegmentPrefix(anchorPath, path) {
		if (anchorPath === '/') return true;
		return path === anchorPath || path.startsWith(anchorPath + '/');
	}

	function pickEntry(entries, path, allowPrefix) {
		if (!path || !entries || !entries.length) return null;
		const exact = entries.find(e => e.path === path);
		if (exact) return exact.d;
		if (typeof allowPrefix !== 'function') return null;
		let best = null;
		for (const e of entries) {
			if (e.path === path || !isSegmentPrefix(e.path, path) || !allowPrefix(e.path, path)) continue;
			if (!best || e.path.length > best.path.length) best = e;
		}
		return best ? best.d : null;
	}

	// querySelectorAll over `node` and over every open shadow root below it.
	function deep(node, sel, out) {
		out = out || [];
		if (!node || typeof node.querySelectorAll !== 'function') return out;
		for (const e of node.querySelectorAll(sel)) out.push(e);
		for (const e of node.querySelectorAll('*')) if (e.shadowRoot) deep(e.shadowRoot, sel, out);
		return out;
	}

	function iconDataOf(anchor) {
		let p = deep(anchor, 'svg path[d]')[0]
			|| (anchor.shadowRoot && deep(anchor.shadowRoot, 'svg path[d]')[0]);
		if (!p) {
			// Material list items keep the icon in a slot of the element that hosts
			// the anchor's shadow root. That icon is the anchor's own only if the
			// anchor is the sole link in there - with several links the host's SVG
			// could belong to any of them (or to none).
			const rootNode = typeof anchor.getRootNode === 'function' ? anchor.getRootNode() : null;
			const host = rootNode && rootNode.host;
			if (host && typeof rootNode.querySelectorAll === 'function'
				&& rootNode.querySelectorAll('a[href]').length === 1) {
				p = deep(host, 'svg path[d]')[0];
			}
		}
		return p ? sanitizePathData(p.getAttribute('d')) : null;
	}

	function collect(rootNode, pageUrl) {
		const entries = [];
		const seen = new Set();
		let inspected = 0;
		for (const a of deep(rootNode, 'a[href]')) {
			if (++inspected > MAX_LINKS) break;
			let href;
			// baseURI honours <base href>, so this is the address the browser
			// would really follow.
			try { href = new URL(a.getAttribute('href'), a.baseURI || pageUrl).href; } catch { continue; }
			const path = targetPath(href, pageUrl);
			if (!path || seen.has(path)) continue;
			const d = iconDataOf(a);
			if (!d) continue;
			seen.add(path);
			entries.push({ path, d });
		}
		return entries;
	}

	// Site-specific rules (see page-icons-homeassistant.js) register here.
	const providers = [];

	function createFinder(pageUrl, rootNode, replaceUrl) {
		let entries = null;
		let allowPrefix;
		return function find(item) {
			const fallback = { iconName: 'link' };
			const template = item && typeof item.customUrl === 'string' ? item.customUrl : '';
			if (!template) return fallback;
			let url;
			try { url = replaceUrl ? replaceUrl(template, { url: pageUrl }) : template; } catch { return fallback; }
			const path = targetPath(url, pageUrl);
			if (!path) return fallback;
			if (!entries) {
				try {
					entries = collect(rootNode, pageUrl);
					const provider = providers.find(p => { try { return p.applies(rootNode); } catch { return false; } });
					allowPrefix = provider ? provider.allowPrefix : undefined;
				} catch { entries = []; }
			}
			const d = pickEntry(entries, path, allowPrefix);
			return d ? { iconPath: d } : fallback;
		};
	}

	const api = { sanitizePathData, targetPath, pickEntry, collect, createFinder, providers };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMousePageIcons = api;
})(typeof self !== 'undefined' ? self : globalThis);
