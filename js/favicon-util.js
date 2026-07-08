// Shared favicon helpers (content script, service worker, and options page).
// Pure/DOM-free so it also runs inside the MV3 service worker.
(function (root) {
	'use strict';

	function monogramLetter(name) {
		const m = String(name || '').match(/[a-z0-9]/i);
		return m ? m[0].toUpperCase() : '?';
	}

	function hslToHex(h, s, l) {
		s /= 100; l /= 100;
		const k = n => (n + h / 30) % 12;
		const a = s * Math.min(l, 1 - l);
		const f = n => {
			const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
			return Math.round(255 * c).toString(16).padStart(2, '0');
		};
		return `#${f(0)}${f(8)}${f(4)}`;
	}

	function colorForName(name) {
		let hash = 0;
		const s = String(name || '');
		for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
		return hslToHex(hash % 360, 62, 46);
	}

	function monogramDataUri(name) {
		const letter = monogramLetter(name);
		const bg = colorForName(name);
		const svg =
			`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
			`<rect width="32" height="32" rx="7" fill="${bg}"/>` +
			`<text x="16" y="17" font-family="system-ui,Segoe UI,Arial,sans-serif" font-size="18" ` +
			`font-weight="600" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${letter}</text>` +
			`</svg>`;
		return 'data:image/svg+xml,' + encodeURIComponent(svg);
	}

	function sizeFromAttr(sizes) {
		if (!sizes) return 0;
		if (/any/i.test(sizes)) return 9999;
		const nums = String(sizes).match(/\d+/g);
		return nums ? Math.max(...nums.map(Number)) : 0;
	}

	function attr(tag, name) {
		const m = tag.match(new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i'));
		return m ? (m[2] !== undefined ? m[2] : m[3]) : '';
	}

	function parseIconLinks(html, baseUrl) {
		const out = [];
		const tags = String(html || '').match(/<link\b[^>]*>/gi) || [];
		for (const tag of tags) {
			const rel = attr(tag, 'rel');
			if (!/icon/i.test(rel)) continue;
			const href = attr(tag, 'href');
			if (!href) continue;
			let abs;
			try { abs = new URL(href, baseUrl).href; } catch { continue; }
			out.push({ href: abs, size: sizeFromAttr(attr(tag, 'sizes')) });
		}
		return out;
	}

	function pickBestIconHref(links, target) {
		target = target || 32;
		if (!links || !links.length) return null;
		const atOrAbove = links.filter(l => l.size >= target);
		if (atOrAbove.length) return atOrAbove.reduce((a, b) => (b.size < a.size ? b : a)).href;
		const known = links.filter(l => l.size > 0);
		if (known.length) return known.reduce((a, b) => (b.size > a.size ? b : a)).href;
		return links[0].href;
	}

	const api = { monogramLetter, colorForName, monogramDataUri, parseIconLinks, pickBestIconHref, sizeFromAttr };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseFavicon = api;
})(typeof self !== 'undefined' ? self : globalThis);
