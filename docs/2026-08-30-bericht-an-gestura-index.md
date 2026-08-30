# Bericht an das gestura-index-Team

**Stand: 30. August 2026** · Absender: Gestura-Extension-Repo (`main`-Linie)

Dieser Bericht fasst zusammen, was in der Extension für die Live-Übergabe
(»An Gestura senden«) fertig ist, welcher Vertrag dafür gilt und worauf der Index
achten muss. Er ersetzt die früheren Einzelnachrichten und ist so geschrieben,
dass er ohne Vorwissen aus dem Chatverlauf lesbar ist.

**Alles unten ist implementiert, reviewed und liegt auf einem Branch mit 24 Commits
über `main` — aber nicht gemergt, nicht gepusht, nicht released.** Plant also nicht
mit einem Store-Update, sondern mit dem Vertrag; der steht.

---

## 1. Was jetzt da ist

**Bundle-Import.** Der Import-Dialog versteht `{ gesturaBundle: 1, entries: [...] }`,
prüft jeden Eintrag einzeln gegen den bestehenden Validator und zeigt ihn als
eigene Zeile — mit eigener »Standard ersetzen / neu hinzufügen«-Wahl und, bei
Suchmaschinen mit Transform-Skript, eigener Bestätigung. Ein ungültiger Eintrag
wird mit seiner Begründung angezeigt und übersprungen; er blockiert die übrigen
nicht. Alles Gewählte wird in **einem** Speichervorgang geschrieben.

**Inline-Übergabe.** Die Seite holt ihr Bundle selbst und reicht das JSON weiter;
die Extension fetcht auf diesem Weg nichts. Damit entfallen **B1** (GET-fähige
Bundle-URL) und **B2** (Same-Origin-Reverse-Proxy) der alten Folge-TODO
ersatzlos — der bestehende `POST /api/v1/bundle` genügt, und
`Access-Control-Allow-Origin: *` deckt den Aufruf von `gestura.eu` bereits ab.

Zur Begründung, falls sie später jemand hinterfragt: Die Same-Origin-Regel des
Betreiber-Button-Kanals schützt nicht die Daten — die sind auf jedem Weg
unvertrauenswürdig und werden ausschließlich im Import-Dialog validiert. Sie
verhindert, dass eine beliebige Seite die Extension als **Fetch-Proxy** für fremde
URLs missbraucht: der Service Worker hat `<all_urls>` und erreicht Ziele, die der
Seite selbst verwehrt sind. Holt die Seite selbst, entsteht diese Angriffsfläche
gar nicht erst.

**Abhängigkeitsprüfung Menü → Suchmaschine.** Neu, und für den Index-Katalog
folgenreich — siehe Abschnitt 3.

**Speicheranzeige.** Der Nutzer sieht jetzt, wie voll sein Speicher ist, und der
Import-Dialog **verweigert eine zu große Auswahl, bevor** er schreibt. Das ändert
den ursprünglichen Korb-Entwurf — siehe Abschnitt 4 und 5.

---

## 2. Der Übergabe-Vertrag

```html
<button data-gestura-inline>An Gestura senden</button>
```

```js
btn.addEventListener('click', async () => {
    const bundle = await getBundle(basket.ids);       // euer bestehender POST
    document.dispatchEvent(new CustomEvent('gestura:import', {
        detail: JSON.stringify(bundle),               // ← String, kein Objekt
    }));
});
```

Sechs Punkte, an denen es sonst schiefgeht:

1. **`detail` MUSS ein String sein**, kein Objekt. Objekte aus dem Seiten-Realm
   bräuchten in Firefox `cloneInto`/Xray-Sonderbehandlung; ein String überquert die
   Welten-Grenze ohne Sonderfall, und die Größenprüfung greift so vor dem Parsen.
2. **`data-gestura-inline` gehört auf den Button selbst, nicht auf einen
   Container.** Die Extension ruft `preventDefault()` für jeden Klick, dessen Ziel
   *innerhalb* des markierten Elements liegt — auf dem Tray-Panel würde das jeden
   Link darin lahmlegen.
3. **Der Klick muss echt sein** (`event.isTrusted`). Ein `el.click()` aus
   JavaScript öffnet kein Übergabefenster.
4. **Das Fenster ist 15 Sekunden offen und nimmt genau einen Payload.** Der
   `fetch` muss also in dieser Frist zurück sein. Schlägt er fehl, zeigt ihr eure
   eigene Meldung — die Extension meldet nichts.
5. **Ein SvelteKit-Routenwechsel schließt das Fenster nicht** (das Dokument lebt
   weiter); nur der Timeout begrenzt es. Unkritisch, aber gut zu wissen.
6. **Euer eigener Klick-Handler läuft weiter.** Die Extension unterdrückt die
   Ereignis-Propagation auf diesem Pfad bewusst nicht — sonst käme euer `fetch`
   nie zustande.

Payload ist entweder ein Einzelformat (`gesturaMenu` / `gesturaEngine`) oder das
Bundle. Die Extension erkennt beides selbst.

**Limits der Übergabe:** 100 KB je Eintrag, 1 MB je Bundle, 200 Einträge. Das sind
Transport-Grenzen. Was tatsächlich beim Nutzer ankommt, begrenzt etwas ganz
anderes — Abschnitt 4.

**Alle URLs innerhalb der Einträge müssen `https:` sein.** Das gilt auch beim
lokalen Testen: ein `http://localhost/...`-Menüpunkt wird völlig zu Recht als
ungültig gemeldet. Die Übergabe selbst darf über `http://localhost` laufen.

Autoritativ dokumentiert im Extension-`README.md`, Abschnitt **»For site
operators«**.

---

## 3. Menü und eigene Suchmaschine gehören zusammen

Ein Menüeintrag vom Typ `searchLink` kann statt einer URL eine `engineId` tragen.
Für die **eingebauten** Engines ist das ideal: sie liegen im Code der Extension,
kosten null Speicher und respektieren die Einstellungen des Nutzers.

Zeigt die `engineId` auf eine **eigene** Engine, die der Nutzer nicht hat,
verschwand der Eintrag früher **stillschweigend** aus dem fertigen Menü — kein
Fehler, keine Lücke, er war schlicht nicht da. Das ist behoben:

- Die Extension **verweigert** ein solches Menü und nennt die fehlende Engine.
- Liegt die Engine im **selben Bundle**, ist das Menü importierbar. Die Extension
  biegt den Verweis beim Speichern automatisch auf die neu vergebene ID um.
- Wählt der Nutzer die Engine im Bundle **ab**, wird das abhängige Menü
  automatisch mit abgewählt und wieder gesperrt.

> Zur Warnung, weil es beinahe schiefgegangen wäre: Der erste Anlauf sicherte dem
> Nutzer zu, das Menü sei vollständig importierbar — und der Schreibpfad hielt das
> nicht ein. Eine importierte Engine bekommt beim Speichern eine **neu generierte**
> ID, das Menü behielt aber die ID aus der Datei. Der Verweis lief danach ins Leere
> und der Eintrag verschwand genau wie vorher, nur mit einer falschen Zusage davor.
> Gefixt und mit Tests abgesichert.

**Für den Index heißt das:**

- **Bei der Einreichung:** ein Menü mit einer `engineId`, die weder eingebaut ist
  noch als eigener Eintrag im Index existiert, sollte abgelehnt oder in die
  Moderation geschickt werden.
- **Im Korb:** legt jemand ein solches Menü hinein, muss die zugehörige Engine
  automatisch mitwandern. Sonst schickt ihr ein Bundle, dessen Menü beim Nutzer
  gesperrt ankommt.

---

## 4. Der Speicher — die wichtigste Änderung

**Die 100-KB-Zahl aus der alten TODO und die 1-MB-Kappe der Übergabe sind beide
praktisch wirkungslos.** Der echte Engpass ist ein anderer:

`chrome.storage.sync` erlaubt **8192 Bytes pro Item**, und `siteMenus` ist *ein*
Item. Suchmaschinen liegen in `searchEngines` — einem eigenen Item mit eigenen
8192 Bytes, sie konkurrieren also nicht mit den Menüs. Die Gesamtquote von
102400 Bytes wird praktisch nie erreicht; es scheitert immer ein einzelner Zweig.

### Gespeichert werden nur Deltas

Das ist der Punkt, der die Rechnung erklärt:

| Was | Speicherkosten |
| --- | --- |
| Unberührtes Katalog-Menü (GitHub, Gmail, YouTube …) | **0 Bytes** — liegt im Code |
| Deaktiviertes Menü | ~10 Bytes, nur die ID |
| Bearbeitetes Katalog-Menü | volle Definition |
| **Importiertes Menü** | **volle Definition** |

Ein Nutzer kann also sechzehn Menüs in seiner Liste haben und trotzdem fast
nichts belegen — solange er sie nicht anfasst. Ein Bundle vom Index bringt
dagegen lauter **Vollkopien** mit.

### Gemessene Größen

Kosten je Menüeintrag in der gespeicherten Form:

| Eintragsart | Bytes |
| --- | --- |
| Trenner | 45 |
| Gestura-Funktion (`back`, `refresh`, `scrollUp` …) | 65 |
| **Suchmaschine per `engineId`** | **90** |
| Suchmaschine per direkter `url` | 113 |
| Eigene URL | 160 |

Daraus für ganze Menüs:

| Menü | gespeichert | passt in die Quote |
| --- | --- | --- |
| 8 Suchmaschinen-Links | 982 B | **8 Menüs** |
| 8 eigene URLs | 1310 B | **6 Menüs** |
| 10 Einträge, zweisprachig (typischer Import) | ~1750 B | **3–4 Menüs** |

Zum Vergleich: die 15 mitgelieferten Katalog-Menüs wiegen zusammen 15011 Bytes —
fast das Doppelte der gesamten Item-Quote. Genau deshalb gibt es das Delta-Modell.

### Praktische Empfehlung für eure Katalog-Inhalte

Wo ein Menüeintrag eine Suche ist, ist `engineId` gegenüber einer ausgeschriebenen
URL rund **44 % billiger** — und respektiert obendrein die Engine-Einstellungen
des Nutzers, statt eine feste URL zu erzwingen. Für eingebaute Engines kostet die
Referenz nichts zusätzlich.

---

## 5. Was das für `BasketTray` bedeutet

**Die Extension fängt es ab.** Passt eine Auswahl nicht mehr, ist der Import-Button
gesperrt und der Nutzer bekommt eine klare Meldung — **vor** dem Schreibversuch,
nicht danach. Ihr müsst also nichts bauen, damit nichts kaputt geht.

**Aber ihr könnt es freundlicher machen.** Dafür braucht es eine Entscheidung auf
eurer Seite, und drei Fakten dazu:

- **Eine harte 1-MB-Kappe ist sinnlos** — sie liegt rund 120-fach über dem, was
  ankommt. Baut sie nicht.
- **Die echte Grenze könnt ihr nicht ausrechnen.** Sie hängt davon ab, was der
  Nutzer schon importiert oder angepasst hat, und das wisst ihr nicht.
- **Was ihr ausrechnen könnt, ist die Größe eures Korbs.** Ihr habt die Payloads.
  Die gespeicherte Form ist rund 15–20 % kleiner als das rohe JSON, weil Labels
  beim Import auf **eine** Sprache eingedampft und Item-IDs neu vergeben werden.

**Vorschlag, aber eure Entscheidung:** kein Deckel, sondern ein Hinweis am Korb,
sobald die Auswahl über etwa 5 KB geschätzter Speichergröße geht — mit dem Verweis
auf den Datei-Download als kappenfreien Weg. Wer den Korb voll macht, soll nicht
erst in der Extension erfahren, dass er zu weit gegangen ist.

**Optionaler Ausbau:** Die Listen-API könnte je Eintrag eine geschätzte
Speichergröße mitliefern. Dann rechnet der Korb live mit, ohne die Payloads zu
laden. Das ist Aufwand bei euch — ich melde nur, dass die Information auf eurer
Seite verfügbar wäre.

---

## 6. Was im Index-Repo zu tun ist

1. **Schema-Kopie erneuern.** `js/exchange-schema.json` aus dem Extension-Repo
   nach `schema/exchange-schema.json` kopieren. Es hat jetzt `$defs.bundle` und
   zwei neue Limits (`bundleEntriesMax: 200`, `bundleBlobMax: 1048576`).
   Kopie-Regel beachten: im Index-Repo nie direkt editieren.
2. **`BasketTray.svelte`:** den `disabled`-Button live schalten,
   `data-gestura-inline` setzen, nach `getBundle()` das `gestura:import`-Event
   feuern, `basket_send_soon` durch echten Aktionstext ersetzen. Neue i18n-Keys
   nur in `messages/en.json` + `de.json`.
3. **Einreichungs-Regel** für die Menü→Engine-Abhängigkeit (Abschnitt 3).
4. **Korb-Hinweis** statt harter Kappe (Abschnitt 5) — eure Entscheidung.
5. **`docs/extension-bundle-import-todo.md` anpassen:** Block A erledigt, B1 und
   B2 gestrichen, B3 neu gefasst.

---

## 7. Ein Vorbehalt, den ihr kennen solltet

Im Extension-Repo gibt es **kein jsdom** im Test-Setup. Der Import-Dialog, die
Manager-Komponenten und der gesamte Übergabekanal sind durch mehrere Code-Reviews
und sorgfältiges Lesen verifiziert, aber **nicht durch automatisierte Tests**.
Getestet sind die reinen Teile: Format-Validator, Bundle-Prüfung und die
Speicher-Rechnung.

Die manuelle Abnahme in einem echten Browser steht noch aus. Wenn ihr die
Live-Übergabe baut, seid ihr damit faktisch der erste vollständige Test dieses
Kanals.

Falls sich etwas anders verhält als hier beschrieben: **meldet es, statt drumherum
zu bauen.** Die Wahrscheinlichkeit, dass der Fehler im Extension-Code liegt, ist
höher als die, dass er bei euch liegt — und ein Workaround auf eurer Seite würde
den echten Defekt verdecken.
