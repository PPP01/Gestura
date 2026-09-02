import { LitElement, html, css } from '../../js/lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';

// The tier-1 switch of the gestura.eu integration. State lives in
// chrome.storage.local (GesturaEuLocal), not in the SettingsStore: consent is
// per browser and must never travel over browser sync. Turning the toggle on
// opens the consent block; only "Enable" there persists enabled + consent.
class EuIntegrationPanel extends LitElement {
	static properties = {
		advancedMode: { type: Boolean, attribute: 'advanced-mode' },
		_local: { state: true },
		_consentOpen: { state: true },
		_devDraft: { state: true },
		_devError: { state: true },
	};

	// The one URL the panel points at. Opening it is the user's own click, not
	// something the extension does on its own, so it works with the switch off.
	static SITE_URL = 'https://gestura.eu/';

	static styles = [commonStyles, optionStyles, css`
		:host { display: block; }
		.intro { padding: 16px 0 14px; font-size: 13px; line-height: 1.6; color: var(--text-secondary); }
		.intro p { margin: 0 0 8px; }
		.intro a { color: var(--accent-color); text-decoration: none; }
		.intro a:hover { text-decoration: underline; }
		.consent { margin: 8px 0 4px; padding: 14px 16px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--card-bg); }
		.consent h4 { margin: 0 0 8px; font-size: 15px; }
		.consent ul { margin: 0 0 12px 18px; padding: 0; }
		.consent li { margin: 4px 0; font-size: 13px; line-height: 1.45; }
		.consent .actions { display: flex; gap: 8px; }
		.reconfirm { color: var(--warning-color); }
		/* The row wraps only so the error can claim a line of its own; min-width:0
		   lets the label shrink instead, keeping the field beside it on line 1. */
		.dev-row { flex-wrap: wrap; }
		.dev-row .setting-label { flex: 1 1 0; min-width: 0; }
		.dev-field { flex: 0 0 260px; max-width: 100%; }
		.dev-field input { width: 100%; }
		.dev-field input.invalid { box-shadow: 0 0 0 1.5px var(--danger-color); }
		/* Full row width, below both columns: the message does not fit the input's
		   column without breaking into four lines. */
		.error { flex: 0 0 100%; margin-top: 8px; color: var(--danger-color); font-size: 12px; }
	`];

	constructor() {
		super();
		this.advancedMode = false;
		this._local = null;
		this._consentOpen = false;
		this._devDraft = '';
		this._devError = false;
		this._unsubscribe = null;
	}

	connectedCallback() {
		super.connectedCallback();
		window.GesturaEuLocal.read().then(local => this.#absorb(local));
		this._unsubscribe = window.GesturaEuLocal.onChange(local => this.#absorb(local));
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		if (this._unsubscribe) this._unsubscribe();
	}

	#absorb(local) {
		this._local = local;
		this._devDraft = local.euIntegration.devOrigin;
	}

	get #state() { return this._local ? this._local.euIntegration : null; }
	get #effective() { return this._local ? window.FlowMouseEuIntegration.effectiveEnabled(this._local) : false; }
	get #stale() {
		const s = this.#state;
		return !!(s && s.enabled && s.consent && s.consent.version !== window.FlowMouseEuIntegration.CURRENT_INTEGRATION_CONSENT);
	}

	#onToggle(e) {
		if (e.target.checked) {
			// Not persisted yet — the consent block decides.
			e.target.checked = false;
			this._consentOpen = true;
			return;
		}
		this._consentOpen = false;
		window.GesturaEuLocal.write({ enabled: false });
	}

	#accept() {
		this._consentOpen = false;
		window.GesturaEuLocal.write({
			enabled: true,
			consent: { version: window.FlowMouseEuIntegration.CURRENT_INTEGRATION_CONSENT, date: new Date().toISOString() },
		});
	}

	#cancel() { this._consentOpen = false; }

	#commitDevOrigin() {
		// Origins get pasted from a browser bar far more often than typed, and those
		// carry a trailing slash that isValidDevOrigin rejects. Trim it instead of
		// blaming the user.
		const value = (this._devDraft || '').trim().replace(/\/+$/, '');
		if (value && !window.FlowMouseEuIntegration.isValidDevOrigin(value)) { this._devError = true; return; }
		this._devError = false;
		window.GesturaEuLocal.write({ devOrigin: value });
	}

	render() {
		const i18n = window.i18n;
		const s = this.#state;
		if (!s) return html``;
		const points = ['euIntegrationConsentPoint1', 'euIntegrationConsentPoint2', 'euIntegrationConsentPoint3'];
		return html`
			<div class="intro">
				<p>${i18n.getMessage('euIntegrationIntro')}</p>
				<a href="${EuIntegrationPanel.SITE_URL}" target="_blank" rel="noopener noreferrer">${i18n.getMessage('euIntegrationIntroLink')}</a>
			</div>
			<div class="setting-row">
				<div class="setting-label">
					<span>${i18n.getMessage('euIntegrationToggle')}</span>
					<span>${i18n.getMessage('euIntegrationToggleDesc')}</span>
				</div>
				<label class="toggle">
					<input type="checkbox" .checked=${this.#effective} @change=${this.#onToggle}>
					<span class="slider"></span>
				</label>
			</div>
			${this.#stale && !this._consentOpen ? html`
				<div class="setting-row">
					<div class="setting-label reconfirm">
						<span>${i18n.getMessage('euIntegrationReconfirmTitle')}</span>
						<span>${i18n.getMessage('euIntegrationReconfirmDesc')}</span>
					</div>
					<button class="btn btn-primary" @click=${() => { this._consentOpen = true; }}>${i18n.getMessage('tutorialContinue')}</button>
				</div>` : ''}
			${this._consentOpen ? html`
				<div class="consent">
					<h4>${i18n.getMessage('euIntegrationConsentTitle')}</h4>
					<ul>${points.map(k => html`<li>${i18n.getMessage(k)}</li>`)}</ul>
					<div class="actions">
						<button class="btn btn-primary" @click=${this.#accept}>${i18n.getMessage('euIntegrationConsentAccept')}</button>
						<button class="btn" @click=${this.#cancel}>${i18n.getMessage('euIntegrationConsentCancel')}</button>
					</div>
				</div>` : ''}
			${this.#effective && this.advancedMode ? html`
				<div class="setting-row dev-row">
					<div class="setting-label">
						<span>${i18n.getMessage('euIntegrationDevOrigin')}</span>
						<span>${i18n.getMessage('euIntegrationDevOriginDesc')}</span>
					</div>
					<div class="dev-field">
						<input type="url" class="input-lg ${this._devError ? 'invalid' : ''}" placeholder="http://localhost:5173" .value=${this._devDraft}
							@input=${e => { this._devDraft = e.target.value; this._devError = false; }}
							@blur=${this.#commitDevOrigin}
							@keydown=${e => { if (e.key === 'Enter') this.#commitDevOrigin(); }}>
					</div>
					${this._devError ? html`<div class="error">${i18n.getMessage('euIntegrationDevOriginInvalid')}</div>` : ''}
				</div>` : ''}
		`;
	}
}

customElements.define('eu-integration-panel', EuIntegrationPanel);
