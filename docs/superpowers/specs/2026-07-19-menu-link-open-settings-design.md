# Design: Öffnungsverhalten von Menü-Links — individuelle Einstellung schlägt global

- **Datum:** 2026-07-19 (überarbeitet nach Nutzer-Feedback: Klick-Arten pro Link)
- **Status:** umgesetzt (siehe docs/superpowers/plans/2026-07-19-menu-link-open-settings.md)

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
2. Der Link-Editor erhält als Default die Option **„Globale
   Menü-Einstellungen verwenden"**.
3. Individuell heißt: **pro Klick-Art eine eigene Position** —
   Linksklick, Rechtsklick, Mausradklick. Die Linksklick-Zeile ist immer
   vorhanden, weitere Klick-Arten können hinzugefügt/entfernt werden.
4. **Alle Bestandslinks** verhalten sich nach dem Update wie „Globale
   Menü-Einstellungen verwenden" (egal, welche alten Positionswerte noch
   gespeichert sind).
5. Betrifft `openCustomUrl` **und** `searchLink`-Einträge in Menüs;
   ebenso Menü-Forks, eigene Gesten-Menüs und den Mini-Menü-Anhang
   (gleicher Codepfad).
6. So einfach wie möglich: eine Regel, keine Migration.

### Getroffene Entscheidungen (Nutzer, 2026-07-19)

- **Opt-in statt Migration.** Bestandsdaten werden nicht angefasst; ohne
  explizite Individual-Einstellung erbt der Link.
- **Klick-Arten einzeln belegbar** (statt einer Position für alle Tasten).
  Nicht belegte Klick-Arten erben weiterhin vom Menü bzw. global.

### Geprüft und verworfen: Zurück-/Vorwärts-Maustasten (Buttons 3/4)

Das Menü-Overlay nimmt nur `e.button <= 2` an (`js/context-menu.js`,
mouseup-Handler). Bei den X-Tasten löst Chrome die Browser-Navigation
(Zurück/Vorwärts) der Seite aus, die per JavaScript nicht unterdrückbar ist —
die Seite würde beim Klick wegnavigieren und das Menü mitreißen. Daher
bleiben es drei Klick-Arten: **links, Mausrad, rechts**.

## Lösung

### Präzedenz (neu, dreistufig, pro Klick-Art)

```
Link-individuell (ownOpen[klickArt]) → Menü-Override (openBehavior) → global (menuOpenBehavior)
```

### 1. Datenmodell

Menü-Items bekommen ein optionales Feld **`ownOpen`** — eine Map von
Klick-Art auf Öffnungs-Config:

```js
ownOpen: {
	left:   { position: 'last',      active: true  },   // immer vorhanden, wenn ownOpen existiert
	right:  { position: 'newWindow', active: true  },   // optional
	middle: { position: 'first',     active: false },   // optional
}
```

- `position`: `right | left | first | last | current | newWindow`
  (Default `last`), `active`: Default `true`.
- **Klick-Art konfiguriert** → diese Config gilt für diese Taste.
- **Klick-Art nicht konfiguriert** (oder `ownOpen` fehlt ganz) → Vererbung
  wie heute: Menü-Override bzw. global; „standard" = Linksklick selber Tab,
  Rechts-/Mittelklick neuer Tab rechts.
- `incognito` bleibt **item-weit** (eine Checkbox wie bisher) und wirkt
  unverändert immer.
- Das alte flache `position`/`active` am Item wird von der Menü-Auflösung
  **ignoriert** (nur `ownOpen` zählt). Damit ist Anforderung 4 per
  Konstruktion erfüllt — in `siteMenus.custom/edited`, Forks, eigenen
  Menüs und `menuAppend.items` gleichermaßen. Kein Migrationscode.
  (Im Gesten-/Chain-Kontext behalten `position`/`active` ihre bisherige
  Bedeutung; dort gibt es kein `ownOpen`.)

### 2. Auflösung als pure Funktion (`js/menu-model.js`)

Neue Funktion, exportiert im `FlowMouseMenuModel`-API:

```js
// Liefert { position, active } für einen Link-/Such-Eintrag im Menü.
// button: 0 = links (auch Tastatur/Enter), 1 = Mausrad, 2 = rechts.
function itemOpenConfig(item, menuBehavior, globalBehavior, button) {
	const key = button === 1 ? 'middle' : button === 2 ? 'right' : 'left';
	const own = item && item.ownOpen && item.ownOpen[key];
	if (own) return { position: own.position || 'last', active: own.active !== false };
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

Nur im Kontext `menu-item`, nur für `openCustomUrl` und `searchLink`.
Die bisherige Position-Zeile wird ersetzt durch:

- **Modus-Auswahl** (Dropdown): „Globale Menü-Einstellungen verwenden"
  (Default, `ownOpen` fehlt) | „Individuell pro Klick".
- Bei **Individuell**: Liste von Klick-Zeilen, je Zeile
  `[Klick-Art] [Position-Dropdown] [☑ Im Vordergrund]`:
  - Die Zeile **Linksklick** ist immer vorhanden (nicht entfernbar);
    beim Umschalten auf Individuell wird sie mit `position: 'last'`
    vorbelegt.
  - Buttons **„+ Rechtsklick"** / **„+ Mausradklick"** fügen die jeweilige
    Zeile hinzu (nur sichtbar, solange die Klick-Art fehlt); hinzugefügte
    Zeilen haben ein Entfernen-Icon.
  - „Im Vordergrund" wird pro Zeile ausgeblendet, wenn deren Position
    `current` ist (wie bisher).
- Wechsel zurück auf „Global" entfernt `ownOpen` komplett.
- Die **Inkognito-Checkbox** bleibt unverändert item-weit darunter.

Gesten-, Wheel-, Rocker- und Aktionsketten-Kontext: **unverändert** — dort
gibt es weiterhin die einfache Position-Zeile ohne Global-Option.

### 4. i18n

Neue Keys in `_locales/en` und `_locales/de` (übrige Locales fallen per
`default_locale` auf Englisch zurück):

- „Globale Menü-Einstellungen verwenden" / "Use global menu settings"
- „Individuell pro Klick" / "Custom per click"
- „Linksklick" / "Left click", „Rechtsklick" / "Right click",
  „Mausradklick" / "Middle click"
- „Klick-Art hinzufügen" (Tooltip/Buttons) / "Add click type"

### 5. Tests (`tests/menu-model.test.mjs`)

Vitest-Fälle für `itemOpenConfig`:

- ohne `ownOpen`, Verhalten „standard": Linksklick → `current`,
  Rechts-/Mausradklick → `right`, `active: true`.
- ohne `ownOpen`: Menü-Override `first` schlägt global `last`;
  ohne Override gilt global.
- `ownOpen.left` gesetzt, Rechtsklick nicht konfiguriert → Linksklick nutzt
  Item-Config, Rechtsklick erbt weiter vom Global-Verhalten.
- alle drei Klick-Arten konfiguriert → jede Taste liefert ihre eigene
  Position/active.
- altes flaches `position` am Item **ohne** `ownOpen` wird ignoriert.
- Defaults: Eintrag ohne `position` → `last`; `active`-Default `true`.

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
- Zurück-/Vorwärts-Maustasten (siehe oben — technisch nicht sauber möglich).
- Drag-Aktionen und deren Öffnungsverhalten.
