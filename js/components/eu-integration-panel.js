import { LitElement, html, css, unsafeHTML } from '../../js/lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { icons } from '../icons.js';

// The tier-1 switch of the gestura.eu integration. State lives in
// chrome.storage.local (GesturaEuLocal), not in the SettingsStore: consent is
// per browser and must never travel over browser sync.
//
// The switch never turns itself on. Clicking it opens the consent overlay, and
// only agreeing there persists enabled + consent; declining leaves it off. An
// inline consent block used to sit under the switch, which read as a switch that
// refused to move. Once consent is on record the panel says so, with its date and
// a way to withdraw it - withdrawing turns the integration off in the same step.
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

		/* Consent on record: a statement, not a warning. */
		.granted .setting-label span:first-child { display: inline-flex; align-items: center; gap: 8px; }
		.granted .setting-label span.granted-icon { display: inline-flex; color: var(--success-color); }
		.granted-icon svg { width: 18px; height: 18px; }
		.reconfirm { color: var(--warning-color); }
		.row-actions { display: flex; gap: 8px; flex: none; }

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

		.modal-overlay {
			position: fixed;
			inset: 0;
			z-index: 10000;
			background: rgba(0, 0, 0, 0.35);
			display: flex;
			align-items: center;
			justify-content: center;
			animation: eu-fadeIn 0.12s ease;
		}
		@keyframes eu-fadeIn { from { opacity: 0; } to { opacity: 1; } }
		@keyframes eu-slideIn { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
		.modal-panel {
			width: min(620px, 92vw);
			max-height: 88vh;
			display: flex;
			flex-direction: column;
			background: var(--card-bg);
			border-radius: 14px;
			box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--border-color);
			animation: eu-slideIn 0.12s ease;
		}
		.modal-panel:focus { outline: none; }
		.modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border-color); }
		.modal-header h3 { margin: 0; font-size: 17px; font-weight: 600; }
		.modal-body { padding: 18px 20px; overflow-y: auto; }
		.modal-body .lead { margin: 0 0 14px; font-size: 14px; line-height: 1.6; }
		.modal-body ul { margin: 0; padding-inline-start: 20px; }
		.modal-body li { margin: 10px 0; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
		.modal-body li strong { color: var(--text-primary); font-weight: 600; }
		.modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--border-color); }
	`];

	constructor() {
		super();
		this.advancedMode = false;
		this._local = null;
		this._consentOpen = false;
		this._devDraft = '';
		this._devError = false;
		this._unsubscribe = null;
		this._onKeydown = (e) => {
			// Escape declines: the switch stays where it was.
			if (e.key === 'Escape' && this._consentOpen) { e.stopPropagation(); this.#decline(); }
		};
	}

	connectedCallback() {
		super.connectedCallback();
		window.GesturaEuLocal.read().then(local => this.#absorb(local));
		this._unsubscribe = window.GesturaEuLocal.onChange(local => this.#absorb(local));
		document.addEventListener('keydown', this._onKeydown, true);
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		if (this._unsubscribe) this._unsubscribe();
		document.removeEventListener('keydown', this._onKeydown, true);
		this.#lockScroll(false);
	}

	#absorb(local) {
		this._local = local;
		// A storage change must not move the cursor or throw away an uncommitted
		// draft - and this panel triggers such changes itself (the toggle, the
		// revoke, the cache writes, a write from a second options tab). While the
		// field has focus its draft is the truth; #commitDevOrigin decides when
		// that becomes storage. renderRoot is undefined before the first render,
		// which is exactly when there is no draft to protect.
		const field = this.renderRoot && this.renderRoot.querySelector('.dev-field input');
		if (field && this.renderRoot.activeElement === field) return;
		this._devDraft = local.euIntegration.devOrigin;
	}

	get #state() { return this._local ? this._local.euIntegration : null; }
	get #effective() { return this._local ? window.FlowMouseEuIntegration.effectiveEnabled(this._local) : false; }
	get #stale() {
		const s = this.#state;
		return !!(s && s.enabled && s.consent && s.consent.version !== window.FlowMouseEuIntegration.CURRENT_INTEGRATION_CONSENT);
	}

	#lockScroll(on) {
		document.documentElement.style.overflow = on ? 'hidden' : '';
	}

	#open() {
		this._consentOpen = true;
		this.#lockScroll(true);
	}

	#onToggle(e) {
		if (e.target.checked) {
			// Nothing is persisted here — the overlay decides. Reset immediately so
			// the switch does not flash "on" before the next render.
			e.target.checked = false;
			this.#open();
			return;
		}
		this.#revoke();
	}

	// Awaited, unlike the other writes: this is the consent of record. If the write
	// fails there is nothing to show, so the overlay stays open rather than closing
	// on a decision that was never stored.
	async #accept() {
		try {
			await window.GesturaEuLocal.write({
				enabled: true,
				consent: { version: window.FlowMouseEuIntegration.CURRENT_INTEGRATION_CONSENT, date: new Date().toISOString() },
			});
		} catch {
			return;
		}
		this._consentOpen = false;
		this.#lockScroll(false);
	}

	#decline() {
		this._consentOpen = false;
		this.#lockScroll(false);
	}

	// Off and consent cleared in one step, so "off" always means "no consent on
	// record" and turning it back on always goes through the overlay again. This
	// is also the only way out of a stale consent.
	async #revoke() {
		this._consentOpen = false;
		this.#lockScroll(false);
		// A failed write leaves _local untouched, so the panel keeps showing the
		// consent that is still on record instead of a state nobody stored.
		try { await window.GesturaEuLocal.write({ enabled: false, consent: null }); } catch { /* nothing changed */ }
		// Derived from a permission that is gone: the notices go with it, and the
		// managers drop their badges on the event.
		await window.GesturaEuUpdates.clear();
		window.dispatchEvent(new Event(window.GesturaEuUpdates.CHANGED_EVENT));
	}

	async #commitDevOrigin() {
		// Origins get pasted from a browser bar far more often than typed, and those
		// carry a trailing slash that isValidDevOrigin rejects. Trim it instead of
		// blaming the user.
		const value = (this._devDraft || '').trim().replace(/\/+$/, '');
		if (value && !window.FlowMouseEuIntegration.isValidDevOrigin(value)) { this._devError = true; return; }
		this._devError = false;
		// The draft now survives a storage change (see #absorb), so it has to show
		// what was actually stored - otherwise a pasted "https://host/" keeps its
		// trailing slash on screen while storage holds the trimmed origin.
		this._devDraft = value;
		const previous = this.#state ? this.#state.devOrigin : '';
		await window.GesturaEuLocal.write({ devOrigin: value });
		// The entries imported from the previous dev origin can never be asked
		// about again, so their cached answers are dead weight that would keep
		// rendering badges.
		if (previous && previous !== value) {
			const cache = await window.GesturaEuUpdates.read();
			await window.GesturaEuUpdates.write(window.GesturaEuUpdates.dropOrigin(cache, previous));
			window.dispatchEvent(new Event(window.GesturaEuUpdates.CHANGED_EVENT));
		}
	}

	#consentDate() {
		const s = this.#state;
		const iso = s && s.consent && s.consent.date;
		if (!iso) return '';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		try {
			return d.toLocaleDateString(window.i18n.getHtmlLang(), { year: 'numeric', month: 'long', day: 'numeric' });
		} catch {
			return d.toISOString().slice(0, 10);
		}
	}

	#renderOverlay() {
		const i18n = window.i18n;
		// Each point leads with a bold label. Label and body are separate message
		// keys because messages.json holds plain text - no markup in translations.
		// The update check is point 5, after "local and reversible", because it is
		// the one thing the user has to take on board IN ADDITION to what R1
		// described - and the overlay's order goes from what the service does for
		// you towards what it costs you.
		const points = [1, 2, 3, 4, 5].map(n => [`euIntegrationConsentPoint${n}Label`, `euIntegrationConsentPoint${n}`]);
		return html`
			<div class="modal-overlay" @mousedown=${this.#decline}>
				<div class="modal-panel" tabindex="-1" @mousedown=${e => e.stopPropagation()}>
					<div class="modal-header">
						<h3>${i18n.getMessage('euIntegrationConsentTitle')}</h3>
						<button type="button" class="modal-close" @click=${this.#decline}
							aria-label=${i18n.getMessage('euIntegrationConsentCancel')}>${unsafeHTML(icons.x)}</button>
					</div>
					<div class="modal-body">
						<p class="lead">${i18n.getMessage('euIntegrationConsentLead')}</p>
						<ul>${points.map(([label, body]) => html`
							<li><strong>${i18n.getMessage(label)}</strong> ${i18n.getMessage(body)}</li>`)}</ul>
					</div>
					<div class="modal-footer">
						<button class="btn btn-secondary" @click=${this.#decline}>${i18n.getMessage('euIntegrationConsentCancel')}</button>
						<button class="btn btn-primary" @click=${this.#accept}>${i18n.getMessage('euIntegrationConsentAccept')}</button>
					</div>
				</div>
			</div>`;
	}

	updated() {
		// Focus the panel, not a button: Escape then works, and Enter cannot
		// consent by accident.
		if (this._consentOpen) this.renderRoot.querySelector('.modal-panel')?.focus();
	}

	render() {
		const i18n = window.i18n;
		const s = this.#state;
		if (!s) return html``;
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
			${this.#effective ? html`
				<div class="setting-row granted">
					<div class="setting-label">
						<span><span class="granted-icon">${unsafeHTML(icons.circleCheck)}</span>${i18n.getMessage('euIntegrationConsentGranted')}</span>
						<span>${i18n.getMessage('euIntegrationConsentDate').replace('{date}', this.#consentDate())}</span>
					</div>
					<div class="row-actions">
						<button class="btn btn-secondary" @click=${this.#revoke}>${i18n.getMessage('euIntegrationConsentRevoke')}</button>
					</div>
				</div>` : ''}
			${this.#stale ? html`
				<div class="setting-row">
					<div class="setting-label reconfirm">
						<span>${i18n.getMessage('euIntegrationReconfirmTitle')}</span>
						<span>${i18n.getMessage('euIntegrationReconfirmDesc')}</span>
					</div>
					<div class="row-actions">
						<button class="btn btn-secondary" @click=${this.#revoke}>${i18n.getMessage('euIntegrationConsentRevoke')}</button>
						<button class="btn btn-primary" @click=${this.#open}>${i18n.getMessage('tutorialContinue')}</button>
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
			${this._consentOpen ? this.#renderOverlay() : ''}
		`;
	}
}

customElements.define('eu-integration-panel', EuIntegrationPanel);
