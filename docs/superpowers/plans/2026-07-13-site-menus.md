# Website-Menüs (Standard-Menüs + Gesten-Forks) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Custom-Menu-System durch ein dreistufiges Modell ersetzen: Code-Katalog vordefinierter Website-Menüs → editierbare Standard-Menüs in den Settings (Kopie-bei-Änderung) → gestenprivate Menüs (komplett eigen oder als Fork eines Standard-Menüs mit vererbendem Overlay).

**Architecture:** Vordefinierte Menüs liegen als Daten in `js/menu-catalog.js`. Der Settings-Key `siteMenus` speichert nur Abweichungen (`edited`-Kopien, eigene Menüs, `disabled`, Domains, Reihenfolge). Gesten-Forks speichern nur Diffs (`overrides`/`removed`/`added`/`order`). Die gesamte Auflösung (`resolveMenu`, `resolveFork`, Fork-Editier-Helfer) lebt als pure Funktionen in `js/menu-model.js` und wird von Options-UI **und** Content-Script benutzt und per Vitest getestet. Spec: `docs/superpowers/specs/2026-07-13-site-menus-design.md`.

**Tech Stack:** Plain JS (kein Build), Lit (vendored) für UI-Komponenten, Vitest für Tests, `chrome.storage.sync` via `SettingsStore` (UI) bzw. direkt (content/background).

## Global Constraints

- **Einrückung: Tabs**, überall (JS, JSON, HTML).
- **Kein Build-Step, kein Bundler.** Content-Script-Dateien sind klassische Skripte (IIFE, `window.*`-Globals) mit `if (typeof module !== 'undefined' && module.exports) module.exports = api;` für Tests — exakt das Muster von [js/menu-patterns.js](../../js/menu-patterns.js).
- **Tests:** `npx vitest run <datei>` (einzeln) bzw. `npm test` (alle). Tests importieren Globals per Side-Effect-Import (`import '../js/menu-model.js'` → `globalThis.FlowMouseMenuModel`).
- **`manifest.json` `version_name` niemals anfassen** (wird von git-Hooks gestampt); `version` nur bei Release.
- **i18n:** Neue Keys in dieser Reihenfolge einführen: erst `_locales/en/messages.json` (default_locale) und `_locales/de/messages.json`; alle übrigen Locales in Task 11.
- **Keine Migration:** Der alte Settings-Key `customMenus` wird ersatzlos entfernt. Alte Gesten-Configs (`{menuId, contextual}` ohne `mode`) dürfen nicht crashen — sie lösen zu „Menü nicht gefunden" auf.
- ES-Module (`js/components/*`, `js/context-menu.js`) dürfen classic-Script-Globals über `window.*` lesen, aber classic Scripts können nichts importieren.
- Extension manuell testen: Repo-Ordner als „entpackte Erweiterung" unter `chrome://extensions` laden, nach Änderungen Reload-Icon klicken.

---

## Ziel-Dateistruktur

| Datei | Verantwortung |
| --- | --- |
| `js/menu-icons.js` (neu) | Kuratiertes Lucide-Icon-Subset für Menüeinträge, `window.FlowMouseMenuIcons` |
| `js/menu-catalog.js` (neu) | Vordefinierte Website-Menüs (Daten), `window.FlowMouseMenuCatalog` |
| `js/menu-model.js` (neu) | Pure Auflösungs-/Editier-Logik (Basis, Fork-Overlay, Kontext, Domains), `window.FlowMouseMenuModel` |
| `js/components/icon-picker.js` (neu) | Icon-Auswahl (Lucide-Raster + Favicon + kein Icon) |
| `js/components/site-menu-editor.js` (neu) | Editor für EIN Menü (Name, Patterns, Domain, Einträge, DnD); „dumm": rendert Rows + feuert Op-Events; Fork-Badges optional |
| `js/components/site-menu-manager.js` (neu) | Settings-Sektion: Menü-Liste, Toggles, Reset, eigene Menüs, Switcher/Theme-Settings; verdrahtet Editor ↔ SettingsStore |
| `js/components/gesture-menu-config.js` (neu) | Gesten-Config-UI der Aktion customMenu (4 Modi), verdrahtet Editor ↔ Fork-Helfer |
| `js/constants.js` (ändern) | `DEFAULT_SETTINGS.siteMenus`, neues `ACTION_DEFAULTS.customMenu` |
| `js/content.js` (ändern) | `case 'customMenu'` auf `resolveMenu()` umstellen, Icon-Serialisierung, Switcher, Gesten-Label |
| `js/context-menu.js` + `pages/context-menu.html` (ändern) | Lucide-Icons inline im Menü-iframe rendern |
| `js/background.js` (ändern) | `addSiteToMenu` auf `siteMenus` umstellen |
| `js/components/action-select.js` (ändern) | customMenu/addSiteToMenu-Config auf neue Komponenten umstellen |
| `js/components/options-page.js` + `pages/options.html` (ändern) | Neue Sektion „Website-Menüs" |
| `js/components/menu-panel.js` (löschen, Task 12) | Alter Pool-Editor entfällt |
| `js/menu-switcher.js` + `tests/menu-switcher.test.mjs` (löschen, Task 12) | Switcher wird direkt aus `listActiveMenus` gebaut |
| `tests/menu-icons.test.mjs`, `tests/menu-model.test.mjs`, `tests/menu-catalog.test.mjs`, `tests/site-menu-locales.test.mjs` (neu) | Absicherung |

---

### Task 1: Icon-Subset `js/menu-icons.js`

**Files:**
- Create: `js/menu-icons.js`
- Test: `tests/menu-icons.test.mjs`

**Interfaces:**
- Produces: `window.FlowMouseMenuIcons` — Objekt `{ [iconName: string]: svgMarkupString }`. Jeder Wert ist ein vollständiges `<svg …>…</svg>`-Snippet mit `stroke="currentColor"`. Konsumiert von Task 5 (context-menu iframe), Task 6 (icon-picker), Task 4 (Katalog-Validierung).

- [ ] **Step 1: Failing Test schreiben**

```js
// tests/menu-icons.test.mjs
import { describe, it, expect } from 'vitest';
import '../js/menu-icons.js';
const ICONS = globalThis.FlowMouseMenuIcons;

describe('FlowMouseMenuIcons', () => {
	it('is a non-empty map of svg strings', () => {
		const names = Object.keys(ICONS);
		expect(names.length).toBeGreaterThanOrEqual(40);
		for (const name of names) {
			expect(ICONS[name], name).toMatch(/^<svg /);
			expect(ICONS[name], name).toContain('stroke="currentColor"');
			expect(ICONS[name], name).toMatch(/<\/svg>$/);
		}
	});
	it('contains the icons the catalog needs', () => {
		for (const n of ['house', 'shoppingCart', 'bell', 'package', 'gitPullRequest', 'circleDot',
			'calendar', 'users', 'send', 'inbox', 'tag', 'trendingUp', 'play', 'video', 'mapPin',
			'messageSquare', 'briefcase', 'newspaper', 'image', 'fileText', 'upload', 'rss',
			'history', 'star', 'heart', 'mail', 'user', 'search', 'bookmark', 'timer',
			'refreshCw', 'compass', 'squarePen', 'trash2', 'ban', 'circleHelp', 'layers',
			'hardDrive', 'github', 'globe', 'layoutList', 'settings', 'link', 'externalLink']) {
			expect(ICONS[n], `missing icon ${n}`).toBeTruthy();
		}
	});
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/menu-icons.test.mjs`
Expected: FAIL (`Cannot find module '../js/menu-icons.js'`)

- [ ] **Step 3: `js/menu-icons.js` implementieren**

Datei-Gerüst (Muster wie [js/menu-patterns.js](../../js/menu-patterns.js)):

```js
(function (root) {
	// Kuratiertes Lucide-Subset für Menüeinträge. Wird im Menü-iframe inline
	// gerendert (currentColor folgt dem Menü-Theme) und vom Icon-Picker gelistet.
	const icons = {
		/* … Einträge, siehe unten … */
	};
	const api = icons;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseMenuIcons = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

**(a) Kopien aus [js/icons.js](../../js/icons.js)** — folgende 28 Einträge wörtlich (SVG-String unverändert) übernehmen; in `icons.js` sind sie Properties desselben Formats:

`house, globe, github, search, history, star, heart, mail, user, settings, bookmark, download, printer, link, externalLink, layoutList, layoutGrid, bookOpen, timer, refreshCw, compass, squarePen, trash2, ban, check, circleHelp, layers, hardDrive`

**(b) Neue Icons** — folgende Einträge hinzufügen (Lucide-Style, `width/height 24`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"`; Attribut-Präfix identisch zu den bestehenden Strings in `icons.js`):

```js
shoppingCart: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>',
bell: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
circleDot: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/></svg>',
gitPullRequest: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/></svg>',
package: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
calendar: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>',
users: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
send: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
inbox: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
tag: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>',
trendingUp: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
play: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
video: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>',
mapPin: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>',
messageSquare: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
briefcase: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/></svg>',
newspaper: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></svg>',
image: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
fileText: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
upload: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>',
rss: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>',
```

Hinweis: Die kopierten Strings aus `icons.js` enthalten `class="lucide …"`-Attribute — die dürfen bleiben; wichtig ist nur `<svg `-Anfang und `stroke="currentColor"`.

- [ ] **Step 4: Test laufen lassen — muss grün sein**

Run: `npx vitest run tests/menu-icons.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add js/menu-icons.js tests/menu-icons.test.mjs
git commit -m "feat(menus): curated lucide icon subset for menu items"
```

---

### Task 2: Settings-Shape (`constants.js`)

**Files:**
- Modify: `js/constants.js` (Bereiche: `ACTION_DEFAULTS.customMenu` ≈ Zeile 123, `DEFAULT_SETTINGS.customMenus` ≈ Zeile 263)
- Test: `tests/settings-defaults.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_SETTINGS.siteMenus = { disabled: [], edited: {}, custom: {}, domains: {}, order: [] }`; `ACTION_DEFAULTS.customMenu = { mode: 'standard', menuId: '', fallbackMenuId: '', ownMenu: null, fork: null }`. Alle späteren Tasks verlassen sich auf exakt diese Feldnamen.

- [ ] **Step 1: Test anpassen (failing)**

In `tests/settings-defaults.test.mjs` den `customMenus`-Testfall ersetzen durch:

```js
	it("siteMenus defaults to empty diff structure", () => {
		expect(DEFAULT_SETTINGS.siteMenus).toEqual({ disabled: [], edited: {}, custom: {}, domains: {}, order: [] });
	});
	it("customMenus key is gone", () => {
		expect(DEFAULT_SETTINGS).not.toHaveProperty("customMenus");
	});
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/settings-defaults.test.mjs`
Expected: FAIL (siteMenus undefined)

- [ ] **Step 3: `js/constants.js` ändern**

In `DEFAULT_SETTINGS` die Zeile `customMenus: {},` ersetzen durch:

```js
		siteMenus: { disabled: [], edited: {}, custom: {}, domains: {}, order: [] },
```

In `ACTION_DEFAULTS` die Zeile `customMenu: { menuId: '', contextual: false },` ersetzen durch:

```js
		customMenu: { mode: 'standard', menuId: '', fallbackMenuId: '', ownMenu: null, fork: null },
```

(`addSiteToMenu: { menuId: '' }` bleibt unverändert.)

- [ ] **Step 4: Run — PASS**

Run: `npx vitest run tests/settings-defaults.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/constants.js tests/settings-defaults.test.mjs
git commit -m "feat(menus): siteMenus settings shape + new customMenu action defaults"
```

---

### Task 3: Kern-Logik `js/menu-model.js` (Vererbung, TDD)

**Files:**
- Create: `js/menu-model.js`
- Test: `tests/menu-model.test.mjs`

**Interfaces:**
- Consumes: nichts (pure; Katalog wird als Parameter gereicht — Tests nutzen Fixtures).
- Produces: `window.FlowMouseMenuModel` mit exakt diesen Signaturen (alle Funktionen immutabel — sie verändern ihre Eingaben nie, sondern liefern neue Objekte):
  - `getBaseMenu(catalog, siteMenus, menuId) -> menuDef|null` — `edited[id]` ?? `custom[id]` ?? Katalogeintrag (Kopie), sonst `null`. `menuDef = { id, name, icon?, patterns: [], domains?: {choices, default}, items: [], showInSwitcher? }`
  - `listMenus(catalog, siteMenus) -> [{ id, def, isCustom, isEdited, disabled }]` — Reihenfolge: `siteMenus.order`-IDs zuerst, dann restlicher Katalog in Katalogreihenfolge, dann restliche `custom`-Menüs.
  - `listActiveMenus(catalog, siteMenus)` — wie `listMenus`, ohne `disabled`.
  - `resolveFork(baseItems, fork) -> items[]` — Kern-Overlay (Regeln unten).
  - `resolveMenu(catalog, siteMenus, cfg, ctx) -> { menuId, name, items, domain }|null` — `cfg = {mode, menuId, fallbackMenuId, ownMenu, fork}`, `ctx = { url, matchesPatterns }` (nur für contextual nötig). Ersetzt `{domain}` in allen `customUrl`s.
  - `resolveContextualMenuId(catalog, siteMenus, url, matchesPatterns) -> id|null`
  - `applyDomain(url, domain) -> string`
  - Fork-Editier-Helfer (liefern neuen Fork): `forkOverrideItem(fork, baseItems, item)`, `forkDeleteItem(fork, baseItems, itemId)`, `forkRestoreItem(fork, itemId)`, `forkAddItem(fork, item, afterId)`, `forkReorder(fork, orderedIds)`, `emptyFork() -> {overrides:{},removed:[],added:[],order:null,name:''}`
  - Settings-Helfer (liefern neues `siteMenus`): `withMenuDef(catalog, siteMenus, menuId, def)` (Katalog-ID → `edited`, sonst `custom`), `withMenuReset(siteMenus, menuId)`, `withMenuDisabled(siteMenus, menuId, disabled)`, `withoutCustomMenu(siteMenus, menuId)`, `withDomain(siteMenus, menuId, domain)`, `addPatternToMenu(catalog, siteMenus, menuId, pattern) -> {siteMenus, added}`
- **Item-Format (überall):** `{ id, type?: 'separator' }` für Separatoren, sonst `{ id, action, labelKey?, customName?, icon?, …actionConfig }`. `icon` ist Lucide-Name, `'favicon'` oder leer. **Keine `'separator'`-String-Items mehr** — alle Items haben IDs (Voraussetzung der Vererbung).

- [ ] **Step 1: Failing Tests schreiben** — `tests/menu-model.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import '../js/menu-model.js';
const M = globalThis.FlowMouseMenuModel;

const CATALOG = [
	{ id: 'gh', name: 'GitHub', patterns: ['*github.com*'], items: [
		{ id: 'a', action: 'openCustomUrl', labelKey: 'kA', customUrl: 'https://github.com/a' },
		{ id: 's1', type: 'separator' },
		{ id: 'b', action: 'openCustomUrl', labelKey: 'kB', customUrl: 'https://github.com/b' },
	] },
	{ id: 'amz', name: 'Amazon', patterns: ['*amazon.*'], domains: { choices: ['amazon.de', 'amazon.com'], default: 'amazon.de' }, items: [
		{ id: 'cart', action: 'openCustomUrl', labelKey: 'kCart', customUrl: 'https://www.{domain}/cart' },
	] },
];
const EMPTY = { disabled: [], edited: {}, custom: {}, domains: {}, order: [] };
const matches = (url, pats) => pats.some(p => url.includes(p.replaceAll('*', '')));

describe('getBaseMenu', () => {
	it('returns catalog copy for pristine menu', () => {
		const m = M.getBaseMenu(CATALOG, EMPTY, 'gh');
		expect(m.name).toBe('GitHub');
		m.items.push({ id: 'x' });
		expect(CATALOG[0].items).toHaveLength(3); // Katalog unangetastet
	});
	it('edited copy wins over catalog', () => {
		const sm = { ...EMPTY, edited: { gh: { name: 'Mein GitHub', patterns: [], items: [] } } };
		expect(M.getBaseMenu(CATALOG, sm, 'gh').name).toBe('Mein GitHub');
	});
	it('resolves custom menus and returns null for unknown ids', () => {
		const sm = { ...EMPTY, custom: { menu_1: { name: 'Eigenes', patterns: [], items: [] } } };
		expect(M.getBaseMenu(CATALOG, sm, 'menu_1').name).toBe('Eigenes');
		expect(M.getBaseMenu(CATALOG, sm, 'nope')).toBeNull();
	});
});

describe('listMenus / listActiveMenus', () => {
	const sm = { ...EMPTY, disabled: ['amz'], custom: { menu_1: { name: 'Eigenes', items: [] } }, order: ['amz'] };
	it('orders by siteMenus.order first, then catalog, then customs; flags set', () => {
		const l = M.listMenus(CATALOG, sm);
		expect(l.map(m => m.id)).toEqual(['amz', 'gh', 'menu_1']);
		expect(l[0].disabled).toBe(true);
		expect(l[2].isCustom).toBe(true);
	});
	it('listActiveMenus drops disabled', () => {
		expect(M.listActiveMenus(CATALOG, sm).map(m => m.id)).toEqual(['gh', 'menu_1']);
	});
});

describe('resolveFork — Vererbungsregeln', () => {
	const base = () => ([
		{ id: 'a', action: 'openCustomUrl', labelKey: 'kA', customUrl: 'u1' },
		{ id: 'b', action: 'openCustomUrl', labelKey: 'kB', customUrl: 'u2' },
		{ id: 'c', action: 'openCustomUrl', labelKey: 'kC', customUrl: 'u3' },
	]);
	it('empty fork mirrors base', () => {
		expect(M.resolveFork(base(), M.emptyFork()).map(i => i.id)).toEqual(['a', 'b', 'c']);
	});
	it('override replaces the whole item, keeps id + position; base change to overridden item is ignored', () => {
		const fork = { ...M.emptyFork(), overrides: { b: { action: 'openCustomUrl', customName: 'Mein B', customUrl: 'mine' } } };
		const later = base(); later[1].customUrl = 'changed-upstream';
		const out = M.resolveFork(later, fork);
		expect(out[1]).toMatchObject({ id: 'b', customName: 'Mein B', customUrl: 'mine' });
	});
	it('unchanged items follow base changes', () => {
		const later = base(); later[0].customUrl = 'new-a';
		const out = M.resolveFork(later, M.emptyFork());
		expect(out[0].customUrl).toBe('new-a');
	});
	it('removed stays gone even after base edits', () => {
		const fork = { ...M.emptyFork(), removed: ['b'] };
		const later = base(); later[1].customUrl = 'changed';
		expect(M.resolveFork(later, fork).map(i => i.id)).toEqual(['a', 'c']);
	});
	it('Positionsvererbung: new base item appears at its base position', () => {
		const later = base(); later.splice(1, 0, { id: 'neu', action: 'openCustomUrl', customUrl: 'n' });
		expect(M.resolveFork(later, M.emptyFork()).map(i => i.id)).toEqual(['a', 'neu', 'b', 'c']);
	});
	it('added items anchor after afterId; "" means start; missing anchor -> end', () => {
		const fork = { ...M.emptyFork(), added: [
			{ id: 'x', afterId: 'a', action: 'none' },
			{ id: 'y', afterId: '', action: 'none' },
			{ id: 'z', afterId: 'weg', action: 'none' },
		] };
		expect(M.resolveFork(base(), fork).map(i => i.id)).toEqual(['y', 'a', 'x', 'b', 'c', 'z']);
	});
	it('added can anchor to another added item', () => {
		const fork = { ...M.emptyFork(), added: [
			{ id: 'x', afterId: 'a', action: 'none' },
			{ id: 'y', afterId: 'x', action: 'none' },
		] };
		expect(M.resolveFork(base(), fork).map(i => i.id)).toEqual(['a', 'x', 'y', 'b', 'c']);
	});
	it('fixed order wins; NEW base items go to the end; stale order-ids ignored', () => {
		const fork = { ...M.emptyFork(), order: ['c', 'a', 'geloescht', 'b'] };
		const later = base(); later.push({ id: 'neu', action: 'none' });
		expect(M.resolveFork(later, fork).map(i => i.id)).toEqual(['c', 'a', 'b', 'neu']);
	});
	it('separators are items with ids and inherit like any item', () => {
		const b = [{ id: 'a', action: 'none' }, { id: 's1', type: 'separator' }, { id: 'b', action: 'none' }];
		const fork = { ...M.emptyFork(), removed: ['s1'] };
		expect(M.resolveFork(b, fork).map(i => i.id)).toEqual(['a', 'b']);
	});
});

describe('fork edit helpers (immutabel)', () => {
	const base = [{ id: 'a', action: 'none' }, { id: 'b', action: 'none' }];
	it('forkOverrideItem on base item creates override; on added item updates added', () => {
		let f = M.forkOverrideItem(M.emptyFork(), base, { id: 'a', action: 'none', customName: 'A2' });
		expect(f.overrides.a.customName).toBe('A2');
		f = M.forkAddItem(f, { id: 'n1', action: 'none' }, 'a');
		f = M.forkOverrideItem(f, base, { id: 'n1', action: 'none', customName: 'N2' });
		expect(f.added.find(i => i.id === 'n1').customName).toBe('N2');
		expect(f.overrides.n1).toBeUndefined();
	});
	it('forkDeleteItem: base item -> removed (override dropped); added item -> dropped entirely', () => {
		let f = M.forkOverrideItem(M.emptyFork(), base, { id: 'a', action: 'none', customName: 'A2' });
		f = M.forkDeleteItem(f, base, 'a');
		expect(f.removed).toEqual(['a']);
		expect(f.overrides.a).toBeUndefined();
		f = M.forkAddItem(f, { id: 'n1', action: 'none' }, '');
		f = M.forkDeleteItem(f, base, 'n1');
		expect(f.added).toEqual([]);
		expect(f.removed).toEqual(['a']);
	});
	it('forkRestoreItem clears removed and override (re-inherits)', () => {
		let f = { ...M.emptyFork(), removed: ['a'], overrides: { b: { action: 'none', customName: 'B2' } } };
		f = M.forkRestoreItem(f, 'a');
		f = M.forkRestoreItem(f, 'b');
		expect(f.removed).toEqual([]);
		expect(f.overrides).toEqual({});
	});
	it('forkReorder sets fixed order; forkAddItem with existing order inserts into order', () => {
		let f = M.forkReorder(M.emptyFork(), ['b', 'a']);
		expect(f.order).toEqual(['b', 'a']);
		f = M.forkAddItem(f, { id: 'n1', action: 'none' }, 'b');
		expect(f.order).toEqual(['b', 'n1', 'a']);
	});
});

describe('resolveMenu', () => {
	it('mode standard resolves base menu', () => {
		const r = M.resolveMenu(CATALOG, EMPTY, { mode: 'standard', menuId: 'gh' });
		expect(r.name).toBe('GitHub');
		expect(r.items).toHaveLength(3);
	});
	it('mode fork applies overlay and optional fork name', () => {
		const cfg = { mode: 'fork', menuId: 'gh', fork: { ...M.emptyFork(), removed: ['b'], name: 'Mein GH' } };
		const r = M.resolveMenu(CATALOG, EMPTY, cfg);
		expect(r.name).toBe('Mein GH');
		expect(r.items.map(i => i.id)).toEqual(['a', 's1']);
	});
	it('mode own uses private definition; empty own -> null', () => {
		const r = M.resolveMenu(CATALOG, EMPTY, { mode: 'own', ownMenu: { name: 'Privat', items: [{ id: 'p1', action: 'none' }] } });
		expect(r.name).toBe('Privat');
		expect(M.resolveMenu(CATALOG, EMPTY, { mode: 'own', ownMenu: null })).toBeNull();
	});
	it('mode contextual picks first active matching menu, else fallback, else null', () => {
		const ctx = { url: 'https://github.com/x', matchesPatterns: matches };
		expect(M.resolveMenu(CATALOG, EMPTY, { mode: 'contextual', fallbackMenuId: 'amz' }, ctx).menuId).toBe('gh');
		const smDis = { ...EMPTY, disabled: ['gh'] };
		expect(M.resolveMenu(CATALOG, smDis, { mode: 'contextual', fallbackMenuId: 'amz' }, ctx).menuId).toBe('amz');
		expect(M.resolveMenu(CATALOG, smDis, { mode: 'contextual', fallbackMenuId: '' }, ctx)).toBeNull();
	});
	it('legacy config without mode resolves like standard (no crash)', () => {
		expect(M.resolveMenu(CATALOG, EMPTY, { menuId: 'weg', contextual: false })).toBeNull();
		expect(M.resolveMenu(CATALOG, EMPTY, { menuId: 'gh' }).menuId).toBe('gh');
	});
	it('substitutes {domain} using chosen domain, falling back to default', () => {
		expect(M.resolveMenu(CATALOG, EMPTY, { mode: 'standard', menuId: 'amz' }).items[0].customUrl)
			.toBe('https://www.amazon.de/cart');
		const sm = { ...EMPTY, domains: { amz: 'amazon.com' } };
		expect(M.resolveMenu(CATALOG, sm, { mode: 'standard', menuId: 'amz' }).items[0].customUrl)
			.toBe('https://www.amazon.com/cart');
	});
	it('disabled menu still resolves via direct reference', () => {
		const sm = { ...EMPTY, disabled: ['gh'] };
		expect(M.resolveMenu(CATALOG, sm, { mode: 'standard', menuId: 'gh' })).not.toBeNull();
	});
});

describe('settings helpers', () => {
	it('withMenuDef writes catalog ids to edited, others to custom', () => {
		let sm = M.withMenuDef(CATALOG, EMPTY, 'gh', { name: 'GH2', items: [] });
		expect(sm.edited.gh.name).toBe('GH2');
		sm = M.withMenuDef(CATALOG, sm, 'menu_9', { name: 'Neu', items: [] });
		expect(sm.custom.menu_9.name).toBe('Neu');
		expect(EMPTY.edited).toEqual({}); // Eingabe unangetastet
	});
	it('withMenuReset removes the edited copy', () => {
		const sm = M.withMenuReset({ ...EMPTY, edited: { gh: { name: 'x', items: [] } } }, 'gh');
		expect(sm.edited).toEqual({});
	});
	it('withMenuDisabled toggles; withoutCustomMenu deletes; withDomain sets', () => {
		let sm = M.withMenuDisabled(EMPTY, 'gh', true);
		expect(sm.disabled).toEqual(['gh']);
		sm = M.withMenuDisabled(sm, 'gh', false);
		expect(sm.disabled).toEqual([]);
		sm = M.withoutCustomMenu({ ...EMPTY, custom: { m1: { items: [] } }, order: ['m1'] }, 'm1');
		expect(sm.custom).toEqual({});
		expect(sm.order).toEqual([]);
		expect(M.withDomain(EMPTY, 'amz', 'amazon.com').domains.amz).toBe('amazon.com');
	});
	it('addPatternToMenu appends deduped, creating edited copy for pristine catalog menus', () => {
		const { siteMenus, added } = M.addPatternToMenu(CATALOG, EMPTY, 'gh', '*gh.io*');
		expect(added).toBe('*gh.io*');
		expect(siteMenus.edited.gh.patterns).toEqual(['*github.com*', '*gh.io*']);
		const again = M.addPatternToMenu(CATALOG, siteMenus, 'gh', '*gh.io*');
		expect(again.added).toBeNull();
		expect(M.addPatternToMenu(CATALOG, EMPTY, 'nope', '*x*').added).toBeNull();
	});
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/menu-model.test.mjs`
Expected: FAIL (Modul fehlt)

- [ ] **Step 3: `js/menu-model.js` implementieren**

```js
(function (root) {
	// Pure Auflösungs- und Editier-Logik für Website-Menüs.
	// Keine chrome.*-APIs, keine i18n — Labels (labelKey/customName) löst der Aufrufer auf.
	// Alle Funktionen sind immutabel: Eingaben werden nie verändert.

	function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

	function getBaseMenu(catalog, siteMenus, menuId) {
		if (!menuId) return null;
		const sm = siteMenus || {};
		if (sm.edited && sm.edited[menuId]) return { ...clone(sm.edited[menuId]), id: menuId };
		if (sm.custom && sm.custom[menuId]) return { ...clone(sm.custom[menuId]), id: menuId };
		const c = (catalog || []).find(m => m.id === menuId);
		return c ? clone(c) : null;
	}

	function listMenus(catalog, siteMenus) {
		const sm = siteMenus || {};
		const disabled = new Set(sm.disabled || []);
		const ids = [];
		const push = (id) => { if (!ids.includes(id)) ids.push(id); };
		for (const id of (sm.order || [])) push(id);
		for (const m of (catalog || [])) push(m.id);
		for (const id of Object.keys(sm.custom || {})) push(id);
		return ids
			.map(id => ({ id, def: getBaseMenu(catalog, sm, id) }))
			.filter(e => e.def)
			.map(e => ({
				id: e.id,
				def: e.def,
				isCustom: !!(sm.custom && sm.custom[e.id]),
				isEdited: !!(sm.edited && sm.edited[e.id]),
				disabled: disabled.has(e.id),
			}));
	}

	function listActiveMenus(catalog, siteMenus) {
		return listMenus(catalog, siteMenus).filter(m => !m.disabled);
	}

	function emptyFork() {
		return { overrides: {}, removed: [], added: [], order: null, name: '' };
	}

	function resolveFork(baseItems, fork) {
		const f = fork || emptyFork();
		const overrides = f.overrides || {};
		const removed = new Set(f.removed || []);
		const added = (f.added || []).map(clone);
		const base = (baseItems || [])
			.filter(it => !removed.has(it.id))
			.map(it => overrides[it.id] ? { ...clone(overrides[it.id]), id: it.id } : clone(it));

		if (Array.isArray(f.order)) {
			const pool = new Map(base.map(it => [it.id, it]));
			for (const it of added) pool.set(it.id, it);
			const out = [];
			for (const id of f.order) {
				const it = pool.get(id);
				if (it) { out.push(it); pool.delete(id); }
			}
			for (const it of pool.values()) out.push(it); // neue Basis-Items ans Ende
			return out;
		}

		// Positionsvererbung: Basisreihenfolge, added per Anker einfügen.
		const out = [...base];
		let headInsert = 0; // added mit afterId '' behalten ihre gespeicherte Reihenfolge am Anfang
		for (const raw of added) {
			const it = { ...raw };
			const afterId = it.afterId ?? '';
			if (afterId === '') { out.splice(headInsert++, 0, it); continue; }
			const idx = out.findIndex(b => b.id === afterId);
			if (idx === -1) out.push(it);
			else out.splice(idx + 1, 0, it);
		}
		return out;
	}

	function forkOverrideItem(fork, baseItems, item) {
		const f = clone(fork) || emptyFork();
		const isAdded = (f.added || []).some(a => a.id === item.id);
		if (isAdded) {
			f.added = f.added.map(a => a.id === item.id ? { ...clone(item), afterId: a.afterId } : a);
			return f;
		}
		if ((baseItems || []).some(b => b.id === item.id)) {
			const o = clone(item);
			delete o.afterId;
			f.overrides = { ...(f.overrides || {}), [item.id]: o };
		}
		return f;
	}

	function forkDeleteItem(fork, baseItems, itemId) {
		const f = clone(fork) || emptyFork();
		if ((f.added || []).some(a => a.id === itemId)) {
			f.added = f.added.filter(a => a.id !== itemId);
		} else if ((baseItems || []).some(b => b.id === itemId)) {
			if (!(f.removed || []).includes(itemId)) f.removed = [...(f.removed || []), itemId];
			if (f.overrides) delete f.overrides[itemId];
		}
		if (Array.isArray(f.order)) f.order = f.order.filter(id => id !== itemId);
		return f;
	}

	function forkRestoreItem(fork, itemId) {
		const f = clone(fork) || emptyFork();
		f.removed = (f.removed || []).filter(id => id !== itemId);
		if (f.overrides) delete f.overrides[itemId];
		return f;
	}

	function forkAddItem(fork, item, afterId) {
		const f = clone(fork) || emptyFork();
		f.added = [...(f.added || []), { ...clone(item), afterId: afterId ?? '' }];
		if (Array.isArray(f.order)) {
			const idx = f.order.indexOf(afterId);
			if (idx === -1) f.order = [...f.order, item.id];
			else f.order = [...f.order.slice(0, idx + 1), item.id, ...f.order.slice(idx + 1)];
		}
		return f;
	}

	function forkReorder(fork, orderedIds) {
		const f = clone(fork) || emptyFork();
		f.order = [...orderedIds];
		return f;
	}

	function applyDomain(url, domain) {
		if (!url || !domain) return url;
		return url.split('{domain}').join(domain);
	}

	function resolveContextualMenuId(catalog, siteMenus, url, matchesPatterns) {
		if (!url || typeof matchesPatterns !== 'function') return null;
		for (const m of listActiveMenus(catalog, siteMenus)) {
			const pats = m.def.patterns || [];
			if (pats.length && matchesPatterns(url, pats)) return m.id;
		}
		return null;
	}

	function resolveMenu(catalog, siteMenus, cfg, ctx) {
		const c = cfg || {};
		const mode = c.mode || 'standard';
		if (mode === 'own') {
			const m = c.ownMenu;
			if (!m) return null;
			return { menuId: '', name: m.name || '', items: (m.items || []).map(clone), domain: '' };
		}
		let menuId = c.menuId;
		if (mode === 'contextual') {
			menuId = resolveContextualMenuId(catalog, siteMenus, ctx && ctx.url, ctx && ctx.matchesPatterns)
				|| c.fallbackMenuId || '';
		}
		const base = getBaseMenu(catalog, siteMenus, menuId);
		if (!base) return null;
		let items = (base.items || []).map(clone);
		let name = base.name || '';
		if (mode === 'fork') {
			items = resolveFork(items, c.fork);
			if (c.fork && c.fork.name) name = c.fork.name;
		}
		const domain = ((siteMenus || {}).domains || {})[base.id]
			|| (base.domains && base.domains.default) || '';
		if (domain) {
			items = items.map(it => it.customUrl ? { ...it, customUrl: applyDomain(it.customUrl, domain) } : it);
		}
		return { menuId: base.id, name, items, domain };
	}

	function isCatalogId(catalog, menuId) {
		return (catalog || []).some(m => m.id === menuId);
	}

	function withMenuDef(catalog, siteMenus, menuId, def) {
		const sm = clone(siteMenus) || {};
		const d = clone(def);
		delete d.id;
		if (isCatalogId(catalog, menuId)) sm.edited = { ...(sm.edited || {}), [menuId]: d };
		else sm.custom = { ...(sm.custom || {}), [menuId]: d };
		return sm;
	}

	function withMenuReset(siteMenus, menuId) {
		const sm = clone(siteMenus) || {};
		if (sm.edited) delete sm.edited[menuId];
		return sm;
	}

	function withMenuDisabled(siteMenus, menuId, disabled) {
		const sm = clone(siteMenus) || {};
		const set = new Set(sm.disabled || []);
		if (disabled) set.add(menuId); else set.delete(menuId);
		sm.disabled = [...set];
		return sm;
	}

	function withoutCustomMenu(siteMenus, menuId) {
		const sm = clone(siteMenus) || {};
		if (sm.custom) delete sm.custom[menuId];
		if (sm.edited) delete sm.edited[menuId];
		sm.disabled = (sm.disabled || []).filter(id => id !== menuId);
		sm.order = (sm.order || []).filter(id => id !== menuId);
		return sm;
	}

	function withDomain(siteMenus, menuId, domain) {
		const sm = clone(siteMenus) || {};
		sm.domains = { ...(sm.domains || {}), [menuId]: domain };
		return sm;
	}

	function addPatternToMenu(catalog, siteMenus, menuId, pattern) {
		if (!pattern) return { siteMenus, added: null };
		const base = getBaseMenu(catalog, siteMenus, menuId);
		if (!base) return { siteMenus, added: null };
		const cur = base.patterns || [];
		if (cur.includes(pattern)) return { siteMenus, added: null };
		const def = { ...base, patterns: [...cur, pattern] };
		return { siteMenus: withMenuDef(catalog, siteMenus, menuId, def), added: pattern };
	}

	const api = {
		getBaseMenu, listMenus, listActiveMenus,
		emptyFork, resolveFork,
		forkOverrideItem, forkDeleteItem, forkRestoreItem, forkAddItem, forkReorder,
		resolveMenu, resolveContextualMenuId, applyDomain,
		withMenuDef, withMenuReset, withMenuDisabled, withoutCustomMenu, withDomain,
		addPatternToMenu,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseMenuModel = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run — PASS**

Run: `npx vitest run tests/menu-model.test.mjs`
Expected: PASS (alle describe-Blöcke). Falls einzelne Fälle scheitern: Implementierung fixen, NICHT die Tests aufweichen — die Tests kodieren die Spec-Regeln.

- [ ] **Step 5: Gesamtlauf + Commit**

Run: `npm test` — Expected: alle Tests PASS.

```bash
git add js/menu-model.js tests/menu-model.test.mjs
git commit -m "feat(menus): menu-model with fork overlay inheritance (resolveMenu/resolveFork + helpers)"
```

---

### Task 4: Katalog `js/menu-catalog.js` + en/de-Labels

**Files:**
- Create: `js/menu-catalog.js`
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json`
- Test: `tests/menu-catalog.test.mjs`

**Interfaces:**
- Consumes: Icon-Namen aus Task 1 (`FlowMouseMenuIcons`), Item-Format aus Task 3.
- Produces: `window.FlowMouseMenuCatalog = { SITE_MENU_CATALOG }` — Array von Menü-Definitionen `{ id, name, icon, patterns, domains?, items }`. Menü-Namen sind Markennamen (kein i18n); Item-Labels nutzen `labelKey` (i18n) oder `customName` (Markenname wie „Outlook").

- [ ] **Step 1: Failing Test schreiben** — `tests/menu-catalog.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import '../js/menu-icons.js';
import '../js/menu-catalog.js';

const { SITE_MENU_CATALOG } = globalThis.FlowMouseMenuCatalog;
const ICONS = globalThis.FlowMouseMenuIcons;
const en = JSON.parse(readFileSync(new URL('../_locales/en/messages.json', import.meta.url), 'utf8'));
const de = JSON.parse(readFileSync(new URL('../_locales/de/messages.json', import.meta.url), 'utf8'));

describe('SITE_MENU_CATALOG', () => {
	it('has the expected menus', () => {
		expect(SITE_MENU_CATALOG.map(m => m.id)).toEqual([
			'github', 'm365', 'amazon', 'google', 'gmail', 'gmaps', 'youtube',
			'facebook', 'instagram', 'x', 'reddit', 'linkedin', 'wikipedia',
		]);
	});
	it('menu ids and item ids are globally unique; every item has an id', () => {
		const menuIds = new Set(); const itemIds = new Set();
		for (const m of SITE_MENU_CATALOG) {
			expect(menuIds.has(m.id)).toBe(false); menuIds.add(m.id);
			for (const it of m.items) {
				expect(it.id, `${m.id} item without id`).toBeTruthy();
				expect(itemIds.has(it.id), `duplicate item id ${it.id}`).toBe(false);
				itemIds.add(it.id);
			}
		}
	});
	it('menus: brand name, valid icon, at least one pattern', () => {
		for (const m of SITE_MENU_CATALOG) {
			expect(typeof m.name, m.id).toBe('string');
			expect(ICONS[m.icon], `${m.id}: icon ${m.icon}`).toBeTruthy();
			expect(m.patterns.length, m.id).toBeGreaterThan(0);
		}
	});
	it('items: label present (labelKey in en+de, or customName), icon valid, urls https', () => {
		for (const m of SITE_MENU_CATALOG) {
			for (const it of m.items) {
				if (it.type === 'separator') continue;
				expect(!!it.labelKey || !!it.customName, `${it.id}: no label`).toBe(true);
				if (it.labelKey) {
					expect(en[it.labelKey], `en missing ${it.labelKey}`).toBeTruthy();
					expect(de[it.labelKey], `de missing ${it.labelKey}`).toBeTruthy();
				}
				if (it.icon) expect(ICONS[it.icon], `${it.id}: icon ${it.icon}`).toBeTruthy();
				expect(it.action, it.id).toBe('openCustomUrl');
				expect(it.customUrl, it.id).toMatch(/^https:\/\//);
				if (it.customUrl.includes('{domain}')) {
					expect(m.domains, `${m.id} uses {domain} without domains config`).toBeTruthy();
				}
			}
		}
	});
	it('domains config: default is one of choices', () => {
		for (const m of SITE_MENU_CATALOG) {
			if (!m.domains) continue;
			expect(m.domains.choices).toContain(m.domains.default);
		}
	});
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/menu-catalog.test.mjs`
Expected: FAIL (Modul fehlt)

- [ ] **Step 3: `js/menu-catalog.js` implementieren** — vollständiger Inhalt:

```js
(function (root) {
	// Vordefinierte Website-Menüs (Katalog). Nur Daten — Auflösung in menu-model.js.
	// Menü-Namen sind Markennamen (unübersetzt). Item-Labels: labelKey (i18n)
	// oder customName (Markenname). Alle URLs funktionieren ohne Nutzerkontext.
	// '{domain}' wird nur in Menüs mit domains-Config verwendet.
	const SITE_MENU_CATALOG = [
		{ id: 'github', name: 'GitHub', icon: 'github', patterns: ['*github.com*'], items: [
			{ id: 'gh-home', labelKey: 'siteMenuItemHome', icon: 'house', action: 'openCustomUrl', customUrl: 'https://github.com/dashboard' },
			{ id: 'gh-notif', labelKey: 'siteMenuItemNotifications', icon: 'bell', action: 'openCustomUrl', customUrl: 'https://github.com/notifications' },
			{ id: 'gh-issues', labelKey: 'siteMenuItemIssues', icon: 'circleDot', action: 'openCustomUrl', customUrl: 'https://github.com/issues' },
			{ id: 'gh-pulls', labelKey: 'siteMenuItemPullRequests', icon: 'gitPullRequest', action: 'openCustomUrl', customUrl: 'https://github.com/pulls' },
			{ id: 'gh-sep1', type: 'separator' },
			{ id: 'gh-new', labelKey: 'siteMenuItemNewRepo', icon: 'squarePen', action: 'openCustomUrl', customUrl: 'https://github.com/new' },
			{ id: 'gh-gists', customName: 'Gists', icon: 'fileText', action: 'openCustomUrl', customUrl: 'https://gist.github.com/' },
			{ id: 'gh-trending', labelKey: 'siteMenuItemTrending', icon: 'trendingUp', action: 'openCustomUrl', customUrl: 'https://github.com/trending' },
			{ id: 'gh-settings', labelKey: 'siteMenuItemSettings', icon: 'settings', action: 'openCustomUrl', customUrl: 'https://github.com/settings' },
		] },
		{ id: 'm365', name: 'Microsoft 365', icon: 'layoutGrid', patterns: ['*office.com*', '*microsoft365.com*', '*cloud.microsoft*'], items: [
			{ id: 'ms-home', labelKey: 'siteMenuItemHome', icon: 'house', action: 'openCustomUrl', customUrl: 'https://www.office.com/' },
			{ id: 'ms-outlook', customName: 'Outlook', icon: 'mail', action: 'openCustomUrl', customUrl: 'https://outlook.office.com/mail/' },
			{ id: 'ms-calendar', labelKey: 'siteMenuItemCalendar', icon: 'calendar', action: 'openCustomUrl', customUrl: 'https://outlook.office.com/calendar/' },
			{ id: 'ms-onedrive', customName: 'OneDrive', icon: 'hardDrive', action: 'openCustomUrl', customUrl: 'https://www.office.com/launch/onedrive' },
			{ id: 'ms-sep1', type: 'separator' },
			{ id: 'ms-word', customName: 'Word', icon: 'fileText', action: 'openCustomUrl', customUrl: 'https://www.office.com/launch/word' },
			{ id: 'ms-excel', customName: 'Excel', icon: 'layoutGrid', action: 'openCustomUrl', customUrl: 'https://www.office.com/launch/excel' },
			{ id: 'ms-powerpoint', customName: 'PowerPoint', icon: 'play', action: 'openCustomUrl', customUrl: 'https://www.office.com/launch/powerpoint' },
			{ id: 'ms-teams', customName: 'Teams', icon: 'users', action: 'openCustomUrl', customUrl: 'https://teams.microsoft.com/' },
			{ id: 'ms-todo', customName: 'To Do', icon: 'check', action: 'openCustomUrl', customUrl: 'https://to-do.office.com/' },
		] },
		{ id: 'amazon', name: 'Amazon', icon: 'shoppingCart', patterns: ['*amazon.*'],
			domains: { choices: ['amazon.de', 'amazon.com', 'amazon.co.uk', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.nl', 'amazon.com.be', 'amazon.pl', 'amazon.se', 'amazon.ca', 'amazon.com.au', 'amazon.co.jp'], default: 'amazon.de' }, items: [
			{ id: 'amz-home', labelKey: 'siteMenuItemHome', icon: 'house', action: 'openCustomUrl', customUrl: 'https://www.{domain}/' },
			{ id: 'amz-cart', labelKey: 'siteMenuItemCart', icon: 'shoppingCart', action: 'openCustomUrl', customUrl: 'https://www.{domain}/gp/cart/view.html' },
			{ id: 'amz-orders', labelKey: 'siteMenuItemOrders', icon: 'package', action: 'openCustomUrl', customUrl: 'https://www.{domain}/gp/css/order-history' },
			{ id: 'amz-wishlist', labelKey: 'siteMenuItemWishlist', icon: 'heart', action: 'openCustomUrl', customUrl: 'https://www.{domain}/hz/wishlist/ls' },
			{ id: 'amz-sep1', type: 'separator' },
			{ id: 'amz-subscribe', labelKey: 'siteMenuItemSubscribeSave', icon: 'refreshCw', action: 'openCustomUrl', customUrl: 'https://www.{domain}/auto-deliveries' },
			{ id: 'amz-returns', labelKey: 'siteMenuItemReturns', icon: 'rotateCcw', action: 'openCustomUrl', customUrl: 'https://www.{domain}/gp/css/returns/homepage.html' },
			{ id: 'amz-deals', labelKey: 'siteMenuItemDeals', icon: 'tag', action: 'openCustomUrl', customUrl: 'https://www.{domain}/gp/goldbox' },
			{ id: 'amz-help', labelKey: 'siteMenuItemCustomerService', icon: 'circleHelp', action: 'openCustomUrl', customUrl: 'https://www.{domain}/gp/help/customer/display.html' },
			{ id: 'amz-account', labelKey: 'siteMenuItemAccount', icon: 'user', action: 'openCustomUrl', customUrl: 'https://www.{domain}/gp/css/homepage.html' },
		] },
		{ id: 'google', name: 'Google', icon: 'search', patterns: ['*google.com*', '*google.de*'], items: [
			{ id: 'goo-home', labelKey: 'siteMenuItemSearch', icon: 'search', action: 'openCustomUrl', customUrl: 'https://www.google.com/' },
			{ id: 'goo-images', labelKey: 'siteMenuItemImages', icon: 'image', action: 'openCustomUrl', customUrl: 'https://images.google.com/' },
			{ id: 'goo-news', labelKey: 'siteMenuItemNews', icon: 'newspaper', action: 'openCustomUrl', customUrl: 'https://news.google.com/' },
			{ id: 'goo-translate', labelKey: 'siteMenuItemTranslate', icon: 'globe', action: 'openCustomUrl', customUrl: 'https://translate.google.com/' },
			{ id: 'goo-sep1', type: 'separator' },
			{ id: 'goo-drive', customName: 'Drive', icon: 'hardDrive', action: 'openCustomUrl', customUrl: 'https://drive.google.com/' },
			{ id: 'goo-photos', customName: 'Fotos', labelKey: 'siteMenuItemPhotos', icon: 'image', action: 'openCustomUrl', customUrl: 'https://photos.google.com/' },
			{ id: 'goo-calendar', labelKey: 'siteMenuItemCalendar', icon: 'calendar', action: 'openCustomUrl', customUrl: 'https://calendar.google.com/' },
			{ id: 'goo-contacts', labelKey: 'siteMenuItemContacts', icon: 'users', action: 'openCustomUrl', customUrl: 'https://contacts.google.com/' },
		] },
		{ id: 'gmail', name: 'Gmail', icon: 'mail', patterns: ['*mail.google.com*'], items: [
			{ id: 'gm-inbox', labelKey: 'siteMenuItemInbox', icon: 'inbox', action: 'openCustomUrl', customUrl: 'https://mail.google.com/mail/u/0/#inbox' },
			{ id: 'gm-starred', labelKey: 'siteMenuItemStarred', icon: 'star', action: 'openCustomUrl', customUrl: 'https://mail.google.com/mail/u/0/#starred' },
			{ id: 'gm-sent', labelKey: 'siteMenuItemSent', icon: 'send', action: 'openCustomUrl', customUrl: 'https://mail.google.com/mail/u/0/#sent' },
			{ id: 'gm-drafts', labelKey: 'siteMenuItemDrafts', icon: 'fileText', action: 'openCustomUrl', customUrl: 'https://mail.google.com/mail/u/0/#drafts' },
			{ id: 'gm-sep1', type: 'separator' },
			{ id: 'gm-spam', labelKey: 'siteMenuItemSpam', icon: 'ban', action: 'openCustomUrl', customUrl: 'https://mail.google.com/mail/u/0/#spam' },
			{ id: 'gm-trash', labelKey: 'siteMenuItemTrash', icon: 'trash2', action: 'openCustomUrl', customUrl: 'https://mail.google.com/mail/u/0/#trash' },
		] },
		{ id: 'gmaps', name: 'Google Maps', icon: 'mapPin', patterns: ['*google.com/maps*', '*maps.google.*'], items: [
			{ id: 'map-home', labelKey: 'siteMenuItemHome', icon: 'mapPin', action: 'openCustomUrl', customUrl: 'https://www.google.com/maps' },
			{ id: 'map-dir', labelKey: 'siteMenuItemDirections', icon: 'compass', action: 'openCustomUrl', customUrl: 'https://www.google.com/maps/dir/' },
			{ id: 'map-timeline', labelKey: 'siteMenuItemTimeline', icon: 'history', action: 'openCustomUrl', customUrl: 'https://timeline.google.com/' },
			{ id: 'map-contrib', labelKey: 'siteMenuItemContributions', icon: 'squarePen', action: 'openCustomUrl', customUrl: 'https://www.google.com/maps/contrib/' },
		] },
		{ id: 'youtube', name: 'YouTube', icon: 'play', patterns: ['*youtube.com*'], items: [
			{ id: 'yt-home', labelKey: 'siteMenuItemHome', icon: 'house', action: 'openCustomUrl', customUrl: 'https://www.youtube.com/' },
			{ id: 'yt-subs', labelKey: 'siteMenuItemSubscriptions', icon: 'rss', action: 'openCustomUrl', customUrl: 'https://www.youtube.com/feed/subscriptions' },
			{ id: 'yt-history', labelKey: 'siteMenuItemHistory', icon: 'history', action: 'openCustomUrl', customUrl: 'https://www.youtube.com/feed/history' },
			{ id: 'yt-later', labelKey: 'siteMenuItemWatchLater', icon: 'timer', action: 'openCustomUrl', customUrl: 'https://www.youtube.com/playlist?list=WL' },
			{ id: 'yt-playlists', labelKey: 'siteMenuItemPlaylists', icon: 'layoutList', action: 'openCustomUrl', customUrl: 'https://www.youtube.com/feed/playlists' },
			{ id: 'yt-sep1', type: 'separator' },
			{ id: 'yt-trending', labelKey: 'siteMenuItemTrending', icon: 'trendingUp', action: 'openCustomUrl', customUrl: 'https://www.youtube.com/feed/trending' },
			{ id: 'yt-shorts', customName: 'Shorts', icon: 'video', action: 'openCustomUrl', customUrl: 'https://www.youtube.com/shorts' },
			{ id: 'yt-studio', customName: 'YouTube Studio', icon: 'upload', action: 'openCustomUrl', customUrl: 'https://studio.youtube.com/' },
		] },
		{ id: 'facebook', name: 'Facebook', icon: 'users', patterns: ['*facebook.com*'], items: [
			{ id: 'fb-home', labelKey: 'siteMenuItemHome', icon: 'house', action: 'openCustomUrl', customUrl: 'https://www.facebook.com/' },
			{ id: 'fb-notif', labelKey: 'siteMenuItemNotifications', icon: 'bell', action: 'openCustomUrl', customUrl: 'https://www.facebook.com/notifications' },
			{ id: 'fb-friends', labelKey: 'siteMenuItemFriends', icon: 'users', action: 'openCustomUrl', customUrl: 'https://www.facebook.com/friends' },
			{ id: 'fb-groups', labelKey: 'siteMenuItemGroups', icon: 'users', action: 'openCustomUrl', customUrl: 'https://www.facebook.com/groups/' },
			{ id: 'fb-sep1', type: 'separator' },
			{ id: 'fb-marketplace', customName: 'Marketplace', icon: 'tag', action: 'openCustomUrl', customUrl: 'https://www.facebook.com/marketplace/' },
			{ id: 'fb-saved', labelKey: 'siteMenuItemSaved', icon: 'bookmark', action: 'openCustomUrl', customUrl: 'https://www.facebook.com/saved/' },
			{ id: 'fb-watch', labelKey: 'siteMenuItemVideos', icon: 'play', action: 'openCustomUrl', customUrl: 'https://www.facebook.com/watch/' },
			{ id: 'fb-messenger', customName: 'Messenger', icon: 'messageSquare', action: 'openCustomUrl', customUrl: 'https://www.messenger.com/' },
		] },
		{ id: 'instagram', name: 'Instagram', icon: 'image', patterns: ['*instagram.com*'], items: [
			{ id: 'ig-home', labelKey: 'siteMenuItemHome', icon: 'house', action: 'openCustomUrl', customUrl: 'https://www.instagram.com/' },
			{ id: 'ig-direct', labelKey: 'siteMenuItemMessages', icon: 'send', action: 'openCustomUrl', customUrl: 'https://www.instagram.com/direct/inbox/' },
			{ id: 'ig-explore', labelKey: 'siteMenuItemExplore', icon: 'compass', action: 'openCustomUrl', customUrl: 'https://www.instagram.com/explore/' },
			{ id: 'ig-reels', customName: 'Reels', icon: 'play', action: 'openCustomUrl', customUrl: 'https://www.instagram.com/reels/' },
		] },
		{ id: 'x', name: 'X (Twitter)', icon: 'messageSquare', patterns: ['*x.com*', '*twitter.com*'], items: [
			{ id: 'x-home', labelKey: 'siteMenuItemHome', icon: 'house', action: 'openCustomUrl', customUrl: 'https://x.com/home' },
			{ id: 'x-notif', labelKey: 'siteMenuItemNotifications', icon: 'bell', action: 'openCustomUrl', customUrl: 'https://x.com/notifications' },
			{ id: 'x-messages', labelKey: 'siteMenuItemMessages', icon: 'mail', action: 'openCustomUrl', customUrl: 'https://x.com/messages' },
			{ id: 'x-bookmarks', labelKey: 'siteMenuItemBookmarks', icon: 'bookmark', action: 'openCustomUrl', customUrl: 'https://x.com/i/bookmarks' },
			{ id: 'x-explore', labelKey: 'siteMenuItemExplore', icon: 'search', action: 'openCustomUrl', customUrl: 'https://x.com/explore' },
			{ id: 'x-compose', labelKey: 'siteMenuItemCompose', icon: 'squarePen', action: 'openCustomUrl', customUrl: 'https://x.com/compose/post' },
		] },
		{ id: 'reddit', name: 'Reddit', icon: 'messageSquare', patterns: ['*reddit.com*'], items: [
			{ id: 'rd-home', labelKey: 'siteMenuItemHome', icon: 'house', action: 'openCustomUrl', customUrl: 'https://www.reddit.com/' },
			{ id: 'rd-popular', customName: 'r/popular', icon: 'trendingUp', action: 'openCustomUrl', customUrl: 'https://www.reddit.com/r/popular/' },
			{ id: 'rd-all', customName: 'r/all', icon: 'layers', action: 'openCustomUrl', customUrl: 'https://www.reddit.com/r/all/' },
			{ id: 'rd-inbox', labelKey: 'siteMenuItemMessages', icon: 'inbox', action: 'openCustomUrl', customUrl: 'https://www.reddit.com/message/inbox/' },
			{ id: 'rd-saved', labelKey: 'siteMenuItemSaved', icon: 'bookmark', action: 'openCustomUrl', customUrl: 'https://www.reddit.com/user/me/saved/' },
			{ id: 'rd-submit', labelKey: 'siteMenuItemCompose', icon: 'squarePen', action: 'openCustomUrl', customUrl: 'https://www.reddit.com/submit' },
		] },
		{ id: 'linkedin', name: 'LinkedIn', icon: 'briefcase', patterns: ['*linkedin.com*'], items: [
			{ id: 'li-home', labelKey: 'siteMenuItemHome', icon: 'house', action: 'openCustomUrl', customUrl: 'https://www.linkedin.com/feed/' },
			{ id: 'li-network', labelKey: 'siteMenuItemNetwork', icon: 'users', action: 'openCustomUrl', customUrl: 'https://www.linkedin.com/mynetwork/' },
			{ id: 'li-jobs', labelKey: 'siteMenuItemJobs', icon: 'briefcase', action: 'openCustomUrl', customUrl: 'https://www.linkedin.com/jobs/' },
			{ id: 'li-messages', labelKey: 'siteMenuItemMessages', icon: 'messageSquare', action: 'openCustomUrl', customUrl: 'https://www.linkedin.com/messaging/' },
			{ id: 'li-notif', labelKey: 'siteMenuItemNotifications', icon: 'bell', action: 'openCustomUrl', customUrl: 'https://www.linkedin.com/notifications/' },
			{ id: 'li-profile', labelKey: 'siteMenuItemProfile', icon: 'user', action: 'openCustomUrl', customUrl: 'https://www.linkedin.com/in/me/' },
		] },
		{ id: 'wikipedia', name: 'Wikipedia', icon: 'bookOpen', patterns: ['*wikipedia.org*'],
			domains: { choices: ['de.wikipedia.org', 'en.wikipedia.org', 'fr.wikipedia.org', 'es.wikipedia.org', 'it.wikipedia.org', 'nl.wikipedia.org', 'pl.wikipedia.org', 'pt.wikipedia.org', 'ru.wikipedia.org', 'ja.wikipedia.org', 'zh.wikipedia.org'], default: 'de.wikipedia.org' }, items: [
			{ id: 'wp-home', labelKey: 'siteMenuItemHome', icon: 'house', action: 'openCustomUrl', customUrl: 'https://{domain}/' },
			{ id: 'wp-random', labelKey: 'siteMenuItemRandomArticle', icon: 'compass', action: 'openCustomUrl', customUrl: 'https://{domain}/wiki/Special:Random' },
			{ id: 'wp-watchlist', labelKey: 'siteMenuItemWatchlist', icon: 'star', action: 'openCustomUrl', customUrl: 'https://{domain}/wiki/Special:Watchlist' },
			{ id: 'wp-recent', labelKey: 'siteMenuItemRecentChanges', icon: 'history', action: 'openCustomUrl', customUrl: 'https://{domain}/wiki/Special:RecentChanges' },
		] },
	];

	const api = { SITE_MENU_CATALOG };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseMenuCatalog = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

Achtung: `rotateCcw` wird von `amz-returns` benutzt — in Task 1 nicht in der Kopierliste! In diesem Task zu `js/menu-icons.js` hinzukopieren (aus `icons.js`, existiert dort) und in `tests/menu-icons.test.mjs` der Icon-Liste hinzufügen. Ebenso prüft der Katalog-Test jedes verwendete Icon — fehlende Namen jetzt ergänzen. `goo-photos` hat sowohl `customName` als auch `labelKey` — `customName` gewinnt bei der Anzeige; hier `customName` entfernen und nur `labelKey: 'siteMenuItemPhotos'` verwenden (Fotos ist übersetzbar).

- [ ] **Step 4: i18n-Keys in `_locales/en/messages.json` und `_locales/de/messages.json` ergänzen**

Format wie bestehende Einträge: `"key": { "message": "…" }`. Alphabetisch an passender Stelle einfügen (die Kataloge sind flach, Reihenfolge egal — ans Ende ist ok).

| Key | en | de |
| --- | --- | --- |
| siteMenuItemHome | Home | Startseite |
| siteMenuItemNotifications | Notifications | Benachrichtigungen |
| siteMenuItemMessages | Messages | Nachrichten |
| siteMenuItemHistory | History | Verlauf |
| siteMenuItemSaved | Saved | Gespeichert |
| siteMenuItemBookmarks | Bookmarks | Lesezeichen |
| siteMenuItemExplore | Explore | Entdecken |
| siteMenuItemTrending | Trending | Trends |
| siteMenuItemSearch | Search | Suche |
| siteMenuItemProfile | Profile | Profil |
| siteMenuItemCompose | Compose | Verfassen |
| siteMenuItemSettings | Settings | Einstellungen |
| siteMenuItemCalendar | Calendar | Kalender |
| siteMenuItemIssues | Issues | Issues |
| siteMenuItemPullRequests | Pull requests | Pull Requests |
| siteMenuItemNewRepo | New repository | Neues Repository |
| siteMenuItemCart | Cart | Warenkorb |
| siteMenuItemOrders | Orders | Bestellungen |
| siteMenuItemWishlist | Wish list | Wunschliste |
| siteMenuItemSubscribeSave | Subscribe & Save | Spar-Abo |
| siteMenuItemReturns | Returns | Retouren |
| siteMenuItemDeals | Deals | Angebote |
| siteMenuItemCustomerService | Customer service | Kundenservice |
| siteMenuItemAccount | Account | Konto |
| siteMenuItemImages | Images | Bilder |
| siteMenuItemNews | News | News |
| siteMenuItemTranslate | Translate | Übersetzer |
| siteMenuItemPhotos | Photos | Fotos |
| siteMenuItemContacts | Contacts | Kontakte |
| siteMenuItemInbox | Inbox | Posteingang |
| siteMenuItemStarred | Starred | Markiert |
| siteMenuItemSent | Sent | Gesendet |
| siteMenuItemDrafts | Drafts | Entwürfe |
| siteMenuItemSpam | Spam | Spam |
| siteMenuItemTrash | Trash | Papierkorb |
| siteMenuItemDirections | Directions | Route planen |
| siteMenuItemTimeline | Your timeline | Meine Zeitachse |
| siteMenuItemContributions | Contributions | Beiträge |
| siteMenuItemSubscriptions | Subscriptions | Abos |
| siteMenuItemWatchLater | Watch later | Später ansehen |
| siteMenuItemPlaylists | Playlists | Playlists |
| siteMenuItemFriends | Friends | Freunde |
| siteMenuItemGroups | Groups | Gruppen |
| siteMenuItemVideos | Videos | Videos |
| siteMenuItemNetwork | My network | Mein Netzwerk |
| siteMenuItemJobs | Jobs | Jobs |
| siteMenuItemRandomArticle | Random article | Zufälliger Artikel |
| siteMenuItemWatchlist | Watchlist | Beobachtungsliste |
| siteMenuItemRecentChanges | Recent changes | Letzte Änderungen |

- [ ] **Step 5: Run — PASS**

Run: `npx vitest run tests/menu-catalog.test.mjs tests/menu-icons.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add js/menu-catalog.js js/menu-icons.js tests/menu-catalog.test.mjs tests/menu-icons.test.mjs _locales/en/messages.json _locales/de/messages.json
git commit -m "feat(menus): predefined site menu catalog (13 menus) with en/de labels"
```

---

### Task 5: Laufzeit — manifest, content.js, Menü-iframe, background

**Files:**
- Modify: `manifest.json` (content_scripts)
- Modify: `js/content.js` (case `'customMenu'` ≈ Zeile 3478, Gesten-Label ≈ Zeile 2092, `resolveContextualMenuId` ≈ Zeile 3186, `ContentContextMenu.setItems` ≈ Zeile 472)
- Modify: `js/context-menu.js` (Icon-Rendering ≈ Zeile 583, CSS ≈ Zeile 71)
- Modify: `pages/context-menu.html`
- Modify: `js/background.js` (Zeile 1 `importScripts`, `case 'addSiteToMenu'` ≈ Zeile 810)
- Test: bestehende Vitest-Suite bleibt grün; funktional: manuelle Prüfung (Schritt 7)

**Interfaces:**
- Consumes: `FlowMouseMenuModel.resolveMenu/listActiveMenus/addPatternToMenu` (Task 3), `FlowMouseMenuCatalog.SITE_MENU_CATALOG` (Task 4), `FlowMouseMenuIcons` (Task 1).
- Produces: Menü-Items, die an das iframe serialisiert werden, tragen zusätzlich `iconName` (Lucide-Name). Gesten-Config wird ausschließlich über `resolveMenu()` interpretiert — die UI-Tasks (9/10) speichern exakt das `ACTION_DEFAULTS.customMenu`-Format.

- [ ] **Step 1: `manifest.json` — neue Skripte in `content_scripts.js` einfügen**

Nach `"js/menu-switcher.js",` einfügen (Reihenfolge zwingend vor `content.js`):

```json
				"js/menu-catalog.js",
				"js/menu-model.js",
```

- [ ] **Step 2: `js/content.js` — Destrukturierung + Kontexthelfer**

Oben bei der Konstanten-Destrukturierung (≈ Zeile 1969) ist nichts zu tun (Model/Katalog kommen als `window.*`). Direkt nach der Funktion `resolveSearchLink` (≈ Zeile 3185) die alte Funktion `resolveContextualMenuId(menus)` **ersetzen** durch:

```js
		function resolveGestureMenu(config) {
			const cfg = { ...(ACTION_DEFAULTS.customMenu || {}), ...(config || {}) };
			return window.FlowMouseMenuModel.resolveMenu(
				window.FlowMouseMenuCatalog.SITE_MENU_CATALOG,
				SETTINGS.siteMenus,
				cfg,
				{ url: location.href, matchesPatterns: window.FlowMouseSearchUrl.matchesPatterns }
			);
		}
```

- [ ] **Step 3: `js/content.js` — Gesten-Label (≈ Zeile 2092)**

Den Block `if (action === 'customMenu') { … }` ersetzen durch:

```js
			if (action === 'customMenu') {
				const config = SETTINGS.mouseGestures?.[pattern];
				if (config?.mode === 'own') return config.ownMenu?.name || msg('customMenuOwnLabel');
				const resolved = resolveGestureMenu(config);
				if (resolved?.name) return resolved.name;
				if (!resolved) {
					return config?.mode === 'contextual'
						? msg('customMenuContextualLabel')
						: `${msg(ACTION_KEYS[action])} ${msg('menuNotFound')}`;
				}
			}
```

Hinweis: `resolveGestureMenu` ist in der IIFE von `initGestures` definiert — prüfen, dass der Label-Code (Funktion um Zeile 2085) im selben Scope liegt; liegt er außerhalb, `resolveGestureMenu` stattdessen auf oberster IIFE-Ebene neben `resolveSearchLink` definieren (dort lebt heute schon `resolveContextualMenuId`, das von beiden Stellen benutzt wird — gleiche Stelle verwenden).

- [ ] **Step 4: `js/content.js` — `case 'customMenu'` (≈ Zeile 3478–3552) komplett ersetzen**

```js
				case 'customMenu': {
					const gestureCfg = { ...(ACTION_DEFAULTS.customMenu || {}), ...mergedConfig };
					const menuSelectionText = (window.getSelection()?.toString() || '').trim();

					const buildItems = (resolved) => resolved.items
						.filter(it => it.type === 'separator' || (it.action && it.action !== 'none'))
						.map(it => {
							if (it.type === 'separator') return 'separator';
							let label = it.customName;
							if (!label && it.labelKey) label = msg(it.labelKey);
							if (!label && it.action === 'actionChain') {
								const chain = SETTINGS.actionChains?.[it.chainId];
								label = chain?.name || msg(ACTION_KEYS[it.action]);
							}
							const entry = {
								onClick: () => {
									const itemConfig = { ...(ACTION_DEFAULTS[it.action] || {}), ...it };
									if (it.action === 'searchLink') itemConfig.__selectionText = menuSelectionText;
									executeAction(it.action, itemConfig, cursor, startTarget);
								}
							};
							if (it.action === 'searchLink') {
								const rl = resolveSearchLink({ ...(ACTION_DEFAULTS['searchLink'] || {}), ...it });
								entry.label = label || rl?.name || msg(ACTION_KEYS['searchLink']);
								entry.icon = rl ? rl.icon : '';
								if (rl && !rl.iconBundled) entry._faviconUrl = rl.url;
							} else {
								entry.label = label || msg(ACTION_KEYS[it.action]) || it.action;
							}
							// Icon-Feld: Lucide-Name oder 'favicon' (Ziel-URL-Favicon)
							if (it.icon && it.icon !== 'favicon') {
								entry.iconName = it.icon;
							} else if (it.icon === 'favicon') {
								const target = it.customUrl || entry._faviconUrl;
								if (target) {
									entry.icon = monogramFor(entry.label, target);
									entry._faviconUrl = target;
								}
							}
							return entry;
						});

					// Switcher zeigt aktive Standard-Menüs (Forks/eigene Menüs sind privat).
					const buildSwitcher = (resolved) => {
						const sw = SETTINGS.customMenuSwitcher;
						if (!sw?.enabled) return null;
						const active = window.FlowMouseMenuModel.listActiveMenus(
							window.FlowMouseMenuCatalog.SITE_MENU_CATALOG, SETTINGS.siteMenus);
						const menus = active
							.filter(m => m.id !== resolved.menuId && m.def.showInSwitcher !== false)
							.map(m => ({ id: m.id, name: m.def.name || msg('actionCustomMenu') }));
						if (!menus.length) return null;
						return {
							name: resolved.name || msg('actionCustomMenu'),
							position: sw.position === 'footer' ? 'footer' : 'header',
							menus,
						};
					};

					const buildMenu = (resolved) => {
						if (!resolved) return null;
						return { items: buildItems(resolved), switcher: buildSwitcher(resolved) };
					};

					const initialResolved = resolveGestureMenu(gestureCfg);
					const initial = buildMenu(initialResolved);
					if (!initial) break;

					ctxMenu.prepare(cursor.endX, cursor.endY);
					ctxMenu.setSwitcher((id) => {
						// Umschalten zeigt immer die Standard-Version des Ziel-Menüs.
						const resolved = resolveGestureMenu({ mode: 'standard', menuId: id });
						const rebuilt = buildMenu(resolved);
						if (!rebuilt) return; // gelöscht → no-op
						ctxMenu.setItems(rebuilt.items, rebuilt.switcher);
						upgradeMenuIcons(rebuilt.items);
					});
					ctxMenu.setItems(initial.items, initial.switcher);
					upgradeMenuIcons(initial.items);
					break;
				}
```

- [ ] **Step 5: Icon-Transport ins iframe**

**(a)** `js/content.js`, `ContentContextMenu.setItems` (≈ Zeile 474): Serialisierung erweitern —

```js
			return { label: item.label, icon: item.icon, iconName: item.iconName, active: item.active, time: item.time };
```

**(b)** `pages/context-menu.html`: vor dem Modul-Script einfügen:

```html
	<script src="../js/menu-icons.js"></script>
```

**(c)** `js/context-menu.js`: `unsafeHTML` importieren (Zeile 2):

```js
import { LitElement, html, css, unsafeHTML } from './lib/lit-all.min.js';
```

Icon-Rendering (≈ Zeile 583) ersetzen:

```js
							<span class="fm-ctx-icon">
								${item.iconName && globalThis.FlowMouseMenuIcons?.[item.iconName]
									? unsafeHTML(globalThis.FlowMouseMenuIcons[item.iconName])
									: item.icon ? html`<img src="${item.icon}" alt="" draggable="false">` : ''}
							</span>
```

Im CSS-Block bei `.fm-ctx-icon img` (≈ Zeile 80) ergänzen:

```css
			.fm-ctx-icon svg {
				width: 16px;
				height: 16px;
				display: block;
			}
```

- [ ] **Step 6: `js/background.js` — addSiteToMenu**

Zeile 1 erweitern:

```js
importScripts('menu-patterns.js');
importScripts('menu-catalog.js');
importScripts('menu-model.js');
```

`case 'addSiteToMenu'` (≈ Zeile 810) ersetzen:

```js
		case 'addSiteToMenu': {
			const menuId = request.menuId;
			const url = sender.tab?.url;
			if (!menuId || !url) return { success: false };
			const pattern = self.FlowMouseMenuPatterns.siteToPattern(url);
			const cur = await new Promise(res => chrome.storage.sync.get(['siteMenus'], items => res(items.siteMenus || {})));
			const { siteMenus, added } = self.FlowMouseMenuModel.addPatternToMenu(
				self.FlowMouseMenuCatalog.SITE_MENU_CATALOG, cur, menuId, pattern);
			if (added) await chrome.storage.sync.set({ siteMenus });
			return { success: true, added };
		}
```

- [ ] **Step 7: i18n-Key + Verifikation**

`customMenuOwnLabel` in `_locales/en/messages.json` („Own menu") und `_locales/de/messages.json` („Eigenes Menü") ergänzen.

Run: `npm test` — Expected: PASS (keine Regression).

Manuell (Extension neu laden unter `chrome://extensions`):
1. Einer Geste die Aktion „Custom Menu" geben ist noch nicht über die UI möglich (kommt in Task 9). Stattdessen im Service-Worker-DevTools-Console testweise setzen:
   `chrome.storage.sync.get('mouseGestures', r => { const g = r.mouseGestures || {}; g['↑'] = { action: 'customMenu', mode: 'standard', menuId: 'github' }; chrome.storage.sync.set({ mouseGestures: g }); })`
2. Beliebige Seite öffnen (neu laden), Geste ↑ ausführen → GitHub-Menü mit Lucide-Icons erscheint; Icons folgen dem Menü-Theme (hell/dunkel).
3. Klick auf „Notifications" → öffnet `github.com/notifications`.
4. `mode: 'contextual'` setzen, auf youtube.com Geste ausführen → YouTube-Menü.
5. Switcher aktivieren (bestehende Einstellung) → Kopfzeile zeigt andere Standard-Menüs, Umschalten funktioniert.

- [ ] **Step 8: Commit**

```bash
git add manifest.json js/content.js js/context-menu.js pages/context-menu.html js/background.js _locales/en/messages.json _locales/de/messages.json
git commit -m "feat(menus): runtime uses resolveMenu; lucide icons in menu iframe; addSiteToMenu on siteMenus"
```

---

### Task 6: Komponente `icon-picker`

**Files:**
- Create: `js/components/icon-picker.js`
- Modify: `pages/options.html` (Skript-Einbindung)
- Test: manuell (keine Komponenten-Test-Infrastruktur im Repo)

**Interfaces:**
- Consumes: `window.FlowMouseMenuIcons` (Task 1; wird in Step 2 als classic Script in options.html geladen).
- Produces: `<icon-picker .value=${string}>` — `value` ist Lucide-Name, `'favicon'` oder `''`. Feuert `icon-change` mit `detail: { value }`. Konsumiert von Task 7 (site-menu-editor).

- [ ] **Step 1: `js/components/icon-picker.js` anlegen**

```js
import { LitElement, html, css, unsafeHTML } from '../lib/lit-all.min.js';
import { commonStyles } from './shared-styles.js';
import { tooltip } from '../tooltip.js';

// Icon-Auswahl für Menüeinträge: Lucide-Subset (FlowMouseMenuIcons),
// 'favicon' (Favicon der Ziel-URL) oder '' (kein Icon).
class IconPicker extends LitElement {

	static properties = {
		value: { type: String },
		_open: { state: true },
		_filter: { state: true },
	};

	static styles = [
		commonStyles,
		css`
			:host { position: relative; display: inline-flex; }
			.trigger {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 28px;
				height: 28px;
				border-radius: 6px;
				border: 1px solid var(--border-color);
				background: var(--card-bg);
				color: var(--text-secondary);
				cursor: pointer;
				padding: 0;
			}
			.trigger svg { width: 15px; height: 15px; }
			.trigger .placeholder { font-size: 11px; color: var(--text-muted); }
			.panel {
				position: absolute;
				top: calc(100% + 4px);
				inset-inline-start: 0;
				z-index: 50;
				width: 244px;
				max-height: 260px;
				overflow-y: auto;
				background: var(--card-bg);
				border: 1px solid var(--border-color);
				border-radius: 8px;
				box-shadow: 0 6px 24px rgba(0,0,0,0.18);
				padding: 8px;
				display: flex;
				flex-direction: column;
				gap: 8px;
			}
			.panel input { width: 100%; }
			.special-row { display: flex; gap: 6px; }
			.special-row button { flex: 1; font-size: 11px; }
			.grid {
				display: grid;
				grid-template-columns: repeat(7, 1fr);
				gap: 2px;
			}
			.grid button {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 30px;
				height: 30px;
				border: none;
				border-radius: 6px;
				background: transparent;
				color: var(--text-secondary);
				cursor: pointer;
			}
			.grid button:hover { background: var(--bg-tertiary); }
			.grid button.active { background: var(--accent-color); color: #fff; }
			.grid svg { width: 15px; height: 15px; }
		`,
	];

	constructor() {
		super();
		this.value = '';
		this._open = false;
		this._filter = '';
		this._onDocClick = (e) => {
			if (!e.composedPath().includes(this)) this._open = false;
		};
	}

	connectedCallback() {
		super.connectedCallback();
		document.addEventListener('pointerdown', this._onDocClick);
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		document.removeEventListener('pointerdown', this._onDocClick);
	}

	get #icons() { return window.FlowMouseMenuIcons || {}; }

	#pick(value) {
		this.value = value;
		this._open = false;
		this.dispatchEvent(new CustomEvent('icon-change', { detail: { value }, bubbles: true, composed: true }));
	}

	render() {
		const i18n = window.i18n;
		const icons = this.#icons;
		const names = Object.keys(icons)
			.filter(n => !this._filter || n.toLowerCase().includes(this._filter.toLowerCase()))
			.sort();
		const current = this.value && this.value !== 'favicon' ? icons[this.value] : null;
		return html`
			<button type="button" class="trigger"
				.tooltip=${tooltip(i18n.getMessage('iconPickerTitle'))}
				@click=${() => { this._open = !this._open; }}>
				${current
					? unsafeHTML(current)
					: html`<span class="placeholder">${this.value === 'favicon' ? 'FAV' : '—'}</span>`}
			</button>
			${this._open ? html`
				<div class="panel">
					<input type="text" placeholder=${i18n.getMessage('iconPickerSearch')}
						@input=${(e) => { this._filter = e.target.value; }}>
					<div class="special-row">
						<button type="button" class="btn btn-ghost" @click=${() => this.#pick('favicon')}>
							${i18n.getMessage('iconPickerFavicon')}
						</button>
						<button type="button" class="btn btn-ghost" @click=${() => this.#pick('')}>
							${i18n.getMessage('iconPickerNone')}
						</button>
					</div>
					<div class="grid">
						${names.map(n => html`
							<button type="button" class=${this.value === n ? 'active' : ''}
								title=${n} @click=${() => this.#pick(n)}>
								${unsafeHTML(icons[n])}
							</button>
						`)}
					</div>
				</div>
			` : ''}
		`;
	}
}

window.i18n.waitForInit().then(() => {
	customElements.define('icon-picker', IconPicker);
});
```

- [ ] **Step 2: `pages/options.html` — Skripte einbinden**

Nach `<script src="../js/engine-registry.js"></script>` einfügen:

```html
	<script src="../js/menu-icons.js"></script>
	<script src="../js/menu-catalog.js"></script>
	<script src="../js/menu-model.js"></script>
```

Bei den Modul-Skripten (vor `options-page.js`) einfügen:

```html
	<script type="module" src="../js/components/icon-picker.js"></script>
```

- [ ] **Step 3: i18n-Keys ergänzen** (en / de):

| Key | en | de |
| --- | --- | --- |
| iconPickerTitle | Icon | Icon |
| iconPickerSearch | Search icons… | Icon suchen… |
| iconPickerFavicon | Favicon | Favicon |
| iconPickerNone | No icon | Kein Icon |

- [ ] **Step 4: Manuell verifizieren**

Options-Seite öffnen, DevTools-Konsole: `document.createElement('icon-picker')` einfügen —

```js
const p = document.createElement('icon-picker'); p.value = 'house'; document.body.appendChild(p);
p.addEventListener('icon-change', e => console.log('picked', e.detail.value));
```

Erwartet: Button mit Haus-Icon; Klick öffnet Raster; Suche filtert; Auswahl loggt `picked <name>`; „Favicon"/„Kein Icon" liefern `'favicon'`/`''`.

- [ ] **Step 5: Commit**

```bash
git add js/components/icon-picker.js pages/options.html _locales/en/messages.json _locales/de/messages.json
git commit -m "feat(menus): icon-picker component"
```

---

### Task 7: Komponente `site-menu-editor`

**Files:**
- Create: `js/components/site-menu-editor.js`
- Modify: `pages/options.html` (Modul-Skript)
- Test: manuell (verdrahtet in Task 8/9/10; DnD-Logik ist Kopie aus [js/components/menu-panel.js](../../js/components/menu-panel.js) Zeilen 792–869)

**Interfaces:**
- Consumes: `<action-select>` (bestehend, `context="menu-item"`), `<icon-picker>` (Task 6).
- Produces: „dummer" Editor für EINE Menüdefinition. Properties:
  - `.rows` = `[{ item, state }]` — `item` im Task-3-Format, `state` ∈ `'inherited' | 'modified' | 'own'` (bei Nicht-Fork immer `'own'`)
  - `.hiddenItems` = `[item…]` (nur Fork: entfernte Standard-Items)
  - `.name` (String), `hideName` (Bool-Attr, z. B. Fork ohne eigenen Namen), `.namePlaceholder`
  - `.patterns` (Array|null → Sektion ausblenden), `.domainChoices` (Array|null), `.domainValue`
  - `showBadges` (Bool-Attr: Fork-Modus)
  - Events (alle `bubbles: true, composed: true`, detail wie angegeben):
    `name-change {name}` · `patterns-change {patterns}` · `domain-change {domain}` ·
    `item-change {item}` (kompletter Eintrag inkl. `id`) · `item-delete {itemId}` ·
    `item-add {item, afterId}` (Editor generiert `id` = `item_<10 hex>`; `afterId` = ID des letzten sichtbaren Items oder `''`) ·
    `item-restore {itemId}` · `item-reset {itemId}` · `item-duplicate {itemId}` ·
    `items-reorder {orderedIds}`

- [ ] **Step 1: `js/components/site-menu-editor.js` anlegen**

```js
import { LitElement, html, css, unsafeHTML } from '../lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { icon } from '../icons.js';
import { tooltip } from '../tooltip.js';

// Editor für EINE Menüdefinition. Hält keinen Settings-Zustand: rendert die
// übergebenen Rows und meldet jede Operation als Event; der Parent
// (site-menu-manager bzw. gesture-menu-config) persistiert.
class SiteMenuEditor extends LitElement {

	static properties = {
		rows: { attribute: false },
		hiddenItems: { attribute: false },
		name: { type: String },
		namePlaceholder: { type: String },
		hideName: { type: Boolean, attribute: 'hide-name' },
		patterns: { attribute: false },
		domainChoices: { attribute: false },
		domainValue: { type: String },
		showBadges: { type: Boolean, attribute: 'show-badges' },
		_showHidden: { state: true },
	};

	static styles = [
		commonStyles,
		optionStyles,
		css`
			:host { display: flex; flex-direction: column; gap: 14px; }
			.field { display: flex; flex-direction: column; gap: 9px; }
			.field-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
			.items-container { display: flex; flex-direction: column; gap: 6px; padding: 4px 0; margin: -4px 0; }
			.item-row {
				display: flex; align-items: center; gap: 6px; padding: 5px 6px;
				border-radius: 8px; box-shadow: 0 0 0 0.75px var(--border-color);
				background: var(--card-bg); position: relative;
			}
			.item-row.drag-indicator-before::before,
			.item-row.drag-indicator-after::after {
				content: ''; position: absolute; left: 6px; right: 6px; height: 2px;
				background: var(--accent-color); border-radius: 1px; pointer-events: none;
			}
			.item-row.drag-indicator-before::before { top: -4px; }
			.item-row.drag-indicator-after::after { bottom: -4px; }
			.item-grip {
				display: flex; align-items: center; align-self: stretch; color: var(--text-muted);
				cursor: grab; flex-shrink: 0; opacity: 0.5; transition: opacity 0.15s;
			}
			.item-grip:hover { opacity: 1; }
			.item-grip svg { width: 14px; height: 14px; }
			.item-action { flex: 1; min-width: 0; }
			.item-buttons { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
			.item-btn {
				display: inline-flex; align-items: center; justify-content: center; border: none;
				background: transparent; color: var(--text-muted); cursor: pointer; padding: 4px;
				border-radius: 4px; flex-shrink: 0;
			}
			.item-btn:hover { color: var(--accent-color); }
			.item-btn.danger:hover { color: var(--danger-color); }
			.item-btn svg { width: 14px; height: 14px; }
			.badge {
				font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px;
				flex-shrink: 0; text-transform: uppercase; letter-spacing: 0.02em;
			}
			.badge.inherited { background: var(--bg-tertiary); color: var(--text-muted); }
			.badge.modified { background: var(--accent-color); color: #fff; }
			.badge.own { background: var(--success-color, #34a853); color: #fff; }
			.separator-line { flex: 1; height: 1px; background: var(--border-color); }
			.empty-items {
				display: flex; align-items: center; justify-content: center; min-height: 42px;
				color: var(--text-muted); font-size: 12px; box-shadow: 0 0 0 0.75px var(--border-color);
				border-radius: 8px; padding: 8px; text-align: center;
			}
			.add-buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; align-self: flex-start; }
			.patterns-chips { display: flex; flex-wrap: wrap; gap: 6px; }
			.pattern-chip {
				display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px 2px 10px;
				border-radius: 12px; background: var(--accent-color, #5b8dee); color: #fff;
				font-size: 12px; line-height: 1.6;
			}
			.pattern-chip-remove {
				display: inline-flex; background: transparent; border: none; color: rgba(255,255,255,0.8);
				cursor: pointer; padding: 0 2px; font-size: 14px; line-height: 1; border-radius: 50%;
			}
			.pattern-chip-remove:hover { color: #fff; }
			.patterns-add-row { display: flex; gap: 6px; }
			.patterns-add-row input { flex: 1; min-width: 0; }
			.hidden-section { display: flex; flex-direction: column; gap: 6px; }
			.hidden-toggle { align-self: flex-start; font-size: 12px; }
			.hidden-row { opacity: 0.65; }
		`,
	];

	constructor() {
		super();
		this.rows = [];
		this.hiddenItems = [];
		this.name = '';
		this.namePlaceholder = '';
		this.hideName = false;
		this.patterns = null;
		this.domainChoices = null;
		this.domainValue = '';
		this.showBadges = false;
		this._showHidden = false;
		this._dragState = null;
	}

	#emit(type, detail) {
		this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
	}

	#generateItemId() {
		return `item_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
	}

	#resolvedLabel(item) {
		const i18n = window.i18n;
		if (item.type === 'separator') return '';
		if (item.customName) return item.customName;
		if (item.labelKey) {
			const m = i18n.getMessage(item.labelKey);
			if (m) return m;
		}
		const key = window.GestureConstants.ACTION_KEYS[item.action];
		return key ? i18n.getMessage(key) : (item.action || '');
	}

	render() {
		const i18n = window.i18n;
		const rows = this.rows || [];
		return html`
			${this.hideName ? '' : html`
				<div class="field">
					<span class="field-label">${i18n.getMessage('customHudName')}</span>
					<input type="text" maxlength="80"
						.value=${this.name || ''}
						placeholder=${this.namePlaceholder || i18n.getMessage('menuNamePlaceholder')}
						@change=${(e) => this.#emit('name-change', { name: e.target.value })}>
				</div>
			`}
			${this.domainChoices?.length ? html`
				<div class="field">
					<span class="field-label">${i18n.getMessage('siteMenuDomainLabel')}</span>
					<select @change=${(e) => this.#emit('domain-change', { domain: e.target.value })}>
						${this.domainChoices.map(d => html`
							<option value=${d} ?selected=${d === this.domainValue}>${d}</option>
						`)}
					</select>
				</div>
			` : ''}
			${this.patterns ? this.#renderPatterns() : ''}
			<div class="items-container"
				@dragenter=${(e) => this.#onContainerDragOver(e)}
				@dragover=${(e) => this.#onContainerDragOver(e)}
				@dragleave=${(e) => this.#onContainerDragLeave(e)}
				@drop=${(e) => this.#onContainerDrop(e)}
				@dragend=${() => this.#onItemDragEnd()}
			>
				${rows.length === 0 ? html`
					<div class="empty-items">${i18n.getMessage('emptyMenuItems')}</div>
				` : rows.map((row, idx) => this.#renderRow(row, idx))}
			</div>
			<div class="add-buttons">
				<button class="btn btn-ghost" @click=${() => this.#addItem(false)}>
					${unsafeHTML(icon('plus', { size: 13, strokeWidth: 2.5 }))}
					<span>${i18n.getMessage('addMenuItem')}</span>
				</button>
				<button class="btn btn-ghost" @click=${() => this.#addItem(true)}>
					${unsafeHTML(icon('minusDashed', { size: 13, strokeWidth: 2.5 }))}
					<span>${i18n.getMessage('addMenuSeparator')}</span>
				</button>
			</div>
			${this.showBadges && this.hiddenItems?.length ? this.#renderHidden() : ''}
		`;
	}

	#renderPatterns() {
		const i18n = window.i18n;
		const patterns = this.patterns || [];
		const add = (raw) => {
			const text = (raw || '').trim();
			if (!text) return;
			const pattern = text.includes('*') ? text : `*${text}*`;
			if (patterns.includes(pattern)) return;
			this.#emit('patterns-change', { patterns: [...patterns, pattern] });
		};
		return html`
			<div class="field">
				<span class="field-label">${i18n.getMessage('menuPatternsTitle')}</span>
				${patterns.length ? html`
					<div class="patterns-chips">
						${patterns.map(p => html`
							<span class="pattern-chip">${p}
								<button class="pattern-chip-remove" type="button"
									@click=${() => this.#emit('patterns-change', { patterns: patterns.filter(x => x !== p) })}>×</button>
							</span>
						`)}
					</div>
				` : ''}
				<div class="patterns-add-row">
					<input type="text" placeholder=${i18n.getMessage('menuPatternsPlaceholder')}
						@keydown=${(e) => { if (e.key === 'Enter') { add(e.target.value); e.target.value = ''; } }}>
					<button class="btn btn-ghost" type="button"
						@click=${(e) => { const inp = e.target.closest('.patterns-add-row').querySelector('input'); add(inp.value); inp.value = ''; }}>
						${i18n.getMessage('menuPatternsAdd')}
					</button>
				</div>
				<span class="field-label" style="font-weight:400; opacity:0.75">${i18n.getMessage('menuPatternsHint')}</span>
			</div>
		`;
	}

	#renderBadge(state) {
		if (!this.showBadges) return '';
		const i18n = window.i18n;
		const map = {
			inherited: ['inherited', 'forkBadgeInherited'],
			modified: ['modified', 'forkBadgeModified'],
			own: ['own', 'forkBadgeOwn'],
		};
		const [cls, key] = map[state] || map.own;
		return html`<span class="badge ${cls}">${i18n.getMessage(key)}</span>`;
	}

	#renderRow(row, idx) {
		const i18n = window.i18n;
		const item = row.item;
		const grip = html`
			<span class="item-grip" draggable="true"
				@dragstart=${(e) => this.#onItemDragStart(e, idx)}
			>${unsafeHTML(icon('gripVertical', { size: 14, strokeWidth: 2 }))}</span>
		`;
		const resetBtn = this.showBadges && row.state === 'modified' ? html`
			<button class="item-btn" @click=${() => this.#emit('item-reset', { itemId: item.id })}
				.tooltip=${tooltip(i18n.getMessage('forkResetItem'))}>
				${unsafeHTML(icon('undo', { size: 14, strokeWidth: 2 }))}
			</button>
		` : '';
		if (item.type === 'separator') {
			return html`
				<div class="item-row" @dragover=${(e) => this.#onItemDragOver(e, idx)}>
					${grip}
					<span class="separator-line"></span>
					${this.#renderBadge(row.state)}
					<div class="item-buttons">
						${resetBtn}
						<button class="item-btn danger" @click=${() => this.#emit('item-delete', { itemId: item.id })}
							.tooltip=${tooltip(i18n.getMessage('delete'))}>
							${unsafeHTML(icon('x', { size: 14, strokeWidth: 2.5 }))}
						</button>
					</div>
				</div>
			`;
		}
		const label = this.#resolvedLabel(item);
		return html`
			<div class="item-row" @dragover=${(e) => this.#onItemDragOver(e, idx)}>
				${grip}
				<icon-picker .value=${item.icon || ''}
					@icon-change=${(e) => { e.stopPropagation(); this.#emit('item-change', { item: { ...item, icon: e.detail.value } }); }}
				></icon-picker>
				<div class="item-action">
					<action-select compact allow-custom-name context="menu-item"
						.value=${item.action || 'none'}
						.config=${{ ...item, customName: item.customName || '' }}
						.gestureLabel=${label}
						@action-change=${(e) => this.#onItemActionChange(item, e.detail)}
					></action-select>
				</div>
				${this.#renderBadge(row.state)}
				<div class="item-buttons">
					${resetBtn}
					<button class="item-btn" @click=${() => this.#emit('item-duplicate', { itemId: item.id })}
						.tooltip=${tooltip(i18n.getMessage('duplicate'))}>
						${unsafeHTML(icon('copy', { size: 14, strokeWidth: 2 }))}
					</button>
					<button class="item-btn danger" @click=${() => this.#emit('item-delete', { itemId: item.id })}
						.tooltip=${tooltip(i18n.getMessage('delete'))}>
						${unsafeHTML(icon('x', { size: 14, strokeWidth: 2.5 }))}
					</button>
				</div>
			</div>
		`;
	}

	#renderHidden() {
		const i18n = window.i18n;
		return html`
			<div class="hidden-section">
				<button class="btn btn-ghost hidden-toggle" @click=${() => { this._showHidden = !this._showHidden; }}>
					${i18n.getMessage('forkShowHidden').replace('%n%', String(this.hiddenItems.length))}
				</button>
				${this._showHidden ? this.hiddenItems.map(item => html`
					<div class="item-row hidden-row">
						<span class="item-action" style="font-size:12px; padding:4px 2px;">
							${item.type === 'separator' ? html`<span class="separator-line"></span>` : this.#resolvedLabel(item)}
						</span>
						<div class="item-buttons">
							<button class="item-btn" @click=${() => this.#emit('item-restore', { itemId: item.id })}
								.tooltip=${tooltip(i18n.getMessage('forkRestore'))}>
								${unsafeHTML(icon('rotateCcw', { size: 14, strokeWidth: 2 }))}
							</button>
						</div>
					</div>
				`) : ''}
			</div>
		`;
	}

	#onItemActionChange(item, detail) {
		// action-select liefert {action, config}; id und icon des Items bleiben erhalten.
		this.#emit('item-change', { item: { id: item.id, icon: item.icon, action: detail.action, ...(detail.config || {}) } });
	}

	#addItem(separator) {
		const id = this.#generateItemId();
		const last = (this.rows || [])[this.rows.length - 1];
		const afterId = last ? last.item.id : '';
		const item = separator ? { id, type: 'separator' } : { id, action: 'none' };
		this.#emit('item-add', { item, afterId });
	}

	// --- Drag & Drop (übernommen aus menu-panel.js) ---
	#onItemDragStart(e, idx) {
		this._dragState = { fromIdx: idx, active: true, overIdx: -1, position: null };
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', '');
		const row = e.currentTarget.closest('.item-row');
		if (row) row.style.opacity = '0.4';
	}

	#onItemDragOver(e, idx) {
		if (!this._dragState?.active) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		const row = e.currentTarget;
		const rect = row.getBoundingClientRect();
		const position = (e.clientY - rect.top < rect.height / 2) ? 'before' : 'after';
		if (idx === this._dragState.fromIdx || (idx === this._dragState.overIdx && position === this._dragState.position)) return;
		this.#clearDropIndicators();
		this._dragState.overIdx = idx;
		this._dragState.position = position;
		row.classList.add(position === 'before' ? 'drag-indicator-before' : 'drag-indicator-after');
	}

	#onContainerDragOver(e) {
		if (!this._dragState?.active) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = 'move';
	}

	#onContainerDrop(e) {
		e.preventDefault();
		if (!this._dragState) return;
		const { fromIdx, overIdx, position } = this._dragState;
		this.#clearDropIndicators();
		if (overIdx < 0 || !position) return;
		let insertIdx = position === 'before' ? overIdx : overIdx + 1;
		if (fromIdx < insertIdx) insertIdx--;
		if (fromIdx === insertIdx) return;
		const ids = (this.rows || []).map(r => r.item.id);
		const [moved] = ids.splice(fromIdx, 1);
		ids.splice(insertIdx, 0, moved);
		this.#emit('items-reorder', { orderedIds: ids });
	}

	#onItemDragEnd() {
		this._dragState = null;
		this.#clearDropIndicators();
		this.shadowRoot.querySelectorAll('.item-row').forEach(r => r.style.opacity = '');
	}

	#onContainerDragLeave(e) {
		if (!this._dragState) return;
		const container = e.currentTarget;
		if (!e.relatedTarget || !container.contains(e.relatedTarget)) {
			this.#clearDropIndicators();
			this._dragState.overIdx = -1;
			this._dragState.position = null;
		}
	}

	#clearDropIndicators() {
		this.shadowRoot.querySelectorAll('.item-row').forEach(r => r.classList.remove('drag-indicator-before', 'drag-indicator-after'));
	}
}

window.i18n.waitForInit().then(() => {
	customElements.define('site-menu-editor', SiteMenuEditor);
});
```

- [ ] **Step 2: Modul-Skript in `pages/options.html` eintragen** (vor `options-page.js`):

```html
	<script type="module" src="../js/components/site-menu-editor.js"></script>
```

- [ ] **Step 3: i18n-Keys ergänzen** (en / de):

| Key | en | de |
| --- | --- | --- |
| siteMenuDomainLabel | Country / domain | Land / Domain |
| forkBadgeInherited | Standard | Standard |
| forkBadgeModified | Modified | Verändert |
| forkBadgeOwn | Own | Eigen |
| forkResetItem | Reset to standard | Auf Standard zurücksetzen |
| forkShowHidden | Hidden entries (%n%) | Ausgeblendete Einträge (%n%) |
| forkRestore | Restore | Wiederherstellen |

- [ ] **Step 4: Verifikation** — `npm test` grün (keine JS-Syntaxfehler: Options-Seite öffnen, Konsole fehlerfrei). Volle Funktionsprüfung folgt mit den Parents (Task 8/9/10).

- [ ] **Step 5: Commit**

```bash
git add js/components/site-menu-editor.js pages/options.html _locales/en/messages.json _locales/de/messages.json
git commit -m "feat(menus): site-menu-editor component (rows + op events, optional fork badges)"
```

---

### Task 8: Settings-Sektion „Website-Menüs" (`site-menu-manager` + options-page)

**Files:**
- Create: `js/components/site-menu-manager.js`
- Modify: `js/components/options-page.js` (Sektion ≈ nach `data-nav="special"`, Nav-Eintrag in `#getSections` ≈ Zeile 971)
- Modify: `pages/options.html` (Modul-Skript)
- Test: manuell (Schritt 5)

**Interfaces:**
- Consumes: `FlowMouseMenuModel` (`listMenus`, `getBaseMenu`, `withMenuDef`, `withMenuReset`, `withMenuDisabled`, `withoutCustomMenu`, `withDomain`), `FlowMouseMenuCatalog.SITE_MENU_CATALOG`, `SettingsStore`, `<site-menu-editor>` (Task 7).
- Produces: `<site-menu-manager>` — komplette Sektion inkl. Switcher/Theme-Einstellungen. Persistiert ausschließlich über `SettingsStore.save({ siteMenus })` bzw. `{ customMenuSwitcher }` / `{ customMenuTheme }`.

- [ ] **Step 1: `js/components/site-menu-manager.js` anlegen**

```js
import { LitElement, html, css, unsafeHTML } from '../lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { icon } from '../icons.js';
import { SettingsStore } from '../settings-store.js';
import { tooltip } from '../tooltip.js';

const CATALOG = () => window.FlowMouseMenuCatalog.SITE_MENU_CATALOG;
const M = () => window.FlowMouseMenuModel;

// Settings-Sektion „Website-Menüs": Liste aller Standard-Menüs (Katalog +
// eigene), Ein/Aus, Bearbeiten (site-menu-editor), Zurücksetzen, eigene Menüs
// anlegen/löschen, Domain-Wahl, plus globale Switcher/Theme-Einstellungen.
class SiteMenuManager extends LitElement {

	static properties = {
		_expandedId: { state: true },
	};

	static styles = [
		commonStyles,
		optionStyles,
		css`
			:host { display: flex; flex-direction: column; gap: 14px; }
			.menu-list { display: flex; flex-direction: column; gap: 6px; }
			.menu-row {
				display: flex; align-items: center; gap: 8px; padding: 7px 8px;
				border-radius: 8px; box-shadow: 0 0 0 0.75px var(--border-color);
				background: var(--card-bg);
			}
			.menu-row.disabled { opacity: 0.55; }
			.menu-icon { display: inline-flex; color: var(--text-secondary); flex-shrink: 0; }
			.menu-icon svg { width: 16px; height: 16px; }
			.menu-name { flex: 1; min-width: 0; font-size: 13px; display: flex; align-items: center; gap: 8px; }
			.menu-count { font-size: 11px; color: var(--text-muted); }
			.edited-badge {
				font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px;
				background: var(--accent-color); color: #fff;
			}
			.menu-buttons { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
			.menu-btn {
				display: inline-flex; align-items: center; justify-content: center; border: none;
				background: transparent; color: var(--text-muted); cursor: pointer; padding: 4px;
				border-radius: 4px;
			}
			.menu-btn:hover { color: var(--accent-color); }
			.menu-btn.danger:hover { color: var(--danger-color); }
			.menu-btn svg { width: 14px; height: 14px; }
			.editor-wrap {
				padding: 12px 10px 10px;
				border-radius: 8px;
				box-shadow: 0 0 0 0.75px var(--border-color);
				background: var(--bg-secondary, transparent);
			}
			.switcher-settings { display: flex; flex-direction: column; gap: 10px; }
			.switcher-toggle { display: flex; align-items: flex-start; gap: 10px; }
			.switcher-toggle input[type="checkbox"] { margin-top: 2px; flex-shrink: 0; }
			.switcher-toggle-text { display: flex; flex-direction: column; gap: 3px; }
			.switcher-toggle-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
			.switcher-toggle-hint { font-size: 11px; color: var(--text-secondary); opacity: 0.8; }
			.seg {
				display: inline-flex; border: 1px solid var(--border-color, rgba(128,128,128,0.35));
				border-radius: 6px; overflow: hidden; width: max-content;
			}
			.seg button {
				appearance: none; border: 0; background: transparent; color: var(--text-secondary);
				font: inherit; font-size: 12px; padding: 5px 14px; cursor: pointer;
			}
			.seg button.active { background: var(--accent-color, #2962ff); color: #fff; }
			.theme-row { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-secondary); }
			.show-in-switcher { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); margin-top: 10px; }
		`,
	];

	constructor() {
		super();
		this._expandedId = '';
		this._unsubscribe = null;
	}

	connectedCallback() {
		super.connectedCallback();
		this._unsubscribe = SettingsStore.onChange((changed) => {
			if ('siteMenus' in changed || 'customMenuSwitcher' in changed || 'customMenuTheme' in changed) this.requestUpdate();
		});
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		this._unsubscribe?.();
		this._unsubscribe = null;
	}

	get siteMenus() {
		return SettingsStore.current.siteMenus || { disabled: [], edited: {}, custom: {}, domains: {}, order: [] };
	}

	#saveSiteMenus(next) {
		SettingsStore.save({ siteMenus: next });
		window.dispatchEvent(new Event('action-catalog-changed'));
		this.requestUpdate();
	}

	#saveDef(menuId, mutate) {
		const def = M().getBaseMenu(CATALOG(), this.siteMenus, menuId);
		if (!def) return;
		mutate(def);
		this.#saveSiteMenus(M().withMenuDef(CATALOG(), this.siteMenus, menuId, def));
	}

	render() {
		const i18n = window.i18n;
		const menus = M().listMenus(CATALOG(), this.siteMenus);
		return html`
			${this.#renderGlobalSettings()}
			<div class="menu-list">
				${menus.map(m => this.#renderMenuRow(m, i18n))}
			</div>
			<button class="btn btn-ghost" style="align-self:flex-start" @click=${this.#addCustomMenu}>
				${unsafeHTML(icon('plus', { size: 13, strokeWidth: 2.5 }))}
				<span>${i18n.getMessage('siteMenuAddCustom')}</span>
			</button>
		`;
	}

	#renderGlobalSettings() {
		const i18n = window.i18n;
		const s = SettingsStore.current.customMenuSwitcher || { enabled: false, position: 'header' };
		const theme = SettingsStore.current.customMenuTheme || 'auto';
		const saveSwitcher = (patch) => { SettingsStore.save({ customMenuSwitcher: { ...s, ...patch } }); this.requestUpdate(); };
		return html`
			<div class="switcher-settings">
				<label class="switcher-toggle">
					<input type="checkbox" .checked=${!!s.enabled}
						@change=${(e) => saveSwitcher({ enabled: e.target.checked })}>
					<span class="switcher-toggle-text">
						<span class="switcher-toggle-label">${i18n.getMessage('menuSwitcherEnable')}</span>
						<span class="switcher-toggle-hint">${i18n.getMessage('menuSwitcherEnableHint')}</span>
					</span>
				</label>
				${s.enabled ? html`
					<div class="seg" role="group">
						<button type="button" class=${s.position !== 'footer' ? 'active' : ''}
							@click=${() => saveSwitcher({ position: 'header' })}>${i18n.getMessage('menuSwitcherHeader')}</button>
						<button type="button" class=${s.position === 'footer' ? 'active' : ''}
							@click=${() => saveSwitcher({ position: 'footer' })}>${i18n.getMessage('menuSwitcherFooter')}</button>
					</div>
				` : ''}
				<div class="theme-row">
					<span>${i18n.getMessage('menuThemeTitle')}</span>
					<div class="seg" role="group">
						${['auto', 'light', 'dark'].map(v => html`
							<button type="button" class=${theme === v ? 'active' : ''}
								@click=${() => { SettingsStore.save({ customMenuTheme: v }); this.requestUpdate(); }}
							>${i18n.getMessage('menuTheme' + v[0].toUpperCase() + v.slice(1))}</button>
						`)}
					</div>
				</div>
			</div>
		`;
	}

	#renderMenuRow(m, i18n) {
		const count = (m.def.items || []).filter(it => it.type !== 'separator').length;
		const menuIcon = (window.FlowMouseMenuIcons || {})[m.def.icon] || '';
		const expanded = this._expandedId === m.id;
		return html`
			<div class="menu-row ${m.disabled ? 'disabled' : ''}">
				<span class="menu-icon">${menuIcon ? unsafeHTML(menuIcon) : ''}</span>
				<span class="menu-name">
					${m.def.name || i18n.getMessage('menuNamePlaceholder')}
					<span class="menu-count">(${count})</span>
					${m.isEdited ? html`<span class="edited-badge">${i18n.getMessage('siteMenuEdited')}</span>` : ''}
				</span>
				<div class="menu-buttons">
					${m.isEdited ? html`
						<button class="menu-btn" .tooltip=${tooltip(i18n.getMessage('siteMenuReset'))}
							@click=${() => this.#resetMenu(m)}>
							${unsafeHTML(icon('rotateCcw', { size: 14, strokeWidth: 2 }))}
						</button>
					` : ''}
					${m.isCustom ? html`
						<button class="menu-btn danger" .tooltip=${tooltip(i18n.getMessage('delete'))}
							@click=${() => this.#deleteMenu(m)}>
							${unsafeHTML(icon('trash2', { size: 14, strokeWidth: 2 }))}
						</button>
					` : ''}
					<button class="menu-btn" .tooltip=${tooltip(i18n.getMessage('edit'))}
						@click=${() => { this._expandedId = expanded ? '' : m.id; }}>
						${unsafeHTML(icon(expanded ? 'chevronUp' : 'squarePen', { size: 14, strokeWidth: 2 }))}
					</button>
				</div>
				<label style="display:inline-flex">
					<input type="checkbox" .checked=${!m.disabled}
						@change=${(e) => this.#saveSiteMenus(M().withMenuDisabled(this.siteMenus, m.id, !e.target.checked))}>
				</label>
			</div>
			${expanded ? html`<div class="editor-wrap">${this.#renderEditor(m)}</div>` : ''}
		`;
	}

	#renderEditor(m) {
		const i18n = window.i18n;
		const def = m.def;
		const rows = (def.items || []).map(item => ({ item, state: 'own' }));
		const domainValue = (this.siteMenus.domains || {})[m.id] || def.domains?.default || '';
		return html`
			<site-menu-editor
				.rows=${rows}
				.name=${def.name || ''}
				.patterns=${def.patterns || []}
				.domainChoices=${def.domains?.choices || null}
				.domainValue=${domainValue}
				@name-change=${(e) => this.#saveDef(m.id, d => { d.name = e.detail.name; })}
				@patterns-change=${(e) => this.#saveDef(m.id, d => { d.patterns = e.detail.patterns; })}
				@domain-change=${(e) => this.#saveSiteMenus(M().withDomain(this.siteMenus, m.id, e.detail.domain))}
				@item-change=${(e) => this.#saveDef(m.id, d => {
					d.items = (d.items || []).map(it => it.id === e.detail.item.id ? e.detail.item : it);
				})}
				@item-delete=${(e) => this.#saveDef(m.id, d => {
					d.items = (d.items || []).filter(it => it.id !== e.detail.itemId);
				})}
				@item-add=${(e) => this.#saveDef(m.id, d => {
					d.items = [...(d.items || []), e.detail.item];
				})}
				@item-duplicate=${(e) => this.#saveDef(m.id, d => {
					const idx = d.items.findIndex(it => it.id === e.detail.itemId);
					if (idx === -1) return;
					const copy = structuredClone(d.items[idx]);
					copy.id = `item_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
					d.items.splice(idx + 1, 0, copy);
				})}
				@items-reorder=${(e) => this.#saveDef(m.id, d => {
					const byId = new Map((d.items || []).map(it => [it.id, it]));
					d.items = e.detail.orderedIds.map(id => byId.get(id)).filter(Boolean);
				})}
			></site-menu-editor>
			<label class="show-in-switcher">
				<input type="checkbox" .checked=${def.showInSwitcher !== false}
					@change=${(e) => this.#saveDef(m.id, d => { d.showInSwitcher = e.target.checked; })}>
				<span>${i18n.getMessage('menuShowInSwitcher')}</span>
			</label>
		`;
	}

	#addCustomMenu() {
		const i18n = window.i18n;
		const existing = new Set(M().listMenus(CATALOG(), this.siteMenus).map(m => m.id));
		let id;
		do {
			id = `menu_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
		} while (existing.has(id));
		const name = `${i18n.getMessage('menuNamePlaceholder')} ${existing.size + 1}`;
		this.#saveSiteMenus(M().withMenuDef(CATALOG(), this.siteMenus, id, { name, patterns: [], items: [] }));
		this._expandedId = id;
	}

	#resetMenu(m) {
		const i18n = window.i18n;
		if (!confirm(i18n.getMessage('siteMenuResetConfirm').replace('%name%', m.def.name || ''))) return;
		this.#saveSiteMenus(M().withMenuReset(this.siteMenus, m.id));
	}

	#deleteMenu(m) {
		const i18n = window.i18n;
		if ((m.def.items || []).length &&
			!confirm(i18n.getMessage('deleteMenuConfirm').replace('%name%', m.def.name || ''))) return;
		if (this._expandedId === m.id) this._expandedId = '';
		this.#saveSiteMenus(M().withoutCustomMenu(this.siteMenus, m.id));
	}
}

window.i18n.waitForInit().then(() => {
	customElements.define('site-menu-manager', SiteMenuManager);
});
```

- [ ] **Step 2: Sektion in `js/components/options-page.js` einfügen**

Nach dem schließenden `</div>` der Sektion `data-nav="special"` (vor `data-nav="searchEngines"`) einfügen:

```js
				<div class="section ${this._activeSection === 'siteMenus' ? 'active' : ''}" data-nav="siteMenus">
					<h2><span class="section-icon">${unsafeHTML(icon('layoutList', { strokeWidth: 2.3 }))}</span> <span>${i18n.getMessage('siteMenusTitle')}</span></h2>
					<div class="section-body">
						<div class="setting-description">${i18n.getMessage('siteMenusDesc')}</div>
						<site-menu-manager></site-menu-manager>
					</div>
				</div>
```

(Falls es die Klasse `setting-description` in dieser Datei nicht gibt: die Beschreibungszeile weglassen — die anderen Sektionen als Muster nehmen.)

In `#getSections` (≈ Zeile 971) nach dem `special`-Eintrag einfügen:

```js
			{ id: 'siteMenus', label: i18n.getMessage('siteMenusTitle'), icon: icons.layoutList },
```

- [ ] **Step 3: Modul-Skript in `pages/options.html`** (vor `options-page.js`):

```html
	<script type="module" src="../js/components/site-menu-manager.js"></script>
```

- [ ] **Step 4: i18n-Keys ergänzen** (en / de):

| Key | en | de |
| --- | --- | --- |
| siteMenusTitle | Website menus | Website-Menüs |
| siteMenusDesc | Predefined, fully editable menus for popular sites. Gestures can open them directly, contextually by URL, or as a customized copy. | Vordefinierte, voll editierbare Menüs für bekannte Websites. Gesten können sie direkt öffnen, kontextabhängig zur URL oder als angepasste Kopie. |
| siteMenuAddCustom | Add custom menu | Eigenes Menü anlegen |
| siteMenuEdited | Customized | Angepasst |
| siteMenuReset | Reset to default | Auf Standard zurücksetzen |
| siteMenuResetConfirm | Reset "%name%" to its default? Your changes to this menu will be lost. | „%name%" auf den Standard zurücksetzen? Deine Änderungen an diesem Menü gehen verloren. |
| edit | Edit | Bearbeiten |

(Key `edit` nur ergänzen, falls nicht vorhanden — vorher in `_locales/en/messages.json` prüfen.)

- [ ] **Step 5: Manuell verifizieren** (Extension-Reload, Options-Seite):

1. Nav zeigt „Website-Menüs"; Sektion listet 13 Katalog-Menüs mit Icons und Zählern.
2. GitHub deaktivieren → Zeile ausgegraut; wieder aktivieren.
3. GitHub bearbeiten → Editor öffnet; Eintrag „Issues" umbenennen → Badge „Angepasst" erscheint an der Zeile; Reset-Button stellt Katalogstand wieder her (mit Confirm).
4. Eigenes Menü anlegen, Einträge hinzufügen (Link mit Icon), per Drag sortieren, löschen.
5. Amazon: Domain auf `amazon.com` stellen; Geste aus Task 5/Schritt 7 ausführen → Links zeigen auf amazon.com.
6. Switcher/Theme-Einstellungen funktionieren wie zuvor (jetzt in dieser Sektion).
7. `npm test` grün.

- [ ] **Step 6: Commit**

```bash
git add js/components/site-menu-manager.js js/components/options-page.js pages/options.html _locales/en/messages.json _locales/de/messages.json
git commit -m "feat(menus): website-menus settings section (list, toggles, reset, custom menus)"
```

---

### Task 9: Gesten-Editor — `gesture-menu-config` (Modi standard/own/contextual) + action-select

**Files:**
- Create: `js/components/gesture-menu-config.js`
- Modify: `js/components/action-select.js` (Import ≈ Zeile 5, `#renderActionConfig` customMenu-Zweig ≈ Zeile 1567, addSiteToMenu-Zweig ≈ Zeile 1587, `getMenuLabel`-Aufrufe)
- Modify: `pages/options.html`
- Test: manuell (Schritt 6)

**Interfaces:**
- Consumes: `FlowMouseMenuModel`, `FlowMouseMenuCatalog`, `<site-menu-editor>`; `action-select` hält die Gesten-Config in `this._pendingConfig`.
- Produces:
  - `<gesture-menu-config .config=${customMenuConfig}>` — feuert `menu-config-change` mit `detail: { config }`, wobei `config` exakt das `ACTION_DEFAULTS.customMenu`-Format hat (`{mode, menuId, fallbackMenuId, ownMenu, fork}`).
  - Export `getGestureMenuLabel(config) -> string` — Anzeigename der Geste (ersetzt `getMenuLabel` aus menu-panel.js).
  - Fork-Modus wird in **Task 10** in derselben Datei vervollständigt; in diesem Task rendert `mode: 'fork'` bereits die Basis-Auswahl, aber noch keinen Editor.

- [ ] **Step 1: `js/components/gesture-menu-config.js` anlegen**

```js
import { LitElement, html, css } from '../lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { SettingsStore } from '../settings-store.js';

const CATALOG = () => window.FlowMouseMenuCatalog.SITE_MENU_CATALOG;
const M = () => window.FlowMouseMenuModel;

// Anzeigename der Geste im zugeklappten action-select.
export function getGestureMenuLabel(config) {
	const i18n = window.i18n;
	const cfg = { ...(window.GestureConstants.ACTION_DEFAULTS.customMenu || {}), ...(config || {}) };
	const siteMenus = SettingsStore.current.siteMenus;
	if (cfg.mode === 'contextual') return i18n.getMessage('customMenuContextualLabel');
	if (cfg.mode === 'own') return cfg.ownMenu?.name || i18n.getMessage('customMenuOwnLabel');
	const base = M().getBaseMenu(CATALOG(), siteMenus, cfg.menuId);
	if (!base) return `${i18n.getMessage('actionCustomMenu')} ${i18n.getMessage('menuNotFound')}`;
	if (cfg.mode === 'fork') {
		const name = cfg.fork?.name || base.name;
		return `${name} (${i18n.getMessage('forkBadgeModified')})`;
	}
	return base.name || i18n.getMessage('actionCustomMenu');
}

class GestureMenuConfig extends LitElement {

	static properties = {
		config: { attribute: false },
	};

	static styles = [
		commonStyles,
		optionStyles,
		css`
			:host { display: flex; flex-direction: column; gap: 12px; }
			.row { display: flex; flex-direction: column; gap: 6px; }
			.row-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
			.hint { font-size: 11px; color: var(--text-muted); }
			select { width: 100%; }
			a.manage-link { font-size: 12px; color: var(--accent-color); cursor: pointer; }
		`,
	];

	get #cfg() {
		return { ...(window.GestureConstants.ACTION_DEFAULTS.customMenu || {}), ...(this.config || {}) };
	}

	#update(patch) {
		const config = { ...this.#cfg, ...patch };
		this.dispatchEvent(new CustomEvent('menu-config-change', {
			detail: { config }, bubbles: true, composed: true,
		}));
	}

	#activeMenus() {
		return M().listActiveMenus(CATALOG(), SettingsStore.current.siteMenus);
	}

	#menuSelect(value, onChange, emptyLabel) {
		const menus = this.#activeMenus();
		return html`
			<select @change=${(e) => onChange(e.target.value)}>
				${emptyLabel !== undefined ? html`<option value="" ?selected=${!value}>${emptyLabel}</option>` : ''}
				${menus.map(m => html`
					<option value=${m.id} ?selected=${m.id === value}>${m.def.name}</option>
				`)}
			</select>
		`;
	}

	render() {
		const i18n = window.i18n;
		const cfg = this.#cfg;
		return html`
			<div class="row">
				<span class="row-label">${i18n.getMessage('menuModeLabel')}</span>
				<select @change=${(e) => this.#onModeChange(e.target.value)}>
					${['standard', 'fork', 'own', 'contextual'].map(m => html`
						<option value=${m} ?selected=${cfg.mode === m}>
							${i18n.getMessage('menuMode' + m[0].toUpperCase() + m.slice(1))}
						</option>
					`)}
				</select>
			</div>
			${this.#renderModeBody(cfg, i18n)}
		`;
	}

	#onModeChange(mode) {
		const cfg = this.#cfg;
		if (mode === cfg.mode) return;
		const patch = { mode };
		if (mode === 'fork' && !cfg.fork) patch.fork = M().emptyFork();
		if (mode === 'own' && !cfg.ownMenu) patch.ownMenu = { name: '', items: [] };
		this.#update(patch);
	}

	#renderModeBody(cfg, i18n) {
		if (cfg.mode === 'standard') {
			const first = this.#activeMenus()[0];
			if (!cfg.menuId && first) queueMicrotask(() => this.#update({ menuId: first.id }));
			return html`
				<div class="row">
					${this.#menuSelect(cfg.menuId, (id) => this.#update({ menuId: id }))}
					<span class="hint">${i18n.getMessage('editGlobalMenuHint')}</span>
					<a class="manage-link" @click=${this.#navigateToSiteMenus}>${i18n.getMessage('openSiteMenusSection')}</a>
				</div>
			`;
		}
		if (cfg.mode === 'contextual') {
			return html`
				<div class="row">
					<span class="hint">${i18n.getMessage('customMenuContextualHint')}</span>
					<span class="row-label">${i18n.getMessage('menuFallbackLabel')}</span>
					${this.#menuSelect(cfg.fallbackMenuId, (id) => this.#update({ fallbackMenuId: id }), i18n.getMessage('menuFallbackNone'))}
				</div>
			`;
		}
		if (cfg.mode === 'own') {
			return this.#renderOwnEditor(cfg, i18n);
		}
		return this.#renderForkEditor(cfg, i18n); // Task 10
	}

	#renderOwnEditor(cfg, i18n) {
		const ownMenu = cfg.ownMenu || { name: '', items: [] };
		const rows = (ownMenu.items || []).map(item => ({ item, state: 'own' }));
		const saveOwn = (mutate) => {
			const next = structuredClone(ownMenu);
			mutate(next);
			this.#update({ ownMenu: next });
		};
		return html`
			<site-menu-editor
				.rows=${rows}
				.name=${ownMenu.name || ''}
				.patterns=${null}
				@name-change=${(e) => saveOwn(d => { d.name = e.detail.name; })}
				@item-change=${(e) => saveOwn(d => { d.items = d.items.map(it => it.id === e.detail.item.id ? e.detail.item : it); })}
				@item-delete=${(e) => saveOwn(d => { d.items = d.items.filter(it => it.id !== e.detail.itemId); })}
				@item-add=${(e) => saveOwn(d => { d.items = [...d.items, e.detail.item]; })}
				@item-duplicate=${(e) => saveOwn(d => {
					const idx = d.items.findIndex(it => it.id === e.detail.itemId);
					if (idx === -1) return;
					const copy = structuredClone(d.items[idx]);
					copy.id = `item_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
					d.items.splice(idx + 1, 0, copy);
				})}
				@items-reorder=${(e) => saveOwn(d => {
					const byId = new Map(d.items.map(it => [it.id, it]));
					d.items = e.detail.orderedIds.map(id => byId.get(id)).filter(Boolean);
				})}
			></site-menu-editor>
		`;
	}

	#renderForkEditor(cfg, i18n) {
		// Vollständige Fork-UI kommt in Task 10; bis dahin nur Basis-Auswahl.
		return html`
			<div class="row">
				${this.#menuSelect(cfg.menuId, (id) => this.#onForkBaseChange(id))}
			</div>
		`;
	}

	#onForkBaseChange(id) {
		const cfg = this.#cfg;
		if (cfg.menuId === id) return;
		const customized = cfg.fork && (Object.keys(cfg.fork.overrides || {}).length
			|| (cfg.fork.removed || []).length || (cfg.fork.added || []).length || Array.isArray(cfg.fork.order));
		if (customized && !confirm(window.i18n.getMessage('forkBaseChangeConfirm'))) {
			this.requestUpdate();
			return;
		}
		this.#update({ menuId: id, fork: M().emptyFork() });
	}

	#navigateToSiteMenus() {
		this.dispatchEvent(new CustomEvent('navigate-section', {
			detail: { section: 'siteMenus' }, bubbles: true, composed: true,
		}));
	}
}

window.i18n.waitForInit().then(() => {
	customElements.define('gesture-menu-config', GestureMenuConfig);
});
```

- [ ] **Step 2: `js/components/action-select.js` umstellen**

Zeile 5 ersetzen:

```js
import { getGestureMenuLabel } from './gesture-menu-config.js';
```

Alle Verwendungen von `getMenuLabel(...)` in dieser Datei suchen (`grep -n getMenuLabel js/components/action-select.js`) und durch `getGestureMenuLabel(this._pendingConfig)` bzw. — wo eine Config als Argument übergeben wird — `getGestureMenuLabel(config)` ersetzen. (Signaturwechsel: alt nahm `menuId`, neu nimmt die komplette customMenu-Config.)

Den `customMenu`-Zweig in `#renderActionConfig` (≈ Zeile 1567–1585) ersetzen durch:

```js
		if (action === 'customMenu') {
			return html`
				<div class="action-config-info">${window.i18n.getMessage('customMenuDesc')}</div>
				<gesture-menu-config
					.config=${this._pendingConfig}
					@menu-config-change=${(e) => { this._pendingConfig = { ...e.detail.config }; this.requestUpdate(); }}
				></gesture-menu-config>
			`;
		}
```

Den `addSiteToMenu`-Zweig (≈ Zeile 1587–1595) ersetzen durch ein einfaches Select statt menu-panel. Voraussetzung: `SettingsStore` muss in `action-select.js` importiert sein (prüfen: `grep -n "settings-store" js/components/action-select.js`; falls nicht, oben `import { SettingsStore } from '../settings-store.js';` ergänzen):

```js
		if (action === 'addSiteToMenu') {
			const menus = window.FlowMouseMenuModel.listActiveMenus(
				window.FlowMouseMenuCatalog.SITE_MENU_CATALOG, SettingsStore.current.siteMenus);
			const cur = this._pendingConfig?.menuId || '';
			return html`
				<div class="action-config-info">${window.i18n.getMessage('addSiteToMenuDesc')}</div>
				<div class="action-config-row">
					<select class="action-config-select"
						@change=${(e) => { this._pendingConfig = { ...this._pendingConfig, menuId: e.target.value }; }}>
						${menus.map(m => html`<option value=${m.id} ?selected=${m.id === cur}>${m.def.name}</option>`)}
					</select>
				</div>
			`;
		}
```

Falls `#onMenuSelect` danach ungenutzt ist: Methode entfernen.

- [ ] **Step 3: Modul-Skript in `pages/options.html`** (vor `action-select.js`):

```html
	<script type="module" src="../js/components/gesture-menu-config.js"></script>
```

- [ ] **Step 4: i18n-Keys ergänzen** (en / de):

| Key | en | de |
| --- | --- | --- |
| menuModeLabel | Menu source | Menü-Quelle |
| menuModeStandard | Standard menu | Standard-Menü |
| menuModeFork | Standard menu, customized | Standard-Menü, angepasst |
| menuModeOwn | Own menu (this gesture only) | Eigenes Menü (nur diese Geste) |
| menuModeContextual | By website (contextual) | Je nach Website (kontextabhängig) |
| menuFallbackLabel | If no site matches | Wenn keine Website passt |
| menuFallbackNone | Do nothing | Nichts öffnen |
| editGlobalMenuHint | Changes to this menu apply everywhere it is used. | Änderungen an diesem Menü wirken überall, wo es verwendet wird. |
| openSiteMenusSection | Manage website menus | Website-Menüs verwalten |
| forkBaseChangeConfirm | Changing the base menu discards your customizations. Continue? | Beim Wechsel des Basis-Menüs gehen deine Anpassungen verloren. Fortfahren? |

Außerdem den bestehenden Key `customMenuContextualHint` beibehalten (wird wiederverwendet); `customMenuDesc` prüfen und ggf. Text an die neuen Modi anpassen (en: "Opens a configurable menu at the gesture position." / de: „Öffnet ein konfigurierbares Menü an der Gestenposition.").

- [ ] **Step 5: Alte Referenzen prüfen**

`grep -rn "menu-panel" js/ pages/` — außer `js/components/menu-panel.js` selbst darf nichts mehr darauf zeigen (Import in action-select wurde in Step 2 ersetzt). Die Datei selbst wird erst in Task 12 gelöscht.

- [ ] **Step 6: Manuell verifizieren** (Extension-Reload, Options-Seite):

1. Geste konfigurieren → Aktion „Custom Menu": Modus-Select mit 4 Einträgen.
2. „Standard-Menü" + GitHub wählen, speichern; Geste auf beliebiger Seite → GitHub-Menü. Zugeklapptes action-select zeigt „GitHub".
3. „Eigenes Menü": Einträge anlegen (Link + Aktion + Separator), speichern; Geste zeigt genau diese Einträge. Zweite Geste mit eigenem Menü anlegen → unabhängig (Kernanforderung: kein geteilter Zustand).
4. „Kontextabhängig" + Fallback: auf github.com → GitHub-Menü, auf unbekannter Seite → Fallback bzw. nichts.
5. „addSiteToMenu"-Aktion: Select zeigt Standard-Menüs; Ausführen auf einer Seite ergänzt das URL-Muster (in Sektion „Website-Menüs" sichtbar, Menü bekommt Badge „Angepasst").

- [ ] **Step 7: Commit**

```bash
git add js/components/gesture-menu-config.js js/components/action-select.js pages/options.html _locales/en/messages.json _locales/de/messages.json
git commit -m "feat(menus): gesture menu config with standard/own/contextual modes"
```

---

### Task 10: Fork-Modus im Gesten-Editor

**Files:**
- Modify: `js/components/gesture-menu-config.js` (`#renderForkEditor`)
- Test: Logik ist bereits durch `tests/menu-model.test.mjs` abgesichert (Task 3); UI manuell (Schritt 3)

**Interfaces:**
- Consumes: `M().getBaseMenu`, `M().resolveFork`, Fork-Helfer `forkOverrideItem/forkDeleteItem/forkRestoreItem/forkAddItem/forkReorder` (Task 3), `<site-menu-editor>` mit `show-badges` + `.hiddenItems` (Task 7).
- Produces: vollständiger `mode: 'fork'`-Zweig; speichert weiterhin nur `{menuId, fork}` in der Gesten-Config.

- [ ] **Step 1: `#renderForkEditor` in `js/components/gesture-menu-config.js` ersetzen**

```js
	#renderForkEditor(cfg, i18n) {
		const siteMenus = SettingsStore.current.siteMenus;
		const base = M().getBaseMenu(CATALOG(), siteMenus, cfg.menuId);
		if (!cfg.menuId || !base) {
			const first = this.#activeMenus()[0];
			if (!cfg.menuId && first) queueMicrotask(() => this.#update({ menuId: first.id, fork: cfg.fork || M().emptyFork() }));
			return html`<div class="row">${this.#menuSelect(cfg.menuId, (id) => this.#onForkBaseChange(id))}</div>`;
		}
		const fork = cfg.fork || M().emptyFork();
		const baseItems = base.items || [];
		const baseIds = new Set(baseItems.map(it => it.id));
		const resolved = M().resolveFork(baseItems, fork);
		const rows = resolved.map(item => ({
			item,
			state: !baseIds.has(item.id) ? 'own'
				: (fork.overrides || {})[item.id] ? 'modified'
				: 'inherited',
		}));
		const hiddenItems = baseItems.filter(it => (fork.removed || []).includes(it.id));
		const saveFork = (next) => this.#update({ fork: next });
		return html`
			<div class="row">
				${this.#menuSelect(cfg.menuId, (id) => this.#onForkBaseChange(id))}
			</div>
			<site-menu-editor show-badges
				.rows=${rows}
				.hiddenItems=${hiddenItems}
				.name=${fork.name || ''}
				.namePlaceholder=${base.name || ''}
				.patterns=${null}
				@name-change=${(e) => saveFork({ ...fork, name: e.detail.name })}
				@item-change=${(e) => saveFork(M().forkOverrideItem(fork, baseItems, e.detail.item))}
				@item-delete=${(e) => saveFork(M().forkDeleteItem(fork, baseItems, e.detail.itemId))}
				@item-reset=${(e) => saveFork(M().forkRestoreItem(fork, e.detail.itemId))}
				@item-restore=${(e) => saveFork(M().forkRestoreItem(fork, e.detail.itemId))}
				@item-add=${(e) => saveFork(M().forkAddItem(fork, e.detail.item, e.detail.afterId))}
				@item-duplicate=${(e) => {
					const src = resolved.find(it => it.id === e.detail.itemId);
					if (!src) return;
					const copy = structuredClone(src);
					copy.id = `item_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
					saveFork(M().forkAddItem(fork, copy, e.detail.itemId));
				}}
				@items-reorder=${(e) => saveFork(M().forkReorder(fork, e.detail.orderedIds))}
			></site-menu-editor>
		`;
	}
```

- [ ] **Step 2: Tests laufen lassen**

Run: `npm test`
Expected: PASS (Model-Tests decken die Fork-Semantik; UI-Datei nur Syntax).

- [ ] **Step 3: Manuell verifizieren — die Spec-Kernszenarien** (Extension-Reload):

1. Geste → „Standard-Menü, angepasst" → Basis GitHub. Alle Einträge tragen Badge „Standard".
2. Eintrag „Issues" umbenennen → Badge „Verändert" + Undo-Pfeil. In Sektion „Website-Menüs" GitHub → „Issues"-URL ändern → im Fork bleibt der eigene Name (Override gewinnt). Undo-Pfeil im Fork → Badge zurück auf „Standard", Eintrag folgt wieder dem Standard inkl. URL-Änderung.
3. Eintrag „Trending" im Fork löschen → verschwindet; unter „Ausgeblendete Einträge (1)" gelistet; Wiederherstellen bringt ihn an der Standard-Position zurück.
4. Im Standard-Menü GitHub einen neuen Eintrag mittig einfügen → erscheint im Fork automatisch an derselben Position (Positionsvererbung), Badge „Standard".
5. Eigenen Eintrag im Fork hinzufügen (Badge „Eigen"); im Standard-Menü davorliegende Einträge umsortieren → eigener Eintrag bleibt an seinem Anker.
6. Im Fork per Drag umsortieren → Reihenfolge bleibt fix; neuer Standard-Eintrag landet jetzt am Ende.
7. Basis-Menü im Fork wechseln → Confirm-Dialog, Anpassungen werden verworfen.
8. Geste ausführen → Menü zeigt exakt die Fork-Ansicht aus dem Editor.

- [ ] **Step 4: Commit**

```bash
git add js/components/gesture-menu-config.js
git commit -m "feat(menus): fork editor with inheritance badges, hidden items, per-item reset"
```

---

### Task 11: Übrige Locales (~38 Sprachen) + Vollständigkeitstest

**Files:**
- Modify: alle `_locales/*/messages.json` außer `en`, `de`
- Test: `tests/site-menu-locales.test.mjs`

**Interfaces:**
- Consumes: die in Tasks 4–9 eingeführten Keys (Quelle der Wahrheit: `_locales/en/messages.json`).

- [ ] **Step 1: Failing Test schreiben** — `tests/site-menu-locales.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Alle in diesem Feature eingeführten Keys müssen in JEDER Locale existieren.
const NEW_KEY_PREFIXES = ['siteMenuItem', 'siteMenu', 'iconPicker', 'menuMode', 'fork'];
const NEW_KEYS_EXPLICIT = ['customMenuOwnLabel', 'menuFallbackLabel', 'menuFallbackNone', 'editGlobalMenuHint', 'openSiteMenusSection'];

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '_locales');
const en = JSON.parse(readFileSync(join(localesDir, 'en', 'messages.json'), 'utf8'));
const featureKeys = Object.keys(en).filter(k =>
	NEW_KEYS_EXPLICIT.includes(k) || NEW_KEY_PREFIXES.some(p => k.startsWith(p)));

describe('site-menu locale completeness', () => {
	it('collected feature keys from en', () => {
		expect(featureKeys.length).toBeGreaterThanOrEqual(60);
	});
	for (const lang of readdirSync(localesDir)) {
		it(`${lang} has all feature keys`, () => {
			const cat = JSON.parse(readFileSync(join(localesDir, lang, 'messages.json'), 'utf8'));
			const missing = featureKeys.filter(k => !cat[k] || !cat[k].message);
			expect(missing, `${lang} missing: ${missing.join(', ')}`).toEqual([]);
		});
	}
});
```

- [ ] **Step 2: Run — FAIL** (alle Locales außer en/de rot)

Run: `npx vitest run tests/site-menu-locales.test.mjs`

- [ ] **Step 3: Übersetzungen ergänzen**

Für jede Locale unter `_locales/` (außer `en`, `de`) alle Feature-Keys mit qualitativ guter Übersetzung ergänzen (Ausführender ist ein LLM — direkt übersetzen, kein externes Tool). Regeln:

- Markennamen unverändert (Gists, Marketplace, Reels, r/popular …) — die stehen ohnehin als `customName` im Katalog, nicht in den Locales.
- Platzhalter (`%name%`, `%n%`) exakt übernehmen.
- UI-Begriffe konsistent mit vorhandenen Übersetzungen derselben Locale halten (z. B. wie „Einstellungen"/„Verlauf" dort bereits heißen — vorher per Grep prüfen: `grep -n "history\|settings" _locales/<lang>/messages.json`).
- JSON-Struktur wie bestehende Einträge: `"key": { "message": "…" }`.
- Effizient arbeiten: pro Locale-Datei EINEN Edit mit allen Keys.

- [ ] **Step 4: Run — PASS**

Run: `npx vitest run tests/site-menu-locales.test.mjs`
Expected: PASS für alle ~40 Locales.

- [ ] **Step 5: Commit**

```bash
git add _locales tests/site-menu-locales.test.mjs
git commit -m "i18n(menus): site-menu strings for all locales + completeness test"
```

---

### Task 12: Cleanup, Gesamtverifikation, Changelog

**Files:**
- Delete: `js/components/menu-panel.js`
- Delete: `js/menu-switcher.js`, `tests/menu-switcher.test.mjs`
- Modify: `manifest.json` (menu-switcher.js aus content_scripts entfernen), `js/content.js` (letzte Alt-Referenzen), `CHANGELOG.md`, `CHANGELOG.zh_CN.md`
- Test: kompletter `npm test` + manueller Durchlauf

- [ ] **Step 1: Tote Referenzen finden und entfernen**

```bash
grep -rn "customMenus\|FlowMouseMenuSwitcher\|menu-panel\|getMenuLabel" js/ pages/ manifest.json
```

Erwartete Treffer und Behandlung:
- `js/content.js`: verbleibende `SETTINGS.customMenus`-/`FlowMouseMenuSwitcher`-Reste → entfernen (Task 5 sollte alle erwischt haben; hier verifizieren).
- `js/components/menu-panel.js` → Datei löschen (`git rm`).
- `js/menu-switcher.js` + `tests/menu-switcher.test.mjs` → löschen; Eintrag `"js/menu-switcher.js",` aus `manifest.json` `content_scripts.js` entfernen.
- Weitere Treffer (z. B. in `docs/`) sind ok — nur `js/`, `pages/`, `manifest.json` müssen sauber sein.

Veraltete i18n-Keys (`menuItemCount`, `menuItemCountOne`, `addMenu`, `menuItemNumber` …) NUR entfernen, wenn `grep -rn "<key>" js/ pages/` keine Treffer mehr liefert — sonst behalten (YAGNI: im Zweifel behalten, kein Locale-Massenedit).

- [ ] **Step 2: Gesamtlauf**

Run: `npm test`
Expected: alle Tests PASS (menu-switcher.test.mjs existiert nicht mehr).

- [ ] **Step 3: Manueller End-to-End-Durchlauf** (Extension-Reload; Checkliste):

1. Options-Seite lädt fehlerfrei (Konsole leer), Sektion „Website-Menüs" funktioniert.
2. Alle 4 Gesten-Modi je einmal durchspielen (standard / fork / own / contextual).
3. Switcher im geöffneten Menü, Icons hell/dunkel, Amazon-Domain, addSiteToMenu.
4. Service-Worker-Konsole (chrome://extensions → „service worker") fehlerfrei.
5. Popup-Seite öffnen (lädt kein action-select, darf aber nicht brechen).

- [ ] **Step 4: Changelog**

In `CHANGELOG.md` (und sinngemäß übersetzt in `CHANGELOG.zh_CN.md`) unter „Unreleased"/neuester Version ergänzen:

```markdown
- **Website menus:** predefined, fully editable menus for popular sites (GitHub, YouTube, Amazon incl. country selection, …) with icons; new settings section.
- **Custom menu action** now has four sources: standard menu, customized standard menu (inherits updates for unchanged items), own per-gesture menu, or contextual by URL.
- Menu items support links, searches, and any gesture action, each with a selectable icon (Lucide set or favicon).
- **Breaking:** the old shared custom-menu pool was removed; gestures using it must be reconfigured.
```

(Kein Versions-Bump — macht der Nutzer beim Release.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(menus): remove legacy custom-menu pool, switcher module; changelog"
```

---

## Self-Review-Ergebnis (beim Planschreiben ausgeführt)

- **Spec-Abdeckung:** Katalog (Task 4) ✓, `siteMenus`-Settings (Task 2/8) ✓, Vererbungsregeln 1–7 (Task 3, testweise kodiert) ✓, Settings-UI inkl. Umzug Switcher/Theme (Task 8) ✓, 4 Gesten-Modi (Task 9/10) ✓, Laufzeit + Icons im iframe + `{domain}` (Task 5) ✓, `addSiteToMenu` (Task 5/9) ✓, i18n alle Locales (Task 11) ✓, Cleanup ohne Migration (Task 12) ✓.
- **Typkonsistenz:** Item-Format `{id, type:'separator'}` bzw. `{id, action, labelKey?, customName?, icon?, …}` einheitlich in Model, Katalog, Editor, Runtime. Fork-Format `{overrides, removed, added, order, name}` einheitlich. `resolveMenu`-Rückgabe `{menuId, name, items, domain}` von content.js und gesture-menu-config identisch konsumiert.
- **Korrigiert beim Review:** `rotateCcw` fehlte im Icon-Subset (in Task 4 nachgezogen); `goo-photos` hatte doppeltes Label (Hinweis in Task 4 Step 3); ein fehlerhafter `await import`-Codeblock im addSiteToMenu-Zweig (Task 9) wurde entfernt.




