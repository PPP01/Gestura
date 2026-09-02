# Gestura → Firefox Add-ons (AMO): Einreichungs-Anleitung

Schritt-für-Schritt zur Veröffentlichung von Gestura auf
[addons.mozilla.org](https://addons.mozilla.org) (AMO). Analog zum
[Chrome-Guide](chrome-web-store-submission.md); Texte/Screenshots werden geteilt.
Was **nur du** tun kannst (Konto, API-Keys, Einreichung) ist mit 👤 markiert.

> **Wichtig:** Der Firefox-Build lebt auf dem Branch **`firefox-build`** (eigenes
> Manifest mit `background.scripts`, `gecko.id`, `ff:*`-Skripte). Alles hier bezieht
> sich auf diesen Branch: `git checkout firefox-build`.

---

## Vorbereitete Assets (geteilt mit Chrome/Edge)

| Was | Wo | Status |
|---|---|---|
| Kurz-/Langbeschreibung (EN+DE) | `docs/store/listing-descriptions.md` (Abschnitt gilt auch für AMO) | ✅ |
| Permission-Begründungen | `docs/store/permission-justifications.md` | ✅ |
| Screenshots | `assets/store/chrome/01…05-*.png` (1280×800, für AMO ebenso nutzbar) | ✅ |
| Werbekacheln | `assets/store/chrome/promo-*.png` | ✅ (AMO nutzt sie nicht zwingend) |
| Datenschutz-URL | <https://github.com/PPP01/Gestura/blob/main/PRIVACY.md> | ✅ öffentlich |
| Icon 128 px | `icons/icon128.png` | ✅ (im Manifest) |
| Build/Signier-Mechanik | [`docs/firefox-build-guide.md`](../firefox-build-guide.md) (auf `firefox-build`) | ✅ |

## Firefox-Spezifika (bereits im `firefox-build`-Manifest)

- `browser_specific_settings.gecko.id` = **`gestura@gestura.eu`**
- `strict_min_version` = **140.0**
- `data_collection_permissions` = **`{ required: ["none"], optional: ["technicalAndInteraction"] }`**
  seit der optionalen, per Default ausgeschalteten *Website-Integration*: `required`
  bleibt `["none"]` (ohne Zutun der Nutzerin verlässt nichts den Browser), aber wer
  den Schalter selbst einschaltet, teilt Seiten auf gestura.eu (und einer optionalen
  Entwickler-Origin) die eigene Erweiterungsversion sowie, auf Anfrage, den
  Installiert-/Versions-/Verändert-Status von dort importierter Einträge mit — das
  fällt unter Mozillas Kategorie „technicalAndInteraction" (Geräte-/Browser-Infos,
  Nutzungs- und Einstellungsdaten), nie unter eine der personenbezogenen Kategorien.
  **Der aktuelle `firefox-build`-Manifest-Stand (`required: ["none"]` ohne
  `optional`) ist noch der vor-R1-Stand** — dieser Branch hat R1 noch nicht gemerged;
  beim nächsten Merge von `main`/dieser Funktion nach `firefox-build` diesen Schlüssel
  mitziehen, sonst weicht die AMO-Angabe von PRIVACY.md ab.
- `background.scripts` (Event-Page statt Service-Worker), inkl. `favicon-util.js`

---

## Voraussetzungen (einmalig) 👤

1. **Mozilla-Add-on-Konto** anlegen (kostenlos, **keine Gebühr** — anders als Chrome):
   <https://addons.mozilla.org/developers/> → mit Firefox-Konto anmelden.
2. **API-Zugangsdaten** für automatisiertes Signieren/Hochladen erzeugen:
   Developer Hub → **Manage API Keys** → JWT **issuer** + **secret** notieren.
   Diese nutzen die `ff:sign` / `ff:release`-Skripte.

---

## Blocker vorab

- **Datenschutz-URL:** steht (siehe oben) — im AMO-Listing eintragen.
- **Lizenz:** AMO fragt die Lizenz ab → **GPL-3.0** wählen (passt zu `LICENSE`).
- **Quellcode-Einreichung:** AMO verlangt Quellcode, wenn eingereichter Code nicht
  direkt reviewbar ist. Gestura ist **plain JS ohne Build-Step**; einzige Ausnahme
  ist die eingebundene, minifizierte Bibliothek **`js/lib/lit-all.min.js`** (Lit).
  Falls ein Reviewer nachfragt: Herkunft/Version von Lit angeben bzw. das
  öffentliche Repo `PPP01/Gestura` verlinken. Ein separater Build-Upload ist nicht
  nötig (kein Bundler/Minifier im Projekt).

---

## Zwei Einreichungswege

### Weg A — Signieren + Einreichen per CLI (empfohlen) 👤

Auf `firefox-build`, im Projektordner:

```bash
git checkout firefox-build
npm run ff:release
```

- `ff:release` **fragt selbständig** nach dem API-Key (Format `user:XXX`) und
  dem Secret (wird nicht angezeigt) und reicht beides über die Umgebung an
  `web-ext` weiter. Die Credentials gehören **nie** ins Kommando — als
  `--api-key=…` landen sie in der Shell-History. Alternativ vorab
  `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` setzen, dann fragt es nicht.
- `ff:release` = `ff:bump` (Versionsnummer hochzählen) + `ff:sign`
  (`web-ext sign --channel=listed`). Hast du die Version schon selbst gesetzt
  (etwa beim Merge von `main` übernommen), hängst du `-- --no-bump` an.
- `channel=listed` reicht die signierte, **gelistete** XPI direkt bei AMO ein.
- Danach im Developer Hub das **Listing** vervollständigen (siehe unten).

Nur bauen ohne Einreichen (zum lokalen Prüfen):
```bash
npm run ff:build   # schreibt web-ext-artifacts/*.zip
npx web-ext lint --source-dir . --config web-ext-config.mjs   # muss 0 Fehler zeigen
```

### Weg B — Upload über die AMO-Weboberfläche 👤

1. `npm run ff:build` → `web-ext-artifacts/gestura-<version>.zip`.
2. Developer Hub → **Submit a New Add-on** → **On this site** (gelistet) →
   ZIP hochladen. AMO signiert automatisch nach dem Review.

---

## Listing ausfüllen (Developer Hub)

- **Name:** `Gestura – Mouse Gestures`
- **Summary/Kurzbeschreibung + ausführliche Beschreibung:** aus
  `listing-descriptions.md` (EN als Standard, DE als weitere Sprache).
- **Kategorien:** *Tabs* und/oder *Privacy & Security* / *Other* (AMO-Kategorien
  weichen von Chrome ab; „Productivity"-Äquivalent wählen).
- **Screenshots:** die PNGs aus `assets/store/chrome/` hochladen (mind. 1).
- **Icon:** wird aus dem Paket gezogen (128 px).
- **Support:** `contact@gestura.eu` · <https://github.com/PPP01/Gestura/issues>
- **Datenschutz-URL:** die PRIVACY-URL oben.
- **Lizenz:** GPL-3.0.
- **Datennutzung:** nicht mehr pauschal „Keine Datenerhebung" — seit R1 gilt das
  nur noch, solange *Website-Integration* ausgeschaltet bleibt (Werkseinstellung).
  Ist sie eingeschaltet, teilt die Extension gestura.eu (und einer optionalen
  Entwickler-Origin) ihre Version sowie den Installiert-/Versions-/
  Verändert-Status importierter Einträge mit — anonym, ohne Konto, kein
  Personenbezug. Deckt sich mit `data_collection_permissions: { required: ["none"],
  optional: ["technicalAndInteraction"] }` (siehe oben) und `PRIVACY.md`, Abschnitt
  „Website integration". Der noch nicht gebaute Update-Check und die verschlüsselte
  Sync sind hiervon nicht betroffen — sie existieren in R1 nicht.
- **Permission-Begründungen:** aus `permission-justifications.md`, falls der Review
  nach `<all_urls>` / `tabs` / `clipboardRead` etc. fragt.

---

## Nach der Einreichung

- **Review:** läuft in der Praxis automatisiert durch. `ff:release` wartet sie ab
  (`Waiting for validation...` → `Waiting for approval...`); sobald die signierte
  `.xpi` in `web-ext-artifacts/` liegt, ist die Version **öffentlich** und das
  Auto-Update greift — so lief es bei 2.6.1. AMO kann eine bereits
  veröffentlichte Version danach noch manuell nachprüfen, bei breiten
  Permissions wie `<all_urls>` eher; Rückmeldung dann per E-Mail ans
  Entwicklerkonto.
- **Updates:** `firefox-build` aktualisieren → `npm run ff:release`. Die Nummer
  muss höher sein als die letzte auf AMO; darum bumpt das Skript vorab. Willst
  du die Version von `main` unverändert ausliefern, `-- --no-bump` anhängen.
- **Auto-Update:** übernimmt AMO. Kein Self-Hosting — es gibt weder `update_url`
  noch `updates.json` (siehe `a8eb50a`).

---

## Bekannte Firefox-Einschränkungen (fürs Listing/FAQ)

Die Kern-Features (Gesten, Super-Drag, Rad-/Rocker-Gesten, Suchmenüs, **Favicons**)
laufen in Firefox. Firefox fehlen einzelne APIs, daher entfallen dort:
- **JS-Transform-Sandbox** (`offscreen`) — die Per-Link-JavaScript-Transformationen.
- **Seite als MHTML speichern** (`pageCapture`).

(Engine-Favicons funktionieren in Firefox — sie werden von Gestura selbst aufgelöst,
nicht über die Chrome-`favicon`-API.)

---

## Checkliste

- [ ] Mozilla-Add-on-Konto + API-Keys 👤
- [ ] `git checkout firefox-build`
- [ ] `npx web-ext lint` = 0 Fehler
- [ ] `npm run ff:release` (signiert + gelistet eingereicht) 👤
- [ ] Listing: Beschreibung (EN/DE), Screenshots, Kategorien
- [ ] Lizenz GPL-3.0, Datenschutz-URL, Datennutzung gemäß Website-Integration-Absatz
      oben (nicht mehr pauschal „keine Datenerhebung")
- [ ] Support-Kontakt gesetzt
- [ ] Auf Review-Rückmeldung reagieren (Permission-Begründungen bereit)
