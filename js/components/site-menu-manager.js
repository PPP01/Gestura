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

	async #saveSiteMenus(next) {
		const ok = await SettingsStore.save({ siteMenus: next });
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
