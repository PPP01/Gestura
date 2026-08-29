import { LitElement, html, css } from '../lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { settingsStore } from '../settings-store.js';

const X = () => window.FlowMouseMenuExchange;
const isFirefox = navigator.userAgent.includes('Firefox');

// Leerzustände, falls die Einstellungen die Zweige noch nicht kennen. Als
// Konstanten, weil Einzel- und Sammel-Import beide darauf zurückfallen.
const EMPTY_SITE_MENUS = { disabled: [], edited: {}, custom: {}, domains: {}, order: [], flags: {}, defaultMenuId: 'search' };
const EMPTY_ENGINES = { overrides: {}, hidden: [], custom: [], order: [] };

// Import-Vorschau für Gestura-Menüs/-Engines. Für alle Import-Wege (Datei, URL,
// Betreiber-Button) genutzt. Rendert nie ungeprüftes JSON: erst validate(), dann
// Anzeige aus dem normalisierten value.
class MenuImportDialog extends LitElement {
	static properties = {
		_open: { state: true },
		_result: { state: true },   // { ok, type, errors, value }
		_source: { state: true },
		_scriptAck: { state: true },
		_catalogMatch: { state: true },   // matching catalog menu / built-in engine, or null
		_importMode: { state: true },     // 'replace' | 'new'
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
		.name-row { display: flex; align-items: center; gap: 8px; margin: 2px 0 8px; }
		.name-row .name { margin: 0; }
		.favicon { width: 18px; height: 18px; border-radius: 4px; flex-shrink: 0; object-fit: contain; }
		.item .favicon { width: 16px; height: 16px; }
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
		.mode { display: flex; flex-direction: column; gap: 6px; margin: 10px 0;
			padding: 10px; border-radius: 8px; background: var(--bg-secondary, rgba(128,128,128,.08)); }
		.mode-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
		.mode-opt { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; cursor: pointer; }
		.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
	`];

	constructor() {
		super();
		this._open = false;
		this._result = null;
		this._source = null;
		this._scriptAck = false;
		this._catalogMatch = null;
		this._importMode = 'new';
	}

	openWith(rawObject, source) {
		this._source = source || { type: 'file' };
		this._result = X().validate(rawObject);
		this._scriptAck = false;
		this._catalogMatch = this._result.ok
			? (this._result.type === 'menu' ? this.#catalogMenuMatch(this._result.value) : this.#catalogEngineMatch(this._result.value))
			: null;
		this._importMode = this._catalogMatch ? 'replace' : 'new';
		this._open = true;
	}

	#close() { this._open = false; this._result = null; this._catalogMatch = null; }

	#faviconCache = new Map(); // origin -> dataURL

	async #loadFavicon(url, origin) {
		this.#faviconCache.set(origin, null); // mark inflight
		try {
			const resp = await chrome.runtime.sendMessage({ action: 'getFavicon', url });
			if (resp && resp.success && resp.icon) { this.#faviconCache.set(origin, resp.icon); this.requestUpdate(); }
		} catch { }
	}

	// Real site favicon (resolved via the background, cached by origin); shows a
	// coloured monogram immediately and upgrades in place when the icon arrives.
	#faviconSrc(url, name) {
		let origin = null;
		try { origin = url ? new URL(url).origin : null; } catch { }
		if (origin) {
			const cached = this.#faviconCache.get(origin);
			if (cached) return cached;
			if (!this.#faviconCache.has(origin)) this.#loadFavicon(url, origin);
		}
		return window.FlowMouseFavicon.monogramDataUri(name || url || '?');
	}

	#catalogMenuMatch(v) {
		const cat = (window.FlowMouseMenuCatalog && window.FlowMouseMenuCatalog.SITE_MENU_CATALOG) || [];
		return cat.find(m => m.id === v.id) || null;
	}

	#catalogEngineMatch(v) {
		const cat = (window.FlowMouseEngineCatalogApi && window.FlowMouseEngineCatalogApi.ENGINE_CATALOG) || [];
		return cat.find(e => e.id === v.id) || null;
	}

	#matchName(match, type, i18n) {
		if (!match) return '';
		if (type === 'menu') return match.name || (match.nameKey ? i18n.getMessage(match.nameKey) : '') || match.id;
		return match.name || match.id;
	}

	#renderModeChoice(i18n, match, type, mode, onMode) {
		if (!match) return '';
		const name = this.#matchName(match, type, i18n);
		return html`
			<div class="mode">
				<div class="mode-label">${i18n.getMessage('exchangeImportAs')}</div>
				<label class="mode-opt">
					<input type="radio" name="importmode-${match.id}" .checked=${mode === 'replace'}
						@change=${() => onMode('replace')}>
					<span>${i18n.getMessage('exchangeReplaceStandard').replace('{name}', name)}</span>
				</label>
				<label class="mode-opt">
					<input type="radio" name="importmode-${match.id}" .checked=${mode === 'new'}
						@change=${() => onMode('new')}>
					<span>${i18n.getMessage('exchangeAddAsNew')}</span>
				</label>
			</div>`;
	}

	#lang() { try { return (window.i18n.getCurrentLanguage() || 'en').split('_')[0]; } catch { return 'en'; } }

	get #needsScriptAck() {
		const r = this._result;
		return !!(r && r.ok && r.type === 'engine' && X().hasTransform(r.value));
	}

	// Reine Transformation: nimmt den aktuellen siteMenus-Zustand und gibt den
	// nächsten zurück, ohne zu speichern. Einzel- und Sammel-Import gehen beide
	// hierdurch, damit sie garantiert dasselbe schreiben.
	#applyMenu(cur, result, source, lang, mode, matchId) {
		if (mode === 'replace' && matchId) {
			// Standard-Menü ersetzen → verhält sich wie ein bearbeitetes Katalog-Menü.
			const def = X().toStandardMenu(result.value, lang);
			return { ...cur, edited: { ...cur.edited, [matchId]: def } };
		}
		const { id, def } = X().toCustomMenu(result.value, source, undefined, lang);
		return { ...cur, custom: { ...cur.custom, [id]: def }, order: [...(cur.order || []), id] };
	}

	// Wie #applyMenu, für searchEngines. Die Firefox-Sonderbehandlung sitzt hier,
	// damit sie auf beiden Wegen greift: dort laufen Transform-Skripte nicht,
	// also wird das Skript beim Import entfernt — außer die Engine besteht darauf.
	#applyEngine(cur, result, source, lang, mode, matchId) {
		const strip = (e) => {
			if (isFirefox && !result.value.transformRequired) { e.transformEnabled = false; e.transformCode = ''; }
			return e;
		};
		if (mode === 'replace' && matchId) {
			const ov = strip(X().toEngineOverride(result.value, lang));
			return { ...cur, overrides: { ...cur.overrides, [matchId]: ov } };
		}
		const engine = strip(X().toCustomEngine(result.value, source, undefined, lang));
		return { ...cur, custom: [...(cur.custom || []), engine] };
	}

	async #confirm() {
		const r = this._result;
		if (!r || !r.ok) return;
		const source = { ...this._source, version: r.value.version || '1.0.0' };
		const lang = this.#lang();
		const mode = this._catalogMatch ? this._importMode : 'new';
		const matchId = this._catalogMatch ? this._catalogMatch.id : null;
		const patch = r.type === 'menu'
			? { siteMenus: this.#applyMenu(settingsStore.current.siteMenus || EMPTY_SITE_MENUS, r, source, lang, mode, matchId) }
			: { searchEngines: this.#applyEngine(settingsStore.current.searchEngines || EMPTY_ENGINES, r, source, lang, mode, matchId) };
		const ok = await settingsStore.save(patch);
		if (!ok) { alert(window.i18n.getMessage('menuSyncSaveError')); return; }
		window.dispatchEvent(new Event('action-catalog-changed'));
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
			<p class="err">${i18n.getMessage('exchangeInvalidDetail').replace('{detail}', detail)}</p>
			<div class="actions"><button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button></div>`;
	}

	#renderMenuBody(v, i18n) {
		const lang = this.#lang();
		return html`
			<div class="kind">${i18n.getMessage('exchangePreviewMenu')}</div>
			<div class="name">${X().pickLabel(v.name, lang)}</div>
			<div class="items">
				${v.items.map(it => it.type === 'separator'
					? html`<div class="sep"></div>`
					: html`<div class="item">
						${(it.customUrl || it.url)
							? html`<img class="favicon" src="${this.#faviconSrc(it.customUrl || it.url, X().pickLabel(it.label, lang))}" alt="">`
							: ''}
						<span>${X().pickLabel(it.label, lang) || it.action}</span>
						<span class="url">${it.customUrl || it.url || it.engineId || ''}</span>
					</div>`)}
			</div>`;
	}

	// ack/onAck statt this._scriptAck: im Bundle-Modus hat jede Zeile ihre eigene
	// Bestätigung, im Einzelmodus ist es weiterhin der Dialog-Zustand.
	#renderEngineBody(v, i18n, ack, onAck) {
		const lang = this.#lang();
		const script = X().hasTransform(v);
		return html`
			<div class="kind">${i18n.getMessage('exchangePreviewEngine')}</div>
			<div class="name-row">
				<img class="favicon" src="${this.#faviconSrc(v.url, X().pickLabel(v.name, lang))}" alt="">
				<div class="name">${X().pickLabel(v.name, lang)}</div>
			</div>
			<div class="item"><span class="url">${v.url}</span></div>
			${script ? html`
				<div class="warn">
					<h4>${i18n.getMessage('exchangeScriptWarnTitle')}</h4>
					<p>${i18n.getMessage('exchangeScriptWarnBody')}</p>
					<p>${i18n.getMessage(v.transformRequired && isFirefox ? 'exchangeScriptChromeOnlyRequired' : 'exchangeScriptChromeOnly')}</p>
					<div class="code">${v.transformCode}</div>
					<label class="ack">
						<input type="checkbox" .checked=${ack} @change=${(e) => onAck(e.target.checked)}>
						<span>${i18n.getMessage('exchangeScriptConfirm')}</span>
					</label>
				</div>` : ''}`;
	}

	#renderMenu(v, i18n) {
		return html`
			${this.#renderMenuBody(v, i18n)}
			${this.#renderModeChoice(i18n, this._catalogMatch, 'menu', this._importMode, (m) => { this._importMode = m; })}
			<div class="actions">
				<button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button>
				<button class="btn btn-primary" @click=${() => this.#confirm()}>${i18n.getMessage('exchangeConfirmImport')}</button>
			</div>`;
	}

	#renderEngine(v, i18n) {
		const script = this.#needsScriptAck;
		return html`
			${this.#renderEngineBody(v, i18n, this._scriptAck, (c) => { this._scriptAck = c; })}
			${this.#renderModeChoice(i18n, this._catalogMatch, 'engine', this._importMode, (m) => { this._importMode = m; })}
			<div class="actions">
				<button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button>
				<button class="btn btn-primary" ?disabled=${script && !this._scriptAck} @click=${() => this.#confirm()}>${i18n.getMessage('exchangeConfirmImport')}</button>
			</div>`;
	}
}
customElements.define('menu-import-dialog', MenuImportDialog);
