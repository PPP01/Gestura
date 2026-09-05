import { html } from '../../js/lib/lit-all.min.js';
import { remainingEntries, percentOf } from '../storage-usage.js';

// Knapper Hinweis unter einer Liste. Bytes stehen bewusst nur in der
// Datenverwaltung - für die meisten Nutzer ist die Byte-Zahl keine brauchbare
// Größe. Unauffällig, solange Platz ist.
//
// Menü- und Engine-Manager teilen sich diese Fassung: die Schwellen (75/100),
// der Trenner und die Regel "keine Restanzahl bei 0" sind eine Aussage über den
// Speicher, keine über den jeweiligen Zweig.
//
// The ceiling follows the area (storage-move design §6). Browser sync on: this
// branch against 8192 bytes, with the remaining-count estimate. Browser sync
// off: the TOTAL against 1 MiB, and nothing at all below 75 % - "about 900 more
// menus" tells nobody anything, so the estimate is dropped there rather than
// translated. `settings` is the whole settings object; `key` says which branch
// this line stands under.
export function renderStorageLine(i18n, key, settings, entries, avgFallback) {
	const S = window.GesturaSettingsStorage;
	const quota = S.QUOTA[S.area()];
	if (quota.item === null) {
		const percent = percentOf(S.usage(settings).total, quota.total);
		if (percent >= 100) return html`<div class="notice storage-full">${i18n.getMessage('storageFull')}</div>`;
		if (percent < 75) return '';
		return html`<div class="notice">${i18n.getMessage('storageUsed').replace('{percent}', percent)}</div>`;
	}
	// One branch, not seventy: this runs on every re-render of the menu and engine
	// managers, and usage() would re-serialise the whole settings tree to answer
	// a question about a single key.
	const bytes = key in settings ? S.entryBytes(key, settings[key]) : 0;
	const percent = percentOf(bytes, quota.item);
	if (percent >= 100) {
		return html`<div class="notice storage-full">${i18n.getMessage('storageFull')}</div>`;
	}
	const left = remainingEntries(quota.item - bytes, entries, avgFallback);
	// Bei 0 passt kein weiterer Eintrag mehr - "noch etwa 0" wäre nur
	// verwirrend, deshalb entfällt die Restanzahl dann.
	const text = i18n.getMessage('storageUsed').replace('{percent}', percent)
		+ (left > 0 ? ' · ' + i18n.getMessage('storageRemaining').replace('{count}', left) : '');
	return percent >= 75
		? html`<div class="notice">${text}</div>`
		: html`<div class="storage-line">${text}</div>`;
}
