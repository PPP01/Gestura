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
