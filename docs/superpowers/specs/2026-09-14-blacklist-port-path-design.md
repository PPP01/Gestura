# Design: a blacklist entry that can name a port and a path

- **Date:** 2026-09-14
- **Status:** approved by the user (brainstorming completed)
- **Issue:** [#6](https://github.com/PPP01/Gestura/issues/6)
- **Leaves out, on purpose, with a ticket each:**
  [#7](https://github.com/PPP01/Gestura/issues/7) — a path entry reaching into
  the page's iframes; [#8](https://github.com/PPP01/Gestura/issues/8) — a quick
  toggle that can choose page, port or domain. Section 11 says why.

## 1 · Goal and occasion

A blacklist entry can only name a host. `#addDomain()` in
`js/components/blacklist-manager.js` runs the input through `new URL()` and keeps
`url.hostname` alone, so `localhost:3000` is stored as `localhost`, and
`http://localhost:3001/galaxy-patrol.html` is stored as `localhost` too. Nothing
is said about it; the entry simply comes out broader than what was typed.

The occasion is a game at `http://localhost:3001/galaxy-patrol.html` that uses the
right mouse button as a game control. Today the only way to silence gestures there
is to blacklist `localhost` outright, which takes them away from every other local
development site at the same time.

Reached when:

- an entry can carry a port, a path, or both, and means exactly that;
- an entry that names only a host keeps meaning precisely what it means today —
  the whole host — with no migration and no change a user could notice;
- one matcher answers the question, and the four places that ask it use it;
- a path entry keeps working when a single-page app changes its route without
  reloading the document.

**Non-goal:** wildcards, regular expressions, or any syntax to learn. Section 3
says why the pattern system the project already has is not the right tool here.

## 2 · The rule

An entry is canonically `host[:port][/path]` — lowercase, no scheme, no query, no
fragment, no trailing slash.

An entry matches a URL when all three hold:

1. **Host** is exactly equal.
2. **Port**: if the entry names one, the URL's `port` must equal it. If the entry
   names none, the port does not participate.
3. **Path**: if the entry names one, the URL's `pathname` must equal it or begin
   with it followed by `/`. If the entry names none, the path does not
   participate.

Query and fragment never participate.

| entry | matches | does not match |
|---|---|---|
| `localhost` | every port, every path on the host | `127.0.0.1` |
| `localhost:3000` | everything on that port | `localhost:8080/app` |
| `localhost:3001/galaxy-patrol.html` | that page, `?x=1` and `#top` included | `…/galaxy-patrol.html.bak` |
| `localhost:3001/games` | `/games`, `/games/pong` | `/gameszone` |

The path comparison breaking at `/` is what keeps `/games` from swallowing
`/gameszone`. It is also the reason the rule needs no syntax: the boundary is a
property of paths, not something the user has to mark.

**The scheme is ignored.** `http` and `https` match alike — asking a user to tell
them apart would mean two entries for one page, for no benefit anyone has named.

**Only explicit ports are compared.** `new URL('https://example.com').port` is the
empty string, so an entry `example.com:443` matches nothing. This is the price of
ignoring the scheme: knowing that 443 is the default for https means knowing the
scheme. Nobody writes a default port into a blacklist by hand, and an entry meant
to cover the whole host is written `example.com` anyway.

### A trailing slash is not available as a marker

Using `localhost:3000/` for "this page only" was considered and rejected.
`localhost:3000` and `localhost:3000/` are *the same URL* to the parser — both
have `pathname === "/"` and the same `href` — so the distinction lives only in the
raw input string and survives no round trip through the URL API. It would also be
invisible in the tag list, one character apart for opposite meanings, in a feature
whose failure mode is silent.

What the rule therefore cannot express is "the front page but not what is below
it". No use for that has come up. If one does, an explicit `localhost:3000/*` for
"everything below" can be added later without changing anything decided here.

## 3 · Why not the pattern system that already exists

`js/menu-patterns.js` and `matchesPatterns` (`js/search-url.js:48`) already match
URLs for website menus, with `*` wildcards. They are the wrong tool here, for two
reasons.

`patternToRegExp` builds an **unanchored** regular expression: `*hostname*`
becomes `/.*hostname.*/i` and is tested against the whole URL. A blacklist entry
built that way would match anywhere in the string — `evil.com/?ref=localhost:3000`
would match an entry meant for a local dev server. For a website menu a loose
match offers a menu that was not wanted; for the blacklist it silently removes
gestures from an unrelated site.

And the stored entries are bare hostnames today. Turning them into patterns means
either a migration or a special case that reads a pattern-less string as an
implicit host match — work in exchange for a syntax the user did not ask for and
the decided rule does not need.

The two systems stay separate. This is worth stating because from a distance they
look like the same problem.

## 4 · One matcher, four callers

The blacklist is consulted in four places, each with its own
`blacklist.includes(hostname)`:

| place | asks |
|---|---|
| `js/content.js:2095` `checkBlacklist()` | should this frame have gestures |
| `js/components/popup-page.js:362` | is the current tab blocked, and may the switch act |
| `js/background.js:1982` | should the context menu offer to unblock |
| `js/background.js:2175` | the context menu's toggle |

Four exact-string comparisons are four correct implementations of "is this host in
the list". Four *prefix* matchers would be four chances to drift. So the rule lives
in one file.

### `js/blacklist-match.js`

A classic script in the shape of `js/menu-patterns.js` — an IIFE that hangs an
object on the global and also exports through `module.exports` so the tests can
import it. Named `GesturaBlacklist`, following the newer files
(`GesturaSettingsStorage`, `GesturaEuLocal`); the inherited `FlowMouse*` names stay
as they are.

```
normalize(input)            -> canonical entry string, or null if unusable
parse(entry)                -> { host, port, path } or null
matches(url, entry)         -> boolean
matchingEntry(url, entries) -> the entry that matches, or null
pathMatches(pathname, path) -> boolean
```

`matchingEntry` returns the entry rather than a boolean because the popup and the
context menu need to know *which* entry blocks the page — section 7 turns that
into the difference between an actionable switch and a locked one.

`pathMatches` is exported because the hot path in section 5 needs it without
re-parsing a URL, and because it is where the `/games` vs `/gameszone` boundary
lives and therefore wants tests of its own.

**Registration in three lists.** A classic script the content scripts need is
registered in `content_scripts` in `manifest.json`, in `importScripts` in
`js/background.js`, and in `background.scripts` in the Firefox manifest on the
`firefox-build` branch. `tests/load-order.test.mjs` enforces all three; a missing
entry surfaces at runtime as `GesturaBlacklist is not defined` at `document_start`
in every frame. It must load before `js/content.js`.

## 5 · Static and live: where host, port and path part ways

A host and a port are fixed for the life of a document. A path is not — a
single-page app changes its route through the History API without reloading
anything. That difference, not the matching, is the only structural change here.

**Host and port entries keep today's arrangement exactly.** They are decided once,
from `location` and from the outermost entry of `location.ancestorOrigins` (an
origin carries scheme, host and port, so this keeps working unchanged), and when
one matches, `initGestures()` is never called. Nothing is attached to a page whose
gestures are off for good.

**Path entries are decided per gesture.** `isGestureEnabled()` and its three
siblings (`js/content.js:2591-2594`) are already evaluated on every gesture, so a
check placed there follows navigation for free — no `popstate` listener, no
monkey-patching of `history.pushState`, no `webNavigation` permission, and it
works in both directions when the app routes into a blocked path and back out.

The cost is that the listeners must exist on a page a path entry currently blocks,
because the route may change. The check is kept to nothing in the common case by
precomputing, at settings load, only those path entries whose host and port match
*this* document:

```js
let originBlocked = false;      // host/port/ancestor — today's isBlacklisted
let livePathEntries = [];       // parsed entries with a path, host+port already matched

function blockedNow() {
	if (originBlocked) return true;
	if (livePathEntries.length === 0) return false;
	const p = location.pathname;
	return livePathEntries.some(e => GesturaBlacklist.pathMatches(p, e.path));
}
```

For every page without a path entry on its host, that is one `length === 0` per
gesture. `livePathEntries` is recomputed in the `onChanged` handler that already
watches `blacklist` and `enableBlacklist` (`js/content.js:2121`).

`initGestures()` runs whenever `originBlocked` is false, *including* when a path
entry matches at load time — otherwise routing away from the blocked path could
never restore gestures.

**Every guard that reads `isBlacklisted` today must read `blockedNow()`.** They
are: the four `isXEnabled` lambdas (`:2591-2594`), the `contextmenu` guard
(`:2784`), and the `openSiteMenuOverlay` check (`:2418`). The assignments that set
`isBlacklisted = true` as a hard stop — `pauseGesture` (`:2512`), the dispose event
(`:2609`), the invalid-context path (`:2625`) — keep their meaning by setting
`originBlocked`, which `blockedNow()` honours first.

## 6 · Input and display

`#addDomain()` (`js/components/blacklist-manager.js:139`) calls `normalize()` and
stores what comes back.

`normalize` prefixes `https://` when the input has no `://`, parses, and rebuilds
`hostname + (port && ':' + port) + path`, where `path` is `pathname` with trailing
slashes stripped and `/` alone treated as no path at all. A parse failure yields
`null`.

The existing host plausibility check stays — `if (!domain.includes('.') && domain
!== 'localhost')` rejects a hostname with no dot — but it now runs against the
host part only, so `localhost:3000` and `localhost:3001/galaxy-patrol.html` pass
while a typo like `lcoalhost` still does not. Without it every mistyped word would
become a silent entry that blocks nothing.

The tag shows the canonical form: typing `http://localhost:3001/galaxy-patrol.html`
produces `localhost:3001/galaxy-patrol.html`. The duplicate check compares
canonical forms, so the same page entered two ways is caught.

## 7 · The quick toggle stays host-wide

The popup switch and its context-menu twin keep writing and removing the bare
hostname. They read `matchingEntry(url, list)` and act on what it returns:

| `matchingEntry` | switch | acting on it |
|---|---|---|
| `null` | off, enabled | adds the hostname |
| the hostname itself | on, enabled | removes it |
| anything else | on, **disabled**, names the entry | — |

The third row is the new one. Taking the block off every page under a path because
the user wanted it off this one is worse than asking them to walk one screen
further, so the switch declines and says which entry is responsible. The context
menu says the same with `enabled: false` on its item.

This is a deliberate floor, not the finished shape —
[#8](https://github.com/PPP01/Gestura/issues/8) carries the three-way choice that
would let the quick path create a fine entry.

## 8 · i18n

One new string: the note naming the entry that blocks the page, used by both the
popup and the context-menu item.

**It must use `{entry}` and `.replace()`, never `$ENTRY$`.** An undeclared
`$WORD$` makes `chrome.i18n` read a placeholder that is not declared and the
extension fails to load entirely; `tests/locale-placeholders.test.mjs` guards it.

`blacklist` is not in `NEW_KEY_PREFIXES` in `tests/site-menu-locales.test.mjs`, so
a new `blacklist*` key would have to land in all 39 locales at once. Add
`blacklist` to that list and the new key to `PENDING_TRANSLATION`: that is the
mechanism the project already has for a string that ships in `en` and `de` first,
and CLAUDE.md names `PENDING_TRANSLATION` the release checklist, so the key cannot
quietly stay untranslated. The existing `blacklist*` keys are already in all 39
locales and stay green when the prefix is added.

Two existing strings change wording in `en` and `de` by hand, because they now
describe something wider — `blacklistPlaceholder` ("Enter domain, e.g.
example.com…") and `invalidDomain`. No test catches a changed wording in the other
37 locales; they are named here so the release notices them.

## 9 · Storage shape, and why there is no migration

`blacklist` stays `string[]`. It is `set` in `MERGE_MAP`
(`js/settings-merge.js:114`) and `[]` in `DEFAULT_SETTINGS`
(`js/constants.js:295`); a set merge over strings keeps working as long as the
entries stay strings. Objects would mean a new merge kind, a schema change and a
migration, for something the string form expresses exactly.

No migration is needed in the other direction either: an existing entry is a bare
hostname, and by section 2 a bare hostname matches every port and every path on
that host — which is what it does today.

## 10 · Tests

**`tests/blacklist-match.test.mjs`** (new), against `js/blacklist-match.js`:

- `normalize`: scheme stripped, case folded, trailing slash dropped, `/` alone is
  no path, query and fragment dropped, junk yields `null`, and
  `normalize(normalize(x)) === normalize(x)`.
- `matches`: the four rows of section 2's table, both ways.
- the boundary: `/games` matches `/games` and `/games/pong`, not `/gameszone` and
  not `/gam`.
- a bare hostname matches every port and path — the compatibility guarantee.
- `example.com:443` does not match `https://example.com`, so the simplification of
  section 2 is pinned rather than rediscovered later.
- `matchingEntry` returns the entry, and with several candidates returns one that
  genuinely matches.

**`tests/load-order.test.mjs`** gains `js/blacklist-match.js` in the three lists.

**`tests/site-menu-locales.test.mjs`** exercises the new prefix through its
existing assertions once `blacklist` is added.

`blockedNow()` and the popup switch are not unit-tested: they live in files with no
test harness (`js/content.js` is one long IIFE, and the components need a DOM).
That is the existing shape of the suite, not a gap this design introduces — and it
is why the whole rule was put in a file that *can* be tested.

## 11 · Explicitly not done

- **A path entry does not reach into the page's iframes** —
  [#7](https://github.com/PPP01/Gestura/issues/7). `ancestorOrigins` yields
  origins without a path, so this needs the worker as a detour, and a way back out
  of a teardown that today is one-way. Host and port entries silence frames
  exactly as before.
- **The quick toggle cannot create a fine entry** —
  [#8](https://github.com/PPP01/Gestura/issues/8).
- **No wildcards.** Section 2.
- **`version_name`, releases, the Firefox branch** — untouched, except that
  `js/blacklist-match.js` must be added to `background.scripts` when this merges
  into `firefox-build`.

## 12 · Decomposition for the plan phase

1. `js/blacklist-match.js` with its tests, registered in the three load-order
   lists. Nothing calls it yet; the suite is green.
2. `#addDomain()` and the tag rendering move to `normalize`. Entries can now be
   created with a port and a path; nothing matches them yet, which is visible and
   harmless.
3. `content.js`: `originBlocked` / `livePathEntries` / `blockedNow()`, and the six
   guards. The feature works from here.
4. The popup and the context menu: `matchingEntry`, the disabled state, the new
   string in `en` and `de`, the prefix and the `PENDING_TRANSLATION` entry.
5. The two reworded strings, and a pass over `docs/` if the blacklist is described
   anywhere.

Steps 1-3 are the feature; 4 keeps the quick paths honest about what they can and
cannot do. Each step leaves the suite green.

## 13 · Locked decisions

- Prefix matching that breaks at `/`; no syntax, no wildcards.
- Scheme ignored; only explicit ports compared.
- A trailing slash means nothing — it cannot survive the URL parser.
- Host and port decided once per document; path decided per gesture.
- One matcher in `js/blacklist-match.js`; the four callers use it.
- `blacklist` stays `string[]`, `set` in `MERGE_MAP`, no migration.
- The quick toggle stays host-wide and locks itself when a finer entry matches.
- The menu pattern system is not reused.
