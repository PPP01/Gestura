// js/components/sync-merge-dialog.js
import { LitElement, html, css } from '../../js/lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';

// The conflict dialog of the reconciliation design (spec §7): one dialog for
// the whole merge, listing only the entries both sides changed. The automatic
// cases are one summary line above the list - the user must be able to see
// what happened without being asked about it.
//
// Mine is preselected: there is no defensible default when both sides moved,
// and the local value is the one that cannot surprise the person sitting in
// front of this browser. Two bulk buttons make a long list bearable without
// hiding it. Nothing here writes anything; `merge-confirm` hands the choices
// back to the panel, which shows the R3 preview next.
const SECTIONS = [
	[/^siteMenus\./, 'euSyncMergeSectionSiteMenus'],
	[/^searchEngines\./, 'euSyncMergeSectionEngines'],
	[/^(mouseGestures|wheelGestures|specialGestures|textDragGestures|linkDragGestures|imageDragGestures|gestureTriggerButtons)/, 'euSyncMergeSectionGestures'],
	[/^actionChains/, 'euSyncMergeSectionChains'],
];

class SyncMergeDialog extends LitElement {
	static properties = {
		open: { type: Boolean },
		conflicts: { type: Array },
		summary: { type: Object },
		stateName: { type: String },
		choices: { type: Object },
		_choices: { state: true },
	};

	static styles = [commonStyles, optionStyles, css`
		:host { display: contents; }
		.modal-overlay { position: fixed; inset: 0; z-index: 10000; background: rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center; }
		.modal-panel { width: min(720px, 94vw); max-height: 88vh; display: flex; flex-direction: column; background: var(--card-bg); border-radius: 14px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--border-color); }
		.modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border-color); }
		.modal-header h3 { margin: 0; font-size: 17px; font-weight: 600; }
		.modal-body { padding: 18px 20px; overflow-y: auto; }
		.summary { margin: 0 0 14px; font-size: 13px; color: var(--text-secondary); }
		.lead { margin: 0 0 10px; font-size: 14px; }
		.bulk { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
		.conflict { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--border-color); }
		.conflict .what { min-width: 0; }
		.conflict .section { font-size: 12px; color: var(--text-secondary); }
		.conflict .name { font-weight: 600; overflow-wrap: anywhere; }
		.conflict .side { font-size: 12px; color: var(--text-secondary); }
		.choices { display: flex; gap: 10px; flex: none; }
		.choices label { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; cursor: pointer; }
		.modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--border-color); }
	`];

	constructor() {
		super();
		this.open = false;
		this.conflicts = [];
		this.summary = { taken: 0, uploaded: 0, deleted: 0, unchanged: 0 };
		this.stateName = '';
		this.choices = {};
		this._choices = {};
		this._onKeydown = (e) => {
			if (e.key === 'Escape' && this.open) { e.stopPropagation(); this.#cancel(); }
		};
	}

	connectedCallback() {
		super.connectedCallback();
		document.addEventListener('keydown', this._onKeydown, true);
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		document.removeEventListener('keydown', this._onKeydown, true);
		this.#lockScroll(false);
	}

	#lockScroll(on) {
		document.documentElement.style.overflow = on ? 'hidden' : '';
	}

	updated(changed) {
		if (changed.has('open')) {
			this.#lockScroll(this.open);
			// The panel takes focus, not a button: Escape works immediately, and
			// Enter cannot write anything by accident.
			if (this.open) this.renderRoot.querySelector('.modal-panel')?.focus();
		}
	}

	willUpdate(changed) {
		// Answers remembered from an earlier pass (a 412 retry) arrive through
		// `choices`; everything not answered starts as Mine.
		if (changed.has('conflicts') || changed.has('choices')) {
			const next = {};
			for (const c of this.conflicts || []) next[c.key] = (this.choices && this.choices[c.key]) || 'mine';
			this._choices = next;
		}
	}

	#sectionOf(path) {
		for (const [re, key] of SECTIONS) if (re.test(path)) return key;
		return 'euSyncMergeSectionOther';
	}

	#nameOf(c) {
		const v = c.mine !== undefined ? c.mine : c.theirs;
		if (v && typeof v === 'object' && typeof v.name === 'string' && v.name) return v.name;
		return c.id || c.path;
	}

	#sideText(v) {
		const i18n = window.i18n;
		if (v === undefined) return i18n.getMessage('euSyncMergeDeleted');
		if (v && typeof v === 'object') return typeof v.name === 'string' && v.name ? v.name : JSON.stringify(v).slice(0, 60);
		return String(v);
	}

	#set(key, value) { this._choices = { ...this._choices, [key]: value }; }

	#setAll(value) {
		const next = {};
		for (const c of this.conflicts || []) next[c.key] = value;
		this._choices = next;
	}

	#cancel() { this.dispatchEvent(new CustomEvent('merge-cancel')); }

	#confirm() {
		this.dispatchEvent(new CustomEvent('merge-confirm', { detail: { choices: { ...this._choices } } }));
	}

	#renderConflict(c) {
		const i18n = window.i18n;
		const choice = this._choices[c.key] || 'mine';
		const radio = (value, label) => html`
			<label><input type="radio" name=${c.key} .checked=${choice === value}
				@change=${() => this.#set(c.key, value)}>${label}</label>`;
		return html`
			<div class="conflict">
				<div class="what">
					<div class="section">${i18n.getMessage(this.#sectionOf(c.path))}</div>
					<div class="name">${this.#nameOf(c)}</div>
					<div class="side">${i18n.getMessage('euSyncMergeMine')}: ${this.#sideText(c.mine)} · ${i18n.getMessage('euSyncMergeTheirs')}: ${this.#sideText(c.theirs)}</div>
				</div>
				<div class="choices">
					${radio('mine', i18n.getMessage('euSyncMergeMine'))}
					${radio('theirs', i18n.getMessage('euSyncMergeTheirs'))}
					${c.canKeepBoth ? radio('both', i18n.getMessage('euSyncMergeBoth')) : ''}
				</div>
			</div>`;
	}

	render() {
		if (!this.open) return html``;
		const i18n = window.i18n;
		const s = this.summary || {};
		const summary = i18n.getMessage('euSyncMergeSummary')
			.replace('{taken}', String(s.taken || 0))
			.replace('{uploaded}', String(s.uploaded || 0))
			.replace('{deleted}', String(s.deleted || 0));
		return html`
			<div class="modal-overlay" @click=${(e) => { if (e.target === e.currentTarget) this.#cancel(); }}>
				<div class="modal-panel" tabindex="-1" role="dialog" aria-modal="true">
					<div class="modal-header">
						<h3>${i18n.getMessage('euSyncMergeTitle').replace('{name}', this.stateName || '')}</h3>
					</div>
					<div class="modal-body">
						<p class="summary">${summary}</p>
						<p class="lead">${i18n.getMessage('euSyncMergeConflictsLead')}</p>
						<div class="bulk">
							<button class="btn btn-secondary" @click=${() => this.#setAll('mine')}>${i18n.getMessage('euSyncMergeAllMine')}</button>
							<button class="btn btn-secondary" @click=${() => this.#setAll('theirs')}>${i18n.getMessage('euSyncMergeAllTheirs')}</button>
						</div>
						${(this.conflicts || []).map(c => this.#renderConflict(c))}
					</div>
					<div class="modal-footer">
						<button class="btn btn-secondary" @click=${this.#cancel}>${i18n.getMessage('euSyncMergeCancel')}</button>
						<button class="btn btn-primary" @click=${this.#confirm}>${i18n.getMessage('euSyncMergeContinue')}</button>
					</div>
				</div>
			</div>`;
	}
}

customElements.define('sync-merge-dialog', SyncMergeDialog);
