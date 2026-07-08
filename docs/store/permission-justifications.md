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
