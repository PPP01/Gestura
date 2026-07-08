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
- `data_collection_permissions.required` = **`["none"]`** (keine Datenerhebung — Firefox-Pflichtangabe erfüllt)
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
npm run ff:release -- --api-key=<JWT-issuer> --api-secret=<JWT-secret>
```

- `ff:release` = `ff:bump` (Versionsnummer hochzählen) + `ff:sign`
  (`web-ext sign --channel=listed`).
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
- **Datennutzung:** „Keine Datenerhebung" (deckt sich mit
  `data_collection_permissions: none` und `PRIVACY.md`).
- **Permission-Begründungen:** aus `permission-justifications.md`, falls der Review
  nach `<all_urls>` / `tabs` / `clipboardRead` etc. fragt.

---

## Nach der Einreichung

- **Review:** AMO prüft automatisiert, teils manuell (bei breiten Permissions wie
  `<all_urls>` wahrscheinlicher). Rückmeldung per E-Mail ans Entwicklerkonto.
- **Updates:** `firefox-build` aktualisieren → `npm run ff:release …` (bumpt Version,
  signiert, reicht ein). Version muss höher sein als die letzte auf AMO.
- **Auto-Update (self-hosted, optional):** `update_url` + `updates.json` sind im
  `firefox-build` vorbereitet — Details in [`docs/firefox-build-guide.md`](../firefox-build-guide.md).

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
- [ ] Lizenz GPL-3.0, Datenschutz-URL, „keine Datenerhebung"
- [ ] Support-Kontakt gesetzt
- [ ] Auf Review-Rückmeldung reagieren (Permission-Begründungen bereit)
