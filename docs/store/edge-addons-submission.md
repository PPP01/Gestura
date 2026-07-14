# Gestura → Microsoft Edge Add-ons: Einreichungs-Anleitung

Edge ist Chromium-basiert und nutzt **exakt dasselbe MV3-Paket wie Chrome** (der
`main`-Branch). Du kannst also das bereits gebaute Chrome-ZIP 1:1 hochladen. Nur
ein paar Listing-Anforderungen unterscheiden sich (v. a. das **300×300 Store-Logo**).

Was **nur du** tun kannst (Konto, Upload) ist mit 👤 markiert.

---

## Vorbereitete Assets

| Was | Wo | Status |
|---|---|---|
| Upload-Paket (ZIP) | `web-ext-artifacts/gestura-2.3-chrome.zip` | ✅ dasselbe wie Chrome (~1 MB) |
| **Store-Logo 300×300** | `assets/store/edge/store-logo-300x300.png` | ✅ neu erzeugt (Edge-Pflicht) |
| Screenshots 1280×800 PNG | `assets/store/chrome/01…05-*.png` | ✅ wiederverwendbar |
| Kurz-/Langbeschreibung (EN+DE) | `docs/store/listing-descriptions.md` | ✅ |
| Permission-Begründungen | `docs/store/permission-justifications.md` | ✅ |
| Datenschutz-URL (öffentlich) | <https://github.com/PPP01/Gestura/blob/main/PRIVACY.md> | ✅ |

> Die Chrome-Werbekacheln (440×280, 1400×560) braucht Edge **nicht** — Edge zeigt
> nur Logo + Screenshots.

---

## Voraussetzungen (einmalig) 👤

1. **Microsoft-Konto** – am besten ein eigenes für die Extension (z. B. mit
   `contact@gestura.eu`).
2. **Bei Partner Center für das Edge-Programm registrieren:**
   <https://partner.microsoft.com/dashboard/microsoftedge/> (oder über
   <https://microsoftedge.microsoft.com/addons> → „Publish an extension").
   **Die Registrierung für Edge-Extensions ist kostenlos** (anders als Chrome, kein
   5-USD-Fee).
3. **Verlag/Publisher-Profil** ausfüllen (Anzeigename, Kontakt). Der Anzeigename
   erscheint als Herausgeber im Store — für Pseudonymität denselben Namen wie im
   Chrome/AMO-Listing verwenden (z. B. `PPP01`), **nicht** den Klarnamen.

---

## Blocker vorab klären

### Öffentliche Datenschutz-URL ✅
Edge verlangt eine öffentlich erreichbare Datenschutz-URL (wegen `<all_urls>`,
`tabs`, `clipboardRead`, `downloads`). Repo ist öffentlich:

> **Datenschutz-URL:** <https://github.com/PPP01/Gestura/blob/main/PRIVACY.md>

### Sichtbarkeit
**Öffentlich** oder **verborgen/unlisted** (nur per Direktlink). Für einen
Soft-Launch ist „verborgen" eine gute Option.

---

## Upload-Paket (ZIP)

Fertig: `web-ext-artifacts/gestura-2.3-chrome.zip`. Neu bauen (falls du auf `main`
Code änderst — vorher `version` in `manifest.json` erhöhen und committen):

```bash
git archive --format=zip -o web-ext-artifacts/gestura-<version>-chrome.zip HEAD \
  manifest.json js _locales icons pages css \
  LICENSE NOTICE THIRD_PARTY_LICENSES.md
```

---

## Schritt für Schritt im Partner Center

### 1. Neue Extension anlegen 👤
Edge-Dashboard → **„New extension"** → `gestura-2.3-chrome.zip` hochladen. Edge
liest Name, Version, Icons und Beschreibung aus dem Manifest.

### 2. Properties / Listing
- **Name:** `Gestura – Mouse Gestures` (aus dem Manifest).
- **Category:** `Productivity` (alternativ „Search tools").
- **Store logo:** `assets/store/edge/store-logo-300x300.png` hochladen.
- **Kurzbeschreibung** und **Beschreibung:** aus `listing-descriptions.md`
  (EN als Standard; Deutsch als weitere Sprache ergänzen).
- **Screenshots:** die PNGs aus `assets/store/chrome/` (mind. 1, bis ~10).
- **Search terms / Keywords:** z. B. `mouse gestures, super drag, rocker gestures,
  navigation, tabs, search menu` (bis 7 Begriffe).
- **Support-/Website-URL:** `https://github.com/PPP01/Gestura`.
- **Datenschutz-URL:** die obige PRIVACY.md-URL.

### 3. Availability / Distribution
- Märkte: i. d. R. „alle Märkte". Sichtbarkeit (öffentlich / verborgen) wählen.
- Preis: kostenlos.

### 4. Notes for certification (Zertifizierungshinweise) 👤
Edge prüft Berechtigungen streng. Den Block unten einfügen (erklärt u. a. die
`offscreen`-Sandbox für die JS-Transformation — Edge könnte `new Function` sonst
beanstanden). Details zu jeder Berechtigung stehen in
`permission-justifications.md`.

```text
Gestura is a mouse-gesture navigation extension (mouse gestures with smart per-site website menus, super drag, wheel/rocker gestures, and area selection). It is an open-source fork of FlowMouse, licensed GPL-3.0. Full source: https://github.com/PPP01/Gestura

No remote code. Nothing is ever downloaded or executed from the network; all logic ships inside the package (no remote scripts, no hosted config). The optional custom-JS-transform feature runs user-authored code only, inside an isolated chrome.offscreen sandbox with no access to the page or extension context, and only after the user explicitly enables and triggers it.

No data collection. Settings are stored locally via storage / storage.sync only; page content is processed on-device and never transmitted.

Host permission for all sites (all_urls). Mouse gestures, super drag and the menus must work on every page the user visits, so the content scripts run on all sites. This access is used purely to detect gestures and drags locally; no page data ever leaves the browser.

Third-party code. The only minified file is js/lib/lit-all.min.js, the official unmodified pre-built bundle of the Lit library (lit.dev, npm package "lit", BSD-3-Clause). The One Euro Filter (BSD-3-Clause) is used for gesture smoothing. Everything else is human-readable, unminified source; there is no build/bundler/preprocessor step, so the repository is the extension.

Permissions: tabs (create, close, switch, reopen and reorder tabs, and read the active tab URL/title for copy actions); sessions (reopen closed tab/window); storage (save settings locally); contextMenus (build the menu entries); search (send a selected-text query to the user's chosen search engine); scripting (inject gesture/drag detection); favicon (show site/engine icons in menus); offscreen (run the isolated JS-transform sandbox). Optional, requested only when first used: bookmarks, clipboardRead (paste and clipboard-search actions), downloads (save image/file gestures), pageCapture (save page as MHTML).

How to test: 1) Load the extension and open any regular web page. 2) Hold the right mouse button and drag left, right, up or down to trigger a gesture (for example right then left = Back); a gesture trail/HUD appears. 3) Select some text and drag it (super drag) to open the search menu, then hover an entry. 4) Open the options page to remap gestures and manage search engines.
```

### 5. Absenden 👤
**„Publish"** / zur Zertifizierung einreichen. Die Edge-Prüfung dauert meist 1–7
Tage; breite Permissions + `<all_urls>` können sie verlängern.

---

## Unterschiede zu Chrome (Kurzüberblick)

| | Chrome Web Store | Edge Add-ons |
|---|---|---|
| Registrierung | 5 USD einmalig | **kostenlos** |
| Store-Logo | 128 px (aus Manifest) | **300×300 PNG Pflicht** |
| Werbekacheln | 440×280 / 1400×560 optional | nicht genutzt |
| Paket | dasselbe MV3-ZIP | dasselbe MV3-ZIP |
| Permission-Erklärung | „Privacy practices"-Tab | „Notes for certification" |

---

## Nach der Freigabe

- Du bekommst eine **Extension-ID**. Bei Bedarf in Support-Link-Platzhaltern
  hinterlegen.
- **Updates:** `version` in `manifest.json` erhöhen → committen → ZIP neu bauen →
  im Partner Center neues Paket hochladen → erneut einreichen. Listing-Texte,
  Logo und Screenshots bleiben erhalten (wie bei AMO — nur die Version ist neu).

---

## Checkliste

- [ ] Partner-Center-Konto fürs Edge-Programm (kostenlos) + Publisher-Profil 👤
- [ ] ZIP hochgeladen (`gestura-2.3-chrome.zip`)
- [ ] Store-Logo 300×300 hochgeladen
- [ ] Kurz- + Langbeschreibung (EN, optional DE)
- [ ] Screenshots hochgeladen
- [ ] Kategorie = Productivity, Keywords gesetzt
- [ ] Support-/Datenschutz-URL eingetragen
- [ ] „Notes for certification" eingefügt
- [ ] Märkte/Sichtbarkeit gewählt
- [ ] Publish / zur Zertifizierung einreichen 👤
