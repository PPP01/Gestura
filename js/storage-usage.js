// Reine Rechnung für die Speicheranzeige. Kein DOM, keine Lit-Abhängigkeit —
// überall (Node-Tests, Options-UI) identisch nutzbar.
//
// Die Formel ist die, die Chrome für chrome.storage dokumentiert: die Länge
// des Schlüssels plus die Länge des JSON-serialisierten Werts, in UTF-8-Bytes.
// Bewusst selbst gerechnet statt über getBytesInUse(): das ist asynchron und
// war in Firefox für storage.sync lange nicht implementiert.

// Gemessene Durchschnittsgrößen aus den mitgelieferten Katalogen. Sie dienen
// als Schätzer, solange ein Zweig noch keine eigenen Einträge hat.
export const AVG_FALLBACK = { menu: 1001, engine: 797 };

// Die Deckel gehören hierher, nicht in jede Anzeige: sonst steht der Rückfall-
// wert an jedem Ort erneut und eine Abweichung zwischen den Browsern müsste
// durch alle Aufrufer verfolgt werden. In Node gibt es kein chrome.* — dort
// gelten die dokumentierten Chrome-Werte.
const sync = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) || null;
export const ITEM_QUOTA = (sync && sync.QUOTA_BYTES_PER_ITEM) || 8192;
export const TOTAL_QUOTA = (sync && sync.QUOTA_BYTES) || 102400;

export function byteLength(str) {
	return new TextEncoder().encode(str).length;
}

// Was ein einzelner Einstellungs-Schlüssel im Speicher kostet.
export function entryBytes(key, value) {
	return byteLength(String(key)) + byteLength(JSON.stringify(value));
}

export function percentOf(bytes, quota) {
	const percent = Math.round((100 * bytes) / quota);
	// Nicht auf 100 aufrunden, solange noch ein Byte frei ist: die Anzeige
	// würde sonst "voll" melden, wo ein Import noch durchgeht.
	return (percent >= 100 && bytes < quota) ? 99 : percent;
}

export function usageOf(key, value, quota = ITEM_QUOTA) {
	const bytes = entryBytes(key, value);
	return { bytes, quota, percent: percentOf(bytes, quota) };
}

export function remainingEntries(freeBytes, existingValues, fallbackAvg) {
	if (!(freeBytes > 0)) return 0;
	const list = Array.isArray(existingValues) ? existingValues : [];
	const avg = list.length
		? list.reduce((sum, v) => sum + byteLength(JSON.stringify(v)), 0) / list.length
		: fallbackAvg;
	if (!(avg > 0)) return 0;
	return Math.floor(freeBytes / avg);
}
