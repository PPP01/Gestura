(function (root) {
	// Pure-Funktionen für das Gestura-Austauschformat (Menüs & Engines).
	// Keine chrome.*-APIs, keine i18n, keine DOM-Nutzung — überall (Node-Tests,
	// Options-UI) identisch nutzbar. Eingaben werden nie verändert.

	const CURRENT_FORMAT_VERSION = 1;
	const FORMAT_TYPES = { menu: 'gesturaMenu', engine: 'gesturaEngine', bundle: 'gesturaBundle' };

	// Whitelist der Aktionen, die in importierten Menüeinträgen erlaubt sind.
	// Bewusst konservativ: nur Links, Suche, Scrollen, einfache Navigation.
	// MUSS mit den echten Aktions-IDs aus js/constants.js (ACTION_KEYS)
	// übereinstimmen; niemals skriptfähige Aktionen aufnehmen
	// (sendExtensionMessage, sendCustomEvent, simulateKey, actionChain,
	// customMenu, siteMenu, addSiteToMenu).
	const ALLOWED_MENU_ITEM_ACTIONS = [
		'none', 'openCustomUrl', 'searchLink',
		'back', 'forward', 'refresh', 'newTab',
		'scrollUp', 'scrollDown', 'scrollToTop', 'scrollToBottom',
	];

	const LIMITS = {
		idMax: 128, nameMax: 200, descMax: 2000, iconMax: 64,
		urlMax: 2000, patternMax: 200, patternsMax: 50,
		itemsMax: 100, blobMax: 100 * 1024, transformCodeMax: 10 * 1024,
		// Bundle-Wrapper: Deckel für das Gesamtpaket auf dem Übergabeweg. Die
		// Per-Eintrag-Kappe bleibt blobMax. bundleEntriesMax ist deckungsgleich
		// mit dem 200-ID-Cap des Index-Backends (BundleController::MAX_IDS).
		bundleEntriesMax: 200, bundleBlobMax: 1024 * 1024,
	};

	const SEMVER_RE = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
	const ID_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

	function detectType(obj) {
		if (!obj || typeof obj !== 'object') return null;
		if (typeof obj[FORMAT_TYPES.menu] === 'number') return 'menu';
		if (typeof obj[FORMAT_TYPES.engine] === 'number') return 'engine';
		if (typeof obj[FORMAT_TYPES.bundle] === 'number') return 'bundle';
		return null;
	}

	function isHttpsUrl(str) {
		if (typeof str !== 'string' || !str) return false;
		let u;
		try { u = new URL(str); } catch { return false; }
		return u.protocol === 'https:';
	}

	function pickLabel(field, lang, fallbackLang) {
		const fb = fallbackLang || 'en';
		if (field == null) return '';
		if (typeof field === 'string') return field;
		if (typeof field === 'object') {
			return field[lang] || field[fb] || field[Object.keys(field)[0]] || '';
		}
		return '';
	}

	function isLabelField(v, maxLen) {
		if (v == null) return true; // optional
		if (typeof v === 'string') return v.length <= maxLen;
		if (typeof v === 'object' && !Array.isArray(v)) {
			return Object.values(v).every(s => typeof s === 'string' && s.length <= maxLen);
		}
		return false;
	}

	function byteLength(obj) {
		try { return new TextEncoder().encode(JSON.stringify(obj)).length; } catch { return Infinity; }
	}

	// Alle engineId-Verweise eines Menüs, dedupliziert und in der Reihenfolge der
	// ersten Nennung. Rein: ob eine ID auflösbar ist, weiß nur der Aufrufer mit
	// Katalog und Nutzer-Engines — hier steht nur, worauf das Menü zeigt. Ein
	// searchLink mit eigener url trägt keine Abhängigkeit und zählt nicht mit.
	function menuEngineIds(menuValue) {
		const out = [];
		const items = menuValue && menuValue.items;
		if (!Array.isArray(items)) return out;
		for (const it of items) {
			if (!it || it.action !== 'searchLink') continue;
			const id = it.engineId;
			if (typeof id !== 'string' || !id || out.includes(id)) continue;
			out.push(id);
		}
		return out;
	}

	function hasTransform(engine) {
		return !!(engine && engine.transformEnabled
			&& typeof engine.transformCode === 'string' && engine.transformCode.trim().length > 0);
	}

	function validateEngine(obj, errors) {
		if (obj[FORMAT_TYPES.engine] !== CURRENT_FORMAT_VERSION) errors.push('unsupportedFormatVersion');
		if (typeof obj.id !== 'string' || !ID_RE.test(obj.id) || obj.id.length > LIMITS.idMax) errors.push('id');
		if (typeof obj.version !== 'string' || !SEMVER_RE.test(obj.version)) errors.push('version');
		if (obj.name == null || !isLabelField(obj.name, LIMITS.nameMax)) errors.push('name');
		if (!isHttpsUrl(obj.url) || obj.url.length > LIMITS.urlMax) errors.push('url');
		if (obj.icon != null && (typeof obj.icon !== 'string' || obj.icon.length > LIMITS.iconMax)) errors.push('icon');
		if (obj.type != null && obj.type !== 'text' && obj.type !== 'image') errors.push('type');
		for (const b of ['plus', 'slug', 'clipboardMode', 'rawResult', 'transformEnabled', 'transformClipboard', 'transformRawResult', 'transformRequired']) {
			if (obj[b] != null && typeof obj[b] !== 'boolean') errors.push(b);
		}
		if (obj.suffix != null && (typeof obj.suffix !== 'string' || obj.suffix.length > LIMITS.nameMax)) errors.push('suffix');
		if (obj.transformCode != null) {
			if (typeof obj.transformCode !== 'string' || obj.transformCode.length > LIMITS.transformCodeMax) errors.push('transformCode');
		}
	}

	function validateMenu(obj, errors) {
		if (obj[FORMAT_TYPES.menu] !== CURRENT_FORMAT_VERSION) errors.push('unsupportedFormatVersion');
		if (typeof obj.id !== 'string' || !ID_RE.test(obj.id) || obj.id.length > LIMITS.idMax) errors.push('id');
		if (typeof obj.version !== 'string' || !SEMVER_RE.test(obj.version)) errors.push('version');
		if (obj.name == null || !isLabelField(obj.name, LIMITS.nameMax)) errors.push('name');
		if (!isLabelField(obj.description, LIMITS.descMax)) errors.push('description');
		if (obj.icon != null && (typeof obj.icon !== 'string' || obj.icon.length > LIMITS.iconMax)) errors.push('icon');
		if (obj.homepage != null && (!isHttpsUrl(obj.homepage) || obj.homepage.length > LIMITS.urlMax)) errors.push('homepage');
		if (obj.patterns != null) {
			if (!Array.isArray(obj.patterns) || obj.patterns.length > LIMITS.patternsMax
				|| !obj.patterns.every(p => typeof p === 'string' && p.length <= LIMITS.patternMax)) errors.push('patterns');
		}
		if (!Array.isArray(obj.items) || obj.items.length < 1 || obj.items.length > LIMITS.itemsMax) {
			errors.push('items');
		} else {
			const seen = new Set();
			for (const it of obj.items) {
				if (!it || typeof it !== 'object' || typeof it.id !== 'string' || it.id.length > LIMITS.idMax || !ID_RE.test(it.id)) { errors.push('itemId'); continue; }
				if (seen.has(it.id)) { errors.push('duplicateItemId'); continue; }
				seen.add(it.id);
				if (it.type === 'separator') continue;
				if (!ALLOWED_MENU_ITEM_ACTIONS.includes(it.action)) { errors.push('itemAction'); continue; }
				if (!isLabelField(it.label, LIMITS.nameMax)) errors.push('itemLabel');
				if (it.icon != null && (typeof it.icon !== 'string' || it.icon.length > LIMITS.iconMax)) errors.push('itemIcon');
				if (it.action === 'openCustomUrl') {
					if (!isHttpsUrl(it.customUrl) || it.customUrl.length > LIMITS.urlMax) errors.push('itemUrl');
				}
				if (it.action === 'searchLink') {
					const hasEngine = typeof it.engineId === 'string' && it.engineId.length > 0;
					const hasUrl = isHttpsUrl(it.url) && it.url.length <= LIMITS.urlMax;
					if (!hasEngine && !hasUrl) errors.push('itemSearch');
				}
			}
		}
	}

	function validate(obj) {
		const type = detectType(obj);
		const errors = [];
		if (!type) return { ok: false, type: null, errors: ['notGesturaFormat'], value: null };
		// Bundles gehören zu validateBundle(). Ohne diese Zeile liefe ein Bundle
		// durch validate(), ohne dass validateMenu/validateEngine je greifen —
		// und käme mit leerer Fehlerliste als ok:true heraus.
		if (type === 'bundle') return { ok: false, type: 'bundle', errors: ['notSingleFormat'], value: null };
		if (byteLength(obj) > LIMITS.blobMax) errors.push('tooLarge');
		if (type === 'menu') validateMenu(obj, errors);
		if (type === 'engine') validateEngine(obj, errors);
		const ok = errors.length === 0;
		return { ok, type, errors, value: ok ? JSON.parse(JSON.stringify(obj)) : null };
	}

	// Prüft den Bundle-Wrapper und danach jeden Eintrag einzeln durch validate().
	// Bricht bewusst nicht beim ersten kaputten Eintrag ab: die Sammel-Vorschau
	// zeigt Teil-Ergebnisse, damit ein Fehler die übrigen nicht blockiert.
	// `ok` beschreibt ausschließlich den Wrapper; ob ein Eintrag brauchbar ist,
	// steht in entries[i].ok.
	function validateBundle(obj) {
		const fail = (err) => ({ ok: false, type: 'bundle', errors: [err], entries: [] });
		if (detectType(obj) !== 'bundle') return fail('notGesturaFormat');
		if (obj[FORMAT_TYPES.bundle] !== CURRENT_FORMAT_VERSION) return fail('unsupportedFormatVersion');
		if (byteLength(obj) > LIMITS.bundleBlobMax) return fail('tooLarge');
		const list = obj.entries;
		if (!Array.isArray(list) || list.length < 1) return fail('entries');
		if (list.length > LIMITS.bundleEntriesMax) return fail('tooManyEntries');
		return { ok: true, type: 'bundle', errors: [], entries: list.map((e) => validate(e)) };
	}

	function newId(prefix) {
		const uuid = (root.crypto && root.crypto.randomUUID)
			? root.crypto.randomUUID().replace(/-/g, '')
			: Math.random().toString(16).slice(2);
		return `${prefix}_${uuid.slice(0, 12)}`;
	}

	// Map one format item to a runtime menu item. idFn(it) decides the item id
	// (fresh for a new custom menu, or the file's own id when replacing a
	// standard menu). Labels collapse to the runtime `customName` string.
	function mapImportItem(it, idFn, lg) {
		if (it.type === 'separator') return { id: idFn(it), type: 'separator' };
		const out = { id: idFn(it), action: it.action };
		const nm = pickLabel(it.label, lg); if (nm) out.customName = nm;
		if (it.icon != null) out.icon = it.icon;
		if (it.action === 'openCustomUrl') out.customUrl = it.customUrl;
		if (it.action === 'searchLink') {
			if (it.engineId) out.engineId = it.engineId;
			if (it.url) out.url = it.url;
		}
		return out;
	}

	function toCustomMenu(menuValue, source, genId, lang) {
		const lg = lang || 'en';
		const g = genId || newId;
		const menuId = g('menu');   // generate the menu id before item ids (stable order)
		const items = (menuValue.items || []).map(it => mapImportItem(it, () => g('item'), lg));
		const def = {
			name: pickLabel(menuValue.name, lg),
			icon: menuValue.icon || 'menu',
			patterns: Array.isArray(menuValue.patterns) ? menuValue.patterns.slice() : [],
			items,
			source: source ? JSON.parse(JSON.stringify(source)) : null,
		};
		return { id: menuId, def };
	}

	// Build the "edited copy" def used to REPLACE a standard (catalog) menu.
	// Keeps the file's own item ids so the result aligns with the catalog entry
	// it overrides (stored at siteMenus.edited[catalogId]).
	function toStandardMenu(menuValue, lang) {
		const lg = lang || 'en';
		const items = (menuValue.items || []).map(it => mapImportItem(it, (x) => x.id, lg));
		return {
			name: pickLabel(menuValue.name, lg),
			icon: menuValue.icon || 'menu',
			patterns: Array.isArray(menuValue.patterns) ? menuValue.patterns.slice() : [],
			items,
		};
	}

	function toCustomEngine(engineValue, source, genId, lang) {
		const g = genId || newId;
		return {
			id: g('eng'),
			name: pickLabel(engineValue.name, lang || 'en'),
			url: engineValue.url || '',
			plus: !!engineValue.plus,
			slug: !!engineValue.slug,
			suffix: engineValue.suffix || '',
			clipboardMode: !!engineValue.clipboardMode,
			transformEnabled: !!engineValue.transformEnabled,
			transformCode: engineValue.transformCode || '',
			transformClipboard: !!engineValue.transformClipboard,
			transformRawResult: !!engineValue.transformRawResult,
			rawResult: !!engineValue.rawResult,
			builtin: false,
			type: engineValue.type === 'image' ? 'image' : 'text',
			source: source ? JSON.parse(JSON.stringify(source)) : null,
		};
	}

	// Build an override object used to REPLACE a standard (built-in) engine.
	// Full field set, no id/builtin/source — the engine registry merges this
	// over the built-in (stored at searchEngines.overrides[builtinId]).
	function toEngineOverride(engineValue, lang) {
		return {
			name: pickLabel(engineValue.name, lang || 'en'),
			url: engineValue.url || '',
			plus: !!engineValue.plus,
			slug: !!engineValue.slug,
			suffix: engineValue.suffix || '',
			clipboardMode: !!engineValue.clipboardMode,
			transformEnabled: !!engineValue.transformEnabled,
			transformCode: engineValue.transformCode || '',
			transformClipboard: !!engineValue.transformClipboard,
			transformRawResult: !!engineValue.transformRawResult,
			rawResult: !!engineValue.rawResult,
			type: engineValue.type === 'image' ? 'image' : 'text',
		};
	}

	function menuToExchange(menuDef, meta) {
		const m = meta || {};
		const items = (menuDef.items || []).map(it => {
			if (it.type === 'separator') return { id: it.id, type: 'separator' };
			const out = { id: it.id, action: it.action };
			if (it.customName) out.label = it.customName;
			if (it.icon != null) out.icon = it.icon;
			if (it.action === 'openCustomUrl') out.customUrl = it.customUrl;
			if (it.action === 'searchLink') {
				if (it.engineId) out.engineId = it.engineId;
				if (it.url) out.url = it.url;
			}
			return out;
		});
		const out = {
			gesturaMenu: CURRENT_FORMAT_VERSION,
			id: m.id || '',
			version: m.version || '1.0.0',
			name: typeof menuDef.name === 'string' ? (menuDef.name || '') : (pickLabel(menuDef.name, 'en') || ''),
			items,
		};
		if (menuDef.icon) out.icon = menuDef.icon;
		if (Array.isArray(menuDef.patterns) && menuDef.patterns.length) out.patterns = menuDef.patterns.slice();
		if (m.description != null) out.description = JSON.parse(JSON.stringify(m.description));
		return out;
	}

	function engineToExchange(engine, meta) {
		const m = meta || {};
		const out = {
			gesturaEngine: CURRENT_FORMAT_VERSION,
			id: m.id || '',
			version: m.version || '1.0.0',
			name: typeof engine.name === 'string' ? { en: engine.name } : JSON.parse(JSON.stringify(engine.name || { en: '' })),
			url: engine.url || '',
			type: engine.type === 'image' ? 'image' : 'text',
		};
		for (const b of ['plus', 'slug', 'clipboardMode', 'rawResult']) if (engine[b]) out[b] = true;
		if (engine.suffix) out.suffix = engine.suffix;
		if (hasTransform(engine)) {
			out.transformEnabled = true;
			out.transformCode = engine.transformCode;
			if (engine.transformClipboard) out.transformClipboard = true;
			if (engine.transformRawResult) out.transformRawResult = true;
			if (engine.transformRequired) out.transformRequired = true;
		}
		if (m.description != null) out.description = JSON.parse(JSON.stringify(m.description));
		return out;
	}

	const api = {
		CURRENT_FORMAT_VERSION, FORMAT_TYPES, ALLOWED_MENU_ITEM_ACTIONS, LIMITS,
		detectType, isHttpsUrl, pickLabel, validate, validateBundle, hasTransform, menuEngineIds,
		newId, toCustomMenu, toCustomEngine, toStandardMenu, toEngineOverride,
		menuToExchange, engineToExchange,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseMenuExchange = api;
})(typeof self !== 'undefined' ? self : globalThis);
