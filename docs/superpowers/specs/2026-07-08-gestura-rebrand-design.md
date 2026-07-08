# Gestura – Rebranding von FlowMouse zu eigenständiger Erweiterung

**Datum:** 2026-07-08
**Status:** Entwurf (zur Review)
**Basis:** Fork von FlowMouse (`Hmily-LCG/FlowMouse`), Branch `feature/search-engine-suite`

## Kontext & Ausgangslage

Der Upstream-Autor hat den Search-Engine/Menu-PR abgelehnt (er will FlowMouse
schlank und rein gestenfokussiert halten). Das Feature lebt daher im persönlichen
Fork. Ziel: den Fork als **eigenständige Erweiterung „Gestura"** in Chrome Web
Store, Edge Add-ons und Firefox AMO zu veröffentlichen.

### Rechtliche Grundlage (entscheidend)

FlowMouse steht unter der **GNU GPL v3** (`LICENSE`). Das erlaubt Fork,
Umbenennung und eigene Veröffentlichung ausdrücklich — die PR-Ablehnung ändert
daran nichts. Pflichten der GPL v3, die Gestura einhalten muss:

- Gestura bleibt **ebenfalls GPL v3** (keine proprietäre/geschlossene Variante).
- **Quellcode offenlegen** (öffentliches GitHub-Repo `PPP01/Gestura`).
- **Änderungen kennzeichnen** (Modifikationsvermerk mit Datum, §5a GPL).
- **Copyright-/Autoren-Hinweise erhalten** (`Hmily[LCG] & Coxxs`).

### Attribution als Gestaltungsprinzip (nicht nur Pflicht)

Ausdrücklicher Wunsch: Der FlowMouse-Ursprung soll **nicht verschwiegen, sondern
prominent hervorgehoben** werden. Gestura versteht sich als Fork, der nur wegen
erweiterter Features existiert, die es nicht in FlowMouse geschafft haben. Das
README **beginnt** mit diesem Hinweis und einem **Dank an die Original-Autoren**
für die großartige Erweiterung. Attribution geht hier also über die reine
GPL-Konformität hinaus und ist ein bewusstes Kern-Element der Kommunikation.

## Getroffene Entscheidungen

| Frage | Entscheidung |
|---|---|
| Verteilung | Chrome Web Store **und** Edge Add-ons **und** Firefox AMO |
| Upstream-Sync | **Mergebar bleiben** — künftige FlowMouse-Updates weiter übernehmbar |
| Icon/Logo | Eigene Icons geliefert (16/32/48/128 px PNG + Quelle) |
| Anzeigename | `Gestura – Mouse Gestures` (Kurzname: `Gestura`) |
| Repo | `github.com/PPP01/Gestura` |
| Kontakt | `contact@gestura.eu` (ersetzt `Service@52pojie.cn`) |
| Firefox `gecko.id` | `gestura@gestura.eu` |

## Gewählter Ansatz: Eigener Branding-Commit auf der Spitze

Das bestehende Fork-Modell (Feature = 1 squashed Commit auf `upstream/main`)
bleibt unverändert. Das gesamte Rebranding landet in **genau einem zusätzlichen
Commit `brand: Gestura`** oben auf `feature/search-engine-suite`. Beim
`git rebase upstream/main` spielt dieser Commit einfach mit ab.

**Leitprinzip:** Nur **nutzersichtbares** Branding ändern. **Interne Bezeichner**
(`window.FlowMouseUtils`, `GestureConstants`, `window.GestureOverlay`,
`window.GestureRecognizer` usw.) bleiben **unangetastet** — sie sind unsichtbar
für Endnutzer, und ihr Umbenennen erzeugt nur Rebase-Konflikte ohne Nutzen.

Verworfene Alternativen:
- **Branding-Config + Generator-Skript** — widerspricht dem „no build step"-Prinzip
  (`CLAUDE.md`), für einen Namen Overkill.
- **Sauberer Bruch / neues eigenständiges Repo** — verliert die Mergebarkeit
  (vom Nutzer abgelehnt).

## Umfang der Änderungen

### A. Nutzersichtbares Branding (wird geändert)

1. **`_locales/*/messages.json`** (~40 Locales):
   - `extName` → `Gestura – Mouse Gestures` (bzw. lokalisierter Zusatz; Markenname
     „Gestura" bleibt konstant, nur die Beschreibung „Mouse Gestures" darf pro
     Sprache übersetzt werden).
   - `extNameShort` → `Gestura`.
   - `extDescription` → darf lokalisiert bleiben; Inhalt inhaltlich unverändert,
     nur der Markenbezug angepasst falls vorhanden.
   - **Feedback-/Support-Meldung** (Message-Keys ~67 und ~71 in jeder Locale):
     ersetzt `mailto:Service@52pojie.cn` → `mailto:contact@gestura.eu`,
     Upstream-GitHub → `https://github.com/PPP01/Gestura/issues`, und den Verweis
     auf das chinesische Forum (`52pojie.cn`) entfernen.
2. **`manifest.json`**: `author` → eigener Name; Original-Autoren im „based on"-Hinweis
   (README/about) belassen.
3. **`js/components/about-page.js`** (Z. 232–234): Author-Zeile und GitHub-Link auf
   Gestura/`PPP01/Gestura`; Original-Credit „based on FlowMouse by Hmily[LCG] & Coxxs"
   sichtbar ergänzen (GPL-Pflicht).
4. **Icons**: Gestura-Logos liegen bereit in `docs/superpowers/specs/`
   (Hand mit Wisch-/Gesten-Pfeil, blauer Verlauf — klar von FlowMouse unterscheidbar).
   Mapping in den Umsetzungs-Commit:
   - `gestura-16.png`  → `icons/icon16.png`
   - `gestura-48.png`  → `icons/icon48.png`
   - `gestura-128.png` → `icons/icon128.png`
   - `gestura-32.png`  → `icons/icon32.png` (zusätzlich; für Firefox-Manifest einbinden)
   - `gestura-source2.png` (589×605) als Quelldatei archivieren (z. B. `assets/`) für spätere Bearbeitung.
   Manifest `icons`/`action.default_icon` ggf. um die 32-px-Größe ergänzen.
5. **Dokumentation**: `README.md`, `README.zh_CN.md`, `CHANGELOG.md`,
   `CHANGELOG.zh_CN.md`, `FORK-NOTES.md`.
   - **README beginnt** (direkt nach Titel/Badges, vor der Feature-Liste) mit einem
     hervorgehobenen Abschnitt „**A fork of [FlowMouse](https://github.com/Hmily-LCG/FlowMouse)**":
     erklärt, dass Gestura ein Fork ist, der nur wegen erweiterter Features (Search
     Engines / Kontext-Menüs) existiert, die es nicht in FlowMouse geschafft haben,
     und **dankt Hmily[LCG] & Coxxs** ausdrücklich für die großartige Erweiterung.
     Link zum Original-Repo bleibt aktiv/anklickbar.
   - Badges/Download-/Issue-Links auf `PPP01/Gestura`; der Link zum **Original**
     FlowMouse bleibt bewusst erhalten.
6. **`.github/ISSUE_TEMPLATE/*`**: Repo-Referenzen auf Gestura.

### B. Bewusst unverändert (GPL + Mergebarkeit)

- `LICENSE` (GPL v3) bleibt wortgleich.
- Neu: `NOTICE` (oder Abschnitt in README) mit Modifikationsvermerk + Datum:
  „Modified 2026 by PPP01. Original: FlowMouse by Hmily[LCG] & Coxxs."
- Alle internen `FlowMouse*`-Code-Identifier bleiben.

### C. Store-/Plattform-Spezifika

- **Chrome Web Store / Edge Add-ons**: Extension-ID wird beim Upload automatisch
  vergeben — keine Manifest-Änderung nötig. Getrennte Entwicklerkonten
  (Google: einmalig 5 USD; Microsoft Partner Center) und je ein Store-Review.
- **Firefox AMO**: erfordert eine eigene
  `browser_specific_settings.gecko.id` = **`gestura@gestura.eu`** im
  Firefox-Manifest sowie Signierung. Passt in den bestehenden
  `firefox-build`-Branch und die vorhandene `web-ext sign`-Notiz (FORK-NOTES §Firefox).

### D. Store-Listing-Assets (vor Einreichung zwingend erforderlich)

Kein Store-Review geht ohne diese Assets durch. Zweigeteilt: **Text/Code liefere
ich mit** (Beschreibungen, Datenschutzseite, Permission-Begründungen); **Screenshots
und Konten** steuert der Nutzer bei.

Für **alle drei Stores** (DE + EN):
- **Store-Beschreibung** kurz + ausführlich. Kernbotschaft: privacy-fokussiert,
  Open Source (GPL-3.0), Fork von FlowMouse mit erweiterten Search-Engine-/Kontext-
  Menü-Features; Dank an die Original-Autoren.
- **Screenshots** der Erweiterung in Aktion (Gesten-Trail, Optionsseite,
  Search-/Kontextmenü). Chrome/Edge: 1280×800 oder 640×400, bis zu 5; Firefox: ≥1.
  → **vom Nutzer beizusteuern** (ich kann Motive/Bildunterschriften vorschlagen).
- **Datenschutzerklärung** als URL — bei Chrome & Edge **Pflicht** wegen
  `host_permissions: <all_urls>`, `clipboardRead`, `tabs`, `downloads` etc.
  Inhalt: keine Datenerhebung/-übertragung; Einstellungen nur im Browser-eigenen
  `storage.sync`. → als `PRIVACY.md` / GitHub-Pages-Seite im Repo (liefere ich mit).
- **Kategorie** (Productivity/Tools), Sprachen, **Store-Icon 128 px** (vorhanden).
- **Permission-Begründungen**: jede angeforderte Berechtigung einzeln rechtfertigen
  (Chrome/Edge verlangen das explizit) → als `docs/store/permission-justifications.md`
  (liefere ich mit).

Pro Store zusätzlich:
- **Chrome Web Store**: Entwicklerkonto (einmalig 5 USD), Datenschutz-Reiter mit
  „single purpose"-Angabe + Permission-Justifications; optional Promo-Tile 440×280.
- **Edge Add-ons**: Microsoft-Partner-Center-Konto, analoge Angaben.
- **Firefox AMO**: Kategorien + Datenschutz; signierte, *gelistete* XPI
  (`web-ext sign --channel=listed`).

**Konsequenz für die Planung:** Das Vorhaben zerfällt in zwei Arbeitspakete —
(1) **Code-Rebrand** (`brand: Gestura`-Commit, dieser Spec-Hauptteil) und
(2) **Store-Einreichung** (Assets oben + Konten + Reviews). Der Umsetzungsplan
deckt Paket 1 vollständig ab und erzeugt die *lieferbaren* Teile von Paket 2
(Beschreibungstexte, `PRIVACY.md`, Permission-Justifications); Screenshots,
Konten und die eigentliche Einreichung bleiben manuelle Nutzerschritte.

## Git-/Branch-Strategie

Unverändert gegenüber FORK-NOTES, plus ein Branding-Commit:

```
main                         (pristine mirror von upstream/main — unangetastet)
feature/search-engine-suite  (feature-squash  →  + brand: Gestura)   ← Chrome/Edge-Build
firefox-build                (feature/search-engine-suite + Firefox-Commits + gecko.id)  ← Firefox-Build
```

Update-Workflow bleibt: `git rebase upstream/main` auf `feature/search-engine-suite`
(spielt Feature-Commit + Branding-Commit ab), danach `firefox-build` darauf rebasen.

## Erwartete Konfliktflächen (Mergebarkeit)

Die ~40 Locale-Dateien werden auch upstream gelegentlich editiert → dort sind beim
Rebase Konflikte am wahrscheinlichsten. Weil Branding aber ein separater, klar
abgegrenzter Commit ist, sind Konflikte lokalisiert und mechanisch lösbar
(immer „Gestura" statt „FlowMouse" behalten, unsere Kontakt-/Repo-Links behalten).
Manifest und about-page sind klein und selten upstream-berührt.

## Erfolgskriterien

- Erweiterung lädt in Chrome, Edge und Firefox unter dem Namen „Gestura" mit
  eigenem Icon; About-Seite zeigt Gestura + Original-Credit.
- Eigene Kontakt-/Support-Kanäle (`contact@gestura.eu`, `PPP01/Gestura` Issues)
  ersetzen `Service@52pojie.cn` und das `52pojie.cn`-Forum als Support-Weg.
- Der **FlowMouse-Ursprung + Dank** ist im README prominent an erster Stelle
  sichtbar, der Link zum Original-Repo aktiv (bewusst erwünscht, nicht nur GPL-Pflicht).
- `npx web-ext lint` auf `firefox-build` = 0 Fehler.
- Bestehende Tests (`vitest`) laufen weiterhin grün (Branding berührt keine Logik).
- Rebase von `feature/search-engine-suite` auf ein simuliertes `upstream/main`
  bleibt handhabbar (Branding als ein Commit).
- GPL-Konformität: `LICENSE` vorhanden, Modifikationsvermerk gesetzt, Quell-Repo
  öffentlich, Original-Autoren genannt.
- Store-Einreichung: lieferbare Assets vorhanden (`PRIVACY.md`,
  Permission-Justifications, DE/EN-Beschreibungen); jeder Store akzeptiert das
  Listing (nach Nutzer-Beitrag von Screenshots + Konten).

## Offene Punkte / vom Nutzer beizusteuern

- ~~Fertige Icon-Dateien.~~ **Erledigt** — `docs/superpowers/specs/gestura-{16,32,48,128}.png`
  + Quelle `gestura-source2.png`.
- ~~Firefox-`gecko.id`.~~ **Erledigt** — `gestura@gestura.eu`.
- **Screenshots** für die Store-Listings (Gesten-Trail, Optionsseite, Menüs) —
  nur der Nutzer kann sie aufnehmen; ich schlage Motive vor.
- **Store-Konten**: Google-Entwicklerkonto (5 USD), Microsoft Partner Center,
  Mozilla-Add-on-Konto (inkl. API-Key zum Signieren).
- Ggf. **GitHub-Pages** aktivieren, um die `PRIVACY.md` als URL bereitzustellen.
