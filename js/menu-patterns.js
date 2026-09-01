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
	// Ein Name, der selbst wie eine Domain aussieht, weckt eine Erwartung an das
	// Ziel. Nennt er eine andere als die geöffnete, ist das einen Hinweis wert —
	// verboten ist es nicht. Namen ohne Domainform ("Posteingang") bleiben stumm.
	// new URL() kann das Schema abstreifen, aber nicht die Domainform prüfen: es
	// nähme auch "192.168.1.1" oder "Spiegel.de lesen" klaglos an.
	function toDomain(value) {
		const host = String(value || '').trim().toLowerCase()
			.replace(/^\w+:\/\//, '')
			.replace(/[/?#].*/, '')
			.replace(/^www\./, '');
		return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host) ? host : null;
	}
	function nameUrlMismatch(name, url) {
		const named = toDomain(name);
		if (!named) return null;
		let target;
		try { target = toDomain(new URL(url).hostname); } catch { return null; }
		if (!target || named === target) return null;
		// Sub- und Hauptdomain zählen als dasselbe Ziel.
		if (target.endsWith('.' + named) || named.endsWith('.' + target)) return null;
		return { name: named, url: target };
	}

	const api = { siteToPattern, pageToPattern, addSiteToMenuPatterns, nameUrlMismatch };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseMenuPatterns = api;
})(typeof self !== 'undefined' ? self : globalThis);
