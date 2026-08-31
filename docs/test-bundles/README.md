# Test-Bundles für die Speicherbelegung

Import-Dateien, um `siteMenus` schrittweise zu füllen und zu beobachten, was an der Grenze passiert. Sie liegen unter `docs/`, werden also weder vom Chrome-Paket (`git archive` listet nur `manifest.json js _locales icons pages css LICENSE NOTICE THIRD_PARTY_LICENSES.md`) noch vom Firefox-Build eingepackt (`docs/**` steht in `ignoreFiles`).

Alle Dateien sind formal gültig — sie scheitern also nie an der Validierung, nur am Speicher. Die URLs zeigen auf `*.example.com` und sind absichtlich tot.

## Der Deckel

`chrome.storage.sync` erlaubt **8192 Bytes je Item**, und `siteMenus` ist genau ein Item. Was zählt, ist **nicht die Dateigröße**, sondern die gespeicherte Form: Labels werden beim Import auf eine Sprache eingedampft, Item-IDs neu vergeben. Deshalb weicht beides voneinander ab.

| Datei | Inhalt | gespeichert |
| --- | --- | --- |
| `01-klein.json` | 1 Menü, 4 Einträge | 718 B |
| `02-mittel.json` | 1 Menü, 9 Einträge | 1493 B |
| `03-gross.json` | 1 Menü, 16 Einträge | 2544 B |
| `04-bundle-3er.json` | Bundle mit 3 Menüs | 3049 B |
| `05-zu-gross.json` | 1 Menü, 57 Einträge | 9147 B |
| `06-menue-mit-engine.json` | Bundle: eigene Engine + Menü, das sie nutzt | 612 B |
| `07-menue-ohne-engine.json` | 1 Menü, zeigt auf eine fehlende Engine | 399 B |

## Die Treppe

Ab **frischem** Profil (`siteMenus` bei 108 B), jede Datei über *Aus Datei importieren…* im Menü-Manager, jeweils als **neuer Eintrag**:

| Schritt | danach belegt | |
| --- | --- | --- |
| Start | 108 B · 1 % | |
| `01-klein` | 865 B · 11 % | |
| `02-mittel` | 2399 B · 29 % | |
| `03-gross` | 4984 B · 61 % | |
| `04-bundle-3er` | 8156 B · **99,6 %** | passt noch — siehe unten |
| `01-klein` nochmal | 8915 B · 109 % | **Speichern scheitert** |

Dieselbe Datei lässt sich beliebig oft importieren: „als neuen Eintrag hinzufügen" vergibt jedes Mal frische IDs, es entsteht also eine weitere Kopie. Damit kannst du dich in 718-B-Schritten an die Grenze heranarbeiten.

**Schritt 4 ist der interessante.** 8156 von 8192 Bytes sind 99,56 % — naiv gerundet steht da **100 %**, obwohl noch 36 Bytes frei sind und der Import einwandfrei durchgeht. Eine Anzeige, die hier „voll" meldet, lügt. Genau dieser Fall gehört geprüft.

Wer schneller an die Wand will: `05-zu-gross.json` sprengt die Quote mit 9147 B **allein**, aus jedem Startzustand heraus.

## Was passiert, wenn es nicht passt

Unter beiden Listen steht eine Prozentzeile, ab 75 % hervorgehoben, ab 100 % als Fehler. Der Import-Dialog zeigt zusätzlich die Belegung, die **nach** dem Import bestünde, und sperrt den Knopf, sobald die Auswahl nicht mehr hineinpasst. Die Bytes stehen nur in *Einstellungen → Datenverwaltung*.

Kommt es trotzdem zum Schreibversuch, scheitert `settingsStore.save()`, der Dialog meldet *„Speichern fehlgeschlagen — die Menüdaten überschreiten das Sync-Speicherlimit"*, und der Zustand wird zurückgerollt — der Import ist dann schlicht nicht passiert.

## Belegung gegenrechnen

Die Anzeige soll dieselben Zahlen liefern wie eine Rechnung von Hand. DevTools auf der **Optionsseite** öffnen (nicht auf einer Webseite) und einfügen:

```js
chrome.storage.sync.get(null, s => {
	const q = chrome.storage.sync.QUOTA_BYTES_PER_ITEM || 8192;
	const b = (k, v) => new TextEncoder().encode(k + JSON.stringify(v)).length;
	for (const k of ['siteMenus', 'searchEngines', 'mouseGestures']) {
		const n = b(k, s[k]);
		console.log(k.padEnd(15), n + ' B', (100 * n / q).toFixed(1) + '%');
	}
});
```

Das ist dieselbe Formel, die `js/storage-usage.js` nutzt — die Werte müssen mit der Anzeige übereinstimmen.

## Die beiden Abhängigkeits-Fälle

Sie testen nicht den Speicher, sondern die Prüfung aus `feat/import-engine-dependency`, für die noch keine manuelle Abnahme gelaufen ist.

**`06-menue-mit-engine.json`** — Bundle aus einer eigenen Engine und einem Menü, das sie per `engineId` nutzt. Erwartet: beide Zeilen wählbar, Import legt beides an, und **nach dem Import muss der Sucheintrag im Menü tatsächlich funktionieren**. Das ist der Fall, der vor dem Fix still kaputt ging: die Engine bekam beim Speichern eine neue ID, das Menü zeigte weiter auf die alte.

Zusatzprobe: im Bundle die **Engine abwählen**. Das Menü muss sich daraufhin mit abwählen und die Begründung zeigen.

**`07-menue-ohne-engine.json`** — Einzel-Menü, das auf `com.example.gibtesnicht` zeigt. Erwartet: Vorschau erscheint, Import-Button ist **gesperrt**, und die Meldung nennt die fehlende Engine.

## Gruppen und Prozentzahlen im Bundle-Dialog

Die Vorschau trennt nach *Website-Menüs* und *Suchmaschinen*, jede Gruppe mit Anzahl, eigenem „Alle auswählen" und **eigener** Prozentzahl — die beiden Zweige haben je einen eigenen 8192-Byte-Deckel, eine gemeinsame Zahl verschwiege, welcher eng wird.

Jede Zahl steht an genau einem Ort, und der wechselt bei 75 %: darunter rechts in der Gruppen-Überschrift, darüber unten über dem Import-Knopf, dort mit dem Namen des Zweigs. Grund ist die lange Liste — bei 16 Einträgen ist die Überschrift aus dem Bild gescrollt, und dort wird nicht entschieden.

Zu prüfen mit `04-bundle-3er.json` (nur Menüs) und `06-menue-mit-engine.json` (beides):

- Häkchen setzen und entfernen: **beide** Zahlen müssen sich sofort mitbewegen.
- Alle Menüs abwählen: die Menü-Zahl bleibt stehen und zeigt den heutigen Stand — nicht leer, nicht 0 %.
- So viel anhaken, dass ein Zweig über 75 % geht: seine Zahl verschwindet oben und erscheint unten mit Namen. Der andere Zweig bleibt oben.
- Gesperrter Import: die Begründung steht als eigene Zeile über den Zahlen, im selben orangen Kasten.
- Eine Gruppe ganz abwählen: nur deren Kontrollkästchen geht aus, das der anderen bleibt.

## Zweimal dasselbe importieren

Der Fall, an dem vier Perplexity-Einträge nebeneinander entstanden sind.

`06-menue-mit-engine.json` zweimal hintereinander importieren. Beim **zweiten** Mal erwartet:

- die Zeilen tragen das Abzeichen *Vorhanden*,
- aufgeklappt steht die Vorbelegung auf *Vorhandenen Eintrag „…" aktualisieren*, nicht auf *Als neuen Eintrag hinzufügen*,
- nach dem Import ist die Anzahl der Einträge **unverändert**, und die Prozentzahl bleibt stehen.

Gegenprobe: im Dialog bewusst auf *Als neuen Eintrag hinzufügen* umschalten. Dann darf sehr wohl eine zweite Kopie entstehen — die Wahl bleibt beim Nutzer.

Erkannt wird an `source.indexId`, der ID aus der Datei. Einträge, die vor dieser Änderung importiert wurden, tragen das Feld nicht und gelten deshalb als unbekannt: sie müssen einmal von Hand gelöscht werden, danach greift die Erkennung.

## Nach dem Import

Diese drei gehören zu jedem Import oben mitgeprüft, nicht als eigener Durchgang:

1. **Meldung.** Über der Liste steht zehn Sekunden lang *„Importiert — Website-Menüs: 2 · Suchmaschinen: 1"*. Die Zahlen müssen zur Auswahl passen, auch wenn du im Bundle Zeilen abgewählt hast.
2. **Reihenfolge.** Das neue Menü steht **unten**, nicht über dem Katalog. Bei mehreren Importen in der Reihenfolge, in der sie kamen.
3. **Markierung.** Der Manager springt zum ersten neuen Eintrag, die Zeile pulst einmal und trägt ein *Neu*-Abzeichen. Seite neu laden: das Abzeichen ist noch da, die Meldung nicht. Eintrag zum Bearbeiten öffnen: das Abzeichen verschwindet. Tab schließen und neu öffnen: alles weg.

## Rückmeldung an die Seite

Nur für den Inline-Weg. Die Testseite aus Punkt 7 der Prüfliste um einen Empfänger ergänzen:

```js
document.addEventListener('gestura:import-result', (e) => console.log(JSON.parse(e.detail)));
```

Erwartet: nach dem Import `{status:'imported', menus:3, engines:0}`, nach *Abbrechen* `{status:'cancelled', menus:0, engines:0}`. Bei einem Import über *Aus Datei importieren…* darf **nichts** kommen — dort gibt es keine Seite, die wartet.

## Aufräumen

Die angelegten Menüs heißen *Klein*, *Mittel*, *Groß*, *Alpha*, *Beta*, *Gamma*, *Zu viel*, *Mit eigener Suche* und lassen sich im Menü-Manager einzeln löschen. Wer alles auf einmal loswerden will, in der DevTools-Konsole der Optionsseite:

```js
chrome.storage.sync.get(['siteMenus'], s => {
	const sm = s.siteMenus || {};
	chrome.storage.sync.set({ siteMenus: { ...sm, custom: {}, order: [] } },
		() => location.reload());
});
```

Das entfernt **alle** eigenen und importierten Menüs — bearbeitete Katalog-Menüs (`edited`) und Deaktivierungen bleiben unangetastet.
