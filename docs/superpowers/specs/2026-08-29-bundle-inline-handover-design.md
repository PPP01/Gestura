# Bundle-Import & Inline-Übergabe (Live-»An Gestura senden«) – Design

> **Gegenstück:** Sub-Projekt B im Index-Repo – `docs/superpowers/specs/2026-08-29-bundle-uebergabe-sub-b-design.md`, Abschnitt 8, und das Fundament-Doc `2026-08-27-oeffentlicher-index-onepager-design.md`, Abschnitt 6. Diese Spec setzt den dort dokumentierten Extension-Vertrag um – **weicht aber bei dessen Punkten 2 und 3 bewusst ab** (siehe §2). Fürs Extension-Repo gilt dieses Dokument.
>
> **Reichweite:** nur dieses Repo. Der Index-Anteil (Sammelkorb-Button live schalten, Bundle holen, Markup ausgeben) bekommt seinen eigenen `brainstorming → spec → plan`-Zyklus im Index-Repo und baut gegen den in §5 festgeschriebenen öffentlichen Vertrag.

## 1 · Ziel

Ein Klick auf »An Gestura senden« auf einer Betreiber-Seite soll in der Extension eine **Sammel-Vorschau** öffnen, in der mehrere Menüs und Suchmaschinen auf einmal geprüft und importiert werden. Heute kennt der Import-Dialog nur die Einzelformate `gesturaMenu` / `gesturaEngine`, und der Betreiber-Button-Kanal erzwingt Same-Origin zwischen Link und Seite.

Erreicht ist das Ziel, wenn:

- der Import-Dialog ein `{ gesturaBundle: 1, entries: [...] }` erkennt, jeden Eintrag einzeln validiert und als Liste zur Auswahl stellt;
- gültige Einträge importierbar sind, ungültige einzeln gemeldet werden und die übrigen nicht blockieren;
- die `transformCode`-Warnung pro Eintrag sichtbar und einzeln zu bestätigen ist;
- eine Seite auf einem **anderen** Origin als die API übergeben kann, **ohne** dass die Extension einen fremden Host fetcht;
- fremde Cross-Origin-`rel="gestura-menu"`-Links weiterhin blockiert bleiben – kein Sicherheits-Regress.

## 2 · Die tragende Entscheidung: Inline-Übergabe statt Origin-Ausnahme

Die Sub-B-Spec stellt zwei Wege zur Wahl: den Index-Origin in der Extension als vertrauenswürdig führen, oder die Übergabe über einen Same-Origin-Pfad unter `gestura.eu` proxyen. Beide werden **verworfen**.

**Was die Same-Origin-Regel eigentlich schützt.** Sie schützt nicht die Daten – die sind auf jedem Weg unvertrauenswürdig und werden ausschließlich im Dialog validiert. Sie verhindert, dass eine beliebige Seite die Extension als **Fetch-Proxy** für fremde URLs missbraucht: der Service Worker hat `<all_urls>`, kann also Ziele erreichen, die der Seite selbst verwehrt sind – Endpunkte ohne CORS, Intranet-Adressen, die Netzwerkposition des Nutzers. Genau diese Grenze muss stehen bleiben.

**Folgerung.** Wenn die **Seite** das Bundle holt und der Extension das fertige JSON reicht, entsteht diese Angriffsfläche gar nicht erst. Die Seite darf ohnehin nur, was sie darf; die Extension fetcht nichts. Der bestehende `POST /api/v1/bundle` ist mit `Access-Control-Allow-Origin: *` von `gestura.eu` aus bereits aufrufbar – es braucht also weder eine GET-Variante noch einen Reverse-Proxy.

**Was damit entfällt:** Punkt B1 (GET-fähige Bundle-URL) und B2 (Same-Origin-Auslieferung) der Folge-TODO ersatzlos; die 100-KB-Übergabekappe und damit B3 in seiner bisherigen Begründung – an ihre Stelle tritt eine eigene, großzügigere Bundle-Kappe (§4.1).

**Was es kostet:** einen neuen, öffentlich zu dokumentierenden Markup-Vertrag (§5). Der ist anbieterneutral – jede Betreiber-Seite kann ihn nutzen –, während eine fest verdrahtete Ausnahme für `api.gestura.eu` einen Vendor-Host in eine bewusst neutrale, privacy-first Extension geschrieben hätte.

**Nicht-Ziel:** Der bestehende `href`-Pfad (`a[rel~="gestura-menu"]`, Same-Origin, 100-KB-Fetch-Kappe) wird **nicht angefasst**. Er bleibt der Weg für Seiten, die eine JSON-Datei neben sich liegen haben.

## 3 · Datenfluss

```text
gestura.eu                            content.js              background.js         options-page
──────────                            ──────────              ─────────────         ───────────
Klick auf [data-gestura-inline]  ───▶ isTrusted?
                                      → Übergabefenster auf
                                        (15 s, genau 1 Payload)
POST api.gestura.eu/api/v1/bundle
  (CORS "*", schon offen)
dispatchEvent('gestura:import',
  { detail: <JSON-String> })     ───▶ Länge ≤ bundleBlobMax?
                                      → sendMessage           ───▶ Kappe erneut prüfen
                                        {action:'importInline'}     JSON.parse
                                      → Fenster zu                 storage.session.pendingImport
                                                                   openOptionsPage
                                                                                 ───▶ #checkPendingImport
                                                                                      → Dialog, Bundle-Modus
```

Ab `pendingImport` ist der Weg identisch mit dem heutigen Betreiber-Button-Import.

## 4 · Format & Validierung

### 4.1 Schema und Konstanten wandern gemeinsam

`tests/exchange-schema.test.mjs` prüft, dass `x-gestura.types` und `x-gestura.limits` in [`js/exchange-schema.json`](../../../js/exchange-schema.json) **deep-equal** zu `FORMAT_TYPES` und `LIMITS` in [`js/menu-exchange.js`](../../../js/menu-exchange.js) sind. Beide Dateien ändern sich deshalb im selben Commit.

- `FORMAT_TYPES.bundle = 'gesturaBundle'`
- `LIMITS.bundleEntriesMax = 200` – deckungsgleich mit `BundleController::MAX_IDS` im Index-Backend.
- `LIMITS.bundleBlobMax = 1024 * 1024` – Obergrenze für das **gesamte** Bundle auf dem Übergabeweg. Bewusst großzügig: ein realer 200er-Korb liegt bei rund 400 KB. Die Per-Eintrag-Kappe bleibt `blobMax` = 100 KB und wird von `validate()` wie bisher durchgesetzt.

Neuer `$defs.bundle` im Schema, ergänzt im Top-Level-`oneOf`:

```json
"bundle": {
  "type": "object",
  "required": ["gesturaBundle", "entries"],
  "properties": {
    "gesturaBundle": { "const": 1 },
    "entries": {
      "type": "array", "minItems": 1, "maxItems": 200,
      "items": { "oneOf": [{ "$ref": "#/$defs/menu" }, { "$ref": "#/$defs/engine" }] }
    }
  }
}
```

Das Top-Level-`oneOf` bleibt eindeutig: ein Bundle hat weder `gesturaMenu` noch `gesturaEngine` und erfüllt deren `required` daher nicht.

### 4.2 `detectType` und die Falle in `validate()`

`detectType()` liefert künftig `'bundle'`, wenn `typeof obj.gesturaBundle === 'number'`.

Damit entsteht eine stille Falle: `validate()` verzweigt heute auf `type === 'menu'` bzw. `'engine'` und sammelt sonst nichts. Ein Bundle liefe künftig **ohne einen einzigen Check** durch und käme mit `errors: []` als `ok: true` heraus. `validate()` muss Bundles deshalb **explizit ablehnen**:

```js
if (type === 'bundle') errors.push('notSingleFormat');
```

Der Vertrag von `validate()` für Einzelformate bleibt im Übrigen unverändert – alle bestehenden Aufrufer und Tests laufen weiter.

### 4.3 `validateBundle(obj)`

Neu exportiert:

```js
/**
 * Prüft den Bundle-Wrapper und jeden Eintrag einzeln. Bricht nicht beim
 * ersten Fehler ab, damit die Sammel-Vorschau Teil-Ergebnisse zeigen kann.
 * @returns {{ ok: boolean, type: 'bundle', errors: string[], entries: Array }}
 *          entries[i] ist exakt ein validate()-Ergebnis {ok,type,errors,value}.
 */
function validateBundle(obj)
```

- Wrapper-Fehler in `errors`, je ein eigener Code: `notGesturaFormat` (kein Bundle), `entries` (fehlt, kein Array, oder leer), `tooManyEntries` (mehr als `bundleEntriesMax`), `tooLarge` (Gesamt-Bytes > `bundleBlobMax`).
- `ok` beschreibt **nur** den Wrapper. Ob einzelne Einträge gültig sind, steht in `entries[i].ok`.
- Jeder Eintrag geht durch das bestehende `validate()`. Damit gelten Aktions-Whitelist, `https:`-only, Größen- und Anzahllimits, SemVer und eindeutige Item-IDs unverändert – es gibt keinen zweiten Regelsatz, der auseinanderdriften könnte.
- Ist der Wrapper kaputt (`ok === false`), ist `entries` leer.

**Doppelte Ziel-IDs innerhalb eines Bundles** sind kein Fehlerfall: Einträge werden in Reihenfolge angewandt, im Modus »Standard ersetzen« gewinnt der letzte. Dokumentiert, nicht erzwungen.

## 5 · Öffentlicher Vertrag: Inline-Übergabe

Der Kanal ist Teil der öffentlichen Oberfläche der Extension und gehört nach `README.md`, neben die bestehende `rel="gestura-menu"`-Beschreibung.

### 5.1 Auslöser

```html
<button data-gestura-inline>An Gestura senden</button>
```

Ein **vertrauter** Klick (`event.isTrusted`) auf ein Element mit `data-gestura-inline` – oder auf einen Nachfahren davon – öffnet das Übergabefenster. Bewusst **kein** `rel="gestura-menu"`: `rel` beschreibt eine Link-Relation und ist auf `<a>`/`<link>`/`<area>` zu Hause; der Inline-Weg hat gar kein Linkziel. So bleibt der bestehende `<button>` im Sammelkorb des Index ein `<button>`, und die beiden Wege lassen sich nicht verwechseln.

Ein etwaiges Default-Verhalten wird unterdrückt (`preventDefault`), damit ein `<a data-gestura-inline href="…">` nicht zusätzlich navigiert.

### 5.2 Übergabe

```js
document.dispatchEvent(new CustomEvent('gestura:import', { detail: jsonString }));
```

- **`detail` ist ein String, kein Objekt.** Zwei Gründe: Objekte aus dem Seiten-Realm brauchen in Firefox `cloneInto`/Xray-Sonderbehandlung, ein String überquert die Welten-Grenze ohne Sonderfall; und die Größenprüfung greift so **vor** dem Parsen.
- Der String ist das Bundle-JSON – oder, gleichwertig unterstützt, ein Einzelformat. Der Dialog verzweigt ohnehin auf `detectType()`.
- Das Fenster bleibt **15 Sekunden** offen und nimmt **genau einen** Payload an; der erste schließt es. Es lebt im Content-Skript und stirbt mit dem Dokument – eine echte Navigation räumt es ohne Zutun ab, ein zusätzlicher Listener ist nicht nötig.
- Kommt kein Payload, passiert nichts – kein Dialog, keine Meldung. Die Seite ist für ihre eigene Fehleranzeige zuständig.

### 5.3 Sicherheitsargument

Der Kanal gibt der Seite **keine** neuen Rechte. Eine Seite konnte der Extension schon bisher beliebiges JSON reichen, indem sie es same-origin ablegt und darauf verlinkt; die Inline-Form spart nur den Umweg. Erhalten bleiben:

- die **Nutzergesten-Garantie** – ein Import-Dialog kann nur nach einem echten Klick erscheinen, nie unaufgefordert;
- die **Validierung im vertrauenswürdigen Kontext** – der Dialog rendert nie ungeprüftes JSON, sondern immer nur den normalisierten `value`;
- die **Skript-Bestätigung** für `transformCode`.

Neu ist ausschließlich, dass die Extension auf diesem Weg **gar nicht mehr fetcht** – die Fetch-Proxy-Fläche schrumpft, sie wächst nicht.

## 6 · Umsetzung in den Dateien

### 6.1 `js/content.js` – Operator-Button-Block (Zeilen 56–86)

Der Block bekommt einen zweiten Zweig. Der bestehende `a[rel~="gestura-menu"]`-Pfad inklusive `url.origin !== location.origin` bleibt **Zeile für Zeile unverändert**.

- Im selben `click`-Listener (Capture, `isTrusted`-gegated): `e.target.closest('[data-gestura-inline]')` → `preventDefault`, Fenster öffnen.
- Fenster = ein modul-lokaler Zustand plus ein einmaliger `document`-Listener auf `gestura:import` und ein 15-s-`setTimeout`. Öffnen räumt ein etwaig offenes Fenster vorher ab – es gibt immer nur eines.
- Payload-Behandlung: `typeof detail === 'string'` prüfen, Byte-Länge gegen `bundleBlobMax`, dann `chrome.runtime.sendMessage({ action: 'importInline', json: detail })`. Danach Fenster schließen. `sendMessage` wie bisher in `try/catch` (invalidierter Extension-Kontext).
- **Kein** `JSON.parse` hier – der String wandert roh weiter, geparst wird im vertrauenswürdigen Kontext.

Die Konstante `bundleBlobMax` liegt in `menu-exchange.js`, das im Content-Kontext nicht geladen ist. Sie wird in `content.js` als lokale Konstante gespiegelt, mit Kommentar auf die Quelle – dasselbe Muster wie `IMPORT_FROM_SITE_MAX_BYTES` in `background.js`, das `LIMITS.blobMax` spiegelt.

### 6.2 `js/background.js` – `handleAction`

- Neuer `case 'importInline'`.
- Der gemeinsame Schwanz von `importFromSite` – `storage.session.set({ pendingImport })` plus `openOptionsPage('')` – wird als `stashPendingImport(json, url)` herausgezogen und von beiden genutzt.
- `importInline(request, sender)`: Byte-Kappe **erneut** prüfen (Defense in Depth – eine Nachricht kann auch aus einem anderen Kontext kommen), `JSON.parse` in `try/catch`, `url` ist `sender.url || sender.tab?.url`, also die **Seiten**-URL. Für die Herkunftsanzeige im Dialog (`{ type: 'site', url }`) ist das genauer als bisher die JSON-URL.
- Keine neue Top-Level-Abhängigkeit → `importScripts` in `background.js` und `background.scripts` im Gecko-Manifest bleiben unberührt; der Merge nach `firefox-build` ist trivial.

### 6.3 `js/components/menu-import-dialog.js`

**Vorbereitender Refactor** (macht den Bundle-Modus erst günstig, ändert das Verhalten des Einzelmodus nicht):

- `#renderMenu` / `#renderEngine` werden je in einen **Body** (Items bzw. Engine-Zeile, Favicon, Skript-Warnung) und einen **Footer** (Modus-Wahl, Abbrechen/Importieren) geteilt. Der Bundle-Modus rendert nur die Bodies.
- Die Schreiblogik aus `#confirm()` wandert in zwei reine Helfer, die ein Settings-Objekt hineinbekommen und das nächste zurückgeben:
  `#applyMenu(curSiteMenus, result, source, lang, mode, matchId)` und `#applyEngine(curEngines, result, source, lang, mode, matchId)`.

**Bundle-Modus:**

- `openWith(raw, source)` verzweigt auf `X().detectType(raw)`. Bei `'bundle'` → `validateBundle`, Zustand `_bundle = { errors, rows: [...] }`, sonst der heutige Pfad.
- Eine `row` je Eintrag: `{ result, catalogMatch, selected, mode, scriptAck, expanded }`. Vorbelegung: `selected = result.ok`, `mode = catalogMatch ? 'replace' : 'new'` – identisch zum Einzelfall.
- Zeilendarstellung: Checkbox · Favicon bzw. Monogramm · Name · Typ · Badges. Ungültige Zeilen zeigen `exchangeBundleInvalid` samt Fehlerliste über `exchangeInvalidDetail`, sind sichtbar, aber **nicht wählbar**. Engines mit `transformCode` zeigen ein Warn-Badge.
- Aufklappen zeigt den Body plus die Modus-Wahl; bei `transformCode` zusätzlich Code und die bestehende Bestätigungs-Checkbox, jetzt zeilenweise.
- »Alle auswählen« schaltet alle **gültigen** Zeilen.
- Der Import-Button ist deaktiviert, wenn nichts gewählt ist, oder solange eine **gewählte** Skript-Zeile unbestätigt ist; im zweiten Fall erscheint `exchangeBundleScriptPending` als Hinweis.
- Ein Bundle ohne einen einzigen gültigen Eintrag zeigt `exchangeBundleEmpty` und nur »Abbrechen«.

**Bestätigen:** über alle gewählten Zeilen iterieren, `siteMenus` und `searchEngines` in je einem Objekt akkumulieren, dann **ein einziges** `settingsStore.save({ siteMenus, searchEngines })`. Nicht n Speichervorgänge – das wären n Sync-Schreibzugriffe samt Konfliktpotenzial. Die Firefox-Sonderbehandlung (`transformEnabled` und `transformCode` leeren, wenn nicht `transformRequired`) läuft pro Eintrag wie heute. `import-done` trägt `{ count, types }`.

### 6.4 `js/components/options-page.js`

Unverändert. `#checkPendingImport` reicht `pending.json` weiter; die Verzweigung passiert im Dialog.

## 7 · i18n

Wiederverwendet: `exchangePreviewTitle`, `exchangeCancel`, `exchangeConfirmImport`, `exchangeInvalidDetail`, `exchangeImportAs`, `exchangeReplaceStandard`, `exchangeAddAsNew`, `exchangeScriptWarnTitle`, `exchangeScriptWarnBody`, `exchangeScriptChromeOnly`, `exchangeScriptChromeOnlyRequired`, `exchangeScriptConfirm`.

Neu – **in allen 39 Locales** und in der `EXCHANGE_KEYS`-Liste von `tests/menu-exchange-locales.test.mjs`:

| Key | Zweck (en) |
| --- | --- |
| `exchangeBundleSummary` | `{count} entries · {valid} selectable` |
| `exchangeBundleInvalid` | `Invalid` (Badge an der Zeile) |
| `exchangeBundleSelectAll` | `Select all` |
| `exchangeBundleImport` | `Import {count}` |
| `exchangeBundleScriptPending` | Hinweis, warum der Import-Button gesperrt ist |
| `exchangeBundleEmpty` | `This bundle contains no importable entries.` |

Platzhalter durchweg `{token}` mit `.replace()`. **Niemals** ein undeklariertes `$WORD$` – das blockiert den Extension-Load; `tests/locale-placeholders.test.mjs` bewacht es.

Wo eine Locale dasselbe Wort für einen anderen Key bereits übersetzt, wird dieser Wert übernommen statt einen neuen zu erfinden.

## 8 · Tests

**Neu – `tests/menu-exchange-bundle.test.mjs`:**

- `detectType` erkennt ein Bundle.
- `validate()` weist ein Bundle mit `notSingleFormat` ab (die Falle aus §4.2).
- Gemischtes Bundle: gültige Einträge kommen mit `ok: true` samt `value`, der ungültige mit seinen Feldfehlern – und blockiert die anderen nicht.
- Wrapper-Fehler: `entries` fehlt / kein Array / leer / mehr als `bundleEntriesMax`.
- `tooLarge` bei Überschreiten von `bundleBlobMax`.
- Ein Eintrag über `blobMax` scheitert einzeln, das Bundle bleibt verwertbar.

**Erweitert:** `tests/exchange-schema.test.mjs` (die Drift-Prüfung deckt die neuen Typen und Limits automatisch ab – sie schlägt fehl, wenn nur eine der beiden Dateien angefasst wurde), `tests/menu-exchange-locales.test.mjs` (neue Keys).

**Manuell**, weil im Setup kein jsdom für Lit-Komponenten und Content-Skripte existiert:

1. Ein 3er-Bundle mit einem absichtlich kaputten Eintrag einspielen → drei Zeilen, eine nicht wählbar, Import legt zwei Einträge an.
2. Ein Bundle mit einer `transformCode`-Engine → Warn-Badge, Import gesperrt bis zur Bestätigung.
3. **Regression:** ein fremder Cross-Origin-`<a rel="gestura-menu">` bleibt blockiert; ein Same-Origin-`<a rel="gestura-menu">` funktioniert unverändert.
4. Ein `data-gestura-inline`-Klick ohne folgendes Event → nach 15 s passiert nichts; ein `gestura:import` **ohne** vorherigen Klick → wird ignoriert.

## 9 · Zerlegung für die Plan-Phase

1. **Schema + Konstanten** – `exchange-schema.json` und `menu-exchange.js` (`FORMAT_TYPES`, `LIMITS`, `$defs.bundle`), ein Commit, `exchange-schema.test.mjs` grün.
2. **Validator** – `detectType`, die `notSingleFormat`-Ablehnung in `validate()`, `validateBundle`, neue Testdatei.
3. **Dialog-Refactor** – Body/Footer-Trennung und `#applyMenu`/`#applyEngine`, ohne Verhaltensänderung.
4. **Dialog-Bundle-Modus** – Zustand, Zeilen, Aufklappen, Sammel-Bestätigung.
5. **i18n** – sechs Keys in 39 Locales, `EXCHANGE_KEYS` erweitern.
6. **Inline-Kanal** – `content.js`-Zweig und `background.js`-Case samt `stashPendingImport`-Extraktion.
7. **Doku** – `README.md` (öffentlicher Vertrag), `CHANGELOG.md`.

Reihenfolge: 1 → 2 → 3 → 4, dazu 5 und 6 unabhängig; 7 zum Schluss. Arbeit auf `main`; der Merge nach `firefox-build` ist ein reiner Merge ohne Manifest-Berührung.

## 10 · Offene Merker für den Index-Zyklus

- `js/exchange-schema.json` nach `gestura-index/schema/exchange-schema.json` **neu kopieren**, sobald der Wrapper hier steht (Kopie-Regel: im Index-Repo nie direkt editieren).
- Sammelkorb-Größenkappe gegen `bundleBlobMax` = 1 MB statt der bisherigen 100 KB.
- `BasketTray.svelte`: Button live schalten, `data-gestura-inline` setzen, nach dem `getBundle()` das `gestura:import`-Event feuern, `basket_send_soon` durch echten Aktionstext ersetzen.
- B1 (GET-Endpunkt) und B2 (Same-Origin-Proxy) entfallen ersatzlos.

## 11 · Festgezurrte Entscheidungen

- **Cross-Origin:** Inline-Übergabe; keine Origin-Ausnahme, kein Proxy, kein Vendor-Host im Extension-Code. ✔
- **Auslöser:** `data-gestura-inline` plus vertrauter Klick; `rel="gestura-menu"` bleibt dem URL-Pfad vorbehalten. ✔
- **Payload:** `CustomEvent('gestura:import')` mit **String**-`detail`, 15-s-Fenster, genau ein Payload. ✔
- **Kappen:** 1 MB je Bundle, 100 KB je Eintrag, 200 Einträge. ✔
- **Vorschau:** ein Dialog, eine Zeile je Eintrag, aufklappbar, Sammel-Bestätigung mit **einem** Speichervorgang. ✔
- **Ungültige Einträge:** sichtbar, nicht wählbar, blockieren die übrigen nicht. ✔
- **Bestehender `href`-Pfad:** unverändert. ✔
