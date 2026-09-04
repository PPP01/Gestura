import { LitElement, html, css, unsafeHTML } from '../../js/lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { icons } from '../icons.js';
import { settingsStore } from '../settings-store.js';
import { settingsErrorMessage } from './settings-preview-dialog.js';

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

	// The same reasoning as CODE_ERRORS: written out, so the key is greppable and
	// a typo shows up here rather than as a blank error line.
	static SYNC_ERRORS = {
		network: 'euSyncErrorNetwork',
		'bad-request': 'euSyncErrorBadRequest',
		'not-found': 'euSyncErrorNotFound',
		'too-large': 'euSyncErrorTooLarge',
		'quota-states': 'euSyncErrorQuotaStates',
		'rate-limited': 'euSyncErrorRateLimited',
		server: 'euSyncErrorServer',
		malformed: 'euSyncErrorMalformed',
		decrypt: 'euSyncErrorDecrypt',
		disabled: 'euSyncErrorDisabled',
		'no-secret': 'euSyncErrorNoSecret',
		conflict: 'euSyncErrorConflict',
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
		_states: { state: true },
		_newName: { state: true },
		_currentHash: { state: true },
		_preview: { state: true },
		_conflict: { state: true },
		_bases: { state: true },
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
		this._states = null;      // null = not read yet, [] = read and empty
		this._newName = '';
		this._currentHash = '';
		this._preview = null;
		this._conflict = null;
		this._bases = {};        // stateId -> { hash, date }, from GesturaSyncBase.list()
		this._errorCode = '';
		// Not reactive: what willUpdate() compares against to see the switch-on
		// and the code change as EDGES, rather than re-deciding on every render.
		this._wasEffective = false;
		this._seenSecret = '';
		this._onSaved = () => this.#recomputeHash();
		this._offLocal = null;
		this._offStore = null;
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
		// settingsStore.onChange() reports EXTERNAL changes only - deliberately, so
		// a component does not react to its own write. The "changed since last
		// upload" hint needs exactly the other half: a change made on THIS page.
		// That is what gestura:settings-saved is for (js/settings-store.js).
		window.addEventListener('gestura:settings-saved', this._onSaved);
		this._offStore = settingsStore.onChange(() => this.#recomputeHash());
		document.addEventListener('keydown', this._onKeydown, true);
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		if (this._offLocal) this._offLocal();
		if (this._offSync) this._offSync();
		window.removeEventListener('gestura:settings-saved', this._onSaved);
		if (this._offStore) this._offStore();
		document.removeEventListener('keydown', this._onKeydown, true);
		this.#lockScroll(false);
	}

	get #tier1() { return this._local ? window.FlowMouseEuIntegration.effectiveEnabled(this._local) : false; }
	get #state() { return this._sync ? this._sync.euSync : null; }
	get #effective() {
		return !!(this._local && this._sync && window.GesturaSyncLocal.syncEnabled(this._local, this._sync));
	}
	// The switch is on but its consent no longer counts - a new sync text, or
	// tier 1 consented again since (see GesturaSyncLocal.syncConsentStale). Shows
	// the reconfirm row instead of a switch that silently reads "off".
	get #stale() {
		const s = this.#state;
		return !!(s && s.enabled && window.GesturaSyncLocal.syncConsentStale(this._local, this._sync));
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
		// gestura.eu sync requires browser sync off (storage-move design §4): one
		// switch, two consumers, no state in which both run. A refused switch keeps
		// the dialog open with the reason, exactly like a failed write below.
		const S = window.GesturaSettingsStorage;
		if (S.area() === 'sync') {
			const moved = await S.switchTo('local', 'gestura.eu');
			// Asked of the area, not of moved.ok: switchTo() answers
			// { ok: false, error: 'write' } when its sequence broke, and a failed
			// rollback inside it can leave the browser genuinely switched. Then the
			// requirement is met and "nothing was changed" would be untrue, so the
			// consent goes through.
			if (!moved.ok && S.area() !== 'local') {
				this._error = window.i18n.getMessage('storageSwitchFailed');
				return;
			}
		}
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
			// and user-select: all selects it in a single click - which is what the
			// message says.
			this._error = window.i18n.getMessage('euSyncSecretCopyFailed');
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
	// exist under this code. The list on screen belongs to the old code too;
	// willUpdate() sees the secret change and drops it before asking anew.
	async #adoptSecret(secret) {
		await window.GesturaSyncLocal.write({ secret: await window.GesturaSyncCode.encode(secret), states: {} });
	}

	async #useCode() {
		const parsed = await window.GesturaSyncCode.parse(this._codeDraft);
		if (!parsed.secret) {
			this._codeError = window.i18n.getMessage(EuSyncPanel.CODE_ERRORS[parsed.error]);
			return;
		}
		this._codeError = '';
		this._codeDraft = '';
		await this.#adoptSecret(parsed.secret);
	}

	async #newCode() {
		if (!confirm(window.i18n.getMessage('euSyncSecretNewConfirm'))) return;
		await this.#adoptSecret(window.GesturaSyncCode.generateSecret());
	}

	// Always the sync shape: the seven device-local keys stay home (storage-move
	// design §7). `opts` is passed through on top.
	#validatedExport(opts) {
		return window.GesturaSettingsSchema.validatedExport(settingsStore.current, window.i18n.version, { forSync: true, ...(opts || {}) });
	}

	// Validate, canonicalise and hash the whole settings tree - on every save of
	// the options page. Only while a row could show the result: for the many
	// users without sync the work would be done for nobody. willUpdate() calls
	// this when the panel becomes effective, so a hash is there by the time the
	// first list arrives, and a hash left over from an earlier switch-on is
	// never trusted.
	async #recomputeHash() {
		if (!this.#effective) return;
		try {
			const r = this.#validatedExport({ json: false });
			this._currentHash = r.ok ? await window.GesturaSettingsSchema.hashOf(r.exportObj) : '';
		} catch {
			this._currentHash = '';
		}
	}

	#fail(e) {
		this._errorCode = (e && e.code) || '';
		this._error = window.i18n.getMessage(EuSyncPanel.SYNC_ERRORS[this._errorCode] || 'euSyncErrorServer');
		// The contract puts the current updatedAt in a conflict so this line can say
		// when the state moved, without a second request.
		if (this._errorCode === 'conflict' && e.updatedAt) {
			this._error += ' ' + window.i18n.getMessage('euSyncConflictChangedAt')
				.replace('{date}', this.#formatDate(e.updatedAt));
		}
	}

	// Every server access goes through here: an error lands in a line, never in a
	// dialog, and `_busy` locks the buttons while it runs. A failed fetch leaves
	// the last list that was read standing - it is still the best information
	// there is.
	async #run(fn) {
		this._busy = true;
		this._error = '';
		this._errorCode = '';
		try {
			return await fn();
		} catch (e) {
			this.#fail(e);
			return null;
		} finally {
			this._busy = false;
		}
	}

	async #refreshStates() {
		if (!this.#effective) return;
		// Re-reading is one of the two answers to a conflict, so it clears it: what
		// the list shows afterwards is the state as it now stands.
		this._conflict = null;
		const list = await this.#run(() => window.GesturaSync.list());
		if (!list) return;
		this._states = list;
		// A base for a state the server no longer has is dropped - after a
		// SUCCESSFUL listing only; a failed one proves nothing (spec §3).
		await window.GesturaSyncBase.prune(list.map(s => s.stateId));
		this._bases = await window.GesturaSyncBase.list();
	}

	// The name comes from the decrypted meta blob and not from the local map: a
	// freshly paired second browser has no map, and the meta blob is the
	// information that belongs to the state itself.
	#nameOf(state) {
		if (state.meta && typeof state.meta.name === 'string' && state.meta.name) return state.meta.name;
		const local = this.#state.states[state.stateId];
		return (local && local.name) || state.stateId.slice(0, 8);
	}

	#openPreview(preview) { this._preview = preview; }

	async #onPreviewConfirm() {
		const preview = this._preview;
		this._preview = null;
		if (preview) await preview.commit();
	}

	// Uploading and overwriting are the same path with different ids - the preview
	// in front of it is the same both times and cannot be skipped: it IS the
	// promise made in the consent text.
	//
	// `basePayloadHash` is the hash out of the meta blob of the state being
	// replaced: it turns the write into "replace what I saw". Passing null means
	// unconditional - a new state, or the user answering a conflict with
	// "overwrite anyway". Both go through the preview again; the second transfer
	// is a transfer like any other.
	//
	// `createdAt` is the one out of the meta blob being replaced: the creation
	// date belongs to the state, and a second browser has no local record of it.
	// Empty for a new state - uploadState() dates it then.
	#uploadTo({ stateId = null, name, basePayloadHash = null, createdAt = '' }) {
		const r = this.#validatedExport();
		if (!r.ok) {
			this._error = settingsErrorMessage(window.i18n, r.error);
			return;
		}
		this.#openPreview({
			mode: 'upload',
			json: r.json,
			dropped: r.dropped,
			retyped: r.retyped,
			legacy: false,
			commit: async () => {
				const id = stateId || window.GesturaSyncCrypto.newStateId();
				const exportObj = r.exportObj;
				const done = await this.#run(() => window.GesturaSync.upload({
					stateId: id,
					name,
					createdAt,
					exportObj,
					extVersion: window.i18n.version,
					basePayloadHash,
				}));
				if (!done) {
					// Nothing was written. Remember the target, so the two ways out
					// below know what they are acting on - "overwrite anyway" is the
					// same upload without the token.
					if (this._errorCode === 'conflict') this._conflict = { stateId: id, name, createdAt, basePayloadHash: null };
					return;
				}
				this._conflict = null;
				const now = new Date().toISOString();
				// The server now holds exactly this payload under exactly this hash:
				// that pair is the base the next Sync merges against (spec §3, §6).
				await window.GesturaSyncBase.write(id, { hash: done.payloadHash, payload: exportObj, date: now });
				await window.GesturaSyncLocal.setState(id, {
					name,
					lastUploadHash: await window.GesturaSettingsSchema.hashOf(exportObj),
					lastUploadDate: now,
				});
				this._newName = '';
				await this.#refreshStates();
			},
		});
	}

	// Downloading means: decrypt, validate, show - and only then write. The
	// validator is the same one the file import uses, so a state from a newer
	// Gestura can be refused here just as clearly.
	async #downloadState(state) {
		// Without the hash from the meta blob nothing is even asked: it is the only
		// tie between meta and payload, and a state whose meta does not carry one is
		// not a state this client may open. GesturaSync.download() refuses it too -
		// it stands here so the user sees a sentence rather than an error out of the
		// network path.
		const expectPayloadHash = state.meta && state.meta.payloadHash;
		if (typeof expectPayloadHash !== 'string' || !expectPayloadHash) {
			this._error = window.i18n.getMessage('euSyncStateBroken');
			return;
		}
		const payload = await this.#run(() => window.GesturaSync.download({
			stateId: state.stateId,
			expectPayloadHash,
		}));
		if (!payload) return;
		const result = window.GesturaSettingsSchema.validate(payload, { forSync: true, local: settingsStore.current });
		if (!result.ok) {
			this._error = settingsErrorMessage(window.i18n, result.error);
			return;
		}
		this.#openPreview({
			mode: 'import',
			json: result.json,
			dropped: result.dropped,
			retyped: result.retyped,
			legacy: result.legacy,
			// The adopt path saves, runs afterSave, reloads. The base is written in
			// afterSave - after the save succeeded, so a base never names settings
			// this browser does not hold - under the hash the payload was checked
			// against, which is the hash the server holds (spec §6).
			commit: () => window.dispatchEvent(new CustomEvent('gestura:settings-apply', {
				detail: {
					settings: result.settings,
					afterSave: () => window.GesturaSyncBase.write(state.stateId, {
						hash: expectPayloadHash,
						payload: result.exportObj,
						date: new Date().toISOString(),
					}),
				},
			})),
		});
	}

	async #deleteState(state) {
		if (!confirm(window.i18n.getMessage('euSyncDeleteConfirm').replace('{name}', this.#nameOf(state)))) return;
		const done = await this.#run(() => window.GesturaSync.remove(state.stateId));
		if (!done) return;
		await window.GesturaSyncLocal.removeState(state.stateId);
		await window.GesturaSyncBase.remove(state.stateId);
		await this.#refreshStates();
	}

	async #deleteAll() {
		if (!confirm(window.i18n.getMessage('euSyncDeleteAllConfirm'))) return;
		// No stateId: this deletes everything under this locator.
		const done = await this.#run(() => window.GesturaSync.remove());
		if (!done) return;
		await window.GesturaSyncLocal.write({ states: {} });
		await window.GesturaSyncBase.clear();
		this._bases = {};
		this._states = [];
	}

	#formatDate(iso) {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		try {
			return d.toLocaleString(window.i18n.getHtmlLang(), { dateStyle: 'medium', timeStyle: 'short' });
		} catch {
			return d.toISOString().slice(0, 16).replace('T', ' ');
		}
	}

	#renderStateRow(state) {
		const i18n = window.i18n;
		const local = this.#state.states[state.stateId];
		// The hint is per state and only for states THIS browser uploaded to: for a
		// foreign state there is nothing here to compare against, and a "changed"
		// would be a claim with no basis.
		const changed = !!(local && local.lastUploadHash && this._currentHash && local.lastUploadHash !== this._currentHash);
		return html`
			<div class="sync-state-row">
				<div class="grow">
					<div class="name">${this.#nameOf(state)}</div>
					<div class="meta">
						${state.updatedAt ? i18n.getMessage('euSyncUploadedAt').replace('{date}', this.#formatDate(state.updatedAt)) : ''}
						${state.broken ? html`<span class="sync-hint"> — ${i18n.getMessage('euSyncStateBroken')}</span>` : ''}
						${!local ? html`<span> — ${i18n.getMessage('euSyncNeverUploadedHere')}</span>` : ''}
					</div>
					${changed ? html`<div class="sync-hint">${i18n.getMessage('euSyncChanged')}</div>` : ''}
				</div>
				<div class="row-actions">
					<button class="btn btn-secondary" ?disabled=${this._busy || state.broken}
						@click=${() => this.#downloadState(state)}>${i18n.getMessage('euSyncDownload')}</button>
					<button class="btn btn-secondary" ?disabled=${this._busy || state.broken}
						@click=${() => this.#uploadTo({ stateId: state.stateId, name: this.#nameOf(state), basePayloadHash: state.meta?.payloadHash, createdAt: state.meta?.createdAt })}>${i18n.getMessage('euSyncUpload')}</button>
					<button class="btn btn-danger" ?disabled=${this._busy}
						@click=${() => this.#deleteState(state)}>${i18n.getMessage('euSyncDelete')}</button>
				</div>
			</div>`;
	}

	#renderStates() {
		const i18n = window.i18n;
		const states = this._states || [];
		const full = states.length >= window.GesturaSync.LIMITS.statesMax;
		const duplicate = states.some(s => this.#nameOf(s) === this._newName.trim());
		return html`
			<div class="setting-row">
				<div class="setting-label">
					<span>${i18n.getMessage('euSyncStatesTitle')}</span>
					<span>${this._states === null || states.length ? '' : i18n.getMessage('euSyncStatesEmpty')}</span>
				</div>
				<div class="row-actions">
					<button class="btn btn-secondary" ?disabled=${this._busy}
						@click=${this.#refreshStates}>${i18n.getMessage('euSyncRefresh')}</button>
					${states.length ? html`
						<button class="btn btn-danger" ?disabled=${this._busy}
							@click=${this.#deleteAll}>${i18n.getMessage('euSyncDeleteAll')}</button>` : ''}
				</div>
			</div>
			${states.map(s => this.#renderStateRow(s))}
			${full ? html`
				<div class="notice">${i18n.getMessage('euSyncQuotaReached').replace('{max}', String(window.GesturaSync.LIMITS.statesMax))}</div>` : html`
				<div class="pair">
					<input type="text" class="input-lg" placeholder=${i18n.getMessage('euSyncStateNamePlaceholder')}
						.value=${this._newName}
						@input=${e => { this._newName = e.target.value; }}
						@keydown=${e => { if (e.key === 'Enter' && this._newName.trim()) this.#uploadTo({ name: this._newName.trim() }); }}>
					<button class="btn btn-primary" ?disabled=${this._busy || !this._newName.trim()}
						@click=${() => this.#uploadTo({ name: this._newName.trim() })}>${i18n.getMessage('euSyncCreate')}</button>
				</div>
				${duplicate ? html`<div class="notice">${i18n.getMessage('euSyncDuplicateName')}</div>` : ''}`}
			<settings-preview-dialog
				?open=${!!this._preview}
				mode=${this._preview ? this._preview.mode : 'upload'}
				.json=${this._preview ? this._preview.json : ''}
				.dropped=${this._preview ? this._preview.dropped : []}
				.retyped=${this._preview ? this._preview.retyped : []}
				?legacy=${!!(this._preview && this._preview.legacy)}
				@preview-confirm=${this.#onPreviewConfirm}
				@preview-cancel=${() => { this._preview = null; }}></settings-preview-dialog>`;
	}

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
		// Point five is the trade #accept() makes below: agreeing switches this
		// browser out of chrome.storage.sync, the browser's own sync stops carrying
		// the settings, and #revoke() does NOT switch back - putting them back would
		// blind-overwrite whatever another browser has synced in the meantime, which
		// is the reconciliation this design leaves to its own plan. A consent that
		// does not name that is not consent to it.
		const points = [1, 2, 3, 4, 5].map(n => [`euSyncConsentPoint${n}Label`, `euSyncConsentPoint${n}`]);
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

	// The list is read on two EDGES and nowhere else: sync becoming effective
	// (first load, switch-on, re-consent - in this tab or another), and the code
	// changing while it is. Both arrive as a change to _local or _sync, so they
	// are seen here, once, before the render - not decided on every render pass.
	// The first version did the latter, keyed on `_states === null`, and a failed
	// request leaves that null while re-rendering (_busy, _error): 378 requests
	// in five seconds against a server that answered 500. Only the Refresh
	// button asks again after a failure.
	willUpdate(changed) {
		if (!changed.has('_local') && !changed.has('_sync')) return;
		const effective = this.#effective;
		const secret = effective ? this.#state.secret : '';
		if (effective && (!this._wasEffective || secret !== this._seenSecret)) {
			// Whatever is on screen belongs to before the edge: the old code's rows
			// would offer to open and overwrite states that do not exist under the
			// new one, and a hash from an earlier switch-on may predate saves made
			// while sync was off.
			this._states = null;
			this.#recomputeHash();
			this.#refreshStates();
		}
		this._wasEffective = effective;
		this._seenSecret = secret;
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
			${this._conflict ? html`
				<div class="row-actions">
					<button class="btn btn-secondary" ?disabled=${this._busy}
						@click=${this.#refreshStates}>${i18n.getMessage('euSyncConflictReload')}</button>
					<button class="btn btn-secondary" ?disabled=${this._busy}
						@click=${() => this.#uploadTo(this._conflict)}>${i18n.getMessage('euSyncConflictOverwrite')}</button>
				</div>` : ''}
			${this._consentOpen ? this.#renderOverlay() : ''}
		`;
	}
}

customElements.define('eu-sync-panel', EuSyncPanel);
