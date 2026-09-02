import { LitElement, html, css } from '../../js/lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';

// The tier-1 switch of the gestura.eu integration. State lives in
// chrome.storage.local (GesturaEuLocal), not in the SettingsStore: consent is
// per browser and must never travel over browser sync. Turning the toggle on
// opens the consent block; only "Enable" there persists enabled + consent.
class EuIntegrationPanel extends LitElement {
	static properties = {
		_local: { state: true },
		_consentOpen: { state: true },
		_devDraft: { state: true },
		_devError: { state: true },
	};

	static styles = [commonStyles, optionStyles, css`
		:host { display: block; }
		.consent { margin: 8px 0 4px; padding: 14px 16px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--card-bg); }
		.consent h4 { margin: 0 0 8px; font-size: 15px; }
		.consent ul { margin: 0 0 12px 18px; padding: 0; }
		.consent li { margin: 4px 0; font-size: 13px; line-height: 1.45; }
		.consent .actions { display: flex; gap: 8px; }
		.reconfirm { color: var(--warning-color); }
		.dev input { width: 100%; max-width: 360px; }
		.error { color: var(--danger-color); font-size: 12px; margin-top: 4px; }
	`];

	constructor() {
		super();
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
			<div class="setting-row first-row">
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
					<button class="btn btn-primary" @click=${() => { this._consentOpen = true; }}>${i18n.getMessage('euIntegrationConsentAccept')}</button>
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
			${this.#effective ? html`
				<div class="setting-row dev">
					<div class="setting-label">
						<span>${i18n.getMessage('euIntegrationDevOrigin')}</span>
						<span>${i18n.getMessage('euIntegrationDevOriginDesc')}</span>
						<input type="url" placeholder="http://localhost:5173" .value=${this._devDraft}
							@input=${e => { this._devDraft = e.target.value; this._devError = false; }}
							@blur=${this.#commitDevOrigin}
							@keydown=${e => { if (e.key === 'Enter') this.#commitDevOrigin(); }}>
						${this._devError ? html`<div class="error">${i18n.getMessage('euIntegrationDevOriginInvalid')}</div>` : ''}
					</div>
				</div>` : ''}
		`;
	}
}

customElements.define('eu-integration-panel', EuIntegrationPanel);
