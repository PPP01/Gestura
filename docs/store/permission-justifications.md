# Gestura – Permission justifications (for store reviews)

Chrome Web Store and Edge Add-ons require a justification for each requested
permission. Copy the relevant text into the store dashboard's privacy/permissions
section. Keep it consistent with [PRIVACY.md](../../PRIVACY.md).

## Single purpose

> Gestura lets users control the browser with customizable mouse gestures, super
> drag, wheel/rocker gestures, area selection, and context-aware search menus. Its
> single purpose is fast, mouse-driven browser navigation and actions.

## Required permissions

| Permission | Why Gestura needs it |
|---|---|
| `tabs` | Gesture actions create, close, switch, reopen, and reorder tabs, and read the active tab's URL/title for copy actions. |
| `sessions` | The "reopen closed tab/window" gesture restores recently closed sessions. |
| `storage` | Stores the user's gesture/menu/engine/appearance settings locally (and via the browser's own sync if enabled). No remote storage. |
| `contextMenus` | Builds the extension's menu entries used by gesture/drag menus. |
| `search` | The "search selected text" actions hand the query to the user's chosen search engine. |
| `scripting` | Injects the gesture/drag detection logic into pages so gestures work where content scripts are needed. |
| `favicon` | Displays site/search-engine icons next to menu entries. |
| `offscreen` | Runs the isolated sandbox used to execute user-defined search-link JS transforms without page/extension access. |
| `host_permissions: <all_urls>` | Mouse gestures, super drag, and menus must work on **every** site the user visits. Page content is processed locally and never transmitted. |

## Optional permissions (requested on demand, only when a feature is used)

| Permission | Triggered by |
|---|---|
| `bookmarks` | Gestures that add/manage bookmarks. |
| `clipboardRead` | "Paste"/clipboard-search actions that read the clipboard. |
| `downloads` | Gestures/drag actions that save an image or file. |
| `pageCapture` | The "save page as MHTML" action. |

## Data usage disclosures (Chrome "Privacy practices" tab)

- Does the item collect user data? **No.**
- Sold to third parties? **No.**
- Used/transferred for purposes unrelated to core functionality? **No.**
- Used/transferred to determine creditworthiness / lending? **No.**
- Privacy policy URL: link to the hosted `PRIVACY.md` (e.g. GitHub Pages or the
  raw file URL on `github.com/PPP01/Gestura`).

---

## Firefox / AMO (addons.mozilla.org)

The Firefox build ships **fewer** permissions than Chrome/Edge. Its `manifest.json`
requests only `tabs`, `sessions`, `storage`, `contextMenus`, `search`, `scripting`
(plus optional `bookmarks`, `clipboardRead`, `downloads`) and `host_permissions:
<all_urls>`. It does **not** request `favicon`, `offscreen` or `pageCapture` — those
Chrome-only APIs are absent on Firefox, so the JS-transform sandbox (offscreen) and
"save page as MHTML" (pageCapture) features are not part of this build, and favicons
are resolved without the `favicon` permission.

Paste the following into AMO's **"Notes to reviewer" / Whiteboard** field when
submitting a listed version (the AMO Developer Hub, or via `web-ext sign` /
`npm run ff:release`).

**The AMO whiteboard is plain text** — it does not render Markdown or HTML and
collapses formatting, so the block below is written as flowing prose with blank
lines between sections. **Do not add angle brackets** (e.g. `<all_urls>` or an HTML
tag): AMO's field rejects them. The version below is already bracket-free.

```text
Gestura is a mouse-gesture navigation extension (mouse gestures, super drag, wheel/rocker gestures, area selection, and context-aware search menus). It is an open-source fork of FlowMouse, licensed GPL-3.0. Full source: https://github.com/PPP01/Gestura

No remote or dynamically-evaluated code. Nothing is ever downloaded or executed from the network; all logic ships inside the package (no remote scripts, no hosted config, no eval of remote code). This Firefox build contains no eval and no "new Function" at all. The optional custom-JS-transform feature (which would run user-authored code in an isolated sandbox) relies on the chrome.offscreen API, which Firefox lacks, so it is fully excluded from this build: its sandbox files are not packaged and its configuration UI is hidden.

No data collection. The add-on collects and transmits nothing (manifest data_collection_permissions required = none). Settings are stored locally via storage / storage.sync only, and page content is processed on-device and never sent anywhere.

Third-party code. The only minified file is js/lib/lit-all.min.js, the official unmodified pre-built bundle of the Lit library (lit.dev, npm package "lit", BSD-3-Clause), shipped as distributed upstream and not minified by us. The One Euro Filter (BSD-3-Clause) is used for gesture smoothing. Everything else is human-readable, unminified source; there is no build/bundler/preprocessor step, so the repository is the extension. See THIRD_PARTY_LICENSES.md.

Host permission for all sites (all_urls). Mouse gestures, super drag and the menus must work on every page the user visits, so the content scripts run on all sites. This access is used purely to detect gestures and drags locally; no page data ever leaves the browser.

Permissions: tabs (create, close, switch, reopen and reorder tabs, and read the active tab URL/title for copy actions); sessions (the reopen-closed-tab/window gesture); storage (save the gesture, menu, engine and appearance settings locally); contextMenus (build the extension's menu entries); search (send a selected-text query to the user's chosen search engine); scripting (inject the gesture/drag detection). Optional permissions, requested only when the matching feature is first used: bookmarks (bookmark gestures), clipboardRead (paste and clipboard-search actions), and downloads (save image/file gestures).

How to test: 1) Load the add-on and open any regular web page. 2) Hold the right mouse button and drag left, right, up or down to trigger a gesture (for example right then left = Back); a gesture trail/HUD appears. 3) Select some text and drag it (super drag) to open the search menu, then hover an entry to see it resolve. 4) Open Preferences (about:addons, then Gestura, then Preferences) to remap gestures and manage search engines.
```
