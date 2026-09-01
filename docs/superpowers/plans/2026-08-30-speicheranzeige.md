# Speicheranzeige – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sichtbar machen, wie voll die wachsenden Einstellungs-Zweige sind, bevor ein Speichervorgang daran scheitert.

**Architecture:** Eine reine Rechenfunktion in einem neuen klassischen Skript (`js/storage-usage.js`, Muster wie `js/menu-exchange.js`: IIFE mit `window.*`-Global und `module.exports`, damit die Node-Tests sie laden können) liefert Bytes und Prozent für einen Einstellungs-Zweig. Drei Oberflächen nutzen sie: die Datenverwaltung zeigt die genauen Zahlen, die beiden Manager je eine knappe Prozentzeile, und der Import-Dialog rechnet den Zustand aus, der nach dem Import bestünde, und sperrt, wenn er nicht mehr passt.

**Tech Stack:** Reines ES2020-JavaScript ohne Build-Schritt. UI in Lit (lokal gevendort). Tests: vitest im **Node**-Environment — kein jsdom, Lit-Komponenten sind damit nicht automatisiert testbar; nur die Rechenfunktion bekommt echte Tests.

**Spec:** [`docs/superpowers/specs/2026-08-30-speicheranzeige-design.md`](../specs/2026-08-30-speicheranzeige-design.md)

## Zwei Verfeinerungen gegenüber der Spec

Beide entstanden erst beim Lesen des aktuellen Codes; die Spec ist damit nicht falsch, nur weniger genau.

1. **§5.3 sagt „ein eigener Abschnitt Speicher".** Es gibt bereits den Abschnitt **`data` / „Datenverwaltung"** (`js/components/options-page.js:1011`, Festplatten-Icon), und dessen erste Zeile ist der **Sync-Status**. Dort gehören die Zahlen hin, statt einen vierzehnten Navigationspunkt anzulegen — thematisch ist es dieselbe Sache, und wenn Vorhaben zwei Sync optional macht, stehen beide erst recht nebeneinander.

2. **§4 nennt `mouseGestures` als angezeigten Zweig.** Der Prozentwert gilt dort, die **Restanzahl nicht**: Gesten sind kein zählbarer Vorrat gleichartiger Einträge. Die Restanzahl erscheint deshalb nur bei `siteMenus` und `searchEngines`.

## Global Constraints

- **Branch:** auf dem aktuellen Arbeitsbranch aufsetzen (`feat/menu-item-labels`, 13 Commits über `main`). Nicht auf `main` implementieren.
- **Kein Build-Schritt.** Das Repo-Root *ist* die entpackte Extension. Keine neuen Abhängigkeiten, kein Bundler.
- **Einrückung ist durchgehend TAB**, auch in JSON.
- **Interne `FlowMouse*`-Bezeichner bleiben unangetastet.** Das neue Modul heißt entsprechend `window.FlowMouseStorageUsage`.
- **`manifest.json`: niemals anfassen.** Ein `M manifest.json` im Status ist der `version_name`-Stempel eines Git-Hooks — nicht stagen.
- **Kommentare:** Deutsch in `js/menu-exchange.js`, `js/storage-usage.js` und unter `js/components/`; Englisch in `js/content.js` und `js/background.js`.
- **Niemals ein undeklariertes `$WORD$` in eine `messages.json`.** `chrome.i18n` liest es als Platzhalter und die Extension lädt dann gar nicht mehr. Platzhalter sind `{token}` plus `.replace()`; `tests/locale-placeholders.test.mjs` bewacht das.
- **Neue Keys müssen in alle 39 Locales.** Der `en`-Fallback genügt in diesem Projekt ausdrücklich nicht.
- **Prozent bezieht sich immer auf den Deckel des jeweiligen Zweigs** (`QUOTA_BYTES_PER_ITEM`, 8192 B), nie auf die Gesamtquote.
- **Bytes stehen ausschließlich in der Datenverwaltung.** Überall sonst nur Prozent und Restanzahl.
- **Die Anzeige erwähnt den `gestura.eu`-Sync nicht**, solange es ihn nicht gibt.
- **Testlauf:** `npm test`. Ausgangslage: 19 Suites, 403 Tests, 0 Fehler.

## File Structure

| Datei | Rolle | Tasks |
| --- | --- | --- |
| `js/storage-usage.js` | **Neu.** Reine Rechnung: Bytes, Prozent, Restanzahl. Keine `chrome.*`, kein DOM. | 1 |
| `tests/storage-usage.test.mjs` | **Neu.** Deckt die Rechnung ab — der einzige automatisiert prüfbare Teil. | 1 |
| `pages/options.html` | Lädt das neue Skript als klassisches `<script>` vor den Modulen. | 1 |
| `_locales/<39>/messages.json` | Sechs neue `storage*`-Keys. | 2 |
| `tests/site-menu-locales.test.mjs` | `storage` in `NEW_KEY_PREFIXES`. | 2 |
| `js/components/options-page.js` | Zeilen in der Datenverwaltung — der einzige Ort mit Bytes. | 3 |
| `js/components/site-menu-manager.js` | Prozentzeile unter der Menüliste. | 4 |
| `js/components/engine-manager.js` | Prozentzeile unter der Engine-Liste. | 4 |
| `js/components/menu-import-dialog.js` | Laufender Prozentwert und neuer Sperrgrund. | 5 |

---

### Task 1: Die Rechnung

`js/storage-usage.js` folgt dem Muster von `js/menu-exchange.js`: eine IIFE, die ihr API an `root.FlowMouseStorageUsage` hängt **und** über `module.exports` herausgibt, damit vitest sie im Node-Environment laden kann.

**Files:**
- Create: `js/storage-usage.js`
- Create: `tests/storage-usage.test.mjs`
- Modify: `pages/options.html`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `usageOf(key, value, quota)` → `{ bytes, quota, percent }` — `bytes` ist `utf8(key) + utf8(JSON.stringify(value))`, `percent` eine ganze Zahl.
  - `remainingEntries(freeBytes, existingValues, fallbackAvg)` → `number` — `existingValues` ist ein Array der bereits gespeicherten Einträge (die Objekte, nicht ihre Größen).
  - `AVG_FALLBACK` → `{ menu: 1001, engine: 797 }` — gemessene Durchschnittswerte aus den Katalogen, als Rückfall für einen noch leeren Zweig.
  - Global `window.FlowMouseStorageUsage`.

- [ ] **Step 1: Write the failing test**

Neue Datei `tests/storage-usage.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import '../js/storage-usage.js';
const S = globalThis.FlowMouseStorageUsage;

describe('usageOf', () => {
	it('zählt Schlüssel und Wert zusammen', () => {
		// 'k' = 1 Byte, JSON.stringify({a:1}) = '{"a":1}' = 7 Bytes
		expect(S.usageOf('k', { a: 1 }, 8192).bytes).toBe(8);
	});

	it('zählt UTF-8-Bytes, nicht Zeichen', () => {
		// 'ü' ist ein Zeichen, aber zwei Bytes; der String steht in Anführungszeichen
		const plain = S.usageOf('k', 'uu', 8192).bytes;
		const umlaut = S.usageOf('k', 'üü', 8192).bytes;
		expect(umlaut).toBe(plain + 2);
	});

	it('gibt den Deckel unverändert zurück', () => {
		expect(S.usageOf('k', {}, 8192).quota).toBe(8192);
	});

	it('rechnet den Prozentwert als ganze Zahl', () => {
		const r = S.usageOf('siteMenus', 'x'.repeat(4000), 8192);
		expect(Number.isInteger(r.percent)).toBe(true);
		expect(r.percent).toBeGreaterThan(45);
		expect(r.percent).toBeLessThan(55);
	});

	it('meldet nicht 100 Prozent, solange noch ein Byte frei ist', () => {
		// 8156 von 8192 sind 99,56 Prozent - naiv gerundet 100, obwohl es passt.
		// Diese Zahl entsteht real beim vierten Schritt der Test-Bundles.
		const value = 'x'.repeat(8156 - 'siteMenus'.length - 2); // -2 für die Anführungszeichen
		const r = S.usageOf('siteMenus', value, 8192);
		expect(r.bytes).toBe(8156);
		expect(r.percent).toBe(99);
	});

	it('meldet über 100, wenn der Deckel wirklich überschritten ist', () => {
		const value = 'x'.repeat(9000);
		const r = S.usageOf('k', value, 8192);
		expect(r.bytes).toBeGreaterThan(8192);
		expect(r.percent).toBeGreaterThan(100);
	});

	it('meldet genau 100 bei exakt vollem Deckel', () => {
		const value = 'x'.repeat(8192 - 'k'.length - 2);
		expect(S.usageOf('k', value, 8192).percent).toBe(100);
	});
});

describe('remainingEntries', () => {
	const menuA = { name: 'A', items: [{ id: 'x', action: 'back' }] };
	const menuB = { name: 'B', items: [{ id: 'y', action: 'back' }, { id: 'z', action: 'forward' }] };

	it('teilt den freien Platz durch den Durchschnitt der vorhandenen Einträge', () => {
		const avg = (JSON.stringify(menuA).length + JSON.stringify(menuB).length) / 2;
		expect(S.remainingEntries(avg * 3, [menuA, menuB], 1001)).toBe(3);
	});

	it('greift auf den Rückfallwert zurück, wenn es noch keine Einträge gibt', () => {
		expect(S.remainingEntries(3003, [], 1001)).toBe(3);
	});

	it('rundet ab - eine halbe Passung ist keine', () => {
		expect(S.remainingEntries(1500, [], 1001)).toBe(1);
	});

	it('liefert 0 bei keinem oder negativem freien Platz', () => {
		expect(S.remainingEntries(0, [], 1001)).toBe(0);
		expect(S.remainingEntries(-500, [], 1001)).toBe(0);
	});

	it('führt die gemessenen Rückfallwerte mit', () => {
		expect(S.AVG_FALLBACK.menu).toBe(1001);
		expect(S.AVG_FALLBACK.engine).toBe(797);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage-usage.test.mjs`
Expected: FAIL — `Cannot find module '../js/storage-usage.js'`.

- [ ] **Step 3: Write minimal implementation**

Neue Datei `js/storage-usage.js`:

```js
(function (root) {
	// Reine Rechnung für die Speicheranzeige. Keine chrome.*-APIs, kein DOM —
	// überall (Node-Tests, Options-UI) identisch nutzbar.
	//
	// Die Formel ist die, die Chrome für chrome.storage dokumentiert: die Länge
	// des Schlüssels plus die Länge des JSON-serialisierten Werts, in UTF-8-Bytes.
	// Bewusst selbst gerechnet statt über getBytesInUse(): das ist asynchron und
	// war in Firefox für storage.sync lange nicht implementiert.

	// Gemessene Durchschnittsgrößen aus den mitgelieferten Katalogen. Sie dienen
	// als Schätzer, solange ein Zweig noch keine eigenen Einträge hat.
	const AVG_FALLBACK = { menu: 1001, engine: 797 };

	function byteLength(str) {
		return new TextEncoder().encode(str).length;
	}

	function usageOf(key, value, quota) {
		const bytes = byteLength(String(key)) + byteLength(JSON.stringify(value));
		let percent = Math.round((100 * bytes) / quota);
		// Nicht auf 100 aufrunden, solange noch ein Byte frei ist: die Anzeige
		// würde sonst "voll" melden, wo ein Import noch durchgeht.
		if (percent >= 100 && bytes < quota) percent = 99;
		return { bytes, quota, percent };
	}

	function remainingEntries(freeBytes, existingValues, fallbackAvg) {
		if (!(freeBytes > 0)) return 0;
		const list = Array.isArray(existingValues) ? existingValues : [];
		const avg = list.length
			? list.reduce((sum, v) => sum + byteLength(JSON.stringify(v)), 0) / list.length
			: fallbackAvg;
		if (!(avg > 0)) return 0;
		return Math.floor(freeBytes / avg);
	}

	const api = { AVG_FALLBACK, byteLength, usageOf, remainingEntries };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseStorageUsage = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/storage-usage.test.mjs`
Expected: PASS, alle 12 Tests.

- [ ] **Step 5: Skript in die Optionsseite einhängen**

In `pages/options.html` neben den anderen klassischen Skripten, **vor** den `<script type="module">`-Zeilen. Die genaue Position ist unkritisch, solange sie vor den Modulen liegt; setze sie direkt hinter `<script src="../js/menu-model.js"></script>`:

```html
	<script src="../js/storage-usage.js"></script>
```

`tests/page-content-deps.test.mjs` prüft nur die Skripte, die **vor `content.js`** liegen müssen; `storage-usage.js` gehört nicht dazu und die Liste bleibt unverändert.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, jetzt 20 Suites, 415 Tests.

- [ ] **Step 7: Commit**

```bash
git add js/storage-usage.js tests/storage-usage.test.mjs pages/options.html
git commit -m "feat(storage-usage): Bytes, Prozent und Restanzahl für einen Einstellungs-Zweig"
```

---

### Task 2: Die sechs Texte in 39 Locales

**Files:**
- Modify: `_locales/<lang>/messages.json` für alle 39 Sprachen: `ar bg bn cs da de el en es es_419 fa fi fil fr he hi hr hu id it ja ko ms nl no pl pt_BR pt_PT ro ru sk sr sv th tr uk vi zh_CN zh_TW`
- Modify: `tests/site-menu-locales.test.mjs`

**Interfaces:**
- Consumes: nichts.
- Produces: die sechs Message-Keys, die Tasks 3–5 aufrufen.

- [ ] **Step 1: Write the failing test**

In `tests/site-menu-locales.test.mjs` das Prefix eintragen — Zeile 7:

```js
const NEW_KEY_PREFIXES = ['siteMenuItem', 'siteMenu', 'iconPicker', 'menuMode', 'fork', 'storage'];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/site-menu-locales.test.mjs`
Expected: PASS — und das ist **kein** Fehler: der Guard prüft, dass jeder Key mit diesem Prefix in allen Locales steht, und noch existiert keiner. Er wird erst in Step 4 scharf.

- [ ] **Step 3: `en` und `de` schreiben**

In **allen** Locales werden die Keys **ans Dateiende** angehängt, hinter den derzeit letzten Key `siteMenuItemDomainHint`. Der bekommt dabei ein nachgestelltes Komma.

`_locales/en/messages.json`:

```json
	"storageUsageLabel": { "message": "Storage used" },
	"storageDetail": { "message": "{used} of {total} bytes ({percent}%)" },
	"storageUsed": { "message": "{percent}% used" },
	"storageRemaining": { "message": "room for about {count} more" },
	"storageFull": { "message": "Full — saving fails until you remove entries." },
	"storageImportTooLarge": { "message": "This selection no longer fits. Deselect entries or import fewer at once." }
```

`_locales/de/messages.json`:

```json
	"storageUsageLabel": { "message": "Belegter Speicher" },
	"storageDetail": { "message": "{used} von {total} Bytes ({percent} %)" },
	"storageUsed": { "message": "{percent} % belegt" },
	"storageRemaining": { "message": "Platz für etwa {count} weitere" },
	"storageFull": { "message": "Voll — Speichern schlägt fehl, bis du Einträge entfernst." },
	"storageImportTooLarge": { "message": "Diese Auswahl passt nicht mehr. Wähle Einträge ab oder importiere weniger auf einmal." }
```

`{used}`, `{total}`, `{percent}` und `{count}` sind **keine** `chrome.i18n`-Platzhalter, sondern werden im Code per `.replace()` ersetzt. Deshalb geschweifte Klammern und **niemals** `$COUNT$`.

Das Wort „etwa" / „about" ist Absicht und darf beim Übersetzen nicht verloren gehen: die Restanzahl ist eine Schätzung.

- [ ] **Step 4: Die übrigen 37 Locales übersetzen**

Dieselben sechs Keys, an dieselbe Stelle. Vokabular aus dem jeweiligen Katalog ernten statt frei zu formulieren:

| Neuer Key | Vorlage in derselben Datei |
| --- | --- |
| `storageUsageLabel` | `dataManagement` und `syncStatus` stehen direkt daneben — dieselbe Registerhöhe treffen. |
| `storageDetail`, `storageUsed` | Das Wort für „belegt/used" frei wählen, aber in beiden Keys identisch. |
| `storageRemaining` | Neutrale Formulierung, die für Menüs **und** Suchmaschinen passt. |
| `storageFull` | Satzbau an `menuSyncSaveError` anlehnen — dieselbe Situation, kürzer gesagt. |
| `storageImportTooLarge` | Ton wie `exchangeBundleScriptPending`: sagt, was zu tun ist. |

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/site-menu-locales.test.mjs tests/locale-placeholders.test.mjs`
Expected: PASS. Der erste Lauf ist jetzt der scharfe: fehlt ein Key in einer Sprache, schlägt er fehl.

Run: `npm test`
Expected: PASS, 20 Suites.

- [ ] **Step 6: Commit**

```bash
git add _locales tests/site-menu-locales.test.mjs
git commit -m "i18n: Texte der Speicheranzeige in allen 39 Locales"
```

---

### Task 3: Zahlen in der Datenverwaltung

Der einzige Ort mit Bytes. Drei Zeilen plus Summe, direkt unter dem Sync-Status.

**Files:**
- Modify: `js/components/options-page.js` (Abschnitt `data`, um Zeile 1011)

**Interfaces:**
- Consumes: `window.FlowMouseStorageUsage.usageOf` (Task 1), die Keys aus Task 2.
- Produces: `#renderStorageRows(i18n)` — nur intern genutzt.

- [ ] **Step 1: Die Zeilen rendern**

In `js/components/options-page.js`, im `data`-Abschnitt **hinter** der `setting-row first-row` mit dem Sync-Status und **vor** der `setting-row actions` mit den Export/Import/Reset-Knöpfen:

```js
						${this.#renderStorageRows(i18n)}
```

Und die Methode selbst, bei den anderen privaten Render-Helfern:

```js
	// Der einzige Ort, an dem Bytes stehen: hier schaut jemand gezielt nach oder
	// meldet ein Problem. Überall sonst genügt der Prozentwert.
	#renderStorageRows(i18n) {
		const S = window.FlowMouseStorageUsage;
		const quota = (chrome.storage.sync && chrome.storage.sync.QUOTA_BYTES_PER_ITEM) || 8192;
		const total = (chrome.storage.sync && chrome.storage.sync.QUOTA_BYTES) || 102400;
		const branches = [
			['siteMenus', i18n.getMessage('siteMenusTitle')],
			['searchEngines', i18n.getMessage('sectionSearchEngines')],
			['mouseGestures', i18n.getMessage('basicSettings')],
		];
		let sum = 0;
		const rows = branches.map(([key, label]) => {
			const u = S.usageOf(key, this._settings[key], quota);
			sum += u.bytes;
			return html`
				<div class="setting-row">
					<div class="setting-label"><span>${label}</span></div>
					<span class="storage-value ${u.percent >= 100 ? 'over' : (u.percent >= 75 ? 'near' : '')}">
						${i18n.getMessage('storageDetail')
							.replace('{used}', u.bytes).replace('{total}', u.quota).replace('{percent}', u.percent)}
					</span>
				</div>`;
		});
		const totalPercent = Math.round((100 * sum) / total);
		return html`
			<div class="setting-row">
				<div class="setting-label"><span>${i18n.getMessage('storageUsageLabel')}</span></div>
				<span class="storage-value">
					${i18n.getMessage('storageDetail')
						.replace('{used}', sum).replace('{total}', total).replace('{percent}', totalPercent)}
				</span>
			</div>
			${rows}`;
	}
```

Die Summe steht damit **in** der Überschriftszeile `storageUsageLabel`, die Einzelzweige darunter. Das spart einen siebten Locale-Key: einen Key „Gesamt" gibt es im Katalog nicht (geprüft), und die Summenzeile ist keinen wert.

- [ ] **Step 2: Die drei Zustandsfarben ergänzen**

In das `css`-Literal von `options-page.js`:

```css
			.storage-value { font-size: 13px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
			.storage-value.near { color: var(--attention-color); }
			.storage-value.over { color: var(--danger-color); }
```

`--attention-color` kommt aus `css/common.css` und ist über `commonStyles` auch im Shadowroot verfügbar; es ist dieselbe Farbfamilie, die der Domain-Hinweis nutzt.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS, 20 Suites — keine Suite lädt diese Datei, der Lauf ist eine Regressionsprobe auf alles andere.

- [ ] **Step 4: Manuelle Abnahme**

Extension unter `chrome://extensions` neu laden, Optionsseite öffnen, Abschnitt **Datenverwaltung**. Erwartet: drei Zeilen mit Bytes und Prozent plus Summenzeile. Die Werte müssen mit denen übereinstimmen, die der DevTools-Einzeiler aus [`docs/test-bundles/README.md`](../../test-bundles/README.md) liefert.

- [ ] **Step 5: Commit**

```bash
git add js/components/options-page.js
git commit -m "feat(options): Speicherbelegung in der Datenverwaltung"
```

---

### Task 4: Prozentzeile in beiden Managern

**Files:**
- Modify: `js/components/site-menu-manager.js:182-197` (Ende von `render()`)
- Modify: `js/components/engine-manager.js:648-664` (Ende von `render()`)

**Interfaces:**
- Consumes: `window.FlowMouseStorageUsage` (Task 1), die Keys aus Task 2.
- Produces: nichts für spätere Tasks.

- [ ] **Step 1: Gemeinsamen Helfer in `shared-styles.js` — nein**

Beide Manager bekommen **je eine eigene kleine Methode**, keinen gemeinsamen Helfer. Die zwei Aufrufe unterscheiden sich in Zweig, Beschriftung und Einträgeliste; ein geteilter Helfer bräuchte drei Parameter und spart vier Zeilen. Das ist die Duplikation nicht wert.

- [ ] **Step 2: Zeile im Menü-Manager**

In `js/components/site-menu-manager.js`, in `render()` **nach** dem schließenden `</div>` der `import-bar` und vor dem abschließenden Backtick:

```js
			${this.#renderStorageLine(i18n)}
```

Und die Methode:

```js
	// Knapper Hinweis unter der Liste: Prozent und geschätzte Restanzahl. Bytes
	// stehen bewusst nur in der Datenverwaltung - für die meisten Nutzer ist die
	// Byte-Zahl keine brauchbare Größe. Unauffällig, solange Platz ist.
	#renderStorageLine(i18n) {
		const S = window.FlowMouseStorageUsage;
		const quota = (chrome.storage.sync && chrome.storage.sync.QUOTA_BYTES_PER_ITEM) || 8192;
		const cur = settingsStore.current.siteMenus || {};
		const u = S.usageOf('siteMenus', cur, quota);
		if (u.percent >= 100) {
			return html`<div class="notice">${i18n.getMessage('storageFull')}</div>`;
		}
		const left = S.remainingEntries(u.quota - u.bytes, Object.values(cur.custom || {}), S.AVG_FALLBACK.menu);
		const text = i18n.getMessage('storageUsed').replace('{percent}', u.percent)
			+ ' · ' + i18n.getMessage('storageRemaining').replace('{count}', left);
		return u.percent >= 75
			? html`<div class="notice">${text}</div>`
			: html`<div class="storage-line">${text}</div>`;
	}
```

Dazu ins `css`-Literal der Komponente:

```css
		.storage-line { font-size: 11.5px; color: var(--text-muted); }
```

`.notice` muss **nicht** definiert werden — die Klasse kommt aus `css/common.css` und ist über `commonStyles` bereits im Shadowroot.

- [ ] **Step 3: Zeile im Engine-Manager**

Dasselbe in `js/components/engine-manager.js`, nach der `import-bar`:

```js
			${this.#renderStorageLine(i18n)}
```

```js
	// Wie im Menü-Manager, nur für den searchEngines-Zweig. Bewusst nicht in
	// einen gemeinsamen Helfer gezogen: Zweig, Einträgeliste und Rückfallwert
	// unterscheiden sich, der Rest sind vier Zeilen.
	#renderStorageLine(i18n) {
		const S = window.FlowMouseStorageUsage;
		const quota = (chrome.storage.sync && chrome.storage.sync.QUOTA_BYTES_PER_ITEM) || 8192;
		const cur = settingsStore.current.searchEngines || {};
		const u = S.usageOf('searchEngines', cur, quota);
		if (u.percent >= 100) {
			return html`<div class="notice">${i18n.getMessage('storageFull')}</div>`;
		}
		const left = S.remainingEntries(u.quota - u.bytes, cur.custom || [], S.AVG_FALLBACK.engine);
		const text = i18n.getMessage('storageUsed').replace('{percent}', u.percent)
			+ ' · ' + i18n.getMessage('storageRemaining').replace('{count}', left);
		return u.percent >= 75
			? html`<div class="notice">${text}</div>`
			: html`<div class="storage-line">${text}</div>`;
	}
```

Und dieselbe `.storage-line`-Regel in dessen `css`-Literal.

**Beachte den Unterschied:** `siteMenus.custom` ist ein **Objekt** (deshalb `Object.values(...)`), `searchEngines.custom` ein **Array** (deshalb direkt). Ein Blick in `js/constants.js:281` und `:290` bestätigt beides.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, 20 Suites unverändert.

- [ ] **Step 5: Manuelle Abnahme**

Mit den Dateien aus [`docs/test-bundles/`](../../test-bundles/):

1. Frisches Profil, Menü-Manager → unauffällige graue Zeile, etwa „1 % belegt · Platz für etwa 8 weitere".
2. `01`, `02`, `03` importieren → die Zeile klettert (11 %, 29 %, 61 %) und bleibt unauffällig.
3. `04-bundle-3er` importieren → 99 % (**nicht** 100 — es passen noch 36 Bytes) und die Zeile trägt jetzt die Amber-Darstellung von `.notice`.
4. Nochmals `01` → der Import scheitert; die Zeile zeigt weiterhin 99 %, weil nichts gespeichert wurde.

- [ ] **Step 6: Commit**

```bash
git add js/components/site-menu-manager.js js/components/engine-manager.js
git commit -m "feat(manager): Prozentzeile zur Speicherbelegung unter beiden Listen"
```

---

### Task 5: Der Import-Dialog rechnet voraus

Der Ort mit dem höchsten Nutzen: hier fällt die Entscheidung, und hier lässt sich der gescheiterte Speicherversuch durch eine Vorabmeldung ersetzen.

**Files:**
- Modify: `js/components/menu-import-dialog.js`

**Interfaces:**
- Consumes: `window.FlowMouseStorageUsage` (Task 1), die Keys aus Task 2.
- Produces: `#blockedFor(chosen)` liefert zusätzlich `'storage'`.

- [ ] **Step 1: Die Vorausrechnung**

Neue Methode, bei den anderen privaten Helfern. Sie rechnet gegen genau das `patch`-Objekt, das `#commitPatch()` schreiben würde — so kann die Anzeige nicht von dem abweichen, was tatsächlich passiert:

```js
	// Belegung, die nach dem Import bestünde - dieselbe Zahl, die der Manager
	// danach anzeigt. Bewusst NICHT der Anteil der Auswahl am freien Platz:
	// derselbe Prozentwert soll an beiden Orten dasselbe bedeuten.
	#projectedUsage(patch) {
		const S = window.FlowMouseStorageUsage;
		const quota = (chrome.storage.sync && chrome.storage.sync.QUOTA_BYTES_PER_ITEM) || 8192;
		let worst = null;
		for (const [key, value] of Object.entries(patch)) {
			const u = S.usageOf(key, value, quota);
			if (!worst || u.percent > worst.percent) worst = u;
		}
		return worst;
	}
```

Bei einem gemischten Bundle zählt der **vollere** der beiden Zweige — er ist der, an dem es scheitert.

- [ ] **Step 2: Den Patch aus der Auswahl bauen, ohne zu schreiben**

`#confirmBundle()` baut den Patch heute inline. Ziehe den Bau in eine eigene Methode heraus, damit Render und Schreiben denselben Patch sehen:

```js
	// Baut den Patch, den ein Import der gewählten Zeilen schreiben würde.
	// Rein - schreibt nichts. Von #confirmBundle() und von der Vorschau genutzt,
	// damit die angezeigte Belegung und die tatsächliche nie auseinanderlaufen.
	#patchFor(chosen) {
		const lang = this.#lang();
		let siteMenus = settingsStore.current.siteMenus || emptySiteMenus();
		let engines = settingsStore.current.searchEngines || emptyEngines();
		let touchedMenus = false;
		let touchedEngines = false;
		const src = (row) => ({ ...this._source, version: row.result.value.version || '1.0.0' });
		const mid = (row) => (row.match ? row.match.id : null);

		const engineIdMap = {};
		for (const row of chosen) {
			if (row.result.type !== 'engine') continue;
			const applied = this.#applyEngine(engines, row.result, src(row), lang, row.mode, mid(row));
			engines = applied.next;
			engineIdMap[row.result.value.id] = applied.id;
			touchedEngines = true;
		}
		for (const row of chosen) {
			if (row.result.type !== 'menu') continue;
			siteMenus = this.#applyMenu(siteMenus, row.result, src(row), lang, row.mode, mid(row), engineIdMap);
			touchedMenus = true;
		}
		const patch = {};
		if (touchedMenus) patch.siteMenus = siteMenus;
		if (touchedEngines) patch.searchEngines = engines;
		return patch;
	}
```

Und `#confirmBundle()` wird dadurch kürzer — sein bisheriger Rumpf ab `const lang = this.#lang();` bis zum Bau von `patch` wird ersetzt durch:

```js
		await this.#commitPatch(patch, { count: chosen.length });
```

wobei `patch` aus dem Guard in Step 3 stammt. Die Engine-Abhängigkeitsprüfung (`if (chosen.some(r => r.result.type === 'menu' && this.#missingEngines(...)))`) bleibt unverändert davor stehen.

- [ ] **Step 3: `#blockedFor` um den Speichergrund erweitern**

```js
	// `projected` kommt vom Aufrufer, statt hier selbst gerechnet zu werden:
	// #patchFor() baut den kompletten nächsten Einstellungszustand, und ein
	// Render-Durchgang braucht ihn ohnehin für die Anzeige. Selbst rechnen hieße,
	// ihn bei bis zu 200 Zeilen zweimal je Render zu bauen.
	#blockedFor(chosen, projected) {
		if (!chosen.length) return 'empty';
		const pending = chosen.some(r => r.result.type === 'engine' && X().hasTransform(r.result.value) && !r.scriptAck);
		if (pending) return 'script';
		// Passt die Auswahl nicht mehr in den Speicher, ist das kein Fehler beim
		// Schreiben mehr, sondern eine Entscheidung davor.
		if (projected && projected.bytes > projected.quota) return 'storage';
		return null;
	}
```

Beide Aufrufer reichen den Wert nun durch. In `#renderBundle()`, direkt hinter `const chosen = this.#bundleChosen;`:

```js
		const patch = chosen.length ? this.#patchFor(chosen) : null;
		const projected = patch ? this.#projectedUsage(patch) : null;
		const blocked = this.#blockedFor(chosen, projected);
```

(die bestehende Zeile `const blocked = this.#blockedFor(chosen);` ersetzt sich damit)

und in `#confirmBundle()` wird aus dem bisherigen Guard:

```js
		const patch = this.#patchFor(chosen);
		if (!chosen.length || this.#blockedFor(chosen, this.#projectedUsage(patch))) return;
```

**Eine Eigenheit, die kein Fehler ist:** `#patchFor()` ruft `toCustomMenu`/`toCustomEngine` auf, und die vergeben bei jedem Aufruf **frische zufällige IDs**. Der Patch aus dem Render ist also nicht identisch mit dem, den `#confirmBundle()` später schreibt — die IDs unterscheiden sich. Für die Größenschätzung ist das ohne Belang, weil die IDs feste Länge haben. Verlasse dich nur nicht darauf, den Render-Patch später zu schreiben; er dient allein der Messung.

- [ ] **Step 4: Anzeige und Sperrgrund in der Sammel-Vorschau**

In `#renderBundle()`, in der `bsum`-Kopfzeile hinter der Zusammenfassung — dort steht heute `<span class="spacer"></span>`; setze die neue Anzeige **davor**:

```js
				<span class="bstorage">${projected ? i18n.getMessage('storageUsed').replace('{percent}', projected.percent) : ''}</span>
```

Und den Hinweistext unter der Liste, neben dem bestehenden `'script'`-Fall:

```js
			${blocked === 'script' ? html`<p class="bhint">${i18n.getMessage('exchangeBundleScriptPending')}</p>` : ''}
			${blocked === 'storage' ? html`<p class="bhint notice">${i18n.getMessage('storageImportTooLarge')}</p>` : ''}
```

Dazu ins `css`-Literal:

```css
		.bstorage { font-size: 11.5px; color: var(--text-muted); }
```

Der Import-Button ist über `?disabled=${!!blocked}` bereits gesperrt — `'storage'` wirkt dort ohne weitere Änderung.

- [ ] **Step 5: Einzel-Import sperren**

Im Einzelpfad genügt der Sperrfall; eine laufende Prozentzahl für einen einzigen Eintrag wäre Lärm. In `#confirm()` **vor** `await this.#commitPatch(...)`:

```js
		const u = this.#projectedUsage(patch);
		if (u && u.bytes > u.quota) { alert(window.i18n.getMessage('storageImportTooLarge')); return; }
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS, 20 Suites unverändert.

- [ ] **Step 7: Manuelle Abnahme**

Mit den Dateien aus [`docs/test-bundles/`](../../test-bundles/):

1. Profil bis etwa 61 % füllen (`01`, `02`, `03`), dann `04-bundle-3er` öffnen → die Kopfzeile zeigt den Wert, der **nach** dem Import gälte, und der Import ist möglich.
2. Danach `04-bundle-3er` erneut öffnen → die Vorausrechnung übersteigt den Deckel, der Hinweis erscheint in Amber, der Import-Button ist gesperrt. **Kein gescheiterter Speicherversuch mehr.**
3. Einzelne Zeilen abwählen → der Prozentwert sinkt live mit, und ab einer kleinen genug Auswahl gibt der Button wieder frei.
4. `05-zu-gross.json` als Einzeldatei → Meldung, kein Schreibversuch.

- [ ] **Step 8: Commit**

```bash
git add js/components/menu-import-dialog.js
git commit -m "feat(import-dialog): Belegung nach dem Import anzeigen und zu große Auswahl sperren"
```

---

## Abschluss

Nach Task 5 steht die Anzeige an allen drei Orten. Was **nicht** Teil dieses Plans ist:

- Mehr Platz schaffen. Das ist Vorhaben zwei (`storage.local` als Lesemodell, Browser-Sync als optionale Replikation).
- Der `gestura.eu`-Sync. Die Anzeige darf ihn nicht erwähnen, solange es ihn nicht gibt.
- Der Widerspruch `transformCodeMax` (10240 B) gegen den Item-Deckel (8192 B). Er löst sich in Vorhaben zwei von selbst, weil lokal beides passt.

Der Merge nach `firefox-build` ist ein reiner Merge: `js/storage-usage.js` wird nur von einer Options-Seite geladen, nicht vom Service Worker — `importScripts` in `js/background.js` und `background.scripts` im Gecko-Manifest bleiben unberührt.
