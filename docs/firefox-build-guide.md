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
| `npm run ff:sign` | Reicht die Version bei **AMO** ein (Kanal `listed`) und durchläuft die AMO-Review. |
| `npm run ff:release` | `ff:bump` dann `ff:sign` — der Ein-Befehl-Release. |

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

`ff:sign` reicht die Version über `web-ext sign --channel=listed` bei AMO ein.
Nach bestandener AMO-Review erscheint sie im Store; installierte Instanzen
**aktualisieren sich automatisch über AMO**.

**Versionsnummer:** Seit 2.6 trägt der Firefox-Build dieselbe Nummer wie
Chrome/Edge. Beim Merge kollidiert `manifest.json` immer — dort die
Firefox-Form behalten (kein `version_name`, kein `favicon`/`offscreen`/
`pageCapture`, `background.scripts` statt `service_worker`,
`browser_specific_settings`) und die Version von `main` übernehmen. `ff:bump`
bzw. `ff:release` sind dafür **nicht** zu gebrauchen — die hängen eine
vierte Stelle an (`2.6` → `2.6.1`) und sind nur für Firefox-only-Nachbesserungen
gedacht, wenn AMO eine bereits eingereichte Nummer ablehnt.

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
