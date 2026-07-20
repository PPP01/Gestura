# Design: Gestura-Index — Menüs & Engines teilen, Betreiber-Import, Konten & E2E-Sync

- **Datum:** 2026-07-19
- **Status:** vom Nutzer freigegeben (Brainstorming abgeschlossen)

## Problem / Ziel

Gestura-Nutzer können Menüs und Custom-Engines heute nur lokal anlegen. Es fehlt:

1. Ein Weg für **Website-Betreiber**, ein fertiges Menü für ihre Site anzubieten
   (1-Klick-Import, danach frei anpassbar).
2. Ein **Index** (bewusst nicht „Store"), in den Nutzer eigene Menüs und
   Engines einreichen können — mit Beschreibung, optionalem Bild, Bewertungen,
   Versionierung und Moderation.
3. **Konten** (optional!) mit Passkey, Übersicht über Einreichungen und
   geladene Inhalte, sowie **Ende-zu-Ende-verschlüsseltem Settings-Sync**
   über Browser hinweg (FF, Brave, Chrome, Edge).

## Grundprinzipien (nicht verhandelbar)

- **Der Index ist ein optionales, kostenloses Zusatzfeature.** Gestura läuft
  ohne ihn vollständig; kein Feature der Extension hängt am Backend. Er ist
  unabhängig von den Browser-Stores.
- **Ohne Anmeldung nutzbar:** Stöbern, Importieren, Einreichen, Update-Check,
  Melden — alles anonym möglich. Ein Konto bringt Komfort (Verwaltung,
  Bewertungen, Sync), nie Pflichten.
- **Datensparsamkeit:** So wenig Daten wie möglich; vollständige Selbstauskunft
  („Meine Daten"); alles Private Ende-zu-Ende verschlüsselt.
- **Kein Push:** Updates geladener Inhalte werden nur angezeigt und auf
  ausdrücklichen Wunsch übernommen.

## Entscheidungen aus dem Brainstorming

| Frage | Entscheidung |
| --- | --- |
| Zielgruppe | Veröffentlichung von Gestura ist geplant; Index ist Teil davon. |
| Infrastruktur | Eigener Server, klassisches Webhosting (PHP/MySQL). |
| Backend-Ansatz | **Symfony als reine JSON-API** (minimal starten, `symfony/skeleton`), Doctrine/MySQL, WebAuthn-Bundle; kein Twig-Frontend; Lese-Endpunkte mit `ETag`/`Cache-Control` (statische Materialisierung bleibt spätere Option). |
| Frontend-Stack | **Svelte 5 ausschließlich für das Index-Frontend** (öffentliche Index-Website + Admin-Panel, laufen auf dem Server). **Die Extension bleibt komplett unverändert:** Lit-Komponenten, plain JS, **kein Build-Schritt**. In der Extension entsteht kein Svelte. |
| Deployment | Automatisiertes Deployment zum Live-Server (Symfony-API + gebautes Svelte-Index-Frontend), s. Abschnitt 7. |
| Moderation | **Hybrid nach Vertrauen** (s. u.). |
| Anonymer Besitz | **Geheimer Edit-Token** (lokal gespeichert, Anzeige zum Sichern, Konto-Übernahme möglich). |
| Bewertungen | **Sterne nur mit Konto** (1/Menü, änderbar) + anonyme aggregierte Install-Zähler. |
| Krypto-Modell | **Ende-zu-Ende (Zero-Knowledge)** für alles Private; öffentliche Index-Inhalte sind naturgemäß Klartext. |
| Betreiber-Discovery | **Komplett passiv:** Betreiber setzt selbst einen Button/Link auf seiner Seite; kein automatisches Scannen, keine Well-Known-Abfragen. |
| Taxonomie | Feste **Kategorien** + freie **Tags** + **Domain-Gruppierung** (aus den URL-Mustern: „github.com → alle Varianten"). |
| Engines im Index | Ja — Custom-Engines (Suchmaschinen **und** reine Links) sind zweiter Inhaltstyp; JS-Transformationen mit Warnpflicht (s. Abschnitt 6). |
| Admin-Auth | **Zwei-Faktor-Pflicht** für Admins (s. Abschnitt 2). |
| Sprachen | **Start mit en/de.** Betrifft: neue Extension-UI-Strings (i18n-Keys in `en` + `de`), Index-Website und Admin-Panel (en/de). Das Austauschformat erlaubt beliebige Sprachen (Sprach-Objekte, `en`-Fallback); weitere UI-Sprachen später. |
| Phasierung | **Format → Index → Konten** (drei Sub-Projekte, je eigener Plan). |

## Nicht-Ziele (YAGNI / bewusst verworfen)

- Keine Kommentare/Diskussionen, kein Follower-/Sozialsystem (Moderationslast).
- Kein Auto-Push von Updates; keine automatische Discovery (kein DOM-Scan,
  kein Well-Known-Polling).
- Keine Telemetrie über anonyme Install-Zähler hinaus; keine Monetarisierung.
- Kein Git-/PR-basierter Index (bräuchte GitHub-Konto — widerspricht
  „Einreichen nur aus Gestura, auch ohne Anmeldung").
- Kein Passwort-Login (nur Passkey; Wiederherstellung über Zweit-Passkey,
  Recovery-Codes oder optionale E-Mail).
- Kein Auto-Sync der Settings in v1 (nur explizites Hoch-/Herunterladen).
- Anzeige-Sprache der Labels: Format erlaubt Mehrsprachigkeit, aber keine
  serverseitige Übersetzung.

## Architektur-Überblick

```text
┌──────────────────────────── Gestura (Extension) — UNVERÄNDERT ──────────────┐
│ Lit-Komponenten (Options/Popup/Editor…) · Content-Scripts · Service-Worker  │
│ plain JS, kein Build-Schritt (wie heute)                                     │
│ NEU hier (weiterhin Lit/plain JS):                                           │
│   Austauschformat + Validator (js/menu-exchange.js, pure, geteiltes Schema) │
│   Import-Vorschau (Button/URL/Datei/Index) · Settings-Tab „Menü-Index“      │
│   Einreichen · Update-Diff · Konto-Anbindung · E2E-Crypto (WebCrypto)       │
└───────────────┬─────────────────────────────────────────────────────────────┘
                │ HTTPS, JSON, /api/v1 (Lese-Pfad ETag/Cache-Control)
┌───────────────▼──────────── Index (eigenes Repo, eigener Server) ───────────┐
│ Index-Frontend (Svelte 5): öffentliche Index-Website + Admin-Panel          │
│   (prerendered/SPA, konsumiert nur die API) — HIER lebt Svelte              │
│ Backend (Symfony, reine JSON-API):                                          │
│   API (~12 Endpunkte) · Moderations-Statusmaschine · RateLimiter           │
│   Doctrine/MySQL: Entry, EntryVersion, Submitter, Report, User, SyncBlob    │
│   WebAuthn (web-auth/webauthn-symfony-bundle)                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

Backend **und** Svelte-Index-Frontend leben in einem **eigenen Repo** mit
eigenem Deploy-Zyklus, getrennt von der Extension. Geteilte Vertragsdatei ist
das **JSON-Schema des Austauschformats** (liegt im Gestura-Repo, wird ins
Backend übernommen).

### Constraint: Svelte nur im Index-Frontend, Extension bleibt Lit/plain JS

- **Extension (Gestura-Repo):** komplett unverändert im Stack — Lit-Komponenten
  für UI, Content-Scripts/Service-Worker als plain JS im IIFE-/Globals-Muster,
  **kein Build-Schritt**. Alle neuen Extension-Teile dieses Features
  (Import-Vorschau, Settings-Tab „Menü-Index", Einreichen-Dialog, Update-Diff,
  Konto-/Sync-UI) werden als **Lit-Komponenten** gebaut, passend zum Bestand.
- **Pure-Funktionen** (`menu-exchange.js`/Validator, `menu-model.js`,
  `transform-runner.js`): klassische Skripte + `module.exports`, geteilt
  zwischen Content-Script, Lit-UI und Node-Tests; das JSON-Schema wird
  zusätzlich vom Symfony-Backend genutzt.
- **Svelte lebt ausschließlich im Index-Repo** (öffentliche Website + Admin).
  Es berührt die Extension nicht; der Extension-Build-Zustand
  („no build step") bleibt bestehen.

---

## Abschnitt 1: Austauschformat + Betreiber-Import (Phase 1, rein clientseitig)

### Format

Versioniertes JSON; `formatVersion` (Feldname = Typ) getrennt von inhaltlicher
`version` (SemVer):

```json
{
	"gesturaMenu": 1,
	"id": "com.example.shop-menu",
	"version": "1.2.0",
	"name": { "en": "Example Shop", "de": "Beispiel-Shop" },
	"description": { "en": "…", "de": "…" },
	"icon": "cart",
	"patterns": ["*example.com*"],
	"homepage": "https://example.com",
	"items": [
		{ "id": "orders", "label": { "de": "Bestellungen" }, "icon": "package",
		  "action": "openCustomUrl", "customUrl": "https://example.com/orders" },
		"separator"
	]
}
```

- **Typen:** `gesturaMenu: 1` (Menüs) und `gesturaEngine: 1` (Custom-Engines,
  Abschnitt 6). Unbekannte Typen/Formatversionen werden mit klarer Meldung
  abgelehnt (ältere Gestura-Versionen bleiben sauber).
- `id`: vom Autor gewählte Reverse-Domain-artige Kennung; Eindeutigkeit prüft
  der Index beim ersten Publizieren.
- Labels/Beschreibungen: String **oder** Sprach-Objekt mit `en`-Fallback.
- **Aktions-Whitelist:** nur unbedenkliche Aktionen (Links, Suchen, Scroll-,
  Tab-Aktionen …) — nichts mit Skript-Charakter. URLs nur `https:`
  (kein `javascript:`, `data:`, `file:`). Größen- und Eintragslimits.
- **Validator** = pure Funktion in `js/menu-exchange.js` (klassisches Skript +
  `module.exports`, Muster wie `menu-model.js`); formalisiert als
  **JSON-Schema**, das Client (JS) und Server (PHP) identisch anwenden.

### Betreiber-Button

```html
<a href="/gestura-menu.json" rel="gestura-menu">Menü zu Gestura hinzufügen</a>
```

- Content-Script fängt **vertrauenswürdige Klicks** auf `rel="gestura-menu"`-
  Links ab (bestehendes `EventManager`-Muster), lädt die JSON **nur von
  derselben Origin** (Fremd-Origin → Abbruch mit Meldung; verhindert
  untergeschobene Menüs für fremde Sites), validiert, zeigt Import-Vorschau.
- **Import-Vorschau** (eine Komponente für alle Import-Wege): Name,
  Beschreibung, alle Einträge mit sichtbaren Ziel-URLs, URL-Muster; erst nach
  Bestätigung Import → `siteMenus.custom` mit Herkunfts-Metadaten
  `source: { type: 'site' | 'index' | 'url' | 'file', url?, indexId?, version }`.
- Ohne Extension öffnet der Link schlicht die JSON-Datei; die Gestura-Doku
  liefert Betreibern ein Snippet mit Fallback auf eine Infoseite
  (ab Phase 2: die öffentliche Web-Ansicht des Index).

### Weitere Import-/Export-Wege (gleicher Validator, gleiche Vorschau)

- **Export als Datei** aus der Menü-/Engine-Liste der Options-Seite.
- **Import per Datei** und **Import per URL** (JSON-URL einfügen).

---

## Abschnitt 2: Der Index (Phase 2 — Backend + Client-UI)

### Datenmodell (Doctrine/MySQL)

- **Entry** (Menü *oder* Engine) — Format-`id`, Slug, Typ (`menu` | `engine`), aktuelle Version,
  Kategorien (feste Liste: Dev, Shopping, Video, News, Social,
  Produktivität …), freie Tags, Domains (aus `patterns` extrahiert →
  Domain-Gruppierung), Install-Zähler, Sterne-Aggregat, Status
  (`pending` | `published` | `hidden` | `deleted`), optional Screenshot,
  optional Deprecation (`deprecated: true`, Nachfolger-`id`).
- **EntryVersion** — SemVer, validiertes JSON (opak gespeichert), Changelog-
  Text, Einreichdatum, Freigabestatus. Alte Versionen bleiben abrufbar.
- **Submitter** — Konto-Referenz **oder** Argon2id-Hash des anonymen
  Edit-Tokens (das Token selbst wird nie gespeichert); Trust-Level.
- **Report** — Meldung mit festem Grund (Spam, defekte Links, irreführend,
  rechtlich), optional Freitext; anonym möglich, gedrosselt.

### API (JSON, `/api/v1`, ~12 Endpunkte)

- `GET /menus` — Suche/Filter: `q`, `site` (Domain), `category`, `tag`,
  `type`, `sort=installs|rating|newest`; paginiert.
- `GET /menus/{id}` — Detail + Versionsliste; `GET /menus/{id}/{version}` —
  Download (zählt Install anonym, **ohne IP-Speicherung**).
- `POST /updates` — Body: Liste `{id, version}` → Antwort nur für Einträge
  mit neuerer Version (inkl. Deprecation-Hinweis). Keine Kontobindung.
- `POST /menus`, `PUT /menus/{id}`, `DELETE /menus/{id}` — Einreichen/
  Aktualisieren/Löschen; Auth per Konto-Session **oder** Edit-Token.
- `POST /menus/{id}/report`, `PUT /menus/{id}/rating` (nur Konto).
- Lese-Endpunkte mit `ETag`/`Cache-Control`; alles unter `/api/v1`.

### Moderation (Hybrid nach Vertrauen)

- Neue Einreicher → **Warteschlange** (Vorab-Freigabe).
- Angemeldete Einreicher mit ≥ N freigegebenen Inhalten (konfigurierbar) →
  sofort `published`, stichprobenfähig.
- **Updates bestehender Inhalte sofort live** — aber immer serverseitig voll
  validiert (Whitelist, URL-Schemata, Größen-/Eintragslimits).
- **Ausnahme:** Einreichungen mit `transformCode` gehen **immer** durch die
  Warteschlange (Abschnitt 6).
- Automatik: Rate-Limits pro IP (Symfony RateLimiter; IPs nur flüchtig im
  Limiter-Speicher), Duplikat-Erkennung (Inhalts-Hash), URL-Plausibilität.
- Meldungen ab Schwellwert (konfigurierbar) → automatisch `hidden` bis zur
  Prüfung.

### Admin (`/admin`, Svelte-SPA gegen die API)

- Warteschlange, Meldungsliste, Suche, Verstecken/Löschen, Sperren
  (Token-Hash- oder Kontobasiert), Trust-Level setzen.
- **Zwei-Faktor-Pflicht:** Passkey verpflichtend **plus** zweiter Faktor
  (TOTP oder getrennt verwahrter Zweit-Passkey). Kurze Session-Laufzeit,
  erneute Faktor-Bestätigung vor destruktiven Aktionen, **Audit-Log** aller
  Admin-Aktionen.

### Bilder

Optional 1 Screenshot pro Eintrag; serverseitig **neu enkodiert**
(GD/Imagick → WebP, feste Maximalgröße), niemals Fremd-URLs.

### Client (Gestura, Lit-UI wie der Bestand)

- Neuer Settings-Tab **„Menü-Index"**: Suche, Kategorie-/Tag-Filter,
  Domain-Gruppierung, Typ-Filter (Menü/Engine), Detailansicht mit
  **Vorschau vor dem Laden** (dieselbe Import-Vorschau wie Phase 1).
- Geladene Inhalte tragen `source: { type: 'index', id, version }`.
  **Update-Check:** manueller Button + optionaler, abschaltbarer
  Wochen-Check; Ergebnis = Badge. Übernahme **nie** automatisch:
  **Diff-Ansicht** (neue/geänderte/entfernte Einträge) vor dem Übernehmen;
  lokale Anpassungen bleiben über das bestehende Fork-Overlay-Prinzip
  erhalten.
- **Einreichen** aus der Menü-/Engine-Liste: „Im Index veröffentlichen" →
  Formular (Beschreibung, Kategorie, Tags, optional Screenshot) → Vorschau →
  Absenden. Anonym: Edit-Token wird erzeugt, lokal gespeichert und einmalig
  zum Sichern angezeigt.
- **Fehlerverhalten:** Index nicht erreichbar → klare Meldung + Retry, kurze
  Timeouts (5 s), kein Feature der Extension blockiert; keine
  Hintergrund-Requests ohne Nutzeraktion außer dem optionalen Wochen-Check.

---

## Abschnitt 3: Konten, Passkey & E2E-Settings-Sync (Phase 3)

### Datensparsamkeit als Bauprinzip

Ein Konto besteht aus — sonst nichts:

- zufälliger User-ID (UUID),
- öffentlichem Anzeigenamen (frei wählbar; einzige Pflichtangabe),
- Passkey-Credential(s) (öffentlicher Schlüssel + Credential-ID),
- **keiner E-Mail-Pflicht.** Optionale E-Mail nur für Wiederherstellung
  (gehasht + verschlüsselt, nie Mailings). Ohne E-Mail: **Recovery-Codes**.

### Auth

- Registrierung/Login **ausschließlich per Passkey** (WebAuthn-Bundle);
  kein Passwort im System. Mehrere Passkeys pro Konto aktiv empfohlen
  (Desktop + Handy = beste Wiederherstellung).
- Aus der Extension: WebAuthn-Flow in kurzem **Popup-Fenster auf der
  Index-Domain** (WebAuthn braucht Seitenkontext); Session-Token zurück an
  die Extension.

### „Meine Daten"

Zeigt vollständig, was der Server kennt (Liste oben + Einreichungen +
Bewertungen + Sync-Blobs mit Größe/Datum) — mit **JSON-Export** und
**Konto löschen** (sofort, unwiderruflich; Einreichungen wahlweise mitlöschen
oder anonymisiert belassen).

### E2E-Settings-Sync

- Nutzer wählt **Sync-Passphrase** → clientseitig Argon2id-Schlüsselableitung
  (WebCrypto + lokal vendorte argon2-WASM-Datei, wie Lit) →
  Settings als **ein verschlüsselter Blob** (XChaCha20-Poly1305 bzw. AES-GCM).
  Server sieht nur Ciphertext, Größe, Zeitstempel, nutzergewählten
  Geräte-/Stand-Namen.
- **Kein Auto-Sync in v1:** explizit „Hochladen" / „Herunterladen &
  importieren"; Blob = bestehendes Settings-Exportformat, Import über die
  vorhandene `SettingsStore`-Logik. Mehrere benannte Stände („Arbeit",
  „Privat").
- Passphrase vergessen = alte Blobs unlesbar → neue Passphrase, aktuellen
  Stand neu hochladen (lokal vorhanden — kein Datenverlust). Klar in der UI
  erklärt.
- Browserübergreifend identisch (FF/Brave/Chrome/Edge): nur WebCrypto + fetch.

### Angemeldet zusätzlich

- **Meine Einreichungen:** bearbeiten, neue Version publizieren, löschen,
  Statistik (Installs, Bewertung).
- **Meine geladenen Inhalte** mit Update-Badges — die Liste bleibt lokal bzw.
  im E2E-Blob, der Update-Check läuft weiterhin **anonym** (keine
  Kontobindung der Nutzungsdaten).
- Sterne-Bewertungen abgeben/ändern (1 pro Inhalt).
- Anonyme Edit-Tokens per Klick ins Konto **überführen**.

---

## Abschnitt 4: Zusatzfeatures (geprüft und eingeplant)

**v1:**

1. **Öffentliche Web-Ansicht** des Index (Svelte 5). Für SEO/Entdeckbarkeit
   werden die weitgehend statischen Seiten (Startseite, Kategorie-,
   Detailseiten) **prerendered** (SvelteKit `adapter-static` — reine
   HTML/JS-Dateien, laufen auf klassischem Hosting ohne Node-SSR); dynamische
   Suche hydratisiert clientseitig. Dient zugleich als Fallback-Ziel für den
   Betreiber-Button und liefert Deep-Links „In Gestura öffnen".
2. **Import per URL & Datei** (s. Abschnitt 1).
3. **Meldegründe** statt Freitext (s. Datenmodell).
4. **Deprecation-Hinweis** (Autor markiert „veraltet, Nachfolger: X";
   erscheint im Update-Check).

**v1.x:**

5. **Domain-Verifizierung + Betreiber-Badge** (`/.well-known/`-Datei oder
   DNS-TXT) → „Verifizierter Betreiber", Sortier-Bonus.
6. **Kuratierte „Empfohlen"-Sektion** (Admin) — wichtig, solange
   Bewertungszahlen klein sind.
7. **RSS/Atom-Feed** neuer Inhalte.
8. **Sprachfilter** („mit deutschen Labels").

**Später (Format hält die Tür offen):**

9. **Ganze Profile teilen** — neuer Typ `gesturaProfile` im selben Index,
   ohne Formatbruch (Typ-Feld existiert von Anfang an).

---

## Abschnitt 5: Fehlerbehandlung & Tests

- **Extension ohne Backend voll funktionsfähig** (s. Client-Fehlerverhalten).
- **Validator beidseitig:** Client validiert vor Anzeige/Import (nie
  ungeprüftes JSON rendern), Server unabhängig bei jeder Einreichung —
  gleiche Regeln via geteiltem JSON-Schema.
- **Tests Extension (vitest, wie Bestand):** `menu-exchange.test.mjs` —
  Validator (Whitelist, URL-Schemata, Formatversionen, bösartige Payloads:
  `javascript:`-URLs, Riesen-JSON, SemVer-Overflow), Import-Mapping nach
  `siteMenus.custom` bzw. Engine-Registry, Update-Diff-Berechnung,
  Same-Origin-Regel des Betreiber-Buttons, Transform-Warnpfad (Abschnitt 6).
  Framework-freie Pure-Funktionen — direkt testbar, kein Svelte im Spiel.
- **Tests Index-Frontend (Svelte):** leichte Komponententests (Vitest +
  `@testing-library/svelte`) für Web-Ansicht/Admin — der Großteil der Logik
  liegt aber im Backend bzw. in den geteilten Pure-Funktionen.
- **Tests Backend (PHPUnit):** Endpunkte inkl. Auth-Grenzen (anonym / Token /
  Konto / Admin), Moderations-Statusmaschine (inkl. Transform-Ausnahme),
  Rate-Limits, WebAuthn-Flows, Sync-Blob bleibt opak (kein Klartext-Pfad).

---

## Abschnitt 6: Custom-Engines im Index (inkl. JS-Transformationen)

- Typ **`gesturaEngine: 1`** entspricht 1:1 der bestehenden
  Custom-Engine-Definition ([js/engine-registry.js](../../../js/engine-registry.js)):
  URL-Template (mit `%s` = Suche, ohne = reiner Link), `plus`, `slug`,
  `suffix`, `clipboardMode`, `type: text|image`, Transform-Felder
  (`transformEnabled`, `transformCode`, `transformClipboard`,
  `transformRawResult`). **Kein neues Laufzeit-Feature** — Import mündet in
  der Engine-Registry; „Teilen"-Funktion für nützliche Suchen **und** Links.
- Index behandelt Engines wie Menüs (Kategorien, Tags, Versionen,
  Bewertungen, Zähler, Moderation, Domain-Gruppierung soweit ableitbar).

### Sicherheitsregeln für `transformCode` („Benutzerdefinierte Transformation (JS)")

1. **Import-Warnung mit Code-Anzeige:** Warnblock („führt JavaScript zur
   Umwandlung der Eingabe aus — nur importieren, wenn du der Quelle
   vertraust") + vollständiger Code (read-only, Monospace). Import erst nach
   **eigener Bestätigungs-Checkbox**, nicht über den normalen Import-Button.
2. **Chrome-only-Hinweis:** Transformationen laufen nur in Chrome/Chromium
   (Offscreen-Sandbox). Firefox: Import **ohne** Transformation angeboten —
   außer der Einreicher setzt `transformRequired: true`, dann ausgegraut mit
   Erklärung.
3. **Moderations-Verschärfung:** Einreichungen mit `transformCode` umgehen
   **nie** die Warteschlange — auch nicht bei Trust-Level, auch nicht bei
   Updates (nachträglich eingeschleustes Skript = klassischer
   Supply-Chain-Trick). Listenansicht zeigt Skript-Badge („enthält Skript").
4. **Update-Diff:** Ändert ein Update den Transform-Code, zeigt die
   Diff-Ansicht den **Code-Diff zwingend** an; Bestätigungs-Checkbox erneut.

---

## Abschnitt 7: Build-Toolchain & Deployment

### Extension: kein Build-Schritt (unverändert)

Die Extension behält ihren Zustand aus [CLAUDE.md](../../../CLAUDE.md) —
**kein Build, kein Bundler**: Repo-Ordner = entpackte Extension, Lit als
vendored Bundle, `chrome://extensions`-Reload nach Edits. Das neue Feature
fügt der Extension nur weitere plain-JS-/Lit-Dateien hinzu.

### Index-Repo: Build (Svelte) + Deployment

Der **neue Build-Schritt betrifft ausschließlich das Index-Repo**, nicht die
Extension.

- **Index-Frontend (Svelte 5):** SvelteKit mit `adapter-static` (Prerender der
  öffentlichen Seiten für SEO, Admin als client-only SPA) → reine statische
  Dateien, kein Node auf dem Server nötig. `vite build` / `svelte-kit build` →
  Upload ins Web-Root der Index-Domain.
- **Backend (Symfony):** PHP ≥ 8.2. `composer install --no-dev -o` lokal/CI,
  Deploy per Skript (SSH/rsync bzw. Muster wie
  `\\192.168.60.225\patric\scripts`; Zielumgebung noch zu klären).
  Migrationen via `doctrine:migrations:migrate` im Deploy-Schritt. Secrets
  über `.env.local`/Environment außerhalb des Repos.
- **Pure-Funktionen/Schema:** das JSON-Schema des Austauschformats wird aus dem
  Gestura-Repo ins Index-Repo übernommen (Kopie oder Submodule — in der
  Umsetzung festzulegen), damit Client- und Serverregeln nicht driften.
- **CI (empfohlen):** Pipeline für das Index-Repo, die bei Push Tests
  (Svelte-Komponententests + PHPUnit) fährt, baut und deployt. Die Extension
  wird davon nicht berührt und weiterhin manuell/über den Store-Prozess
  veröffentlicht.

---

## Risiken & bewusste Entscheidungen

- **Erstes Backend des Projekts:** getrenntes Repo, kleiner API-Umfang,
  Symfony-Standardbausteine statt Eigenbau bei Auth/Limits — bewusst gegen
  Framework-Minimalismus (Ansatz A) entschieden, um Wachstumspotential zu
  haben; Skeleton-Start hält es schlank.
- **DSGVO:** Datensparsamkeit by design (keine E-Mail-Pflicht, keine
  IP-Persistenz, anonyme Zähler, Selbstauskunft, Löschrecht sofort).
  Impressum/Datenschutzerklärung der Web-Ansicht sind Inhalt, nicht Code —
  vor Launch bereitstellen.
- **Edit-Token verloren:** Verwaltung des anonymen Inhalts verloren; Admin
  kann manuell helfen (Nachweis nötig). Bewusst akzeptiert, in der UI beim
  Einreichen deutlich erklärt.
- **Sterne-Manipulation:** nur Konten dürfen bewerten; Konten sind gratis,
  aber Passkey-Registrierung + Rate-Limits erhöhen die Hürde deutlich.
  Restrisiko akzeptiert (kleine Community, Admin-Eingriff möglich).
- **Symfony auf Shared Hosting:** benötigt PHP ≥ 8.2 + Composer-Deploy
  (lokal bauen, hochladen). Vor Phase 2 einmal verifizieren.
- **WebAuthn-Popup-Flow aus der Extension:** Browser-Unterschiede (FF/Brave)
  früh in Phase 3 prototypisch testen, bevor die Konto-UI entsteht.
- **Zwei Stacks bewusst getrennt:** Extension bleibt Lit/plain JS ohne Build
  (Store-Reviewbarkeit, kein Neuschreiben funktionierender UI); Svelte nur im
  Index-Repo. Eine Vereinheitlichung auf Svelte in der Extension wurde geprüft
  und **verworfen** — kein erkennbarer Vorteil, aber Build-Zwang, CSP-Aufwand
  und ~23 zu portierende Komponenten als Nachteil.
- **SPA-SEO:** öffentliche Index-Website wird prerendered (`adapter-static`),
  damit Entdeckbarkeit trotz Svelte erhalten bleibt; rein clientseitig
  gerenderte Seiten wären für SEO schädlich.

## Phasierung (je Phase ein eigener Implementierungsplan)

| Phase | Inhalt | Abhängigkeit |
| --- | --- | --- |
| 1 | (Extension, Lit/plain JS) Austauschformat + Validator + JSON-Schema (Pure-Funktionen), Betreiber-Button, Import (Datei/URL), Export, Import-Vorschau | keine (rein clientseitig) |
| 2 | (Index-Repo) Symfony-JSON-API (Index, Moderation, Admin), Svelte-Index-Frontend (öffentliche Website + Admin, SvelteKit `adapter-static`) + Deployment-Pipeline; (Extension) Settings-Tab „Menü-Index", Einreichen, Update-Check + Diff | Phase 1 |
| 3 | Konten (Passkey), Bewertungen, „Meine Daten", E2E-Settings-Sync, Token-Überführung — Extension-UI in Lit, Konto-Seiten im Svelte-Index-Frontend | Phase 2 |
