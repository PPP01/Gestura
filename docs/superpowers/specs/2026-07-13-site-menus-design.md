# Design: Website-Menüs (Standard-Menüs + Gesten-Forks)

- **Datum:** 2026-07-13
- **Status:** vom Nutzer freigegeben (Brainstorming abgeschlossen)

## Problem

Alle Custom-Menus liegen heute in einem **globalen Pool** (`customMenus` in den
Settings). Gesten referenzieren Menüs per `menuId`; „Untermenüs" sind
Menüpunkte mit der Aktion `customMenu`, die auf ein anderes globales Menü
zeigen. Folge: geteilter Zustand — wer das Menü „Shopping" ändert, ändert es
in **jedem** Menü, das es einbindet. Private, gestenspezifische Menüs sind so
nur umständlich möglich.

## Anforderungen (aus dem Brainstorming)

1. **Standard-Menüs** als eigener Punkt auf Ebene 1 der Settings: vordefinierte,
   site-spezifische Menüs (GitHub, YouTube, Amazon …), de-/aktivierbar,
   komplett editierbar, Änderungen wirken überall automatisch.
2. Menüeinträge sind nicht nur Suchmaschinen, sondern vor allem **normale
   Links** (kuratierte Unterseiten pro Site), außerdem beliebige
   Gesten-Aktionen. Jeder Eintrag hat ein **wählbares Icon**; passende Icons
   werden mitgeliefert.
3. Die Geste „Custom Menu" kann wahlweise (a) ein Standard-Menü öffnen oder
   (b) ein **eigenes, nur für diese Geste** geltendes Menü. Ein eigenes Menü
   kann aus einem Standard-Menü **geladen und angepasst** werden — die
   Verbindung bleibt bestehen: unveränderte Punkte folgen dem Standard,
   geänderte/gelöschte Punkte setzen sich durch. **Durch Tests abgesichert.**

### Im Brainstorming getroffene Entscheidungen

| Frage | Entscheidung |
| --- | --- |
| Upstream-Updates (FlowMouse) | Irrelevant — Gestura ist eigenständig. |
| Migration bestehender `customMenus` | Keine (einziger Nutzer, Neueinrichtung ok). |
| Reihenfolge/neue Einträge im Fork | **Positionsvererbung** (Regeln s. u.). |
| i18n der vordefinierten Labels | Alle ~40 Locales (maschinell übersetzt). |
| Katalog-Umfang v1 | Die 7 genannten Sites + weitere Klassiker (13 Menüs). |
| Icons | Lucide-Subset + Favicon-Option, per Icon-Picker. |
| Architektur | **Katalog + Kopie-bei-Änderung + Fork-Overlay.** |

## Nicht-Ziele (YAGNI)

- Keine Migration des alten `customMenus`-Keys (wird entfernt/ignoriert).
- Keine zwei Overlay-Ebenen: Standard-Menü-Bearbeitung = Kopie des ganzen
  Menüs, kein Diff gegen den Katalog. Katalog-Updates erreichen bearbeitete
  Menüs nicht (bewusst; „Zurücksetzen" holt den Katalogstand).
- Keine echten hierarchischen Untermenüs im Renderer; „Untermenü" bleibt ein
  Eintrag, der ein anderes Standard-Menü öffnet.
- Kein Emoji-/Freitext-Icon (nur Lucide + Favicon).
- Keine Feld-genaue Vererbung: jede Bearbeitung eines Eintrags löst den
  **ganzen Eintrag** vom Standard (Reset pro Eintrag stellt Vererbung wieder her).

## Architektur

Drei Ebenen, ein Auflösungsweg:

```text
Katalog (Code, js/menu-catalog.js)
        │  Kopie-bei-Änderung („edited") bzw. eigene Menüs („custom")
        ▼
Standard-Menüs (Settings-Key siteMenus)
        │  Fork-Overlay (nur Diff, in der Gesten-Config)
        ▼
Gesten-Menü (zur Laufzeit berechnet: resolveMenu())
```

### 1. Katalog im Code — `js/menu-catalog.js`

Klassisches Skript + `module.exports` (Muster wie `engine-catalog`/
`menu-switcher`), damit Content-Script, Options-Seite und Node-Tests dieselbe
Quelle nutzen. Struktur je Menü:

```js
{
  id: 'github',
  nameKey: 'siteMenuGithub',           // i18n-Key
  icon: 'github',                       // Lucide-Icon des Menüs
  patterns: ['*github.com*'],           // vorbefüllt, für Kontext-Modus
  domains: null,                        // oder { choices: ['amazon.de', 'amazon.com', …], default: 'amazon.de' }
  items: [
    { id: 'gh-notifications', labelKey: 'siteMenuGithubNotifications', icon: 'bell',
      action: 'openCustomUrl', customUrl: 'https://github.com/notifications' },
    'separator',
    …
  ]
}
```

- **Stabile Item-IDs** sind Pflicht (Katalog: sprechend wie `gh-repos`;
  nutzererzeugt: generiert wie heute `menu_<uuid>`), denn die gesamte
  Vererbung hängt an ihnen.
- Eintragstypen: **Link** (`openCustomUrl`), **Suche** (`searchLink`, über die
  bestehende Engine-Registry), **beliebige Aktion** (alles, was `action-select`
  im Kontext `menu-item` anbietet), plus `'separator'`.
- `{domain}`-Platzhalter in URLs wird zur Laufzeit durch die gewählte
  Länder-Domain ersetzt (Amazon; erweiterbar). Andere Platzhalter gibt es
  nicht — Katalog-Links müssen ohne Nutzerkontext funktionieren (z. B.
  `github.com/notifications`, nicht `github.com/<user>`).

### 2. Standard-Menüs in den Settings — Key `siteMenus`

```js
siteMenus: {
  disabled: ['facebook'],              // deaktivierte Katalog-Menüs
  edited:   { github: { …volle Menüdefinition… } },   // Kopie-bei-Änderung
  custom:   { menu_ab12: { …volle Menüdefinition… } },// eigene Menüs
  domains:  { amazon: 'amazon.de' },   // gewählte Länder-Domain je Menü
  order:    []                         // Anzeige-/Prioritätsreihenfolge (leer = Katalogreihenfolge, eigene hinten)
}
```

- Unbearbeitete Katalog-Menüs belegen **keinen** Sync-Speicher.
- „Auf Standard zurücksetzen" = Eintrag aus `edited` entfernen.
- Katalog-Menüs: nicht löschbar, nur deaktivierbar. Eigene Menüs: löschbar
  (mit Warnung; referenzierende Gesten zeigen danach „Menü nicht gefunden").
- **Deaktiviert** bedeutet: erscheint nicht im Switcher und nicht in der
  Kontext-Auswahl; eine Geste mit **direkter** Referenz funktioniert weiter.
- Ersetzt den alten Key `customMenus` ersatzlos. `customMenuSwitcher` und
  `customMenuTheme` bleiben bestehen.

### 3. Gesten-Konfiguration — Aktion `customMenu`

```js
customMenu: {
  mode: 'standard' | 'fork' | 'own' | 'contextual',
  menuId: 'github',        // nur standard/fork: Basis-Menü (bei own/contextual ungenutzt)
  fallbackMenuId: '',      // contextual: Menü, wenn kein Muster passt ('' = nichts öffnen)
  ownMenu: { … },          // own: private, vollständige Menüdefinition
  fork: {                  // nur mode:'fork'
    overrides: { 'gh-repos': { …kompletter Eintrag… } },
    removed:   ['gh-stars'],
    added:     [{ id: 'own1', afterId: 'gh-repos', … }],  // afterId: '' = Anfang
    order:     null,       // null = Positionsvererbung; sonst ID-Liste
    name:      ''          // optionaler eigener Anzeigename (leer = Name des Basis-Menüs)
  }
}
```

Das bisherige Feld `contextual: true` geht in `mode: 'contextual'` auf.
Kontext-Auflösung: erstes **aktives** Standard-Menü in `order`-Reihenfolge,
dessen `patterns` auf die aktuelle URL passen (bestehende Pattern-Logik aus
`menu-patterns`), sonst `fallbackMenuId`.

### 4. Vererbungsregeln — `resolveMenu()` in `js/menu-model.js`

Pure Funktionen, klassisches Skript + `module.exports`, von Options-UI und
Content-Script gemeinsam genutzt. Regeln:

1. Basis ist das aufgelöste Standard-Menü: `edited[id]` ?? Katalog[id]
   (bzw. `custom[id]`).
2. `overrides[itemId]` ersetzt den Standard-Eintrag **komplett**; Reset pro
   Eintrag (= Override löschen) stellt die Vererbung wieder her.
3. `removed`-Einträge erscheinen nie — auch wenn der Standard sie ändert.
   Über den Editor („Ausgeblendete Einträge") zurückholbar (= aus `removed`
   entfernen).
4. **Positionsvererbung** (`order === null`): Ergebnisreihenfolge =
   Standardreihenfolge (Overrides an Ort und Stelle, `removed` ausgelassen);
   neue Standard-Einträge erscheinen automatisch an ihrer Standard-Position.
5. `added`-Einträge werden per Anker einsortiert: nach `afterId`
   (`''` = Listenanfang). Existiert der Anker nicht mehr → ans Ende.
6. Nach manuellem Umsortieren im Fork wird `order` zur festen ID-Liste;
   ab dann landen **neue** Standard-Einträge am Ende. Einträge aus `order`,
   die es nicht mehr gibt, werden ignoriert.
7. Basis-Menü gelöscht (nur bei eigenen Menüs möglich): Geste zeigt
   „Menü nicht gefunden" (bestehendes Verhalten).

## Settings-UI

### Neuer Navigationspunkt „Website-Menüs" (Ebene 1)

- **Menü-Liste:** je Zeile Icon, Name, Ein/Aus-Schalter, Eintragszähler,
  Badge „angepasst" (wenn `edited`), Aktionen: *Bearbeiten*, *Zurücksetzen*
  (nur angepasste Katalog-Menüs, mit Bestätigung), *Löschen* (nur eigene).
  Button „Eigenes Menü anlegen".
- **Menü-Editor** (neue Lit-Komponente `site-menu-editor`, ersetzt funktional
  das heutige `menu-panel`): Name, URL-Muster-Chips (wie heute),
  Länder-Domain-Dropdown (nur wenn `domains` definiert), Eintragsliste mit
  Drag & Drop. Pro Eintrag: **Icon-Picker** (durchsuchbares Lucide-Raster +
  Option „Favicon der Ziel-URL"), Label, Typ (Link / Suche / Aktion) mit
  typabhängigen Feldern.
- Die globalen Einstellungen **Switcher** (an/aus, Header/Footer) und
  **Menü-Theme** ziehen vom bisherigen Ort mit auf diese Seite um.

### Gesten-Editor (Aktion „Custom Menu")

Vier Modi:

1. **Standard-Menü:** Dropdown der aktiven Standard-Menüs; Link
   „Menü bearbeiten" führt zur Website-Menüs-Seite (Änderung wirkt global).
2. **Standard-Menü, angepasst (Fork):** Basis-Dropdown + Inline-Editor.
   Badges pro Eintrag: `Standard` (erbt), `verändert` (mit Reset-Pfeil),
   `eigen`. „Ausgeblendete Einträge anzeigen" holt Gelöschtes zurück.
   Basis-Wechsel verwirft den Fork nach Bestätigung.
3. **Eigenes Menü:** der heutige freie Editor, gespeichert **privat** in der
   Gesten-Config (`ownMenu`), kein globaler Pool. Button „Standard-Menü als
   Vorlage laden" erzeugt stattdessen einen Fork (Modus 2).
4. **Kontextabhängig:** öffnet das passende aktive Standard-Menü
   (URL-Muster), plus Fallback-Dropdown.

Der Eintrags-Editor ist **eine** wiederverwendete Komponente; der Fork-Modus
blendet zusätzlich die Vererbungs-Badges ein.

## Laufzeit (Content-Script)

- Ladereihenfolge in `manifest.json` erweitert: `menu-icons.js`,
  `menu-catalog.js`, `menu-model.js` vor `content.js` (klassische Skripte,
  `window.*`-Globals — Content-Scripts können keine ES-Module laden).
- `buildCustomMenu()` in `js/content.js` ruft `resolveMenu()` auf — dieselbe
  Logik wie im Options-Editor, keine Drift.
- **Icons:** neues `js/menu-icons.js` mit kuratiertem Lucide-Subset
  (~40–60 Icons: Warenkorb, Paket, Verlauf, Stern, Upload, Herz, Home,
  Einstellungen, Mail, Kalender, Video, Musik, Buch, Ordner …) als
  `window.FlowMouseMenuIcons`. SVG-Markup wird dem Menü-iframe direkt
  mitgegeben. Der Icon-Picker der Settings nutzt dasselbe Subset (dort per
  Import-Wrapper oder direktem Script-Include).
- **Favicon-Einträge:** bestehende `requestFavicon`-Infrastruktur
  (Monogramm-Platzhalter → asynchrones Upgrade, `upgradeMenuIcons`).
- **Switcher:** zeigt aktive Standard-Menüs mit `showInSwitcher !== false`.
  Ist ein Fork geöffnet, erscheint er unter seinem (bzw. dem Basis-)Namen;
  Umschalten auf andere Menüs zeigt deren Standard-Version.
- **`addSiteToMenu`:** zielt künftig auf ein Standard-Menü (erzeugt beim
  ersten Hinzufügen die `edited`-Kopie eines Katalog-Menüs).

## Katalog-Umfang v1 (13 Menüs)

GitHub, Microsoft 365/Office, Amazon (Domain wählbar: .de/.com/.co.uk/.fr/
.it/.es/…), Google, Gmail, Google Maps, YouTube, Facebook, Instagram,
X/Twitter, Reddit, LinkedIn, Wikipedia — je 6–12 kuratierte Einträge.

Beispiele: GitHub → Repositories, Stars, Issues, Pull Requests,
Notifications, Actions, Gists, Trending. YouTube → Startseite, Abos, Verlauf,
Später ansehen, Playlists, Studio/Upload. Amazon → Startseite, Warenkorb,
Bestellungen, Wunschliste, Abos (Spar-Abo), Retouren, Kundenservice, Konto.

Alle Labels als i18n-Keys in `_locales/*/messages.json` (~40 Sprachen,
maschinell übersetzt; `en` ist `default_locale`-Fallback).

## Tests (Node, `tests/*.test.mjs`)

- **`menu-model.test.mjs`** — Kernstück, je Vererbungsregel mindestens ein Fall:
  - Override schlägt spätere Standard-Änderung; Reset stellt Vererbung her.
  - `removed` bleibt weg, auch nach Standard-Änderung; Zurückholen wirkt.
  - Neuer Standard-Eintrag erscheint positionsrichtig (`order === null`).
  - `added` mit Anker; Anker entfällt → Ende; `afterId: ''` → Anfang.
  - `order` gesetzt → neue Standard-Einträge ans Ende; verwaiste IDs ignoriert.
  - Basis `edited` vs. Katalog; `{domain}`-Ersetzung; deaktivierte Menüs
    (direkte Referenz funktioniert, Kontext/Switcher nicht).
- **`menu-catalog.test.mjs`** — Katalog-Validierung: IDs global eindeutig,
  i18n-Keys existieren in `en` und `de`, URLs wohlgeformt (https, Platzhalter
  nur wo `domains` definiert), Icon-Namen existieren im Subset.
- Bestehende Tests (`menu-patterns`, `menu-switcher`, `settings-defaults`)
  werden an die neuen Strukturen angepasst.

## Risiken & bewusste Entscheidungen

- **Sync-Quota** (8 KB/Schlüssel, 100 KB gesamt): Es werden nur bearbeitete
  Menüs und Fork-Diffs gespeichert — das reicht weit. Ausweichpfad, falls
  `siteMenus` je zu groß wird: ein Storage-Schlüssel pro Menü (nicht in v1).
- **Kein Alt-Daten-Support:** `customMenus` wird nicht migriert; bestehende
  Gesten mit Custom-Menu müssen einmal neu konfiguriert werden (einziger
  Nutzer, abgesprochen).
- **Fork-Basis-Wechsel** verwirft den bisherigen Fork (mit Bestätigung) —
  Overrides fremder Item-IDs wären sinnlos.
- **Icon-Subset statt Voll-Set:** hält das in alle Frames geladene
  `menu-icons.js` klein; das große `js/icons.js` bleibt ES-Modul der Seiten.

## Nachtrag R2 (2026-07-13, nach Nutzertest freigegeben)

1. **Suche-Menü als Standard-Fallback:** neues Katalog-Menü `search`
   (kuratierte `searchLink`-Einträge: Google, Brave, Perplexity, DuckDuckGo,
   Bing, DeepL, Wikipedia; Selektion wird übergeben). Es ist der Default für
   `fallbackMenuId` (kontextabhängiger Modus) und die Vorauswahl im Modus
   „Standard-Menü". Katalog-Menüs können statt Markenname einen `nameKey`
   (i18n) tragen.
2. **Mini-Suchmenü (Quick-Search-Bar):** Settings-Key
   `menuAppend { enabled, items }` (Default: aus; Brave, Google, Perplexity).
   Bei aktivierter Option hängt jedes Custom-Menu (alle 4 Modi) die Einträge
   nach einem Trenner unten an — pure Funktion `applyMenuAppend()` in
   `menu-model.js`. Pro Menü abwählbar über `appendMini: false` in der
   Menüdefinition (Checkbox im Editor; Forks erben das Flag der Basis).
3. **Shopping-Menü:** Katalog-Menü `shopping` mit Suchen Brave, Google,
   Amazon, eBay (Selektion wird übergeben).
4. **Exklusives Standard-Menü (R4):** `siteMenus.defaultMenuId` (Default:
   `'search'`) markiert genau ein Menü als Standard — es öffnet im
   kontextabhängigen Modus auf allen Seiten ohne Muster-Treffer (sofern nicht
   deaktiviert) und ist die Vorauswahl im Modus „Standard-Menü". Der frühere
   Pro-Gesten-Fallback (`fallbackMenuId`) entfällt ersatzlos. UI: exklusiver
   Schalter oben im Editor (verschwindet bei allen anderen Menüs, sobald
   eines gesetzt ist), Stern + fetter Name in der Liste; beim Standard-Menü
   wird die Website-Muster-Sektion ausgeblendet. Der irreführende Hinweis
   „Leer = überall" (`menuPatternsHint`) wurde in allen Locales ersetzt.
5. **Öffnungsverhalten für Menü-Links (R5, „Erweitert"-gated):** globale
   Einstellung `menuOpenBehavior` (Default `'standard'`: Linksklick öffnet im
   selben Tab, Rechts-/Mittelklick in neuem Tab rechts daneben; Alternativen:
   immer neuer Tab rechts/links/am Ende/am Anfang). Gilt für Link- und
   Such-Einträge in allen Custom-Menus; die Maustaste wird vom Menü-iframe
   über `ctxMenuSelect.button` durchgereicht. Pro Menü überschreibbar via
   `siteMenus.flags[menuId].openBehavior` (Select im Editor). Beide UI-Teile
   erscheinen nur bei aktiviertem „Erweitert"-Schalter der Sektion
   (`sectionAdvanced.siteMenus`); `withMenuFlag` speichert seither auch
   String-Werte ('' = erben).
6. **Pro-Menü-Flags entkoppelt (R3):** `showInSwitcher` und `appendMini`
   werden in `siteMenus.flags[menuId]` gespeichert (Präzedenz: Flag → def →
   true), nicht mehr in der Menüdefinition — Umschalten erzeugt damit keine
   „Angepasst"-Kopie mehr. UI: Icon-Toggles direkt in der Menü-Zeile UND
   Checkboxen oben im aufgeklappten Editor; beide erscheinen nur, wenn das
   jeweilige globale Feature (Switcher bzw. Quick-Search-Bar) aktiv ist.
   Eigene Gesten-Menüs behalten `appendMini` in ihrer privaten Definition.
