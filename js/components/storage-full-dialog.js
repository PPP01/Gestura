import { LitElement, html, css } from '../../js/lib/lit-all.min.js';
import { commonStyles } from './shared-styles.js';

// The refusal as a decision (storage-move design §6). The façade refused a write
// with a branch and two numbers; this is where the user sees them and chooses
// one of three ways out. In state 'local' there is one way - make it smaller -
// because the other two lead here.
const BRANCH_LABELS = {
	siteMenus: 'siteMenusTitle',
	searchEngines: 'sectionSearchEngines',
	mouseGestures: 'basicSettings',
};

export function branchLabel(i18n, key) {
	return BRANCH_LABELS[key] ? i18n.getMessage(BRANCH_LABELS[key]) : key;
}

class StorageFullDialog extends LitElement {
	static properties = {
		open: { type: Boolean, reflect: true },
		failure: { attribute: false },
	};

	static styles = [commonStyles, css`
		:host { display: none; }
		:host([open]) { display: block; }
		.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 1000; display: flex; align-items: center; justify-content: center; }
		.modal { background: var(--bg-color); color: var(--text-color); border-radius: 10px; width: min(560px, 92vw); box-shadow: 0 12px 40px rgba(0,0,0,.35); }
		.modal-header { padding: 18px 20px 6px; font-weight: 600; font-size: 15px; }
		.ways { display: flex; flex-direction: column; gap: 10px; padding: 12px 20px 20px; }
		.way { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; text-align: left; padding: 12px 14px; border: 1px solid var(--border-color); border-radius: 8px; background: transparent; color: inherit; cursor: pointer; }
		.way:hover { border-color: var(--primary-color); }
		.way strong { font-size: 14px; }
		.way span { font-size: 12px; opacity: .8; }
	`];

	constructor() {
		super();
		this.open = false;
		this.failure = null;
		this._onKeydown = (e) => { if (e.key === 'Escape' && this.open) { e.stopPropagation(); this.#choose('shrink'); } };
	}

	connectedCallback() { super.connectedCallback(); document.addEventListener('keydown', this._onKeydown, true); }
	disconnectedCallback() { super.disconnectedCallback(); document.removeEventListener('keydown', this._onKeydown, true); }

	#choose(way) {
		this.dispatchEvent(new CustomEvent('storage-way', { detail: { way }, bubbles: true, composed: true }));
	}

	#title(i18n) {
		const f = this.failure;
		const fill = (key) => i18n.getMessage(key)
			.replace('{branch}', branchLabel(i18n, f.branch))
			.replace('{used}', String(f.bytes))
			.replace('{total}', String(f.quota));
		if (f.area === 'local') return fill('storageLocalFullTitle');
		return fill(f.error === 'branch-full' ? 'storageBranchFullTitle' : 'storageTotalFullTitle');
	}

	#way(i18n, way, labelKey, descKey) {
		return html`
			<button class="way" @click=${() => this.#choose(way)}>
				<strong>${i18n.getMessage(labelKey)}</strong>
				<span>${i18n.getMessage(descKey)}</span>
			</button>`;
	}

	render() {
		if (!this.open || !this.failure) return html``;
		const i18n = window.i18n;
		const local = this.failure.area === 'local';
		return html`
			<div class="backdrop" @click=${(e) => { if (e.target === e.currentTarget) this.#choose('shrink'); }}>
				<div class="modal" role="dialog" aria-modal="true">
					<div class="modal-header">${this.#title(i18n)}</div>
					<div class="ways">
						${this.#way(i18n, 'shrink', 'storageWayShrink', 'storageWayShrinkDesc')}
						${local ? '' : this.#way(i18n, 'eu', 'storageWayEu', 'storageWayEuDesc')}
						${local ? '' : this.#way(i18n, 'local', 'storageWayLocal', 'storageWayLocalDesc')}
					</div>
				</div>
			</div>`;
	}
}

customElements.define('storage-full-dialog', StorageFullDialog);
