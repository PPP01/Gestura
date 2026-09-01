import { html, unsafeHTML } from '../../js/lib/lit-all.min.js';
import { icon } from '../icons.js';
import { importedOf, clearImported } from './import-marker.js';

// Was nach einem Import zu sehen ist: eine Meldung über der Liste, ein Abzeichen an
// jeder betroffenen Zeile, ein Sprung zum ersten neuen Eintrag und ein einmaliger
// Puls, sobald eine markierte Zeile ins Blickfeld kommt.
//
// Menü- und Engine-Manager teilen sich das komplett. Ein Import bringt beides mit,
// und beide Abschnitte liegen auf derselben Seite - liefen hier zwei Fassungen,
// könnten sie verschieden melden, was gerade passiert ist.

// Wie lange die Erfolgsmeldung steht. Das Abzeichen bleibt länger: es beantwortet
// "wo ist es hin", und diese Frage stellt sich auch noch nach einer Minute.
const DONE_MS = 10000;

export function renderImportDone(i18n, imported) {
	if (!imported || !imported.length) return '';
	const menus = imported.filter(e => e.kind === 'menu').length;
	const engines = imported.filter(e => e.kind === 'engine').length;
	// Bewusst "Bezeichnung: Anzahl" statt "N Menüs importiert": ein gebeugtes
	// Substantiv hinter einer Zahl ist in mehreren der 39 Sprachen von der Zahl
	// abhängig (cs/sk unterscheiden 1, 2-4 und ab 5). Diese Form braucht keine
	// Beugung und nutzt Bezeichnungen, die es längst in allen Sprachen gibt.
	const parts = [];
	if (menus) parts.push(`${i18n.getMessage('siteMenusTitle')}: ${menus}`);
	if (engines) parts.push(`${i18n.getMessage('sectionSearchEngines')}: ${engines}`);
	return html`
		<div class="import-done">
			${unsafeHTML(icon('circleCheck', { size: 14, strokeWidth: 2 }))}
			<span>${i18n.getMessage('importDoneTitle')}${parts.length ? ` — ${parts.join(' · ')}` : ''}</span>
		</div>`;
}

export function renderImportBadge(i18n) {
	return html`<span class="import-badge">${i18n.getMessage('importBadgeNew')}</span>`;
}

// Der Zustand dahinter. Die Komponente hält eine Instanz, meldet sie an und ab und
// ruft afterRender() aus updated() - alles Weitere passiert hier.
export class ImportHighlight {
	#kind;
	#onChange;
	#marks = [];
	#done = null;
	#scrollTo = null;
	#timer = null;
	#observer = null;
	#pulsed = new Set();

	constructor(kind, onChange) {
		this.#kind = kind;
		this.#onChange = onChange;
	}

	// Das Ereignis kommt vom Fenster, nicht vom Dialog: der Import kann auch aus
	// dem Dialog stammen, den die Optionsseite selbst an ihren Schattenbaum hängt
	// (Übergabe von einer Webseite). Der Manager bekäme dessen import-done nie zu
	// sehen, die Meldung bliebe dann genau auf dem Weg aus, der sie am nötigsten
	// hat - da hat der Nutzer die Liste nämlich noch gar nicht offen gehabt.
	#onDone = (e) => {
		this.#done = Array.isArray(e.detail) ? e.detail : [];
		this.#marks = importedOf(this.#kind);
		this.#scrollTo = this.#marks.length ? this.#marks[0].id : null;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => { this.#done = null; this.#onChange(); }, DONE_MS);
		this.#onChange();
	};

	connect() {
		// Beim Aufbau lesen, nicht nur beim Ereignis: nach einem Neuladen der
		// Optionsseite sind die Abzeichen noch da, die Meldung nicht mehr.
		this.#marks = importedOf(this.#kind);
		window.addEventListener('gestura:import-done', this.#onDone);
	}

	disconnect() {
		window.removeEventListener('gestura:import-done', this.#onDone);
		clearTimeout(this.#timer);
		if (this.#observer) { this.#observer.disconnect(); this.#observer = null; }
	}

	get done() { return this.#done; }

	isMarked(id) { return this.#marks.some(m => m.id === id); }

	// Der Nutzer hat den Eintrag gefunden und angefasst - die Markierung hat ihren
	// Zweck erfüllt und geht weg, damit sie beim nächsten Import wieder etwas sagt.
	clear(id) {
		if (!this.isMarked(id)) return;
		clearImported(this.#kind, id);
		this.#marks = importedOf(this.#kind);
		this.#onChange();
	}

	// Aus updated() aufzurufen, mit dem Schattenbaum der Komponente.
	afterRender(root) {
		if (!root || !this.#marks.length) return;

		if (this.#scrollTo) {
			const id = this.#scrollTo;
			this.#scrollTo = null;
			const target = root.querySelector(`[data-import-id="${CSS.escape(id)}"]`);
			if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}

		// Einmal je Eintrag pulsen, beim ersten Sichtbarwerden. Wer die Liste erst
		// später aufklappt oder hinunterscrollt, sieht den Puls dann - und nicht
		// unbemerkt außerhalb des Bildschirms.
		if (!this.#observer) {
			this.#observer = new IntersectionObserver((entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					this.#pulsed.add(entry.target.getAttribute('data-import-id'));
					entry.target.classList.add('just-imported');
					this.#observer.unobserve(entry.target);
				}
			}, { threshold: 0.5 });
		}
		for (const row of root.querySelectorAll('[data-import-id]')) {
			if (this.#pulsed.has(row.getAttribute('data-import-id'))) continue;
			this.#observer.observe(row);
		}
	}
}
