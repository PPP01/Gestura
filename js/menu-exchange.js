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
	function mapImportItem(it, idFn, lg, engineIdMap) {
		if (it.type === 'separator') return { id: idFn(it), type: 'separator' };
		const out = { id: idFn(it), action: it.action };
		const nm = pickLabel(it.label, lg); if (nm) out.customName = nm;
		if (it.icon != null) out.icon = it.icon;
		if (it.action === 'openCustomUrl') out.customUrl = it.customUrl;
		if (it.action === 'searchLink') {
			// Eine mitimportierte Engine wird unter einer anderen ID gespeichert als
			// der, die im Austauschformat steht. engineIdMap biegt den Verweis darauf
			// um - ohne das zeigt das Menü nach dem Import ins Leere und der Eintrag
			// verschwindet stillschweigend aus dem fertigen Menü.
			if (it.engineId) out.engineId = (engineIdMap && engineIdMap[it.engineId]) || it.engineId;
			if (it.url) out.url = it.url;
		}
		return out;
	}

	// Der gespeicherte Herkunftsnachweis, ergänzt um die ID, unter der die Datei den
	// Eintrag führt (com.perplexity.ask). Ohne sie lässt sich ein zweiter Import
	// desselben Eintrags nicht als derselbe erkennen - er landet als weitere Kopie
	// daneben. Und ein Re-Export trüge die lokale ID (eng_a1b2c3) nach draußen, wo
	// sie beim Index einen neuen fremden Eintrag erzeugt statt das Original zu
	// aktualisieren. site-menu-manager.js und engine-manager.js lesen das Feld beim
	// Export längst.
	function storedSource(source, formatId) {
		const out = source ? JSON.parse(JSON.stringify(source)) : {};
		if (formatId) out.indexId = formatId;
		return Object.keys(out).length ? out : null;
	}

	function toCustomMenu(menuValue, source, genId, lang, engineIdMap) {
		const lg = lang || 'en';
		const g = genId || newId;
		const menuId = g('menu');   // generate the menu id before item ids (stable order)
		const items = (menuValue.items || []).map(it => mapImportItem(it, () => g('item'), lg, engineIdMap));
		const def = {
			name: pickLabel(menuValue.name, lg),
			icon: menuValue.icon || 'menu',
			patterns: Array.isArray(menuValue.patterns) ? menuValue.patterns.slice() : [],
			items,
			source: storedSource(source, menuValue.id),
		};
		return { id: menuId, def };
	}

	// Build the "edited copy" def used to REPLACE a standard (catalog) menu.
	// Keeps the file's own item ids so the result aligns with the catalog entry
	// it overrides (stored at siteMenus.edited[catalogId]).
	function toStandardMenu(menuValue, lang, engineIdMap, source) {
		const lg = lang || 'en';
		const items = (menuValue.items || []).map(it => mapImportItem(it, (x) => x.id, lg, engineIdMap));
		const def = {
			name: pickLabel(menuValue.name, lg),
			icon: menuValue.icon || 'menu',
			patterns: Array.isArray(menuValue.patterns) ? menuValue.patterns.slice() : [],
			items,
		};
		// Provenance for a replaced catalog menu — without it, status and update
		// lookups could not see this legitimate import mode at all. Only computed
		// when a source was actually supplied — storedSource() would otherwise
		// still produce {indexId} from menuValue.id alone.
		const src = source ? storedSource(source, menuValue.id) : null;
		if (src) def.source = src;
		return def;
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
			source: storedSource(source, engineValue.id),
		};
	}

	// Build an override object used to REPLACE a standard (built-in) engine.
	// Full field set, no id/builtin — the engine registry merges this over the
	// built-in (stored at searchEngines.overrides[builtinId]). source is kept
	// when the import supplies one.
	function toEngineOverride(engineValue, lang, source) {
		const out = {
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
		const src = source ? storedSource(source, engineValue.id) : null;
		if (src) out.source = src;
		return out;
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

	// --- Zusammenführung eines geprüften Imports mit dem, was schon da ist -------
	// Lag bis zuletzt in <menu-import-dialog> und war damit ungetestet. Genau hier
	// entstanden nacheinander zwei stille Fehler: ein Menü behielt die Engine-ID
	// aus der Datei statt der neu vergebenen, und ein neues Menü landete über dem
	// ganzen Katalog. Beides fällt jetzt in tests/menu-exchange-apply.test.mjs auf.

	function applyMenuTo(cur, value, source, lang, mode, matchId, engineIdMap) {
		if (mode === 'replace' && matchId) {
			// Woran der Verweis hängt, entscheidet, wohin geschrieben wird. Ein eigenes
			// Menü wird an Ort und Stelle überschrieben; für ein Katalog-Menü entsteht
			// eine bearbeitete Fassung. Ohne diese Unterscheidung legte der zweite
			// Import desselben Index-Menüs die "bearbeitete Fassung" eines Katalog-
			// Menüs an, das es gar nicht gibt - und das eigene bliebe unberührt daneben.
			if (cur.custom && cur.custom[matchId]) {
				const { def } = toCustomMenu(value, source, undefined, lang, engineIdMap);
				return { next: { ...cur, custom: { ...cur.custom, [matchId]: def } }, id: matchId, isNew: false };
			}
			const def = toStandardMenu(value, lang, engineIdMap, source);
			return { next: { ...cur, edited: { ...cur.edited, [matchId]: def } }, id: matchId, isNew: false };
		}
		const { id, def } = toCustomMenu(value, source, undefined, lang, engineIdMap);
		// siteMenus.order bleibt bewusst unangetastet: listMenus() liest order ZUERST
		// und danach erst den Katalog, ein Eintrag dort bedeutet also "ganz nach oben".
		// Ohne order hängt listMenus() das Menü hinter Katalog und bestehende eigene
		// Menüs - also dorthin, wo ein neuer Eintrag hingehört. Spart nebenbei Bytes.
		return { next: { ...cur, custom: { ...cur.custom, [id]: def } }, id, isNew: true };
	}

	// Wie applyMenuTo, für searchEngines. stripTransform kommt vom Aufrufer statt aus
	// einer Browserweiche hier: in Firefox laufen Transform-Skripte nicht, also wird
	// das Skript beim Import entfernt - außer die Engine besteht darauf.
	function applyEngineTo(cur, value, source, lang, mode, matchId, stripTransform) {
		const strip = (e) => {
			if (stripTransform && !value.transformRequired) { e.transformEnabled = false; e.transformCode = ''; }
			return e;
		};
		if (mode === 'replace' && matchId) {
			// Wie bei den Menüs: eine eigene Suchmaschine wird ersetzt, eine aus dem
			// Katalog überschrieben. Der Platz in der Liste bleibt - ein Update soll
			// den Eintrag nicht ans Ende springen lassen.
			const list = cur.custom || [];
			const at = list.findIndex(e => e && e.id === matchId);
			if (at !== -1) {
				const engine = strip(toCustomEngine(value, source, () => matchId, lang));
				const next = list.slice();
				next[at] = engine;
				return { next: { ...cur, custom: next }, id: matchId, isNew: false };
			}
			const ov = strip(toEngineOverride(value, lang, source));
			return { next: { ...cur, overrides: { ...cur.overrides, [matchId]: ov } }, id: matchId, isNew: false };
		}
		const engine = strip(toCustomEngine(value, source, undefined, lang));
		return { next: { ...cur, custom: [...(cur.custom || []), engine] }, id: engine.id, isNew: true };
	}

	// Baut den Patch, den ein Import der übergebenen Zeilen schreiben würde. Rein -
	// schreibt nichts. Einzel- und Sammel-Import gehen beide hierdurch, damit sie
	// garantiert dasselbe schreiben; die Vorschau nutzt denselben Weg, damit die
	// angezeigte Belegung und die tatsächliche nie auseinanderlaufen.
	//
	// rows: [{ type, value, source, mode, matchId }]
	// liefert { patch, imported: [{ kind, id, isNew }] }
	function buildImportPatch(rows, current, opts) {
		const lang = (opts && opts.lang) || 'en';
		const stripTransform = !!(opts && opts.stripTransform);
		let siteMenus = (current && current.siteMenus) || null;
		let engines = (current && current.searchEngines) || null;
		let touchedMenus = false;
		let touchedEngines = false;
		const imported = [];

		// Engines zuerst, und zwar in einem eigenen Durchgang: toCustomEngine vergibt
		// eine neue ID, die von der in der Datei abweicht. Erst wenn alle gespeicherten
		// IDs feststehen, lassen sich die Menü-Verweise darauf umbiegen - sonst zeigt
		// ein mitimportiertes Menü ins Leere und sein Eintrag verschwindet still.
		const engineIdMap = {};
		for (const row of rows) {
			if (row.type !== 'engine') continue;
			const applied = applyEngineTo(engines, row.value, row.source, lang, row.mode, row.matchId, stripTransform);
			engines = applied.next;
			engineIdMap[row.value.id] = applied.id;
			touchedEngines = true;
			imported.push({ kind: 'engine', id: applied.id, isNew: applied.isNew });
		}
		for (const row of rows) {
			if (row.type !== 'menu') continue;
			const applied = applyMenuTo(siteMenus, row.value, row.source, lang, row.mode, row.matchId, engineIdMap);
			siteMenus = applied.next;
			touchedMenus = true;
			imported.push({ kind: 'menu', id: applied.id, isNew: applied.isNew });
		}
		const patch = {};
		if (touchedMenus) patch.siteMenus = siteMenus;
		if (touchedEngines) patch.searchEngines = engines;
		return { patch, imported };
	}

	const api = {
		CURRENT_FORMAT_VERSION, FORMAT_TYPES, ALLOWED_MENU_ITEM_ACTIONS, LIMITS,
		detectType, isHttpsUrl, pickLabel, validate, validateBundle, hasTransform, menuEngineIds,
		newId, toCustomMenu, toCustomEngine, toStandardMenu, toEngineOverride,
		menuToExchange, engineToExchange,
		applyMenuTo, applyEngineTo, buildImportPatch,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseMenuExchange = api;
})(typeof self !== 'undefined' ? self : globalThis);
