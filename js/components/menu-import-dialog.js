import { LitElement, html, css } from '../lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { settingsStore } from '../settings-store.js';

const X = () => window.FlowMouseMenuExchange;
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
		_catalogMatch: { state: true },   // matching catalog menu / built-in engine, or null
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
	`];

	constructor() {
		super();
		this._open = false;
		this._result = null;
		this._source = null;
		this._scriptAck = false;
		this._catalogMatch = null;
		this._importMode = 'new';
		this._bundle = null;
	}

	// Verzweigt auf den Formattyp: ein Bundle bekommt die Sammel-Vorschau, alles
	// andere den bisherigen Einzelpfad. Gerendert wird nie das rohe JSON, sondern
	// immer nur der normalisierte value aus der Validierung.
	openWith(rawObject, source) {
		this._source = source || { type: 'file' };
		this._scriptAck = false;
		this._result = null;
		this._bundle = null;
		this._catalogMatch = null;
		this._importMode = 'new';

		if (X().detectType(rawObject) === 'bundle') {
			const res = X().validateBundle(rawObject);
			this._bundle = {
				errors: res.errors,
				rows: res.entries.map((result, i) => {
					const match = result.ok ? this.#catalogMatch(result) : null;
					const row = { result, match, selected: result.ok, mode: match ? 'replace' : 'new', scriptAck: false, expanded: false, idx: i };
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
			this._catalogMatch = this._result.ok ? this.#catalogMatch(this._result) : null;
			this._importMode = this._catalogMatch ? 'replace' : 'new';
		}
		this._open = true;
	}

	#catalogMatch(result) {
		return result.type === 'menu' ? this.#catalogMenuMatch(result.value) : this.#catalogEngineMatch(result.value);
	}

	#close() { this._open = false; this._result = null; this._bundle = null; this._catalogMatch = null; }

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

	// scope disambiguates the radio group name across bundle rows: shadow-root
	// radio groups are scoped only by name, and two rows can share a match.id
	// (a menu and an engine with the same catalog id, or a bundle with a
	// duplicate id across entries). The single-format callers pass no scope
	// and keep today's unscoped name.
	#renderModeChoice(i18n, match, type, mode, onMode, scope = '') {
		if (!match) return '';
		const name = this.#matchName(match, type, i18n);
		return html`
			<div class="mode">
				<div class="mode-label">${i18n.getMessage('exchangeImportAs')}</div>
				<label class="mode-opt">
					<input type="radio" name="importmode-${scope}${match.id}" .checked=${mode === 'replace'}
						@change=${() => onMode('replace')}>
					<span>${i18n.getMessage('exchangeReplaceStandard').replace('{name}', name)}</span>
				</label>
				<label class="mode-opt">
					<input type="radio" name="importmode-${scope}${match.id}" .checked=${mode === 'new'}
						@change=${() => onMode('new')}>
					<span>${i18n.getMessage('exchangeAddAsNew')}</span>
				</label>
			</div>`;
	}

	#lang() { try { return (window.i18n.getCurrentLanguage() || 'en').split('_')[0]; } catch { return 'en'; } }

	// Belegung, die nach dem Import bestünde - dieselbe Zahl, die der Manager
	// danach anzeigt. Bewusst NICHT der Anteil der Auswahl am freien Platz:
	// derselbe Prozentwert soll an beiden Orten dasselbe bedeuten.
	#projectedUsage(patch) {
		const S = window.FlowMouseStorageUsage;
		const quota = (chrome.storage.sync && chrome.storage.sync.QUOTA_BYTES_PER_ITEM) || 8192;
		let worst = null;
		for (const [key, value] of Object.entries(patch)) {
			const u = S.usageOf(key, value, quota);
			if (!worst || u.percent > worst.percent) worst = u;
		}
		return worst;
	}

	get #needsScriptAck() {
		const r = this._result;
		return !!(r && r.ok && r.type === 'engine' && X().hasTransform(r.value));
	}

	// Reine Transformation: nimmt den aktuellen siteMenus-Zustand und gibt den
	// nächsten zurück, ohne zu speichern. Einzel- und Sammel-Import gehen beide
	// hierdurch, damit sie garantiert dasselbe schreiben.
	#applyMenu(cur, result, source, lang, mode, matchId, engineIdMap) {
		if (mode === 'replace' && matchId) {
			// Standard-Menü ersetzen → verhält sich wie ein bearbeitetes Katalog-Menü.
			const def = X().toStandardMenu(result.value, lang, engineIdMap);
			return { ...cur, edited: { ...cur.edited, [matchId]: def } };
		}
		const { id, def } = X().toCustomMenu(result.value, source, undefined, lang, engineIdMap);
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
			return { next: { ...cur, overrides: { ...cur.overrides, [matchId]: ov } }, id: matchId };
		}
		const engine = strip(X().toCustomEngine(result.value, source, undefined, lang));
		return { next: { ...cur, custom: [...(cur.custom || []), engine] }, id: engine.id };
	}

	// Gemeinsamer Abschluss beider Import-Wege: speichern, Fehler melden,
	// Katalog-Neuaufbau anstoßen, Dialog schließen.
	//
	// Die Sync-Quote (8 KB je Item, und beide Zweige sind je EIN Item) prüft
	// chrome.storage.sync selbst: reicht der Platz nicht, lehnt set() ab,
	// settingsStore.save() nimmt seinen Zustand zurück und liefert false, und
	// der Nutzer sieht dieselbe Meldung. Eine eigene Vorab-Rechnung hier wäre
	// eine zweite Kopie der Quoten-Regel, die von der echten Buchführung des
	// Browsers abweichen kann - die Bundle-Limits (200 Einträge, 1 MB) sind
	// ohnehin der Transport-Vertrag mit dem Index-Backend, nicht diese Grenze.
	async #commitPatch(patch, detail) {
		const ok = await settingsStore.save(patch);
		if (!ok) { alert(window.i18n.getMessage('menuSyncSaveError')); return; }
		window.dispatchEvent(new Event('action-catalog-changed'));
		this.dispatchEvent(new CustomEvent('import-done', { detail, bubbles: true, composed: true }));
		this.#close();
	}

	async #confirm() {
		const r = this._result;
		if (!r || !r.ok) return;
		// Defense in depth: der Button ist bereits gesperrt, aber ein Menü mit
		// fehlender Engine darf auf keinem Weg in den Speicher.
		if (r.type === 'menu' && this.#missingEngines(r.value, null).length) return;
		const source = { ...this._source, version: r.value.version || '1.0.0' };
		const lang = this.#lang();
		const mode = this._catalogMatch ? this._importMode : 'new';
		const matchId = this._catalogMatch ? this._catalogMatch.id : null;
		const patch = r.type === 'menu'
			? { siteMenus: this.#applyMenu(settingsStore.current.siteMenus || emptySiteMenus(), r, source, lang, mode, matchId) }
			: { searchEngines: this.#applyEngine(settingsStore.current.searchEngines || emptyEngines(), r, source, lang, mode, matchId).next };
		const u = this.#projectedUsage(patch);
		if (u && u.bytes > u.quota) { alert(window.i18n.getMessage('storageImportTooLarge')); return; }
		await this.#commitPatch(patch, { type: r.type });
	}

	// Baut den Patch, den ein Import der gewählten Zeilen schreiben würde.
	// Rein - schreibt nichts. Von #confirmBundle() und von der Vorschau genutzt,
	// damit die angezeigte Belegung und die tatsächliche nie auseinanderlaufen.
	#patchFor(chosen) {
		const lang = this.#lang();
		let siteMenus = settingsStore.current.siteMenus || emptySiteMenus();
		let engines = settingsStore.current.searchEngines || emptyEngines();
		let touchedMenus = false;
		let touchedEngines = false;
		const src = (row) => ({ ...this._source, version: row.result.value.version || '1.0.0' });
		const mid = (row) => (row.match ? row.match.id : null);

		// Engines zuerst, und zwar in einem eigenen Durchgang: toCustomEngine vergibt
		// eine neue ID, die von der im Bundle abweicht. Erst wenn alle gespeicherten
		// IDs feststehen, lassen sich die Menü-Verweise darauf umbiegen - sonst zeigt
		// ein mitimportiertes Menü ins Leere und sein Eintrag verschwindet still.
		const engineIdMap = {};
		for (const row of chosen) {
			if (row.result.type !== 'engine') continue;
			const applied = this.#applyEngine(engines, row.result, src(row), lang, row.mode, mid(row));
			engines = applied.next;
			engineIdMap[row.result.value.id] = applied.id;
			touchedEngines = true;
		}
		for (const row of chosen) {
			if (row.result.type !== 'menu') continue;
			siteMenus = this.#applyMenu(siteMenus, row.result, src(row), lang, row.mode, mid(row), engineIdMap);
			touchedMenus = true;
		}
		const patch = {};
		if (touchedMenus) patch.siteMenus = siteMenus;
		if (touchedEngines) patch.searchEngines = engines;
		return patch;
	}

	// Schreibt alle gewählten Einträge in EINEM settingsStore.save(). Nicht je
	// Eintrag speichern: das wären n Sync-Schreibzugriffe und n Gelegenheiten
	// für einen Sync-Konflikt.
	async #confirmBundle() {
		const chosen = this.#bundleChosen;
		const patch = this.#patchFor(chosen);
		if (!chosen.length || this.#blockedFor(chosen, this.#projectedUsage(patch))) return;
		const provided = this.#providedEngineIds();
		if (chosen.some(r => r.result.type === 'menu' && this.#missingEngines(r.result.value, provided).length)) return;
		await this.#commitPatch(patch, { count: chosen.length });
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
		if (projected && projected.bytes > projected.quota) return 'storage';
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

	#rowSelectable(row, provided) {
		if (!row.result.ok) return false;
		if (row.result.type !== 'menu') return true;
		return !this.#missingEngines(row.result.value, provided).length;
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
		const patch = chosen.length ? this.#patchFor(chosen) : null;
		const projected = patch ? this.#projectedUsage(patch) : null;
		const blocked = this.#blockedFor(chosen, projected);
		const provided = this.#providedEngineIds();
		// Auswählbar ist weniger als gültig: ein Menü mit fehlender Engine ist
		// tadellos validiert und trotzdem gesperrt. Die Zahl bewegt sich mit, wenn
		// der Nutzer eine Engine an- oder abwählt — das ist gewollt.
		const valid = rows.filter(r => this.#rowSelectable(r, provided)).length;
		const allOn = valid > 0 && chosen.length === valid;
		return html`
			<div class="bsum">
				<span>${i18n.getMessage('exchangeBundleSummary').replace('{count}', rows.length).replace('{valid}', valid)}</span>
				<span class="bstorage">${projected ? i18n.getMessage('storageUsed').replace('{percent}', projected.percent) : ''}</span>
				<span class="spacer"></span>
				<label class="mode-opt">
					<input type="checkbox" .checked=${allOn}
						@change=${(e) => {
							// Erst alles setzen, dann die Abhängigkeiten prüfen: beim Anhaken
							// wird eine Engine erst im Lauf der Schleife verfügbar, die Reihenfolge
							// der Zeilen darf darüber nicht entscheiden.
							for (const r of rows) { if (r.result.ok) this.#selectRow(r, e.target.checked, false); }
							this.#dropDependentMenus();
							this.requestUpdate();
						}}>
					<span>${i18n.getMessage('exchangeBundleSelectAll')}</span>
				</label>
			</div>
			${rows.map(row => this.#renderBundleRow(row, i18n, lang, provided))}
			${blocked === 'script' ? html`<p class="bhint">${i18n.getMessage('exchangeBundleScriptPending')}</p>` : ''}
			${blocked === 'storage' ? html`<p class="bhint notice">${i18n.getMessage('storageImportTooLarge')}</p>` : ''}
			<div class="actions">
				<button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button>
				<button class="btn btn-primary" ?disabled=${!!blocked} @click=${() => this.#confirmBundle()}>
					${i18n.getMessage('exchangeBundleImport').replace('{count}', chosen.length)}
				</button>
			</div>`;
	}

	#renderBundleRow(row, i18n, lang, provided) {
		const ok = row.result.ok;
		const v = row.result.value;
		const missing = ok && row.result.type === 'menu' ? this.#missingEngines(v, provided) : [];
		const selectable = this.#rowSelectable(row, provided);
		const script = ok && row.result.type === 'engine' && X().hasTransform(v);
		const firstLink = ok && row.result.type === 'menu' ? v.items.find(it => it.customUrl || it.url) : null;
		const iconUrl = !ok ? null
			: (row.result.type === 'engine' ? v.url : (firstLink ? (firstLink.customUrl || firstLink.url) : null));
		const name = this.#rowName(row, lang);
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
			${this.#renderModeChoice(i18n, this._catalogMatch, 'menu', this._importMode, (m) => { this._importMode = m; })}
			<div class="actions">
				<button class="btn" @click=${() => this.#close()}>${i18n.getMessage('exchangeCancel')}</button>
				<button class="btn btn-primary" ?disabled=${!!missing.length} @click=${() => this.#confirm()}>${i18n.getMessage('exchangeConfirmImport')}</button>
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
