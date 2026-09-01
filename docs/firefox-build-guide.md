# Gestura (Firefox) — Build- & Release-Anleitung

Wie du die Firefox-Variante von Gestura (einem FlowMouse-Fork) baust, signierst, installierst und
automatisch aktualisierst. Alles hier läuft auf dem Branch **`firefox-build`**.

- `firefox-build` = `main` (die Feature-Arbeit) + einige Firefox-spezifische
  Commits (Firefox-Manifest, `menu-patterns.js` & Co. per `background.scripts`
  geladen, Chrome-only-Manifest-Einträge entfernt).
- `web-ext lint` → **0 Fehler**. Warnungen bleiben: die unten genannten
  fehlenden APIs plus `innerHTML`-Hinweise aus Lit — die sind erwartet.
- **Funktioniert in Firefox:** Suchmaschinen-Verwaltung, kontextabhängige Menüs,
  Drag-Suche, Clipboard-Modus — die Kern-Gesten/Menü-Funktionen.
- **Funktioniert in Firefox NICHT** (APIs fehlen, systembedingt): der
  JS-Transform-Sandbox (`offscreen`), Engine-Favicons (`favicon`),
  Als-MHTML-speichern (`pageCapture`). Diese degradieren sauber; der Rest
  bleibt unberührt.

## Einmaliges Setup

```bash
git checkout firefox-build
npm install
```

Zum Signieren brauchst du einen kostenlosen Mozilla-Add-on-Account. Auf
`addons.mozilla.org` → **Developer Hub → Manage API Keys** einen API-Key +
Secret erzeugen. Niemals committen — entweder pro Befehl übergeben oder als
Umgebungsvariablen `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` setzen.

## npm-Skripte

| Skript | Was es tut |
|---|---|
| `npm run ff:run` | Startet Firefox mit der Erweiterung, lädt bei jeder Änderung neu. Nur zum Entwickeln — kein Signieren, kein Versions-Bump. |
| `npm run ff:build` | Baut ein **unsigniertes** `.zip` nach `web-ext-artifacts/` (nur Laufzeit-Dateien). |
| `npm run ff:bump` | Erhöht die `manifest.json`-Version (`2.7.0` → `2.7.1`). Nur der Notnagel hinter `ff:release -- --bump`; direkt brauchst du es nicht. |
| `npm run ff:sign` | Reicht die Version bei **AMO** ein (Kanal `listed`), wartet die Prüfung ab und lädt die signierte `.xpi` herunter. Fragt **nicht** nach Credentials — nimm `ff:release`. |
| `npm run ff:release` | **Der Release-Befehl.** Credential-Abfrage, `ff:sign`, danach hängt es die signierte Datei als `gestura-<version>-firefox.xpi` an das GitHub-Release `v<version>`. Bumpt **nicht** — die Nummer kommt über den Merge aus `main`. |

## Szenario A — nur entwickeln / ausprobieren

```bash
git checkout firefox-build
npm run ff:run
```

Kein Signieren, kein Neustart-Problem. Startet eine eigene Firefox-Instanz und
lädt die Erweiterung neu, sobald du eine Datei speicherst.

## Szenario B — neue Version bei AMO veröffentlichen

Gestura wird als **AMO-gelistetes** Add-on verteilt (Firefox Add-ons Store). AMO
signiert, verteilt und aktualisiert automatisch — kein Self-Hosting, kein
`update_url`, kein `updates.json`.

Eine Version, ein Tag, ein Release: das Release `v<version>` gibt es bereits — es
entsteht, sobald der Tag von `main` gepusht wird (siehe `../CLAUDE.md`). Firefox
hängt hier nur noch sein Paket an.

```bash
git checkout -f firefox-build
git merge main                               # den Feature-Stand von main holen
# Konflikte: meist nur package.json; wenn manifest.json, Firefox-Form behalten!
npm test                                     # muss durchlaufen
npm run ff:build                             # unsigniertes zip zur Kontrolle
npx web-ext lint --source-dir . --config web-ext-config.mjs   # muss 0 Fehler zeigen
git push gestura firefox-build
npm run ff:release                           # signiert und hängt die xpi ans Release
```

**Nimm immer `ff:release`, nie `ff:sign` direkt.** Nur `ff:release` fragt Key und
Secret interaktiv ab (das Secret wird nicht angezeigt) und reicht beide über die
Umgebung an `web-ext` weiter. `ff:sign` allein zwingt dich zu
`--api-key=… --api-secret=…` auf der Kommandozeile — und damit in die
Shell-History. Wer die Abfrage überspringen will, setzt vorab
`WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET`.

Das `--` vor Argumenten ist **Pflicht**: ohne es schluckt npm sie.

`ff:release` reicht die Version über `web-ext sign --channel=listed` bei AMO ein
und bleibt stehen, bis die Prüfung durch ist:

```text
Waiting for validation...
Waiting for approval...
Signed xpi downloaded: web-ext-artifacts/gestura_mouse_gestures-<version>.xpi
ff:release: signed package -> web-ext-artifacts/gestura-<version>-firefox.xpi
ff:release: done — gestura-<version>-firefox.xpi is attached to release v<version>.
```

**Geht nach dem Signieren etwas schief, `ff:release` NICHT erneut starten.** Der
teure Teil ist dann durch, AMO hat die Nummer verbraucht — ein zweiter Lauf
verbrennt die nächste. Das Skript sagt das selbst und gibt den
`gh release upload …`-Befehl aus, mit dem du den Rest von Hand nachziehst.

Vor dem Signieren prüft `ff:release`, ob es `gh` gibt und ob das Release
`v<version>` schon existiert, und bricht sonst ab, bevor irgendetwas passiert —
ein vergessener Tag kostet also keine Nummer. Die Abfrage nach Key und Secret
kommt erst danach.

Sobald die signierte `.xpi` da ist, ist die Version **öffentlich** — kein
weiterer Schritt im Developer Hub nötig, installierte Instanzen ziehen sie per
Auto-Update. (Bei 2.6.1 lief das automatisiert durch; AMO kann eine
veröffentlichte Version später trotzdem noch manuell nachprüfen, gerade wegen
`<all_urls>`.)

**Versionsnummer — eine Nummer für alle Browser.** Firefox trägt exakt die
Version, die über den Merge aus `main` kommt. `ff:release` bumpt deshalb nicht:
eine eigene Nummer hätte kein Release, an das sie sich hängen könnte.
Kollidiert `manifest.json` beim Merge, dort die Firefox-Form behalten (kein
`version_name`, kein `favicon`/`offscreen`/`pageCapture`, `background.scripts`
statt `service_worker`, `browser_specific_settings`) und die Version von `main`
übernehmen. Nach dem Signieren ist nichts zu committen — der Versionsstand
steht schon so in git.

Das hat einen Preis: **eine misslungene AMO-Einreichung verbrennt die Nummer
für alle.** AMO signiert jede Nummer genau einmal und lehnt eine bereits
eingereichte ab — der nächste Anlauf muss dann als neue Version auf *jedem*
Browser raus, Chrome eingeschlossen. Also nie bei AMO einreichen, was nicht
release-reif ist.

`npm run ff:release -- --bump` bleibt als Notnagel: es nimmt die nächste Nummer
(`2.7.0` → `2.7.1`) statt der aus `main`. Für die gibt es dann kein Release,
das xpi muss von Hand an eines gehängt werden. Der saubere Weg ist eine neue
Version auf `main`.

Die Reihe 2.3.1 / 2.5.1 / 2.6.1 stammt aus der Zeit eigener `ff-v*`-Tags und
eigener Firefox-Releases: die dritte Stelle war der Firefox-Build-Zähler zum
Feature-Stand von `main`. Diese Tags und Releases bleiben als Historie stehen,
neue kommen nicht dazu.

Hinweise:

- Die **erste** Einreichung legt den AMO-Listing-Eintrag an. Dort Beschreibung,
  Screenshots und die Datenschutz-URL ergänzen (Vorlagen in `docs/store/`).
- Endnutzer installieren Gestura aus dem Firefox Add-ons Store; Auto-Update
  übernimmt AMO.
- Zum **lokalen Testen** einer unsignierten Version: `npm run ff:build` und in
  Firefox Developer Edition / Nightly / ESR mit
  `xpinstall.signatures.required = false` in `about:config` laden.

## Mit `main` Schritt halten

`firefox-build` wird **gemergt**, nicht rebased. Zwei Gründe (die ausführliche
Fassung samt Remote-/Branch-Workflow steht in `../FORK-NOTES.md`):

- **Konflikte bleiben klein.** Ein Merge löst gegen die vorige Merge-Basis auf,
  du entscheidest also pro Release nur, was sich seither geändert hat — nicht
  jedes Mal die gesamte Firefox-Form des Manifests neu. Ein Rebase spielt jeden
  Firefox-Commit auf eine Basis ab, die er nie gesehen hat, und focht denselben
  `manifest.json`-Konflikt jedes Mal neu aus.
- **Ausgelieferte Commits behalten ihren Hash.** Jeder `release(ff): x.y.z` ist
  die exakte Quelle einer bei AMO signierten Version. Nach einem Rebase hätte er
  einen neuen Hash, und „welcher Commit war 2.6.1?" wäre nicht mehr zu
  beantworten.

AMO selbst ist die Git-Historie egal — es geht um die Nachvollziehbarkeit hier
im Repo.

```bash
git checkout firefox-build
git merge main
```

Konflikte gibt es zuverlässig in `manifest.json` (Version + die
Firefox-Anpassungen) und je nach Release in `CHANGELOG.md`. Alles andere mergt
sauber, weil die Firefox-Patches auf wenige Dateien beschränkt sind.

Nach jedem Merge zwei Dinge prüfen:

- Hat `main` ein neues Top-Level-Skript hinzugefügt, das `js/background.js` per
  `importScripts` lädt? Firefox kennt kein `importScripts` im
  Hintergrundskript, jede solche Datei muss zusätzlich in `background.scripts`
  im Manifest stehen. Die beiden Listen müssen sich decken.
- Sind neue Dateien dazugekommen, die nicht ins Paket gehören? `web-ext build`
  packt den **Arbeitsbaum**, nicht den Git-Baum — auch git-ignorierte Ordner
  wie `exchange/` landen im xpi, solange sie nicht in `ignoreFiles` in
  `web-ext-config.mjs` stehen. Der Blick in `unzip -l web-ext-artifacts/*.zip`
  nach `npm run ff:build` kostet nichts.
