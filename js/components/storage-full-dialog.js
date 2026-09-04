import { LitElement, html, css } from '../../js/lib/lit-all.min.js';
import { commonStyles } from './shared-styles.js';

// The refusal as a decision (storage-move design §6). The façade refused a write
// with a branch and two numbers; this is where the user sees them and chooses
// one of three ways out. In state 'local' there is one way - make it smaller -
// because the other two lead here.
//
// Every settings branch that can realistically grow past a quota, named the way
// the user sees it named elsewhere in the page. Three of them - the three the
// data section shows rows for - were mapped; the rest printed their internal
// identifier into a sentence, and `customCss` reaches this dialog for real: it
// is capped at 7500 CHARACTERS, which non-ASCII plus JSON escaping pushes past
// 8192 BYTES. Anything still unmapped gets an honest generic rather than a
// variable name.
const BRANCH_LABELS = {
	siteMenus: 'siteMenusTitle',
	searchEngines: 'sectionSearchEngines',
	mouseGestures: 'basicSettings',
	textDragGestures: 'textDragGestures',
	linkDragGestures: 'linkDragGestures',
	imageDragGestures: 'imageDragGestures',
	wheelGestures: 'wheelGestures',
	specialGestures: 'specialGestures',
	customCss: 'customCss',
	blacklist: 'blacklist',
};

export function branchLabel(i18n, key) {
	return i18n.getMessage(BRANCH_LABELS[key] || 'storageBranchOther');
}

// The tokens a refusal message supports, in one place: the dialog's title and
// the switch's refusal notice both fill the same three, from the same shape.
export function fillRefusal(i18n, key, res) {
	return i18n.getMessage(key)
		.replace('{branch}', branchLabel(i18n, res.branch))
		.replace('{used}', String(res.bytes))
		.replace('{total}', String(res.quota));
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
		this._returnFocus = null;
		this._onKeydown = (e) => { if (e.key === 'Escape' && this.open) { e.stopPropagation(); this.#choose('shrink'); } };
	}

	// aria-modal="true" tells a screen reader the rest of the page is gone; until
	// something moves focus in here, the reader is still sitting on the control
	// the user just used and has nothing to read. So: remember where focus was,
	// put it on the first way out, and hand it back when the dialog closes.
	updated(changed) {
		if (!changed.has('open')) return;
		if (this.open) {
			this._returnFocus = document.activeElement;
			const first = this.shadowRoot && this.shadowRoot.querySelector('.way');
			if (first) first.focus();
			return;
		}
		const back = this._returnFocus;
		this._returnFocus = null;
		if (back && typeof back.focus === 'function') back.focus();
	}

	// Tab must not walk out of a modal into a page that is not there any more.
	// Three buttons at most, all in this shadow tree, so the trap is the list.
	#onTrapKeydown(e) {
		if (e.key !== 'Tab') return;
		const ways = [...this.shadowRoot.querySelectorAll('.way')];
		if (!ways.length) return;
		const edge = e.shiftKey ? ways[0] : ways[ways.length - 1];
		if (this.shadowRoot.activeElement !== edge) return;
		e.preventDefault();
		(e.shiftKey ? ways[ways.length - 1] : ways[0]).focus();
	}

	connectedCallback() { super.connectedCallback(); document.addEventListener('keydown', this._onKeydown, true); }
	disconnectedCallback() { super.disconnectedCallback(); document.removeEventListener('keydown', this._onKeydown, true); }

	#choose(way) {
		this.dispatchEvent(new CustomEvent('storage-way', { detail: { way }, bubbles: true, composed: true }));
	}

	#title(i18n) {
		const f = this.failure;
		const fill = (key) => fillRefusal(i18n, key, f);
		if (f.checkedArea === 'local') return fill('storageLocalFullTitle');
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
		const local = this.failure.checkedArea === 'local';
		return html`
			<div class="backdrop" @click=${(e) => { if (e.target === e.currentTarget) this.#choose('shrink'); }}>
				<div class="modal" role="dialog" aria-modal="true" aria-labelledby="storageFullTitle"
					@keydown=${(e) => this.#onTrapKeydown(e)}>
					<div class="modal-header" id="storageFullTitle">${this.#title(i18n)}</div>
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
