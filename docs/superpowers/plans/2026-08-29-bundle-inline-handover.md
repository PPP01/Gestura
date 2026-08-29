# Bundle-Import & Inline-Übergabe – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Extension kann ein `{ gesturaBundle: 1, entries: [...] }` entgegennehmen, jeden Eintrag einzeln prüfen, in einer Sammel-Vorschau zur Auswahl stellen und in einem Schreibvorgang importieren — übergeben von einer Betreiber-Seite über einen Inline-Kanal, ohne dass die Extension selbst etwas fetcht.

**Architecture:** Vier Bausteine, die aufeinander aufbauen. (1) Das Austauschformat lernt einen Bundle-Wrapper — Schema und Laufzeit-Konstanten wandern gemeinsam, weil ein Test auf Drift prüft. (2) `menu-exchange.js` bekommt `validateBundle()`, das jeden Eintrag durch das bestehende `validate()` schickt und Teil-Ergebnisse zurückgibt statt beim ersten Fehler abzubrechen. (3) `<menu-import-dialog>` bekommt neben dem heutigen Einzelmodus einen Bundle-Modus mit einer Zeile je Eintrag. (4) Ein neuer Zweig im Betreiber-Button-Kanal nimmt das JSON als String direkt von der Seite entgegen, statt es von einer URL zu holen.

**Tech Stack:** Reines ES5/ES2020-JavaScript ohne Build-Schritt. Content-Skripte reden über `window.*`-Globals, UI-Komponenten sind Lit-ES-Module (`js/lib/lit-all.min.js`, lokal vendored). Tests: vitest im **Node**-Environment (kein jsdom, keine DOM-Globals — Lit-Komponenten und Content-Skripte sind damit **nicht** automatisiert testbar; deren Abnahme ist manuell und in den jeweiligen Tasks ausformuliert).

**Spec:** [`docs/superpowers/specs/2026-08-29-bundle-inline-handover-design.md`](../specs/2026-08-29-bundle-inline-handover-design.md)

## Global Constraints

- **Branch:** `main`. Nicht auf `firefox-build` arbeiten. Falls das Repo dort steht: `git checkout -f main` (das `-f` ist nötig, weil der `version_name`-Stempel in `manifest.json` den normalen Checkout blockiert — siehe `CLAUDE.md`).
- **Kein Build-Schritt.** Das Repo-Root *ist* die entpackte Extension. Keine Bundler, keine Transpiler, keine neuen Laufzeit-Abhängigkeiten.
- **Einrückung ist durchgehend TAB**, in allen Dateien, auch in JSON.
- **Interne `FlowMouse*`-Bezeichner bleiben unangetastet** (`window.FlowMouseMenuExchange` usw.). Nicht "aufräumen" — sie halten Upstream-Rebases billig.
- **`manifest.json`: nur `version` anfassen, niemals `version_name`.** Der wird von einem Git-Clean-Filter erzeugt. Ein `M manifest.json` im Status nach einem Commit ist der Stempel des post-commit-Hooks und **keine** offene Änderung.
- **Niemals ein undeklariertes `$WORD$` in eine `messages.json`.** `chrome.i18n` liest es als Platzhalter und die Extension lädt dann gar nicht mehr. Platzhalter sind `{token}` plus `.replace()`. `tests/locale-placeholders.test.mjs` bewacht das.
- **Neue `exchange*`-Keys müssen in alle 39 Locales**, nicht nur nach `en`. Der `en`-Fallback genügt nicht. `tests/menu-exchange-locales.test.mjs` erzwingt es.
- **Kommentare und Commit-Messages auf Deutsch**, passend zum Bestand in `js/menu-exchange.js`. Vorhandene englische Kommentare (z. B. in `js/content.js`, `js/background.js`) bleiben englisch — dort wird im Stil der Datei weitergeschrieben.
- **Testlauf:** `npm test` (vitest, aktuell 17 Suites). Einzelne Datei: `npx vitest run tests/<name>.test.mjs`.
- **Der bestehende `href`-Pfad des Betreiber-Buttons ist tabu.** `a[rel~="gestura-menu"]` in `js/content.js` und die Origin-Prüfung in `importFromSite` bleiben Zeile für Zeile unverändert. Ein Diff, der sie berührt, ist ein Fehler.

## File Structure

| Datei | Rolle | Tasks |
| --- | --- | --- |
| `js/exchange-schema.json` | Format-Vertrag (auch für das Index-Backend). Bekommt `$defs.bundle`. | 1 |
| `js/menu-exchange.js` | Autoritativer Laufzeit-Validator, reine Funktionen, keine `chrome.*`. Bekommt `validateBundle`. | 1, 2 |
| `js/components/menu-import-dialog.js` | Lit-Dialog für **alle** Import-Wege. Wird in Einzel- und Bundle-Modus geteilt. | 3, 4 |
| `js/content.js` | Content-Skript. Der Operator-Button-Block (Zeilen 56–86) bekommt einen zweiten Zweig. | 6 |
| `js/background.js` | Service Worker. Neuer `importInline`-Case, gemeinsamer `stashPendingImport`-Helfer. | 6 |
| `_locales/<39>/messages.json` | i18n-Kataloge. Sechs neue `exchangeBundle*`-Keys. | 5 |
| `tests/menu-exchange-bundle.test.mjs` | **Neu.** Deckt `validateBundle` und die `validate()`-Ablehnung ab. | 2 |
| `tests/exchange-schema.test.mjs` | Drift-Prüfung Schema ↔ Konstanten. Bekommt einen Bundle-Fall. | 1 |
| `tests/menu-exchange-locales.test.mjs` | Locale-Vollständigkeit. `EXCHANGE_KEYS` wächst um sechs Einträge. | 5 |
| `README.md`, `CHANGELOG.md` | Öffentlicher Vertrag und Release-Notiz. | 7 |

`js/components/options-page.js` wird **nicht** angefasst: `#checkPendingImport` reicht `pending.json` unverändert an den Dialog, die Verzweigung passiert dort.

---

### Task 1: Bundle-Typ im Schema und in den Konstanten

Schema und Laufzeit-Konstanten müssen im selben Commit wandern, weil `tests/exchange-schema.test.mjs` prüft, dass `x-gestura.types` und `x-gestura.limits` **deep-equal** zu `FORMAT_TYPES` und `LIMITS` sind. Wer nur eine der beiden Dateien anfasst, bricht den Testlauf.

**Files:**
- Modify: `js/menu-exchange.js:7` (`FORMAT_TYPES`), `js/menu-exchange.js:21-25` (`LIMITS`)
- Modify: `js/exchange-schema.json` (`description`, `x-gestura.types`, `x-gestura.limits`, `oneOf`, `$defs`)
- Test: `tests/exchange-schema.test.mjs`

**Interfaces:**
- Consumes: nichts.
- Produces: `X.FORMAT_TYPES.bundle === 'gesturaBundle'`, `X.LIMITS.bundleEntriesMax === 200`, `X.LIMITS.bundleBlobMax === 1048576`. Task 2 und Task 6 hängen an diesen Werten.

- [ ] **Step 1: Write the failing test**

An `tests/exchange-schema.test.mjs` anhängen, innerhalb des bestehenden `describe('exchange-schema.json', …)`-Blocks:

```js
	it('declares the bundle wrapper', () => {
		expect(schema['x-gestura'].types.bundle).toBe('gesturaBundle');
		expect(schema.$defs.bundle).toBeTruthy();
		expect(schema.$defs.bundle.properties.gesturaBundle.const).toBe(X.CURRENT_FORMAT_VERSION);
		expect(schema.$defs.bundle.properties.entries.maxItems).toBe(X.LIMITS.bundleEntriesMax);
		expect(schema.oneOf).toContainEqual({ $ref: '#/$defs/bundle' });
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/exchange-schema.test.mjs`
Expected: FAIL — `expected undefined to be 'gesturaBundle'` im neuen Test.

- [ ] **Step 3: Erweitere die Konstanten in `js/menu-exchange.js`**

`FORMAT_TYPES` (Zeile 7):

```js
	const FORMAT_TYPES = { menu: 'gesturaMenu', engine: 'gesturaEngine', bundle: 'gesturaBundle' };
```

`LIMITS` (Zeilen 21–25) — die beiden neuen Werte ans Ende, mit Kommentar:

```js
	const LIMITS = {
		idMax: 128, nameMax: 200, descMax: 2000, iconMax: 64,
		urlMax: 2000, patternMax: 200, patternsMax: 50,
		itemsMax: 100, blobMax: 100 * 1024, transformCodeMax: 10 * 1024,
		// Bundle-Wrapper: Deckel für das Gesamtpaket auf dem Übergabeweg. Die
		// Per-Eintrag-Kappe bleibt blobMax. bundleEntriesMax ist deckungsgleich
		// mit dem 200-ID-Cap des Index-Backends (BundleController::MAX_IDS).
		bundleEntriesMax: 200, bundleBlobMax: 1024 * 1024,
	};
```

- [ ] **Step 4: Erweitere `js/exchange-schema.json`**

`x-gestura.types` und `x-gestura.limits` müssen exakt die Werte aus Step 3 spiegeln (`1024 * 1024` = `1048576`):

```json
		"types": { "menu": "gesturaMenu", "engine": "gesturaEngine", "bundle": "gesturaBundle" },
```

```json
		"limits": {
			"idMax": 128, "nameMax": 200, "descMax": 2000, "iconMax": 64,
			"urlMax": 2000, "patternMax": 200, "patternsMax": 50,
			"itemsMax": 100, "blobMax": 102400, "transformCodeMax": 10240,
			"bundleEntriesMax": 200, "bundleBlobMax": 1048576
		}
```

Das Top-Level-`oneOf` um den Bundle-Verweis ergänzen:

```json
	"oneOf": [{ "$ref": "#/$defs/menu" }, { "$ref": "#/$defs/engine" }, { "$ref": "#/$defs/bundle" }],
```

Und `$defs` um den Wrapper erweitern (direkt nach `"engine": { … }` einfügen, als letzter Eintrag von `$defs`):

```json
		"bundle": {
			"type": "object",
			"required": ["gesturaBundle", "entries"],
			"properties": {
				"gesturaBundle": { "const": 1 },
				"entries": {
					"type": "array", "minItems": 1, "maxItems": 200,
					"items": { "oneOf": [{ "$ref": "#/$defs/menu" }, { "$ref": "#/$defs/engine" }] }
				}
			}
		}
```

Zuletzt den `description`-Text der Schema-Datei um einen Satz ergänzen, damit das Index-Backend die Semantik mitliest. Der bestehende Text endet mit `… or an https url.` — direkt anhängen:

```
 A gesturaBundle wraps entries that are each exactly one of the single formats; the runtime validates every entry on its own, so a broken entry does not invalidate the bundle.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/exchange-schema.test.mjs`
Expected: PASS — insbesondere der bestehende Drift-Test `x-gestura metadata matches menu-exchange constants (no drift)`.

Run: `npm test`
Expected: PASS, alle Suites. (Kein bestehender Test kennt `gesturaBundle`, `detectType` ändert sich in dieser Task noch nicht.)

- [ ] **Step 6: Commit**

```bash
git add js/menu-exchange.js js/exchange-schema.json tests/exchange-schema.test.mjs
git commit -m "feat(exchange): Bundle-Wrapper im Format-Vertrag verankern"
```

---

### Task 2: `validateBundle` und die Ablehnung von Bundles in `validate()`

`detectType()` lernt `'bundle'`. Das legt eine stille Falle: `validate()` verzweigt heute auf `'menu'` bzw. `'engine'` und sammelt sonst **nichts** — ein Bundle liefe ohne einen einzigen Check durch und käme mit `errors: []` als `ok: true` heraus. Die explizite Ablehnung ist deshalb Pflicht, nicht Kosmetik, und bekommt einen eigenen Test.

**Files:**
- Modify: `js/menu-exchange.js:30-35` (`detectType`), `js/menu-exchange.js:125-134` (`validate`), Export-Objekt am Dateiende
- Create: `tests/menu-exchange-bundle.test.mjs`

**Interfaces:**
- Consumes: `X.FORMAT_TYPES.bundle`, `X.LIMITS.bundleEntriesMax`, `X.LIMITS.bundleBlobMax` aus Task 1.
- Produces:
  - `X.detectType(obj) → 'menu' | 'engine' | 'bundle' | null`
  - `X.validate(obj) → { ok, type, errors, value }` — bei einem Bundle jetzt `{ ok: false, type: 'bundle', errors: ['notSingleFormat'], value: null }`
  - `X.validateBundle(obj) → { ok: boolean, type: 'bundle', errors: string[], entries: Array }`, wobei `entries[i]` **exakt** ein `validate()`-Ergebnis ist. `ok` beschreibt nur den Wrapper; ist er kaputt, ist `entries` leer.
  - Wrapper-Fehlercodes: `notGesturaFormat`, `unsupportedFormatVersion`, `entries`, `tooManyEntries`, `tooLarge`.

  Task 4 baut die Dialog-Zeilen aus `entries[i].ok`, `entries[i].type`, `entries[i].value` und `entries[i].errors`.

- [ ] **Step 1: Write the failing test**

Neue Datei `tests/menu-exchange-bundle.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import '../js/menu-exchange.js';
const X = globalThis.FlowMouseMenuExchange;

const validMenu = () => ({
	gesturaMenu: 1,
	id: 'com.example.shop',
	version: '1.0.0',
	name: { en: 'Shop', de: 'Laden' },
	items: [
		{ id: 'orders', label: { en: 'Orders' }, action: 'openCustomUrl', customUrl: 'https://example.com/orders' },
	],
});

const validEngine = () => ({
	gesturaEngine: 1,
	id: 'com.example.search',
	version: '2.1.0',
	name: 'Example Search',
	url: 'https://example.com/s?q=%s',
});

// Ein Menü, dessen Item-URL nicht https ist: scheitert an genau einem Feld.
const brokenMenu = () => ({
	...validMenu(),
	id: 'com.example.broken',
	items: [
		{ id: 'x', label: { en: 'X' }, action: 'openCustomUrl', customUrl: 'http://example.com/x' },
	],
});

const bundle = (...entries) => ({ gesturaBundle: 1, entries });

describe('detectType(bundle)', () => {
	it('detects a bundle wrapper', () => {
		expect(X.detectType({ gesturaBundle: 1 })).toBe('bundle');
	});
});

describe('validate() rejects bundles', () => {
	it('never lets a bundle through as a single format', () => {
		const r = X.validate(bundle(validMenu()));
		expect(r.ok).toBe(false);
		expect(r.type).toBe('bundle');
		expect(r.errors).toEqual(['notSingleFormat']);
		expect(r.value).toBe(null);
	});
});

describe('validateBundle', () => {
	it('accepts a mixed bundle and validates every entry on its own', () => {
		const r = X.validateBundle(bundle(validMenu(), validEngine()));
		expect(r.ok).toBe(true);
		expect(r.type).toBe('bundle');
		expect(r.errors).toEqual([]);
		expect(r.entries).toHaveLength(2);
		expect(r.entries[0].ok).toBe(true);
		expect(r.entries[0].type).toBe('menu');
		expect(r.entries[0].value.id).toBe('com.example.shop');
		expect(r.entries[1].ok).toBe(true);
		expect(r.entries[1].type).toBe('engine');
	});

	it('reports a broken entry without blocking the others', () => {
		const r = X.validateBundle(bundle(validMenu(), brokenMenu(), validEngine()));
		expect(r.ok).toBe(true);
		expect(r.entries.map(e => e.ok)).toEqual([true, false, true]);
		expect(r.entries[1].errors).toContain('itemUrl');
		expect(r.entries[1].value).toBe(null);
	});

	it('preserves the order of entries', () => {
		const r = X.validateBundle(bundle(validEngine(), validMenu()));
		expect(r.entries.map(e => e.type)).toEqual(['engine', 'menu']);
	});

	it('rejects anything that is not a bundle', () => {
		expect(X.validateBundle(validMenu()).errors).toEqual(['notGesturaFormat']);
		expect(X.validateBundle(null).errors).toEqual(['notGesturaFormat']);
		expect(X.validateBundle({}).errors).toEqual(['notGesturaFormat']);
	});

	it('rejects an unsupported wrapper version', () => {
		const r = X.validateBundle({ gesturaBundle: 2, entries: [validMenu()] });
		expect(r.ok).toBe(false);
		expect(r.errors).toEqual(['unsupportedFormatVersion']);
	});

	it('rejects a missing, non-array or empty entries list', () => {
		expect(X.validateBundle({ gesturaBundle: 1 }).errors).toEqual(['entries']);
		expect(X.validateBundle({ gesturaBundle: 1, entries: {} }).errors).toEqual(['entries']);
		expect(X.validateBundle(bundle()).errors).toEqual(['entries']);
	});

	it('rejects more entries than bundleEntriesMax', () => {
		const many = Array.from({ length: X.LIMITS.bundleEntriesMax + 1 }, validEngine);
		const r = X.validateBundle({ gesturaBundle: 1, entries: many });
		expect(r.ok).toBe(false);
		expect(r.errors).toEqual(['tooManyEntries']);
		expect(r.entries).toEqual([]);
	});

	it('rejects a bundle over bundleBlobMax before looking at entries', () => {
		const fat = { ...validEngine(), suffix: 'x' };
		const entries = Array.from({ length: 120 }, () => ({ ...fat, transformCode: 'y'.repeat(9000), transformEnabled: true }));
		const r = X.validateBundle({ gesturaBundle: 1, entries });
		expect(r.ok).toBe(false);
		expect(r.errors).toEqual(['tooLarge']);
	});

	it('lets a single oversized entry fail on its own', () => {
		const huge = { ...validMenu(), id: 'com.example.huge', description: { en: 'z'.repeat(1999) } };
		huge.items = Array.from({ length: 100 }, (_, i) => ({
			id: 'i' + i, label: { en: 'q'.repeat(199) }, action: 'openCustomUrl',
			customUrl: 'https://example.com/' + 'p'.repeat(900),
		}));
		const r = X.validateBundle(bundle(huge, validEngine()));
		expect(r.ok).toBe(true);
		expect(r.entries[0].ok).toBe(false);
		expect(r.entries[0].errors).toContain('tooLarge');
		expect(r.entries[1].ok).toBe(true);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/menu-exchange-bundle.test.mjs`
Expected: FAIL — `X.validateBundle is not a function`, und `detectType({gesturaBundle:1})` liefert `null`.

- [ ] **Step 3: `detectType` um den Bundle-Fall erweitern**

`js/menu-exchange.js`, Zeilen 30–35:

```js
	function detectType(obj) {
		if (!obj || typeof obj !== 'object') return null;
		if (typeof obj[FORMAT_TYPES.menu] === 'number') return 'menu';
		if (typeof obj[FORMAT_TYPES.engine] === 'number') return 'engine';
		if (typeof obj[FORMAT_TYPES.bundle] === 'number') return 'bundle';
		return null;
	}
```

- [ ] **Step 4: `validate()` Bundles explizit ablehnen lassen**

`js/menu-exchange.js`, Zeilen 125–134. Die neue Zeile steht **vor** der Größenprüfung:

```js
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
```

- [ ] **Step 5: `validateBundle` schreiben**

Direkt nach `validate()` einfügen:

```js
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
```

`list.map((e) => validate(e))` statt `list.map(validate)` — `Array.prototype.map` reicht Index und Array als zweites und drittes Argument durch, und `validate` soll nur das Element sehen.

- [ ] **Step 6: `validateBundle` exportieren**

Im `api`-Objekt am Dateiende, hinter `validate`:

```js
		detectType, isHttpsUrl, pickLabel, validate, validateBundle, hasTransform,
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/menu-exchange-bundle.test.mjs`
Expected: PASS, alle 10 Tests.

Run: `npm test`
Expected: PASS, jetzt 18 Suites. Besonders `tests/menu-exchange.test.mjs` muss grün bleiben — der `validate()`-Vertrag für Einzelformate hat sich nicht geändert.

- [ ] **Step 8: Commit**

```bash
git add js/menu-exchange.js tests/menu-exchange-bundle.test.mjs
git commit -m "feat(exchange): validateBundle prüft jeden Eintrag einzeln"
```

---

### Task 3: Dialog-Refactor ohne Verhaltensänderung

Der Bundle-Modus braucht die Vorschau-Bausteine **ohne** den Dialog-Footer und die Schreiblogik **ohne** das direkte `settingsStore.save()`. Beides wird hier herausgelöst. Diese Task ändert kein Verhalten — sie ist der Vorbau für Task 4.

Es gibt kein jsdom im Testsetup, also keinen automatisierten Test für diese Datei. Die Absicherung ist: `npm test` bleibt grün (keine Suite berührt die Datei) **plus** eine manuelle Rauchprobe, dass der Einzel-Import sich exakt wie vorher verhält.

**Files:**
- Modify: `js/components/menu-import-dialog.js`

**Interfaces:**
- Consumes: `X.validate`, `X.toStandardMenu`, `X.toCustomMenu`, `X.toEngineOverride`, `X.toCustomEngine`, `X.hasTransform`, `X.pickLabel` (alle bestehend).
- Produces, für Task 4:
  - `#renderMenuBody(v, i18n)` → `TemplateResult` — Kind-Label, Name, Item-Liste. Kein Footer.
  - `#renderEngineBody(v, i18n, ack, onAck)` → `TemplateResult` — Kind-Label, Name mit Favicon, URL, und bei `X().hasTransform(v)` den Warnblock samt Bestätigungs-Checkbox. `ack: boolean`, `onAck: (checked: boolean) => void`.
  - `#renderModeChoice(i18n, match, type, mode, onMode)` → `TemplateResult` — leer, wenn `match` falsy. `mode: 'replace' | 'new'`, `onMode: (mode: string) => void`.
  - `#applyMenu(cur, result, source, lang, mode, matchId)` → nächstes `siteMenus`-Objekt. Rein, schreibt nichts.
  - `#applyEngine(cur, result, source, lang, mode, matchId)` → nächstes `searchEngines`-Objekt. Rein, schreibt nichts.
  - Modul-Konstanten `EMPTY_SITE_MENUS`, `EMPTY_ENGINES`.

- [ ] **Step 1: Leerwerte als Modul-Konstanten herausziehen**

Die heute in `#confirm()` inline stehenden Defaults nach oben, direkt unter `const isFirefox = …`:

```js
// Leerzustände, falls die Einstellungen die Zweige noch nicht kennen. Als
// Konstanten, weil Einzel- und Sammel-Import beide darauf zurückfallen.
const EMPTY_SITE_MENUS = { disabled: [], edited: {}, custom: {}, domains: {}, order: [], flags: {}, defaultMenuId: 'search' };
const EMPTY_ENGINES = { overrides: {}, hidden: [], custom: [], order: [] };
```

- [ ] **Step 2: Die beiden reinen Settings-Transformationen anlegen**

Neue Methoden, direkt vor `#confirm()`:

```js
	// Reine Transformation: nimmt den aktuellen siteMenus-Zustand und gibt den
	// nächsten zurück, ohne zu speichern. Einzel- und Sammel-Import gehen beide
	// hierdurch, damit sie garantiert dasselbe schreiben.
	#applyMenu(cur, result, source, lang, mode, matchId) {
		if (mode === 'replace' && matchId) {
			// Standard-Menü ersetzen → verhält sich wie ein bearbeitetes Katalog-Menü.
			const def = X().toStandardMenu(result.value, lang);
			return { ...cur, edited: { ...cur.edited, [matchId]: def } };
		}
		const { id, def } = X().toCustomMenu(result.value, source, undefined, lang);
		return { ...cur, custom: { ...cur.custom, [id]: def }, order: [...(cur.order || []), id] };
	}

	// Wie #applyMenu, für searchEngines. Die Firefox-Sonderbehandlung sitzt hier,
	// damit sie auf beiden Wegen greift: dort laufen Transform-Skripte nicht,
	// also wird das Skript beim Import entfernt — außer die Engine besteht darauf.
	#applyEngine(cur, result, source, lang, mode, matchId) {
		const strip = (e) => {
			if (isFirefox && !result.value.transformRequired) { e.transformEnabled = false; e.transformCode = ''; }
			return e;
		};
		if (mode === 'replace' && matchId) {
			const ov = strip(X().toEngineOverride(result.value, lang));
			return { ...cur, overrides: { ...cur.overrides, [matchId]: ov } };
		}
		const engine = strip(X().toCustomEngine(result.value, source, undefined, lang));
		return { ...cur, custom: [...(cur.custom || []), engine] };
	}
```

- [ ] **Step 3: `#confirm()` auf die Helfer umstellen**

Der Rumpf ersetzt die beiden `if (r.type === 'menu') { … } else { … }`-Zweige vollständig:

```js
	async #confirm() {
		const r = this._result;
		if (!r || !r.ok) return;
		const source = { ...this._source, version: r.value.version || '1.0.0' };
		const lang = this.#lang();
		const mode = this._catalogMatch ? this._importMode : 'new';
		const matchId = this._catalogMatch ? this._catalogMatch.id : null;
		const patch = r.type === 'menu'
			? { siteMenus: this.#applyMenu(settingsStore.current.siteMenus || EMPTY_SITE_MENUS, r, source, lang, mode, matchId) }
			: { searchEngines: this.#applyEngine(settingsStore.current.searchEngines || EMPTY_ENGINES, r, source, lang, mode, matchId) };
		const ok = await settingsStore.save(patch);
		if (!ok) { alert(window.i18n.getMessage('menuSyncSaveError')); return; }
		window.dispatchEvent(new Event('action-catalog-changed'));
		this.dispatchEvent(new CustomEvent('import-done', { detail: { type: r.type }, bubbles: true, composed: true }));
		this.#close();
	}
```

- [ ] **Step 4: `#renderModeChoice` parametrisieren**

Die Methode liest heute `this._catalogMatch` / `this._importMode` direkt. Neue Signatur:

```js
	#renderModeChoice(i18n, match, type, mode, onMode) {
		if (!match) return '';
		const name = this.#matchName(match, type, i18n);
		return html`
			<div class="mode">
				<div class="mode-label">${i18n.getMessage('exchangeImportAs')}</div>
				<label class="mode-opt">
					<input type="radio" name="importmode-${match.id}" .checked=${mode === 'replace'}
						@change=${() => onMode('replace')}>
					<span>${i18n.getMessage('exchangeReplaceStandard').replace('{name}', name)}</span>
				</label>
				<label class="mode-opt">
					<input type="radio" name="importmode-${match.id}" .checked=${mode === 'new'}
						@change=${() => onMode('new')}>
					<span>${i18n.getMessage('exchangeAddAsNew')}</span>
				</label>
			</div>`;
	}
```

Das `name`-Attribut bekommt die Match-ID angehängt: im Bundle-Modus stehen mehrere Radio-Paare gleichzeitig im DOM, und ein gemeinsamer `name` würde sie zu **einer** Gruppe verschmelzen.

- [ ] **Step 5: Vorschau-Rümpfe aus `#renderMenu` / `#renderEngine` herauslösen**

Zwei neue Methoden; die alten behalten ihre Namen und rufen sie auf:

```js
	#renderMenuBody(v, i18n) {
		const lang = this.#lang();
		return html`
			<div class="kind">${i18n.getMessage('exchangePreviewMenu')}</div>
			<div class="name">${X().pickLabel(v.name, lang)}</div>
			<div class="items">
				${v.items.map(it => it.type === 'separator'
					? html`<div class="sep"></div>`
					: html`<div class="item">
						${(it.customUrl || it.url)
							? html`<img class="favicon" src="${this.#faviconSrc(it.customUrl || it.url, X().pickLabel(it.label, lang))}" alt="">`
							: ''}
						<span>${X().pickLabel(it.label, lang) || it.action}</span>
						<span class="url">${it.customUrl || it.url || it.engineId || ''}</span>
					</div>`)}
			</div>`;
	}

	// ack/onAck statt this._scriptAck: im Bundle-Modus hat jede Zeile ihre eigene
	// Bestätigung, im Einzelmodus ist es weiterhin der Dialog-Zustand.
	#renderEngineBody(v, i18n, ack, onAck) {
		const lang = this.#lang();
		const script = X().hasTransform(v);
		return html`
			<div class="kind">${i18n.getMessage('exchangePreviewEngine')}</div>
			<div class="name-row">
				<img class="favicon" src="${this.#faviconSrc(v.url, X().pickLabel(v.name, lang))}" alt="">
				<div class="name">${X().pickLabel(v.name, lang)}</div>
			</div>
			<div class="item"><span class="url">${v.url}</span></div>
			${script ? html`
				<div class="warn">
					<h4>${i18n.getMessage('exchangeScriptWarnTitle')}</h4>
					<p>${i18n.getMessage('exchangeScriptWarnBody')}</p>
					<p>${i18n.getMessage(v.transformRequired && isFirefox ? 'exchangeScriptChromeOnlyRequired' : 'exchangeScriptChromeOnly')}</p>
					<div class="code">${v.transformCode}</div>
					<label class="ack">
						<input type="checkbox" .checked=${ack} @change=${(e) => onAck(e.target.checked)}>
						<span>${i18n.getMessage('exchangeScriptConfirm')}</span>
					</label>
				</div>` : ''}`;
	}

	#renderMenu(v, i18n) {
		return html`
			${this.#renderMenuBody(v, i18n)}
			${this.#renderModeChoice(i18n, this._catalogMatch, 'menu', this._importMode, (m) => { this._importMode = m; })}
			<div class="actions">
				<button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button>
				<button class="btn btn-primary" @click=${() => this.#confirm()}>${i18n.getMessage('exchangeConfirmImport')}</button>
			</div>`;
	}

	#renderEngine(v, i18n) {
		const script = this.#needsScriptAck;
		return html`
			${this.#renderEngineBody(v, i18n, this._scriptAck, (c) => { this._scriptAck = c; })}
			${this.#renderModeChoice(i18n, this._catalogMatch, 'engine', this._importMode, (m) => { this._importMode = m; })}
			<div class="actions">
				<button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button>
				<button class="btn btn-primary" ?disabled=${script && !this._scriptAck} @click=${() => this.#confirm()}>${i18n.getMessage('exchangeConfirmImport')}</button>
			</div>`;
	}
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS, 18 Suites — keine Suite lädt diese Datei, der Lauf muss unverändert grün sein.

- [ ] **Step 7: Manuelle Rauchprobe (Einzel-Import unverändert)**

Extension unter `chrome://extensions` neu laden (Reload-Button auf der Karte), dann die Optionsseite öffnen.

1. Menü-Manager → *Import aus Datei* mit einem `gesturaMenu`-JSON, das eine Katalog-ID trägt → die Auswahl »Standard ersetzen / Als neuen Eintrag hinzufügen« erscheint, beide Radios schalten korrekt, Import legt den Eintrag an.
2. Engine-Manager → Import einer Engine **mit** `transformEnabled` + `transformCode` → Warnblock erscheint, der Import-Button ist gesperrt, die Bestätigungs-Checkbox gibt ihn frei.
3. Ein kaputtes JSON → Fehleransicht wie zuvor.

Erwartet: kein sichtbarer Unterschied zum Verhalten vor dieser Task.

- [ ] **Step 8: Commit**

```bash
git add js/components/menu-import-dialog.js
git commit -m "refactor(import-dialog): Vorschau-Rümpfe und Schreiblogik herauslösen"
```

---

### Task 4: Bundle-Modus im Import-Dialog

**Files:**
- Modify: `js/components/menu-import-dialog.js`

**Interfaces:**
- Consumes: `X.validateBundle` (Task 2); `#renderMenuBody`, `#renderEngineBody`, `#renderModeChoice`, `#applyMenu`, `#applyEngine`, `EMPTY_SITE_MENUS`, `EMPTY_ENGINES` (Task 3); die i18n-Keys aus Task 5 (bis die gepflegt sind, zeigt `chrome.i18n.getMessage` leere Strings — die Reihenfolge ist unkritisch, die Funktion steht vorher).
- Produces: `import-done` trägt im Bundle-Fall `{ count: number }` statt `{ type }`. Beide Konsumenten (`options-page.js`, `site-menu-manager.js`, `engine-manager.js`) werten nur `requestUpdate()` aus und lesen das Detail nicht — kein Anpassungsbedarf.

- [ ] **Step 1: Zustand und Verzweigung in `openWith`**

`static properties` um den Bundle-Zustand ergänzen:

```js
		_bundle: { state: true },   // { errors: string[], rows: Row[] } | null
```

`openWith` ersetzen:

```js
	// Verzweigt auf den Formattyp: ein Bundle bekommt die Sammel-Vorschau, alles
	// andere den bisherigen Einzelpfad. Gerendert wird nie das rohe JSON, sondern
	// immer nur der normalisierte value aus der Validierung.
	openWith(rawObject, source) {
		this._source = source || { type: 'file' };
		this._scriptAck = false;
		this._result = null;
		this._bundle = null;
		this._catalogMatch = null;
		this._importMode = 'new';

		if (X().detectType(rawObject) === 'bundle') {
			const res = X().validateBundle(rawObject);
			this._bundle = {
				errors: res.errors,
				rows: res.entries.map((result) => {
					const match = result.ok ? this.#catalogMatch(result) : null;
					return { result, match, selected: result.ok, mode: match ? 'replace' : 'new', scriptAck: false, expanded: false };
				}),
			};
		} else {
			this._result = X().validate(rawObject);
			this._catalogMatch = this._result.ok ? this.#catalogMatch(this._result) : null;
			this._importMode = this._catalogMatch ? 'replace' : 'new';
		}
		this._open = true;
	}

	#catalogMatch(result) {
		return result.type === 'menu' ? this.#catalogMenuMatch(result.value) : this.#catalogEngineMatch(result.value);
	}
```

`#close()` muss den neuen Zustand mit aufräumen:

```js
	#close() { this._open = false; this._result = null; this._bundle = null; this._catalogMatch = null; }
```

- [ ] **Step 2: Styles für die Zeilenliste**

An das bestehende `css`-Literal in `static styles` anhängen:

```css
		.bsum { font-size: 12px; color: var(--text-muted); margin: 0 0 10px; display: flex;
			align-items: center; gap: 10px; }
		.bsum .spacer { flex: 1 1 auto; }
		.brow { border-top: 1px solid var(--border-color); padding: 8px 0; }
		.brow:first-of-type { border-top: none; }
		.bhead { display: flex; align-items: center; gap: 8px; font-size: 13px; }
		.bhead .grow { flex: 1 1 auto; min-width: 0; }
		.bname { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.bmeta { font-size: 11px; color: var(--text-muted); }
		.badge { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; padding: 2px 6px;
			border-radius: 999px; background: var(--bg-secondary, rgba(128,128,128,.12)); color: var(--text-muted); }
		.badge.bad { background: rgba(211,51,51,.12); color: var(--danger-color, #d33); }
		.bcaret { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 2px 6px; }
		.bbody { padding: 6px 0 2px 26px; }
		.brow.invalid .bname { color: var(--text-muted); }
		.bhint { font-size: 12px; color: var(--text-muted); margin: 8px 0 0; }
```

- [ ] **Step 3: Den Bundle-Zweig rendern**

`render()` um die Verzweigung erweitern:

```js
	render() {
		if (!this._open) return html``;
		const i18n = window.i18n;
		const r = this._result;
		return html`<div class="backdrop" @click=${(e) => { if (e.target === e.currentTarget) this.#close(); }}>
			<div class="dialog">
				<h3 class="title">${i18n.getMessage('exchangePreviewTitle')}</h3>
				${this._bundle
					? this.#renderBundle(i18n)
					: (r && r.ok ? (r.type === 'menu' ? this.#renderMenu(r.value, i18n) : this.#renderEngine(r.value, i18n)) : this.#renderError(r, i18n))}
			</div>
		</div>`;
	}
```

Und die neuen Methoden dazu:

```js
	// Auswählbar ist nur, was die Validierung überstanden hat. Ungültige Zeilen
	// bleiben sichtbar — der Nutzer soll sehen, was übersprungen wird.
	get #bundleRows() { return (this._bundle && this._bundle.rows) || []; }
	get #bundleChosen() { return this.#bundleRows.filter(r => r.selected && r.result.ok); }

	// null = importierbar, 'empty' = nichts gewählt, 'script' = eine gewählte
	// Zeile führt ein Skript aus und ist noch nicht bestätigt.
	get #bundleBlocked() {
		const chosen = this.#bundleChosen;
		if (!chosen.length) return 'empty';
		const pending = chosen.some(r => r.result.type === 'engine' && X().hasTransform(r.result.value) && !r.scriptAck);
		return pending ? 'script' : null;
	}

	#rowName(row, lang) {
		if (row.result.ok) return X().pickLabel(row.result.value.name, lang) || row.result.value.id;
		// Ungültige Einträge tragen keinen geprüften Namen, und ungeprüftes JSON
		// wird bewusst nie gerendert. Die Zeile trägt Typ-Label und Fehler-Badge.
		return '';
	}

	#renderBundle(i18n) {
		const rows = this.#bundleRows;
		if (this._bundle.errors.length || !rows.length) {
			// Wrapper kaputt (kein Bundle, falsche Version, zu groß, zu viele
			// Einträge): es gibt keine Zeilen, also die bestehende Fehleransicht.
			// #renderError liest nur r.errors und kommt ohne ok/type/value aus.
			return this.#renderError({ errors: this._bundle.errors }, i18n);
		}
		const lang = this.#lang();
		const valid = rows.filter(r => r.result.ok).length;
		if (!valid) {
			return html`
				<p class="err">${i18n.getMessage('exchangeBundleEmpty')}</p>
				<div class="actions"><button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button></div>`;
		}
		const blocked = this.#bundleBlocked;
		const allOn = this.#bundleChosen.length === valid;
		return html`
			<div class="bsum">
				<span>${i18n.getMessage('exchangeBundleSummary').replace('{count}', rows.length).replace('{valid}', valid)}</span>
				<span class="spacer"></span>
				<label class="mode-opt">
					<input type="checkbox" .checked=${allOn}
						@change=${(e) => { for (const r of rows) { if (r.result.ok) r.selected = e.target.checked; } this.requestUpdate(); }}>
					<span>${i18n.getMessage('exchangeBundleSelectAll')}</span>
				</label>
			</div>
			${rows.map(row => this.#renderBundleRow(row, i18n, lang))}
			${blocked === 'script' ? html`<p class="bhint">${i18n.getMessage('exchangeBundleScriptPending')}</p>` : ''}
			<div class="actions">
				<button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button>
				<button class="btn btn-primary" ?disabled=${!!blocked} @click=${() => this.#confirmBundle()}>
					${i18n.getMessage('exchangeBundleImport').replace('{count}', this.#bundleChosen.length)}
				</button>
			</div>`;
	}

	#renderBundleRow(row, i18n, lang) {
		const ok = row.result.ok;
		const v = row.result.value;
		const script = ok && row.result.type === 'engine' && X().hasTransform(v);
		const firstLink = ok && row.result.type === 'menu' ? v.items.find(it => it.customUrl || it.url) : null;
		const iconUrl = !ok ? null
			: (row.result.type === 'engine' ? v.url : (firstLink ? (firstLink.customUrl || firstLink.url) : null));
		const name = this.#rowName(row, lang);
		return html`
			<div class="brow ${ok ? '' : 'invalid'}">
				<div class="bhead">
					<input type="checkbox" ?disabled=${!ok} .checked=${row.selected}
						@change=${(e) => { row.selected = e.target.checked; this.requestUpdate(); }}>
					${ok ? html`<img class="favicon" src="${this.#faviconSrc(iconUrl, name)}" alt="">` : ''}
					<span class="grow">
						<span class="bname">${name}</span>
						${row.result.type
							? html`<span class="bmeta">${i18n.getMessage(row.result.type === 'menu' ? 'exchangePreviewMenu' : 'exchangePreviewEngine')}</span>`
							: ''}
					</span>
					${script ? html`<span class="badge bad">${i18n.getMessage('exchangeScriptWarnTitle')}</span>` : ''}
					${ok ? '' : html`<span class="badge bad">${i18n.getMessage('exchangeBundleInvalid')}</span>`}
					<button class="bcaret" @click=${() => { row.expanded = !row.expanded; this.requestUpdate(); }}>
						${row.expanded ? '▾' : '▸'}
					</button>
				</div>
				${row.expanded ? html`<div class="bbody">${this.#renderBundleBody(row, i18n)}</div>` : ''}
			</div>`;
	}

	#renderBundleBody(row, i18n) {
		if (!row.result.ok) {
			return html`<p class="err">${i18n.getMessage('exchangeInvalidDetail').replace('{detail}', row.result.errors.join(', '))}</p>`;
		}
		const v = row.result.value;
		const body = row.result.type === 'menu'
			? this.#renderMenuBody(v, i18n)
			: this.#renderEngineBody(v, i18n, row.scriptAck, (c) => { row.scriptAck = c; this.requestUpdate(); });
		return html`
			${body}
			${this.#renderModeChoice(i18n, row.match, row.result.type, row.mode, (m) => { row.mode = m; this.requestUpdate(); })}`;
	}
```

`this.requestUpdate()` ist überall nötig, wo ein Feld **innerhalb** einer `row` mutiert wird: `_bundle` ist eine `state`-Property, und Lit erkennt nur die Neuzuweisung der Property selbst, nicht Änderungen tief im Objekt.

- [ ] **Step 4: Sammel-Bestätigung mit einem einzigen Speichervorgang**

```js
	// Schreibt alle gewählten Einträge in EINEM settingsStore.save(). Nicht je
	// Eintrag speichern: das wären n Sync-Schreibzugriffe und n Gelegenheiten
	// für einen Sync-Konflikt.
	async #confirmBundle() {
		const chosen = this.#bundleChosen;
		if (!chosen.length || this.#bundleBlocked) return;
		const lang = this.#lang();
		let siteMenus = settingsStore.current.siteMenus || EMPTY_SITE_MENUS;
		let engines = settingsStore.current.searchEngines || EMPTY_ENGINES;
		let touchedMenus = false;
		let touchedEngines = false;
		for (const row of chosen) {
			const source = { ...this._source, version: row.result.value.version || '1.0.0' };
			const matchId = row.match ? row.match.id : null;
			if (row.result.type === 'menu') {
				siteMenus = this.#applyMenu(siteMenus, row.result, source, lang, row.mode, matchId);
				touchedMenus = true;
			} else {
				engines = this.#applyEngine(engines, row.result, source, lang, row.mode, matchId);
				touchedEngines = true;
			}
		}
		const patch = {};
		if (touchedMenus) patch.siteMenus = siteMenus;
		if (touchedEngines) patch.searchEngines = engines;
		const ok = await settingsStore.save(patch);
		if (!ok) { alert(window.i18n.getMessage('menuSyncSaveError')); return; }
		window.dispatchEvent(new Event('action-catalog-changed'));
		this.dispatchEvent(new CustomEvent('import-done', { detail: { count: chosen.length }, bubbles: true, composed: true }));
		this.#close();
	}
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS, 18 Suites (unverändert — keine Suite lädt diese Datei).

- [ ] **Step 6: Manuelle Abnahme**

Test-Bundle als Datei anlegen und über *Import aus Datei* im Menü-Manager einspielen. **Achtung:** Alle URLs **innerhalb** der Einträge müssen `https:` sein — der Validator verlangt das unabhängig vom Übergabeweg. Ein `http://localhost/...`-Menüpunkt erscheint völlig zu Recht als ungültig.

```json
{
	"gesturaBundle": 1,
	"entries": [
		{ "gesturaMenu": 1, "id": "com.example.a", "version": "1.0.0", "name": { "en": "Alpha" },
		  "items": [{ "id": "one", "label": { "en": "One" }, "action": "openCustomUrl", "customUrl": "https://example.com/1" }] },
		{ "gesturaEngine": 1, "id": "com.example.b", "version": "1.0.0", "name": "Beta",
		  "url": "https://example.com/s?q=%s", "transformEnabled": true, "transformCode": "return input.trim();" },
		{ "gesturaMenu": 1, "id": "com.example.c", "version": "1.0.0", "name": { "en": "Gamma" },
		  "items": [{ "id": "bad", "label": { "en": "Bad" }, "action": "openCustomUrl", "customUrl": "http://example.com/x" }] }
	]
}
```

Erwartet:
1. Drei Zeilen. »Alpha« und »Beta« angehakt, »Gamma« mit `Ungültig`-Badge und **nicht** anhakbar.
2. »Beta« trägt das Skript-Badge; der Import-Button ist gesperrt und zeigt den Hinweis, bis die Bestätigung in der aufgeklappten Zeile gesetzt ist.
3. Aufklappen von »Alpha« zeigt die Item-Liste, Aufklappen von »Gamma« die Fehlerliste (`itemUrl`).
4. »Alle auswählen« schaltet nur die beiden gültigen Zeilen.
5. Import legt genau ein Menü und eine Engine an; die Optionsseite zeigt beide sofort (das `action-catalog-changed`-Event).
6. Ein zweites Bundle mit zwei Menüs, deren IDs im Katalog stehen → jede Zeile hat ihre **eigene** »Ersetzen/Neu«-Wahl; die Auswahl in Zeile 1 verstellt Zeile 2 nicht.

- [ ] **Step 7: Commit**

```bash
git add js/components/menu-import-dialog.js
git commit -m "feat(import-dialog): Sammel-Vorschau für Bundles"
```

---

### Task 5: Sechs neue i18n-Keys in 39 Locales

**Files:**
- Modify: `_locales/<lang>/messages.json` für alle 39 Sprachen: `ar bg bn cs da de el en es es_419 fa fi fil fr he hi hr hu id it ja ko ms nl no pl pt_BR pt_PT ro ru sk sr sv th tr uk vi zh_CN zh_TW`
- Modify: `tests/menu-exchange-locales.test.mjs`

**Interfaces:**
- Consumes: nichts.
- Produces: die sechs Message-Keys, die Task 4 aufruft.

- [ ] **Step 1: Write the failing test**

In `tests/menu-exchange-locales.test.mjs` die `EXCHANGE_KEYS`-Liste erweitern — die sechs neuen ans Ende:

```js
	'exchangeImportAs', 'exchangeReplaceStandard', 'exchangeAddAsNew',
	'exchangeBundleSummary', 'exchangeBundleInvalid', 'exchangeBundleSelectAll',
	'exchangeBundleImport', 'exchangeBundleScriptPending', 'exchangeBundleEmpty',
];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/menu-exchange-locales.test.mjs`
Expected: FAIL für alle 39 Sprachen, jeweils `<lang> missing: exchangeBundleSummary, exchangeBundleInvalid, …`.

- [ ] **Step 3: `en` und `de` schreiben**

Die neuen Keys direkt hinter `exchangeAddAsNew` einsortieren, damit die Datei-Reihenfolge der logischen Gruppe folgt. `_locales/en/messages.json`:

```json
	"exchangeBundleSummary": { "message": "{count} entries · {valid} selectable" },
	"exchangeBundleInvalid": { "message": "Invalid" },
	"exchangeBundleSelectAll": { "message": "Select all" },
	"exchangeBundleImport": { "message": "Add {count} to Gestura" },
	"exchangeBundleScriptPending": { "message": "Confirm the script warning above to continue." },
	"exchangeBundleEmpty": { "message": "This bundle contains no importable entries." },
```

`_locales/de/messages.json`:

```json
	"exchangeBundleSummary": { "message": "{count} Einträge · {valid} auswählbar" },
	"exchangeBundleInvalid": { "message": "Ungültig" },
	"exchangeBundleSelectAll": { "message": "Alle auswählen" },
	"exchangeBundleImport": { "message": "{count} zu Gestura hinzufügen" },
	"exchangeBundleScriptPending": { "message": "Bestätige die Skriptwarnung oben, um fortzufahren." },
	"exchangeBundleEmpty": { "message": "Dieses Bundle enthält keine importierbaren Einträge." },
```

`{count}` und `{valid}` sind **keine** `chrome.i18n`-Platzhalter, sondern werden im Dialog per `.replace()` ersetzt. Deshalb geschweifte Klammern und **niemals** `$COUNT$`.

- [ ] **Step 4: Die übrigen 37 Locales übersetzen**

Pro Sprache dieselben sechs Keys, an dieselbe Stelle. Übersetzt wird **nicht frei**, sondern aus dem Wortschatz, den die jeweilige Datei schon führt — so bleibt die Oberfläche in sich stimmig:

| Neuer Key | Vorlage im selben Katalog |
| --- | --- |
| `exchangeBundleSummary` | Das Wort für »Einträge« steht in `exchangePreviewItems`. Struktur `{count} <Einträge> · {valid} <auswählbar>` beibehalten, inklusive des `·`. |
| `exchangeBundleInvalid` | Das Adjektiv für »ungültig« steckt in `exchangeInvalid` bzw. `customEventInvalidJson`. Nur das Adjektiv übernehmen, ein Wort. |
| `exchangeBundleSelectAll` | Kurzform »Alle auswählen«. |
| `exchangeBundleImport` | Verb und Zielwort aus `exchangeConfirmImport` (en: »Add to Gestura«), mit eingesetztem `{count}`. |
| `exchangeBundleScriptPending` | Bezieht sich auf `exchangeScriptWarnTitle`/`exchangeScriptConfirm` — dieselbe Bezeichnung für »Skript« verwenden. |
| `exchangeBundleEmpty` | Satzbau an `exchangeInvalid` anlehnen. |

Für RTL-Sprachen (`ar`, `fa`, `he`) keine Sonderbehandlung: die Kataloge enthalten reinen Text, die Richtung setzt die Seite.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/menu-exchange-locales.test.mjs`
Expected: PASS, 39 Tests.

Run: `npx vitest run tests/locale-placeholders.test.mjs`
Expected: PASS — bestätigt, dass kein `$WORD$` eingeschleppt wurde.

Run: `npm test`
Expected: PASS, 18 Suites.

- [ ] **Step 6: Commit**

```bash
git add _locales tests/menu-exchange-locales.test.mjs
git commit -m "i18n: Sammel-Vorschau in allen 39 Locales"
```

---

### Task 6: Inline-Kanal in Content-Skript und Service Worker

**Files:**
- Modify: `js/content.js:56-86` (Operator-Button-Block)
- Modify: `js/background.js:1275-1276` (`handleAction`-Switch), `js/background.js:1288-1332` (`importFromSite`)

**Interfaces:**
- Consumes: `LIMITS.bundleBlobMax` aus Task 1 — **als gespiegelte Konstante**, nicht per Import. `js/menu-exchange.js` ist im Content-Kontext nicht geladen, und `js/background.js` spiegelt aus demselben Grund heute schon `LIMITS.blobMax` als `IMPORT_FROM_SITE_MAX_BYTES`.
- Produces:
  - Nachricht `{ action: 'importInline', json: string }` von Content-Skript an Service Worker.
  - `stashPendingImport(json, url)` → `{ success: true }`, legt `chrome.storage.session.pendingImport = { json, url, ts }` ab und öffnet die Optionsseite. Von `importFromSite` und `importInline` genutzt.
- **Unverändert:** der gesamte `a[rel~="gestura-menu"]`-Pfad inklusive `url.origin !== location.origin` und der Origin-Prüfung in `importFromSite`.

- [ ] **Step 1: Den Inline-Zweig in `js/content.js` ergänzen**

Der Kommentarkopf über der IIFE (Zeilen 56–58) wird um den zweiten Weg erweitert:

```js
// Operator-button import: a site can offer <a rel="gestura-menu" href="/menu.json">
// to hand a ready-made menu/engine to the extension. Same-origin only; validation
// happens in the trusted background context, never here.
//
// Second path, for sites whose data lives on another origin: an element carrying
// [data-gestura-inline] opens a short hand-off window on a trusted click, and the
// page then dispatches a 'gestura:import' CustomEvent whose detail is the JSON as
// a *string*. The extension fetches nothing on this path, so there is no origin to
// check — the page hands over data it already has. A string detail (rather than an
// object) avoids Firefox's Xray/cloneInto handling for page-realm objects and lets
// the size check run before parsing.
```

Innerhalb der IIFE, **vor** dem `document.addEventListener('click', …)`, die Fenster-Mechanik:

```js
	// Mirrors LIMITS.bundleBlobMax in js/menu-exchange.js, which is authoritative.
	const INLINE_MAX_BYTES = 1024 * 1024;
	const INLINE_WINDOW_MS = 15000;
	let inlineTimer = null;

	function closeInlineWindow() {
		if (inlineTimer === null) return;
		clearTimeout(inlineTimer);
		inlineTimer = null;
		document.removeEventListener('gestura:import', onInlinePayload, true);
	}

	function onInlinePayload(e) {
		// One payload per gesture: close first, so a flood of events cannot queue up.
		const json = e && e.detail;
		closeInlineWindow();
		if (typeof json !== 'string' || !json) return;
		if (new TextEncoder().encode(json).length > INLINE_MAX_BYTES) return;
		try {
			chrome.runtime.sendMessage({ action: 'importInline', json });
		} catch {
			// extension context may be invalidated (e.g. reload mid-navigation); ignore.
		}
	}

	function openInlineWindow() {
		closeInlineWindow();
		document.addEventListener('gestura:import', onInlinePayload, true);
		inlineTimer = setTimeout(closeInlineWindow, INLINE_WINDOW_MS);
	}
```

Und im Klick-Listener, **als Erstes** im Rumpf nach der `isTrusted`-Prüfung:

```js
		const inlineTrigger = e.target && e.target.closest && e.target.closest('[data-gestura-inline]');
		if (inlineTrigger) {
			e.preventDefault();
			e.stopPropagation();
			openInlineWindow();
			return;
		}
```

Das Fenster lebt im Content-Skript und stirbt mit dem Dokument — eine echte Navigation räumt es ohne Zutun ab, ein zusätzlicher Listener ist nicht nötig.

- [ ] **Step 2: `stashPendingImport` in `js/background.js` herauslösen**

Der Schwanz von `importFromSite` (die letzten beiden `await`-Zeilen im `try`-Block) wandert in einen eigenen Helfer, direkt **über** `importFromSite`:

```js
// Hand-off to the options page: stash the parsed JSON in session storage and
// open/focus the options page, which picks it up in #checkPendingImport().
// Shared by both import paths (fetched href, and inline hand-off).
async function stashPendingImport(json, url) {
	await chrome.storage.session.set({
		pendingImport: { json, url, ts: Date.now() },
	});
	await openOptionsPage('');
	return { success: true };
}
```

In `importFromSite` ersetzen die drei Zeilen ab `await chrome.storage.session.set(` sich durch:

```js
		return await stashPendingImport(json, url.href);
```

Alles davor — Protokollprüfung, Origin-Prüfung, Fetch, Byte-Kappe, `JSON.parse` — bleibt unverändert.

- [ ] **Step 3: `importInline` ergänzen**

Direkt nach `importFromSite`:

```js
// Inline hand-off (<[data-gestura-inline]> + 'gestura:import', see js/content.js):
// the page hands over JSON it fetched itself, so the extension performs no request
// and there is no origin to compare. The byte cap is re-checked here as defense in
// depth — a runtime message can originate outside the content script — and the
// parse happens in this trusted context, never in the page's.
const IMPORT_INLINE_MAX_BYTES = 1024 * 1024; // mirrors LIMITS.bundleBlobMax

async function importInline(request, sender) {
	const text = request && request.json;
	if (typeof text !== 'string' || !text) return { success: false, error: 'Missing payload' };
	if (new TextEncoder().encode(text).length > IMPORT_INLINE_MAX_BYTES) {
		return { success: false, error: 'Payload too large' };
	}
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		return { success: false, error: 'Invalid JSON' };
	}
	return await stashPendingImport(json, sender.url || sender.tab?.url || '');
}
```

- [ ] **Step 4: Den Case in `handleAction` eintragen**

Neben dem bestehenden `case 'importFromSite':` (Zeile 1275):

```js
		case 'importFromSite':
			return await importFromSite(request, sender);

		case 'importInline':
			return await importInline(request, sender);
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS, 18 Suites — keine Suite lädt `content.js` oder `background.js`, der Lauf muss unverändert grün sein.

- [ ] **Step 6: Manuelle Abnahme, inklusive Regressionsprobe**

Extension neu laden (`chrome://extensions` → Reload auf der Karte; Content-Skripte und `manifest.json` brauchen das zwingend).

Eine Testseite genügt; sie kann lokal liegen (`http://localhost:5173` im Index-Dev-Server, oder ein beliebiger `python3 -m http.server`). Der Inline-Weg braucht **keinen** bestimmten Origin.

```html
<button data-gestura-inline>An Gestura senden</button>
<script>
document.querySelector('[data-gestura-inline]').addEventListener('click', async () => {
	const bundle = { gesturaBundle: 1, entries: [ /* das Test-Bundle aus Task 4, Step 7 */ ] };
	document.dispatchEvent(new CustomEvent('gestura:import', { detail: JSON.stringify(bundle) }));
});
</script>
```

Erwartet:
1. Klick → die Optionsseite öffnet sich mit der Sammel-Vorschau des Bundles.
2. Ein `gestura:import` **ohne** vorherigen Klick (in der DevTools-Konsole absetzen) → nichts passiert.
3. Klick, dann 20 Sekunden warten, dann das Event feuern → nichts passiert (Fenster abgelaufen).
4. Klick, dann **zwei** Events schnell hintereinander → genau ein Dialog, mit dem Inhalt des **ersten** Events.
5. Ein Einzelformat (kein Bundle) als String → der bisherige Einzel-Dialog erscheint.

**Regressionsprobe (der href-Pfad darf sich nicht verändert haben):** Auf einer Seite unter `http://localhost:5173`

- `<a rel="gestura-menu" href="/menu.json">` mit einer gültigen JSON daneben → funktioniert wie bisher.
- `<a rel="gestura-menu" href="http://localhost:8000/menu.json">` → wird blockiert. Anderer Port ist ein anderer Origin; in der Service-Worker-Konsole (Link auf der Extension-Karte) steht `Cross-origin import blocked`.

- [ ] **Step 7: Commit**

```bash
git add js/content.js js/background.js
git commit -m "feat(import): Inline-Übergabe ohne Fetch durch die Extension"
```

---

### Task 7: Öffentlichen Vertrag und Changelog dokumentieren

Der Inline-Kanal ist Teil der öffentlichen Oberfläche — eine Betreiber-Seite kann ihn nur nutzen, wenn er beschrieben ist. `README.md` führt bisher **keine** Dokumentation des Betreiber-Buttons; dieser Abschnitt legt sie an und deckt beide Wege ab.

**Files:**
- Modify: `README.md` (neuer Abschnitt vor `## Privacy`, aktuell Zeile 72)
- Modify: `CHANGELOG.md` (neuer Eintrag über `### v2.7.0`)

**Interfaces:**
- Consumes: den in Task 6 gebauten Kanal.
- Produces: nichts, was Code konsumiert.

- [ ] **Step 1: Den Betreiber-Abschnitt in `README.md` anlegen**

Direkt vor `## Privacy` einfügen:

```markdown
## For site operators

A website can hand a ready-made Gestura menu or search engine to the extension.
Nothing is imported silently: every hand-off requires a real user click, the
payload is validated against the exchange format, and the user confirms it in a
preview dialog. Search engines that carry a transform script need a separate,
explicit acknowledgement.

**By link, for JSON you host yourself.** The link must be same-origin with the
page — the extension will not fetch a third-party URL on a page's behalf.

```html
<a rel="gestura-menu" href="/gestura-menu.json">Add to Gestura</a>
```

**Inline, for data that lives on another origin.** A trusted click on an element
carrying `data-gestura-inline` opens a 15-second hand-off window. Fetch the data
yourself — you are subject to the usual CORS rules, the extension is not involved
— and dispatch it as a **string**:

```html
<button data-gestura-inline>Add to Gestura</button>
<script>
document.querySelector('[data-gestura-inline]').addEventListener('click', async () => {
	const res = await fetch('https://api.example.com/bundle', { /* … */ });
	document.dispatchEvent(new CustomEvent('gestura:import', {
		detail: JSON.stringify(await res.json()),
	}));
});
</script>
```

The window accepts exactly one payload and closes on the first one. On this path
the extension performs no request of its own.

**Payload formats.** A single `gesturaMenu` or `gesturaEngine` object, or a bundle
of them:

```json
{ "gesturaBundle": 1, "entries": [ { "gesturaMenu": 1, "…": "…" } ] }
```

Limits: 100 KB per entry, 1 MB per bundle, 200 entries. Every URL inside an entry
must be `https:`. The full contract is `js/exchange-schema.json`; the runtime
validator in `js/menu-exchange.js` is authoritative.
```

- [ ] **Step 2: Den Changelog-Eintrag ergänzen**

Über `### v2.7.0 (2026-08-29)` einfügen (die Versionsnummer in `manifest.json` wird hier **nicht** angefasst — das gehört zum Release, nicht zu diesem Feature):

```markdown
### Unreleased

**New Features:**

- **Import several menus and engines at once:** the import dialog understands a
  `gesturaBundle` wrapper. Every entry is validated on its own and listed with its
  own checkbox, its own "replace the standard entry / add as new" choice and, for
  engines carrying a script, its own confirmation. A broken entry is shown with
  its reason and skipped — it no longer blocks the rest. The whole selection is
  written in a single save.
- **Sites on a split origin can hand over data:** a new inline hand-off lets a page
  fetch a payload itself and pass it to the extension after a trusted click
  (`data-gestura-inline` plus a `gestura:import` event). On this path the extension
  performs no request of its own, so no origin exception was needed — the existing
  same-origin link import is unchanged. See *For site operators* in the README.
```

- [ ] **Step 3: Prüfen, dass nichts kaputt ist**

Run: `npm test`
Expected: PASS, 18 Suites.

Run: `git status --porcelain`
Expected: nur `README.md` und `CHANGELOG.md` (plus eventuell `M manifest.json` — das ist der Versions-Stempel, siehe Global Constraints).

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: Betreiber-Vertrag für Menü-Übergabe dokumentieren"
```

---

## Abschluss

Nach Task 7 steht die Extension-Seite vollständig. Was **nicht** Teil dieses Plans ist und im Index-Repo folgt:

- `js/exchange-schema.json` nach `gestura-index/schema/exchange-schema.json` neu kopieren (Kopie-Regel: dort nie direkt editieren).
- `BasketTray.svelte`: den `disabled`-Button live schalten, `data-gestura-inline` setzen, nach `getBundle()` das Event feuern, `basket_send_soon` durch echten Aktionstext ersetzen.
- Sammelkorb-Größenkappe gegen 1 MB statt 100 KB.

Der Merge nach `firefox-build` ist ein reiner Merge: es kommt keine neue Top-Level-Abhängigkeit dazu, `importScripts` in `js/background.js` und `background.scripts` im Gecko-Manifest bleiben unberührt. Trotzdem nach dem Merge einmal `npx web-ext lint --source-dir . --config web-ext-config.mjs` laufen lassen (muss 0 Fehler melden).
