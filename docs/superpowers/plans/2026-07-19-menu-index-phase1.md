# Gestura-Index Phase 1 — Austauschformat & Import/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nutzer und Website-Betreiber können Gestura-Menüs und -Engines als portables JSON-Format exportieren, per Datei/URL/Betreiber-Button importieren und vor dem Import in einer Vorschau prüfen — alles rein in der Extension, ohne Backend.

**Architecture:** Die gesamte Format-Logik (Validierung, Normalisierung, Import-Mapping, Export) lebt in einer neuen framework-freien Pure-Function-Datei `js/menu-exchange.js` (IIFE + `module.exports` + `window.FlowMouseMenuExchange`), exakt im Muster von [js/menu-model.js](../../../js/menu-model.js) und [js/engine-registry.js](../../../js/engine-registry.js). Sie wird von Node-Tests (vitest) und von der UI gemeinsam genutzt. Die UI ist eine Lit-Komponente `<menu-import-dialog>` plus Export-Buttons in den bestehenden Manager-Komponenten. Der Betreiber-Button wird im Content-Script erkannt, dort nur same-origin geprüft und geladen; validiert und angezeigt wird in der vertrauenswürdigen Options-Seite.

**Tech Stack:** Plain JS (ES2020), Lit (vendored), vitest. **Kein Build-Schritt, kein neues npm-Paket.** Chrome/Edge/Firefox MV3.

## Global Constraints

- **Kein Build-Schritt, kein Bundler, kein neues Dependency.** Repo-Ordner = entpackte Extension. (CLAUDE.md)
- **Einrückung: Tabs**, nicht Spaces. (CLAUDE.md)
- **Pure-Funktionen** = klassisches Skript, Form `(function (root) { … const api = {…}; if (typeof module !== 'undefined' && module.exports) module.exports = api; root.FlowMouseXxx = api; })(typeof self !== 'undefined' ? self : globalThis);`. Keine `chrome.*`-APIs, keine `import`, keine i18n darin. (Muster: menu-model.js)
- **Lit-Komponenten** = ES-Module unter `js/components/`, `import { LitElement, html, css } from '../lib/lit-all.min.js';`. i18n über `window.i18n.getMessage('key')`. (Muster: site-menu-manager.js)
- **Sicherheit:** importierte URLs nur `https:` (kein `javascript:`/`data:`/`file:`); Aktions-Whitelist; Größen-/Anzahllimits. Der Client rendert **nie** ungeprüftes Format-JSON.
- **Format-Typen:** `gesturaMenu: 1` und `gesturaEngine: 1`. `CURRENT_FORMAT_VERSION = 1`.
- **Sprachen:** Neue Extension-UI-Strings kommen als i18n-Keys in **alle** `_locales/*` (en/de ausformuliert, restliche Locales aus `en` geseedet). `en` ist `default_locale`-Fallback.
- **Neue Pure-Datei wird NICHT ins Content-Script geladen** (der Betreiber-Button validiert nicht im Content-Script) → `manifest.json` `content_scripts` bleibt unverändert; nur die Options-Seite lädt `menu-exchange.js`.

---

## File Structure

**Neu:**
- `js/menu-exchange.js` — Pure-Funktionen: Validierung, Import-Mapping, Export. `window.FlowMouseMenuExchange`.
- `js/exchange-schema.json` — JSON-Schema des Formats (Vertragsdatei; Laufzeit nutzt den handgeschriebenen Validator, das Schema geht später ins Backend).
- `js/components/menu-import-dialog.js` — Lit-Komponente: Import-Vorschau + Bestätigung (inkl. Transform-Warnung/Chrome-only).
- `tests/menu-exchange.test.mjs` — Unit-Tests der Pure-Funktionen.
- `tests/exchange-schema.test.mjs` — Schema-Datei valide + typkonsistent.
- `tests/menu-exchange-locales.test.mjs` — Locale-Vollständigkeit der neuen Keys.

**Geändert:**
- `_locales/*/messages.json` (~40 Dateien) — neue UI-Keys.
- `js/components/site-menu-manager.js` — Export-Button je Menü + „Menü importieren"-Bereich.
- `js/components/engine-manager.js` — Export-Button je Engine + „Engine importieren"-Bereich.
- `pages/options.html` — `<script src="../js/menu-exchange.js">` + `<script type="module" src="../js/components/menu-import-dialog.js">`.
- `js/content.js` — Erkennung von `a[rel~="gestura-menu"]`-Klicks (same-origin).
- `js/background.js` — Handler `importFromSite`: fetch + Options-Seite öffnen, Payload in `chrome.storage.session`.
- `js/components/options-page.js` — beim Laden ausstehenden Import aus `chrome.storage.session` aufgreifen und Dialog öffnen.

---

## Task 1: `menu-exchange.js` — Validierung `gesturaMenu`

**Files:**
- Create: `js/menu-exchange.js`
- Test: `tests/menu-exchange.test.mjs`

**Interfaces:**
- Produces:
  - `CURRENT_FORMAT_VERSION` (number = 1)
  - `FORMAT_TYPES` (`{ menu: 'gesturaMenu', engine: 'gesturaEngine' }`)
  - `ALLOWED_MENU_ITEM_ACTIONS` (string[])
  - `LIMITS` (`{ idMax, nameMax, descMax, iconMax, urlMax, patternMax, patternsMax, itemsMax, blobMax }`)
  - `detectType(obj)` → `'menu' | 'engine' | null`
  - `isHttpsUrl(str)` → boolean
  - `pickLabel(field, lang, fallbackLang='en')` → string
  - `validate(obj)` → `{ ok: boolean, type: 'menu'|'engine'|null, errors: string[], value: object|null }` (in dieser Task nur `menu` implementiert; `engine` folgt in Task 2)

- [ ] **Step 1: Write the failing test**

Create `tests/menu-exchange.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import '../js/menu-exchange.js';
const X = globalThis.FlowMouseMenuExchange;

const validMenu = () => ({
	gesturaMenu: 1,
	id: 'com.example.shop',
	version: '1.0.0',
	name: { en: 'Shop', de: 'Laden' },
	icon: 'cart',
	patterns: ['*example.com*'],
	items: [
		{ id: 'orders', label: { en: 'Orders' }, icon: 'package', action: 'openCustomUrl', customUrl: 'https://example.com/orders' },
		{ id: 'sep1', type: 'separator' },
		{ id: 'search', label: { en: 'Search' }, action: 'searchLink', url: 'https://example.com/s?q=%s' },
	],
});

describe('detectType', () => {
	it('detects menu and engine and null', () => {
		expect(X.detectType({ gesturaMenu: 1 })).toBe('menu');
		expect(X.detectType({ gesturaEngine: 1 })).toBe('engine');
		expect(X.detectType({})).toBe(null);
		expect(X.detectType(null)).toBe(null);
	});
});

describe('isHttpsUrl', () => {
	it('accepts https only', () => {
		expect(X.isHttpsUrl('https://a.example/x')).toBe(true);
		expect(X.isHttpsUrl('http://a.example/x')).toBe(false);
		expect(X.isHttpsUrl('javascript:alert(1)')).toBe(false);
		expect(X.isHttpsUrl('data:text/html,x')).toBe(false);
		expect(X.isHttpsUrl('file:///etc/passwd')).toBe(false);
		expect(X.isHttpsUrl('not a url')).toBe(false);
	});
});

describe('pickLabel', () => {
	it('prefers lang, falls back to en, then to string', () => {
		expect(X.pickLabel({ en: 'Orders', de: 'Bestellungen' }, 'de')).toBe('Bestellungen');
		expect(X.pickLabel({ en: 'Orders' }, 'de')).toBe('Orders');
		expect(X.pickLabel('Plain', 'de')).toBe('Plain');
		expect(X.pickLabel(null, 'de')).toBe('');
	});
});

describe('validate(menu)', () => {
	it('accepts a well-formed menu', () => {
		const r = X.validate(validMenu());
		expect(r.ok).toBe(true);
		expect(r.type).toBe('menu');
		expect(r.errors).toEqual([]);
		expect(r.value.items).toHaveLength(3);
	});
	it('rejects unsupported format version', () => {
		const r = X.validate({ ...validMenu(), gesturaMenu: 2 });
		expect(r.ok).toBe(false);
		expect(r.errors.join()).toMatch(/format/i);
	});
	it('rejects missing id / bad semver', () => {
		expect(X.validate({ ...validMenu(), id: '' }).ok).toBe(false);
		expect(X.validate({ ...validMenu(), version: '1.0' }).ok).toBe(false);
		expect(X.validate({ ...validMenu(), version: '999999.0.0' }).ok).toBe(false);
	});
	it('rejects non-https item url and javascript url', () => {
		const m = validMenu();
		m.items[0].customUrl = 'http://example.com/x';
		expect(X.validate(m).ok).toBe(false);
		const m2 = validMenu();
		m2.items[0].customUrl = 'javascript:alert(1)';
		expect(X.validate(m2).ok).toBe(false);
	});
	it('rejects a disallowed action', () => {
		const m = validMenu();
		m.items[0].action = 'sendExtensionMessage';
		expect(X.validate(m).ok).toBe(false);
	});
	it('rejects duplicate item ids', () => {
		const m = validMenu();
		m.items[2].id = 'orders';
		expect(X.validate(m).ok).toBe(false);
	});
	it('rejects too many items', () => {
		const m = validMenu();
		m.items = Array.from({ length: 101 }, (_, i) => ({ id: 'i' + i, action: 'openCustomUrl', customUrl: 'https://x.example/' + i }));
		expect(X.validate(m).ok).toBe(false);
	});
	it('rejects an oversized blob', () => {
		const m = validMenu();
		m.description = { en: 'x'.repeat(200000) };
		expect(X.validate(m).ok).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/menu-exchange.test.mjs`
Expected: FAIL — `Cannot read properties of undefined` / `FlowMouseMenuExchange` is undefined.

- [ ] **Step 3: Write minimal implementation**

Create `js/menu-exchange.js`:

```js
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
		itemsMax: 100, blobMax: 100 * 1024,
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
		try { return JSON.stringify(obj).length; } catch { return Infinity; }
	}

	function validateMenu(obj, errors) {
		if (obj[FORMAT_TYPES.menu] !== CURRENT_FORMAT_VERSION) errors.push('unsupportedFormatVersion');
		if (typeof obj.id !== 'string' || !ID_RE.test(obj.id) || obj.id.length > LIMITS.idMax) errors.push('id');
		if (typeof obj.version !== 'string' || !SEMVER_RE.test(obj.version)) errors.push('version');
		if (obj.name == null || !isLabelField(obj.name, LIMITS.nameMax)) errors.push('name');
		if (!isLabelField(obj.description, LIMITS.descMax)) errors.push('description');
		if (obj.icon != null && (typeof obj.icon !== 'string' || obj.icon.length > LIMITS.iconMax)) errors.push('icon');
		if (obj.homepage != null && !isHttpsUrl(obj.homepage)) errors.push('homepage');
		if (obj.patterns != null) {
			if (!Array.isArray(obj.patterns) || obj.patterns.length > LIMITS.patternsMax
				|| !obj.patterns.every(p => typeof p === 'string' && p.length <= LIMITS.patternMax)) errors.push('patterns');
		}
		if (!Array.isArray(obj.items) || obj.items.length < 1 || obj.items.length > LIMITS.itemsMax) {
			errors.push('items');
		} else {
			const seen = new Set();
			for (const it of obj.items) {
				if (!it || typeof it !== 'object' || typeof it.id !== 'string' || it.id.length > LIMITS.idMax) { errors.push('itemId'); continue; }
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
		// engine: siehe Task 2
		const ok = errors.length === 0;
		return { ok, type, errors, value: ok ? JSON.parse(JSON.stringify(obj)) : null };
	}

	const api = {
		CURRENT_FORMAT_VERSION, FORMAT_TYPES, ALLOWED_MENU_ITEM_ACTIONS, LIMITS,
		detectType, isHttpsUrl, pickLabel, validate,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseMenuExchange = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/menu-exchange.test.mjs`
Expected: PASS (all `detectType`, `isHttpsUrl`, `pickLabel`, `validate(menu)` cases green).

- [ ] **Step 5: Commit**

```bash
git add js/menu-exchange.js tests/menu-exchange.test.mjs
git commit -m "feat(exchange): menu-exchange validator for gesturaMenu format"
```

---

## Task 2: `menu-exchange.js` — Validierung `gesturaEngine` + Transform-Erkennung

**Files:**
- Modify: `js/menu-exchange.js`
- Test: `tests/menu-exchange.test.mjs`

**Interfaces:**
- Consumes: `validate` (aus Task 1)
- Produces:
  - `hasTransform(engine)` → boolean (true wenn `transformEnabled` **und** nicht-leerer `transformCode`)
  - `validate(obj)` deckt jetzt auch `type: 'engine'` ab

- [ ] **Step 1: Write the failing test**

Append to `tests/menu-exchange.test.mjs`:

```js
const validEngine = () => ({
	gesturaEngine: 1,
	id: 'example-search',
	version: '1.0.0',
	name: { en: 'Example Search' },
	url: 'https://example.com/s?q=%s',
	type: 'text',
});

describe('validate(engine)', () => {
	it('accepts a well-formed engine without transform', () => {
		const r = X.validate(validEngine());
		expect(r.ok).toBe(true);
		expect(r.type).toBe('engine');
		expect(X.hasTransform(r.value)).toBe(false);
	});
	it('accepts an engine with transform and reports hasTransform', () => {
		const e = { ...validEngine(), transformEnabled: true, transformCode: 'return selection.trim();' };
		const r = X.validate(e);
		expect(r.ok).toBe(true);
		expect(X.hasTransform(r.value)).toBe(true);
	});
	it('reports hasTransform false for enabled-but-empty code', () => {
		expect(X.hasTransform({ transformEnabled: true, transformCode: '   ' })).toBe(false);
	});
	it('rejects non-https engine url', () => {
		expect(X.validate({ ...validEngine(), url: 'http://example.com/s?q=%s' }).ok).toBe(false);
	});
	it('rejects oversized transform code', () => {
		const e = { ...validEngine(), transformEnabled: true, transformCode: 'x'.repeat(11000) };
		expect(X.validate(e).ok).toBe(false);
	});
	it('rejects bad type value', () => {
		expect(X.validate({ ...validEngine(), type: 'video' }).ok).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/menu-exchange.test.mjs`
Expected: FAIL — `X.hasTransform is not a function` and engine cases fail.

- [ ] **Step 3: Write minimal implementation**

In `js/menu-exchange.js`, add `transformCodeMax` to `LIMITS`:

```js
	const LIMITS = {
		idMax: 128, nameMax: 200, descMax: 2000, iconMax: 64,
		urlMax: 2000, patternMax: 200, patternsMax: 50,
		itemsMax: 100, blobMax: 100 * 1024, transformCodeMax: 10 * 1024,
	};
```

Add `validateEngine` and `hasTransform` before `validate`:

```js
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
```

In `validate`, add the engine branch:

```js
		if (type === 'menu') validateMenu(obj, errors);
		if (type === 'engine') validateEngine(obj, errors);
```

Add `hasTransform` to the exported `api` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/menu-exchange.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/menu-exchange.js tests/menu-exchange.test.mjs
git commit -m "feat(exchange): validate gesturaEngine format + transform detection"
```

---

## Task 3: `menu-exchange.js` — Import-Mapping (`toCustomMenu` / `toCustomEngine`)

**Files:**
- Modify: `js/menu-exchange.js`
- Test: `tests/menu-exchange.test.mjs`

**Interfaces:**
- Consumes: `validate` (Task 1/2)
- Produces:
  - `toCustomMenu(menuValue, source, genId)` → `{ id: string, def: object }` — `def` = `{ name, icon, patterns, items, source }`, alle Item-IDs neu vergeben (`genId('item')`), Menü-ID neu (`genId('menu')`). Labels werden **nicht** aufgelöst (bleiben als String/Objekt; das UI löst per `pickLabel`). `source` wird unverändert übernommen. (`appendMini` ist **nicht** Teil des Phase-1-Formats — der Flag lebt in `siteMenus.flags`; ein importiertes Menü ohne Flag erbt den Default über `menuFlag`. Kann später als optionales Formatfeld ergänzt werden, ohne Bruch.)
  - `toCustomEngine(engineValue, source, genId)` → engine-Objekt für `searchEngines.custom` (Felder wie in engine-registry `toEngine`), neue `id` (`genId('eng')`), `builtin: false`, plus `source`.
  - `newId(prefix)` → `"<prefix>_<hex>"` (Default-Generator; nutzt `crypto.randomUUID`)

- [ ] **Step 1: Write the failing test**

Append to `tests/menu-exchange.test.mjs`:

```js
describe('toCustomMenu', () => {
	it('maps a validated menu to a custom siteMenus entry with fresh ids', () => {
		const v = X.validate(validMenu()).value;
		let n = 0;
		const genId = (p) => `${p}_test${n++}`;
		const source = { type: 'file', version: '1.0.0' };
		const { id, def } = X.toCustomMenu(v, source, genId);
		expect(id).toBe('menu_test0');
		expect(def.name).toEqual({ en: 'Shop', de: 'Laden' });
		expect(def.patterns).toEqual(['*example.com*']);
		expect(def.items).toHaveLength(3);
		expect(def.items[0].id).toBe('item_test1'); // neue ID
		expect(def.items[0].action).toBe('openCustomUrl');
		expect(def.items[0].customUrl).toBe('https://example.com/orders');
		expect(def.items[1].type).toBe('separator');
		expect(def.source).toEqual(source);
	});
});

describe('toCustomEngine', () => {
	it('maps a validated engine to a searchEngines.custom entry', () => {
		const v = X.validate({ ...validEngine(), transformEnabled: true, transformCode: 'return selection;' }).value;
		const genId = () => 'eng_test';
		const e = X.toCustomEngine(v, { type: 'file', version: '1.0.0' }, genId);
		expect(e.id).toBe('eng_test');
		expect(e.builtin).toBe(false);
		expect(e.url).toBe('https://example.com/s?q=%s');
		expect(e.transformEnabled).toBe(true);
		expect(e.transformCode).toBe('return selection;');
		expect(e.source.type).toBe('file');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/menu-exchange.test.mjs`
Expected: FAIL — `X.toCustomMenu is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `js/menu-exchange.js`, add before the `api` object:

```js
	function newId(prefix) {
		const uuid = (root.crypto && root.crypto.randomUUID)
			? root.crypto.randomUUID().replace(/-/g, '')
			: Math.random().toString(16).slice(2);
		return `${prefix}_${uuid.slice(0, 12)}`;
	}

	function toCustomMenu(menuValue, source, genId) {
		const g = genId || newId;
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
		return { id: g('menu'), def };
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
```

Add `newId`, `toCustomMenu`, `toCustomEngine` to the exported `api`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/menu-exchange.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/menu-exchange.js tests/menu-exchange.test.mjs
git commit -m "feat(exchange): import mapping to custom menu/engine with fresh ids"
```

---

## Task 4: `menu-exchange.js` — Export (`menuToExchange` / `engineToExchange`)

**Files:**
- Modify: `js/menu-exchange.js`
- Test: `tests/menu-exchange.test.mjs`

**Interfaces:**
- Consumes: `validate`, `toCustomMenu`, `toCustomEngine`
- Produces:
  - `menuToExchange(menuDef, meta)` → Format-Objekt `{ gesturaMenu:1, id, version, name, icon?, patterns?, description?, items }`. `meta` = `{ id, version, description? }` (Autor-Kennung/Version, vom Aufrufer). Item-IDs bleiben erhalten (stabil).
  - `engineToExchange(engine, meta)` → `{ gesturaEngine:1, id, version, name, url, … , transform*? }`.
  - Beide Ausgaben sind wieder `validate()`-gültig (Round-Trip).

- [ ] **Step 1: Write the failing test**

Append to `tests/menu-exchange.test.mjs`:

```js
describe('export round-trip', () => {
	it('menuToExchange produces a valid menu that re-validates', () => {
		const def = {
			name: { en: 'My Menu' }, icon: 'star', patterns: ['*x.example*'],
			items: [
				{ id: 'a', action: 'openCustomUrl', customUrl: 'https://x.example/a', label: { en: 'A' } },
				{ id: 's', type: 'separator' },
			],
		};
		const out = X.menuToExchange(def, { id: 'com.me.mymenu', version: '2.1.0' });
		expect(out.gesturaMenu).toBe(1);
		expect(out.id).toBe('com.me.mymenu');
		expect(out.version).toBe('2.1.0');
		expect(out.items[0].id).toBe('a'); // stabile IDs erhalten
		expect(X.validate(out).ok).toBe(true);
	});
	it('engineToExchange produces a valid engine that re-validates', () => {
		const engine = { name: { en: 'E' }, url: 'https://e.example/?q=%s', type: 'text', transformEnabled: true, transformCode: 'return selection;' };
		const out = X.engineToExchange(engine, { id: 'my-engine', version: '1.2.3' });
		expect(out.gesturaEngine).toBe(1);
		expect(out.transformCode).toBe('return selection;');
		expect(X.validate(out).ok).toBe(true);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/menu-exchange.test.mjs`
Expected: FAIL — `X.menuToExchange is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `js/menu-exchange.js`, add before the `api` object:

```js
	function menuToExchange(menuDef, meta) {
		const m = meta || {};
		const items = (menuDef.items || []).map(it => {
			if (it.type === 'separator') return { id: it.id, type: 'separator' };
			const out = { id: it.id, action: it.action };
			if (it.label != null) out.label = JSON.parse(JSON.stringify(it.label));
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
			name: JSON.parse(JSON.stringify(menuDef.name || { en: '' })),
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
```

Add `menuToExchange`, `engineToExchange` to the exported `api`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/menu-exchange.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/menu-exchange.js tests/menu-exchange.test.mjs
git commit -m "feat(exchange): export menu/engine to portable format (round-trip safe)"
```

---

## Task 5: JSON-Schema-Vertragsdatei `exchange-schema.json`

**Files:**
- Create: `js/exchange-schema.json`
- Test: `tests/exchange-schema.test.mjs`

**Interfaces:**
- Produces: `js/exchange-schema.json` — dokumentiert das Format für das spätere Backend. Enthält oben eine `x-gestura`-Sektion, deren Werte mit den Konstanten aus `menu-exchange.js` übereinstimmen müssen (Guard gegen Drift).

- [ ] **Step 1: Write the failing test**

Create `tests/exchange-schema.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import '../js/menu-exchange.js';
const X = globalThis.FlowMouseMenuExchange;

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'exchange-schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

describe('exchange-schema.json', () => {
	it('is valid JSON with a $schema and title', () => {
		expect(schema.$schema).toBeTruthy();
		expect(schema.title).toMatch(/gestura/i);
	});
	it('x-gestura metadata matches menu-exchange constants (no drift)', () => {
		expect(schema['x-gestura'].formatVersion).toBe(X.CURRENT_FORMAT_VERSION);
		expect(schema['x-gestura'].types).toEqual(X.FORMAT_TYPES);
		expect(schema['x-gestura'].allowedMenuItemActions.sort()).toEqual(X.ALLOWED_MENU_ITEM_ACTIONS.slice().sort());
		expect(schema['x-gestura'].limits).toEqual(X.LIMITS);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/exchange-schema.test.mjs`
Expected: FAIL — cannot read `js/exchange-schema.json` (file missing).

- [ ] **Step 3: Write minimal implementation**

Create `js/exchange-schema.json` (the `x-gestura` block must mirror the constants exactly; keep the two `$defs` as documentation):

```json
{
	"$schema": "http://json-schema.org/draft-07/schema#",
	"title": "Gestura Exchange Format (menu & engine)",
	"description": "Portable format for sharing Gestura menus and search engines. The runtime validator lives in js/menu-exchange.js; this file is the shared contract for the future index backend.",
	"x-gestura": {
		"formatVersion": 1,
		"types": { "menu": "gesturaMenu", "engine": "gesturaEngine" },
		"allowedMenuItemActions": ["none", "openCustomUrl", "searchLink", "back", "forward", "refresh", "newTab", "scrollUp", "scrollDown", "scrollToTop", "scrollToBottom"],
		"limits": {
			"idMax": 128, "nameMax": 200, "descMax": 2000, "iconMax": 64,
			"urlMax": 2000, "patternMax": 200, "patternsMax": 50,
			"itemsMax": 100, "blobMax": 102400, "transformCodeMax": 10240
		}
	},
	"oneOf": [{ "$ref": "#/$defs/menu" }, { "$ref": "#/$defs/engine" }],
	"$defs": {
		"label": {
			"oneOf": [
				{ "type": "string", "maxLength": 200 },
				{ "type": "object", "additionalProperties": { "type": "string", "maxLength": 200 } }
			]
		},
		"menu": {
			"type": "object",
			"required": ["gesturaMenu", "id", "version", "name", "items"],
			"properties": {
				"gesturaMenu": { "const": 1 },
				"id": { "type": "string", "maxLength": 128 },
				"version": { "type": "string", "pattern": "^\\d{1,5}\\.\\d{1,5}\\.\\d{1,5}$" },
				"name": { "$ref": "#/$defs/label" },
				"description": { "$ref": "#/$defs/label" },
				"icon": { "type": "string", "maxLength": 64 },
				"homepage": { "type": "string", "format": "uri", "pattern": "^https://" },
				"patterns": { "type": "array", "maxItems": 50, "items": { "type": "string", "maxLength": 200 } },
				"items": {
					"type": "array", "minItems": 1, "maxItems": 100,
					"items": {
						"type": "object",
						"required": ["id"],
						"properties": {
							"id": { "type": "string", "maxLength": 128 },
							"type": { "const": "separator" },
							"action": { "enum": ["none", "openCustomUrl", "searchLink", "back", "forward", "refresh", "newTab", "scrollUp", "scrollDown", "scrollToTop", "scrollToBottom"] },
							"label": { "$ref": "#/$defs/label" },
							"icon": { "type": "string", "maxLength": 64 },
							"customUrl": { "type": "string", "maxLength": 2000, "pattern": "^https://" },
							"url": { "type": "string", "maxLength": 2000, "pattern": "^https://" },
							"engineId": { "type": "string", "maxLength": 128 }
						}
					}
				}
			}
		},
		"engine": {
			"type": "object",
			"required": ["gesturaEngine", "id", "version", "name", "url"],
			"properties": {
				"gesturaEngine": { "const": 1 },
				"id": { "type": "string", "maxLength": 128 },
				"version": { "type": "string", "pattern": "^\\d{1,5}\\.\\d{1,5}\\.\\d{1,5}$" },
				"name": { "$ref": "#/$defs/label" },
				"description": { "$ref": "#/$defs/label" },
				"url": { "type": "string", "maxLength": 2000, "pattern": "^https://" },
				"icon": { "type": "string", "maxLength": 64 },
				"type": { "enum": ["text", "image"] },
				"plus": { "type": "boolean" },
				"slug": { "type": "boolean" },
				"suffix": { "type": "string", "maxLength": 200 },
				"clipboardMode": { "type": "boolean" },
				"rawResult": { "type": "boolean" },
				"transformEnabled": { "type": "boolean" },
				"transformCode": { "type": "string", "maxLength": 10240 },
				"transformClipboard": { "type": "boolean" },
				"transformRawResult": { "type": "boolean" },
				"transformRequired": { "type": "boolean" }
			}
		}
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/exchange-schema.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/exchange-schema.json tests/exchange-schema.test.mjs
git commit -m "feat(exchange): JSON-schema contract file with anti-drift guard"
```

---

## Task 6: i18n-Keys für alle Locales + Vollständigkeitstest

**Files:**
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json`
- Modify: alle übrigen `_locales/*/messages.json` (per Seed-Schritt)
- Test: `tests/menu-exchange-locales.test.mjs`

**Interfaces:**
- Produces: neue i18n-Keys (Präfix `exchange`) in **allen** Locales.

Keys (Werte für `en`; `message`-Feld je Key):

| Key | en message |
| --- | --- |
| `exchangeImportTitle` | Import menu or engine |
| `exchangeImportFromFile` | Import from file… |
| `exchangeImportFromUrl` | Import from URL… |
| `exchangeImportUrlPlaceholder` | https://example.com/menu.json |
| `exchangeExport` | Export |
| `exchangePreviewTitle` | Import preview |
| `exchangePreviewMenu` | Menu |
| `exchangePreviewEngine` | Search engine |
| `exchangePreviewItems` | Entries |
| `exchangeConfirmImport` | Add to Gestura |
| `exchangeCancel` | Cancel |
| `exchangeInvalid` | This file is not a valid Gestura menu or engine. |
| `exchangeInvalidDetail` | The import was rejected for safety: $DETAIL$ |
| `exchangeScriptWarnTitle` | This engine runs JavaScript |
| `exchangeScriptWarnBody` | It executes a script to transform your input. Only import it if you trust the source. Review the code below. |
| `exchangeScriptChromeOnly` | Scripts only run in Chrome/Chromium. In Firefox this engine is imported without its script. |
| `exchangeScriptChromeOnlyRequired` | This engine requires its script and only works in Chrome/Chromium. |
| `exchangeScriptConfirm` | I understand this runs a script and I trust the source |
| `exchangeImportedMenu` | Menu imported. |
| `exchangeImportedEngine` | Engine imported. |
| `exchangeFromSite` | This website offers a Gestura menu. |

`de` messages:

| Key | de message |
| --- | --- |
| `exchangeImportTitle` | Menü oder Engine importieren |
| `exchangeImportFromFile` | Aus Datei importieren… |
| `exchangeImportFromUrl` | Aus URL importieren… |
| `exchangeImportUrlPlaceholder` | https://example.com/menu.json |
| `exchangeExport` | Exportieren |
| `exchangePreviewTitle` | Import-Vorschau |
| `exchangePreviewMenu` | Menü |
| `exchangePreviewEngine` | Suchmaschine |
| `exchangePreviewItems` | Einträge |
| `exchangeConfirmImport` | Zu Gestura hinzufügen |
| `exchangeCancel` | Abbrechen |
| `exchangeInvalid` | Diese Datei ist kein gültiges Gestura-Menü und keine gültige Engine. |
| `exchangeInvalidDetail` | Der Import wurde aus Sicherheitsgründen abgelehnt: $DETAIL$ |
| `exchangeScriptWarnTitle` | Diese Engine führt JavaScript aus |
| `exchangeScriptWarnBody` | Sie führt ein Skript aus, um deine Eingabe umzuwandeln. Importiere sie nur, wenn du der Quelle vertraust. Prüfe den Code unten. |
| `exchangeScriptChromeOnly` | Skripte laufen nur in Chrome/Chromium. In Firefox wird diese Engine ohne ihr Skript importiert. |
| `exchangeScriptChromeOnlyRequired` | Diese Engine benötigt ihr Skript und funktioniert nur in Chrome/Chromium. |
| `exchangeScriptConfirm` | Mir ist bewusst, dass dies ein Skript ausführt, und ich vertraue der Quelle |
| `exchangeImportedMenu` | Menü importiert. |
| `exchangeImportedEngine` | Engine importiert. |
| `exchangeFromSite` | Diese Website bietet ein Gestura-Menü an. |

- [ ] **Step 1: Write the failing test**

Create `tests/menu-exchange-locales.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const EXCHANGE_KEYS = [
	'exchangeImportTitle', 'exchangeImportFromFile', 'exchangeImportFromUrl',
	'exchangeImportUrlPlaceholder', 'exchangeExport', 'exchangePreviewTitle',
	'exchangePreviewMenu', 'exchangePreviewEngine', 'exchangePreviewItems',
	'exchangeConfirmImport', 'exchangeCancel', 'exchangeInvalid', 'exchangeInvalidDetail',
	'exchangeScriptWarnTitle', 'exchangeScriptWarnBody', 'exchangeScriptChromeOnly',
	'exchangeScriptChromeOnlyRequired', 'exchangeScriptConfirm',
	'exchangeImportedMenu', 'exchangeImportedEngine', 'exchangeFromSite',
];

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '_locales');

describe('menu-exchange locale completeness', () => {
	for (const lang of readdirSync(localesDir)) {
		it(`${lang} has all exchange keys`, () => {
			const cat = JSON.parse(readFileSync(join(localesDir, lang, 'messages.json'), 'utf8'));
			const missing = EXCHANGE_KEYS.filter(k => !cat[k] || !cat[k].message);
			expect(missing, `${lang} missing: ${missing.join(', ')}`).toEqual([]);
		});
	}
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/menu-exchange-locales.test.mjs`
Expected: FAIL — every locale missing all exchange keys.

- [ ] **Step 3a: Add en and de messages by hand**

Add the keys from the tables above into `_locales/en/messages.json` and `_locales/de/messages.json`. Each entry has the form:

```json
	"exchangeImportTitle": { "message": "Import menu or engine" },
```

(Insert before the closing `}` of each file; keep tab indentation and valid JSON — no trailing comma on the last entry.)

- [ ] **Step 3b: Seed the remaining locales from en**

Run this one-off Node script (paste at a shell). It copies any missing exchange key from `en` into every other locale so `chrome.i18n` has an entry everywhere; machine translation can replace them later.

```bash
node -e '
const fs=require("fs"),p=require("path");
const dir=p.join(process.cwd(),"_locales");
const en=JSON.parse(fs.readFileSync(p.join(dir,"en","messages.json"),"utf8"));
const KEYS=["exchangeImportTitle","exchangeImportFromFile","exchangeImportFromUrl","exchangeImportUrlPlaceholder","exchangeExport","exchangePreviewTitle","exchangePreviewMenu","exchangePreviewEngine","exchangePreviewItems","exchangeConfirmImport","exchangeCancel","exchangeInvalid","exchangeInvalidDetail","exchangeScriptWarnTitle","exchangeScriptWarnBody","exchangeScriptChromeOnly","exchangeScriptChromeOnlyRequired","exchangeScriptConfirm","exchangeImportedMenu","exchangeImportedEngine","exchangeFromSite"];
for(const lang of fs.readdirSync(dir)){
	if(lang==="en"||lang==="de")continue;
	const f=p.join(dir,lang,"messages.json");
	const cat=JSON.parse(fs.readFileSync(f,"utf8"));
	let changed=false;
	for(const k of KEYS){ if(!cat[k]||!cat[k].message){ cat[k]={message:en[k].message}; changed=true; } }
	if(changed)fs.writeFileSync(f,JSON.stringify(cat,null,"\t")+"\n","utf8");
}
console.log("seeded");
'
```

Expected output: `seeded`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/menu-exchange-locales.test.mjs`
Expected: PASS for every locale.

- [ ] **Step 5: Commit**

```bash
git add _locales tests/menu-exchange-locales.test.mjs
git commit -m "i18n(exchange): add import/export strings (en/de authored, rest seeded)"
```

---

## Task 7: Lit-Komponente `<menu-import-dialog>` (Vorschau + Bestätigung)

**Files:**
- Create: `js/components/menu-import-dialog.js`
- Modify: `pages/options.html`

**Interfaces:**
- Consumes: `window.FlowMouseMenuExchange` (validate, pickLabel, hasTransform, toCustomMenu, toCustomEngine), `SettingsStore`.
- Produces: Custom element `<menu-import-dialog>` with:
  - Method `openWith(rawObject, source)` — validiert und zeigt den Dialog; bei Invalidität Fehleransicht.
  - Emits DOM event `import-done` (detail: `{ type }`) nach erfolgreichem Import.

**Verification:** Diese Komponente wird **manuell** in der geladenen Extension geprüft (das Repo hat keine Komponententest-Infrastruktur; die testbare Logik liegt in `menu-exchange.js`, bereits durch Tasks 1–5 abgedeckt).

- [ ] **Step 1: Create the component**

Create `js/components/menu-import-dialog.js`:

```js
import { LitElement, html, css } from '../lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { SettingsStore } from '../settings-store.js';

const X = () => window.FlowMouseMenuExchange;
const isFirefox = navigator.userAgent.includes('Firefox');

// Import-Vorschau für Gestura-Menüs/-Engines. Für alle Import-Wege (Datei, URL,
// Betreiber-Button) genutzt. Rendert nie ungeprüftes JSON: erst validate(), dann
// Anzeige aus dem normalisierten value.
class MenuImportDialog extends LitElement {
	static properties = {
		_open: { state: true },
		_result: { state: true },   // { ok, type, errors, value }
		_source: { state: true },
		_scriptAck: { state: true },
	};

	static styles = [commonStyles, optionStyles, css`
		.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex;
			align-items: center; justify-content: center; z-index: 1000; }
		.dialog { background: var(--card-bg, #fff); color: var(--text-primary, #111);
			border-radius: 10px; width: min(560px, 92vw); max-height: 86vh; overflow: auto;
			padding: 18px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); }
		.title { font-size: 15px; font-weight: 600; margin: 0 0 10px; }
		.kind { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
		.name { font-size: 16px; font-weight: 600; margin: 2px 0 8px; }
		.items { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
		.item { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 6px;
			border-radius: 6px; background: var(--bg-secondary, rgba(128,128,128,.08)); }
		.item .url { color: var(--text-muted); font-size: 11px; word-break: break-all; }
		.sep { height: 1px; background: var(--border-color); margin: 3px 0; }
		.warn { border: 1px solid var(--danger-color, #d33); border-radius: 8px; padding: 10px;
			margin: 10px 0; background: rgba(211,51,51,.06); }
		.warn h4 { margin: 0 0 6px; color: var(--danger-color, #d33); font-size: 13px; }
		.code { font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap;
			background: var(--bg-secondary, #f3f3f3); border-radius: 6px; padding: 8px; max-height: 220px;
			overflow: auto; }
		.ack { display: flex; gap: 8px; align-items: flex-start; margin: 8px 0; font-size: 13px; }
		.err { color: var(--danger-color, #d33); font-size: 13px; }
		.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
	`];

	constructor() {
		super();
		this._open = false;
		this._result = null;
		this._source = null;
		this._scriptAck = false;
	}

	openWith(rawObject, source) {
		this._source = source || { type: 'file' };
		this._result = X().validate(rawObject);
		this._scriptAck = false;
		this._open = true;
	}

	#close() { this._open = false; this._result = null; }

	#lang() { return (window.i18n && window.i18n.uiLang) ? window.i18n.uiLang : 'en'; }

	get #needsScriptAck() {
		const r = this._result;
		return !!(r && r.ok && r.type === 'engine' && X().hasTransform(r.value));
	}

	async #confirm() {
		const r = this._result;
		if (!r || !r.ok) return;
		const i18n = window.i18n;
		const version = r.value.version || '1.0.0';
		const source = { ...this._source, version };
		if (r.type === 'menu') {
			const { id, def } = X().toCustomMenu(r.value, source);
			const cur = SettingsStore.current.siteMenus || { disabled: [], edited: {}, custom: {}, domains: {}, order: [], flags: {}, defaultMenuId: 'search' };
			const next = { ...cur, custom: { ...cur.custom, [id]: def }, order: [...(cur.order || []), id] };
			await SettingsStore.save({ siteMenus: next });
		} else {
			const engine = X().toCustomEngine(r.value, source);
			if (isFirefox && !r.value.transformRequired) { engine.transformEnabled = false; engine.transformCode = ''; }
			const cur = SettingsStore.current.searchEngines || { overrides: {}, hidden: [], custom: [], order: [] };
			const next = { ...cur, custom: [...(cur.custom || []), engine] };
			await SettingsStore.save({ searchEngines: next });
		}
		this.dispatchEvent(new CustomEvent('import-done', { detail: { type: r.type }, bubbles: true, composed: true }));
		this.#close();
	}

	render() {
		if (!this._open) return html``;
		const i18n = window.i18n;
		const r = this._result;
		return html`<div class="backdrop" @click=${(e) => { if (e.target === e.currentTarget) this.#close(); }}>
			<div class="dialog">
				<h3 class="title">${i18n.getMessage('exchangePreviewTitle')}</h3>
				${r && r.ok ? (r.type === 'menu' ? this.#renderMenu(r.value, i18n) : this.#renderEngine(r.value, i18n)) : this.#renderError(r, i18n)}
			</div>
		</div>`;
	}

	#renderError(r, i18n) {
		const detail = (r && r.errors) ? r.errors.join(', ') : '';
		return html`
			<p class="err">${i18n.getMessage('exchangeInvalid')}</p>
			<p class="err">${i18n.getMessage('exchangeInvalidDetail').replace('$DETAIL$', detail)}</p>
			<div class="actions"><button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button></div>`;
	}

	#renderMenu(v, i18n) {
		const lang = this.#lang();
		return html`
			<div class="kind">${i18n.getMessage('exchangePreviewMenu')}</div>
			<div class="name">${X().pickLabel(v.name, lang)}</div>
			<div class="items">
				${v.items.map(it => it.type === 'separator'
					? html`<div class="sep"></div>`
					: html`<div class="item">
						<span>${X().pickLabel(it.label, lang) || it.action}</span>
						<span class="url">${it.customUrl || it.url || it.engineId || ''}</span>
					</div>`)}
			</div>
			<div class="actions">
				<button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button>
				<button class="btn btn-primary" @click=${() => this.#confirm()}>${i18n.getMessage('exchangeConfirmImport')}</button>
			</div>`;
	}

	#renderEngine(v, i18n) {
		const lang = this.#lang();
		const script = this.#needsScriptAck;
		return html`
			<div class="kind">${i18n.getMessage('exchangePreviewEngine')}</div>
			<div class="name">${X().pickLabel(v.name, lang)}</div>
			<div class="item"><span class="url">${v.url}</span></div>
			${script ? html`
				<div class="warn">
					<h4>${i18n.getMessage('exchangeScriptWarnTitle')}</h4>
					<p>${i18n.getMessage('exchangeScriptWarnBody')}</p>
					<p>${i18n.getMessage(v.transformRequired && isFirefox ? 'exchangeScriptChromeOnlyRequired' : 'exchangeScriptChromeOnly')}</p>
					<div class="code">${v.transformCode}</div>
					<label class="ack">
						<input type="checkbox" .checked=${this._scriptAck} @change=${(e) => { this._scriptAck = e.target.checked; }}>
						<span>${i18n.getMessage('exchangeScriptConfirm')}</span>
					</label>
				</div>` : ''}
			<div class="actions">
				<button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button>
				<button class="btn btn-primary" ?disabled=${script && !this._scriptAck} @click=${() => this.#confirm()}>${i18n.getMessage('exchangeConfirmImport')}</button>
			</div>`;
	}
}
customElements.define('menu-import-dialog', MenuImportDialog);
```

- [ ] **Step 2: Register the scripts in options.html**

In `pages/options.html`, add the classic script after `menu-model.js` (line ~30):

```html
	<script src="../js/menu-exchange.js"></script>
```

And add the module script alongside the other components (after `site-menu-manager.js`, line ~53):

```html
	<script type="module" src="../js/components/menu-import-dialog.js"></script>
```

- [ ] **Step 3: Verify manually (load unpacked)**

1. Open `chrome://extensions`, reload Gestura.
2. Open the options page, open DevTools console, run:

```js
const d = document.createElement('menu-import-dialog');
document.body.appendChild(d);
d.openWith({ gesturaEngine: 1, id: 'x', version: '1.0.0', name: { en: 'Demo' }, url: 'https://e.example/?q=%s', transformEnabled: true, transformCode: 'return selection.trim();' }, { type: 'file' });
```

Expected: dialog appears, shows the engine name and URL, a red **"This engine runs JavaScript"** warning with the code, the Chrome-only note, and the **"Add to Gestura"** button is disabled until the acknowledgement checkbox is ticked.

3. Repeat with an invalid object `d.openWith({}, {type:'file'})` → error view with cancel only.

- [ ] **Step 4: Commit**

```bash
git add js/components/menu-import-dialog.js pages/options.html
git commit -m "feat(exchange): import-preview dialog with transform warning + chrome-only note"
```

---

## Task 8: Import (Datei + URL) und Export in den Manager-Komponenten

**Files:**
- Modify: `js/components/site-menu-manager.js`
- Modify: `js/components/engine-manager.js`

**Interfaces:**
- Consumes: `window.FlowMouseMenuExchange` (menuToExchange, engineToExchange), `<menu-import-dialog>` (openWith).

**Verification:** manuell in der geladenen Extension.

- [ ] **Step 1: Add an import bar + export helper to site-menu-manager**

In `js/components/site-menu-manager.js`, add a shared download helper near the top (module scope, after the imports):

```js
function downloadJson(obj, filename) {
	const blob = new Blob([JSON.stringify(obj, null, '\t')], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url; a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

Add an import bar to the section's render (in the main `render()` template, near the "Eigenes Menü anlegen" button). Insert this block:

```js
				<div class="import-bar">
					<button class="btn btn-ghost" @click=${() => this.#importFile()}>${window.i18n.getMessage('exchangeImportFromFile')}</button>
					<input class="import-url" type="url" placeholder=${window.i18n.getMessage('exchangeImportUrlPlaceholder')}
						@keydown=${(e) => { if (e.key === 'Enter') this.#importUrl(e.target.value); }}>
					<button class="btn btn-ghost" @click=${(e) => this.#importUrl(e.target.previousElementSibling.value)}>${window.i18n.getMessage('exchangeImportFromUrl')}</button>
					<menu-import-dialog @import-done=${() => this.requestUpdate()}></menu-import-dialog>
				</div>
```

Add these private methods to the class:

```js
	#dialog() { return this.renderRoot.querySelector('menu-import-dialog'); }

	async #importFile() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'application/json,.json';
		input.onchange = async () => {
			const file = input.files[0];
			if (!file) return;
			try {
				const obj = JSON.parse(await file.text());
				this.#dialog().openWith(obj, { type: 'file' });
			} catch { this.#dialog().openWith({}, { type: 'file' }); }
		};
		input.click();
	}

	async #importUrl(url) {
		if (!url) return;
		try {
			const res = await fetch(url);
			const obj = await res.json();
			this.#dialog().openWith(obj, { type: 'url', url });
		} catch { this.#dialog().openWith({}, { type: 'url', url }); }
	}
```

Add an export button to each custom-menu row. Find `#renderMenuRow` and add, in the `.menu-buttons` group and only for custom menus (`m.isCustom`), a button:

```js
					<button class="menu-btn" title=${i18n.getMessage('exchangeExport')}
						@click=${(e) => { e.stopPropagation(); this.#exportMenu(m); }}>${icon('upload')}</button>
```

Add the export method:

```js
	#exportMenu(m) {
		const out = window.FlowMouseMenuExchange.menuToExchange(m.def, {
			id: (m.def.source && m.def.source.indexId) || m.id,
			version: (m.def.source && m.def.source.version) || '1.0.0',
		});
		downloadJson(out, `${m.id}.gestura-menu.json`);
	}
```

Add minimal CSS for the import bar to `static styles`:

```css
				.import-bar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
				.import-url { flex: 1; min-width: 160px; font: inherit; font-size: 12px; padding: 5px 8px;
					border: 1px solid var(--border-color); border-radius: 6px; background: var(--card-bg); color: inherit; }
```

- [ ] **Step 2: Add import bar + export to engine-manager**

In `js/components/engine-manager.js`, apply the same pattern:
- add the `downloadJson` helper (module scope),
- add an `.import-bar` block with `<menu-import-dialog>` to `render()`,
- add `#dialog()`, `#importFile()`, `#importUrl(url)` (identical to Task 8 Step 1),
- add an export button to each **custom** engine row (custom engines have `builtin === false`):

```js
					<button class="engine-btn" title=${i18n.getMessage('exchangeExport')}
						@click=${(e) => { e.stopPropagation(); this.#exportEngine(engine); }}>${icon('upload')}</button>
```

- add the export method:

```js
	#exportEngine(engine) {
		const out = window.FlowMouseMenuExchange.engineToExchange(engine, {
			id: (engine.source && engine.source.indexId) || engine.id,
			version: (engine.source && engine.source.version) || '1.0.0',
		});
		downloadJson(out, `${engine.id}.gestura-engine.json`);
	}
```

(Use the same `.import-bar`/`.import-url` CSS and the existing `icon` import already present at the top of engine-manager.)

- [ ] **Step 3: Verify manually**

1. Reload the extension. Open options → **Search engines**: create a custom engine, click its export button → a `*.gestura-engine.json` downloads.
2. Click **Import from file…**, choose that file → preview dialog → **Add to Gestura** → a second identical engine appears.
3. Options → **Website menus**: create a custom menu, export it, re-import via file → new menu appears in the list.
4. Paste the URL of a hosted menu JSON into the URL field, press Enter → preview appears. (Test URL can be a `raw` gist of a valid menu.)

- [ ] **Step 4: Commit**

```bash
git add js/components/site-menu-manager.js js/components/engine-manager.js
git commit -m "feat(exchange): file/URL import + export buttons in menu & engine managers"
```

---

## Task 9: Betreiber-Button — Content-Script-Erkennung, Background-Fetch, Options-Übergabe

**Files:**
- Modify: `js/content.js`
- Modify: `js/background.js`
- Modify: `js/components/options-page.js`

**Interfaces:**
- Content → Background: `chrome.runtime.sendMessage({ action: 'importFromSite', url })`.
- Background: fetch(url) (host permission `<all_urls>` vorhanden), speichert `{ url, json }` in `chrome.storage.session` unter `pendingImport`, öffnet die Options-Seite.
- Options-Seite: liest beim Laden `pendingImport`, löscht ihn, öffnet `<menu-import-dialog>`.

**Verification:** manuell.

- [ ] **Step 1: Detect operator-button clicks in the content script**

In `js/content.js`, add a trusted-click listener. Place it inside the existing top-level content bootstrap (after `window.ContentI18n` is defined, module scope), using a capturing listener that only reacts to real clicks:

```js
	// Betreiber-Button: <a rel="gestura-menu" href="…same-origin….json">.
	// Nur echte Klicks; nur same-origin (verhindert untergeschobene Menüs für
	// fremde Sites). Content-Script validiert NICHT — das macht die Options-Seite.
	document.addEventListener('click', (e) => {
		if (!e.isTrusted) return;
		const a = e.target && e.target.closest && e.target.closest('a[rel~="gestura-menu"]');
		if (!a || !a.href) return;
		let url;
		try { url = new URL(a.href, location.href); } catch { return; }
		if (url.origin !== location.origin) return;   // same-origin only
		e.preventDefault();
		e.stopPropagation();
		try { chrome.runtime.sendMessage({ action: 'importFromSite', url: url.href }); } catch {}
	}, true);
```

- [ ] **Step 2: Handle the message in the background**

In `js/background.js`, inside `handleAction(request, sender)` add a case (near other `chrome.tabs`-using actions):

```js
			case 'importFromSite': {
				try {
					const res = await fetch(request.url);
					const text = await res.text();
					if (text.length > 200 * 1024) return { ok: false };
					const json = JSON.parse(text);
					await chrome.storage.session.set({ pendingImport: { url: request.url, json } });
					await chrome.runtime.openOptionsPage();
					return { ok: true };
				} catch (err) {
					return { ok: false, error: String(err && err.message || err) };
				}
			}
```

(If `handleAction`'s dispatch requires listing the action, add `'importFromSite'` where content-originating actions are registered. Verify by searching `background.js` for how existing `case`s are reached; most run directly through the `switch`.)

- [ ] **Step 3: Pick up the pending import on the options page**

In `js/components/options-page.js`, in `connectedCallback()` (or the existing first-update lifecycle), add:

```js
		this.#checkPendingImport();
```

And add the method:

```js
	async #checkPendingImport() {
		let data;
		try { data = (await chrome.storage.session.get('pendingImport')).pendingImport; } catch { return; }
		if (!data) return;
		try { await chrome.storage.session.remove('pendingImport'); } catch {}
		await this.updateComplete;
		let dialog = this.renderRoot.querySelector('menu-import-dialog');
		if (!dialog) {
			dialog = document.createElement('menu-import-dialog');
			this.renderRoot.appendChild(dialog);
		}
		dialog.openWith(data.json, { type: 'site', url: data.url });
	}
```

- [ ] **Step 4: Verify manually**

1. Reload the extension.
2. Create a local test page served from any origin (e.g. a `file://` won't share origin with an http json; use a simple local server or a gist page). Minimal HTML on origin `X` with a same-origin `menu.json`:

```html
<a rel="gestura-menu" href="/menu.json">Add menu to Gestura</a>
```

`menu.json` = a valid `gesturaMenu` document.

3. Click the link → the options page opens with the import preview dialog. Confirm → the menu is added.
4. Cross-origin check: point `href` to a different origin's JSON → clicking does nothing (same-origin guard).

- [ ] **Step 5: Commit**

```bash
git add js/content.js js/background.js js/components/options-page.js
git commit -m "feat(exchange): operator-button import (same-origin) via background + options handoff"
```

---

## Task 10: Gesamtlauf & Aufräumen

**Files:** none (verification task)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all suites pass, including the three new files (`menu-exchange`, `exchange-schema`, `menu-exchange-locales`) and the existing suites unchanged.

- [ ] **Step 2: Manual smoke test across surfaces**

1. Reload extension. In options, export a custom menu and a custom engine; re-import both via file and via URL; import an engine **with** transform and confirm the warning + Chrome-only note + gated confirm.
2. Operator-button flow end-to-end (Task 9 Step 4).
3. In Firefox (if available): import a transform engine without `transformRequired` → it imports without the script; with `transformRequired: true` → confirm the "requires script, Chrome-only" wording shows.

- [ ] **Step 3: Changelog**

Add an entry to `CHANGELOG.md` under a new version heading (bump `version` in `manifest.json` per CLAUDE.md; do **not** touch `version_name` — the clean filter owns it):

```markdown
## <next-version>
- Menus and search engines can now be exported to a portable `.gestura-*.json` file and imported from a file, a URL, or a website's "Add to Gestura" button. Imported engines that run a JavaScript transform show a security warning with the code and a Chrome-only note before import.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md manifest.json
git commit -m "docs(changelog): menu/engine import & export (Gestura-Index phase 1)"
```

---

## Self-Review (durchgeführt)

**Spec-Abdeckung (Phase 1):**
- Austauschformat `gesturaMenu` + `gesturaEngine` → Tasks 1, 2. ✔
- Validator als Pure-Funktion (`js/menu-exchange.js`) → Tasks 1–4. ✔
- JSON-Schema-Vertragsdatei → Task 5. ✔
- Import-Mapping / Export → Tasks 3, 4, 8. ✔
- Betreiber-Button (`rel="gestura-menu"`, Same-Origin) → Task 9. ✔
- Import per Datei & URL → Task 8. ✔
- Import-Vorschau (Lit) inkl. Transform-Warnung + Chrome-only → Task 7. ✔
- en/de + alle Locales für neue Strings → Task 6. ✔
- vitest-Tests → Tasks 1–6, 10. ✔
- Update-Check/Diff bewusst **nicht** enthalten (laut Spec Phase 2). ✔

**Typ-Konsistenz:** `FlowMouseMenuExchange`-API (`validate`, `detectType`, `isHttpsUrl`, `pickLabel`, `hasTransform`, `toCustomMenu`, `toCustomEngine`, `menuToExchange`, `engineToExchange`, `newId`, Konstanten) über alle Tasks einheitlich benannt; `import-done`-Event konsistent zwischen Task 7 (dispatch) und Task 8 (listener). ✔

**Platzhalter:** keine offenen TODO/TBD; jeder Code-Schritt zeigt vollständigen Code. ✔

**Bewusste Grenzen:**
- Aktions-Whitelist (`ALLOWED_MENU_ITEM_ACTIONS`) ist konservativ dupliziert (nicht aus `constants.js` importiert, da Pure-Datei) — Kommentar mahnt die Synchronhaltung an.
- Lit-Komponenten (Tasks 7–9) werden manuell verifiziert; das Repo hat keine Komponententest-Infrastruktur und wir führen dafür bewusst kein neues Dependency ein. Die Kernlogik ist in den Pure-Funktionen (Tasks 1–5) testabgedeckt.
