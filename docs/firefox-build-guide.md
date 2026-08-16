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
| `npm run ff:bump` | Erhöht die `manifest.json`-Version (`2.6` → `2.6.1`, dann `2.6.2`, …). Nur für **Firefox-only-Nachbesserungen** — bei einem regulären Release trägst du stattdessen von Hand die Nummer von `main` ein (siehe Szenario B). |
| `npm run ff:sign` | Reicht die Version bei **AMO** ein (Kanal `listed`), wartet die Prüfung ab und lädt die signierte `.xpi` herunter. Danach ist die Version **live**. |
| `npm run ff:release` | `ff:bump` dann `ff:sign`. ⚠️ Der Bump ist nicht abschaltbar — bei einem regulären Release **nicht** benutzen, sonst geht eine vierstellige Nummer raus (`2.6` → `2.6.1`). Siehe Szenario B. |

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
npm run ff:sign -- --api-key=DEIN_KEY --api-secret=DEIN_SECRET
```

`ff:sign` reicht die Version über `web-ext sign --channel=listed` bei AMO ein und
bleibt stehen, bis die Prüfung durch ist:

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

**Versionsnummer:** Ziel ist dieselbe Nummer wie Chrome/Edge. Beim Merge
kollidiert `manifest.json` immer — dort die Firefox-Form behalten (kein
`version_name`, kein `favicon`/`offscreen`/`pageCapture`, `background.scripts`
statt `service_worker`, `browser_specific_settings`) und die Version von `main`
übernehmen. Dann mit **`ff:sign`** signieren, nicht mit `ff:release`.

> Beim 2.6-Release ist genau das schiefgegangen: `ff:release` lief, der
> eingebaute `ff:bump` machte `2.6` → `2.6.1`, und diese Nummer ging bei AMO
> raus. Firefox steht deshalb auf **2.6.1**, Chrome/Edge auf **2.6** — derselbe
> Code. Ein Versatz in der letzten Stelle ist verschmerzbar (2.3/2.3.1 und
> 2.5/2.5.1 waren genauso), aber vermeidbar: `ff:release` nur nehmen, wenn du
> eine Firefox-only-Nachbesserung nachschieben willst und AMO die bereits
> eingereichte Nummer ohnehin ablehnen würde.

Nach dem Signieren den Bump **committen** — sonst weicht die bei AMO
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

`firefox-build` wird **gemergt**, nicht rebased — der Branch ist bei AMO
veröffentlicht, seine Historie muss stabil bleiben (siehe `../FORK-NOTES.md`
für den vollständigen Remote-/Branch-Workflow):

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
