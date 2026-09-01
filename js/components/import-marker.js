// Die Markierung "gerade importiert" lebt in sessionStorage, nicht in den
// Einstellungen. Sie ist eine Wegbeschreibung, kein Zustand: sie soll ein
// versehentliches Neuladen der Optionsseite überstehen - genau dann sucht man ja
// noch - und mit dem Tab enden. Aus den Einstellungen wäre sie dauerhaft, würde
// über Sync auf andere Geräte wandern, wo nie jemand etwas importiert hat, und
// kostete Bytes aus der knappen 8192er Quote.
//
// Menü- und Engine-Manager lesen denselben Schlüssel und filtern ihre eigene Art
// heraus: ein Bundle bringt beides mit, und der Nutzer steht dabei in einem der
// beiden Abschnitte.

const KEY = 'gestura:justImported';

function read() {
	try {
		const raw = sessionStorage.getItem(KEY);
		const parsed = raw ? JSON.parse(raw) : null;
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		// Privater Modus, blockierte Website-Daten: ohne Markierung ist die Liste
		// nur unbequemer, nicht kaputt.
		return [];
	}
}

function write(entries) {
	try {
		if (entries.length) sessionStorage.setItem(KEY, JSON.stringify(entries));
		else sessionStorage.removeItem(KEY);
	} catch { }
}

// Ersetzt die Markierung - der vorige Import ist nicht mehr der letzte.
export function markImported(entries) {
	write((entries || []).map(e => ({ kind: e.kind, id: e.id, isNew: e.isNew })));
}

// Die Markierungen einer Art, in der Reihenfolge des Imports.
export function importedOf(kind) {
	return read().filter(e => e.kind === kind);
}

// Der Nutzer hat den Eintrag gefunden und angefasst; die Markierung hat ihren
// Zweck erfüllt.
export function clearImported(kind, id) {
	const left = read().filter(e => !(e.kind === kind && e.id === id));
	write(left);
}
