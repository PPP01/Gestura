(function (root) {
	// Reine Rechnung für die Speicheranzeige. Keine chrome.*-APIs, kein DOM —
	// überall (Node-Tests, Options-UI) identisch nutzbar.
	//
	// Die Formel ist die, die Chrome für chrome.storage dokumentiert: die Länge
	// des Schlüssels plus die Länge des JSON-serialisierten Werts, in UTF-8-Bytes.
	// Bewusst selbst gerechnet statt über getBytesInUse(): das ist asynchron und
	// war in Firefox für storage.sync lange nicht implementiert.

	// Gemessene Durchschnittsgrößen aus den mitgelieferten Katalogen. Sie dienen
	// als Schätzer, solange ein Zweig noch keine eigenen Einträge hat.
	const AVG_FALLBACK = { menu: 1001, engine: 797 };

	function byteLength(str) {
		return new TextEncoder().encode(str).length;
	}

	function usageOf(key, value, quota) {
		const bytes = byteLength(String(key)) + byteLength(JSON.stringify(value));
		let percent = Math.round((100 * bytes) / quota);
		// Nicht auf 100 aufrunden, solange noch ein Byte frei ist: die Anzeige
		// würde sonst "voll" melden, wo ein Import noch durchgeht.
		if (percent >= 100 && bytes < quota) percent = 99;
		return { bytes, quota, percent };
	}

	function remainingEntries(freeBytes, existingValues, fallbackAvg) {
		if (!(freeBytes > 0)) return 0;
		const list = Array.isArray(existingValues) ? existingValues : [];
		const avg = list.length
			? list.reduce((sum, v) => sum + byteLength(JSON.stringify(v)), 0) / list.length
			: fallbackAvg;
		if (!(avg > 0)) return 0;
		return Math.floor(freeBytes / avg);
	}

	const api = { AVG_FALLBACK, byteLength, usageOf, remainingEntries };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseStorageUsage = api;
})(typeof self !== 'undefined' ? self : globalThis);
