# Per-Klick-Öffnungspositionen für Menü-Links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menü-Links (`openCustomUrl`/`searchLink`) erhalten optionale, pro Maustaste (links/Mausrad/rechts) individuelle Öffnungspositionen (`ownOpen`), die Menü-Override und globale Einstellung überstimmen; Default bleibt „Globale Menü-Einstellungen verwenden" — ohne Migration.

**Architecture:** Eine neue pure Funktion `itemOpenConfig(item, menuBehavior, globalBehavior, button)` in `js/menu-model.js` löst die dreistufige Präzedenz auf (Item-`ownOpen[klick]` → Menü-`openBehavior` → global `menuOpenBehavior`). `js/content.js` (buildItems) ruft sie statt der bisherigen Inline-Überschreibung auf. Der Link-Editor (`action-select`, nur Kontext `menu-item`) bekommt eine Modus-Auswahl Global/Individuell mit Klick-Zeilen.

**Tech Stack:** Plain JS (Browser-IIFE + Lit-Komponenten, kein Build), vitest für `menu-model.js`.

**Spec:** `docs/superpowers/specs/2026-07-19-menu-link-open-settings-design.md`

## Global Constraints

- Einrückung: **Tabs**, nicht Spaces (gesamtes Repo).
- Content-Scripts sind IIFEs auf `window.*` — keine ES-Module-Imports in `js/content.js`/`js/menu-model.js`.
- Kommentare im Code auf Deutsch (bestehender Stil in `menu-model.js`).
- i18n: neue Keys NUR in `_locales/en` und `_locales/de`. Key-Namen dürfen NICHT mit `siteMenu`, `siteMenuItem`, `iconPicker`, `menuMode` oder `fork` beginnen (sonst verlangt `tests/site-menu-locales.test.mjs` alle ~40 Locales).
- `manifest.json` `version`/`version_name` NICHT anfassen (Stamp-Mechanismus).
- Tests laufen mit `npm test` (vitest) im Repo-Root.
- Commit-Messages enden mit `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `itemOpenConfig` in menu-model.js (TDD)

**Files:**
- Modify: `js/menu-model.js` (neue Funktion nach `withMenuFlag`, ~Z. 207; Export im `api`-Objekt ~Z. 311)
- Test: `tests/menu-model.test.mjs` (neuer describe-Block am Dateiende)

**Interfaces:**
- Consumes: nichts Neues.
- Produces: `FlowMouseMenuModel.itemOpenConfig(item, menuBehavior, globalBehavior, button) → { position: string, active: boolean }`. `button`: `0` = links (auch Tastatur/Enter), `1` = Mausrad, `2` = rechts. Positionen: `right|left|first|last|current|newWindow`.

- [ ] **Step 1: Failing Tests schreiben**

Am Ende von `tests/menu-model.test.mjs` anhängen:

```js
describe('itemOpenConfig — Präzedenz Link → Menü → global', () => {
	const item = (ownOpen) => ({ id: 'x', action: 'openCustomUrl', customUrl: 'u', ownOpen });

	it('ohne ownOpen, standard: links → current, Mausrad/rechts → right, active true', () => {
		expect(M.itemOpenConfig(item(undefined), '', 'standard', 0)).toEqual({ position: 'current', active: true });
		expect(M.itemOpenConfig(item(undefined), '', 'standard', 1)).toEqual({ position: 'right', active: true });
		expect(M.itemOpenConfig(item(undefined), '', 'standard', 2)).toEqual({ position: 'right', active: true });
	});

	it('ohne ownOpen: Menü-Override schlägt global; ohne Override gilt global; leer → standard', () => {
		expect(M.itemOpenConfig(item(undefined), 'first', 'last', 0).position).toBe('first');
		expect(M.itemOpenConfig(item(undefined), '', 'last', 2).position).toBe('last');
		expect(M.itemOpenConfig(item(undefined), '', '', 0).position).toBe('current'); // Fallback standard
	});

	it('ownOpen.left gilt nur für links; unkonfigurierte Tasten erben weiter', () => {
		const it_ = item({ left: { position: 'newWindow', active: false } });
		expect(M.itemOpenConfig(it_, '', 'standard', 0)).toEqual({ position: 'newWindow', active: false });
		expect(M.itemOpenConfig(it_, '', 'standard', 2)).toEqual({ position: 'right', active: true });
		expect(M.itemOpenConfig(it_, 'first', 'last', 1)).toEqual({ position: 'first', active: true });
	});

	it('alle drei Klick-Arten konfiguriert → jede Taste eigene Config', () => {
		const it_ = item({
			left: { position: 'current' },
			middle: { position: 'first', active: false },
			right: { position: 'last' },
		});
		expect(M.itemOpenConfig(it_, '', 'standard', 0)).toEqual({ position: 'current', active: true });
		expect(M.itemOpenConfig(it_, '', 'standard', 1)).toEqual({ position: 'first', active: false });
		expect(M.itemOpenConfig(it_, '', 'standard', 2)).toEqual({ position: 'last', active: true });
	});

	it('altes flaches position/active am Item ohne ownOpen wird ignoriert', () => {
		const legacy = { id: 'x', action: 'openCustomUrl', customUrl: 'u', position: 'first', active: false };
		expect(M.itemOpenConfig(legacy, '', 'standard', 0)).toEqual({ position: 'current', active: true });
	});

	it('Defaults im ownOpen-Eintrag: position → last, active → true; null-Item sicher', () => {
		expect(M.itemOpenConfig(item({ left: {} }), '', 'standard', 0)).toEqual({ position: 'last', active: true });
		expect(M.itemOpenConfig(null, '', 'standard', 0)).toEqual({ position: 'current', active: true });
	});
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npm test -- tests/menu-model.test.mjs`
Expected: FAIL — `M.itemOpenConfig is not a function`.

- [ ] **Step 3: Implementierung in `js/menu-model.js`**

Nach der Funktion `withMenuFlag` (vor `applyMenuAppend`) einfügen:

```js
	// Öffnungs-Config eines Link-/Such-Eintrags im Menü, pro Maustaste.
	// Präzedenz: item.ownOpen[taste] → Menü-Override → globale Einstellung.
	// button: 0 = links (auch Tastatur), 1 = Mausrad, 2 = rechts.
	// 'standard' = Linksklick im selben Tab, Rechts-/Mausradklick neuer Tab rechts.
	function itemOpenConfig(item, menuBehavior, globalBehavior, button) {
		const key = button === 1 ? 'middle' : button === 2 ? 'right' : 'left';
		const own = item && item.ownOpen && item.ownOpen[key];
		if (own) return { position: own.position || 'last', active: own.active !== false };
		const behavior = menuBehavior || globalBehavior || 'standard';
		if (behavior === 'standard') {
			return { position: button ? 'right' : 'current', active: true };
		}
		return { position: behavior, active: true };
	}
```

Im `api`-Objekt (Zeile `menuFlag, menuFlagRaw, withMenuFlag, withDefaultMenu,`) ergänzen zu:

```js
		menuFlag, menuFlagRaw, withMenuFlag, withDefaultMenu, itemOpenConfig,
```

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `npm test -- tests/menu-model.test.mjs`
Expected: PASS (alle Blöcke, auch die bestehenden).

- [ ] **Step 5: Commit**

```bash
git add js/menu-model.js tests/menu-model.test.mjs
git commit -m "feat(menu-model): itemOpenConfig — per-click open position resolution

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: content.js nutzt itemOpenConfig

**Files:**
- Modify: `js/content.js:3577-3604` (buildItems im `case 'customMenu'/'siteMenu'`)

**Interfaces:**
- Consumes: `window.FlowMouseMenuModel.itemOpenConfig(item, menuBehavior, globalBehavior, button)` aus Task 1 (`menu-model.js` lädt vor `content.js`, siehe `content_scripts` in `manifest.json` — bereits gegeben, wird von content.js an anderer Stelle benutzt).
- Produces: Menü-Klicks respektieren `ownOpen`; Verhalten ohne `ownOpen` ist unverändert zum Ist-Zustand.

- [ ] **Step 1: Inline-Logik ersetzen**

In `js/content.js` diesen Block (Beginn von `buildItems`, ~Z. 3577-3583):

```js
						const buildItems = (resolved) => {
							// Öffnungsverhalten: Menü-Override → globale Einstellung.
							// 'standard' = Linksklick im selben Tab, Rechts-/Mittelklick in neuem Tab rechts.
							const behavior = resolved.openBehavior || SETTINGS.menuOpenBehavior || 'standard';
							const linkPosition = (button) => behavior === 'standard'
								? (button ? 'right' : 'current')
								: behavior;
							return resolved.items
```

ersetzen durch:

```js
						const buildItems = (resolved) => {
							return resolved.items
```

Und im `onClick` (~Z. 3595-3603) diesen Block:

```js
									onClick: (button) => {
										const itemConfig = { ...(ACTION_DEFAULTS[it.action] || {}), ...it };
										if (it.action === 'searchLink') itemConfig.__selectionText = menuSelectionText;
										if (it.action === 'searchLink' || it.action === 'openCustomUrl') {
											itemConfig.position = linkPosition(button);
											itemConfig.active = true;
										}
										executeAction(it.action, itemConfig, cursor, startTarget);
									}
```

ersetzen durch:

```js
									onClick: (button) => {
										const itemConfig = { ...(ACTION_DEFAULTS[it.action] || {}), ...it };
										if (it.action === 'searchLink') itemConfig.__selectionText = menuSelectionText;
										if (it.action === 'searchLink' || it.action === 'openCustomUrl') {
											// Öffnungsverhalten: Link-individuell → Menü-Override → global.
											const oc = window.FlowMouseMenuModel.itemOpenConfig(
												it, resolved.openBehavior, SETTINGS.menuOpenBehavior, button);
											itemConfig.position = oc.position;
											itemConfig.active = oc.active;
										}
										executeAction(it.action, itemConfig, cursor, startTarget);
									}
```

- [ ] **Step 2: Regressionscheck**

Run: `npm test`
Expected: PASS (content.js hat keine Unit-Tests; der Lauf sichert menu-model & Co.).

Zusätzlich Sichtprüfung: `grep -n "linkPosition" js/content.js` → keine Treffer mehr.

- [ ] **Step 3: Commit**

```bash
git add js/content.js
git commit -m "fix(menu): per-link open settings win over menu/global behavior

Menu link clicks now resolve position/active via itemOpenConfig
(item ownOpen → menu openBehavior → global menuOpenBehavior)
instead of unconditionally overriding the item's own settings.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Editor-UI — Klick-Zeilen im menu-item-Kontext (+ i18n en/de)

**Files:**
- Modify: `js/constants.js:114` (`ACTION_DEFAULTS.openCustomUrl`) und `js/constants.js:136` (`ACTION_DEFAULTS.searchLink`) — `ownOpen: null` ergänzen
- Modify: `js/components/action-select.js` — neue Methode `#renderMenuItemOpenRows()` + 3 Call-Sites (Z. 1261, 1300, 1611)
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json` — 5 neue Keys

**Interfaces:**
- Consumes: `this.context === 'menu-item'` (wird von `site-menu-editor.js:272` gesetzt), `#renderPositionSelect` (bleibt für alle anderen Kontexte).
- Produces: Item-Config-Feld `ownOpen: { left?: {position, active}, right?: …, middle?: … }` — exakt das Format, das `itemOpenConfig` (Task 1) liest. `#cleanConfig` lässt `ownOpen` durch, weil der Key in `ACTION_DEFAULTS` registriert ist.

- [ ] **Step 1: `ownOpen: null` in ACTION_DEFAULTS registrieren**

`js/constants.js` — Zeile 114:

```js
		openCustomUrl: { customUrl: '', position: 'last', active: true, incognito: false, ownOpen: null },
```

Zeile 136 (`searchLink`): am Objektende `, ownOpen: null` vor der schließenden Klammer ergänzen (nach `incognito: false`).

Hintergrund: `#cleanConfig` in action-select.js whitelistet Config-Keys über `Object.keys(ACTION_DEFAULTS[action])`; `null`-Defaults laufen dort durch den else-Zweig und werden unverändert übernommen. Ohne Registrierung würde `ownOpen` beim Speichern verworfen.

- [ ] **Step 2: i18n-Keys anlegen**

In `_locales/en/messages.json` (z. B. direkt nach dem Block `"tabPositionNewWindow"`):

```json
	"menuItemOpenGlobal": {
		"message": "Use global menu settings",
		"description": "Menu link editor: inherit open behavior from menu/global settings"
	},
	"menuItemOpenCustom": {
		"message": "Custom per click",
		"description": "Menu link editor: per-click-type open positions"
	},
	"clickTypeLeft": {
		"message": "Left click",
		"description": "Mouse button label"
	},
	"clickTypeRight": {
		"message": "Right click",
		"description": "Mouse button label"
	},
	"clickTypeMiddle": {
		"message": "Middle click",
		"description": "Mouse button label"
	},
```

In `_locales/de/messages.json` an gleicher Stelle:

```json
	"menuItemOpenGlobal": {
		"message": "Globale Menü-Einstellungen verwenden",
		"description": "Menu link editor: inherit open behavior from menu/global settings"
	},
	"menuItemOpenCustom": {
		"message": "Individuell pro Klick",
		"description": "Menu link editor: per-click-type open positions"
	},
	"clickTypeLeft": {
		"message": "Linksklick",
		"description": "Mouse button label"
	},
	"clickTypeRight": {
		"message": "Rechtsklick",
		"description": "Mouse button label"
	},
	"clickTypeMiddle": {
		"message": "Mausradklick",
		"description": "Mouse button label"
	},
```

(Keine weiteren Locales — Fallback auf `en` über `default_locale`. Key-Präfixe kollidieren bewusst nicht mit `siteMenu*`/`menuMode*`/`fork*`.)

- [ ] **Step 3: `#renderMenuItemOpenRows()` in action-select.js einfügen**

Direkt **nach** der Methode `#renderPositionSelect` (endet ~Z. 1463) einfügen:

```js
	// Öffnungsverhalten für Menü-Einträge (Kontext 'menu-item'):
	// Global erben (ownOpen fehlt) oder pro Klick-Art eigene Position.
	// Datenformat siehe FlowMouseMenuModel.itemOpenConfig.
	#renderMenuItemOpenRows(showIncognito) {
		const i18n = window.i18n;
		const defaults = window.GestureConstants.ACTION_DEFAULTS[this._pendingValue] || {};
		const ownOpen = this._pendingConfig.ownOpen || null;
		const incognito = this._pendingConfig.incognito ?? defaults.incognito;
		const setOwnOpen = (next) => {
			const cfg = { ...this._pendingConfig };
			if (next) cfg.ownOpen = next; else delete cfg.ownOpen;
			this._pendingConfig = cfg;
			this.requestUpdate();
		};
		const CLICK_LABELS = {
			left: i18n.getMessage('clickTypeLeft'),
			right: i18n.getMessage('clickTypeRight'),
			middle: i18n.getMessage('clickTypeMiddle'),
		};
		const positionOptions = (position) => html`
			<option value="right" ?selected=${position === 'right'}>${i18n.getMessage('tabPositionRight')}</option>
			<option value="left" ?selected=${position === 'left'}>${i18n.getMessage('tabPositionLeft')}</option>
			<option value="first" ?selected=${position === 'first'}>${i18n.getMessage('tabPositionFirst')}</option>
			<option value="last" ?selected=${position === 'last'}>${i18n.getMessage('tabPositionLast')}</option>
			<option value="current" ?selected=${position === 'current'}>${i18n.getMessage('tabPositionCurrent')}</option>
			<option value="newWindow" ?selected=${position === 'newWindow'}>${i18n.getMessage('tabPositionNewWindow')}</option>
		`;
		const clickRow = (key) => {
			const cfg = ownOpen[key];
			const position = cfg.position || 'last';
			const active = cfg.active !== false;
			const set = (patch) => setOwnOpen({ ...ownOpen, [key]: { ...cfg, ...patch } });
			const remove = () => {
				const next = { ...ownOpen };
				delete next[key];
				setOwnOpen(next);
			};
			return html`
				<div class="action-config-row">
					<span class="action-config-label">${CLICK_LABELS[key]}</span>
					<select .value=${position}
						@change=${(e) => set({ position: e.target.value })}>
						${positionOptions(position)}
					</select>
					${position !== 'current' ? html`
						<label class="action-config-checkbox">
							<input type="checkbox" .checked=${active}
								@change=${(e) => set({ active: e.target.checked })}>
							<span>${i18n.getMessage('newTabActive')}</span>
						</label>
					` : ''}
					${key !== 'left' ? html`
						<button class="btn btn-ghost" type="button" @click=${remove}>
							${unsafeHTML(icon('x', { size: 13, strokeWidth: 2.5 }))}
						</button>
					` : ''}
				</div>
			`;
		};
		const addButtons = ownOpen ? ['right', 'middle'].filter(k => !ownOpen[k]) : [];
		return html`
			<div class="action-config-row">
				<span class="action-config-label">${i18n.getMessage('siteMenuOpenBehaviorLabel')}</span>
				<select .value=${ownOpen ? 'own' : ''}
					@change=${(e) => {
						if (e.target.value === 'own') setOwnOpen({ left: { position: 'last', active: true } });
						else setOwnOpen(null);
					}}>
					<option value="" ?selected=${!ownOpen}>${i18n.getMessage('menuItemOpenGlobal')}</option>
					<option value="own" ?selected=${!!ownOpen}>${i18n.getMessage('menuItemOpenCustom')}</option>
				</select>
			</div>
			${ownOpen ? html`
				${['left', 'right', 'middle'].filter(k => ownOpen[k]).map(clickRow)}
				<div class="action-config-row">
					${addButtons.map(k => html`
						<button class="btn btn-ghost" type="button"
							@click=${() => setOwnOpen({ ...ownOpen, [k]: { position: 'last', active: true } })}>
							${unsafeHTML(icon('plus', { size: 13, strokeWidth: 2.5 }))}
							<span>${CLICK_LABELS[k]}</span>
						</button>
					`)}
				</div>
			` : ''}
			${showIncognito ? html`
				<div class="action-config-row">
					<label class="action-config-checkbox">
						<input type="checkbox" .checked=${incognito}
							@change=${(e) => { this._pendingConfig = { ...this._pendingConfig, incognito: e.target.checked }; this.requestUpdate(); }}>
						<span>${i18n.getMessage('openInIncognito')}</span>
					</label>
				</div>
			` : ''}
		`;
	}
```

Hinweise für den Implementierer:
- `unsafeHTML`, `icon`, `html` sind in der Datei bereits importiert (werden überall benutzt).
- `siteMenuOpenBehaviorLabel` („Links öffnen") existiert bereits in allen Locales.
- Die Inkognito-Checkbox ist bewusst dupliziert aus `#renderPositionSelect` — sie bleibt item-weit und gilt für alle Klick-Arten.
- Kleiner Logik-Punkt: `addButtons` ist bei `ownOpen === null` ein leeres Array (Guard im Ausdruck) und wird ohnehin nur im `ownOpen ? …`-Template gerendert.

- [ ] **Step 4: Drei Call-Sites auf Kontext umschalten**

Alle drei Stellen rendern bisher `${this.#renderPositionSelect(true, true, true)}`; im `menu-item`-Kontext stattdessen die neue Methode:

1. `js/components/action-select.js:1261` (searchLink, Inline-Modus):
```js
				${this.context === 'menu-item' ? this.#renderMenuItemOpenRows(true) : this.#renderPositionSelect(true, true, true)}
```
2. `js/components/action-select.js:1300` (searchLink, Engine-Modus): identische Ersetzung.
3. `js/components/action-select.js:1611` (openCustomUrl): identische Ersetzung.

Die übrigen `#renderPositionSelect`-Aufrufe (Z. 1719, 1735, 1956, 2034 u. a. — andere Aktionen) bleiben unverändert.

- [ ] **Step 5: Testlauf + manueller UI-Check**

Run: `npm test`
Expected: PASS.

Manuell (Chrome, `chrome://extensions` → Reload auf der Gestura-Karte, Options-Seite neu öffnen):
1. Website-Menü → Link bearbeiten → Dropdown „Links öffnen" zeigt „Globale Menü-Einstellungen verwenden" (Default).
2. Auf „Individuell pro Klick" stellen → Linksklick-Zeile (Position „Letzter Tab", „Im Vordergrund") erscheint; „+ Rechtsklick" / „+ Mausradklick" fügen Zeilen hinzu; X entfernt sie; Linksklick-Zeile hat kein X.
3. Speichern, Editor erneut öffnen → Einstellungen sind erhalten (`ownOpen` überlebt `#cleanConfig`).
4. Zurück auf „Global" stellen, speichern, erneut öffnen → Klick-Zeilen weg (`ownOpen` entfernt).
5. Gesten-Editor (Aktion „Benutzerdefinierte URL" direkt auf einer Geste): unverändert die alte Position-Zeile, KEINE Global-Option.

- [ ] **Step 6: Commit**

```bash
git add js/constants.js js/components/action-select.js _locales/en/messages.json _locales/de/messages.json
git commit -m "feat(options): per-click open positions in menu link editor (ownOpen)

Menu-item context gets a Global/Custom mode select; custom mode shows
one row per click type (left always present, right/middle addable).
ownOpen registered in ACTION_DEFAULTS so cleanConfig persists it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: End-to-End-Verifikation + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (neuer Abschnitt „Unreleased" über `### v2.4`)
- Modify: `docs/superpowers/specs/2026-07-19-menu-link-open-settings-design.md` (Status-Zeile)

**Interfaces:**
- Consumes: Tasks 1-3 vollständig.
- Produces: verifiziertes Verhalten im Browser, dokumentiert.

- [ ] **Step 1: Verhalten im Browser verifizieren**

Extension reloaden (`chrome://extensions`), dann auf einer normalen Webseite:

1. Menü-Geste ausführen (Website-Menü öffnen). Link OHNE Individual-Einstellung: Linksklick → selber Tab, Rechts-/Mausradklick → neuer Tab rechts (globales „Standard"-Verhalten, wie vor der Änderung).
2. Einem Link per Editor `Individuell pro Klick` geben: Linksklick = „Neues Fenster". Menü öffnen → Linksklick öffnet neues Fenster; Rechtsklick weiterhin neuer Tab rechts (erbt global).
3. Demselben Link „+ Rechtsklick" = „Erster Tab (ganz links)", „Im Vordergrund" aus → Rechtsklick öffnet Hintergrund-Tab ganz links.
4. Globale Einstellung „Links öffnen" auf „Letzter Tab" stellen → Links ohne Individual-Einstellung folgen ihr; der individuelle Link aus Schritt 2/3 bleibt bei seinen Positionen.
5. Menü-Override testen: einem Menü unter „Links öffnen" (Menü-Kopf) einen Wert geben → gilt für dessen nicht-individuelle Links.
6. Suchmaschinen-Eintrag im Menü individuell stellen → greift ebenfalls.

Bei Abweichungen: superpowers:systematic-debugging, NICHT raten.

- [ ] **Step 2: CHANGELOG-Eintrag**

In `CHANGELOG.md` direkt über `### v2.4 (2026-07-15)` einfügen:

```markdown
### Unreleased

**Fixes & Improvements:**

- **Per-link open settings work again — now per click type:** menu link entries (custom URLs and search entries) can opt into individual open positions per mouse button (left / middle / right), overriding the per-menu and global "Open links" behavior. The default for every link is "Use global menu settings"; existing links keep inheriting automatically. Unconfigured click types still follow the menu/global setting.
```

- [ ] **Step 3: Spec-Status aktualisieren**

In `docs/superpowers/specs/2026-07-19-menu-link-open-settings-design.md` die Status-Zeile ersetzen:

```markdown
- **Status:** umgesetzt (siehe docs/superpowers/plans/2026-07-19-menu-link-open-settings.md)
```

- [ ] **Step 4: Finaler Testlauf + Commit**

Run: `npm test`
Expected: PASS.

```bash
git add CHANGELOG.md docs/superpowers/specs/2026-07-19-menu-link-open-settings-design.md
git commit -m "docs: changelog entry for per-click menu link open settings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
