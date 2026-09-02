import { LitElement, html, css } from '../lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { settingsStore } from '../settings-store.js';
import { usageOf } from '../storage-usage.js';
import { markImported } from './import-marker.js';

const X = () => window.FlowMouseMenuExchange;

// Die beiden Zweige, die ein Import beschreiben kann, mit ihrer Zeilenart und der
// Überschrift, unter der sie im Dialog stehen. An einer Stelle, weil Gruppierung,
// Belegung und Blockade sonst je eine eigene Liste hätten - und die dritte davon
// beim nächsten Zweig vergessen würde.
const BRANCHES = [
	{ key: 'siteMenus', type: 'menu', labelKey: 'siteMenusTitle' },
	{ key: 'searchEngines', type: 'engine', labelKey: 'sectionSearchEngines' },
];
const isFirefox = navigator.userAgent.includes('Firefox');

// Leerzustände, falls die Einstellungen die Zweige noch nicht kennen. Die Form
// gehört DEFAULT_SETTINGS in js/constants.js - das ist laut CLAUDE.md die
// einzige Quelle der Wahrheit dafür, und eine eigene Kopie hier würde beim
// nächsten neuen Feld lautlos danebenliegen. structuredClone, weil jeder Aufruf
// eigene, unabhängige Container braucht: sonst landen die verschachtelten
// Arrays/Objekte des geteilten Defaults selbst im Anwendungszustand.
const emptySiteMenus = () => structuredClone(window.GestureConstants.DEFAULT_SETTINGS.siteMenus);
const emptyEngines = () => structuredClone(window.GestureConstants.DEFAULT_SETTINGS.searchEngines);

// Import-Vorschau für Gestura-Menüs/-Engines. Für alle Import-Wege (Datei, URL,
// Betreiber-Button) genutzt. Rendert nie ungeprüftes JSON: erst validate(), dann
// Anzeige aus dem normalisierten value.
class MenuImportDialog extends LitElement {
	static properties = {
		_open: { state: true },
		_result: { state: true },   // { ok, type, errors, value }
		_source: { state: true },
		_scriptAck: { state: true },
		_match: { state: true },   // eigener, bereits importierter Eintrag, Katalog-Eintrag oder { ambiguous: true, candidates } - sonst null
		_importMode: { state: true },     // 'replace' | 'new'
		_bundle: { state: true },   // { errors: string[], rows: Row[] } | null
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
		.bsum { font-size: 12px; color: var(--text-muted); margin: 0 0 10px; display: flex;
			align-items: center; gap: 10px; }
		.bsum .spacer { flex: 1 1 auto; }
		.bstorage { font-size: 11.5px; color: var(--text-muted); }
		.brow { padding: 8px 0; }
		.brow + .brow { border-top: 1px solid var(--border-color); }
		.bhead { display: flex; align-items: center; gap: 8px; font-size: 13px; }
		.bhead .grow { flex: 1 1 auto; min-width: 0; }
		.bname { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.bmeta { font-size: 11px; color: var(--text-muted); }
		.badge { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; padding: 2px 6px;
			border-radius: 999px; background: var(--bg-secondary, rgba(128,128,128,.12)); color: var(--text-muted); }
		.badge.bad { background: rgba(211,51,51,.12); color: var(--danger-color, #d33); }
		.bcaret { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 2px 6px; }
		.bbody { padding: 6px 0 2px 26px; }
		.brow.invalid .bname { color: var(--text-muted); }
		.bhint { font-size: 12px; color: var(--text-muted); margin: 8px 0 0; }
		/* .bhint kommt hinter .notice in derselben Stylesheet-Kaskade und gewinnt
		   bei gleicher Spezifität - ohne diese Regel bliebe der Text grau, obwohl
		   Hintergrund und Rahmen von .notice amber sind. */
		.bhint.notice { color: var(--attention-color); }
		.bhint.notice p { margin: 0; }
		/* Abschnitts-Überschrift je Art, wie der Korb auf der Seite sie zeigt. */
		.bgroup { display: flex; align-items: center; gap: 6px; margin: 14px 0 2px;
			font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); }
		.bgroup:first-of-type { margin-top: 4px; }
		.bgroup .spacer { flex: 1 1 auto; }
		.bgroup-count { padding: 0 6px; border-radius: 999px; font-size: 10px; font-weight: 600;
			background: var(--bg-secondary); color: var(--text-secondary); }
		/* Zahl und Kontrollkästchen sind keine Überschrift und erben ihre Optik nicht. */
		.bgroup .bstorage, .bgroup .mode-opt { text-transform: none; letter-spacing: normal; }
	`];

	constructor() {
		super();
		this._open = false;
		this._result = null;
		this._source = null;
		this._scriptAck = false;
		this._match = null;
		this._importMode = 'new';
		this._bundle = null;
	}

	// Verzweigt auf den Formattyp: ein Bundle bekommt die Sammel-Vorschau, alles
	// andere den bisherigen Einzelpfad. Gerendert wird nie das rohe JSON, sondern
	// immer nur der normalisierte value aus der Validierung.
	// reply: {tabId, frameId} der Seite, die den Import angestoßen hat. Bewusst NICHT
	// Teil von `source` - das wandert als Herkunftsnachweis in die gespeicherte
	// Menü-Definition, und eine Tab-ID hat dort weder Bedeutung noch Haltbarkeit.
	openWith(rawObject, source, reply) {
		this._source = source || { type: 'file' };
		this._replyTo = reply && typeof reply.tabId === 'number' ? reply : null;
		this._reported = false;
		this._scriptAck = false;
		this._result = null;
		this._bundle = null;
		this._match = null;
		this._importMode = 'new';

		if (X().detectType(rawObject) === 'bundle') {
			const res = X().validateBundle(rawObject);
			this._bundle = {
				errors: res.errors,
				rows: res.entries.map((result, i) => {
					const match = result.ok ? this.#findMatch(result) : null;
					const row = { result, match, selected: result.ok, mode: this.#usableMatch(match) ? 'replace' : 'new', scriptAck: false, expanded: false, idx: i };
					// Ein Eintrag mit Skript ist per Vorbelegung schon ausgewählt (s.o.) -
					// ohne das hier nachzuholen, zeigt der Blocker von Anfang an auf einen
					// eingeklappten Body.
					if (row.selected && this.#rowNeedsAck(row)) row.expanded = true;
					return row;
				}),
			};
			// Ein Menü, dessen Engine nirgends herkommt, darf nicht ausgewählt starten —
			// sonst zählte der Import-Button etwas mit, das er gar nicht schreiben kann.
			this.#dropDependentMenus();
		} else {
			this._result = X().validate(rawObject);
			this._match = this._result.ok ? this.#findMatch(this._result) : null;
			this._importMode = this.#usableMatch(this._match) ? 'replace' : 'new';
		}
		this._open = true;
	}

	#findMatch(result) {
		const cur = settingsStore.current;
		if (result.type === 'menu') {
			const cat = (window.FlowMouseMenuCatalog && window.FlowMouseMenuCatalog.SITE_MENU_CATALOG) || [];
			return X().matchImport('menu', result.value, this._source, cur.siteMenus || {}, cat);
		}
		const cat = (window.FlowMouseEngineCatalogApi && window.FlowMouseEngineCatalogApi.ENGINE_CATALOG) || [];
		return X().matchImport('engine', result.value, this._source, cur.searchEngines || {}, cat);
	}

	// An ambiguous match is shown, never acted on: the row imports as new.
	#usableMatch(match) { return match && !match.ambiguous ? match : null; }

	#close() {
		// Ohne Commit ist ein Schließen ein Abbruch - die Seite wartet sonst ewig.
		// Nach #commitPatch() ist _replyTo bereits geleert und das hier ein No-op.
		this.#reportToPage('cancelled', []);
		this._open = false; this._result = null; this._bundle = null; this._match = null;
	}

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

	#matchName(match, type, i18n) {
		if (!match) return '';
		if (type === 'menu') return match.name || (match.nameKey ? i18n.getMessage(match.nameKey) : '') || match.id;
		return match.name || match.id;
	}

	// scope disambiguates the radio group name across bundle rows: shadow-root
	// radio groups are scoped only by name, and two rows can share a match.id
	// (a menu and an engine with the same catalog id, or a bundle with a
	// duplicate id across entries). The single-format callers pass no scope
	// and keep today's unscoped name.
	#renderModeChoice(i18n, match, type, mode, onMode, scope = '') {
		if (!match) return '';
		if (match.ambiguous) {
			return html`<div class="mode"><div class="mode-label">${i18n.getMessage('euIntegrationImportAmbiguous')}</div></div>`;
		}
		const name = this.#matchName(match, type, i18n);
		return html`
			<div class="mode">
				<div class="mode-label">${i18n.getMessage('exchangeImportAs')}</div>
				<label class="mode-opt">
					<input type="radio" name="importmode-${scope}${match.id}" .checked=${mode === 'replace'}
						@change=${() => onMode('replace')}>
					<span>${i18n.getMessage(match.own ? 'exchangeUpdateExisting' : 'exchangeReplaceStandard')
						.replace('{name}', name)}</span>
				</label>
				<label class="mode-opt">
					<input type="radio" name="importmode-${scope}${match.id}" .checked=${mode === 'new'}
						@change=${() => onMode('new')}>
					<span>${i18n.getMessage('exchangeAddAsNew')}</span>
				</label>
			</div>`;
	}

	#lang() { try { return (window.i18n.getCurrentLanguage() || 'en').split('_')[0]; } catch { return 'en'; } }

	// Belegung je Zweig, die nach dem Import bestünde - dieselbe Zahl, die der
	// Manager danach anzeigt. Bewusst NICHT der Anteil der Auswahl am freien Platz:
	// derselbe Prozentwert soll an beiden Orten dasselbe bedeuten.
	//
	// Menüs und Suchmaschinen haben je einen eigenen 8192-Byte-Deckel; eine
	// gemeinsame Zahl verschwiege, welcher der beiden eng wird. Ein Zweig, den die
	// Auswahl gar nicht berührt, wird mit seinem heutigen Inhalt gerechnet - sonst
	// bliebe die Zahl leer, sobald der Nutzer alle Menüs abwählt, und "leer" liest
	// sich wie "unbekannt" statt wie "unverändert". `touched` hält fest, welcher
	// Fall vorliegt.
	//
	// Measured over the patch WITH baseline placeholders: #commitPatch saves
	// addBaselines(patch), which is longer than `patch` by one fixed-length hash per
	// provenanced entry. Without them the preview under-reports and can promise a fit
	// that the save then refuses - the invariant above is that the shown usage cannot
	// differ from the real one, and this is what keeps it true.
	#projectedUsage(patch, imported) {
		const cur = settingsStore.current;
		const measured = window.FlowMouseEuIntegration.withBaselinePlaceholders(patch, imported);
		const out = {};
		for (const { key } of BRANCHES) {
			const touched = key in measured;
			const value = touched ? measured[key] : cur[key];
			out[key] = value === undefined ? null : { ...usageOf(key, value), touched };
		}
		return out;
	}

	// Zweige, die dieser Import beschreibt und die danach nicht mehr passen.
	// Unberührte zählen nicht mit: ein anderweitig volles searchEngines darf keinen
	// Menü-Import blockieren.
	//
	// Nach Bytes vergleichen, nicht nach Prozent: usageOf() rundet unterhalb des
	// Deckels auf höchstens 99, ein Bytevergleich hat diese Deckelung nicht.
	// Zweige, deren Zahl unten über den Knopf gehört statt in die Abschnitts-
	// Überschrift: der Import beschreibt sie, und es wird eng. Ein Zweig, den er gar
	// nicht anfasst, bleibt oben stehen - unten wäre er eine Warnung, gegen die der
	// Nutzer in diesem Dialog nichts tun kann. So verschwindet keine Zahl: was nicht
	// unten steht, steht oben.
	#tightBranches(projected) {
		return BRANCHES.filter(({ key }) => {
			const u = projected[key];
			return u && u.touched && u.percent >= 75;
		});
	}

	#overflowing(projected) {
		return BRANCHES.filter(({ key }) => {
			const u = projected[key];
			return u && u.touched && u.bytes > u.quota;
		});
	}

	get #needsScriptAck() {
		const r = this._result;
		return !!(r && r.ok && r.type === 'engine' && X().hasTransform(r.value));
	}

	// Gemeinsamer Abschluss beider Import-Wege: speichern, Fehler melden,
	// Katalog-Neuaufbau anstoßen, Dialog schließen.
	//
	// Die eigentliche Absage sitzt vorgelagert in #blockedFor()/#confirm(): die
	// Auswahl soll scheitern, bevor der Nutzer sich für sie entschieden hat, nicht
	// erst nach einem fehlgeschlagenen Schreibversuch. settingsStore.save() hier
	// bleibt trotzdem die zweite Instanz, kein toter Rest: die Vorausrechnung
	// sieht nur die Größe des einzelnen Branches, nicht das QUOTA_BYTES-Budget
	// über alle Einstellungs-Keys hinweg, und nicht ein gleichzeitiges Schreiben
	// von einem anderen Gerät, das zwischen Vorausrechnung und save() landet.
	// Schlägt set() aus einem dieser Gründe fehl, nimmt settingsStore.save()
	// seinen Zustand zurück, liefert false, und der Nutzer sieht dieselbe Meldung.
	// Die Bundle-Limits (200 Einträge, 1 MB) sind ohnehin der Transport-Vertrag
	// mit dem Index-Backend, eine andere Grenze als diese.
	async #commitPatch(patch, imported) {
		const withBaselines = await window.FlowMouseEuIntegration.addBaselines(patch, imported);
		const ok = await settingsStore.save(withBaselines);
		if (!ok) {
			alert(window.i18n.getMessage('menuSyncSaveError'));
			this.#reportToPage('failed', []);
			return;
		}
		markImported(imported);
		window.dispatchEvent(new Event('action-catalog-changed'));
		// Am Fenster, nicht nur am Dialog: bei einer Übergabe von einer Webseite
		// hängt der Dialog am Schattenbaum der Optionsseite, nicht im Manager - der
		// bekäme das aufsteigende Ereignis nie zu sehen und meldete nichts.
		window.dispatchEvent(new CustomEvent('gestura:import-done', { detail: imported }));
		this.dispatchEvent(new CustomEvent('import-done', { detail: imported, bubbles: true, composed: true }));
		this.#reportToPage('imported', imported);
		this.#close();
	}

	// Rückmeldung an die Seite, die den Import angestoßen hat - nur beim Inline-Weg
	// und beim Betreiber-Knopf, ein Datei- oder URL-Import hat niemanden zu
	// benachrichtigen. Genau eine Meldung je Übergabe: _replyTo wird sofort geleert,
	// sonst schickte das anschließende #close() noch ein "abgebrochen" hinterher.
	// Das Leeren steht vor dem await, damit dazwischen keine zweite Meldung passt.
	//
	// Der Weg führt über den Worker, weil nur der chrome.tabs.sendMessage darf.
	//
	// Beide Ausgänge landen in der Konsole DIESER Seite. Ein stiller Kanal lässt sich
	// sonst nicht von einem kaputten unterscheiden - man sieht ihm nicht an, ob er
	// gearbeitet hat. "noReceiver" ist dabei kein Fehler, sondern der dokumentierte
	// Normalfall: der Tab ist zu oder weitergezogen.
	async #reportToPage(status, imported) {
		const reply = this._replyTo;
		if (!reply) {
			// Nach einer erfolgreichen Meldung ruft #commitPatch() noch #close(), und
			// das meldet ein zweites Mal - dieser Durchlauf ist gewollt folgenlos.
			// Warnen darf nur der Fall, in dem NIE ein Ziel da war: bei Datei- und
			// URL-Import der Normalfall, bei einer Übergabe von einer Seite ein Defekt.
			if (!this._reported && this._source && this._source.type === 'site') {
				console.warn('[Gestura] Übergabe von einer Seite, aber kein Ziel für die Rückmeldung.');
			}
			return;
		}
		this._replyTo = null;
		this._reported = true;
		const list = imported || [];
		const result = {
			status,
			menus: list.filter(e => e.kind === 'menu').length,
			engines: list.filter(e => e.kind === 'engine').length,
		};
		let res;
		try {
			res = await chrome.runtime.sendMessage({
				action: 'importResult', tabId: reply.tabId, frameId: reply.frameId, result,
			});
		} catch (e) {
			// Erweiterungskontext kann ungültig sein (Reload mitten im Vorgang).
			console.warn('[Gestura] Rückmeldung an die Seite nicht absendbar:', e);
			return;
		}
		if (res && res.success) {
			// info, nicht debug: debug ist in Chrome die Stufe "Verbose" und
			// standardmäßig ausgeblendet - eine Zeile, die den Kanal beobachtbar
			// machen soll, wäre dort unsichtbar. Die Konsole der Optionsseite öffnet
			// ohnehin nur, wer nachsieht.
			console.info('[Gestura] Rückmeldung zugestellt an Tab %o, Frame %o:', reply.tabId, reply.frameId, result);
		} else {
			console.warn('[Gestura] Rückmeldung nicht zugestellt (%s), Tab %o, Frame %o:',
				(res && res.error) || 'keine Antwort', reply.tabId, reply.frameId, result);
		}
	}

	async #confirm() {
		const r = this._result;
		if (!r || !r.ok) return;
		// Defense in depth: der Button ist bereits gesperrt, aber ein Menü mit
		// fehlender Engine darf auf keinem Weg in den Speicher.
		if (r.type === 'menu' && this.#missingEngines(r.value, null).length) return;
		// Denselben Weg wie das Bundle nehmen, mit einer Zeile statt vieler: der
		// Einzel-Import hat nichts mitzubringen, worauf ein Menü zeigen könnte,
		// also bleibt die ID-Zuordnung leer. Zwei eigene Zusammenbauten desselben
		// Patches wären zwei Gelegenheiten, künftig auseinanderzulaufen.
		const { patch, imported } = this.#patchFor([{
			result: r,
			match: this._match,
			mode: this._match ? this._importMode : 'new',
		}]);
		// Einzel-Import: es gibt genau einen Eintrag und nichts zum Abwählen -
		// storageImportTooLarge ("Auswahl verkleinern") passt hier nicht, storageFull
		// ("Speichern schlägt fehl, bis du Einträge entfernst") beschreibt die Lage.
		if (this.#overflowing(this.#projectedUsage(patch, imported)).length) {
			alert(window.i18n.getMessage('storageFull'));
			return;
		}
		await this.#commitPatch(patch, imported);
	}

	// Übersetzt die Zeilen des Dialogs in die Form, die menu-exchange erwartet, und
	// lässt dort rechnen. Rein - schreibt nichts. Einzel-Import, Sammel-Import und
	// die Vorschau gehen alle hierdurch: so kann die angezeigte Belegung nicht von
	// der tatsächlichen abweichen, und nur eine Fassung muss getestet werden.
	#patchFor(chosen) {
		const rows = chosen.map(row => ({
			type: row.result.type,
			value: row.result.value,
			source: { ...this._source, version: row.result.value.version || '1.0.0' },
			mode: row.mode,
			matchId: this.#usableMatch(row.match) ? row.match.id : null,
		}));
		const current = {
			siteMenus: settingsStore.current.siteMenus || emptySiteMenus(),
			searchEngines: settingsStore.current.searchEngines || emptyEngines(),
		};
		return X().buildImportPatch(rows, current, { lang: this.#lang(), stripTransform: isFirefox });
	}

	// Schreibt alle gewählten Einträge in EINEM settingsStore.save(). Nicht je
	// Eintrag speichern: das wären n Sync-Schreibzugriffe und n Gelegenheiten
	// für einen Sync-Konflikt.
	async #confirmBundle() {
		const chosen = this.#bundleChosen;
		const { patch, imported } = this.#patchFor(chosen);
		if (this.#blockedFor(chosen, this.#projectedUsage(patch, imported))) return;
		const provided = this.#providedEngineIds();
		if (chosen.some(r => r.result.type === 'menu' && this.#missingEngines(r.result.value, provided).length)) return;
		await this.#commitPatch(patch, imported);
	}

	render() {
		if (!this._open) return html``;
		const i18n = window.i18n;
		const r = this._result;
		return html`<div class="backdrop" @click=${(e) => { if (e.target === e.currentTarget) this.#close(); }}>
			<div class="dialog">
				<h3 class="title">${i18n.getMessage('exchangePreviewTitle')}</h3>
				${this._bundle
					? this.#renderBundle(i18n)
					: (r && r.ok ? (r.type === 'menu' ? this.#renderMenu(r.value, i18n) : this.#renderEngine(r.value, i18n)) : this.#renderError(r, i18n))}
			</div>
		</div>`;
	}

	// Auswählbar ist nur, was die Validierung überstanden hat. Ungültige Zeilen
	// bleiben sichtbar — der Nutzer soll sehen, was übersprungen wird.
	get #bundleRows() { return (this._bundle && this._bundle.rows) || []; }
	get #bundleChosen() { return this.#bundleRows.filter(r => r.selected && r.result.ok); }

	// null = importierbar, 'empty' = nichts gewählt, 'script' = eine gewählte
	// Zeile führt ein Skript aus und ist noch nicht bestätigt, 'storage' = die
	// Auswahl passt nach dem Import nicht mehr in den Speicher. Nimmt die
	// gewählten Zeilen entgegen, statt sie selbst zu filtern: ein Render-Durchgang
	// braucht sie ohnehin und würde sonst bis zu 200 Zeilen mehrfach durchlaufen.
	//
	// `projected` kommt vom Aufrufer, statt hier selbst gerechnet zu werden:
	// #patchFor() baut den kompletten nächsten Einstellungszustand, und ein
	// Render-Durchgang braucht ihn ohnehin für die Anzeige. Selbst rechnen hieße,
	// ihn bei bis zu 200 Zeilen zweimal je Render zu bauen.
	#blockedFor(chosen, projected) {
		if (!chosen.length) return 'empty';
		const pending = chosen.some(r => r.result.type === 'engine' && X().hasTransform(r.result.value) && !r.scriptAck);
		if (pending) return 'script';
		// Passt die Auswahl nicht mehr in den Speicher, ist das kein Fehler beim
		// Schreiben mehr, sondern eine Entscheidung davor.
		if (this.#overflowing(projected).length) return 'storage';
		return null;
	}

	#rowName(row, lang) {
		if (row.result.ok) return X().pickLabel(row.result.value.name, lang) || row.result.value.id;
		// Ungültige Einträge tragen keinen geprüften Namen, und ungeprüftes JSON
		// wird bewusst nie gerendert. Ohne jeden Bezugspunkt lässt sich eine leere
		// Zeile in einem großen Bundle aber nicht mehr zuordnen - die 1-basierte
		// Position ist abgeleitet (nicht von der Seite geliefert) und unbedenklich.
		return `#${row.idx + 1}`;
	}

	// Eine gewählte Zeile mit unbestätigtem Skript blockiert den Import, aber ihre
	// Warnung liegt im eingeklappten Body. #selectRow holt das Aufklappen nach,
	// wo immer eine Zeile (neu) ausgewählt wird - Vorbelegung wie Nutzerklick,
	// nie aus render(), sonst Endlosschleife über requestUpdate().
	#rowNeedsAck(row) {
		return row.result.ok && row.result.type === 'engine' && X().hasTransform(row.result.value) && !row.scriptAck;
	}

	// Engines, auf die ein Menü zeigt, die es aber nirgends gibt: weder eingebaut,
	// noch beim Nutzer, noch unter den Engines, die dieser Import selbst mitbringt.
	// Solche Einträge verschwänden nach dem Import stillschweigend aus dem Menü —
	// engine-registry.js' resolveMenuItemLink() liefert für eine unbekannte ID
	// null, und content.js lässt den Eintrag daraufhin einfach weg. Deshalb wird
	// ein Menü mit fehlender Engine gar nicht erst importierbar.
	#missingEngines(menuValue, provided) {
		const ids = X().menuEngineIds(menuValue);
		if (!ids.length) return [];
		const catalog = (window.FlowMouseEngineCatalogApi && window.FlowMouseEngineCatalogApi.ENGINE_CATALOG) || [];
		const se = settingsStore.current.searchEngines || emptyEngines();
		const reg = window.FlowMouseEngineRegistry;
		if (!reg) return ids;   // ohne Registry lässt sich nichts auflösen: im Zweifel sperren
		return ids.filter(id => !(provided && provided.has(id)) && !reg.getEngineById(catalog, se, id));
	}

	// Engine-IDs, die dieser Import selbst liefert — nur aus Zeilen, die auch
	// wirklich ausgewählt sind. Wählt der Nutzer eine Engine ab, verlieren die
	// Menüs, die auf sie zeigen, ihre Grundlage wieder.
	#providedEngineIds() {
		const ids = new Set();
		for (const row of this.#bundleRows) {
			if (row.selected && row.result.ok && row.result.type === 'engine') ids.add(row.result.value.id);
		}
		return ids;
	}

	// Eine abgewählte Engine zieht die Menüs mit, die auf sie zeigen — sonst
	// bliebe ein Menü ausgewählt, dessen Einträge nach dem Import fehlen.
	#dropDependentMenus() {
		const provided = this.#providedEngineIds();
		for (const r of this.#bundleRows) {
			if (!r.selected || !r.result.ok || r.result.type !== 'menu') continue;
			if (this.#missingEngines(r.result.value, provided).length) r.selected = false;
		}
	}

	// cascade=false, wenn der Aufrufer gleich selbst #dropDependentMenus() ruft -
	// in einer Schleife über bis zu 200 Zeilen wäre das sonst quadratisch. Ein
	// wieder angehaktes Engine zieht die zuvor abgeworfenen Menüs bewusst NICHT
	// zurück: was der Nutzer abgewählt bekam, wählt er selbst wieder an.
	#selectRow(row, selected, cascade = true) {
		row.selected = selected;
		if (selected && this.#rowNeedsAck(row)) row.expanded = true;
		if (cascade && !selected && row.result.ok && row.result.type === 'engine') this.#dropDependentMenus();
	}

	#renderBundle(i18n) {
		const rows = this.#bundleRows;
		if (this._bundle.errors.length || !rows.length) {
			// Wrapper kaputt (kein Bundle, falsche Version, zu groß, zu viele
			// Einträge): es gibt keine Zeilen, also die bestehende Fehleransicht.
			// #renderError liest nur r.errors und kommt ohne ok/type/value aus.
			return this.#renderError({ errors: this._bundle.errors }, i18n);
		}
		const lang = this.#lang();
		if (!rows.some(r => r.result.ok)) {
			return html`
				<p class="err">${i18n.getMessage('exchangeBundleEmpty')}</p>
				<div class="actions"><button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button></div>`;
		}
		const chosen = this.#bundleChosen;
		const { patch: previewPatch, imported: previewImported } = this.#patchFor(chosen);
		const projected = this.#projectedUsage(previewPatch, previewImported);
		const blocked = this.#blockedFor(chosen, projected);
		const provided = this.#providedEngineIds();
		// Einmal je Render feststellen, welche Zeile auf eine Engine zeigt, die es
		// nirgends gibt. Die Zahl in der Kopfzeile und jede einzelne Zeile stellen
		// dieselbe Frage; getrennt beantwortet, könnten sie verschieden ausfallen.
		const missingBy = new Map(rows.map(r => [r,
			r.result.ok && r.result.type === 'menu' ? this.#missingEngines(r.result.value, provided) : []]));
		// Auswählbar ist weniger als gültig: ein Menü mit fehlender Engine ist
		// tadellos validiert und trotzdem gesperrt. Die Zahl bewegt sich mit, wenn
		// der Nutzer eine Engine an- oder abwählt — das ist gewollt.
		const selectable = (r) => r.result.ok && !missingBy.get(r).length;
		const valid = rows.filter(selectable).length;
		const allOn = valid > 0 && chosen.length === valid;

		// Erst alles setzen, dann die Abhängigkeiten prüfen: beim Anhaken wird eine
		// Engine erst im Lauf der Schleife verfügbar, die Reihenfolge der Zeilen darf
		// darüber nicht entscheiden.
		const setAll = (list, on) => {
			for (const r of list) { if (r.result.ok) this.#selectRow(r, on, false); }
			this.#dropDependentMenus();
			this.requestUpdate();
		};

		// Nach Art gruppieren, wie der Korb auf der Seite sie zeigt. Eine Zeile,
		// deren Art nicht einmal erkennbar war, gehört in keine Gruppe und steht ohne
		// Überschrift am Ende - sichtbar bleiben soll sie trotzdem.
		const KNOWN = BRANCHES.map(b => b.type);
		const loose = rows.filter(r => !KNOWN.includes(r.result.type));

		const tight = this.#tightBranches(projected);
		const section = (branch) => {
			const { key, type, labelKey } = branch;
			const list = rows.filter(r => r.result.type === type);
			if (!list.length) return '';
			const pick = list.filter(selectable);
			const u = tight.includes(branch) ? null : projected[key];
			return html`
				<div class="bgroup">
					<span class="bgroup-title">${i18n.getMessage(labelKey)}</span>
					<span class="bgroup-count">${list.length}</span>
					<span class="spacer"></span>
					${u ? html`<span class="bstorage">${i18n.getMessage('storageAfterImport')
						.replace('{percent}', u.percent)}</span>` : ''}
					<label class="mode-opt">
						<input type="checkbox" ?disabled=${!pick.length}
							.checked=${pick.length > 0 && pick.every(r => r.selected)}
							@change=${(e) => setAll(list, e.target.checked)}>
						<span>${i18n.getMessage('exchangeBundleSelectAll')}</span>
					</label>
				</div>
				${list.map(row => this.#renderBundleRow(row, i18n, lang, missingBy.get(row)))}`;
		};

		return html`
			<div class="bsum">
				<span>${i18n.getMessage('exchangeBundleSummary').replace('{count}', rows.length).replace('{valid}', valid)}</span>
				<span class="spacer"></span>
				<label class="mode-opt">
					<input type="checkbox" .checked=${allOn} @change=${(e) => setAll(rows, e.target.checked)}>
					<span>${i18n.getMessage('exchangeBundleSelectAll')}</span>
				</label>
			</div>
			${BRANCHES.map(section)}
			${loose.map(row => this.#renderBundleRow(row, i18n, lang, missingBy.get(row)))}
			${blocked === 'script' ? html`<p class="bhint">${i18n.getMessage('exchangeBundleScriptPending')}</p>` : ''}
			${this.#renderStorageHint(i18n, blocked, projected)}
			<div class="actions">
				<button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button>
				<button class="btn btn-primary" ?disabled=${!!blocked} @click=${() => this.#confirmBundle()}>
					${i18n.getMessage('exchangeBundleImport').replace('{count}', chosen.length)}
				</button>
			</div>`;
	}

	// Die Belegung steht auch oben in der Kopfzeile - bei einer langen Liste scrollt
	// die aber aus dem Bild, und dann fehlt die Zahl genau dort, wo entschieden wird.
	// Ab 75 % steht sie deshalb zusätzlich unten, direkt über dem Knopf. Dieselbe
	// Schwelle wie unter den Listen im Menü- und Engine-Manager: ab wann es eng
	// wird, soll überall dasselbe heißen.
	#renderStorageHint(i18n, blocked, projected) {
		const tight = this.#tightBranches(projected);
		if (!tight.length) return '';
		return html`
			<div class="bhint notice">
				${blocked === 'storage' ? html`<p>${i18n.getMessage('storageImportTooLarge')}</p>` : ''}
				${tight.map(({ key, labelKey }) => html`
					<p>${i18n.getMessage(labelKey)} · ${i18n.getMessage('storageAfterImport')
						.replace('{percent}', projected[key].percent)}</p>`)}
			</div>`;
	}

	#renderBundleRow(row, i18n, lang, missing) {
		const ok = row.result.ok;
		const v = row.result.value;
		const selectable = ok && !missing.length;
		const script = ok && row.result.type === 'engine' && X().hasTransform(v);
		const firstLink = ok && row.result.type === 'menu' ? v.items.find(it => it.customUrl || it.url) : null;
		const iconUrl = !ok ? null
			: (row.result.type === 'engine' ? v.url : (firstLink ? (firstLink.customUrl || firstLink.url) : null));
		const name = this.#rowName(row, lang);
		// Ein ambiges match hat keine id, auf die "Already added" zeigen könnte -
		// #usableMatch liefert dafür null, und der Badge bleibt aus.
		const usableMatch = this.#usableMatch(row.match);
		return html`
			<div class="brow ${selectable ? '' : 'invalid'}">
				<div class="bhead">
					<input type="checkbox" ?disabled=${!selectable} .checked=${row.selected}
						@change=${(e) => { this.#selectRow(row, e.target.checked); this.requestUpdate(); }}>
					${ok ? html`<img class="favicon" src="${this.#faviconSrc(iconUrl, name)}" alt="">` : ''}
					<span class="grow">
						<span class="bname">${name}</span>
						${row.result.type
							? html`<span class="bmeta">${i18n.getMessage(row.result.type === 'menu' ? 'exchangePreviewMenu' : 'exchangePreviewEngine')}</span>`
							: ''}
					</span>
					${usableMatch && usableMatch.own ? html`<span class="badge">${i18n.getMessage('exchangeBadgeExisting')}</span>` : ''}
					${script ? html`<span class="badge bad">${i18n.getMessage('exchangeScriptWarnTitle')}</span>` : ''}
					${ok ? '' : html`<span class="badge bad">${i18n.getMessage('exchangeBundleInvalid')}</span>`}
					<button class="bcaret" @click=${() => { row.expanded = !row.expanded; this.requestUpdate(); }}>
						${row.expanded ? '▾' : '▸'}
					</button>
				</div>
				${missing.length ? html`<p class="bhint">${this.#missingEngineText(missing, i18n)}</p>` : ''}
				${row.expanded ? html`<div class="bbody">${this.#renderBundleBody(row, i18n)}</div>` : ''}
			</div>`;
	}

	// Immer sichtbar, nicht erst nach dem Aufklappen: der Nutzer soll auf einen
	// Blick erkennen, welche Zeile warum gesperrt ist.
	#missingEngineText(missing, i18n) {
		return i18n.getMessage('exchangeMissingEngine').replace('{id}', missing.join(', '));
	}

	#renderBundleBody(row, i18n) {
		if (!row.result.ok) {
			return html`<p class="err">${i18n.getMessage('exchangeInvalidDetail').replace('{detail}', row.result.errors.join(', '))}</p>`;
		}
		const v = row.result.value;
		const body = row.result.type === 'menu'
			? this.#renderMenuBody(v, i18n)
			: this.#renderEngineBody(v, i18n, row.scriptAck, (c) => { row.scriptAck = c; this.requestUpdate(); });
		return html`
			${body}
			${this.#renderModeChoice(i18n, row.match, row.result.type, row.mode, (m) => { row.mode = m; this.requestUpdate(); }, `r${row.idx}-`)}`;
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
		// Ein Einzel-Import bringt keine Engine mit, also gibt es hier nichts, was
		// eine fehlende Referenz decken könnte. Die Vorschau bleibt stehen — der
		// Nutzer soll sehen, was er bekäme —, aber der Import ist gesperrt.
		const missing = this.#missingEngines(v, null);
		return html`
			${this.#renderMenuBody(v, i18n)}
			${missing.length ? html`<p class="err">${this.#missingEngineText(missing, i18n)}</p>` : ''}
			${this.#renderModeChoice(i18n, this._match, 'menu', this._importMode, (m) => { this._importMode = m; })}
			<div class="actions">
				<button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button>
				<button class="btn btn-primary" ?disabled=${!!missing.length} @click=${() => this.#confirm()}>${i18n.getMessage('exchangeConfirmImport')}</button>
			</div>`;
	}

	#renderEngine(v, i18n) {
		const script = this.#needsScriptAck;
		return html`
			${this.#renderEngineBody(v, i18n, this._scriptAck, (c) => { this._scriptAck = c; })}
			${this.#renderModeChoice(i18n, this._match, 'engine', this._importMode, (m) => { this._importMode = m; })}
			<div class="actions">
				<button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button>
				<button class="btn btn-primary" ?disabled=${script && !this._scriptAck} @click=${() => this.#confirm()}>${i18n.getMessage('exchangeConfirmImport')}</button>
			</div>`;
	}
}
customElements.define('menu-import-dialog', MenuImportDialog);
