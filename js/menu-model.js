(function (root) {
	// Pure Auflösungs- und Editier-Logik für Website-Menüs.
	// Keine chrome.*-APIs, keine i18n — Labels (labelKey/customName) löst der Aufrufer auf.
	// Alle Funktionen sind immutabel: Eingaben werden nie verändert.

	function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

	function getBaseMenu(catalog, siteMenus, menuId) {
		if (!menuId) return null;
		const sm = siteMenus || {};
		if (sm.edited && sm.edited[menuId]) return { ...clone(sm.edited[menuId]), id: menuId };
		if (sm.custom && sm.custom[menuId]) return { ...clone(sm.custom[menuId]), id: menuId };
		const c = (catalog || []).find(m => m.id === menuId);
		return c ? clone(c) : null;
	}

	function listMenus(catalog, siteMenus) {
		const sm = siteMenus || {};
		const disabled = new Set(sm.disabled || []);
		const ids = [];
		const push = (id) => { if (!ids.includes(id)) ids.push(id); };
		for (const id of (sm.order || [])) push(id);
		for (const m of (catalog || [])) push(m.id);
		for (const id of Object.keys(sm.custom || {})) push(id);
		return ids
			.map(id => ({ id, def: getBaseMenu(catalog, sm, id) }))
			.filter(e => e.def)
			.map(e => ({
				id: e.id,
				def: e.def,
				isCustom: !!(sm.custom && sm.custom[e.id]),
				isEdited: !!(sm.edited && sm.edited[e.id]),
				disabled: disabled.has(e.id),
			}));
	}

	function listActiveMenus(catalog, siteMenus) {
		return listMenus(catalog, siteMenus).filter(m => !m.disabled);
	}

	function emptyFork() {
		return { overrides: {}, removed: [], added: [], order: null, name: '' };
	}

	function resolveFork(baseItems, fork) {
		const f = fork || emptyFork();
		const overrides = f.overrides || {};
		const removed = new Set(f.removed || []);
		const added = (f.added || []).map(clone);
		const base = (baseItems || [])
			.filter(it => !removed.has(it.id))
			.map(it => overrides[it.id] ? { ...clone(overrides[it.id]), id: it.id } : clone(it));

		if (Array.isArray(f.order)) {
			const pool = new Map(base.map(it => [it.id, it]));
			for (const it of added) pool.set(it.id, it);
			const out = [];
			for (const id of f.order) {
				const it = pool.get(id);
				if (it) { out.push(it); pool.delete(id); }
			}
			for (const it of pool.values()) out.push(it); // neue Basis-Items ans Ende
			return out;
		}

		// Positionsvererbung: Basisreihenfolge, added per Anker einfügen.
		const out = [...base];
		let headInsert = 0; // added mit afterId '' behalten ihre gespeicherte Reihenfolge am Anfang
		for (const raw of added) {
			const it = { ...raw };
			const afterId = it.afterId ?? '';
			if (afterId === '') { out.splice(headInsert++, 0, it); continue; }
			const idx = out.findIndex(b => b.id === afterId);
			if (idx === -1) out.push(it);
			else out.splice(idx + 1, 0, it);
		}
		return out;
	}

	function forkOverrideItem(fork, baseItems, item) {
		const f = clone(fork) || emptyFork();
		const isAdded = (f.added || []).some(a => a.id === item.id);
		if (isAdded) {
			f.added = f.added.map(a => a.id === item.id ? { ...clone(item), afterId: a.afterId } : a);
			return f;
		}
		if ((baseItems || []).some(b => b.id === item.id)) {
			const o = clone(item);
			delete o.afterId;
			f.overrides = { ...(f.overrides || {}), [item.id]: o };
		}
		return f;
	}

	function forkDeleteItem(fork, baseItems, itemId) {
		const f = clone(fork) || emptyFork();
		if ((f.added || []).some(a => a.id === itemId)) {
			f.added = f.added.filter(a => a.id !== itemId);
		} else if ((baseItems || []).some(b => b.id === itemId)) {
			if (!(f.removed || []).includes(itemId)) f.removed = [...(f.removed || []), itemId];
			if (f.overrides) delete f.overrides[itemId];
		}
		if (Array.isArray(f.order)) f.order = f.order.filter(id => id !== itemId);
		return f;
	}

	function forkRestoreItem(fork, itemId) {
		const f = clone(fork) || emptyFork();
		f.removed = (f.removed || []).filter(id => id !== itemId);
		if (f.overrides) delete f.overrides[itemId];
		return f;
	}

	function forkAddItem(fork, item, afterId) {
		const f = clone(fork) || emptyFork();
		f.added = [...(f.added || []), { ...clone(item), afterId: afterId ?? '' }];
		if (Array.isArray(f.order)) {
			const idx = f.order.indexOf(afterId);
			if (idx === -1) f.order = [...f.order, item.id];
			else f.order = [...f.order.slice(0, idx + 1), item.id, ...f.order.slice(idx + 1)];
		}
		return f;
	}

	function forkReorder(fork, orderedIds) {
		const f = clone(fork) || emptyFork();
		f.order = [...orderedIds];
		return f;
	}

	function applyDomain(url, domain) {
		if (!url || !domain) return url;
		return url.split('{domain}').join(domain);
	}

	function resolveContextualMenuId(catalog, siteMenus, url, matchesPatterns) {
		if (!url || typeof matchesPatterns !== 'function') return null;
		for (const m of listActiveMenus(catalog, siteMenus)) {
			const pats = m.def.patterns || [];
			if (pats.length && matchesPatterns(url, pats)) return m.id;
		}
		return null;
	}

	function resolveMenu(catalog, siteMenus, cfg, ctx) {
		const c = cfg || {};
		const mode = c.mode || 'standard';
		if (mode === 'own') {
			const m = c.ownMenu;
			if (!m) return null;
			return { menuId: '', name: m.name || '', items: (m.items || []).map(clone), domain: '' };
		}
		let menuId = c.menuId;
		if (mode === 'contextual') {
			menuId = resolveContextualMenuId(catalog, siteMenus, ctx && ctx.url, ctx && ctx.matchesPatterns)
				|| c.fallbackMenuId || '';
		}
		const base = getBaseMenu(catalog, siteMenus, menuId);
		if (!base) return null;
		let items = (base.items || []).map(clone);
		let name = base.name || '';
		if (mode === 'fork') {
			items = resolveFork(items, c.fork);
			if (c.fork && c.fork.name) name = c.fork.name;
		}
		const domain = ((siteMenus || {}).domains || {})[base.id]
			|| (base.domains && base.domains.default) || '';
		if (domain) {
			items = items.map(it => it.customUrl ? { ...it, customUrl: applyDomain(it.customUrl, domain) } : it);
		}
		return { menuId: base.id, name, items, domain };
	}

	function isCatalogId(catalog, menuId) {
		return (catalog || []).some(m => m.id === menuId);
	}

	function withMenuDef(catalog, siteMenus, menuId, def) {
		const sm = clone(siteMenus) || {};
		const d = clone(def);
		delete d.id;
		if (isCatalogId(catalog, menuId)) sm.edited = { ...(sm.edited || {}), [menuId]: d };
		else sm.custom = { ...(sm.custom || {}), [menuId]: d };
		return sm;
	}

	function withMenuReset(siteMenus, menuId) {
		const sm = clone(siteMenus) || {};
		if (sm.edited) delete sm.edited[menuId];
		return sm;
	}

	function withMenuDisabled(siteMenus, menuId, disabled) {
		const sm = clone(siteMenus) || {};
		const set = new Set(sm.disabled || []);
		if (disabled) set.add(menuId); else set.delete(menuId);
		sm.disabled = [...set];
		return sm;
	}

	function withoutCustomMenu(siteMenus, menuId) {
		const sm = clone(siteMenus) || {};
		if (sm.custom) delete sm.custom[menuId];
		if (sm.edited) delete sm.edited[menuId];
		sm.disabled = (sm.disabled || []).filter(id => id !== menuId);
		sm.order = (sm.order || []).filter(id => id !== menuId);
		return sm;
	}

	function withDomain(siteMenus, menuId, domain) {
		const sm = clone(siteMenus) || {};
		sm.domains = { ...(sm.domains || {}), [menuId]: domain };
		return sm;
	}

	function addPatternToMenu(catalog, siteMenus, menuId, pattern) {
		if (!pattern) return { siteMenus, added: null };
		const base = getBaseMenu(catalog, siteMenus, menuId);
		if (!base) return { siteMenus, added: null };
		const cur = base.patterns || [];
		if (cur.includes(pattern)) return { siteMenus, added: null };
		const def = { ...base, patterns: [...cur, pattern] };
		return { siteMenus: withMenuDef(catalog, siteMenus, menuId, def), added: pattern };
	}

	const api = {
		getBaseMenu, listMenus, listActiveMenus,
		emptyFork, resolveFork,
		forkOverrideItem, forkDeleteItem, forkRestoreItem, forkAddItem, forkReorder,
		resolveMenu, resolveContextualMenuId, applyDomain,
		withMenuDef, withMenuReset, withMenuDisabled, withoutCustomMenu, withDomain,
		addPatternToMenu,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseMenuModel = api;
})(typeof self !== 'undefined' ? self : globalThis);
