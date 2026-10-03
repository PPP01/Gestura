# Home Assistant Website Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a predefined "Home Assistant" website menu whose entries open pages of whichever Home Assistant instance the user is currently on — `https://assi.home.schep.de/`, `http://homeassistant.local:8123/`, a Nabu Casa URL, anything.

**Architecture:** Home Assistant is self-hosted, so the catalog cannot carry absolute URLs. The existing `openCustomUrl` placeholder mechanism (`{tabUrl}`, `{tabTitle}`, `{tabDomain}`, resolved in the service worker against the sender's tab) gains a fourth placeholder, `{tabOrigin}` (scheme + host + port). The catalog entries are written as `{tabOrigin:raw}/config/logs`. The placeholder function moves from `js/background.js` into `js/search-url.js` so it becomes unit-testable; no new script has to be registered anywhere, because `search-url.js` is already loaded by the worker, the content scripts and the pages. Because such a menu cannot pass the exchange format's `https://` rule, its export is refused with a message instead of writing a file the import would reject.

**Tech Stack:** Plain classic scripts (no build), vitest, `chrome.i18n` catalogs.

**Spec:** No spec file — this is a bounded change; the design was agreed in chat on 2026-10-03. The relevant decisions are restated under *Design decisions* below. Revision 2 (same day) incorporates an external plan review; see *Review outcome* at the end.

## Design decisions

- **Targets are relative to the current tab's origin.** No setting, no instance URL to type in. Origin includes the port, so `:8123` setups work unchanged.
- **Recognition is by URL pattern.** The catalog ships the common defaults `*:8123/*`, `*homeassistant.local*`, `*.ui.nabu.casa*`. A host such as `assi.home.schep.de` is assigned by the user through the browser context menu entry **"Set website menu for this page"** (`CTX_ASSIGN_PREFIX`, `js/background.js` ~L2303 — adds a pattern only) or the pattern field in the menu editor — a user delta, not a catalog entry. **Not** through "Add to menu" (`CTX_ADD_PREFIX`): that one also appends the current page as an absolute link item (`addLinkToMenu`), which would duplicate "Home" and turn the menu into an edited copy for no reason. There is no pattern syntax for "any host, optional port"; only `*` is a wildcard, and a bare `*` would match every page.
- **Deviation from the chat design (deliberate).** The chat proposed an `{origin}` placeholder substituted inside `resolveMenu` from the content script's `location.href`, plus a guard that hides the menu on non-matching pages. Reading the code turned up two reasons to change that:
  1. Content scripts run in **all frames**. The worker resolves placeholders against `sender.tab.url`, which is always the top-level page, so a link clicked from a menu opened inside an iframe still targets the instance — never the iframe's origin. (Which menu *opens* inside an iframe is decided by the frame's own URL; see *Out of scope*.)
  2. The placeholder mechanism already exists for `openCustomUrl`; adding one key there is smaller than a second substitution path, and users get `{tabOrigin}` for their own menus and gestures for free.
  The guard is dropped (YAGNI): it would have needed the frame URL again, and a user who explicitly picks Home Assistant as the *default* menu on foreign sites gets exactly what they configured.
- **A template that needs an origin and has none resolves to nothing.** If `{tabOrigin}` appears in the template and the tab has no real origin, the whole URL becomes `''`; the worker's existing `if (url)` then opens nothing. Substituting `''` alone would turn `{tabOrigin:raw}/config/logs` into `/config/logs`, which the worker prefixes to `http:///config/logs`.

## Global Constraints

- Indentation is tabs, throughout.
- New code comments are in English (repo language, `CLAUDE.md`), even inside files whose older comments are German.
- No build step; `search-url.js` stays a classic script exposing `root.FlowMouseSearchUrl` and `module.exports`.
- New `siteMenu*` keys go into `en` and `de` only and must be listed in `PENDING_TRANSLATION` in `tests/site-menu-locales.test.mjs`.
- Never put `$WORD$` into a message string.
- Menu name `Home Assistant` is a brand name: `name`, not `nameKey`.
- Icons must exist in `js/menu-icons.js` (`FlowMouseMenuIcons`).
- The exchange format (`js/exchange-schema.json`, `isHttpsUrl` in `js/menu-exchange.js`) is a contract with the gestura-index repo and is **not** changed by this plan.
- `npm test` must be green after every task.

## Review Focus

1. **Tab without a real origin** (`file:`, `about:blank`, empty or broken URL, missing `sender.tab`) — a `{tabOrigin}` template must resolve to `''` as a whole, so nothing is opened. Pinned in Task 1.
2. **Instance on a non-default port** (`http://192.168.1.5:8123`) — origin must keep the port. Pinned in Task 1.
3. **`{tabOrigin}` without `:raw`** — percent-encoded like the other placeholders, so it is usable as a query value but not as a URL prefix. Pinned in Task 1; the catalog uses `:raw`.
4. **Exporting the menu after assigning an own domain** — the menu becomes an edited copy and shows the export button; the export must refuse with a message instead of writing a file that re-import rejects. Pinned in Task 3 (the rule) and checked by hand (the message).
5. **Link clicked in a menu opened inside a same-origin iframe** (Home Assistant ingress add-ons) — must open on the instance origin. Resolved in the worker against `sender.tab`; checked by hand in Task 2 Step 9.

## Out of scope / known limitations

- **Sharing the Home Assistant menu** via file or gestura.eu does not work until the exchange contract learns about `{tabOrigin}` — a coordinated change with the index repo, own ticket. Task 3 makes the refusal explicit instead of silent.
- **Menu selection inside cross-origin iframes.** A gesture inside an iframe resolves the contextual menu against the frame's own `location.href` (`js/content.js` ~L3614). On a Home Assistant dashboard, a gesture inside an embedded Grafana card therefore opens the default (or Grafana's) menu, not Home Assistant's. This is the existing behaviour for every website menu (an embedded YouTube player gets the YouTube menu), so changing it is a product decision across all menus — own ticket, not part of this plan. Same-origin ingress iframes match the instance's pattern and are unaffected.
- **Pattern false positives.** `patternToRegExp` is unanchored and `*` crosses host/path/query boundaries, so contrived URLs such as `https://example.com/path/:8123/x`, `https://homeassistant.local.example.org/` or `https://example.com/?next=https://x.ui.nabu.casa/` select the Home Assistant menu. Every catalog menu shares this (`*google.com*` matches `?q=google.com`). The effect is a wrong menu whose links stay on the site the user is already on — nothing cross-site. Host/port-aware matching would be a change to the shared pattern language, not to this menu.

---

### Task 1: `{tabOrigin}` placeholder, testable in `search-url.js`

**Files:**
- Modify: `js/search-url.js` (add `replaceUrlPlaceholders`, export it)
- Modify: `js/background.js:224-240` (delete the local function), `js/background.js:820` (call the shared one)
- Modify: `js/components/action-select.js:1756` (list `{tabOrigin}` in the hint)
- Test: `tests/search-url.test.mjs`

**Interfaces:**
- Produces: `FlowMouseSearchUrl.replaceUrlPlaceholders(template: string, tab: {url?: string, title?: string} | null | undefined): string` — replaces `{tabUrl}`, `{tabTitle}`, `{tabDomain}`, `{tabOrigin}`, each optionally with `:raw`; without `:raw` the value is `encodeURIComponent`-encoded. Returns `''` for the whole template when it contains `{tabOrigin}` / `{tabOrigin:raw}` and the tab has no real origin. Task 2's catalog entries rely on `{tabOrigin:raw}`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/search-url.test.mjs` (the file uses two-space indentation inside `describe`; match it):

```js
describe("replaceUrlPlaceholders", () => {
  const { replaceUrlPlaceholders } = globalThis.FlowMouseSearchUrl;
  const tab = { url: "https://assi.home.schep.de/lovelace/0?edit=1#x", title: "Übersicht & mehr" };

  it("keeps the existing placeholders unchanged", () => {
    expect(replaceUrlPlaceholders("https://a.example/?u={tabUrl}&t={tabTitle}&d={tabDomain}", tab))
      .toBe("https://a.example/?u=https%3A%2F%2Fassi.home.schep.de%2Flovelace%2F0%3Fedit%3D1%23x"
        + "&t=%C3%9Cbersicht%20%26%20mehr&d=assi.home.schep.de");
    expect(replaceUrlPlaceholders("https://web.archive.org/web/{tabUrl:raw}", tab))
      .toBe("https://web.archive.org/web/https://assi.home.schep.de/lovelace/0?edit=1#x");
  });
  it("{tabOrigin:raw} is scheme + host without path, query or fragment", () => {
    expect(replaceUrlPlaceholders("{tabOrigin:raw}/config/logs", tab))
      .toBe("https://assi.home.schep.de/config/logs");
  });
  it("{tabOrigin:raw} keeps a non-default port", () => {
    expect(replaceUrlPlaceholders("{tabOrigin:raw}/config/logs", { url: "http://192.168.1.5:8123/lovelace" }))
      .toBe("http://192.168.1.5:8123/config/logs");
  });
  it("{tabOrigin} without :raw is percent-encoded like the others", () => {
    expect(replaceUrlPlaceholders("https://x.example/?site={tabOrigin}", { url: "http://ha.local:8123/" }))
      .toBe("https://x.example/?site=http%3A%2F%2Fha.local%3A8123");
  });
  it("a template needing an origin resolves to nothing when the tab has none", () => {
    const t = "{tabOrigin:raw}/config/logs";
    expect(replaceUrlPlaceholders(t, { url: "file:///C:/x.html" })).toBe("");
    expect(replaceUrlPlaceholders(t, { url: "about:blank" })).toBe("");
    expect(replaceUrlPlaceholders(t, { url: "" })).toBe("");
    expect(replaceUrlPlaceholders(t, { url: "not a url" })).toBe("");
    expect(replaceUrlPlaceholders(t, null)).toBe("");
    expect(replaceUrlPlaceholders(t, undefined)).toBe("");
    expect(replaceUrlPlaceholders("https://x.example/?site={tabOrigin}", { url: "about:blank" })).toBe("");
  });
  it("templates without {tabOrigin} are unaffected by a missing origin", () => {
    expect(replaceUrlPlaceholders("https://x.example/?t={tabTitle:raw}", { url: "about:blank", title: "T" }))
      .toBe("https://x.example/?t=T");
  });
  it("leaves unknown placeholders and a missing template alone", () => {
    expect(replaceUrlPlaceholders("{domain}/{nope}", tab)).toBe("{domain}/{nope}");
    expect(replaceUrlPlaceholders(undefined, tab)).toBe("");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/search-url.test.mjs`
Expected: FAIL — `replaceUrlPlaceholders is not a function`.

- [ ] **Step 3: Implement in `js/search-url.js`**

Insert after `matchesPatterns` (before `resolveSearchConfig`):

```js
	// Placeholders for openCustomUrl, resolved in the worker against the
	// sender's tab - always the top-level page, even when the gesture started
	// in an iframe. tabOrigin is scheme + host + port. A template that needs
	// an origin the tab does not have (file:, about:, no tab) resolves to ''
	// as a whole: '/config/logs' alone would be opened as http:///config/logs.
	function replaceUrlPlaceholders(template, tab) {
		const rawUrl = (tab && tab.url) || '';
		const raw = {
			tabUrl: rawUrl,
			tabTitle: (tab && tab.title) || '',
			tabDomain: '',
			tabOrigin: '',
		};
		if (rawUrl) {
			try {
				const u = new URL(rawUrl);
				raw.tabDomain = u.hostname;
				raw.tabOrigin = u.origin === 'null' ? '' : u.origin;
			} catch { }
		}
		const tpl = template || '';
		if (!raw.tabOrigin && /\{tabOrigin(?::raw)?\}/.test(tpl)) return '';
		return tpl.replace(/\{(tabUrl|tabTitle|tabDomain|tabOrigin)(?::(raw))?\}/g, (_, key, mod) => {
			const val = raw[key] || '';
			return mod ? val : encodeURIComponent(val);
		});
	}
```

Change the export line to:

```js
	const api = { buildSearchUrl, resolveSearchConfig, looksLikeUrl, normalizeUrl, matchesPatterns, patternToRegExp, replaceUrlPlaceholders };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/search-url.test.mjs`
Expected: PASS.

- [ ] **Step 5: Switch the worker to the shared function**

In `js/background.js`, delete the whole local `function replaceUrlPlaceholders(template, tab) { … }` (lines 224-240, including the trailing blank line). At the `openCustomUrl` case (currently line 820) change

```js
			let url = replaceUrlPlaceholders(request.customUrl, sender.tab);
```

to

```js
			let url = self.FlowMouseSearchUrl.replaceUrlPlaceholders(request.customUrl, sender.tab);
```

The existing `if (url) { … }` right below already skips an empty result — leave it as is.

The worker is not covered by unit tests, so check by search:

Run: `git grep -n "replaceUrlPlaceholders" -- js`
Expected: exactly two hits, the definition in `js/search-url.js` and the call in `js/background.js`.

- [ ] **Step 6: List `{tabOrigin}` in the editor hint**

In `js/components/action-select.js:1756` change the `%placeholders%` replacement from

```js
'<code>{tabUrl}</code> <code>{tabTitle}</code> <code>{tabDomain}</code>'
```

to

```js
'<code>{tabUrl}</code> <code>{tabTitle}</code> <code>{tabDomain}</code> <code>{tabOrigin}</code>'
```

The hint text itself lives in the locales and lists placeholders only via `%placeholders%`, so no locale changes.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all suites PASS.

- [ ] **Step 8: Commit**

```bash
git add js/search-url.js js/background.js js/components/action-select.js tests/search-url.test.mjs
git commit -m "feat(urls): {tabOrigin} placeholder for custom URLs

Scheme, host and port of the current tab, resolved in the worker
against the top-level tab. A template that needs an origin the tab
does not have resolves to nothing instead of a broken http:/// URL.
The placeholder function moves into search-url.js so it can be
tested; it was untested in background.js.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The Home Assistant catalog menu

**Files:**
- Modify: `js/menu-catalog.js:148` (new entry after `wikipedia`)
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json` (six new `siteMenuItem*` keys, after `siteMenuItemRecentChanges`)
- Modify: `tests/site-menu-locales.test.mjs:76` (`PENDING_TRANSLATION`)
- Modify: `CHANGELOG.md` (`### Unreleased` → `**New Features:**`), `README.md:53`, `README.de.md:53`
- Test: `tests/menu-catalog.test.mjs`

**Interfaces:**
- Consumes: `{tabOrigin:raw}` from Task 1 (resolved by the worker; the catalog only stores the template string).
- Produces: catalog menu id `homeassistant`, item ids `ha-*`. Task 3 uses the menu's items as test input.

- [ ] **Step 1: Write the failing tests**

In `tests/menu-catalog.test.mjs`:

a) Extend the expected id list in the first test:

```js
		expect(SITE_MENU_CATALOG.map(m => m.id)).toEqual([
			'search', 'github', 'm365', 'amazon', 'shopping', 'gmail', 'gmaps', 'google', 'youtube',
			'facebook', 'instagram', 'x', 'reddit', 'linkedin', 'wikipedia', 'homeassistant',
		]);
```

b) In the `items:` test replace

```js
				expect(it.customUrl, it.id).toMatch(/^https:\/\//);
```

with

```js
				// Self-hosted services have no fixed address: their links hang off
				// the current tab's origin instead of a literal https:// URL.
				expect(it.customUrl, it.id).toMatch(/^(https:\/\/|\{tabOrigin:raw\}\/)/);
```

c) Add these tests before the closing `});` of the `describe`:

```js
	it('home assistant: every link is relative to the current instance', () => {
		const ha = SITE_MENU_CATALOG.find(m => m.id === 'homeassistant');
		const links = ha.items.filter(i => i.type !== 'separator');
		expect(links.map(i => i.customUrl)).toEqual([
			'{tabOrigin:raw}/',
			'{tabOrigin:raw}/config/integrations/dashboard',
			'{tabOrigin:raw}/config/logs',
			'{tabOrigin:raw}/config/devices/dashboard',
			'{tabOrigin:raw}/config/entities',
			'{tabOrigin:raw}/config/automation/dashboard',
			'{tabOrigin:raw}/config/tools/yaml',
			'{tabOrigin:raw}/config/tools/template',
			'{tabOrigin:raw}/history',
			'{tabOrigin:raw}/config/updates',
		]);
	});
	it('home assistant: default patterns, and a user host assigned on top', async () => {
		await import('../js/menu-model.js');
		await import('../js/search-url.js');
		await import('../js/menu-patterns.js');
		const M = globalThis.FlowMouseMenuModel;
		const { matchesPatterns } = globalThis.FlowMouseSearchUrl;
		const { siteToPattern } = globalThis.FlowMouseMenuPatterns;
		const EMPTY = { disabled: [], edited: {}, custom: {}, domains: {}, order: [], flags: {} };
		const resolve = (sm, url) => M.resolveContextualMenuId(SITE_MENU_CATALOG, sm, url, matchesPatterns);

		expect(resolve(EMPTY, 'http://homeassistant.local:8123/lovelace/0')).toBe('homeassistant');
		expect(resolve(EMPTY, 'http://192.168.1.5:8123/config/dashboard')).toBe('homeassistant');
		expect(resolve(EMPTY, 'https://abcdef123.ui.nabu.casa/lovelace')).toBe('homeassistant');
		// ':8123' that is not followed by a path slash does not count.
		expect(resolve(EMPTY, 'https://example.com/?p=:8123')).toBeNull();
		// Existing menus are unaffected.
		expect(resolve(EMPTY, 'https://github.com/PPP01/Gestura')).toBe('github');

		// A host on the default port needs the user's own pattern - the one
		// "Set website menu for this page" assigns.
		const url = 'https://assi.home.schep.de/lovelace/0';
		expect(resolve(EMPTY, url)).toBeNull();
		const { siteMenus } = M.addPatternToMenu(SITE_MENU_CATALOG, EMPTY, 'homeassistant', siteToPattern(url));
		expect(resolve(siteMenus, url)).toBe('homeassistant');
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/menu-catalog.test.mjs`
Expected: FAIL — the id list lacks `homeassistant`, `ha` is `undefined`.

- [ ] **Step 3: Add the catalog entry**

In `js/menu-catalog.js`, after the closing `] },` of the `wikipedia` entry (line 148) and before `];`, insert:

```js
		// Self-hosted: no fixed address, so every link hangs off the current
		// tab's origin. The patterns cover the usual installations; an own
		// domain on port 443 is assigned by the user ("Set website menu for
		// this page").
		{ id: 'homeassistant', name: 'Home Assistant', icon: 'house', patterns: ['*:8123/*', '*homeassistant.local*', '*.ui.nabu.casa*'], items: [
			{ id: 'ha-home', labelKey: 'siteMenuItemHome', icon: 'house', action: 'openCustomUrl', customUrl: '{tabOrigin:raw}/' },
			{ id: 'ha-integrations', labelKey: 'siteMenuItemIntegrations', icon: 'package', action: 'openCustomUrl', customUrl: '{tabOrigin:raw}/config/integrations/dashboard' },
			{ id: 'ha-logs', labelKey: 'siteMenuItemLogs', icon: 'fileText', action: 'openCustomUrl', customUrl: '{tabOrigin:raw}/config/logs' },
			{ id: 'ha-sep1', type: 'separator' },
			{ id: 'ha-devices', labelKey: 'siteMenuItemDevices', icon: 'hardDrive', action: 'openCustomUrl', customUrl: '{tabOrigin:raw}/config/devices/dashboard' },
			{ id: 'ha-entities', labelKey: 'siteMenuItemEntities', icon: 'layoutList', action: 'openCustomUrl', customUrl: '{tabOrigin:raw}/config/entities' },
			{ id: 'ha-automations', labelKey: 'siteMenuItemAutomations', icon: 'timer', action: 'openCustomUrl', customUrl: '{tabOrigin:raw}/config/automation/dashboard' },
			{ id: 'ha-sep2', type: 'separator' },
			{ id: 'ha-yaml', customName: 'YAML', icon: 'settings', action: 'openCustomUrl', customUrl: '{tabOrigin:raw}/config/tools/yaml' },
			{ id: 'ha-template', customName: 'Template', icon: 'squarePen', action: 'openCustomUrl', customUrl: '{tabOrigin:raw}/config/tools/template' },
			{ id: 'ha-history', labelKey: 'siteMenuItemHistory', icon: 'history', action: 'openCustomUrl', customUrl: '{tabOrigin:raw}/history' },
			{ id: 'ha-updates', labelKey: 'siteMenuItemUpdates', icon: 'download', action: 'openCustomUrl', customUrl: '{tabOrigin:raw}/config/updates' },
		] },
```

`config/tools/yaml` and `config/tools/template` are the current paths: Home Assistant moved the developer tools there in 2026.8 and redirects the old `developer-tools/…` paths (verified by the reviewer against the official frontend router).

- [ ] **Step 4: Add the six labels to `en` and `de`**

`_locales/en/messages.json`, directly after the `siteMenuItemRecentChanges` block (ends line 2768):

```json
	"siteMenuItemIntegrations": {
		"message": "Integrations",
		"description": "Label for a predefined site-menu item (Home Assistant)"
	},
	"siteMenuItemLogs": {
		"message": "Logs",
		"description": "Label for a predefined site-menu item (Home Assistant)"
	},
	"siteMenuItemDevices": {
		"message": "Devices",
		"description": "Label for a predefined site-menu item (Home Assistant)"
	},
	"siteMenuItemEntities": {
		"message": "Entities",
		"description": "Label for a predefined site-menu item (Home Assistant)"
	},
	"siteMenuItemAutomations": {
		"message": "Automations",
		"description": "Label for a predefined site-menu item (Home Assistant)"
	},
	"siteMenuItemUpdates": {
		"message": "Updates",
		"description": "Label for a predefined site-menu item (Home Assistant)"
	},
```

`_locales/de/messages.json`, directly after `siteMenuItemRecentChanges` (ends line 2688), the same six keys and descriptions with these messages:

| key | de message |
|---|---|
| `siteMenuItemIntegrations` | `Integrationen` |
| `siteMenuItemLogs` | `Protokolle` |
| `siteMenuItemDevices` | `Geräte` |
| `siteMenuItemEntities` | `Entitäten` |
| `siteMenuItemAutomations` | `Automatisierungen` |
| `siteMenuItemUpdates` | `Updates` |

Before committing, compare these with the German Home Assistant UI of the test instance (sidebar → Settings) and take its exact wording where it differs.

- [ ] **Step 5: Register the keys as pending translation**

In `tests/site-menu-locales.test.mjs:76` change

```js
	'blacklistBlockedByEntry', 'menuBlacklisted'];
```

to

```js
	'blacklistBlockedByEntry', 'menuBlacklisted',
	'siteMenuItemIntegrations', 'siteMenuItemLogs', 'siteMenuItemDevices',
	'siteMenuItemEntities', 'siteMenuItemAutomations', 'siteMenuItemUpdates'];
```

(Task 3 appends one more key to this list.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/menu-catalog.test.mjs tests/site-menu-locales.test.mjs tests/locale-placeholders.test.mjs`
Expected: PASS.

- [ ] **Step 7: Docs**

`CHANGELOG.md`, append to the `**New Features:**` list under `### Unreleased`:

```markdown
- **Home Assistant menu:** a website menu for your own Home Assistant
  instance — integrations, logs, devices, entities, automations, YAML and
  template tools, history and updates. The links follow whichever instance
  you are on, so no address has to be configured. It recognizes port 8123,
  `homeassistant.local` and Nabu Casa out of the box; for your own domain,
  choose "Set website menu for this page" once. Custom URLs gain a matching
  `{tabOrigin}` placeholder (scheme, host and port of the current tab).
```

`README.md:53` — in the list of sites, change `Wikipedia, and more` to `Wikipedia, your own Home Assistant, and more`.
`README.de.md:53` — change `Wikipedia und mehr` to `Wikipedia, deinem eigenen Home Assistant und mehr`.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: all suites PASS.

- [ ] **Step 9: Verify in the browser**

Reload the unpacked extension at `chrome://extensions` (or `edge://extensions`), then:

1. Open `https://assi.home.schep.de/`. Right-click the page → Gestura → **"Set website menu for this page"** → Home Assistant, confirm the suggested pattern `*assi.home.schep.de*`. (Do not use "Add to menu" — it also adds the page as an extra link.)
2. Options → Website menus → Home Assistant: the item list is unchanged (ten links, two separators), the pattern list contains the new pattern.
3. Perform the contextual site-menu gesture on the dashboard: the Home Assistant menu opens with three groups.
4. Click **Logs** → `https://assi.home.schep.de/config/logs` opens. Click **YAML** and **Template** → both pages load.
5. Open an ingress add-on from the sidebar (e.g. File editor or Terminal), gesture **inside** its iframe, click **Integrations** → it opens on `https://assi.home.schep.de/config/integrations/dashboard`.

- [ ] **Step 10: Commit**

```bash
git add js/menu-catalog.js _locales/en/messages.json _locales/de/messages.json tests/menu-catalog.test.mjs tests/site-menu-locales.test.mjs CHANGELOG.md README.md README.de.md
git commit -m "feat(menus): Home Assistant website menu

Links follow the current instance via {tabOrigin:raw}. Ships patterns
for :8123, homeassistant.local and Nabu Casa; other hosts are assigned
by the user. The six new labels are en/de only for now and listed in
PENDING_TRANSLATION.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Refuse an export the import would reject

Assigning an own domain stores the Home Assistant menu as an edited copy (`siteMenus.edited`), and edited menus show an export button (`js/components/site-menu-manager.js` ~L475). `menuToExchange` would write `{tabOrigin:raw}/…` into the file, and importing that file fails with `itemUrl`. Instead of extending the exchange contract, the export validates its own output with the same `validate()` the import uses and refuses with a message when it fails. This is generic — no Home Assistant special case — and needs no contract change.

**Files:**
- Modify: `js/components/site-menu-manager.js:254-269` (`#exportMenu`)
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json` (one new key `siteMenuExportRejected`, after the Task 2 keys)
- Modify: `tests/site-menu-locales.test.mjs` (`PENDING_TRANSLATION`)
- Test: `tests/menu-exchange.test.mjs`

**Interfaces:**
- Consumes: `FlowMouseMenuExchange.menuToExchange(menuDef, meta)` and `FlowMouseMenuExchange.validate(obj) → { ok, type, errors, value }` (both existing); the `homeassistant` catalog entry from Task 2.
- Produces: message key `siteMenuExportRejected`.

- [ ] **Step 1: Write the failing test**

The component itself has no unit tests; what can be pinned is the rule the guard relies on — the exported Home Assistant menu does not validate, an ordinary edited menu does. Append to `tests/menu-exchange.test.mjs`:

```js
describe('export of menus with origin-relative links', () => {
	it('an exported Home Assistant menu fails validation, an ordinary one passes', async () => {
		await import('../js/menu-catalog.js');
		const ha = globalThis.FlowMouseMenuCatalog.SITE_MENU_CATALOG.find(m => m.id === 'homeassistant');
		// Same shape #exportMenu builds: labels resolved to literal customName.
		const asExported = (def) => ({
			...def,
			items: def.items.map(it => it.type === 'separator' ? it : { ...it, customName: it.customName || 'x' }),
		});
		const haOut = X.menuToExchange(asExported(ha), { id: 'homeassistant', version: '1.0.0' });
		const res = X.validate(haOut);
		expect(res.ok).toBe(false);
		expect(res.errors).toContain('itemUrl');

		const gh = globalThis.FlowMouseMenuCatalog.SITE_MENU_CATALOG.find(m => m.id === 'github');
		expect(X.validate(X.menuToExchange(asExported(gh), { id: 'github', version: '1.0.0' })).ok).toBe(true);
	});
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/menu-exchange.test.mjs`
Expected: PASS already (Task 2 is in place and the validator is unchanged) — this test pins the rule, it does not drive new code in `menu-exchange.js`. If it FAILS, stop: the premise of this task is wrong and the plan needs revisiting.

- [ ] **Step 3: Add the message key**

`_locales/en/messages.json`, after the Task 2 keys:

```json
	"siteMenuExportRejected": {
		"message": "This menu can't be exported: the import would reject it — for example links that don't start with https:// or depend on the current page, unsupported actions, or an empty menu.",
		"description": "Alert when exporting a website menu whose file would not pass the import check (e.g. links using {tabOrigin})"
	},
```

`_locales/de/messages.json`, same position:

```json
	"siteMenuExportRejected": {
		"message": "Dieses Menü lässt sich nicht exportieren: Der Import würde es ablehnen – etwa wegen Links, die nicht mit https:// beginnen oder von der aktuellen Seite abhängen, wegen nicht unterstützter Aktionen oder weil das Menü leer ist.",
		"description": "Alert when exporting a website menu whose file would not pass the import check (e.g. links using {tabOrigin})"
	},
```

The `{tabOrigin}` in the description is not a `$WORD$` placeholder and is harmless; the message itself contains no braces.

In `tests/site-menu-locales.test.mjs`, append `'siteMenuExportRejected'` to `PENDING_TRANSLATION` (after the six keys from Task 2):

```js
	'siteMenuItemEntities', 'siteMenuItemAutomations', 'siteMenuItemUpdates',
	'siteMenuExportRejected'];
```

- [ ] **Step 4: Guard the export**

In `js/components/site-menu-manager.js`, in `#exportMenu`, between the `menuToExchange` call and `downloadJson`, insert:

```js
		// Never write a file our own import would refuse. Menus whose links hang
		// off the current page ({tabOrigin}) cannot pass the exchange format's
		// https:// rule yet.
		if (!window.FlowMouseMenuExchange.validate(out).ok) {
			alert(i18n.getMessage('siteMenuExportRejected'));
			return;
		}
```

so the method ends:

```js
		const out = window.FlowMouseMenuExchange.menuToExchange(resolvedDef, {
			id: (m.def.source && m.def.source.indexId) || m.id,
			version: (m.def.source && m.def.source.version) || '1.0.0',
		});
		// Never write a file our own import would refuse. Menus whose links hang
		// off the current page ({tabOrigin}) cannot pass the exchange format's
		// https:// rule yet.
		if (!window.FlowMouseMenuExchange.validate(out).ok) {
			alert(i18n.getMessage('siteMenuExportRejected'));
			return;
		}
		downloadJson(out, `${sanitizeFilename(menuName)}.gestura-menu.json`);
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all suites PASS (including `site-menu-locales`, `locale-placeholders`, `menu-exchange-locales`).

- [ ] **Step 6: Verify in the browser**

After Task 2 Step 9 (the menu now carries the own pattern and is an edited copy): Options → Website menus → Home Assistant → export button → the alert appears, no file is downloaded. Export an ordinary edited or custom menu (e.g. add a pattern to GitHub) → the file downloads as before.

- [ ] **Step 7: Commit**

```bash
git add js/components/site-menu-manager.js _locales/en/messages.json _locales/de/messages.json tests/menu-exchange.test.mjs tests/site-menu-locales.test.mjs
git commit -m "fix(exchange): refuse a menu export the import would reject

An edited Home Assistant menu carries {tabOrigin} links, which the
exchange format's https:// rule rejects. The export now validates its
own output and says so instead of writing a file that cannot be
imported again.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Review outcome (revision 2)

External review, 2026-10-03. Findings and how they were handled:

| # | Finding | Decision |
|---|---|---|
| 1 | Menu selection in cross-origin iframes uses the frame URL | **Not in this plan.** Existing behaviour for every website menu; moved to *Out of scope* as its own ticket. The design text no longer over-claims what the worker-side resolution fixes. |
| 2 | Missing origin turns `{tabOrigin:raw}/x` into `http:///x` | **Fixed** in Task 1: the whole template resolves to `''`, tests pin it. |
| 3 | Pattern false positives | **Accepted trade-off**, documented in *Out of scope*: shared pattern semantics, links stay on the current site. |
| 4 | Export → re-import fails once the menu is edited | **Fixed** by new Task 3: export validates its own output and refuses with a message. |
| 5 | "Add to menu" also adds an absolute link | **Fixed**: design, changelog and manual test name "Set website menu for this page". |
| 6 | New comments in German | **Fixed**: all new comments in English; added to Global Constraints. |
| 7 | "Automationen" vs. "Automatisierungen" | **Fixed** to `Automatisierungen`, plus a check against the live German UI in Task 2 Step 4. |

Second-round review, same day: all five fixes confirmed, no critical or important findings. Validated in scratch runs: all 15 existing catalog menus still pass `validate(menuToExchange(…))`, so Task 3 refuses nothing that exported before. Minor findings:

| # | Finding | Decision |
|---|---|---|
| R2-1 | Export message names only page-dependent links, but the guard also catches `http://` links, unsupported actions and empty menus | **Fixed**: message wording made general. |
| R2-2 | `search-url.js` mixes quote styles | No change — single quotes match the neighbouring `patternToRegExp`. |
| R2-3 | `icon: 'favicon'` on a `{tabOrigin}` item derives a monogram from the template string | No change — same as `{tabUrl}` today, catalog items use fixed icons. |
