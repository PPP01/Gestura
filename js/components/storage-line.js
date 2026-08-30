import { html } from '../../js/lib/lit-all.min.js';
import { usageOf, remainingEntries } from '../storage-usage.js';

// Knapper Hinweis unter einer Liste: Prozent und geschätzte Restanzahl. Bytes
// stehen bewusst nur in der Datenverwaltung - für die meisten Nutzer ist die
// Byte-Zahl keine brauchbare Größe. Unauffällig, solange Platz ist.
//
// Menü- und Engine-Manager teilen sich diese Fassung: die Schwellen (75/100),
// der Trenner und die Regel "keine Restanzahl bei 0" sind eine Aussage über den
// Speicher, keine über den jeweiligen Zweig. Liefe sie zweimal, könnten die
// beiden Abschnitte derselben Seite verschieden melden, ab wann es eng wird.
// Was sich wirklich unterscheidet, sind die drei Argumente.
export function renderStorageLine(i18n, key, value, entries, avgFallback) {
	const u = usageOf(key, value);
	if (u.percent >= 100) {
		return html`<div class="notice storage-full">${i18n.getMessage('storageFull')}</div>`;
	}
	const left = remainingEntries(u.quota - u.bytes, entries, avgFallback);
	// Bei 0 passt kein weiterer Eintrag mehr - "noch etwa 0" wäre nur
	// verwirrend, deshalb entfällt die Restanzahl dann.
	const text = i18n.getMessage('storageUsed').replace('{percent}', u.percent)
		+ (left > 0 ? ' · ' + i18n.getMessage('storageRemaining').replace('{count}', left) : '');
	return u.percent >= 75
		? html`<div class="notice">${text}</div>`
		: html`<div class="storage-line">${text}</div>`;
}
