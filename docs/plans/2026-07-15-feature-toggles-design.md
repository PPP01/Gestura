# Design: Master-Feature-Toggles (Funktionen-Kasten)

**Datum:** 2026-07-15
**Status:** Design (bereit für Implementierungsplan)

## Ziel

Ein neuer Kasten **ganz oben** auf der Options-Seite (vor „Appearance"/Style),
in dem sich acht Feature-Gruppen zentral ein- und ausschalten lassen. Ist eine
Gruppe ausgeschaltet, wird ihr Abschnitt auf der Options-Seite **ausgeblendet**
(inkl. Eintrag in der linken Icon-Navigation) **und die Funktion real
deaktiviert** (Laufzeit in `content.js`).

Im Standard ist alles eingeschaltet — **außer** Mouse Wheel Gestures und Special
Gestures, die (wie bisher) standardmäßig aus sind. Ihre inneren „Enable"-Schalter
entfallen; einziger Schalter ist der neue oben.

## Schalt-/Sichtbarkeitsmatrix

| Feature | Master-Flag | Default | Innerer Schalter | Laufzeit-Deaktivierung |
|---|---|---|---|---|
| Gestures | `enableGesture` *(existiert)* | `true` | **entfällt** (Basic-Abschnitt) | schon vorhanden |
| Drag Features | `enableDragFeatures` *(neu)* | `true` | Text/Bild/Link bleiben | `&&` in den 3 Drag-Checks |
| Area Select | `enableAreaSelect` *(neu)* | `true` | Modifier-Dropdown bleibt | `&&` in `isAreaSelectModifierEnabled` |
| Mouse Wheel | `enableWheelGestures` *(existiert)* | `false` | **entfällt** | schon vorhanden |
| Special | `enableSpecialGestures` *(existiert)* | `false` | **entfällt** | schon vorhanden |
| Search Engines | `enableSearchEngines` *(neu)* | `true` | – | **keine** (nur Konfig-Abschnitt ausblenden) |
| Website menus | `enableSiteMenus` *(neu)* | `true` | – | Site-/Custom-Menüs, Switcher & Append werden nicht gebaut |
| Website Blacklist | `enableBlacklist` *(neu)* | `true` | – | `isBlacklisted` erzwingt `false`; Blacklist-Kontextmenü aus |

**Architektur-Entscheidung (Approach A):** Für Gestures/Wheel/Special sind die
Master-Schalter direkt die bereits existierenden Flags — dadurch bleibt die
Laufzeit-Logik dieser drei unangetastet, es wird nur der innere UI-Schalter
entfernt. Für die restlichen fünf werden neue flache `enableX`-Booleans ergänzt
(konsistent mit dem bestehenden `DEFAULT_SETTINGS`-Stil). Alle neuen Flags haben
Default `true` ⇒ **keine Migration nötig**, Bestandsnutzer sehen unverändert
alles.

## Änderungen im Detail

### 1. `js/constants.js` — `DEFAULT_SETTINGS`
Fünf neue Flags ergänzen:
```js
enableDragFeatures: true,
enableAreaSelect: true,
enableSearchEngines: true,
enableSiteMenus: true,
enableBlacklist: true,
```
`enableGesture`, `enableWheelGestures`, `enableSpecialGestures` bleiben
unverändert (dienen als Master-Flags mit).

### 2. `js/components/options-page.js` — UI

**Neuer Abschnitt** als erstes Kind im `.container` (vor dem `style`-Abschnitt),
`data-nav="features"`, Titel `featuresSection` (en „Features" / de „Funktionen"),
Icon `power`. Acht `setting-row`-Toggle in der Reihenfolge:
Gestures, Drag Features, Area Select, Mouse Wheel Gestures, Special Gestures,
Search Engines, Website menus, Website Blacklist. Jeder Toggle bindet an sein
Master-Flag via `#updateSetting`.

**Sichtbarkeit bestehender Abschnitte:** Jeder betroffene `<div class="section" data-nav="…">`
wird nur gerendert, wenn sein Master-Flag `true` ist (konditionales Rendering im
`render()`). Betroffen: `basic` (→`enableGesture`), `drag` (→`enableDragFeatures`),
`areaSelect` (→`enableAreaSelect`), `wheel` (→`enableWheelGestures`),
`special` (→`enableSpecialGestures`), `searchEngines` (→`enableSearchEngines`),
`siteMenus` (→`enableSiteMenus`), `blacklist` (→`enableBlacklist`).
`style`, `other`, `data`, `support` sowie der neue `features`-Abschnitt sind
immer sichtbar.

**Innere Schalter entfernen:**
- `basic`-Abschnitt: die erste `setting-row` mit `#enableGesture`-Toggle entfällt
  (der Master oben ersetzt sie). Der Rest des Abschnitts wird ohnehin nur bei
  `enableGesture` gerendert.
- `wheel`-Abschnitt: die `first-row` mit `#enableWheelGestures`-Toggle entfällt;
  der `wheel-gesture-manager` wird direkt (immer offen) gerendert.
- `special`-Abschnitt: analog `#enableSpecialGestures`-Toggle entfällt.

**Navigation:** `#getSections()` filtert die zurückgegebene Liste nach den
Master-Flags (gleiche Bedingungen wie oben) und stellt `features` als erstes
Element voran.

### 3. `js/content.js` — Laufzeit

- **Drag:** in den drei Aktivierungs-Checks (`enableImageDrag`/`enableLinkDrag`/
  `enableTextDrag`, ~Z. 2857/2875/2896) je `SETTINGS.enableDragFeatures &&`
  voranstellen. Ebenso die abgeleitete `enableDrag`-Berechnung (Z. 2068/2189)
  mit `enableDragFeatures` UND-verknüpfen.
- **Area Select:** `isAreaSelectModifierEnabled` (Z. 2561) um
  `SETTINGS.enableAreaSelect &&` erweitern.
- **Blacklist:** nach dem Setzen von `isBlacklisted` (Z. ~1943, sowie die
  Re-Checks) erzwingen: bei `!SETTINGS.enableBlacklist` immer `isBlacklisted = false`.
  Am robustesten in `checkBlacklist()` selbst: `if (!SETTINGS.enableBlacklist) return false;`
  am Anfang. Das deaktiviert zugleich das „Zur Blacklist hinzufügen"-Kontextmenü
  (das an `enableBlacklistContextMenu` hängt — zusätzlich mit `enableBlacklist`
  UND-verknüpfen).
- **Website menus:** im `customMenu`/`siteMenu`-Case (~Z. 3495 ff.) bei
  `!SETTINGS.enableSiteMenus` das Bauen/Anzeigen der Site-/Custom-Menüs
  überspringen (Aktion wird zum No-op). Ebenso Switcher (`customMenuSwitcher`)
  und Append (`menuAppend`) nicht rendern.
- **Search Engines / Gestures / Wheel / Special:** keine Änderung.

### 4. i18n — `_locales/en/messages.json` + `_locales/de/messages.json`
Neue Keys (nur en + de, Fork-Konvention):
- `featuresSection` (en „Features" / de „Funktionen")
- `featuresSectionDesc` (kurze Beschreibung)
- je eine Titel/Beschreibungs-Zeile pro Toggle — wo möglich **bestehende Keys
  wiederverwenden** (`enableGesture`, `dragFeatures`, `areaSelectTitle`,
  `wheelGestures`, `specialGestures`, `sectionSearchEngines`, `siteMenusTitle`,
  `blacklist`). Nur fehlende Kurzbeschreibungen ergänzen.

## Bewusst offengelassen (YAGNI)

`distanceThreshold` / `gestureTurnTolerance` liegen im Basic-Abschnitt und werden
auch von Drag genutzt. Bei Gestures=aus + Drag=an sind sie nicht mehr einstellbar
(Default 20 bzw. 10 % greift weiter). Wird bewusst nicht verschoben.

## Tests

Fork hat vitest. Wenn eine passende Test-Datei für `DEFAULT_SETTINGS`/Settings
existiert, einen kleinen Test ergänzen, der die fünf neuen Default-Flags (`true`)
prüft. Sonst manuelle Verifikation über das Laden der Erweiterung.
