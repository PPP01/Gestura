import { LitElement, html, css } from '../lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { SettingsStore } from '../settings-store.js';

const CATALOG = () => window.FlowMouseMenuCatalog.SITE_MENU_CATALOG;
const M = () => window.FlowMouseMenuModel;

// Anzeigename eines Menüs: Markenname oder lokalisierter nameKey.
export function menuDisplayName(def, fallbackKey = 'actionCustomMenu') {
	const i18n = window.i18n;
	return def?.name || (def?.nameKey && i18n.getMessage(def.nameKey)) || i18n.getMessage(fallbackKey);
}

// Anzeigename der Geste im zugeklappten action-select.
// action: 'customMenu' (privates Menü der Geste) oder 'siteMenu' (Website-Menüs).
export function getGestureMenuLabel(config, action = 'siteMenu') {
	const i18n = window.i18n;
	if (action === 'customMenu') return config?.ownMenu?.name || i18n.getMessage('customMenuOwnLabel');
	const cfg = { ...(window.GestureConstants.ACTION_DEFAULTS.siteMenu || {}), ...(config || {}) };
	const siteMenus = SettingsStore.current.siteMenus;
	if (cfg.mode !== 'standard' && cfg.mode !== 'fork') return i18n.getMessage('customMenuContextualLabel');
	const base = M().getBaseMenu(CATALOG(), siteMenus, cfg.menuId);
	if (!base) return `${i18n.getMessage('siteMenusTitle')} ${i18n.getMessage('menuNotFound')}`;
	if (cfg.mode === 'fork') {
		const name = cfg.fork?.name || menuDisplayName(base);
		return `${name} (${i18n.getMessage('forkBadgeModified')})`;
	}
	return menuDisplayName(base);
}

class GestureMenuConfig extends LitElement {

	static properties = {
		config: { attribute: false },
		action: { type: String },
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
		const defaults = window.GestureConstants.ACTION_DEFAULTS[this.action || 'siteMenu'] || {};
		return { ...defaults, ...(this.config || {}) };
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

	#menuSelect(value, onChange) {
		const menus = this.#activeMenus();
		return html`
			<select @change=${(e) => onChange(e.target.value)}>
				${menus.map(m => html`
					<option value=${m.id} ?selected=${m.id === value}>${menuDisplayName(m.def)}</option>
				`)}
			</select>
		`;
	}

	render() {
		const i18n = window.i18n;
		const cfg = this.#cfg;
		// customMenu = nur das private Menü dieser Geste — kein Quellen-Dropdown.
		if (this.action === 'customMenu') {
			return this.#renderOwnEditor(cfg, i18n);
		}
		const mode = (cfg.mode === 'standard' || cfg.mode === 'fork') ? cfg.mode : 'contextual';
		return html`
			<div class="row">
				<span class="row-label">${i18n.getMessage('menuModeLabel')}</span>
				<select @change=${(e) => this.#onModeChange(e.target.value)}>
					${['contextual', 'standard', 'fork'].map(m => html`
						<option value=${m} ?selected=${mode === m}>
							${i18n.getMessage('menuMode' + m[0].toUpperCase() + m.slice(1))}
						</option>
					`)}
				</select>
			</div>
			${this.#renderModeBody({ ...cfg, mode }, i18n)}
		`;
	}

	#onModeChange(mode) {
		const cfg = this.#cfg;
		if (mode === cfg.mode) return;
		const patch = { mode };
		if (mode === 'fork' && !cfg.fork) patch.fork = M().emptyFork();
		this.#update(patch);
	}

	#renderModeBody(cfg, i18n) {
		if (cfg.mode === 'standard') {
			const active = this.#activeMenus();
			// Vorauswahl: das globale Standard-Menü, sonst das erste aktive.
			const dm = SettingsStore.current.siteMenus?.defaultMenuId || '';
			const first = active.find(m => m.id === dm) || active[0];
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
			// Ohne Muster-Treffer öffnet das globale Standard-Menü (Website-Menüs-Sektion).
			return html`
				<div class="row">
					<span class="hint">${i18n.getMessage('customMenuContextualHint')}</span>
					<a class="manage-link" @click=${this.#navigateToSiteMenus}>${i18n.getMessage('openSiteMenusSection')}</a>
				</div>
			`;
		}
		return this.#renderForkEditor(cfg, i18n);
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
			${SettingsStore.current.menuAppend?.enabled ? html`
				<label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-secondary)">
					<input type="checkbox" .checked=${ownMenu.appendMini !== false}
						@change=${(e) => saveOwn(d => { d.appendMini = e.target.checked; })}>
					<span>${i18n.getMessage('siteMenuAppendPerMenu')}</span>
				</label>
			` : ''}
		`;
	}

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
				.namePlaceholder=${menuDisplayName(base)}
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
