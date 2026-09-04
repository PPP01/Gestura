import { LitElement, html, css, unsafeHTML } from '../../js/lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { icons } from '../icons.js';

// "You see in full, beforehand, what is transferred" - Issue #1, as a
// component. Three callers, one shape: export (before the file is written),
// file import (before the settings are replaced) and sync upload (before
// anything leaves the browser). Exactly one component, because three versions
// of the same promise would sooner or later show three different things.
//
// The dialog decides nothing. It shows what the validator worked out and
// reports consent or cancellation - the writing is the caller's job.

const TITLES = { export: 'settingsPreviewExportTitle', import: 'settingsPreviewImportTitle', upload: 'settingsPreviewUploadTitle' };
const CONFIRMS = { export: 'settingsPreviewConfirmExport', import: 'settingsPreviewConfirmImport', upload: 'settingsPreviewConfirmUpload' };

// Error code -> sentence. Exported, because the sync panel reports validation
// errors too and both should speak the same language.
//
// A table rather than a key computed from the code: a composed key cannot be
// found by searching. Whoever looks for "settingsPreviewErrorNotJson" should
// see it written here - and a typo should show up instead of quietly falling
// back to the generic message.
const ERROR_KEYS = {
	'too-large': 'settingsPreviewErrorTooLarge',
	'not-json': 'settingsPreviewErrorNotJson',
	'not-object': 'settingsPreviewErrorNotObject',
	'not-settings': 'settingsPreviewErrorNotSettings',
	'unknown-format': 'settingsPreviewErrorUnknownFormat',
	'forbidden-key': 'settingsPreviewErrorForbiddenKey',
};

export function settingsErrorMessage(i18n, code) {
	return i18n.getMessage(ERROR_KEYS[code] || 'importFailed');
}

class SettingsPreviewDialog extends LitElement {
	static properties = {
		open: { type: Boolean },
		mode: { type: String },
		json: { type: String },
		dropped: { type: Array },
		retyped: { type: Array },
		legacy: { type: Boolean },
		note: { type: String },
	};

	static styles = [commonStyles, optionStyles, css`
		:host { display: contents; }
		.modal-overlay {
			position: fixed; inset: 0; z-index: 10000;
			background: rgba(0, 0, 0, 0.35);
			display: flex; align-items: center; justify-content: center;
			animation: sp-fadeIn 0.12s ease;
		}
		@keyframes sp-fadeIn { from { opacity: 0; } to { opacity: 1; } }
		.modal-panel {
			width: min(760px, 94vw); max-height: 88vh;
			display: flex; flex-direction: column;
			background: var(--card-bg); border-radius: 14px;
			box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--border-color);
		}
		.modal-panel:focus { outline: none; }
		.modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border-color); }
		.modal-header h3 { margin: 0; font-size: 17px; font-weight: 600; }
		.modal-body { padding: 16px 20px; overflow-y: auto; }
		.modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--border-color); }
		.notes { margin: 0 0 12px; display: flex; flex-direction: column; gap: 6px; }
		.notes p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
		.notes p.warn { color: var(--warning-color); }
		.size { font-size: 12px; color: var(--text-secondary); margin: 0 0 8px; }
		/* Complete means complete: no excerpt, no summary. Only the height is
		   capped, and what does not fit is scrolled. */
		pre.preview-json {
			margin: 0; padding: 12px; max-height: 46vh; overflow: auto;
			background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 8px;
			font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
			font-size: 12px; line-height: 1.5; white-space: pre; tab-size: 2;
		}
	`];

	constructor() {
		super();
		this.open = false;
		this.mode = 'export';
		this.json = '';
		this.dropped = [];
		this.retyped = [];
		this.legacy = false;
		this.note = '';
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

	#cancel() {
		this.open = false;
		this.#lockScroll(false);
		this.dispatchEvent(new CustomEvent('preview-cancel'));
	}

	#confirm() {
		this.open = false;
		this.#lockScroll(false);
		this.dispatchEvent(new CustomEvent('preview-confirm'));
	}

	updated(changed) {
		if (changed.has('open')) {
			this.#lockScroll(this.open);
			// The panel takes focus, not a button: Escape works, and Enter cannot
			// write anything by accident.
			if (this.open) this.renderRoot.querySelector('.modal-panel')?.focus();
		}
	}

	render() {
		if (!this.open) return html``;
		const i18n = window.i18n;
		const bytes = new TextEncoder().encode(this.json || '').length;
		return html`
			<div class="modal-overlay" @mousedown=${this.#cancel}>
				<div class="modal-panel" tabindex="-1" @mousedown=${e => e.stopPropagation()}>
					<div class="modal-header">
						<h3>${i18n.getMessage(TITLES[this.mode] || TITLES.export)}</h3>
						<button type="button" class="modal-close" @click=${this.#cancel}
							aria-label=${i18n.getMessage('settingsPreviewCancel')}>${unsafeHTML(icons.x)}</button>
					</div>
					<div class="modal-body">
						<div class="notes">
							${this.note ? html`<p>${this.note}</p>` : ''}
							${this.mode === 'import' ? html`<p class="warn">${i18n.getMessage('settingsPreviewReplaces')}</p>` : ''}
							${this.legacy ? html`<p>${i18n.getMessage('settingsPreviewLegacy')}</p>` : ''}
							${this.dropped && this.dropped.length ? html`
								<p class="warn">${i18n.getMessage('settingsPreviewDropped').replace('{keys}', this.dropped.join(', '))}</p>` : ''}
							${this.retyped && this.retyped.length ? html`
								<p class="warn">${i18n.getMessage('settingsPreviewRetyped').replace('{keys}', this.retyped.join(', '))}</p>` : ''}
						</div>
						<p class="size">${i18n.getMessage('settingsPreviewSize').replace('{bytes}', String(bytes))}</p>
						<pre class="preview-json">${this.json}</pre>
					</div>
					<div class="modal-footer">
						<button class="btn btn-secondary" @click=${this.#cancel}>${i18n.getMessage('settingsPreviewCancel')}</button>
						<button class="btn btn-primary" @click=${this.#confirm}>${i18n.getMessage(CONFIRMS[this.mode] || CONFIRMS.export)}</button>
					</div>
				</div>
			</div>`;
	}
}

customElements.define('settings-preview-dialog', SettingsPreviewDialog);
