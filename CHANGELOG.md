## Gestura Changelog

> Gestura is a fork of [FlowMouse](https://github.com/Hmily-LCG/FlowMouse). The
> history below includes the upstream FlowMouse changelog; Gestura's added
> features (configurable search engines, context-aware menus, image search) are
> the entries under v2.3.

### Unreleased

**New Features:**

- **Import several menus and engines at once:** the import dialog understands a
  `gesturaBundle` wrapper. Every entry is validated on its own and listed with its
  own checkbox, its own "replace the standard entry / add as new" choice and, for
  engines carrying a script, its own confirmation. A broken entry is shown with
  its reason and skipped — it no longer blocks the rest. The whole selection is
  written in a single save.
- **Sites on a split origin can hand over data:** a new inline hand-off lets a page
  fetch a payload itself and pass it to the extension after a trusted click
  (`data-gestura-inline` plus a `gestura:import` event). On this path the extension
  performs no request of its own, so no origin exception was needed — the existing
  same-origin link import is unchanged. See *For site operators* in the README.

**Fixes & Improvements:**

- **A menu can no longer be imported without the search engine it needs:** a menu
  item may point at an engine by id, and until now an id the user did not have
  simply vanished from the finished menu — no error, no gap, the entry was just
  missing. Such a menu is now refused with the name of the engine that is absent.
  Inside a bundle the check follows the selection: the menu is importable while
  its engine is selected alongside it, and is dropped again if that engine is
  unticked.

### v2.7.0 (2026-08-29)

Merged FlowMouse v2.3 and v2.3.1 (upstream sections below).

**New Features:**

- **Horizontal scroll gestures:** *Scroll Left*, *Scroll Right*, *Scroll to Left Edge* and *Scroll to Right Edge* join the existing vertical ones. Scroll targeting was rewritten around an axis table, so the cursor-under-element search now honors `overflow-x` for the horizontal actions.
- **Scroll animation duration:** every scroll action gained a *Duration* slider (50-1500 ms) that applies to the extension's own easing. The control is shown greyed out with an explanatory tooltip when the chosen smoothness resolves to the browser's native scrolling, which has no adjustable duration.

**Fixes & Improvements:**

- **Pages that would not scroll now do:** the scroll root fell back to `document.documentElement`, which reports no scroll room on sites that scroll the viewport itself. It is now `window`, with the metrics read per axis from the right source.
- **Website styles can no longer bleed into the HUD:** the gesture overlay's `z-index` moved out of the inline style into the shadow root's `:host` rule, `color-scheme` is pinned to `normal` and `::backdrop` is forced transparent.
- **The in-page menu opens on COEP-isolated sites** (e.g. SteamDB): the menu iframe declares `credentialless` when the embedding page is `crossOriginIsolated`. Its custom-CSS `localStorage` cache is skipped in that mode, because such a frame cannot persist it.
- **Ad blockers no longer trigger the HUD or cancel a selection:** synthetic scroll, wheel, mouseup and dragend events are ignored — only `isTrusted` events count.
- **The area-select batch warning can be switched off again:** a threshold of `0` was treated as "unset" and silently restored the default of 15.
- **The HUD stops showing custom action names** once custom gestures are disabled.
- **Window actions act on the window the gesture came from:** *Fullscreen*, *Maximize* and *Minimize* resolved the target via `windows.getCurrent()`, which is not necessarily the sender's window.
- **Bookmark folders survive a sync between devices:** a folder is now stored as `{ id, path }` instead of a bare ID, and resolved by path when the ID does not exist locally or points somewhere else. Chrome hands out different bookmark folder IDs per device, so *Add to bookmarks* and the bookmarks menu could end up writing to or reading from the wrong folder. The folder list is now built in the service worker (`getBookmarkFolders`) rather than in the options page.
- **Settings pages load faster:** `SettingsStore` became a class that starts loading on import, and the pages preload the module. Components await `settingsStore.waitForLoad()` instead of triggering the load themselves.
- **System search no longer collides with third-party New Tab extensions** (thanks to @realDGD upstream).
- **The area-select section gained an *Advanced* toggle:** the batch-warning threshold and the open delay moved behind it, matching the other settings sections. The modifier-key dropdown now also follows the stored value when it changes from elsewhere (an inline reset could leave the old entry showing).
- **Area select opens the whole batch even if you close the source tab:** the loop aborted as soon as the opener tab was gone, so the remaining links were silently dropped. It now keeps going without an opener.
- **The scroll-smoothness dropdown says what *Auto* resolves to** on this machine, e.g. *Auto (System)*.
- **Blacklist entries were restyled** as tags inside the component itself, with a tooltip on the delete button; their rules no longer live in `option.css`.
- Settings export no longer revokes its blob URL before the download starts; Korean text wraps on word boundaries.

**Gestura-side follow-up:**

- The pending-import path (an "Add to Gestura" link handed over from a website) appends its dialog straight into the options page's shadow root, bypassing the gate that holds back every other child. Since the store refactor a save throws while the initial load is still running, so that path now waits for the store first.

**Not adopted yet:**

- Upstream's reset behavior (`reset()` writing the defaults back, and the content script rebuilding `SETTINGS` from `DEFAULT_SETTINGS`) so a reset reaches open tabs — deferred for a separate look.

### v2.6 (2026-08-16)

**New Features:**

- **Set a website menu for the current page:** a new right-click entry, *"Set website menu for this page"*, stores the page as a URL **pattern** on a website menu, so that menu opens here from then on. Unlike "Add to a website menu", it adds no link entry — only the assignment. A dialog offers a **"Whole site"** switch — on by default, filling in `*www.amazon.de*` with the field locked. Switching it off swaps in the current page's pattern (path kept, query string and fragment dropped: `*www.amazon.de/dp/B0XYZ*`) and unlocks the field so you can trim it down to the section you actually mean. Toggleable in the "Context menu" settings section.
- **Change or clear an existing assignment:** once a page matches a menu, the entry becomes *"Assigned to: &lt;menu&gt;"* and opens a submenu listing every other menu (move the pattern there) plus *"Remove assignment"* (drop the matching patterns). No dialog on the move — the existing pattern is carried over unchanged.

**Fixes & Improvements:**

- **The "Website menus" settings section is split into two tabs:** the section opened with the menu-switcher, theme and mini-search-menu settings, so the actual list of menus started well below the fold — the settings you configure once buried the thing you come back to. The section now leads with a **"Menus" / "Settings"** tab bar (the same control the search-engine section uses for Text/Image). "Menus" holds the list, "Add menu" and the import bar; "Settings" groups the rest under **Appearance**, **Behavior** and **Adding sites**. "Ask which menu when none matches" moved into "Adding sites" and lost its section-level toggle switch — it only applies while adding a site, and looked like the section's master on/off switch. Nothing about the stored settings changed.
- **The entry flips to "Remove from menu ‹name›" once the page is in it:** adding the same page twice was silently impossible — `addLinkToMenu` deduplicates by URL, so the title dialog appeared, you typed a name, and nothing happened. The page entry now reads *"Remove from menu ‹name›"* whenever that page is already one of its entries, and removes it. Right-clicking a **link** still always offers "Add", because Chrome builds the context menu before it knows which link you clicked; if that link turns out to be in the menu already, a toast says so instead of opening a dialog that would discard your input.
- **The title dialog now always appears when adding a page:** "Add to menu ‹name›" skipped the "Title for the menu entry" prompt whenever the page already matched exactly that menu — the very case where you have curated the menu and most want to name the entry. The title is now always asked for; only the URL pattern is still skipped when the page already points at that menu.
- **In-page dialogs follow the theme:** the "Title for the menu entry" and pattern dialogs were hard-wired to a light palette and stayed white on a dark desktop. They now follow the same source as the website menus — the "Menu theme" setting, whose *auto* resolves to the browser/OS scheme — including `color-scheme`, so the native checkbox and text caret match too.
- **Stale right-click entries are gone:** the context menu could show leftovers from a previously visited page — most visibly a second, outdated "Add to menu ‹name›" above the current entries. The rebuild tracked its dynamically created entry IDs in service-worker memory, which is lost when the worker is suspended, and overlapping rebuilds from `tabs.onUpdated`/`onActivated` could interleave. The menu is now cleared wholesale before each rebuild, and only the most recent rebuild is allowed to finish.

### v2.5 (2026-07-20)

**New Features:**

- **Share menus and search engines:** any menu or search engine you've added or customized (your own, plus edited website menus and modified built-in engines) can be exported to a portable `.gestura-menu.json` / `.gestura-engine.json` file — named after the entry — and imported again from a file, from a URL, or from a website's own "Add to Gestura" link (`<a rel="gestura-menu">`, same-origin only). When an imported file matches a built-in menu or engine, the import dialog lets you choose whether to **replace the standard** (it then behaves like an edited/overridden entry) or **add it as a new** entry. Every import shows a preview of the entries and their target URLs before anything is added. Imported search engines that run a custom JavaScript transform display a security warning with the full script and a Chrome-only note, and must be explicitly acknowledged before import. This is the client-side foundation for the upcoming optional menu index.

**Fixes & Improvements:**

- **Per-link open settings work again — now per click type:** menu link entries (custom URLs and search entries) can opt into individual open positions per mouse button (left / middle / right), overriding the per-menu and global "Open links" behavior. The default for every link is "Use global menu settings"; existing links keep inheriting automatically. Unconfigured click types still follow the menu/global setting.
- **New "Open links" behavior:** added a reverse standard — left-click (and middle-click) opens a new tab to the right, right-click opens in the same tab — alongside the existing behaviors in the global and per-menu "Open links" dropdown.
- **Support section:** repaired broken links and split the Gestura and FlowMouse support boxes.

### v2.4 (2026-07-15)

**New Features:**

- **Native context menu:** a new, fully configurable feature in the browser's right-click menu. Add the current page — or a right-clicked link — to a website menu; open a website menu (contextual by site, or a fixed one) as the in-page overlay right where you clicked; or jump straight to the Options page. Every entry is individually toggleable via a master switch, with a dedicated **"Context menu"** settings section.
- **Add-to-menu flow:** "Add this site to menu" appends the page/link as a link entry to the matching website menu (and registers the site's URL pattern if needed); when no menu matches it offers a menu picker (optional) plus an in-page title prompt.
- **Feature toggles:** a master feature-toggle box at the top of the options page to enable or disable major features at a glance.

**Interface & General Improvements:**

- The "Disable gestures on this site" and restricted-page notice toggles moved into the new "Context menu" section.

### v2.3.1 (2026-07-15)

**New Features:**

- **"Open Settings" action:** a new gesture action opens the extension's settings page in a new tab. Assigned by default to the gesture right → down → left → up (`→↓←↑`).

### v2.3 (2026-07-14)

**New Features:**

- **Website menus:** predefined, fully editable menus for popular sites (GitHub, YouTube, Amazon incl. country selection, …) with icons; new settings section.
- **Search & Shopping menus:** two predefined search-engine menus — "Search" (Google, Brave, Perplexity, DuckDuckGo, Bing, DeepL, Wikipedia) and "Shopping" (Brave, Google, Amazon, eBay). Searches receive the current selection.
- **Default menu:** exactly one website menu can be marked as the default (exclusive toggle; "Search" out of the box) — it opens on all sites without a matching menu and is highlighted in the list (star + bold name).
- **Link opening behavior (advanced):** menu links and searches open per a global setting — standard (left-click same tab, right/middle-click new tab) or always in a new tab (right/left/end/start) — with an optional per-menu override.
- **Quick-search bar:** optional mini menu (default: Brave, Google, Perplexity; editable) appended to the bottom of every custom menu, with a per-menu opt-out.
- **Two menu actions:** "Website menus" opens the site menus (contextual by URL as the default, or a standard menu / customized standard menu that inherits updates for unchanged items); "Custom menu" is back to being the private per-gesture menu.
- Menu items support links, searches, and any gesture action, each with a selectable icon (Lucide set or favicon).
- **Breaking:** the old shared custom-menu pool was removed; gestures using it must be reconfigured.
- **Context-aware search menus:** Custom mouse menus can now contain search-engine entries from a built-in catalog (displayed with icons) alongside custom search/link items; menus carry site patterns so the same gesture automatically opens the right menu per site (contextual mode); a new "Add current site to menu" gesture appends `*hostname*` to a menu's patterns, making it quick to assign a menu to the site you're currently visiting.
  - **Editable Search Engines section:** The options page now has a top-level "Search Engines" section where you can add, edit, hide, reorder, and reset both built-in and custom search engines.
  - **Clipboard-open mode:** A new per-engine option copies the selected text to the clipboard and opens the page without a query parameter — useful for services like Gemini that do not accept a `?q=` URL.
  - **Custom JavaScript transform for search links:** Each search-link engine can now carry an optional JS snippet that receives the current `selection` (and optionally the `clipboard`) and returns the string substituted for `%s`. The snippet runs in an isolated sandbox with no access to the page or the extension, and can be tested against a sample input directly in the editor. An optional **"Replace default encoding"** toggle inserts the transform result verbatim into the URL, skipping `%s`, `+`, and slug encoding — useful when the function already returns a fully-formed URL component.
- Search-engine selection for text drag and the clipboard-search action now uses the central search-engine catalog, so your custom engines, hidden state, and ordering apply there too. Regional search engines (Baidu, Yandex, Naver, etc.) are included but hidden by default.
- Image search engines are now configurable in the "Search engines" page (Text/Image switch) — add custom reverse-image engines, reorder, hide, and give each an optional image-URL transform (e.g. thumbnail → original).

### FlowMouse v2.3.1 (2026-08-28)

- Optimized the loading speed of settings and other pages
- Optimized scrolling logic, fixing an issue where a few websites could not be scrolled
- Fixed an issue where the styles of a few websites might interfere with the extension's Shadow DOM
- Fixed default settings not syncing to open tabs after reset
- Fixed an issue where the Batch Operation Alert for Area Select could not be disabled
- Fixed an issue where third-party New Tab extensions might interfere with drag-to-search functionality (Thanks to @realDGD)
- Fixed an issue where bookmark features might fail after syncing settings due to inconsistent bookmark folder IDs across devices in Chrome
- Optimized HUD display logic to prevent false positives from third-party ad blocker extensions
- Fixed an issue where the HUD still showed custom action names after disabling custom gestures
- Other minor improvements


### FlowMouse v2.3 (2026-08-03)

**New Features:**
- New gestures:
  - Scroll Left
  - Scroll Right
  - Scroll to Left Edge
  - Scroll to Right Edge
- Support adjusting scroll animation duration

**Interface & General Improvements:**
- Fixed an issue where the popup menu failed to open on certain websites (e.g., SteamDB)
- Fixed an issue with incorrect color rendering in the popup menu on certain websites
- Minor improvements to settings interface
- Other minor improvements


### v2.2 (2026-06-29)

**New Features:**
- New gestures:
  - **Switch to Last Active Tab**
  - **Paste Custom Text**
  - URL Level Up
  - URL to Root
  - Invoke Another Extension
- Support opening in an Incognito/Private window for some gesture actions

**Interface & General Improvements:**
- Optimize performance when drawing gestures using custom CSS
- Other minor improvements


### v2.1 (2026-06-01)

**New Features:**
- Advanced Settings: Suppress drag gesture over input fields (Thanks to @xymoryn)
- New gesture action: Stop loading all tabs
- Support preserve tabs when closing other tabs (unload page content)
- Support opening pages in a new window

**Interface & General Improvements:**
- Auto theme mode now supports real-time switching with system theme (Thanks to @xymoryn)
- Fixed an issue in Zen browser where tab position might be incorrect when switching tabs
- Fixed an issue where the context menu might fail when gesture drawing is interrupted inside an iframe
- Fixed an issue where gesture trails might disappear when drawing gestures after refreshing certain pages
- Other minor improvements


### v2.0.3 (2026-05-07)

**New Features:**
- Gesture Prompts

**Interface & General Improvements:**
- Renamed advanced settings for clarity
- Other minor improvements


### v2.0.2 (2026-04-23)

- Fixed incorrect time display in the recently closed tabs popup menu on Firefox
- Fixed compatibility with Firefox 151+ beta versions
- Other minor improvements


### v2.0.1 (2026-04-22)

- Add Bookmark supports specifying a bookmark folder
- Avoid adding duplicate bookmarks for the same page
- Fixed an issue where the "Delay" command would disappear in command chain settings
- Fixed an issue that might affect using combinations like Control + Left Click to open the context menu on systems like macOS
- Improved area selection details and optimized compatibility within iframes


### v2.0 (2026-04-21)

**New Features:**
- **Area Select: Quickly select links on the page for batch operations**
- **Expert Mode: Custom CSS**
- Expert Mode: Customize HUD display names for gesture and drag actions
- **Redesigned the action settings window, simplify adding command chains**
- New gestures:
  - **Popup Menu**
    - Switch Tab
    - Show Recently Closed Tabs
    - Show Bookmarks
    - **Custom Menu**
  - **Zoom In / Zoom Out / Reset Zoom**
  - Copy Page Title and URL (Markdown optional)
  - Pause Gestures Until Refresh
  - Move Tab to New Window
  - Paste Clipboard
  - Search Clipboard
  - View Page Source
  - Save as MHTML
- New drag-and-drop actions:
  - Expert Mode: Send Custom Events
  - Link Dragging: Copy text and link (Markdown optional)
- **New mouse wheel gestures: Hold right-click and click the scroll wheel**
- Include gesture start points and additional data when sending custom events

**Gesture Improvements:**
- Left-click to cancel a gesture while drawing
- Custom URL supports placeholders (insert current page title and URL optionally)
- Improved scroll action logic to prioritize scrolling the element under the mouse

**Drag & Drop Improvements:**
- Improved HUD visuals when image dragging prioritizes opening links
- More features displayed by default outside of Expert Mode
- Fixed missing text when dragging from a Shadow DOM
- Expert Mode: Option to disable drag-and-drop inside input fields
- Fixed link dragging failing to trigger actions on certain pages
- Disable drag-and-drop on some pages that rely on drag-and-drop functionality to avoid interference

**Wheel Gesture Improvements:**
- Prevented the right-click menu from occasionally appearing after a wheel gesture

**Interface & General Improvements:**
- Optimized event binding for broader webpage compatibility
- Fixed gestures failing to work inside certain iframes
- Fixed operation hints not visible when drawing gestures in fullscreen mode on some pages
- Added explanatory notes for various features in settings
- Remove injected UI after gesture execution to improve compatibility
- Refined the design details of UI controls in the settings interface
- Support using gestures immediately after install/update without page refresh
- Other minor improvements


### v1.4.2 (2026-03-31)

- Relaxed the minimum version requirement for Firefox
- Optimized HUD display logic to improve compatibility with rich text editors like KindEditor


### v1.4 (2026-03-22)

**Gesture Improvements:**
- **Expert Mode: Support setting gesture trigger keys**: Right / Middle / Side / Stylus Right buttons
- Support keeping pinned tabs when closing tabs
- Simplified gesture icon display
- Refresh tab command supports hard reload (bypass cache)
- Support specifying tab position when opening a new tab or custom link

**Drag & Drop Improvements:**
- Improved HUD display when dragging text triggers automatic link recognition
- Improved drag type recognition logic
- Fixed an issue in Firefox where dragging an image inside a Shadow DOM might be incorrectly recognized as a link
- Fixed an issue where drag-and-drop did not work on certain websites

**Interface & More Improvements:**
- On-demand event binding to optimize compatibility with older web pages
- Fixed a settings sidebar bug for RTL languages
- Fixed an issue where gesture trail rendering stuttered on certain pages
- Other minor improvements


### v1.3 (2026-03-17)

**New Features:**
- **Added support for Firefox and Edge browsers**
- **Added mouse wheel gestures: Hold right mouse button and scroll up/down**
- **Added special gestures: Hold right mouse button and left-click / Hold left mouse button and right-click**
- **Expert Mode: Added command chains, allowing multiple actions to be executed in a single gesture**
- Support displaying the option to disable/enable gestures in the right-click context menu
- New color picker, supporting adjustments for gesture text/line opacity, blur, disabling shadows, etc.
- Expert Mode: Support adjusting gesture turning tolerance settings
- Added new gestures:
  - **Simulate Keystrokes**
  - Send Custom Events (Thanks to @g9wp)
  - Switch to First Tab / Switch to Last Tab
  - Pin/Unpin Current Tab
  - Close Window
  - Copy Page Title along with Current URL

**Gesture Improvements:**
- Support adjusting scroll distance and animation for each scroll gesture individually
- Optimized continuous scroll animations; support setting continuous scroll acceleration
- Gestures for switching to the left/right/first/last tab can now be configured to move the current tab instead
- New gesture action selection interface
- Support adjusting settings for certain gesture commands individually

**Drag & Drop Improvements:**
- **Dragging in the same direction supports executing multiple actions, such as multi-engine reverse image search / multi-engine search, etc.**
- **Support for custom drag-and-drop gestures**
- **Support opening pages in an Incognito/Private window when dragging**
- Support dragging to copy link text

**Interface & More Improvements:**
- **Brand new Logo design (Thanks to @Ps出来的小赵)**
- **Refactored code significantly to optimize performance and fix bugs**
- **New settings interface design**
- **Redesigned gesture recording process**
- Improved the design of the extension button popup
- Added reset buttons for specific options in the settings interface
- Improved language selection menu design
- Fixed an issue on macOS/Linux where gestures might affect the web page's right-click context menu
- Fixed an issue in Chrome where right-clicking on Bing web pages might break links
- Improved support for some third-party Android browsers
- Other minor improvements


### v1.2 (2026-02-10)

**New Features:**
- **Interactive tutorial displayed upon first installation**
- **Improved localization, supporting 39 languages**
- **Added prompts for pages with restricted gestures (can be partially disabled in settings)**
- Added new gestures:
    - Mute/Unmute Current Tab
    - Mute/Unmute All Tabs
    - Close Tab (Keep Window)
    - Close Tabs to the Left
    - Close Browser
    - Refresh All Tabs
- Gesture recognition uses a dynamic threshold algorithm to reduce misinterpretation
- Gesture trails use a smoothing algorithm for better visual experience
- Support for using gestures and drag-and-drop within the FlowMouse settings page
- Support for using ESC to interrupt gestures and drag-and-drop

**Gesture Improvements:**
- **Improved gesture experience on websites using iframes**
- Advanced Settings: Support for using system (high-performance) scroll animation; support for disabling animation
- Advanced Settings: Support adjusting gesture recognition trigger distance
- Fixed issue where scrolling gestures did not work on some websites
- Support searching with the browser's default search engine, and added more search engines

**Drag & Drop Improvements:**
- Optimized Super Drag: automatically cancel drag when the mouse leaves the window
- **Advanced Settings: Support prioritizing opening links when dragging text or images containing links**
- Advanced Settings: Support opening dragged targets in the current tab
- Fixed drag-and-drop issues on websites like Bilibili
- Fixed dragging of relative URL paths
- Fixed issue where drag-to-copy gestures failed on HTTP protocol pages
- Adapted for press-and-drag on touch screens and stylus pens

**Interface & More Improvements:**
- **New interface design for settings page; adjusted feature layout**
- **Clearer gesture arrow design**
- Optimized settings sync; supports syncing more settings (using "Export Configuration" is recommended for local backups)
- Reduced default permission requests; request permissions on demand when selecting "Save Image" or "Add Bookmark" gestures
- Fixed layout and font errors in gesture hint boxes on some websites
- Gesture hint boxes now use Shadow DOM to avoid interference from website styles
- Improved support for RTL languages
- Refactored code significantly to optimize performance and fix bugs
- Other minor improvements


### v1.1 (2025-12-24)

**Fixes & Optimizations:**
- **System Compatibility**: **Fixed right-click menu conflict on Mac and Linux; changed to double-click to call out the context menu to ensure mouse gestures work**.
    > Note: Due to macOS system characteristics, when dragging text, you must select the text, hold the left button briefly, and then drag; otherwise, the search may not trigger.
- **Default Experience Optimization**:
    - **Re-adjusted default gesture mapping to align with Edge browser, reducing the learning curve**.
    - New tab opening position changed from "Far Right" to **Right of Current Tab**.
    - Removed smooth scrolling animation for "Scroll to Top/Bottom" to significantly improve response speed.
- **Bug Fixes**:
    - Fixed issue where `localhost` domains could not be added to the blacklist.
    - Fixed issue where dragging left accidentally triggered "Create Split View," causing functionality failure.
- **Recognition Optimization**: Optimized gesture matching rules; gestures must strictly match the trajectory to respond, effectively preventing false positives.
- **Other**: Multiple detail experience optimizations.

**New Features:**
- **Global Switch**: Added a global "Enable/Disable" switch for **Mouse Gestures** (Super Drag is unaffected).
- **More Gesture Actions**: Added "Maximize/Restore Window", "Minimize Window", "Open Custom URL", "Copy Current URL", and other practical operations.
- **Advanced Settings** (Built for power users):
    - **Custom Scrolling**: Supports customizing scroll distance for "Scroll Up/Down" gestures.
    - **Visual Tweaks**: Supports enabling/disabling the display of the gesture trail origin point.
    - **Custom Gestures**: Supports drawing and adding custom mouse gestures (default supports 4-way combinations ↑↓←→).
    - **Super Drag Enhancements**:
        - Fully supports 4-way (↑↓←→) dragging and foreground/background opening settings for text, images, and links.
        - **Text**: Added "Copy Text".
        - **Images**: Added "Save Image", "Copy Image Address", "Custom Image Search".
        - **Links**: Added "Copy Link".