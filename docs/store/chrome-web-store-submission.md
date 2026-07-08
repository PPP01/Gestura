# Gestura → Chrome Web Store: Einreichungs-Anleitung

Schritt-für-Schritt-Anleitung zur Veröffentlichung von Gestura im Chrome Web Store.
Alle Texte, Screenshots und das Upload-Paket sind bereits vorbereitet (siehe
[Vorbereitete Assets](#vorbereitete-assets)). Was **nur du** tun kannst (Konto,
Domain/Privacy-URL, der eigentliche Upload) ist unten klar markiert 👤.

---

## Vorbereitete Assets

| Was | Wo | Status |
|---|---|---|
| Upload-Paket (ZIP) | `web-ext-artifacts/gestura-2.2-chrome.zip` | ✅ fertig (994 KB, nur Runtime) |
| Store-Icon 128 px | `icons/icon128.png` | ✅ (steckt auch im Manifest) |
| Screenshots 1280×800 PNG | `assets/store/chrome/01…05-*.png` | ✅ 5 Stück |
| Kurz-/Langbeschreibung (EN+DE) | `docs/store/listing-descriptions.md` | ✅ |
| Permission-Begründungen | `docs/store/permission-justifications.md` | ✅ |
| Datenschutz-URL (öffentlich) | <https://github.com/PPP01/Gestura/blob/main/PRIVACY.md> | ✅ Repo ist öffentlich, URL erreichbar |

Screenshots (Reihenfolge = Empfehlung fürs Listing):

1. `01-overview.png` – Einstellungsübersicht (Appearance + Gesten)
2. `02-gesture-to-menu.png` – Geste `→↓→` öffnet das kontextbezogene „Coding"-Menü
3. `03-search-engines.png` – konfigurierbare Text-/Bild-Suchmaschinen
4. `04-per-site-menus.png` – Menüs pro Website mit Site-Pattern
5. `05-js-transform.png` – JS-Transformation pro Link (Sandbox)

> Chrome zeigt Screenshots **ohne Bildunterschrift** an. Wenn du Text im Bild
> willst, müsste er später ins PNG eingebrannt werden — für den Start nicht nötig.

---

## Voraussetzungen (einmalig) 👤

1. **Google-Konto** – am besten ein eigenes für die Extension (z. B. mit
   `contact@gestura.eu` als Kontakt). 2-Faktor-Authentifizierung ist Pflicht.
2. **Als Entwickler registrieren:** <https://chrome.google.com/webstore/devconsole>
   → einmalige Registrierungsgebühr **5 USD** zahlen.
3. **Identität/Kontakt verifizieren:** Im Dashboard unter *Account* eine
   verifizierte Kontakt-E-Mail hinterlegen (Google schickt einen Bestätigungslink).
   Ohne verifizierte E-Mail lässt sich nichts veröffentlichen.

> Die Konto-Verifizierung kann 1–2 Tage dauern — am besten zuerst erledigen.

---

## Blocker vorab klären

### Öffentliche Datenschutz-URL ✅ (erledigt)

Chrome verlangt eine **öffentlich erreichbare** URL zur Datenschutzerklärung
(wegen `host_permissions: <all_urls>`, `tabs`, `clipboardRead`, `downloads`).
Das Repo `PPP01/Gestura` ist jetzt **öffentlich**, damit ist die URL erreichbar:

> **Datenschutz-URL:** <https://github.com/PPP01/Gestura/blob/main/PRIVACY.md>

Diese URL im *Privacy*-Tab eintragen. (Optional später schöner: GitHub Pages oder
eine eigene Seite unter `gestura.eu` — nicht erforderlich für die Einreichung.)

### Sichtbarkeit / Regionen

Entscheide: **Öffentlich** (jeder findet es) oder **Nicht gelistet** (nur per Link).
Für einen ersten Soft-Launch ist *Nicht gelistet* eine gute Option. Regionen:
i. d. R. „alle Länder".

---

## Upload-Paket (ZIP)

Das fertige Paket liegt unter `web-ext-artifacts/gestura-2.2-chrome.zip`.

**Neu bauen** (falls du Code änderst — vorher `version` in `manifest.json` erhöhen
und committen, das ZIP zieht aus dem committeten Stand):

```bash
git archive --format=zip -o web-ext-artifacts/gestura-<version>-chrome.zip HEAD \
  manifest.json js _locales icons pages css \
  LICENSE NOTICE THIRD_PARTY_LICENSES.md
```

Das ZIP enthält bewusst **keine** `docs/`, `tests/`, `assets/`, `README`, o. Ä. —
nur die Laufzeit-Dateien.

---

## Schritt für Schritt im Developer Dashboard

### 1. Neues Item anlegen 👤
Dashboard → **„Add new item"** → `web-ext-artifacts/gestura-2.2-chrome.zip`
hochladen. Chrome liest Name, Version, Icons und Beschreibung aus dem Manifest.

### 2. Store listing (Tab „Store listing")
- **Name:** `Gestura – Mouse Gestures` (kommt aus dem Manifest via `__MSG_extName__`)
- **Summary / Kurzbeschreibung (≤ 132 Zeichen):** aus `listing-descriptions.md`
  übernehmen (EN als Standard; DE als weitere Sprache, siehe unten).
- **Detailed description:** ausführlichen Text aus `listing-descriptions.md`
  einfügen (inkl. FlowMouse-Attribution + Dank — GPL-Pflicht).
- **Category:** `Productivity` (Tools).
- **Language:** primär `English`; Deutsch als zusätzliche Sprache anlegen
  (Store listing kann mehrsprachig gepflegt werden — DE-Texte liegen vor).
- **Icon:** 128 px wird automatisch aus dem Paket gezogen.
- **Screenshots:** die 5 PNGs aus `assets/store/chrome/` in obiger Reihenfolge
  hochladen (mind. 1 ist Pflicht; bis zu 5 sinnvoll).
- **Optional:** Promo-Tile 440×280 (kann später ergänzt werden).

### 3. Privacy practices (Tab „Privacy")
Alles aus `permission-justifications.md` übernehmen:
- **Single purpose:** den „Single purpose"-Absatz einfügen.
- **Permission justification:** für **jede** Berechtigung (`tabs`, `sessions`,
  `storage`, `contextMenus`, `search`, `scripting`, `favicon`, `offscreen`) den
  jeweiligen Satz aus der Tabelle einfügen; ebenso die `<all_urls>`-Begründung.
- **Datennutzung:** alle drei/vier Fragen mit **Nein** beantworten
  (keine Datenerhebung, kein Verkauf, keine zweckfremde Nutzung).
- **Privacy policy URL:** die oben gewählte öffentliche URL eintragen.

### 4. Distribution (Tab „Distribution")
- Sichtbarkeit (öffentlich / nicht gelistet), Regionen wählen.
- Preis: kostenlos.

### 5. Absenden 👤
**„Submit for review"**. Prüfzeit meist wenige Stunden bis einige Tage.
Bei `<all_urls>` + breiten Permissions kann eine manuelle Prüfung länger dauern —
die Permission-Begründungen sind genau dafür vorbereitet.

---

## Nach der Freigabe

- Du bekommst eine **Item-ID** (z. B. `abcdef…`). Trage sie bei Bedarf in den
  Support-Link-Platzhalter `GESTURA_CWS_ID` in den `_locales` ein.
- **Updates:** `version` in `manifest.json` erhöhen → committen → ZIP neu bauen →
  im Dashboard „Package" → neues ZIP hochladen → erneut zur Prüfung einreichen.

---

## Checkliste

- [ ] Google-Entwicklerkonto registriert (5 USD) + Kontakt verifiziert 👤
- [ ] Öffentliche Datenschutz-URL steht 👤
- [ ] ZIP hochgeladen (`gestura-2.2-chrome.zip`)
- [ ] Kurz- + Langbeschreibung (EN, optional DE) eingefügt
- [ ] 5 Screenshots hochgeladen
- [ ] Kategorie = Productivity, Sprache(n) gesetzt
- [ ] Single purpose + alle Permission-Begründungen eingetragen
- [ ] Datennutzung = keine Erhebung
- [ ] Sichtbarkeit/Regionen gewählt
- [ ] Submit for review 👤
