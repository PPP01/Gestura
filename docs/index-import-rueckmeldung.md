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

## Nachtrag 2: `source.indexId` ist jetzt gesetzt

Eure Analyse war richtig, in allen vier Punkten. Das Feld wurde an zwei Stellen gelesen und nirgends geschrieben; die Spec sah es vor. **Ihr müsst dafür nichts als offenen Punkt festhalten — es ist auf Extension-Seite behoben.** Im Index war tatsächlich nichts zu ändern.

Eine Ursache hattet ihr noch nicht gesehen, und sie war die schwerere: der Import-Dialog verglich einen ankommenden Eintrag **ausschließlich mit dem eingebauten Katalog**. Ein Eintrag, den derselbe Nutzer schon einmal importiert hatte, liegt unter `custom` und wurde nie gefunden — es gab also gar keine Wahl „ersetzen", der Dialog kannte nur „als neuen Eintrag hinzufügen". Deshalb standen vier Perplexity-Einträge nebeneinander, bis der Speicher voll war. Selbst mit gesetzter `indexId` hätte sich daran nichts geändert.

Was sich für euch ändert:

- **Re-Export trägt wieder eure ID.** Wer ein Index-Menü importiert, anpasst und exportiert, bekommt jetzt `id: "com.whatsapp.menu"` statt `menu_a1b2c3d4e5f6`. Reicht er das ein, ist es ein Update am Original — nicht mehr ein neuer Eintrag.
- **Der Update-Check wird möglich.** `source` trägt jetzt `indexId` **und** `version`, das Paar, das euer `UpdateCheckController` erwartet. Gebaut ist die Abfrage auf unserer Seite noch nicht; die Daten liegen jetzt aber vor.
- **Ein zweiter Import desselben Eintrags aktualisiert.** Er wird in der Vorschau als *Vorhanden* gekennzeichnet und aktualisiert vorbelegt. Der Nutzer kann weiterhin bewusst eine zweite Kopie anlegen.

Zwei Einschränkungen, damit ihr nicht darauf baut:

**`type` bleibt `'site'`, nicht `'index'`.** Die Spec listet beide, aber die Übergabe sagt uns nicht, ob die Seite der Index ist oder irgendein anderer Betreiber — wir könnten es nur raten. Falls euch die Unterscheidung wichtig ist, wäre ein Feld im Payload der ehrliche Weg; sagt Bescheid.

**Altbestand bleibt unerkannt.** Einträge, die vor dieser Änderung importiert wurden, tragen kein `indexId`. Sie gelten als unbekannt und müssen einmal von Hand gelöscht werden. Erkannt wird bewusst nur an der ID, nicht an Name oder URL: beide darf der Nutzer geändert haben, ohne dass daraus ein anderer Eintrag wird.
