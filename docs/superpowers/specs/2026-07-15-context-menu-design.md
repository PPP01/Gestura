# Design: Kontextmenü-Feature (natives Rechtsklick-Menü erweitern)

**Datum:** 2026-07-15
**Status:** vom Nutzer freigegeben (Brainstorming abgeschlossen)

## Problem

Das **native** Browser-Kontextmenü (Rechtsklick) enthält von FlowMouse heute nur
den Blacklist-Umschalter „Disable gestures on this site" (`MENU_ID_BLACKLIST`,
via `enableBlacklistContextMenu`) sowie die Hinweis-Einträge Refresh/Restricted
(`showRestrictedNotice`). Das soll zu einem eigenständigen, in den Einstellungen
konfigurierbaren **Kontextmenü-Feature** ausgebaut werden — ähnlich wie Custom-
und Website-Menüs, aber im **nativen** Rechtsklick-Menü (kein In-Page-Overlay).

## Anforderungen (aus dem Brainstorming)

1. Eigener, ein-/ausschaltbarer Kontextmenü-Bereich mit zwei Ebenen im nativen
   Rechtsklick-Menü.
2. **Ebene 1:**
   - „Disable gestures on this site" (falls aktiviert) — bestehendes Verhalten.
   - „Add this site to menu" — fügt die aktuelle Seite bzw. den rechts-
     angeklickten Link als **Link-Eintrag** in ein Website-Menü der Seite ein.
     Passt genau ein Menü zur Seite → direkt; passt keins → Menü-Auswahl
     abfragen (in den Website-Menüs ein-/ausschaltbar, Default an).
   - „Options" — öffnet die Options-Seite.
3. **Website-Menü öffnen:** Ein Kontextmenü-Eintrag öffnet das **iframe-Overlay**
   des Website-Menüs (mit Icons, Theme, allen Eintragstypen) — als wäre es per
   Geste ausgelöst.

### Im Brainstorming getroffene Entscheidungen

| Frage | Entscheidung |
| --- | --- |
| Menü-Typ | **Natives Browser-Kontextmenü** (`chrome.contextMenus`). |
| „Add"-Wirkung | **Link-Eintrag** ins Menü **plus** Muster der Seite (falls fehlt). |
| Link-Quelle | Rechtsklick auf Link → dessen URL; sonst aktuelle Seite. |
| Zielmenü-Auswahl | Genau 1 Treffer → direkt; 0/mehrere → native Untermenü-Auswahl. |
| Titel | Nativ per Untermenü wählen, danach **optionaler In-Page-Titel-Prompt**. |
| Website-Menü | Öffnet das **iframe-Overlay** (kein nativer Nachbau), wie die `siteMenu`-Geste. |
| Welches Menü | **Einstellbar:** kontextabhängig **oder** festes Menü (Default kontextabhängig). |
| Settings-Ort | Neuer Nav-Bereich **„Kontextmenü"** (Ebene 1). |
| Master-Schalter | `enableContextMenu` im geplanten **Funktionen-Kasten**. |
| Unabhängige Teile | Restricted-Notice und „Disable gestures" laufen **auch bei aus** weiter. |
| Blacklist-/Notice-Toggle | Ziehen **in den neuen Bereich** um (nur sichtbar, wenn relevant). |
| Options-Eintrag | Neu auf Ebene 1 (`ctxMenuOptions`). |
| i18n | Entwicklung `en`+`de`; **Abschluss: vollständige Lokalisierung** (~40). |

## Nicht-Ziele (YAGNI)

- **Kein** nativer Nachbau des Website-Menüs im Kontextmenü — der Eintrag öffnet
  das vorhandene iframe-Overlay (voller Funktionsumfang, keine native
  Icon-/Styling-Limitierung).
- Keine eigenen Icons in den übrigen nativen Einträgen (technisch nicht möglich).
- Keine Migration — alle neuen Flags haben Default `true`.
- Kein Titel-Prompt auf Sonderseiten (PDF/interne Seiten) — dort still mit
  Default-Titel speichern.

## Übersicht: Einträge im Rechtsklick-Menü

```text
Rechtsklick-Menü (nativ)
  … Browser-eigene Einträge …
  Disable gestures on this site      ← enableBlacklist + enableBlacklistContextMenu   (unabhängig)
  Add this site to "<Name>"          ← genau 1 passendes Menü → direkter Eintrag
    ── ODER ──
  Add this site to menu          ▸   ← 0 / mehrere Menüs → Untermenü mit Menüliste
        ├ Website menu A
        ├ Website menu B
        └ …
  Website menu                       ← öffnet das iframe-Overlay (kontextabh. o. festes Menü)
  Options                            ← öffnet Options-Seite
  Restricted / Refresh Notice        ← showRestrictedNotice   (unabhängig)
```

## Flags & Sichtbarkeit

### Neue Flags (`DEFAULT_SETTINGS` in `js/constants.js`, alle Default `true`)

| Flag | Wirkung |
| --- | --- |
| `enableContextMenu` | Master des Kontextmenü-Features; erscheint im Funktionen-Kasten. Gilt **nur** für die neuen Teile (Add-to-menu, Website-Menü-Eintrag, Options). |
| `ctxMenuAddSite` | Eintrag „Add this site to menu" ein/aus. |
| `ctxMenuSiteMenu` | Eintrag „Website menu" (öffnet das Overlay) ein/aus. |
| `ctxMenuSiteMenuMode` | `'contextual'` (Default) oder `'standard'` — welches Menü der Eintrag öffnet. |
| `ctxMenuSiteMenuId` | Menü-ID für `mode: 'standard'` (sonst leer). |
| `ctxMenuOptions` | Eintrag „Options" ein/aus. |
| `siteMenuAddAsk` | Im **Website-Menüs**-Bereich: „Menü abfragen, wenn keins zur Seite passt" (Default an). |

Bestehende Flags unverändert: `enableBlacklistContextMenu`, `showRestrictedNotice`,
`enableBlacklist`, `enableSiteMenus`.

### Welcher native Eintrag hängt an welchem Flag

| Native Eintrag | Bedingung | `enableContextMenu`-abhängig? |
| --- | --- | --- |
| Disable gestures on this site | `enableBlacklist` && `enableBlacklistContextMenu` | **Nein** |
| Restricted / Refresh Notice | `showRestrictedNotice` | **Nein** |
| Add this site to menu | `enableContextMenu` && `ctxMenuAddSite` && `enableSiteMenus` | **Ja** |
| Website menu (öffnet Overlay) | `enableContextMenu` && `ctxMenuSiteMenu` && `enableSiteMenus` | **Ja** |
| Options | `enableContextMenu` && `ctxMenuOptions` | **Ja** |

**Wichtig:** Restricted-Notice und „Disable gestures" bleiben funktionsfähig,
auch wenn `enableContextMenu` aus ist.

## Settings-UI

Neuer Nav-Bereich **„Kontextmenü"** (`data-nav="contextMenu"`, Icon z. B.
`squareMenu`/`menu`). Er ist **immer sichtbar** (nicht durch `enableContextMenu`
ausgeblendet), weil er auch die unabhängigen Notice-/Blacklist-Schalter
beherbergt.

Reihen (`setting-row`) in dieser Reihenfolge:

1. `ctxMenuAddSite` — nur wirksam/sichtbar, wenn `enableContextMenu` &&
   `enableSiteMenus`; sonst ausgegraut mit Hinweis auf den Funktionen-Kasten.
2. `ctxMenuSiteMenu` — dito. Ist er an, erscheint darunter eine kleine Auswahl:
   Modus `contextual` / `standard` (Dropdown), und bei `standard` ein
   Menü-Dropdown (`ctxMenuSiteMenuId`) mit den aktiven Menüs — analog zur
   `gesture-menu-config`-Komponente.
3. `ctxMenuOptions` — nur wirksam/sichtbar, wenn `enableContextMenu`.
4. „Disable gestures on this site" (`enableBlacklistContextMenu`) — nur sichtbar,
   wenn `enableBlacklist` an. **Aus dem Blacklist-Bereich hierher verschoben.**
5. „Restricted Page Notice" (`showRestrictedNotice`) + die bestehende Detail-
   Klappbox (`#restricted-details`) — **aus dem „Sonstiges"-Bereich hierher
   verschoben** (inkl. `#restricted-notice`-Anker und Hash-Sprung-Logik).

Im **Website-Menüs**-Bereich kommt der Schalter `siteMenuAddAsk` hinzu
(„Beim Hinzufügen fragen, wenn kein Menü zur Seite passt").

Der Funktionen-Kasten (Design `2026-07-15-feature-toggles-design.md`) erhält
`enableContextMenu` als weiteren Toggle. Dieses Feature ist auch ohne den
Funktionen-Kasten lauffähig (Flag existiert eigenständig).

## Ablauf „Add this site to menu"

1. **URL bestimmen:** Rechtsklick auf Link → `info.linkUrl`; sonst `tab.url`.
   Titel-Default: Linktext (falls verfügbar) bzw. `tab.title`.
2. **Zielmenü bestimmen** (`resolveContextualMenuId` über aktive `siteMenus`):
   - **Genau 1** passendes Menü → direkter Eintrag „Add this site to \<Name>",
     ein Klick fügt hinzu.
   - **Kein** passendes Menü → wenn `siteMenuAddAsk` an: Untermenü listet alle
     aktiven Menüs; Klick wählt Ziel. Wenn `siteMenuAddAsk` aus: still ins
     exklusive Standard-Menü (`siteMenus.defaultMenuId`), falls gesetzt — sonst
     wird der Eintrag nicht angeboten.
   - **Mehrere** passende → immer Untermenü (Auswahl).
3. **Hinzufügen** (neue, testbare Model-Funktion
   `addLinkToMenu(catalog, siteMenus, menuId, { label, url })` in
   `js/menu-model.js`):
   - Erzeugt bei Katalog-Menüs die `edited`-Kopie (Muster wie `addPatternToMenu`)
     und hängt einen Link-Eintrag ans Ende:
     `{ id: 'item_<uuid>', action: 'openCustomUrl', customUrl: url, label, icon: 'link' }`.
   - Dublettenschutz: gleiche URL im Menü → kein zweiter Eintrag
     (Rückgabe `added: null`).
   - **Zusätzlich** das Muster der Seite (`siteToPattern(tab.url)`) via
     `addPatternToMenu`, falls es noch nicht passt — damit das Menü künftig auf
     der Seite erscheint. (Nur relevant im „kein Treffer"-Pfad; bei Treffer
     passt das Muster bereits.)
   - Speichern über `chrome.storage.sync.set({ siteMenus })`.
4. **Optionaler Titel-Prompt:** Nach Zielwahl schickt der SW eine Nachricht ans
   Content-Script → kleines In-Page-Overlay mit vorbelegtem Titel (editierbar;
   Bestätigen/Abbrechen). Bestätigen speichert mit angepasstem Titel; Abbrechen
   verwirft den ganzen Vorgang; kann die Seite keinen Prompt zeigen
   (PDF/interne Seite/kein Content-Script) → **still mit Default-Titel
   speichern**. Der Prompt greift v. a. im Auswahlpfad; bei genau einem Treffer
   bleibt es ein reiner Ein-Klick-Vorgang ohne Prompt.

## Website-Menü öffnen (iframe-Overlay)

Der Eintrag „Website menu" baut **kein** natives Untermenü, sondern öffnet das
bestehende iframe-Overlay — als wäre die `siteMenu`-Geste ausgeführt worden.
Damit bleiben Icons, Theme, alle Eintragstypen (Aktionen, Untermenüs, Suche),
Quick-Search-Append und das konfigurierte `menuOpenBehavior` erhalten.

- **Klick-Dispatch (SW):** `contextMenus.onClicked` für diese ID → Nachricht an
  das Content-Script des Tabs (gezielt an `info.frameId`, damit die Position
  zum rechtsgeklickten Frame passt) mit der aufzulösenden Menü-Konfiguration:
  - `ctxMenuSiteMenuMode === 'contextual'` → `{ mode: 'contextual' }`
    (Content-Script/`resolveMenu` wählt passendes Menü bzw. `defaultMenuId`).
  - `ctxMenuSiteMenuMode === 'standard'` → `{ mode: 'standard', menuId: ctxMenuSiteMenuId }`.
- **Content-Script:** neuer Nachrichten-Handler ruft **denselben Code-Pfad wie
  die `siteMenu`-Gesten-Aktion** auf und übergibt die Position als
  `cursor.endX/endY` (die Aktion öffnet mit `ctxMenu.prepare(endX, endY)`).
- **Position = Ort des Rechtsklicks** (wo das native Menü erschien):
  - Der bestehende `contextmenu`-Listener (`js/content.js:2484`) merkt sich die
    letzte Rechtsklick-Position (`e.clientX/e.clientY`) in einer Variablen.
  - Da der Klick gezielt an den rechtsgeklickten Frame (`info.frameId`) geht,
    passen die gemerkten Viewport-Koordinaten zu diesem Frame.
  - **Fallback** Viewport-Mitte, falls keine Position vorliegt (z. B.
    Kontextmenü per Tastatur geöffnet).
- Passt kein Menü und ist kein `defaultMenuId` gesetzt → No-op (wie die Geste).

## Laufzeit (Service Worker, `js/background.js`)

- Der SW importiert bereits `menu-patterns.js`, `menu-catalog.js`,
  `menu-model.js` (`importScripts` am Dateikopf) — die Auflösung ist verfügbar.
- Neue stabile Menü-IDs analog `MENU_ID_BLACKLIST`, z. B. Präfix
  `ctxmenu-add-*` (Add-Ziele), `MENU_ID_SITEMENU` (Website-Menü öffnen),
  `MENU_ID_OPTIONS`.
- **Aufbau & Aktualisierung:** Die neuen Einträge werden in `updateMenuForTab(tab)`
  (bei `tabs.onActivated`/`onUpdated`) neu gebaut — dort, wo heute schon
  `createBlacklistMenu`/Notices verwaltet werden. Die Einträge nutzen
  `contexts: ['page','link','image', …]`, damit beim Klick `info.linkUrl`
  (rechts­geklickter Link) verfügbar ist.
- **Re-Render-Trigger:** `storage.onChanged`-Listener um die neuen Flags
  (`enableContextMenu`, `ctxMenuAddSite`, `ctxMenuSiteMenu`, `ctxMenuOptions`,
  `siteMenuAddAsk`), `enableSiteMenus` und `siteMenus` erweitern.
- **Klick-Dispatch:** `contextMenus.onClicked`-Listener um die neuen IDs
  erweitern (Add-to-menu-Ziele, Website-Menü öffnen, Options).
- **Options öffnen:** vorhandene Logik aus dem `MENU_ID_RESTRICTED`-Zweig
  (Options-Tab finden/aktivieren oder neu öffnen) wiederverwenden.

## Content-Script (`js/content.js`)

- **Website-Menü öffnen:** neuer Nachrichten-Handler, der den vorhandenen
  `siteMenu`-Aktionspfad mit der übergebenen Menü-Konfiguration aufruft und das
  Overlay an der zuletzt gemerkten Zeigerposition öffnet. Dafür wird die
  `contextmenu`/`mousemove`-Position gemerkt (falls nicht schon vorhanden).
- **Titel-Prompt:** neuer Nachrichten-Handler, zeigt ein kleines Overlay
  (vorbelegter Titel, OK/Abbrechen) und antwortet mit `{ title }` bzw.
  `{ cancelled: true }`. Kein Prompt möglich → der SW nutzt seinen Timeout/
  Fallback und speichert still.

## Tests (vitest)

- **`menu-model`**: `addLinkToMenu`
  - Katalog-Menü → erzeugt `edited`-Kopie und hängt Link-Eintrag an.
  - Eigenes/`edited`-Menü → hängt an, ohne Katalog zu berühren.
  - Dublette (gleiche URL) → kein zweiter Eintrag (`added: null`).
  - Label/Icon korrekt gesetzt; stabile Item-ID erzeugt.
  - Zusammenspiel mit `addPatternToMenu` (Link **und** Muster).
- **Zielmenü-Auflösung** über die bestehende `resolveContextualMenuId`-
  Testinfrastruktur: 0 / 1 / mehrere Treffer.
- **`settings-defaults`**: neue Flags mit Default `true` prüfen.

## Risiken & bewusste Entscheidungen

- **Keine nativen Icons** — die nativen Menülisten (Add-Ziele) sind rein textuell;
  das Website-Menü selbst behält im Overlay volle Icons.
- **Titel-Prompt** nur auf normalen Seiten; sonst stiller Fallback.
- **Website-Menü** nutzt das iframe-Overlay → volle Funktion, aber kein Menü auf
  Seiten ohne Content-Script (PDF/interne Seiten) — dort No-op (wie die Geste).
- **Native Menü-Neuaufbauten** sind an Tab-Aktivierung/Update + Storage-Änderung
  gekoppelt (wie heute schon für Blacklist/Notice) — kein Live-Update pro
  Rechtsklick nötig.
- **Kein Migrationsbedarf** — alle neuen Flags Default `true`.

## Abschluss: Vollständige Lokalisierung

Während der Entwicklung werden neue i18n-Keys nur in `en` + `de` gepflegt
(Fork-Konvention). **Als Abschlussschritt — wenn das Feature funktioniert und
freigegeben ist — werden alle neuen Keys in sämtliche ausgelieferten Locales
(~40 Sprachen) übersetzt** (maschinell, `en` als `default_locale`-Fallback),
genau wie beim Website-Menü-Feature.

Neue Keys (Auswahl):
- Bereich: `contextMenuSection` / `contextMenuSectionDesc`.
- Toggles: `ctxMenuAddSite`(+Desc), `ctxMenuSiteMenu`(+Desc),
  `ctxMenuOptions`(+Desc), `siteMenuAddAsk`(+Desc).
- Modus-Auswahl Website-Menü: Labels für `contextual` / `standard`
  (bestehende Keys der `gesture-menu-config` wiederverwenden, falls vorhanden).
- Native Einträge: `menuAddSiteToMenu`, `menuAddSiteToNamed`
  (mit `{NAME}`-Platzhalter), `menuOpenSiteMenu` („Website menu"), `menuOptions`.
- Titel-Prompt: Titel/Platzhalter/OK/Abbrechen.

Wiederverwendet: `menuAddToBlacklist`, `menuRemoveFromBlacklist`,
`showRestrictedNotice`(+Desc), `siteMenusTitle`.
