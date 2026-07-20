(function (root) {
	// Pure-Funktionen für das Gestura-Austauschformat (Menüs & Engines).
	// Keine chrome.*-APIs, keine i18n, keine DOM-Nutzung — überall (Node-Tests,
	// Options-UI) identisch nutzbar. Eingaben werden nie verändert.

	const CURRENT_FORMAT_VERSION = 1;
	const FORMAT_TYPES = { menu: 'gesturaMenu', engine: 'gesturaEngine' };

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
	};

	const SEMVER_RE = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
	const ID_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

	function detectType(obj) {
		if (!obj || typeof obj !== 'object') return null;
		if (typeof obj[FORMAT_TYPES.menu] === 'number') return 'menu';
		if (typeof obj[FORMAT_TYPES.engine] === 'number') return 'engine';
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
		if (byteLength(obj) > LIMITS.blobMax) errors.push('tooLarge');
		if (type === 'menu') validateMenu(obj, errors);
		if (type === 'engine') validateEngine(obj, errors);
		const ok = errors.length === 0;
		return { ok, type, errors, value: ok ? JSON.parse(JSON.stringify(obj)) : null };
	}

	function newId(prefix) {
		const uuid = (root.crypto && root.crypto.randomUUID)
			? root.crypto.randomUUID().replace(/-/g, '')
			: Math.random().toString(16).slice(2);
		return `${prefix}_${uuid.slice(0, 12)}`;
	}

	function toCustomMenu(menuValue, source, genId) {
		const g = genId || newId;
		const menuId = g('menu');
		const items = (menuValue.items || []).map(it => {
			if (it.type === 'separator') return { id: g('item'), type: 'separator' };
			const out = { id: g('item'), action: it.action };
			if (it.label != null) out.label = JSON.parse(JSON.stringify(it.label));
			if (it.icon != null) out.icon = it.icon;
			if (it.action === 'openCustomUrl') out.customUrl = it.customUrl;
			if (it.action === 'searchLink') {
				if (it.engineId) out.engineId = it.engineId;
				if (it.url) out.url = it.url;
			}
			return out;
		});
		const def = {
			name: JSON.parse(JSON.stringify(menuValue.name)),
			icon: menuValue.icon || 'menu',
			patterns: Array.isArray(menuValue.patterns) ? menuValue.patterns.slice() : [],
			items,
			source: source ? JSON.parse(JSON.stringify(source)) : null,
		};
		return { id: menuId, def };
	}

	function toCustomEngine(engineValue, source, genId) {
		const g = genId || newId;
		return {
			id: g('eng'),
			name: JSON.parse(JSON.stringify(engineValue.name)),
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

	const api = {
		CURRENT_FORMAT_VERSION, FORMAT_TYPES, ALLOWED_MENU_ITEM_ACTIONS, LIMITS,
		detectType, isHttpsUrl, pickLabel, validate, hasTransform,
		newId, toCustomMenu, toCustomEngine,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseMenuExchange = api;
})(typeof self !== 'undefined' ? self : globalThis);
