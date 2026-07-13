# Design: Dark/Bright-Mode für das Custom-Menu

- **Datum:** 2026-07-13
- **Branch:** `feature/custom-menu-theme` (abgezweigt von `feature/menu-switcher-header`)
- **Worktree:** `c:/Programme.alt/Gestura-worktrees/custom-menu-theme`

## Problem

Das in Seiten eingeblendete Custom-Menu wird unabhängig vom Erscheinungsbild
weiß dargestellt. Auf dunklen Seiten / bei dunklem Browser-Theme wirkt das
Menu wie ein Fremdkörper. Es gibt zwar bereits `@media (prefers-color-scheme:
dark)`-Regeln, doch der Nutzer möchte den Modus **explizit steuern** können,
statt sich allein auf das OS-Signal zu verlassen.

## Anforderungen (aus dem Brainstorming)

1. Eine **globale** Einstellung (nicht pro Menü) mit drei Werten: **Auto /
   Hell / Dunkel**.
2. **Auto** folgt dem **OS-/Browser-Theme** (`prefers-color-scheme`) — das
   heutige Verhalten.
3. **Hell** und **Dunkel** erzwingen das jeweilige Erscheinungsbild
   unabhängig vom OS und von der besuchten Seite.
4. Umsetzung isoliert in eigenem Branch/Ordner, ohne den aktuellen
   Arbeitsordner zu stören (bereits erledigt: Worktree).

## Nicht-Ziele (YAGNI)

- Kein Per-Menü-Theme.
- Keine Erkennung des Themes der besuchten Webseite.
- Die Live-Vorschau im Menü-Editor (`preview`-Modus des Lit-Components) bleibt
  unverändert und folgt weiterhin dem OS-Theme. Sie ist ein separater Kontext
  (Options-Seite mit eigenem Theme) und nicht Teil dieser Änderung.

## Architektur-Kontext

Das Custom-Menu besteht aus zwei getrennt gestylten Schichten:

1. **Frame-Wrapper** (`.fm-ctx-frame`) — Hintergrund, Schatten, Blur, Radius.
   Gestylt in `js/content.js` → `ContentContextMenu.generateStyles()`. Der
   Content-Script injiziert den Wrapper (ein `<iframe>`) in einen Shadow-Host
   der Seite.
2. **Menü-Inhalt** — Text, Hover, Separatoren, Header, Switch-Items. Gestylt
   im Lit-Component `js/context-menu.js` (`FmContextMenu`, `static styles`),
   der in `pages/context-menu.html` im iframe geladen wird.

Beide Schichten enthalten heute je einen `@media (prefers-color-scheme: dark)`
-Block. Diese werden durch ein attribut-/klassenbasiertes Muster ersetzt, das
alle drei Modi abbildet.

## Design

### 1. Setting — Single Source of Truth

Neuer globaler Key in `DEFAULT_SETTINGS` (`js/constants.js`):

```js
customMenuTheme: 'auto',   // 'auto' | 'light' | 'dark'
```

Wird — wie alle Settings — von beiden Zugriffspfaden über `DEFAULT_SETTINGS`
gelegt: `SettingsStore` (UI) und direktes `chrome.storage.sync` (Content-
Script). Kein Migrationsschritt nötig: fehlender Wert → `'auto'` (heutiges
Verhalten), also abwärtskompatibel.

### 2. UI — globales Segmented-Control

In `js/components/menu-panel.js`, im bestehenden globalen Bereich
`#renderSwitcherSettings()` (dort sitzt bereits die globale Switcher-
Einstellung). Ein Dreier-Segmented-Control **Auto / Hell / Dunkel** im
gleichen Button-Muster wie die vorhandenen Positions-Buttons
(`switcher-pos-btn`, Header/Footer).

- Gelesen über einen Getter analog `switcherSettings`:
  `SettingsStore.current.customMenuTheme || 'auto'`.
- Geschrieben über `SettingsStore.save({ customMenuTheme: value })`.
- Re-Render bei Store-Änderung: `'customMenuTheme'` zur bestehenden
  `onChange`-Prüfung in `connectedCallback` hinzufügen.

Neue i18n-Keys in `_locales/en/messages.json` und `_locales/de/messages.json`:

| Key                | en                 | de                 |
|--------------------|--------------------|--------------------|
| `menuThemeTitle`   | Appearance         | Erscheinungsbild   |
| `menuThemeAuto`    | Auto               | Automatisch        |
| `menuThemeLight`   | Light              | Hell               |
| `menuThemeDark`    | Dark               | Dunkel             |

Übrige Sprachen fallen automatisch auf `en` (`default_locale`) zurück.

### 3. Theme-Anwendung — einheitliches Muster in beiden Schichten

Statt reiner Media-Queries wird der aufgelöste Modus explizit als
Attribut/Klasse gesetzt. Muster (identisch in beiden Schichten):

- **Basis-CSS = hell** (unverändert bestehende Regeln).
- **Erzwungenes Dunkel:** neuer Selektor auf `dark`.
- **Auto:** Dark-Regeln gelten nur innerhalb `@media (prefers-color-scheme:
  dark)` **und** wenn der Modus `auto` ist.
- **Hell:** benötigt keinen eigenen Selektor (= Basis).

#### 3a. Menü-Inhalt (`js/context-menu.js`)

- `theme` wird als URL-Parameter (`?theme=…`) empfangen (siehe 4) und als
  Attribut `data-theme` am Host gesetzt (z. B. via `this.setAttribute` im
  Konstruktor/`connectedCallback`, nachdem der Wert aus der URL gelesen wurde).
- CSS-Umbau der bestehenden `@media (prefers-color-scheme: dark)`-Blöcke zu:

```css
/* erzwungenes Dunkel */
:host([data-theme="dark"]) .fm-ctx-menu { color: #e5e5e7; }
:host([data-theme="dark"]) .fm-ctx-item:hover,
:host([data-theme="dark"]) .fm-ctx-item:focus-visible { background: rgba(255,255,255,0.1); }
/* … analog: .fm-ctx-sep, .fm-ctx-header--switchable, .fm-ctx-switch-item … */

/* auto folgt dem OS */
@media (prefers-color-scheme: dark) {
    :host([data-theme="auto"]) .fm-ctx-menu { color: #e5e5e7; }
    /* … dieselben Regeln wie oben, gated auf [data-theme="auto"] … */
}
```

Zur Vermeidung von Duplikaten kann eine gemeinsame Selektorliste
(`:host([data-theme="dark"]), @media…:host([data-theme="auto"])`) genutzt
werden; final entscheidet Lesbarkeit im bestehenden Stil.

Der `preview`-Modus setzt kein `data-theme` (bzw. lässt es auf einem neutralen
Default) und behält damit das heutige OS-gesteuerte Verhalten.

#### 3b. Frame-Wrapper (`js/content.js`)

`generateStyles()` erhält den aufgelösten Modus (aus den Settings, siehe 4)
und emittiert die Frame-Regeln nach demselben Muster über eine Klasse am
`.fm-ctx-frame`-Element (z. B. `fm-theme-auto` | `fm-theme-dark`; hell = keine
Zusatzklasse):

```css
.fm-ctx-frame { background: rgba(255,255,255,0.92); /* + shadow/blur/radius */ }
.fm-ctx-frame.fm-theme-dark { background: rgba(30,30,32,0.95); }
@media (prefers-color-scheme: dark) {
    .fm-ctx-frame.fm-theme-auto { background: rgba(30,30,32,0.95); }
}
```

Die Klasse wird beim Erzeugen des iframes in `#createMenuIframe()` gesetzt.

### 4. Datenfluss

```
chrome.storage.sync (customMenuTheme)
        │
        ├─(Content-Script) content.js: chrome.storage.sync.get(null) → SETTINGS
        │        │
        │        └─ ctxMenu.updateSettings({ …, menuTheme: SETTINGS.customMenuTheme })
        │                 │
        │                 ├─ generateStyles() nutzt Theme → Frame-CSS/-Klasse
        │                 └─ #createMenuIframe(): URL-Param ?theme=<mode>
        │                          │
        │                          └─(iframe) context-menu.js liest ?theme → data-theme am Host
        │
        └─(UI) SettingsStore → menu-panel.js Segmented-Control (lesen/schreiben)
```

Konkrete Änderungspunkte in `content.js`:

- `ContentContextMenu.#settings` erhält Feld `menuTheme: 'auto'`.
- `updateSettings()`-Aufruf bei `ctxMenu.updateSettings({ lang, isRtl,
  customCss, menuTheme })` ergänzen (Stelle: heutiger Aufruf mit `lang, isRtl,
  customCss`).
- `generateStyles()` liest `this.#settings.menuTheme`.
- `#createMenuIframe()` setzt die Frame-Klasse und den URL-Param `theme`.

### 5. Live-Update-Verhalten

- **Options-UI:** Änderung schreibt sofort in den Store; neu geöffnete Menüs
  greifen den Wert beim nächsten `updateSettings`/Öffnen auf. Ein bereits
  offenes Menu muss nicht live umschalten (Menüs sind kurzlebig).
- **OS-Theme-Wechsel bei `auto`:** Wird durch die verbleibenden Media-Queries
  weiterhin automatisch berücksichtigt (CSS-getrieben, kein JS nötig).

## Betroffene Dateien

| Datei                              | Änderung                                            |
|------------------------------------|-----------------------------------------------------|
| `js/constants.js`                  | `customMenuTheme: 'auto'` in `DEFAULT_SETTINGS`     |
| `js/components/menu-panel.js`      | Segmented-Control + Getter + `onChange`             |
| `js/content.js`                    | `menuTheme` in Settings, `generateStyles`, iframe   |
| `js/context-menu.js`               | `theme`-URL lesen, `data-theme`, CSS-Umbau          |
| `_locales/en/messages.json`        | 4 neue Keys                                         |
| `_locales/de/messages.json`        | 4 neue Keys                                         |

## Tests / Verifikation

- **Unit:** `tests/settings-defaults.test.mjs` prüft `DEFAULT_SETTINGS`-Shape;
  ein Test ergänzen, dass `customMenuTheme === 'auto'` als Default vorhanden
  ist (folgt bestehendem Muster in der Datei).
- **Baseline:** `npm test` (Vitest, aktuell 126 grün) muss grün bleiben.
- **Manuell (im Browser, unpacked):**
  1. OS auf hell, Menu-Theme `auto` → Menu hell.
  2. OS auf dunkel, `auto` → Menu dunkel (Frame + Inhalt).
  3. `Hell` → Menu immer hell, auch bei dunklem OS.
  4. `Dunkel` → Menu immer dunkel, auch bei hellem OS.
  5. Auf dunkler und heller Webseite prüfen (Menu ignoriert Seiten-Theme).

## Risiken / offene Punkte

- Der Lit-Component nutzt `shadowRootOptions.mode = 'closed'`; `data-theme` am
  Host (dem Custom-Element im iframe-`document`) ist dennoch per CSS
  `:host([data-theme])` erreichbar — zu verifizieren beim Umbau.
- Sicherstellen, dass `custom-menu`-CSS des Nutzers (`customCss`) weiterhin
  Vorrang behält bzw. nicht durch die neuen Regeln gebrochen wird.
