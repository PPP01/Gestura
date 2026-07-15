# Kontextmenü-Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das native Rechtsklick-Kontextmenü zu einem konfigurierbaren Feature ausbauen: „Add this site to menu" (Link-Eintrag ins Website-Menü), ein Eintrag der das Website-Menü-Overlay öffnet, ein „Options"-Eintrag; dazu ein neuer Settings-Bereich „Kontextmenü", in den die vorhandenen Blacklist-/Restricted-Notice-Schalter umziehen.

**Architecture:** Die gesamte native Menü-Logik lebt im Service Worker ([js/background.js](../../../js/background.js)), der bereits `menu-patterns`, `menu-catalog`, `menu-model` per `importScripts` lädt. Datenmutationen (Link ins Menü einfügen) kommen als pure, getestete Funktion in [js/menu-model.js](../../../js/menu-model.js). Das Content-Script öffnet auf Nachricht hin das bestehende iframe-Overlay über den `siteMenu`-Aktionspfad und liefert (mit optionalem In-Page-Titel-Prompt) das Label für neue Einträge. Die Options-Seite ([js/components/options-page.js](../../../js/components/options-page.js)) bekommt einen Feature-Toggle im Funktionen-Kasten und einen neuen Bereich.

**Tech Stack:** Plain JS (kein Build), Manifest V3, Lit-Komponenten (vendored), vitest für Node-Tests. Tabs-Einrückung.

## Global Constraints

- Einrückung ist **Tabs**, nicht Spaces (gesamtes Repo).
- Content-Scripts können **keine** ES-Module — nur `window.*`-Globals; Komponenten nutzen `import`/`export`.
- `DEFAULT_SETTINGS` in [js/constants.js](../../../js/constants.js) ist die einzige Quelle für die Settings-Form; Werte werden über den Default gelegt.
- Neue i18n-Keys während der Entwicklung **nur** in `_locales/en/messages.json` + `_locales/de/messages.json` (Fork-Konvention); `en` ist `default_locale`.
- Alle neuen Flags haben Default `true` bzw. sinnvolle Defaults ⇒ **keine Migration**.
- `menu-model.js`-Funktionen sind **immutabel** (Eingaben nie verändern) und nutzen keine `chrome.*`/`crypto`-Abhängigkeit ohne Fallback.
- Version/`version_name` **nicht** von Hand ändern (Clean-Filter/Hooks besitzen das Feld).

---

## File Structure

- **Modify** [js/constants.js](../../../js/constants.js) — neue Flags in `DEFAULT_SETTINGS`.
- **Modify** [js/menu-model.js](../../../js/menu-model.js) — neue pure Funktion `addLinkToMenu`.
- **Modify** [tests/menu-model.test.mjs](../../../tests/menu-model.test.mjs) — Tests für `addLinkToMenu`.
- **Modify** [tests/settings-defaults.test.mjs](../../../tests/settings-defaults.test.mjs) — neue Default-Flags.
- **Modify** [js/background.js](../../../js/background.js) — native Menü-Einträge bauen, Klick-Dispatch, Re-Render-Trigger, `importScripts('search-url.js')`.
- **Modify** [js/content.js](../../../js/content.js) — Nachrichten-Handler (Overlay öffnen, Label liefern + Titel-Prompt), Rechtsklick-Position merken.
- **Modify** [js/components/options-page.js](../../../js/components/options-page.js) — Feature-Toggle, neuer Bereich, Umzug der Blacklist-/Restricted-Zeilen, Mode-/Menü-Auswahl, `siteMenuAddAsk`-Schalter.
- **Modify** `_locales/en/messages.json`, `_locales/de/messages.json` — neue Keys.
- **Final** alle übrigen `_locales/*/messages.json` — vollständige Übersetzung.

---

## Task 1: Neue Settings-Flags

**Files:**
- Modify: `js/constants.js` (in `DEFAULT_SETTINGS`, ~Z. 253 und ~Z. 283)
- Test: `tests/settings-defaults.test.mjs`

**Interfaces:**
- Produces: Settings-Keys `enableContextMenu`, `ctxMenuAddSite`, `ctxMenuSiteMenu`, `ctxMenuSiteMenuMode`, `ctxMenuSiteMenuId`, `ctxMenuOptions`, `siteMenuAddAsk` — konsumiert von Task 3–5.

- [ ] **Step 1: Failing test schreiben**

In `tests/settings-defaults.test.mjs` einen neuen `it`-Block im `describe("DEFAULT_SETTINGS", …)` ergänzen:

```js
it("context-menu feature flags default on with contextual site-menu mode", () => {
	expect(DEFAULT_SETTINGS.enableContextMenu).toBe(true);
	expect(DEFAULT_SETTINGS.ctxMenuAddSite).toBe(true);
	expect(DEFAULT_SETTINGS.ctxMenuSiteMenu).toBe(true);
	expect(DEFAULT_SETTINGS.ctxMenuSiteMenuMode).toBe("contextual");
	expect(DEFAULT_SETTINGS.ctxMenuSiteMenuId).toBe("");
	expect(DEFAULT_SETTINGS.ctxMenuOptions).toBe(true);
	expect(DEFAULT_SETTINGS.siteMenuAddAsk).toBe(true);
});
```

- [ ] **Step 2: Test läuft rot**

Run: `npx vitest run tests/settings-defaults.test.mjs`
Expected: FAIL (`expected undefined to be true`).

- [ ] **Step 3: Flags ergänzen**

In `js/constants.js` in `DEFAULT_SETTINGS` direkt nach `enableBlacklist: true,` (~Z. 216) einfügen:

```js
		enableContextMenu: true,
```

Und direkt nach `enableBlacklistContextMenu: false,` (~Z. 283) einfügen:

```js
		ctxMenuAddSite: true,
		ctxMenuSiteMenu: true,
		ctxMenuSiteMenuMode: 'contextual',
		ctxMenuSiteMenuId: '',
		ctxMenuOptions: true,
		siteMenuAddAsk: true,
```

- [ ] **Step 4: Test läuft grün**

Run: `npx vitest run tests/settings-defaults.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/constants.js tests/settings-defaults.test.mjs
git commit -m "feat(settings): add context-menu feature flags"
```

---

## Task 2: `addLinkToMenu` im Menü-Modell

**Files:**
- Modify: `js/menu-model.js` (neue Funktion vor `const api = {…}`, ~Z. 282; Export in `api`)
- Test: `tests/menu-model.test.mjs`

**Interfaces:**
- Consumes: bestehende `getBaseMenu`, `withMenuDef`, `addPatternToMenu`, `siteToPattern`.
- Produces: `addLinkToMenu(catalog, siteMenus, menuId, { label, url, icon?, id? }) → { siteMenus, added }`.
  - Erzeugt bei Katalog-Menüs die `edited`-Kopie, hängt einen Link-Eintrag ans Ende der `items`.
  - `added` = der neue Eintrag (Objekt) oder `null` (unbekanntes Menü, fehlende `url`, oder URL bereits vorhanden = Dublette).
  - `id` optional (für deterministische Tests); ohne `id` wird `item_<10hex>` via `crypto.randomUUID` erzeugt.
  - `icon` Default `'link'`.

- [ ] **Step 1: Failing tests schreiben**

In `tests/menu-model.test.mjs` ans Ende (vor der letzten schließenden Zeile) einen neuen Block ergänzen:

```js
describe('addLinkToMenu', () => {
	it('creates edited copy for catalog menu and appends a link item', () => {
		const { siteMenus, added } = M.addLinkToMenu(CATALOG, EMPTY, 'gh',
			{ label: 'My Repo', url: 'https://github.com/me/repo', id: 'item_test1' });
		expect(added).toEqual({ id: 'item_test1', action: 'openCustomUrl', customUrl: 'https://github.com/me/repo', customName: 'My Repo', icon: 'link' });
		const items = siteMenus.edited.gh.items;
		expect(items[items.length - 1]).toEqual(added);
		expect(CATALOG[0].items).toHaveLength(3); // Katalog unangetastet
	});

	it('appends to an existing edited/custom menu without touching the catalog copy path', () => {
		const start = { ...EMPTY, custom: { menu_1: { name: 'Eigenes', patterns: [], items: [] } } };
		const { siteMenus, added } = M.addLinkToMenu(CATALOG, start, 'menu_1',
			{ label: 'X', url: 'https://x.example', id: 'item_x' });
		expect(added.id).toBe('item_x');
		expect(siteMenus.custom.menu_1.items).toHaveLength(1);
	});

	it('dedupes by url and returns added:null', () => {
		const first = M.addLinkToMenu(CATALOG, EMPTY, 'gh', { label: 'A', url: 'https://github.com/a', id: 'item_a' });
		// gh-Katalog hat bereits customUrl https://github.com/a (Eintrag "a")
		expect(first.added).toBeNull();
	});

	it('returns added:null for unknown menu or missing url', () => {
		expect(M.addLinkToMenu(CATALOG, EMPTY, 'nope', { label: 'A', url: 'u' }).added).toBeNull();
		expect(M.addLinkToMenu(CATALOG, EMPTY, 'gh', { label: 'A', url: '' }).added).toBeNull();
	});

	it('generates an item_ id when none is given', () => {
		const { added } = M.addLinkToMenu(CATALOG, EMPTY, 'gh', { label: 'B', url: 'https://github.com/new' });
		expect(added.id).toMatch(/^item_[0-9a-f]{10}$/);
	});
});
```

- [ ] **Step 2: Tests laufen rot**

Run: `npx vitest run tests/menu-model.test.mjs`
Expected: FAIL (`M.addLinkToMenu is not a function`).

- [ ] **Step 3: Funktion implementieren**

In `js/menu-model.js` direkt nach `addPatternToMenu` (nach dessen schließender `}`, vor `const api = {`) einfügen:

```js
	function newItemId() {
		try {
			return 'item_' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
		} catch (e) {
			// Fallback für Umgebungen ohne crypto.randomUUID
			return 'item_' + Math.abs(Date.now() % 0xffffffffff).toString(16).padStart(10, '0');
		}
	}

	function addLinkToMenu(catalog, siteMenus, menuId, opts) {
		const o = opts || {};
		if (!o.url) return { siteMenus, added: null };
		const base = getBaseMenu(catalog, siteMenus, menuId);
		if (!base) return { siteMenus, added: null };
		const items = base.items || [];
		const dup = items.some(it => it && it.customUrl === o.url);
		if (dup) return { siteMenus, added: null };
		const item = {
			id: o.id || newItemId(),
			action: 'openCustomUrl',
			customUrl: o.url,
			customName: o.label || o.url,
			icon: o.icon || 'link',
		};
		const def = { ...base, items: [...items, item] };
		return { siteMenus: withMenuDef(catalog, siteMenus, menuId, def), added: item };
	}
```

Im `api`-Objekt (~Z. 283) `addPatternToMenu,` um `addLinkToMenu,` ergänzen:

```js
		addPatternToMenu, addLinkToMenu,
```

- [ ] **Step 4: Tests laufen grün**

Run: `npx vitest run tests/menu-model.test.mjs`
Expected: PASS (alle, inkl. bestehender).

- [ ] **Step 5: Commit**

```bash
git add js/menu-model.js tests/menu-model.test.mjs
git commit -m "feat(menu-model): add addLinkToMenu (append link item to a site menu)"
```

---

## Task 3: Content-Script — Overlay öffnen, Label liefern, Titel-Prompt, Rechtsklick-Position

**Files:**
- Modify: `js/content.js` — im `contextmenu`-Listener (~Z. 2484) Position/Target merken; im `onMessage`-Listener (~Z. 2249) neue Fälle; kleine Prompt-Hilfsfunktion.

**Interfaces:**
- Consumes (SW → Content): `{ action: 'openSiteMenuOverlay', config: { mode, menuId } }`; `{ action: 'ctxCollectMenuLabel', url, isLink, prompt }`.
- Produces (Antwort auf `ctxCollectMenuLabel` via `sendResponse`): `{ label }` oder `{ cancelled: true }`.
- Nutzt bestehende Locals im `initGestures`-Scope: `executeAction`, `ctxMenu`, `isIframe`, `SETTINGS`, `isExtensionContextValid`, `msg`.

- [ ] **Step 1: Rechtsklick-Position + Ziel merken**

Im `initGestures`-Scope eine Modul-Variable ergänzen. Direkt **vor** der Zeile `eventManager.add(() => !isBlacklisted, window, 'contextmenu', (e) => {` (~Z. 2484) einfügen:

```js
		let lastCtxMenuPoint = null;   // {x,y} in Viewport-Koordinaten dieses Frames
		let lastCtxMenuTarget = null;  // Element unter dem Rechtsklick
```

Als **erste** Anweisung im `contextmenu`-Handler (nach `if (!isExtensionContextValid()) return;`, ~Z. 2485) einfügen:

```js
			lastCtxMenuPoint = { x: e.clientX, y: e.clientY };
			lastCtxMenuTarget = e.target;
```

- [ ] **Step 2: Titel-Prompt-Hilfsfunktion**

Im selben Scope (z. B. direkt nach `function isExtensionContextValid() { … }`, ~Z. 2422) einfügen:

```js
		function promptForTitle(defaultTitle) {
			return new Promise((resolve) => {
				const host = document.createElement('div');
				host.setAttribute('data-gesture-ignore', '');
				host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35)';
				const box = document.createElement('div');
				box.style.cssText = 'background:#fff;color:#111;min-width:280px;max-width:90vw;padding:16px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.3);font:14px system-ui,sans-serif';
				const label = document.createElement('div');
				label.textContent = msg('ctxTitlePromptLabel') || 'Title';
				label.style.cssText = 'margin-bottom:8px;font-weight:600';
				const input = document.createElement('input');
				input.type = 'text';
				input.value = defaultTitle || '';
				input.style.cssText = 'width:100%;box-sizing:border-box;padding:8px;border:1px solid #ccc;border-radius:6px;margin-bottom:12px';
				const row = document.createElement('div');
				row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
				const cancel = document.createElement('button');
				cancel.textContent = msg('buttonCancel') || 'Cancel';
				const ok = document.createElement('button');
				ok.textContent = msg('buttonOkay') || 'OK';
				for (const b of [cancel, ok]) b.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid #ccc;cursor:pointer';
				ok.style.background = '#4285f4'; ok.style.color = '#fff'; ok.style.borderColor = '#4285f4';
				let done = false;
				const finish = (val) => { if (done) return; done = true; host.remove(); resolve(val); };
				cancel.addEventListener('click', () => finish(null));
				ok.addEventListener('click', () => finish(input.value.trim() || (defaultTitle || '')));
				input.addEventListener('keydown', (ev) => {
					if (ev.key === 'Enter') { ev.preventDefault(); ok.click(); }
					else if (ev.key === 'Escape') { ev.preventDefault(); cancel.click(); }
				});
				row.append(cancel, ok); box.append(label, input, row); host.append(box);
				(document.body || document.documentElement).append(host);
				input.focus(); input.select();
			});
		}
```

- [ ] **Step 3: Nachrichten-Fälle ergänzen**

Im `onMessage`-Listener (~Z. 2249) **vor** `if (request.action === 'ping')` einfügen:

```js
			if (request.action === 'openSiteMenuOverlay' && !isIframe) {
				if (!isExtensionContextValid() || SETTINGS.enableSiteMenus === false) return;
				const p = lastCtxMenuPoint || { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
				const cursor = { startX: p.x, startY: p.y, endX: p.x, endY: p.y };
				const target = document.elementFromPoint(p.x, p.y);
				executeAction('siteMenu', request.config || { mode: 'contextual' }, cursor, target);
				return;
			}

			if (request.action === 'ctxCollectMenuLabel') {
				let def = '';
				if (request.isLink) {
					const a = lastCtxMenuTarget && lastCtxMenuTarget.closest ? lastCtxMenuTarget.closest('a') : null;
					def = (a && (a.textContent || '').trim()) || (a && a.getAttribute('title')) || request.url || '';
				} else {
					def = (document.title || '').trim() || request.url || '';
				}
				def = def.replace(/\s+/g, ' ').slice(0, 120);
				if (request.prompt) {
					promptForTitle(def).then(v => sendResponse(v == null ? { cancelled: true } : { label: v }));
					return true; // async
				}
				sendResponse({ label: def });
				return;
			}
```

- [ ] **Step 4: Manuell verifizieren (nach Task 4/5, siehe dortige Verifikation)**

Dieser Task hat keine Unit-Tests (Chrome-APIs/DOM). Verifikation erfolgt im End-to-End-Test von Task 4 & 5.

- [ ] **Step 5: Commit**

```bash
git add js/content.js
git commit -m "feat(content): context-menu handlers (open site-menu overlay, label + title prompt)"
```

---

## Task 4: Service Worker — native Einträge bauen & Klick-Dispatch

**Files:**
- Modify: `js/background.js` — `importScripts` (Z. 1–4), neue Menü-IDs (~Z. 1471), `updateMenuForTab` (~Z. 1577), `onClicked`-Listener (~Z. 1644), `storage.onChanged` (~Z. 1681), Helfer für Options öffnen.

**Interfaces:**
- Consumes: `self.FlowMouseMenuModel` (`listActiveMenus`, `getBaseMenu`, `resolveMenu`, `addLinkToMenu`, `addPatternToMenu`), `self.FlowMouseMenuCatalog.SITE_MENU_CATALOG`, `self.FlowMouseMenuPatterns.siteToPattern`, `self.FlowMouseSearchUrl.matchesPatterns`.
- Sendet an Content: `openSiteMenuOverlay`, `ctxCollectMenuLabel` (siehe Task 3).

- [ ] **Step 1: `search-url.js` im SW verfügbar machen**

In `js/background.js` nach `importScripts('menu-model.js');` (Z. 3) ergänzen:

```js
importScripts('search-url.js');
```

- [ ] **Step 2: Menü-IDs + Helfer ergänzen**

Nach `const MENU_ID_BLACKLIST = 'flowmouse-blacklist-toggle';` (~Z. 1471) einfügen:

```js
const MENU_ID_OPTIONS = 'flowmouse-open-options';
const MENU_ID_SITEMENU = 'flowmouse-open-sitemenu';
const MENU_ID_ADD_PARENT = 'flowmouse-add-site-parent';
const CTX_ADD_PREFIX = 'flowmouse-add-site::';   // + menuId

function menuDisplayName(m) {
	// m = Eintrag aus listActiveMenus (hat .id, .def)
	const def = m.def || {};
	return def.name || getMsg(def.nameKey, '') || m.id;
}

function activeSiteMenus() {
	const sm = self._siteMenusCache || {};
	return self.FlowMouseMenuModel.listActiveMenus(self.FlowMouseMenuCatalog.SITE_MENU_CATALOG, sm);
}

function matchingSiteMenuIds(url) {
	if (!url) return [];
	const mp = self.FlowMouseSearchUrl.matchesPatterns;
	return activeSiteMenus()
		.filter(m => (m.def.patterns || []).length && mp(url, m.def.patterns))
		.map(m => m.id);
}

function removeContextMenuExtras() {
	for (const id of [MENU_ID_OPTIONS, MENU_ID_SITEMENU, MENU_ID_ADD_PARENT]) {
		chrome.contextMenus.remove(id, () => { chrome.runtime.lastError; });
	}
}
```

Hinweis: `self._siteMenusCache` wird in `updateMenuForTab` gefüllt (Step 3), damit `onClicked` dieselbe Sicht hat.

- [ ] **Step 3: Einträge in `updateMenuForTab` bauen**

In `updateMenuForTab` (~Z. 1588) die Storage-Abfrage um die neuen Keys erweitern. Zeile 1588 ersetzen:

```js
	const items = await chrome.storage.sync.get(['showRestrictedNotice', 'blacklist', 'enableBlacklistContextMenu', 'enableBlacklist', 'enableSiteMenus', 'enableContextMenu', 'ctxMenuAddSite', 'ctxMenuSiteMenu', 'ctxMenuSiteMenuMode', 'ctxMenuSiteMenuId', 'ctxMenuOptions', 'siteMenuAddAsk', 'siteMenus']);
	self._siteMenusCache = items.siteMenus || {};
```

Danach, direkt **nach** dem Blacklist-Block (nach der `if (blacklistEnabled && items.enableBlacklistContextMenu …) { … } else { removeBlacklistMenu(); }`-Verzweigung, ~Z. 1601) einfügen:

```js
	removeContextMenuExtras();
	const ctxOn = items.enableContextMenu !== false;
	const siteMenusOn = items.enableSiteMenus !== false;
	const url = tab.url;
	const canUseCtx = ctxOn && hostname && !isRestrictedUrl(url);

	if (canUseCtx && siteMenusOn && items.ctxMenuAddSite !== false) {
		const matches = matchingSiteMenuIds(url);
		const active = activeSiteMenus();
		if (matches.length === 1) {
			const m = active.find(x => x.id === matches[0]);
			chrome.contextMenus.create({
				id: CTX_ADD_PREFIX + matches[0],
				title: getMsg('menuAddSiteToNamed', 'Add to menu').replace('{NAME}', menuDisplayName(m)),
				contexts: ['page', 'link', 'image']
			}, () => { chrome.runtime.lastError; });
		} else if (items.siteMenuAddAsk !== false) {
			chrome.contextMenus.create({
				id: MENU_ID_ADD_PARENT,
				title: getMsg('menuAddSiteToMenu', 'Add this site to menu'),
				contexts: ['page', 'link', 'image']
			}, () => { chrome.runtime.lastError; });
			for (const m of active) {
				chrome.contextMenus.create({
					id: CTX_ADD_PREFIX + m.id,
					parentId: MENU_ID_ADD_PARENT,
					title: menuDisplayName(m),
					contexts: ['page', 'link', 'image']
				}, () => { chrome.runtime.lastError; });
			}
		} else {
			// Nicht fragen: still ins exklusive Standard-Menü (falls aktiv)
			const dm = self._siteMenusCache.defaultMenuId || '';
			const dmActive = dm && active.some(x => x.id === dm);
			if (dmActive) {
				const m = active.find(x => x.id === dm);
				chrome.contextMenus.create({
					id: CTX_ADD_PREFIX + dm,
					title: getMsg('menuAddSiteToNamed', 'Add to menu').replace('{NAME}', menuDisplayName(m)),
					contexts: ['page', 'link', 'image']
				}, () => { chrome.runtime.lastError; });
			}
		}
	}

	if (canUseCtx && siteMenusOn && items.ctxMenuSiteMenu !== false) {
		chrome.contextMenus.create({
			id: MENU_ID_SITEMENU,
			title: getMsg('menuOpenSiteMenu', 'Website menu'),
			contexts: ['all']
		}, () => { chrome.runtime.lastError; });
	}

	if (canUseCtx && items.ctxMenuOptions !== false) {
		chrome.contextMenus.create({
			id: MENU_ID_OPTIONS,
			title: getMsg('menuOptions', 'Options'),
			contexts: ['all']
		}, () => { chrome.runtime.lastError; });
	}
```

Außerdem `removeContextMenuExtras()` im `loading`-Kurzschluss ergänzen: in `updateMenuForTab` beim frühen `if (status === 'loading') { removeAllMenus(); … }` (~Z. 1582) direkt nach `removeAllMenus();` ein `removeContextMenuExtras();` einfügen.

- [ ] **Step 4: `openOptionsPage`-Helfer aus dem Restricted-Zweig extrahieren**

Den bestehenden `MENU_ID_RESTRICTED`-Block in `onClicked` (~Z. 1665–1678) nutzt Options-Öffnungs-Logik. Diese als Funktion herausziehen — vor dem `onClicked`-Listener (~Z. 1644) einfügen:

```js
async function openOptionsPage(hash) {
	const optionsUrl = chrome.runtime.getURL('pages/options.html');
	const targetUrl = optionsUrl + (hash || '');
	const tabs = await chrome.tabs.query({});
	const existingTab = tabs.find(t => t.url && t.url.startsWith(optionsUrl));
	if (existingTab) {
		await chrome.tabs.update(existingTab.id, { url: targetUrl, active: true });
		await chrome.windows.update(existingTab.windowId, { focused: true });
	} else {
		chrome.tabs.create({ url: targetUrl });
	}
}
```

Im `MENU_ID_RESTRICTED`-Zweig den Rumpf ersetzen durch:

```js
	} else if (info.menuItemId === MENU_ID_RESTRICTED) {
		await openOptionsPage('#restricted-notice');
	}
```

- [ ] **Step 5: Klick-Dispatch für die neuen Einträge**

Im `onClicked`-Listener (~Z. 1644), **vor** der schließenden `});`, neue `else if`-Zweige ergänzen:

```js
	} else if (info.menuItemId === MENU_ID_OPTIONS) {
		await openOptionsPage('');
	} else if (info.menuItemId === MENU_ID_SITEMENU) {
		if (!tab || !tab.id) return;
		const cfg = await chrome.storage.sync.get(['ctxMenuSiteMenuMode', 'ctxMenuSiteMenuId']);
		const mode = cfg.ctxMenuSiteMenuMode === 'standard' ? 'standard' : 'contextual';
		const config = mode === 'standard' ? { mode, menuId: cfg.ctxMenuSiteMenuId || '' } : { mode: 'contextual' };
		chrome.tabs.sendMessage(tab.id, { action: 'openSiteMenuOverlay', config }, { frameId: info.frameId || 0 })
			.catch(() => {});
	} else if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith(CTX_ADD_PREFIX)) {
		if (!tab || !tab.url) return;
		const menuId = info.menuItemId.slice(CTX_ADD_PREFIX.length);
		const url = info.linkUrl || tab.url;
		const isLink = !!info.linkUrl;
		const matches = matchingSiteMenuIds(tab.url);
		const selectionPath = !(matches.length === 1 && matches[0] === menuId);

		let label = null;
		try {
			const resp = await chrome.tabs.sendMessage(tab.id,
				{ action: 'ctxCollectMenuLabel', url, isLink, prompt: selectionPath },
				{ frameId: info.frameId || 0 });
			if (resp && resp.cancelled) return;
			if (resp && resp.label) label = resp.label;
		} catch (e) { /* Content nicht verfügbar → Fallback */ }
		if (!label) label = isLink ? url : (tab.title || url);

		const catalog = self.FlowMouseMenuCatalog.SITE_MENU_CATALOG;
		const cur = await new Promise(res => chrome.storage.sync.get(['siteMenus'], it => res(it.siteMenus || {})));
		let { siteMenus, added } = self.FlowMouseMenuModel.addLinkToMenu(catalog, cur, menuId, { label, url });
		if (selectionPath) {
			const pat = self.FlowMouseMenuPatterns.siteToPattern(tab.url);
			({ siteMenus } = self.FlowMouseMenuModel.addPatternToMenu(catalog, siteMenus, menuId, pat));
		}
		await chrome.storage.sync.set({ siteMenus });
	}
```

- [ ] **Step 6: Re-Render-Trigger erweitern**

Im `storage.onChanged`-Listener (~Z. 1683) die Bedingung erweitern:

```js
		if (changes.showRestrictedNotice || changes.language || changes.enableBlacklistContextMenu || changes.blacklist || changes.enableBlacklist ||
			changes.enableSiteMenus || changes.enableContextMenu || changes.ctxMenuAddSite || changes.ctxMenuSiteMenu ||
			changes.ctxMenuSiteMenuMode || changes.ctxMenuSiteMenuId || changes.ctxMenuOptions || changes.siteMenuAddAsk || changes.siteMenus) {
```

- [ ] **Step 7: Manuell verifizieren (End-to-End mit Task 3)**

1. Erweiterung neu laden (`chrome://extensions` → Reload).
2. Auf einer normalen Seite (z. B. `https://github.com`) rechtsklicken → es erscheinen: „Website menu", „Options" und (falls GitHub-Muster passt) „Add to menu 'GitHub'".
3. „Website menu" klicken → das iframe-Overlay öffnet an der Rechtsklick-Position.
4. „Options" klicken → Options-Seite öffnet.
5. Auf einer Seite **ohne** passendes Menü rechtsklicken → „Add this site to menu ▸" mit Untermenü; ein Menü wählen → Titel-Prompt erscheint; bestätigen → Eintrag ist im gewählten Menü (in den Website-Menü-Einstellungen prüfen), und das Seiten-Muster wurde ergänzt.
6. Auf einen Link rechtsklicken → „Add …" fügt die **Link**-URL mit dem Linktext als Titel hinzu.
7. Service-Worker-Konsole (Link „service worker" auf der Karte) auf Fehler prüfen.

- [ ] **Step 8: Commit**

```bash
git add js/background.js
git commit -m "feat(background): build native context-menu entries + click dispatch"
```

---

## Task 5: Options-Seite — Feature-Toggle & neuer Bereich

**Files:**
- Modify: `js/components/options-page.js` — Funktionen-Kasten (~Z. 380), `#getSections` (~Z. 999), neuer Section-Block, Umzug der Blacklist-Zeile (~Z. 834) und der Restricted-Notice-Zeile (~Z. 850), `siteMenuAddAsk`-Zeile im `siteMenus`-Block (~Z. 817).

**Interfaces:**
- Consumes: `this.#renderFeatureToggle(key, sectionId, label, first)`, `this.#updateSetting(key, value)`, `this._settings`, `window.FlowMouseMenuModel.listActiveMenus`, `window.FlowMouseMenuCatalog.SITE_MENU_CATALOG`, `icon(...)`, `i18n.getMessage(...)`.

- [ ] **Step 1: Feature-Toggle im Funktionen-Kasten**

In `render()` im Funktionen-Kasten nach der `enableBlacklist`-Zeile (~Z. 380) ergänzen:

```js
							${this.#renderFeatureToggle('enableContextMenu', 'contextMenu', i18n.getMessage('contextMenuSection'))}
```

- [ ] **Step 2: Nav-Eintrag**

In `#getSections` (~Z. 1010) direkt **vor** dem `other`-Eintrag ergänzen:

```js
				{ id: 'contextMenu', label: i18n.getMessage('contextMenuSection'), icon: icons.menu },
```

Der Bereich ist **immer sichtbar** (kein `flag:` → `#getSections`-Filter lässt ihn stehen). (`icons.menu` existiert in [js/icons.js](../../../js/icons.js); `squareMenu` gibt es nicht.)

- [ ] **Step 3: `siteMenuAddAsk`-Zeile in den Website-Menüs-Bereich**

Im `siteMenus`-Section-Block (~Z. 819) den `section-body` so ergänzen, dass **vor** `<site-menu-manager …>` eine Zeile steht:

```js
					<div class="section-body">
						<div class="setting-row first-row">
							<div class="setting-label">
								<span>${i18n.getMessage('siteMenuAddAsk')}</span>
								<span>${i18n.getMessage('siteMenuAddAskDesc')}</span>
							</div>
							<label class="toggle">
								<input type="checkbox" id="siteMenuAddAsk" .checked=${this._settings.siteMenuAddAsk !== false} @change=${e => this.#updateSetting('siteMenuAddAsk', e.target.checked)}>
								<span class="slider"></span>
							</label>
						</div>
						<site-menu-manager ?advanced-mode=${this._settings.sectionAdvanced?.siteMenus}></site-menu-manager>
					</div>
```

- [ ] **Step 4: Blacklist-Zeile aus dem Blacklist-Bereich entfernen**

Im `blacklist`-Block (~Z. 834–843) die komplette `enableBlacklistContextMenu`-`setting-row` **löschen** (zieht in den neuen Bereich um). Übrig bleibt nur der `blacklist-manager`.

- [ ] **Step 5: Restricted-Notice-Zeile aus dem `other`-Bereich entfernen**

Im `other`-Block (~Z. 850–859) die `showRestrictedNotice`-`setting-row` **und** die zugehörige `<details id="restricted-details">…</details>`-Klappbox ausschneiden (in Step 6 in den neuen Bereich eingefügt). Die verbleibende erste Zeile des `other`-Bereichs muss die Klasse `first-row` erhalten.

- [ ] **Step 6: Neuen Kontextmenü-Bereich einfügen**

Direkt **vor** dem `other`-Section-Block (~Z. 847) einfügen. `contextReady` gated die neuen Zeilen:

```js
					<div class="section ${this._activeSection === 'contextMenu' ? 'active' : ''}" data-nav="contextMenu">
						<h2><span class="section-icon">${unsafeHTML(icon('menu', { strokeWidth: 2.3 }))}</span> <span>${i18n.getMessage('contextMenuSection')}</span></h2>
						<div class="section-body">
							${(() => {
								const ctxOn = this._settings.enableContextMenu !== false;
								const siteOn = this._settings.enableSiteMenus !== false;
								const newFeaturesOn = ctxOn && siteOn;
								const menus = (window.FlowMouseMenuModel && window.FlowMouseMenuCatalog)
									? window.FlowMouseMenuModel.listActiveMenus(window.FlowMouseMenuCatalog.SITE_MENU_CATALOG, this._settings.siteMenus)
									: [];
								const menuName = (m) => m.def.name || (m.def.nameKey && i18n.getMessage(m.def.nameKey)) || m.id;
								return html`
									${!ctxOn ? html`<div class="setting-row first-row"><div class="setting-label"><span>${i18n.getMessage('contextMenuDisabledHint')}</span></div></div>` : ''}
									<div class="setting-row first-row" style="display:${newFeaturesOn ? '' : 'none'}">
										<div class="setting-label">
											<span>${i18n.getMessage('ctxMenuAddSite')}</span>
											<span>${i18n.getMessage('ctxMenuAddSiteDesc')}</span>
										</div>
										<label class="toggle">
											<input type="checkbox" id="ctxMenuAddSite" .checked=${this._settings.ctxMenuAddSite !== false} @change=${e => this.#updateSetting('ctxMenuAddSite', e.target.checked)}>
											<span class="slider"></span>
										</label>
									</div>
									<div class="setting-row" style="display:${newFeaturesOn ? '' : 'none'}">
										<div class="setting-label">
											<span>${i18n.getMessage('ctxMenuSiteMenu')}</span>
											<span>${i18n.getMessage('ctxMenuSiteMenuDesc')}</span>
										</div>
										<label class="toggle">
											<input type="checkbox" id="ctxMenuSiteMenu" .checked=${this._settings.ctxMenuSiteMenu !== false} @change=${e => this.#updateSetting('ctxMenuSiteMenu', e.target.checked)}>
											<span class="slider"></span>
										</label>
									</div>
									<div class="sub-settings ${newFeaturesOn && this._settings.ctxMenuSiteMenu !== false ? 'show' : ''}">
										<div class="inline-settings">
											<div class="inline-setting-item">
												<span>${i18n.getMessage('ctxMenuSiteMenuMode')}</span>
												<select id="ctxMenuSiteMenuMode" @change=${e => this.#updateSetting('ctxMenuSiteMenuMode', e.target.value)}>
													<option value="contextual" ?selected=${(this._settings.ctxMenuSiteMenuMode || 'contextual') === 'contextual'}>${i18n.getMessage('menuModeContextual')}</option>
													<option value="standard" ?selected=${this._settings.ctxMenuSiteMenuMode === 'standard'}>${i18n.getMessage('menuModeStandard')}</option>
												</select>
											</div>
											<div class="inline-setting-item" style="display:${this._settings.ctxMenuSiteMenuMode === 'standard' ? '' : 'none'}">
												<span>${i18n.getMessage('siteMenusTitle')}</span>
												<select id="ctxMenuSiteMenuId" @change=${e => this.#updateSetting('ctxMenuSiteMenuId', e.target.value)}>
													${menus.map(m => html`<option value=${m.id} ?selected=${this._settings.ctxMenuSiteMenuId === m.id}>${menuName(m)}</option>`)}
												</select>
											</div>
										</div>
									</div>
									<div class="setting-row" style="display:${ctxOn ? '' : 'none'}">
										<div class="setting-label">
											<span>${i18n.getMessage('ctxMenuOptions')}</span>
											<span>${i18n.getMessage('ctxMenuOptionsDesc')}</span>
										</div>
										<label class="toggle">
											<input type="checkbox" id="ctxMenuOptions" .checked=${this._settings.ctxMenuOptions !== false} @change=${e => this.#updateSetting('ctxMenuOptions', e.target.checked)}>
											<span class="slider"></span>
										</label>
									</div>
								`;
							})()}
							<div class="setting-row" style="display:${this._settings.enableBlacklist !== false ? '' : 'none'}">
								<div class="setting-label">
									<span>${i18n.getMessage('enableBlacklistContextMenu')}</span>
									<span>${i18n.getMessage('enableBlacklistContextMenuDesc')}</span>
								</div>
								<label class="toggle">
									<input type="checkbox" id="enableBlacklistContextMenu" .checked=${this._settings.enableBlacklistContextMenu} @change=${e => this.#updateSetting('enableBlacklistContextMenu', e.target.checked)}>
									<span class="slider"></span>
								</label>
							</div>
							<div id="restricted-notice" class="setting-row">
								<div class="setting-label">
									<span>${i18n.getMessage('showRestrictedNotice')}</span>
									<span>${i18n.getMessage('showRestrictedNoticeDesc')}</span>
								</div>
								<label class="toggle">
									<input type="checkbox" id="showRestrictedNotice" .checked=${this._settings.showRestrictedNotice} @change=${e => this.#updateSetting('showRestrictedNotice', e.target.checked)}>
									<span class="slider"></span>
								</label>
							</div>
							<details class="collapsible-details" id="restricted-details">
								<!-- den kompletten <details>-Inhalt aus dem other-Block (Step 5) hier unverändert einsetzen -->
							</details>
						</div>
					</div>
```

**Wichtig:** Den in Step 5 ausgeschnittenen `<details id="restricted-details">…</details>`-Inhalt (die Klappbox mit `restrictedNewTab`/`restrictedStore`/… und `#getRestrictedStoreDesc()`) hier 1:1 einsetzen. Der Hash-Sprung `#restricted-notice` (Logik in `#handleHashNavigation`/`connectedCallback`, ~Z. 1472) funktioniert weiter, da die IDs `restricted-notice`/`restricted-details` erhalten bleiben.

- [ ] **Step 7: Manuell verifizieren**

1. Erweiterung neu laden, Options-Seite öffnen.
2. Funktionen-Kasten zeigt „Context menu"-Toggle; Aus/An blendet die neuen Zeilen im Kontextmenü-Bereich aus/ein (Blacklist-/Restricted-Zeilen bleiben sichtbar).
3. Nav zeigt „Context menu"; Klick springt zum Bereich.
4. „Website menu"-Modus auf „Standard-Menü" → Menü-Dropdown erscheint und speichert.
5. Blacklist-Bereich enthält keinen „Context Menu Gesture Toggle" mehr; „Sonstiges" enthält keine Restricted-Notice-Zeile mehr — beide sind im neuen Bereich.
6. `enableBlacklist` aus (Funktionen-Kasten) → die „Disable gestures"-Zeile im Kontextmenü-Bereich verschwindet.

- [ ] **Step 8: Commit**

```bash
git add js/components/options-page.js
git commit -m "feat(options): context-menu settings section + feature toggle; move blacklist/restricted rows"
```

---

## Task 6: i18n (en + de)

**Files:**
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json`

**Interfaces:**
- Produces: alle in Task 3–5 referenzierten `getMessage`/`i18n.getMessage`-Keys.

- [ ] **Step 1: Bereits vorhandene Keys (nicht neu anlegen)**

Diese Keys existieren bereits und werden **wiederverwendet** — nicht duplizieren:
`menuModeContextual`, `menuModeStandard` (Mode-Dropdown, Task 5), `buttonOkay`, `buttonCancel` (Titel-Prompt, Task 3), `siteMenusTitle`, `enableBlacklistContextMenu`(+Desc), `showRestrictedNotice`(+Desc).
Verifizieren: `grep -n "\"menuModeContextual\"\|\"menuModeStandard\"\|\"buttonOkay\"\|\"buttonCancel\"" _locales/en/messages.json` — alle vier müssen vorhanden sein.

- [ ] **Step 2: Neue Keys in `en` ergänzen**

In `_locales/en/messages.json` ergänzen (Objektform wie bestehende Einträge, jeweils `{ "message": "…" }`):

```
contextMenuSection            = "Context menu"
contextMenuSectionDesc        = "Entries FlowMouse adds to the browser's right-click menu"
contextMenuDisabledHint       = "The context-menu additions are turned off in the Features box above."
ctxMenuAddSite                = "Add this site to a menu"
ctxMenuAddSiteDesc            = "Right-click entry to add the current page (or the right-clicked link) to a website menu"
ctxMenuSiteMenu               = "Open website menu"
ctxMenuSiteMenuDesc           = "Right-click entry that opens the website-menu overlay, like the gesture"
ctxMenuSiteMenuMode           = "Menu"
ctxMenuOptions                = "Options entry"
ctxMenuOptionsDesc            = "Show an \"Options\" entry that opens the settings page"
siteMenuAddAsk                = "Ask which menu when none matches"
siteMenuAddAskDesc            = "When adding a site and no menu matches, offer a menu picker; off = add to the default menu silently"
menuAddSiteToMenu             = "Add this site to menu"
menuAddSiteToNamed            = "Add to menu \"{NAME}\""
menuOpenSiteMenu              = "Website menu"
menuOptions                   = "Options"
ctxTitlePromptLabel           = "Title for the menu entry"
```

(Keine weiteren Keys nötig — OK/Abbrechen und die Mode-Labels sind bereits vorhanden, siehe Step 1.)

**WICHTIG — Platzhalter-Token:** Für `menuAddSiteToNamed` **KEIN** `$…$`-Token verwenden. `chrome.i18n` reserviert `$NAME$` für Message-Placeholders und **verweigert das Laden des Manifests** („Variable $NAME$ used but not defined"), auch wenn der Wert nur per `.replace()` genutzt wird. Verwende stattdessen den neutralen Token `{NAME}`, den Chrome nicht interpretiert:

```json
	"menuAddSiteToNamed": { "message": "Add to menu \"{NAME}\"" }
```

Der SW ersetzt ihn per `.replace('{NAME}', …)` (Task 4 Step 3). Bei der vollständigen Lokalisierung (Task 7) bleibt `{NAME}` in allen Sprachen unverändert.

- [ ] **Step 3: Dieselben Keys in `de` ergänzen**

```
contextMenuSection            = "Kontextmenü"
contextMenuSectionDesc        = "Einträge, die FlowMouse zum Rechtsklick-Menü des Browsers hinzufügt"
contextMenuDisabledHint       = "Die Kontextmenü-Erweiterungen sind im Funktionen-Kasten oben ausgeschaltet."
ctxMenuAddSite                = "Diese Seite zu einem Menü hinzufügen"
ctxMenuAddSiteDesc            = "Rechtsklick-Eintrag, um die aktuelle Seite (oder den angeklickten Link) zu einem Website-Menü hinzuzufügen"
ctxMenuSiteMenu               = "Website-Menü öffnen"
ctxMenuSiteMenuDesc           = "Rechtsklick-Eintrag, der das Website-Menü-Overlay öffnet – wie die Geste"
ctxMenuSiteMenuMode           = "Menü"
ctxMenuOptions                = "Optionen-Eintrag"
ctxMenuOptionsDesc            = "Zeigt einen Eintrag „Optionen“, der die Einstellungsseite öffnet"
siteMenuAddAsk                = "Menü abfragen, wenn keins passt"
siteMenuAddAskDesc            = "Wenn beim Hinzufügen kein Menü zur Seite passt, eine Menü-Auswahl anbieten; aus = still ins Standard-Menü"
menuAddSiteToMenu             = "Diese Seite zu Menü hinzufügen"
menuAddSiteToNamed            = "Zu Menü „{NAME}“ hinzufügen"
menuOpenSiteMenu              = "Website-Menü"
menuOptions                   = "Optionen"
ctxTitlePromptLabel           = "Titel für den Menüeintrag"
```

(Keine weiteren Keys nötig — OK/Abbrechen und die Mode-Labels sind bereits vorhanden, siehe Step 1.)

- [ ] **Step 4: JSON validieren**

Run: `node -e "JSON.parse(require('fs').readFileSync('_locales/en/messages.json','utf8')); JSON.parse(require('fs').readFileSync('_locales/de/messages.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: End-to-End nachprüfen**

Erweiterung neu laden; Options-Seite auf `de` und `en` prüfen — keine rohen Keys (`__MSG_…` / leere Labels). Rechtsklick-Einträge korrekt beschriftet.

- [ ] **Step 6: Commit**

```bash
git add _locales/en/messages.json _locales/de/messages.json
git commit -m "i18n(en,de): context-menu feature strings"
```

---

## Task 7: Vollständige Lokalisierung (Abschluss)

**Nur ausführen, wenn Task 1–6 verifiziert und vom Nutzer freigegeben sind.**

**Files:**
- Modify: alle übrigen `_locales/*/messages.json` (~40 Sprachen)

- [ ] **Step 1: Fehlende Keys je Locale ermitteln**

Run:
```bash
node -e "const fs=require('fs');const en=Object.keys(JSON.parse(fs.readFileSync('_locales/en/messages.json','utf8')));for(const d of fs.readdirSync('_locales')){if(d==='en')continue;const p='_locales/'+d+'/messages.json';if(!fs.existsSync(p))continue;const o=JSON.parse(fs.readFileSync(p,'utf8'));const miss=en.filter(k=>!(k in o));if(miss.length)console.log(d, miss.join(','));}"
```
Erwartung: In jeder Nicht-`en`-Locale fehlen genau die in Task 6 ergänzten Keys.

- [ ] **Step 2: Übersetzen & einfügen**

Die neuen Keys (siehe Task 6) in **alle** aufgelisteten Locales maschinell übersetzt einfügen. Platzhalter `{NAME}` in `menuAddSiteToNamed` unverändert lassen. Bestehende Übersetzungskonvention/Tonfall der jeweiligen Datei beibehalten.

- [ ] **Step 3: JSON aller Locales validieren**

Run:
```bash
node -e "const fs=require('fs');for(const d of fs.readdirSync('_locales')){const p='_locales/'+d+'/messages.json';try{JSON.parse(fs.readFileSync(p,'utf8'))}catch(e){console.error('BAD',d,e.message);process.exit(1)}}console.log('all valid')"
```
Expected: `all valid`

- [ ] **Step 4: Vollständigkeit prüfen**

Run: den Befehl aus Step 1 erneut — Erwartung: keine Ausgabe (nichts fehlt mehr).

- [ ] **Step 5: Commit**

```bash
git add _locales
git commit -m "i18n: localize context-menu strings into all shipped locales"
```

---

## Self-Review

**Spec coverage:**
- Ebene-1-Einträge (Disable gestures/Add/Website menu/Options/Notice) → Task 4 (Build + Dispatch), unabhängige Notice/Blacklist bleiben (Task 4 lässt bestehende Blöcke unangetastet).
- Add-Link + Muster, 0/1/n-Auflösung, Ask-Toggle → Task 2 (Modell) + Task 4 (Auflösung) + Task 5 (`siteMenuAddAsk`).
- Titel-Prompt + Fallback → Task 3.
- Website-Menü-Overlay (contextual/fixed) an Rechtsklick-Position → Task 3 + Task 4 Step 5.
- Flags + Funktionen-Kasten + neuer Bereich + Umzüge → Task 1 + Task 5.
- i18n en/de + vollständige Lokalisierung → Task 6 + Task 7.

**Type consistency:** `addLinkToMenu(catalog, siteMenus, menuId, {label,url,icon?,id?}) → {siteMenus, added}` einheitlich in Task 2 (Def) und Task 4 (Aufruf). Nachrichten-Namen `openSiteMenuOverlay`/`ctxCollectMenuLabel` identisch in Task 3 (Handler) und Task 4 (Sender). ID-Präfix `CTX_ADD_PREFIX` einheitlich in Build (Task 4 Step 3) und Dispatch (Task 4 Step 5).

**Verifizierte Annahmen:** Icon `menu` existiert in `js/icons.js` (kein `squareMenu`). Label-Keys `menuModeContextual`/`menuModeStandard` und Button-Keys `buttonOkay`/`buttonCancel` sind vorhanden und werden wiederverwendet. `search-url.js` ist ein klassisches Skript mit `root.FlowMouseSearchUrl` und im SW per `importScripts` ladbar.
