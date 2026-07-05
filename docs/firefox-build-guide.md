# FlowMouse-Fork — Firefox-Build- & Release-Anleitung

Wie du die Firefox-Variante dieses Forks baust, signierst, installierst und
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
| `npm run ff:sign` | Lädt zu Mozilla hoch und holt eine **signierte** `.xpi` (Kanal `unlisted`). |
| `npm run ff:release` | `ff:bump` dann `ff:sign` — der Ein-Befehl-Release. |

## Szenario A — nur entwickeln / ausprobieren

```bash
git checkout firefox-build
npm run ff:run
```

Kein Signieren, kein Neustart-Problem. Startet eine eigene Firefox-Instanz und
lädt die Erweiterung neu, sobald du eine Datei speicherst.

## Szenario B — neue installierbare Version (manuell einspielen)

```bash
git checkout firefox-build
git rebase feature/search-engine-suite       # nur falls du am Feature etwas geändert hast
npm run ff:release -- --api-key=DEIN_KEY --api-secret=DEIN_SECRET
```

Das bumpt die Version, signiert und legt die signierte `.xpi` in
`web-ext-artifacts/` ab. Einmal installieren über **about:addons → Zahnrad →
„Add-on aus Datei installieren"**.

> AMO verweigert das erneute Signieren einer bereits signierten Version —
> darum bumpt `ff:release` zuerst. Version `2.2` ist schon signiert, die nächste
> wird also `2.2.1`.

Reguläres Firefox installiert nur **signierte** Erweiterungen. Developer
Edition / Nightly / ESR können eine unsignierte `.xpi` installieren, nachdem
`xpinstall.signatures.required = false` in `about:config` gesetzt wurde.

## Szenario C — Auto-Update (die signierte `.xpi` nur ein einziges Mal installieren)

`manifest.json` verweist bereits mit
`browser_specific_settings.gecko.update_url` auf `updates.json` in diesem Branch
(eine raw-GitHub-URL). Pro Release:

1. `npm run ff:release -- --api-key=… --api-secret=…`
2. Auf deinem Fork ein GitHub-Release anlegen (z. B. Tag `ff-2.2.1`) und die
   signierte `.xpi` als Asset hochladen.
3. In `updates.json` einen Eintrag ergänzen — `version` = neue
   Manifest-Version, `update_link` = die exakte Asset-URL — und den Branch
   pushen:
   ```bash
   git commit -am "release ff-2.2.1"
   git push origin firefox-build
   ```

Firefox pollt `updates.json`, sieht die höhere Version und aktualisiert sich
selbst — kein manuelles Neuinstallieren mehr.

Voraussetzungen, damit das Auto-Update auflöst:

- `firefox-build` muss zu `origin` gepusht sein (damit die raw-`update_url`
  funktioniert).
- Die Extension-ID in `updates.json` muss zum Manifest passen
  (`flowmouse-fork@local`).
- `update_link` muss HTTPS sein und auf die **signierte** `.xpi` zeigen.

Bis du das erste Release + den `updates.json`-Eintrag angelegt hast, findet
Firefox einfach keine neuere Version — es geht nichts kaputt.

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
