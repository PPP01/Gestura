import { LitElement, html, css, unsafeHTML } from '../../js/lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { icons } from '../icons.js';
import { canonicalText, unifiedDiff } from './text-diff.js';
import { describeChanges } from './settings-changes.js';
import { makeChangeLabels } from './settings-change-labels.js';

// "You see in full, beforehand, what is transferred" - Issue #1, as a
// component. Three callers, one shape: export (before the file is written),
// file import (before the settings are replaced) and sync upload (before
// anything leaves the browser). Exactly one component, because three versions
// of the same promise would sooner or later show three different things.
//
// The dialog decides nothing. It shows what the validator worked out and
// reports consent or cancellation - the writing is the caller's job.

const TITLES = { export: 'settingsPreviewExportTitle', import: 'settingsPreviewImportTitle', upload: 'settingsPreviewUploadTitle', merge: 'settingsPreviewImportTitle' };
// A merge confirms with the word of the action that started it, not with
// "Write settings": the button names what happens, and here that is the merge.
const CONFIRMS = { export: 'settingsPreviewConfirmExport', import: 'settingsPreviewConfirmImport', upload: 'settingsPreviewConfirmUpload', merge: 'euSyncMerge' };

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
		// What this write changes, as one or more { label, before, after }: the
		// settings as they are, and as they will be. Given, the dialog leads with a
		// summary and puts the exact diff and the complete JSON behind toggles;
		// without it (export, upload: nothing is replaced) the JSON is shown as it was.
		compare: { type: Array },
		_expanded: { state: true },
	};

	// Lines shown per area before "+n more".
	static AREA_LIMIT = 8;
	static AREA_KEYS = {
		gestures: 'settingsPreviewAreaGestures',
		menus: 'settingsPreviewAreaMenus',
		engines: 'settingsPreviewAreaEngines',
		settings: 'settingsPreviewAreaSettings',
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
		/* The summary: one line per change, with a sign as well as a colour so the
		   difference does not rest on colour alone. */
		.changes h4 { margin: 14px 0 6px; font-size: 14px; font-weight: 600; }
		.changes h4:first-child { margin-top: 0; }
		.changes h5 { margin: 10px 0 4px; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--text-secondary); }
		.changes ul { margin: 0; padding: 0; list-style: none; }
		.changes li { display: flex; gap: 8px; padding: 2px 0; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
		.changes li .sign { flex: none; width: 1em; text-align: center; font-weight: 700; }
		.changes li.added { color: var(--success-color); }
		.changes li.removed { color: var(--danger-color); }
		.changes .more { margin: 2px 0 0; padding: 0; border: 0; background: none; color: var(--accent-color); font-size: 12.5px; cursor: pointer; }
		.changes .more:hover { text-decoration: underline; }
		.changes .none { margin: 0; font-size: 13px; color: var(--text-secondary); }
		details.tech, details.full { margin-top: 14px; }
		details > summary { cursor: pointer; font-size: 13px; font-weight: 600; padding: 4px 0; }
		details > summary:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; border-radius: 4px; }
		/* Every line of the diff is a block of its own, so a full-row tint can sit
		   behind it; the file headers are coloured but get no tint, they name the
		   files and are not a change. */
		pre.diff {
			margin: 6px 0 0; padding: 10px 12px; max-height: 40vh; overflow: auto;
			background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 8px;
			font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
			font-size: 12px; line-height: 1.5; white-space: pre; tab-size: 2;
		}
		pre.diff span { display: block; margin: 0 -12px; padding: 0 12px; }
		pre.diff .add { color: var(--success-color); background: color-mix(in srgb, var(--success-color) 12%, transparent); }
		pre.diff .del { color: var(--danger-color); background: color-mix(in srgb, var(--danger-color) 12%, transparent); }
		pre.diff .at { color: var(--text-secondary); background: color-mix(in srgb, var(--border-color) 45%, transparent); }
		pre.diff .hdr-add { color: var(--success-color); }
		pre.diff .hdr-del { color: var(--danger-color); }
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
		this.compare = [];
		this._expanded = new Set();
		this._view = null;
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

	// The summary and the diff are worked out once per set of inputs, not on every
	// render: a toggle re-renders, and the diff of a large settings file is not free.
	willUpdate(changed) {
		if (!changed.has('compare') && !changed.has('open')) return;
		if (!this.open || !this.compare || !this.compare.length) { this._view = null; return; }
		const labels = makeChangeLabels();
		this._expanded = new Set();
		this._view = this.compare.map(c => ({
			label: c.label || '',
			areas: describeChanges(c.before, c.after, labels),
			diff: unifiedDiff(canonicalText(c.before), canonicalText(c.after)),
		}));
	}

	#itemText(item) {
		const i18n = window.i18n;
		if (item.kind === 'changed' && item.from !== undefined) {
			return i18n.getMessage('settingsPreviewChangeValue').replace('{name}', item.name).replace('{from}', item.from).replace('{to}', item.to);
		}
		const key = { added: 'settingsPreviewChangeAdded', removed: 'settingsPreviewChangeRemoved', changed: 'settingsPreviewChangeChanged' }[item.kind];
		return i18n.getMessage(key).replace('{name}', item.name);
	}

	#renderArea(sectionIndex, { area, items }) {
		const i18n = window.i18n;
		const id = `${sectionIndex}:${area}`;
		const open = this._expanded.has(id);
		const limit = SettingsPreviewDialog.AREA_LIMIT;
		const visible = open ? items : items.slice(0, limit);
		const SIGNS = { added: '+', removed: '\u2212', changed: '~' };
		return html`
			<h5>${i18n.getMessage(SettingsPreviewDialog.AREA_KEYS[area])}</h5>
			<ul>${visible.map(item => html`
				<li class=${item.kind}><span class="sign" aria-hidden="true">${SIGNS[item.kind]}</span><span>${this.#itemText(item)}</span></li>`)}
			</ul>
			${items.length > limit ? html`
				<button type="button" class="more" aria-expanded=${open ? 'true' : 'false'}
					@click=${() => { const next = new Set(this._expanded); if (open) next.delete(id); else next.add(id); this._expanded = next; }}>
					${open ? i18n.getMessage('settingsPreviewChangeLess') : i18n.getMessage('settingsPreviewChangeMore').replace('{n}', String(items.length - limit))}
				</button>` : ''}`;
	}

	// The diff as spans, one per line, so the CSS can tint whole rows. Built as
	// templates, not markup strings: the lines are settings values.
	#renderDiff(text) {
		const cls = (line) => (line.startsWith('+++') ? 'hdr-add' : line.startsWith('---') ? 'hdr-del'
			: line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'at' : '');
		return html`<pre class="diff">${text.split('\n').map(line => html`<span class=${cls(line)}>${line}</span>`)}</pre>`;
	}

	#renderChanges(bytes) {
		const i18n = window.i18n;
		const sections = this._view;
		const any = sections.some(s => s.areas.length);
		return html`
			<div class="changes">
				${any ? sections.map((s, i) => s.areas.length ? html`
					${s.label ? html`<h4>${s.label}</h4>` : ''}
					${s.areas.map(a => this.#renderArea(i, a))}` : '')
					: html`<p class="none">${i18n.getMessage('settingsPreviewChangeNone')}</p>`}
			</div>
			${any ? html`
				<details class="tech">
					<summary>${i18n.getMessage('settingsPreviewTechnical')}</summary>
					${sections.map(s => s.diff ? html`
						${s.label ? html`<h4>${s.label}</h4>` : ''}${this.#renderDiff(s.diff)}` : '')}
				</details>` : ''}
			<details class="full">
				<summary>${i18n.getMessage('settingsPreviewFullJson')}</summary>
				<p class="size">${i18n.getMessage('settingsPreviewSize').replace('{bytes}', String(bytes))}</p>
				<pre class="preview-json">${this.json}</pre>
			</details>`;
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
							${this.mode === 'merge' ? html`<p>${i18n.getMessage('settingsPreviewMergeCombines')}</p>` : ''}
							${this.legacy ? html`<p>${i18n.getMessage('settingsPreviewLegacy')}</p>` : ''}
							${this.dropped && this.dropped.length ? html`
								<p class="warn">${i18n.getMessage('settingsPreviewDropped').replace('{keys}', this.dropped.join(', '))}</p>` : ''}
							${this.retyped && this.retyped.length ? html`
								<p class="warn">${i18n.getMessage('settingsPreviewRetyped').replace('{keys}', this.retyped.join(', '))}</p>` : ''}
						</div>
						${this._view ? this.#renderChanges(bytes) : html`
							<p class="size">${i18n.getMessage('settingsPreviewSize').replace('{bytes}', String(bytes))}</p>
							<pre class="preview-json">${this.json}</pre>`}
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
