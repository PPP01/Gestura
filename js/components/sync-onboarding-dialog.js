import { LitElement, html, css, unsafeHTML } from '../../js/lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { icons } from '../icons.js';
import { settingsStore } from '../settings-store.js';
import { settingsErrorMessage } from './settings-preview-dialog.js';
import { syncErrorText } from './sync-reach.js';
import { checkDraft, maskCode, saveCodeFile } from './sync-code-input.js';
import { createGeneration, buildPatch, cleanupTarget, finishOnboarding } from './sync-onboarding-flow.js';
import { switchArea } from './storage-area-switch.js';

// The element that really has focus, through the shadow roots it sits in: on
// the options page document.activeElement is only <options-page>.
function deepActive() {
	let a = document.activeElement;
	while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
	return a;
}

// Best effort, never awaited by the UI: a profile under a code nobody stored
// otherwise goes with the 12-month retention.
function deleteTarget(target) {
	return window.GesturaSync.deleteStates({
		secret: target.secret, origin: target.origin, stateId: target.stateId,
		fetchImpl: (u, i) => fetch(u, i),
	}).catch(() => {});
}

// Turning on sync through gestura.eu, as a guided dialog (onboarding design §6).
// Nothing is stored until it is done: code and consent live here. Cancel at any
// step leaves sync off and the storage area where it was; a profile uploaded
// on the way is deleted again.
//
// The calls in between do not go through gated() - it knows of no sync yet.
// The wizard has its own gate: a generation token per attempt, the server from
// syncOrigin() per request, and a fresh re-read of euSync and the area before
// finishing (sync-onboarding-flow.js).
class SyncOnboardingDialog extends LitElement {
	static properties = {
		open: { type: Boolean },
		start: { type: String },      // 'choice' | 'existing' - where "Weiter" leads
		_step: { state: true },       // 'consent' | 'choice' | 'new' | 'existing'
		_code: { state: true },       // Way A's code, in clear
		_draft: { state: true },
		_draftValid: { state: true },
		_draftError: { state: true },
		_empty: { state: true },      // Way B found nothing readable: the name field follows
		_name: { state: true },
		_busy: { state: true },
		_error: { state: true },
		_retry: { state: true },
		_stopped: { state: true },    // the other-tab abort: only Close is left
		_preview: { state: true },
		_copied: { state: true },
		_opened: { state: true },
		_uploaded: { state: true },
	};

	static styles = [commonStyles, optionStyles, css`
		:host { display: contents; }
		.modal-overlay { position: fixed; inset: 0; z-index: 10000; background: rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center; }
		.modal-panel { width: min(620px, 92vw); max-height: 88vh; display: flex; flex-direction: column; background: var(--card-bg); border-radius: 14px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--border-color); }
		.modal-panel:focus { outline: none; }
		.modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border-color); }
		.modal-header h3 { margin: 0; font-size: 17px; font-weight: 600; }
		.modal-body { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px; overflow-y: auto; }
		.modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--border-color); }
		.modal-footer .spacer { flex: 1 1 auto; }
		.lead { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.55; }
		ul { margin: 0; padding-inline-start: 20px; }
		li { margin: 8px 0; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
		li strong { color: var(--text-primary); }
		.box-warn { padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5; background: color-mix(in srgb, var(--warning-color) 10%, var(--card-bg)); border: 1px solid color-mix(in srgb, var(--warning-color) 35%, transparent); }
		.ways { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
		.way { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; text-align: start; border-radius: 12px; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-primary); font: inherit; cursor: pointer; }
		.way:hover { border-color: var(--accent-color); }
		.way:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
		.way strong { font-size: 14px; }
		.way span { font-size: 13px; color: var(--text-secondary); }
		.code-line { display: flex; align-items: center; gap: 4px; padding: 4px 4px 4px 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-tertiary); }
		.code-text { flex: 1; min-width: 0; padding: 6px 4px; font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace; font-size: 13px; letter-spacing: .06em; word-break: break-all; user-select: all; }
		.icon-btn { width: 32px; height: 32px; display: grid; place-items: center; padding: 0; border-radius: 6px; border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; }
		.icon-btn svg { width: 18px; height: 18px; }
		.icon-btn:hover { color: var(--text-primary); background: color-mix(in srgb, var(--text-primary) 8%, transparent); }
		.hint { font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
		.field { height: 36px; box-sizing: border-box; min-width: 0; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--input-bg); color: var(--text-primary); font: inherit; font-size: 14px; }
		.field.mono { font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace; font-size: 13px; }
		.field.invalid { border-color: var(--danger-color); }
		.field-row { display: flex; flex-wrap: wrap; gap: 8px; }
		.field-row .field { flex: 999 1 200px; }
		.field-row .btn { flex: 1 0 auto; min-height: 36px; }
		.error { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--danger-color); font-size: 13px; }
		.connecting { font-size: 13px; color: var(--text-secondary); }
		.kept { font-size: 13px; }
		.kept code { font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace; }
		.hidden { display: none; }
	`];

	constructor() {
		super();
		this.open = false;
		this.start = 'choice';
		this._gen = createGeneration();
		this._t = 0;
		this._returnFocus = null;
		this.#reset();
		this._onKeydown = (e) => {
			// The hosted preview has its own Escape; this one only while it is closed.
			if (e.key === 'Escape' && this.open && !this._preview) { e.stopPropagation(); this.#cancel(); }
		};
	}

	// Everything a wizard session holds. Never stored.
	#reset() {
		this._step = 'consent';
		this._secret = null;     // Way A's raw secret, generated once per session
		this._code = '';
		this._stateId = '';      // generated once per session, reused by every retry
		this._draft = '';
		this._draftValid = false;
		this._draftError = '';
		this._entered = null;    // Way B's raw secret under an empty code
		this._empty = false;
		this._name = '';
		this._busy = false;
		this._error = '';
		this._retry = null;
		this._stopped = false;
		this._preview = null;
		this._copied = false;
		this._opened = null;     // { euSync, area } as read when the wizard opened
		this._failedPut = null;  // { secret, stateId, origin } of an upload that errored: it may still have landed
		this._inFlight = null;   // { secret, stateId, origin, settled } of an unanswered upload
		this._uploaded = null;   // { secret, stateId, origin, payloadHash, exportObj, name, date }
		this._finishing = false;
	}

	connectedCallback() { super.connectedCallback(); document.addEventListener('keydown', this._onKeydown, true); }
	disconnectedCallback() {
		super.disconnectedCallback();
		document.removeEventListener('keydown', this._onKeydown, true);
		if (this.open) this.#cancel();
	}

	#lockScroll(on) { document.documentElement.style.overflow = on ? 'hidden' : ''; }

	willUpdate(changed) {
		if (changed.has('open') && this.open) this.#begin();
	}

	updated(changed) {
		// The hosted preview releases the scroll lock in ITS updated(), which runs
		// after any handler here - so the lock is re-asserted from the wizard's own
		// state, after every change that could have released it.
		if (changed.has('open') || changed.has('_preview')) this.#lockScroll(this.open);
		if (!this.open) return;
		// Focus follows what the user now has to do: a new step, the name field
		// appearing under an empty code, and the return from the preview.
		const refocus = changed.has('_step') || changed.has('open') || changed.has('_empty') || changed.has('_stopped')
			|| (changed.has('_preview') && !this._preview && changed.get('_preview'));
		if (refocus) {
			const root = this.renderRoot;
			(root.querySelector('.focus-first:not([disabled])') || root.querySelector('.modal-panel'))?.focus();
		}
	}

	async #begin() {
		this.#reset();
		this._t = this._gen.next();
		this._returnFocus = deepActive();
		const t = this._t;
		const sync = await window.GesturaSyncLocal.readFresh();
		if (!this._gen.isCurrent(t)) return;
		this._opened = { euSync: sync.euSync, area: window.GesturaSettingsStorage.area() };
	}

	// Tab and Shift+Tab stay inside the dialog: aria-modal says the page behind
	// is gone, and the cards behind it would start a second onboarding.
	#onTrapKeydown(e) {
		if (e.key !== 'Tab') return;
		const panel = this.renderRoot.querySelector('.modal-panel');
		const items = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled])')];
		if (!items.length) { e.preventDefault(); return; }
		const here = this.renderRoot.activeElement;
		const first = items[0];
		const last = items[items.length - 1];
		if (e.shiftKey && (here === first || here === panel)) { e.preventDefault(); last.focus(); }
		else if (!e.shiftKey && here === last) { e.preventDefault(); first.focus(); }
	}

	// Cancel, Escape and the X: nothing stays behind (§6). Ignored while
	// finishing - past the euSync write there is nothing left to cancel.
	#cancel() {
		if (this._finishing) return;
		this._gen.next();
		const target = cleanupTarget({ uploaded: this._uploaded, inFlight: this._inFlight, failed: this._failedPut });
		if (target && target.when === 'now') deleteTarget(target);
		// Still in flight: a DELETE sent now could reach the server before the PUT
		// and leave the profile behind after all. Delete once the PUT has settled -
		// whichever way: a timeout says nothing about whether it landed.
		if (target && target.when === 'settled') this._inFlight.settled.then(() => deleteTarget(target));
		this.#close('onboarding-cancel');
	}

	#close(type, detail) {
		const back = this._returnFocus;
		this._returnFocus = null;
		this.open = false;
		this.#reset();
		this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
		if (back && typeof back.focus === 'function' && back.isConnected) back.focus();
	}

	// One request of this attempt. The answer is dropped when the attempt is no
	// longer current; an error is shown, never thrown. `fn` gets the server and
	// a fetch, and may hand back the promise it started (see #upload).
	async #request(fn) {
		const t = this._t;
		this._busy = true;
		this._error = '';
		this._retry = null;
		try {
			const origin = window.GesturaSyncLocal.syncOrigin(await window.GesturaEuLocal.read());
			const result = await fn({ origin, fetchImpl: (u, i) => fetch(u, i) });
			return this._gen.isCurrent(t) ? { result, origin } : null;
		} catch (e) {
			if (this._gen.isCurrent(t)) this._error = syncErrorText(window.i18n, e);
			return null;
		} finally {
			if (this._gen.isCurrent(t)) this._busy = false;
		}
	}

	// A retry belongs to the attempt that failed; after a cancel there is none.
	#offerRetry(t, fn) { if (this._gen.isCurrent(t)) this._retry = fn; }

	#next() { this._step = this.start === 'existing' ? 'existing' : 'choice'; }

	async #toNew() {
		if (!this._secret) {
			this._secret = window.GesturaSyncCode.generateSecret();
			this._code = await window.GesturaSyncCode.encode(this._secret);
		}
		if (!this._stateId) this._stateId = window.GesturaSyncCrypto.newStateId();
		this._step = 'new';
	}

	#back() {
		if (this._busy || this._uploaded) return;
		this._error = '';
		this._retry = null;
		if (this._step === 'new' || this._step === 'existing') { this._step = 'choice'; this._empty = false; this._entered = null; return; }
		this._step = 'consent';
	}

	async #onDraft(value) {
		this._draft = value;
		this._draftValid = false;
		this._draftError = '';
		const r = await checkDraft(value);
		if (this._draft !== value) return;
		this._draftValid = r.valid;
		this._draftError = r.error ? window.i18n.getMessage(r.error) : '';
	}

	// Way B: done as soon as the code holds at least one READABLE profile.
	// Busy from the first moment: a second Enter during parse() would otherwise
	// start a second listing and a second finish.
	async #useExisting() {
		if (this._busy || this._finishing) return;
		const t = this._t;
		this._busy = true;
		const parsed = await window.GesturaSyncCode.parse(this._draft);
		if (!this._gen.isCurrent(t)) return;
		this._busy = false;
		if (!parsed.secret) return;
		const got = await this.#request(ctx => window.GesturaSync.listStates({ ...ctx, secret: parsed.secret }));
		if (!got) { this.#offerRetry(t, () => this.#useExisting()); return; }
		if (got.result.some(s => !s.broken)) {
			await this.#finish({ secret: parsed.secret, way: 'existing' });
			return;
		}
		this._entered = parsed.secret;
		this._empty = true;
		if (!this._stateId) this._stateId = window.GesturaSyncCrypto.newStateId();
	}

	// Way A, and Way B under an empty code: the usual preview, hosted here.
	#openPreview() {
		if (this._busy || this._finishing || this._preview) return;
		const r = window.GesturaSettingsSchema.validatedExport(settingsStore.current, window.i18n.version, { forSync: true });
		if (!r.ok) { this._error = settingsErrorMessage(window.i18n, r.error); return; }
		this._preview = r;
	}

	#onPreviewCancel() { this._preview = null; }

	async #onPreviewConfirm() {
		const r = this._preview;
		this._preview = null;
		if (r) await this.#upload(r.exportObj);
	}

	async #upload(exportObj) {
		if (this._busy || this._finishing) return;
		const t = this._t;
		const secret = this._entered || this._secret;
		const name = this._name.trim();
		if (!this._uploaded) {
			const got = await this.#request(ctx => {
				// No basePayloadHash: a PUT without one replaces, so a retry after a
				// timeout that did reach the server writes the same profile again
				// instead of a second one (§6).
				const put = window.GesturaSync.uploadState({
					...ctx, secret, stateId: this._stateId, name, createdAt: '',
					exportObj, extVersion: window.i18n.version, basePayloadHash: null,
				});
				this._inFlight = { secret, stateId: this._stateId, origin: ctx.origin, settled: put.then(() => {}, () => {}) };
				return put;
			});
			if (!this._gen.isCurrent(t)) return;
			const sent = this._inFlight;
			this._inFlight = null;
			if (!got) {
				// A timed-out or failed PUT may still have reached the server: a later
				// cancel deletes that id too (harmless when it does not exist).
				if (sent) this._failedPut = { secret: sent.secret, stateId: sent.stateId, origin: sent.origin };
				this.#offerRetry(t, () => this.#upload(exportObj));
				return;
			}
			this._uploaded = { secret, stateId: this._stateId, origin: got.origin, payloadHash: got.result.payloadHash, exportObj, name, date: new Date().toISOString() };
		}
		await this.#finish({ secret, way: this._entered ? 'existing' : 'new' });
	}

	// Done. The order and its failures live in finishOnboarding(); the patch in
	// buildPatch().
	async #finish({ secret, encoded, way }) {
		if (this._finishing) return;
		const t = this._t;
		const L = window.GesturaSyncLocal;
		const S = window.GesturaSettingsStorage;
		const i18n = window.i18n;
		const u = this._uploaded;
		this._finishing = true;
		this._busy = true;
		this._error = '';
		this._retry = null;
		let res;
		try {
			const code = encoded || await window.GesturaSyncCode.encode(secret);
			const patch = buildPatch({
				opened: this._opened.euSync,
				code,
				consent: { version: L.CURRENT_SYNC_CONSENT, date: new Date().toISOString() },
				uploaded: u,
				lastUploadHash: u ? await window.GesturaSettingsSchema.hashOf(u.exportObj) : '',
			});
			res = await finishOnboarding({
				opened: this._opened,
				reread: async () => ({ euSync: (await L.readFresh()).euSync, area: await S.readAreaFresh() }),
				writeSync: (p) => L.write(p),
				patch,
				area: () => S.area(),
				switchToLocal: () => switchArea(S, 'local', 'gestura.eu'),
				writeBase: u ? () => window.GesturaSyncBase.write(u.stateId, { hash: u.payloadHash, payload: u.exportObj, date: u.date }) : null,
			});
		} catch {
			res = { ok: false, reason: 'write' };
		} finally {
			this._finishing = false;
			this._busy = false;
		}
		if (!this._gen.isCurrent(t)) return;
		if (res.ok || res.reason === 'switch') {
			// Done - or stuck at (sync, enabled): the setup exists, and the panel's
			// repair line takes over from here.
			this._uploaded = null;
			this.#close('onboarding-done', { way });
			return;
		}
		if (res.reason === 'other-tab') {
			this._error = i18n.getMessage('euSyncWizardOtherTab');
			this._stopped = true;
			const target = cleanupTarget({ uploaded: u, inFlight: null });
			if (target) deleteTarget(target);
			this._uploaded = null;
			return;
		}
		this._error = i18n.getMessage(res.reason === 'write' ? 'euSyncWizardSaveFailed' : 'storageSwitchFailed');
		this.#offerRetry(t, () => this.#finish({ secret, encoded, way }));
	}

	async #copy() {
		try {
			await navigator.clipboard.writeText(this._code);
			this._copied = true;
			setTimeout(() => { this._copied = false; }, 2000);
		} catch {
			this._error = window.i18n.getMessage('euSyncSecretCopyFailed');
		}
	}

	// A code kept by "Nur ausschalten", or a stale consent (§6): the consent step
	// names it and offers to go on with it.
	get #kept() { return this._opened && this._opened.euSync.secret ? this._opened.euSync.secret : ''; }

	#renderConsent(i18n) {
		const points = [1, 2, 3, 4, 5].map(n => [`euSyncConsentPoint${n}Label`, `euSyncConsentPoint${n}`]);
		return html`
			${this._opened && this._opened.area === 'sync' ? html`<div class="box-warn">${i18n.getMessage('euSyncWizardBrowserSyncBox')}</div>` : ''}
			<p class="lead">${i18n.getMessage('euSyncConsentLead')}</p>
			<ul>${points.map(([label, body]) => html`<li><strong>${i18n.getMessage(label)}</strong> ${i18n.getMessage(body)}</li>`)}</ul>
			${this.#kept ? html`<div class="kept">${i18n.getMessage('euSyncWizardKeptCode').replace('{code}', '')}<code>${maskCode(this.#kept)}</code></div>` : ''}`;
	}

	#renderChoice(i18n) {
		return html`
			<div class="ways">
				<button type="button" class="way focus-first" @click=${() => this.#toNew()}>
					<strong>${i18n.getMessage('euSyncWizardNewTitle')}</strong><span>${i18n.getMessage('euSyncWizardNewDesc')}</span>
				</button>
				<button type="button" class="way" @click=${() => { this._step = 'existing'; }}>
					<strong>${i18n.getMessage('euSyncWizardExistingTitle')}</strong><span>${i18n.getMessage('euSyncWizardExistingDesc')}</span>
				</button>
			</div>`;
	}

	#renderName(i18n) {
		const name = this._name.trim();
		const go = () => { if (name) this.#openPreview(); };
		return html`
			<div class="field-row">
				<input type="text" class="field focus-first" placeholder=${i18n.getMessage('euSyncWizardNamePlaceholder')}
					aria-label=${i18n.getMessage('euSyncWizardNameLabel')} .value=${this._name}
					@input=${e => { this._name = e.target.value; }}
					@keydown=${e => { if (e.key === 'Enter') go(); }}>
				<button class="btn btn-primary" ?disabled=${this._busy || !name} @click=${go}>${i18n.getMessage('euSyncWizardUploadFirst')}</button>
			</div>`;
	}

	#renderNew(i18n) {
		const copyLabel = i18n.getMessage(this._copied ? 'euSyncSecretCopied' : 'euSyncSecretCopy');
		return html`
			<div class="code-line">
				<code class="code-text">${this._code}</code>
				<button type="button" class="icon-btn" title=${copyLabel} aria-label=${copyLabel} @click=${() => this.#copy()}>${unsafeHTML(this._copied ? icons.check : icons.copy)}</button>
				<button type="button" class="icon-btn" title=${i18n.getMessage('euSyncSecretSave')} aria-label=${i18n.getMessage('euSyncSecretSave')}
					@click=${() => saveCodeFile(i18n, this._code)}>${unsafeHTML(icons.fileDown)}</button>
			</div>
			<div class="hint">${i18n.getMessage('euSyncWizardSaveHint')}</div>
			${this.#renderName(i18n)}`;
	}

	#renderExisting(i18n) {
		const apply = () => { if (this._draftValid) this.#useExisting(); };
		// Under an empty code the code field is done with: it is not rendered as
		// a disabled input (focus would fall out of the dialog), the code is
		// shown as text and the name field takes over.
		return this._empty ? html`
			<div class="kept"><code>${maskCode(this._draft.trim())}</code></div>
			<div class="hint">${i18n.getMessage('euSyncWizardExistingEmpty')}</div>
			${this.#renderName(i18n)}` : html`
			<div class="field-row">
				<input type="text" class="field mono focus-first ${this._draftError ? 'invalid' : ''}" placeholder="GS1-…"
					aria-label=${i18n.getMessage('euSyncSecretPair')} aria-invalid=${this._draftError ? 'true' : 'false'}
					spellcheck="false" autocomplete="off"
					.value=${this._draft} @input=${e => this.#onDraft(e.target.value)}
					@keydown=${e => { if (e.key === 'Enter') apply(); }}>
				<button class="btn btn-primary" ?disabled=${this._busy || !this._draftValid} @click=${apply}>${i18n.getMessage('euSyncSecretPairApply')}</button>
			</div>
			${this._draftError ? html`<div class="error" role="alert">${this._draftError}</div>` : ''}`;
	}

	render() {
		if (!this.open) return html``;
		const i18n = window.i18n;
		const step = this._step;
		const body = this._stopped ? ''
			: step === 'consent' ? this.#renderConsent(i18n)
			: step === 'choice' ? this.#renderChoice(i18n)
			: step === 'new' ? this.#renderNew(i18n)
			: this.#renderExisting(i18n);
		return html`
			<div class="modal-overlay ${this._preview ? 'hidden' : ''}" @mousedown=${() => this.#cancel()}>
				<div class="modal-panel" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="wizTitle"
					@mousedown=${e => e.stopPropagation()} @keydown=${e => this.#onTrapKeydown(e)}>
					<div class="modal-header">
						<h3 id="wizTitle">${i18n.getMessage('euSyncWizardTitle')}</h3>
						<button type="button" class="modal-close" ?disabled=${this._finishing} @click=${() => this.#cancel()} aria-label=${i18n.getMessage('euSyncConsentCancel')}>${unsafeHTML(icons.x)}</button>
					</div>
					<div class="modal-body">
						${body}
						<div class="connecting" role="status">${this._busy ? i18n.getMessage('euSyncConnecting') : ''}</div>
						${this._error ? html`
							<div class="error" role="alert">
								<span>${this._error}</span>
								${this._retry && !this._stopped ? html`<button type="button" class="btn btn-secondary" ?disabled=${this._busy} @click=${() => this._retry()}>${i18n.getMessage('euSyncRetry')}</button>` : ''}
							</div>` : ''}
					</div>
					<div class="modal-footer">
						${this._stopped ? html`<button class="btn btn-primary focus-first" @click=${() => this.#close('onboarding-cancel')}>${i18n.getMessage('euSyncWizardClose')}</button>` : html`
							${step !== 'consent' ? html`<button class="btn btn-secondary" ?disabled=${this._busy || !!this._uploaded} @click=${() => this.#back()}>${i18n.getMessage('euSyncWizardBack')}</button>` : ''}
							<span class="spacer"></span>
							<button class="btn btn-secondary" ?disabled=${this._finishing} @click=${() => this.#cancel()}>${i18n.getMessage('euSyncConsentCancel')}</button>
							${step === 'consent' && this.#kept ? html`
								<button class="btn btn-secondary" ?disabled=${this._busy} @click=${() => this.#next()}>${i18n.getMessage('euSyncWizardKeptOther')}</button>
								<button class="btn btn-primary focus-first" ?disabled=${this._busy} @click=${() => this.#finish({ encoded: this.#kept, way: 'kept' })}>${i18n.getMessage('euSyncWizardKeptContinue')}</button>` : ''}
							${step === 'consent' && !this.#kept ? html`<button class="btn btn-primary focus-first" ?disabled=${!this._opened} @click=${() => this.#next()}>${i18n.getMessage('tutorialContinue')}</button>` : ''}`}
					</div>
				</div>
			</div>
			<settings-preview-dialog
				?open=${!!this._preview}
				mode="upload"
				.json=${this._preview ? this._preview.json : ''}
				.dropped=${this._preview ? this._preview.dropped : []}
				.retyped=${this._preview ? this._preview.retyped : []}
				@preview-confirm=${() => this.#onPreviewConfirm()}
				@preview-cancel=${() => this.#onPreviewCancel()}></settings-preview-dialog>`;
	}
}

customElements.define('sync-onboarding-dialog', SyncOnboardingDialog);
