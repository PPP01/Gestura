# Umschaltbarer Custom-Menü-Header — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jedes Custom-Menü kann optional eine Kopfzeile zeigen, die den Menünamen anzeigt und per Dropdown das Umschalten auf ein beliebiges anderes Custom-Menü (in-place, flüchtig) erlaubt.

**Architecture:** Ein optionales `header`-Objekt wird zusätzlich zu den Items durch die bestehende Menü-Pipeline (content.js → background-Session → context-menu.js-Iframe) transportiert. Das Iframe rendert Header + Dropdown und meldet bei Layout-Änderungen wiederholt seine Größe zurück; der Content-Script baut die Items bei einem Umschalt-Klick neu und sendet sie erneut. Ein neuer `showHeader`-Schalter pro Menü steuert das Feature.

**Tech Stack:** Plain JS (MV3-Extension, kein Build), Lit (vendored), `chrome.runtime`/`chrome.tabs`-Messaging, vitest (nur für reine Helfer).

## Global Constraints

- Einrückung: **Tabs**, nicht Spaces (gesamtes Repo).
- Kein Build-Step, kein Bundler, keine ES-Module in Content-Scripts (`window.*`-Globals). UI-Komponenten nutzen ES-`import`.
- `DEFAULT_SETTINGS` in [js/constants.js](../../../js/constants.js) bleibt die einzige Quelle für die Settings-Form; neue Menü-Flags sind optional (Abwesenheit = aus).
- Es gibt **kein Test-Harness für Content-Scripts oder Lit-UI**. Diese Teile werden manuell verifiziert (Ordner als entpackte Erweiterung laden, Reload-Icon klicken). Die bestehende `vitest`-Suite (`npx vitest run`, 122 Tests) muss grün bleiben und dient als Regressions-Gate.
- Menü-Rendering ist rückwärtskompatibel: Menüs ohne `header` verhalten sich exakt wie bisher (One-Shot-Sizing, kein Header).
- Alle neuen sichtbaren Strings über i18n (`_locales/en/messages.json`, `en` ist `default_locale`; andere Sprachen fallen bis zur Übersetzung auf Englisch zurück).

---

## Datei-Übersicht

- **Ändern** [js/components/menu-panel.js](../../../js/components/menu-panel.js) — `showHeader`-Toggle im Menü-Editor + lokale Styles.
- **Ändern** [_locales/en/messages.json](../../../_locales/en/messages.json) — zwei neue i18n-Keys.
- **Ändern** [js/background.js](../../../js/background.js) — `header` durch Set/Fetch-Session tragen; neuen `ctxMenuSwitch`-Forward-Case.
- **Ändern** [js/context-menu.js](../../../js/context-menu.js) — Header + Dropdown rendern; `ctxMenuSwitch` senden; wiederholbares Dimensions-Reporting bei vorhandenem Header; Header-Styles.
- **Ändern** [js/content.js](../../../js/content.js) — `buildCustomMenu(menuId)` extrahieren; Header berechnen; `setItems(items, header)`; `setSwitcher(fn)` + `ctxMenuSwitch`-Handling; wiederholbares Repositionieren.

Reihenfolge: Task 1 (UI, eigenständig) → Task 2 (Background-Protokoll) → Task 3 (Iframe-Rendering) → Task 4 (Content-Verdrahtung, End-to-End). End-to-End funktioniert erst nach Task 4; Tasks 2 und 3 werden mit Zwischenprüfungen (manuell/mocked) abgenommen.

---

## Task 1: Per-Menü-Toggle „Header/Umschalter anzeigen" (Options-UI)

**Files:**
- Modify: `_locales/en/messages.json` (nach Block `customMenuContextualLabel`, ~Zeile 1733)
- Modify: `js/components/menu-panel.js` (Styles ~Zeile 72; `render()` ~Zeile 298; neue Methode nach `#renderNameField` ~Zeile 350)

**Interfaces:**
- Consumes: nichts (eigenständig).
- Produces: Settings-Flag `SETTINGS.customMenus[id].showHeader: boolean`. Task 4 liest dieses Flag.

- [ ] **Step 1: i18n-Keys hinzufügen**

In `_locales/en/messages.json` direkt nach dem `customMenuContextualLabel`-Block (endet ~Zeile 1733 mit `}`) einfügen:

```json
	"menuShowHeader": {
		"message": "Show header with menu switcher",
		"description": "Toggle label in the menu editor — when on, the popup menu shows a header with the menu name and a dropdown to switch to another menu"
	},
	"menuShowHeaderHint": {
		"message": "Adds a title row to this menu. Click it to switch to another menu on the fly.",
		"description": "Hint shown next to the show-header toggle in the menu editor"
	},
```

Achte auf gültiges JSON (Komma nach dem vorherigen Block, kein Komma-Fehler).

- [ ] **Step 2: JSON-Gültigkeit prüfen**

Run: `node -e "JSON.parse(require('fs').readFileSync('_locales/en/messages.json','utf8')); console.log('JSON OK')"`
Expected: `JSON OK`

- [ ] **Step 3: Lokale Styles für die Header-Zeile ergänzen**

In `js/components/menu-panel.js` nach dem `input.name-input { ... }`-Block (~Zeile 72, vor `.items-container`) einfügen:

```javascript
			.header-toggle-field {
				display: flex;
				align-items: flex-start;
				gap: 10px;
				margin-block: 2px 4px;
			}
			.header-toggle-field input[type="checkbox"] {
				margin-top: 2px;
				flex-shrink: 0;
			}
			.header-toggle-text {
				display: flex;
				flex-direction: column;
				gap: 3px;
			}
			.header-toggle-label {
				font-size: 12px;
				font-weight: 600;
				color: var(--text-secondary);
			}
			.header-toggle-hint {
				font-size: 11px;
				color: var(--text-secondary);
				opacity: 0.8;
			}
```

- [ ] **Step 4: Render-Methode hinzufügen**

In `js/components/menu-panel.js` direkt nach `#renderNameField(...) { ... }` (endet ~Zeile 350) einfügen:

```javascript
	#renderHeaderToggle(activeId, menu) {
		const i18n = window.i18n;
		return html`
			<label class="header-toggle-field">
				<input type="checkbox"
					.checked=${!!menu.showHeader}
					@change=${(e) => this.#updateMenu(activeId, { showHeader: e.target.checked })}
				>
				<span class="header-toggle-text">
					<span class="header-toggle-label">${i18n.getMessage('menuShowHeader')}</span>
					<span class="header-toggle-hint">${i18n.getMessage('menuShowHeaderHint')}</span>
				</span>
			</label>
		`;
	}
```

- [ ] **Step 5: Render-Methode einbinden**

In `js/components/menu-panel.js` im `render()` (~Zeile 296-299) den Aufruf zwischen Name- und Patterns-Feld einfügen:

```javascript
			${this.#renderSelectorRow(entries, activeId)}
			${this.#renderNameField(activeId, activeMenu)}
			${this.#renderHeaderToggle(activeId, activeMenu)}
			${this.#renderPatternsSection(activeId, activeMenu)}
			${this.#renderItemsSection(activeId, activeMenu)}
```

- [ ] **Step 6: Syntax prüfen**

Run: `node --check js/components/menu-panel.js && echo "SYNTAX OK"`
Expected: `SYNTAX OK`

- [ ] **Step 7: Regressions-Gate**

Run: `npx vitest run`
Expected: alle Tests grün (unverändert 122 passed).

- [ ] **Step 8: Manuelle Verifikation**

Erweiterung unter `chrome://extensions` neu laden → Optionsseite öffnen → Custom-Menü-Bereich. Erwartung: Unter dem Namensfeld erscheint der Toggle „Show header with menu switcher" mit Hinweistext. Aktivieren, Seite neu öffnen → der Zustand bleibt erhalten (in `chrome.storage.sync` als `customMenus[id].showHeader` gespeichert).

- [ ] **Step 9: Commit**

```bash
git add _locales/en/messages.json js/components/menu-panel.js
git commit -m "feat(menu): per-menu 'show header' toggle in menu editor"
```

---

## Task 2: Header durch Background-Session tragen + `ctxMenuSwitch`-Forward

**Files:**
- Modify: `js/background.js` (`ctxMenuSetItems` ~Zeile 1006; `ctxMenuFetch` ~Zeile 1016; neuer Case nach `ctxMenuSelect` ~Zeile 1047)

**Interfaces:**
- Consumes: bestehende `ctxMenuSessions`-Map (`{ tabId, frameId, latest, waiters }`).
- Produces:
  - `ctxMenuSetItems`-Request akzeptiert optionales `header` → in `session.latestHeader` gespeichert.
  - `ctxMenuFetch`-Response: `{ items, header }` (`header` = `null`, falls keiner gesetzt).
  - Neuer Message-Type `ctxMenuSwitch { menuId, id }`: wird an das Content-Frame weitergeleitet (Session bleibt bestehen, wird **nicht** gelöscht).

- [ ] **Step 1: `header` beim Setzen speichern**

In `js/background.js`, `case 'ctxMenuSetItems'` (~Zeile 1006-1014), ersetzen durch:

```javascript
		case 'ctxMenuSetItems': {
			const session = ctxMenuSessions.get(request.menuId);
			if (!session) return { success: false };
			session.latest = request.items;
			if ('header' in request) session.latestHeader = request.header;
			const waiters = session.waiters;
			session.waiters = [];
			waiters.forEach((r) => r());
			return { success: true };
		}
```

- [ ] **Step 2: `header` beim Abruf zurückgeben**

In `js/background.js`, `case 'ctxMenuFetch'` (~Zeile 1016-1023), ersetzen durch:

```javascript
		case 'ctxMenuFetch': {
			const session = ctxMenuSessions.get(request.menuId);
			if (!session) return { items: [], header: null };
			// Return the latest items; if none have been set yet, wait for the first.
			if (session.latest !== undefined) return { items: session.latest, header: session.latestHeader ?? null };
			await new Promise((r) => { session.waiters.push(r); setTimeout(r, 10000); });
			return { items: session.latest ?? null, header: session.latestHeader ?? null };
		}
```

- [ ] **Step 3: `ctxMenuSwitch`-Forward-Case hinzufügen**

In `js/background.js` direkt nach dem `case 'ctxMenuSelect'`-Block (endet ~Zeile 1047 mit `}`) einfügen. Anders als `ctxMenuSelect` wird die Session **nicht** gelöscht, da das Menü offen bleibt:

```javascript
		case 'ctxMenuSwitch': {
			const session = ctxMenuSessions.get(request.menuId);
			if (!session) return;
			chrome.tabs.sendMessage(session.tabId, {
				action: 'ctxMenuSwitch',
				menuId: request.menuId,
				id: request.id,
			}, { frameId: session.frameId }).catch(() => {});
			return { success: true };
		}
```

- [ ] **Step 4: Syntax prüfen**

Run: `node --check js/background.js && echo "SYNTAX OK"`
Expected: `SYNTAX OK`

- [ ] **Step 5: Regressions-Gate**

Run: `npx vitest run`
Expected: alle Tests grün.

- [ ] **Step 6: Manuelle Verifikation**

Erweiterung neu laden. Da noch kein Sender/Empfänger den neuen Type nutzt, ist das Ziel hier nur: Service-Worker startet fehlerfrei (kein Syntaxfehler im „service worker"-Log der Extension-Karte). Bestehende Custom-Menüs öffnen weiterhin normal (Fetch-Pfad liefert jetzt `{items, header:null}`, Iframe ignoriert `header` noch).

- [ ] **Step 7: Commit**

```bash
git add js/background.js
git commit -m "feat(menu): carry header through ctxMenu session; add ctxMenuSwitch forward"
```

---

## Task 3: Iframe rendert Header + Dropdown + wiederholbares Sizing (`js/context-menu.js`)

**Files:**
- Modify: `js/context-menu.js` (properties ~Zeile 9; `#onWindowMessage` ~Zeile 175; `#fetchItems` ~Zeile 225; `updated`/`#measureAndReport` ~Zeile 235-283; `render()` ~Zeile 343; `static styles` ~Zeile 17)

**Interfaces:**
- Consumes: Fetch-Response `{ items, header }` (Task 2) und postMessage `{ __gestura:'ctxItems', menuId, items, header }` (Task 4).
- Produces: sendet `chrome.runtime.sendMessage({ action:'ctxMenuSwitch', menuId, id })` beim Klick auf einen Dropdown-Eintrag (Ziel-Menü-`id`). `header`-Form: `{ name: string, menus: Array<{id:string, name:string}> }` oder `null`.

- [ ] **Step 1: State-Properties für Header/Dropdown ergänzen**

In `js/context-menu.js`, `static properties` (~Zeile 9-15), ergänzen um:

```javascript
	static properties = {
		_items: { state: true },
		_header: { state: true },
		_switcherOpen: { state: true },
		_customCss: { state: true },
		preview: { type: Boolean },
		previewItems: { attribute: false },
		previewCss: { attribute: false },
	};
```

Und im `constructor` (nach `this._items = null;`, ~Zeile 127) initialisieren:

```javascript
		this._items = null;
		this._header = null;
		this._switcherOpen = false;
```

- [ ] **Step 2: Header aus Fetch übernehmen**

In `js/context-menu.js`, `#fetchItems` (~Zeile 225-233), den Response-Handler ersetzen durch:

```javascript
	#fetchItems() {
		chrome.runtime.sendMessage({ action: 'ctxMenuFetch', menuId: this.#menuId }, (response) => {
			if (chrome.runtime.lastError || !response?.items) {
				this.#close();
				return;
			}
			this._items = response.items;
			this._header = response.header ?? null;
		});
	}
```

- [ ] **Step 3: Header aus Live-postMessage übernehmen**

In `js/context-menu.js`, `#onWindowMessage` (~Zeile 175-181), den Rumpf ersetzen durch:

```javascript
	#onWindowMessage = (e) => {
		if (e.source !== window.parent) return;
		const d = e.data;
		if (d && d.__gestura === 'ctxItems' && d.menuId === this.#menuId && Array.isArray(d.items)) {
			this._items = d.items;
			if ('header' in d) this._header = d.header ?? null;
		}
	};
```

- [ ] **Step 4: Wiederholbares Dimensions-Reporting bei vorhandenem Header**

Hintergrund: Aktuell meldet `#measureAndReport` die Größe genau einmal (`#dimensionsSent`-Latch, ResizeObserver disconnected). Header-Menüs ändern ihre Größe (Dropdown auf/zu, Umschalten) und müssen wiederholt melden. Einmalige Aktionen (Fokus, Blur-Listener, `loaded`-Klasse, `scrollToBottom`) dürfen nur beim ersten Mal laufen.

In `js/context-menu.js` `updated(changedProperties)` (~Zeile 235-245) so anpassen, dass auch Header-/Dropdown-Änderungen neu vermessen:

```javascript
	updated(changedProperties) {
		if (this.preview) {
			if (changedProperties.has('previewItems')) {
				this._items = Array.isArray(this.previewItems) ? this.previewItems : [];
			}
			return;
		}
		if (changedProperties.has('_items') || changedProperties.has('_header') || changedProperties.has('_switcherOpen')) {
			this.#measureAndReport();
		}
	}
```

Danach `#measureAndReport` (~Zeile 247-283) vollständig ersetzen durch eine Version, die bei Header-Menüs wiederholt meldet und First-Time-Setup trennt:

```javascript
	#measureAndReport() {
		if (this._items === null) return;
		const list = this.renderRoot.querySelector('ul');
		if (!list) return;

		const hasHeader = !!this._header;
		// Headerless menus keep the original one-shot behaviour.
		if (this.#dimensionsSent && !hasHeader) return;

		const firstReport = !this.#dimensionsSent;

		const sendDimensions = (width, height) => {
			this.#dimensionsSent = true;
			list.classList.add('loaded');
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
		resizeObserver.observe(list, { box: 'border-box' });

		const rect = list.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) {
			resizeObserver.disconnect();
			sendDimensions(Math.ceil(rect.width) + 1, Math.ceil(rect.height));
		}
	}
```

Hinweis: `#dimensionsSent` bleibt als Feld erhalten; es wird jetzt nur noch als „First-Report"-Marker genutzt, nicht mehr als harter Stopp für Header-Menüs.

- [ ] **Step 5: Switch-/Toggle-Handler + Selektion**

In `js/context-menu.js` nach `#selectItem(index)` (~Zeile 325) einfügen:

```javascript
	#toggleSwitcher = (e) => {
		e.stopPropagation();
		if (!this._header?.menus?.length) return;
		this._switcherOpen = !this._switcherOpen;
	};

	#switchTo(id) {
		if (this.preview) return;
		this._switcherOpen = false;
		chrome.runtime.sendMessage({ action: 'ctxMenuSwitch', menuId: this.#menuId, id });
	}
```

Zusätzlich in `#onKeyDown` (~Zeile 289) `Escape` so anpassen, dass ein offenes Dropdown zuerst geschlossen wird:

```javascript
		if (e.key === 'Escape') {
			e.preventDefault();
			if (this._switcherOpen) { this._switcherOpen = false; return; }
			this.#close();
			return;
		}
```

- [ ] **Step 6: Header + Dropdown rendern**

In `js/context-menu.js` `render()` (~Zeile 343-380) den `<ul ...>`-Block so erweitern, dass vor der Item-Liste bei vorhandenem Header eine Kopfzeile erscheint. Ersetze den Beginn des `return html\`...\``-Ausdrucks (ab `<ul class="fm-ctx-menu" role="menu">`) durch:

```javascript
			<ul class="fm-ctx-menu" role="menu">
				${this._header ? html`
					<li class="fm-ctx-header${this._header.menus?.length ? ' fm-ctx-header--switchable' : ''}"
						role=${this._header.menus?.length ? 'button' : 'presentation'}
						tabindex=${this._header.menus?.length ? '0' : '-1'}
						aria-expanded=${this._switcherOpen ? 'true' : 'false'}
						@click=${this.#toggleSwitcher}
						@keydown=${(e) => { if ((e.key === 'Enter' || e.key === ' ') && this._header.menus?.length) { e.preventDefault(); this.#toggleSwitcher(e); } }}
					>
						<span class="fm-ctx-header-name">${this._header.name || ''}</span>
						${this._header.menus?.length ? html`<span class="fm-ctx-header-chevron">${this._switcherOpen ? '▴' : '▾'}</span>` : ''}
					</li>
					${this._switcherOpen ? this._header.menus.map(m => html`
						<li class="fm-ctx-switch-item" role="menuitem" tabindex="-1"
							@click=${(e) => { e.stopPropagation(); this.#switchTo(m.id); }}
						>
							<span class="fm-ctx-icon"></span>
							<span class="fm-ctx-label">${m.name || ''}</span>
						</li>
					`) : ''}
					<li class="fm-ctx-sep" role="separator"></li>
				` : ''}
```

Der bestehende Empty-State- und Item-`map`-Block bleibt unverändert darunter, gefolgt von `</ul>`.

- [ ] **Step 7: Header-Styles ergänzen**

In `js/context-menu.js` `static styles` (im `css\`...\``-Block, z.B. nach `.fm-ctx-sep { ... }` ~Zeile 97) einfügen:

```javascript
		.fm-ctx-header {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 5px 12px;
			font-weight: 600;
			white-space: nowrap;
		}
		.fm-ctx-header--switchable {
			cursor: default;
		}
		.fm-ctx-header--switchable:hover,
		.fm-ctx-header--switchable:focus-visible {
			background: rgba(0, 0, 0, 0.08);
		}
		.fm-ctx-header-name {
			flex: 1;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.fm-ctx-header-chevron {
			flex-shrink: 0;
			opacity: 0.55;
			font-size: 0.9em;
		}
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
			.fm-ctx-header--switchable:hover,
			.fm-ctx-header--switchable:focus-visible,
			.fm-ctx-switch-item:hover,
			.fm-ctx-switch-item:focus-visible {
				background: rgba(255, 255, 255, 0.1);
			}
		}
```

- [ ] **Step 8: Syntax prüfen**

Run: `node --check js/context-menu.js && echo "SYNTAX OK"`
Expected: `SYNTAX OK`

- [ ] **Step 9: Regressions-Gate**

Run: `npx vitest run`
Expected: alle Tests grün.

- [ ] **Step 10: Manuelle Zwischenprüfung (mit Task-4-Vorgriff nicht nötig)**

Da der Content-Script den Header erst in Task 4 sendet, ist hier nur zu prüfen: Bestehende Menüs (ohne Header) öffnen unverändert und mit korrekter Größe/Position (One-Shot-Pfad intakt). Optional: im „context-menu.html"-Preview-Modus (Menü-Editor-Vorschau) erscheint weiterhin nur die Item-Liste ohne Header.

- [ ] **Step 11: Commit**

```bash
git add js/context-menu.js
git commit -m "feat(menu): render switchable header + dropdown, repeatable sizing"
```

---

## Task 4: Content-Verdrahtung — Items neu bauen, Header berechnen, Umschalten (`js/content.js`)

**Files:**
- Modify: `js/content.js` (`ContentContextMenu.setItems` ~Zeile 462-486; neuer `setSwitcher` + Feld; `#createMenuIframe` onMessage ~Zeile 524-571; `case 'customMenu'` ~Zeile 3429-3473)

**Interfaces:**
- Consumes: `resolveContextualMenuId`, `executeAction`, `resolveSearchLink`, `ACTION_DEFAULTS`, `ACTION_KEYS`, `msg`, `upgradeMenuIcons`, `SETTINGS` (alle im `initGestures`-Scope), sowie Background-`ctxMenuSwitch`-Forward (Task 2) und Iframe-`header`-Rendering (Task 3).
- Produces: nichts für spätere Tasks (letzter Task).

- [ ] **Step 1: `setItems` um optionalen Header erweitern**

In `js/content.js`, `ContentContextMenu.setItems` (~Zeile 462-486), Signatur und Payloads erweitern. Ersetzen durch:

```javascript
	setItems(items, header = null) {
		if (!this.#activeMenuId) return;
		this.#activeItems = items;

		const serializedItems = items.map(item => {
			if (item === 'separator') return 'separator';
			return { label: item.label, icon: item.icon, active: item.active, time: item.time };
		});

		try {
			chrome.runtime.sendMessage({
				action: 'ctxMenuSetItems',
				menuId: this.#activeMenuId,
				items: serializedItems,
				header,
			});
		} catch {}

		// Push straight into the menu iframe for live updates (e.g. lazy favicons).
		// The background pull handles the initial load; runtime broadcasts don't
		// reach an embedded extension-page iframe, so postMessage directly.
		try {
			this.#activeIframe?.contentWindow?.postMessage(
				{ __gestura: 'ctxItems', menuId: this.#activeMenuId, items: serializedItems, header }, '*');
		} catch {}
	}
```

- [ ] **Step 2: `setSwitcher` + Feld ergänzen**

In `js/content.js`, `ContentContextMenu`, ein privates Feld bei den anderen `#active*`-Feldern (~Zeile 414-417) hinzufügen:

```javascript
	#activeMenuClose = null;
	#activeMenuId = null;
	#activeItems = null;
	#activeIframe = null;
	#switchHandler = null;
```

Und eine Methode (z.B. direkt nach `setItems`) hinzufügen:

```javascript
	setSwitcher(fn) {
		this.#switchHandler = fn;
	}
```

In `#createMenuIframe`, im `closeMenu`-Rumpf (~Zeile 576-586), das Feld beim Schließen zurücksetzen — nach `this.#activeIframe = null;` ergänzen:

```javascript
			this.#activeIframe = null;
			this.#switchHandler = null;
```

- [ ] **Step 3: `ctxMenuSwitch` im Iframe-onMessage behandeln**

In `js/content.js`, `#createMenuIframe`, im `onMessage`-Handler (~Zeile 524-571) nach dem `ctxMenuSelect`-Block einfügen:

```javascript
			if (request.action === 'ctxMenuSwitch') {
				if (typeof this.#switchHandler === 'function') this.#switchHandler(request.id);
			}
```

Hinweis: `onMessage` ist eine Arrow-Function und behält `this` (die `ContentContextMenu`-Instanz).

- [ ] **Step 4: `case 'customMenu'` refaktorieren — Items-Builder + Header**

In `js/content.js`, `case 'customMenu':` (~Zeile 3429-3473), den gesamten Block ersetzen. Die Item-Erzeugung wird in `buildCustomMenu(id)` gekapselt (fängt `cursor`, `startTarget`, `menuSelectionText`), und der Header wird berechnet, wenn `showHeader` gesetzt ist:

```javascript
					case 'customMenu': {
						const initialMenuId = mergedConfig.contextual
							? resolveContextualMenuId(SETTINGS.customMenus)
							: mergedConfig.menuId;
						const menuSelectionText = (window.getSelection()?.toString() || '').trim();

						// Header list = all custom menus except the current, in definition order.
						const buildHeader = (menuId) => {
							const def = SETTINGS.customMenus?.[menuId];
							if (!def?.showHeader) return null;
							const menus = Object.entries(SETTINGS.customMenus || {})
								.filter(([id]) => id !== menuId)
								.map(([id, m]) => ({ id, name: m?.name || msg('actionCustomMenu') }));
							return { name: def.name || msg('actionCustomMenu'), menus };
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
							return { items, header: buildHeader(menuId) };
						};

						const initial = buildCustomMenu(initialMenuId);
						if (!initial) break;

						ctxMenu.prepare(cursor.endX, cursor.endY);
						ctxMenu.setSwitcher((id) => {
							if (!SETTINGS.customMenus?.[id]) return; // deleted → no-op, keep current
							const rebuilt = buildCustomMenu(id);
							if (!rebuilt) return;
							ctxMenu.setItems(rebuilt.items, rebuilt.header);
							upgradeMenuIcons(rebuilt.items);
						});
						ctxMenu.setItems(initial.items, initial.header);
						upgradeMenuIcons(initial.items);
						break;
					}
```

- [ ] **Step 5: Syntax prüfen**

Run: `node --check js/content.js && echo "SYNTAX OK"`
Expected: `SYNTAX OK`

- [ ] **Step 6: Regressions-Gate**

Run: `npx vitest run`
Expected: alle Tests grün.

- [ ] **Step 7: Manuelle End-to-End-Verifikation**

Erweiterung neu laden. Mindestens zwei Custom-Menüs anlegen (z.B. „Standard", „Shopping"), bei „Shopping" den Header aktivieren (Task 1). Eine Geste dem Custom-Menü „Shopping" zuweisen.

Prüfen:
1. Geste ausführen → Menü öffnet mit Kopfzeile „Shopping" + Chevron, darunter Separator und die Items.
2. Auf die Kopfzeile klicken → Dropdown listet alle anderen Menüs (z.B. „Standard"), aktuelles Menü ausgeschlossen, in Konfigurationsreihenfolge. Iframe wächst, Dropdown wird **nicht** abgeschnitten.
3. „Standard" wählen → Inhalt wird in-place ersetzt, Kopfzeile zeigt jetzt „Standard", Menü passt Größe/Position an und bleibt im Viewport.
4. Menü schließen, Geste erneut auslösen → wieder „Shopping" (flüchtig, keine Persistenz).
5. Ein Menü ohne Header per Geste öffnen → verhält sich exakt wie bisher (keine Kopfzeile, einmaliges Sizing).
6. Kontextuelles/dynamisches Menü mit Header: öffnet das per URL aufgelöste Menü, Kopfzeile zeigt dessen Namen; Umschalten auf ein anderes Menü funktioniert.
7. DevTools-Konsole der Seite und Service-Worker-Log: keine Fehler.

- [ ] **Step 8: Commit**

```bash
git add js/content.js
git commit -m "feat(menu): switchable menu header — rebuild items on switch, compute header"
```

---

## Self-Review-Ergebnis

**Spec-Abdeckung:**
- Per-Menü-Toggle `showHeader` → Task 1. ✓
- Header zeigt Menünamen → Task 3 (Render) + Task 4 (`buildHeader.name`). ✓
- Dropdown listet alle anderen Menüs in Reihenfolge → Task 4 `buildHeader.menus`. ✓
- Umschalten in-place → Task 4 `setSwitcher`/`buildCustomMenu` + Task 2 `ctxMenuSwitch` + Task 3 `#switchTo`. ✓
- Flüchtig (keine Persistenz) → keine Speicherung; nächste Geste nutzt Ausgangs-Menü. ✓
- Dynamisches Sizing (Dropdown/Umschalten nicht abgeschnitten) → Task 3 `#measureAndReport`-Umbau. ✓
- Rückwärtskompatibel für headerlose Menüs → One-Shot-Pfad unverändert (Task 3 Guard). ✓
- Edge Cases (einziges Menü → nur Titel; gelöschtes Menü → No-op; dynamisches Menü) → Task 4 (`menus`-Liste leer / `SETTINGS.customMenus?.[id]`-Guard) + manuelle Prüfschritte. ✓
- Preview = nur Items → Task 3 `render()` prüft `this.preview` unverändert; Header hängt an `_header`, das im Preview nie gesetzt wird. ✓

**Placeholder-Scan:** keine TBD/TODO; alle Code-Schritte enthalten vollständigen Code. ✓

**Typ-/Namenskonsistenz:** `header = { name, menus:[{id,name}] }` einheitlich über Task 2 (Session), Task 3 (`_header`), Task 4 (`buildHeader`). Message-Type `ctxMenuSwitch { menuId, id }` einheitlich in Task 2 (Forward), Task 3 (Sender `#switchTo`), Task 4 (`onMessage`-Handler, `request.id`). `setItems(items, header)`, `setSwitcher(fn)`, `buildCustomMenu(id) → {items, header}` konsistent. ✓
