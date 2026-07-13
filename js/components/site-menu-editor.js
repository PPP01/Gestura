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
		// action-select liefert {action, config}; id, icon und labelKey des Items bleiben erhalten.
		const next = { id: item.id, action: detail.action, ...(detail.config || {}) };
		if (item.icon) next.icon = item.icon;
		if (item.labelKey) next.labelKey = item.labelKey;
		if (!next.customName) delete next.customName;
		if (this.#itemsEqual(next, item)) return; // folgenloses Bestätigen erzeugt keine Änderung
		this.#emit('item-change', { item: next });
	}

	#itemsEqual(a, b) {
		const norm = (o) => JSON.stringify(Object.keys(o).sort().reduce((r, k) => {
			if (o[k] !== undefined && o[k] !== '') r[k] = o[k];
			return r;
		}, {}));
		return norm(a) === norm(b);
	}

	#addItem(separator) {
		const id = this.#generateItemId();
		const rows = this.rows || [];
		const last = rows[rows.length - 1];
		const afterId = last ? last.item.id : '';
		const item = separator ? { id, type: 'separator' } : { id, action: 'none' };
		this.#emit('item-add', { item, afterId });
	}

	// --- Drag & Drop ---
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
