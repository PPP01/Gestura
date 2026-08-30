# Rückmeldung nach dem Import — Nachtrag zum Übergabe-Vertrag

Ergänzt [2026-08-30-bericht-an-gestura-index.md](2026-08-30-bericht-an-gestura-index.md), Abschnitt 2. Der Hinweg bleibt unverändert; dies beschreibt nur den Rückweg.

Anlass: nach der Übergabe passierte auf der auslösenden Seite nichts mehr. Das Exportfenster blieb offen, ohne zu wissen, ob der Nutzer importiert, abgebrochen oder die Optionsseite einfach weggeklickt hat.

## Der Vertrag

Die Erweiterung löst auf `document` ein `gestura:import-result` aus, sobald der Nutzer im Import-Dialog entschieden hat.

```js
document.addEventListener('gestura:import-result', (e) => {
	const r = JSON.parse(e.detail);   // detail ist ein String, wie auf dem Hinweg
	// r.status  'imported' | 'cancelled' | 'failed'
	// r.menus   Anzahl der übernommenen Website-Menüs
	// r.engines Anzahl der übernommenen Suchmaschinen
});
```

`detail` ist aus demselben Grund ein String wie beim Hinweg: ein Objekt aus dem Erweiterungs-Realm bräuchte in Firefox Sonderbehandlung, ein String überquert die Grenze ohne.

| `status` | bedeutet |
| --- | --- |
| `imported` | gespeichert. `menus` und `engines` sagen, wie viel davon ankam. |
| `cancelled` | der Nutzer hat den Dialog geschlossen, ohne zu importieren. Beide Zähler sind 0. |
| `failed` | der Schreibversuch schlug fehl, meist am Speicherplatz. Der Nutzer hat die Meldung bereits gesehen; nichts wurde gespeichert. |

Genau eine Meldung je Übergabe. Das Ereignis geht nur an den Frame, der die Übergabe ausgelöst hat — nicht an fremde iframes derselben Seite.

## Was nicht garantiert ist

**Die Meldung kann ausbleiben.** Das ist kein Randfall, sondern der Normalfall bei jedem dieser Abläufe:

- Der Tab ist geschlossen oder weiternavigiert, während der Dialog offen war.
- Der Nutzer schließt die ganze Optionsseite, statt den Dialog abzubrechen.
- Der Browser hat die Erweiterung zwischenzeitlich neu geladen.

**Die Seite braucht deshalb weiterhin ihren eigenen Timeout.** `gestura:import-result` verkürzt das Warten, es ersetzt es nicht. Ein Exportfenster, das nur auf dieses Ereignis hört, bleibt in den obigen Fällen für immer offen — und das ist der Zustand, den dieser Nachtrag beseitigen soll, nicht der, den er einführt.

Vorschlag: das Fenster nach 15 Sekunden ohne Meldung selbst schließen, mit einem neutralen Hinweis („Wenn du importiert hast, findest du die Einträge in den Gestura-Einstellungen"). Kommt die Meldung vorher, gewinnt sie.

## Was die Seite damit anfangen kann

Bei `imported` reicht das Schließen des Fensters; die Erweiterung zeigt dem Nutzer bereits selbst eine Bestätigung, springt zum neuen Eintrag und markiert ihn. Eine zweite Erfolgsmeldung auf eurer Seite ist Doppelung, keine Hilfe — höchstens ein knappes „im Browser übernommen".

Bei `cancelled` den Korb **stehen lassen**. Der Nutzer hat sich gegen diesen Import entschieden, nicht gegen seine Auswahl.

Bei `failed` ebenso, plus ein Hinweis, dass es am Platz gelegen haben kann — mit Verweis auf *Einstellungen → Datenverwaltung*, wo die Belegung steht.

## Eine bewusste Entscheidung

Die Zähler verraten euch, **wie viel der Nutzer behalten hat**. Wählt er im Dialog drei von fünf Einträgen ab, steht in `menus` eine 2. Ihr kennt euer eigenes Angebot, insofern ist die Auskunft klein — aber sie ist neu: vorher verließ keine Information über die Entscheidung des Nutzers die Erweiterung.

Wir nennen es hier, damit ihr euch bewusst dafür entscheidet, es zu nutzen oder zu ignorieren. Wenn ihr es nicht braucht, wertet nur `status` aus.

## Nebenbei behoben: die Reihenfolge

Ein importiertes Menü landete bisher **über** dem gesamten eingebauten Katalog, eine importierte Suchmaschine dagegen unten. Ursache war `siteMenus.order`: die Liste ist eine Vorrang-Liste, keine vollständige Sortierung, und der Import trug die neue ID dort ein.

Neu erscheinen beide Arten **am Ende ihrer Liste**, in der Reihenfolge des Imports. Für euch ändert das nichts am Vertrag — aber wenn eure Anleitung Schritte wie „scrolle zum neuen Menü" beschreibt, stimmt die Richtung jetzt.
