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
