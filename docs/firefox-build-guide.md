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
| `npm run ff:bump` | Erhöht die `manifest.json`-Version (`2.6` → `2.6.1`, dann `2.6.2`, …). Ruft `ff:release` selbst auf; direkt brauchst du es selten. |
| `npm run ff:sign` | Reicht die Version bei **AMO** ein (Kanal `listed`), wartet die Prüfung ab und lädt die signierte `.xpi` herunter. Fragt **nicht** nach Credentials — nimm `ff:release`. |
| `npm run ff:release` | **Der Release-Befehl.** `ff:bump` dann `ff:sign`, und dazwischen die interaktive Credential-Abfrage. Mit `-- --no-bump` bleibt die Version im Manifest stehen. |

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

```bash
git checkout firefox-build
git merge main                               # den Feature-Stand von main holen
# Konflikte: manifest.json (Firefox-Form behalten!), ggf. CHANGELOG.md
npm run ff:build                             # unsigniertes zip zur Kontrolle
npx web-ext lint --source-dir . --config web-ext-config.mjs   # muss 0 Fehler zeigen
npm run ff:release -- --no-bump              # Version aus main behalten
```

**Nimm immer `ff:release`, nie `ff:sign` direkt.** Nur `ff:release` fragt Key und
Secret interaktiv ab (das Secret wird nicht angezeigt) und reicht beide über die
Umgebung an `web-ext` weiter. `ff:sign` allein zwingt dich zu
`--api-key=… --api-secret=…` auf der Kommandozeile — und damit in die
Shell-History. Wer die Abfrage überspringen will, setzt vorab
`WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET`.

Das `--` vor `--no-bump` ist **Pflicht**: ohne es schluckt npm das Argument und
das Skript bumpt trotzdem.

`ff:release` reicht die Version über `web-ext sign --channel=listed` bei AMO ein
und bleibt stehen, bis die Prüfung durch ist:

```text
Waiting for validation...
Waiting for approval...
Signed xpi downloaded: web-ext-artifacts/gestura_mouse_gestures-<version>.xpi
```

Sobald die signierte `.xpi` da ist, ist die Version **öffentlich** — kein
weiterer Schritt im Developer Hub nötig, installierte Instanzen ziehen sie per
Auto-Update. (Bei 2.6.1 lief das automatisiert durch; AMO kann eine
veröffentlichte Version später trotzdem noch manuell nachprüfen, gerade wegen
`<all_urls>`.)

**Versionsnummer.** Beim Merge kollidiert `manifest.json` immer — dort die
Firefox-Form behalten (kein `version_name`, kein
`favicon`/`offscreen`/`pageCapture`, `background.scripts` statt
`service_worker`, `browser_specific_settings`) und die Version von `main`
übernehmen.

Danach hast du die Wahl:

| Ziel | Befehl | Ergebnis bei `main` = 2.7 |
|---|---|---|
| Firefox trägt dieselbe Nummer wie Chrome/Edge | `npm run ff:release -- --no-bump` | 2.7 |
| Firefox zählt seine eigene Build-Reihe weiter | `npm run ff:release` | 2.7.1 |

Beides ist vertretbar. Die dritte Stelle ist der **Firefox-Build-Zähler zum
Feature-Stand von `main`**: „2.6.1" heißt lesbar *erster Firefox-Build der
2.6-Funktionen*, ein zweiter Anlauf wegen eines Firefox-Fehlers wäre 2.6.2,
ohne dass `main` sich bewegt. So kam die Reihe 2.3.1 / 2.5.1 / 2.6.1 zustande.

Warum überhaupt gebumpt wird: AMO signiert jede Nummer nur einmal und lehnt eine
bereits eingereichte ab. Das Skript kann nicht wissen, ob die Nummer im Manifest
schon draußen war, also erhöht es vorsorglich. Dass dabei `2.6` → `2.6.1` wird
und nicht `2.6.0`, liegt daran, dass Firefox fehlende Stellen als 0 liest — `2.6`
**ist** `2.6.0`, eine 2.6.0 wäre also gar keine Erhöhung.

Nach dem Signieren den Versionsstand **committen** — sonst weicht die bei AMO
veröffentlichte Version von der in git ab.

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

Prüfe nach jedem Merge, ob `main` ein neues Top-Level-Skript hinzugefügt hat,
das `js/background.js` per `importScripts` lädt — Firefox kennt kein
`importScripts` im Hintergrundskript, jede solche Datei muss zusätzlich in
`background.scripts` im Manifest stehen. Die beiden Listen müssen sich decken.
