# Design: Switchable custom-menu header

**Date:** 2026-07-10
**Status:** Superseded by Revision 2 (see bottom); Revision 1 shipped in commits b22a5a0..4cde5a0

> **Revision 2 (2026-07-13)** reworks this feature after user feedback. Read the
> **Revision 2** section at the end of this document — it governs. The original
> Revision 1 design below is kept for history; where the two differ, Revision 2 wins.

## Summary

Each custom menu can optionally show a **header row** at the top of the in-page
menu. The header displays the current menu's name and, on click, opens an inline
dropdown listing every *other* custom menu. Choosing one swaps the menu content
in place. The switch is **ephemeral**: the next time the gesture is triggered,
the originally-configured (or dynamically-resolved) menu opens again.

Motivating use case: on a shopping page whose pattern normally resolves to the
"Shopping" menu, the user can quickly switch to "Standard" for that one open
menu without changing any configuration.

## Non-goals (YAGNI)

- No persistence of a manual switch (no per-site memory).
- No curating which menus appear in the dropdown — it always lists all other
  custom menus.
- No nested/submenu flyout; the switcher is a single inline dropdown.

## 1. Settings & options UI

- New optional per-menu flag `showHeader: boolean` stored in
  `SETTINGS.customMenus[id]`. Absent / `false` = no header (default).
- No change to the *shape* required in `DEFAULT_SETTINGS` — the flag is optional
  and read as falsy when absent. New menus created in `menu-panel.js`
  (`{ name, items: [], patterns: [] }`) do not need to set it.
- A toggle labelled **"Show header / menu switcher"** is added to the menu
  editor in `js/components/menu-panel.js`, near the existing name/patterns
  fields, writing via `#updateMenu(activeId, { showHeader })`.
- New i18n keys in `_locales/en/messages.json` (English message + description;
  other locales fall back to English until translated):
  - `menuShowHeader` — toggle label.
  - `menuShowHeaderHint` — one-line explanation.

## 2. Menu rendering: header + dropdown (`js/context-menu.js`)

- The render payload gains an optional `header` object:
  `{ name: string, menus: Array<{ id: string, name: string }> }`.
  - `name` = the currently-shown menu's display name.
  - `menus` = all custom menus **except** the current one, in definition
    (object-key) order. May be empty.
- When `header` is present, `fm-context-menu` renders a header row above the
  item list:
  - Current menu `name` plus a chevron indicator.
  - Clicking the header toggles an inline dropdown listing `header.menus`.
    Picking an entry sends a new message `ctxMenuSwitch { menuId, id }` (the
    target menu id) to the content script and closes the dropdown.
  - A separator divides the header/dropdown region from the items.
  - If `header.menus` is empty, the header renders as a plain title (no chevron,
    no dropdown).
- Keyboard: `Escape` closes an open dropdown first, then (if already closed)
  closes the menu. The header participates in arrow-key / Tab navigation like a
  menu item.
- Preview mode (menu editor) is unaffected: previews render **items only**, no
  header.

## 3. Switch & dynamic-resize data flow

### Item-building refactor
The custom-menu item construction currently inlined in the `executeAction`
`case 'customMenu'` (`js/content.js`, ~lines 3422-3472) is extracted into a
closure `buildCustomMenuItems(menuId)` defined inside that case, capturing
`cursor`, `startTarget`, and the menu selection text. It returns the serialized
item array with `onClick` closures. Both the initial open and a later switch
call this, so switched-in items behave identically to a freshly-opened menu.

### Registering the switcher
On open, the `customMenu` case:
1. Resolves the initial `menuId` (respecting `contextual` — see the earlier
   dynamic-menu fix).
2. If that menu has `showHeader`, computes the `header` object.
3. Registers the switch capability with the `ContentContextMenu` instance,
   e.g. `ctxMenu.setSwitcher({ header, rebuild: buildCustomMenuItems })`, and
   calls `ctxMenu.setItems(items)` as today. The header travels to the iframe as
   part of the `setItems` payload (both the `chrome.runtime` `ctxMenuSetItems`
   message and the direct `postMessage` `ctxItems` payload gain an optional
   `header` field).

### Handling a switch
When the iframe posts `ctxMenuSwitch { menuId, id }`, `ContentContextMenu`:
1. Verifies `menuId` matches the active menu (same capability-token check as
   existing messages).
2. Calls the registered `rebuild(id)` to get the new items.
3. Recomputes the header (`name` = new menu, `menus` = all others).
4. Re-runs `setItems(newItems)` with the new header. The iframe re-renders.

### Dynamic resize
Opening the dropdown or switching menus changes the rendered size. Today
`fm-context-menu` reports its size exactly once via a `#dimensionsSent`
one-shot latch, and the content script positions the fixed-size iframe once.

For menus **with a header**, this becomes repeatable:
- The iframe re-measures and re-sends `ctxMenuDimensions` whenever its layout
  changes (dropdown open/close, menu switch).
- The content script re-clamps width/height and repositions from the original
  anchor `(x, y)` on each `ctxMenuDimensions` for that menu, keeping the menu
  on-screen.

Menus **without a header** keep the existing one-shot path unchanged, to
minimise risk to the common case.

## 4. Edge cases

- **Single custom menu total:** header shows as a plain title; dropdown is
  omitted (empty `header.menus`).
- **Dynamic/contextual menu:** the URL-resolved menu opens; the header lets the
  user manually override to any other menu. The header `name` reflects the
  actually-shown menu, consistent with the gesture-HUD label fix.
- **Menu deleted while referenced:** `rebuild(id)` for a missing menu yields no
  items; treat as a no-op switch (keep current menu) rather than opening an
  empty menu.
- **Custom CSS:** header markup uses its own classes so users' existing custom
  CSS is unaffected; header styling ships with sensible defaults in the built-in
  styles.

## Testing

No runtime test harness exists for content-script closures or the Lit menu
iframe, so verification is manual (load unpacked, reload, exercise). Where pure
logic is extracted (e.g. computing the `header.menus` list = all menus minus
current, in order), add a small `.test.mjs` unit if the helper can be imported
without DOM. Existing `vitest` suite must continue to pass.

Manual verification checklist:
- Toggle `showHeader` on a menu; trigger its gesture → header with name appears.
- Header dropdown lists all other menus in order; current menu excluded.
- Switching swaps content in place; menu resizes/repositions to stay on-screen.
- Dropdown expansion beyond the initial size is not clipped (iframe grows).
- Next gesture trigger opens the originally-configured menu (ephemeral).
- Headerless menus behave exactly as before (one-shot sizing).

---

# Revision 2 (2026-07-13)

User feedback reshaped the feature. This section governs.

## Terminology (user-defined)

- **Custom Menu** — the whole system of all sub-menus (global settings level).
- **Untermenü / sub-menu** — one selectable menu, i.e. one `customMenus[id]`.
- **Menü-Auswahl / menu selection** — the switcher list in the header/footer.
- **Custom Menü-Ausgabe / menu output** — the popup rendered on the page (the iframe).

## Changes vs. Revision 1

1. **Global toggle, not per-sub-menu.** The "show switcher bar" setting moves from
   per-sub-menu (`customMenus[id].showHeader`, R1) to a single **global** setting on
   the Custom Menu as a whole. It exists exactly once.
2. **Header OR footer.** Instead of header-only, the bar's position is configurable
   (`header` | `footer`), also global, and only meaningful/enabled when the switcher
   is on.
3. **Per-sub-menu visibility in the selection.** Each sub-menu gets a
   `showInSwitcher` flag (default `true`) controlling whether it appears in the
   Menü-Auswahl. Only shown/editable when the global switcher is on.
4. **Colored bar.** The header/footer bar is visually offset with a subtle
   accent-tinted background (theme-aware, light + dark).
5. **Overlay, not push.** Expanding the Menü-Auswahl overlays the menu output
   (absolutely-positioned layer over the items) instead of growing the output.
   The output grows **only** when the selection needs more room than the current
   items provide (e.g. 2 items in the sub-menu but 10 entries in the selection).

## Data model

- **Global (new), sibling of `customMenus` in `DEFAULT_SETTINGS`:**
  `customMenuSwitcher: { enabled: false, position: 'header' }` — `position ∈ {'header','footer'}`.
- **Per sub-menu:** `customMenus[id].showInSwitcher: boolean` (default `true`).
- The R1 per-sub-menu `showHeader` flag is removed (and its two i18n keys
  `menuShowHeader` / `menuShowHeaderHint`).

## Options UI (`js/components/menu-panel.js`)

- **Top of the Custom Menu section** (above the sub-menu selector row): a global
  toggle "Show header/footer with menu switcher". When on, a **Header | Footer**
  segmented control selects `position`.
- **Per sub-menu** (near the Name field): a "Show in menu selection" checkbox
  bound to `showInSwitcher`, shown only when the global switcher is enabled.
- New i18n keys (en, others fall back): global toggle label + hint, position
  labels (Header / Footer), the per-sub-menu "show in selection" label.

## Menu output (`js/context-menu.js`)

- Render a bar as **header (top)** or **footer (bottom)** per `position`, with an
  accent-tinted background, showing the current sub-menu's name + a chevron.
- The Menü-Auswahl dropdown is an **absolutely-positioned overlay** over the items
  region: header → expands downward, footer → expands upward. The item list does
  not move.
- **Sizing:** closed → bar + items (as R1's headerless one-shot, but now with a
  bar). Open → report height = bar + `max(itemsHeight, selectionHeight)` and
  width = `max(itemsWidth, selectionWidth)`. So the output grows only when the
  selection is taller/wider than the items; otherwise it stays and the selection
  floats over the items. The repeatable-measure mechanism from R1 stays, extended
  to compute this max explicitly (an absolute overlay does not extend parent box).
- The selection lists all sub-menus with `showInSwitcher`, **excluding the current
  one**, in definition order. Switching is ephemeral and in-place (R1 behavior).
  Escape closes the open selection first, then the menu. Keyboard activation of a
  selection entry (the R1 final-fix) is preserved.

## Protocol / wiring

- The transport field `header` is renamed to **`switcher`** across content.js,
  background.js, and context-menu.js (it can now be a footer): shape
  `{ name, position, menus:[{id,name}] }` or `null`. Same three routes as R1
  (content → background session set/fetch → iframe; plus `ctxMenuSwitch` back).
- `content.js` `buildSwitcher(menuId)` returns `null` when
  `customMenuSwitcher.enabled` is false; otherwise the object above. The pure list
  logic (sub-menus with `showInSwitcher`, ≠ current, in order) is extracted to a
  new content-script helper **`js/menu-switcher.js`** exposing
  `buildSwitcherMenus(customMenus, currentId)` (attached to `window`/`globalThis`,
  added to `content_scripts` before `content.js`), and unit-tested with vitest.

## Testing

- Manual browser verification for UI/iframe/content (no harness), plus the vitest
  regression suite staying green.
- New: `tests/menu-switcher.test.mjs` covering `buildSwitcherMenus` (exclusion of
  current, `showInSwitcher` filter incl. default-true when the flag is absent,
  definition-order preservation, empty/edge inputs).

## Non-goals (unchanged from R1)

- No persistence of a manual switch; no per-site memory. The switcher list is not
  further curated beyond `showInSwitcher`. No nested/submenu flyout.
