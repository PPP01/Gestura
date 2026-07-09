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

Paste the following into the **"Notes to reviewer"** field when submitting a listed
version on AMO (the AMO Developer Hub, or via `web-ext sign` / `npm run ff:release`).

```text
Gestura is a mouse-gesture navigation extension: mouse gestures, super drag,
wheel/rocker gestures, area selection, and context-aware search menus. It is an
open-source fork of FlowMouse (GPL-3.0). Full source: https://github.com/PPP01/Gestura

NO REMOTE OR DYNAMICALLY-EVALUATED CODE
- No code is ever downloaded or executed from the network. All logic ships inside
  the package. No remote <script>, no hosted config, no eval of remote scripts.
- This Firefox build contains NO eval / no new Function at all. The optional
  "custom JS transform" feature (which runs user-authored code in an isolated
  sandbox) depends on the chrome.offscreen API, which Firefox lacks. It is
  therefore fully excluded from this build: the sandbox files are not packaged
  and the configuration UI is hidden.

NO DATA COLLECTION
- Gestura collects and transmits nothing (manifest data_collection_permissions:
  required = "none"). Settings are stored locally via storage / storage.sync only.
  Page content is processed on-device and never sent anywhere.

THIRD-PARTY CODE (only one minified file)
- js/lib/lit-all.min.js is the official, unmodified pre-built bundle of the Lit
  library (https://lit.dev, npm package "lit", BSD-3-Clause). It is shipped as
  distributed upstream; we did not minify it. See THIRD_PARTY_LICENSES.md.
- The One Euro Filter (BSD-3-Clause) is used for gesture smoothing; see
  THIRD_PARTY_LICENSES.md.
- All other JavaScript in the package is human-readable, unminified source. There
  is no build/bundler/preprocessor step; the repository is the extension.

WHY host_permissions "<all_urls>"
- Mouse gestures, super drag and the menus must work on every page the user visits,
  so the content scripts need to run on all sites. Access is used purely to detect
  gestures/drags locally; no page data leaves the browser.

PERMISSIONS
- tabs: create/close/switch/reopen/reorder tabs; read active tab URL/title for copy actions
- sessions: "reopen closed tab/window" gesture
- storage: save the user's gesture/menu/engine/appearance settings locally
- contextMenus: build the extension's menu entries
- search: hand a selected-text query to the user's chosen search engine
- scripting: inject gesture/drag detection where needed
- Optional, requested only when the matching feature is first used: bookmarks
  (bookmark gestures), clipboardRead (paste / clipboard-search actions),
  downloads (save image/file gestures).

HOW TO TEST
1. Load the add-on and open any regular web page.
2. Hold the right mouse button and drag left / right / up / down to trigger a
   gesture (e.g. right-then-left = Back). A gesture trail/HUD is shown.
3. Select some text, then drag it (super drag) to open the search menu; hover an
   entry to see it resolve.
4. Open Preferences (about:addons -> Gestura -> Preferences) to remap gestures and
   manage search engines.
```
