import { LitElement, html, css, unsafeHTML } from '../lib/lit-all.min.js';
import { commonStyles, optionStyles, tabStyles } from './shared-styles.js';
import { icon } from '../icons.js';
import { settingsStore } from '../settings-store.js';
import { tooltip } from '../tooltip.js';
import { menuDisplayName } from './gesture-menu-config.js';

const CATALOG = () => window.FlowMouseMenuCatalog.SITE_MENU_CATALOG;
const M = () => window.FlowMouseMenuModel;

function downloadJson(obj, filename) {
	const blob = new Blob([JSON.stringify(obj, null, '\t')], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url; a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Turn a display name into a safe file base name (strips filesystem-reserved
// characters, collapses whitespace, caps length); falls back to 'gestura'.
function sanitizeFilename(name) {
	const s = String(name || '').trim()
		.replace(/[<>:"/\\|?*]+/g, '_')
		.replace(/\s+/g, '_')
		.replace(/^[._]+|_+$/g, '')
		.slice(0, 60);
	return s || 'gestura';
}

// Settings-Sektion „Website-Menüs", aufgeteilt in zwei Tabs: „Menüs" listet
// alle Standard-Menüs (Katalog + eigene) mit Ein/Aus, Bearbeiten
// (site-menu-editor), Zurücksetzen, Anlegen/Löschen, Domain-Wahl und Import;
// „Einstellungen" bündelt die globalen Optionen (Aussehen, Verhalten,
// Hinzufügen).
class SiteMenuManager extends LitElement {

	static properties = {
		_expandedId: { state: true },
		_activeTab: { state: true },
		advancedMode: { type: Boolean, attribute: 'advanced-mode' },
	};

	static styles = [
		commonStyles,
		optionStyles,
		tabStyles,
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
			/* :host ist eine Spalte — sonst zöge die Tab-Leiste über die volle Breite. */
			.type-switch { align-self: flex-start; }
			.settings-groups { display: flex; flex-direction: column; gap: 18px; }
			.settings-group { display: flex; flex-direction: column; gap: 10px; }
			.settings-group > h3 {
				margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
				text-transform: uppercase; color: var(--text-muted);
				padding-bottom: 6px; border-bottom: 1px solid var(--border-color);
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
			.show-in-switcher { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); }
			.flag-fields { display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--border-color); }
			.menu-name.default { font-weight: 700; }
			.default-marker { display: inline-flex; color: var(--accent-color); flex-shrink: 0; }
			.menu-btn.flag { opacity: 0.4; }
			.menu-btn.flag:hover { opacity: 0.75; color: var(--text-muted); }
			.menu-btn.flag.on { opacity: 1; color: var(--accent-color); }
			.menu-btn.flag.on:hover { color: var(--accent-color); }
			.import-bar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
			.import-url { flex: 1; min-width: 160px; font: inherit; font-size: 12px; padding: 5px 8px;
				border: 1px solid var(--border-color); border-radius: 6px; background: var(--card-bg); color: inherit; }
			.storage-line { font-size: 11.5px; color: var(--text-muted); }
		`,
	];

	constructor() {
		super();
		this._expandedId = '';
		this._activeTab = 'menus';
		this.advancedMode = false;
		this._unsubscribe = null;
		// Local settingsStore.save() does not fire onChange, so imports/edits from
		// elsewhere (the import dialog, the native context menu) announce via this
		// window event — mirror engine-manager and refresh on it.
		this._onCatalogChanged = () => this.requestUpdate();
	}

	connectedCallback() {
		super.connectedCallback();
		window.addEventListener('action-catalog-changed', this._onCatalogChanged);
		this._unsubscribe = settingsStore.onChange((changed) => {
			if ('siteMenus' in changed || 'customMenuSwitcher' in changed || 'customMenuTheme' in changed || 'menuAppend' in changed || 'menuOpenBehavior' in changed || 'siteMenuAddAsk' in changed) this.requestUpdate();
		});
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		window.removeEventListener('action-catalog-changed', this._onCatalogChanged);
		this._unsubscribe?.();
		this._unsubscribe = null;
	}

	get siteMenus() {
		return settingsStore.current.siteMenus || { disabled: [], edited: {}, custom: {}, domains: {}, order: [] };
	}

	async #saveSiteMenus(next) {
		const ok = await settingsStore.save({ siteMenus: next });
		if (!ok) alert(window.i18n.getMessage('menuSyncSaveError'));
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
		const tab = (id, label) => html`
			<button class="type-tab ${this._activeTab === id ? 'active' : ''}"
				role="tab" aria-selected=${this._activeTab === id}
				@click=${() => { this._activeTab = id; }}>${i18n.getMessage(label)}</button>
		`;
		return html`
			<div class="type-switch" role="tablist">
				${tab('menus', 'siteMenuTabMenus')}
				${tab('settings', 'siteMenuTabSettings')}
			</div>
			${this._activeTab === 'settings' ? this.#renderSettingsTab(i18n) : this.#renderMenusTab(i18n)}
		`;
	}

	#renderMenusTab(i18n) {
		const menus = M().listMenus(CATALOG(), this.siteMenus);
		return html`
			<div class="menu-list">
				${menus.map(m => this.#renderMenuRow(m, i18n))}
			</div>
			<button class="btn btn-ghost" style="align-self:flex-start" @click=${this.#addCustomMenu}>
				${unsafeHTML(icon('plus', { size: 13, strokeWidth: 2.5 }))}
				<span>${i18n.getMessage('siteMenuAddCustom')}</span>
			</button>
			<div class="import-bar">
				<button class="btn btn-ghost" @click=${() => this.#importFile()}>${i18n.getMessage('exchangeImportFromFile')}</button>
				<input class="import-url" type="url" placeholder=${i18n.getMessage('exchangeImportUrlPlaceholder')}
					@keydown=${(e) => { if (e.key === 'Enter') this.#importUrl(e.target.value); }}>
				<button class="btn btn-ghost" @click=${(e) => this.#importUrl(e.target.previousElementSibling.value)}>${i18n.getMessage('exchangeImportFromUrl')}</button>
				<menu-import-dialog @import-done=${() => this.requestUpdate()}></menu-import-dialog>
			</div>
			${this.#renderStorageLine(i18n)}
		`;
	}

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

	#dialog() { return this.renderRoot.querySelector('menu-import-dialog'); }

	async #importFile() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'application/json,.json';
		input.onchange = async () => {
			const file = input.files[0];
			if (!file) return;
			try {
				const obj = JSON.parse(await file.text());
				this.#dialog().openWith(obj, { type: 'file' });
			} catch { this.#dialog().openWith({}, { type: 'file' }); }
		};
		input.click();
	}

	async #importUrl(url) {
		if (!url) return;
		try {
			const res = await fetch(url);
			const obj = await res.json();
			this.#dialog().openWith(obj, { type: 'url', url });
		} catch { this.#dialog().openWith({}, { type: 'url', url }); }
	}

	#exportMenu(m) {
		const i18n = window.i18n;
		// Resolve i18n keys to literal text so an edited catalog menu (whose
		// untouched items still carry labelKey/nameKey) exports real labels,
		// not empty strings.
		const labelOf = (it) => it.customName || (it.labelKey ? i18n.getMessage(it.labelKey) : '');
		const menuName = m.def.name || (m.def.nameKey ? i18n.getMessage(m.def.nameKey) : '') || m.id;
		const items = (m.def.items || []).map(it =>
			it.type === 'separator' ? it : { ...it, customName: labelOf(it) });
		const resolvedDef = { ...m.def, name: menuName, items };
		const out = window.FlowMouseMenuExchange.menuToExchange(resolvedDef, {
			id: (m.def.source && m.def.source.indexId) || m.id,
			version: (m.def.source && m.def.source.version) || '1.0.0',
		});
		downloadJson(out, `${sanitizeFilename(menuName)}.gestura-menu.json`);
	}

	#renderSettingsTab(i18n) {
		const group = (titleKey, body) => html`
			<section class="settings-group">
				<h3>${i18n.getMessage(titleKey)}</h3>
				<div class="switcher-settings">${body}</div>
			</section>
		`;
		return html`
			<div class="settings-groups">
				${group('siteMenuGroupAppearance', this.#renderAppearance(i18n))}
				${group('siteMenuGroupBehavior', html`
					${this.#renderOpenBehavior(i18n)}
					${this.#renderMenuAppend(i18n)}
				`)}
				${group('siteMenuGroupAdding', this.#renderAddAsk(i18n))}
			</div>
		`;
	}

	#renderAppearance(i18n) {
		const s = settingsStore.current.customMenuSwitcher || { enabled: false, position: 'header' };
		const theme = settingsStore.current.customMenuTheme || 'auto';
		const saveSwitcher = (patch) => { settingsStore.save({ customMenuSwitcher: { ...s, ...patch } }); this.requestUpdate(); };
		return html`
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
				<span>${i18n.getMessage('theme')}</span>
				<div class="seg" role="group">
					${['auto', 'light', 'dark'].map(v => html`
						<button type="button" class=${theme === v ? 'active' : ''}
							@click=${() => { settingsStore.save({ customMenuTheme: v }); this.requestUpdate(); }}
						>${i18n.getMessage('menuTheme' + v[0].toUpperCase() + v.slice(1))}</button>
					`)}
				</div>
			</div>
		`;
	}

	// „Menü abfragen, wenn keins passt" — greift nur beim Hinzufügen eines
	// Eintrags, daher eine eigene Gruppe statt eines prominenten Sektions-Schalters.
	#renderAddAsk(i18n) {
		const on = settingsStore.current.siteMenuAddAsk !== false;
		return html`
			<label class="switcher-toggle">
				<input type="checkbox" .checked=${on}
					@change=${(e) => { settingsStore.save({ siteMenuAddAsk: e.target.checked }); this.requestUpdate(); }}>
				<span class="switcher-toggle-text">
					<span class="switcher-toggle-label">${i18n.getMessage('siteMenuAddAsk')}</span>
					<span class="switcher-toggle-hint">${i18n.getMessage('siteMenuAddAskDesc')}</span>
				</span>
			</label>
		`;
	}

	// Öffnungsverhalten für Links/Suchen in Menüs (nur bei „Erweitert").
	// '' steht im Pro-Menü-Override für „globale Einstellung verwenden".
	#behaviorOptions(i18n, withInherit) {
		const opts = withInherit ? [['', i18n.getMessage('siteMenuOpenBehaviorInherit')]] : [];
		return opts.concat([
			['standard', i18n.getMessage('siteMenuOpenBehaviorStandard')],
			['standardReverse', i18n.getMessage('openBehaviorStandardReverse')],
			['right', i18n.getMessage('siteMenuOpenBehaviorRight')],
			['left', i18n.getMessage('siteMenuOpenBehaviorLeft')],
			['last', i18n.getMessage('siteMenuOpenBehaviorLast')],
			['first', i18n.getMessage('siteMenuOpenBehaviorFirst')],
		]);
	}

	#renderOpenBehavior(i18n) {
		if (!this.advancedMode) return '';
		const value = settingsStore.current.menuOpenBehavior || 'standard';
		return html`
			<div class="theme-row">
				<span>${i18n.getMessage('siteMenuOpenBehaviorLabel')}</span>
				<select @change=${(e) => { settingsStore.save({ menuOpenBehavior: e.target.value }); this.requestUpdate(); }}>
					${this.#behaviorOptions(i18n, false).map(([v, label]) => html`
						<option value=${v} ?selected=${v === value}>${label}</option>
					`)}
				</select>
			</div>
		`;
	}

	get menuAppend() {
		return settingsStore.current.menuAppend || { enabled: false, items: [] };
	}

	async #saveMenuAppend(next) {
		const ok = await settingsStore.save({ menuAppend: next });
		if (!ok) alert(window.i18n.getMessage('menuSyncSaveError'));
		this.requestUpdate();
	}

	#renderMenuAppend(i18n) {
		const a = this.menuAppend;
		const save = (mutate) => {
			const next = structuredClone(a);
			mutate(next);
			this.#saveMenuAppend(next);
		};
		return html`
			<label class="switcher-toggle">
				<input type="checkbox" .checked=${!!a.enabled}
					@change=${(e) => this.#saveMenuAppend({ ...a, enabled: e.target.checked })}>
				<span class="switcher-toggle-text">
					<span class="switcher-toggle-label">${i18n.getMessage('siteMenuAppendEnable')}</span>
					<span class="switcher-toggle-hint">${i18n.getMessage('siteMenuAppendHint')}</span>
				</span>
			</label>
			${a.enabled ? html`
				<div class="editor-wrap">
					<site-menu-editor hide-name
						.rows=${(a.items || []).map(item => ({ item, state: 'own' }))}
						.patterns=${null}
						@item-change=${(e) => save(d => { d.items = d.items.map(it => it.id === e.detail.item.id ? e.detail.item : it); })}
						@item-delete=${(e) => save(d => { d.items = d.items.filter(it => it.id !== e.detail.itemId); })}
						@item-add=${(e) => save(d => { d.items = [...(d.items || []), e.detail.item]; })}
						@item-duplicate=${(e) => save(d => {
							const idx = d.items.findIndex(it => it.id === e.detail.itemId);
							if (idx === -1) return;
							const copy = structuredClone(d.items[idx]);
							copy.id = `item_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
							d.items.splice(idx + 1, 0, copy);
						})}
						@items-reorder=${(e) => save(d => {
							const byId = new Map((d.items || []).map(it => [it.id, it]));
							d.items = e.detail.orderedIds.map(id => byId.get(id)).filter(Boolean);
						})}
					></site-menu-editor>
				</div>
			` : ''}
		`;
	}

	// Pro-Menü-Flags (Switcher-Sichtbarkeit, Quick-Search-Anhang) — nur sichtbar,
	// wenn das jeweilige globale Feature aktiv ist. Umschalten forkt das Menü nicht.
	#renderFlagToggles(m, i18n, size = 14) {
		const switcherEnabled = !!(settingsStore.current.customMenuSwitcher || {}).enabled;
		const appendEnabled = !!this.menuAppend.enabled;
		const toggle = (key, current, iconName, label) => html`
			<button class="menu-btn flag ${current ? 'on' : ''}" .tooltip=${tooltip(label)}
				@click=${(e) => { e.stopPropagation(); this.#saveSiteMenus(M().withMenuFlag(this.siteMenus, m.id, key, !current)); }}>
				${unsafeHTML(icon(iconName, { size, strokeWidth: 2 }))}
			</button>
		`;
		return html`
			${switcherEnabled ? toggle('showInSwitcher',
				M().menuFlag(this.siteMenus, m.id, m.def, 'showInSwitcher'),
				'panelTop', i18n.getMessage('menuShowInSwitcher')) : ''}
			${appendEnabled ? toggle('appendMini',
				M().menuFlag(this.siteMenus, m.id, m.def, 'appendMini'),
				'search', i18n.getMessage('siteMenuAppendPerMenu')) : ''}
		`;
	}

	#renderMenuRow(m, i18n) {
		const count = (m.def.items || []).filter(it => it.type !== 'separator').length;
		const menuIcon = (window.FlowMouseMenuIcons || {})[m.def.icon] || '';
		const expanded = this._expandedId === m.id;
		const isDefault = (this.siteMenus.defaultMenuId || '') === m.id;
		return html`
			<div class="menu-row ${m.disabled ? 'disabled' : ''}">
				<span class="menu-icon">${menuIcon ? unsafeHTML(menuIcon) : ''}</span>
				<span class="menu-name ${isDefault ? 'default' : ''}">
					${isDefault ? html`<span class="default-marker"
						.tooltip=${tooltip(i18n.getMessage('siteMenuDefaultToggle'))}
					>${unsafeHTML(icon('star', { size: 13, strokeWidth: 2.5 }))}</span>` : ''}
					${menuDisplayName(m.def, 'menuNamePlaceholder')}
					<span class="menu-count">(${count})</span>
					${m.isEdited ? html`<span class="edited-badge">${i18n.getMessage('siteMenuEdited')}</span>` : ''}
				</span>
				<div class="menu-buttons">
					${this.#renderFlagToggles(m, i18n)}
					${m.isEdited ? html`
						<button class="menu-btn" .tooltip=${tooltip(i18n.getMessage('siteMenuReset'))}
							@click=${() => this.#resetMenu(m)}>
							${unsafeHTML(icon('rotateCcw', { size: 14, strokeWidth: 2 }))}
						</button>
					` : ''}
					${(m.isCustom || m.isEdited) ? html`
						<button class="menu-btn" .tooltip=${tooltip(i18n.getMessage('exchangeExport'))}
							@click=${(e) => { e.stopPropagation(); this.#exportMenu(m); }}>
							${unsafeHTML(icon('download', { size: 14, strokeWidth: 2 }))}
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
		const switcherEnabled = !!(settingsStore.current.customMenuSwitcher || {}).enabled;
		const defaultMenuId = this.siteMenus.defaultMenuId || '';
		const isDefault = defaultMenuId === m.id;
		// Exklusiv: sobald ein Standard-Menü gesetzt ist, bieten andere Menüs den Schalter nicht an.
		const defaultToggleVisible = !defaultMenuId || isDefault;
		return html`
			${switcherEnabled || this.menuAppend.enabled || defaultToggleVisible || this.advancedMode ? html`
				<div class="flag-fields">
					${defaultToggleVisible ? html`
						<label class="show-in-switcher">
							<input type="checkbox" .checked=${isDefault}
								@change=${(e) => this.#saveSiteMenus(M().withDefaultMenu(this.siteMenus, e.target.checked ? m.id : ''))}>
							<span>${i18n.getMessage('siteMenuDefaultToggle')}</span>
						</label>
					` : ''}
					${switcherEnabled ? html`
						<label class="show-in-switcher">
							<input type="checkbox" .checked=${M().menuFlag(this.siteMenus, m.id, def, 'showInSwitcher')}
								@change=${(e) => this.#saveSiteMenus(M().withMenuFlag(this.siteMenus, m.id, 'showInSwitcher', e.target.checked))}>
							<span>${i18n.getMessage('menuShowInSwitcher')}</span>
						</label>
					` : ''}
					${this.menuAppend.enabled ? html`
						<label class="show-in-switcher">
							<input type="checkbox" .checked=${M().menuFlag(this.siteMenus, m.id, def, 'appendMini')}
								@change=${(e) => this.#saveSiteMenus(M().withMenuFlag(this.siteMenus, m.id, 'appendMini', e.target.checked))}>
							<span>${i18n.getMessage('siteMenuAppendPerMenu')}</span>
						</label>
					` : ''}
					${this.advancedMode ? html`
						<div class="theme-row">
							<span>${i18n.getMessage('siteMenuOpenBehaviorLabel')}</span>
							<select @change=${(e) => this.#saveSiteMenus(M().withMenuFlag(this.siteMenus, m.id, 'openBehavior', e.target.value))}>
								${this.#behaviorOptions(i18n, true).map(([v, label]) => html`
									<option value=${v} ?selected=${v === (M().menuFlagRaw(this.siteMenus, m.id, def, 'openBehavior') || '')}>${label}</option>
								`)}
							</select>
						</div>
					` : ''}
				</div>
			` : ''}
			<site-menu-editor
				.rows=${rows}
				.name=${def.name || ''}
				.namePlaceholder=${menuDisplayName(def, 'menuNamePlaceholder')}
				.patterns=${isDefault ? null : (def.patterns || [])}
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
		if (!confirm(i18n.getMessage('siteMenuResetConfirm').replace('%name%', menuDisplayName(m.def, 'menuNamePlaceholder')))) return;
		this.#saveSiteMenus(M().withMenuReset(this.siteMenus, m.id));
	}

	#deleteMenu(m) {
		const i18n = window.i18n;
		if ((m.def.items || []).length &&
			!confirm(i18n.getMessage('deleteMenuConfirm').replace('%name%', menuDisplayName(m.def, 'menuNamePlaceholder')))) return;
		if (this._expandedId === m.id) this._expandedId = '';
		this.#saveSiteMenus(M().withoutCustomMenu(this.siteMenus, m.id));
	}
}

window.i18n.waitForInit().then(() => {
	customElements.define('site-menu-manager', SiteMenuManager);
});
