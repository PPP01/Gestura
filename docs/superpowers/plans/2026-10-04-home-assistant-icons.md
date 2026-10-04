# Home Assistant Menu Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Home Assistant website menu shows Home Assistant's own icons: the fixed entries (integrations, devices, entities, automations, tools, logs, updates, history) carry bundled icons that appear on every page, and the user's own dashboard links can adopt the icon Home Assistant shows for them in its sidebar.

**Architecture:** Two independent parts. (1) Eight Material Design Icons are bundled into `js/menu-icons.js` next to the Lucide icons and referenced by name from the catalog — the menu renderer already draws that registry, so nothing else changes. (2) A new icon mode `page` ("icon of the page"): on menu open, `js/page-icons.js` (generic) reads the SVG path Home Assistant draws next to a link on the current page, and a small provider file `js/page-icons-homeassistant.js` holds the rules that only apply to Home Assistant (dashboards match their sidebar entry by first path segment; the bare `/config` gear must never be borrowed). The menu iframe receives the validated path string in a new item field `iconPath` and builds the SVG itself — page markup never enters the menu.

**Tech Stack:** Plain classic scripts (no build), vitest in a node environment (no DOM library — DOM code is tested with hand-made fakes and checked against the real Test-HA at the end), `chrome.i18n` catalogs.

**Spec:** No spec file — bounded feature, designed in chat on 2026-10-04 (decisions restated below). Builds on `docs/superpowers/plans/2026-10-03-home-assistant-menu.md` (branch `feat/home-assistant-menu`). Revision 2 (same day) incorporates an external plan review; see *Review outcome* at the end.

## Design decisions

- **Fixed catalog entries use bundled icons, not live lookup.** Home Assistant shows them only on some pages (tab bar on the integrations/devices pages, list on `/config`, list on `/config/system`); a live lookup would show them inconsistently. Bundled, they appear everywhere, also when the menu is the user's default menu on a foreign site.
- **Names, not paths, in settings.** The catalog stores `icon: 'mdiPuzzle'`; the path data lives only in `js/menu-icons.js`. An edited copy of the menu therefore does not grow by the size of eight paths (the sync area allows 8192 bytes per section).
- **Provenance.** All eight path strings were compared character for character with `@mdi/js` 7.4.47 (Apache-2.0): `mdiPuzzle`, `mdiDevices`, `mdiShape`, `mdiRobot`, `mdiHammer`, `mdiTextBoxOutline`, `mdiUpdate`, `mdiChartBox`. They are the icons Home Assistant 2026.8.3 draws for these pages. `THIRD_PARTY_LICENSES.md` gets the attribution.
- **"Werkzeuge" gets the hammer.** The entry (`ha-yaml`, label `siteMenuItemTools`) opens the tools page, whose first tab is YAML; the hammer is the icon Home Assistant shows for `/config/tools`. "Template" keeps its Lucide icon — the tools tabs have no icons of their own.
- **Live page icons only where the user's own links need them.** Mode `page` is an ordinary value of the item's `icon` field (like `favicon`), chosen in the icon picker. Nothing is stored beyond that word.
- **Only same-origin links are looked up**, and only on menu open, and only if some item uses `page`. A link whose icon is not found falls back to the generic link icon.
- **The lookup uses the same page the click will use.** The worker resolves `{tabOrigin}` against the *top-level* tab (`sender.tab.url`), while a menu is built in the frame the gesture started in (`siteMenu` is a local action). So the finder takes its URL and DOM from `window.top` when that is same-origin accessible (a same-origin iframe such as an add-on page: the sidebar lives in the top document, not in the frame), and does no lookup at all — link icons only — when the top frame is cross-origin. Otherwise a frame from another instance could show its own icons for links that then open on the tab's instance.
- **A link is attributed to its own icon, never to a neighbour's.** The shadow-host fallback is used only when the host's shadow root holds exactly one link; a component with several links and one unrelated SVG gets no icons from it. Links are resolved with the document's real base URL (`a.baseURI`, which honours `<base href>`), the number of links inspected is capped, and path data must tokenize completely into commands and numbers.
- **Home Assistant rules live in their own file.** Matching a link to a sidebar entry needs knowledge of Home Assistant's URL scheme (`/<dashboard>/<view>` → sidebar entry `/<dashboard>`; but `/config/...` pages must never fall back to the gear that stands for `/config`). The generic module only knows exact matches; providers add the rest.
- **No cache, no stored icons.** Remembering icons seen earlier (so config entries look the same on every page) is deliberately left out; it would store the paths of private dashboards. Not needed because the fixed entries are bundled.

## Global Constraints

- Indentation is tabs, throughout; new comments in English.
- No build step. New files are classic scripts exposing `root.FlowMouse…` and `module.exports` (same pattern as `js/search-url.js`).
- New content scripts must be registered in `content_scripts` of `manifest.json` **before `js/content.js`**; `tests/load-order.test.mjs` checks that the files exist. The same two scripts must also be loaded before `js/content.js` in `pages/options.html`, `pages/about.html` and `pages/css-editor.html` (each loads `content.js`); `tests/page-content-deps.test.mjs` enforces that through its `REQUIRED_BEFORE_CONTENT` list, which therefore has to name them. Top-level code in them must be free of side effects other than defining globals — they run at `document_start` in every frame.
- The Firefox manifest on the `firefox-build` branch carries its own copy of that list: after merging this work into `firefox-build`, `js/page-icons.js` and `js/page-icons-homeassistant.js` must be added there, to `content_scripts[0].js` — not to `background.scripts`: only `content.js` reads them, the background script neither imports nor needs them, so `tests/load-order.test.mjs`'s comparison of `importScripts` with `background.scripts` is unaffected (see CLAUDE.md). Not part of this branch.
- New `iconPicker*` keys go into `en` and `de` only and must be listed in `PENDING_TRANSLATION` in `tests/site-menu-locales.test.mjs`.
- Never put `$WORD$` into a message string.
- `npm test` must be green after every task.

## Review Focus

1. **Hostile or broken path data from the page** (`d` with markup characters, a huge string, empty, not starting with a move command) — must be rejected, never rendered. Pinned in Task 2.
2. **Link to another origin than the page** — no icon is looked up. Pinned in Task 2.
3. **`/config` gear leaking onto config links** while the user is on a dashboard. Pinned in Task 3.
4. **Page without a matching link, without a sidebar, or with closed shadow roots / anchors outside any shadow root** (`getRootNode().host` is undefined) — falls back to the link icon, never throws. Pinned in Task 2.
5. **Cost on a large page** — the scan runs once per menu open and only when an item uses `page`; at most 1500 links are inspected and a shadow host is never searched once per link. Pinned in Task 2, measured in Task 6.
6. **`<base href>` pointing elsewhere** — a link that the browser resolves to a foreign origin must not be treated as same-origin. Pinned in Task 2.
7. **A component with several links and an unrelated SVG** — the links must not inherit that SVG. Pinned in Task 2.
8. **Gesture inside an iframe** — same-origin (add-on page): icons come from the top document; cross-origin: link icons only. Checked in Task 6.
9. **Page without the extension pages' scripts** — `options.html`, `about.html`, `css-editor.html` load `content.js`; without the new scripts a menu containing `icon: 'page'` would throw. Pinned in Task 3.

---

### Task 1: Eight bundled Home Assistant icons

**Files:**
- Modify: `js/menu-icons.js` (add a helper and eight entries before the closing `};` at line ~58)
- Modify: `js/menu-catalog.js` (the `homeassistant` entry: seven `icon:` values)
- Modify: `THIRD_PARTY_LICENSES.md` (append a section including the full Apache-2.0 text)
- Test: `tests/menu-icons.test.mjs`, `tests/menu-catalog.test.mjs`

**Interfaces:**
- Produces: eight keys in `FlowMouseMenuIcons`: `mdiPuzzle`, `mdiDevices`, `mdiShape`, `mdiRobot`, `mdiHammer`, `mdiTextBoxOutline`, `mdiUpdate`, `mdiChartBox` — each an `<svg …>` string with `fill="currentColor"` and exactly one `<path d="…"/>`.

- [ ] **Step 1: Write the failing tests**

In `tests/menu-icons.test.mjs`, replace the assertion `expect(ICONS[name], name).toContain('stroke="currentColor"');` with:

```js
			// Lucide icons are drawn with strokes, Material Design Icons (mdi…) are filled.
			expect(ICONS[name], name).toContain(name.startsWith('mdi') ? 'fill="currentColor"' : 'stroke="currentColor"');
```

and append inside the `describe`:

```js
	it('bundles the Material Design Icons Home Assistant uses, filled and with one path each', () => {
		const names = ['mdiPuzzle', 'mdiDevices', 'mdiShape', 'mdiRobot', 'mdiHammer',
			'mdiTextBoxOutline', 'mdiUpdate', 'mdiChartBox'];
		for (const n of names) {
			expect(ICONS[n], `missing ${n}`).toBeTruthy();
			expect(ICONS[n], n).toContain('viewBox="0 0 24 24"');
			expect(ICONS[n], n).toContain('fill="currentColor"');
			expect(ICONS[n], n).not.toContain('stroke');
			expect(ICONS[n].match(/<path /g), n).toHaveLength(1);
			expect(ICONS[n], n).toMatch(/<path d="M[^"<>]+Z"\/>/);
		}
	});
```

In `tests/menu-catalog.test.mjs`, append before the closing `});` of the `describe` (after the two Home Assistant tests from the earlier plan):

```js
	it('home assistant: entries carry the icons Home Assistant itself shows', () => {
		const ha = SITE_MENU_CATALOG.find(m => m.id === 'homeassistant');
		const icons = Object.fromEntries(ha.items.filter(i => i.type !== 'separator').map(i => [i.id, i.icon]));
		expect(icons).toEqual({
			'ha-home': 'house',
			'ha-integrations': 'mdiPuzzle',
			'ha-logs': 'mdiTextBoxOutline',
			'ha-devices': 'mdiDevices',
			'ha-entities': 'mdiShape',
			'ha-automations': 'mdiRobot',
			'ha-yaml': 'mdiHammer',
			'ha-template': 'squarePen',
			'ha-history': 'mdiChartBox',
			'ha-updates': 'mdiUpdate',
		});
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/menu-icons.test.mjs tests/menu-catalog.test.mjs`
Expected: FAIL — `missing mdiPuzzle` and the icon map in the catalog test differs (`package`, `fileText`, … instead of the `mdi*` names).

- [ ] **Step 3: Add the icons**

In `js/menu-icons.js`, directly before the line `	};` that closes the `icons` object (the line after the `rotateCcw` entry), insert:

```js
		// Material Design Icons (Apache-2.0, https://pictogrammers.com/library/mdi/) -
		// the icons Home Assistant itself draws for these pages. Path data is
		// byte-for-byte that of @mdi/js 7.4.47. Filled, unlike the strokes above.
		mdiPuzzle: mdi('puzzle', 'M20.5,11H19V7C19,5.89 18.1,5 17,5H13V3.5A2.5,2.5 0 0,0 10.5,1A2.5,2.5 0 0,0 8,3.5V5H4A2,2 0 0,0 2,7V10.8H3.5C5,10.8 6.2,12 6.2,13.5C6.2,15 5,16.2 3.5,16.2H2V20A2,2 0 0,0 4,22H7.8V20.5C7.8,19 9,17.8 10.5,17.8C12,17.8 13.2,19 13.2,20.5V22H17A2,2 0 0,0 19,20V16H20.5A2.5,2.5 0 0,0 23,13.5A2.5,2.5 0 0,0 20.5,11Z'),
		mdiDevices: mdi('devices', 'M3 6H21V4H3C1.9 4 1 4.9 1 6V18C1 19.1 1.9 20 3 20H7V18H3V6M13 12H9V13.78C8.39 14.33 8 15.11 8 16C8 16.89 8.39 17.67 9 18.22V20H13V18.22C13.61 17.67 14 16.88 14 16S13.61 14.33 13 13.78V12M11 17.5C10.17 17.5 9.5 16.83 9.5 16S10.17 14.5 11 14.5 12.5 15.17 12.5 16 11.83 17.5 11 17.5M22 8H16C15.5 8 15 8.5 15 9V19C15 19.5 15.5 20 16 20H22C22.5 20 23 19.5 23 19V9C23 8.5 22.5 8 22 8M21 18H17V10H21V18Z'),
		mdiShape: mdi('shape', 'M11,13.5V21.5H3V13.5H11M12,2L17.5,11H6.5L12,2M17.5,13C20,13 22,15 22,17.5C22,20 20,22 17.5,22C15,22 13,20 13,17.5C13,15 15,13 17.5,13Z'),
		mdiRobot: mdi('robot', 'M12,2A2,2 0 0,1 14,4C14,4.74 13.6,5.39 13,5.73V7H14A7,7 0 0,1 21,14H22A1,1 0 0,1 23,15V18A1,1 0 0,1 22,19H21V20A2,2 0 0,1 19,22H5A2,2 0 0,1 3,20V19H2A1,1 0 0,1 1,18V15A1,1 0 0,1 2,14H3A7,7 0 0,1 10,7H11V5.73C10.4,5.39 10,4.74 10,4A2,2 0 0,1 12,2M7.5,13A2.5,2.5 0 0,0 5,15.5A2.5,2.5 0 0,0 7.5,18A2.5,2.5 0 0,0 10,15.5A2.5,2.5 0 0,0 7.5,13M16.5,13A2.5,2.5 0 0,0 14,15.5A2.5,2.5 0 0,0 16.5,18A2.5,2.5 0 0,0 19,15.5A2.5,2.5 0 0,0 16.5,13Z'),
		mdiHammer: mdi('hammer', 'M2 19.63L13.43 8.2L12.72 7.5L14.14 6.07L12 3.89C13.2 2.7 15.09 2.7 16.27 3.89L19.87 7.5L18.45 8.91H21.29L22 9.62L18.45 13.21L17.74 12.5V9.62L16.27 11.04L15.56 10.33L4.13 21.76L2 19.63Z'),
		mdiTextBoxOutline: mdi('text-box-outline', 'M5,3C3.89,3 3,3.89 3,5V19C3,20.11 3.89,21 5,21H19C20.11,21 21,20.11 21,19V5C21,3.89 20.11,3 19,3H5M5,5H19V19H5V5M7,7V9H17V7H7M7,11V13H17V11H7M7,15V17H14V15H7Z'),
		mdiUpdate: mdi('update', 'M21,10.12H14.22L16.96,7.3C14.23,4.6 9.81,4.5 7.08,7.2C4.35,9.91 4.35,14.28 7.08,17C9.81,19.7 14.23,19.7 16.96,17C18.32,15.65 19,14.08 19,12.1H21C21,14.08 20.12,16.65 18.36,18.39C14.85,21.87 9.15,21.87 5.64,18.39C2.14,14.92 2.11,9.28 5.62,5.81C9.13,2.34 14.76,2.34 18.27,5.81L21,3V10.12M12.5,8V12.25L16,14.33L15.28,15.54L11,13V8H12.5Z'),
		mdiChartBox: mdi('chart-box', 'M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M9 17H7V10H9V17M13 17H11V7H13V17M17 17H15V13H17V17Z'),
```

and add the helper at the top of the factory, directly after the line `(function (root) {` (before the Lucide comment):

```js
	// Filled Material Design icon (viewBox 0 0 24 24, follows the menu's text colour).
	const mdi = (name, d) => `<svg class="mdi mdi-${name}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="${d}"/></svg>`;
```

- [ ] **Step 4: Point the catalog at them**

In `js/menu-catalog.js`, in the `homeassistant` entry change these `icon:` values (leave `ha-home` = `house` and `ha-template` = `squarePen`):

| item id | old | new |
|---|---|---|
| `ha-integrations` | `package` | `mdiPuzzle` |
| `ha-logs` | `fileText` | `mdiTextBoxOutline` |
| `ha-devices` | `hardDrive` | `mdiDevices` |
| `ha-entities` | `layoutList` | `mdiShape` |
| `ha-automations` | `timer` | `mdiRobot` |
| `ha-yaml` | `settings` | `mdiHammer` |
| `ha-history` | `history` | `mdiChartBox` |
| `ha-updates` | `download` | `mdiUpdate` |

- [ ] **Step 5: Attribution and the Apache-2.0 text**

Apache-2.0 §4(a) obliges a redistributor to hand recipients a copy of the license, and the other entries of this file carry their full text, so this one does too. Append the notice, then the license text itself, then the closing fence:

````bash
cat >> THIRD_PARTY_LICENSES.md <<'EOF'

---

## Material Design Icons

Eight icons in `js/menu-icons.js` (`mdiPuzzle`, `mdiDevices`, `mdiShape`, `mdiRobot`, `mdiHammer`, `mdiTextBoxOutline`, `mdiUpdate`, `mdiChartBox`) are taken unmodified from Material Design Icons (`@mdi/js` 7.4.47) by the Pictogrammers Community, https://pictogrammers.com/library/mdi/ . The icons are the ones Home Assistant itself shows for the matching pages. The collection is released under the Pictogrammers Free License, which places the icons under the Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0):

### License Text:

```text
EOF
curl -sSL https://www.apache.org/licenses/LICENSE-2.0.txt >> THIRD_PARTY_LICENSES.md
echo '```' >> THIRD_PARTY_LICENSES.md
````

Check: `grep -c "Apache License" THIRD_PARTY_LICENSES.md` is at least 1, the file's last line is the closing code fence, and `git diff --stat THIRD_PARTY_LICENSES.md` shows only additions. If `curl` cannot reach apache.org, any `LICENSE` file under `node_modules` that begins with `Apache License` (for example `node_modules/chrome-launcher/LICENSE`) holds the same canonical text — use `cat` on it instead.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/menu-icons.test.mjs tests/menu-catalog.test.mjs`
Expected: PASS.

- [ ] **Step 7: Run the full suite and commit**

Run: `npm test`
Expected: all suites PASS.

```bash
git add js/menu-icons.js js/menu-catalog.js THIRD_PARTY_LICENSES.md tests/menu-icons.test.mjs tests/menu-catalog.test.mjs
git commit -m "feat(menus): the Home Assistant menu uses Home Assistant's own icons

Eight Material Design Icons, byte-identical to @mdi/js 7.4.47, are
bundled next to the Lucide icons and referenced by name, so they show
on every page and an edited copy of the menu stays small. They also
appear in the icon picker.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `js/page-icons.js` — read the icon a page draws next to a link

**Files:**
- Create: `js/page-icons.js`
- Test: `tests/page-icons.test.mjs`

**Interfaces:**
- Produces (all on `FlowMousePageIcons`):
  - `sanitizePathData(d: unknown): string | null` — the trimmed string iff it is ≤ 4096 chars, starts with `M`/`m`, tokenizes completely into path-command letters, numbers and separators, and holds at least four numbers; else `null`.
  - `targetPath(url: string, pageUrl: string): string | null` — pathname of `url` without trailing slash (`'/'` stays `'/'`), or `null` if `url` is unparsable or on a different origin than `pageUrl`.
  - `pickEntry(entries: {path: string, d: string}[], path: string, allowPrefix?: (anchorPath: string, targetPath: string) => boolean): string | null` — `d` of the exact match, else (only if `allowPrefix` is given) of the longest anchor path that is a whole-segment prefix of `path` and for which `allowPrefix` returns true; else `null`.
  - `collect(root, pageUrl): {path: string, d: string}[]` — walks `root` and every open shadow root below it; inspects at most 1500 `a[href]`; resolves each against `a.baseURI` (falling back to `pageUrl`) and keeps those on the page's origin; takes the first `svg path[d]` inside the anchor (including its own shadow root) or, failing that, inside the anchor's shadow host — the latter only when the anchor is the sole link in its shadow root; keeps only sanitized data; first entry per path wins.
  - `providers: {id: string, applies(root): boolean, allowPrefix(anchorPath, targetPath): boolean}[]` — filled by provider files.
  - `createFinder(pageUrl: string, root: object, replaceUrl?: (template: string, tab: {url: string}) => string): (item: object) => {iconPath: string} | {iconName: 'link'}` — lazy (scans at most once, on first call); resolves `item.customUrl` through `replaceUrl` (default: identity) against `pageUrl`, picks the entry with the first applicable provider's `allowPrefix` (exact-only without provider) and returns `{iconPath}` or the fallback `{iconName: 'link'}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/page-icons.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import '../js/page-icons.js';
const P = globalThis.FlowMousePageIcons;

// A hand-made DOM: nodes expose querySelectorAll, an optional open shadowRoot
// and getRootNode(); only what page-icons.js touches. Selectors are modelled
// strictly - 'svg path[d]' needs an <svg> ancestor.
function node({ tag = 'div', attrs = {}, children = [], shadow = null } = {}) {
	const n = { tag, attrs, children, shadowRoot: shadow, parent: null, root: null,
		getAttribute: (k) => (k in attrs ? attrs[k] : null),
		getRootNode: () => n.root || n,
		querySelectorAll(sel) {
			const out = [];
			const walk = (c) => { for (const k of c.children) { if (match(k, sel)) out.push(k); walk(k); } };
			walk(n);
			return out;
		},
	};
	for (const c of children) c.parent = n;
	return n;
}
function match(n, sel) {
	if (sel === 'a[href]') return n.tag === 'a' && 'href' in n.attrs;
	if (sel === 'svg path[d]') {
		if (n.tag !== 'path' || !('d' in n.attrs)) return false;
		for (let p = n.parent; p; p = p.parent) if (p.tag === 'svg') return true;
		return false;
	}
	if (sel === '*') return true;
	return false;
}
const path = (d) => node({ tag: 'svg', children: [node({ tag: 'path', attrs: { d } })] });
const D = 'M12,2A2,2 0 0,1 14,4Z';

describe('sanitizePathData', () => {
	it('accepts ordinary path data and trims it', () => {
		expect(P.sanitizePathData('  ' + D + ' ')).toBe(D);
		expect(P.sanitizePathData('M2 19.63L13.43 8.2h-3.5e-1Z')).toBe('M2 19.63L13.43 8.2h-3.5e-1Z');
		expect(P.sanitizePathData('M3.5.5L1 1')).toBe('M3.5.5L1 1');
	});
	it('rejects markup, scripts and anything not path data', () => {
		for (const bad of ['', '   ', null, undefined, 42, {}, 'L1 1', '<svg>', 'M1 1"><script>x</script>',
			'M1 1 onload=alert(1)', 'M1,1 url(javascript:x)', "M1 1'", 'M1 1;', 'M0 0 </path>', 'M1 1e']) {
			expect(P.sanitizePathData(bad), String(bad)).toBeNull();
		}
	});
	it('rejects paths too short to draw anything, so the fallback icon shows instead of an empty one', () => {
		for (const bad of ['M', 'Mz', 'M1', 'M1 2', 'M1 2 3', 'M1 2Z']) {
			expect(P.sanitizePathData(bad), bad).toBeNull();
		}
		expect(P.sanitizePathData('M1 2L3 4')).toBe('M1 2L3 4');
	});
	it('rejects a huge string', () => {
		expect(P.sanitizePathData('M' + '1 '.repeat(3000))).toBeNull();
		expect(P.sanitizePathData('M' + '1 '.repeat(1500))).not.toBeNull();
	});
});

describe('targetPath', () => {
	const page = 'https://assi.home.schep.de/home/overview';
	it('returns the path of a same-origin url without query, fragment or trailing slash', () => {
		expect(P.targetPath('https://assi.home.schep.de/energie-2/energie?x=1#y', page)).toBe('/energie-2/energie');
		expect(P.targetPath('https://assi.home.schep.de/config/', page)).toBe('/config');
		expect(P.targetPath('https://assi.home.schep.de/', page)).toBe('/');
	});
	it('refuses another origin (host, port or scheme) and broken input', () => {
		expect(P.targetPath('https://other.example/config', page)).toBeNull();
		expect(P.targetPath('https://assi.home.schep.de:8123/config', page)).toBeNull();
		expect(P.targetPath('http://assi.home.schep.de/config', page)).toBeNull();
		expect(P.targetPath('not a url', page)).toBeNull();
		expect(P.targetPath('/config', page)).toBeNull();
		expect(P.targetPath('https://assi.home.schep.de/x', 'garbage')).toBeNull();
	});
});

describe('pickEntry', () => {
	const entries = [
		{ path: '/config', d: 'M1Z' }, { path: '/config/tools', d: 'M2Z' },
		{ path: '/energie-2', d: 'M3Z' }, { path: '/energie-2/energie', d: 'M4Z' },
	];
	const prefixOk = () => true;
	it('prefers the exact match', () => {
		expect(P.pickEntry(entries, '/energie-2/energie')).toBe('M4Z');
		expect(P.pickEntry(entries, '/energie-2/energie', prefixOk)).toBe('M4Z');
	});
	it('without a prefix rule only exact matches count', () => {
		expect(P.pickEntry(entries, '/energie-2/neu')).toBeNull();
	});
	it('with a prefix rule takes the longest whole-segment prefix', () => {
		expect(P.pickEntry(entries, '/config/tools/yaml', prefixOk)).toBe('M2Z');
		expect(P.pickEntry(entries, '/energie-2/neu', prefixOk)).toBe('M3Z');
	});
	it('never matches inside a segment', () => {
		expect(P.pickEntry([{ path: '/energie', d: 'M1Z' }], '/energie-2', prefixOk)).toBeNull();
	});
	it('lets the rule veto a prefix', () => {
		expect(P.pickEntry(entries, '/config/logs', (a) => a !== '/config')).toBeNull();
	});
	it('handles empty input', () => {
		expect(P.pickEntry([], '/x', prefixOk)).toBeNull();
		expect(P.pickEntry(entries, null, prefixOk)).toBeNull();
	});
});

describe('collect', () => {
	const page = 'https://ha.example/home';
	it('takes the icon inside the anchor', () => {
		const a = node({ tag: 'a', attrs: { href: '/config/entities' }, children: [path(D)] });
		const root = node({ children: [a] });
		expect(P.collect(root, page)).toEqual([{ path: '/config/entities', d: D }]);
	});
	it('ignores a <path> that is not inside an <svg>', () => {
		const orphan = node({ tag: 'a', attrs: { href: '/o' }, children: [node({ tag: 'path', attrs: { d: D } })] });
		expect(P.collect(node({ children: [orphan] }), page)).toEqual([]);
	});
	it('takes the icon from the shadow host when the anchor is the only link in its shadow root', () => {
		const a = node({ tag: 'a', attrs: { href: '/energie-2' } });
		const shadow = node({ children: [a] });
		a.root = shadow;
		const host = node({ tag: 'ha-list-item-button', children: [path(D)], shadow });
		shadow.host = host;
		const root = node({ children: [host] });
		expect(P.collect(root, page)).toEqual([{ path: '/energie-2', d: D }]);
	});
	it('does not hand one unrelated icon to every link of a component', () => {
		const a1 = node({ tag: 'a', attrs: { href: '/one' } });
		const a2 = node({ tag: 'a', attrs: { href: '/two' } });
		const shadow = node({ children: [a1, a2] });
		a1.root = shadow; a2.root = shadow;
		const host = node({ tag: 'nav-bar', children: [path(D)], shadow });
		shadow.host = host;
		expect(P.collect(node({ children: [host] }), page)).toEqual([]);
	});
	it('descends into nested open shadow roots to find the path', () => {
		const inner = node({ children: [path(D)] });
		const icon = node({ tag: 'ha-svg-icon', shadow: inner });
		const a = node({ tag: 'a', attrs: { href: '/map' }, children: [icon] });
		expect(P.collect(node({ children: [a] }), page)).toEqual([{ path: '/map', d: D }]);
	});
	it('skips other origins, hostile data and anchors without any icon; first entry per path wins', () => {
		const other = node({ tag: 'a', attrs: { href: 'https://evil.example/config' }, children: [path(D)] });
		const bad = node({ tag: 'a', attrs: { href: '/bad' }, children: [path('M1 1"><script>')] });
		const none = node({ tag: 'a', attrs: { href: '/none' } });
		const a1 = node({ tag: 'a', attrs: { href: '/dup' }, children: [path('M1 1L2 2Z')] });
		const a2 = node({ tag: 'a', attrs: { href: '/dup/' }, children: [path('M3 3L4 4Z')] });
		const out = P.collect(node({ children: [other, bad, none, a1, a2] }), page);
		expect(out).toEqual([{ path: '/dup', d: 'M1 1L2 2Z' }]);
	});
	it('resolves links with the real base URL, so a <base> pointing elsewhere is not same-origin', () => {
		const foreign = node({ tag: 'a', attrs: { href: '/dashboard' }, children: [path(D)] });
		foreign.baseURI = 'https://foreign.example/';
		expect(P.collect(node({ children: [foreign] }), page)).toEqual([]);
		const local = node({ tag: 'a', attrs: { href: '/dashboard' }, children: [path(D)] });
		local.baseURI = 'https://ha.example/some/dir/';
		expect(P.collect(node({ children: [local] }), page)).toEqual([{ path: '/dashboard', d: D }]);
	});
	it('inspects at most 1500 links', () => {
		const anchors = Array.from({ length: 3000 }, (_, i) =>
			node({ tag: 'a', attrs: { href: '/p' + i }, children: [path(D)] }));
		expect(P.collect(node({ children: anchors }), page)).toHaveLength(1500);
	});
	it('does not throw on an anchor whose root node has no host', () => {
		const a = node({ tag: 'a', attrs: { href: '/x' } });
		expect(() => P.collect(node({ children: [a] }), page)).not.toThrow();
		expect(P.collect(node({ children: [a] }), page)).toEqual([]);
	});
});

describe('createFinder', () => {
	const page = 'https://ha.example/home';
	const a = node({ tag: 'a', attrs: { href: '/energie-2' }, children: [path(D)] });
	const root = node({ children: [a] });
	it('returns the icon path for a link the page shows an icon for', () => {
		const find = P.createFinder(page, root);
		expect(find({ customUrl: 'https://ha.example/energie-2' })).toEqual({ iconPath: D });
	});
	it('falls back to the link icon when nothing matches', () => {
		const find = P.createFinder(page, root);
		expect(find({ customUrl: 'https://ha.example/unknown' })).toEqual({ iconName: 'link' });
		expect(find({ customUrl: 'https://other.example/energie-2' })).toEqual({ iconName: 'link' });
		expect(find({ customUrl: '' })).toEqual({ iconName: 'link' });
		expect(find({})).toEqual({ iconName: 'link' });
	});
	it('resolves placeholders against the page before matching', () => {
		const replace = (t, tab) => t.replace('{tabOrigin:raw}', new URL(tab.url).origin);
		const find = P.createFinder(page, root, replace);
		expect(find({ customUrl: '{tabOrigin:raw}/energie-2' })).toEqual({ iconPath: D });
	});
	it('scans lazily and only once', () => {
		let scans = 0;
		const counting = { querySelectorAll(sel) { scans++; return root.querySelectorAll(sel); } };
		const find = P.createFinder(page, counting);
		expect(scans).toBe(0);
		find({ customUrl: 'https://ha.example/energie-2' });
		const afterFirst = scans;
		find({ customUrl: 'https://ha.example/map' });
		find({ customUrl: 'https://ha.example/energie-2' });
		expect(scans).toBe(afterFirst);
	});
	it('uses the first provider that applies for prefix matches', () => {
		const sub = node({ tag: 'a', attrs: { href: '/energie-2' }, children: [path('M9 9L1 1Z')] });
		const r = node({ children: [sub] });
		const link = { customUrl: 'https://ha.example/energie-2/energie' };
		expect(P.createFinder(page, r)(link)).toEqual({ iconName: 'link' });
		P.providers.push({ id: 'test', applies: () => true, allowPrefix: () => true });
		try {
			expect(P.createFinder(page, r)(link)).toEqual({ iconPath: 'M9 9L1 1Z' });
		} finally { P.providers.pop(); }
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/page-icons.test.mjs`
Expected: FAIL — `FlowMousePageIcons` is undefined (the import of `../js/page-icons.js` fails: file missing).

- [ ] **Step 3: Implement `js/page-icons.js`**

Create `js/page-icons.js`:

```js
(function (root) {
	// "Icon of the page": read the SVG path a page draws next to a link, so a
	// menu entry can wear the same icon. Content-script side, runs only when a
	// menu opens and an item asks for it. Only the path data (the `d` string)
	// leaves this file, after validation - the menu builds its own <svg>, page
	// markup never enters the menu.

	const MAX_PATH_LENGTH = 4096;
	const MAX_LINKS = 1500;
	const MIN_NUMBERS = 4;
	// A path is a run of commands, numbers and separators - nothing else, so
	// nothing that could close an attribute or start markup.
	const PATH_TOKENS = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[\s,]+/g;
	const PATH_NUMBERS = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

	function sanitizePathData(d) {
		if (typeof d !== 'string') return null;
		const s = d.trim();
		if (!s || s.length > MAX_PATH_LENGTH || !/^[Mm]/.test(s)) return null;
		if (s.replace(PATH_TOKENS, '') !== '') return null;
		// Too few numbers cannot draw anything; show the fallback icon instead of
		// an empty one.
		if ((s.match(PATH_NUMBERS) || []).length < MIN_NUMBERS) return null;
		return s;
	}

	function normalizePath(p) {
		return p.length > 1 ? p.replace(/\/+$/, '') || '/' : p;
	}

	// Path of `url` on the page's own origin; null for anything else. Icons are
	// never looked up for other sites.
	function targetPath(url, pageUrl) {
		try {
			const u = new URL(url);
			if (u.origin === 'null' || u.origin !== new URL(pageUrl).origin) return null;
			return normalizePath(u.pathname);
		} catch { return null; }
	}

	function isSegmentPrefix(anchorPath, path) {
		if (anchorPath === '/') return true;
		return path === anchorPath || path.startsWith(anchorPath + '/');
	}

	function pickEntry(entries, path, allowPrefix) {
		if (!path || !entries || !entries.length) return null;
		const exact = entries.find(e => e.path === path);
		if (exact) return exact.d;
		if (typeof allowPrefix !== 'function') return null;
		let best = null;
		for (const e of entries) {
			if (e.path === path || !isSegmentPrefix(e.path, path) || !allowPrefix(e.path, path)) continue;
			if (!best || e.path.length > best.path.length) best = e;
		}
		return best ? best.d : null;
	}

	// querySelectorAll over `node` and over every open shadow root below it.
	function deep(node, sel, out) {
		out = out || [];
		if (!node || typeof node.querySelectorAll !== 'function') return out;
		for (const e of node.querySelectorAll(sel)) out.push(e);
		for (const e of node.querySelectorAll('*')) if (e.shadowRoot) deep(e.shadowRoot, sel, out);
		return out;
	}

	function iconDataOf(anchor) {
		let p = deep(anchor, 'svg path[d]')[0]
			|| (anchor.shadowRoot && deep(anchor.shadowRoot, 'svg path[d]')[0]);
		if (!p) {
			// Material list items keep the icon in a slot of the element that hosts
			// the anchor's shadow root. That icon is the anchor's own only if the
			// anchor is the sole link in there - with several links the host's SVG
			// could belong to any of them (or to none).
			const rootNode = typeof anchor.getRootNode === 'function' ? anchor.getRootNode() : null;
			const host = rootNode && rootNode.host;
			if (host && typeof rootNode.querySelectorAll === 'function'
				&& rootNode.querySelectorAll('a[href]').length === 1) {
				p = deep(host, 'svg path[d]')[0];
			}
		}
		return p ? sanitizePathData(p.getAttribute('d')) : null;
	}

	function collect(rootNode, pageUrl) {
		const entries = [];
		const seen = new Set();
		let inspected = 0;
		for (const a of deep(rootNode, 'a[href]')) {
			if (++inspected > MAX_LINKS) break;
			let href;
			// baseURI honours <base href>, so this is the address the browser
			// would really follow.
			try { href = new URL(a.getAttribute('href'), a.baseURI || pageUrl).href; } catch { continue; }
			const path = targetPath(href, pageUrl);
			if (!path || seen.has(path)) continue;
			const d = iconDataOf(a);
			if (!d) continue;
			seen.add(path);
			entries.push({ path, d });
		}
		return entries;
	}

	// Site-specific rules (see page-icons-homeassistant.js) register here.
	const providers = [];

	function createFinder(pageUrl, rootNode, replaceUrl) {
		let entries = null;
		let allowPrefix;
		return function find(item) {
			const fallback = { iconName: 'link' };
			const template = item && typeof item.customUrl === 'string' ? item.customUrl : '';
			if (!template) return fallback;
			let url;
			try { url = replaceUrl ? replaceUrl(template, { url: pageUrl }) : template; } catch { return fallback; }
			const path = targetPath(url, pageUrl);
			if (!path) return fallback;
			if (!entries) {
				try {
					entries = collect(rootNode, pageUrl);
					const provider = providers.find(p => { try { return p.applies(rootNode); } catch { return false; } });
					allowPrefix = provider ? provider.allowPrefix : undefined;
				} catch { entries = []; }
			}
			const d = pickEntry(entries, path, allowPrefix);
			return d ? { iconPath: d } : fallback;
		};
	}

	const api = { sanitizePathData, targetPath, pickEntry, collect, createFinder, providers };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMousePageIcons = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/page-icons.test.mjs`
Expected: PASS. If a test fails because of the fake DOM (not the code), fix the fake in the test file — `node()` must only model what `page-icons.js` reads.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: all suites PASS.

```bash
git add js/page-icons.js tests/page-icons.test.mjs
git commit -m "feat(icons): read the icon a page draws next to a link

A generic, content-side module: collects (path -> SVG path data) pairs
from the page's links across open shadow roots, validates the data,
and answers which icon belongs to a menu entry's target. Same-origin
links only; only the validated path string leaves the module.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Home Assistant rules and registration as content scripts

**Files:**
- Create: `js/page-icons-homeassistant.js`
- Modify: `manifest.json` (two entries in `content_scripts[0].js`)
- Modify: `pages/options.html`, `pages/about.html`, `pages/css-editor.html` (each loads `js/content.js` as a classic script and therefore needs the same two scripts before it)
- Test: `tests/page-icons-homeassistant.test.mjs`, `tests/load-order.test.mjs`, `tests/page-content-deps.test.mjs`

**Interfaces:**
- Consumes: `FlowMousePageIcons.providers` (Task 2).
- Produces: a provider `{ id: 'homeassistant', applies(root), allowPrefix(anchorPath, targetPath) }` pushed onto `providers`; `FlowMouseHomeAssistantIcons` (the provider itself, for tests).

- [ ] **Step 1: Write the failing tests**

Create `tests/page-icons-homeassistant.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import '../js/page-icons.js';
import '../js/page-icons-homeassistant.js';
const P = globalThis.FlowMousePageIcons;
const HA = globalThis.FlowMouseHomeAssistantIcons;

describe('home assistant provider', () => {
	it('registers itself with the generic module', () => {
		expect(P.providers).toContain(HA);
		expect(HA.id).toBe('homeassistant');
	});
	it('applies to a document that contains the <home-assistant> root element', () => {
		expect(HA.applies({ querySelector: (s) => (s === 'home-assistant' ? {} : null) })).toBe(true);
		expect(HA.applies({ querySelector: () => null })).toBe(false);
		expect(HA.applies({})).toBe(false);
	});
	it('lets a dashboard view fall back to its sidebar entry', () => {
		expect(HA.allowPrefix('/energie-2', '/energie-2/energie')).toBe(true);
		expect(HA.allowPrefix('/dashboard-esszimmer', '/dashboard-esszimmer/heizung-led')).toBe(true);
		expect(HA.allowPrefix('/home', '/home/overview')).toBe(true);
	});
	it('lets a deeper settings page fall back to its section', () => {
		expect(HA.allowPrefix('/config/integrations', '/config/integrations/dashboard')).toBe(true);
		expect(HA.allowPrefix('/config/tools', '/config/tools/yaml')).toBe(true);
	});
	it('never borrows the settings gear (/config) or the root for another page', () => {
		expect(HA.allowPrefix('/config', '/config/logs')).toBe(false);
		expect(HA.allowPrefix('/config', '/config/integrations/dashboard')).toBe(false);
		expect(HA.allowPrefix('/', '/config/logs')).toBe(false);
	});
	it('end to end: Config links on a dashboard page stay generic, dashboard views get the sidebar icon', () => {
		const entries = [
			{ path: '/config', d: 'M1Z' },      // sidebar: settings gear
			{ path: '/energie-2', d: 'M3Z' },   // sidebar: a dashboard
			{ path: '/history', d: 'M5Z' },
		];
		expect(P.pickEntry(entries, '/config/logs', HA.allowPrefix)).toBeNull();
		expect(P.pickEntry(entries, '/config', HA.allowPrefix)).toBe('M1Z');       // exact still works
		expect(P.pickEntry(entries, '/energie-2/energie', HA.allowPrefix)).toBe('M3Z');
		expect(P.pickEntry(entries, '/history', HA.allowPrefix)).toBe('M5Z');
	});
});
```

In `tests/load-order.test.mjs`, inside `describe('manifest.json content scripts', …)` append:

```js
	// Both are classic scripts content.js reads at menu open; a missing or late
	// entry shows up only as "FlowMousePageIcons is not defined" in every frame.
	it('loads the page-icon scripts before content.js, generic part first', () => {
		const i = (f) => list.indexOf(f);
		expect(i('js/page-icons.js')).toBeGreaterThan(-1);
		expect(i('js/page-icons-homeassistant.js')).toBeGreaterThan(i('js/page-icons.js'));
		expect(i('js/content.js')).toBeGreaterThan(i('js/page-icons-homeassistant.js'));
	});
```

In `tests/page-content-deps.test.mjs`, add the two scripts to `REQUIRED_BEFORE_CONTENT` (after `'menu-model.js',`). The test then demands them, before `content.js`, on every page that loads `content.js`:

```js
	'page-icons.js',
	'page-icons-homeassistant.js',
```

The list is static: without this edit the test stays green on pages that lack the scripts, and a menu holding an `icon: 'page'` entry would throw `FlowMousePageIcons is not defined` there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/page-icons-homeassistant.test.mjs tests/load-order.test.mjs tests/page-content-deps.test.mjs`
Expected: FAIL — `js/page-icons-homeassistant.js` missing; the load-order test reports `-1`; `page-content-deps` names `options.html`, `about.html` and `css-editor.html` as missing `page-icons.js` and `page-icons-homeassistant.js`.

- [ ] **Step 3: Implement the provider**

Create `js/page-icons-homeassistant.js`:

```js
(function (root) {
	// Home Assistant specifics for page-icons.js.
	//
	// Dashboards live at /<dashboard>/<view>, and the sidebar draws one entry,
	// /<dashboard>, for all of its views - so a view may borrow that icon. The
	// settings pages are different: every /config/<section> is its own page, and
	// the sidebar's /config entry is the settings gear, which would otherwise
	// be painted onto every settings link whose own icon is not on screen.
	const FlowMouseHomeAssistantIcons = {
		id: 'homeassistant',
		applies(rootNode) {
			return !!(rootNode && typeof rootNode.querySelector === 'function'
				&& rootNode.querySelector('home-assistant'));
		},
		allowPrefix(anchorPath) {
			return anchorPath !== '/' && anchorPath !== '/config';
		},
	};
	if (root.FlowMousePageIcons) root.FlowMousePageIcons.providers.push(FlowMouseHomeAssistantIcons);
	const api = FlowMouseHomeAssistantIcons;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseHomeAssistantIcons = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Register both scripts**

In `manifest.json`, in `content_scripts[0].js`, insert after `"js/menu-model.js",` and before `"js/eu-bridge.js",`:

```json
                "js/page-icons.js",
                "js/page-icons-homeassistant.js",
```

(the file uses 4-space JSON indentation — match the neighbours).

In each of `pages/options.html`, `pages/about.html`, `pages/css-editor.html`, insert directly after the line `<script src="../js/menu-model.js"></script>` (and so before the `content.js` line):

```html
	<script src="../js/page-icons.js"></script>
	<script src="../js/page-icons-homeassistant.js"></script>
```

(tab-indented like the neighbouring lines).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/page-icons-homeassistant.test.mjs tests/load-order.test.mjs tests/page-content-deps.test.mjs tests/page-icons.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test`
Expected: all suites PASS.

```bash
git add js/page-icons-homeassistant.js manifest.json pages/options.html pages/about.html pages/css-editor.html tests/page-icons-homeassistant.test.mjs tests/load-order.test.mjs tests/page-content-deps.test.mjs
git commit -m "feat(icons): Home Assistant rules for page icons

A dashboard view borrows its sidebar entry's icon; the settings gear
(/config) is never lent to another settings page. Both scripts are
registered as content scripts ahead of content.js.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Show the page icon in the menu

**Files:**
- Modify: `js/content.js` (~L3906-3951, `buildItems`; ~L654-657, `setItems` serializer)
- Modify: `js/context-menu.js` (~L595-597, the item icon)
- Modify: `js/components/icon-picker.js`
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json` (one key `iconPickerPage`), `tests/site-menu-locales.test.mjs`
- Test: none for `content.js`/`context-menu.js` (no unit tests exist for them) — verified in Task 6; the logic that decides the icon is already covered by Task 2.

**Interfaces:**
- Consumes: `FlowMousePageIcons.createFinder(pageUrl, root, replaceUrl) → (item) => {iconPath} | {iconName}` (Task 2), `FlowMouseSearchUrl.replaceUrlPlaceholders` (existing, loaded before `content.js`). The finder reads the top-level page when it is same-origin accessible and is skipped otherwise (design decision above).
- Produces: runtime menu item field `iconPath: string` (validated path data, never stored in settings); icon value `'page'` selectable in the icon picker; message key `iconPickerPage`.

- [ ] **Step 1: Resolve `page` icons in `content.js`**

In `buildItems` (the function containing `.map(it => { if (it.type === 'separator') return 'separator'; …`), add before `return resolved.items`:

```js
							// Entries set to "icon of the page" are looked up once per menu
							// build, and only if there is such an entry - the scan walks the
							// page's shadow roots. A menu is built in the frame the gesture
							// started in, but a link opens against the top-level tab, so the
							// lookup reads the top-level page too: from a same-origin iframe
							// (an add-on page) that is where the sidebar lives; from a
							// cross-origin frame there is nothing to look at, link icons stay.
							const pageIconFor = resolved.items.some(i => i && i.icon === 'page')
								? (() => {
									let topWin = null;
									try { if (window.top.location.origin === location.origin) topWin = window.top; } catch { /* cross-origin top */ }
									if (!topWin) return () => ({ iconName: 'link' });
									return window.FlowMousePageIcons.createFinder(
										topWin.location.href, topWin.document, window.FlowMouseSearchUrl.replaceUrlPlaceholders);
								})()
								: null;
```

and replace the block

```js
								// Icon-Feld: Lucide-Name oder 'favicon' (Ziel-URL-Favicon)
								if (it.icon && it.icon !== 'favicon') {
									entry.iconName = it.icon;
								} else if (it.icon === 'favicon') {
```

with

```js
								// Icon field: Lucide name, 'favicon' (favicon of the target URL) or
								// 'page' (the icon the page itself shows next to the link)
								if (it.icon === 'page') {
									Object.assign(entry, pageIconFor ? pageIconFor(it) : { iconName: 'link' });
								} else if (it.icon && it.icon !== 'favicon') {
									entry.iconName = it.icon;
								} else if (it.icon === 'favicon') {
```

In the `setItems` serializer (~L656) change

```js
			return { label: item.label, icon: item.icon, iconName: item.iconName, active: item.active, time: item.time };
```

to

```js
			return { label: item.label, icon: item.icon, iconName: item.iconName, iconPath: item.iconPath, active: item.active, time: item.time };
```

- [ ] **Step 2: Draw it in the menu iframe**

In `js/context-menu.js` (~L595), change

```js
								${item.iconName && globalThis.FlowMouseMenuIcons?.[item.iconName]
									? unsafeHTML(globalThis.FlowMouseMenuIcons[item.iconName])
									: item.icon ? html`<img src="${item.icon}" alt="" draggable="false">` : ''}
```

to

```js
								${item.iconName && globalThis.FlowMouseMenuIcons?.[item.iconName]
									? unsafeHTML(globalThis.FlowMouseMenuIcons[item.iconName])
									: typeof item.iconPath === 'string' && item.iconPath
										// Path data only, bound as an attribute; the frame builds the SVG.
										? html`<svg viewBox="0 0 24 24" fill="currentColor"><path d=${item.iconPath}></path></svg>`
										: item.icon ? html`<img src="${item.icon}" alt="" draggable="false">` : ''}
```

The existing `.fm-ctx-icon svg` rule (16 × 16, block) sizes it.

- [ ] **Step 3: The picker**

In `js/components/icon-picker.js`:
- in `render()` change `const current = this.value && this.value !== 'favicon' ? icons[this.value] : null;` to `const current = this.value && this.value !== 'favicon' && this.value !== 'page' ? icons[this.value] : null;`
- change the trigger placeholder `${this.value === 'favicon' ? 'FAV' : '—'}` to `${this.value === 'favicon' ? 'FAV' : this.value === 'page' ? 'PG' : '—'}`
- add a third button in `.special-row` between "favicon" and "none":

```js
						<button type="button" class="btn btn-ghost" @click=${() => this.#pick('page')}>
							${i18n.getMessage('iconPickerPage')}
						</button>
```

- update the file's header comment to `'favicon' (Favicon der Ziel-URL), 'page' (Icon, das die Seite zeigt) oder '' (kein Icon).`

Add the message, after `iconPickerFavicon` in both locale files:

`_locales/en/messages.json`:
```json
	"iconPickerPage": {
		"message": "Page icon",
		"description": "Icon picker button: use the icon the current page shows next to the link"
	},
```
`_locales/de/messages.json`:
```json
	"iconPickerPage": {
		"message": "Seiten-Icon",
		"description": "Icon picker button: use the icon the current page shows next to the link"
	},
```

and in `tests/site-menu-locales.test.mjs` append `'iconPickerPage'` to `PENDING_TRANSLATION` (before the closing `]`).

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: all suites PASS (`site-menu-locales`, `locale-placeholders`, `load-order`, `page-content-deps` included).

- [ ] **Step 5: Commit**

```bash
git add js/content.js js/context-menu.js js/components/icon-picker.js _locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs
git commit -m "feat(menus): icon mode 'page' shows the icon the page draws for a link

Looked up once per menu build and only if an entry uses it; the menu
frame builds the SVG from the validated path string. Falls back to the
link icon. Selectable in the icon picker.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Pages added to a relative menu get the page icon by default

**Files:**
- Modify: `js/menu-model.js` (`addLinkToMenu`)
- Modify: `CHANGELOG.md`
- Test: `tests/menu-model.test.mjs`

**Interfaces:**
- Consumes: `storedLinkUrl` / origin-relative detection already in `js/menu-model.js` (commit `ed8051b`).
- Produces: items added to an origin-relative menu from the page's own origin get `icon: 'page'`; all others keep `icon: 'link'`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('links in origin-relative menus', …)` block in `tests/menu-model.test.mjs`:

```js
	it('a page added relative to the instance wears the page icon; everything else keeps the link icon', () => {
		const rel = M.addLinkToMenu(CATALOG, REL, 'ha', { label: 'E', url: PAGE, pageUrl: PAGE }).added;
		expect(rel.icon).toBe('page');
		const foreign = M.addLinkToMenu(CATALOG, REL, 'ha', { label: 'G', url: 'https://grafana.example/d/abc', pageUrl: PAGE }).added;
		expect(foreign.icon).toBe('link');
		const ordinary = M.addLinkToMenu(CATALOG, EMPTY, 'gh', { label: 'B', url: 'https://github.com/a/b', pageUrl: 'https://github.com/a/b' }).added;
		expect(ordinary.icon).toBe('link');
		const explicit = M.addLinkToMenu(CATALOG, REL, 'ha', { label: 'E', url: PAGE, pageUrl: PAGE, icon: 'star' }).added;
		expect(explicit.icon).toBe('star');
	});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/menu-model.test.mjs`
Expected: FAIL — `expected 'link' to be 'page'`.

- [ ] **Step 3: Implement**

In `js/menu-model.js` `addLinkToMenu`, compute the stored URL once and derive the icon. Replace

```js
		const item = {
			id: o.id || newItemId(),
			action: 'openCustomUrl',
			customUrl: storedLinkUrl(base, o.url, o.pageUrl),
			customName: o.label || o.url,
			icon: o.icon || 'link',
		};
```

with

```js
		const stored = storedLinkUrl(base, o.url, o.pageUrl);
		const item = {
			id: o.id || newItemId(),
			action: 'openCustomUrl',
			customUrl: stored,
			customName: o.label || o.url,
			// A link kept relative to the instance is one the page itself draws an
			// icon for (a dashboard in Home Assistant's sidebar).
			icon: o.icon || (stored !== o.url ? 'page' : 'link'),
		};
```

(Read the surrounding lines first — the object literal's exact text is in the file; keep its other properties as they are.)

- [ ] **Step 4: Changelog**

In `CHANGELOG.md`, in the Home Assistant entry under `### Unreleased`, after the sentence "Pages you add to it are stored relative to the instance, so they survive a change of address.", add: "They also wear the icon Home Assistant shows for them in its sidebar (icon mode *Page icon*, also selectable in the icon picker for any entry); the fixed entries use Home Assistant's own icons."

- [ ] **Step 5: Run the tests and commit**

Run: `npm test`
Expected: all suites PASS.

```bash
git add js/menu-model.js tests/menu-model.test.mjs CHANGELOG.md
git commit -m "feat(menus): pages added relative to the instance default to the page icon

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Verify against the real Test-HA

The new code reads a live Home Assistant DOM, which the unit tests only imitate. This task has no commit; it records evidence. Prerequisite: the MCP Chrome is logged in to `http://127.0.0.1:8124` (user `testbench`).

- [ ] **Step 1: Run the real modules against the real page**

For each of the two files, read it with `Read` and execute the combined source in the page via `mcp__plugin_chrome-devtools-mcp_chrome-devtools__evaluate_script` — one call whose function body is the concatenation of `js/page-icons.js`, `js/page-icons-homeassistant.js` and the check below (the files use `typeof self !== 'undefined' ? self : globalThis`, so they define the globals on `window`; the replaceUrl argument is `FlowMouseSearchUrl.replaceUrlPlaceholders` loaded the same way from `js/search-url.js`):

```js
const find = FlowMousePageIcons.createFinder(location.href, document, FlowMouseSearchUrl.replaceUrlPlaceholders);
const origin = location.origin;
const at = (p) => find({ customUrl: '{tabOrigin:raw}' + p });
return {
	providerApplies: FlowMouseHomeAssistantIcons.applies(document),
	dashboard: at('/energie-2/energie'),
	dashboardRoot: at('/allgemein-strom'),
	history: at('/history'),
	configLogsFromDashboard: at('/config/logs'),
	unknown: at('/gibt-es-nicht/x'),
	otherOrigin: find({ customUrl: 'https://example.com/energie-2' }),
	ms: (() => { const t = performance.now(); FlowMousePageIcons.createFinder(location.href, document)({ customUrl: origin + '/history' }); return Math.round(performance.now() - t); })(),
};
```

Expected on the dashboard page `/home/overview`:
- `providerApplies: true`
- `dashboard`, `dashboardRoot`, `history`: `{ iconPath: "M…" }` (a path, matching what the sidebar shows — for `history` exactly `M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M9 17H7V10H9V17M13 17H11V7H13V17M17 17H15V13H17V17Z`)
- `configLogsFromDashboard`: `{ iconName: "link" }` — **not** the gear
- `unknown`, `otherOrigin`: `{ iconName: "link" }`
- `ms` below roughly 100. If it is far higher, report the number — the scan would then need a cheaper entry point (the sidebar element only) before release.

(The Test-HA's sidebar has entries such as `/energie-2` and `/allgemein-strom`; if they are gone, pick two from the sidebar's `a[href]` list.)

- [ ] **Step 2: Repeat on a settings page**

Navigate the MCP page to `/config/integrations/dashboard` and run the same block with `at('/config/devices/dashboard')`, `at('/config/entities')`, `at('/config/logs')`.
Expected: devices and entities → `iconPath` (tab bar), logs → `{ iconName: "link" }` (no `/config/logs` link on that page, the `/config` gear is vetoed).

- [ ] **Step 3: A gesture inside a same-origin iframe uses the top-level page**

The menu is built in the frame the gesture started in; the plan makes its icon lookup read the top-level page when that is same-origin. Reproduce the decision with a real same-origin frame (the login page is light and has no sidebar), in the same `evaluate_script` context as Step 1 (modules already loaded):

```js
const f = document.createElement('iframe');
f.src = '/auth/authorize';
document.body.append(f);
await new Promise(r => f.addEventListener('load', r));
const w = f.contentWindow;
let topWin = null;
try { if (w.top.location.origin === w.location.origin) topWin = w.top; } catch {}
const find = topWin ? FlowMousePageIcons.createFinder(topWin.location.href, topWin.document, FlowMouseSearchUrl.replaceUrlPlaceholders) : null;
const out = {
	sameOriginTop: !!topWin,
	frameHasSidebar: !!w.document.querySelector('ha-sidebar'),
	dashboardFromFrame: find && find({ customUrl: location.origin + '/energie-2/energie' }),
};
f.remove();
return out;
```

Expected: `sameOriginTop: true`, `frameHasSidebar: false`, `dashboardFromFrame: { iconPath: "M…" }`. (The cross-origin branch is a `try/catch` around `window.top.location.origin`; it is checked by reading the code, a cross-origin frame cannot be scripted from here.)

- [ ] **Step 4: Visual check in the extension (needs the user, window visible)**

Load the unpacked extension (CLAUDE.md "Development"), open the Test-HA or `https://assi.home.schep.de/`, assign the site to the Home Assistant menu ("Set website menu for this page"), add a dashboard page with "Add to menu", open the website menu by gesture:
- the fixed entries show the Home Assistant icons (puzzle, devices, shape, robot, hammer, …) on every page, also on a non-Home-Assistant page when Home Assistant is the default menu;
- the added dashboard shows its sidebar icon; after switching its icon to a Lucide one in the picker it shows that instead; "Page icon" restores it;
- on the Test-HA, an entry set to *Page icon* whose dashboard has no sidebar entry shows the link icon.
Record the result in the final message; do not claim this step done without having looked.

---

## Review outcome (revision 2)

External review (Codex), 2026-10-04. Every finding was checked against the code before deciding.

| # | Finding | Decision |
|---|---|---|
| C1 | `options.html`, `about.html`, `css-editor.html` load `content.js` but would lack the new scripts; the static list in `page-content-deps.test.mjs` hides it | **Fixed** (Task 3): both scripts loaded on the three pages, named in `REQUIRED_BEFORE_CONTENT`; the red run is part of Step 2. Confirmed: all three pages load `content.js`. |
| C2 | A menu is built in the gesture's frame, a click resolves `{tabOrigin}` against the top-level tab → different instances possible | **Fixed** (Task 4, Task 6 Step 3, design decision): the finder reads the top-level page when it is same-origin accessible (which also fixes ingress iframes, whose sidebar sits in the top document) and is skipped for cross-origin tops. Confirmed: `siteMenu` is a local action, executed in the gesture's frame. |
| C3 | Shadow-host fallback hands the first SVG of a whole component to every link in it | **Fixed** (Task 2): fallback only when the anchor is the sole link in its shadow root; test with two links and one unrelated SVG. |
| C4 | Links were resolved against `pageUrl`, ignoring `<base href>` | **Fixed** (Task 2): `a.baseURI` with `pageUrl` as fallback; test with a foreign and a local base. |
| W1 | Quadratic scan: every icon-less anchor re-searched the same host (3000 anchors ≈ 18 M node visits in a fake DOM) | **Fixed** (Task 2): the sole-link rule makes each host searched at most once; additionally a cap of 1500 inspected links, with a test. Real-browser timing stays in Task 6 Step 1. |
| W2 | Sanitizer accepts paths that draw nothing (`M`, `M1`) and yields an empty icon instead of the fallback | **Fixed in part** (Task 2): the path must tokenize completely and hold ≥ 4 numbers. Full SVG path grammar validation is **not** added: the reviewer's other examples (`M1..2`) are valid SVG, and a stricter grammar would risk rejecting valid compact paths (flags without separators). The browser decides how a syntactically odd but harmless path renders; markup injection is excluded by the token rule. |
| W3 | Apache-2.0 §4(a): a copy of the license must accompany the icons | **Fixed** (Task 1 Step 5): full license text appended to `THIRD_PARTY_LICENSES.md`. The package's own `LICENSE` is only a short notice and would not have sufficed. |
| M1 | The widened `menu-icons` assertion lets a Lucide icon pass on any `fill="currentColor"` | **Fixed** (Task 1): `mdi*` names must be filled, all others stroked. |
| M2 | The fake DOM matched any `path[d]` for `svg path[d]` | **Fixed** (Task 2): the fake demands an `<svg>` ancestor; orphan-path test added. |
| M3 | New comments in German | **Fixed** (Task 4): English. |

The four Task-2 fixes were mutation-checked: reverting any one of them (sole-link rule, `baseURI`, link cap, number minimum) makes exactly one test fail.

### Second review (Gemini), same day

Gemini reviewed the first revision of the plan (its line references and the "page-content-deps" remark are from before revision 2). Against the current plan:

| # | Finding | Decision |
|---|---|---|
| G-K1 | `content.js` on `options.html`, `about.html`, `css-editor.html` lacks `FlowMousePageIcons` → TypeError when a menu with `icon: 'page'` opens | **Already fixed** in revision 2 (Task 3 loads both scripts on those pages and `REQUIRED_BEFORE_CONTENT` enforces it). The suggested runtime guard (`&& window.FlowMousePageIcons`) is **not** added: the repository's convention is to enforce a load-order gotcha with a test rather than hide it at runtime, and a silent fallback would mask a page that forgot the script. |
| G-W2 | Apache-2.0 full text missing | **Already fixed** (Task 1 Step 5). |
| G-W3 | Unbounded deep scan; host searched once per icon-less link | **Already fixed** (Task 2: sole-link rule, 1500-link cap, mutation-tested). A further depth/element cap inside `deep()` is not added: that traversal is linear in the page, runs once per menu open, and only when an item uses `page`. |
| G-W4 | Misleading hint about `page-content-deps.test.mjs` | **Already fixed** (hint removed; Task 3 does the real edit). |
| G-M1 | Firefox manifest: say `content_scripts`, not `background.scripts` | **Fixed** (Global Constraints). |

Gemini judged the iframe question harmless (a frame without the Home Assistant DOM falls back to the link icon). That holds for cross-origin frames but not for same-origin add-on pages, whose sidebar lives in the top document; revision 2's top-level lookup covers that case (see Codex C2).
