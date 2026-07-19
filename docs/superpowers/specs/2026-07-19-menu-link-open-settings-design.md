# Design: Öffnungsverhalten von Menü-Links — individuelle Einstellung schlägt global

- **Datum:** 2026-07-19
- **Status:** Entwurf — wartet auf Freigabe durch den Nutzer

## Problem

Seit dem Umbau auf das globale Öffnungsverhalten („Links öffnen:
Standard: Linksklick im selben Tab, Rechtsklick in neuem Tab") werden die
**individuellen Einstellungen pro Link** (Position + „Im Vordergrund öffnen")
in Website-/Custom-Menüs komplett ignoriert.

Ursache ist eine einzige Stelle in `js/content.js` (buildItems, ~Z. 3596–3601):
für `openCustomUrl`- und `searchLink`-Einträge werden `position` und `active`
**bedingungslos** mit dem Menü-/Global-Verhalten überschrieben:

```js
if (it.action === 'searchLink' || it.action === 'openCustomUrl') {
	itemConfig.position = linkPosition(button);   // überschreibt Per-Link-Position
	itemConfig.active = true;                     // überschreibt „Im Vordergrund"
}
```

Der Link-Editor (action-select, Kontext `menu-item`) zeigt die
Position weiterhin an, als würde sie wirken — irreführend.

Bereits vorhanden und funktionierend: die zweistufige Präzedenz
**Menü-Override → globale Einstellung** (`openBehavior`-Flag pro Menü mit
„Globale Einstellung verwenden", `menuOpenBehavior` global). Es fehlt nur die
dritte Ebene ganz oben.

## Anforderungen

1. Individuelle Einstellungen pro Link setzen sich gegen Menü-Override und
   globale Einstellung durch.
2. Der Link-Editor erhält eine Option **„Globale Menü-Einstellungen
   verwenden"** — als Default.
3. **Alle Bestandslinks** verhalten sich nach dem Update wie „Globale
   Menü-Einstellungen verwenden" (egal, welche alten Positionswerte noch
   gespeichert sind).
4. Betrifft `openCustomUrl` **und** `searchLink`-Einträge in Menüs;
   ebenso Menü-Forks, eigene Gesten-Menüs und den Mini-Menü-Anhang
   (gleicher Codepfad).
5. So einfach wie möglich: eine Regel, keine Migration.

### Getroffene Entscheidungen (Nutzer, 2026-07-19)

- **Individuelle Position gilt für alle Maustasten.** Kein Sonderfall
  „Rechtsklick öffnet trotzdem neuen Tab" — hat der Link eine eigene
  Einstellung, gewinnt sie. Punkt.
- **Opt-in-Feld statt Migration.** Bestandsdaten werden nicht angefasst.

## Lösung

### Präzedenz (neu, dreistufig)

```
Link-individuell (ownPosition) → Menü-Override (openBehavior) → global (menuOpenBehavior)
```

### 1. Datenmodell

Menü-Items bekommen ein optionales Feld **`ownPosition: true`**.

- **Gesetzt:** `position` (`right|left|first|last|current|newWindow`,
  Default `last`) und `active` (Default `true`) des Items gelten —
  für alle Maustasten.
- **Nicht gesetzt (Default, alle Bestandslinks):** Verhalten wie heute —
  Menü-Override bzw. global; „standard" = Linksklick selber Tab,
  Rechts-/Mittelklick neuer Tab rechts.
- `incognito` pro Link wirkt unverändert **immer** (wird heute schon nicht
  überschrieben).

Damit ist Anforderung 3 per Konstruktion erfüllt: alte `position`-Werte ohne
`ownPosition` sind wirkungslos — in `siteMenus.custom/edited`, Forks,
eigenen Menüs und `menuAppend.items` gleichermaßen. Kein Migrationscode.

### 2. Auflösung als pure Funktion (`js/menu-model.js`)

Neue Funktion, exportiert im `FlowMouseMenuModel`-API:

```js
// Liefert { position, active } für einen Link-/Such-Eintrag im Menü.
// button: 0 = Linksklick, sonst Rechts-/Mittelklick.
function itemOpenConfig(item, menuBehavior, globalBehavior, button) {
	if (item && item.ownPosition) {
		return { position: item.position || 'last', active: item.active !== false };
	}
	const behavior = menuBehavior || globalBehavior || 'standard';
	if (behavior === 'standard') {
		return { position: button ? 'right' : 'current', active: true };
	}
	return { position: behavior, active: true };
}
```

`content.js` (buildItems) ersetzt die Inline-Logik (`linkPosition` +
Überschreiben) durch einen Aufruf dieser Funktion.

### 3. Editor (`js/components/action-select.js`)

Nur im Kontext `menu-item`, nur für `openCustomUrl` und `searchLink`:

- Das Position-Dropdown erhält als **erste Option**
  „Globale Menü-Einstellungen verwenden" (Wert `''`).
- Angezeigt wird sie, wenn `ownPosition` fehlt — der Default für neue wie
  bestehende Einträge.
- Auswahl der Global-Option → `ownPosition`, `position`, `active` werden aus
  der Config **entfernt**; die Checkbox „Im Vordergrund öffnen" wird
  ausgeblendet.
- Auswahl einer konkreten Position → `ownPosition: true` + `position` werden
  gesetzt; Checkbox erscheint (außer bei `current`, wie bisher).

Gesten-, Wheel-, Rocker- und Aktionsketten-Kontext: **unverändert** — dort
gibt es keine Global-Option, die Position wirkt wie bisher direkt.

### 4. i18n

Neuer Key `tabPositionInheritMenu` („Globale Menü-Einstellungen verwenden" /
"Use global menu settings") in `_locales/en` und `_locales/de`; übrige
Locales fallen per `default_locale` auf Englisch zurück.

### 5. Tests (`tests/menu-model.test.mjs`)

Vitest-Fälle für `itemOpenConfig`:

- ohne `ownPosition`, Verhalten „standard": Linksklick → `current`,
  Rechts-/Mittelklick → `right`, `active: true`.
- ohne `ownPosition`, Menü-Override `first` schlägt global `last`.
- ohne `ownPosition`, kein Override: global gilt.
- mit `ownPosition`: Item-Position/-active gilt, Maustaste egal;
  alter `position`-Wert **ohne** `ownPosition` wird ignoriert.
- Defaults: `ownPosition` ohne `position` → `last`; `active`-Default `true`.

### 6. Doku

- Eintrag in `CHANGELOG.md` (Fix + neues Verhalten).
- Kein Versions-Bump (erst beim nächsten Release).

## Nicht im Scope

- Globale Einstellung `menuOpenBehavior` und Menü-Override `openBehavior`:
  unverändert (funktionieren bereits, inkl. „Globale Einstellung
  verwenden"-Option pro Menü).
- Gesten-Aktion `openCustomUrl`/`searchLink` außerhalb von Menüs.
- Natives Kontextmenü: öffnet nur das Overlay → läuft automatisch durch den
  korrigierten Pfad.
- Drag-Aktionen und deren Öffnungsverhalten.
