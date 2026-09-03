import { LitElement, html, css, unsafeHTML } from '../../js/lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { icons } from '../icons.js';

// The second switch. It sits below the first and is not there at all while the
// first is not effectively enabled - not greyed out, not disabled, but absent:
// a visible switch that cannot do anything is precisely what the design ruled
// out for R1 and R2.
//
// The state lives in chrome.storage.local (GesturaSyncLocal), not in the
// SettingsStore: consent is per browser, and the secret must never reach the
// browser's own sync - the key would then sit with the browser vendor, and the
// whole design would be pointless.
class EuSyncPanel extends LitElement {
	// Written out rather than composed from the error code: a computed key cannot
	// be found by searching, and a typo in one would surface to the user first -
	// as an empty message beside an input field.
	static CODE_ERRORS = {
		prefix: 'euSyncCodeErrorPrefix',
		charset: 'euSyncCodeErrorCharset',
		length: 'euSyncCodeErrorLength',
		padding: 'euSyncCodeErrorPadding',
		checksum: 'euSyncCodeErrorChecksum',
	};

	static properties = {
		_local: { state: true },
		_sync: { state: true },
		_consentOpen: { state: true },
		_codeDraft: { state: true },
		_codeError: { state: true },
		_copied: { state: true },
		_busy: { state: true },
		_error: { state: true },
	};

	static styles = [commonStyles, optionStyles, css`
		:host { display: block; }
		h3 { margin: 22px 0 0; font-size: 15px; font-weight: 600; }
		.secret-row { display: block; padding: 12px 0; }
		.secret-row .actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
		.pair { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
		.pair input { flex: 1 1 320px; min-width: 0; }
		.pair input.invalid { box-shadow: 0 0 0 1.5px var(--danger-color); }
		.error { margin-top: 8px; color: var(--danger-color); font-size: 12px; }
		.notice { margin-top: 8px; color: var(--warning-color); font-size: 12px; }
		.granted .setting-label span:first-child { display: inline-flex; align-items: center; gap: 8px; }
		.granted .setting-label span.granted-icon { display: inline-flex; color: var(--success-color); }
		.granted-icon svg { width: 18px; height: 18px; }
		.reconfirm { color: var(--warning-color); }
		.row-actions { display: flex; gap: 8px; flex: none; }
		.modal-overlay { position: fixed; inset: 0; z-index: 10000; background: rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center; }
		.modal-panel { width: min(620px, 92vw); max-height: 88vh; display: flex; flex-direction: column; background: var(--card-bg); border-radius: 14px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--border-color); }
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
		this._local = null;
		this._sync = null;
		this._consentOpen = false;
		this._codeDraft = '';
		this._codeError = '';
		this._copied = false;
		this._busy = false;
		this._error = '';
		this._offLocal = null;
		this._offSync = null;
		this._onKeydown = (e) => {
			if (e.key === 'Escape' && this._consentOpen) { e.stopPropagation(); this.#decline(); }
		};
	}

	connectedCallback() {
		super.connectedCallback();
		// Two subscriptions, because two states decide what is visible here. Without
		// the first, the panel would stay on screen when the user withdraws the
		// integration in the panel above it - sitting over a switch that is no
		// longer allowed to do anything.
		window.GesturaEuLocal.read().then(local => { this._local = local; });
		window.GesturaSyncLocal.read().then(sync => { this._sync = sync; });
		this._offLocal = window.GesturaEuLocal.onChange(local => { this._local = local; });
		this._offSync = window.GesturaSyncLocal.onChange(sync => { this._sync = sync; });
		document.addEventListener('keydown', this._onKeydown, true);
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		if (this._offLocal) this._offLocal();
		if (this._offSync) this._offSync();
		document.removeEventListener('keydown', this._onKeydown, true);
		this.#lockScroll(false);
	}

	get #tier1() { return this._local ? window.FlowMouseEuIntegration.effectiveEnabled(this._local) : false; }
	get #state() { return this._sync ? this._sync.euSync : null; }
	get #effective() {
		return !!(this._local && this._sync && window.GesturaSyncLocal.syncEnabled(this._local, this._sync));
	}
	get #stale() {
		const s = this.#state;
		return !!(s && s.enabled && s.consent && s.consent.version !== window.GesturaSyncLocal.CURRENT_SYNC_CONSENT);
	}

	#lockScroll(on) { document.documentElement.style.overflow = on ? 'hidden' : ''; }

	#open() { this._consentOpen = true; this.#lockScroll(true); }
	#decline() { this._consentOpen = false; this.#lockScroll(false); }

	#onToggle(e) {
		if (e.target.checked) {
			// Nothing is stored here - the dialog decides that. Reset at once so the
			// switch does not flash "on" in the meantime.
			e.target.checked = false;
			this.#open();
			return;
		}
		this.#revoke();
	}

	// Generates the secret along with the first switch-on: sync enabled without a
	// code would be a state in which nothing works and nothing explains why. An
	// existing code is kept - switching off and on again must not orphan the
	// states.
	async #accept() {
		const patch = {
			enabled: true,
			consent: { version: window.GesturaSyncLocal.CURRENT_SYNC_CONSENT, date: new Date().toISOString() },
		};
		if (!this.#state || !this.#state.secret) {
			patch.secret = await window.GesturaSyncCode.encode(window.GesturaSyncCode.generateSecret());
		}
		try {
			await window.GesturaSyncLocal.write(patch);
		} catch {
			// Not stored, so not closed either: the dialog stays where it is instead
			// of claiming a decision that is written nowhere.
			return;
		}
		this._consentOpen = false;
		this.#lockScroll(false);
	}

	// Off and consent cleared in one step, as with the switch above: "off" then
	// always means "no consent on record", and switching back on always goes
	// through the text. The code and the states stay - they are local data, and
	// the user did not withdraw them.
	async #revoke() {
		this._consentOpen = false;
		this.#lockScroll(false);
		this._error = '';
		try { await window.GesturaSyncLocal.write({ enabled: false, consent: null }); } catch { /* nothing changed */ }
	}

	async #copyCode() {
		try {
			await navigator.clipboard.writeText(this.#state.secret);
			this._copied = true;
			setTimeout(() => { this._copied = false; }, 2000);
		} catch {
			// The clipboard refused (focus, permission): the code is on screen in full
			// and user-select: all selects it in a single click.
			this._error = window.i18n.getMessage('euSyncSecretCopy');
		}
	}

	// A blob and an <a download> - no downloads permission. The header line goes
	// into the file because a file holding nothing but a code tells nobody what it
	// is a year from now.
	#saveCode() {
		const i18n = window.i18n;
		const header = i18n.getMessage('euSyncSecretFileHeader').replace('{date}', new Date().toISOString().slice(0, 10));
		const blob = new Blob([header + '\n\n' + this.#state.secret + '\n'], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'gestura-sync-secret.txt';
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 10000);
	}

	// A different code means a different locator, different state ids, different
	// hashes. The local map belongs to the old code and goes with it - otherwise
	// names and "changed since last upload" would be shown for states that do not
	// exist under this code.
	async #useCode() {
		const parsed = await window.GesturaSyncCode.parse(this._codeDraft);
		if (!parsed.secret) {
			this._codeError = window.i18n.getMessage(EuSyncPanel.CODE_ERRORS[parsed.error]);
			return;
		}
		this._codeError = '';
		this._codeDraft = '';
		await window.GesturaSyncLocal.write({ secret: await window.GesturaSyncCode.encode(parsed.secret), states: {} });
		await this.#refreshStates();
	}

	async #newCode() {
		if (!confirm(window.i18n.getMessage('euSyncSecretNewConfirm'))) return;
		await window.GesturaSyncLocal.write({
			secret: await window.GesturaSyncCode.encode(window.GesturaSyncCode.generateSecret()),
			states: {},
		});
		await this.#refreshStates();
	}

	// Task 10 fills these in. Here already so the two callers above can stand.
	async #refreshStates() { /* Task 10 */ }
	#renderStates() { return ''; }

	#consentDate() {
		const iso = this.#state && this.#state.consent && this.#state.consent.date;
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
		const points = [1, 2, 3, 4].map(n => [`euSyncConsentPoint${n}Label`, `euSyncConsentPoint${n}`]);
		return html`
			<div class="modal-overlay" @mousedown=${this.#decline}>
				<div class="modal-panel" tabindex="-1" @mousedown=${e => e.stopPropagation()}>
					<div class="modal-header">
						<h3>${i18n.getMessage('euSyncConsentTitle')}</h3>
						<button type="button" class="modal-close" @click=${this.#decline}
							aria-label=${i18n.getMessage('euSyncConsentCancel')}>${unsafeHTML(icons.x)}</button>
					</div>
					<div class="modal-body">
						<p class="lead">${i18n.getMessage('euSyncConsentLead')}</p>
						<ul>${points.map(([label, body]) => html`
							<li><strong>${i18n.getMessage(label)}</strong> ${i18n.getMessage(body)}</li>`)}</ul>
					</div>
					<div class="modal-footer">
						<button class="btn btn-secondary" @click=${this.#decline}>${i18n.getMessage('euSyncConsentCancel')}</button>
						<button class="btn btn-primary" @click=${this.#accept}>${i18n.getMessage('euSyncConsentAccept')}</button>
					</div>
				</div>
			</div>`;
	}

	#renderSecret() {
		const i18n = window.i18n;
		const origin = window.GesturaSyncLocal.syncOrigin(this._local);
		return html`
			<div class="setting-row secret-row">
				<div class="setting-label">
					<span>${i18n.getMessage('euSyncSecretTitle')}</span>
					<span>${i18n.getMessage('euSyncSecretDesc')}</span>
				</div>
				<code class="secret-code">${this.#state.secret}</code>
				<div class="actions">
					<button class="btn btn-secondary" @click=${this.#copyCode}>
						${this._copied ? i18n.getMessage('euSyncSecretCopied') : i18n.getMessage('euSyncSecretCopy')}
					</button>
					<button class="btn btn-secondary" @click=${this.#saveCode}>${i18n.getMessage('euSyncSecretSave')}</button>
					<button class="btn btn-secondary" @click=${this.#newCode}>${i18n.getMessage('euSyncSecretNew')}</button>
				</div>
				<div class="setting-label" style="margin-top:14px">
					<span>${i18n.getMessage('euSyncSecretPair')}</span>
					<span>${i18n.getMessage('euSyncSecretPairDesc')}</span>
				</div>
				<div class="pair">
					<input type="text" class="input-lg ${this._codeError ? 'invalid' : ''}" placeholder="GS1-…"
						.value=${this._codeDraft}
						@input=${e => { this._codeDraft = e.target.value; this._codeError = ''; }}
						@keydown=${e => { if (e.key === 'Enter') this.#useCode(); }}>
					<button class="btn btn-secondary" @click=${this.#useCode}>${i18n.getMessage('euSyncSecretPairApply')}</button>
				</div>
				${this._codeError ? html`<div class="error">${this._codeError}</div>` : ''}
				${origin !== window.FlowMouseEuIntegration.PRODUCTION_ORIGIN ? html`
					<div class="notice">${i18n.getMessage('euSyncDevOriginNotice').replace('{origin}', origin)}</div>` : ''}
			</div>`;
	}

	updated() {
		if (this._consentOpen) this.renderRoot.querySelector('.modal-panel')?.focus();
	}

	render() {
		const i18n = window.i18n;
		// No switch while the integration is not effectively enabled. Absent, not
		// greyed out: there is nothing to explain that the user cannot see for
		// themselves one line further up.
		if (!this.#tier1 || !this._sync) return html``;
		return html`
			<h3>${i18n.getMessage('euSyncHeading')}</h3>
			<div class="setting-row">
				<div class="setting-label">
					<span>${i18n.getMessage('euSyncToggle')}</span>
					<span>${i18n.getMessage('euSyncToggleDesc')}</span>
				</div>
				<label class="toggle">
					<input type="checkbox" .checked=${this.#effective} @change=${this.#onToggle}>
					<span class="slider"></span>
				</label>
			</div>
			${this.#effective ? html`
				<div class="setting-row granted">
					<div class="setting-label">
						<span><span class="granted-icon">${unsafeHTML(icons.circleCheck)}</span>${i18n.getMessage('euSyncConsentGranted')}</span>
						<span>${i18n.getMessage('euSyncConsentDate').replace('{date}', this.#consentDate())}</span>
					</div>
					<div class="row-actions">
						<button class="btn btn-secondary" @click=${this.#revoke}>${i18n.getMessage('euSyncConsentRevoke')}</button>
					</div>
				</div>` : ''}
			${this.#stale ? html`
				<div class="setting-row">
					<div class="setting-label reconfirm">
						<span>${i18n.getMessage('euSyncReconfirmTitle')}</span>
						<span>${i18n.getMessage('euSyncReconfirmDesc')}</span>
					</div>
					<div class="row-actions">
						<button class="btn btn-secondary" @click=${this.#revoke}>${i18n.getMessage('euSyncConsentRevoke')}</button>
						<button class="btn btn-primary" @click=${this.#open}>${i18n.getMessage('tutorialContinue')}</button>
					</div>
				</div>` : ''}
			${this.#effective && this.#state.secret ? this.#renderSecret() : ''}
			${this.#effective ? this.#renderStates() : ''}
			${this._error ? html`<div class="error">${this._error}</div>` : ''}
			${this._consentOpen ? this.#renderOverlay() : ''}
		`;
	}
}

customElements.define('eu-sync-panel', EuSyncPanel);
