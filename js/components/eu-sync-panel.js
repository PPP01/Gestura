import { LitElement, html, css, unsafeHTML, nothing } from '../../js/lib/lit-all.min.js';
import { commonStyles, optionStyles, tabStyles } from './shared-styles.js';
import { icons } from '../icons.js';
import { settingsStore } from '../settings-store.js';
import { settingsErrorMessage } from './settings-preview-dialog.js';
import { formatMergeSummary } from './sync-merge-dialog.js';
import { rowModel } from './eu-sync-row.js';

// The sync switch and everything behind it. Sync is a feature of its own, with
// its own consent; it does not need the gestura.eu integration above it, and
// turning that off leaves sync alone. The integration's state is still read -
// for the server to talk to (its developer origin), never as a permission.
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
		stale: 'euSyncErrorStale',
		disabled: 'euSyncErrorDisabled',
		'no-secret': 'euSyncErrorNoSecret',
		conflict: 'euSyncErrorConflict',
	};

	static properties = {
		_local: { state: true },
		_sync: { state: true },
		_consentOpen: { state: true },
		_offOpen: { state: true },
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
		_merge: { state: true },
		_notice: { state: true },
		_features: { state: true },
		_tab: { state: true },
		_codeVisible: { state: true },
		_ask: { state: true },
		_pairOpen: { state: true },
		_codeValid: { state: true },
		_switchUnlocked: { state: true },
	};

	static styles = [commonStyles, optionStyles, tabStyles, css`
		:host { display: block; }
		.error { margin-top: 8px; color: var(--danger-color); font-size: 12px; }
		.notice { margin-top: 8px; color: var(--warning-color); font-size: 12px; }
		.reconfirm { color: var(--warning-color); }
		.row-actions { display: flex; gap: 8px; flex: none; }

		/* Everything below follows the design hand-off (Richtung 1a, Meldungen 2a).
		   Colours come from the page's variables only; tints are color-mix(). */
		/* Inline, like the tab bars of the other sections (options-page .basic-tabs). */
		.type-switch.sync-tabs { display: inline-flex; margin: 14px 0 0; }
		.sync-card-gap { margin-top: 12px; }
		.sync-on { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 13px; color: var(--text-secondary); }
		.sync-on strong { font-weight: 600; color: var(--text-primary); }
		.sync-on svg { width: 16px; height: 16px; color: var(--success-color); }
		.pair-box { display: flex; flex-direction: column; gap: 8px; }
		.pair-desc { font-size: 13px; color: var(--text-secondary); }
		.msg.warn { padding: 4px 12px; background: color-mix(in srgb, var(--warning-color) 10%, var(--card-bg)); border: 1px solid color-mix(in srgb, var(--warning-color) 35%, transparent); }
		.msg.warn > svg { width: 18px; height: 18px; margin-top: 7px; color: var(--warning-color); }
		.msg.warn .msg-text { font-size: 13px; }
		.switch-lock { flex-wrap: wrap; align-items: flex-start; padding: 6px 8px 6px 12px; }
		.switch-lock .msg-text { flex: 1 1 260px; }
		.switch-lock .btn { margin-left: auto; align-self: center; }
		.delete-all-row { margin: -8px 0 16px; }
		.sync-card { display: flex; flex-direction: column; gap: 12px; margin: 12px 0 20px; padding: 20px; border-radius: 14px; border: 1px solid var(--border-color); background: var(--card-bg); line-height: 1.45; }
		.sync-card.states { gap: 16px; }
		.card-title { font-size: 15px; font-weight: 600; }
		.card-desc { margin-top: -8px; font-size: 13px; color: var(--text-secondary); }
		svg { flex: none; }

		/* A 32px target with an 18px glyph, quiet until hovered. Labels live in
		   title and aria-label. */
		.icon-btn { width: 32px; height: 32px; flex: none; display: grid; place-items: center; padding: 0; border-radius: 6px; border: 1px solid transparent; background: transparent; color: var(--text-secondary); cursor: pointer; }
		.icon-btn svg { width: 18px; height: 18px; }
		.icon-btn:hover:not(:disabled):not([aria-disabled="true"]) { background: color-mix(in srgb, var(--text-primary) 8%, transparent); color: var(--text-primary); }
		.icon-btn:focus-visible, .text-btn:focus-visible, .ghost-btn:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
		.icon-btn:disabled, .icon-btn[aria-disabled="true"] { opacity: .38; cursor: not-allowed; }
		.icon-btn.accent { color: var(--accent-color); background: color-mix(in srgb, var(--accent-color) 14%, transparent); }
		.icon-btn.accent:hover:not(:disabled) { color: var(--accent-color); background: color-mix(in srgb, var(--accent-color) 24%, transparent); }
		.icon-btn.danger { color: var(--danger-color); }
		.icon-btn.danger:hover:not(:disabled) { color: var(--danger-color); background: color-mix(in srgb, var(--danger-color) 12%, transparent); }
		.icon-btn.danger:focus-visible { outline-color: var(--danger-color); }
		.ghost-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; font-size: 13px; color: var(--text-secondary); cursor: pointer; }
		.ghost-btn svg { width: 16px; height: 16px; }
		.ghost-btn:hover:not(:disabled) { color: var(--text-primary); background: color-mix(in srgb, var(--text-primary) 8%, transparent); }
		.ghost-btn.danger { color: var(--danger-color); }
		.ghost-btn.danger:hover:not(:disabled) { color: var(--danger-color); background: color-mix(in srgb, var(--danger-color) 10%, transparent); }
		.ghost-btn:disabled { opacity: .5; cursor: default; }
		.text-btn { min-height: 32px; padding: 0 2px; border: 0; background: none; font-size: 13px; color: var(--text-secondary); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
		.text-btn:hover { color: var(--text-primary); }
		.field { height: 36px; box-sizing: border-box; min-width: 0; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--input-bg); color: var(--text-primary); font: inherit; font-size: 14px; }
		.field.mono { font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace; font-size: 13px; }
		.field.invalid { border-color: var(--danger-color); }
		.field-row { display: flex; flex-wrap: wrap; gap: 8px; }
		.field-row .field { flex: 999 1 200px; }
		.field-row .btn { flex: 1 0 auto; min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
		.field-row .btn svg { width: 16px; height: 16px; }
		.field-row.full { opacity: .5; }

		/* The code. Masked by default: what the eye does not need to see, a
		   screenshot or a shoulder does not get. Copy and Save work either way. */
		.code-line { display: flex; align-items: center; gap: 2px; padding: 4px 4px 4px 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-tertiary); }
		.code-line > .lock { display: inline-flex; color: var(--text-secondary); }
		.code-line > .lock svg { width: 16px; height: 16px; }
		.code-text { flex: 1; min-width: 0; padding: 6px 8px; font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace; font-size: 13px; letter-spacing: .06em; word-break: break-all; user-select: none; }
		.code-text.shown { user-select: all; }
		.code-foot.end { justify-content: flex-end; }
		.code-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; font-size: 13px; color: var(--text-secondary); }

		/* The list. */
		.states-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
		.states-head .title { display: flex; align-items: baseline; gap: 8px; }
		.states-head .count { font-size: 13px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
		.states-head .tools { display: flex; flex-wrap: wrap; gap: 4px; }
		.empty { padding: 28px 16px; border-radius: 10px; border: 1px dashed var(--border-color); text-align: center; font-size: 14px; color: var(--text-secondary); }
		.rows { display: flex; flex-direction: column; gap: 12px; }
		.state { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 10px; }
		.rail { position: relative; }
		.state:not(:last-child) .rail::before { content: ''; position: absolute; left: 9px; top: 24px; bottom: -30px; width: 2px; background: var(--border-color); }
		.dot { position: relative; box-sizing: border-box; width: 12px; height: 12px; margin: 18px 0 0 4px; border-radius: 50%; background: var(--card-bg); border: 2px solid var(--text-secondary); }
		.state.active .dot { background: var(--accent-color); border-color: var(--accent-color); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-color) 22%, transparent); }
		.state.broken .dot { border: 2px dashed var(--danger-color); }
		.state-card { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 12px 8px 12px 16px; border-radius: 10px; border: 1px solid var(--border-color); background: var(--card-bg); }
		.state.active .state-card { border-color: var(--accent-color); background: color-mix(in srgb, var(--accent-color) 5%, var(--card-bg)); }
		.state.broken .state-card { border: 1px dashed color-mix(in srgb, var(--danger-color) 55%, transparent); background: transparent; }
		.state-text { flex: 1 1 220px; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
		.state-name { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
		.badge-active { display: inline-block; margin-inline-start: 6px; padding: 2px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; vertical-align: 2px; color: var(--accent-color); background: color-mix(in srgb, var(--accent-color) 14%, transparent); }
		.state-date { font-size: 13px; color: var(--text-secondary); }
		.hint { display: flex; align-items: flex-start; gap: 6px; margin-top: 2px; font-size: 13px; color: var(--text-secondary); }
		.hint svg { width: 14px; height: 14px; margin-top: 2px; }
		.hint.changed { color: var(--text-primary); }
		.hint.changed svg { color: var(--warning-color); }
		.broken-title { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: var(--danger-color); }
		.broken-title svg { width: 16px; height: 16px; }
		.state-actions { display: flex; align-items: center; gap: 2px; margin-left: auto; flex: none; }
		.state-actions .sep { width: 1px; height: 20px; margin: 0 4px; background: var(--border-color); }
		.full-note { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; color: var(--text-secondary); }
		.full-note svg { width: 16px; height: 16px; margin-top: 1px; }

		/* Messages, directly under the list's head: the small red line at the foot of
		   the panel was never seen by anyone who had just pressed a button in a row. */
		.msg { display: flex; gap: 10px; border-radius: 10px; }
		.msg.error-banner { padding: 8px 6px 8px 12px; background: color-mix(in srgb, var(--danger-color) 10%, var(--card-bg)); border: 1px solid color-mix(in srgb, var(--danger-color) 30%, transparent); }
		.msg.error-banner > svg { width: 18px; height: 18px; margin-top: 7px; color: var(--danger-color); }
		.msg .msg-text { flex: 1; min-width: 0; padding: 6px 0; font-size: 14px; color: var(--text-primary); }
		.msg.info { align-items: center; padding: 8px 12px; background: var(--bg-tertiary); font-size: 13px; color: var(--text-secondary); }
		.msg.info svg { width: 16px; height: 16px; color: var(--success-color); }
		.msg.conflict { flex-direction: column; padding: 12px; background: color-mix(in srgb, var(--warning-color) 10%, var(--card-bg)); border: 1px solid color-mix(in srgb, var(--warning-color) 35%, transparent); }
		.msg.conflict .line { display: flex; gap: 10px; font-size: 14px; color: var(--text-primary); }
		.msg.conflict .line svg { width: 18px; height: 18px; color: var(--warning-color); }
		.msg.conflict .ways { display: flex; flex-wrap: wrap; gap: 8px; padding-left: 28px; }
		.msg.conflict .ways .btn { min-height: 32px; font-size: 13px; font-weight: 600; }
		.btn-danger-outline { color: var(--danger-color); background: transparent; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger-color) 45%, transparent); }
		.btn-danger-outline:hover:not(:disabled) { background: color-mix(in srgb, var(--danger-color) 8%, transparent); }
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
		/* The destructive choice sits apart from the safe ones, on the far side. */
		.off-footer { flex-wrap: wrap; }
		.off-footer .off-spacer { flex: 1 1 auto; }
		.off-delete-note { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
		/* The small question dialog (#ask): the browser's confirm() and prompt() could
		   not be styled, wrapped long text badly and said "chrome-extension://..." as
		   their title. */
		.modal-panel.small { width: min(480px, 92vw); }
		.ask-text { margin: 0; font-size: 14px; line-height: 1.6; white-space: pre-line; }
		.ask-field { width: 100%; margin-top: 12px; }
		/* What the answer costs, counted: set apart from the explanation above it. */
		.ask-note { margin: 12px 0 0; font-size: 14px; font-weight: 600; line-height: 1.5; color: var(--text-primary); }
		.ask-note.danger { color: var(--danger-color); }
	`];

	constructor() {
		super();
		this._local = null;
		this._sync = null;
		this._consentOpen = false;
		this._offOpen = false;     // the "turn sync off?" dialog
		this._codeDraft = '';
		this._codeError = '';
		this._copied = false;
		this._busy = false;
		// Not reactive: what _busy is derived from. Several #run()s can be in flight
		// at once (an action's own refresh, then its request), and the first to finish
		// must not unlock buttons the second still needs locked.
		this._pending = 0;
		this._op = false;
		this._error = '';
		this._states = null;      // null = not read yet, [] = read and empty
		this._newName = '';
		this._currentHash = '';
		this._preview = null;
		this._conflict = null;
		this._bases = {};        // stateId -> { hash, date }, from GesturaSyncBase.list()
		this._merge = null;      // { state, merged, choices, attempt, expect } while the dialog is open
		this._notice = '';       // one informational line (in sync, moved again)
		this._features = new Set(); // what the service announced in its last list
		this._errorCode = '';
		// 'states' | 'settings'. The code lives under Settings: it is set up once,
		// the states are what is used. Switching sync on lands there (#accept).
		this._tab = 'states';
		this._codeVisible = false;  // never stored: every visit starts masked
		this._ask = null;           // the open #ask() dialog, see there
		this._pairOpen = false;     // the "load existing code" field is shown
		this._codeValid = false;    // what is in that field parses as a code
		// "Change code" opened despite states under the current code. Never stored:
		// a reload or a tab switch locks it again.
		this._switchUnlocked = false;
		// Not reactive: set by #useCode, read by #absorbList - the code just loaded
		// and how many states the old one had, so the first list under the new code
		// can say "found them" and switch to them.
		this._loadedFrom = null;
		this._noticeTimer = 0;
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
			if (e.key === 'Escape' && this._offOpen) { e.stopPropagation(); this.#closeOff(); }
			if (e.key === 'Escape' && this._ask) { e.stopPropagation(); this.#answer(null); }
		};
	}

	connectedCallback() {
		super.connectedCallback();
		// Two subscriptions: sync's own state decides everything shown here; the
		// integration's only supplies the developer origin, which the code row
		// names when sync is not talking to production.
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
		clearTimeout(this._noticeTimer);
		if (this._ask) this.#answer(null);
		this.#lockScroll(false);
	}

	// A question in a dialog of our own, answered through a promise: null when
	// cancelled, otherwise true - or, with `input`, the trimmed text. Awaited from
	// inside #exclusive, so nothing else starts while it is open.
	//   { title, text, confirm, danger, input }
	#ask(opts) {
		return new Promise(resolve => {
			this._ask = { ...opts, value: opts.input || '', resolve };
			this.#lockScroll(true);
		});
	}

	#answer(value) {
		const ask = this._ask;
		if (!ask) return;
		this._ask = null;
		this.#lockScroll(false);
		ask.resolve(value);
	}

	#confirmAsk() {
		const ask = this._ask;
		if (!ask) return;
		if (ask.input === undefined) { this.#answer(true); return; }
		const value = ask.value.trim();
		if (value) this.#answer(value);
	}

	get #state() { return this._sync ? this._sync.euSync : null; }
	get #effective() {
		return !!(this._sync && window.GesturaSyncLocal.syncEnabled(this._sync));
	}
	// The switch is on but its consent no longer counts - the sync text changed
	// (see GesturaSyncLocal.syncConsentStale). Shows the reconfirm row instead of
	// a switch that silently reads "off".
	get #stale() {
		const s = this.#state;
		return !!(s && s.enabled && window.GesturaSyncLocal.syncConsentStale(this._sync));
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
		// Not off yet: the dialog asks first. Reset so the switch does not show
		// "off" for a decision that has not been made.
		e.target.checked = true;
		this.#openOff();
	}

	// Turning sync off asks first, and says what it means: nothing is deleted,
	// the code stays, the states stay. Deleting everything is offered there as a
	// separate, explicit choice - never as a side effect of the switch.
	#openOff() { this._offOpen = true; this.#lockScroll(true); }
	#closeOff() { this._offOpen = false; this.#lockScroll(false); }

	async #offKeep() {
		this.#closeOff();
		await this.#revoke();
	}

	// Server first, then this browser, then the switch - in that order, because
	// the server can only be reached while sync is still on (gated() refuses
	// otherwise). If the server refuses or cannot be reached, nothing here is
	// touched and sync stays on, with the reason in the banner: half a deletion
	// - the code gone here, the states still there - would leave states nobody
	// can reach any more but the retention period.
	async #offDeleteAll() {
		this.#closeOff();
		const done = await this.#run(() => window.GesturaSync.remove());
		if (!done) return;
		await window.GesturaSyncBase.clear();
		this._bases = {};
		this._states = [];
		try {
			await window.GesturaSyncLocal.write({ enabled: false, consent: null, secret: '', states: {} });
		} catch { /* the states are gone either way; the switch can be turned off again */ }
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
		// The first thing to do with sync on is to put the code somewhere safe - or
		// to enter the one from the other browser.
		this._tab = 'settings';
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
			// The clipboard refused (focus, permission): the code is uncovered, and
			// user-select: all selects it in a single click - which is what the
			// message says.
			this._codeVisible = true;
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

	// Loading another code is the same step as making a new one, seen from the
	// states of the old code: they stay on gestura.eu, out of reach of this
	// browser. So it asks the same question - unless the old code has nothing
	// under it, where there is nothing to lose. A list that was never read (or
	// failed) is not "nothing": it asks then too.
	async #useCode() {
		const i18n = window.i18n;
		const parsed = await window.GesturaSyncCode.parse(this._codeDraft);
		if (!parsed.secret) {
			this._codeError = i18n.getMessage(EuSyncPanel.CODE_ERRORS[parsed.error]);
			return;
		}
		this._codeError = '';
		const encoded = await window.GesturaSyncCode.encode(parsed.secret);
		if (encoded === this.#state.secret) { this.#closePair(); return; }
		const had = this._states ? this._states.length : null;
		if (had !== 0) {
			const [, ...rest] = i18n.getMessage('euSyncSecretNewConfirm').split('\n\n');
			if (!await this.#ask({
				title: i18n.getMessage('euSyncSecretUseConfirmTitle'),
				note: this.#countLine('euSyncReplaceCount'),
				text: rest.join('\n\n'),
				confirm: i18n.getMessage('euSyncSecretPairApply'),
			})) return;
		}
		this._loadedFrom = { secret: encoded, had };
		this.#closePair();
		this._switchUnlocked = false;
		await this.#adoptSecret(parsed.secret);
	}

	// The count a dialog names: the states under the current code as the list last
	// read them. '' when there is nothing to name - no list was read, or it is
	// empty - so no dialog ever says "0 states".
	#countLine(key) {
		const n = this._states ? this._states.length : 0;
		if (!n) return '';
		const i18n = window.i18n;
		const states = n === 1 ? i18n.getMessage('euSyncStatesOne') : i18n.getMessage('euSyncStatesMany').replace('{n}', String(n));
		return i18n.getMessage(key).replace('{states}', states);
	}

	#openPair() { this._pairOpen = true; }
	#closePair() { this._pairOpen = false; this._codeDraft = ''; this._codeError = ''; this._codeValid = false; }

	// The button only goes live for a code that parses - prefix, alphabet,
	// length and checksum. A wrong character or a wrong prefix is said at once;
	// a typo the checksum catches only once the code is complete, because before
	// that every code is incomplete. "Too short" is never said while typing: the
	// grey button says it. parse() is async, so an answer for a draft that has
	// changed since is dropped.
	async #onCodeInput(value) {
		this._codeDraft = value;
		this._codeValid = false;
		this._codeError = '';
		const parsed = await window.GesturaSyncCode.parse(value);
		if (this._codeDraft !== value) return;
		this._codeValid = !!parsed.secret;
		const early = parsed.error === 'charset' || (parsed.error === 'prefix' && value.trim().length >= 3);
		if (early || parsed.error === 'padding' || parsed.error === 'checksum') {
			this._codeError = window.i18n.getMessage(EuSyncPanel.CODE_ERRORS[parsed.error]);
		}
	}

	async #newCode() {
		const i18n = window.i18n;
		// The message is a question, a blank line, and the explanation.
		const [title, ...rest] = i18n.getMessage('euSyncSecretNewConfirm').split('\n\n');
		if (!await this.#ask({
			title,
			note: this.#countLine('euSyncReplaceCount'),
			text: rest.join('\n\n'),
			confirm: i18n.getMessage('euSyncSecretNew'),
		})) return;
		this._switchUnlocked = false;
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
	// dialog, and `_pending` counts the requests in flight (see #syncBusy). A failed fetch leaves
	// the last list that was read standing - it is still the best information
	// there is.
	async #run(fn) {
		this._pending++;
		this.#syncBusy();
		this._error = '';
		this._errorCode = '';
		try {
			return await fn();
		} catch (e) {
			this.#fail(e);
			return null;
		} finally {
			this._pending--;
			this.#syncBusy();
		}
	}

	#syncBusy() { this._busy = this._pending > 0 || this._op; }

	// One user action at a time, from the click to the last write. Disabling the
	// buttons while a request runs is not enough: an action is several requests
	// with gaps between them (refresh, confirm, write, refresh), and a second click
	// landing in a gap would interleave two flows over the same list. It also
	// carries the error handling the click handlers used to lack - a throw after
	// #run() (storage, hashing, the base) is shown, not an unhandled rejection.
	// Wrap at the handler, never inside another wrapped action.
	async #exclusive(fn) {
		if (this._op) return;
		this._op = true;
		this.#syncBusy();
		try {
			await this.#guarded(fn);
		} finally {
			this._op = false;
			this.#syncBusy();
		}
	}

	async #refreshStates() {
		if (!this.#effective) return;
		// Re-reading is one of the two answers to a conflict, so it clears it: what
		// the list shows afterwards is the state as it now stands.
		this._conflict = null;
		await this.#relist();
	}

	// Ask for the list and take it as the one on screen. Null, with the reason on
	// screen, when the request failed.
	async #relist() {
		const list = await this.#run(() => window.GesturaSync.list());
		if (list) await this.#absorbList(list);
		return list;
	}

	// A list that was read successfully is the truth about what the server has.
	// A base for a state it no longer has is dropped - after a SUCCESSFUL listing
	// only; a failed one proves nothing (spec §3). The same goes for the active
	// marker: a state that is gone cannot be the one this browser is working with.
	async #absorbList(list) {
		this._states = list;
		this._features = new Set(list.features || []);
		// The first list under a code just loaded. Going from an empty code to one
		// with states is the pairing of a second browser - say so and show them.
		const loaded = this._loadedFrom;
		if (loaded && loaded.secret === this.#state.secret) {
			this._loadedFrom = null;
			if (loaded.had === 0 && list.length) {
				this._tab = 'states';
				this._notice = window.i18n.getMessage('euSyncSecretLoaded');
			}
		}
		const ids = list.map(s => s.stateId);
		this._bases = await window.GesturaSyncBase.prune(ids);
		// Read after the await, not before: the marker may have been set while the
		// base was being pruned.
		const active = (await window.GesturaSyncLocal.read()).euSync.activeState;
		if (active && !ids.includes(active)) await window.GesturaSyncLocal.write({ activeState: '' });
	}

	// Every action on a state starts here. The list on screen can be minutes old,
	// and another browser may have replaced or deleted the state since: acting on
	// the row's copy of its meta is how "Wrong code, or the data is damaged" came
	// to be shown for a perfectly good state. Re-lists, takes the new list as the
	// one on screen, and answers with the state as it stands now - or null, with
	// the reason already on screen (the request failed, or the state is gone).
	async #freshen(stateId) {
		const list = await this.#relist();
		if (!list) return null;
		const fresh = list.find(s => s.stateId === stateId);
		if (!fresh) {
			this._error = window.i18n.getMessage(EuSyncPanel.SYNC_ERRORS['not-found']);
			return null;
		}
		return fresh;
	}

	// After a refusal that means "the state moved" (`stale` on a download, a 412 on
	// a rename) the list on screen is out of date again; #freshen ran before the
	// request, so this is the gap between the two. Re-list, and keep the message -
	// the `stale` text even promises the refresh. If re-listing fails, its own
	// error replaces the message: it is the more useful one.
	async #relistKeepingError(expected) {
		if (this._errorCode !== expected) return;
		const { _error: error, _errorCode: code } = this;
		if (!await this.#relist()) return;
		this._error = error;
		this._errorCode = code;
	}

	// For the actions that WRITE (overwrite, delete): where reading can simply take
	// the fresh data, these must not silently act on something other than what the
	// user was looking at. True, with the reason on screen, when the state moved.
	#movedSince(was, fresh) {
		const now = fresh.meta && fresh.meta.payloadHash;
		if (was === now) return false;
		this._error = window.i18n.getMessage('euSyncErrorChangedMeanwhile').replace('{date}', this.#formatDate(fresh.updatedAt));
		return true;
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
		// The click that opened the preview has long returned, and with it #exclusive:
		// what follows the confirmation (the request, then the base and the record)
		// is a flow of its own and gets the same one-at-a-time guard and error line.
		if (preview) await this.#exclusive(() => preview.commit());
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
	async #uploadTo({ stateId = null, name, basePayloadHash = null, createdAt = '' }) {
		// Replacing a state named by its hash: look again first, so the preview and
		// the token belong to what is on gestura.eu now. Without a hash the user has
		// already answered a conflict with "overwrite anyway", or the state is new.
		if (stateId && basePayloadHash) {
			const fresh = await this.#freshen(stateId);
			if (!fresh) return;
			if (this.#movedSince(basePayloadHash, fresh)) return;
			createdAt = (fresh.meta && fresh.meta.createdAt) || createdAt;
		}
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
				}, { activate: true });
				this._newName = '';
				await this.#refreshStates();
			},
		});
	}

	// Downloading means: decrypt, validate, show - and only then write. The
	// validator is the same one the file import uses, so a state from a newer
	// Gestura can be refused here just as clearly.
	async #downloadState(state) {
		// Reading proceeds with the fresh data: a state replaced since the list was
		// shown is simply opened as it is now.
		state = await this.#freshen(state.stateId);
		if (!state) return;
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
		if (!payload) { await this.#relistKeepingError('stale'); return; }
		const result = window.GesturaSettingsSchema.validate(payload, { forSync: true, local: settingsStore.current });
		if (!result.ok) {
			this._error = settingsErrorMessage(window.i18n, result.error);
			return;
		}
		const current = this.#validatedExport({ json: false });
		this.#openPreview({
			mode: 'import',
			json: result.json,
			dropped: result.dropped,
			retyped: result.retyped,
			legacy: result.legacy,
			compare: current.ok ? [{ label: '', before: current.exportObj, after: result.exportObj }] : [],
			// The adopt path saves, runs afterSave, reloads. The base is written in
			// afterSave - after the save succeeded, so a base never names settings
			// this browser does not hold - under the hash the payload was checked
			// against, which is the hash the server holds (spec §6).
			commit: () => window.dispatchEvent(new CustomEvent('gestura:settings-apply', {
				detail: {
					settings: result.settings,
					afterSave: async () => {
						await window.GesturaSyncBase.write(state.stateId, {
							hash: expectPayloadHash,
							payload: result.exportObj,
							date: new Date().toISOString(),
						});
						// Adopting makes this the state the browser works with. What it now
						// holds IS this payload, so that is what "changed since" compares
						// against - without it the state would be active with nothing to
						// compare to, and the first save would look like a change from
						// nowhere.
						await window.GesturaSyncLocal.setState(state.stateId, {
							name: this.#nameOf(state),
							lastUploadHash: await window.GesturaSettingsSchema.hashOf(result.exportObj),
						}, { activate: true });
					},
				},
			})),
		});
	}

	// The merge does a lot of throw-capable work OUTSIDE #run - merge(), apply()
	// with its structuredClone, buildExport(), JSON.stringify(), validate() - and
	// every entry into it comes from an event handler that floats the promise. An
	// unexpected throw would then be an unhandled rejection: no line on screen and
	// a button that looks dead. This is the one loop that must not fail silently,
	// so each entry point goes through here. #fail() is the panel's own error
	// line, and it still reads a `code` off a sync error that reached us unwrapped.
	async #guarded(fn) {
		try {
			await fn();
		} catch (e) {
			console.error('[Gestura] Sync failed:', e);
			this.#fail(e);
		}
	}

	// Spec §3: download, merge against the base, ask where both sides moved,
	// preview, upload with the write token, and only then write locally and
	// store the result as the new base. A 412 restarts from the top with the
	// answers kept; the third one hands over to the existing conflict UI.
	//
	// `choices` are the answers from an earlier pass; `attempt` counts passes.
	async #syncState(state, attempt = 1, choices = {}) {
		const i18n = window.i18n;
		const S = window.GesturaSettingsSchema;
		// A fresh press starts clean; a 412 retry keeps its "moved again" line for
		// after the dialogs, and puts the same sentence into the preview's note.
		if (attempt === 1) {
			this._notice = '';
			// A retry after a 412 already came from a fresh list.
			state = await this.#freshen(state.stateId);
			if (!state) return;
		}
		const expect = state.meta && state.meta.payloadHash;
		if (typeof expect !== 'string' || !expect) {
			this._error = i18n.getMessage('euSyncStateBroken');
			return;
		}
		// A newer Gestura's payload would lose keys in validate() and the merge
		// would upload that loss; refused before anything is compared (spec §3).
		if (window.GesturaEuUpdates.isNewer(state.meta.extVersion, i18n.version)) {
			this._error = i18n.getMessage('euSyncMergeNewerVersion');
			return;
		}
		const base = await window.GesturaSyncBase.read(state.stateId);
		if (!base) {
			this._error = i18n.getMessage('euSyncMergeNoBase');
			return;
		}
		const payload = await this.#run(() => window.GesturaSync.download({ stateId: state.stateId, expectPayloadHash: expect }));
		if (!payload) { await this.#relistKeepingError('stale'); return; }

		const local0 = settingsStore.current;
		const remote = S.validate(payload, { forSync: true, local: local0 });
		if (!remote.ok) {
			this._error = settingsErrorMessage(i18n, remote.error);
			return;
		}
		if (remote.dropped.length || remote.retyped.length) {
			this._error = i18n.getMessage('euSyncMergeNewerVersion');
			return;
		}
		const baseV = S.validate(base.payload, { forSync: true, local: local0 });
		if (!baseV.ok) {
			// The row's Sync button hangs off _bases; without this it would stay
			// there, offering the merge that was just refused, until the next
			// listing.
			this._bases = await window.GesturaSyncBase.remove(state.stateId);
			this._error = i18n.getMessage('euSyncMergeNoBase');
			return;
		}
		const local = this.#validatedExport({ json: false });   // #validatedExport adds forSync: true
		if (!local.ok) {
			this._error = settingsErrorMessage(i18n, local.error);
			return;
		}

		// With remote hash === base hash the remote side has not moved, and the
		// table yields "keep mine" for every difference - no special case needed.
		const merged = window.GesturaSettingsMerge.merge(baseV.settings, local.settings, remote.settings);
		const s = merged.summary;
		if (!merged.conflicts.length && !s.taken && !s.uploaded && !s.deleted) {
			// Nothing to transfer - but that is reached two ways. Either the state
			// has not moved since we last agreed (expect === base.hash), or it has
			// and both sides happened to make the SAME change, which the table
			// resolves to "unchanged". In the second the base still names the
			// payload from before that change, and returning here would leave it
			// naming it forever: every later Sync lands on this same return, and a
			// deletion made here afterwards would be asked about instead of simply
			// propagating. The server holds `payload` under `expect` - which is
			// exactly what a base is - so adopt it, the way #downloadState does
			// with the same two values. No upload and no preview: the transfer
			// they would show carries nothing.
			if (expect !== base.hash) {
				this._bases = await window.GesturaSyncBase.write(state.stateId, { hash: expect, payload, date: new Date().toISOString() });
			}
			this._conflict = null;
			this._notice = i18n.getMessage('euSyncMergeInSync');
			return;
		}
		// Only answers whose question is asked again are kept (spec §3).
		const kept = {};
		for (const c of merged.conflicts) if (choices[c.key]) kept[c.key] = choices[c.key];
		const open = merged.conflicts.some(c => !kept[c.key]);
		const ctx = { state, merged, choices: kept, attempt, expect, localObj: local.exportObj, remoteObj: remote.exportObj };
		if (open) {
			this._merge = ctx;
			return;
		}
		await this.#commitMerge(ctx);
	}

	// <sync-merge-dialog> does not close itself - unlike the preview dialog, whose
	// #cancel/#confirm do. So both handlers here flip `open` on the element itself,
	// synchronously and before anything else: otherwise Escape and a backdrop click
	// leave the overlay and the scroll lock standing over a dialog that no longer
	// does anything, and the merge dialog's own updated() would release the lock
	// AFTER the preview below has taken it.
	#onMergeConfirm(e) {
		e.currentTarget.open = false;
		const ctx = this._merge;
		this._merge = null;
		if (ctx) this.#exclusive(() => this.#commitMerge({ ...ctx, choices: e.detail.choices }));
	}

	// Cancelling ends the round: the "changed again" line was about a merge that
	// is no longer running, and the preview note said the same thing anyway.
	#onMergeCancel(e) {
		e.currentTarget.open = false;
		this._merge = null;
		this._notice = '';
	}

	// After the questions: apply, validate the result as one object, show the
	// preview, and on confirmation upload -> write locally -> store the base.
	async #commitMerge(ctx) {
		const i18n = window.i18n;
		const S = window.GesturaSettingsSchema;
		const { state, merged, choices, attempt, expect, localObj, remoteObj } = ctx;
		const name = this.#nameOf(state);
		const final = window.GesturaSettingsMerge.apply(merged.result, merged.conflicts, choices, { stateName: name });
		// As text, so validate() applies MAX_BYTES - the 1 MiB local ceiling - to
		// the merged result before anything is sent (spec §3 step 7a). `local`
		// supplies the seven device-local keys r.settings will be saved with.
		const r = S.validate(
			JSON.stringify(S.buildExport(final, i18n.version, { forSync: true })),
			{ forSync: true, local: settingsStore.current },
		);
		if (!r.ok) {
			this._error = settingsErrorMessage(i18n, r.error);
			return;
		}
		const summaryLine = formatMergeSummary(i18n, merged.summary, name);
		// On a retry the user sees this preview a second time; the reason belongs
		// in the dialog they are looking at, not in a panel line behind it.
		const note = attempt > 1 ? `${i18n.getMessage('euSyncMergeMovedAgain')} ${summaryLine}` : summaryLine;
		this.#openPreview({
			mode: 'merge',
			json: r.json,
			dropped: r.dropped,
			retyped: r.retyped,
			legacy: false,
			note,
			// Two accounts of one merge: what goes up to the state from here (the state
			// before, against the result) and what this browser takes over (its own
			// settings before, against the result). What the user is about to send
			// comes first.
			compare: [
				{ label: i18n.getMessage('settingsPreviewChangeThere').replace('{name}', name), before: remoteObj, after: r.exportObj },
				{ label: i18n.getMessage('settingsPreviewChangeHere'), before: localObj, after: r.exportObj },
			],
			commit: () => this.#guarded(async () => {
				// upload -> local write -> base, and never another order (spec §3
				// step 7b-7d). The sequence itself lives in settings-merge.js, where
				// it is testable without a DOM; what stands here are its three steps.
				// `now` dates the base and the upload record alike, and is taken
				// where it always was: once the upload has been acknowledged.
				let now = '';
				const res = await window.GesturaSettingsMerge.commitOrder({
					upload: () => this.#run(() => window.GesturaSync.upload({
						stateId: state.stateId,
						name,
						createdAt: state.meta && state.meta.createdAt,
						exportObj: r.exportObj,
						extVersion: i18n.version,
						basePayloadHash: expect,
					})),
					// The adopt path saves, runs afterSave, reloads. Its outcome is
					// not observable from here, which is why `recordBase` goes into
					// afterSave rather than being awaited after this returns: that
					// hook runs after the save succeeded and before the reload.
					applySettings: (recordBase) => {
						// An earlier conflict has been answered by this write - the same
						// reasoning as in #uploadTo, and without it the "Reload / Upload
						// overwriting" row would survive the merge that settled it.
						this._conflict = null;
						now = new Date().toISOString();
						window.dispatchEvent(new CustomEvent('gestura:settings-apply', {
							detail: {
								settings: r.settings,
								afterSave: async () => {
									await recordBase();
									await window.GesturaSyncLocal.setState(state.stateId, {
										name,
										lastUploadHash: await S.hashOf(r.exportObj),
										lastUploadDate: now,
									}, { activate: true });
								},
							},
						}));
						return true;
					},
					// The server holds r.exportObj under done.payloadHash.
					writeBase: done => window.GesturaSyncBase.write(state.stateId, { hash: done.payloadHash, payload: r.exportObj, date: now }),
				});
				if (res.ok || res.reason !== 'upload' || this._errorCode !== 'conflict') return;
				// Someone wrote between our download and this upload. Nothing has
				// been written here. Twice more we merge against what is there now;
				// the third 412 hands over to the existing conflict UI (spec §3
				// step 8).
				if (attempt >= 3) {
					this._conflict = { stateId: state.stateId, name, createdAt: state.meta && state.meta.createdAt, basePayloadHash: null };
					return;
				}
				const fresh = await this.#freshen(state.stateId);
				if (!fresh) return;
				this._notice = i18n.getMessage('euSyncMergeMovedAgain');
				await this.#syncState(fresh, attempt + 1, choices);
			}),
		});
	}

	// Only the name changes, so only the meta blob goes up (POST sync/meta): no
	// preview, nothing about the settings moves. Like delete, it looks again first
	// and stops if the state moved; the hash in the fresh meta is the write token.
	// The base stays as it is - the payload it names is untouched.
	async #renameState(shown) {
		const i18n = window.i18n;
		const current = this.#nameOf(shown);
		const name = await this.#ask({
			title: i18n.getMessage('euSyncRename'),
			text: i18n.getMessage('euSyncRenamePrompt').replace('{name}', current),
			confirm: i18n.getMessage('euSyncRename'),
			input: current,
		});
		if (!name || name === current) return;
		const state = await this.#freshen(shown.stateId);
		if (!state || this.#movedSince(shown.meta && shown.meta.payloadHash, state)) return;
		const done = await this.#run(() => window.GesturaSync.rename({ stateId: state.stateId, meta: state.meta, name }));
		if (!done) { await this.#relistKeepingError('conflict'); return; }
		if (this.#state.states[state.stateId]) await window.GesturaSyncLocal.setState(state.stateId, { name });
		// The contract asks for a re-read after a rename: a concurrent PUT with the
		// old name can replace it, and only the list says which name stands.
		await this.#relist();
	}

	async #deleteState(shown) {
		const i18n = window.i18n;
		if (!await this.#ask({
			title: i18n.getMessage('euSyncDelete'),
			text: i18n.getMessage('euSyncDeleteConfirm').replace('{name}', this.#nameOf(shown)),
			confirm: i18n.getMessage('euSyncDelete'),
			danger: true,
		})) return;
		// Delete carries no token (the contract keeps it unconditional), so the only
		// protection is looking again as close to the request as possible - after
		// the dialog, which may have stood open while another browser replaced the
		// state, and not before it as well: that would only buy a fresher name.
		const now = await this.#freshen(shown.stateId);
		if (!now || this.#movedSince(shown.meta && shown.meta.payloadHash, now)) return;
		const done = await this.#run(() => window.GesturaSync.remove(shown.stateId));
		if (!done) return;
		await window.GesturaSyncLocal.removeState(shown.stateId);
		// The list is known to be the one just read, minus this state; asking the
		// server for it again would be a third round trip for nothing.
		this._states = this._states.filter(s => s.stateId !== shown.stateId);
		this._bases = await window.GesturaSyncBase.remove(shown.stateId);
	}

	async #deleteAll() {
		const i18n = window.i18n;
		if (!await this.#ask({
			title: i18n.getMessage('euSyncDeleteAll'),
			text: i18n.getMessage('euSyncDeleteAllConfirm'),
			note: this.#countLine('euSyncDeleteCount'),
			confirm: i18n.getMessage('euSyncDeleteAll'),
			danger: true,
		})) return;
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

	// One row action as an icon button. The text lives in `title` AND `aria-label`
	// - the icon alone says nothing to a screen reader, and `title` is what a
	// mouse user gets on hover. `why`, when given, is the reason the button cannot
	// be used: it replaces the label, and the button stays focusable
	// (aria-disabled, not disabled) so a keyboard user can reach the reason too.
	#actionButton(style, iconName, messageKey, run, why = '') {
		const label = why || window.i18n.getMessage(messageKey);
		return html`
			<button type="button" class="icon-btn ${style}" ?disabled=${this._busy && !why}
				aria-disabled=${why ? 'true' : 'false'} title=${label} aria-label=${label}
				@click=${() => { if (!why) this.#exclusive(run); }}>${unsafeHTML(icons[iconName])}</button>`;
	}

	#renderStateRow(state) {
		const i18n = window.i18n;
		const { active, changed, neverUploadedHere, offers } = rowModel({
			state,
			local: this.#state.states[state.stateId],
			activeState: this.#state.activeState,
			base: this._bases[state.stateId],
			currentHash: this._currentHash,
		});
		const name = this.#nameOf(state);
		const date = state.updatedAt ? html`
			<div class="state-date">${i18n.getMessage('euSyncUploadedAt').replace('{date}', this.#formatDate(state.updatedAt))}</div>` : '';
		// A state that cannot be read offers nothing but deleting it: opening or
		// overwriting it would need the hash out of the meta blob it does not have.
		const text = state.broken ? html`
			<div class="broken-title">${unsafeHTML(icons.circleAlert)}<span>${i18n.getMessage('euSyncStateBroken')}</span></div>
			${date}` : html`
			<div class="state-name">${name}${active ? html`<span class="badge-active">${i18n.getMessage('euSyncActive')}</span>` : ''}</div>
			${date}
			${changed ? html`<div class="hint changed">${unsafeHTML(icons.circleDot)}<span>${i18n.getMessage('euSyncChanged')}</span></div>` : ''}
			${neverUploadedHere ? html`<div class="hint">${unsafeHTML(icons.monitor)}<span>${i18n.getMessage('euSyncNeverUploadedHere')}</span></div>` : ''}`;
		return html`
			<div class="state ${active ? 'active' : ''} ${state.broken ? 'broken' : ''}">
				<div class="rail"><div class="dot"></div></div>
				<div class="state-card">
					<div class="state-text">${text}</div>
					<div class="state-actions" role="group" aria-label=${state.broken ? i18n.getMessage('euSyncStateBroken') : name}>
						${!state.broken && offers.merge ? this.#actionButton('accent', 'refreshCw', 'euSyncMerge',
							() => this.#syncState(state)) : ''}
						${!state.broken && offers.download ? this.#actionButton('', 'download', 'euSyncDownload',
							() => this.#downloadState(state)) : ''}
						${!state.broken && offers.upload ? this.#actionButton('', 'upload', 'euSyncUpload',
							() => this.#uploadTo({ stateId: state.stateId, name, basePayloadHash: state.meta?.payloadHash, createdAt: state.meta?.createdAt })) : ''}
						${offers.rename ? this.#actionButton('', 'pencil', 'euSyncRename',
							() => this.#renameState(state),
							this._features.has('sync-meta') ? '' : i18n.getMessage('euSyncRenameUnavailable')) : ''}
						<span class="sep" aria-hidden="true"></span>
						${this.#actionButton('danger', 'trash2', 'euSyncDelete', () => this.#deleteState(state))}
					</div>
				</div>
			</div>`;
	}

	#renderError() {
		const i18n = window.i18n;
		return html`
			<div class="msg error-banner" role="alert">
				${unsafeHTML(icons.triangleAlert)}
				<span class="msg-text">${this._error}</span>
				<button type="button" class="icon-btn" title=${i18n.getMessage('euSyncErrorDismiss')}
					aria-label=${i18n.getMessage('euSyncErrorDismiss')}
					@click=${() => { this._error = ''; this._errorCode = ''; }}>${unsafeHTML(icons.x)}</button>
			</div>`;
	}

	// What the last action has to say, directly under the head of the list it
	// acted on. The error stays until dismissed or until the next action starts
	// (#run clears it); the notice goes by itself (updated()). A conflict is the
	// one error with a way out, so it is shown as the conflict box instead of the
	// banner - with the conflict's own sentence while it is the current error.
	#renderFeedback() {
		const i18n = window.i18n;
		const conflictText = this._errorCode === 'conflict' ? this._error : i18n.getMessage('euSyncErrorConflict');
		return html`
			${this._error && !(this._conflict && this._errorCode === 'conflict') ? this.#renderError() : ''}
			${this._notice ? html`
				<div class="msg info" role="status">${unsafeHTML(icons.circleCheck)}<span>${this._notice}</span></div>` : ''}
			${this._conflict ? html`
				<div class="msg conflict" role="alert">
					<div class="line">${unsafeHTML(icons.triangleAlert)}<span>${conflictText}</span></div>
					<div class="ways">
						<button class="btn btn-secondary" ?disabled=${this._busy}
							@click=${() => this.#exclusive(() => this.#refreshStates())}>${i18n.getMessage('euSyncConflictReload')}</button>
						<button class="btn btn-danger-outline" ?disabled=${this._busy}
							@click=${() => this.#exclusive(() => this.#uploadTo(this._conflict))}>${i18n.getMessage('euSyncConflictOverwrite')}</button>
					</div>
				</div>` : ''}`;
	}

	#renderStates() {
		const i18n = window.i18n;
		const states = this._states || [];
		const max = window.GesturaSync.LIMITS.statesMax;
		const full = states.length >= max;
		const newName = this._newName.trim();
		const duplicate = states.some(s => this.#nameOf(s) === newName);
		const create = () => { if (newName && !full) this.#exclusive(() => this.#uploadTo({ name: newName })); };
		return html`
			<div class="sync-card states">
				<div class="states-head">
					<div class="title">
						<span class="card-title">${i18n.getMessage('euSyncStatesTitle')}</span>
						${this._states ? html`<span class="count">${i18n.getMessage('euSyncStatesCount')
							.replace('{n}', String(states.length)).replace('{max}', String(max))}</span>` : ''}
					</div>
					<div class="tools">
						<button type="button" class="ghost-btn" ?disabled=${this._busy}
							@click=${() => this.#exclusive(() => this.#refreshStates())}>${unsafeHTML(icons.rotateCw)}${i18n.getMessage('euSyncRefresh')}</button>
					</div>
				</div>
				${this.#renderFeedback()}
				${this._states && !states.length ? html`<div class="empty">${i18n.getMessage('euSyncStatesEmpty')}</div>` : ''}
				${states.length ? html`<div class="rows">${states.map(s => this.#renderStateRow(s))}</div>` : ''}
				${full ? html`
					<div class="full-note">${unsafeHTML(icons.info)}<span>${i18n.getMessage('euSyncQuotaReached').replace('{max}', String(max))}</span></div>` : ''}
				<div class="field-row ${full ? 'full' : ''}">
					<input type="text" class="field" placeholder=${i18n.getMessage('euSyncStateNamePlaceholder')}
						aria-label=${i18n.getMessage('euSyncStateNamePlaceholder')}
						?disabled=${full}
						.value=${this._newName}
						@input=${e => { this._newName = e.target.value; }}
						@keydown=${e => { if (e.key === 'Enter') create(); }}>
					<button class="btn btn-primary" ?disabled=${full || this._busy || !newName}
						@click=${create}>${unsafeHTML(icons.upload)}${i18n.getMessage('euSyncCreate')}</button>
				</div>
				${duplicate && !full ? html`<div class="notice">${i18n.getMessage('euSyncDuplicateName')}</div>` : ''}
			</div>`;
	}

	// Outside the tabs, so a dialog never goes with a tab switch.
	#renderSyncDialogs() {
		return html`
			<settings-preview-dialog
				?open=${!!this._preview}
				mode=${this._preview ? this._preview.mode : 'upload'}
				.json=${this._preview ? this._preview.json : ''}
				.dropped=${this._preview ? this._preview.dropped : []}
				.retyped=${this._preview ? this._preview.retyped : []}
				?legacy=${!!(this._preview && this._preview.legacy)}
				.note=${this._preview ? (this._preview.note || '') : ''}
				.compare=${this._preview ? (this._preview.compare || []) : []}
				@preview-confirm=${this.#onPreviewConfirm}
				@preview-cancel=${() => { this._preview = null; this._notice = ''; }}></settings-preview-dialog>
			<sync-merge-dialog
				?open=${!!this._merge}
				.conflicts=${this._merge ? this._merge.merged.conflicts : []}
				.summary=${this._merge ? this._merge.merged.summary : {}}
				.stateName=${this._merge ? this.#nameOf(this._merge.state) : ''}
				.choices=${this._merge ? this._merge.choices : {}}
				@merge-confirm=${this.#onMergeConfirm}
				@merge-cancel=${this.#onMergeCancel}></sync-merge-dialog>`;
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

	// Deleting everything needs the server, so it is offered only while sync can
	// reach it; with a stale consent the dialog offers turning off alone.
	#renderOffDialog() {
		const i18n = window.i18n;
		const canDelete = this.#effective;
		const count = this.#countLine('euSyncDeleteCount');
		return html`
			<div class="modal-overlay" @mousedown=${this.#closeOff}>
				<div class="modal-panel" tabindex="-1" role="dialog" aria-modal="true" @mousedown=${e => e.stopPropagation()}>
					<div class="modal-header">
						<h3>${i18n.getMessage('euSyncOffTitle')}</h3>
						<button type="button" class="modal-close" @click=${this.#closeOff}
							aria-label=${i18n.getMessage('euSyncConsentCancel')}>${unsafeHTML(icons.x)}</button>
					</div>
					<div class="modal-body">
						<p class="lead">${i18n.getMessage('euSyncOffBody')}</p>
						${canDelete ? html`<p class="off-delete-note">${i18n.getMessage('euSyncOffDeleteAllDesc')}</p>` : ''}
						${canDelete && count ? html`<p class="ask-note danger">${count} ${i18n.getMessage('euSyncOffNothingLeft')}</p>` : ''}
					</div>
					<div class="modal-footer off-footer">
						${canDelete ? html`
							<button class="btn btn-danger" @click=${() => this.#exclusive(() => this.#offDeleteAll())}>${i18n.getMessage('euSyncOffDeleteAll')}</button>` : ''}
						<span class="off-spacer"></span>
						<button class="btn btn-secondary" @click=${this.#closeOff}>${i18n.getMessage('euSyncConsentCancel')}</button>
						<button class="btn btn-primary" @click=${this.#offKeep}>${i18n.getMessage('euSyncOffKeep')}</button>
					</div>
				</div>
			</div>`;
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

	#renderAsk() {
		const i18n = window.i18n;
		const ask = this._ask;
		return html`
			<div class="modal-overlay" @mousedown=${() => this.#answer(null)}>
				<div class="modal-panel small" tabindex="-1" role="dialog" aria-modal="true" aria-label=${ask.title}
					@mousedown=${e => e.stopPropagation()}>
					<div class="modal-header">
						<h3>${ask.title}</h3>
						<button type="button" class="modal-close" @click=${() => this.#answer(null)}
							aria-label=${i18n.getMessage('euSyncConsentCancel')}>${unsafeHTML(icons.x)}</button>
					</div>
					<div class="modal-body">
						<p class="ask-text">${ask.text}</p>
						${ask.note ? html`<p class="ask-note ${ask.danger ? 'danger' : ''}">${ask.note}</p>` : ''}
						${ask.input !== undefined ? html`
							<input type="text" class="field ask-field" aria-label=${ask.text} .value=${ask.value}
								@input=${e => { ask.value = e.target.value; this.requestUpdate(); }}
								@keydown=${e => { if (e.key === 'Enter') this.#confirmAsk(); }}>` : ''}
					</div>
					<div class="modal-footer">
						<button class="btn btn-secondary" @click=${() => this.#answer(null)}>${i18n.getMessage('euSyncConsentCancel')}</button>
						<button class="btn ${ask.danger ? 'btn-danger' : 'btn-primary'} ask-confirm"
							?disabled=${ask.input !== undefined && !ask.value.trim()}
							@click=${() => this.#confirmAsk()}>${ask.confirm}</button>
					</div>
				</div>
			</div>`;
	}

	// The first two groups and the last stay readable - enough to tell two codes
	// apart and to recognise the one in the password manager - the rest is dots,
	// group for group, so the shape of the code does not change when it is shown.
	#maskedCode(code) {
		const parts = code.split('-');
		if (parts.length <= 3) return code;
		return parts.map((p, i) => (i < 2 || i === parts.length - 1) ? p : '•'.repeat(p.length)).join('-');
	}

	#renderSecret() {
		const i18n = window.i18n;
		const origin = window.GesturaSyncLocal.syncOrigin(this._local);
		const code = this.#state.secret;
		const shown = this._codeVisible;
		const showLabel = i18n.getMessage(shown ? 'euSyncCodeHide' : 'euSyncCodeShow');
		const copyLabel = i18n.getMessage(this._copied ? 'euSyncSecretCopied' : 'euSyncSecretCopy');
		return html`
			<div class="sync-card">
				<div class="card-title">${i18n.getMessage('euSyncSecretTitle')}</div>
				<div class="card-desc">${i18n.getMessage('euSyncSecretDesc')}</div>
				<div class="code-line">
					<span class="lock">${unsafeHTML(icons.lock)}</span>
					<code class="code-text ${shown ? 'shown' : ''}"
						aria-label=${shown ? nothing : i18n.getMessage('euSyncCodeHiddenLabel')}>${shown ? code : this.#maskedCode(code)}</code>
					<button type="button" class="icon-btn" title=${showLabel} aria-label=${showLabel} aria-pressed=${shown ? 'true' : 'false'}
						@click=${() => { this._codeVisible = !shown; }}>${unsafeHTML(shown ? icons.eyeOff : icons.eye)}</button>
					<button type="button" class="icon-btn" title=${copyLabel} aria-label=${copyLabel}
						@click=${this.#copyCode}>${unsafeHTML(this._copied ? icons.check : icons.copy)}</button>
					<button type="button" class="icon-btn" title=${i18n.getMessage('euSyncSecretSave')} aria-label=${i18n.getMessage('euSyncSecretSave')}
						@click=${this.#saveCode}>${unsafeHTML(icons.fileDown)}</button>
				</div>
				${origin !== window.FlowMouseEuIntegration.PRODUCTION_ORIGIN ? html`
					<div class="notice">${i18n.getMessage('euSyncDevOriginNotice').replace('{origin}', origin)}</div>` : ''}
			</div>`;
	}

	// Settings: that sync is on and since when, the code, and - below it, apart -
	// deleting everything under the code. Switching off is the switch above.
	#renderSettings() {
		const i18n = window.i18n;
		const states = this._states || [];
		return html`
			<div class="sync-on">
				${unsafeHTML(icons.circleCheck)}
				<span><strong>${i18n.getMessage('euSyncConsentGranted')}</strong> \u00b7 ${i18n.getMessage('euSyncConsentDate').replace('{date}', this.#consentDate())}</span>
			</div>
			${this._error ? html`<div class="sync-card-gap">${this.#renderError()}</div>` : ''}
			${this.#state.secret ? html`${this.#renderSecret()}${this.#renderCodeSwitch()}` : ''}
			${states.length ? html`
				<div class="delete-all-row">
					<button type="button" class="ghost-btn danger" ?disabled=${this._busy}
						@click=${() => this.#exclusive(() => this.#deleteAll())}>${unsafeHTML(icons.trash2)}${i18n.getMessage('euSyncDeleteAll')}</button>
				</div>` : ''}`;
	}

	// Loading another code or making a new one, in a card of its own: under the
	// code they read as buttons for the code shown above them.
	//
	// With states under the current code - or a list that could not be read, which
	// may hide some - the card is locked: a warning with the count instead of the
	// two buttons, opened with one click. The question with the count still comes
	// before anything is changed.
	#renderCodeSwitch() {
		const i18n = window.i18n;
		const apply = () => { if (this._codeValid) this.#exclusive(() => this.#useCode()); };
		const locked = !this._switchUnlocked && !(this._states && this._states.length === 0);
		const count = this.#countLine('euSyncCodeSwitchLocked');
		// Cancel closes the field and, where there are states, locks the card again.
		const cancel = () => { this.#closePair(); this._switchUnlocked = false; };
		return html`
			<div class="sync-card">
				<div class="card-title">${i18n.getMessage('euSyncCodeSwitchTitle')}</div>
				<div class="card-desc">${i18n.getMessage('euSyncCodeSwitchDesc')}</div>
				${locked ? html`
					<div class="msg warn switch-lock" role="note">
						${unsafeHTML(icons.triangleAlert)}
						<span class="msg-text">${count || i18n.getMessage('euSyncCodeSwitchLockedUnknown')}</span>
						<button type="button" class="btn btn-secondary" ?disabled=${this._busy}
							@click=${() => { this._switchUnlocked = true; this.#openPair(); }}>${i18n.getMessage('euSyncCodeSwitchUnlock')}</button>
					</div>` : this._pairOpen ? html`
					<div class="pair-box">
						<div class="pair-desc">${i18n.getMessage('euSyncSecretPairDesc')}</div>
						<div class="field-row">
							<input type="text" class="field mono pair-field ${this._codeError ? 'invalid' : ''}" placeholder="GS1-…"
								aria-label=${i18n.getMessage('euSyncSecretPair')}
								aria-invalid=${this._codeError ? 'true' : 'false'}
								spellcheck="false" autocomplete="off"
								.value=${this._codeDraft}
								@input=${e => this.#onCodeInput(e.target.value)}
								@keydown=${e => {
									if (e.key === 'Enter') apply();
									if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
								}}>
							<button class="btn btn-primary" ?disabled=${this._busy || !this._codeValid}
								@click=${apply}>${i18n.getMessage('euSyncSecretPairApply')}</button>
							<button class="btn btn-secondary" @click=${cancel}>${i18n.getMessage('euSyncConsentCancel')}</button>
						</div>
						${this._codeError ? html`<div class="error" role="alert">${this._codeError}</div>` : ''}
						<div class="code-foot end">
							<button type="button" class="text-btn" ?disabled=${this._busy}
								@click=${() => this.#exclusive(() => this.#newCode())}>${i18n.getMessage('euSyncSecretNew')}</button>
						</div>
					</div>` : html`
					<div class="code-foot">
						<button type="button" class="btn btn-secondary" ?disabled=${this._busy}
							@click=${() => this.#openPair()}>${i18n.getMessage('euSyncSecretLoad')}</button>
						<button type="button" class="text-btn" ?disabled=${this._busy}
							@click=${() => this.#exclusive(() => this.#newCode())}>${i18n.getMessage('euSyncSecretNew')}</button>
					</div>`}
			</div>`;
	}

	#renderTabs() {
		const i18n = window.i18n;
		const tab = (id, label) => html`
			<button class="type-tab ${this._tab === id ? 'active' : ''}" role="tab" aria-selected=${this._tab === id}
				@click=${() => { if (this._tab !== id) { this._tab = id; this._switchUnlocked = false; this.#closePair(); } }}>${i18n.getMessage(label)}</button>`;
		return html`
			<div class="type-switch sync-tabs" role="tablist">
				${tab('states', 'euSyncStatesTitle')}
				${tab('settings', 'siteMenuTabSettings')}
			</div>
			<div role="tabpanel">
				${this._tab === 'settings'
					? this.#renderSettings()
					: this.#renderStates()}
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

	updated(changed) {
		if (changed.has('_pairOpen') && this._pairOpen) this.renderRoot.querySelector('.pair-field')?.focus();
		if (changed.has('_ask') && this._ask) {
			// Into the field when there is one, else onto the safe button - never onto
			// the confirm of a deletion, where a stray Enter would answer the question.
			const root = this.renderRoot;
			const target = root.querySelector('.ask-field') || root.querySelector('.modal-footer .btn-secondary');
			target?.focus();
			target?.select?.();
		} else if (this._consentOpen || this._offOpen) {
			this.renderRoot.querySelector('.modal-panel')?.focus();
		}
		// The failure may belong to a row far below the top of the page.
		if (changed.has('_error') && this._error) this.renderRoot.querySelector('.error-banner, .msg.conflict')?.scrollIntoView({ block: 'nearest' });
		// "Already in sync" and the like are confirmations, not something to act on:
		// they go by themselves.
		if (changed.has('_notice') && this._notice) {
			clearTimeout(this._noticeTimer);
			const notice = this._notice;
			this._noticeTimer = setTimeout(() => { if (this._notice === notice) this._notice = ''; }, 4000);
		}
	}

	render() {
		const i18n = window.i18n;
		if (!this._sync) return html``;
		return html`
			<div class="setting-row first-row">
				<div class="setting-label">
					<span>${i18n.getMessage('euSyncToggle')}</span>
					<span>${i18n.getMessage('euSyncToggleDesc')}</span>
				</div>
				<label class="toggle">
					<input type="checkbox" .checked=${this.#effective} @change=${this.#onToggle}>
					<span class="slider"></span>
				</label>
			</div>
			${this.#stale ? html`
				<div class="setting-row">
					<div class="setting-label reconfirm">
						<span>${i18n.getMessage('euSyncReconfirmTitle')}</span>
						<span>${i18n.getMessage('euSyncReconfirmDesc')}</span>
					</div>
					<div class="row-actions">
						<button class="btn btn-secondary" @click=${this.#openOff}>${i18n.getMessage('euSyncConsentRevoke')}</button>
						<button class="btn btn-primary" @click=${this.#open}>${i18n.getMessage('tutorialContinue')}</button>
					</div>
				</div>` : ''}
			${this.#effective ? this.#renderTabs() : (this._error ? html`<div class="error">${this._error}</div>` : '')}
			${this.#effective ? this.#renderSyncDialogs() : ''}
			${this._consentOpen ? this.#renderOverlay() : ''}
			${this._offOpen ? this.#renderOffDialog() : ''}
			${this._ask ? this.#renderAsk() : ''}
		`;
	}
}

customElements.define('eu-sync-panel', EuSyncPanel);
