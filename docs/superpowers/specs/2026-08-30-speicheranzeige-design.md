# Speicheranzeige – Design

> **Erstes von zwei Vorhaben.** Das zweite (`storage.local` als Lesemodell, Browser-Sync als optionale Replikation) folgt direkt danach und ist in §8 so weit umrissen, wie es dieses hier betrifft. Diese Spec baut **keinen** Teil davon.

## 1 · Ziel und Anlass

Die Extension legt ihre Einstellungen in `chrome.storage.sync` ab. Dort gilt ein Deckel von **8192 Bytes je Item**, und jeder Top-Level-Zweig ist genau ein Item. `siteMenus` ist einer davon. Ein importiertes Menü mit zehn Einträgen wiegt rund 1750 B — es passen also nur drei bis vier, bevor nichts mehr geht.

Bis heute erfährt der Nutzer davon **nichts**, bis ein Speichervorgang scheitert. Diese Anzeige macht die Grenze sichtbar, bevor er hineinläuft.

Erreicht ist das Ziel, wenn:

- der Nutzer an der Stelle, an der er Menüs oder Suchmaschinen anlegt, sieht, wie voll der zugehörige Zweig ist;
- die Sammel-Vorschau vor dem Import sagt, ob die Auswahl überhaupt hineinpasst;
- ein zentraler Abschnitt die genauen Zahlen für alle wachsenden Zweige führt;
- die Anzeige nicht stört, solange reichlich Platz ist.

**Nicht-Ziel:** mehr Platz schaffen. Das ist Vorhaben zwei.

## 2 · Prozent statt Bytes — und wo die Ausnahme gilt

Bytes sind für die meisten Nutzer keine brauchbare Größe. Überall, wo die Anzeige *nebenbei* auftaucht, steht deshalb nur ein **Prozentwert** und, wo sinnvoll, eine **Restanzahl** („noch etwa 6 Menüs"). Die genauen Byte-Werte stehen ausschließlich im zentralen Speicher-Abschnitt (§5.3), wo jemand gezielt nachschaut oder ein Problem meldet.

Prozent **wovon**: vom Deckel des jeweiligen Zweigs, also von 8192 B. Nicht von der Gesamtquote (102400 B) — die ist bei frischer Installation zu 3 % gefüllt und wird praktisch nie erreicht. Wer 20 % der Gesamtquote belegt und trotzdem nichts mehr speichern kann, hätte von einem Gesamtbalken nur eine falsche Beruhigung.

## 3 · Woher die Zahlen kommen

**Selbst gerechnet, nicht per API.** `chrome.storage.sync.getBytesInUse()` existiert zwar, war in Firefox für `sync` aber lange nicht implementiert, und der Aufruf ist asynchron. Stattdessen:

```
bytes(key, value) = utf8Length(key) + utf8Length(JSON.stringify(value))
```

Das ist exakt die Buchführung, die Chrome dokumentiert. Alle nötigen Daten liegen ohnehin im Speicher (`settingsStore.current`), die Rechnung ist synchron, braucht keine Berechtigung und verhält sich in beiden Browsern gleich.

Der Deckel wird als `chrome.storage.sync.QUOTA_BYTES_PER_ITEM` gelesen, mit `8192` als Rückfallwert.

**Neues Modul** `js/storage-usage.js`, reine Funktionen, keine `chrome.*`-Aufrufe außer dem Deckel-Lesen, keine DOM-Nutzung — nach dem Vorbild von `js/menu-exchange.js`, damit es im vorhandenen Node-Environment testbar ist:

```js
usageOf(key, value, quota)                        → { bytes, quota, percent }
remainingEntries(freeBytes, existingValues, fallbackAvg) → number
```

`existingValues` ist die Liste der bereits gespeicherten Einträge dieses Zweigs (die Objekte selbst, nicht ihre Größen) — die Funktion misst sie und bildet den Durchschnitt.

`usageOf` bekommt den Deckel übergeben, statt ihn selbst zu lesen — so bleibt es rein. Das Lesen von `QUOTA_BYTES_PER_ITEM` passiert einmal im Aufrufer.

## 4 · Welche Zweige gezeigt werden

Nur die, die durch Nutzung wachsen. Die übrigen 60-plus Schlüssel sind konstant klein und wären Rauschen.

| Zweig | wächst durch | frisch |
| --- | --- | --- |
| `siteMenus` | Importe, bearbeitete Menüs, eigene Menüs | 108 B |
| `searchEngines` | eigene Engines, Transform-Skripte | klein |
| `mouseGestures` | eigene Gesten, Aktionsketten | 567 B |

Der zentrale Abschnitt (§5.3) zeigt zusätzlich die **Gesamtbelegung** gegen 102400 B — dort ist die Zahl richtig eingeordnet und nicht irreführend.

## 5 · Die drei Orte

### 5.1 Menü-Manager und Engine-Manager

Eine Zeile unter der Liste, im Manager des jeweiligen Zweigs:

> Belegt: 22 % · noch etwa 6 Menüs

Sie ist **unauffällig** (`--text-muted`, kleine Schrift), solange die Belegung unter 75 % liegt. Ab 75 % wird sie hervorgehoben, ab 100 % als Fehler dargestellt und nennt die Konsequenz — dass Speichern jetzt scheitert.

Die Schwelle bei 75 % ist bewusst früh: bei drei bis vier Menüs Gesamtkapazität ist der Sprung von „reichlich" zu „voll" ein einziger Import.

### 5.2 Import-Dialog

Der Ort mit dem höchsten Nutzen, weil hier die Entscheidung fällt.

In der **Sammel-Vorschau**, in der Kopfzeile neben der Zusammenfassung, live mitlaufend beim An- und Abwählen:

> Nach dem Import belegt: 64 %

Der Wert ist **nicht** der Anteil der Auswahl am freien Platz, sondern die Belegung des Zweigs, die nach dem Import bestünde — dieselbe Zahl, die der Manager danach anzeigt. So bedeutet sie an beiden Orten dasselbe.

Überschreitet die Auswahl den freien Platz, tritt an die Stelle eine Meldung, und der Import-Button wird gesperrt — ein weiterer Fall neben den bestehenden `'empty'` und `'script'` in `#blockedFor()`. Das ist der Punkt, an dem die Anzeige zur Funktion wird: statt eines gescheiterten Speicherversuchs mit generischer Meldung erfährt der Nutzer **vorher**, dass er die Auswahl kleiner machen muss.

Im **Einzel-Import** genügt der Sperrfall; eine laufende Prozentzahl für einen einzelnen Eintrag wäre Lärm.

Berechnet wird gegen den Zustand, der beim Bestätigen entstünde — also gegen genau das `patch`-Objekt, das `#commitPatch()` schreiben würde. Damit kann die Anzeige nicht von dem abweichen, was tatsächlich passiert.

### 5.3 Zentraler Abschnitt in den Einstellungen

Ein eigener Abschnitt „Speicher" mit einer Zeile je wachsendem Zweig und einer Summenzeile. **Nur hier** stehen Bytes:

> Website-Menüs 1830 von 8192 Bytes (22 %)
> Suchmaschinen 96 von 8192 Bytes (1 %)
> Mausgesten 567 von 8192 Bytes (7 %)
> Gesamt 2688 von 102400 Bytes (3 %)

Zweck: nachschlagen und Probleme melden. Deshalb hier die genauen Zahlen, und deshalb ist dieser Abschnitt der einzige, der auch bei niedriger Belegung vollständig sichtbar ist.

## 6 · Die Restanzahl

„Noch etwa 6 Menüs" ist die verständlichste Form der Information und zugleich die, die am leichtesten falsch verstanden wird. Deshalb:

- Das Wort **„etwa"** steht immer dabei. Es ist eine Schätzung, keine Zusage.
- Geschätzt wird mit dem **Durchschnitt der Einträge, die der Nutzer bereits in diesem Zweig hat** — die sagen am besten voraus, was er als Nächstes hinzufügt.
- Hat der Zweig noch keine Einträge, greift ein gemessener Rückfallwert aus dem Katalog: **1001 B** je Menü, **797 B** je Engine.

Warum der Durchschnitt und nicht der Median: bei Engines liegt der Median bei 113 B, der Durchschnitt bei 797 B — die Verteilung ist stark schief, weil einzelne Engines mit vielen Locale-Varianten bis 7439 B wiegen. Der Median verspräche „noch 56 Engines", während eine einzige große schon 90 % des Platzes nähme. Der Durchschnitt ist hier der ehrlichere Schätzer.

Bei null freien Bytes entfällt die Restanzahl; dann steht die Voll-Meldung.

## 7 · i18n

Neue Keys mit dem Prefix `storage` — der ist im Katalog noch frei (geprüft über alle 773 Keys). Sie müssen wie üblich in **alle 39 Locales**, und `storage` wird in `NEW_KEY_PREFIXES` in `tests/site-menu-locales.test.mjs` aufgenommen, damit der vorhandene Guard sie erzwingt.

| Key | Zweck (en) |
| --- | --- |
| `storageSectionTitle` | Überschrift des zentralen Abschnitts |
| `storageUsed` | `{percent}% used` — die knappe Form für die Manager |
| `storageRemaining` | `about {count} more` — Restanzahl |
| `storageDetail` | `{used} of {total} bytes ({percent}%)` — nur zentral |
| `storageFull` | Voll-Zustand samt Konsequenz |
| `storageImportTooLarge` | Auswahl passt nicht mehr, Import gesperrt |

Sechs Keys × 39 Locales. Platzhalter durchweg `{token}` mit `.replace()`, **niemals** ein undeklariertes `$WORD$` — das verhindert den Extension-Load, `tests/locale-placeholders.test.mjs` bewacht es.

## 8 · Was das zweite Vorhaben daran ändert

Wenn die schweren Zweige nach `storage.local` umziehen und Browser-Sync zur optionalen Replikation wird, ändert sich **die Bedeutung**, nicht die Rechnung: Der Deckel von 8192 B bleibt, er begrenzt dann aber nicht mehr, was gespeichert werden kann, sondern was noch **synchronisiert** wird. Aus „belegt 22 %" wird „22 % des synchronisierbaren Anteils".

Konkret erbt Vorhaben zwei aus dieser Spec:

- `js/storage-usage.js` unverändert — dieselbe Formel, derselbe Deckel.
- Die drei Orte bleiben, nur die Texte werden umformuliert.
- Der Sperrfall im Import-Dialog **entfällt**: lokal passt die Auswahl, sie synchronisiert nur nicht mehr. Aus einer Sperre wird ein Hinweis.

Damit die Nacharbeit klein bleibt, trägt schon diese Spec die Trennung in der Struktur: die Rechnung (`storage-usage.js`) weiß nichts von Speicherorten, und die Texte liegen in i18n-Keys, nicht im Code.

**Die Anzeige darf den `gestura.eu`-Sync nicht erwähnen, solange es ihn nicht gibt.**

## 9 · Tests

**Automatisiert — `tests/storage-usage.test.mjs`:**

- `usageOf` rechnet Schlüssel und Wert zusammen und liefert den Prozentwert.
- UTF-8 wird nach Bytes gezählt, nicht nach Zeichen (ein Menüname mit Umlauten wiegt mehr als seine Länge).
- `percent` rundet nicht auf 100 %, solange noch ein Byte frei ist — sonst meldet die Anzeige „voll", wo es das nicht ist.
- Über dem Deckel liefert `percent` einen Wert über 100, statt zu deckeln — der Aufrufer entscheidet über die Darstellung.
- `remainingEntries` teilt den freien Platz durch den Durchschnitt der übergebenen Einträge.
- Ohne Einträge greift der Rückfallwert.
- Bei null oder negativem freien Platz kommt 0.

**Erweitert:** `tests/site-menu-locales.test.mjs` (Prefix `storage`), `tests/locale-placeholders.test.mjs` deckt die neuen Strings automatisch ab.

**Manuell**, weil für Lit-Komponenten kein jsdom im Setup ist:

1. Menü-Manager mit wenig Belegung → unauffällige Zeile mit Prozent und Restanzahl.
2. So viele Menüs importieren, bis über 75 % → Zeile tritt hervor.
3. Sammel-Vorschau mit einer Auswahl, die nicht mehr passt → Meldung statt Prozentzahl, Import-Button gesperrt.
4. Zentraler Abschnitt → Bytes und Prozent für alle drei Zweige plus Summe, Zahlen stimmen mit denen der Manager überein.
5. Deutsch und eine RTL-Sprache gegenprüfen, damit die Platzhalter sitzen.

## 10 · Zerlegung für die Plan-Phase

1. `js/storage-usage.js` mit Tests (rein, test-first).
2. i18n: sechs Keys in 39 Locales, Prefix im Guard.
3. Zentraler Abschnitt in den Einstellungen — der einzige Ort mit Bytes.
4. Zeile in Menü-Manager und Engine-Manager, samt Schwellen.
5. Import-Dialog: laufende Prozentzahl und der neue Sperrfall in `#blockedFor()`.

Reihenfolge 1 → 2 → (3, 4, 5 unabhängig).

## 11 · Festgezurrte Entscheidungen

- **Prozent überall, Bytes nur im zentralen Abschnitt.** ✔
- **Prozent bezieht sich auf den Zweig-Deckel (8192 B), nicht auf die Gesamtquote.** ✔
- **Selbst gerechnet**, kein `getBytesInUse`. ✔
- **Restanzahl mit „etwa"**, geschätzt über den Durchschnitt der vorhandenen Einträge, Rückfall auf gemessene Katalogwerte. ✔
- **Unauffällig bis 75 %**, danach hervorgehoben, ab 100 % Fehler. ✔
- **Drei Orte:** Manager, Import-Dialog, zentraler Abschnitt. ✔
- **Kein Wort über `gestura.eu`-Sync**, solange er nicht existiert. ✔
- **Mehr Platz zu schaffen ist ausdrücklich nicht Teil dieser Spec.** ✔
