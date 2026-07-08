# Gestura (Firefox) — Build- & Release-Anleitung

Wie du die Firefox-Variante von Gestura (einem FlowMouse-Fork) baust, signierst, installierst und
automatisch aktualisierst. Alles hier läuft auf dem Branch **`firefox-build`**.

- `firefox-build` = `feature/search-engine-suite` (die Feature-Arbeit) + einige
  Firefox-spezifische Commits (Firefox-Manifest, `menu-patterns.js` per
  `background.scripts` geladen, Chrome-only-Manifest-Einträge entfernt).
- `web-ext lint` → 0 Fehler, lädt warnungsfrei.
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
| `npm run ff:bump` | Erhöht die `manifest.json`-Version (`2.2` → `2.2.1`, dann `2.2.2`, …). |
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
git rebase feature/search-engine-suite       # nur falls du am Feature etwas geändert hast
npm run ff:release -- --api-key=DEIN_KEY --api-secret=DEIN_SECRET
```

Das bumpt die Version und reicht sie über `web-ext sign --channel=listed` bei AMO
ein. Nach bestandener AMO-Review erscheint die Version im Store; installierte
Instanzen **aktualisieren sich automatisch über AMO**.

> AMO verweigert eine bereits vorhandene Versionsnummer — darum bumpt
> `ff:release` zuerst. Version `2.2` existiert schon, die nächste wird `2.2.1`.

Hinweise:

- Die **erste** Einreichung legt den AMO-Listing-Eintrag an. Dort Beschreibung,
  Screenshots und die Datenschutz-URL ergänzen (Vorlagen in `docs/store/`).
- Endnutzer installieren Gestura aus dem Firefox Add-ons Store; Auto-Update
  übernimmt AMO.
- Zum **lokalen Testen** einer unsignierten Version: `npm run ff:build` und in
  Firefox Developer Edition / Nightly / ESR mit
  `xpinstall.signatures.required = false` in `about:config` laden.

## Mit Upstream Schritt halten

Wenn sich das Upstream-FlowMouse ändert, spiele diesen Branch neu auf den
aktualisierten Feature-Branch (siehe `../FORK-NOTES.md` für den vollständigen
Remote-/Branch-Workflow):

```bash
git fetch upstream
git checkout firefox-build
git rebase feature/search-engine-suite
```

Da `firefox-build` nur eine Handvoll Commits über dem Feature-Branch liegt, ist
dieses Rebase klein.
