(function (root) {
	function siteToPattern(url) {
		try { return '*' + new URL(url).hostname.toLowerCase() + '*'; } catch { return null; }
	}
	// Muster für die konkrete Seite statt der ganzen Domain. Query und Fragment
	// fallen weg — sie sind fast nie Teil dessen, was eine Seite ausmacht, und
	// würden das Muster auf genau einen Aufruf festnageln. Der Pfad bleibt
	// unverändert stehen; ihn auf den gewünschten Bereich zu kürzen ist Sache
	// des Nutzers im Dialog.
	function pageToPattern(url) {
		try {
			const u = new URL(url);
			const path = u.pathname.replace(/\/+$/, '');
			return '*' + u.hostname.toLowerCase() + path + '*';
		} catch { return null; }
	}
	function addSiteToMenuPatterns(menus, menuId, url) {
		const menu = menus && menus[menuId];
		const pattern = siteToPattern(url);
		if (!menu || !pattern) return { menus, added: null };
		const cur = menu.patterns || [];
		if (cur.includes(pattern)) return { menus, added: null };
		const next = { ...menus, [menuId]: { ...menu, patterns: [...cur, pattern] } };
		return { menus: next, added: pattern };
	}
	const api = { siteToPattern, pageToPattern, addSiteToMenuPatterns };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseMenuPatterns = api;
})(typeof self !== 'undefined' ? self : globalThis);
