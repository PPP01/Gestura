# Custom-Menu Dark/Light Theme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the on-page custom menu a global Auto/Light/Dark appearance setting; Auto follows the OS/browser theme, Light/Dark force it regardless of OS or page.

**Architecture:** A new global setting `customMenuTheme` ('auto'|'light'|'dark') flows two ways: the options UI (Lit `menu-panel`) reads/writes it via `SettingsStore`; the content script reads it from `chrome.storage.sync` and applies it by (a) adding a `fm-theme-*` class to the menu iframe frame and (b) passing `?theme=` into the iframe, where `context-menu.js` sets `data-theme` on its host. CSS in both layers replaces raw `prefers-color-scheme` media queries with attribute/class-gated rules so "Auto" keeps the OS behaviour while "Light"/"Dark" override it.

**Tech Stack:** Plain MV3 extension JS (no build). Content scripts attach to `window.*`; UI is Lit web components; settings default shape lives in `js/constants.js`. Tests: Vitest (`npm test`), which only exercises pure logic (no DOM/component harness).

## Global Constraints

- Indentation is **tabs**, not spaces, throughout.
- `DEFAULT_SETTINGS` in `js/constants.js` is the single source of truth for settings shape; both the `SettingsStore` path and the direct `chrome.storage.sync` path layer over it.
- Content scripts cannot use ES modules — they use IIFEs and `window.*` globals.
- New i18n keys go in `_locales/en/messages.json` (the `default_locale`) and `_locales/de/messages.json`; other locales fall back to `en` automatically.
- Backwards compatible: a missing `customMenuTheme` must behave exactly like today (`'auto'` = follow `prefers-color-scheme`).
- Only tasks touching pure logic get Vitest tests. UI/content-script/CSS tasks are verified manually in an unpacked extension (see final checklist) — do not fabricate a component test harness.
- `npm test` must stay green (baseline: 126 tests) after every task.

---

### Task 1: Add `customMenuTheme` default setting

**Files:**
- Modify: `js/constants.js` (in `DEFAULT_SETTINGS`, next to `customMenuSwitcher`)
- Test: `tests/settings-defaults.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `DEFAULT_SETTINGS.customMenuTheme` === `'auto'` (string, one of `'auto'|'light'|'dark'`). Consumed by Tasks 3, 4, 5.

- [ ] **Step 1: Write the failing test**

Add this `it` block inside the existing `describe("DEFAULT_SETTINGS", …)` in `tests/settings-defaults.test.mjs` (after the `searchEngines` test):

```js
	it("customMenuTheme defaults to 'auto'", () => {
		expect(DEFAULT_SETTINGS.customMenuTheme).toBe("auto");
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- settings-defaults`
Expected: FAIL — `customMenuTheme defaults to 'auto'` (received `undefined`).

- [ ] **Step 3: Add the default**

In `js/constants.js`, find the line:

```js
		customMenuSwitcher: { enabled: false, position: 'header' },
```

Add directly below it:

```js
		customMenuTheme: 'auto',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- settings-defaults`
Expected: PASS (all tests in that file green).

- [ ] **Step 5: Full suite + commit**

```bash
npm test
git add js/constants.js tests/settings-defaults.test.mjs
git commit -m "feat(menu): add customMenuTheme setting default (auto)"
```

Expected: `npm test` → 127 passed.

---

### Task 2: Add i18n strings (en + de)

**Files:**
- Modify: `_locales/en/messages.json`
- Modify: `_locales/de/messages.json`

**Interfaces:**
- Consumes: nothing.
- Produces: message keys `menuThemeTitle`, `menuThemeAuto`, `menuThemeLight`, `menuThemeDark`. Consumed by Task 5 via `window.i18n.getMessage(...)`.

- [ ] **Step 1: Add the English keys**

In `_locales/en/messages.json`, find the `"menuShowInSwitcher"` block. Immediately **after** its closing `},` (i.e. before `"addMenu": {`), insert:

```json
	"menuThemeTitle": {
		"message": "Appearance",
		"description": "Label for the custom-menu light/dark appearance selector"
	},
	"menuThemeAuto": {
		"message": "Auto",
		"description": "Appearance option — follow the OS/browser light/dark setting"
	},
	"menuThemeLight": {
		"message": "Light",
		"description": "Appearance option — always show the menu in light mode"
	},
	"menuThemeDark": {
		"message": "Dark",
		"description": "Appearance option — always show the menu in dark mode"
	},
```

- [ ] **Step 2: Add the German keys**

In `_locales/de/messages.json`, find the `"customMenuContextualLabel"` block. Immediately **after** its closing `},` (i.e. before `"addMenu": {`), insert:

```json
	"menuThemeTitle": {
		"message": "Erscheinungsbild"
	},
	"menuThemeAuto": {
		"message": "Automatisch"
	},
	"menuThemeLight": {
		"message": "Hell"
	},
	"menuThemeDark": {
		"message": "Dunkel"
	},
```

- [ ] **Step 3: Verify both files are valid JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('_locales/en/messages.json','utf8')); JSON.parse(require('fs').readFileSync('_locales/de/messages.json','utf8')); console.log('OK')"
```
Expected: `OK` (no parse error).

- [ ] **Step 4: Commit**

```bash
git add _locales/en/messages.json _locales/de/messages.json
git commit -m "i18n(menu): add appearance (auto/light/dark) strings for en, de"
```

---

### Task 3: Apply theme to the menu frame (content script)

**Files:**
- Modify: `js/content.js` — `ContentContextMenu` (`#settings`, `generateStyles`, `#createMenuIframe`) and the `ctxMenu.updateSettings(...)` call site.

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS.customMenuTheme` (Task 1), surfaced as `SETTINGS.customMenuTheme` from `chrome.storage.sync.get(null, …)`.
- Produces: the iframe carries class `fm-theme-auto` | `fm-theme-light` | `fm-theme-dark` and URL param `theme=<mode>` (consumed by Task 4).

No automated test (content-script DOM). Verified in Task 6 checklist.

- [ ] **Step 1: Add `menuTheme` to the settings object**

In `js/content.js`, find the `ContentContextMenu` `#settings` initializer:

```js
	#settings = {
		lang: '',
		isRtl: false,
		customCss: '',
	};
```

Change it to:

```js
	#settings = {
		lang: '',
		isRtl: false,
		customCss: '',
		menuTheme: 'auto',
	};
```

- [ ] **Step 2: Add the class-gated frame rules in `generateStyles()`**

In `generateStyles()`, replace this block:

```js
			@media (prefers-color-scheme: dark) {
				.fm-ctx-frame {
					background: rgba(30, 30, 32, 0.95);
				}
			}
```

with:

```js
			.fm-ctx-frame.fm-theme-dark {
				background: rgba(30, 30, 32, 0.95);
			}

			@media (prefers-color-scheme: dark) {
				.fm-ctx-frame.fm-theme-auto {
					background: rgba(30, 30, 32, 0.95);
				}
			}
```

(The base `.fm-ctx-frame { background: rgba(255,255,255,0.92); }` above it stays — that is the light/default. `fm-theme-light` intentionally has no rule.)

- [ ] **Step 3: Set the theme class + URL param when creating the iframe**

In `#createMenuIframe()`, find:

```js
		const iframe = host.createElement('iframe');
		iframe.className = 'fm-ctx-frame';
```

Change to (adds the theme class):

```js
		const iframe = host.createElement('iframe');
		iframe.className = 'fm-ctx-frame';
		const theme = this.#settings.menuTheme || 'auto';
		iframe.classList.add(`fm-theme-${theme}`);
```

Then find the URL param block:

```js
		url.searchParams.set('dir', this.#settings.isRtl ? 'rtl' : 'ltr');
		if (this.#settings.lang) url.searchParams.set('lang', this.#settings.lang);
		if (options?.scrollToBottom) url.searchParams.set('bottom', '1');
```

Add after it:

```js
		url.searchParams.set('theme', theme);
```

- [ ] **Step 4: Pass the setting through at the `updateSettings` call site**

In `js/content.js`, find:

```js
					ctxMenu.updateSettings({ lang, isRtl, customCss: SETTINGS.customCss });
```

Change to:

```js
					ctxMenu.updateSettings({ lang, isRtl, customCss: SETTINGS.customCss, menuTheme: SETTINGS.customMenuTheme });
```

- [ ] **Step 5: Sanity-check syntax + commit**

Run: `node --check js/content.js`
Expected: no output (valid syntax).

```bash
git add js/content.js
git commit -m "feat(menu): theme the custom-menu frame via fm-theme-* class"
```

---

### Task 4: Apply theme to the menu content (iframe component)

**Files:**
- Modify: `js/context-menu.js` — `FmContextMenu` (`static styles`, private field, constructor, `connectedCallback`).

**Interfaces:**
- Consumes: URL param `theme=<mode>` from Task 3.
- Produces: `data-theme="<mode>"` attribute on the `<fm-context-menu>` host (drives the CSS below). In preview mode the value is `'auto'`, preserving today's OS-driven behaviour.

No automated test (Lit/DOM). Verified in Task 6 checklist.

- [ ] **Step 1: Add a `#theme` private field**

In `js/context-menu.js`, find the private field block:

```js
	#menuId = null;
	#rtf = null;
	#dimensionsSent = false;
	#scrollToBottom = false;
```

Add a field:

```js
	#menuId = null;
	#rtf = null;
	#dimensionsSent = false;
	#scrollToBottom = false;
	#theme = 'auto';
```

- [ ] **Step 2: Read the `theme` param in the constructor**

Find, in the constructor:

```js
		this.#scrollToBottom = params.get('bottom') === '1';
```

Add directly after it:

```js
		this.#theme = params.get('theme') || 'auto';
```

- [ ] **Step 3: Set `data-theme` on the host in `connectedCallback`**

Find:

```js
	connectedCallback() {
		super.connectedCallback();
		if (this.preview) {
```

Insert the attribute set between `super.connectedCallback();` and the preview check, so it applies in every mode (in preview `#theme` is `'auto'`):

```js
	connectedCallback() {
		super.connectedCallback();
		this.setAttribute('data-theme', this.#theme);
		if (this.preview) {
```

- [ ] **Step 4: Replace the two dark-mode media blocks with attribute-gated rules**

In `static styles`, replace both existing blocks:

```css
			@media (prefers-color-scheme: dark) {
				.fm-ctx-header--switchable:hover,
				.fm-ctx-header--switchable:focus-visible,
				.fm-ctx-switch-item:hover,
				.fm-ctx-switch-item:focus-visible {
					background: rgba(255, 255, 255, 0.1);
				}
			}

			@media (prefers-color-scheme: dark) {
				.fm-ctx-menu {
					color: #e5e5e7;
				}
				.fm-ctx-item:hover,
				.fm-ctx-item:focus-visible {
					background: rgba(255, 255, 255, 0.1);
				}
				.fm-ctx-sep {
					background: rgba(255, 255, 255, 0.1);
				}
			}
```

with:

```css
			/* Forced dark — applies regardless of OS */
			:host([data-theme="dark"]) .fm-ctx-menu {
				color: #e5e5e7;
			}
			:host([data-theme="dark"]) .fm-ctx-item:hover,
			:host([data-theme="dark"]) .fm-ctx-item:focus-visible {
				background: rgba(255, 255, 255, 0.1);
			}
			:host([data-theme="dark"]) .fm-ctx-sep {
				background: rgba(255, 255, 255, 0.1);
			}
			:host([data-theme="dark"]) .fm-ctx-header--switchable:hover,
			:host([data-theme="dark"]) .fm-ctx-header--switchable:focus-visible,
			:host([data-theme="dark"]) .fm-ctx-switch-item:hover,
			:host([data-theme="dark"]) .fm-ctx-switch-item:focus-visible {
				background: rgba(255, 255, 255, 0.1);
			}

			/* Auto — follow the OS/browser setting */
			@media (prefers-color-scheme: dark) {
				:host([data-theme="auto"]) .fm-ctx-menu {
					color: #e5e5e7;
				}
				:host([data-theme="auto"]) .fm-ctx-item:hover,
				:host([data-theme="auto"]) .fm-ctx-item:focus-visible {
					background: rgba(255, 255, 255, 0.1);
				}
				:host([data-theme="auto"]) .fm-ctx-sep {
					background: rgba(255, 255, 255, 0.1);
				}
				:host([data-theme="auto"]) .fm-ctx-header--switchable:hover,
				:host([data-theme="auto"]) .fm-ctx-header--switchable:focus-visible,
				:host([data-theme="auto"]) .fm-ctx-switch-item:hover,
				:host([data-theme="auto"]) .fm-ctx-switch-item:focus-visible {
					background: rgba(255, 255, 255, 0.1);
				}
			}
```

(`data-theme="light"` matches no dark rule → the light base styles apply.)

- [ ] **Step 5: Sanity-check syntax + commit**

Run: `node --check js/context-menu.js`
Expected: no output (valid syntax).

```bash
git add js/context-menu.js
git commit -m "feat(menu): theme menu content via data-theme (auto/light/dark)"
```

---

### Task 5: Appearance selector in the menu editor UI

**Files:**
- Modify: `js/components/menu-panel.js` — `static properties`/getters, `connectedCallback` store subscription, `static styles`, `#renderSwitcherSettings()`.

**Interfaces:**
- Consumes: `SettingsStore.current.customMenuTheme` (Task 1), message keys from Task 2, existing `.switcher-position` / `.switcher-pos-btn` CSS classes.
- Produces: user-visible Auto/Light/Dark control that writes `customMenuTheme` via `SettingsStore.save`.

No automated test (Lit component; repo has no component harness). Verified in Task 6 checklist.

- [ ] **Step 1: Add a `menuTheme` getter and an updater**

In `js/components/menu-panel.js`, find the existing switcher getter/updater:

```js
	get switcherSettings() {
		return SettingsStore.current.customMenuSwitcher || { enabled: false, position: 'header' };
	}

	#updateSwitcher(patch) {
		const next = { ...this.switcherSettings, ...patch };
		SettingsStore.save({ customMenuSwitcher: next });
	}
```

Add directly after `#updateSwitcher`:

```js
	get menuTheme() {
		return SettingsStore.current.customMenuTheme || 'auto';
	}

	#updateTheme(value) {
		SettingsStore.save({ customMenuTheme: value });
	}
```

- [ ] **Step 2: Re-render when the setting changes**

Find, in `connectedCallback`:

```js
		this._unsubscribeStore = SettingsStore.onChange((changed) => {
			if ('customMenus' in changed || 'customMenuSwitcher' in changed) this.requestUpdate();
		});
```

Change the condition to also watch the theme key:

```js
		this._unsubscribeStore = SettingsStore.onChange((changed) => {
			if ('customMenus' in changed || 'customMenuSwitcher' in changed || 'customMenuTheme' in changed) this.requestUpdate();
		});
```

- [ ] **Step 3: Add CSS for the appearance row**

In `static styles`, find the `.show-in-switcher-field` rule:

```css
			.show-in-switcher-field {
				display: flex;
				align-items: center;
				gap: 8px;
				font-size: 12px;
				color: var(--text-secondary);
			}
```

Insert **before** it:

```css
			.theme-row {
				display: flex;
				align-items: center;
				gap: 10px;
				font-size: 12px;
				color: var(--text-secondary);
			}
			.theme-label {
				font-weight: 500;
			}
```

- [ ] **Step 4: Render the Auto/Light/Dark control**

In `#renderSwitcherSettings()`, find the closing of the switcher block:

```js
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
```

Insert the appearance row between the switcher `${…}` expression and the closing `</div>`:

```js
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
				<div class="theme-row">
					<span class="theme-label">${i18n.getMessage('menuThemeTitle')}</span>
					<div class="switcher-position" role="group">
						<button type="button"
							class="switcher-pos-btn${this.menuTheme === 'auto' ? ' active' : ''}"
							@click=${() => this.#updateTheme('auto')}
						>${i18n.getMessage('menuThemeAuto')}</button>
						<button type="button"
							class="switcher-pos-btn${this.menuTheme === 'light' ? ' active' : ''}"
							@click=${() => this.#updateTheme('light')}
						>${i18n.getMessage('menuThemeLight')}</button>
						<button type="button"
							class="switcher-pos-btn${this.menuTheme === 'dark' ? ' active' : ''}"
							@click=${() => this.#updateTheme('dark')}
						>${i18n.getMessage('menuThemeDark')}</button>
					</div>
				</div>
			</div>
		`;
```

- [ ] **Step 5: Sanity-check syntax + commit**

Run: `node --check js/components/menu-panel.js`
Expected: no output (valid syntax).

```bash
git add js/components/menu-panel.js
git commit -m "feat(menu): appearance (auto/light/dark) selector in menu editor"
```

---

### Task 6: Manual verification in the browser

**Files:** none (verification only).

This replaces automated coverage for the UI/content-script/CSS work in Tasks 3–5.

- [ ] **Step 1: Load the extension**

Load `c:/Programme.alt/Gestura-worktrees/custom-menu-theme` as an unpacked extension at `chrome://extensions` (Developer mode → "Load unpacked"). Reload the card after each code change.

- [ ] **Step 2: Confirm the control appears and persists**

Open the options page → configure a `Custom Menu` action. In the menu editor, confirm an **Appearance** row with **Auto / Light / Dark** buttons appears, the current choice is highlighted, and the choice survives an options-page reload.

- [ ] **Step 3: Verify each mode (frame + content)**

Trigger the custom menu on a normal page and check both the frame background and the text/hover:

1. OS light + **Auto** → menu light.
2. OS dark + **Auto** → menu dark (frame `rgba(30,30,32,0.95)`, text `#e5e5e7`).
3. **Light** → menu light even when OS is dark.
4. **Dark** → menu dark even when OS is light.

- [ ] **Step 4: Verify page-independence**

With **Dark** selected, open the menu on a bright website and on a dark website — the menu stays dark in both (it must ignore the page theme).

- [ ] **Step 5: Regression — no automated breakage**

Run: `npm test`
Expected: all green (127 tests).

---

## Notes for the implementer

- Do **not** touch the menu editor's live **preview** styling. Task 4 Step 3 sets `data-theme="auto"` in preview on purpose, which reproduces today's OS-following behaviour.
- The menu lives in a **closed** shadow root inside an extension-page iframe, so `data-theme` on the host and the new selectors are not reachable or overridable by the visited page.
- User `customCss` still loads after these rules; if a manual test shows user CSS being overridden unexpectedly, note it — it is called out as a risk in the spec, not an expected outcome.
