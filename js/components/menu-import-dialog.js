import { LitElement, html, css } from '../lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { SettingsStore } from '../settings-store.js';

const X = () => window.FlowMouseMenuExchange;
const isFirefox = navigator.userAgent.includes('Firefox');

// Import-Vorschau für Gestura-Menüs/-Engines. Für alle Import-Wege (Datei, URL,
// Betreiber-Button) genutzt. Rendert nie ungeprüftes JSON: erst validate(), dann
// Anzeige aus dem normalisierten value.
class MenuImportDialog extends LitElement {
	static properties = {
		_open: { state: true },
		_result: { state: true },   // { ok, type, errors, value }
		_source: { state: true },
		_scriptAck: { state: true },
	};

	static styles = [commonStyles, optionStyles, css`
		.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex;
			align-items: center; justify-content: center; z-index: 1000; }
		.dialog { background: var(--card-bg, #fff); color: var(--text-primary, #111);
			border-radius: 10px; width: min(560px, 92vw); max-height: 86vh; overflow: auto;
			padding: 18px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); }
		.title { font-size: 15px; font-weight: 600; margin: 0 0 10px; }
		.kind { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
		.name { font-size: 16px; font-weight: 600; margin: 2px 0 8px; }
		.items { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
		.item { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 6px;
			border-radius: 6px; background: var(--bg-secondary, rgba(128,128,128,.08)); }
		.item .url { color: var(--text-muted); font-size: 11px; word-break: break-all; }
		.sep { height: 1px; background: var(--border-color); margin: 3px 0; }
		.warn { border: 1px solid var(--danger-color, #d33); border-radius: 8px; padding: 10px;
			margin: 10px 0; background: rgba(211,51,51,.06); }
		.warn h4 { margin: 0 0 6px; color: var(--danger-color, #d33); font-size: 13px; }
		.code { font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap;
			background: var(--bg-secondary, #f3f3f3); border-radius: 6px; padding: 8px; max-height: 220px;
			overflow: auto; }
		.ack { display: flex; gap: 8px; align-items: flex-start; margin: 8px 0; font-size: 13px; }
		.err { color: var(--danger-color, #d33); font-size: 13px; }
		.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
		.btn { appearance: none; font: inherit; font-size: 13px; padding: 6px 14px; border-radius: 6px;
			border: 1px solid var(--border-color, rgba(128,128,128,.35)); background: var(--card-bg, transparent);
			color: var(--text-primary, inherit); cursor: pointer; }
		.btn:hover { border-color: var(--accent-color, #2962ff); }
		.btn-primary { background: var(--accent-color, #2962ff); border-color: var(--accent-color, #2962ff); color: #fff; }
		.btn-primary:disabled { opacity: .5; cursor: not-allowed; }
	`];

	constructor() {
		super();
		this._open = false;
		this._result = null;
		this._source = null;
		this._scriptAck = false;
	}

	openWith(rawObject, source) {
		this._source = source || { type: 'file' };
		this._result = X().validate(rawObject);
		this._scriptAck = false;
		this._open = true;
	}

	#close() { this._open = false; this._result = null; }

	#lang() { try { return (window.i18n.getCurrentLanguage() || 'en').split('_')[0]; } catch { return 'en'; } }

	get #needsScriptAck() {
		const r = this._result;
		return !!(r && r.ok && r.type === 'engine' && X().hasTransform(r.value));
	}

	async #confirm() {
		const r = this._result;
		if (!r || !r.ok) return;
		const i18n = window.i18n;
		const version = r.value.version || '1.0.0';
		const source = { ...this._source, version };
		if (r.type === 'menu') {
			const { id, def } = X().toCustomMenu(r.value, source);
			const cur = SettingsStore.current.siteMenus || { disabled: [], edited: {}, custom: {}, domains: {}, order: [], flags: {}, defaultMenuId: 'search' };
			const next = { ...cur, custom: { ...cur.custom, [id]: def }, order: [...(cur.order || []), id] };
			await SettingsStore.save({ siteMenus: next });
		} else {
			const engine = X().toCustomEngine(r.value, source);
			if (isFirefox && !r.value.transformRequired) { engine.transformEnabled = false; engine.transformCode = ''; }
			const cur = SettingsStore.current.searchEngines || { overrides: {}, hidden: [], custom: [], order: [] };
			const next = { ...cur, custom: [...(cur.custom || []), engine] };
			await SettingsStore.save({ searchEngines: next });
		}
		this.dispatchEvent(new CustomEvent('import-done', { detail: { type: r.type }, bubbles: true, composed: true }));
		this.#close();
	}

	render() {
		if (!this._open) return html``;
		const i18n = window.i18n;
		const r = this._result;
		return html`<div class="backdrop" @click=${(e) => { if (e.target === e.currentTarget) this.#close(); }}>
			<div class="dialog">
				<h3 class="title">${i18n.getMessage('exchangePreviewTitle')}</h3>
				${r && r.ok ? (r.type === 'menu' ? this.#renderMenu(r.value, i18n) : this.#renderEngine(r.value, i18n)) : this.#renderError(r, i18n)}
			</div>
		</div>`;
	}

	#renderError(r, i18n) {
		const detail = (r && r.errors) ? r.errors.join(', ') : '';
		return html`
			<p class="err">${i18n.getMessage('exchangeInvalid')}</p>
			<p class="err">${i18n.getMessage('exchangeInvalidDetail').replace('$DETAIL$', detail)}</p>
			<div class="actions"><button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button></div>`;
	}

	#renderMenu(v, i18n) {
		const lang = this.#lang();
		return html`
			<div class="kind">${i18n.getMessage('exchangePreviewMenu')}</div>
			<div class="name">${X().pickLabel(v.name, lang)}</div>
			<div class="items">
				${v.items.map(it => it.type === 'separator'
					? html`<div class="sep"></div>`
					: html`<div class="item">
						<span>${X().pickLabel(it.label, lang) || it.action}</span>
						<span class="url">${it.customUrl || it.url || it.engineId || ''}</span>
					</div>`)}
			</div>
			<div class="actions">
				<button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button>
				<button class="btn btn-primary" @click=${() => this.#confirm()}>${i18n.getMessage('exchangeConfirmImport')}</button>
			</div>`;
	}

	#renderEngine(v, i18n) {
		const lang = this.#lang();
		const script = this.#needsScriptAck;
		return html`
			<div class="kind">${i18n.getMessage('exchangePreviewEngine')}</div>
			<div class="name">${X().pickLabel(v.name, lang)}</div>
			<div class="item"><span class="url">${v.url}</span></div>
			${script ? html`
				<div class="warn">
					<h4>${i18n.getMessage('exchangeScriptWarnTitle')}</h4>
					<p>${i18n.getMessage('exchangeScriptWarnBody')}</p>
					<p>${i18n.getMessage(v.transformRequired && isFirefox ? 'exchangeScriptChromeOnlyRequired' : 'exchangeScriptChromeOnly')}</p>
					<div class="code">${v.transformCode}</div>
					<label class="ack">
						<input type="checkbox" .checked=${this._scriptAck} @change=${(e) => { this._scriptAck = e.target.checked; }}>
						<span>${i18n.getMessage('exchangeScriptConfirm')}</span>
					</label>
				</div>` : ''}
			<div class="actions">
				<button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button>
				<button class="btn btn-primary" ?disabled=${script && !this._scriptAck} @click=${() => this.#confirm()}>${i18n.getMessage('exchangeConfirmImport')}</button>
			</div>`;
	}
}
customElements.define('menu-import-dialog', MenuImportDialog);
