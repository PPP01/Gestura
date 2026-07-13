# Menü-Umschalter Revision 2 — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den in Revision 1 gebauten Menü-Header zu einem global konfigurierbaren Header-**oder**-Footer-Umschalter umbauen: ein einziger globaler Schalter, Positionswahl, pro-Untermenü-Sichtbarkeit in der Auswahl, farblich abgesetzte Leiste, und eine Auswahl, die sich als Overlay über die Ausgabe legt (statt sie zu vergrößern) und die Ausgabe nur bei Bedarf wachsen lässt.

**Architecture:** Ein globales Settings-Objekt `customMenuSwitcher {enabled, position}` plus pro-Untermenü `showInSwitcher`. Der Transportwert `header` wird zu `switcher {name, position, menus[]}` umbenannt und fließt über die bestehenden Pfade (content.js → background-Session → iframe; `ctxMenuSwitch` zurück). Das iframe rendert eine Header/Footer-Leiste und eine absolut positionierte Overlay-Auswahl; die Größenmessung wächst die Ausgabe nur, wenn die Auswahl größer ist als die Items.

**Tech Stack:** Plain JS (MV3, kein Build), Lit (vendored), `chrome.runtime`/`chrome.tabs`-Messaging, `SettingsStore`, vitest (reine Helfer).

## Global Constraints

- Einrückung: **Tabs**, nicht Spaces (gesamtes Repo).
- Kein Build-Step, keine ES-Module in Content-Scripts (`window.*`/`globalThis`-Globals). UI-Komponenten nutzen Lit + ES-`import`.
- `DEFAULT_SETTINGS` in [js/constants.js](../../../js/constants.js) ist die einzige Quelle für die Settings-Form.
- Kein Test-Harness für Content-Scripts, Service-Worker oder Lit-UI — diese werden manuell verifiziert (entpackt laden, Reload). Die `vitest`-Suite muss grün bleiben (aktuell 122 Tests; nach Task A 123+).
- Rückwärtskompatibel: Menüs ohne `switcher` (Tabs/Recently-Closed/Bookmarks und Custom-Menüs bei global deaktiviertem Schalter) verhalten sich exakt wie vor R2 — One-Shot-Sizing, keine Leiste. `setItems(items)` mit einem Argument darf den zuletzt gesetzten Zustand nicht überschreiben (der `header !== undefined`/`'switcher' in …`-Mechanismus aus R1 bleibt, nur umbenannt).
- Terminologie: **Custom Menu** = Gesamtsystem (globale Ebene); **Untermenü** = einzelnes `customMenus[id]`; **Menü-Auswahl** = Umschalt-Liste; **Custom Menü-Ausgabe** = iframe-Popup.
- Alle sichtbaren Strings über i18n (`_locales/en/messages.json`, `en` = default_locale).
- YAGNI: nur was hier steht.

## Datei-Übersicht

- **Ändern** [js/constants.js](../../../js/constants.js) — globales `customMenuSwitcher`-Default.
- **Erstellen** [js/menu-switcher.js](../../../js/menu-switcher.js) — reiner Helfer `buildSwitcherMenus`.
- **Erstellen** [tests/menu-switcher.test.mjs](../../../tests/menu-switcher.test.mjs) — Unit-Test dafür.
- **Ändern** [manifest.json](../../../manifest.json) — `js/menu-switcher.js` in `content_scripts` vor `js/content.js`.
- **Ändern** [_locales/en/messages.json](../../../_locales/en/messages.json) — R1-Keys entfernen, R2-Keys hinzufügen.
- **Ändern** [js/components/menu-panel.js](../../../js/components/menu-panel.js) — globale Schalter-Einstellungen + pro-Untermenü-Checkbox.
- **Ändern** [js/background.js](../../../js/background.js) — `header`→`switcher` in Session-Relay.
- **Ändern** [js/content.js](../../../js/content.js) — `buildSwitcher` (global gated, Helfer, Position), `header`→`switcher` in `setItems`/Rebuild.
- **Ändern** [js/context-menu.js](../../../js/context-menu.js) — Header/Footer-Leiste, Overlay-Auswahl, Bedarfs-Sizing, `header`→`switcher`.

Reihenfolge: A (Settings+Helfer) → B (UI) → C (content.js) → D (iframe). End-to-End funktioniert nach D.

---

## Task A: Globales Setting + `buildSwitcherMenus`-Helfer + Unit-Test

**Files:**
- Modify: `js/constants.js` (nach `customMenus: {},`, ~Zeile 263)
- Create: `js/menu-switcher.js`
- Create: `tests/menu-switcher.test.mjs`
- Modify: `manifest.json` (`content_scripts[0].js`, ~Zeilen 40-49)

**Interfaces:**
- Produces:
  - `DEFAULT_SETTINGS.customMenuSwitcher = { enabled: false, position: 'header' }`.
  - Global `FlowMouseMenuSwitcher.buildSwitcherMenus(customMenus, currentId, fallbackName = '')` → `Array<{id, name}>`: alle Einträge mit `id !== currentId` und `showInSwitcher !== false` (Default true), in Objekt-Reihenfolge; `name = m.name || fallbackName`.

- [ ] **Step 1: Failing Test schreiben**

Erstelle `tests/menu-switcher.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import '../js/menu-switcher.js';
const { buildSwitcherMenus } = globalThis.FlowMouseMenuSwitcher;

describe('buildSwitcherMenus', () => {
	const menus = {
		a: { name: 'Standard' },
		b: { name: 'Shopping', showInSwitcher: true },
		c: { name: 'Coding', showInSwitcher: false },
		d: {}, // no name, no flag
	};

	it('excludes the current menu', () => {
		const r = buildSwitcherMenus(menus, 'a');
		expect(r.find(m => m.id === 'a')).toBeUndefined();
	});

	it('includes showInSwitcher true or absent, excludes false, in definition order', () => {
		const r = buildSwitcherMenus(menus, 'x');
		expect(r.map(m => m.id)).toEqual(['a', 'b', 'd']);
	});

	it('applies fallback name only for unnamed menus', () => {
		const r = buildSwitcherMenus(menus, 'x', 'Menu');
		expect(r.find(m => m.id === 'd').name).toBe('Menu');
		expect(r.find(m => m.id === 'a').name).toBe('Standard');
	});

	it('handles empty and null input', () => {
		expect(buildSwitcherMenus({}, 'x')).toEqual([]);
		expect(buildSwitcherMenus(null, 'x')).toEqual([]);
	});
});
```

- [ ] **Step 2: Test läuft rot**

Run: `npx vitest run tests/menu-switcher.test.mjs`
Expected: FAIL — `Cannot find module '../js/menu-switcher.js'` bzw. `buildSwitcherMenus` undefined.

- [ ] **Step 3: Helfer implementieren**

Erstelle `js/menu-switcher.js` (Muster wie `js/menu-patterns.js`, Tabs):

```javascript
(function (root) {
	function buildSwitcherMenus(customMenus, currentId, fallbackName = '') {
		return Object.entries(customMenus || {})
			.filter(([id, m]) => id !== currentId && (!m || m.showInSwitcher !== false))
			.map(([id, m]) => ({ id, name: (m && m.name) ? m.name : fallbackName }));
	}
	const api = { buildSwitcherMenus };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseMenuSwitcher = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Test läuft grün**

Run: `npx vitest run tests/menu-switcher.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Globales Default in constants.js**

In `js/constants.js` die Zeile `customMenus: {},` (~263) um die folgende Zeile direkt darunter ergänzen:

```javascript
		customMenus: {},
		customMenuSwitcher: { enabled: false, position: 'header' },
```

- [ ] **Step 6: Helfer als Content-Script registrieren**

In `manifest.json`, im `content_scripts[0].js`-Array (~Zeilen 40-49), `"js/menu-switcher.js"` direkt vor `"js/content.js"` einfügen:

```json
                "js/favicon-util.js",
                "js/menu-switcher.js",
                "js/content.js"
```

- [ ] **Step 7: JSON + Syntax + volle Suite prüfen**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest OK')"`
Run: `node --check js/menu-switcher.js && node --check js/constants.js && echo "SYNTAX OK"`
Run: `npx vitest run`
Expected: `manifest OK`, `SYNTAX OK`, alle Tests grün (jetzt 126 = 122 + 4 neue).

- [ ] **Step 8: Commit**

```bash
git add js/constants.js js/menu-switcher.js tests/menu-switcher.test.mjs manifest.json
git commit -m "feat(menu): global customMenuSwitcher setting + buildSwitcherMenus helper"
```

---

## Task B: Options-UI — globale Schalter-Einstellungen + pro-Untermenü-Sichtbarkeit

**Files:**
- Modify: `_locales/en/messages.json` (R1-Keys `menuShowHeader`/`menuShowHeaderHint` entfernen; neue Keys ergänzen)
- Modify: `js/components/menu-panel.js` (Styles ~Zeile 60-72; `onChange`-Handler ~Zeile 293-295; `render()` ~Zeile 321-327; `#renderHeaderToggle` ~Zeile 379-393 ersetzen)

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS.customMenuSwitcher` (Task A), `SettingsStore.current`, `SettingsStore.save`.
- Produces: schreibt `customMenuSwitcher: { enabled, position }` global und `customMenus[id].showInSwitcher` pro Untermenü. Task C/D lesen diese.

- [ ] **Step 1: i18n-Keys aktualisieren**

In `_locales/en/messages.json` die beiden R1-Blöcke `menuShowHeader` und `menuShowHeaderHint` **entfernen** und stattdessen (an gleicher Stelle) einfügen:

```json
	"menuSwitcherEnable": {
		"message": "Show header/footer with menu switcher",
		"description": "Global toggle in the custom-menu editor — adds a header or footer bar to the popup menu with a switcher to change menus on the fly"
	},
	"menuSwitcherEnableHint": {
		"message": "Adds a bar to the custom menu. Click it to switch between menus on the fly.",
		"description": "Hint under the menu-switcher toggle"
	},
	"menuSwitcherHeader": {
		"message": "Header",
		"description": "Option label — place the switcher bar at the top of the menu"
	},
	"menuSwitcherFooter": {
		"message": "Footer",
		"description": "Option label — place the switcher bar at the bottom of the menu"
	},
	"menuShowInSwitcher": {
		"message": "Show in menu selection",
		"description": "Per-sub-menu checkbox — whether this menu appears in the switcher's selection list"
	},
```

- [ ] **Step 2: JSON prüfen**

Run: `node -e "JSON.parse(require('fs').readFileSync('_locales/en/messages.json','utf8')); console.log('JSON OK')"`
Expected: `JSON OK`

- [ ] **Step 3: `customMenuSwitcher`-Änderungen abonnieren**

In `js/components/menu-panel.js`, `connectedCallback` (~Zeile 293-295), den Store-Listener erweitern:

```javascript
		this._unsubscribeStore = SettingsStore.onChange((changed) => {
			if ('customMenus' in changed || 'customMenuSwitcher' in changed) this.requestUpdate();
```

- [ ] **Step 4: Getter + Writer für das globale Setting**

In `js/components/menu-panel.js` direkt nach dem `get customMenus()` (~Zeile 286-288) einfügen:

```javascript
	get switcherSettings() {
		return SettingsStore.current.customMenuSwitcher || { enabled: false, position: 'header' };
	}

	#updateSwitcher(patch) {
		const next = { ...this.switcherSettings, ...patch };
		SettingsStore.save({ customMenuSwitcher: next });
	}
```

- [ ] **Step 5: R1-`#renderHeaderToggle` durch globale Einstellungen + pro-Untermenü-Checkbox ersetzen**

In `js/components/menu-panel.js` die gesamte Methode `#renderHeaderToggle(activeId, menu) { ... }` (~Zeile 379-393) durch die folgenden zwei Methoden ersetzen:

```javascript
	#renderSwitcherSettings() {
		const i18n = window.i18n;
		const s = this.switcherSettings;
		return html`
			<div class="switcher-settings">
				<label class="switcher-toggle">
					<input type="checkbox"
						.checked=${!!s.enabled}
						@change=${(e) => this.#updateSwitcher({ enabled: e.target.checked })}
					>
					<span class="switcher-toggle-text">
						<span class="switcher-toggle-label">${i18n.getMessage('menuSwitcherEnable')}</span>
						<span class="switcher-toggle-hint">${i18n.getMessage('menuSwitcherEnableHint')}</span>
					</span>
				</label>
				${s.enabled ? html`
					<div class="switcher-position" role="group">
						<button type="button"
							class="switcher-pos-btn${s.position !== 'footer' ? ' active' : ''}"
							@click=${() => this.#updateSwitcher({ position: 'header' })}
						>${i18n.getMessage('menuSwitcherHeader')}</button>
						<button type="button"
							class="switcher-pos-btn${s.position === 'footer' ? ' active' : ''}"
							@click=${() => this.#updateSwitcher({ position: 'footer' })}
						>${i18n.getMessage('menuSwitcherFooter')}</button>
					</div>
				` : ''}
			</div>
		`;
	}

	#renderShowInSwitcher(activeId, menu) {
		const i18n = window.i18n;
		return html`
			<label class="show-in-switcher-field">
				<input type="checkbox"
					.checked=${menu.showInSwitcher !== false}
					@change=${(e) => this.#updateMenu(activeId, { showInSwitcher: e.target.checked })}
				>
				<span>${i18n.getMessage('menuShowInSwitcher')}</span>
			</label>
		`;
	}
```

- [ ] **Step 6: `render()` verdrahten**

In `js/components/menu-panel.js` `render()` (~Zeile 321-327) den Rückgabeblock ersetzen durch:

```javascript
		return html`
			${this.#renderSwitcherSettings()}
			${this.#renderSelectorRow(entries, activeId)}
			${this.#renderNameField(activeId, activeMenu)}
			${this.switcherSettings.enabled ? this.#renderShowInSwitcher(activeId, activeMenu) : ''}
			${this.#renderPatternsSection(activeId, activeMenu)}
			${this.#renderItemsSection(activeId, activeMenu)}
		`;
```

- [ ] **Step 7: Styles — R1-`.header-toggle-*` durch R2-Styles ersetzen**

In `js/components/menu-panel.js` den R1-Styleblock (`.header-toggle-field`, `.header-toggle-text`, `.header-toggle-label`, `.header-toggle-hint`) durch folgende Styles ersetzen (gleiche Stelle im `css\`\``-Block, Tabs):

```javascript
			.switcher-settings {
				display: flex;
				flex-direction: column;
				gap: 10px;
				margin-bottom: 4px;
			}
			.switcher-toggle {
				display: flex;
				align-items: flex-start;
				gap: 10px;
			}
			.switcher-toggle input[type="checkbox"] {
				margin-top: 2px;
				flex-shrink: 0;
			}
			.switcher-toggle-text {
				display: flex;
				flex-direction: column;
				gap: 3px;
			}
			.switcher-toggle-label {
				font-size: 12px;
				font-weight: 600;
				color: var(--text-secondary);
			}
			.switcher-toggle-hint {
				font-size: 11px;
				color: var(--text-secondary);
				opacity: 0.8;
			}
			.switcher-position {
				display: inline-flex;
				gap: 0;
				border: 1px solid var(--border-color, rgba(128,128,128,0.35));
				border-radius: 6px;
				overflow: hidden;
				width: max-content;
			}
			.switcher-pos-btn {
				appearance: none;
				border: 0;
				background: transparent;
				color: var(--text-secondary);
				font: inherit;
				font-size: 12px;
				padding: 5px 14px;
				cursor: pointer;
			}
			.switcher-pos-btn.active {
				background: var(--accent-color, #2962ff);
				color: #fff;
			}
			.show-in-switcher-field {
				display: flex;
				align-items: center;
				gap: 8px;
				font-size: 12px;
				color: var(--text-secondary);
			}
			.show-in-switcher-field input[type="checkbox"] {
				flex-shrink: 0;
			}
```

- [ ] **Step 8: Syntax + Suite**

Run: `node --check js/components/menu-panel.js && echo "SYNTAX OK"`
Run: `npx vitest run`
Expected: `SYNTAX OK`, alle Tests grün.

- [ ] **Step 9: Commit**

```bash
git add _locales/en/messages.json js/components/menu-panel.js
git commit -m "feat(menu): global header/footer switcher settings + per-sub-menu visibility"
```

---

## Task C: content.js — `buildSwitcher` (global, Helfer, Position) + `header`→`switcher`

**Files:**
- Modify: `js/content.js` (`setItems` ~Zeile 463-490; `case 'customMenu'` ~Zeile 3442-3511)

**Interfaces:**
- Consumes: `FlowMouseMenuSwitcher.buildSwitcherMenus` (Task A), `SETTINGS.customMenuSwitcher`, `SETTINGS.customMenus`, bestehende `resolveContextualMenuId`/`executeAction`/`msg`/`ACTION_KEYS`/`ACTION_DEFAULTS`/`resolveSearchLink`/`upgradeMenuIcons`.
- Produces: Transportwert **`switcher`** = `{ name, position, menus:[{id,name}] }` oder `null`, gesendet via `setItems(items, switcher)`. Task D konsumiert `switcher`.

- [ ] **Step 1: `setItems` — Parameter/Payload `header`→`switcher`**

In `js/content.js` die Methode `setItems` (~Zeile 463-490) ersetzen durch (nur `header`→`switcher` umbenannt; Omit-Semantik bleibt):

```javascript
	setItems(items, switcher) {
		if (!this.#activeMenuId) return;
		this.#activeItems = items;

		const serializedItems = items.map(item => {
			if (item === 'separator') return 'separator';
			return { label: item.label, icon: item.icon, active: item.active, time: item.time };
		});

		try {
			const payload = {
				action: 'ctxMenuSetItems',
				menuId: this.#activeMenuId,
				items: serializedItems,
			};
			if (switcher !== undefined) payload.switcher = switcher;
			chrome.runtime.sendMessage(payload);
		} catch {}

		// Push straight into the menu iframe for live updates (e.g. lazy favicons).
		// The background pull handles the initial load; runtime broadcasts don't
		// reach an embedded extension-page iframe, so postMessage directly.
		try {
			const msg = { __gestura: 'ctxItems', menuId: this.#activeMenuId, items: serializedItems };
			if (switcher !== undefined) msg.switcher = switcher;
			this.#activeIframe?.contentWindow?.postMessage(msg, '*');
		} catch {}
	}
```

- [ ] **Step 2: `case 'customMenu'` — `buildSwitcher` global gated + Position + Helfer**

In `js/content.js` den `case 'customMenu':`-Block (~Zeile 3442-3511) ersetzen durch (ersetzt `buildHeader`→`buildSwitcher`, nutzt den Helfer, gated auf `customMenuSwitcher.enabled`, Rückgabewert `switcher`):

```javascript
					case 'customMenu': {
						const initialMenuId = mergedConfig.contextual
							? resolveContextualMenuId(SETTINGS.customMenus)
							: mergedConfig.menuId;
						const menuSelectionText = (window.getSelection()?.toString() || '').trim();

						// Switcher bar (header/footer) is a global custom-menu setting.
						const buildSwitcher = (menuId) => {
							const sw = SETTINGS.customMenuSwitcher;
							if (!sw?.enabled) return null;
							const def = SETTINGS.customMenus?.[menuId];
							if (!def) return null;
							const menus = window.FlowMouseMenuSwitcher.buildSwitcherMenus(
								SETTINGS.customMenus, menuId, msg('actionCustomMenu'));
							return {
								name: def.name || msg('actionCustomMenu'),
								position: sw.position === 'footer' ? 'footer' : 'header',
								menus,
							};
						};

						const buildCustomMenu = (menuId) => {
							const menuDef = SETTINGS.customMenus?.[menuId];
							const menuItems = menuDef?.items;
							if (!menuItems) return null;
							const items = menuItems
								.filter(it => it === 'separator' || (it.action && it.action !== 'none'))
								.map(it => {
									if (it === 'separator') return 'separator';
									let label = it.customName;
									if (!label && it.action === 'actionChain') {
										const chain = SETTINGS.actionChains?.[it.chainId];
										label = chain?.name || msg(ACTION_KEYS[it.action]);
									}
									if (it.action === 'searchLink') {
										const rl = resolveSearchLink({ ...(ACTION_DEFAULTS['searchLink'] || {}), ...it });
										label = it.customName || rl?.name || msg(ACTION_KEYS['searchLink']);
										return {
											label,
											icon: rl ? rl.icon : '',
											_faviconUrl: rl && !rl.iconBundled ? rl.url : undefined,
											onClick: () => {
												const itemConfig = { ...(ACTION_DEFAULTS[it.action] || {}), ...it };
												itemConfig.__selectionText = menuSelectionText;
												executeAction(it.action, itemConfig, cursor, startTarget);
											}
										};
									}
									if (!label) label = msg(ACTION_KEYS[it.action]) || it.action;
									return {
										label,
										onClick: () => {
											const itemConfig = { ...(ACTION_DEFAULTS[it.action] || {}), ...it };
											executeAction(it.action, itemConfig, cursor, startTarget);
										}
									};
								});
							return { items, switcher: buildSwitcher(menuId) };
						};

						const initial = buildCustomMenu(initialMenuId);
						if (!initial) break;

						ctxMenu.prepare(cursor.endX, cursor.endY);
						ctxMenu.setSwitcher((id) => {
							if (!SETTINGS.customMenus?.[id]) return; // deleted → no-op, keep current
							const rebuilt = buildCustomMenu(id);
							if (!rebuilt) return;
							ctxMenu.setItems(rebuilt.items, rebuilt.switcher);
							upgradeMenuIcons(rebuilt.items);
						});
						ctxMenu.setItems(initial.items, initial.switcher);
						upgradeMenuIcons(initial.items);
						break;
					}
```

- [ ] **Step 3: Syntax + Suite**

Run: `node --check js/content.js && echo "SYNTAX OK"`
Run: `npx vitest run`
Expected: `SYNTAX OK`, alle Tests grün.

- [ ] **Step 4: Commit**

```bash
git add js/content.js
git commit -m "feat(menu): content-side switcher payload (global gate, position, helper)"
```

---

## Task D: background.js + iframe — Header/Footer-Leiste, Overlay-Auswahl, Bedarfs-Sizing

**Files:**
- Modify: `js/background.js` (`ctxMenuSetItems` ~Zeile 1006-1015; `ctxMenuFetch` ~Zeile 1017-1024)
- Modify: `js/context-menu.js` (Properties, Styles, `#onWindowMessage`, `#fetchItems`, `#measureAndReport`, `#toggleSwitcher`, `render()`)

**Interfaces:**
- Consumes: `switcher` aus `setItems` (Task C).
- Produces: gerenderte Header/Footer-Leiste + Overlay-Auswahl; sendet weiterhin `ctxMenuSwitch { menuId, id }`.

### Teil 1 — background.js: `header`→`switcher`

- [ ] **Step 1: Session-Relay umbenennen**

In `js/background.js` `case 'ctxMenuSetItems'` (~Zeile 1010) die Header-Zeile ersetzen:

```javascript
			if ('switcher' in request) session.latestSwitcher = request.switcher;
```

Und `case 'ctxMenuFetch'` (~Zeile 1017-1024) ersetzen durch:

```javascript
		case 'ctxMenuFetch': {
			const session = ctxMenuSessions.get(request.menuId);
			if (!session) return { items: [], switcher: null };
			// Return the latest items; if none have been set yet, wait for the first.
			if (session.latest !== undefined) return { items: session.latest, switcher: session.latestSwitcher ?? null };
			await new Promise((r) => { session.waiters.push(r); setTimeout(r, 10000); });
			return { items: session.latest ?? null, switcher: session.latestSwitcher ?? null };
		}
```

- [ ] **Step 2: background-Syntax**

Run: `node --check js/background.js && echo "SYNTAX OK"`
Expected: `SYNTAX OK`

### Teil 2 — context-menu.js: State/Transport umbenennen

- [ ] **Step 3: Properties + constructor**

In `js/context-menu.js` `static properties` (~Zeile 9-17): `_header` → `_switcher` umbenennen. Im `constructor` (~Zeile 178) `this._header = null;` → `this._switcher = null;`.

- [ ] **Step 4: `#fetchItems` + `#onWindowMessage`**

In `#fetchItems` (~Zeile 285) `this._header = response.header ?? null;` → `this._switcher = response.switcher ?? null;`.

In `#onWindowMessage` (~Zeile 232) `if ('header' in d) this._header = d.header ?? null;` → `if ('switcher' in d) this._switcher = d.switcher ?? null;`.

- [ ] **Step 5: `updated`, `#toggleSwitcher`**

In `updated` (~Zeile 296) `changedProperties.has('_header')` → `changedProperties.has('_switcher')`.

In `#toggleSwitcher` (~Zeile 390-394) `this._header?.menus?.length` → `this._switcher?.menus?.length`.

### Teil 3 — context-menu.js: Rendering (Leiste + Overlay)

- [ ] **Step 6: `render()` neu strukturieren (Root + Body + Leiste + Overlay)**

Ersetze die gesamte `render()`-Methode (~Zeile 418-476) durch:

```javascript
	#chevron(position) {
		const down = '▾', up = '▴';
		if (position === 'footer') return this._switcherOpen ? down : up;
		return this._switcherOpen ? up : down;
	}

	render() {
		if (this._items === null) return '';

		const customCss = this.preview ? (this.previewCss || '') : this._customCss;
		const sw = this._switcher;
		const position = sw?.position === 'footer' ? 'footer' : 'header';
		const hasMenus = !!sw?.menus?.length;

		const bar = sw ? html`
			<div class="fm-ctx-bar${hasMenus ? ' fm-ctx-bar--switchable' : ''}"
				role=${hasMenus ? 'button' : 'presentation'}
				tabindex=${hasMenus ? '0' : '-1'}
				aria-expanded=${this._switcherOpen ? 'true' : 'false'}
				@click=${this.#toggleSwitcher}
				@keydown=${(e) => { if ((e.key === 'Enter' || e.key === ' ') && hasMenus) { e.preventDefault(); this.#toggleSwitcher(e); } }}
			>
				<span class="fm-ctx-bar-name">${sw.name || ''}</span>
				${hasMenus ? html`<span class="fm-ctx-bar-chevron">${this.#chevron(position)}</span>` : ''}
			</div>
		` : '';

		const overlay = (sw && this._switcherOpen && hasMenus) ? html`
			<ul class="fm-ctx-switcher fm-ctx-switcher--${position}" role="menu">
				${sw.menus.map(m => html`
					<li class="fm-ctx-switch-item" role="menuitem" tabindex="-1" data-switch-id=${m.id}
						@click=${(e) => { e.stopPropagation(); this.#switchTo(m.id); }}
					>
						<span class="fm-ctx-label">${m.name || ''}</span>
					</li>
				`)}
			</ul>
		` : '';

		const list = html`
			<ul class="fm-ctx-list" role="menu">
				${!this._items.length ? html`
					<li class="fm-ctx-item fm-ctx-item--empty" aria-disabled="true">
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-off-icon lucide-circle-off"><path d="m2 2 20 20"/><path d="M8.35 2.69A10 10 0 0 1 21.3 15.65"/><path d="M19.08 19.08A10 10 0 1 1 4.92 4.92"/></svg>
					</li>
				` : ''}
				${this._items.map((item, i) => {
					if (item === 'separator') {
						return html`<li class="fm-ctx-sep" role="separator"></li>`;
					}
					return html`
						<li
							class="fm-ctx-item${item.active ? ' fm-ctx-item--active' : ''}"
							role="menuitem"
							tabindex="-1"
							data-index=${i}
							@click=${() => this.#selectItem(i)}
							@mouseup=${(e) => { if (e.buttons === 0 && (e.button === 0 || e.button === 2)) this.#selectItem(i); }}
						>
							<span class="fm-ctx-icon">
								${item.icon ? html`<img src="${item.icon}" alt="" draggable="false">` : ''}
							</span>
							<span class="fm-ctx-label">${item.label || ''}</span>
							${item.time ? html`<span class="fm-ctx-time">${this.#formatTime(item.time)}</span>` : ''}
						</li>
					`;
				})}
			</ul>
		`;

		return html`
			${customCss ? html`<style>${customCss}</style>` : ''}
			<div class="fm-ctx-root fm-ctx-root--${position}">
				${position === 'header' ? bar : ''}
				<div class="fm-ctx-body">
					${list}
					${overlay}
				</div>
				${position === 'footer' ? bar : ''}
			</div>
		`;
	}
```

### Teil 4 — context-menu.js: Styles

- [ ] **Step 7: Styles anpassen**

Ersetze im `static styles`-Block die Regel `.fm-ctx-menu { ... }` und `.fm-ctx-menu.loaded { ... }` (~Zeile 25-42) durch:

```javascript
		.fm-ctx-root {
			font-family: 'Segoe UI', sans-serif;
			font-size: 12.5px;
			line-height: 19px;
			color: #1d1d1f;
			display: flex;
			flex-direction: column;
			width: max-content;
			min-width: 160px;
			max-width: 340px;
		}
		.fm-ctx-root.loaded {
			width: auto;
			max-width: 343px;
		}
		.fm-ctx-list {
			list-style: none;
			margin: 0;
			padding: 4px 0;
		}
		.fm-ctx-body {
			position: relative;
		}
		.fm-ctx-root--footer .fm-ctx-body {
			display: flex;
			flex-direction: column;
			justify-content: flex-end;
		}
```

Ersetze weiter den gesamten R1-Header-Styleblock (`.fm-ctx-header` … bis inkl. des ersten `@media (prefers-color-scheme: dark) { .fm-ctx-header--switchable... }`, ~Zeile 108-154) durch:

```javascript
		.fm-ctx-bar {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 6px 12px;
			font-weight: 600;
			white-space: nowrap;
			background: rgba(41, 98, 255, 0.07);
		}
		.fm-ctx-root--header .fm-ctx-bar {
			border-bottom: 1px solid rgba(0, 0, 0, 0.06);
		}
		.fm-ctx-root--footer .fm-ctx-bar {
			border-top: 1px solid rgba(0, 0, 0, 0.06);
		}
		.fm-ctx-bar--switchable {
			cursor: default;
		}
		.fm-ctx-bar--switchable:hover,
		.fm-ctx-bar--switchable:focus-visible {
			background: rgba(41, 98, 255, 0.13);
		}
		.fm-ctx-bar-name {
			flex: 1;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.fm-ctx-bar-chevron {
			flex-shrink: 0;
			opacity: 0.55;
			font-size: 0.9em;
		}
		.fm-ctx-switcher {
			position: absolute;
			left: 0;
			min-width: 100%;
			width: max-content;
			max-width: 343px;
			margin: 0;
			padding: 4px 0;
			list-style: none;
			z-index: 2;
			background: #ffffff;
			box-shadow: 0 4px 16px rgba(0, 0, 0, 0.20);
			border-radius: 6px;
		}
		.fm-ctx-switcher--header { top: 0; }
		.fm-ctx-switcher--footer { bottom: 0; }
		.fm-ctx-switch-item {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 4px 12px;
			cursor: default;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.fm-ctx-switch-item:hover,
		.fm-ctx-switch-item:focus-visible {
			background: rgba(0, 0, 0, 0.08);
		}
		@media (prefers-color-scheme: dark) {
			.fm-ctx-root { color: #e5e5e7; }
			.fm-ctx-bar {
				background: rgba(120, 160, 255, 0.13);
			}
			.fm-ctx-root--header .fm-ctx-bar { border-bottom-color: rgba(255, 255, 255, 0.08); }
			.fm-ctx-root--footer .fm-ctx-bar { border-top-color: rgba(255, 255, 255, 0.08); }
			.fm-ctx-bar--switchable:hover,
			.fm-ctx-bar--switchable:focus-visible {
				background: rgba(120, 160, 255, 0.22);
			}
			.fm-ctx-switcher {
				background: #232326;
			}
			.fm-ctx-switch-item:hover,
			.fm-ctx-switch-item:focus-visible {
				background: rgba(255, 255, 255, 0.1);
			}
		}
```

Hinweis: Der verbleibende zweite `@media (prefers-color-scheme: dark)`-Block (mit `.fm-ctx-menu { color:#e5e5e7 } .fm-ctx-item:hover … .fm-ctx-sep`) muss angepasst werden: entferne dort die nun doppelte `.fm-ctx-menu { color: … }`-Regel (die Farbe steht jetzt in `.fm-ctx-root`), belasse `.fm-ctx-item:hover/focus-visible` und `.fm-ctx-sep`.

### Teil 5 — context-menu.js: Bedarfs-Sizing

- [ ] **Step 8: `#measureAndReport` — Root messen, Body bei offener Auswahl wachsen**

Ersetze `#measureAndReport()` (~Zeile 301-344) durch:

```javascript
	#measureAndReport() {
		if (this._items === null) return;
		const root = this.renderRoot.querySelector('.fm-ctx-root');
		if (!root) return;

		const hasSwitcher = !!this._switcher;
		// Switcher-less menus keep the original one-shot behaviour.
		if (this.#dimensionsSent && !hasSwitcher) return;

		const firstReport = !this.#dimensionsSent;

		// The open selection is an absolute overlay; grow the body to its size so
		// the overlay is never clipped. When closed (or absent) the body is just
		// the items and the overlay floats over them without resizing the output.
		const body = this.renderRoot.querySelector('.fm-ctx-body');
		const overlay = this.renderRoot.querySelector('.fm-ctx-switcher');
		if (body) {
			if (overlay) {
				body.style.minHeight = Math.ceil(overlay.offsetHeight) + 'px';
				body.style.minWidth = Math.ceil(overlay.offsetWidth) + 'px';
			} else {
				body.style.minHeight = '';
				body.style.minWidth = '';
			}
		}

		const sendDimensions = (width, height) => {
			this.#dimensionsSent = true;
			root.classList.add('loaded');
			chrome.runtime.sendMessage({
				action: 'ctxMenuDimensions',
				menuId: this.#menuId,
				width,
				height,
			});
			if (firstReport) {
				if (this.#scrollToBottom) {
					requestAnimationFrame(() => { document.documentElement.scrollTop = document.documentElement.scrollHeight; });
				}
				window.focus();
				window.addEventListener('blur', this.#close);
			}
		};

		// Re-measure once per layout change; ResizeObserver would loop if kept.
		const resizeObserver = new ResizeObserver((entries) => {
			const entry = entries[entries.length - 1];
			const size = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize;
			resizeObserver.disconnect();
			sendDimensions(Math.ceil(size.inlineSize) + 1, Math.ceil(size.blockSize));
		});
		resizeObserver.observe(root, { box: 'border-box' });

		const rect = root.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) {
			resizeObserver.disconnect();
			sendDimensions(Math.ceil(rect.width) + 1, Math.ceil(rect.height));
		}
	}
```

- [ ] **Step 9: Syntax + Suite**

Run: `node --check js/context-menu.js && echo "SYNTAX OK"`
Run: `npx vitest run`
Expected: `SYNTAX OK`, alle Tests grün.

- [ ] **Step 10: Commit**

```bash
git add js/background.js js/context-menu.js
git commit -m "feat(menu): header/footer switcher bar with overlay selection + on-demand sizing"
```

### Teil 6 — manuelle End-to-End-Verifikation (Controller)

- [ ] **Step 11: Manuell im Browser** (nicht durch Implementer-Subagent; der Controller führt das aus)

Entpackt neu laden. Mind. drei Untermenüs (z. B. „Standard" mit vielen Items, „Mini" mit 2 Items, „Coding"). Global „Show header/footer" aktivieren. Prüfen:
1. Position=Header: Leiste oben, farblich abgesetzt, zeigt aktuellen Namen + Chevron.
2. Position=Footer: Leiste unten, Chevron zeigt nach oben; Umschalten wählt aufwärts.
3. Auflisten: alle Untermenüs mit „In Menü-Auswahl anzeigen"=an außer dem aktuellen; ein Untermenü mit Häkchen aus fehlt in der Liste.
4. Overlay: Aufklappen legt sich über die Items, ohne bei großem Untermenü die Ausgabe zu vergrößern.
5. Bedarfs-Wachstum: bei „Mini" (2 Items) + vielen Auswahl-Einträgen wächst die Ausgabe, nichts wird abgeschnitten; im Viewport bleibend.
6. Umschalten ersetzt Inhalt in-place; nächste Geste öffnet wieder das konfigurierte Untermenü (flüchtig).
7. Global deaktiviert: keine Leiste, Ausgabe wie vor R2 (One-Shot). Tabs/Bookmarks-Menüs unverändert.
8. Favicon-Menü (searchLink) mit aktiver Leiste: Leiste bleibt beim Nachladen der Favicons erhalten (R1-Fix intakt).
9. Konsole der Seite + Service-Worker-Log: keine Fehler.

---

## Self-Review

**Spec-Abdeckung (Revision 2):**
- Globaler Schalter statt pro-Untermenü → Task A (Default) + Task B (UI, `customMenuSwitcher.enabled`). ✓
- Header **oder** Footer → Task B (Position-Control) + Task C (`position` im switcher) + Task D (Render/Styles/Chevron). ✓
- Pro-Untermenü `showInSwitcher` → Task A (Helfer-Filter) + Task B (Checkbox). ✓
- Farbig abgesetzte Leiste → Task D (`.fm-ctx-bar` Akzent-Hintergrund, hell/dunkel). ✓
- Overlay statt Vergrößern; Wachstum nur bei Bedarf → Task D (`.fm-ctx-switcher` absolut, `#measureAndReport` Body-min-Height/Width aus Overlay). ✓
- Liste = alle mit `showInSwitcher` außer aktuell, in Reihenfolge → Task A `buildSwitcherMenus` (+ Unit-Test). ✓
- Flüchtig, in-place, Escape, Tastatur-Aktivierung → aus R1 übernommen (Task C `setSwitcher`, Task D `#switchTo`/`#onKeyDown`/`data-switch-id`). ✓
- Umbenennung `header`→`switcher` → Tasks C (content) + D (background, iframe). ✓
- Rückwärtskompatibel (kein switcher → One-Shot) → Task D `#measureAndReport`-Guard + `setItems`-Omit-Semantik. ✓
- R1-Reste entfernt (`showHeader`, `menuShowHeader*`) → Task B (i18n) + Task C (buildHeader ersetzt). ✓

**Placeholder-Scan:** keine TBD/TODO; jeder Code-Schritt enthält vollständigen Code. ✓

**Typ-/Namenskonsistenz:** `customMenuSwitcher {enabled, position}` (A/B/C), `switcher {name, position, menus:[{id,name}]}` (C/D transport + background `latestSwitcher`/`'switcher' in`), `buildSwitcherMenus(customMenus, currentId, fallbackName)` (A def, C call), `_switcher`/`_switcherOpen`/`data-switch-id`/`#switchTo` (D), `showInSwitcher` (A filter, B checkbox). Konsistent. ✓
